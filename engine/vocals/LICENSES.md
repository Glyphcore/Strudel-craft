# Licences (engine/vocals)

| Component | Licence | Use |
|---|---|---|
| whisperX (m-bain/whisperX) | BSD-2-Clause | optional alignment stage only (`--aligner whisperx`), not vendored |
| wav2vec2 `WAV2VEC2_ASR_BASE_960H` (torchaudio / facebook/wav2vec2-base-960h) | Apache-2.0 | alignment model loaded by whisperX for English |
| pyphen | GPL-2.0+ / LGPL-2.1+ / MPL-1.1 (tri-licence; used under LGPL) | optional `--syll pyphen`, unmodified library dep, falls back to built-in rule |
| librosa, soundfile, numpy | ISC / BSD-3 / BSD-3 | slicing, pyin f0 |
| pyworld (JeremyCCHsu/Python-Wrapper-for-World-Vocoder; WORLD vocoder by M. Morise) | MIT (wrapper; WORLD is modified-BSD) | `formant.py` default backend: f0 shift with spectral envelope kept (`--formant-steps`) |
| rubberband (breakfastquay) | GPL-2.0+ (commercial alt. exists) | optional `--formant-backend rubberband`: run only as a separate process (`rubberband -3 --formant -p N`), never linked, vendored or bundled; skipped if the binary is absent |
| scipy | BSD-3 | selftest vowel synthesis only |
| Rejected: torchaudio MMS_FA (model CC-BY-NC), Gentle, MFA (MIT, alt backend, external) | | |

No model weights or third-party code are vendored in this repo.

| Shabda speech (shabda.ndre.gr; speech via Google TTS) | no per-clip licence published | optional `--tts-fallback` (opt-in, network): clips recorded in words.json as `source:tts` with URL and licence note; verify provider terms before redistributing |

## Site vox banks (site/data/vox/)

| Bank | Source | Licence / permission |
|---|---|---|
| `demo/` | espeak-ng (GPL-3.0+) speech, rendered locally by `build_demo_bank.py` and run through `wordbank.py`; clips are mono 22.05 kHz ogg. espeak-ng is run as a separate process and not bundled. | Synthesised speech output is not covered by the espeak-ng GPL; shipped as CC0 / free to redistribute. No Suno or user audio. |
| `call-me-baby/` | The site owner's own Call Me Baby vocal stem (`tracks/call-me-baby/stems_stitched/vocals.wav`, handle matches `data/suno/owners.json`), sliced by `build_site_bank.py` (wordbank.py, `--own-file`). | Published on the site with the owner's explicit permission (2026-11-13). Not licensed for reuse by others. |
| `ljspeech/` | LJSpeech 1.1 (Keith Ito, https://keithito.com/LJ-Speech-Dataset/), LibriVox readings of public-domain books. A 2,500-utterance subset is force-aligned (whisperX/wav2vec2) and ~500 words are cut by `build_ljspeech_bank.py` (wordbank.py `--timings`). | Public domain (dataset page: "public domain", no restrictions). Credit given in the bank README. Mono 22.05 kHz ogg. |
| `vocalset/` | VocalSet 1.2 (Wilkins et al., ISMIR 2018; Zenodo 1193957), `long_tones` of 8 singers, cut by `build_vocalset_bank.py`. | CC BY 4.0: redistribution and modification allowed with attribution (in the bank README); changes noted there (trimmed, faded, normalised, resampled). |
| `sung/` (not shipped) | OpenUtau / DiffSinger voicebank pre-render. See `engine/vocals/SUNG.md`. | No voicebank with verified redistribution terms was available (and no .NET runtime here), so nothing is bundled. Commercial packs (Splice etc.) are never shipped. |

Each bank has `strudel.json` (flat, natural pitch), `pitched/strudel.json` (note()-retunable) and `words.json`; `site/prelude/word.js` loads the pitched map.
