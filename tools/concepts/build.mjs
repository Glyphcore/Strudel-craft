#!/usr/bin/env node
// Concept builder (docs/CONVENTIONS.md): one data source per concept family, tools/concepts/families/<family>.json, becomes
//   - pack ingredients of glyphcore/phonk: racks-hiphop.json (hooks@1), atoms-<id>.json and feel-<id>.json (atoms@1)
//   - catalog recipes in site/data/catalog.json (origin "concepts"; plain Strudel lowered from the same racks, atoms and grooves)
//   - the Syntax view section "feels" in site/data/syntax.json (hooks / atoms / pack programs)
//   - classes for the rack audit in tools/racks/targets.json
// Usage (repo root): node tools/concepts/build.mjs [--render | --changed] [--check] [--only RECIPE_ID,...]
//   --render  renders every catalog recipe headless with the strudel CLI (STRUDEL_CLI) and stores verified / rms_dbfs / centroid_hz / peak;
//             without it, results of an unchanged recipe code are kept from the current catalog
//   --changed renders only the recipes whose code changed since the current catalog
//   --check   writes nothing; exit 1 when any output is stale
// After a change: node tools/concepts/build.mjs --render, python3 tools/packs/packs.py hash site/data/phonk --write, python3 tools/packs/shim.py,
// node tools/racks/audit.mjs (hygiene). Families are data only; adding a concept never needs code here (docs/CONVENTIONS.md section 7).
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const HERE = path.join(ROOT, 'tools/concepts');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const L = await imp('tools/lowering/lower.mjs'); const A = await imp('site/engine/atoms.js'); const AC = await imp('site/engine/atoms-consumers.js'); const { HYGIENE } = await imp('site/engine/hygiene.js'); const G = await imp('site/engine/groove.js');
A.loadTypes(fs.readFileSync(path.join(ROOT, 'site/data/atoms/types.json'), 'utf8'));
const argv = process.argv.slice(2); const flag = (n) => argv.includes(n); const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CHECK = flag('--check'), RENDER = flag('--render'), CHANGED = flag('--changed'), ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const CLI = process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli';
const PACK = 'glyphcore/phonk', PH = path.join(ROOT, 'site/data/phonk'); const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ORDER = ['hiphop', 'dovetail', 'groove', 'feels'];
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
const ownDefs = Object.fromEntries(Object.entries(own).map(([n, { fam, def }]) => [n, { ...(def.params ? { params: def.params } : {}), chain: resolveDef(fam, def) }]));
const LW = await L.createLowering({ defs: ownDefs, die }); // racks, hygiene and grooves -> plain steps (tools/lowering/lower.mjs, shared with the Syntax lowering)
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
  const imports = [...used].map((ns) => `atoms.import("pack:${PACK}:${NSID[ns]}")`).join('\n'); // default namespace = the ingredient's own (hh, dt)
  return { code: head + lines.map((l) => '$: ' + l).join('\n'), expr: lines.length === 1 && !r.cpm ? lines[0] : null, craft: head + (imports ? imports + '\n' : '') + craftLines.map((l) => '$: ' + l).join('\n') };
}
const T = rd(path.join(HERE, 'families', 'feels.json')).template; // the feel template is shared data
const feelVoices = (fe) => T.voices.map((v, i) => { const x = fe.voices[v] || { pat: '~' }; const gr = x.groove === false ? null : `${x.groove || fe.groove}(${i + 1})${x.push ? ` | groove-push(${x.push})` : ''}`; return { name: v, src: T.src[v], pat: x.pat, vel: x.vel, rack: x.rack, args: x.args, grooveExpr: gr }; });
const recipes = []; const syntax = []; const targets = { racks: {}, catalog: {}, syntax: {} };
for (const f of fams) {
  for (const r of f.recipes || []) recipes.push({ fam: f, r, ...recipeCode(r, f) });
  for (const s of f.syntax || []) syntax.push(s);
  for (const [id, fe] of Object.entries(f.feels || {})) {
    const vs = feelVoices(fe).filter((v) => v.pat !== '~' && v.rack); const r = { id: `feel-${id}`, title: `Feel: ${fe.title.toLowerCase()}`, intent: `${fe.doc} (${fe.tempo}).`, labels: fe.labels, class: 'demo', cpm: fe.cpm, bars: 2,
      notes: `Craft form of the feel template glyphcore/phonk:feel-${id} (atoms and rack | groove hooks); the Strudel tab has racks and grooves written out. To use the whole template: atoms.import("pack:glyphcore/phonk:feel-${id}", { as: "feel" }).`,
      voices: vs.map((v) => ({ src: v.src, pat: v.pat, vel: v.vel, rack: v.rack, args: v.args, groove: v.grooveExpr })) };
    recipes.push({ fam: f, r, ...recipeCode(r, f) });
  }
}
for (const [n, { def }] of Object.entries(own)) targets.racks[n] = { class: def.class, ...(def.target || {}) };
for (const { r } of recipes) targets.catalog[r.id] = { class: r.class || 'demo', ...(r.bars ? { bars: r.bars } : {}) };

