/* Vox banks: what each bank holds, for the Banks browser (voxbrowser.js), word(" / s("vs_ completions and the word / voxBank hover (#85).
   Data comes only through the pack loader: pack glyphcore/vox (site/data/vox/craftpack.json, tools/vox/bank_index.py) lists banks.json and each bank's
   words.json + pitched/strudel.json as manual ingredients, read with packs.raw() the first time a bank is opened or completed. Audio is fetched only
   when a clip is auditioned. User banks (voxBank(url) / folder) come from the prelude's own table; vox-bank pack ingredients from packs.banks().
   API: window.strudelCraft.voxBanks = { list(), info(name), active(), open(name) -> bank with entries, words(name), use(name) -> code line,
        snippet(bank, entry, clip), audition(clip) -> {peak}, stop(), lastPeak, on(type, fn), openPanel(name?) } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const PACK = 'glyphcore/vox';
const SKIPK = /_s\d+$|_syl$|^_|_f-?\d+$/;
const NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export const midi = (n) => { const m = /^([a-g])(#|b|s)?(-?\d+)$/.exec(String(n).toLowerCase()); return m ? NAMES[m[1]] + (m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (+m[3] + 1) : 999; };
const byPitch = (a, b) => midi(a) - midi(b);
const packs = () => sc.packs;
const listeners = {};
const emit = (type, ev) => (listeners[type] || []).forEach((f) => { try { f(ev); } catch (e) { /* a listener bug stays out */ } });

/* ---- the index (banks.json): one small file, read the first time anything asks for the bank list ---- */
let index = null, indexSync = null;
const loadIndex = () => (index = index || (async () => { const p = packs(); if (!p) throw new Error('pack loader missing'); await p.ready; const d = await p.raw(`${PACK}:index`); if (!d || !Array.isArray(d.banks)) { index = null; const f = p.describe(`${PACK}:index`); throw new Error('bank index unavailable' + (f && f.reason ? ` (${f.reason.code}: ${f.reason.message})` : '')); } indexSync = d.banks; return d.banks; })());
const prelude = () => (typeof window.voxBank === 'function' && window.voxBank.list ? window.voxBank : null);

/* active bank: the prelude knows it once Strudel has loaded; before that, the demo bank is what word() would load first */
export function active() { const v = prelude(); const a = v && v.active ? v.active() : null; return a || 'demo'; }

/* every bank: shipped (index), user banks the prelude registered, vox-bank pack ingredients. Fields: name, kind, prefix, words, clips, notes, range, licence, attribution, source, origin, active */
export async function list() {
  let shipped = []; try { shipped = await loadIndex(); } catch (e) { console.warn('banks: ' + e.message); }
  const act = active(), out = shipped.map((b) => ({ ...b, origin: 'shipped' }));
  const v = prelude();
  if (v) for (const b of v.list()) { if (out.some((x) => x.name === b.name) || b.pack) continue; out.push({ name: b.name, title: b.name, kind: b.kind || 'word', prefix: b.prefix || 'vox', words: b.words, clips: b.clips, notes: b.notes || [], range: [], licence: 'your own bank (stays in this browser)', attribution: [], source: b.url, origin: 'user' }); }
  for (const b of (packs() && packs().banks ? packs().banks() : [])) { const d = packs().describe(b.id) || {}; out.push({ name: b.id, short: b.name, title: d.title || b.name, kind: 'word', prefix: 'vox', licence: d.license || '', attribution: d.attribution || [], source: b.pack, origin: 'pack', state: b.state }); }
  return out.map((b) => ({ ...b, active: b.name === act || (b.origin === 'pack' && b.short === act) }));
}
export const info = (name) => (indexSync || []).find((b) => b.name === name) || null;

