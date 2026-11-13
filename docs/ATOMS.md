# Atoms: typed, parameterised definitions in place of magic strings

Status: **A1 built** (core: `site/engine/atoms.js`, `site/data/atoms/types.json`, the `atoms` schema, `tests/atoms/a1.mjs`; #61) and **A2 built** (`site/engine/atoms-migrate.js`: `extract`, `parse`, `inline`; catalog atoms `atoms.snd|bank|scale|chord`; strudel.cc / Copy inline; `tests/atoms/a2.mjs`; #62).
A3-A4 and the `strudel atoms` CLI subcommands of section 12 (CLI in another repo) are still design only; phases and issues in section 14. Extends `docs/HOOKS_SYNTAX.md`, `docs/BLUEPRINT.md` and the AST-bound control
work (control binding: structural ids, literal sites, typed param shapes). Owner: `daw-sme`. UI parts are direction for `ui-designer`.

## 1. The problem and the idea

A Strudel program is held together by strings that mean something only by convention: `"bd*4 [~ sd]"`, `"@17b"`, `"kick:env"`,
`"RolandTR909"`, `"Cm7"`, `"C:minor"`, `"bass/fx"`. They are retyped at every use, never checked, cannot take parameters, and a typo
is a silent bug.

An **atom** is one such string, defined once:

- **typed**: `mini`, `gate`, `tapref`, `sound`, `chord`, `scale`, ... (registry, section 3);
- **static and immutable**: declared once in the environment, frozen for the evaluation; a change is a new revision;
- **parameterised**: zero or more typed params; applying some of them gives a derived atom;
- **referenced, not retyped**: `atoms.kick4`, `atoms.kick4({ n: 8 })` in code, `{"$atom": id}` in the model;
- **compiled away**: before evaluation every reference is replaced by the plain Strudel string. Strudel never sees an atom;
- **id-addressed**: a stable id that survives renames, as control sites keep theirs;
- **packable**: an ingredient with id, revision, hash and dependencies.

```js
atom("kick4",  { type: "mini",  params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*${n}" })
atom("atDrop", { type: "gate",  body: "@17b" })
atom("kickEnv",{ type: "tapref", body: "kick:env" })

$: s(atoms.kick4).tap(atoms.kick)                      // compiles to  s("bd*4").tap('kick')
$: s(atoms.kick4({ n: 8 })).gain(tap(atoms.kickEnv))   // compiles to  s("bd*8").gain(tap('kick:env'))
hooks.bind(atoms.fx, atoms.murk, atoms.atDrop)         // compiles to  hooks.bind('fx', 'murk', '@17b')
```

## 2. Design decisions (with rejected alternatives)

1. **Compile-time substitution, not runtime objects.** A text pass (acorn, the parser already vendored for control sites) replaces each
   static reference with its compiled literal before Strudel's transpiler runs. Rejected: runtime proxy objects (they are not strings,
   so `typeof x === "string"` checks in Strudel and in the hooks runtime fail, and Strudel's mini-notation highlighting has no source
   location); rejected: tagged template helpers only (still strings at the use site, nothing to reference or count).
2. **The compiled literal keeps Strudel's quote rule.** Pattern-typed atoms compile to a double-quoted string (the transpiler makes it
   mini-notation and tracks its location); string-typed atoms (gates, tap refs, slot and hook names) compile to a single-quoted string
   (never mini-notation). This removes the need to `protect()` hooks calls that use atoms.
3. **Reference by name in code, by id in the model.** Code stays readable (`atoms.kick4`); the model, graph, pads, boards and packs
   hold the id, so a rename touches one declaration and nothing else. Rejected: ids in code (unreadable); names in the model (renames
   break mappings, the problem the control-site ids already solved).
4. **Param holes are `${name}`.** Mini-notation uses `{}` for polymeter and `<>`, `[]`, `()`, `@`, `*`, `/`, `!`, `?`, `:`, `~`, `,`, `|`, `.`, `_`
   as syntax; `$` is free. Rejected: `{name}` (ambiguous with polymeter).
