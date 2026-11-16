#!/usr/bin/env python3
"""Keep the shim pack's hash tree in step with site/data (docs/PACK_SPEC.md 14.3 step 2; issue #67).

The site loads today's site/data/* files through the shim pack `site/craftpack.json`, pinned by `site/packs.lock.json`.
Edit a data file (for example `build_catalog.py` rewrites catalog.json) and the pin is stale: the loader then reports
E_PACK_HASH and that content is missing. Run this after such a change:

    python3 tools/packs/shim.py            # rewrite entry hashes in site/craftpack.json and the manifest hash in the lock
    python3 tools/packs/shim.py --check    # exit 1 when either is stale (used by tests)

The shim goes away with P4 (#69), when `glyphcore/core` replaces it.
"""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "packs"))
import packs as P  # noqa: E402


# pack id -> source (relative to site/): every site/data/<dir>/craftpack.json except glyphcore/vox (pinned by tools/vox/bank_index.py);
# glyphcore/phonk first, then by directory name, so a new content pack (glyphcore/edm, ...) is pinned without editing this file
SITE_PACKS = {"glyphcore/phonk": "file:data/phonk"}
for _mf in sorted((ROOT / "site" / "data").glob("*/craftpack.json")):
    _id = json.loads(_mf.read_text()).get("id")
    if _id and _id not in SITE_PACKS and _id != "glyphcore/vox":
        SITE_PACKS[_id] = "file:data/" + _mf.parent.name


BODIES_KIND = "x-glyphcore.recipe-bodies"


def sync_bodies(check):
    """#131: one lazy `x-glyphcore.recipe-bodies` ingredient per site/data/recipes/<family>.json (written by tools/catalog); entries are kept in
    sorted family order right after `recipes`. Hash and bytes are filled by cmd_hash next."""
    mf = ROOT / "site" / "craftpack.json"
    man = P.read_json(mf)
    want = {}
    for f in sorted((ROOT / "site" / "data" / "recipes").glob("*.json")):
        want["bodies-" + f.stem] = {"id": "bodies-" + f.stem, "kind": BODIES_KIND, "format": BODIES_KIND + "@1", "version": "1.0.0",
                                    "path": "data/recipes/" + f.name, "load": "lazy"}
    cur = {i["id"]: i for i in man["ingredients"] if i.get("kind") == BODIES_KIND}
    keep = [i for i in man["ingredients"] if i.get("kind") != BODIES_KIND]
    new = []
    for k, w in want.items():
        old = cur.get(k)
        new.append({**w, **{x: old[x] for x in ("hash", "bytes") if old and x in old}} if old else w)
    at = next(n for n, i in enumerate(keep) if i["id"] == "recipes") + 1
    ings = keep[:at] + new + keep[at:]
    stale = [k for k in want if k not in cur] + [k for k in cur if k not in want]
    if ings != man["ingredients"] and not check:
        man["ingredients"] = ings
        mf.write_bytes(P.dump(man))
    return [f"ingredient {s}" for s in stale]


def main(argv):
    check = "--check" in argv
    sb = sync_bodies(check)
    changes, _ = P.cmd_hash(ROOT / "site", write=not check, check=check)
    changes = sb + changes
    mb = (ROOT / "site" / "craftpack.json").read_bytes()
    want = "sha256:" + hashlib.sha256(mb).hexdigest()
    lf = ROOT / "site" / "packs.lock.json"
    lock = json.loads(lf.read_text())
    stale = [f"lock {e['id']} manifest" for e in lock["packs"] if e["id"] == "glyphcore/shim" and e["manifest"] != want]
    if stale and not check:
        for e in lock["packs"]:
            if e["id"] == "glyphcore/shim":
                e["manifest"] = want
        lf.write_text(json.dumps(lock, indent=2) + "\n")
    # content packs that live under site/data and ship with the site: pin their manifests in the same lock (added when missing)
    lock = json.loads(lf.read_text()); dirty = False
    for pid, src in SITE_PACKS.items():
        mf = ROOT / "site" / src[len("file:"):] / "craftpack.json"
        h = "sha256:" + hashlib.sha256(mf.read_bytes()).hexdigest()
        e = next((x for x in lock["packs"] if x["id"] == pid), None)
        if e is None or e["manifest"] != h:
            stale.append(f"lock {pid} manifest")
            if not check:
                if e is None:
                    lock["packs"].append({"id": pid, "version": json.loads(mf.read_text())["version"], "source": src, "manifest": h, "priority": 0, "allowCode": [], "dependencies": {}})
                else:
                    e["manifest"] = h
                dirty = True
    if dirty:
        lf.write_text(json.dumps(lock, indent=2) + "\n")
    out = changes + stale
    print(("stale: " if check else "updated: ") + ", ".join(out) if out else "shim pack is in step with site/data")
    return 1 if check and out else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
