# Lanes: splits, scoped taps, tags and capture without re-synthesis

Status: **issued** (design note only, nothing built; phases and issues in section 11). Builds on `docs/HOOKS_SYNTAX.md` (taps, gates, scopes), `docs/BLUEPRINT.md`
(model, graph), `docs/ATOMS.md` (typed names), `docs/CONTROL_BINDING.md` (AST ids, param shapes), `docs/CAPTURE.md` (takes, offline
render, recipes and Remake). Owner: `daw-sme`. UI parts are direction for `ui-designer`.

Word use: a **lane** here is a stream lane, one labelled pattern (`drums: ...` or `$: ...`). The Perform view's recorded control
curves are called **automation lanes** in the other docs; they are a different thing and are always written with the adjective here.

## 1. What Strudel and superdough do today (read from source)

Versions read: `@strudel/core` 1.2.6, `superdough` 1.3.0 (the site loads `@strudel/web` 1.3.0, which bundles superdough 1.3.0).
Files: `core/pattern.mjs`, `core/repl.mjs`, `core/controls.mjs`, `core/hap.mjs`, `transpiler/transpiler.mjs`,
`superdough/superdough.mjs`, `superdoughoutput.mjs`, `synth.mjs`, `modulators.mjs`.

### 1.1 Event level
- A Pattern is a pure function from a time span to haps. **Nothing is memoised.** Every query recomputes the whole chain.
- **Reuse by variable** (`const p = ...; stack(p.lpf(300), p.hpf(3000))`) reuses the *definition*. Each use is queried
  separately and returns its own haps. Two uses that both reach the output trigger two sets of voices.
- `stack(...)` concatenates the haps of its children (`flatten(pats.map(p => p.query(state)))`). `superimpose(f)` is
  `stack(this, f(this))`; `layer(f, g)` is `stack(f(this), g(this))`; `off`, `jux`, `echo`, `ply` likewise multiply haps. **Every one
  of these is an event-level split: N branches = N times the voices.**
- **Labels**: the transpiler turns `name: pat` into `pat.p('name')` and `$: pat` into `pat.p('$')`, numbered `$0`, `$1`, ... The repl
  keeps them in a table and plays `stack(...)` of them; each one is queried with `state.controls.id = <label>`. A label starting or
  ending with `_` is muted (replaced by silence). A label starting with `S` (longer than one character) solos. `hush()` clears the table.
- `all(fn)` wraps the whole stack and `each(fn)` every labelled pattern. These are the only built-in "act on many patterns" tools,
  and they select everything.
- **Tags**: `.tag('x')` appends to `hap.context.tags`; `hap.hasTag('x')` reads it. One tag per call. Nothing in Strudel selects by
  tag other than a hand-written `.filter(hap => hap.hasTag('x'))`.
- The scheduler queries the stacked pattern once per tick for a short look-ahead window and calls the output for each onset.

### 1.2 Audio level
- `superdough(value, t, duration)` builds a **new node graph per hap**: source (oscillators or buffer) -> the fixed per-voice FX
  chain (the order is superdough's, not the order of methods in the user's chain; controls are a bag of values) -> `post`
  (a gain at `postgain`). From `post`: to the orbit (or through a `dry` gain when `dry` is set), a send to the orbit delay
  (`delay`), a send to the orbit reverb (`room`), a send to an analyser (`analyze`), and a send to a bus (`bus`, `busgain`).
- **Orbit** (`orbit`, default 1): one `Orbit` object per number, created on first use: a summing node, an output gain, at most **one**
  delay, **one** reverb and one `djf` filter. These are the only shared effects. Their settings are per orbit, not per pattern:
  two patterns on one orbit that set different `delaytime`, `delayfeedback` or `roomsize` overwrite each other on every hap, and a
  changed reverb setting regenerates the impulse response. That is why Strudel's docs tell users to move patterns to another orbit.
- `duckorbit` (+ `duckonset`, `duckattack`, `duckdepth`): a hap schedules a gain dip on the *output gain* of the target orbit(s).
  It ducks everything on that orbit, including the delay and reverb returns. It is triggered by events, not by audio level.
- `channels`: which hardware outputs the orbit feeds (with `multiChannelOrbits`, orbit `i` feeds channels `2i-1, 2i`). Routing only.
- **Bus** (superdough 1.3.0, documented only in a source comment): `pat.bus(n)` sends the voice's `post` signal, scaled by
  `busgain`, to a persistent stereo gain node `n`. `s("bus").n(n)` is a registered sound whose source *is* that node, gated by the
  hap's envelope, so the bus plays through the per-voice FX chain of whatever pattern reads it. `bmod` uses a bus as an audio-rate
  modulator of another voice's parameter. A voice has one `bus` value, so **one bus send per voice**.
- Offline render (`OfflineAudioContext`) runs the same graph. `analyze` is skipped offline.

