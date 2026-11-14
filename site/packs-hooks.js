// Pack kind `hooks` on the site (#91, docs/PACK_SPEC.md section 5): installs the chain-only defs of hooks@1 ingredients into the hooks registry.
// Imported lazily (engine/index.js sc.packHooks), only when a program names a pack that ships a hooks ingredient. Data only: nothing here evaluates text.
// Defs are data (method chains with literal args). A def with `opaque: true` or a `$code` arg is code: never installed here, since this host has no
// sandbox path that can express a hook def (the sandbox runs declared modules, not defs); it stays refused with the grant error and a visible notice.
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const isCodeDef = (d) => !isObj(d) || d.opaque === true || JSON.stringify(d).includes('"$code"');
const canon = (x) => JSON.stringify(x, (k, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((n) => [n, v[n]])) : v)); // toJSON sorts keys
const same = (a, b) => canon(a) === canon(b);

// entries: [{pack, ingredient, data}] in precedence order (higher first; within a pack, manifest order); first definition of a name wins.
// st: { defs: Map name -> def we installed last time, told: Set }; info[qualified]: the loader's view of the ingredient ({ code, state, reason, codeHash }).
// notify(message): the visible notice. Idempotent: every call re-installs the wanted defs (a reset in between is repaired) and removes the ones no longer wanted.
export function install(H, entries, st, info = {}, notify = () => {}) {
  const defs = new Map(), slots = new Map(), markers = new Map(), scopes = new Map(), refused = [];
  for (const e of entries) {
    const d = e.data || {}, q = `${e.pack}:${e.ingredient}`, bad = [];
    for (const [k, v] of Object.entries(d.defs || {})) { if (isCodeDef(v)) bad.push(k); else if (!defs.has(k)) defs.set(k, v); }
    for (const [m, into] of [['slots', slots], ['markers', markers], ['scopes', scopes]]) for (const [k, v] of Object.entries(d[m] || {})) if (!into.has(k)) into.set(k, v);
    if (bad.length) {
      const i = info[q] || {}, code = (i.reason && i.reason.code) || 'E_PACK_CODE_GRANT';
      refused.push({ ingredient: q, defs: bad, code });
      const key = q + '@' + (i.codeHash || ''); if (!st.told.has(key)) { st.told.add(key); notify(`${q}: ${bad.length} code-bearing hook def${bad.length > 1 ? 's' : ''} not loaded (${code}: this host runs no pack code for hooks); the chain-only defs are loaded`); }
    }
  }
  const gone = [...st.defs.keys()].filter((k) => !defs.has(k));
  if (gone.length) { let cur = {}; try { cur = JSON.parse(H.toJSON()).defs || {}; } catch (e) { cur = {}; } for (const k of gone) { if (same(cur[k], st.defs.get(k))) H.undef(k); } }
  const doc = { model: 1, markers: Object.fromEntries(markers), scopes: Object.fromEntries(scopes), slots: Object.fromEntries(slots), defs: Object.fromEntries(defs) };
  if (defs.size || slots.size || markers.size || scopes.size) H.load(doc);
  st.defs = new Map(defs); st.refused = refused;
  return { defs: [...defs.keys()], refused };
}
