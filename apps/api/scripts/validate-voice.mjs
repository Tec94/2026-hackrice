import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../dist/config.js';
import { createVoiceProvider } from '../dist/providers/voice.js';
import { renderSafeReply } from '@hackrice/contracts';
import WebSocket from 'ws';

// Run only with the API stopped. Uses its existing callback routing, but exposes
// no application routes and changes neither the database nor the playback flag.
const settings = await config();
if (!settings.voice) throw new Error('Voice credentials are missing.');
const reply = { kind: 'refusal', reason: 'advice' };
const expected = renderSafeReply(reply);
let finish;
const completed = new Promise(resolve => { finish = resolve; });
const chunks = [];
const provider = createVoiceProvider({
  socketFactory(url, options) {
    const socket = new WebSocket(url, options);
    socket.on('message', (data, binary) => {
      if (binary) return;
      const event = JSON.parse(data.toString());
      if (event.type === 'Error' || event.type === 'Warning') console.log('Provider diagnostic:', event.type, event.code);
    });
    return socket;
  },
  config: { ...settings.voice, playbackValidated: true },
  answer: async () => reply,
  isTurnActive: async () => true,
  onEvent(_binding, event) {
    if (event.type === 'audio') chunks.push(Buffer.from(event.pcm));
    else console.log('Validation event:', event.type);
    if (event.type === 'final_transcript') console.log('Input transcript:', event.text);
    if (event.type === 'generated') finish(true);
    if (event.type === 'unavailable') finish(false);
  },
});
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/internal/think') { response.writeHead(404).end(); return; }
  try {
    const parts = [];
    for await (const part of request) parts.push(part);
    const result = await provider.handleThink(request.headers.authorization, JSON.parse(Buffer.concat(parts).toString()));
    console.log('Think callback status:', result.statusCode);
    response.writeHead(result.statusCode, { 'content-type': result.contentType }).end(result.body);
  } catch { response.writeHead(400).end(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(settings.port, settings.host, done); });
let relay;
try {
  const speech = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voice.elevenLabsVoiceId)}?output_format=pcm_16000`, {
    method: 'POST', headers: { 'xi-api-key': settings.voice.elevenLabsApiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Should I buy this asset?', model_id: 'eleven_turbo_v2_5' }),
  });
  if (!speech.ok) throw new Error(`ElevenLabs TTS returned HTTP ${speech.status}.`);
  const input = new Uint8Array(await speech.arrayBuffer());
  relay = provider.start({ userId: 'voice-validation', sessionId: crypto.randomUUID(), turnId: crypto.randomUUID(), chartSnapshotId: crypto.randomUUID() },
    { encoding: 'pcm_s16le', sampleRateHz: 16000, channels: 1 });
  if (relay.status === 'unavailable' || !await relay.ready) throw new Error('Deepgram settings failed.');
  if (!relay.sendAudio(input)) throw new Error('Deepgram input failed.');
  relay.stop();
  if (!await completed || !chunks.length) throw new Error('Controlled speech generation failed.');
  const pcm = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const path = resolve('.data/voice-validation.wav');
  await mkdir(resolve('.data'), { recursive: true });
  await writeFile(path, Buffer.concat([header, pcm]));
  console.log('Expected speech:', expected);
  console.log('Generated audio:', path);
  console.log('Listen and confirm the complete approved response before setting VOICE_PLAYBACK_VALIDATED=true.');
} finally {
  relay?.cancel?.();
  await new Promise(done => server.close(done));
}
