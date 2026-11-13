// @daw bars=3
hooks.def("duck", [["gain", 0.4]])
hooks.bind("fx", "duck", "@2b")
$: note("c3 e3").s("sine").use("fx")
