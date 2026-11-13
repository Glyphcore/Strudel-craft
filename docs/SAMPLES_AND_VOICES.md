# Strudel: samples, vocals and voices

Sources (official first): https://strudel.cc/learn/samples/ , https://strudel.cc/learn/effects/ , https://strudel.cc/learn/input-output/ , https://cdn.jsdelivr.net/npm/superdough@1.3.0/README.md , https://codeberg.org/uzu/strudel . Our own engine facts: `engine/strudel-cli/README.md` in suno-track-lab. Items not confirmed on a page are marked UNVERIFIED.

## 1. Loading and selecting samples

| Feature | Syntax / semantics | Status |
|---|---|---|
| `samples(map, base)` | name -> file(s); object, URL to `strudel.json`, optional `_base` | documented (samples page) |
| `github:user/repo[/branch]` | loads `strudel.json` from repo root (default branch main) | documented (samples page, superdough README) |
| Pitched maps | nested note keys (`g2`, `g3`); `note()` picks the nearest sample and repitches | documented |
| `@strudel/sampler` | local server generating `strudel.json` from a folder (`npx @strudel/sampler`) | documented; not wired in our CLI (local folders need a URL) |
| Shabda | `samples('shabda:bass:4')` pulls freesound.org; `shabda/speech/<lang>/<gender>:word` generates speech samples | documented (samples page); speech form seen only in search snippet, UNVERIFIED on official page; needs network |
| `soundAlias(a, b)`, `bank()`, `s()`, `n()`, `hh:3` | naming / index selection (wraps) | documented |
| Drum machines | `bank("RolandTR909")` via tidal-drum-machines map | documented; not preloaded in our CLI (`--samples URL`) |

## 2. Playback, slicing, time

| Function | Semantics | Status |
|---|---|---|
| `begin` / `end` | 0-1 fraction of file | documented |
| `loop`, `loopBegin`/`loopEnd` | loop (not tempo-synced) | documented |
| `speed` | rate and pitch; negative = reverse | documented |
| `unit("c")` | speed relative to cycle | NOT on samples page (UNVERIFIED; Tidal heritage) |
| `loopAt(n)` | fit sample to n cycles by speed change (pitch moves) | documented |
| `fit()` | stretch to event length (speed) | documented |
| `chop(n)` | split into n parts (granular-ish) | documented |
| `striate(n)` | interleaved parts | documented |
| `slice(n, idx)` / `splice(n, idx)` | trigger slices; splice adjusts speed to step | documented |
| `scrub(pos)` | tape-style playhead by position | documented |
| `cut(group)` | choke group | documented |
| `clip` / `legato` | duration multiplier, hard cut | documented |
| `stretch` | phase vocoder, first in the signal chain | named only, no section: UNVERIFIED |

Key limit: all time-fitting (`loopAt`, `fit`, `splice`) works by resampling, so pitch follows tempo. No pitch-preserving stretch is documented.

## 3. Vocals and voices

