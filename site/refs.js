/* Reference inspector (docs/CONTROL_BINDING.md section 8). One service for every surface:
   window.strudelCraft.refs = { resolve(id), related(id), highlight(id|null, opts), describe(id), tip(el, id), hideTip(), attachEditor(view, id) }
   - selecting a control (inline cell, board knob, pad or graph card with data-ref) marks its source span in the editor (soft background,
     gutter indicator, scrolled into view) and tints related spans (mapped param, hook slot, taps, same-label controls) in the same colour;
   - the caret or a tap on a source call/literal makes its controls glow wherever they are;
   - long-press (touch), hover or focus shows a compact fixed tooltip (aria-describedby) with id, path, label, type, shape, value, range, maps. */
import { literals } from './engine/bind.js';

const sc = (window.strudelCraft = window.strudelCraft || {});
const EDITORS = { rack: 'code', stack: 'stackCode' };
const ctrls = () => sc.perform && sc.perform.controls;
const isApi = () => sc.intellisense && sc.intellisense.refMarks;
const SEL = '[data-site],[data-ctl],[data-id],[data-ref]';

function idOf(el) {
  const e = el && el.closest && el.closest(SEL); if (!e) return null;
  const raw = e.dataset.site || e.dataset.ctl || e.dataset.id || e.dataset.ref; const c = ctrls();
  return raw && c && c.resolve ? c.resolve(raw) : raw;
}
function docOf(view) { const v = isApi() && sc.intellisense.refView(EDITORS[view]); return v ? v.state.doc.toString() : ''; }
function offset(view) { /* sites are in evaluated-source coordinates (tempo prefix etc.); map to the editor text */
  const src = sc.binder && sc.binder.source(view); const doc = docOf(view); if (src == null || !doc) return 0;
  if (src.endsWith(doc)) return src.length - doc.length; const i = src.indexOf(doc); return i >= 0 ? i : 0;
}
export function resolve(id) {
  if (!id) return null; const c = ctrls(); if (c && c.resolve) id = c.resolve(id);
  for (const view of Object.keys(EDITORS)) {
    const site = sc.binder && sc.binder.sites(view).find((s) => s.id === id);
    if (site) return { id, kind: 'control', view, site, off: offset(view) };
  }
  for (const view of Object.keys(EDITORS)) { const r = literals(docOf(view)); const l = r.ok && r.literals.find((x) => x.id === id); if (l) return { id, kind: 'literal', view, literal: l, off: 0 }; }
  return c && c.has && c.has(id) ? { id, kind: 'control', view: null, site: null, off: 0 } : null;
}
const spansOf = (doc, re) => { const out = []; let m; re.lastIndex = 0; while ((m = re.exec(doc))) { out.push([m.index + (m[1] ? m[0].indexOf(m[1]) : 0), m.index + (m[1] ? m[0].indexOf(m[1]) + m[1].length : m[0].length)]); if (!re.global) break; } return out; };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function related(id) {
  const r = resolve(id); if (!r) return { spans: [], ids: [], dests: [], slot: null };
  const c = ctrls(); const doc = r.view ? docOf(r.view) : ''; const off = r.off || 0; const spans = []; const ids = new Set();
  const site = r.site; const dests = c ? c.maps().filter((m) => m.control.split(':')[0] === r.id).map((m) => m.dest) : [];
  if (site && site.pStart != null) spans.push([site.pStart - off, site.pEnd - off]); /* the param it drives */
  for (const d of dests) { const name = d.replace(/^param:|^slot:/, ''); spansOf(doc, new RegExp('\\.(' + esc(name) + ')\\(', 'g')).forEach((s) => spans.push(s)); spansOf(doc, new RegExp('hooks\\.map\\([^\\n]*' + esc(name), 'g')).forEach((s) => spans.push(s)); }
  if (site && site.slot) spansOf(doc, new RegExp('[\'"](' + esc(site.slot) + ')[\'"]', 'g')).forEach((s) => spans.push(s));
  const label = site && site.label; /* other controls bound to the same id or label; taps of that name */
  if (label) { for (const v of Object.keys(EDITORS)) for (const s of (sc.binder ? sc.binder.sites(v) : [])) if (s.id !== r.id && s.label === label) ids.add(s.id); spansOf(doc, new RegExp('tap\\([\'"](' + esc(label) + ')[\'"]', 'g')).forEach((s) => spans.push(s)); }
  return { spans, ids: [...ids], dests, slot: site ? site.slot : null };
}
export function describe(id) {
  const r = resolve(id); if (!r) return null; const c = ctrls(); const s = r.site; const P = sc.intellisense && sc.intellisense.__paramsSync;
  const spec = c && c.has(r.id) ? c.declare(r.id) : null; const shape = s && P && P[s.param] ? P[s.param][Math.max(0, s.arg)] : null;
  if (r.kind === 'literal') { const l = r.literal; return { id: r.id, path: l.path, label: l.param ? `${l.param}·${l.arg}` : 'literal', type: l.kind, shape: shape ? shape.shape : null, value: l.value, range: null, maps: [] }; }
  return { id: r.id, path: s ? s.path : '(model only)', label: (s && s.label) || (c && c.labelOf && c.labelOf(r.id)) || (s ? `${s.param || 'ctl'}·${Math.max(0, s.arg)}` : r.id), type: spec ? spec.type : s ? s.kind : '?',
    shape: shape ? shape.shape + (shape.unit ? ' ' + shape.unit : '') : spec && spec.unit ? 'number ' + spec.unit : 'number', value: c && c.has(r.id) ? c.get(r.id) : s && s.value,
    range: spec && spec.min != null ? [spec.min, spec.max] : null, maps: related(r.id).dests.concat(s && s.param ? ['param ' + s.param] : []), slot: s ? s.slot : null, view: r.view };
}

