// Atom consumers (docs/ATOMS.md section 10; issue #63): the data every consumer needs - intellisense items, literal-editor shapes for
// reference args, hooks / pads / boards / maps resolution of `$atom`, atom-param map destinations, revision records and pack ingredients.
// Pure ES module (no DOM, no Strudel): the site wires it in site/atoms-site.js, the CLI imports the same file. UI drawing is #64.
import * as A from './atoms.js';
import * as M from './atoms-migrate.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const err = (code, message) => { const e = new A.AtomError(code, message); return e; };
export const MAX_ITEMS = 50; // catalog namespaces answer by prefix query, never in full (ATOMS 2.7, 9)

// ---------------------------------------------------------------- environment helpers
// env from a model (plus optional code and imports): `atoms` entries are the environment, nothing is enumerated from the catalogs
export const envOf = (model = {}, { code = '', imports } = {}) => A.buildEnv(code, { atoms: model.atoms || {}, ...(imports && { imports }) });
const preview = (env, rec) => { try { const v = A.resolve(env, { $atom: rec.name }); return v.text ?? JSON.stringify(v.obj); } catch { return null; } };
const paramText = (ps) => Object.entries(ps).map(([k, s]) => `${k}: ${s.shape}${s.shape === 'number' ? ` ${s.min ?? ''}..${s.max ?? ''}${s.unit ? ' ' + s.unit : ''}` : ''}${s.default !== undefined ? ` = ${JSON.stringify(s.default)}` : ''}`).join('; ');
export const refText = (name, args = {}, ops = []) => `atoms.${name}${Object.keys(args).length ? `({ ${Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} })` : ''}${ops.map(([o, ...a]) => `.${o}(${a.map((x) => JSON.stringify(x)).join(', ')})`).join('')}`;

// types accepted at a call argument position (data/atoms/positions.json), or null when the position is not constrained
export function typesAt(callee, arg) {
  const p = A.config().positions || {};
  const row = p[callee] || (callee && !callee.startsWith('.') && !callee.startsWith('hooks.') ? p['.' + callee] : null);
  const list = row && row[String(arg)];
  return list && list.length ? list : null;
}
// does an atom type fit a typed-param shape (strudel.json `params`)? `text` fits anywhere (ATOMS 3)
export function fitsShape(type, shape) {
  const T = A.types().find((t) => t.id === type); if (!T) return false;
  return T.id === 'text' || !shape || (T.shape || []).includes(shape);
}

