// Resources model (docs/RESOURCES.md; issue Resources pane): every reference a program uses, resolved against the registries, and everything available.
// One pure ES module (imports only ./lanes.js for calls / scan and ./comments.js), no DOM, no Node API: the site pane (site/resources-ui.js) and the CLI
// twin (`strudel refs IN [--json]`, engine/strudel-cli/lib/refs-cmd.mjs) both call buildModel(), so they print the same list.
// Comment-safe: the program text goes through blankComments() first (offsets and lines do not move); a reference inside a comment is not a reference.
//
// host (all parts optional, every missing part degrades to "unknown", never to an error):
//   atoms:  { env, refs: [{ atom, line, col }], error }           A.buildEnv(code, extra) + A.compile(code, env).refs (what `strudel atoms refs` prints)
//   hooks:  { json, plan, diagnostics, stdlib: [names] }           parsed hooks.toJSON() after the program was evaluated, hooks.plan(), diagnostics
//   packs:  { list: [pack], items(kind) -> [item], resolution }    sc.packs.list() / items(kind) / report().resolution, or the CLI facade (lib/refs-cmd.mjs)
//   vox:    [{ name, pack?, kind? }]                               voxBank() names that exist
//   library: { has(name) } | null, controls: [...] | null
import { calls, scan as laneScan } from './lanes.js';
import { blankComments } from './comments.js';
import { itemIds, itemAliases } from './packs-core.js';

export const VERSION = 1;
export const KIND_LABEL = { import: 'Imports', atom: 'Atoms', hook: 'Hooks and racks', slot: 'Slots', tap: 'Taps', bus: 'Buses', lane: 'Lanes', control: 'Controls', vox: 'Vox', pack: 'Packs', lib: 'Library', groove: 'Grooves and feels' };
export const KIND_ORDER = Object.keys(KIND_LABEL);
// status chips: resolved | shadowed | alias | unresolved | unused | unread | code | info
const strLit = (t) => { t = String(t || '').trim(); const m = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/s.exec(t); return m ? m[2].replace(/\\(.)/g, '$1') : null; };
const num = (x) => (x !== '' && x != null && Number.isFinite(+x) ? +x : undefined);
const str = (v) => (v == null ? '' : String(v));

function lineIndex(src) { const starts = [0]; for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1); return (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return { line: lo + 1, col: off - starts[lo] + 1, from: off }; }; }

export function paramsOf(v) { // atom / hook def params -> [{ name, type, min, max, default, unit }]
  const p = v && v.params; if (!p) return [];
  const rows = Array.isArray(p) ? p.map((x) => (typeof x === 'string' ? [x, {}] : [x.name, x])) : Object.entries(p);
  return rows.filter(([n]) => n).map(([name, s]) => { s = s && typeof s === 'object' ? s : { default: s }; return { name, ...(s.type ? { type: s.type } : {}), ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), ...(s.default !== undefined ? { default: s.default } : {}), ...(s.unit ? { unit: s.unit } : {}) }; });
}
const descOf = (v) => str(v && (v.doc || v.description || v.intent || v.title)).replace(/\s+/g, ' ').trim().slice(0, 200);
const chainDesc = (v) => (v && Array.isArray(v.chain) ? `rack: ${v.chain.length} steps` + (v.chain[0] && v.chain[0][0] === 'hook' ? ` on ${v.chain[0][1]}` : '') : '');

