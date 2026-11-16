// Generates track.standalone.strudel.js from track.strudel.js with the repo's lowering (tools/lowering/lower.mjs, docs/LOWERING.md).
//   node docs/tracks/velvet-static/lower.mjs [--check]
// atoms are inlined, hooks.def / hooks.bind / .use("slot") / .hook("rack") are written out as plain chain steps, .groove({..}) becomes
// .swingBy / .late / .mul(velocity(rand...)). The two voxBank() calls need the site prelude (vox banks) and are kept as they are:
// the lowering classifies a program that names voxBank as "prelude, no plain form", so they are hidden from it while it runs.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createLowering } from '../../../tools/lowering/lower.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const craft = fs.readFileSync(path.join(here, 'track.strudel.js'), 'utf8');
const L = await createLowering();
const r = L.lower(craft.replace(/\bvoxBank\(/g, '__voxBank('));
if (r.state !== 'lowered') { console.error('not lowered:', r.state, r.why || ''); process.exit(1); }
const out = '// GENERATED from track.strudel.js by docs/tracks/velvet-static/lower.mjs (tools/lowering, docs/LOWERING.md): plain Strudel plus the site vox prelude (voxBank). Edit the Craft file, not this one.\n' + r.lowered.replace(/__voxBank\(/g, 'voxBank(');
const f = path.join(here, 'track.standalone.strudel.js');
if (process.argv.includes('--check')) { const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === out; console.log(same ? 'up to date' : 'STALE'); process.exit(same ? 0 : 1); }
fs.writeFileSync(f, out); console.log('wrote', f, out.length, 'bytes');
