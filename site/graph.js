/* Graph view (#52, BLUEPRINT 4 + 11): a blueprint node editor over the shared model (model.js) and component library (library.js).
   The graph never writes code or model fields: every edit is one model.js applyOp (or the library's extract/replaceWithInstance for
   Collapse), then generate() gives the new program text. Code and graph share one text and one undo stack.
   Rendering: one transformed "world" layer holding an SVG for wires and HTML for nodes, ports and badges. Pan/zoom only touch the
   world's CSS transform (compositor work), so 150 nodes / 300 wires stay at frame rate; nodes are real buttons, so the keyboard,
   screen readers and 44 px targets come for free. Loaded on first open of the Graph view, never with the shell. */
import * as acorn from './vendor/acorn-8.19.0.mjs';
import { parse, generate, applyOp, graph, layout } from './model.js';
import { lib, extract, replaceWithInstance, expand } from './library.js';

const sc = (window.strudelCraft = window.strudelCraft || {});
const ui = () => sc.ui;
const KEY = 'sc.graph', POSKEY = 'sc.graph.pos';
const COLW = 330, W = 220, HEAD = 52, ROW = 52, STEP = 30, GAP = 28, PILL = 52, CODEH = 64;
const FAR = 0.85, NEAR = 1.5, GLYPH = 0.4, ZMIN = 0.25, ZMAX = 2; // ZMIN is a floor only for small graphs: zmin() always lets the whole graph fit
const REG = new Set(['marker', 'hook', 'module', 'decorator', 'var', 'control']); // definitions sit in the first column
const NONPARAM = new Set(['tap', 'use', 'wrap', 'wire', 'ns']);
const FACETS = ['onset', 'gate', 'env'];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const DEMO = `setcpm(30)
hooks.marker("drop", "17b")
hooks.def("murk", { chain: [["lpf", 400]] })
hooks.def("open", { chain: [["hpf", 300]] })
hooks.let("root", 48)
kick: s("bd*4").gain(0.8).tap("kick")
bass: note("c2 eb2").s("sawtooth").lpf(800).gain(0.7).use("fx")
hat: s("hh*8").gain(0.5).tap("hat")
perc: s("rim*2").gain(0.4)
$: (() => { const p = s("cp*2"); return p.gain(tap("kick:env")) })()
`;

/* ---------------------------------------------------------------- helpers */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter((x) => x != null)); return e; };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } } };
const argText = (a) => { if (a === undefined) return ''; if (isObj(a)) { if ('$mini' in a) return JSON.stringify(a.$mini); if ('$tap' in a) return `tap("${a.$tap}")${a.range ? `.range(${a.range.join(', ')})` : ''}`; if ('$code' in a) return a.$code.length > 24 ? a.$code.slice(0, 22) + '…' : a.$code; } return typeof a === 'string' ? `'${a}'` : JSON.stringify(a); };
const stepText = (s) => `${s[0]}(${s.slice(1).map(argText).join(', ')})`;

/* gate text <-> window (HOOKS_SYNTAX 4: "@17b" from, "<17b" until, "9b..17b" window; until is exclusive) */
function gateParts(g) {
  if (g == null || g === '*') return { from: '', until: '' };
  if (typeof g === 'string') { const m = /^(.*?)\.\.(.*)$/.exec(g); if (m) return { from: m[1], until: m[2] }; if (g[0] === '@') return { from: g.slice(1), until: '' }; if (g[0] === '<') return { from: '', until: g.slice(1) }; return { from: g, until: '', raw: g }; }
  if (isObj(g)) return { from: g.from != null ? String(g.from) : '', until: g.until != null ? String(g.until) : '', obj: true };
  return { from: '', until: '' };
}
const gateString = (from, until) => (from && until ? `${from}..${until}` : from ? `@${from}` : until ? `<${until}` : undefined);
const gateBadge = (g) => { const p = gateParts(g); if (p.raw) return p.raw; return p.from && p.until ? `${p.from}..${p.until}` : p.from ? `${p.from} ->` : p.until ? `<- ${p.until}` : ''; };
function barOf(p, markers, depth = 0) {
  if (p === '' || p == null) return null;
  if (typeof p === 'number') return p + 1;
  const s = String(p).trim(); let m;
  if ((m = /^(\d+(?:\.\d+)?)b$/.exec(s))) return +m[1];
  if ((m = /^(\d+(?:\.\d+)?)c?$/.exec(s))) return +m[1] + 1;
  if ((m = /^([A-Za-z][\w-]*?)(?:([+-])(\d+(?:\.\d+)?)b?)?$/.exec(s)) && markers && m[1] in markers && depth < 4) { const b = barOf(markers[m[1]], markers, depth + 1); return b == null ? null : b + (m[2] ? (m[2] === '-' ? -1 : 1) * +m[3] : 0); }
  return null;
}

/* ---------------------------------------------------------------- state */
const G = {
  text: store.get(KEY, null) ?? DEMO, model: null, parseErr: null, spans: [], view: null,
  past: [], future: [], sel: new Set(), wire: null, armed: null, multi: false, level: 'mid', path: [], pane: 'graph', live: false,
  pos: store.get(POSKEY, {}), fixture: null,
};
const V = { x: 24, y: 24, s: 1 };

/* ---------------------------------------------------------------- code -> model -> view */
function scanSpans(text, model) {
  // top-level statement ranges -> graph node ids, for code <-> graph selection sync (statement order mirrors model.parse)
  let ast; try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); } catch (e) { return { spans: [], err: e }; }
  const out = []; let structural = false, ti = 0, bi = 0;
  const tracks = model.tracks || [];
  const str = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null);
  for (const st of ast.body) {
    const e = st.type === 'ExpressionStatement' ? st.expression : st.type === 'LabeledStatement' && st.body.type === 'ExpressionStatement' ? st.body.expression : null;
    const hk = e && e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && e.callee.object.name === 'hooks' ? e.callee.property.name : null;
    let id = null;
    if (hk && st.type === 'ExpressionStatement') {
      structural = true; const a0 = str(e.arguments[0]);
      if (hk === 'marker') id = `marker:${a0}`; else if (hk === 'def') id = `def:${a0}`; else if (hk === 'let') id = `var:${a0}`;
      else if (hk === 'bind') { bi++; const o = e.arguments.find((x) => x.type === 'ObjectExpression'); const p = o && o.properties.find((q) => q.key && (q.key.name === 'id' || q.key.value === 'id')); id = `bind:${(p && str(p.value)) || 'b' + bi}`; }
    } else if (hk === 'inst') { structural = true; const o = e.arguments[1]; const p = o && o.properties && o.properties.find((q) => q.key && q.key.name === 'as'); id = `inst:${p && str(p.value)}`; }
    else if (st.type === 'LabeledStatement' || structural) { structural = true; const t = tracks[ti++]; if (t) id = (t.chain == null && t.source == null ? 'code:' : 'track:') + t.name; }
    if (id) out.push({ id, start: st.start, end: st.end });
  }
  return { spans: out, err: null };
}
function setText(text, { save = true } = {}) {
  G.text = text; if (save) store.set(KEY, text);
  let m; try { m = parse(text); } catch (e) { m = null; }
  const sp = m ? scanSpans(text, m) : { spans: [], err: new Error('model parse failed') };
  if (sp.err) G.parseErr = sp.err.message; else { G.parseErr = null; G.model = m; G.spans = sp.spans; }
  if (!G.model) G.model = parse(DEMO);
  if (codeTa && codeTa.value !== text) codeTa.value = text;
  render();
}
function commit(text, label) {
  if (text === G.text) { say('No change'); return false; }
  G.past.push(G.text); if (G.past.length > 200) G.past.shift(); G.future = []; setText(text); say(label); return true;
}
function undo() { if (!G.past.length) return say('Nothing to undo'); G.future.push(G.text); setText(G.past.pop()); say('Undo'); }
function redo() { if (!G.future.length) return say('Nothing to redo'); G.past.push(G.text); setText(G.future.pop()); say('Redo'); }
const cur = () => (G.path.length ? G.path[G.path.length - 1] : null);
const readonly = () => !!(cur() || G.fixture);
function doOps(ops, label) {
  if (readonly()) { refuse(G.fixture ? 'Fixture view is read-only.' : `Inside ${cur().label} the graph is read-only: component revisions are immutable.`); return false; }
  let m = G.model;
  try { for (const op of ops) m = applyOp(m, op); } catch (e) { refuse(`${label} was not applied (${e.message})`); return false; }
  return commit(generate(m), label);
}

