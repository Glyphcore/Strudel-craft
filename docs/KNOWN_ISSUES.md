# Known issues and their workarounds

## AudioNode "the given destination is not connected" page errors (#92)

**Symptom.** Uncaught page errors `Failed to execute 'disconnect' on 'AudioNode': the given destination is not connected`, one per affected voice,
while a busy program plays on the site (night phonk v1 from drop 2: 12-20 per 30 s; the same track with its vox one-shots as two sparse word()
lanes tagged into one send: 25 per 40 s). The CLI (node-web-audio-api) renders the same programs without errors.

**Cause (superdough 1.3.0, unmodified, `dist/index.mjs`).** An oscillator voice with the `noise` control (`.noise(x)`; the phonk racks
`kick808`, `snareNoise`, `impact`, `tom`, `rimshot` use it) is built by `getOscillator` as `p = un(osc, noise, t)`: `un` starts a pink-noise
`AudioBufferSourceNode` and mixes it with `zn(osc, noiseNode, amount)`, which connects `osc -> a` and `noiseNode -> c` (two gains) and returns
`teardown: () => { Y(a); Y(c); osc.disconnect(a); noiseNode.disconnect(c) }`. Two independent end callbacks clean up:
1. the noise source's `onceEnded` runs `Y(noiseNode)` (releaseAudioNode), which calls `noiseNode.disconnect()` with no argument (every connection gone);
2. the oscillator's `onceEnded` runs `p.teardown()`, whose targeted `noiseNode.disconnect(c)` now throws `InvalidAccessError`, uncaught, because it
   is inside an event callback.
Which callback fires first is scheduling-dependent (inferred from this code path, not instrumented; the guard below removing every such error is consistent with it): under voice load (many lanes, bus readers, worklets) the noise source's end event is often
dispatched first, so the error rate grows with load; a light program (tests/site/fixtures/word_lanes_send.strudel.js alone) shows none. The word()
lanes are not the cause; they only add load. Related: the site redirects every `connect(destination)` to its master gain (site/app.js), so a
targeted `disconnect(destination)` would throw the same way.

**Guard (site/app.js, since a66ee4e).** `AudioNode.prototype.disconnect` is wrapped next to the existing connect wrapper: a disconnect from the
`AudioDestinationNode` is sent to the master gain it was redirected to, and a targeted disconnect (an argument given) that throws
`InvalidAccessError` is a no-op, since the connection it wanted to remove is already gone. A full `disconnect()` and every other error still
behave as before. Nothing in Strudel or superdough is modified.

**Test.** `node tests/site/disconnect_repro.mjs [--site DIR] [--expect-errors]` (Playwright, 360x780, real taps): the two-lane fixture alone, the
two-lane fixture inside the v1 track (`tests/site/fixtures/word_lanes_send_load.strudel.js`, from bar 1) and the v1 track from drop 2. On the
build before the fix (`git archive bffd843 site`) the last two report disconnect errors; on main all three report 0 page errors.