| Need | Strudel | Notes |
|---|---|---|
| Formant filter | `vowel` (a e i o u + ae aa oe ue y uh un en an on) | fixed-formant bandpass bank on any source; not a formant shifter |
| Speech / TTS | Shabda speech samples (see above) | third-party service, network, licence per sample; used as the opt-in word-bank fallback, section 5 |
| Pitch-shift a sample | `speed`, `note()` on a pitched map | shifts formants and duration together (chipmunk); formant-preserving takes have to be rendered before playback, section 5 |
| Granular-ish | `chop`, `striate`, `slice`, `scrub`, `begin/end` | event-level, not a grain cloud; no per-grain random pitch/pan |
| Vocoder / harmonizer | none | no carrier/modulator input |
| Live sampling / recording | no mic input or recorder found in docs or the input-output page; community threads request it (https://club.tidalcycles.org/t/baked-in-support-for-midi-in-audio-in-and-audio-devices-channels/5098) | UNVERIFIED, treat as absent |
| Soundfonts | `gm_*` names (e.g. `gm_alto_sax`) appear under synths in the REPL; no docs page found (earlier 404 in PLUGINS.md) | UNVERIFIED; in our CLI only if the package loads and fetches the soundfont data over network |
| Reverb IR | `ir`/`iresponse` uses a loaded sample as the impulse response | documented (effects); custom IR = any wav in a map |

## 4. superdough / engine limits

- superdough is a sampler plus synth (`registerSound`, `registerSynthSounds`); the README documents no custom worklet API, no mic and no soundfonts (README read: gaps stated).
- Fixed effect chain per voice, then per-orbit delay/reverb; `duckorbit` is the only cross-bus modulation. No envelope follower, no external sidechain input.
- Our CLI renders offline on node-web-audio-api with superdough's own worklets (supersaw, pulse, distort, crush, coarse, shape, ladder, LFOs); worklet voices are slow; samples: URL map or `--samples-dir DIR` (local folders, also as `ir`; `strudel bounce` re-uses a stem as a sample, Glyphcore/Strudel-craft#2); nothing preloaded.
- Licence: Strudel and superdough are AGPL-3.0-or-later; load unmodified. Sample packs vary (CC0 / CC-BY / CC-BY-SA); keep attribution. Shabda/freesound clips carry their own licences.

## 5. Our word-vocal toolchain (`engine/vocals`, `site/prelude/word.js`, #42-#46)

Built on main; nothing here patches Strudel. A bank is cut from one stem plus its lyrics and played back as ordinary samples.

| Part | Command / call | State |
|---|---|---|
| Build a bank | `engine/vocals/wordbank.sh STEM.wav LYRICS.txt OUT_DIR [--bank vox] [--syll rule\|pyphen] [--aligner whisperx\|mfa] [--per-section] [--own-file]` | built (CLI, needs the aligner locally) |
| Bank output | `OUT/ogg/`, `OUT/strudel.json`, `OUT/pitched/strudel.json` (keys `vox_<word>`, `vox_<word>_s<k>`, `vox_syl`; `pitched` carries the sung base note so `note()` retunes) | built |
| Play it | `word("<call me baby>")`, `word("baby:2")` (take index), `syl("0 1 2")`, `vowel("<a o>")` | built (site prelude #43) |
| Banks on the site | `data/vox/demo` (espeak-ng speech, auto-loaded on the first `word()`), `data/vox/call-me-baby` (owner stem), `data/vox/ljspeech` (~500 words, LJSpeech, public domain, lazy per-word fetch) and `data/vox/vocalset` (sustained sung vowels, VocalSet, CC BY 4.0, keys `vs_<vowel>_<technique>`); `voxBank(name\|url)`, `voxBank()` folder picker, `voxBank.list()`; each bank carries its licence in its `README.md` | built |
| Word completions | `engine/vocals/complete.py PREFIX [--samples-dir D] [--config providers.json] [--kind word\|syllable\|sample]`; providers `samples-dir` (strudel.json) and `wordbank` (words.json), plus `module:` plugins. The site reads the same item shape from `data/intellisense/words.json`, built from the `demo` and `call-me-baby` banks | built (#44) |
| Formant-preserving variants | `wordbank.sh ... --formant-steps -12..12 [--formant-backend pyworld\|rubberband]` -> `OUT/formant/wav/<key>_f<semi>__<n>.wav` + `OUT/formant/strudel.json` (`vox_<word>_f<semi>`); gate with `python3 engine/vocals/formant.py --selftest --backend all` | built at build time (#45). pyworld (MIT, in-process WORLD) passes the selftest; the external `rubberband --formant` binary (GPL-2, spawned, never linked or vendored) is approximate and fails 3 of its 4 vowels - the selftest reports that instead of hiding it |
| Picking a variant at play time | `word(...).formant(true)` (nearest pre-rendered step, residual <= 50 cents applied with `speed`) | **coming** (#57): the helper contract is in `formant.py`, the Strudel-side call is not built. The Syntax view marks the example "coming" |
| Missing lyric words | `wordbank.sh ... --tts-fallback` fetches Shabda speech clips for words absent from the stem | built, opt-in (#46). Without the flag `tts_fallback.py` is never imported and the run makes no network call; each clip is recorded in `words.json` with `source: 'tts'`, its URL and a plain licence note (Shabda publishes no per-clip licence) |

Licences per bank part are listed in `engine/vocals/LICENSES.md`; neither formant variants nor TTS clips are baked into the two
site banks today.
