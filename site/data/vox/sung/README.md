# sung bank

200 English words, each sung at five pitches two octaves wide (**d#3 a3 d#4 a4 d#5**): 998 clips, mono 22.05 kHz ogg, about 0.7 to 1.0 s each.
Synthesised offline, not recorded: no .NET, no OpenUtau, no DiffSinger voicebank.

- Engine: **SoulX-Singer** (Soul-AILab, https://github.com/Soul-AILab/SoulX-Singer, weights https://huggingface.co/Soul-AILab/SoulX-Singer), code and weights **Apache-2.0**.
  Score control: one note per word (CMUdict ARPAbet via g2p_en, MIDI pitch, 0.70 s), 8 flow steps, cfg 3, seed 7.
- Voice: the model is zero-shot; its timbre prompt is five straight long tones (a e i o u, c5) of singer `female6` from **VocalSet** (Wilkins, Seetharaman, Wahl, Pardo;
  ISMIR 2018), licence **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). Attribution: "VocalSet: A Singing Voice Dataset, Julia Wilkins et al.,
  https://doi.org/10.5281/zenodo.1193957". The clips are new synthetic audio in a voice derived from that prompt, not VocalSet recordings.
- Processing: cut on the score grid, trimmed at -30 dB, faded, peak-normalised to -1 dBFS, resampled to 22.05 kHz.

Keys `vox_<word>`. `pitched/strudel.json` (what `voxBank('sung')` loads) maps each word to `{note: [url]}`, so `note()` plays the nearest sung pitch and retunes it by at
most 3 semitones inside d#3 to d#5. `strudel.json` is the flat map (the d#4 take). Words missing here fall back to the demo bank.

    await voxBank('sung')
    $: word("<love fire night tonight>").note("<a3 c4 e4 a4>").room(.4)

Measured (`words.json`, `summary` and per clip): pitch error against the score, pYIN median per clip: median 11 cents, 95th percentile 31 cents, same at every pitch.
2 of 1000 clips rejected (`watch` and `just` at d#5 came out a fourth flat), so those two words have four pitches.
A speech recogniser (wav2vec2-base-960h) reads back 58 to 60 % of the words exactly at d#3, a3 and d#4, 35 % at a4 and 6 % at d#5. Speech recognisers do badly on high
sung notes, so the top pitch may be less clear than the others or only harder for the recogniser; **nobody has listened to this bank yet** (it was built on a headless machine).

Built by `python3 engine/vocals/build_sung_bank.py --code SOULX_CHECKOUT --model model.pt --work WORK --limit 200 --steps 8 --notes "d#3 a3 d#4 a4 d#5"`.
Decision record and alternatives: `engine/vocals/SUNG.md`. Licence table: `engine/vocals/LICENSES.md`.
