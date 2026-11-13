// Shared pack resolution (docs/PACK_SPEC.md sections 3, 9.3, 11, 13). Pure ES module: no DOM, no Node, no imports.
// resolve(layers, loaded) -> { errors[], warnings[], resolution{} }; same JSON in the site loader and the CLI.
//   layers: [{ name, packs: [{ id, source?, priority? }] }]   shipped, user, session; array order is load order
//   loaded: { [packId]: { version?, ingredients: [{ id, kind, data }] } }   verified, schema-valid entry data (data may be null)
// Rule 2 of 9.3: bare name -> highest priority, then earlier layer, then earlier lock entry. Qualified ids never conflict.

export const API = '1.0.0';
export const LAYER_ORDER = ['shipped', 'user', 'session'];

// item ids an entry file defines, per kind (section 5). Keyed data (rule 4) is keyed by its own key.
const ITEMS = {
  'recipes': (d) => (d.recipes || []).map((r) => r.id),
  'control-types': (d) => (d.types || []).map((t) => t.id),
  'layouts': (d) => (d.layouts || []).map((l) => l.id),
  'palette-actions': (d) => (d.actions || []).map((a) => a.id),
  'visuals': (d) => (d.visuals || []).map((v) => v.id),
  'sounds': (d) => Object.keys(d).filter((k) => k !== '_base'),
  'vox-bank': (d) => Object.keys({ ...(d.maps?.flat || {}), ...(d.maps?.pitched || {}) }).filter((k) => k !== '_base'),
  'param-shapes': (d) => ['params', 'ranges', 'canon'].flatMap((s) => Object.keys(d[s] || {}).map((k) => `${s}.${k}`)),
  'atoms': (d) => Object.values(d.atoms || {}).map((a) => a.name), // one ingredient = one namespace of atoms (ATOMS 10, PACK_SPEC 5.1)
  'intellisense': (d) => (d.items || []).map((i) => `${i.category || ''}|${i.label}`),
};
export const itemIds = (kind, data) => (data && ITEMS[kind] ? ITEMS[kind](data) : []);

