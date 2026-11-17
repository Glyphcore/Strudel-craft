// GENERATED from track.strudel.js by tools/concepts/build.mjs (lowering, docs/LOWERING.md): plain Strudel, paste-ready for strudel.cc. Edit the Craft file, not this one.
// == EDM / dubstep tutorial (glyphcore/edm, CC0-1.0) ==========================================================================
// A track that teaches itself: every section is one lesson, and the music below the comment does what the comment says.
// The format nods to the narrated "dubstep tutorial" tracks of the early 2010s (docs/EDM_REFERENCES.md, Dubba Jonny rows);
// the lessons are our own. 104 bars at 140 bpm = 178 s. Map: README.md. The plain-Strudel copy (track.standalone.strudel.js)
// is generated from this file by tools/concepts/build.mjs (lowering, docs/LOWERING.md) and gives the same events.
//
// LESSON 0 - the grid. Dubstep sits at 138-142 bpm and feels half-time: the kick on the 1, the snare alone on beat 3, while hats
// keep the full 140 meter. One Strudel cycle = one bar of 4/4, so setcpm(140/4). Key: C minor, loop Cm7 Abmaj7 Ebmaj7 Bb7
// (i VI III VII). Gain staging: every rack peaks at -6 dBFS or lower (kick, snare, impact -3); the master (engine/master,
// preset dubstep) does the loudness, never the parts.
// Buses (Strudel orbits): orbit 1 drums and FX (never ducked), orbit 2 the bass layers, orbit 3 the music (pads, chords, lead).
// One orbit = one reverb and one delay, so only orbit 3 gets a room.
// Render budget (measured with the headless CLI, 1 bar, CPU seconds): 8 saw notes 1.6 s; the same with distort 50 s, with shape 71 s;
// a 4-note supersaw chord 32 s, the same chord as three detuned native saws 1.6 s; a ramp tremolo on it 28 s. AudioWorklet stages
// (supersaw, shape, distort, tremolo, crush, the filter LFO) are the cost. So this track spends worklets only where they are the lesson
// (the growl and screech drive, the talk and wobble filter LFOs) and builds wide chords the old way: a supersaw is just detuned
// saws, so WIDE stacks three native saws 0.15 semitone apart, panned. Drums, sub, wobble and riddim drop the racks' shape stage and the talk bass its distort
// (.withValue(dry)); on a live site the full racks cost nothing noticeable.
setcpm(140/4)
const dry = (v) => { const o = { ...v }; delete o.shape; delete o.distort; delete o.distortvol; return o }   // drop the worklet drive stages
const FADE = "<1!88 .5 .44 .38 .32 .26 .2 .14 .08 1!8>"   // outro drums: half level, then fading out (bars 89-96), as data
// LESSON 0b - dynamics: the drop is only big if the rest is smaller. REL is a per-bar gain table for every lane that plays outside the
// drops: intro and outro 0.35 (-9 dB), builds 0.25 (-12 dB), breakdown 0.22 (-13 dB), drops 1. Why so low: loudness is measured
// with a gate (BS.1770 ignores blocks more than 10 LU under the mean), so reliefs mixed more than 10 LU down no longer pull the
// master's gain up, and a loud club master keeps them below the drops instead of limiting the drops into them (#168).
const REL = "<.35!16 .25!8 1!16 .22!16 .25!8 1!24 .35!16>"
const SHAKE = "<.35!16 .25!8 .4!16 .22!16 .25!8 1!24 .5 .44 .38 .32 .26 .2 .14 .08 0!8>"   // REL, -8 dB under drop A (it only adds air there), outro fade
const WIDE = (x) => x.s("sawtooth").layer((v) => v.add(note(-0.15)).pan(0.25), (v) => v, (v) => v.add(note(0.15)).pan(0.75))   // a 3-saw supersaw
// LESSON 1 (bars 1-16, intro) - start with the key, not the drop. A slow pad states the chords; its low-pass is automated bar by
// bar (500 Hz -> 1.7 kHz) so the intro brightens without getting louder, and the drop still has room above it.
pad: WIDE(note("<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,d4] [bb2,d3,f3,ab3]>").hpf(180).lpf(6000).s("supersaw").unison(5).detune(0.25).attack(2).sustain(0.8).release(3).lpf(1200).lpenv(1.5).lpattack(3).gain(0.15)).gain(0.1).postgain(REL).orbit(3).room(0.35).roomsize(4)
  .lpf("<500 580 660 740 820 900 980 1060 1140 1220 1300 1380 1460 1540 1620 1700 1400!88>")
  .velocity("<1!96 .85 .72 .6 .48 .36 .25 .15 .08>")          // outro: an 8-bar fade written as data
  .mask("<1!16 0!24 1!16 0!32 1!16>")                        // intro, breakdown, outro
