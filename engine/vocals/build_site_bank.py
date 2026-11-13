#!/usr/bin/env python3
"""Convert a wordbank.py bank (flat + pitched maps) into a site bank: mono 22.05 kHz ogg, relative URLs.
  python3 engine/vocals/build_site_bank.py STEM.wav WORDS_JSON OUT_DIR   (re-slices STEM with the aligned times in WORDS_JSON from an earlier bank run, then runs wordbank.py --own-file)
Own-voice stems only: the caller asserts owner provenance."""
import json, re, subprocess, sys, tempfile, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
stem, wj, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]).resolve()
meta = json.loads(Path(wj).read_text())['words']; tmp = Path(tempfile.mkdtemp()); b = tmp / 'bank'
(tmp / 't.json').write_text(json.dumps([{'word': r['word'], 'start': r['aligned_start'], 'end': r['aligned_end'], 'score': r.get('confidence', 1.0)} for r in meta]))
(tmp / 'l.txt').write_text('\n'.join(r['word'] for r in meta))
subprocess.run([sys.executable, str(ROOT / 'engine/vocals/wordbank.py'), stem, str(tmp / 'l.txt'), str(b), '--timings', str(tmp / 't.json'), '--own-file'], check=True)
if out.exists(): shutil.rmtree(out)
def conv(p, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-ac', '1', '-ar', '22050', '-c:a', 'libvorbis', '-q:a', '1', dst], check=True)
def f(u, sub):
    p = Path(re.sub('^file://', '', u)); conv(p, out / sub / 'ogg' / (p.stem + '.ogg')); return 'ogg/' + p.stem + '.ogg'
for sub in ('', 'pitched'):
    m = json.loads((b / sub / 'strudel.json').read_text())
    new = {k: ({n: [f(u, sub) for u in us] for n, us in v.items()} if isinstance(v, dict) else [f(u, sub) for u in v]) for k, v in m.items()}
    (out / sub / 'strudel.json').write_text(json.dumps(new) + '\n')
W = json.loads((b / 'words.json').read_text()); W['source'] = 'call-me-baby vocals (owner)'; W['sr'] = 22050
for r in W['words']:
    if r.get('file'): r['file'] = 'ogg/' + Path(r['file']).stem + '.ogg'
(out / 'words.json').write_text(json.dumps(W) + '\n'); shutil.rmtree(tmp); print('ok', out)
