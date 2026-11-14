// Component library (BLUEPRINT 6): versioned components, extract, embed, and instance/fragment expansion into a flat model.
// Standalone ES module; storage goes through ./library-store.js. Errors carry `.code` (E_COMPONENT_REQUIRES, _HASH, _CYCLE, ...).
import { hash as modelHash } from './model.js';
import { defaultStore } from './library-store.js';

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fail = (c, m) => Object.assign(new Error(`${c} ${m}`), { code: c });
const REF = /^([A-Za-z][\w-]*)@(\d+)$/;
const parseRef = (s) => { const m = REF.exec(s); if (!m) throw fail('E_BAD_REF', s); return { name: m[1], rev: +m[2] }; };
const baseOf = (r) => r.split(':')[0];
const TAPRE = /(\btap\(\s*)(["'`])([^"'`]+)\2/g;

// ---------------------------------------------------------------- records
// meta holds name, kind, rev, hash, parent, tags only (no personal data); layout is not part of a record.
function record(model, meta) {
  const r = clone(model); delete r.layout;
  const keep = { name: meta.name, kind: meta.kind, ...(meta.parent ? { parent: meta.parent } : {}), ...(meta.tags && meta.tags.length ? { tags: [...meta.tags] } : {}) };
  r.meta = keep; if (meta.exports) r.exports = clone(meta.exports);
  r.meta.hash = modelHash(r); r.meta.rev = meta.rev;
  return r;
}
export const verify = (rec, ref) => {
  if (!rec || !rec.meta || modelHash(rec) !== rec.meta.hash) throw fail('E_COMPONENT_HASH', `${ref || (rec && rec.meta && rec.meta.name)} content does not match its hash`);
  return rec;
};

export function createLibrary(store = defaultStore()) {
  const lib = {
    store,
    save(model, { name, kind, exports, tags } = {}) {
      if (!name || !kind) throw fail('E_BAD_ARG', 'save needs name and kind');
      const revs = store.revs(name), last = revs[revs.length - 1];
      if (last) { // identical content: hash it with the latest record's parent; equal -> existing rev, nothing stored
        const same = record(model, { name, kind, exports: exports ?? model.exports, tags, parent: last.parent, rev: last.rev });
        if (same.meta.hash === last.hash) return { name, rev: last.rev, hash: last.hash };
      }
      const rec = record(model, { name, kind, exports: exports ?? model.exports, tags, parent: last && last.hash, rev: revs.length + 1 });
      const r = store.put(rec); return { name, rev: r.rev, hash: r.hash };
    },
    get: (name, rev) => store.get(name, rev),
    list: (filter) => store.list(filter),
    revs: (name) => store.revs(name),
    extract: (model, nodeIds, opts) => extract(model, nodeIds, opts),
    embed: (model) => embed(model, (n, r) => store.get(n, r)),
    lookup: (n, r) => store.get(n, r),
  };
  return lib;
}

// ---------------------------------------------------------------- reads / publishes of a model piece
const rewriteCode = (text, f) => text.replace(TAPRE, (_, a, q, n) => `${a}${q}${f(n)}${q}`);
function mapValue(v, f) { // rename tap reads inside one step argument
  if (Array.isArray(v)) return v.map(x => mapValue(x, f));
  if (!isObj(v)) return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = k === '$tap' ? f(x) : k === '$code' ? rewriteCode(x, f) : mapValue(x, f);
  return o;
}
function eachRead(track, fn, pub) { // fn(read name); pub(published name)
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) for (const [k, x] of Object.entries(v)) { if (k === '$tap') fn(x); else if (k === '$code') for (const m of x.matchAll(TAPRE)) fn(m[3]); else walk(x); } };
  for (const s of [track.source, ...(track.chain || [])]) {
    if (!s) continue;
    if (s[0] === 'tap' && typeof s[1] === 'string') pub(s[1]); else if (s[0] === 'wire' && typeof s[2] === 'string') fn(s[2]); else walk(s.slice(1));
  }
  if (track.chain == null && track.source == null && track.src) for (const m of track.src.matchAll(TAPRE)) { const before = track.src[m.index - 1]; (before === '.' ? pub : fn)(m[3]); }
}

// ---------------------------------------------------------------- slot refs under a namespace
// A track-scoped slot ref "T/name" addresses the slot `name` of track T (HOOKS_SYNTAX 4.7). Instance tracks are renamed `${as}_${T}`
// (which is also their scope), so every ref to T/name follows: "bass/fx" -> "g_bass/fx". The result keeps ONE slash (the slot-ref grammar
// allows a single scope prefix). Refs with another scope (stem:/bus:/*) or a track outside the component are left alone.
const USERE = /(\.(?:use|wrap)\(\s*)(["'`])([^"'`]+)\2/g;
const slotUses = (t) => { const o = []; for (const s of [t.source, ...(t.chain || [])]) if (s && (s[0] === 'use' || s[0] === 'wrap') && typeof s[1] === 'string') o.push(s[1]); if (t.src) for (const m of t.src.matchAll(USERE)) o.push(m[3]); return o; };
export const scopedSlot = (slot, trackNames, as) => { const i = slot.indexOf('/'); if (i < 0) return slot; const sc = slot.slice(0, i).replace(/^track:/, ''); return trackNames.has(sc) ? `${as}_${sc}${slot.slice(i)}` : slot; };

// ---------------------------------------------------------------- extract
// nodeIds are graph ids: track:NAME, code:NAME, bind:ID. Returns a component model (not yet saved) with exports and requires computed.
export function extract(model, nodeIds, { kind } = {}) {
  const ids = new Set(nodeIds), tracks = [], bindings = [];
  for (const t of model.tracks || []) if (ids.has(`track:${t.name}`) || ids.has(`code:${t.name}`)) tracks.push(clone(t));
  (model.bindings || []).forEach((b, i) => { const id = b.id || `b${i + 1}`; if (ids.has(`bind:${id}`)) bindings.push(clone(b)); });
  if (!tracks.length && !bindings.length) throw fail('E_EMPTY_SELECTION', 'nothing selected');
  const reads = new Set(), pubs = new Set();
  for (const t of tracks) eachRead(t, (n) => reads.add(baseOf(n)), (n) => pubs.add(baseOf(n)));
  const defs = {}, vars = {};
  for (const b of bindings) { const h = b.hook.replace(/\(.*$/, ''); if ((model.defs || {})[h]) defs[h] = clone(model.defs[h]); }
  for (const n of [...reads]) if ((model.vars || {})[n] && !pubs.has(n)) { vars[n] = clone(model.vars[n]); reads.delete(n); }
  const requiresTaps = [...reads].filter(n => !pubs.has(n)).sort();
  const comp = { model: 1, ...(Object.keys(defs).length ? { defs } : {}), ...(Object.keys(vars).length ? { vars } : {}), ...(bindings.length ? { bindings } : {}), ...(tracks.length ? { tracks } : {}) };
  const used = new Set(); for (const t of tracks) for (const n of slotUses(t)) if (!n.includes('/')) used.add(`${t.name}/${n}`);
  comp.exports = { taps: [...pubs].sort(), slots: [...new Set([...bindings.map(b => b.slot), ...used])].sort(), params: {}, ...(requiresTaps.length ? { requires: { taps: requiresTaps } } : {}) };
  comp.meta = { kind: kind || (tracks.length === 1 && !bindings.length ? 'track' : 'set') };
  return comp;
}
export function replaceWithInstance(model, nodeIds, inst) {
  const m = clone(model), ids = new Set(nodeIds);
  m.tracks = (m.tracks || []).filter(t => !ids.has(`track:${t.name}`) && !ids.has(`code:${t.name}`));
  m.bindings = (m.bindings || []).filter((b, i) => !ids.has(`bind:${b.id || `b${i + 1}`}`));
  const moved = new Set((model.tracks || []).filter(t => ids.has(`track:${t.name}`) || ids.has(`code:${t.name}`)).map(t => t.name));
  m.bindings = m.bindings.map(b => ({ ...b, slot: scopedSlot(b.slot, moved, inst.as) })); // outside bindings follow the slots of tracks that moved into the instance
  if (!m.bindings.length) delete m.bindings; if (!m.tracks.length) delete m.tracks;
  (m.instances ||= []).push(clone(inst));
  return m;
}

// ---------------------------------------------------------------- embed
const refsOf = (m) => [...(m.instances || []).map(i => i.component), ...(m.bindings || []).map(b => /^lib:([A-Za-z][\w-]*@\d+)/.exec(b.hook)?.[1]).filter(Boolean)];
export function embed(model, lookup) {
  const m = clone(model), comps = (m.components ||= {});
  const add = (ref) => {
    if (comps[ref]) return;
    const { name, rev } = parseRef(ref), rec = lookup(name, rev);
    if (!rec) throw fail('E_COMPONENT_MISSING', ref);
    comps[ref] = verify(clone(rec), ref); refsOf(rec).forEach(add);
  };
  refsOf(m).forEach(add);
  if (!Object.keys(comps).length) delete m.components;
  return m;
}

// ---------------------------------------------------------------- expansion
// expand(model, { lookup }) -> flat model: instances replaced by their namespaced content, lib: hook-refs replaced by the fragment's def.
// Embedded components (model.components) are used first and verified; lookup(name, rev) is the fallback (library store or --library dir).
function fetch(ref, model, lookup) {
  const emb = (model.components || {})[ref];
  const rec = emb || (lookup && lookup(...Object.values(parseRef(ref))));
  if (!rec) throw fail('E_COMPONENT_MISSING', ref);
  return verify(clone(rec), ref);
}
function setParams(comp, args, ref) {
  const params = (comp.exports || {}).params || {};
  for (const k of Object.keys(args || {})) if (!(k in params)) throw fail('E_COMPONENT_ARG', `${ref} has no exported param "${k}"`);
  for (const [k, p] of Object.entries(params)) {
    const v = args && k in args ? args[k] : p.default; if (v === undefined || !p.target) continue;
    const t = /^track:([^#.]+)(?:#(\d+)\.(\d+))?$/.exec(p.target), d = /^def:([^.]+)\.(.+)$/.exec(p.target), r = /^var:(.+)$/.exec(p.target);
    if (t) { const tr = (comp.tracks || []).find(x => x.name === t[1]); const i = +t[2], step = tr && (i === 0 ? tr.source : (tr.chain || [])[i - 1]); if (!step) throw fail('E_COMPONENT_TARGET', p.target); step[+t[3] + 1] = v; delete tr.src; }
    else if (d) { const df = (comp.defs || {})[d[1]]; if (!df) throw fail('E_COMPONENT_TARGET', p.target); ((df.params ||= {})[d[2]] = isObj(df.params[d[2]]) ? { ...df.params[d[2]], default: v } : v); }
    else if (r) { const l = (comp.vars || {})[r[1]]; if (!l) throw fail('E_COMPONENT_TARGET', p.target); l[0].value = v; }
    else throw fail('E_COMPONENT_TARGET', p.target);
  }
}
function namespaced(comp, as, remap, ref) {
  const req = new Set(((comp.exports || {}).requires || {}).taps || []);
  for (const n of req) if (!(remap && n in remap)) throw fail('E_COMPONENT_REQUIRES', `${ref} requires tap "${n}": give remap: { ${n}: "host/tap" }`);
  const nsb = (b) => (b.includes('/') ? `${as}_${b}` : `${as}/${b}`); // nested instances: o + i/bass -> o_i/bass (tap refs allow one scope prefix)
  const rn = (n) => { const b = baseOf(n), f = n.slice(b.length); return (req.has(b) ? remap[b] : nsb(b)) + f; };
  const pn = (n) => nsb(baseOf(n)) + n.slice(baseOf(n).length);
  const out = { tracks: [], defs: {}, vars: {}, bindings: [] };
  const names = new Set((comp.tracks || []).map(t => t.name)), bound = new Set((comp.bindings || []).map(b => b.slot).filter(x => !x.includes('/')));
  const gs = (n) => (bound.has(n) ? `${as}/${n}` : n); // a global slot the component binds internally becomes the instance's slot as/name
  const fixUse = (s) => (s[0] === 'use' || s[0] === 'wrap') && typeof s[1] === 'string' ? [s[0], gs(s[1]), ...s.slice(2)] : s;
  for (const t of comp.tracks || []) {
    const c = clone(t); c.name = `${as}_${t.name}`; if (c.src !== undefined) { c.src = rewriteCode(c.src, rn); }
    const fix = (s) => s[0] === 'tap' && typeof s[1] === 'string' ? ['tap', pn(s[1]), ...s.slice(2)] : s[0] === 'wire' && typeof s[2] === 'string' ? ['wire', s[1], rn(s[2]), ...mapValue(s.slice(3), rn)] : [s[0], ...mapValue(s.slice(1), rn)];
    if (c.source) c.source = fix(c.source); if (c.chain) c.chain = c.chain.map(fix).map(fixUse);
    if (c.chain == null && c.source == null && c.src) { // text-only track: publishes (".tap(") get the namespace, reads follow requires
      c.src = t.src.replace(TAPRE, (_, a, q, n, off) => `${a}${q}${(t.src[off - 1] === '.' ? pn : rn)(n)}${q}`);
      c.src = c.src.replace(USERE, (_, a, q, n) => `${a}${q}${gs(n)}${q}`);
    } else delete c.src;
    out.tracks.push(c);
  }
  for (const [k, d] of Object.entries(comp.defs || {})) out.defs[`${as}/${k}`] = clone(d);
  for (const [k, l] of Object.entries(comp.vars || {})) out.vars[`${as}/${k}`] = clone(l);
  for (const b of comp.bindings || []) {
    const hm = /^([^(]+)(\(.*)?$/.exec(b.hook), h = (comp.defs || {})[hm[1]] ? `${as}/${hm[1]}${hm[2] || ''}` : b.hook;
    out.bindings.push({ ...clone(b), slot: b.slot.includes('/') ? scopedSlot(b.slot, names, as) : gs(b.slot), hook: h });
  }
  return out;
}
export function expand(model, { lookup, stack = [] } = {}) {
  const m = clone(model);
  const add = (key, v) => { Object.assign((m[key] ||= {}), v); };
  const emb = model.components || {};
  const insts = m.instances || []; delete m.instances;
  for (const i of insts) {
    if (stack.includes(i.component)) throw fail('E_COMPONENT_CYCLE', [...stack, i.component].join(' > '));
    const rec = fetch(i.component, model, lookup);
    const flat = expand(Object.assign(clone(rec), { components: { ...(rec.components || {}), ...emb } }), { lookup, stack: [...stack, i.component] });
    flat.exports = rec.exports; setParams(flat, i.args, i.component);
    const ns = namespaced(flat, i.as, i.remap, i.component);
    (m.tracks ||= []).push(...ns.tracks); add('defs', ns.defs); add('vars', ns.vars); (m.bindings ||= []).push(...ns.bindings);
  }
  // fragments: bind("fx", "lib:warmth@1(0.4)") -> the fragment's hook, namespaced, with its params set from the positional args
  (m.bindings || []).forEach((b) => {
    const fm = /^lib:([A-Za-z][\w-]*@\d+)(?:\((.*)\))?$/.exec(b.hook); if (!fm) return;
    const ref = fm[1];
    if (stack.includes(ref)) throw fail('E_COMPONENT_CYCLE', [...stack, ref].join(' > '));
    const rec = fetch(ref, model, lookup), flat = expand(Object.assign(clone(rec), { components: { ...(rec.components || {}), ...emb } }), { lookup, stack: [...stack, ref] });
    const params = Object.keys(((rec.exports || {}).params) || {}), vals = fm[2] ? JSON.parse(`[${fm[2]}]`) : [], args = {};
    vals.forEach((v, j) => { if (j < params.length) args[params[j]] = v; });
    flat.exports = rec.exports; setParams(flat, args, ref);
    const ns = namespaced(flat, `lib:${ref}`, {}, ref), hookName = ((rec.exports || {}).hooks || [Object.keys(rec.defs || {})[0]])[0];
    add('defs', ns.defs); add('vars', ns.vars); b.hook = `lib:${ref}/${hookName}`;
  });
  if (stack.length === 0) delete m.components;
  return m;
}
export const lib = createLibrary();
export const { save, get, list, revs } = lib;

// ---------------------------------------------------------------- runtime: hooks.inst and lib: hook-refs
// installInstances(hooks, { lib, S, tap }) adds to the hooks runtime (site/engine/hooks.js, not modified here):
//   hooks.inst("name@rev", { as, args, gate, remap }) -> Pattern of the instance's tracks (stack); params follow hooks.set("as.param", v);
//   hooks.bind(slot, "lib:name@rev(args)") -> binds the fragment's hook (its defs are registered under a slug name);
//   hooks.manifest() -> runtime registry (toJSON) plus { instances } for the intellisense.
// Limits: tracks must be structured (source/chain); text-only `src` tracks and gated instance-param sets are not supported (they raise).
const slug = (n) => n.replace(/[^\w-]/g, '_').replace(/^(?=[^A-Za-z])/, 'h');
const unwrap = (x) => (x && typeof x === 'object' && typeof x.__pure === 'string' && typeof x.query === 'function' ? x.__pure : x);
export function installInstances(hooks, { lib: L = lib, S = globalThis, tap = globalThis.tap } = {}) {
  if (!hooks) return hooks;
  const insts = new Map(), lookup = (n, r) => L.lookup(n, r), reg = new Set();
  const sub = (v, as, ex) => { // structured step argument -> runtime value
    if (Array.isArray(v)) return v.map(x => sub(x, as, ex));
    if (!isObj(v)) return v;
    if ('$mini' in v) return S.mini(v.$mini);
    if ('$tap' in v) { const t = tap(v.$tap); return v.range ? t.range(...v.range) : t; }
    if ('$code' in v) throw fail('E_UNSUPPORTED', 'inline $code arguments need the CLI/editor evaluator');
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x, as, ex)]));
  };
  const registerFlat = (flat) => { // defs/vars/bindings of an expanded model -> runtime (names slugged: hook names cannot contain "/")
    const hn = (h) => { const m = /^([^(]+)(\(.*)?$/.exec(h); return (flat.defs && m[1] in flat.defs ? slug(m[1]) : m[1]) + (m[2] || ''); };
    for (const [k, d] of Object.entries(flat.defs || {})) if (!reg.has('d:' + k)) { reg.add('d:' + k); hooks.def(slug(k), d); }
    for (const [k, l] of Object.entries(flat.vars || {})) if (!reg.has('v:' + k)) { reg.add('v:' + k); for (const a of l) hooks.let(k, a.value, a.gate); }
    for (const b of flat.bindings || []) { const key = `b:${b.slot}|${b.hook}|${JSON.stringify(b.gate)}`; if (!reg.has(key)) { reg.add(key); hooks.bind(b.slot, hn(b.hook), b.gate); } }
  };
  const live = (as) => { // ungated hooks.set("as.param", v) values, latest wins
    const out = {};
    for (const s of JSON.parse(hooks.toJSON()).sets || []) if (s.key.startsWith(as + '.')) {
      if (s.gate && Object.keys(s.gate).length) throw fail('E_UNSUPPORTED', `gated hooks.set("${s.key}") on an instance is not supported`);
      out[s.key.slice(as.length + 1)] = s.value;
    }
    return out;
  };
  const compile = (flat, as, ex) => {
    const slots = new Set(ex.slots || []), stage = (t, i) => {
      if (!t.source) throw fail('E_UNSUPPORTED', `track "${t.name}" is text-only (src); instance tracks must have source/chain`);
      const fn = S[t.source[0]] || globalThis[t.source[0]]; if (typeof fn !== 'function') throw fail('E_UNKNOWN_METHOD', t.source[0]);
      let p = fn(...t.source.slice(1).map(x => sub(x, as, ex)));
      for (const [m, ...a] of t.chain || []) p = p[m](...(m === 'use' && slots.has(a[0]) ? [`${as}/${a[0]}`, ...a.slice(1)] : a).map(x => sub(x, as, ex)));
      return p.ns(t.name); // the track's own scope (flat name `as_track`), so track-scoped bindings `as_track/slot` reach its slots
    };
    return S.stack(...(flat.tracks || []).map(stage));
  };
  hooks.inst = (ref, o = {}) => {
    ref = unwrap(ref); o = unwrap(o) || {}; const as = unwrap(o.as), { name } = parseRef(ref), rec = lookup(name, parseRef(ref).rev);
    if (!as) throw fail('E_BAD_ARG', 'inst needs { as }');
    if (!rec) throw fail('E_COMPONENT_MISSING', ref);
    const spec = { component: ref, as, remap: o.remap };
    const build = (args) => expand({ model: 1, instances: [{ ...spec, args }] }, { lookup });
    const first = build(unwrap(o.args)); // eager: E_COMPONENT_REQUIRES / E_COMPONENT_ARG raise here
    insts.set(as, { component: ref, as, ...(o.gate ? { gate: o.gate } : {}) }); registerFlat({ ...first, tracks: [] });
    const ex = rec.exports || {}; let cache = { k: JSON.stringify(unwrap(o.args)), p: compile(first, as, ex) };
    const Pat = S.Pattern, inner = new Pat((st) => {
      const args = { ...(unwrap(o.args) || {}), ...live(as) }, k = JSON.stringify(args);
      if (k !== cache.k) cache = { k, p: compile(build(args), as, ex) };
      return cache.p.query(st);
    });
    if (!o.gate) return inner;
    const gslot = `${slug(as)}-gate`; hooks.slot(gslot, { else: 'silence' }); hooks.bind(gslot, 'bypass', o.gate);
    return inner.use(gslot);
  };
  const bind0 = hooks.__bind0 || (hooks.__bind0 = hooks.bind); // re-installing (new library) rebinds inst/bind/manifest
  hooks.bind = (slot, hook, gate, o) => {
    hook = unwrap(hook);
    if (typeof hook === 'string' && hook.startsWith('lib:')) {
      const flat = expand({ model: 1, bindings: [{ slot: unwrap(slot), hook }] }, { lookup: (n, r) => L.lookup(n, r) });
      registerFlat({ defs: flat.defs, vars: flat.vars }); hook = slug(flat.bindings[0].hook);
    }
    return bind0(slot, hook, gate, o);
  };
  hooks.manifest = () => ({ ...JSON.parse(hooks.toJSON()), instances: [...insts.values()] });
  return hooks;
}
