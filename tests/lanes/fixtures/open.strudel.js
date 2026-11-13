// Lanes L1 fixture: open mode (default). Two lanes publish x, one reads another lane's unexported tap, two lanes share orbit 1 with different room sizes.
drums: s("bd*4, hh*8").tags("drums").tap("x").orbit(1).roomsize(2).room(0.3)
keys: note("c e g").s("piano").tags("keys", "wet").tap("x", { export: true }).orbit(1).roomsize(6).room(0.4)
bass: note("c2*4").s("sawtooth").gain(tap("drums/x:env"))
tagged("drums & !wet").fx(x => x.hpf(40))
tagged("#keys | wet").mute("3b..5b")
