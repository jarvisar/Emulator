import { Mirroring } from "./cartridge.js";

const SYSTEM_PALETTE = [
  [84, 84, 84], [0, 30, 116], [8, 16, 144], [48, 0, 136],
  [68, 0, 100], [92, 0, 48], [84, 4, 0], [60, 24, 0],
  [32, 42, 0], [8, 58, 0], [0, 64, 0], [0, 60, 0],
  [0, 50, 60], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [152, 150, 152], [8, 76, 196], [48, 50, 236], [92, 30, 228],
  [136, 20, 176], [160, 20, 100], [152, 34, 32], [120, 60, 0],
  [84, 90, 0], [40, 114, 0], [8, 124, 0], [0, 118, 40],
  [0, 102, 120], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [236, 238, 236], [76, 154, 236], [120, 124, 236], [176, 98, 236],
  [228, 84, 236], [236, 88, 180], [236, 106, 100], [212, 136, 32],
  [160, 170, 0], [116, 196, 0], [76, 208, 32], [56, 204, 108],
  [56, 180, 204], [60, 60, 60], [0, 0, 0], [0, 0, 0],
  [236, 238, 236], [168, 204, 236], [188, 188, 236], [212, 178, 236],
  [236, 174, 236], [236, 174, 212], [236, 180, 176], [228, 196, 144],
  [204, 210, 120], [180, 222, 120], [168, 226, 144], [152, 226, 180],
  [160, 214, 228], [160, 162, 160], [0, 0, 0], [0, 0, 0],
];

export class PPU {
  constructor(cartridge, requestNmi) {
    this.cartridge = cartridge;
    this.requestNmi = requestNmi;
    this.nametable = new Uint8Array(0x1000);
    this.palette = new Uint8Array(32);
    this.oam = new Uint8Array(256);
    this.framebuffer = new Uint8ClampedArray(256 * 240 * 4);
    this.currentSprites = [];
    this.nextSprites = [];
    this.reset();
  }

  reset() {
    this.ctrl = 0;
    this.mask = 0;
    this.status = 0;
    this.oamAddress = 0;
    this.v = 0;
    this.t = 0;
    this.fineX = 0;
    this.writeToggle = false;
    this.readBuffer = 0;
    this.openBus = 0;
    this.scanline = 261;
    this.cycle = 0;
    this.frame = 0;
    this.frameComplete = false;
    this.oddFrame = false;
    this.bgPatternLow = 0;
    this.bgPatternHigh = 0;
    this.bgAttributeLow = 0;
    this.bgAttributeHigh = 0;
    this.nextTileId = 0;
    this.nextTileAttribute = 0;
    this.nextTileLow = 0;
    this.nextTileHigh = 0;
    this.currentSprites = [];
    this.nextSprites = [];
  }

  get renderingEnabled() {
    return (this.mask & 0x18) !== 0;
  }

  cpuRead(register) {
    register &= 7;
    let value = this.openBus;
    if (register === 2) {
      value = (this.status & 0xe0) | (this.openBus & 0x1f);
      this.status &= ~0x80;
      this.writeToggle = false;
    } else if (register === 4) {
      value = this.oam[this.oamAddress];
    } else if (register === 7) {
      const address = this.v & 0x3fff;
      const fetched = this.read(address);
      if (address < 0x3f00) {
        value = this.readBuffer;
        this.readBuffer = fetched;
      } else {
        value = fetched;
        this.readBuffer = this.read(address - 0x1000);
      }
      this.v = (this.v + (this.ctrl & 0x04 ? 32 : 1)) & 0x7fff;
    }
    this.openBus = value;
    return value;
  }

