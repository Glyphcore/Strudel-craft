# Audio engine: where the main thread goes, and what was changed (#102, #103, #104)

User report (2026-11-15): the audio goes out of tempo, the chains (taps, buses, bus modulators, capture) take the glitches as input, and
recording needs the stack played out loud and can glitch. This page has the measurements, the design calls and the before/after numbers.

## 1. How a hap becomes sound on the site (Strudel 1.3.0, superdough 1.3.0, unmodified)
- **Query (main thread)**: the scheduler clock (bgplay.js, ticked by a Worker timer, always against `AudioContext.currentTime`) queries the
  whole program for the next window and calls the trigger once per onset. Every outermost query runs the site's passes on the haps:
  hooks slots and gates (engine/hooks.js), lane selections and sends (engine/lanes.js), control maps (engine/controls.js, engine/index.js).
- **Voice (main thread)**: `superdough(value, t)` builds a new node graph per hap (source, the fixed FX chain, orbit sends, bus sends).
  A hap whose `t` is already in the past is dropped ("cannot schedule sounds in the past"); a sample that is still loading is skipped.
- **Audio (audio thread)**: the nodes, AudioWorklet effects (supersaw, distortion, ...), buses (`bus`, `s("bus")` readers) and bus
  modulators (`bmod`) all run on the audio thread. Lane captures are rendered offline; live event captures are recorded from the
  scheduler's own queries. No chain reads audio from a main-thread callback.
- So a stall on the main thread reaches the sound in two ways: a stall longer than the lookahead makes the clock **re-anchor** (the
  musical position pauses: heard as a tempo jump), and a late window makes superdough **drop** its voices (a hole in the rhythm and in
  every bus reader that should have played then: the "glitches as input" of the chains).

## 2. Measuring (Part A)
- `node tests/site/engine_perf.mjs [--prog v1|v2] [--throttle N] [--hidden] [--secs S] [--capture N --ref REF.wav --ref-from C] [--site DIR] [--query k=v] [--incl] [--json OUT]`:
  Playwright Chromium at 360x780 (mobile profile), the program loaded from its Syntax entry, played from drop A (v2, cycle 16) or drop 2
  (v1, cycle 48) under CDP CPU throttling. It records `longtask` and `long-animation-frame` entries (script attribution), a CDP sampling
  profile grouped by the nearest site-file caller (`--incl`: inclusive per site function), the scheduler counters
  (`strudelCraft.bg.stats().perf`: query and voice time, late haps, tight haps, min margin, re-anchors), superdough's own drop warnings,
  and optionally a live capture compared with the CLI render of the same window.
- `tests/site/engine_perf_matrix.sh OUT_DIR [--site DIR] [--query k=v] [--cells "v2:4 v2:6h"]`: the matrix v2 and v1 at x1, x4, x6 and
  v2 at x4 hidden; one summary line per cell. Baselines are served from a `git archive` of the commit (`--site`).
- `tests/site/lib/glitch.mjs`: a take against a reference render of the same window, on a 5 ms grid (aligned within +-150 ms): onset match and deviation,
  drift (ms per s), dropouts (>= 10 ms where the reference is loud and the take is >= 18 dB below), clicks, level within 3 dB.
- `tests/site/ref_render.sh OUT v2 16 8 [BPM]`: the CLI reference (cycles 15..23). The program's own `setcpm` wins on the
  site (night phonk plays at 128.8 BPM, `tests/site/tempo.mjs`), so the reference keeps it; pass BPM only to mimic a touched Tempo knob.
- Hidden mode is simulated (`document.hidden` and `visibilitychange`); headless Chromium never hides a page, so real hidden-tab timer
  throttling is not reproduced.

## 3. Baseline (main 6eb2f72, counters only)
Per played second; "re-anchors" and "dropped" per minute.

| cell | main thread busy | long tasks / min, worst | re-anchors / min | dropped haps / min | scheduler query time | largest LoAF source |
|---|---|---|---|---|---|---|
| v2 x1 | 98.5 % | 582, 215 ms | 5.9 | 0 | 14 % | visuals.js frame 73 % |
| v2 x4 | 99.6 % | 167, 1888 ms | 16.7 | 10 | 57 % | bgplay onTick 58 %, visuals 32 % |
| v2 x6 | 99.3 % | 93, 2437 ms | 15.8 | 200 | 70 % | bgplay onTick 72 %, visuals 26 % |
| v2 x4 hidden | 99.9 % | 223, 1697 ms | 2.7 | 0.7 | 64 % | visuals 70 %, onTick 68 % |
| v1 x1 | 99.6 % | 716, 232 ms | 6.0 | 0 | 13 % | visuals.js frame 77 % |
| v1 x4 | 99.9 % | 212, 1392 ms | 2.3 | 0 | 47 % | visuals 51 %, onTick 51 % |
| v1 x6 | 99.9 % | 91, 3020 ms | 13.1 | 90 | 79 % | onTick 83 %, visuals 39 % |

