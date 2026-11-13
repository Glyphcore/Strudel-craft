"""Opt-in TTS fallback for words missing from the user's stem. Glyphcore/Strudel-craft#46 (word-vocals P5)

Only imported/called when wordbank.py gets --tts-fallback; without the flag this module is never loaded and no network call exists in the run.
All network access is isolated in fetch_bytes() (swap `fetch` in tests). Clips come from Shabda speech (https://shabda.ndre.gr, speech via
Google TTS); each clip is recorded in words.json with source:'tts', its URL and licence text. Shabda states no per-clip licence, so we record
that plainly instead of asserting one: check provider terms before publishing audio.
"""
import json, re, urllib.parse, urllib.request
from pathlib import Path

HOST = 'https://shabda.ndre.gr'
LICENCE = 'unspecified: Shabda speech clips are synthesised via Google TTS; Shabda publishes no per-clip licence, verify provider terms before redistributing'


def fetch_bytes(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': 'strudel-craft-wordbank'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fill(missing, out, bank, sr, slug, fetch=fetch_bytes, language='en-GB'):
    """missing: unique lyric words absent from the stem bank. -> (strudel_map_additions, meta_records). Words Shabda cannot serve are skipped with a stderr note."""
    import io, sys, numpy as np, soundfile as sf, librosa
    smap, meta = {}, []
    for w in missing:
        s = slug(w); q = re.sub(r"[^A-Za-z']", '', w).lower()
        if not q: continue
        try:
            listing = json.loads(fetch(f'{HOST}/speech/{urllib.parse.quote(q)}.json?language={language}'))
            rel = next(c['url'] for c in listing if c.get('bank') == q and c.get('url'))
            url = f'{HOST}/{rel}'
            x, r = sf.read(io.BytesIO(fetch(url)), always_2d=True)
        except Exception as ex:
            print(f'tts-fallback: no clip for "{w}" ({ex})', file=sys.stderr); continue
        x = x.mean(axis=1).astype(np.float64)
        if r != sr: x = librosa.resample(x, orig_sr=r, target_sr=sr)
        p = Path(out) / 'wav' / f'tts_{s}.wav'; sf.write(p, x.astype(np.float32), sr, subtype='FLOAT')
        smap.setdefault(f'{bank}_{s}', []).append(p.resolve().as_uri())
        meta.append({'word': w, 'key': f'{bank}_{s}', 'n': 0, 'source': 'tts', 'provider': 'shabda', 'url': url, 'licence': LICENCE, 'file': str(p.relative_to(out)), 'dur': round(len(x) / sr, 4), 'syllables': []})
    return smap, meta
