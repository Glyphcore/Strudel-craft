// CraftCues KB resolver (docs/CRAFTCUES.md 4; issue #162): a concept id -> its card { id, kb, status, title, def, link }. Pure ES module, no DOM, no
// Node API; the host passes what it has loaded and every missing source degrades to status "unchecked" / "not-loaded", never to an error.
//   sources: { composition: data/composition.json, syntax: data/syntax.json, genres: { id: genre json }, formBank: Map|obj of fb- records | null,
//              resource: (id) -> { title, def } | null  (the Resources model / packs lookup for hook:, atom:, lane:, pack: ... ids) }
// Id schemes: FAMILY-NN (composer catalog, MOT-05), syntax:<id>, hook: atom: lane: slot: bus: tap: control: vox: import: pack: (the #res ids, docs/RESOURCES.md),
// genre:<id> (docs/genres), fb-<16 hex> (form bank, docs/FORM_BANK.md), form:<role> (form bank labels.form_role), http(s) URLs.
export const RES_KINDS = ['hook', 'atom', 'lane', 'slot', 'bus', 'tap', 'control', 'vox', 'import', 'pack', 'lib', 'groove'];
export const FORM_ROLES = ['intro', 'verse', 'chorus', 'build', 'drop', 'breakdown', 'bridge', 'solo', 'transition', 'outro', 'body', 'other'];
const REPO = 'https://github.com/Glyphcore/Strudel-craft/blob/main/';
const one = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const c = s.slice(0, n); const d = c.lastIndexOf('. '); return d > 60 ? c.slice(0, d + 1) : c.replace(/\s+\S*$/, '') + '…'; };
export function kbOf(id) {
  id = String(id || '');
  if (/^[A-Z]{2,4}-\d{2}$/.test(id)) return 'composition';
  if (/^syntax:[\w.-]+$/.test(id)) return 'syntax';
  const k = /^([a-z]+):/.exec(id); if (k && RES_KINDS.includes(k[1])) return 'resources';
  if (/^genre:[\w.-]+$/.test(id)) return 'genre';
  if (/^fb-[0-9a-f]{16}$/.test(id)) return 'form-bank';
  if (/^form:[\w-]+$/.test(id)) return 'form-role';
  if (/^https?:\/\//.test(id)) return 'url';
  return null;
}
export function makeKB(src = {}) {
  const comp = new Map(); for (const s of (src.composition && src.composition.sections) || []) comp.set(String(s.id).toUpperCase(), s);
  const syn = new Map(); for (const s of (src.syntax && src.syntax.sections) || []) syn.set(s.id, s);
  const bank = src.formBank instanceof Map ? src.formBank : src.formBank ? new Map(Object.entries(src.formBank)) : null;
  const cache = new Map();
  const resolve = (id) => {
    if (cache.has(id)) return cache.get(id); const kb = kbOf(id); const card = { id, kb: kb || 'unknown', status: 'unknown', title: id, def: '', link: null };
    if (kb === 'composition') { const s = comp.get(id); card.link = '#syntax=' + id.toLowerCase(); if (s) Object.assign(card, { status: 'resolved', title: s.title, def: one(s.explain) }); else if (!src.composition) card.status = 'unchecked'; }
    else if (kb === 'syntax') { const k = id.slice(7); const s = syn.get(k); card.link = '#syntax=' + k; if (s) Object.assign(card, { status: 'resolved', title: s.title, def: one(s.explain) }); else if (!src.syntax) card.status = 'unchecked'; }
    else if (kb === 'resources') { card.link = '#res=' + id; const r = src.resource ? src.resource(id) : undefined; if (r) Object.assign(card, { status: 'resolved', title: r.title || id, def: one(r.def) }); else card.status = r === null ? 'unknown' : 'unchecked'; } /* resource() -> null = not there, undefined = cannot tell */
    else if (kb === 'genre') { const k = id.slice(6); const g = src.genres && src.genres[k]; card.link = REPO + 'docs/genres/' + k + '.json'; if (g) Object.assign(card, { status: 'resolved', title: g.label || g.genre || k, def: one(g.description || g.status || (g.criteria ? Object.keys(g.criteria).length + ' measured criteria' : '')) }); else if (!src.genres) card.status = 'unchecked'; }
    else if (kb === 'form-bank') { card.link = REPO + 'docs/FORM_BANK.md'; const r = bank && bank.get(id); if (r) { const l = r.labels || {}; Object.assign(card, { status: 'resolved', title: `${l.form_role || 'section'} (${(r.source && r.source.kind) || 'bank'})`, def: one([l.genres && l.genres.join(', '), r.method, r.evidence && r.evidence.join('; ')].filter(Boolean).join(' · ')) }); } else card.status = bank ? 'unknown' : 'not-loaded'; }
    else if (kb === 'form-role') { const k = id.slice(5); card.link = REPO + 'docs/FORM_BANK.md'; if (FORM_ROLES.includes(k)) Object.assign(card, { status: 'resolved', title: 'Form role: ' + k, def: 'Section role label of the form bank (labels.form_role).' }); }
    else if (kb === 'url') Object.assign(card, { status: 'resolved', title: id.replace(/^https?:\/\//, '').slice(0, 60), link: id });
    cache.set(id, card); return card;
  };
  return resolve;
}
/* cardText(card) -> one line for CLI printing */
export const cardText = (c) => `${c.id}  [${c.kb} ${c.status}]  ${c.title}${c.def ? ' - ' + c.def : ''}${c.link ? '  <' + c.link + '>' : ''}`;
