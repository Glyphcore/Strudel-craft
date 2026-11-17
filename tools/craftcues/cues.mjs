#!/usr/bin/env node
// CraftCues CLI (docs/CRAFTCUES.md; issue #162). The model is site/engine/cues.js (shared with the site); the KB is site/engine/cues-kb.js.
//   node tools/craftcues/cues.mjs parse|json IN            canonical JSON on stdout (IN: .craftcues / .crafcues / .json / .vtt / a Craft program .js)
//   node tools/craftcues/cues.mjs print IN                 canonical .craftcues text
//   node tools/craftcues/cues.mjs lint IN... [--program P] [--kb] [--json]    diagnostics; exit 1 on any error (warnings exit 0)
//   node tools/craftcues/cues.mjs merge IN... [-o OUT]      merged by id (author > analysis > inferred)
//   node tools/craftcues/cues.mjs extract PROGRAM [-o OUT]  inline //@ cues of a program as .craftcues
//   node tools/craftcues/cues.mjs vtt|srt IN... [-o OUT] [--all] [--todo]   captions (merges every IN first)
//   node tools/craftcues/cues.mjs from-bank BANK.jsonl [--source-sha PREFIX|--all] [-o OUT]   form bank records -> cues (one source by default, deduped; tolerates a missing bank)
//   node tools/craftcues/cues.mjs kb ID...                 KB cards
//   node tools/craftcues/cues.mjs at IN BAR                 cues active at a bar position
// Header options on every command: --form form.json (sections, bars) --bpm B --bars N --beats N --offset S --track NAME
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as C from '../../site/engine/cues.js'; import { makeKB, cardText } from '../../site/engine/cues-kb.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2); const cmd = argv.shift(); const opt = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '-o') opt.o = argv[++i]; else if (a.startsWith('--')) { const k = a.slice(2); if (['all', 'todo', 'kb', 'json', 'strict'].includes(k)) opt[k] = true; else opt[k] = argv[++i]; } else pos.push(a); }
const die = (m, code = 2) => { console.error(m); process.exit(code); };
export function formHeader(file) { const f = JSON.parse(fs.readFileSync(file, 'utf8')); const rows = Array.isArray(f) ? f : f.sections || f.form || []; let bar = 1; const sections = []; for (const r of rows) { const n = +(r.bars || r.length || 0); if (!n) continue; sections.push({ name: C.slug(r.section || r.name || 's' + bar), from: bar, to: bar + n - 1 }); bar += n; } return { sections, bars: bar - 1 }; }
function headerOpts() { const h = {}; if (opt.form) Object.assign(h, formHeader(opt.form)); for (const k of ['bpm', 'bars', 'beats', 'offset']) if (opt[k] !== undefined) h[k] = +opt[k]; if (opt.track) h.track = opt.track; return h; }
export function load(file, extra = {}) {
  const text = fs.readFileSync(file, 'utf8'); const ext = path.extname(file).toLowerCase(); let r;
  if (ext === '.json') { r = { doc: C.fromJSON(JSON.parse(text)), problems: [] }; Object.assign(r.doc.header, extra); }
  else if (ext === '.vtt') r = { doc: C.fromVTT(text, extra), problems: [] };
  else if (ext === '.js' || ext === '.mjs') r = C.extract(text, { header: extra });
  else { r = C.parse(text); Object.assign(r.doc.header, extra); }
  return r;
}
export function nodeKB() {
  const j = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } };
  const genres = {}; const STL = process.env.SUNO_TRACK_LAB || '/home/user/suno-track-lab'; /* strudel-craft docs/genres first, then suno-track-lab's (wavephonk, dubstep-ukf ...) */
  for (const dir of [path.join(STL, 'docs/genres'), path.join(ROOT, 'docs/genres')]) { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && f !== 'genre.schema.json') { try { const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); genres[f.replace(/\.json$/, '')] = g; } catch { /* skip */ } } } catch { /* none */ } }
  let formBank = null; const bp = process.env.FORM_BANK || path.join(process.env.SUNO_TRACK_LAB || '/home/user/suno-track-lab', 'data/form-bank/bank.jsonl');
  if (fs.existsSync(bp)) { formBank = new Map(); for (const l of fs.readFileSync(bp, 'utf8').split('\n')) { try { const r = JSON.parse(l); if (r.id) formBank.set(r.id, r); } catch { /* skip */ } } }
  const items = new Map(); /* resources ids from the shipped pack catalogs (hooks@1 defs, atoms, vox banks), so hook:cowbell resolves without a program */
  const scanPack = (file) => { const m = j(file); if (!m) return; for (const ing of m.ingredients || m.items || []) { const kind = ing.kind || ''; const p = ing.path && j(path.join(path.dirname(file), ing.path)); const body = p || ing; const add = (k, name, v) => items.set(`${k}:${name}`, { title: name, def: (v && (v.doc || v.description || v.intent)) || `${k} from ${m.id || file}` }); if (/hooks/.test(kind) && body.defs) for (const [n, v] of Object.entries(body.defs)) add('hook', n, v); if (/hooks/.test(kind) && body.hooks) for (const [n, v] of Object.entries(body.hooks)) add('hook', n, v); if (/atoms/.test(kind) && body.atoms) for (const [n, v] of Object.entries(body.atoms)) add('atom', (v && v.name) || n, v); if (/vox/.test(kind) && /-words$/.test(ing.id || '')) add('vox', ing.id.replace(/-words$/, ''), { description: 'vox bank ' + ing.id.replace(/-words$/, '') }); } };
  for (const f of ['site/data/phonk/craftpack.json', 'site/data/edm/craftpack.json', 'site/data/dnb-electro/craftpack.json', 'site/data/vox/craftpack.json']) scanPack(f);
  return makeKB({ composition: j('site/data/composition.json'), syntax: j('site/data/syntax.json'), genres, formBank, resource: (id) => items.get(id) || (/^(lane|bus|slot|tap|control):/.test(id) ? { title: id, def: 'program reference (checked against the program, not the KB)' } : null) });
}
function out(text) { if (opt.o) { fs.mkdirSync(path.dirname(path.resolve(opt.o)), { recursive: true }); fs.writeFileSync(opt.o, text); console.error(`wrote ${opt.o}`); } else process.stdout.write(text); }
function loadAll(files) { const h = headerOpts(); const rs = files.map((f) => load(f, h)); const doc = C.merge(...rs.map((r) => r.doc)); Object.assign(doc.header, h); return { doc, problems: rs.flatMap((r, i) => r.problems.map((p) => ({ ...p, file: files[i] }))) }; }
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
  if (cmd === 'kb') { const kb = nodeKB(); for (const id of pos) console.log(opt.json ? JSON.stringify(kb(id)) : cardText(kb(id))); process.exit(pos.every((id) => kb(id).status !== 'unknown') ? 0 : 1); }
  if (!pos.length) die(`usage: cues.mjs ${cmd} IN...`);
  if (cmd === 'from-bank') { let recs = []; if (fs.existsSync(pos[0])) recs = fs.readFileSync(pos[0], 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); else console.error(`note: no bank at ${pos[0]} (tolerated, 0 cues)`); let d; try { d = C.fromBank(recs, { header: headerOpts(), source: opt['source-sha'] || null, all: opt.all !== undefined }); } catch (e) { console.error(String(e.message || e)); process.exit(2); } const R = C.fromBank.report; console.error(`from-bank: ${R.kept} cues from ${R.picked ? 'source ' + R.picked : 'all ' + R.sources + ' source(s)'} (${R.records} records, ${R.dropped} deduped; ${R.sources} source(s) in the bank; --source-sha PREFIX (>= 8 hex) picks one, --all keeps every source)`); out(C.print(d)); process.exit(0); }
  const { doc, problems } = loadAll(pos);
  if (cmd === 'parse' || cmd === 'json') out(JSON.stringify(C.toJSON(doc), null, 1) + '\n');
  else if (cmd === 'print' || cmd === 'merge' || cmd === 'extract') out(C.print(doc));
  else if (cmd === 'vtt') out(C.toVTT(doc, { all: opt.all, todo: opt.todo }));
  else if (cmd === 'srt') out(C.toSRT(doc, { all: opt.all, todo: opt.todo }));
  else if (cmd === 'at') { const p = +pos[pos.length - 1]; const files = pos.slice(0, -1); const d = files.length ? loadAll(files).doc : doc; for (const c of C.activeAt(d, p)) console.log(C.printLine(c)); }
  else if (cmd === 'lint') {
    let lanes = null; if (opt.program) { const src = fs.readFileSync(opt.program, 'utf8'); const { scan } = await import('../../site/engine/lanes.js'); try { lanes = scan(src).lanes.map((l) => l.id || l.label).filter(Boolean); } catch { lanes = null; } }
    const ds = C.lint(doc, { problems, kb: opt.kb ? nodeKB() : null, lanes });
    if (opt.json) console.log(JSON.stringify(ds, null, 1)); else { for (const d of ds) console.log(`${d.level.toUpperCase().padEnd(5)} ${d.code}${d.id ? ' ' + d.id : ''}${d.line ? ' line ' + d.line : ''}${d.file ? ' (' + path.basename(d.file) + ')' : ''}: ${d.msg}`); console.log(`${doc.cues.length} cues, ${ds.filter((d) => d.level === 'error').length} errors, ${ds.filter((d) => d.level === 'warn').length} warnings`); }
    process.exit(ds.some((d) => d.level === 'error') || (opt.strict && ds.length) ? 1 : 0);
  } else die(`unknown command ${cmd}`);
}