function portType(name, kind, dir) {
  if (kind === 'tap' && dir === 'out') return name === 'ev' || name === 'onset' ? 'pattern' : 'signal';
  if (name.startsWith('gate')) return 'gate';
  return null;
}
function buildView(model) {
  const g = graph(model), byId = new Map(g.nodes.map((n) => [n.id, n]));
  const top = (id) => { const n = byId.get(id); return n && n.parent ? n.parent : id; };
  const tracks = new Map((model.tracks || []).map((t) => [t.name, t]));
  const nodes = [], nmap = new Map();
  const port = (n, dir, name, type, label) => { const arr = dir === 'in' ? n.ins : n.outs; let p = arr.find((x) => x.name === name); if (!p) { p = { name, type, label: label || name, dir }; arr.push(p); } return p; };
  for (const n of g.nodes) {
    if (n.parent) continue;
    const v = { id: n.id, kind: n.kind, ins: [], outs: [], raw: n, label: n.name || n.id.replace(/^\w+:/, ''), err: null, steps: null };
    switch (n.kind) {
      case 'track': {
        const t = tracks.get(n.name); v.steps = [t.source, ...(t.chain || [])].filter(Boolean);
        v.steps.forEach((s, i) => { if (i > 0 && !NONPARAM.has(s[0]) && s.length > 1) port(v, 'in', s[0], 'param'); });
        port(v, 'out', 'out', 'pattern'); v.sub = (t.muted ? 'muted ' : '') + 'track' + (t.ns ? ' · ns ' + t.ns : ''); break;
      }
      case 'slot': port(v, 'in', 'hook', 'hook'); v.label = `${n.scope} / ${n.name}`; v.sub = 'slot'; break;
      case 'hook': case 'module': case 'decorator':
        (n.params || []).forEach((p) => port(v, 'in', p, 'param')); port(v, 'out', 'out', 'hook', 'hook'); (n.taps || []).forEach((t) => port(v, 'out', t, 'signal'));
        v.sub = n.kind; if (n.unresolved) v.err = `E_UNKNOWN_HOOK: no hooks.def("${v.label}") in this program`; break;
      case 'tap': port(v, 'in', 'in', 'pattern'); port(v, 'out', 'ev', 'pattern'); (n.facets || []).forEach((f) => port(v, 'out', f, portType(f, 'tap', 'out'))); v.sub = 'tap' + (n.ns ? ' · ' + n.ns : ''); break;
      case 'var': port(v, 'out', 'out', 'param', 'value'); v.sub = 'var'; break;
      case 'control': port(v, 'out', 'out', 'param', 'value'); v.sub = 'control · ' + n.type; break;
      case 'marker': port(v, 'out', 'point', 'gate', 'point'); v.sub = 'marker · ' + n.point; break;
      case 'component': {
        Object.keys(n.args || {}).forEach((a) => port(v, 'in', a, 'param')); port(v, 'in', 'gate', 'gate');
        const [nm, rv] = n.component.split('@'); let rec = null; try { rec = lib.get(nm, +rv); } catch (e) { rec = null; }
        ((rec && rec.exports && rec.exports.taps) || []).forEach((t) => port(v, 'out', t, 'signal'));
        v.sub = 'component · ' + n.component; v.component = n.component; if (!rec) v.err = `E_COMPONENT_MISSING: ${n.component} is not in this browser's library`; break;
      }
      case 'code': n.ports.in.forEach((r) => port(v, 'in', r, 'signal')); port(v, 'out', 'out', 'pattern'); v.sub = 'code · opaque'; v.src = (tracks.get(n.name) || {}).src || ''; break;
      default: v.sub = n.kind;
    }
    nodes.push(v); nmap.set(v.id, v);
  }
  const wires = [], seen = new Set();
  for (const w of g.wires) {
    const a = top(w.from.node), b = top(w.to.node);
    if (a === b || !nmap.has(a) || !nmap.has(b)) continue;
    const fn = nmap.get(a), tn = nmap.get(b);
    const fp = byId.get(w.from.node).parent ? 'out' : w.from.port, tp = w.to.port || 'in';
    const id = w.id.startsWith('bind:') ? w.id : `${w.type}:${a}.${fp}>${b}.${tp}`;
    if (seen.has(id)) continue; seen.add(id);
    port(fn, 'out', fp, w.type); port(tn, 'in', tp, portType(tp, tn.kind, 'in') || w.type);
    const x = { id, type: w.type, from: { node: a, port: fp }, to: { node: b, port: tp } };
    if (id.startsWith('bind:')) { const bid = id.split(':')[1]; const bi = (model.bindings || []).findIndex((bb, i) => (bb.id || `b${i + 1}`) === bid); x.binding = bid; x.b = (model.bindings || [])[bi]; x.window = gateBadge(x.b && x.b.gate); }
    wires.push(x);
  }
  return { nodes, wires, nmap };
}
function place(view, model) {
  // rank and order from model.layout(); pixel rows stack the real node heights per column (layout's 96 px rows assume pills)
  let L = {}; try { L = model ? layout(model) : {}; } catch (e) { L = {}; }
  const cols = new Map();
  view.nodes.forEach((n, i) => { const l = L[n.id] || { x: 0, y: i * 96 }; n.h = nodeH(n); const r = Math.round(l.x / 240), c = REG.has(n.kind) && r === 0 ? 0 : r + 1; if (!cols.has(c)) cols.set(c, []); cols.get(c).push({ n, y: l.y }); });
  [...cols.keys()].sort((a, b) => a - b).forEach((c, ci) => { const list = cols.get(c); list.sort((a, b) => a.y - b.y); let y = 0; for (const { n } of list) { n.x = ci * COLW; n.y = y; y += n.h + GAP; } });
  const saved = G.pos[scopeKey()] || {};
  view.nodes.forEach((n) => { if (saved[n.id]) { n.x = saved[n.id].x; n.y = saved[n.id].y; } });
}
const scopeKey = () => (cur() ? cur().ref : 'song');
function nodeH(n) { return HEAD + Math.max(1, n.ins.length, n.outs.length) * ROW + (n.steps ? n.steps.length * STEP + 8 : 0) + (n.kind === 'code' ? CODEH : 0); }
function anchor(n, dir, name) {
  if (G.level === 'far') return { x: dir === 'in' ? n.x : n.x + W, y: n.y + PILL / 2 };
  const list = dir === 'in' ? n.ins : n.outs, i = Math.max(0, list.findIndex((p) => p.name === name));
  return { x: dir === 'in' ? n.x : n.x + W, y: n.y + HEAD + i * ROW + ROW / 2 };
}

/* ---------------------------------------------------------------- connection rules (BLUEPRINT 4.2) */
const slotRef = (n) => (!n.raw ? n.label : n.raw.scope && n.raw.scope !== '*' ? `${n.raw.scope}/${n.raw.name}` : n.raw.name);
function rule(a, b) {
  // a, b: {node, port, dir, type}. Returns { ok, reason } or { ok, does, out, inn }
  if (!a || !b) return { ok: false, reason: 'Pick two ports.' };
  if (a.node === b.node) return { ok: false, reason: 'A node cannot be wired to itself.' };
  if (a.dir === b.dir) return { ok: false, reason: `Both ports are ${a.dir === 'in' ? 'inputs' : 'outputs'}: connect an output to an input.` };
  if (G.fixture) return { ok: a.type === b.type, reason: 'Types differ.', does: 'fixture' };
  const out = a.dir === 'out' ? a : b, inn = a.dir === 'out' ? b : a;
  const on = G.view.nmap.get(out.node), tn = G.view.nmap.get(inn.node);
  if (!on || !tn) return { ok: false, reason: 'Unknown node.' };
  if (tn.kind === 'code') return { ok: false, reason: 'Opaque code node: its inputs come from its text; edit the code instead.' };
  if (tn.kind === 'component') return { ok: false, reason: `Component ${tn.label}: args and gate are set on its hooks.inst line, not by wires.` };
  if (out.type === 'hook' || inn.type === 'hook') {
    if (out.type === 'hook' && inn.type === 'hook' && tn.kind === 'slot') {
      const hook = on.label; const dup = (G.model.bindings || []).some((x) => x.hook === hook && x.slot === slotRef(tn));
      return dup ? { ok: false, reason: `${hook} is already bound to ${slotRef(tn)}.` } : { ok: true, does: 'bind', out, inn };
    }
    return { ok: false, reason: 'A hook output connects only to a slot’s hook input (that makes a hooks.bind binding).' };
  }
  if (inn.type === 'gate' || out.type === 'gate') return { ok: false, reason: 'Gates are windows on a binding: select the binding wire and set From / Until in the inspector.' };
  if (inn.type === 'param' && tn.kind === 'track') {
    if (on.kind === 'tap') return { ok: true, does: 'wire', out, inn };
    if (on.kind === 'var') return { ok: true, does: 'var', out, inn };
    return { ok: false, reason: `A ${out.type} output of a ${on.kind} cannot drive a param port; params take a tap (with a facet and range) or a var.` };
  }
  if (inn.type === 'pattern' && tn.kind === 'tap' && on.kind === 'track') {
    const pub = G.view.wires.find((w) => w.to.node === tn.id && w.to.port === 'in');
    return pub ? { ok: false, reason: `Tap ${tn.label} is already published by ${G.view.nmap.get(pub.from.node).label}.` } : { ok: true, does: 'publish', out, inn };
  }
  if (out.type === 'pattern' && inn.type === 'pattern') return { ok: false, reason: 'Pattern chaining is edited as steps inside a track (insert / move / remove step).' };
  return { ok: false, reason: `A ${out.type} output does not connect to a ${inn.type} input.` };
}
async function connect(a, b) {
  const r = rule(a, b);
  if (!r.ok) { refuse(r.reason); return false; }
  if (G.fixture) { refuse('Fixture view is read-only.'); return false; }
  const on = G.view.nmap.get(r.out.node), tn = G.view.nmap.get(r.inn.node);
  if (r.does === 'bind') return doOps([{ op: 'bind', slot: slotRef(tn), hook: on.label }], `Bound ${on.label} to ${slotRef(tn)}`);
  if (r.does === 'publish') { const t = G.model.tracks.find((x) => x.name === on.label); return doOps([{ op: 'insertStep', track: on.label, index: (t.chain || []).length, step: ['tap', tn.label] }], `${on.label} publishes tap ${tn.label}`); }
  if (r.does === 'var') {
    const t = G.model.tracks.find((x) => x.name === tn.label); const si = (t.chain || []).findIndex((s) => s[0] === r.inn.port);
    return doOps([{ op: 'literal', track: tn.label, step: si, arg: 0, value: { $tap: on.label } }], `${tn.label}.${r.inn.port} reads var ${on.label}`);
  }
  if (r.does === 'wire') {
    const t = G.model.tracks.find((x) => x.name === tn.label), step = (t.chain || []).find((s) => s[0] === r.inn.port);
    const cur0 = step && typeof step[1] === 'number' ? step[1] : 1;
    const ans = await bridgeSheet(on.label, r.inn.port, FACETS.includes(r.out.port) ? r.out.port : 'env', cur0);
    if (!ans) { say('Wire cancelled'); return false; }
    return doOps([{ op: 'addWire', track: tn.label, param: r.inn.port, tap: `${on.label}:${ans.facet}`, opts: { range: [ans.lo, ans.hi] } }], `${tn.label}.${r.inn.port} follows ${on.label}:${ans.facet}`);
  }
  return false;
}

