#!/usr/bin/env python3
"""word-vocals P4 (#45): formant-preserving pitch variants for word-bank slices.

  formant.py --selftest [--backend pyworld|rubberband|all]
Used by wordbank.py via --formant-steps -12..12 (default off). Writes OUT/formant/wav/<key>_f<semi>__<n>.wav and OUT/formant/strudel.json
with keys vox_<word>_f<semi> (semi signed, e.g. f7, f-5). Backends: pyworld (MIT, in-process WORLD vocoder, default) or the external
`rubberband --formant` binary (GPL-2, spawned as a separate process only; never linked or vendored; skipped if absent).

Helper contract for word(...).formant(true): variant = nearest step to the requested semitone shift (formant_pick), then the remaining
residual (<= 50 cents) is applied with speed (2**(residual/12)), which shifts formants by < 3%.
"""
import argparse, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, soundfile as sf

SR = 44100


def parse_steps(s):
    m = re.fullmatch(r'\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*', s)
    if m:
        a, b = int(m[1]), int(m[2]); st = list(range(min(a, b), max(a, b) + 1))
    else:
        st = [int(v) for v in s.split(',') if v.strip()]
    if not st or any(abs(v) > 12 for v in st): raise ValueError('formant steps must be integers within -12..12')
    return [v for v in st if v != 0]


def formant_pick(semi, steps):
    """-> (nearest step, residual semitones, speed to apply for the residual). residual is within 0.5 st when steps are contiguous."""
    best = min(steps, key=lambda v: (abs(v - semi), abs(v)))
    r = semi - best
    return best, r, 2 ** (r / 12)


def shift_pyworld(x, sr, semi):
    import pyworld as pw
    x = np.ascontiguousarray(x, dtype=np.float64)
    f0, t = pw.harvest(x, sr, f0_floor=70.0, f0_ceil=900.0)
    sp = pw.cheaptrick(x, f0, t, sr); ap = pw.d4c(x, f0, t, sr)
    y = pw.synthesize(f0 * 2 ** (semi / 12), sp, ap, sr)  # unvoiced frames (f0=0) stay 0, envelope untouched
    n = len(x); y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
    return y.astype(np.float32)


def rubberband_bin():
    return shutil.which('rubberband')


def shift_rubberband(x, sr, semi):
    rb = rubberband_bin()
    if not rb: raise RuntimeError('rubberband binary not found')
    d = Path(tempfile.mkdtemp()); i, o = d / 'i.wav', d / 'o.wav'
    try:
        sf.write(i, x, sr, subtype='FLOAT')
        subprocess.run([rb, '-3', '--formant', '-p', f'{semi}', str(i), str(o)], check=True, capture_output=True)  # separate process: GPL boundary
        y, _ = sf.read(o, always_2d=True); y = y.mean(axis=1)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    n = len(x); y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
    return y.astype(np.float32)


BACKENDS = {'pyworld': shift_pyworld, 'rubberband': shift_rubberband}


def available(backend):
    if backend == 'rubberband': return bool(rubberband_bin())
    try:
        import pyworld  # noqa: F401
        return True
    except ImportError:
        return False


def render_variants(slices, out, bank, steps, backend='pyworld', sr=SR):
    """slices: {key 'vox_word': [(name, mono float32 array)]}. Returns {variant key: [file urls]}; written to out/formant/."""
    if not available(backend): raise RuntimeError(f'formant backend {backend} unavailable')
    fn = BACKENDS[backend]; w = Path(out) / 'formant' / 'wav'; w.mkdir(parents=True, exist_ok=True); m = {}
    for key, lst in slices.items():
        for semi in steps:
            vk = f'{key}_f{semi}'
            for ci, (nm, seg) in enumerate(lst):
                y = fn(seg, sr, semi); pk = np.max(np.abs(y))
                if pk > 0.99: y = y / pk * 0.99
                p = w / f'{vk}__{ci}.wav'; sf.write(p, y, sr, subtype='FLOAT'); m.setdefault(vk, []).append(p.resolve().as_uri())
    (Path(out) / 'formant' / 'strudel.json').write_text(json.dumps(m, indent=1) + '\n')
    return m


