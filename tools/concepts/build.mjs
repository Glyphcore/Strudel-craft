#!/usr/bin/env node
// Concept builder (docs/CONVENTIONS.md): one data source per concept family, tools/concepts/families/<family>.json, becomes
//   - pack ingredients of glyphcore/phonk: racks-hiphop.json (hooks@1), atoms-<id>.json and feel-<id>.json (atoms@1)
//   - catalog recipes in site/data/catalog.json (origin "concepts"; plain Strudel lowered from the same racks, atoms and grooves)
//   - the Syntax view section "feels" in site/data/syntax.json (hooks / atoms / pack programs)
//   - classes for the rack audit in tools/racks/targets.json
// Usage (repo root): node tools/concepts/build.mjs [--render | --changed] [--check] [--only RECIPE_ID,...] [--jobs N]
//   --render  renders every catalog recipe headless with the strudel CLI (STRUDEL_CLI) and stores verified / rms_dbfs / centroid_hz / peak;
//             without it, results of an unchanged recipe code are kept from the current catalog
//   --changed renders only the recipes whose code changed since the current catalog
//   --check   writes nothing; exit 1 when any output is stale
// After a change: node tools/concepts/build.mjs --render, python3 tools/packs/packs.py hash site/data/<pack dir> --write, python3 tools/packs/shim.py,
// node tools/racks/audit.mjs (hygiene). Families are data only; adding a concept never needs code here (docs/CONVENTIONS.md section 7).
// Packs: a family ships in glyphcore/phonk unless it says "pack": "author/name" (then site/data/<name>/, whose craftpack.json must exist; the builder
// writes its ingredient list). A family of another pack may add "section" { id, title, explain } (its Syntax section) and "labels" [[id, title, category, words]].
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync, spawn } from 'node:child_process'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const HERE = path.join(ROOT, 'tools/concepts');
const TX = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'taxonomy.mjs')).href);
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const L = await imp('tools/lowering/lower.mjs'); const A = await imp('site/engine/atoms.js'); const AC = await imp('site/engine/atoms-consumers.js'); const { HYGIENE } = await imp('site/engine/hygiene.js'); const G = await imp('site/engine/groove.js');
A.loadTypes(fs.readFileSync(path.join(ROOT, 'site/data/atoms/types.json'), 'utf8'));
const argv = process.argv.slice(2); const flag = (n) => argv.includes(n); const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CHECK = flag('--check'), RENDER = flag('--render'), CHANGED = flag('--changed'), ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const CLI = process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli';
const PACK = 'glyphcore/phonk'; const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const packOf = (f) => f.pack || PACK; const dirOf = (pk) => pk.split('/')[1]; // glyphcore/edm -> site/data/edm
const ORDER = ['hiphop', 'dovetail', 'groove', 'feels', 'edm-core'];
const fams = fs.readdirSync(path.join(HERE, 'families')).filter((f) => f.endsWith('.json')).map((f) => rd(path.join(HERE, 'families', f)))
  .sort((a, b) => ((ORDER.indexOf(a.family) + 1 || 99) - (ORDER.indexOf(b.family) + 1 || 99)) || a.family.localeCompare(b.family));
const die = (m) => { console.error('concepts: ' + m); process.exit(2); };

// ---------- atoms: one namespace per family ingredient ----------
const NS = {}; for (const f of fams) if (f.atomsIngredient) NS[f.atomsIngredient.ns] = f.atoms || {};
const famNs = (f) => f.atomsIngredient?.ns;
function atomBody(ns, name, where) { const a = NS[ns]?.[name]; if (!a) die(`${where}: unknown atom ${ns}.${name}`); if (a.params) die(`${where}: ${ns}.${name} has params (use it from hooks, not as a pattern)`); return a.body; }
const REF = /@(?:([a-z]\w*):)?([A-Za-z]\w*)/g;
function pat(str, f, where) { // "@name" / "@ns:name" -> the atom body (bracketed when it is part of a longer pattern)
  return str.replace(REF, (tok, ns, name) => { const b = atomBody(ns || famNs(f), name, where); return tok === str ? b : `[${b}]`; });
}
const quoted = (s, f, where) => s.replace(/"([^"]*)"/g, (_, x) => JSON.stringify(pat(x, f, where))); // patterns inside "..." of a `more` string

