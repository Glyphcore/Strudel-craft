// == Sirocco Foundry: house into wet industrial dubstep, C minor, 140 bpm, 128 bars = 3:39 (issue #136) ==================================
// A full-length piece, not a lesson. Feel and production approach only (big-room Italo / French house energy, then a wet industrial halftime drop);
// nothing here follows the melody, samples or arrangement of an existing song, and there are no words. Every element is UNLISTENED: it was written
// against measurements (README.md), nobody has heard it.
// One cycle = one bar of 4/4, so setcpm(140/4). Bars are 1-based: bar N starts at cycle N-1.
// Map:  intro 1-16 | build 17-32 | drop 1 (house) 33-56 | breakdown 57-72 | drop 2 (industrial halftime) 73-96 | drop 3 (both worlds) 97-112 | outro 113-128
// Buses (Strudel orbits): 1 drums and FX (never ducked), 2 bass (kick-ducked), 3 music with a room (kick-ducked), 4 the wet industrial bus (own reverb, ducked).
// Gates: the `tagged("#lane").mute(...)` block at the end is the arrangement (generated from the table in build.mjs: `node docs/tracks/sirocco-foundry/build.mjs`).
// Lines ending in //@craft are the Craft form only (the vox sample bank); the //@plain lines are their synthesised twins that carry the same pattern into
// track.standalone.strudel.js. Seed: the owner's own growl voice (README.md), kept in character as hook "seedGrowl".
setcpm(140/4)
atoms.import("pack:glyphcore/edm:atoms-edm-core")
atoms.import("pack:glyphcore/edm:atoms-dubstep")
await voxBank('vocalset')                                                                                         //@craft

