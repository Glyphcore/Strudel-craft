# Industrial EDM: references, sound-design recipes and the approach guide

Issue #155 (pack glyphcore/industrial), rules docs/RESEARCH_ETHICS.md. Own words; techniques paraphrased from the sources in section 5. Every
sound in the pack is synthesized by its rack chain (native superdough voices); nothing is sampled.

## 1. Why struck metal sounds metallic (and how a rack fakes it)
A struck string or air column has partials at whole-number multiples of its fundamental (harmonic). Bars, plates, pipes and bells do not:
a free bar's first modes sit near 1 : 2.76 : 5.40, a plate's are denser and less regular (physics: Fletcher and Rossing). The ear hears
inharmonic, slowly decaying partials over a noisy strike as "metal". Two cheap ways to get that in a CLI-friendly voice:
- **FM at a non-integer ratio** (fmh 1.41, 2.76, 3.9): one oscillator modulated by another at that ratio gives sidebands at carrier +- k x
  modulator, which are inharmonic; a modulation index that falls fast (fmdecay 40-150 ms) gives a bright strike that settles into a duller
  ring, as real metal loses its high modes first. This is the bell / gong method of FM synthesis texts (Chowning; SOS Synth Secrets "Synthesizing
  Bells"; synthtopia's summary of FM for metallic sounds).
- **A noise burst under the same envelope** (s "square, white"): the strike's contact noise. With a single envelope per rack the noise is as
  long as the ring, so racks with a long ring keep the noise quiet (pink, or a lower gain).
A real resonator bank (several high-Q band-passes) or convolution with a generated impulse would be closer, but superdough has one band-pass
per voice and its convolution reverb is generic; the FM route costs nothing extra in the CLI (native oscillators). Rejected: AudioWorklet
shapers on every hit (15-45x render cost, RACK_STANDARD 9), sampled foley (licences, ethics 3).

## 2. Recipes (rack -> technique)
| rack | class | recipe |
|---|---|---|
| breakerClang | perc | square G3, FM 1.41 index 5 -> 15 % in 120 ms, plus white noise; 350 ms; 24 dB low-pass 7 kHz; small room 0.15: the thunk + ring of a heavy contact |
| metalImpact | perc | triangle C3, FM 2.76 index 8 falling in 60 ms, pink-noise body, 500 ms |
| anvil | perc | sine G4, FM 3.9 index 3 with a slow 400 ms index decay (stays bright), 1 s ring |
| pipeHit | perc | triangle D4, FM 2.76 low index: hollow tube, 600 ms |
| relayClick | perc | 8 ms white tick through a 3 kHz band-pass (Q 2) |
| ratchet | perc | 12 ms ticks at 2.2 kHz (Q 4) as 16th / 32nd runs (pawl over a gear) |
| chainRattle | hat | 30 ms noise links 3.2-11 kHz; dense pattern + groove-human jitter (2-3 % of a 16th) and accents = links hitting at uneven times |
| metalShatter | hat | 250 ms noise 3.5-12 kHz, 32nds thinned by degradeBy(0.5) (seeded) |
| hydraulicHiss | sweep | 50 ms in, 600 ms out, noise 2.5-9 kHz: pressure release |
| servoWhine | screech | saw C5 rising a fifth over 300 ms (pitch attack), 6 Hz vibrato, resonant 5 kHz low-pass: a motor seeking (Farnell: motors as a pitched source with load-dependent glide) |
| servoDown | sweep | the saw falling two octaves over 800 ms: a motor powering down, a downlifter |
| doorSlam | impact | sine 60 Hz + 12-semitone knock in 50 ms + brown noise under 2 kHz, 400 ms |
| stampPress | impact | sine + square at 48 Hz, two-octave knock in 40 ms, 300 ms |
| slamImpact | impact | sine 45 Hz, three-octave knock over 80 ms, brown rumble, 1.2 s, room 0.3: the drop downbeat |
| rustBed | texture | brown + pink noise 250 Hz-6 kHz, slow attack and release, -20 dB under the hits |
| factoryAmb | texture | pink noise through an "o" formant, big room: a hall hum |
| stampKick | kick | sine 50 Hz, 30-semitone knock in 30 ms, 300 ms |
| clangSnare | snare | triangle E3 FM 1.41 + white noise, 200 ms |
| metalClap | snare | noise band-passed at 1.5 kHz, 120 ms |
| indRiddim | growl | square, FM 1.5 (a metallic fifth), resonant 24 dB low-pass 1.1 kHz + short envelope snap, high-pass 120 Hz (the sub plays below) |
| metalGrowl | growl | saw FM 1.41 index 2.5 -> 40 %, o / e formants |
| clankBass | growl | square + triangle FM 2.76 index 6 falling in 60 ms: a clang at every note onset that settles into bass |
| pressBass | bass | triangle + square, 600 Hz low-pass with a short envelope, rolling 16ths |
| indSub | sub | sine, 5 ms attack, low-pass 300 Hz, mono |
| hissRiser(len) | riser | white noise fading in over len seconds while the high-pass climbs 4 octaves |

Mixing hits with a growl bass: hits live in the gaps (atoms `ind.hitsGap`, call and response with kick and snare); a clang that lands with the
snare is a layer of the snare (keep it 6-10 dB under). The sub is always its own mono lane (indSub); every growl class rack high-passes at
90-120 Hz (band split by layering, CONVENTIONS 8). Distortion and OTT-style squash: add `drive` / `ott` from glyphcore/edm on the bass bus
when rendering on the site (cheap in Chromium) and only on one lane in long CLI renders.

## 3. Form and grammar
64-bar map as gates (`ind.intro` 1-8, `build` 9-16, `drop1` 17-32, `brk` 33-40, `build2` 41-48, `drop2` 49-64; `drops`, `notDrops`,
`builds`, `vacuum` = the last half bar before each drop, `pickup` = the last beat, `phraseEnd` = the last bar of every 8). Hits per bar
grammar: `hits1` / `hits2` (intro, break), `hits4` (build, the first half of a drop phrase), `hits7` (fills, `phraseEnd`), `hitsGap` (drop
default). Dovetails: a clang or ratchet on `ind.pickup`, the hiss riser ending exactly on the drop (`ec.rise8` style: the riser note is as
long as the build), the vacuum muting everything but the riser, slamImpact on the downbeat, servoDown after it. Length at 140 bpm: 64
bars = 1:49.7; double drop 2 or add an 8-bar outro for a 2:30 track (FORM_PROFILES.md industrial).

## 4. Approach guide: "industrial riddim, in the style associated with Excision" (form and approach only)
What can be said with sources, and with which label (RESEARCH_ETHICS 5; no song, riff, rhythm or preset of any artist is reproduced):
- **Tempo and feel**: 140-150 bpm half-time (kick on 1, snare on 3), the drop carried by the bass's rhythm, not by melody. *Genre
  convention* (docs/EDM_REFERENCES.md, dubstep).
- **Sound-design chain**: heavy bass producers in this scene describe building basses in stages: a simple source (sine, saw, FM), heavy
  saturation / distortion and multiband compression (OTT), then resampling the result to audio and processing it again; each stage adds
  filters, automation and new distortion. *Producer-reported* for neuro / heavy-bass producers in general (sine-compression and resampling
  tutorials; a COPYCATT interview on OTT and resampling, section 5); **not sourced for Excision himself: UNVERIFIED** (no interview found
  that describes his own chain). In this repo: native FM source rack -> `ott` / `drive` moves (glyphcore/edm) -> `capture` / `recipe`
  (the CLI's resampling, docs/LANES.md 6) -> a second rack on the captured audio.
- **Foley / mechanical layers**: metal impacts, clangs and machine noises as fills and accents between bass hits. *Design call* here, a
  common description of "industrial" dubstep (no artist source).
- **Form**: intro 8-16 with the hook's sound teased, build 8 with a riser and snare / ratchet roll, drop 16-32, short break, second build,
  second drop with a switch-up (new bass, same kit). *Genre convention* (EDM_REFERENCES section 3); measured profiles for dubstep /
  industrial are missing (FORM_PROFILES.md: no licensed projects found for this genre).
- **Mix**: sub mono and alone below 100-120 Hz, bass layers band-split, drums loud and short; masters hot (-8 to -6 LUFS, preset
  `industrial`). *Sourced ranges* in suno-track-lab docs/genres/DUBSTEP_INDUSTRIAL.md; preset is a design call.

## 5. Sources
- N. Fletcher, T. Rossing, *The Physics of Musical Instruments* (Springer, 2nd ed. 1998): modes of bars, plates, bells (ratios paraphrased).
- J. Chowning, "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation", JAES 21(7), 1973 (inharmonic FM for bells / gongs).
- Sound On Sound, Synth Secrets (G. Reid), "Synthesizing Bells": https://www.soundonsound.com/techniques/synthesizing-bells
- Synthtopia, "FM Synthesis Of Metallic Sounds" (2018): https://www.synthtopia.com/content/2018/09/02/fm-synthesis-of-metallic-sounds/
- A. Farnell, *Designing Sound* (MIT Press, 2010): procedural models of motors, machines, impacts.
- Ableton, Learning Synths (FM, noise, envelopes): https://learningsynths.ableton.com
- Resampling and sine-compression bass workflows (heavy-bass producers): https://www.educationandbass.online/resampling-creative-processing/ ,
  https://rosetta.to/u/venustheory/sine-compression-bass-tutorial-frequent-noisia-jade-cicada-neuro , The EDM Prodcast (COPYCATT interview on
  OTT and resampling): https://podbay.fm/p/the-edm-prodcast/e/1632135606