5. **Composition is a small typed algebra that prints a string**, not string concatenation by the user. `seq`, `stack`, `alt`, `rep`
   over `mini` atoms always print bracketed, valid mini-notation; gates compose by `union` / `shift`. Rejected: free templates only
   (operator precedence bugs: `a b*2` is not `[a b]*2`).
6. **Atoms do not replace the hooks registry.** A slot, hook, tap or marker still lives in the registry; the atom is the typed name
   used to address it. One exception: an atom of type `point` *is* a marker (same thing, one declaration).
7. **Catalog atoms are synthesised on reference.** Sound names, scale names and chord symbols come from data catalogs (thousands of
   entries). They are not declared one by one and never listed in full; `atoms.snd.bd` exists when referenced and is checked against the
   catalog. This is the same lazy rule as the graph cards (section 9).
8. **Nothing is inferred into the music.** Extraction only names strings that are already in the program. It never adds a sound, a
   chord or a note.

## 3. Atom types (registry)

Data, like control types: `site/data/atoms/types.json`, loaded into `strudelCraft.atoms.registerType(...)`; more can register at runtime.

| type | compiles to | quote | param shape it satisfies | validator | example body |
|---|---|---|---|---|---|
| `mini` | pattern string | `"` | `mini`, `pattern` | Strudel `mini()` parse | `bd*${n} [~ sd]` |
| `sound` | sound name, optional `:index` | `"` | `sound` | catalog / `soundMap` (warn when unknown) | `bd:3` |
| `bank` | bank name | `"` | `enum` of banks | catalog | `RolandTR909` |
| `note` | note name or number | `"` | `note` | note grammar | `c2` |
| `chord` | chord symbol | `"` | `note` (chord contexts) | chord grammar (root + quality from the voicing dictionary) | `${root}m7` |
| `scale` | `root:mode` | `"` | `scale` | root + mode in the scale catalog | `${root}:minor` |
| `voicing` | object `{ dict, anchor, mode, offset }` | - | `voicing` | keys and enums | `{ "dict": "lefthand", "anchor": "c5" }` |
| `progression` | pattern string of chords | `"` | `mini` | each token a chord | `<Cm7 Fm7 G7 Cm7>` |
| `gate` | gate string or object (HOOKS_SYNTAX 3, 4.3) | `'` | `gate` | gate grammar | `@17b` |
| `point` | gate point; also registers a marker | `'` | `point` | point grammar | `17b` |
| `tapref` | `[scope/]name[:facet]` | `'` | `tapref` | ref grammar; facet in the facet list | `kick:env` |
| `slot` | `[scope/]name` | `'` | `slot` | ref grammar | `bass/fx` |
| `hook` | hook expression (BLUEPRINT 3) | `'` | `hook` | hook-expr grammar | `every(${n})[murk]` |
| `name` | a bare name: tap name, var, scope, control label, pad address | `'` | `name` | name grammar | `kick` |
| `text` | any other string (escape hatch) | as declared | - | none | |

Type record: `{ id, compiles: "string" | "pattern" | "object", quote, shape, validator, editor, ops: [...] }`. `shape` is the param-shape
name of the typed-param table (`site/data/intellisense/strudel.json` `params`), which is how intellisense and the literal editors know
where an atom fits. `editor` names the literal editor used for the body (`steps` for `mini`, `piano` for `note`, `chips` for chords).

## 4. Schema

Model key `atoms` (added to `strudelcraft.model/1`), keyed by id:

