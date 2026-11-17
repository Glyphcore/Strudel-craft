#!/usr/bin/env node
// Lowering build (docs/LOWERING.md): every place the site shows a program carries BOTH forms, generated here and verified, never hand-kept.
//   site/data/syntax.json  examples:  + "lowered" (plain Strudel) | "lowered_note" (why it cannot be plain: needs the Craft runtime) | nothing (no sugar: both forms identical)
//                                       + "lowered_check" { equal, cycles, events, hash } (hap equality of the two forms, via the CLI)
//   site/data/catalog.json recipes:    "code" is the Craft form; concept recipes (written by tools/concepts/build.mjs) carry "lowered"; this tool adds "lowered_check"
// Usage (repo root): node tools/lowering/build.mjs [--check] [--verify] [--no-verify]
//   --check      writes nothing; exit 1 when any output is stale or any lowered form drifted (events differ)
//   --verify     re-run the hap equality even when the stored check matches the current text
//   --no-verify  skip the CLI (keeps stored checks); the CLI is STRUDEL_CLI (default /home/user/suno-track-lab/engine/strudel-cli)
// Order after a concept change: node tools/concepts/build.mjs; python3 tools/packs/packs.py hash site/data/phonk --write; python3 tools/packs/shim.py; node tools/lowering/build.mjs; python3 tools/packs/shim.py
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { ROOT, createLowering, verify, hasCli, classify } from './lower.mjs';
import { readCatalog, catalogFiles } from '../catalog/lib.mjs';
const argv = process.argv.slice(2); const flag = (n) => argv.includes(n); const CHECK = flag('--check'), FORCE = flag('--verify'), NOVER = flag('--no-verify') || !hasCli();
const DROOT = process.env.LOWERING_DATA_ROOT || ROOT; // tests point this at a scratch copy of catalog.json, syntax.json and docs/LOWERING.md
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const LW = await createLowering({}); const hooksDefs = LW.ALL;
const sha = (a, b) => crypto.createHash('sha1').update(a + '\0' + (b || '')).digest('hex').slice(0, 10);
const stale = []; const drift = []; const approx = []; const stats = { catalog: { total: 0, lowered: 0, identical: 0 }, syntax: { total: 0, lowered: 0, runtime: 0, identical: 0 } };
function check(id, craft, lowered, old) { // -> lowered_check | undefined
  if (!lowered) return undefined; const h = sha(craft, lowered);
  if (!FORCE && old && old.hash === h && (old.equal === true || old.approx)) return old;
  if (NOVER) return old && old.hash === h ? old : undefined;
  const v = verify(craft, lowered, { defs: hooksDefs });
  if (!v.equal) { // the documented groove difference only: with the grooves taken out of both forms the events must be identical, else it is drift
    const ng = LW.noGrooveOf(craft, lowered); /* the stored text, never a regenerated one */ const v2 = ng && verify(ng.craft, ng.lowered, { defs: hooksDefs });
    if (v2 && v2.equal) { approx.push(id); return { equal: false, approx: true, cycles: v.cycles, reason: 'a groove (swing, push, humanize) is approximated in plain Strudel: it shifts onsets, not note lengths, and its random jitter is a different sequence (' + v.reason.split(':')[0] + '); with the groove taken out of both forms the events are identical', hash: h }; }
  }
  if (!v.equal) { drift.push(`${id}: ${v.reason}`); return { equal: false, cycles: v.cycles, reason: v.reason, hash: h }; }
  return { equal: true, cycles: v.cycles, events: v.events, hash: h };
}

// ---------- catalog ----------
const cat = readCatalog(DROOT); // #131: the full catalog (index + family bodies) in, the split files out (after the checks below)
for (const r of cat.recipes) {
  stats.catalog.total++; const c = classify(r.code);
  if (r.lowered) { stats.catalog.lowered++; const lc = check('catalog ' + r.id, r.code, r.lowered, r.lowered_check); if (lc) r.lowered_check = lc; else delete r.lowered_check; }
  else { stats.catalog.identical++; if (c.state !== 'plain') drift.push(`catalog ${r.id}: uses ${c.state === 'sugar' ? 'sugar' : c.kind} but has no "lowered" (regenerate: node tools/concepts/build.mjs)`); delete r.lowered_check; }
}
const catFiles = catalogFiles(cat); // after the loop: a check written above must reach the body files (#161: built before the loop, new checks were dropped)
for (const [rel, text] of Object.entries(catFiles)) { const f = path.join(DROOT, rel), cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; if (cur !== text) { stale.push(rel); if (!CHECK) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } } } // same text as tools/concepts/build.mjs (both validated by --check)

