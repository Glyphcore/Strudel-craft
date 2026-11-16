#!/usr/bin/env node
// Fill folder and tags on the hand-written pack files and write the `taxonomy` of the shim and phonk manifests (docs/PACKAGES.md section 4).
// Generated files (racks-hiphop, atoms-hiphop, atoms-dovetail, feel-*, grooves, catalog concept recipes) are filled by tools/concepts/build.mjs with the same
// rules (tools/concepts/taxonomy.mjs). Idempotent: derived values are recomputed every run.
//   node tools/packs/taxonomy_fill.mjs [--check]     exit 1 when anything is stale
// Order after a content change: concepts build, this tool, `packs.py hash site/data/phonk --write`, shim.py.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const CHECK = process.argv.includes('--check');
const TX = await import(pathToFileURL(path.join(ROOT, 'tools/concepts/taxonomy.mjs')).href);
const AT = await import(pathToFileURL(path.join(ROOT, 'site/engine/atoms.js')).href);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const stale = [];
const write = (f, text) => { const p = path.join(ROOT, f); if (fs.readFileSync(p, 'utf8') !== text) { stale.push(f); if (!CHECK) fs.writeFileSync(p, text); } };
const targets = rd('tools/racks/targets.json').racks;
const PH = 'site/data/phonk';
// hand-written phonk atoms / racks / presets
const used = { phonk: new Set(), shim: new Set() };
const collect = (set, tags) => (tags || []).forEach((t) => set.add(t));
const folders = { phonk: new Set(), shim: new Set() };
const man = rd(`${PH}/craftpack.json`);
for (const ing of man.ingredients) {
  const f = `${PH}/${ing.path}`; const d = rd(f); let changed = false;
  if (ing.kind === 'atoms' && ['atoms', 'atoms-v2'].includes(ing.id)) {
    const ns = d.name; for (const a of Object.values(d.atoms)) { const tx = TX.atomTaxonomy(ing.id, ns, a.name, a); a.folder = tx.folder; a.tags = tx.tags; } changed = true;
  } else if (ing.kind === 'hooks' && ['racks', 'racks-v2'].includes(ing.id)) {
    for (const [n, def] of Object.entries(d.defs)) { const tx = TX.rackTaxonomy(n, def, (targets[n] || {}).class, ing.id); def.folder = tx.folder; def.tags = tx.tags; } changed = true;
  } else if (ing.kind === 'recipes') {
    for (const r of d.recipes) { const tx = TX.recipeTaxonomy({ ...r, origin: r.origin || 'new', family: null }); r.folder = 'phonk/' + (tx.folder || 'strudel/misc').replace(/^strudel\//, 'tracks/'); r.tags = TX.uniq(['phonk', ...tx.tags]); } changed = true;
  }
  if (changed) write(f, JSON.stringify(d, null, 1) + '\n');
  // collect tags and folders of every ingredient that has them
  const items = ing.kind === 'atoms' ? Object.values(d.atoms) : ing.kind === 'hooks' ? Object.values(d.defs) : ing.kind === 'recipes' ? d.recipes : [];
  for (const it of items) { collect(used.phonk, it.tags); if (it.folder) folders.phonk.add(it.folder); }
}
const cat = rd('site/data/catalog.json');
for (const r of cat.recipes) { collect(used.shim, r.tags); if (r.folder) folders.shim.add(r.folder); }
const folderDocs = (set) => Object.fromEntries([...new Set([...set].flatMap((f) => f.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort().filter((f) => TX.folderDescriptions[f]).map((f) => [f, { description: TX.folderDescriptions[f] }]));
const labelsDoc = cat.labels;
const mk = (set, set2) => TX.packTaxonomy(set, { labels: labelsDoc });
const setTax = (manifestFile, tax) => { const m = rd(manifestFile); m.taxonomy = tax; write(manifestFile, JSON.stringify(m, null, 2) + '\n'); };
setTax(`${PH}/craftpack.json`, { ...mk(used.phonk), folders: folderDocs(folders.phonk) });
setTax('site/craftpack.json', { ...mk(used.shim), folders: folderDocs(folders.shim) });
console.log(JSON.stringify({ check: CHECK, stale, phonkTags: used.phonk.size, shimTags: used.shim.size, phonkFolders: folders.phonk.size, shimFolders: folders.shim.size }));
process.exit(CHECK && stale.length ? 1 : 0);
