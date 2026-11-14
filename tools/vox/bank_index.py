#!/usr/bin/env python3
"""Bank index pack for the site's Banks browser (issue #85).

Writes, under site/data/vox/:
  banks.json      one small summary per shipped vox bank: kind (word / sound), key prefix, word and clip counts, pitches,
                  licence and attribution, and the ingredient ids of its words.json and pitched/strudel.json
  craftpack.json  pack `glyphcore/vox`: banks.json plus each bank's words.json and pitched/strudel.json as `manual` ingredients
                  of the data-only extension kind `x-glyphcore.vox-data@1`, hash-pinned (tools/packs/packs.py hash)
and pins the manifest in site/packs.lock.json (entry `glyphcore/vox`, source `file:data/vox`).

The site reads these files only through the pack loader (packs.raw), and only when the Banks panel or a bank is opened, or when
word(" completions need the active bank. Audio is never listed here and never preloaded.

    python3 tools/vox/bank_index.py            # rewrite banks.json, craftpack.json hashes and the lock pin
    python3 tools/vox/bank_index.py --check    # exit 1 when any of them is stale (pages.yml runs both)
"""
import hashlib, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VOX = ROOT / "site" / "data" / "vox"
LOCK = ROOT / "site" / "packs.lock.json"
sys.path.insert(0, str(ROOT / "tools" / "packs"))
import packs as P  # noqa: E402

# licence and credit per shipped bank (from each bank's README and engine/vocals/LICENSES.md in suno-track-lab)
BANKS = {
    "demo": {"title": "Demo (espeak-ng speech)", "voice": "speech", "license": "LicenseRef-undecided",
             "licence": "first-party render, licence open (#66)",
             "attribution": [{"name": "espeak-ng speech synthesiser", "url": "https://github.com/espeak-ng/espeak-ng", "text": "Rendered with espeak-ng (the tool is GPL-3.0; the rendered audio is first-party)"}]},
    "call-me-baby": {"title": "Call me baby (owner vocals)", "voice": "sung", "license": "LicenseRef-undecided",
                     "licence": "owner's own vocals, licence open (#66)",
                     "attribution": [{"name": "call-me-baby vocals (owner)", "text": "The site owner's own vocal stem, cut into words"}]},
    "ljspeech": {"title": "LJSpeech words", "voice": "speech", "license": "LicenseRef-public-domain",
                 "licence": "public domain",
                 "attribution": [{"name": "LJ Speech Dataset 1.1, Keith Ito", "url": "https://keithito.com/LJ-Speech-Dataset/", "text": "LJSpeech 1.1 (Keith Ito; LibriVox readings), public domain", "changes": "word takes cut, peak-normalised, mono 22.05 kHz ogg"}]},
    "vocalset": {"title": "VocalSet sustained vowels", "voice": "sung", "license": "CC-BY-4.0",
                 "licence": "CC BY 4.0",
                 "attribution": [{"name": "VocalSet: A Singing Voice Dataset, Julia Wilkins et al.", "url": "https://doi.org/10.5281/zenodo.1193957", "license": "CC-BY-4.0", "text": "VocalSet: A Singing Voice Dataset, Julia Wilkins et al., https://doi.org/10.5281/zenodo.1193957", "changes": "trimmed to the steadiest ~3 s, faded, peak-normalised, mono 22.05 kHz ogg"}]},
    "sung": {"title": "Sung words (SoulX-Singer)", "voice": "sung", "license": "Apache-2.0 AND CC-BY-4.0",
             "licence": "Apache-2.0 engine render; CC BY 4.0 timbre prompt (VocalSet)",
             "attribution": [{"name": "SoulX-Singer (Soul-AILab)", "url": "https://github.com/Soul-AILab/SoulX-Singer", "license": "Apache-2.0", "text": "Synthesised with SoulX-Singer (Apache-2.0)"},
                             {"name": "VocalSet: A Singing Voice Dataset, Julia Wilkins et al.", "url": "https://doi.org/10.5281/zenodo.1193957", "license": "CC-BY-4.0", "text": "Timbre prompt: VocalSet female6 long tones, CC BY 4.0", "changes": "used as a zero-shot timbre prompt; the clips are new synthetic audio"}]},
}
SKIP = re.compile(r"_s\d+$|_syl$|^_|_f-?\d+$")  # syllables, the syllable index, private keys, formant variants
NAMES = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def midi(n):
    m = re.match(r"^([a-g])(#|b|s)?(-?\d+)$", str(n).lower())
    if not m:
        return 999
    return NAMES[m.group(1)] + (1 if m.group(2) in ("#", "s") else -1 if m.group(2) == "b" else 0) + 12 * (int(m.group(3)) + 1)


