#!/usr/bin/env python3
"""Form bank: one JSONL record per observation, provenance first (docs/FORM_BANK.md). Features only: no audio, no notes.
  bank.py from-stats STATS.json... --bank BANK.jsonl [--genre G]          sections + tension events of DAW projects (inferred-from-project-data)
  bank.py from-triage TRIAGE.json... --bank BANK.jsonl [--genre G]        audio triage of own tracks (analysed-from-audio)
  bank.py composite --bank BANK.jsonl --genre G [--role R]                pieced-together medians of matching observations, derived_from their ids
  bank.py query --bank BANK.jsonl [--genre G] [--role R] [--method M] [--summary]
  bank.py summary --bank BANK.jsonl --out SUMMARY.json                   compact per genre / role / method counts and medians (mirrored read-only)
Dedup: a record's id is the sha256 of its canonical content (minus id); appending an existing id is a no-op."""
import argparse, hashlib, json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

ROLES = {"intro", "verse", "chorus", "build", "drop", "breakdown", "bridge", "solo", "transition", "outro", "body", "other"}
ROLE_MAP = {"peak": "drop", "fill": "transition", "switch": "transition"}
METHODS = ("inferred-from-project-data", "project-rendered-then-analysed", "analysed-from-audio", "pieced-together")

def _norm(v):  # canonical numbers as JavaScript prints them (2.0 -> 2), so validate_bank.mjs computes the same hash
    if isinstance(v, float) and v.is_integer(): return int(v)
    if isinstance(v, dict): return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, list): return [_norm(x) for x in v]
    return v

