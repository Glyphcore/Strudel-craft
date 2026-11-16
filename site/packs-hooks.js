// Pack kind `hooks` on the site (#91, docs/PACK_SPEC.md section 5): installs the chain-only defs of hooks@1 ingredients into the hooks registry.
// Imported lazily (engine/index.js sc.packHooks), only when a program names a pack that ships a hooks ingredient. Data only: nothing here evaluates text.
// Defs are data (method chains with literal args). A def with `opaque: true` or a `$code` arg is code: never installed here, since this host has no
// sandbox path that can express a hook def (the sandbox runs declared modules, not defs); it stays refused with the grant error and a visible notice.
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const isCodeDef = (d) => !isObj(d) || d.opaque === true || JSON.stringify(d).includes('"$code"');
const canon = (x) => JSON.stringify(x, (k, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((n) => [n, v[n]])) : v)); // toJSON sorts keys
const same = (a, b) => canon(a) === canon(b);

// Validation (security, #91 rework): pack data is never trusted as names or code. Chain steps are an ALLOWLIST (below), names are conservative identifiers that are not
// members of Object.prototype / Function.prototype, arguments are JSON data only. A step is never resolved with `obj[name]` here; the runtime only ever sees names
// that passed `allow.has(name)` (a Set lookup).
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/, STEP = /^[A-Za-z][A-Za-z0-9]*$/;
const RESERVED = new Set([...Object.getOwnPropertyNames(Object.prototype), ...Object.getOwnPropertyNames(Function.prototype), '__proto__', 'prototype', 'constructor']);
// Pattern methods that run a function or re-enter the query machinery: never chainable from data, even when Strudel registers them.
const NEVER = new Set(['apply', 'fmap', 'bind', 'innerBind', 'outerBind', 'squeezeBind', 'resetBind', 'restartBind', 'withValue', 'withValues', 'withHap', 'withHaps', 'withQuerySpan', 'withQueryTime', 'withQueryState', 'withHapSpan', 'withHapTime', 'query', 'queryArc', 'eval', 'Function']);
const DEF_KEYS = new Set(['chain', 'params', 'decorator', 'doc', 'description', 'folder', 'tags', 'aliases']); // folder, tags, aliases: filing data (PACK_SPEC 5.3), validated below; the runtime ignores them
export const safeName = (n) => typeof n === 'string' && n.length <= 64 && NAME.test(n) && !RESERVED.has(n);
// allowlist source: Strudel's own registry of chainable methods = the enumerable function properties `register()` and the controls put on Pattern.prototype (class
// methods such as `constructor` / inherited Object members are not enumerable own properties), plus the hooks engine's methods; minus NEVER and every reserved name.
export function chainable(Pattern) {
  const proto = Pattern && Pattern.prototype, set = new Set();
  if (proto) for (const k of Object.keys(proto)) if (typeof proto[k] === 'function' && STEP.test(k) && !RESERVED.has(k) && !NEVER.has(k)) set.add(k);
  return Object.freeze({ has: (n) => typeof n === 'string' && set.has(n), size: set.size });
}
const LIM = { depth: 8, nodes: 20000, str: 4096, arr: 1024, chain: 1000, defs: 5000 };
const BADKEY = new Set(['__proto__', 'constructor', 'prototype']);
function json(v, b, depth, path) { // JSON data only; returns an error message or null
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
        if (!STEP.test(st[0]) || RESERVED.has(st[0]) || NEVER.has(st[0]) || !allow || !allow.has(st[0])) return bad(k, `def "${k}": step "${String(st[0]).slice(0, 40)}" is not a chainable method`);
        for (let j = 1; j < st.length; j++) { const e = json(st[j], b, 0, `def "${k}" step ${i} arg ${j}`); if (e) bad(k, e); }
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
    for (const [k, v] of Object.entries(d[m])) { if (!/^[A-Za-z][\w-]*$/.test(k) || RESERVED.has(k)) bad(k, `${m} name "${k}" is not allowed`); const e = json(v, b, 0, `${m} ${k}`); if (e) bad(k, e); }
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
    const errors = validate(d, opts.allow); // atomic per ingredient: one bad def installs nothing of this ingredient
    if (errors.length) {
      invalid.push({ ingredient: q, code: 'E_PACK_HOOKS_INVALID', errors });
      const key = q + '!' + errors[0].message; if (!st.told.has(key)) { st.told.add(key); notify(`${q}: hooks ingredient not loaded (E_PACK_HOOKS_INVALID: ${errors[0].message}${errors.length > 1 ? `; ${errors.length - 1} more` : ''})`); }
      for (const [k, v] of Object.entries(d.defs || {})) if (isCodeDef(v)) bad.push(k);
    } else {
      for (const [k, v] of Object.entries(d.defs || {})) { if (isCodeDef(v)) bad.push(k); else if (!defs.has(k)) defs.set(k, v); }
      for (const [m, into] of [['slots', slots], ['markers', markers], ['scopes', scopes]]) for (const [k, v] of Object.entries(d[m] || {})) if (!into.has(k)) into.set(k, v);
    }
    if (bad.length) {
      const i = info[q] || {}, code = (i.reason && i.reason.code) || 'E_PACK_CODE_GRANT';
      refused.push({ ingredient: q, defs: bad, code });
      const key = q + '@' + (i.codeHash || ''); if (!st.told.has(key)) { st.told.add(key); notify(`${q}: ${bad.length} code-bearing hook def${bad.length > 1 ? 's' : ''} not loaded (${code}: this host runs no pack code for hooks); the chain-only defs are loaded`); }
    }
  }
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
