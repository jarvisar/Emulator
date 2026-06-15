export const Mirroring = Object.freeze({
  HORIZONTAL: 0,
  VERTICAL: 1,
  SINGLE_0: 2,
  SINGLE_1: 3,
  FOUR_SCREEN: 4,
});

function wrap(value, size) {
  return size ? ((value % size) + size) % size : 0;
}

class Mapper {
  constructor(cartridge) {
    this.cart = cartridge;
    this.irqPending = false;
  }

  cpuRead(address) {
    if (address >= 0x6000 && address < 0x8000) {
      return this.cart.prgRam[address & 0x1fff];
    }
    if (address >= 0x8000) {
      return this.cart.prgRom[wrap(address - 0x8000, this.cart.prgRom.length)];
    }
    return 0;
  }

  cpuWrite(address, value) {
    if (address >= 0x6000 && address < 0x8000) {
      this.cart.prgRam[address & 0x1fff] = value;
      this.cart.saveDirty = true;
    }
  }

  ppuRead(address) {
    return this.cart.chr[wrap(address, this.cart.chr.length)];
  }

  ppuWrite(address, value) {
    if (this.cart.chrRam) this.cart.chr[wrap(address, this.cart.chr.length)] = value;
  }

  clockScanline() {}

  clockCpu() {}

  readNametable() {
    return null;
  }

  writeNametable() {
    return false;
  }

  selectBackgroundTile() {}

  backgroundAttribute(_address, value) {
    return value;
  }
}

class Mapper0 extends Mapper {
  cpuRead(address) {
    if (address < 0x8000) return super.cpuRead(address);
    const offset = address - 0x8000;
    return this.cart.prgRom[this.cart.prgRom.length === 0x4000 ? offset & 0x3fff : offset];
  }
}

class Mapper1 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.shift = 0x10;
    this.control = 0x0c;
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.prgBank = 0;
    this.updateMirroring();
  }

  updateMirroring() {
    this.cart.mirroring = [
      Mirroring.SINGLE_0,
      Mirroring.SINGLE_1,
      Mirroring.VERTICAL,
      Mirroring.HORIZONTAL,
    ][this.control & 3];
  }

  cpuRead(address) {
    if (address < 0x6000) return 0;
    if (address < 0x8000) {
      return this.cart.prgRam[address & 0x1fff];
    }
    const bankCount = Math.max(1, this.cart.prgRom.length >>> 14);
    const mode = (this.control >>> 2) & 3;
    let bank;
    let offset = address & 0x3fff;
    if (mode <= 1) {
      bank = (this.prgBank & 0x0e) + ((address - 0x8000) >>> 14);
    } else if (mode === 2) {
      bank = address < 0xc000 ? 0 : this.prgBank;
    } else {
      bank = address < 0xc000 ? this.prgBank : bankCount - 1;
    }
    return this.cart.prgRom[wrap(bank, bankCount) * 0x4000 + offset];
  }

  cpuWrite(address, value) {
    if (address < 0x8000) {
      super.cpuWrite(address, value);
      return;
    }
    if (value & 0x80) {
      this.shift = 0x10;
      this.control |= 0x0c;
      this.updateMirroring();
      return;
    }
    const complete = this.shift & 1;
    this.shift = (this.shift >>> 1) | ((value & 1) << 4);
    if (!complete) return;
    const register = (address >>> 13) & 3;
    if (register === 0) {
      this.control = this.shift;
      this.updateMirroring();
    } else if (register === 1) {
      this.chrBank0 = this.shift;
    } else if (register === 2) {
      this.chrBank1 = this.shift;
    } else {
      this.prgBank = this.shift & 0x0f;
    }
    this.shift = 0x10;
  }

  chrAddress(address) {
    const banks = Math.max(1, this.cart.chr.length >>> 12);
    if (this.control & 0x10) {
      const bank = address < 0x1000 ? this.chrBank0 : this.chrBank1;
      return wrap(bank, banks) * 0x1000 + (address & 0x0fff);
    }
    const bank = (this.chrBank0 & 0x1e) + (address >>> 12);
    return wrap(bank, banks) * 0x1000 + (address & 0x0fff);
  }

  ppuRead(address) {
    return this.cart.chr[this.chrAddress(address)];
  }

  ppuWrite(address, value) {
    if (this.cart.chrRam) this.cart.chr[this.chrAddress(address)] = value;
  }
}

