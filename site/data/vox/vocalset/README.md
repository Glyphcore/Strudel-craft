# vocalset bank

Sustained sung vowels from **VocalSet** (Wilkins, Seetharaman, Wahl, Pardo; ISMIR 2018), Zenodo record 1193957, licence **CC BY 4.0**
(https://creativecommons.org/licenses/by/4.0/). Attribution: "VocalSet: A Singing Voice Dataset, Julia Wilkins et al., https://doi.org/10.5281/zenodo.1193957".
Modified: trimmed to the steadiest ~3 s, faded, peak-normalised, mono 22.05 kHz ogg. Singers: female2/4/6/8, male1/3/5/7; `long_tones` only.

Keys: `vs_<vowel>_<technique>` with vowel a/e/i/o/u and technique straight/forte/pp/messa/trill; `vs_<vowel>` = straight.
Each key is a pitched map `{note: [urls]}` (note = detected median f0 of each recording, several singers per key), so `.note()` retunes from the nearest recording.

    await voxBank('vocalset')
    $: s("vs_a vs_o").note("<c3 g3 e4>").slow(2).room(.6)

Built by `python3 engine/vocals/build_vocalset_bank.py RAW_DIR site/data/vox/vocalset` (RAW fetched with remotezip range reads from the Zenodo zip). Licence table: engine/vocals/LICENSES.md.
