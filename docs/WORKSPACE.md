# Transport range, workspace and command palette

## Transport range (`site/transport-range.js`)
- Markup: `TPL` in `transport-range.js` is the source; `index.html` ships the same markup inside `#trange`, so the stage has its final height at the
  first paint (#59, no layout shift) while the script loads after the first frame. If the two differ, the script rebuilds from `TPL` and sets
  `data-rebuilt` (`tests/site/smoke.mjs` fails on it): edit both together.
- Readout: `c 12.0/64.0·00:24/02:08`, then `19:36 left · played 00:24 · paused 00:02` (cycle / end cycle · elapsed / end time). Cycles always show one decimal (`3.0`, never `3`); clocks are `mm:ss` (`h:mm:ss` from an hour, `mm:ss.s` in inputs and the record timer). End = loop End when Loop is on, else the clamp end projected from the current position (`cycle + remaining_s * cps`).
- Units: cycles are canonical. `bar = cycle + 1` (1 cycle = 1 bar of 4 beats on this site); `seconds = cycle / cps`. Inputs accept `m:ss` in any unit, or a number in the current unit. Display re-converts when cps changes.
- Seek: Strudel 1.3.0's default `Cyclist` has no `setCycle` (only the worker `NeoCyclist`). Each tick queries `[lastEnd, num_cycles_at_cps_change + ticks*dur*cps]`, and with `num_ticks_since_cps_change = 0` the next tick re-anchors `num_cycles_at_cps_change = lastEnd` at the current clock time. Seeking sets `lastEnd` and zeroes the tick count; `setCycle` is used when present.
- Loop: an accessor on the scheduler's `lastEnd` wraps to Start (carrying an overshoot under 0.1 cycle) inside the tick, so no query passes End; entering the loop from outside jumps straight to Start.
- Clamp: per-run play time, default 20 min (`sc.range.maxMin`), fade (4 s) or hard stop (`sc.range.atLimit`), `+5 min` override shown in the last minute and during the fade.

## Workspace (`site/workspace.js`)
Layout = rows of panes `{id, w, c}` (`w` flex weight, `c` collapsed). Panes move the existing panel DOM in (a comment marker keeps their home; Exit restores them). Defaults: Code, Perform, Visual, Full studio (`Alt+1..4`). Saved layouts: `sc.ws.configs` (history-versioned); the current one is `sc.ws.current`. Modules can add panes at runtime through `strudelCraft.workspace.panes` (`{title, find}` to move an existing panel, or `{title, make}` to build one): `vox-banks.js` adds `banks`, the Banks browser (#85).

## Command palette (`site/palette.js`)
Chord `sc.palette.chord` (default `Ctrl+K`). Ranking: prefix > word prefix > substring > fuzzy subsequence (consecutive runs score higher). `strudelCraft.palette.register({id, title, group, keys, run})` returns an unregister function.
`copycode.js` registers group Copy: `copy.code` (Copy code), `copy.selection`, `copy.link` (shareable link), `copy.recipe` (with controls and state); each acts on the visible editor (Stack in Stack view, else Rack).
`vox-banks.js` registers group Banks: `banks.open` (Browse vox banks, the sheet) and `banks.pane` (Show Banks, the workspace pane).
`pwa.js` registers `app.install` (group App, "Install app") while the site is not installed; it is removed once installed or in standalone mode (site/README.md, Install on Android). Offline: the installed app loads, edits and plays from the per-deploy service-worker snapshot (`site/precache.json` + the crawled CDN graph; `node tests/site/pwa_offline.mjs`).

## Live numbers: no layout jitter (`site/numfmt.js`, `.num` in `site/workspace.css`)
Rule for every live number on the site: a fixed decimal count (never drop a trailing `.0`), zero-padded clocks with a stable minute/hour width, and a reserved box: `.num` = monospace, tabular figures, `letter-spacing:0`, right-aligned, fixed `width: var(--w)` in ch sized for the largest expected value (cycles 6ch = `9999.0`, clocks 7ch = `h:mm:ss`, record timer 8ch = `mm:ss.s`). Separators sit in their own fixed boxes, changing rows use `contain: layout`, and controls that appear late (`+5 min`) keep their place with `visibility:hidden`.
- `numfmt.js` (also `strudelCraft.num`): `fix(v, d)`, `cyc(v)`, `clock(sec, {tenths})`, `ms(v)`, `db(v)`, `span(text, widthCh)`.
- Applied to: transport range (position, end, elapsed/end/remaining/played/paused, loop Start/End fields, Go-to prefill), audio diagnostics sheet (lookahead, ticks, late ticks, max gap, underruns, played/paused, segment rows), record panel timer and cycle counter, capture take rows (`cycles c · cps · c start-stop`), Perform board values (decimals from the control's step, else range/100; width from the range ends), inline scrub editor readout (the code text keeps the literal's own form), stage cycle/cps/peak readouts, history times (tabular figures).
- Test: `node tests/site/readout_layout.mjs` (360 px: 0.0, 9.9, 10.0, 99.9, 100.0 cycles and 0:59, 1:00, 9:59, 10:00 clocks; asserts no child box of the readout row moves or resizes).
