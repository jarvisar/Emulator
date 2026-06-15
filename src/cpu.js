export const Flags = Object.freeze({
  C: 0x01,
  Z: 0x02,
  I: 0x04,
  D: 0x08,
  B: 0x10,
  U: 0x20,
  V: 0x40,
  N: 0x80,
});

const OPS = Array.from({ length: 256 }, () => ({
  name: "NOP",
  mode: "IMP",
  cycles: 2,
  page: false,
}));

function define(name, entries) {
  for (const [opcode, mode, cycles, page = false] of entries) {
    OPS[opcode] = { name, mode, cycles, page };
  }
}

define("ADC", [
  [0x69, "IMM", 2], [0x65, "ZP", 3], [0x75, "ZPX", 4], [0x6d, "ABS", 4],
  [0x7d, "ABSX", 4, true], [0x79, "ABSY", 4, true], [0x61, "INDX", 6],
  [0x71, "INDY", 5, true],
]);
define("AND", [
  [0x29, "IMM", 2], [0x25, "ZP", 3], [0x35, "ZPX", 4], [0x2d, "ABS", 4],
  [0x3d, "ABSX", 4, true], [0x39, "ABSY", 4, true], [0x21, "INDX", 6],
  [0x31, "INDY", 5, true],
]);
define("ASL", [
  [0x0a, "ACC", 2], [0x06, "ZP", 5], [0x16, "ZPX", 6], [0x0e, "ABS", 6],
  [0x1e, "ABSX", 7],
]);
define("BCC", [[0x90, "REL", 2]]);
define("BCS", [[0xb0, "REL", 2]]);
define("BEQ", [[0xf0, "REL", 2]]);
define("BIT", [[0x24, "ZP", 3], [0x2c, "ABS", 4]]);
define("BMI", [[0x30, "REL", 2]]);
define("BNE", [[0xd0, "REL", 2]]);
define("BPL", [[0x10, "REL", 2]]);
define("BRK", [[0x00, "IMP", 7]]);
define("BVC", [[0x50, "REL", 2]]);
define("BVS", [[0x70, "REL", 2]]);
define("CLC", [[0x18, "IMP", 2]]);
define("CLD", [[0xd8, "IMP", 2]]);
define("CLI", [[0x58, "IMP", 2]]);
define("CLV", [[0xb8, "IMP", 2]]);
define("CMP", [
  [0xc9, "IMM", 2], [0xc5, "ZP", 3], [0xd5, "ZPX", 4], [0xcd, "ABS", 4],
  [0xdd, "ABSX", 4, true], [0xd9, "ABSY", 4, true], [0xc1, "INDX", 6],
  [0xd1, "INDY", 5, true],
]);
define("CPX", [[0xe0, "IMM", 2], [0xe4, "ZP", 3], [0xec, "ABS", 4]]);
define("CPY", [[0xc0, "IMM", 2], [0xc4, "ZP", 3], [0xcc, "ABS", 4]]);
define("DEC", [[0xc6, "ZP", 5], [0xd6, "ZPX", 6], [0xce, "ABS", 6], [0xde, "ABSX", 7]]);
define("DEX", [[0xca, "IMP", 2]]);
define("DEY", [[0x88, "IMP", 2]]);
define("EOR", [
  [0x49, "IMM", 2], [0x45, "ZP", 3], [0x55, "ZPX", 4], [0x4d, "ABS", 4],
  [0x5d, "ABSX", 4, true], [0x59, "ABSY", 4, true], [0x41, "INDX", 6],
  [0x51, "INDY", 5, true],
]);
define("INC", [[0xe6, "ZP", 5], [0xf6, "ZPX", 6], [0xee, "ABS", 6], [0xfe, "ABSX", 7]]);
define("INX", [[0xe8, "IMP", 2]]);
define("INY", [[0xc8, "IMP", 2]]);
define("JMP", [[0x4c, "ABS", 3], [0x6c, "IND", 5]]);
define("JSR", [[0x20, "ABS", 6]]);
define("LDA", [
  [0xa9, "IMM", 2], [0xa5, "ZP", 3], [0xb5, "ZPX", 4], [0xad, "ABS", 4],
  [0xbd, "ABSX", 4, true], [0xb9, "ABSY", 4, true], [0xa1, "INDX", 6],
  [0xb1, "INDY", 5, true],
]);
define("LDX", [
  [0xa2, "IMM", 2], [0xa6, "ZP", 3], [0xb6, "ZPY", 4], [0xae, "ABS", 4],
  [0xbe, "ABSY", 4, true],
]);
define("LDY", [
  [0xa0, "IMM", 2], [0xa4, "ZP", 3], [0xb4, "ZPX", 4], [0xac, "ABS", 4],
  [0xbc, "ABSX", 4, true],
]);
define("LSR", [
  [0x4a, "ACC", 2], [0x46, "ZP", 5], [0x56, "ZPX", 6], [0x4e, "ABS", 6],
  [0x5e, "ABSX", 7],
]);
define("NOP", [[0xea, "IMP", 2]]);
define("ORA", [
  [0x09, "IMM", 2], [0x05, "ZP", 3], [0x15, "ZPX", 4], [0x0d, "ABS", 4],
  [0x1d, "ABSX", 4, true], [0x19, "ABSY", 4, true], [0x01, "INDX", 6],
  [0x11, "INDY", 5, true],
]);
define("PHA", [[0x48, "IMP", 3]]);
define("PHP", [[0x08, "IMP", 3]]);
define("PLA", [[0x68, "IMP", 4]]);
define("PLP", [[0x28, "IMP", 4]]);
define("ROL", [
  [0x2a, "ACC", 2], [0x26, "ZP", 5], [0x36, "ZPX", 6], [0x2e, "ABS", 6],
  [0x3e, "ABSX", 7],
]);
define("ROR", [
  [0x6a, "ACC", 2], [0x66, "ZP", 5], [0x76, "ZPX", 6], [0x6e, "ABS", 6],
  [0x7e, "ABSX", 7],
]);
define("RTI", [[0x40, "IMP", 6]]);
define("RTS", [[0x60, "IMP", 6]]);
define("SBC", [
  [0xe9, "IMM", 2], [0xeb, "IMM", 2], [0xe5, "ZP", 3], [0xf5, "ZPX", 4],
  [0xed, "ABS", 4], [0xfd, "ABSX", 4, true], [0xf9, "ABSY", 4, true],
  [0xe1, "INDX", 6], [0xf1, "INDY", 5, true],
]);
define("SEC", [[0x38, "IMP", 2]]);
define("SED", [[0xf8, "IMP", 2]]);
define("SEI", [[0x78, "IMP", 2]]);
define("STA", [
  [0x85, "ZP", 3], [0x95, "ZPX", 4], [0x8d, "ABS", 4], [0x9d, "ABSX", 5],
  [0x99, "ABSY", 5], [0x81, "INDX", 6], [0x91, "INDY", 6],
]);
define("STX", [[0x86, "ZP", 3], [0x96, "ZPY", 4], [0x8e, "ABS", 4]]);
define("STY", [[0x84, "ZP", 3], [0x94, "ZPX", 4], [0x8c, "ABS", 4]]);
define("TAX", [[0xaa, "IMP", 2]]);
define("TAY", [[0xa8, "IMP", 2]]);
define("TSX", [[0xba, "IMP", 2]]);
define("TXA", [[0x8a, "IMP", 2]]);
define("TXS", [[0x9a, "IMP", 2]]);
define("TYA", [[0x98, "IMP", 2]]);

