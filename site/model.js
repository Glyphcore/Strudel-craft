// Shared model (BLUEPRINT 1, 4.3, 4.4, 5): code <-> model, edit ops, graph projection, layout, canonical form and hash.
// Standalone ES module, no Strudel code. Parser: acorn (MIT) loaded unmodified from ./vendor/acorn-8.19.0.mjs, only when this module is imported.
// Lossless by construction: every layer statement keeps its verbatim `src` (including leading comments/blank lines) and is re-emitted as is
// while its structure still matches that text; edit ops splice the text, so only the touched statement changes.
import * as acorn from './vendor/acorn-8.19.0.mjs';
import * as AT from './engine/atoms.js';
import * as LD from './engine/lanes-data.js';

const LAYOUT_RE = /\/\/ @model-layout (\{[^\n]*\})\n?$/;
// string args are references, not mini-notation: plain strings (lanes: tags, bus names, capture names)
const REF_METHODS = new Set(['tap', 'use', 'wrap', 'ns', 'wire', 'tags', 'tag', 'send', 'ret', 'from', 'recall', 'capture', 'tagged']);
const ANON = /^\$\d*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const GATE_KEYS = new Set(['from', 'until', 'windows', 'period', 'when', 'latch', 'quant', 'unreached']);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : isObj(v)
  ? Object.fromEntries(Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => [k, sortKeys(v[k])])) : v;

// ---------------------------------------------------------------- canonical, hash
export const canonical = (model) => JSON.stringify(sortKeys(model));
export const serialize = (model) => JSON.stringify(sortKeys(model), null, 1) + '\n';
// The HOOKS_SYNTAX section 5 config keeps cps/cpb/bpb at the top level; the model holds them under `settings`. Version key is `model`.
export function fromConfig(cfg) {
  const m = clone(cfg);
  for (const k of ['cps', 'cpb', 'bpb']) if (k in m) { (m.settings ||= {})[k] = m[k]; delete m[k]; }
  return m;
}
export const load = (jsonText) => fromConfig(JSON.parse(jsonText));

function sha256hex(str) {
  const primes = []; for (let n = 2; primes.length < 64; n++) if (primes.every(p => n % p)) primes.push(n);
  const K = primes.map(p => Math.floor((Math.cbrt(p) % 1) * 2 ** 32));
  const H = primes.slice(0, 8).map(p => Math.floor((Math.sqrt(p) % 1) * 2 ** 32));
  const data = new TextEncoder().encode(str), len = data.length, total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total); buf.set(data); buf[len] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(total - 8, Math.floor(len * 8 / 2 ** 32)); dv.setUint32(total - 4, (len * 8) >>> 0);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n)), w = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] = (H[i] + x) >>> 0; });
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('');
}
export function hash(model) {
  const m = clone(model); delete m.layout;
  if (m.meta) { delete m.meta.rev; delete m.meta.hash; if (!Object.keys(m.meta).length) delete m.meta; }
  return sha256hex(canonical(m));
}

// ---------------------------------------------------------------- literal args <-> JS text
const parseJs = (text) => acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
const isStr = (n) => n && n.type === 'Literal' && typeof n.value === 'string';
const num = (n) => n.type === 'Literal' && typeof n.value === 'number' ? n.value
  : n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number'
    ? (n.operator === '-' ? -n.argument.value : n.argument.value) : undefined;
const tapRead = (n) => n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'tap' && n.arguments.length >= 1
  && n.arguments.length <= 2 && isStr(n.arguments[0]) && (n.arguments.length === 1 || n.arguments[1].type === 'ObjectExpression');
const hasCode = (v) => Array.isArray(v) ? v.some(hasCode) : isObj(v) ? ('$code' in v) || Object.values(v).some(hasCode) : false;

// ---------------------------------------------------------------- atoms (docs/ATOMS.md sections 4, 10)
// `atom(...)` declarations stay verbatim in the header (or in their statement) and are projected into `model.atoms` keyed by id;
// every static `atoms.*` reference becomes an { $atom: id, args?, ops? } ref, so a rename touches the declaration only.
// The document's atom environment is kept here so a track-level re-parse (trackSync) and generate() resolve the same references.
let ATOMS = null; // { env, ids: name -> id, names: id -> name }
const atomsIn = (text) => /\batom\s*\(|\batoms\s*\./.test(text);
function atomsFromCode(text) {
  if (!atomsIn(text)) return null;
  try {
    const lz = AT.lazyAtoms(text); // strict declaration prefix: indexed, evaluated only when read (docs/ATOMS.md, laziness)
    if (lz) return { env: lz.env, ids: lz.ids, names: lz.names, atoms: null, lazy: lz, prefixEnd: lz.end };
    const env = AT.buildEnv(text, {}, { diag: [] }), r = AT.reconcile({}, env);
    if (!Object.keys(r.atoms).length) return null;
    return { env, ids: r.ids, names: Object.fromEntries(Object.entries(r.atoms).map(([id, a]) => [id, a.name])), atoms: r.atoms };
  } catch { return null; }
}
function atomsFromModel(model) {
  const atoms = model.atoms || {}; if (!Object.keys(atoms).length) return null;
  try {
    return { env: AT.buildEnv('', { atoms }), ids: Object.fromEntries(Object.entries(atoms).map(([id, a]) => [a.name, id])),
      names: Object.fromEntries(Object.entries(atoms).map(([id, a]) => [id, a.name])), atoms };
  } catch { return null; }
}
const normAtomArgs = (v) => Array.isArray(v) ? v.map(normAtomArgs) : isObj(v)
  ? (v.$segs ? atomRefOf(v) || v : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normAtomArgs(x)]))) : v;
function atomRefOf(sg) { // { $segs } -> { $atom, args?, ops? } (ids, never names), or null
  if (!ATOMS) return null;
  try {
    const r = AT.toRef(ATOMS.env, sg), args = normAtomArgs(r.args), ops = normAtomArgs(r.ops);
    return { $atom: ATOMS.ids[r.$atom] || r.$atom, ...(Object.keys(args).length ? { args } : {}), ...(ops.length ? { ops } : {}) };
  } catch { return null; }
}
const atomRefNode = (n) => { const sg = ATOMS ? AT.refOfNode(n) : null; return sg ? atomRefOf(sg) : null; };
export const isAtomRef = (v) => isObj(v) && typeof v.$atom === 'string';
const atomKeys = (v) => Object.keys(v).every(k => ['$atom', 'args', 'ops'].includes(k));
function atomText(v) { // { $atom } -> `atoms.name(...)...` (the code form)
  const name = (ATOMS && ATOMS.names[v.$atom]) || v.$atom;
  const args = v.args && Object.keys(v.args).length ? `({ ${Object.keys(v.args).map(k => `${key(k)}: ${emitArg(v.args[k])}`).join(', ')} })` : '';
  const ops = (v.ops || []).map(([o, ...a]) => `.${o}(${a.map(x => emitArg(x)).join(', ')})`).join('');
  return `atoms.${name}${args}${ops}`;
}
// the compiled string of an atom reference, for positions the model keys by name (marker / scope / slot / def keys)
const atomStr = (v) => { try { return String(AT.resolve(ATOMS.env, { ...v, $atom: (ATOMS.names[v.$atom] || v.$atom) }).text); } catch { return null; } };
function emitAtomDecl(a) {
  const parts = [`type: ${JSON.stringify(a.type)}`];
  if (a.params) parts.push(`params: ${emitArg(a.params)}`);
  if (a.from) parts.push(`from: ${atomText({ $atom: a.from.atom, args: a.from.args, ops: a.from.ops })}`);
  else parts.push(`body: ${emitArg(a.body)}`);
  if (a.doc) parts.push(`doc: ${JSON.stringify(a.doc)}`);
  if (a.tags) parts.push(`tags: ${emitArg(a.tags)}`);
  return `atom(${JSON.stringify(a.name)}, { ${parts.join(', ')} })`;
}

