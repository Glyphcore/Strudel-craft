// == Velvet Static (Craft form, source of truth) =============================================================================
// Sentimental liquid drum and bass over night-phonk floats. 174 bpm throughout (setcpm(174/4): one cycle = one 4/4 bar),
// F minor, 160 bars = 3:41. Written for this repo (docs/tracks/velvet-static/README.md); no lyrics, nothing copied from a song.
// Every audible element is UNLISTENED (nobody has heard it; the numbers in the README are measurements, not taste).
//
//  bars   section        what
//   1-16  intro (float)  cloud pad, "ooh", halftime soft kick + hats, lead motif stated (filter opens over 16 bars)
//  17-32  build 1        rolling hats, snarl filtered in, sub swells, 8-bar snare roll, riser, half-bar silence on 32
//  33-64  drop 1 (Fm)    two-step kick, snare + ghosts, shuffled hats, sub + snarl, pad, lead call, syllable-chop answer; variation at 49
//  65-88  float (Ab)     halftime wavephonk: cloud pad, vocal-style lead, rim + hat rolls, snarl nearly out; Eb to D7 pivot at 87-88
//  89-96  build 2 (Gm)   halftime drums, then doubled; pitch rise; riser; roll
//  97-128 drop 2 (Gm)    drop 1 a whole tone up, lead carries the melody, ghosts denser, keys, snarl forward in 121-128
// 129-144 bridge (Gm)    halftime again: ooh pad + lead + thin drums, filters close
// 145-160 outro          pad and ooh to silence (fade written as data)
//
// Harmony (2 bars each): Fm9 | Dbmaj9 | Abmaj9 | Ebmaj7 (i VI III VII). Pad voicings (no thirds under 200 Hz, nothing below C4) keep Eb on top
// and move by one or two semitones; the roots live in the sub. Float: Ab major (I V vi IV = Ab Eb Fm Db). Lift: the whole drop a tone up (Gm),
// pivot Eb to D7 to Gm with the voicing [eb g bb d] -> [f# a c d] -> [f a bb d].
// Master bus: every lane ends in .dry(0).send("master", 1); the last line is the return with the compressor (see the end of the file).
// Buses (Strudel orbits): 1 drums (dry, never ducked), 2 bass (sub + snarl, ducked by the kick), 3 music (ducked lightly), 4 snare room, 5 fx.
setcpm(174 / 4)
await voxBank('sung'); await voxBank('vocalset')
atoms.import("pack:glyphcore/edm:atoms-edm-core")
atoms.import("pack:glyphcore/phonk:atoms")
atoms.import("pack:glyphcore/phonk:atoms-v2")

// == arrangement helpers (plain JS: gates as data) ==
const SEC = { intro: [1, 16], build1: [17, 32], drop1: [33, 64], float: [65, 88], build2: [89, 96], drop2: [97, 128], bridge: [129, 144], outro: [145, 160] }
const rl = (f) => { const r = []; for (let i = 0; i < 160;) { let j = i; while (j < 160 && f(j) === f(i)) j++; r.push(j - i > 1 ? f(i) + '!' + (j - i) : '' + f(i)); i = j } return '<' + r.join(' ') + '>' }
const on = (...ns) => { const a = Array(160).fill(0); for (const n of ns) { const [s, e = s] = SEC[n] || String(n).match(/\d+/g).map(Number); for (let i = s; i <= e; i++) a[i - 1] = 1 } return rl((i) => a[i]) }
const hole = (...bs) => rl((i) => (bs.includes(i + 1) ? '[1 0]' : '1'))   // second half of these bars is silent (the breath before a drop)
const fall = (hz, ...bs) => rl((i) => (bs.includes(i + 1) ? Math.round(hz * 0.4) : bs.includes(i + 2) ? Math.round(hz * 0.7) : hz))   // filter closes into these bars
const TR = "<0!96 2!64>"   // drop 2, bridge, outro sit a whole tone up (Gm)
const H = hole(32, 96)
const fade = (from) => rl((i) => (i >= from - 1 ? Math.max(0, 1 - (i - from + 2) / 16).toFixed(2) : 1))   // 16-bar fade to silence, as data
const lv = (a, b) => rl((i) => (i < 16 ? a : i < 128 ? 1 : i < 144 ? b : Math.max(0, 1 - (i - 143) / 16).toFixed(2)))   // level data: intro a, bridge b, outro fades out
const swell = rl((i) => (i >= 24 && i < 32 ? (0.3 + 0.1 * (i - 24)).toFixed(2) : 1))

