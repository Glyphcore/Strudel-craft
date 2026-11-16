/* Organizer (docs/PACKAGES.md section 6): folder tree, breadcrumbs, tag chips with AND/OR, sort, user folders and tags, tag-driven appearance.
   One component mounted by the Recipes, Syntax and Banks browsers; the filtering and styling rules are in engine/taxonomy.js (DOM-free), the local data in
   taxonomy-store.js. Notices are toasts and every input is the site modal (ui.form); no native dialogs. Presses never scroll the editor (#107): handlers
   are pointer/click on buttons that only change this component, never focus or select code. */
import * as T from './engine/taxonomy.js';
import { createStore } from './taxonomy-store.js';

const sc = (window.strudelCraft = window.strudelCraft || {});
sc.taxonomy = sc.taxonomy || { T };
export { T };
export const store = (sc.taxonomyStore = sc.taxonomyStore || createStore());
const SVG = 'http://www.w3.org/2000/svg';
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter((x) => x != null && x !== false)); return e; };
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const LOADCSS = () => { for (const f of ['taxonomy.css', 'organizer.css']) { if (document.querySelector(`link[data-org="${f}"]`)) continue; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(f, import.meta.url).href; l.dataset.org = f; document.head.append(l); } };

/* ---- appearance: a style -> a small icon box (colour tokens from taxonomy.css) ---- */
export function icon(key) { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', T.ICONS[key] || T.ICONS.neutral); s.append(p); return s; }
export function styleAttrs(st) { const c = T.PALETTE.includes(st.color) ? st.color : 'slate'; return { style: `--tx:var(--tx-${c});--tx-bg:var(--tx-${c}-bg)`, 'data-tx': st.source || 'neutral', 'data-pattern': st.pattern || 'none', 'data-color': c, 'data-icon': st.icon || 'neutral' }; }
export const ico = (st, cls = '') => h('span', { class: ('tx-ico ' + cls).trim(), ...styleAttrs(st) }, icon(st.icon), st.badge ? h('b', {}, st.badge) : null);

export function getTax() { try { const P = sc.packs; return T.mergeTaxonomies((P ? P.list() : []).filter((p) => p.state === 'ready').map((p) => p.taxonomy)); } catch { return T.mergeTaxonomies([]); } }
/* an entry with its effective folder and tags (the user overlay replaces the folder and adds tags) */
export const withOverlay = (e) => T.applyOverlay(e, store.overlay());
sc.taxonomyOverlay = (e) => T.applyOverlay(e, store.overlay());
export const keyOf = (e) => (e.kind || 'recipe') + '!' + e.id;

const KEY = (kind) => 'sc.org.' + kind;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

/* ---- dialogs (the site modal: ui.form) ---- */
function field(label, input, hint) { return h('label', { class: 'org-f' }, h('span', { class: 'scm-lab' }, label), input, hint ? h('small', {}, hint) : null); }
export async function editEntryDialog(entry, { folders = [], tags = [] } = {}) {
  const key = keyOf(entry); const cur = store.entry(key) || {}; const eff = withOverlay(entry);
  const list = h('datalist', { id: 'orgDl' }, ...[...new Set([...folders, ...store.folders()])].sort().map((f) => h('option', { value: f })));
  const fIn = h('input', { type: 'text', class: 'scm-input', value: cur.folder !== undefined ? cur.folder : eff.folder || '', list: 'orgDl', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'hiphop/trap/drums' });
  const tIn = h('input', { type: 'text', class: 'scm-input', value: (cur.tags || []).join(', '), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'my-favourite, dark' });
  const pack = h('p', { class: 'scm-msg org-pack' }, `${entry.title || entry.id} · pack tags: `, h('span', {}, (entry.tags || []).join(', ') || 'none'), entry.folder ? ` · pack folder ${entry.folder}` : '');
  const body = h('div', { class: 'org-form' }, pack, field('Folder (slash path, lowercase)', fIn, 'Empty puts it back in the pack folder'), list, field('Your tags (comma separated, lowercase kebab)', tIn, 'Added to the pack tags; stored on this device'));
  const res = await sc.ui.form({ title: 'Folder and tags', okText: 'Save', body,
    validate: () => { const f = T.normFolder(fIn.value); if (fIn.value.trim() && T.checkFolder(f)) return 'Folder: ' + T.checkFolder(f); return null; },
    collect: () => ({ folder: T.normFolder(fIn.value), tags: tIn.value.split(',').map(T.kebab).filter(Boolean) }) });
  if (!res) return null;
  store.move(key, res.folder === (entry.folder || '') ? '' : res.folder);
  store.tag(key, res.tags); toast(`Saved folder and tags for ${entry.title || entry.id}`, { kind: 'ok' }); return res;
}
export async function appearanceDialog({ targets, tax }) {
  const opts = targets.filter((t) => t.name); if (!opts.length) { toast('Pick a folder or a tag first', { kind: 'info' }); return null; }
  const sel = h('select', { class: 'scm-input', 'aria-label': 'Apply to' }, ...opts.map((o) => h('option', { value: o.name }, o.label)));
  const state = { color: null, icon: null, pattern: 'none' };
  const sw = h('div', { class: 'org-sw', role: 'radiogroup', 'aria-label': 'Colour' }), ic = h('div', { class: 'org-sw', role: 'radiogroup', 'aria-label': 'Icon' }), pt = h('div', { class: 'org-sw', role: 'radiogroup', 'aria-label': 'Pattern' });
  const prev = h('div', { class: 'org-prev' });
  const cur = () => { const n = sel.value; return n.startsWith('folder:') ? T.folderStyle(n.slice(7), opts.find((o) => o.name === n).entries || [], tax, store.user()) : T.tagStyle(n, tax, store.user()); };
  const paint = () => {
    const base = cur(); const st = { ...base, color: state.color || base.color, icon: state.icon || base.icon, pattern: state.pattern || base.pattern };
    prev.replaceChildren(ico(st, 'big'), h('span', {}, `${sel.value.replace('folder:', 'folder ')}: ${st.color}, ${st.icon}, ${st.pattern} (${base.source}${state.color || state.icon ? ', changed' : ''})`));
    sw.replaceChildren(...T.PALETTE.map((c) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.color === c), 'aria-label': c, title: c, class: 'org-swb', 'data-c': c, ...styleAttrs({ color: c }), onclick: () => { state.color = c; paint(); } }, h('span', { class: 'tx-ico', ...styleAttrs({ ...st, color: c }) }, icon(st.icon)), h('i', {}, c))));
    ic.replaceChildren(...T.ICON_KEYS.map((k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.icon === k), 'aria-label': k, title: k, class: 'org-swb', 'data-i': k, ...styleAttrs(st), onclick: () => { state.icon = k; paint(); } }, h('span', { class: 'tx-ico', ...styleAttrs(st) }, icon(k)), h('i', {}, k))));
    pt.replaceChildren(...T.PATTERNS.map((p) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.pattern === p), class: 'org-swb', 'data-p': p, ...styleAttrs({ ...st, pattern: p }), onclick: () => { state.pattern = p; paint(); } }, h('span', { class: 'tx-ico', ...styleAttrs({ ...st, pattern: p }) }, icon(st.icon)), h('i', {}, p))));
  };
  sel.addEventListener('change', () => { state.color = state.icon = null; state.pattern = null; paint(); }); state.pattern = null; paint();
  const body = h('div', { class: 'org-form' }, field('Apply to', sel), prev, h('div', {}, h('span', { class: 'scm-lab' }, 'Colour (fixed accessible set)'), sw), h('div', {}, h('span', { class: 'scm-lab' }, 'Icon'), ic), h('div', {}, h('span', { class: 'scm-lab' }, 'Pattern'), pt),
    h('button', { type: 'button', class: 'ghost org-reset', onclick: () => { store.clearStyle(sel.value.replace(/^tag:/, '')); state.color = state.icon = state.pattern = null; paint(); toast('Appearance reset to the pack default', { kind: 'ok' }); } }, 'Reset to default'));
  const out = await sc.ui.form({ title: 'Appearance', okText: 'Apply', body, collect: () => ({ name: sel.value, ...state }) });
  if (!out) return null;
  if (out.color || out.icon || out.pattern) { const base = cur(); store.setStyle(out.name, { color: out.color || base.color, icon: out.icon || base.icon, pattern: out.pattern || base.pattern || 'none' }); toast('Appearance saved on this device', { kind: 'ok' }); }
  return out;
}

