// Local folders, tags and tag styles of the user (docs/PACK_SPEC.md 5.3, docs/PACKAGES.md section 6). DOM-free; storage is injected.
// localStorage "sc.taxonomy" = { format: "taxonomy@1", folders: [path], entries: { "<kind>!<id>": { folder?, tags? } }, styles: { "<tag>"|"folder:<path>": style } }
// Export and import use the same document (like perform-presets@1). Kind `taxonomy` is listed as coming in PACK_SPEC section 5: no pack kind is added here.
import { checkFolder, checkTag, normFolder, kebab, validStyle, TAGS_MAX } from './engine/taxonomy.js';

const KEY = 'sc.taxonomy', FORMAT = 'taxonomy@1';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const empty = () => ({ format: FORMAT, folders: [], entries: {}, styles: {} });

/* validate a taxonomy@1 document; returns { ok, doc (cleaned), errors[] } and never throws */
export function parseDoc(text) {
  const errors = []; let d;
  try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch { return { ok: false, errors: ['not JSON'], doc: empty() }; }
  if (!isObj(d) || d.format !== FORMAT) return { ok: false, errors: [`format must be "${FORMAT}"`], doc: empty() };
  const doc = empty();
  for (const f of Array.isArray(d.folders) ? d.folders : []) { const e = checkFolder(f); if (e) errors.push(`folder "${f}": ${e}`); else if (!doc.folders.includes(f)) doc.folders.push(f); }
  for (const [k, v] of Object.entries(isObj(d.entries) ? d.entries : {})) {
    if (!/^[a-z][a-z-]*![^\s]{1,120}$/.test(k) || !isObj(v)) { errors.push(`entry "${k}" is not kind!id`); continue; }
    const o = {};
    if (v.folder !== undefined) { const e = v.folder === '' ? null : checkFolder(v.folder); if (e) { errors.push(`entry ${k}: ${e}`); continue; } o.folder = v.folder; }
    if (v.tags !== undefined) { if (!Array.isArray(v.tags) || v.tags.length > TAGS_MAX || v.tags.some((t) => checkTag(t))) { errors.push(`entry ${k}: tags must be up to ${TAGS_MAX} lowercase kebab names`); continue; } o.tags = [...new Set(v.tags)]; }
    doc.entries[k] = o;
  }
  for (const [k, v] of Object.entries(isObj(d.styles) ? d.styles : {})) {
    const name = k.startsWith('folder:') ? k.slice(7) : k; if (k.startsWith('folder:') ? checkFolder(name) : checkTag(name)) { errors.push(`style "${k}": bad name`); continue; }
    if (!validStyle(v)) { errors.push(`style "${k}": colour, icon or pattern is not in the fixed set`); continue; } doc.styles[k] = v;
  }
  return { ok: !errors.length, errors, doc };
}

export function createStore(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  let doc = empty(); const subs = new Set();
  try { const raw = storage && storage.getItem(KEY); if (raw) doc = parseDoc(raw).doc; } catch { /* corrupt: start empty */ }
  const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(doc)); } catch { /* quota: memory copy stays */ } subs.forEach((f) => { try { f(doc); } catch { /* subscriber errors never break a write */ } }); };
  const slot = (key) => (doc.entries[key] ||= {});
  const prune = (key) => { const o = doc.entries[key]; if (o && o.folder === undefined && !(o.tags && o.tags.length)) delete doc.entries[key]; };
  return {
    get doc() { return doc; },
    overlay: () => doc,
    user: () => ({ styles: doc.styles }),
    folders: () => doc.folders.slice(),
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    addFolder(path) { const p = normFolder(path), e = checkFolder(p); if (e) throw new Error(e); if (!doc.folders.includes(p)) { doc.folders.push(p); save(); } return p; },
    removeFolder(path) { doc.folders = doc.folders.filter((f) => f !== path && !f.startsWith(path + '/')); for (const [k, o] of Object.entries(doc.entries)) if (o.folder === path || (o.folder || '').startsWith(path + '/')) { delete o.folder; prune(k); } delete doc.styles['folder:' + path]; save(); },
    move(key, folder) { const p = folder === '' ? '' : normFolder(folder); if (p) { const e = checkFolder(p); if (e) throw new Error(e); if (!doc.folders.includes(p)) doc.folders.push(p); } slot(key).folder = p; save(); return p; },
    tag(key, tags) { const list = [...new Set((tags || []).map(kebab).filter(Boolean))]; if (list.length > TAGS_MAX) throw new Error(`at most ${TAGS_MAX} tags`); slot(key).tags = list; if (!list.length) delete doc.entries[key].tags; prune(key); save(); return list; },
    entry: (key) => doc.entries[key] || null,
    setStyle(name, style) { if (!validStyle(style)) throw new Error('colour, icon and pattern must come from the fixed set'); doc.styles[name] = { ...style }; save(); },
    clearStyle(name) { delete doc.styles[name]; save(); },
    exportJSON: () => JSON.stringify(doc, null, 2),
    importJSON(text, { merge = true } = {}) { const r = parseDoc(text); if (!r.ok && !r.doc.folders.length && !Object.keys(r.doc.entries).length && !Object.keys(r.doc.styles).length) return r;
      doc = merge ? { format: FORMAT, folders: [...new Set([...doc.folders, ...r.doc.folders])], entries: { ...doc.entries, ...r.doc.entries }, styles: { ...doc.styles, ...r.doc.styles } } : r.doc; save(); return r; },
    clear() { doc = empty(); save(); },
  };
}
export const KEYS = { storage: KEY, format: FORMAT };
