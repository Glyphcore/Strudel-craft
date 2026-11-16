/* Perform presets (docs/PERFORM_PRESETS.md). Data-driven: built-ins live in data/perform/presets.json (format perform-presets@1), user presets in
   localStorage "sc.perform.presets", export / import use the same document. This module is DOM-free: validation, the store, import / export and
   the resolution of symbolic board cells. perform.js applies a preset to its model (tabs, banks, boards, keys, takeover). The shape follows the
   craftpack list kinds ({presets[{id, title, ...}]}), so a pack kind `perform-presets` can take it over later without a second mechanism. */
export const FORMAT = 'perform-presets@1';
const KEY = 'sc.perform.presets';
const KINDS = ['var', 'hook', 'tap', 'component', 'action', 'scene', 'selection'];
const TAKEOVER = ['jump', 'pickup'];
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const POS = /^\d+,\d+$/;
const FROM = ['lanes', 'maps', 'all'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export const slugId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64) || 'preset';

/* -> null when valid, else one message */
export function validate(p) {
  if (!isObj(p)) return 'preset must be an object';
  if (!ID.test(p.id || '')) return `id "${p.id}" must be lowercase letters, digits, . _ -`;
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 40) return `${p.id}: title must be 1-40 characters`;
  if (p.takeover != null && !TAKEOVER.includes(p.takeover)) return `${p.id}: takeover must be ${TAKEOVER.join(' or ')}`;
  if (p.keys != null) { if (!isObj(p.keys)) return `${p.id}: keys must map key codes to pad positions`; for (const [k, v] of Object.entries(p.keys)) if (!/^[A-Za-z0-9]+$/.test(k) || !(POS.test(v) || /^action:[a-z:]+$/.test(v))) return `${p.id}: bad key mapping ${k} -> ${v}`; }
  if (p.bank != null) {
    const b = p.bank; if (!isObj(b) || !(b.rows >= 1 && b.rows <= 8 && b.cols >= 1 && b.cols <= 8)) return `${p.id}: bank rows and cols must be 1-8`;
    for (const pad of b.pads || []) { if (!isObj(pad) || !POS.test(pad.pos || '')) return `${p.id}: pad position must be "row,col"`; const [r, c] = pad.pos.split(',').map(Number); if (r >= b.rows || c >= b.cols) return `${p.id}: pad ${pad.pos} is outside the ${b.rows}x${b.cols} bank`; if (!isObj(pad.target) || !KINDS.includes(pad.target.kind) || typeof pad.target.ref !== 'string' || !pad.target.ref) return `${p.id}: pad ${pad.pos} needs target {kind, ref}`; }
  }
  if (p.board != null) {
    if (!isObj(p.board) || !Array.isArray(p.board.cells)) return `${p.id}: board.cells must be a list`;
    for (const c of p.board.cells) { if (typeof c === 'string') continue; if (!isObj(c) || !FROM.includes(c.from)) return `${p.id}: a board cell is a control name or {from: ${FROM.join(' | ')}}`; }
  }
  if (!p.bank && !p.board) return `${p.id}: a preset needs a bank, a board or both`;
  return null;
}

export async function loadBuiltins(url = 'data/perform/presets.json') {
  try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); const d = await r.json(); return (d.presets || []).filter((p) => !validate(p)).map((p) => ({ ...p, builtin: true })); } catch (e) { console.warn('[perform presets]', e.message); return []; }
}

export const store = {
  list() { try { const d = JSON.parse(localStorage.getItem(KEY)); return ((d && d.presets) || []).filter((p) => !validate(p)); } catch (e) { return []; } },
  write(list) { try { localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, presets: list })); return true; } catch (e) { return false; } },
  put(p) { const l = this.list().filter((x) => x.id !== p.id); l.push(p); return this.write(l) ? p : null; },
  remove(id) { this.write(this.list().filter((x) => x.id !== id)); },
};

export const exportDoc = (list) => ({ format: FORMAT, presets: list.map(({ builtin, ...p }) => p) });
/* text -> { presets, errors }; accepts the export document, a bare list or a single preset; ids that clash with built-ins or user presets get a -2, -3 suffix */
export function parseImport(text, taken = new Set()) {
  let d; try { d = JSON.parse(text); } catch (e) { return { presets: [], errors: ['Not JSON: ' + e.message] }; }
  const raw = Array.isArray(d) ? d : isObj(d) && Array.isArray(d.presets) ? d.presets : isObj(d) ? [d] : [];
  const presets = [], errors = [];
  for (const p of raw) { const e = validate(p); if (e) { errors.push(e); continue; } let id = p.id, n = 2; while (taken.has(id)) id = `${p.id}-${n++}`; taken.add(id); const { builtin, ...rest } = p; presets.push({ ...rest, id }); }
  if (!raw.length && !errors.length) errors.push('No presets found');
  return { presets, errors };
}

/* lane labels of a program: "kick:" at the start of a line ($: is anonymous) */
export function laneNames(text) { const out = []; for (const m of String(text || '').matchAll(/^[ \t]*([A-Za-z_]\w*)[ \t]*:(?!:)/gm)) if (!out.includes(m[1]) && !/^(hooks|ctl|slider|setcps|setcpm|samples)$/.test(m[1])) out.push(m[1]); return out; }

/* symbolic board cells -> { names, declare: [{ name, spec, dest }], size }.
   ctx: { lanes: [..], all: [control names], mapped: [control names with a hooks.map], knobs: [names of knob/encoder type] } */
export function resolveCells(cells, ctx) {
  const names = [], declare = [], size = {};
  const add = (n, sz) => { if (!names.includes(n)) names.push(n); if (sz) size[n] = sz; };
  for (const c of cells || []) {
    if (typeof c === 'string') { add(c); continue; }
    const sz = c.size || null;
    if (c.from === 'lanes') for (const lane of ctx.lanes || []) { const name = 'mix_' + lane; declare.push({ name, spec: { type: c.type || 'fader', min: c.min ?? 0, max: c.max ?? 1, default: c.default ?? 1 }, label: lane, dest: c.dest ? c.dest.replace('{lane}', lane) : null }); add(name, sz); }
    else if (c.from === 'maps') { const l = (ctx.mapped && ctx.mapped.length ? ctx.mapped : ctx.knobs) || []; l.forEach((n) => add(n, sz)); }
    else if (c.from === 'all') (ctx.all || []).forEach((n) => add(n, sz));
  }
  return { names, declare, size };
}
