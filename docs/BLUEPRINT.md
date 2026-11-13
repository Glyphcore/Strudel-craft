# Studio toolkit blueprint: code, graph, beatpad, board and library over one model

Status: **P1-P9 built on main** (design note first written as `issued`; phases and issues in section 12, state per phase in that table). Extends `docs/HOOKS_SYNTAX.md` (hooks, slots, bindings, gates, taps); read that first. What the site actually loads is summarised in `site/README.md`.
Owner: `daw-sme`. Magic strings (mini-notation, gates, tap refs, names) as typed atoms: `docs/ATOMS.md`. UI parts are direction for `ui-designer` (built later through the `aaa-web-ui` skill), not a UI spec.

## 1. The idea

One studio toolkit, five surfaces, one model: **code** (Strudel text), **graph** (node editor), **beatpad** (launch and finger-drum),
**board** (knobs, faders, XY, steps) and **library** (versioned components). Each surface reads and writes the same named references;
none owns the data.

Composition instead of paintbrush/timeline. A song is a **set of named things wired together and gated in time**: patterns, hooks,
modules, taps, variables, gates, components. A pad grid (section 9) plays those same named things live. There are no clips painted on lanes; "when" is a gate on a binding or an instance, and the
timeline is a read-only view computed from the gates (`hooks.plan`).

One **model** (a JSON document, section 5) is the single store. Everything else is a view of it:

```
            parse                    project
  code  <----------->   MODEL   <----------->  graph (nodes + wires)
          generate        |        edit ops
                          +--> library (components = saved pieces of a model, versioned)
                          +--> intellisense (completions = names and manifests in the model)
                          +--> beatpad (pads fire registry ops; a take is journal data)
                          +--> board   (controls are named variables; moves record to automation lanes)
                          +--> headless CLI (render, plan, check, perf, controls)
```

Decisions, with the alternatives rejected:
1. **Model is the store; neither code nor graph is.** Rejected: graph stored separately with a sync step (drifts); rejected: code as the
   only store with the graph re-derived on every keystroke (layout and collapsed state have nowhere to live, and library pieces would be
   text snippets with no ports).
2. **Lossless by keeping source text.** Every track keeps its `src`. Code the parser does not understand becomes an **opaque `code`
   node** holding the text byte for byte, with its taps and slots still detected. Rejected: refusing unparsable programs (Strudel is
   JavaScript; users will write arbitrary code).
3. **A graph edit regenerates only the track or header statement it touched.** Untouched text is never reformatted.
4. **A variable is a tap whose source is a value.** One read mechanism (`tap("name")`) for events, signals, params and variables.
   Rejected: a second lookup function (two namespaces, two completion lists, two gate implementations).
5. **Components are immutable, content-hashed versions.** An instance pins `name@rev`. Rejected: live links to "latest" (a saved
   song would change when a component is edited, and headless renders would not be reproducible).
6. **Layout is stored for named nodes only.** Steps inside a track are laid out automatically, so no id comments are needed in code.

## 2. Variables

```ebnf
let-call  = "hooks" "." "let" "(" name "," value [ "," gate ] [ "," let-opts ] ")" ;
value     = number | string | pattern | tap-ref-object | chain ;      (* pattern: any Strudel Pattern or {"$mini": "..."} *)
let-opts  = "{" [ "min" ":" n ] [ "," "max" ":" n ] [ "," "unit" ":" s ] [ "," "priority" ":" n ] [ "," "ns" ":" scope-id ] "}" ;
```

- `hooks.let("root", 48)` defines a variable. Read it with `tap("root")` (a pattern of that value) anywhere a pattern is accepted:
  `note(tap("root").add("0 3 7"))`.
- Several `let` on one name with gates are resolved like a `swap` slot: at cycle `c` the open assignment with the highest `priority`
  wins, ties to the latest. `hooks.let("root", 51, "@17b")` is a key change at bar 17, with every gate form, `unreached` policy and
  journal rule of HOOKS_SYNTAX 4.3-4.5. No open assignment: the ungated one; none: `E_UNKNOWN_TAP`.
- A pattern-valued variable is a reusable pattern: `hooks.let("riff", note("c3 eb3 g3 bb3"))`, then `tap("riff").s("sawtooth")` in two
  tracks. Facets work on it (`tap("riff:onset")`, `tap("riff:note")`).
- `min`/`max`/`unit` make it a knob: the graph shows a control, intellisense shows the range, `E_BAD_ARG` outside it.
- Scope: `ns` or a `scope/name` prefix, resolved as taps are (most specific first).
- Variables may read other variables and taps; loops are caught by the tap re-entrancy guard (`E_TAP_CYCLE`).

## 3. Decorators and higher-order hooks

A hook is `pat -> pat`. A **decorator** is `hook -> hook`. Hook references become expressions:

```ebnf
hook-expr = hook-term { "|" hook-term } ;                 (* pipe, left to right: "murk | pump(0.3)" *)
hook-term = hook-ref [ "[" hook-expr "]" ] ;              (* decorator applied to the bracketed expression *)
```

Accepted wherever a hook-ref is (`bind`, `replace`, `else`, `hooks.fn`, `hooks.pipe`, config JSON `hook`).

Built-in decorators (all data, all deterministic):

| decorator | meaning | built from |
|---|---|---|
| `every(n)[h]` | apply `h` on the first of every `n` cycles | Strudel `firstOf` |
| `mix(wet)[h]` | dry plus `h` at gain `wet` (0..1, default 0.5) | `stack`, `gain` |
| `gated(g)[h]` | `h` only inside gate `g`; nests inside a binding's own gate | slot planner |
| `sometimes(p)[h]` | `h` with probability `p` per event, Strudel's seeded randomness | `sometimesBy` |
| `ns(scope)[h]` | run `h` with slots and taps resolved in another scope | `.ns` |
| `tapped(name)[h]` | publish the output of `h` as tap `name` | `.tap` |
| `with(k=v,...)[h]` | preset params of `h` | args merge |

User decorators: `hooks.def("halfwet", { decorator: true, params: { wet: { min: 0, max: 1, default: 0.5 } }, chain: [["superimpose", { "$hook": "inner" }]] })`.
`{"$hook": "inner"}` is the decorated hook as a function argument; `{"$hook": "name"}` is any named hook. Function form:
`{ decorator: true, apply: (inner, ctx) => (pat) => ... }` (opaque, as other function hooks).

`hooks.decorate(name, decoratorRef)` rewraps an existing definition in place (`murk` becomes `every(4)[murk]` everywhere it is bound);
`hooks.undecorate(name)` removes the outermost wrap. Both are journaled when called live.

Errors added: `E_NOT_DECORATOR` (bracket form on a plain hook), `E_DECORATOR_ARITY` (decorator used without `[...]`).

## 4. Graph view

