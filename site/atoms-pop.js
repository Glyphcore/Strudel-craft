/* Atoms A4 (#64, docs/ATOMS.md section 10 "Editors"): the reference popover in the code editor. An `atoms.*` reference is one token:
   a tap on it, or Enter with the caret on it, opens this popover (atoms-site.js triggers it; this module loads on first use).
   Shows the compiled string, the atom's param editors and the actions Edit definition, Derive, Detach and Go to card.
   Data comes from strudelCraft.atoms.open(siteId) (engine/atoms-consumers.js siteData); every edit is one editor transaction on the
   reference span (args rewritten with refText, Detach inlines the type's literal), so the settle scheduler compiles once.
   The popover is position:fixed and appended to <body>: opening it never moves a code line. Escape or a tap outside closes it. */
const sc = (window.strudelCraft = window.strudelCraft || {});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter((x) => x != null)); return e; };
const TYPE = (t) => String(t || 'atom').toUpperCase();
let pop = null, cur = null;

function cssReady() {
  let l = document.querySelector('link[href="atoms-ui.css"]'); if (l && l.sheet) return Promise.resolve();
  if (!l) { l = h('link', { rel: 'stylesheet', href: 'atoms-ui.css' }); document.head.append(l); }
  return new Promise((res) => { l.addEventListener('load', res, { once: true }); l.addEventListener('error', res, { once: true }); });
}
export function close({ refocus = false } = {}) {
  if (!pop) return; const v = cur && cur.view; pop.remove(); pop = null; cur = null; document.body.classList.remove('ax-popping');
  document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true);
  if (refocus && v) v.focus();
}
function onKey(e) { if (e.key === 'Escape' && pop) { e.preventDefault(); e.stopPropagation(); close({ refocus: true }); } }
function outside(e) { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.modal, .toasts'))) close(); }
const siteAt = (view, pos) => { const doc = view.state.doc.toString(); return (sc.atoms.sites(doc) || []).find((s) => pos >= s.from && pos <= s.to) || null; };
function edit(view, from, to, insert, label) { view.dispatch({ changes: { from, to, insert }, userEvent: 'input.atom' }); if (label) sc.ui && sc.ui.toast(label, { kind: 'ok', ms: 2200 }); }
function numOr(s, spec) { const t = String(s).trim(); if (spec && spec.shape === 'number') { const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; } if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); if (t === 'true' || t === 'false') return t === 'true'; return t; }

