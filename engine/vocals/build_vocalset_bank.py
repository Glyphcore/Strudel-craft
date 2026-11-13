#!/usr/bin/env python3
"""VocalSet (CC BY 4.0, Zenodo 1193957) long_tones -> site bank of sustained vowels. Glyphcore/Strudel-craft word-vocals banks.
  python3 engine/vocals/build_vocalset_bank.py RAW_DIR OUT_DIR     RAW_DIR/<singer>/<technique>/<vowel>.wav (fetched with remotezip range reads, see site/data/vox/vocalset/README.md)
Per file: trim silence, take the steadiest ~3 s (lowest f0 spread), fade, detect median f0 (pyin) -> note name. Keys vs_<vowel>_<technique> = {note: [urls]} (several singers
fill several pitches, so note() retunes from the nearest one); vs_<vowel> = straight alias. Mono 22.05 kHz ogg."""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, soundfile as sf, librosa
raw, out = Path(sys.argv[1]), Path(sys.argv[2]).resolve(); SR = 22050; WIN = 3.0
NN = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
if out.exists(): shutil.rmtree(out)
(out / 'ogg').mkdir(parents=True); m = {}; meta = []
for f in sorted(raw.glob('*/*/*.wav')):
    singer, tech, v = f.parts[-3], f.parts[-2], f.stem
    x, sr = sf.read(f, dtype='float32', always_2d=True); x = librosa.resample(x.mean(axis=1), orig_sr=sr, target_sr=SR)
    nz = np.where(librosa.feature.rms(y=x, hop_length=256)[0] > 0.05 * np.max(librosa.feature.rms(y=x, hop_length=256)))[0]
    if len(nz) < 10: continue
    x = x[nz[0] * 256:(nz[-1] + 1) * 256]
    f0, vf, _ = librosa.pyin(x, fmin=65, fmax=1000, sr=SR, frame_length=2048, hop_length=512); hop = 512 / SR
    n = int(WIN / hop); best = (1e9, 0)
    if len(x) / SR > WIN + 0.2:
        for s in range(0, len(f0) - n, 4):
            w = f0[s:s + n]; ok = np.isfinite(w)
            if ok.mean() > .8:
                sp = np.nanstd(12 * np.log2(w[ok])); best = min(best, (sp, s))
        i0 = int(best[1] * 512); seg = x[i0:i0 + int(WIN * SR)]; fw = f0[best[1]:best[1] + n]
    else:
        seg = x; fw = f0
    fw = fw[np.isfinite(fw)]
    if len(fw) < 5: continue
    midi = int(round(float(np.median(69 + 12 * np.log2(fw / 440.0)))))
    seg = seg / max(1e-6, np.max(np.abs(seg))) * 0.89; fi, fo = int(.03 * SR), int(.08 * SR); seg = seg.copy(); seg[:fi] *= np.linspace(0, 1, fi); seg[-fo:] *= np.linspace(1, 0, fo)
    note = f'{NN[midi % 12]}{midi // 12 - 1}'; name = f'{v}_{tech}_{singer}.ogg'
    t = Path(tempfile.mkdtemp()) / 'a.wav'; sf.write(t, seg, SR)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', t, '-ac', '1', '-c:a', 'libvorbis', '-q:a', '2', out / 'ogg' / name], check=True)
    m.setdefault(f'vs_{v}_{tech}', {}).setdefault(note, []).append('ogg/' + name)
    meta.append({'vowel': v, 'technique': tech, 'singer': singer, 'note': note, 'dur': round(len(seg) / SR, 2), 'file': 'ogg/' + name})
for v in 'aeiou':
    if f'vs_{v}_straight' in m: m[f'vs_{v}'] = m[f'vs_{v}_straight']
for sub in ('', 'pitched'):  # pitched/ map points up at the shared ogg/ folder
    pre = '../' if sub else ''; (out / sub).mkdir(exist_ok=True)
    (out / sub / 'strudel.json').write_text(json.dumps({k: {n: [pre + u for u in us] for n, us in v.items()} for k, v in m.items()}) + '\n')
(out / 'words.json').write_text(json.dumps({'bank': 'vs', 'source': 'VocalSet 1.2 long_tones (CC BY 4.0), singers ' + ', '.join(sorted({r['singer'] for r in meta})), 'sr': SR, 'words': meta}) + '\n')
print(json.dumps({'files': len(meta), 'keys': len(m), 'notes': sorted({r['note'] for r in meta})}))