def canon(r):
    return json.dumps(_norm(r), sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def rid(rec):
    r = {k: v for k, v in rec.items() if k != "id"}
    return "fb-" + hashlib.sha256(canon(r).encode()).hexdigest()[:16]

def load(path):
    if not os.path.exists(path): return []
    return [json.loads(l) for l in open(path) if l.strip()]

def append(path, recs):
    for r in recs:  # fail closed: nothing is written when any record's source licence is not allowed
        e = common.source_licence_error(r.get("source"))
        if e: raise common.LicenceRefused("bank append refused: " + e)
    have = {r["id"] for r in load(path)}; n = 0
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a") as f:
        for r in recs:
            r = _norm(r); r["id"] = rid(r)
            if r["id"] in have: continue
            have.add(r["id"]); f.write(canon(r) + "\n"); n += 1
    return n

def role(r):
    r = ROLE_MAP.get(r, r)
    return r if r in ROLES else "other"

def from_stats(s, genre):
    p = s.get("provenance") or {}
    src = {"kind": "daw-project", "ref": {"sha256": p.get("sha256"), "url": p.get("url"), "page_url": p.get("page_url"), "licence": p.get("licence"),
                                          "licence_class": p.get("licence_class"), "accessed": p.get("accessed"), "title": p.get("title"), "author": p.get("author")}}
    tags = sorted({genre} if genre else set())
    out = []
    for i, x in enumerate(s["sections"]):
        out.append({"source": src, "picked": {"bars": [x["start_bar"], x["start_bar"] + x["bars"] - 1], "layers": x["roles"], "stage": "section"},
                    "method": "inferred-from-project-data", "confidence": 0.8 if x["source"] == "marker" else 0.5,
                    "evidence": ["section %d (%s)" % (i + 1, x["source"])],
                    "features": {"bars": x["bars"], "layers_median": x["layers_median"], "layers_max": x["layers_max"], "tempo": s["tempo"], "song_bars": s["length_bars"],
                                 "position": round((x["start_bar"] - 1) / max(1, s["length_bars"]), 3)},
                    "labels": {"form_role": role(x["role"]), "section_source": x["source"], "genres": tags}, "derived_from": []})
    for e in s.get("tension", []):
        out.append({"source": src, "picked": {"bars": [e["bar"], e.get("end_bar", e["bar"])], "layers": [], "stage": "tension"},
                    "method": "inferred-from-project-data", "confidence": e["confidence"], "evidence": e["evidence"],
                    "features": {"bars": e.get("end_bar", e["bar"]) - e["bar"] + 1, "tempo": s["tempo"], "song_bars": s["length_bars"],
                                 "position": round((e["bar"] - 1) / max(1, s["length_bars"]), 3)},
                    "labels": {"form_role": role(e["kind"]), "genres": tags}, "derived_from": []})
    return out

def from_triage(t, genre):
    src = {"kind": t.get("source_kind", "suno-playlist-own"), "ref": {"sha256": t.get("sha256"), "path_hash": t.get("path_hash"), "owner": t.get("owner"),
                                                                   "accessed": t.get("analysed"), "clip_id": t.get("clip_id"), "licence": t.get("licence", "own work"),
                                                                   **({k: t["project"][k] for k in ("url", "licence", "licence_class", "sha256") if k in t["project"]} if t.get("project") else {})}}
    tags = sorted({genre} if genre else set(t.get("genres", [])))
    out = []
    for i, x in enumerate(t.get("sections", [])):
        out.append({"source": src, "picked": {"bars": [x["start_bar"], x["end_bar"]], "layers": [], "stage": "triage"},
                    "method": "project-rendered-then-analysed" if src["kind"] == "rendered-project" else "analysed-from-audio", "confidence": x.get("confidence", 0.5), "evidence": x.get("evidence", []),
                    "features": {k: x[k] for k in ("bars", "rms_db", "low_db", "flux", "centroid_hz", "onsets", "width") if k in x} | {"tempo": t.get("bpm"), "song_bars": t.get("bars"),
                                 "position": round((x["start_bar"] - 1) / max(1, t.get("bars") or 1), 3)},
                    "labels": {"form_role": role(x["role"]), "genres": tags}, "derived_from": []})
    return out

def composite(recs, genre, role_=None):
    sel = [r for r in recs if r["method"] != "pieced-together" and genre in r["labels"].get("genres", []) and (role_ is None or r["labels"]["form_role"] == role_)]
    by = {}
    for r in sel: by.setdefault(r["labels"]["form_role"], []).append(r)
    out = []
    for ro, rs in sorted(by.items()):
        f = {}
        for k in ("bars", "layers_median", "position", "tempo", "rms_db", "flux"):
            v = [r["features"][k] for r in rs if isinstance(r["features"].get(k), (int, float))]
            if v: f[k + "_median"] = round(statistics.median(v), 3)
        f["n"] = len(rs); f["sources"] = len({json.dumps(r["source"]["ref"], sort_keys=True) for r in rs})
        out.append({"source": {"kind": "catalog-example", "ref": {"bank": "pieced together from %d observations" % len(rs)}}, "picked": {"bars": [], "layers": [], "stage": "composite"},
                    "method": "pieced-together", "confidence": round(min(0.9, statistics.mean(r["confidence"] for r in rs) * min(1, f["sources"] / 3)), 2),
                    "evidence": ["%d observations, %d sources" % (len(rs), f["sources"])], "features": f,
                    "labels": {"form_role": ro, "genres": [genre]}, "derived_from": sorted(r["id"] for r in rs)})
    return out

def query(recs, genre=None, role_=None, method=None):
    return [r for r in recs if (genre is None or genre in r["labels"].get("genres", [])) and (role_ is None or r["labels"]["form_role"] == role_) and (method is None or r["method"] == method)]

def summary(recs):
    S = {}
    for r in recs:
        for g in r["labels"].get("genres") or ["untagged"]:
            k = "%s|%s|%s" % (g, r["labels"]["form_role"], r["method"]); S.setdefault(k, []).append(r)
    out = []
    for k, rs in sorted(S.items()):
        g, ro, m = k.split("|"); bars = [r["features"].get("bars") or r["features"].get("bars_median") for r in rs]
        bars = [b for b in bars if isinstance(b, (int, float))]
        out.append({"genre": g, "form_role": ro, "method": m, "n": len(rs), "bars_median": round(statistics.median(bars), 2) if bars else None,
                    "confidence_mean": round(statistics.mean(r["confidence"] for r in rs), 2)})
    return {"schema": "form-bank-summary@1", "records": len(recs), "rows": out}

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["from-stats", "from-triage", "composite", "query", "summary"]); ap.add_argument("inputs", nargs="*")
    ap.add_argument("--bank", required=True); ap.add_argument("--genre"); ap.add_argument("--role"); ap.add_argument("--method"); ap.add_argument("--summary", action="store_true"); ap.add_argument("--out")
    o = ap.parse_args(argv)
    if o.cmd in ("from-stats", "from-triage"):
        recs = []
        for p in o.inputs:
            d = json.load(open(p)); g = o.genre or (os.path.basename(os.path.dirname(os.path.abspath(p))) if o.cmd == "from-stats" else None)
            recs += from_stats(d, g) if o.cmd == "from-stats" else from_triage(d, g)
        try: print("appended %d of %d records" % (append(o.bank, recs), len(recs))); return 0
        except common.LicenceRefused as e: print("REFUSED " + str(e), file=sys.stderr); return 3
    recs = load(o.bank)
    if o.cmd == "composite":
        c = composite(recs, o.genre, o.role); print("appended %d composites" % append(o.bank, c)); return 0
    if o.cmd == "summary":
        js = json.dumps(summary(recs), indent=1)
        if o.out: open(o.out, "w").write(js + "\n")
        else: print(js)
        return 0
    q = query(recs, o.genre, o.role, o.method)
    if o.summary: print(json.dumps(summary(q), indent=1))
    else:
        for r in q: print(json.dumps(r, sort_keys=True))
    return 0

if __name__ == "__main__":
    sys.exit(main())