```json
{
  "atoms": {
    "a3f9a0c": { "name": "kick4", "type": "mini", "rev": 2, "hash": "sha256:…", "doc": "four on the floor", "tags": ["drums"],
                 "params": { "n": { "shape": "number", "min": 1, "max": 16, "step": 1, "default": 4 } },
                 "body": "bd*${n}" },
    "a81k2pd": { "name": "kick8", "type": "mini", "rev": 1, "hash": "sha256:…", "from": { "atom": "a3f9a0c", "args": { "n": 8 } } },
    "a0c77xe": { "name": "beat",  "type": "mini", "rev": 1, "hash": "sha256:…",
                 "params": { "fill": { "shape": "atom:mini", "default": { "$atom": "a5d1e02" } } },
                 "body": { "$stack": [ { "$atom": "a3f9a0c" }, { "$seq": [ "~ sd", { "$param": "fill" } ] } ] } },
    "a7m2q19": { "name": "atDrop", "type": "gate", "rev": 1, "hash": "sha256:…", "body": "@17b" }
  }
}
```

```json
{ "$defs": {
  "atom": { "type": "object", "required": ["name", "type"], "additionalProperties": false, "properties": {
    "name":   { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$" },
    "type":   { "type": "string", "description": "id in the atom type registry" },
    "params": { "type": "object", "additionalProperties": { "$ref": "#/$defs/atomParam" } },
    "body":   { "description": "string with ${param} holes, or object, or composition node ($seq $stack $alt $rep $slow $euclid $union $shift $atom $param)" },
    "from":   { "type": "object", "required": ["atom"], "properties": { "atom": { "type": "string" }, "args": { "type": "object" } } },
    "rev":    { "type": "integer", "minimum": 1 }, "hash": { "type": "string" }, "parent": { "type": "string" },
    "doc":    { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } } },
    "oneOf": [ { "required": ["body"] }, { "required": ["from"] } ] },
  "atomParam": { "type": "object", "required": ["shape"], "properties": {
    "shape": { "type": "string", "description": "number | enum | bool | note | sound | mini | name | atom:<type>" },
    "min": { "type": "number" }, "max": { "type": "number" }, "step": { "type": "number" }, "unit": { "type": "string" },
    "curve": { "enum": ["lin", "exp", "log", "db", "bipolar"] }, "options": { "type": "array" }, "default": {} } },
  "atomRef": { "type": "object", "required": ["$atom"], "additionalProperties": false, "properties": {
    "$atom": { "type": "string", "description": "atom id, or catalog ref such as snd:bd" }, "args": { "type": "object" },
    "ops": { "type": "array", "description": "composition ops applied at the use site, in order: [[\"after\"], [\"shift\", \"2b\"]]", "items": { "type": "array" } } } }
} }
```

- `atomParam` is the same shape schema the typed-param table and the literal editors use, plus `atom:<type>` (a param that takes
  another atom). One schema for function params, hook params, control specs and atom params.
- `atomRef` joins the model `arg` forms (`$mini`, `$tap`, `$param`, ...). It is accepted wherever the model holds a magic string today:
  step args, `bindings[].slot / hook / gate / else`, `wires[].tap`, `markers`, `vars`, `maps[].dest`, pad `target.ref`, `scopes`.
- A model with `$atom` refs and no matching `atoms` entry (and no import providing it) fails validation: `E_ATOM_UNKNOWN`.

## 5. Declaring and referencing (code)

```ebnf
atom-decl  = "atom" "(" name "," atom-spec ")" ;                      (* header statement; name is a single-quoted or double-quoted literal *)
atom-spec  = "{" "type" ":" type-id [ "," "params" ":" params ] "," ( "body" ":" body | "from" ":" atom-ref ) [ "," "doc" ":" string ] "}" ;
atom-ref   = "atoms" "." path [ "(" args ")" ] { "." op "(" op-args ")" } ;
path       = ident { "." ident } ;                                    (* namespaces: atoms.dk.kick4, atoms.snd.bd *)
args       = "{" [ ident ":" static-value { "," ident ":" static-value } ] "}" ;
static-value = number | string | boolean | atom-ref ;
import     = "atoms" "." "import" "(" source [ "," "{" "as" ":" name "}" ] ")" ;   (* source: "pack:drums@3", "lib:name@rev", "./atoms.json" *)
```

