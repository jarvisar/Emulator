const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6,
  160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22,
  192, 24, 72, 26, 16, 28, 32, 30,
];

const DUTY_TABLE = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];

const TRIANGLE_TABLE = [
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

const NOISE_PERIODS = [
  4, 8, 16, 32, 64, 96, 128, 160,
  202, 254, 380, 508, 762, 1016, 2034, 4068,
];

const DMC_PERIODS = [
  428, 380, 340, 320, 286, 254, 226, 214,
  190, 160, 142, 128, 106, 85, 72, 54,
];

class HighPassFilter {
  constructor(cutoff, sampleRate) {
    this.coefficient = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    this.previousInput = 0;
    this.previousOutput = 0;
  }

  process(input) {
    const output = input - this.previousInput + this.coefficient * this.previousOutput;
    this.previousInput = input;
    this.previousOutput = output;
    return output;
  }
}

class LowPassFilter {
  constructor(cutoff, sampleRate) {
    this.coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    this.output = 0;
  }

  process(input) {
    this.output += this.coefficient * (input - this.output);
    return this.output;
  }
}

class Envelope {
  constructor() {
    this.start = false;
    this.loop = false;
    this.constant = false;
    this.period = 0;
    this.divider = 0;
    this.decay = 0;
  }

  write(value) {
    this.loop = (value & 0x20) !== 0;
    this.constant = (value & 0x10) !== 0;
    this.period = value & 0x0f;
  }

  clock() {
    if (this.start) {
      this.start = false;
      this.decay = 15;
      this.divider = this.period;
    } else if (this.divider > 0) {
      this.divider--;
    } else {
      this.divider = this.period;
      if (this.decay > 0) this.decay--;
      else if (this.loop) this.decay = 15;
    }
  }

  get volume() {
    return this.constant ? this.period : this.decay;
  }
}

class Pulse {
  constructor(channel) {
    this.channel = channel;
    this.enabled = false;
    this.length = 0;
    this.duty = 0;
    this.sequence = 0;
    this.timerPeriod = 0;
    this.timer = 0;
    this.envelope = new Envelope();
    this.lengthHalt = false;
    this.sweepEnabled = false;
    this.sweepPeriod = 0;
    this.sweepNegate = false;
    this.sweepShift = 0;
    this.sweepReload = false;
    this.sweepDivider = 0;
  }

  writeControl(value) {
    this.duty = value >>> 6;
    this.lengthHalt = (value & 0x20) !== 0;
    this.envelope.write(value);
  }

  writeSweep(value) {
    this.sweepEnabled = (value & 0x80) !== 0;
    this.sweepPeriod = (value >>> 4) & 7;
    this.sweepNegate = (value & 0x08) !== 0;
    this.sweepShift = value & 7;
    this.sweepReload = true;
  }

  writeTimerLow(value) {
    this.timerPeriod = (this.timerPeriod & 0x700) | value;
  }

  writeTimerHigh(value) {
    this.timerPeriod = (this.timerPeriod & 0xff) | ((value & 7) << 8);
    if (this.enabled) this.length = LENGTH_TABLE[value >>> 3];
    this.sequence = 0;
    this.envelope.start = true;
  }

  targetPeriod() {
    const change = this.timerPeriod >>> this.sweepShift;
    return this.sweepNegate
      ? this.timerPeriod - change - (this.channel === 1 ? 1 : 0)
      : this.timerPeriod + change;
  }

  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.timerPeriod;
      this.sequence = (this.sequence + 1) & 7;
    } else {
      this.timer--;
    }
  }

  clockLengthAndSweep() {
    if (this.length > 0 && !this.lengthHalt) this.length--;
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0) {
      const target = this.targetPeriod();
      if (this.timerPeriod >= 8 && target <= 0x7ff && target >= 0) this.timerPeriod = target;
    }
    if (this.sweepDivider === 0 || this.sweepReload) {
      this.sweepDivider = this.sweepPeriod;
      this.sweepReload = false;
    } else {
      this.sweepDivider--;
    }
  }

  output() {
    const target = this.targetPeriod();
    if (
      !this.enabled ||
      this.length === 0 ||
      this.timerPeriod < 8 ||
      target > 0x7ff ||
      DUTY_TABLE[this.duty][this.sequence] === 0
    ) {
      return 0;
    }
    return this.envelope.volume;
  }
}

