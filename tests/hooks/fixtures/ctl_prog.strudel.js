// @daw bars=4
$: note("c3*4").s("sawtooth").lpf(ctl("cutoff", { type: "knob", min: 200, max: 8000, default: 800 }))