/* ---- highlight ---- */
let cur = null;
function glow(ids, cls) { for (const id of ids) document.querySelectorAll(`[data-site="${CSS.escape(id)}"],[data-ctl="${CSS.escape(id)}"],[data-id="${CSS.escape(id)}"],[data-ref="${CSS.escape(id)}"]`).forEach((e) => e.classList.add(cls)); }
function clear() { document.querySelectorAll('.ref-glow,.ref-glow-rel').forEach((e) => e.classList.remove('ref-glow', 'ref-glow-rel')); if (isApi()) for (const ed of Object.values(EDITORS)) sc.intellisense.refMarks(ed, {}); cur = null; }
export function highlight(id, { scroll = true, editor = true } = {}) {
  clear(); const r = id && resolve(id); if (!r) return null; cur = r.id; const rel = related(r.id);
  glow([r.id], 'ref-glow'); glow(rel.ids, 'ref-glow-rel');
  if (editor && r.view && isApi()) {
    const span = r.site ? [r.site.start - r.off, r.site.end - r.off] : r.literal ? [r.literal.from, r.literal.to] : null;
    const relSpans = rel.spans.concat(...rel.ids.map((x) => { const q = resolve(x); return q && q.site ? [[q.site.start - q.off, q.site.end - q.off]] : []; }));
    sc.intellisense.refMarks(EDITORS[r.view], { id: r.id, primary: span, related: relSpans, scroll });
  }
  document.dispatchEvent(new CustomEvent('refs:highlight', { detail: { id: r.id, related: rel } }));
  return { id: r.id, related: rel };
}

/* ---- tooltip ---- */
let tipEl = null, tipFor = null;
function tipNode() {
  if (tipEl) return tipEl; tipEl = document.createElement('div'); tipEl.id = 'scRefTip'; tipEl.className = 'ref-tip'; tipEl.setAttribute('role', 'tooltip'); tipEl.hidden = true;
  const x = document.createElement('button'); x.type = 'button'; x.className = 'ref-tip-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×'; x.addEventListener('click', hideTip);
  tipEl.append(x, document.createElement('dl')); document.body.append(tipEl); return tipEl;
}
const fmtV = (v) => (typeof v === 'number' ? String(+v.toFixed(Math.abs(v) >= 100 ? 0 : 3)) : v && typeof v === 'object' ? JSON.stringify(v) : String(v));
export function tip(el, id) {
  const d = describe(id); if (!d) return; const t = tipNode(); const dl = t.querySelector('dl');
  const rows = [['id', d.id], ['path', d.path], ['label', d.label], ['type', d.type + (d.shape ? ' · ' + d.shape : '')], ['value', fmtV(d.value) + (d.range ? `  (${d.range[0]} to ${d.range[1]})` : '')], ['maps', d.maps.length ? d.maps.join(', ') : 'none']];
  dl.replaceChildren(...rows.flatMap(([k, v]) => { const a = document.createElement('dt'); a.textContent = k; const b = document.createElement('dd'); b.textContent = v; b.dataset.k = k; return [a, b]; }));
  t.hidden = false; const r = el.getBoundingClientRect(); const w = t.offsetWidth, ht = t.offsetHeight;
  t.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px'; t.style.top = (r.top - ht - 8 > 6 ? r.top - ht - 8 : Math.min(innerHeight - ht - 6, r.bottom + 8)) + 'px';
  if (tipFor && tipFor !== el) tipFor.removeAttribute('aria-describedby'); tipFor = el; el.setAttribute('aria-describedby', 'scRefTip');
}
export function hideTip() { if (tipEl) tipEl.hidden = true; if (tipFor) { tipFor.removeAttribute('aria-describedby'); tipFor = null; } }

