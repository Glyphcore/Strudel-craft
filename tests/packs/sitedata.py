#!/usr/bin/env python3
"""The current site data must validate, unchanged, against its craftpack kind schema (docs/PACK_SPEC.md 14.1, 15).

catalog.json -> recipes@1, controls/types.json -> control-types@1, syntax.json -> syntax@1,
plugins.json / practices.json -> docs@1. Read-only: nothing under site/ is written.

Usage: python3 tests/packs/sitedata.py     exit 0 = all good
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "packs"))
import packs as P  # noqa: E402

FILES = [("site/data/catalog.json", "kinds/recipes.1.schema.json"),
         ("site/data/controls/types.json", "kinds/control-types.1.schema.json"),
         ("site/data/syntax.json", "kinds/syntax.1.schema.json"),
         ("site/data/plugins.json", "kinds/docs.1.schema.json"),
         ("site/data/practices.json", "kinds/docs.1.schema.json")]


def main():
    bad = 0
    for rel, schema in FILES:
        f = ROOT / rel
        if not f.is_file():
            print(f"MISSING {rel}")
            bad += 1
            continue
        errs = P.schema_errors(json.loads(f.read_text()), schema)
        for ptr, msg, _ in errs[:5]:
            print(f"INVALID {rel} {ptr}: {msg}")
        bad += len(errs)
        if not errs:
            print(f"ok {rel} -> {Path(schema).name}")
    print(f"{len(FILES)} site data files checked, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