class Triangle {
  constructor() {
    this.enabled = false;
    this.length = 0;
    this.lengthHalt = false;
    this.linearReloadValue = 0;
    this.linearCounter = 0;
    this.linearReload = false;
    this.timerPeriod = 0;
    this.timer = 0;
    this.sequence = 0;
    this.outputLevel = 0;
  }

  writeControl(value) {
    this.lengthHalt = (value & 0x80) !== 0;
    this.linearReloadValue = value & 0x7f;
  }

  writeTimerLow(value) {
    this.timerPeriod = (this.timerPeriod & 0x700) | value;
  }

  writeTimerHigh(value) {
    this.timerPeriod = (this.timerPeriod & 0xff) | ((value & 7) << 8);
    if (this.enabled) this.length = LENGTH_TABLE[value >>> 3];
    this.linearReload = true;
  }

  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.timerPeriod;
      if (this.length > 0 && this.linearCounter > 0 && this.timerPeriod > 1) {
        this.sequence = (this.sequence + 1) & 31;
        this.outputLevel = TRIANGLE_TABLE[this.sequence];
      }
    } else {
      this.timer--;
    }
  }

  clockLinear() {
    if (this.linearReload) this.linearCounter = this.linearReloadValue;
    else if (this.linearCounter > 0) this.linearCounter--;
    if (!this.lengthHalt) this.linearReload = false;
  }

  clockLength() {
    if (this.length > 0 && !this.lengthHalt) this.length--;
  }

  output() {
    return this.outputLevel;
  }
}

class Noise {
  constructor() {
    this.enabled = false;
    this.length = 0;
    this.lengthHalt = false;
    this.envelope = new Envelope();
    this.mode = false;
    this.timerPeriod = 4;
    this.timer = 0;
    this.shift = 1;
  }

  writeControl(value) {
    this.lengthHalt = (value & 0x20) !== 0;
    this.envelope.write(value);
  }

  writePeriod(value) {
    this.mode = (value & 0x80) !== 0;
    this.timerPeriod = NOISE_PERIODS[value & 0x0f];
  }

  writeLength(value) {
    if (this.enabled) this.length = LENGTH_TABLE[value >>> 3];
    this.envelope.start = true;
  }

  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.timerPeriod - 1;
      const tap = this.mode ? 6 : 1;
      const feedback = (this.shift & 1) ^ ((this.shift >>> tap) & 1);
      this.shift = (this.shift >>> 1) | (feedback << 14);
    } else {
      this.timer--;
    }
  }

  clockLength() {
    if (this.length > 0 && !this.lengthHalt) this.length--;
  }

  output() {
    return this.enabled && this.length > 0 && !(this.shift & 1)
      ? this.envelope.volume
      : 0;
  }
}

class DMC {
  constructor(readCpu) {
    this.readCpu = readCpu;
    this.enabled = false;
    this.irqEnabled = false;
    this.irqPending = false;
    this.loop = false;
    this.timerPeriod = DMC_PERIODS[0];
    this.timer = 0;
    this.outputLevel = 0;
    this.sampleAddress = 0xc000;
    this.sampleLength = 1;
    this.currentAddress = 0xc000;
    this.bytesRemaining = 0;
    this.sampleBuffer = null;
    this.shift = 0;
    this.bitsRemaining = 8;
    this.silence = true;
  }

  restart() {
    this.currentAddress = this.sampleAddress;
    this.bytesRemaining = this.sampleLength;
  }

  fetch() {
    if (this.sampleBuffer !== null || this.bytesRemaining === 0) return;
    this.sampleBuffer = this.readCpu(this.currentAddress);
    this.currentAddress = this.currentAddress === 0xffff ? 0x8000 : this.currentAddress + 1;
    this.bytesRemaining--;
    if (this.bytesRemaining === 0) {
      if (this.loop) this.restart();
      else if (this.irqEnabled) this.irqPending = true;
    }
  }

