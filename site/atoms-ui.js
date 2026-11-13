/* Atoms A4 (#64, docs/ATOMS.md sections 9 and 10): atom cards in the Graph view, the atom browser, and the card inspector.
   Loaded by graph.js with the Graph view, never with the shell. Holds no atom state: every render re-projects the graph's model
   (graph(model) atom nodes + engine/atoms.js modelRefs / resolve / paramsOf); every edit is one model.js op through graph.js doOps,
   or (declaration body / defaults, which model.js has no op for yet) one splice of that declaration's literal in the program text.
   Cards on reference: a card exists only while a reference at the visible level points at it; one card per atom, shared, with the
   reference count; a derived reference (`atoms.kick4({ n: 8 })`) gets its own card keyed by { atom, args, ops }, wired from its parent.
   Cost is proportional to references: the env is built from the referenced atoms (and their `from` / atom-param closure) only. */
import * as acorn from './vendor/acorn-8.19.0.mjs';
import * as A from './engine/atoms.js';
import * as C from './engine/atoms-consumers.js';

const sc = (window.strudelCraft = window.strudelCraft || {});
const PAGE = C.MAX_ITEMS; // 50 rows per page (ATOMS 9)
const CATS = { snd: 'sound', bank: 'bank', scale: 'scale', chord: 'chord' };
const ROWH = 52;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}` : JSON.stringify(v));
const short = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const TYPE = (t) => String(t || 'atom').toUpperCase();
let X = null; // graph.js context (functions only)
let P = { cards: new Map(), names: {}, env: null, prev: null, pos: new Map() }; // last projection, rebuilt on every decorate (no atom state)

// stylesheet first, so cards and the browser never paint unstyled
export function loadCss() {
  let l = document.querySelector('link[href="atoms-ui.css"]'); if (l && l.sheet) return Promise.resolve();
  if (!l) { l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'atoms-ui.css'; document.head.append(l); }
  return new Promise((res) => { l.addEventListener('load', res, { once: true }); l.addEventListener('error', res, { once: true }); });
}

/* ---------------------------------------------------------------- projection */
// the referenced atoms plus everything they need (from chains, atom-valued param defaults, $atom nodes in bodies)
function closure(atoms, ids) {
  const out = {}, todo = [...ids];
  while (todo.length) {
    const id = todo.pop(); if (out[id] || !atoms[id]) continue; const rec = atoms[id]; out[id] = rec;
    const s = JSON.stringify(rec); for (const m of s.matchAll(/"\$atom":"([^"]+)"/g)) todo.push(m[1].replace(/@\d+$/, ''));
    if (rec.from && rec.from.atom) { const f = rec.from.atom; todo.push(f, ...Object.keys(atoms).filter((k) => atoms[k].name === f)); }
  }
  return out;
}
const nameOf = (id) => P.names[id] || id;
function preview(ref) { try { const v = A.resolve(P.env, { ...ref, $atom: nameOf(ref.$atom) }); return v.text ?? JSON.stringify(v.obj); } catch (e) { return null; } }
function typeOfRef(ref) { try { return A.resolve(P.env, { ...ref, $atom: nameOf(ref.$atom) }).type; } catch (e) { return null; } }
function argLabel(args = {}, ops = []) { const a = Object.entries(args).map(([k, v]) => `${k}: ${isObj(v) && v.$atom ? 'atoms.' + nameOf(v.$atom) : JSON.stringify(v)}`).join(', '); return `${a ? `(${a})` : ''}${ops.map((o) => '.' + o[0] + '()').join('')}`; }
export function refLabel(ref) { const pv = P.env ? preview(ref) : null; return `atoms.${nameOf(ref.$atom)}${argLabel(ref.args, ref.ops)}${pv != null ? ' ' + JSON.stringify(pv) : ''}`; }

// where a reference sits: a track step argument (literal op) or a binding gate (setGate op)
function siteOf(model, path) {
  let m = /^\/tracks\/(\d+)\/(source|chain\/(\d+))\/(\d+)$/.exec(path);
  if (m) { const t = (model.tracks || [])[+m[1]]; if (!t) return null; const step = m[2] === 'source' ? 'source' : +m[3]; const s = step === 'source' ? t.source : t.chain[step]; return { kind: 'step', track: t.name, step, arg: +m[4] - 1, port: s[0], node: (t.chain == null && t.source == null ? 'code:' : 'track:') + t.name }; }
  m = /^\/bindings\/(\d+)\/gate$/.exec(path);
  if (m) { const b = (model.bindings || [])[+m[1]]; if (!b) return null; const bid = b.id || `b${+m[1] + 1}`; return { kind: 'gate', binding: bid, port: `gate:${bid}` }; }
  return { kind: 'other' };
}

export function decorate(view, model) {
  const atomNodes = view.nodes.filter((n) => n.kind === 'atom');
  const prevIds = P.prev; const nextPos = new Map();
  P = { cards: new Map(), names: {}, env: null, prev: null, pos: P.pos, model };
  // slot gate ports for every binding, so a gate atom can be wired from the port itself
  for (const w of view.wires) if (w.binding) { const s = view.nmap.get(w.to.node); if (s && !s.ins.some((p) => p.name === `gate:${w.binding}`)) s.ins.push({ name: `gate:${w.binding}`, type: 'gate', label: `gate ${w.binding}`, dir: 'in' }); }
  if (!atomNodes.length) { P.prev = new Set(); P.gone = prevIds ? [...prevIds] : []; return view; }
  const atoms = model.atoms || {};
  for (const [id, a] of Object.entries(atoms)) if (atomNodes.some((n) => n.raw.atom === id)) P.names[id] = a.name;
  const need = closure(atoms, atomNodes.map((n) => n.raw.atom));
  for (const [id, a] of Object.entries(need)) P.names[id] = a.name;
  try { P.env = A.buildEnv('', { atoms: need }); } catch (e) { P.env = null; }
  // atom wires are re-derived here per reference (graph() draws one per track); the 'atom' placeholder port goes
  view.wires = view.wires.filter((w) => !w.from.node.startsWith('atom:'));
  for (const n of view.nodes) n.ins = n.ins.filter((p) => !(p.name === 'atom' && p.type === 'param'));
  const port = (n, name, type) => { let p = n.ins.find((x) => x.name === name); if (!p) { p = { name, type, label: name, dir: 'in' }; n.ins.push(p); } return p; };
  const wire = (from, to, tp, badge) => { const id = `param:${from}.out>${to}.${tp}`; if (!view.wires.some((w) => w.id === id)) view.wires.push({ id, type: 'param', from: { node: from, port: 'out' }, to: { node: to, port: tp }, window: badge, atom: true }); };
  for (const n of atomNodes) {
    const id = n.raw.atom, rec = atoms[id];
    n.atom = { id, name: nameOf(id), type: n.raw.type || typeOfRef({ $atom: id }) || 'text', catalog: !rec, count: 0, refs: [], derived: false };
    n.label = n.atom.name; if (!n.outs.length) n.outs.push({ name: 'out', type: 'param', label: 'out', dir: 'out' });
    P.cards.set(n.id, n);
  }
  const refs = A.modelRefs(model);
  for (const r of refs) {
    const base = view.nmap.get(`atom:${r.atom}`); if (!base) continue;
    const args = r.ref.args || {}, ops = r.ref.ops || [];
    let card = base;
    if (Object.keys(args).length || ops.length) {
      const cid = `atom:${r.atom}~${stable({ args, ops })}`;
      card = view.nmap.get(cid);
      if (!card) {
        card = { id: cid, kind: 'atom', ins: [{ name: 'from', type: 'param', label: 'from', dir: 'in' }], outs: [{ name: 'out', type: 'param', label: 'out', dir: 'out' }], raw: { atom: r.atom, args, ops }, near: base.id, label: `${base.atom.name}${argLabel(args, ops)}`, err: null, steps: null,
          atom: { id: r.atom, name: base.atom.name, type: typeOfRef(r.ref) || base.atom.type, catalog: base.atom.catalog, count: 0, refs: [], derived: true, args, ops, parent: base.id } };
        view.nodes.push(card); view.nmap.set(cid, card); P.cards.set(cid, card);
        wire(base.id, cid, 'from', 'from');
      }
    }
    const nested = /\/(args|ops)\//.test(r.path) ? refs.filter((q) => q !== r && r.path.startsWith(q.path + '/')).sort((a, b) => b.path.length - a.path.length)[0] : null;
    const site = nested ? { kind: 'nested', of: nested } : siteOf(model, r.path) || { kind: 'other' };
    card.atom.count++; card.atom.refs.push({ id: r.id, path: r.path, ref: r.ref, site });
    const badge = TYPE(card.atom.type);
    if (site.kind === 'step') { const t = view.nmap.get(site.node); if (t) { port(t, site.port, 'param'); wire(card.id, t.id, site.port, badge); } }
    else if (site.kind === 'gate') for (const w of view.wires.filter((x) => x.binding === site.binding)) { const s = view.nmap.get(w.to.node); if (s) { port(s, site.port, 'gate'); wire(card.id, s.id, site.port, badge); } }
  }
  // nested references wire into the card of the reference that holds them
  for (const c of P.cards.values()) for (const r of c.atom.refs) if (r.site.kind === 'nested') {
    const holder = [...P.cards.values()].find((k) => k.atom.refs.some((q) => q.path === r.site.of.path)); if (holder && holder !== c) { port(holder, 'arg', 'param'); wire(c.id, holder.id, 'arg', TYPE(c.atom.type)); }
  }
  for (const c of P.cards.values()) { c.sub = `${TYPE(c.atom.type)} atom · ${c.atom.count} ref${c.atom.count === 1 ? '' : 's'}`; c.extraH = cardRows(c).length * ROWH + 12; c.body = (top) => cardHtml(c, top); nextPos.set(c.id, true); }
  P.prev = new Set(P.cards.keys()); P.fresh = prevIds ? [...P.prev].filter((id) => !prevIds.has(id)) : []; P.gone = prevIds ? [...prevIds].filter((id) => !P.prev.has(id)) : [];
  return view;
}

/* ---------------------------------------------------------------- card body */
function openParams(c) { if (c.atom.catalog && !P.env) return {}; try { return A.paramsOf(P.env, c.atom.derived ? c.atom.name : c.atom.name); } catch (e) { return {}; } }
function cardRows(c) {
  const rows = [{ kind: 'pv' }];
  const ps = openParams(c);
  if (c.atom.derived) { for (const k of Object.keys(c.atom.args)) rows.push({ kind: 'arg', k, spec: ps[k] || {}, v: c.atom.args[k] }); }
  else {
    const rec = ((P.model || {}).atoms || {})[c.atom.id];
    if (rec && typeof rec.body === 'string') rows.push({ kind: 'body', v: rec.body });
    for (const [k, s] of Object.entries(ps)) if (s.default !== undefined && !isObj(s.default)) rows.push({ kind: 'def', k, spec: s, v: s.default });
  }
  return rows;
}
function inputHtml(c, row) {
  const s = row.spec || {}, num = s.shape === 'number' || typeof row.v === 'number';
  const attrs = num ? `type="number" inputmode="decimal"${s.min != null ? ` min="${s.min}"` : ''}${s.max != null ? ` max="${s.max}"` : ''}${s.step != null ? ` step="${s.step}"` : ' step="any"'}` : 'type="text" autocapitalize="off" spellcheck="false"';
  const what = row.kind === 'body' ? 'body' : row.kind === 'arg' ? `argument ${row.k}` : `default ${row.k}`;
  return `<input class="ax-in" ${attrs} data-card="${esc(c.id)}" data-field="${row.kind}"${row.k ? ` data-param="${esc(row.k)}"` : ''} value="${esc(typeof row.v === 'string' ? row.v : JSON.stringify(row.v))}" aria-label="${esc(`${c.atom.name} ${what}${s.unit ? ' (' + s.unit + ')' : ''}${s.min != null ? `, ${s.min} to ${s.max}` : ''}`)}">`;
}
function cardHtml(c, top) {
  const ref = { $atom: c.atom.id, ...(c.atom.derived ? { args: c.atom.args, ops: c.atom.ops } : {}) };
  const pv = preview(ref);
  let html = `<div class="ax-card${c.atom.derived ? ' ax-derived' : ''}" style="top:${top}px">`;
  for (const row of cardRows(c)) {
    if (row.kind === 'pv') html += `<p class="ax-pv"><span class="ax-badge">${esc(TYPE(c.atom.type))}</span><code title="${esc(pv ?? '')}">${pv == null ? '<i>unresolved</i>' : esc(short(JSON.stringify(pv)))}</code><span class="ax-n" aria-label="${c.atom.count} references">×${c.atom.count}</span></p>`;
    else html += `<label class="ax-row"><span>${row.kind === 'body' ? 'body' : esc(row.k)}${row.kind === 'def' ? '<em>def</em>' : ''}</span>${inputHtml(c, row)}</label>`;
  }
  return html + '</div>';
}
// appear / disappear: newly materialised cards fade in; removed ones leave a fading ghost. Reduced motion: neither (CSS + check here)
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function after(nodesEl) {
  for (const id of P.fresh || []) { const el = nodesEl.querySelector(`.gn[data-id="${CSS.escape(id)}"]`); if (el) el.classList.add('ax-new'); }
  for (const el of nodesEl.querySelectorAll('.gk-atom')) { const c = P.cards.get(el.dataset.id); if (c) { el.classList.toggle('ax-d', c.atom.derived); P.pos.set(c.id, { x: el.style.left, y: el.style.top, h: el.style.height, label: c.label }); } }
  if (!still()) for (const id of P.gone || []) { const p = P.pos.get(id); if (!p) continue; const g = document.createElement('div'); g.className = 'gn gk-atom ax-ghost'; g.setAttribute('aria-hidden', 'true'); g.style.cssText = `left:${p.x};top:${p.y};height:${p.h}`; g.textContent = p.label; nodesEl.append(g); const rm = () => g.remove(); g.addEventListener('animationend', rm); setTimeout(rm, 600); }
  P.fresh = []; P.gone = [];
}

/* ---------------------------------------------------------------- declaration splices (no model op for atom bodies yet) */
function declNode(text, name) {
  let ast; try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); } catch (e) { return null; }
  for (const st of ast.body) { const e = st.type === 'ExpressionStatement' ? st.expression : null; if (e && e.type === 'CallExpression' && e.callee.type === 'Identifier' && e.callee.name === 'atom' && e.arguments[0] && e.arguments[0].value === name && e.arguments[1] && e.arguments[1].type === 'ObjectExpression') return e.arguments[1]; }
  return null;
}
const prop = (obj, key) => obj && obj.type === 'ObjectExpression' && obj.properties.find((p) => p.type === 'Property' && !p.computed && (p.key.name === key || p.key.value === key));
function spliceDecl(name, path, value) {
  const text = X.text(); let node = declNode(text, name);
  for (const k of path) { const p = prop(node, k); if (!p) return null; node = p.value; }
  if (!node || node.type !== 'Literal') return null;
  const raw = text.slice(node.start, node.end), lit = typeof value === 'number' ? String(value) : raw[0] === "'" ? `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : JSON.stringify(String(value));
  return text.slice(0, node.start) + lit + text.slice(node.end);
}
function check(id, rec) { // validate an edited record with the type's validator before anything is written
  const env = A.buildEnv('', { atoms: { ...closure(X.model().atoms || {}, [id]), [id]: rec } }); return A.resolve(env, { $atom: rec.name });
}
function numOr(s, spec) { const t = String(s).trim(); if ((spec && spec.shape === 'number') || /^-?\d+(\.\d+)?$/.test(t)) { const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; } return t; }
function editCard(inp) {
  const c = P.cards.get(inp.dataset.card); if (!c) return;
  const f = inp.dataset.field, k = inp.dataset.param, ps = openParams(c);
  if (f === 'arg') { // derived card: rewrite that argument at every reference the card stands for (one literal op each, one commit)
    const v = numOr(inp.value, ps[k]); if (v == null) return X.refuse(`${k} needs a number`);
    const args = { ...c.atom.args, [k]: v }; const ops = [];
    for (const r of c.atom.refs) if (r.site.kind === 'step') ops.push({ op: 'literal', track: r.site.track, step: r.site.step, arg: r.site.arg, value: { ...r.ref, args } }); else if (r.site.kind === 'gate') ops.push({ op: 'setGate', binding: r.site.binding, gate: { ...r.ref, args } });
    try { A.resolve(P.env, { $atom: c.atom.name, args, ops: c.atom.ops }); } catch (e) { return X.refuse(`${c.atom.name}${argLabel(args)}: ${e.message}`); }
    return X.doOps(ops, `atoms.${c.atom.name}: ${k} = ${JSON.stringify(v)}`);
  }
  const rec = (X.model().atoms || {})[c.atom.id]; if (!rec) return X.refuse(`${c.atom.name} is a catalog atom: it has no declaration to edit`);
  if (X.readonly()) return X.refuse('Read-only here');
  let next, rec2;
  if (f === 'body') { rec2 = { ...rec, body: inp.value }; next = spliceDecl(rec.name, ['body'], inp.value); }
  else { const v = numOr(inp.value, rec.params[k]); if (v == null) return X.refuse(`${k} needs a number`); rec2 = { ...rec, params: { ...rec.params, [k]: { ...rec.params[k], default: v } } }; next = spliceDecl(rec.name, ['params', k, 'default'], v); }
  try { check(c.atom.id, rec2); } catch (e) { inp.setAttribute('aria-invalid', 'true'); return X.refuse(`${rec.name}: ${e.message}`); }
  if (next == null) return X.refuse(`The declaration of ${rec.name} is not a plain literal there: edit it in Code`);
  return X.commit(next, `atoms.${rec.name} ${f === 'body' ? 'body' : k} = ${inp.value}`);
}

