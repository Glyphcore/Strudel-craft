setcpm(140/4)
atoms.import("pack:glyphcore/edm:atoms-dubstep")
growl: note(atoms.ds.growlLine).s("sawtooth").fm(2).fmh(1).fmdecay(0.25).fmsustain(0.3).vowel("<a o>").lpf(3200).attack(0.005).gain(0.4)
  .split(lo => lo.lpf(100),                                     // fundamental stays clean
         hi => hi.hpf(100).distort(2.5).postgain(0.45).lpf(9000)) // drive the mids, scope the top after the drive
sub: note(atoms.ds.subLine).hook("subSine")
