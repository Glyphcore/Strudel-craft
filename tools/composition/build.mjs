#!/usr/bin/env node
// Composition catalog build (docs/COMPOSITION.md): tools/composition/catalog.mjs -> site/data/composition.json (syntax@1 ingredient
// "composition" of glyphcore/shim, shown in the Syntax view under the folder composition/<family>) and the catalog part of docs/COMPOSITION.md.
// Both forms of every example come from tools/lowering (never hand-written): "lowered" + "lowered_check" (event equality via the CLI),
// or "lowered_note" (no plain form: gates, lanes, buses). Examples with no plain form get a smoke run ("smoke": events on 2 cycles).
// Usage (repo root): node tools/composition/build.mjs [--check] [--verify] [--no-verify]
// Then: python3 tools/packs/shim.py; node tools/pwa/precache.mjs.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { ROOT, createLowering, verify, hasCli, events } from '../lowering/lower.mjs';
import { FAMILIES, ENTRIES } from './catalog.mjs';
const argv = process.argv.slice(2); const CHECK = argv.includes('--check'), FORCE = argv.includes('--verify'), NOVER = argv.includes('--no-verify') || !hasCli();
const OUT = path.join(ROOT, 'site/data/composition.json'), DOC = path.join(ROOT, 'docs/COMPOSITION.md');
const sha = (...a) => crypto.createHash('sha1').update(a.join('\0')).digest('hex').slice(0, 10);
const LW = await createLowering({}); const defs = LW.ALL;
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { sections: [] };
const oldEx = new Map(old.sections.flatMap((s) => (s.examples || []).map((e) => [s.id, e])));
const fam = Object.fromEntries(FAMILIES.map(([id, title, folder, intro]) => [id, { id, title, folder, intro }]));
const problems = [], stats = { entries: 0, lowered: 0, runtime: 0, identical: 0, verified: 0, approx: 0, smoke: 0, failed: 0 };
const ids = new Set();
const sections = [];
for (const e of ENTRIES) {
  if (ids.has(e.id)) problems.push(`duplicate id ${e.id}`); ids.add(e.id);
  for (const k of ['def', 'why', 'when', 'code', 'check', 'anti']) if (!e[k] || (Array.isArray(e[k]) && !e[k].length)) problems.push(`${e.id}: missing ${k}`);
  stats.entries++;
  const F = fam[e.fam]; const sid = e.id.toLowerCase();
  const ex = { title: `${e.id} ${e.title.toLowerCase()}`, code: e.code };
  const res = LW.lower(e.code); const prev = oldEx.get(sid) || {};
  if (res.state === 'lowered') {
    stats.lowered++; ex.lowered = res.lowered; const h = sha(e.code, res.lowered);
    if (!FORCE && prev.lowered_check && prev.lowered_check.hash === h && (prev.lowered_check.equal || prev.lowered_check.approx)) { ex.lowered_check = prev.lowered_check; stats[prev.lowered_check.equal ? 'verified' : 'approx']++; }
    else if (!NOVER) {
      const v = verify(e.code, res.lowered, { defs });
      if (v.equal) { ex.lowered_check = { equal: true, cycles: v.cycles, events: v.events, hash: h }; stats.verified++; }
      else { // the documented groove difference only (docs/LOWERING.md, same rule as tools/lowering/build.mjs): without grooves the events must match
        const ng = LW.noGrooveOf(e.code, res.lowered); const v2 = ng && verify(ng.craft, ng.lowered, { defs });
        if (v2 && v2.equal) { stats.approx++; ex.lowered_check = { equal: false, approx: true, cycles: v.cycles, reason: 'a groove (swing, push, humanize) is approximated in plain Strudel: it shifts onsets, not note lengths, and its random jitter is a different sequence (' + v.reason.split(':')[0] + '); with the groove taken out of both forms the events are identical', hash: h }; }
        else { ex.lowered_check = { equal: false, cycles: v.cycles, reason: v.reason, hash: h }; problems.push(`${e.id}: lowered form differs: ${v.reason}`); stats.failed++; }
      } }
  } else {
    if (res.state === 'runtime') { stats.runtime++; ex.lowered_note = res.why; } else stats.identical++;
    const h = sha(e.code);
    if (!FORCE && prev.smoke && prev.smoke.hash === h && prev.smoke.ok) { ex.smoke = prev.smoke; stats.smoke++; }
    else if (!NOVER) { const r = events(e.code, { defs, cycles: 2 }); ex.smoke = r.error ? { ok: false, error: String(r.error).slice(0, 200), hash: h } : { ok: true, cycles: 2, events: r.events.length, hash: h };
      if (r.error || !r.events.length) { problems.push(`${e.id}: smoke run failed: ${r.error || 'no events'}`); stats.failed++; } else stats.smoke++; }
  }
  const status = ex.lowered ? (ex.lowered_check && ex.lowered_check.equal ? 'lowered' : ex.lowered_check && ex.lowered_check.approx ? 'approx' : 'unverified') : res.state === 'runtime' ? 'craft-runtime' : 'plain';
  sections.push({ id: sid, title: `${e.id} ${e.title}`, needs: e.needs || 'hooks', folder: `composition/${F.folder}`,
    tags: [...new Set(['composition', F.folder, ...(e.tags || []), e.tool ? 'measured' : null, status].filter(Boolean))].slice(0, 24),
    explain: e.def, notes: [['Why it works', e.why], ['When to use', e.when], ['Measure', e.check], ['Anti-patterns', e.anti]], tool: e.tool || null, examples: [ex] });
}
const data = { version: 1, title: 'Composition concepts', doc: 'docs/COMPOSITION.md', licence: 'CC0-1.0',
  families: FAMILIES.map(([id, title, folder, intro]) => ({ id, title, folder: `composition/${folder}`, intro })), sections };