// == the shared motif: the seed rhythm [c2@3 c2] [~ eb2] [c2@2 g1@2] ~ on the roots of the 8-bar loop Cm Ab Eb Bb Cm Ab Fm G ==
atom("sfSeed", { type: "mini", body: "<[[c2@3 c2] [~ eb2] [c2@2 g1@2] ~] [[ab1@3 ab1] [~ c2] [ab1@2 eb2@2] ~] [[eb2@3 eb2] [~ g2] [eb2@2 bb1@2] ~] [[bb1@3 bb1] [~ d2] [bb1@2 f2@2] ~] [[c2@3 c2] [~ eb2] [c2@2 g1@2] ~] [[ab1@3 ab1] [~ c2] [ab1@2 eb2@2] ~] [[f1@3 f1] [~ ab1] [f1@2 c2@2] ~] [[g1@3 g1] [~ b1] [g1@2 d2@2] ~]>" })
atom("sfDrop", { type: "mini", body: "<[[c2@3 c2] [~ eb2] [c2@2 g1@2] ~] [[c2@3 c2] [~ eb2] [c2@2 g1@2] ~] [[c2@3 c2] [~ eb2] [c2@2 g1@2] ~] [[c2@3 c2] [~ db2] [c2@2 db2@2] ~]>" })
atom("sfRoots", { type: "mini", body: "<c2 ab1 eb2 bb1 c2 ab1 f1 g1>" })
atom("sfSubD", { type: "mini", body: "<c1 c1 c1 db1>" })
atom("sfStab", { type: "mini", body: "<[eb4,g4,bb4,c5] [eb4,g4,ab4,c5] [eb4,g4,bb4,d5] [d4,f4,bb4,c5] [eb4,g4,bb4,c5] [eb4,g4,ab4,c5] [c4,f4,ab4,c5] [b3,d4,f4,g4]>" })
atom("sfPad", { type: "mini", body: "<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,d4] [bb2,d3,f3,ab3] [c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [f2,ab2,c3,eb3] [g2,b2,d3,f3]>" })
atom("sfVoxPad", { type: "mini", body: "<[c4,g4] [ab3,eb4] [eb4,bb4] [bb3,f4] [c4,g4] [ab3,eb4] [f4,c5] [g3,d4]>" })
atom("sfArp", { type: "mini", body: "<[c4 eb4 g4 bb4]*4 [ab3 c4 eb4 g4]*4 [eb4 g4 bb4 d5]*4 [bb3 d4 f4 bb4]*4 [c4 eb4 g4 bb4]*4 [ab3 c4 eb4 g4]*4 [f4 ab4 c5 f5]*4 [g3 b3 d4 f4]*4>" })
atom("sfHook", { type: "mini", body: "<[g4 ~ ~ bb4 ~ ~ c5 ~ bb4 ~ ~ g4 ~ ~ ~ ~] [ab4 ~ ~ c5 ~ ~ eb5 ~ c5 ~ ~ ab4 ~ ~ ~ ~] [g4 ~ ~ bb4 ~ ~ d5 ~ bb4 ~ ~ g4 ~ ~ ~ ~] [f4 ~ ~ bb4 ~ ~ d5 ~ c5 ~ bb4 ~ ~ ~ ~ ~] [g4 ~ ~ bb4 ~ ~ c5 ~ bb4 ~ ~ g4 ~ ~ ~ ~] [ab4 ~ ~ c5 ~ ~ eb5 ~ c5 ~ ~ ab4 ~ ~ ~ ~] [f4 ~ ~ ab4 ~ ~ c5 ~ ab4 ~ ~ f4 ~ ~ ~ ~] [g4 ~ ~ b4 ~ ~ d5 ~ b4 ~ g4 ~ ~ ~ ~ ~]>" })
atom("sfHookB", { type: "mini", body: "<[g4 ~ bb4 ~ c5 ~ eb5 ~ c5 ~ bb4 ~ g4 ~ ~ ~] [ab4 ~ c5 ~ eb5 ~ g5 ~ eb5 ~ c5 ~ ab4 ~ ~ ~] [bb4 ~ d5 ~ eb5 ~ g5 ~ eb5 ~ d5 ~ bb4 ~ ~ ~] [bb4 ~ d5 ~ f5 ~ d5 ~ c5 ~ bb4 ~ f4 ~ ~ ~] [g4 ~ bb4 ~ c5 ~ eb5 ~ c5 ~ bb4 ~ g4 ~ ~ ~] [ab4 ~ c5 ~ eb5 ~ g5 ~ eb5 ~ c5 ~ ab4 ~ ~ ~] [f4 ~ ab4 ~ c5 ~ f5 ~ c5 ~ ab4 ~ f4 ~ ~ ~] [g4 ~ b4 ~ d5 ~ g5 ~ f5 ~ d5 ~ b4 ~ g4 ~]>" })
atom("sfAnswer", { type: "mini", body: "<[~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ g4 bb4 c5 bb4] [~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ab4 c5 eb5 c5] [~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ g4 bb4 c5 eb5] [~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ db5 c5 bb4 g4]>" })
atom("sfDisco", { type: "mini", body: "x ~ ~ x ~ ~ x ~ x ~ ~ x ~ ~ x ~" })
atom("sfStabA", { type: "mini", body: "x ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ x ~" })
atom("sfStabB", { type: "mini", body: "~ x ~ ~ x ~ ~ ~ x ~ ~ x ~ ~ ~ x" })
atom("sfClap", { type: "mini", body: "~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~" })
atom("sfMetal", { type: "mini", body: "<[~ ~ ~ x ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~] [~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ x ~ ~] [~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ x] [~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~ ~]>" })
atom("sfHpfIn", { type: "mini", body: "<2600 2200 1800 1500 1200 1000 800 650 520 420 340 270 220 190 160 140>" })
atom("sfHpfOut", { type: "mini", body: "<140 170 210 260 330 420 540 700>" })
atom("sfFadeOut", { type: "mini", body: "<1!8 .85 .7 .55 .42 .3 .2 .12 .06>" })