### 1.3 What is shared and what is recomputed
| | shared | recomputed |
|---|---|---|
| pattern used twice | nothing | haps (cheap), and voices if both uses sound (expensive) |
| `stack` / `layer` / `superimpose` branches | nothing | N times the voices |
| two patterns on one orbit | the orbit's delay, reverb, djf, output gain (one instance, one setting) | their voices |
| `pat.bus(n)` read by `s("bus").n(n)` k times | **the source voices: rendered once**, the bus node | k reader voices (a gain and that reader's FX nodes each) |
| `analyze` | the voices | - |

So Strudel has no event-level sharing at all, and superdough has exactly two audio-level sharing points: orbit effects (one
chain, fixed kind) and, since 1.3.0, buses (any number of readers, each with its own FX). Parallel FX on one rendered source is
possible today with `bus` + `s("bus")`. What is missing is naming, allocation, scoping, validation, seamless gating and capture.

## 2. Design decisions (with rejected alternatives)

1. **Two layers, two words.** `.tap()` stays the *event* tap (HOOKS_SYNTAX 4.6): it shares structure and values, never sound.
   `.split()` / `.send()` are the *audio* layer: they share rendered sound. Rejected: one `.tap()` that means both (a reader could
   not know whether it will trigger new voices).
2. **Audio fan-out is built on superdough's own bus**, not on a second mixer of ours. The craft layer allocates bus numbers,
   writes `bus` / `dry` / `s("bus")` for the user, validates, and captures. Rejected: our own lane-bus graph with our own insert
   effects (it would need a copy of every superdough effect, would sound different from Strudel, and is the largest cost on the table).
3. **`.split(f, g, ...)` has the signature of `.layer(f, g, ...)`.** Strudel users already write branches as `x => x.fx()`.
   Same shape, different cost: `.layer` re-triggers, `.split` does not. Rejected: a graph-only feature (code and graph are one model).
4. **A lane is a label.** Strudel already gives every labelled pattern an id in the query state. No `lane(...)` wrapper.
5. **Closed by construction.** A branch receives a bus reader and can only add effects and gating to it. Bus numbers are allocated
   per split site by the compiler and never appear in user code, so a branch of one split cannot be addressed from another. The only
   cross-lane audio path is a *named* send, which is explicit on both ends.
6. **Tags reuse `hap.context.tags`.** Strudel's `.tag()` is kept as is; selection is ours. Rejected: a separate tag store (tags
   set by Strudel code would be invisible to it).
7. **Capture is causal and replayable.** A capture is defined by a picker and a window in cycle time. What it holds is a pure
   function of the program, the journal and stored motion takes, so the CLI and Remake can regenerate it; audio is never required
   in a recipe. Rejected: captures as opaque recordings (not reproducible, not diffable, unbounded).
8. **Nothing is inferred into the music.** Splits, sends and captures only re-route what the program already plays.

## 3. Grammar

```ebnf
lane        = ( label | "$" ) ":" pattern-chain ;                       (* Strudel's own syntax; label = lane id *)

split-call  = "." "split" "(" branch { "," branch } [ "," split-opts ] ")" [ "." "merge" "(" [ branch ] ")" ] ;
branch      = arrow-fn ;                                               (* b => b.room(0.8).lpf(800): effects and gating only *)
split-opts  = "{" [ "mix" ":" "[" number { "," number } "]" ] [ "," "pre" ":" boolean ] "}" ;
send-call   = "." "send" "(" bus-name [ "," amount ] ")" ;              (* named, cross-lane; amount 0..1, default 1 *)
ret-call    = "ret" "(" bus-name ")" ;                                 (* a reader pattern of a named bus; start of a return lane *)

tap-pub     = "." "tap" "(" name [ "," "{" "export" ":" boolean "}" ] ")" ;   (* event tap; local to its lane unless exported *)
tags-call   = "." "tags" "(" tag { "," tag } ")" ;                      (* same effect as chained Strudel .tag(t) *)
selection   = "tagged" "(" selector ")" "." sel-op "(" args ")" { "." sel-op "(" args ")" } ;
sel-op      = "fx" | "send" | "mute" | "solo" | "gain" | "orbit" | "capture" ;
selector    = sel-or ;      sel-or = sel-and { "|" sel-and } ;   sel-and = sel-not { "&" sel-not } ;
sel-not     = [ "!" ] ( tag | "#" lane-id | "(" sel-or ")" | "*" ) ;

capture     = "capture" "(" name "," picker [ "," capture-opts ] ")" ;
picker      = selector-string | tap-ref | "bus:" bus-name | "master" ;
capture-opts= "{" [ "window" ":" gate ] [ "," "last" ":" length ] [ "," "what" ":" "[" layer { "," layer } "]" ]
                  [ "," "live" ":" ( boolean | "auto" ) ] [ "," "max" ":" length ] "}" ;
layer       = "events" | "audio" | "level" ;
recall      = "recall" "(" name [ ":" facet ] [ "," recall-opts ] ")" ;  (* a Pattern *)
facet       = "ev" | "audio" | "level" | "onset" | "gate" | control-name ;
from-call   = "." "from" "(" name ")" ;                                 (* play this pattern's events on the captured audio *)
```

