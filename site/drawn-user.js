/* Your drawn instruments (#182 stage 3, docs/DRAWN_WAVEFORMS.md section 8). Loaded after the first frame (index.html LATER); small on purpose:
   the draw surface itself (draw.js, draw.css) loads only when it is opened.
   Store: localStorage 'sc.drawn' holds one waveforms@1 document { instruments: [...] } (control points and an envelope, never audio).
   Play: packs.activateSources is wrapped so a program that names wt_<id> of a saved instrument gets its wavetable built in memory and registered
   with samples(), exactly as the pack adapter does for glyphcore/drawn-core. validate() of site/engine/waveforms.js runs on every instrument before
   it is saved and again before it is registered (a tampered store registers nothing).
   API: window.strudelCraft.drawn = { list(), get(id), save(inst) -> errors[], remove(id), packNames(), activate(code), open(id?) } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const LS = 'sc.drawn';
const wf = () => import('./engine/waveforms.js');
const toast = (m, o) => { try { sc.ui && sc.ui.toast(m, o); } catch (e) { /* no UI */ } };
const read = () => { try { const d = JSON.parse(localStorage.getItem(LS)); return d && Array.isArray(d.instruments) ? d : { instruments: [] }; } catch (e) { return { instruments: [] }; } };
const write = (d) => { try { localStorage.setItem(LS, JSON.stringify(d)); return true; } catch (e) { return false; } };
const soundOf = (id) => 'wt_' + String(id).replace(/-/g, '_');
const listeners = new Set(); const changed = () => { for (const f of listeners) try { f(); } catch (e) { /* listener bug */ } };

/* sound names the shipped packs already own (wt_drawn_bass ...): a saved instrument may not shadow them */
async function packNames() { try { const P = sc.packs, xs = P && P.ensure ? await P.ensure('waveforms') : []; return new Set(xs.map((x) => String(x.name))); } catch (e) { return new Set(); } }

async function save(inst) {
  const W = await wf(), doc = read(), rest = doc.instruments.filter((i) => i.id !== inst.id), next = { instruments: [...rest, inst] };
  const errs = W.validate(next); if (errs.length) return errs;
  if (!write(next)) return [{ code: 'E_STORE', path: '', msg: 'browser storage is full or off' }];
  changed(); return [];
}
function remove(id) { const d = read(); d.instruments = d.instruments.filter((i) => i.id !== id); write(d); registered.delete(soundOf(id)); changed(); }

const registered = new Map(); // sound name -> JSON of the instrument it was built from (an edited instrument is rebuilt on the next Play)
const wantRe = /(?:^|[^\w$])(?:s|sound)\s*\(\s*(["'`])([\s\S]*?)\1/g;
async function activate(code) {
  const doc = read(); if (!doc.instruments.length || !/wt_/.test(String(code || ''))) return [];
  const names = new Set(); let m; wantRe.lastIndex = 0;
  while ((m = wantRe.exec(String(code)))) for (const w of m[2].split(/[^\w#.]+/)) { const n = w.split(':')[0]; if (n) names.add(n); }
  const want = doc.instruments.filter((i) => i && names.has(soundOf(i.id))); if (!want.length) return [];
  const W = await wf(), hit = [];
  const samples = await new Promise((ok) => { const t0 = Date.now(); const tick = () => (typeof globalThis.samples === 'function' ? ok(globalThis.samples) : Date.now() - t0 > 30000 ? ok(null) : setTimeout(tick, 40)); tick(); });
  if (!samples) return [];
  for (const inst of want) {
    const errs = W.validate({ instruments: [inst] }), name = W.soundName(inst);
    if (errs.length) { toast(`${name} was not loaded: ${errs[0].code} ${errs[0].path}`, { kind: 'error' }); continue; }
    const sig = JSON.stringify(inst); if (registered.get(name) === sig) continue;
    const t = W.tables(inst), url = (b) => URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    const map = Array.isArray(t.map) ? t.map.map(url) : Object.fromEntries(Object.entries(t.map).map(([k, v]) => [k, v.map(url)]));
    await samples({ [t.name]: map }, ''); registered.set(name, sig);
    hit.push({ id: inst.id, license: inst.license, pack: 'local:drawn', sound: name });
  }
  return hit;
}

let surface = null;
async function open(id) {
  if (!surface) { // stylesheet first, then the module
    await new Promise((ok) => { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'draw.css', onload: ok, onerror: ok }); document.head.append(l); });
    try { surface = await import('./draw.js'); } catch (e) { toast('Could not load the draw surface (draw.js). The rest of the instrument works.', { kind: 'error' }); return; }
  }
  surface.open(id);
}

sc.drawn = { list: () => read().instruments, get: (id) => read().instruments.find((i) => i.id === id) || null, save, remove, packNames, activate, open, soundOf, onChange: (f) => { listeners.add(f); return () => listeners.delete(f); } };

/* Play and the offline render host both go through packs.activateSources: saved instruments join its result */
(function wrap() {
  const P = sc.packs; if (!P || !P.activateSources) { setTimeout(wrap, 100); return; }
  if (P.__drawnWrapped) return; P.__drawnWrapped = true;
  const orig = P.activateSources.bind(P);
  P.activateSources = async (code) => { const a = await orig(code); let b = []; try { b = await activate(code); } catch (e) { toast('Drawn instrument: ' + (e && e.message ? e.message : e), { kind: 'error' }); } return a.concat(b); };
})();
if (sc.palette && sc.palette.register) sc.palette.register({ id: 'draw.open', group: 'Instrument', title: 'Draw an instrument (wave, morph, envelope)', run: () => open() });
(function completions() { // saved names complete inside s("...")
  const api = sc.intellisense; if (!api || !api.register) { if ((completions.n = (completions.n || 0) + 1) < 100) setTimeout(completions, 200); return; }
  api.register({ id: 'drawn-user', items: () => read().instruments.map((i) => ({ label: soundOf(i.id), string: true, category: 'your drawn instruments', detail: (i.title || i.id) + ' (drawn)' })) });
})();
