#!/usr/bin/env python3
"""Craftpack tools (docs/PACK_SPEC.md sections 8, 9, 12, 13): validate | hash | lock | registry build|check | --api.

Standalone Python 3 + jsonschema (draft 2020-12). The `strudel` CLI (engine/strudel-cli, another repo) is expected to
shell out to or port this file; the behaviour, codes and exit statuses here are the contract of issue #65.
Exit status: 0 ok, 1 diagnostics with an error code (or a warning under --strict), 2 usage.
"""
import argparse, hashlib, json, os, posixpath, re, subprocess, sys, urllib.request
from pathlib import Path
from urllib.parse import unquote

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

API = "1.0.0"
SPEC_MAJOR, SPEC_MINOR = 1, 0
SCHEMAS = Path(os.environ.get("CRAFTPACK_SCHEMAS", Path(__file__).resolve().parents[2] / "schemas" / "craftpack" / "1"))
PATH_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
EXEC_EXT = {".js", ".mjs", ".cjs", ".wasm", ".html"}
LIST_ITEMS = {"recipes": ("recipes", "id"), "control-types": ("types", "id"), "layouts": ("layouts", "id"),
              "palette-actions": ("actions", "id"), "visuals": ("visuals", "id")}


class Diag(Exception):
    def __init__(self, code, msg, where=""):
        super().__init__(f"{code} {where}: {msg}")
        self.code, self.msg, self.where = code, msg, where


# ---------------------------------------------------------------- schemas
_reg = None


def registry():
    global _reg
    if _reg is None:
        res = []
        for p in sorted(SCHEMAS.rglob("*.schema.json")):
            doc = json.loads(p.read_text())
            res.append((doc["$id"], Resource.from_contents(doc)))
        _reg = Registry().with_resources(res)
    return _reg


def schema_errors(doc, schema_name, relax=False):
    schema = json.loads((SCHEMAS / schema_name).read_text())
    out = []
    for e in sorted(Draft202012Validator(schema, registry=registry()).iter_errors(doc), key=lambda e: list(map(str, e.absolute_path))):
        if relax and e.validator == "additionalProperties":
            continue
        out.append(("/" + "/".join(map(str, e.absolute_path)), e.message[:160], e))
    return out


# ---------------------------------------------------------------- hashing
def sha(b):
    return "sha256:" + hashlib.sha256(b).hexdigest()


def read_json(p):
    return json.loads(Path(p).read_bytes().decode("utf-8"))


def bad_path(p):
    if not isinstance(p, str) or not p or PATH_RE.match(p) or p.startswith("/") or "\\" in p:
        return True
    return posixpath.normpath(p).split("/")[0] == ".."


def asset_files(root, index_rel):
    base = Path(root)
    files = []
    for dp, _, fns in os.walk(base):
        for fn in fns:
            rel = (Path(dp) / fn).relative_to(base).as_posix()
            if rel != index_rel:
                files.append(rel)
    return sorted(files, key=lambda s: s.encode())


def build_index(root, index_rel):
    lines, total = [], 0
    files = asset_files(root, index_rel)
    for rel in files:
        b = (Path(root) / rel).read_bytes()
        total += len(b)
        lines.append(f"{hashlib.sha256(b).hexdigest()}  {rel}\n")
    return "".join(lines).encode(), len(files), total


# ---------------------------------------------------------------- validate
def walk(x):
    yield x
    if isinstance(x, dict):
        for v in x.values():
            yield from walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk(v)


def sound_paths(kind, data):
    """(pointer, path) of every file reference in a sounds / vox-bank entry."""
    maps = {"sounds": [("", data)], "vox-bank": [(f"/maps/{k}", v) for k, v in (data.get("maps") or {}).items()]}.get(kind, [])
    for ptr, m in maps:
        if not isinstance(m, dict):
            continue
        if "_base" in m:
            yield f"{ptr}/_base", m["_base"]
        for k, v in m.items():
            if k == "_base":
                continue
            for i, f in enumerate(v if isinstance(v, list) else [x for lst in (v or {}).values() for x in lst] if isinstance(v, dict) else []):
                yield f"{ptr}/{k}/{i}", f