### 4.1 Nodes
| kind | is | ports in | ports out | code it stands for |
|---|---|---|---|---|
| `pattern` | a source expression | param ports (one per literal arg) | pattern | `note("c2 eb2")`, `s("bd*4")` |
| `step` | one method call in a chain | pattern, param ports | pattern | `.lpf(800)` |
| `slot` | a hole | pattern, hook (bindings land here) | pattern | `.use("fx")`, `.wrap("fx", inner)` |
| `hook` / `module` | a definition; a module shows its params and taps | param ports | hook, its taps | `hooks.def(...)` |
| `decorator` | hook -> hook | hook, param ports | hook | `every(4)[...]` |
| `tap` | a named read point | pattern | one port per facet in use | `.tap("kick")` |
| `var` | a named value or pattern | value (per assignment) | pattern/param | `hooks.let(...)` |
| `control` | a var with a control type; drawn as the control itself | input, automation | pattern/param, one port per axis | `ctl("cutoff", {...})`, `slider(...)` |
| `gate` | a window or condition | signal (for `when`), marker | gate | a gate object or string |
| `marker` | a named point in time | - | point | `hooks.marker("drop", "17b")` |
| `out` | where a track goes: track, stem, bus | pattern | - | `$:` / `name:` plus `.orbit(n)` and scope |
| `component` | an instance of a library component, collapsed | its exposed params, required taps | its patterns, taps, hooks | `hooks.inst("pad@3", {...})` |
| `code` | opaque source text | detected tap reads | detected tap publishes, pattern | anything else |

A **track** is a chain: `pattern -> step -> ... -> out`. In the graph it is one collapsed node by default and opens into its steps.

### 4.2 Wire types
| type | carries | drawn | made by |
|---|---|---|---|
| `pattern` | haps | solid, thick | method chaining |
| `signal` | a continuous value over time (tap facets `gate`, `env`, held params) | solid, thin, wave badge | `tap("x:env")` as an argument, `.wire` |
| `param` | a number, string or patterned value | dotted | literal args, `tap("var")`, `hooks.set` |
| `gate` | open/closed over time | dashed, window badge (`17b ->`, `<- 17b`, `9b..17b`) | gate on a binding, read, wire, `let` |
| `hook` | `pat -> pat` | double line | `hooks.bind`, decorator nesting, `{"$hook": ...}` |
| `audio` | rendered sound on a bus (docs/LANES.md) | thick bar with a ladder of slots, badge `BUS` (with the send amount, `ret` on a return) | `.split` fan rows, `.send` / `tagged().send` to a bus node, `ret` out of it, capture `audio` |

Type is shown by line style and a text badge, never by colour alone.

Connection rules: same type connects. `pattern -> signal` and `pattern -> param` connect by inserting a facet choice (the editor asks:
onset, gate, env, or a control name). `signal -> param` connects through a range (`wire` opts). `signal -> gate` makes a `when`
condition. `hook -> slot` creates a binding; the binding's gate, order, priority and else are properties of that wire. Anything else is
refused with the reason shown.

### 4.3 Graph edit -> model op -> code
Every edit is one registry operation, the same ones the code calls, so the graph cannot express anything the code cannot:

| graph edit | model op | code effect |
|---|---|---|
| wire hook -> slot | `bind` | adds a `hooks.bind(...)` header line |
| wire control -> param port | add `maps` entry | adds a `hooks.map(...)` header line |
| change a wire's window | binding gate update | rewrites that `hooks.bind` line |
| wire tap facet -> param port | add `wire` | appends `.wire(param, ref, opts)` to that track |
| insert / remove / reorder a step | track chain edit | regenerates that track's chain |
| turn a knob on a step or var | literal update | rewrites that literal only |
| collapse selection | new component + instance | selection replaced by `hooks.inst(...)`; definition goes to the library |
| live swap button on a wire | `replace(..., "next")` | journal entry, no text change |

### 4.4 Code -> model
- Parser: an ECMAScript parser (acorn, MIT, loaded as its own unmodified file) over the program text. Structured subset:
  header statements that are `hooks.*(...)` calls with literal arguments, and layers (`$:` / `name:`) that are one call chain whose
  arguments are literals, mini-notation strings, `tap(...)` calls, arrow functions (kept as text) or nested chains.
- Outside the subset: the whole statement becomes a `code` node with `src`. A scan of `tap("...")`, `.tap("...")`, `.use("...")`,
  `.wrap("...")` string literals inside it still gives the node its ports, so it stays wired in the graph.
