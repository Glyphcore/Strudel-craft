// Night phonk v2: G minor, VI-i-VII-VI, half-time on a 128.8 bpm grid, 84 bars = 2:37; pump, confrontation, drop/relief contrast
// intro 1-8 | build 9-16 | drop A (confrontation) 17-32 | relief 1 33-40 | stop > drop B 41-52 | relief 2 53-60 | build 61-64 | drop C 65-80 | outro 81-84
setcpm(128.8 / 4)
await voxBank('ljspeech'); await voxBank('sung'); await voxBank('call-me-baby'); await voxBank('vocalset')

// == glyphcore/phonk (pack): v1 and v2 atoms and racks ==
atoms.import("pack:glyphcore/phonk:atoms")
atoms.import("pack:glyphcore/phonk:atoms-v2")
// racks: glyphcore/phonk:racks + racks-v2 (hooks@1), loaded as the hooks config of this program

// == track: racks into slots, gated moves ==
hooks.bind("kick", "kick808"); hooks.bind("snare", "snareNoise"); hooks.bind("hat", "hat"); hooks.bind("bell", "cowbell"); hooks.bind("sub", "sub808")
hooks.bind("pad", "hazePad"); hooks.bind("ctr", "echoPluck"); hooks.bind("rise", "riser"); hooks.bind("rev", "reverseHit"); hooks.bind("hit", "impact")
hooks.bind("vox", "chop"); hooks.bind("voxpad", "formant"); hooks.bind("tex", "tape"); hooks.bind("tom", "tom"); hooks.bind("rim", "rimshot")
hooks.bind("lead", "deepLead"); hooks.bind("groove", [["swingBy", 0.16, 4]], atoms.ph2.dropB); hooks.bind("kfeel", [["struct", { $mini: "x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~" }]], atoms.ph2.dropB)
hooks.bind("tone", "murk", atoms.ph2.dark); hooks.bind("tone", "thin", atoms.ph2.builds); hooks.bind("tone", "slam", atoms.ph2.slams)
hooks.bind("drive", "grit(0.7)", atoms.ph2.drops); hooks.bind("tone", "hush", atoms.ph2.reliefs); hooks.bind("pump", "pumpHard(0.8)", atoms.ph2.drops)
hooks.bind("voxpad", "swellPad", atoms.ph2.relief2); hooks.bind("tone", "open", atoms.ph2.relief2)

// == macros ==
ctl("macro", { type: "knob", min: 0, max: 1, default: 1 }); ctl("space", { type: "knob", min: 0, max: 1, default: 0.5 })
ctl("grit", { type: "knob", min: 0, max: 1, default: 0.5 }); ctl("energy", { type: "knob", min: 0, max: 1, default: 0.5 })
hooks.map("macro", "lpf", { range: [0.1, 1], curve: "exp", op: "mul" }); hooks.map("space", "room", { range: [0, 2], op: "mul" })
hooks.map("space", "room", { range: [0, 3.2], op: "mul" }, atoms.ph2.reliefs)
hooks.map("grit", "shape", { range: [0, 2], op: "mul" }); hooks.map("energy", "velocity", { range: [0.6, 1.4], op: "mul" })

// == lanes ==
kick: s(atoms.ph.kick).use("kfeel").use("kick").use("pump").velocity(1).tags("drums", "low")
heart: s(atoms.ph2.heart).use("kick").velocity(0.35).lpf(300).tags("relief")
snare: s(atoms.ph.snare).use("snare").velocity(1).room(0.25).tags("drums")
ghost: s(atoms.ph.ghost).use("snare").velocity(0.22).tags("drums")
stut: s(atoms.ph2.stut).use("snare").velocity(saw.range(0.4, 1)).tags("conf")
roll: s(atoms.ph.roll).use("snare").velocity(saw.range(0.25, 1).slow(2)).tags("roll")
hats: s(atoms.ph.hats).use("hat").velocity(atoms.ph.accent).nudge(rand.range(0, 0.006)).swingBy(0.06, 8).use("groove").postgain(0.6).tags("drums")
perc: stack(note(atoms.ph2.toms).use("tom"), s(atoms.ph2.rim).use("rim")).tags("conf")
bell: note(atoms.ph.bell).add(note("0,6.8")).use("bell").orbit(7).tags("conf", "wet")
stab: note(atoms.ph2.stab).add(note("0,6.8")).use("bell").velocity(1.1).orbit(7).tags("conf", "wet")
chime: note(atoms.ph.bell).slow(2).add(note("0,6.8")).use("bell").velocity(0.35).lpf(2500).orbit(7).tags("relief", "wet")
sub: note(atoms.ph.sub).penv(atoms.ph2.slides).use("sub").use("drive").orbit(3).tags("bass")
pad: note(atoms.ph.chords).use("pad").lpf(sine.slow(16).range(900, 1800)).use("tone").pan(0.5).orbit(4).tags("harm", "wet")
lead: note(atoms.ph.lead).use("lead").use("tone").use("drive").room(0.3).orbit(5).tags("melody", "wet")
ctr: note(atoms.ph.counter).use("ctr").use("tone").orbit(6).tags("conf", "wet")
voxpad: s("<vs_o_pp vs_a_pp>/2").note("<g4 d4>/2").use("voxpad").use("tone").orbit(4).tags("vox", "wet")
vox: stack(word("<ay ee>").struct(atoms.ph.ghost).use("vox").end(0.12).tags("conf"),
  word("air").struct(atoms.ph.lastBar).attack(0.45).release(0.05).speed(0.8).hpf(500).gain(0.3),
  word("breath").note("d#4").struct("<~ ~ ~ [~ ~ ~ x]>").gain(0.25)).tags("vox", "wet")
rise: s(atoms.ph2.rise).use("rise").tags("rise")
rev: s(atoms.ph.lastBar).use("rev").tags("rev", "pre")
hit: s("x").use("hit").room(0.4).tags("hit")
tex: stack(s("pink, brown").use("tex"), s("white*8").degradeBy(0.6).attack(0.002).decay(0.015).sustain(0).hpf(2500).gain(rand.range(0.02, 0.07))).tags("tex")
verb: ret("verb").room(1).rsize(5).hpf(200).lpf(5000).orbit(8)
glue: ret("glue").compressor("-24:4:6:.01:.15").gain(0.5).orbit(9)

// == arrangement and mix: selections, not copies ==
tagged("drums").mute(atoms.ph2.noDrums); tagged("low").mute(atoms.ph2.noKick); tagged("#sub").mute(atoms.ph2.noSub)
tagged("conf").mute(atoms.ph2.noConf); tagged("relief").mute(atoms.ph2.noRelief); tagged("#pad | #ctr").mute(atoms.ph2.dropB)
tagged("roll").mute(atoms.ph2.noRoll); tagged("rise").mute(atoms.ph2.noRise); tagged("rev").mute(atoms.ph2.noRev); tagged("hit").mute(atoms.ph2.noHit)
tagged("!pre").mute(atoms.ph2.vac)
tagged("wet").send("verb", 0.35); tagged("low | bass").send("glue", 0.35)