export const aliasOf = (packId, key) => `${packId.replace('/', '_').replace(/-/g, '_')}__${key}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const layerRank = (n) => { const i = LAYER_ORDER.indexOf(n); return i < 0 ? LAYER_ORDER.length : i; };

export function resolve(layers, loaded) {
  const errors = [], warnings = [];
  const err = (code, message, extra) => errors.push({ code, message, ...extra });
  // claimants of every pack id, in (layer, entry) order; rule 6
  const accepted = [], seen = new Map();
  let seq = 0;
  for (const layer of layers) {
    const inLayer = new Map();
    for (const e of layer.packs) {
      const prior = seen.get(e.id);
      if (inLayer.has(e.id)) {
        err('E_LOCK_DUPLICATE', `${e.id} twice in layer ${layer.name}`, { id: e.id });
        continue;
      }
      inLayer.set(e.id, true);
      if (prior) {
        if (prior.source !== e.source) err('E_PACK_NAMESPACE', `${e.id} comes from two sources (${prior.source} in ${prior.layer}, ${e.source} in ${layer.name}); the earlier layer wins`, { id: e.id });
        continue; // the later entry is refused either way
      }
      seen.set(e.id, { source: e.source, layer: layer.name });
      accepted.push({ id: e.id, priority: e.priority ?? 0, rank: layerRank(layer.name), seq: seq++ });
    }
  }
  // claims[kind][bare] = [{ pack, ingredient, qualified, priority, rank, seq }]
  const claims = {};
  for (const p of accepted) {
    for (const ing of loaded[p.id]?.ingredients || []) {
      for (const item of itemIds(ing.kind, ing.data)) {
        const k = ((claims[ing.kind] ||= {})[item] ||= []);
        k.push({ pack: p.id, ingredient: ing.id, qualified: `${p.id}:${item}`, priority: p.priority, rank: p.rank, seq: p.seq });
      }
    }
  }
  const resolution = {};
  for (const kind of Object.keys(claims).sort()) {
    const out = (resolution[kind] = {});
    for (const bare of Object.keys(claims[kind]).sort()) {
      const c = claims[kind][bare].slice().sort((a, b) => b.priority - a.priority || a.rank - b.rank || a.seq - b.seq);
      const entry = { winner: c[0].qualified, shadowed: c.slice(1).map((x) => x.qualified) };
      if (kind === 'sounds' || kind === 'vox-bank') entry.aliases = Object.fromEntries(c.map((x) => [aliasOf(x.pack, bare), x.qualified]).sort((a, b) => cmp(a[0], b[0])));
      out[bare] = entry;
      if (entry.shadowed.length) warnings.push({ code: 'W_PACK_SHADOW', message: `${kind}!${bare}: ${entry.winner} wins over ${entry.shadowed.join(', ')}`, kind, name: bare, winner: entry.winner, shadowed: entry.shadowed });
    }
  }
  warnings.sort((a, b) => cmp(a.kind + a.name, b.kind + b.name));
  return { errors, warnings, resolution };
}

// ---------------------------------------------------------------- verify (docs/PACK_SPEC.md 11.1): "does this pinned reference still hash to this value?"
// verify(ref, hash, host?) -> { ok:true, ref, hash, source } | { ok:false, code, ref, expected, actual?, message, offline? }; never throws for an ordinary mismatch.
//   ref:  'author/pack', 'author/pack:ingredient', each optionally followed by '@<pinned source>' (the lock's `source`, github:o/r@<40 hex>[/path]),
//         or { id, item?, source? }. Without a source the host's lock layers supply it (host.known(id) -> { source, manifest, mirrors? }).
//   hash: 'sha256:<64 hex>' exactly as the lock writes it. A pack ref is checked against craftpack.json (= the lock's `manifest`); an item ref names an
//         ingredient id and is checked against that ingredient's entry file bytes (the value `strudel packs hash` writes into the manifest).
//   host: { get(bases, rel, hash, { cache }) -> Uint8Array (throws { code, actual?, offline? }), known?(id), bases?(source, known) -> extra bases first }
// The default host fetches with globalThis.fetch and hashes with crypto.subtle, with no cache (node >= 18); the site passes the loader's own cached path.
const HASH = /^sha256:[0-9a-f]{64}$/;
const hexOf = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async (bytes) => 'sha256:' + hexOf(await globalThis.crypto.subtle.digest('SHA-256', bytes));
export function pinnedBases(source) { // only commit-pinned github: sources are verifiable by reference; null for anything else
  const m = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([0-9a-f]{40})(\/.*)?$/.exec(String(source || '')); if (!m) return null;
  const path = (m[4] || '/').replace(/^\/|\/$/g, ''), p = path ? path + '/' : '';
  return [`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${p}`, `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${p}`];
}
export function parseRef(ref) {
  if (ref && typeof ref === 'object') ref = { id: ref.id, item: ref.item, source: ref.source }; else {
    const m = /^([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)(?::([^@]+))?(?:@(.+))?$/.exec(String(ref)); if (!m) return null; ref = { id: m[1], item: m[2], source: m[3] };
  }
  return /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(String(ref.id)) && (ref.item == null || (typeof ref.item === 'string' && ref.item)) ? ref : null;
}
const confinedPath = (p) => typeof p === 'string' && p && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '..');
export const defaultHost = {
  async get(bases, rel, hash) {
    let last = null;
    for (const b of bases) {
      try {
        const res = await globalThis.fetch(new URL(rel, b).href); if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { http: res.status });
        const bytes = new Uint8Array(await res.arrayBuffer()), actual = await sha256(bytes);
        if (hash && actual !== hash) { last = Object.assign(new Error(`${rel} does not match its hash`), { code: 'E_PACK_HASH', actual }); continue; }
        return bytes;
      } catch (e) { if (!last || last.code !== 'E_PACK_HASH') last = Object.assign(e, { code: 'E_PACK_UNAVAILABLE', offline: !e.http }); }
    }
    throw last || Object.assign(new Error('no source'), { code: 'E_PACK_SOURCE' });
  },
};
export async function verify(ref, hash, host = defaultHost) {
  const fail = (code, message, extra) => ({ ok: false, code, ref, expected: hash, message, ...extra });
  try {
    const p = parseRef(ref); if (!p) return fail('E_PACK_ID', 'reference is not author/pack[:ingredient][@source]');
    if (!HASH.test(String(hash))) return fail('E_PACK_HASH', 'hash must be sha256:<64 lower-case hex>');
    const known = host.known ? host.known(p.id) : null, source = p.source || known?.source;
    if (!source) return fail('E_PACK_SOURCE', `${p.id} is not in a lock layer and the reference names no source`);
    if (!pinnedBases(source)) return fail('E_PACK_SOURCE', `source ${source} is not a commit-pinned github: source`);
    const same = known && known.source === source, bases = [...(host.bases ? host.bases(source, same ? known : null) : []), ...pinnedBases(source)];
    const get = host.get || defaultHost.get;
    const manifestHash = p.item == null ? hash : same && known.manifest ? known.manifest : null; // an item ref needs the manifest: verified when the lock knows its hash
    const mb = await get(bases, 'craftpack.json', manifestHash, { cache: !!manifestHash });
    let man; try { man = JSON.parse(new TextDecoder().decode(mb)); } catch (e) { return fail('E_PACK_SCHEMA', 'manifest is not JSON'); }
    if (man.id !== p.id) return fail('E_PACK_NAMESPACE', `the manifest names ${man.id}, not ${p.id}`);
    if (p.item != null) {
      const ing = (man.ingredients || []).find((i) => i.id === p.item); if (!ing) return fail('E_PACK_ID', `${p.id} has no ingredient ${p.item}`);
      if (!confinedPath(ing.path)) return fail('E_PACK_PATH', `path ${ing.path} leaves the pack root`);
      await get(bases, ing.path, hash, { cache: true });
    }
    return { ok: true, ref, hash, source };
  } catch (e) {
    return fail(e.code || 'E_PACK_UNAVAILABLE', e.message, { ...(e.actual ? { actual: e.actual } : {}), ...(e.code === 'E_PACK_UNAVAILABLE' ? { offline: !!e.offline } : {}) });
  }
}