// ---------- racks: every def a recipe may name ----------
const own = {}; for (const f of fams) for (const [n, d] of Object.entries(f.racks || {})) { if (own[n]) die(`rack ${n} defined twice`); own[n] = { fam: f, def: d }; }
const resolveDef = (f, def) => JSON.parse(JSON.stringify(def.chain), (k, v) => (v && typeof v === 'object' && '$atomBody' in v ? { $mini: atomBody(famNs(f), v.$atomBody, 'rack') } : v));
for (const f of fams) TX.registerFamily(f); for (const f of fams) for (const id of Object.keys(f.feels || {})) TX.registerFeel(`feel-${id}`, f);
const ownDefs = Object.fromEntries(Object.entries(own).map(([n, { fam, def }]) => [n, { ...(def.params ? { params: def.params } : {}), chain: resolveDef(fam, def), ...TX.rackTaxonomy(n, def, def.class, fam.racksIngredient || 'racks-hiphop') }]));
const LW = await L.createLowering({ defs: Object.fromEntries(Object.entries(ownDefs).map(([n, d]) => [n, { ...d, folder: undefined, tags: undefined }])), die }); // racks, hygiene and grooves -> plain steps (tools/lowering/lower.mjs, shared with the Syntax lowering)
const { expand, plain } = LW;

// ---------- recipes ----------
function voiceCode(v, f, where) {
  const p = pat(v.pat, f, where); let c = `${v.src}(${JSON.stringify(p)})`;
  if (v.vel) c += `.velocity(${JSON.stringify(pat(v.vel, f, where))})`;
  if (v.rack) c += plain(expand(v.rack + (v.args || '')), where);
  if (v.groove) c += plain(expand(v.groove), where);
  if (v.move) c += plain(expand(v.move), where);
  if (v.more) c += quoted(v.more, f, where);
  return c;
}
// The authored Craft form of the same voices (the source of truth): whole-string atom refs stay atoms.<ns>.<name>, rack | groove | move stay one .hook("..."),
// the imports are written out. recipeCode returns both: `code` is the plain Strudel lowering (what renders and opens on strudel.cc), `craft` the Craft program.
const NSID = Object.fromEntries(fams.filter((f) => f.atomsIngredient).map((f) => [f.atomsIngredient.ns, f.atomsIngredient.id]));
const NSPACK = Object.fromEntries(fams.filter((f) => f.atomsIngredient).map((f) => [f.atomsIngredient.ns, packOf(f)]));
const RACKPACK = Object.fromEntries(Object.entries(own).map(([n, { fam }]) => [n, fam.racksIngredient ? `${packOf(fam)}:${fam.racksIngredient}` : null]));
const WHOLE = /^@(?:([a-z]\w*):)?([A-Za-z]\w*)$/;
function craftPat(str, f, where, used) { // a whole-string atom ref -> atoms.ns.name; anything else -> the literal mini string with atoms inlined
  const m = WHOLE.exec(str); if (!m) return JSON.stringify(pat(str, f, where));
  const ns = m[1] || famNs(f); atomBody(ns, m[2], where); used.add(ns); return `atoms.${ns}.${m[2]}`;
}
function craftVoice(v, f, where, used) {
  let c = `${v.src}(${craftPat(v.pat, f, where, used)})`;
  if (v.vel) c += `.velocity(${craftPat(v.vel, f, where, used)})`;
  const steps = [v.rack && v.rack + (v.args || ''), v.groove, v.move].filter(Boolean); if (steps.length) c += `.hook(${JSON.stringify(steps.join(' | '))})`;
  if (v.more) c += v.more.replace(/"([^"]*)"/g, (_, x) => craftPat(x, f, where, used));
  return c;
}
function recipeCode(r, f) {
  const lines = r.voices.map((v) => voiceCode(v, f, r.id)); const used = new Set(); const craftLines = r.voices.map((v) => craftVoice(v, f, r.id, used));
  const head = (r.cpm ? `setcpm(${r.cpm}/4)\n` : '');
  const imports = [...used].map((ns) => `atoms.import("pack:${NSPACK[ns]}:${NSID[ns]}")`).join('\n'); // default namespace = the ingredient's own (hh, dt)
  // a program must name a pack for the site to install its hooks (engine/index.js, #91): racks of a pack other than phonk whose atoms are not imported get a naming comment
  const named = new Set([...used].map((ns) => NSPACK[ns])); const racksOf = new Set(r.voices.flatMap((v) => [v.rack, ...(v.move || '').split('|').map((x) => x.trim().split('(')[0])]).filter(Boolean).map((n) => RACKPACK[n]).filter((q) => q && !q.startsWith(PACK + ':') && !named.has(q.split(':')[0])));
  const naming = [...racksOf].map((q) => `// racks: pack:${q}`).join('\n');
  return { code: head + lines.map((l) => '$: ' + l).join('\n'), expr: lines.length === 1 && !r.cpm ? lines[0] : null, craft: head + (imports ? imports + '\n' : '') + (naming ? naming + '\n' : '') + craftLines.map((l) => '$: ' + l).join('\n') };
}
const T = rd(path.join(HERE, 'families', 'feels.json')).template; // the feel template is shared data
const gx = (g, seed) => (g.includes('$seed') ? g.replace(/\$seed/g, seed) : `${g}(${seed})`); // a feel groove is a preset name (seed appended) or an expression with $seed ("groove-swing(54) | groove-human(2.5, 0.15, $seed)")
const feelVoices = (fe) => T.voices.map((v, i) => { const x = fe.voices[v] || { pat: '~' }; const gr = x.groove === false ? null : `${gx(x.groove || fe.groove, i + 1)}${x.push ? ` | groove-push(${x.push})` : ''}`; return { name: v, src: T.src[v], pat: x.pat, vel: x.vel, rack: x.rack, args: x.args, grooveExpr: gr }; });
// a recipe with "program": a whole Craft program file (a track); its Strudel form is generated by the lowering and, with "standalone", written
// out as the paste-ready plain program (both are outputs, so --check catches a stale copy)
const standalones = [];
function programCode(r) { const craft = fs.readFileSync(path.join(ROOT, r.program), 'utf8'); const res = LW.lower(craft);
  if (res.state !== 'lowered') die(`recipe ${r.id}: ${r.program} has no plain form (${res.why || res.state})`);
  const head = `// GENERATED from ${path.basename(r.program)} by tools/concepts/build.mjs (lowering, docs/LOWERING.md): plain Strudel, paste-ready for strudel.cc. Edit the Craft file, not this one.\n`;
  if (r.standalone) standalones.push([r.standalone, head + res.lowered]);
  // the catalog copy drops the full-line lesson comments (the files keep them; the catalog is eager weight, tests/site/shell_budget.mjs) and points to the files
  const lean = (t) => `// ${r.title}: the annotated program with every lesson is ${r.program}${r.standalone ? ` (plain Strudel: ${r.standalone})` : ''}\n` + t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return { code: lean(res.lowered), expr: null, craft: lean(craft) }; }
