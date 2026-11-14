#!/usr/bin/env node
// glyphcore/phonk pack builder (one source, generated derivatives).
// Source of truth: docs/tracks/night-phonk-demo/track.standalone.strudel.js (the paste-ready program). Its header block between
// `// == glyphcore/phonk: atoms` and `// == track` holds the atom(...) declarations and the rack hooks.def(...) lines.
// Writes:
//   site/data/phonk/atoms.json    atoms@1   (ids, revs and hashes from site/engine/atoms.js; names keep the `ph.` namespace)
//   site/data/phonk/racks.json    hooks@1   (the rack defs: chain-only data, no code)
//   site/data/phonk/presets.json  recipes@1 (the standalone track as a recipe, loadable in the Rack browser)
//   docs/tracks/night-phonk-demo/track.strudel.js  the pack version: the header replaced by atoms.import(...) (racks come from the pack)
// Usage: node tools/packs/phonk.mjs [--check]   (--check exits 1 when any output is stale)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = await import(pathToFileURL(path.join(ROOT, 'site/engine/atoms.js')).href);
const AC = await import(pathToFileURL(path.join(ROOT, 'site/engine/atoms-consumers.js')).href);
A.loadTypes(fs.readFileSync(path.join(ROOT, 'site/data/atoms/types.json'), 'utf8'));
const SRC = path.join(ROOT, 'docs/tracks/night-phonk-demo/track.standalone.strudel.js');
const src = fs.readFileSync(SRC, 'utf8');
const a0 = src.indexOf('// == glyphcore/phonk: atoms'), r0 = src.indexOf('// == glyphcore/phonk: racks'), t0 = src.indexOf('// == track');
if (a0 < 0 || r0 < a0 || t0 < r0) throw new Error('header markers missing in ' + SRC);
const atomText = src.slice(a0, r0), rackText = src.slice(r0, t0);
// atoms: the site engine's own parser, ids and hashes
const env = A.buildEnv(atomText);
const taken = new Set(); const atoms = Object.fromEntries(env.decls.map((r) => { const id = A.idFor(r.type, r.name, taken); taken.add(id); const rec = { name: r.name, type: r.type, rev: r.rev || 1, ...(r.params ? { params: r.params } : {}), body: r.body, ...(r.doc ? { doc: r.doc } : {}) }; return [id, { ...rec, hash: A.atomHash(rec) }]; }));
const atomsDoc = { format: 'atoms@1', name: 'ph', doc: 'glyphcore/phonk atoms: harmony, lines, rhythms and section gates of the night phonk demo (G minor, VI-i-VII-VI). Import with atoms.import("pack:glyphcore/phonk:atoms"); names keep the ph. namespace.', atoms };
AC.verifyIngredient({ data: atomsDoc });
// racks: evaluate only the hooks.def lines against a recorder (data in, data out; no Strudel needed)
const defs = {}; const hooks = { def: (n, spec) => { defs[n] = spec; } };
new Function('hooks', rackText.split('\n').filter((l) => /^hooks\.def\(/.test(l)).join('\n'))(hooks);
const racksDoc = { model: 1, meta: { id: 'glyphcore/phonk:racks', doc: 'Instrument rigs (kick, snare, hats, cowbell, 808, pad, leads, pluck, vox, fx, texture) and shared moves (thin, grit, pump) as hook defs. Bind a rack into a slot: hooks.bind("kick", "kick808"); $: s("x ~ x ~").use("kick").' }, defs };
const packHeader = '// == glyphcore/phonk (pack): atoms and racks ==\natoms.import("pack:glyphcore/phonk:atoms")\n// racks: ingredient glyphcore/phonk:racks (hooks@1, site/data/phonk/racks.json), loaded as the hooks config of this program\n\n';
const packTrack = src.slice(0, a0) + packHeader + src.slice(t0);
// v2 (#93): docs/tracks/night-phonk-demo/track.v2.standalone.strudel.js. Its v1 blocks may only hold lines that appear verbatim in v1
// (closed for modification); its v2 blocks become the new ingredients atoms-v2 (atoms@1, names ph2.) and racks-v2 (hooks@1).
const SRC2 = path.join(ROOT, 'docs/tracks/night-phonk-demo/track.v2.standalone.strudel.js');
const src2 = fs.existsSync(SRC2) ? fs.readFileSync(SRC2, 'utf8') : null; let v2 = null;
if (src2) {
  const m = (k) => { const i = src2.indexOf(k); if (i < 0) throw new Error('v2 marker missing: ' + k); return i; };
  const b0 = m('// == glyphcore/phonk: atoms (v1'), b1 = m('// == glyphcore/phonk v2: atoms'), b2 = m('// == glyphcore/phonk v2: racks'), b3 = m('// == track');
  const v1lines = new Set(src.split('\n'));
  for (const l of src2.slice(b0, b1).split('\n')) if (/^(atom|hooks\.def)\(/.test(l) && !v1lines.has(l)) throw new Error('v2 changes a v1 item (open/closed): ' + l.slice(0, 80));
  const env2 = A.buildEnv(src2.slice(b1, b2)); const taken2 = new Set();
  const atoms2 = Object.fromEntries(env2.decls.map((r) => { const id = A.idFor(r.type, r.name, taken2); taken2.add(id); const rec = { name: r.name, type: r.type, rev: 1, ...(r.params ? { params: r.params } : {}), body: r.body }; return [id, { ...rec, hash: A.atomHash(rec) }]; }));
  for (const a of Object.values(atoms2)) if (Object.values(atoms).some((x) => x.name === a.name)) throw new Error('v2 atom redefines ' + a.name);
  const atoms2Doc = { format: 'atoms@1', name: 'ph2', doc: 'glyphcore/phonk v2 atoms: confrontation rhythms (toms, rim, stab, stutter, heartbeat, slides) and the section gates of the v2 track (drops vs relief). Import next to the v1 atoms: atoms.import("pack:glyphcore/phonk:atoms-v2").', atoms: atoms2 };
  AC.verifyIngredient({ data: atoms2Doc });
  const defs2 = {}; new Function('hooks', src2.slice(b2, b3).split('\n').filter((l) => /^hooks\.def\(/.test(l)).join('\n'))({ def: (n, sp) => { if (defs[n]) throw new Error('v2 rack redefines ' + n); defs2[n] = sp; } });
  const racks2Doc = { model: 1, meta: { id: 'glyphcore/phonk:racks-v2', doc: 'v2 rigs: pumpHard(depth) (duckorbit pump on orbits 3-8 from the kick), tom, rimshot, slam (filter slam), open (relief lift), swellPad. Load together with glyphcore/phonk:racks.' }, defs: defs2 };
  const head2 = '// == glyphcore/phonk (pack): v1 and v2 atoms and racks ==\natoms.import("pack:glyphcore/phonk:atoms")\natoms.import("pack:glyphcore/phonk:atoms-v2")\n// racks: glyphcore/phonk:racks + racks-v2 (hooks@1), loaded as the hooks config of this program\n\n';
  v2 = { atoms2Doc, racks2Doc, track: src2.slice(0, b0) + head2 + src2.slice(b3) };
}
const presets = { version: 1, categories: [{ id: 'tracks', title: 'Tracks' }], labels: [{ id: 'phonk', title: 'Night phonk', category: 'tracks', words: ['wavephonk', 'cloudphonk', 'drift'] }],
  recipes: [{ id: 'night-phonk-demo', title: 'Track demo: night phonk', intent: 'A 2:29 night phonk track: deep lead and counter-melody, hazy pad, 808 with glide and ducking, trap drums with rolls, cowbell, risers and impacts, vox textures, glue bus.', code: src, labels: ['phonk'], needs: ['glyphcore/vox:index'], source: 'docs/tracks/night-phonk-demo/track.standalone.strudel.js' }].concat(src2 ? [{ id: 'night-phonk-demo-v2', title: 'Track demo: night phonk v2', intent: 'Night phonk v2 (2:37): hard kick-synced pump, a confrontational drop, drops juxtaposed with relief sections and stop-cuts.', code: src2, labels: ['phonk'], needs: ['glyphcore/vox:index'], source: 'docs/tracks/night-phonk-demo/track.v2.standalone.strudel.js' }] : []) };
const J = (o) => JSON.stringify(o, null, 1) + '\n';
// Syntax view entry (docs follow code): section `tracks` in site/data/syntax.json carries the standalone text, regenerated here
const SYN = path.join(ROOT, 'site/data/syntax.json'); const syn = JSON.parse(fs.readFileSync(SYN, 'utf8'));
const sec = { id: 'tracks', title: 'Track demos', needs: 'lanes', explain: 'Whole tracks written as syntax: atoms for every chord, line, rhythm and gate; one lane per responsibility; racks (hook defs) bound into slots; tagged(...).mute(gate) and hooks.bind gates for the form; taps and wires for ducking; ctl() macros mapped with hooks.map; shared sends and returns. The night phonk demo is the standalone program of pack glyphcore/phonk (site/data/phonk): the pack version only swaps the inlined atoms and racks for atoms.import("pack:glyphcore/phonk:atoms"). G minor, VI-i-VII-VI, 80 bars = 2:29. Knobs: macro (all filters), space (all reverb), grit (all drive), energy (drum velocity); 0.5 or 1 = as written.',
  examples: [{ title: 'Track demo: night phonk', code: src, explain: 'intro 1-8, build 9-16, drop 17-32, breakdown 33-40, build 2 41-48, drop 2 49-72 (lead rack swap, grit), outro 73-80. Loads four vox banks (ljspeech, sung, call-me-baby, vocalset) on first play.' }].concat(src2 ? [{ title: 'Track demo: night phonk v2', code: src2, explain: 'v2 extends the pack (atoms-v2, racks-v2) without editing v1: kick-synced pump (pumpHard, duckorbit depth 0.8 on pads, 808, lead, counter, bells and the verb return), pre-drop vacuums, a confrontational drop A (toms, rims, stutters, lead and bell call-and-response, filter slams, chop stabs), relief 1, a stop-cut into a half-time swing drop B, relief 2 (melody opens, vocal pad swells), drop C, outro. 84 bars = 2:37.' }] : []) };
// splice the section text in place (the file is hand-formatted: one example per line), so the diff is only this section
const synText = fs.readFileSync(SYN, 'utf8'); const MARK = ',\n    {\n      "id": "tracks"', cut = synText.indexOf(MARK);
const head = cut >= 0 ? synText.slice(0, cut) : synText.slice(0, synText.lastIndexOf('\n  ]\n}'));
const secText = `,\n    {\n      "id": "tracks",\n      "title": ${JSON.stringify(sec.title)},\n      "needs": ${JSON.stringify(sec.needs)},\n      "explain": ${JSON.stringify(sec.explain)},\n      "examples": [\n${sec.examples.map((e) => '        ' + JSON.stringify(e).replace(/^\{"title":/, '{ "title": ').replace(/","code":/, '", "code": ').replace(/","explain":/, '", "explain": ').replace(/\}$/, ' }')).join(',\n')}\n      ]\n    }\n  ]\n}\n`;
const synOut = head + secText; JSON.parse(synOut);
const outs = [...(v2 ? [[path.join(ROOT, 'site/data/phonk/atoms-v2.json'), J(v2.atoms2Doc)], [path.join(ROOT, 'site/data/phonk/racks-v2.json'), J(v2.racks2Doc)], [path.join(ROOT, 'docs/tracks/night-phonk-demo/track.v2.strudel.js'), v2.track]] : []), [SYN, synOut], [path.join(ROOT, 'site/data/phonk/atoms.json'), J(atomsDoc)], [path.join(ROOT, 'site/data/phonk/racks.json'), J(racksDoc)], [path.join(ROOT, 'site/data/phonk/presets.json'), J(presets)], [path.join(ROOT, 'docs/tracks/night-phonk-demo/track.strudel.js'), packTrack]];
const check = process.argv.includes('--check'); let stale = 0;
for (const [f, t] of outs) { const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; if (cur === t) continue; stale++; if (check) console.log('stale: ' + path.relative(ROOT, f)); else { fs.writeFileSync(f, t); console.log('wrote ' + path.relative(ROOT, f)); } }
console.log(`${Object.keys(atoms).length} atoms, ${Object.keys(defs).length} racks` + (check && !stale ? ', in step' : ''));
process.exit(check && stale ? 1 : 0);
