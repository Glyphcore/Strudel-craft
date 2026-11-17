/* CraftCues UI (docs/CRAFTCUES.md 6; #163). Loaded by cues.js on first use. Phone first (390 px), aaa-web-ui rules:
   - captions strip above the transport while a program with cues plays: the bar, chips for the cues active at that bar (layer-scoped ones light the
     lane rows and graph nodes they name: [data-cue-hot]), a thin timeline lane with every span and the cross-bar / cross-layer relations as arcs;
   - a chip press opens the cue's KB card in the site modal (nothing in the editor moves; "Go to code" on the card is the deliberate jump);
   - Score sheet: cues by section, filters (kind, layer, concept), edit in place (site modal), add at the current bar, import / export .craftcues / .vtt / JSON.
   Cues of a program = inline //@ comments (edits rewrite that one comment) + a shipped sidecar (data/cues/index.json) + cues saved in this browser
   (localStorage sc.cues.<program key>, a .craftcues text). Merge by id: browser edits, then inline, then the sidecar. */
import * as C from './engine/cues.js'; import { makeKB } from './engine/cues-kb.js'; import { commentRanges } from './engine/comments.js'; import { scan as laneScan } from './engine/lanes.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emph = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const cssReady = new Promise((ok) => { if (document.querySelector('link[data-cu]')) return ok(); const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('cues.css', import.meta.url).href, onload: ok, onerror: ok }); l.dataset.cu = ''; document.head.append(l); });
const ls = { get: (k) => { try { return localStorage.getItem('sc.cues.' + k); } catch (e) { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem('sc.cues.' + k); else localStorage.setItem('sc.cues.' + k, v); } catch (e) { /* private mode */ } } };
const off = () => { try { return localStorage.getItem('sc.cuesOff') === '1'; } catch (e) { return false; } };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
const st = { doc: null, key: null, code: null, sides: [], kbP: null, strip: null, shown: null, hot: [], clock: 'main', quick: null, raf: 0, sheet: null, filt: { kind: 'all', lane: '', ref: '' }, p: 1 };

/* ---------------- sources ---------------- */
const activeTa = () => document.getElementById(window.__sc && window.__sc.S && window.__sc.S.view === 'stack' ? 'stackCode' : 'code');
function source() { const T = sc.transport; let s = null; try { s = T && T.source && T.source(); } catch (e) { /* none */ } if (s && s.code) return s; const t = activeTa(); return { id: null, code: t ? t.value : '' }; }
const keyOf = (s) => (s.id ? 'r:' + s.id : 'h:' + hash(String(s.code).slice(0, 240)));
let index = null; const idx = () => (index = index || fetch(new URL('data/cues/index.json', document.baseURI)).then((r) => (r.ok ? r.json() : { sets: [] })).catch(() => ({ sets: [] })));
const sideCache = new Map();
async function sidecars(s) {
  const ix = await idx(); const hits = (ix.sets || []).filter((x) => (x.recipe && x.recipe === s.id) || (x.first && String(s.code).startsWith(x.first)));
  return Promise.all(hits.map((x) => { if (!sideCache.has(x.file)) sideCache.set(x.file, fetch(new URL('data/cues/' + x.file, document.baseURI)).then((r) => (r.ok ? r.text() : '')).catch(() => '')); return sideCache.get(x.file); }));
}
/* load(s) -> the merged doc of a program; cached until the code changes */
let loadSeq = 0;
export async function load(s = source(), force = false) {
  if (!force && st.doc && st.code === s.code) return st.doc;
  const my = ++loadSeq; /* only the latest load commits: a slow earlier load (another program) never overwrites a newer one */
  const inline = C.extract(s.code || ''); inline.doc.cues.forEach((c) => { c._origin = 'inline'; });
  const side = (await sidecars(s)).filter(Boolean).map((t) => C.parse(t).doc);
  const key = keyOf(s); const mine = ls.get(key); const local = mine ? C.parse(mine).doc : null; if (local) local.cues.forEach((c) => { c._origin = 'local'; });
  const doc = C.merge(local, inline.doc, ...side); doc.header = { ...side.reduce((a, d) => ({ ...a, ...d.header }), {}), ...inline.doc.header, ...(local ? local.header : {}) };
  for (const c of doc.cues) if (!c._origin) c._origin = 'sidecar';
  if (my !== loadSeq) return doc;
  let lanes = []; try { lanes = laneScan(s.code || '').lanes.map((l) => ({ id: l.id, tags: l.tags || [] })); } catch (e) { /* not lane code */ }
  st.doc = doc; st.code = s.code; st.key = key; st.problems = inline.problems; st.lanes = lanes; tl = null; st.shown = null; return doc;
}
export const current = () => st.doc;
function saveLocal(fn) { const mine = ls.get(st.key); const d = mine ? C.parse(mine).doc : { format: 'craftcues@1', header: {}, notes: [], cues: [] }; fn(d); ls.set(st.key, d.cues.length || d.notes.length ? C.print(d) : null); st.code = null; }

