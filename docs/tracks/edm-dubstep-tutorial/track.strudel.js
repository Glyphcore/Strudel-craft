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
setcpm(140/4)
atoms.import("pack:glyphcore/edm:atoms-edm-core")
atoms.import("pack:glyphcore/edm:atoms-dubstep")

// LESSON 1 (bars 1-16, intro) - start with the key, not the drop. A slow pad states the chords; its low-pass is automated bar by
// bar (500 Hz -> 1.7 kHz) so the intro brightens without getting louder, and the drop still has room above it.
pad: note(atoms.ds.chords).hook("atmosPad").orbit(3).room(0.35).roomsize(4)
  .lpf("<500 580 660 740 820 900 980 1060 1140 1220 1300 1380 1460 1540 1620 1700 1400!88>")
  .velocity("<1!96 .85 .72 .6 .48 .36 .25 .15 .08>")          // outro: an 8-bar fade written as data
  .mask("<1!16 0!24 1!16 0!32 1!16>")                        // intro, breakdown, outro

// LESSON 2 (bars 9-16) - add rhythm before weight. A shaker on 16ths and a kick on the 1 only: the half-time pulse appears,
// still no bass. Shakers soften their attack (12 ms) so they sit behind the kick.
shaker: s(atoms.ec.hats16).velocity(atoms.ec.accent16).hook("shaker").mask("<0!8 1!8 0!72 1!8 0!8>")
kickIntro: s(atoms.ds.halfKick).hook("dsKick").velocity(0.8).mask("<0!8 1!8 0!88>")
chops: note(atoms.ds.chopLine).hook("vowelChop").orbit(3).room(0.35).roomsize(4).velocity(0.8)
  .mask("<0!12 1!4 0!32 1!8 0!48>")                         // a hint of the hook in bars 13-16, back in the breakdown

// LESSON 3 (bars 17-24, build) - tension is three rising curves and one gap: density (the roll doubles its subdivision every
// two bars, ec.roll8), brightness (the chord low-pass opens x1.5 per bar, ec.open8, while the high-pass empties the low end,
// ec.thin8) and level (a noise riser fades in for 8 bars). Then the breath: the last beat before the drop is silent (ec.gapMask).
roll: s(atoms.ec.roll8).velocity(atoms.ec.rollVel8).hook("snareTight").mask(atoms.ec.mBuilds)
  .mask("<1!23 [1 1 1 0] 1!80>")                            // the gap: ec.gapMask, here only before drop A
buildChords: note(atoms.ds.chords).segment(8).hook("superChord").orbit(3).room(0.35).roomsize(4)
  .lpf(atoms.ec.open8).hpf(atoms.ec.thin8).mask(atoms.ec.mBuilds).mask("<1!23 [1 1 1 0] 1!80>")
riser: s("x").slow(8).hook("noiseRiser(13.71)").mask(atoms.ec.mBuild)   // len = 8 bars x 240 / 140 bpm = 13.71 s

// LESSON 4 (bar 25, the drop lands) - mark the downbeat with three different things at once: an impact (sub boom), a crash
// (air) and the full kit. Each lives in its own band, so together they hit harder than any one of them louder.
impact: s("x").hook("impactBoom").mask("<0!24 1 0!39 1 0!39>")
crash: s("x").hook("crash").mask("<0!24 1 0!39 1 0!11 1 0!27>")

// LESSON 5 (bars 25-40, drop A) - the half-time kit. Kick on the 1 and the and of 3, snare alone on 3, ghost snares around it,
// 8th hats with accents. The kick is the sidechain trigger: it ducks orbit 2 (bass) by depth 0.36 (= -8 dB, superdough maps
// depth d to a gain of 1 - sqrt(d)) and orbit 3 (music) by 0.5 (-10.7 dB); they come back over 150 / 300 ms.
kick: s(atoms.ds.halfKick2).hook("dsKick").duckorbit("2:3").duckdepth("0.36:0.5").duckattack("0.15:0.3")
  .mask("<0!24 1!16 0!24 1!24 1!8 0!8>")
snare: s(atoms.ds.halfSnare).hook("dsSnare").mask("<0!24 1!16 0!24 1!24 1!8 0!8>")
ghost: s(atoms.ds.ghostSnare).hook("snareTight").velocity(0.3).mask(atoms.ec.mDrops)
hats: s(atoms.ds.dsHats).velocity(atoms.ds.dsHatVel).hook("hatClosed").mask("<0!24 1!16 0!48 1!8 0!8>")