// == atoms (declared once) ==
atom("vs.chords", { type: "mini", body: "<[eb4,g4,ab4,c5]!2 [eb4,f4,ab4,c5]!2 [eb4,g4,bb4,c5]!2 [eb4,g4,bb4,d5]!2>" })
atom("vs.chordsRel", { type: "mini", body: "<[eb4,g4,bb4,c5]!2 [eb4,g4,bb4,d5]!2 [eb4,g4,ab4,c5]!2 [eb4,f4,ab4,c5]!2>" })
atom("vs.pivot", { type: "mini", body: "<[eb4,g4,bb4,d5] [f#4,a4,c5,d5]>" })
atom("vs.chordsB2", { type: "mini", body: "<[f4,a4,bb4,d5]!2 [f4,g4,bb4,d5]!2 [eb4,g4,bb4,d5]!2 [f#4,a4,c5,d5]!2>" })
atom("vs.ooh", { type: "mini", body: "<c5 c5 c5 d5>/2" })
atom("vs.oohR", { type: "mini", body: "<c5 d5 c5 c5>/2" })
atom("vs.sub", { type: "mini", body: "<[f1@6 ~@2 f1@2 ~@2 f2@2 f1@2] [f1@6 ~@2 f1@4 ~@2 ab1@2] [db2@6 ~@2 db2@2 ~@2 db3@2 db2@2] [db2@6 ~@2 db2@4 ~@2 ab1@2] [ab1@6 ~@2 ab1@2 ~@2 ab2@2 ab1@2] [ab1@6 ~@2 ab1@4 ~@2 bb1@2] [eb2@6 ~@2 eb2@2 ~@2 eb3@2 eb2@2] [eb2@6 ~@2 eb2@2 ~@2 f2@2 c2@2]>" })
atom("vs.subR", { type: "mini", body: "<[ab1@12 ~@2 eb2@2]!2 [eb2@12 ~@2 bb1@2]!2 [f1@12 ~@2 c2@2]!2 [db2@12 ~@2 ab1@2]!2>" })
atom("vs.subP", { type: "mini", body: "<[eb2@12 ~@2 bb1@2] [d2@12 ~@2 a1@2]>" })
atom("vs.snarl", { type: "mini", body: "<[[f2@3 f2] [~ ab2] [f2@2 c2@2] ~]!2 [[db2@3 db2] [~ f2] [db2@2 ab1@2] ~]!2 [[ab2@3 ab2] [~ c3] [ab2@2 eb2@2] ~]!2 [[eb2@3 eb2] [~ g2] [eb2@2 bb1@2] ~]!2>" })
atom("vs.motif", { type: "mini", body: "[x@3 x] [~ x] [x@2 x@2] ~" })
atom("vs.lead", { type: "mini", body: "<[c5@3 eb5 ~@2 f5@2 eb5@2 c5@2 ~@4] [ab4@6 ~@2 bb4@2 c5@2 ~@4] [db5@6 c5@2 ab4@4 ~@4] [ab4@2 c5@2 db5@4 eb5@4 ~@4] [c5@3 eb5 ~@2 g5@2 eb5@2 c5@2 ~@4] [bb4@6 ~@2 c5@2 eb5@2 ~@4] [d5@6 bb4@2 g4@4 ~@4] [bb4@2 d5@2 f5@4 eb5@4 ~@4]>" })
atom("vs.leadR", { type: "mini", body: "<[eb5@6 c5@2 ab4@4 c5@4] [eb5@4 f5@2 eb5@2 c5@8] [d5@6 bb4@2 g4@4 bb4@4] [bb4@4 d5@4 eb5@8] [c5@6 ab4@2 f4@4 ab4@4] [c5@4 eb5@2 c5@2 ab4@8] [db5@6 c5@2 ab4@4 f4@4] [ab4@4 c5@4 db5@4 eb5@4]>" })
atom("vs.leadP", { type: "mini", body: "<[g4@4 bb4@4 d5@8] [c5@4 a4@4 f#4@4 ~@4]>" })
atom("vs.kick", { type: "mini", body: "<[x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~]!3 [x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ x ~]>" })
atom("vs.kickB", { type: "mini", body: "<[x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~] [x ~ ~ ~ ~ ~ ~ x ~ ~ x ~ ~ ~ ~ ~] [x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~] [x ~ ~ ~ ~ ~ ~ x ~ ~ x ~ ~ ~ x ~]>" })
atom("vs.kickG", { type: "mini", body: "<~ [~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~] ~ [~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~]>" })
atom("vs.snare", { type: "mini", body: "[~ x ~ x]" })
atom("vs.snareF", { type: "mini", body: "[~ ~ x ~]" })
atom("vs.sgA", { type: "mini", body: "<[~ ~ ~ ~ ~ ~ x ~ ~ x ~ ~ ~ ~ x ~] [~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x] [~ ~ ~ ~ ~ ~ x ~ ~ x ~ ~ ~ ~ ~ x] [~ ~ x ~ ~ ~ x ~ ~ x ~ x ~ ~ x x]>" })
atom("vs.sgB", { type: "mini", body: "<[~ ~ x ~ ~ ~ x ~ ~ x ~ ~ ~ x x ~] [~ ~ ~ x ~ ~ x x ~ ~ ~ x ~ ~ x x] [~ x ~ ~ ~ ~ x ~ ~ x ~ x ~ ~ x ~] [~ ~ x ~ ~ x x ~ ~ x ~ x ~ x x x]>" })
atom("vs.fill", { type: "mini", body: "[~ [x*8]]" })
atom("vs.hats", { type: "mini", body: "x*16" })
atom("vs.roll32", { type: "mini", body: "[~ ~ ~ x*8]" })
atom("vs.hats32", { type: "mini", body: "<[~ x*2 ~ ~ ~ x ~ ~ ~ x*2 ~ ~ x ~ ~ ~] [~ ~ x ~ ~ x*2 ~ ~ ~ ~ x ~ ~ ~ x*2 ~] [~ x ~ ~ ~ ~ x*2 ~ ~ x ~ ~ ~ ~ x ~] [~ ~ ~ x*2 ~ x ~ ~ ~ x*2 ~ ~ ~ x ~ x]>" })
atom("vs.hatv", { type: "mini", body: "[.85 .3 .55 .3 .75 .3 .55 .4]*2" })
atom("vs.oh", { type: "mini", body: "[~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~]" })
atom("vs.hatF", { type: "mini", body: "<x*8!3 [x x x x x x [x x] [x x x]]>" })
atom("vs.hatFv", { type: "mini", body: "[1 .5 .75 .5]*2" })
atom("vs.keys", { type: "mini", body: "[~ ~ x ~ ~ ~ x ~ ~ ~ x ~ x ~ ~ ~]" })
atom("vs.arp", { type: "mini", body: "<[eb5 c5 ab4 g4]*4!2 [eb5 c5 ab4 f4]*4!2 [eb5 c5 bb4 g4]*4!2 [d5 bb4 g4 eb4]*4!2>" })
atom("vs.tickF", { type: "mini", body: "<x*4!3 x*8>" })