- **Environment** = everything visible under `atoms`: declarations in the program header, the model's `atoms`, imports (each under
  its `as` namespace), and the catalog namespaces `atoms.snd`, `atoms.bank`, `atoms.scale`, `atoms.chord` (section 2, decision 7).
  It is built once per evaluation and frozen. A second declaration of a name: `E_ATOM_REDEFINED`.
- **Static reference**: a member expression rooted at the identifier `atoms` with literal path and static args. Anything else
  (`atoms[x]`, args from variables) is a dynamic reference: `W_ATOM_DYNAMIC`; it still works through the runtime fallback (below) but
  is not counted, not typed and not shown in the graph.
- **Runtime fallback**: a frozen global `atoms` whose members are the compiled strings (param-less atoms) or functions returning them
  (parameterised atoms). Strudel reifies plain strings through its mini parser, so pattern contexts still work. It exists so partially
  migrated or hand-written dynamic code runs; the compile pass is the supported route.

### The compile pass
`compile(code, env) -> { code, map, refs }`, pure text to text, same module on the site and in the CLI; it runs before control-site
rewriting and before Strudel's transpiler.

1. Parse; collect `atom(...)` declarations and `atoms.import(...)`; build and freeze the environment; validate each atom (section 8).
2. For every static reference: resolve, apply args, evaluate composition, validate the result with the type's validator, check the
   type against the param shape of the argument position it sits in (`E_ATOM_TYPE`), then replace the reference span with the literal
   in the type's quote style. Object-typed atoms (`voicing`) print a JS object literal.
3. Remove the `atom(...)` and `atoms.import(...)` statements from the output (they are environment, not program).
4. `map` = list of `{ from, to, outFrom, outTo, atom }` so positions in compiled code map back to source: a mini-notation highlight
   inside a compiled literal lights the whole reference in the editor; an error inside it is reported at the reference.
5. `refs` = every reference site `{ id, atom, args, path, from, to }`. Site ids use the control-binding structural path
   (`r` + 6 base-36 chars of FNV-1a(path)); they are what the graph counts (section 9).

`compile` is idempotent on code with no atoms (returns it unchanged), so every existing program is already valid.

## 6. Params, partial application, composition

- An anonymous derived atom at a use site is stored in the model as an `atomRef` with `args` and / or `ops`.
- **Apply**: `atoms.kick4({ n: 8 })` compiles `bd*8`. Missing params take defaults; a missing param with no default: `E_ATOM_ARITY`;
  a value outside the shape: `E_ATOM_ARG`.
- **Partial application gives a derived atom**: applying a subset of params yields an atom whose params are the rest.
  Anonymous at a use site (not stored; identified by `{ atom, args }`), or named:
  `atom("kick8", { type: "mini", from: atoms.kick4({ n: 8 }) })` stores `from: { atom, args }`. A derived atom has no body of its own;
  it follows new revisions of its parent only when the parent pin is updated (section 7).
- **Atom-valued params** (`shape: "atom:mini"`): higher-order atoms. `atoms.beat({ fill: atoms.roll })`.
- **Composition ops** print a string of the atom's type. In code they are methods on a reference; in the model they are `$` nodes.

