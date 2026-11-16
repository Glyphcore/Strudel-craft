#!/usr/bin/env python3
"""dawstudy: structure statistics from licensed DAW projects (docs/DAW_STUDY.md, rules docs/RESEARCH_ETHICS.md).
  dawstudy.py stats FILE [--out J] [--md M] [--prov P.json]   one project -> dawstudy-stats@1 (+ markdown)
  dawstudy.py forms STATS... --genre G --out P.json [--md M]  merge stats of one genre into a form profile
  dawstudy.py check DIR                                          every *.stats.json has schema + complete provenance (exit 1 otherwise)"""
import argparse, collections, glob, json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common, lmms, als, flp, rpp, ardour

PARSERS = {".mmp": lmms, ".mmpz": lmms, ".als": als, ".flp": flp, ".rpp": rpp, ".ardour": ardour}

def parse_file(path, fmt=None):
    ext = fmt or os.path.splitext(path)[1].lower()
    mod = PARSERS.get(ext)
    if mod is None: raise SystemExit("unknown project format: %s" % ext)
    with open(path, "rb") as f: data = f.read()
    return mod.parse(data)

def stats_file(path, prov=None, fmt=None):
    return common.stats(parse_file(path, fmt), prov)

def _med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 2) if xs else None

def forms(paths, genre):
    S = [json.load(open(p)) for p in paths]
    n = len(S)
    sec_bars, sec_layers, orders = collections.defaultdict(list), collections.defaultdict(list), collections.Counter()
    role_presence, fx_presence, chains, autos = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    curve = [[] for _ in range(20)]; clips = collections.Counter(); sources = []
    for s in S:
        order = []
        for x in s["sections"]:
            sec_bars[x["role"]].append(x["bars"]); sec_layers[x["role"]].append(x["layers_median"])
            if not order or order[-1] != x["role"]: order.append(x["role"])
        orders[" > ".join(order)] += 1
        for r in s["tracks"]["by_role"]: role_presence[r] += 1
        for t in s["fx"]["type_frequency"]: fx_presence[t] += 1
        for c in s["fx"]["chains"]: chains["%s: %s" % (c["role"], " > ".join(c["chain"]))] += 1
        for a in s["automation"]: autos["%s/%s" % (a["target"], a["shape"])] += 1
        L = s["density"]["layers_per_bar"]
        if L:
            for i in range(20):
                a = int(i * len(L) / 20); b = max(a + 1, int((i + 1) * len(L) / 20)); curve[i].append(statistics.mean(L[a:b]))
        for k, v in s["clip_bars"].items(): clips[k] += v
        p = s.get("provenance") or {}
        sources.append({"title": p.get("title"), "author": p.get("author"), "licence": p.get("licence"), "page_url": p.get("page_url"), "sha256": p.get("sha256"),
                        "tempo": s["tempo"], "bars": s["length_bars"], "sections_source": sorted(set(x["source"] for x in s["sections"]))})
    return {
        "schema": "dawstudy-form@1", "genre": genre, "n": n, "basis": "measured" if n >= 3 else "measured (n < 3: indicative only)",
        "tempo": {"min": min([s["tempo"] for s in S if s["tempo"]] or [None]), "median": _med([s["tempo"] for s in S]), "max": max([s["tempo"] for s in S if s["tempo"]] or [None])},
        "length_bars": {"median": _med([s["length_bars"] for s in S]), "min": min(s["length_bars"] for s in S), "max": max(s["length_bars"] for s in S)},
        "section_bars_median": {r: _med(v) for r, v in sorted(sec_bars.items())},
        "section_count": {r: len(v) for r, v in sorted(sec_bars.items())},
        "layers_median_by_section": {r: _med(v) for r, v in sorted(sec_layers.items())},
        "orders": orders.most_common(5),
        "role_presence": {r: round(c / n, 2) for r, c in role_presence.most_common()},
        "fx_presence": {r: round(c / n, 2) for r, c in fx_presence.most_common()},
        "fx_chains_top": chains.most_common(8),
        "automation_top": autos.most_common(8),
        "tracks_median": _med([s["tracks"]["with_clips"] for s in S]),
        "sends_median": _med([s["routing"]["sends"] for s in S]), "sidechain_projects": sum(1 for s in S if s["routing"]["sidechains"]),
        "density_curve_20": [_med(c) for c in curve],
        "clip_bars_top": clips.most_common(6),
        "sources": sources,
    }