- Double-quoted strings stay double-quoted (Strudel's transpiler treats them as mini-notation); the generator never changes quote style.
- Fixed point: `generate(parse(text)) == text` for text the generator produced, and for any text when nothing was edited (each node
  re-emits its kept `src`). After a graph edit only the touched statements change.
- Layout: named nodes keep `x, y, collapsed` in `model.layout`. No layout stored: deterministic layered layout, left to right by
  dependency rank, tracks top to bottom in program order.

### 4.4b Canvas gestures (phone and desktop)
- Nodes and cards (`touch-action: none`, pointer capture): a one-finger, mouse or pen drag that starts on a node always moves it; an 8 px movement threshold tells a tap (select, double-tap zoom) from a drag; a 500 ms hold starts multi-select. Dragged nodes snap to a 12 px grid (half the dot grid), are clamped to non-negative world space, and auto-pan the view near the canvas edge, so the content bounds (and Fit) extend with the node.
- Ports: a one-finger drag from a port draws a wire (no Interact needed); a tap arms the port for tap-to-connect.
- Empty canvas: on touch, one finger scrolls the page (`touch-action: pan-y`); two fingers pan and pinch zoom. The **Interact** toggle makes one finger pan the empty canvas too. Mouse drag pans; the wheel pans until the content edge, then scrolls the page; Ctrl+wheel zooms.
- Canvas height is capped (about 66-70 dvh) with a page gutter; Fit, zoom out, 1:1, Interact and Collapse stay pinned on the canvas. On-canvas hint: "drag nodes; two fingers to move the view".
- Test: `node tests/site/graph_scroll.mjs` (360x780 touch, plus desktop mouse and pen).

### 4.5 Read-only derived views
- **Plan strip**: `hooks.plan()` drawn as bars: per slot and per variable, which binding is open when. This replaces the timeline;
  it is edited by changing gates, not by dragging clips (dragging a window edge in the strip is an edit of that gate's `from`/`until`).
- **Activity**: while playing, a wire's badge shows whether its gate is open and pattern wires pulse on onsets.

## 5. Shared data model

One document type, `strudelcraft.model`, version 1. The hooks config of HOOKS_SYNTAX section 5 is the same document with only the
registry keys present, so every hooks.json is already a valid model.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "strudelcraft.model/1",
  "type": "object",
  "required": ["model"],
  "additionalProperties": false,
  "properties": {
    "model":    { "const": 1 },
    "meta":     { "type": "object", "properties": { "name": { "type": "string" }, "kind": { "enum": ["song", "track", "set", "fragment", "bank", "performance", "board", "automation"] },
                  "rev": { "type": "integer", "minimum": 1 }, "hash": { "type": "string" }, "parent": { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } } } },
    "settings": { "type": "object", "properties": { "cps": { "type": "number", "exclusiveMinimum": 0 }, "cpb": { "type": "number", "default": 1 }, "bpb": { "type": "integer", "default": 4 } } },
    "header":   { "type": "string", "description": "verbatim non-hook header code (setcpm, samples, helpers)" },
    "markers":  { "type": "object", "additionalProperties": { "$ref": "#/$defs/point" } },
    "scopes":   { "type": "object", "additionalProperties": { "type": "object", "properties": { "stem": { "type": "string" }, "bus": { "type": "integer" } } } },
    "slots":    { "type": "object", "additionalProperties": { "type": "object", "properties": { "mode": { "enum": ["chain", "swap", "stack"] }, "else": { "type": "string" }, "quant": { "type": "number", "minimum": 0 } } } },
    "defs":     { "type": "object", "additionalProperties": { "$ref": "#/$defs/def" } },
    "vars":     { "type": "object", "additionalProperties": { "type": "array", "items": { "$ref": "#/$defs/assign" } } },
    "bindings": { "type": "array", "items": { "$ref": "#/$defs/binding" } },
    "wires":    { "type": "array", "items": { "$ref": "#/$defs/wire" } },
    "tracks":   { "type": "array", "items": { "$ref": "#/$defs/track" } },
    "instances":{ "type": "array", "items": { "$ref": "#/$defs/instance" } },
    "components": { "type": "object", "description": "embedded component versions keyed name@rev, so the document is self-contained", "additionalProperties": { "$ref": "#" } },
    "exports":  { "$ref": "#/$defs/exports" },
    "pads":     { "type": "object", "properties": { "banks": { "type": "array", "items": { "$ref": "#/$defs/bank" } },
                  "keymaps": { "type": "object", "additionalProperties": { "type": "object", "additionalProperties": { "type": "string" } } },
                  "settings": { "type": "object", "properties": { "latencyMs": { "type": "number", "default": 0 }, "takeover": { "enum": ["pickup", "jump"] }, "activeKeymap": { "type": "object" } } } } },
    "controls": { "type": "object", "additionalProperties": { "$ref": "#/$defs/control" } },
    "maps":     { "type": "array", "items": { "$ref": "#/$defs/map" } },
    "boards":   { "type": "array", "items": { "$ref": "#/$defs/board" } },
    "automation": { "type": "object", "additionalProperties": { "$ref": "#/$defs/lane" } },
    "performances": { "type": "object", "additionalProperties": { "$ref": "#/$defs/performance" } },
    "journal":  { "type": "array", "items": { "type": "object", "required": ["cycle", "op"], "properties": { "cycle": { "type": "string" }, "op": { "type": "string" }, "args": { "type": "array" } } } },
    "layout":   { "type": "object", "additionalProperties": { "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "collapsed": { "type": "boolean" } } } }
  },
  "$defs": {
    "point":   { "type": ["string", "number"], "description": "HOOKS_SYNTAX gate point: 16, \"17b\", \"17.3b\", \"90s\", \"1:30\", \"drop-2b\"" },
    "gate":    { "oneOf": [ { "type": "string" }, { "type": "object", "additionalProperties": false, "properties": {
                 "from": { "$ref": "#/$defs/point" }, "until": { "$ref": "#/$defs/point" }, "windows": { "type": "array" }, "period": { "type": ["string", "number"] }, "when": {}, "latch": { "type": "boolean" },
                 "quant": { "type": "number", "minimum": 0 }, "unreached": {} } } ] },
    "param":   { "type": "object", "properties": { "min": { "type": "number" }, "max": { "type": "number" }, "default": {}, "unit": { "type": "string" } } },
    "arg":     { "description": "JSON literal, or {$param}, {$tap}, {$mini}, {$expr}, {$hook}, {$events}, {$curve}, {$code: 'arrow function text'}" },
    "step":    { "type": "array", "prefixItems": [ { "type": "string" } ], "items": { "$ref": "#/$defs/arg" }, "minItems": 1 },
    "def":     { "type": "object", "properties": { "params": { "type": "object", "additionalProperties": { "$ref": "#/$defs/param" } }, "taps": { "type": "object" },
                 "decorator": { "type": "boolean" }, "chain": { "type": "array", "items": { "$ref": "#/$defs/step" } }, "opaque": { "type": "boolean" }, "src": { "type": "string" } } },
    "assign":  { "type": "object", "required": ["value"], "properties": { "value": { "$ref": "#/$defs/arg" }, "gate": { "$ref": "#/$defs/gate" }, "priority": { "type": "number" },
                 "min": { "type": "number" }, "max": { "type": "number" }, "unit": { "type": "string" }, "ns": { "type": "string" } } },
    "binding": { "type": "object", "required": ["slot", "hook"], "properties": { "id": { "type": "string" }, "slot": { "type": "string" }, "hook": { "type": "string" }, "args": { "type": "object" },
                 "gate": { "$ref": "#/$defs/gate" }, "order": { "type": "number" }, "priority": { "type": "number" }, "else": { "type": "string" }, "rebase": { "type": "boolean" } } },
    "wire":    { "type": "object", "required": ["dest", "tap"], "properties": { "dest": { "type": "string" }, "tap": { "type": "string" }, "range": { "type": "array" }, "curve": { "enum": ["lin", "exp"] },
                 "op": { "enum": ["set", "add", "mul"] }, "gate": { "$ref": "#/$defs/gate" }, "default": {} } },
    "track":   { "type": "object", "required": ["name"], "properties": { "name": { "type": "string" }, "ns": { "type": "string" }, "stem": { "type": "string" }, "bus": { "type": "integer" }, "muted": { "type": "boolean" },
                 "source": { "$ref": "#/$defs/step" }, "chain": { "type": "array", "items": { "$ref": "#/$defs/step" } },
                 "src": { "type": "string", "description": "verbatim text; authoritative when chain is absent (opaque code node)" } } },
    "instance":{ "type": "object", "required": ["component", "as"], "properties": { "component": { "type": "string", "pattern": "^[A-Za-z][\\w-]*@[0-9]+$" }, "as": { "type": "string" },
                 "args": { "type": "object" }, "gate": { "$ref": "#/$defs/gate" }, "remap": { "type": "object", "additionalProperties": { "type": "string" } } } },
    "bank":    { "type": "object", "required": ["id", "rows", "cols"], "properties": { "id": { "type": "string" }, "name": { "type": "string" },
                 "rows": { "type": "integer", "minimum": 1, "maximum": 8 }, "cols": { "type": "integer", "minimum": 1, "maximum": 8 },
                 "scenes": { "enum": ["none", "row", "col"] }, "sceneQuant": {}, "sceneStopsEmpty": { "type": "boolean" }, "pads": { "type": "array", "items": { "$ref": "#/$defs/pad" } } } },
    "pad":     { "type": "object", "required": ["pos", "target"], "properties": { "pos": { "type": "string", "pattern": "^[0-7],[0-7]$" },
                 "target": { "type": "object", "required": ["kind", "ref"], "properties": { "kind": { "enum": ["component", "hook", "var", "tap", "scene", "action"] }, "ref": { "type": "string" }, "slot": { "type": "string" }, "value": { "$ref": "#/$defs/arg" } } },
                 "mode": { "enum": ["oneshot", "gate", "toggle", "retrigger"] }, "quant": { "type": ["string", "number"] }, "offQuant": { "type": ["string", "number"] }, "length": { "type": ["string", "number"] },
                 "choke": { "type": "integer" }, "colour": { "type": "string" }, "label": { "type": "string", "maxLength": 12 }, "args": { "type": "object" }, "velocity": {} } },
    "performance": { "type": "object", "required": ["length", "layers"], "properties": { "length": { "type": "string" }, "origin": { "type": "string" }, "until": { "type": "string" }, "bank": { "type": "string" },
                 "layers": { "type": "array", "items": { "type": "object", "properties": { "events": { "type": "array", "items": { "type": "object", "required": ["t", "pad", "type"],
                   "properties": { "t": { "type": "string" }, "pad": { "type": "string" }, "type": { "enum": ["on", "off"] }, "velocity": { "type": "number", "minimum": 0, "maximum": 1 } } } } } } } } },
    "control": { "type": "object", "required": ["type"], "properties": { "type": { "type": "string", "description": "id in the control type registry" },
                 "min": { "type": "number" }, "max": { "type": "number" }, "default": {}, "value": {}, "step": { "type": "number", "minimum": 0 },
                 "curve": { "enum": ["lin", "exp", "log", "db", "bipolar"] }, "unit": { "type": "string" }, "smooth": { "type": "number", "minimum": 0 },
                 "axes": { "type": "object", "additionalProperties": { "$ref": "#/$defs/param" } }, "options": { "type": "array" },
                 "count": { "type": "integer", "minimum": 1, "maximum": 64 }, "per": { "type": ["string", "number"] },
                 "ns": { "type": "string" }, "label": { "type": "string" }, "colour": { "type": "string" }, "render": { "type": "object" } } },
    "map":     { "type": "object", "required": ["control", "dest"], "properties": { "control": { "type": "string" }, "dest": { "type": "string" }, "range": { "type": "array", "minItems": 2, "maxItems": 2 },
                 "curve": { "enum": ["lin", "exp", "log", "db", "bipolar"] }, "op": { "enum": ["set", "add", "mul"] }, "gate": { "$ref": "#/$defs/gate" }, "priority": { "type": "number" } } },
    "board":   { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" }, "name": { "type": "string" },
                 "layouts": { "type": "object", "description": "keyed by column count, e.g. \"4\", \"12\"", "additionalProperties": { "type": "array", "items": { "type": "object", "required": ["ref", "x", "y"],
                   "properties": { "ref": { "type": "string", "pattern": "^(ctl|pad|meter):" }, "x": { "type": "integer" }, "y": { "type": "integer" }, "w": { "type": "integer", "minimum": 1 }, "h": { "type": "integer", "minimum": 1 } } } } } } },
    "lane":    { "type": "object", "required": ["control", "points"], "properties": { "control": { "type": "string" }, "length": { "type": "string" }, "period": { "type": ["string", "number"] },
                 "mode": { "enum": ["curve", "steps"] }, "absolute": { "type": "boolean" }, "priority": { "type": "number" }, "gate": { "$ref": "#/$defs/gate" },
                 "points": { "type": "array", "items": { "type": "array", "prefixItems": [ { "type": "string" }, {}, { "enum": ["hold", "lin", "exp"] } ], "minItems": 2 } } } },
    "exports": { "type": "object", "properties": { "params": { "type": "object", "additionalProperties": { "allOf": [ { "$ref": "#/$defs/param" } ], "properties": { "target": { "type": "string" } } } },
                 "taps": { "type": "array", "items": { "type": "string" } }, "slots": { "type": "array", "items": { "type": "string" } }, "hooks": { "type": "array", "items": { "type": "string" } },
                 "requires": { "type": "object", "properties": { "taps": { "type": "array" }, "markers": { "type": "array" } } } } }
  }
}
```

Rules:
- Canonical form: keys sorted, fractions as `"n/d"`, arrays in program order. `hash` = SHA-256 of the canonical text without `meta.hash`, `meta.rev`, `layout`.
- Names are unique per kind per scope. Graph node ids are derived, not stored: `track:bass`, `track:bass#2` (third step), `def:murk`,
  `tap:kick`, `var:root`, `slot:bass/fx`, `bind:b1`, `marker:drop`, `inst:pad2`.
- The schema file ships as `site/data/schema/model.v1.json`; site, CLI and tests validate against that one file.

## 6. Library

A **component** is a model document with `meta.kind` and an `exports` block:

| kind | contains | dropped in as |
|---|---|---|
| `fragment` | defs, vars, decorators; no tracks | hook-refs `lib:warmth@2(0.4)`, usable in `bind` and hook expressions |
| `track` | one track plus what it needs | one pattern: `hooks.inst("pad@3", { as: "pad2" })` |
| `set` | several tracks, bindings, wires | a stack of patterns under one namespace |
| `song` | everything including markers and journal | a whole program; opened, not instanced |

- **Exports**: `params` (name, range, default, unit, `target` such as `def:murk.hz` or `track:pad#2.0`), `taps`, `slots` (holes the host
  may bind into), `hooks`, and `requires` (taps and markers the host must supply, for example `kick`, `drop`).
- **Instance**: `hooks.inst("pad@3", { as: "pad2", args: { cutoff: 900 }, gate: "@drop", remap: { kick: "drums/kick" } })`.
  Everything inside is namespaced under `as`: `tap("pad2/env")`, `hooks.bind("pad2/fx", "murk")`, `hooks.set("pad2.cutoff", 1200, "@33b")`.
  `gate` gates the whole instance (closed = silent, or the instance's `else`). `remap` satisfies `requires`; an unmet requirement is
  `E_COMPONENT_REQUIRES`. Instances nest; a component cannot contain itself (`E_COMPONENT_CYCLE`).
- **Versions**: saving creates revision `rev + 1` with `parent` = previous hash; revisions are immutable. Identical content saves
  nothing (same hash). References are always pinned `name@rev`. "Update to latest" is an explicit edit that rewrites the pin and shows
  the changed exports.
- **Store**: the site keeps components in the history database, `window.strudelCraft.history.docs` (namespace `library`, own IndexedDB object
  store `docs`; keyed, revisioned documents: `put / get / list / revs / subscribe / delete`, async, not part of the timeline, undo/redo or search).
  The library contract stays synchronous: `site/library-store.js` (`docsStore`) serves reads from a memory copy hydrated from docs and writes
  through; that one file is the adapter. Node tests and browsers without IndexedDB use its in-memory + `localStorage` fallback store. Built (#58).
- **Headless**: a library is a directory `library/<name>/<rev>.json`. `strudel ... --library DIR`. A model exported with
  `components` embedded needs no library at all; renders use the embedded copies and verify their hashes (`E_COMPONENT_HASH`).
- Nothing in a component record identifies a person; `meta` has name, kind, rev, hash, parent, tags only.

## 7. Intellisense from the model

Same registry (`window.strudelCraft.intellisense.register`), one more provider, `model`, whose items are generated from the model and
the library index; the palette of the graph editor ("add node") lists the same items, so there is one catalogue.

| category | items |
|---|---|
| `variables` | each var as `tap("name")` target string, with value, range and windows in `info` |
| `decorators` | built-in and user decorators, with the `name(args)[...]` template in `apply` |
| `components` | `lib:name@rev` / `name@rev` strings; `info` = exports and requires |
| `instances` | `as/` prefixed slots, taps and params of each instance |
| `controls` | each control as `ctl("name")` / `tap("name")` with type, range and maps in `info`; control type ids with a spec template in `apply` |
| `pads` | pad addresses and bank names, for `pad:` destinations |
| `nodes` | node kinds for the graph palette (category only used by the graph) |

## 8. Worked examples

**1. Variable with a key change, used by two tracks**
```js
hooks.let("root", 48)
hooks.let("root", 51, "@17b")
$: note(tap("root").add("0 3 7 10")).s("sawtooth")
$: note(tap("root").sub(12)).s("triangle").struct("x*2")
```

**2. Reusable pattern variable, tapped twice**
```js
hooks.let("riff", note("c3 eb3 g3 bb3"))
$: tap("riff").s("sawtooth")
$: s("square").struct(tap("riff:onset")).note(tap("riff:note").add(12))
```

**3. Decorated binding**
```js
hooks.bind("fx", "every(4)[mix(0.3)[murk | pump(0.5)]]", "@9b")
```

**4. Component instance, gated and remapped**
```js
$: s("bd*4").tap("kick").ns("drums")
$: hooks.inst("pad@3", { as: "pad2", args: { cutoff: 900 }, gate: "drop..out", remap: { kick: "drums/kick" } })
$: s("hh*8").gain(tap("pad2/env").range(0.4, 1))
```

**5. The same thing as model JSON (what the graph and the library hold)**
```json
{ "model": 1,
  "markers": { "drop": "17b", "out": "49b" },
  "tracks": [ { "name": "kick", "ns": "drums", "source": ["s", { "$mini": "bd*4" }], "chain": [["tap", "kick"]] },
              { "name": "hat", "source": ["s", { "$mini": "hh*8" }], "chain": [["gain", { "$tap": "pad2/env", "range": [0.4, 1] }]] } ],
  "instances": [ { "component": "pad@3", "as": "pad2", "args": { "cutoff": 900 }, "gate": "drop..out", "remap": { "kick": "drums/kick" } } ] }
```

**6. Graph reading of example 4**: three track nodes; `tap:kick` on the first; a dashed gate wire `drop..out` from two marker nodes into
the `inst:pad2` component node; a thin signal wire from `inst:pad2` port `env` into the `gain` param port of the hat track.

## 9. Performance beatpad

A grid of pads that plays the model. A pad does not hold audio or a clip; it **fires a registry operation on a named thing**
(component, hook, variable, tap) at a quantised cycle. Because every pad action is a journal entry in cycle time, a performance is
data: it loops, overdubs, saves to the library and renders headless.

### 9.1 Banks (tabs)
- `pads.banks[]`: each bank is one tab (a page of pads), like sheet tabs: add, rename, duplicate, reorder, delete.
- Grid `rows x cols`, default 4 x 4; allowed 1..8 each. Pad address: `bank/r,c` (0-based, row 0 at the top).
- A bank is savable as a library component (`meta.kind: "bank"`), so pad layouts travel with the things they launch.

### 9.2 Pad targets: what a press does
| target kind | `ref` | on | off |
|---|---|---|---|
| `component` | instance name (`pad2`) or `name@rev` (instanced on first use as `as`) | open the instance gate | close it |
| `hook` | hook-expr, plus `slot` | `bind(slot, hook)` from the on cycle | close that binding |
| `var` | variable name, plus `value` | add an assignment `let(name, value)` from the on cycle | close that assignment (the previous value returns) |
| `tap` | tap name to publish | emit one event on tap `name`: onset at the on cycle, length = hold time (or `length`), value `{ velocity, ...args }` | ends the event |
| `scene` / `action` | `scene:N`, `record`, `overdub`, `undo`, `stop-all`, `bank:next`, `bank:prev`, `tap-tempo` | runs the action | - |

A `tap` pad is the finger-drumming case: the pad *is* a pattern source. Any track can read it:
`s("bd").struct(tap("pads/kick:onset"))`, `.gain(tap("pads/kick:velocity"))`. Nothing sounds unless the program reads the tap, so a pad
never adds an instrument the user did not write.

### 9.3 Per-pad config
| key | values | default | meaning |
|---|---|---|---|
| `mode` | `oneshot` \| `gate` \| `toggle` \| `retrigger` | `toggle` for component/hook/var, `gate` for tap | `oneshot`: on for `length`, release ignored. `gate`: on while held. `toggle`: press on, press again off (latch). `retrigger`: every press restarts the target at the on cycle (`rebase: true`), release ignored, ends after `length` if set |
| `quant` | `none` \| `beat` \| `bar` \| `cycle` \| number of cycles | `bar` (tap pads: `none`) | the on cycle is the next boundary at or after the press. `none` = the press time rounded to 1/96 cycle |
| `offQuant` | as `quant` | same as `quant` | boundary for the off cycle |
| `length` | point-style length (`"1b"`, `"2c"`, `"0.5s"`) | component length, else 1 bar | for `oneshot` / `retrigger` |
| `choke` | integer group, or none | none | an on in the group closes every other active pad of the group at the same cycle |
| `colour` | one of 12 named palette slots | by target kind | shown with the label and a state mark, never colour alone |
| `label` | text, up to 12 chars | target name | |
| `args` | object | - | params for the hook or component, extra fields for a tap event |
| `velocity` | `fixed` (0..1) \| `input` | `fixed: 0.8` | `input` uses the provider's velocity when it has one |

Same-cycle order is fixed: all offs and chokes, then ons, in bank, row, column order. So two pads pressed in one quant window always
resolve the same way.

### 9.4 Scenes (clip-launcher behaviour)
`bank.scenes`: `"row"`, `"col"` or `"none"` (default). With `"row"`: each row is a scene with a launch control at its end, and each
column is an implicit choke group (one thing per column sounds, as in a session grid). Launching scene N fires every non-empty pad of
row N and closes the active pads of other rows in those columns, all at one boundary (`bank.sceneQuant`, default `bar`). Empty pads in
the launched row leave their column untouched unless `bank.sceneStopsEmpty` is true. `"col"` is the transpose of this.

### 9.5 Looper: record, overdub, save
- A **performance** is `{ length, origin, layers: [ { events: [ { t, pad, type: "on" | "off", velocity } ] } ] }`. `t` is a cycle
  fraction relative to the loop start; `length` in cycles (default 4 bars); `origin` the absolute cycle the loop starts at.
- **Record**: arm, recording starts at the next bar, captures resolved pad events (after quantise and choke) for `length`, then loops.
  **Overdub**: adds a layer on each pass while armed. **Undo** drops the last layer. **Replace** clears layers and records one.
- Playback of a performance = its events applied as journal entries at `origin + k * length + t` for every `k >= 0` until the
  performance is stopped (`until`). This is a periodic gate, HOOKS_SYNTAX gate key `period`; nothing is unrolled.
- **Bounce to pattern** (performance -> code): tap-pad events become a pattern variable, quantised to a chosen grid (default 16 steps
  per bar): `hooks.let("pads/kick", {"$mini": "x ~ ~ x ~ ~ x ~ ..."})`; with `quant: none` they are stored as exact events, `{ "$events": [[begin, end, value], ...], "period": L }`. Hook/component/var pad events become
  `windows` + `period` gates on ordinary `bind` / `inst` / `let` lines. After a bounce the pads are no longer needed to play the result.
- **Save**: a performance saves to the library as `meta.kind: "performance"` (with the bank it was played on embedded, pinned), and
  every take is written to the history store, so a take can be recalled, dropped into another song and re-tapped like any component.

### 9.6 Input providers
A registry with the same shape as the intellisense one:

```js
const off = window.strudelCraft.input.register({
  id: 'keyboard',
  describe: () => ({ label: 'Computer keyboard', velocity: false, controls: [/* { id: 'kbd:KeyQ', label: 'Q' }, ... */] }),
  start: (emit) => { /* emit({ type: 'on' | 'off', control: 'kbd:KeyQ', velocity: 0.8, time: performance.now() }) */ return stop; }
});
```

- Control ids are strings with a provider prefix: `touch:r,c`, `kbd:<KeyboardEvent.code>`, later `midi:<port>/<ch>/note<N>`, `midi:.../cc<N>`.
- A **keymap** maps control id -> pad position in the active bank, or an action: `pads.keymaps[name] = { "kbd:KeyQ": "1,0", "kbd:Space": "action:record" }`.
  Several keymaps can exist; one is active per provider. Default keyboard map, by physical key (`event.code`, layout independent):
  rows `Digit1-4`, `KeyQ-R`, `KeyA-F`, `KeyZ-V` -> a 4 x 4 grid; `BracketLeft/Right` = bank prev/next.
- The keyboard provider is live only in **perform mode** (the Pads view has focus and Perform is on; `Esc` leaves), because the app
  already uses `1`-`4`, `A`, `C`, `O`, `T`, `J`, `K`, brackets and Space as shortcuts. Typing in any text field never fires pads.
- Providers now: `touch` (pointer events, multi-touch, the on-screen grid) and `keyboard`. Later, same registry, no pad-engine change:
  `webmidi` (pad controllers; note off, velocity, optional LED feedback through an optional `feedback(state)` method) and `gamepad`.
  Web MIDI is not available in every mobile browser, so it stays optional and feature-detected.
- Time: a provider reports `time` in `performance.now()` ms. The pad engine converts it once to a cycle position using the audio clock
  and the scheduler's cps, minus `pads.settings.latencyMs` (default 0, user-calibrated). From then on only cycles exist.

### 9.7 Headless
- A performance (or a song model containing performances) renders with no input devices:
  `strudel render song.strudel.js out/ --model model.json --bars 32`; `strudel perf model.json [--name TAKE] --bars 32` prints the resolved
  event list (`cycle, op, target, args`) as JSON. Two runs are identical; a rendered take equals the same take bounced to code.
- Live-only values never reach a file: quantised cycles are stored, not press times.

### 9.8 UI direction for pads (for ui-designer)
- A view `Pads` beside `Graph`. Bank tabs in a scrollable tab strip (a real tablist: arrow keys move, Enter selects), with "+".
- The grid fills the width on a phone; pads are square, never under 44 px, 4 x 4 comfortably thumb-reachable above the transport;
  8 x 8 scrolls or pinches rather than shrinking below the minimum. Multi-touch; no hover; no long-press needed to play.
- Pad states, each with a shape or mark as well as colour: empty, loaded, queued (waiting for its boundary), on, recording.
  Queued uses a countdown ring to the boundary; with reduced-motion a static mark and the beats remaining as text.
- Edit mode toggle: in edit mode a tap opens the pad's sheet (target picker fed by the intellisense registry, mode, quant, choke,
  colour, label). In perform mode a tap plays. The two are never mixed on one gesture.
- Looper strip: record, overdub, undo, length, a bar counter, Save. Scene launch controls at the row or column ends.
- Assigning from elsewhere: "Send to pad" on a library component, a hook, a var or a graph node.
- Budget: press-to-journal under 10 ms of main-thread work; visual feedback on the press frame; sound follows at the quantised cycle.

## 10. Controls and the producer control board

A **control** is a named reference in the model with a type, a range and a current value: a knob, fader, slider, XY pad, toggle,
button, step row. It can sit inline in code, on a board page, on a graph node, or on a hardware controller; it is the same control in
all four places. Underneath, **a control is a variable with a control manifest** (section 2), so it is read with `tap("name")`, gated,
scoped, tapped, saved and completed like everything else.

### 10.1 What Strudel already has (checked against the transpiler in 1.2.6)
- `slider(value, min = 0, max = 1, step?)`: the transpiler rewrites the call to `sliderWithID("slider_<source offset>", value, min, max)`
  and reports a widget `{ type: "slider", from, to, value, min, max, step }`. `sliderWithID` and the drawn widget live in
  `@strudel/codemirror`; they are not in `@strudel/core`, so in a host without that editor (this site's editor, the headless CLI) the call
  has no definition.
- `registerWidgetType(type)` exists for block widgets (inline visuals such as scope and pianoroll), not for input controls.
- `midin()` gives MIDI CC as patterns in the browser. There is no knob, XY, toggle or step control.

So: Strudel's `slider()` is supported as written, and every other type is ours.

- **Slider shim**: the host defines `sliderWithID(id, value, min, max)` (the documented contract of the transpiler, no Strudel change) to
  return the pattern of an anonymous control `id` of type `slider`. Strudel code using `slider()` then runs on the site and in the CLI,
  where the value is the literal in the code unless automation or `--set` overrides it.
- Strudel's slider id is a source offset, so it changes when code above it is edited. Anonymous sliders therefore cannot be mapped,
  automated or put on a board. Naming one (`ctl("cutoff", ...)`) is what makes it a model reference. The graph offers "Name this slider".

### 10.2 Code surface
```ebnf
ctl-call  = "ctl" "(" name [ "," ctl-spec ] ")" ;                 (* declares the control if new; returns its pattern, same as tap(name) *)
ctl-spec  = "{" "type" ":" type-id { "," key ":" value } "}" ;    (* keys of 10.3 *)
map-call  = "hooks" "." "map" "(" control-ref "," dest [ "," map-opts ] [ "," gate ] ")" ;
control-ref = name [ ":" axis ] ;                                 (* "pos:x" *)
dest      = hook "." param | instance "." param | var-name | layer "." param | "bind:" id ".when" | "pad:" pad-address ;
```

```js
$: note("c2*8").s("sawtooth").lpf(ctl("cutoff", { type: "knob", min: 200, max: 8000, curve: "exp", default: 800, unit: "Hz" }))
$: s("hh*8").pan(ctl("pos", { type: "xy" }).x).gain(tap("pos:y").range(0.3, 1))
$: s("bd").struct(ctl("kickrow", { type: "steps", count: 16, default: "x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x ~ x ~" }))
hooks.bind("fx", "murk", { when: ctl("murkOn", { type: "toggle" }) })     // a toggle is a gate condition, quantised by the gate
hooks.map("macro1", "murk.hz",   { range: [200, 4000], curve: "exp" })    // one control,
hooks.map("macro1", "pad2.cutoff", { range: [4000, 600] }, "@drop")       // several destinations, one of them only after the drop
```

- A second `ctl("cutoff")` with no spec reads the same control. Two different specs for one name: `E_CONTROL_CONFLICT`.
- Value kinds as patterns: number -> steady value; `toggle` / `button` -> 0 or 1; `xy` -> axes `name:x`, `name:y` (also `.x`, `.y` on the
  returned pattern); `steps` -> a pattern of `count` steps per `per` (default one cycle), with facets (`tap("kickrow:onset")`);
  `select` -> the option value.
- Limits as for taps: a control moves a param per event onset. `smooth` (in cycles) slews the value analytically between changes.

### 10.3 Control type registry
Types are data. A type can be declared now and drawn later; until a renderer exists it is shown with its `fallback` type.

```js
window.strudelCraft.controls.registerType({ id: "knob", value: "number", keys: ["min", "max", "default", "step", "curve", "unit", "smooth"],
  render: { fallback: "slider", minSize: 44 }, input: ["value", "delta"] });
window.strudelCraft.controls.registerRenderer("knob", (el, control, api) => { /* draws, calls api.set(v), returns dispose */ });
```

Shipped as `site/data/controls/types.json`, loaded into the registry at start; extra types register at runtime.

| type | value | keys beyond `label`, `colour`, `render` | fallback | drawn in the first build |
|---|---|---|---|---|
| `slider` | number | min, max, default, step, curve, unit, smooth, orientation | - | yes |
| `fader` | number | as slider; default curve `db` | slider | yes |
| `knob` | number | as slider, detent | slider | yes |
| `number` | number | min, max, default, step, unit | - | yes |
| `toggle` | bool | default | - | yes |
| `button` | bool, momentary | - | toggle | yes |
| `select` | enum | options[], default | - | yes |
| `xy` | vec2 | axes.x / axes.y (each min, max, default, curve), spring (return to default on release) | two sliders | yes |
| `steps` | array | count (1..64), per, values (bool or number per step), min, max | text field (mini-notation) | yes |
| `encoder` | number, relative | min, max, default, sensitivity | knob | declared |
| `ribbon` | number, touch-absolute, spring | as slider | slider | declared |
| `xyz` | vec3 (device motion) | axes.x / y / z | three sliders | declared |
| `keys` | notes | low, high | select | declared |
| `envelope` | ADSR vec4 | per-stage min, max | four sliders | declared |
| `curve` | breakpoints | length, min, max | text | declared |
| `meter` | read-only | source tap-ref, min, max | number | declared |

Common spec keys: `type`, `min`, `max`, `default`, `value` (current manual value), `step` (0 = continuous), `curve`
(`lin` \| `exp` \| `log` \| `db` \| `bipolar`), `unit`, `smooth` (cycles, default 0), `ns`, `label`, `colour`, `render` (free-form hints:
`size`, `orientation`, `detent`, `fallback`). A value is always stored in real units, never 0..1; the curve only shapes the travel.
Unknown type id: `E_CONTROL_TYPE` in strict check; live, the control works as `number`.

### 10.4 Mapping (learn)
Two hops, both data:

```
input control (touch:..., kbd:..., midi:.../cc74)  --keymap-->  model control (cutoff)  --maps-->  destinations (murk.hz, pad2.cutoff, root)
```

- `maps[]` entry: `{ control, dest, range: [lo, hi], curve, op: "set" | "add" | "mul", gate, priority }`. The control's travel 0..1 (after its
  own curve) is mapped onto `range` in the destination's units; default range = the destination's own `min..max`. Outside its gate a
  map does nothing and the destination keeps its own value. Several `set` maps on one destination: highest `priority`, then latest;
  `add` and `mul` compose on top in `maps` order.
- Destinations: a hook or module param, an instance's exported param, a variable, a `layer.param` (the mod-matrix destination format),
  a binding's `when` (toggle or button), a pad (button presses it).
- **Learn** (UI flow, no new model concept): choose Learn, touch the destination (a param in the graph, the inspector or a board cell),
  then move a control: on-screen -> a `maps` entry; hardware or key -> a keymap entry to the selected model control. Unlearn removes it.
- Keymaps (9.6) accept control targets as well as pads: `"midi:0/1/cc74": "ctl:cutoff"`, `"kbd:ArrowUp": "ctl:cutoff+0.05"` (step by 5 % of travel).
  Providers emit `{ type: "value", control, value: 0..1, time }` for absolute controls and `{ type: "delta", ... }` for relative ones,
  next to the `on` / `off` of pads.
- Soft takeover for absolute hardware: a hardware control only takes effect once it crosses the current value (`pads.settings.takeover`,
  default `pickup`; alternative `jump`).

### 10.5 The board
- `boards[]`: pages of laid-out references, shown as tabs **in the same tab strip as the pad banks** (a tab is a bank or a board).
- A board has a grid (`cols` 4 on a phone layout, 8 or 12 on desktop; rows grow) and cells `{ ref, x, y, w, h }` where `ref` is
  `ctl:name`, `pad:bank/r,c`, or `meter:tap-ref`. A board only places references; the control itself lives in `controls`, so one
  control can be on two boards, inline in code and on a graph node, and all move together.
- A board with responsive layouts stores one cell list per `cols` value it has been arranged for; missing ones are auto-flowed.
- Boards save to the library (`meta.kind: "board"`) with the controls and maps they reference.
- "Send to board" from any param in the graph, inspector or code (creates the control and the map in one step).

### 10.6 Automation
- Moves of a control can be recorded exactly as pad takes are (9.5): arm, record from the next bar for `length`, loop, overdub, undo.
- An **automation lane**: `{ control, length, period, mode, points: [[t, value, shape]], gate }`, `t` a cycle fraction from the lane
  start, `shape` one of `hold`, `lin`, `exp` to the next point. `mode: "curve"` keeps breakpoints; `mode: "steps"` quantises to a grid
  (default 16 per bar) and holds. On record end the raw moves are thinned once (Ramer-Douglas-Peucker, tolerance 0.5 % of the control
  range) and only the thinned points are stored, so what is saved is exactly what is rendered.
- Value of a control at cycle `c`: the open lane with the highest priority, else the manual `value`. Lane states while live:
  `read`, `touch` (manual overrides while held, lane resumes on release at the next `quant`), `latch` (manual holds until stopped),
  `write`. Files only ever contain `read` data.
- **Bounce to code**: a steps lane becomes a pattern variable (`hooks.let("cutoff", {"$mini": "<800 1200 ...>"})` or a segmented sequence);
  a curve lane becomes `{ "$curve": [[t, v, shape], ...], "period": L }`, a pure function of cycle time.
- Lanes save to the library (`meta.kind: "automation"`) and every take goes to the history store. A lane dropped onto another control
  is rescaled to that control's range unless `absolute: true`.
- Unrecorded live moves are not journaled (too dense, and not needed): a headless render uses each control's stored `value` plus lanes.
- Relation to #40 (section automation lanes): that node automates WAV-FX parameters in the mixdown after render. This one automates
  pattern-level controls before render. They share the point format `[t, value, shape]` so a lane can be exported to the other.

### 10.7 Headless
- `strudel controls IN.strudel.js [--model M.json]` prints every control: name, type, range, value, maps, lanes (JSON).
- `strudel render IN out/ --model M.json --set cutoff=1200 --set murkOn=1` overrides manual values for one run (deterministic sweeps).
- A render with lanes is a pure function of the model: two runs give identical event lists and identical `mix.wav` hashes.

### 10.8 UI direction for controls and boards (for ui-designer)
- One **Perform** area holds pad banks and boards as tabs in one strip, each tab marked with its kind by icon and text.
- Inline in code: a control call shows its control at the call (or, in a plain textarea editor, in a strip directly under the editor
  listing "controls in this program" in source order). Same component as on the board.
- Board edit mode: add from the palette (intellisense registry), drag or "Move to..." to place, resize by handles or by size presets
  (1x1, 2x1, 1x2, 2x2); perform mode locks layout. Phone: 4 columns, controls never under 44 px, faders at least 2 rows tall.
- Knobs: vertical drag with fine mode (second finger or Shift), double tap = default, long-press or Enter = type a value; arrow keys
  step, Page keys step x10; value and unit always shown as text. XY: crosshair with both values shown; keyboard arrows move it.
- Mapped state is visible on both ends (a control lists its destinations; a mapped param shows a link mark and the control name).
  Learn mode dims everything that is not a valid destination.
- Automation: a lane is drawn behind the control's value in the plan strip; a recording control has a mark and text, not colour alone.
- Types with no renderer show their fallback with a small "basic view" note, so nothing declared is ever invisible.

## 11. UI direction for the graph (for ui-designer)

Direction and constraints, not a layout. Phone first (390 px wide), then desktop.

- **Where**: a fifth view, `Graph`, beside Rack/Stack/Ref/Practice. Transport stays in the thumb zone. A code/graph toggle on the phone;
  side by side on desktop with selection sync (select a node, its code range is highlighted, and the reverse).
- **Navigation**: one-finger drag on empty canvas pans; pinch zooms 25% to 200%; double tap on a node zooms to it; a Fit button.
  Three semantic zoom levels: far = tracks and components as labelled pills with wires only; mid = nodes with ports; near = param
  values editable in place.
- **Wiring by touch, no drag required**: tap a port to arm it; compatible ports stay lit and get a label, incompatible ones dim; tap
  the target to connect; tap empty canvas to cancel. Dragging from a port also works, with the wire end offset above the finger and a
  snap radius of 24 px. Port touch targets are at least 44 x 44 px at mid zoom. A facet or range question (4.2) opens in the sheet.
- **Non-pointer path**: every node and wire is also in an outline list (same model), with "Connect to..." and "Move to..." actions, so
  everything is doable by keyboard and screen reader, and no action depends on dragging.
- **Inspector**: a bottom sheet for the selected node or wire. A binding wire shows gate (from/until with bar steppers and marker
  picker), order, priority, else, and a "swap at next bar" button while playing. A var shows its assignments as rows.
- **Collapse**: long-press starts multi-select, further taps add; actions: Collapse to subgraph, Save to library, Delete.
  A collapsed node shows only its exported ports; opening it pushes a breadcrumb (`Song / pad2 / fx`). Exporting a port is a toggle
  on the port inside the subgraph.
- **Add**: one "+" control opens a palette fed by the intellisense registry (section 7), searchable, grouped by category.
- **Plan strip**: collapsible strip above the transport showing open windows per slot and variable against bars; the playhead is the
  same one as the lanes.
- **Feedback**: gate badges show open/closed; pattern wires pulse on onsets; with reduced-motion set, state is shown without animation.
  Errors from HOOKS_SYNTAX section 6 appear on the node or wire that caused them, with the code and a one-line reason.
- **Budget**: pan and zoom at 60 fps with 150 nodes and 300 wires on a mid-range phone (frame time measured in the site smoke test);
  the graph view loads on first open, not with the shell. Rendering technique (SVG, canvas or a mix) is the ui-designer's call.
- Undo/redo covers graph edits and code edits in one stack, because both are model ops.

## 12. Phases

| phase | issue | deliverable | depends on | owner | state |
|---|---|---|---|---|---|
| P1 | #47 | hooks core: slots, bindings, gates, journal, config JSON, CLI `--hooks` / `hooks` | - | daw-implementer | built (`site/engine/hooks.js`) |
| P2 | #48 | taps, `wire`, modules, variables, decorators | P1 | daw-implementer | built (same file) |
| P3 | #49 | model schema file, code <-> model parser and generator, `strudel model` | P1, P2 | daw-implementer | built (`site/model.js`, `data/schema/model.v1.json`; the `strudel model` CLI lives in the CLI repo) |
| P4 | #50 | library: components, instances, versions, history adapter, `--library` | P3 | daw-implementer | built (`site/library.js`, `site/library-store.js`; `hooks.inst` and `lib:` hook-refs on the runtime) |
| P5 | #51 | intellisense providers `hooks` and `model` | P1 (grows with P2-P4), registry on `main` | daw-implementer | built (`site/hooks-intellisense.js`) |
| P6 | #52 | graph editor view | P3 (library actions need P4) | ui-designer | built (`site/graph.js`, view 7) |
| P7 | #53 | pad engine: banks, pad targets and modes, quantise, choke, scenes, looper, input-provider registry (touch, keyboard), `strudel perf` | P2 (component pads and save need P4) | daw-implementer | built on the site (`site/engine/pads.js`); `strudel perf` is CLI work |
| P8 | #54 | controls engine: control type registry, `ctl`, slider shim, `hooks.map`, automation lanes, `strudel controls`, `--set` | P2, P7 (input registry, recorder) | daw-implementer | built on the site (`site/engine/controls.js`; maps are applied to queried events); CLI subcommands are CLI work |
| P9 | #55 | Perform views: pad banks and boards in one tab strip, inline controls, learn, automation record | P7, P8 | ui-designer | built (`site/perform.js`, view 5) |

Later, not issued: `webmidi` and `gamepad` input providers (same registry).

## 13. Open questions

1. **History store API.** `window.strudelCraft.history` is not on `main`; section 6 lists the five calls needed. If its record shape
   differs (for example no revisions), does the library keep its own revision chain inside one history record?
2. **Parser weight on the site.** acorn is about 120 kB unminified. Load it only with the graph view, or write a small chain parser
   for the structured subset and treat the rest as opaque? The first is safer for correctness.
3. **Arrow-function arguments** (`.every(4, x => x.fast(2))`) are kept as `$code` text. Should the graph open them as nested
   subgraphs when the body is itself a plain chain?
4. **Component params that target a step literal** (`track:pad#2.0`) break if the component's chain is reordered in a later
   revision. Pinning protects instances; should exports be required to target named things (vars, def params) only?
5. **Instance gates and tails.** A closed instance gate stops new events; ringing notes and reverb tails continue. Is an explicit
   release or fade option needed on the instance?
6. **Plan strip editing.** Dragging a window edge is described as a gate edit. Is that enough timeline for arrangement work, or is a
   section view over `arrange` (#25) still wanted next to it?
7. **Inline controls in the site editor.** The site editor is a plain textarea, so inline widgets cannot sit inside the text; 10.8
   puts them in a strip under it. Is moving to an editor with inline widgets wanted (a separate UI issue), or is the strip enough?
8. **Control value vs code literal.** When a named control's value changes, should the `default` in the `ctl(...)` call be rewritten
   (code always shows the sound) or stay as written with the value only in the model (code stays stable)? This design does the second.
9. **Pad latency.** `latencyMs` is one user-set number. Is a tap-along calibration screen wanted, and per provider?
10. **Unquantised tap pads on a phone.** Touch timing jitter is several ms; is 1/96-cycle rounding the right floor, or should tap pads
   default to a 1/16 grid?
11. **Sharing.** A model with embedded components can be large for a URL hash. Share by file only, or add a compact link form later?
