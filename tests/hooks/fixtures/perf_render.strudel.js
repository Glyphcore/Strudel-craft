// @daw bars=4
hooks.def("murk", [["lpf", 400]])
$: note("c3 e3").s("sawtooth").struct(tap("pads/kick:onset")).use("fx")
$: note("c2*2").s("sine").use("fx")
