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
| master-bus-chain-presets | loudness-metering-lufs, sidechain-multiband-dynamics | issued | #24 |
| arrangement-scene-timeline | follow-actions-clip-launching | issued | #25 |
| bug: midi import tempo map + track names | midi-clip-import-export | issued | #22 |
| bug: true-peak above 16 kHz | loudness-metering-lufs | issued | #23 |

## Waiting nodes
- live-mic-input: Strudel has no live input; needs browser/Node audio capture and an AGPL licence-decision issue before touching Strudel code (do not copy PR #1414). Size L. Waits for #14 and that decision.
- resynthesis: own design (STFT partial tracking + additive render -> WAV -> sample map), size L; waits for #16 to settle the shared STFT/mask helpers. No Harmor copying.
