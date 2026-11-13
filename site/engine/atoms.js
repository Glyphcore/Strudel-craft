// Atoms core (docs/ATOMS.md sections 3-8, 12; issue #61): typed, parameterised definitions that compile away into plain Strudel strings.
// Standalone ES module, no DOM, same file on the site and in the CLI. Parser: acorn (MIT, ../vendor, unmodified). Strudel is never imported:
// the host hands in `mini` (Strudel's own parser, public API) and `parsers` (hooks runtime, `hooks.parsers`) via configure().
// Pipeline order on the site and in the CLI: atoms.compile -> control-site rewrite -> Strudel transpiler.
import * as acorn from '../vendor/acorn-8.19.0.mjs';
import { hash as modelHash } from '../model.js';

// ---------------------------------------------------------------- errors, positions
export class AtomError extends Error {
  constructor(code, message, at) { super(`${code}: ${message}`); this.code = code; if (at) this.at = at; }
}
const err = (c, m, at) => new AtomError(c, m, at);
export const lineCol = (src, off) => { let line = 1, last = -1; for (let i = src.indexOf('\n'); i >= 0 && i < off; i = src.indexOf('\n', i + 1)) { line++; last = i; } return { line, col: off - last }; };
const spanOf = (src, from, to) => ({ from, to, ...lineCol(src, from) });
const withAt = (at, fn) => { try { return fn(); } catch (e) { if (e instanceof AtomError && !e.at && at) e.at = at; throw e; } };

// ---------------------------------------------------------------- type registry, configuration
const TYPES = new Map();
let CFG = { mini: null, parsers: null, positions: {}, catalog: null };
export function registerType(t) {
  if (!t || typeof t.id !== 'string') throw err('E_ATOM_TYPE_ID', 'type needs an id');
  TYPES.set(t.id, Object.freeze({ compiles: 'string', quote: "'", shape: [], validator: 'none', editor: 'text', ops: [], ...t })); return TYPES.get(t.id);
}
export const types = () => [...TYPES.values()];
export const config = () => CFG;
export const typeOf_ = (id) => typeOf(id);
export const loadTypes = (list) => { for (const t of typeof list === 'string' ? JSON.parse(list) : list) registerType(t); return types(); };
// mini: Strudel's mini() (public API). parsers: hooks.parsers (gate, point, ref, expr). positions: data/atoms/positions.json.
// catalog: { snd, bank, scale, chord } each an array | Set | (key) => bool, used only to check catalog atoms (never enumerated into the environment).
export const configure = (o = {}) => { CFG = { ...CFG, ...o }; return CFG; };
const typeOf = (id, strict) => { const t = TYPES.get(id); if (t) return t; if (strict) throw err('E_ATOM_TYPE_ID', `unknown atom type "${id}"`); return TYPES.get('text') || { id: 'text', compiles: 'string', quote: "'", ops: [], validator: 'none' }; };

// ---------------------------------------------------------------- scan (acorn): declarations, imports, reference sites
const FNV = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const b36 = (h) => (h % 36 ** 6).toString(36).padStart(6, '0');
class NotStatic extends Error {}
const isNode = (v) => v && typeof v.type === 'string';
function flatten(n) { // member/call chain rooted at identifier `atoms` -> segments, or null
  const segs = [];
  for (;;) {
    if (n.type === 'CallExpression') { segs.push({ call: n.arguments }); n = n.callee; }
    else if (n.type === 'MemberExpression') {
      if (!n.computed) segs.push({ prop: n.property.name });
      else if (n.property.type === 'Literal' && typeof n.property.value === 'string') segs.push({ prop: n.property.value });
      else segs.push({ dyn: true });
      n = n.object;
    } else break;
  }
  return n.type === 'Identifier' && n.name === 'atoms' && segs.length ? segs.reverse() : null;
}
function sv(n) { // static value (number | string | boolean | null | array | object | atom reference)
  switch (n.type) {
    case 'Literal': if (n.regex || typeof n.value === 'bigint') throw new NotStatic(); return n.value;
    case 'TemplateLiteral': if (n.expressions.length) throw new NotStatic(); return n.quasis[0].value.cooked;
    case 'UnaryExpression': { const v = n.operator === '-' || n.operator === '+' ? sv(n.argument) : null; if (typeof v !== 'number') throw new NotStatic(); return n.operator === '-' ? -v : v; }
    case 'ArrayExpression': return n.elements.map((e) => { if (!e || e.type === 'SpreadElement') throw new NotStatic(); return sv(e); });
    case 'ObjectExpression': {
      const o = {};
      for (const p of n.properties) { if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) throw new NotStatic(); o[p.key.type === 'Identifier' ? p.key.name : String(p.key.value)] = sv(p.value); }
      return o;
    }
    default: { const segs = flatten(n); if (!segs) throw new NotStatic(); return { $segs: segsOf(segs) }; }
  }
}
const segsOf = (segs) => segs.map((s) => { if (s.dyn) throw new NotStatic(); return s.call ? { call: s.call.map(sv) } : s; });
// one AST node -> { $segs } when it is a static reference rooted at `atoms` (used by model.js parse), else null
export function refOfNode(node) {
  if (!isNode(node) || (node.type !== 'MemberExpression' && node.type !== 'CallExpression')) return null;
  const segs = flatten(node); if (!segs) return null;
  try { return { $segs: segsOf(segs) }; } catch { return null; }
}
const posKey = (c) => c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? (c.object.type === 'Identifier' && c.object.name === 'hooks' ? 'hooks.' : '.') + c.property.name : null;

