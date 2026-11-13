// @daw bars=2
$: note("c1*2").s("sine").tap("k")
$: note("c3*4").s("sawtooth").gain(0.5).wire("gain", "k:env", { range: [1, 0.3], op: "mul" })