// == racks (hooks.def; every chain starts at a hygiene class) bound into slots ==
hooks.def("velvetKick", { chain: [["hook", "hygiene-kick"], ["s", "sine"], ["freq", 50], ["attack", 0.001], ["penv", 34], ["pdecay", 0.045], ["decay", 0.34], ["sustain", 0], ["shape", 0.7], ["lpf", 3200], ["gain", 0.2]] })
hooks.def("velvetHeart", { chain: [["hook", "hygiene-kick"], ["s", "sine"], ["freq", 46], ["attack", 0.004], ["penv", 24], ["pdecay", 0.07], ["decay", 0.34], ["sustain", 0], ["shape", 0.4], ["lpf", 1500], ["gain", 0.3]] })
hooks.def("velvetSnare", { chain: [["hook", "hygiene-snare"], ["s", "triangle"], ["note", "f3"], ["noise", 0.8], ["attack", 0.001], ["decay", 0.19], ["sustain", 0], ["hpf", 170], ["lpf", 8500], ["shape", 0.6], ["gain", 0.5]] })
hooks.def("velvetSnareF", { chain: [["hook", "hygiene-snare"], ["s", "triangle"], ["note", "d3"], ["noise", 0.9], ["attack", 0.002], ["decay", 0.3], ["sustain", 0], ["hpf", 150], ["lpf", 6500], ["gain", 0.5]] })
hooks.def("velvetGhost", { chain: [["hook", "hygiene-snare"], ["s", "white"], ["attack", 0.001], ["decay", 0.07], ["sustain", 0], ["hpf", 700], ["lpf", 6500], ["gain", 0.8]] })
hooks.def("velvetHat", { chain: [["hook", "hygiene-hat"], ["s", "white"], ["hpf", 7500], ["lpf", 11500], ["decay", 0.045], ["sustain", 0], ["gain", 1.0]] })
hooks.def("velvetOpen", { chain: [["hook", "hygiene-hat"], ["s", "white"], ["hpf", 6500], ["lpf", 11000], ["decay", 0.16], ["sustain", 0], ["gain", 0.8]] })
hooks.def("velvetRim", { chain: [["hook", "hygiene-perc"], ["s", "white"], ["bpf", 2300], ["bpq", 3], ["attack", 0.001], ["decay", 0.03], ["sustain", 0], ["gain", 0.5]] })
hooks.def("velvetSub", { chain: [["hook", "hygiene-sub"], ["s", "sine"], ["attack", 0.006], ["decay", 0.3], ["sustain", 0.85], ["release", 0.09], ["shape", 0.4], ["lpf", 200], ["gain", 0.55]] })
hooks.def("velvetSub808", { chain: [["hook", "hygiene-sub"], ["s", "sine"], ["attack", 0.01], ["decay", 0.5], ["sustain", 0.8], ["release", 0.3], ["shape", 0.2], ["lpf", 180], ["gain", 0.45]] })
// the owner's seed voice (supersaw + FM + vowel + synced low-pass + distortion), band-limited to roughly 150-900 Hz
hooks.def("velvetSnarl", { chain: [["hook", "hygiene-growl"], ["s", "supersaw"], ["fm", 2.57], ["fmh", 7.82], ["vowel", "a"], ["hpf", 150], ["lpf", 900], ["lpsync", 4], ["lpdepth", 1.02], ["attack", 0.005], ["sustain", 0.63], ["release", 0.258], ["distort", 1.37], ["distortvol", 0.665], ["gain", 1.15]] })
hooks.def("velvetPad", { chain: [["hook", "hygiene-pad"], ["s", "supersaw"], ["unison", 5], ["detune", 0.2], ["spread", 0.9], ["attack", 0.35], ["sustain", 0.85], ["release", 1.2], ["lpf", 2600], ["shape", 0.4], ["gain", 0.25]] })
hooks.def("cloudPad", { chain: [["hook", "hygiene-pad"], ["s", "supersaw"], ["unison", 6], ["detune", 0.3], ["spread", 1], ["attack", 1.2], ["sustain", 0.9], ["release", 2.8], ["lpf", 1700], ["shape", 0.08], ["gain", 0.095]] })
hooks.def("silkLead", { chain: [["hook", "hygiene-lead"], ["s", "supersaw"], ["unison", 3], ["detune", 0.12], ["spread", 0.4], ["attack", 0.012], ["sustain", 0.75], ["release", 0.35], ["lpf", 3200], ["lpenv", 1.2], ["lpdecay", 0.3], ["vib", 5], ["vibmod", 0.12], ["gain", 0.45], ["shape", 0.4]] })
hooks.def("voxLead", { chain: [["hook", "hygiene-lead"], ["s", "supersaw"], ["unison", 2], ["detune", 0.1], ["vowel", "a"], ["attack", 0.03], ["sustain", 0.8], ["release", 0.5], ["lpf", 4200], ["vib", 5.5], ["vibmod", 0.2], ["gain", 0.75]] })
hooks.def("velvetChop", { chain: [["hook", "hygiene-vox"], ["clip", 1], ["attack", 0.004], ["release", 0.1], ["hpf", 260], ["lpf", 5200], ["gain", 0.16], ["shape", 0.4]] })
hooks.def("oohPad", { chain: [["hook", "hygiene-vox"], ["attack", 0.3], ["release", 0.9], ["lpf", 3000], ["gain", 0.22]] })
hooks.def("velvetKeys", { chain: [["hook", "hygiene-pluck"], ["s", "triangle"], ["attack", 0.003], ["decay", 0.3], ["sustain", 0], ["lpf", 2800], ["lpenv", 2], ["lpdecay", 0.18], ["gain", 0.25], ["shape", 0.4]] })
hooks.def("velvetArp", { chain: [["hook", "hygiene-arp"], ["s", "triangle"], ["attack", 0.003], ["decay", 0.16], ["sustain", 0], ["lpf", 3500], ["lpenv", 2], ["lpdecay", 0.12], ["gain", 0.25], ["shape", 0.4]] })
hooks.bind("kick", "velvetKick"); hooks.bind("heart", "velvetHeart"); hooks.bind("snare", "velvetSnare"); hooks.bind("snareF", "velvetSnareF"); hooks.bind("ghost", "velvetGhost")
hooks.bind("hat", "velvetHat"); hooks.bind("open", "velvetOpen"); hooks.bind("rim", "velvetRim"); hooks.bind("sub", "velvetSub"); hooks.bind("sub808", "velvetSub808")
hooks.bind("snarl", "velvetSnarl"); hooks.bind("pad", "velvetPad"); hooks.bind("cloud", "cloudPad"); hooks.bind("lead", "silkLead"); hooks.bind("vlead", "voxLead")
hooks.bind("chop", "velvetChop"); hooks.bind("ooh", "oohPad"); hooks.bind("keys", "velvetKeys"); hooks.bind("arp", "velvetArp")