// == voices: the owner's seed bass in two guises, plus the industrial metal hit ==
// seed (as given): note("[c2@3 c2] [~ eb2] [c2@2 g1@2] ~").s("supersaw").fm(2.57).fmh(7.82).vowel("a").hpf(189).lpf(619).lpsync(4).lpdepth(1.02).attack(0.005).sustain(0.63).release(0.258).distort(1.37).distortvol(0.665).gain(0.26)
hooks.def("seedGrowl", { chain: [["hook", "hygiene-growl"], ["s", "supersaw"], ["fm", 2.57], ["fmh", 7.82], ["vowel", "a"], ["hpf", 189], ["lpf", 619], ["lpsync", 4], ["lpdepth", 1.02], ["attack", 0.005], ["sustain", 0.63], ["release", 0.258], ["distort", 1.37], ["distortvol", 0.665], ["gain", 0.26]] })
// house bassline: the same voice low-passed and mono, the fundamentals live in a separate sine sub
hooks.def("seedHouse", { chain: [["hook", "hygiene-growl"], ["s", "supersaw"], ["fm", 1.4], ["fmh", 7.82], ["spread", 0], ["hpf", 120], ["lpf", 460], ["attack", 0.005], ["sustain", 0.63], ["release", 0.258], ["distort", 0.9], ["distortvol", 0.8], ["gain", 0.26]] })
hooks.def("metalHit", { chain: [["hook", "hygiene-perc"], ["s", "sine"], ["fm", 9], ["fmh", 1.41], ["fmdecay", 0.2], ["attack", 0.001], ["decay", 0.35], ["sustain", 0], ["hpf", 600], ["lpf", 9000], ["gain", 0.3]] })

hooks.def("voxChop", { chain: [["hook", "hygiene-vox"], ["end", 0.3], ["hpf", 300], ["lpf", 4200], ["gain", 0.32]] })
hooks.def("voxPad", { chain: [["hook", "hygiene-vox"], ["attack", 0.6], ["release", 1.5], ["vowel", "o"], ["lpf", 2400], ["gain", 0.36]] })

// == drums ==
kick: s("x*4").hook("edmKick").shape(0.5).duckorbit("2:3:4").duckdepth("0.35:0.3:0.3").duckattack("0.28:0.36:0.36").postgain(0.515)
kickH: s(atoms.ds.halfKick2).hook("dsKick").shape(0.55).duckorbit("2:3:4").duckdepth("0.5:0.35:0.35").duckattack("0.15:0.3:0.3").postgain(0.607)
clap: s(atoms.sfClap).hook("edmClap").room(0.2).orbit(1).velocity("<1!32 .72!8 .88!8 1!88>").postgain(1.232)
snareH: s(atoms.ds.halfSnare).hook("dsSnare").shape(0.3).room(0.25).postgain(0.361)
ghost: s(atoms.ds.ghostSnare).hook("snareTight").velocity(0.3).postgain(2.025)
hats: s(atoms.ec.hats16).velocity(atoms.ec.accent16).hook("hatClosed").groove({ swing: 57, jitter: 3, vel: 0.15, seed: 2 }).velocity("<1!32 .72!8 .88!8 1!88>").postgain(0.879)
ohat: s(atoms.ec.offHats).hook("hatOpen").groove({ swing: 57, jitter: 2, seed: 5 }).velocity("<1!32 .72!8 .88!8 1!88>").postgain(1.879)
hatsH: s(atoms.ds.dsHats).velocity(atoms.ds.dsHatVel).hook("hatClosed").postgain(0.866)
hats16H: s(atoms.ds.hats16).velocity(atoms.ds.hat16Vel).hook("hatClosed").postgain(1.049)
roll: s(atoms.ec.roll8).velocity(atoms.ec.rollVel8).hook("snareTight").mask(atoms.ec.gapMask).postgain(0.595)
roll4: s(atoms.ec.roll4).velocity(atoms.ec.rollVel4).hook("snareTight").postgain(0.653)
fill: s("x*16").velocity(saw.range(0.3, 1)).hook("snareTight").postgain(0.314)
perc: s(atoms.sfMetal).hook("metalHit").note("<g5 d6 eb6 bb5>").orbit(4).room(0.55).roomsize(5).groove({ swing: 55, jitter: 3, seed: 9 }).postgain(1.102)

// == transitions: risers, reverse tails, impacts ==
rise1: s("x").slow(16).hook("noiseRiser(27.43)").postgain(1.82)
rise2: s("x").slow(4).clip(0.9375).hook("hpBuild(6.86)").postgain(0.367)
pitch2: s("x").slow(4).clip(0.9375).hook("pitchRiser(6.86)").postgain(0.54)
rev: s("x").hook("reverseSwell(1.71)").postgain(0.68)
down: s("x").hook("downSweep").orbit(1)
impact: s("x").hook("impactBoom").postgain(0.188)
crash: s("x").hook("crash").postgain(0.358)
metalTail: s("x").note("c5").hook("metalHit").orbit(4).room(0.9).roomsize(8).decay(1.4)

