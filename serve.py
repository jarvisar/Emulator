#!/usr/bin/env python3
"""Local web server and ROM API for the NES emulator."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import posixpath
import urllib.parse
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ROM_ROOT = ROOT / "ROMs"


class EmulatorHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/api/roms":
            self._list_roms()
            return
        if parsed.path == "/api/rom":
            self._read_rom(urllib.parse.parse_qs(parsed.query).get("name", [""])[0])
            return
        super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _list_roms(self) -> None:
        games = []
        for path in sorted(ROM_ROOT.glob("*.zip"), key=lambda item: item.name.casefold()):
            games.append({"name": path.stem, "file": path.name})
        for path in sorted(ROM_ROOT.glob("*.nes"), key=lambda item: item.name.casefold()):
            games.append({"name": path.stem, "file": path.name})
        payload = json.dumps(games, separators=(",", ":")).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_rom(self, requested_name: str) -> None:
        safe_name = posixpath.basename(requested_name.replace("\\", "/"))
        path = (ROM_ROOT / safe_name).resolve()
        try:
            path.relative_to(ROM_ROOT.resolve())
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid ROM path")
            return
        if not path.is_file() or path.suffix.lower() not in {".zip", ".nes"}:
            self.send_error(HTTPStatus.NOT_FOUND, "ROM not found")
            return
        try:
            if path.suffix.lower() == ".zip":
                with zipfile.ZipFile(path) as archive:
                    entries = [
                        info
                        for info in archive.infolist()
                        if not info.is_dir() and info.filename.lower().endswith(".nes")
                    ]
                    if not entries:
                        raise ValueError("ZIP does not contain an iNES ROM")
                    data = archive.read(entries[0])
                    download_name = Path(entries[0].filename).name
            else:
                data = path.read_bytes()
                download_name = path.name
        except (OSError, zipfile.BadZipFile, ValueError) as exc:
            self.send_error(HTTPStatus.UNPROCESSABLE_ENTITY, str(exc))
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("X-ROM-Name", urllib.parse.quote(download_name))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[server] {self.address_string()} {format_string % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local NES emulator")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true", help="Open the emulator in the default browser")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), EmulatorHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"NES emulator running at {url}")
    print("Press Ctrl+C to stop.")
    if args.open:
        import webbrowser

        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
