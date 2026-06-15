class NesAudioOutputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions;
    this.buffer = new Float32Array(config.capacity);
    this.prebufferSamples = config.prebufferSamples;
    this.maxBufferedSamples = config.maxBufferedSamples;
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bufferedSamples = 0;
    this.playing = false;
    this.muted = false;
    this.fadeInRemaining = 0;
    this.lastSample = 0;
    this.underrunCount = 0;
    this.overflowCount = 0;
    this.reportCounter = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message.type === "samples") {
      this.push(message.samples);
    } else if (message.type === "clear") {
      this.clear();
    } else if (message.type === "muted") {
      this.muted = message.muted;
      if (this.muted) this.clear();
    }
  }

  push(samples) {
    const overflow = this.bufferedSamples + samples.length - this.maxBufferedSamples;
    if (overflow > 0) {
      this.discard(overflow);
      this.overflowCount++;
    }
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      this.bufferedSamples++;
    }
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
    this.fadeInRemaining = 0;
    this.lastSample = 0;
  }

  reportState() {
    this.port.postMessage({
      type: "state",
      bufferedSamples: this.bufferedSamples,
      playing: this.playing,
      underrunCount: this.underrunCount,
      overflowCount: this.overflowCount,
    });
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    output.fill(0);
    if (this.muted) return true;

    if (!this.playing && this.bufferedSamples >= this.prebufferSamples) {
      this.playing = true;
      this.fadeInRemaining = output.length;
    }

    if (this.playing && this.bufferedSamples < output.length) {
      for (let i = 0; i < output.length; i++) {
        output[i] = this.lastSample * (1 - i / output.length);
      }
      this.underrunCount++;
      this.clear();
    } else if (this.playing) {
      for (let i = 0; i < output.length; i++) {
        let sample = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.buffer.length;
        if (this.fadeInRemaining > 0) {
          sample *= 1 - this.fadeInRemaining / output.length;
          this.fadeInRemaining--;
        }
        output[i] = sample;
        this.lastSample = sample;
      }
      this.bufferedSamples -= output.length;
    }

    if (++this.reportCounter >= 8) {
      this.reportCounter = 0;
      this.reportState();
    }
    return true;
  }
}

registerProcessor("nes-audio-output", NesAudioOutputProcessor);