/* ---------------------------------------------------------------- DOM */
let root, vp, world, svg, nodesEl, badgesEl, msgEl, sheetEl, selbar, zoomEl, crumbs, planEl, outlineEl, codeTa, mirror;
function loadCss() {
  // the view mounts once its stylesheet is in, so the unstyled DOM never paints (no layout shift on first open)
  let l = document.querySelector('link[href="graph.css"]'); if (l && l.sheet) return Promise.resolve();
  if (!l) { l = h('link', { rel: 'stylesheet', href: 'graph.css' }); document.head.append(l); }
  return new Promise((res) => { l.addEventListener('load', res, { once: true }); l.addEventListener('error', res, { once: true }); });
}
function mount(host) {
  const tool = (id, label, text, extra = {}) => h('button', { type: 'button', class: 'ghost gx-tool', id, 'aria-label': label, title: label, ...extra }, text);
  root = h('section', { class: 'gx panel', 'aria-label': 'Graph editor', 'data-pane': 'graph', 'data-zoom': 'mid' },
    h('div', { class: 'gx-bar' },
      crumbs = h('nav', { class: 'gx-crumbs', 'aria-label': 'Subgraph path' }),
      h('div', { class: 'gx-seg', role: 'tablist', 'aria-label': 'Graph panes' },
        ...['graph', 'code', 'outline'].map((p) => h('button', { type: 'button', role: 'tab', class: 'gx-tab', 'data-pane': p, id: 'gxTab-' + p, 'aria-selected': String(p === 'graph'), 'aria-controls': 'gxPane-' + p }, p[0].toUpperCase() + p.slice(1)))),
      h('div', { class: 'gx-tools' },
        tool('gxAdd', 'Add step from palette', '+'), tool('gxUndo', 'Undo graph or code edit', '↶'), tool('gxRedo', 'Redo', '↷'),
        tool('gxFit', 'Fit graph to view', 'Fit'), tool('gxReset', 'Reset zoom to 100%', '1:1'), tool('gxMulti', 'Multi-select', 'Select', { 'aria-pressed': 'false' }),
        tool('gxPlanBtn', 'Show plan strip', 'Plan', { 'aria-pressed': 'false', 'aria-controls': 'gxPlan' }), tool('gxImport', 'Load the Rack editor code into the graph', 'Rack')),
    ),
    planEl = h('div', { class: 'gx-plan', id: 'gxPlan', hidden: true, role: 'img', 'aria-label': 'Plan: open windows per slot and variable against bars' }),
    h('div', { class: 'gx-body' },
      h('div', { class: 'gx-canvas', id: 'gxPane-graph', role: 'tabpanel', 'aria-labelledby': 'gxTab-graph' },
        vp = h('div', { class: 'gx-vp', 'aria-label': 'Graph canvas: drag to pan, pinch or Ctrl+wheel to zoom, + and - keys zoom', role: 'group' },
          world = h('div', { class: 'gx-world' },
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
            badgesEl = h('div', { class: 'gx-badges' }), nodesEl = h('div', { class: 'gx-nodes' }))), // nodes over badges: a node is never covered by a wire label
        msgEl = h('p', { class: 'gx-msg', role: 'status', 'aria-live': 'polite' }),
        zoomEl = h('output', { class: 'gx-zoom', 'aria-label': 'Zoom level' }, '100%'),
        h('div', { class: 'gx-hud', role: 'toolbar', 'aria-label': 'Canvas view' },
          tool('gxHudFit', 'Fit graph to view', 'Fit', { 'data-hud': 'fit' }), tool('gxHudOut', 'Zoom out', '\u2212', { 'data-hud': 'out' }),
          tool('gxHudReset', 'Reset zoom to 100%', '1:1', { 'data-hud': 'reset' }),
          tool('gxLock', 'Interact: one-finger drag pans the graph instead of scrolling the page', 'Interact', { 'aria-pressed': 'false', 'data-hud': 'lock' }),
          tool('gxCollapse', 'Collapse graph canvas', '\u2303', { 'aria-pressed': 'false', 'aria-expanded': 'true', 'data-hud': 'collapse' })),
        h('p', { class: 'gx-touchhint', 'aria-hidden': 'true' }, '2 fingers to move graph'),
        selbar = h('div', { class: 'gx-selbar', hidden: true, role: 'toolbar', 'aria-label': 'Selection actions' }),
        sheetEl = h('div', { class: 'gx-sheet', hidden: true, role: 'region', 'aria-label': 'Inspector', tabindex: '-1' })),
      h('div', { class: 'gx-side' },
        h('div', { class: 'gx-code', id: 'gxPane-code', role: 'tabpanel', 'aria-labelledby': 'gxTab-code' },
          h('div', { class: 'gx-code-wrap' }, mirror = h('pre', { class: 'gx-mirror', 'aria-hidden': 'true' }),
            h('label', { class: 'sr', for: 'gxCode' }, 'Graph program code'),
            codeTa = h('textarea', { id: 'gxCode', class: 'gx-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' })),
          h('p', { class: 'gx-err', id: 'gxErr', role: 'status', hidden: true })),
        outlineEl = h('div', { class: 'gx-outline', id: 'gxPane-outline', role: 'tabpanel', 'aria-labelledby': 'gxTab-outline' }))));
  svg.setAttribute('class', 'gx-wires'); svg.setAttribute('aria-hidden', 'true');
  host.replaceChildren(root);
  bind();
  codeTa.value = G.text; setText(G.text, { save: false });
  applyView();
}

function render() {
  if (!root) return;
  const model = cur() ? cur().model : G.model;
  G.view = G.fixture || buildView(model);
  if (!G.fixture) place(G.view, model);
  const ro = readonly();
  root.toggleAttribute('data-readonly', ro);
  let html = '';
  for (const n of G.view.nodes) {
    const sel = G.sel.has(n.id);
    const ports = (dir) => (dir === 'in' ? n.ins : n.outs).map((p, i) => `<button type="button" class="gp gp-${dir} gt-${p.type}" data-node="${esc(n.id)}" data-port="${esc(p.name)}" data-dir="${dir}" data-type="${p.type}" style="top:${HEAD + i * ROW}px" aria-label="${esc(`${n.label} ${dir === 'in' ? 'input' : 'output'} ${p.label}, ${p.type}`)}"><i class="gp-dot" aria-hidden="true"></i><span class="gp-l">${esc(p.label)}</span><span class="gp-t" aria-hidden="true">${p.type.slice(0, 3)}</span></button>`).join('');
    const rows = Math.max(1, n.ins.length, n.outs.length);
    let body = '';
    if (n.steps) body = `<ol class="gn-steps" style="top:${HEAD + rows * ROW}px">${n.steps.map((s, i) => `<li data-step="${i}"><span class="gs-t">${i ? '.' : ''}${esc(stepText(s))}</span>${s.slice(1).map((a, j) => ((typeof a === 'number' || typeof a === 'string' || (isObj(a) && '$mini' in a)) && !NONPARAM.has(s[0]) ? `<input class="gs-in" data-step="${i}" data-arg="${j}" value="${esc(isObj(a) ? a.$mini : a)}" aria-label="${esc(`${n.label} ${s[0]} argument ${j + 1}`)}"${ro ? ' readonly' : ''}>` : '')).join('')}</li>`).join('')}</ol>`;
    if (n.kind === 'code') body = `<pre class="gn-src" style="top:${HEAD + rows * ROW}px">${esc(n.src.trim().split('\n').slice(0, 3).join('\n'))}</pre>`;
    html += `<div class="gn gk-${n.kind}${sel ? ' sel' : ''}${n.err ? ' err' : ''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;height:${n.h}px">`
      + `<button type="button" class="gn-head" data-node="${esc(n.id)}" aria-pressed="${sel}" aria-label="${esc(`${n.sub} ${n.label}${n.err ? ', error: ' + n.err : ''}`)}"><b>${esc(n.label)}</b><span class="gn-k">${esc(n.sub)}</span></button>`
      + (n.err ? `<p class="gn-err" title="${esc(n.err)}">${esc(n.err.split(':')[0])}</p>` : '') + ports('in') + ports('out') + body + '</div>';
  }
  nodesEl.innerHTML = html;
  if (G.wire && !G.view.wires.some((w) => w.id === G.wire)) { G.wire = null; closeSheet(); }
  for (const id of [...G.sel]) if (!G.view.nmap.has(id)) G.sel.delete(id);
  drawWires(); renderArmed(); renderCrumbs(); renderOutline(); renderSelbar(); renderPlan(); syncMirror(false);
  const err = $('#gxErr'); if (err) { err.hidden = !G.parseErr; err.textContent = G.parseErr ? `Syntax error: ${G.parseErr}. The graph shows the last version that parsed.` : ''; }
}
function wirePath(w, k = 0) {
  // the badge sits near the arrival (t ~ 0.86), in the gap before the target column; wires sharing a port step back along the curve
  const a = G.view.nmap.get(w.from.node), b = G.view.nmap.get(w.to.node);
  const p = anchor(a, 'out', w.from.port), q = anchor(b, 'in', w.to.port), dx = Math.max(48, Math.abs(q.x - p.x) / 2);
  const c1 = { x: p.x + dx, y: p.y }, c2 = { x: q.x - dx, y: q.y }, t = Math.max(0.3, 0.86 - 0.18 * k), u = 1 - t;
  const at = (P, A, B, Q) => u * u * u * P + 3 * u * u * t * A + 3 * u * t * t * B + t * t * t * Q;
  return { d: `M${p.x} ${p.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`, mx: at(p.x, c1.x, c2.x, q.x), my: at(p.y, c1.y, c2.y, q.y) };
}
const BADGE = { pattern: 'PAT', signal: 'SIG ~', param: 'PRM', gate: 'GATE', hook: 'HOOK' };
function drawWires() {
  let paths = '', badges = ''; const seen = new Map();
  for (const w of G.view.wires) {
    const key = w.to.node + '\u0000' + w.to.port, k = seen.get(key) || 0; seen.set(key, k + 1);
    const { d, mx, my } = wirePath(w, k), s = G.wire === w.id ? ' sel' : '';
    if (w.type === 'hook') paths += `<path class="gw gw-hook${s}" d="${d}"/><path class="gw-hook-in" d="${d}"/>`;
    else paths += `<path class="gw gw-${w.type}${s}" d="${d}"/>`;
    if (w.type === 'pattern') paths += `<path class="gw-pulse" d="${d}"/>`;
    const extra = w.type === 'signal' ? ` ${w.from.port}` : w.window ? ` ${w.window}` : '';
    const bw = Math.max(52, Math.ceil((BADGE[w.type].length + extra.length) * 6.6 + 24)); // left/top, no per-badge transform: keeps pan/zoom off the layerizer
    badges += `<button type="button" class="gb gb-${w.type}${s}" data-wire="${esc(w.id)}" style="left:${(mx - bw / 2).toFixed(1)}px;top:${(my - 26).toFixed(1)}px;width:${bw}px" aria-label="${esc(`${w.type} wire ${G.view.nmap.get(w.from.node).label} ${w.from.port} to ${G.view.nmap.get(w.to.node).label} ${w.to.port}${w.window ? ', window ' + w.window : ''}`)}"><span>${BADGE[w.type]}${esc(extra)}</span></button>`;
  }
  svg.innerHTML = paths; badgesEl.innerHTML = badges;
}
function renderArmed() {
  root.toggleAttribute('data-armed', !!G.armed);
  for (const b of nodesEl.querySelectorAll('.gp')) {
    b.classList.remove('lit', 'dim', 'armed'); b.removeAttribute('data-hint');
    if (!G.armed) continue;
    const p = portOf(b);
    if (p.node === G.armed.node && p.port === G.armed.port && p.dir === G.armed.dir) { b.classList.add('armed'); continue; }
    const r = rule(G.armed, p);
    if (r.ok) { b.classList.add('lit'); b.dataset.hint = r.does; } else b.classList.add('dim');
  }
}
const portOf = (b) => ({ node: b.dataset.node, port: b.dataset.port, dir: b.dataset.dir, type: b.dataset.type });
function renderCrumbs() {
  const items = [{ label: 'Song' }, ...G.path];
  crumbs.replaceChildren(h('ol', {}, ...items.map((it, i) => h('li', {}, i === items.length - 1 ? h('span', { 'aria-current': 'location' }, it.label) : h('button', { type: 'button', class: 'ghost gx-crumb', 'data-depth': String(i) }, it.label)))));
}
function renderPlan() {
  if (planEl.hidden) return;
  const m = cur() ? cur().model : G.model, mk = m.markers || {};
  const rows = [];
  (m.bindings || []).forEach((b) => rows.push({ label: b.slot, seg: b.hook, gate: b.gate }));
  for (const [k, list] of Object.entries(m.vars || {})) list.forEach((a) => rows.push({ label: 'var ' + k, seg: String(argText(a.value)), gate: a.gate }));
  const wins = rows.map((r) => { const p = gateParts(r.gate); const a = p.from ? barOf(p.from, mk) : 1, b = p.until ? barOf(p.until, mk) : Infinity; return { ...r, a, b, unknown: a == null || b == null }; });
  const maxBar = Math.min(64, Math.max(16, ...wins.flatMap((w) => [w.a, w.b]).filter((x) => Number.isFinite(x)).map((x) => x + 4)));
  const pct = (bar) => ((Math.min(maxBar + 1, Math.max(1, bar)) - 1) / maxBar) * 100;
  planEl.innerHTML = `<div class="gpl-axis" aria-hidden="true">${Array.from({ length: Math.floor(maxBar / 4) + 1 }, (_, i) => `<span style="left:${pct(1 + i * 4)}%">${1 + i * 4}</span>`).join('')}</div>`
    + (wins.length ? wins.map((w) => `<div class="gpl-row"><span class="gpl-l">${esc(w.label)}</span><div class="gpl-lane">${w.unknown ? `<i class="gpl-seg unk" style="left:0;width:100%">${esc(w.seg)} · window ${esc(gateBadge(w.gate))} (resolved at run time)</i>` : `<i class="gpl-seg" style="left:${pct(w.a)}%;width:${Math.max(1, pct(w.b) - pct(w.a))}%">${esc(w.seg)}</i>`}</div></div>`).join('') : '<p class="gpl-empty">No bindings or gated variables yet.</p>')
    + '<i class="gpl-head" aria-hidden="true"></i>';
  planEl.dataset.max = maxBar;
}