// ---------------------------------------------------------------- 1. intellisense provider data (ATOMS 10, "Intellisense")
const item = (env, rec, extra = {}) => {
  let ps = {}; try { ps = A.paramsOf(env, rec.name); } catch { /* unresolvable: still offered */ }
  const pv = preview(env, rec);
  const keys = Object.keys(ps);
  const apply = keys.length ? `atoms.${rec.name}({ ${keys.map((k) => `${k}: ${JSON.stringify(ps[k].default ?? ps[k].min ?? '')}`).join(', ')} })` : `atoms.${rec.name}`;
  return { label: `atoms.${rec.name}`, atom: rec.name, type: rec.type, category: 'atoms', string: false,
    detail: pv != null ? `${rec.type} ${pv}` : rec.type, info: [rec.doc, paramText(ps) || null].filter(Boolean).join('\n') || rec.type, apply, ...extra };
};
// atoms offered in an argument position: filtered by the position's accepted types, else by the param shape. Declared atoms only
// (catalog namespaces are never enumerated); at most `limit` items.
export function argItems(env, { callee, arg, shape, prefix = '', limit = MAX_ITEMS } = {}) {
  const want = typesAt(callee, arg);
  const out = [];
  for (const rec of env.byName.values()) {
    if (want ? !want.includes(rec.type) && rec.type !== 'text' : !fitsShape(rec.type, shape)) continue;
    if (prefix && !rec.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    out.push(item(env, rec));
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
// member completion after `atoms.`: names, namespaces, and catalog entries by prefix query (never the full catalog)
export function memberItems(env, { path = '', shape, types, limit = MAX_ITEMS } = {}) {
  const out = [], seen = new Set();
  const want = types && types.length ? types : null;
  const ok = (rec) => (want ? want.includes(rec.type) || rec.type === 'text' : !shape || fitsShape(rec.type, shape));
  for (const rec of env.byName.values()) {
    if (!rec.name.startsWith(path)) continue;
    const rest = rec.name.slice(path.length);
    if (rest.includes('.')) { const ns = rest.split('.')[0]; if (!seen.has(ns)) { seen.add(ns); out.push({ label: `atoms.${path}${ns}`, category: 'atoms', detail: 'namespace', info: 'atom namespace', namespace: true }); } continue; }
    if (ok(rec)) out.push(item(env, rec));
    if (out.length >= limit) return out.slice(0, limit);
  }
  const cat = /^(snd|bank|scale|chord)\.?(.*)$/.exec(path);
  // the catalog namespaces always exist (catalog atoms are synthesised on reference, ATOMS 2.7); their contents are never listed
  if (!cat) for (const ns of ['snd', 'bank', 'scale', 'chord']) {
    if (!ns.startsWith(path) || seen.has(ns)) continue;
    out.push({ label: `atoms.${ns}`, category: 'atoms', detail: 'catalog namespace', info: 'type a prefix to search the catalog', namespace: true });
  }
  if (cat && cat[1]) { // catalog namespace: prefix query against the configured catalog, capped
    const c = (A.config().catalog || {})[cat[1]];
    const keys = c instanceof Set ? [...c] : Array.isArray(c) ? c : isObj(c) ? Object.keys(c) : [];
    const pre = cat[2].toLowerCase();
    for (const k of keys) {
      if (pre && !String(k).toLowerCase().startsWith(pre)) continue;
      out.push({ label: `atoms.${cat[1]}.${k}`, atom: `${cat[1]}.${k}`, type: cat[1] === 'snd' ? 'sound' : cat[1], category: 'atoms', detail: `${cat[1]} catalog`, info: String(k) });
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}
// signature help inside `atoms.name(`: the open params with their ranges, plus value suggestions inside min..max
export function signature(env, name) {
  const rec = env.get(name); if (!rec) return null;
  let ps; try { ps = A.paramsOf(env, rec.name); } catch { return null; }
  const params = Object.entries(ps).map(([k, s]) => ({ name: k, shape: s.shape, min: s.min, max: s.max, step: s.step, unit: s.unit, options: s.options, default: s.default, values: values(s) }));
  return { fn: `atoms.${rec.name}`, type: rec.type, params, info: rec.doc || '' };
}
export function values(spec) { // value suggestions by shape; numbers respect min..max
  if (spec.shape === 'number') {
    const lo = spec.min, hi = spec.max, step = spec.step;
    const cand = [spec.default, lo, hi, lo != null && hi != null ? (step ? Math.round(((lo + hi) / 2) / step) * step : (lo + hi) / 2) : undefined];
    return [...new Set(cand.filter((v) => typeof v === 'number' && (lo == null || v >= lo) && (hi == null || v <= hi)))];
  }
  if (spec.shape === 'enum') return (spec.options || []).map((o) => (isObj(o) ? o.value : o));
  if (spec.shape === 'bool') return [true, false];
  return spec.default !== undefined ? [spec.default] : [];
}
// "use atoms.name" on a string literal equal to an atom's compiled output (ATOMS 11 `parse`); rewrites only that literal
export function literalAction(env, { text, callee, arg, types } = {}) {
  const want = types || typesAt(callee, arg) || A.types().map((t) => t.id);
  for (const t of want) {
    let hit = null; try { hit = M.parse(t, text, env); } catch { hit = null; }
    if (hit) { // M.parse gives the record, its args and the ops that reproduce the string
      const name = typeof hit.atom === 'string' ? hit.atom : hit.atom.name;
      const ref = refText(name, hit.args, hit.ops || []);
      return { label: `use ${ref}`, apply: ref, atom: name, args: hit.args, ops: hit.ops || [], type: t };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 2. reference sites and literal-editor shapes
const callsOf = (node) => { const out = []; let n = node; for (;;) { if (n.type === 'CallExpression') { out.push(n); n = n.callee; } else if (n.type === 'MemberExpression') n = n.object; else break; } return out.reverse(); };
// reference sites in code: one site per reference (the popover's data) plus its arg literal sites with their atomParam shapes
export function sites(code, env) {
  const out = [];
  let sc; try { sc = A.scan(code); } catch { return out; }
  for (const s of sc.sites) {
    if (s.dynamic || !s.segs) continue;
    let ref, rec, v;
    try { ref = A.toRef(env, { $segs: s.segs }); rec = env.get(ref.$atom); if (!rec) continue; v = A.resolve(env, ref); } catch { continue; }
    let ps = {}; try { ps = A.paramsOf(env, rec.name); } catch { /* derived */ }
    const args = [];
    const call = callsOf(s.node).find((c) => c.arguments.length === 1 && c.arguments[0].type === 'ObjectExpression');
    if (call) for (const p of call.arguments[0].properties) {
      if (p.type !== 'Property' || p.computed) continue;
      const k = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
      const spec = ps[k] || (rec.params || {})[k];
      if (spec) args.push({ param: k, from: p.value.start, to: p.value.end, shape: { name: k, ...spec } });
    }
    out.push({ id: s.id, atom: rec.name, atomId: rec.id || null, type: rec.type, text: v.text ?? JSON.stringify(v.obj), args: ref.args, ops: ref.ops,
      from: s.from, to: s.to, params: ps, argSites: args, doc: rec.doc || '',
      actions: ['edit', 'derive', 'detach', 'card'], detach: literalOf(rec, v) });
  }
  return out;
}
const literalOf = (rec, v) => { const T = A.types().find((t) => t.id === rec.type); const q = T && T.quote === '"' ? '"' : "'"; const t = v.text ?? JSON.stringify(v.obj); return q === '"' ? JSON.stringify(t) : `'${String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; };
// the atomParam shape of a literal inside a reference's args ({ from, to } of the literal), or null
export function shapeAt(code, env, from, to) {
  for (const s of sites(code, env)) for (const a of s.argSites) if (a.from === from && (to == null || a.to === to)) return a.shape;
  return null;
}
// popover data for one reference site (compiled string, params, actions); UI is #64
export function siteData(code, env, siteId) { return sites(code, env).find((s) => s.id === siteId) || null; }

// ---------------------------------------------------------------- 3. model references, cards, targets
// reference sites and graph cards live in the core module (model.js uses them too)
export const modelRefs = A.modelRefs;
export const atomCards = A.atomCards;
// resolve a target that may be a `$atom` reference (pad target.ref, board cell ref, map dest, hooks slot/hook/gate) to its string
export function target(env, ref) {
  if (!isObj(ref) || !('$atom' in ref)) return ref;
  const v = A.resolve(env, ref);
  return v.text ?? v.obj;
}
export const targetsOf = (env, model) => Object.fromEntries(modelRefs(model).map((r) => [r.id, target(env, r.ref)]));

// ---------------------------------------------------------------- 4. mapped atom params (ATOMS 10, "Controls, pads, boards")
export const ATOM_DEST = /^atom:([A-Za-z0-9_:.-]+)\.([A-Za-z_]\w*)$/;
const eligible = (body, param) => { // a `${param}` hole in repeat (`*`/`/`) or whole-step position
  if (typeof body !== 'string') return false;
  const re = new RegExp(`\\$\\{${param}\\}`, 'g'); let m, seen = false;
  while ((m = re.exec(body))) {
    seen = true;
    const before = body[m.index - 1], after = body[m.index + m[0].length];
    const rep = before === '*' || before === '/';
    const step = (before === undefined || ' [<,|'.includes(before)) && (after === undefined || ' ]>,|*/'.includes(after));
    if (!rep && !step) return false;
  }
  return seen;
};
// check a map destination `atom:<id>.<param>`: only number params of `mini` atoms in repeat or step position (else E_ATOM_ARG)
export function checkMapDest(env, dest) {
  const m = ATOM_DEST.exec(String(dest)); if (!m) throw err('E_ATOM_ARG', `map destination "${dest}" is not atom:<id>.<param>`);
  const [, id, param] = m, rec = env.get(id);
  if (!rec) throw err('E_ATOM_UNKNOWN', `map destination "${dest}": no atom "${id}"`);
  const spec = (A.paramsOf(env, rec.name) || {})[param] || (rec.params || {})[param];
  if (!spec) throw err('E_ATOM_ARG', `atom "${rec.name}" has no param "${param}"`);
  if (rec.type !== 'mini') throw err('E_ATOM_ARG', `only mini atoms can be mapped live, "${rec.name}" is ${rec.type}`);
  if (spec.shape !== 'number') throw err('E_ATOM_ARG', `param "${param}" is ${spec.shape}, only number params can be mapped`);
  if (!eligible(rec.body, param)) throw err('E_ATOM_ARG', `param "${param}" of "${rec.name}" is not in repeat or step position`);
  return { atom: rec.name, id, param, spec };
}
// map entries + current control values -> compile overrides ({ atomId: { param: value } }); invalid destinations raise E_ATOM_ARG
export function mapOverrides(env, maps = [], valueOf = () => undefined) {
  const out = {};
  for (const mp of maps) {
    if (!ATOM_DEST.test(String(mp.dest))) continue;
    const d = checkMapDest(env, mp.dest);
    const v = valueOf(mp.control, mp);
    if (v === undefined) continue;
    const spec = d.spec, lo = spec.min ?? 0, hi = spec.max ?? 1, step = spec.step;
    let x = mp.range ? mp.range[0] + v * (mp.range[1] - mp.range[0]) : typeof v === 'number' && v >= 0 && v <= 1 && (lo !== 0 || hi !== 1) ? lo + v * (hi - lo) : v;
    if (step) x = Math.round(x / step) * step;
    (out[d.id] ||= {})[d.param] = Math.min(hi, Math.max(lo, x));
  }
  return out;
}

// ---------------------------------------------------------------- 5. hooks runtime (ATOMS 10, "Hooks")
// atom ids next to the resolved strings ({ <atom id>: compiled string }, what hooks.plan / toJSON / the journal carry)
// plus the markers every `point` atom registers
export function hooksData(env, { ids = {} } = {}) {
  const map = {}, markers = {};
  for (const rec of env.byName.values()) {
    const id = rec.id || ids[rec.name]; if (!id) continue;
    let v; try { v = A.resolve(env, { $atom: rec.name }); } catch { continue; }
    if (typeof v.text !== 'string') continue;
    map[id] = v.text;
    if (rec.type === 'point') markers[rec.name.split('.').pop()] = v.text;
  }
  return { map, markers };
}
// register the atom id map and the point markers on a hooks runtime (hooks.atoms, hooks.marker)
export function installHooks(hooks, env, opts = {}) {
  const d = hooksData(env, opts);
  for (const [name, point] of Object.entries(d.markers)) hooks.marker(name, point);
  if (hooks.atoms && typeof hooks.atoms.use === 'function') hooks.atoms.use({ map: d.map, resolve: opts.resolve || ((ref) => target(env, ref)) });
  return d;
}

// ---------------------------------------------------------------- 6. revision records (ATOMS 7; history kind "atom")
// prev / next are model `atoms` maps (as reconcile() returns them) -> one record per new revision
export function revisions(prev = {}, next = {}, meta = {}) {
  const out = [];
  for (const [id, a] of Object.entries(next)) {
    const p = prev[id];
    if (p && p.hash === a.hash) continue;
    out.push({ kind: 'atom', id, name: a.name, type: a.type, rev: a.rev, hash: a.hash, ...(a.parent ? { parent: a.parent } : {}), ...meta });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id) || a.rev - b.rev);
}

// ---------------------------------------------------------------- 7. pack ingredients (ATOMS 10, PACK_SPEC 5.1 kind `atoms`)
export const FORMAT = 'atoms@1';
// dependency closure of a set of atom ids inside one `atoms` map (from chains, `$atom` in bodies / params / args)
export function depsOf(atoms = {}, ids = []) {
  const out = new Set(), queue = [...ids];
  const walk = (x) => { if (Array.isArray(x)) return x.forEach(walk); if (!isObj(x)) return; if (typeof x.$atom === 'string') queue.push(x.$atom.replace(/@\d+$/, '')); if (x.atom && typeof x.atom === 'string' && atoms[x.atom]) queue.push(x.atom); Object.values(x).forEach(walk); };
  while (queue.length) {
    const id = queue.shift(); if (out.has(id) || !atoms[id]) continue;
    out.add(id); const a = atoms[id];
    if (a.from) { queue.push(a.from.atom); walk(a.from.args); }
    walk(a.body); walk(a.params);
  }
  return [...out].sort();
}
// atoms a model (component, board, bank, ...) references, closed under dependencies: the `deps` of its pack ingredient
export const modelDeps = (model = {}) => depsOf(model.atoms || {}, [...new Set(modelRefs(model).map((r) => r.atom))].filter((id) => (model.atoms || {})[id]));
const requiresOf = (atoms, ids) => { const sounds = new Set(); for (const id of ids) { const a = atoms[id]; if (a && (a.type === 'sound' || a.type === 'bank') && typeof a.body === 'string') sounds.add(a.body.split(':')[0]); } return sounds.size ? { sounds: [...sounds].sort() } : {}; };
// one ingredient record per atom (kind "atom") - ATOMS 10
export function atomIngredient(atoms, id) {
  const a = atoms[id]; if (!a) throw err('E_ATOM_UNKNOWN', `no atom "${id}"`);
  const deps = depsOf(atoms, [id]).filter((x) => x !== id);
  return { kind: 'atom', id, rev: a.rev ?? 1, hash: a.hash || A.atomHash(a), name: a.name, type: a.type, deps, requires: requiresOf(atoms, [id, ...deps]) };
}
// a namespace of atoms as one ingredient (kind "atomset") with its entry-file data ({ format, atoms })
export function atomsetIngredient(atoms, { id, ids = Object.keys(atoms), name } = {}) {
  const closure = depsOf(atoms, ids);
  const data = { format: FORMAT, atoms: Object.fromEntries(closure.map((k) => [k, { ...atoms[k], hash: atoms[k].hash || A.atomHash(atoms[k]) }])) };
  const deps = closure.filter((k) => !ids.includes(k));
  return { kind: 'atomset', id, name: name || id, format: FORMAT, items: closure.map((k) => atoms[k].name).sort(), deps, requires: requiresOf(atoms, closure), data };
}
// verify a pinned ingredient: every atom's hash must match its content (E_ATOM_HASH)
export function verifyIngredient(ing) {
  const atoms = (ing && (ing.data ? ing.data.atoms : ing.atoms)) || {};
  for (const [id, a] of Object.entries(atoms)) {
    const h = A.atomHash(a);
    if (a.hash && a.hash !== h) throw err('E_ATOM_HASH', `atom "${a.name}" (${id}) does not match its hash`);
    if (ing.pins && ing.pins[id] && ing.pins[id] !== h) throw err('E_ATOM_HASH', `atom "${a.name}" (${id}) does not match the pinned revision`);
  }
  return true;
}
// imported atoms for buildEnv({ imports: { "pack:…": … } }): verified and pinned; the `as` namespace is applied by buildEnv
// from the `atoms.import("pack:…", { as })` statement in the code.
export function importedAtoms(ing) {
  verifyIngredient(ing);
  const atoms = (ing && (ing.data ? ing.data.atoms : ing.atoms)) || {};
  return Object.fromEntries(Object.entries(atoms).map(([id, a]) => [id, { ...a, pack: ing.id }]));
}