| type | op (code / model) | prints | 
|---|---|---|
| `mini`, `progression` | `.seq(b, ...)` / `$seq` | `[a] [b]` |
| | `.stack(b, ...)` / `$stack` | `[a, b]` |
| | `.alt(b, ...)` / `$alt` | `<[a] [b]>` |
| | `.rep(n)` / `$rep`, `.slow(n)` / `$slow` | `[a]*n`, `[a]/n` |
| | `.euclid(k, n, r = 0)` / `$euclid` (single-step atoms only) | `a(k,n,r)` |
| `sound` | `.n(i)` | `name:i` |
| `chord`, `scale`, `note` | `.root(r)` (sets the `root` param), `.transpose(semitones)` (`note`, `chord` roots) | re-spelled symbol |
| `gate` | `.union(g, ...)` / `$union` | `a, b` |
| | `.shift(offset)` / `$shift` | every point with the offset added |
| | `.until(point)`, `.from(point)` | window clipped |
| `point` | `.after()`, `.before()`, `.to(point)` (give a `gate`), `.shift(offset)` | `@p`, `<p`, `p..q` |
| `tapref` | `.facet(f)`, `.in(scope)` | `scope/name:f` |
| `name` | `.facet(f)` (gives a `tapref`) | `name:f` |
| `slot`, `name` | `.in(scope)` | `scope/name` |
| `hook` | `.pipe(h, ...)`, `.wrap(decorator)` | `a | b`, `d[a]` |

  Brackets are omitted only for single tokens. The result of an op is again a derived atom (anonymous unless named), so ops chain and
  the whole expression is still one static reference.
- No op mixes types except through a declared param (`atom:<type>`): `E_ATOM_TYPE`. Composition loops: `E_ATOM_CYCLE`.

## 7. Identity and versioning

- **Id**: `a` + 6 base-36 chars of FNV-1a(`type` + "/" + `name`) at first sight, suffix on clash; then **kept**. Catalog atoms have the
  fixed form `snd:bd`, `scale:minor`, `chord:m7`, `bank:RolandTR909` and are never stored.
- **Reconciliation** of declarations on each successful compile (same idea as control sites): 1. same name and type -> same id;
  2. a name that disappeared and a new name with the same type and the same content hash -> rename, id kept; 3. else new id.
  Removed declarations stay in the model as long as something references their id (shown as "not in code"), so undo restores them.
- **Hash**: SHA-256 of the canonical JSON of `{ type, params, body | from }`. Name, doc and tags are not hashed: a rename is not a new version.
- **Revision**: a changed hash under the same id is `rev + 1`, `parent` = previous hash. Inside a working document references always
  mean the head revision (edit once, every use follows: the point of having one definition). Across documents (library, packs,
  imports) references are pinned `id@rev` with the hash checked: `E_ATOM_HASH` on mismatch.
- **Reference sites** have their own ids (`r…`, section 5) and are recomputed per parse like literal sites.
- History: each revision is written to the history store with the others (`kind: "atom"`), so an atom has a timeline and a diff.

## 8. Errors and warnings