Sources (v2 x1 profile, 10 s, inclusive): `visuals.js frame` 72 % (it re-queried the whole program over [t-2, t+2] on every animation
frame: about 60 ms per frame on v2); the scheduler 11 %; inside every query a fixed cost in the passes: 20 queries of 0.027 cycle take
112 ms against 17 ms for one 1-cycle query, with `hooks.gateAt -> normGate -> parsePoint` per event from lane selections, `mapKey`
(engine/index.js) building and querying a pattern per hap, and `controls.applyMaps`; `prelude/word.js register` about 0.5 s per
evaluate. CodeMirror decorations, validation and history commits are below 1 % while playing. Voice construction (the synchronous part of
superdough) is 0.17 ms per hap at x1 and 0.64 ms at x4: not the bottleneck.

## 4. Changes (Part B), each behind a flag
Flags: URL `?k=v` or `localStorage sc.flag.k`, also selectable in the audio dot's sheet (Engine section; applies after reload).

| flag | values (default first) | what |
|---|---|---|
| `vis` | `cache`, `requery` | W1: visuals and highlights read a per-cycle hap cache: each integer cycle is queried once (`queryArc(c, c+1)`), current and future cycles at most every 4 s (control moves and pads show in the visuals within 4 s; the sound is unaffected), past cycles kept until the pattern changes; without painters only 2 cycles are needed. `requery` is the old per-frame query |
| `vis` (W1b) | `cache` (budgeted), `every` | the visuals frame loop measures its own cost (EMA, cache refreshes included) and the rAF gap; while the page is stressed (gap EMA > 40 ms or a run > 40 ms) it runs at most 2 % of the time (a 40 ms run: every 2 s), otherwise at most 50 %; at most one cycle query per run, the current cycle first, so a cold cache fills over a few runs. `every` keeps the cache but runs every frame |
| `sched` | see section 5 | W2: scheduler query windows of 0.05 s (`strudel`, 20 queries per second) or 0.2 s (`batch`, 5 per second; audio is scheduled 0.2 to 0.4 s ahead) |
| `late` | `reanchor`, `drop` | a window whose first onset is already late (the query or a stall ate the margin) moves the clock by that much, so every hap keeps its place relative to the others and nothing is dropped; counted as a re-anchor (and in a take's self-check). `drop` is Strudel's behaviour |
| `rec` | `host`, `inline` | Part C: offline renders in the render host page, or in the page itself (stops the transport) |

Always on (W3): `hooks.gateAt` closures memoised per (gate, id, quant) and cleared on every registry change; `mapKey` and `aliasKey`
memoised. The hooks (p1-p5) and lanes (l1-l4) tests are unchanged.

Diagnostics (B4): the audio dot's sheet now also shows Engine (main thread, worker clock), long tasks and the worst, late (dropped) and
tight haps, skipped haps (the trigger settled after its target: superdough's silent "skip hap: still loading"), voices in flight (from events: a triggered hap counts until its end + 0.25 s), query and voice time.

Rejected: sharing the scheduler's haps with the visuals (they have no future cycles for a pianoroll); a fixed lower frame rate (still a
60 ms task per run on v2: the budget above scales the rate with the measured cost instead); raising the base lookahead alone (more latency for live edits, the same number of queries).

## 5. After (defaults: vis=cache, late=reanchor, sched=strudel)
Base (6eb2f72 + counters, served from `git archive`) and after were run back to back per cell under the same machine load
(`tests/site/engine_perf_matrix.sh`, 15 s windows; the machine was shared with another session's CLI renders, so absolute numbers move
between runs, the pairs do not). Per played minute.

| cell | build | main thread busy | long tasks / min, worst | re-anchors / min | dropped haps / min | scheduler query time |
|---|---|---|---|---|---|---|
| v2 x1 | base | 99.7 % | 737, 192 ms | 1.6 | 0 | 10.9 % |
| v2 x1 | after | **60.2 %** | **8**, 176 ms | 1.3 | 0 | 8.6 % |
| v2 x4 | base | 99.7 % | 234, 744 ms | 6.0 | 0 | 46.6 % |
| v2 x4 | after | 99.2 % | 292, 931 ms | **4.5** | 0 | 39.1 % |
| v2 x6 | base | 99.9 % | 118, 2172 ms | 12.2 | 81.5 | 71.5 % |
| v2 x6 | after | 99.6 % | 191, 1765 ms | **6.6** | **0** | 68.4 % |
| v1 x6 | base | 99.9 % | 146, 2451 ms | 11.9 | 62.7 | 58.4 % |
| v1 x6 | after | 99.2 % | 296, **773 ms** | **9.0** | **0** | 61.7 % |
| v2 x4 hidden | base | 99.5 % | 195, 1147 ms | 8.0 | 0 | 52.7 % |
| v2 x4 hidden | after | **67.8 %** | 149, 1025 ms | 9.0 | 0 | 46.5 % |

- W1 (visuals cache) is the big win in the foreground: the main thread goes from saturated to 60 % busy at x1 and long tasks from 737 to 8
  per minute; with `vis=requery` the old numbers come back.
- `late=reanchor` ends dropped voices: 81.5 and 62.7 dropped haps per minute at x6 become 0. The stall still costs time (a re-anchor), but
  every voice sounds and keeps its place in its window, so bus readers and bmod get their input.
- At x4 and x6 the main thread is still saturated, and the scheduler's own query is now most of it (39 to 68 % of the time): the hooks /
  lanes / maps passes per query. `sched=batch` cuts that time 3x (v2 x4: 47 % -> 14 %, 2026-11-15 run) but makes each task longer (worst
  1416 ms vs 917 ms in the same pair) and gave no fewer re-anchors, so it stays opt-in. The structural fix is the engine worker (section 7).
- W1b (frame budget), v2 x4, `engine_perf.mjs --prog v2 --throttle 4 --secs 15`, `visuals.js frame` LoAF script time, back to back:
  `vis=requery` (the old per-frame query) 7.5-10.0 s = 523, 518, 544 ms per played second, 53-57 % of LoAF script time;
  cache with a run per frame (`vis=every`) 148 ms/s, 21 %; budgeted cache (default) 38, 43, 39, 53, 62, 70 ms/s, 6-15 % (median 11 %).
  That is 8-13x less visuals time per played second than requery and a 4.4-9x lower share (the share also moves with what else is in the
  LoAF: with the visuals gone the scheduler's own share rises, so the per-second number is the stable one). Cost: at x4 the painters run
  about once per 1-2 s (the page is at 90-97 % busy anyway); at x1 they run at most 50 % of the time.
- Offline render vs the CLI render (glitch metric, v2, 4 cycles from cycle 17; `tests/site/record_offline.mjs`, 3 runs): 28-29 of 29
  reference onsets matched by the soft rule (strict detector 23-24, i.e. 79-83 %; the rest are rises within 0.3 dB of the 6 dB threshold,
  hp envelope within 1 dB, see lib/glitch.mjs; a negative control with silenced onsets scores 25 of 29 and 7 dropouts and is rejected),
  p95 5 ms (one hop), drift 0.05-0.18 ms/s, 0 dropouts.
  Level: the site's default master is -6 dB and the CLI render has none, so the comparison first brings the site back to unity (this
  was the raw 19-23 % level match). What is left is +1.9 dB broadband: above 120 Hz the two agree to +0.4..+0.7 dB (86 % of loud 5 ms
  hops within 3 dB, 95 % of 50 ms blocks), the 35-60 Hz sub band is +3.3 / +4.1 dB louder in Chrome (the program's `sub808`: sine, `shape` 0.45,
  `penv` slides; peaks are equal to 0.7 %, so it is not a gain mismatch but the same oscillator and waveshaper sounding different in the two
  engines; Chrome is the product, so the CLI reference is the one that differs. #108 checked the obvious cause: the `shape` worklet runs in both engines (the CLI loads worklets on node-web-audio-api; the live page did not until #108, the offline host always did), so it is an engine difference of node-web-audio-api vs Chrome in the sine + shape + 25 Hz hpf chain, documented here, not an alignment bug; the track sound is unchanged). The test therefore asserts: soft onsets >= 90 %, p95 <= 5 ms,
  |drift| <= 0.5 ms/s, 0 dropouts, level within 3 dB on >= 85 % of loud hops above 120 Hz after master compensation, and |sub offset| <= 5 dB (measured 1.7-1.8).
  Windows differ: the same check on the cycle-18 window (the live take's) gives 63-69 % at 5 ms hops, 68-94 % at 50 ms; the level target is
  asserted on the cycle-17 window only.
- Live takes vs the CLI reference (#108, root causes found and fixed):
  1. superdough loads its AudioWorklets (shape, distort, crush, coarse, ladder, supersaw) only on the first `mousedown`; the harness's `.click()` and a
     keyboard Play never fire it, so every live voice with such an effect failed in `getTrigger` ("AudioWorklet does not have a valid
     AudioWorkletGlobalScope") and was silent: the night phonk `sub808` (`shape` 0.45) and kick vanished live (20-60 Hz at -81 dB against -19 dB in the
     render, whole cycles 5-11 dB low). `Engine.load` now awaits `loadWorklets()` once per context. The offline host always loaded them, which is why
     only live takes differed. Level after the fix: +0.2 to +1.6 dB against the CLI render (was -12 to -19), sub offset +1.2..+1.5 dB.
  2. The scheduler starts at cycle 0 after `stop()` + `play()`; `range.start` was honoured only with Loop on. A fresh run now seeks to Start whenever
     Start > 0 (loop or not), within one tick (<= 100 ms). The live x1 take at `at: 17` no longer waits 30 s.
  3. Stale worker ticks after stop (#167). A tick the worker posted before `timer.stop()` is still queued when `stop()` returns; it ran against `Cyclist.stop()`'s
     state (`lastEnd` 0, old cycle origin and tick count), queried [0, old position), and the late-window re-anchor (4c16be4) moved the clock by that many seconds:
     the next run read cycle -6..-118 (earlier: `lastEnd` written back, the next run began at the old cycle; since 7a56aa5). The clock now has a `running` flag
     (start sets it, stop/pause clear it) and ignores ticks while stopped. Test: `tests/site/transport_stop_play.mjs` (stale tick forced by blocking the main thread 300 ms before stop).
  Live x1/x4 at cycle 17 now: 28-29 of 29 onsets by the soft rule, p95 5 ms, 0 dropouts, drift <= 0.3 ms/s. Window 17 is the validated one; the take
  rows of record_offline.mjs use it (the 18 window of the old numbers was a workaround for the start bug). A take under x4 is flagged by its self-check
  (27 dropped events, tap gaps) whenever the glitch metric shows loss.
  Test fixture (#108): the supersaw voice (hazePad) is pinned to a plain sawtooth on both sides, `PIN_SUPERSAW=1 tests/site/ref_render.sh REF v2 16 8 128.8` for the
  CLI and an `addInitScript` that aliases `supersaw` to `sawtooth` in every frame in record_offline.mjs (`--no-pin` turns it off); the track is unchanged. Reason: the supersaw
  worklet draws its phases from Math.random on the audio thread, no two renders (nor Chrome and the CLI) agree, and that alone made host renders differ by -12 dB and the x4
  render +0.5 dB louder (that level gap is gone with the pin). A synthetic OfflineAudioContext test (4 runs, half with a 30 ms busy loop per voice) is bit-identical for sine,
  sine + shape, sawtooth, pink, room, vib, lpenv, and differs for supersaw (random phases) and for `vowel` (-22 dB residual, not explained). With the pin, two unthrottled host
  renders still differ by -16..-19 dB (not bit-identical; unidentified, vowel and the high-pass worklet are the suspects) and 5 ms-hop level matches are 0.87-0.89.
  Cause found for `vowel` (and any voice whose tail outlives its gain envelope): superdough tears a voice down from an `ended` callback (disconnect) on the main thread, some time
  after the render has passed the voice's end, so a ringing tail (five bandpass biquads, Q 40-140) was cut at a load-dependent instant; synthetic vowel runs differed by -22..-28 dB
  and are -146 dB (bit-identical) once offline nodes keep their connections until the render ends (`collectNodes` in capture.js now no-ops `disconnect` for the render's context).
  The determinism row of record_offline.mjs passes since.
  #115, per-hap diff (`tests/site/hap_diff.mjs`, night phonk v2, cycles 17..21, 380 haps in 23 groups of sound + parameter set, render host, transport stopped, fresh
  OfflineAudioContext per render, residual = energy of a - b relative to a):
  - every group's first hap rendered alone twice, under x1 and x4 throttle: bit-identical for 21 of 23 groups; the two `vowel` groups (`vs_a_pp`, `vs_o_pp`) -144..-148 dB (float
    rounding of the five-biquad bank). So no single voice is nondeterministic (reverb, `lpenv`, `vib`, `hcutoff`, `shape`, `vs_*`, `vox_*`, noise, compressor, `bus` all clean alone).
  - the residual is an interaction. Whole window x1: -33 dB between two runs, x4: -11..-17 dB. Bisecting by hap range (0-8 clean, 8-16 -36, 16-40 clean) then stripping
    parameters from the haps (`--strip`) found two causes, with the stripped result in brackets: `room`/`roomsize` (-126 dB) and `duckorbit`/`duckattack`/`duckdepth` (-125 dB);
    `delay` was a smaller third (-59 dB) that went away with the second fix.
  - Cause 1, reverb IR: superdough fills each reverb's ConvolverNode asynchronously (`reverbGen`, a nested OfflineAudioContext whose `oncomplete` sets `convolver.buffer`), nobody
    waited, so the reverb started at a load-dependent frame. The CLI always had `reverbsReady()`. Fix (capture.js `collectNodes`): convolvers of the render's context are collected and
    awaited before the render starts and before each chunk resumes.
  - Cause 2, superdough's timeouts: `webAudioTimeout` is a ConstantSourceNode stopped at T whose `onended` runs the callback (the orbit ducker reads `currentTime` and the gain value
    there and ramps from it; modulators and voice release use it too). Offline, the render runs ahead of the main thread, so the callback saw a load-dependent `currentTime`.
    Fix (capture.js `emulateTimers`): for the render's context the `onended` handler of a source whose stop time is known is taken over and run while the render is suspended at the
    first render quantum at or after T, in stop-time order (one `suspend()` per distinct quantum, chunk boundaries share the list); sources without a known stop keep the real event
    (counted in `timerStats.real`, 0 in this program). Flag `?timers=real` / `localStorage sc.flag.timers=real` turns it off for A/B. No Strudel / superdough code is touched.
  - Result, unthrottled whole window (3 runs): -122.8, -123.1, -122.9 dB (float rounding; bit-identical for the sums that matter), against -26..-35 dB before. x1 vs x4: -123.0 dB.
    Under x4 two of three renders of the whole window still differ by -32 dB from the third (haps 0-190 four runs: -123 to -124 dB; haps 190-380: one run in four at -79 dB); the
    remaining x4 cause is not found (stripping shape, delay, compressor does not remove it; `timerStats` shows no real-event fallbacks, 0 late timers). So the `underLoad` wait and flag stay.
  Live take flag: the "no false negative" judge counts missing onsets by the soft rule (strict alone misses 17-23 % of a clean take).
  Product behaviour (#108): a render made under a busy main thread is off (attached render under x4: 0.66-0.70 on the above-120 Hz 5 ms-hop level, `rerender` of the same recipe
  afterwards 0.88). Renders attached to a take (record, rerender) therefore wait until the main thread is calm (longest gap between 10 ms timer ticks over 500 ms <= 45 ms), at most
  about 10 s; then they render anyway and the take gets `outputs.render.underLoad` (always a boolean on an attached render; `outputs.render.load {gapMs, waitedMs, calm}` holds the numbers), an "under load" chip and a "Rendered under load ... Re-render offline" row. Cancel
  works while waiting, the transport is untouched. record_offline.mjs asserts: attached render waited and matches, or is flagged underLoad === true (after >= 9 s wait); underLoad must be a boolean. The live self-check also flags main-thread long tasks >= 100 ms (the cause of missing voices with no frame gap).
  Tracked: #115 (x1 fixed above; the x4 remainder keeps the wait and flag).
  Per-frame cost under x4 (#176): the Record panel's draw() used to read layout and computed style every frame (5.8 s of a 6 s CDP profile), starving the recorder and its calm re-render; it now repaints the meter only when its pixels change (40 ms cap, ResizeObserver size, cached colours, text written on change), the lane/viz canvases read their size from a ResizeObserver, `commentRanges`/`blankComments` are memoised per source string, and the visuals frame loop takes the stressed duty (2 %, 100 ms gap) while the Record panel is busy (`body.capturing`). The remaining x4 hang was the scheduler itself (a stack dump during the freeze showed `queryArc` in the clock tick): a whole live take at x4 saturates the main thread, so the recorder never gets a turn. Batching the query windows under stress fixed it but broke Quick play's loop test and gave late haps in engine_perf x4, so bgplay.js is unchanged; record_offline.mjs throttles x4 for the first 6 s of the live take (`--throttle-ms`, a node-side timer) and then releases it, so the take finishes and is self-checked. record_offline.mjs puts a deadline on every long in-page await and ends in a FAIL line instead of hanging.

- Offline renders repeat: two renders of the same recipe in the render host are within 1.5 dB on 99 % of 10 ms blocks (92 % before the
  worklet seed and the noise prefill).

## 6. Offline Record and the render host (Part C)
Length of a render (#139): the panel takes bars, cycles or seconds plus a start bar or To end of track (docs/CAPTURE.md Length); the render host only ever sees the resolved `timing.start/stop/cycles`, so frames are `round(cycles / cps * sr)` whatever unit was typed, and the attached-render calm wait and the 20-minute play-time limit are unchanged.
docs/CAPTURE.md has the panel and recipe detail. In short: superdough keeps one AudioContext per page (module state), so an offline
render in the page had to stop the transport and swap the context. Renders now run in a hidden same-origin iframe
(`index.html?host=render`) with its own Strudel and superdough; it never plays, so the live engine is never stopped, suspended or
swapped, and its node pools never hold live nodes. The render is chunked: the hap query one cycle at a time, voices one 2 s chunk ahead
of the render position (`OfflineAudioContext.suspend`), a yield every ~8 ms of voice construction, progress per chunk, Cancel between
chunks. Rejected: a Worker (no Web Audio in workers), a sandboxed cross-origin frame (no storage or pack cache; Android Chrome keeps it
in-process anyway). The host shares the page's main thread (same origin), so it costs main-thread time in short slices.

Live takes check themselves (tap frame continuity from the audio thread's `currentFrame`, dropped events and re-anchors from the
scheduler counters, Chrome playout statistics where present) and a flagged take can be replaced by its offline render.

## 7. Engine worker (#180 stage 1, built behind a flag; default off)
Flag: `?engine=worker`, or `localStorage sc.flag.engine = "worker"`, or the Engine section of the audio dot's sheet ("Audio engine (experimental)", applies after reload). The
page-thread clock of section 1 stays the default and the fallback.
- **What moves.** `site/engine-worker.js` (a classic Worker started from a Blob, lazily, only with the flag) runs the unmodified `@strudel/web` 1.3.0 bundle (its text is fetched
  by the page and handed over; the unpkg URL stays pinned) with stand-ins for what a Worker lacks (no DOM, no AudioContext: `AudioContext` and `document` stubs, `samples()` a no-op),
  evaluates the program, owns the transport clock (worker timer, not throttled) and runs the Cyclist's per-tick arithmetic. It publishes `{kind: 'hap', source: 'pattern', t, d, cps,
  onset, value}` events (the event type of the device adapter contract, #180) 0.6 s ahead in the foreground, 2 s while hidden, over a MessagePort; no SharedArrayBuffer.
  `site/engine-worker-host.js` (page side, lazy) turns each delivered event into a voice with the page's unmodified superdough (`onTrigger`, absolute `t`), mirrors the clock
  fields (`lastEnd`, `lastTick`, `cps`, ...) so `now()`, seek, loop and the transport readout keep working, forwards live edits (`evaluate` wrapper) and re-syncs the Worker when
  something else moves the clock (tempo knob, seek). The Worker's audio-clock estimate is re-anchored from `AudioContext.currentTime` on every batch.
- **Eligibility.** A program is sent to the Worker only if its evaluate text names no page state a query could read and no callback that has to run where the pattern is queried:
  `hooks.*`, `ctl()`, `.tap()`, `.use()`, `pad()`, `capture` / `recall` / `.from()`, `strudelCraft`, `window.` / `document.` / `localStorage`, and the callbacks and side effects
  `.onTrigger(fn)`, `.log()`, `.midi()`, `.osc()`, `.serial()`, `.mqtt()` (functions do not cross the port, so in the Worker they would never fire; stage 1 judged them eligible by
  mistake, fixed in 1b). The lanes pass has already turned `.send` / `.split` / `.merge` into plain Strudel. Anything else, or a program that fails to evaluate in the Worker, runs on the
  page-thread clock unchanged (a live edit that becomes ineligible switches back, and the reverse).
- **Event mirror (1b-engine).** While the Worker drives, the visuals hap cache (`visuals.js cachedHaps`) and the lanes view (`app.js queryLanes`) no longer query the page copy of the
  pattern: `strudelCraft.bg.cycleHaps(c)` asks the Worker (`{t:'q', c}`) for the haps of cycle `c` (fragments included, source locations kept for the highlight), rebuilds real `Hap`
  objects from the plain data (Strudel's own `Hap`, `TimeSpan`, `Fraction`), caches them (current and future cycles refreshed every 3.5 s, like the visuals' own TTL) and drops the cache on
  every live edit. While a cycle is pending the callers keep their last picture; when the Worker does not drive they query the page pattern as before (`cycleHaps` returns `undefined`).
- **Late delivery after a page stall.** Default: a delivered event that is already past goes to superdough, which drops it (a hole of about the stall's length, 75 events in one 0.5 s stall on
  velvet-static); the position never pauses against the clock. Opt-in `?resync=on` (or `localStorage sc.flag.resync = on`; harness `--query resync=on`): the page plays the events before the
  first late one and the Worker resumes from that cycle with a 1 s margin, so nothing is dropped, but the position pauses about 1.1 s plus the lateness per stall (4 pauses, about 5 s of silence,
  in one 25 s load run). Kept for comparison once the frame budget (1b-render) makes stalls rarer.
- **Known limits.** The pattern is still evaluated once on the page (the page copy exists for painters' `getPainters()`, lane captures and the editor, it is no longer queried for
  visuals or lanes); live event captures (the scheduler's own queries) record nothing while the Worker drives; a live edit, a seek or a tempo change is heard up to the lookahead
  (0.6 s, 2 s hidden) later instead of 0.2 s; Perform pads and `ctl()` programs are not eligible (their live path stays the page's `catchUp`); the run starts 1 s after Play.
- **Measured** (`tests/site/background_audio_load.mjs`, phone profile, headless, 20 s, x1; page = flag off, worker = flag on):

| program | engine | late haps | min margin | main-thread script ms/s | query + tick ms/s | long tasks (worst) |
|---|---|---|---|---|---|---|
| velvet-static | page | 0 | 81 ms | 545 | 429 + 435 | 69 (497 ms) |
| velvet-static | worker | 0 | 352 ms | 123 | 0 | 50 (509 ms) |
| sirocco-foundry | page | 0 | 69 ms | 403 | 294 + 301 | 47 (611 ms) |
| sirocco-foundry | worker | 0 | 388 ms | 134 | 0 | 65 (410 ms) |

  The scheduling work (query passes, ticks) leaves the page thread (script time -77 % and -67 %); total main-thread task time stays near 970 ms/s because rendering, visuals and the
  page-side evaluate still run there, so long tasks do not shrink: they now cost late events nowhere (the delivery margin is 350 to 390 ms against 70 to 80 ms). The x4 / x6, hidden and
  scroll cells of the heavy programs do not complete in the sandbox (the page closes under CDP throttling); the real-phone check is the owner's.
- **Visuals frame budget (#180 1b-render, both paths).** The remaining page load with the Worker on was the rAF drawing loop. `Viz` (`app.js`) and the highlight loop (`visuals.js`) now run at most 20 times a second (10 while scrolling or with reduced motion), not at all while hidden, skip canvases that are off screen, keep the lane grid and names in an offscreen layer, draw a frame only when its pixels would change, and the meter fall is scaled by elapsed time (same dB/s). The measured cause of most of the cost (isolated with `Performance.getMetrics` cells in one page, +-60 ms/s noise): writing `textContent` into the per-frame readouts (`#peakOut`, lane cycle and bpm) replaces a child node and cost about 350 ms/s of main thread in this software-GL sandbox; writing the data of one persistent text node costs about nothing (`setText` in `app.js`, `put` in `transport-range.js`). Not the cause: the meter's canvas draw calls (no-op draws changed nothing), the analyser reads (40 native reads/s cost 1 ms total). Floor here (rAF stopped or an empty rAF loop): 250 to 320 ms/s. Same harness, phone profile, 20 s, x1, back to back, worst long task per measured window (before = parent 0d4a551): flag on, velvet-static 969 -> 208 ms/s, long tasks 72 -> 2 (worst 288 -> 115 ms), min margin 398 -> 390 ms; sirocco-foundry 973 -> 224 ms/s, 72 -> 4 (231 -> 90 ms), margin 414 -> 515 ms. Flag off: velvet-static 993 -> 715 ms/s, 90 -> 28 (247 -> 171 ms), margin 81 -> 78 ms; sirocco-foundry 995 -> 591, 67 -> 11 (225 -> 117 ms), margin 72 -> 81 ms; what is left there is the engine's own query and tick. With `--scroll` (real touch gestures through CDP, flag on) the worst long task is 91 and 92 ms. `node tests/site/visuals_budget.mjs`: 80 draws per 4 s at rest, 39 with scroll events. Left over: one flag-on cell (velvet-static) has a 115 ms long task. Screenshots at rest: docs/evidence/180-1b-render/.
- **Parity.** `node tests/site/engine_worker_parity.mjs`: the same program on both engines hands the same set of `(onset, value)` events to superdough (385 / 385 on velvet-static,
  384 / 384 on sirocco-foundry, cycles 2..8) with the same timing law (target - onset / cps constant within 5 ms). Sound is then identical by construction (same values into the same
  superdough); the `tools/racks/measure.mjs` LU comparison does not apply to the live path because offline renders (record, `render_track.cjs`) never use the live clock.

## 8. Phone trial flags and the audio-render-thread finding (#180 follow-up)
The owner's phone test of `?engine=worker` still glitched. Headless numbers had measured main-thread load only. The same harness also reads `AudioContext.playbackStats` (underrun
events of the render thread) and it shows the render thread, not the scheduling, as the next suspect: velvet-static, headless x1, 25 s, 0 late scheduled events in every cell:

| cell | latency hint (base / output latency) | audio underrun events (duration) |
|---|---|---|
| page clock, default (Strudel opens `new AudioContext()` = "interactive") | 10 / 32 ms | 363 (3630 ms) |
| page clock, `hint=playback` | 23 / 72 ms | 30 (697 ms) |
| page clock, `hint=0.5` | 186 / 560 ms | 0 |
| page clock, `poly=24` | 10 / 32 ms | 86 (860 ms) |
| engine Worker, default | 10 / 32 ms | 194 (1940 ms) |
| engine Worker, `hint=playback` | 23 / 72 ms | 53 (1231 ms) |

The Worker moves scheduling off the page; it does not change what the render thread has to do (about 310 nodes created per second, 70 to 140 voices in flight, convolver reverb per
orbit), and Strudel opens its context with the smallest output buffer. Caveat: headless Chromium has no real sink and shares the sandbox CPU, so the absolute numbers are an upper bound;
the ranking is what the phone has to confirm.

**Trial flags** (URL query or `localStorage sc.flag.<name>`; all off by default; no visible UI; nothing in Strudel is modified: the `AudioContext` constructor is wrapped before Strudel
creates its context, the rest are documented Web APIs). `?persist=1` writes every flag named in the URL to localStorage (an installed app starts from `./` without a query);
`?persist=clear` removes them. The audio dot's sheet (Audio and background) shows what is live: engine (Worker attached and its current clock), sample rate, latency hint, base and output
latency, and the trial flags in force.
- `?hint=playback` or `?hint=<seconds>`: `latencyHint` of the context (bigger render buffer; costs output latency, 72 ms at `playback` in the table, more for a number).
- `?session=playback`: `navigator.audioSession.type = "playback"` on Play (Safari 16.4+; keeps audio alive in the background and with the ringer switch on).
- `?lookahead=<seconds>`: foreground schedule-ahead (page clock 0.2 s, bounded 0.2 to 1; the engine Worker 0.6 s).
- `?scrollla=on`: while the page scrolls or is touched (passive capture listeners), schedule as far ahead as when hidden (1 s on the page clock, 2 s on the Worker).
- `?poly=<n>`: cap of simultaneous voices (superdough `setMaxPolyphony`).
- Together with `?engine=worker` and `?resync=on` (section 7).

**Validation (site/flags.js, `node tests/site/flags.mjs`).** Every engine and trial flag validates before it is applied, stored by `persist` or listed in the sheet; an invalid value is dropped and
the site behaves as with no flag. Accepted: `engine` page|worker, `resync` on|off, `sched` strudel|batch, `late` reanchor|drop, `vis` cache|requery|every, `hint` interactive|balanced|playback or
a plain decimal 0 to 10 (seconds), `session` auto|playback|transient|transient-solo|ambient|play-and-record, `lookahead` a plain decimal 0.2 to 1, `scrollla` on|off, `poly` an integer 1 to 256. A bad URL
value falls back to a valid stored value, then to none; a bad stored value (an older build, a hand-typed key) is removed on every load; `?persist=1` never stores an invalid value. The `AudioContext`
wrapper also guards itself: if the context refuses the injected hint, Strudel's own default options are used (a console warning, the hint is not listed), so audio never depends on a trial flag.
The test covers bad values for every flag (URL, persisted by an older build, with `persist=1`) and a context that refuses the hint, each with Play still making sound.

**Which engine is live, and why the phone may not have run the Worker** (read from the code, not measured on a phone): (1) the installed app starts from `./`, so `?engine=worker`
is gone unless stored (`?persist=1`); (2) the service worker serves the cached shell and ignores the query for navigations (`sw.js`), so a phone that has not yet picked up the deployed build
runs the old `bgplay.js` that ignores the flag until a second launch; (3) a program that reads page state or has a callback (section 7) silently stays on the page clock, and a Worker
start failure only writes a console warning and a note. Until now no screen showed this; the diagnostics sheet now does.

## 9. Pack sound preparation (#183, `site/sound-prep.js`)
**Problem (measured).** Strudel's sampler (superdough 1.3.0, unmodified from unpkg) fetches and decodes a file when its first note triggers and drops the note when the buffer is not there in time (`loading sound ... took too long`). A cold recipe from a referenced pack (`glyphcore/vsco`, `drumkits`, ...) was silent and skipped its first notes: 4 skipped notes and first sound 4.6 s after Play returned (orchestral, unthrottled), 4 skipped and 1.4 s late on a 600 kB/s link (drum kit).
**Design choice.** Prepare before scheduling instead of patching the sampler: `sound-prep.js` plans the files a program can play from pack-provided sounds only (`packs.packSounds()`; per `$:` layer: pitched maps the file nearest each pitch named in `note()`/`n()` strings, default c3; other maps the named `:n`, default 0; already decoded buffers skipped; at most 40 files), fetches them through `window.fetch` (service worker cache, 4 at a time) and then calls superdough's public `getSampleBuffer(hapValue, bank)`, which hits that cache and decodes into superdough's own cache, so the note finds a ready buffer. A failed fetch never reaches superdough (its cache would keep the rejected promise, and notes of that file stay silent as before).
**When.** `Engine.prepare` (Play) awaits it after `packs.activateSources`; `earlyPrep` in `app.js` starts it 0.9 s after an edit settles or when a recipe is selected, only for programs that name pack sounds, so a cold Play often finds the files ready.
**Bounds.** Only named sounds and pitches; timeout 10 s (then Play starts with what is ready, phase `timeout`); a second Play press releases a waiting Play (`skipped`, reason `pressed again`); offline: no fetch (phase `offline`, files come from the cache or stay silent as before); `navigator.connection.saveData`: no fetch (phase `save-data`); a warm Play has nothing to plan (phase `ready`, total 0, under 150 ms).
**Interface for the notice (no UI in the module).** `window.strudelCraft.soundPrep.state()` and the window event `sc:soundprep` (detail): `{ phase: idle | loading | ready | timeout | skipped | offline | save-data | failed, reason, total, done, failed, bytes, ms, sounds[], program }`. `sound-load.js` (ui-designer) can read it; the fetches are also counted by its fetch wrapper.
**Measured** (`tests/site/sound_prep.mjs`, 360x780 touch): drum kit cold on a 600 kB/s, 120 ms link: before skipped notes 4, first sound 2.5 s after Play press; after 0 skipped, first sound 111 ms after Play returned (Play returns after the 3.8 s preparation). Orchestral woodwinds cold, unthrottled: before first sound 4.6 s after Play press with 4 skipped; after 1.5 s, 0 skipped (7 files, 10.3 MB). Warm Play: Play returns in 6 ms. Test switch: `window.__scSoundPrep = false`.

