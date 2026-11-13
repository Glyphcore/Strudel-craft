// word-vocals P2 (#43): user-space prelude, plain JS, Strudel unmodified. Load before the pattern (CLI: --prelude FILE; site: prepend the file text).
// word('<call me baby>')   -> s('vox_call vox_me vox_baby') mini-notation kept; word('baby:2') = 3rd occurrence of "baby" (n index)
// word('baby', 'tag')      -> other bank prefix (wordbank --bank tag)
// syl('0 1 2')             -> s('vox_syl').n('0 1 2')  (all syllables in lyric order)
// Repitch: use the bank's pitched map (OUT_DIR/pitched/strudel.json, base note = sung MIDI) so .note('c4') retunes by speed shift (formants move).
// vowel() works unchanged (fixed formant filter).
// Banks: the demo bank (espeak-ng speech) auto-loads on first word(). voxBank('call-me-baby') switches to the owner's vocal bank (keys it lacks fall back to demo);
//   voxBank(url) loads strudel.json from a URL (or a folder URL ending in /); voxBank() opens a folder picker (stays in the browser); voxBank.list() -> [{name,url,words,active}].
(function () {
  const here = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : '');
  const root = (() => { try { return new URL('../data/vox/', here).href; } catch (e) { return 'data/vox/'; } })();
  const banks = { demo: { url: root + 'demo/pitched/strudel.json' }, 'call-me-baby': { url: root + 'call-me-baby/pitched/strudel.json' } };
  let active = null, boot = null;
  const toast = (m, kind) => { const u = globalThis.window && window.strudelCraft && window.strudelCraft.ui; if (u && u.toast) u.toast(m, { kind: kind || 'info', ms: 6000 }); else console.warn('[vox] ' + m); };
  const register = async (name, jsonUrl, map) => {
    if (!map) { const r = await fetch(jsonUrl); if (!r.ok) throw new Error('HTTP ' + r.status); map = await r.json(); }
    await globalThis.samples(map, jsonUrl.replace(/[^/]*$/, ''));
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
    if (banks[src]) return (src === 'demo' ? ensure() : ensure().then(() => load(src, banks[src].url))).then(() => active);
    let u = String(src); if (/\/$/.test(u)) u += 'pitched/strudel.json';
    return load(u.split('/').slice(-3, -1).join('/') || 'custom', u);
  };
  globalThis.voxBank.list = () => Object.entries(banks).map(([name, b]) => ({ name, url: b.url, words: b.words, active: name === active }));
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
  globalThis.word = (str, bank = 'vox') => (ensure(), typeof str === 'string' ? mini(str) : str).fmap((v) => tok(v, bank));
  globalThis.syl = (str, bank = 'vox') => s(bank + '_syl').n(str);
})();