| code | when |
|---|---|
| `E_ATOM_UNKNOWN` | reference or `$atom` to a name/id not in the environment |
| `E_ATOM_REDEFINED` | two declarations of one name in one environment |
| `E_ATOM_TYPE` | atom type does not fit the param shape at the use site, or an op is applied to the wrong type |
| `E_ATOM_ARG` / `E_ATOM_ARITY` | arg outside its shape or unknown / required param missing |
| `E_ATOM_GRAMMAR` | the compiled string fails the type validator (for `mini`: Strudel's own parser) |
| `E_ATOM_CYCLE` | atoms reference each other in a loop |
| `E_ATOM_HASH` | pinned revision content does not match its hash |
| `E_ATOM_TYPE_ID` | unknown atom type (strict); live it is treated as `text` |
| `W_ATOM_DYNAMIC` | non-static reference; runs through the runtime fallback, not tracked |
| `W_ATOM_UNKNOWN_SOUND` | a `sound` / `bank` atom not in the catalog or `soundMap` (it may load later) |
| `W_ATOM_UNUSED` / `W_ATOM_DUP` | declared and never referenced / two atoms of one type compile to the same string |

Policy as elsewhere: while the program is invalid the site stays inert on the last good compile; `strudel check --strict` exits 1.

## 9. Graph rule: cards on reference

- Graph nodes hold `$atom` refs in their ports. They never hold the string.
- An **atom card** is a node of kind `atom` that exists **only while at least one reference in the visible graph level points at it**.
  `graph(model)` builds cards from the reference list, not from `model.atoms`: cost is proportional to references, independent of
  how many atoms the environment or the imported packs contain.
- One card per atom per graph level, shared by all its references; the card shows the reference count, the type, the compiled
  preview and the param editors. A derived anonymous atom gets its own card keyed by `{ atom, args }`, drawn linked to its parent's
  card (the parent card materialises too, because the derived one references it).
- **Reference counting**: `count(atom, level)` = number of reference sites at that level. 0 -> 1 creates the card (placed next to the
  first referencing node by the deterministic layout); 1 -> 0 removes it. Its `layout` entry is dropped at the next save, so undo
  inside a session brings the card back where it was.
- Inside a collapsed component the references are counted in that component's level; from outside only exported atom params show.
- The whole library is never drawn. Atoms are found through the **browser / palette**, which queries on demand (type filter from
  the port being wired, text filter, pages of 50). Dropping a result on a port creates a reference; the card then appears by the rule.
- Wire type for an atom reference: `param` (BLUEPRINT 4.2), badge = atom type.

## 10. Consumers

**Intellisense.** One provider, `atoms`, on the existing registry:
- in an argument position whose param shape is S: atoms whose type satisfies S come first (`label: atoms.kick4`, `detail`: compiled
  preview, `info`: params and doc); other types are not offered;
- after `atoms.`: namespaces and names, filtered by the expected shape; catalog namespaces answer by prefix query, never in full;
- inside `atoms.kick4(`: signature help from the atom's params (active param, range, unit), and per-param value suggestions by shape;
- inside a string literal that equals an existing atom's compiled output: a "use `atoms.name`" suggestion.

**Editors.** Atom params use the typed-param shape schema, so the existing literal editors work on reference args unchanged
(scrub `n`, chips for a chord quality, the step editor for a `mini` body). A reference in code is one token to the editor: tap opens a
popover with the compiled string, the param editors, and actions Edit definition, Derive (name the current args), Detach (inline the
string here), Go to card. Body edits go through the type's editor and validator and produce one new revision per settled edit.

**Hooks.** Every string position of the hooks API takes an atom of the matching type: slot refs, hook expressions, gates, points,
tap refs, scopes. `hooks.plan` and the journal carry atom ids next to the resolved strings. A `point` atom registers its marker.
Because string-typed atoms compile single-quoted, hooks calls written with atoms need no `protect()` step.

**Controls, pads, boards.** Pad targets, board cells and `maps` may address their target through `$atom` (a `slot`, `hook`, `name` or
`tapref` atom). An atom's numeric params can be mapped like any param: destination `atom:<id>.<param>`; a mapped param turns the
reference into a live value, so that atom's compiled output becomes a pattern of the control (only for `number` params of `mini`
atoms in step or repeat position; elsewhere `E_ATOM_ARG` at map time). This is the one place an atom is not purely static, and it is opt-in.

**Packs.** An atom is a pack ingredient: `{ kind: "atom", id, rev, hash, name, type, deps: [atom ids], requires: { sounds: [...] } }`;
a namespace of atoms is one ingredient `kind: "atomset"`. A pack pins `id@rev` + hash; importing gives `atoms.<as>.*`. Other ingredients
(components, boards, banks) list the atoms they reference in `deps`, so a pack is closed under references. The pack format is being
specified separately; this is the contract atoms need from it.

## 11. Migration from string code

`extract(code, opts) -> { code, atoms, report }` (tool and CLI), the inverse of `compile`.

1. Find string literals and mini-notation tokens with the existing literal-site scan; type each by the param shape of its argument
   position (`s(` -> `sound` or `mini`, `.scale(` -> `scale`, `.bank(` -> `bank`, hooks calls by argument position -> `slot`, `hook`,
   `gate`, `tapref`, `point`). Untyped strings are left alone unless `--text`.