class Mapper105 extends Mapper1 {
  constructor(cartridge) {
    super(cartridge);
    this.chrBank0 |= 0x10;
    this.initState = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.updateEventState();
  }

  updateEventState() {
    if (this.initState === 0 && (this.chrBank0 & 0x10) === 0) {
      this.initState = 1;
    } else if (this.initState === 1 && (this.chrBank0 & 0x10) !== 0) {
      this.initState = 2;
    }
    if (this.chrBank0 & 0x10) {
      this.irqEnabled = false;
      this.irqCounter = 0;
      this.irqPending = false;
    } else {
      this.irqEnabled = true;
    }
  }

  selectedPrgBanks() {
    if (this.initState !== 2) return [0, 1];
    if ((this.chrBank0 & 0x08) === 0) {
      const base = this.chrBank0 & 0x06;
      return [base, base + 1];
    }
    const prg = (this.prgBank & 7) | 8;
    const mode = (this.control >>> 2) & 3;
    if (mode <= 1) return [prg & 0x0e, (prg & 0x0e) + 1];
    if (mode === 2) return [8, prg];
    return [prg, 15];
  }

  cpuRead(address) {
    if (address >= 0x6000 && address < 0x8000) {
      return this.cart.prgRam[address & 0x1fff];
    }
    if (address < 0x8000) return 0;
    const banks = this.selectedPrgBanks();
    const bankCount = this.cart.prgRom.length >>> 14;
    const bank = address < 0xc000 ? banks[0] : banks[1];
    return this.cart.prgRom[wrap(bank, bankCount) * 0x4000 + (address & 0x3fff)];
  }

  cpuWrite(address, value) {
    if (address < 0x8000) {
      if (address >= 0x6000 && !(this.prgBank & 0x10)) super.cpuWrite(address, value);
      return;
    }
    if (value & 0x80) {
      this.shift = 0x10;
      this.control |= 0x0c;
      this.updateMirroring();
      this.updateEventState();
      return;
    }
    const complete = this.shift & 1;
    this.shift = (this.shift >>> 1) | ((value & 1) << 4);
    if (!complete) return;
    const register = (address >>> 13) & 3;
    if (register === 0) {
      this.control = this.shift;
      this.updateMirroring();
    } else if (register === 1) {
      this.chrBank0 = this.shift;
    } else if (register === 2) {
      this.chrBank1 = this.shift;
    } else {
      this.prgBank = this.shift;
    }
    this.shift = 0x10;
    this.updateEventState();
  }

  clockCpu(cycles = 1) {
    if (!this.irqEnabled) return;
    this.irqCounter += cycles;
    if (this.irqCounter >= 0x20000000) {
      this.irqPending = true;
      this.irqEnabled = false;
    }
  }
}

class Mapper2 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.bank = 0;
  }

  cpuRead(address) {
    if (address < 0x8000) return super.cpuRead(address);
    const count = this.cart.prgRom.length >>> 14;
    const bank = address < 0xc000 ? wrap(this.bank, count) : count - 1;
    return this.cart.prgRom[bank * 0x4000 + (address & 0x3fff)];
  }

  cpuWrite(address, value) {
    if (address >= 0x8000) this.bank = value & 0x0f;
    else super.cpuWrite(address, value);
  }
}

class Mapper3 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.chrBank = 0;
  }

  cpuWrite(address, value) {
    if (address >= 0x8000) this.chrBank = value;
    else super.cpuWrite(address, value);
  }

  ppuRead(address) {
    const count = Math.max(1, this.cart.chr.length >>> 13);
    return this.cart.chr[wrap(this.chrBank, count) * 0x2000 + address];
  }
}

