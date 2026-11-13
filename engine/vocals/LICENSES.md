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
