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
