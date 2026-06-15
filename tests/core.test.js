import assert from "node:assert/strict";
import test from "node:test";

import { APU } from "../src/apu.js";
import { AudioOutput } from "../src/audio.js";
import { Cartridge, Mirroring } from "../src/cartridge.js";
import { Buttons, Controller } from "../src/controller.js";
import { CPU } from "../src/cpu.js";
import {
  DiagnosticRecorder,
  buildDiagnosticLog,
  buildStartupFailureLog,
  crc32,
} from "../src/diagnostics.js";
import { isTextEntryTarget } from "../src/input.js";
import { parseStoredList, recordRecent, selectLibraryGames } from "../src/library-state.js";
import { NES } from "../src/nes.js";
import { PPU } from "../src/ppu.js";

function makeRom({ mapper = 0, prgBanks = 1, chrBanks = 1, battery = false } = {}) {
  const bytes = new Uint8Array(16 + prgBanks * 0x4000 + chrBanks * 0x2000);
  bytes.set([0x4e, 0x45, 0x53, 0x1a, prgBanks, chrBanks]);
  bytes[6] = ((mapper & 0x0f) << 4) | (battery ? 2 : 0);
  bytes[7] = mapper & 0xf0;
  return bytes;
}

test("audio output prebuffers and recovers cleanly from underruns", () => {
  const audio = new AudioOutput(100);
  audio.prebufferSamples = 4;
  audio.push(new Float32Array([0.1, 0.2, 0.3]));
  const waiting = new Float32Array(2);
  audio.fill(waiting);
  assert.deepEqual([...waiting], [0, 0]);
  assert.equal(audio.bufferedSamples, 3);

  audio.push(new Float32Array([0.4, 0.5]));
  const playing = new Float32Array(4);
  audio.fill(playing);
  assert.ok(Math.abs(playing[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(playing[3] - 0.4) < 1e-6);

  const underrun = new Float32Array(2);
  audio.fill(underrun);
  assert.deepEqual([...underrun], [0, 0]);
  assert.equal(audio.bufferedSamples, 0);
  assert.equal(audio.underrunCount, 1);
});

test("audio worklet prebuffers, fades in, and clears stale data on underrun", async () => {
  const reports = [];
  let Processor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: (message) => reports.push(message),
      };
    }
  };
  globalThis.registerProcessor = (name, constructor) => {
    assert.equal(name, "nes-audio-output");
    Processor = constructor;
  };

  try {
    await import("../src/audio-worklet.js");
    const processor = new Processor({
      processorOptions: {
        capacity: 16,
        prebufferSamples: 4,
        maxBufferedSamples: 12,
      },
    });
    processor.push(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
    const first = new Float32Array(4);
    processor.process([], [[first]]);
    assert.equal(first[0], 0);
    assert.ok(first[3] > 0);
    assert.equal(processor.bufferedSamples, 2);

    const underrun = new Float32Array(4);
    processor.process([], [[underrun]]);
    assert.equal(processor.bufferedSamples, 0);
    assert.equal(processor.playing, false);
    assert.equal(processor.underrunCount, 1);
    assert.ok(underrun[0] > underrun[3]);
    assert.equal(reports.length, 0);
  } finally {
    delete globalThis.AudioWorkletProcessor;
    delete globalThis.registerProcessor;
  }
});

test("APU frame sequencer clocks envelopes and lengths at NTSC CPU-cycle timings", () => {
  const apu = new APU(() => 0);
  apu.write(0x4015, 0x01);
  apu.write(0x4000, 0x00);
  apu.write(0x4003, 0x18);

  for (let i = 0; i < 7456; i++) apu.clock();
  assert.equal(apu.pulse1.envelope.decay, 0);
  assert.equal(apu.pulse1.length, 2);
  apu.clock();
  assert.equal(apu.pulse1.envelope.decay, 15);

  for (let i = 7457; i < 14912; i++) apu.clock();
  assert.equal(apu.pulse1.length, 2);
  apu.clock();
  assert.equal(apu.pulse1.length, 1);

  for (let i = 14913; i < 29827; i++) apu.clock();
  assert.equal(apu.frameIrq, false);
  apu.clock();
  assert.equal(apu.frameIrq, true);
});

