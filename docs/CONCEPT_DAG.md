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
| model-schema-roundtrip (one JSON model; code <-> model <-> graph; docs/BLUEPRINT.md) | hooks-core, taps-vars-decorators | issued | #49 |
| component-library (versioned components, instances, history adapter) | model-schema-roundtrip | issued | #50 |
| hooks-intellisense (providers `hooks`, `model`) | hooks-core, intellisense-provider-registry | issued | #51 |
| graph-editor-ui (blueprint node editor; ui-designer) | model-schema-roundtrip, component-library | issued | #52 |
| pad-engine (beatpad banks, launch modes, scenes, looper, input-provider registry) | taps-vars-decorators, component-library | issued | #53 |
| controls-engine (control type registry, `ctl`, slider shim, mapping, automation lanes) | taps-vars-decorators, pad-engine | issued | #54 |
| perform-ui (pad banks + control boards, inline controls; ui-designer) | pad-engine, controls-engine | issued | #55 |
| intellisense-provider-registry (`window.strudelCraft.intellisense.register`, site) | behavioral-smoke-tests | scouted (in progress elsewhere, not on main) | - |
| history-store (`window.strudelCraft.history`) | behavioral-smoke-tests | scouted (not on main; interface needed is in docs/BLUEPRINT.md section 6) | - |
| webmidi-gamepad-input-providers | pad-engine | unexplored | - |

## Waiting nodes
- live-mic-input: Strudel has no live input; needs browser/Node audio capture and an AGPL licence-decision issue before touching Strudel code (do not copy PR #1414). Size L. Waits for #14 and that decision.
- resynthesis: own design (STFT partial tracking + additive render -> WAV -> sample map), size L; waits for #16 to settle the shared STFT/mask helpers. No Harmor copying.
- vocal-chop-slicer (user stems -> slice map): slicer #4 accepted; next after #39. Size M.
- word-mapped-vocals (needs vocal-chop-slicer #4): issued #42 (P1 word bank), #43 (word()/note), #44 (intellisense provider), #45 (formant pyworld/rubberband ext), #46 (Shabda TTS). State: issued.
- stem-export-presets: low value now that #36/#40 cover mixdown; scouted only.
- hooks toolkit (#47-#55): build order #47 -> #48 -> #49, then #50 / #51 / #53 on disjoint files, then #54, then UI #52 and #55 via ui-designer. Design: docs/HOOKS_SYNTAX.md, docs/BLUEPRINT.md. The CLI parts live in the engine/strudel-cli that tests/smoke.sh calls, outside this repo.