// == bass ==
seedH: note(atoms.sfSeed).hook("seedHouse").orbit(2).compressor("-30:12:3:0.002:0.08").velocity("<1!32 .72!8 .88!8 1!88>").postgain(0.88)
seedHm: note(atoms.sfSeed).hook("seedHouse").orbit(2).mask(atoms.ds.notLastOf4).compressor("-30:12:3:0.002:0.08").postgain(0.73)
subH: note(atoms.sfRoots).hook("subSine").orbit(2).postgain(0.398)
seedG: note(atoms.sfDrop).hook("seedGrowl").shape(0.3).crush(11).orbit(2).compressor("-30:12:3:0.002:0.08").postgain(0.354)
growl2: note(atoms.sfDrop).fast(2).hook("seedGrowl").vowel("<a o e i>").lpsync(8).lpdepth(1.5).shape(0.3).crush(11).orbit(2).compressor("-30:12:3:0.002:0.08").postgain(0.073)
growlR: note(atoms.sfDrop).hook("seedGrowl").shape(0.3).crush(11).orbit(2).mask(atoms.ds.lastOf4).compressor("-30:12:3:0.002:0.08").postgain(0.532)
subD: note(atoms.sfSubD).hook("subSine").orbit(2).postgain(0.662)

// == music ==
disco: note(atoms.sfStab).struct(atoms.sfDisco).hook("ukfPluck").hpf(atoms.sfHpfIn).orbit(3).room(0.25).roomsize(3).postgain(0.947)
discoOut: note(atoms.sfStab).struct(atoms.sfDisco).hook("ukfPluck").hpf(atoms.sfHpfOut).orbit(3).room(0.25).roomsize(3).postgain(0.864)
stabsB: note(atoms.sfStab).struct(atoms.sfStabA).hook("superChord").lpf(atoms.ec.open8).hpf(atoms.ec.thin8).orbit(3).room(0.25).roomsize(3).postgain(2.174)
stabs1: note(atoms.sfStab).struct(atoms.sfStabA).hook("superChord").orbit(3).room(0.25).roomsize(3).postgain(0.899)
stabs2: note(atoms.sfStab).struct(atoms.sfStabB).hook("superChord").orbit(3).room(0.25).roomsize(3).postgain(0.899)
stabsUp: note(atoms.sfStab).add(note(12)).struct(atoms.sfStabB).hook("superChord").mask(atoms.ds.notLastOf4).orbit(3).room(0.25).roomsize(3).postgain(0.809)
closeS: note(atoms.sfStab).struct(atoms.sfStabA).hook("superChord").lpf(isaw.range(250, 9000)).orbit(3).room(0.25).roomsize(3).postgain(1.272)
pad: note(atoms.sfPad).hook("atmosPad").orbit(3).room(0.35).roomsize(4).postgain(0.959)
padD: note(atoms.sfPad).hook("atmosPad").orbit(3).room(0.35).roomsize(4).postgain(1.107)
padP: note("<[c3,g3,bb3,eb4] [c3,g3,bb3,eb4] [c3,g3,bb3,eb4] [c3,g3,bb3,db4]>").hook("atmosPad").orbit(3).room(0.35).roomsize(4).postgain(0.979)
fpad: s("vs_o").note(atoms.sfVoxPad).hook("voxPad").orbit(3).room(0.4).roomsize(5).postgain(0.065)                                //@craft
//@plain fpad: s("sawtooth").note(atoms.sfVoxPad).hook("voxPad").orbit(3).room(0.4).roomsize(5).postgain(0.065)
chop: note(atoms.sfHook).s("<vs_a!4 vs_o!4>").hook("voxChop").orbit(3).room(0.3).roomsize(3).postgain(0.283)                           //@craft
//@plain chop: note(atoms.sfHook).hook("vowelChop").orbit(3).room(0.3).roomsize(3).postgain(1.126)
chopB: note(atoms.sfHookB).s("<vs_a!4 vs_o!4>").hook("voxChop").orbit(3).room(0.3).roomsize(3).postgain(0.265)                         //@craft
//@plain chopB: note(atoms.sfHookB).hook("vowelChop").orbit(3).room(0.3).roomsize(3).postgain(1.055)
chopA: note(atoms.sfAnswer).s("<vs_a vs_o>").hook("voxChop").orbit(4).room(0.5).roomsize(4).postgain(0.408)                            //@craft
//@plain chopA: note(atoms.sfAnswer).hook("vowelChop").orbit(4).room(0.5).roomsize(4).postgain(1.628)
arp: note(atoms.sfArp).hook("ukfArp").orbit(3).room(0.3).roomsize(3).postgain(0.457)
screech: note(atoms.ds.screechLine).hook("screechLead").orbit(4).room(0.4).roomsize(4)
air: s("white").hook("hygiene-texture").hpf(6500).lpf(13500).gain(0.4).orbit(3).velocity("<1!32 .72!8 .88!8 1!88>").postgain(1.4)
tex: s("pink").hook("hygiene-texture").gain(0.12).lpf(sine.slow(8).range(900, 5000)).orbit(4).room(0.5).roomsize(5).postgain(3.15)