class Mapper4 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.bankSelect = 0;
    this.bankRegisters = new Uint8Array(8);
    this.prgMode = 0;
    this.chrMode = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.prgRamEnabled = true;
  }

  cpuRead(address) {
    if (address >= 0x6000 && address < 0x8000) {
      return this.prgRamEnabled ? this.cart.prgRam[address & 0x1fff] : 0;
    }
    if (address < 0x8000) return 0;
    const count = this.cart.prgRom.length >>> 13;
    const last = count - 1;
    const secondLast = Math.max(0, count - 2);
    const slot = (address - 0x8000) >>> 13;
    let bank;
    if (slot === 0) bank = this.prgMode ? secondLast : this.bankRegisters[6];
    else if (slot === 1) bank = this.bankRegisters[7];
    else if (slot === 2) bank = this.prgMode ? this.bankRegisters[6] : secondLast;
    else bank = last;
    return this.cart.prgRom[wrap(bank, count) * 0x2000 + (address & 0x1fff)];
  }

  cpuWrite(address, value) {
    if (address < 0x8000) {
      if (address >= 0x6000 && this.prgRamEnabled) super.cpuWrite(address, value);
      return;
    }
    const even = (address & 1) === 0;
    switch (address & 0xe000) {
      case 0x8000:
        if (even) {
          this.bankSelect = value & 7;
          this.prgMode = (value >>> 6) & 1;
          this.chrMode = (value >>> 7) & 1;
        } else {
          this.bankRegisters[this.bankSelect] = value;
        }
        break;
      case 0xa000:
        if (even && this.cart.headerMirroring !== Mirroring.FOUR_SCREEN) {
          this.cart.mirroring = value & 1 ? Mirroring.HORIZONTAL : Mirroring.VERTICAL;
        } else if (!even) {
          this.prgRamEnabled = (value & 0x80) !== 0;
        }
        break;
      case 0xc000:
        if (even) this.irqLatch = value;
        else this.irqReload = true;
        break;
      case 0xe000:
        if (even) {
          this.irqEnabled = false;
          this.irqPending = false;
        } else {
          this.irqEnabled = true;
        }
        break;
    }
  }

  chrBankForSlot(slot) {
    const r = this.bankRegisters;
    const table = this.chrMode
      ? [r[2], r[3], r[4], r[5], r[0] & 0xfe, r[0] | 1, r[1] & 0xfe, r[1] | 1]
      : [r[0] & 0xfe, r[0] | 1, r[1] & 0xfe, r[1] | 1, r[2], r[3], r[4], r[5]];
    return table[slot];
  }

  chrAddress(address) {
    const count = Math.max(1, this.cart.chr.length >>> 10);
    const slot = address >>> 10;
    return wrap(this.chrBankForSlot(slot), count) * 0x400 + (address & 0x3ff);
  }

  ppuRead(address) {
    return this.cart.chr[this.chrAddress(address)];
  }

  ppuWrite(address, value) {
    if (this.cart.chrRam) this.cart.chr[this.chrAddress(address)] = value;
  }

  clockScanline() {
    if (this.irqCounter === 0 || this.irqReload) {
      this.irqCounter = this.irqLatch;
      this.irqReload = false;
    } else {
      this.irqCounter--;
    }
    if (this.irqCounter === 0 && this.irqEnabled) this.irqPending = true;
  }
}

