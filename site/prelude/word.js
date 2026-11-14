// word-vocals P2 (#43): user-space prelude, plain JS, Strudel unmodified. Load before the pattern (CLI: --prelude FILE; site: prepend the file text).
// word('<call me baby>')   -> s('vox_call vox_me vox_baby') mini-notation kept; word('baby:2') = 3rd occurrence of "baby" (n index)
// word('baby', 'tag')      -> other bank prefix (wordbank --bank tag)
// syl('0 1 2')             -> s('vox_syl').n('0 1 2')  (all syllables in lyric order)
// Repitch: use the bank's pitched map (OUT_DIR/pitched/strudel.json, base note = sung MIDI) so .note('c4') retunes by speed shift (formants move).
// vowel() works unchanged (fixed formant filter).
// Banks: the demo bank (espeak-ng speech) auto-loads on first word(). voxBank('call-me-baby') switches to the owner's vocal bank (keys it lacks fall back to demo);
//   voxBank('ljspeech') = ~500 common English/lyric words from LJSpeech (public domain, keys vox_<word>, 1-3 takes; word() works); voxBank('vocalset') = sustained sung vowels (CC BY 4.0, keys vs_<a|e|i|o|u>[_straight|_forte|_pp|_messa|_trill], use s('vs_a').note('c4'), no word());
//   voxBank('sung') = 200 English words sung at d#3 a3 d#4 a4 d#5 (SoulX-Singer render, Apache-2.0; timbre prompt VocalSet, CC BY 4.0; keys vox_<word>, word() works, note() picks the nearest sung pitch).
// word(...).note(x).formant(true): picks the pre-rendered formant variant vox_<word>_f<semi> nearest to the requested shift (bank built with --formant-steps), then
//   fine-tunes the residual (<= 50 cents inside the built range) with speed; no variants in the bank -> plain note() retune + one warning (site toast; stderr in the CLI).
//   Shift = note - the word's sung base note (from the pitched map); if the base is unknown a numeric note is taken as the semitone shift itself.
//   voxBank(url) loads strudel.json from a URL (or a folder URL ending in /); voxBank() opens a folder picker (stays in the browser); voxBank.list() -> [{name,url,words,clips,notes,kind,prefix,licence,active}]; voxBank.words(name) -> Promise<[{name,key,takes,notes}]>; voxBank.active().
//   Every switch fires a 'vox:bank' event ({detail:{name}}) so the site's completions and Banks browser follow it.
(function () {
  const here = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : '');
  const root = (() => { try { return new URL('../data/vox/', here).href; } catch (e) { return 'data/vox/'; } })();
  const banks = { demo: { url: root + 'demo/pitched/strudel.json' }, 'call-me-baby': { url: root + 'call-me-baby/pitched/strudel.json' },
    ljspeech: { url: root + 'ljspeech/pitched/strudel.json' }, vocalset: { url: root + 'vocalset/pitched/strudel.json' }, sung: { url: root + 'sung/pitched/strudel.json' } };
  let active = null, boot = null, fvars = {}, fbase = {}, fwarned = false;
  const toast = (m, kind) => { const u = globalThis.window && window.strudelCraft && window.strudelCraft.ui; if (u && u.toast) u.toast(m, { kind: kind || 'info', ms: 6000 }); else console.warn('[vox] ' + m); };
  const register = async (name, jsonUrl, map) => {
    if (!map) { const r = await fetch(jsonUrl); if (!r.ok) throw new Error('HTTP ' + r.status); map = await r.json(); }
    await globalThis.samples(map, jsonUrl.replace(/[^/]*$/, ''));
    fvars = {}; fbase = {}; fwarned = false; const mid = (n) => { try { return globalThis.noteToMidi(n); } catch (e) { return undefined; } };
    for (const [k, v] of Object.entries(map)) { // formant variants vox_<word>_f<semi>; sung base note of each pitched word
      const m = /^(.+)_f(-?\d+)$/.exec(k); if (m) (fvars[m[1]] = fvars[m[1]] || []).push(Number(m[2]));
      else if (v && !Array.isArray(v)) { const b = mid(Object.keys(v)[0]); if (b !== undefined) fbase[k] = b; }
    }
    const b = (banks[name] = banks[name] || {}); b.url = jsonUrl; b.map = map; b.words = Object.keys(map).filter((k) => !SKIPK.test(k)).length; active = name; changed(name); return name;
  };
  const SKIPK = /_s\d+$|_syl$|^_|_f-?\d+$/; // syllables, the syllable index, private keys, formant variants
  const changed = (name) => { try { globalThis.dispatchEvent && globalThis.dispatchEvent(new CustomEvent('vox:bank', { detail: { name } })); } catch (e) { /* no DOM events (CLI) */ } };
  // entries of a sample map: one per key, with its takes (clip count) and pitches (the notes of a pitched map)
  const entriesOf = (map) => Object.entries(map || {}).filter(([k]) => !SKIPK.test(k)).map(([key, v]) => { const notes = v && !Array.isArray(v) ? Object.keys(v) : [];
    return { name: key.replace(/^[a-z0-9]+_/, ''), key, takes: notes.length ? Math.max(...Object.values(v).map((us) => us.length)) : (v || []).length, clips: notes.length ? Object.values(v).reduce((a, us) => a + us.length, 0) : (v || []).length, notes }; });
  const statsOf = (map) => { const es = entriesOf(map), notes = [...new Set(es.flatMap((e) => e.notes))]; return { words: es.length, clips: es.reduce((a, e) => a + e.clips, 0), notes, kind: es.length && es.every((e) => !/^vox_/.test(e.key)) ? 'sound' : 'word', prefix: es.length ? es[0].key.split('_')[0] : 'vox' }; };
  const NOBANK = 'No vocal bank loaded. Run voxBank() to pick a folder, or voxBank("https://.../strudel.json") to load one from a URL.';
  const load = (name, url) => register(name, url).catch((e) => { toast(NOBANK + ' (' + name + ': ' + e.message + ')', 'error'); throw e; });
  const ensure = () => (boot = boot || load('demo', banks.demo.url).catch(() => { boot = null; }));
  const pick = () => new Promise((ok, no) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true; inp.style.display = 'none';
    inp.onchange = async () => {
      try {
        const files = [...inp.files]; const rel = (f) => f.webkitRelativePath.split('/').slice(1).join('/');
        const jf = files.find((f) => rel(f) === 'pitched/strudel.json') || files.find((f) => rel(f) === 'strudel.json');
        if (!jf) throw new Error('no strudel.json in that folder');
        const dir = rel(jf).replace(/[^/]*$/, ''), map = JSON.parse(await jf.text()), blobs = {}, out = {};
        for (const f of files) blobs[rel(f)] = f;
        const res = (u) => { const parts = []; for (const seg of (dir + String(u).replace(/^file:\/\//, '').replace(/^.*\/wav\//, 'wav/')).split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); } const f = blobs[parts.join('/')]; if (!f) throw new Error('missing file ' + u); return URL.createObjectURL(f); };
        for (const [k, v] of Object.entries(map)) out[k] = Array.isArray(v) ? v.map(res) : Object.fromEntries(Object.entries(v).map(([n, us]) => [n, us.map(res)]));
        const name = (jf.webkitRelativePath.split('/')[0] || 'folder');
        await register(name, 'local:' + name + '/strudel.json', out); toast('Loaded vox bank "' + name + '"', 'ok'); ok(name);
      } catch (e) { toast(NOBANK + ' (' + e.message + ')', 'error'); no(e); } finally { inp.remove(); }
    };
    document.body.append(inp); inp.click();
  });
  globalThis.voxBank = (src) => {
    if (src === undefined) return pick();
    if (src && typeof src.queryArc === 'function') { try { const v = src.queryArc(0, 1)[0].value; src = Array.isArray(v) ? v.join('') : v; } catch (e) { src = String(src); } } // "double quoted" strings arrive as mini Patterns; prefer 'single quotes'
    { const pk = globalThis.strudelCraft && globalThis.strudelCraft.packs; if (typeof src === 'string' && pk && pk.hasBank && pk.hasBank(src)) return pk.activateBank(src).then((id) => { active = id; changed(id); return id; }); } // vox-bank pack ingredients (manual load)
    if (banks[src]) return (src === 'demo' ? ensure().then(() => { if (active !== 'demo' && banks.demo.map) return register('demo', banks.demo.url, banks.demo.map); }) : ensure().then(() => (banks[src].map && /^local:/.test(banks[src].url) ? register(src, banks[src].url, banks[src].map) : load(src, banks[src].url)))).then(() => active); // a folder bank re-registers from memory
    let u = String(src); if (/\/$/.test(u)) u += 'pitched/strudel.json';
    return load(u.split('/').slice(-3, -1).join('/') || 'custom', u);
  };
  // list(): every bank this prelude or the pack loader knows, with kind (word / sound), counts, pitches and licence. Counts come from the bank's map once it
  // is loaded, or from the site's bank index (strudelCraft.voxBanks, filled when the Banks browser or a completion first reads it); unknown stays undefined.
  const vb = () => globalThis.strudelCraft && globalThis.strudelCraft.voxBanks;
  const rich = (name, b, extra) => { const st = b && b.map ? statsOf(b.map) : null, ix = (vb() && vb().info && vb().info(name)) || {};
    return { name, url: b ? b.url : undefined, words: st ? st.words : (b && b.words) ?? ix.words, clips: st ? st.clips : ix.clips, notes: ix.notes && ix.notes.length ? ix.notes : st ? st.notes : ix.notes, range: ix.range,
      kind: ix.kind || (st ? st.kind : undefined), prefix: ix.prefix || (st ? st.prefix : undefined), license: ix.license, licence: ix.licence, attribution: ix.attribution, source: ix.source || (banks[name] && !ix.name ? 'user' : undefined), active: name === active, ...extra }; };
  globalThis.voxBank.list = () => Object.entries(banks).map(([name, b]) => rich(name, b)).concat(((globalThis.strudelCraft && globalThis.strudelCraft.packs && globalThis.strudelCraft.packs.banks && globalThis.strudelCraft.packs.banks()) || []).map((b) => rich(b.id, null, { name: b.name, url: b.id, pack: b.pack, active: b.id === active })));
  // words(name): the entries of one bank ([{name, key, takes, notes, ...}]). The site reads them through its pack loader (strudelCraft.voxBanks.words);
  // elsewhere (CLI) from the bank's map once loaded, else from its strudel.json.
  globalThis.voxBank.words = async (name = active || 'demo') => {
    if (vb() && vb().words) return vb().words(name);
    const b = banks[name]; if (b && b.map) return entriesOf(b.map); if (!b || !b.url) throw new Error('unknown vox bank ' + name);
    const r = await fetch(b.url); if (!r.ok) throw new Error('HTTP ' + r.status); return entriesOf(await r.json());
  };
  globalThis.voxBank.active = () => active;
  globalThis.voxBank.mapOf = (name) => (banks[name] && banks[name].map ? { map: banks[name].map, url: banks[name].url } : null); // a registered bank's sample map (no fetch)
  if (typeof samples === 'function') setTimeout(ensure, 0); // json only; audio files stream lazily
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
  const warnF = () => { if (!fwarned) { fwarned = true; toast('formant(true): this bank has no formant variants (build it with wordbank --formant-steps); using the plain note() retune.', 'warn'); } };
  const formantOf = (v) => {
    if (!v || typeof v !== 'object' || typeof v.s !== 'string' || v.note === undefined) return v;
    const vs = fvars[v.s]; if (!vs || !vs.length) { warnF(); return v; }
    const n = typeof v.note === 'number' ? v.note : globalThis.noteToMidi(v.note), off = n - (fbase[v.s] !== undefined ? fbase[v.s] : (typeof v.note === 'number' ? 0 : 60));
    const semi = vs.reduce((a, b) => (Math.abs(b - off) < Math.abs(a - off) ? b : a)), { note, ...rest } = v;
    return { ...rest, s: v.s + '_f' + semi, speed: (v.speed === undefined ? 1 : v.speed) * 2 ** ((off - semi) / 12) };
  };
  const addFormant = (P) => { if (P && !P.formant) P.formant = function (on = true) {
    if (on && typeof on.queryArc === 'function') { try { on = on.queryArc(0, 1)[0].value; } catch (e) { /* keep */ } }
    return on === false || on === 0 || on === 'false' ? this : this.fmap(formantOf);
  }; return P; };
  if (globalThis.Pattern) addFormant(globalThis.Pattern.prototype);
  const withF = (p) => (addFormant(Object.getPrototypeOf(p)), p);
  globalThis.word = (str, bank = 'vox') => withF((ensure(), typeof str === 'string' ? mini(str) : str).fmap((v) => tok(v, bank)));
  globalThis.syl = (str, bank = 'vox') => withF(s(bank + '_syl').n(str));
})();