// == drums (orbit 1, never ducked; the kick is the sidechain trigger for orbits 2 and 3) ==
kick: s(atoms.vs.kick).use("kick").orbit(1).duckorbit("2:3").duckdepth("0.3:0.3").duckattack("0.12:0.2").mask(on('33-48', '93-96')).mask(H).dry(0).send("master", 1)
kickB: s(atoms.vs.kickB).use("kick").orbit(1).duckorbit("2:3").duckdepth("0.3:0.3").duckattack("0.12:0.2").mask(on('49-64', '97-128')).mask(H).dry(0).send("master", 1)
kickG: s(atoms.vs.kickG).use("kick").velocity(0.4).orbit(1).mask(on('drop1', 'drop2')).mask(H).dry(0).send("master", 1)
heart: s(atoms.ph2.heart).use("heart").orbit(1).duckorbit("2:3").duckdepth("0.2:0.06").duckattack("0.2:0.3").mask(on('9-32', 'float', '89-92', '137-144')).mask(H).dry(0).send("master", 1)
snare: s(atoms.vs.snare).use("snare").orbit(4).room(0.2).roomsize(2).duckorbit("3").duckdepth(0.2).duckattack(0.12).mask(on('drop1', 'drop2', '93-96')).mask(H).dry(0).send("master", 1)
snareF: s(atoms.vs.snareF).use("snareF").orbit(4).room(0.45).roomsize(2).mask(on('13-16', '25-32', 'float', '89-92', '137-144')).mask(H).dry(0).send("master", 1)
ghost: s(atoms.vs.sgA).use("ghost").velocity(rand.range(0.3, 0.6)).orbit(4).room(0.15).roomsize(2).groove({ swing: 56, jitter: 4, vel: 0.2, seed: 5 }).mask(on('drop1')).mask(H).dry(0).send("master", 1)
ghost2: s(atoms.vs.sgB).use("ghost").velocity(rand.range(0.35, 0.7)).orbit(4).room(0.15).roomsize(2).groove({ swing: 56, jitter: 4, vel: 0.2, seed: 6 }).postgain(0.8).mask(on('drop2')).dry(0).send("master", 1)
fill: s(atoms.vs.fill).use("snare").velocity(saw.range(0.2, 0.5)).orbit(4).room(0.2).roomsize(2).postgain(0.5).mask(on(16, 40, 48, 56, 88, 104, 112, 120)).dry(0).send("master", 1)
stut: s(atoms.ph2.stut).use("snareF").velocity(0.7).orbit(4).room(0.3).roomsize(2).postgain(0.27).mask(on('65-86')).dry(0).send("master", 1)
roll: s(atoms.ec.roll8).velocity(atoms.ec.rollVel8).use("ghost").orbit(4).room(0.15).roomsize(2).postgain(0.4).mask(on('25-32', '89-96')).mask(H).dry(0).send("master", 1)
hats: s(atoms.vs.hats).use("hat").velocity(atoms.vs.hatv).groove({ swing: 56, jitter: 3, vel: 0.2, seed: 11 }).pan(0.56).mask(on('25-64', '93-128')).mask(H).dry(0).send("master", 1)
hroll: s(atoms.vs.roll32).use("hat").velocity(saw.range(0.2, 0.4)).pan(0.6).mask(on(40, 48, 56, 64, 104, 112, 120)).dry(0).send("master", 1)
hats32: s(atoms.vs.hats32).use("hat").velocity(0.45).groove({ swing: 56, jitter: 3, vel: 0.2, seed: 13 }).pan(0.62).mask(on('41-64', '97-128')).mask(H).dry(0).send("master", 1)
ohat: s(atoms.vs.oh).use("open").pan(0.42).mask(on('41-64', '97-128')).mask(H).dry(0).send("master", 1)
hatF: s(atoms.vs.hatF).use("hat").velocity(atoms.vs.hatFv).groove({ swing: 60, jitter: 4, vel: 0.25, seed: 3 }).pan(0.56).postgain(0.3).mask(on('5-24', 'float', '89-92', '137-144')).mask(H).dry(0).send("master", 1)
tick: s(atoms.vs.tickF).use("hat").velocity(0.35).pan(0.4).postgain(0.4).mask(on('17-24', '133-136')).dry(0).send("master", 1)
rim: s(atoms.ph2.rim).use("rim").velocity(0.3).pan(0.38).orbit(4).room(0.3).roomsize(2).mask(on('13-16', '73-88', '133-144')).dry(0).send("master", 1)

