# Perform presets and outputs (#56 tracker, perform mode)

Informative reference for `site/perform-presets.js`, `site/perform-outputs.js`, `site/data/perform/presets.json` and the Perform view (`site/perform.js`).

## 1. Preset format `perform-presets@1`
```json
{ "format": "perform-presets@1", "presets": [{
  "id": "beatpad-4x4", "title": "Beatpad 4x4", "about": "one line",
  "perform": true, "takeover": "jump",
  "keys": { "Space": "0,0", "KeyJ": "0,1" },
  "bank":  { "rows": 4, "cols": 4, "scenes": "row", "pads": [{ "pos": "0,0", "target": { "kind": "tap", "ref": "kick" }, "label": "kick", "color": "#2ed3c6" }] },
  "board": { "cells": ["cut", { "from": "lanes", "type": "fader", "min": 0, "max": 1.5, "default": 1, "dest": "{lane}.gain" }], "size": { "*": "2x1" } } }] }
```
- `id` `[a-z0-9._-]`, `title` 1-40 chars. At least one of `bank`, `board`. `bank.rows`/`cols` 1-8; pad `target.kind` is one of var, hook, tap, component, action, scene, selection (same pad model as the pad sheet).
- `keys`: key code (`event.code` without `kbd:`) to pad position `r,c` or `action:...`; when present it replaces the default digit/letter map (the bracket bank keys stay).
- `takeover`: `jump` (a moved control takes the value at once) or `pickup` (a hardware control must cross the current value first); applies to input events, on-screen drags always jump.
- Board `cells`: a control name, or a selector `{from: "lanes" | "maps" | "all"}`. `lanes` = one control `mix_<lane>` per `lane:` label in the program, mapped by one `hooks.map('mix_<lane>', '<lane>.gain')` line written to the playing editor (the same as Learn). A lane-qualified dest `<lane>.<param>` touches only the events of that `lane:` label (the engine stamps `hap.context.lane` when the label's `.p(id)` runs) and only those; `gain` alone still maps every event. The fader scales that lane's own `gain` event value (lane events only, not a bus/orbit gain node, so a `.send`/`ret` path downstream of the lane's events is unaffected); a lane that sets no `gain` is mapped from superdough's default. Measured by `tests/site/perform_mix_audio.mjs` (kick fader 0 / 1.5 moves the kick lane -47 dB / +3 dB, the bass lane stays within 0.1 dB); `maps` = controls that already have a hooks.map line (all knobs when none); `all` = every control. `size` `{"*": "2x1"}` or per name (`1x1`, `2x1`, `2x2`).
- Applying adds or replaces the tabs `pb-<id>` (bank) and `pn-<id>` (board); the user's own tabs are never touched.

## 2. Built-ins, user presets, pack kind
Built-ins: `data/perform/presets.json` (Beatpad 4x4, Mixer faders per lane, Macro knobs for the hooks, Minimal). User presets: `localStorage sc.perform.presets` (`{format, presets}`). Export/Import use the same document (a single preset or a list is accepted on import, ids that clash get `-2`).
The shape follows the craftpack list kinds (`layouts`, `recipes`), so a `perform-presets` ingredient kind is listed in PACK_SPEC section 5 as **coming**: no second mechanism, a pack would add presets to the same list.
API: `strudelCraft.perform.presets.{list, apply(id|preset), save(title), exportJSON(), importJSON(text), open()}`.

## 3. Outputs and sources
Every pad and control of the open tab is an output row under `Outputs and sources`. Tap a row to reveal: the code line it reads or writes (pad: first match of `tap('x')`, `hooks.bind(slot, 'x')`, `hooks.let('x')`, `hooks.inst('x')`, else any quoted `'x'`; control: its site path), a one-line explanation, `Go to code` (the deliberate jump, #107) and `Show in graph` (the graph node with that label glows; the view switches to Graph when it is not open). Pressing a pad or revealing a row never scrolls the editor.
- **The 2-hit output.** A tap pad (`kind: tap`, mode gate) is one hit = two journal entries: `tap` on press and `tap-end` on release, written to `hooks.journal` as `pad:tap`, `pad:tap-end`. The hooks runtime journals but does not apply them, and the editor holds no `tap("x")` unless you wrote one, so a tap pad nothing reads shows no syntax in Perform and did nothing audible while the graph still showed the program's drum nodes. Such pads are now marked `∅` / `unread`, counted in the summary and toast once; Bounce a take to code (`hooks.publish('x', ...)`) or add `.tap("x")` to give it a reader.