# ---- measurement (selftest) ----
def f0_median(x, sr):
    import pyworld as pw
    f0, _ = pw.harvest(np.ascontiguousarray(x, dtype=np.float64), sr, f0_floor=70.0, f0_ceil=900.0)
    f0 = f0[f0 > 0]; return float(np.median(f0)) if len(f0) else 0.0


def formants_lpc(x, sr, n=2, order=8):
    import librosa
    ds = 4; y = librosa.resample(x.astype(np.float64), orig_sr=sr, target_sr=sr // ds)  # 11 kHz for LPC
    y = np.append(y[0], y[1:] - 0.97 * y[:-1]); y = y[len(y) // 4: 3 * len(y) // 4]; y = y * np.hanning(len(y))
    a = librosa.lpc(y, order=order); r = np.roots(a); r = r[np.imag(r) > 0.01]
    o_ = np.argsort(np.angle(r)); f = np.angle(r)[o_] * (sr // ds) / (2 * np.pi); bw = -np.log(np.abs(r[o_])) * (sr // ds) / np.pi
    return [float(v) for v, b in zip(f, bw) if v > 200 and b < 400][:n]


def synth_vowel(f0=120.0, dur=0.6, sr=SR, forms=(700.0, 1220.0), bws=(80.0, 90.0)):
    from scipy.signal import lfilter
    n = int(dur * sr); src = np.zeros(n); src[(np.arange(0, n, sr / f0)).astype(int)] = 1.0
    src = lfilter([1], [1, -0.9], src)  # glottal tilt
    y = src
    for f, b in zip(forms, bws):
        r = np.exp(-np.pi * b / sr); th = 2 * np.pi * f / sr; y = lfilter([1 - r], [1, -2 * r * np.cos(th), r * r], y)
    return (0.5 * y / np.max(np.abs(y))).astype(np.float32)


VOWELS = {'700/1220': (700.0, 1220.0), 'a 800/1150': (800.0, 1150.0), '500/1500': (500.0, 1500.0), 'i 400/2000': (400.0, 2000.0)}
# pyworld must pass every vowel. rubberband's cepstral formant model is vowel-dependent (measured: ~2% on /a/, 10-17% on close vowels), so it is
# gated on the open vowel and the others are reported only (documented limitation; pyworld is the default backend).
GATE = {'pyworld': set(VOWELS), 'rubberband': {'a 800/1150'}}


def selftest(backend='all'):
    semi = 7; ok = True; names = list(BACKENDS) if backend == 'all' else [backend]
    for b in names:
        if not available(b): print(f'{b}: SKIP (not available)'); continue
        for vn, forms in VOWELS.items():
            x = synth_vowel(forms=forms); f0o = f0_median(x, SR); fo = formants_lpc(x, SR)
            y = BACKENDS[b](x, SR, semi); f0n = f0_median(y, SR); fn = formants_lpc(y, SR)
            cents = 1200 * np.log2(f0n / f0o) - semi * 100; err = [abs(a / c - 1) for a, c in zip(fn, fo)] if len(fn) == 2 == len(fo) else [9]
            good = abs(cents) <= 30 and max(err) <= 0.10; gated = vn in GATE[b]; ok &= good or not gated
            print(f'{b} [{vn}]: +{semi} st f0 {f0o:.1f}->{f0n:.1f} Hz ({cents:+.1f} cents), formants {[round(v) for v in fo]}->{[round(v) for v in fn]} (err {max(err) * 100:.1f}%) {"PASS" if good else "FAIL"}{"" if gated else " (reported only)"}')
    st = parse_steps('-12..12'); p = formant_pick(6.7, st); okp = p[0] == 7 and abs(p[1]) <= 0.5 and 1200 * np.log2(p[2]) / 100 - p[1] < 1e-9
    print(f'pick(6.7) -> step {p[0]} residual {p[1]:+.2f} st (<=50 cents) {"PASS" if okp else "FAIL"}')
    print('selftest', 'PASS' if ok and okp else 'FAIL'); return 0 if ok and okp else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--selftest', action='store_true'); ap.add_argument('--backend', default='all', choices=['all', *BACKENDS])
    a = ap.parse_args()
    return selftest(a.backend) if a.selftest else ap.print_usage(sys.stderr) or 2


if __name__ == '__main__':
    sys.exit(main())