const recipes = []; const syntax = []; const targets = { racks: {}, catalog: {}, syntax: {} };
for (const f of fams) {
  for (const r of f.recipes || []) recipes.push({ fam: f, r, ...(r.program ? {} : recipeCode(r, f)) }); // programs are lowered after the atoms ingredients are built
  for (const s of f.syntax || []) { if (s.codeFile) s.code = fs.readFileSync(path.join(ROOT, s.codeFile), 'utf8'); syntax.push(s); } // codeFile: a whole program kept in its own file (track demos)
  for (const [id, fe] of Object.entries(f.feels || {})) {
    const vs = feelVoices(fe).filter((v) => v.pat !== '~' && v.rack); const r = { id: `feel-${id}`, title: `Feel: ${fe.title.toLowerCase()}`, intent: `${fe.doc} (${fe.tempo}).`, labels: fe.labels, class: 'demo', cpm: fe.cpm, bars: fe.bars || 2,
      notes: `Craft form of the feel template ${packOf(f)}:feel-${id} (atoms and rack | groove hooks); the Strudel tab has racks and grooves written out. To use the whole template: atoms.import("pack:${packOf(f)}:feel-${id}", { as: "feel" }).`,
      voices: vs.map((v) => ({ src: v.src, pat: v.pat, vel: v.vel, rack: v.rack, args: v.args, groove: v.grooveExpr })) };
    recipes.push({ fam: f, r, ...recipeCode(r, f) });
  }
}
for (const [n, { def }] of Object.entries(own)) targets.racks[n] = { class: def.class, ...(def.target || {}) };
for (const { r } of recipes) targets.catalog[r.id] = { class: r.class || 'demo', ...(r.bars ? { bars: r.bars } : {}) };