`gate`, `length` and tap-ref are HOOKS_SYNTAX grammar. Names, bus names, tags and selectors can be atoms (types `name`, `busname`,
`tag`, `selector`, `capture`; section 10).

## 4. Semantics: event layer

### 4.1 Memoised taps
`.a().b().tap("x").c().d()` publishes the pattern as it is after `.b()`: haps with the values `a` and `b` set. That is already
true (HOOKS_SYNTAX 4.6). New: a tap keeps a **query cache**.
- Key: `(tap id, span begin, span end, controls signature, registry version)`. Controls signature = `_cps`, `id`, scope.
- Value: the hap array, frozen. Size: the last 32 spans per tap, least recently used out.
- Safe because patterns are pure in time; Strudel's randomness is a function of cycle time. The cache is cleared on every
  evaluation and on any registry change (same `touch()` as today).
- Effect: all readers of one tap in one scheduler tick share one computation of everything upstream of the tap. Readers that shift
  time (`.late`, `.fast`) ask for other spans and compute their own; correct, just not shared.
- Facets with look-back (`env`, held params) query in whole-cycle chunks so their keys repeat across ticks.

What this shares and what it does not: it shares *hap computation*. A reader that sends tapped events to the output still
triggers its own voices. Event taps are for structure and control (`.struct(tap("k:onset"))`, `.gain(tap("k:env"))`), not for sound.

### 4.2 Lane scope
- Every labelled pattern is a lane; its id is the label (`$0`, `$1` for anonymous ones). The id is available at query time
  (`state.controls.id`), so `.ns(label)` is implied: `.tap("x")` in lane `drums` publishes `drums/x`.
- A read `tap("x")` resolves in its own lane first, then exported names. A read of another lane's name needs the publisher to
  export it (`.tap("x", { export: true })`), then both `tap("x")` (if unique) and `tap("drums/x")` work.
- Compatibility: programs in the wild use global tap names. Default mode is **open**: an unexported cross-lane read works and
  `check` reports `W_LANE_IMPLICIT_EXPORT`. `lanes.closed()` in the header (and every new recipe) makes it `E_LANE_PRIVATE`.
- Names published inside a split branch are always local to that branch (no open mode there).

### 4.3 Tags and selection
- `.tags("drums", "wet")` = `.tag("drums").tag("wet")`. With literal arguments directly on a lane's chain the tags are also
  recorded statically as lane metadata (model, graph, packs). Tags set deeper (inside `.when(...)`) are per-hap only.
- `tagged(sel)` selects haps whose tags (or lane id for `#id`) satisfy the selector. Ops, applied in the outermost wrapper the
  site and CLI already use for control maps, so they see every lane:

| op | effect |
|---|---|
| `.fx(f)` | `f` applied to the matching haps as a pattern (`stack(f(p.filter(match)), p.filter(!match))`); per-voice effects |
| `.gain(g)`, `.orbit(n)` | sugar for `.fx(x => x.gain(g))`, `.fx(x => x.orbit(n))` |
| `.mute()`, `.solo()` | drop the matching haps / drop all others. Several `solo()` selections add up. Both take a gate: `.mute("9b..17b")` |
| `.send(bus, amount)` | group send to a named bus (section 5.3) for every matching lane |
| `.capture(name, opts)` | the selection as a capture picker (section 6) |

- Selections are header statements, evaluated in order; they are registry entries, so they serialize, can be gated like bindings,
  toggled from pads (`pad target kind: "selection"`) and journaled.
- The same selector grammar filters atoms and pack items by their `tags` in the browser and in `strudel atoms list --tag`.

## 5. Semantics: audio layer