// == arrangement (generated: node docs/tracks/sirocco-foundry/build.mjs gates) ==
//@gates-begin
tagged("#kick").mute("1b..9b, 32b..33b, 57b..97b, @121b")
tagged("#kickH").mute("1b..73b, @97b")
tagged("#clap").mute("1b..17b, 32b..33b, 57b..97b, @117b")
tagged("#snareH").mute("1b..73b, @97b")
tagged("#ghost").mute("1b..77b, @97b")
tagged("#hats").mute("32b..33b, 57b..97b, @125b")
tagged("#ohat").mute("1b..9b, 32b..33b, 57b..97b, @121b")
tagged("#hatsH").mute("1b..73b, @89b")
tagged("#hats16H").mute("1b..89b, @97b")
tagged("#roll").mute("1b..25b, 33b..65b, @73b")
tagged("#roll4").mute("1b..13b, @17b")
tagged("#fill").mute("1b..48b, 49b..56b, 57b..96b, 97b..112b, @113b")
tagged("#perc").mute("1b..61b, @97b")
tagged("#rise1").mute("1b..17b, @33b")
tagged("#rise2").mute("1b..69b, @73b")
tagged("#pitch2").mute("1b..69b, @73b")
tagged("#rev").mute("1b..16b, 17b..96b, @97b")
tagged("#down").mute("1b..57b, 58b..113b, @114b")
tagged("#impact").mute("1b..33b, 34b..73b, 74b..97b, @98b")
tagged("#crash").mute("1b..33b, 34b..49b, 50b..73b, 74b..89b, 90b..97b, 98b..113b, @114b")
tagged("#metalTail").mute("1b..57b, @58b")
tagged("#seedH").mute("1b..17b, 32b..33b, 57b..113b, @117b")
tagged("#seedHm").mute("1b..97b, @113b")
tagged("#subH").mute("1b..25b, 32b..33b, 57b..97b, @117b")
tagged("#seedG").mute("1b..73b, @89b")
tagged("#growl2").mute("1b..89b, @97b")
tagged("#growlR").mute("1b..97b, @113b")
tagged("#subD").mute("1b..73b, @97b")
tagged("#disco").mute("@17b")
tagged("#discoOut").mute("1b..117b, @125b")
tagged("#stabsB").mute("1b..17b, @33b")
tagged("#stabs1").mute("1b..37b, 49b..113b, @117b")
tagged("#stabs2").mute("1b..49b, @56b")
tagged("#stabsUp").mute("1b..97b, @112b")
tagged("#closeS").mute("1b..56b, 57b..112b, @113b")
tagged("#pad").mute("1b..17b, 33b..57b, 73b..117b, @129b")
tagged("#padD").mute("1b..33b, 57b..97b, @113b")
tagged("#padP").mute("1b..73b, @97b")
tagged("#fpad").mute("1b..25b, 33b..57b, 73b..105b, 113b..121b, @129b")
tagged("#chop").mute("1b..13b, 17b..41b, 49b..69b, 73b..97b, 105b..121b, @125b")
tagged("#chopB").mute("1b..49b, 57b..105b, @113b")
tagged("#chopA").mute("1b..73b, @97b")
tagged("#arp").mute("1b..49b, 57b..65b, 73b..97b, @113b")
tagged("#screech").mute("1b..89b, @97b")
tagged("#tex").mute("1b..57b, 97b..121b, @129b")
tagged("#air").mute("1b..17b, 32b..33b, 57b..73b, @121b")
//@gates-end
