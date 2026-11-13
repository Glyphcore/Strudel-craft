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
| pack-loader-site (`strudelCraft.packs`, kind adapters, precedence, lazy load, service-worker pack cache, pack sheet) | pack-spec, intellisense-provider-registry, controls-engine | issued | #67 |
| pack-loader-cli (`--packs`, `--pack`, install/verify/list, render.json credits, shared resolution module) | pack-spec | issued | #68 |
| core-pack-migration (site/data -> glyphcore/core on branch `packs`, shipped lock, deploy bundling; vox packs prepared, publish needs owner approval) | pack-loader-site, pack-loader-cli, licence-decision-pack-content | issued | #69 |
| pack-authoring (contributor guide, template layout, pack CI, registry CI) | pack-spec, core-pack-migration | issued | #70 |
| pack-code-sandbox (iframe sandbox host, per-kind RPC, hash-bound grants) | pack-loader-site | issued | #71 |
| pack-signatures (registry-side signing of manifests) | pack-spec | unexplored | - |
| pack-external-assets (hash-pinned remote sample files in sound maps) | pack-spec | unexplored | - |
| pack-kind-atoms (`atoms@1` ingredient kind and schema, docs/PACK_SPEC.md 5.1) | pack-spec, atoms-core | built | #63 |

## Waiting nodes
- live-mic-input: Strudel has no live input; needs browser/Node audio capture and an AGPL licence-decision issue before touching Strudel code (do not copy PR #1414). Size L. Waits for #14 and that decision.
- resynthesis: own design (STFT partial tracking + additive render -> WAV -> sample map), size L; waits for #16 to settle the shared STFT/mask helpers. No Harmor copying.
- vocal-chop-slicer (user stems -> slice map): slicer #4 accepted; next after #39. Size M.
- word-mapped-vocals (needs vocal-chop-slicer #4): #42 (P1 word bank), #43 (word()/note), #44 (intellisense provider), #45 (formant pyworld/rubberband ext), #46 (Shabda TTS) are built; two vocal banks ship on the site with `voxBank()`. Formant variants and TTS clips are build-time flags of `wordbank.sh` and are not in the shipped banks; `word(...).formant(true)` is not built (#57). State: built.
- stem-export-presets: low value now that #36/#40 cover mixdown; scouted only.
- hooks toolkit (#47-#55): build order #47 -> #48 -> #49, then #50 / #51 / #53 on disjoint files, then #54, then UI #52 and #55 via ui-designer. Design: docs/HOOKS_SYNTAX.md, docs/BLUEPRINT.md. The CLI parts live in the engine/strudel-cli that tests/smoke.sh calls, outside this repo.
- atoms (#61-#64): build order #61, then #62 and #63 on disjoint files, then UI #64 via ui-designer. The pack-ingredient box of #63 follows docs/PACK_SPEC.md 5.1 (kind `atoms`). Design: docs/ATOMS.md.
- content packs (#65-#71): build order #65, then #67 and #68 in parallel (site files vs CLI repo, disjoint), then #69 (needs #66 and, for vox, owner approval), #70 after #65 with examples from #69, #71 after #67. Design: docs/PACK_SPEC.md.
