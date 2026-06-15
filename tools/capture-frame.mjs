import { readFileSync, writeFileSync } from "node:fs";
import { NES } from "../src/nes.js";

const [romPath, outputPath, frameText = "300"] = process.argv.slice(2);
if (!romPath || !outputPath) {
  console.error("Usage: node tools/capture-frame.mjs ROM.nes output.bmp [frames]");
  process.exit(2);
}

const nes = new NES(new Uint8Array(readFileSync(romPath)), romPath);
let frame;
for (let i = 0; i < Number(frameText); i++) frame = nes.runFrame();

const width = 256;
const height = 240;
const pixelBytes = width * height * 4;
const file = Buffer.alloc(54 + pixelBytes);
file.write("BM", 0, 2, "ascii");
file.writeUInt32LE(file.length, 2);
file.writeUInt32LE(54, 10);
file.writeUInt32LE(40, 14);
file.writeInt32LE(width, 18);
file.writeInt32LE(height, 22);
file.writeUInt16LE(1, 26);
file.writeUInt16LE(32, 28);
file.writeUInt32LE(pixelBytes, 34);

for (let y = 0; y < height; y++) {
  const sourceY = height - 1 - y;
  for (let x = 0; x < width; x++) {
    const source = (sourceY * width + x) * 4;
    const target = 54 + (y * width + x) * 4;
    file[target] = frame.pixels[source + 2];
    file[target + 1] = frame.pixels[source + 1];
    file[target + 2] = frame.pixels[source];
    file[target + 3] = 255;
  }
}

writeFileSync(outputPath, file);
console.log(`Captured frame ${frame.frame} to ${outputPath}`);