const out = JSON.stringify(data, null, 1) + '\n';
const stale = [];
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== out) { stale.push('site/data/composition.json'); if (!CHECK) fs.writeFileSync(OUT, out); }
// ---------- docs/COMPOSITION.md catalog part ----------
const md = ['<!-- catalog:start (generated by node tools/composition/build.mjs from tools/composition/catalog.mjs; do not edit here) -->', ''];
md.push('| family | ids | folder |', '|---|---|---|');
for (const [id, title, folder] of FAMILIES) { const xs = ENTRIES.filter((e) => e.fam === id).map((e) => e.id); md.push(`| ${title} | ${xs[0]} .. ${xs[xs.length - 1]} (${xs.length}) | composition/${folder} |`); }
md.push('');
for (const [id, title, folder, intro] of FAMILIES) {
  md.push(`### ${title}`, '', intro, '');
  for (const e of ENTRIES.filter((x) => x.fam === id)) {
    const s = sections.find((x) => x.id === e.id.toLowerCase()); const ex = s.examples[0];
    md.push(`#### ${e.id} ${e.title}`, '', `- **Definition.** ${e.def}`, `- **Why it works.** ${e.why}`, `- **When.** ${e.when}`,
      `- **Measure.** ${e.check}` + (e.tool ? ` (engine/composer \`${e.tool}\`)` : ''), `- **Anti-patterns.** ${e.anti.join('; ')}.`, `- **Tags.** ${s.tags.join(', ')}`, '',
      'Craft form:', '', '```js', e.code, '```', '');
    if (ex.lowered) md.push(`Strudel form (generated${ex.lowered_check && ex.lowered_check.equal ? `, same events on ${ex.lowered_check.cycles} cycles` : ex.lowered_check && ex.lowered_check.approx ? ', approximate: the groove is approximated, the rest has the same events' : ''}):`, '', '```js', ex.lowered, '```', '');
    else if (ex.lowered_note) md.push(`Strudel form: none (${ex.lowered_note}).`, '');
    else md.push('Strudel form: identical (no Craft syntax).', '');
  }
}
md.push('<!-- catalog:end -->');
const cur = fs.readFileSync(DOC, 'utf8'); const next = cur.replace(/<!-- catalog:start[\s\S]*?<!-- catalog:end -->/, () => md.join('\n'));
if (next !== cur) { stale.push('docs/COMPOSITION.md'); if (!CHECK) fs.writeFileSync(DOC, next); }
console.log(JSON.stringify({ check: CHECK, stale, problems, stats }, null, 1));
process.exit(problems.length || (CHECK && stale.length) ? 1 : 0);