### 5.1 Split
```js
drums: s("bd*4, hh*8").lpf(4000)
  .split(dry => dry,
         wet => wet.room(0.9).rsize(6).lpf(900),
         grit => grit.crush(5).hpf(2000).gain(0.4))
```
compiles (before Strudel's transpiler; bus 64 allocated to this split site) to the plain Strudel program:
```js
drums: stack(
  s("bd*4, hh*8").lpf(4000).dry(0).bus(64),
  s("bus").n(64).attack(0.005).release(0.005),
  s("bus").n(64).attack(0.005).release(0.005).room(0.9).rsize(6).lpf(900),
  s("bus").n(64).attack(0.005).release(0.005).crush(5).hpf(2000).gain(0.4))
```
- **Source**: everything before `.split` is rendered once, per voice, with its per-voice effects (`lpf(4000)` here is one filter
  per note). `dry(0)` removes its direct path; its `post` signal goes only to the bus.
- **Branch**: the function receives a **bus reader**: one hap per cycle of `s("bus").n(k)` with a 5 ms linear attack and release.
  Consecutive reader haps cross-fade the same signal linearly, so the reader is continuous. What the branch adds is applied by
  superdough to that reader voice: **bus effects** (one filter for the whole lane, like an insert on a group), not per-note effects.
- A branch may change the reader's *structure*: `gate => gate.struct("x*8").decay(0.05)` is a rhythmic gate on the lane audio.
  A branch may not change what the reader is: setting `s`, `n`, `note`, `bus` or `dry` in a branch is `E_LANE_SOURCE` (checked on the
  queried haps of each branch).
- **Join**: without `.merge`, the branches sum at the lane's orbit. Effects written after `.split(...)` are added to each
  branch reader separately (same result for linear effects, not for compression or distortion): `W_LANE_POST_SPLIT` when a
  non-linear control follows a split without a merge.
- `.merge(f)`: the branches send to a second allocated bus instead of the orbit, and one reader of that bus carries `f` and
  everything written after it. One more bus and one more reader voice; the chain after `.merge` is a true sum bus.
- `mix: [1, 0.5, 0.25]` sets branch `postgain`s. `pre: true` keeps the source's direct path as well (parallel processing over the
  dry signal without a `dry => dry` branch).
- Orbit effects (`room`, `delay`, `djf`) written *before* the split still send from the source voices to the source's orbit;
  inside a branch they send from the reader. Each branch may set its own `orbit`; `W_LANE_ORBIT_FX` when two readers or lanes on one
  orbit ask for different delay or reverb settings (this also flags the existing Strudel overwrite hazard in programs with no splits).
- Splits nest (a branch may split). The result is a tree; every edge is a bus nobody else can name.

### 5.2 Mid-chain audio tap
There is no "stage in the middle of the voice chain" to tap: superdough's per-voice chain has a fixed internal order and one
output (`post`). The position of `.split` in the *method chain* decides which controls belong to the source voices (before) and
which to bus readers (after). `.a().b().split(x => x.c().d(), y => y.e())` is the audio form of `.a().b().tap("x").c().d()`:
`a` and `b` are rendered once; `c`, `d` and `e` are parallel bus chains on that one render.

### 5.3 Named sends and returns (the only way across lanes)
```js
drums: s("bd*4").send("verb", 0.3)
keys:  note("c e g").s("piano").send("verb", 0.6)
verb:  ret("verb").room(1).rsize(8).lpf(3000)
```
- A voice has one `bus` value, so every lane that sends or splits gets a **lane bus**: source voices -> lane bus (`dry(0)`);
  readers of the lane bus: the main output, each split branch, and one reader per send that forwards to the named bus with
  `dry(0).bus(named).busgain(amount)`. `pre`-style direct output is kept when the lane has only sends and no split (the source keeps
  its direct path and one reader forwards the send), so a plain lane with one send costs one extra reader voice.
- `ret(name)` is a bus reader pattern for a named bus; it starts a lane. A named bus may have several returns.
- Bus numbers: split and lane buses from 64 upward in source order, named buses from 512 upward in name order. User-written
  `.bus(n)` below 64 is left alone; `n >= 64` in user code is `E_BUS_RANGE`.
- Errors: a send to a name with no `ret`: `W_BUS_NO_RETURN` (silent, not fatal). A cycle in the send graph (a return that sends,
  directly or through others, to its own bus): `E_LANE_CYCLE`; Web Audio would mute such a loop silently. A `ret` inside a split
  branch or a branch reader used outside its split: `E_LANE_CROSS`.
- Audio-rate modulation from a bus (`bmod`) is exposed as `.wire(param, "bus:name", opts)`; it carries the raw signal, not an
  envelope. Event-driven ducking stays `duckorbit` or the event-level `tap("k:env")`.

### 5.4 Errors and warnings
| code | when |
|---|---|
| `E_LANE_SOURCE` | a branch changes `s`, `n`, `note`, `bus` or `dry` of its reader, or returns a pattern not made from it |
| `E_LANE_CROSS` | a reader or branch-local name is used outside its split; `ret` inside a branch |
| `E_LANE_CYCLE` | cycle in the send / return graph |
| `E_LANE_PRIVATE` | closed mode: read of another lane's unexported tap |
| `E_LANE_DUP` | two lanes with one label and different code in one program (Strudel silently keeps the last) |
| `E_BUS_RANGE` | user `.bus(n)` in the allocated range |
| `E_LANE_HOST` | the host's superdough has no `bus` sound (older than 1.3.0); the split is refused, never silently replaced by `layer` |
| `W_LANE_IMPLICIT_EXPORT` | open mode: cross-lane read of an unexported tap |
| `W_LANE_POST_SPLIT` | non-linear effect after a split without `.merge` |
| `W_LANE_ORBIT_FX` | conflicting orbit delay / reverb settings on one orbit |
| `W_BUS_NO_RETURN` | send with no return |
| `W_LANE_REFRAIN` | a reader's structure leaves gaps while the source plays (reported with the silent fraction; intended for gates) |

