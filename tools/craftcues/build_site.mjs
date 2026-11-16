#!/usr/bin/env node
// Ship the authored cue sets to the site (docs/CRAFTCUES.md 6; #163): docs/tracks/*/*.craftcues -> site/data/cues/<track>.craftcues + index.json.
// <stem>.generated.craftcues (analysis findings, src=inferred / analysis) is merged into <stem>.craftcues of the same folder (authored wins by id).
// A set matches a program by recipe id (catalog recipe of the same slug) or by the first line of its program (header `program:`).
// Usage: node tools/craftcues/build_site.mjs [--check]   (--check: exit 1 when site/data/cues is stale)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import * as C from '../../site/engine/cues.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const OUT = path.join(ROOT, 'site/data/cues'); const check = process.argv.includes('--check');
const recipes = new Set((JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/catalog.json'), 'utf8')).recipes || []).map((r) => r.id));
const files = [...fs.readdirSync(path.join(ROOT, 'docs/tracks'), { recursive: true })].filter((f) => /\.craftcues$/.test(f)).sort();
const want = new Map(); const sets = [];
const rd = (f) => { const r = C.parse(fs.readFileSync(path.join(ROOT, 'docs/tracks', f), 'utf8')); if (r.problems.some((p) => p.level === 'error')) { console.error(`${f}: parse errors`); process.exit(1); } return r.doc; };
for (const f of files.filter((x) => !/\.generated\.craftcues$/.test(x))) {
  const gen = f.replace(/\.craftcues$/, '.generated.craftcues'); const authored = rd(f); const doc = files.includes(gen) ? C.merge(authored, rd(gen)) : authored; doc.header = { ...authored.header }; const text = C.print(doc);
  const name = (doc.header.track || path.basename(f, '.craftcues')) + '.craftcues'; want.set(name, text);
  const set = { file: name, track: doc.header.track || null, title: doc.header.title || null, cues: doc.cues.length };
  if (doc.header.track && recipes.has(doc.header.track)) set.recipe = doc.header.track;
  if (doc.header.program && fs.existsSync(path.join(ROOT, doc.header.program))) { const first = fs.readFileSync(path.join(ROOT, doc.header.program), 'utf8').split('\n')[0]; if (first.startsWith('//') && first.length > 12) set.first = first.slice(0, 48); }
  sets.push(set);
}
want.set('index.json', JSON.stringify({ format: 'craftcues-index@1', doc: 'docs/CRAFTCUES.md', sets }, null, 1) + '\n');
let stale = 0; if (!check) fs.mkdirSync(OUT, { recursive: true });
for (const [n, t] of want) { const p = path.join(OUT, n); const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; if (cur !== t) { stale++; if (!check) fs.writeFileSync(p, t); } }
if (fs.existsSync(OUT)) for (const n of fs.readdirSync(OUT)) if (!want.has(n)) { stale++; if (!check) fs.unlinkSync(path.join(OUT, n)); }
console.log(check ? (stale ? `site/data/cues is stale (${stale} files): node tools/craftcues/build_site.mjs` : 'site/data/cues is current') : `site/data/cues: ${sets.length} sets, ${stale} files written`);
process.exit(check && stale ? 1 : 0);