2. Group by `(type, canonical text)`. Default threshold: a group becomes an atom when it has 2 or more uses, or its type is `gate`,
   `tapref`, `slot`, `point` (names are worth declaring even when used once). `--min-uses N` changes it.
3. Name deterministically: `gate "@17b"` -> `from17b`, `"<17b"` -> `before17b`, `tapref "kick:env"` -> `kickEnv`, `scale "C:minor"` ->
   `cMinor`, `mini` -> first two sound or note tokens plus step count (`bdSd8`), clash -> numeric suffix. Names are suggestions; a
   rename later costs one edit.
4. Optional `--params`: literals of one type that differ in exactly one numeric token are unified into one parameterised atom
   (`bd*4`, `bd*8` -> `bd*${n}`, uses become `atoms.x({ n: 4 })`, `atoms.x({ n: 8 })`). Off by default; listed in the report either way.
5. Sound, bank, scale and chord names that exist in the catalogs become catalog references (`atoms.snd.bd`) only with `--catalog`;
   by default plain single-token sound names stay strings (they are already checked by the `sound` shape).
6. Rewrite: declarations go in one block at the top of the header; uses become references. Guarantee, checked by the tool itself
   before writing: `compile(extract(code).code).code` evaluates to the same events as `code` over 8 cycles.

A2 as built: `@P` / `<P` gates become `atoms.p.after()` / `.before()` only when point `P` appears in two forms (else a `from17b` gate atom);
`name` atoms are declared when a `tapref` facet derives from them (`from: atoms.kick.facet("env")`); a string typed both as a pattern
(double-quoted) and as a plain string is left alone and listed in `report.refused`; names come from the text or, for points, from a
`hooks.marker(name, point)` in the program, or from `opts.names["type:text"]`. The self-check compares the normalised AST of the inlined
result with the original (and event lists when the host passes `opts.events`).

Also: `parse(type, string, env) -> { atom, args } | null` (find the atom and args whose output equals a string; used by the editor
suggestion and by `extract` on later runs so new strings join existing atoms), and `inline(code)` = `compile` with formatting kept,
used by "Open in strudel.cc" and "Copy", because `atoms` does not exist outside this toolkit.

## 12. CLI

```
strudel atoms list    IN [--type T] [--model M] [--atoms FILE]     # environment as JSON: id, name, type, params, rev, hash, refs
strudel atoms show    IN NAME [--arg k=v ...]                      # compiled string for one atom
strudel atoms refs    IN                                           # reference sites and counts (the cards a graph would hold)
strudel atoms compile IN [-o OUT]                                  # plain Strudel code, atoms inlined
strudel atoms extract IN [--write] [--min-uses N] [--params] [--catalog] [--text] [--report R.json]
strudel atoms check   IN [--strict]                                # section 8 codes
```

`events`, `render`, `stems`, `check`, `hooks`, `model` run the compile pass first, with `--atoms FILE` or `--model` supplying extra
environment. Output is deterministic: same input, same compiled text, same ids, same hashes.

## 13. Worked examples

**1. Before and after extraction**
```js
// before
$: s("bd*4").bank("RolandTR909").tap("kick")
$: note("c2*8").s("sawtooth").wire("gain", "kick:env", { range: [1, 0.3], op: "mul" })
hooks.bind("fx", "murk", "<17b"); hooks.bind("fx", "open", "@17b")
// after `strudel atoms extract --write`
atom("kick",     { type: "name",   body: "kick" })
atom("kickEnv",  { type: "tapref", from: atoms.kick.facet("env") })
atom("fx",       { type: "slot",   body: "fx" })
atom("drop",     { type: "point",  body: "17b" })
$: s("bd*4").bank("RolandTR909").tap(atoms.kick)
$: note("c2*8").s("sawtooth").wire("gain", atoms.kickEnv, { range: [1, 0.3], op: "mul" })
hooks.bind(atoms.fx, "murk", atoms.drop.before()); hooks.bind(atoms.fx, "open", atoms.drop.after())
```
(`point` ops `.before()` / `.after()` / `.to(point)` print the gate strings `<17b`, `@17b`, `17b..33b`.)

