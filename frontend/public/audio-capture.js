// Streaming box-filter resampling from the browser's actual device rate.
// Fractional weights carry across render blocks, so sample timing cannot drift.
class ChartCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate;
    this.remaining = sampleRate;
    this.sum = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    const output = [];
    for (const sample of channel) {
      let weight = this.targetRate;
      while (weight > 0) {
        const part = Math.min(weight, this.remaining);
        this.sum += sample * part;
        weight -= part;
        this.remaining -= part;
        if (this.remaining === 0) {
          output.push(this.sum / sampleRate);
          this.sum = 0;
          this.remaining = sampleRate;
        }
      }
    }
    if (output.length) {
      const samples = Float32Array.from(output);
      this.port.postMessage(samples, [samples.buffer]);
    }
    return true;
  }
}
registerProcessor('chart-capture', ChartCapture);