def validate_pack(root):
    """-> (errors, warnings), each a list of (code, where, msg)."""
    root = Path(root)
    E, W = [], []
    mf = root / "craftpack.json"
    try:
        man = read_json(mf)
    except Exception as ex:
        return [("E_PACK_SCHEMA", "craftpack.json", f"unreadable: {ex}")], W
    spec = str(man.get("craftpack", "")) if isinstance(man, dict) else ""
    m = re.match(r"^(\d+)\.(\d+)\.", spec)
    if not m or int(m[1]) != SPEC_MAJOR:
        return [("E_PACK_SPEC", "craftpack", f"spec {spec!r} not supported (host reads {SPEC_MAJOR}.x)")], W
    newer = int(m[2]) > SPEC_MINOR
    if newer:
        W.append(("W_PACK_NEWER", "craftpack", f"spec {spec} is newer than this validator ({SPEC_MAJOR}.{SPEC_MINOR})"))
    kinds = json.loads((SCHEMAS / "kinds" / "index.json").read_text())["kinds"]
    ings = man.get("ingredients") if isinstance(man.get("ingredients"), list) else []
    flagged = set()  # manifest pointers already reported as path errors (schema reports on them are dropped)
    skip_hash = set()

    def path_check(ptr, p):
        if bad_path(p):
            E.append(("E_PACK_PATH", ptr, f"{p!r} leaves the pack root, is absolute or has a scheme"))
            flagged.add(ptr)
            return False
        return True

    if "licenseFile" in man:
        path_check("/licenseFile", man["licenseFile"])
    for i, ing in enumerate(ings):
        if not isinstance(ing, dict):
            continue
        b = f"/ingredients/{i}"
        for key in ("path", "licenseFile"):
            if key in ing and not path_check(f"{b}/{key}", ing[key]):
                skip_hash.add((i, key))
        for j, mod in enumerate(ing.get("modules") or []):
            if isinstance(mod, dict) and "path" in mod and not path_check(f"{b}/modules/{j}/path", mod["path"]):
                skip_hash.add((i, f"m{j}"))
        a = ing.get("assets")
        if isinstance(a, dict):
            for key in ("root", "index"):
                if key in a and not path_check(f"{b}/assets/{key}", a[key]):
                    skip_hash.add((i, "assets"))

    # code flags (section 10.3) before the schema so its code/modules complaints are not reported twice
    undeclared = set()
    for i, ing in enumerate(ings):
        if not isinstance(ing, dict):
            continue
        b = f"/ingredients/{i}"
        code = ing.get("code") is True
        why = []
        if ing.get("modules") and not code:
            why.append("modules listed")
        if kinds.get(ing.get("kind"), {}).get("code") == "always" and not code:
            why.append(f"kind {ing.get('kind')} is code-bearing")
        ent = root / ing["path"] if isinstance(ing.get("path"), str) and not bad_path(ing["path"]) else None
        if ing.get("kind") in ("hooks", "components") and ent and ent.is_file() and not code:
            try:
                if any(isinstance(n, dict) and (n.get("opaque") is True or "$code" in n) for n in walk(read_json(ent))):
                    why.append("opaque def or $code in entry file")
            except Exception:
                pass
        a = ing.get("assets")
        if isinstance(a, dict) and not bad_path(a.get("root", "")) and (root / a.get("root", ".")).is_dir():
            listed = {posixpath.normpath(mm.get("path", "")) for mm in ing.get("modules") or [] if isinstance(mm, dict)}
            for rel in asset_files(root / a["root"], a.get("index", "")):
                full = posixpath.normpath(posixpath.join(a["root"], rel))
                if Path(rel).suffix.lower() in EXEC_EXT and full not in listed:
                    why.append(f"executable file {full} not in modules")
        if why:
            undeclared.add(i)
            E.append(("E_PACK_CODE_UNDECLARED", b, "; ".join(why)))

    for ptr, msg, e in schema_errors(man, "manifest.schema.json", relax=newer):
        if any(ptr == f or ptr.startswith(f + "/") for f in flagged):
            continue
        mi = re.match(r"^/ingredients/(\d+)(?:/(code|modules))?", ptr)
        if mi and int(mi[1]) in undeclared and (mi[2] or "code" in msg or "modules" in msg):
            continue
        E.append(("E_PACK_SCHEMA", ptr or "/", msg))

    seen = set()
    for i, ing in enumerate(ings):
        if isinstance(ing, dict) and ing.get("id") in seen:
            E.append(("E_PACK_ID", f"/ingredients/{i}/id", f"duplicate ingredient id {ing['id']!r}"))
        seen.add(ing.get("id") if isinstance(ing, dict) else None)
    deps = man.get("dependencies") or {}
    ids = {ing.get("id") for ing in ings if isinstance(ing, dict)}
    for i, ing in enumerate(ings):
        for r in (ing.get("requires") or []) if isinstance(ing, dict) else []:
            if ":" in r and r.split(":")[0] not in deps:
                E.append(("E_PACK_DEP_UNDECLARED", f"/ingredients/{i}/requires", f"{r} names a pack not in dependencies"))
            elif ":" not in r and r not in ids:
                E.append(("E_PACK_ID", f"/ingredients/{i}/requires", f"{r} is not an ingredient of this pack"))

    # hash tree (section 8): entry files, modules, asset indexes, assets
    items = {}
    for i, ing in enumerate(ings):
        if not isinstance(ing, dict):
            continue
        b = f"/ingredients/{i}"
        if "path" in ing and (i, "path") not in skip_hash and isinstance(ing.get("hash"), str):
            ok = check_file(root, ing["path"], ing["hash"], f"{b}/hash", E)
            if ok is not None:
                validate_entry(root, ing, b, ok, kinds, items, E, W, newer)
        for j, mod in enumerate(ing.get("modules") or []):
            if isinstance(mod, dict) and (i, f"m{j}") not in skip_hash and "path" in mod and "hash" in mod:
                check_file(root, mod["path"], mod["hash"], f"{b}/modules/{j}/hash", E)
        a = ing.get("assets")
        if isinstance(a, dict) and (i, "assets") not in skip_hash and {"root", "index", "hash"} <= set(a):
            check_assets(root, a, f"{b}/assets", E)
    for kind, byid in items.items():
        for item, n in byid.items():
            if n > 1:
                E.append(("E_PACK_ID", f"kind {kind}", f"item id {item!r} defined {n} times in one pack"))
    return E, W


