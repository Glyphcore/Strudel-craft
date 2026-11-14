# Record panel and recipes (`site/capture.js`, `site/recipe.js`, `schemas/recipe.v1.json`, #72)

One Record panel with one arm, one transport and one timeline of takes. A take is a **recipe**: versioned JSON that regenerates the result from scratch. Audio blobs are optional outputs of the recipe. Pins follow [PACK_SPEC](PACK_SPEC.md) sections 8 (hashes) and 9 (sources, lockfile).

## Panel
- **Opening it**:
  - the record button in the transport (after Next);
  - the palette (`Ctrl+K`), group Record: Open record panel, Record / stop take, Record N cycles (loop), Render exact N cycles (offline), Import recipe;
  - the workspace pane **Record** (`strudelCraft.workspace.on([[{ id: 'record', w: 1 }]])`). Docked, the panel is in flow and always shown.
- **Include** boxes: **Audio** (master tap), **Events** (lanes, pads, control moves), **Code-state**. A single Record captures every ticked part.
- **Arm**:
  - Free;
  - Cycles: starts and stops on cycle boundaries. Length is `round(N / cps * sr)` frames, so the take loops;
  - Until stop: capped by the play-time limit.

  Plus count-in (cycles), pre-roll (seconds, Free / Until stop), name, WAV 16/24 and Render exact N cycles with Fold tail.
- **Timeline**: one row per recipe with:
  - chips: `audio` / `events` / `code`, `remake ok` / `differs`, `inert` for imports;
  - a waveform, or event ticks for event-only takes;
  - cycles, cps, start-stop cycles, the dependency count and the render hash;
  - actions: Play (HTMLAudio, never recorded), Remake, Rename, Delete, Recipe (JSON download), WAV, and Copy code for lane / pad takes (`laneCode` / `bounceCode`).
- Perform's own Rec lane and looper takes still record in Perform. They land in the same timeline as event recipes, with a "Take saved, Download" toast.
- 44px targets and a 360px layout. A storage line turns into a warning near the quota.