**2. Partial application and a named derivation**
```js
atom("hats", { type: "mini", params: { n: { shape: "number", min: 1, max: 32, step: 1, default: 8 }, snd: { shape: "sound", default: "hh" } }, body: "${snd}*${n}" })
atom("hats16", { type: "mini", from: atoms.hats({ n: 16 }) })     // params left: snd
$: s(atoms.hats16({ snd: "oh" }))                                  // "oh*16"
```

**3. Composition**
```js
$: s(atoms.kick4.stack(atoms.backbeat).seq(atoms.fill).slow(2))    // "[[[bd*4], [~ sd ~ sd]] [fill...]]/2"
```

**4. Harmony**
```js
atom("key",   { type: "scale", params: { root: { shape: "note", default: "c" } }, body: "${root}:minor" })
atom("turn",  { type: "progression", body: "<Cm7 Fm7 G7 Cm7>" })
$: n("0 2 4 6").scale(atoms.key({ root: "d" }))
$: chord(atoms.turn).voicing()
```

**5. Model fragment for example 1**
```json
{ "tracks": [ { "name": "bass", "source": ["note", { "$mini": "c2*8" }],
    "chain": [ ["s", "sawtooth"], ["wire", "gain", { "$atom": "a41c9z0" }, { "range": [1, 0.3], "op": "mul" }] ] } ],
  "bindings": [ { "slot": { "$atom": "a2b7k1m" }, "hook": "open", "gate": { "$atom": "a9d0p3s", "ops": [["after"]] } } ] }
```

## 14. Phases

| phase | issue | deliverable | depends on | owner |
|---|---|---|---|---|
| A1 | #61 | atoms core **built** (type registry, schema, `compile` with source map, runtime fallback, params / partial application / composition, ids, hashes); the `strudel atoms` CLI subcommands are **coming** (the CLI lives in another repo) | model schema (#49), control-binding parser | daw-implementer |
| A2 | #62 | migration **built** in the toolkit: `extract`, `parse`, `inline`, catalog atoms, strudel.cc export inlines (the `strudel atoms extract` CLI is **coming**) | A1 | daw-implementer |
| A3 | #63 | consumers: intellisense provider, atom args in literal editors, `$atom` in hooks / model / pads / maps, pack ingredient record | A1 (pack record waits for the pack spec) | daw-implementer |
| A4 | #64 | UI: lazy reference-counted atom cards in the graph, atom browser / palette, reference popover | A1, A3 | ui-designer |

## 15. Open questions

1. **Head vs pinned inside one document.** References follow the head revision. Should a single use be allowed to pin an older
   revision (`atoms.kick4.at(1)`), or is Detach enough?
2. **Mapped atom params** (section 10) make one atom partly live. Is that wanted, or should a live value always be a control and the
   atom stay fully static?
3. **Catalog scope.** Sounds from sample packs loaded at runtime are only known after loading. Check them at compile time against a
   cached catalog (may be stale) or only warn at play time?
4. **`mini` sub-token atoms.** Extraction works on whole strings. Should a repeated cell inside larger strings (`[~ sd]`) be
   extractable as an atom referenced by `${...}` from other atoms? It needs the mini parser's AST; feasible, not in A2.
5. **Pack spec.** The ingredient record in section 10 is this design's side of the contract; align field names when the pack spec lands.
6. **Highlight mapping.** Mapping Strudel's mini-notation highlight back to a whole reference loses per-step highlighting for atom
   bodies. Show per-step highlight on the card or in the popover instead?
7. **Editor identity for `atoms`.** `atoms` is a reserved identifier in programs. Programs that already define a variable named
   `atoms` get `E_ATOM_REDEFINED`; is an opt-out pragma needed?
