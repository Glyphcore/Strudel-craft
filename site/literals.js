/* Smart parameter editors (docs/CONTROL_BINDING.md section 7). Every literal AST node (number, string, mini-notation token,
   group) gets an editor chosen from its param shape (data/intellisense/strudel.json `params` + `editors`). Tap or long-press opens a
   compact fixed popover (no layout shift); drag on a number scrubs (horizontal coarse, vertical fine, pinch scales). Each edit
   rewrites only that literal's span in one dispatch, so the settle scheduler compiles once and history commits once.
   API: strudelCraft.literals = { registerEditor({ id, match(lit, param) -> editorName|null, render?(host, ctx) }), list(viewId),
   set(litId, text, viewId?), nudge(litId, steps, viewId?), open(litId, viewId?), close() }  (ids from engine/bind.js literals()) */
import { literals, literalAt } from './engine/bind.js';
import { curveIn, curveOut } from './engine/controls.js';

const sc = (window.strudelCraft = window.strudelCraft || {});
const views = new Map(); let SPEC = { byShape: {}, gestures: { scrubPx: 240, finePx: 1200, longPressMs: 450, tapSlopPx: 5 }, pools: { note: [] } }; let P = {};
const providers = new Map(); const custom = new Map();
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter((x) => x != null)); return e; };

function shapeFor(l) {
  /* a provider may own this literal's shape (atom reference args carry the atom's atomParam shape, docs/ATOMS.md section 10) */
  for (const pr of providers.values()) { if (!pr.shape) continue; try { const s = pr.shape(l); if (s) return s; } catch (err) { /* provider offline */ } }
  const ps = P[l.param]; let p = ps && ps[l.arg];
  if (l.kind === 'number' && (!p || p.shape !== 'number')) { const a = Math.abs(l.value); p = { name: 'value', shape: 'number', min: l.value < 0 ? -Math.max(1, a * 4) : 0, max: a <= 1 ? 1 : Math.max(1, a * 4), curve: 'lin' }; }
  if (l.kind === 'boolean') p = { name: 'value', shape: 'bool' };
  return p || null;
}
function editorFor(l, p) {
  for (const pr of providers.values()) { try { const e = pr.match(l, p); if (e) return e; } catch (err) { /* ignore */ } }
  if (l.kind === 'number') return SPEC.byShape.number || 'scrub';
  if (l.kind === 'boolean') return 'toggle';
  if (!p) return l.kind === 'token' ? null : 'steps';
  if (l.kind === 'token' && l.group && (l.group.chord || l.group.kind === '<')) return 'chips';
  if (l.kind === 'string') return 'steps';
  if (l.mod) return null;
  return SPEC.byShape[p.shape] || null;
}
const decimals = (p) => (p.step ? Math.max(0, -Math.floor(Math.log10(p.step) + 1e-9)) : null);
function fmt(v, p) { const d = decimals(p); if (d != null) return String(+v.toFixed(d)); const a = Math.abs(v); return String(a >= 100 ? Math.round(v) : a >= 10 ? +v.toFixed(1) : +v.toFixed(a >= 1 ? 2 : 3)); }
const lim = (p) => [p.min ?? 0, p.max ?? 1];
function fromTravel(p, t) { const [lo, hi] = lim(p); let v = curveOut(p.curve || 'lin', Math.min(1, Math.max(0, t)), lo, hi); if (p.step) v = Math.round(v / p.step) * p.step; return Math.min(hi, Math.max(lo, v)); }
const toTravel = (p, v) => { const [lo, hi] = lim(p); return Math.min(1, Math.max(0, curveIn(p.curve || 'lin', v, lo, hi))); };

