# DAW survey: open-source browser DAWs and engines against Strudel-craft

Date 2026-11-15. Owner: `daw-sme`. Method: shallow clones and README / docs / source reads of each project (file names quoted so a claim can be
re-checked), vendor manuals for native concepts. Nothing was copied; this file only describes. **UNVERIFIED** marks a statement that comes from
general knowledge and was not re-read in a source during this survey. Licences matter for us because Strudel and superdough are AGPL-3.0-or-later
and are loaded unmodified (CLAUDE.md): MIT code could be adopted with attribution, AGPL / GPL code only as a separate program or after a
licence-decision issue. We adopt concepts, not code.

## 1. Projects read

| project | source | licence | what it is |
|---|---|---|---|
| openDAW | github.com/andremichelle/openDAW (`introduction.md`, `docs/graph.md`, `packages/studio/forge-boxes/src/schema/std/*`, `packages/studio/core/src/*`, `crates/`) | AGPL-3.0-or-later, or a commercial licence (README) | full DAW: timeline, clips, mixer, ~35 devices, recording, collaboration, WebCLAP plug-ins |
| GridSound | github.com/gridsound/daw (+ `gs-*` submodules) | AGPL-3.0; README calls it "half open-source"; `daw-core` and `gs-wa-components` are not publicly clonable (404 / auth on 2026-11-15) | pattern-based DAW (FL-like): patterns, synths, mixer channels |
| Signal | github.com/ryohey/signal (`ARCHITECTURE.md`, `packages/player`, `app/src/hooks/historyAtom.ts`) | MIT | MIDI sequencer ("a sketching tool rather than a DAW", "No Effects (Fx)" by design) |
| BeepBox (JummBox is a fork of it: UNVERIFIED, not read) | github.com/johnnesky/beepbox (`synth/synth.ts`, `synth/SynthConfig.ts`, `editor/Change.ts`, `editor/SongDocument.ts`) | MIT | chiptune tracker with its own sample-block synth |
| Tone.js | github.com/Tonejs/Tone.js (`Tone/core/context/Context.ts`, `Tone/core/clock/Ticker.ts`) | MIT | Web Audio framework: Transport, scheduling, instruments; the base of most small browser sequencers |
| Web Audio Modules 2 | github.com/webaudiomodules/api (`src/types.d.ts`) | MIT (`package.json`) | plug-in standard for the browser |
| WAM Studio | github.com/Brotherta/wam-studio (`public/src/Audio`, `Controllers`, `Models`) | MIT | multitrack audio DAW that hosts WAM plug-ins (Buffa and Vidal-Mazuy, WWW '23 Companion) |
| Web Synth | github.com/Ameobea/web-synth (`src/patchNetwork`, `src/eventScheduler`, `engine/`) | GPL (its LICENSE: GPL because it derives from Faust code) | modular patch network + DAW parts (MIDI editor, loopers, sequencer), Rust/Wasm DSP |
| Glicol | github.com/chaosprint/glicol | MIT | graph-oriented live coding, Rust/Wasm audio engine |
| Strudel / superdough | codeberg.org/uzu/strudel (repository location UNVERIFIED in this pass); read here from `node_modules/@strudel/core` 1.2.6 and `superdough` 1.3.0 | AGPL-3.0-or-later | pattern language, scheduler and synth engine we build on |

Native references, concepts only: Ableton Live (manual, chapter Comping, read), Ardour (manual, Understanding Playlists, read), Reaper, Logic, LMMS
(UNVERIFIED: from general knowledge; the LMMS mixer manual URL had moved and Reaper's fixed-lane API text was not reached).

## 2. How each one works

### openDAW
- **Data model.** One typed object graph: "Boxes are typed records with addressable fields, pointer fields form the edges" (`lib-box`). Box schemas
  (`studio-forge-boxes`) generate both the TypeScript classes and a Rust registry, so UI, TypeScript engine and Wasm engine share one model.
  Timeline boxes: `TimelineBox`, `TrackBox`, `AudioRegionBox`, `NoteRegionBox`, `ValueRegionBox` (automation), `AudioClipBox` / `NoteClipBox` /
  `ValueClipBox` (clip launching), `MarkerBox`, `SignatureEventBox`, `WarpMarkerBox`; tempo automation exists (`catchupAndSubscribeTempoAutomation`).
  Adapters (`studio-adapters`) wrap boxes into domain objects; "Automation value mappings live in the `*BoxAdapter`".
- **Signal graph.** `AudioUnitBox` is the channel strip: `type`, `volume`, `panning`, `mute`, `solo`, `tracks`, `midi-effects`, `input` (instrument),
  `audio-effects` (inserts), `aux-sends`, `output`, `capture`. `AudioBusBox` is a bus ("every Bus is a group bus"), `AuxSendBox` points a unit at a
  target bus. Sidechain appears in device schemas (`GateDeviceBox`, `AudioEffectCompositeBox`). Plug-ins: stock devices as Wasm side modules plus
  WebCLAP hosting (README). Freeze: `AudioUnitFreeze` renders a unit offline (`OfflineEngineRenderer`) and unfreezes on tempo change. Bounce and
  consolidation: `AudioBounce.ts`, `AudioConsolidation.ts`, `MixdownSection.ts`.
- **Threads.** Rust engine compiled to Wasm and run "as an audio worklet processor" (`studio-core-wasm`), the box graph is mirrored into it
  (`sync/`); workers for analysis, stretch, OPFS, peaks; `LiveStream` gives "lock-free telemetry from the audio thread to the UI" (meters).
- **Recording.** `capture/` (audio and MIDI), `RecordingWorklet`; record offset uses `outputLatency + inputLatency + engine.compensationLatency`
  (`capture/RecordAudio.ts`). Take lanes / comping: none found in schemas or core (grep for take lanes found nothing); overlapping recordings
  are resolved by a region-overlap policy (`docs/overlapping-regions-behaviour.md`: clip, push-existing, keep-existing).
- **Undo.** Transactions on the graph: `BoxEditing.modify()` wraps mutations, `mark()` closes an undo step (`docs/graph.md`).
- **Persistence.** Project bundles (zip, `jszip`), OPFS storage worker, cloud backup, DAWproject import / export (`lib-dawproject`), live
  collaboration over yjs (`ysync/`).
- **Offline render.** `OfflineEngineRenderer`, `offline-worker.ts`; ffmpeg.wasm for encode / decode.

### GridSound
- AGPL front end over closed-to-clone core repos, so only the README level is verified: Web Audio, compositions saved online with an account.
- Data model (composition JSON with patterns, blocks on tracks, synths, mixer channels with a destination and effects), action-based undo and WAV
  export: **UNVERIFIED** (core sources were not readable).

### Signal
- **Data model.** `Song` and `Track` entities that "keep data private and expose named methods and subscriptions"; a mutation "runs in a
  transaction: one change, one notification" (`ARCHITECTURE.md` 5.2). MIDI events, a conductor (tempo) track: UNVERIFIED in detail.
- **Signal graph.** None by design: SoundFont synth only, no effects, no mixer buses.
- **Threads / scheduler.** `packages/player`: `TIMER_INTERVAL = 50` ms timer with `LOOK_AHEAD_TIME = 50` ms (`Player.ts`), `EventScheduler`
  (`lookAheadTime = 100`). Synth in an AudioWorklet (`spessasynth_lib` `WorkletSynthesizer`).
- **Offline render.** `renderAudio.ts`: events -> MIDI -> `OfflineAudioContext` + worklet synth, with progress and cancel.
- **Undo.** Snapshot history: atoms marked with `historyAtom` are deep-cloned per step (`app/src/hooks/historyAtom.ts`).
- **Persistence.** MIDI files; Firebase / Firestore for cloud songs (`firestore.rules`). Recording: MIDI input, no take lanes (UNVERIFIED).

### BeepBox / JummBox
- **Data model.** `Song` > `Channel` > `Pattern` > `Note` (with pins), `Instrument` with `FilterSettings`, `EnvelopeSettings`, operators
  (`synth/synth.ts`). A song is a bar grid of pattern indices per channel.
- **Signal graph.** Fixed per instrument, no user routing. Effect types are an enum: reverb, chorus, panning, distortion, bitcrusher, note filter,
  echo, pitch shift, detune, vibrato, transition, chord (`SynthConfig.ts`). Each instrument has a note filter and an EQ filter editor
  (`FilterEditor.ts`): the instrument is band-shaped before it leaves the voice, which is the same idea as our rack standard.
- **Threads.** The whole synth is one sample-block loop in a `ScriptProcessorNode` on the main thread (`createScriptProcessor` in `synth.ts`), not
  an AudioWorklet.
- **Undo / persistence.** `Change`, `UndoableChange`, `ChangeSequence` objects; the whole song is serialised into the URL hash
  (`SongDocument.ts`, `song.toBase64String()`), and browser history is the undo stack. Export: WAV, MP3 (lamejs), MIDI, JSON (`ExportPrompt.ts`;
  formats beyond MP3 UNVERIFIED in source).

### Tone.js (and sequencers built on it)
- Not a DAW: a Transport (tempo, time signature, loop), `Part` / `Sequence` / `Loop` events, instruments and effects as node wrappers, `Channel`
  (volume, pan, solo, mute, send / receive buses: UNVERIFIED in source).
- **Scheduler.** `lookAhead: 0.1` s, `updateInterval: 0.05` s (`Context.ts`); the clock ticks from a Web Worker with a `setTimeout` fallback
  (`Ticker.ts`). `Tone.Offline` renders a callback in an `OfflineAudioContext` (UNVERIFIED in source).
- No takes, no undo, no project format: the host app owns those.

### Web Audio Modules 2 and WAM Studio
- **WAM API.** A plug-in is a `WebAudioModule` with a `WamNode` (an `AudioNode`) and a `WamProcessor` (an `AudioWorkletProcessor`). Parameters are
  not `AudioParam`s: the host schedules `wam-automation`, `wam-midi`, `wam-transport` events (`scheduleEvents`), sample-accurate on the audio
  thread; plug-ins can be event-connected to each other (`connectEvents`) inside a `WamGroup`. State: `getState` / `setState`. Latency:
  `getCompensationDelay()` "returns a hint in samples". GUI: `createGui` returns an `Element`.
- **WAM Studio.** Tracks with regions (`Models/Region/SampleRegion.ts`, `MIDIRegion.ts`), a per-track plug-in chain (`Models/Track/Host.ts`),
  automation (`Models/Automation.ts`), playback from an AudioWorklet processor (`Audio/Players/BaseAudioPlayerProcessor.ts`), recording with a
  loopback latency measurement tool and in/out latency compensation (`LatencyProcessor.js`, `LatencyController.ts`), undo manager
  (`undoManager` in `HostController.ts`), export through `OfflineAudioContext` (`ExportController.ts`), projects on a server (`bank`).
  No sends, groups or take lanes found.

### Web Synth
- Patch network of "view contexts" (modules) with typed audio / control / MIDI connections (`src/patchNetwork`), DSP in Rust / Wasm inside
  AudioWorklets with `SharedArrayBuffer` (README); a transport worklet schedules events (`src/eventScheduler/transport.worklet-entry.ts`).
- Has a sidechain compressor, OTT-style multiband compression, loopers, a MIDI editor, a sample editor. State persists in `localStorage` and can be
  exported as one JSON (`src/persistance.ts`). No timeline of audio regions, no takes.

### Glicol
- Text is the project: every line is a named node chain; references between chains make the graph. The engine diffs the new text against the
  running graph ("LCS algorithm to handle adding, updating and removing", README), so an edit never restarts audio. Rust / Wasm in an
  AudioWorklet. No timeline, takes, mixer, undo or file format beyond the text.

### Strudel and superdough (what we stand on)
- **Model.** A program is a pattern: a pure function from a time span to events. No project, tracks, clips or tempo map; `setcps` is one number.
- **Scheduler.** `Cyclist`: a clock callback queries the pattern for the next window and triggers each event with a fixed `latency = 0.1` s
  (`cyclist.mjs`); a worker-clock variant exists (`neocyclist.mjs`, `clockworker.js`).
- **Signal graph (superdough 1.3.0, `superdough.mjs`).** One voice per event, built and torn down per note, in a fixed order: source -> gain
  envelope -> lpf -> hpf -> bpf -> vowel -> coarse -> crush -> shape -> distort -> tremolo -> compressor -> pan -> phaser -> postgain -> delay
  and reverb sends -> orbit output. An orbit is the only bus: one delay and one reverb per orbit, `duckorbit` for sidechain-style ducking. No
  inserts on a bus, no groups, no metering, no latency compensation, no offline render API (ours: `OfflineAudioContext` in the CLI).
- **Recording, undo, persistence.** None beyond the editor's text and a share link.

### Native concepts (for the model only)
- **Ableton Live take lanes** (manual, read): every audio or MIDI track has a main lane plus take lanes; "Live can create take lanes in a track as
  you record"; loop recording "adds a new take lane for each pass"; only the main lane plays; a comp is made by selecting ranges in take lanes
  and pressing Enter, and "the clips added to a track's main lane are independent copies"; optional 4 ms crossfades; "you can only audition one
  take lane per track".
- **Ardour playlists** (manual, read): "a list of regions ordered in time"; "At any point in time, a track has a single playlist associated with
  it"; recording adds regions to the current playlist; tracks can share playlists; playlists are the take and versioning layer.
- **Reaper** (UNVERIFIED): takes inside an item (one active take per item) and, since v7, fixed item lanes with comp areas that write a comp lane.
- **Logic** (UNVERIFIED): take folders with quick-swipe comping; comps are named and kept as alternatives.
- **LMMS** (UNVERIFIED): instrument tracks route to a mixer channel; channels have an effect chain and send knobs to other channels; no take
  lanes, no plug-in delay compensation.
- **Delay compensation** in native hosts: each plug-in reports latency, the host delays parallel paths so they line up. WAM has the reporting half
  (`getCompensationDelay`); openDAW applies its engine latency to recordings.

## 3. Matrix against ours

Ours, in one line each (docs/HOOKS_SYNTAX.md, LANES.md, ATOMS.md, CAPTURE.md, BLUEPRINT.md, PACK_SPEC.md): **patterns** (Strudel) are the notes;
**lanes** (`name:` lines) are tracks, with **tags** and `tagged(...)` selections for group moves; **taps** read a lane's events or envelope;
**hooks and slots** (`hooks.def`, `.use`, gated `hooks.bind`) are swappable, time-gated middleware; **atoms** are typed, named strings;
**racks** are hook defs, shipped as library components and pack ingredients; **recipes** are takes (versioned JSON that regenerates the audio);
**buses** are superdough orbits driven by `.split / .merge / .send / ret`; **capture / recall** records a lane or bus to a named buffer.

| concern | openDAW | GridSound | Signal | BeepBox | WAM Studio | Web Synth / Glicol | Strudel | ours |
|---|---|---|---|---|---|---|---|---|
| project model | typed box graph | composition JSON (UNVERIFIED) | Song / Track | Song / Channel / Pattern | tracks + regions | patch graph / text | none | text program + derived JSON model (`site/model.js`), no stored project |
| time model | PPQN timeline, tempo automation, signatures, markers | bars / beats (UNVERIFIED) | MIDI ticks, tempo track | bars of fixed length | seconds + tempo | transport / cycles | cycles, one cps | cycles; bars as `Nb` gates; one cps; no tempo map |
| clips / regions | audio, note and value regions; clips | pattern blocks (UNVERIFIED) | note events | patterns in a bar grid | audio and MIDI regions | none | none | none: form is gates on tags (`tagged("drums").mute("<9b")`) |
| takes and comping | none found | none (UNVERIFIED) | none | none | none | loopers | none | recipes as takes (one list, no lanes, no comp) |
| automation | value regions with curves | UNVERIFIED | controller events | per-note envelopes | per-param lanes | modulation routing | patterns as signals | `ctl` + `hooks.map`, automation lanes in the controls model, gated binds |
| mixer channel | `AudioUnitBox` strip | channels (UNVERIFIED) | track volume / pan | channel volume | track gain / pan | modules | orbit | lane = implicit channel; no strip object |
| inserts | audio-effect chain per unit | per channel (UNVERIFIED) | none | fixed per instrument | WAM chain per track | modules | per-voice only | per-voice chain; bus inserts only on `ret` lanes |
| sends / returns | `AuxSendBox` -> bus | UNVERIFIED | none | none | none | patching | orbit delay / reverb | `.send(name, amt)` / `ret(name)`, group send by tag |
| groups / buses | `AudioBusBox`, every bus is a group | UNVERIFIED | none | none | none | patching | orbits | tags (control groups) + named buses; no summing group with inserts except a return |
| sidechain | device sidechain inputs | UNVERIFIED | none | none | none | sidechain compressor | `duckorbit` | `duckorbit`, tap envelopes (`.wire("gain", "kick:env")`), captured level |
| plug-in hosting | Wasm devices + WebCLAP | none | none | none | WAM 2 | Faust / Soul compile | none | none (hooks are pattern middleware, not DSP hosts) |
| latency compensation | record offset from in / out / engine latency | none (UNVERIFIED) | none | none | measured loopback, in / out compensation | none | fixed 0.1 s scheduling latency | none; no path needs it yet (no plug-ins, no live input) |
| metering | per-unit meters via lock-free stream | UNVERIFIED | none | none | VU per track | scopes, analyser | none | master scope / peak; no per-lane meter |
| freeze / bounce | `AudioUnitFreeze`, bounce, consolidate | none (UNVERIFIED) | none | none | render selected tracks | none | none | capture to a buffer, bounce to a sample, CLI stems; no freeze state |
| engine threads | Wasm engine in a worklet, workers, SAB telemetry | Web Audio nodes (UNVERIFIED) | worklet synth, timer scheduler | ScriptProcessor on main thread | worklet players | Wasm worklets + SAB | main-thread scheduler (worker clock optional), Web Audio nodes, some worklets | same as Strudel on the site; worker split in progress in another session |
| offline render | offline engine renderer, stems | archived exporter | OfflineAudioContext | synth run to WAV | OfflineAudioContext | none | none | CLI: real Strudel in Node on an offline context, stems, chunked render; site: "Render exact N cycles" |
| recording | audio + MIDI capture | none (UNVERIFIED) | MIDI | MIDI-ish live input | audio, armed tracks | loopers | none | take recorder (bus tap, cycle-exact), no live input (licence issue #20) |
| undo | graph transactions | action history (UNVERIFIED) | snapshots of marked atoms | change objects + URL history | undo manager | none | editor undo | text undo + history store adapter; model ops are not one undo stack |
| persistence | zip bundle, OPFS, cloud, DAWproject | cloud account | MIDI file, Firestore | URL hash | server | localStorage / text | share URL | text, share link, recipes (JSON + pins), packs with hash locks |
| determinism | not a goal | no | no | yes (same song -> same samples) | no | no | pattern queries only | yes: gates are pure functions of time, journal replay, seeded CLI renders, recipe hashes |

## 4. Where ours is better
1. **The form is data over time, not copied clips.** Gated bindings and tag selections (`hooks.bind("lead", "wideLead", "49b..73b")`,
   `tagged("drums").mute(gate)`) replace clip duplication. No surveyed DAW can express "this rack from bar 49" without editing regions.
2. **Reproducibility.** A take is a recipe that regenerates its audio and carries hashes; the CLI renders the same program headless with the same
   engine. Only BeepBox comes close (deterministic synth), and none of the others can prove a bounce.
3. **Swappable instruments by name.** Slots, racks and `swap` mode make an instrument a binding; in the others an instrument change is a device
   edit on a track.
4. **Typed, shared vocabulary.** Atoms, packs with locks and licences, intellisense from the same model. Only openDAW's box schemas are stricter.
5. **Text, graph, pads and boards are views of one model** (BLUEPRINT.md); openDAW has the same single-model discipline, the rest do not.
6. **Headless parity and measurement.** Genre score, loudness, similarity and now the rack audit run on the same renders. No surveyed project
   audits its presets.

## 5. Where ours is behind
1. **No mixer channel object.** A lane is a channel only by convention; there is no strip with fader, pan, mute / solo state, inserts, sends and a
   meter that the UI, the model and the CLI all read. openDAW's `AudioUnitBox` + `AudioBusBox` + `AuxSendBox` is the reference shape.
2. **No bus inserts or summing groups.** superdough processes per voice; only a `ret` lane can process a sum. A drum group with one compressor
   exists only as a parallel return.
3. **No per-channel metering.** One master scope. openDAW streams meters lock-free from the audio thread.
4. **No take lanes or comping.** Takes are a flat list of recipes; nothing lets you keep three passes of a lane and choose ranges
   (Ableton take lanes, Ardour playlists).
5. **No project or time model.** No tempo map, time signature changes, markers as first-class data (only hook markers), no saved project: the
   text is the project. DAWproject shows what an interchange model needs.
6. **No freeze.** Capture and bounce exist, but nothing marks a lane as frozen and plays its bounce instead until the source changes
   (openDAW `AudioUnitFreeze`).
7. **No delay compensation.** Not needed until a path with latency exists (lookahead dynamics, plug-ins, live input), then required.
8. **Engine on the main thread.** The scheduler and node construction share the UI thread (in progress elsewhere). openDAW, Web Synth and Glicol run
   DSP in Wasm worklets; Tone.js at least ticks from a worker.
9. **No plug-in hosting.** WAM 2 is MIT and fits a bus insert; superdough has no place to put one per channel today.
10. **Undo is not one stack over model operations** (openDAW: one transaction = one undo step).
11. **Rack quality was unmeasured** until this pass: sources left the voice unscoped (docs/RACK_STANDARD.md).

## 6. Concepts to adopt (ranked by value / effort)
| # | concept | from | why | size |
|---|---|---|---|---|
| 1 | Rack standard: band scope first, measured | BeepBox's per-instrument filter, mixing practice | fixes the leak the owner hears; cheap; done in this pass | S |
| 2 | Channel strip as data (`mixer@1`): one strip per lane and per return, sends, groups, master | openDAW `AudioUnitBox` / `AuxSendBox` / `AudioBusBox` | one object for UI, model, CLI stems and meters; derivable from the lane graph today | S (read model), M (edits) |
| 3 | Per-channel metering | openDAW `LiveStream`, WAM Studio VU | mixing without meters is guessing; CLI already has per-lane stems | M |
| 4 | Take lanes over recipes, with comp ranges | Ableton take lanes, Ardour playlists | recipes are already takes; a comp is a list of (take, range) per lane | M |
| 5 | Freeze = capture + recipe hash | openDAW `AudioUnitFreeze` | cuts live CPU on the site; invalidation is exact because recipes hash their source | M |
| 6 | Project and time model (tempo map, signatures, markers, sections) | openDAW timeline boxes, DAWproject | bars and gates need it once tempo changes; export to DAWproject becomes possible | M-L |
| 7 | Group bus with inserts | openDAW buses | drum / music bus processing | M (needs the bus seam of LANES.md) |
| 8 | Delay compensation as a per-channel number | WAM `getCompensationDelay`, openDAW recording offset | prerequisite for lookahead dynamics and plug-ins | S once strips exist |
| 9 | Transactional undo over model ops | openDAW `BoxEditing.modify`, Signal transactions | graph / pads / board edits become undoable as one stack | M |
| 10 | Text diff -> graph diff without restart | Glicol | lanes that did not change keep sounding through an edit | L |
| 11 | WAM 2 hosting on returns | WAM API (MIT) | third-party effects without touching Strudel | L, after 7 and 8 |

Not adopted: a region / clip timeline as the primary model (it would undo advantage 1: gates and selections already express the form),
a ScriptProcessor engine (BeepBox), server-side projects (WAM Studio).