  cpuWrite(register, value) {
    register &= 7;
    value &= 0xff;
    this.openBus = value;
    if (register === 0) {
      const nmiWasEnabled = (this.ctrl & 0x80) !== 0;
      this.ctrl = value;
      this.t = (this.t & 0x73ff) | ((value & 3) << 10);
      if (!nmiWasEnabled && (value & 0x80) && (this.status & 0x80)) this.requestNmi();
    } else if (register === 1) {
      this.mask = value;
    } else if (register === 3) {
      this.oamAddress = value;
    } else if (register === 4) {
      this.oam[this.oamAddress] = value;
      this.oamAddress = (this.oamAddress + 1) & 0xff;
    } else if (register === 5) {
      if (!this.writeToggle) {
        this.fineX = value & 7;
        this.t = (this.t & 0x7fe0) | (value >>> 3);
      } else {
        this.t = (this.t & 0x0c1f) | ((value & 0xf8) << 2) | ((value & 7) << 12);
      }
      this.writeToggle = !this.writeToggle;
    } else if (register === 6) {
      if (!this.writeToggle) {
        this.t = (this.t & 0x00ff) | ((value & 0x3f) << 8);
      } else {
        this.t = (this.t & 0x7f00) | value;
        this.v = this.t;
      }
      this.writeToggle = !this.writeToggle;
    } else if (register === 7) {
      this.write(this.v & 0x3fff, value);
      this.v = (this.v + (this.ctrl & 0x04 ? 32 : 1)) & 0x7fff;
    }
  }

  dmaWrite(value) {
    this.oam[this.oamAddress] = value & 0xff;
    this.oamAddress = (this.oamAddress + 1) & 0xff;
  }

  mapNametable(address) {
    const relative = (address - 0x2000) & 0x0fff;
    const table = relative >>> 10;
    const offset = relative & 0x03ff;
    switch (this.cartridge.mirroring) {
      case Mirroring.VERTICAL:
        return (table & 1) * 0x400 + offset;
      case Mirroring.HORIZONTAL:
        return (table >>> 1) * 0x400 + offset;
      case Mirroring.SINGLE_0:
        return offset;
      case Mirroring.SINGLE_1:
        return 0x400 + offset;
      case Mirroring.FOUR_SCREEN:
        return relative;
      default:
        return offset;
    }
  }

  mapPalette(address) {
    let index = address & 0x1f;
    if (index === 0x10 || index === 0x14 || index === 0x18 || index === 0x1c) index -= 0x10;
    return index;
  }

  read(address) {
    address &= 0x3fff;
    if (address < 0x2000) return this.cartridge.ppuRead(address);
    if (address < 0x3f00) {
      const relative = (address - 0x2000) & 0x0fff;
      const custom = this.cartridge.readNametable(
        relative >>> 10,
        relative & 0x3ff,
        this.nametable,
      );
      return custom === null ? this.nametable[this.mapNametable(address)] : custom;
    }
    return this.palette[this.mapPalette(address)];
  }

  write(address, value) {
    address &= 0x3fff;
    value &= 0xff;
    if (address < 0x2000) {
      this.cartridge.ppuWrite(address, value);
    } else if (address < 0x3f00) {
      const relative = (address - 0x2000) & 0x0fff;
      const handled = this.cartridge.writeNametable(
        relative >>> 10,
        relative & 0x3ff,
        value,
        this.nametable,
      );
      if (!handled) this.nametable[this.mapNametable(address)] = value;
    } else {
      this.palette[this.mapPalette(address)] = value & 0x3f;
    }
  }

  readPattern(address, kind) {
    return this.cartridge.ppuRead(address & 0x1fff, kind);
  }

  incrementX() {
    if ((this.v & 0x001f) === 31) {
      this.v &= ~0x001f;
      this.v ^= 0x0400;
    } else {
      this.v++;
    }
  }

  incrementY() {
    if ((this.v & 0x7000) !== 0x7000) {
      this.v += 0x1000;
      return;
    }
    this.v &= ~0x7000;
    let coarseY = (this.v & 0x03e0) >>> 5;
    if (coarseY === 29) {
      coarseY = 0;
      this.v ^= 0x0800;
    } else if (coarseY === 31) {
      coarseY = 0;
    } else {
      coarseY++;
    }
    this.v = (this.v & ~0x03e0) | (coarseY << 5);
  }

  transferX() {
    this.v = (this.v & ~0x041f) | (this.t & 0x041f);
  }

  transferY() {
    this.v = (this.v & ~0x7be0) | (this.t & 0x7be0);
  }