## 6. Capture and recall

### 6.1 Declaring
```js
capture("groove", "#drums", { window: "5b..9b", what: ["events", "audio", "level"] })
capture("last2",  "drums & !wet", { last: "2b" })                 // rolling: always the two bars before now
capture("kx",     "drums/kick", { window: "1b..5b" })             // an event tap: events only
```
- **Picker**: a selector (lanes and tagged haps), an event tap ref, `bus:<name>`, or `master`. Audio and level need an audio
  picker (lanes, bus, master); a tap ref gives events only (`E_CAPTURE_LAYER` otherwise).
- **What is recorded**, in the capture's own scope (nothing in it is visible except through `recall`):
  - `events`: the haps as they were triggered in the window: whole begin and end as cycle fractions relative to the window
    start, the full value, lane id, tags. Values are after hooks, selections, control maps and pads, as they unfolded.
  - `audio`: stereo PCM of the picked lanes' sum, read from their lane buses (from the orbit outputs for `master`), sample
    accurate on window boundaries (same frame arithmetic as CAPTURE.md).
  - `level`: RMS and peak per 1/64 cycle from that audio.
  - Always: `{ start, length }` in cycles, `cps`, sample rate, and a content hash.
- **Window**: a HOOKS gate with a single bounded window (`from` and `until`), or `last: L` for a rolling capture.

### 6.2 Time
- A window capture is **empty until its window closes**. It freezes at `until` and is immutable from then on. `recall` before that
  yields its `else` (silence for events and audio, `default` for values).
- **Ahead-of-time resolution.** If the picked lanes depend only on the program, the journal and stored motion takes (no manual
  control, pad or input that has not happened yet), the capture is *pure*: its content can be computed before the window is
  reached by rendering that window offline (events by query, audio by the offline render CAPTURE.md already has). A pure capture
  is available to `recall` from cycle 0. `live: "auto"` (default) decides this by static check (does anything picked read a control
  with no automation lane, a pad tap, or an input); `live: true` forces waiting for real playback; `live: false` forces offline and
  is an error (`E_CAPTURE_LIVE`) when live sources are involved.
- A **live** capture is causal: it is usable from `until + guard`, `guard` = 1 cycle by default (the time to hand the audio to
  the sampler on a phone). A `recall` whose gate opens earlier: `E_CAPTURE_EARLY` in `check --strict`, `else` when live.
- **Rolling** (`last: L`): at each cycle boundary `q` the capture's state is the content of `[q - L, q)`. `recall` at cycle `c` sees
  the state of the last boundary at or before `c - guard`. It is a function of `c`, so headless and live agree.
- **Headless and Remake**: everything is known from the model and journal, so every capture is resolved by passes: pass 1 renders
  each capture's picked lanes over its window (in dependency order: a capture may pick lanes that recall another capture; a
  cycle is `E_CAPTURE_CYCLE`), pass 2 renders the program with captures available under the same `guard` rule as live, so the two
  agree. A recipe stores captures as *definitions*; Remake regenerates them and the final hash covers them. Stored capture audio
  is only a cache, keyed by the hash of (compiled program, window, cps, sample rate, engine versions).
- Tempo: a capture stores its `cps`. Recalled events follow the current tempo (they are in cycles). Recalled audio is a sample of
  `length` cycles; at another tempo it is repitched by default (`loopAt` behaviour) or stretched with `{ stretch: true }` where the
  host has the warp tool (CLI) and refused on the site (`W_CAPTURE_TEMPO`).

### 6.3 Using a capture
| form | gives | notes |
|---|---|---|
| `recall("g")` / `recall("g:ev")` | the captured haps as a pattern, looping with the capture's length | re-triggers voices (it is events); `.once()` plays it one time; `{ at: point }` sets the loop origin, default cycle 0 |
| `recall("g:audio")` | `s("cap_g").loopAt(length)`: the captured audio as a sample, one hap per loop | no synthesis; every sample function applies: `.chop(16)`, `.slice(8, "0 3 2 1")`, `.speed(-1)`, `.begin()`, `.end()`, `.striate()` |
| `pat.from("g")` | `pat.s("cap_g")` | "use it as a sample source" with the pattern's own rhythm and controls |
| `recall("g:level")` | continuous signal 0..1 from the captured level, looping | a real audio envelope: `.gain(recall("k:level").range(1, 0.3))` |
| `recall("g:onset")`, `:gate`, `:<control>` | the tap facets of HOOKS_SYNTAX 4.6 computed on the captured events | `.struct(recall("g:onset"))` |
| `recall("g").freeze()` | holds the current content of a rolling capture until `.thaw()` (gateable, journaled) | "freeze or loop it" |
| bounce | a take in the capture store and a WAV (`strudel capture`, the takes sheet) | same record as a CAPTURE.md take, `meta.from` = capture name |

