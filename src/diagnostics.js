const MIRRORING_NAMES = ["horizontal", "vertical", "single-screen A", "single-screen B", "four-screen"];

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function hex(value, width = 2) {
  return `$${(value >>> 0).toString(16).toUpperCase().padStart(width, "0")}`;
}

function flags(value) {
  return [
    ["N", 0x80], ["V", 0x40], ["U", 0x20], ["B", 0x10],
    ["D", 0x08], ["I", 0x04], ["Z", 0x02], ["C", 0x01],
  ].map(([name, mask]) => value & mask ? name : name.toLowerCase()).join("");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hexdump(bytes, startAddress = 0) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    const values = [...chunk].map((value) => value.toString(16).toUpperCase().padStart(2, "0"));
    lines.push(`${hex(startAddress + offset, 4)}  ${values.join(" ").padEnd(47, " ")}`);
  }
  return lines.join("\n");
}

function mapperState(mapper) {
  const lines = [];
  for (const [key, value] of Object.entries(mapper)) {
    if (key === "cart") continue;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      lines.push(`${key}=${value}`);
    } else if (ArrayBuffer.isView(value)) {
      const shown = [...value.subarray(0, 32)].join(",");
      lines.push(`${key}=[${shown}${value.length > 32 ? ",..." : ""}] (length=${value.length})`);
    }
  }
  return lines.join("\n") || "(no mapper registers exposed)";
}

export class DiagnosticRecorder {
  constructor(sampleLimit = 512, frameLimit = 180) {
    this.sampleLimit = sampleLimit;
    this.frameLimit = frameLimit;
    this.samples = new Array(sampleLimit);
    this.sampleWrite = 0;
    this.sampleCount = 0;
    this.frames = [];
    this.events = [];
    this.startedAt = now();
  }

  recordCpu(cpu, ppu, irqSource = 0) {
    this.samples[this.sampleWrite] = {
      cycle: cpu.totalCycles,
      pc: cpu.lastPc,
      opcode: cpu.lastOpcode,
      operation: cpu.lastOperation,
      a: cpu.a,
      x: cpu.x,
      y: cpu.y,
      sp: cpu.sp,
      p: cpu.p,
      scanline: ppu.scanline,
      dot: ppu.cycle,
      irqSource,
    };
    this.sampleWrite = (this.sampleWrite + 1) % this.sampleLimit;
    this.sampleCount = Math.min(this.sampleCount + 1, this.sampleLimit);
  }

  recordFrame(frame, cpuCycles, durationMs, instructions, audioSamples) {
    this.frames.push({ frame, cpuCycles, durationMs, instructions, audioSamples });
    if (this.frames.length > this.frameLimit) this.frames.shift();
  }

  recordEvent(type, message, details = "") {
    this.events.push({
      elapsedMs: now() - this.startedAt,
      type,
      message,
      details,
    });
    if (this.events.length > 64) this.events.shift();
  }

  recordError(error, phase = "runtime") {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "" : "";
    this.recordEvent("ERROR", `${phase}: ${message}`, stack);
  }

  cpuSamples() {
    const ordered = [];
    const start = (this.sampleWrite - this.sampleCount + this.sampleLimit) % this.sampleLimit;
    for (let i = 0; i < this.sampleCount; i++) {
      ordered.push(this.samples[(start + i) % this.sampleLimit]);
    }
    return ordered;
  }
}