function parseArg(n, text, mode) {
  const code = () => ({ $code: text.slice(n.start, n.end) });
  if (n.type === 'Literal') {
    if (typeof n.value === 'string') return mode === 'mini' && text[n.start] === '"' ? { $mini: n.value } : n.value;
    if (n.value === null || typeof n.value === 'number' || typeof n.value === 'boolean') return n.value;
    return code();
  }
  const x = num(n); if (x !== undefined) return x;
  if (n.type === 'ArrayExpression') return n.elements.every(e => e && e.type !== 'SpreadElement') ? n.elements.map(e => parseArg(e, text, 'plain')) : code();
  if (n.type === 'ObjectExpression') {
    const o = {};
    for (const p of n.properties) {
      if (p.type !== 'Property' || p.kind !== 'init' || p.computed || p.method) return code();
      const k = p.key.type === 'Identifier' ? p.key.name : (p.key.type === 'Literal' ? String(p.key.value) : null);
      if (k === null) return code();
      o[k] = parseArg(p.value, text, 'plain');
    }
    return o;
  }
  if (tapRead(n)) {
    const r = { $tap: n.arguments[0].value };
    if (n.arguments[1]) { const o = parseArg(n.arguments[1], text, 'plain'); if (hasCode(o)) return code(); r.opts = o; }
    return r;
  }
  { const ar = atomRefNode(n); if (ar) return ar; }
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name === 'range'
    && n.arguments.length === 2 && tapRead(n.callee.object)) {
    const lo = num(n.arguments[0]), hi = num(n.arguments[1]), r = parseArg(n.callee.object, text, 'plain');
    if (lo !== undefined && hi !== undefined && r.$tap !== undefined) return { ...r, range: [lo, hi] };
  }
  return code();
}

const key = (k) => IDENT.test(k) ? k : JSON.stringify(k);
// sq: top-level plain strings of ordinary (non-reference) methods are single-quoted so they are never read as mini-notation
function emitArg(v, sq = false) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return sq ? "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'" : JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(x => emitArg(x)).join(', ') + ']';
  const ks = Object.keys(v).filter(k => v[k] !== undefined);
  if (ks.length === 1 && ks[0] === '$code') return v.$code;
  if (ks.length === 1 && ks[0] === '$mini') return JSON.stringify(v.$mini);
  if (typeof v.$atom === 'string' && atomKeys(v)) return atomText(v);
  if (v.$tap !== undefined && ks.every(k => ['$tap', 'opts', 'range'].includes(k))) {
    return `tap(${JSON.stringify(v.$tap)}${v.opts ? ', ' + emitArg(v.opts) : ''})${v.range ? `.range(${v.range.map(x => emitArg(x)).join(', ')})` : ''}`;
  }
  return ks.length ? '{ ' + ks.map(k => `${key(k)}: ${emitArg(v[k])}`).join(', ') + ' }' : '{}';
}
const emitStep = (s) => `${s[0]}(${s.slice(1).map(a => emitArg(a, !REF_METHODS.has(s[0]))).join(', ')})`;
// replacement text for one literal, keeping the quote character that was in the source
function emitLike(v, old) {
  if (typeof v === 'string') { const q = old[0]; return q === '"' ? JSON.stringify(v) : q === "'" ? emitArg(v, true) : JSON.stringify(v); }
  if (isObj(v) && '$mini' in v) return JSON.stringify(v.$mini);
  return emitArg(v);
}

