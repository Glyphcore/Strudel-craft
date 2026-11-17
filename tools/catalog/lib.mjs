// The catalog is two shapes (#131, slimmed by #166): the eager INDEX site/data/catalog.json (what the first paint needs: id, title, folder, tags, labels, pack, hash,
// lowered flag ...) and one lazy BODY file per family, site/data/recipes/<family>.json (code, expr, notes, source, error, lowered, lowered_note,
// lowered_check), listed in site/craftpack.json as `x-glyphcore.recipe-bodies` ingredients `bodies-<family>` (load: lazy). An index entry names its
// body ingredient in `body`; `stackable` and `has_lowered` are index-only flags. A monolithic catalog (no `body` anywhere, what an older
// build_catalog.py writes) is read as is and split on write, so every tool reads one shape, the FULL catalog, through readCatalog() and writes it
// back through catalogFiles(). Never read data/catalog.json directly for code, notes or lowered text.
//   import { readCatalog, catalogFiles, writeCatalog } from '../catalog/lib.mjs';
import fs from 'node:fs'; import path from 'node:path';
export const BODY_FIELDS = ['intent', 'code', 'expr', 'notes', 'source', 'error', 'lowered', 'lowered_note', 'lowered_check', 'origin', 'unverified', 'bpm_hint', 'rms_dbfs', 'centroid_hz', 'peak']; // #166: the inspector-only measurements and provenance live in the body, not in the eager index
export const SYNTH = ['body', 'stackable', 'has_lowered'];
export const famOf = (r) => r.family || 'base';
export const bodyId = (fam) => 'bodies-' + fam;
export const bodyFile = (id) => `data/recipes/${id.replace(/^bodies-/, '')}.json`;
const FLOATS = (s) => s.replace(/"(peak|rms_dbfs|bpm_hint)": (-?\d+)(,?)\n/g, '"$1": $2.0$3\n'); // same text as engine/strudel/build_catalog.py (Python floats)
export const dumpIndex = (idx) => JSON.stringify(idx) + '\n'; // #166: compact (the index is read by machines; the pretty form cost 30% of its bytes)
export const dumpBody = (fam, bodies) => FLOATS(JSON.stringify({ family: fam, bodies }, null, 1)) + '\n';
const siteDir = (root) => path.join(root, 'site');

/** the full catalog {version, ..., labels, recipes[]} with every recipe's body merged in (pure data; synthetic index flags removed) */
export function readCatalog(root) {
  const idx = JSON.parse(fs.readFileSync(path.join(siteDir(root), 'data/catalog.json'), 'utf8')); const files = new Map();
  const bodies = (id) => { if (!files.has(id)) files.set(id, JSON.parse(fs.readFileSync(path.join(siteDir(root), bodyFile(id)), 'utf8')).bodies); return files.get(id); };
  idx.recipes = idx.recipes.map((r) => {
    if (!r.body) return r; const b = bodies(r.body)[r.id]; if (!b) throw new Error(`catalog: recipe ${r.id} has no body in ${bodyFile(r.body)}`);
    const rest = { ...r }; for (const k of SYNTH) delete rest[k]; return { ...rest, ...b };
  });
  return idx;
}
/** {relpath (from the repo root): text} of the split catalog for a full catalog object; the index keeps every non-body field in order */
export function catalogFiles(cat) {
  const byFam = new Map(); const recipes = [];
  for (const r of cat.recipes) {
    const fam = famOf(r), idx = {}, body = {};
    for (const [k, v] of Object.entries(r)) { if (SYNTH.includes(k)) continue; if (BODY_FIELDS.includes(k)) body[k] = v; else idx[k] = v; }
    idx.stackable = !!r.expr; if (r.lowered || r.lowered_note) idx.has_lowered = !!r.lowered; idx.body = bodyId(fam);
    if (!byFam.has(fam)) byFam.set(fam, {}); byFam.get(fam)[r.id] = body; recipes.push(idx);
  }
  const out = { 'site/data/catalog.json': dumpIndex({ ...cat, recipes }) };
  for (const fam of [...byFam.keys()].sort()) out['site/' + bodyFile(bodyId(fam))] = dumpBody(fam, byFam.get(fam));
  return out;
}
/** write (or with check: compare) every file of the split catalog and drop body files no recipe uses; returns the stale relative paths */
export function writeCatalog(root, cat, { check = false } = {}) {
  const files = catalogFiles(cat), stale = [];
  for (const [rel, text] of Object.entries(files)) { const f = path.join(root, rel); const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; if (cur !== text) { stale.push(rel); if (!check) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } } }
  const dir = path.join(root, 'site/data/recipes');
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (n.endsWith('.json') && !files['site/data/recipes/' + n]) { stale.push('site/data/recipes/' + n + ' (unused)'); if (!check) fs.unlinkSync(path.join(dir, n)); }
  return stale;
}
