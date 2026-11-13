# ljspeech bank

500 common English and lyric words (1 to 3 takes each, 1,460 clips) cut from **LJSpeech 1.1** (Keith Ito, https://keithito.com/LJ-Speech-Dataset/): a single speaker reading
public-domain non-fiction books (LibriVox recordings). Licence: **public domain** (no restrictions; credit given anyway).
Processing: first 2,500 utterances force-aligned with whisperX (wav2vec2-base-960h), best-scored word takes cut and peak-normalised by `engine/vocals/wordbank.py`
(`--timings`), mono 22.05 kHz ogg (`engine/vocals/build_ljspeech_bank.py`). Syllable keys dropped. Audio files are fetched lazily, only when a word is played.

Keys `vox_<word>` (flat `strudel.json`, natural pitch) and the note()-retunable `pitched/strudel.json` (which `voxBank` loads). Words missing here fall back to the demo bank.

    await voxBank('ljspeech')
    $: word("<love fire night>").note("<c3 e3 g3>")

Data is read speech, not sung: pitched use is speed-shift retuning (formants move). Licence table: engine/vocals/LICENSES.md.