/* ---------------------------------------------------------------- inspector (card) */
export function inspect(n) {
  const c = P.cards.get(n.id); if (!c) return [];
  const h = X.h, pv = preview({ $atom: c.atom.id, ...(c.atom.derived ? { args: c.atom.args, ops: c.atom.ops } : {}) });
  const rec = (X.model().atoms || {})[c.atom.id];
  const kids = [h('p', { class: 'ax-pv ax-pv-l' }, h('span', { class: 'ax-badge' }, TYPE(c.atom.type)), h('code', {}, pv == null ? 'unresolved' : JSON.stringify(pv)))];
  if (rec && rec.doc) kids.push(h('p', { class: 'gx-hint' }, rec.doc));
  if (c.atom.derived) kids.push(h('p', { class: 'gx-hint' }, `Derived from ${c.atom.name}: its own card, linked to the ${c.atom.name} card. Arguments are edited on the card.`), h('button', { type: 'button', class: 'ghost', 'data-act': 'ax-goto', 'data-card': c.atom.parent }, `Go to ${c.atom.name}`));
  else if (!rec) kids.push(h('p', { class: 'gx-hint' }, 'Catalog atom: synthesised on reference, never stored.'));
  kids.push(h('h4', { class: 'ax-h' }, `References (${c.atom.count})`), h('ul', { class: 'gx-choices ax-refs' }, ...c.atom.refs.map((r, i) => h('li', {},
    h('span', { class: 'ax-where' }, r.site.kind === 'step' ? `${r.site.track}.${r.site.port}` : r.site.kind === 'gate' ? `binding ${r.site.binding} gate` : r.path),
    r.site.kind === 'step' || r.site.kind === 'gate' ? h('button', { type: 'button', class: 'ghost', 'data-act': 'ax-detach', 'data-card': c.id, 'data-i': String(i), disabled: X.readonly(), 'aria-label': `Detach this reference: inline ${pv == null ? 'its string' : JSON.stringify(pv)}` }, 'Detach') : null))));
  return kids;
}
function detach(c, i) {
  const r = c.atom.refs[i]; const pv = preview(r.ref); if (pv == null) return X.refuse('This reference does not resolve: nothing to inline');
  const op = r.site.kind === 'step' ? { op: 'literal', track: r.site.track, step: r.site.step, arg: r.site.arg, value: pv } : { op: 'setGate', binding: r.site.binding, gate: pv };
  if (X.doOps([op], `Detached atoms.${c.atom.name}: inlined ${JSON.stringify(pv)}`)) X.closeSheet();
}

