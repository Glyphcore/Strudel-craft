#!/usr/bin/env python3
"""Check the craftpack schemas themselves: every *.schema.json is a valid draft 2020-12 schema and every
file in schemas/craftpack/1/examples/ validates against the schema it declares (docs/PACK_SPEC.md section 15).

Usage: python3 tests/packs/schemas.py     exit 0 = all good
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "packs"))
import packs as P  # noqa: E402
from jsonschema import Draft202012Validator  # noqa: E402

EXAMPLES = {"craftpack.": "manifest.schema.json", "packs.lock.json": "lock.schema.json",
            "packs.json": "packs.schema.json", "registry.json": "registry.schema.json"}


def main():
    bad = 0
    files = sorted(P.SCHEMAS.rglob("*.schema.json"))
    for f in files:
        doc = json.loads(f.read_text())
        try:
            Draft202012Validator.check_schema(doc)
        except Exception as ex:
            print(f"INVALID SCHEMA {f.relative_to(ROOT)}: {ex}")
            bad += 1
            continue
        if doc.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            print(f"NOT 2020-12 {f.relative_to(ROOT)}: {doc.get('$schema')}")
            bad += 1
    ex_files = sorted((P.SCHEMAS / "examples").glob("*.json"))
    for f in ex_files:
        name = next((v for k, v in EXAMPLES.items() if f.name.startswith(k) or f.name == k), None)
        if not name:
            print(f"NO SCHEMA FOR EXAMPLE {f.name}")
            bad += 1
            continue
        errs = P.schema_errors(json.loads(f.read_text()), name)
        for ptr, msg, _ in errs:
            print(f"INVALID EXAMPLE {f.name} {ptr}: {msg}")
        bad += len(errs)
    print(f"{len(files)} schemas, {len(ex_files)} examples checked, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
