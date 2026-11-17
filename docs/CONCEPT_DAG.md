# Concept DAG
Owned by the `daw-sme` agent. State: unexplored -> scouted -> designed -> issued -> built -> accepted.

| node | depends on | state | issue |
|---|---|---|---|
| issues-protocol | - | accepted | #1 |
| local-samples-ir-bounce | issues-protocol | accepted | #2 |
| warp-formant (rubberband) | local-samples-ir-bounce | accepted | #3 |
| slicer | local-samples-ir-bounce | accepted | #4 |
| spectral-freeze-paulstretch | local-samples-ir-bounce | accepted | #5 |
| envelope-follower-ducking | issues-protocol | accepted | #6 |
| granulator | local-samples-ir-bounce | accepted | #7 |
| vocoder | issues-protocol | accepted | #8 |
| external-renderers-sf2-ks | local-samples-ir-bounce | accepted | #9 |
| mod-matrix (LFO/envelope -> any param, cross-layer) | issues-protocol | accepted | #11 |
| time-volume-gating (Gross Beat-style) | envelope-follower-ducking, slicer | accepted | #12 |
| follow-actions-clip-launching | issues-protocol | accepted | #13 |
| offline-bounce-resample-loop | local-samples-ir-bounce | accepted | #14 |
| live-mic-input | offline-bounce-resample-loop, licence-decision-live-input | scouted | - |
| licence-decision-live-input | issues-protocol | issued | #20 |
| convolution-ir-reverb | local-samples-ir-bounce | accepted (Strudel `ir`, via #2) | #2 |
| spectral-resonator | spectral-freeze-paulstretch | accepted | #16 |
| resynthesis (Harmor-like additive) | spectral-freeze-paulstretch, spectral-resonator | scouted | - |
| sidechain-multiband-dynamics | envelope-follower-ducking | accepted | #15 |
| bug: multiband release accuracy | sidechain-multiband-dynamics | accepted | #17 |
| loudness-metering-lufs | local-samples-ir-bounce | accepted | #18 |
| midi-clip-import-export | issues-protocol | accepted | #19 |
| master-bus-chain-presets | loudness-metering-lufs, sidechain-multiband-dynamics | accepted | #24 |
| arrangement-scene-timeline | follow-actions-clip-launching | accepted | #25 |
| bug: midi import tempo map + track names | midi-clip-import-export | accepted | #22 |
| bug: true-peak above 16 kHz | loudness-metering-lufs | accepted | #23 |

| bug: events stdout truncation | midi-clip-import-export | accepted | #26 |
| check: mini-notation-in-plain-string warning | issues-protocol | accepted | #27 |
| continuous-in-note-lfo (filter/FM wobble) | mod-matrix | accepted | #28 |
| ott-multiband-compressor | sidechain-multiband-dynamics | accepted | #29 |
| bug: ducking orbit order + dB depth | envelope-follower-ducking | accepted | #30 |
| e2e-mixdown-wav-fx + genre-score | sidechain-multiband-dynamics, loudness-metering-lufs | accepted | #31 |
| behavioral-smoke-tests | issues-protocol | accepted | #32 |
| site: stop click/tail (#34) | behavioral-smoke-tests | accepted | #34 |
| bug: master true-peak over ceiling | master-bus-chain-presets | accepted | #35 |
| mixdown-region-fx | e2e-mixdown-wav-fx + genre-score | accepted | #36 |
| bug: folk-pop preset LUFS 0.02 short | master-bus-chain-presets | accepted | #37 |
| bug: events EPIPE trace on early pipe close | bug: events stdout truncation | issued | #38 |
| per-layer-stem-rerender-cache | offline-bounce-resample-loop | issued | #39 |
| section-automation-lanes | mixdown-region-fx, arrangement-scene-timeline | issued | #40 |
| info-arrange-length-check | arrangement-scene-timeline | issued | #41 |
| hooks-core (named slots `.use`, time-gated bindings, journal, config JSON; docs/HOOKS_SYNTAX.md) | arrangement-scene-timeline, behavioral-smoke-tests | issued | #47 |
| taps-vars-decorators (`.tap`/`tap()`/`.wire`, modules, `hooks.let`, decorator hook expressions) | hooks-core, mod-matrix | issued | #48 |
| model-schema-roundtrip (one JSON model; code <-> model <-> graph; docs/BLUEPRINT.md) | hooks-core, taps-vars-decorators | built | #49 |
| component-library (versioned components, instances, history adapter) | model-schema-roundtrip | built | #50 |
| hooks-intellisense (providers `hooks`, `model`) | hooks-core, intellisense-provider-registry | built | #51 |
| graph-editor-ui (blueprint node editor; ui-designer) | model-schema-roundtrip, component-library | built | #52 |
| pad-engine (beatpad banks, launch modes, scenes, looper, input-provider registry) | taps-vars-decorators, component-library | issued | #53 |
| controls-engine (control type registry, `ctl`, slider shim, mapping, automation lanes) | taps-vars-decorators, pad-engine | issued | #54 |
| perform-ui (pad banks + control boards, inline controls; ui-designer) | pad-engine, controls-engine | built | #55 |
| intellisense-provider-registry (`window.strudelCraft.intellisense.register`, site) | behavioral-smoke-tests | scouted (in progress elsewhere, not on main) | - |
| history-store (`window.strudelCraft.history`) | behavioral-smoke-tests | scouted (not on main; interface needed is in docs/BLUEPRINT.md section 6) | - |
| webmidi-gamepad-input-providers | pad-engine | unexplored | - |
| atoms-core (typed, parameterised, id-addressed definitions for magic strings; compile pass to plain Strudel strings; docs/ATOMS.md) | model-schema-roundtrip, controls-engine | issued | #61 |
| atoms-migration (extract / parse / inline, catalog atoms) | atoms-core | issued | #62 |
| atoms-consumers (intellisense, typed arg editors, hooks/model/pads `$atom`, pack ingredient) | atoms-core, hooks-intellisense, pack-spec | built | #63 |
| atoms-ui (lazy reference-counted graph cards, atom browser, reference popover; ui-designer) | atoms-core, atoms-consumers, graph-editor-ui | issued | #64 |
| pack-spec (craftpack manifest, kind sub-schemas, hash tree, lock, registry, validator; docs/PACK_SPEC.md, schemas/) | issues-protocol | issued | #65 |
| licence-decision-pack-content (first-party pack licences) | issues-protocol | issued | #66 |
| pack-loader-site (`strudelCraft.packs`, kind adapters, precedence, lazy load, service-worker pack cache, pack sheet) | pack-spec, intellisense-provider-registry, controls-engine | partial: loader, adapters, service-worker cache built; pack sheet UI open | #67 |
| pack-loader-cli (`--packs`, `--pack`, install/verify/list, render.json credits, shared resolution module) | pack-spec | issued | #68 |
| core-pack-migration (site/data -> glyphcore/core on branch `packs`, shipped lock, deploy bundling; vox packs prepared, publish needs owner approval) | pack-loader-site, pack-loader-cli, licence-decision-pack-content | issued | #69 |
| pack-authoring (contributor guide, template layout, pack CI, registry CI) | pack-spec, core-pack-migration | issued | #70 |
| pack-code-sandbox (iframe sandbox host, per-kind RPC, hash-bound grants) | pack-loader-site | issued | #71 |
| pack-signatures (registry-side signing of manifests) | pack-spec | unexplored | - |
| pack-external-assets (hash-pinned remote sample files in sound maps) | pack-spec | unexplored | - |
| pack-kind-atoms (`atoms@1` ingredient kind and schema, docs/PACK_SPEC.md 5.1) | pack-spec, atoms-core | built | #63 |
| lanes-events (memoised taps, lane-scoped taps, tags and selections; docs/LANES.md) | taps-vars-decorators, controls-engine | built (engine, tests; CLI `strudel lanes` pending, critic pending) | #74 |
| lanes-audio (`.split` / `.merge` / `.send` / `ret` on superdough buses, no re-synthesis) | lanes-events | built (compile pass, checks, wire, group send, measured seam and cost; CLI `render` / `events` / `stems` / `lanes` pending, critic pending) | #75 |
| lanes-capture (`capture` / `recall` / `.from`: events, audio, level; deterministic passes) | lanes-events, lanes-audio | issued | #76 |
| lanes-consumers (model, graph data, param shapes, intellisense, atom types, AST ids) | lanes-events, model-schema-roundtrip, atoms-core | built (data side; runtime halves wait on #75 / #76; critic pending) | #77 |
| lanes-ui (lane cards, split fan, bus and capture nodes, tag chips; ui-designer) | lanes-consumers, graph-editor-ui | issued | #78 |
| track-demo-night-phonk (glyphcore/phonk pack: atoms, racks, preset; standalone + pack track; chunked CLI render) | atoms-consumers, lanes-audio, hooks-core, controls-engine, vox banks | built (critic pending) | #89 |
| hooks-pack-site-adapter (site loads hooks@1 racks) | track-demo-night-phonk, packs-p2 | built (critic pending) | #91 |
| map-gate-grammar (hooks.map gates: unions, bar points) | controls-engine | issued | #90 |
| word-lane-disconnect (site page errors with word() lanes in send programs) | lanes-audio, vox banks | issued | #92 |
| audio-engine-measurements (long tasks, LoAF, profile, late haps, glitch metric) | background-playback | built | #102 |
| visuals-hap-cache (per-cycle query, flag vis) | audio-engine-measurements | built | #103 |
| scheduler-query-batching (flag sched) | audio-engine-measurements | built | #103 |
| late-window-reanchor (flag late) | audio-engine-measurements | built | #103 |
| per-query-memo (gateAt, mapKey, aliasKey) | audio-engine-measurements | built | #103 |
| engine-diagnostics (long tasks, late haps, voices in flight, flags) | audio-engine-measurements | built | #103 |
| engine-worker (evaluate + clock + queries in a Worker, events published ahead, page only builds voices; flag, default off; hooks/ctl/pad programs stay on the page clock) | visuals-hap-cache, late-window-reanchor | built stage 1 (critic pending) | #180 |
| offline-render-host (hidden page, own superdough, chunked, cancellable) | record-recipes | built | #104 |
| offline-record-default (no speakers) | offline-render-host | built | #104 |
| live-take-self-check + re-render | offline-render-host, audio-engine-measurements | built | #104 |
| edm-core foundations (sidechain / pump / OTT / drive / wobble moves, risers, impacts, roll and filter grammars, 104-bar gates and masks; pack glyphcore/edm; multi-pack builder) | concept-framework, feels, rack standard | built (critic pending) | #127 |
| dubstep family (UKF half-time, melodic, riddim, brostep; reese / growl / screech classes; feels halftime, ukf, riddim, brostep) | edm-core foundations | built (critic pending) | #128 |
| edm-dubstep tutorial track (104 bars, 11 lessons, program recipe with generated standalone) | dubstep family | built (critic pending) | #129 |
| wavetable growl (wt_ frames) | dubstep family, sample banks | designed | - |

## Waiting nodes
- audio engine (#102-#104): measured first (#102); B wins behind flags (vis, sched, late) and C (render host, offline Record default, self-checking live takes) built; the engine worker (B1) is designed in docs/AUDIO_ENGINE.md 7 and waits for its own issue once the flag numbers settle.
| rack-standard (signal order, class bands, hygiene racks as stdlib hook defs, `.hook()`, audit tool; docs/RACK_STANDARD.md) | hooks-core, track-demo-night-phonk | built (critic pending) | #94 |
| sound-standard (measured per-genre and per-role acceptance: `tools/racks/measure.mjs` BS.1770 / Tech 3342 / true peak / spectral / onsets / duck, `docs/genres/*.json` with basis per number, `--score`; docs/RACK_STANDARD.md 8) | rack-standard | built (critic pending; example render open) | #125 |
| daw-survey + refactor-plan (docs/DAW_SURVEY.md, docs/REFACTOR_PLAN.md) | issues-protocol | built (critic pending) | #95 |
| mixer-read-model (R1: channel strips derived from the lane graph, `site/engine/mixer-model.js`) | lanes-audio, lanes-consumers | built (critic pending) | #95 |
| strip-meters (R2: per-strip peak / RMS / LUFS in the CLI manifest and on the site; `strudel lanes --mixer`) | mixer-read-model, audio-engine-measurements | issued | #96 |
| take-lanes (R3: recipes grouped per lane and range, comp list) | mixer-read-model, lanes-capture | issued | #97 |
| freeze-by-hash (R4) | take-lanes, lanes-capture | issued | #98 |
| project-time-model (R5: project@1, tempo map, markers, DAWproject export) | strip-meters, take-lanes | issued | #99 |
| summing-groups + delay-compensation (R6: `.group`, strip latency) | mixer-read-model | issued | #100 |
| transactional-undo (R7: one undo stack over model ops) | project-time-model | issued | #101 |
| groove (`pat.groove`: MPC swing, push/pull, seeded humanize, drift; stdlib `groove-*` presets; docs/CONVENTIONS.md 4) | hooks-core, rack-standard | built (critic pending) | #109 |
| concept-framework (`tools/concepts/families/*.json` -> pack ingredients, plain catalog recipes, Syntax section, audit targets; add-a-concept checklist) | pack-spec, atoms-core, rack-standard | built (critic pending) | #110 |
| hiphop-trap-hyphy components + forms (racks-hiphop, `hh.` atoms and form gates) | concept-framework, groove | built (critic pending) | #111 |
| dovetailing (`dt.` pickup / rise / hit / tail gates, masks, equal-power fades, moves fadeOut, fadeIn, throw, tailHold, duckUnder) | concept-framework, hooks-core, lanes-events | built (critic pending) | #111 |
| feel-templates (slots drums/top/bass/harmony/fx/groove as atoms@1 ingredients; pick = one import, override = one bind) | hiphop-trap-hyphy components + forms, groove, pack-kind-atoms | built (critic pending) | #112 |
| composition-catalog (111 concepts, 19 families, docs/COMPOSITION.md; tools/composition -> site/data/composition.json in the Syntax view, both forms verified) | concept-framework, lowering (#117), taxonomy (#120) | built (critic pending) | #144 |
| composition-research (docs/COMPOSITION_RESEARCH.md: per-genre producer-reported components and forms, cited, UNVERIFIED marked) | - | built (critic pending) | #145 |
| composer-tools (suno-track-lab engine/composer: ledger, density, foreshadow, scan, feel, discord, layers, cluster-bars) | composition-catalog, motifs analysis, CLI events, spectral_align | built (critic pending) | #146 |
| composer-skill (workflow + design-choice checks, both repos) | composer-tools, composition-catalog | built (critic pending) | #147 |
| composition-research pass 2 (open SOS Inside Track, Point Blank, Ableton, Hooktheory, OMT, Reddit threads) | composition-research | unexplored | - |
| composer: audio motif ledger from stems (engine/motifs motifs.json -> ledger), groove-from-audio presets | composer-tools, groove-from-audio | scouted | - |
| dnb-electro references + genre targets (docs/DNB_ELECTRO_REFERENCES.md; suno-track-lab docs/genres dnb / electro / house.json, master presets dnb / electro / house) | edm-core references | built (critic pending) | #121 |
| dnb / electro / house-techno-trance-big-room components, forms, tension grammar (pack glyphcore/dnb-electro: racks-dnb-electro, `dnb.` `el.` `hs.` atoms; per-role classes break, gate; multi-pack builder) | concept-framework, edm-core foundations, rack-standard | built (critic pending) | #122 |
| breakbeat chops (synthesised amen / think-style kits; slice orders for `.bite(16, ...)`, same order as `.slice` on a sample) | dnb components | built (critic pending) | #122 |
| feel templates liquid, neuro, jump-up, electro-house, techno, trance, big-room (grooves composed from groove-swing, groove-push, groove-human) | feel-templates, dnb / electro / house components | built (critic pending) | #123 |
| dnb-electro tutorial track + electro and house examples (lesson per section, standalone + pack versions, master + genre score) | dnb / electro / house components, feel templates | built (critic pending) | #124 |
| more concept families (drill, jersey club, footwork, dancehall, amapiano log drums, lo-fi, garage / 2-step, breakcore, psytrance; groove templates extracted from audio) | concept-framework | unexplored | - |
| groove-from-audio (onset offsets of a reference stem -> a groove table / preset) | groove, motifs analysis | unexplored | - |
| wam-plugin-hosting (WAM 2 effects on returns) | summing-groups + delay-compensation | unexplored | - |
| glitch-free-text-diff (unchanged lanes keep sounding through an edit, Glicol-style) | audio-engine-measurements | unexplored | - |

## Waiting nodes
- refactor (#95-#101): build order R1 (#95, built) -> R2 (#96) -> R3 (#97) and R6 (#100) on disjoint files -> R4 (#98) -> R5 (#99) -> R7 (#101). Design: docs/REFACTOR_PLAN.md; survey: docs/DAW_SURVEY.md. R2's site half and R6 wait for the engine seam of docs/AUDIO_ENGINE.md.
- rack standard (#94): every new rack names its class (`["hook", "hygiene-<class>"]`) and is listed in tools/racks/targets.json; a new class is an entry in tools/racks/standard.json plus a hygiene def.
- live-mic-input: Strudel has no live input; needs browser/Node audio capture and an AGPL licence-decision issue before touching Strudel code (do not copy PR #1414). Size L. Waits for #14 and that decision.
- resynthesis: own design (STFT partial tracking + additive render -> WAV -> sample map), size L; waits for #16 to settle the shared STFT/mask helpers. No Harmor copying.
- vocal-chop-slicer (user stems -> slice map): slicer #4 accepted; next after #39. Size M.
- word-mapped-vocals (needs vocal-chop-slicer #4): #42 (P1 word bank), #43 (word()/note), #44 (intellisense provider), #45 (formant pyworld/rubberband ext), #46 (Shabda TTS) are built; two vocal banks ship on the site with `voxBank()`. Formant variants and TTS clips are build-time flags of `wordbank.sh` and are not in the shipped banks; `word(...).formant(true)` is built (#57). State: built.
- sung-word-bank (needs word-mapped-vocals): `voxBank('sung')`, 200 English words sung at d#3 a3 d#4 a4 d#5, rendered offline by `engine/vocals/build_sung_bank.py` with SoulX-Singer (Apache-2.0) and a VocalSet timbre prompt (CC BY 4.0); no .NET. OpenUtau / DiffSinger dropped for licence reasons, the ONNX pipeline is written down in engine/vocals/SUNG.md for a future open voicebank (state: scouted). State: built, #79, waits for the critic and an owner listening pass.
- stem-export-presets: low value now that #36/#40 cover mixdown; scouted only.
- hooks toolkit (#47-#55): build order #47 -> #48 -> #49, then #50 / #51 / #53 on disjoint files, then #54, then UI #52 and #55 via ui-designer. Design: docs/HOOKS_SYNTAX.md, docs/BLUEPRINT.md. The CLI parts live in the engine/strudel-cli that tests/smoke.sh calls, outside this repo.
- atoms (#61-#64): build order #61, then #62 and #63 on disjoint files, then UI #64 via ui-designer. The pack-ingredient box of #63 follows docs/PACK_SPEC.md 5.1 (kind `atoms`). Design: docs/ATOMS.md.
- content packs (#65-#71): build order #65, then #67 and #68 in parallel (site files vs CLI repo, disjoint), then #69 (needs #66 and, for vox, owner approval), #70 after #65 with examples from #69, #71 after #67. Design: docs/PACK_SPEC.md.
- lanes (#74-#78): build order #74, then #75, then #76; #77 alongside from #74 on; UI #78 via ui-designer last. First box of #75 to settle: the bus reader seam (docs/LANES.md open question 1). Design: docs/LANES.md.
- feels (#109-#112): build order #109 (engine) and #110 (builder) -> #111 (content) -> #112 (feel templates); a new family or feel follows docs/CONVENTIONS.md section 7 and needs no code.
| craftcues-format (score annotations in bars: sidecar .craftcues + inline //@, schema, lint, merge, WebVTT / SRT, KB resolver; docs/CRAFTCUES.md) | lanes, comment-masker (#142), composition-catalog | built (critic pending) | #162 |
| craftcues-site (captions strip synced to the transport, KB cards, Score sheet, quick play captions, Resources Cues, Record .vtt) | craftcues-format, resources-pane (#160), quick-play (#150) | built (critic pending) | #163 |
| craftcues-examples-integration (night phonk v2 / dubstep / dnb cue sets, composer + genre score --cues, form-bank cues, audio page captions) | craftcues-format, form-bank (#153) | built (critic pending) | #164 |
