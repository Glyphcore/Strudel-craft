// @daw bars=4
hooks.def("murk", [["lpf", 400]])
$: s("sine").struct(tap("pads/kick:onset")).use("fx")