Captured audio is registered with superdough's public `registerSound` / sample map under `cap_<name>`; `E_CAPTURE_NAME` when that
sound name already exists.

### 6.4 Bounds
| item | default | limit behaviour |
|---|---|---|
| audio per capture | `max` = 32 s (stereo float at 48 kHz = about 12 MB) | longer window: `E_CAPTURE_LIMIT` at check; never truncated silently |
| all capture audio, site | 96 MB desktop, 32 MB when `navigator.deviceMemory <= 4` | new capture refused with a toast and `E_CAPTURE_MEMORY`; rolling captures with no reader are dropped first |
| events per capture | 20 000 haps | `E_CAPTURE_LIMIT` |
| level | 64 points per cycle, float | - |
| rolling buffer | exactly `last` long, one ring buffer per capture | - |
| CLI | captures are WAV files in `OUT_DIR/captures/`, not held in memory | disk only |

## 7. Worked examples

**1. Parallel FX on one render** (section 5.1 program): 12 source haps per cycle and 3 readers, instead of 36 voices with `.layer`.

**2. Event tap mid-chain, shared by three readers**
```js
drums: s("bd*4, ~ sd ~ sd").bank("RolandTR909").tap("hits", { export: true }).room(0.2)
bass:  note("c2*8").s("sawtooth").gain(tap("hits:env", { r: 0.2 }).range(1, 0.4))
lead:  note("c4 eb4 g4").s("square").struct(tap("hits:onset"))
hats:  s("hh*16").gain(tap("hits:gate").range(0.9, 0.5))
```
One computation of the drum chain per tick for all three readers; no extra drum voices.

**3. Merge: glue compression on the sum of the branches**
```js
drums: s("bd*4, hh*8").split(d => d, w => w.room(0.8)).merge(m => m.compressor("-18:4:6:0.003:0.1")).gain(0.9)
```

**4. Rhythmic gate on a pad, source rendered once**
```js
pad: note("<c3 eb3 g3 bb3>").s("supersaw").release(1)
  .split(g => g.struct("x*16").decay(0.04).sustain(0), d => d.gain(0.3))
```

**5. Shared reverb return with group send by tag**
```js
drums: s("bd*4, hh*8").tags("drums")
snare: s("~ sd").tags("drums", "wet")
keys:  note("c e g").s("piano").tags("harm", "wet")
verb:  ret("verb").room(1).rsize(8)
tagged("wet").send("verb", 0.5)
tagged("drums").fx(x => x.hpf(40)).mute("33b..37b")
```

**6. Crossing is refused**
```js
a: s("bd*4").split(x => x.tap("inner").lpf(500))
b: s("hh*8").gain(tap("inner:env"))            // E_LANE_PRIVATE / E_LANE_CROSS: "inner" is local to a's first branch
v: ret("v").send("v")                            // E_LANE_CYCLE: v -> v
```

**7. Capture a bar group and reuse it as a sample**
```js
lanes.closed()
drums: s("bd*4, ~ sd ~ sd, hh*8").tags("drums")
capture("groove", "drums", { window: "1b..3b", what: ["events", "audio", "level"] })
chop:  n("0 3 2 1 4 7 6 5").from("groove").slice(8).gain(0.8).mask("<0 0 1 1>")
bass:  note("c2*8").s("sawtooth").gain(recall("groove:level").range(1, 0.3))
```
The capture is pure (no live source), so `chop` and `bass` can use it from cycle 0; live and headless agree.

**8. Rolling capture, freeze from a pad**
```js
capture("last2", "#lead", { last: "2b" })
stutter: recall("last2:audio").chop(8).freeze().mask(tap("pads/stutter:gate"))
```
`freeze()` is toggled by a pad (journaled), so a recorded performance replays in the CLI.

**9. Captured events as a second voice, without the audio**
```js
capture("riff", "lead/line", { window: "1b..5b" })
echo: recall("riff").add(note(12)).s("triangle").late(0.25).gain(0.5)
```

**10. What the user's Strudel habit costs** (for comparison, no craft syntax)
```js
$: s("supersaw").note("<[c3,eb3,g3,bb3]>").layer(x => x, x => x.room(0.9), x => x.crush(5))   // 3 x the oscillators
```

## 8. Implementation sketch

One new module `site/engine/lanes.js` (no DOM, shared with the CLI), plus changes in `hooks.js`. Strudel and superdough are
never modified: we write ordinary Strudel code and call public functions.