// ---------------------------------------------------------------- source scan: what the text says (no registry)
export function scanSource(code) {
  const src = blankComments(String(code ?? '')); const at = lineIndex(src); const cs = calls(src);
  const recv = (c) => { const m = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(src.slice(Math.max(0, c.at - 40), c.at)); return m ? m[1] : null; };
  const out = { imports: [], atomUses: [], defs: [], binds: [], hookUses: [], slotUses: [], taps: [], reads: [], sends: [], rets: [], controls: [], maps: [], voxBanks: [], words: [], libs: [], grooves: [], lanes: [], buses: [] };
  for (const m of src.matchAll(/\batoms\s*\.\s*import\s*\(\s*(["'`])([^"'`]+)\1\s*(?:,\s*\{([^}]*)\})?/g)) { const as = /\bas\s*:\s*(["'`])([\w.]+)\1/.exec(m[3] || ''); out.imports.push({ id: m[2], as: as ? as[2] : null, ...at(m.index) }); }
  for (const m of src.matchAll(/\batoms\s*\.\s*(?!import\b)([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)/g)) out.atomUses.push({ path: m[1].replace(/\s+/g, ''), ...at(m.index) });
  for (const c of cs) {
    const r = recv(c); const a0 = strLit(c.args[0]); const pos = at(c.at);
    if (c.bare === false && r === 'hooks' && c.name === 'def' && a0) out.defs.push({ name: a0, ...pos });
    else if (c.bare === false && r === 'hooks' && c.name === 'bind') out.binds.push({ slot: a0, hook: c.args[1], gate: c.args[2], ...pos });
    else if (c.bare === false && r === 'hooks' && c.name === 'map') out.maps.push({ control: a0, param: strLit(c.args[1]), opts: c.args[2], ...pos });
    else if (!c.bare && c.name === 'hook' && a0) out.hookUses.push({ spec: a0, ...pos });
    else if (!c.bare && c.name === 'use' && a0) out.slotUses.push({ slot: a0, ...pos });
    else if (!c.bare && c.name === 'tap' && a0) out.taps.push({ name: a0, exported: /\bexport\s*:\s*true/.test(c.args[1] || ''), ...pos });
    else if (c.bare && c.name === 'tap' && a0) out.reads.push({ ref: a0, ...pos });
    else if (!c.bare && c.name === 'wire' && strLit(c.args[1])) out.reads.push({ ref: strLit(c.args[1]), wire: a0, ...pos });
    else if (!c.bare && c.name === 'send' && a0) out.sends.push({ bus: a0, ...pos });
    else if (c.bare && c.name === 'ret' && a0) out.rets.push({ bus: a0, ...pos });
    else if (c.bare && (c.name === 'ctl' || c.name === 'slider') && a0) out.controls.push({ name: a0, fn: c.name, spec: c.args[1] || '', ...pos });
    else if (c.bare && c.name === 'voxBank' && a0) out.voxBanks.push({ name: a0, ...pos });
    else if (c.bare && c.name === 'word' && a0 != null) out.words.push({ text: a0, ...pos });
    else if (!c.bare && c.name === 'groove' && a0) out.grooves.push({ name: a0, ...pos });
  }
  for (const m of src.matchAll(/(["'`])(lib:[\w./@:-]+)\1/g)) out.libs.push({ name: m[2], ...at(m.index) });
  let lanes = []; try { const s = laneScan(src); lanes = s.lanes; } catch { /* a half-typed program has no lane graph */ }
  out.lanes = lanes.map((l) => ({ id: l.id, label: l.label, line: l.line, tags: l.tags.slice(), taps: l.taps.map((t) => t.name), reads: l.reads.slice() }));
  return out;
}

const hookNames = (spec) => { const s = strLit(spec); if (s == null) return []; return s.split('|').map((x) => (/^\s*([A-Za-z][\w-]*)/.exec(x) || [])[1]).filter(Boolean); };
const wordsOf = (t) => [...new Set(String(t).split(/\s+/).map((w) => w.replace(/[[\]<>(){}~*!@?:,|^_.]|\d+$|^\d+/g, '')).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '')).filter((w) => w.length > 1))];
const ctlSpec = (spec) => { const o = {}; for (const m of String(spec).matchAll(/\b(min|max|default|value|step|type|unit)\s*:\s*(-?[\d.]+|(["'`])[^"'`]*\3)/g)) { const v = m[2]; o[m[1] === 'value' ? 'default' : m[1]] = /^["'`]/.test(v) ? v.slice(1, -1) : +v; } return o; };

// ---------------------------------------------------------------- the model
export function buildModel(code, host = {}) {
  const src = String(code ?? ''); const S = scanSource(src);
  const packs = host.packs || { list: [], items: () => [], resolution: {} };
  const packList = packs.list || []; const packById = new Map(packList.map((p) => [p.id, p]));
  const resolution = packs.resolution || {};
  const itemsOf = (kind) => { try { return packs.items ? packs.items(kind) || [] : []; } catch { return []; } };
  const refs = []; const byKey = new Map();
  const ref = (kind, name, init = {}) => { const k = kind + '\0' + name; let r = byKey.get(k); if (!r) { r = { id: `${kind}:${name}`, kind, name, status: [], source: null, desc: '', params: [], uses: [], fix: null, notes: [], ...init }; byKey.set(k, r); refs.push(r); } return r; };
  const use = (r, p, extra) => { if (p) r.uses.push({ line: p.line, col: p.col, ...(extra ? { what: extra } : {}) }); };
  const chip = (r, s) => { if (!r.status.includes(s)) r.status.push(s); };
  const sourceOf = (pid, ingredient, qualified) => { const p = packById.get(pid); return pid ? { pack: pid, version: p ? p.version || null : null, license: p ? p.license || null : null, ingredient: ingredient || null, qualified: qualified || pid, state: p ? p.state || 'ready' : 'missing' } : null; };
  const shadowOf = (kind, name, r) => { const e = (resolution[kind] || {})[name]; if (!e) return; if (e.alias) { chip(r, 'alias'); r.aliasTo = e.winner; r.notes.push(`${name} is an older id of ${e.winner}`); } if (e.shadowed && e.shadowed.length) { chip(r, 'shadowed'); r.shadowed = e.shadowed.slice(); r.notes.push(`shadowed: ${e.winner} wins over ${e.shadowed.join(', ')}`); } };
  const codeChip = (r, pid, ing) => { const p = packById.get(pid); const i = p && (p.ingredients || []).find((x) => x.id === ing); if (i && i.code) { chip(r, 'code'); r.code = { granted: !!i.granted, trusted: !!i.trusted }; r.notes.push(i.granted ? 'code-bearing, grant given' : 'code-bearing: needs allow (Packs sheet)'); } };
  // an item that a pack provides for a bare name: the first item by the host's own precedence
  const findItem = (kind, name) => itemsOf(kind).find((i) => i.name === name) || null;
  const anywhere = (kind, name) => { for (const p of packList) for (const ing of p.ingredients || []) if (ing.kind === kind) { const hit = (ing.names || []).includes(name); if (hit) return { pack: p.id, ingredient: ing.id }; } return null; };

  // ---- atoms: imports, then uses (resolved by the atoms engine: `strudel atoms refs`)
  const A = host.atoms || {}; const env = A.env || null; const has = (n) => !!(env && ((env.byName && env.byName.has(n)) || (env.get && env.get(n))));
  const nsOf = new Map(); // atom name -> import ref (so a used atom shows its pack)
  for (const im of S.imports) {
    const m = /^pack:([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*):([\w-]+)$/.exec(im.id); const r = ref('import', im.id, { desc: 'atoms.import' + (im.as ? ` as ${im.as}` : '') }); use(r, im);
    if (!m) { chip(r, 'unresolved'); r.fix = 'use the form atoms.import("pack:author/pack:ingredient")'; continue; }
    const p = packById.get(m[1]); const ing = p && (p.ingredients || []).find((x) => x.id === m[2]);
    r.source = sourceOf(m[1], m[2], im.id); r.ns = im.as || ''; r.atomNames = ing && ing.names ? ing.names.slice() : [];
    if (!p || (p.state && p.state !== 'ready')) { chip(r, 'unresolved'); r.fix = `add pack ${m[1]} to the lock (Packs sheet, or: strudel packs install)`; r.source.state = p ? p.state : 'missing'; }
    else if (!ing) { chip(r, 'unresolved'); r.fix = `pack ${m[1]} has no ingredient "${m[2]}"` + ((p.ingredients || []).filter((x) => x.kind === 'atoms').length ? `; atoms ingredients there: ${p.ingredients.filter((x) => x.kind === 'atoms').map((x) => x.id).join(', ')}` : ''); }
    else { chip(r, 'resolved'); r.desc = ing.description || ing.title || r.desc; codeChip(r, m[1], m[2]); }
    for (const n of r.atomNames || []) nsOf.set(im.as ? `${im.as}.${n}` : n, r);
  }
  const used = new Map(); // atom name -> [pos]
  for (const x of A.refs || []) { if (!used.has(x.atom)) used.set(x.atom, []); if (x.line) used.get(x.atom).push({ line: x.line, col: x.col }); }
  const unresolvedAtoms = new Map();
  for (const u of S.atomUses) { // text uses the engine did not resolve (or the engine is missing): longest dotted prefix known, else unresolved
    const parts = u.path.split('.'); let hit = null; for (let n = parts.length; n >= 1 && !hit; n--) { const cand = parts.slice(0, n).join('.'); if (has(cand) || used.has(cand)) hit = cand; }
    if (hit) { if (!used.has(hit)) used.set(hit, []); if (!(used.get(hit) || []).some((p) => p.line === u.line && p.col === u.col)) used.get(hit).push({ line: u.line, col: u.col }); }
    else { const k = parts.length > 1 && /^[a-z][a-z0-9]{0,6}$/.test(parts[0]) ? parts.slice(0, 2).join('.') : parts[0]; if (!unresolvedAtoms.has(k)) unresolvedAtoms.set(k, []); unresolvedAtoms.get(k).push(u); }
  }
  for (const [name, ps] of used) {
    const rec = env && env.get ? env.get(name) : null; const r = ref('atom', name, { desc: descOf(rec) || (rec && rec.type ? `${rec.type} atom` : ''), params: paramsOf(rec) }); for (const p of ps) use(r, p);
    if (rec && rec.type) r.type = rec.type; const im = nsOf.get(name);
    if (im) { r.source = im.source; chip(r, 'resolved'); shadowOf('atoms', name.replace(/^[\w]+\./, (s) => (im.ns && s === im.ns + '.' ? '' : s)), r); }
    else if (rec && rec.origin === 'code') { r.source = { pack: null, version: null, license: null, ingredient: null, qualified: 'this program', state: 'program' }; chip(r, 'resolved'); }
    else if (rec) { r.source = (rec.origin === 'catalog') ? { pack: null, qualified: 'built-in catalog', state: 'builtin' } : null; chip(r, 'resolved'); }
    else chip(r, 'unresolved');
    if (rec && env && env.aliasOf && env.aliasOf.has && env.aliasOf.has(name)) { chip(r, 'alias'); const to = env.aliasOf.get(name); r.aliasTo = to && to.name; r.notes.push(`${name} is an older id${to && to.name ? ' of ' + to.name : ''}`); }
  }
  for (const [name, ps] of unresolvedAtoms) {
    const r = ref('atom', name, { desc: env ? 'not found' : 'atoms engine not ready' }); for (const p of ps) use(r, p); if (!env) { chip(r, 'info'); r.notes.push('the atoms engine could not read this program (not loaded yet, or the text does not parse)'); continue; } chip(r, 'unresolved');
    const w = findItem('atoms', name) || findItem('atoms', name.replace(/^[^.]+\./, '')); const hit = w ? { pack: w.pack, ingredient: w.ingredient } : (anywhere('atoms', name) || null);
    r.fix = hit ? `import pack:${hit.pack}:${hit.ingredient}` : 'declare it with atom("name", { ... }) or import the pack that holds it';
    if (hit) r.fixLine = `atoms.import("pack:${hit.pack}:${hit.ingredient}")`;
  }
  for (const r of refs) if (r.kind === 'import' && r.status.includes('resolved') && r.atomNames && r.atomNames.length) { const n = r.atomNames.filter((a) => used.has(r.ns ? `${r.ns}.${a}` : a)).length; r.usedAtoms = n; if (!n) { chip(r, 'unused'); r.notes.push('none of its atoms is used'); } }

  // ---- hooks: defs, binds, .hook(), slots
  const H = host.hooks || {}; const regDefs = (H.json && H.json.defs) || {}; const std = new Set(H.stdlib || []);
  const progDefs = new Set(S.defs.map((d) => d.name));
  const slotBinds = new Map(); const slotUsesM = new Map();
  const hookRef = (name, p, how, kind = 'hook') => {
    const r = ref(kind, name); use(r, p, how); if (r.status.length) return r;
    const def = regDefs[name]; const item = findItem('hooks', name);
    if (progDefs.has(name)) { r.source = { pack: null, qualified: 'this program', state: 'program' }; chip(r, 'resolved'); r.desc = 'defined in this program'; }
    else if (item) { r.source = sourceOf(item.pack, item.ingredient, item.id || `${item.pack}:${name}`); r.desc = descOf(item.value) || chainDesc(item.value); r.params = paramsOf(item.value); chip(r, 'resolved'); shadowOf('hooks', name, r); codeChip(r, item.pack, item.ingredient); if (item.value && (item.value.opaque || item.value.apply)) chip(r, 'code'); }
    else if (def) { r.source = { pack: null, qualified: 'registry', state: 'loaded' }; r.desc = descOf(def) || chainDesc(def); r.params = paramsOf(def); chip(r, 'resolved'); }
    else if (std.has(name)) { r.source = { pack: null, qualified: 'built-in', state: 'builtin' }; chip(r, 'resolved'); r.desc = 'standard library def'; }
    else {
      const e = (resolution.hooks || {})[name]; if (e && e.alias) { chip(r, 'alias'); r.aliasTo = e.winner; chip(r, 'resolved'); }
      else { chip(r, 'unresolved'); const w = anywhere('hooks', name); r.fix = w ? `add pack ${w.pack} to the lock (it holds "${name}")` : `define it with hooks.def("${name}", ...) or load the pack that holds it`; }
    }
    return r;
  };
  for (const d of S.defs) { const r = hookRef(d.name, d, 'hooks.def'); }
  for (const b of S.binds) {
    const slot = b.slot; if (slot) { if (!slotBinds.has(slot)) slotBinds.set(slot, []); slotBinds.get(slot).push(b); }
    const isGroove = /groove|feel/i.test(slot || '');
    for (const n of hookNames(b.hook)) hookRef(n, b, `hooks.bind("${slot}")`, isGroove ? 'groove' : 'hook');
    const ga = String(b.hook || '').trim(); if (/^\[/.test(ga) && isGroove) { const r = ref('groove', `${slot}: inline`, { desc: 'inline groove / feel steps' }); use(r, b); chip(r, 'resolved'); r.source = { pack: null, qualified: 'this program', state: 'program' }; }
  }
  for (const u of S.hookUses) for (const n of hookNames(`"${u.spec}"`)) hookRef(n, u, '.hook()');
  for (const g of S.grooves) { const r = ref('groove', g.name); use(r, g, '.groove()'); if (!r.status.length) { if (std.has(g.name) || regDefs[g.name]) { chip(r, 'resolved'); r.source = { pack: null, qualified: std.has(g.name) ? 'built-in' : 'registry', state: 'loaded' }; } else { const w = findItem('hooks', g.name); if (w) { chip(r, 'resolved'); r.source = sourceOf(w.pack, w.ingredient); r.desc = descOf(w.value); } else { chip(r, 'unresolved'); r.fix = 'no groove or feel of that name is loaded'; } } } }
  for (const u of S.slotUses) { const m = /^[A-Za-z][\w-]*/.exec(u.slot); const n = m ? m[0] : u.slot; if (!slotUsesM.has(n)) slotUsesM.set(n, []); slotUsesM.get(n).push(u); }
  for (const n of new Set([...slotBinds.keys(), ...slotUsesM.keys()])) {
    const bs = slotBinds.get(n) || []; const us = slotUsesM.get(n) || []; const r = ref('slot', n); for (const p of us) use(r, p, '.use()'); for (const p of bs) use(r, p, 'hooks.bind');
    const hn = [...new Set(bs.flatMap((b) => hookNames(b.hook)))]; r.binds = bs.length; r.hooks = hn; r.desc = `${us.length} use${us.length === 1 ? '' : 's'}, ${bs.length} bind${bs.length === 1 ? '' : 's'}` + (hn.length ? ': ' + hn.join(', ') : '');
    if (bs.length && !us.length) { chip(r, 'unresolved'); r.fix = `no pattern calls .use("${n}"); add it to a lane, or remove the bind`; } else if (us.length && !bs.length) { chip(r, 'info'); r.notes.push('no hooks.bind for this slot yet (plain pass-through)'); } else chip(r, 'resolved');
  }

  // ---- taps
  const plan = H.plan || {}; const published = new Set(plan.taps || []);
  const tapName = (x) => String(x).replace(/^[^/]*\//, '').replace(/:.*$/, '');
  const writers = new Map(); for (const t of S.taps) { if (!writers.has(t.name)) writers.set(t.name, []); writers.get(t.name).push(t); }
  const readers = new Map(); for (const t of S.reads) { const n = tapName(t.ref); if (!readers.has(n)) readers.set(n, []); readers.get(n).push(t); }
  for (const n of new Set([...writers.keys(), ...readers.keys()])) {
    const w = writers.get(n) || [], rd = readers.get(n) || []; const r = ref('tap', n); for (const p of w) use(r, p, 'writes .tap()'); for (const p of rd) use(r, p, p.wire ? `wire("${p.wire}")` : 'reads tap()');
    r.writers = w.length; r.readers = rd.length; r.desc = `${w.length} writer${w.length === 1 ? '' : 's'}, ${rd.length} reader${rd.length === 1 ? '' : 's'}`;
    if (w.length && !rd.length && !w.some((x) => x.exported)) { chip(r, 'unread'); r.notes.push('published but nothing reads it (#114)'); }
    else if (!w.length && !published.has(n)) { chip(r, 'info'); r.notes.push('no publisher in this program: reads the Perform pad of that name, or a pack tap'); }
    else chip(r, 'resolved');
  }

  // ---- buses and lanes
  const sends = new Map(), rets = new Map();
  for (const s of S.sends) { if (!sends.has(s.bus)) sends.set(s.bus, []); sends.get(s.bus).push(s); } for (const s of S.rets) { if (!rets.has(s.bus)) rets.set(s.bus, []); rets.get(s.bus).push(s); }
  for (const n of new Set([...sends.keys(), ...rets.keys()])) {
    const r = ref('bus', n); for (const p of sends.get(n) || []) use(r, p, '.send()'); for (const p of rets.get(n) || []) use(r, p, 'ret()');
    r.desc = `${(sends.get(n) || []).length} send${(sends.get(n) || []).length === 1 ? '' : 's'}, ${(rets.get(n) || []).length} return${(rets.get(n) || []).length === 1 ? '' : 's'}`;
    if (!(rets.get(n) || []).length) { chip(r, 'unresolved'); r.fix = `add a lane with ret("${n}")`; } else if (!(sends.get(n) || []).length) { chip(r, 'unused'); r.notes.push('nothing sends to this bus'); } else chip(r, 'resolved');
  }
  for (const l of S.lanes) { const r = ref('lane', l.id, { desc: l.tags.length ? 'tags: ' + l.tags.join(', ') : 'lane', tags: l.tags }); use(r, { line: l.line, col: 1 }); chip(r, 'resolved'); r.source = { pack: null, qualified: 'this program', state: 'program' }; }

  // ---- controls
  const mapsBy = new Map(); for (const m of S.maps) { if (!mapsBy.has(m.control)) mapsBy.set(m.control, []); mapsBy.get(m.control).push(m); }
  const seenCtl = new Set();
  for (const c of S.controls) {
    const sp = ctlSpec(c.spec); const r = ref('control', c.name, { desc: c.fn === 'slider' ? 'slider' : sp.type || 'control' }); use(r, c, c.fn); seenCtl.add(c.name);
    r.params = ['min', 'max', 'default', 'step', 'unit'].filter((k) => sp[k] !== undefined).map((k) => ({ name: k, default: sp[k] }));
    r.range = { min: sp.min, max: sp.max, default: sp.default }; const ms = mapsBy.get(c.name) || []; for (const m of ms) use(r, m, `hooks.map -> ${m.param}`);
    r.maps = ms.map((m) => m.param); r.source = { pack: null, qualified: 'this program', state: 'program' }; chip(r, 'resolved'); if (ms.length) r.desc += ' -> ' + [...new Set(r.maps)].join(', ');
  }
  for (const [n, ms] of mapsBy) if (!seenCtl.has(n)) { const r = ref('control', n, { desc: 'mapped, but never declared' }); for (const m of ms) use(r, m, `hooks.map -> ${m.param}`); chip(r, 'unresolved'); r.fix = `declare it: ctl("${n}", { type: "knob", min: 0, max: 1, default: 0.5 })`; }

  // ---- vox
  const voxBanks = host.vox || []; const bankNames = new Map(voxBanks.map((b) => [b.name, b]));
  for (const v of S.voxBanks) {
    const r = ref('vox', v.name, { desc: 'voxBank()' }); use(r, v); const b = bankNames.get(v.name) || voxBanks.find((x) => x.short === v.name);
    if (b) { chip(r, 'resolved'); r.source = b.pack ? sourceOf(b.pack, null, b.pack) : { pack: null, qualified: 'your own bank', state: 'local' }; r.desc = b.kind ? `${b.kind} bank` : 'vox bank'; } else { chip(r, 'unresolved'); r.fix = `no vox bank "${v.name}" is installed: pick one of ${voxBanks.slice(0, 6).map((x) => x.name).join(', ') || 'the Banks browser'}`; }
  }
  const wordSet = new Map(); for (const w of S.words) for (const x of wordsOf(w.text)) { if (!wordSet.has(x)) wordSet.set(x, []); wordSet.get(x).push(w); }
  if (S.voxBanks.length || S.words.length) for (const [w, ps] of wordSet) { const r = ref('vox', `word:${w}`, { desc: 'word()' }); for (const p of ps) use(r, p, 'word()'); chip(r, 'info'); r.word = w; r.banks = S.voxBanks.map((b) => b.name); }

  // ---- library / recipe refs
  for (const l of S.libs) { const r = ref('lib', l.name, { desc: 'library component' }); use(r, l); const k = host.library; if (k && k.has) { if (k.has(l.name)) chip(r, 'resolved'); else { chip(r, 'unresolved'); r.fix = 'save it to your library or run: strudel library list'; } } else chip(r, 'info'); }

  // ---- packs: one row per pack the program touches + lock state
  const touched = new Map();
  for (const r of refs) if (r.source && r.source.pack) { const t = touched.get(r.source.pack) || { n: 0, kinds: new Set() }; t.n++; t.kinds.add(r.kind); touched.set(r.source.pack, t); }
  for (const [pid, t] of touched) {
    const p = packById.get(pid); const r = ref('pack', pid, { desc: (p && p.title) || pid }); r.source = sourceOf(pid, null, pid); r.version = p ? p.version : null; r.refCount = t.n; r.layer = p ? p.layer || null : null; r.allowCode = p ? p.allowCode || [] : [];
    r.notes.push(`${t.n} reference${t.n === 1 ? '' : 's'}: ${[...t.kinds].join(', ')}`);
    if (!p) { chip(r, 'unresolved'); r.fix = `add pack ${pid} to the lock`; } else if (p.state && p.state !== 'ready') { chip(r, 'unresolved'); r.fix = `pack ${pid} is ${p.state}`; } else chip(r, 'resolved');
    if (p && p.code) chip(r, 'code');
  }
  // refs cannot be duplicated across statuses: order is stable (source order within a kind)
  for (const r of refs) { r.uses.sort((a, b) => a.line - b.line || a.col - b.col); r.line = r.uses.length ? r.uses[0].line : null; r.primary = ['unresolved', 'unused', 'unread', 'code', 'shadowed', 'alias', 'resolved', 'info'].find((s) => r.status.includes(s)) || 'info'; }
  refs.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.line ?? 1e9) - (b.line ?? 1e9) || (a.name < b.name ? -1 : 1));
  const missing = refs.filter((r) => r.status.includes('unresolved')).map((r) => ({ id: r.id, kind: r.kind, name: r.name, fix: r.fix, fixLine: r.fixLine || null, line: r.line }));
  const counts = {}; for (const r of refs) counts[r.kind] = (counts[r.kind] || 0) + 1;
  const diagnostics = [...(host.diagnostics || []), ...(A.error ? [{ level: 'error', code: A.error.code || 'E_ATOM', msg: String(A.error.message || A.error) }] : [])];
  return { version: VERSION, lines: src ? src.split('\n').length : 0, refs, missing, counts, total: refs.length, diagnostics };
}

// ---------------------------------------------------------------- everything available (packs -> kinds -> items)
export const KIND_NOUN = { atoms: 'atom', hooks: 'hook / rack', 'vox-bank': 'vox bank', recipes: 'recipe', 'control-types': 'control type', sounds: 'sound map', 'param-shapes': 'param shapes', intellisense: 'completions' };
export function importLine(pack, ingredient) { return `atoms.import("pack:${pack}:${ingredient}")`; }
// snippet by atom type, so the example plays by itself (Craft form; the lowered tab is the site's own lowering)
export function atomSnippet(item) {
  const nm = item.name; const type = (item.value && item.value.type) || 'mini'; const R = `atoms.${nm}`;
  if (type === 'gate' || type === 'point') return `// ${type}: use as a gate/point, e.g. hooks.bind("slot", "hook", ${R})`;
  if (type === 'sound') return `s(${R})`; if (type === 'note' || type === 'chord' || type === 'progression') return `note(${R}).s("triangle")`;
  if (type === 'scale') return `n("0 2 4 6").scale(${R})`; if (type === 'text') return `// ${R} is plain text`;
  return /rhythm|drum|kick|snare|hat|rim|ghost|roll|stut|accent|struct/i.test(`${nm} ${(item.value && item.value.tags || []).join(' ')}`) ? `s("bd").struct(${R})` : `note(${R}).s("triangle")`;
}
// a recipe body ({ code, expr, lowered, lowered_note, lowered_check }) onto an Available entry: snippet, Play text, the block Insert reference puts in
// (recipe code is a whole program: `$:` / label lines or setcpm are kept as written, a bare expression gets `$: `)
export const blockText = (code) => { const c = str(code).replace(/\s+$/, ''); return !c ? '' : /^\s*(\$|[A-Za-z_]\w*)\s*:|\bsetcp?m\s*\(/m.test(c) ? c : '$: ' + c; };
export function applyBody(entry, b) {
  if (!b) return false; const code = str(b.code || b.expr || ''); entry.snippet = code; entry.insert = { type: 'block', text: blockText(code) }; entry.play = code || undefined; entry.lazy = false; entry.hydrated = true;
  for (const k of ['lowered', 'lowered_note', 'lowered_check']) if (b[k] !== undefined) entry[k] = b[k];
  entry.intent = descOf({ intent: b.intent || '' }); entry.notes = descOf({ intent: b.notes || '' }); /* body text: shown, and searched only with `deep` */
  return true;
}
// ONE search scope for the Available list, in the pane and in `strudel refs --available`:
//   default: index fields only (name, title, labels, family, folder, tags, pack; for atoms, racks and banks also their one-line description, which is part of the item data);
//   deep:    adds the body text of recipes (intent, notes). The pane loads the family files first (lazyFiles), the CLI loader has merged them already.
// `bodies`: Map "pack|body" -> { recipeId: body } the caller has fetched (shown with the entry; never used for matching unless deep).
export function lazyFiles(host = {}) { const seen = new Map(); try { for (const i of (host.packs && host.packs.items && host.packs.items('recipes')) || []) { const v = i.value || {}; if (v.body && !(v.code || v.expr)) seen.set(`${i.pack}|${v.body}`, { pack: i.pack, body: v.body }); } } catch { /* none */ } return [...seen.values()]; }
function voxItems(host, existing) { // the shipped / pack banks the site knows (banks.json): one item per bank under its pack, as the Banks browser lists them
  const have = new Set(existing.map((i) => i.name)); const out = [];
  for (const b of host.vox || []) { if (!b.pack || have.has(b.name)) continue; out.push({ name: b.name, id: `${b.pack}:${b.name}`, pack: b.pack, ingredient: 'banks', virtual: true, shadowed: [], value: { description: `${b.kind === 'sound' ? 'sound' : 'word'} bank, ${b.words ?? '?'} ${b.kind === 'sound' ? 'keys' : 'words'}, ${b.clips ?? '?'} clips`, tags: ['vox', b.kind === 'sound' ? 'sound-bank' : 'word-bank'], folder: 'vox/' + (b.kind === 'sound' ? 'sound' : 'word') } }); }
  return out;
}
export function available(host = {}, { q = '', deep = false, bodies = null } = {}) {
  const packs = (host.packs && host.packs.list) || []; const needle = q.trim().toLowerCase(); const items = new Map();
  for (const kind of ['atoms', 'hooks', 'vox-bank', 'recipes']) { try { items.set(kind, (host.packs.items && host.packs.items(kind)) || []); } catch { items.set(kind, []); } }
  items.set('vox-bank', [...items.get('vox-bank'), ...voxItems(host, items.get('vox-bank'))]);
  const hay = (e) => [e.name, e.kind === 'recipes' ? e.title : e.desc, (e.labels || []).join(' '), e.family, e.folder, (e.tags || []).join(' '), e.pack, ...(deep ? [e.intent, e.notes] : [])].join(' ').toLowerCase();
  const out = [];
  for (const p of packs) {
    const kinds = new Map(); const ings = [...(p.ingredients || [])];
    if ((items.get('vox-bank') || []).some((i) => i.virtual && i.pack === p.id) && !ings.some((i) => i.kind === 'vox-bank')) ings.push({ id: 'banks', kind: 'vox-bank', title: 'Vox banks', description: 'word and sound banks', state: 'ready' });
    for (const ing of ings) {
      const list = (items.get(ing.kind) || []).filter((i) => i.pack === p.id && (!i.ingredient || i.ingredient === ing.id)).map((i) => {
        const v = i.value || {}; const entry = { id: `${p.id}:${ing.id}:${i.name}`, name: i.name, kind: ing.kind, pack: p.id, ingredient: ing.id, version: p.version, license: p.license, desc: ing.kind === 'recipes' ? str(v.title) : descOf(v) || chainDesc(v) || (v.type ? `${v.type} atom` : ''), params: paramsOf(v), folder: v.folder || '', tags: (v.tags || []).slice(), shadowed: (i.shadowed || []).length > 0 };
        if (ing.kind === 'atoms') { entry.snippet = atomSnippet({ name: i.name, value: v }); entry.insert = { type: 'import', text: importLine(p.id, ing.id) }; entry.ref = `atoms.${i.name}`; entry.play = `${importLine(p.id, ing.id)}\n$: ${entry.snippet}`; entry.type = v.type; }
        else if (ing.kind === 'hooks') { entry.snippet = `hooks.bind("slot", "${i.name}")`; entry.insert = { type: 'bind', text: entry.snippet }; entry.ref = i.name; /* a bare bind is not a program: no Play (docs/RESOURCES.md) */ }
        else if (ing.kind === 'vox-bank') { entry.snippet = `await voxBank('${i.name}')`; entry.insert = { type: 'header', text: entry.snippet }; entry.ref = i.name; }
        else if (ing.kind === 'recipes') {
          entry.ref = i.name; entry.title = str(v.title); entry.labels = (v.labels || []).slice(); entry.family = str(v.family); entry.insert = { type: 'block', text: '' }; entry.snippet = '';
          if (v.body && !(v.code || v.expr)) { entry.lazy = true; entry.body = v.body; const fb = bodies && bodies.get ? bodies.get(`${p.id}|${v.body}`) : null; if (fb && fb[i.name]) applyBody(entry, fb[i.name]); } else applyBody(entry, v); /* #131: an indexed row has no code; its body is one lazy file per family */
        }
        return entry;
      }).filter((e) => !needle || hay(e).includes(needle));
      if (list.length || (!needle && !['atoms', 'hooks', 'vox-bank', 'recipes'].includes(ing.kind))) { if (!kinds.has(ing.kind)) kinds.set(ing.kind, []); kinds.get(ing.kind).push({ id: ing.id, title: ing.title || ing.id, description: ing.description || '', state: ing.state || 'ready', code: !!ing.code, items: list }); }
    }
    if (kinds.size || (!needle)) out.push({ id: p.id, version: p.version, title: p.title || p.id, description: p.description || '', license: p.license || null, state: p.state || 'ready', layer: p.layer || null, kinds: [...kinds].map(([kind, ingredients]) => ({ kind, noun: KIND_NOUN[kind] || kind, ingredients, count: ingredients.reduce((n, g) => n + g.items.length, 0) })) });
  }
  return out;
}
// the ids the Available list holds for a query (sorted): what the pane and `strudel refs --available --q` must agree on
export const availableIds = (av) => av.flatMap((p) => p.kinds.flatMap((k) => k.ingredients.flatMap((g) => g.items.map((i) => i.id)))).sort();

// ---------------------------------------------------------------- insert planning (pure): where a reference goes without moving anything the user wrote
// Imports and `await voxBank(...)` lines go after the last line of the program's header run (setcpm / atoms.import / voxBank / leading comments);
// a bind goes after the last hooks.bind line, else after the header; a block goes after the caret line (or at the end). Returns { from, insert } for one
// insertion only: the caller dispatches exactly that change, so no other text is touched, replaced or re-indented.
export function insertPlan(code, item, caret = null) {
  const doc = String(code ?? ''); const text = item.insert && item.insert.text; if (!text) return null;
  if (doc.includes(text) && item.insert.type !== 'block') return { noop: true, reason: 'already in the program' };
  const lines = doc.split('\n'); const starts = []; let o = 0; for (const l of lines) { starts.push(o); o += l.length + 1; }
  const endOf = (i) => starts[i] + lines[i].length; const masked = blankComments(doc).split('\n');
  const isHeader = (i) => /^\s*(setcps|setcpm|setbpm|await\s+voxBank|atoms\s*\.\s*import|samples\s*\(|await\s+samples)\b/.test(masked[i]) || (masked[i].trim() === '' && lines[i].trim() !== '' /* comment line */);
  const pushAt = (i, body) => { if (i < 0) return { from: 0, insert: body + (doc.length ? '\n' : ''), line: 1 }; return { from: endOf(i), insert: '\n' + body, line: i + 2 }; };
  const headerEnd = () => { let last = -1; for (let i = 0; i < lines.length; i++) { if (isHeader(i) && /\S/.test(masked[i])) last = i; else if (/\S/.test(masked[i])) break; } return last; };
  if (!doc.trim()) return { from: 0, insert: text + '\n', line: 1 };
  if (item.insert.type === 'import' || item.insert.type === 'header') {
    let last = -1; const re = item.insert.type === 'import' ? /^\s*atoms\s*\.\s*import\b/ : /^\s*await\s+voxBank\b/;
    for (let i = 0; i < lines.length; i++) if (re.test(masked[i])) last = i;
    if (last < 0) last = headerEnd();
    return pushAt(last, text);
  }
  if (item.insert.type === 'bind') {
    let last = -1; for (let i = 0; i < lines.length; i++) if (/\bhooks\s*\.\s*bind\s*\(/.test(masked[i])) last = i;
    if (last < 0) last = headerEnd(); return pushAt(last, text);
  }
  const c = caret == null ? doc.length : Math.max(0, Math.min(doc.length, caret)); let li = 0; while (li + 1 < starts.length && starts[li + 1] <= c) li++;
  if (caret == null || !lines[li].trim()) return caret == null ? { from: doc.length, insert: (doc.endsWith('\n') ? '' : '\n') + text, line: lines.length + 1 } : { from: starts[li], insert: text, line: li + 1 };
  return { from: endOf(li), insert: '\n' + text, line: li + 2 };
}
export const applyPlan = (code, plan) => (plan && !plan.noop ? code.slice(0, plan.from) + plan.insert + code.slice(plan.from) : code);

// ---------------------------------------------------------------- text form (the CLI prints it; the site's Copy list uses it)
export function renderText(model) {
  const out = []; const head = (k) => KIND_LABEL[k] || k; let kind = null;
  for (const r of model.refs) {
    if (r.kind !== kind) { kind = r.kind; out.push('', `${head(kind)} (${model.refs.filter((x) => x.kind === kind).length})`); }
    const src = r.source ? (r.source.pack ? `${r.source.pack}@${r.source.version || '?'}${r.source.license ? ' ' + r.source.license : ''}` : r.source.qualified) : '-';
    out.push(`  ${r.name}  [${r.status.join(', ') || 'info'}]  ${src}${r.line ? '  line ' + [...new Set(r.uses.map((u) => u.line))].slice(0, 6).join(',') : ''}${r.desc ? '  - ' + r.desc : ''}`);
    if (r.params && r.params.length) out.push('      params: ' + r.params.map((p) => `${p.name}${p.min !== undefined || p.max !== undefined ? ` ${p.min ?? ''}..${p.max ?? ''}` : ''}${p.default !== undefined ? ` =${p.default}` : ''}`).join(', '));
    if (r.fix) out.push('      fix: ' + r.fix);
  }
  if (model.missing.length) out.push('', `missing (${model.missing.length}): ` + model.missing.map((m) => `${m.name}${m.fix ? ' -> ' + m.fix : ''}`).join(' | '));
  return out.join('\n').trim() + '\n';
}

// ---------------------------------------------------------------- host facade from loaded packs (the CLI and the unit tests; the site passes sc.packs directly)
// P: { layers: [{ name, packs: [lock entry] }], loaded: { id: { version, ingredients: [{ id, kind, data }] } }, mans: { id: craftpack manifest }, resolution }
export function packsFacade(P) {
  const mans = P.mans || {}; const layerOf = {}; for (const l of P.layers || []) for (const e of l.packs || []) layerOf[e.id] = { layer: l.name, entry: e };
  const list = Object.entries(P.loaded || {}).map(([id, lp]) => { const man = mans[id] || {}; const ent = (layerOf[id] || {}).entry || {}; const allow = ent.allowCode || [];
    return { id, version: lp.version || man.version, title: man.title, description: man.description, license: man.license, state: 'ready', layer: (layerOf[id] || {}).layer, allowCode: allow, source: ent.source, code: (man.ingredients || []).some((i) => i.code || (i.modules && i.modules.length)),
      ingredients: (man.ingredients || []).map((spec) => { const ing = lp.ingredients.find((x) => x.id === spec.id); const code = !!(spec.code || (spec.modules && spec.modules.length)); return { id: spec.id, kind: spec.kind, title: spec.title, description: spec.description, state: ing ? 'ready' : 'skipped', code, granted: allow.includes(spec.id), names: ing ? itemIds(spec.kind, ing.data) : [] }; }) }; });
  const val = (kind, pid, name, data) => { if (kind === 'atoms') return Object.values(data.atoms || {}).find((a) => a.name === name); if (kind === 'hooks') return (data.defs || {})[name]; if (kind === 'recipes') return (data.recipes || []).find((r) => r.id === name); return undefined; };
  const items = (kind) => { const res = (P.resolution || {})[kind] || {}; const out = [];
    for (const [name, e] of Object.entries(res)) { if (e.alias) continue; const pid = e.winner.slice(0, e.winner.lastIndexOf(':')); const lp = (P.loaded || {})[pid]; if (!lp) continue; const ing = lp.ingredients.find((x) => x.kind === kind && itemIds(kind, x.data).includes(name)); if (!ing) continue; out.push({ name, id: e.winner, pack: pid, ingredient: ing.id, value: val(kind, pid, name, ing.data), shadowed: e.shadowed || [] }); }
    return out; };
  // older ids (#120): an alias is its own resolution entry only for sounds; for atoms and hooks packs-core lists them on the item
  const resolution = JSON.parse(JSON.stringify(P.resolution || {}));
  for (const [pid, lp] of Object.entries(P.loaded || {})) for (const ing of lp.ingredients) for (const [alias, to] of itemAliases(ing.kind, ing.data)) { const k = (resolution[ing.kind] ||= {}); if (!k[alias]) k[alias] = { winner: `${pid}:${to}`, shadowed: [], alias: true }; }
  return { list, items, resolution };
}

// text form of available() for the CLI (`strudel refs IN --available [--q QUERY]`): pack, kind, item, description, import / insert line, example code state
export function renderAvailable(av, max = 12) {
  const out = [];
  for (const p of av) {
    out.push('', `${p.id}@${p.version || '?'}${p.license ? ' ' + p.license : ''}  ${p.title}`);
    for (const k of p.kinds) { const n = k.ingredients.reduce((a, g) => a + g.items.length, 0); if (!n) continue; out.push(`  ${k.noun}s (${n})`);
      for (const it of k.ingredients.flatMap((g) => g.items).slice(0, max)) out.push(`    ${it.name}${it.desc ? '  - ' + it.desc : ''}${it.lazy ? '  [body not loaded]' : it.snippet ? '' : '  [no example]'}${it.insert && it.insert.text && it.insert.type !== 'block' ? '  insert: ' + it.insert.text : ''}`);
      if (n > max) out.push(`    ... ${n - max} more (use --q to narrow)`); }
  }
  return out.join('\n').trim() + '\n';
}
