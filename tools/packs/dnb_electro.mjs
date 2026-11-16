#!/usr/bin/env node
// glyphcore/dnb-electro track demos (#124): the pack versions in docs/tracks/dnb-electro-tutorial/ are the source; this regenerates
//   <name>.standalone.strudel.js   (tools/packs/standalone.mjs: atoms and racks inlined, pastes into the site or strudel.cc-free CLI runs)
//   site/data/dnb-electro/presets.json   (recipes@1: the three track demos, code = the standalone program)
// Then run node tools/concepts/build.mjs (the Syntax entries read the standalone files), packs.py hash site/data/dnb-electro --write, shim.py.
// Usage (repo root): node tools/packs/dnb_electro.mjs [--check] [--pack-dir DIR]
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const TR = path.join(ROOT, 'docs/tracks/dnb-electro-tutorial');
const argv = process.argv.slice(2); const CHECK = argv.includes('--check'); const extra = argv.flatMap((a, i) => (a === '--pack-dir' ? ['--pack-dir', argv[i + 1]] : []));
const TRACKS = [
  { id: 'dnb-electro-tutorial', file: 'track', title: 'Track demo: DnB tutorial', labels: ['dnb', 'liquid', 'neuro'], intent: 'A 2:57 drum-and-bass tutorial in F minor at 174 bpm: liquid intro and first drop (two-step, ghost notes, shaker, Rhodes, pad, strings, vocal chops, sub and rolling bass), a breakdown with an amen-style chop teaser, a jungle-chop build, a neuro second drop (FM growl, reese, sub tracking the riff, glued mid-bass bus), a halftime switch with a jump-up wobble and an outro; sidechain, risers, impacts, gaps and filter moves on gates.' },
  { id: 'dnb-electro-electro', file: 'electro', title: 'Track demo: electro', labels: ['electro', 'house'], intent: 'A 75 s electro example at 128 bpm, 8 bars per section: electro-funk (808-style kit, cowbell, synth bass, vocoder-style robot lead) into electro house (filtered saw bass, supersaw stabs ducked by the kick, clap build, riser, impact).' },
  { id: 'dnb-electro-house', file: 'house', title: 'Track demo: house, techno, trance, big room', labels: ['house', 'techno', 'trance', 'big-room'], intent: 'A 105 s example at 128 bpm, 8 bars per section: house groove, driving techno (rumble, rolling bass, ride), trance breakdown and uplifting build (roll, filter build, riser, gap), a trance drop with gated supersaw and pluck arp, a stripped big-room drop and a house outro.' },
];
let stale = 0; const out = (f, t) => { const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; if (cur === t) return; stale++; if (CHECK) console.log('stale: ' + path.relative(ROOT, f)); else { fs.writeFileSync(f, t); console.log('wrote ' + path.relative(ROOT, f)); } };
for (const t of TRACKS) {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'tools/packs/standalone.mjs'), path.join(TR, `${t.file}.strudel.js`), path.join(TR, `${t.file}.standalone.strudel.js`), ...extra, ...(CHECK ? ['--check'] : [])], { encoding: 'utf8' });
  if (p.status !== 0) { stale++; process.stdout.write(p.stdout + p.stderr); }
}
const presets = { version: 1, categories: [{ id: 'tracks', title: 'Tracks' }], labels: [{ id: 'dnb-electro', title: 'DnB, electro, house', category: 'tracks', words: ['drum and bass', 'electro', 'house', 'techno', 'trance', 'big room'] }],
  recipes: TRACKS.map((t) => ({ id: t.id, title: t.title, intent: t.intent, code: fs.readFileSync(path.join(TR, `${t.file}.standalone.strudel.js`), 'utf8'), labels: ['dnb-electro'], folder: 'tracks/dnb-electro', tags: ['dnb-electro', 'tracks', ...t.labels.filter((l) => l !== 'dnb-electro')], source: `docs/tracks/dnb-electro-tutorial/${t.file}.standalone.strudel.js` })) };
out(path.join(ROOT, 'site/data/dnb-electro/presets.json'), JSON.stringify(presets, null, 1) + '\n');
const mf = path.join(ROOT, 'site/data/dnb-electro/craftpack.json'); const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
if (!man.ingredients.some((i) => i.id === 'presets')) { man.ingredients.push({ id: 'presets', kind: 'recipes', format: 'recipes@1', version: '1.0.0', path: 'presets.json', title: 'DnB, electro and house track demos', description: 'Track demos: DnB tutorial, electro, house / techno / trance / big room (the paste-ready standalone programs)', load: 'manual', hash: 'sha256:0', bytes: 0 }); out(mf, JSON.stringify(man, null, 2) + '\n'); }
process.exit(CHECK && stale ? 1 : 0);