/* ---------------- KB ---------------- */
function kb() {
  if (st.kbP) return st.kbP;
  const j = (u) => fetch(new URL(u, document.baseURI)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  st.kbP = Promise.all([j('data/composition.json'), j('data/syntax.json')]).then(([composition, syntax]) => makeKB({ composition, syntax, genres: null, formBank: null,
    resource: (id) => { const m = sc.resources && sc.resources.model && sc.resources.model(); if (m && m.refs) { const r = m.refs.find((x) => x.id === id); return r ? { title: r.name, def: r.desc } : null; } if (/^lane:/.test(id) && st.code != null) return new RegExp('^\\s*' + id.slice(5).replace(/[$]/g, '\\$') + '\\s*:', 'm').test(st.code) ? { title: id.slice(5), def: 'a lane of this program' } : null; return undefined; } }));
  return st.kbP;
}

/* ---------------- the clock: bar position of the transport or of a quick-play audition ---------------- */
function position() {
  if (st.clock === 'quick') { const q = sc.quickplay; const r = q && q.run; if (!r || q.state.phase !== 'playing' || q.state.key !== (st.quick && st.quick.key)) return null; return (r.cyc || 0) + 1; }
  const T = sc.transport; if (!T || !T.playing) return null; const s = T.scheduler; if (!s || !s.started) return null; let c = 0; try { c = s.now(); } catch (e) { return null; } return c + 1; /* 1 cycle = 1 bar (setcpm(bpm / 4)) */
}
export const bar = () => st.p;
export const hotCount = () => st.hot.length;

/* ---------------- captions strip ---------------- */
function strip() {
  if (st.strip) return st.strip;
  const el = document.createElement('div'); el.className = 'cu-strip'; el.hidden = true; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Score captions');
  el.innerHTML = '<div class="cu-row"><span class="cu-bar">bar <b>1</b></span><div class="cu-chips" role="list" aria-live="polite"></div><button type="button" class="cu-score" aria-label="Open the score cues" title="Score">Score</button><button type="button" class="cu-x" aria-label="Hide captions" title="Hide captions (Ctrl+K: Captions on / off)">&times;</button></div><svg class="cu-tl" viewBox="0 0 1000 22" preserveAspectRatio="none" aria-hidden="true"></svg>';
  el.querySelector('.cu-x').addEventListener('click', () => { toggleCaptions(false); });
  el.querySelector('.cu-score').addEventListener('click', () => openScore());
  el.querySelector('.cu-chips').addEventListener('click', (e) => { const b = e.target.closest('.cu-chip'); if (!b) return; const c = st.doc && st.doc.cues.find((x) => x.id === b.dataset.id); if (c) openCard(c); });
  document.body.append(el); st.strip = el; place(); window.addEventListener('resize', place); return el;
}
function place() { const f = document.querySelector('footer.transport'); if (!st.strip) return; const top = f ? f.getBoundingClientRect().top : innerHeight; st.strip.style.bottom = Math.max(0, innerHeight - top) + 'px'; }
function timeline(doc) {
  const h = doc.header || {}; const N = +h.bars || Math.max(16, ...doc.cues.map((c) => { const s = C.spanOf(c.at, h); return s && Number.isFinite(s[1]) ? s[1] - 1 : 0; }));
  const x = (p) => (((p - 1) / N) * 1000).toFixed(1); const rows = {}; let k = 0; const out = [];
  for (const s of h.sections || []) out.push(`<line class="sec" x1="${x(s.from)}" x2="${x(s.from)}" y1="14" y2="22"/>`);
  const sp = new Map(); for (const c of doc.cues) { const s = C.spanOf(c.at, h); if (!s || c.at === '*') continue; sp.set(c.id, s); const r = rows[c.kind] ?? (rows[c.kind] = k++ % 4); out.push(`<line class="sp" data-k="${c.kind}" style="stroke:var(--k,var(--sig-2))" x1="${x(s[0])}" x2="${x(Math.min(N + 1, s[1]))}" y1="${15 + r * 2}" y2="${15 + r * 2}"/>`); }
  const arc = (a, b, cls) => { const m = ((+a + +b) / 2).toFixed(1); out.push(`<path class="arc ${cls}" d="M${a},13 Q${m},${cls === 'pair' ? -6 : 0} ${b},13"/>`); };
  for (const c of doc.cues) { const s = sp.get(c.id); if (!s) continue; if (c.pair) { const t = C.spanOf(c.pair, h); if (t) arc(x(s[0]), x(t[0]), 'pair'); } for (const r of c.rel || []) { const t = sp.get(r.target); if (t) arc(x(t[0]), x(s[0]), 'rel'); } if (/->|~|\+/.test(c.scope)) arc(x(s[0]), x(Math.min(N + 1, s[1])), 'rel'); }
  out.push('<line class="ph" x1="0" x2="0" y1="0" y2="22"/>'); return { svg: out.join(''), N };
}
/* the lanes a scope names in the playing program: lanes as written, tag:x -> every lane carrying tag x (Lanes .tags), bus: scopes name no lane */
export function lanesOf(scope, lanes = st.lanes || []) { const out = new Set(); for (const it of C.scopeParts(scope).items) { if (it.lane) out.add(it.lane); else if (it.tag) for (const l of lanes) if (l.tags.includes(it.tag)) out.add(l.id); } return [...out]; }
/* highlight only what shows the PLAYING program: the Graph view's track nodes and its Lanes cards (lanes-ui buttons), when the graph's text is the program that plays */
function hot(lanes) {
  for (const e of st.hot) e.removeAttribute('data-cue-hot'); st.hot = [];
  const G = sc.graph; if (!lanes.length || !G || st.code == null || G.text !== st.code) return;
  for (const l of lanes) for (const e of document.querySelectorAll(`#graph .gn-head[data-node="track:${CSS.escape(l)}"], #graph [data-lane="${CSS.escape(l)}"]`)) { e.setAttribute('data-cue-hot', 'true'); st.hot.push(e); }
}
let tl = null;
function frame() {
  st.raf = requestAnimationFrame(frame); const p = position(); const el = st.strip;
  if (p == null || off() || !st.doc || !st.doc.cues.length) { if (el && !el.hidden) { el.hidden = true; hot([]); st.shown = null; } if (p == null && st.clock === 'quick') { st.clock = 'main'; st.code = null; } maybeReload(); return; }
  maybeReload(); if (!el) return; if (el.hidden) { el.hidden = false; place(); }
  st.p = p; const b = Math.floor(p + 1e-9); const bb = el.querySelector('.cu-bar b'); if (bb.textContent !== String(b)) bb.textContent = String(b);
  if (!tl || tl.doc !== st.doc) { const t = timeline(st.doc); tl = { doc: st.doc, N: t.N }; el.querySelector('.cu-tl').innerHTML = t.svg; }
  const ph = el.querySelector('.cu-tl .ph'); const px = (((p - 1) / tl.N) * 1000).toFixed(1); if (ph && ph.getAttribute('x1') !== px) { ph.setAttribute('x1', px); ph.setAttribute('x2', px); }
  const act = C.activeAt(st.doc, p).filter((c) => c.at !== '*'); const ids = act.map((c) => c.id).join('|') + (sc.graph && st.code != null && sc.graph.text === st.code ? '#g' : ''); /* the Graph showing the playing program is part of the key: playing in the Rack, then opening the Graph, relights the nodes */
  if (ids === st.shown) return; st.shown = ids; el.dataset.bar = String(b);
  el.querySelector('.cu-chips').innerHTML = act.length ? act.map((c) => `<button type="button" role="listitem" class="cu-chip" data-id="${esc(c.id)}" data-k="${esc(c.kind)}" aria-label="${esc(`${c.kind}${c.scope !== 'track' ? ' on ' + c.scope : ''}: ${c.body}. Open its card`)}"><i>${esc(c.kind)}${c.scope !== 'track' ? ' @' + esc(c.scope) : ''}</i><span>${emph(String(c.body || '').split('\n')[0])}</span></button>`).join('') : '<span class="cu-none">no cue at this bar</span>';
  hot([...new Set(act.flatMap((c) => lanesOf(c.scope)))]);
}
let reloading = false, lastCheck = 0;
function maybeReload() { const now = performance.now(); if (reloading || now - lastCheck < 400) return; lastCheck = now; if (st.clock === 'quick') return; const s = source(); if (s.code === st.code) return; reloading = true; load(s).then(() => { tl = null; st.shown = null; }).finally(() => { reloading = false; }); }
export async function attach() { await cssReady; strip(); await load(); if (!st.raf) frame(); }
export async function attachQuick(d) { await cssReady; strip(); const r = C.extract(d.code); r.doc.cues.forEach((c) => { c._origin = 'quick'; }); st.doc = r.doc; st.code = null; st.clock = 'quick'; st.quick = d; tl = null; st.shown = null; if (!st.raf) frame(); }
export function toggleCaptions(on) { const v = on === undefined ? off() : on; try { localStorage.setItem('sc.cuesOff', v ? '0' : '1'); } catch (e) { /* private */ } if (sc.ui) sc.ui.toast(v ? 'Captions on' : 'Captions off (Ctrl+K: Captions on / off)'); if (v) attach(); }

/* ---------------- editor: deliberate go to code, inline edits as one change ---------------- */
function gotoLine(line) { const t = activeTa(); if (!t) return false; const v = t.cmView; if (v) { const ln = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines))); v.dispatch({ selection: { anchor: ln.from }, scrollIntoView: true, userEvent: 'select' }); v.focus(); return true; } const off0 = t.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0); t.focus(); t.setSelectionRange(off0, off0); return true; }
function replaceInEditor(from, to, insert) { const t = activeTa(); if (!t) return false; const v = t.cmView; if (v) { v.dispatch({ changes: { from, to, insert }, userEvent: 'input', scrollIntoView: false }); return true; } const a = t.selectionStart; t.value = t.value.slice(0, from) + insert + t.value.slice(to); t.setSelectionRange(a, a); t.dispatchEvent(new Event('input', { bubbles: true })); return true; }
/* the editable span of the inline cue on program line `line`, found with the #142 comment ranges (never a //@ inside a string):
   { from, to, prefix } where [from, to) is the cue text: a //@ comment (prefix '//@ ') or one line of a block comment cue (prefix '') */