/* ---------------------------------------------------------------- browser / palette (on demand, never the whole library) */
// what a port accepts and the op that makes the reference there; null when the port takes no atom
function target(p) {
  if (!p || p.dir !== 'in') return null;
  const n = X.view().nmap.get(p.node); if (!n) return null;
  if (n.kind === 'track' && p.type === 'param') {
    const t = (X.model().tracks || []).find((x) => x.name === n.label); if (!t) return null;
    const ci = (t.chain || []).findIndex((s) => s[0] === p.port), src = t.source && t.source[0] === p.port && ci < 0;
    if (ci < 0 && !src) return null;
    const types = C.typesAt(src ? p.port : '.' + p.port, 0);
    return { label: `${n.label}.${p.port}`, types, op: (ref) => ({ op: 'literal', track: n.label, step: src ? 'source' : ci, arg: 0, value: ref }) };
  }
  if (n.kind === 'slot' && p.port.startsWith('gate:')) { const bid = p.port.slice(5); return { label: `${n.label} gate (${bid})`, types: C.typesAt('hooks.bind', 2), op: (ref) => ({ op: 'setGate', binding: bid, gate: ref }) }; }
  return null;
}
export const accepts = (p) => !!target(p);
function catalogKeys(ns) {
  const c = (A.config().catalog || {})[ns];
  if (c) return c instanceof Set ? [...c] : Array.isArray(c) ? c : isObj(c) ? Object.keys(c) : [];
  if (ns === 'snd' && typeof window.soundMap?.get === 'function') return Object.keys(window.soundMap.get() || {});
  return B.fallback[ns] || [];
}
const B = { fallback: {} };
async function loadFallback() { // the site's own sound / bank / scale names (intellisense data) when no catalog is configured
  if (B.loaded) return; B.loaded = true;
  try { const items = sc.intellisense ? await sc.intellisense.all({}) : []; const pick = (re) => [...new Set(items.filter((i) => i.string && re.test(i.category || '')).map((i) => i.label))];
    B.fallback.snd = pick(/sounds/); B.fallback.bank = pick(/banks/); } catch (e) { /* offline */ }
  try { const P2 = sc.intellisense && sc.intellisense.params ? await sc.intellisense.params() : {}; const sc0 = (P2.scale || P2['.scale'] || [])[0]; if (sc0 && sc0.options) B.fallback.scale = [...new Set(sc0.options.map((o) => String(o).split(':').slice(1).join(':')).filter(Boolean))]; } catch (e) { /* none */ }
  B.fallback.chord = B.fallback.chord || ['M', 'm', '7', 'm7', 'M7', 'dim', 'aug', 'sus2', 'sus4', 'm9', '9', '6', 'm6', 'add9'];
}
// one page of rows: [{ key, name, type, ref, pv }], plus whether more exist. Document atoms are scanned lazily; catalogs by prefix.
export function query({ ns = 'doc', text = '', types = null, page = 0 } = {}) {
  const want = types && types.length ? types : null, q = text.trim().toLowerCase(), lo = page * PAGE, hi = lo + PAGE; const rows = []; let seen = 0, more = false;
  if (ns === 'doc') {
    const atoms = X.model().atoms || {};
    for (const [id, a] of Object.entries(atoms)) {
      if (want && !want.includes(a.type) && a.type !== 'text') continue;
      if (q && !a.name.toLowerCase().includes(q) && !(a.doc || '').toLowerCase().includes(q)) continue;
      if (seen >= hi) { more = true; break; }
      if (seen++ >= lo) rows.push({ key: id, name: a.name, type: a.type, ref: { $atom: id }, doc: a.doc || '' });
    }
    if (rows.length) { const env = A.buildEnv('', { atoms: closure(atoms, rows.map((r) => r.key)) }); for (const r of rows) { try { const v = A.resolve(env, { $atom: r.name }); r.pv = v.text ?? JSON.stringify(v.obj); } catch (e) { r.pv = null; } } }
  } else {
    const type = CATS[ns]; if (want && !want.includes(type)) return { rows, more: false, blocked: type };
    for (const k of catalogKeys(ns)) {
      if (q && !String(k).toLowerCase().startsWith(q)) continue;
      if (seen >= hi) { more = true; break; }
      if (seen++ >= lo) rows.push({ key: `${ns}.${k}`, name: `${ns}.${k}`, type, ref: { $atom: `${ns}.${k}` }, pv: String(k) });
    }
  }
  return { rows, more };
}
export async function browse(p) {
  await loadFallback();
  const h = X.h, tg = target(p); X.disarm(); // the port is held by the browser now
  const allTypes = A.types().map((t) => t.id).filter((t) => t !== 'text');
  const S = { ns: 'doc', page: 0, types: tg && tg.types ? [...tg.types] : null, locked: !!(tg && tg.types) };
  const q = h('input', { type: 'search', class: 'gx-q ax-q', placeholder: 'Filter atoms by name', 'aria-label': 'Filter atoms', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-controls': 'axList' });
  const nsBar = h('div', { class: 'ax-ns', role: 'radiogroup', 'aria-label': 'Namespace' }, ...[['doc', 'Document'], ['snd', 'atoms.snd'], ['bank', 'atoms.bank'], ['scale', 'atoms.scale'], ['chord', 'atoms.chord']].map(([k, l]) => h('button', { type: 'button', role: 'radio', class: 'ghost ax-nsb', 'data-act': 'ax-ns', 'data-ns': k, 'aria-checked': String(k === 'doc') }, l)));
  const chips = h('div', { class: 'ax-types', role: 'group', 'aria-label': S.locked ? `Types this port accepts` : 'Filter by type' });
  const list = h('ul', { class: 'ax-list', id: 'axList', 'aria-label': 'Atoms' });
  const more = h('button', { type: 'button', class: 'ghost ax-more', 'data-act': 'ax-more', hidden: true }, 'More');
  const status = h('p', { class: 'gx-hint ax-st', role: 'status', 'aria-live': 'polite' });
  const drawChips = () => chips.replaceChildren(...(S.locked ? S.types : allTypes).map((t) => h('button', { type: 'button', class: 'ghost ax-chip', 'data-act': 'ax-type', 'data-type': t, 'aria-pressed': String(!!S.types && S.types.includes(t)), disabled: S.locked }, TYPE(t))));
  const row = (r) => h('li', {}, h('button', { type: 'button', class: 'ghost ax-rowb', 'data-act': 'ax-pick', 'data-key': r.key, 'data-name': r.name, 'aria-label': `atoms.${r.name}, ${r.type} atom${r.pv != null ? ', compiles to ' + r.pv : ''}` },
    h('span', { class: 'ax-badge' }, TYPE(r.type)), h('b', {}, r.name), h('code', {}, r.pv == null ? '' : short(JSON.stringify(r.pv), 22))));
  const load = (reset) => {
    if (reset) { S.page = 0; list.replaceChildren(); }
    const res = query({ ns: S.ns, text: q.value, types: S.types, page: S.page });
    list.append(...res.rows.map(row)); more.hidden = !res.more; S.more = res.more;
    const n = list.children.length;
    status.textContent = res.blocked ? `${TYPE(res.blocked)} atoms do not fit ${tg ? tg.label : 'this port'}.` : n ? `${n} atom${n === 1 ? '' : 's'}${res.more ? `, ${PAGE} per page: More loads the next page` : ''}` : (S.ns === 'doc' ? 'No atoms match. Declare one with atom("name", { type, body }) in Code.' : 'No catalog entries match this prefix.');
  };
  S.load = load; S.p = p; S.tg = tg; S.q = q; S.list = list; S.more_el = more; S.chips = chips; S.drawChips = drawChips; B.S = S;
  q.addEventListener('input', () => load(true));
  q.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { const f = list.querySelector('button'); if (f) { e.preventDefault(); f.focus(); } } if (e.key === 'Enter') { e.preventDefault(); const f = list.querySelector('button'); if (f) f.click(); } });
  list.addEventListener('keydown', (e) => { const bs = [...list.querySelectorAll('button')], i = bs.indexOf(document.activeElement); if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); (bs[i + 1] || (S.more ? (load(), [...list.querySelectorAll('button')][i + 1]) : null) || bs[i]).focus(); } if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); (bs[i - 1] || q).focus(); } });
  drawChips(); load(true);
  const hint = tg ? `Choose an atom for ${tg.label}${tg.types ? `: ${tg.types.map(TYPE).join(' / ')} only` : ''}. The card appears once the reference exists.` : 'Browsing: arm a param or gate port first (tap it, or Connect to… in Outline) to place a reference.';
  X.openSheet(tg ? `Atom for ${tg.label}` : 'Atoms', h('div', { class: 'ax-br' }, h('p', { class: 'gx-hint' }, hint), chips, nsBar, q, status, list, more), { label: 'Atom browser' });
  // scrolling to the end of the list fetches the next page (one page per scroll step)
  const sheet = list.closest('.gx-sheet');
  if (sheet) { const onScroll = () => { if (B.S !== S || !sheet.isConnected) return sheet.removeEventListener('scroll', onScroll); if (S.more && !S.busy && sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 80) { S.busy = true; S.page++; load(false); requestAnimationFrame(() => { S.busy = false; }); } }; sheet.addEventListener('scroll', onScroll, { passive: true }); }
  q.focus();
  return S;
}
function pick(key, name) {
  const S = B.S; if (!S || !S.tg) return X.refuse('Arm a param or gate port first (tap it, or use Connect to… in Outline), then choose an atom.');
  const ref = { $atom: key };
  const ok = X.doOps([S.tg.op(ref)], `${S.tg.label} = atoms.${name}`);
  if (ok) { X.closeSheet(); X.say(`${S.tg.label} now references atoms.${name}`); const back = X.focusPort(S.p); if (!back) X.root().focus(); }
}