class Mapper5 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.prgMode = 3;
    this.chrMode = 3;
    this.prgProtect1 = 0;
    this.prgProtect2 = 0;
    this.exramMode = 0;
    this.nametableMap = 0;
    this.fillTile = 0;
    this.fillAttribute = 0;
    this.prgRamBank = 0;
    this.prgBanks = new Uint8Array([0, 0, 0, 0xff]);
    this.chrBanks = new Uint16Array(8);
    this.bgChrBanks = new Uint16Array(4);
    this.chrUpper = 0;
    this.exram = new Uint8Array(0x400);
    this.irqScanline = 0;
    this.irqEnabled = false;
    this.irqStatus = false;
    this.inFrame = false;
    this.multiplyA = 0;
    this.multiplyB = 0;
    this.extendedAttribute = 0;
  }

  ramWritable() {
    return this.prgProtect1 === 2 && this.prgProtect2 === 1;
  }

  readPrgBank(bank, offset) {
    if (bank & 0x80) {
      const count = this.cart.prgRom.length >>> 13;
      return this.cart.prgRom[wrap(bank & 0x7f, count) * 0x2000 + offset];
    }
    const count = this.cart.prgRam.length >>> 13;
    return this.cart.prgRam[wrap(bank & 0x0f, count) * 0x2000 + offset];
  }

  prgBankForAddress(address) {
    const slot = (address - 0x8000) >>> 13;
    if (this.prgMode === 3) return this.prgBanks[slot];
    if (this.prgMode === 2) {
      if (slot < 2) return (this.prgBanks[1] & 0xfe) | (slot & 1);
      return slot === 2 ? this.prgBanks[2] : this.prgBanks[3];
    }
    if (this.prgMode === 1) {
      const source = slot < 2 ? this.prgBanks[1] : this.prgBanks[3];
      return (source & 0xfe) | (slot & 1);
    }
    return (this.prgBanks[3] & 0xfc) | slot;
  }

  cpuRead(address) {
    if (address >= 0x5c00 && address < 0x6000) return this.exram[address & 0x3ff];
    if (address === 0x5204) {
      const value = (this.irqStatus ? 0x80 : 0) | (this.inFrame ? 0x40 : 0);
      this.irqStatus = false;
      this.irqPending = false;
      return value;
    }
    if (address === 0x5205) return (this.multiplyA * this.multiplyB) & 0xff;
    if (address === 0x5206) return (this.multiplyA * this.multiplyB) >>> 8;
    if (address >= 0x6000 && address < 0x8000) {
      const count = this.cart.prgRam.length >>> 13;
      return this.cart.prgRam[wrap(this.prgRamBank, count) * 0x2000 + (address & 0x1fff)];
    }
    if (address >= 0x8000) {
      return this.readPrgBank(this.prgBankForAddress(address), address & 0x1fff);
    }
    return 0;
  }

  cpuWrite(address, value) {
    if (address >= 0x5c00 && address < 0x6000) {
      if (this.exramMode !== 3) this.exram[address & 0x3ff] = value;
      return;
    }
    if (address >= 0x6000 && address < 0x8000) {
      if (this.ramWritable()) {
        const count = this.cart.prgRam.length >>> 13;
        const index = wrap(this.prgRamBank, count) * 0x2000 + (address & 0x1fff);
        this.cart.prgRam[index] = value;
        this.cart.saveDirty = true;
      }
      return;
    }
    if (address >= 0x8000) {
      const bank = this.prgBankForAddress(address);
      if (!(bank & 0x80) && this.ramWritable()) {
        const count = this.cart.prgRam.length >>> 13;
        const index = wrap(bank & 0x0f, count) * 0x2000 + (address & 0x1fff);
        this.cart.prgRam[index] = value;
        this.cart.saveDirty = true;
      }
      return;
    }
    switch (address) {
      case 0x5100: this.prgMode = value & 3; break;
      case 0x5101: this.chrMode = value & 3; break;
      case 0x5102: this.prgProtect1 = value & 3; break;
      case 0x5103: this.prgProtect2 = value & 3; break;
      case 0x5104: this.exramMode = value & 3; break;
      case 0x5105: this.nametableMap = value; break;
      case 0x5106: this.fillTile = value; break;
      case 0x5107: this.fillAttribute = value & 3; break;
      case 0x5113: this.prgRamBank = value & 7; break;
      case 0x5114:
      case 0x5115:
      case 0x5116:
      case 0x5117:
        this.prgBanks[address - 0x5114] = address === 0x5117 ? value | 0x80 : value;
        break;
      case 0x5130: this.chrUpper = (value & 3) << 8; break;
      case 0x5203: this.irqScanline = value; break;
      case 0x5204:
        this.irqEnabled = (value & 0x80) !== 0;
        if (!this.irqEnabled) this.irqPending = false;
        break;
      case 0x5205: this.multiplyA = value; break;
      case 0x5206: this.multiplyB = value; break;
      default:
        if (address >= 0x5120 && address <= 0x5127) {
          this.chrBanks[address - 0x5120] = this.chrUpper | value;
        } else if (address >= 0x5128 && address <= 0x512b) {
          this.bgChrBanks[address - 0x5128] = this.chrUpper | value;
        }
        break;
    }
  }

  chrBankForAddress(address, kind) {
    const slot = address >>> 10;
    const background = kind === "background";
    const registers = background ? this.bgChrBanks : this.chrBanks;
    const registerSlot = background ? slot & 3 : slot;
    if (this.chrMode === 3) return registers[registerSlot];
    if (this.chrMode === 2) {
      const sourceSlot = background ? (registerSlot & 2) | 1 : (slot & 6) | 1;
      const source = registers[sourceSlot];
      return (source & ~1) | (slot & 1);
    }
    if (this.chrMode === 1) {
      const sourceSlot = background ? 3 : (slot & 4) | 3;
      const source = registers[sourceSlot];
      return (source & ~3) | (slot & 3);
    }
    return (registers[background ? 3 : 7] & ~7) | slot;
  }

  chrAddress(address, kind) {
    if (kind === "background" && this.exramMode === 1) {
      const count4k = Math.max(1, this.cart.chr.length >>> 12);
      const bank = this.extendedAttribute & 0x3f;
      return wrap(bank, count4k) * 0x1000 + (address & 0xfff);
    }
    const count = Math.max(1, this.cart.chr.length >>> 10);
    return wrap(this.chrBankForAddress(address, kind), count) * 0x400 + (address & 0x3ff);
  }

  ppuRead(address, kind) {
    return this.cart.chr[this.chrAddress(address, kind)];
  }

  ppuWrite(address, value) {
    if (this.cart.chrRam) this.cart.chr[this.chrAddress(address, null)] = value;
  }

  readNametable(table, offset, internal) {
    const mode = (this.nametableMap >>> (table * 2)) & 3;
    if (mode === 0) return internal[offset];
    if (mode === 1) return internal[0x400 + offset];
    if (mode === 2) return this.exramMode <= 1 ? this.exram[offset] : 0;
    if (offset < 0x3c0) return this.fillTile;
    return this.fillAttribute * 0x55;
  }

  writeNametable(table, offset, value, internal) {
    const mode = (this.nametableMap >>> (table * 2)) & 3;
    if (mode === 0) internal[offset] = value;
    else if (mode === 1) internal[0x400 + offset] = value;
    else if (mode === 2 && this.exramMode !== 3) this.exram[offset] = value;
    return true;
  }

  selectBackgroundTile(address) {
    if (this.exramMode === 1) this.extendedAttribute = this.exram[address & 0x3ff];
  }

  backgroundAttribute(_address, value) {
    return this.exramMode === 1 ? this.extendedAttribute >>> 6 : value;
  }

  clockScanline(scanline) {
    this.inFrame = true;
    if (scanline === this.irqScanline) {
      this.irqStatus = true;
      if (this.irqEnabled) this.irqPending = true;
    }
  }
}

