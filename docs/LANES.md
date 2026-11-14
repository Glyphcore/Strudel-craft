# Lanes: splits, scoped taps, tags and capture without re-synthesis

Status: **L1 built** (#74: memoised taps, lane-scoped taps, tags, selections, lane graph and checks; see "Built in L1" below) and **L2 built** (#75: `.split`, `.merge`, `.send`, `ret`, `.wire` to a bus, group `tagged().send`, as a compile pass on superdough buses; see "Built in L2", section 11c). **L4 built** (#77, section 11b) and **L5 built** in the Graph view (#78, section 11d, including the capture node's Bounce, Freeze / Thaw and Use as sample) and **L3 built** on the site (#76, section 11e). The CLI commands (`strudel lanes`, `capture`, `render`, `events`, `stems` for lane programs) are pending in the other repo. Builds on `docs/HOOKS_SYNTAX.md` (taps, gates, scopes), `docs/BLUEPRINT.md`
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
  s("bus").n(64).attack(0.01).release(0.01).gain(1),
  s("bus").n(64).attack(0.01).release(0.01).gain(1).room(0.9).rsize(6).lpf(900),
  s("bus").n(64).attack(0.01).release(0.01).gain(1).crush(5).hpf(2000).gain(0.4))
```
- **Source**: everything before `.split` is rendered once, per voice, with its per-voice effects (`lpf(4000)` here is one filter
  per note). `dry(0)` removes its direct path; its `post` signal goes only to the bus.
- **Branch**: the function receives a **bus reader**: one hap per cycle of `s("bus").n(k)` with a 10 ms linear attack and release and `gain(1)` (superdough clamps a release to at least 10 ms, so a 5 ms attack would sum to 1.5x at each seam; the default gain 0.8 would also lower the lane by 2 dB).
  Consecutive reader haps cross-fade the same signal linearly, so the reader is continuous. What the branch adds is applied by
  superdough to that reader voice: **bus effects** (one filter for the whole lane, like an insert on a group), not per-note effects.
- A branch may change the reader's *structure*: `gate => gate.struct("x*8").decay(0.05)` is a rhythmic gate on the lane audio.
  A branch may not change what the reader is: setting `s`, `n`, `note`, `bus` or `dry` in a branch is `E_LANE_SOURCE` (checked on the
  queried haps of each branch).
- **Playback start**: the first reader of a run fades in over 10 ms (nothing precedes it to cross-fade with), so a note that starts exactly at the first cycle boundary loses its first 10 ms of attack, once. Seams between consecutive cycles are unity (measured). A branch that gates (`struct`) fades each gate hap the same way.
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
- (Built form in L2: the `.send` calls of a chain are removed and read the lane's *last* bus: the split bus, the merge bus when there is a merge, or a lane bus of their own when the lane has no split. The source keeps its direct path in the no-split case; each send is one extra reader voice. A group send `tagged(sel).send(name, amount)` is resolved by the compile pass against the lanes whose literal `.tags(...)` or `#id` match and becomes a `.send` on each of them; tags set deeper (inside `.when`) are not matched and `W_LANE_SELECT_EMPTY` reports a selector that matches no lane.)
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
- Audio-rate modulation from a bus (`bmod`) is exposed as `.wire(param, "bus:name", opts)` (compiled to `.bmod({ bus: N, control: 'param', ...opts })`, opts `depth`, `depthabs`, `dc`, `subControl`); it carries the raw signal, not an
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
| `E_LANE_OPTS` | (L2) malformed split options (`mix` length, unknown key) or a non-literal bus name |
| `E_LANE_COMPILE` | (L2) `tagged(...).send` evaluated without the compile pass |
| `W_LANE_SELECT_EMPTY` | (L2) `tagged(sel).send(...)` whose selector matches no lane at compile time |

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
chop:  s("x").from("groove").slice(8, "0 3 2 1 4 7 6 5").gain(0.8)
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

