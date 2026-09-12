import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encodeAudioFrame, decodeAudioFrame } from '@hackrice/contracts';
import { VoiceClient, floatToPcm, pcmToFloat } from '../src/services/voice-client.ts';

test('PCM conversion clamps and preserves signed little-endian samples', () => {
  const pcm = floatToPcm(Float32Array.from([-2, -0.5, 0, 0.5, 2]));
  assert.deepEqual([...new Int16Array(pcm.buffer)], [-32768, -16384, 0, 16384, 32767]);
  assert.deepEqual([...pcmToFloat(pcm)], [-1, -0.5, 0, 0.5, 32767 / 32768]);
  assert.throws(() => pcmToFloat(new Uint8Array(1)));
});

test('capture resampling carries fractional weights across browser render blocks', async () => {
  const code = await readFile(new URL('../public/audio-capture.js', import.meta.url), 'utf8');
  for (const sampleRate of [16000, 44100, 48000]) {
    const blocks = [];
    let Processor;
    vm.runInNewContext(code, { AudioWorkletProcessor: class { port = { postMessage: b => blocks.push(...b) }; }, sampleRate,
      registerProcessor: (_name, klass) => { Processor = klass; } });
    const capture = new Processor({ processorOptions: { targetRate: 16000 } });
    // One second at each common browser device rate, split at render quantum boundaries.
    for (let i = 0; i < sampleRate; i += 128) capture.process([[new Float32Array(Math.min(128, sampleRate - i)).fill(0.5)]]);
    assert.equal(blocks.length, 16000, `sample count at ${sampleRate}`);
    assert.ok(blocks.every(value => value === 0.5));
  }
});

test('voice lifecycle gates audio, stops capture, and acknowledges only drained playback', async t => {
  const previous = Object.fromEntries(['window', 'navigator', 'location', 'WebSocket', 'AudioWorkletNode'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const sockets = [], worklets = [], sources = [], tracks = [];
  class Socket {
    static OPEN = 1; readyState = 1; sent = [];
    constructor(url) { this.url = url.toString(); sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; }
    message(value) { this.onmessage?.({ data: typeof value === 'object' && !(value instanceof ArrayBuffer) ? JSON.stringify(value) : value }); }
  }
  class Context {
    currentTime = 0; destination = {}; audioWorklet = { addModule: async () => {} };
    resume = async () => {}; close = async () => {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBuffer(_channels, length, rate) { return { duration: length / rate, copyToChannel() {} }; }
    createBufferSource() { const source = { connect() {}, disconnect() {}, start() {}, stop() {} }; sources.push(source); return source; }
  }
  class Worklet { constructor() { this.port = { close() {} }; worklets.push(this); } connect() {} disconnect() {} }
  let grant;
  const media = { getUserMedia: async () => { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; } };
  for (const [key, value] of Object.entries({ window: { AudioContext: Context }, navigator: { mediaDevices: media }, location: { href: 'http://localhost:3000/', protocol: 'http:' }, WebSocket: Socket, AudioWorkletNode: Worklet })) Object.defineProperty(globalThis, key, { configurable: true, value });
  globalThis.AudioContext = Context;
  t.after(() => { delete globalThis.AudioContext; });
  const sessionId = crypto.randomUUID(), snapshotId = crypto.randomUUID();
  const errors = [], states = []; let completions = 0;
  const client = new VoiceClient(sessionId, { state: s => states.push(s), transcript() {}, answer() {}, error: e => errors.push(e), complete: () => completions++ });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  let sequence = 0;
  const event = (socket, value) => socket.message({ protocolVersion: 1, eventId: crypto.randomUUID(), sessionId, sequence: sequence++, ...value });
  await client.start(async () => ({ id: snapshotId }));
  const socket = sockets.at(-1);
  assert.equal(socket.url, `ws://localhost:3000/api/sessions/${sessionId}/events`);
  // Use the real public-session schema's fixture shape.
  const { PublicSession } = await import('@hackrice/contracts');
  const session = PublicSession.parse({ id: sessionId, symbol: 'SOL/USDT', timeframe: '5m', predictionHorizon: '1h', status: 'exploring', chartRange: { from: -60, to: 0 }, latestChartRevision: 0, createdAt: new Date().toISOString(), expiresAt: new Date().toISOString() });
  const format = { encoding: 'pcm_s16le', sampleRateHz: 16000, channels: 1 };
  event(socket, { type: 'session.ready', session, inputFormat: format, outputFormat: format });
  await flush();
  const start = JSON.parse(socket.sent[0]);
  assert.equal(start.type, 'voice.start'); assert.equal(start.chartSnapshotId, snapshotId);
  worklets.at(-1).port.onmessage({ data: new Float32Array(1600).fill(0.5) });
  assert.equal(socket.sent.length, 1, 'no audio until voice.ready');
  event(socket, { type: 'voice.ready', turnId: start.turnId, format }); await flush();
  worklets.at(-1).port.onmessage({ data: new Float32Array(1600).fill(0.5) });
  assert.equal(decodeAudioFrame(new Uint8Array(socket.sent[1])).turnId, start.turnId);
  client.stop(); assert.ok(tracks[0].stopped);
  event(socket, { type: 'assistant.response', turnId: start.turnId, chartSnapshotId: snapshotId, reply: { kind: 'refusal', reason: 'advice' } });
  event(socket, { type: 'assistant.audio.start', turnId: start.turnId, format });
  socket.message(encodeAudioFrame(start.turnId, new Uint8Array([0, 0])).buffer);
  event(socket, { type: 'assistant.completed', turnId: start.turnId, delivery: 'partial' }); await flush();
  assert.equal(completions, 0);
  sources.at(-1).onended();
  assert.equal(completions, 1);
  assert.equal(JSON.parse(socket.sent.at(-1)).type, 'assistant.playback.completed');
  assert.deepEqual(errors, []);

  await client.start(async () => ({ id: snapshotId }));
  const unsafe = sockets.at(-1);
  event(unsafe, { type: 'session.ready', session, inputFormat: format, outputFormat: format }); await flush();
  const next = JSON.parse(unsafe.sent[0]);
  unsafe.message(encodeAudioFrame(next.turnId, new Uint8Array([0, 0])).buffer); await flush();
  assert.match(errors.at(-1), /Unapproved/); assert.ok(tracks.at(-1).stopped);
  assert.equal(states.at(-1), 'idle');

  media.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const pending = client.start(async () => ({ id: snapshotId }));
  client.cancel();
  let stopped = false;
  grant({ getTracks: () => [{ stop() { stopped = true; } }] });
  await pending; assert.ok(stopped, 'late permission grants are reclaimed');
});
