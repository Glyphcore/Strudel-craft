# Refactor plan: channel strips over lanes, take lanes over recipes, one engine boundary

Date 2026-11-15. Owner: `daw-sme`. Input: docs/DAW_SURVEY.md (what other browser DAWs do), our code on main. Rule: **migrate forward only**
(no compatibility layers, no dual formats; an old stored thing is converted once or refused with a message, as recipes already do).
The engine / worker split is owned by another session (docs/AUDIO_ENGINE.md, not on main when this was written; its tests are
`tests/site/engine_perf.mjs`). This plan does not touch `site/bgplay.js`, the scheduler or voice construction; section 4 names the seam the
two plans share.

## 1. Where we are (modules today)
| layer | files | state it owns |
|---|---|---|
| text | the program in the editor | everything; the only thing saved |
| compile passes | `site/engine/atoms.js`, `lanes.js` (`compile(src)` -> code + lane graph), `hooks.js` `protect` | none (pure functions of the text) |
| pattern runtime | `hooks.js` (slots, gates, taps, `.hook`), `lanes.js` install (tags, selections), `controls.js`, `pads.js`, `lanes-capture.js` | registry + journal per evaluation |
| derived model | `site/model.js` (code <-> model <-> graph), `lanes-data.js`, `library.js` | none (derived) |
| audio | unmodified Strudel scheduler + superdough voices, orbits as buses (`BUS.lane0 = 64`, `named0 = 512`) | Web Audio nodes |
| capture | `site/capture.js`, `recipe.js` (takes as recipes), `lanes-capture.js` | take list (IndexedDB), buffers |
| CLI | `engine/strudel-cli` (suno-track-lab): same passes and runtime through `$STRUDEL_CRAFT/site/engine`, offline superdough | none |

What is missing is not a subsystem but three **nouns** that every surveyed DAW has and that our views each re-derive ad hoc: a *channel*
(strip), a *take lane* (takes that belong to one lane and one time range) and a *project* (time model + channel list + take lanes).

## 2. Target architecture
```
text program ──compile passes──▶ lane graph ──▶ mixer@1 (channel strips: lanes, returns, master; tag groups; sends)      [read model, phase 1]
      │                                              │
      │                                              ├─▶ meters@1: per-strip peak / RMS / LUFS-S (site: analyser per orbit; CLI: per-lane stems)
      │                                              └─▶ strip edits = text edits (.send amount, tags, gain, mute gates) through model ops
      ├──▶ takes@1: take lanes = recipes grouped by (lane id, bar range); comp = ordered (take, range) list per lane          [phase 3]
      │         └─▶ freeze = a lane whose comp is "the bounce of recipe hash H"; invalid when the lane's resolved text hash changes  [phase 4]
      └──▶ project@1: time model (cps or tempo map, bars, signature, markers, sections) + mixer@1 + takes@1 + pins           [phase 5]
audio engine boundary (other session): scheduler + voice construction behind one interface; this plan only needs
      engine.meter(stripId) -> {peak, rms}, engine.bus(name) -> AudioNode, engine.latency(stripId) -> seconds
```
Module boundaries (new files are pure and DOM-free unless marked UI):

| module | file | depends on | used by |
|---|---|---|---|
| mixer model | `site/engine/mixer-model.js` (`channels(graph)`) | lane graph only | model.js graph data, mixer UI (ui-designer), CLI `strudel lanes --mixer`, meters |
| meters | `site/engine/meters.js` + engine seam | mixer model, engine interface | mixer UI, Record panel, audit / genre score in the CLI (per-strip numbers in `manifest.json`) |
| take lanes | `site/engine/takes.js` | recipe v1, mixer model (strip ids) | Record panel, lane cards, `strudel remake` |
| project | `site/engine/project.js`, `schemas/project.v1.json` | hooks time base (`cpb`, `bpb`, markers), mixer, takes, pack lock | save / load, DAWproject export (own writer; the format is MIT) |
| rack standard | `site/engine/hygiene.js`, `tools/racks/*` | hooks runtime | every rack, pack CI |

Design calls, with the alternative rejected:
1. **A strip is derived, never stored.** The lane graph already says which lanes exist, what they send to and which selections gate them. Storing
   strips would make a second source of truth next to the text. Rejected: a stored channel list like openDAW's `AudioUnitBox` (right for a
   graph-first DAW, wrong for a text-first one). An edit on a strip is a text edit through `model.js` ops, so text, graph and mixer cannot disagree.
2. **Tags stay control groups; a summing group is a return.** superdough has no bus inserts, so "group with inserts" is spelled
   `tagged("drums").send("drumbus", 1)` + `ret("drumbus")...` with the dry path removed. Rejected: patching superdough to add bus inserts
   (AGPL decision issue, and the engine session owns that code path).