// == bass (orbit 2): sub under, the owner's snarl band-limited and mixed below it ==
sub: note(atoms.vs.sub).add(note(TR)).use("sub").orbit(2).mask(on('25-64', '97-128')).mask(H).velocity(swell).dry(0).send("master", 1)
subR: note(atoms.vs.subR).use("sub808").orbit(2).postgain(0.42).mask(on('65-86')).dry(0).send("master", 1)
subP: note(atoms.vs.subP).use("sub808").orbit(2).postgain(0.42).mask(on('87-88')).dry(0).send("master", 1)
snarl: note(atoms.vs.snarl).add(note(TR)).use("snarl").orbit(2).velocity("<.8!120 .95!8 .8!32>").lpf(fall(900, 64, 128)).late(0.011).mask(on('33-64', '97-128')).mask(H).dry(0).send("master", 1)
snarlB: note(atoms.vs.snarl).use("snarl").orbit(2).lpf(saw.range(250, 900).slow(8)).velocity(1.1).mask(on('25-32')).mask(H).dry(0).send("master", 1)
snarlF: note(atoms.vs.snarl).use("snarl").orbit(2).lpf(420).velocity(1).mask(on('77-86')).dry(0).send("master", 1)

// == harmony (orbit 3, one reverb and one delay for the whole bus) ==
cloud: note(atoms.vs.chords).add(note(TR)).use("cloud").orbit(3).room(0.55).roomsize(5).lpf(fall(1700, 144)).postgain(1.3).mask(on('intro', 'bridge', 'outro')).velocity(lv(0.42, 0.38)).dry(0).send("master", 1)
cloudR: note(atoms.vs.chordsRel).use("cloud").orbit(3).room(0.7).roomsize(5).postgain(0.8).mask(on('65-86')).dry(0).send("master", 1)
cloudP: note(atoms.vs.pivot).use("cloud").orbit(3).room(0.7).roomsize(5).mask(on('87-88')).dry(0).send("master", 1)
padB: note(atoms.vs.chords).use("pad").orbit(3).room(0.35).roomsize(5).lpf(atoms.ec.open8).postgain(1.8).mask(on('17-32')).mask(H).dry(0).send("master", 1)
padB2: note(atoms.vs.chordsB2).use("pad").orbit(3).room(0.4).roomsize(5).lpf(atoms.ec.open8).postgain(1.8).mask(on('89-96')).mask(H).dry(0).send("master", 1)
pad: note(atoms.vs.chords).add(note(TR)).use("pad").orbit(3).room(0.35).roomsize(5).lpf(fall(2600, 64, 128)).mask(on('33-64', '97-128')).mask(H).dry(0).send("master", 1)
keys: note(atoms.vs.chords).add(note(TR)).struct(atoms.vs.keys).use("keys").orbit(3).room(0.3).roomsize(5).postgain(0.7).late(0.007).mask(on('97-128')).dry(0).send("master", 1)
arp: note(atoms.vs.arp).add(note(TR)).use("arp").orbit(3).room(0.3).roomsize(5).delay(0.2).delaytime(0.2586).delayfeedback(0.35).groove({ swing: 56, jitter: 2, vel: 0.15, seed: 9 }).late(0.005).mask(on('41-64', '97-128')).mask(H).dry(0).send("master", 1)
ooh: s("<vs_o_pp vs_o_pp vs_o_pp vs_o_pp>/2").note(atoms.vs.ooh).add(note(TR)).use("ooh").orbit(3).room(0.5).roomsize(5).postgain(1.3).mask(on('3-16', '129-144')).velocity(lv(0.42, 0.38)).dry(0).send("master", 1)
oohA: s("vs_a_pp").note(atoms.vs.oohR).use("ooh").orbit(3).room(0.6).roomsize(5).postgain(0.42).mask(on('65-86')).dry(0).send("master", 1)

