# Concept DAG
Owned by the `daw-sme` agent. State: unexplored -> scouted -> designed -> issued -> built -> accepted.

| node | depends on | state | issue |
|---|---|---|---|
| issues-protocol | - | accepted | #1 |
| local-samples-ir-bounce | issues-protocol | accepted | #2 |
| warp-formant (rubberband) | local-samples-ir-bounce | built | #3 |
| slicer | local-samples-ir-bounce | issued | #4 |
| spectral-freeze-paulstretch | local-samples-ir-bounce | issued | #5 |
| envelope-follower-ducking | issues-protocol | issued | #6 |
| granulator | local-samples-ir-bounce | issued | #7 |
| vocoder | issues-protocol | issued | #8 |
| external-renderers-sf2-ks | local-samples-ir-bounce | issued | #9 |