  loadBackgroundShifters() {
    this.bgPatternLow = (this.bgPatternLow & 0xff00) | this.nextTileLow;
    this.bgPatternHigh = (this.bgPatternHigh & 0xff00) | this.nextTileHigh;
    this.bgAttributeLow =
      (this.bgAttributeLow & 0xff00) | (this.nextTileAttribute & 1 ? 0xff : 0);
    this.bgAttributeHigh =
      (this.bgAttributeHigh & 0xff00) | (this.nextTileAttribute & 2 ? 0xff : 0);
  }

  shiftBackground() {
    if (this.mask & 0x08) {
      this.bgPatternLow = (this.bgPatternLow << 1) & 0xffff;
      this.bgPatternHigh = (this.bgPatternHigh << 1) & 0xffff;
      this.bgAttributeLow = (this.bgAttributeLow << 1) & 0xffff;
      this.bgAttributeHigh = (this.bgAttributeHigh << 1) & 0xffff;
    }
  }

  fetchBackground() {
    switch ((this.cycle - 1) & 7) {
      case 0:
        this.loadBackgroundShifters();
        this.nextTileId = this.read(0x2000 | (this.v & 0x0fff));
        this.cartridge.selectBackgroundTile(this.v);
        break;
      case 2: {
        const address =
          0x23c0 |
          (this.v & 0x0c00) |
          ((this.v >>> 4) & 0x38) |
          ((this.v >>> 2) & 0x07);
        const attribute = this.read(address);
        const shift = ((this.v >>> 4) & 4) | (this.v & 2);
        this.nextTileAttribute = this.cartridge.backgroundAttribute(
          this.v,
          (attribute >>> shift) & 3,
        );
        break;
      }
      case 4: {
        const fineY = (this.v >>> 12) & 7;
        const table = this.ctrl & 0x10 ? 0x1000 : 0;
        this.nextTileLow = this.readPattern(
          table + this.nextTileId * 16 + fineY,
          "background",
        );
        break;
      }
      case 6: {
        const fineY = (this.v >>> 12) & 7;
        const table = this.ctrl & 0x10 ? 0x1000 : 0;
        this.nextTileHigh = this.readPattern(
          table + this.nextTileId * 16 + fineY + 8,
          "background",
        );
        break;
      }
      case 7:
        this.incrementX();
        break;
    }
  }

  evaluateSprites(scanline) {
    const sprites = [];
    const height = this.ctrl & 0x20 ? 16 : 8;
    let found = 0;
    for (let i = 0; i < 64; i++) {
      const base = i * 4;
      const row = scanline - this.oam[base] - 1;
      if (row < 0 || row >= height) continue;
      found++;
      if (sprites.length >= 8) continue;
      const tile = this.oam[base + 1];
      const attributes = this.oam[base + 2];
      let spriteRow = attributes & 0x80 ? height - 1 - row : row;
      let patternAddress;
      if (height === 16) {
        const table = (tile & 1) << 12;
        let tileIndex = tile & 0xfe;
        if (spriteRow >= 8) {
          tileIndex++;
          spriteRow -= 8;
        }
        patternAddress = table + tileIndex * 16 + spriteRow;
      } else {
        const table = this.ctrl & 0x08 ? 0x1000 : 0;
        patternAddress = table + tile * 16 + spriteRow;
      }
      sprites.push({
        index: i,
        x: this.oam[base + 3],
        attributes,
        low: this.readPattern(patternAddress, "sprite"),
        high: this.readPattern(patternAddress + 8, "sprite"),
      });
    }
    if (found > 8) this.status |= 0x20;
    return sprites;
  }

