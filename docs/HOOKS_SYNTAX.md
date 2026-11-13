# Hooks, slots and taps: middleware syntax for Strudel-craft patterns

Status: **issued** (design note only, nothing built). DAG nodes `hooks-core` (#47) and `taps-vars-decorators` (#48). Owner: `daw-sme`.
Extended by `docs/BLUEPRINT.md` (variables, decorators, node graph, component library, shared JSON model, phases).
Gate strings, tap refs, slot and hook names can be declared once as typed atoms and referenced: `docs/ATOMS.md`.
Target runtime: unmodified Strudel (`@strudel/web` 1.3.0 on the site, `@strudel/core` 1.2.6 in the headless CLI). Everything here is an
add-on that calls Strudel's public Pattern API. No Strudel source is copied, patched or vendored.

## 1. What this is

Four things, one registry:

| term | what it is | where it appears |
|---|---|---|
| **hook** | a named, reusable pattern transform (middleware). Data (`chain`) or a function. | `hooks.def("duck", ...)` |
| **slot** | a named hole in a pattern chain. It applies whatever is bound to it *at the queried time*. | `.use("fx")`, `.wrap("fx", inner)` |
| **binding** | hook -> slot, with a gate (when it is open), an order and a priority. | `hooks.bind("fx", "duck", "@17b")` |
| **tap** | a named read point on a pattern: its events, onsets, gate, envelope or any param. A consumer maps it onto its own params. | `.tap("kick")`, `tap("kick:env")`, `.wire("gain", "kick:env")` |

A **module** is a hook that also declares params and taps in a manifest ("active tappable module").

The one idea underneath: **a slot is resolved at query time, as a pure function of cycle time and the registry**. The pattern is built
once; what it does at bar 17 is looked up when bar 17 is queried. That gives runtime swap, time gates and headless determinism from
the same mechanism.

## 2. Design decisions (with rejected alternatives)

1. **Late binding by name, resolved per query.** Rejected: resolving at pattern-build time (a swap would need re-evaluation of the whole
   program, which resets nothing in Strudel but loses the "swap one part" intent and cannot be time-gated); rejected: `ref(() => fn)`
   alone (Strudel's `ref` re-reads a value per query but has no gates, order, scope or serialization).
2. **Gates are pure functions of cycle time.** No wall clock, no "has this fired yet" flags in the query path. A live action
   ("swap now") is converted to an absolute cycle and written to a journal; replaying the journal gives the same audio. Rejected:
   mutable latches (random-access queries and the CLI's per-layer evaluation would disagree with live playback).
3. **Hooks are data first.** A hook is a list of method calls (`[["lpf", 800], ["room", 0.3]]`). Functions are allowed at runtime
   but are marked `opaque` and do not serialize by default. Rejected: functions only (no JSON, no completions, no validation).
4. **Namespaced lifecycle, five Pattern methods.** Lifecycle lives on one object, `hooks`. Pattern methods added: `use`, `wrap`,
   `tap`, `wire`, `ns`. One new top-level function: `tap`. Checked against Strudel core/draw/webaudio/tonal 1.2.6: these names are
   free. Names deliberately avoided because Strudel owns them: `bind` (monadic bind), `scope` (oscilloscope), `ref`, `pipe`,
   `compose`, `when`, `within`.
5. **Two ordering numbers, not one.** `order` = position in the signal flow when several bindings are chained; `priority` = who wins
   when a slot is exclusive. Rejected: a single `priority` doing both (it reads backwards for one of the two cases).
6. **Taps are pattern-level, not audio-level.** A tap reads events and derives signals from them analytically (onset, gate, AR
   envelope, sample-and-hold of a param). Rejected: tapping rendered audio inside the pattern graph (not available in a pattern
   query, not deterministic across live/headless). Audio-level following stays where it is: mixdown `follow`/`mbduck`.
7. **Bars are 1-based with a `b` suffix; bare numbers are Strudel cycles (0-based).** `"@17b"` = start of bar 17 = cycle 16 when
   1 bar = 1 cycle (the repo convention: `setcpm(BPM/4)`). Rejected: bare numbers as bars (silently off by one against every
   Strudel function).

## 3. Grammar (EBNF)

Program surface (JavaScript, as typed in a Strudel program):

```ebnf
slot-call   = "." "use"  "(" slot-ref [ "," use-opts ] ")"
            | "." "wrap" "(" slot-ref "," inner-fn [ "," use-opts ] ")" ;
tap-pub     = "." "tap"  "(" name [ "," tap-opts ] ")" ;              (* publish, passes the pattern through unchanged *)
tap-read    = "tap" "(" tap-ref [ "," read-opts ] ")" ;              (* a Pattern; use it anywhere a pattern is accepted *)
wire-call   = "." "wire" "(" param "," tap-ref [ "," wire-opts ] ")" ;
ns-call     = "." "ns"   "(" scope-id ")" ;                          (* sets the scope of every slot/tap upstream in this chain *)

lifecycle   = "hooks" "." ( "def" | "undef" | "bind" | "unbind" | "replace" | "set"
                          | "marker" | "scope" | "slot" | "load" | "toJSON" | "plan" | "reset" ) "(" args ")" ;
```

References (strings):

```ebnf
slot-ref    = [ scope-sel "/" ] name ;
tap-ref     = [ scope-sel "/" ] name [ ":" facet ] ;
hook-ref    = name [ "(" arg { "," arg } ")" ] ;                     (* "duck(0.3)" positional params, in manifest order *)
scope-sel   = scope-id | "*" ;
scope-id    = [ kind ":" ] name ;                                   (* "bass", "track:bass", "stem:low", "bus:2" *)
kind        = "track" | "stem" | "bus" ;
facet       = "ev" | "onset" | "gate" | "env" | param ;             (* default facet: "ev" *)
name        = letter { letter | digit | "_" | "-" } ;
param       = letter { letter | digit | "_" } ;                     (* a Strudel control name, e.g. cutoff, note, gain *)
```

Gates (string shorthand; the object form in 4.3 is canonical):

```ebnf
gate        = window { "," window } ;                                (* union of windows *)
window      = "*"                                                    (* always open *)
            | "@" point                                              (* drop-in: open from point onward       [p, inf) *)
            | "<" point                                              (* before:  open until point             [0, p)   *)
            | point ".." point                                       (* range, half-open                      [a, b)   *)
            | point ".." | ".." point ;                              (* same as "@" point / "<" point *)
point       = number [ unit ] [ offset ]
            | bar "." beat "b" [ offset ]                            (* "17.3b" = bar 17, beat 3 *)
            | minutes ":" seconds                                    (* "1:30" = 90 s *)
            | marker [ offset ] ;                                    (* "drop", "drop-2b" *)
unit        = "c" | "b" | "s" ;                                      (* cycles (default, 0-based), bars (1-based), seconds *)
offset      = ( "+" | "-" ) number [ "c" | "b" | "s" ] ;             (* an offset in b is a length in bars, not a bar number *)
marker      = name ;
```

## 4. Semantics

### 4.1 Time base
- All gate points are normalised to **cycles as exact fractions** when the binding is created or loaded.
- `cpb` (cycles per bar, default 1) and `bpb` (beats per bar, default 4) are registry settings. Bar `N` -> cycle `(N-1)*cpb`.
  `"17.3b"` -> `(16 + 2/4) * cpb`.
- Seconds need `cps`. Source, in order: `hooks.cps` if set by the host (the CLI sets it from `--cps` / `setcps`; the site sets it from
  the Tempo knob), else `state.controls._cps` at query time (Strudel's schedulers pass it), else error `E_NO_CPS`. A program whose cps
  changes mid-song must not use seconds (`W_CPS_VARIABLE`); use bars.
- Markers: `hooks.marker("drop", "17b")`. A reference to an undefined marker is not an error at bind time; the gate is **unresolved**
  and behaves as never reached (4.5) until the marker is defined.

### 4.2 Slots
`pat.use("fx")` returns a pattern. For a query span it:
1. resolves the slot's scope chain (4.7) and collects the bindings addressed to it;
2. splits the span at every gate boundary inside it (boundaries are quantised to `quant`, default 1 cycle; `quant: 0` = exact);
3. for each piece, picks the open bindings and applies them to `pat`, then queries the result over that piece only.

Consequences, all standard Strudel behaviour for split queries:
- A note whose onset is before a boundary is triggered by the old binding and rings through; the new binding only produces
  the non-onset remainder, which Strudel does not trigger. No double triggers, no cut notes.
- Transforms that shift time (`late`, `off`, `echo`, `fast`) see the upstream pattern's absolute cycle time, so a hook that drops in
  at bar 17 is in phase with the song, not restarted. To restart a hook's own time at its gate, set `rebase: true` on the binding
  (the hook is applied to `pat.late(from)`-compensated time; implemented with `early`/`late` only).
- No open binding: the slot's `else` applies (default `"bypass"` = identity; `"silence"`; or a hook-ref).

Slot mode (per slot, default `"chain"`; set with `hooks.slot("fx", { mode })` or `use` opts):

| mode | open bindings | result |
|---|---|---|
| `chain` | all | applied in ascending `order`, ties by bind sequence; first applied = closest to the source |
| `swap` | highest `priority` wins, ties: more specific scope, then latest bind | exactly one hook, others ignored |
| `stack` | all | each applied to the source separately, results layered (`stack`), a parallel send |

`pat.wrap("fx", inner)`: like `use`, but the hook receives `inner` (a function `pat -> pat`, the wrapped sub-chain) as `ctx.inner`
and decides how to run it (dry/wet, every N cycles, parallel). With no open binding, `inner` is applied directly.

`use-opts`: `{ mode, else, quant, ns }`. The first `use` of a slot name declares it; conflicting opts on a later `use` -> `E_SLOT_CONFLICT`.

### 4.3 Bindings and gates
`hooks.bind(slotRef, hook, gate?, opts?)` returns a binding id (`"b1"`, `"b2"`, ... in bind order, stable across runs).
`hook` is a hook-ref string, an inline chain array, or a function (opaque).

Gate, object form:

| key | type | default | meaning |
|---|---|---|---|
| `from` | point | cycle 0 | open from here (inclusive) |
| `until` | point | never | closed from here (exclusive). `until` without `from` is the "before" window |
| `windows` | `[[from, until], ...]` | - | union of ranges; replaces `from`/`until` |
| `period` | length in cycles | - | the windows repeat every `period` cycles, counted from the first window's start (loops, recorded pad takes) |
| `when` | tap-ref, mini-notation string or Pattern | - | extra condition: open only where this pattern is truthy, sampled at each `quant` boundary |
| `latch` | boolean | `false` | with `when`: once true, stay open until `until` (found by scanning from `from`, 4.5) |
| `quant` | cycles | 1 | boundary rounding (up to the next multiple); 0 = exact |
| `unreached` | `"else"` \| `"open"` \| `"error"` \| point | `"else"` | what to do when the gate never opens inside the render horizon (4.5) |

Binding opts: `{ order: 0, priority: 0, args: {...}, else: hook-ref, rebase: false, id }`.
A binding-level `else` is a hook applied **while this binding's gate is closed** (the per-binding fallback); the slot-level `else`
applies only when nothing at all is open.

### 4.4 Lifecycle
| op | effect |
|---|---|
| `hooks.def(name, spec)` | register a hook. Re-defining replaces it everywhere it is bound (that is the runtime swap of an implementation) |
| `hooks.undef(name)` | remove; bindings to it become dangling (`E_UNKNOWN_HOOK` in check, bypass when live) |
| `hooks.bind(slot, hook, gate, opts)` | add a binding |
| `hooks.unbind(idOrSlot, at?)` | with `at`: closes the binding(s) at that point (sets `until`); without: removes them |
| `hooks.replace(slot, hook, at?, opts?)` | `unbind(slot, at)` + `bind(slot, hook, "@" + at)`: an atomic swap at one boundary |
| `hooks.set("hook.param", value, gate?)` | set a hook/module param; value may be a number, a pattern or a tap-ref |
| `hooks.reset()` | clear everything (the host calls this before each evaluation of the program) |

Live use: `at` may be `"next"` (next `quant` boundary), `"next4"` (next multiple of 4 cycles) or `"now"`. The host converts it to an
absolute cycle from the scheduler position **at call time** and appends `{ cycle, op, args }` to `hooks.journal`. The registry state at
cycle `c` is always "program text + journal entries with `cycle <= c`". Headless renders never accept `"next"`/`"now"` (`E_LIVE_ONLY`);
they replay a journal.

Evaluation rule: the program text is the source of truth. Each evaluation calls `hooks.reset()` first, then the program re-registers
everything, then the journal (if kept) is re-applied. Bind order in the text is therefore the sequence order, on every run.

### 4.5 Never-reached gates and fallbacks
A render has a horizon `[0, H)` (`--bars N`; live play has none).
- **Static** gate (`from`/`until`/`windows`): unreached if no window intersects the horizon, or a marker is unresolved.
- **Conditional** gate (`when`): the condition is sampled at each `quant` boundary. With `latch`, the latch point is the first boundary
  at or after `from` where the condition is true, found by scanning forward at most `scanLimit` cycles (default 256) and memoised.
  Not found within the horizon (or the scan limit) = unreached.

`unreached` policy: `"else"` (default) keeps the closed-gate behaviour for the whole render and emits `W_GATE_UNREACHED`;
`"open"` treats the gate as open for the whole horizon; a point remaps `from` to that point; `"error"` raises `E_GATE_UNREACHED`
(`check --strict` treats the warning as an error too). Live, with no horizon, static gates are simply not open yet and unresolved
markers behave as `"else"`.

### 4.6 Taps
`pat.tap("kick")` registers the pattern at that point of the chain under the name and returns it unchanged.
`tap("kick:facet")` is a pattern that looks the name up **when queried**, so definition order in the text does not matter.

| facet | kind | value |
|---|---|---|
| `ev` (default) | discrete | the tapped haps, unchanged |
| `onset` | discrete | `1` at each onset, same `whole` as the source hap |
| `gate` | continuous | `1` while any source hap is sounding at t, else `0` |
| `env` | continuous | attack/release envelope in 0..1 retriggered at each onset: opts `{ a: 0, r: 0.25 }` in cycles (suffix `"s"` for seconds), `curve: "lin" \| "exp"` |
| any control name (`note`, `cutoff`, `gain`, ...) | continuous | sample-and-hold of that field from the most recent onset; before the first one: `read-opts.default` |

Continuous facets look back at most `lookback` cycles (default 4) for the governing onset; this bounds query cost and keeps
random access exact. `read-opts`: `{ gate, default, lookback, a, r, curve }`. A **gated read** (`tap("kick:env", { gate: "<17b" })`) is
open only inside the gate; outside it yields `default` (continuous facets, default `0`) or silence (discrete facets).

`pat.wire(param, tapRef, opts)` is the data-driven mapping of a tap onto the consumer's own param:

| opt | default | meaning |
|---|---|---|
| `range` | the param's range from the mod-matrix table (`cutoff` 20..20000, `gain` 0..2, ...) | `[lo, hi]` output range for tap value 0..1 |
| `curve` | `"lin"` | `"lin"` or `"exp"` |
| `op` | `"set"` | `"set"`, `"add"`, `"mul"` against the consumer's existing value |
| `gate`, `default` | `*`, none | as for a gated read; closed gate with no default leaves the param untouched |

Limits, stated plainly: Strudel controls are read **once per event at its onset**. A tap signal therefore moves a consumer param per
note, not inside a note. For in-note movement use the existing continuous LFO path (#28), or `.segment(n)` on the consumer. Taps of
rendered audio (`out`) are reserved and raise `E_TAP_AUDIO`; use mixdown `follow`.

Tap cycles (`a` reads `b` reads `a`) are caught by a re-entrancy guard in the query path: `E_TAP_CYCLE`, the inner read yields its default.

Modules: `hooks.def("pump", { params: { depth: { min: 0, max: 1, default: 0.7, unit: "" } }, taps: { env: "kick:env" }, chain | apply })`.
Module params are readable as taps (`tap("pump:depth")`) and settable (`hooks.set("pump.depth", ...)`); module taps are re-exports
or derived patterns under the module's name (`tap("pump:env")`).

### 4.7 Scopes
Scope kinds: `track` (one `$:` layer or named pattern), `stem` (a render stem group), `bus` (a Strudel orbit), plus the implicit global scope.
- Declare ancestry: `hooks.scope("bass", { stem: "low", bus: 2 })`. The CLI auto-declares one track scope per layer name.
- A chain gets its scope from `.ns("bass")` (affects every `use`/`tap`/`wire` upstream in that chain) or from an explicit prefix
  (`.use("bass/fx")`), which wins.
- A slot `fx` in scope `bass` collects bindings addressed to `bass/fx`, `stem:low/fx`, `bus:2/fx`, `*/fx` and global `fx`.
  Specificity, most to least: track, stem, bus, `*`, global. In `chain` mode all apply (global first, track last, then `order`
  within a level); in `swap` mode specificity is the tie-break after `priority`.
- Taps resolve the same way, most specific first. `tap("kick")` inside `.ns("drums")` finds `drums/kick` before global `kick`.
- A bus scope is addressing only: it selects patterns declared to be on that orbit. Hooks transform patterns; they do not insert
  audio effects on the orbit's output.

### 4.8 Composition with Strudel's algebra
- `use`, `wrap`, `tap`, `wire`, `ns` return ordinary Patterns; they nest inside `stack`, `cat`, `arrange`, `every`, `off`, `jux`, mini-notation
  `pick`/`inhabit` targets, etc. A slot inside `fast(2)` sees *its own local time* compressed, like any inner pattern. Rule of
  thumb: **gates are in the time of the place where `.use` is written**. Put song-time gates on the outermost chain.
- Inside `arrange`/scene timelines each section's local time restarts at 0; use markers for song positions and keep song-level slots
  outside `arrange`.
- A hook is `pat -> pat`, so Strudel's own `pipe`/`compose` and `.superimpose`, `.layer`, `.every(4, fn)` accept hook functions:
  `hooks.fn("duck")` returns the late-bound function for a hook name; `hooks.pipe("a", "b(0.3)")` returns the composed late-bound function.
- Tap patterns are plain patterns: `tap("lfo").range(200, 2000).slow(2)`, `tap("kick:onset").mask(...)`, `.struct(tap("kick:onset"))`.

### 4.9 Determinism (headless)
1. Resolution reads only: the registry, the journal, the query span, `state.controls` (`_cps`, scope). Never `Date`, the audio
   clock, `Math.random` or call order of queries.
2. Random access: querying `[20, 21)` alone returns the same haps as that slice of a `[0, 32)` query.
3. The CLI evaluates each `$:` layer alone with the shared header. Therefore: the CLI evaluates the **whole program once first**
   (registry pass: all `def`/`bind`/`.tap` calls run), then evaluates layers without `hooks.reset()` in between. `.tap` from the same
   source position re-registers idempotently. Cross-layer taps then resolve in per-layer and per-stem renders exactly as in the mix.
4. Canonical JSON (sorted keys, fractions as `"n/d"` strings, binding ids in bind order) so the same program gives byte-identical `hooks.toJSON()`.
5. `strudel hooks IN` prints the resolved plan; two runs must be identical, and `render` twice must give identical `mix.wav` hashes
   when the program has no other random source.

## 5. Config JSON

This is the shared model document of `docs/BLUEPRINT.md` section 5 with only the registry keys present (version key `model`).

```json
{
  "model": 1,
  "cpb": 1, "bpb": 4, "cps": 0.5,
  "markers": { "drop": "17b", "out": "49b" },
  "scopes":  { "bass": { "stem": "low", "bus": 2 }, "kick": { "stem": "drums", "bus": 1 } },
  "slots":   { "fx": { "mode": "chain", "else": "bypass", "quant": 1 } },
  "defs": {
    "open":  { "chain": [["lpf", 4000]] },
    "murk":  { "params": { "hz": { "min": 20, "max": 20000, "default": 400, "unit": "Hz" } },
               "chain": [["lpf", { "$param": "hz" }], ["room", 0.4]] },
    "duck":  { "params": { "depth": { "min": 0, "max": 1, "default": 0.7 } },
               "taps": { "env": "kick:env" },
               "chain": [["wire", "gain", "kick:env", { "range": [1, { "$expr": "1-depth" }], "op": "mul" }]] }
  },
  "bindings": [
    { "id": "b1", "slot": "bass/fx", "hook": "murk", "args": { "hz": 300 }, "gate": { "until": "drop" }, "order": 0 },
    { "id": "b2", "slot": "bass/fx", "hook": "duck", "gate": { "from": "drop", "unreached": "else" }, "order": 1 }
  ],
  "wires":   [ { "dest": "lead.cutoff", "tap": "bass:note", "range": [400, 4000], "curve": "exp", "gate": "@drop" } ],
  "journal": [ { "cycle": "32", "op": "replace", "args": ["bass/fx", "open"] } ]
}
```

- `chain` step = `[method, ...args]`. Only method names that exist on `Pattern.prototype` at load time are accepted (`E_UNKNOWN_METHOD`).
  Args are JSON values; `{"$param": name}` substitutes a hook param, `{"$tap": ref}` a tap pattern, `{"$mini": "..."}` a mini-notation
  pattern, `{"$expr": "..."}` arithmetic over params only (numbers, `+ - * /`, parentheses; no code execution).
- A function hook serializes as `{ "opaque": true, "src": "<fn.toString()>" }`. `hooks.load` refuses it (`E_OPAQUE`) unless called with
  `{ allowCode: true }`; the CLI flag is `--hooks-allow-code`. The site never loads opaque hooks from shared links.
- `hooks.load(json)` then `hooks.toJSON()` returns the same canonical text (round trip).
- `wires` with `dest: "layer.param"` use the mod-matrix destination format (#11) so the two can share validation and ranges.

## 6. Errors and warnings

Policy: **live** = never throw from a query; the failing slot bypasses, the failing tap yields its default, one console line per code and
name. **Headless** = `strudel check` lists all; errors exit 1; `--strict` promotes warnings.

| code | when |
|---|---|
| `E_NAME_COLLISION` | install: a Pattern method or global we add already exists in the loaded Strudel |
| `E_UNKNOWN_HOOK` / `E_UNKNOWN_SLOT` / `E_UNKNOWN_TAP` | a binding names a missing hook; a binding addresses a slot no pattern uses; a read finds no tap |
| `E_UNKNOWN_METHOD` | a chain step is not a Pattern method |
| `E_BAD_GATE` | unparsable gate, `until <= from`, negative point |
| `E_BAD_ARG` | hook arg outside the manifest `min..max`, unknown param |
| `E_SLOT_CONFLICT` | one slot declared with two modes/else values |
| `E_TAP_CYCLE` | tap reads form a loop |
| `E_TAP_AUDIO` | audio-level facet requested |
| `E_NO_CPS` | seconds used with no cps known |
| `E_LIVE_ONLY` | `"now"`/`"next"` in a headless run |
| `E_OPAQUE` | function hook in JSON without `allowCode` |
| `E_GATE_UNREACHED` | gate never opens and policy is `"error"` |
| `E_HOOK_THREW` | a hook function threw or did not return a Pattern (slot bypasses) |
| `W_GATE_UNREACHED` | as above with policy `"else"` |
| `W_SHADOWED` | a `swap` binding can never win (same window, lower priority) |
| `W_CPS_VARIABLE` | seconds used while cps changes |
| `W_UNUSED_TAP` / `W_UNUSED_HOOK` | published or defined, never read or bound |

## 7. Intellisense (data-driven)

One provider, registered through the existing registry; no editor changes:

```js
window.strudelCraft.intellisense.register({ id: 'hooks', items: (ctx) => hooks.completions(ctx) });
```

Items (the registry's item shape: `label, method, string, detail, info, category, apply`):

| category | items | flags |
|---|---|---|
| `hooks` | `use`, `wrap`, `tap`, `wire`, `ns` | `method: true`, `detail` = signature |
| `hooks` | `tap`, `hooks.def`, `hooks.bind`, `hooks.replace`, ... | functions |
| `slots` | every declared slot-ref | `string: true`, `info` = mode, bindings and their windows |
| `hook names` | every hook, as `name` and `name(default args)` | `string: true`, `info` = params with min/max/default/unit |
| `taps` | every `name:facet` (facets from the manifest plus the controls seen on the tapped events) | `string: true` |
| `markers`, `gates` | marker names; gate templates `"@17b"`, `"<17b"`, `"9b..17b"` | `string: true` |

The registry caches items until `register` is called. `hooks` therefore re-registers the provider (same id) whenever the registry
changes; that is the supported cache-bust in `site/intellisense.js`. All content comes from manifests (`defs`, `slots`, `markers`),
so a config JSON loaded at runtime shows up as completions with no code change.

## 8. Worked examples

Tempo convention in all examples: `setcpm(BPM/4)`, 1 bar = 1 cycle. The sounds are whatever the user's program already uses.

**1. A slot and a runtime swap**
```js
hooks.def("murk", { chain: [["lpf", 400], ["room", 0.4]] })
hooks.def("open", { chain: [["lpf", 4000]] })
hooks.bind("fx", "murk")
$: note("c2 eb2 g2 bb2").s("sawtooth").use("fx")
// live, from a button or the console; lands on the next bar line and is journaled:
hooks.replace("fx", "open", "next")
```

**2. Drop-in at a bar** (closed before bar 17, the slot bypasses)
```js
hooks.bind("fx", [["distort", 2], ["hpf", 120]], "@17b")
$: s("bd*4").use("fx")
```

**3. Before window** (open until a point)
```js
hooks.marker("drop", "17b")
hooks.bind("fx", "murk", "<drop")          // intro filter, gone at the drop
```

**4. Range, per-binding fallback, union of windows**
```js
hooks.bind("fx", "open", "9b..17b", { else: "murk" })          // murk outside bars 9-16
hooks.bind("fill", [["ply", 2]], "8b..9b, 16b..17b, 1:30..1:32") // two bar windows and one in seconds
```

**5. Tap -> param: pattern-level ducking**
```js
$: s("bd*4").tap("kick")
$: note("c2*8").s("sawtooth").wire("gain", "kick:env", { range: [1, 0.3], op: "mul", r: 0.25 })
// equivalent, written with the algebra:
$: note("c2*8").s("sawtooth").gain(tap("kick:env", { r: 0.25 }).range(1, 0.3))
```

**6. Tap a param: one part follows another's pitch, only after the drop**
```js
$: note("<c2 eb2 f2 g2>").s("sawtooth").tap("bass")
$: s("square").struct("x*4").note(tap("bass:note", { gate: "@drop", default: 48 }).add(12))
```

**7. Module with params and taps**
```js
hooks.def("pump", {
  params: { depth: { min: 0, max: 1, default: 0.7 }, r: { min: 0.01, max: 2, default: 0.25, unit: "cycles" } },
  taps:   { env: "kick:env" },
  chain:  [["wire", "gain", "kick:env", { range: [1, { $expr: "1-depth" }], op: "mul" }]]
})
hooks.bind("*/duck", "pump(0.5)")                              // every scope that has a duck slot
hooks.set("pump.depth", 0.9, "@drop")                          // deeper from the drop
$: note("c3 eb3").s("triangle").ns("pad").use("duck").lpf(tap("pump:env").range(600, 3000))
```

**8. Condition, latch, never-reached fallback**
```js
// open the riser hook from the first bar (at or after bar 9) in which the snare plays; latch until the drop
hooks.bind("fx", "riser", { from: "9b", until: "drop", when: "snare:gate", latch: true, unreached: "error" })
// alternate bars only, by a mini-notation condition
hooks.bind("fx", "open", { when: "<0 1>" })
// marker never defined: bypass and warn, unless told otherwise
hooks.bind("fx", "open", { from: "bridge", unreached: "33b" })  // fall back to bar 33
```

**9. Order, priority and scope**
```js
hooks.scope("bass", { stem: "low", bus: 2 })
hooks.bind("fx", "glue")                                       // global, applies first
hooks.bind("stem:low/fx", "sat", "*", { order: 1 })
hooks.bind("bass/fx", "duck", "*", { order: 0 })               // within track level, before any order 1
$: note("c2*4").s("sawtooth").use("fx").ns("bass")             // chain: glue -> sat -> duck

hooks.slot("voice", { mode: "swap" })
hooks.bind("voice", "plain", "*",     { priority: 0 })
hooks.bind("voice", "wide",  "@17b",  { priority: 10 })        // wins from bar 17
hooks.bind("voice", "thin",  "@17b",  { priority: 5 })         // W_SHADOWED
```

**10. Wrap form and functional composition**
```js
hooks.def("parallel", { apply: (pat, ctx) => stack(pat, ctx.inner(pat).gain(ctx.args.wet)), params: { wet: { min: 0, max: 1, default: 0.5 } } })
hooks.bind("send", "parallel(0.4)", "@9b")
$: s("hh*8").wrap("send", p => p.room(0.8).lpf(2000))          // before bar 9: fully wet chain, as written
$: s("cp*2").every(4, hooks.pipe("murk", "pump(0.3)"))         // hooks as ordinary pat -> pat functions
```

**11. Config JSON and the headless CLI**
```
strudel check  song.strudel.js --hooks hooks.json --bars 48 --strict
strudel hooks  song.strudel.js --hooks hooks.json --bars 48      # resolved plan as JSON: slot -> [{from, until, bindings[]}], taps, warnings
strudel stems  song.strudel.js out/ --hooks hooks.json --bars 48 # cross-layer taps resolve in every stem
```

**12. Replaying a live take**
```js
// after a live session: hooks.toJSON() contains "journal": [{ "cycle": "32", "op": "replace", "args": ["fx", "open"] }, ...]
// headless: --hooks take.json replays each entry at its cycle; the render matches what was played, bar for bar.
```

## 9. Implementation sketch (on Strudel's public API only)

One standalone ES module, `site/hooks.js`, no imports. It is handed the Strudel exports by the host:
`install({ Pattern, stack, silence, reify, signal, Fraction })`, from `window` after `strudel:ready` on the site, from the CLI's own
`@strudel/core` import in Node. It adds methods to `Pattern.prototype` (the same extension route as Strudel's `register`), after a
collision check. Strudel files are never edited.

```js
// slot: resolve at query time, split at gate boundaries
Pattern.prototype.use = function (slotRef, opts) {
  const src = this; R.declareSlot(slotRef, opts);
  return new Pattern((state) => {
    const scope = state.controls._hookNs;                       // set by .ns(), see below
    return R.plan(slotRef, scope, state.span, state.controls)    // -> [{ span, key, fns }]  pure, memoised per (slot, scope, registry version)
      .flatMap(({ span, key, fns }) => R.built(src, key, () => fns.reduce((p, f) => f(p), src)).query(state.setSpan(span)));
  });
};

// scope: pass a control downstream-to-upstream through the query state
Pattern.prototype.ns = function (id) {
  const src = this;
  return new Pattern((state) => src.query(state.setControls({ ...state.controls, _hookNs: id })));
};

// tap publish / read
Pattern.prototype.tap = function (name, opts) { R.publish(name, this, opts); return this; };
const tap = (ref, opts) => new Pattern((state) => R.guard(ref, () => R.facet(ref, opts, state)));   // guard = re-entrancy check

// facets are small pure pattern functions over the tapped pattern T:
//   onset: T.withValue(() => 1)                         gate: signal-like query: any hap of T.queryArc(t, t) -> 1 else 0
//   param: latest onset in T.queryArc(t - lookback, t)  env:  same lookup, then AR shape of (t - onset)
// wire is sugar: pat.wire(p, ref, o)  ==  pat[o.op](reify({ [p]: tap(ref, o).range(lo, hi) })) with set/add/mul

// data hook -> function
const fromChain = (chain, args) => (pat) => chain.reduce((p, [m, ...a]) => p[m](...a.map((x) => R.arg(x, args))), pat);
```

Notes for the implementer:
- `R.plan` cuts `state.span` at quantised boundaries of every binding addressed to the slot and returns, per piece, the ordered list of
  hook functions. `R.built` caches the transformed pattern per distinct active set so a pattern is built once per set, not per query.
- Gate math uses Strudel's `Fraction` so boundaries are exact; seconds are converted once with the known cps.
- `when`/`latch` gates query the condition pattern at boundaries (`queryArc(b, b)` for signals, a one-`quant` arc for discrete ones).
- The CLI change is small and lives with the CLI (`engine/strudel-cli`): import `hooks.js`, call `install`, add the registry pass
  (4.9.3), the `--hooks` flag and the `hooks` subcommand. The site change is a `<script type="module">` and the provider in section 7.
- Test method: hap-list equality through `strudel events` against hand-written equivalents (a gated `use` vs the same chain masked
  per bar), random-access equality, JSON round trip, double-render hash equality. One check per acceptance box.

## 10. Open questions

1. **Bus scope as audio insert.** Here a bus scope only selects patterns. A true post-orbit insert needs superdough graph access; out
   of scope until someone needs it. Is addressing-only acceptable?
2. **`quant` default.** One cycle is safe and musical for 4/4. Should the default follow `cpb`, and should a binding be allowed to
   quantise to a tap's onsets ("swap on the next kick")?
3. **In-note tap modulation.** Taps move params per event. Joining taps to the continuous LFO path (#28) would give in-note movement;
   needs a shared control-rate bridge. Separate node if wanted.
4. **`rebase` semantics inside `arrange`.** Local section time plus rebase compounds two offsets; needs one worked test before it is
   promised.
5. **Opaque hooks on the site.** Refused from shared links by design. Is a per-origin "trust this program" switch wanted, or is
   data-only enough?
6. **Overlap with the mod matrix (#11).** `wires` reuses its destination format and ranges. Should `mod.json` env sources become taps
   (one mechanism), or stay separate with a shared range table?
7. **`@strudel/web` 1.3.0 vs core 1.2.6.** `state.controls._cps`, `State.setControls` and `new Pattern(query)` are present in 1.2.6; the
   implementation issue must confirm them on the site's pinned bundle (first acceptance box).
8. **Scan cost of latches.** `scanLimit` 256 cycles is a guess; measure on a 200-bar song before fixing the default.
