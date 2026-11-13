#!/usr/bin/env python3
"""Word-keyed vocal sample bank from forced alignment. Glyphcore/Strudel-craft#42 (word-vocals P1)

  engine/vocals/wordbank.sh STEM.wav LYRICS.txt OUT_DIR [--bank vox] [--timings T.json] [--syll rule|pyphen] [--aligner whisperx|mfa] [--no-norm] [--own-file]
  engine/vocals/wordbank.sh --selftest

Writes OUT_DIR/{strudel.json, words.json, wav/*.wav, WORDBANK.md}.
Timings (--timings): JSON list of {"word","start","end"[,"score"]} in lyric order, or {"words":[...]}; skips the aligner.
Keys: <bank>_<word> (repeats = n-indices in order), <bank>_syl (all syllables, lyric order), <bank>_<word>_s<k>.
Owner guard: STEM must sit under tracks/<slug>/ whose source/*.json handle is in data/suno/owners.json, or pass --own-file
(asserts user-recorded audio). Exit 0 ok, 1 bad input, 2 usage, 3 aligner missing, 4 owner guard refused.
"""
import argparse, json, re, sys, tempfile
from pathlib import Path
import numpy as np, soundfile as sf, librosa

SR = 48000
ROOT = Path(__file__).resolve().parents[2]


def norm_handle(h):
    return str(h or '').strip().lstrip('@').lower()


def owner_ok(stem):
    try:
        owners = [norm_handle(h) for h in json.loads((ROOT / 'data/suno/owners.json').read_text()).get('handles', [])]
    except Exception:
        return False
    owners = [o for o in owners if o]
    if not owners:
        return False
    for p in Path(stem).resolve().parents:
        if p.parent.name == 'tracks':
            for j in sorted((p / 'source').glob('*.json')):
                try:
                    c = json.loads(j.read_text())
                except Exception:
                    continue
                h = norm_handle(c.get('handle') or c.get('user_handle') or (c.get('user') or {}).get('handle'))
                if h and h in owners:
                    return True
            return False
    return False


def lyric_words(text):
    out = []
    for li, line in enumerate([l for l in text.splitlines() if l.strip()]):
        line = re.sub(r'\[[^\]]*\]', ' ', line)
        for w in line.split():
            if re.search(r'[A-Za-z0-9]', w):
                out.append((w, li))
    return out


def slug(w):
    return re.sub(r'[^a-z0-9]', '_', w.lower().encode('ascii', 'ignore').decode()).strip('_') or 'x'


def align_whisperx(stem, words):
    try:
        import whisperx, torch
    except Exception as ex:
        print(f'whisperX not installed ({ex}); use --timings T.json or pip install whisperx', file=sys.stderr); sys.exit(3)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    import whisperx.alignment as wa
    try:
        wa.nltk_load('tokenizers/punkt_tab/english.pickle')
    except LookupError:  # punkt data absent (offline): sentence spans only group output, so use one span per segment
        class _One:
            def span_tokenize(self, t): return [(0, len(t))]
        wa.nltk_load = lambda *_a, **_k: _One()
    audio = whisperx.load_audio(str(stem))
    model, meta = whisperx.load_align_model(language_code='en', device=dev)  # default en model = WAV2VEC2_ASR_BASE_960H
    seg = [{'text': ' '.join(w for w, _ in words), 'start': 0.0, 'end': len(audio) / 16000}]
    res = whisperx.align(seg, model, meta, audio, dev, return_char_alignments=False)
    ws = [w for s in res['segments'] for w in s.get('words', [])]
    out = []
    for i, (w, _) in enumerate(words):
        a = ws[i] if i < len(ws) else {}
        out.append({'word': w, 'start': a.get('start'), 'end': a.get('end'), 'score': a.get('score', 0.0)})
    return out


def align_mfa(stem, words):
    print('MFA backend is an alt: run mfa align externally and pass its word times via --timings', file=sys.stderr); sys.exit(3)


