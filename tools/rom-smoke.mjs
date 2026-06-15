import { readFileSync } from "node:fs";
import { NES } from "../src/nes.js";

const args = process.argv.slice(2);
let frames = 3;
if (args[0]?.startsWith("--frames=")) {
  frames = Number(args.shift().split("=")[1]);
}
const quietIndex = args.indexOf("--quiet");
const quiet = quietIndex !== -1;
if (quiet) args.splice(quietIndex, 1);

let failures = 0;
let passed = 0;
for (const path of args) {
  const name = path.split(/[\\/]/).at(-1);
  try {
    const nes = new NES(new Uint8Array(readFileSync(path)), name);
    let frame;
    for (let i = 0; i < frames; i++) frame = nes.runFrame();
    const colors = new Set();
    for (let i = 0; i < frame.pixels.length; i += 4) {
      colors.add(
        (frame.pixels[i] << 16) |
        (frame.pixels[i + 1] << 8) |
        frame.pixels[i + 2],
      );
    }
    passed++;
    if (!quiet) {
      console.log(`PASS mapper=${nes.cartridge.mapperId} frames=${frame.frame} colors=${colors.size} ${name}`);
    }
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`);
  }
}
console.log(`ROM smoke summary: ${passed} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