// LESSON 6 (drop A) - split the bass by layering. The sine sub carries the fundamental (C1-Bb1, mono, clean); the growl starts
// at 90 Hz and does all the talking: FM at ratio 1 with a decaying index, a vowel formant per note, distortion after the
// filters. Drive never touches the sub, so the low end stays tight in mono. Two basses answer each other bar by bar (call and
// response, ds.bassA / ds.bassB) and a laser fills the gap in every 4th bar.
sub: note(atoms.ds.subLine).hook("subSine").orbit(2).mask(atoms.ec.mDrops)
growl: note(atoms.ds.growlLine).hook("growlBass").orbit(2).velocity(0.85).mask(atoms.ec.mDropA).mask(atoms.ds.bassA)
talk: note(atoms.ds.talkLine).hook("talkBass").orbit(2).velocity(0.85).mask(atoms.ec.mDropA).mask(atoms.ds.bassB)
laser: note(atoms.ds.laserLine).hook("laserZap").mask(atoms.ec.mDrops).mask(atoms.ds.lastOf4)

// LESSON 7 (bars 41-56, breakdown) - contrast is the strongest effect: no kick, no sub. A downlifter falls out of the drop; the
// chords pump with no trigger at all (pump: a beat-synced ramp tremolo, the volume-shaper trick), an arp moves, and the lead
// arrives in bar 49 to give the second half of the track a melody to come back to.
down: s("x").hook("downSweep").mask("<0!40 1 0!47 1 0!15>")
breakChords: note(atoms.ds.chords).hook("ukfChord | pump(0.6)").orbit(3).room(0.35).roomsize(4).mask(atoms.ec.mBreak)
arp: note(atoms.ds.arp).hook("ukfArp").orbit(3).room(0.35).roomsize(4).velocity(0.8).mask(atoms.ec.mBreak)
lead: note(atoms.ds.leadLine).hook("ukfLead").orbit(3).room(0.35).roomsize(4).mask("<0!48 1!8 0!48>")

// LESSON 8 (bars 57-64, build 2) - never build the same way twice. The roll and filter return, but the riser is a white-noise
// build (the high-pass climbs four octaves, so it thins while it rises) plus a pitch riser, and instead of a gap a reverse swell
// sucks into the downbeat of drop B: it fades in over one bar and stops dead on bar 65.
whiteBuild: s("x").slow(8).hook("hpBuild(13.71)").mask(atoms.ec.mBuild2)
pitchUp: s("x").slow(8).hook("pitchRiser(13.71)").mask(atoms.ec.mBuild2)
swell: s("x").hook("reverseSwell(1.71)").mask("<0!63 1 0!40>")

// LESSON 9 (bars 65-76, drop B) - the second drop must change something. Here the bass becomes a wobble: a resonant low-pass whose
// LFO is synced to the bar, with the rate itself a pattern (quarters, eighths, quarters then 16ths, triplets: ds.wobbleSync).
// 16th hats raise the density; the melodic chords stay underneath, ducked, so the drop keeps the key of the breakdown.
wobble: note(atoms.ds.wobbleLine).hook("wobbleBass").lpsync(atoms.ds.wobbleSync).orbit(2).mask("<0!64 1!12 0!28>")
hats16: s(atoms.ds.hats16).velocity(atoms.ds.hat16Vel).hook("hatClosed").mask(atoms.ec.mDropB)
dropChords: note(atoms.ds.chords).hook("ukfChord").orbit(3).room(0.35).roomsize(4).velocity(0.7).mask("<0!64 1!12 0!28>")

// LESSON 10 (bars 77-88, switch-up) - same kit, new idea, half way through the drop. Riddim: a hollow square with a sub-octave FM
// modulator in 3 + 3 + 2, where the silence between hits is as loud as the hits; a screech answers in the gaps.
riddim: note(atoms.ds.riddimLine).hook("riddimBass").orbit(2).mask(atoms.ec.mSwitch)
screech: note(atoms.ds.screechLine).hook("screechLead").velocity(0.8).mask(atoms.ec.mSwitch)

// LESSON 11 (bars 89-104, outro) - give the next DJ 16 bars: drums for 8, then only atmosphere, everything fading as data.
// The downlifter on bar 89 tells the ear the energy is leaving. Master last: python3 engine/master/master.py ... --preset dubstep.