- **Measured (#75, `tests/site/lanes.mjs`, Chromium headless in the CI sandbox, @strudel/web 1.3.0 offline render, 4 cycles, median of 3):** a four-note `supersaw` chord
  (`note("[c3,e3,g3,b3]").s("supersaw").release(0.3)`) through three branches (`a => a`, `b => b.room(0.9)`, `c => c.crush(5)`):

  | per cycle | `.layer` | `.split` | split / layer |
  |---|---|---|---|
  | superdough voices (haps played) | 12 | 7 (4 source + 3 readers) | 0.58 |
  | supersaw oscillator sources (AudioWorkletNode) | 12 | 4 | 0.33 |
  | audio nodes constructed (gain, filter, worklet, convolver, ...) | 105.5 | 64.8 | 0.61 |
  | offline render time for 4 cycles | 1991 ms | 886 ms | 0.44 |

  The estimate above (12 voices vs 4 + 3) held; the saving that matters is the oscillator sources (the heavy part of a supersaw voice) and the render time. Node counts are
  counted by wrapping the node constructors in the test page only (a measurement instrument, not part of the site). Times are from a loaded shared sandbox: use the ratio, not the milliseconds.
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

## 11a. Built in L1 (#74)
Files: `site/engine/hooks.js` (tap cache, lane scope, `hooks.invalidate / laneMode / gateAt / record / ext`), `site/engine/lanes.js` (scan,
compile, check, runtime), `site/engine/controls.js` (`onChange`), `site/engine/index.js` (wiring), test `tests/lanes/l1.mjs`.
Where the build differs from, or fixes, the text above:
- Lane id on a hap: haps do not carry the label, so `lanes.js` wraps `Pattern.prototype.withState` (the call the repl uses to set `state.controls.id`) and stamps
  `context.lane` on the returned haps, only while at least one `tagged()` selection exists (a program without selections yields the same haps as before).
- The cache lives in the object `.tap()` returns and publishes (one per tap), so a reader in another lane shares the entry: the memo queries upstream with the
  publisher's own lane id. `hooks.invalidate()` is the control-change path; republishing a tap name drops all caches.
- `tagged(sel)` returns a selection (`fx gain orbit mute solo`, chainable); selections are applied to the haps of the outermost query (`site/engine/index.js` runs them before
  the control maps; headless hosts get their own wrapper). `fx(f)` runs `f` on a pattern of the matched haps over the queried span, so value effects (`hpf`, `gain`, `room`)
  are exact and time-moving functions only see haps of the same query. Identical statements collapse, so re-evaluation is idempotent; `protect()` (run before every
  evaluation) resets the registry so deleted statements disappear.
- `mute` / `solo` take a gate or a boolean (`mute(false)` starts off). Live toggles go through `lanes.set(selectionId, op, on, at)`, journalled as `{ op: "sel" }` entries
  that `toJSON` and `load` carry; selections serialise as `selections[]` (an `fx` function is `{ opaque, src }` and needs `load(json, { allowCode: true })`).
- `lanes.js` `compile(src)` is a read-only skeleton in L1: `code` is the input and `map` the identity; `graph` has `lanes` (id, label, line, tags, taps with export flag, reads, orbit),
  `tags`, `selections` (selector and op text), `mode` and `diagnostics`. `check(src, { strict })` reports `E_LANE_DUP`, `W_LANE_ORBIT_FX`, `W_LANE_IMPLICIT_EXPORT`,
  `E_LANE_PRIVATE` (statically; the runtime raises the last two when it sees the read) and `E_BAD_SELECTOR`. L2 adds the rewrites.
- Anonymous lanes are `$0`, `$1`, ... in source order, as Strudel numbers them; `tap("$0/x")` is a valid ref.
- Not built in L1 (marked coming in `site/data/syntax.json` where still true): `capture`, `recall`, `.from` at runtime, the `strudel lanes` command, UI (L5); `.split`, `.merge`, `.send`, `ret` are built in L2 (section 11c). Model, graph data, param shapes, intellisense, atom types and ids: section 11b.

## 11b. Built in L4 (#77)
Files: `site/model.js` (records, `graph`, `checkWire`, ops `addBranch exportTap addSend`), `site/engine/lanes-data.js` (site ids, selector matching, capture facets, pad selection target), `site/lanes-intellisense.js`,
`site/data/schema/model.v1.json`, `site/data/intellisense/strudel.json` (`params`, `shapes`, `lanes`), `site/data/atoms/types.json` + `positions.json`, `site/engine/pads.js` (target kind `selection`); tests `tests/lanes/l4.mjs`, `tests/site/lanes_data.mjs`. Data entry points for the UI (#78) are listed in site/README.md.
Where the build differs from, or settles, the text above:
- Everything in the model is derived from the code (`tags`, `split`, `sends`, `ret`, `buses`) or kept verbatim (header statements `tagged`, `capture`, `lanes.closed()` in `hookSrc`), so `generate(parse(code))` stays byte-identical and a document without lanes has the same model, hash and `graph()` as before.
- `selections[]` use the shape of the hooks runtime JSON (`{ op: "mute", gate }`, `{ op: "fx", opaque, src }`, ...), so a config and a program describe selections the same way. A branch records its verbatim `src` and, when the body is a plain method chain on the parameter, the parsed `chain` (else `chain: null`).
- Model ids (`split.site`, `branch.id`, selection `id`) are first-sight path hashes. The reconciled ids (path, structure, position; the control-binding rules) come from `laneSites(code, prev)`; bindings and pads use those. Captures are name-keyed, a rename is a new id. Bus numbers are not data: nothing in the model, the graph or the ids contains one.
- Crossing: a read of a branch-local tap from another lane is not drawn (`graph().refused[]`, `checkWire`). The offered fixes are applyOp operations: "Export tap" puts `.tap(name, { export: true })` on the lane just before its `.split` (events before a split are the same as inside a branch, section 5.2), "Add send" appends `.send(<lane>)`. Names published inside a branch stay branch-local at runtime (section 4.2).
- Pad target kind `selection` (`{ ref: <site id>, op: "mute" | "solo" }`) journals as op `sel`; `padSelection(code, target)` maps the site id to the runtime selection id for `lanes.set`.
- The runtime of `.split .merge .send ret` (#75) and `capture recall .from` (#76, section 11e) is built. Their data side (model, graph, intellisense, atoms, ids, applyOp) is built and checked from the documented syntax; the `busname` atom events check in `.send(atoms.verb)` and the CLI `strudel atoms list --tag` are open.

## 11c. Built in L2 (#75)
Files: `site/engine/lanes.js` (`compile`, `prepare`, `check`, runtime), `site/engine/index.js` (`hooksLib.protect` runs `lanes.prepare`), `site/app.js` (the E_LANE_* / E_BUS_RANGE codes reach the eval error box),
`site/hooks-intellisense.js`, tests `tests/lanes/l2.mjs` (Node) and `tests/site/lanes.mjs` (Playwright, real superdough offline). Where the build differs from, or fixes, the text above:
- **Plain text out**: the compiled program is ordinary Strudel text (section 5.1 shows it exactly); there is no `__reader` marker and no runtime wrapper around branches. The checks therefore run on the text
  (`E_LANE_SOURCE`, `E_LANE_CROSS`, `E_LANE_CYCLE`, `E_BUS_RANGE`, `E_LANE_HOST`, `W_LANE_POST_SPLIT`, `W_BUS_NO_RETURN`; each with the `line` of the lane statement) and, for what text cannot see, on the queried haps
  (`lanes.diagnostics()`): a reader that sets `note` or `freq`, or whose sound is not `bus`, is `E_LANE_SOURCE`; `W_LANE_REFRAIN` compares, per bus, each group of readers with the same settings and hap length against
  the haps feeding the bus (a gate such as `struct("x ~")` leaves 50% silent; two different gates with identical settings and length are measured together).
- **Branch form**: a branch must be `x => x.effect(...)`: an arrow with an expression body that starts with its own parameter and uses it once. Anything else (a named function, a block body, `x => x.add(x)`) is
  `E_LANE_SOURCE` with the reason; it is never run as an opaque function and a split is never turned into `layer`.
- **Allocation**: lane buses (split, merge, send-only lanes) count up from 64 in source order as the compiler meets them, outer split first, then its merge bus, then nested splits in branch order; named buses are 512 + the
  index of the name in sorted order, across the whole program (sends, `ret`, group sends and `.wire` all name buses). `graph.audio.buses` lists them.
- **Order of rewriting inside a lane**: arguments of ordinary calls first (so `stack(a.split(f), b)` works), then `.wire(p, "bus:n")` -> `.bmod`, then `.send` calls are removed and collected, then the first `.split`
  (an adjacent `.merge` belongs to it). Effects written after `.split(...)` go to each branch reader (to the merge reader when there is a merge); `mix` is a `.postgain(m)` on each branch; `pre: true` leaves out `.dry(0)` on the source.
- **Host check** (`E_LANE_HOST`): `lanes.prepare` asks the page: the `bus` sound in `soundMap` (when `soundMap` is empty the host is "unknown" and not refused: the sound registers during `initStrudel`) and the `bus`,
  `busgain` controls on `Pattern.prototype`. `compile(src, { host: { busSound, busControl } })` takes the answer as data, which is how a stub host is tested. Programs with no audio feature never ask.
- **Site install**: on the page `window.lanes` is the `#lanes` canvas (named element access), which made L1's collision check refuse the whole lanes install; an earlier commit on main (4eeeca8) fixed it the same way (a DOM element is shadowed, not a collision), and the end-to-end run in `tests/site/lanes.mjs` now covers it.
- **Reproducibility of renders (measured)**: with one reader per bus the site's exact offline render is bit-identical run to run, and moving or inserting lanes (new bus numbers) leaves the SHA-256 unchanged
  (`tests/site/lanes.mjs`, "Deterministic allocation"). A bus with two or more readers summed at the orbit is reproducible only to about 1 ULP in headless Chromium (the same program rendered twice differs by
  -166 dB, max sample difference 3e-8): compare such renders with a tolerance, as Remake's level fingerprint does, not by hash.
- **Not built** (marked coming where they appear in the Syntax view): the CLI side (`strudel lanes`, `render`, `events`, `stems` per lane group; these live in `engine/strudel-cli`, another repo), capture and recall (L3),
  model fields, graph nodes and typed param shapes (L4), lane cards and the split fan (L5).

## 11d. Built in L5 (#78)
Files: `site/lanes-ui.js`, `site/lanes-ui.css` (loaded by `graph.js` with the Graph view, like `atoms-ui.js`; nothing in the shell), small hook-ins in `site/graph.js` (decorate, rule, connect, inspector,
outline, the `audio` wire style), test `tests/site/lanes_ui.mjs` (run by `tests/site/smoke.mjs`). Screens: `docs/screens/phone-390-lane-split.png`, `phone-390-capture-node.png`, `phone-390-lane-outline.png`,
`desktop-1440-lanes.png`. Design choices and reasons are in the #78 comments. Where the build differs from, or settles, section 10:
- **Edits**: `addBranch`, `exportTap`, `addSend`, `literal` (a lane's own send amount) go through `applyOp`. model.js has no op yet for adding / removing a `tagged(...)` statement, a group send's amount, or a
  capture window: those are one splice of that statement's text on the same undo stack (wanted ops: `addSelection`, `removeSelection`, `setSelectionArg`, `setCaptureOpt`).
- **Tag chips** act through code, not live toggles: Mute adds `tagged("<tag>").mute()` (Solo `.solo()`), tapping again removes exactly that statement; the chip shows "on" only for that exact form (no gate,
  no other op). The selection runs from the next evaluation (next cycle when hot-swapped). "Send to pad" is coming: the Perform view has no entry point to assign a pad target from outside.
- **Voices** (section 9): counted on demand by compiling the lane alone (`strudelCraft.transport.compileCode`, which stops playback; the button asks first) and querying cycle 0: source voices are the
  haps whose sound is not `bus`, readers those whose sound is `bus`; `.layer` = source x branches. Example 1 gives 12 + 3 against 36, the figures of section 7.
- **Exported taps** are ports on the card edge, read from the lane's own chain; wiring one to another lane's param uses the existing facet and range sheet (`addWire`). Local taps (inside a branch) are
  ports inside the fan only; wiring them out opens the `E_LANE_CROSS` sheet with the two fixes. Known data issue: after "Export tap" the `graph()` data still lists the read as refused because the
  branch-local tap has the same name (the code is right; bug #82).
- **Capture node**: picker, window steppers, ports per recorded layer and the state word (from `lanes.captureState(name)`, polled every 400 ms while capture nodes are shown and updated in place).
  Two readings on top of the runtime word: a window capture whose audio is rendered is Frozen, and while the transport plays a live window capture is Empty before `from` and Recording until
  `until` (the runtime alone says Frozen at once because look-ahead queries of the visuals reach `until` first, bug #87; the recall timing is unaffected). Actions call the 11e entry points only:
  **Bounce to takes** = `host.bounce(name, text)`; **Freeze / Thaw** (rolling captures) = `lanesCapture.freeze` / `thaw(name, at)` with `at` asked in the site modal (default: the next cycle when
  playing, else `last + guard + 1`; `"next"` needs a scheduler position the site does not publish); **Use as sample** = `host.resolve(text)` then `cap_<name>` is shown with Copy and one lane
  `<name>Smp: s("x").from("<name>").loopAt(<window cycles>)` is appended as one text splice on the graph undo stack (model.js has no add-lane op). Bounce / Use as sample compile the graph program
  (`transport.compileCode`), so when playing they ask, stop, and wait 1.5 s for voices to end (a realtime voice ending while the offline render has swapped the audio context throws in superdough, bug #88).
  Disabled actions stay focusable (`aria-disabled`) and state their reason; bus: and rolling audio are "coming" as in 11e. `bus:<name>` pickers are not flagged as bad selectors on the node.

## 11e. Built in L3 (#76)
Files: `site/engine/lanes-capture.js` (static `analyze` / `define` / `levelOf` / `createBudget`, runtime `installCapture`; no DOM, shared with the CLI), `site/lanes-capture-site.js` (browser half: pass 1 render and the `cap_<name>` sound),
`site/engine/lanes.js` (three small hooks: `EXT` static checks, `L.after` observers of the outermost query, `L.stampers`), `site/engine/index.js` (`strudelCraft.lanesCaptureEnsure`, loaded lazily; `app.js` awaits it before every evaluation),
`site/engine/hooks.js` (`protect` also guards the strings of `capture(`, `recall(` and `.from(`), tests `tests/lanes/l3.mjs` (Node, real Strudel) and `tests/site/lanes_capture.mjs` (Playwright, real superdough). Where the build differs from, or settles, the text above:
- **Surface**: globals `capture` and `recall` and `Pattern.prototype.from` (collision checked on install, idempotent). `capture(name, picker, opts)` takes `window: "1b..3b"` (or `{ from, until }`) or `last: "2b"`, `what`, `live: true | false | "auto"`, `max` (seconds, default 32), `guard` (cycles, default 1).
  Pickers built: a selector, an event tap ref `lane/tap` (events only), `master`. `bus:<name>` is parsed and checked but its audio is **coming**, as is the audio of a rolling capture. Defaults of `what`: selector all three layers, tap ref events, `bus:`/`master` audio and level.
  `recall(name[:facet], { at, once, gate })`: `ev` (default), `onset`, `gate` (the captured wholes as boolean haps), `<control>` (held value of that control), `level` (RMS per 1/64 cycle as a signal), `audio` (`s("cap_<name>").loopAt(length)`). `.once()` of 6.3 is the option `{ once: true }`; `recall(...).freeze()` of 6.3 is `strudelCraft.lanesCapture.freeze(name, at)` / `thaw(name, at)` (journaled ops `freeze` / `thaw`; the pattern method form is coming).
- **Strudel's `slice` needs its index pattern**: `pat.slice(4)` throws "expects 2 inputs" in unmodified Strudel 1.2.6, so the examples are written `s("x").from("groove").slice(8, "0 3 2 1 4 7 6 5")`; example 7 also dropped its `mask("<0 0 1 1>")`, which silenced `chop` in bars 1-2 and contradicted "plays from cycle 0".
- **Where the haps come from**: the program pattern is the receiver of the outermost `queryArc` (or `captures.setProgram(p)`). A pure capture queries it once, offline, over the window and applies the selections (`lanes.apply`) to the result; the haps are stored with begins relative to the window start, value, tags and lane id.
  Control maps (`controls.applyMaps`) act on the outermost query, so a recalled hap passes through them at playback; they are not baked into the capture. Recalled haps carry no tags (a recall is not the lane it was taken from). A live capture records the haps of every outermost query whose onset lies in the window, so it holds what was queried (a scheduler that skips ahead leaves a gap); it closes at the first query that reaches `until`.
- **Time**, exactly 6.2: window captures are empty before `until + guard` (live) or available at 0 (pure); a rolling capture at cycle c shows `[q - last, q)` with `q = floor(c - guard)` (a frozen capture uses the cycle of the latest `freeze`); the state is a function of the cycle, so headless and live agree. A recall is split at cycle boundaries and each piece uses its own cycle's state.
- **Purity** is static (`analyze`): a picked lane that reads `ctl(`, a `hooks.map`, a `tap("pads/..."`, `input(` / `midin(` / `mouse(` makes the capture live; so does recalling a live capture; `{ automated: [names] }` (the host's controls that have an automation lane) takes a `ctl("name")` out of that list. `live: false` over a live source is `E_CAPTURE_LIVE`.
- **Cycles and order**: `analyze` builds the edges "capture C picks a lane that recalls capture N" and reports `E_CAPTURE_CYCLE` with the path; `order` is a topological order (A before B). At runtime resolving a capture queries the program; a recall reached from a lane that is not in the resolving capture's picker returns empty (it is not picked anyway), one from a picked lane resolves its capture first, and a picked lane that recalls a capture being resolved throws `E_CAPTURE_CYCLE`. Picker membership of a lane at runtime uses the lane id and its literal `.tags(...)`; a tag added to haps in the middle of a chain is not considered there (the static check has the same limit).
- **Checks** are in `lanes.check(src, { strict })` through `lanes.EXT`: `E_CAPTURE_LAYER` (tap ref with audio or level, a facet whose layer is not recorded), `E_CAPTURE_LIVE`, `E_CAPTURE_CYCLE`, `E_CAPTURE_LIMIT` (more than `max` seconds of audio; the cps is `setcps(...)` or 0.5; the same error at runtime and for more than 20 000 events), `E_CAPTURE_NAME` (twice, bad name, or `cap_<name>` already a sound), `E_CAPTURE_MEMORY` (runtime), `W_CAPTURE_UNKNOWN`, `W_CAPTURE_TEMPO` (audio recalled at another cps than recorded: repitched; `{ stretch }` is refused on the site) and `E_CAPTURE_EARLY` (a warning, so a failure with `--strict`: `recall(name, { gate })` whose gate opens before `until + guard` of a live capture).
- **Site audio** (`createHost(sc).resolve(src)`): for each capture with an audio or level layer, in dependency order, the program is cut to its non-lane statements plus the picked lanes (`restricted`), compiled with `strudelCraft.transport.compileCode` and rendered over the window by the site's public offline renderer `strudelCraft.capture.renderRecipe` (48 kHz, master 0 dB, fixed random seed), then the original program is compiled again.
  The PCM goes to `captures.setAudio` (budget: 96 MB, 32 MB at `deviceMemory <= 4`, unread rolling captures dropped first, `E_CAPTURE_MEMORY` otherwise; 32 s per capture) and is registered with superdough's public `registerSound` as `cap_<name>` (`speed`, `unit: "c"`, `begin`, `end`, `loop`, attack 1 ms / release 10 ms, negative speed reverses; effects still apply because the sound returns a node). `level` is `levelOf`: RMS of the stereo sum per 1/64 cycle.
- **Measured** (`tests/site/lanes_capture.mjs`, Chromium offline render): the capture of `"1b..3b"` at cps 1 has exactly 96000 frames at 48 kHz and its samples are identical to a solo render of that lane (the other lane is not in it); with 4 kicks per bar the level at the kick onsets is 0.158 and exactly 0 between kicks, and the level sequence is identical in a second fresh page.
  This is bit-identical only for what the site render already reproduces: a picked lane whose output goes through a bus with two or more readers (a `.split` with two branches) is reproducible only to about 1 ULP (11c), so a capture of such a lane must be compared with a tolerance, not by hash.
- **Remake and Bounce (built, site)**: `engine/index.js` registers one `strudelCraft.capture.beforeRender` hook per page at load (a regex test for programs without `capture(` / `recall(` / `.from(`, so they add no work: offline renders of four catalog recipes hash identically to the parent commit; teardown `strudelCraft.lanesCaptureHookOff()`). For a program with captures the hook runs `host.resolve` (pass 1 in dependency order, then `registerSound` of `cap_<name>`) before every offline render, so Remake, the reference render and the exact render play recalls from cycle 0; the recipe stores only the program text. `host.bounce(name, src?)` renders the capture if needed and calls `strudelCraft.capture.addTake({ name, L, R, sr, cps, cycles, from: name, code })`: an audio take in the Record list with `meta.from`. Determinism measured: two Remakes of a program with capture + chop give the stored audio hash when one voice sounds at a time; two voices summed in the offline graph (drums and chop together) differ between runs by 1 ULP (max 6e-8, also without any capture), so Remake then reports "tolerance". UI entry points for #78: `lanesCapture.host.bounce(name)`, `lanesCapture.freeze(name, at)` / `thaw`, `lanesCapture.host.resolve(src)`, `lanesCapture.audio(name)`.
- **Not built** (marked coming): the CLI side (`strudel capture`, capture passes in `render` / `stems` / `events`, WAV files in `OUT_DIR/captures/`; the CLI is another repo), audio of `bus:<name>` and of rolling captures, the pattern method `.freeze()` / `.thaw()`, and the CLI side of the UI hooks. The capture node UI is built (11d).

## 12. Open questions

1. **Reader seam (measured 2026-11-13, #75, `tests/site/lanes.mjs`, site offline render, @strudel/web 1.3.0).** With 10 ms attack and release
   and `gain(1)` the seam is unity: max sample step 0.000 dB vs the unsplit render, boundary level deviation 0.000 dB, interior
   difference -161 dB RMS (bit-identical in float). With the 5 ms of the first draft: max step +3.3 dB, level +1.1 dB (bump up to 1.43x),
   because superdough's `bus` sound floors the release at 10 ms. The CLI half of the measurement is open (CLI not in this repo).
   Original question: the 5 ms linear cross-fade between consecutive reader haps should be exactly unity for an identical signal.
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
