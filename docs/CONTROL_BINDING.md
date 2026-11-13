# Control binding: typed params, AST-bound controls, inert validation

Status: built (site). Extends BLUEPRINT section 10 (controls) and section 7 (intellisense). Code: `site/engine/bind.js` (pure, no DOM),
`site/engine/settle.js` (scheduler), wiring in `site/app.js`, `site/perform.js`, `site/intellisense.js`, `site/visuals.js`.
Test: `node tests/site/binding.mjs` (Playwright, 360px).

## 1. Typed parameters (intellisense)

`site/data/intellisense/strudel.json` gains a `params` map: function or method name -> ordered list of params. Each param has a
`shape`:

| shape | keys | suggestions in that arg position |
|---|---|---|
| `number` | `min max default unit curve step range control presets` | preset values in range, `slider(def, min, max)`, `ctl('name', {type, min, max, curve, unit})`, `sine.range(min, max)` |
| `note` | | note names / chords (inside quotes) |
| `mini` | `examples` | mini-notation examples |
| `sound` | | sound names (static list + `soundMap` after Strudel loads) |
| `enum` | `options` | the options only |
| `bool` | | `true`, `false` |
| `pattern` | `examples` | signals and pattern functions |
| `control` | | names of declared controls |

Merging at load (`intellisense.js`):
- `range: "cutoff"` pulls `min/max/base` from `data/mod_ranges.json` (same table the hooks runtime uses); explicit keys win.
- `control` must be a type id in `data/controls/types.json`; unknown ids fall back to the registry fallback chain, then `knob`.
- When the cursor is inside `fn(` at argument `i` and `params[fn][i]` exists, only that shape's options are offered (no generic list).
  Unknown functions keep the old generic providers.
- Signature help: a tooltip above the call shows `fn(a, b)` with the active param bold, plus unit and range.

## 2. Control identity

A **control site** is a call `slider(...)` or `ctl(...)` in the program. Sites are found with acorn 8.19.0 (vendored, unmodified,
`site/vendor/acorn-8.19.0.mjs`, the same parser the graph uses) on the exact text that will be evaluated.

Structural path, outer to inner:

```
L<statement index> / <segment> > <segment> ... [~<n>]
segment = <call chain>#<arg index>      call chain = method names from the chain root, joined with "."
```

Example: `$: note("c e").s("saw").lpf(slider(800, 20, 20000))` (first statement) -> `L0/note.s.lpf#0`.
Nested: `stack(a, note("c").lpf(ctl('cut')))` -> `L0/stack#1>note.lpf#0`. Duplicate paths get `~1`, `~2` in source order.

**Id** = `k` + 6 base-36 chars of FNV-1a(path) at first sight (e.g. `k3f9a0c`); on clash a suffix is added. The id is then
**kept** by reconciliation; it is not recomputed from the path, so a site keeps its id when it moves.

Also stored per site: `param` (the method whose argument it is, e.g. `lpf`), `arg`, `kind` (`slider` | `ctl`), `label`
(ctl's first argument, or none), literal `value/min/max` or `spec`, `slot` (when the enclosing call is `.use/.wrap/.tap` with a string
first argument, or `hooks.bind`), and source `start/end`.

### Reconciliation (each successful compile)

Previous sites (last good compile of that view) vs new sites:
1. **Path match**: same path and kind -> same id.
2. **Structural match**: same `kind` + `param` + `arg` (the signature), cost = |layer diff| * 1000 + |source offset diff|; greedy
   lowest cost first. Covers inserted lines above, an extra `.gain()` earlier in the chain, a renamed variable.
3. **Positional match**: same kind, same layer, nearest offset (covers editing the method name, `lpf` -> `hpf`).
4. Else a new id; unmatched old sites are dropped from the strip (their control and mappings stay in the model, so undo brings them back).

Values: the controls engine is keyed by id, so a matched site keeps its value. If the **literal** default in the code changes
(`slider(800` -> `slider(1200`) that is intent and the value follows the new literal. Range edits re-declare the spec and clamp.

### Rewrite

Before evaluation, sites are rewritten in place (from the end of the text): `slider(a, b, c)` -> `sliderWithID('k3f9a0c', a, b, c)`
and `ctl(a, b)` -> `ctlAt('k3f9a0c', a, b)`. Strudel's own transpiler then never sees `slider(`, so its positional `slider_<offset>` id
is not used. Single quotes keep the id a plain string (double quotes become mini-notation).

## 3. Associations

- **Control -> param**: implicit from `param` (a site inside `.lpf(` drives that lpf argument). Explicit maps (`controls.map`) store
  `{control: <id>, dest}`; dests are params (`lpf`), hook refs (`fx.gain`) or `slot:<name>`.
- **Control -> hook slot**: `slot` from the enclosing `.use('fx', ...)`/`hooks.bind('fx', ...)`; shown under the control.
- **Pads and boards**: board cells and pad targets reference control ids, never labels. Because ids survive edits, nothing has to be
  remapped while typing. A cell whose id is not in the current code shows "not in code" and keeps its value.
