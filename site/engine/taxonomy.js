// Folders, tags and tag-driven appearance (docs/PACK_SPEC.md section 5.3, docs/PACKAGES.md). Pure ES module: no DOM, no Node, no imports,
// shared by the site browsers, the CLI (`strudel library|packs list --folder --tag`, `strudel complete`) and the tools.
//   entry   = { id, kind?, title?, pack?, folder?, tags?[] }          (recipes, atoms, racks, feels, grooves, takes, library components)
//   tax     = a pack's craftpack.json "taxonomy" (groups, priority, tags, folders); optional everywhere
//   style   = { color: <PALETTE key>, icon: <ICONS key>, pattern?: 'stripe'|'dots'|'none', badge?: string<=3 }
// Validation here is the one implementation: tools/packs/packs.py mirrors the two regexes (tests/packs/taxonomy.py checks both agree).

export const FOLDER_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,7}$/;
export const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const FOLDER_MAX = 80;
export const TAGS_MAX = 24;

/* Fixed accessible palette. The CSS tokens --tx-<key> (ink) and --tx-<key>-bg (tint) live in site/taxonomy.css, light and dark; tests/site/taxonomy.mjs
   checks every pair for WCAG AA (4.5:1) against the panel and against its own tint, in both themes. */
export const PALETTE = ['amber', 'orange', 'red', 'rose', 'violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'slate'];
export const PATTERNS = ['none', 'stripe', 'dots'];

/* Icons: 24x24 stroke paths (the site's icon language: 2px stroke, round caps). The icon is what makes the style readable without colour. */
export const ICONS = {
  folder: 'M3 7h6l2 2h10v10H3z',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 8h.01',
  drum: 'M4 9c0-2 3.6-3 8-3s8 1 8 3v6c0 2-3.6 3-8 3s-8-1-8-3z M4 9c0 2 3.6 3 8 3s8-1 8-3',
  bass: 'M3 12h3l2-6 3 12 3-9 2 3h5',
  lead: 'M4 20 20 4 M14 4h6v6',
  pad: 'M3 15c3-6 6-6 9 0s6 6 9 0 M3 9c3-6 6-6 9 0s6 6 9 0',
  fx: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l3 3 M15 15l3 3 M18 6l-3 3 M9 15l-3 3',
  vox: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M6 11a6 6 0 0 0 12 0 M12 17v4',
  form: 'M4 6h16 M4 12h10 M4 18h6',
  feel: 'M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z',
  groove: 'M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0',
  dovetail: 'M3 6h6l3 6-3 6H3 M21 6h-6l-3 6 3 6h6',
  genre: 'M5 4v16 M5 5h12l-2 4 2 4H5',
  status: 'M5 12l5 5L20 7',
  keys: 'M4 5h16v14H4z M9 5v9 M15 5v9',
  hat: 'M4 14h16 M7 14c0-4 2-6 5-6s5 2 5 6 M12 14v6',
  bell: 'M6 17h12l-2-3V10a4 4 0 0 0-8 0v4z M10 20h4',
  texture: 'M4 4h4v4H4z M10 4h4v4h-4z M16 4h4v4h-4z M4 10h4v4H4z M16 10h4v4h-4z M10 16h4v4h-4z',
  wave: 'M2 12h3l2-7 4 14 3-10 2 3h6',
  take: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  component: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M17 13v7 M13.5 16.5h7',
  neutral: 'M5 12h14',
};
export const ICON_KEYS = Object.keys(ICONS);

/* Site-wide default style by category (group). Used when no tag of the entry or folder has a style. Priority: user override, pack tag style,
   site tag style, pack group style, site CATEGORY default, NEUTRAL. */
export const NEUTRAL = { color: 'slate', icon: 'neutral', pattern: 'none' };
export const CATEGORY_STYLES = {
  drums: { color: 'orange', icon: 'drum' }, bass: { color: 'rose', icon: 'bass' }, lead: { color: 'amber', icon: 'lead' },
  pad: { color: 'violet', icon: 'pad' }, keys: { color: 'indigo', icon: 'keys' }, fx: { color: 'cyan', icon: 'fx' }, vox: { color: 'lime', icon: 'vox' },
  form: { color: 'blue', icon: 'form' }, feel: { color: 'rose', icon: 'feel' }, groove: { color: 'teal', icon: 'groove' }, dovetail: { color: 'cyan', icon: 'dovetail' },
  genre: { color: 'amber', icon: 'genre' }, status: { color: 'green', icon: 'status' }, texture: { color: 'slate', icon: 'texture' },
  rhythm: { color: 'orange', icon: 'drum' }, harmony: { color: 'indigo', icon: 'keys' }, motif: { color: 'amber', icon: 'lead' }, arrangement: { color: 'blue', icon: 'form' },
  dynamics: { color: 'red', icon: 'wave' }, space: { color: 'cyan', icon: 'fx' }, role: { color: 'teal', icon: 'tag' }, technique: { color: 'violet', icon: 'fx' },
  mood: { color: 'rose', icon: 'feel' }, tempo: { color: 'blue', icon: 'groove' }, take: { color: 'red', icon: 'take' }, component: { color: 'indigo', icon: 'component' }, other: NEUTRAL,
};
/* Site-wide tag -> category (so a pack without a taxonomy still looks right); a pack taxonomy `tags[tag].group` wins. */
export const TAG_CATEGORY = {
  drums: 'drums', kick: 'drums', snare: 'drums', clap: 'drums', hats: 'drums', hat: 'drums', perc: 'drums', 'four-floor': 'drums', breakbeat: 'drums', rhythm: 'rhythm',
  bass: 'bass', 'low-end': 'bass', sub: 'bass', '808': 'bass', lead: 'lead', pluck: 'lead', stab: 'lead', bell: 'lead', arp: 'lead',
  pad: 'pad', texture: 'texture', wide: 'pad', keys: 'keys', chords: 'keys', harmony: 'harmony', vox: 'vox', vocal: 'vox', chop: 'vox',
  fx: 'fx', riser: 'fx', impact: 'fx', sweep: 'fx', space: 'space', echo: 'space', reverb: 'space',
  form: 'form', gate: 'form', arrangement: 'arrangement', section: 'form',
  groove: 'groove', swing: 'groove', human: 'groove', feel: 'feel', dovetail: 'dovetail', transition: 'dovetail',
  verified: 'status', approx: 'status', lowered: 'status', unverified: 'status', 'needs-samples': 'status',
  hiphop: 'genre', 'hip-hop': 'genre', trap: 'genre', hyphy: 'genre', 'boom-bap': 'genre', cloud: 'genre', phonk: 'genre', house: 'genre', techno: 'genre', dnb: 'genre', dubstep: 'genre', edm: 'genre',
  take: 'take', component: 'component', dynamics: 'dynamics', motif: 'motif',
};
/* Which category wins when an entry or folder has several: first in this list. */
export const DEFAULT_PRIORITY = ['dovetail', 'groove', 'drums', 'bass', 'keys', 'pad', 'lead', 'vox', 'fx', 'form', 'genre', 'feel', 'rhythm', 'harmony', 'motif', 'texture', 'space', 'dynamics', 'arrangement', 'tempo', 'technique', 'mood', 'role', 'take', 'component', 'status'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const validStyle = (s) => isObj(s) && (s.color === undefined || PALETTE.includes(s.color)) && (s.icon === undefined || ICON_KEYS.includes(s.icon)) && (s.pattern === undefined || PATTERNS.includes(s.pattern)) && (s.badge === undefined || (typeof s.badge === 'string' && s.badge.length <= 3));
const clean = (s) => (isObj(s) ? Object.fromEntries(Object.entries(s).filter(([k, v]) => ['color', 'icon', 'pattern', 'badge'].includes(k) && v !== undefined)) : null);

/* ---------------- names ---------------- */
export const kebab = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
export const normFolder = (s) => String(s || '').toLowerCase().split('/').map((p) => p.trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('/');
export const checkFolder = (f) => (typeof f !== 'string' || !f.length || f.length > FOLDER_MAX || !FOLDER_RE.test(f) ? 'folder must be slash-separated lowercase segments (a-z, 0-9, hyphen), up to 8 deep' : null);
export const checkTag = (t) => (typeof t !== 'string' || !TAG_RE.test(t) ? 'tag must be lowercase kebab (a-z, 0-9, hyphen), 1-32 chars' : null);
export const folderParts = (f) => (f ? f.split('/') : []);
export const folderTitle = (path) => { const p = folderParts(path); return p.length ? p[p.length - 1].replace(/-/g, ' ') : 'All'; };
export const inFolder = (entryFolder, path) => !path || entryFolder === path || (entryFolder || '').startsWith(path + '/');

/* ---------------- taxonomy of one or many packs ---------------- */
/* merge: later packs add; a tag defined twice keeps the first definition (first-come, as bare names, PACK_SPEC 9.3) */
export function mergeTaxonomies(list) {
  const out = { groups: {}, priority: [], tags: {}, folders: {} };
  for (const t of list) {
    if (!isObj(t)) continue;
    for (const [k, v] of Object.entries(t.groups || {})) out.groups[k] ||= v;
    for (const g of t.priority || []) if (!out.priority.includes(g)) out.priority.push(g);
    for (const [k, v] of Object.entries(t.tags || {})) out.tags[k] ||= v;
    for (const [k, v] of Object.entries(t.folders || {})) out.folders[k] ||= v;
  }
  return out;
}
export const categoryOf = (tag, tax) => (tax && tax.tags && tax.tags[tag] && tax.tags[tag].group) || TAG_CATEGORY[tag] || null;

/* ---------------- appearance ---------------- */
/* user = { styles: { tag|"folder:<path>" -> style } }  (the local overrides, see taxonomy-store.js) */
export function tagStyle(tag, tax, user) {
  const u = user && user.styles && user.styles[tag]; if (u) return { ...NEUTRAL, ...clean(u), source: 'user' };
  const pt = tax && tax.tags && tax.tags[tag] && tax.tags[tag].style; if (pt) return { ...NEUTRAL, ...clean(pt), source: 'pack' };
  const cat = categoryOf(tag, tax);
  const pg = cat && tax && tax.groups && tax.groups[cat] && tax.groups[cat].style; if (pg) return { ...NEUTRAL, ...clean(pg), source: 'group' };
  if (cat && CATEGORY_STYLES[cat]) return { ...NEUTRAL, ...CATEGORY_STYLES[cat], source: 'category' };
  return { ...NEUTRAL, source: 'neutral' };
}
export const priorityOf = (tag, tax) => {
  const order = [...((tax && tax.priority) || []), ...DEFAULT_PRIORITY];
  const keys = [tag, categoryOf(tag, tax)].filter(Boolean); let best = order.length + 1;
  for (const k of keys) { const i = order.indexOf(k); if (i >= 0 && i < best) best = i; }
  return best;
};
/* the dominant tag of a list: lowest priority index, then the one used most (counts), then alphabetical */
export function dominantTag(tags, tax, counts) {
  const list = [...new Set(tags || [])]; if (!list.length) return null;
  return list.sort((a, b) => priorityOf(a, tax) - priorityOf(b, tax) || ((counts && counts[b]) || 0) - ((counts && counts[a]) || 0) || (a < b ? -1 : 1))[0];
}
/* an entry: user override of the entry itself (key kind!id), else its dominant tag, else category default (by folder head), else neutral */
export function entryStyle(entry, tax, user) {
  const tags = entry.tags || [];
  const t = dominantTag(tags.filter((x) => tagStyle(x, tax, user).source !== 'neutral'), tax);
  if (t) return { ...tagStyle(t, tax, user), tag: t };
  const head = folderParts(entry.folder)[0]; const c = head && (TAG_CATEGORY[head] || (CATEGORY_STYLES[head] ? head : null));
  if (c && CATEGORY_STYLES[c]) return { ...NEUTRAL, ...CATEGORY_STYLES[c], source: 'category', tag: null };
  return { ...NEUTRAL, source: 'neutral', tag: null };
}
/* a folder: user override of the folder, else pack folder style, else the dominant tag of everything below it, else the category default of its own name, else neutral */
export function folderStyle(path, entries, tax, user) {
  const u = user && user.styles && user.styles['folder:' + path]; if (u) return { ...NEUTRAL, ...clean(u), source: 'user', tag: null };
  const pf = tax && tax.folders && tax.folders[path] && tax.folders[path].style; if (pf) return { ...NEUTRAL, ...clean(pf), source: 'pack', tag: null };
  const counts = {}; for (const e of entries || []) if (inFolder(e.folder, path)) for (const t of e.tags || []) counts[t] = (counts[t] || 0) + 1;
  const explicit = tax && tax.folders && tax.folders[path] && tax.folders[path].tags;
  const t = dominantTag((explicit && explicit.length ? explicit : Object.keys(counts)).filter((x) => tagStyle(x, tax, user).source !== 'neutral'), tax, counts);
  if (t) return { ...tagStyle(t, tax, user), tag: t };
  const own = folderParts(path).slice().reverse().map((p) => (CATEGORY_STYLES[p] ? p : TAG_CATEGORY[p])).find(Boolean);
  if (own && CATEGORY_STYLES[own]) return { ...NEUTRAL, ...CATEGORY_STYLES[own], source: 'category', tag: null };
  return { ...NEUTRAL, source: 'neutral', tag: null };
}

/* ---------------- tree, filter, search, sort ---------------- */
/* node = { path, name, count (entries at or below), own (entries directly here), children[] } ; root path '' */
export function buildTree(entries, extraFolders = []) {
  const root = { path: '', name: 'All', count: 0, own: 0, children: [] }; const by = new Map([['', root]]);
  const ensure = (path) => { if (by.has(path)) return by.get(path); const ps = folderParts(path); const parent = ensure(ps.slice(0, -1).join('/')); const n = { path, name: ps[ps.length - 1], count: 0, own: 0, children: [] }; parent.children.push(n); by.set(path, n); return n; };
  for (const f of extraFolders) if (f) ensure(f);
  for (const e of entries) { root.count++; if (!e.folder) { root.own++; continue; } const ps = folderParts(e.folder); for (let i = 1; i <= ps.length; i++) ensure(ps.slice(0, i).join('/')).count++; ensure(e.folder).own++; }
  const sortRec = (n) => { n.children.sort((a, b) => (a.name < b.name ? -1 : 1)); n.children.forEach(sortRec); };
  sortRec(root); return root;
}
export const findNode = (tree, path) => { let n = tree; for (const p of folderParts(path)) { n = n.children.find((c) => c.name === p); if (!n) return null; } return n; };
export const breadcrumbs = (path) => [{ path: '', name: 'All' }, ...folderParts(path).map((p, i, a) => ({ path: a.slice(0, i + 1).join('/'), name: p }))];
export function tagCounts(entries) { const c = {}; for (const e of entries) for (const t of e.tags || []) c[t] = (c[t] || 0) + 1; return c; }
const norm = (s) => String(s || '').toLowerCase();
/* the search haystack of an entry: names, tags and folder paths (a path also as words, "hiphop trap drums") */
export const haystack = (e, extra = '') => norm([e.id, e.title, e.pack, e.folder, (e.folder || '').replace(/\//g, ' '), ...(e.tags || []), (e.tags || []).join(' ').replace(/-/g, ' '), extra].join(' '));
/* opts: { q, tags[], mode: 'and'|'or', folder } -> entries. Tags AND = every tag, OR = any tag. */
export function filterEntries(entries, { q = '', tags = [], mode = 'and', folder = '', extra } = {}) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (folder && !inFolder(e.folder, folder)) return false;
    if (tags.length) { const have = new Set(e.tags || []); if (mode === 'or' ? !tags.some((t) => have.has(t)) : !tags.every((t) => have.has(t))) return false; }
    if (!words.length) return true;
    const h = haystack(e, extra ? extra(e) : ''); return words.every((w) => h.includes(w));
  });
}
export const SORTS = { catalog: null, name: (a, b) => (norm(a.title || a.id) < norm(b.title || b.id) ? -1 : 1), folder: (a, b) => ((a.folder || '~') < (b.folder || '~') ? -1 : (a.folder || '~') > (b.folder || '~') ? 1 : norm(a.title || a.id) < norm(b.title || b.id) ? -1 : 1), pack: (a, b) => ((a.pack || '') < (b.pack || '') ? -1 : (a.pack || '') > (b.pack || '') ? 1 : 0), tags: (a, b) => ((b.tags || []).length - (a.tags || []).length) };
export function sortEntries(entries, how) { const f = SORTS[how]; return f ? entries.slice().sort((a, b) => f(a, b) || 0) : entries; }

/* ---------------- deep links ---------------- */
/* "#folder=hiphop/trap&tag=drums,kick&mode=or" (also read from a hash like "#r/id?..." is not supported: the browser owns "#r/") */
export function parseLink(hash) {
  const h = String(hash || '').replace(/^#/, ''); if (!/(^|&)(folder|tag|mode)=/.test(h)) return null;
  const p = new URLSearchParams(h); const folder = normFolder(p.get('folder') || ''); const tags = (p.get('tag') || '').split(',').map(kebab).filter(Boolean);
  return { folder: checkFolder(folder) ? '' : folder, tags, mode: p.get('mode') === 'or' ? 'or' : 'and' };
}
export function formatLink({ folder = '', tags = [], mode = 'and' } = {}) {
  const p = []; if (folder) p.push('folder=' + folder); if (tags.length) p.push('tag=' + tags.join(',')); if (tags.length > 1 && mode === 'or') p.push('mode=or'); return p.length ? '#' + p.join('&') : '';
}

/* ---------------- entries from pack data ---------------- */
/* effective folder/tags: the user overlay (kind!id) replaces the pack's own values; user tags are added to the pack tags when `addTags` */
export function applyOverlay(entry, overlay) {
  const o = overlay && overlay.entries && overlay.entries[(entry.kind || 'recipe') + '!' + entry.id]; if (!o) return entry;
  return { ...entry, folder: o.folder !== undefined ? o.folder : entry.folder, tags: o.tags ? [...new Set([...(entry.tags || []), ...o.tags])] : entry.tags, userTags: o.tags || [] , edited: true };
}