// ---------- feel ingredients + their Syntax examples ----------
const feelsFam = fams.find((f) => f.family === 'feels'); const feelFams = fams.filter((f) => f.feels);
const atomsDoc = (fid, ns, doc, items, qualify) => { const taken = new Set(); const atoms = {};
  for (const [name, a] of Object.entries(items)) { const rec = { name, type: a.type, rev: 1, ...(a.params ? { params: a.params } : {}), body: a.body, ...(a.doc ? { doc: a.doc } : {}) }; const tx = TX.atomTaxonomy(fid, ns, name, a);
    const id = A.idFor(a.type, qualify ? `${qualify}/${name}` : name, taken); taken.add(id); atoms[id] = { ...rec, folder: tx.folder, tags: tx.tags, hash: A.atomHash(rec) }; } // folder and tags are not part of the content hash
  const d = { format: 'atoms@1', name: ns, doc, atoms }; AC.verifyIngredient({ data: d }); return d; };
const nsItems = (ns, items) => Object.fromEntries(Object.entries(items).map(([n, a]) => [`${ns}.${n}`, a]));
const ingredients = [];
for (const f of fams) if (f.atomsIngredient) { const ai = f.atomsIngredient; ingredients.push({ pack: packOf(f), id: ai.id, kind: 'atoms', file: `${ai.id}.json`, title: ai.title, description: ai.doc.split(' Import')[0], data: atomsDoc(ai.id, ai.ns, ai.doc, nsItems(ai.ns, f.atoms), null) }); }
for (const ff of feelFams) for (const [id, fe] of Object.entries(ff.feels)) { const PK = packOf(ff);
  const items = {}; for (const v of feelVoices(fe)) {
    items[v.name] = { type: 'mini', body: pat(v.pat, ff, `feel ${id}`), doc: `${v.name} pattern` };
    items[`${v.name}Vel`] = { type: 'mini', body: v.vel ? pat(v.vel, ff, `feel ${id}`) : '1', doc: `${v.name} accents (velocity)` };
    items[`${v.name}Rack`] = { type: 'hook', body: v.rack ? `${v.rack}${v.args || ''}${v.grooveExpr ? ' | ' + v.grooveExpr : ''}` : gx(fe.groove, T.voices.indexOf(v.name) + 1), doc: `${v.name} rack and groove` };
  }
  items.groove = { type: 'hook', body: gx(fe.groove, 0), doc: 'the feel groove for any extra voice: .hook(atoms.feel.groove)' };
  const doc = `Feel template "${fe.title}" (${fe.tempo}): ${fe.doc}. Slots drums (kick, snare, perc), top (hats, top), bass, harmony, fx, groove; per voice <v> (pattern), <v>Vel (accents), <v>Rack (rack | groove). Import with atoms.import("pack:${PK}:feel-${id}", { as: "feel" }).`;
  ingredients.push({ pack: PK, id: `feel-${id}`, kind: 'atoms', file: `feel-${id}.json`, title: `Feel: ${fe.title}`, description: doc.split(' Import')[0], data: atomsDoc(`feel-${id}`, 'feel', doc, items, `feel-${id}`) });
}
const fitList = (head, names, max) => { let n = names.length; const txt = (k) => head + names.slice(0, k).join(', ') + (k < names.length ? ` and ${names.length - k} more` : ''); while (n > 1 && txt(n).length > max) n--; return txt(n); }; // manifest descriptions are at most 400 characters
// one hooks ingredient per (pack, racksIngredient); the phonk one keeps its 1.3.0 title and doc
const rackIngs = new Map(); for (const [n, { fam }] of Object.entries(own)) { const k = `${packOf(fam)}:${fam.racksIngredient || 'racks-hiphop'}`; if (!rackIngs.has(k)) rackIngs.set(k, { fam, names: [] }); rackIngs.get(k).names.push(n); }
for (const [k, { fam, names }] of [...rackIngs].reverse()) { const [pk, rid] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)]; const phonk = pk === PACK && rid === 'racks-hiphop'; const defs = Object.fromEntries(names.map((n) => [n, ownDefs[n]]));
  ingredients.unshift({ pack: pk, id: rid, kind: 'hooks', file: `${rid}.json`, title: phonk ? 'Hip-hop and dovetail racks' : fam.racksTitle, description: phonk ? `Chain-only hook defs: ${names.join(', ')}` : fitList('Chain-only hook defs: ', names, 400), data: { model: 1, meta: { id: `${pk}:${rid}`, doc: phonk ? 'Hip-hop, trap and hyphy instrument racks (band-scoped, docs/RACK_STANDARD.md) and dovetail moves (fadeOut, fadeIn, throw, tailHold, duckUnder). Bind into a slot: hooks.bind("kick", "bbKick | groove-pocket(1)").' : fam.racksDoc }, defs } }); }
