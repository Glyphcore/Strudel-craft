# glyphcore/drawn-core

Two original instruments of kind `waveforms@1` (docs/DRAWN_WAVEFORMS.md, #182 stage 2): `wt_drawn_bass` (single cycle, two registers) and `wt_drawn_choir` (three-keyframe vowel morph, two registers; a stand-in, not a choir). Data only, no audio; the wavetables are built in the page the first time a program names a `wt_drawn_*` sound (`packs.activateSources`, same path as the referenced sample sources). Two recipes, `drawn-bass-line` and `drawn-choir-pad`. Test: `node tests/site/drawn_pack.mjs`.