class Mapper7 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.bank = 0;
  }

  cpuRead(address) {
    if (address < 0x8000) return super.cpuRead(address);
    const count = this.cart.prgRom.length >>> 15;
    return this.cart.prgRom[wrap(this.bank, count) * 0x8000 + (address & 0x7fff)];
  }

  cpuWrite(address, value) {
    if (address >= 0x8000) {
      this.bank = value & 7;
      this.cart.mirroring = value & 0x10 ? Mirroring.SINGLE_1 : Mirroring.SINGLE_0;
    } else {
      super.cpuWrite(address, value);
    }
  }
}

class Mapper9 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.prgBank = 0;
    this.chrFd0 = 0;
    this.chrFe0 = 0;
    this.chrFd1 = 0;
    this.chrFe1 = 0;
    this.latch0 = 0xfe;
    this.latch1 = 0xfe;
  }

  cpuRead(address) {
    if (address < 0x8000) return super.cpuRead(address);
    const count = this.cart.prgRom.length >>> 13;
    let bank;
    if (address < 0xa000) bank = this.prgBank;
    else if (address < 0xc000) bank = count - 3;
    else if (address < 0xe000) bank = count - 2;
    else bank = count - 1;
    return this.cart.prgRom[wrap(bank, count) * 0x2000 + (address & 0x1fff)];
  }

  cpuWrite(address, value) {
    if (address < 0xa000) {
      super.cpuWrite(address, value);
      return;
    }
    switch (address & 0xf000) {
      case 0xa000: this.prgBank = value & 0x0f; break;
      case 0xb000: this.chrFd0 = value & 0x1f; break;
      case 0xc000: this.chrFe0 = value & 0x1f; break;
      case 0xd000: this.chrFd1 = value & 0x1f; break;
      case 0xe000: this.chrFe1 = value & 0x1f; break;
      case 0xf000:
        this.cart.mirroring = value & 1 ? Mirroring.HORIZONTAL : Mirroring.VERTICAL;
        break;
    }
  }

  ppuRead(address) {
    const count = Math.max(1, this.cart.chr.length >>> 12);
    const bank = address < 0x1000
      ? (this.latch0 === 0xfd ? this.chrFd0 : this.chrFe0)
      : (this.latch1 === 0xfd ? this.chrFd1 : this.chrFe1);
    const value = this.cart.chr[wrap(bank, count) * 0x1000 + (address & 0xfff)];
    const masked = address & 0x1ff8;
    if (masked === 0x0fd8) this.latch0 = 0xfd;
    else if (masked === 0x0fe8) this.latch0 = 0xfe;
    else if (masked === 0x1fd8) this.latch1 = 0xfd;
    else if (masked === 0x1fe8) this.latch1 = 0xfe;
    return value;
  }
}

