a: s("bd*4").split(x => x.tap("inner").lpf(500))
b: s("hh*8").gain(tap("inner:env"))