// Common unofficial opcodes used by licensed and unlicensed software.
define("LAX", [
  [0xa3, "INDX", 6], [0xa7, "ZP", 3], [0xaf, "ABS", 4], [0xb3, "INDY", 5, true],
  [0xb7, "ZPY", 4], [0xbf, "ABSY", 4, true],
]);
define("SAX", [[0x83, "INDX", 6], [0x87, "ZP", 3], [0x8f, "ABS", 4], [0x97, "ZPY", 4]]);
define("DCP", [
  [0xc3, "INDX", 8], [0xc7, "ZP", 5], [0xcf, "ABS", 6], [0xd3, "INDY", 8],
  [0xd7, "ZPX", 6], [0xdb, "ABSY", 7], [0xdf, "ABSX", 7],
]);
define("ISC", [
  [0xe3, "INDX", 8], [0xe7, "ZP", 5], [0xef, "ABS", 6], [0xf3, "INDY", 8],
  [0xf7, "ZPX", 6], [0xfb, "ABSY", 7], [0xff, "ABSX", 7],
]);
define("SLO", [
  [0x03, "INDX", 8], [0x07, "ZP", 5], [0x0f, "ABS", 6], [0x13, "INDY", 8],
  [0x17, "ZPX", 6], [0x1b, "ABSY", 7], [0x1f, "ABSX", 7],
]);
define("RLA", [
  [0x23, "INDX", 8], [0x27, "ZP", 5], [0x2f, "ABS", 6], [0x33, "INDY", 8],
  [0x37, "ZPX", 6], [0x3b, "ABSY", 7], [0x3f, "ABSX", 7],
]);
define("SRE", [
  [0x43, "INDX", 8], [0x47, "ZP", 5], [0x4f, "ABS", 6], [0x53, "INDY", 8],
  [0x57, "ZPX", 6], [0x5b, "ABSY", 7], [0x5f, "ABSX", 7],
]);
define("RRA", [
  [0x63, "INDX", 8], [0x67, "ZP", 5], [0x6f, "ABS", 6], [0x73, "INDY", 8],
  [0x77, "ZPX", 6], [0x7b, "ABSY", 7], [0x7f, "ABSX", 7],
]);
define("NOP", [
  [0x1a, "IMP", 2], [0x3a, "IMP", 2], [0x5a, "IMP", 2], [0x7a, "IMP", 2],
  [0xda, "IMP", 2], [0xfa, "IMP", 2],
  [0x80, "IMM", 2], [0x82, "IMM", 2], [0x89, "IMM", 2], [0xc2, "IMM", 2],
  [0xe2, "IMM", 2],
  [0x04, "ZP", 3], [0x44, "ZP", 3], [0x64, "ZP", 3],
  [0x14, "ZPX", 4], [0x34, "ZPX", 4], [0x54, "ZPX", 4], [0x74, "ZPX", 4],
  [0xd4, "ZPX", 4], [0xf4, "ZPX", 4],
  [0x0c, "ABS", 4],
  [0x1c, "ABSX", 4, true], [0x3c, "ABSX", 4, true], [0x5c, "ABSX", 4, true],
  [0x7c, "ABSX", 4, true], [0xdc, "ABSX", 4, true], [0xfc, "ABSX", 4, true],
]);

