// Night phonk demo: G minor, VI-i-VII-VI, half-time feel on a 128.8 bpm grid, 80 bars = 2:29
// intro 1-8 | build 9-16 | drop 17-32 | breakdown 33-40 | build 2 41-48 | drop 2 49-72 | outro 73-80
setcpm(128.8 / 4)
await voxBank('ljspeech'); await voxBank('sung'); await voxBank('call-me-baby'); await voxBank('vocalset')

// == glyphcore/phonk (pack): atoms and racks ==
atoms.import("pack:glyphcore/phonk:atoms")
// racks: ingredient glyphcore/phonk:racks (hooks@1, site/data/phonk/racks.json), loaded as the hooks config of this program

// == track: racks into slots, gated moves ==
hooks.bind("kick", "kick808"); hooks.bind("snare", "snareNoise"); hooks.bind("hat", "hat"); hooks.bind("bell", "cowbell")
hooks.bind("sub", "sub808"); hooks.bind("pad", "hazePad"); hooks.bind("ctr", "echoPluck"); hooks.bind("rise", "riser")
hooks.bind("rev", "reverseHit"); hooks.bind("hit", "impact"); hooks.bind("vox", "chop"); hooks.bind("voxpad", "formant"); hooks.bind("tex", "tape")
hooks.slot("lead", { mode: "swap" }); hooks.bind("lead", "deepLead"); hooks.bind("lead", "wideLead", atoms.ph.drop2, { priority: 1 })
hooks.bind("tone", "murk", atoms.ph.dark); hooks.bind("tone", "thin", atoms.ph.builds); hooks.bind("drive", "grit(0.55)", atoms.ph.drop2); hooks.bind("duck", "pump")

// == macros ==
ctl("macro", { type: "knob", min: 0, max: 1, default: 1 }); ctl("space", { type: "knob", min: 0, max: 1, default: 0.5 })
ctl("grit", { type: "knob", min: 0, max: 1, default: 0.5 }); ctl("energy", { type: "knob", min: 0, max: 1, default: 0.5 })
hooks.map("macro", "lpf", { range: [0.1, 1], curve: "exp", op: "mul" }); hooks.map("space", "room", { range: [0, 2], op: "mul" })
hooks.map("grit", "shape", { range: [0, 2], op: "mul" }); hooks.map("energy", "velocity", { range: [0.6, 1.4], op: "mul" })

// == lanes ==
kick: s(atoms.ph.kick).use("kick").velocity(1).tap("kick", { export: true }).tags("drums", "low")
snare: s(atoms.ph.snare).use("snare").velocity(1).room(0.25).tags("drums")
ghost: s(atoms.ph.ghost).use("snare").velocity(0.22).tags("drums")
roll: s(atoms.ph.roll).use("snare").velocity(saw.range(0.25, 1).slow(2)).tags("drums", "roll")
hats: s(atoms.ph.hats).use("hat").velocity(atoms.ph.accent).nudge(rand.range(0, 0.006)).swingBy(0.06, 8).use("duck").tags("drums")
bell: note(atoms.ph.bell).add(note("0,6.8")).use("bell").use("duck").velocity(1).room(0.3).tags("bell", "wet")
sub: note(atoms.ph.sub).penv(atoms.ph.glide).use("sub").use("drive").orbit(3).tags("low")
pad: note(atoms.ph.chords).use("pad").lpf(sine.slow(16).range(900, 1800)).use("tone").pan(0.5).orbit(4).tags("harm", "wet")
lead: note(atoms.ph.lead).use("lead").use("tone").use("drive").room(0.3).tags("melody", "wet")
ctr: note(atoms.ph.counter).use("ctr").use("tone").use("duck").orbit(6).tags("melody", "counter", "wet")
voxpad: s("<vs_o_pp vs_a_pp>/2").note("<g4 d4>/2").use("voxpad").orbit(4).tags("vox", "wet")
chop: word("<ay ee>").struct("~ ~ x ~ ~ ~ ~ x").use("vox").use("duck").tags("vox", "wet", "chop")
swell: stack(word("air").struct(atoms.ph.lastBar).attack(0.45).release(0.05).speed(0.8).hpf(500).gain(0.3),
  word("breath").note("d#4").struct("<~ ~ ~ [~ ~ ~ x]>").gain(0.25)).tags("vox", "fx", "wet") // one lane for both: as two lanes they raise AudioNode errors on the site (#92)
rise: s(atoms.ph.every4).use("rise").tags("fx", "rise")
rev: s(atoms.ph.lastBar).use("rev").tags("fx", "rise")
hit: s(atoms.ph.every4).slow(4).use("hit").room(0.4).tags("fx", "hit")
tex: s("pink, brown").use("tex").tags("tex")
crackle: s("white*8").degradeBy(0.6).attack(0.002).decay(0.015).sustain(0).hpf(2500).gain(rand.range(0.02, 0.07)).tags("tex")
verb: ret("verb").room(1).rsize(5).hpf(200).lpf(5000).orbit(8)
glue: ret("glue").compressor("-24:4:6:.01:.15").gain(0.5).orbit(9)

// == arrangement and mix: selections, not copies ==
tagged("drums").mute(atoms.ph.noDrums); tagged("low").mute(atoms.ph.noLow); tagged("bell | counter | chop").mute(atoms.ph.noDrop)
tagged("roll").mute(atoms.ph.noRoll); tagged("rise").mute(atoms.ph.noRise); tagged("hit").mute("<17b, 18b..49b, 50b..")
tagged("wet").send("verb", 0.35); tagged("low").send("glue", 0.35)