const grooveDefs = Object.fromEntries(Object.entries(G.GROOVES).map(([n, d]) => [n, { ...JSON.parse(JSON.stringify(d)), ...TX.rackTaxonomy(n, d, 'groove', 'grooves') }]));
ingredients.push({ id: 'grooves', kind: 'hooks', file: 'grooves.json', title: 'Groove presets', description: `Chain-only hook defs, the standard-library presets as pack content: ${Object.keys(grooveDefs).join(', ')}`, data: { model: 1, meta: { id: `${PACK}:grooves`, doc: 'Groove presets (docs/CONVENTIONS.md section 4): the same defs as the standard library in site/engine/groove.js, shipped as pack content so they have a namespace, a folder and tags. A program or pack def of the same name wins.' }, defs: grooveDefs } });
for (const g of ingredients) if (!g.pack) g.pack = PACK;
const skeleton = (imports, binds, lanes) => ['setcpm(140/4)', ...imports, ...binds, ...lanes].join('\n');
const VOICES = T.voices; const lane = (as, v, tag) => `${tag ? tag + '_' : ''}${v}: ${T.src[v]}(atoms.${as}.${v}).velocity(atoms.${as}.${v}Vel).use("${tag ? tag + '/' : ''}${v}", { mode: "swap" })${tag ? `.tags("${tag}")` : ''}`;
if (feelsFam) {
  syntax.push({ title: 'Pick a feel (one import line)', explain: 'feel-trap, -boombap, -lazy, -hyphy, -cloud fill the same slots; change the import to change the feel', bars: 2,
    code: skeleton([`atoms.import("pack:${PACK}:feel-trap", { as: "feel" })   // or feel-boombap, feel-lazy, feel-hyphy, feel-cloud`], VOICES.map((v) => `hooks.bind("${v}", atoms.feel.${v}Rack)`), VOICES.map((v) => lane('feel', v))) });
  syntax.push({ title: 'Override one slot of a feel', explain: 'slots are in swap mode: the later bind wins, the rest of the feel stays', bars: 2,
    code: skeleton([`atoms.import("pack:${PACK}:feel-trap", { as: "feel" })`], [...['kick', 'snare', 'hats', 'bass'].map((v) => `hooks.bind("${v}", atoms.feel.${v}Rack)`), 'hooks.bind("hats", "openHat | groove-lazy(3)")   // override: open hats, lazy groove'], ['kick', 'snare', 'hats', 'bass'].map((v) => lane('feel', v))) });
  syntax.push({ title: 'Beat switch between two feels', explain: 'two feels under two names; lane tags and gates switch at bar 3', bars: 4,
    code: skeleton([`atoms.import("pack:${PACK}:feel-boombap", { as: "a" }); atoms.import("pack:${PACK}:feel-trap", { as: "b" })`], ['a', 'b'].flatMap((as) => ['kick', 'snare', 'hats'].map((v) => `hooks.bind("${as}/${v}", atoms.${as}.${v}Rack)`)), [...['a', 'b'].flatMap((as) => ['kick', 'snare', 'hats'].map((v) => lane(as, v, as))), 'tagged("a").mute("@3b")', 'tagged("b").mute("<3b")']) });
}
for (const f of fams) if (f.section) for (const s of f.syntax || []) s.section = f.section.id;
for (const s of syntax) targets.syntax[`${s.section || 'feels'}/${s.title}`] = { class: 'demo', ...(s.bars ? { bars: s.bars } : {}), ...(s.skip ? { skip: s.skip } : {}) };

const outputs = new Map(); const put = (rel, text) => outputs.set(rel, text);
// programs: lowered against the atoms ingredients generated above (not the files on disk, which may be stale)
for (const g of ingredients) if (g.kind === 'atoms') LW.imports[`pack:${g.pack}:${g.id}`] = AC.importedAtoms({ data: g.data, id: `${g.pack}:${g.id}`, format: 'atoms@1', kind: 'atoms' });
for (const x of recipes) if (x.r.program) Object.assign(x, programCode(x.r));
for (const [rel, text] of standalones) put(rel, text);