export class CPU {
  constructor(bus) {
    this.bus = bus;
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.pc = 0;
    this.p = Flags.I | Flags.U;
    this.totalCycles = 0;
    this.nmiPending = false;
    this.irqLine = false;
    this.lastPc = 0;
    this.lastOpcode = 0;
    this.lastOperation = "RESET";
  }

  reset() {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.p = Flags.I | Flags.U;
    this.pc = this.read16(0xfffc);
    this.totalCycles = 7;
    this.nmiPending = false;
    this.lastPc = this.pc;
    this.lastOpcode = 0;
    this.lastOperation = "RESET";
  }

  requestNmi() {
    this.nmiPending = true;
  }

  setIrq(asserted) {
    this.irqLine = asserted;
  }

  read(address) {
    return this.bus.read(address & 0xffff) & 0xff;
  }

  write(address, value) {
    this.bus.write(address & 0xffff, value & 0xff);
  }

  read16(address) {
    const lo = this.read(address);
    const hi = this.read((address + 1) & 0xffff);
    return lo | (hi << 8);
  }

  read16Bug(address) {
    const lo = this.read(address);
    const hi = this.read((address & 0xff00) | ((address + 1) & 0xff));
    return lo | (hi << 8);
  }

  push(value) {
    this.write(0x100 | this.sp, value);
    this.sp = (this.sp - 1) & 0xff;
  }