const SCANS = new Map();
export function scan(code) {
  if (SCANS.has(code)) return SCANS.get(code);
  let ast; try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch (e) { throw err('E_ATOM_PARSE', `cannot parse program: ${e.message}`, spanOf(code, e.pos ?? 0, (e.pos ?? 0) + 1)); }
  const out = { decls: [], imports: [], sites: [] };
  const visit = (n, path, parent, key, idx) => {
    if (n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression') {
      const c = n.expression.callee;
      if (c.type === 'Identifier' && c.name === 'atom') { out.decls.push({ node: n.expression, stmt: [n.start, n.end] }); return false; }
      if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'atoms' && c.property.name === 'import') { out.imports.push({ node: n.expression, stmt: [n.start, n.end] }); return false; }
    }
    if (n.type === 'MemberExpression' || n.type === 'CallExpression') {
      const segs = flatten(n);
      if (segs) {
        const site = { id: 'r' + b36(FNV(path)), path, from: n.start, to: n.end, node: n, segs: null, dynamic: false };
        try { site.segs = segsOf(segs); } catch { site.dynamic = true; }
        if (parent && parent.type === 'CallExpression' && key === 'arguments') { site.callee = posKey(parent.callee); site.arg = idx; }
        out.sites.push(site); return false;
      }
    }
    return true;
  };
  const walk = (n, path, parent, key, idx) => {
    if (visit(n, path, parent, key, idx) === false) return;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x, i) => isNode(x) && walk(x, `${path}.${k}[${i}]`, n, k, i));
      else if (isNode(v)) walk(v, `${path}.${k}`, n, k, null);
    }
  };
  walk(ast, 'Program', null, null, null);
  if (SCANS.size > 16) SCANS.clear();
  SCANS.set(code, out); return out;
}

// ---------------------------------------------------------------- environment
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
function declOf(code, d) {
  const at = spanOf(code, d.stmt[0], d.stmt[1]); const a = d.node.arguments;
  return withAt(at, () => {
    if (a.length !== 2 || a[1].type !== 'ObjectExpression') throw err('E_ATOM_ARG', 'atom(name, { type, params?, body | from, doc? }) expected');
    let name, spec; try { name = sv(a[0]); spec = sv(a[1]); } catch (e) { if (e instanceof NotStatic) throw err('E_ATOM_ARG', 'atom declarations must be static (literals only)'); throw e; }
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw err('E_ATOM_ARG', `bad atom name ${JSON.stringify(name)}`);
    if (typeof spec.type !== 'string') throw err('E_ATOM_TYPE_ID', `atom "${name}" needs a type`);
    if (('body' in spec) === ('from' in spec)) throw err('E_ATOM_ARG', `atom "${name}" needs exactly one of body | from`);
    const { type, params, body, from, doc, tags, quote } = spec;
    return { name, type, ...(params && { params }), ...('body' in spec && { body }), ...(from !== undefined && { from }), ...(doc && { doc }), ...(tags && { tags }), ...(quote && { quote }), origin: 'code', at };
  });
}
// extra: { atoms: model.atoms (id -> record), imports: { source -> atoms map } }. Code declarations win over model entries of the same name
// (the model copy is the previous reconciliation of the same code); two code declarations of one name raise E_ATOM_REDEFINED.
export function buildEnv(code, extra = {}, opts = {}) {
  const diag = opts.diag, sc = /\batoms?\b/.test(code) ? scan(code) : { decls: [], imports: [], sites: [] };
  const byName = new Map(), byId = new Map(); const bad = (e) => { if (!diag) throw e; diag.push(e); };
  const put = (r) => { byName.set(r.name, r); if (r.id) byId.set(r.id, r); };
  for (const [id, a] of Object.entries(extra.atoms || {})) put({ ...a, id, origin: 'model' });
  for (const im of sc.imports) {
    const at = spanOf(code, im.stmt[0], im.stmt[1]);
    try {
      withAt(at, () => {
        const [s, o] = im.node.arguments.map(sv); const set = extra.imports?.[s];
        if (!set) throw err('E_ATOM_UNKNOWN', `import "${s}" is not provided`);
        const ns = o?.as; for (const [id, a] of Object.entries(set)) put({ ...a, id, name: ns ? `${ns}.${a.name}` : a.name, origin: 'import' });
      });
    } catch (e) { if (e instanceof AtomError) bad(e); else throw e; }
  }
  const seen = new Set(), decls = [];
  for (const d of sc.decls) {
    let r; try { r = declOf(code, d); } catch (e) { if (e instanceof AtomError) { bad(e); continue; } throw e; }
    if (seen.has(r.name)) { bad(err('E_ATOM_REDEFINED', `atom "${r.name}" declared twice`, r.at)); continue; }
    seen.add(r.name); const prev = byName.get(r.name); if (prev?.id && prev.origin === 'model') r.id = prev.id;
    put(r); decls.push(r);
  }
  const cache = new Map(); // catalog atoms synthesised on reference (ATOMS section 2, decision 7); not part of byName, never enumerated
  const synth = (k) => { if (typeof k !== 'string') return undefined; if (!cache.has(k)) cache.set(k, catalogAtom(k)); return cache.get(k); };
  const env = { byName, byId, decls, synth, get: (k) => byName.get(k) || byId.get(k) || synth(k) };
  for (const r of byName.values()) deepFreeze(r);
  return Object.freeze(env);
}

// catalog atoms: `snd.bd` / `snd:bd` (sound), `bank.RolandTR909`, `scale.minor` (param root), `chord.m7` (param root)
function catalogAtom(k) {
  const m = /^(snd|bank|scale|chord)\.([^.]+)$/.exec(k) || /^(snd|bank|scale|chord):(.+)$/.exec(k); if (!m) return undefined;
  const [, cat, key] = m, name = `${cat}.${key}`, root = (d) => ({ root: { shape: 'note', default: d } });
  const r = cat === 'snd' ? { type: 'sound', body: key } : cat === 'bank' ? { type: 'bank', body: key }
    : cat === 'scale' ? { type: 'scale', params: root('c'), body: `\${root}:${key}` } : { type: 'chord', params: root('C'), body: `\${root}${key}` };
  return deepFreeze({ name, ...r, origin: 'catalog', cat, key });
}
export function inCatalog(cat, key) { // true / false, or null when that catalog is not configured
  const c = CFG.catalog?.[cat]; if (!c) return null;
  return typeof c === 'function' ? !!c(key) : c instanceof Set ? c.has(key) : Array.isArray(c) ? c.includes(key) : key in c;
}

