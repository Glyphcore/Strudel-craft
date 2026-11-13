# Sung word bank: decision and build path (#79)

Status: **built without .NET** (2026-11-13). `site/data/vox/sung/` is rendered by `engine/vocals/build_sung_bank.py` and registered as `voxBank('sung')`.

## What blocked it, and what actually mattered
| Earlier blocker | Finding |
|---|---|
| No .NET runtime for OpenUtau | Not needed. OpenUtau is a front-end; the DiffSinger models are ONNX and can be driven from Python (see "DiffSinger without OpenUtau"). A no-root .NET install is also possible here (below). |
| GitHub API / release downloads blocked | Still blocked (`github.com` git and release URLs, `codeload.github.com`: 403). `raw.githubusercontent.com`, `huggingface.co`, `pypi.org`, `zenodo.org`, `builds.dotnet.microsoft.com`, `api.nuget.org` are reachable, which is enough. |
| DiffSinger voicebanks licence-less or CC BY-NC-ND | **The real blocker**, and it stays: no English DiffSinger voicebank with CC0 / CC BY / MIT / Apache terms was found. |

## Chosen path: SoulX-Singer (Apache-2.0) + a VocalSet timbre prompt (CC BY 4.0)
- Model: `Soul-AILab/SoulX-Singer` `model.pt` (2.8 GB, sha256 `447eaf41f91a6b66...`), zero-shot singing synthesis for English / Mandarin / Cantonese. Licence read from the source:
  `LICENSE` in github.com/Soul-AILab/SoulX-Singer is the Apache License 2.0 text; the README says "We use the Apache 2.0 license. Researchers and developers are free to use
  the codes and model weights"; the Hugging Face model card is tagged `license: apache-2.0`. The README's usage disclaimer asks not to impersonate people without
  authorisation; the prompt voice here is a dataset singer released under CC BY 4.0 for reuse.
- Being zero-shot, it needs no voicebank: the timbre comes from ~5 s of prompt audio. The prompt is cut from the VocalSet bank already shipped on the site
  (`female6`, straight long tones a/e/i/o/u at c5), so every input has redistributable terms.
- Runtime: PyTorch on CPU (installed), plus `g2p_en`, `rotary_embedding_torch`, `accelerate` from PyPI and the CMUdict / tagger NLTK data. Nothing vendored;
  the model code is imported from a checkout passed with `--code`, the checkpoint is loaded with `weights_only=True`.
- Control: score mode. One note per word (ARPAbet phonemes, MIDI pitch, 0.70 s), 0.30 s rests, 8 words per segment at one pitch. No f0 curve is given; the model sings its own
  onsets and vibrato. Clips are cut on the known note grid, so no aligner is involved.
- Cost measured here (4 CPU cores): about 30 to 45 s per 8.3 s segment at 8 steps; 125 segments for 200 words x 5 pitches took about 90 minutes.
- Pitch grid: d#3 a3 d#4 a4 d#5 (two octaves, tritone steps), so `note()` never retunes a clip by more than 3 semitones. g5 was probed and rejected: the output there has no
  stable pitch. 16 vs 8 flow steps: same pitch accuracy and the same wav2vec2 transcripts at c4, so 8 is used.
- QC per clip (pYIN): kept if the median f0 is within 80 cents of the target, at least 25 % of frames are voiced and the rest after the note drops 15 dB or more. Result: 998 of 1000 clips kept, median error 11 cents, 95th percentile 31 cents. Numbers are in `site/data/vox/sung/words.json` (`summary`).
- Not checked: nobody has listened to the clips (headless machine). A speech recogniser (wav2vec2-base-960h) reads back 58 to 60 % of the words exactly at d#3, a3 and d#4,
  35 % at a4 and 6 % at d#5. Recognisers trained on speech do badly on high sung notes, so this cannot tell a weak d#5 from a hard-to-recognise one; the owner listening pass is
  an open acceptance box in #79.

Rebuild:

    python3 engine/vocals/build_sung_bank.py --code SOULX_CHECKOUT --model model.pt --work WORK --limit 200 --steps 8 --notes "d#3 a3 d#4 a4 d#5"
    node tests/site/vox.mjs

`SOULX_CHECKOUT`: `git clone https://huggingface.co/spaces/Soul-AILab/SoulX-Singer` (same code as the GitHub repo, reachable from the sandbox);
`model.pt`: `https://huggingface.co/Soul-AILab/SoulX-Singer/resolve/main/model.pt`. With transformers newer than 4.53 the script sets the attention implementation itself.

## Alternatives, with the reason each lost
| Option | Verdict |
|---|---|
| DiffSinger ONNX with our own driver (onnxruntime Python, or onnxruntime-web WASM in Node / the browser) | Technically fine, see below. Lost on voicebank licences only. Reopen if a CC BY / CC0 English bank appears. |
| .NET 8 + OpenUtau CLI | Runtime: `curl -L https://dot.net/v1/dotnet-install.sh | bash -s -- --runtime dotnet --channel 8.0 --install-dir ~/.dotnet` works without root (script and tarballs come from `builds.dotnet.microsoft.com`, reachable; `api.nuget.org` reachable). `pip install dotnet` is not a runtime. OpenUtau binaries would need `github.com` release downloads and `release-assets.githubusercontent.com` / `objects.githubusercontent.com` allowed. Same voicebank licence problem, so not pursued. |
| Sinsy / HTS voice `nitech_jp_song070_f001` (CC BY 3.0), `pysinsy` | Open and light, but Japanese only. |
| ESPnet SVS models on Hugging Face (CC BY 4.0: ofuton, oniku, kiritan, opencpop, m4singer) | Japanese / Mandarin only; several are trained on non-commercial corpora. |
| NNSVS / ENUNU | Same language and corpus-licence limits as above. |
| espeak-ng or LJSpeech words + WORLD f0 flattening (pyworld) | Fully open and cheap, but it is retuned speech with a flat pitch, not a sung voice. Kept as the fallback if the listening pass fails. |
| Coqui TTS and other open TTS | No singing model with pitch control. |
| Live WASM singing in the browser | Model sizes (2.8 GB here) rule it out; a pre-rendered bank is the right shape for a static site. |

## DiffSinger without OpenUtau (kept for later)
Read from `OpenUtau.Core/DiffSinger/*.cs` (stakira/OpenUtau, master). A voicebank is `dsconfig.yaml` + `phonemes.txt` + ONNX files; the render is five sessions:
1. Linguistic encoder + duration (`dsdur`): `tokens`, `word_div`, `word_dur` (+ `languages`, `spk_embed`) -> `encoder_out`, `x_masks`; then `ph_midi` -> `ph_dur`.
2. Pitch (`dspitch`): `tokens`, `word_div`, `word_dur`, `ph_dur` -> `encoder_out`; then `note_midi`, `note_dur`, `note_rest`, `ph_dur`, `pitch`, `retake`, `expr`, `steps` / `speedup` -> f0.
3. Variance (`dsvariance`): encoder as above; then `ph_dur`, `pitch`, `retake` -> `energy`, `breathiness`, `voicing`, `tension`.
4. Acoustic: `tokens`, `durations`, `f0`, `depth`, `steps` (or `speedup`), optional `gender`, `velocity`, variance curves, `spk_embed`, `languages` -> `mel`.
5. Vocoder (NSF-HiFiGAN, `vocoder.yaml`): `mel`, `f0` -> waveform (44.1 kHz, hop 512).
Durations are in frames (hop / sample rate from `dsconfig.yaml`), pitch in MIDI or Hz as the config says. All of it runs in `onnxruntime` 1.29 (installed) with numpy; a driver is a few hundred lines.
