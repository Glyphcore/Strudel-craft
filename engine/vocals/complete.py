#!/usr/bin/env python3
"""Pluggable completion providers for word vocals. Glyphcore/Strudel-craft#44 (word-vocals P3)

  engine/vocals/complete.py PREFIX [--samples-dir D] [--config providers.json] [--kind word|syllable|sample]

Prints JSON {"prefix", "items":[{name, kind, detail, n, provider}]}. The `strudel complete` CLI (separate repo) is expected to shell out to this
file with the same flags. The site reads the same item shape (site/data/intellisense/words.json, site/word-intellisense.js).
Provider interface: id, list() -> [{name, kind: word|syllable|sample, detail, n}], resolve(name) -> item | None.
Built-ins: `samples-dir` (DIR/strudel.json key map), `wordbank` (DIR/words.json from wordbank.py).
Config file (JSON) adds providers with no code change here: {"providers":[{"id":"mine","type":"samples-dir","path":"D"} | {"id":"x","module":"plugin.py"}]}
where a module defines `provider(cfg) -> object with id/list/resolve` (module path relative to the config file).
"""
import argparse, importlib.util, json, re, sys
from pathlib import Path


def _item(name, kind, detail, n):
    return {'name': name, 'kind': kind, 'detail': detail, 'n': n}


class SamplesDir:
    """DIR/strudel.json: {key: [urls]}. Keys <bank>_<word>, <bank>_syl, <bank>_<word>_s<k> (syllable); other keys are plain samples."""
    def __init__(self, path, id='samples-dir', **_):
        self.id, self.path = id, Path(path)

    def list(self):
        m = json.loads((self.path / 'strudel.json').read_text())
        out = []
        for k, v in m.items():
            if k.startswith('_'):
                continue
            n = len(v) if isinstance(v, (list, dict)) else 1
            bank, _, rest = k.partition('_')
            if rest and (rest == 'syl' or re.search(r'_s\d+$', rest)):
                out.append(_item(rest if rest == 'syl' else rest, 'syllable', f'{bank} syllable', n))
            elif rest and bank in {kk.partition('_')[0] for kk in m if '_' in kk}:
                out.append(_item(rest, 'word', f'{bank} word', n))
            else:
                out.append(_item(k, 'sample', 'sample', n))
        return out

    def resolve(self, name):
        return next((i for i in self.list() if i['name'] == name), None)


class WordBank:
    """DIR/words.json written by wordbank.py: counts takes per word (n = take count)."""
    def __init__(self, path, id='wordbank', **_):
        self.id, self.path = id, Path(path)

    def list(self):
        W = json.loads((self.path / 'words.json').read_text())
        bank, cnt = W.get('bank', 'vox'), {}
        for r in W.get('words', []):
            if r.get('skipped') or not r.get('key'):
                continue
            w = r['key'][len(bank) + 1:]
            cnt[w] = cnt.get(w, 0) + 1
        return [_item(w, 'syllable' if w == 'syl' else 'word', f'{bank} word', n) for w, n in sorted(cnt.items())]

    def resolve(self, name):
        return next((i for i in self.list() if i['name'] == name), None)


BUILTIN = {'samples-dir': SamplesDir, 'wordbank': WordBank}


def load_config(cfg_path):
    cfg_path = Path(cfg_path)
    out = []
    for e in json.loads(cfg_path.read_text()).get('providers', []):
        if 'module' in e:
            mp = (cfg_path.parent / e['module']).resolve()
            spec = importlib.util.spec_from_file_location('_sc_prov_' + re.sub(r'\W', '_', e.get('id', mp.stem)), mp)
            mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
            out.append(mod.provider(e))
        else:
            out.append(BUILTIN[e['type']](**{**e, 'path': (cfg_path.parent / e['path']).resolve()}))
    return out


def complete(prefix, providers, kind=None):
    seen, out = set(), []
    for p in providers:
        for it in p.list():
            if not it['name'].lower().startswith(prefix.lower()) or (kind and it['kind'] != kind):
                continue
            k = (it['name'], it['kind'], p.id)
            if k not in seen:
                seen.add(k); out.append({**it, 'provider': p.id})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('prefix', nargs='?', default='')
    ap.add_argument('--samples-dir', action='append', default=[]); ap.add_argument('--config'); ap.add_argument('--kind', choices=['word', 'syllable', 'sample'])
    a = ap.parse_args(argv)
    provs = []
    for d in a.samples_dir:
        if (Path(d) / 'strudel.json').exists():
            provs.append(SamplesDir(d))
        if (Path(d) / 'words.json').exists():
            provs.append(WordBank(d))
    if a.config:
        provs += load_config(a.config)
    if not provs:
        print('no providers: pass --samples-dir D or --config FILE', file=sys.stderr); return 2
    json.dump({'prefix': a.prefix, 'items': complete(a.prefix, provs, a.kind)}, sys.stdout, indent=1); print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