class Mapper13 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.chrBank = 0;
  }

  cpuWrite(address, value) {
    if (address >= 0x8000) this.chrBank = value & 3;
    else super.cpuWrite(address, value);
  }

  chrAddress(address) {
    if (address < 0x1000) return address;
    return this.chrBank * 0x1000 + (address & 0xfff);
  }

  ppuRead(address) {
    return this.cart.chr[this.chrAddress(address)];
  }

  ppuWrite(address, value) {
    this.cart.chr[this.chrAddress(address)] = value;
  }
}

class Mapper19 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.chrBanks = new Uint8Array(8);
    this.nametableBanks = new Uint8Array([0xe0, 0xe1, 0xe0, 0xe1]);
    this.prgBanks = new Uint8Array(3);
    this.irqCounter = 0;
    this.irqEnabled = false;
  }

  cpuRead(address) {
    if (address === 0x5000) return this.irqCounter & 0xff;
    if (address === 0x5800) return (this.irqCounter >>> 8) | (this.irqEnabled ? 0x80 : 0);
    if (address >= 0x6000 && address < 0x8000) return this.cart.prgRam[address & 0x1fff];
    if (address < 0x8000) return 0;
    const count = this.cart.prgRom.length >>> 13;
    const slot = (address - 0x8000) >>> 13;
    const bank = slot < 3 ? this.prgBanks[slot] : count - 1;
    return this.cart.prgRom[wrap(bank, count) * 0x2000 + (address & 0x1fff)];
  }

  cpuWrite(address, value) {
    if (address === 0x5000) {
      this.irqCounter = (this.irqCounter & 0x7f00) | value;
      this.irqPending = false;
    } else if (address === 0x5800) {
      this.irqCounter = (this.irqCounter & 0xff) | ((value & 0x7f) << 8);
      this.irqEnabled = (value & 0x80) !== 0;
      this.irqPending = false;
    } else if (address >= 0x6000 && address < 0x8000) {
      super.cpuWrite(address, value);
    } else if (address >= 0x8000 && address < 0xc000) {
      this.chrBanks[(address - 0x8000) >>> 11] = value;
    } else if (address >= 0xc000 && address < 0xe000) {
      this.nametableBanks[(address - 0xc000) >>> 11] = value;
    } else if (address >= 0xe000 && address < 0xf800) {
      this.prgBanks[(address - 0xe000) >>> 11] = value & 0x3f;
    }
  }

  ppuRead(address) {
    const count = Math.max(1, this.cart.chr.length >>> 10);
    const bank = this.chrBanks[address >>> 10];
    return this.cart.chr[wrap(bank, count) * 0x400 + (address & 0x3ff)];
  }

  readNametable(table, offset, internal) {
    const bank = this.nametableBanks[table];
    if (bank >= 0xe0) return internal[(bank & 1) * 0x400 + offset];
    const count = Math.max(1, this.cart.chr.length >>> 10);
    return this.cart.chr[wrap(bank, count) * 0x400 + offset];
  }

  writeNametable(table, offset, value, internal) {
    const bank = this.nametableBanks[table];
    if (bank >= 0xe0) internal[(bank & 1) * 0x400 + offset] = value;
    return true;
  }

  clockCpu(cycles = 1) {
    if (!this.irqEnabled) return;
    this.irqCounter = Math.min(0x7fff, this.irqCounter + cycles);
    if (this.irqCounter === 0x7fff) this.irqPending = true;
  }
}