/* ---------------------------------------------------------------- outline (non-pointer path) */
function renderOutline() {
  const v = G.view; if (!v) return;
  const ro = readonly();
  outlineEl.replaceChildren(
    h('h3', { class: 'gx-oh' }, `Nodes (${v.nodes.length})`),
    h('ul', { class: 'gx-ol', 'aria-label': 'Graph nodes' }, ...v.nodes.map((n) => h('li', { 'data-id': n.id },
      h('button', { type: 'button', class: 'ghost gx-on', 'data-act': 'select', 'data-node': n.id, 'aria-pressed': String(G.sel.has(n.id)) }, h('b', {}, n.label), h('span', {}, ' ' + n.sub)),
      h('button', { type: 'button', class: 'ghost', 'data-act': 'connect', 'data-node': n.id, disabled: ro || !(n.ins.length + n.outs.length), 'aria-label': `Connect ${n.label} to…` }, 'Connect to…'),
      h('button', { type: 'button', class: 'ghost', 'data-act': 'move', 'data-node': n.id, 'aria-label': `Move ${n.label} to…` }, 'Move to…')))),
    h('h3', { class: 'gx-oh' }, `Wires (${v.wires.length})`),
    h('ul', { class: 'gx-ol', 'aria-label': 'Graph wires' }, ...v.wires.map((w) => h('li', {},
      h('button', { type: 'button', class: 'ghost gx-on', 'data-act': 'wire', 'data-wire': w.id, 'aria-pressed': String(G.wire === w.id) },
        h('b', {}, `${v.nmap.get(w.from.node).label}.${w.from.port} → ${v.nmap.get(w.to.node).label}.${w.to.port}`), h('span', {}, ` ${w.type}${w.window ? ' · ' + w.window : ''}`))))));
}

