#!/usr/bin/env python3
"""Generate the tiny synthetic audio of tests/packs/fixtures (no pack content is committed: see issue #66).

Deterministic: byte-identical every run, so the committed fixture manifests and asset indexes keep matching.
Run before the fixture checks: python3 tests/packs/gen_assets.py
"""
import math, struct, sys
from pathlib import Path

FIX = Path(__file__).resolve().parent / "fixtures"
SR = 8000


def wav(freq, ms=40):
    n = SR * ms // 1000
    pcm = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / SR))) for i in range(n))
    hdr = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
    return hdr + b"data" + struct.pack("<I", len(pcm)) + pcm


FILES = {
    "good/sounds/tkick.wav": 60,
    "good/sounds/tsnare.wav": 220,
    "collide-a/sounds/tkick.wav": 60,
    "collide-b/sounds/tkick.wav": 90,
}


def main():
    for rel, freq in FILES.items():
        p = FIX / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(wav(freq))
    print(f"generated {len(FILES)} synthetic wav files under {FIX}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