// foreshadowing (docs/COMPOSITION.md FS-01, FS-05, MOT-05): "teaser" = a filtered fragment of the motif in the build; "callback" = the motif in augmentation (slow(2)) in the outro
// == melody (orbit 3): one motif. The lead states it, the chop answers it an octave down, the snarl keeps its rhythm ==
leadI: note(atoms.vs.lead).add(note(TR)).use("lead").lpf(saw.range(1200, 6500).slow(16)).orbit(3).room(0.35).roomsize(5).delay(0.25).delaytime(0.2586).delayfeedback(0.35).postgain(1.3).mask(on('intro', 'bridge')).velocity(lv(0.42, 0.3)).dry(0).send("master", 1)
lead: note(atoms.vs.lead).add(note(TR)).use("lead").lpf(fall(6500, 64, 128)).orbit(3).room(0.3).roomsize(5).delay(0.25).delaytime(0.2586).delayfeedback(0.35).mask(on('33-36', '41-64', '97-128')).mask(H).dry(0).send("master", 1)
chop: note(atoms.vs.lead).sub(note(12)).add(note(TR)).s("vox_la vox_na vox_da vox_la").use("chop").orbit(3).room(0.4).roomsize(5).delay(0.25).delaytime(0.2586).delayfeedback(0.35).late(0.016).mask(on(37, 38, 39, 40, 45, 46, 47, 48, 53, 54, 55, 56, 61, 62, 63, 64, 101, 102, 103, 104, 109, 110, 111, 112, 117, 118, 119, 120, 125, 126, 127, 128)).mask(H).dry(0).send("master", 1)
teaser: note(atoms.vs.lead).linger(0.25).use("lead").lpf(900).velocity(0.6).orbit(3).room(0.5).roomsize(5).mask(on('25-31')).dry(0).send("master", 1)
callback: note(atoms.vs.lead).slow(2).add(note(TR)).use("lead").lpf(2200).velocity(0.7).orbit(3).room(0.6).roomsize(5).delay(0.25).delaytime(0.2586).delayfeedback(0.4).mask(on('145-152')).dry(0).send("master", 1)
voxl: note(atoms.vs.leadR).use("vlead").orbit(3).room(0.5).roomsize(5).delay(0.25).delaytime(0.2586).delayfeedback(0.3).postgain(0.42).mask(on('65-86')).dry(0).send("master", 1)
voxlP: note(atoms.vs.leadP).use("vlead").orbit(3).room(0.5).roomsize(5).postgain(0.42).mask(on('87-88')).dry(0).send("master", 1)

