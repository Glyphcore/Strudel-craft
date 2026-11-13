drums: s("bd*4, hh*8").split(d => d, w => w.room(0.8)).merge(m => m.compressor("-18:4:6:0.003:0.1")).gain(0.9)
