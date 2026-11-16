#!/usr/bin/env node
// Catalog split / check / export (#131). The shipped catalog is the eager index site/data/catalog.json plus lazy per-family bodies
// site/data/recipes/<family>.json (tools/catalog/lib.mjs).
//   node tools/catalog/catalog.mjs split [--check]     rewrite (or check) the index and body files from the current catalog (monolith or split)
//   node tools/catalog/catalog.mjs export OUT.json     the monolithic catalog (every recipe with its body) for tools and the CLI; never shipped
//   node tools/catalog/catalog.mjs check               exit 1 when the split files are stale or an index entry has no body
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { readCatalog, writeCatalog, SYNTH } from './lib.mjs';
const ROOT = process.env.CATALOG_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [cmd, arg] = process.argv.slice(2); const check = process.argv.includes('--check') || cmd === 'check';
if (cmd === 'export') {
  if (!arg) { console.error('usage: catalog.mjs export OUT.json'); process.exit(2); }
  fs.writeFileSync(arg, JSON.stringify(readCatalog(ROOT), null, 1)); console.log('wrote ' + arg); process.exit(0);
}
if (cmd === 'split' || cmd === 'check') {
  const cat = readCatalog(ROOT); const stale = writeCatalog(ROOT, cat, { check });
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/catalog.json'), 'utf8'));
  const bad = idx.recipes.filter((r) => !r.body || SYNTH.some((k) => k !== 'has_lowered' && r[k] === undefined)).map((r) => r.id);
  console.log(JSON.stringify({ check, stale, recipes: cat.recipes.length, missingIndexFields: bad })); process.exit(check && (stale.length || bad.length) ? 1 : 0);
}
console.error('usage: catalog.mjs split|check|export'); process.exit(2);