// ---------------------------------------------------------------- AST scans
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) { const c = node[k]; if (Array.isArray(c)) c.forEach(x => walk(x, fn)); else if (c && typeof c.type === 'string') walk(c, fn); }
}
// tap reads / publishes / slot uses found in program text; AST first, regex when the text does not parse
function scanText(text) {
  const p = { reads: [], publishes: [], slots: [] };
  try {
    walk(parseJs(text), (n) => {
      if (n.type !== 'CallExpression' || !isStr(n.arguments[0])) return;
      const v = n.arguments[0].value;
      if (n.callee.type === 'Identifier' && n.callee.name === 'tap') p.reads.push(v);
      else if (n.callee.type === 'MemberExpression' && !n.callee.computed) {
        const m = n.callee.property.name;
        if (m === 'tap') p.publishes.push(v); else if (m === 'use' || m === 'wrap') p.slots.push(v);
      }
    });
  } catch {
    for (const m of text.matchAll(/(^|[^.\w$])tap\(\s*["'`]([^"'`]+)["'`]/g)) p.reads.push(m[2]);
    for (const m of text.matchAll(/\.tap\(\s*["'`]([^"'`]+)["'`]/g)) p.publishes.push(m[1]);
    for (const m of text.matchAll(/\.(?:use|wrap)\(\s*["'`]([^"'`]+)["'`]/g)) p.slots.push(m[1]);
  }
  return p;
}

// ---------------------------------------------------------------- lanes (docs/LANES.md section 10, issue #77)
// Derived from the chain, so a no-edit round trip never depends on them: tracks[].tags / split / sends / ret, buses, selections[], captures,
// settings.lanes. Header statements (`tagged(...)...`, `capture(...)`, `lanes.closed()`) are absorbed like the hooks registry (kept verbatim in hookSrc).
const strOf = (v) => (typeof v === 'string' ? v : isAtomRef(v) ? atomStr(v) : null);
const isFnCode = (v) => isObj(v) && typeof v.$code === 'string' && /^\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>|^\s*function\b/.test(v.$code);
// `w => w.room(0.8).lpf(900)` -> { param, chain } (chain null when the body is not a plain method chain on the parameter); src is kept verbatim
function fnChain(code) {
  const out = { src: code, param: null, chain: null };
  let ast; try { ast = parseJs('(' + code + ')'); } catch { return out; }
  const f = ast.body[0] && ast.body[0].expression;
  if (!f || f.type !== 'ArrowFunctionExpression' || f.params.length !== 1 || f.params[0].type !== 'Identifier') return out;
  out.param = f.params[0].name;
  const text = '(' + code + ')'; const calls = []; let cur = f.body;
  while (cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression' && !cur.callee.computed && cur.callee.property.type === 'Identifier') { calls.push(cur); cur = cur.callee.object; }
  if (cur.type !== 'Identifier' || cur.name !== out.param || calls.some(c => c.arguments.some(a => a.type === 'SpreadElement'))) return out;
  out.chain = calls.reverse().map(c => [c.callee.property.name, ...c.arguments.map(a => parseArg(a, text, REF_METHODS.has(c.callee.property.name) ? 'plain' : 'mini'))]);
  return out;
}
const fnvId = LD.fnvId;
// the lane record of one track (tags, split with branch sub-chains, sends, ret); layer = statement index (ids are first-sight path hashes)
function laneOf(t, layer, prev) {
  const out = {}, steps = t.chain || [], tags = [], sends = [];
  steps.forEach((s) => {
    if (s[0] === 'tags' || s[0] === 'tag') for (const a of s.slice(1)) { const v = strOf(a); if (v && !tags.includes(v)) tags.push(v); }
    else if (s[0] === 'send') { const bus = strOf(s[1]); if (bus) sends.push({ bus, amount: typeof s[2] === 'number' ? s[2] : 1 }); }
  });
  if (tags.length) out.tags = tags;
  if (sends.length) out.sends = sends;
  if (t.source && t.source[0] === 'ret' && strOf(t.source[1])) out.ret = strOf(t.source[1]);
  const si = steps.findIndex((s) => s[0] === 'split');
  if (si >= 0) {
    const args = steps[si].slice(1), root = t.source ? t.source[0] : '';
    const site = (prev && prev.site) || fnvId('split', `L${layer ?? 0}/${[root, ...steps.slice(0, si + 1).map((s) => s[0])].join('.')}`);
    const branches = []; let opts = null;
    args.forEach((a, j) => { if (isFnCode(a)) branches.push({ id: fnvId('branch', `${site}#${j}`), ...fnChain(a.$code) }); else if (isObj(a) && !hasCode(a)) opts = a; });
    const sp = { site, at: si, branches };
    const mg = steps[si + 1] && steps[si + 1][0] === 'merge' ? steps[si + 1] : null;
    if (mg) sp.merge = mg[1] && isFnCode(mg[1]) ? { id: fnvId('branch', `${site}#m`), ...fnChain(mg[1].$code) } : true;
    if (opts && Array.isArray(opts.mix)) sp.mix = opts.mix;
    if (opts && typeof opts.pre === 'boolean') sp.pre = opts.pre;
    out.split = sp;
  }
  return out;
}
const LANE_KEYS = ['tags', 'split', 'sends', 'ret'];
function setLane(t, layer) {
  const prev = t.split; for (const k of LANE_KEYS) delete t[k];
  if (t.chain == null && t.source == null) return;
  Object.assign(t, laneOf(t, layer, prev));
}
const hasLaneSteps = (t) => LANE_KEYS.some((k) => t[k] !== undefined) || (t.chain || []).some((s) => ['tags', 'tag', 'send', 'split'].includes(s[0])) || (t.source && t.source[0] === 'ret');
// buses (name -> { returns: [track] }) are recomputed from the tracks and selections, never stored by hand
function syncBuses(m) {
  const buses = {};
  for (const t of m.tracks || []) {
    for (const s of t.sends || []) (buses[s.bus] ||= { returns: [] });
    if (t.ret) (buses[t.ret] ||= { returns: [] }).returns.push(t.name);
  }
  for (const sel of m.selections || []) for (const o of sel.ops || []) { const b = o.op === 'send' ? strOf(o.bus) : null; if (b) buses[b] ||= { returns: [] }; }
  if (Object.keys(buses).length) m.buses = buses; else delete m.buses;
}
function syncLanes(m) {
  (m.tracks || []).forEach((t, i) => { if (hasLaneSteps(t)) setLane(t, i + (m.hookSrc || []).filter(h => h.at <= i).length); });
  syncBuses(m);
}
const SEL_OP_SET = new Set(LD.SEL_OPS);
// `tagged("sel").op(args)...` -> { id, selector, ops: [{ op, ... }] } in the shape the hooks runtime serialises (lanes.js toJSON), or null
function selectionOf(e, text, layer) {
  const calls = []; let cur = e;
  while (cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression' && !cur.callee.computed && cur.callee.property.type === 'Identifier') { calls.push(cur); cur = cur.callee.object; }
  if (cur.type !== 'CallExpression' || cur.callee.type !== 'Identifier' || cur.callee.name !== 'tagged' || cur.arguments.length !== 1 || !calls.length) return null;
  if (calls.some(c => c.arguments.some(a => a.type === 'SpreadElement') || !SEL_OP_SET.has(c.callee.property.name))) return null;
  const selector = parseArg(cur.arguments[0], text, 'plain'); if (strOf(selector) === null) return null;
  const ops = [];
  for (const c of calls.reverse()) {
    const op = c.callee.property.name, a = c.arguments.map(x => parseArg(x, text, 'plain'));
    if (op === 'fx') { if (a.length !== 1 || !isObj(a[0]) || !a[0].$code) return null; ops.push({ op, opaque: true, src: a[0].$code }); }
    else if (op === 'gain' || op === 'orbit') { if (a.length !== 1) return null; ops.push({ op, value: a[0] }); }
    else if (op === 'mute' || op === 'solo') { if (a.length > 1 || hasCode(a)) return null; ops.push(a[0] === undefined || a[0] === true ? { op } : a[0] === false ? { op, on: false } : { op, gate: a[0] }); }
    else if (op === 'send') { if (a.length < 1 || a.length > 2 || strOf(a[0]) === null || hasCode(a)) return null; ops.push({ op, bus: a[0], ...(a[1] !== undefined ? { amount: a[1] } : {}) }); }
    else { if (a.length < 1 || a.length > 2 || strOf(a[0]) === null || hasCode(a) || (a[1] !== undefined && !isObj(a[1]))) return null; ops.push({ op, name: a[0], ...(a[1] ? { opts: a[1] } : {}) }); }
  }
  const g = ops.find(o => (o.op === 'mute' || o.op === 'solo') && o.gate !== undefined);
  return { id: fnvId('selection', `L${layer}/tagged`), selector, ops, ...(g ? { gate: g.gate } : {}) };
}
// returns true when the statement was absorbed into settings.lanes / selections / captures of `m`
function analyseLanes(st, text, m, layer) {
  if (st.type !== 'ExpressionStatement' || st.expression.type !== 'CallExpression') return false;
  const e = st.expression, c = e.callee;
  if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'lanes' && (c.property.name === 'closed' || c.property.name === 'open') && !e.arguments.length) {
    (m.settings ||= {}).lanes = c.property.name; return true;
  }
  if (c.type === 'Identifier' && c.name === 'capture' && e.arguments.length >= 2 && e.arguments.length <= 3 && isStr(e.arguments[0])) {
    const a = e.arguments.map(x => parseArg(x, text, 'plain')), name = a[0];
    if (strOf(a[1]) === null || (a[2] !== undefined && (!isObj(a[2]) || hasCode(a[2]) || Object.keys(a[2]).some(k => !['window', 'last', 'what', 'live', 'max'].includes(k))))) return false;
    if ((m.captures || {})[name]) return false;
    (m.captures ||= {})[name] = { picker: a[1], ...(a[2] || {}) }; return true;
  }
  const sel = selectionOf(e, text, layer); if (!sel) return false;
  (m.selections ||= []).push(sel); return true;
}
const emitSelection = (sel) => `tagged(${emitArg(sel.selector)})` + (sel.ops || []).map((o) => {
  if (o.op === 'fx') return `.fx(${o.src})`;
  if (o.op === 'gain' || o.op === 'orbit') return `.${o.op}(${emitArg(o.value)})`;
  if (o.op === 'mute' || o.op === 'solo') return `.${o.op}(${o.on === false ? 'false' : o.gate !== undefined ? emitArg(o.gate) : ''})`;
  if (o.op === 'send') return `.send(${emitArg(o.bus)}${o.amount !== undefined ? ', ' + emitArg(o.amount) : ''})`;
  return `.${o.op}(${emitArg(o.name)}${o.opts ? ', ' + emitArg(o.opts) : ''})`;
}).join('');
const emitCapture = (name, c) => { const { picker, ...opts } = c; return `capture(${JSON.stringify(name)}, ${emitArg(picker)}${Object.keys(opts).length ? ', ' + emitArg(opts) : ''})`; };

// ---------------------------------------------------------------- statement analysis
function analyseLayer(st, text) {
  if (st.type !== 'LabeledStatement' || st.body.type !== 'ExpressionStatement') return null;
  let label = st.label.name, muted = false;
  if (label.length > 1 && label[0] === '_') { muted = true; label = label.slice(1); }
  const calls = []; let cur = st.body.expression;
  while (cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression' && !cur.callee.computed && !cur.optional && cur.callee.property.type === 'Identifier') {
    calls.push(cur); cur = cur.callee.object;
  }
  const root = cur;
  if (root.type !== 'CallExpression' || root.callee.type !== 'Identifier') return null;
  if ([root, ...calls].some(c => c.arguments.some(a => a.type === 'SpreadElement'))) return null;
  calls.reverse();
  let nsCall = null, main = calls;
  const last = calls[calls.length - 1];
  if (last && last.callee.property.name === 'ns' && last.arguments.length === 1 && isStr(last.arguments[0])) { nsCall = last; main = calls.slice(0, -1); }
  const step = (call, method) => [method, ...call.arguments.map(a => parseArg(a, text, REF_METHODS.has(method) ? 'plain' : 'mini'))];
  const out = {
    name: label === '$' ? null : label, muted, source: step(root, root.callee.name),
    chain: main.map(c => step(c, c.callee.property.name)),
  };
  if (nsCall) out.ns = nsCall.arguments[0].value;
  out.spans = {
    root: root.arguments.map(a => ({ start: a.start, end: a.end })),
    calls: main.map(c => ({ objEnd: c.callee.object.end, end: c.end, args: c.arguments.map(a => ({ start: a.start, end: a.end })) })),
    chainEnd: main.length ? main[main.length - 1].end : root.end,
  };
  return out;
}
function analyseInst(st, text) {
  if (st.type !== 'LabeledStatement' || st.body.type !== 'ExpressionStatement') return null;
  const e = st.body.expression;
  if (e.type !== 'CallExpression' || e.callee.type !== 'MemberExpression' || e.callee.object.name !== 'hooks' || e.callee.property.name !== 'inst') return null;
  if (e.arguments.length < 1 || e.arguments.length > 2 || !isStr(e.arguments[0])) return null;
  const o = e.arguments[1] ? parseArg(e.arguments[1], text, 'plain') : {};
  if (!isObj(o) || hasCode(o) || typeof o.as !== 'string' || Object.keys(o).some(k => !['as', 'args', 'gate', 'remap'].includes(k))) return null;
  return { component: e.arguments[0].value, ...o };
}
const gateOpts = (rest) => {
  const a = rest.filter(x => x !== undefined);
  let gate, opts = {};
  if (a.length && (typeof a[0] === 'string' || isAtomRef(a[0]) || (isObj(a[0]) && Object.keys(a[0]).some(k => GATE_KEYS.has(k))))) gate = a.shift();
  if (a.length && isObj(a[0])) opts = a.shift();
  if (a.length) return null;
  return { gate, opts };
};
// returns true when the statement was absorbed into the registry keys of `m`
function analyseRegistry(st, text, m) {
  if (st.type !== 'ExpressionStatement') return false;
  const e = st.expression;
  if (e.type !== 'CallExpression' || e.callee.type !== 'MemberExpression' || e.callee.computed || e.callee.object.name !== 'hooks') return false;
  if (e.arguments.some(a => a.type === 'SpreadElement')) return false;
  const fn = e.callee.property.name, a = e.arguments.map(x => parseArg(x, text, 'plain'));
  const okObj = (o, keys) => isObj(o) && Object.keys(o).every(k => keys.includes(k));
  if (fn !== 'let' && hasCode(a)) return false;
  // names the model uses as a key (marker / scope / slot) may be written as a `name` atom: the key is the compiled string, the value keeps its ref
  const nameOf = (v) => (typeof v === 'string' ? v : isAtomRef(v) ? atomStr(v) : null);
  if (fn === 'marker' && a.length === 2 && nameOf(a[0]) && (['string', 'number'].includes(typeof a[1]) || isAtomRef(a[1]))) { (m.markers ||= {})[nameOf(a[0])] = a[1]; return true; }
  if (fn === 'scope' && a.length >= 1 && nameOf(a[0]) && (a[1] === undefined || okObj(a[1], ['stem', 'bus']))) { (m.scopes ||= {})[nameOf(a[0])] = a[1] || {}; return true; }
  if (fn === 'slot' && a.length >= 1 && nameOf(a[0]) && (a[1] === undefined || okObj(a[1], ['mode', 'else', 'quant']))) { (m.slots ||= {})[nameOf(a[0])] = a[1] || {}; return true; }
  if (fn === 'def' && a.length === 2 && typeof a[0] === 'string' && okObj(a[1], ['params', 'taps', 'chain', 'decorator', 'opaque', 'src'])) { (m.defs ||= {})[a[0]] = a[1]; return true; }
  if (fn === 'let' && a.length >= 2 && a.length <= 4 && nameOf(a[0])) {
    const g = gateOpts(a.slice(2)); if (!g || !okObj(g.opts, ['priority', 'min', 'max', 'unit', 'ns'])) return false;
    if (hasCode(g.gate) || hasCode(g.opts)) return false;
    (((m.vars ||= {})[nameOf(a[0])]) ||= []).push({ value: a[1], ...(g.gate !== undefined ? { gate: g.gate } : {}), ...g.opts }); return true;
  }
  if (fn === 'bind' && a.length >= 2 && a.length <= 4 && (typeof a[0] === 'string' || isAtomRef(a[0])) && (typeof a[1] === 'string' || isAtomRef(a[1]))) {
    const g = gateOpts(a.slice(2)); if (!g || !okObj(g.opts, ['id', 'args', 'order', 'priority', 'else', 'rebase'])) return false;
    (m.bindings ||= []).push({ slot: a[0], hook: a[1], ...(g.gate !== undefined ? { gate: g.gate } : {}), ...g.opts }); return true;
  }
  return false;
}

// ---------------------------------------------------------------- parse
export function parse(text) {
  const m = { model: 1 };
  let body = text;
  const lm = LAYOUT_RE.exec(text);
  if (lm && (lm.index === 0 || text[lm.index - 1] === '\n')) {
    try { m.layout = JSON.parse(lm[1]); body = text.slice(0, lm.index); } catch { /* keep as code */ }
  }
  let ast;
  const prevAtoms = ATOMS; ATOMS = atomsFromCode(body); // `atom(...)` declarations -> model.atoms; references resolve to ids below
  const lazyEnd = ATOMS && ATOMS.lazy ? ATOMS.prefixEnd : 0; // lazy declaration prefix: kept verbatim in the header, never handed to the JS parser
  try { ast = lazyEnd ? new acorn.Parser({ ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }, body, lazyEnd).parse() : parseJs(body); } catch { ATOMS = prevAtoms; if (body) m.header = body; return m; }
  if (ATOMS) m.atoms = ATOMS.lazy ? ATOMS.lazy.makeAtoms() : clone(ATOMS.atoms);
  let header = lazyEnd ? body.slice(0, lazyEnd) : '', structural = false, pos = lazyEnd, codeN = 0;
  const n = ast.body.length;
  ast.body.forEach((st, i) => {
    const last = i === n - 1;
    const stmtEnd = st.end + (body[st.end] === '\r' && body[st.end + 1] === '\n' ? 2 : body[st.end] === '\n' ? 1 : 0);
    if (analyseRegistry(st, body, m) || (() => { const inst = analyseInst(st, body); if (inst) (m.instances ||= []).push(inst); return !!inst; })() || analyseLanes(st, body, m, i)) {
      // keep the statement's verbatim text and its position among the layers, so a no-edit generate() moves nothing
      const end = last ? body.length : stmtEnd;
      (m.hookSrc ||= []).push({ at: (m.tracks || []).length, src: body.slice(pos, end) });
      structural = true; pos = end; return;
    }
    const segEnd = last ? body.length : st.end, src = body.slice(pos, segEnd);
    pos = segEnd;
    const layer = analyseLayer(st, body);
    if (layer) {
      structural = true;
      const t = { name: layer.name ?? '$' + (1 + (m.tracks || []).filter(x => ANON.test(x.name)).length), source: layer.source, chain: layer.chain };
      if (layer.ns) t.ns = layer.ns;
      if (layer.muted) t.muted = true;
      t.src = src;
      setLane(t, i);
      (m.tracks ||= []).push(t);
    } else if (!structural && st.type !== 'LabeledStatement') header += src;
    else {
      structural = true;
      const lab = st.type === 'LabeledStatement' && st.label.name !== '$' ? st.label.name.replace(/^_(?=.)/, '') : null;
      const t = { name: lab || 'code' + (++codeN), src };
      if (st.type === 'LabeledStatement' && st.label.name.length > 1 && st.label.name[0] === '_') t.muted = true;
      (m.tracks ||= []).push(t);
    }
  });
  if (!n) header = body;
  else if (pos < body.length && !structural) header += body.slice(pos);
  if (header) m.header = header;
  if (m.tracks || m.selections) syncBuses(m);
  return m;
}

// ---------------------------------------------------------------- generate
function trackSync(t) {
  if (typeof t.src !== 'string') return null;
  let ast; try { ast = parseJs(t.src); } catch { return null; }
  if (ast.body.length !== 1) return null;
  const a = analyseLayer(ast.body[0], t.src);
  if (!a) return (t.chain == null && t.source == null) ? { opaque: true } : null;
  const same = (x, y) => JSON.stringify(sortKeys(x)) === JSON.stringify(sortKeys(y));
  const nameOk = a.name === null ? ANON.test(t.name) : a.name === t.name;
  if (!nameOk || !!a.muted !== !!t.muted || (a.ns || undefined) !== (t.ns || undefined) || !same(a.source, t.source) || !same(a.chain, t.chain || [])) return null;
  return a;
}
function emitTrack(t) {
  const label = (t.muted ? '_' : '') + (ANON.test(t.name) ? '$' : t.name) + ': ';
  if (!t.source) return label + 'silence';
  let s = label + emitStep(t.source);
  for (const c of t.chain || []) s += '.' + emitStep(c);
  if (t.ns) s += '.ns(' + JSON.stringify(t.ns) + ')';
  return s;
}
const REG_KEYS = ['markers', 'scopes', 'slots', 'defs', 'vars', 'bindings', 'instances'];
// the registry the kept hook statements (model.hookSrc) say: re-analysed from their text with the document's atom environment
function hookRegistry(list, text) {
  const m = {};
  for (const h of list) {
    let ast; try { ast = parseJs(h.src); } catch { return null; }
    for (const st of ast.body) {
      if (analyseRegistry(st, h.src, m)) continue;
      const inst = analyseInst(st, h.src);
      if (!inst) { if (analyseLanes(st, h.src, m, 0)) continue; return null; }
      (m.instances ||= []).push(inst);
    }
  }
  return m;
}
// hookSrc is used only while it still describes the model's registry exactly; any op that touched a hook statement makes it stale and the canonical form is emitted
function hooksVerbatim(model) {
  const list = model.hookSrc; if (!Array.isArray(list) || !list.length) return false;
  const m = hookRegistry(list); if (!m) return false;
  const pick = (x) => JSON.stringify(sortKeys([...REG_KEYS.map(k => x[k] && Object.keys(x[k]).length !== 0 ? x[k] : undefined),
    x.selections && x.selections.length ? x.selections.map(({ id, ...s }) => s) : undefined, x.captures && Object.keys(x.captures).length ? x.captures : undefined, x.settings && x.settings.lanes]));
  return pick(m) === pick(model);
}
export function generate(model) {
  ATOMS = atomsFromModel(model);
  let out = model.header || '';
  const sep = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const line = (s) => { sep(); out += s + '\n'; };
  const call = (fn, ...args) => `hooks.${fn}(${args.map(a => emitArg(a)).join(', ')})`;
  // atom declarations: emitted only when the kept text does not already declare them (then the text is re-emitted verbatim)
  if (ATOMS) {
    const text = (model.header || '') + (model.tracks || []).map(t => t.src || '').join('\n');
    const declared = new Set([...text.matchAll(/\batom\s*\(\s*["']([^"']+)["']/g)].map(x => x[1]));
    for (const a of Object.values(model.atoms)) if (!declared.has(a.name)) line(emitAtomDecl(a));
  }
  const keep = hooksVerbatim(model);
  if (!keep) {
  for (const [k, v] of Object.entries(model.markers || {})) line(call('marker', k, v));
  for (const [k, v] of Object.entries(model.scopes || {})) line(call('scope', k, v));
  for (const [k, v] of Object.entries(model.slots || {})) line(call('slot', k, v));
  for (const [k, v] of Object.entries(model.defs || {})) {
    if (v.opaque && v.src) { const { opaque, src, ...rest } = v; line(`hooks.def(${JSON.stringify(k)}, { ${[...Object.entries(rest).map(([a, b]) => `${key(a)}: ${emitArg(b)}`), `apply: ${src}`].join(', ')} })`); } else line(call('def', k, v));
  }
  for (const [k, list] of Object.entries(model.vars || {})) {
    for (const { value, gate, ...opts } of list) {
      const args = [k, value]; const has = Object.keys(opts).length;
      if (gate !== undefined || has) args.push(gate !== undefined ? gate : '*');
      if (has) args.push(opts);
      line(call('let', ...args));
    }
  }
  for (const b of model.bindings || []) {
    const { slot, hook, gate, ...opts } = b; const has = Object.keys(opts).length, args = [slot, hook];
    if (gate !== undefined || has) args.push(gate !== undefined ? gate : '*');
    if (has) args.push(opts);
    line(call('bind', ...args));
  }
  for (const i of model.instances || []) {
    const { component, ...rest } = i; line('$: ' + call('inst', component, { as: rest.as, ...rest }));
  }
  if (model.settings && model.settings.lanes) line(`lanes.${model.settings.lanes}()`);
  for (const [k, c] of Object.entries(model.captures || {})) line(emitCapture(k, c));
  for (const sel of model.selections || []) line(emitSelection(sel));
  }
  const kept = (i) => { if (keep) for (const h of model.hookSrc) if (h.at === i) out += h.src; };
  (model.tracks || []).forEach((t, i) => {
    kept(i);
    const sync = trackSync(t);
    if (sync) out += t.src; else line(emitTrack(t));
  });
  if (keep) for (const h of model.hookSrc) if (h.at >= (model.tracks || []).length) out += h.src;
  if (model.layout && Object.keys(model.layout).length) {
    sep(); out += '// @model-layout ' + JSON.stringify(sortKeys(model.layout)) + '\n';
  }
  return out;
}

// ---------------------------------------------------------------- edit ops
const findTrack = (m, name) => { const t = (m.tracks || []).find(x => x.name === name); if (!t) throw new Error(`E_NO_TRACK ${name}`); return t; };
function layerEdit(t, edit) {
  // text-backed: splice the verbatim src and re-derive the structure from it; otherwise edit the structure
  if (t.src !== undefined && !trackSync(t)) delete t.src;
  if (t.src === undefined) return false;
  const a = trackSync(t);
  if (a.opaque) throw new Error('E_OPAQUE_TRACK ' + t.name);
  const src = edit(a, t.src);
  const ast = parseJs(src), n = analyseLayer(ast.body[0], src);
  t.source = n.source; t.chain = n.chain; if (n.ns) t.ns = n.ns; else delete t.ns; t.src = src;
  return true;
}
const splice = (s, from, to, ins) => s.slice(0, from) + ins + s.slice(to);
function insertStep(t, index, step) {
  const len = (t.chain || []).length; if (index < 0 || index > len) throw new Error('E_RANGE');
  if (!layerEdit(t, (a, src) => { const at = index === len ? a.spans.chainEnd : a.spans.calls[index].objEnd; return splice(src, at, at, '.' + emitStep(step)); })) (t.chain ||= []).splice(index, 0, step);
}
function removeStep(t, index) {
  if (index < 0 || index >= (t.chain || []).length) throw new Error('E_RANGE');
  if (!layerEdit(t, (a, src) => splice(src, a.spans.calls[index].objEnd, a.spans.calls[index].end, ''))) t.chain.splice(index, 1);
}
export function applyOp(model, op) {
  const m = clone(model);
  switch (op.op) {
    case 'bind': {
      const { op: _o, ...b } = op; (m.bindings ||= []).push(clone(b)); break;
    }
    case 'unbind': {
      const i = (m.bindings || []).findIndex((b, j) => (b.id || `b${j + 1}`) === op.binding); if (i < 0) throw new Error('E_NO_BINDING');
      m.bindings.splice(i, 1); break;
    }
    case 'setGate': {
      const i = (m.bindings || []).findIndex((b, j) => (b.id || `b${j + 1}`) === op.binding); if (i < 0) throw new Error('E_NO_BINDING');
      m.bindings[i].gate = clone(op.gate); break;
    }
    case 'addWire': insertStep(findTrack(m, op.track), (findTrack(m, op.track).chain || []).length, ['wire', op.param, op.tap, ...(op.opts ? [op.opts] : [])]); break;
    case 'insertStep': insertStep(findTrack(m, op.track), op.index, op.step); break;
    case 'removeStep': removeStep(findTrack(m, op.track), op.index); break;
    case 'moveStep': { const t = findTrack(m, op.track), s = clone(t.chain[op.from]); removeStep(t, op.from); insertStep(t, op.to, s); break; }
    case 'literal': {
      if (op.marker) { if (!(op.marker in (m.markers || {}))) throw new Error('E_NO_MARKER'); m.markers[op.marker] = op.value; break; }
      if (op.var) { const l = (m.vars || {})[op.var]; if (!l || !l[op.index || 0]) throw new Error('E_NO_VAR'); l[op.index || 0].value = op.value; break; }
      const t = findTrack(m, op.track), si = op.step === 'source' ? -1 : op.step, step = si < 0 ? t.source : (t.chain || [])[si];
      if (!step || op.arg + 1 >= step.length) throw new Error('E_RANGE');
      if (!layerEdit(t, (a, src) => {
        const sp = si < 0 ? a.spans.root[op.arg] : a.spans.calls[si].args[op.arg];
        return splice(src, sp.start, sp.end, emitLike(op.value, src.slice(sp.start, sp.end)));
      })) step[op.arg + 1] = op.value;
      break;
    }
    // lanes (docs/LANES.md section 10): each touches one statement only
    case 'addBranch': { // { track, fn: 'g => g.crush(5)', index? }: a new branch callback in the lane's .split(...) argument list
      const t = findTrack(m, op.track), si = (t.chain || []).findIndex((s) => s[0] === 'split'); if (si < 0) throw new Error('E_NO_SPLIT ' + op.track);
      if (typeof op.fn !== 'string' || !isFnCode({ $code: op.fn })) throw new Error('E_BAD_ARG branch needs a function text such as "g => g.room(0.5)"');
      const fnIdx = t.chain[si].map((a, j) => (j > 0 && isFnCode(a) ? j - 1 : -1)).filter((j) => j >= 0), at = op.index === undefined ? fnIdx.length : op.index;
      if (at < 0 || at > fnIdx.length) throw new Error('E_RANGE');
      if (!layerEdit(t, (a, src) => {
        const sp = a.spans.calls[si], args = sp.args, before = at < fnIdx.length ? args[fnIdx[at]] : null;
        if (before) return splice(src, before.start, before.start, op.fn + ', ');
        if (!args.length) return splice(src, sp.end - 1, sp.end - 1, op.fn);
        const last = fnIdx.length ? args[fnIdx[fnIdx.length - 1]] : null;
        return last ? splice(src, last.end, last.end, ', ' + op.fn) : splice(src, args[0].start, args[0].start, op.fn + ', ');
      })) { const tail = t.chain[si].slice(1); const k = at < fnIdx.length ? fnIdx[at] : (fnIdx.length ? fnIdx[fnIdx.length - 1] + 1 : 0); tail.splice(k, 0, { $code: op.fn }); t.chain[si] = [t.chain[si][0], ...tail]; }
      break;
    }
    case 'exportTap': { // { track, tap }: publish `tap` as an exported lane-level tap just before the split (or at the end of the chain)
      const t = findTrack(m, op.track), si = (t.chain || []).findIndex((s) => s[0] === 'split'), at = si < 0 ? (t.chain || []).length : si;
      if ((t.chain || []).some((s) => s[0] === 'tap' && s[1] === op.tap)) throw new Error('E_TAP_EXISTS ' + op.tap);
      insertStep(t, at, ['tap', op.tap, { export: true }]); break;
    }
    case 'addSend': { // { track, bus, amount? }: one `.send(bus, amount)` at the end of the lane's chain
      const t = findTrack(m, op.track); insertStep(t, (t.chain || []).length, ['send', op.bus, ...(op.amount !== undefined ? [op.amount] : [])]); break;
    }
    default: throw new Error('E_UNKNOWN_OP ' + op.op);
  }
  if ((m.tracks || []).some(hasLaneSteps) || m.selections) syncLanes(m);
  return m;
}

// ---------------------------------------------------------------- graph projection
function parseRef(ref) {
  const slash = ref.indexOf('/'), scope = slash >= 0 ? ref.slice(0, slash) : null, rest = slash >= 0 ? ref.slice(slash + 1) : ref;
  const colon = rest.indexOf(':');
  return { scope, name: colon >= 0 ? rest.slice(0, colon) : rest, facet: colon >= 0 ? rest.slice(colon + 1) : null };
}
function gateMarkers(gate, markers) {
  const strs = [];
  const add = (g) => { if (typeof g === 'string') strs.push(g); else if (isObj(g)) { for (const k of ['from', 'until']) if (typeof g[k] === 'string') strs.push(g[k]); (g.windows || []).forEach(w => w.forEach(p => typeof p === 'string' && strs.push(p))); } };
  add(gate);
  const found = [];
  for (const s of strs) for (const piece of s.split(/\.\.|,|@|</).map(x => x.trim())) {
    for (const name of Object.keys(markers || {})) {
      if (piece.startsWith(name) && (piece.length === name.length || /[+-]/.test(piece[name.length])) && !found.includes(name)) found.push(name);
    }
  }
  return found;
}
export function graph(model) {
  const nodes = [], wires = [], byId = new Map(), markers = model.markers || {};
  const add = (n) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n); } return byId.get(n.id); };
  const wire = (type, from, fp, to, tp, id) => { const w = { id: id || `${type}:${from}.${fp}>${to}.${tp}`, type, from: { node: from, port: fp }, to: { node: to, port: tp } }; if (!wires.some(x => x.id === w.id)) wires.push(w); };
  const reads = []; // {ref, node, port}
  for (const [k, v] of Object.entries(markers)) add({ id: `marker:${k}`, kind: 'marker', point: v });
  for (const [k, v] of Object.entries(model.defs || {})) add({ id: `def:${k}`, kind: v.decorator ? 'decorator' : (v.params || v.taps ? 'module' : 'hook'), params: Object.keys(v.params || {}), taps: Object.keys(v.taps || {}) });
  for (const k of Object.keys(model.vars || {})) add({ id: `var:${k}`, kind: 'var' });
  for (const k of Object.keys(model.controls || {})) add({ id: `control:${k}`, kind: 'control', type: model.controls[k].type });
  // atom cards exist only while something references them (ATOMS 9): built from the reference list, never from model.atoms
  for (const c of AT.atomCards(model)) add({ ...c });
  const addSlot = (scope, name) => add({ id: `slot:${scope}/${name}`, kind: 'slot', scope, name });
  const publish = (name, from, port, track, opts) => { const tn = add({ id: `tap:${name}`, kind: 'tap', name, facets: [] }); wire('pattern', from, port, tn.id, 'in'); if (track.ns) tn.ns = track.ns; if (opts && opts.export === true) tn.export = true; return tn; };
  const lanesOn = hasLanes(model), branchTaps = new Map(); // tap name -> { lane, branch }: names published inside a split branch are local to it
  (model.tracks || []).forEach((t) => {
    if (t.chain == null && t.source == null) {
      const id = `code:${t.name}`, sc = scanText(t.src || '');
      const node = add({ id, kind: 'code', name: t.name, ports: { in: [...new Set(sc.reads)], out: [...new Set(sc.publishes)] } });
      sc.reads.forEach(r => reads.push({ ref: r, node: id, port: r }));
      sc.publishes.forEach(p => publish(parseRef(p).name, id, 'out', t));
      sc.slots.forEach(s => { const r = parseRef(s); addSlot(r.scope || t.name, r.name); });
      return node;
    }
    const tid = `track:${t.name}`;
    const tnode = add({ id: tid, kind: 'track', name: t.name, ns: t.ns, muted: !!t.muted, collapsed: true, steps: 1 + (t.chain || []).length });
    if (lanesOn) { tnode.tags = t.tags ? [...t.tags] : []; tnode.ports = { out: [{ name: 'audio', type: 'audio' }] }; if (t.ret) tnode.ret = t.ret; } // lane card: tag row + audio output port
    [t.source, ...(t.chain || [])].forEach((s, i) => {
      if (!s) return;
      const id = `${tid}#${i}`, method = s[0], isSlot = i > 0 && (method === 'use' || method === 'wrap');
      add({ id, kind: i === 0 ? 'pattern' : isSlot ? 'slot' : 'step', method, parent: tid });
      if (i > 0) wire('pattern', `${tid}#${i - 1}`, 'out', id, 'in');
      if (method === 'tap' && typeof s[1] === 'string') publish(parseRef(s[1]).name, id, 'out', t, isObj(s[2]) ? s[2] : null);
      if (isSlot && typeof s[1] === 'string') { const r = parseRef(s[1]); addSlot(r.scope || t.name, r.name); }
      if (method === 'wire' && typeof s[2] === 'string') reads.push({ ref: s[2], node: id, port: String(s[1]) });
      s.slice(1).forEach((a, j) => {
        if (method === 'wire') return;
        const port = j === 0 ? method : `${method}.${j}`;
        if (isObj(a) && a.$tap !== undefined) reads.push({ ref: a.$tap, node: id, port });
        else if (isObj(a) && a.$code !== undefined) scanText(a.$code).reads.forEach(r => reads.push({ ref: r, node: id, port }));
      });
    });
    if (lanesOn && t.split) laneSplit(t, tid);
  });
  for (const i of model.instances || []) {
    add({ id: `inst:${i.as}`, kind: 'component', component: i.component, args: i.args || {} });
    for (const mk of gateMarkers(i.gate, markers)) wire('gate', `marker:${mk}`, 'point', `inst:${i.as}`, 'gate');
  }
  const trackNode = (name) => byId.has(`track:${name}`) ? `track:${name}` : `code:${name}`;
  const resolve = (ref, to, tp) => {
    const r = parseRef(ref), inst = (model.instances || []).find(i => i.as === r.scope);
    if (inst) return wire('signal', `inst:${inst.as}`, r.name, to, tp);
    if (!r.scope && (model.vars || {})[r.name]) return wire('param', `var:${r.name}`, 'out', to, tp);
    const tn = add({ id: `tap:${r.name}`, kind: 'tap', name: r.name, facets: [] });
    const facet = r.facet || 'ev';
    if (!tn.facets.includes(facet)) tn.facets.push(facet);
    wire(['ev', 'onset'].includes(facet) ? 'pattern' : 'signal', tn.id, facet, to, tp);
  };
  const refused = [];
  reads.forEach(r => {
    const rp = parseRef(r.ref), bt = branchTaps.get(rp.name), lane = r.node.replace(/^(track|code):/, '').split('#')[0];
    if (bt && bt.lane !== lane && (!rp.scope || rp.scope === bt.lane)) { refused.push(crossing(`tap "${rp.name}"`, bt, lane, r)); return; } // E_LANE_CROSS: never a wire
    resolve(r.ref, r.node, r.port);
  });
  (model.wires || []).forEach(w => { const d = w.dest.split('.'); if (byId.has(trackNode(d[0]))) resolve(w.tap, trackNode(d[0]), d[1] || ''); });
  (model.maps || []).forEach(mp => { const d = mp.dest.split('.'); if (byId.has(`control:${mp.control}`) && byId.has(trackNode(d[0]))) wire('param', `control:${mp.control}`, 'out', trackNode(d[0]), d[1] || ''); });
  (model.bindings || []).forEach((b, i) => {
    const id = b.id || `b${i + 1}`, hook = b.hook.replace(/\(.*$/, ''), r = parseRef(b.slot);
    add({ id: `def:${hook}`, kind: byId.get(`def:${hook}`)?.kind || 'hook', unresolved: !(model.defs || {})[hook] });
    let targets = nodes.filter(n => n.kind === 'slot' && n.name === r.name && (!r.scope || r.scope === '*' || n.scope === r.scope));
    if (!targets.length) targets = [addSlot(r.scope || '*', r.name)];
    targets.forEach(s => {
      wire('hook', `def:${hook}`, 'out', s.id, 'hook', `bind:${id}:${s.id}`);
      for (const mk of gateMarkers(b.gate, markers)) wire('gate', `marker:${mk}`, 'point', s.id, `gate:${id}`);
    });
  });
  for (const c of AT.atomCards(model)) for (const r of c.refs) { // one param wire per referencing track (BLUEPRINT 4.2, badge = atom type)
    const mt = /^\/tracks\/(\d+)\//.exec(r.path); if (!mt) continue;
    const t = (model.tracks || [])[+mt[1]]; if (!t) continue;
    const id = trackNode(t.name); if (byId.has(id)) wire('param', c.id, 'out', id, 'atom');
  }
  if (lanesOn) laneNodes();
  return refused.length ? { nodes, wires, refused } : { nodes, wires };

  // ---- lanes (docs/LANES.md section 10): split fan, buses, selection chips, capture nodes. Function declarations: hoisted; all gated by lanesOn.
  function laneSplit(t, tid) {
    const sp = t.split, from = `${tid}#${sp.at}`, sid = `split:${t.name}`;
    add({ id: sid, kind: 'split', parent: tid, lane: t.name, site: sp.site, branches: sp.branches.length, merge: !!sp.merge, ...(sp.mix ? { mix: sp.mix } : {}), ...(sp.pre !== undefined ? { pre: sp.pre } : {}) });
    wire('audio', from, 'out', sid, 'in'); // ONE audio wire feeds the fan
    const join = `join:${t.name}`;
    add({ id: join, kind: 'join', parent: tid, lane: t.name, sum: !(sp.merge && sp.merge !== true), ...(sp.merge && sp.merge !== true ? { steps: (sp.merge.chain || []).length } : {}) });
    sp.branches.forEach((b, j) => {
      const bid = `branch:${t.name}#${j}`;
      add({ id: bid, kind: 'branch', parent: tid, lane: t.name, index: j, branch: j, branchId: b.id, param: b.param, steps: b.chain ? b.chain.length : null, opaque: b.chain === null, src: b.src });
      wire('audio', sid, `out${j}`, bid, 'in');
      let last = bid;
      (b.chain || []).forEach((step, k) => {
        const id = `${bid}.${k}`;
        add({ id, kind: 'step', method: step[0], parent: tid, lane: t.name, branch: j });
        wire('audio', last, 'out', id, 'in'); last = id;
        if (step[0] === 'tap' && typeof step[1] === 'string') { const nm = parseRef(step[1]).name, tn = publish(nm, id, 'out', t); tn.local = true; tn.lane = t.name; tn.branch = j; branchTaps.set(nm, { lane: t.name, branch: j, node: id }); }
      });
      wire('audio', last, 'out', join, `in${j}`);
    });
  }
  function crossing(what, bt, to, read) {
    return { code: 'E_LANE_CROSS', message: LD.E_LANE_CROSS(what, bt.lane, to), from: { node: bt.node, lane: bt.lane, branch: bt.branch }, to: { node: read.node, port: read.port, lane: to },
      fixes: [{ label: 'Export tap', op: { op: 'exportTap', track: bt.lane, tap: parseRef(read.ref).name } }, { label: 'Add send', op: { op: 'addSend', track: bt.lane, bus: bt.lane } }] };
  }
  function laneNodes() {
    const lanes = [], anon = { n: 0 };
    for (const t of model.tracks || []) if (!(t.chain == null && t.source == null)) lanes.push({ id: ANON.test(t.name) ? `$${anon.n++}` : t.name, name: t.name, tags: t.tags || [] });
    const nodeOf = (laneId) => `track:${lanes.find(l => l.id === laneId).name}`;
    const buses = new Map(), bus = (name) => { if (!buses.has(name)) buses.set(name, add({ id: `bus:${name}`, kind: 'bus', name, sends: [], returns: [] })); return buses.get(name); };
    const send = (laneId, name, amount, via) => {
      const b = bus(name), e = b.sends.find(x => x.lane === laneId);
      if (e) { if (via && !(e.via || []).includes(via)) (e.via ||= []).push(via); return; }
      b.sends.push({ lane: laneId, amount, ...(via ? { via: [via] } : {}) });
      wire('audio', nodeOf(laneId), 'audio', b.id, 'in');
    };
    for (const l of lanes) { const t = (model.tracks || []).find(x => x.name === l.name); for (const sd of t.sends || []) send(l.id, sd.bus, sd.amount); if (t.ret) { const b = bus(t.ret); b.returns.push(l.id); wire('audio', b.id, 'out', nodeOf(l.id), 'in'); } }
    const chipOf = (kind, id, picker, extra) => { const sel = strOf(picker), m = sel === null ? { ok: false, matches: [], error: 'selector is not a string' } : LD.matchLanes(sel, lanes); return { id, kind, selector: sel, matches: m.matches, ...(m.ok ? {} : { error: m.error }), ...extra }; };
    const captureNode = (name, c) => {
      const picker = strOf(c.picker), what = Array.isArray(c.what) ? c.what : LD.defaultWhat(picker);
      const chip = chipOf('capture', `capture:${name}`, c.picker, { name, site: LD.captureId(name), what, ...['window', 'last', 'live', 'max'].filter(k => c[k] !== undefined).reduce((o, k) => ({ ...o, [k]: c[k] }), {}) });
      chip.ports = { out: [...(what.includes('events') ? [{ name: 'ev', type: 'pattern' }] : []), ...(what.includes('audio') ? [{ name: 'audio', type: 'audio' }] : []), ...(what.includes('level') ? [{ name: 'level', type: 'signal' }] : [])] };
      if (chip.error && /^[\w-]+\/[\w-]+$/.test(picker || '')) { delete chip.error; chip.tap = picker; } // an event tap ref (lane/tap) is a picker, not a selector
      return add(chip);
    };
    (model.selections || []).forEach((sel, i) => {
      const id = sel.id || `s${i + 1}`, chip = add(chipOf('selection', `selection:${id}`, sel.selector, { ops: (sel.ops || []).map(o => o.op), ...(sel.gate !== undefined ? { gate: sel.gate } : {}) })); // one chip per statement; no per-match wires
      for (const o of sel.ops || []) {
        if (o.op === 'send') for (const m of chip.matches) send(m, strOf(o.bus), typeof o.amount === 'number' ? o.amount : 1, id);
        if (o.op === 'capture') { const nm = strOf(o.name); if (nm && !(model.captures || {})[nm]) captureNode(nm, { picker: sel.selector, ...(o.opts || {}) }); }
      }
    });
    for (const [name, c] of Object.entries(model.captures || {})) captureNode(name, c);
    for (const t of model.tracks || []) { // capture readers: recall("name:facet") and .from("name") anywhere in the lane
      if (t.chain == null && t.source == null) continue;
      const text = t.src !== undefined ? t.src : emitTrack(t), tn = `track:${t.name}`;
      for (const m of text.matchAll(/\brecall\(\s*["']([\w-]+)(?::([\w-]+))?/g)) { const cn = byId.get(`capture:${m[1]}`); if (cn) { const w = LD.facetWire(m[2] || 'ev'); wire(w.type, cn.id, w.port, tn, 'recall'); } }
      for (const m of text.matchAll(/\.from\(\s*["']([\w-]+)["']/g)) { const cn = byId.get(`capture:${m[1]}`); if (cn) wire('audio', cn.id, 'audio', tn, 'from'); }
    }
  }
}

const hasLanes = (m) => (m.tracks || []).some(t => LANE_KEYS.some(k => t[k] !== undefined)) || !!(m.selections && m.selections.length) || !!(m.captures && Object.keys(m.captures).length);
// every wire proposed by the UI goes through this: a source inside a split branch cannot feed another lane (E_LANE_CROSS); the fixes are applyOp operations
export function checkWire(model, fromNode, toNode) {
  const g = graph(model), byId = new Map(g.nodes.map(n => [n.id, n])), a = byId.get(fromNode), b = byId.get(toNode);
  if (!a || !b) return { ok: false, code: 'E_NO_NODE', message: 'E_NO_NODE: unknown node' };
  const laneName = (n) => (n.kind === 'track' ? n.name : n.lane || (n.parent ? String(n.parent).replace(/^track:/, '') : null));
  const la = laneName(a), lb = laneName(b);
  if (a.branch !== undefined && la && lb && la !== lb) {
    const tap = a.kind === 'tap' ? a.name : (g.nodes.find(n => n.kind === 'tap' && n.branch === a.branch && n.lane === la) || {}).name;
    return { ok: false, code: 'E_LANE_CROSS', message: LD.E_LANE_CROSS(tap ? `tap "${tap}"` : 'a branch step', la, lb), from: { node: fromNode, lane: la, branch: a.branch }, to: { node: toNode, lane: lb },
      fixes: [...(tap ? [{ label: 'Export tap', op: { op: 'exportTap', track: la, tap } }] : []), { label: 'Add send', op: { op: 'addSend', track: la, bus: la } }] };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- layout (deterministic layered, left to right)
export function layout(model) {
  const { nodes, wires } = graph(model);
  const top = (id) => { const n = nodes.find(x => x.id === id); return n && n.parent ? n.parent : id; };
  const items = nodes.filter(n => !n.parent), rank = new Map(items.map(n => [n.id, 0]));
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const w of wires) {
      const a = top(w.from.node), b = top(w.to.node);
      if (a !== b && rank.has(a) && rank.has(b) && rank.get(b) < rank.get(a) + 1 && rank.get(a) + 1 <= items.length) { rank.set(b, rank.get(a) + 1); changed = true; }
    }
    if (!changed) break;
  }
  const rows = new Map(), out = {};
  for (const n of items) {
    const r = rank.get(n.id), row = rows.get(r) || 0; rows.set(r, row + 1);
    out[n.id] = { x: r * 240, y: row * 96, collapsed: n.kind === 'track' || n.kind === 'component' };
  }
  for (const [id, v] of Object.entries(model.layout || {})) if (id in out) out[id] = { ...out[id], ...v };
  return out;
}