3. **Take lanes are recipes with two more fields** (`lane`, `range`), not audio regions. A comp is a list of `(recipe id, from, to)`; rendering a
   comp is `remake` per segment with cross-fades at bar lines. Rejected: region objects on a timeline (survey section 6, "not adopted").
4. **Freeze is a property of a lane's comp**, keyed by the hash of the lane's resolved text plus the hashes of everything it reads (atoms, racks,
   taps). No timer or dirty flag: the hash either matches or the lane is live again. Rejected: manual freeze / unfreeze state (openDAW unfreezes
   on tempo change by subscription; we get the same from the hash).
5. **Delay compensation is a number on a strip**, zero for every strip today. The first consumer (lookahead limiter on a return, WAM plug-in)
   must add `latency` to its strip and the engine delays the other strips by `max - own`. Nothing is built before a consumer exists.
6. **One undo stack over model ops** comes after project@1, because a transaction needs a model to apply to; until then text undo stays.

## 3. Phases (each is one issue; done only on critic acceptance)
| phase | issue | deliverable | risk | value |
|---|---|---|---|---|
| R1 | #95 | mixer read model `site/engine/mixer-model.js` + `tests/lanes/mixer_model.mjs` (built in this pass) | low: additive, pure | every later phase and the mixer UI read it |
| R2 | #96 | per-strip meters: CLI `strudel stems` writes peak / RMS / LUFS-S / side<120 per strip into `manifest.json`; site analyser per lane orbit behind the engine seam; `strudel lanes --mixer` | medium (site half waits for the engine seam) | mixing by numbers; the rack audit moves from racks to whole tracks |
| R3 | #97 | take lanes: recipe fields `lane`, `range`; `takes.js` comp list; Record panel groups takes per lane; `strudel remake --comp` | medium | comping without regions |
| R4 | #98 | freeze by hash on top of capture (`Freeze` in lane cards exists as a button; make it a state) | medium | site CPU on long tracks |
| R5 | #99 | project@1: time model + mixer + takes + pins, save / load, DAWproject export | medium-high | a project that is more than a text file |
| R6 | #100 | summing groups through returns (`.group("drums")` sugar), strip latency field and compensation | medium | bus processing, prerequisite for WAM hosting |
| R7 | #101 | one undo stack over model ops (transaction = one step) | medium | graph, pads, board, mixer edits undo together |

Order: R1 -> R2 -> (R3, R6 on disjoint files) -> R4 -> R5 -> R7. UI for R2 / R3 / R4 goes to `ui-designer`.

### Acceptance (observable; copied into each issue)
- **R1**: `node tests/lanes/mixer_model.mjs` passes 11 checks on the night phonk v2 track (23 strips, 2 returns with inputs, tag groups with
  members, gated mutes on strips, no bus numbers, pure, dangling sends reported); module has no DOM / Strudel import; docs: this file, site/README.md.
- **R2**: `strudel stems track.v2... --bars 16` manifest has one entry per strip id of `channels()` with `peak_db`, `rms_db`, `lufs_s`,
  `side_low_db`; sum of strips within 0.5 dB RMS of the mix for a program without ducking; site: a meter value per strip changes within 100 ms of
  a lane starting (Playwright, 360 px); no extra node on the audible path (peak and RMS armed vs disarmed within 0.5 dB, as capture.mjs does).
- **R3**: recording the same lane three times over bars 9-16 gives three takes on one take lane; a comp of (take1 9-12, take3 13-16) remakes to
  audio whose first half matches take1 and second half take3 (level fingerprint within 1.5 dB); recipes without `lane` are refused with a
  message naming the one-time conversion (forward only).
- **R4**: freezing a lane drops its voice count to 1 in `strudel events`; editing the lane's text, a rack it uses or an atom it reads unfreezes
  it (hash changes); Remake of a frozen program reproduces the audio hash.
- **R5**: `project.v1.json` validates the saved night phonk v2 project; load -> save is byte-identical; DAWproject export opens in a reader
  (lib check, not a DAW run) with one track per strip and the tempo.
- **R6**: `.group("drums")` renders within 0.1 dB of the hand-written send / return form; a strip with `latency: 0.005` shifts every other strip by
  220 or 221 samples at 44.1 kHz in a CLI render.
- **R7**: a graph edit, a pad bind and a strip send change undo in reverse order with three undos; text after the undos is byte-identical.

## 4. Seam with the engine / worker session
This plan needs three calls from whatever the engine becomes; all exist in some form today and must survive the split:
`engine.meter(stripId)` (today: one master analyser in `site/visuals.js`), `engine.bus(name)` (today: the bus reader of `lanes.js` on
superdough orbits), `engine.latency(stripId)` (today: constant). If docs/AUDIO_ENGINE.md lands with different names, R2 and R6 adapt to it;
nothing here creates a second scheduler or touches voice construction.

## 5. Shipped from this plan in this pass
R1 only: `site/engine/mixer-model.js`, `tests/lanes/mixer_model.mjs`. Not started blind: R2 onward are filed, not built.
