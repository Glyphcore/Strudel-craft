#!/usr/bin/env node
// Hap equality of a Craft program and its plain-Strudel form over N cycles (docs/LOWERING.md): the same check tools/lowering/build.mjs runs on the
// first 4 cycles of every catalog recipe, for a whole track. Usage (repo root):
//   node tools/lowering/verify_file.mjs CRAFT.strudel.js PLAIN.strudel.js [--cycles 104]
// Prints { equal, cycles, events | reason } and exits 0 when equal. The CLI is STRUDEL_CLI (default /home/user/suno-track-lab/engine/strudel-cli).
import fs from 'node:fs';
import { createLowering, verify, hasCli } from './lower.mjs';
const argv = process.argv.slice(2); const i = argv.indexOf('--cycles'); const cycles = i >= 0 ? +argv[i + 1] : 4;
const [craftFile, plainFile] = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--cycles');
if (!craftFile || !plainFile || !hasCli()) { console.error('usage: verify_file.mjs CRAFT PLAIN [--cycles N] (needs the strudel CLI)'); process.exit(2); }
const LW = await createLowering({});
const v = verify(fs.readFileSync(craftFile, 'utf8'), fs.readFileSync(plainFile, 'utf8'), { defs: LW.ALL, cycles });
console.log(JSON.stringify(v));
process.exit(v.equal ? 0 : 1);
