#!/usr/bin/env python3
"""Reduce a FreePats SF2 to per-note ogg files plus a sounds@1 map (issue #181). Build-time only; the SF2 is never shipped.
    python3 -I tools/freepats/extract.py SF2 OUTDIR NAME [--vel 100] [--max-sec 4] [--q 1] [--rate 32000]
Keeps one velocity layer (the zone whose velocity range holds --vel), cuts each sample to --max-sec (looped samples are unrolled
along their loop first), fades the tail, encodes ogg vorbis mono with ffmpeg, writes OUTDIR/NAME/<note>.ogg and prints the map as JSON."""
import argparse, json, os, struct, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sf2 import sf2zones

NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
note = lambda m: f"{NAMES[m % 12]}{m // 12 - 1}"  # Strudel: c4 = MIDI 60

ap = argparse.ArgumentParser(); ap.add_argument('sf2'); ap.add_argument('out'); ap.add_argument('name')
ap.add_argument('--vel', type=int, default=100); ap.add_argument('--max-sec', type=float, default=4.0)
ap.add_argument('--q', type=float, default=1.0); ap.add_argument('--rate', type=int, default=32000)
a = ap.parse_args()
smpl, shdr, zones = sf2zones(a.sf2)
pcm = struct.unpack(f'<{len(smpl) // 2}h', smpl)
od = Path(a.out) / a.name; od.mkdir(parents=True, exist_ok=True)
seen, mp = set(), {}
for z in sorted(zones, key=lambda z: z['key'][0]):
    if not (z['vel'][0] <= a.vel <= z['vel'][1]): continue
    nm, st, en, ls, le, sr, pitch, corr = shdr[z['sample']][:8]
    root = z['root'] if z['root'] >= 0 else pitch
    if root in seen: continue
    seen.add(root)
    seg = list(pcm[st:en]); n = int(a.max_sec * sr)
    if z['mode'] in (1, 3) and le > ls:  # unroll the loop
        loop = list(pcm[ls:le]); seg = seg[:ls - st]
        while len(seg) < n: seg += loop
    seg = seg[:n]; fade = min(len(seg) // 2, int(0.15 * sr))
    for i in range(fade): seg[len(seg) - fade + i] = int(seg[len(seg) - fade + i] * (1 - (i + 1) / fade))
    raw = struct.pack(f'<{len(seg)}h', *seg)
    f = od / f'{note(root)}.ogg'.replace('#', 's')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', '-ar', str(a.rate), '-c:a', 'libvorbis', '-q:a', str(a.q), '-map_metadata', '-1', str(f)], input=raw, check=True)
    mp[note(root)] = [f'{a.name}/{f.name}']
print(json.dumps(mp))