// == transitions and texture (orbit 5 fx reverb; never ducked) ==
riser: s("x").slow(16).hook("noiseRiser(22.07)").orbit(5).mask(on('17-32')).dry(0).send("master", 1)
riser2: s("x").slow(8).hook("noiseRiser(11.03)").orbit(5).mask(on('89-96')).dry(0).send("master", 1)
pitchUp: s("x").slow(8).hook("pitchRiser(11.03)").orbit(5).mask(on('89-96')).dry(0).send("master", 1)
rev: s("x").hook("reverseSwell(1.38)").orbit(5).mask(on(16, 64, 96, 128, 144)).dry(0).send("master", 1)
impact: s("x").hook("impactBoom").orbit(5).postgain(0.1).mask(on(33, 97)).dry(0).send("master", 1)
crash: s("x").hook("crash").orbit(5).postgain(0.15).mask(on(33, 49, 97, 129)).dry(0).send("master", 1)
down: s("x").hook("downSweep").orbit(5).mask(on(65, 89, 129, 145)).dry(0).send("master", 1)

// == the track's own bus stage (no limiter on the file): every lane is sent whole (dry 0) to one return that compresses the sum ==
// threshold -8 dB, ratio 20, no knee, 1 ms attack (the compressor looks ahead 6 ms), 80 ms release (the browser compressor adds its own make-up gain). It only squashes the peaks above the threshold: the drops; the floats stay under it.
master: ret("master").compressor("-8:20:0:0.001:0.08")