def forms_md(P):
    L = ["# Form profile: %s (n = %d, %s)" % (P["genre"], P["n"], P["basis"]), "",
         "Tempo %s-%s (median %s); length median %s bars (%s-%s); tracks with clips median %s; sends median %s; projects with sidechain %d." % (
             P["tempo"]["min"], P["tempo"]["max"], P["tempo"]["median"], P["length_bars"]["median"], P["length_bars"]["min"], P["length_bars"]["max"],
             P["tracks_median"], P["sends_median"], P["sidechain_projects"]), "",
         "| section role | count | median bars | median layers |", "|---|---|---|---|"]
    for r in P["section_bars_median"]:
        L.append("| %s | %d | %s | %s |" % (r, P["section_count"][r], P["section_bars_median"][r], P["layers_median_by_section"][r]))
    L += ["", "Density curve (median layers per 5 % of the song): " + " ".join(str(x) for x in P["density_curve_20"]),
          "", "Most common orders: " + "; ".join("%s (%d)" % o for o in P["orders"]),
          "", "Role presence: " + ", ".join("%s %s" % kv for kv in P["role_presence"].items()),
          "", "FX presence: " + ", ".join("%s %s" % kv for kv in P["fx_presence"].items()),
          "", "Top FX chains: " + "; ".join("%s (%d)" % c for c in P["fx_chains_top"]),
          "", "Top automation: " + "; ".join("%s (%d)" % c for c in P["automation_top"]),
          "", "Clip lengths (bars, count): " + ", ".join("%s: %d" % c for c in P["clip_bars_top"]), "", "Sources:"]
    for s in P["sources"]:
        L.append("- %s by %s (%s) %s sha256 %s" % (s["title"], s["author"], s["licence"], s["page_url"], (s["sha256"] or "")[:16]))
    return "\n".join(L) + "\n"

def _keys(o):
    if isinstance(o, dict): return set(o) | set().union(*[_keys(v) for v in o.values()]) if o else set()
    if isinstance(o, list): return set().union(*[_keys(v) for v in o]) if o else set()
    return set()

def check(d):
    bad = 0; files = sorted(glob.glob(os.path.join(d, "**", "*.stats.json"), recursive=True))
    for f in files:
        s = json.load(open(f)); errs = []
        if s.get("schema") != common.SCHEMA: errs.append("schema")
        errs += common.check_provenance(s.get("provenance"))
        if _keys(s) & {"pitch", "pitches", "key_number", "notes_list", "melody", "midi"}: errs.append("note data present")
        if errs: bad += 1; print("FAIL %s: %s" % (f, "; ".join(errs)))
    print("%d stats files, %d invalid" % (len(files), bad))
    return 1 if bad or not files else 0

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("stats"); a.add_argument("file"); a.add_argument("--out"); a.add_argument("--md"); a.add_argument("--prov"); a.add_argument("--format")
    b = sub.add_parser("forms"); b.add_argument("stats", nargs="+"); b.add_argument("--genre", required=True); b.add_argument("--out", required=True); b.add_argument("--md")
    c = sub.add_parser("check"); c.add_argument("dir")
    o = ap.parse_args(argv)
    if o.cmd == "stats":
        prov = json.load(open(o.prov)) if o.prov else None
        s = stats_file(o.file, prov, o.format)
        js = json.dumps(s, indent=1)
        if o.out: open(o.out, "w").write(js + "\n")
        else: print(js)
        if o.md: open(o.md, "w").write(common.to_md(s, (prov or {}).get("title") or os.path.basename(o.file)))
        return 0
    if o.cmd == "forms":
        files = []
        for p in o.stats: files += sorted(glob.glob(os.path.join(p, "*.stats.json"))) if os.path.isdir(p) else [p]
        P = forms(files, o.genre)
        open(o.out, "w").write(json.dumps(P, indent=1) + "\n")
        if o.md: open(o.md, "w").write(forms_md(P))
        print("form profile %s: n=%d -> %s" % (o.genre, P["n"], o.out)); return 0
    if o.cmd == "check": return check(o.dir)

if __name__ == "__main__":
    sys.exit(main())