  clockTimer() {
    this.fetch();
    if (this.timer === 0) {
      this.timer = this.timerPeriod - 1;
      if (!this.silence) {
        if (this.shift & 1) {
          if (this.outputLevel <= 125) this.outputLevel += 2;
        } else if (this.outputLevel >= 2) {
          this.outputLevel -= 2;
        }
      }
      this.shift >>>= 1;
      this.bitsRemaining--;
      if (this.bitsRemaining === 0) {
        this.bitsRemaining = 8;
        if (this.sampleBuffer === null) {
          this.silence = true;
        } else {
          this.silence = false;
          this.shift = this.sampleBuffer;
          this.sampleBuffer = null;
        }
      }
    } else {
      this.timer--;
    }
  }
}

export class APU {
  constructor(readCpu, sampleRate = 44100) {
    this.cpuFrequency = 1789773;
    this.sampleRate = sampleRate;
    this.pulse1 = new Pulse(1);
    this.pulse2 = new Pulse(2);
    this.triangle = new Triangle();
    this.noise = new Noise();
    this.dmc = new DMC(readCpu);
    this.samples = [];
    this.configureFilters();
    this.reset();
  }

  reset() {
    this.cycles = 0;
    this.frameCycle = 0;
    this.fiveStep = false;
    this.frameIrqInhibit = false;
    this.frameIrq = false;
    this.pendingFrameCounterValue = null;
    this.frameWriteDelay = 0;
    this.sampleAccumulator = 0;
    this.accumulatedCycles = 0;
    this.accumulatedPulse = 0;
    this.accumulatedTriangle = 0;
    this.accumulatedNoise = 0;
    this.accumulatedDmc = 0;
    this.samples.length = 0;
    this.configureFilters();
    this.write(0x4015, 0);
  }

  setSampleRate(sampleRate) {
    this.sampleRate = sampleRate;
    this.configureFilters();
  }

  configureFilters() {
    this.highPass90 = new HighPassFilter(90, this.sampleRate);
    this.highPass440 = new HighPassFilter(440, this.sampleRate);
    this.lowPass14000 = new LowPassFilter(14000, this.sampleRate);
  }

  write(address, value) {
    value &= 0xff;
    switch (address) {
      case 0x4000: this.pulse1.writeControl(value); break;
      case 0x4001: this.pulse1.writeSweep(value); break;
      case 0x4002: this.pulse1.writeTimerLow(value); break;
      case 0x4003: this.pulse1.writeTimerHigh(value); break;
      case 0x4004: this.pulse2.writeControl(value); break;
      case 0x4005: this.pulse2.writeSweep(value); break;
      case 0x4006: this.pulse2.writeTimerLow(value); break;
      case 0x4007: this.pulse2.writeTimerHigh(value); break;
      case 0x4008: this.triangle.writeControl(value); break;
      case 0x400a: this.triangle.writeTimerLow(value); break;
      case 0x400b: this.triangle.writeTimerHigh(value); break;
      case 0x400c: this.noise.writeControl(value); break;
      case 0x400e: this.noise.writePeriod(value); break;
      case 0x400f: this.noise.writeLength(value); break;
      case 0x4010:
        this.dmc.irqEnabled = (value & 0x80) !== 0;
        this.dmc.loop = (value & 0x40) !== 0;
        this.dmc.timerPeriod = DMC_PERIODS[value & 0x0f];
        if (!this.dmc.irqEnabled) this.dmc.irqPending = false;
        break;
      case 0x4011: this.dmc.outputLevel = value & 0x7f; break;
      case 0x4012: this.dmc.sampleAddress = 0xc000 | (value << 6); break;
      case 0x4013: this.dmc.sampleLength = (value << 4) | 1; break;
      case 0x4015:
        this.pulse1.enabled = (value & 1) !== 0;
        this.pulse2.enabled = (value & 2) !== 0;
        this.triangle.enabled = (value & 4) !== 0;
        this.noise.enabled = (value & 8) !== 0;
        this.dmc.enabled = (value & 0x10) !== 0;
        if (!this.pulse1.enabled) this.pulse1.length = 0;
        if (!this.pulse2.enabled) this.pulse2.length = 0;
        if (!this.triangle.enabled) this.triangle.length = 0;
        if (!this.noise.enabled) this.noise.length = 0;
        if (!this.dmc.enabled) this.dmc.bytesRemaining = 0;
        else if (this.dmc.bytesRemaining === 0) this.dmc.restart();
        this.dmc.irqPending = false;
        break;
      case 0x4017:
        this.frameIrqInhibit = (value & 0x40) !== 0;
        if (this.frameIrqInhibit) this.frameIrq = false;
        this.pendingFrameCounterValue = value;
        this.frameWriteDelay = (this.cycles & 1) === 0 ? 3 : 4;
        break;
    }
  }