/* ---- surface wiring: long-press (touch), hover / focus (desktop), select = highlight ---- */
const focusable = (el) => el && el.closest && el.closest(SEL) && !el.closest('.cm-editor') && !el.closest('#scRefTip');
let lp = null;
document.addEventListener('pointerdown', (e) => {
  if (tipEl && !tipEl.hidden && !tipEl.contains(e.target)) hideTip();
  if (!focusable(e.target)) return; const id = idOf(e.target); if (!id) return; const host = e.target.closest(SEL);
  highlight(id); clearTimeout(lp && lp.t); lp = { x: e.clientX, y: e.clientY, t: setTimeout(() => tip(host, id), e.pointerType === 'mouse' ? 600 : 450) };
}, true);
document.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) { clearTimeout(lp.t); lp = null; } }, true);
document.addEventListener('pointerup', () => { if (lp) { clearTimeout(lp.t); lp = null; } }, true);
let hov = 0;
document.addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse' || !focusable(e.target)) return; const host = e.target.closest(SEL); const id = idOf(host); clearTimeout(hov); hov = setTimeout(() => id && tip(host, id), 350); });
document.addEventListener('pointerout', (e) => { if (e.pointerType !== 'mouse') return; clearTimeout(hov); if (tipFor && !(e.relatedTarget && tipFor.contains(e.relatedTarget))) hideTip(); });
document.addEventListener('focusin', (e) => { if (!focusable(e.target)) return; const host = e.target.closest(SEL); const id = idOf(host); if (id) { highlight(id, { scroll: false }); tip(e.target, id); } });
document.addEventListener('focusout', (e) => { if (tipFor && (tipFor === e.target || tipFor.contains(e.target))) hideTip(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ((tipEl && !tipEl.hidden) || cur)) { hideTip(); clear(); } });

/* ---- reverse: caret / tap in the code makes its controls glow ---- */
export function attachEditor(view, edId) {
  const vname = Object.keys(EDITORS).find((k) => EDITORS[k] === edId); if (!vname) return;
  const probe = () => {
    const pos = view.state.selection.main.head; const off = offset(vname); const list = sc.binder ? sc.binder.sites(vname) : [];
    const p = pos + off; const hit = list.filter((s) => (p >= s.start && p <= s.end) || (s.callStart != null && p >= s.callStart && p <= s.callEnd)).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    document.querySelectorAll('.ref-glow,.ref-glow-rel').forEach((x) => x.classList.remove('ref-glow', 'ref-glow-rel'));
    if (!hit) { if (cur) { cur = null; if (isApi()) sc.intellisense.refMarks(edId, {}); } return; }
    cur = hit.id; glow([hit.id], 'ref-glow'); glow(related(hit.id).ids, 'ref-glow-rel');
    if (isApi()) sc.intellisense.refMarks(edId, { id: hit.id, primary: [hit.start - off, hit.end - off], related: related(hit.id).spans, scroll: false });
    document.dispatchEvent(new CustomEvent('refs:highlight', { detail: { id: hit.id, from: 'code' } }));
  };
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(probe, 60); };
  view.dom.addEventListener('pointerup', later); view.dom.addEventListener('keyup', later);
}

sc.refs = { resolve, related, highlight, describe, tip, hideTip, clear, attachEditor, current: () => cur };
