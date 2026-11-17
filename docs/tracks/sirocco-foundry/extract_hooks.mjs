#!/usr/bin/env node
// Extracts the track's inline hooks.def racks (the plain-Strudel twins included) into hooks.json for the rack audit (issue #136):
//   node docs/tracks/sirocco-foundry/extract_hooks.mjs            writes docs/tracks/sirocco-foundry/hooks.json
//   node tools/racks/audit.mjs --only racks --hooks docs/tracks/sirocco-foundry/hooks.json --out DIR
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, 'track.strudel.js'), 'utf8'); const defs = {};
for (const m of src.matchAll(/^(?:\/\/@plain )?hooks\.def\("(\w+)",\s*(\{.*\})\s*\)\s*$/gm)) defs[m[1]] = JSON.parse(m[2].replace(/([{,]\s*)(\w+):/g, '$1"$2":'));
const out = { model: 1, meta: { id: 'sirocco-foundry:racks', doc: 'Chain-only hook defs of docs/tracks/sirocco-foundry/track.strudel.js (extracted by extract_hooks.mjs), for tools/racks/audit.mjs --hooks.' }, defs };
fs.writeFileSync(path.join(HERE, 'hooks.json'), JSON.stringify(out, null, 1) + '\n'); console.log('hooks.json:', Object.keys(defs).join(', '));
