// Extracts this track's inline racks (hooks.def calls of track.strudel.js) into racks.json, the hooks file the rack audit reads.
//   node docs/tracks/velvet-static/racks.mjs [--check]
//   STRUDEL_CLI=<dir of the strudel CLI> node tools/racks/audit.mjs --hooks site/data/racks/hygiene.json --hooks docs/tracks/velvet-static/racks.json --out OUT
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'track.strudel.js'), 'utf8');
const defs = {}; const hooks = { def: (n, d) => { defs[n] = d; } };
const mini = (s) => ({ $mini: s });
for (const line of src.split('\n')) if (/^hooks\.def\(/.test(line)) new Function('hooks', 'mini', line)(hooks, mini);
const out = JSON.stringify({ model: 1, defs }, null, 1) + '\n'; const f = path.join(here, 'racks.json');
if (process.argv.includes('--check')) { const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === out; console.log(same ? 'up to date' : 'STALE'); process.exit(same ? 0 : 1); }
fs.writeFileSync(f, out); console.log('wrote', f, Object.keys(defs).length, 'racks');
