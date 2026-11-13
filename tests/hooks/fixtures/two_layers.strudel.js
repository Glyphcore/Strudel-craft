// @daw bars=4
hooks.def("dbl", [["ply", 2]])
hooks.bind("fx", "dbl", "@3b")
$: note("c2*2").s("sine").use("fx")
$: note("c3 e3").s("sine").gain(0.3)