// ---------- feel ingredients + their Syntax examples ----------
const feelsFam = fams.find((f) => f.feels); const feelDocs = {};
const atomsDoc = (fid, ns, doc, items, qualify) => { const taken = new Set(); const atoms = {};
  for (const [name, a] of Object.entries(items)) { const rec = { name, type: a.type, rev: 1, ...(a.params ? { params: a.params } : {}), body: a.body, ...(a.doc ? { doc: a.doc } : {}) };
    const id = A.idFor(a.type, qualify ? `${qualify}/${name}` : name, taken); taken.add(id); atoms[id] = { ...rec, hash: A.atomHash(rec) }; }
  const d = { format: 'atoms@1', name: ns, doc, atoms }; AC.verifyIngredient({ data: d }); return d; };
const nsItems = (ns, items) => Object.fromEntries(Object.entries(items).map(([n, a]) => [`${ns}.${n}`, a]));
const ingredients = [];
for (const f of fams) if (f.atomsIngredient) { const ai = f.atomsIngredient; ingredients.push({ id: ai.id, kind: 'atoms', file: `${ai.id}.json`, title: ai.title, description: ai.doc.split(' Import')[0], data: atomsDoc(ai.id, ai.ns, ai.doc, nsItems(ai.ns, f.atoms), null) }); }
if (feelsFam) for (const [id, fe] of Object.entries(feelsFam.feels)) {
  const items = {}; for (const v of feelVoices(fe)) {
    items[v.name] = { type: 'mini', body: pat(v.pat, feelsFam, `feel ${id}`), doc: `${v.name} pattern` };
    items[`${v.name}Vel`] = { type: 'mini', body: v.vel ? pat(v.vel, feelsFam, `feel ${id}`) : '1', doc: `${v.name} accents (velocity)` };
    items[`${v.name}Rack`] = { type: 'hook', body: v.rack ? `${v.rack}${v.args || ''}${v.grooveExpr ? ' | ' + v.grooveExpr : ''}` : `${fe.groove}(${T.voices.indexOf(v.name) + 1})`, doc: `${v.name} rack and groove` };
  }
  items.groove = { type: 'hook', body: `${fe.groove}(0)`, doc: 'the feel groove for any extra voice: .hook(atoms.feel.groove)' };
  const doc = `Feel template "${fe.title}" (${fe.tempo}): ${fe.doc}. Slots drums (kick, snare, perc), top (hats, top), bass, harmony, fx, groove; per voice <v> (pattern), <v>Vel (accents), <v>Rack (rack | groove). Import with atoms.import("pack:${PACK}:feel-${id}", { as: "feel" }).`;
  ingredients.push({ id: `feel-${id}`, kind: 'atoms', file: `feel-${id}.json`, title: `Feel: ${fe.title}`, description: doc.split(' Import')[0], data: atomsDoc(`feel-${id}`, 'feel', doc, items, `feel-${id}`) });
}
const ownRackNames = Object.keys(ownDefs);
const racksIng = { id: 'racks-hiphop', kind: 'hooks', file: 'racks-hiphop.json', title: 'Hip-hop and dovetail racks', description: `Chain-only hook defs: ${ownRackNames.join(', ')}`, data: { model: 1, meta: { id: `${PACK}:racks-hiphop`, doc: 'Hip-hop, trap and hyphy instrument racks (band-scoped, docs/RACK_STANDARD.md) and dovetail moves (fadeOut, fadeIn, throw, tailHold, duckUnder). Bind into a slot: hooks.bind("kick", "bbKick | groove-pocket(1)").' }, defs: ownDefs } };
ingredients.unshift(racksIng);
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
for (const s of syntax) targets.syntax[`feels/${s.title}`] = { class: 'demo', ...(s.bars ? { bars: s.bars } : {}) };

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
function render(r, code) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'concepts-')); const f = path.join(d, 'in.strudel.js'); fs.writeFileSync(f, code);
  const p = spawnSync(path.join(CLI, 'strudel'), ['render', f, d, '--bars', String(r.bars || 2)], { encoding: 'utf8', env: { ...process.env, STRUDEL_CRAFT: ROOT }, maxBuffer: 1 << 26 });
  const wav = path.join(d, 'mix.wav'); let out;
  if (p.status !== 0 || !fs.existsSync(wav)) out = { verified: false, rms_dbfs: null, centroid_hz: null, peak: 0, error: ((p.stderr || '') + (p.stdout || '')).trim().split('\n').filter((l) => /rror/.test(l)).pop() || `exit ${p.status}` };
  else { const s = wavStats(wav); const err = (p.stderr || '').split('\n').find((l) => /\berror\b/i.test(l) && !/stop time|time value \(-?[\d.]+\) cannot be negative/i.test(l)); out = { verified: s.peak > 1e-4 && !err, ...s, error: err || (s.peak > 1e-4 ? null : 'silent') }; }
  fs.rmSync(d, { recursive: true, force: true }); return out;
}
const catRecipes = recipes.map(({ fam, r, code, expr, craft }) => {
  const old = prev.get(r.id); let res;
  if ((RENDER && (!ONLY || ONLY.has(r.id))) || (CHANGED && !CHECK && !(old && (old.lowered || old.code) === code && old.origin === 'concepts'))) { res = render(r, code); process.stderr.write(`${res.verified ? 'OK  ' : 'FAIL'} ${r.id} rms=${res.rms_dbfs} cen=${res.centroid_hz} ${res.error || ''}\n`); }
  else if (old && (old.lowered || old.code) === code && old.origin === 'concepts') res = { verified: old.verified, rms_dbfs: old.rms_dbfs, centroid_hz: old.centroid_hz, peak: old.peak, error: old.error };
  else res = { verified: false, rms_dbfs: null, centroid_hz: null, peak: 0, error: 'not rendered' };
  const lowered = craft !== code ? code : null; const keep = old && old.origin === 'concepts' && old.code === craft && old.lowered === lowered && old.lowered_check ? { lowered_check: old.lowered_check } : {}; // lowered_check is (re)written by tools/lowering/build.mjs after the packs are hashed
  return { id: r.id, title: r.title, intent: r.intent, code: craft, ...(lowered ? { lowered } : {}), ...keep, notes: r.notes || '', labels: r.labels, source: 'docs/CONVENTIONS.md', unverified: [], origin: 'concepts', family: fam.family, needs_samples: false, expr, bpm_hint: r.cpm || null, verified: res.verified, rms_dbfs: res.rms_dbfs, centroid_hz: res.centroid_hz, peak: res.peak, error: res.error };
});