def check_file(root, rel, want, where, E):
    f = root / rel
    if not f.is_file():
        E.append(("E_PACK_HASH", where, f"{rel} is missing"))
        return None
    b = f.read_bytes()
    if sha(b) != want:
        E.append(("E_PACK_HASH", where, f"{rel}: expected {want[:19]}..., got {sha(b)[:19]}..."))
        return None
    return b


def check_assets(root, a, where, E):
    idx = root / a["root"] / a["index"]
    base = root / a["root"]
    if not idx.is_file():
        E.append(("E_PACK_HASH", where, f"asset index {a['root']}/{a['index']} is missing"))
        return
    ib = idx.read_bytes()
    if sha(ib) != a["hash"]:
        E.append(("E_PACK_HASH", f"{where}/hash", "asset index hash does not match"))
    listed = {}
    for ln in ib.decode().splitlines():
        m = re.match(r"^([0-9a-f]{64})  (.+)$", ln)
        if not m:
            E.append(("E_PACK_HASH", where, f"malformed asset index line {ln[:40]!r}"))
            continue
        listed[m[2]] = m[1]
    actual = asset_files(base, a["index"])
    for rel in actual:
        if rel not in listed:
            E.append(("E_PACK_HASH", where, f"{rel} is not in the asset index"))
        elif hashlib.sha256((base / rel).read_bytes()).hexdigest() != listed[rel]:
            E.append(("E_PACK_HASH", where, f"{rel} does not match the asset index"))
    for rel in listed:
        if rel not in actual:
            E.append(("E_PACK_HASH", where, f"{rel} is in the asset index but missing"))
    if "files" in a and a["files"] != len(actual):
        E.append(("E_PACK_HASH", f"{where}/files", f"files is {a['files']}, found {len(actual)}"))