// LESSON 2 (bars 9-16) - add rhythm before weight. A shaker on 16ths and a kick on the 1 only: the half-time pulse appears,
// still no bass. Shakers soften their attack (12 ms) so they sit behind the kick.
shaker: s("x*16").velocity("[1 .5 .75 .5]*4").hpf(5000).lpf(14500).ftype("24db").s("white").hpf(5500).attack(0.012).decay(0.06).sustain(0).gain(0.3).postgain(SHAKE).mask("<0!8 1!32 0!16 1!8 0!24 1!8 0!8>")   // intro, build 1, drop A (under the hats), build 2, outro
kickIntro: s("x ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~").hpf(30).lpf(7000).s("sine").freq(48).attack(0.001).penv(30).pdecay(0.06).decay(0.4).sustain(0).shape(0.4).lpf(3500).hpf(42).gain(0.8).withValue(dry).velocity(0.5).postgain(REL).mask("<0!8 1!16 0!80>")   // bars 9-24: the pulse runs through build 1
chops: note("<[g4 ~ g4 ~ ~ bb4 ~ c5] [~ eb5 ~ d5 c5 ~ ~ ~]>").hpf(150).lpf(8000).s("sawtooth").vowel("<a e o i>").attack(0.003).decay(0.12).sustain(0).hpf(250).lpf(5000).gain(0.4).postgain(REL).orbit(3).room(0.35).roomsize(4).velocity(0.8)
  .mask("<0!12 1!4 0!32 1!8 0!48>")                         // a hint of the hook in bars 13-16, back in the breakdown
// LESSON 3 (bars 17-24, build) - tension is three rising curves and one gap: density (the roll steps through 4, 4, 8, 8, 16, 16,
// 16 and 32 hits per bar, ec.roll8), brightness (the chord low-pass opens x1.5 per bar, ec.open8, while the high-pass empties the low end,
// ec.thin8) and level (a noise riser fades in for 8 bars). Then the breath: the last beat before the drop is silent (ec.gapMask).
roll: s("<x*4!2 x*8!2 x*16!3 x*32>").velocity("<.35 .42 .5 .58 .66 .76 .88 1>").hpf(120).lpf(10000).ftype("24db").s("triangle, white").note("e3").attack(0.001).decay(0.12).sustain(0).hpf(170).lpf(7000).gain(0.55).postgain(0.45).mask("<0!16 1!8 0!32 1!8 0!40>")   // 1.8 x REL 0.25
  .mask("<1!23 [1 1 1 0] 1!80>")                            // the gap: ec.gapMask, here only before drop A
buildChords: WIDE(note("<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,d4] [bb2,d3,f3,ab3]>").segment(8).hpf(100).lpf(9000).s("supersaw").unison(7).detune(0.3).spread(0.6).attack(0.01).sustain(0.8).release(0.4).hpf(180).lpf(6000).gain(0.16)).release(0.15).gain(0.06).postgain(REL).orbit(3).room(0.35).roomsize(4)
  .lpf("<300 450 700 1000 1500 2300 3600 6000>").hpf("<30 50 80 130 200 320 500 800>").mask("<0!16 1!8 0!32 1!8 0!40>").mask("<1!23 [1 1 1 0] 1!80>")