- **Compile pass** (text to text, acorn, runs after the atoms pass and before control-site rewriting):
  1. find lanes (labelled statements), `.split`, `.merge`, `.send`, `ret(`, `capture(`, `tagged(`, `lanes.closed()`;
  2. give each site a structural id (section 10), allocate bus numbers in source order;
  3. rewrite `.split(f, g)` to a `stack(...)` of the source with `.dry(0).bus(k)` and `__reader(k, siteId, i)` passed through each
     branch; rewrite `.send` and `ret`; leave `capture` / `tagged` / `recall` as runtime calls;
  4. return `{ code, map, graph }`: the lane graph (lanes, buses, edges, tags, captures) used by check, the model and the UI.
- **Runtime** (`lanes.js`): `__reader(k, ...)` returns `s("bus").n(k)` with the cross-fade envelope and a hidden context mark; the
  outermost wrapper checks branch outputs (`E_LANE_SOURCE`), applies selections, feeds event captures; `recall`, `ret`, `tagged`,
  `capture` are globals installed like `tap` (collision check on install; all names checked free in core 1.2.6: `split`, `merge`,
  `send`, `ret`, `tags`, `tagged`, `capture`, `recall`, `from`, `lanes`. `join` is taken by Strudel, hence `merge`).
- **Tap memo**: in `hooks.js` `publish`, wrap the published pattern's query with the LRU cache of section 4.1.
- **Site, audio capture**: `getSuperdoughAudioController().getBus(k)` (already reachable; `capture.js` uses the controller) gives the
  lane bus node; connect the existing capture worklet to it instead of the master bus. Pure captures use the existing offline
  render restricted to the picked lanes. The resulting `AudioBuffer` is registered as sound `cap_<name>`.
- **CLI**: the same compile pass; `strudel lanes IN` prints the lane graph; `strudel capture IN --name N [-o N.wav]` bounces;
  `render` runs the capture passes of 6.2. **Stems**: today each `$:` layer is evaluated alone, which would leave a reader
  with an empty bus. Stems are therefore rendered per **lane group** (a connected component of the bus graph): the group's lanes are
  evaluated together and each *output-carrying* lane (a return, a lane with direct output) is soloed by muting the other
  outputs with `postgain(0)` on their readers, not by removing their sources.
- **Host check**: on install, look up the `bus` sound and the `bus` control; absent -> `E_LANE_HOST` for audio features, event
  features still work.

## 9. Cost

Counts are per cycle; `V` = source voices, `B` = branches, `S` = sends, `R` = reader haps per cycle (1 unless a branch gates).

| approach | voices built | notes |
|---|---|---|
| `.layer` / `.superimpose` / variable reuse | `V * B` | every oscillator, sample player and per-voice filter again |
| `.split` | `V + B * R` | a reader is a gain plus that branch's FX nodes; no source |
| `.split(...).merge()` | `V + B * R + 1` | one more bus and reader |
| lane with sends | `V + 1 + S` (or `V + S` with no split) | readers forwarding to named buses |
| event tap, k readers | hap work once per tick instead of k times; 0 voices | memory: up to 32 cached spans per tap |

- Example (estimate, to be measured in the build issue): a four-note `supersaw` chord (superdough builds several detuned
  oscillators per voice) through three parallel effect branches is 12 voices with `.layer` and 4 voices + 3 readers with `.split`.
- Cost that grows: one bus node per split or named bus (a stereo gain, kept for the session); reverb per orbit is the heavy
  node, so branches that each want their own reverb settings need their own orbit (one convolver each), exactly as in Strudel today.
- Latency added: none (same audio graph, same render quantum).
- Audible difference from `.layer`: effects in a branch act on the lane sum (one filter, one distortion for all notes).
  Distortion and compression therefore intermodulate between notes. That is the DAW group-insert behaviour and is the point,
  but it is not a drop-in replacement for per-note effects; per-note controls belong before the split.
- Capture: audio memory per section 6.4; a pure capture costs one extra offline render of its window (faster than real time);
  a live capture costs one worklet per captured bus.
- Compile pass: one more parse of the program text per settled edit (the control-site pass already parses once; share the AST).

## 10. Model, graph, typed params, ids

- **Model** (`strudelcraft.model/1`, additive): `tracks[].tags`, `tracks[].split` (`{ site, branches: [{ id, chain }], merge, mix, pre }`),
  `tracks[].sends` (`[{ bus, amount }]`), `buses` (`{ name: { returns: [track] } }`), `selections[]` (`{ selector, ops, gate }`),
  `captures` (`{ name: { picker, window | last, what, live, max } }`), `settings.lanes` (`"open" | "closed"`).