class Mapper34 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.prgBank = 0;
    this.chrBank0 = 0;
    this.chrBank1 = 1;
  }

  cpuRead(address) {
    if (address < 0x8000) return super.cpuRead(address);
    const count = this.cart.prgRom.length >>> 15;
    return this.cart.prgRom[wrap(this.prgBank, count) * 0x8000 + (address & 0x7fff)];
  }

  cpuWrite(address, value) {
    if (address === 0x7ffd) this.prgBank = value;
    else if (address === 0x7ffe) this.chrBank0 = value;
    else if (address === 0x7fff) this.chrBank1 = value;
    else if (address >= 0x8000) this.prgBank = value;
    else super.cpuWrite(address, value);
  }

  chrAddress(address) {
    const count = Math.max(1, this.cart.chr.length >>> 12);
    const bank = address < 0x1000 ? this.chrBank0 : this.chrBank1;
    return wrap(bank, count) * 0x1000 + (address & 0xfff);
  }

  ppuRead(address) {
    return this.cart.chr[this.chrAddress(address)];
  }
}

class Mapper66 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.prgBank = 0;
    this.chrBank = 0;
  }

  cpuRead(address) {
    if (address < 0x8000) return super.cpuRead(address);
    const count = this.cart.prgRom.length >>> 15;
    return this.cart.prgRom[wrap(this.prgBank, count) * 0x8000 + (address & 0x7fff)];
  }

  cpuWrite(address, value) {
    if (address >= 0x8000) {
      this.prgBank = (value >>> 4) & 3;
      this.chrBank = value & 3;
    } else {
      super.cpuWrite(address, value);
    }
  }

  ppuRead(address) {
    const count = Math.max(1, this.cart.chr.length >>> 13);
    return this.cart.chr[wrap(this.chrBank, count) * 0x2000 + address];
  }
}

class Mapper69 extends Mapper {
  constructor(cartridge) {
    super(cartridge);
    this.command = 0;
    this.chrBanks = new Uint8Array(8);
    this.prgBanks = new Uint8Array(4);
    this.ramSelect = false;
    this.ramEnabled = false;
    this.irqEnabled = false;
    this.irqCounterEnabled = false;
    this.irqCounter = 0;
  }

  cpuRead(address) {
    const count = this.cart.prgRom.length >>> 13;
    if (address >= 0x6000 && address < 0x8000) {
      if (this.ramSelect) return this.ramEnabled ? this.cart.prgRam[address & 0x1fff] : 0;
      return this.cart.prgRom[wrap(this.prgBanks[0], count) * 0x2000 + (address & 0x1fff)];
    }
    if (address < 0x8000) return 0;
    const slot = (address - 0x8000) >>> 13;
    const bank = slot < 3 ? this.prgBanks[slot + 1] : count - 1;
    return this.cart.prgRom[wrap(bank, count) * 0x2000 + (address & 0x1fff)];
  }

  cpuWrite(address, value) {
    if (address >= 0x6000 && address < 0x8000 && this.ramSelect && this.ramEnabled) {
      super.cpuWrite(address, value);
      return;
    }
    if (address >= 0x8000 && address < 0xa000) {
      this.command = value & 0x0f;
      return;
    }
    if (address < 0xa000 || address >= 0xc000) return;
    if (this.command <= 7) {
      this.chrBanks[this.command] = value;
    } else if (this.command === 8) {
      this.prgBanks[0] = value & 0x3f;
      this.ramSelect = (value & 0x40) !== 0;
      this.ramEnabled = (value & 0x80) !== 0;
    } else if (this.command <= 11) {
      this.prgBanks[this.command - 8] = value & 0x3f;
    } else if (this.command === 12) {
      this.cart.mirroring = [
        Mirroring.VERTICAL,
        Mirroring.HORIZONTAL,
        Mirroring.SINGLE_0,
        Mirroring.SINGLE_1,
      ][value & 3];
    } else if (this.command === 13) {
      this.irqEnabled = (value & 1) !== 0;
      this.irqCounterEnabled = (value & 0x80) !== 0;
      if (!this.irqEnabled) this.irqPending = false;
    } else if (this.command === 14) {
      this.irqCounter = (this.irqCounter & 0xff00) | value;
    } else {
      this.irqCounter = (this.irqCounter & 0x00ff) | (value << 8);
    }
  }

  ppuRead(address) {
    const count = Math.max(1, this.cart.chr.length >>> 10);
    const bank = this.chrBanks[address >>> 10];
    return this.cart.chr[wrap(bank, count) * 0x400 + (address & 0x3ff)];
  }

  clockCpu(cycles = 1) {
    if (!this.irqCounterEnabled) return;
    for (let i = 0; i < cycles; i++) {
      if (this.irqCounter === 0) {
        this.irqCounter = 0xffff;
        if (this.irqEnabled) this.irqPending = true;
      } else {
        this.irqCounter--;
      }
    }
  }
}