/* ---- entries of one bank ---- */
const opened = new Map();
const base = (u) => String(u).split('/').pop().replace(/^.*__\d+_/, ''); /* pitched copies are named vox_<w>__<n>_<file>; the words file names <file> */
function build(bank, map, mapUrl, words) {
  const meta = new Map(); for (const w of (words && words.words) || []) if (w.file) meta.set(base(w.file), w);
  const res = (u) => { try { return new URL(u, mapUrl).href; } catch (e) { return u; } };
  const out = [];
  for (const [key, v] of Object.entries(map || {})) {
    if (SKIPK.test(key) || key === '_base') continue;
    const buckets = Array.isArray(v) ? { '': v } : v || {}; const clips = [];
    for (const [note, us] of Object.entries(buckets)) (us || []).forEach((u, i) => { const m = meta.get(base(u)) || {}; clips.push({ note: note || null, i, url: res(u), dur: m.dur, n: m.n, singer: m.singer, file: m.file }); });
    clips.sort((a, b) => byPitch(a.note || 'c4', b.note || 'c4') || a.i - b.i);
    const ws = (words && words.words || []).filter((w) => w.key === key), ns = new Set(ws.filter((w) => w.n !== undefined).map((w) => w.n));
    const durs = clips.map((c) => c.dur).filter((d) => typeof d === 'number');
    const vt = /^vs_([aeiou])(?:_([a-z]+))?$/.exec(key);
    const perNote = Math.max(0, ...Object.values(buckets).map((us) => (us || []).length)); /* word('w:i').note(n) picks clip i of the bucket nearest n */
    out.push({ key, name: key.replace(/^[a-z0-9]+_/, ''), word: (ws[0] && ws[0].word) || key.replace(/^[a-z0-9]+_/, '').replace(/_/g, ' '), takes: ns.size || perNote, clips,
      notes: [...new Set(clips.map((c) => c.note).filter(Boolean))].sort(byPitch), dur: durs.length ? [Math.min(...durs), Math.max(...durs)] : null,
      ...(vt ? { vowel: vt[1], technique: vt[2] || 'straight' } : {}) });
  }
  out.sort((a, b) => (bank.kind === 'sound' ? a.key.localeCompare(b.key) : 0));
  return out;
}
export function open(name) {
  if (opened.has(name)) return opened.get(name);
  const p = (async () => {
    const all = await list(); const bank = all.find((b) => b.name === name || b.short === name); if (!bank) throw new Error('unknown bank ' + name);
    let entries;
    if (bank.origin === 'shipped') {
      const pk = packs(); const [map, words] = await Promise.all([pk.raw(`${PACK}:${bank.map_ingredient}`), pk.raw(`${PACK}:${bank.words_ingredient}`)]);
      if (!map) { const f = pk.describe(`${PACK}:${bank.map_ingredient}`); throw new Error(`${bank.name} map unavailable${f && f.reason ? ` (${f.reason.code})` : ''}`); }
      entries = build(bank, map, pk.entryOf(`${PACK}:${bank.map_ingredient}`) || new URL('data/vox/' + bank.map, document.baseURI).href, words);
    } else if (bank.origin === 'user') {
      const v = prelude(); const m = v && v.mapOf ? v.mapOf(name) : null; /* the prelude keeps each registered map in memory: no fetch */
      entries = m ? build(bank, m.map, m.url, null) : [];
    } else {
      const pk = packs(); const d = await pk.raw(bank.name); const maps = d && d.maps || {};
      const map = { ...(typeof maps.flat === 'object' ? maps.flat : {}), ...(typeof maps.pitched === 'object' ? maps.pitched : {}) };
      const at = pk.entryOf(bank.name); const b0 = (maps.pitched && maps.pitched._base) || (maps.flat && maps.flat._base) || '.';
      entries = build(bank, map, at ? new URL(b0.replace(/\/?$/, '/'), at).href : document.baseURI, Array.isArray(d && d.words) ? { words: d.words } : null);
    }
    if (!bank.notes || !bank.notes.length) bank.notes = [...new Set(entries.flatMap((e) => e.notes))].sort(byPitch);
    return { ...bank, entries };
  })();
  opened.set(name, p); p.catch(() => opened.delete(name));
  return p;
}
export const words = async (name = active()) => (await open(name)).entries.map(({ key, name: n, word, takes, notes, dur, vowel, technique }) => ({ key, name: n, word, takes, notes, dur, ...(vowel ? { vowel, technique } : {}) }));