- **Graph**: a **lane card** is the existing track node, now with a tag row and an output port of the new wire type `audio`
  (BLUEPRINT 4.2 gains a sixth type: `audio`, drawn as a thick bar, badge `bus`). A **split** is drawn inside the lane card as a
  fan: one audio wire in, one sub-chain per branch, a join mark (sum, or the merge chain). A **tap port** is an event port on the
  step where `.tap()` sits (`pattern` / `signal` wires; exported taps show on the card edge, local ones only inside). A **named
  bus** is one small node with sends in and returns out. A **capture node** has a picker input (audio or pattern wire, or a
  selector chip), window fields, and one output port per recorded layer (`ev`, `audio`, `level`). A **selection** is a chip node;
  it is not wired to every match (that would draw N wires); matching lanes show the chip and the selection node lists its matches.
- Crossing rules are enforced in the graph too: a wire from inside a split to outside it is refused with the `E_LANE_CROSS` text;
  the offered fix is "Export tap" or "Add send".
- **Typed param shapes** (CONTROL_BINDING section 1) added: `lane` (declared lane ids), `busname`, `tag` (open enum: tags seen in
  the program and packs), `selector`, `capture` (declared capture names + facet list), `branch` (a callback whose body is completed
  with bus-safe controls only: effects, `gain`, `pan`, `orbit`, structure; not `s`, `n`, `note`), `gate` and `length` (existing).
- **Intellisense**: inside a branch callback only the `branch` control set is offered; `recall("` offers capture names then
  facets valid for what that capture records; `tagged("` offers tags, `#lane` ids and the operators; `ret("` and `.send("` offer bus
  names; `.from("` offers captures that record audio. Hover on `.split` shows the voice count comparison for that site.
- **Atoms**: types `tag`, `selector`, `busname`, `capture` (string-typed, single-quoted) join the registry; lane ids use `name`.
  Atom `tags` (ATOMS schema) and pack item tags are matched by the same selector grammar.
- **AST ids**: sites use the control-binding structural path. Split: `p` + hash of `L<n>/<chain>.split`; branch: that path + `#i`;
  send: `...send#0`; capture: `q` + hash of the capture name (name-keyed, like atoms); selection: `g` + hash of statement path.
  Ids are kept by the same reconciliation as control sites, so a pad, board cell or map bound to a control inside a branch, or to a
  selection's mute, survives edits. Bus numbers are *not* ids (they are reallocated per compile); nothing stores them.

## 11. Phases

| phase | issue | deliverable | depends on | owner |
|---|---|---|---|---|
| L1 | #74 | event layer: memoised taps, lane-scoped taps, tags and selections, lane graph check, `strudel lanes` | hooks runtime | daw-implementer |
| L2 | #75 | audio layer: `.split`, `.merge`, `.send`, `ret` on superdough buses; lane-group stems; measured seam and cost | L1 | daw-implementer |
| L3 | #76 | capture and recall: events, audio, level; causal and ahead-of-time; CLI passes; Remake | L1, L2 | daw-implementer |
| L4 | #77 | model, graph data, typed param shapes, intellisense, atom types, AST ids | L1 (grows with L2, L3) | daw-implementer |
| L5 | #78 | lane cards, split fan, bus and capture nodes, tag chips | L4 (L2, L3 for live behaviour) | ui-designer |

## 12. Open questions

1. **Reader seam.** The 5 ms linear cross-fade between consecutive reader haps should be exactly unity for an identical signal.
   It must be measured on the site and in the CLI (chunked offline contexts, hap times in floats). If it is not clean, the fallback
   is one long reader hap per N cycles, which breaks when playback starts mid-hap. This is the biggest technical risk.
2. **Undocumented API.** `bus` / `s("bus")` / `bmod` exist in superdough 1.3.0 with a one-comment description. Pin the version (the
   site already pins 1.3.0) and guard with `E_LANE_HOST`; watch upstream for changes before any upgrade.
3. **Closed by default?** Open mode keeps old programs working. Should new documents in the site start with `lanes.closed()`?
4. **Per-note effects after a split.** Is `W_LANE_POST_SPLIT` enough, or should a branch be allowed to opt back into re-triggering
   (`.split(...)` mixed with one `layer`-style branch) for the cases where per-note effects are wanted?
5. **Site offline render and hooks.** CAPTURE.md says the offline render does not include hooks, pads or perform mappings. Pure
   captures on the site need them (through the journal). Is extending that render part of this work or a prerequisite issue?
6. **Level definition.** RMS over 1/64 cycle, linear 0..1 against full scale. Is a perceptual (K-weighted, dB-mapped) option wanted
   for ducking curves?
7. **`master` capture and feedback.** Recalling a master capture into the same master records itself on the next pass of a rolling
   window. Refuse (`E_CAPTURE_CYCLE`) or allow with a required gain below 1?
8. **Stems semantics.** With lane groups, a return lane's stem contains every sender's reverb. Is a per-sender wet stem wanted
   (costs one render per sender)?