const MAPPERS = new Map([
  [0, Mapper0],
  [1, Mapper1],
  [2, Mapper2],
  [3, Mapper3],
  [4, Mapper4],
  [5, Mapper5],
  [7, Mapper7],
  [9, Mapper9],
  [13, Mapper13],
  [19, Mapper19],
  [34, Mapper34],
  [66, Mapper66],
  [69, Mapper69],
  [105, Mapper105],
  [118, Mapper4],
  [119, Mapper4],
  [206, Mapper4],
]);

export class Cartridge {
  constructor(data, name = "game.nes") {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (
      bytes.length < 16 ||
      bytes[0] !== 0x4e ||
      bytes[1] !== 0x45 ||
      bytes[2] !== 0x53 ||
      bytes[3] !== 0x1a
    ) {
      throw new Error("Not a valid iNES ROM");
    }
    this.name = name;
    this.mapperId = (bytes[6] >>> 4) | (bytes[7] & 0xf0);
    this.submapper = 0;
    const nes2 = (bytes[7] & 0x0c) === 0x08;
    let prgUnits = bytes[4];
    let chrUnits = bytes[5];
    if (nes2) {
      this.mapperId |= (bytes[8] & 0x0f) << 8;
      this.submapper = bytes[8] >>> 4;
      prgUnits |= (bytes[9] & 0x0f) << 8;
      chrUnits |= (bytes[9] & 0xf0) << 4;
    }
    const trainerSize = bytes[6] & 0x04 ? 512 : 0;
    const prgSize = prgUnits * 0x4000;
    const chrSize = chrUnits * 0x2000;
    const offset = 16 + trainerSize;
    if (prgSize === 0 || bytes.length < offset + prgSize + chrSize) {
      throw new Error("ROM is truncated or has an invalid header");
    }
    this.prgRom = bytes.slice(offset, offset + prgSize);
    this.chrRam = chrSize === 0;
    this.chr = this.chrRam
      ? new Uint8Array(this.mapperId === 13 ? 0x4000 : 0x2000)
      : bytes.slice(offset + prgSize, offset + prgSize + chrSize);
    const prgRamUnits = bytes[8] || 1;
    this.prgRam = new Uint8Array(
      this.mapperId === 5 ? 0x10000 : Math.max(0x2000, prgRamUnits * 0x2000),
    );
    this.battery = (bytes[6] & 0x02) !== 0;
    this.saveDirty = false;
    this.headerMirroring = bytes[6] & 0x08
      ? Mirroring.FOUR_SCREEN
      : bytes[6] & 1
        ? Mirroring.VERTICAL
        : Mirroring.HORIZONTAL;
    this.mirroring = this.headerMirroring;
    const MapperType = MAPPERS.get(this.mapperId);
    if (!MapperType) {
      throw new Error(`Mapper ${this.mapperId} is not supported`);
    }
    this.mapper = new MapperType(this);
  }

  cpuRead(address) {
    return this.mapper.cpuRead(address & 0xffff);
  }

  cpuWrite(address, value) {
    this.mapper.cpuWrite(address & 0xffff, value & 0xff);
  }

  ppuRead(address, kind = null) {
    return this.mapper.ppuRead(address & 0x1fff, kind);
  }

  ppuWrite(address, value) {
    this.mapper.ppuWrite(address & 0x1fff, value & 0xff);
  }

  clockScanline(scanline) {
    this.mapper.clockScanline(scanline);
  }

  clockCpu(cycles = 1) {
    this.mapper.clockCpu(cycles);
  }

  get irqPending() {
    return this.mapper.irqPending;
  }

  clearIrq() {
    this.mapper.irqPending = false;
  }

  readNametable(table, offset, internal) {
    return this.mapper.readNametable(table, offset, internal);
  }

  writeNametable(table, offset, value, internal) {
    return this.mapper.writeNametable(table, offset, value, internal);
  }

  selectBackgroundTile(address) {
    this.mapper.selectBackgroundTile(address);
  }

  backgroundAttribute(address, value) {
    return this.mapper.backgroundAttribute(address, value);
  }

  loadSave(data) {
    if (!data) return;
    this.prgRam.set(data.subarray(0, this.prgRam.length));
    this.saveDirty = false;
  }
}
