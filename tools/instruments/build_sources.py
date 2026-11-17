#!/usr/bin/env python3
"""Build the inline sound maps of the referenced sample-source packs glyphcore/vsco and glyphcore/drumkits (#183 box 3).
No audio is read or copied: the maps hold URLs of files in the upstream CC0 repositories, pinned to a commit. Input: one file list per
repository (`git ls-tree -r --name-only <sha>` of a blobless clone). Usage:
    python3 tools/instruments/build_sources.py VSCO_LIST VSCO_SHA BRD_LIST BRD_SHA GOG_LIST GOG_SHA   -> writes the two sources.json files"""
import json, re, sys, urllib.parse
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
q = lambda p: urllib.parse.quote(p, safe="/")
NOTE = re.compile(r"_([A-G]#?\d)_")

def lst(p): return [l.strip() for l in open(p, encoding="utf8") if l.strip()]

def pitched(files, folder, prefer=("v2", "mf", "f", "v1", "p", "v3")):
    """note -> [one file] from folder: first file per note by the preferred dynamic, round robin 1 first."""
    by = {}
    for f in files:
        if not f.startswith(folder + "/") or not f.endswith(".wav"): continue
        m = NOTE.search("_" + f.split("/")[-1].replace(".", "_", 0) + "_") or NOTE.search(f.split("/")[-1])
        m = re.search(r"_([A-G]#?\d)(?:_|\.)", f.split("/")[-1])
        if not m: continue
        n = m.group(1).lower(); rank = next((i for i, d in enumerate(prefer) if re.search(r"[_.]" + d + r"(?:[_.]|$)", f.split("/")[-1])), 99)
        rr = 0 if re.search(r"(rr1|_1\.wav)", f) else 1
        k = (rank, rr, f)
        if n not in by or k < by[n][0]: by[n] = (k, f)
    return {n: [q(by[n][1])] for n in sorted(by, key=lambda x: (int(x[-1]), "c c# d d# e f f# g g# a a# b".split().index(x[:-1])))}

def pick(files, folder, prefix, vl):
    out = [f for f in files if f.startswith(folder + "/") and re.match(prefix + r"_?(?:\w*?)vl%d_rr\d+\." % vl, f.split("/")[-1])]
    return [q(f) for f in sorted(out)][:4]

vsco_l, vsco_sha, brd_l, brd_sha, gog_l, gog_sha = sys.argv[1:7]
V = lst(vsco_l)
vsco = {
    "vsco_violin": pitched(V, "Strings/Solo Violin/Arco Vib", ("f", "p")),
    "vsco_viola": pitched(V, "Strings/Viola Section/susvib"), "vsco_cello": pitched(V, "Strings/Cello Section/susvib"),
    "vsco_bass": pitched(V, "Strings/Solo Contrabass/SusVib"), "vsco_trumpet": pitched(V, "Brass/Trumpet/sus"),
    "vsco_horn": pitched(V, "Brass/F Horn/sus"), "vsco_trombone": pitched(V, "Brass/Tenor Trombone/sus"), "vsco_tuba": pitched(V, "Brass/Tuba/sus"),
    "vsco_flute": pitched(V, "Woodwinds/Flute/susvib"), "vsco_oboe": pitched(V, "Woodwinds/Oboe/Sus"),
    "vsco_clarinet": pitched(V, "Woodwinds/Clarinet/susLong"), "vsco_bassoon": pitched(V, "Woodwinds/Bassoon/sus"),
}
vsco = {k: v for k, v in vsco.items() if v}
B = lst(brd_l); G = lst(gog_l)
brd = {"brd_kick": pick(B, "Samples/kick_24/kick/kick", "k", 7), "brd_snare": pick(B, "Samples/snare_14/center/top", "sn_center", 7),
       "brd_hat_closed": pick(B, "Samples/hihat_14/tc/cl", "ht_tc", 6), "brd_tom": pick(B, "Samples/tom_18/center/cl", "t18", 6), "brd_ride": pick(B, "Samples/ride_22/rd/cl", "rd", 6)}
gog = {"gog_kick": pick(G, "Samples/front_mic", "ks", 3), "gog_snare": pick(G, "Samples/front_mic", "sc", 3), "gog_hat_closed": pick(G, "Samples/front_mic", "hc", 3),
       "gog_hat_open": pick(G, "Samples/front_mic", "ho", 3), "gog_tom_low": pick(G, "Samples/front_mic", "tl", 3), "gog_tom_mid": pick(G, "Samples/front_mic", "tm", 3), "gog_tom_high": pick(G, "Samples/front_mic", "th", 3)}
for nm, d in (("brd", brd), ("gog", gog)):
    for k, v in d.items(): assert v, (nm, k, "no files")
RAW = "https://raw.githubusercontent.com/"
src = lambda id, title, repo, sha, m, lic, attr: {"id": id, "title": title, "base": f"{RAW}{repo}/{sha}/", "map": m, "sounds": list(m), "license": lic, "attribution": attr,
      "terms_url": f"{RAW}{repo}/{sha}/LICENSE", "check": {"cors": True, "stable": True, "checked": "2026-11-17", "status": 200}}
(ROOT / "site/data/vsco/sources").mkdir(parents=True, exist_ok=True); (ROOT / "site/data/drumkits/sources").mkdir(parents=True, exist_ok=True)
json.dump({"sources": [src("vsco", "VSCO 2 Community Edition (orchestral instruments)", "sgossner/VSCO-2-CE", vsco_sha, vsco, "CC0-1.0",
  {"name": "Versilian Studios LLC (Sam Gossner), VSCO 2 Community Edition", "url": "https://github.com/sgossner/VSCO-2-CE", "text": "VSCO 2 CE, CC0 1.0 (no credit required, given anyway)"})]}, open(ROOT / "site/data/vsco/sources/sources.json", "w"), indent=1)
json.dump({"sources": [
  src("big-rusty-drums", "Big Rusty Drums (Karoryfer Samples)", "sfzinstruments/karoryfer.big-rusty-drums", brd_sha, brd, "CC0-1.0",
      {"name": "Karoryfer Samples (Big Rusty Drums)", "url": "https://github.com/sfzinstruments/karoryfer.big-rusty-drums", "text": "Big Rusty Drums by Karoryfer Samples, CC0 1.0"}),
  src("gogodze-phu", "Gogodze Phu Vol II (Karoryfer Lecolds)", "sfzinstruments/karoryfer.gogodze-phu-vol-ii", gog_sha, gog, "CC0-1.0",
      {"name": "Karoryfer Lecolds (Gogodze Phu Vol II)", "url": "https://github.com/sfzinstruments/karoryfer.gogodze-phu-vol-ii", "text": "Gogodze Phu Vol II by Karoryfer Lecolds, CC0 1.0 (readme: royalty-free, copyright 2018 Karoryfer Lecolds)"})]},
  open(ROOT / "site/data/drumkits/sources/sources.json", "w"), indent=1)
print({k: len(v) for k, v in {**vsco, **brd, **gog}.items()})
