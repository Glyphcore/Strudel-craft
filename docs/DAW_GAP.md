# DAW feature gap vs Strudel (and our CLI engine)

Coverage: N = native, P = partial, X = none. Effort: S (<1 day), M (days), L (week+). Routes: W = custom AudioWorklet in node-web-audio-api (also needs a superdough hook, so a patched or wrapper registration: AGPL decision issue first, see CLAUDE.md), PY = Python/CLI post-FX stage on stems, EXT = external tool. Strudel facts: see `docs/SAMPLES_AND_VOICES.md`. Licences: rubberband GPL-2 (commercial alt), SoX GPL-2 (libs LGPL), paulstretch algorithm is public (numpy impl, write our own), demucs/librosa already in use, LV2/LADSPA plugins vary; Strudel/superdough AGPL.

## Ableton Live

| Feature | Strudel | Add how | Effort | Licence note |
|---|---|---|---|---|
| Simpler/Sampler (slice, classic, one-shot, ADSR, filter) | P: `begin/end/slice/speed`, env, filters | already close; add per-region sample map helper | S | none |
| Warp modes (Beats, Tones, Complex, Re-Pitch) | P: only Re-Pitch (`loopAt`/`fit`) | PY/EXT: pre-warp samples with rubberband (time/pitch independent) into a sample map | M | rubberband GPL-2 as a tool call (not linked) |
| Granulator | P: `chop/striate/scrub` | W grain-cloud worklet (size, spray, pitch jitter, pan) or PY granular on stems | M | own code |
| Vocoder | X | PY STFT vocoder (carrier stem x modulator stem) or W | M | own code |
| Corpus (resonator bank from sample) | X | PY/W comb/modal bank tuned by analysis | M | own code |
| Spectral Resonator / Spectral Time (freeze, delay) | X | PY STFT freeze/stretch/hold on stems | M | own code (numpy) |
| Echo (filtered, modulated, ping-pong) | P: `delay` + feedback, no filter/mod in loop | W delay worklet with filter+LFO in loop, or PY | M | own code |
| Hybrid Reverb (convolution + algo) | P: `room` algo, `ir` convolution | `ir` already works with custom wav; PY convolve for blend | S | IR licences |
| Drum Rack (pads, choke, per-pad chain) | P: `bank`, `cut`, per-layer orbit | helper recipes; per-pad FX via `orbit` | S | none |
| Follow actions / clip launch | P: pattern switching (`<>`, `arrange`) | scripted arrangement in `.strudel.js`; no code change | S | none |
| Max4Live LFO / envelope follower | P: signals (`sine`, `perlin`) for LFO; X follower | follower: PY stage computing RMS of a stem and driving gain/filter of another (offline, two-pass) | M | own code |

## LMMS

| Feature | Strudel | Add how | Effort | Licence note |
|---|---|---|---|---|
| ZynAddSubFX (additive/subtractive/pad) | P: `additive`, supersaw, wavetables UNVERIFIED | EXT: render zynaddsubfx/Surge offline to wav, load as sample map | M | ZynAddSubFX GPL-2 as external tool |
| Vibed (string model) | X | PY Karplus-Strong sample generator | S | own code |
| LADSPA / LV2 | X | EXT: `lv2file`/`lilv` or `sox`/`ffmpeg` filters on stems | M | per plugin |
| Sf2 player | UNVERIFIED (`gm_*`) | EXT: fluidsynth renders MIDI/events to wav; map as samples | M | FluidSynth LGPL-2.1; soundfont licences |
| Slicer | P: `slice/splice` | beat-detect cut points (librosa, already used) -> sample map | S | none |

## FL Studio

| Feature | Strudel | Add how | Effort | Licence note |
|---|---|---|---|---|
| Slicer / Slicex | P: `slice` | as LMMS Slicer; export slice indices JSON | S | none |
| Edison (record/edit) | X | no mic; CLI bounce/trim script on wav | S | none |
| Vocodex | X | see Vocoder | M | own code |
| Pitcher / NewTone (pitch correct, formant) | X | EXT rubberband `--formant` + pitch map; or PY pyin + shift | M-L | rubberband GPL-2 |
| Gross Beat (time/volume gate patterns) | P: `slow/fast`, `gain` patterns, `speed` | native via patterns; add recipes | S | none |
| Harmor / resynthesis | X | PY STFT/additive resynth of a sample to wav | L | own code |
| Fruity Granulizer | P | see Granulator | M | own code |
| Patcher (routing) | P: `orbit` buses | no change; document | S | none |
| Sidechain via Peak Controller | P: `duckorbit/duckattack/duckdepth` | already native; follower for non-kick sources = envelope follower | S/M | none |

## Niche

| Idea | Strudel | Add how | Effort | Licence note |
|---|---|---|---|---|
| Formant shifting | P: `vowel` only | rubberband `--formant`, or PY (WORLD/pyworld) | M | rubberband GPL-2; pyworld MIT-like (UNVERIFIED) |
| Spectral freeze | X | PY STFT hold of one frame with random phase | S | own code |
| Paulstretch | X (`stretch` phase vocoder UNVERIFIED) | PY numpy paulstretch pre-render into sample map | S | algorithm public, own impl |
| Convolution with custom IRs | N: `ir` | wire local wav IR into CLI sample map | S | IR licences |
| Envelope followers / ducking buses | P: `duckorbit` | see Max4Live follower | M | own code |
| Resampling / bounce-in-place | X | `strudel render` stem -> wav -> sample map -> reuse (script, loop) | S | none |
| Per-stem offline render | N: `strudel stems` | exists | done | AGPL, unmodified |

## Ranking (value / effort) of the top 8 gaps
1. Pitch-preserving warp + formant shift via rubberband (warp modes, NewTone/Pitcher basics)
2. Local sample folders, bounce-in-place and custom IR loading in the CLI
3. Slicer: beat-detect slice maps from audio
4. Spectral freeze + paulstretch pre-render stage
5. Envelope follower ducking (non-kick sources)
6. Granulator (grain cloud)
7. Vocoder (carrier/modulator stems)
8. External renderers as sample sources (fluidsynth sf2, Karplus-Strong)