// ---------- render check (catalog fields) ----------
const prev = new Map(rd(path.join(ROOT, 'site/data/catalog.json')).recipes.map((r) => [r.id, r]));
function wavStats(file) {
  const b = fs.readFileSync(file); let p = 12, fmt = null, data = null; while (p + 8 <= b.length) { const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }; if (id === 'data') data = b.subarray(p + 8, p + 8 + sz); p += 8 + sz + (sz & 1); }
  const by = fmt.bits / 8, n = Math.floor(data.length / (by * fmt.ch)); const x = new Float64Array(n); let peak = 0, ss = 0;
  for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < fmt.ch; c++) { const o = (i * fmt.ch + c) * by; const v = fmt.tag === 3 ? data.readFloatLE(o) : data.readInt16LE(o) / 32768; peak = Math.max(peak, Math.abs(v)); ss += v * v; m += v / fmt.ch; } x[i] = m; }
  const N = 4096; let cw = 0, w = 0; const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= n; s += N) { for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
    for (let len = 2; len <= N; len <<= 1) { const ang = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const cr = Math.cos(ang * k), ci = Math.sin(ang * k), a = i + k, b2 = a + len / 2; const xr = re[b2] * cr - im[b2] * ci, xi = re[b2] * ci + im[b2] * cr; re[b2] = re[a] - xr; im[b2] = im[a] - xi; re[a] += xr; im[a] += xi; } }
    for (let k = 1; k < N / 2; k++) { const mag = Math.hypot(re[k], im[k]); cw += k * fmt.sr / N * mag; w += mag; } }
  const rms = Math.sqrt(ss / (n * fmt.ch)); return { peak: Math.round(peak * 1e4) / 1e4, rms_dbfs: rms > 0 ? Math.round(200 * Math.log10(rms)) / 10 : null, centroid_hz: w ? Math.round(cw / w) : null };
}
// --jobs N renders N recipes at a time (default 1); results equal one at a time (each render is its own CLI process)
const JOBS = Math.max(1, +(opt('--jobs') || 1));
function renderAsync(r, code) {
  return new Promise((resolve) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'concepts-')); const f = path.join(d, 'in.strudel.js'); fs.writeFileSync(f, code);
    const p = spawn(path.join(CLI, 'strudel'), ['render', f, d, '--bars', String(r.bars || 2)], { env: { ...process.env, STRUDEL_CRAFT: ROOT } }); let so = '', se = '';
    p.stdout.on('data', (x) => { so += x; }); p.stderr.on('data', (x) => { se += x; });
    p.on('close', (status) => { const wav = path.join(d, 'mix.wav'); let out;
      if (status !== 0 || !fs.existsSync(wav)) out = { verified: false, rms_dbfs: null, centroid_hz: null, peak: 0, error: (se + so).trim().split('\n').filter((l) => /rror/.test(l)).pop() || `exit ${status}` };
      else { const st = wavStats(wav); const err = se.split('\n').find((l) => /\berror\b/i.test(l) && !/stop time|time value \(-?[\d.]+\) cannot be negative/i.test(l)); out = { verified: st.peak > 1e-4 && !err, ...st, error: err || (st.peak > 1e-4 ? null : 'silent') }; }
      fs.rmSync(d, { recursive: true, force: true }); resolve(out); });
  });
}
const wantRender = ({ r, code }) => { const old = prev.get(r.id); return (RENDER && (!ONLY || ONLY.has(r.id))) || (CHANGED && !CHECK && !(old && (old.lowered || old.code) === code && old.origin === 'concepts')); };
const rendered = new Map(); { const todo = recipes.filter(wantRender); let next = 0;
  await Promise.all(Array.from({ length: JOBS }, async () => { while (next < todo.length) { const { r, code } = todo[next++]; const res = await renderAsync(r, code); rendered.set(r.id, res); process.stderr.write(`${res.verified ? 'OK  ' : 'FAIL'} ${r.id} rms=${res.rms_dbfs} cen=${res.centroid_hz} ${res.error || ''}\n`); } })); }
const catRecipes = recipes.map(({ fam, r, code, expr, craft }) => {
  const old = prev.get(r.id); let res;
  if (rendered.has(r.id)) res = rendered.get(r.id);
  else if (old && (old.lowered || old.code) === code && old.origin === 'concepts') res = { verified: old.verified, rms_dbfs: old.rms_dbfs, centroid_hz: old.centroid_hz, peak: old.peak, error: old.error };
  else res = { verified: false, rms_dbfs: null, centroid_hz: null, peak: 0, error: 'not rendered' };
  const lowered = craft !== code ? code : null; const keep = old && old.origin === 'concepts' && old.code === craft && old.lowered === lowered && old.lowered_check ? { lowered_check: old.lowered_check } : {}; // lowered_check is (re)written by tools/lowering/build.mjs after the packs are hashed
  return { id: r.id, title: r.title, intent: r.intent, code: craft, ...(lowered ? { lowered } : {}), ...keep, notes: r.notes || '', labels: r.labels, source: fam.source || 'docs/CONVENTIONS.md', unverified: [], origin: 'concepts', family: fam.family, needs_samples: false, expr, bpm_hint: r.cpm || null, verified: res.verified, rms_dbfs: res.rms_dbfs, centroid_hz: res.centroid_hz, peak: res.peak, error: res.error };
});

