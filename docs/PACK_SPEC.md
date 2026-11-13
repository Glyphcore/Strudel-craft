# Craftpack: content packs for Strudel Craft (spec 1.0.0)

Status: design, 2026-11-13. Owner: `daw-sme`. Schemas: `schemas/craftpack/1/`. Issues: section 16.
Related: `docs/BLUEPRINT.md` (model, library, registries), `docs/HOOKS_SYNTAX.md` (config JSON, `E_OPAQUE`), `site/README.md` (what the site reads today).

## 1. What this is

Everything on the site that is not plumbing becomes **content**, and content ships in **packs**: a folder with a `craftpack.json` manifest that
lists typed, versioned, hash-pinned **ingredients** (a sound map, a vox bank, a recipe catalog, completion data, control types, ...).
The site and `engine/strudel-cli` ingest packs through one loader contract; neither hardcodes an item. Anyone can publish a pack from their
own repo; the first-party pack `glyphcore/core` uses the same layer and has no private path.

Plumbing (stays in `site/`): shell, transport, audio graph and meters, editors, the registries themselves (intellisense, controls, palette,
literals, workspace, library store, hooks runtime, model parser), history, service worker, tracker, the pack loader, `data/schema/model.v1.json`.
Content (moves out): every file under `site/data/` except `schema/`, plus the item lists now written inside JS (visual names in `visuals.js`,
`DEFAULTS` in `workspace.js`, built-in palette entries, the bank table and prelude in `prelude/word.js`).

Terms: MUST / SHOULD / MAY as in RFC 2119. "Host" = a program that loads packs (the site, the CLI).

## 2. Design decisions

| decision | reason | rejected |
|---|---|---|
| A pack is a plain folder of static files, addressed by a pinned source | works from GitHub raw, any static host, a local disk; no build step, same as the site | npm packages (account, registry, a bundler the site does not have); git submodules (Pages and contributor friction) |
| Integrity is SHA-256 over raw file bytes, as a tree: lock -> manifest -> entry files, modules, asset indexes -> assets | one hash in the lockfile pins every byte; checkable with `sha256sum`; identical in browser (`crypto.subtle`) and Node | canonical-JSON hashing (RFC 8785: a canonicaliser in two runtimes, and it does not cover audio or code); git blob SHA-1 (git only, weak); SRI base64 (cannot be compared with `sha256sum` by eye) |
| Dependencies are resolved when the lock is written, never at runtime | the browser needs no resolver; a render is reproducible from the lock alone | runtime semver resolution (network on boot, different results on different days) |
| One version of a pack id per host session | the pack id is the runtime namespace; two copies would make `a/p:x` ambiguous | nested per-dependent copies |
| Qualified ids are immutable; precedence only decides who owns a **bare** name; the default is first-come | adding a pack can never change what an existing program plays | last-wins (a new pack silently replaces `knob` or a recipe); deep merge (order-dependent, unreadable) |
| Data first; code is a flagged, hash-bound, per-ingredient grant, sandboxed unless first-party or local | a pack must be safe to browse; consent to "full page access" from a stranger is not real consent | trusting by registry listing; a single "trust this pack" switch |
| Kinds are a registry of adapters with their own sub-schema versions | a host can add a kind, or lack one, without a spec bump | one monolithic schema |
| First-party content lives on an orphan `packs` branch and is bundled into the deploy at the locked commit | `main` keeps plumbing only; the site still boots same-origin and offline; a content change is a reviewed lock bump | content on `main` (no decoupling); runtime-only fetch from raw.githubusercontent (first paint and offline depend on a third host); a second repo (splits issues and CI for no gain) |

## 3. Names

