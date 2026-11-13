# Licences (engine/vocals)

| Component | Licence | Use |
|---|---|---|
| whisperX (m-bain/whisperX) | BSD-2-Clause | optional alignment stage only (`--aligner whisperx`), not vendored |
| wav2vec2 `WAV2VEC2_ASR_BASE_960H` (torchaudio / facebook/wav2vec2-base-960h) | Apache-2.0 | alignment model loaded by whisperX for English |
| pyphen | GPL-2.0+ / LGPL-2.1+ / MPL-1.1 (tri-licence; used under LGPL) | optional `--syll pyphen`, unmodified library dep, falls back to built-in rule |
| librosa, soundfile, numpy | ISC / BSD-3 / BSD-3 | slicing, pyin f0 |
| Rejected: torchaudio MMS_FA (model CC-BY-NC), Gentle, MFA (MIT, alt backend, external) | | |

No model weights or third-party code are vendored in this repo.
