// House / techno / trance / big room example (#124): F minor, 128 bpm, 56 bars = 105 s, 8 bars per section (a real club track uses
// 16 / 32-bar blocks: atoms.hs.map*). intro (house) 1-8 | groove (techno) 9-16 | breakdown (trance) 17-24 | build 25-32 |
// drop (uplifting trance) 33-40 | drop 2 (big room) 41-48 | outro (house) 49-56. Trance is usually 136-140 bpm; here it shares 128.
setcpm(128 / 4)
atoms.import("pack:glyphcore/dnb-electro:atoms-house")
atoms.import("pack:glyphcore/edm:atoms-edm-core")
// racks: pack:glyphcore/dnb-electro:racks-dnb-electro, pack:glyphcore/edm:racks-edm-core

// == moves on gates ==
hooks.bind("open", "filterBuild", atoms.hs.build); hooks.bind("open", [["lpf", 900]], atoms.hs.breakdown)
hooks.bind("rise", "noiseRiser(15)", "25b..33b"); hooks.bind("rise2", "noiseRiser(3.75)", "39b..41b")
hooks.bind("hit", "impactBoom", "33b..34b, 41b..42b"); hooks.bind("crash", "crash", "9b..10b, 33b..34b, 41b..42b, 49b..50b"); hooks.bind("sweep", "downSweep", "17b..18b")
hooks.bind("kick", "houseKick | sidechain(3, 0.5, 0.14)", "<41b, @49b"); hooks.bind("kick", "bigKick | sidechain(3, 0.65, 0.16)", atoms.hs.drop2)
hooks.slot("kick", { mode: "swap" })

// == drums ==
kick: s(atoms.hs.kick).use("kick").tags("kick")
ohat: s(atoms.hs.offHat).hook("offHat").tags("drums")
clap: s(atoms.hs.clap).hook("houseClap | groove-swing(56) | groove-human(1, 0.1, 2)").tags("drums")
hats: s(atoms.hs.hats).velocity(atoms.hs.hatVel).hook("closedHat | groove-swing(56) | groove-human(1, 0.1, 3)").tags("hats")
ride: s(atoms.hs.offHat).hook("ride | groove-human(0.8, 0.08, 4)").tags("techno")
roll: s(atoms.ec.roll8).velocity(atoms.ec.rollVel8).hook("houseClap").tags("build")
roll2: s(atoms.ec.roll4).velocity(atoms.ec.rollVel4).hook("houseClap").postgain(0.7).tags("roll2")

// == bass: house offbeat, techno rolling + rumble, trance offbeat ==
bass: note(atoms.hs.bass).hook("houseBass | ducked(3)").tags("bass")
rolling: note(atoms.hs.rolling).hook("houseBass | groove-human(0.8, 0.08, 5)").velocity(0.8).tags("techno")
rumble: note(atoms.hs.rumble).hook("rumble").tags("techno")

// == harmony and lead ==
chords: note(atoms.hs.chords).hook("bigChords | ducked(3)").use("open").tags("chords", "wet")
gate: note(atoms.hs.chords).hook("gatePad | ducked(3)").tags("gate", "wet")
arp: note(atoms.hs.arp).hook("pluck | ducked(3)").delay(0.3).delaytime(0.352).delayfeedback(0.35).tags("arp", "wet")
lead: note(atoms.hs.lead).hook("roomLead | ducked(3)").tags("lead", "wet")

// == fx and buses ==
rise: s("x/8").use("rise", { else: "silence" }).tags("rise")
rise2: s("x/2").use("rise2", { else: "silence" }).tags("rise")
hit: s("x").use("hit", { else: "silence" }).note("f1").tags("fx")
crash: s("x").use("crash", { else: "silence" }).tags("fx")
sweep: s("x").use("sweep", { else: "silence" }).tags("fx")
verb: ret("verb").room(1).rsize(4).hpf(250).lpf(7000).orbit(8)
tagged("wet").send("verb", 0.3)

// == arrangement ==
tagged("kick").mute(atoms.hs.noKick); tagged("drums").mute("17b..25b"); tagged("hats").mute("17b..33b, 41b..49b"); tagged("techno").mute("<9b, @17b")
tagged("bass").mute("9b..33b, 41b..49b"); tagged("chords").mute("<17b, @33b"); tagged("gate").mute("<29b, @41b"); tagged("arp").mute("<17b, @41b")
tagged("lead").mute("<41b, @49b"); tagged("build").mute("<25b, @33b"); tagged("roll2").mute("<37b, @41b")
tagged("!rise").mute(atoms.hs.vacuum)
