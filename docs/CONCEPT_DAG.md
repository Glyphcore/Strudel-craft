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
| live-sampling-resampling | local-samples-ir-bounce | unexplored | - |
| convolution-spectral-fx | local-samples-ir-bounce, spectral-freeze-paulstretch | unexplored | - |
| resynthesis (Harmor-like additive) | spectral-freeze-paulstretch | unexplored | - |
| sidechain-multiband-dynamics | envelope-follower-ducking | unexplored | - |
