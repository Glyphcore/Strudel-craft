# Vox banks: licences per bank

Pack `glyphcore/vox` (site/data/vox/craftpack.json) lists what each bank holds; every ingredient carries its own licence and attribution.

| bank | licence | credit |
|---|---|---|
| demo | first-party render, licence open (#66) | rendered with espeak-ng (the tool is GPL-3.0; the rendered audio is first-party) |
| call-me-baby | the owner's own vocals, licence open (#66) | the site owner's vocal stem, cut into words |
| ljspeech | public domain | LJSpeech 1.1 (Keith Ito, https://keithito.com/LJ-Speech-Dataset/; LibriVox readings) |
| vocalset | CC BY 4.0 | "VocalSet: A Singing Voice Dataset, Julia Wilkins et al., https://doi.org/10.5281/zenodo.1193957" (trimmed, faded, normalised) |
| sung | Apache-2.0 (SoulX-Singer render) and CC BY 4.0 (VocalSet timbre prompt) | SoulX-Singer (Soul-AILab); timbre prompt VocalSet female6, CC BY 4.0 |

Detail per bank: the README.md in each bank folder. Regenerate the index with `python3 tools/vox/bank_index.py`.
