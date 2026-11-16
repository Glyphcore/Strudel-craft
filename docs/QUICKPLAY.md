# Quick play (#150)

A play button on every Syntax example, every Syntax section header (plays its first playable example) and every Recipes row. It auditions the entry's code where it is: no navigation, no view switch, no editor write, scroll or focus (#107). "Insert into editor", "Load and play" and Go to code stay separate, explicit actions.

## Behaviour
- Tap play: the example plays on its own audition track. Tap it again, or tap another row's play: stop / switch (one audition at a time). The transport Stop stops it too (25 ms fade, no click).
- Form: the Craft form; with the Strudel tab open on that example, the generated plain Strudel form. A Strudel tab without a plain form shows the reason in a toast.
- Length (mode chip in the tray, remembered as `sc.qp.mode`, `sc.qp.bars`): **End** (default) plays to the entry's natural end once, resolved by the same resolver as Record "To end of track" (`record-length.js` `resolveEnd`: gates, `hooks.marker('end')`, `// @daw bars=N` header, `arrange()` period), then a short fade and stop. An entry with no finite end (a plain looping pattern, a bare `<a b c>`) loops until you stop it. **Loop** never stops. **N bars** (stepper, default 8, off until chosen) stops after N bars. There is no fixed 4-cycle clamp. Position shows as `bar x / total` (or `bar x` when endless) with elapsed time; the button shows the stop square and a progress bar. A 20-minute safety stop (the Record limit) ends any audition with a message.
- Tempo: the entry's own `setcpm/setcps/setbpm`, else the recipe's `bpm_hint`, else the page tempo knob.
- Mix (decision): the audition replaces nothing. While the program plays it mixes at 0.6 (-4.4 dB), alone at 0.9. The Solo chip mutes every other orbit (the program) until the audition ends, then restores them. If the program is stopped, the master bus is unmuted for the audition and muted again afterwards.
- Pack examples (atoms.import, rack defs, hooks, lanes) run through the same prepare steps as Play (`Engine.prepare`: hooks, perform glue, sample maps, worklets, pack hook defs, atoms), so they load their ingredients lazily and play.
- Not playable alone (disabled play, reason in the tooltip and in a toast on tap): examples with an action or `noplay`, page-API scripts (`strudelCraft.` calls change your settings), and bare `tap()/wire()` readers with no `.tap()` writer in the same code.
- Button states: idle, loading (spinner), playing (stop square, progress bar under it, glow with the level). A tray (Solo, Loop, Stop, 44px targets) shows while it plays.

## Loading
Nothing of Quick play is in the eager shell: `quickplay.js` is in the index.html LATER set (loaded after the first frame) and brings `quickplay.css`; it injects the Recipes row buttons itself (a MutationObserver on `#list`, a capture click handler that never selects the row) and warms the engine in `requestIdleCallback` (`Engine.prepare('')`, 1.5 s after load) so the first tap skips most of the cold start. While the engine is still cold the tray says "Loading audio engine". Exits (error, failed prepare, blocked, switch, Stop, page hide) share one `release()`: Solo off, the program's orbits back to 1, the bus muted again if the audition had unmuted it. The 20-minute limit can be shortened for tests with `strudelCraft.quickplay.maxS` (seconds).

## How (site/quickplay.js, lazy module)
- Its own `webaudioRepl` (own scheduler and pattern); the main program, scheduler and editor text are never replaced.
- Every note goes to superdough orbit 13; its output node carries the level and the fade, and is disposed on stop (fresh delay/reverb next time).
- A repl evaluation rebinds core globals (time, cps, trigger, current pattern, started flag); they are restored to the main repl's after every evaluate and stop.
- Isolation (tests/site/quickplay.mjs): the audition is evaluated against a blank hooks registry (`hooks.snapshot/restore/merge/unmerge`, engine/hooks.js), so its End resolves from its own markers and gates and an earlier audition's entries never carry over; its entries are then merged over the program's for playback, and the final release restores the program's registry exactly (if the program re-evaluated meanwhile, only the audition's own entries are taken out). The program's repl-bound globals (`all/each/hush/cpm/setcps/setcpm`, `Pattern.prototype.p/q/d1..`) are saved before the audition's evaluate and put back right after it.
- Not covered: the lanes graph, controls maps and atoms imports an audition evaluates are not snapshotted (an audition that declares lanes or controls leaves them registered until the program re-evaluates); during playback the audition's binds share slot names with the program's (the audition's win on a collision).

## Measured (tests/site/quickplay.mjs, 390px touch, loaded machine)
Warm press to first sound: 115 ms (scheduled time), first analyser sample above the floor 130 to 290 ms. End-resolved entry stops within a bar of its end; a looping entry runs past 8 cycles until stopped. Cold: 3.3 s before the idle warm-up, 1.7 s after (touch, loaded machine).