// ---------- write / check ----------
const J = (x) => JSON.stringify(x, null, 1) + '\n';
for (const ing of ingredients) put(`site/data/${dirOf(ing.pack)}/${ing.file}`, J(ing.data));
const NEWLABELS = [['hip-hop', 'Hip-hop', 'feel', 'boom bap, rap beat, backdrop'], ['boom-bap', 'Boom-bap', 'feel', 'dusty, knock, pocket'], ['trap', 'Trap', 'feel', '808, rolling hats, half-time'], ['hyphy', 'Hyphy', 'feel', 'bay area, bounce, stomp'], ['cloud', 'Cloud / wave', 'feel', 'airy, washed, floating rap'], ['dovetail', 'Dovetail', 'arrangement', 'transition, pickup, overlap, handoff'], ['transition', 'Transition', 'arrangement', 'into the next section'], ['swing', 'Swing', 'rhythm', 'shuffle, groove, pocket, push and pull']];
const cat = rd(path.join(ROOT, 'site/data/catalog.json'));
for (const f of fams) for (const l of f.labels || []) NEWLABELS.push(l);
for (const [id, title, category, words] of NEWLABELS) if (!cat.labels.some((l) => l.id === id)) cat.labels.push({ id, title, category, words: words.split(', ') });
const labelIds = new Set(cat.labels.map((l) => l.id)); for (const r of catRecipes) for (const l of r.labels) if (!labelIds.has(l)) die(`recipe ${r.id}: unknown label ${l}`);
cat.recipes = [...cat.recipes.filter((r) => r.origin !== 'concepts'), ...catRecipes].map((r) => { const tx = TX.recipeTaxonomy(r); const { folder, tags, ...rest } = r; return { ...rest, folder: tx.folder, tags: tx.tags }; }); // folder and tags are derived (tools/concepts/taxonomy.mjs) { const ids = cat.recipes.map((r) => r.id); if (new Set(ids).size !== ids.length) die('duplicate catalog id'); }
put('site/data/catalog.json', JSON.stringify(cat, null, 1).replace(/"(peak|rms_dbfs|bpm_hint)": (-?\d+)(,?)\n/g, '"$1": $2.0$3\n')); // same text as engine/strudel/build_catalog.py (Python floats)
const synText = fs.readFileSync(path.join(ROOT, 'site/data/syntax.json'), 'utf8');
const oldEx = new Map(JSON.parse(synText).sections.flatMap((s) => s.examples).map((e) => [e.title, e]));
const sections = [{ id: 'feels', title: 'Feels: hip-hop, trap, hyphy; grooves; dovetails', needs: 'hooks', explain: 'Genre kits as data (docs/CONVENTIONS.md). Components are racks (band-scoped hook defs) and pattern atoms; forms are gate atoms (hh.intro, hh.verse, hh.hook, hh.dropBar, hh.lastBeat, hh.switch, hh.bounce, hh.stomp); dovetails are gate atoms with a point param (dt.pickup, dt.rise, dt.hit, dt.tail), mask and fade-table atoms and move racks (fadeOut, fadeIn, throw, tailHold, duckUnder). Groove is one method, .groove(swing, push, jitter, vel, drift, seed, grid): swing in MPC percent, push / jitter / drift in percent of a 16th, deterministic per seed; presets groove-straight, -pocket, -lazy, -bounce, -rolling, -cloud, -swing(pct), -push(pct), -human(jitter, vel, seed). A feel template (feel-boombap, feel-lazy, feel-trap, feel-hyphy, feel-cloud of pack glyphcore/phonk) fills the slots drums, top, bass, harmony, fx and groove; a track picks one with one atoms.import line and overrides a slot with one bind. Sub-bar gates on a slot need quant: 0 on the slot.', examples: syntax.filter((s) => !s.section).map((s) => ({ title: s.title, code: s.code })) },
  ...fams.filter((f) => f.section).filter((f, i, all) => all.findIndex((g) => g.section.id === f.section.id) === i).map((f) => ({ ...f.section, needs: f.section.needs || 'hooks', examples: fams.filter((g) => g.section && g.section.id === f.section.id).flatMap((g) => g.syntax || []).map((s) => ({ title: s.title, code: s.code })) }))]; // families sharing a section id are one section
