#!/usr/bin/env python3
"""Pinned audit sample set (#106): a small synthesized drum kit written as plain WAV folders for `strudel ... --samples-dir`.
Generated from fixed formulas and a fixed seed, so the files are reproducible; CC0 (see LICENSE.md). Not a recreation of any drum machine:
the TR-style bank names only make `s("bd").bank("RolandTR909")` resolve offline, the sounds are our own.
  python3 tools/racks/samples/make_samples.py [OUT_DIR]   (default: tools/racks/samples/kit)"""
import sys, wave, pathlib
import numpy as np
SR = 44100
rng = np.random.default_rng(106)
def t(d): return np.arange(int(SR * d)) / SR
def hp(x, a=0.9):
    y = np.zeros_like(x); p = 0.0; q = 0.0
    for i, v in enumerate(x): y[i] = a * (p + v - q); p = y[i]; q = v
    return y
def norm(x, peak=0.35):
    x = x - np.mean(x); x = np.convolve(x, [0.25, 0.5, 0.25], 'same')  # no DC, nothing near Nyquist
    n = max(1, int(SR * 0.004)); x[-n:] *= np.linspace(1, 0, n)  # 4 ms fade-out, no click at the end
    return (x / (np.max(np.abs(x)) + 1e-12) * peak).astype(np.float32)
def bd(f0=120, f1=45, d=0.5, click=0.3):
    x = t(d); ph = 2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-x * 30)) / SR; return norm(np.sin(ph) * np.exp(-x * 7) + click * rng.standard_normal(len(x)) * np.exp(-x * 400))
def sd(d=0.3): x = t(d); return norm(0.5 * np.sin(2 * np.pi * 190 * x) * np.exp(-x * 25) + hp(rng.standard_normal(len(x)), 0.6) * np.exp(-x * 18))
def hh(d=0.08, k=60): x = t(d); return norm(hp(rng.standard_normal(len(x)), 0.95) * np.exp(-x * k))
def cp(d=0.25): x = t(d); env = sum(np.exp(-np.maximum(x - o, 0) * 60) * (x >= o) for o in (0, 0.012, 0.024)) * np.exp(-x * 14); return norm(hp(rng.standard_normal(len(x)), 0.7) * env)
def rim(d=0.06): x = t(d); return norm((np.sin(2 * np.pi * 1700 * x) + 0.5 * np.sin(2 * np.pi * 480 * x)) * np.exp(-x * 90))
def piano(d=1.2): x = t(d); return norm(sum(np.sin(2 * np.pi * 261.63 * h * x) / h for h in (1, 2, 3, 4)) * np.exp(-x * 3.5) * (1 - np.exp(-x * 400)))
KIT = {'bd': bd, 'sd': sd, 'hh': hh, 'oh': lambda: hh(0.35, 12), 'cp': cp, 'rim': rim}
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent / 'kit')
def put(name, x): d = out / name; d.mkdir(parents=True, exist_ok=True); w = wave.open(str(d / f'{name}_00.wav'), 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes()); w.close()
for bank in ('', 'RolandTR909_', 'RolandTR808_'):
    for n, f in KIT.items(): put(bank + n, f())
put('piano', piano())
print(f'{len(list(out.glob("*/*.wav")))} files in {out}')
