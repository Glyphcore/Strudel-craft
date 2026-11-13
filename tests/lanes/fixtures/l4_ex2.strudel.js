drums: s("bd*4, ~ sd ~ sd").bank("RolandTR909").tap("hits", { export: true }).room(0.2)
bass:  note("c2*8").s("sawtooth").gain(tap("hits:env", { r: 0.2 }).range(1, 0.4))
lead:  note("c4 eb4 g4").s("square").struct(tap("hits:onset"))
hats:  s("hh*16").gain(tap("hits:gate").range(0.9, 0.5))
