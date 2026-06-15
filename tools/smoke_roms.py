#!/usr/bin/env python3
"""Boot representative supplied ROMs through the JavaScript emulator core."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import zipfile
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROM_ROOT = ROOT / "ROMs"
TARGET_MAPPERS = {0, 1, 2, 3, 4, 5, 7, 9, 13, 19, 34, 66, 69, 105, 118, 119, 206}


def mapper_id(header: bytes) -> int:
    return (header[6] >> 4) | (header[7] & 0xF0)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Boot every supported supplied ROM")
    parser.add_argument("--frames", type=int, default=3)
    args = parser.parse_args()
    selected: dict[int, Path] = {}
    all_roms: list[Path] = []
    temp_root = Path(tempfile.mkdtemp(prefix="nes-smoke-", dir=ROOT))
    try:
      for archive_path in sorted(ROM_ROOT.glob("*.zip")):
          with zipfile.ZipFile(archive_path) as archive:
              entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith(".nes")]
              if not entries:
                  continue
              with archive.open(entries[0]) as source:
                  data = source.read()
              mapper = mapper_id(data[:16])
              if mapper not in TARGET_MAPPERS:
                  continue
              if not args.all and mapper in selected:
                  continue
              output = temp_root / (
                  f"{len(all_roms):04d}-mapper-{mapper}.nes"
                  if args.all
                  else f"mapper-{mapper}.nes"
              )
              output.write_bytes(data)
              selected.setdefault(mapper, output)
              all_roms.append(output)
          if not args.all and selected.keys() >= TARGET_MAPPERS:
              break

      missing = sorted(TARGET_MAPPERS - selected.keys())
      if missing:
          print(f"Missing representative ROMs for mapper(s): {missing}")
          return 1
      paths = all_roms if args.all else [selected[mapper] for mapper in sorted(selected)]
      batch_size = 50 if args.all else len(paths)
      result = 0
      for start in range(0, len(paths), batch_size):
          command = [
              "node",
              str(ROOT / "tools" / "rom-smoke.mjs"),
              f"--frames={args.frames}",
          ]
          if args.all:
              command.append("--quiet")
          command.extend(str(path) for path in paths[start : start + batch_size])
          result |= subprocess.run(command, cwd=ROOT, check=False).returncode
      return result
    finally:
      shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