/* ---- edits: one dispatch per committed change, located by literal id (no caret needed) ---- */
const viewOf = (id) => (views.get(id || 'code') || [...views.values()][0]);
const find = (view, litId) => { const r = literals(view.state.doc.toString()); return r.ok ? r.literals.find((l) => l.id === litId) : null; };
function replace(view, from, to, text) { if (view.state.sliceDoc(from, to) === text) return; view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input.literal' }); }
function setLit(litId, text, viewId) { const v = viewOf(viewId); const l = v && find(v, litId); if (!l) return false; replace(v, l.from, l.to, String(text)); return true; }
function nudge(litId, steps, viewId) { const v = viewOf(viewId); const l = v && find(v, litId); if (!l || l.kind !== 'number') return false; const p = shapeFor(l); replace(v, l.from, l.to, fmt(fromTravel(p, toTravel(p, l.value) + steps / 100), p)); return true; }

/* ---- popover ---- */
let pop = null;
function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); } }
function outside(e) { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.cm-scroller'))) close(); } /* taps in the code: the gesture switches or toggles */
function place(view, l, el) {
  const c = view.coordsAtPos(l.from) || { left: 8, bottom: 80, top: 60 }; document.body.append(el);
  const w = el.offsetWidth, ht = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.max(6, Math.min(vw - w - 6, c.left - 12)); const below = c.bottom + 6 + ht < vh - 70; /* keep clear of the transport bar */
  el.style.left = left + 'px'; el.style.top = (below ? c.bottom + 6 : Math.max(6, c.top - ht - 6)) + 'px';
}
function open(view, l, { focus = true } = {}) {
  close(); const p = shapeFor(l); const ed = editorFor(l, p); if (!ed) return false;
  const body = h('div', { class: 'lit-body' });
  pop = h('div', { class: 'lit-pop', role: 'dialog', 'aria-label': `Edit ${l.param || 'value'}${p && p.name ? ' ' + p.name : ''}`, 'data-lit': l.id, 'data-editor': ed },
    h('div', { class: 'lit-head' }, h('b', {}, `${l.param || 'literal'}${p && p.name ? ' · ' + p.name : ''}`), h('span', { class: 'lit-id', title: l.path }, l.id), h('button', { type: 'button', class: 'lit-x', 'aria-label': 'Close', onclick: () => { close(); } }, '×')), body);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); view.focus(); } });
  const ctx = { view, lit: l, param: p, set: (text) => setLit(l.id, text, view.__scId), close, items: sc.intellisense ? sc.intellisense.all() : Promise.resolve([]) };
  (custom.get(ed) || EDITORS[ed] || EDITORS.steps)(body, ctx);
  place(view, l, pop); setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  if (focus) { const f = pop.querySelector('input,button,[tabindex]'); if (f) f.focus({ preventScroll: true }); }
  return true;
}
const listPick = (host, ctx, options, { search } = {}) => {
  const q = ctx.lit.quote ? '' : ''; void q;
  const inp = h('input', { class: 'lit-in', role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list', value: search ? '' : String(ctx.lit.value), 'aria-label': 'Filter', autocapitalize: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'lit-list', role: 'listbox' });
  let typed = false; inp.addEventListener('input', () => { typed = true; }, { once: true });
  const draw = () => { const f = typed ? inp.value.trim().toLowerCase() : ''; const opts = options.filter((o) => !f || o.toLowerCase().includes(f) || o === String(ctx.lit.value)).slice(0, 60);
    list.replaceChildren(...opts.map((o) => h('button', { type: 'button', role: 'option', class: 'lit-opt', 'aria-selected': String(o === String(ctx.lit.value)), 'data-v': o, onclick: () => { ctx.set(o); ctx.close(); ctx.view.focus(); } }, o))); };
  inp.addEventListener('input', draw); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = list.querySelector('.lit-opt'); if (b) b.click(); } });
  if (!search) inp.addEventListener('focus', () => inp.select()); draw(); host.append(inp, list);
};
const notePool = (l) => { const oct = (/(\d+)$/.exec(String(l.value)) || [, '3'])[1]; return (SPEC.pools.note || []).map((n) => n + oct); };
const EDITORS = {
  scrub(host, ctx) {
    const p = ctx.param; const [lo, hi] = lim(p); let v = ctx.lit.value;
    const out = h('output', { class: 'lit-val' }, fmt(v, p) + (p.unit ? ' ' + p.unit : ''));
    const r = h('input', { type: 'range', class: 'lit-range', min: 0, max: 1000, step: 1, value: Math.round(toTravel(p, v) * 1000), 'aria-label': `${p.name || 'value'} (${lo} to ${hi}${p.unit ? ' ' + p.unit : ''})`, 'aria-valuetext': fmt(v, p) });
    r.addEventListener('input', () => { v = fromTravel(p, r.value / 1000); out.textContent = fmt(v, p) + (p.unit ? ' ' + p.unit : ''); r.setAttribute('aria-valuetext', fmt(v, p)); });
    r.addEventListener('change', () => ctx.set(fmt(v, p))); /* commit once when the gesture ends */
    host.append(h('div', { class: 'lit-row' }, out, h('span', { class: 'lit-rng' }, `${lo}..${hi}${p.curve && p.curve !== 'lin' ? ' ' + p.curve : ''}`)), r);
  },
  combobox(host, ctx) { listPick(host, ctx, ctx.param.options || []); },
  list(host, ctx) { ctx.items.then((items) => listPick(host, ctx, [...new Set(items.filter((i) => i.string && /sounds/.test(i.category || '')).map((i) => i.label))], { search: true })); },
  toggle(host, ctx) { const on = ctx.lit.value === true || ctx.lit.value === 'true'; host.append(h('button', { type: 'button', class: 'lit-tog', 'aria-pressed': String(on), onclick: () => { ctx.set(on ? 'false' : 'true'); ctx.close(); } }, on ? 'true → false' : 'false → true')); },
  piano(host, ctx) { /* live: every key / octave change rewrites the literal at once (no confirm); octave keeps pitch class + accidental */
    const parse = (t) => { const m = /^([a-gA-G])(#|b|s|f)?(-?\d+)?$/.exec(String(t)); return m ? { pc: m[1].toLowerCase(), acc: m[2] || '', oct: m[3] != null ? +m[3] : null } : null; };
    let cur = String(ctx.lit.value); const p0 = parse(cur) || { pc: 'c', acc: '', oct: 3 }; let oct = p0.oct ?? 3;
    const name = h('output', { class: 'lit-val', 'aria-live': 'polite' }); const keys = h('div', { class: 'lit-piano', role: 'group', 'aria-label': 'Pitch' }); const lab = h('span', { class: 'lit-oct' });
    const apply = (n) => { cur = n; ctx.set(n); draw(); };
    const draw = () => { name.textContent = cur; lab.textContent = 'oct ' + oct; const q = parse(cur);
      keys.replaceChildren(...(SPEC.pools.note || []).map((n) => h('button', { type: 'button', class: 'lit-key' + (n.length > 1 ? ' blk' : ''), 'data-v': n, 'aria-pressed': String(!!q && q.pc + q.acc === n), onclick: () => apply(n + oct) }, n))); };
    const shift = (d) => { oct += d; const q = parse(cur); if (q) apply(q.pc + q.acc + oct); else draw(); };
    host.append(h('div', { class: 'lit-row' }, name, h('span', { class: 'lit-row' }, h('button', { type: 'button', class: 'lit-mini', id: 'litOctDown', 'aria-label': 'Octave down', onclick: () => shift(-1) }, '−'), lab, h('button', { type: 'button', class: 'lit-mini', id: 'litOctUp', 'aria-label': 'Octave up', onclick: () => shift(1) }, '+'))), keys); draw();
  },
  chips(host, ctx) { /* set / multi-value: chord [a,b,c] or alternatives <a b c>; toggling rewrites only the group span */
    const l = ctx.lit, g = l.group; const doc = ctx.view.state.doc; const inner = doc.sliceString(g.from + 1, g.to - 1); const sep = g.chord ? ',' : ' ';
    let items = inner.split(g.chord ? ',' : /\s+/).map((s) => s.trim()).filter(Boolean);
    const pool = [...new Set([...items, ...(ctx.param && ctx.param.shape === 'note' ? notePool(l) : ctx.param && ctx.param.options ? ctx.param.options : [])])];
    const wrap = h('div', { class: 'lit-chips', role: 'group', 'aria-label': g.chord ? 'Chord notes' : 'Alternatives' });
    const draw = () => wrap.replaceChildren(...pool.map((x) => h('button', { type: 'button', class: 'lit-chip', 'aria-pressed': String(items.includes(x)), 'data-v': x, onclick: () => {
      items = items.includes(x) ? (items.length > 1 ? items.filter((y) => y !== x) : items) : [...items, x];
      const f = find(ctx.view, l.id) || l; const gg = f.group || g; replace(ctx.view, gg.from + 1, gg.to - 1, items.join(sep)); draw(); } }, x)));
    draw(); host.append(wrap);
  },
  steps(host, ctx) { /* mini-notation sequence: every token is an editable chip */
    const l = ctx.lit; const s = l.kind === 'token' ? l.str : { from: l.from, to: l.to };
    const toks = (literals(ctx.view.state.doc.toString()).literals || []).filter((x) => x.kind === 'token' && x.str && x.str.from === s.from && !x.mod);
    const wrap = h('div', { class: 'lit-steps', role: 'group', 'aria-label': 'Steps' });
    toks.forEach((t) => { const i = h('input', { class: 'lit-step', value: t.value, size: Math.max(1, t.value.length), 'aria-label': 'Step ' + t.value, 'data-lit': t.id, autocapitalize: 'off', spellcheck: 'false' });
      i.addEventListener('input', () => { const v = i.value.trim().replace(/\s+/g, ''); if (v && /^[~A-Za-z0-9#_.\-]+$/.test(v)) setLit(t.id, v, ctx.view.__scId); }); wrap.append(i); }); /* live: each keystroke rewrites that token; the settle scheduler compiles once */
    host.append(wrap);
  },
};

/* ---- gestures on the code: scrub / fine / pinch on numbers, tap or long-press opens ---- */
function attachGestures(view) {
  const G = SPEC.gestures || {}; const el = view.scrollDOM; let g = null; const pts = new Map();
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g && pts.size === 2 && g.lit.kind === 'number') { const [a, b] = [...pts.values()]; g.pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; g.moved = true; e.preventDefault(); return; }
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }); if (pos == null) return;
    const l = literalAt(view.state.doc.toString(), pos); if (!l) { if (pop) close(); return; }
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, lit: l, pos, moved: false, p: shapeFor(l), t0: 0, v: l.value, wasOpen: !!(pop && pop.dataset.lit === l.id) };
    if (l.kind === 'number') { g.t0 = toTravel(g.p, l.value); e.preventDefault(); el.setPointerCapture(e.pointerId); } /* no focus(): never forces the soft keyboard */
    g.lp = setTimeout(() => { if (g && !g.moved) { g.done = true; open(view, l); } }, G.longPressMs || 450);
  }, true);
  el.addEventListener('pointermove', (e) => {
    if (!g) return; if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) > (G.tapSlopPx || 5)) { g.moved = true; clearTimeout(g.lp); }
    if (!g.moved || g.lit.kind !== 'number') return; e.preventDefault();
    let t = g.t0 + dx / (G.scrubPx || 240) - dy / (G.finePx || 1200);
    if (g.pinch0 && pts.size === 2) { const [a, b] = [...pts.values()]; t = g.t0 + Math.log2((Math.hypot(a.x - b.x, a.y - b.y) || 1) / g.pinch0) * 0.25; }
    g.v = fromTravel(g.p, t); badge(view, g.lit, fmt(g.v, g.p) + (g.p.unit ? ' ' + g.p.unit : ''));
  }, true);
  const end = (e) => {
    pts.delete(e.pointerId); if (!g || (e.pointerId !== g.id && pts.size)) return; const d = g; g = null; clearTimeout(d.lp); hideBadge();
    if (d.lit.kind === 'number' && d.moved) { const f = find(view, d.lit.id); if (f) replace(view, f.from, f.to, fmt(d.v, d.p)); return; } /* one edit when the gesture settles */
    if (d.done || d.moved) return;
    if (d.wasOpen) { close(); return; } /* tap the same literal: toggle */
    if (d.lit.kind === 'number') view.dispatch({ selection: { anchor: d.pos } });
    const fresh = literalAt(view.state.doc.toString(), d.pos) || d.lit; /* re-resolve from the tap position (works after swaps / re-derivation, caret already inside, focused editor) */
    open(view, fresh, { focus: false }); /* opened from the pointer event itself; caret stays, no keyboard */
  };
  el.addEventListener('pointerup', end, true); el.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); if (g) { clearTimeout(g.lp); g = null; hideBadge(); } }, true);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { close(); return; } if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { const pos = view.state.selection.main.head; const l = literalAt(view.state.doc.toString(), pos); if (l && l.kind === 'number') { e.preventDefault(); nudge(l.id, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), view.__scId); } } });
}
let bdg = null;
function badge(view, l, text) { if (!bdg) { bdg = h('div', { class: 'lit-badge', role: 'status' }); document.body.append(bdg); } bdg.textContent = text; const c = view.coordsAtPos(l.from); if (c) { bdg.style.left = Math.max(4, c.left) + 'px'; bdg.style.top = Math.max(4, c.top - 30) + 'px'; } }
function hideBadge() { if (bdg) { bdg.remove(); bdg = null; } }

export async function attach(view, id) {
  view.__scId = id; views.set(id, view);
  const d = { editors: await sc.packs.editors().catch(() => ({})) };
  SPEC = { ...SPEC, ...(d.editors || {}) }; P = sc.intellisense && sc.intellisense.params ? await sc.intellisense.params() : d.params || {};
  attachGestures(view);
}
sc.literals = {
  /* { id, match?(lit, param) -> editorName|null, shape?(lit) -> param|null, render?(host, ctx) } */
  registerEditor(p) { if (!p || !p.id) throw new Error('editor provider needs {id}'); if (p.match || p.shape) providers.set(p.id, p); if (p.render) custom.set(p.id, p.render); return () => { providers.delete(p.id); custom.delete(p.id); }; },
  list: (viewId) => { const v = viewOf(viewId); const r = v ? literals(v.state.doc.toString()) : { literals: [] }; return (r.literals || []).map((l) => ({ ...l, editor: editorFor(l, shapeFor(l)), shape: shapeFor(l) })); },
  set: setLit, nudge, open: (litId, viewId) => { const v = viewOf(viewId); const l = v && find(v, litId); return l ? open(v, l) : false; }, close,
};
