// word-vocals P2 (#43): user-space prelude, plain JS, Strudel unmodified. Load before the pattern (CLI: --prelude FILE; site: prepend the file text).
// word('<call me baby>')   -> s('vox_call vox_me vox_baby') mini-notation kept; word('baby:2') = 3rd occurrence of "baby" (n index)
// word('baby', 'tag')      -> other bank prefix (wordbank --bank tag)
// syl('0 1 2')             -> s('vox_syl').n('0 1 2')  (all syllables in lyric order)
// Repitch: use the bank's pitched map (OUT_DIR/pitched/strudel.json, base note = sung MIDI) so .note('c4') retunes by speed shift (formants move).
// vowel() works unchanged (fixed formant filter).
(function () {
  const slug = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'x';
  globalThis.wordKey = (w, bank = 'vox') => bank + '_' + slug(w);
  // the transpiler turns "..." into a Pattern, so accept Pattern or plain string
  // one token -> control object {s: bank_word[, n]}; 'baby:2' (mini gives ['baby','2'] or 'baby:2') = n-th occurrence
  const tok = (v, bank) => {
    const [w, n] = Array.isArray(v) ? v.map(String) : String(v).split(':');
    const o = { s: bank + '_' + slug(w) };
    if (n !== undefined && n !== '') o.n = Number(n);
    return o;
  };
  globalThis.word = (str, bank = 'vox') => (typeof str === 'string' ? mini(str) : str).fmap((v) => tok(v, bank));
  globalThis.syl = (str, bank = 'vox') => s(bank + '_syl').n(str);
})();
