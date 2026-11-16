#!/usr/bin/env node
// Sirocco Foundry build (issue #136). Run from the repo root:
//   node docs/tracks/sirocco-foundry/build.mjs        -> rewrites the gates block of track.strudel.js from ON below, then writes track.standalone.strudel.js
// ON is the arrangement: per lane, the bars (1-based, inclusive) where it sounds. The Craft form states it as `tagged("#lane").mute("...")` gates
// (the complement, as ranges "Ab..Bb", the last one "@Nb"); the standalone states it as `.mask("<1!8 0!1 ...>")` on the lane. Both come from this table.
// The standalone is lowered with tools/lowering/lower.mjs (atoms inlined, hooks written out); lines ending //@craft are dropped, //@plain lines are uncommented.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..');
const TOTAL = 136; // bars 129-136 are the tail (a mask list repeats after its last entry, so the tail is written out as 0)
const B = (...r) => r; // [a, b] inclusive; a single number n means [n, n]
export const ON = {
  kick: [[9, 31], [33, 56], [97, 120]], kickH: [[73, 96]], clap: [[17, 31], [33, 56], [97, 116]], snareH: [[73, 96]], ghost: [[77, 96]],
  hats: [[1, 31], [33, 56], [97, 124]], ohat: [[9, 31], [33, 56], [97, 120]], hatsH: [[73, 88]], hats16H: [[89, 96]],
  roll: [[25, 32], [65, 72]], roll4: [[13, 16]], fill: [48, 56, 96, 112], perc: [[61, 96]],
  rise1: [[17, 32]], rise2: [[69, 72]], pitch2: [[69, 72]], rev: [16, 96], down: [57, 113], impact: [33, 73, 97], crash: [33, 49, 73, 89, 97, 113], metalTail: [57],
  seedH: [[17, 31], [33, 56], [113, 116]], seedHm: [[97, 112]], subH: [[25, 31], [33, 56], [97, 116]], seedG: [[73, 88]], growl2: [[89, 96]], growlR: [[97, 112]], subD: [[73, 96]],
  disco: [[1, 16]], discoOut: [[117, 124]], stabsB: [[17, 32]], stabs1: [[33, 48], [113, 116]], stabs2: [[49, 55]], stabsUp: [[97, 111]], closeS: [56, 112],
  pad: [[17, 32], [41, 72], [97, 112], [117, 128]], fpad: [[25, 32], [57, 72], [105, 112], [121, 128]],
  chop: [[13, 16], [33, 48], [97, 104]], chopB: [[49, 56], [105, 112]], chopA: [[73, 96]], arp: [[49, 56], [65, 72], [97, 112]], screech: [[89, 96]], tex: [[57, 96], [121, 128]],
};
const norm = (rs) => rs.map((r) => (Array.isArray(r) ? r : [r, r]));
const onSet = (rs) => { const a = new Array(TOTAL + 1).fill(0); for (const [x, y] of norm(rs)) for (let b = x; b <= y; b++) a[b] = 1; return a; };
function offWindows(rs) { // complement as gate text
  const a = onSet(rs), out = []; let b = 1;
  while (b <= TOTAL) { if (a[b]) { b++; continue; } let e = b; while (e + 1 <= 128 && !a[e + 1]) e++; if (e >= 128) { out.push(`@${b}b`); break; } out.push(`${b}b..${e + 1}b`); b = e + 1; }
  return out.join(', ');
}
function maskText(rs) { const a = onSet(rs).slice(1); const runs = []; for (const v of a) { if (runs.length && runs[runs.length - 1][0] === v) runs[runs.length - 1][1]++; else runs.push([v, 1]); } return '<' + runs.map(([v, n]) => (n > 1 ? `${v}!${n}` : `${v}`)).join(' ') + '>'; }

const file = path.join(HERE, 'track.strudel.js'); let craft = fs.readFileSync(file, 'utf8');
const laneIds = [...craft.matchAll(/^(?:\/\/@plain )?([A-Za-z]\w*):/gm)].map((m) => m[1]);
const missing = Object.keys(ON).filter((k) => !laneIds.includes(k)), unused = [...new Set(laneIds)].filter((k) => !(k in ON));
if (missing.length || unused.length) { console.error('ON and lanes differ', { missing, unused }); process.exit(1); }
const gates = Object.entries(ON).map(([k, rs]) => `tagged("#${k}").mute("${offWindows(rs)}")`).join('\n');
craft = craft.replace(/\/\/@gates-begin[\s\S]*?\/\/@gates-end/, `//@gates-begin\n${gates}\n//@gates-end`); fs.writeFileSync(file, craft);

// ---- standalone ----
const { createLowering } = await import(pathToFileURL(path.join(ROOT, 'tools/lowering/lower.mjs')).href);
let src = craft.replace(/\/\/@gates-begin[\s\S]*?\/\/@gates-end\n?/, '').split('\n').filter((l) => !/\/\/@craft\s*$/.test(l)).map((l) => l.replace(/^\/\/@plain /, '')).join('\n');
src = src.split('\n').map((l) => { const m = /^([A-Za-z]\w*):/.exec(l); if (!m || !(m[1] in ON)) return l; const c = l.search(/\s*\/\/(?!@)/); const cut = c >= 0 ? c : l.length; return l.slice(0, cut) + `.mask("${maskText(ON[m[1]])}")` + l.slice(cut); }).join('\n');
const L = await createLowering(); const r = L.lower(src);
if (r.state !== 'lowered') { console.error('lowering did not lower:', r); process.exit(1); }
const head = '// GENERATED from track.strudel.js by docs/tracks/sirocco-foundry/build.mjs (lowering, docs/LOWERING.md): plain Strudel, paste-ready for strudel.cc. Edit the Craft file, not this one.\n// The vox sample lanes (fpad, chop, chopB, chopA) are their synthesised twins here; the section gates are .mask() lists.\n';
fs.writeFileSync(path.join(HERE, 'track.standalone.strudel.js'), head + r.lowered);
console.log('wrote gates (' + Object.keys(ON).length + ' lanes) and track.standalone.strudel.js (' + r.lowered.length + ' bytes)');