- **Pack id**: `author/pack`. Each segment `[a-z0-9]`, `[a-z0-9-]`, 1-39 chars, no leading or trailing hyphen. Lower case only.
- **Ingredient id**: `author/pack:ingredient`. `ingredient` matches `[a-z0-9][a-z0-9._-]{0,63}` and is unique in the pack.
- **Item id**: `author/pack:item`, where `item` is an entry of some ingredient (a recipe id, a control type id, a layout id). Item ids are unique
  per pack **per kind**, the same rule as BLUEPRINT section 5 ("names are unique per kind per scope"). A reference is always read in the
  context of one kind (a pad's recipe ref is looked up among recipes), so `glyphcore/core:knob` the control type and a recipe called `knob`
  do not clash. Where a kind must be written out (URLs, reports) the form is `kind!author/pack:item`.
- **Bare name**: `item` alone. Resolved by precedence (section 9). Existing programs, deep links (`#r/four-on-the-floor`) and `ctl("x", {type: "knob"})`
  keep working through bare names. New deep links are written qualified: `#r/glyphcore/core:four-on-the-floor`.
- **Sound names** are the exception: Strudel mini-notation uses `:` for the sample index and `/` for slowing, so a qualified id cannot be
  written inside `s("...")`. A sound key is therefore a global bare name (`[A-Za-z0-9][A-Za-z0-9_]*`), and every key is also registered under
  the mini-safe alias `<author>_<pack>__<key>` (hyphens become underscores), e.g. `glyphcore_vox_demo__vox_call`. The alias always resolves
  to its own pack.
- **Namespace ownership**: a pack id maps to exactly one source in a lock (`E_PACK_NAMESPACE` otherwise). A registry accepts
  `author/*` from a `github:` source only when `author` equals the lower-cased repository owner; other hosts are accepted by a reviewed
  change to the registry. `glyphcore/*` is reserved for this repository.
- Extension kinds are named `x-<author>.<kind>`; hosts without an adapter skip them silently.

## 4. Manifest (`craftpack.json`)

Schema: `schemas/craftpack/1/manifest.schema.json`. Worked examples: `schemas/craftpack/1/examples/`.

```json
{
  "$schema": "https://glyphcore.github.io/Strudel-craft/schemas/craftpack/1/manifest.schema.json",
  "craftpack": "1.0.0",
  "id": "glyphcore/vox-vocalset",
  "version": "1.0.0",
  "title": "VocalSet sustained vowels",
  "license": "CC-BY-4.0",
  "attribution": [{ "name": "VocalSet: A Singing Voice Dataset, Julia Wilkins et al.", "url": "https://doi.org/10.5281/zenodo.1193957",
                    "text": "VocalSet ... (CC BY 4.0)", "changes": "trimmed, faded, peak-normalised, mono 22.05 kHz ogg" }],
  "engines": { "craft": "^1.0.0", "strudel": "^1.3.0" },
  "dependencies": { "glyphcore/core": "^1.0.0" },
  "ingredients": [
    { "id": "bank", "kind": "vox-bank", "format": "vox-bank@1", "version": "1.0.0",
      "path": "bank.json", "hash": "sha256:<64 hex>", "load": "manual",
      "requires": ["glyphcore/core:word"],
      "assets": { "root": ".", "index": "files.sha256", "hash": "sha256:<64 hex>", "files": 132, "bytes": 3400000 } }
  ]
}
```

Pack fields: `craftpack` (spec version, required), `id`, `version` (pack semver), `license` (required), `ingredients` (required, 1-512);
optional `title`, `description`, `authors[{name,url}]`, `homepage`, `repository`, `keywords`, `licenseFile`, `attribution[]`, `engines`,
`dependencies`, and any `x-*` key. `authors` is optional and may hold a handle; nothing else in a pack identifies a person.

Ingredient fields:

| field | req | meaning |
|---|---|---|
| `id` | yes | unique in the pack |
| `kind` | yes | section 5 |
| `format` | yes | `<kind>@<major>[.<minor>]`: the kind sub-schema the entry file follows |
| `version` | yes | semver of this ingredient's content; bumped whenever its `hash` changes |
| `path` | yes | entry file, relative to the pack root |
| `hash` | yes | `sha256:<hex>` of the entry file bytes |
| `bytes`, `title`, `description`, `tags` | no | shown in pack browsers; `bytes` drives download prompts |
| `license`, `licenseFile`, `attribution`, `redistribution` | no | section 7; override the pack values |
| `requires` | no | ingredients loaded first: bare = same pack, `a/p:x` = a pack in `dependencies` |
| `compat` | no | `engines` ranges for this ingredient only |
| `hosts` | no | `["site"]`, `["cli"]` or both; default every host that has an adapter for the kind |
| `load` | no | `eager`, `lazy` (default) or `manual` (section 9.4) |
| `code` | no | `true` = code-bearing (section 10). Required `true` for `prelude` and `intellisense-provider`; forbidden for pure data kinds |
| `modules` | with code | every executable file: `{path, hash, bytes, realm: "sandbox" | "main"}` |
| `assets` | with binaries | `{root, index, hash, files, bytes}` (section 8) |
| `options` | no | kind-specific switches (`$defs.options` of the kind schema) |

### 4.1 Versions

Three independent numbers, all semver:

| number | where | bump rule |
|---|---|---|
| spec | `craftpack` | major = a 1.x host cannot read the manifest; minor = additive fields or kinds; patch = wording |
| kind format | `format` (`recipes@1`) and the schema file name `kinds/<kind>.<major>.schema.json` | major = entry file shape breaks; minor = additive |
| content | pack `version`, ingredient `version` | major = an item id was removed or its meaning changed (programs that use it may change sound); minor = items added; patch = fixes |

Host rules: spec major unknown -> `E_PACK_SPEC`, pack refused. Spec minor newer than the host -> load, ignore unknown fields, `W_PACK_NEWER`.
Kind unknown or format major unsupported -> that ingredient is skipped with `W_PACK_KIND`; the rest of the pack loads. Schemas are strict
(`additionalProperties: false`, `x-*` allowed); a validator relaxes unknown properties only when the declared minor is newer than its own.
The host pack API has its own semver, `strudelCraft.packs.api` (site) = `strudel packs --api` (CLI), matched by `engines.craft`.
`engines.strudel` is matched against the `@strudel/core` version the host loaded. A failed range is `E_PACK_ENGINE` (pack or ingredient skipped).

## 5. Ingredient kinds

Index: `schemas/craftpack/1/kinds/index.json`. Each kind has a schema `kinds/<kind>.1.schema.json`, a host **adapter**
(`packs.registerKind`, section 11) and a code policy: `never` (pure data), `optional` (data, may add modules), `always`.

| kind | entry file holds | goes into (existing plumbing) | code | hosts | today |
|---|---|---|---|---|---|
| `sounds` | strudel.json-compatible map: `key -> [files]` or `key -> {note: [files]}`, optional relative `_base` | `samples(map, base)`; sound names in intellisense | never | site, cli | third-party maps via `samples()` |
| `vox-bank` | `{prefix, maps: {flat, pitched}, words, sr, voice, fallback}`; maps are `sounds@1`, words file is `vox-bank.words@1` | `voxBank()`, `word()`, `syl()`, word completions | never | site, cli | `site/data/vox/*` (local only) |
| `recipes` | `{categories, labels, recipes[]}`; recipe = `id, title, intent, code, expr, labels, needs[], bpm_hint, verified, rms_dbfs, centroid_hz, ...` | Rack browser, Stack, `catalog` provider, pad targets | never (program text) | site, cli | `data/catalog.json` |
| `syntax` | `sections[{id, title, needs, explain, examples[{title, code}]}]` | Syntax view, `syntax` provider | never (program text) | site | `data/syntax.json` |
| `docs` | `{view, sections[{title, blocks[html \| table \| code]}]}` | Ref and Practice views | never | site | `data/plugins.json`, `data/practices.json` |
| `intellisense` | `{provider, items[{label, detail, info, category, method, string, apply}]}` | `intellisense.register` (static provider) | never | site, cli (`strudel complete`) | `data/intellisense/strudel.json` `items` |
| `intellisense-provider` | `{id, module, provides: [items \| inline], timeoutMs}` | `intellisense.register` / `registerInline` through the sandbox | always | site | providers in `intellisense.js`, `inline.js` |
| `param-shapes` | `{shapes[], params{fn: [arg]}, ranges{}, canon{}}` | typed param completion and signature help; `wire()` and mod-matrix ranges | never | site, cli | `strudel.json` `params`/`shapes`, `data/mod_ranges.json`, CLI `lib/mod.mjs` |
| `param-editors` | `{byShape, byGroup, gestures, defaults, pools, editors[{id, shapes, module}]}` | `literals.registerEditor` | optional | site | `strudel.json` `editors` |
| `control-types` | `types[{id, value, keys, render: {fallback}, input, renderer}]` | `controls.registerType` / `registerRenderer` | optional | site, cli (types only) | `data/controls/types.json` |
| `visuals` | `visuals[{id, method, inline, builtin, painter}]` | `visual.<name>` control types, `visuals` provider | optional | site | names in `visuals.js` |
| `hooks` | model document with registry keys only (`defs, slots, markers, scopes, vars`); decorators are defs with `decorator: true` | `hooks.load` | optional (opaque defs, `$code`) | site, cli | none shipped |
| `components` | `components{"name@rev": model document}` | library store, `hooks.inst`, pad targets | optional (as hooks) | site, cli (`--library`) | none shipped |
| `layouts` | `layouts[{id, title, key, rows[[{id, w}]]}]` | `workspace.configs()` | never | site | `DEFAULTS` in `workspace.js` |
| `palette-actions` | `actions[{id, title, group, keys, do: {op, args} \| run}]` | `palette.register` | optional | site | built-in entries in JS |
| `prelude` | `{id, module, defines[]}` | evaluated into the Strudel eval context after init | always, realm `main` | site, cli | `prelude/word.js` |

Notes per kind:
- **sounds**: file paths are relative and MUST resolve inside the pack root (`E_PACK_PATH`); no URL schemes, so a pack is complete, hashable
  and offline-capable. The entry file is a valid `strudel.json`: `samples('<raw url of the entry file>')` works on strudel.cc with no craftpack
  support at all. A map that points at someone else's hosted samples is not a pack; keep using `samples(url)` for those.
- **vox-bank**: several banks may share a prefix on purpose (`vox_`): `voxBank(id)` activates one, and keys it lacks fall back along
  `fallback`. This user-initiated shadowing is the only place a later load may take over a sound name. `voxBank('demo')` keeps working as a
  bare name for `glyphcore/vox-demo:bank`. Banks without `words` (sustained vowels) offer `s()` only.
- **recipes / syntax / docs code blocks**: `code` is Strudel program text. It is data until a person presses Load or Play; a host never
  evaluates it on load (section 10.2). `needs[]` names the ingredients the recipe needs (replaces the boolean `needs_samples`, which stays
  readable); the site loads them before play and says so. Measured fields (`verified, rms_dbfs, centroid_hz, peak, error`) are written by
  the pack's build (`engine/strudel/build_catalog.py` for core), never by the host.
- **docs**: `html` blocks go through the host sanitiser for every pack, first-party included: allow-listed tags and attributes, no
  `script`, `style`, `iframe`, `on*`, `javascript:`; links get `rel="noopener"`.
- **param-shapes**: keyed by function name, so entries are bare by nature; whole-entry precedence (section 9.2). The CLI mod matrix reads
  `ranges`/`canon` from the same ingredient, which ends the hand-kept mirror between `data/mod_ranges.json` and `lib/mod.mjs`.
- **control-types / visuals / param-editors**: the declaration is data and works alone: an undrawn type renders through its `fallback`
  (BLUEPRINT 10.3). A `renderer`/`painter`/editor `module` is code and draws inside the sandbox frame (section 10.4). `builtin: true`
  visuals are the ones Strudel's own unmodified draw code provides; the pack only names them.
- **hooks / components**: validated against `site/data/schema/model.v1.json` as well. Chain-only defs are data. A def with `opaque: true`
  or any `$code` arg makes the ingredient code-bearing (`code: true`, else `E_PACK_CODE_UNDECLARED`). Component `meta.hash` is re-computed
  on load (`E_COMPONENT_HASH`). References become `lib:author/pack:name@rev`.
- **layouts**: unknown pane ids are dropped; a layout never closes or replaces the user's saved configs. `key` is a suggestion, applied
  only when free.
- **palette-actions**: `do.op` is one of `view, layout, recipe.load, recipe.play, insert, bank.activate, pack.load, transport, open-url`
  (`kinds/index.json` `ops`). `open-url` is https only and asks first. `run` names a sandboxed module that returns a list of the same ops.
- **prelude**: must list every global and `Pattern.prototype` name it adds in `defines`; anything else, or a name that already exists, is
  `E_NAME_COLLISION` (same rule as the hooks runtime).

### 5.1 Reserved kind: `atoms`

`docs/ATOMS.md` section 10 defines atoms as pack content. The kind name `atoms` is reserved for it (one ingredient = one namespace of
atoms, the "atomset" of that document); its sub-schema `kinds/atoms.1.schema.json` ships with #63, not here. The mapping to this spec:

| ATOMS.md record | craftpack |
|---|---|
| atomset `id` | ingredient id, `author/pack:ingredient`; `atoms.import("pack:author/pack:ingredient")` |
| atom `id`, `rev`, `hash`, `name`, `type` | inside the `atoms@1` entry file; an atom is an item, `author/pack:name` within kind `atoms` |
| pack pins `id@rev` + hash | ingredient `version` + `hash` (the manifest hash pins both) |
| `deps: [atom ids]` across packs | ingredient `requires` + pack `dependencies` |
| `requires: { sounds: [...] }` | `requires` naming the `sounds` / `vox-bank` ingredients |

Code policy `never`: an atom is data compiled to plain Strudel strings; an atom that needs `$code` falls under the `hooks` rule (code-bearing).

## 6. Dependencies and compatibility

- Pack level: `dependencies: {"author/pack": "<semver range>"}`. Ingredient level: `requires` (load order, and what a lazy load pulls in).
  A qualified `requires` MUST name a pack in `dependencies` (`E_PACK_DEP_UNDECLARED`).
- Resolution happens in `strudel packs lock` (section 12): highest version satisfying every range, one version per id, from the sources in
  `packs.json` and then its registries. No solution: `E_PACK_DEP_CONFLICT` with the two requesters. Cycles between packs: `E_PACK_DEP_CYCLE`.
- A host only reads the lock. A dependency missing from the lock is `E_PACK_DEP_MISSING`: the dependent pack is skipped, others load.
- A code ingredient pulled in through `requires` still needs its own grant; a dependency never widens trust.

## 7. Licence and attribution

- `license` is an SPDX expression or `LicenseRef-<id>` with a `licenseFile`. Required on the pack; an ingredient may override it.
- `attribution[]`: `{name, url, license, text, changes}`. `text` is the exact credit line; `changes` states modifications (CC BY 4.0).
- `redistribution: false` marks content that may be loaded from its source but not mirrored, bundled into another pack or re-published
  (example: an owner's own vocals shared by permission). Hosts refuse to `bundle` or re-export it outside its own lock entry; registries show it.
- Hosts MUST show licence and attribution for every loaded pack (site: pack sheet and a Credits list; CLI: `packs list`) and the CLI MUST
  write `packs[]` and the `attribution` of every ingredient a render used into `render.json`.
- Registries refuse a pack without a licence, and `LicenseRef-undecided`.
- Code ingredients under AGPL/GPL are loaded at run time as separate modules from their own pack; they are never copied into `site/`
  (CLAUDE.md: no vendored modified AGPL/GPL without a licence-decision issue). GPL tools stay external binaries and are not pack content.
- Audio the publisher has no right to redistribute (commercial sample packs, other people's vocals) MUST NOT be packed.

## 8. Integrity

- Hash string: `sha256:` + 64 lower-case hex of the raw bytes.
- Tree: `packs.lock.json` holds `manifest` = hash of `craftpack.json`. The manifest holds the hash of every entry file and module and, for
  ingredients with binaries, `assets.hash` = hash of the asset **index**: a text file in `sha256sum` format (`<hex>  <path>\n`, paths
  relative to `assets.root`, sorted by byte order, LF), listing every file under the root except the index. `sha256sum -c files.sha256`
  verifies a bank by hand.
- Files in a pack are byte-exact: LF line endings, no BOM; the template ships `.gitattributes` with `* -text`.
- Hosts MUST verify the manifest against the lock, and each entry file and module before parsing or executing it. Assets are verified when
  they first enter a cache (site: service worker; CLI: `packs install`); a cached asset is trusted. Any mismatch is `E_PACK_HASH`: the bytes
  are dropped, not cached, the ingredient is `failed`, and the next mirror is tried.
- Modules are fetched as bytes, hashed, then run from those bytes (blob URL or `data:` import), never by re-fetching the URL.
- Pack content hash = the manifest hash. It names the pack in caches, grants and registries.

## 9. Sources, lockfile, registry, loading

### 9.1 Sources

| form | pinned by | site | CLI |
|---|---|---|---|
| `github:owner/repo@<40-hex commit>/path` | commit + manifest hash | `https://raw.githubusercontent.com/owner/repo/<sha>/path/`, then `https://cdn.jsdelivr.net/gh/owner/repo@<sha>/path/` | same URLs (no git needed) |
| `git+https://host/repo.git@<40-hex commit>/path` (also `git+ssh`) | commit + manifest hash | only through a `mirrors` entry, else `E_PACK_SOURCE` | `git fetch` of that commit into the pack cache |
| `https://host/path/` (folder with `craftpack.json`, CORS open) | manifest hash only | fetch | fetch |
| `file:./path` | manifest hash only | folder picker (stays in the browser), dev only | folder |

In `packs.json` (the request file) a `github:`/`git+` source may name a branch or tag instead of a commit (`@packs`, `@v1.2.0`; a `/` in a
ref is written `%2F`); only `strudel packs lock` turns it into a commit. A lock that the site ships MUST contain commit-pinned or bundled
entries only (`E_LOCK_MUTABLE` in CI for `https:` without a bundle, and for `file:`).

### 9.2 Lockfile (`packs.lock.json`, schema `lock.schema.json`)

```json
{ "lock": 1, "craftpack": "1.0.0", "packs": [
  { "id": "glyphcore/core", "version": "1.0.0",
    "source": "github:Glyphcore/Strudel-craft@<commit>/packs/glyphcore/core",
    "requested": "github:Glyphcore/Strudel-craft@packs/packs/glyphcore/core",
    "manifest": "sha256:<64 hex>", "mirrors": ["./packs/glyphcore/core/<first 12 hex of manifest>/"],
    "priority": 0, "allowCode": ["word"], "bundle": true, "dependencies": {} } ] }
```

Array order is load order and tie-break order. Three lock layers exist at run time, each the same schema:

| layer | where | who writes it |
|---|---|---|
| shipped | `site/packs.lock.json` (site), `--packs LOCK` (CLI) | maintainers, by a reviewed commit |
| user | browser `localStorage` `sc.packs.lock` (so it is in history); CLI: a project's own `packs.lock.json` | the user, through the pack sheet or `packs add` |
| session | memory | `packs.add()` with a local folder; ad hoc `--pack DIR` |

### 9.3 Precedence, override, collisions

1. A qualified id always resolves to its own pack. Nothing overrides it.
2. A bare name resolves, within its kind, to the candidate with the highest `priority`; ties go to the earlier layer (shipped, user,
   session) and then the earlier lock entry. Core is first in the shipped lock with priority 0, so by default **nothing shadows core and
   the first pack to claim a name keeps it**. The loser stays reachable by its qualified id; the report lists it as `W_PACK_SHADOW`.
3. Deliberate override = the lock owner raises `priority` on that pack's lock entry (-100..99). A manifest cannot set its own priority.
   The site's "prefer this pack" switch writes priority 10 into the user lock.
4. Keyed data (`param-shapes.params[fn]`, `ranges[name]`, `canon[alias]`, intellisense items by `label` + `category`, `param-editors`
   keys) follows rule 2 per key and replaces the whole entry; no deep merge.
5. Sound keys follow rule 2 at registration time: a losing key is not registered under its bare name, only under its mini-safe alias.
   Vox banks are exempt as described in section 5.
6. Same pack id from two sources: `E_PACK_NAMESPACE`; the earlier layer wins and the other entry is refused. Same id twice with different
   versions in one layer: `E_LOCK_DUPLICATE`.
7. `packs.report()` / `strudel packs list --report` return the full resolution: per kind, each bare name, the winner, the shadowed ids.

### 9.4 Lazy loading

- Boot: read the lock layers, fetch and verify each manifest (small), build the ingredient index. The manifest alone is enough to list a
  pack's contents; no entry file is needed for that.
- `eager`: entry file fetched right after boot (idle time), for content the first screen or the first keystroke needs. Limits for packs
  outside the shipped lock: 256 kB per eager ingredient, 1 MB per pack; above that the ingredient is treated as `lazy` (`W_PACK_EAGER`).
- `lazy` (default): fetched on first use of its kind adapter: opening the view that shows it, the first completion query for its category,
  the first Play of a program that references it, or `packs.load(id)`.
- `manual`: only on an explicit call (`voxBank(id)`, `packs.load(id)`, the pack sheet). Default for anything with `assets`.
- Assets are never fetched by the loader. Sound files stream when a pattern first plays them (as superdough does today); "Make available
  offline" on the pack sheet fetches the whole asset index after showing `assets.bytes`.
- Ingredient states: `listed -> loading -> ready | failed | unavailable (offline, not cached) | blocked (needs a grant) | skipped (kind, engine)`.
  A failing ingredient never blocks the shell or another pack. The site MUST boot to a working editor and transport with an empty lock.

### 9.5 Caching and offline (service worker)

- Cache `sc-packs-1`, separate from the per-deploy shell cache, and **not** deleted on activate (today `sw.js` deletes every cache except
  `VERSION`; it must keep `sc-packs-*`). Keys are the fetch URLs; every pack URL contains a commit or manifest-hash segment, so entries are
  immutable and served cache-first with no revalidation.
- The lock itself is shell (network-first, cached copy offline).
- Install step precaches, for the shipped lock: every manifest and every `eager` entry file and granted module. Bundled packs are
  same-origin (`./packs/<id>/<hash12>/`), so a first visit needs no other host.
- Eviction: entries of packs that are in no lock layer are removed when a lock changes. Assets are LRU-capped (default 200 MB, measured
  with `navigator.storage.estimate()`); packs marked "available offline" are exempt and the site asks for `navigator.storage.persist()`.
- Offline: boot from cached lock and manifests; cached ingredients are `ready`, the rest `unavailable` and shown greyed with the reason.
  A program that needs an uncached sound gets the existing "sound not found" path plus a toast naming the pack. No retry storms: one
  attempt per ingredient per online transition.
- Mirrors are tried in order, then the source; every mirror is untrusted (the hash tree decides).

### 9.6 Registry index (`registry.schema.json`)

A registry is one static JSON file: `packs[{id, title, license, repository, redistribution, versions[{version, source (pinned), manifest,
craftpack, engines, dependencies, kinds, code, bytes, published, yanked}]}]`. It is **discovery, not trust**: it tells a host where a
version lives and what hash to expect; the user's lock is what pins it. The first-party registry is `registry/index.json` on the `packs`
branch, built by `strudel packs registry build` from the manifests it lists and checked in CI (namespace rule of section 3, licence
present, hashes match, `code` flag correct). More registries are added by URL in `packs.json` `registries` or the site's pack sheet.
A yanked version resolves only from an existing lock and shows its reason.

## 10. Security

### 10.1 Trust tiers

| tier | what it is | data ingredients | program text | sandboxed code | main-realm code |
|---|---|---|---|---|---|
| core | id under a first-party namespace (`glyphcore/*`, a host constant) **and** entry in the shipped lock | load | runs on a user gesture | n/a | runs if listed in `allowCode` |
| curated | any other pack in the shipped lock | load | gesture + origin badge | runs if listed in `allowCode` | refused (`E_PACK_CODE_REALM`) |
| user | added by the user from a registry, URL or link | load after the add dialog | gesture + origin badge + first-run confirm per pack | per-ingredient grant | refused |
| local | `file:` folder (the user's own disk) | load | gesture | grant | per-session grant |

A pack named by a URL parameter or a share link is a **proposal**: nothing is fetched beyond its manifest until the user accepts the add
dialog, and a link can never carry a grant. All dialogs use the site modal, never `confirm()`.

### 10.2 Data rules (every tier)

- Entry files are parsed with `JSON.parse` only, size-capped (5 MB per entry file, 64 MB per asset), schema-validated before use.
- Strings reach the DOM as text. HTML exists only in `docs` blocks and is sanitised (section 5).
- Paths are relative and confined to the pack root; no pack file can make the host fetch a third-party URL.
- Program text (`recipes`, `syntax`, `docs` code blocks, component `src`) is arbitrary JavaScript once evaluated. A host never evaluates
  it on load, on hover, for previews, or to build completions. The site evaluates it only after Load/Play on that item; packs outside the
  core tier show their id next to the item. The CLI evaluates a pack's program text only when the user names it
  (`strudel render pack:author/pack:recipe`), and for non-core packs only with `--packs-allow-code author/pack`.
- Data can still be hostile in content (a recipe at full gain). The master limiter and play-time clamp stay host-side and are not
  configurable from a pack.

### 10.3 Code ingredients

- **Flagged**: `code: true` plus every file in `modules` with its hash. A module or opaque def found in an ingredient without the flag is
  `E_PACK_CODE_UNDECLARED` and the ingredient is refused. Registries and the pack sheet show a "contains code" mark per ingredient.
- **Opt-in**: runs only if its ingredient id is in `allowCode` of the lock entry whose `manifest` hash matches. A new version has a new
  hash, so the grant does not carry over; the site asks again and shows which modules changed. Without a grant the ingredient is `blocked`
  and its data part (type declarations, fallbacks) still loads.
- **Never auto-run**: no grant is ever created by a registry listing, a dependency, a link, or a default. The shipped lock is the only
  grant not made in a dialog, and it is a reviewed commit.
- **Sandboxed** (`realm: "sandbox"`, the default): section 10.4. **Main realm** (`realm: "main"`: `prelude`, opaque hooks, `$code`):
  core and local tiers only. Rejected: a "run with full access" prompt for remote third-party packs; the page holds the user's history,
  library and same-origin storage, and no prompt makes that an informed choice. Revisit in a later spec minor if a real isolate exists
  for pattern functions.
- CLI: Node has no sandbox worth the name (`node:vm` is not a security boundary). Sandboxed kinds are site-only, so the CLI ignores them.
  Main-realm code runs in the CLI only with `--packs-allow-code <pack-id>[,...]`, the same shape as `--hooks-allow-code`, and never from
  a default.

### 10.4 Sandbox host (site)

One `<iframe sandbox="allow-scripts">` per granted pack (opaque origin, `srcdoc`), with a CSP of
`default-src 'none'; script-src blob: 'unsafe-inline'; img-src data: blob:; style-src 'unsafe-inline'`: no network, no storage, no access
to the page. Modules arrive as verified bytes over `postMessage`. The frame speaks a small RPC, one capability set per kind:

| kind | frame receives | frame may return |
|---|---|---|
| `intellisense-provider` | `{before, after, line, pos}` of the current editor (no other state) | items / inline strings, within `timeoutMs` (default 150 ms, then dropped) |
| `control-types` renderer, `param-editors` editor | the control spec and value, size, theme tokens | draws in its own frame, placed by the host; `set(value)` clamped to the spec's range |
| `visuals` painter | the event list of the visible window, time, size | draws in its own frame |
| `palette-actions` `run` | nothing | a list of declarative ops, executed by the host with the same checks as `do` |

A frame that throws, times out three times in a row or exceeds 50 ms per frame of main-thread message handling is stopped; the ingredient
falls back to its data part. Until this host exists (#71) every non-core code ingredient is `blocked`: fail closed.

## 11. Host API (plumbing contract)

Site, `window.strudelCraft.packs`:

```js
packs.api                         // "1.0.0"
packs.ready                       // Promise: lock layers read, manifests verified, eager ingredients applied
packs.list()                      // [{id, version, tier, manifest, state, ingredients:[{id, kind, state, code, bytes}]}]
packs.resolve(kind, ref)          // -> {id: "a/p:x", pack, ingredient, value} | null   (bare or qualified ref)
packs.items(kind)                 // winners per bare name, plus shadowed
packs.load(ingredientId)          // Promise<state>; pulls `requires`
packs.add(source, opts) / packs.remove(id) / packs.prefer(id) / packs.grant(ingredientId) / packs.offline(id, on)
packs.report()                    // {errors[], warnings[], resolution{}}; same JSON as `strudel packs list --report`
packs.on(type, fn)                // "state", "report", "lock"
packs.registerKind({ kind, formats: ["recipes@1"], hosts, apply(ingredient, data, ctx) -> dispose })
```

An adapter is the only code that knows both a kind and a registry (`intellisense.register`, `controls.registerType`, `palette.register`,
`literals.registerEditor`, `workspace`, `samples`, `hooks.load`, the library store). `apply` receives verified, schema-valid data and a
`ctx` with `id()` (qualifies an item id), `asset(path)` (URL inside the pack), `module(path)` (sandbox handle or, in the core tier, the
module) and returns a dispose function so a pack can be removed without a reload. The CLI has the same `registerKind` in
`lib/packs.mjs`; the resolution code (ids, precedence, report) is one shared ES module with no DOM or Node imports, imported by both
hosts the way `site/engine/hooks.js` is today.

## 12. CLI surface (`engine/strudel-cli`)

```
strudel packs validate DIR|craftpack.json [--strict]      schema + paths + hashes + code flags; exit 1 on any E_
strudel packs hash DIR [--write] [--check]                 compute entry/module hashes and asset indexes; --write updates the manifest
strudel packs lock [packs.json] [-o packs.lock.json] [--update ID] [--frozen]
strudel packs install [--lock L] [--into DIR] [--assets]   fetch + verify into the cache (default ~/.cache/strudel-craft/packs/<hash>/)
strudel packs verify [--lock L] [--offline]                re-hash everything installed
strudel packs list [--lock L] [--kind K] [--report] [--json]
strudel packs registry build DIR -o index.json | registry check index.json
strudel packs --api                                        host pack API version

on events | render | stems | check | info | hooks | perf | controls | complete:
  --packs LOCK            default: packs.lock.json beside the input, else $STRUDEL_CRAFT/site/packs.lock.json
  --pack DIR|SOURCE       add one pack for this run (session layer, repeatable)
  --no-packs              plumbing only
  --packs-offline         never touch the network; missing = E_PACK_UNAVAILABLE
  --packs-allow-code ID[,ID]
```

`render.json` gains `packs: [{id, version, manifest}]` and `attribution[]`. `strudel check` reports pack errors and warnings with the
codes of section 13 and `--strict` promotes warnings. Sound maps and vox banks are registered through the same file-URL path as
`--samples`; `voxBank()` in the CLI resolves ids through the lock instead of `site/data/vox/`.

## 13. Errors and warnings

Policy as in HOOKS_SYNTAX section 6: live hosts never throw from loading; the item is skipped and reported once. Headless: `strudel check`
and `packs validate` list everything, errors exit 1.

| code | when |
|---|---|
| `E_PACK_SPEC` | `craftpack` major not supported |
| `E_PACK_SCHEMA` | manifest or entry file fails its schema (path and message attached) |
| `E_PACK_HASH` | bytes do not match the hash tree |
| `E_PACK_PATH` | a path leaves the pack root, is absolute or has a scheme |
| `E_PACK_NAMESPACE` | one pack id from two sources, or a registry entry outside its owner's namespace |
| `E_PACK_ID` | duplicate ingredient id, or duplicate item id within one kind of one pack |
| `E_PACK_ENGINE` | `engines` / `compat` range not met |
| `E_PACK_DEP_UNDECLARED` / `_MISSING` / `_CONFLICT` / `_CYCLE` | section 6 |
| `E_PACK_SOURCE` | source form this host cannot fetch and no mirror given |
| `E_PACK_UNAVAILABLE` | offline and not cached |
| `E_PACK_SIZE` | entry file or asset above the caps |
| `E_PACK_CODE_UNDECLARED` | executable content without `code: true` / missing from `modules` |
| `E_PACK_CODE_GRANT` | code ingredient not in `allowCode` for this manifest hash (state `blocked`) |
| `E_PACK_CODE_REALM` | main-realm code from a tier that may not run it |
| `E_LOCK_MUTABLE` / `E_LOCK_DUPLICATE` | shipped lock with an unpinned entry; one id twice in a layer |
| `E_NAME_COLLISION`, `E_COMPONENT_HASH`, `E_OPAQUE`, `E_UNKNOWN_METHOD` | existing codes, unchanged |
| `W_PACK_SHADOW` | a bare name has more than one claimant (winner and losers listed) |
| `W_PACK_KIND` | unknown kind or format major: ingredient skipped |
| `W_PACK_NEWER` | spec or format minor newer than the host |
| `W_PACK_EAGER` | eager budget exceeded: treated as lazy |
| `W_PACK_LICENSE` | `LicenseRef-*` without `licenseFile`, or CC BY content without `attribution.text` |
| `W_PACK_YANKED` | locked version is yanked in a registry |

## 14. Migration plan

Target layout of the orphan branch `packs` of this repository:

```
packs/glyphcore/core/craftpack.json
packs/glyphcore/core/{recipes,intellisense,params,controls,syntax,docs,visuals,layouts,palette,prelude}/...
packs/glyphcore/vox-demo/            bank.json, strudel.json, pitched/, words.json, ogg/, files.sha256
packs/glyphcore/vox-call-me-baby/    (redistribution: false)
packs/glyphcore/vox-ljspeech/
packs/glyphcore/vox-vocalset/
registry/index.json
template/                            starter pack layout for contributors (section 14.4)
.gitattributes                       * -text
```

### 14.1 What moves where

| today | becomes | notes |
|---|---|---|
| `site/data/catalog.json` | `glyphcore/core:catalog` (`recipes@1`, eager) | bytes unchanged; `build_catalog.py` writes into a checkout of `packs` |
| `site/data/intellisense/strudel.json` `items` | `core:strudel-docs` (`intellisense@1`, eager) | provider id stays `strudel-docs` |
| same file `params`, `shapes` + `site/data/mod_ranges.json` | `core:params` (`param-shapes@1`, eager) | CLI `lib/mod.mjs` reads it; built-in table stays only as the `--no-packs` fallback |
| same file `editors` | `core:editors` (`param-editors@1`) | data only |
| `site/data/intellisense/words.json` | part of the vox pack it describes | word completions come from the active bank |
| `site/data/controls/types.json` | `core:controls` (`control-types@1`, eager) | renderers stay plumbing (`perform.js`) in 1.0; they are the fallback set |
| `site/data/syntax.json` | `core:syntax` (`syntax@1`) | |
| `site/data/plugins.json`, `practices.json` | `core:plugins`, `core:practices` (`docs@1`) | |
| visual names in `visuals.js` | `core:visuals` (`visuals@1`, all `builtin`) | drawing code is Strudel's, untouched |
| `DEFAULTS` in `workspace.js` | `core:layouts` (`layouts@1`) | |
| built-in palette entries | `core:actions` (`palette-actions@1`, `do` ops) | |
| `site/prelude/word.js` | `core:word` (`prelude@1`, realm `main`, granted in the shipped lock); the bank table inside it is removed | banks come from `vox-bank` ingredients |
| `site/data/vox/{demo,call-me-baby,ljspeech,vocalset}` | packs `glyphcore/vox-*` | prepared, **not published**: section 14.3 |
| `site/data/schema/model.v1.json` | stays (plumbing) | |

After the migration `site/data/` holds `schema/` only, and `site/` gains `packs.json`, `packs.lock.json`, `packs.js` (loader),
`packs-kinds.js` (adapters) and a `packs` section in `sw.js`.

### 14.2 Deploy

`pages.yml` gains one step before upload: for every `bundle: true` entry of `site/packs.lock.json`, fetch the pinned commit of the pack
folder, run `strudel packs verify`, and copy it to `site/packs/<id>/<first 12 hex of manifest>/` (the `mirrors` path). A hash mismatch
fails the deploy. `site/packs/` is gitignored; for local work `strudel packs install --lock site/packs.lock.json --into site/packs` fills
it, and without it the loader falls through to the source URL. The workflow's `paths` filter already covers `site/**`, so a lock bump
deploys. The schemas are published under `<site>/schemas/craftpack/1/` so the `$id` URLs resolve.

### 14.3 Order and gates

1. P1 lands the schemas, validator and hashing; nothing on the site changes.
2. P2 (site loader) and P3 (CLI loader) are built in parallel on disjoint files, against fixtures in `tests/packs/`, with the site still
   reading `site/data/` through a **shim pack**: the loader is given an in-repo `file:`-style pack whose entry files are the current
   `site/data/*` paths. This proves the adapters with zero content change.
3. P4 creates the `packs` branch with `glyphcore/core`, switches the lock to it, deletes the shim and `site/data/*` content.
   Parity gates: same recipe ids and count (46), same intellisense labels, same control types (16), same `strudel events` output for
   every catalog recipe before and after.
4. Vox packs are built on a local `packs` checkout in P4 and validated, but **pushing any `glyphcore/vox-*` pack, and listing it in the
   registry or the shipped lock, waits for the owner's explicit approval** recorded on the issue. The local commit `a87e13a` (demo and
   call-me-baby banks under `site/data/vox/`) should then never be pushed to `main`; its `word.js` changes move over without the data.
5. A licence for first-party content has to be chosen before P4 publishes (#66); until then the core manifest says
   `LicenseRef-undecided`, which the registry refuses by design.

### 14.4 Contributor layout (template)

```
my-pack/
  craftpack.json            id: <github-owner>/<pack>
  LICENSE
  README.md                 what is inside, credits
  sounds/strudel.json       a sounds@1 map; also loadable with samples() on strudel.cc
  sounds/files.sha256
  sounds/*.ogg
  recipes/recipes.json
  .gitattributes            * -text
  .github/workflows/pack.yml   runs `strudel packs validate . --strict` and `packs hash . --check` on every push
```

Publish = push, then give people `github:<owner>/<repo>@<commit>/<path>` (works at once, no registry needed), and optionally open a pull
request that adds the version to `registry/index.json`.

## 15. Test method

- **Schemas**: every file in `schemas/craftpack/1/` is a valid draft 2020-12 schema; the examples validate; a fixed list of mutated
  manifests is rejected (wrong id case, bad hash, data kind with `code`, prelude without `code`, modules without `code`, absolute path,
  missing licence, unpinned lock source, absolute URL in a sound map). The current `site/data` files validate against their kind schemas
  unchanged (checked while writing this spec: catalog, intellisense items, typed params + mod ranges, editors, control types, syntax,
  plugins, practices, and the three local vox banks' maps and words files).
- **Conformance vectors**: `tests/packs/vectors.json` = fixture packs + lock -> expected `report` JSON (resolution winners, shadowed ids,
  codes). The site loader (Playwright) and the CLI must both produce the identical report. This is the parity test.
- **Integrity**: flip one byte in an entry file, a module and an asset of a fixture: each gives `E_PACK_HASH`, nothing from it is
  registered, nothing is cached.
- **Determinism**: `strudel events` of a program is byte-identical with and without an extra pack that claims the same bare names at
  priority 0, and changes when that pack is given priority 10.
- **Offline**: Playwright, one online load, `context.setOffline(true)`, reload: recipe count and first completion list unchanged; an
  uncached manual bank reports `unavailable`.
- **Empty lock**: the site boots, the editor evaluates a typed program and plays it, the browser shows the empty state.
- **Security**: a fixture with an undeclared module, one with an ungranted provider, one with main-realm code in the user tier, a share
  link carrying a pack: the expected state and code each, and a canary global the module sets is absent from the page.

## 16. Issues

| phase | issue | deliverable | depends on |
|---|---|---|---|
| P1 | #65 | spec, schemas, `strudel packs validate`, `hash`, `lock`, `registry`, fixtures and vectors | - |
| P2 | #67 | site loader, kind adapters, service worker cache, pack sheet (UI by `ui-designer`) | P1 |
| P3 | #68 | CLI loader (`--packs`, `--pack`, install/verify/list, `render.json` credits), shared resolution module | P1 |
| P4 | #69 | migration: `packs` branch, `glyphcore/core`, shipped lock, deploy bundling, `site/data` emptied; vox packs prepared | P2, P3, #66; vox publish needs owner approval |
| P5 | #70 | contributor guide, `template/`, pack CI workflow, registry CI | P1 (examples from P4) |
| P6 | #71 | sandbox host for third-party code ingredients | P2 |
| - | #66 | licence decision for first-party pack content | - |

## 17. Open questions

1. **Renderers as content.** The nine drawn control renderers stay plumbing in 1.0 (they are the fallback set every pack leans on).
   Moving them into `core` as modules is possible once the adapter has shipped; is there any gain beyond symmetry?
2. **Sound maps with remote files.** 1.0 forbids absolute URLs in pack sound maps. A later minor could add an `external` asset list with
   per-file hashes for large public sample sets; it would cost the "no third-party fetch" guarantee.
3. **Signatures.** The hash tree proves the bytes match the lock; it does not prove who published them. Registry-side signing
   (sigstore or minisign) is left for a later minor.
4. **Main-realm third-party code** (preludes, function hooks): refused in 1.0. Needs a real isolate that can transform Patterns.
5. **Inline providers that learn from user text** (`ngram`) see editor content; inside the sandbox they have no network, but should
   they be offered the user's history at all? 1.0: current line and document only.