test("APU applies five-step frame counter writes after the hardware delay", () => {
  const apu = new APU(() => 0);
  apu.write(0x4015, 0x01);
  apu.write(0x4000, 0x00);
  apu.write(0x4003, 0x18);
  apu.write(0x4017, 0x80);

  apu.clock();
  apu.clock();
  assert.equal(apu.fiveStep, false);
  assert.equal(apu.pulse1.length, 2);
  apu.clock();
  assert.equal(apu.fiveStep, true);
  assert.equal(apu.pulse1.length, 1);
  assert.equal(apu.pulse1.envelope.decay, 15);
});

test("APU noise timer uses CPU-cycle periods and triangle DAC holds its level", () => {
  const apu = new APU(() => 0);
  apu.clock();
  assert.equal(apu.noise.timer, 3);
  assert.equal(apu.noise.shift, 0x4000);

  apu.triangle.enabled = true;
  apu.triangle.length = 1;
  apu.triangle.linearCounter = 1;
  apu.triangle.timerPeriod = 2;
  apu.triangle.timer = 0;
  apu.triangle.clockTimer();
  assert.equal(apu.triangle.output(), 14);
  apu.triangle.length = 0;
  assert.equal(apu.triangle.output(), 14);
});

test("APU silence is centered at zero and DMC fetches charge CPU stall cycles", () => {
  const apu = new APU(() => 0);
  for (let i = 0; i < 2000; i++) apu.clock();
  const samples = apu.drainSamples();
  assert.ok(samples.length > 0);
  assert.ok(samples.every((sample) => sample === 0));

  const nes = new NES(makeRom());
  nes.readDmc(0xc000);
  assert.equal(nes.takeDmaStall(0), 4);
});

test("APU pulse output remains finite and centered after filtering", () => {
  const apu = new APU(() => 0);
  apu.write(0x4015, 0x01);
  apu.write(0x4000, 0x9f);
  apu.write(0x4002, 100);
  apu.write(0x4003, 0x08);
  for (let i = 0; i < 100000; i++) apu.clock();
  const samples = apu.drainSamples().subarray(200);
  assert.ok(samples.every(Number.isFinite));
  assert.ok(Math.min(...samples) < -0.01);
  assert.ok(Math.max(...samples) > 0.01);
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  assert.ok(Math.abs(mean) < 0.01);
});

test("keyboard controls are suppressed for typing fields but not focused buttons", () => {
  const target = (kind) => ({
    closest: (selector) => selector.split(", ").some((entry) => entry.startsWith(kind))
      ? {}
      : null,
  });
  assert.equal(isTextEntryTarget(target("input")), true);
  assert.equal(isTextEntryTarget(target("textarea")), true);
  assert.equal(isTextEntryTarget(target("button")), false);
  assert.equal(isTextEntryTarget(null), false);
});

test("library state preserves unique favorites and orders recent cartridges", () => {
  assert.deepEqual(parseStoredList('["a.nes","a.nes","b.nes"]'), ["a.nes", "b.nes"]);
  assert.deepEqual(recordRecent(["b.nes", "a.nes"], "a.nes"), ["a.nes", "b.nes"]);
  const games = [
    { file: "a.nes", name: "Alpha" },
    { file: "b.nes", name: "Beta" },
  ];
  assert.deepEqual(
    selectLibraryGames(games, "favorites", new Set(["b.nes"]), [], ""),
    [games[1]],
  );
  assert.deepEqual(
    selectLibraryGames(games, "recent", new Set(), ["b.nes", "a.nes"], "a"),
    [games[1], games[0]],
  );
});