def split_syll(word, mode):
    w = re.sub(r'[^A-Za-z]', '', word).lower()
    if mode == 'pyphen':
        try:
            import pyphen
            parts = pyphen.Pyphen(lang='en_US').inserted(w).split('-')
            if parts and all(parts):
                return parts
        except Exception:
            pass
    groups = list(re.finditer(r'[aeiouy]+', w))
    if w.endswith('e') and len(groups) > 1 and not w.endswith(('le', 'ee')) and groups[-1].end() == len(w):
        groups = groups[:-1]
    if len(groups) <= 1:
        return [w or word]
    cuts = []
    for a, b in zip(groups, groups[1:]):
        cuts.append(a.end() + (b.start() - a.end()) // 2)
    cuts = [0] + cuts + [len(w)]
    return [w[x:y] for x, y in zip(cuts, cuts[1:])]


def zc_snap(x, i, sr, win=0.005):
    lo, hi = max(1, i - int(win * sr)), min(len(x) - 1, i + int(win * sr))
    if hi <= lo:
        return min(max(i, 0), len(x))
    s = np.signbit(x[lo - 1:hi + 1]); zc = np.nonzero(s[1:] != s[:-1])[0] + lo
    return int(zc[np.argmin(np.abs(zc - i))]) if len(zc) else i


def cut(x, sr, t0, t1, pad=0.010):
    a = zc_snap(x, int(max(0, t0 - pad) * sr), sr); b = zc_snap(x, int(min(len(x) / sr, t1) * sr), sr)
    seg = x[a:b].copy()
    fi, fo = min(len(seg), int(.005 * sr)), min(len(seg), int(.015 * sr))
    if fi: seg[:fi] *= np.linspace(0, 1, fi)
    if fo: seg[-fo:] *= np.linspace(1, 0, fo)
    return seg, a / sr


def f0_stats(seg, sr):
    if len(seg) < int(0.05 * sr):
        return None, None
    try:
        f0, vf, _ = librosa.pyin(seg, fmin=65, fmax=1000, sr=sr, frame_length=2048)
        v = f0[vf & ~np.isnan(f0)]
        if len(v) < 3: return None, None
        m = float(np.median(v)); return round(m, 2), int(round(librosa.hz_to_midi(m)))
    except Exception:
        return None, None


def db(x):
    r = float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0
    return round(20 * np.log10(max(r, 1e-9)), 2)


def syl_bounds(seg, n):
    if n <= 1: return [0, len(seg)]
    e = np.convolve(seg ** 2, np.ones(240) / 240, mode='same'); c = np.cumsum(e); c = c / max(c[-1], 1e-12)
    return [0] + [int(np.searchsorted(c, k / n)) for k in range(1, n)] + [len(seg)]


def build(stem, lyrics_txt, out, bank, timings, syll, norm, aligner, own):
    stem, out = Path(stem), Path(out)
    if not own and not owner_ok(stem):
        print(f'owner guard: {stem} has no owner provenance (tracks/<slug>/source/*.json handle in data/suno/owners.json); use --own-file only for audio you recorded', file=sys.stderr); return 4
    words = lyric_words(Path(lyrics_txt).read_text())
    if not words: print('no lyric words', file=sys.stderr); return 1
    if timings:
        t = json.loads(Path(timings).read_text()); t = t['words'] if isinstance(t, dict) else t
        if len(t) != len(words): print(f'timings has {len(t)} words, lyrics {len(words)}', file=sys.stderr); return 1
    else:
        t = (align_mfa if aligner == 'mfa' else align_whisperx)(stem, words)
    x, sr = sf.read(stem, always_2d=True); x = x.mean(axis=1)
    if sr != SR: x = librosa.resample(x.astype(np.float64), orig_sr=sr, target_sr=SR); sr = SR
    x = x.astype(np.float32)
    (out / 'wav').mkdir(parents=True, exist_ok=True)
    for o in (out / 'wav').glob('*.wav'): o.unlink()
    smap, meta, seen = {}, [], {}

    def write(seg, name):
        if norm and len(seg) and np.max(np.abs(seg)) > 0: seg = seg / np.max(np.abs(seg)) * 10 ** (-1 / 20)
        p = out / 'wav' / name; sf.write(p, seg.astype(np.float32), SR, subtype='FLOAT'); return seg, p

    for i, ((w, li), a) in enumerate(zip(words, t)):
        if a.get('start') is None or a.get('end') is None or a['end'] <= a['start']:
            meta.append({'word': w, 'line': li, 'index': i, 'skipped': True, 'confidence': float(a.get('score') or 0)}); continue
        s = slug(w); k = seen.get(s, 0); seen[s] = k + 1
        seg, ta = cut(x, sr, a['start'], a['end'])
        seg, p = write(seg, f'{s}_{k}.wav')
        f0, midi = f0_stats(seg, sr)
        smap.setdefault(f'{bank}_{s}', []).append(p.resolve().as_uri())
        rec = {'word': w, 'key': f'{bank}_{s}', 'n': k, 'line': li, 'occurrence': k, 'index': i, 't_start': round(ta, 4), 't_end': round(ta + len(seg) / sr, 4),
               'aligned_start': a['start'], 'aligned_end': a['end'], 'dur': round(len(seg) / sr, 4), 'f0_hz': f0, 'midi': midi, 'rms_dbfs': db(seg),
               'confidence': float(a.get('score', 1.0) if a.get('score') is not None else 1.0), 'file': str(p.relative_to(out)), 'syllables': []}
        parts = split_syll(w, syll); sb = syl_bounds(seg, len(parts))
        for j, part in enumerate(parts):
            ss = seg[sb[j]:sb[j + 1]].copy()
            if len(ss) < 16: continue
            fi, fo = min(len(ss), int(.005 * sr)), min(len(ss), int(.015 * sr)); ss[:fi] *= np.linspace(0, 1, fi); ss[-fo:] *= np.linspace(1, 0, fo)
            ss, sp = write(ss, f'{s}_{k}_s{j}.wav'); u = sp.resolve().as_uri()
            smap.setdefault(f'{bank}_{s}_s{j}', []).append(u); smap.setdefault(f'{bank}_syl', []).append(u)
            rec['syllables'].append({'text': part, 'k': j, 'syl_n': len(smap[f'{bank}_syl']) - 1, 't_start': round(ta + sb[j] / sr, 4), 't_end': round(ta + sb[j + 1] / sr, 4), 'dur': round(len(ss) / sr, 4)})
        meta.append(rec)
    (out / 'strudel.json').write_text(json.dumps(smap, indent=1) + '\n')
    (out / 'words.json').write_text(json.dumps({'bank': bank, 'source': str(stem), 'sr': SR, 'words': meta}, indent=1) + '\n')
    good = [m for m in meta if not m.get('skipped')]; hi = [m for m in good if m['confidence'] > 0.5]
    pct = 100 * len(hi) / len(words)
    voiced = sum(1 for m in good if m['f0_hz'])
    (out / 'WORDBANK.md').write_text(
        f'# Word bank `{bank}`\n\nSource: `{stem}`  \nAligner: {"timings file (" + str(timings) + ")" if timings else aligner}  \nSyllables: {syll}\n\n'
        f'- lyric words: {len(words)}\n- sliced: {len(good)}\n- aligned with confidence > 0.5: {len(hi)} ({pct:.1f}%)\n- voiced slices (f0/MIDI): {voiced}\n- sounds: {len(smap)}\n\n'
        '| key | n | word | t_start | t_end | f0 Hz | MIDI | conf |\n|---|---|---|---|---|---|---|---|\n' +
        ''.join(f"| {m['key']} | {m['n']} | {m['word']} | {m['t_start']} | {m['t_end']} | {m['f0_hz']} | {m['midi']} | {m['confidence']:.2f} |\n" for m in good))
    print(json.dumps({'words': len(words), 'sliced': len(good), 'conf_gt_0.5_pct': round(pct, 1), 'sounds': len(smap), 'map': str(out / 'strudel.json')}))
    return 0


def selftest():
    tmp = Path(tempfile.mkdtemp()); sr = SR
    truth = [('call', 0.30, 0.70, 220.0), ('me', 1.00, 1.30, 247.0), ('baby', 1.60, 2.20, 196.0), ('baby', 2.50, 2.90, 262.0)]
    x = np.zeros(int(3.2 * sr), dtype=np.float32)
    for _, a, b, f in truth:
        t = np.arange(int((b - a) * sr)) / sr; env = np.minimum(1, t / 0.004) * np.minimum(1, (b - a - t) / 0.004)
        x[int(a * sr):int(a * sr) + len(t)] = 0.5 * env * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(4 * np.pi * f * t))
    sf.write(tmp / 'stem.wav', x, sr); (tmp / 'l.txt').write_text('Call me baby\nbaby\n')
    (tmp / 't.json').write_text(json.dumps([{'word': w, 'start': a, 'end': b, 'score': 0.9} for w, a, b, _ in truth]))
    rc = build(tmp / 'stem.wav', tmp / 'l.txt', tmp / 'out', 'vox', tmp / 't.json', 'rule', True, 'whisperx', True)
    if rc: return rc
    W = json.loads((tmp / 'out/words.json').read_text())['words']; worst = 0
    for m, (w, a, b, _) in zip(W, truth):
        y, _ = sf.read(tmp / 'out' / m['file']); idx = np.nonzero(np.abs(y) > 0.1 * np.max(np.abs(y)))[0]
        s0 = m['t_start'] + idx[0] / sr; s1 = m['t_start'] + (idx[-1] + 1) / sr
        worst = max(worst, abs(s0 - a), abs(s1 - b))
        print(f'{w} n={m["n"]}: onset err {abs(s0 - a) * 1000:.1f} ms, end err {abs(s1 - b) * 1000:.1f} ms, f0 {m["f0_hz"]} midi {m["midi"]}')
    sm = json.loads((tmp / 'out/strudel.json').read_text())
    ok = worst <= 0.010 and all(m['f0_hz'] for m in W) and {'vox_call', 'vox_me', 'vox_baby', 'vox_syl'} <= set(sm) and len(sm['vox_baby']) == 2
    print(f'worst boundary error {worst * 1000:.1f} ms; selftest {"PASS" if ok else "FAIL"}; out {tmp / "out"}')
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('stem', nargs='?'); ap.add_argument('lyrics', nargs='?'); ap.add_argument('out', nargs='?')
    ap.add_argument('--bank', default='vox'); ap.add_argument('--timings'); ap.add_argument('--syll', choices=['rule', 'pyphen'], default='rule')
    ap.add_argument('--aligner', choices=['whisperx', 'mfa'], default='whisperx'); ap.add_argument('--no-norm', action='store_true')
    ap.add_argument('--own-file', action='store_true'); ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest: return selftest()
    if not (a.stem and a.lyrics and a.out): ap.print_usage(sys.stderr); return 2
    return build(a.stem, a.lyrics, a.out, a.bank, a.timings, a.syll, not a.no_norm, a.aligner, a.own_file)


if __name__ == '__main__':
    sys.exit(main())
