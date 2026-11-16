// Pack kind `hooks` on the site (#91, docs/PACK_SPEC.md section 5): installs the chain-only defs of hooks@1 ingredients into the hooks registry.
// Imported lazily (engine/index.js sc.packHooks), only when a program names a pack that ships a hooks ingredient. Data only: nothing here evaluates text.
// Defs are data (method chains with literal args). A def with `opaque: true` or a `$code` arg is code: never installed here, since this host has no
// sandbox path that can express a hook def (the sandbox runs declared modules, not defs); it stays refused with the grant error and a visible notice.
import { expandAliasDefs } from './engine/aliases.js';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const isCodeDef = (d) => !isObj(d) || d.opaque === true || JSON.stringify(d).includes('"$code"');
const canon = (x) => JSON.stringify(x, (k, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((n) => [n, v[n]])) : v)); // toJSON sorts keys
const same = (a, b) => canon(a) === canon(b);

// Validation (security, #91 rework 2): pack data is never trusted as names or code. Chain steps are a POSITIVE ALLOWLIST committed as data (site/data/hooks-steps.json: reviewed
// method names, each with the argument shapes it accepts; review rule in that file and docs/PACK_SPEC.md 5.2). A method not in the file is rejected, whatever the runtime has;
// the runtime check (method must exist on Pattern.prototype) only narrows further. Arguments are scalars (finite number, string, boolean, null) unless the method's entry
// declares a structured shape (`param`, `mini`, `wire-opts`); arrays and other objects are rejected. A step is never resolved with `obj[name]` here.
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/, STEP = /^[A-Za-z][A-Za-z0-9]*$/, IDENT = /^[A-Za-z_]\w{0,63}$/, EXPR = /^[\w\s.+\-*/()]+$/;
const RESERVED = new Set([...Object.getOwnPropertyNames(Object.prototype), ...Object.getOwnPropertyNames(Function.prototype), '__proto__', 'prototype', 'constructor']);
// Pattern methods that run a function or re-enter the query machinery: never chainable from data (belt and braces: none is in the data file).
const NEVER = new Set(['apply', 'fmap', 'bind', 'innerBind', 'outerBind', 'squeezeBind', 'resetBind', 'restartBind', 'withValue', 'withValues', 'withHap', 'withHaps', 'withQuerySpan', 'withQueryTime', 'withQueryState', 'withHapSpan', 'withHapTime', 'query', 'queryArc', 'eval', 'Function']);
const DEF_KEYS = new Set(['chain', 'params', 'decorator', 'doc', 'description', 'folder', 'tags', 'aliases']); // folder, tags, aliases: filing data (PACK_SPEC 5.3), validated below; the runtime ignores them
export const safeName = (n) => typeof n === 'string' && n.length <= 64 && NAME.test(n) && !RESERVED.has(n);
const SHAPES = new Set(['scalar', 'param', 'mini', 'wire-opts', 'groove-opts']);
const GROOVE_KEYS = new Set(['swing', 'push', 'jitter', 'vel', 'drift', 'seed', 'grid']); // site/engine/groove.js GROOVE_PARAMS: numbers only, clamped there
export async function loadSteps(url = new URL('./data/hooks-steps.json', import.meta.url)) { const r = await fetch(url); if (!r.ok) throw new Error('hooks-steps.json: HTTP ' + r.status); return r.json(); }
// allowlist = the methods named in the data file `doc` that ALSO exist as own enumerable functions on Pattern.prototype (what register() and the controls put there) and are not reserved / NEVER.
// Returns { has(name), args(name) -> shapes[], limits, size }. Never widens the runtime; an entry with an unknown shape name is dropped.
export function chainable(Pattern, doc) {
  const proto = Pattern && Pattern.prototype, set = new Map(), wires = new Set(), M = (doc && doc.methods) || {};
  const lim = { str: 256, args: 6, expr: 64, ...((doc && doc.limits) || {}) };
  if (proto) for (const k of Object.keys(M)) {
    const a = M[k] && Array.isArray(M[k].args) ? M[k].args : ['scalar'];
    if (Object.prototype.hasOwnProperty.call(proto, k) && typeof proto[k] === 'function' && STEP.test(k) && !RESERVED.has(k) && !NEVER.has(k) && a.every((x) => SHAPES.has(x))) { set.set(k, Object.freeze([...a])); if (M[k].wire === true) wires.add(k); }
  }
  return Object.freeze({ has: (n) => typeof n === 'string' && set.has(n), args: (n) => set.get(n) || [], wireTarget: (n) => typeof n === 'string' && wires.has(n), limits: Object.freeze(lim), size: set.size });
}
// Reviewed list of sound sources backed by an expression-compiling or generator worklet (Strudel: bytebeat, zzfx and its z_* waveforms). A data def must not select them (any token of a
// s/sound string or $mini). Sample names and plain oscillators stay open: `bank` only prefixes sample banks, and a name that is no source plays nothing.
const WORKLET_SRC = (v) => typeof v === 'string' && (v.match(/[A-Za-z0-9_]+/g) || []).some((t) => /^(bytebeat|zzfx|z_[a-z0-9_]*)$/i.test(t));
const LIM = { depth: 8, nodes: 20000, str: 4096, arr: 1024, chain: 1000, defs: 5000 };
const BADKEY = new Set(['__proto__', 'constructor', 'prototype']);
function json(v, b, depth, path) { // JSON data only (params, docs, slots...); returns an error message or null
  if (++b.n > LIM.nodes) return `${path}: too large`;
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path}: non-finite number`;
  if (typeof v === 'string') return v.length <= LIM.str ? null : `${path}: string too long`;
  if (depth >= LIM.depth) return `${path}: nested too deep`;
  if (Array.isArray(v)) { if (v.length > LIM.arr) return `${path}: array too long`; for (let i = 0; i < v.length; i++) { const e = json(v[i], b, depth + 1, `${path}[${i}]`); if (e) return e; } return null; }
  if (isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    for (const k of Object.keys(v)) { if (BADKEY.has(k) || k.length > 64) return `${path}: key "${k}" is not allowed`; const e = json(v[k], b, depth + 1, `${path}.${k}`); if (e) return e; }
    return null;
  }
  return `${path}: not JSON data`;
}
const plain = (v) => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const scalar = (v, lim) => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= lim.str);
// one step argument against the shapes its method declares; returns an error message or null
function arg(v, shapes, lim, params, path) {
  if (scalar(v, lim)) return null;
  const ks = plain(v) ? Object.keys(v) : null;
  if (!ks) return `${path}: ${Array.isArray(v) ? 'arrays are not accepted here' : 'not an accepted argument'} (scalars only: number, string, boolean, null)`;
  const has = (p) => Object.prototype.hasOwnProperty.call(params, p);
  if (shapes.includes('param') && ks.length === 1 && ks[0] === '$param') return typeof v.$param === 'string' && IDENT.test(v.$param) && !RESERVED.has(v.$param) && has(v.$param) ? null : `${path}: $param must name a param of this def`;
  if (shapes.includes('mini') && ks.length === 1 && ks[0] === '$mini') return typeof v.$mini === 'string' && v.$mini.length <= lim.str ? null : `${path}: $mini must be a string of at most ${lim.str} characters`;
  if (shapes.includes('groove-opts') && ks.length && ks.length <= GROOVE_KEYS.size && ks.every((k) => GROOVE_KEYS.has(k))) { // declarative: named numbers or {$param}, never code
    for (const k of ks) { const x = v[k]; if (typeof x === 'number' && Number.isFinite(x)) continue; if (plain(x) && Object.keys(x).length === 1 && typeof x.$param === 'string' && IDENT.test(x.$param) && !RESERVED.has(x.$param) && has(x.$param)) continue; return `${path}.${k}: must be a finite number or {"$param": "<param of this def>"}`; }
    return null;
  }
  if (shapes.includes('wire-opts') && ks.every((k) => k === 'range' || k === 'op' || k === 'r')) {
    const num = (x) => (typeof x === 'number' && Number.isFinite(x)) || (plain(x) && Object.keys(x).length === 1 && typeof x.$expr === 'string' && x.$expr.length <= lim.expr && EXPR.test(x.$expr) && (x.$expr.match(/[A-Za-z_]\w*/g) || []).every((n) => !RESERVED.has(n) && has(n)));
    if (v.range !== undefined && !(Array.isArray(v.range) && v.range.length === 2 && v.range.every(num))) return `${path}: range must be [a, b] of numbers or {"$expr"} over the def params`;
    if (v.op !== undefined && !(typeof v.op === 'string' && /^[a-z]{1,16}$/.test(v.op))) return `${path}: op must be a lowercase word`;
    if (v.r !== undefined && !(typeof v.r === 'number' && Number.isFinite(v.r))) return `${path}: r must be a number`;
    return null;
  }
  return `${path}: object arguments are not accepted by this method`;
}
// returns [{ def, code, message }] for one ingredient (empty = valid)
export function validate(d, allow) {
  const errs = [], b = { n: 0 }, bad = (def, message) => errs.push({ def, code: 'E_PACK_HOOKS_INVALID', message });
  const defs = (d && d.defs) || {};
  if (Object.keys(defs).length > LIM.defs) bad(null, 'too many defs');
  for (const [k, v] of Object.entries(defs)) {
    if (!safeName(k)) { bad(k, `def name "${k}" is not allowed`); continue; }
    if (isCodeDef(v)) continue; // code-bearing: handled by the grant rule, never installed
    for (const x of Object.keys(v)) if (!DEF_KEYS.has(x)) bad(k, `def "${k}": key "${x}" is not allowed`);
    if (v.folder != null && !(typeof v.folder === 'string' && /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,7}$/.test(v.folder) && v.folder.length <= 80)) bad(k, `def "${k}": folder is not a valid slash path`);
    for (const f of ['tags', 'aliases']) if (v[f] != null && !(Array.isArray(v[f]) && v[f].length <= 24 && v[f].every((s) => typeof s === 'string' && s.length <= 64 && /^[A-Za-z0-9][\w.-]*$/.test(s)))) bad(k, `def "${k}": ${f} must be up to 24 short names`);
    if (v.chain != null) {
      if (!Array.isArray(v.chain) || v.chain.length > LIM.chain) { bad(k, `def "${k}": chain must be an array of at most ${LIM.chain} steps`); continue; }
      v.chain.forEach((st, i) => {
        if (!Array.isArray(st) || typeof st[0] !== 'string') return bad(k, `def "${k}": step ${i} must be [name, ...args]`);
        if (!STEP.test(st[0]) || RESERVED.has(st[0]) || NEVER.has(st[0]) || !allow || !allow.has(st[0])) return bad(k, `def "${k}": step "${String(st[0]).slice(0, 40)}" is not in the hooks step allowlist (site/data/hooks-steps.json)`);
        const sh = allow.args(st[0]), lim = allow.limits, ps = isObj(v.params) ? v.params : {};
        if (st[0] === 'wire' && !(typeof st[1] === 'string' && allow.wireTarget && allow.wireTarget(st[1]))) return bad(k, `def "${k}": step ${i} wire target "${String(st[1]).slice(0, 40)}" is not a wire-able control (site/data/hooks-steps.json, "wire": true)`);
        if (st.length - 1 > lim.args) return bad(k, `def "${k}": step "${st[0]}" has more than ${lim.args} arguments`);
        if ((st[0] === 's' || st[0] === 'sound') && st.slice(1).some((a) => WORKLET_SRC((a && typeof a === 'object') ? a.$mini : a))) return bad(k, `def "${k}": step ${i} "${st[0]}" selects an expression/worklet-backed source (bytebeat, zzfx), which a data-only def may not use`);
        for (let j = 1; j < st.length; j++) { const e = arg(st[j], sh, lim, ps, `def "${k}" step ${i} "${st[0]}" arg ${j}`); if (e) bad(k, e); }
      });
    }
    if (v.params != null) {
      if (!isObj(v.params)) bad(k, `def "${k}": params must be an object`);
      else for (const [pn, pv] of Object.entries(v.params)) { if (!safeName(pn)) bad(k, `def "${k}": param name "${pn}" is not allowed`); const e = json(pv, b, 0, `def "${k}" param ${pn}`); if (e) bad(k, e); }
    }
    for (const x of ['decorator', 'doc', 'description']) if (v[x] != null) { const e = json(v[x], b, 0, `def "${k}" ${x}`); if (e) bad(k, e); }
  }
  for (const m of ['slots', 'markers', 'scopes']) {
    if (d[m] == null) continue;
    if (!isObj(d[m])) { bad(null, `${m} must be an object`); continue; }
    for (const [k, v] of Object.entries(d[m])) { if (!/^[A-Za-z][\w-]*$/.test(k) || RESERVED.has(k)) bad(null, `${m} name "${k}" is not allowed`); const e = json(v, b, 0, `${m} ${k}`); if (e) bad(null, e); }
  }
  return errs;
}

// entries: [{pack, ingredient, data}] in precedence order (higher first; within a pack, manifest order); first definition of a name wins.
// st: { defs: Map name -> def we installed last time, told: Set }; info[qualified]: the loader's view of the ingredient ({ code, state, reason, codeHash }).
// notify(message): the visible notice. Idempotent: every call re-installs the wanted defs (a reset in between is repaired) and removes the ones no longer wanted.
export function install(H, entries, st, info = {}, notify = () => {}, opts = {}) {
  const defs = new Map(), slots = new Map(), markers = new Map(), scopes = new Map(), refused = [], invalid = [];
  st.told ||= new Set();
  for (const e of entries) {
    const d = isObj(e.data) ? e.data : {}, q = `${e.pack}:${e.ingredient}`, bad = [];
    const errors = validate(d, opts.allow); // granular: an invalid def is skipped (named in a notice) and the other valid defs load; an ingredient-level error (null def: too many defs, bad slots / markers / scopes) refuses the whole ingredient
    const whole = errors.some((x) => x.def == null), badDefs = new Set(errors.filter((x) => x.def != null).map((x) => x.def));
    if (errors.length) {
      invalid.push({ ingredient: q, code: 'E_PACK_HOOKS_INVALID', errors, skipped: whole ? undefined : [...badDefs] });
      const key = q + '!' + errors[0].message;
      if (!st.told.has(key)) { st.told.add(key); notify(whole ? `${q}: hooks ingredient not loaded (E_PACK_HOOKS_INVALID: ${errors[0].message}${errors.length > 1 ? `; ${errors.length - 1} more` : ''})` : `${q}: ${badDefs.size} hook def${badDefs.size > 1 ? 's' : ''} skipped (E_PACK_HOOKS_INVALID: ${errors[0].message}${errors.length > 1 ? `; ${errors.length - 1} more` : ''}; skipped: ${[...badDefs].slice(0, 6).join(', ')}${badDefs.size > 6 ? ', ...' : ''}); the other defs are loaded`); }
    }
    if (whole) {
      for (const [k, v] of Object.entries(d.defs || {})) if (isCodeDef(v)) bad.push(k);
    } else {
      for (const [k, v] of Object.entries(d.defs || {})) { if (isCodeDef(v)) bad.push(k); else if (!badDefs.has(k) && !defs.has(k)) defs.set(k, v); }
      for (const [m, into] of [['slots', slots], ['markers', markers], ['scopes', scopes]]) for (const [k, v] of Object.entries(d[m] || {})) if (!into.has(k)) into.set(k, v);
    }
    if (bad.length) {
      const i = info[q] || {}, code = (i.reason && i.reason.code) || 'E_PACK_CODE_GRANT';
      refused.push({ ingredient: q, defs: bad, code });
      const key = q + '@' + (i.codeHash || ''); if (!st.told.has(key)) { st.told.add(key); notify(`${q}: ${bad.length} code-bearing hook def${bad.length > 1 ? 's' : ''} not loaded (${code}: this host runs no pack code for hooks); the chain-only defs are loaded`); }
    }
  }
  { const ex = expandAliasDefs(Object.fromEntries(defs), opts.text); for (const [k, v] of Object.entries(ex.defs)) if (!defs.has(k)) defs.set(k, v); } // an old def name keeps working (PACK_SPEC 9.3 rule 8); one hint per alias the program uses
  const prev = st.defs || new Map();
  const gone = [...prev.keys()].filter((k) => !defs.has(k));
  if (gone.length) { let cur = {}; try { cur = JSON.parse(H.toJSON()).defs || {}; } catch (e) { cur = {}; } for (const k of gone) { if (same(cur[k], prev.get(k))) H.undef(k); } }
  const doc = { model: 1, markers: Object.fromEntries(markers), scopes: Object.fromEntries(scopes), slots: Object.fromEntries(slots), defs: Object.fromEntries(defs) };
  if (defs.size || slots.size || markers.size || scopes.size) {
    try { H.load(doc); } catch (e) { // validated data should not throw; if the runtime still refuses, undo what we added and report once
      for (const k of defs.keys()) { if (!prev.has(k)) H.undef(k); }
      invalid.push({ ingredient: '*', code: 'E_PACK_HOOKS_INVALID', errors: [{ def: null, code: e.code || 'E_PACK_HOOKS_INVALID', message: String(e.message) }] });
      const key = '*!' + e.message; if (!st.told.has(key)) { st.told.add(key); notify(`hooks pack data refused by the runtime (E_PACK_HOOKS_INVALID: ${e.message})`); }
      defs.clear();
    }
  }
  st.defs = new Map(defs); st.refused = refused; st.invalid = invalid;
  return { defs: [...defs.keys()], refused, invalid };
}