// syntax.json is hand-formatted: splice this one section (one line per example) in front of the tracks section, the rest stays byte-identical
const q = JSON.stringify; const secTextOf = (sec) => `    {\n      "id": ${q(sec.id)}, "title": ${q(sec.title)}, "needs": ${q(sec.needs)},\n      "explain": ${q(sec.explain)},\n      "examples": [\n${sec.examples.map((e) => { const o = oldEx.get(e.title); const x = o && o.code === e.code ? o : {}; /* lowered / lowered_note / lowered_check belong to tools/lowering/build.mjs: kept while the code is unchanged */
        return `        { "title": ${q(e.title)}, "code": ${q(e.code)}${['lowered', 'lowered_note', 'lowered_check'].filter((k) => x[k] !== undefined).map((k) => `, ${q(k)}: ${q(x[k])}`).join('')} }`; }).join(',\n')}\n      ]\n    },\n`;
// every generated section is spliced in front of the tracks section in this order; a section from an earlier build is replaced in place
let synOut = synText; for (const sec of sections) { const fi = synOut.indexOf(`      "id": ${q(sec.id)},`), ti = synOut.indexOf('    {\n      "id": "tracks"'); if (ti < 0) die('syntax.json: tracks section not found');
  if (fi >= 0) { const st = synOut.lastIndexOf('    {\n', fi); const en = synOut.indexOf('\n    },\n', fi) + '\n    },\n'.length; synOut = synOut.slice(0, st) + secTextOf(sec) + synOut.slice(en); }
  else synOut = synOut.slice(0, ti) + secTextOf(sec) + synOut.slice(ti); }
JSON.parse(synOut); put('site/data/syntax.json', synOut);
const tg = rd(path.join(ROOT, 'tools/racks/targets.json')); for (const k of ['racks', 'catalog', 'syntax']) Object.assign(tg[k], targets[k]);
put('tools/racks/targets.json', J(tg));
// manifest: our ingredients after the existing ones; hashes and bytes are written by packs.py hash --write
for (const pk of new Set(ingredients.map((g) => g.pack))) { const PH = path.join(ROOT, 'site/data', dirOf(pk)); if (!fs.existsSync(path.join(PH, 'craftpack.json'))) die(`${pk}: site/data/${dirOf(pk)}/craftpack.json missing (write the manifest head first)`);
const ings = ingredients.filter((g) => g.pack === pk);
const man = rd(path.join(PH, 'craftpack.json')); const keep = man.ingredients.filter((i) => !ings.some((g) => g.id === i.id));
man.ingredients = [...keep, ...ings.map((g) => { const old = man.ingredients.find((i) => i.id === g.id); return { id: g.id, kind: g.kind, format: g.kind === 'hooks' ? 'hooks@1' : 'atoms@1', version: '1.0.0', path: g.file, title: g.title, description: g.description, load: g.kind === 'hooks' ? 'manual' : 'eager', hash: old?.hash || 'sha256:0', bytes: old?.bytes || 0 }; })];
if (pk === PACK && !/hip-hop/.test(man.description)) { man.version = '1.3.0'; man.description += ' 1.3 adds hip-hop, trap and hyphy components and forms (atoms-hiphop, racks-hiphop), dovetail atoms (atoms-dovetail) and five feel templates (feel-*), generated by tools/concepts/build.mjs.'; }
put(`site/data/${dirOf(pk)}/craftpack.json`, JSON.stringify(man, null, 2) + '\n'); }
let stale = [];
for (const [rel, text] of outputs) { const f = path.join(ROOT, rel); const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  const same = rel.endsWith('craftpack.json') && cur ? JSON.stringify({ ...JSON.parse(cur), ingredients: JSON.parse(cur).ingredients.map((i) => ({ ...i, hash: 0, bytes: 0 })) }) === JSON.stringify({ ...JSON.parse(text), ingredients: JSON.parse(text).ingredients.map((i) => ({ ...i, hash: 0, bytes: 0 })) }) : cur === text;
  if (!same) { stale.push(rel); if (!CHECK) fs.writeFileSync(f, text); } }
const failed = catRecipes.filter((r) => !r.verified).map((r) => r.id);
console.log(JSON.stringify({ check: CHECK, stale, recipes: catRecipes.length, verified: catRecipes.length - failed.length, failed, syntax: syntax.length, ingredients: ingredients.map((i) => i.id) }));
process.exit(CHECK && stale.length ? 1 : 0);
