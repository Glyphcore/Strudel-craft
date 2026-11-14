#!/usr/bin/env python3
"""Record sha256 of every file a vox bank's words.json lists (clips with a `file`, plus `prompt_files`) in <bank>/hashes.json.

  python3 engine/vocals/hash_banks.py [BANK_DIR ...]      (default: every bank under site/data/vox)

Paths are relative to the bank dir. tests/site/vox.mjs checks that each listed file exists and matches. Re-run after any rebuild.
"""
import hashlib, json, os, sys


def listed(bank):
    w = json.load(open(os.path.join(bank, 'words.json')))
    files = {x['file'] for x in w['words'] if x.get('file')} | set(w.get('prompt_files', []))
    return sorted(files)


def write(bank):
    out = {}
    for f in listed(bank):
        p = os.path.join(bank, f)
        if not os.path.isfile(p): raise SystemExit(f'{bank}: words.json lists a missing file: {f}')
        out[f] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    json.dump(out, open(os.path.join(bank, 'hashes.json'), 'w'), indent=0, sort_keys=True)
    return len(out)


if __name__ == '__main__':
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'site', 'data', 'vox')
    banks = sys.argv[1:] or [os.path.join(root, d) for d in sorted(os.listdir(root)) if os.path.isfile(os.path.join(root, d, 'words.json'))]
    for b in banks: print(os.path.normpath(b), write(b))