riser: s("x").slow(8).hpf(150).lpf(12500).ftype("24db").s("white").attack(13.71).sustain(1).release(0.2).hpf(300).lpf(700).lpenv(4).lpattack(13.71).lpsustain(1).gain(0.28).postgain(REL).mask("<0!16 1!8 0!80>")   // len = 8 bars x 240 / 140 bpm = 13.71 s
// LESSON 4 (bar 25, the drop lands) - mark the downbeat with three different things at once: an impact (sub boom), a crash
// (air) and the full kit. Each lives in its own band, so together they hit harder than any one of them louder.
// LESSON 3b (foreshadow) - a drop lands harder when the ear has heard a hint of it. The growl motif plays filtered and quiet in
// bars 21-24 (low-pass 700 Hz, velocity 0.45) and the talk motif in bars 61-64; both return once, filtered, in the outro.
growlEcho: note("[c2 c2] ~ [c2 ~ c2 c2] [eb2 ~ g1 ~]").hpf(70).lpf(9000).s("sawtooth").fm(2).fmh(1).fmattack(0.005).fmdecay(0.25).fmsustain(0.3).vowel("<a o>").hpf(90).lpf(3200).attack(0.005).sustain(0.8).release(0.05).distort(1.5).distortvol(0.4).gain(0.4).lpf(700).velocity(0.45).postgain(REL).orbit(2).mask("<0!20 1!4 0!64 1!4 0!12>").mask("<1!23 [1 1 1 0] 1!80>")
talkEcho: note("[c2@3 c2] [~ eb2] [c2@2 g1@2] ~").hpf(70).lpf(9000).s("sawtooth").fm(1.5).fmh(2).vowel("o").hpf(90).lpf(2400).lpsync(16).lpdepth(0.9).attack(0.005).sustain(0.9).release(0.05).distort(1.2).distortvol(0.45).gain(0.38).withValue(dry).lpf(800).velocity(0.45).postgain(REL).orbit(2).mask("<0!60 1!4 0!28 1!4 0!8>")
impact: s("x").hpf(25).lpf(5000).s("sine").note("c1").penv(24).pdecay(0.25).decay(2.2).sustain(0).shape(0.25).lpf(3000).gain(0.7).withValue(dry).mask("<0!24 1 0!39 1 0!39>")
crash: s("x").hpf(5000).lpf(14500).ftype("24db").s("white").hpf(5000).decay(1.6).sustain(0).gain(0.22).mask("<0!24 1 0!39 1 0!11 1 0!27>")
// LESSON 5 (bars 25-40, drop A) - the half-time kit. Kick on the 1 and the and of 3, snare alone on 3, ghost snares around it,
// 8th hats with accents. The kick is the sidechain trigger: it ducks orbit 2 (bass) by depth 0.36 (= -8 dB, superdough maps
// depth d to a gain of 1 - sqrt(d)) and orbit 3 (music) by 0.5 (-10.7 dB); they come back over 150 / 300 ms.
kick: s("x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~").hpf(30).lpf(7000).s("sine").freq(48).attack(0.001).penv(30).pdecay(0.06).decay(0.4).sustain(0).shape(0.4).lpf(3500).hpf(42).gain(0.8).withValue(dry).postgain(FADE).duckorbit("2:3").duckdepth("0.36:0.5").duckattack("0.15:0.3")
  .mask("<0!24 1!16 0!24 1!24 1!8 0!8>")