/* ---- snippets ---- */
const q = (s) => String(s).replace(/["\\]/g, '');
export function snippet(bank, entry, clip) {
  const c = clip || entry.clips[0] || {}; const take = c.i ? ':' + c.i : ''; const note = c.note ? `.note("${q(c.note)}")` : '';
  if (bank.kind === 'sound') return `s("${q(entry.key)}${take}")${note}`;
  return bank.prefix && bank.prefix !== 'vox' ? `word("${q(entry.name)}${take}", "${q(bank.prefix)}")${note}` : `word("${q(entry.name)}${take}")${note}`;
}
export const line = (bank) => (bank.origin === 'user' && /^https?:/.test(bank.source || '') ? `voxBank('${bank.source}')` : `voxBank('${bank.short || bank.name}')`);

/* ---- switch the active bank: the prelude needs Strudel's samples(), so the engine loads first ---- */
export async function use(name) {
  const all = await list(); const bank = all.find((b) => b.name === name || b.short === name); if (!bank) throw new Error('unknown bank ' + name);
  if (!prelude()) { const E = window.__sc && window.__sc.Engine; if (!E) throw new Error('engine missing'); await E.load(); }
  if (!prelude()) throw new Error('the word() prelude did not load');
  await window.voxBank(bank.short || bank.name);
  return line(bank);
}

/* ---- audition: one clip, no code. Routed through the master bus when Strudel's context exists (meter and master level apply), else a private context ---- */
let own = null, cur = null; const bufs = new Map();
const S = { lastPeak: 0 };
function ctxFor() {
  try { if (typeof window.getAudioContext === 'function') return { ctx: window.getAudioContext(), routed: true }; } catch (e) { /* not ready */ }
  own = own || new (window.AudioContext || window.webkitAudioContext)(); return { ctx: own, routed: false };
}
export function stop() { if (cur) { try { cur.src.stop(); } catch (e) { /* ended */ } cur = null; } }
export async function audition(clip, o = {}) {
  if (!clip || !clip.url) throw new Error('no clip to play');
  const { ctx, routed } = ctxFor(); if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* blocked */ } }
  if (ctx.state !== 'running') throw new Error('Audio is blocked by the browser: tap again to allow sound');
  let buf = bufs.get(clip.url);
  if (!buf) { const r = await fetch(clip.url); if (!r.ok) throw new Error('clip HTTP ' + r.status); buf = await ctx.decodeAudioData(await r.arrayBuffer()); bufs.set(clip.url, buf); while (bufs.size > 48) bufs.delete(bufs.keys().next().value); }
  stop();
  const src = new AudioBufferSourceNode(ctx, { buffer: buf }), g = new GainNode(ctx, { gain: 0.9 }), an = new AnalyserNode(ctx, { fftSize: 1024 });
  src.connect(g); g.connect(an);
  if (!routed) { const B = window.__sc && window.__sc.Bus; if (B && B.own) B.own.add(an); } /* a private context stays out of the master bus (it would steal the meter) */
  an.connect(ctx.destination);
  const me = (cur = { src, clip }); const data = new Float32Array(an.fftSize); let peak = 0;
  emit('play', { clip, state: 'start' });
  return new Promise((ok) => {
    const tick = () => { if (cur !== me) return; an.getFloatTimeDomainData(data); let p = 0; for (const x of data) p = Math.max(p, Math.abs(x)); peak = Math.max(peak, p); S.lastPeak = peak; emit('level', { clip, level: p }); requestAnimationFrame(tick); };
    src.onended = () => { if (cur === me) cur = null; try { an.disconnect(); } catch (e) { /* gone */ } S.lastPeak = peak; emit('play', { clip, state: 'end', peak }); ok({ peak, dur: buf.duration }); };
    src.start(); requestAnimationFrame(tick); if (o.ms) setTimeout(() => { if (cur === me) stop(); }, o.ms);
  });
}

/* ---- the panel: sheet (button / palette) and workspace pane, UI in voxbrowser.js (loaded on first open) ---- */
const ui = () => import('./voxbrowser.js');
export const openPanel = (name) => ui().then((m) => m.openSheet(name));

const api = { list, info, active, open, words, use, snippet, line, audition, stop, openPanel, midi, get lastPeak() { return S.lastPeak; }, on: (t, f) => { (listeners[t] ||= []).push(f); return () => { listeners[t] = listeners[t].filter((x) => x !== f); }; }, emit };
sc.voxBanks = api;

/* bank switches (voxBank() from the panel or from code) */
window.addEventListener('vox:bank', (e) => { emit('active', { name: e.detail && e.detail.name }); if (sc.intellisense && sc.intellisense.invalidate) sc.intellisense.invalidate(); });

