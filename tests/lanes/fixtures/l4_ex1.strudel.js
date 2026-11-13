drums: s("bd*4, hh*8").lpf(4000)
  .split(dry => dry,
         wet => wet.room(0.9).rsize(6).lpf(900),
         grit => grit.crush(5).hpf(2000).gain(0.4))