def validate_entry(root, ing, b, raw, kinds, items, E, W, newer):
    kind, fmt = ing.get("kind"), ing.get("format", "")
    k = kinds.get(kind)
    fm = re.match(r"^([a-z][a-z0-9.-]*)@(\d+)", fmt or "")
    if not k or not fm or f"{fm[1]}@{fm[2]}" not in k["formats"]:
        W.append(("W_PACK_KIND", b, f"kind/format {kind} {fmt} unknown to this validator: ingredient skipped"))
        return
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as ex:
        E.append(("E_PACK_SCHEMA", f"{b}/path", f"entry file is not JSON: {ex}"))
        return
    pathflag = set()
    for ptr, p in sound_paths(kind, data):
        full = posixpath.normpath(posixpath.join(posixpath.dirname(ing["path"]), p)) if isinstance(p, str) else ""
        if bad_path(p) or full.split("/")[0] == "..":
            E.append(("E_PACK_PATH", f"{ing['path']}#{ptr}", f"{p!r} leaves the pack root, is absolute or has a scheme"))
            pathflag.add(ptr)
    for ptr, msg, e in schema_errors(data, k["schema"], relax=newer):
        # a path error already reported at or below this pointer explains the schema complaint too
        if any(ptr == f or ptr.startswith(f + "/") or f.startswith(ptr + "/") for f in pathflag):
            continue
        E.append(("E_PACK_SCHEMA", f"{ing['path']}#{ptr or '/'}", msg))
    if kind in LIST_ITEMS and isinstance(data, dict):
        key, idk = LIST_ITEMS[kind]
        for it in data.get(key) or []:
            if isinstance(it, dict) and idk in it:
                d = items.setdefault(kind, {})
                d[it[idk]] = d.get(it[idk], 0) + 1


# ---------------------------------------------------------------- semver
def parse_v(s):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$", s)
    if not m:
        raise ValueError(f"bad version {s!r}")
    return (int(m[1]), int(m[2]), int(m[3]), m[4])


def vkey(s):
    a, b, c, pre = parse_v(s)
    return (a, b, c, 1 if pre is None else 0, pre or "")


def satisfies(version, rng):
    v = vkey(version)[:3]
    pre = parse_v(version)[3]
    for alt in rng.split("||"):
        ok = True
        for tok in alt.split():
            m = re.match(r"^(\^|~|>=|<=|>|<|=)?v?([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?", tok)
            if not m:
                ok = False
                break
            op = m[1] or "="
            parts = [None if p is None or p in "xX*" else int(p) for p in m.groups()[1:]]
            lo = tuple(p or 0 for p in parts)
            n = sum(p is not None for p in parts[:3]) if parts[0] is not None else 0
            if n == 0:
                good = op in ("=", "^", "~", ">=", "<=")
            elif op == "^":
                hi = (lo[0] + 1, 0, 0) if lo[0] > 0 or n == 1 else (0, lo[1] + 1, 0) if lo[1] > 0 or n == 2 else (0, 0, lo[2] + 1)
                good = lo <= v < hi
            elif op == "~":
                hi = (lo[0], lo[1] + 1, 0) if n >= 2 else (lo[0] + 1, 0, 0)
                good = lo <= v < hi
            elif op == "=":
                hi = [(lo[0] + 1, 0, 0), (lo[0], lo[1] + 1, 0), (lo[0], lo[1], lo[2] + 1)][n - 1]
                good = lo <= v < hi
            elif op == ">=":
                good = v >= lo
            elif op == ">":
                hi = [(lo[0] + 1, 0, 0), (lo[0], lo[1] + 1, 0), (lo[0], lo[1], lo[2] + 1)][n - 1]
                good = v >= hi
            elif op == "<=":
                hi = [(lo[0] + 1, 0, 0), (lo[0], lo[1] + 1, 0), (lo[0], lo[1], lo[2] + 1)][n - 1]
                good = v < hi
            else:
                good = v < lo
            if not good:
                ok = False
                break
        if ok and not (pre and False):
            return True
    return False