// ---------- write / check ----------
const outputs = new Map(); const put = (rel, text) => outputs.set(rel, text);
const J = (x) => JSON.stringify(x, null, 1) + '\n';
for (const ing of ingredients) put(`site/data/phonk/${ing.file}`, J(ing.data));
const NEWLABELS = [['hip-hop', 'Hip-hop', 'feel', 'boom bap, rap beat, backdrop'], ['boom-bap', 'Boom-bap', 'feel', 'dusty, knock, pocket'], ['trap', 'Trap', 'feel', '808, rolling hats, half-time'], ['hyphy', 'Hyphy', 'feel', 'bay area, bounce, stomp'], ['cloud', 'Cloud / wave', 'feel', 'airy, washed, floating rap'], ['dovetail', 'Dovetail', 'arrangement', 'transition, pickup, overlap, handoff'], ['transition', 'Transition', 'arrangement', 'into the next section'], ['swing', 'Swing', 'rhythm', 'shuffle, groove, pocket, push and pull']];
const cat = rd(path.join(ROOT, 'site/data/catalog.json'));
for (const [id, title, category, words] of NEWLABELS) if (!cat.labels.some((l) => l.id === id)) cat.labels.push({ id, title, category, words: words.split(', ') });
const labelIds = new Set(cat.labels.map((l) => l.id)); for (const r of catRecipes) for (const l of r.labels) if (!labelIds.has(l)) die(`recipe ${r.id}: unknown label ${l}`);
cat.recipes = [...cat.recipes.filter((r) => r.origin !== 'concepts'), ...catRecipes]; { const ids = cat.recipes.map((r) => r.id); if (new Set(ids).size !== ids.length) die('duplicate catalog id'); }
put('site/data/catalog.json', JSON.stringify(cat, null, 1).replace(/"(peak|rms_dbfs|bpm_hint)": (-?\d+)(,?)\n/g, '"$1": $2.0$3\n')); // same text as engine/strudel/build_catalog.py (Python floats)
const synText = fs.readFileSync(path.join(ROOT, 'site/data/syntax.json'), 'utf8');
const oldEx = new Map(JSON.parse(synText).sections.flatMap((s) => s.examples).map((e) => [e.title, e]));
const sec = { id: 'feels', title: 'Feels: hip-hop, trap, hyphy; grooves; dovetails', needs: 'hooks', explain: 'Genre kits as data (docs/CONVENTIONS.md). Components are racks (band-scoped hook defs) and pattern atoms; forms are gate atoms (hh.intro, hh.verse, hh.hook, hh.dropBar, hh.lastBeat, hh.switch, hh.bounce, hh.stomp); dovetails are gate atoms with a point param (dt.pickup, dt.rise, dt.hit, dt.tail), mask and fade-table atoms and move racks (fadeOut, fadeIn, throw, tailHold, duckUnder). Groove is one method, .groove(swing, push, jitter, vel, drift, seed, grid): swing in MPC percent, push / jitter / drift in percent of a 16th, deterministic per seed; presets groove-straight, -pocket, -lazy, -bounce, -rolling, -cloud, -swing(pct), -push(pct), -human(jitter, vel, seed). A feel template (feel-boombap, feel-lazy, feel-trap, feel-hyphy, feel-cloud of pack glyphcore/phonk) fills the slots drums, top, bass, harmony, fx and groove; a track picks one with one atoms.import line and overrides a slot with one bind. Sub-bar gates on a slot need quant: 0 on the slot.', examples: syntax.map((s) => ({ title: s.title, code: s.code })) };
// syntax.json is hand-formatted: splice this one section (one line per example) in front of the tracks section, the rest stays byte-identical
const q = JSON.stringify; const secText = `    {\n      "id": ${q(sec.id)}, "title": ${q(sec.title)}, "needs": ${q(sec.needs)},\n      "explain": ${q(sec.explain)},\n      "examples": [\n${sec.examples.map((e) => { const o = oldEx.get(e.title); const x = o && o.code === e.code ? o : {}; /* lowered / lowered_note / lowered_check belong to tools/lowering/build.mjs: kept while the code is unchanged */
        return `        { "title": ${q(e.title)}, "code": ${q(e.code)}${['lowered', 'lowered_note', 'lowered_check'].filter((k) => x[k] !== undefined).map((k) => `, ${q(k)}: ${q(x[k])}`).join('')} }`; }).join(',\n')}\n      ]\n    },\n`;
