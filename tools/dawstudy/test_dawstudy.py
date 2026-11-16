#!/usr/bin/env python3
"""One behavioural check per format (synthetic fixtures), the licence gate, check and forms. Run: python3 tools/dawstudy/test_dawstudy.py"""
import json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import common, dawstudy, fixtures
fails = []; tmp = tempfile.mkdtemp(prefix="dawstudy_")
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: fails.append(m)
WANT = [("intro", 8, 2), ("drop", 16, 5), ("outro", 8, 2)]
prov = {"url": "synthetic", "page_url": "synthetic", "author": "strudel-craft tests", "title": "fixture", "licence": "CC0 1.0", "licence_class": "cc0",
        "accessed": "2026-11-16", "sha256": "0", "bytes": 1, "format": "x", "parser": "dawstudy", "kept": "statistics only"}
for ext, fn in fixtures.ALL.items():
    p = os.path.join(tmp, "fx" + ext); open(p, "wb").write(fn())
    s = dawstudy.stats_file(p, prov)
    got = [(x["role"], x["bars"], x["layers_median"]) for x in s["sections"]]
    if ext in (".mmp", ".mmpz"):  # no markers in LMMS: inferred sections, labelled by density
        want = [("intro", 8, 2), ("peak", 16, 5), ("outro", 8, 2)]
    else: want = WANT
    ok(s["tempo"] == 140 and s["length_bars"] == 32 and got == want, "%s tempo %s bars %s sections %s" % (ext, s["tempo"], s["length_bars"], got))
    open(os.path.join(tmp, "fx%s.stats.json" % ext.replace(".", "_")), "w").write(json.dumps(s))
    blob = json.dumps(s)
    ok(not any(w in blob for w in ("Kick", "Snare", "Pad\"", "MidiNoteEvent")), "%s no track names or note data in output" % ext)
# format-specific features
s = dawstudy.stats_file(os.path.join(tmp, "fx.als"))
ok(s["routing"]["sidechains"] == 1 and s["routing"]["sends"] == 1 and any(a["shape"] == "rise" and a["target"] == "volume" for a in s["automation"]), "als sidechain, send, volume rise")
s = dawstudy.stats_file(os.path.join(tmp, "fx.mmp"))
ok(any(a["target"] == "cutoff" and a["shape"] == "rise" for a in s["automation"]) and "reverb" in s["fx"]["type_frequency"], "mmp cutoff rise automation, reverb fx")
s = dawstudy.stats_file(os.path.join(tmp, "fx.flp"))
ok(s["fx"]["type_frequency"].get("sidechain") == 1 and s["routing"]["sidechains"] == 1, "flp mixer fx incl. peak-controller sidechain")
# tension from project data: the mmp fixture has a cutoff ramp bars 1-5 and the drop at bar 9 (layers 2 -> 5)
s = dawstudy.stats_file(os.path.join(tmp, "fx.mmp"))
k = {(e["kind"], e["bar"]) for e in s["tension"]}
ok(("build", 1) in k and ("drop", 9) in k and ("breakdown", 25) in k, "tension: build @1, drop @9, breakdown @25 from automation ramp + density steps %s" % sorted(k))
# licence gate (fail closed)
cases = {"Creative Commons (by)": "by", "Creative Commons (by-sa)": "by-sa", "CC0 1.0": "cc0", "Creative Commons (by-nc)": None,
         "Creative Commons (by-nc-sa)": None, "Creative Commons (by-nd)": None, "Copyright": None, "": None, "GNU GPL": "gpl", "Free Art License": "fal"}
ok(all(common.licence_class(k) == v for k, v in cases.items()), "licence gate %s" % {k: common.licence_class(k) for k in cases})
# check + forms
ok(dawstudy.check(tmp) == 0, "check: complete provenance passes")
bad = dict(json.load(open(os.path.join(tmp, "fx_als.stats.json")))); bad["provenance"] = dict(prov, licence="Creative Commons (by-nc)")
d2 = tempfile.mkdtemp(prefix="dawstudy_bad_"); open(os.path.join(d2, "b.stats.json"), "w").write(json.dumps(bad))
ok(dawstudy.check(d2) == 1, "check: NC licence record rejected")
P = dawstudy.forms([os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith(".stats.json")], "fixture")
ok(P["n"] == 6 and P["section_bars_median"]["outro"] == 8 and P["layers_median_by_section"]["outro"] == 2, "forms: n %d outro bars %s" % (P["n"], P["section_bars_median"].get("outro")))
# batch pipeline + form bank (fixtures with provenance sidecars, one genre)
bd = tempfile.mkdtemp(prefix="dawstudy_batch_"); pd = os.path.join(bd, "proj"); os.makedirs(pd)
for ext, fn in fixtures.ALL.items():
    p = os.path.join(pd, "fx" + ext); open(p, "wb").write(fn()); open(p + ".prov.json", "w").write(json.dumps(dict(prov, url="synthetic:" + ext, sha256="0" * 64)))
man = {"batch": "fixture", "out": "out", "bank": "bank.jsonl", "inputs": [{"kind": "daw-project", "dirs": ["proj"], "genre": "fixture"}]}
open(os.path.join(bd, "m.json"), "w").write(json.dumps(man))
subprocess.run(["node", os.path.join(HERE, "batch.mjs"), os.path.join(bd, "m.json")], check=True, stdout=subprocess.DEVNULL)
pk = json.load(open(os.path.join(bd, "out", "pack.json"))); sz = os.path.getsize(os.path.join(bd, "out", "pack.json"))
kinds = {c["kind"] for c in pk["candidates"]}
ok(sz <= 8192 and {"named-form", "layer-ladder", "transition-grammar"} <= kinds and pk["genres"]["fixture"]["n"] == 6, "batch: pack %d bytes, candidates %s" % (sz, sorted(kinds)))
v = subprocess.run(["node", os.path.join(HERE, "validate_bank.mjs"), os.path.join(bd, "bank.jsonl")], capture_output=True, text=True)
ok(v.returncode == 0, "bank validates: " + v.stdout.strip().splitlines()[0])
n1 = len(open(os.path.join(bd, "bank.jsonl")).readlines())
subprocess.run(["node", os.path.join(HERE, "batch.mjs"), os.path.join(bd, "m.json")], check=True, stdout=subprocess.DEVNULL)
ok(len(open(os.path.join(bd, "bank.jsonl")).readlines()) == n1, "bank dedup: rerun appends nothing (%d records)" % n1)
bad = json.loads(open(os.path.join(bd, "bank.jsonl")).readline()); bad["features"]["notes"] = [60, 62]
open(os.path.join(bd, "bad.jsonl"), "w").write(json.dumps(bad) + "\n")
v = subprocess.run(["node", os.path.join(HERE, "validate_bank.mjs"), os.path.join(bd, "bad.jsonl")], capture_output=True, text=True)
ok(v.returncode == 1 and "note data" in v.stdout, "bank validator rejects note data")
shutil_rm = __import__("shutil").rmtree; shutil_rm(bd, ignore_errors=True)
import shutil; shutil.rmtree(tmp, ignore_errors=True); shutil.rmtree(d2, ignore_errors=True)
print("%d failures" % len(fails)); sys.exit(1 if fails else 0)
