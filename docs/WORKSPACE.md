# Transport range, workspace and command palette

## Transport range (`site/transport-range.js`)
- Readout: `c <cycle> / <end cycle> · <elapsed m:ss> / <end m:ss>`, then `<m:ss> left`. End = loop End when Loop is on, else the clamp end projected from the current position (`cycle + remaining_s * cps`).
- Units: cycles are canonical. `bar = cycle + 1` (1 cycle = 1 bar of 4 beats on this site); `seconds = cycle / cps`. Inputs accept `m:ss` in any unit, or a number in the current unit. Display re-converts when cps changes.
- Seek: Strudel 1.3.0's default `Cyclist` has no `setCycle` (only the worker `NeoCyclist`). Each tick queries `[lastEnd, num_cycles_at_cps_change + ticks*dur*cps]`, and with `num_ticks_since_cps_change = 0` the next tick re-anchors `num_cycles_at_cps_change = lastEnd` at the current clock time. Seeking sets `lastEnd` and zeroes the tick count; `setCycle` is used when present.
- Loop: an accessor on the scheduler's `lastEnd` wraps to Start (carrying an overshoot under 0.1 cycle) inside the tick, so no query passes End; entering the loop from outside jumps straight to Start.
- Clamp: per-run play time, default 20 min (`sc.range.maxMin`), fade (4 s) or hard stop (`sc.range.atLimit`), `+5 min` override shown in the last minute and during the fade.

## Workspace (`site/workspace.js`)
Layout = rows of panes `{id, w, c}` (`w` flex weight, `c` collapsed). Panes move the existing panel DOM in (a comment marker keeps their home; Exit restores them). Defaults: Code, Perform, Visual, Full studio (`Alt+1..4`). Saved layouts: `sc.ws.configs` (history-versioned); the current one is `sc.ws.current`.

## Command palette (`site/palette.js`)
Chord `sc.palette.chord` (default `Ctrl+K`). Ranking: prefix > word prefix > substring > fuzzy subsequence (consecutive runs score higher). `strudelCraft.palette.register({id, title, group, keys, run})` returns an unregister function.