export async function open(view, site, { focus = true } = {}) {
  if (!site) return false; await cssReady(); close();
  const d = sc.atoms.open(site.id, view.state.doc.toString()) || site; cur = { view, site: d };
  const args = { ...(d.args || {}) };
  const params = { ...(d.params || {}) }; for (const k of Object.keys(args)) if (!params[k]) params[k] = (d.argSites.find((a) => a.param === k) || {}).shape || {};
  const rows = Object.entries(params).map(([k, s]) => {
    const v = args[k] !== undefined ? args[k] : s.default;
    const num = s.shape === 'number';
    const inp = h('input', { class: 'ax-in', 'data-param': k, value: v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v), ...(num ? { type: 'number', inputmode: 'decimal', min: s.min, max: s.max, step: s.step ?? 'any' } : { type: 'text', autocapitalize: 'off', spellcheck: 'false' }),
      'aria-label': `${k}${s.unit ? ' (' + s.unit + ')' : ''}${s.min != null ? `, ${s.min} to ${s.max}` : ''}${args[k] === undefined ? ', default' : ''}` });
    inp.addEventListener('change', () => setArg(k, inp.value, s));
    return h('label', { class: 'ax-row' }, h('span', {}, k), inp);
  });
  const act = (id, text, fn, extra = {}) => h('button', { type: 'button', class: 'ghost', 'data-ax': id, onclick: fn, ...extra }, text);
  const declared = new RegExp(`\\batom\\s*\\(\\s*["']${d.atom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(view.state.doc.toString());
  pop = h('div', { class: 'ax-pop', role: 'dialog', 'aria-label': `Atom reference atoms.${d.atom}`, 'data-site': d.id },
    h('div', { class: 'ax-pop-h' }, h('span', { class: 'ax-badge' }, TYPE(d.type)), h('b', {}, `atoms.${d.atom}`), h('button', { type: 'button', class: 'ghost ax-pop-x', 'aria-label': 'Close', onclick: () => close({ refocus: true }) }, '×')),
    h('p', { class: 'ax-pv ax-pv-l' }, h('code', { 'aria-label': 'Compiled string' }, d.text == null ? 'unresolved' : JSON.stringify(d.text))),
    d.doc ? h('p', { class: 'ax-pop-hint' }, d.doc) : null,
    ...rows,
    h('div', { class: 'ax-acts' },
      act('edit', 'Edit definition', editDef, { disabled: !declared, title: declared ? '' : 'Catalog or imported atom: no declaration in this program' }),
      act('derive', 'Derive…', derive, { disabled: !Object.keys(args).length && !(d.ops || []).length, title: 'Name the current arguments as a new atom' }),
      act('detach', 'Detach', detach, { title: `Replace this reference with ${d.detach}` }),
      act('card', 'Go to card', goCard)));
  document.body.append(pop); document.body.classList.add('ax-popping'); place(view, d);
  const mine = pop; setTimeout(() => { if (pop === mine) document.addEventListener('pointerdown', outside, true); }, 0); document.addEventListener('keydown', onKey, true); // closed before the tick: no stale listener
  if (focus) { const f = pop.querySelector('input, [data-ax=detach]'); if (f) f.focus({ preventScroll: true }); }
  return true;
}
function place(view, d) {
  const c = view.coordsAtPos(d.from) || { left: 8, top: 60, bottom: 80 }; const w = pop.offsetWidth, ht = pop.offsetHeight, vw = innerWidth, vh = innerHeight;
  pop.style.left = Math.max(6, Math.min(vw - w - 6, c.left - 12)) + 'px';
  const below = c.bottom + 6 + ht < vh - 70; pop.style.top = (below ? c.bottom + 6 : Math.max(6, c.top - ht - 6)) + 'px';
}
function fresh() { const { view, site } = cur; return siteAt(view, site.from) || null; }
function setArg(k, raw, spec) {
  const s = fresh(); if (!s) return;
  const v = numOr(raw, spec); if (v == null) return sc.ui && sc.ui.toast(`${k} needs a number`, { kind: 'error' });
  if (spec.min != null && typeof v === 'number' && (v < spec.min || v > spec.max) && spec.clamp === 'hard') return sc.ui.toast(`${k} must be ${spec.min}..${spec.max}`, { kind: 'error' });
  const args = { ...(s.args || {}), [k]: v };
  const text = sc.atoms.refText(s.atom, args, s.ops || []);
  const view = cur.view; edit(view, s.from, s.to, text);
  const n = siteAt(view, s.from); if (n) open(view, n, { focus: false }).then(() => { const i = pop && pop.querySelector(`[data-param="${CSS.escape(k)}"]`); if (i) i.focus({ preventScroll: true }); });
}
function editDef() {
  const { view, site } = cur; const doc = view.state.doc.toString();
  const m = new RegExp(`\\batom\\s*\\(\\s*["']${site.atom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).exec(doc); if (!m) return;
  const line = view.state.doc.lineAt(m.index); close();
  view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true }); view.focus();
}
async function derive() {
  const { view } = cur; const s = fresh(); if (!s) return;
  const sug = `${s.atom}${Object.values(s.args || {}).map((v) => String(v).replace(/\W/g, '')).join('')}`;
  close();
  const name = sc.ui ? await sc.ui.ask({ title: `Derive from atoms.${s.atom}`, label: 'Name of the derived atom', value: sug, okText: 'Derive' }) : null;
  if (name == null) { view.focus(); return; }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return sc.ui.toast(`"${name}" is not an atom name: letters, digits and _`, { kind: 'error' });
  const doc = view.state.doc.toString();
  if (new RegExp(`\\batom\\s*\\(\\s*["']${name}["']`).test(doc)) return sc.ui.toast(`atoms.${name} already exists`, { kind: 'error' });
  const decls = [...doc.matchAll(/^\s*atom\s*\(.*$/gm)]; const at = decls.length ? decls[decls.length - 1].index + decls[decls.length - 1][0].length : 0;
  const line = `atom(${JSON.stringify(name)}, { type: ${JSON.stringify(s.type)}, from: ${sc.atoms.refText(s.atom, s.args || {}, s.ops || [])} })`;
  view.dispatch({ changes: [{ from: at, to: at, insert: (at ? '\n' : '') + line + (at ? '' : '\n') }, { from: s.from, to: s.to, insert: `atoms.${name}` }], userEvent: 'input.atom' });
  sc.ui.toast(`Derived atoms.${name}`, { kind: 'ok', ms: 2200 }); view.focus();
}
function detach() {
  const { view } = cur; const s = fresh(); if (!s) return; close();
  edit(view, s.from, s.to, s.detach, `Detached: ${s.detach} inlined here`); view.focus();
}
async function goCard() {
  const s = fresh(); close(); if (!s) return;
  const link = document.querySelector('.views a[data-view="graph"]'); if (link) link.click();
  for (let i = 0; i < 80 && !(sc.atomsUI && sc.graph); i++) await new Promise((r) => setTimeout(r, 100));
  if (sc.atomsUI && sc.atomsUI.goto(s.atomId || sc.atoms.idFor(s.type, s.atom))) return;
  sc.ui && sc.ui.toast(`atoms.${s.atom} has no card in the graph program: load this code with Rack in the Graph view`, { kind: 'info', ms: 4000 });
}
sc.atomsPop = { open, close, get current() { return cur && cur.site; } };
void esc;