snare: s("~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~").hpf(120).lpf(10000).ftype("24db").s("triangle, white").note("d3").attack(0.001).decay(0.22).sustain(0).hpf(150).lpf(9000).shape(0.25).gain(0.55).withValue(dry).postgain(FADE).mask("<0!24 1!16 0!24 1!24 1!8 0!8>")
ghost: s("~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x").hpf(120).lpf(10000).ftype("24db").s("triangle, white").note("e3").attack(0.001).decay(0.12).sustain(0).hpf(170).lpf(7000).gain(0.55).velocity(0.3).mask("<0!24 1!16 0!24 1!24 0!16>")
hats: s("x*8").velocity("[1 .55]*4").hpf(5000).lpf(14500).ftype("24db").s("white").hpf(8000).decay(0.035).sustain(0).gain(0.4).postgain(FADE).mask("<0!24 1!16 0!48 1!8 0!8>")
// LESSON 6 (drop A) - split the bass by layering. The sine sub carries the fundamental (C1-Bb1, mono, clean); the growl starts
// at 90 Hz and does all the talking: FM at ratio 1 with a decaying index, a vowel formant that alternates a / o bar by bar, distortion after the
// filters. Drive never touches the sub, so the low end stays tight in mono. Two basses answer each other bar by bar (call and
// response, ds.bassA / ds.bassB) and a laser fills the gap in every 4th bar.
sub: note("<c1 c1 ab1 bb1>").hpf(25).s("sine").attack(0.005).decay(0.2).sustain(0.9).release(0.08).shape(0.15).lpf(220).gain(0.5).withValue(dry).velocity(0.55).orbit(2).mask("<0!24 1!16 0!24 1!24 0!16>")   // mix pass: velocity 0.55, the sub was 84 % of the drop energy
growl: note("[c2 c2] ~ [c2 ~ c2 c2] [eb2 ~ g1 ~]").hpf(70).lpf(9000).s("sawtooth").fm(2).fmh(1).fmattack(0.005).fmdecay(0.25).fmsustain(0.3).vowel("<a o>").hpf(90).lpf(3200).attack(0.005).sustain(0.8).release(0.05).distort(1.5).distortvol(0.4).gain(0.4).orbit(2).postgain(1.6).mask("<0!24 1!16 0!64>").mask("<1 0>")
talk: note("[c2@3 c2] [~ eb2] [c2@2 g1@2] ~").hpf(70).lpf(9000).s("sawtooth").fm(1.5).fmh(2).vowel("o").hpf(90).lpf(2400).lpsync(16).lpdepth(0.9).attack(0.005).sustain(0.9).release(0.05).distort(1.2).distortvol(0.45).gain(0.38).withValue(dry).orbit(2).postgain(1.8).mask("<0!24 1!16 0!64>").mask("<0 1>")
laser: note("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ c6 ~ ~ ~").hpf(300).lpf(10000).s("sawtooth").penv(24).pdecay(0.12).attack(0.002).decay(0.18).sustain(0).hpf(300).lpf(7000).gain(0.25).mask("<0!24 1!16 0!24 1!24 0!16>").mask("<0 0 0 1>")
// LESSON 7 (bars 41-56, breakdown) - contrast is the strongest effect: no kick, no sub. A downlifter falls out of the drop; the
// chords still pump although no kick plays: a ghost trigger (a silent four-on-the-floor whose only job is duckorbit) ducks the
// music bus every beat. The pack also has lfoPump (a beat-synced ramp tremolo, the volume-shaper trick, recipe edm-pump-shaper);
// the ghost trigger does the same with native gain automation, at a fraction of the render cost. An arp moves, and the lead
// arrives in bar 49 to give the second half of the track a melody to come back to.
down: s("x").hpf(150).lpf(12500).ftype("24db").s("white").attack(0.005).decay(2).sustain(0).hpf(300).lpf(1000).lpenv(3.5).lpattack(0.001).lpdecay(1.8).lpsustain(0).gain(0.3).postgain(REL).mask("<0!40 1 0!47 1 0!15>")
pumpTrig: s("x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~").s("sine").gain(0).duckorbit(3).duckdepth(0.45).duckattack(0.3).mask("<0!40 1!16 0!48>")   // ducks orbit 3 to -9.6 dB
breakChords: WIDE(note("<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,d4] [bb2,d3,f3,ab3]>").hpf(100).lpf(9000).s("supersaw").unison(7).detune(0.35).spread(0.7).attack(0.02).sustain(0.8).release(0.5).hpf(200).lpf(7000).gain(0.15)).gain(0.07).postgain(REL).orbit(3).room(0.35).roomsize(4).mask("<0!40 1!16 0!48>")
arp: note("<[c4 eb4 g4 c5]*4 [ab3 c4 eb4 ab4]*4 [eb4 g4 bb4 eb5]*4 [bb3 d4 f4 bb4]*4>").hpf(150).lpf(8000).s("triangle").attack(0.003).decay(0.15).sustain(0).lpf(3000).lpenv(2).lpdecay(0.12).gain(0.35).orbit(3).room(0.35).roomsize(4).postgain(0.35).mask("<0!40 1!16 0!48>")   // 1.6 x REL 0.22
lead: WIDE(note("<[c5 ~ bb4 g4 ~ g4 bb4 c5] [eb5 ~ d5 c5 ~ bb4 g4 ~] [g5 ~ f5 eb5 ~ d5 eb5 ~] [f5 ~ eb5 d5 ~ bb4 ~ ~]>").hpf(150).lpf(8000).s("supersaw").unison(3).detune(0.15).spread(0.4).attack(0.015).sustain(0.7).release(0.3).lpf(3500).lpenv(1).lpdecay(0.3).vib(5).vibmod(0.12).gain(0.22)).gain(0.12).postgain(REL).orbit(3).room(0.35).roomsize(4).mask("<0!48 1!8 0!8 1!12 0!28>")   // breakdown from 49, and back in drop B: the melody returns
// LESSON 8 (bars 57-64, build 2) - never build the same way twice. The roll and filter return, but the riser is a white-noise
// build (the high-pass climbs four octaves, so it thins while it rises) plus a pitch riser, and instead of a gap a reverse swell
// sucks into the downbeat of drop B: it fades in over one bar and stops dead on bar 65.
whiteBuild: s("x").slow(8).hpf(150).lpf(12500).ftype("24db").s("white").attack(1).sustain(1).release(0.2).hpf(200).hpenv(4).hpattack(13.71).hpsustain(1).lpf(11000).gain(0.22).postgain(REL).mask("<0!56 1!8 0!40>")
pitchUp: s("x").slow(8).hpf(150).lpf(12500).ftype("24db").s("sawtooth").note("c4").penv(24).pattack(13.71).panchor(0).attack(2).sustain(1).release(0.1).lpf(4000).gain(0.16).postgain(REL).mask("<0!56 1!8 0!40>")
swell: s("x").hpf(200).lpf(12000).ftype("24db").s("white").attack(1.71).sustain(1).release(0.02).hpf(1500).lpf(9000).gain(0.28).postgain(REL).mask("<0!7 1 0!7 1 0!47 1 0!40>")   // into bars 9, 17 (ear candy) and 65
// LESSON 9 (bars 65-76, drop B) - the second drop must change something. Here the bass becomes a wobble: a resonant low-pass whose
// LFO is synced to the bar, with the rate itself a pattern (quarters, eighths, quarters then 16ths, triplets: ds.wobbleSync).
// 16th hats raise the density; the melodic chords stay underneath, ducked, so the drop keeps the key of the breakdown.
wobble: note("<c2 c2 eb2 [g1 bb1]>").hpf(70).lpf(9000).s("sawtooth, square").attack(0.005).sustain(1).release(0.05).hpf(120).ftype("24db").lpf(500).lpq(6).lpsync(4).lpdepth(1.6).shape(0.3).gain(0.12).withValue(dry).postgain(1.2)   /* drop B measured 6 LU over drop A at 3 */.lpsync("<4 8 [4 16] 6>").orbit(2).mask("<0!64 1!12 0!28>")
hats16: s("x*16").velocity("[.9 .4 .6 .4]*4").hpf(5000).lpf(14500).ftype("24db").s("white").hpf(8000).decay(0.035).sustain(0).gain(0.4).mask("<0!64 1!24 0!16>")
dropChords: WIDE(note("<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [eb3,g3,bb3,d4] [bb2,d3,f3,ab3]>").hpf(100).lpf(9000).s("supersaw").unison(7).detune(0.35).spread(0.7).attack(0.02).sustain(0.8).release(0.5).hpf(200).lpf(7000).gain(0.15)).gain(0.09).orbit(3).room(0.35).roomsize(4).velocity(0.7).mask("<0!24 1!16 0!24 1!12 0!28>")   // drop A and drop B: the key stays present under the bass
// LESSON 10 (bars 77-88, switch-up) - same kit, new idea, half way through the drop. Riddim: a hollow square with a sub-octave FM
// modulator in 3 + 3 + 2, where the silence between hits is as loud as the hits; a screech answers in the gaps.
riddim: note("[c2 ~ ~ c2 ~ ~ c2 ~]*2").hpf(70).lpf(9000).s("square").fm(0.6).fmh(0.5).attack(0.004).decay(0.22).sustain(0.35).release(0.04).hpf(120).ftype("24db").lpf(900).lpq(3).shape(0.5).gain(0.3).withValue(dry).postgain(1.8).orbit(2).mask("<0!76 1!12 0!16>")
screech: note("~ ~ ~ ~ ~ ~ c6 ~ ~ ~ ~ ~ ~ ~ eb6 ~").hpf(300).lpf(10000).s("sawtooth").fm(3).fmh(3.01).fmdecay(0.3).fmsustain(0.5).hpf(400).lpf(6000).attack(0.01).sustain(0.7).release(0.1).vib(6).vibmod(0.2).distort(1.2).distortvol(0.4).gain(0.22).velocity(0.8).mask("<0!76 1!12 0!16>")
// LESSON 11 (bars 89-104, outro) - give the next DJ 16 bars: the drums and shaker play 8 more bars at half level and fade as
// data (postgain FADE / SHAKE, 0.5 -> 0.08), then only the pad is left, fading over the last 8 bars (its velocity). The growl and talk motifs come back
// once, filtered (the callback: the ear recognises the drop on the way out).
// The downlifter on bar 89 tells the ear the energy is leaving. Master last: python3 engine/master/master.py ... --preset dubstep.
