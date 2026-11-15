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
- `tests/site/lib/glitch.mjs`: a take against a reference render of the same window, on a 5 ms grid: onset match and deviation,
  drift (ms per s), dropouts (>= 10 ms where the reference is loud and the take is >= 18 dB below), clicks, level within 3 dB.
- `tests/site/ref_render.sh OUT v2 16 8 [BPM]`: the CLI reference (cycles 15..23). The site's Tempo knob rewrites `setcpm(...)` to
  the knob's BPM (120 by default), so the reference is rendered at the same tempo.
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
| `vis` | `cache`, `requery` | W1: visuals and highlights read a per-cycle hap cache: each integer cycle is queried once (`queryArc(c, c+1)`), current and future cycles at most once a second (control moves and pads show within a second), past cycles kept until the pattern changes; without painters only 2 cycles are needed. `requery` is the old per-frame query |
| `sched` | see section 5 | W2: scheduler query windows of 0.05 s (`strudel`, 20 queries per second) or 0.2 s (`batch`, 5 per second; audio is scheduled 0.2 to 0.4 s ahead) |
| `late` | `reanchor`, `drop` | a window whose first onset is already late (the query or a stall ate the margin) moves the clock by that much, so every hap keeps its place relative to the others and nothing is dropped; counted as a re-anchor (and in a take's self-check). `drop` is Strudel's behaviour |
| `rec` | `host`, `inline` | Part C: offline renders in the render host page, or in the page itself (stops the transport) |

Always on (W3): `hooks.gateAt` closures memoised per (gate, id, quant) and cleared on every registry change; `mapKey` and `aliasKey`
memoised. The hooks (p1-p5) and lanes (l1-l4) tests are unchanged.

Diagnostics (B4): the audio dot's sheet now also shows Engine (main thread, worker clock), long tasks and the worst, late (dropped) and
tight haps, voices in flight (from events: a triggered hap counts until its end + 0.25 s), query and voice time.

Rejected: sharing the scheduler's haps with the visuals (they have no future cycles for a pianoroll); lowering the frame rate (still a
60 ms task per frame); raising the base lookahead alone (more latency for live edits, the same number of queries).

## 5. After
(filled from the matrix: see the table below)

## 6. Offline Record and the render host (Part C)
docs/CAPTURE.md has the panel and recipe detail. In short: superdough keeps one AudioContext per page (module state), so an offline
render in the page had to stop the transport and swap the context. Renders now run in a hidden same-origin iframe
(`index.html?host=render`) with its own Strudel and superdough; it never plays, so the live engine is never stopped, suspended or
swapped, and its node pools never hold live nodes. The render is chunked: the hap query one cycle at a time, voices one 2 s chunk ahead
of the render position (`OfflineAudioContext.suspend`), a yield every ~8 ms of voice construction, progress per chunk, Cancel between
chunks. Rejected: a Worker (no Web Audio in workers), a sandboxed cross-origin frame (no storage or pack cache; Android Chrome keeps it
in-process anyway). The host shares the page's main thread (same origin), so it costs main-thread time in short slices.

Live takes check themselves (tap frame continuity from the audio thread's `currentFrame`, dropped events and re-anchors from the
scheduler counters, Chrome playout statistics where present) and a flagged take can be replaced by its offline render.

## 7. Engine worker (B1, designed, coming)
Move evaluate, the atoms / hooks / lanes passes and the pattern queries into a module Worker that loads @strudel/core, mini, tonal and
transpiler at the versions bundled in @strudel/web 1.3.0, plus the DOM-free engine modules (site/engine/*.js already run in Node for the
CLI); the main thread receives timestamped hap batches and only calls superdough against `AudioContext.currentTime`, with batches
queued early and a late batch re-anchored (the `late=reanchor` rule above). Prerequisites found while measuring: hap values must be
structured-clone safe (functions in values such as `onTrigger` / `source` stay on the main side), control, pad and hooks-journal state is
owned by the UI and must be mirrored to the worker by messages, `word()` / `voxBank` must resolve sound names without superdough, and the
visuals need the batches (or their own worker query) for future cycles. `tests/site/engine_worker.mjs` comes with it.