  renderPixel() {
    const x = this.cycle - 1;
    const y = this.scanline;
    const showBackground = (this.mask & 0x08) && (x >= 8 || (this.mask & 0x02));
    const showSprites = (this.mask & 0x10) && (x >= 8 || (this.mask & 0x04));
    let bgPixel = 0;
    let bgPalette = 0;
    if (showBackground) {
      const mux = 0x8000 >>> this.fineX;
      bgPixel =
        (this.bgPatternLow & mux ? 1 : 0) |
        (this.bgPatternHigh & mux ? 2 : 0);
      bgPalette =
        (this.bgAttributeLow & mux ? 1 : 0) |
        (this.bgAttributeHigh & mux ? 2 : 0);
    }

    let spritePixel = 0;
    let spritePalette = 0;
    let spriteBehind = false;
    let spriteZero = false;
    if (showSprites) {
      for (const sprite of this.currentSprites) {
        const column = x - sprite.x;
        if (column < 0 || column >= 8) continue;
        const bit = sprite.attributes & 0x40 ? column : 7 - column;
        const pixel = ((sprite.low >>> bit) & 1) | (((sprite.high >>> bit) & 1) << 1);
        if (!pixel) continue;
        spritePixel = pixel;
        spritePalette = sprite.attributes & 3;
        spriteBehind = (sprite.attributes & 0x20) !== 0;
        spriteZero = sprite.index === 0;
        break;
      }
    }

    let paletteAddress;
    if (!bgPixel && !spritePixel) {
      paletteAddress = 0x3f00;
    } else if (!bgPixel) {
      paletteAddress = 0x3f10 + spritePalette * 4 + spritePixel;
    } else if (!spritePixel) {
      paletteAddress = 0x3f00 + bgPalette * 4 + bgPixel;
    } else {
      if (spriteZero && x < 255) this.status |= 0x40;
      paletteAddress = spriteBehind
        ? 0x3f00 + bgPalette * 4 + bgPixel
        : 0x3f10 + spritePalette * 4 + spritePixel;
    }

    let colorIndex = this.read(paletteAddress) & (this.mask & 1 ? 0x30 : 0x3f);
    colorIndex &= 0x3f;
    const [r, g, b] = SYSTEM_PALETTE[colorIndex];
    const output = (y * 256 + x) * 4;
    this.framebuffer[output] = r;
    this.framebuffer[output + 1] = g;
    this.framebuffer[output + 2] = b;
    this.framebuffer[output + 3] = 255;
  }

  clock() {
    const visible = this.scanline >= 0 && this.scanline < 240;
    const preRender = this.scanline === 261;
    const renderLine = visible || preRender;

    if (this.cycle === 0 && visible) {
      this.currentSprites = this.nextSprites;
    }

    if (visible && this.cycle >= 1 && this.cycle <= 256) this.renderPixel();

    if (renderLine && this.renderingEnabled) {
      if ((this.cycle >= 2 && this.cycle <= 257) || (this.cycle >= 322 && this.cycle <= 337)) {
        this.shiftBackground();
      }
      if ((this.cycle >= 1 && this.cycle <= 256) || (this.cycle >= 321 && this.cycle <= 336)) {
        this.fetchBackground();
      }
      if (this.cycle === 256) this.incrementY();
      if (this.cycle === 257) {
        this.loadBackgroundShifters();
        this.transferX();
        const target = preRender ? 0 : this.scanline + 1;
        this.nextSprites = target < 240 ? this.evaluateSprites(target) : [];
      }
      if (preRender && this.cycle >= 280 && this.cycle <= 304) this.transferY();
      if (this.cycle === 338 || this.cycle === 340) {
        this.nextTileId = this.read(0x2000 | (this.v & 0x0fff));
      }
      if (visible && this.cycle === 260) this.cartridge.clockScanline(this.scanline);
    }

    if (this.scanline === 241 && this.cycle === 1) {
      this.status |= 0x80;
      this.frameComplete = true;
      this.frame++;
      if (this.ctrl & 0x80) this.requestNmi();
    }

    if (preRender && this.cycle === 1) {
      this.status &= ~0xe0;
    }

    if (preRender && this.cycle === 339 && this.oddFrame && this.renderingEnabled) {
      this.cycle = 0;
      this.scanline = 0;
      this.oddFrame = false;
      return;
    }

    this.cycle++;
    if (this.cycle > 340) {
      this.cycle = 0;
      this.scanline++;
      if (this.scanline > 261) {
        this.scanline = 0;
        this.oddFrame = !this.oddFrame;
      }
    }
  }
}

export { SYSTEM_PALETTE };
