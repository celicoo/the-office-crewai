/**
 * PCM Capture Processor — 16 kHz 16-bit LE PCM.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 16000;
    this._ratio = sampleRate / this._targetRate;
    this._acc = 0;
    this._pending = [];
    this._chunkSamples = 640;
  }

  _flush() {
    while (this._pending.length >= this._chunkSamples) {
      const frame = this._pending.splice(0, this._chunkSamples);
      const pcmBuffer = new ArrayBuffer(frame.length * 2);
      const view = new DataView(pcmBuffer);
      for (let i = 0; i < frame.length; i++) {
        view.setInt16(i * 2, frame[i], true);
      }
      this.port.postMessage(pcmBuffer, [pcmBuffer]);
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this._acc += 1;
      if (this._acc < this._ratio) continue;
      this._acc -= this._ratio;

      const s = Math.max(-1, Math.min(1, channelData[i]));
      const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      this._pending.push(int16);
    }

    this._flush();
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