  pull() {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x100 | this.sp);
  }

  getFlag(flag) {
    return (this.p & flag) !== 0;
  }

  setFlag(flag, value) {
    if (value) this.p |= flag;
    else this.p &= ~flag;
  }

  setZN(value) {
    value &= 0xff;
    this.setFlag(Flags.Z, value === 0);
    this.setFlag(Flags.N, value & 0x80);
    return value;
  }

  interrupt(vector, breakFlag = false) {
    this.push(this.pc >>> 8);
    this.push(this.pc & 0xff);
    this.push((this.p & ~Flags.B) | Flags.U | (breakFlag ? Flags.B : 0));
    this.setFlag(Flags.I, true);
    this.pc = this.read16(vector);
  }

  resolve(mode) {
    let address = 0;
    let pageCross = false;
    switch (mode) {
      case "IMM":
        address = this.pc++;
        break;
      case "ZP":
        address = this.read(this.pc++);
        break;
      case "ZPX":
        address = (this.read(this.pc++) + this.x) & 0xff;
        break;
      case "ZPY":
        address = (this.read(this.pc++) + this.y) & 0xff;
        break;
      case "ABS":
        address = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        break;
      case "ABSX": {
        const base = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        address = (base + this.x) & 0xffff;
        pageCross = (base & 0xff00) !== (address & 0xff00);
        break;
      }
      case "ABSY": {
        const base = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        address = (base + this.y) & 0xffff;
        pageCross = (base & 0xff00) !== (address & 0xff00);
        break;
      }
      case "IND": {
        const pointer = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        address = this.read16Bug(pointer);
        break;
      }
      case "INDX": {
        const pointer = (this.read(this.pc++) + this.x) & 0xff;
        address = this.read(pointer) | (this.read((pointer + 1) & 0xff) << 8);
        break;
      }
      case "INDY": {
        const pointer = this.read(this.pc++);
        const base = this.read(pointer) | (this.read((pointer + 1) & 0xff) << 8);
        address = (base + this.y) & 0xffff;
        pageCross = (base & 0xff00) !== (address & 0xff00);
        break;
      }
      case "REL": {
        const raw = this.read(this.pc++);
        address = raw < 0x80 ? raw : raw - 0x100;
        break;
      }
    }
    return { address, pageCross };
  }

  compare(register, value) {
    const result = (register - value) & 0x1ff;
    this.setFlag(Flags.C, register >= value);
    this.setZN(result & 0xff);
  }

  adc(value) {
    const carry = this.getFlag(Flags.C) ? 1 : 0;
    const sum = this.a + value + carry;
    this.setFlag(Flags.C, sum > 0xff);
    this.setFlag(Flags.V, (~(this.a ^ value) & (this.a ^ sum) & 0x80) !== 0);
    this.a = this.setZN(sum);
  }

  branch(condition, offset) {
    if (!condition) return 0;
    const old = this.pc;
    this.pc = (this.pc + offset) & 0xffff;
    return 1 + ((old & 0xff00) !== (this.pc & 0xff00) ? 1 : 0);
  }

  rmw(address, operation) {
    const value = this.read(address);
    const result = operation(value) & 0xff;
    this.write(address, result);
    return result;
  }

  step() {
    if (this.nmiPending) {
      this.nmiPending = false;
      this.interrupt(0xfffa);
      this.totalCycles += 7;
      return 7;
    }
    if (this.irqLine && !this.getFlag(Flags.I)) {
      this.interrupt(0xfffe);
      this.totalCycles += 7;
      return 7;
    }

    this.lastPc = this.pc;
    const opcode = this.read(this.pc++);
    const op = OPS[opcode];
    this.lastOpcode = opcode;
    this.lastOperation = op.name;
    const { address, pageCross } = this.resolve(op.mode);
    let cycles = op.cycles + (op.page && pageCross ? 1 : 0);
    let value;

    switch (op.name) {
      case "ADC": this.adc(this.read(address)); break;
      case "AND": this.a = this.setZN(this.a & this.read(address)); break;
      case "ASL":
        if (op.mode === "ACC") {
          this.setFlag(Flags.C, this.a & 0x80);
          this.a = this.setZN(this.a << 1);
        } else {
          value = this.rmw(address, (v) => {
            this.setFlag(Flags.C, v & 0x80);
            return this.setZN(v << 1);
          });
        }
        break;
      case "BCC": cycles += this.branch(!this.getFlag(Flags.C), address); break;
      case "BCS": cycles += this.branch(this.getFlag(Flags.C), address); break;
      case "BEQ": cycles += this.branch(this.getFlag(Flags.Z), address); break;
      case "BIT":
        value = this.read(address);
        this.setFlag(Flags.Z, (this.a & value) === 0);
        this.setFlag(Flags.V, value & 0x40);
        this.setFlag(Flags.N, value & 0x80);
        break;
      case "BMI": cycles += this.branch(this.getFlag(Flags.N), address); break;
      case "BNE": cycles += this.branch(!this.getFlag(Flags.Z), address); break;
      case "BPL": cycles += this.branch(!this.getFlag(Flags.N), address); break;
      case "BRK":
        this.pc = (this.pc + 1) & 0xffff;
        this.interrupt(0xfffe, true);
        break;
      case "BVC": cycles += this.branch(!this.getFlag(Flags.V), address); break;
      case "BVS": cycles += this.branch(this.getFlag(Flags.V), address); break;
      case "CLC": this.setFlag(Flags.C, false); break;
      case "CLD": this.setFlag(Flags.D, false); break;
      case "CLI": this.setFlag(Flags.I, false); break;
      case "CLV": this.setFlag(Flags.V, false); break;
      case "CMP": this.compare(this.a, this.read(address)); break;
      case "CPX": this.compare(this.x, this.read(address)); break;
      case "CPY": this.compare(this.y, this.read(address)); break;
      case "DEC": this.rmw(address, (v) => this.setZN(v - 1)); break;
      case "DEX": this.x = this.setZN(this.x - 1); break;
      case "DEY": this.y = this.setZN(this.y - 1); break;
      case "EOR": this.a = this.setZN(this.a ^ this.read(address)); break;
      case "INC": this.rmw(address, (v) => this.setZN(v + 1)); break;
      case "INX": this.x = this.setZN(this.x + 1); break;
      case "INY": this.y = this.setZN(this.y + 1); break;
      case "JMP": this.pc = address; break;
      case "JSR":
        value = (this.pc - 1) & 0xffff;
        this.push(value >>> 8);
        this.push(value & 0xff);
        this.pc = address;
        break;
      case "LDA": this.a = this.setZN(this.read(address)); break;
      case "LDX": this.x = this.setZN(this.read(address)); break;
      case "LDY": this.y = this.setZN(this.read(address)); break;
      case "LSR":
        if (op.mode === "ACC") {
          this.setFlag(Flags.C, this.a & 1);
          this.a = this.setZN(this.a >>> 1);
        } else {
          this.rmw(address, (v) => {
            this.setFlag(Flags.C, v & 1);
            return this.setZN(v >>> 1);
          });
        }
        break;
      case "NOP":
        if (op.mode !== "IMP" && op.mode !== "ACC") this.read(address);
        break;
      case "ORA": this.a = this.setZN(this.a | this.read(address)); break;
      case "PHA": this.push(this.a); break;
      case "PHP": this.push(this.p | Flags.B | Flags.U); break;
      case "PLA": this.a = this.setZN(this.pull()); break;
      case "PLP": this.p = (this.pull() & ~Flags.B) | Flags.U; break;
      case "ROL":
        if (op.mode === "ACC") {
          value = this.getFlag(Flags.C) ? 1 : 0;
          this.setFlag(Flags.C, this.a & 0x80);
          this.a = this.setZN((this.a << 1) | value);
        } else {
          value = this.getFlag(Flags.C) ? 1 : 0;
          this.rmw(address, (v) => {
            const carry = v & 0x80;
            const result = this.setZN((v << 1) | value);
            this.setFlag(Flags.C, carry);
            return result;
          });
        }
        break;
      case "ROR":
        if (op.mode === "ACC") {
          value = this.getFlag(Flags.C) ? 0x80 : 0;
          this.setFlag(Flags.C, this.a & 1);
          this.a = this.setZN((this.a >>> 1) | value);
        } else {
          value = this.getFlag(Flags.C) ? 0x80 : 0;
          this.rmw(address, (v) => {
            const carry = v & 1;
            const result = this.setZN((v >>> 1) | value);
            this.setFlag(Flags.C, carry);
            return result;
          });
        }
        break;
      case "RTI":
        this.p = (this.pull() & ~Flags.B) | Flags.U;
        this.pc = this.pull() | (this.pull() << 8);
        break;
      case "RTS":
        this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xffff;
        break;
      case "SBC": this.adc(this.read(address) ^ 0xff); break;
      case "SEC": this.setFlag(Flags.C, true); break;
      case "SED": this.setFlag(Flags.D, true); break;
      case "SEI": this.setFlag(Flags.I, true); break;
      case "STA": this.write(address, this.a); break;
      case "STX": this.write(address, this.x); break;
      case "STY": this.write(address, this.y); break;
      case "TAX": this.x = this.setZN(this.a); break;
      case "TAY": this.y = this.setZN(this.a); break;
      case "TSX": this.x = this.setZN(this.sp); break;
      case "TXA": this.a = this.setZN(this.x); break;
      case "TXS": this.sp = this.x; break;
      case "TYA": this.a = this.setZN(this.y); break;
      case "LAX": this.a = this.x = this.setZN(this.read(address)); break;
      case "SAX": this.write(address, this.a & this.x); break;
      case "DCP":
        value = this.rmw(address, (v) => (v - 1) & 0xff);
        this.compare(this.a, value);
        break;
      case "ISC":
        value = this.rmw(address, (v) => (v + 1) & 0xff);
        this.adc(value ^ 0xff);
        break;
      case "SLO":
        value = this.rmw(address, (v) => {
          this.setFlag(Flags.C, v & 0x80);
          return v << 1;
        });
        this.a = this.setZN(this.a | value);
        break;
      case "RLA": {
        const oldCarry = this.getFlag(Flags.C) ? 1 : 0;
        value = this.rmw(address, (v) => {
          this.setFlag(Flags.C, v & 0x80);
          return (v << 1) | oldCarry;
        });
        this.a = this.setZN(this.a & value);
        break;
      }
      case "SRE":
        value = this.rmw(address, (v) => {
          this.setFlag(Flags.C, v & 1);
          return v >>> 1;
        });
        this.a = this.setZN(this.a ^ value);
        break;
      case "RRA": {
        const oldCarry = this.getFlag(Flags.C) ? 0x80 : 0;
        value = this.rmw(address, (v) => {
          this.setFlag(Flags.C, v & 1);
          return (v >>> 1) | oldCarry;
        });
        this.adc(value);
        break;
      }
    }

    if (this.bus.takeDmaStall) cycles += this.bus.takeDmaStall(this.totalCycles + cycles);
    this.totalCycles += cycles;
    return cycles;
  }
}

export { OPS };
