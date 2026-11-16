// DnB tutorial (#124): F minor, 174 bpm, 128 bars = 2:56.6. One lesson per section (README.md); every technique is in the open:
// sidechain (glyphcore/edm sidechain on the kick, orbit 2 ducked), filter moves (gated binds), risers / impacts / gap on gates, bus glue on the mid-bass.
// Every voice is native (no shape / distort / supersaw AudioWorklet stage) so the headless CLI renders it in reasonable time (#140).
// intro 1-16 | build 17-24 | drop 1 (liquid) 25-56 | breakdown 57-72 | build 2 73-80 | drop 2 (neuro) 81-112 | halftime 113-120 | outro 121-128
setcpm(174 / 4)
atoms.import("pack:glyphcore/dnb-electro:atoms-dnb")
atoms.import("pack:glyphcore/edm:atoms-edm-core")
// racks: pack:glyphcore/dnb-electro:racks-dnb-electro, pack:glyphcore/edm:racks-edm-core

// == grooves: liquid half organic, neuro half locked (gated binds on one slot per voice group) ==
hooks.bind("feel", "groove-swing(54) | groove-human(2.5, 0.15, 1)", atoms.dnb.liquidPart); hooks.bind("feel", "groove-human(0.5, 0.05, 1)", atoms.dnb.neuroPart)
hooks.bind("gfeel", "groove-swing(54) | groove-human(2.5, 0.15, 3) | groove-push(3)", atoms.dnb.liquidPart); hooks.bind("gfeel", "groove-human(0.5, 0.05, 3)", atoms.dnb.neuroPart)

// == filter moves: the intro is dark and thin, the builds thin the low end, the drops open everything ==
hooks.bind("tone", [["lpf", 700]], atoms.dnb.intro); hooks.bind("tone", "thinBuild", atoms.dnb.builds)
hooks.bind("btone", [["hpf", 700]], "<17b"); hooks.bind("btone", [["lpf", 1800]], "69b..73b"); hooks.bind("btone", [["hpf", 260]], atoms.dnb.drop2)
hooks.bind("rtone", "filterBuild", atoms.dnb.build2)                               // the reese opens over build 2

// == chops: one chop order on every break lane, chosen by section ==
hooks.bind("chop", [["bite", 16, { $mini: atoms.dnb.chops }]], "69b..73b, 89b..113b"); hooks.bind("chop", [["bite", 16, { $mini: atoms.dnb.chopsWild }]], atoms.dnb.build2)

// == transitions: riser ends on the drop, impact on it, crash marks the phrase, downlifter into the quiet parts ==
hooks.bind("rise", "noiseRiser(11)", "17b..25b, 73b..81b"); hooks.bind("hit", "subDrop", "25b..26b, 81b..82b")
hooks.bind("crash", "crash", "25b..26b, 41b..42b, 81b..82b, 97b..98b, 121b..122b"); hooks.bind("sweep", "downSweep", "57b..58b, 113b..114b")

// == drums ==
kick: s(atoms.dnb.kick).hook("dnbKick | sidechain(2, 0.5, 0.12)").use("feel").tags("drums", "two")
snare: s(atoms.dnb.snare).hook("dnbSnare").use("feel").tags("drums", "two")
ghostL: s(atoms.dnb.ghosts).velocity(atoms.dnb.ghostVel).hook("ghostSnare").use("gfeel").tags("drums", "liquid")
ghostN: s(atoms.dnb.ghostsRoll).velocity(atoms.dnb.ghostVel).hook("ghostSnare").use("gfeel").tags("drums", "neuro")
shaker: s(atoms.dnb.shaker).velocity(atoms.dnb.shakerVel).hook("dnbShaker | groove-swing(54) | groove-human(2.5, 0.15, 4)").tags("drums", "liquid")
ride: s(atoms.dnb.hats).velocity(atoms.dnb.rideVel).hook("ride | groove-swing(54) | groove-human(2.5, 0.15, 5)").tags("drums")
hat: s(atoms.dnb.hats).hook("dnbHat | groove-human(0.5, 0.05, 6)").tags("drums", "neuro")
halfK: s(atoms.dnb.halfKick).hook("dnbKick | sidechain(2, 0.5, 0.12)").tags("drums", "half")
halfS: s(atoms.dnb.halfSnare).hook("dnbSnare").room(0.2).tags("drums", "half")
roll: s(atoms.ec.roll8).velocity(atoms.ec.rollVel8).hook("dnbSnare").postgain(0.6).tags("roll")
roll4: s(atoms.ec.roll4).velocity(atoms.ec.rollVel4).hook("ghostSnare").tags("roll4")

