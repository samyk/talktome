#!/usr/bin/env python3
"""Generate simple PNG icons + a silent placeholder prompt.wav for EditX voices."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "extension" / "src" / "assets" / "icons"
VOICE_DIR = ROOT / "server" / "voices" / "default"


def png(size: int, rgb=(61, 214, 198)) -> bytes:
    """Minimal solid-color PNG with a darker circle-ish mark via checker — solid is fine."""
    r, g, b = rgb
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter
        for x in range(size):
            # soft rounded square
            nx = (x + 0.5) / size * 2 - 1
            ny = (y + 0.5) / size * 2 - 1
            inside = abs(nx) < 0.72 and abs(ny) < 0.72 and (abs(nx) ** 4 + abs(ny) ** 4) < 0.55
            if inside:
                # wave bar motif
                wave = abs((x / size) * 6 - 3) < 0.35 + 0.25 * ((y / size - 0.5) * 4) ** 2
                if wave and 0.25 < y / size < 0.75:
                    raw.extend((15, 32, 40, 255))
                else:
                    raw.extend((r, g, b, 255))
            else:
                raw.extend((0, 0, 0, 0))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(
        b"IEND", b""
    )


def silent_wav(path: Path, seconds: float = 1.0, sr: int = 22050) -> None:
    n = int(seconds * sr)
    # 16-bit mono PCM silence
    data = b"\x00\x00" * n
    byte_rate = sr * 2
    block_align = 2
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sr,
        byte_rate,
        block_align,
        16,
        b"data",
        len(data),
    )
    path.write_bytes(header + data)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        (ICON_DIR / f"icon{size}.png").write_bytes(png(size))
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    silent_wav(VOICE_DIR / "prompt.wav", seconds=2.0)
    print(f"Wrote icons to {ICON_DIR}")
    print(f"Wrote placeholder {VOICE_DIR / 'prompt.wav'}")


if __name__ == "__main__":
    main()
