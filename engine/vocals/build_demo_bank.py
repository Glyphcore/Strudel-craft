#!/usr/bin/env python3
"""Build the licence-clean demo vox bank (site/data/vox/demo/) from espeak-ng speech. No Suno/user audio.
  python3 engine/vocals/build_demo_bank.py [OUT_DIR]   needs espeak-ng, ffmpeg, wordbank.py deps. Pipeline: espeak-ng clips -> one stem + timings -> wordbank.py bank
  -> mono 22.05 kHz ogg with relative URLs (strudel.json flat, pitched/strudel.json retunable, words.json)."""
import json, re, subprocess, sys, tempfile, shutil
from pathlib import Path
import numpy as np, soundfile as sf, librosa
ROOT = Path(__file__).resolve().parents[2]
WORDS = "call me baby la hey oh yeah time edge night love heart fire light dark dance move feel need want know say go run fall rise down up high low sky star moon sun rain dream song voice sound beat bass drop break tonight forever again alone together never stay".split()
SR = 22050
out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'site/data/vox/demo').resolve()
tmp = Path(tempfile.mkdtemp()); parts, tim, t = [], [], 0.0
for w in WORDS:
    subprocess.run(['espeak-ng', '-v', 'en-us', '-p', '50', '-s', '120', '-w', str(tmp / 'x.wav'), w], check=True)
    y, sr = librosa.load(tmp / 'x.wav', sr=SR, mono=True); y, _ = librosa.effects.trim(y, top_db=35)
    gap = np.zeros(int(.5 * SR), np.float32); tim.append({'word': w, 'start': t + .25, 'end': t + .25 + len(y) / SR}); parts += [gap, y]; t += .5 + len(y) / SR
sf.write(tmp / 'stem.wav', np.concatenate(parts + [gap]), SR)
(tmp / 't.json').write_text(json.dumps(tim)); (tmp / 'l.txt').write_text(' '.join(WORDS))
b = tmp / 'bank'
subprocess.run([sys.executable, str(ROOT / 'engine/vocals/wordbank.py'), str(tmp / 'stem.wav'), str(tmp / 'l.txt'), str(b), '--timings', str(tmp / 't.json'), '--own-file', '--no-norm'], check=True)
if out.exists(): shutil.rmtree(out)
def conv(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', str(SR), '-c:a', 'libvorbis', '-q:a', '1', dst], check=True)
for sub in ('', 'pitched'):
    m = json.loads((b / sub / 'strudel.json').read_text()); new = {}
    for k, v in m.items():
        f = lambda u: (lambda p: (conv(p, out / sub / 'ogg' / (p.stem + '.ogg')), 'ogg/' + p.stem + '.ogg')[1])(Path(re.sub('^file://', '', u)))
        new[k] = {n: [f(u) for u in us] for n, us in v.items()} if isinstance(v, dict) else [f(u) for u in v]
    (out / sub / 'strudel.json').write_text(json.dumps({'_base': './', **new}, indent=0) + '\n') if False else (out / sub / 'strudel.json').write_text(json.dumps(new, indent=0) + '\n')
W = json.loads((b / 'words.json').read_text()); W['source'] = 'espeak-ng demo'; W['sr'] = SR
for r in W['words']:
    r['file'] = 'ogg/' + Path(r.get('file', '')).stem + '.ogg' if r.get('file') else None
(out / 'words.json').write_text(json.dumps(W) + '\n'); shutil.rmtree(tmp)
print(len(WORDS), 'words ->', out)