export function buildDiagnosticLog(nes, context = {}) {
  if (!nes) throw new Error("No running emulator is available");
  const { cartridge, cpu, ppu, apu, diagnostics } = nes;
  const lines = [];
  const section = (title) => {
    lines.push("", `=== ${title} ===`);
  };
  const property = (name, value) => lines.push(`${name}: ${value}`);

  lines.push("8-BIT CONTROL DECK DIAGNOSTIC LOG");
  property("Generated", new Date().toISOString());
  property("Format version", 1);
  property("ROM bytes included", "No");

  section("CARTRIDGE");
  property("Name", cartridge.name);
  property("Library file", context.file ?? "(external file)");
  property("Mapper", cartridge.mapperId);
  property("Submapper", cartridge.submapper);
  property("PRG ROM", `${cartridge.prgRom.length} bytes`);
  property("CHR", `${cartridge.chr.length} bytes (${cartridge.chrRam ? "RAM" : "ROM"})`);
  property("PRG RAM", `${cartridge.prgRam.length} bytes`);
  property("Battery", cartridge.battery);
  property("Mirroring", MIRRORING_NAMES[cartridge.mirroring] ?? cartridge.mirroring);
  property("PRG CRC32", crc32(cartridge.prgRom).toString(16).toUpperCase().padStart(8, "0"));
  property("CHR CRC32", crc32(cartridge.chr).toString(16).toUpperCase().padStart(8, "0"));

  section("RUNTIME");
  property("State", context.paused ? "paused" : "running");
  property("Displayed FPS", context.fps ?? "unknown");
  property("Display mode", context.displayMode ?? "unknown");
  property("Muted", Boolean(context.muted));
  property("Emulated frames", ppu.frame);
  property("CPU cycles", cpu.totalCycles);
  property("Recorder uptime", `${Math.round(now() - diagnostics.startedAt)} ms`);

  section("HOST / AUDIO");
  property("User agent", context.userAgent ?? "unknown");
  property("Viewport", context.viewport ?? "unknown");
  property("Device pixel ratio", context.devicePixelRatio ?? "unknown");
  property("Audio context", context.audioState ?? "unavailable");
  property("Audio backend", context.audioBackend ?? "unknown");
  property("Audio sample rate", context.audioSampleRate ?? apu.sampleRate);
  property("Buffered audio", context.audioBufferedSamples ?? "unknown");
  property("Audio underruns", context.audioUnderruns ?? "unknown");
  property("Audio overflows", context.audioOverflows ?? "unknown");

  section("CPU");
  property("PC", hex(cpu.pc, 4));
  property("A", hex(cpu.a));
  property("X", hex(cpu.x));
  property("Y", hex(cpu.y));
  property("SP", hex(cpu.sp));
  property("P", `${hex(cpu.p)} (${flags(cpu.p)})`);
  property("Last instruction", `${hex(cpu.lastPc, 4)} ${hex(cpu.lastOpcode)} ${cpu.lastOperation}`);
  property("NMI pending", cpu.nmiPending);
  property("IRQ line", cpu.irqLine);

  section("PPU");
  property("Frame", ppu.frame);
  property("Scanline", ppu.scanline);
  property("Dot", ppu.cycle);
  property("CTRL", hex(ppu.ctrl));
  property("MASK", hex(ppu.mask));
  property("STATUS", hex(ppu.status));
  property("VRAM address", hex(ppu.v, 4));
  property("Temp address", hex(ppu.t, 4));
  property("Fine X", ppu.fineX);
  property("OAM address", hex(ppu.oamAddress));

  section("APU");
  property("Frame cycle", apu.frameCycle);
  property("Frame IRQ", apu.frameIrq);
  property("DMC IRQ", apu.dmc.irqPending);
  property("Pulse 1 length", apu.pulse1.length);
  property("Pulse 2 length", apu.pulse2.length);
  property("Triangle length", apu.triangle.length);
  property("Noise length", apu.noise.length);
  property("DMC bytes remaining", apu.dmc.bytesRemaining);

  section("MAPPER STATE");
  lines.push(mapperState(cartridge.mapper));

  section("RECENT EVENTS");
  if (!diagnostics.events.length) lines.push("(none)");
  for (const event of diagnostics.events) {
    lines.push(
      `+${event.elapsedMs.toFixed(1).padStart(9)}ms  ${event.type.padEnd(8)} ${event.message}`,
    );
    if (event.details) lines.push(event.details);
  }

  section("RECENT FRAME TIMING");
  lines.push("FRAME     CPU CYCLES   HOST MS   INSTRUCTIONS   AUDIO SAMPLES");
  for (const frame of diagnostics.frames) {
    lines.push(
      `${String(frame.frame).padStart(6)}  ` +
      `${String(frame.cpuCycles).padStart(12)}  ` +
      `${frame.durationMs.toFixed(3).padStart(8)}  ` +
      `${String(frame.instructions).padStart(13)}  ` +
      `${String(frame.audioSamples).padStart(13)}`,
    );
  }

  section("SAMPLED CPU EXECUTION");
  lines.push("CPU CYCLE     PC     OP  INSTRUCTION  A   X   Y   SP  P         PPU       IRQ");
  for (const sample of diagnostics.cpuSamples()) {
    lines.push(
      `${String(sample.cycle).padStart(11)}  ` +
      `${hex(sample.pc, 4)}  ${hex(sample.opcode)}  ` +
      `${String(sample.operation).padEnd(11)} ` +
      `${hex(sample.a).slice(1)}  ${hex(sample.x).slice(1)}  ${hex(sample.y).slice(1)}  ` +
      `${hex(sample.sp).slice(1)}  ${flags(sample.p)}  ` +
      `${String(sample.scanline).padStart(3)},${String(sample.dot).padStart(3)}  ` +
      `${sample.irqSource}`,
    );
  }

  section("CPU RAM (2 KB)");
  lines.push(hexdump(nes.ram, 0));

  section("PPU PALETTE");
  lines.push(hexdump(ppu.palette, 0x3f00));

  section("CHECKSUMS");
  property("CPU RAM CRC32", crc32(nes.ram).toString(16).toUpperCase().padStart(8, "0"));
  property("PRG RAM CRC32", crc32(cartridge.prgRam).toString(16).toUpperCase().padStart(8, "0"));
  property("Nametable CRC32", crc32(ppu.nametable).toString(16).toUpperCase().padStart(8, "0"));
  property("OAM CRC32", crc32(ppu.oam).toString(16).toUpperCase().padStart(8, "0"));

  lines.push("", "END OF LOG", "");
  return lines.join("\n");
}

