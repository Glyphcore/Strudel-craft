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

Caret placement stays free in every state (invalid, dirty, live swap, playing): no decoration, marker or tooltip takes pointer events
from the text (signature help is `pointer-events: none`, lint marks are plain marks), the validation path never dispatches a selection,
and visual decorations (active-event highlights, inline widget placement) only dispatch when their content changes and wait while a
pointer is down in an editor (+300 ms), because a transaction that races a tap's pending DOM selection made the caret snap back.
Test: `node tests/site/binding.mjs` (taps at several positions in the error state, after it clears, after a value menu opened, broken
and valid code while playing).

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
- **Opening**: the menu opens from the pointer event itself (pointerup of a tap, or a long-press), resolving the node from the tap
  coordinates (`posAtCoords` + `literalAt`), never from focus, blur or selection changes. So it works with the editor focused and the
  caret already inside the node. A tap on another literal switches the menu, a tap on the same literal toggles it, a tap on plain code
  closes it; the × button and Esc dismiss it. Opening never calls `focus()`, so the soft keyboard is not forced up. The node is
  re-resolved on every tap and every edit is applied by id, so menus keep working after live swaps and re-derivations. Informational
  tooltips (signature help) are `pointer-events: none` so they never swallow taps.
- **Live apply**: every typed editor applies as soon as a value is chosen, with no confirm tap: piano keys and octave -/+ (octave
  keeps the pitch class and accidental: `eb3` -> `eb4`; the shown note name and the source change together; the popover stays open),
  combobox and sound list options, chips, toggle, and each step chip as you type. The number scrub commits on release.