/* ---- completions: word(" from the ACTIVE bank (keys it lacks fall back to demo), s("<prefix>_ from a sound bank's keys ---- */
const fmtNotes = (e) => (e.notes.length ? (e.notes.length > 5 ? `${e.notes[0]}..${e.notes[e.notes.length - 1]} (${e.notes.length} pitches)` : e.notes.join(' ')) : 'natural pitch');
const opt = (e, bank, rank, extra = '') => ({ label: e.name, type: 'text', detail: `${bank} · ${e.takes} take${e.takes === 1 ? '' : 's'} · ${fmtNotes(e)}`, info: `${e.word}${extra}: ${e.takes} take${e.takes === 1 ? '' : 's'}${e.dur ? `, ${e.dur[0].toFixed(2)}${e.dur[1] !== e.dur[0] ? '-' + e.dur[1].toFixed(2) : ''} s` : ''}; pitches ${fmtNotes(e)}. From bank ${bank}.`, section: { name: 'words · ' + bank + extra, rank }, boost: rank ? 0 : 5, bank });
async function complete(ctx) {
  const a = ctx.arg; if (!a || !a.quote || a.arg !== 0) return null;
  const text = ctx.text;
  if (a.fn === 'word') {
    if (/:[\w]*$/.test(text)) return null; /* take index after the colon */
    const tok = /[\w'-]*$/.exec(text)[0]; const act = active();
    let main = null; try { main = await open(act); } catch (e) { /* bank not readable: demo only */ }
    const options = [];
    if (main && main.kind !== 'sound') for (const e of main.entries) options.push(opt(e, main.name, 0));
    if (!main || main.name !== 'demo') { try { const d = await open('demo'); const have = new Set(options.map((o) => o.label)); for (const e of d.entries) if (!have.has(e.name)) options.push(opt(e, 'demo', 1, main ? ' (fallback)' : '')); } catch (e) { /* offline */ } }
    return options.length ? { from: ctx.pos - tok.length, options, validFor: /^[\w'-]*$/ } : null;
  }
  if (a.fn === 's' || a.fn === 'sound') {
    const tok = /[\w]*$/.exec(text)[0]; if (tok.length < 2) return null;
    let banks = []; try { banks = (await list()).filter((b) => b.kind === 'sound'); } catch (e) { return null; }
    const hit = banks.find((b) => tok.startsWith(b.prefix + '_') || (b.prefix + '_').startsWith(tok)); if (!hit) return null;
    const bank = await open(hit.name).catch(() => null); if (!bank) return null;
    return { from: ctx.pos - tok.length, options: bank.entries.map((e) => ({ label: e.key, type: 'text', detail: `${bank.name} · ${e.clips.length} clip${e.clips.length === 1 ? '' : 's'} · ${fmtNotes(e)}`, info: `${e.key}: ${e.vowel ? `vowel ${e.vowel}, ${e.technique}; ` : ''}${e.clips.length} recordings at ${fmtNotes(e)}. ${hit.name === active() ? '' : `Load it first: voxBank('${hit.name}')`}`, section: { name: 'sounds · ' + bank.name, rank: 0 }, bank: bank.name })), validFor: /^\w*$/ };
  }
  return null;
}
const whenHas = (get, ms = 20000) => new Promise((ok) => { const t0 = Date.now(); const tick = () => { let v = null; try { v = get(); } catch (e) { v = null; } if (v) ok(v); else if (Date.now() - t0 > ms) ok(null); else setTimeout(tick, 60); }; tick(); });
whenHas(() => sc.intellisense && sc.intellisense.registerSource && sc.intellisense).then((is) => { if (is) is.registerSource({ id: 'vox-banks', complete }); });
api.complete = complete;

/* ---- hover (desktop) and long-press (touch) on word / voxBank / syl: active bank and its size ---- */
export async function describeActive() {
  const name = active(); let b = null; try { b = (await list()).find((x) => x.name === name || x.short === name); } catch (e) { /* offline */ }
  if (!b) return `Active bank: ${name}`;
  const pitch = b.notes && b.notes.length ? b.notes.join(' ') : b.range && b.range.length ? `${b.range[0]}..${b.range[1]} (natural)` : '';
  return `Active bank: ${b.name} · ${b.kind === 'sound' ? 'sound bank' : 'word bank'}${b.words != null ? ` · ${b.words} ${b.kind === 'sound' ? 'keys' : 'words'}` : ''}${b.clips != null ? ` · ${b.clips} clips` : ''}${pitch ? ' · ' + pitch : ''}${prelude() ? '' : ' (default; loads on first word())'}`;
}
api.describeActive = describeActive;
const TOK = /^(word|voxBank|syl)$/;
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (!(n instanceof HTMLElement)) continue; const t = n.matches('.cm-tooltip-hover') ? n : n.querySelector && n.querySelector('.cm-tooltip-hover'); if (!t) continue;
  const sig = t.querySelector('.cm-sig'); if (!sig || sig.querySelector('.vb-hover') || !/^(word|voxBank|syl)\(/.test(sig.textContent)) continue;
  const d = document.createElement('div'); d.className = 'vb-hover'; d.style.cssText = 'margin-top:4px;color:var(--sig-2);font-size:.74rem'; d.textContent = 'Active bank: ' + active(); sig.append(d); describeActive().then((s) => { d.textContent = s; }); } }).observe(document.body, { childList: true, subtree: true });
let lp = null, tipEl = null;
const hideTip = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
function tokenAt(e) {
  const ed = e.target.closest && e.target.closest('.cm-editor'); if (!ed) return null;
  const ta = [...document.querySelectorAll('textarea')].find((t) => t.cmView && t.cmView.dom === ed); const v = ta && ta.cmView; if (!v) return null;
  const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }); if (pos == null) return null;
  const l = v.state.doc.lineAt(pos); let s = pos - l.from, en = s; while (s > 0 && /[\w$]/.test(l.text[s - 1])) s--; while (en < l.text.length && /[\w$]/.test(l.text[en])) en++;
  const w = l.text.slice(s, en); return TOK.test(w) ? { w, rect: v.coordsAtPos(l.from + s) } : null;
}
async function showTip(t) {
  hideTip(); tipEl = document.createElement('div'); tipEl.className = 'vb-tip'; tipEl.style.cssText = 'position:fixed;z-index:60;max-width:min(320px,calc(100vw - 16px));padding:6px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel);color:var(--sig-2);font-family:var(--mono);font-size:.74rem;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.4)'; tipEl.setAttribute('role', 'tooltip'); tipEl.textContent = 'Active bank: ' + active();
  document.body.append(tipEl); const r = t.rect || { left: 12, top: 80 }; tipEl.style.left = Math.max(8, Math.min(innerWidth - tipEl.offsetWidth - 8, r.left)) + 'px'; tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight - 8) + 'px';
  const s = await describeActive(); if (tipEl) { tipEl.textContent = s; tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight - 8) + 'px'; tipEl.style.left = Math.max(8, Math.min(innerWidth - tipEl.offsetWidth - 8, r.left)) + 'px'; }
  const el = tipEl; setTimeout(() => { if (tipEl === el) hideTip(); }, 5000);
}
document.addEventListener('pointerdown', (e) => { hideTip(); if (e.pointerType === 'mouse') return; const t = tokenAt(e); if (!t) return; clearTimeout(lp && lp.t); lp = { x: e.clientX, y: e.clientY, t: setTimeout(() => showTip(t), 480) }; }, true);
document.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) { clearTimeout(lp.t); lp = null; } }, true);
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { if (lp) { clearTimeout(lp.t); lp = null; } }, true);
addEventListener('scroll', hideTip, { passive: true, capture: true }); addEventListener('keydown', hideTip, true);
api.tipFor = showTip;