/* ---- the component ---- */
/* o = { kind, host (element), entries: () => entry[], onChange(), link: bool, noun: 'recipes', sorts: ['catalog','name','folder','pack'] } */
export function createOrganizer(o) {
  LOADCSS();
  const saved = lsGet(KEY(o.kind), {});
  const S = { folder: saved.folder || '', tags: saved.tags || [], mode: saved.mode === 'or' ? 'or' : 'and', sort: saved.sort || 'catalog', open: new Set(saved.open || []), more: false, ph: !!saved.ph };
  const link = (o.link !== false) ? T.parseLink(location.hash) : null; if (link) { S.folder = link.folder; S.tags = link.tags; S.mode = link.mode; }
  const sorts = o.sorts || ['catalog', 'name', 'folder', 'pack'];
  const SORTNAME = { catalog: 'Catalog order', name: 'Name', folder: 'Folder', pack: 'Pack', tags: 'Most tags' };
  const save = () => lsSet(KEY(o.kind), { folder: S.folder, tags: S.tags, mode: S.mode, sort: S.sort, open: [...S.open] });
  const crumbs = h('nav', { class: 'org-crumbs', 'aria-label': 'Folder path', hidden: true });
  const det = h('details', { class: 'org', id: 'org-' + o.kind }); const sum = h('summary', {}, h('span', {}, 'Folders and tags'), h('span', { class: 'pill', 'data-org-count': '' }));
  const tree = h('ul', { class: 'org-tree', role: 'tree', 'aria-label': 'Folders', 'data-keys': 'own' }), chipsBox = h('div', { class: 'org-chips', role: 'group', 'aria-label': 'Tags' , 'data-keys': 'own' });
  const modeBtn = h('button', { type: 'button', class: 'ghost org-mode', role: 'switch', title: 'Tags match all (AND) or any (OR)' }), sortSel = h('select', { class: 'org-sort', 'aria-label': 'Sort' }, ...sorts.map((s) => h('option', { value: s }, SORTNAME[s] || s)));
  const acts = h('div', { class: 'org-acts' });
  det.append(sum, h('div', { class: 'org-body' }, h('div', { class: 'org-sec' }, h('h3', {}, 'Folders'), tree), h('div', { class: 'org-sec' }, h('div', { class: 'org-tags-head' }, h('h3', {}, 'Tags'), modeBtn, sortSel), chipsBox), acts));
  o.host.replaceChildren(crumbs, det);
  det.open = !!saved.ph || S.open.has('*') || !!link;

  const all = () => o.entries().map(withOverlay);
  let tax = getTax(); const refreshTax = () => { tax = getTax(); };
  const user = () => store.user();
  const fire = () => { save(); if (o.link !== false) writeLink(); o.onChange && o.onChange(S); };
  function writeLink() { const l = T.formatLink(S); if (!l) { if (/^#(folder|tag|mode)=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); return; } if (!location.hash || /^#(folder|tag|mode)=/.test(location.hash)) history.replaceState(null, '', l); }
  const pass = (e) => (!S.folder || T.inFolder(e.folder, S.folder)) && (!S.tags.length || (S.mode === 'or' ? S.tags.some((t) => (e.tags || []).includes(t)) : S.tags.every((t) => (e.tags || []).includes(t))));
  const setFolder = (p) => { S.folder = p; if (p) T.folderParts(p).forEach((_, i, a) => S.open.add(a.slice(0, i).join('/'))); fire(); render(); };
  const toggleTag = (t) => { const i = S.tags.indexOf(t); i >= 0 ? S.tags.splice(i, 1) : S.tags.push(t); fire(); render(); };

  function renderCrumbs() {
    const parts = T.breadcrumbs(S.folder); const act = !!(S.folder || S.tags.length);
    crumbs.hidden = !act;
    crumbs.replaceChildren(...[...parts.flatMap((c, i) => [i ? h('span', { class: 'org-sep', 'aria-hidden': 'true' }, '/') : null, h('button', { type: 'button', class: 'org-crumb', 'aria-current': i === parts.length - 1 && !S.tags.length ? 'true' : null, onclick: () => setFolder(c.path) }, c.name)]),
      ...S.tags.map((t) => h('button', { type: 'button', class: 'org-crumb org-ctag', title: 'Remove tag ' + t, 'aria-label': 'Remove tag ' + t, onclick: () => toggleTag(t) }, ico(T.tagStyle(t, tax, user())), t, h('span', { 'aria-hidden': 'true' }, ' ×'))),
      h('button', { type: 'button', class: 'ghost org-clear', onclick: () => { S.folder = ''; S.tags = []; fire(); render(); } }, 'Clear')].filter(Boolean));
    sum.querySelector('[data-org-count]').textContent = String((S.folder ? 1 : 0) + S.tags.length || '');
  }
  function renderTree(list) {
    const t = T.buildTree(list, store.folders()); const out = [];
    const row = (n, level) => {
      const kids = n.children.length, open = n.path === '' || S.open.has(n.path) || (S.folder && (S.folder === n.path || S.folder.startsWith(n.path + '/')));
      const st = T.folderStyle(n.path, list, tax, user()); const sel = S.folder === n.path;
      const li = h('li', { role: 'none', class: 'org-node' + (sel ? ' sel' : ''), 'data-path': n.path },
        h('div', { class: 'org-row', style: `--lv:${level}` },
          kids && n.path !== '' ? h('button', { type: 'button', class: 'org-tgl', 'aria-label': (open ? 'Collapse ' : 'Expand ') + n.name, 'aria-expanded': String(!!open), onclick: () => { open && !(S.folder === n.path || S.folder.startsWith(n.path + '/')) ? S.open.delete(n.path) : S.open.add(n.path); if (open && S.folder.startsWith(n.path)) setFolder(n.path); save(); render(); } }, h('i', { 'aria-hidden': 'true' })) : h('span', { class: 'org-tgl none', 'aria-hidden': 'true' }),
          h('button', { type: 'button', role: 'treeitem', class: 'org-sel', 'aria-level': String(level + 1), 'aria-selected': String(sel), ...(kids ? { 'aria-expanded': String(!!open) } : {}), title: (tax.folders[n.path] && tax.folders[n.path].description) || n.path || 'Everything', onclick: () => setFolder(n.path === S.folder ? '' : n.path) },
            ico(st), h('span', { class: 'org-name' }, T.folderTitle(n.path) === 'All' ? 'All' : n.name.replace(/-/g, ' ')), h('span', { class: 'org-n' }, String(n.count)))));
      out.push(li); if (kids && open) n.children.forEach((c) => row(c, level + 1));
    };
    row(t, 0); tree.replaceChildren(...out);
  }
  function renderChips(list) {
    const counts = T.tagCounts(list); const names = Object.keys(counts).sort((a, b) => T.priorityOf(a, tax) - T.priorityOf(b, tax) || counts[b] - counts[a] || (a < b ? -1 : 1));
    const LIM = 16; const top = new Set(names.slice().sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1)).slice(0, LIM)); const shown = S.more ? names : names.filter((n) => top.has(n)); /* the 16 most used, in priority order */
    for (const t of S.tags) if (!shown.includes(t)) shown.push(t);
    chipsBox.replaceChildren(...shown.map((t) => { const st = T.tagStyle(t, tax, user()); const on = S.tags.includes(t);
      return h('button', { type: 'button', class: 'org-chip', 'aria-pressed': String(on), 'data-tag': t, title: (tax.tags[t] && tax.tags[t].description) || t, ...styleAttrs(st), onclick: () => toggleTag(t) }, ico(st), h('span', {}, t), h('em', {}, String(counts[t] || 0))); }),
      names.length > LIM ? h('button', { type: 'button', class: 'ghost org-more', onclick: () => { S.more = !S.more; renderChips(list); } }, S.more ? 'Fewer tags' : `All ${names.length} tags`) : null);
    modeBtn.setAttribute('aria-checked', String(S.mode === 'or')); modeBtn.textContent = S.mode === 'or' ? 'Match any (OR)' : 'Match all (AND)'; modeBtn.disabled = S.tags.length < 2 && false;
    sortSel.value = S.sort;
  }
  function renderActs(list) {
    acts.replaceChildren(
      h('button', { type: 'button', class: 'ghost', onclick: async () => { const targets = [...(S.folder ? [{ name: 'folder:' + S.folder, label: 'Folder ' + S.folder, entries: list }] : []), ...S.tags.map((t) => ({ name: t, label: 'Tag ' + t })), ...Object.keys(T.tagCounts(list)).filter((t) => !S.tags.includes(t)).slice(0, 40).map((t) => ({ name: t, label: 'Tag ' + t }))]; if (await appearanceDialog({ targets, tax })) render(); } }, 'Appearance'),
      h('button', { type: 'button', class: 'ghost', onclick: async () => { const v = await sc.ui.ask({ title: 'New folder', label: 'Folder path (lowercase, slashes)', value: S.folder ? S.folder + '/' : '', okText: 'Create' }); if (v == null) return; const p = T.normFolder(v); const e = T.checkFolder(p); if (e) return toast('Folder: ' + e, { kind: 'error' }); store.addFolder(p); setFolder(p); toast('Folder ' + p + ' created. Move entries into it from their Folder and tags button', { kind: 'ok' }); } }, 'New folder'),
      h('button', { type: 'button', class: 'ghost', onclick: () => exportJSON() }, 'Export'),
      h('button', { type: 'button', class: 'ghost', onclick: () => importJSON() }, 'Import'));
  }
  function exportJSON() { const text = store.exportJSON(); try { const b = new Blob([text], { type: 'application/json' }), a = h('a', { href: URL.createObjectURL(b), download: 'strudel-craft-taxonomy.json' }); document.body.append(a); a.click(); a.remove(); toast('Exported folders, tags and appearance (' + text.length + ' bytes)', { kind: 'ok' }); } catch { navigator.clipboard && navigator.clipboard.writeText(text).then(() => toast('Copied the JSON', { kind: 'ok' })); } }
  function importJSON() { const f = h('input', { type: 'file', accept: 'application/json,.json', hidden: true }); document.body.append(f); f.addEventListener('change', async () => { const txt = await f.files[0].text(); f.remove(); const r = store.importJSON(txt); if (!r.ok && r.errors.length) toast('Import: ' + r.errors.slice(0, 2).join('; '), { kind: 'error' }); else toast('Imported folders, tags and appearance', { kind: 'ok' }); render(); fire(); }); f.click(); }

  function render() {
    refreshTax(); const list = all(); renderCrumbs(); renderTree(list); renderChips(list); renderActs(list);
    for (const e of o.host.querySelectorAll('[data-org-live]')) e.remove();
  }
  det.addEventListener('toggle', () => { saved.ph = det.open; lsSet(KEY(o.kind), { ...lsGet(KEY(o.kind), {}), ph: det.open }); });
  modeBtn.addEventListener('click', () => { S.mode = S.mode === 'or' ? 'and' : 'or'; fire(); render(); });
  sortSel.addEventListener('change', () => { S.sort = sortSel.value; fire(); });
  store.subscribe(() => { render(); o.onChange && o.onChange(S); });
  window.addEventListener('hashchange', () => { const l = o.link !== false && T.parseLink(location.hash); if (l && (l.folder !== S.folder || l.tags.join() !== S.tags.join() || l.mode !== S.mode)) { S.folder = l.folder; S.tags = l.tags; S.mode = l.mode; save(); render(); o.onChange && o.onChange(S); } });
  render();
  return { state: S, pass, el: det, refresh: render, sort: (list) => T.sortEntries(list, S.sort), tax: () => tax, set: (v) => { Object.assign(S, v); fire(); render(); }, entryStyle: (e) => T.entryStyle(e, tax, user()), folderStyle: (p) => T.folderStyle(p, all(), tax, user()) };
}