export function inlineSpan(text, line) {
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); const ls = starts[line - 1]; if (ls == null) return null; const le = line < starts.length ? starts[line] - 1 : text.length;
  for (const [a, b] of commentRanges(text)) {
    if (b < ls || a > le) continue;
    if (text.startsWith('//@', a) && !text.startsWith('//@!', a) && a >= ls && a <= le) return { from: a, to: b, prefix: '//@ ' };
    if (text.startsWith('/*@', a)) { const end = text.slice(b - 2, b) === '*/' ? b - 2 : b; let f = Math.max(ls, a + 3), t = Math.min(le, end); if (f >= t) continue; f += /^\s*\*?\s?/.exec(text.slice(f, t))[0].length; while (t > f && /\s/.test(text[t - 1])) t--; if (t > f) return { from: f, to: t, prefix: '' }; }
  }
  return null;
}
/* rewrite one inline cue in the editor as one change; refuses (toast, nothing saved) when the editor does not show the cue's program or the span is gone */
export function editInline(c, n) {
  const t = activeTa(); const text = t ? t.value : ''; const why = (m) => { sc.ui && sc.ui.toast(m, { kind: 'error' }); return false; };
  if (!t || st.code == null || text !== st.code) return why('This cue lives in the code of the playing program: open that program in the editor to edit it');
  const sp = inlineSpan(text, c._line); if (!sp) return why(`Cue ${c.id}: its comment on line ${c._line} was not found; edit it in the code`);
  replaceInEditor(sp.from, sp.to, sp.prefix + C.printLine({ ...n, id: /^L\d+$/.test(n.id) ? null : n.id })); st.code = null; return true;
}