test("diagnostic recorder stays bounded and CRC32 matches the standard vector", () => {
  const recorder = new DiagnosticRecorder(2, 2);
  const cpu = {
    totalCycles: 1, lastPc: 0x8000, lastOpcode: 0xea, lastOperation: "NOP",
    a: 0, x: 0, y: 0, sp: 0xfd, p: 0x24,
  };
  const ppu = { scanline: 0, cycle: 0 };
  recorder.recordCpu(cpu, ppu);
  cpu.totalCycles++;
  recorder.recordCpu(cpu, ppu);
  cpu.totalCycles++;
  recorder.recordCpu(cpu, ppu);
  recorder.recordFrame(1, 100, 1, 20, 30);
  recorder.recordFrame(2, 100, 1, 20, 30);
  recorder.recordFrame(3, 100, 1, 20, 30);
  assert.deepEqual(recorder.cpuSamples().map((sample) => sample.cycle), [2, 3]);
  assert.deepEqual(recorder.frames.map((frame) => frame.frame), [2, 3]);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("startup failure logs identify malformed ROMs without embedding their bytes", () => {
  const rom = new Uint8Array([1, 2, 3, 4]);
  const log = buildStartupFailureLog(rom, "broken.nes", new Error("Bad header"));
  assert.match(log, /STARTUP FAILURE LOG/);
  assert.match(log, /Valid iNES header: false/);
  assert.match(log, /Message: Bad header/);
  assert.match(log, /ROM bytes included: No/);
  assert.doesNotMatch(log, /01 02 03 04/);
});

test("CPU executes arithmetic, flags, and memory stores", () => {
  const memory = new Uint8Array(0x10000);
  memory.set([0xa9, 0x7f, 0x69, 0x01, 0x85, 0x02], 0x8000);
  memory[0xfffc] = 0x00;
  memory[0xfffd] = 0x80;
  const bus = {
    read: (address) => memory[address],
    write: (address, value) => { memory[address] = value; },
    takeDmaStall: () => 0,
  };
  const cpu = new CPU(bus);
  cpu.reset();
  assert.equal(cpu.step(), 2);
  assert.equal(cpu.a, 0x7f);
  assert.equal(cpu.step(), 2);
  assert.equal(cpu.a, 0x80);
  assert.equal(cpu.getFlag(0x40), true);
  assert.equal(cpu.step(), 3);
  assert.equal(memory[2], 0x80);
});

test("CPU reproduces the 6502 indirect JMP page-wrap behavior", () => {
  const memory = new Uint8Array(0x10000);
  memory.set([0x6c, 0xff, 0x12], 0x8000);
  memory[0x12ff] = 0x34;
  memory[0x1200] = 0x12;
  memory[0x1300] = 0x99;
  memory[0xfffc] = 0x00;
  memory[0xfffd] = 0x80;
  const cpu = new CPU({
    read: (address) => memory[address],
    write: (address, value) => { memory[address] = value; },
    takeDmaStall: () => 0,
  });
  cpu.reset();
  cpu.step();
  assert.equal(cpu.pc, 0x1234);
});

test("controller latches buttons in NES serial order", () => {
  const controller = new Controller();
  controller.setButton(Buttons.A, true);
  controller.setButton(Buttons.START, true);
  controller.write(1);
  controller.write(0);
  const bits = Array.from({ length: 8 }, () => controller.read() & 1);
  assert.deepEqual(bits, [1, 0, 0, 1, 0, 0, 0, 0]);
});

test("NROM mirrors a 16 KiB PRG image", () => {
  const rom = makeRom();
  rom[16] = 0x42;
  const cartridge = new Cartridge(rom);
  assert.equal(cartridge.cpuRead(0x8000), 0x42);
  assert.equal(cartridge.cpuRead(0xc000), 0x42);
});

test("UxROM switches the lower bank and fixes the final bank", () => {
  const rom = makeRom({ mapper: 2, prgBanks: 4 });
  for (let bank = 0; bank < 4; bank++) {
    rom.fill(bank, 16 + bank * 0x4000, 16 + (bank + 1) * 0x4000);
  }
  const cartridge = new Cartridge(rom);
  assert.equal(cartridge.cpuRead(0x8000), 0);
  assert.equal(cartridge.cpuRead(0xc000), 3);
  cartridge.cpuWrite(0x8000, 2);
  assert.equal(cartridge.cpuRead(0x8000), 2);
});

test("MMC1 serial writes select a PRG bank", () => {
  const rom = makeRom({ mapper: 1, prgBanks: 4 });
  for (let bank = 0; bank < 4; bank++) {
    rom.fill(bank, 16 + bank * 0x4000, 16 + (bank + 1) * 0x4000);
  }
  const cartridge = new Cartridge(rom);
  const writeSerial = (address, value) => {
    for (let bit = 0; bit < 5; bit++) cartridge.cpuWrite(address, (value >>> bit) & 1);
  };
  writeSerial(0xe000, 2);
  assert.equal(cartridge.cpuRead(0x8000), 2);
  assert.equal(cartridge.cpuRead(0xc000), 3);
});

test("MMC5 exposes multiplication and configurable nametable fill data", () => {
  const cartridge = new Cartridge(makeRom({ mapper: 5, prgBanks: 4 }));
  cartridge.cpuWrite(0x5205, 7);
  cartridge.cpuWrite(0x5206, 9);
  assert.equal(cartridge.cpuRead(0x5205), 63);
  assert.equal(cartridge.cpuRead(0x5206), 0);
  cartridge.cpuWrite(0x5105, 3);
  cartridge.cpuWrite(0x5106, 0x2a);
  cartridge.cpuWrite(0x5107, 2);
  const internal = new Uint8Array(0x1000);
  assert.equal(cartridge.readNametable(0, 0x20, internal), 0x2a);
  assert.equal(cartridge.readNametable(0, 0x3c0, internal), 0xaa);
});

test("PPU nametable and palette mirrors are mapped correctly", () => {
  const cartridge = new Cartridge(makeRom());
  const ppu = new PPU(cartridge, () => {});
  cartridge.mirroring = Mirroring.VERTICAL;
  ppu.write(0x2000, 0x11);
  assert.equal(ppu.read(0x2800), 0x11);
  ppu.write(0x3f00, 0x22);
  assert.equal(ppu.read(0x3f10), 0x22 & 0x3f);
});

test("a generated NROM reaches vblank and produces a complete frame", () => {
  const rom = makeRom({ chrBanks: 0 });
  const prg = 16;
  rom.set([0x78, 0xd8, 0xa2, 0xff, 0x9a, 0x4c, 0x05, 0x80], prg);
  rom[prg + 0x3ffa] = 0x05;
  rom[prg + 0x3ffb] = 0x80;
  rom[prg + 0x3ffc] = 0x00;
  rom[prg + 0x3ffd] = 0x80;
  rom[prg + 0x3ffe] = 0x05;
  rom[prg + 0x3fff] = 0x80;
  const nes = new NES(rom);
  const frame = nes.runFrame();
  assert.equal(frame.pixels.length, 256 * 240 * 4);
  assert.equal(frame.frame, 1);
  assert.ok(frame.audio.length > 600);
  const log = buildDiagnosticLog(nes, { file: "generated.nes", fps: 60 });
  assert.match(log, /8-BIT CONTROL DECK DIAGNOSTIC LOG/);
  assert.match(log, /Library file: generated\.nes/);
  assert.match(log, /=== SAMPLED CPU EXECUTION ===/);
  assert.match(log, /ROM bytes included: No/);
});

test("Zapper reports bright pixels and trigger state on controller port 2", () => {
  const rom = makeRom({ chrBanks: 0 });
  const prg = 16;
  rom.set([0x4c, 0x00, 0x80], prg);
  rom[prg + 0x3ffc] = 0x00;
  rom[prg + 0x3ffd] = 0x80;
  const nes = new NES(rom);
  const pixel = (40 * 256 + 30) * 4;
  nes.ppu.framebuffer.fill(0);
  nes.ppu.framebuffer[pixel] = 255;
  nes.ppu.framebuffer[pixel + 1] = 255;
  nes.ppu.framebuffer[pixel + 2] = 255;
  nes.setZapper(30, 40, true);
  const value = nes.readZapper();
  assert.equal(value & 0x08, 0);
  assert.equal(value & 0x10, 0x10);
});