// ---------- syntax (one example per line; only lines that change are rewritten) ----------
const synText = fs.readFileSync(path.join(DROOT, 'site/data/syntax.json'), 'utf8'); const lines = synText.split('\n'); let seen = 0, sec = null;
const q = JSON.stringify; const objText = (e) => '{ ' + Object.entries(e).map(([k, v]) => `${q(k)}: ${q(v)}`).join(', ') + ' }';
for (let i = 0; i < lines.length; i++) {
  const sm = /^      "id": "([^"]+)"/.exec(lines[i]); if (sm) sec = sm[1];
  const m = /^(\s*)(\{\s*"title".*\})(,?)\s*$/.exec(lines[i]); if (!m) continue; let e; try { e = JSON.parse(m[2]); } catch (err) { continue; }
  if (typeof e.code !== 'string') continue; seen++; stats.syntax.total++;
  const old = { lowered: e.lowered, lowered_note: e.lowered_note, lowered_check: e.lowered_check }; delete e.lowered; delete e.lowered_note; delete e.lowered_check;
  const res = LW.lower(e.code); const id = `syntax ${sec}/${e.title}`;
  if (res.state === 'lowered') { stats.syntax.lowered++; e.lowered = res.lowered; const lc = check(id, e.code, res.lowered, old.lowered === res.lowered ? old.lowered_check : undefined); if (lc) e.lowered_check = lc; }
  else if (res.state === 'runtime') { stats.syntax.runtime++; e.lowered_note = res.why; }
  else stats.syntax.identical++;
  const same = JSON.stringify(old.lowered) === JSON.stringify(e.lowered) && old.lowered_note === e.lowered_note && JSON.stringify(old.lowered_check) === JSON.stringify(e.lowered_check);
  if (!same) lines[i] = m[1] + objText(e) + m[3];
}
const total = JSON.parse(synText).sections.flatMap((s) => s.examples).filter((e) => typeof e.code === 'string').length;
if (seen !== total) { console.error(`lowering: processed ${seen} Syntax example lines but syntax.json has ${total} examples with code (a multi-line example?)`); process.exit(2); }
const synOut = lines.join('\n'); JSON.parse(synOut);
if (synOut !== synText) { stale.push('site/data/syntax.json'); if (!CHECK) fs.writeFileSync(path.join(DROOT, 'site/data/syntax.json'), synOut); }

// ---------- the counts, generated into docs/LOWERING.md (never typed) ----------
const exAll = JSON.parse(fs.readFileSync(path.join(DROOT, 'site/data/syntax.json'), 'utf8')).sections.flatMap((s) => s.examples); const noCode = exAll.filter((e) => typeof e.code !== 'string').length;
const byWhy = {}; for (const e of exAll) if (e.lowered_note) { const k = e.lowered_note.split(/[:(;]| \(|, /)[0].replace(/^(?:the|a|an|this) /i, '').slice(0, 70); byWhy[k] = (byWhy[k] || 0) + 1; }
const apx = (xs) => xs.filter((e) => e.lowered_check && e.lowered_check.approx).length;
const countsMd = ['<!-- counts:start (generated by node tools/lowering/build.mjs; do not edit) -->',
  `Catalog: ${stats.catalog.total} recipes; ${stats.catalog.lowered} have a distinct Strudel form (${apx(cat.recipes)} approximate: grooves), ${stats.catalog.identical} are identical (no Craft syntax).`,
  `Syntax examples: ${stats.syntax.total} with code (${noCode} more are UI walkthroughs without code); ${stats.syntax.lowered} lowered (${apx(exAll)} approximate), ${stats.syntax.runtime} with no plain form, ${stats.syntax.identical} identical.`,
  'No plain form, by reason:', ...Object.entries(byWhy).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n}: ${k}`), '<!-- counts:end -->'].join('\n');
{ const f = path.join(DROOT, 'docs/LOWERING.md'); const cur = fs.readFileSync(f, 'utf8'); const next = cur.replace(/<!-- counts:start[\s\S]*?<!-- counts:end -->/, () => countsMd);
  if (next !== cur) { stale.push('docs/LOWERING.md'); if (!CHECK) fs.writeFileSync(f, next); } }
stats.syntax.noCode = noCode;
console.log(JSON.stringify({ check: CHECK, stale, drift, approx, stats }, null, 1));
process.exit(drift.length || (CHECK && stale.length) ? 1 : 0);
