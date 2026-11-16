# Rock and metal: references, synthesis approach, forms and composition fundamentals

Issue #157 (pack glyphcore/rockmetal), rules docs/RESEARCH_ETHICS.md. Own words; sources in section 6. Nothing is sampled; riffs and forms
are generic vocabulary (power chords, cells, song sections), never transcriptions.

## 1. Guitar without a string model
A plucked string is a delay-line resonance whose high partials die first (Karplus-Strong). superdough has no such voice, and an AudioWorklet
one would cost 15-45x in the CLI (RACK_STANDARD 9), so the pack approximates the two audible facts natively: a bright attack that darkens
(a low-pass with an envelope falling over 50-300 ms, `lpenv` / `lpdecay`) and a decay of the level (`decay` / `sustain`). Saw + triangle
(clean) or saw + square (crunch / high gain) give the harmonic density of a string through a pickup.
Amp and cabinet: a guitar speaker cabinet rolls off steeply above roughly 5-6 kHz and below 80-100 Hz; distortion before it makes the
harmonics, the cabinet tames them. superdough runs filters before `distort`, so the cab low-pass sits pre-drive and the class allows -20 dB
above the band (as growl). Tiers: **clean** (no drive), **crunch** (native: low-index FM at ratio 2 adds even harmonics, a resonant 2 kHz
low-pass is the amp's mid hump), **high gain** (one `distort` stage, 1-1.2; used only on gtrHigh and chugHigh). Palm mute = the crunch voice
with a 90 ms decay and a dark, fast filter envelope. Power chord = root, fifth, octave (`rm.pI` = `[e2,b2,e3]`); distortion on a full triad
makes intermodulation mud, on a fifth it stays clean (the reason the power chord exists). Harmonic = a sine with a long ring; feedback = a
sine swelling in with vibrato. Rejected: a KS worklet (engine change, CLI cost), sampled guitars / amp captures (licences).

## 2. Drums and feels
Straight rock: kick on 1 and 3 (+ the and of 3), snare backbeat on 2 and 4, 8th hats with the beat accented. Shuffle: the triplet grid
written out (`[x ~ x]` per beat), not a swing amount, plus light human jitter. Half-time: snare on 3, laid back 3 % of a 16th (groove-push).
Metal: double kick 16ths with louder downstrokes; blast beat (kick and snare alternating 16ths); thrash skank (kick on the beats, snare on
the offbeats); doom (kick once a bar, held chords, dragged 5 %). Fills: toms high to low on beats 3-4 or snare 16ths into 32nds, then a crash on
the 1 of the new section (`rm.fills`, `rm.crashBars`).

## 3. Forms (gate atoms) and riff grammar
Song form, 72 bars: intro 4, verse 8, pre-chorus 4, chorus 8, verse 8, pre 4, chorus 8, bridge (metal: breakdown) 8, solo 8, chorus 8,
outro 4 (`rm.intro` .. `rm.outro`, `verses`, `pres`, `choruses`, `notChoruses`, `fills`, `crashBars`, mask `mChoruses`). At 120 bpm: 2:24.
Riff grammar: a riff is a 1-bar cell played as **A A A B** (call three times, answer once: `rm.riffA`, `rm.riffB`, `rm.riff`), varied by
displacement (the cell 1/16 late), octave, or swapping the last half bar; a chug grammar uses rests as rhythm (`rm.chug`), the gallop is an
8th and two 16ths (`rm.gallop`); the metal breakdown is a 3+3+4+2+4 sixteenth grouping with the kick in unison (`rm.breakdown`,
`rm.breakdownKick`); phrygian colour = the half step above the root (`rm.phryg`, `rm.pbII`); doom = one chord per two beats, held.
Measured form data for rock and metal: see docs/FORM_PROFILES.md (licensed LMMS projects found for metal: see DAW_STUDY_SOURCES.md).

## 4. Composition fundamentals (rock / metal; ids from docs/COMPOSITION.md)
- **Motif**: the riff cell is the motif; repeat it until it is learned, then vary one parameter at a time (MOT-08 rhythmic displacement,
  MOT-07 extension of the last half bar, MOT-01 transposition / register). A chorus that reuses the verse riff an octave up or on a new tier (crunch -> high gain) is development, not a new idea.
- **Density** (LAY-02, LAY-03, EN-01): layers rise verse -> pre -> chorus (guitar tier, crash ride instead of hats, doubled bass); the bridge / breakdown drops to
  2-3 layers with the kick locked to the chug. Targets in suno-track-lab engine/composer density.py (`rock`, `metal`; design call).
- **Foreshadowing** (FS-02, FS-03): the intro plays the chorus riff on the clean tier or filtered; the pre-chorus introduces the chorus chord on its last bar.
- **Contrast** (LAY-08, TEN-02): verse dry and tight (palm mutes, closed hats), chorus open (ringing power chords, ride / crash, organ or strings), breakdown
  half-time; a solo over the verse changes with the rhythm section held.

## 5. Mix and master
Bass guitar and kick mono below 100 Hz; guitars double-tracked (two lanes panned), high-passed at 80-100 Hz so the bass owns the low end;
master presets `rock` (-10 LUFS) and `metal` (-8.5 LUFS) in suno-track-lab engine/master (docs/MASTERING.md section 5).

## 6. Sources
- K. Karplus, A. Strong, "Digital Synthesis of Plucked-String and Drum Timbres", Computer Music Journal 7(2), 1983 (string loss model).
- J. O. Smith, *Physical Audio Signal Processing* (CCRMA online book), plucked strings and guitar body / amp notes: https://ccrma.stanford.edu/~jos/pasp/
- Sound On Sound, Synth Secrets (G. Reid), synthesizing plucked strings: https://www.soundonsound.com/series/synth-secrets-sound-on-sound
- Ableton, Learning Music (beats, song structure): https://learningmusic.ableton.com
- Drum patterns (backbeat, shuffle, blast, skank) and song form are genre conventions; numbers labelled design call where not measured.