/* ---------------------------------------------------------------- sheet (inspector, questions, palette) */
let sheetResolve = null;
const narrow = matchMedia('(max-width: 900px)');
function setPane(p) { G.pane = p; root.dataset.pane = p; root.querySelectorAll('.gx-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.pane === p))); if (p === 'graph') applyView(); }
function openSheet(title, body, { label = title } = {}) {
  if (narrow.matches && G.pane !== 'graph') setPane('graph'); // the sheet lives over the canvas: on a phone, show it
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }
  sheetEl.replaceChildren(h('div', { class: 'gx-sh-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'icon ghost', 'aria-label': 'Close inspector', 'data-act': 'close' }, '×')), body);
  sheetEl.setAttribute('aria-label', label); sheetEl.hidden = false;
}
function closeSheet() { if (!sheetEl) return; sheetEl.hidden = true; sheetEl.replaceChildren(); if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); } }
function bridgeSheet(tap, param, facet, cur0) {
  const def = { lpf: [200, 4000], hpf: [50, 2000], gain: [0, 1], pan: [0, 1], room: [0, 1], speed: [0.5, 2] }[param] || [Math.min(0, cur0), Math.max(1, cur0 * 2)];
  return new Promise((resolve) => {
    const f = h('form', { class: 'gx-form', 'data-bridge': '1' },
      h('p', { class: 'gx-hint' }, `Tap ${tap} drives ${param}: choose which facet of the tap, and the range it maps to.`),
      h('fieldset', { class: 'gx-facets' }, h('legend', {}, 'Facet'), ...FACETS.map((x) => h('label', { class: 'gx-radio' }, h('input', { type: 'radio', name: 'facet', value: x, checked: x === facet }), x))),
      h('div', { class: 'gx-row' }, h('label', {}, 'Min ', h('input', { type: 'number', name: 'lo', value: def[0], step: 'any', required: true })), h('label', {}, 'Max ', h('input', { type: 'number', name: 'hi', value: def[1], step: 'any', required: true }))),
      h('div', { class: 'gx-acts' }, h('button', { type: 'button', class: 'ghost', 'data-act': 'close' }, 'Cancel'), h('button', { type: 'submit', class: 'gx-ok' }, 'Wire it')));
    openSheet(`Wire ${tap} → ${param}`, f, { label: 'Wire options' });
    sheetResolve = resolve;
    f.addEventListener('submit', (e) => { e.preventDefault(); const d = new FormData(f); const r = sheetResolve; sheetResolve = null; closeSheet(); r && r({ facet: d.get('facet'), lo: +d.get('lo'), hi: +d.get('hi') }); });
    f.querySelector('input:checked').focus();
  });
}
function inspectNode(id) {
  const n = G.view.nmap.get(id); if (!n) return; const ro = readonly(); const kids = [];
  kids.push(h('p', { class: 'gx-hint' }, n.sub + (n.err ? ' — ' + n.err : '')));
  if (n.kind === 'track' && !G.fixture) {
    kids.push(h('ol', { class: 'gx-steps' }, ...n.steps.map((s, i) => h('li', {}, h('code', {}, (i ? '.' : '') + stepText(s)),
      ...s.slice(1).map((a, j) => ((typeof a === 'number' || typeof a === 'string' || (isObj(a) && '$mini' in a)) && !NONPARAM.has(s[0]) ? h('input', { class: 'gx-lit', 'data-track': n.label, 'data-step': String(i), 'data-arg': String(j), value: isObj(a) ? a.$mini : a, 'aria-label': `${s[0]} argument ${j + 1}`, readonly: ro }) : null)),
      i ? h('button', { type: 'button', class: 'ghost', 'data-act': 'mvstep', 'data-track': n.label, 'data-step': String(i - 1), disabled: ro, 'aria-label': `Move .${s[0]} to…` }, 'Move to…') : null,
      i ? h('button', { type: 'button', class: 'ghost', 'data-act': 'rmstep', 'data-track': n.label, 'data-step': String(i - 1), disabled: ro, 'aria-label': `Remove .${s[0]}` }, 'Remove') : null))));
  } else if (n.kind === 'code') {
    kids.push(h('p', { class: 'gx-hint' }, `Opaque code: not editable here beyond its text. Detected inputs: ${n.ins.map((p) => p.name).join(', ') || 'none'}; outputs: ${n.outs.map((p) => p.name).join(', ')}.`), h('pre', { class: 'gx-src' }, n.src.trim()),
      h('button', { type: 'button', 'data-act': 'edittext', 'data-node': id }, 'Edit text'));
  } else if (n.kind === 'var' && !G.fixture) {
    ((cur() ? cur().model : G.model).vars[n.label] || []).forEach((a, i) => kids.push(h('div', { class: 'gx-row' }, h('label', {}, `Value ${i + 1}${a.gate ? ' (' + gateBadge(a.gate) + ')' : ''} `, h('input', { class: 'gx-lit', 'data-var': n.label, 'data-index': String(i), value: typeof a.value === 'object' ? JSON.stringify(a.value) : a.value, readonly: ro })))));
  } else if (n.kind === 'marker' && !G.fixture) {
    kids.push(h('div', { class: 'gx-row' }, h('label', {}, 'Point ', h('input', { class: 'gx-lit', 'data-marker': n.label, value: n.raw.point, readonly: ro }))));
  } else if (n.kind === 'component') {
    kids.push(h('button', { type: 'button', 'data-act': 'enter', 'data-node': id }, `Open ${n.label}`));
  } else if (n.kind === 'slot') {
    const bs = G.view.wires.filter((w) => w.to.node === id && w.type === 'hook');
    kids.push(h('p', { class: 'gx-hint' }, bs.length ? 'Bindings: ' + bs.map((w) => `${G.view.nmap.get(w.from.node).label}${w.window ? ' ' + w.window : ''}`).join(', ') : 'Unbound: the slot passes its pattern through.'));
  }
  kids.push(h('div', { class: 'gx-acts' }, h('button', { type: 'button', class: 'ghost', 'data-act': 'connect', 'data-node': id, disabled: ro }, 'Connect to…'), h('button', { type: 'button', class: 'ghost', 'data-act': 'move', 'data-node': id }, 'Move to…')));
  openSheet(n.label, h('div', { class: 'gx-insp' }, ...kids), { label: 'Inspector: ' + n.label });
}
function inspectWire(id) {
  const w = G.view.wires.find((x) => x.id === id); if (!w) return; const ro = readonly();
  const A = G.view.nmap.get(w.from.node), B = G.view.nmap.get(w.to.node);
  const kids = [h('p', { class: 'gx-hint' }, `${w.type} wire: ${A.label}.${w.from.port} → ${B.label}.${w.to.port}`)];
  if (w.binding && w.b) {
    const p = gateParts(w.b.gate), mk = Object.keys((cur() ? cur().model : G.model).markers || {});
    const field = (name, val) => h('div', { class: 'gx-gate' }, h('label', { for: 'gxG-' + name }, name === 'from' ? 'From' : 'Until'),
      h('button', { type: 'button', class: 'ghost', 'data-act': 'bar', 'data-d': '-1', 'aria-label': `${name} one bar earlier`, disabled: ro }, '−'),
      h('input', { id: 'gxG-' + name, name, value: val, placeholder: name === 'from' ? 'start' : 'end', 'aria-describedby': 'gxGateHelp', readonly: ro }),
      h('button', { type: 'button', class: 'ghost', 'data-act': 'bar', 'data-d': '1', 'aria-label': `${name} one bar later`, disabled: ro }, '+'),
      h('select', { 'aria-label': `${name} marker`, disabled: ro || !mk.length }, h('option', { value: '' }, 'marker'), ...mk.map((m) => h('option', { value: m }, m))));
    kids.push(h('form', { class: 'gx-form', 'data-binding': w.binding },
      field('from', p.from), field('until', p.until), h('p', { class: 'gx-hint', id: 'gxGateHelp' }, 'Points: 17b (bar), 16 (cycle), a marker, or marker+2b. Until is exclusive.'),
      h('dl', { class: 'gx-dl' }, h('dt', {}, 'Order'), h('dd', {}, String(w.b.order ?? '-')), h('dt', {}, 'Priority'), h('dd', {}, String(w.b.priority ?? '-')), h('dt', {}, 'Else'), h('dd', {}, String(w.b.else ?? '-'))),
      h('p', { class: 'gx-hint' }, 'Order, priority and else are edited on the hooks.bind line for now (model.js has no op for them yet).'),
      h('div', { class: 'gx-acts' },
        h('button', { type: 'button', class: 'ghost', 'data-act': 'unbind', 'data-binding': w.binding, disabled: ro }, 'Unbind'),
        h('button', { type: 'button', class: 'ghost', disabled: true, title: 'Needs the live hooks.replace path on the playing program' }, 'Swap at next bar'),
        h('button', { type: 'submit', class: 'gx-ok', disabled: ro }, 'Apply window'))));
  } else kids.push(h('p', { class: 'gx-hint' }, w.type === 'signal' ? 'Signal wire (a .wire(...) step or a tap(...) argument): remove the step in the track inspector.' : 'Derived from the code: edit the track that makes it.'));
  openSheet('Wire', h('div', { class: 'gx-insp' }, ...kids), { label: 'Inspector: wire' });
}
function connectSheet(id) {
  const n = G.view.nmap.get(id); const opts = [];
  for (const p of [...n.ins, ...n.outs]) {
    const a = { node: id, port: p.name, dir: p.dir, type: p.type };
    for (const m of G.view.nodes) { if (m.id === id) continue; for (const q of [...m.ins, ...m.outs]) { const b = { node: m.id, port: q.name, dir: q.dir, type: q.type }; const r = rule(a, b); if (r.ok) opts.push({ a, b, text: `${p.label} → ${m.label} · ${q.label}`, does: r.does }); } }
  }
  const list = h('ul', { class: 'gx-choices', 'aria-label': `Compatible ports for ${n.label}` }, ...opts.map((o, i) => h('li', {}, h('button', { type: 'button', class: 'ghost', 'data-act': 'pick', 'data-i': String(i) }, h('b', {}, o.text), h('span', {}, ' ' + o.does)))));
  openSheet(`Connect ${n.label} to…`, opts.length ? list : h('p', { class: 'gx-hint' }, 'No compatible ports in this graph.'));
  sheetEl.__opts = opts; const first = sheetEl.querySelector('[data-act=pick]'); (first || sheetEl).focus();
}
function moveSheet(id) {
  const n = G.view.nmap.get(id); const cols = Math.max(...G.view.nodes.map((m) => Math.round(m.x / COLW))) + 2;
  const list = h('ul', { class: 'gx-choices', 'aria-label': `Columns for ${n.label}` }, ...Array.from({ length: cols }, (_, c) => h('li', {}, h('button', { type: 'button', class: 'ghost', 'data-act': 'col', 'data-c': String(c), 'data-node': id, 'aria-current': String(Math.round(n.x / COLW) === c) }, `Column ${c + 1}${Math.round(n.x / COLW) === c ? ' (here)' : ''}`))));
  openSheet(`Move ${n.label} to…`, list); const b = sheetEl.querySelector('[data-act=col]'); b && b.focus();
}
function moveStepSheet(track, idx) {
  const t = G.model.tracks.find((x) => x.name === track), len = (t.chain || []).length;
  const list = h('ul', { class: 'gx-choices', 'aria-label': 'Step positions' }, ...Array.from({ length: len }, (_, i) => h('li', {}, h('button', { type: 'button', class: 'ghost', 'data-act': 'mvto', 'data-track': track, 'data-from': String(idx), 'data-to': String(i), disabled: i === idx }, `Position ${i + 1}${i === idx ? ' (here)' : ''}`))));
  openSheet(`Move .${t.chain[idx][0]} to…`, list); const b = sheetEl.querySelector('[data-act=mvto]:not([disabled])'); b && b.focus();
}
async function paletteSheet() {
  const items = sc.intellisense ? await sc.intellisense.all({}) : [];
  const methods = items.filter((x) => x.method && /^[A-Za-z_$][\w$]*$/.test(x.label));
  const trackSel = [...G.sel].find((id) => id.startsWith('track:'));
  const q = h('input', { type: 'search', class: 'gx-q', placeholder: 'Search steps: lpf, delay, gain', 'aria-label': 'Search palette', autocomplete: 'off' });
  const body = h('div', { class: 'gx-pal' });
  const draw = () => {
    const s = q.value.trim().toLowerCase(); const groups = new Map(); const seen = new Set();
    for (const it of methods) { if (s && !(it.label.toLowerCase().includes(s) || (it.detail || '').toLowerCase().includes(s))) continue; if (seen.has(it.label)) continue; seen.add(it.label); const c = it.category || 'other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    body.replaceChildren(...[...groups].slice(0, 30).map(([c, list]) => h('section', {}, h('h4', {}, c), h('div', { class: 'gx-pal-items' }, ...list.slice(0, 40).map((it) => h('button', { type: 'button', class: 'ghost', 'data-act': 'add', 'data-label': it.label, title: it.info || it.detail || '', disabled: !trackSel || readonly() }, '.' + it.label))))));
    if (!groups.size) body.append(h('p', { class: 'gx-hint' }, 'No matching steps.'));
  };
  q.addEventListener('input', draw); draw();
  openSheet('Add a step', h('div', {}, h('p', { class: 'gx-hint' }, trackSel ? `Adds a step at the end of ${trackSel.slice(6)}.` : 'Select a track node first: steps are added to it. New tracks are a new line in Code.'), q, body));
  q.focus();
}

/* ---------------------------------------------------------------- selection, messages */
function say(m) { if (msgEl) { msgEl.textContent = m; msgEl.classList.remove('bad'); } }
function refuse(reason) { if (msgEl) { msgEl.textContent = 'Refused: ' + reason; msgEl.classList.add('bad'); } if (ui()) ui().toast(reason, { kind: 'error', ms: 4000 }); }
function paintSel() { for (const el of nodesEl.querySelectorAll('.gn')) { const on = G.sel.has(el.dataset.id); el.classList.toggle('sel', on); el.querySelector('.gn-head').setAttribute('aria-pressed', String(on)); } }
function selectNode(id, { add = false, inspect = true, fromCode = false } = {}) {
  G.wire = null;
  if (add) { if (G.sel.has(id)) G.sel.delete(id); else G.sel.add(id); } else { G.sel.clear(); G.sel.add(id); }
  paintSel(); drawWires(); renderOutline(); renderSelbar(); syncMirror(!fromCode);
  if (inspect && !add && !G.multi) inspectNode(id); else if (G.sel.size > 1) closeSheet();
  if (fromCode) reveal(id);
}
function selectWire(id) { G.wire = id; G.sel.clear(); paintSel(); drawWires(); renderOutline(); renderSelbar(); syncMirror(true); inspectWire(id); }
function clearSel() { G.sel.clear(); G.wire = null; G.armed = null; paintSel(); drawWires(); renderArmed(); renderOutline(); renderSelbar(); syncMirror(false); closeSheet(); }
function renderSelbar() {
  const show = G.multi || G.sel.size > 1; selbar.hidden = !show; if (!show) return;
  const n = G.sel.size, ro = readonly();
  selbar.replaceChildren(h('span', { class: 'gx-count' }, `${n} selected`),
    h('button', { type: 'button', 'data-act': 'collapse', disabled: ro || n < 1 }, 'Collapse to subgraph'),
    h('button', { type: 'button', class: 'ghost', 'data-act': 'save', disabled: n < 1 || !!G.fixture }, 'Save to library'),
    h('button', { type: 'button', class: 'ghost', 'data-act': 'delete', disabled: ro || n < 1 }, 'Delete'),
    h('button', { type: 'button', class: 'ghost', 'data-act': 'done' }, 'Done'));
}
function setMulti(on) { G.multi = on; $('#gxMulti').setAttribute('aria-pressed', String(on)); if (on) say('Multi-select: tap nodes to add them'); renderSelbar(); }
function syncMirror(scroll = true) {
  if (!mirror) return; const t = codeTa.value;
  const ids = G.wire && G.wire.startsWith('bind:') ? ['bind:' + G.wire.split(':')[1]] : [...G.sel];
  const sp = G.spans.filter((s) => ids.includes(s.id)).sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const s of sp) { if (s.start < at || s.end > t.length) continue; out += esc(t.slice(at, s.start)) + '<mark>' + esc(t.slice(s.start, s.end)) + '</mark>'; at = s.end; }
  mirror.innerHTML = out + esc(t.slice(at)) + '\n';
  if (scroll && sp.length && document.activeElement !== codeTa) { const line = t.slice(0, sp[0].start).split('\n').length - 1; const lh = parseFloat(getComputedStyle(codeTa).lineHeight) || 20; codeTa.scrollTop = Math.max(0, (line - 2) * lh); }
  mirror.scrollTop = codeTa.scrollTop;
}
function reveal(id) { const n = G.view.nmap.get(id); if (!n) return; const r = vp.getBoundingClientRect(); const sx = n.x * V.s + V.x, sy = n.y * V.s + V.y; if (sx < 0 || sy < 0 || sx + W * V.s > r.width || sy + 60 > r.height) { V.x = r.width / 2 - (n.x + W / 2) * V.s; V.y = r.height / 3 - n.y * V.s; applyView(); } }

/* ---------------------------------------------------------------- view transform */
function applyView() {
  world.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`;
  const lv = V.s < FAR ? 'far' : V.s >= NEAR ? 'near' : 'mid';
  if (lv !== G.level) { G.level = lv; root.dataset.zoom = lv; if (G.view) drawWires(); }
  const gl = V.s < GLYPH; if (gl !== root.classList.contains('gx-glyph')) root.classList.toggle('gx-glyph', gl); // level of detail: glyphs, never hidden
  if (gl) root.style.setProperty('--zinv', (1 / V.s).toFixed(3));
  // during a gesture only the world transform changes (compositor work); the zoom readout and the crisp re-raster follow when it settles
  if (!applyView.on) { world.classList.add('moving'); applyView.on = true; }
  clearTimeout(applyView.t); applyView.t = setTimeout(() => { applyView.on = false; world.classList.remove('moving'); zoomEl.textContent = Math.round(V.s * 100) + '%'; }, 160);
}
function zoomAt(s, cx, cy) { s = Math.min(ZMAX, Math.max(zmin(), s)); const k = s / V.s; V.x = cx - (cx - V.x) * k; V.y = cy - (cy - V.y) * k; V.s = s; applyView(); }
function bounds() {
  const ns = G.view ? G.view.nodes : []; if (!ns.length) return null;
  return { x0: Math.min(...ns.map((n) => n.x)), y0: Math.min(...ns.map((n) => n.y)), x1: Math.max(...ns.map((n) => n.x + W)), y1: Math.max(...ns.map((n) => n.y + n.h)) };
}
function fitScale() { const b = bounds(), r = vp && vp.getBoundingClientRect(); if (!b || !r || !r.width) return 1; return Math.min((r.width - 32) / (b.x1 - b.x0), (r.height - 32) / (b.y1 - b.y0)); }
// min zoom follows the content: at least 15% below the fit scale, so zooming all the way out always shows every node
function zmin() { return Math.max(0.01, Math.min(ZMIN, fitScale() * 0.85)); }
function fit() {
  const b = bounds(); if (!b) return; const r = vp.getBoundingClientRect(); if (!r.width) return;
  const s = Math.min(ZMAX, Math.max(zmin(), Math.min(fitScale(), 1.2)));
  V.s = s; V.x = (r.width - (b.x1 - b.x0) * s) / 2 - b.x0 * s; V.y = (r.height - (b.y1 - b.y0) * s) / 2 - b.y0 * s; applyView();
}
function resetView() { const r = vp.getBoundingClientRect(), b = bounds(); V.s = 1; V.x = 24 - (b ? b.x0 : 0); V.y = 24 - (b ? b.y0 : 0); if (!r.width) return; applyView(); }
function moveNode(id, x, y) {
  const n = G.view.nmap.get(id); n.x = x; n.y = y;
  if (!G.fixture) { const k = scopeKey(); (G.pos[k] ||= {})[id] = { x: Math.round(x), y: Math.round(y) }; store.set(POSKEY, G.pos); }
  const el = nodesEl.querySelector(`.gn[data-id="${CSS.escape(id)}"]`); if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; } drawWires();
}

/* ---------------------------------------------------------------- actions */
async function collapse(saveOnly = false) {
  const ids = [...G.sel]; const bad = ids.filter((id) => !/^(track|code):/.test(id));
  if (!ids.length) return refuse('Select track nodes first.');
  if (readonly()) return refuse('Collapse works at the song level: open Song in the breadcrumb.');
  if (bad.length) return refuse(`Only tracks and code nodes collapse into a component; ${bad.map((b) => G.view.nmap.get(b).label).join(', ')} ${bad.length > 1 ? 'are' : 'is'} not.`);
  let comp; try { comp = extract(G.model, ids); } catch (e) { return refuse(e.message); }
  const name = await ui().ask({ title: saveOnly ? 'Save to library' : 'Collapse to subgraph', label: 'Component name (letters, digits, - or _)', value: 'part', okText: saveOnly ? 'Save' : 'Collapse' });
  if (name == null) return say('Cancelled');
  if (!/^[A-Za-z][\w-]*$/.test(name)) return refuse(`"${name}" is not a component name: start with a letter, then letters, digits, - or _.`);
  let saved; try { saved = lib.save(comp, { name, kind: comp.meta.kind }); } catch (e) { return refuse(e.message); }
  const ref = `${name}@${saved.rev}`;
  if (saveOnly) { ui().toast(`Saved ${ref} to the library`, { kind: 'ok' }); return; }
  const used = new Set([...(G.model.instances || []).map((i) => i.as), ...(G.model.tracks || []).map((t) => t.name)]);
  const base = name.replace(/-/g, '_'); let as = base; for (let i = 2; used.has(as); i++) as = base + i;
  const m = replaceWithInstance(G.model, ids, { component: ref, as });
  if (commit(generate(m), `Collapsed ${ids.length} nodes into ${ref} as ${as}`)) { G.sel.clear(); G.sel.add('inst:' + as); setMulti(false); render(); ui().toast(`Collapsed into ${ref}`, { kind: 'ok' }); }
}
function deleteSel() {
  const ids = [...G.sel];
  if (ids.some((id) => /^(track|code):/.test(id))) return refuse('Deleting a whole track has no model op yet: delete its line in Code (the same undo stack covers it).');
  return refuse('Select a binding wire and use Unbind, or remove steps in a track inspector.');
}
function enter(id) {
  const n = G.view.nmap.get(id); if (!n || n.kind !== 'component') return;
  const [nm, rv] = n.component.split('@'); const rec = lib.get(nm, +rv);
  if (!rec) return refuse(`${n.component} is not in this browser's library.`);
  G.path.push({ label: n.label, ref: n.component, model: rec }); G.sel.clear(); G.wire = null; closeSheet(); render(); fit();
  say(`Inside ${n.label} (${n.component}): read-only; exported taps ${((rec.exports || {}).taps || []).join(', ') || 'none'}`);
}
function leave(depth) { G.path = G.path.slice(0, depth); G.sel.clear(); G.wire = null; closeSheet(); render(); fit(); }
function litValue(s, old) { if (typeof old === 'number') { const x = Number(s); return s.trim() !== '' && Number.isFinite(x) ? x : s; } if (isObj(old) && '$mini' in old) return { $mini: s }; return s; }
function applyLiteral(inp) {
  const d = inp.dataset;
  if (d.marker) return doOps([{ op: 'literal', marker: d.marker, value: inp.value }], `Marker ${d.marker} = ${inp.value}`);
  if (d.var) { const old = G.model.vars[d.var][+d.index].value; let v; try { v = JSON.parse(inp.value); } catch (e) { v = litValue(inp.value, old); } return doOps([{ op: 'literal', var: d.var, index: +d.index, value: v }], `${d.var} = ${inp.value}`); }
  const track = d.track || inp.closest('.gn').dataset.id.slice(6), t = G.model.tracks.find((x) => x.name === track);
  const si = +d.step, step = si === 0 ? t.source : t.chain[si - 1], old = step[+d.arg + 1];
  return doOps([{ op: 'literal', track, step: si === 0 ? 'source' : si - 1, arg: +d.arg, value: litValue(inp.value, old) }], `${track}.${step[0]} = ${inp.value}`);
}

/* ---------------------------------------------------------------- input wiring */
function bind() {
  root.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { e.preventDefault(); e.stopPropagation(); if (e.key === 'y' || e.shiftKey) redo(); else undo(); return; }
    if (e.key === 'Escape' && (G.armed || !sheetEl.hidden || G.sel.size || G.wire)) { e.stopPropagation(); e.preventDefault(); if (!sheetEl.hidden) closeSheet(); else clearSel(); return; }
    if (e.target.closest('input, textarea, select')) { e.stopPropagation(); if (e.key === 'Enter' && e.target.classList.contains('gs-in')) { e.preventDefault(); applyLiteral(e.target); } return; }
    if (!mod && !e.altKey && e.target.closest('.gx-vp')) {
      const r = vp.getBoundingClientRect(), k = { '=': 1.2, '+': 1.2, '-': 1 / 1.2, _: 1 / 1.2 }[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); zoomAt(V.s * k, r.width / 2, r.height / 2); return; }
      const p = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key];
      if (p) { e.preventDefault(); e.stopPropagation(); V.x += p[0]; V.y += p[1]; applyView(); return; }
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button')) { e.stopPropagation(); return; } // activate the focused graph button, not the app's play shortcut
    if (!mod && !e.altKey && e.key.length === 1 && e.target.closest('.gx-sheet, .gx-outline, .gx-world')) e.stopPropagation(); // graph keys never trigger app shortcuts
  });
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('.gs-in, .gx-lit')) applyLiteral(t);
    else if (t.matches('.gx-gate select') && t.value) { const inp = t.closest('.gx-gate').querySelector('input'); inp.value = t.value; t.value = ''; }
  });
  root.addEventListener('submit', (e) => {
    const f = e.target; if (!f.dataset.binding) return; e.preventDefault();
    const g = gateString(f.elements.from.value.trim(), f.elements.until.value.trim());
    if (doOps([{ op: 'setGate', binding: f.dataset.binding, gate: g }], `Window of ${f.dataset.binding} = ${g || 'always'}`)) {
      const w = G.view.wires.find((x) => x.binding === f.dataset.binding); if (w) { G.wire = w.id; drawWires(); inspectWire(w.id); }
    }
  });
  let codeT = 0;
  codeTa.addEventListener('input', () => { syncMirror(false); clearTimeout(codeT); codeT = setTimeout(() => { const t = codeTa.value; if (t === G.text) return; G.past.push(G.text); G.future = []; setText(t); }, 350); });
  codeTa.addEventListener('scroll', () => { mirror.scrollTop = codeTa.scrollTop; });
  const fromCaret = () => {
    const p = codeTa.selectionStart; const s = G.spans.find((x) => p >= x.start && p <= x.end); if (!s || cur()) return;
    if (s.id.startsWith('bind:')) { const w = G.view.wires.find((x) => x.binding === s.id.slice(5)); if (w && G.wire !== w.id) { G.wire = w.id; G.sel.clear(); paintSel(); drawWires(); renderOutline(); syncMirror(false); } }
    else if (G.view.nmap.has(s.id) && !(G.sel.size === 1 && G.sel.has(s.id))) selectNode(s.id, { inspect: false, fromCode: true });
  };
  codeTa.addEventListener('click', fromCaret); codeTa.addEventListener('keyup', (e) => { if (/^(Arrow|Home|End|Page)/.test(e.key)) fromCaret(); });
  pointer();
  // live state from the transport: pattern wires pulse while playing; with reduced motion the state is shown without animation
  const live = () => { const on = document.body.classList.contains('playing'); if (on !== G.live) { G.live = on; root.toggleAttribute('data-live', on); } };
  new MutationObserver(live).observe(document.body, { attributes: true, attributeFilter: ['class'] }); live();
  const tick = () => {
    if (!planEl.hidden && G.live) {
      let bar = 1; try { const st = sc.engineState && sc.engineState(); if (st && st.scheduler) bar = st.scheduler.now() / ((G.model.settings || {}).cpb || 1) + 1; } catch (e) { bar = 1; }
      const max = +planEl.dataset.max || 16; const hd = planEl.querySelector('.gpl-head'); if (hd) hd.style.left = `calc(var(--gpl-l) + (100% - var(--gpl-l) - 16px) * ${((bar - 1) % max) / max})`;
    }
    setTimeout(() => requestAnimationFrame(tick), reduce.matches ? 250 : 40);
  };
  requestAnimationFrame(tick);
}
async function onClick(e) {
  const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
  const act = b.dataset.act, viaPointer = e.detail > 0 && b.closest('.gx-world');
  if (b.classList.contains('gx-tab')) return setPane(b.dataset.pane);
  if (b.classList.contains('gx-crumb')) return leave(+b.dataset.depth);
  switch (b.id) {
    case 'gxAdd': return paletteSheet();
    case 'gxUndo': return undo();
    case 'gxRedo': return redo();
    case 'gxFit': case 'gxHudFit': return fit();
    case 'gxHudOut': { const r = vp.getBoundingClientRect(); return zoomAt(V.s / 1.25, r.width / 2, r.height / 2); }
    case 'gxHudReset': return resetView();
    case 'gxLock': { const on = root.dataset.lock !== 'on'; root.dataset.lock = on ? 'on' : 'off'; b.setAttribute('aria-pressed', String(on)); return say(on ? 'Interact on: one finger pans the graph' : 'Interact off: one finger scrolls the page, two fingers move the graph'); }
    case 'gxCollapse': { const c = root.dataset.collapsed !== 'on'; root.dataset.collapsed = c ? 'on' : 'off'; b.setAttribute('aria-pressed', String(c)); b.setAttribute('aria-expanded', String(!c)); b.textContent = c ? '\u2304' : '\u2303'; b.setAttribute('aria-label', c ? 'Expand graph canvas' : 'Collapse graph canvas'); if (!c) fit(); return; }
    case 'gxReset': return resetView();
    case 'gxMulti': return setMulti(!G.multi);
    case 'gxPlanBtn': planEl.hidden = !planEl.hidden; b.setAttribute('aria-pressed', String(!planEl.hidden)); return renderPlan();
    case 'gxImport': {
      const ta = document.getElementById('code'); const t = ta && ta.value; if (!t) return refuse('The Rack editor is empty.');
      if (await ui().askYesNo({ title: 'Load Rack code', message: 'Replace the graph program with the code in the Rack editor? Undo brings it back.', okText: 'Load' })) { G.path = []; G.fixture = null; commit(t, 'Loaded the Rack code'); fit(); }
      return;
    }
    default: break;
  }
  if (viaPointer && (b.classList.contains('gp') || b.classList.contains('gn-head') || b.classList.contains('gb'))) return; // pointer taps are handled in pointer()
  if (b.classList.contains('gp')) return tapPort(portOf(b));
  if (b.classList.contains('gn-head')) return selectNode(b.dataset.node, { add: G.multi || e.shiftKey });
  if (b.classList.contains('gb')) return selectWire(b.dataset.wire);
  switch (act) {
    case 'close': return closeSheet();
    case 'select': selectNode(b.dataset.node, { add: G.multi }); if (narrow.matches && !G.multi) reveal(b.dataset.node); return;
    case 'wire': return selectWire(b.dataset.wire);
    case 'connect': return connectSheet(b.dataset.node);
    case 'move': return moveSheet(b.dataset.node);
    case 'pick': { const o = sheetEl.__opts[+b.dataset.i]; closeSheet(); const ok = await connect(o.a, o.b); const back = outlineEl.querySelector(`[data-act=connect][data-node="${CSS.escape(o.a.node)}"]`); if (ok && back) back.focus(); return; }
    case 'col': { const id = b.dataset.node, c = +b.dataset.c; const inCol = G.view.nodes.filter((n) => n.id !== id && Math.round(n.x / COLW) === c); moveNode(id, c * COLW, inCol.length ? Math.max(...inCol.map((n) => n.y + n.h)) + GAP : 0); closeSheet(); say(`Moved ${G.view.nmap.get(id).label} to column ${c + 1}`); return; }
    case 'mvstep': return moveStepSheet(b.dataset.track, +b.dataset.step);
    case 'mvto': closeSheet(); return doOps([{ op: 'moveStep', track: b.dataset.track, from: +b.dataset.from, to: +b.dataset.to }], `Moved a step of ${b.dataset.track} to position ${+b.dataset.to + 1}`);
    case 'rmstep': { if (doOps([{ op: 'removeStep', track: b.dataset.track, index: +b.dataset.step }], `Removed a step from ${b.dataset.track}`)) inspectNode('track:' + b.dataset.track); return; }
    case 'unbind': closeSheet(); return doOps([{ op: 'unbind', binding: b.dataset.binding }], `Unbound ${b.dataset.binding}`);
    case 'bar': {
      const inp = b.closest('.gx-gate').querySelector('input'); const d = +b.dataset.d; const v = inp.value.trim(); let m;
      if ((m = /^(\d+(?:\.\d+)?)b$/.exec(v))) inp.value = Math.max(1, +m[1] + d) + 'b';
      else if ((m = /^([A-Za-z][\w-]*)(?:([+-])(\d+)b)?$/.exec(v))) { const off = (m[2] === '-' ? -1 : 1) * (+m[3] || 0) + d; inp.value = m[1] + (off ? (off > 0 ? '+' : '-') + Math.abs(off) + 'b' : ''); }
      else if (!v) inp.value = '1b';
      return;
    }
    case 'edittext': { const s = G.spans.find((x) => x.id === b.dataset.node); setPane('code'); codeTa.focus(); if (s) codeTa.setSelectionRange(s.start, s.end); return; }
    case 'enter': return enter(b.dataset.node);
    case 'add': {
      const tr = [...G.sel].find((id) => id.startsWith('track:')).slice(6); const t = G.model.tracks.find((x) => x.name === tr);
      const a = await ui().ask({ title: `Add .${b.dataset.label}`, label: 'Argument (number or text; empty for none)', value: '', okText: 'Add' }); if (a == null) return;
      const step = [b.dataset.label]; if (a.trim() !== '') step.push(Number.isFinite(Number(a)) ? Number(a) : a); closeSheet();
      return doOps([{ op: 'insertStep', track: tr, index: (t.chain || []).length, step }], `Added .${b.dataset.label} to ${tr}`);
    }
    case 'collapse': return collapse(false);
    case 'save': return collapse(true);
    case 'delete': return deleteSel();
    case 'done': setMulti(false); return clearSel();
    default: return undefined;
  }
}
function tapPort(p) {
  if (!G.armed) { G.armed = p; renderArmed(); say(`Armed ${G.view.nmap.get(p.node).label}.${p.port}: tap a lit port to connect, empty canvas to cancel`); return; }
  if (G.armed.node === p.node && G.armed.port === p.port && G.armed.dir === p.dir) { G.armed = null; renderArmed(); say('Disarmed'); return; }
  const a = G.armed; G.armed = null; renderArmed(); connect(a, p);
}
function pointer() {
  const pts = new Map(); let g = null; let lastTap = { id: null, t: 0 };
  const local = (e) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toWorld = (p) => ({ x: (p.x - V.x) / V.s, y: (p.y - V.y) / V.s });
  const locked = () => root.dataset.lock === 'on';
  // wheel pans until the content edge reaches the viewport edge, then the page scrolls (scroll chaining, no trap)
  vp.addEventListener('wheel', (e) => {
    const p = local(e);
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); return zoomAt(V.s * Math.exp(-e.deltaY * 0.01), p.x, p.y); }
    const b = bounds(), r = vp.getBoundingClientRect(); if (!b) return;
    const lim = (v, d, lo, hi) => { const n = v - d; return Math.min(Math.max(n, Math.min(lo, v)), Math.max(hi, v)); };
    const nx = lim(V.x, e.deltaX, r.width - 48 - b.x1 * V.s, 48 - b.x0 * V.s), ny = lim(V.y, e.deltaY, r.height - 48 - b.y1 * V.s, 48 - b.y0 * V.s);
    if (Math.abs(nx - V.x) < 0.5 && Math.abs(ny - V.y) < 0.5) return; // at the edge: let the page scroll
    e.preventDefault(); V.x = nx; V.y = ny; applyView();
  }, { passive: false });
  // touch-action: pan-y lets one finger scroll the page; with 2+ touches (or Interact on) we take the gesture
  vp.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || locked()) e.preventDefault(); }, { passive: false });
  vp.addEventListener('touchstart', (e) => { if (e.touches.length > 1 || locked()) root.classList.add('gx-touched'); else { root.classList.add('gx-hinting'); clearTimeout(vp.ht); vp.ht = setTimeout(() => root.classList.remove('gx-hinting'), 1600); } }, { passive: true });
  vp.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(glide.raf);
    if (e.target.closest('input, select, textarea')) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 2) { if (g) clearTimeout(g.lp); const [a, b] = [...pts.values()]; g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: V.s, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x0: V.x, y0: V.y }; return; }
    const port = e.target.closest('.gp'), badge = e.target.closest('.gb'), node = e.target.closest('.gn');
    g = { kind: port ? 'port' : badge ? 'badge' : node ? 'node' : 'pan', p0: local(e), x0: V.x, y0: V.y, moved: false, el: port || badge || node, touch: e.pointerType !== 'mouse', shift: e.shiftKey };
    if (g.kind === 'node') {
      const id = node.dataset.id, n = G.view.nmap.get(id), gg = g; gg.id = id; gg.n0 = { x: n.x, y: n.y };
      gg.lp = setTimeout(() => { if (g !== gg || gg.moved) return; gg.long = true; if (!G.multi) setMulti(true); if (!G.sel.has(id)) selectNode(id, { add: true, inspect: false }); say('Multi-select: tap more nodes, then Collapse to subgraph'); }, 500);
    }
    try { vp.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  });
  vp.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return; pts.set(e.pointerId, local(e));
    if (g.kind === 'pinch') { if (pts.size < 2) return; const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const s = Math.min(ZMAX, Math.max(zmin(), g.s0 * d / g.d0)); const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const k = s / g.s0; V.s = s; V.x = m.x - (g.m.x - g.x0) * k; V.y = m.y - (g.m.y - g.y0) * k; applyView(); return; }
    if (e.pointerType === 'touch' && !locked()) return; // one finger belongs to the page
    const p = local(e), dx = p.x - g.p0.x, dy = p.y - g.p0.y;
    if (!g.moved && Math.hypot(dx, dy) < 8) return;
    if (!g.moved) { g.moved = true; clearTimeout(g.lp); }
    if (g.kind === 'pan' || g.kind === 'badge') { const t = performance.now(); if (g.lt) { const k = Math.max(1, t - g.lt); g.vx = 0.7 * (g.vx || 0) + 0.3 * (g.x0 + dx - V.x) / k; g.vy = 0.7 * (g.vy || 0) + 0.3 * (g.y0 + dy - V.y) / k; } g.lt = t; V.x = g.x0 + dx; V.y = g.y0 + dy; applyView(); }
    else if (g.kind === 'node') moveNode(g.id, g.n0.x + dx / V.s, g.n0.y + dy / V.s);
    else if (g.kind === 'port') {
      if (!g.from) { g.from = portOf(g.el); G.armed = g.from; renderArmed(); }
      const end = { x: p.x, y: p.y - (g.touch ? 48 : 0) }; // the wire end sits above the finger so the target stays visible
      const snap = nearestPort(end, g.from); g.snap = snap;
      const n = G.view.nmap.get(g.from.node), s = anchor(n, g.from.dir, g.from.port), q = snap ? snap.world : toWorld(end);
      let tmp = svg.querySelector('.gw-drag'); if (!tmp) { tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tmp.setAttribute('class', 'gw-drag'); svg.append(tmp); }
      tmp.setAttribute('d', `M${s.x} ${s.y}L${q.x} ${q.y}`); tmp.classList.toggle('snap', !!snap);
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (!g) return; const gg = g; if (pts.size) return; g = null;
    clearTimeout(gg.lp);
    if (gg.kind === 'pinch') return;
    if (gg.kind === 'port' && gg.moved) { const tmp = svg.querySelector('.gw-drag'); if (tmp) tmp.remove(); G.armed = null; renderArmed(); if (gg.snap) connect(gg.from, gg.snap.port); else say('Wire dropped on empty canvas: cancelled'); return; }
    if (gg.moved && (gg.kind === 'pan' || gg.kind === 'badge')) return glide(gg);
    if (gg.moved || e.type === 'pointercancel') return;
    if (gg.kind === 'port') return tapPort(portOf(gg.el));
    if (gg.kind === 'badge') return selectWire(gg.el.dataset.wire);
    if (gg.kind === 'node') {
      if (gg.long) return;
      if (e.target.closest('input')) return;
      const now = performance.now();
      if (lastTap.id === gg.id && now - lastTap.t < 320) { lastTap = { id: null, t: 0 }; const n = G.view.nmap.get(gg.id); if (n.kind === 'component') return enter(gg.id); const r = vp.getBoundingClientRect(); V.s = 1.6; V.x = r.width / 2 - (n.x + W / 2) * V.s; V.y = 24 - n.y * V.s; applyView(); return; }
      lastTap = { id: gg.id, t: now };
      if (G.armed) { G.armed = null; renderArmed(); }
      return selectNode(gg.id, { add: G.multi || gg.shift });
    }
    if (gg.kind === 'pan') { if (G.armed) { G.armed = null; renderArmed(); say('Cancelled'); } else if (G.sel.size || G.wire) clearSel(); }
  };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
}
// momentum pan: px/ms velocity decays with a fixed time constant; off with reduced motion or a stale release
function glide(gg) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || performance.now() - (gg.lt || 0) > 80) return;
  let vx = gg.vx || 0, vy = gg.vy || 0, t0 = performance.now(); if (Math.hypot(vx, vy) < 0.15) return;
  const step = (t) => { const dt = Math.min(48, t - t0); t0 = t; const f = Math.exp(-dt / 325); V.x += vx * dt; V.y += vy * dt; vx *= f; vy *= f; applyView(); if (Math.hypot(vx, vy) > 0.02) glide.raf = requestAnimationFrame(step); };
  glide.raf = requestAnimationFrame(step);
}
function nearestPort(pt, from) {
  let best = null, bd = 24; // snap radius in screen px, measured to the port's whole button
  for (const n of G.view.nodes) {
    for (const q of [...n.ins, ...n.outs]) {
      const p = { node: n.id, port: q.name, dir: q.dir, type: q.type }; if (!rule(from, p).ok) continue;
      const w = anchor(n, q.dir, q.name), sy = w.y * V.s + V.y;
      const bx0 = (q.dir === 'in' ? n.x : n.x + W / 2) * V.s + V.x, bx1 = bx0 + (W / 2) * V.s, by0 = sy - (ROW / 2) * V.s, by1 = sy + (ROW / 2) * V.s;
      const d = Math.hypot(Math.max(bx0 - pt.x, 0, pt.x - bx1), Math.max(by0 - pt.y, 0, pt.y - by1));
      if (d < bd) { bd = d; best = { port: p, world: w }; }
    }
  }
  return best;
}

