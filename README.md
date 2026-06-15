# NES Emulator

A dependency-free NES emulator that runs in a browser and loads the ROM ZIP
library in `ROMs/` directly through a small local Python server.

## Run

Double-click `start.bat`, or run:

```powershell
python serve.py --open
```

If the browser does not open, visit `http://127.0.0.1:8000`.

## Controls

| Input | Player 1 | Player 2 |
| --- | --- | --- |
| D-pad | Arrow keys | W/A/S/D |
| A | Z | V |
| B | X | C |
| Start | Enter | E |
| Select | Shift | Q |

Connected gamepads work for both players. Move and click the mouse over the
screen to use the Zapper. Shortcuts: `Space` pauses, `R` resets, `M` mutes,
and `F` toggles fullscreen.

Battery-backed cartridge RAM is saved automatically in browser local storage.
The **Open .nes file** button can load an uncompressed ROM outside the supplied
library.

The cartridge vault includes persistent favorites, a recently played view, and
random cartridge selection. The display button cycles between pixel-direct,
CRT scanline, and softened composite-style output. Capture saves the current
frame as a PNG. **Dump log** downloads a bounded diagnostic report with recent
CPU samples, mapper state, frame timing, audio state, RAM checksums, and runtime
errors without including ROM contents. The emulator keeps the native 256x240
framebuffer internally and displays it at the intended 4:3 television aspect
ratio.

## Compatibility

The core implements the 6502 CPU, scanline/cycle PPU, five-channel APU,
controllers, OAM DMA, battery RAM, common unofficial CPU opcodes, and every
mapper ID represented by the supplied 710-ROM set:

`0, 1, 2, 3, 4, 5, 7, 9, 13, 19, 34, 66, 69, 105, 118, 119, 206`

The automated audit boots every supplied ROM for 30 frames. Longer
representative tests and framebuffer captures cover all mapper families,
including MMC5, MMC2, Namco 163, and the Nintendo World Championships Event
board.

Current limitations:

- NTSC timing is used for all games; PAL releases run at NTSC speed.
- MMC5 and Namco 163 expansion-audio channels are not mixed.
- Standard controllers and the Zapper are supported. R.O.B., Power Pad,
  Arkanoid paddle, and Miracle Piano peripherals are not emulated.
- This is a practical game emulator, not a transistor-level implementation;
  unusual timing test ROMs may expose edge cases.

## Tests

```powershell
npm test
python tools\smoke_roms.py --frames 300
python tools\smoke_roms.py --all --frames 30
```

`tools/capture-frame.mjs` can capture a deterministic emulator frame to a BMP
for visual regression checks.
