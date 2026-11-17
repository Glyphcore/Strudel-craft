# Strudel Craft (static site)

One page, `index.html`: an instrument for the recipe catalog. Plain HTML, CSS and JS, no build step, no framework.
Published at https://glyphcore.github.io/Strudel-craft/ by `.github/workflows/pages.yml` (publishes this folder).

## What is on screen
- **Transport** (always visible, bottom; thumb zone on phones): prev / Play-Stop / next, Tempo knob (BPM), Master knob (dB), L/R peak meter.
- **Stage**: scope + log-frequency spectrum (Hz / dB axes) of the master output, and pattern lanes for the current cycle with a moving playhead.
- **Views** (`1`-`7`): Rack (browser, code editor, inspector), Stack (layer recipes into one `$:` program with per-layer mute and `postgain` level), Ref (plugin/function reference), Practice (best practices), Perform (pad banks and control boards), Syntax (runnable examples of the new paradigms, and the composition concepts of docs/COMPOSITION.md), Graph (blueprint node editor over the shared model; loaded on first open).
- Old URLs `compose.html`, `plugins.html`, `practices.html` redirect to `#stack`, `#ref`, `#practice`. A recipe deep link is `index.html#r/<recipe-id>`.
- Shortcuts: press `?` in the app for the cheat sheet (Space, arrows / J K, Enter, `[` `]`, `-` `=`, A, `/`, Esc, Ctrl/Cmd+Enter, Ctrl/Cmd+Z, C, O, T). Undo / redo (#177): in the code box Ctrl/Cmd+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z (also with Caps Lock) are the editor's text undo / redo; elsewhere Ctrl+Z is the knob / stack undo. Alt+Z / Alt+Shift+Z step the version history (not while typing in a field). The Code and Stack heads have 44px undo, redo and version-history buttons for phones (undo / redo disabled when the editor has nothing to step); programmatic edits (Insert, ghost accept) are one undo step.
  Key scoping (`onKey` in app.js): a focused widget that handles its own keys (`[data-keys="own"]`, `role="menu"` / `menuitem`,
  `aria-haspopup="menu"`, e.g. the copy button) owns Enter, Space, the arrows, Home / End and Esc; any other focused button, link or
  summary owns Enter (and Space, except links) for its own activation. Those keys never also reach the global shortcuts, so a key on a
  control never starts playback or swaps the editor code. Library rows keep Enter / Space as the play shortcuts.

## Audio and licences
- `@strudel/web` 1.3.0 (AGPL-3.0-or-later) is loaded **unmodified** from unpkg on the first Play; it is not vendored.
- To drive the meters, `app.js` wraps `AudioNode.prototype.connect`: a connection to `AudioContext.destination` is sent to our master `GainNode`, which feeds `AnalyserNode`s and then the real destination. Strudel's code is untouched.
- Tempo: the program's own `setcpm` / `setcps` / `setbpm` wins on load and on every recompile, and the knob shows its value (night phonk: 128.8 BPM). A program without one gets `setcpm(BPM/4)` in front. Only after you touch the knob does it override (rewrites `setcpm(...)`); a **Program** button then appears next to the knob and hands control back. The override persists (`sc.tempoOv`). Test: `node tests/site/tempo.mjs`.
- Record panel: offline render is the default source; every offline render shows a progress strip (percent + Cancel); a live take with dropouts or tap gaps is flagged with its reason and a Re-render offline button. Test: `node tests/site/record_ui.mjs`.
- Quick play (`quickplay.js`, docs/QUICKPLAY.md, test `tests/site/quickplay.mjs`): a 44px play button on every Syntax example, section header and Recipes row auditions the code in place (own repl and orbit, no navigation or editor change); a tray with Solo, a length chip (End = play to the entry's resolved end, else loop; Loop; N bars), bar position and Stop; disabled with the reason when an entry cannot play alone.
- Syntax navigation (`syntax.js`, `organizer.js`, test `tests/site/syntax_nav.mjs`): 132+ sections are grouped in families (`syntax/<engine>`, `composition/<family>`), collapsed by default, with a sticky search (title, id, tags, text), a jump strip, the #120 organizer (folder tree, tag chips) for filtering, local Pinned and Recent lists (`sc.syntax.nav` in localStorage with the open families), arrow-key navigation (Up/Down/Home/End, Left/Right to fold a family) and 44px targets. Section bodies and their Craft/Strudel forms are built on first open. Deep link `#syntax=<id>` opens the view, the family and the section; the old `#sx-<id>` hash and the element ids `sx-<id>` / `sxh-<id>` still work. `strudelCraft.syntax.go(id)` opens a section from code. `data/syntax.json` and `data/composition.json` are unchanged.
- Two forms of every program (`forms.js`, docs/LOWERING.md): the Rack inspector and every Syntax example show the Craft form (authored, source of truth) and the Strudel form (generated lowering, what strudel.cc needs) as tabs with a Copy button each, a state badge (identical / lowered, same events / approximate / Craft runtime only, with the reason), and Insert into editor (Craft by default, the Strudel tab inserts the lowered form). Data: `code`, `lowered`, `lowered_note`, `lowered_check` on catalog recipes and Syntax examples, generated by `tools/concepts/build.mjs` and `tools/lowering/build.mjs` (hap equality through `strudel events`). Test `node tests/site/forms.mjs` (390 px). Intellisense presets: `<id>` inserts the plain expression, `<id>.craft` the Craft program.
- "Open in strudel.cc" (the Strudel form) builds `https://strudel.cc/#` + `encodeURIComponent(btoa(UTF-8 code))`, the format the strudel.cc REPL writes.
- Fonts: Chakra Petch and JetBrains Mono, self-hosted woff2 (latin subset), SIL OFL 1.1; licences in `fonts/`. Only Chakra Petch 500 is in
  `style.css` (preloaded); Chakra Petch 700 and JetBrains Mono are added by `index.html` (Font Loading API, `display: swap`) once the first
  frame is on screen (#59).
- `sw.js` installs one atomic snapshot per deploy `VERSION`: the `SHELL` list, every file in `precache.json` (generated by `node tools/pwa/precache.mjs`: all scripts incl. lazily imported modules, styles, pages, data, pack pins `packs.json` / `packs.lock.json` / `craftpack.json`, the `prelude/word.js` prelude and the demo vox bank `word()` falls back to), the shim pack files, and the full import graph of every pinned CDN module (the `@strudel/web` 1.3.0 bundle, CodeMirror and jsdiff on esm.sh; crawled at install). A missing piece fails the install and the previous snapshot keeps serving, so the shell never mixes old and new files. Deployed, the shell is served from the snapshot (local `sc-dev` revalidates with the server so edits show up). So after the first visit (Play not needed) the installed app loads, edits and plays with the network off. The default sample maps are stored in `sc-banks-1` at install; their audio (raw.githubusercontent.com) is lazy: cached on first use (kept across deploys, last 1500 files); an uncached bank while offline shows one "Offline: this sample bank is not cached yet" toast per bank (vocal pack banks: "vocal bank"). The other vox banks are pack content (`sc-packs-1`, cached when activated or kept offline). The deploy regenerates and checks `precache.json`.
- Load order (#59, shell first): `index.html` loads only the shell with the page: `style.css`, `workspace.css`, `pwa.css`, `ui.js`, `forms.js`, `app.js`,
  `packs.js` (catalog; the shim and vox manifests are preloaded; preloading the phonk manifest and presets too measured worse, LCP +0.15 s),
  `palette.js` and `pwa.js`. The transport range markup is static HTML (the same markup as `TPL` in `transport-range.js`; smoke checks they match), so the stage has its
  final height at first paint.
  Everything else (`engine/index.js` hooks/lanes/controls, atoms, visuals, CodeMirror intellisense and its providers, history, background
  playback, tracker, copy-code, `transport-range.js`, Record (`capture.js` + `capture.css`), workspace, vox banks, refs, resources) loads right after the first frame
  with recipes is on screen (`window.strudelCraft.shellPainted`: `app.js` fires `sc:shell`, then its largest-contentful-paint entry), or on
  the first pointer or key input, whichever comes first. The modules are fetched in parallel and run in their old order.
  `window.strudelCraft.booted` resolves once they have run, and `Engine.load()` (first Play, idle compiles) awaits it, so the first Play
  still takes one tap. The pack loader fetches the other `eager` entries after that first frame (PACK_SPEC 9.4 "idle time"). The views
  (Perform, Syntax, Graph with atoms and lanes, the pack sheet) still load on first open.
- Lazy-load failures (#59): a deferred module or stylesheet that cannot be fetched (offline, blocked, a bad deploy) shows one error toast naming
  it (for example "Could not load live tracker (tracker.js)") with a Retry action (`ui.toast(message, { action: { label, run } })`); the rest
  of the instrument keeps working and `window.strudelCraft.lazyFailed` lists what is missing. A lazy view (Syntax, Perform, Graph) that
  cannot load hands back to the view it came from (no half-open view), and its toast's Retry opens it again; the pack sheet does the same.
  Chromium keeps a failed module URL in its module map, so a retry imports `<file>?retry=<n>`. Never a native dialog.
  Test: `node tests/site/lazy_fail.mjs` (blocks one module and one view, then Retry; also checks the hooks intellisense providers are
  registered when the first completion popup opens).
- Eager-shell budget (#59): `node tests/site/shell_budget.mjs` (also part of `smoke.mjs`, static, no browser) fails when a script,
  stylesheet or preload is added to `index.html` without being on its `EAGER` allow-list, when the eager shell (index.html + eager files +
  their static imports, raw bytes) passes `BUDGET` (433,000 bytes = measured + 10%; measured 408,896 on 2026-11-17, was 469,268 of 470,000 before #166; `data/catalog.json`, the recipe index, is 72,348 bytes: compact JSON, and `intent` plus the inspector-only fields moved to the lazy bodies; byte table by file and category in docs/PERFORMANCE.md, re-measure with `node tests/site/first_paint_bytes.mjs`),
  when a deferred (`LATER`) module is pulled into the eager graph, or when a shipped-lock manifest or recipes entry is not preloaded.
  `--list` prints the files by size. Lighthouse itself stays a manual gate: `tests/site/lighthouse_relative.mjs` (it serves `.mjs` as
  JavaScript like Pages does since 2026-11-16; `--legacy-mime` reproduces the older numbers, in which acorn and every module importing it
  failed to load).
- Audio status: the dot next to the master meter (`#audioSt`) shows the AudioContext state: grey = off until the first Play, green = ready,
  glowing = playing, amber pulsing = blocked/suspended, red = the engine (unpkg) or the sample banks failed to load. Tap it to resume the
  context or retry the failed load; the status line then prints context state, sample rate, master level, engine and sample self-checks.
- Sample maps load whenever the program names a sound that is not a built-in synth (`s()`/`sound()` names, `.bank()`), in edited Rack
  code and typed Stack programs too; a failed map is reported (synths keep playing) and retried on the next Play.

## Troubleshooting: no sound or no waveforms
- AudioNode "destination is not connected" page errors under load come from superdough's `noise` teardown order; site/app.js guards them (docs/KNOWN_ISSUES.md, #92; test `node tests/site/disconnect_repro.mjs`).
1. Look at the audio dot. Amber: the browser blocked audio; tap the "Audio blocked by the browser. Tap here to enable audio" toast or the dot
   (phones suspend audio in the background; coming back resumes it, or offers that button). Red: tap it to retry the engine or the sample banks
   (needs unpkg.com and raw.githubusercontent.com).
2. A "Playing, but no signal reaches the output" toast after ~3 s names the likely cause: master at -inf, the engine never reached the master
   bus, banks missing, or a silent program (gain 0, muted layers).
3. Stack view: a program typed into an empty Stack plays as typed (it used to say "Stack is empty"); a tempo or level change no longer
   replaces a typed program while the Stack has no layers.
4. Just after a deploy: the service worker revalidates every shell file with the server (`cache: 'no-cache'`, ETag) and precaches with
   `cache: 'reload'`, so an old build cached for 10 min (GitHub Pages `max-age=600`) is never mixed with new files. If the page still looks
   old, take the "New version, tap to reload" toast.
5. Installed app (Android Chrome PWA): an empty Syntax pane with an `E_PACK_HASH` error means the deployed data and its pins drifted
   (deploys now regenerate the pins); tap Retry. An installed app idle at a new deploy reloads itself into the new build; while you play
   or type, take the "New version, tap to reload" toast. Check: `node tests/site/standalone.mjs` (installed mode, service worker in
   control, upgrades from two older builds, Range pass-through, Syntax error state and Retry).
6. Phone layout: the page never scrolls sideways (`overflow-x: clip` on html/body; editor header actions wrap onto a second row with 44px
   targets, #81). An edited Rack header used to be 386px wide on a 360px phone, which made mobile Chrome rescale the page: it shifted sideways
   and the fixed transport slid partly off screen, so taps near Play landed on list rows. The viewport meta has
   `interactive-widget=resizes-content`, so the on-screen keyboard shrinks the layout and the transport (Play) stays above it.
7. Check: `node tests/site/audio.mjs` (S22 profile, real taps, fresh profile and a stale service worker from an older build): peak on the
   master AnalyserNode > 0.01, context running, non-blank scope and `_scope`/`_pianoroll` widgets, Rack default, Rack and Stack with a
   typed program; layout at 360px in every view, after typing and with the keyboard open (no sideways scroll, `elementFromPoint` at Play's
   centre is Play, every Play press a real tap, Revert visible with a 44px target); `--live URL` runs the fresh case against a deployed site.

## Background playback (`bgplay.js`)
Strudel 1.3.0's scheduler (core `Cyclist` + `zyklus` clock) ticks from a main-thread `setInterval` every 100 ms and schedules a fixed
0.2 s ahead of `AudioContext.currentTime` (interval 0.1 + overlap 0.1, 0.05 s per callback). A tick later than that window drops its
query ("skip query: too late") while the cycle count advances, so a hidden or throttled tab played with holes and a stalled page jumped
ahead. Measured with `node tests/site/background.mjs --baseline` (Strudel's clock, `?bgclock=off`): 8 s hidden with throttled timers and
CPU x4 gave 127 skipped queries and 25 dropped haps; a 2.5 s main-thread stall gave 47 skipped queries.
- The clock: `bgplay.js` replaces the scheduler's `clock` instance property at runtime (Strudel's code is unmodified) with the same
  per-tick work (same Cyclist fields, so seek, loop and capture keep working), ticked from a dedicated Web Worker timer (worker timers
  are not throttled like main-thread timers) and always against `AudioContext.currentTime`. Ticks that arrive after stop/pause are ignored (a stale queued tick used to move the clock to a negative or old cycle, #167; test `tests/site/transport_stop_play.mjs`).
- Adaptive lookahead: 0.2 s in the foreground (Strudel's own), at least 1.0 s while hidden, raised after late ticks (1.5 x the gap),
  bounded at 2.0 s, and decaying back once the page is visible and ticks are on time for 5 s. Cost: haps already scheduled cannot be
  taken back, so while the lookahead is raised a live edit or a pad quantise is heard up to that much later (at most 2 s, only right
  after a stall or while hidden; 0.2 s in normal foreground use).
- No catch-up, no fast-forward: if the audio clock still runs past the window (a frozen page, a stall longer than the lookahead), the
  clock re-anchors the same cycle at the current audio time and records a pause. A suspended or interrupted context stops the audio
  clock, so the cycle position freezes and continues from the same cycle on resume.
- Pause tracking: `visibilitychange`, `pagehide` / `pageshow`, `freeze` / `resume`, `blur` / `focus` and the AudioContext `statechange`
  feed a segment timeline (`running`, `hidden-running`, `paused`, `interrupted`, each with the cycle and audio-clock time where it began).
  Coming back after a pause of 1 s or more shows "Resumed at cycle N, paused m:ss".
- Policy (`?` dialog > Background playback, or the audio dot's sheet): "Continue in background if audio is running; pause cleanly if the
  OS suspends it" (default) or "Pause when the app is hidden; resume on return" (suspends the context while hidden).
- Keep alive, legitimately: a Screen Wake Lock while playing in the foreground (setting "Keep the screen on while playing", default on,
  re-acquired on return) and Media Session metadata with play / pause / stop handlers (lock-screen and notification controls where the
  browser shows them). No silent-audio loop or other keep-alive hack is used.
- Engine Worker (#180 stage 1, flag, default off): `?engine=worker` (or `localStorage sc.flag.engine`, or the Engine section of the audio dot's sheet) runs the program's evaluate,
  transport clock and pattern queries in a Worker (`engine-worker.js`, `engine-worker-host.js`, both lazy, nothing eager) and publishes timed events 0.6 s ahead (2 s hidden);
  the page only builds voices with the unmodified superdough. Only programs that read no page state and have no callbacks (no `hooks.*`, `ctl()`, taps, pads, capture, `.onTrigger()`, `.log()`, `.midi()`, `.osc()`) are eligible; others run on the page clock
  as before. Visuals and the lanes view read an event mirror from the Worker instead of querying the page pattern (`strudelCraft.bg.cycleHaps`). Limits and numbers: docs/AUDIO_ENGINE.md section 7; tests `tests/site/engine_worker_parity.mjs` and `background_audio_load.mjs --query engine=worker`.
- Phone control (#178): `node tests/site/background_audio.mjs` (site) and `node tests/site/background_audio_control.mjs` (a bare upstream
  `@strudel/web` 1.3.0 page, no site code) play `note("c4*8")` on a 360x780 touch profile through four cases: foreground, hidden 30-60 s with 1 Hz
  main-thread timers, continuous touch scrolling, CPU x4. Result: the site has 0 late events and 0 gaps in all four; upstream has 482 drop logs
  and 26 holes in the hidden case and is clean in the other three. Both open the AudioContext with the default `latencyHint` ("interactive"),
  so that is not a deviation from upstream. Not covered: heavy programs (see docs/AUDIO_ENGINE.md), real phones (iOS Safari, Android screen off).
- Heavy-program load (#178): `node tests/site/background_audio_load.mjs --prog docs/tracks/velvet-static/track.standalone.strudel.js [--throttle N] [--hidden] [--scroll]`
  reports scheduler lateness, audio-thread underruns (`playbackStats`) and main-thread cost per second (query passes, tick, voice build, nodes created, long tasks).
  velvet-static at x1 on the phone profile: 0 late haps, query passes 380 ms/s, voice build 4 ms/s, 306 nodes/s, 32 long tasks (worst 382 ms): the main-thread cost is pattern
  querying, not voice building. The throttled variants do not complete in the sandbox (the page closes under CDP throttling with this program); see docs/AUDIO_ENGINE.md for the x4/x6 numbers.
- Play-time clamp: counts played time only (audio-clock time while the context runs), not wall time; the transport readout shows
  "N left · played m:ss · paused m:ss".
- Background citizen: no drawing while hidden (stage scope, lanes, meter, inline `_scope` / `_pianoroll` widgets, graph playhead), the
  #56 tracker does not poll while hidden, the history editor poll pauses, and the pending history autosave is flushed on `pagehide` and
  when the page is hidden. Record takes mark gaps (docs/CAPTURE.md).
- Diagnostics: tap the audio dot: clock kind, context state, lookahead in use, ticks and late ticks, max tick gap, underruns
  (re-anchors), engine (main thread, worker clock), main-thread long tasks and the worst, late haps (scheduled after their time,
  which superdough drops), skipped ones (the voice settled after its target) and tight ones (under 20 ms), voices in flight (from events), query and voice-construction time,
  played / paused time, the segment timeline, the policy, and the Engine flags (applies after reload).

## Audio engine flags and measurements (docs/AUDIO_ENGINE.md, #102-#104)
- Measured on night phonk v1/v2 at 360 px with CPU throttling (`tests/site/engine_perf.mjs`, `tests/site/engine_perf_matrix.sh`): the
  main thread was saturated by pattern queries, mostly visuals.js re-querying four cycles on every animation frame; stalls longer than
  the lookahead re-anchor the clock (heard as tempo jumps) and late haps are dropped by superdough (dropouts, also in bus readers).
- Offline renders are deterministic (#115): the render waits for every reverb impulse response and runs superdough's `ended`-driven timeouts (ducker, modulators) at their stop time while the render is suspended, so two unthrottled renders of one recipe agree to -120 dB. Flag `timers=real` restores the raw events (A/B); the per-hap diff is `tests/site/hap_diff.mjs`.
- Flags (`?k=v` or `localStorage sc.flag.k`, also in the audio dot's sheet): `vis=cache|every|requery` (visuals and highlights from a
  per-cycle hap cache run under a frame budget (2 % of the time while the page is stressed), default cache; `every` runs each frame), `sched=strudel|batch` (scheduler query windows of 0.05 s or 0.2 s), `rec=host|inline`
  (offline renders in the render host page or in the page itself, default host). The numbers before and after are in docs/AUDIO_ENGINE.md.
- Render host: `index.html?host=render` loaded in a hidden iframe renders every offline take (Record's default Offline render,
  Render exact, reference renders, Remake, lane captures) with its own Strudel and superdough, so the live transport keeps playing.
- Coming: the engine worker (evaluate, compile passes and pattern queries in a Worker, the main thread only schedules voices;
  tests/site/engine_worker.mjs).
- API: `strudelCraft.bg = { stats(), segments(), gapsBetween(a, b), events(), setPolicy('continue' | 'pause'), setWake(bool),
  openDiagnostics(), played, paused, trace }` (`trace = true` records `[cycle, target time]` of every scheduled hap, for tests).
- Verified in headless Chromium (`node tests/site/background.mjs`, 20 checks): hidden plus throttled main-thread timers plus CPU x4 with
  no hole, every 1/8 cycle scheduled once and spaced exactly 0.25 s; a modelled freeze (freeze event, 3 s with no main thread, resume
  event) and a 2.5 s stall resume at the same cycle with no burst; a suspended context freezes the cycle; the pause policy; the clamp;
  no drawing while hidden; Media Session state; the diagnostics sheet. Not verified: real Android Chrome (screen lock, app switch,
  renderer suspension, whether the media notification appears for Web Audio-only output), real tab hiding (headless never hides a tab,
  so hidden and its timer throttling are emulated), and the CDP freeze itself, which has no effect on a page playing audio in headless
  Chromium. Wake Lock is refused in headless (no permission); the code path is exercised, the lock itself is not.

## Install on Android
Strudel Craft is an installable app (PWA, #73). In Chrome on Android open https://glyphcore.github.io/Strudel-craft/, then tap
**Install app** (in the `?` dialog, the `...` overflow menu or Ctrl+K > App); Chrome's own menu > *Install app* works too. After you
have played something for a while, a one-time toast offers it as well (never on first load). Installed, it opens full screen
(`display: standalone`), keeps working offline after the first visit (loading, the editor and Play; uncached sample banks toast), follows the "New version, tap to reload" toast on deploys,
and a long-press on its icon gives Rack, Stack, Record (opens capture) and Perform shortcuts. iPhone / iPad: Safari > Share >
*Add to Home Screen* (the Install app button shows this hint in browsers without an install prompt). Desktop Chrome/Edge can also
open recipe `.json` files with the installed app (file handler -> Record panel `importRecipe`).
- Files: `manifest.webmanifest` (relative `start_url`/`scope` `./` for the `/Strudel-craft/` path, theme/background `#0b0d10`,
  icons 192/512 any + maskable + SVG, shortcuts, `file_handlers`), `icons/` (sources `icon.svg`, `maskable.svg`; PNGs from
  `node tools/pwa/icons.mjs`), `pwa.js` + `pwa.css` (install offer, `beforeinstallprompt`, `appinstalled`, `display-mode: standalone`
  -> `html.pwa-standalone` with the header owning the status-bar inset, `?action=record`, `launchQueue`, offline toasts).
- API: `strudelCraft.pwa = { install(), hint(), canPrompt, installed, standalone }`.
- Check: `node tests/site/pwa.mjs` serves `site/` under `/Strudel-craft/` and asserts CDP `Page.getInstallabilityErrors` is empty,
  icons load at their declared sizes, every fetched shell file is precached, offline reload, the offline bank toast, the update toast,
  and the standalone layout (writes `docs/screens/pwa.json` and `pwa-*.png`).
  `node tests/site/pwa_offline.mjs` installs on a first visit without Play, turns the network off and checks the snapshot (precache.json files, CDN graph,
  sample maps), offline CodeMirror, offline Play (engine, running context, bgplay worker clock), one uncached-bank toast, the vox fallback, pack pins, no failed
  code or data request, and the atomic swap per VERSION (writes `docs/screens/pwa-offline.json` and `pwa-offline-play-390.png`).
- Not done: `share_target` (a POST target needs the service worker to be in control before the share, otherwise Pages answers 405).

## Run locally
    python3 -m http.server 8000 --directory site     # open http://localhost:8000

## Tests (from the repo root)
- `node tests/site/cues.mjs [shot.png]`: CraftCues at 390 px touch (captions at bars 17 / 33 / 65 of night phonk v2 within 1 bar of the transport, KB card without editor movement, Score sheet, export, Resources Cues section, inline Go to code, Record .vtt, quick play captions); `node tests/cues/cues.mjs`, `node tests/cues/vtt_browser.mjs` (format, fuzz, WebVTT parser).
    node tests/site/smoke.mjs          # Playwright Chromium: keyboard, views, every recipe plays, frame time, screenshots
    node tests/site/smoke.mjs --quick  # first 4 recipes only
    node tests/site/comments.mjs       # comment torture: comments in every position give zero diagnostics, same compiled code, same control ids (engine/comments.js)
    node tests/site/packs_sandbox.mjs  # sandbox host: escape attempts, protocol abuse, timeouts, consent (#71)
    node tests/site/packs_code_ui.mjs  # Code tab, gesture-only grants, trust list, links / history never grant, sandboxed control renderer (#71)
    node tests/packs/alias_e2e.mjs     # aliases end to end: atom, hook def, recipe, library on the site modules and the CLI (#120)
    node tests/site/taxonomy.mjs       # folders, tags, appearance (real touch): rules, AA contrast, 390 px tree / chips / filter / search / persist / overrides (#120)
    python3 tests/packs/taxonomy.py    # folder / tag / taxonomy validation (E_PACK_FOLDER, W_PACK_TAG); node tests/packs/aliases.mjs; node tests/packs/cli_taxonomy.mjs
    node tests/site/packs_offline.mjs  # offline cache of fetched packs (#174): offline reload + standalone launch with zero host requests, revalidation, tampered entry, never-fetched, Packs view actions
    node tests/site/packs.mjs          # pack loader: parity, empty lock, vectors, integrity, shadowing, lazy, offline, security (#67)
    python3 tools/packs/shim.py --check  # the shim pack pins match site/data (rerun without --check after editing data/)
    node tests/site/lighthouse.mjs     # needs `npm i -g lighthouse@12`; mobile perf / a11y scores
    node tests/site/shell_budget.mjs   # eager-shell allow-list + byte budget (#59; also in smoke)
    node tests/site/lazy_fail.mjs      # failed lazy imports: toast + Retry, no half-open view, hooks completions at first popup (#59)
    node tests/atoms/a1.mjs            # atoms core (#61); STRUDEL_MODULES=<dir with @strudel/> for the rendered checks
    node tests/site/inline_widgets.mjs # inline visuals as block widgets under their line (360/1440, Rack/Stack, no shift on Play)
    node tests/atoms/a2.mjs            # atoms migration: extract / parse / inline / catalog (#62)
    node tests/atoms/a3.mjs            # atoms consumers: intellisense data, hooks / model / pads / maps $atom, packs (#63)
    node tests/site/atoms.mjs          # Playwright: atom completion, signature help, "use atoms.name", scrub on a reference arg (#63)
    node tests/atoms/a4_lazy.mjs       # atoms lazy declaration pass: lazy == eager, 5000 declared parse budget (#64)
    node tests/site/editor_history.mjs # Playwright: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (and Caps Lock) edit undo, Insert one step, 390px touch buttons, Alt+Z version history (#177)
    node tests/site/editor_interact.mjs # Playwright: literal popover stays in the viewport + drag (mouse/touch), caret on pointerdown for every node type (cold load), inlay hints inline / not copied / no caret stops (#169)
    node tests/site/atoms_ui.mjs       # Playwright: atom cards, derived cards, browser, popover, keyboard path, 5000-atom paint (#64; also in smoke)
    STRUDEL_MODULES=... node tests/lanes/l1.mjs  # lanes L1: tap cache, lane scope, tags, selections, checks (#74); CLI box prints SKIP without the `strudel` CLI
    STRUDEL_MODULES=... node tests/lanes/l3.mjs  # lanes L3: capture / recall / .from events, time rules, cycles, bounds (#76); CLI boxes print SKIP
    node tests/site/lanes_capture.mjs  # lanes L3: audio pass, frame count, level, captured sample plays (Playwright, real superdough)
    STRUDEL_MODULES=... node tests/lanes/l4.mjs  # lanes L4: model schema, round trip, completion, atom types, ids, bus numbers, invariants (#77); needs core, mini, transpiler
    node tests/site/lanes_data.mjs     # lanes L4: graph() data (lane cards, buses, selection chips, split fan, capture node, E_LANE_CROSS fixes), no runtime needed
    node tests/site/hooks_pack.mjs     # hooks kind (#91): pack track vs standalone haps over 80 bars, offline levels, removal
    node tests/site/hooks_pack_v2.mjs  # hooks kind (#91): night phonk v2 pack version on the site = strudel CLI events (cycles 0-20), plays with a master peak
    node tests/packs/hooks_kind.mjs    # hooks adapter units (needs STRUDEL_MODULES)
    node tests/hooks/p3.mjs            # model round trip (#49); the `strudel` CLI checks print SKIP without it
    node tests/hooks/p4.mjs            # component library, instances, lib: fragments (#50)
    node tests/hooks/p5.mjs            # hooks + model intellisense providers (#51)
    STRUDEL_MODULES=... node tests/hooks/p9_hook.mjs   # .hook() and the hygiene racks (#94)
    node tests/hooks/p10_groove.mjs                    # .groove() and the groove-* presets (#109)
    node tools/racks/audit.mjs --only racks            # rack standard audit (#94; needs the strudel CLI; full audit without --only)
    node tests/lanes/mixer_model.mjs   # mixer read model over the lane graph (#95)
    node tests/site/graph.mjs          # Graph view (#52); tests/site/graph_zoom.mjs, graph_scroll.mjs for the gestures
    node tests/site/graph_soak.mjs     # Graph view open/close soak: no growth after GC across 50 rounds (#52 stability)
    node tests/site/perform.mjs        # Perform view, learn/map, lanes, looper (#55)
    node tests/site/perform_presets.mjs # Perform presets + outputs/sources, the 2-hit tap pad
    node tests/site/perform_pads_audio.mjs # every preset pad is audible on the master analyser (touch, 390 px, #116)
    node tests/site/word_intellisense.mjs  # word() completions from data/intellisense/words.json (#44)
    node tests/site/vox.mjs            # vocal banks and voxBank()
    node tests/site/resources_model.mjs   # Resources model, insert plan and the `strudel refs` CLI twin (night phonk v2)
    node tests/site/resources_parity.mjs  # Available search = `strudel refs --available --q` (13 default + 3 deep queries)
    node tests/site/resources.mjs         # Resources pane at 390px touch (docs/RESOURCES.md)
    node tests/site/voxbrowser.mjs     # Banks browser and bank-aware word() completions at 360px (#85)
    STRUDEL_MODULES=... node tests/vocals/formant_helper.mjs  # word().formant(true) on a synthetic bank (#57)
    node tests/site/capture.mjs        # Record panel audio at 360px: 2-cycle take, WAV 16/24 header + length, file name, quota, rename/delete modals, tab switch, exact render (#72)
    node tests/site/record_hooks.mjs   # Record hooks for lanes capture: capture.addTake (meta.from) and capture.beforeRender (#76)
    node tests/site/record_offline.mjs --ref REF/mix.wav   # offline Record while playing vs the CLI render, determinism, Cancel, live self-check (#104); REF from tests/site/ref_render.sh REF v2 16 8
    node tests/site/engine_perf.mjs --prog v2 --throttle 4  # audio engine measurements: long tasks, LoAF sources, profile, scheduler lateness, late haps (#102); matrix: tests/site/engine_perf_matrix.sh OUT
    node tests/site/record_length_unit.mjs  # Record length model: bars/cycles/seconds, end of track, clamp, recipe compat (#139)
    node tests/site/record_length_parity.mjs  # end-of-track parity, site resolver vs CLI --to-end (#139)
    node tests/site/record_length.mjs  # Record Length UI at 390px: typed 12 bars exact frames, To end resolves a gate, old recipe replays (#139)
    node tests/site/record.mjs         # Record panel + recipes at 360px: record, download, clean-profile Remake hash match, tamper refused (#72)
    node tests/site/audio.mjs          # sound + visuals after Play at 360px DPR 3 touch: fresh profile and stale service worker (master peak, scope pixels, widgets, Stack typed program)
    node tests/site/background.mjs     # background playback: hidden + throttled timers + CPU x4, freeze, stall, suspend, policy, clamp, no drawing while hidden (--baseline measures Strudel's own clock)
    node tests/site/syntax_nav.mjs     # Syntax navigation: 390px touch flow, deep link, persistence, old anchors, open/scroll perf at CPU x4
    node tests/site/organizer_layout.mjs   # organizer layout (#179): Recipes and Syntax at 1440x900, 1024x700, 768x1024, 390x844, 360x740 with the tree and 8 tags expanded: bounded filter region, list/entries >= 45% of the viewport, no intersection, toggle persists, last row reachable
    node tests/site/standalone.mjs     # installed app (standalone, SW in control): sound peak, scope pixels, Syntax examples; upgrade from older builds; Range pass-through; Syntax error state + Retry
    node tests/site/pwa_offline.mjs    # installed app offline: first-visit snapshot (files, CDN graph, sample maps), offline editor + Play, bank toast, atomic VERSION swap (#73)
    node tests/site/quickplay.mjs      # Quick play (#150): in-place audition from Recipes rows and Syntax examples at 390px, peak while playing / 0 after stop, nothing else touched
    node tests/site/pwa.mjs            # installable PWA at /Strudel-craft/: installability errors (CDP), icons, precache, offline reload, offline bank toast, update toast, standalone (#73)

Outputs go to `docs/screens/` (`metrics.json`, `lighthouse-mobile.json`, PNG screenshots at 390px and 1440px).

## Packs (`packs.js`, `packs-kinds.js`, `engine/packs-core.js`, #67; docs/PACK_SPEC.md)
All content is read through `window.strudelCraft.packs` (`api` 1.0.0), never fetched directly. The site boots on the **shim pack** `glyphcore/shim`
(`craftpack.json`, pinned by `packs.lock.json`, request file `packs.json`): its ingredients are today's `data/*` files, so nothing moves and the site
looks and sounds the same. After you change a `data/` file (for example `build_catalog.py`), run `python3 tools/packs/shim.py` to refresh the pins;
a stale pin is `E_PACK_HASH` and that content is missing (fail closed). `shim.py --check` is the read-only test.
- Content pack **`glyphcore/phonk`** (`data/phonk/`, source `file:data/phonk`, CC0-1.0; pinned by `shim.py` too): `atoms` (atoms@1, 22 atoms under `ph.`,
  `atoms.import("pack:glyphcore/phonk:atoms")`), `presets` (recipes@1, the night phonk track in the Rack browser) and `racks` and `racks-v2` (hooks@1 rack defs; a program that
  names the pack, as `atoms.import("pack:glyphcore/phonk:atoms")` does, gets them in the hooks registry on every evaluation (#91); the CLI uses `--hooks data/phonk/racks.json`). Detail `data/phonk/README.md`.
- Lock layers: shipped (`packs.lock.json`), user (`localStorage` `sc.packs.lock`), session (memory). Precedence, shadowing and the report come from the shared
  `engine/packs-core.js`; `packs.prefer(id)` writes priority 10. A qualified id (`author/pack:item`) always resolves to its own pack.
- Data API (for the pack sheet): `ready`, `list()`, `credits()`, `items(kind)`, `resolve(kind, ref)`, `report()`, `describe(ingredient)`, `load(id)`, `loadAll()`,
  `add/remove/prefer/grant/revoke/offline`, `codeEnabled()`, `setCodeEnabled(bool)`, `trusts()` (every code grant this browser holds: `{pack, ingredient, qualified, hash, at,
  modules, loaded, current, allowCode, layer, state, record}`, read-only; `revoke('author/pack:id')` also drops a record whose pack is not loaded), `propose/peek/accept/proposals` (`?pack=<source>` only proposes: the manifest is fetched after `peek`, nothing else until `accept`,
  and accepting never grants code), `on('state'|'report'|'lock'|'offline', fn)`, `registerKind(def)`. Pull views used by the site: `catalog()`, `controlTypes()`,
  `syntax()`, `doc(name)`, `paramShapes()`, `editors()`, `completions()`, `words()`.
- Kinds with an adapter: `recipes`, `control-types` (`controls.registerType`), `intellisense` (`intellisense.register`), `param-shapes`, `param-editors`, `syntax`, `docs`
  (every `html` block is sanitised), `sounds` (`samples()`; a losing key is registered only as `<author>_<pack>__<key>`), `vox-bank` (manual; `voxBank('<id>')`), `atoms`
  (`E_ATOM_HASH`), `hooks` (#91: chain-only defs installed per evaluation when the program names the pack; code-bearing defs refused (a hooks `s`/`sound` step may not select bytebeat/zzfx/z_* sources; `tests/site/hooks_allowlist.mjs` also checks every shipped lock hooks ingredient validates) with `E_PACK_CODE_GRANT`, never run; chain steps are a reviewed positive allowlist, the data file `data/hooks-steps.json` (per method, the accepted argument shapes; no string-compiling, speech, visual, loader or registering methods; a method not listed is rejected naming it; how to propose a step: PACK_SPEC 5.2), arguments are scalars unless the method's entry declares a shape (`param`, `mini`, `wire-opts`, `groove-opts`), arrays never, names are conservative identifiers, `wire`'s target must be a control flagged `"wire": true` in that file (animate, visuals, string controls and prototype members are rejected naming the target; the engine resolves the key from Strudel's control registry and a non-control throws `E_BAD_ARG`, also in user code), a bad def is skipped (named in one toast, `E_PACK_HOOKS_INVALID`) and the other defs load, only an ingredient-level error refuses the whole ingredient (PACK_SPEC 5.2; `tests/site/hooks_groove_pack.mjs`: the 9 glyphcore/phonk:grooves defs load and match the CLI; `packs validate --site-allowlist` fails CI when a pack uses a step the site does not allow); installer `packs-hooks.js` loads lazily), and the extension kind `x-glyphcore.words`. `layouts`, `palette-actions`, `visuals`, `components` are skipped with `W_PACK_KIND` (coming).
- Integrity: manifest checked against the lock, each entry file against the manifest, before it is parsed (`E_PACK_HASH`: dropped, not cached). The browser checks
  structure per kind; the full JSON schemas run in CI (`tools/packs/packs.py validate`).
- Code (#71, `packs-sandbox.js`, loaded lazily): `code: true` ingredients run only in the sandbox host (a Worker in an `<iframe sandbox="allow-scripts">` with a no-network CSP,
  data-only `MessageChannel`, timeouts, message caps, at most 4 frames; PACK_SPEC 10.4 has the threat model and the residual risks) and only when **all** hold: hash-verified,
  `allowCode` plus a trust record for the exact code hash (`packs.grant`, called only by the pack sheet's trust dialog; `packs.revoke`, `packs.codeInfo(ref)` for the dialog data
  and the changed module paths), and the flag is on. **Flag (default off):** the **Code** tab of the pack sheet (`localStorage` `sc.packs.code`, `packs.setCodeEnabled`). A history restore
  never raises consent: `history.checkout` keeps `sc.packs.code` off unless it is on now, keeps only trust records present now with the same hash, and limits
  `allowCode` in the restored lock to what is granted now (grants still appear in history as `code trust` / `pack lock` commits). Built kinds: `control-types` renderers (`packs-control.js` + `packs-control.css`, lazy: a type with `renderer: {module}`
  draws in its own sandboxed frame mounted in the control's slot, inert and below modals, toasts and the transport; the host slot owns focus and input, sends
  `draw` / `input` as data, clamps `{set}` to `min..max`, labels the frame "third-party <pack>", and falls back to a host-drawn control when untrusted, off,
  timed out or killed; `controls.registry.renderer(id)(host, name, spec, {get, set})`; the Perform board does not call registry renderers yet), and
  `intellisense-provider` (module calls `craft.handle('complete', ({before, after, line, pos}) => [{label, category, detail,
  info, apply}])`; starts on the first completion, never on load). Other code kinds (`param-editors` editors, `visuals` painters,
  `palette-actions` `run`) stay `blocked` (coming). Errors: `E_PACK_CODE_GRANT`, `E_PACK_CODE_TRUST`,
  `E_PACK_SANDBOX_TIMEOUT`, `E_PACK_SANDBOX_PROTOCOL`, `E_PACK_SANDBOX_LIMIT`. Main-realm code from the user tier is `E_PACK_CODE_REALM`; a module without `code: true` is
  `E_PACK_CODE_UNDECLARED`. Program text (recipes, syntax) runs only after Load/Play. Test: `node tests/site/packs_sandbox.mjs`.
- Cache and offline (`sw.js`): `sc-packs-1` holds verified manifests and entry files and is not deleted on activate. The page registers pack roots with the service worker,
  which serves them cache-first, keeps them out of the shell cache and hash-checks asset files (audio) against the verified `files.sha256` before caching (a mismatch is a 502).
  `packs.offline(id, true)` fetches the whole asset index. Mirrors are tried first, then the source; the hash tree decides. The shim lives in the deploy and uses shell caching.
- Offline cache for fetched packs (#174, `rescache.js`): bodies stay in Cache Storage, an IndexedDB index (`sc-rescache`: url, ref = lock source, version, hash, size, fetched-at, owner pack) says what is held.
  A pack loaded once online loads offline from cache with no request attempted; every cached body is hash-checked against the lock on every load, and one that fails is removed from cache and index (never run).
  Online, 5 s after load, the pack source's manifest is re-read in the background (stale-while-revalidate): a different one is fetched and recorded as `newer`, a toast says so, and nothing in the running session changes;
  `packs.update(id)` (the pack card's **Update**) applies it on demand (remove + add from the source, code grants dropped). Sample maps (`sc-banks-1`, `*.json`) revalidate the same way in `sw.js` and toast "a newer sample map was fetched" (applies next load).
  A pack never fetched, opened offline: state `unavailable`, `E_PACK_UNAVAILABLE` naming the file, one toast naming the pack, and the Packs view says "open it once while online".
  API: `packs.cacheInfo()` -> `{ [pack]: { cached, files, bytes, fetchedAt, ref, version, newer } }`, `refresh(id)` (re-fetch and re-verify every cached file), `uncache(id)`, `update(id)`, `storage()` (usage, quota, persisted), `persist()`,
  events `cache`, `newer`, `missing`. Packs view: per-card **Offline cache** line with **Refresh**, **Remove from cache**, **Update to vX**, and a storage bar (quota use, persistence, **Keep storage**). `navigator.storage.persist()` is requested on the first cached pack file.
  Not covered: Strudel modules (unpkg/esm.sh) stay in the deploy's atomic snapshot and are not revalidated; sample audio caches lazily in `sc-banks-1` as before. Check: `node tests/site/packs_offline.mjs`.
- Pack sheet (`packs-ui.js`, `packs-ui.css`, loaded on first open only): command palette **Packs, licences and credits** (Ctrl+K, or the palette button on
  phones), the **Open packs** button of the empty recipe browser, the **Pack** badge in the Inspector, or the toast a `?pack=` link raises. Tabs: *Packs* (one card per
  pack: id, version, tier, state, authors, licence, licence file, credits, source, manifest hash with its verification, E_PACK_/W_PACK_ errors and warnings,
  ingredients with state, size, load mode and the "contains code" mark), *Code* (#71: the code-ingredient switch, `role="switch"`, default off, with what turning
  it on allows and does not allow; the trust list: every grant from `packs.trusts()` with pack id, ingredient, the full code hash, when, its modules, whether it can run
  (runs / stale: code changed / orphan: pack not loaded / lock-only), **Revoke** (site modal), and "confirmed here" only for grants made through the trust dialog in this
  tab, otherwise "not confirmed here" (an earlier visit, another tab or a script: program text run in the page can write `localStorage`)), *Credits* (`packs.credits()`), *Report* (`packs.report()` errors, warnings, shadowed names).
  Every field is shown as the manifest records it; a missing one reads "not declared" (no licence is assumed). Actions confirm in the site modal and report in a
  toast: add by source (fetches the manifest only, shows it as a proposal card; **Add pack** pins its hash, never grants code), accept a `?pack=` proposal
  (**Fetch manifest** first), remove (user and session packs), prefer (shown when more than one pack is loaded), keep offline (packs not served from the deploy),
  grant code (user packs: the trust dialog). Granting and switching code on take effect only when the modal is confirmed by a trusted click or key press inside it
  (`event.isTrusted`, `navigator.userActivation`); a scripted `click()` or `requestSubmit()` changes nothing. Switching off needs no confirmation. With no user packs the sheet shows a "No packs added" empty state; with an empty lock, "No packs loaded".
- Recipes from a non-core pack show their pack id next to the title in the browser (`.row .pk`); core recipes have no badge. With no recipes at all the browser
  shows a "No recipes" empty state with **Open packs**. `strudelCraft.recipes.reload()` re-reads the catalog after the lock changes.
- `packs.verify(ref, hash)` (also `verify` in `engine/packs-core.js` for node): async integrity check of a pinned reference, no UI, nothing loaded. `ref` is `author/pack[:ingredient][@github:o/r@<40 hex>[/path]]`
  or `{id, item, source}`; `hash` is `sha256:<64 hex>` (the lock encoding). Pack ref = `craftpack.json` hash, item ref = that ingredient's entry file. Resolves
  `{ok:true, ref, hash, source}` or `{ok:false, code, ref, expected, actual?, offline?}` (`E_PACK_HASH`, `E_PACK_ID`, `E_PACK_SOURCE`, `E_PACK_UNAVAILABLE`, ...); uses the loader's
  fetch, hash and `sc-packs-1` cache (verified entries only). PACK_SPEC 11.1.
- Tests: `node tests/site/packs.mjs` (loader and `packs.verify`; synthetic fixtures from `tests/packs/` plus packs it generates), `node tests/site/packs_ui.mjs` (sheet, badge, empty
  states; writes `docs/screens/*-packs*.png`, `phone-360-empty-browser.png`).

## CC0 instrument pack `glyphcore/freepats` (`data/freepats/`, `tools/freepats/`, #181)
Three CC0 FreePats instruments, selection via the openDAW factory catalogue (the audio comes from the upstream FreePats archives, not from openDAW's servers): Concert Harp (`fp_harp`), Drawbar organ (`fp_organ`), Xylophone, medium mallets (`fp_xylophone`).
Licence CC0-1.0. Credits: the FreePats project (Roberto, zenvoid.org; harp and xylophone from the Versilian Community Sample Library, Versilian Studios LLC, CC0) and the openDAW selection; they are the manifest `attribution` rows, shown in the Packs view under Credits, with per-archive SHA-256 in `data/freepats/README.md`.
- Play: `note("c4 e4 g4").s("fp_harp")`; recipes `fp-harp`, `fp-organ`, `fp-xylophone` (pack `needs` the sounds ingredient). Sound names appear in the Sounds completions through the pack's `sounds` ingredient.
- Size: 1.34 MB of ogg in total (largest file under 70 KB; 47 files; 1.0.1 levels every note to the same rms with -9 dBFS peak headroom), one velocity layer, the SF2's own root-key zones (a zone every 3 to 6 semitones), cut and faded (`tools/freepats/extract.py`, `sf2.py`; build-time only, the SF2 is not shipped).
- Lazy: the sample files are not in `precache.json` (the three small JSON files are, about 6 KB); `sw.js` runtime-caches `/data/freepats/**.ogg` in `sc-banks-1` on first play, so the instruments play offline after one online play. `node tests/site/freepats.mjs` (360x780 touch): lazy load, three recipes play, offline reload plays from cache.
- Not included: Spanish classical guitar and Upright Piano KW (FreePats publishes only `.7z` for them; no extractor available), GPL/unlicensed openDAW items.

## Referenced instrument packs: `glyphcore/vcsl`, `glyphcore/salamander-piano` (`data/vcsl/`, `data/salamander/`, kind `sample-source@1`, #183 stage A)
Real sampled instruments with no audio in this repo or on our Pages origin. Each pack's `sources/sources.json` names a remote map (`index_url`), the sound names it provides, `license`, `attribution`, `terms_url` and the fetch check (CORS, status, date).
- `glyphcore/vcsl`: Versilian Community Sample Library (Versilian Studios LLC, Sam Gossner), CC0 1.0, 128 sounds (marimba, vibraphone, harp, kalimba, glockenspiel, tubular bells, timpani, bassdrum1, snare_modern, hihat, cajon, organs, winds, ...) through Strudel's own `https://strudel.b-cdn.net/vcsl.json`; files on raw.githubusercontent.com. Recipes `vcsl-marimba`, `vcsl-harp-pluck`, `vcsl-drum-kit`.
- `glyphcore/salamander-piano`: Salamander Grand Piano V3, Alexander Holm, **CC BY 3.0 (credit required: keep "Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0" with any track using `piano`)**, through Strudel's `https://strudel.b-cdn.net/piano.json` (mp3s on raw.githubusercontent.com). Recipes `salamander-piano-chords`, `salamander-piano-melody`.
- Credits and licence/terms per source are in the manifests and shown in the Packs view under Credits. The pack manifests themselves are CC0; the audio keeps its own terms.
- Lazy: Play calls `packs.activateSources(code)`; a source's map is fetched only when the program names one of its sounds (`s("piano")`), and audio files only as notes play. A synth-only program requests nothing from those hosts. The two small entry JSON files per pack are in the shell cache.
- Offline (#174): the pack cache (`sc-packs-1`) only hash-pins what the pack hosts, so referenced audio is not in it. `sw.js` runtime-caches `raw.githubusercontent.com` audio in `sc-banks-1` (best effort, last 1500 files) after the first play; the map on `strudel.b-cdn.net` is not handled by the worker (it may come from the browser HTTP cache). Never-played sounds need the network. No proxying. A one-line addition of the map host to the worker's runtime-cached hosts is proposed, not done.
- Coming (not built): VSCO-2 CE strings/brass/winds, CC0 drum kits (Gogodze Phu, Big Rusty), gm_ soundfont presets (licence audit pending); gaps: choir, bass guitar, electric/steel guitar.
- Levels: recipe gains are set so each recipe peaks around 0.4 at the master bus (VCSL sets are quiet: marimba gain 25, drum kit 4, harp 2); `node tests/site/instruments_level.mjs` captures the real destination mix. Licence split: the audio keeps its own licence (VCSL CC0, Salamander CC BY 3.0 Alexander Holm, credit required); each pack's manifest, source list and recipes are CC0-1.0 (see each pack's LICENSE.md).
- Test: `node tests/site/instruments.mjs` (360x780 touch, real network): no request to the hosts before a program names a sound, then map and audio arrive per recipe.

## Regenerate the data
`site/data/*.json` is generated by `engine/strudel/build_catalog.py` (see that tool), except the recipes with `origin: "concepts"`, which `node tools/concepts/build.mjs` writes (Craft `code` + generated `lowered`; `node tools/lowering/build.mjs` verifies them and annotates `syntax.json`); the UI reads `catalog.json`
(`categories`, `labels`, `recipes[]` index rows: `id,title,labels,folder,tags,family,needs_samples,verified,stackable,has_lowered,body`; compact JSON since #166).
**Recipe bodies are lazy (#131).** `intent,code,expr,notes,source,error,lowered,lowered_note,lowered_check,origin,unverified,bpm_hint,rms_dbfs,centroid_hz,peak` (#166: the row tooltip shows the title until the body loads; the first search loads every body, so intent stays searchable) live in `data/recipes/<family>.json` (one shim ingredient `bodies-<family>`, kind `x-glyphcore.recipe-bodies`, `load: lazy`, listed in `precache.json` so offline works). The Recipes view lists, filters, sorts and counts from the index; the first open / play / quick play / stack / text search / `<id>` completion of a row fetches its family file, merges it in place and shows a spinner row (Retry on failure). Tools and tests read the full catalog with `tools/catalog/lib.mjs` `readCatalog(root)` (tests: `tests/lib/catalog.mjs` `fullCatalog()`), never `data/catalog.json` for code; `node tools/catalog/catalog.mjs split|check|export OUT.json` splits an old monolith, checks the split files and writes a monolithic export for the CLI and other tools (not shipped). Order after a catalog change: `node tools/concepts/build.mjs`, `python3 tools/packs/shim.py`, `node tools/lowering/build.mjs`, `python3 tools/packs/shim.py`, `node tools/pwa/precache.mjs`. Layout and schema: docs/PACK_SPEC.md 14.5. Tests: `node tests/site/recipes_lazy.mjs` (first paint fetches one family file; spinner row; Retry; text search; deep link; offline reload plays a recipe), `node tests/site/recipes_first_open.mjs [SITE_DIR] --cpu 4` (first-open timings and data bytes; also runs on an older site folder for before/after).

## Comments in program text (`engine/comments.js`)
Every text pass reads comment-blind text: `blankComments(src)` returns the program with each `//` and `/* */` comment replaced by spaces (same length, newlines kept,
so line numbers, offsets and the AST-bound control ids do not move); strings, template literals (with `${ }` code) and regex literals are respected, so
`"https://x"` is not a comment. `commentRanges` and `inComment(src, pos)` are exported too. Users: the lanes pass (`.split/.merge/.send/ret`, scan, statements,
calls), `hooks.protect`, the tempo / sample-map / copy-code readers in `app.js` and `copycode.js`, `record-length.js`, `inline.js` (`mergeAccept`), and the
editor's signature / completion context (no popups inside a comment). The acorn passes (control binding, atoms, graph) already ignore comments. The CLI reads
the same module through `STRUDEL_CRAFT` (`engine/strudel-cli/lib/comments.mjs`). A new text pass must call it first; tests: `tests/site/comments.mjs`.

## Code editor and intellisense (`intellisense.js`)

Undo / redo: `intellisense.js` adds a highest-precedence Ctrl/Cmd+Shift+Z handler (Caps Lock reports key `z`, which CodeMirror reads as undo) and wires the `[data-ed-undo]` / `[data-ed-redo]` head buttons to `undo` / `redo` from `@codemirror/commands`, enabled by `undoDepth` / `redoDepth`; test `node tests/site/editor_history.mjs`.
The `#code` and `#stackCode` textareas are upgraded to CodeMirror 6 (`codemirror@6.0.1`, `@codemirror/autocomplete@6.18.6`,
`@codemirror/lang-javascript@6.2.3`, loaded from esm.sh). The textarea stays the source of truth (its `value` is kept in sync both ways),
so if the CDN is unreachable the plain editable textarea remains. Hovering a known function shows its signature.

Completions come from a runtime registry. Built-in providers:
- `strudel-docs`: static data, `data/intellisense/strudel.json` (`items[]`: `label, detail, info, category, method?, string?`).
- `catalog`: recipe presets from `data/catalog.json` plus the recipe bodies, fetched on the first completion request (inserts the recipe `expr`, the plain expression; recipes with Craft syntax also offer `<id>.craft`, the Craft program).
- `runtime`: after Strudel loads (`strudel:ready` event): `Pattern.prototype` methods, new global functions, loaded sound names (`soundMap`).
- `user`: names (`const x`) and quoted values the user types, persisted in `localStorage['sc.intellisense.user']`.
- `words` (`word-intellisense.js`, #44): word names inside quotes in any string, from `data/intellisense/words.json` (item shape of `engine/vocals/complete.py`: `{name, kind, detail, n}`; names and counts only, no audio).
- `vox-banks` (`vox-banks.js`, #85, a completion source): inside `word("` the options come from the ACTIVE bank (section `words · <bank>`, detail = takes and pitches; keys it lacks fall back to `demo`, labelled), refreshed when `voxBank()` switches; inside `s("vs_` from the sound bank's keys. Bank files are read through the pack loader on first use.
- `hooks` and `model` (`hooks-intellisense.js`, #51): see below.
- `syntax` (`syntax.js`): every runnable Syntax-view example as a snippet.

API:
    const off = window.strudelCraft.intellisense.register({
      id: 'my-provider',
      items: async (ctx) => [{ label: 'gm_piano', category: 'my sounds', string: true, detail: 'sound', info: '...' }],
    });
    strudelCraft.intellisense.invalidate();   // re-query providers
    strudelCraft.intellisense.providers();    // ids
    strudelCraft.intellisense.learn(text);    // feed the user list; .forget() clears it
Item flags: `method: true` = offered after `.`; `string: true` = offered inside quotes; `apply` = text to insert; `category` groups the popup.
Context-sensitive extras (one position at a time, #63):
    strudelCraft.intellisense.registerSource({ id, complete(ctx) });     // { from, options, merge?, validFor? } | null
    strudelCraft.intellisense.registerSignature({ id, signature(ctx) }); // { fn, params: [{ name, shape, min, max, unit, ... }] } | null
`ctx` = `{ text` (doc up to the caret)`, doc, pos, explicit, arg }` with `arg` = `intellisense.argContext(...)`. A source without `merge`
owns that position (its options replace the shape suggestions); with `merge: true` its options are added. A signature provider answers for
callees the typed-param table does not know, in the same tooltip. The `atoms` provider (`atoms-site.js`) uses both.

## Live coding
While playing, every edit in the Code or Stack editor is evaluated after ~300 ms. A good pattern is hot-swapped on the next
cycle boundary (`Engine.swap`: `evaluate()` on the running scheduler, audio never stops). A failing edit leaves the last good
pattern playing; the chip turns to `error`, the message shows under the editor head and the line is marked in the editor
(CodeMirror lint), clearing on the next good swap. The chip (`live` / `error` / `paused` / `off`) is also the toggle
(persisted as `sc.live`). Events: `live:ok`, `live:error` `{view,line,message}`, `live:swap` `{id,kind,code}`.

## Version history (`history.js`)
Git-like, client-side history of everything persisted under `localStorage` `sc.*` (code edits `sc.edits`, stack, stack code,
tempo, master, live toggle, theme, intellisense user list). Content-addressed in IndexedDB `sc-history` (`blobs` keyed by
SHA-256 of the value, `commits`, `meta`); falls back to `localStorage` `schist.*`. Diffs use jsdiff (`diff@5.2.0`, esm.sh, on demand).
- Auto-commit: any `sc.*` write is debounced (1.2 s) into a commit; every successful live swap commits too. Named snapshots via the dialog.
- UI: history button in the header (key `H`): Undo / Redo across the whole state, Snapshot, a timeline scrubber (prev/next) with
  "Restore this state" and a preview diff to now, a diff between any two states, and search (text or `/regex/flags`) listing every
  matching state with time, key:line and context, with Show / Restore.
- API `window.strudelCraft.history`:
  `commit(label?, {auto,force}) -> commit`, `log() -> [{id,parent,time,label,changed,auto,named,head}]` (newest first),
  `get(id) -> {key: value}`, `diff(a, b|null=now) -> [{key,status,hunks:[{op:'+'|'-'|'=',text}]}]`, `checkout(id)`,
  `undo()`, `redo()`, `search(q, {regex, flags}) -> [{id,time,label,hits:[{key,line,context}]}]`,
  `subscribe(fn) -> unsubscribe` (events `{type:'commit',commit}` / `{type:'checkout',id}`), `snapshot()`, `flush()`, `head()`.
- `window.strudelCraft.history.docs` (keyed, revisioned documents, async, rejects with a coded `E_DOC_*` error, shows no UI): own IndexedDB
  object store `docs` of `sc-history` (database version 2; the upgrade only creates the missing store and never touches `blobs`, `commits`,
  `meta`). Not part of the timeline, undo/redo or search. `put(ns, id, doc, {rev}?) -> {rev, hash}` (appends an immutable, content-hashed
  revision; an identical put returns the latest rev; `rev` makes it idempotent and immutable: `E_DOC_IMMUTABLE`, `E_DOC_REV`),
  `get(ns, id, rev?) -> {id, rev, hash, time, doc}`, `list(ns) -> [{id, rev, hash, time}]`, `revs(ns, id) -> [{rev, hash, time}]` (oldest first),
  `delete(ns, id)`, `subscribe(ns, fn) -> unsubscribe` (events `{type:'put'|'delete', ns, id, rev?, hash?}`). Without IndexedDB it uses `localStorage` `schist.docs.*`.
  If an old tab still holds version 1 open, the upgrade waits and a toast asks to close the other tabs; a tab that gets a newer version asks for a reload.
- The component library (`library.js`) stores its records in `docs` namespace `library` through `library-store.js` (`docsStore`: synchronous
  reads from a memory copy hydrated from docs, writes go through; warm cache in `localStorage` `schist.library`; a legacy `sc.library` copy is migrated once).
  Node tests and browsers without IndexedDB use the in-memory + `localStorage` `fallbackStore`. Library saves add no timeline entries.
- Tests: `node tests/site/history_upgrade.mjs` (v1 database upgrade, second-tab blocking, docs API, library persistence).
- `window.strudelCraft.app.reload()` re-applies persisted state to the UI after a checkout.

## One transport, one clock
There is one global Play / Stop / status (bottom transport) shared by Rack and Stack. The program that plays is the visible
tab's: switching Rack <-> Stack while playing hot-swaps to that tab's program on the next cycle boundary (same path as live
coding, `swapTo()` -> `Engine.swap`), with no stop or restart. **Follow tab** (transport, default on, persisted `sc.follow`):
when off, the transport stays locked to the tab it started on; a badge next to it shows the source tab (amber when locked).
Edits in a tab that is not the source are syntax-checked only (message under that editor and line marker) and swap in when the
tab becomes the source. Every swap (edit, tab switch, knob/stack update) is committed to history (`live swap: <id> (<why>)`).

## Build badge and updates
`.github/workflows/pages.yml` stamps every deploy: `sw.js` `VERSION` becomes `sc-<short sha>` (new cache on every deploy) and
`build.json` gets `{sha, date}`; the transport shows it as a small badge (`dev` locally). A new service worker waits instead
of taking over. While the app is idle (nothing playing, no editor focused) the page posts `SKIP_WAITING` at once and reloads on
`controllerchange`, so an installed app never keeps an old shell next to new files; while playing or typing it shows the sticky toast
"New version, tap to reload" instead. The app also checks for updates whenever the tab becomes visible again. Old shell caches are deleted
on activate (the install precache is one atomic `addAll` per `VERSION`, fetched with `cache: 'reload'`).
- Service worker request rules: Range requests (audio elements, partial reads) and anything it cannot serve go straight to the network;
  only complete readable 200 responses are cached (never 206 or opaque), cache writes never delay or fail a response, and any failure
  inside the handler (storage quota, eviction, a bad entry) falls back to a plain network fetch.
- `pages.yml` regenerates the shim pack pins (`python3 tools/packs/shim.py`, then `--check`) at every deploy, so the pinned hashes in
  `craftpack.json` / `packs.lock.json` always match the deployed `data/` files.
- History states also hold `ui:rack-editor` and `ui:stack-editor` (the full CodeMirror docs, not the virtualised DOM) and
  `ui:panel` (visible title, inspector, status and error text). Any editor content change from any source (typing, preset load,
  paste, tab switch, swap, restore) is detected and committed; search scans these too and reports the field (e.g. `Rack editor:4`).
  `ui:*` keys are searchable/diffable but are not written back on checkout.

## Ghost text and Tab (`inline.js`)
Tab accepts the selected popup item; with no popup it accepts the dimmed ghost-text continuation at the cursor (also via the
visible `Tab` chip, tap on phones); Esc dismisses; Ctrl/Alt+`]` / `[` cycle alternatives; with nothing suggested Tab indents.
Inline providers (local, no network): `snippets` (default arguments and the chain that usually follows, e.g. `.lpf(` -> `800)`,
`.decay(..)` -> `.sustain(0)`), `ngram` (trigram next-token model trained on catalog recipes and the user's history editor
states), `closers` (open brackets/quotes). Register more:
    strudelCraft.intellisense.registerInline({ id, priority, suggest: async ({ before, after, line, doc, pos }) => ['...'] })
`strudelCraft.intellisense.remoteInlineStub` shows the shape for a future remote/LLM provider; none is wired.

## Preludes and vocal banks (`prelude/word.js`, `data/vox/`, #43-#46)
`app.js` loads `prelude/word.js` (#43) into the Strudel eval context right after `initStrudel`, so `word()`, `syl()`, `vowel()` and
`voxBank()` work in both editors; they are intellisense items (category `vocals`). Add more preludes to `PRELUDES` in `app.js`.
- `word("<call me baby>")` -> `s("vox_call vox_me vox_baby")` (mini-notation kept, `"baby:2"` = third take through `n`);
  `syl("0 1 2")` plays syllables in lyric order; `vowel()` is Strudel's fixed formant filter, not a formant shifter.
- Banks live in `data/vox/<bank>/` (`ogg/`, `pitched/strudel.json` with the sung base note, `words.json`, a `README.md` with the
  licence): `demo` (espeak-ng speech, auto-loaded on the first `word()`), `call-me-baby` (the owner's vocal bank), `ljspeech`
  (~500 words from LJSpeech, public domain, 1-3 takes, clips fetched lazily per word) and `vocalset` (sustained sung vowels from
  VocalSet, CC BY 4.0, keys `vs_<vowel>_<technique>`) and `sung` (200 English words sung at d#3 a3 d#4 a4 d#5, an offline
  SoulX-Singer render, Apache-2.0, with a VocalSet timbre prompt; model pinned by commit and weight sha256, see engine/vocals/SUNG.md; every bank has a `hashes.json` checked by `tests/site/vox.mjs`; `word()` works and `note()` plays the nearest sung pitch).
  `voxBank('ljspeech')` switches bank (keys it lacks fall back to demo),
  `voxBank(url)` loads a `strudel.json` (or a folder URL ending in `/`), `voxBank()` opens a folder picker (files stay in the
  browser), `voxBank.list()` -> `[{name, url, words, clips, notes, kind, prefix, licence, attribution, active}]` (counts from the loaded map or the bank index),
  `voxBank.words(name)` -> `Promise<[{name, key, takes, notes, dur}]>`, `voxBank.active()`; every switch fires a `vox:bank` window event. Failures toast, they do not throw.
- `.note()` on a pitched map retunes by speed, so formants move with the pitch. Formant-preserving takes are pre-rendered by the
  build-time CLI (`engine/vocals/wordbank.sh ... --formant-steps -5,7 [--formant-backend pyworld|rubberband]`, #45 - keys
  `vox_<word>_f<semi>`, gate them with `python3 engine/vocals/formant.py --selftest --backend all`): pyworld (in-process WORLD
  vocoder) passes that selftest, the external `rubberband --formant` binary is approximate and fails 3 of its 4 vowels, which the
  tool reports rather than hides. Lyric words missing from the stem can be filled with opt-in TTS clips (`--tts-fallback`, Shabda speech,
  network, per-clip `source`/`licence` in `words.json`, #46). Neither is baked into the banks that ship here. `word(...).note(x).formant(true)` (#57, prelude `word.js`) picks the variant
  `vox_<word>_f<semi>` nearest to the shift (note minus the word's sung base note) and applies the residual (<= 50 cents) with `speed`;
  on a bank without variants it plays the plain `note()` retune and warns once (toast). Check: `node tests/vocals/formant_helper.mjs` (synthetic bank, needs `STRUDEL_MODULES`).
- Completions for word names inside `word("` follow the active bank (`vox-banks.js`, #85, see the Banks browser below). The static
  `data/intellisense/words.json` (the `demo` and `call-me-baby` banks) still feeds word names in other strings. Regenerate it with
  `python3 engine/vocals/complete.py "" --samples-dir site/data/vox/call-me-baby --samples-dir site/data/vox/demo --kind word`
  (add a `--samples-dir` per bank you want completed; merge duplicate names, keep the highest take count).

## Resources pane (`resources.js`, `resources-ui.js`, `resources.css`, `engine/resources.js`; docs/RESOURCES.md)
What the program uses and what is installed, in one panel (sheet on phones, workspace pane on desktop). Entry points: the **Resources** button in the Rack / Stack editor heads, `Ctrl+K > Show resources`, `Show Resources pane`, the workspace pane `resources`, deep link `#res=<kind>:<name>` / `#res=available:<query>`. **In this program**: every reference resolved live (atoms and `atoms.import`, racks and `hooks.bind`, slots, taps, buses, lanes, controls, vox banks and words, packs with version and licence, `lib:` refs), with source pack, description, params with ranges, lines, status chips (resolved, shadowed #143, older id #120, missing + fix and Insert, unused, unread #114, code needs allow) and a missing banner; a plain press only expands a row, Go to line is its own target button (#107). **Available**: packs -> kinds -> items with the folder / tag organizer (#120), search, example in Craft and lowered form (#117), Play (#150), **Insert reference** (one change at one place, nothing else moves) and Copy. The model is `engine/resources.js` `buildModel()`, also behind the CLI twin `strudel refs IN [--json]`. Search: index fields by default, "Search descriptions too" (CLI `--deep`) adds recipe body text. Indexed recipes (#131) load their family body file on first expand (one fetch per family, Retry on failure, then Craft/lowered, Play, Insert). Lazy: loaded on first open, precached, outside the eager shell budget.

## Score cues: CraftCues (`cues.js`, `cues-ui.js`, `cues.css`, `engine/cues.js`, `engine/cues-kb.js`; docs/CRAFTCUES.md, #162-#164)
Terse timed annotations in bars: `//@ 17-24 motif @bell: hook enters | MOT-05 | prepares:drop-c` in the code (blanked by the comment masker, never
affects the sound), shipped sidecars in `data/cues/` (`index.json` matches a recipe id or the program's first line; `node tools/craftcues/build_site.mjs`
copies `docs/tracks/*/*.craftcues`), and cues saved in this browser (localStorage `sc.cues.<program>`). `cues.js` is a tiny lazy entry (palette
commands Show score cues / Add cue at the current bar / Captions on / off, the Score button in the editor heads, `#cues`, a 600 ms watcher that loads
the UI only when a playing program has cues, the `//@` intellisense source). While playing: a captions strip above the transport (bar, chips of the
active cues, a timeline lane with spans, section ticks, playhead and relation arcs; the arcs exist only in this strip). Layer cues set
`[data-cue-hot]` on the Graph view's track nodes and Lanes cards only while the Graph shows the playing program; `@tag:x` resolves to the lanes
carrying that tag. Inline edits use the comment ranges (block-comment cues included) or are refused with a toast. A chip press opens the KB card in the site modal (nothing in the editor moves; Go to code is a separate button). Score sheet: by section,
kind / layer / concept filters, edit (inline cues are rewritten in place), add at bar, import and export `.craftcues` / `.vtt` / JSON. Quick play shows
the strip for examples with `//@` cues (`qp:play` event); the Resources sheet gets a Cues section; Record takes store `cues` and the WAV download
writes a `.vtt`. Tests: `node tests/cues/cues.mjs`, `node tests/cues/vtt_browser.mjs`, `node tests/site/cues.mjs [shot.png]` (390 px touch).

## Banks browser (`vox-banks.js`, `voxbrowser.js`, `voxbrowser.css`, #85)
"What is in a bank, so I know what I can type": the **Banks** button in the Syntax view head, Ctrl+K > *Browse vox banks*, or the
workspace pane **Banks** (Ctrl+K > *Show Banks*).
- Lists every bank: the shipped five, banks loaded with `voxBank(url)` or a folder (from the prelude's table, no fetch) and `vox-bank`
  pack ingredients. Each card: kind (word bank `word("baby:1")` / sound bank `s("vs_a")`), word (or key) and clip counts, pitches (the
  sung notes, or the range of a natural-pitch bank), licence, the active marker and a **Use** button. The top line shows the active
  bank as the code that selects it, e.g. `voxBank('sung')`.
- Opening a bank: search (prefix first), pitch filter, technique filter (vocalset), one row per word or key with takes, pitches and
  durations. Tap a pitch / take chip or the round play button to hear that clip with no code (level ring on the button; routed
  through the master bus once Strudel is loaded). Tap the snippet (`word("baby").note("a3")`, `word("baby:1").note("a#4")`,
  `s("vs_a_forte").note("c4")`) to insert `$: snippet` on a new line in the Rack code, plus `await voxBank('<bank>')` when the code
  lacks it. **Use** switches the active bank (loads the engine first) and toasts the `voxBank` line.
- Data: pack `glyphcore/vox` (`data/vox/craftpack.json`, pinned in `packs.lock.json`, regenerated by
  `python3 tools/vox/bank_index.py`, `--check` in pages.yml) lists `data/vox/banks.json` (summary per bank: kind, prefix, counts,
  notes, range, licence, attribution) and each bank's `words.json` and `pitched/strudel.json` as `manual` ingredients of the data-only
  extension kind `x-glyphcore.vox-data@1`. They are read with `packs.raw()` only when the panel or a bank opens (or a `word("`
  completion needs the active bank); clip audio is fetched only when auditioned. `packs.entryOf(ref)` gives an ingredient's URL to
  resolve clip paths. Offline: the index pack's `craftpack.json` and `banks.json` and the demo bank are in the shell precache, so the
  list and demo completions work offline; the other banks' files stay lazy (network on first open).
- Hover (desktop) on `word` / `voxBank` / `syl` adds the active bank and its size to the docs tooltip; long-press (touch) shows the
  same line.
- API `strudelCraft.voxBanks = { list, info, active, open, words, use, snippet, line, audition, stop, lastPeak, describeActive, openPanel, on }`.
- Test: `node tests/site/voxbrowser.mjs [shot.png]` (360px: all banks with counts, no bank file before the panel opens, search
  "baby" in sung, audible audition, insert, completions change after switching bank, richer `voxBank.list()` / `voxBank.words()`).

## Folders, tags and appearance (`organizer.js`, `engine/taxonomy.js`, `taxonomy-store.js`, `taxonomy.css`, `organizer.css`, #120; docs/PACKAGES.md)
Every recipe, atom, rack, feel and groove can carry a `folder` (slash path) and `tags`; packs may declare a `taxonomy` (docs/PACK_SPEC.md 5.3). One organizer component is mounted by Recipes, Syntax and Banks:
a collapsible folder tree with counts and breadcrumbs, tag chips (Match all / Match any), sort, search over names, tags and folder paths, and a pack badge on each row. Rows and chips get a colour and an icon
from the tag style map (strongest tag by `taxonomy.priority`, then the category default, then neutral); light and dark are AA (`taxonomy.css` is generated by `tools/packs/gen_taxonomy_css.py`).
- Deep links: `#folder=hiphop/trap&tag=drums,kick&mode=or`. The state persists in `localStorage sc.org.<view>`.
- Yours: Inspector > Folder and tags (site modal) files a recipe in your folder and adds your tags; Folders and tags > New folder, Appearance (colour from the fixed palette, icon, pattern), Export, Import (one `taxonomy@1` JSON, kept in `sc.taxonomy`). Notices are toasts, input is the site modal (`ui.form`); a press never focuses or scrolls the editor (#107).
- Not built yet (#135): the tree, chips and edit modal for Library components, Perform takes and the Atoms browser; the store accepts their keys already.
- Layout (#179): the organizer host (`.org-host`) is one bounded scroller (max-height `min(40vh, 400px)`; the crumbs of selected tags scroll in at most two rows, the "Folders and tags" summary stays pinned as a 44px toggle with the active-tag count and `aria-expanded`), so any number of open folders or selected tags cannot push the Recipes list or the Syntax entries out of their container. The open state is remembered per browser (`sc.org.<kind>.ph`; first visit: closed, open only for Recipes on a >= 1100x1000 desktop; a deep link opens it on a first visit only). The Recipes list keeps >= 45vh (the browser column scrolls when filters and list together exceed it). The Syntax jump strip is one scrolling row at every width (it wrapped to 507 px at >= 900 wide) and the sticky search bar turns static on short windows (max-height 560).
- API: `strudelCraft.taxonomyStore` (`move`, `tag`, `addFolder`, `setStyle`, `exportJSON`, `importJSON`, `clear`), `strudelCraft.organizer.recipes`, pure rules in `engine/taxonomy.js` (shared with the CLI).
- Data: `node tools/packs/taxonomy_fill.mjs` fills the hand-written pack files and the manifest taxonomy; derivation rules in `tools/concepts/taxonomy.mjs`. Test: `node tests/site/taxonomy.mjs` (screens `docs/screens/phone-390-folders-*.png`).

## Visual feedback (`visuals.js`)
As on strudel.cc/learn/visual-feedback, using Strudel's own draw code in `@strudel/web` 1.3.0 (unmodified):
- active events in the mini-notation are outlined in the editor while playing (tinted by `.color()`);
- global `.pianoroll() .punchcard() .spiral() .scope() .tscope() .fscope() .wordfall() .pitchwheel()` draw on a full-page
  `#test-canvas` layer (no pointer events); onPaint painters are driven by our frame loop;
- inline `_pianoroll` `_punchcard` `_spiral` `_scope` `_tscope` `_fscope` `_wordfall` `_pitchwheel` render as CodeMirror block
  widgets (`Decoration.widget({ block: true, side: 1 })`) at the end of the line holding the call, as on strudel.cc: part of the
  scroll flow (lines below move down, the widget scrolls with the code), as wide as the editor content (a `ResizeObserver` keeps the
  canvas backing store equal to its CSS box), 140 px high by default or `{ height: N }` (60..600). The height is reserved as soon as
  the code compiles (a still frame before Play), so Play does not shift lines; the canvas only resizes when the editor resizes, then
  `view.requestMeasure()`. Haps are tagged with the widget id as strudel.cc does (pianoroll/punchcard draw only tagged haps). Taps on a
  widget never move the caret; widgets are not part of the document text (copy, AST ids, ghost text). A failing edit keeps the last
  good widgets in place. Check: `node tests/site/inline_widgets.mjs` (360 and 1440 px, Rack and Stack).
Each visual is a control type `visual.<name>` / `visual._<name>` in `strudelCraft.controls` and an intellisense item (`visuals`).
`engine/index.js` (controls, pads, input) is now loaded by `index.html`.

## Live progress tracker (`tracker.js`)
The `?` dialog shows the checklist of issue #56 (public GitHub API, unauthenticated): `##` headings are groups, `[x]` done,
`(~)` in progress (pulsing dot), progress bars per group and overall, "updated Xs ago", and a flash on items whose state changed
since the last poll; open issues labelled `status:*` are listed below. Polls every 60 s while the dialog is open, 5 min while
closed, with `If-None-Match` (ETag) so 304s don't count against the rate limit. On failure or rate limit it shows the cached copy
(`localStorage` `sctrack.cache`) with a toast. Toasts now use the Popover API so they show above open dialogs.

## Hooks runtime (`engine/hooks.js`)
Standalone ES module, no imports: `const { hooks, tap } = install({ Pattern, stack, silence, reify, signal, Fraction })` from the
page's Strudel globals (after `strudel:ready`); it adds `Pattern.prototype.use / wrap / ns / tap / wire` and the `hooks` object, and
refuses to install over an existing method (`E_NAME_COLLISION`). Slots (`.use("fx")`) resolve at query time against time-gated
bindings (`hooks.bind("fx", [["gain", 0.5]], "@3b")`: bars are 1-based with `b`, bare numbers are cycles); taps, variables
(`hooks.let`), module params and decorators (`every(4)[h]`) are in the same file. Set `hooks.live = true` on the site (queries then
never throw) and `hooks.position` to the scheduler cycle; headless hosts keep `live = false`. Strudel turns every double-quoted
literal into mini-notation, so write gate and hook strings with single quotes or run program text through `protect(code)` first (the CLI
does; `hooks.bind("fx", "x", "@3b")` is rewritten to single quotes). Design: `docs/HOOKS_SYNTAX.md`; tests: `node tests/hooks/p1.mjs`,
`p2.mjs`. The CLI (`engine/strudel-cli` in suno-track-lab) imports this file from `$STRUDEL_CRAFT/site/engine/hooks.js`.

## Rack standard and hygiene racks (`engine/hygiene.js`, `tools/racks/`, #94; docs/RACK_STANDARD.md)
- A rack is a clean signal for one instrument class: source, band scope (high-pass and low-pass for the class), tone and shape, drive, dynamics, sends, gain with headroom.
- `engine/hygiene.js` holds the band scope per class as chain-only hook defs: `hygiene-kick`, `-sub`, `-bass`, `-snare`, `-hat`, `-perc`, `-bell`, `-pluck`, `-stab`, `-pad`, `-lead`,
  `-keys`, `-arp`, `-supersaw`, `-riser`, `-sweep`, `-reverse`, `-impact`, `-texture`, `-vox`. They are standard-library defs of the hooks runtime (site and CLI, no pack needed), a
  program's own `hooks.def("hygiene-pad", ...)` replaces one, and `hooks.toJSON()` never holds them.
- `.hook(expr)` (new Pattern method, `engine/hooks.js`): a hook expression applied in place, always on: `.s("sawtooth").hook("hygiene-pluck")`; a pipe works. A rack starts with
  `["hook", "hygiene-<class>"]`; what it sets afterwards wins. `protect()` keeps its string out of mini-notation; the model and the graph treat it as a reference step, not a param.
- Catalog recipes keep a plain Strudel form (`lowered`, it opens on strudel.cc) next to the Craft `code`, so the plain form carries the same scope as literal `.hpf().lpf()`.
- Audit: `node tools/racks/audit.mjs [--only racks,catalog,syntax] [--item NAME] [--baseline OLD/report.json]` renders a test phrase per class through every rack with the strudel CLI and
  checks band leak, DC, sub-20 Hz, above 18 kHz, aliasing on a high note, peak, crest, clipping, correlation and side energy below 120 Hz against `tools/racks/standard.json`
  (classes of the audited items: `tools/racks/targets.json`); writes `tools/racks/out/report.json` and `report.md`. Syntax section **Rack standard** has runnable racks per class.
  Tests: `STRUDEL_MODULES=... node tests/hooks/p9_hook.mjs`, `node tools/racks/audit.mjs --only racks` (in `tests/smoke.sh`).

## Groove, genre kits and feel templates (`engine/groove.js`, `tools/concepts/`, #109-#112; docs/CONVENTIONS.md)
- `.groove(swing, push, jitter, vel, drift, seed, grid)` (or an object) is built into the hooks runtime: MPC swing 50-75, push / jitter / drift in % of a 16th, velocity spread,
  seeded and query-independent (a chunked offline Record equals live play). Presets are standard-library hook defs: `groove-straight`, `-pocket`, `-lazy`, `-bounce`, `-rolling`,
  `-cloud` (param seed), `groove-swing(pct)`, `groove-push(pct)`, `groove-human(jitter, vel, seed)`; compose with a pipe: `hooks.bind("snare", "clap | groove-pocket(2) | groove-push(4)")`.
- Pack `glyphcore/phonk` 1.3.0 adds `racks-hiphop` (bbKick, knock808, clap, snap, openHat, bbBass, rhodes, trapBell, airPad, hyphyLead, chopStab, voxTag, vinyl, downlifter; moves fadeOut,
  fadeIn, throw, tailHold, duckUnder), `atoms-hiphop` (`hh.` patterns and form gates), `atoms-dovetail` (`dt.` pickups, rises, hits, tails, masks, fade tables) and five feel
  templates `feel-boombap`, `feel-lazy`, `feel-trap`, `feel-hyphy`, `feel-cloud`: `atoms.import("pack:glyphcore/phonk:feel-trap", { as: "feel" })` picks one (Syntax section **Feels**).
- Catalog recipes with `origin: "concepts"` (labels hip-hop, boom-bap, trap, hyphy, cloud, dovetail, transition, swing) are plain Strudel lowered from the same data.
  Source: `tools/concepts/families/*.json`; regenerate with `node tools/concepts/build.mjs --render` (`--check` exits 1 when stale), then `packs.py hash site/data/phonk --write`,
  `shim.py`, `tools/pwa/precache.mjs`. Test: `node tests/hooks/p10_groove.mjs`.
- Pack **`glyphcore/edm`** 1.0.0 (`data/edm/`, CC0-1.0, synthesis only; #127 #128 #129; docs/EDM_REFERENCES.md): `racks-edm-core` (edmKick, subSine, edmClap, snareTight, hats, crash,
  risers `noiseRiser(len)` / `hpBuild(len)` / `pitchRiser(len)`, `reverseSwell(len)`, downSweep, impactBoom, subDrop, superChord, edmPluck, edmPad; moves `sidechain(orbit, depth, release)`
  (duckorbit; gain 1 - sqrt(depth)), `ducked(orbit)`, `lfoPump(depth)` (beat-synced ramp tremolo), `ott(gain)`, `drive(amt)`, `wobble(sync, depth)` (synced low-pass LFO), filterBuild, thinBuild),
  `atoms-edm-core` (`ec.` roll / filter / gap atoms, riser gates `rise4 / rise8 / rise16 / hit`, the 104-bar form as gates and as masks `mIntro` .. `mOutro`), `racks-dubstep`
  (dsKick, dsSnare, reeseBass, growlBass, wobbleBass(sync), talkBass, riddimBass, screechLead, laserZap, ukfChord, ukfPluck, ukfArp, ukfLead, atmosPad, vowelChop), `atoms-dubstep` (`ds.`) and
  feels `feel-halftime`, `feel-ukf`, `feel-riddim`, `feel-brostep`. Syntax sections **EDM foundations** and **Dubstep**; catalog labels edm, dubstep, melodic-dubstep, riddim, brostep,
  reese, growl, wobble, sidechain, pumping, riser, build-drop. The tutorial track (Recipes: "Dubstep tutorial track", Craft and Strudel tabs) is
  `docs/tracks/edm-dubstep-tutorial/`. New rack classes reese, growl, screech (docs/RACK_STANDARD.md). Other EDM packs (glyphcore/dnb-electro) build on edm-core.
- A family recipe may be a whole program (`"program": "docs/tracks/.../track.strudel.js"`, `"standalone": "..."`): the builder lowers it to plain Strudel (the Strudel tab) and writes
  the standalone copy, so the paste-ready file is generated, never hand-kept.
- Pack `glyphcore/dnb-electro` 1.0.0 (`data/dnb-electro/`, CC0-1.0, pinned by `shim.py`; #121-#124, docs/CONVENTIONS.md 9-11, sources docs/DNB_ELECTRO_REFERENCES.md):
  `racks-dnb-electro` (hooks@1: dnbKick, dnbSnare, ghostSnare, breakKick, breakSnare, ride, dnbShaker, dnbHat, dnbSub, reese, neuroBass, rollingBass, jumpWobble,
  liquidRhodes, liquidPad, strings, vocalChop; boom808, clap808, hat808, open808, cowbell808, electroBass, vocoLead, robotStab, filterBass, sawStab; houseKick, bigKick,
  houseClap, offHat, closedHat, houseBass, rumble, pluck, bigChords, gatePad, roomLead), `atoms-dnb` (`dnb.` two-step,
  ghosts, amen / think-style breaks, chop orders, sub / reese / neuro / rolling / wobble lines, liquid chords, 128-bar form gates), `atoms-electro` (`el.`), `atoms-house` (`hs.`,
  with a 160-bar club map), seven feel templates (`feel-liquid`, `-neuro`, `-jumpup`, `-electrohouse`, `-techno`, `-trance`, `-bigroom`; grooves composed from the standard presets, e.g. liquid = `groove-swing(54) | groove-human(2.5, 0.15, seed)`) and `presets` (recipes@1: the three
  track demos). It uses the EDM foundations of `glyphcore/edm` (sidechain / ducked, risers, impacts, roll and filter-build atoms) and never redefines them. Syntax sections
  **DnB, electro, house / techno / trance** and **Track demos: DnB, electro, house / techno / trance**; catalog recipes (labels dnb, liquid, neuro, jump-up, breakbeat,
  electro, house, techno, trance, big-room) carry both forms. Breaks are synthesised (no sampled break ships); chop any break with `.bite(16, atoms.dnb.chops)`.
  Track sources: docs/tracks/dnb-electro-tutorial (pack versions; `node tools/packs/dnb_electro.mjs` writes the standalone programs and `presets.json`).
- Pack **`glyphcore/industrial`** 1.0.0 (`data/industrial/`, CC0-1.0, synthesis only, native voices; #155; docs/CONVENTIONS.md 12, docs/INDUSTRIAL_REFERENCES.md): `racks-industrial`
  (mechanical hits breakerClang, metalImpact, anvil, pipeHit, relayClick, ratchet, chainRattle, metalShatter, hydraulicHiss, servoWhine, servoDown, doorSlam, stampPress, slamImpact,
  rustBed, factoryAmb; kit stampKick, clangSnare, metalClap, openChain; basses indSub, indRiddim, metalGrowl, clankBass, pressBass; `hissRiser(len)`), `atoms-industrial` (`ind.`
  drums, hit grammars hits1 / hits2 / hits4 / hits7 / hitsGap, bass lines, the 64-bar form as gates and masks) and feels `feel-indriddim`, `feel-indhalftime`, `feel-mechtechno`,
  `feel-noiseind`. Syntax section **Industrial**; catalog label industrial.
- Pack **`glyphcore/rockmetal`** 1.0.0 (`data/rockmetal/`, CC0-1.0, synthesis only; #157; docs/CONVENTIONS.md 13, docs/ROCKMETAL_REFERENCES.md): `racks-rockmetal` (guitar tiers
  gtrClean, gtrCrunch, palmMute (native), gtrHigh, chugHigh (one distort stage), gtrLead, gtrHarmonic, feedbackSwell; bassFinger, bassPick; rockKick, metalKick, rockSnare, rockHat,
  rockRide, crashCym, rockTom; organ, rockStrings, vowelVox), `atoms-rockmetal` (`rm.` drum patterns incl. double kick, blast, thrash, doom; power chords, riff cells and the A A A B
  grammar, chug, gallop, breakdown; the 72-bar song form as gates) and feels `feel-rock`, `feel-shuffle`, `feel-rockhalftime`, `feel-thrash`, `feel-doom`. New rack class `guitar`.
  Syntax section **Rock and metal**; catalog labels rock, metal, guitar.
- glyphcore/edm **depth layer** (#156; docs/CONVENTIONS.md 14): `racks-edm-depth` (serialFM, fmFormant, formantChop, tapeStop; moves stutterGate, mbLow, mbMid, mbHigh, tapeStopMove) and
  `atoms-edm-depth` (`ed.` 16 / 32-bar maps, phrase ends, chop notes / vowels / steps). Syntax section **EDM depth** (32-bar map, multiband on a bus with `.split`, resampling with `capture`).

## Mixer read model (`engine/mixer-model.js`, #95; docs/REFACTOR_PLAN.md phase R1)
`channels(graph)` turns the lane graph (`engine/lanes.js` `compile(src).graph`) into channel strips: one per lane (`kind: "lane"`), one per `ret(name)` lane (`kind: "return"`, with its
`bus` and the `inputs` that send to it), `master`, tag groups with members and group sends, the gated mutes and solos each strip is under, and `dangling` sends (a bus nobody returns).
Pure and derived: nothing is stored, strip edits stay text edits, bus numbers never appear. No UI reads it yet (mixer view: coming, #96). Test: `node tests/lanes/mixer_model.mjs`.

## Lanes: event layer (`engine/lanes.js`, #74; design docs/LANES.md)
Standalone ES module, no DOM, shared with the CLI. `install(S, hooks, { outer })` (called by `engine/index.js` after the hooks runtime; headless hosts call it with
the Strudel `Pattern` and the hooks object) adds `Pattern.prototype.tags` and the globals `tagged` and `lanes`, refusing over an existing name (`E_NAME_COLLISION`).
- Taps (in `hooks.js`): every tap has a 32-span query cache keyed by span and controls signature; cleared on registry change, a republished tap and `hooks.invalidate()`
  (the controls engine calls it from `set`, lane and `load` through its `onChange`). In a labelled lane `.tap("x")` is `lane/x`; `.tap("x", { export: true })` lets other lanes read it;
- Pad reader (#118): a bare `tap("x")` with no `.tap("x")` publisher reads the Perform pad `x` (`pad:tap` / `pad:tap-end` journal entries, value 1 while held, nothing idle; `hooks.padRefs` set by perform.js); `.tap("x")` is only the writer. A live press is played at once (#119): the journal keeps the real press cycle and `sc.bg.catchUp()` (bgplay.js) queries `[press, scheduled horizon)`, triggering the haps the reader marked `context.padTap` (trigger form: press to first sound p50 62 ms, was 0.3 s). Perform on phones is pad-first (stage folds to a strip, grid above the transport at 390x844 and 360x740) and preset apply no longer toasts. Tests `tests/hooks/pad_reader.mjs`, `tests/site/perform_reader_audio.mjs`, `tests/site/perform_reader_latency.mjs`, `tests/site/perform_layout.mjs`; docs/PERFORM_PRESETS.md sections 3 and 5.
  an unexported cross-lane read is `W_LANE_IMPLICIT_EXPORT` (open mode) or `E_LANE_PRIVATE` after `lanes.closed()`.
- `.tags("a", "b")` = `.tag("a").tag("b")`. `tagged("drums & !wet")` selects haps by tag, `#lane`, `& | ! ( ) *`; ops `.fx(f) .gain(g) .orbit(n) .mute(gate) .solo(gate)`, applied in the
  outermost query wrapper before the control maps; selections serialise in `hooks.toJSON()` (`selections[]`) and live toggles (`lanes.set(id, op, on, at)`) journal as `sel` entries.
- Text side: `scan(src)`, `compile(src)` -> `{ code, map, graph }` and `check(src, { strict })` (`E_LANE_DUP`, `W_LANE_ORBIT_FX`, `W_LANE_IMPLICIT_EXPORT`, `E_LANE_PRIVATE`); the
  lane graph is what `strudel lanes IN` will print (that command and `check --strict` wiring live in the CLI repo and are not done yet).
- Not built yet (shown as "coming" in the Syntax view): the CLI side of the audio layer (`strudel lanes`, `render`, `events`, `stems`) and of capture. The UI is built (#78, Graph > Lanes in the graph).
- **Consumers (L4, #77)** - data and engine; the lane UI (#78, Graph > Lanes in the graph) reads these entry points:
  - `model.js` `parse` / `generate` / `applyOp` / `graph` / `checkWire`. Model additions (all derived from the code, so a no-edit round trip is byte-identical and models without lanes are unchanged):
    `tracks[].tags`, `tracks[].split` (`{ site, at, branches: [{ id, param, chain | null, src }], merge, mix, pre }`), `tracks[].sends` (`[{ bus, amount }]`), `tracks[].ret`, `buses` (`{ name: { returns } }`, names only, never bus numbers),
    `selections[]` (`{ id, selector, ops, gate? }`, the shape `hooks.toJSON()` uses), `captures` (`{ name: { picker, window | last, what, live, max } }`), `settings.lanes` (`open` | `closed`). Header statements `tagged(...)...`, `capture(...)`, `lanes.closed()` are kept verbatim like the hooks registry.
  - `graph(model)` for a document with lanes: track nodes gain `tags` and `ports.out = [{ name: "audio", type: "audio" }]`; `split:<lane>` (fed by ONE `audio` wire), `branch:<lane>#i` and `branch:<lane>#i.k` sub-chain steps, `join:<lane>`;
    `bus:<name>` (`sends`, `returns`, `audio` wires in and out); `selection:<id>` chips (`selector`, `ops`, `matches` - never one wire per match); `capture:<name>` nodes (`ports.out` = `ev` / `audio` / `level` as recorded, wires to the lanes that `recall(...)` or `.from(...)` them);
    tap nodes carry `export` / `local` + `lane` + `branch`. A read of a branch-local tap from another lane is not drawn: `graph().refused[]` holds `{ code: "E_LANE_CROSS", message, from, to, fixes: [{ label: "Export tap" | "Add send", op }] }`; `checkWire(model, fromNode, toNode)` answers the same for a wire the UI proposes.
  - `applyOp` additions: `addBranch { track, fn, index? }` (splices one argument into `.split(...)`), `exportTap { track, tap }` (an exported `.tap(name, { export: true })` just before `.split`), `addSend { track, bus, amount? }` (`.send(bus)` at the end of the chain); each changes one statement.
  - `engine/lanes-pick.js`: the one source of `pickerKind` / `defaultWhat` / `LAYERS` (selector and lane: events, audio, level; tap ref: events; `master` and `bus:<name>`: audio and level). The capture runtime, `lanes-data.js`, the model capture node ports, `checkWire` and the `recall("name:` completions all read it; `recall("g:ev")` on an audio-only capture is `E_CAPTURE_LAYER` in `graph().refused` and in `checkWire(model, from, to, facet)` as well as at runtime.
  - `engine/lanes-data.js`: `laneSites(code, prev)` (stable site ids: `p...` split / branch / send, `g...` selection, `q...` capture = name-keyed, reconciled with the control-binding rules), `selectionRuntimeId`, `padSelection(code, target, prev)` (pad kind `selection`, `{ ref: <site id>, op: "mute" | "solo" }`, resolved to the runtime id for `lanes.set`),
    `matchLanes(selector, lanes)`, `filterByTags(items, selector)` (the selector grammar shared with `strudel atoms list --tag` and the atom browser filter), `facetsOf(what)`, `defaultWhat(picker)`. Model split/selection ids are first-sight path hashes; `laneSites` is the reconciled authority for bindings and pads.
  - `lanes-intellisense.js`: `complete(ctx, data, model)`, `enumFor`, `textModel(doc)`; `install()` registers one completion source `lanes` and a literal-editor shape provider. Inside a `.split(` / `.merge(` branch callback after `w.` only the bus-safe controls of `data/intellisense/strudel.json` `lanes.branchControls` are offered (never `s n note bus dry`);
    `tagged("` and `capture(name, "` offer tags, `#lane` ids and operators; `.send("` and `ret("` offer bus names; `recall("` capture names, `recall("name:` only the facets that capture records; `.from("` captures with audio. Typed shapes `lane busname tag selector capture branch` are in the `params` / `shapes` tables.
  - Atom types `tag selector busname capture` (single-quoted, `data/atoms/types.json`, accepted positions in `positions.json`); a `selector` atom is validated with the lanes selector grammar.
Tests: `node tests/site/lanes_data.mjs`, `STRUDEL_MODULES=... node tests/lanes/l4.mjs`.
Test: `STRUDEL_MODULES=<dir with @strudel/ core mini transpiler> node tests/lanes/l1.mjs`.

## Lanes: audio layer (`engine/lanes.js`, #75; design docs/LANES.md 5, "Built in L2", section 11c)
Same module. `compile(src, { host })` is a text-to-text pass (before atoms-free protect() and Strudel's transpiler); `prepare(src, { host })` is what the site runs before every evaluation
(`engine/index.js` hooks it into `hooksLib.protect`; `lanes.prepare` on the installed instance also remembers the bus allocation and resets the runtime diagnostics) and throws a coded error for
`E_LANE_HOST`, `E_LANE_SOURCE`, `E_LANE_CROSS`, `E_LANE_CYCLE`, `E_BUS_RANGE`, `E_LANE_OPTS` (app.js lets those codes through to the eval error box). A program with none of the features is returned byte for byte (all 46 catalog recipes checked).
- `.split(f, g, ..., { mix: [..], pre })`: source rendered once with `.dry(0).bus(k)`, one `s("bus").n(k).attack(0.01).release(0.01).gain(1)` reader per branch (10 ms: superdough floors a bus release at 10 ms; measured seamless).
  A branch is `x => x.effect(...)` (the parameter starts the body and is used once); it may add effects, gain, pan, orbit and structure, not `s n note freq bus dry`. `.merge(m => ...)` sums the branches on a second bus; splits nest.
- `.send("name", amount)` forwards the lane's last bus to a named bus (reader `.dry(0).bus(N).busgain(amount)`); `ret("name")` is the reader of that bus and starts a lane; `.wire("lpf", "bus:name", { depthabs })` is `bmod` (cutoff = base + (signal + dc) x depthabs / 0.3; `depth` is a multiple of the current value; a slow LFO is `s("sine").freq(0.25)`, `note("c1")` is audio rate; see docs/LANES.md 5.3);
  `tagged(sel).send("name", amount)` adds the send to every lane whose literal `.tags(...)` or `#id` match. Bus numbers: split and lane buses from 64 in source order, named buses from 512 in name order.
- Checks: `E_LANE_SOURCE E_LANE_CROSS E_LANE_CYCLE E_BUS_RANGE E_LANE_HOST E_LANE_OPTS`, `W_LANE_POST_SPLIT W_BUS_NO_RETURN W_LANE_SELECT_EMPTY` (text, in `compile().graph.diagnostics`, with `line`), and on the queried haps `E_LANE_SOURCE`, `W_LANE_REFRAIN` (`lanes.diagnostics()`).
  `compile().graph.audio` holds the buses, splits, sends, returns and wires (what `strudel lanes` will print; the CLI commands and `stems` per lane group are in the CLI repo, not done yet).
Tests: `STRUDEL_MODULES=... node tests/lanes/l2.mjs` (events, checks, compile) and `node tests/site/lanes.mjs` (Playwright: seam, parallel FX, merge, allocation hash, cost, the page plays the program).

## Lanes: capture and recall (`engine/lanes-capture.js`, `lanes-capture-site.js`, #76; docs/LANES.md 6, section 11e)
`engine/lanes-capture.js` is loaded lazily the first time a program names `capture(`, `recall(` or `.from(` (`strudelCraft.lanesCaptureEnsure(code)`, awaited by `app.js` before every evaluation; `strudelCraft.lanesCapture` exists afterwards). It adds the globals `capture` and `recall` and `Pattern.prototype.from`,
and registers its static checks in `lanes.check` (`E_CAPTURE_LAYER LIVE EARLY CYCLE LIMIT NAME MEMORY`, `W_CAPTURE_TEMPO W_CAPTURE_UNKNOWN`; `E_CAPTURE_EARLY` is a warning, so `--strict` fails on it). A program that uses none of the three is untouched (`prepare` returns it byte for byte).
- `capture(name, picker, { window: "1b..3b" | last: "2b", what, live, max })`; pickers selector, `lane/tap` (events only), `master`; `bus:<name>` is parsed, its audio is coming. `recall("name[:ev|onset|gate|level|audio|<control>]", { at, once, gate })`, `pat.from("name")` = `pat.s("cap_name")`.
  Note Strudel's `slice` needs its index pattern: `s("x").from("groove").slice(8, "0 3 2 1 4 7 6 5")`.
- API on `strudelCraft.lanesCapture`: `defs()`, `analyze()` (captures with `pure` / `isLive` / `availableAt`, dependency `order`, diagnostics), `content(name, cycle)` (events as plain data), `availableAt(name)`, `freeze(name, at)` / `thaw(name, at)` (journaled), `setAudio(name, { L, R, sr }, { cps })`, `audio(name)`, `level(name)`, `budget`, `host.resolve(src)` (pass 1: renders the picked lanes through `strudelCraft.capture.renderRecipe` and registers `cap_<name>`; the original program is compiled again), `diagnostics()`.
  Pure helpers (also for the CLI): `analyze(src, { automated })`, `define`, `levelOf`, `createBudget`, `memoryLimit(deviceMemory)`, `frames(cycles, cps, sr)`.
- Not built (marked coming): audio of `bus:<name>` and of rolling captures, the pattern methods `.freeze()` / `.thaw()`, the CLI (`strudel capture`, capture passes in `render` / `stems` / `events`; another repo). The UI is the Graph view's capture node (#78, below).
Tests: `STRUDEL_MODULES=... node tests/lanes/l3.mjs` (events, time rules, cycles, bounds; CLI boxes print SKIP) and `node tests/site/lanes_capture.mjs` (Playwright: offline pass 1, frames, level, the captured sample plays, Bounce take with `meta.from`, two Remakes with the same hash).
Built on the Record hooks: `engine/index.js` registers the capture passes with `strudelCraft.capture.beforeRender` (Remake and every offline render run them first; programs without captures add no work; `strudelCraft.lanesCaptureHookOff()` unregisters) and `strudelCraft.lanesCapture.host.bounce(name)` stores an audio take (`capture.addTake`, `meta.from`). The capture node's buttons in the Graph view (#78) call these.

## Perform (`perform.js` + `perform.css`, view 5, #55)
Loaded on first open of Perform or on first Play (not part of the shell; `Engine.play` awaits it so `ctl()`/`hooks.map()` exist before the first evaluate). One tab strip (`role=tablist`, arrows, Home/End,
Alt+arrows reorder) of pad banks and control boards; "Tabs ⋯" adds, renames, duplicates, moves and deletes (site modal).
- Pads: 4x4 grid, multi-touch pointer events and the keyboard through `strudelCraft.input` (`keyboardProvider`, keys 1-4/Q-R/A-F/Z-V,
  only in Perform mode and never from text fields; the app's own shortcuts yield then). Perform vs Edit mode; Edit (or an empty pad)
  opens the pad sheet: target kind, reference (picker fed by the intellisense registry), mode, quantise, choke, label, colour.
  States empty / loaded / queued / on, each with a glyph mark as well as colour; queued shows beats remaining as text.
  Presses go to `strudelCraft.pads` (`press/release/resolve`); the resolved journal is `strudelCraft.perform.journal` and the
  `pads:journal` event, and the entries are written into `hooks.journal` (runtime format: hook pads `bind [slot, hook]` / `unbind [slot]`,
  var pads with a value `let [name, value]`; other ops as `pad:<op>`, journaled but not applied: the runtime has no unlet/tap/open op,
  and its `unbind` closes every binding on the slot, so a hook pad's off also closes program bindings on that slot).
- Scenes: "Tabs ⋯ > Scenes" cycles off / rows / columns; launch cells call `pads.launchScene`.
- Looper strip: Rec (window [next bar, +N bars)), length, Overdub, Undo, Play take (re-fed as pad intents), Save take (`performance`
  record in the library), Takes… (load from the library). Recording needs the transport running.
- Board: renderers for slider, fader, knob, number, toggle, button, select, xy, steps registered with `controls.registerRenderer`;
  declared-only types render through `fallbackChain` with a "basic view" note; 4 columns on phones. Each control shows its mapped
  destination; its sheet maps, unlearns, records/clears/saves a lane and sends it to another board.
- Learn: Learn, pick a destination, move a control: one `maps` entry plus one `hooks.map('ctl', 'dest')` line at the top of the playing
  editor; Unlearn removes both. `hooks.map` is glue on the runtime (idempotent; only lines still in an editor count).
  A map reaches params the code never mentions: `controls.applyMaps` rewrites the mapped key on the events as the outermost
  `queryArc` returns them (value resolved at each event's start cycle, lanes included), so one knob can move several layers.
  `hooks.map(control, dest, opts?, gate?)` from code does the same, but the control must already exist (declare it with `ctl()`
  first), and an unknown control is reported as `E_CONTROL_UNKNOWN` and ignored.
- Automation: "Rec lane" (or a cell's sheet) records the next moved number control for 1/2/4 bars into a lane (`recordLane`, period =
  length, overdub keeps points outside the touched span); "↶ Lane" undoes; lanes persist in the model (`automation`) and `ctl()`
  reads them at each event's time.
- Edit layout: size presets 1x1/2x1/2x2, move earlier/later, "Move to" another board, Place, Remove. "Save to library" stores the
  bank or board (`site/library.js`).
- Code: `ctl("name", {type, min, max, ...})` and Strudel's `slider(v, min, max)` (via `sliderWithID`) read the controls engine as a
  continuous `signal`; controls found in the playing program appear in a strip under that editor in source order, same components.
- Model persisted in `localStorage` `sc.perform` (so it is in history). Not built: "Send to pad" (a control is not a pad target kind).
- Test: `node tests/site/perform.mjs` (also part of `tests/site/smoke.mjs`); metrics under `perform` in `docs/screens/metrics.json`.

**Presets and outputs** (`perform-presets.js`, `perform-outputs.js`, `data/perform/presets.json`; docs/PERFORM_PRESETS.md). The `Presets` button opens a sheet: one tap applies a built-in
(Beatpad 4x4, Mixer faders per lane (each `hooks.map('mix_<lane>', '<lane>.gain')`: a lane-qualified dest changes only that `lane:` label's events), Macro knobs for the hooks, Minimal) or one of yours, setting pad bank, control board, keyboard map (`M.keys`, replaces the letter/digit keys) and takeover (`jump`
or `pickup` for hardware/input events); it adds or replaces its own tabs (`pb-<id>`, `pn-<id>`) and keeps yours. Save current as preset, Export / Import (`perform-presets@1` JSON, clashing ids get `-2`)
and Delete; user presets persist in `localStorage sc.perform.presets`. Code API: `strudelCraft.perform.presets.{list,apply,save,exportJSON,importJSON,open}`. Under every tab,
`Outputs and sources` lists each pad and control; tapping a row reveals the code line it reads (`Rack L3: ...`), a one-line explanation and two buttons, `Go to code` (the only jump; a press never scrolls the editor) and
`Show in graph` (highlights the node with that label, switching to Graph if needed). Pads nothing reads play a built-in audition voice (`perform-audition.js`, docs/PERFORM_PRESETS.md section 4: label `♪ kick`, pointer-down, journaled as before, a read pad stays silent). A tap pad is 2 journal entries per hit (`pad:tap`, `pad:tap-end`); one no code reads is marked `∅` / `unread` (no toast: it covered the pad rows on a phone).
## Shared model (`model.js`, `data/schema/model.v1.json`)
Standalone ES module: `parse(text)`, `generate(model)`, `applyOp(model, op)`, `graph(model)`, `layout(model)`, `canonical`, `hash`, `serialize`, `load`, `fromConfig`.
- Parser: acorn 8.19.0 (MIT, (c) Marijn Haverbeke and others), loaded unmodified as its own file `vendor/acorn-8.19.0.mjs` (licence: `vendor/acorn-LICENSE.txt`), only when `model.js` is imported. No Strudel transpiler code is copied.
- Version key is `model` (`"model": 1`), as in HOOKS_SYNTAX section 5 and the schema; there is no `hooks` key. The section 5 config keeps `cps/cpb/bpb` at top level, the schema holds them in `settings`; `load()` / `fromConfig()` move them.
- Lossless: each layer keeps its verbatim `src` (with leading comments) and is re-emitted unchanged while its structure matches; edit ops splice that text, so only the touched statement changes. Statements outside the subset (loops, helpers, IIFEs) are `code` nodes (`src` only); `tap/.tap/.use/.wrap` literals in them become ports. `hooks.*` statements keep their verbatim text and position among the layers (`hookSrc`: several per line, between or after layers) and are re-emitted unchanged while they still describe the model's registry; once an op changes the registry they are re-emitted canonically, one per line, before the layers. Undeclared `atoms.*` references stay as `$code` text (byte-identical) and raise `E_ATOM_UNKNOWN` at compile (on Play the site reports that coded error, with the atom name, in the status line and toast instead of a raw `is not defined`; the doc is left unchanged and nothing plays); anonymous `$:` layers are named `$1`, `$2`.
- Code carries `header, markers, scopes, slots, defs, vars, bindings, instances, tracks` and `layout` (as a final `// @model-layout {...}` comment). `meta`, `settings`, `wires`, `journal`, pads, controls, components live only in the JSON model file.
- Atoms (#63): `atom(...)` declarations become `model.atoms` (id -> `{ name, type, params?, body | from, rev, hash }`, ids reconciled so a
  rename keeps them) and every static `atoms.*` reference becomes `{ "$atom": id, args?, ops? }` in step args, `bindings` slot/hook/gate/else,
  marker points and var values. `generate` re-emits references as code and writes declarations only when the kept text does not already have
  them, so the round trip stays byte-identical. `graph(model)` adds one `atom` node per referenced atom with its reference sites.
- Quotes: double-quoted args of ordinary methods are mini-notation (`{"$mini"}`); reference methods (`tap use wrap ns wire`) and object/array members are plain strings. The generator never changes the quote of text it keeps; new text uses double quotes for mini and references, single quotes for other plain strings.
- Test: `node tests/hooks/p3.mjs`. The `strudel model`, `--model` CLI commands and the "Same sound" `strudel events` check need the `strudel` CLI (other repo) and print SKIP.

## Atoms (`engine/atoms.js`, `data/atoms/types.json`, `data/atoms/positions.json`)
Typed, parameterised definitions for magic strings (design: `docs/ATOMS.md`; core phase A1, #61). Standalone ES module, no DOM, the
same file on the site and in the CLI; it imports acorn from `vendor/` and never imports Strudel — the host hands in Strudel's own
`mini()` and the hooks runtime's `hooks.parsers` (gate / point / tap-ref / hook-expr) through `atoms.configure({ mini, parsers, positions })`.
- `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, default: 4 } }, body: "bd*${n}" })` declares;
  `atoms.kick4`, `atoms.kick4({ n: 8 })` reference. `compile(code, env) -> { code, map, refs, warnings }` replaces every static
  reference with its literal (pattern types double-quoted, name types single-quoted) and removes the declarations; it returns the
  code unchanged when the program has no atoms. Pipeline order: atoms compile -> control-site rewrite -> Strudel's transpiler.
- API: `registerType`, `types`, `loadTypes`, `configure`, `buildEnv`, `compile`, `buildAndCompile`, `check`, `render`, `apply`
  (partial application -> derived atom), `derive`, `runtimeAtoms` (frozen fallback for dynamic `atoms[x]`, which warns
  `W_ATOM_DYNAMIC`), `reconcile` (ids `a` + 6 base-36 FNV-1a chars, kept across renames; `rev` / `parent` by content hash),
  `atomHash`, `checkModel`, `locate` / `errorSpan` (an error inside a compiled literal maps back to the reference span).
- 19 types in `data/atoms/types.json` (mini, sound, bank, note, chord, scale, voicing, progression, gate, point, tapref, slot, hook,
  name, tag, selector, busname, capture, text) with `compiles / quote / shape / validator / editor / ops`; `data/atoms/positions.json` says which type fits which
  argument position (`s(` takes `sound | mini`, `hooks.bind` takes `slot, hook, gate`, ...) -> `E_ATOM_TYPE`.
- Schema: `atoms` map plus `$defs.atom / atomParam / atomRef` in `data/schema/model.v1.json`; `{ "$atom": id }` is accepted in step
  args, `bindings` slot/hook/gate/else, `wires[].tap`, `markers`, `maps[].dest` and pad `target.ref`.
- Migration (A2, #62; `engine/atoms-migrate.js`): `extract(code, { minUses, params, catalog, text, names, events }) -> { code, atoms, report }`
  types literals from `positions.json` (typed positions only; untyped strings stay unless `text`), groups by `(type, text)`, declares atoms
  used `>= minUses` times (default 2; `gate / tapref / slot / point` always), names them deterministically (`kickEnv`, `from17b`, `bdSd8`,
  clash -> numeric suffix), reuses existing atoms through `parse(type, string, env) -> { atom, args } | null`, and unifies literals that
  differ in one numeric token only with `params` (the report lists those candidates either way). Self-check before returning: the
  inlined result must equal the original program (normalised AST, plus `opts.events(code)` when the host supplies an event renderer),
  else the original code comes back with `report.reason`; a string typed both as a pattern and as a plain string is left alone and listed
  in `report.refused`. It never adds a sound, chord, note or instrument. `inline(code)` = compile with formatting kept; the site's
  "Open in strudel.cc", Copy and Stack copy use it (`atoms-site.js` exposes `strudelCraft.atoms`). `list(code)` shows declared plus referenced atoms.
- Catalog atoms (no declaration, synthesised on reference, never enumerated): `atoms.snd.bd` (`.n(3)` -> `bd:3`), `atoms.bank.RolandTR909`,
  `atoms.scale.minor({ root: "C" })`, `atoms.chord.m7({ root: "D" })`; names that are not identifiers use `atoms.snd["808bd"]`. The host
  passes the catalogs with `configure({ catalog: { snd, bank, scale, chord } })`; an unknown sound or bank warns `W_ATOM_UNKNOWN_SOUND`.
  `extract` turns catalog names into references only with `catalog: true`.
- Consumers (A3, #63; `engine/atoms-consumers.js`, wired by `atoms-site.js`). The compile pass runs before every evaluation
  (`app.js` `protectCode`: `atoms.prepare(code)` -> `protect()` -> Strudel's transpiler; the code comes back unchanged when a program has
  no atoms or an atom fails to compile). What the module provides, all pure data:
  - intellisense: `argItems` (only the atoms whose type fits the position in `positions.json`), `memberItems` (names, namespaces and
    catalog entries by prefix query, at most 50), `signature` + `values` (ranges respected), `literalAction` ("use `atoms.name`" on a
    string literal an atom already produces). Registered as one source and one signature provider through the new
    `intellisense.registerSource({ id, complete(ctx) })` / `registerSignature({ id, signature(ctx) })` hooks (a source may replace the
    options of a position or add to them with `merge: true`).
  - literal editors: `sites(code, env)` gives every reference site (compiled string, params, arg literal spans, Detach text, actions) and
    `shapeAt` the `atomParam` shape of one arg literal, registered through `literals.registerEditor({ id, shape(lit) })`, so scrub /
    chips / steps / piano work on reference args with the atom's own range and no new editor code. `strudelCraft.atoms.sites()` and
    `.open(siteId)` are the popover's data (the popover is `atoms-pop.js`, #64).
  - hooks: `installHooks(hooks, env)` registers the point atoms as markers and the atom id map plus a `$atom` resolver on the runtime's
    new `hooks.atoms` channel, so `hooks.plan`, `hooks.toJSON` and journal entries carry atom ids next to the resolved strings, and
    `hooks.load` accepts `{ "$atom": id }` wherever a string goes. String-typed atoms compile single-quoted, so such a line needs no `protect()`.
  - model: `model.js` projects `atom(...)` declarations into `model.atoms` (reconciled ids, `rev`, `hash`) and every static reference into
    `{ "$atom": id, args?, ops? }`; `generate` writes them back (declarations kept verbatim when the text still has them), so
    `generate(parse(code))` is byte-identical. `graph(model)` adds one `atom` card per *referenced* atom with its reference sites
    (`atomCards` / `modelRefs`, cost proportional to references, not to the environment).
  - pads, boards, maps: `createPads({ atoms })` and `createControls({ atoms })` take a resolver, so a pad target, a board cell or a map
    may address its target by `{ "$atom": id }` and survive renames. A map destination `atom:<id>.<param>` drives a live atom param
    (`checkMapDest`, `mapOverrides`, `compile(code, env, { overrides })`): only `number` params of `mini` atoms in repeat or step
    position, else `E_ATOM_ARG`.
  - history: `revisions(prev, next)` gives one `{ kind: "atom", id, name, rev, hash, parent }` record per new revision; the site appends
    them to `sc.atoms.log` in `localStorage`, which the history store snapshots with everything else.
  - packs: `modelDeps`, `atomIngredient` (`kind: "atom"`), `atomsetIngredient` (`kind: "atomset"`, entry file `atoms@1`),
    `verifyIngredient` / `importedAtoms` (`E_ATOM_HASH`); `atoms.import("pack:…", { as })` namespaces an imported set.
    Schema: `schemas/craftpack/1/kinds/atoms.1.schema.json`, kind `atoms` in `kinds/index.json` (code `never`).
- Tests: `node tests/atoms/a1.mjs`, `node tests/atoms/a2.mjs`, `node tests/atoms/a3.mjs` (need `STRUDEL_MODULES=<dir with @strudel/>`),
  `node tests/site/atoms.mjs`, `node tests/site/atoms_inline.mjs` and `node tests/site/atoms_ui.mjs` (Playwright). The CLI
  subcommands `strudel atoms list | show | refs | compile | extract | check` and `--atoms FILE` are built (suno-track-lab
  `engine/strudel-cli`, test `node engine/strudel-cli/test/atoms_test.mjs`); the `strudel complete` and `strudel packs ...` commands are built too.
- UI (A4, #64; `atoms-ui.js` + `atoms-ui.css` load with the Graph view, `atoms-pop.js` on the first tap on a reference; none of them
  with the shell):
  - Graph atom cards: one card per referenced atom at the visible level (from `graph(model)`; never from `model.atoms`, so 5000
    declared atoms with 3 referenced draw 3 cards; the cards read only the referenced ids and their composition closure from the lazy
    `model.atoms`, and the Graph parses only the code after the model's verbatim declaration header, so first paint does not resolve
    the other declarations), shared by all its references: name, text type badge (`MINI`, `GATE`, ...), the
    reference count (`×2`), the compiled preview, and editors for the body and param defaults. A derived reference
    (`atoms.kick4({ n: 8 })`) gets its own dashed card keyed by `{ atom, args, ops }`, wired from the parent card's `out` to its
    `from` port; its argument editors rewrite only that argument (`literal` op). One `param` wire per reference into the step port
    that holds it (badge = atom type), or into the slot's `gate:<binding>` port for a binding gate. Referencing nodes show
    `atoms.kick4 "bd*4"` in their step list. Body / default edits splice that one literal in the `atom(...)` declaration (validated
    first with the type's validator; model.js has no atom op yet), so the code shows one changed declaration line. Cards fade in
    when a reference appears and leave a fading ghost when the last one goes (no animation with reduced motion); placement is the
    deterministic layout, so undo brings a card back where it was. The card inspector lists the references with Detach (inline the
    compiled string at that reference).
  - Atom browser (Graph toolbar "Atoms", or "Atom for <port>…" in Outline > Connect to…): opens for the armed port, filters by the
    types that port accepts (`positions.json`: `gain` -> `MINI`; a binding gate -> `GATE / POINT`), text filter, namespaces Document,
    `atoms.snd`, `atoms.bank`, `atoms.scale`, `atoms.chord` (catalogs by prefix, from `atoms.configure({ catalog })`, else the
    site's sound / bank / scale names), 50 rows per page with More and scroll-to-load. Document rows on a lazy document walk the
    declaration index (`indexDecls`) and resolve a record only for the rows up to the current page, so opening it with 5000 atoms
    resolves 50; off-screen rows skip layout (`content-visibility`). Choosing a row makes the reference
    (`literal` or `setGate` op) and the card appears by the rule. Keyboard: Tab / Enter to "Atom for…", type, ArrowDown, Enter.
    `strudelCraft.atomsUI = { browse(port), query({ ns, text, types, page }), goto(atomId), accepts(port), cards(), refLabel(ref) }`.
  - Reference popover (code editor): a tap on an `atoms.*` reference, or Enter with the caret inside it, opens a fixed popover (no
    line moves): type badge, compiled string, param editors (rewrite the reference's args), Edit definition (selects the
    declaration), Derive… (site modal: name the current args as `atom("name", { type, from: atoms.x({...}) })` and use it here),
    Detach (inline the compiled literal here), Go to card (Graph view). Escape or a tap outside closes it; taps on an argument
    literal inside the reference stay with the literal editors. `strudelCraft.atomsPop = { open, close, current }`.

## Component library (`library.js`, `library-store.js`, #50)
Versioned components over the shared model; storage goes through `library-store.js` (`strudelCraft.history` when a host provides it,
else an in-memory + `localStorage` `sc.library` fallback with the same five calls).
- A record is a model plus `meta` (name, kind `song|track|set|fragment|bank|performance|board|automation`, rev, content hash, parent, tags) and `exports`
  (`taps`, `slots`, `hooks`, `params` with `target` paths, `requires`). `save` hashes the content: saving identical content returns the
  existing rev, anything else is a new rev, so `"pad@3"` is pinned content; `verify` refuses a record whose hash does not match
  (`E_COMPONENT_HASH`, other errors `E_COMPONENT_REQUIRES`, `_MISSING`, `_CYCLE`, `_ARG`, `E_BAD_REF`).
- `extract(model, selection)` lifts a selection into a component, `replaceWithInstance` puts the instance back, `embed` inlines a
  component's record, `expand(model, { lookup })` flattens instances and `lib:` hook-refs into a plain model (namespaced `as/...`).
- Runtime (`installInstances`, installed on the hooks runtime by `hooks-intellisense.js` on the first refresh):
  `hooks.inst("pad@3", { as: "pad2", args, gate, remap })` returns the instance's tracks as one pattern (its params follow
  `hooks.set("pad2.cutoff", v)`), and `hooks.bind(slot, "lib:warmth@1(0.4)")` binds a saved fragment's hook (its defs are registered
  under a slugged name). Instance tracks run in their own scope `as_track`, so a track-scoped slot `bass/fx` is addressed from the host as
  `pad2_bass/fx` (collapse rewrites existing bindings; docs/BLUEPRINT.md section 6). Text-only (`src`) tracks, inline `$code` args and gated instance-param sets raise `E_UNSUPPORTED`.
- Components are created from the UI: Graph (select nodes -> "Save to library" / "Collapse to subgraph") and Perform
  ("Save to library" for a bank, board, take or lane). Test: `node tests/hooks/p4.mjs`.

## Hooks and model intellisense (`hooks-intellisense.js`, #51)
Two providers through the public registry (`intellisense.js` is unchanged), re-registered (the registry's cache-bust) on every code,
runtime or library change (400 ms debounce, `input` capture plus the `strudel:hooks-changed` event):
- `hooks`: the fixed vocabulary - methods `.use .wrap .tap .wire .ns` plus the lanes ones `.tags .fx .mute .solo` (`method: true`), functions `tap`, `tagged`, `lanes.closed/open`, `hooks.def/undef/bind/replace/load/inst`,
  and gate templates `@17b`, `<17b`, `9b..17b` (category `gates`).
- `model`: names from the program, merged from `hooks.manifest()` when the runtime is up and `model.parse()` of both editors otherwise -
  categories `slots` (with their bindings and windows), `hook names` (plain and with default args, `info` = params with min/max/default/unit),
  `decorators`, `markers`, `variables`, `taps` (each `name` plus `name:facet`; facets are `onset/gate/env` plus the controls actually seen
  on the tapped events, collected into `model.tapControls` from the live taps) and `components` (`name@rev` from the library, with their exports);
  an instance contributes `as/slot` and `as/tap` names.
Test: `node tests/hooks/p5.mjs`.

## Graph (`graph.js` + `graph.css`, view 7, #52)
Blueprint node editor over `model.js` and `library.js`, lazy-loaded on first open (not in the shell). It never writes code or model
fields directly: every edit is one `model.js` op (or the library's `extract` / `replaceWithInstance`), so code, graph and model stay the
same document and undo is the shared history stack (up to 200 steps or 8 M characters of program text, oldest dropped first, so a
5000-atom document keeps about 30 steps). The plan-strip playhead only runs while the strip is open, the transport plays and the Graph view
is showing; closing the view leaves no timer, animation frame or browser listener behind.
- Nodes come from `graph(model)`: tracks (source + chain), defs, slots with their bindings and gates, taps and wires, variables,
  markers, component instances (a missing component shows `E_COMPONENT_MISSING` on the node) and atom cards for referenced atoms
  (`atoms-ui.js`, see Atoms > UI). Placement from `layout(model)`,
  persisted as the `// @model-layout {...}` comment.
- Canvas: pan and pinch zoom with a content-derived minimum zoom (zoom out always keeps every node visible), glyph level of detail,
  1:1 reset and Fit; on phones one finger scrolls the page (`touch-action: pan-y`), two fingers pan and zoom, and "Interact" locks
  one-finger panning. Selection -> "Save to library" or "Collapse to subgraph" (new component plus `hooks.inst(...)` in the code).
- Collapse and required taps (`remap`): when the selection reads taps it does not publish, library `extract` lists them in
  `exports.requires.taps` and the instance line gets `remap: { ... }`, written the same way as the CLI's `strudel library collapse`:
  `$: hooks.inst("duck@1", { as: "duck", remap: { kick: "kick" } })`. The candidate taps are what the rest of the program publishes:
  track taps, and other instances' exports as `as/tap`. A tap of the same name is the one compatible provider and is used without a
  question. With no tap of that name, the instances' `as/<name>` copies are used; when there are several, the site modal lists them,
  and when there are none it lists every published tap. Cancel leaves the text unchanged. If nothing outside the selection publishes
  a tap, the collapse is refused (`E_COMPONENT_REQUIRES`, shown in the status line and a toast).
  - On the instance node every required tap is an input port labelled `kick ← kick`, and a signal wire runs from the provider. A missing
    mapping shows `E_COMPONENT_REQUIRES` on the node.
  - The Outline row reads `requires kick ← kick`.
  - The inspector has one select per required tap. Changing it rewrites `remap` on that `hooks.inst` line in one undo step.
- Tests: `node tests/site/graph.mjs`, `graph_zoom.mjs`, `graph_scroll.mjs`; screenshots and metrics under `graph` in `docs/screens/`.
  `node tests/site/graph_soak.mjs [--rounds 50] [--detail]` opens and closes the view 50 times (documents, collapse + undo, the 5000-atom
  browser, pan / zoom, lane and capture nodes) and fails if heap, DOM nodes, listeners, detached DOM, timers or observers after GC grow
  past the bounds in the file between round 5 and the last round.
- **Lanes in the graph** (`lanes-ui.js` + `lanes-ui.css`, #78, docs/LANES.md 11d; loaded with the Graph view, not with the shell). Drawn from `graph(model)`; edits go through `applyOp`
  (`addBranch`, `exportTap`, `addSend`, `literal`) or, where model.js has no op yet, one splice of that statement on the graph's undo stack (adding / removing a `tagged(...)` statement, a group
  send amount, a capture window).
  - Lane card: tag chips with **Mute** / **Solo** (state as a word and a filled square: one `tagged("<tag>").mute()` / `.solo()` statement is added, tapping again removes it), an `audio` out port,
    exported taps as ports on the card edge (wire one to another lane's param: facet and range sheet, `.wire(...)`), a `ret` input on return lanes.
  - Split fan inside the card: one audio bar in, one row per branch (param and chain), local taps as ports inside the fan only, the join (sum or merge chain); **+ Branch** (site modal, `addBranch`),
    fold / unfold (the card keeps its ports), **Voices** (compiles the lane alone through `strudelCraft.transport.compileCode` - it stops playback after asking - and counts one cycle of
    queried events: source voices + `s("bus")` readers, against source x branches for `.layer`).
  - Wiring a local tap to another lane is refused: the inspector shows the `E_LANE_CROSS` text with **Export tap** and **Add send** (the `fixes` of `checkWire` / `graph().refused`); code-level
    refusals show as a red row on the reading lane.
  - Bus node (`audio` in = sends, out = returns): one row per send with its amount (0..1; a lane's own `.send` through `literal`, a group send rewrites that `tagged(...).send(bus, x)` argument).
    A lane's `audio` port wires to a bus input (amount asked in the site modal, `addSend`).
  - Selection chip node: selector, ops, gate, matching lanes; "Send to pad" is **coming** (needs a pad-assign entry point in Perform).
  - Capture node: picker chip and matches, window From / Until (or Last) with bar steppers that rewrite the window string, one out port per recorded layer (`ev`, `audio`, `level`), the state as
    a word and an icon (Empty / Recording / Frozen, from the capture runtime; while playing, a live window capture reads Empty before From and Recording until Until; a rendered window is
    Frozen; nothing pulses under reduced motion). Actions, each a 44 px button with a second line saying what it does or why it cannot run (focusable, the reason is also toasted):
    **Bounce to takes** (`lanesCapture.host.bounce`: an audio take with `meta.from` in the Record list; the result toast opens the Record panel), **Freeze / Thaw** for rolling captures
    (`lanesCapture.freeze` / `thaw` at a cycle asked in the site modal; journaled, no code change) and **Use as sample** (`lanesCapture.host.resolve` registers `cap_<name>`, shown in the node
    with **Copy**; then the site modal asks a lane name and one lane `name: s("x").from("<capture>").loopAt(<cycles>)` is added as one undo step; Cancel adds nothing). Bounce and Use as
    sample render offline: they compile the graph program, so when playing they ask first, stop and let the voices ring out (1.5 s, #88). Progress shows as a busy word in the node and toasts;
    failures are toasts naming the code (`E_CAPTURE_HOST`, `E_BAD_ARG`, ...). On `bus:` and rolling captures Bounce / Use as sample are disabled and marked **coming** (that audio is not built
    in the runtime); events-only and tap captures say "records no audio" / "events only"; Freeze on a window capture says it holds itself after Until.
  - Audio wires: thick bar with a ladder of slots, badge `BUS` + amount (`ret` on a return). Outline pane: a Lanes section (tag filter, lane list with Connect to…, tags with Mute / Solo,
    split fans with Add branch / fold, buses with amounts, captures, refused wires with their fixes), so every action works without a pointer.
  - `strudelCraft.lanesUI`: `toggleTag(tag, op)`, `setAmount(bus, lane, v)`, `setWindow(capture, field, value)`, `addBranch(lane)`, `countVoices(lane)`, `fold(lane, on?)`, `cross(c)`,
    `bounce(capture)`, `freeze(capture, at?)` / `thaw(capture, at?)`, `useAsSample(capture, lane?)` (`lane` null: register only), `copySample(capture)`, `state()`.
    Palette group Lanes. Test: `node tests/site/lanes_ui.mjs` (also run by the smoke test).

## Hooks wiring
`app.js` runs every program through `strudelCraft.hooksLib.protect(code)` before `evaluate` (play and live swap), so gate strings such
as `"@2b"` stay plain strings. Before the first evaluate it installs the hooks runtime and gives it the mod RANGE table
(`data/mod_ranges.json`, a mirror of the CLI's `engine/strudel-cli/lib/mod.mjs`: `ranges` + `canon`) so `wire()` scales into real
param ranges (e.g. `lpf` -> `cutoff` 20..20000).

## Syntax (`syntax.js`, view 6)
**Composition concepts** (#144): a second `syntax@1` ingredient of the shim pack, `data/composition.json` (lazy), merges 111 concept sections
into this view (ids `MOT-01` .. `ARR-04`, 19 families: motif, interplay, cross-texture, foreshadow, layering, tension, energy, transition, groove,
harmony, borrowing, discordance, assonance, complement, synergy, clustering, sound design, vocal as instrument, arrangement). A section may carry
`folder` (organizer folder, here `composition/<family>`), `tags` (#120 words plus `measured` and the lowering status) and `notes`
(`[label, text | [texts]]`, drawn as a definition list: why it works, when, measure, anti-patterns). Generated by
`node tools/composition/build.mjs` from `tools/composition/catalog.mjs` with both forms from tools/lowering (event-verified); never edit the JSON.
The doc is docs/COMPOSITION.md; the measuring tools are suno-track-lab `engine/composer`. Examples are intellisense snippets like the others
(`mot-03-inversion`, ...).
Teaches the new paradigms from `data/syntax.json` (sourced from docs/HOOKS_SYNTAX.md and docs/BLUEPRINT.md): slots/.use()/gates,
taps/wire/variables/decorators, inline controls and mapping, pads and the board, library components, word() vocals, ghost text.
An example may carry `"explain"` (a note under the code) and `"flow"` (a list of `[name, text]` boxes drawn as a signal-flow diagram, for instance the bus modulator examples).
Each example has "Load and play" (loads into Rack and plays, or hot-swaps if already playing); `"noplay": true` makes it "Load"
only (for examples that need state first, such as a component saved in your library) and `"action": "perform"` opens Perform instead.
A paradigm whose engine is not present is marked "coming" (detected at runtime), and a single example can carry `"coming": true` when
the syntax around it is built but that call is not (no example is marked so at present). Every other example is expected to evaluate on the
site as built: check with `node tests/site/smoke.mjs` plus a load of each example into Rack. Examples are intellisense snippets (provider `syntax`).
If the syntax data cannot load (a pin mismatch `E_PACK_HASH`, offline with nothing cached), the view shows an error state naming the code,
a Retry button (`strudelCraft.packs.retry('syntax')`, which re-reads failed ingredients of a kind; `packs.failure(kind)` says why one failed)
and four bundled core examples instead of an empty pane.
Section **Track demos** (`tracks`) holds whole programs: "Track demo: night phonk" loads `docs/tracks/night-phonk-demo/track.standalone.strudel.js`
(G minor, 80 bars = 2:29; atoms, lanes, racks bound into slots, gated mutes and binds, kick-tap ducking, four ctl macros, verb and glue returns; it
loads the ljspeech, sung, call-me-baby and vocalset banks on first play); "Track demo: night phonk v2" (#93, 84 bars = 2:37: kick-synced duckorbit pump, pre-drop vacuums, a confrontational drop, drops juxtaposed with relief sections) loads `track.v2.standalone.strudel.js`. The entries are generated by `node tools/packs/phonk.mjs` from that file, never
edited by hand.

## Typed params, AST-bound controls, inert validation
Design: `docs/CONTROL_BINDING.md`. `data/intellisense/strudel.json` `params` gives each function's args a shape (number with
range/unit/curve/control, note, mini, sound, enum, bool, pattern, control), merged with `data/mod_ranges.json` and
`data/controls/types.json`; inside `fn(` only that shape's suggestions show, with signature help. `engine/bind.js` finds
`slider()`/`ctl()` sites with acorn, ids `k` + 6 base-36 chars of FNV-1a(structural path), reconciled by path, then structure, then
position, and rewritten to `sliderWithID('id', ...)`/`ctlAt('id', ...)`. `engine/settle.js` is the one scheduler (350 ms quiet,
1.5 s max wait, stale runs cancelled): validate -> derive -> compile (live swap, or idle `repl.evaluate(code, false)` when stopped,
so controls and inline visuals show without Play) -> apply -> history. Invalid code changes nothing but a gutter marker, underline
and the chip dot. Test: `node tests/site/binding.mjs`.

## Transport range, workspace and palette (`transport-range.js`, `workspace.js`, `palette.js`, `workspace.css`)
- **Transport range** (under the stage): position slider with scrub; readout `c 12.3/64.0·00:24/02:08` (fixed decimals and widths, no jitter: docs/WORKSPACE.md "Live numbers") = current cycle / end cycle · elapsed / end time, plus remaining time. End is the loop End when looping, otherwise the play-time clamp end. Start, End and Go-to (tap the readout) take a cycle or `m:ss`; the unit button cycles cycle / bar / m:ss. Cycles are stored; times are converted with the live cps, so a tempo change keeps them right. A fresh run (stop, then Play) starts at Start when Start > 0, loop or not (Start 0 = the beginning). Seeking re-anchors the Strudel 1.3.0 Cyclist time origin (`lastEnd` + tick reset; `setCycle` when present); the loop wraps inside the scheduler tick, sample-accurate. Clamp: 20 min per run by default (timer button: minutes, fade or hard stop), `+5 min` override near the limit. API `strudelCraft.range = { state, seek, parsePos, setLimit, extend }`.
- **Workspace** (`W` or the layout button): docks Code, Graph, Recipes, Perform, Syntax, History, Tracker, Record and Banks as panes pinned below the visuals. Each pane: move up/down/left/right, split (own row / join row above), collapse, close; desktop rows resize by dragging the gutter (arrow keys on a focused gutter); phones stack panes, reorder with the grip. Layouts Code, Perform, Visual, Full studio (`Alt+1..4`) plus saved ones (name + optional hotkey) live in `sc.ws.*`, so the history store versions them. API `strudelCraft.workspace = { on, off, load, save, layout, configs }`.
- **Command palette** (`Ctrl+K`, configurable via the palette's "Set palette chord"; floating button on phones): type to filter (prefix, word prefix, substring, then fuzzy subsequence), arrows/Enter or digits 1-9 pick. Add actions with `strudelCraft.palette.register({id, title, group, keys, run})`.
- **Copy code** (`copycode.js`, `copycode.css`): a 44px copy button at the top-right of the Rack editor, the Stack program and every Syntax example, in a right strip the code never runs under (no layout shift). Tap copies the whole CodeMirror doc (`navigator.clipboard.writeText`, hidden textarea + `execCommand('copy')` fallback), with a check mark and a Copied toast; it works with the code in an error state. Hold it (or right-click, Down, Shift+F10) for Copy selection, Copy as a shareable link (`#code/z<base64url deflate-raw>`, opened links load into Rack) and Copy with controls and state (recipe v1 JSON, `includes.code` only). Keyboard: Tab reaches the button before the editor; Enter / Space copy; Down / Up open the menu on its first / last item, Down / Up / Home / End move, Enter runs an item, Esc closes and returns focus (menu-button pattern; nothing reaches the global shortcuts). Shared links are untrusted input: **limit 256 KiB (262144 bytes) of UTF-8 code**. The encoded payload is length-checked before decoding (at most 352256 base64url chars), and `#code/z` inflation is streamed in 256-byte input slices and aborted as soon as the output passes 256 KiB, so a deflate bomb never materialises. Oversized, malformed base64url / deflate, unknown prefix, non-UTF-8 and empty payloads load nothing, leave the editor untouched and show an error toast naming the reason. Making a link from code over the limit is refused with a toast and nothing is copied. A loaded link is never evaluated or played: the idle compile is held for it until you press Play / Run (or pick another recipe). Palette group Copy. API `strudelCraft.copycode = { copy, text, selection, link, decode, loadHash, recipe, attach, limits }` (`limits = { code: 262144, hash: 352256 }`). Test: `node tests/site/copycode.mjs` (360 px, clipboard granted).
- Live numbers (`numfmt.js`, `.num`): every live readout uses fixed decimals, padded clocks and a fixed-width tabular box, so values never shift their neighbours; test `node tests/site/readout_layout.mjs`.
- Test: `node tests/site/workspace.mjs` (palette fuzzy, pane move/split/close, layout save/load, scrub and loop via queried scheduler spans, readout, 44px targets, clamp + override at 360 and 1440 px).
Code-area pointer and hints (#169): `pointerCaret` (`intellisense.js`) sets the caret on `pointerdown` for every node type; inlay hints (`inline.js`, parameter names before literal arguments, `intellisense.inlayHints.enabled(on)`) are `::before` text: not selectable, copied or a caret stop. Smart literal editors (`literals.js`): tap a number, name, chord or mini-notation token to edit it in a fixed popover (scrub, combobox,
chips, piano, sound list, toggle, step chips; placed by `anchorPop`: below, flipped above, clamped to the visual viewport, re-placed on scroll/resize, dragged by its head strip, Alt+arrows nudge, #169); a drag on a number rewrites the source once on release. A provider may own a literal's
shape or editor: `strudelCraft.literals.registerEditor({ id, shape(lit), match(lit, param), render(host, ctx) })` - the atoms provider gives
an atom reference's args the atom's own `atomParam` range (#63). Reference inspector (`refs.js`,
`strudelCraft.refs`: resolve/related/highlight/describe): selecting a control marks its source span and related references without ever scrolling the editor (a press belongs to the control); Go to code is the tooltip's target button or a 500 ms still long-press (`refs.gotoCode(id)`);
long-press, hover or focus shows its id, path, label, type, value, range and mappings; the caret on a call makes its controls glow. On-screen sliders, faders and knobs use jump takeover (the first drag moves the value); soft takeover (pickup) is for absolute hardware only.
Design: docs/CONTROL_BINDING.md sections 7 and 8.
Range spec: numeric controls carry min/max/step/unit/curve/clamp (override per AST id > code > param shape > 0..1); tap the number for
exact unit-aware entry (1.5k, -6 dB, 2:30) with "Extend range to fit"; "Range…" in the control sheet edits the range. Typed literal
editors apply live (no confirm tap). Docs: docs/CONTROL_BINDING.md sections 7 to 9.
Accept (Tab on ghost text, or a popup item) is node-aware (`mergeAccept` in inline.js): it replaces the word or value under the caret,
keeps existing brackets, arguments and chain calls, does nothing when the text is already there, and is one undo step.
Suggestions (ghost text, popup, cycling) are inert until accepted and dismiss themselves on a tap elsewhere, blur, scroll, view or
modal switch, Esc or 5 s idle (CONTROL_BINDING section 11). Literal menus open from the tap itself, even with the editor focused; a tap
on another literal switches, the same literal toggles (section 7).

## Record panel and recipes (`capture.js`, `recipe.js`, `capture.css`, #72; detail docs/CAPTURE.md)
- **One Record panel**: transport record button, palette group Record, or the workspace pane `record`. Include boxes Audio / Events (lanes, pads, controls) / Code-state; one Record captures all ticked parts; Length in Bars (default) / Cycles / Seconds typed or by chip, Start bar and To end of track (`record-length.js`, #139), arm Free / Cycles (cycle-boundary cut, exact loop length) / Until stop, count-in, pre-roll, Render exact N cycles.
- **Takes are recipes** (`schemas/recipe.v1.json`, forward only, version 1): source + resolved atoms, controls model with AST ids and aliases, Perform model, mod ranges, settings, cps, start/stop cycle, seed, event stream, and pinned deps (Strudel bundle sha256, site build, pack lock entries with ingredient hashes, sample maps at a commit + hash, vox banks + hash). Audio blobs are outputs with sha256.
- **Remake** re-renders offline from the recipe (after a dependency approval modal, trust prompts for unknown sources and hash verification; a mismatch refuses the load naming the ref) and checks the audio hash. Imports are inert until Remake. The old take store is pruned once with a notice. Pad bindings replay from the recipe's hooks pad journal; packs are verified through the pack loader (`packs.verify`); a take that is not bit-exact (noise, very low filter cutoffs) is compared by its 10 ms level fingerprint within 1.5 dB and says so.
- Storage IndexedDB `sc-recipes`, settings `sc.record.*`, trust grants `sc.trust`. An old `sc-capture` take store is never deleted silently: a sticky toast (`sc.ui.askLater`, not a modal, so Play stays usable after an upgrade, #84) opens a modal that offers a JSON backup download and clear, Clear, or Keep for now (#72). The capture tap is a 0-output worklet (nothing added to the audible path); realtime audio takes also keep a WebM/opus copy (`WebM` button; WAV only where MediaRecorder lacks opus). Hooks for lane captures: `capture.beforeRender(fn)` runs before offline renders, `capture.addTake({...from})` stores an audio-only take (#76). Test `node tests/site/record.mjs`.
Caret placement works in every state: highlight and widget decorations never dispatch while a pointer is down in an editor and only when they change (CONTROL_BINDING section 5).