// ---------------------------------------------------------------- references, params, rendering
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const lookup = (env, key) => env.get(key);
export function toRef(env, v) { // { $segs } (code) | { $atom } (model) | name string -> { $atom, args, ops }
  if (typeof v === 'string') return { $atom: v, args: {}, ops: [] };
  if (v && v.$atom) return { $atom: v.$atom, args: v.args || {}, ops: v.ops || [] };
  const segs = v?.$segs; if (!segs) throw err('E_ATOM_TYPE', 'not an atom reference');
  const props = []; for (const s of segs) { if (s.prop === undefined) break; props.push(s.prop); }
  let k = props.length, rec = null;
  for (; k > 0; k--) { rec = env.byName.get(props.slice(0, k).join('.')) || env.synth(props.slice(0, k).join('.')); if (rec) break; }
  if (!rec) throw err('E_ATOM_UNKNOWN', `unknown atom "atoms.${props.join('.')}"`);
  let j = k, args = {};
  if (segs[k]?.call) { args = segs[k].call[0] || {}; if (!isObj(args) || segs[k].call.length > 1) throw err('E_ATOM_ARG', `atoms.${rec.name}(...) takes one { name: value } object`); j = k + 1; }
  const ops = [];
  while (j < segs.length) { const p = segs[j], c = segs[j + 1]; if (p.prop === undefined || !c?.call) throw err('E_ATOM_UNKNOWN', `bad reference after atoms.${rec.name}`); ops.push([p.prop, ...c.call]); j += 2; }
  return { $atom: rec.name, args, ops };
}
const tokLike = (s) => /^[^\s,|\[\]<>{}()]+$/.test(s.replace(/\([^()]*\)/g, ''));
const group = (s) => { if (!/^[\[<]/.test(s)) return false; let d = 0; for (let i = 0; i < s.length; i++) { if ('[<'.includes(s[i])) d++; else if (']>'.includes(s[i])) { d--; if (d === 0 && i < s.length - 1) return false; } } return d === 0; };
const isTok = (s) => s !== '' && (tokLike(s) || group(s));
const isAtomic = (s) => s !== '' && ((tokLike(s) && !/[*\/!@?]/.test(s.replace(/\([^()]*\)/g, ''))) || group(s));
const wrapB = (s) => (isTok(s) ? s : `[${s}]`);
const num = (x, what, pos = false) => { const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x; if (typeof n !== 'number' || !Number.isFinite(n) || (pos && n <= 0)) throw err('E_ATOM_ARG', `${what} must be a ${pos ? 'positive ' : ''}number, got ${JSON.stringify(x)}`); return n; };
const PRINT = {
  seq: (t) => t.map(wrapB).join(' '),
  stack: (t) => `[${t.map((x) => (/\|/.test(x) ? `[${x}]` : x)).join(', ')}]`,
  alt: (t) => `<${t.map(wrapB).join(' ')}>`,
  rep: (a, n) => `${isAtomic(a) ? a : `[${a}]`}*${num(n, 'rep count', true)}`,
  slow: (a, n) => `${isAtomic(a) ? a : `[${a}]`}/${num(n, 'slow factor', true)}`,
  euclid: (a, k, n, r = 0) => { if (!isAtomic(a) || /\(/.test(a)) throw err('E_ATOM_ARG', `euclid needs a single-step atom, got "${a}"`); return `${a}(${num(k, 'euclid k')},${num(n, 'euclid n')}${r ? ',' + num(r, 'euclid rotation') : ''})`; },
  union: (t) => t.join(', '),
};
// points: "17b", "drop-2b", "1:30"; shift adds an offset (same unit) to the trailing +/- offset
const OFF = /^([+-]?)(\d+(?:\.\d+)?)([cbs]?)$/;
function shiftPoint(p, off) {
  const o = typeof off === 'number' ? OFF.exec(String(off) + 'c') : OFF.exec(String(off).trim()); if (!o) throw err('E_ATOM_ARG', `bad offset "${off}"`);
  const delta = (o[1] === '-' ? -1 : 1) * +o[2], unit = o[3] || 'c'; const m = /([+-])(\d+(?:\.\d+)?)([cbs]?)$/.exec(p);
  if (!m) return `${p}${delta < 0 ? '-' : '+'}${Math.abs(delta)}${unit}`;
  if ((m[3] || 'c') !== unit) throw err('E_ATOM_ARG', `cannot add ${off} to "${p}" (different unit)`);
  const sum = (m[1] === '-' ? -1 : 1) * +m[2] + delta, base = p.slice(0, m.index);
  return sum === 0 ? base : `${base}${sum < 0 ? '-' : '+'}${Math.abs(sum)}${unit}`;
}
const windows = (g) => g.split(',').map((x) => x.trim()).filter(Boolean).map((w) => (w === '*' ? ['*'] : w[0] === '@' ? ['@', w.slice(1)] : w[0] === '<' ? ['<', w.slice(1)] : (([a, z]) => ['..', a, z])(w.split('..'))));
const printWin = (w) => (w[0] === '*' ? '*' : w[0] === '..' ? `${w[1]}..${w[2] ?? ''}` : w[0] + w[1]);
const shiftGate = (g, off) => windows(g).map((w) => (w[0] === '*' ? w : w[0] === '..' ? ['..', w[1] ? shiftPoint(w[1], off) : w[1], w[2] ? shiftPoint(w[2], off) : w[2]] : [w[0], shiftPoint(w[1], off)])).map(printWin).join(', ');
const oneWin = (g, op) => { const w = windows(g); if (w.length !== 1 || w[0][0] === '*') throw err('E_ATOM_ARG', `.${op}() needs a single-window gate, got "${g}"`); return w[0]; };
const splitRef = (s) => { const i = s.lastIndexOf('/'); const scope = i < 0 ? '' : s.slice(0, i), rest = s.slice(i + 1), j = rest.indexOf(':'); return { scope, name: j < 0 ? rest : rest.slice(0, j), facet: j < 0 ? '' : rest.slice(j + 1) }; };
const joinRef = ({ scope, name, facet }) => `${scope ? scope + '/' : ''}${name}${facet ? ':' + facet : ''}`;
const SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'], PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function transposeName(name, semi) { // note name with optional octave, or number
  if (/^-?\d+(\.\d+)?$/.test(name)) return String(+name + semi);
  const m = /^([a-gA-G])([#bs]*)(-?\d+)?$/.exec(name); if (!m) throw err('E_ATOM_ARG', `cannot transpose "${name}"`);
  let pc = PC[m[1].toLowerCase()]; for (const c of m[2]) pc += c === 'b' ? -1 : 1;
  const total = pc + semi + (m[3] != null ? 12 * +m[3] : 0), oct = Math.floor(total / 12), idx = ((total % 12) + 12) % 12;
  const n = SHARP[idx]; return (m[1] === m[1].toUpperCase() ? n.toUpperCase() : n) + (m[3] != null ? oct : '');
}

// ---- param shapes
const SHAPE_RE = { sound: /^[\w-]+(:\d+)?$/, name: /^[A-Za-z_][\w-]*$/, note: /^([a-gA-G][#bs]*-?\d*|-?\d+(\.\d+)?)$/ };
function checkArg(k, spec, v) { // -> text
  const bad = (m) => err('E_ATOM_ARG', `param "${k}": ${m}`);
  switch (spec.shape) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`expected a number, got ${JSON.stringify(v)}`);
      if (spec.min != null && v < spec.min) throw bad(`${v} is below min ${spec.min}`);
      if (spec.max != null && v > spec.max) throw bad(`${v} is above max ${spec.max}`);
      if (spec.step) { const q = (v - (spec.min ?? 0)) / spec.step; if (Math.abs(q - Math.round(q)) > 1e-9) throw bad(`${v} is not a multiple of step ${spec.step}`); }
      return String(v);
    }
    case 'enum': { const o = (spec.options || []).map((x) => (isObj(x) ? x.value : x)); if (!o.includes(v)) throw bad(`${JSON.stringify(v)} is not one of ${JSON.stringify(o)}`); return String(v); }
    case 'bool': if (typeof v !== 'boolean') throw bad('expected true or false'); return String(v);
    case 'note': case 'sound': case 'name': case 'mini':
      if (typeof v !== 'string' && !(spec.shape === 'note' && typeof v === 'number')) throw bad(`expected a ${spec.shape} string, got ${JSON.stringify(v)}`);
      if (SHAPE_RE[spec.shape] && !SHAPE_RE[spec.shape].test(String(v))) throw bad(`"${v}" is not a ${spec.shape}`);
      return String(v);
    default: if (v === null || typeof v === 'object') throw bad('expected a scalar'); return String(v);
  }
}

// ---- rendering
const newSt = () => ({ stack: [] });
function flat(env, rec, seen = []) { // follow `from` chains without ops: { type, all, preset, body, owner } (or { ops, fromRef })
  if (seen.includes(rec)) throw err('E_ATOM_CYCLE', `atoms reference each other in a loop (${[...seen, rec].map((r) => r.name).join(' -> ')})`);
  if (!rec.from) return { type: rec.type, all: rec.params || {}, preset: {}, body: rec.body, owner: rec };
  const f = rec.from.atom !== undefined ? { $atom: rec.from.atom, args: rec.from.args || {}, ops: rec.from.ops || [] } : toRef(env, rec.from);
  const parent = lookup(env, f.$atom); if (!parent) throw err('E_ATOM_UNKNOWN', `unknown atom "${f.$atom}" in from of "${rec.name}"`);
  if (f.ops.length) { flat(env, parent, [...seen, rec]); return { type: rec.type, all: {}, preset: {}, ops: true, fromRef: f, owner: rec }; }
  const p = flat(env, parent, [...seen, rec]);
  return { ...p, type: rec.type, preset: { ...p.preset, ...f.args } };
}
const remainingOf = (f) => Object.keys(f.all).filter((k) => !(k in f.preset));

function evalRef(env, ref0, st) {
  const ref = toRef(env, ref0), rec = lookup(env, ref.$atom); if (!rec) throw err('E_ATOM_UNKNOWN', `unknown atom "${ref.$atom}"`);
  let v = instantiate(env, rec, ref.args, st);
  for (const [op, ...a] of ref.ops) v = applyOp(env, v, op, a, st);
  return v;
}
const argText = (env, x, type, st, what) => {
  if (isObj(x) && ('$atom' in x || '$segs' in x)) { const v = evalRef(env, x, st); if (v.type !== type) throw err('E_ATOM_TYPE', `${what}: expected a ${type} atom, got ${v.type}`); return v.text; }
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  throw err('E_ATOM_ARG', `${what}: expected a ${type} atom or a literal`);
};
function instantiate(env, rec, args, st = newSt()) {
  if (st.stack.includes(rec)) throw err('E_ATOM_CYCLE', `atoms reference each other in a loop (${[...st.stack, rec].map((r) => r.name).join(' -> ')})`);
  st.stack.push(rec);
  try {
    const f = flat(env, rec);
    if (f.ops) {
      if (Object.keys(args).length) throw err('E_ATOM_ARG', `"${rec.name}" has no params left`);
      const v = evalRef(env, f.fromRef, st);
      if (rec.type !== v.type && rec.type !== 'text') throw err('E_ATOM_TYPE', `atom "${rec.name}" is declared ${rec.type} but its source is ${v.type}`);
      return { ...v, type: rec.type, rec: undefined };
    }
    const merged = { ...f.preset, ...args }; const vals = {};
    for (const k of Object.keys(merged)) if (!(k in f.all)) throw err('E_ATOM_ARG', `atom "${rec.name}" has no param "${k}"`);
    for (const [k, spec] of Object.entries(f.all)) {
      let v = k in merged ? merged[k] : spec.default;
      if (v === undefined) throw err('E_ATOM_ARITY', `atom "${rec.name}": param "${k}" is required (no default)`);
      if (/^atom:/.test(spec.shape || '')) {
        const want = spec.shape.slice(5);
        if (isObj(v) && ('$atom' in v || '$segs' in v)) { const a = evalRef(env, v, st); if (a.type !== want) throw err('E_ATOM_TYPE', `param "${k}" takes a ${want} atom, got ${a.type}`); vals[k] = { text: a.text, atom: true, type: a.type }; }
        else if (typeof v === 'string') vals[k] = { text: v, atom: true, type: want };
        else throw err('E_ATOM_ARG', `param "${k}" takes a ${want} atom`);
      } else vals[k] = { text: checkArg(k, spec, v), raw: v };
    }
    const res = evalBody(env, f.body, f, vals, st, f.type);
    const T = typeOf(rec.type);
    if (res.type !== rec.type) { if (!(res.type === 'text' || rec.type === 'text')) throw err('E_ATOM_TYPE', `atom "${rec.name}" is ${rec.type} but its body is ${res.type}`); }
    validateText(T, res, rec.name);
    return { type: rec.type, text: res.text, obj: res.obj, rec, args: merged };
  } finally { st.stack.pop(); }
}
const hole = (s, vals, T) => s.replace(/\$\{(\w+)\}/g, (_, k) => {
  if (!(k in vals)) throw err('E_ATOM_ARG', `\${${k}} has no param`);
  return vals[k].atom && T.compiles === 'pattern' ? wrapB(vals[k].text) : vals[k].text;
});
function evalBody(env, body, f, vals, st, type) {
  const T = typeOf(type);
  const sub = (x) => (typeof x === 'string' ? hole(x, vals, T) : Array.isArray(x) ? x.map(sub) : isObj(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sub(v)])) : x);
  const node = (n) => {
    if (typeof n === 'string') return { type, text: hole(n, vals, T) };
    if (typeof n === 'number') return { type, text: String(n) };
    if (isObj(n)) {
      if ('$atom' in n || '$segs' in n) { const r = toRef(env, n); const a = {}; for (const [k, v] of Object.entries(r.args)) a[k] = isObj(v) && '$param' in v ? vals[v.$param]?.raw ?? vals[v.$param]?.text : v; return evalRef(env, { ...r, args: a }, st); }
      if ('$param' in n) { const p = vals[n.$param]; if (!p) throw err('E_ATOM_ARG', `$param "${n.$param}" has no param`); return { type: p.type || type, text: p.text }; }
      const op = Object.keys(n).find((k) => /^\$(seq|stack|alt|rep|slow|euclid|union|shift)$/.test(k));
      if (op) {
        const a = n[op], name = op.slice(1), kids = (list) => list.map((x) => { const v = node(x); if (v.type !== type && v.type !== 'text') throw err('E_ATOM_TYPE', `${op}: ${v.type} atom inside a ${type} body`); return v.text; });
        if (name === 'shift') return { type, text: type === 'point' ? shiftPoint(node(a[0]).text, a[1]) : shiftGate(node(a[0]).text, a[1]) };
        if (['rep', 'slow', 'euclid'].includes(name)) { const [x, ...r] = a; return { type, text: PRINT[name](kids([x])[0], ...r) }; }
        return { type, text: PRINT[name](kids(a)) };
      }
      return { type, obj: sub(n) };
    }
    throw err('E_ATOM_ARG', 'bad atom body');
  };
  return node(body);
}

function applyOp(env, v, op, a, st) {
  const T = typeOf(v.type);
  if (!T.ops.includes(op)) throw err('E_ATOM_TYPE', `${v.type} atoms have no .${op}()`);
  const A = (x, type = v.type) => argText(env, x, type, st, `.${op}()`), t = v.text, mk = (type, text) => ({ type, text });
  switch (op) {
    case 'seq': case 'stack': case 'alt': return mk(v.type, PRINT[op]([t, ...a.map((x) => A(x))]));
    case 'rep': case 'slow': return mk(v.type, PRINT[op](t, a[0]));
    case 'euclid': return mk(v.type, PRINT.euclid(t, ...a));
    case 'n': return mk('sound', `${t}:${num(a[0], 'sound index')}`);
    case 'root': {
      if (!v.rec || !('root' in flat(env, v.rec).all)) throw err('E_ATOM_ARG', `.root() needs an atom with a "root" param`);
      return instantiate(env, v.rec, { ...v.args, root: a[0] }, st);
    }
    case 'transpose': {
      const s = num(a[0], 'semitones');
      if (v.type === 'chord') { const m = /^([A-Ga-g][#b]?)(.*)$/.exec(t); if (!m) throw err('E_ATOM_ARG', `bad chord "${t}"`); return mk('chord', transposeName(m[1], s) + m[2]); }
      return mk(v.type, transposeName(t, s));
    }
    case 'union': return mk('gate', PRINT.union([t, ...a.map((x) => A(x))]));
    case 'shift': return mk(v.type, v.type === 'point' ? shiftPoint(t, a[0]) : shiftGate(t, a[0]));
    case 'until': { const w = oneWin(t, op), p = A(a[0], 'point'); return mk('gate', w[0] === '@' ? `${w[1]}..${p}` : w[0] === '..' ? `${w[1] || ''}..${p}` : `<${p}`); }
    case 'from': { const w = oneWin(t, op), p = A(a[0], 'point'), z = w[0] === '<' ? w[1] : w[0] === '..' ? w[2] : ''; return mk('gate', z ? `${p}..${z}` : `@${p}`); }
    case 'after': return mk('gate', `@${t}`);
    case 'before': return mk('gate', `<${t}`);
    case 'to': return mk('gate', `${t}..${A(a[0], 'point')}`);
    case 'facet': { const r = splitRef(t); return mk('tapref', joinRef({ ...r, facet: A(a[0], 'name') })); }
    case 'in': { const r = splitRef(t); return mk(v.type === 'name' ? 'slot' : v.type, joinRef({ ...r, scope: A(a[0], 'name') })); }
    case 'pipe': return mk('hook', [t, ...a.map((x) => A(x))].join(' | '));
    case 'wrap': return mk('hook', `${A(a[0], 'name')}[${t}]`);
    default: throw err('E_ATOM_TYPE', `unknown op .${op}()`);
  }
}

// ---- validators (docs/ATOMS.md section 3)
const rx = (re, what) => (s) => { if (!re.test(s)) throw new Error(`not a valid ${what}: "${s}"`); };
const CHORD = rx(/^[A-G][#b]*[^\s\[\]<>*\/!@?,|~]*$/, 'chord symbol');
const VALID = {
  mini: (s) => { if (CFG.mini) CFG.mini(s); },
  sound: rx(SHAPE_RE.sound, 'sound name'), bank: rx(/^[\w-]+$/, 'bank name'), note: rx(SHAPE_RE.note, 'note'), name: rx(SHAPE_RE.name, 'name'),
  chord: CHORD, scale: rx(/^[A-Ga-g][#b]*-?\d*(:[A-Za-z0-9 ]+)+$/, 'scale (root:mode)'),
  progression: (s) => { if (CFG.mini) CFG.mini(s); for (const tok of s.split(/[\s\[\]<>,|]+/).filter(Boolean)) { const c = tok.replace(/[*\/!@?:(].*$/, ''); if (c && c !== '~' && c !== '-') CHORD(c); } },
  gate: (s) => CFG.parsers?.gate(s), point: (s) => CFG.parsers?.point(s),
  tapref: (s) => CFG.parsers?.ref(s),
  slot: (s) => { const r = CFG.parsers?.ref(s); if (r && r.facet) throw new Error(`a slot has no facet: "${s}"`); },
  'hook-expr': (s) => CFG.parsers?.expr(s),
  voicing: () => {}, none: () => {},
};
function validateText(T, v, name) {
  try {
    if (T.validator === 'voicing') { const o = v.obj; if (!isObj(o) || Object.keys(o).some((k) => !['dict', 'anchor', 'mode', 'offset'].includes(k))) throw new Error('voicing keys are dict, anchor, mode, offset'); return; }
    if (v.text === undefined) throw new Error('expected a string');
    (VALID[T.validator] || VALID.none)(v.text);
  } catch (e) { throw err('E_ATOM_GRAMMAR', `atom "${name}" (${T.id}): ${String(e.message).split('\n')[0]}`); }
}
const literal = (v, rec) => {
  const T = typeOf(v.type);
  if (T.compiles === 'object') return JSON.stringify(v.obj);
  const q = T.quote === '"' ? '"' : T.quote === 'as declared' ? (rec?.quote === '"' ? '"' : "'") : "'";
  return q === '"' ? JSON.stringify(v.text) : `'${v.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
};

// ---------------------------------------------------------------- public: apply / derive / render / runtime
const recOf = (env, x) => (typeof x === 'string' ? lookup(env, x) : x);
// render an atom (name | record) with args to { type, text|obj } (defaults applied; E_ATOM_ARG / E_ATOM_ARITY on bad args)
export function render(env, atom, args = {}) { const rec = recOf(env, atom); if (!rec) throw err('E_ATOM_UNKNOWN', `unknown atom "${atom}"`); return instantiate(env, rec, args); }
// partial application: a derived atom whose params are those not applied
export function apply(env, atom, args = {}) {
  const rec = recOf(env, atom); if (!rec) throw err('E_ATOM_UNKNOWN', `unknown atom "${atom}"`);
  const f = flat(env, rec); if (f.ops) throw err('E_ATOM_ARG', `"${rec.name}" has no params`);
  for (const [k, v] of Object.entries(args)) { if (!(k in f.all)) throw err('E_ATOM_ARG', `atom "${rec.name}" has no param "${k}"`); if (!/^atom:/.test(f.all[k].shape || '')) checkArg(k, f.all[k], v); }
  const preset = { ...f.preset, ...args }, remaining = Object.keys(f.all).filter((k) => !(k in preset));
  return { type: rec.type, params: Object.fromEntries(remaining.map((k) => [k, f.all[k]])), remaining, from: { atom: rec.name, args: { ...args } } };
}
// resolve one reference ({ $atom, args?, ops? } | { $segs } | name) to its compiled value { type, text | obj }
export function resolve(env, ref) { return evalRef(env, ref, newSt()); }
// the params still open on an atom (name | record), with their shapes: signature help, literal editors, map destinations
export function paramsOf(env, atom) {
  const rec = recOf(env, atom); if (!rec) throw err('E_ATOM_UNKNOWN', `unknown atom "${atom}"`);
  const f = flat(env, rec); if (f.ops) return {};
  return Object.fromEntries(remainingOf(f).map((k) => [k, f.all[k]]));
}
// every declared `point` atom as a marker (ATOMS section 3: a point atom *is* a marker) -> [{ name, point }]
export function pointMarkers(env) {
  const out = [];
  for (const rec of env.byName.values()) { if (rec.type !== 'point') continue; try { out.push({ name: rec.name, point: instantiate(env, rec, {}).text }); } catch { /* needs args: not a marker */ } }
  return out;
}
// named derivation: a record to declare (same as atom("name", { type, from: atoms.parent({...}) }))
export const derive = (env, name, derived, extra = {}) => ({ name, type: derived.type, from: { atom: derived.from.atom, args: derived.from.args }, ...extra });
// runtime fallback: frozen object, members are compiled strings (param-less atoms) or functions returning them
export function runtimeAtoms(env) {
  const root = {};
  for (const rec of env.byName.values()) {
    const f = flat(env, rec); const val = (a) => { const v = instantiate(env, rec, a || {}); return v.obj ?? v.text; };
    const m = Object.keys(f.all).length && !f.ops ? (a) => val(a) : (() => { try { return val(); } catch { return (a) => val(a); } })();
    const parts = rec.name.split('.'); let o = root; for (const p of parts.slice(0, -1)) o = o[p] ||= {}; o[parts.at(-1)] = m;
  }
  return deepFreeze(root);
}

// ---------------------------------------------------------------- compile pass
// -> { code, map: [{ from, to, outFrom, outTo, atom }], refs: [{ id, atom, args, path, from, to, type }], warnings: [{ code, message, ...span }] }
// opts.overrides: { <atom id | name>: { param: value } } merged into the args of every reference to that atom
// (ATOMS section 10, mapped atom params: a control mapped to `atom:<id>.<param>` recompiles with the live value).
export function compile(code, env, opts = {}) {
  const none = { code, map: [], refs: [], warnings: [] };
  if (!/\batoms?\b/.test(code)) return none; // idempotent on code with no atoms: every existing program is already valid
  return analyze(code, env, opts.diag || null, opts);
}
function analyze(code, env, diag, opts = {}) {
  const sc = scan(code); env ||= buildEnv(code, opts.extra, { diag });
  const fail = (e) => { if (!diag || !(e instanceof AtomError)) throw e; diag.push(e); };
  const warnings = [], warn = (c, m, a) => warnings.push({ code: c, message: m, ...a }); const edits = [], refs = [];
  for (const r of env.decls) { // validate each declaration (reported at the declaration)
    try { withAt(r.at, () => { typeOf(r.type, opts.strict); const f = flat(env, r); if (f.ops || Object.values(f.all).every((p) => p.default !== undefined)) instantiate(env, r, {}); }); } catch (e) { fail(e); }
  }
  for (const d of [...sc.decls, ...sc.imports]) { let to = d.stmt[1]; if (code[to] === '\r') to++; if (code[to] === '\n') to++; edits.push({ from: d.stmt[0], to, text: '' }); }
  const used = new Set();
  for (const s of sc.sites) {
    const at = spanOf(code, s.from, s.to);
    if (s.dynamic) { warn('W_ATOM_DYNAMIC', 'non-static atom reference runs through the runtime fallback and is not tracked', at); continue; }
    try {
      const v = withAt(at, () => {
        let ref; try { ref = toRef(env, { $segs: s.segs }); } catch (e) { throw e; }
        const ov = opts.overrides; // mapped atom params: the live value wins over the written arg
        if (ov) { const r0 = lookup(env, ref.$atom); const o = ov[ref.$atom] || (r0 && r0.id ? ov[r0.id] : null); if (o) ref = { ...ref, args: { ...ref.args, ...o } }; }
        s.ref = ref; const v = evalRef(env, ref, newSt());
        const acc = s.callee && CFG.positions?.[s.callee]?.[s.arg];
        if (acc && !acc.includes(v.type) && v.type !== 'text') throw err('E_ATOM_TYPE', `a ${v.type} atom does not fit argument ${s.arg} of ${s.callee}() (expects ${acc.join(' | ')})`);
        return v;
      });
      const rec = lookup(env, s.ref.$atom); used.add(rec.name);
      if (rec.origin === 'catalog' && inCatalog(rec.cat, rec.key) === false) {
        if (rec.cat === 'snd' || rec.cat === 'bank') warn('W_ATOM_UNKNOWN_SOUND', `${rec.cat === 'snd' ? 'sound' : 'bank'} "${rec.key}" is not in the catalog (it may load later)`, at);
        else throw err('E_ATOM_UNKNOWN', `${rec.cat} "${rec.key}" is not in the catalog`, at);
      }
      edits.push({ from: s.from, to: s.to, text: literal(v, rec), atom: rec.name });
      refs.push({ id: s.id, atom: rec.name, ...(rec.id && { atomId: rec.id }), args: s.ref.args, ops: s.ref.ops, path: s.segs.filter((x) => x.prop !== undefined).map((x) => x.prop).join('.'), from: s.from, to: s.to, type: v.type });
    } catch (e) { fail(e); }
  }
  // unused / duplicate declarations (warnings)
  const mention = new Set(); const walkRefs = (x) => { if (!x || typeof x !== 'object') return; if (x.$segs) { try { mention.add(toRef(env, x).$atom); } catch { /* reported elsewhere */ } for (const s of x.$segs) if (s.call) s.call.forEach(walkRefs); return; } if (x.$atom) mention.add(x.$atom); if (x.from?.atom) mention.add(x.from.atom); Object.values(x).forEach(walkRefs); };
  for (const r of env.decls) { walkRefs(r.body); walkRefs(r.from); walkRefs(r.params); }
  const same = new Map();
  for (const r of env.decls) {
    if (!used.has(r.name) && !mention.has(r.name) && !sc.sites.some((s) => s.dynamic)) warn('W_ATOM_UNUSED', `atom "${r.name}" is declared and never referenced`, r.at);
    try { const f = flat(env, r); if (!f.ops && !Object.keys(f.all).length) { const v = instantiate(env, r, {}), k = r.type + '\0' + (v.text ?? JSON.stringify(v.obj)); if (same.has(k)) warn('W_ATOM_DUP', `atoms "${same.get(k)}" and "${r.name}" compile to the same ${r.type} string`, r.at); else same.set(k, r.name); } } catch { /* reported above */ }
  }
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  let outCode = '', pos = 0; const map = [];
  for (const e of edits) {
    if (e.from < pos) continue; // inside an already replaced span
    outCode += code.slice(pos, e.from); const outFrom = outCode.length; outCode += e.text; pos = e.to;
    if (e.atom) map.push({ from: e.from, to: e.to, outFrom, outTo: outCode.length, atom: e.atom });
  }
  outCode += code.slice(pos);
  return { code: outCode, map, refs, warnings };
}
// output offset -> the reference's source span (null when the offset is outside every compiled literal)
export function locate(code, res, outOffset) { const m = res.map.find((x) => outOffset >= x.outFrom && outOffset < x.outTo); return m ? { ...spanOf(code, m.from, m.to), atom: m.atom } : null; }
// Strudel/mini error (with .location.start.offset inside the literal when available) -> the reference span in the source
export function errorSpan(code, res, e, hint) {
  const o = e?.location?.start?.offset; const lit = hint != null ? res.map.find((x) => hint >= x.outFrom && hint < x.outTo) : res.map[0];
  if (!lit) return null; return locate(code, res, o != null ? lit.outFrom + 1 + o : lit.outFrom);
}

// check: all diagnostics at once (section 8). strict: unknown type ids are errors.
export function check(code, extra = {}, opts = {}) {
  const diag = []; let res = null;
  try { res = compile(code, null, { diag, extra, strict: opts.strict }); } catch (e) { if (!(e instanceof AtomError)) throw e; diag.push(e); }
  const fmt = (e) => ({ code: e.code, message: e.message, ...(e.at || {}) });
  return { errors: diag.map(fmt), warnings: res?.warnings || [], ok: !diag.length, refs: res?.refs || [] };
}
export const buildAndCompile = (code, extra, opts) => { const env = buildEnv(code, extra); return { env, ...compile(code, env, opts) }; };

// ---------------------------------------------------------------- ids, hashes, reconciliation (section 7)
// structural site id (control binding: `r` + 6 base-36 chars of FNV-1a(path)); same rule for code reference sites and model ref paths
export const siteId = (path) => 'r' + b36(FNV(path));
export const idFor = (type, name, taken = new Set()) => { let id = 'a' + b36(FNV(`${type}/${name}`)), n = 2; const base = id; while (taken.has(id)) id = base + (n++).toString(36); return id; };
const hashOf = (rec) => 'sha256:' + modelHash({ type: rec.type, params: rec.params ?? null, ...(rec.from ? { from: rec.from } : { body: rec.body }) });
export const atomHash = hashOf;
// declared (env.decls) vs previous model atoms (id -> record) -> { atoms: id -> record, ids: name -> id, renamed: [{ from, to, id }], notInCode: [id] }
export function reconcile(prev = {}, env, { keep = new Set() } = {}) {
  const decls = env.decls, ids = {}, taken = new Set(Object.keys(prev)), matchedPrev = new Set();
  const byNameType = new Map(Object.entries(prev).map(([id, a]) => [`${a.type}/${a.name}`, id]));
  for (const d of decls) { const id = byNameType.get(`${d.type}/${d.name}`); if (id) { ids[d.name] = id; matchedPrev.add(id); } }
  const nameOf = (x) => (typeof x === 'string' ? x : x.$atom);
  const norm = (x) => { // names -> ids so renames of a dependency do not change the hash of its users
    if (Array.isArray(x)) return x.map(norm);
    if (!isObj(x)) return x;
    if (x.$segs) { const r = toRef(env, x); return { $atom: ids[r.$atom] || r.$atom, args: norm(r.args), ...(r.ops.length && { ops: norm(r.ops) }) }; }
    if (typeof x.$atom === 'string') return { ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)])), $atom: ids[nameOf(x)] || x.$atom };
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)]));
  };
  const content = (d) => ({ type: d.type, ...(d.params && { params: norm(d.params) }), ...(d.from !== undefined ? { from: (() => { const r = toRef(env, d.from.atom !== undefined ? { $atom: d.from.atom, args: d.from.args, ops: d.from.ops } : d.from); return { atom: ids[r.$atom] || r.$atom, ...(Object.keys(r.args).length && { args: norm(r.args) }), ...(r.ops.length && { ops: norm(r.ops) }) }; })() } : { body: norm(d.body) }) });
  const fresh = decls.filter((d) => !ids[d.name]);
  for (const d of fresh) { const id = idFor(d.type, d.name, taken); taken.add(id); ids[d.name] = id; }
  const renamed = [];
  for (const d of fresh) { // a vanished name + a new name, same type and same content hash -> rename, id kept
    const h = hashOf(content(d));
    const old = Object.entries(prev).find(([id, a]) => !matchedPrev.has(id) && !decls.some((x) => x.name === a.name) && a.type === d.type && a.hash === h);
    if (old) { taken.delete(ids[d.name]); ids[d.name] = old[0]; matchedPrev.add(old[0]); renamed.push({ from: old[1].name, to: d.name, id: old[0] }); }
  }
  const atoms = {};
  for (const d of decls) {
    const c = content(d), h = hashOf(c), id = ids[d.name], p = prev[id];
    const rec = { name: d.name, ...c, ...(d.doc && { doc: d.doc }), ...(d.tags && { tags: d.tags }), ...(d.quote && { quote: d.quote }), hash: h };
    if (!p) { rec.rev = 1; } else if (p.hash === h) { rec.rev = p.rev; if (p.parent) rec.parent = p.parent; } else { rec.rev = p.rev + 1; rec.parent = p.hash; }
    atoms[id] = rec;
  }
  const notInCode = [];
  for (const [id, a] of Object.entries(prev)) if (!atoms[id] && keep.has(id)) { atoms[id] = a; notInCode.push(id); }
  return { atoms, ids, renamed, notInCode };
}

// ---------------------------------------------------------------- model references and graph cards (sections 4, 9)
// every `$atom` reference in a model (outside `atoms`) with its structural site id: [{ id, atom, path, ref }]
export function modelRefs(model = {}) {
  const out = [], walk = (x, path) => {
    if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${path}/${i}`));
    if (!isObj(x)) return;
    if (typeof x.$atom === 'string') { // the reference itself, then the references nested in its args / ops
      out.push({ id: siteId(path), atom: x.$atom.replace(/@\d+$/, ''), path, ref: x });
      for (const k of ['args', 'ops']) if (x[k]) walk(x[k], `${path}/${k}`);
      return;
    }
    for (const [k, v] of Object.entries(x)) walk(v, `${path}/${k}`);
  };
  for (const [k, v] of Object.entries(model)) if (k !== 'atoms') walk(v, `/${k}`);
  return out;
}
// cards on reference (section 9): one entry per *referenced* atom, built from the reference list, never from model.atoms
export function atomCards(model = {}) {
  const atoms = model.atoms || {}, by = new Map();
  for (const r of modelRefs(model)) {
    const rec = atoms[r.atom] || null;
    const e = by.get(r.atom) || { id: `atom:${r.atom}`, kind: 'atom', atom: r.atom, name: rec ? rec.name : r.atom, type: rec ? rec.type : null, refs: [], count: 0 };
    e.refs.push({ id: r.id, path: r.path }); e.count++; by.set(r.atom, e);
  }
  return [...by.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- model checks (section 4)
const CATALOG_REF = /^(snd|bank|scale|chord):/;
// every { $atom } in a model must be defined in model.atoms (or be a catalog ref); returns [{ code, path, message }]
export function checkModel(model) {
  const out = [], atoms = model.atoms || {}, walk = (x, path) => {
    if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${path}/${i}`));
    if (!isObj(x)) return;
    if (typeof x.$atom === 'string') { const id = x.$atom.replace(/@\d+$/, ''); if (!atoms[id] && !CATALOG_REF.test(id)) out.push({ code: 'E_ATOM_UNKNOWN', path, message: `$atom "${x.$atom}" has no definition` }); }
    for (const [k, v] of Object.entries(x)) walk(v, `${path}/${k}`);
  };
  walk({ ...model, atoms: undefined }, '');
  for (const [id, a] of Object.entries(atoms)) { const f = a.from?.atom; if (f && !atoms[f]) out.push({ code: 'E_ATOM_UNKNOWN', path: `/atoms/${id}/from`, message: `from "${f}" has no definition` }); if (a.hash && a.hash !== atomHash(a)) out.push({ code: 'E_ATOM_HASH', path: `/atoms/${id}`, message: `hash mismatch for "${a.name}"` }); }
  return out;
}