export function buildStartupFailureLog(romData, name, error, context = {}) {
  const bytes = romData instanceof Uint8Array ? romData : new Uint8Array(romData);
  const validHeader =
    bytes.length >= 16 &&
    bytes[0] === 0x4e &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x53 &&
    bytes[3] === 0x1a;
  const mapper = validHeader ? (bytes[6] >>> 4) | (bytes[7] & 0xf0) : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";
  return [
    "8-BIT CONTROL DECK STARTUP FAILURE LOG",
    `Generated: ${new Date().toISOString()}`,
    "Format version: 1",
    "ROM bytes included: No",
    "",
    "=== CARTRIDGE FILE ===",
    `Name: ${name}`,
    `Library file: ${context.file ?? "(external file)"}`,
    `File size: ${bytes.length} bytes`,
    `File CRC32: ${crc32(bytes).toString(16).toUpperCase().padStart(8, "0")}`,
    `Valid iNES header: ${validHeader}`,
    `Header format: ${validHeader && (bytes[7] & 0x0c) === 0x08 ? "NES 2.0" : validHeader ? "iNES" : "unknown"}`,
    `Mapper: ${mapper}`,
    `PRG banks: ${validHeader ? bytes[4] : "unknown"}`,
    `CHR banks: ${validHeader ? bytes[5] : "unknown"}`,
    "",
    "=== FAILURE ===",
    `Message: ${message}`,
    stack || "(no stack trace)",
    "",
    "=== HOST ===",
    `User agent: ${context.userAgent ?? "unknown"}`,
    `Viewport: ${context.viewport ?? "unknown"}`,
    `Device pixel ratio: ${context.devicePixelRatio ?? "unknown"}`,
    `Audio context: ${context.audioState ?? "unavailable"}`,
    `Audio backend: ${context.audioBackend ?? "unknown"}`,
    `Audio sample rate: ${context.audioSampleRate ?? "unknown"}`,
    `Audio underruns: ${context.audioUnderruns ?? "unknown"}`,
    `Audio overflows: ${context.audioOverflows ?? "unknown"}`,
    "",
    "END OF LOG",
    "",
  ].join("\n");
}

export { crc32 };