/* ---------------- KB card (site modal) ---------------- */
export async function openCard(c) {
  if (!sc.ui) return; const K = await kb(); const body = document.createElement('div'); body.className = 'cu-card';
  const cards = (c.refs || []).map((r) => K(r));
  body.innerHTML = `<div class="cu-meta">${esc(c.at)}${c.pair ? ' &#8594; ' + esc(c.pair) : ''} · ${esc(c.kind)} · @${esc(c.scope)}${c.meta && c.meta.src ? ' · ' + esc(c.meta.src) : ''}${c.meta && c.meta.method ? ' (' + esc(c.meta.method) + ')' : ''}${c.meta && c.meta.conf != null ? ' · conf ' + esc(c.meta.conf) : ''}</div>
    <div class="cu-body">${emph(c.body || '(no text)')}</div>
    ${cards.length ? `<ul class="cu-kb">${cards.map((k) => `<li data-ref="${esc(k.id)}"><b>${esc(k.id)}</b> <span data-s="${esc(k.status)}">${esc(k.kb)} · ${esc(k.status)}</span><small>${esc(k.title)}${k.def ? ' - ' + esc(k.def) : ''}</small>${k.link ? `<a href="${esc(k.link)}" ${/^https?:/.test(k.link) ? 'target="_blank" rel="noopener"' : ''}>Open in ${/^#syntax/.test(k.link) ? 'Syntax' : /^#res/.test(k.link) ? 'Resources' : 'docs'}</a>` : ''}</li>`).join('')}</ul>` : ''}
    ${(c.rel || []).length ? `<div class="cu-acts">${c.rel.map((r) => `<button type="button" class="ghost" data-rel="${esc(r.target)}">${esc(r.type)} &#8594; ${esc(r.target)}</button>`).join('')}</div>` : ''}
    ${c.meta && c.meta.more ? `<a href="${esc(c.meta.more)}" target="_blank" rel="noopener">More</a>` : ''}
    <div class="cu-acts">${c._line && c._origin === 'inline' ? `<button type="button" class="cu-go" data-go="${c._line}">Go to code (line ${c._line})</button>` : ''}<button type="button" class="ghost cu-edit">Edit</button></div>`;
  const close = () => { const d = body.closest('dialog'); const x = d && d.querySelector('.scm-acts .ghost'); if (x) x.click(); };
  body.addEventListener('click', (e) => {
    const g = e.target.closest('.cu-go'); if (g) { close(); setTimeout(() => gotoLine(+g.dataset.go), 0); return; }
    if (e.target.closest('.cu-edit')) { close(); setTimeout(() => editCue(c), 0); return; }
    const r = e.target.closest('[data-rel]'); if (r) { const t = st.doc.cues.find((x) => x.id === r.dataset.rel); if (t) { close(); setTimeout(() => openCard(t), 0); } return; }
    const a = e.target.closest('a[href^="#"]'); if (a) close();
  });
  return sc.ui.form({ title: `Cue ${c.id}`, body, okText: 'Done', cancelText: 'Close', collect: () => true });
}

/* ---------------- edit / add ---------------- */
async function editCue(c, o = {}) {
  if (!sc.ui) return null; await load(); const lanes = [...new Set((st.code || '').split('\n').map((l) => (/^\s*([A-Za-z_$][\w$]*)\s*:\s*\S/.exec(l) || [])[1]).filter(Boolean))];
  const body = document.createElement('div'); body.className = 'cu-form'; const tokens = (x) => { const s = C.printLine({ ...x, id: null, body: '' }); const i = s.indexOf(' | '); return i < 0 ? '' : s.slice(i + 1); };
  body.innerHTML = `<label>Bars <input name="at" value="${esc(c.pair ? c.at + ' => ' + c.pair : c.at)}" placeholder="17-24, 17.3-18.1, *, sec:drop-a" autocomplete="off" inputmode="text"></label>
    <label>Kind <select name="kind">${C.KINDS.map((k) => `<option ${k === c.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label>Scope <input name="scope" value="@${esc(c.scope)}" list="cuLanes" autocomplete="off"><datalist id="cuLanes">${['@track', ...lanes.map((l) => '@' + l)].map((l) => `<option value="${esc(l)}">`).join('')}</datalist></label>
    <label>Text (terse, ${C.BODY_MAX} chars) <textarea name="body" rows="2" maxlength="400">${esc(c.body)}</textarea></label>
    <label>KB refs, relations, meta <input name="tok" value="${esc(tokens(c))}" placeholder="| MOT-05 FS-01 | resolves:drop-a | conf=0.8" autocomplete="off"></label>
    ${o.add ? '<label><span><input type="checkbox" name="inline"> write it into the code as a //@ comment</span></label>' : ''}`;
  const f = (n) => body.querySelector(`[name="${n}"]`);
  const build = () => { const line = `${f('at').value.trim()} ${f('kind').value} ${f('scope').value.trim() || '@track'}: ${f('body').value.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()} ${f('tok').value.trim()}`; return C.parseLine(line); };
  const v = await sc.ui.form({ title: o.add ? `Add cue at bar ${c.at}` : `Edit cue ${c.id}`, body, okText: 'Save', collect: () => ({ r: build(), inline: o.add && f('inline').checked }), validate: () => { const r = build(); return r.problems.filter((p) => p.level === 'error').map((p) => p.msg).join('; ') || null; } });
  if (!v || !v.r.cue) return null; const n = v.r.cue; n.id = c.id || n.id;
  if (c._origin === 'inline' && c._line) { if (editInline(c, n)) await load(); return n; } /* inline cues are edited in the code or refused, never shadowed by a local copy */
  if (v.inline) { const t = activeTa(); const text = t ? t.value : ''; replaceInEditor(text.length, text.length, (text.endsWith('\n') || !text ? '' : '\n') + '//@ ' + C.printLine({ ...n, id: null }) + '\n'); st.code = null; await load(); return n; }
  saveLocal((d) => { const fin = { id: n.id, at: n.at, ...(n.pair ? { pair: n.pair } : {}), kind: n.kind, scope: n.scope || 'track', body: n.body, refs: n.refs, rel: n.rel, meta: n.meta }; const i = d.cues.findIndex((x) => x.id === n.id); if (i >= 0) d.cues[i] = fin; else d.cues.push(fin); });
  await load(); if (st.sheet && st.sheet.open) drawScore(); return n;
}
export async function addAtBar() { await cssReady; await load(); const p = position(); const b = p == null ? 1 : Math.floor(p + 1e-9); let n = 1; while (st.doc.cues.some((c) => c.id === 'u' + n)) n++; return editCue({ id: 'u' + n, at: String(b), kind: 'note', scope: 'track', body: '', refs: [], rel: [], meta: { src: 'author' }, _origin: 'local' }, { add: true }); }

/* ---------------- Score sheet ---------------- */
const download = (text, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.rel = 'noopener'; a.style.display = 'none'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); };
const baseName = () => String((st.doc && st.doc.header.track) || 'cues').replace(/[^\w.-]+/g, '-');
export function exportAs(fmt) {
  const d = st.doc; if (!d) return null; let text, ext, type;
  if (fmt === 'vtt') { try { text = C.toVTT(d); } catch (e) { sc.ui && sc.ui.toast('Captions need a tempo: add setcpm(...) or a bpm header', { kind: 'error' }); return null; } ext = '.vtt'; type = 'text/vtt'; }
  else if (fmt === 'json') { text = JSON.stringify(C.toJSON(d), null, 1); ext = '.craftcues.json'; type = 'application/json'; }
  else { text = C.print(d); ext = '.craftcues'; type = 'text/plain'; }
  download(text, baseName() + ext, type); return text;
}
export async function importText(text, name = '') {
  const h = st.doc ? st.doc.header : {}; const d = /\.vtt$/i.test(name) || /^WEBVTT/.test(text) ? C.fromVTT(text, h) : /\.json$/i.test(name) || /^\s*\{/.test(text) ? C.fromJSON(JSON.parse(text)) : C.parse(text).doc;
  saveLocal((loc) => { for (const c of d.cues) { const i = loc.cues.findIndex((x) => x.id === c.id); if (i >= 0) loc.cues[i] = c; else loc.cues.push(c); } loc.header = { ...d.header, ...loc.header }; });
  await load(); if (st.sheet && st.sheet.open) drawScore(); sc.ui && sc.ui.toast(`Imported ${d.cues.length} cues`, { kind: 'ok' }); return d.cues.length;
}
function sectionOf(c, h) { const s = C.spanOf(c.at, h); if (!s || c.at === '*') return null; return (h.sections || []).find((x) => s[0] >= x.from && s[0] < x.to + 1) || null; }
function drawScore() {
  const root = st.sheet.querySelector('.cu-host'); const d = st.doc; const h = d.header || {}; const F = st.filt;
  const kinds = [...new Set(d.cues.map((c) => c.kind))]; const lanes = [...new Set(d.cues.flatMap((c) => C.scopeLanes(c.scope)))].sort(); const refs = [...new Set(d.cues.flatMap((c) => c.refs))].sort();
  const pass = (c) => (F.kind === 'all' || c.kind === F.kind) && (!F.lane || C.scopeLanes(c.scope).includes(F.lane)) && (!F.ref || c.refs.includes(F.ref));
  const groups = new Map(); for (const c of d.cues.filter(pass)) { const s = sectionOf(c, h); const k = s ? `${s.name} ${s.from}-${s.to}` : 'whole track'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const p = position(); const b = p == null ? 1 : Math.floor(p + 1e-9);
  root.innerHTML = `<div class="cu-sbar"><div class="cu-pills" role="group" aria-label="Kind"><button type="button" class="cu-pill" data-kind="all" aria-pressed="${F.kind === 'all'}">All <b>${d.cues.length}</b></button>${kinds.map((k) => `<button type="button" class="cu-pill" data-kind="${esc(k)}" aria-pressed="${F.kind === k}">${esc(k)} <b>${d.cues.filter((c) => c.kind === k).length}</b></button>`).join('')}</div>
    <div class="cu-sel"><select aria-label="Layer" data-f="lane"><option value="">every layer</option>${lanes.map((l) => `<option ${F.lane === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><select aria-label="Concept" data-f="ref"><option value="">every concept</option>${refs.map((r) => `<option ${F.ref === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    <div class="cu-tools"><button type="button" class="cu-add">Add cue at bar ${b}</button><label class="btn ghost">Import<input type="file" accept=".craftcues,.crafcues,.vtt,.json,text/vtt,application/json" hidden></label><button type="button" class="ghost" data-x="craftcues">.craftcues</button><button type="button" class="ghost" data-x="vtt">.vtt</button><button type="button" class="ghost" data-x="json">JSON</button></div></div>
    <div class="cu-sbody">${d.cues.length ? [...groups].map(([k, cs]) => `<section class="cu-sec"><h3>${esc(k)}</h3><ul class="cu-list">${cs.map((c) => `<li class="cu-item" data-id="${esc(c.id)}" data-k="${esc(c.kind)}"><button type="button" class="cu-open"><span class="cu-t">${esc(c.at)}${c.pair ? ' &#8594; ' + esc(c.pair) : ''} · ${esc(c.kind)} · @${esc(c.scope)} · ${esc(c._origin || '')}</span><br>${emph(c.body)}${c.refs.length ? ` <span class="cu-t">(${esc(c.refs.join(', '))})</span>` : ''}</button><button type="button" class="cu-ed" aria-label="Edit cue ${esc(c.id)}">Edit</button>${c._origin === 'local' ? `<button type="button" class="cu-del" aria-label="Delete cue ${esc(c.id)}">&times;</button>` : ''}</li>`).join('')}</ul></section>`).join('') || '<p class="cu-none">Nothing matches the filters.</p>' : '<p class="cu-none">No cues yet. Add one at the current bar, write <code>//@ 17-24 motif @lead: hook enters | MOT-05</code> in the code, or import a .craftcues / .vtt file.</p>'}</div>`;
}
export async function openScore() {
  await cssReady; await load();
  if (!st.sheet) {
    const s = document.createElement('dialog'); s.className = 'cu-sheet'; s.setAttribute('aria-labelledby', 'cuTitle');
    s.innerHTML = '<div class="help-head"><h2 id="cuTitle">Score cues</h2><button type="button" class="icon" id="cuClose" aria-label="Close score cues">&times;</button></div><div class="cu-host" style="display:flex;flex-direction:column;min-height:0;flex:1"></div>';
    s.querySelector('#cuClose').addEventListener('click', () => s.close()); s.addEventListener('keydown', (e) => e.stopPropagation()); s.addEventListener('click', (e) => { if (e.target === s) s.close(); });
    s.addEventListener('click', (e) => {
      const pill = e.target.closest('.cu-pill'); if (pill) { st.filt.kind = pill.dataset.kind; drawScore(); return; }
      if (e.target.closest('.cu-add')) { addAtBar(); return; }
      const x = e.target.closest('[data-x]'); if (x) { exportAs(x.dataset.x); return; }
      const it = e.target.closest('.cu-item'); if (!it) return; const c = st.doc.cues.find((y) => y.id === it.dataset.id); if (!c) return;
      if (e.target.closest('.cu-ed')) editCue(c); else if (e.target.closest('.cu-del')) { saveLocal((d) => { d.cues = d.cues.filter((y) => y.id !== c.id); }); load().then(drawScore); } else openCard(c);
    });
    s.addEventListener('change', (e) => { const sel = e.target.closest('select[data-f]'); if (sel) { st.filt[sel.dataset.f] = sel.value; drawScore(); return; } const fi = e.target.closest('input[type=file]'); if (fi && fi.files[0]) { const file = fi.files[0]; file.text().then((t) => importText(t, file.name)).catch((er) => sc.ui && sc.ui.toast('Import failed: ' + er.message, { kind: 'error' })); } });
    document.body.append(s); st.sheet = s;
  }
  drawScore(); if (!st.sheet.open) st.sheet.showModal(); st.sheet.querySelector('#cuClose').focus({ preventScroll: true }); return st.sheet;
}
export async function openLink() { return openScore(); }

/* ---------------- Resources pane section and Record takes ---------------- */
export async function resourcesSection(code) {
  await cssReady; const d = await load({ id: (source() || {}).id, code }); const ids = [...new Set(d.cues.flatMap((c) => c.refs))]; if (!ids.length) return '';
  const K = await kb(); return `<section class="rs-cues" data-cues="${ids.length}"><h3>Cues <b class="rs-n">${ids.length}</b></h3><ul class="cu-kb">${ids.map((id) => { const k = K(id); const n = d.cues.filter((c) => c.refs.includes(id)).length; return `<li data-ref="${esc(id)}"><b>${esc(id)}</b> <span data-s="${esc(k.status)}">${esc(k.kb)} · ${esc(k.status)}</span> <i>${n} cue${n === 1 ? '' : 's'}</i><small>${esc(k.title)}${k.def ? ' - ' + esc(k.def) : ''}</small>${k.link ? `<a href="${esc(k.link)}"${/^https?:/.test(k.link) ? ' target="_blank" rel="noopener"' : ''}>Open</a>` : ''}</li>`; }).join('')}</ul></section>`;
}
export async function forTake(code) { const d = await load({ id: (source() || {}).id, code }); return d.cues.length ? C.toJSON(d) : null; }
sc.cues = Object.assign(sc.cues || {}, { openScore, addAtBar, toggle: toggleCaptions, editInline, inlineSpan, lanesOf, hotCount, attach, attachQuick, load, current, bar, openCard, exportAs, importText, resourcesSection, forTake, engine: C });
Object.defineProperties(sc.cues, { doc: { get: () => st.doc, configurable: true }, strip: { get: () => st.strip, configurable: true }, clock: { get: () => st.clock, configurable: true } });
