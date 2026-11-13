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
| Speech / TTS | Shabda speech samples (see above) | third-party service, network, licence per sample |
| Pitch-shift a sample | `speed`, `note()` on a pitched map | shifts formants and duration together (chipmunk) |
| Granular-ish | `chop`, `striate`, `slice`, `scrub`, `begin/end` | event-level, not a grain cloud; no per-grain random pitch/pan |
| Vocoder / harmonizer | none | no carrier/modulator input |
| Live sampling / recording | no mic input or recorder found in docs or the input-output page; community threads request it (https://club.tidalcycles.org/t/baked-in-support-for-midi-in-audio-in-and-audio-devices-channels/5098) | UNVERIFIED, treat as absent |
| Soundfonts | `gm_*` names (e.g. `gm_alto_sax`) appear under synths in the REPL; no docs page found (earlier 404 in PLUGINS.md) | UNVERIFIED; in our CLI only if the package loads and fetches the soundfont data over network |
| Reverb IR | `ir`/`iresponse` uses a loaded sample as the impulse response | documented (effects); custom IR = any wav in a map |

## 4. superdough / engine limits

- superdough is a sampler plus synth (`registerSound`, `registerSynthSounds`); the README documents no custom worklet API, no mic and no soundfonts (README read: gaps stated).
- Fixed effect chain per voice, then per-orbit delay/reverb; `duckorbit` is the only cross-bus modulation. No envelope follower, no external sidechain input.
- Our CLI renders offline on node-web-audio-api with superdough's own worklets (supersaw, pulse, distort, crush, coarse, shape, ladder, LFOs); worklet voices are slow; samples must be a URL map; no local folder; nothing preloaded.
- Licence: Strudel and superdough are AGPL-3.0-or-later; load unmodified. Sample packs vary (CC0 / CC-BY / CC-BY-SA); keep attribution. Shabda/freesound clips carry their own licences.