const fi = synText.indexOf('      "id": "feels"'), ti = synText.indexOf('    {\n      "id": "tracks"'); if (ti < 0) die('syntax.json: tracks section not found');
const synOut = fi >= 0 ? synText.slice(0, synText.lastIndexOf('    {\n', fi)) + secText + synText.slice(ti) : synText.slice(0, ti) + secText + synText.slice(ti);
JSON.parse(synOut); put('site/data/syntax.json', synOut);
const tg = rd(path.join(ROOT, 'tools/racks/targets.json')); for (const k of ['racks', 'catalog', 'syntax']) Object.assign(tg[k], targets[k]);
put('tools/racks/targets.json', J(tg));
// manifest: our ingredients after the existing ones; hashes and bytes are written by packs.py hash --write
const man = rd(path.join(PH, 'craftpack.json')); const keep = man.ingredients.filter((i) => !ingredients.some((g) => g.id === i.id));
man.ingredients = [...keep, ...ingredients.map((g) => { const old = man.ingredients.find((i) => i.id === g.id); return { id: g.id, kind: g.kind, format: g.kind === 'hooks' ? 'hooks@1' : 'atoms@1', version: '1.0.0', path: g.file, title: g.title, description: g.description, load: g.kind === 'hooks' ? 'manual' : 'eager', hash: old?.hash || 'sha256:0', bytes: old?.bytes || 0 }; })];
if (!/hip-hop/.test(man.description)) { man.version = '1.3.0'; man.description += ' 1.3 adds hip-hop, trap and hyphy components and forms (atoms-hiphop, racks-hiphop), dovetail atoms (atoms-dovetail) and five feel templates (feel-*), generated by tools/concepts/build.mjs.'; }
put('site/data/phonk/craftpack.json', JSON.stringify(man, null, 2) + '\n');
let stale = [];
for (const [rel, text] of outputs) { const f = path.join(ROOT, rel); const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  const same = rel.endsWith('craftpack.json') && cur ? JSON.stringify({ ...JSON.parse(cur), ingredients: JSON.parse(cur).ingredients.map((i) => ({ ...i, hash: 0, bytes: 0 })) }) === JSON.stringify({ ...JSON.parse(text), ingredients: JSON.parse(text).ingredients.map((i) => ({ ...i, hash: 0, bytes: 0 })) }) : cur === text;
  if (!same) { stale.push(rel); if (!CHECK) fs.writeFileSync(f, text); } }
const failed = catRecipes.filter((r) => !r.verified).map((r) => r.id);
console.log(JSON.stringify({ check: CHECK, stale, recipes: catRecipes.length, verified: catRecipes.length - failed.length, failed, syntax: syntax.length, ingredients: ingredients.map((i) => i.id) }));
process.exit(CHECK && stale.length ? 1 : 0);
