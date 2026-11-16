#!/usr/bin/env python3
"""Folders, tags, taxonomy and aliases in `packs validate` (docs/PACK_SPEC.md 5.3, 13). Run: python3 tests/packs/taxonomy.py
Builds throwaway packs in a temp dir: valid with and without taxonomy (backward compatible), bad folder -> E_PACK_FOLDER, unknown tag -> W_PACK_TAG,
bad tag format -> schema error, alias that is also an item id -> E_PACK_ID; the folder and tag regexes agree with site/engine/taxonomy.js; the shipped packs are clean."""
import json, subprocess, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "packs"))
import packs as P  # noqa: E402

fails = []
def ok(name, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond: fails.append(name)

def recipe(i, **kw): return {"id": i, "title": i, "code": '$: s("bd")', **kw}
def make(recipes, taxonomy=None):
    d = Path(tempfile.mkdtemp(prefix="taxo-"))
    (d / "recipes.json").write_text(json.dumps({"recipes": recipes}))
    man = {"craftpack": "1.0.0", "id": "test/tax", "version": "1.0.0", "license": "CC0-1.0",
           "ingredients": [{"id": "recipes", "kind": "recipes", "format": "recipes@1", "version": "1.0.0", "path": "recipes.json", "hash": "sha256:" + "0" * 64}]}
    if taxonomy: man["taxonomy"] = taxonomy
    (d / "craftpack.json").write_text(json.dumps(man))
    P.cmd_hash(d, write=True, check=False)
    return d
def codes(d):
    E, W = P.validate_pack(d); return [c for c, _, _ in E], [c for c, _, _ in W], E, W

e, w, *_ = codes(make([recipe("a")]))
ok("a pack without folder, tags or taxonomy validates clean (backward compatible)", not e and not w, (e, w))
e, w, *_ = codes(make([recipe("a", folder="hiphop/trap/drums", tags=["trap", "drums"])]))
ok("folder and tags without a taxonomy validate clean", not e and not w, (e, w))
tax = {"version": 1, "groups": {"role": {"title": "Role"}}, "priority": ["drums"], "tags": {"drums": {"group": "role", "description": "d", "style": {"color": "orange", "icon": "drum"}}, "trap": {"group": "role"}}, "folders": {"hiphop/trap": {"description": "x"}}}
e, w, *_ = codes(make([recipe("a", folder="hiphop/trap", tags=["trap", "drums"])], tax))
ok("folder and tags inside the taxonomy validate clean", not e and not w, (e, w))
e, w, *_ = codes(make([recipe("a", tags=["trap", "free-tag"])], tax))
ok("a tag outside the taxonomy warns W_PACK_TAG (free tags are allowed)", not e and w == ["W_PACK_TAG"], (e, w))
for bad in ("Hip/Hop", "a//b", "/abs", "a/b/c/d/e/f/g/h/i", "has space", "up..", ""):
    e, w, *_ = codes(make([recipe("a", folder=bad)]))
    ok(f"bad folder {bad!r} is E_PACK_FOLDER", "E_PACK_FOLDER" in e, (e, w))
e, w, *_ = codes(make([recipe("a", tags=["Bad Tag"])]))
ok("a malformed tag is a schema error", "E_PACK_SCHEMA" in e, e)
e, w, *_ = codes(make([recipe("a")], {"version": 1, "folders": {"Bad Path": {}}}))
ok("a malformed folder key in the taxonomy is E_PACK_FOLDER", "E_PACK_FOLDER" in e, e)
e, w, *_ = codes(make([recipe("a", aliases=["b"]), recipe("b")]))
ok("an alias that is also an item id is E_PACK_ALIAS_CONFLICT", "E_PACK_ALIAS_CONFLICT" in e, e)
e, w, *_ = codes(make([recipe("a", aliases=["old"]), recipe("b", aliases=["old"])]))
ok("one alias claimed by two items is E_PACK_ALIAS_CONFLICT", "E_PACK_ALIAS_CONFLICT" in e, e)
e, w, *_ = codes(make([recipe("new", aliases=["old"])]))
ok("an alias that is free validates clean", not e, e)
e, w, *_ = codes(make([recipe("a")], {"version": 1, "style": 1}))
ok("an unknown taxonomy key is a schema error", "E_PACK_SCHEMA" in e, e)
e, w, *_ = codes(make([recipe("a")], {"version": 1, "tags": {"x": {"style": {"color": "chartreuse"}}}}))
ok("a colour outside the fixed palette is a schema error", "E_PACK_SCHEMA" in e, e)
# regex parity with the site module
js = "import('" + (ROOT / "site/engine/taxonomy.js").as_uri() + "').then(m=>{const c=JSON.parse(process.argv[1]);console.log(JSON.stringify(c.map(s=>[!m.checkFolder(s),!m.checkTag(s)])))})"
cases = ["hiphop/trap/drums", "Hip", "a-b/c", "a//b", "x" * 33, "a" * 40, "ok", "-no", "a/b/c/d/e/f/g/h", "a/b/c/d/e/f/g/h/i"]
got = json.loads(subprocess.run(["node", "-e", js, json.dumps(cases)], capture_output=True, text=True).stdout)
want = [[bool(P.FOLDER_RE.match(s)) and len(s) <= 80, bool(P.TAG_RE.match(s))] for s in cases]
ok("folder and tag rules agree between packs.py and site/engine/taxonomy.js", got == want, (got, want))
for pack in ("site/data/phonk",):
    E, W = P.validate_pack(ROOT / pack)
    ok(f"{pack} validates with no error and no warning", not E and not W, (E[:2], W[:2]))
sys.exit(1 if fails else 0)