/* ---------------------------------------------------------------- fixture (performance budget) */
function makeFixture(nn = 150, nw = 300) {
  const kinds = ['track', 'tap', 'slot', 'hook', 'var', 'marker'], nodes = [], nmap = new Map(), types = ['pattern', 'signal', 'param', 'gate', 'hook'];
  for (let i = 0; i < nn; i++) {
    const kind = kinds[i % kinds.length];
    const n = { id: `fx:${i}`, kind, label: `${kind}${i}`, sub: kind, err: null, steps: kind === 'track' ? [['s', { $mini: 'bd*4' }], ['gain', 0.8], ['lpf', 800]] : null,
      ins: [{ name: 'a', type: 'param', label: 'a', dir: 'in' }, { name: 'b', type: 'pattern', label: 'b', dir: 'in' }], outs: [{ name: 'out', type: types[i % 5], label: 'out', dir: 'out' }, { name: 'x', type: 'signal', label: 'x', dir: 'out' }] };
    n.h = nodeH(n); n.x = Math.floor(i / 10) * COLW; n.y = (i % 10) * (n.h + GAP); nodes.push(n); nmap.set(n.id, n);
  }
  const wires = [];
  for (let k = 0; k < nw; k++) { const a = k % nn, b = (a + 10 + (k * 7) % 23) % nn; const o = nodes[a].outs[k % 2]; wires.push({ id: `fw:${k}`, type: o.type, from: { node: nodes[a].id, port: o.name }, to: { node: nodes[b].id, port: k % 2 ? 'a' : 'b' }, window: k % 9 === 0 ? '9b..17b' : '' }); }
  return { nodes, wires, nmap };
}

