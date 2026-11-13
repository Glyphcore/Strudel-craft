#!/usr/bin/env python3
"""LJSpeech (public domain) -> site word bank. Glyphcore/Strudel-craft word-vocals banks.
  python3 engine/vocals/build_ljspeech_bank.py LJ_DIR OUT_DIR [--words 500] [--takes 3] [--utts 2500] [--cache align.json]
LJ_DIR holds wavs + metadata.csv (a subset is fine; fetch with a streamed tar read, see site/data/vox/ljspeech/README.md).
Steps: forced alignment of each utterance (whisperX / wav2vec2, same model as wordbank.py), pick ~N common English + lyric words with up to K best takes,
stitch the picks into one stem, run wordbank.py --timings (flat + pitched maps), then convert to mono 22.05 kHz ogg and drop syllable keys."""
import argparse, json, re, shutil, subprocess, sys, tempfile, collections
from pathlib import Path
import numpy as np, soundfile as sf
ROOT = Path(__file__).resolve().parents[2]
LYRIC = """love heart baby night light fire dream dreams dance dancing tonight sky rain sun moon stars star home time life world feel hold close eyes
tears cry cold dark shadow shadows burn burning fall falling rise high low sweet kiss touch hands arms body soul mind free wild run running
come go stay leave gone back again forever never always ever yes no oh hey me you we us my your our mine now here there down up over under
away together alone lonely broken heaven hell angel devil blood pain hurt hope fear fly flying wind water ocean sea river gold silver black white red blue
night day morning tomorrow yesterday long song sing voice sound
""".split()


def clean(t):
    return [w for w in re.sub(r"[^a-z' ]", ' ', t.lower().replace('-', ' ')).split() if re.search('[a-z]', w)]


def align_all(lj, utts, cache):
    import whisperx, torch
    import whisperx.alignment as wa
    class _One:
        def span_tokenize(self, t): return [(0, len(t))]
    wa.nltk_load = lambda *_a, **_k: _One()
    model, meta = whisperx.load_align_model(language_code='en', device='cpu')
    out = json.loads(cache.read_text()) if cache and cache.exists() else {}
    for i, (uid, words) in enumerate(utts):
        if uid in out: continue
        a = whisperx.load_audio(str(lj / f'{uid}.wav'))
        try:
            r = whisperx.align([{'text': ' '.join(words), 'start': 0.0, 'end': len(a) / 16000}], model, meta, a, 'cpu', return_char_alignments=False)
            got = [w for s in r['segments'] for w in s.get('words', [])]
            out[uid] = [[g.get('start'), g.get('end'), g.get('score', 0.0)] if g else None for g in (got + [None] * len(words))[:len(words)]] if len(got) == len(words) else None
        except Exception as ex:
            out[uid] = None
        if i % 100 == 0:
            print(i, len(utts), flush=True)
            if cache: cache.write_text(json.dumps(out))
    if cache: cache.write_text(json.dumps(out))
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('lj'); ap.add_argument('out'); ap.add_argument('--words', type=int, default=500); ap.add_argument('--takes', type=int, default=3)
    ap.add_argument('--utts', type=int, default=2500); ap.add_argument('--cache'); ap.add_argument('--no-align', action='store_true')
    a = ap.parse_args(); lj = Path(a.lj); out = Path(a.out).resolve()
    utts = []
    for l in (lj / 'metadata.csv').read_text().splitlines():
        p = l.split('|')
        if (lj / f'{p[0]}.wav').exists() and len(utts) < a.utts: utts.append((p[0], clean(p[2])))
    freq = collections.Counter(w for _, ws in utts for w in ws)
    al = align_all(lj, utts, Path(a.cache) if a.cache else None)
    cands = collections.defaultdict(list)
    for uid, ws in utts:
        r = al.get(uid)
        if not r: continue
        for w, g in zip(ws, r):
            if g and g[0] is not None and g[1] is not None and 0.12 <= g[1] - g[0] <= 0.9 and (g[2] or 0) > 0.6: cands[w].append((g[2], uid, g[0], g[1]))
    keep = [w for w in dict.fromkeys(LYRIC) if len(cands[w]) >= 1]
    for w, _ in freq.most_common():
        if len(keep) >= a.words: break
        if w not in keep and len(cands[w]) >= 2: keep.append(w)
    keep = keep[:a.words]
    sr = 22050; gap = np.zeros(int(.12 * sr), np.float32); pad = .015; chunks, tim, lyr, t = [], [], [], 0.0
    for w in keep:
        seen, picks = set(), []
        for sc, uid, s0, e0 in sorted(cands[w], reverse=True):
            if uid in seen: continue
            seen.add(uid); picks.append((sc, uid, s0, e0))
            if len(picks) >= a.takes: break
        for sc, uid, s0, e0 in picks:
            x, r = sf.read(lj / f'{uid}.wav', dtype='float32'); assert r == sr
            seg = x[max(0, int((s0 - pad) * sr)):int((e0 + pad) * sr)]
            chunks += [seg, gap]; tim.append({'word': w, 'start': t + len(gap) / sr * 0 + pad, 'end': t + pad + (e0 - s0), 'score': sc}); lyr.append(w); t += (len(seg) + len(gap)) / sr
    tmp = Path(tempfile.mkdtemp()); stem = tmp / 'stem.wav'; sf.write(stem, np.concatenate([gap] + chunks), sr)
    for d in tim: d['start'] += len(gap) / sr; d['end'] += len(gap) / sr
    (tmp / 't.json').write_text(json.dumps(tim)); (tmp / 'l.txt').write_text('\n'.join(lyr))
    b = tmp / 'bank'
    subprocess.run([sys.executable, str(ROOT / 'engine/vocals/wordbank.py'), str(stem), str(tmp / 'l.txt'), str(b), '--timings', str(tmp / 't.json'), '--own-file', '--bank', 'vox'], check=True)
    if out.exists(): shutil.rmtree(out)
    def conv(p, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-ac', '1', '-ar', '22050', '-c:a', 'libvorbis', '-q:a', '1', dst], check=True)
    for sub in ('', 'pitched'):
        m = json.loads((b / sub / 'strudel.json').read_text()); new = {}
        for k, v in m.items():
            if k.endswith('_syl') or re.search(r'_s\d+$', k): continue
            def f(u):
                p = Path(re.sub('^file://', '', u)); conv(p, out / sub / 'ogg' / (p.stem + '.ogg')); return 'ogg/' + p.stem + '.ogg'
            new[k] = {n: [f(u) for u in us] for n, us in v.items()} if isinstance(v, dict) else [f(u) for u in v]
        (out / sub / 'strudel.json').write_text(json.dumps(new) + '\n')
    W = json.loads((b / 'words.json').read_text()); W['source'] = 'LJSpeech 1.1 (public domain), subset'; W['sr'] = 22050
    for r in W['words']:
        r.pop('syllables', None)
        if r.get('file'): r['file'] = 'ogg/' + Path(r['file']).stem + '.ogg'
    W['words'] = [r for r in W['words'] if not r.get('skipped')]
    (out / 'words.json').write_text(json.dumps(W) + '\n'); shutil.rmtree(tmp)
    print(json.dumps({'words': len(keep), 'takes': len(lyr), 'out': str(out)}))
main()
