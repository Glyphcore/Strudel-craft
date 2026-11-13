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
  const slotNames = new Set(tracks.map(t => t.name));
  for (const n of [...reads]) if ((model.vars || {})[n] && !pubs.has(n)) { vars[n] = clone(model.vars[n]); reads.delete(n); }
  const requiresTaps = [...reads].filter(n => !pubs.has(n)).sort();
  const comp = { model: 1, ...(Object.keys(defs).length ? { defs } : {}), ...(Object.keys(vars).length ? { vars } : {}), ...(bindings.length ? { bindings } : {}), ...(tracks.length ? { tracks } : {}) };
  comp.exports = { taps: [...pubs].sort(), slots: [...new Set(bindings.map(b => b.slot))].filter(s => slotNames.has(s.split('/')[0]) || true).sort(), params: {}, ...(requiresTaps.length ? { requires: { taps: requiresTaps } } : {}) };
  comp.meta = { kind: kind || (tracks.length === 1 && !bindings.length ? 'track' : 'set') };
  return comp;
}
export function replaceWithInstance(model, nodeIds, inst) {
  const m = clone(model), ids = new Set(nodeIds);
  m.tracks = (m.tracks || []).filter(t => !ids.has(`track:${t.name}`) && !ids.has(`code:${t.name}`));
  m.bindings = (m.bindings || []).filter((b, i) => !ids.has(`bind:${b.id || `b${i + 1}`}`));
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
  const rn = (n) => { const b = baseOf(n), f = n.slice(b.length); return (req.has(b) ? remap[b] : `${as}/${b}`) + f; };
  const pn = (n) => `${as}/${baseOf(n)}${n.slice(baseOf(n).length)}`;
  const out = { tracks: [], defs: {}, vars: {}, bindings: [] };
  for (const t of comp.tracks || []) {
    const c = clone(t); c.name = `${as}_${t.name}`; if (c.src !== undefined) { c.src = rewriteCode(c.src, rn); }
    const fix = (s) => s[0] === 'tap' && typeof s[1] === 'string' ? ['tap', pn(s[1]), ...s.slice(2)] : s[0] === 'wire' && typeof s[2] === 'string' ? ['wire', s[1], rn(s[2]), ...mapValue(s.slice(3), rn)] : [s[0], ...mapValue(s.slice(1), rn)];
    if (c.source) c.source = fix(c.source); if (c.chain) c.chain = c.chain.map(fix);
    if (c.chain == null && c.source == null && c.src) { // text-only track: publishes (".tap(") get the namespace, reads follow requires
      c.src = t.src.replace(TAPRE, (_, a, q, n, off) => `${a}${q}${(t.src[off - 1] === '.' ? pn : rn)(n)}${q}`);
    } else delete c.src;
    out.tracks.push(c);
  }
  for (const [k, d] of Object.entries(comp.defs || {})) out.defs[`${as}/${k}`] = clone(d);
  for (const [k, l] of Object.entries(comp.vars || {})) out.vars[`${as}/${k}`] = clone(l);
  for (const b of comp.bindings || []) {
    const hm = /^([^(]+)(\(.*)?$/.exec(b.hook), h = (comp.defs || {})[hm[1]] ? `${as}/${hm[1]}${hm[2] || ''}` : b.hook;
    out.bindings.push({ ...clone(b), slot: b.slot.includes('/') ? `${as}/${b.slot}` : `${as}/${b.slot}`, hook: h });
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