/* ---------------------------------------------------------------- boot + test/automation surface */
const host = document.getElementById('graph');
if (host) { await loadCss(); mount(host); }
const api = {
  get text() { return G.text; }, get model() { return G.model; }, get view() { return G.view; }, get armed() { return G.armed; }, get sel() { return [...G.sel]; }, get path() { return G.path.map((p) => p.label); }, get level() { return G.level; },
  V, DEMO, lib, undo, redo, fit,
  reset() { G.path = []; G.fixture = null; G.past = []; G.future = []; G.sel.clear(); G.wire = null; G.armed = null; G.pos = {}; store.set(POSKEY, {}); setMulti(false); closeSheet(); setText(DEMO); },
  zoomTo(s, x = 24, y = 24) { V.s = s; V.x = x; V.y = y; applyView(); },
  center(id, s = V.s) { const n = G.view.nmap.get(id); const r = vp.getBoundingClientRect(); V.s = s; V.x = r.width / 2 - (n.x + W / 2) * s; V.y = Math.min(r.height / 2, 140) - n.y * s; applyView(); },
  fixture(nn, nw) { G.fixture = makeFixture(nn, nw); G.sel.clear(); G.wire = null; closeSheet(); render(); }, clearFixture() { G.fixture = null; render(); },
  expand: (m) => expand(m, { lookup: (n, r) => lib.get(n, r) }), generate, parse,
};
sc.graph = api; window.__graph = api;
export default api;
