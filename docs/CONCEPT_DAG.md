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
| mod-matrix (LFO/envelope -> any param, cross-layer) | issues-protocol | issued | #11 |
| time-volume-gating (Gross Beat-style) | envelope-follower-ducking, slicer | issued | #12 |
| follow-actions-clip-launching | issues-protocol | issued | #13 |
| offline-bounce-resample-loop | local-samples-ir-bounce | issued | #14 |
| live-mic-input | offline-bounce-resample-loop, licence-decision (AGPL) | scouted | - |
| convolution-ir-reverb | local-samples-ir-bounce | accepted (Strudel `ir`, via #2) | #2 |
| spectral-resonator | spectral-freeze-paulstretch | issued | #16 |
| resynthesis (Harmor-like additive) | spectral-freeze-paulstretch, spectral-resonator | scouted | - |
| sidechain-multiband-dynamics | envelope-follower-ducking | issued | #15 |

## Waiting nodes
- live-mic-input: Strudel has no live input; needs browser/Node audio capture and an AGPL licence-decision issue before touching Strudel code (do not copy PR #1414). Size L. Waits for #14 and that decision.
- resynthesis: own design (STFT partial tracking + additive render -> WAV -> sample map), size L; waits for #16 to settle the shared STFT/mask helpers. No Harmor copying.