# ---------------------------------------------------------------- sources and lock
GH = re.compile(r"^github:([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:@([^/\s]+))?(/[^\s]*)?$")


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "craftpack-tools"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def gh_resolve(owner, repo, ref):
    if re.fullmatch(r"[0-9a-f]{40}", ref):
        return ref
    ref = unquote(ref)
    try:
        sha_ = http_get_header(f"https://api.github.com/repos/{owner}/{repo}/commits/{ref}").decode().strip()
        if re.fullmatch(r"[0-9a-f]{40}", sha_):
            return sha_
    except Exception:
        pass
    out = subprocess.run(["git", "ls-remote", f"https://github.com/{owner}/{repo}.git", f"refs/heads/{ref}", f"refs/tags/{ref}^{{}}", f"refs/tags/{ref}"],
                         capture_output=True, text=True, timeout=60).stdout.split()
    if out and re.fullmatch(r"[0-9a-f]{40}", out[0]):
        return out[0]
    raise Diag("E_PACK_SOURCE", f"cannot resolve {owner}/{repo}@{ref} to a commit")


def http_get_header(url):
    req = urllib.request.Request(url, headers={"User-Agent": "craftpack-tools", "Accept": "application/vnd.github.sha"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def fetch_manifest(source, base):
    """source is already pinned (or file:/https:). -> manifest bytes."""
    if source.startswith("file:"):
        return (Path(base) / source[5:] / "craftpack.json").read_bytes()
    m = GH.match(source)
    if m:
        o, r, ref, path = m.groups()
        return http_get(f"https://raw.githubusercontent.com/{o}/{r}/{ref}{path or ''}/craftpack.json")
    if source.startswith("https://"):
        return http_get(source.rstrip("/") + "/craftpack.json")
    raise Diag("E_PACK_SOURCE", f"source form {source!r} cannot be fetched by this tool (git+ needs a mirror)")


def pin(source, existing, update):
    m = GH.match(source)
    if not m:
        return source
    o, r, ref, path = m.groups()
    if ref is None:
        raise Diag("E_PACK_SOURCE", f"{source}: name a branch, tag or commit with @ref")
    if existing and not update and existing.get("requested") == source:
        return existing["source"]
    return f"github:{o}/{r}@{gh_resolve(o, r, ref)}{path or ''}"


def load_registries(req, base):
    packs = {}
    for url in req.get("registries") or []:
        try:
            doc = json.loads(http_get(url) if url.startswith("https://") else (Path(base) / url).read_bytes())
        except Exception:
            continue
        for p in doc.get("packs", []):
            packs.setdefault(p["id"], []).extend(v for v in p["versions"] if not v.get("yanked"))
    return packs


def resolve_lock(req_path, existing=None, update=()):
    req_path = Path(req_path)
    base = req_path.parent
    req = read_json(req_path)
    bad = schema_errors(req, "packs.schema.json")
    if bad:
        raise Diag("E_PACK_SCHEMA", bad[0][1], "packs.json" + bad[0][0])
    regs = load_registries(req, base)
    old = {p["id"]: p for p in (existing or {}).get("packs", [])}
    cands, order, requesters = {}, [], {}

    def add(id_, source, requested, want, by):
        mb = fetch_manifest(source, base)
        man = json.loads(mb)
        if man.get("id") != id_:
            raise Diag("E_PACK_NAMESPACE", f"{source} holds pack {man.get('id')!r}, not {id_!r}", id_)
        if id_ in cands:
            if cands[id_]["source"] != source:
                raise Diag("E_PACK_NAMESPACE", f"{id_} comes from two sources: {cands[id_]['source']} and {source}", id_)
            return
        cands[id_] = {"id": id_, "man": man, "source": source, "requested": requested, "manifest": sha(mb), "want": want, "by": by}
        order.append(id_)

    def from_registry(id_, rng):
        vs = sorted((v for v in regs.get(id_, []) if satisfies(v["version"], rng)), key=lambda v: vkey(v["version"]))
        return vs[-1] if vs else None

    for w in req.get("want", []):
        if "source" in w:
            add(w["id"], pin(w["source"], old.get(w["id"]), w["id"] in update), w["source"], w, "packs.json")
        else:
            v = from_registry(w["id"], w.get("version", "*"))
            if not v:
                raise Diag("E_PACK_DEP_MISSING", f"{w['id']} {w.get('version', '*')} not found in the registries", w["id"])
            add(w["id"], v["source"], None, w, "packs.json")
    queue = list(order)
    while queue:
        pid = queue.pop(0)
        for dep, rng in (cands[pid]["man"].get("dependencies") or {}).items():
            requesters.setdefault(dep, []).append((pid, rng))
            if dep not in cands:
                v = from_registry(dep, rng)
                if not v:
                    raise Diag("E_PACK_DEP_MISSING", f"{pid} needs {dep} {rng}: not in packs.json or the registries", pid)
                add(dep, v["source"], None, {"id": dep}, pid)
                queue.append(dep)
            ver = cands[dep]["man"]["version"]
            if not satisfies(ver, rng):
                other = [f"{r} wants {x}" for r, x in requesters[dep] if r != pid] or [f"{cands[dep]['by']} selected it"]
                raise Diag("E_PACK_DEP_CONFLICT", f"{dep} is {ver}: {pid} needs {rng} but {'; '.join(other)}", pid)
    out, state = [], {}

    def visit(pid, chain):
        if state.get(pid) == 2:
            return
        if state.get(pid) == 1:
            raise Diag("E_PACK_DEP_CYCLE", " -> ".join(chain + [pid]), pid)
        state[pid] = 1
        for dep in sorted((cands[pid]["man"].get("dependencies") or {})):
            visit(dep, chain + [pid])
        state[pid] = 2
        out.append(pid)

    for pid in order:
        visit(pid, [])
    packs = []
    for pid in out:
        c, w = cands[pid], cands[pid]["want"]
        e = {"id": pid, "version": c["man"]["version"], "source": c["source"]}
        if c["requested"] and c["requested"] != c["source"]:
            e["requested"] = c["requested"]
        e["manifest"] = c["manifest"]
        if w.get("bundle"):
            e["mirrors"] = [f"./packs/{pid}/{c['manifest'][7:19]}/"]
        e["priority"] = w.get("priority", 0)
        if w.get("allowCode"):
            e["allowCode"] = w["allowCode"]
        if w.get("bundle"):
            e["bundle"] = True
        e["dependencies"] = {d: cands[d]["man"]["version"] for d in sorted(c["man"].get("dependencies") or {})}
        packs.append(e)
    lock = {"lock": 1, "craftpack": "1.0.0", "generator": "strudel packs lock", "packs": packs}
    bad = schema_errors(lock, "lock.schema.json")
    if bad:
        raise Diag("E_PACK_SCHEMA", bad[0][1], "packs.lock.json" + bad[0][0])
    return lock


def dump(doc):
    return (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()


# ---------------------------------------------------------------- registry
def pack_dirs(root):
    return sorted(Path(dp) for dp, _, fns in os.walk(root) if "craftpack.json" in fns)


def registry_build(root, out, github=None):
    out = Path(out).resolve()
    byid, skipped = {}, []
    for d in pack_dirs(root):
        E, _ = validate_pack(d)
        if E:
            skipped.append((d, sorted({c for c, _, _ in E})))
            continue
        man = read_json(d / "craftpack.json")
        rel = os.path.relpath(d.resolve(), Path(root).resolve()).replace(os.sep, "/")
        if github:
            src = f"github:{github}" + ("" if rel == "." else "/" + rel)
        else:
            r = os.path.relpath(d.resolve(), out.parent).replace(os.sep, "/")
            src = "file:" + (r if r.startswith(".") else "./" + r) + "/"
        ings = man["ingredients"]
        total = sum(i.get("bytes", 0) + (i.get("assets") or {}).get("bytes", 0) for i in ings)
        v = {"version": man["version"], "source": src, "manifest": sha((d / "craftpack.json").read_bytes()), "craftpack": man["craftpack"]}
        for k in ("engines", "dependencies"):
            if man.get(k):
                v[k] = man[k]
        v["kinds"] = sorted({i["kind"] for i in ings})
        v["code"] = any(i.get("code") for i in ings)
        v["bytes"] = total
        p = byid.setdefault(man["id"], {"id": man["id"]})
        for k in ("title", "description", "repository", "license", "keywords"):
            if man.get(k):
                p[k] = man[k]
        if any(i.get("redistribution") is False for i in ings):
            p["redistribution"] = False
        p.setdefault("versions", []).append(v)
    packs = []
    for id_ in sorted(byid):
        p = byid[id_]
        p["versions"].sort(key=lambda v: vkey(v["version"]))
        packs.append(p)
    return {"registry": 1, "name": "craftpack registry", "packs": packs}, skipped


def registry_check(index_path):
    index_path = Path(index_path)
    doc = read_json(index_path)
    E = [("E_PACK_SCHEMA", ptr, msg) for ptr, msg, _ in schema_errors(doc, "registry.schema.json")]
    for p in doc.get("packs", []) if isinstance(doc, dict) else []:
        lic = p.get("license", "")
        if not lic or "LicenseRef-undecided" in lic:
            E.append(("E_PACK_LICENSE", p.get("id", "?"), f"license {lic!r}: registries refuse a missing or undecided licence"))
        author = str(p.get("id", "/")).split("/")[0]
        for v in p.get("versions", []):
            src = v.get("source", "")
            m = GH.match(src)
            # section 3: a github: source must sit under the owner that matches the namespace; other hosts are
            # accepted by a reviewed registry change, except the reserved glyphcore/* namespace.
            if m and m[1].lower() != author:
                E.append(("E_PACK_NAMESPACE", p["id"], f"{author}/* is not allowed from github owner {m[1]}"))
            elif not m and author == "glyphcore" and not src.startswith("file:"):
                E.append(("E_PACK_NAMESPACE", p["id"], "glyphcore/* is reserved for the Glyphcore repository"))
            if src.startswith("file:"):
                d = index_path.parent / src[5:]
                try:
                    mb = (d / "craftpack.json").read_bytes()
                except OSError:
                    E.append(("E_PACK_HASH", p["id"], f"{src} has no craftpack.json"))
                    continue
                man = json.loads(mb)
                if sha(mb) != v.get("manifest"):
                    E.append(("E_PACK_HASH", p["id"], f"manifest hash of {src} does not match"))
                if "LicenseRef-undecided" in str(man.get("license")):
                    E.append(("E_PACK_LICENSE", p["id"], "manifest licence is LicenseRef-undecided"))
                if bool(v.get("code")) != any(i.get("code") for i in man.get("ingredients", [])):
                    E.append(("E_PACK_CODE_UNDECLARED", p["id"], "registry `code` flag does not match the manifest"))
    return E


# ---------------------------------------------------------------- hash command
def cmd_hash(d, write, check):
    d = Path(d)
    mf = d / "craftpack.json"
    man = read_json(mf)
    changes = []
    for ing in man["ingredients"]:
        eb = (d / ing["path"]).read_bytes()
        for key, val in (("hash", sha(eb)), ("bytes", len(eb))):
            if ing.get(key) != val:
                changes.append(f"{ing['id']}.{key}")
                ing[key] = val
        for mod in ing.get("modules") or []:
            mb = (d / mod["path"]).read_bytes()
            for key, val in (("hash", sha(mb)), ("bytes", len(mb))):
                if mod.get(key) != val:
                    changes.append(f"{ing['id']}:{mod['path']}.{key}")
                    mod[key] = val
        a = ing.get("assets")
        if a:
            ib, n, total = build_index(d / a["root"], a["index"])
            ip = d / a["root"] / a["index"]
            if not ip.is_file() or ip.read_bytes() != ib:
                changes.append(f"{ing['id']}.assets.index")
                if write:
                    ip.write_bytes(ib)
            for key, val in (("hash", sha(ib)), ("files", n), ("bytes", total)):
                if a.get(key) != val:
                    changes.append(f"{ing['id']}.assets.{key}")
                    a[key] = val
    if write and changes:
        mf.write_bytes(dump(man))
    return changes, man


# ---------------------------------------------------------------- CLI
def report(E, W, strict):
    for c, w, m in E + W:
        print(f"{c} {w}: {m}")
    return 1 if E or (strict and W) else 0


def main(argv):
    if argv[:1] == ["--api"]:
        print(API)
        return 0
    ap = argparse.ArgumentParser(prog="packs", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate"); v.add_argument("target"); v.add_argument("--strict", action="store_true")
    h = sub.add_parser("hash"); h.add_argument("dir"); h.add_argument("--write", action="store_true"); h.add_argument("--check", action="store_true")
    lk = sub.add_parser("lock"); lk.add_argument("request", nargs="?", default="packs.json"); lk.add_argument("-o", dest="out")
    lk.add_argument("--update", action="append", default=[]); lk.add_argument("--frozen", action="store_true")
    rg = sub.add_parser("registry"); rg.add_argument("action", choices=["build", "check"]); rg.add_argument("path")
    rg.add_argument("-o", dest="out"); rg.add_argument("--github", help="OWNER/REPO@COMMIT: write github: sources instead of file:")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "validate":
            t = Path(a.target)
            d = t.parent if t.name == "craftpack.json" else t
            if (d / "craftpack.json").is_file():
                E, W = validate_pack(d)
            elif (d / "packs.json").is_file():
                E, W = [], []
                try:
                    resolve_lock(d / "packs.json")
                except Diag as x:
                    E.append((x.code, x.where, x.msg))
            else:
                E, W = [("E_PACK_SCHEMA", str(d), "no craftpack.json or packs.json here")], []
            rc = report(E, W, a.strict)
            if rc == 0:
                print("OK", d)
            return rc
        if a.cmd == "hash":
            changes, _ = cmd_hash(a.dir, a.write, a.check)
            if a.check and changes:
                print("E_PACK_HASH stale:", ", ".join(changes))
                return 1
            print(("wrote " if a.write else "stale ") + ", ".join(changes) if changes else "up to date")
            return 0
        if a.cmd == "lock":
            req = Path(a.request)
            out = Path(a.out) if a.out else req.parent / "packs.lock.json"
            existing = read_json(out) if out.is_file() else None
            lock = resolve_lock(req, existing, set(a.update))
            data = dump(lock)
            if a.frozen:
                if not out.is_file() or out.read_bytes() != data:
                    print(f"E_LOCK_FROZEN {out}: lock would change")
                    return 1
                print("lock unchanged")
                return 0
            out.write_bytes(data)
            print(f"wrote {out} ({len(lock['packs'])} packs)")
            return 0
        if a.cmd == "registry" and a.action == "build":
            if not a.out:
                ap.error("registry build needs -o index.json")
            doc, skipped = registry_build(a.path, a.out, a.github)
            for d, codes in skipped:
                print(f"skipped {d}: {' '.join(codes)}", file=sys.stderr)
            Path(a.out).write_bytes(dump(doc))
            bad = schema_errors(doc, "registry.schema.json")
            if bad:
                print(f"E_PACK_SCHEMA {bad[0][0]}: {bad[0][1]}")
                return 1
            print(f"wrote {a.out} ({len(doc['packs'])} packs)")
            return 0
        E = registry_check(a.path)
        rc = report(E, [], False)
        if rc == 0:
            print("OK", a.path)
        return rc
    except Diag as x:
        print(f"{x.code} {x.where}: {x.msg}")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
