import { APU } from "./apu.js";
import { Cartridge } from "./cartridge.js";
import { Controller } from "./controller.js";
import { CPU } from "./cpu.js";
import { DiagnosticRecorder } from "./diagnostics.js";
import { PPU } from "./ppu.js";

export class NES {
  constructor(romData, name = "game.nes", sampleRate = 44100) {
    this.ram = new Uint8Array(0x800);
    this.controllers = [new Controller(), new Controller()];
    this.cartridge = new Cartridge(romData, name);
    this.dmaStall = 0;
    this.dmcStall = 0;
    this.openBus = 0;
    this.zapper = { x: -1, y: -1, trigger: false };
    this.diagnostics = new DiagnosticRecorder();
    this.cpu = null;
    this.ppu = new PPU(this.cartridge, () => this.cpu?.requestNmi());
    this.apu = new APU((address) => this.readDmc(address), sampleRate);
    this.cpu = new CPU(this);
    this.reset();
    this.diagnostics.recordEvent("SYSTEM", "Cartridge loaded", `${name}; mapper ${this.cartridge.mapperId}`);
  }

  reset() {
    this.ppu.reset();
    this.apu.reset();
    this.dmaStall = 0;
    this.dmcStall = 0;
    this.cpu.reset();
    this.diagnostics?.recordEvent("SYSTEM", "Reset");
  }

  readDmc(address) {
    this.dmcStall += 4;
    if (address >= 0x4020) return this.cartridge.cpuRead(address);
    if (address < 0x2000) return this.ram[address & 0x7ff];
    return 0;
  }

  read(address) {
    address &= 0xffff;
    let value = this.openBus;
    if (address < 0x2000) {
      value = this.ram[address & 0x7ff];
    } else if (address < 0x4000) {
      value = this.ppu.cpuRead(address & 7);
    } else if (address === 0x4015) {
      value = this.apu.readStatus();
    } else if (address === 0x4016) {
      value = this.controllers[0].read();
    } else if (address === 0x4017) {
      value = this.controllers[1].read() | this.readZapper();
    } else if (address >= 0x4020) {
      value = this.cartridge.cpuRead(address);
    }
    this.openBus = value;
    return value;
  }

  write(address, value) {
    address &= 0xffff;
    value &= 0xff;
    this.openBus = value;
    if (address < 0x2000) {
      this.ram[address & 0x7ff] = value;
    } else if (address < 0x4000) {
      this.ppu.cpuWrite(address & 7, value);
    } else if (address === 0x4014) {
      const page = value << 8;
      for (let i = 0; i < 256; i++) this.ppu.dmaWrite(this.read(page | i));
      this.dmaStall += 513;
    } else if (address === 0x4016) {
      this.controllers[0].write(value);
      this.controllers[1].write(value);
    } else if (
      (address >= 0x4000 && address <= 0x4013) ||
      address === 0x4015 ||
      address === 0x4017
    ) {
      this.apu.write(address, value);
    } else if (address >= 0x4020) {
      this.cartridge.cpuWrite(address, value);
    }
  }

  takeDmaStall(cycle) {
    let stall = this.dmcStall;
    this.dmcStall = 0;
    if (!this.dmaStall) return stall;
    stall += this.dmaStall + (cycle & 1);
    this.dmaStall = 0;
    return stall;
  }

  clockCpuCycles(cycles) {
    for (let i = 0; i < cycles; i++) {
      this.apu.clock();
      this.cartridge.clockCpu();
      this.ppu.clock();
      this.ppu.clock();
      this.ppu.clock();
    }
  }

  runFrame() {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const startingCycles = this.cpu.totalCycles;
    this.ppu.frameComplete = false;
    let instructionGuard = 0;
    while (!this.ppu.frameComplete) {
      const irqSource = (this.apu.irqPending ? 1 : 0) | (this.cartridge.irqPending ? 2 : 0);
      this.cpu.setIrq(irqSource !== 0);
      const cycles = this.cpu.step();
      this.clockCpuCycles(cycles);
      if ((instructionGuard & 0x3ff) === 0) {
        this.diagnostics.recordCpu(this.cpu, this.ppu, irqSource);
      }
      if (++instructionGuard > 200000) throw new Error("Emulation frame did not complete");
    }
    const audio = this.apu.drainSamples();
    const endedAt = globalThis.performance?.now?.() ?? Date.now();
    this.diagnostics.recordFrame(
      this.ppu.frame,
      this.cpu.totalCycles - startingCycles,
      endedAt - startedAt,
      instructionGuard,
      audio.length,
    );
    return {
      pixels: this.ppu.framebuffer,
      audio,
      frame: this.ppu.frame,
    };
  }

  setButton(player, button, pressed) {
    this.controllers[player]?.setButton(button, pressed);
  }

  setZapper(x, y, trigger = this.zapper.trigger) {
    this.zapper.x = x;
    this.zapper.y = y;
    this.zapper.trigger = trigger;
  }

  readZapper() {
    const { x, y, trigger } = this.zapper;
    let light = false;
    if (x >= 0 && x < 256 && y >= 0 && y < 240) {
      for (let py = Math.max(0, y - 4); py <= Math.min(239, y + 4) && !light; py++) {
        for (let px = Math.max(0, x - 4); px <= Math.min(255, x + 4); px++) {
          const offset = (py * 256 + px) * 4;
          const luminance =
            this.ppu.framebuffer[offset] * 0.299 +
            this.ppu.framebuffer[offset + 1] * 0.587 +
            this.ppu.framebuffer[offset + 2] * 0.114;
          if (luminance > 160) {
            light = true;
            break;
          }
        }
      }
    }
    return (light ? 0 : 0x08) | (trigger ? 0x10 : 0);
  }
}
