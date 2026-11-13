// word-vocals P2 (#43): user-space prelude, plain JS, Strudel unmodified. Load before the pattern (CLI: --prelude FILE; site: prepend the file text).
// word('<call me baby>')   -> s('vox_call vox_me vox_baby') mini-notation kept; word('baby:2') = 3rd occurrence of "baby" (n index)
// word('baby', 'tag')      -> other bank prefix (wordbank --bank tag)
// syl('0 1 2')             -> s('vox_syl').n('0 1 2')  (all syllables in lyric order)
// Repitch: use the bank's pitched map (OUT_DIR/pitched/strudel.json, base note = sung MIDI) so .note('c4') retunes by speed shift (formants move).
// vowel() works unchanged (fixed formant filter).
// Banks: the demo bank (espeak-ng speech) auto-loads on first word(). voxBank('call-me-baby') switches to the owner's vocal bank (keys it lacks fall back to demo);
//   voxBank('ljspeech') = ~500 common English/lyric words from LJSpeech (public domain, keys vox_<word>, 1-3 takes; word() works); voxBank('vocalset') = sustained sung vowels (CC BY 4.0, keys vs_<a|e|i|o|u>[_straight|_forte|_pp|_messa|_trill], use s('vs_a').note('c4'), no word()).
// word(...).note(x).formant(true): picks the pre-rendered formant variant vox_<word>_f<semi> nearest to the requested shift (bank built with --formant-steps), then
//   fine-tunes the residual (<= 50 cents inside the built range) with speed; no variants in the bank -> plain note() retune + one warning (site toast; stderr in the CLI).
//   Shift = note - the word's sung base note (from the pitched map); if the base is unknown a numeric note is taken as the semitone shift itself.
//   voxBank(url) loads strudel.json from a URL (or a folder URL ending in /); voxBank() opens a folder picker (stays in the browser); voxBank.list() -> [{name,url,words,active}].
(function () {
  const here = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : '');
  const root = (() => { try { return new URL('../data/vox/', here).href; } catch (e) { return 'data/vox/'; } })();
  const banks = { demo: { url: root + 'demo/pitched/strudel.json' }, 'call-me-baby': { url: root + 'call-me-baby/pitched/strudel.json' },
    ljspeech: { url: root + 'ljspeech/pitched/strudel.json' }, vocalset: { url: root + 'vocalset/pitched/strudel.json' } };
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
    const b = (banks[name] = banks[name] || {}); b.url = jsonUrl; b.words = Object.keys(map).filter((k) => !/_s\d+$|_syl$|^_/.test(k)).length; active = name; return name;
  };
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
    { const pk = globalThis.strudelCraft && globalThis.strudelCraft.packs; if (typeof src === 'string' && pk && pk.hasBank && pk.hasBank(src)) return pk.activateBank(src).then((id) => { active = id; return id; }); } // vox-bank pack ingredients (manual load)
    if (banks[src]) return (src === 'demo' ? ensure() : ensure().then(() => load(src, banks[src].url))).then(() => active);
    let u = String(src); if (/\/$/.test(u)) u += 'pitched/strudel.json';
    return load(u.split('/').slice(-3, -1).join('/') || 'custom', u);
  };
  globalThis.voxBank.list = () => Object.entries(banks).map(([name, b]) => ({ name, url: b.url, words: b.words, active: name === active })).concat(((globalThis.strudelCraft && globalThis.strudelCraft.packs && globalThis.strudelCraft.packs.banks && globalThis.strudelCraft.packs.banks()) || []).map((b) => ({ name: b.name, url: b.id, active: b.id === active })));
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
