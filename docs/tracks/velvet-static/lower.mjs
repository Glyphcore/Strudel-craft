// Generates track.standalone.strudel.js from track.strudel.js with the repo's lowering (tools/lowering/lower.mjs, docs/LOWERING.md).
//   node docs/tracks/velvet-static/lower.mjs [--check]
// atoms are inlined, hooks.def / hooks.bind / .use("slot") / .hook("rack") are written out as plain chain steps, .groove({..}) becomes
// .swingBy / .late / .mul(velocity(rand...)). The vox banks are two plain `await samples(url)` calls (raw.githubusercontent, site/data/vox/*/pitched/strudel.json),
// so no site prelude (voxBank) is needed: `strudel events|render` runs the standalone as it is. .send / ret (the bus stage) are kept and compiled by the strudel
// CLI's lanes pass (docs/LANES.md); strudel.cc has no buses. `.send(` etc. are hidden from the lowering's classifier while it runs.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createLowering } from '../../../tools/lowering/lower.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const craft = fs.readFileSync(path.join(here, 'track.strudel.js'), 'utf8');
const L = await createLowering();
const r = L.lower(craft.replace(/\.send\(/g, '.__send(').replace(/\.tap\(/g, '.__tap(').replace(/\.wire\(/g, '.__wire(').replace(/\bret\(/g, '__ret('));
if (r.state !== 'lowered') { console.error('not lowered:', r.state, r.why || ''); process.exit(1); }
const out = '// GENERATED from track.strudel.js by docs/tracks/velvet-static/lower.mjs (tools/lowering, docs/LOWERING.md): plain Strudel plus the buses (.send/ret: run it with the strudel CLI, its lanes pass compiles them); the vox banks are two samples(url) calls, no site prelude. Edit the Craft file, not this one.\n' + r.lowered.replace(/__voxBank\(/g, 'voxBank(').replace(/\.__send\(/g, '.send(').replace(/\.__tap\(/g, '.tap(').replace(/\.__wire\(/g, '.wire(').replace(/__ret\(/g, 'ret(');
const f = path.join(here, 'track.standalone.strudel.js');
if (process.argv.includes('--check')) { const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === out; console.log(same ? 'up to date' : 'STALE'); process.exit(same ? 0 : 1); }
fs.writeFileSync(f, out); console.log('wrote', f, out.length, 'bytes');
