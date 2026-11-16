# Quick play (#150)

A play button on every Syntax example, every Syntax section header (plays its first playable example) and every Recipes row. It auditions the entry's code where it is: no navigation, no view switch, no editor write, scroll or focus (#107). "Insert into editor", "Load and play" and Go to code stay separate, explicit actions.

## Behaviour
- Tap play: the example plays on its own audition track. Tap it again, or tap another row's play: stop / switch (one audition at a time). The transport Stop stops it too (25 ms fade, no click).
- Form: the Craft form; with the Strudel tab open on that example, the generated plain Strudel form. A Strudel tab without a plain form shows the reason in a toast.
- Length: 4 cycles, a short fade, then stop. The Loop chip (tray, persisted as `sc.qp.loop`) repeats until stopped.
- Tempo: the entry's own `setcpm/setcps/setbpm`, else the recipe's `bpm_hint`, else the page tempo knob.
- Mix (decision): the audition replaces nothing. While the program plays it mixes at 0.6 (-4.4 dB), alone at 0.9. The Solo chip mutes every other orbit (the program) until the audition ends, then restores them. If the program is stopped, the master bus is unmuted for the audition and muted again afterwards.
- Pack examples (atoms.import, rack defs, hooks, lanes) run through the same prepare steps as Play (`Engine.prepare`: hooks, perform glue, sample maps, worklets, pack hook defs, atoms), so they load their ingredients lazily and play.
- Not playable alone (disabled play, reason in the tooltip and in a toast on tap): examples with an action or `noplay`, page-API scripts (`strudelCraft.` calls change your settings), and bare `tap()/wire()` readers with no `.tap()` writer in the same code.
- Button states: idle, loading (spinner), playing (stop square, progress bar under it, glow with the level). A tray (Solo, Loop, Stop, 44px targets) shows while it plays.

## How (site/quickplay.js, lazy module)
- Its own `webaudioRepl` (own scheduler and pattern); the main program, scheduler and editor text are never replaced.
- Every note goes to superdough orbit 13; its output node carries the level and the fade, and is disposed on stop (fresh delay/reverb next time).
- A repl evaluation rebinds core globals (time, cps, trigger, current pattern, started flag); they are restored to the main repl's after every evaluate and stop.
- Known limit: the globals `all/hush/setcpm/d1..` stay bound to the audition repl until the program's next evaluation (the program re-binds them itself on every evaluate).

## Measured (tests/site/quickplay.mjs, 390px touch, loaded machine)
Warm press to first sound: 115 ms (scheduled time), first analyser sample above the floor 130 to 290 ms. Cold (engine, banks, worklets): 3.3 s.