- Each edit is one CodeMirror change covering only the literal span (chips: only the group's inner span), tagged `input.literal`;
  it flows through the settle scheduler, so one compile and one history commit per settled edit.

## 8. Reference inspector (`site/refs.js`)

One shared service, `window.strudelCraft.refs`, for every surface (inline strip, board, pads, graph cards; atoms, packs and hooks later):

| call | returns / does |
|---|---|
| `resolve(id)` | `{ id, kind: 'control' \| 'literal', view, site \| literal, off }`; accepts site ids, literal ids and label aliases (`controls.resolve`) |
| `related(id)` | `{ spans, ids, dests, slot }`: the mapped param (the call name the site sits in), explicit map dests (`.dest(` and `hooks.map` lines), the hook slot string, `tap('label')` sites, other controls with the same label |
| `highlight(id \| null, { scroll, editor })` | marks the source span (`.cm-ref-primary`, soft background) plus a gutter indicator (`.cm-ref-gutter`), tints related spans in the same colour (`.cm-ref-related`), scrolls the span into view, and adds `.ref-glow` / `.ref-glow-rel` to every element carrying the id; fires `refs:highlight` |
| `describe(id)` | `{ id, path, label, type, shape, value, range, maps, slot, view }` |
| `tip(el, id)`, `hideTip()`, `clear()` | the tooltip; `clear` drops every mark and glow |

Elements opt in with `data-site`, `data-ctl`, `data-id` or `data-ref` set to an id or label (pads and graph cards use `data-ref`).

- **Select**: pointerdown or focus on such an element highlights it. **Inspect**: long-press 450 ms on touch, hover 350 ms with a mouse,
  or keyboard focus opens `#scRefTip` (`role=tooltip`, fixed position, so no layout shift). The element gets `aria-describedby="scRefTip"`.
  Escape, the dismiss button or a tap elsewhere closes it.
- **Reverse**: the caret or a tap inside a control call, or inside the param call that holds it (`lpf(slider(800...))`), makes the
  matching controls glow and marks the span. Site offsets are mapped from evaluated source to editor text (`binder.source(view)`).
- Theme: `--sig-2` and its soft variant; related items use the same colour, dashed. Test: `node tests/site/binding.mjs`
  (long-press a knob: tooltip id + path, span and gutter marked; tap a literal: its control glows).

## 9. Range spec (numeric controls and atom params)

No control assumes 0..1. Each numeric control carries `{ min, max, step, unit, curve: lin|log|exp, clamp: hard|soft|none }`.

Precedence (highest first): user override per AST id (`perform` model `ranges[<id>]`, persisted in `sc.perform`) > code literal
(`slider(v, min, max)`) or `ctl` spec > param shape (`strudel.json` `params`, which now carry `clamp`; `rangeSpec` documents the keys)
> 0..1. Clamp default for code sites is `soft`.

- `hard`: values are clamped into the range; `soft`: slider travel stays in range, typed values may go beyond; `none`: no bounds.
- **Exact entry**: tap the number on a knob, slider or fader (or "Set value…" in the control's sheet, or Enter on it) to open a
  site modal (never a native prompt). It is unit-aware and accepts values outside the range; "Extend range to fit" widens min/max to
  include the value and saves that as the override. A range hint (`Range 0 to 1 · clamp soft`) is shown in the modal, and under every
  numeric control (`0 to 1 Hz · soft`).
- **Range editing**: "Range (min, max, step)…" in the control's sheet edits min, max, step, unit, curve and clamp; "Shape default"
  drops the override.
- **Parsing** (`controls.parseValue(text, { unit })`, exported from `engine/controls.js`): `1.5k` -> 1500, `-6 dB` -> -6, `2:30` -> 150
  (seconds; 2.5 when the unit is `min`), `250ms` -> 0.25 s, `90s`, `1h`, `50%` -> 0.5.
- Applies to inline widgets and board knobs (same renderers), pad values (pad sheet "Value", parsed the same way) and the transport:
  loop start/end accept cycles, bars or m:ss (transport-range.js converts with the live cps), and the play-time limit is parsed with
  `parseValue` (`20`, `2:30`, `90s`, `1h`); above its 600 min range it offers "Extend range to fit".
- Engine: `controls.setRange(id, r)` (null deletes a key), `redeclare` keeps values unless the clamp is `hard`.
- Test: `node tests/site/binding.mjs` (typing 5000 into a 0..1 slider extends the range and persists it per id; parser cases).

## 10. Node-aware accept (ghost text Tab and popup completions)

`mergeAccept(doc, pos, text, { from })` in `site/inline.js` computes one change for any accept:
- **Popup** (`from` = start of the typed prefix): the whole node under the caret is replaced, i.e. the identifier or call name, the
  arg literal or the mini-notation token (`[\w$]` outside quotes, token chars inside), not only the prefix: caret in `lp|f` + `lpf`
  gives one `lpf`; caret in `8|00` inside `lpf(` + `2000` gives `lpf(2000)` (explicit Ctrl+Space shows the whole shape list).
- **Ghost text** (no `from`): the suggestion continues at the caret.
- **Merge**: the rest of the suggestion after the node is matched against the text already after it; existing `(`, `)`, quotes,
  arguments and closers are consumed, not re-inserted (`lpf()` + `(800)` gives `lpf(800)`). A chain call such as `.decay(0.1)` that is
  already present later in the statement is dropped from the suggestion.
- **No-op**: if the result equals the text already there, nothing changes and the caret moves past the node.
- One CodeMirror transaction (`input.complete`), so one undo step and one settle run (one compile, one history commit); the ghost text
  is recomputed afterwards against the new document, never batched.
- Test: `node tests/site/binding.mjs` (prefix partial, caret mid-token, already complete, existing parens, arg value swap, chained
  call already present, one-step undo).

## 11. Suggestions are inert until accepted; auto-dismiss

Ghost text, the autocomplete popup, arrow-key highlight in it and Ctrl/Alt+] cycling only render decorations and widgets. Until Tab or
a tap accepts: the document, undo stack and history are unchanged; nothing is poked to the settle scheduler (no dirty dot, validation,
compile, live swap or control/AST-id re-derivation); mappings, workspace and the learned suggestion list (`sc.intellisense.user`,
learned only from document text) are untouched. Accept is the single transaction (section 10).

Auto-dismiss, with no side effects: a tap or click anywhere outside the ghost chip or the popup (in the editor, outside it, another
control, panel or tab); caret moves (tap, arrows, selection) off the anchor; editor blur; editor or page scroll beyond 24 px; hash/view
changes, any `<details>` toggle or an opened `<dialog>` (modal, sheet, palette); Esc; 5 s idle. They come back only on new typing or
an explicit trigger (Ctrl+Space), never on focus alone; the Tab chip lives in the ghost widget so it disappears with it.
`strudelCraft.intellisense.dismissSuggestions()` dismisses programmatically; `intellisense.ghost.show(view, alts)` shows one (tests,
providers). Test: `node tests/site/binding.mjs` (show + cycle: doc, history length, compile/poke/eval counters, dot and learned list
unchanged; Tab: one change, one history commit, one compile; tap elsewhere dismisses; typing brings it back).