## Tap and timing
- An AudioWorklet created with `numberOfOutputs: 0` sits on the master bus GainNode, post master level. It has no output, so nothing is added to the audible path: no gain stage and no connection to `ctx.destination`. The ScriptProcessor fallback (no worklet support) needs an output to run, so it goes to a MediaStream sink, never to the destination. `tests/site/capture.mjs` checks the worklet's output count, that no tap node connects to the destination, and that the master output has the same peak and RMS (within 0.5 dB) armed and disarmed.
- Compressed copy: a realtime take with Audio ticked also records WebM/opus (`MediaRecorder`, 128 kbit/s) from a MediaStream sink fed by the same bus node (a sink, not the destination). The take row gets a `WebM` button (`<name>_<cycles>c_<cps>cps.webm`, `.ogg` where only Ogg opus exists). The WebM starts when recording starts and stops when the take is saved, so its length is within about 0.1 s of the cycle cut, not sample-exact; use WAV for loops. Offline renders have no WebM. Where `MediaRecorder` has no opus (older Safari), the panel hint says so and only WAV is offered.
- Cycles cuts are computed from the Cyclist clock: a hap at cycle `c` sounds at `lastTick + (c - lastBegin) / cps + latency`.
- A take continues across Rack/Stack tab switches and in a hidden browser tab.
- Gaps (background playback, `site/bgplay.js`): when a realtime take crosses a pause or interruption (a suspended or interrupted
  AudioContext, a frozen page, a stall longer than the scheduler's lookahead), the recipe gets `timing.segments`:
  `[{kind: 'paused' | 'interrupted', cycle, audio, seconds}]` (`audio` = seconds from the take start), and a toast warns that the take
  had interruptions. The captured audio contains the gap; the musical position does not jump (the scheduler resumes at the same cycle).
  Remake and the exact offline render ignore `timing.segments`: they render cycles, not the wall clock, so their audio has no gap.
- Events: control values are sampled about 10 times per second and stored as changes `{cycle, control, value}`. Pad journal entries in `[start, stop)` are stored as `{cycle, pad, op, args}`, and the active lanes are stored too.

## Recipe (version 1, forward only)
`schemas/recipe.v1.json` (`format: "strudel-craft/recipe"`, `version: 1`). Fields:

| field | contents |
|---|---|
| `includes` | `{audio, events, code}` |
| `timing` | `cps`, `start`, `stop`, `cycles`, `loop`, `mode`, `exact`, `fold`, `preRoll` |
| `random.seed` | 32-bit seed: `Math.random` is seeded with it during offline renders only, restored in `finally` (Strudel's `rand` is cycle-deterministic already) |
| `state` | `source` `{kind, title, code (as played), resolved (atoms inlined), atoms}`, `controls` (controls engine model: values, ranges, maps, lanes), `aliases` (label -> AST control id), `sites` (AST control ids with path, value, range), `perform` (pads = hook bindings, boards, maps), `modRanges` (path + sha256), `settings` (tempo, masterDb, follow, transport range) |
| `events` | `pads` (Perform journal), `hooks` (the pad entries of the hooks journal up to `stop`, as the runtime reads them; replayed by renders), `controls`, `lanes` (+ `performance`, `bank`, `targets` for looper takes). Present whenever events or code-state is included |
| `deps` | `strudel` (`@strudel/web@1.3.0` URL + sha256 of the bundle bytes), `superdough` (1.3.0, bundled), `site` (build id), `packs` (lock entries: id, version, source, manifest hash, tier, every ingredient id + hash), `samples` (bank id, `github:owner/repo@<40-hex>/path`, pinned URL, sha256 of the map), `vox` (bank id, URL, sha256) |
| `outputs` | `capture` (realtime) and/or `render` (offline): `{sha256, sr, frames, how, encoding: "f32le-interleaved", envelope}`. `envelope` is a level fingerprint: mono RMS per 10 ms block in dB, in 0.1 dB steps. The audio hash is sha256 of interleaved little-endian float32 frames |

- Only version 1 exists. Older and unknown versions are rejected ("Recipe version N is not supported"). There are no legacy readers and no migration shims.
- The pre-recipe take store (IndexedDB `sc-capture`, `sc.capture.*` settings) is deleted once, and never silently: when old data exists a site modal offers "Download backup (JSON) and clear" (a raw dump of every store plus the `sc.capture.*` settings, typed arrays and blobs as base64; not importable, there is still no legacy reader) or, under "Other options", "Clear" or "Keep for now" (deletes nothing, asked again next load). If the backup fails nothing is deleted. A notice follows the prune. Storage is now IndexedDB `sc-recipes` (`{id, recipe, audio: {capture?, render?, remake?}}`) plus settings in `sc.record.*`.
- Sample maps the site loads by branch are pinned at record time to the commit the branch resolves to (GitHub API). The map's `_base` is rewritten to that commit on Remake, so every sample file is fixed by the commit.

## Reference render and Remake
- An exact Cycles take with audio and code-state gets an offline **reference render** when it ends. The transport stops for it. Its hash is `outputs.render.sha256`. Render exact N cycles writes a recipe with the same output.
- Remake runs these steps in order:
  1. Validate the recipe.
  2. Ask for approval in a modal that lists the program and every dependency (kind, id, pinned ref, short hash). Pack code ingredients are listed as not run (sandbox, #71).
  3. Ask for trust for each ref from an unknown source. The answer is remembered per id + hash in `sc.trust`.
  4. Verify every pinned ref. A mismatch refuses the load: a modal names the ref with the expected and actual hash, and nothing is loaded or run.
     - Packs go through the pack loader only (one verification path). A commit-pinned source uses `packs.verify(ref, hash)` (e8d15fa), the same fetch, hash and cache path as loading. A shipped same-origin `file:` source is not commit-pinned, so `packs.verify` refuses it by design; it is checked against the loader's state instead, whose manifest bytes were verified against the shipped lock.
     - Non-pack refs (the Strudel bundle, sample maps, vox banks) are fetched and hashed by recipe.js, because they are not packs.
  5. Load the pinned sample maps from the verified bytes, and the vox banks.
  6. Render offline from the recipe alone:
     - compile the program;
     - apply the label -> id aliases and the controls model;
     - set each control's history to its start value plus the recorded cycle-stamped events;
     - replace the pad entries of the hooks journal with `events.hooks`, so pad bindings and variables replay;
     - seed `Math.random`;
     - run a warm-up pass on a throwaway context, which drains stale live nodes from superdough's pools;
     - run the real pass on a fresh context, passing a copy of each hap value per `superdough()` call (superdough writes into values);
     - render `[start, stop)` at the recorded sample rate, with fold tail and master level.

     The previous controls state and hooks journal are restored afterwards.
  7. Compare the result with `outputs.render.sha256`.
     - Bit-exact: a toast, and the take shows `remake ok`.
     - Otherwise, the level fingerprint within 1.5 dB on at least 98 % of the audible blocks: a toast "matches within tolerance" with a note, and the take shows `remake ~ok`. This covers noise (random per session) and very low filter cutoffs. Those render with tiny numeric differences between runs: in tests, `lpf(300)` gave three different hashes in three renders and `cutoff(1234)` gave identical ones, which points at denormal handling in the browser's offline audio thread.
     - Otherwise: a modal "Remake differs" with both hashes and the notes (other build, pack not loaded, ...).
- A take that kept only a realtime capture cannot be compared bit for bit. Its remake becomes its exact render.

## Trust and poisoning
- External refs are always a commit sha plus a content hash. Floating refs (branch, tag) fail validation.
- Known sources are same-origin, `unpkg.com/@strudel/web@1.3.0`, and the pinned GitHub repos of the site's sample maps and this repo. Core and curated packs from the shipped lock are known too. Anything else needs the trust modal.
- Imported recipes are inert data: nothing is fetched beyond the file or evaluated until Remake is pressed and approved. A recipe never runs third-party pack code.
- **Coming**: snapshot mirror. A copy of every pinned dependency kept beside the recipe, so a Remake still works when an upstream host disappears. For now the external hosts (unpkg, GitHub raw, pack repos) are assumed reachable.

## Limits
- Pad bindings and variables replay from `events.hooks`. Looper takes (`events.performance`) are not replayed by offline renders yet, and Remake says so in a note.
- The noise buffers superdough caches per session are created by the first noise sound, and superdough's module state cannot be reached. A render seeds `Math.random`, but a buffer that already exists from live play is reused. Noise takes therefore compare by the level fingerprint, and the result says so.
- Superdough pools nodes without regard to context. A collector installed for the render only strips the pool key from offline nodes. Haps that receive a stale live node are retried.

## API
`strudelCraft.capture = { open, close, toggle, configure({mode, n, countIn, preRoll, name, bits, fold, audio, events, code}), record(opts, run), stop, toggleRec, renderExact(n), remake(id), importRecipe(fileOrText), beforeRender(fn) -> unregister, addTake({name, L, R, sr, cps, cycles, from}), exportRecipe(id), renderRecipe(recipe), download(id, 'recipe'|'wav16'|'wav24'|'capture'|'render'|'remake'), list, get, remove, rename, encodeWav, opts, state }`

`strudelCraft.recipe = { FORMAT, VERSION, sha256, audioHash, collectDeps, validate, refsOf, verify, trusted, grant, store }`. The controls engine gains `history(name)` / `setHistory(name, entries)` for exact, restorable value histories.

## Pattern-level captures (lanes, #76)
A program can capture its own lanes: `capture("groove", "drums", { window: "1b..3b" })` and `recall("groove")` / `.from("groove")` (docs/LANES.md 6 and 11e). The recipe stores no capture audio: the program text in `state.source.code` holds the capture definitions, and the audio is a cache regenerated by an offline pass over the picked lanes
(`strudelCraft.lanesCapture.host.resolve(src)`, which uses `capture.renderRecipe` as a public call and compiles the original program again afterwards). **Record-side hooks (built)**: `capture.beforeRender(async (recipe, { code }) => ...)` runs before every offline render (exact render, reference render, Remake) with the recipe's program already compiled; the hook may call `renderRecipe` itself (nested renders skip the hooks), a throwing hook aborts the render, and it returns an unregister function. `capture.addTake({ name, L, R, sr, cps, cycles, from })` stores an audio-only take (`meta.from` = the capture name, `includes` audio only, listed as "from <name>", WAV download) for a bounce. **Still to wire on the lanes side** (`site/engine/lanes*.js` / `lanes-capture-site.js`, another session): register `host.resolve` through `beforeRender` and call `addTake` from Bounce; until then Remake of a recipe using `recall(":audio")` / `.from(` and the bounce button stay marked coming. Event facets (ev, onset, gate, controls) need no captured audio and are unaffected (events are queried from the program).

## Test
`node tests/site/record.mjs` runs at 360x740 in two browser profiles:
- **A** (with a pad and a noise take):
  - panel targets and palette;
  - one Record with audio + events + code-state: realtime capture plus reference render;
  - chips;
  - recipe download, with v1 and pinned deps;
  - workspace pane.
- `node tests/site/capture.mjs` (audio, 360 px): 44px targets, `record.*` actions, 2-cycle take with exact loop length and non-silent waveform, WAV 16/24 headers and lengths, file name `<name>_<cycles>c_<cps>cps.wav`, quota line, rename/delete modals, tab-switch survival, exact render length.
- **B** (clean):
  - legacy prune: a modal first; backup path downloads a JSON with the old take and clears; "Keep for now" deletes nothing; "Clear" prunes with a notice;
  - import is inert;
  - Remake approval, then the audio hash matches A's render bit for bit;
  - a pad take replays its hooks pad journal: it matches, while the same render without the journal leaves the tolerance;
  - a noise take compares by level fingerprint, with a note;
  - the controls engine is intact afterwards;
  - a tampered pack manifest hash is refused with the ref named;
  - version 0 is rejected;
  - no console errors.