// == the break: amen-style kit, cut and re-sequenced by the chop slot, toned by section ==
brkK: s(atoms.dnb.amenKick).hook("breakKick").use("chop").use("btone").tags("break")
brkS: s(atoms.dnb.amenSnare).velocity(atoms.dnb.amenVel).hook("breakSnare").use("chop").use("btone").tags("break")
brkR: s(atoms.dnb.hats).velocity(atoms.dnb.rideVel).hook("ride").use("chop").use("btone").tags("break")

// == low end: a mono sine sub owns 40-120 Hz; mid layers start at 70-100 Hz and share a glued bus (multiband by layers) ==
sub: note(atoms.dnb.sub).hook("dnbSub").orbit(3).tags("low")
subN: note(atoms.dnb.neuro).hook("dnbSub").orbit(3).tags("lowN")
subW: note(atoms.dnb.wobble).hook("dnbSub").orbit(3).tags("lowW")
rolling: note(atoms.dnb.rolling).hook("rollingBass").velocity(0.8).orbit(2).tags("mid")
reese: note(atoms.dnb.sub).add(note("0,0.18")).hook("reese").use("rtone").orbit(2).tags("mid")   // the reese is a pair of saws 18 cents apart
neuro: note(atoms.dnb.neuro).hook("neuroBass").orbit(2).tags("mid")
wobble: note(atoms.dnb.wobble).hook("jumpWobble").orbit(2).tags("mid")

// == harmony and top: everything on orbit 2 is ducked by the kick ==
keys: note(atoms.dnb.chords).struct(atoms.dnb.comp).hook("liquidRhodes").use("tone").orbit(2).tags("wet")
pad: note(atoms.dnb.chords).hook("liquidPad").use("tone").orbit(2).tags("wet")
strings: note(atoms.dnb.strings).hook("strings").use("tone").orbit(2).tags("wet")
chops: note(atoms.dnb.chop).vowel(atoms.dnb.chopVowel).hook("vocalChop").delay(0.3).delaytime(0.259).delayfeedback(0.35).orbit(2).tags("wet")

// == fx ==
rise: s("x/8").use("rise", { else: "silence" }).tags("rise")
hit: s("x").use("hit", { else: "silence" }).note("f1").tags("fx")
crash: s("x").use("crash", { else: "silence" }).tags("fx")
sweep: s("x").use("sweep", { else: "silence" }).tags("fx")

// == buses ==
verb: ret("verb").room(1).rsize(4).hpf(250).lpf(6000).orbit(8)
bassbus: ret("bassbus").compressor("-22:4:6:.005:.12").gain(0.6).orbit(9)
tagged("wet").send("verb", 0.3); tagged("mid").send("bassbus", 0.5)

// == arrangement: lanes are muted outside their sections (selections, never copies) ==
tagged("two").mute("<25b, 57b..81b, 113b..121b"); tagged("liquid").mute("<25b, 57b..121b"); tagged("neuro").mute("<81b, @113b")
tagged("#ride").mute("<41b, @57b"); tagged("half").mute("<113b, @121b"); tagged("roll").mute("<17b, @25b"); tagged("roll4").mute("<77b, @81b")
tagged("break").mute("<9b, 17b..69b, 81b..89b, @113b")
tagged("low").mute("<25b, 57b..65b, 73b..97b, 113b..121b, @125b"); tagged("lowN").mute("<81b, @97b"); tagged("lowW").mute("<113b, @121b")
tagged("#rolling").mute("<41b, @57b"); tagged("#reese").mute("<73b, 81b..97b, @113b"); tagged("#neuro").mute("<81b, @97b"); tagged("#wobble").mute("<113b, @121b")
tagged("#keys").mute("57b..97b, 113b..121b"); tagged("#pad").mute("81b..97b"); tagged("#strings").mute("<9b, 25b..41b, 73b..97b, @113b")
tagged("#chops").mute("<33b, 73b..105b, @113b")
tagged("!rise").mute(atoms.dnb.vacuum)                                            // the gap: half a bar of nothing but the riser before each drop