def summary(name):
    d = VOX / name
    words = json.loads((d / "words.json").read_text())
    pmap = json.loads((d / "pitched" / "strudel.json").read_text())
    keys = [k for k in pmap if not SKIP.search(k)]
    urls, notes = set(), set()
    for k in keys:
        v = pmap[k]
        if isinstance(v, dict):
            for n, us in v.items():
                notes.add(n)
                urls.update(us)
        else:
            urls.update(v)
    prefix = words.get("bank") or keys[0].split("_")[0]
    kind = "word" if any("word" in w for w in words.get("words", [])) else "sound"
    ns = sorted(notes, key=midi)
    meta = BANKS[name]
    return {
        "name": name, "title": meta["title"], "kind": kind, "prefix": prefix, "voice": meta["voice"],
        "words": len(keys), "clips": len(urls), "notes": ns if len(ns) <= 12 else [], "range": [ns[0], ns[-1]] if ns else [],
        "pitch": "sung" if name in ("sung", "vocalset") else "natural",
        "source": words.get("source", ""), "license": meta["license"], "licence": meta["licence"], "attribution": meta["attribution"],
        "words_ingredient": f"{name}-words", "map_ingredient": f"{name}-map", "map": f"{name}/pitched/strudel.json",
    }


def manifest():
    ings = [{"id": "index", "kind": "x-glyphcore.vox-data", "format": "x-glyphcore.vox-data@1", "version": "1.0.0", "path": "banks.json",
             "title": "Bank index", "description": "One summary per bank (kind, counts, pitches, licence)", "load": "manual", "hash": "", "bytes": 0}]
    for name, meta in BANKS.items():
        for part, path, what in (("words", f"{name}/words.json", "per clip words, takes, durations"), ("map", f"{name}/pitched/strudel.json", "pitched sample map: key -> {note: [clip urls]}")):
            ings.append({"id": f"{name}-{part}", "kind": "x-glyphcore.vox-data", "format": "x-glyphcore.vox-data@1", "version": "1.0.0", "path": path,
                         "title": f"{meta['title']}: {part}", "description": what, "load": "manual", "license": meta["license"], "attribution": meta["attribution"], "hash": "", "bytes": 0})
    return {"craftpack": "1.0.0", "id": "glyphcore/vox", "version": "1.0.0", "title": "Vox bank index",
            "description": "What each shipped vox bank holds (words.json and pitched/strudel.json per bank plus a summary), read by the Banks browser and word() completions only when opened. Audio is not listed; clips stream on audition or play.",
            "license": "LicenseRef-per-ingredient", "licenseFile": "LICENSES.md", "ingredients": ings}


def main(argv):
    check = "--check" in argv
    stale = []
    idx = {"vox-index": 1, "generator": "python3 tools/vox/bank_index.py", "banks": [summary(n) for n in BANKS]}
    text = json.dumps(idx, indent=1, ensure_ascii=False) + "\n"
    bf = VOX / "banks.json"
    if not bf.is_file() or bf.read_text() != text:
        stale.append("banks.json")
        if not check:
            bf.write_text(text)
    mf = VOX / "craftpack.json"
    want = manifest()
    if mf.is_file():
        cur = json.loads(mf.read_text())
        for a, b in zip(cur.get("ingredients", []), want["ingredients"]):
            if a.get("id") == b["id"]:
                b["hash"], b["bytes"] = a.get("hash", ""), a.get("bytes", 0)
    if not mf.is_file() or json.loads(mf.read_text()) != want:
        stale.append("craftpack.json")
        if not check:
            mf.write_bytes(P.dump(want))
    changes, _ = P.cmd_hash(VOX, write=not check, check=check)
    stale += changes
    mh = "sha256:" + hashlib.sha256(mf.read_bytes()).hexdigest()
    lock = json.loads(LOCK.read_text())
    e = next((x for x in lock["packs"] if x["id"] == "glyphcore/vox"), None)
    if not e or e["manifest"] != mh:
        stale.append("lock glyphcore/vox manifest")
        if not check:
            if not e:
                e = {"id": "glyphcore/vox", "version": "1.0.0", "source": "file:data/vox", "manifest": mh, "priority": 0, "allowCode": [], "dependencies": {}}
                lock["packs"].append(e)
            e["manifest"] = mh
            LOCK.write_text(json.dumps(lock, indent=2) + "\n")
    print(("stale: " if check else "updated: ") + ", ".join(stale) if stale else "vox bank index is in step with site/data/vox")
    return 1 if check and stale else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
