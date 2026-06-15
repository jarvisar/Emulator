export class AudioOutput {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.context = null;
    this.node = null;
    this.backend = "none";
    this.buffer = new Float32Array(131072);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bufferedSamples = 0;
    this.prebufferSamples = Math.floor(sampleRate * 0.08);
    this.maxBufferedSamples = Math.floor(sampleRate * 0.3);
    this.playing = false;
    this.muted = false;
    this.underrunCount = 0;
    this.overflowCount = 0;
  }

  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext({ latencyHint: "interactive", sampleRate: this.sampleRate });
      this.sampleRate = this.context.sampleRate;
      this.prebufferSamples = Math.floor(this.sampleRate * 0.08);
      this.maxBufferedSamples = Math.floor(this.sampleRate * 0.3);
      if (this.context.audioWorklet && window.AudioWorkletNode) {
        try {
          await this.context.audioWorklet.addModule(
            new URL("./audio-worklet.js", import.meta.url),
          );
          this.node = new window.AudioWorkletNode(this.context, "nes-audio-output", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
              capacity: this.buffer.length,
              prebufferSamples: this.prebufferSamples,
              maxBufferedSamples: this.maxBufferedSamples,
            },
          });
          this.node.port.onmessage = (event) => this.handleWorkletMessage(event.data);
          this.backend = "worklet";
        } catch {
          this.createScriptProcessor();
        }
      } else {
        this.createScriptProcessor();
      }
      this.node.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  createScriptProcessor() {
    this.node = this.context.createScriptProcessor(1024, 0, 1);
    this.node.onaudioprocess = (event) => this.fill(event.outputBuffer.getChannelData(0));
    this.backend = "script";
  }

  handleWorkletMessage(message) {
    if (message.type !== "state") return;
    this.bufferedSamples = message.bufferedSamples;
    this.playing = message.playing;
    this.underrunCount = message.underrunCount;
    this.overflowCount = message.overflowCount;
  }

  push(samples) {
    if (this.muted || !samples.length) return;
    if (this.backend === "worklet") {
      const chunk = samples instanceof Float32Array ? samples : Float32Array.from(samples);
      const overflow = this.bufferedSamples + chunk.length - this.maxBufferedSamples;
      if (overflow > 0) this.overflowCount++;
      this.bufferedSamples = Math.min(
        this.maxBufferedSamples,
        this.bufferedSamples + chunk.length,
      );
      this.node.port.postMessage({ type: "samples", samples: chunk });
      return;
    }
    const overflow = this.bufferedSamples + samples.length - this.maxBufferedSamples;
    if (overflow > 0) {
      this.overflowCount++;
      this.discard(overflow);
    }
    for (const sample of samples) {
      this.buffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      if (this.bufferedSamples < this.buffer.length) {
        this.bufferedSamples++;
      } else {
        this.readIndex = (this.readIndex + 1) % this.buffer.length;
      }
    }
  }

  fill(output) {
    output.fill(0);
    if (this.muted) return;
    if (!this.playing) {
      if (this.bufferedSamples < this.prebufferSamples) return;
      this.playing = true;
    }
    if (this.bufferedSamples < output.length) {
      this.underrunCount++;
      this.readIndex = this.writeIndex;
      this.bufferedSamples = 0;
      this.playing = false;
      return;
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.buffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.buffer.length;
    }
    this.bufferedSamples -= output.length;
  }

  discard(count) {
    const discarded = Math.min(count, this.bufferedSamples);
    this.readIndex = (this.readIndex + discarded) % this.buffer.length;
    this.bufferedSamples -= discarded;
  }

  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bufferedSamples = 0;
    this.playing = false;
    if (this.backend === "worklet") this.node.port.postMessage({ type: "clear" });
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.backend === "worklet") {
      this.node.port.postMessage({ type: "muted", muted });
    }
    if (muted) this.clear();
  }

  async suspend() {
    if (this.context?.state === "running") await this.context.suspend();
  }
}
