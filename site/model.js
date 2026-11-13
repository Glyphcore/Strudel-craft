// Shared model (BLUEPRINT 1, 4.3, 4.4, 5): code <-> model, edit ops, graph projection, layout, canonical form and hash.
// Standalone ES module, no Strudel code. Parser: acorn (MIT) loaded unmodified from ./vendor/acorn-8.19.0.mjs, only when this module is imported.
// Lossless by construction: every layer statement keeps its verbatim `src` (including leading comments/blank lines) and is re-emitted as is
// while its structure still matches that text; edit ops splice the text, so only the touched statement changes.
import * as acorn from './vendor/acorn-8.19.0.mjs';

const LAYOUT_RE = /\/\/ @model-layout (\{[^\n]*\})\n?$/;
const REF_METHODS = new Set(['tap', 'use', 'wrap', 'ns', 'wire']); // string args are references, not mini-notation: plain strings
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
  if (a.length && (typeof a[0] === 'string' || (isObj(a[0]) && Object.keys(a[0]).some(k => GATE_KEYS.has(k))))) gate = a.shift();
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
  if (fn === 'marker' && a.length === 2 && typeof a[0] === 'string' && ['string', 'number'].includes(typeof a[1])) { (m.markers ||= {})[a[0]] = a[1]; return true; }
  if (fn === 'scope' && a.length >= 1 && typeof a[0] === 'string' && (a[1] === undefined || okObj(a[1], ['stem', 'bus']))) { (m.scopes ||= {})[a[0]] = a[1] || {}; return true; }
  if (fn === 'slot' && a.length >= 1 && typeof a[0] === 'string' && (a[1] === undefined || okObj(a[1], ['mode', 'else', 'quant']))) { (m.slots ||= {})[a[0]] = a[1] || {}; return true; }
  if (fn === 'def' && a.length === 2 && typeof a[0] === 'string' && okObj(a[1], ['params', 'taps', 'chain', 'decorator', 'opaque', 'src'])) { (m.defs ||= {})[a[0]] = a[1]; return true; }
  if (fn === 'let' && a.length >= 2 && a.length <= 4 && typeof a[0] === 'string') {
    const g = gateOpts(a.slice(2)); if (!g || !okObj(g.opts, ['priority', 'min', 'max', 'unit', 'ns'])) return false;
    if (hasCode(g.gate) || hasCode(g.opts)) return false;
    (((m.vars ||= {})[a[0]]) ||= []).push({ value: a[1], ...(g.gate !== undefined ? { gate: g.gate } : {}), ...g.opts }); return true;
  }
  if (fn === 'bind' && a.length >= 2 && a.length <= 4 && typeof a[0] === 'string' && typeof a[1] === 'string') {
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
  try { ast = parseJs(body); } catch { if (body) m.header = body; return m; }
  let header = '', structural = false, pos = 0, codeN = 0;
  const n = ast.body.length;
  ast.body.forEach((st, i) => {
    const last = i === n - 1;
    const stmtEnd = st.end + (body[st.end] === '\r' && body[st.end + 1] === '\n' ? 2 : body[st.end] === '\n' ? 1 : 0);
    if (analyseRegistry(st, body, m) || (() => { const inst = analyseInst(st, body); if (inst) (m.instances ||= []).push(inst); return !!inst; })()) {
      structural = true; pos = stmtEnd; return;
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
export function generate(model) {
  let out = model.header || '';
  const sep = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const line = (s) => { sep(); out += s + '\n'; };
  const call = (fn, ...args) => `hooks.${fn}(${args.map(a => emitArg(a)).join(', ')})`;
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
  for (const t of model.tracks || []) {
    const sync = trackSync(t);
    if (sync) out += t.src; else line(emitTrack(t));
  }
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
    default: throw new Error('E_UNKNOWN_OP ' + op.op);
  }
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
  const addSlot = (scope, name) => add({ id: `slot:${scope}/${name}`, kind: 'slot', scope, name });
  const publish = (name, from, port, track) => { const tn = add({ id: `tap:${name}`, kind: 'tap', name, facets: [] }); wire('pattern', from, port, tn.id, 'in'); if (track.ns) tn.ns = track.ns; };
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
    add({ id: tid, kind: 'track', name: t.name, ns: t.ns, muted: !!t.muted, collapsed: true, steps: 1 + (t.chain || []).length });
    [t.source, ...(t.chain || [])].forEach((s, i) => {
      if (!s) return;
      const id = `${tid}#${i}`, method = s[0], isSlot = i > 0 && (method === 'use' || method === 'wrap');
      add({ id, kind: i === 0 ? 'pattern' : isSlot ? 'slot' : 'step', method, parent: tid });
      if (i > 0) wire('pattern', `${tid}#${i - 1}`, 'out', id, 'in');
      if (method === 'tap' && typeof s[1] === 'string') publish(parseRef(s[1]).name, id, 'out', t);
      if (isSlot && typeof s[1] === 'string') { const r = parseRef(s[1]); addSlot(r.scope || t.name, r.name); }
      if (method === 'wire' && typeof s[2] === 'string') reads.push({ ref: s[2], node: id, port: String(s[1]) });
      s.slice(1).forEach((a, j) => {
        if (method === 'wire') return;
        const port = j === 0 ? method : `${method}.${j}`;
        if (isObj(a) && a.$tap !== undefined) reads.push({ ref: a.$tap, node: id, port });
        else if (isObj(a) && a.$code !== undefined) scanText(a.$code).reads.forEach(r => reads.push({ ref: r, node: id, port }));
      });
    });
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
  reads.forEach(r => resolve(r.ref, r.node, r.port));
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
  return { nodes, wires };
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