/* ---- entry points: palette, workspace pane, a Banks button in the Syntax view head ---- */
whenHas(() => sc.palette).then((pal) => {
  if (!pal) return;
  pal.register({ id: 'banks.open', group: 'Banks', title: 'Browse vox banks (what you can type in word())', run: () => openPanel() });
  pal.register({ id: 'banks.pane', group: 'Pane', title: 'Show Banks', run: () => { const w = sc.workspace; if (!w) return; if (!w.active) w.on(); const l = w.layout(); if (!l.flat().some((p) => p.id === 'banks')) w.apply([...l, [{ id: 'banks', w: 1 }]]); } });
});
whenHas(() => sc.workspace && sc.workspace.panes).then((P) => { if (!P || P.banks) return; let el = null; P.banks = { title: 'Banks', make: () => { if (el) return el; el = document.createElement('div'); el.className = 'vb-pane'; el.innerHTML = '<p class="pf-hint">Loading banks…</p>'; ui().then((m) => m.mount(el)); return el; } }; });
function syntaxButton() {
  const head = document.querySelector('#syntax .panel-head'); if (!head || head.querySelector('.vb-open')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost vb-open'; b.textContent = 'Banks'; b.title = 'What each vox bank holds: words, takes, pitches; audition and insert';
  b.setAttribute('aria-haspopup', 'dialog'); b.addEventListener('click', () => openPanel()); head.append(b);
}
whenHas(() => document.getElementById('syntax')).then((s) => { if (!s) return; syntaxButton(); new MutationObserver(syntaxButton).observe(s, { childList: true }); });