/* ---------------------------------------------------------------- wiring into graph.js */
export function goto(atomId) {
  const id = `atom:${atomId}`; const v = X.view(); if (!v || !v.nmap.has(id)) return false;
  X.select(id); X.center(id); return true;
}
export function connectItems(n) { // non-pointer path: "Connect to…" lists an "Atom for <port>…" entry per port that takes atoms
  const h = X.h, out = [];
  for (const p of n.ins) { const a = { node: n.id, port: p.name, dir: 'in', type: p.type }; const tg = target(a); if (tg) out.push(h('li', {}, h('button', { type: 'button', class: 'ghost', 'data-act': 'ax-for', 'data-node': n.id, 'data-port': p.name, 'data-type': p.type }, h('b', {}, `Atom for ${p.label}…`), h('span', {}, ' ' + (tg.types ? tg.types.join(' / ') : 'any type'))))); }
  return out;
}
export function install(ctx) {
  X = ctx; const root = ctx.root();
  const tools = root.querySelector('.gx-tools');
  if (tools && !tools.querySelector('#gxAtoms')) { const b = ctx.h('button', { type: 'button', class: 'ghost gx-tool', id: 'gxAtoms', 'aria-label': 'Atom browser: choose an atom for the armed port', title: 'Atom browser', 'data-act': 'ax-open' }, 'Atoms'); tools.insertBefore(b, tools.children[1] || null); }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act^="ax-"]'); if (!b || !root.contains(b)) return;
    const act = b.dataset.act, S = B.S;
    if (act === 'ax-open') return browse(ctx.armed());
    if (act === 'ax-for') return browse({ node: b.dataset.node, port: b.dataset.port, dir: 'in', type: b.dataset.type });
    if (act === 'ax-pick') return pick(b.dataset.key, b.dataset.name);
    if (act === 'ax-more' && S) { const n = S.list.children.length; S.page++; S.load(false); const f = S.list.children[n] && S.list.children[n].querySelector('button'); if (f) f.focus({ preventScroll: true }); return; }
    if (act === 'ax-ns' && S) { S.ns = b.dataset.ns; b.parentElement.querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); S.q.placeholder = S.ns === 'doc' ? 'Filter atoms by name' : `Prefix in atoms.${S.ns}`; return S.load(true); }
    if (act === 'ax-type' && S && !S.locked) { const t = b.dataset.type; S.types = S.types && S.types.includes(t) ? S.types.filter((x) => x !== t) : [...(S.types || []), t]; if (!S.types.length) S.types = null; S.drawChips(); return S.load(true); }
    if (act === 'ax-detach') { const c = P.cards.get(b.dataset.card); if (c) detach(c, +b.dataset.i); return; }
    if (act === 'ax-goto') { ctx.select(b.dataset.card); ctx.center(b.dataset.card); return; }
  });
  root.addEventListener('change', (e) => { if (e.target.matches('.ax-in')) editCard(e.target); });
  sc.atomsUI = { browse, query, goto, accepts, cards: () => [...P.cards.values()].map((c) => ({ id: c.id, name: c.atom.name, type: c.atom.type, count: c.atom.count, derived: c.atom.derived, parent: c.atom.parent || null, x: c.x, y: c.y })), refLabel };
  return sc.atomsUI;
}
