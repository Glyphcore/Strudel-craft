# Sung word bank (OpenUtau / DiffSinger): status and path

Not built in this environment. Findings (2026-11-13): no `dotnet` runtime installed, GitHub API/release downloads are blocked by the sandbox proxy (403/404),
and the DiffSinger/OpenUtau voicebanks found on Hugging Face are either licence-less or non-commercial / no-derivatives (e.g. cc-by-nc-nd-4.0), which forbids redistribution
of renders. Per the rule "never ship what the terms forbid", `site/data/vox/sung/` is intentionally absent and not registered in `voxBank.list()`.

Path to add it:
1. Pick a voicebank whose licence allows redistributing rendered audio (CC0 / CC BY / explicit permission); record the licence in LICENSES.md.
2. Install .NET 8 + OpenUtau (CLI render: `OpenUtau.Core` with the DiffSinger renderer) or run the DiffSinger ONNX acoustic model + vocoder directly with onnxruntime (installed, 1.29).
3. Write one UST/MIDI note per word x pitch (2 octaves, e.g. c3..c5 in thirds), lyric = word phonemes, render to wav, then `python3 engine/vocals/wordbank.py STEM LYRICS site/data/vox/sung --timings T.json --own-file` (timings are known from the note grid), convert to ogg like `build_site_bank.py`.
4. Add `sung: { url: root + 'sung/pitched/strudel.json' }` to `banks` in `site/prelude/word.js`, a Syntax example, and a vox.mjs check.