- **Labels**: `ctl('cut')` shows `cut`; slider sites show `<param>·<arg>` (e.g. `lpf·0`). Labels are display only; two sites may share a label.

## 4. One scheduler (settle)

`createSettle({ quiet: 350, maxWait: 1500 })` in `site/engine/settle.js`, one instance on `strudelCraft.settle`.
- `poke(view)` on every input, preset load, tab switch, restore. It marks the view dirty (chip dot amber) and restarts the quiet timer;
  `maxWait` forces a run during continuous typing.
- A run takes a new token; any in-flight run with an older token stops at its next phase boundary (stale compiles are cancelled, their
  results never applied).
- Phases, in order, all in the same run: **validate** (acorn parse) -> **derive** (sites + reconcile, not yet committed) -> **compile**
  (live swap when this view is playing; idle evaluate when stopped, which never starts audio) -> **apply** (commit sites, re-render
  the strip in place, place visuals) -> **history** (commit `editor change`).
- `stats` = `{ pokes, runs, compiles, cancelled }` for tests.

## 5. Inert while invalid

When validate or compile fails: the editor gets a lint underline and a gutter marker, the chip dot turns red and the message is in
the chip title and the diagnostic tooltip. Nothing else changes: the playing pattern, the controls strip, values and mappings stay
on the last good compile. No message row is inserted (no layout shift); no overlay covers code or controls.

## 6. Without Play

Strudel loads at boot. Every settled run on a stopped transport evaluates the program with `repl.evaluate(code, false)` (no
autostart): controls are declared, inline `_pianoroll` etc. get their canvases and are painted once from the queried events
(cycles 0..2, static); they animate once Play starts. Controls render from the AST even when Strudel is offline.

## 7. Smart parameter spec (literal editors)

Every literal AST node gets an inline editor chosen from its param shape. Code: `site/literals.js`; literal sites from
`literals(code)` in `site/engine/bind.js`; data in `site/data/intellisense/strudel.json` (`params` + `editors`).

### Literal sites
`{ id, path, kind, param, arg, from, to, value, group?, str?, mod? }`
- `kind`: `number` (incl. `-n`), `boolean`, `string` (whole literal), `token` (one mini-notation token inside a string).
- `path`: same structural path as control sites plus `[i]` for array elements and `@n` for the n-th token in a string; `~k` on duplicates.
- `id` = `l` + 6 base-36 chars of FNV-1a(path). Ids are recomputed per parse (literals are not reconciled; control sites are).
- `group` (tokens): innermost `[...]`, `<...>` or `{...}` span; `chord: true` for `[a,b,c]`. `mod: true` for modifier operands (`*2`, `@3`, `:1`).

### Spec schema (`editors` in strudel.json)
```json
{ "byShape":  { "<shape>": "<editor>" },          // number: scrub, enum: combobox, sound: list, note: piano, bool: toggle, mini: steps
  "byGroup":  { "chord": "chips", "alt": "chips" }, // set / multi-value tokens
  "gestures": { "scrubPx": 240, "finePx": 1200, "longPressMs": 450, "tapSlopPx": 5, "pinch": true },
  "defaults": { "number": { "min": 0, "max": 1, "curve": "lin" } },
  "pools":    { "note": ["c", "db", ...] } }
```
Param keys used by editors: `min max step unit curve` (number travel via the controls engine curves `lin|exp|log|db|bipolar`),
`options` (enum, chips pool), `examples` (mini/pattern). Numbers without a param get a range derived from the literal.

Editor choice order: registered providers -> number `scrub` / boolean `toggle` -> chord or `<...>` token `chips` -> whole string
`steps` -> `byShape[param.shape]`. Extension:
`strudelCraft.literals.registerEditor({ id, match(lit, param) -> editorName|null, render?(host, { lit, param, set, close, view }) })`.

### Gestures and edits
- Tap: opens the compact popover (position: fixed, below or above the literal, never in flow, so nothing shifts). Long-press opens
  it with focus. Escape or a tap outside closes it.
- Number literal: horizontal drag scrubs the travel (`scrubPx` per full range), vertical drag adds fine control (`finePx`), two-pointer
  pinch scales the travel (log2 of the pinch ratio * 0.25). A value badge shows during the gesture; the source is rewritten **once**
  on release. Alt+Up/Down nudges the number under the caret (Shift = x10).
- Without the caret: `strudelCraft.literals.set(id, text)`, `.nudge(id, steps)`, `.open(id)`, `.list(viewId)`; control surfaces and
  key maps bind to literal ids the same way controls bind to site ids.
- Each edit is one CodeMirror change covering only the literal span (chips: only the group's inner span), tagged `input.literal`;
  it flows through the settle scheduler, so one compile and one history commit per settled edit.