  readStatus() {
    let status = 0;
    if (this.pulse1.length) status |= 1;
    if (this.pulse2.length) status |= 2;
    if (this.triangle.length) status |= 4;
    if (this.noise.length) status |= 8;
    if (this.dmc.bytesRemaining) status |= 0x10;
    if (this.frameIrq) status |= 0x40;
    if (this.dmc.irqPending) status |= 0x80;
    this.frameIrq = false;
    return status;
  }

  clockQuarterFrame() {
    this.pulse1.envelope.clock();
    this.pulse2.envelope.clock();
    this.noise.envelope.clock();
    this.triangle.clockLinear();
  }

  clockHalfFrame() {
    this.pulse1.clockLengthAndSweep();
    this.pulse2.clockLengthAndSweep();
    this.triangle.clockLength();
    this.noise.clockLength();
  }

  clockFrameSequencer() {
    this.frameCycle++;
    if (!this.fiveStep) {
      if (this.frameCycle === 7457 || this.frameCycle === 22371) this.clockQuarterFrame();
      if (this.frameCycle === 14913) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
      if (this.frameCycle >= 29828 && !this.frameIrqInhibit) this.frameIrq = true;
      if (this.frameCycle === 29829) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
      if (this.frameCycle >= 29830) {
        this.frameCycle = 0;
      }
    } else {
      if (this.frameCycle === 7457 || this.frameCycle === 22371) this.clockQuarterFrame();
      if (this.frameCycle === 14913 || this.frameCycle === 37281) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
      if (this.frameCycle >= 37282) this.frameCycle = 0;
    }
  }

  clockFrameCounterWrite() {
    if (this.frameWriteDelay === 0) return;
    this.frameWriteDelay--;
    if (this.frameWriteDelay !== 0) return;
    this.fiveStep = (this.pendingFrameCounterValue & 0x80) !== 0;
    this.pendingFrameCounterValue = null;
    this.frameCycle = 0;
    if (this.fiveStep) {
      this.clockQuarterFrame();
      this.clockHalfFrame();
    }
  }

  mixLevels(pulseSum, triangle, noise, dmc) {
    const pulse = pulseSum ? 95.88 / (8128 / pulseSum + 100) : 0;
    const tndInput =
      triangle / 8227 +
      noise / 12241 +
      dmc / 22638;
    const tnd = tndInput ? 159.79 / (1 / tndInput + 100) : 0;
    let output = pulse + tnd;
    output = this.highPass90.process(output);
    output = this.highPass440.process(output);
    output = this.lowPass14000.process(output);
    return Math.max(-1, Math.min(1, output * 1.4));
  }

  clock() {
    this.cycles++;
    this.clockFrameSequencer();
    this.clockFrameCounterWrite();
    this.triangle.clockTimer();
    this.dmc.clockTimer();
    if ((this.cycles & 1) === 0) {
      this.pulse1.clockTimer();
      this.pulse2.clockTimer();
    }
    this.noise.clockTimer();
    this.accumulatedPulse += this.pulse1.output() + this.pulse2.output();
    this.accumulatedTriangle += this.triangle.output();
    this.accumulatedNoise += this.noise.output();
    this.accumulatedDmc += this.dmc.outputLevel;
    this.accumulatedCycles++;
    this.sampleAccumulator += this.sampleRate;
    if (this.sampleAccumulator >= this.cpuFrequency) {
      this.sampleAccumulator -= this.cpuFrequency;
      const scale = 1 / this.accumulatedCycles;
      this.samples.push(this.mixLevels(
        this.accumulatedPulse * scale,
        this.accumulatedTriangle * scale,
        this.accumulatedNoise * scale,
        this.accumulatedDmc * scale,
      ));
      this.accumulatedCycles = 0;
      this.accumulatedPulse = 0;
      this.accumulatedTriangle = 0;
      this.accumulatedNoise = 0;
      this.accumulatedDmc = 0;
    }
  }

  drainSamples() {
    const samples = Float32Array.from(this.samples);
    this.samples.length = 0;
    return samples;
  }

  get irqPending() {
    return this.frameIrq || this.dmc.irqPending;
  }
}
