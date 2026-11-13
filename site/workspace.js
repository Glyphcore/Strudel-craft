/* Workspace: dock any panel (editor, graph, recipes, history, perform, syntax, tracker) into panes pinned below the
   visuals. Layout = rows of panes; each pane can move up/down/left/right, split (own row / join row above), collapse, close.
   Desktop: panes in a row are resizable (drag the gutter). Phones: one column, reorder with the drag handle.
   Configs (name, rows, hotkey) are kept in localStorage "sc.ws.*", so the history store versions them.
   API: window.strudelCraft.workspace = { on, off, apply(layout), layout(), save(name), load(name), configs(), panes } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const get = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const clone = (x) => JSON.parse(JSON.stringify(x));

/* pane sources: find(): the existing panel element to move in (restored to its place when the workspace closes) */
const PANES = {
  editor: { title: 'Code', find: () => $('.view-rack .editor') || $('#code') && $('#code').closest('.panel') },
  graph: { title: 'Graph', find: () => $('#graph') },
  recipes: { title: 'Recipes', find: () => $('.browser') },
  perform: { title: 'Perform', find: () => $('#perform') },
  syntax: { title: 'Syntax', find: () => $('#syntax') },
  history: { title: 'History', make: historyPane },
  tracker: { title: 'Tracker', find: () => $('#tracker') },
  record: { title: 'Record', find: () => $('#capSheet') },
};
const DEFAULTS = {
  Code: { rows: [[{ id: 'recipes', w: 1 }, { id: 'editor', w: 2 }]], key: 'Alt+1' },
  Perform: { rows: [[{ id: 'perform', w: 1 }], [{ id: 'editor', w: 1, c: true }]], key: 'Alt+2' },
  Visual: { rows: [[{ id: 'graph', w: 1 }]], key: 'Alt+3' },
  'Full studio': { rows: [[{ id: 'recipes', w: 1 }, { id: 'editor', w: 2 }], [{ id: 'perform', w: 2 }, { id: 'syntax', w: 1 }], [{ id: 'graph', w: 1 }], [{ id: 'history', w: 1 }, { id: 'tracker', w: 1 }]], key: 'Alt+4' },
};
let rows = [], active = false, root = null, homes = new Map(), made = new Map();

function historyPane() {
  const d = document.createElement('div'); d.className = 'ws-hist';
  d.innerHTML = '<div class="ws-hist-acts"><button type="button" class="ghost" data-a="undo">Undo</button><button type="button" class="ghost" data-a="redo">Redo</button><button type="button" class="ghost" data-a="open">Timeline</button></div><ol class="ws-hist-log"></ol>';
  d.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; const h = sc.history; if (a.dataset.a === 'open') { const b = $('#histBtn'); b && b.click(); } else if (h && h[a.dataset.a]) h[a.dataset.a](); });
  const fill = async () => { const h = sc.history; if (!h || !h.log) return; try { const log = (await h.log()).slice(0, 12); d.querySelector('ol').innerHTML = log.map((c) => `<li><time>${new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> ${String(c.label || (c.changed || []).join(', ')).replace(/[&<>]/g, '')}</li>`).join('') || '<li>No history yet</li>'; } catch (e) { /* history busy */ } };
  fill(); d._t = setInterval(() => { if (d.isConnected) fill(); }, 5000); return d;
}
function content(id) {
  const p = PANES[id]; if (!p) return null;
  if (p.make) { if (!made.has(id)) made.set(id, p.make()); return made.get(id); }
  if (homes.has(id)) return homes.get(id).e;
  const e = p.find(); if (!e) return null;
  if (!homes.has(id)) { const mark = document.createComment('ws-home:' + id); e.before(mark); homes.set(id, { e, mark }); }
  return e;
}
function restore() { for (const [, { e, mark }] of homes) mark.replaceWith(e); homes.clear(); }

const btn = (a, label, path) => `<button type="button" class="ws-b" data-a="${a}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
const ICON = { up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', split: 'M4 5h16v14H4zM12 5v14', col: 'M5 12h14', close: 'M6 6l12 12M18 6 6 18' };
function render() {
  if (!root) return;
  rows = rows.map((r) => r.filter((p) => PANES[p.id])).filter((r) => r.length);
  /* keep live content nodes while rebuilding the frames */
  const frag = document.createDocumentFragment(); root.querySelectorAll('.ws-body > *').forEach((n) => frag.append(n));
  root.replaceChildren();
  rows.forEach((r, ri) => {
    const row = document.createElement('div'); row.className = 'ws-row';
    r.forEach((p, pi) => {
      if (pi) { const g = document.createElement('div'); g.className = 'ws-gut'; g.setAttribute('role', 'separator'); g.setAttribute('aria-orientation', 'vertical'); g.setAttribute('aria-label', 'Resize panes'); g.tabIndex = 0; g.dataset.r = ri; g.dataset.p = pi; row.append(g); }
      const pane = document.createElement('section'); pane.className = 'ws-pane panel' + (p.c ? ' ws-col' : ''); pane.dataset.id = p.id; pane.dataset.r = ri; pane.dataset.p = pi; pane.style.flexGrow = p.w || 1;
      pane.setAttribute('aria-label', PANES[p.id].title + ' pane');
      pane.innerHTML = `<header class="ws-head"><button type="button" class="ws-grip" aria-label="Drag to reorder ${PANES[p.id].title}" title="Drag to reorder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></button><h2>${PANES[p.id].title}</h2><div class="ws-acts">${btn('up', 'Move up', ICON.up)}${btn('down', 'Move down', ICON.down)}${btn('left', 'Move left', ICON.left)}${btn('right', 'Move right', ICON.right)}${btn('split', r.length > 1 ? 'Split to own row' : 'Join row above', ICON.split)}${btn('col', p.c ? 'Expand' : 'Collapse', ICON.col)}${btn('close', 'Close pane', ICON.close)}</div></header><div class="ws-body"></div>`;
      const body = pane.querySelector('.ws-body'); const c = content(p.id);
      if (c) body.append(c); else body.innerHTML = `<p class="pf-hint">${PANES[p.id].title} is not loaded yet.</p>`;
      row.append(pane);
    });
    root.append(row);
  });
  const add = document.createElement('div'); add.className = 'ws-add';
  const open = new Set(rows.flat().map((p) => p.id)); const closed = Object.keys(PANES).filter((k) => !open.has(k));
  add.innerHTML = (closed.length ? '<span>Add pane</span>' + closed.map((k) => `<button type="button" class="ghost" data-add="${k}">+ ${PANES[k].title}</button>`).join('') : '') +
    '<span class="ws-sp"></span><button type="button" class="ghost" data-cfg="save">Save layout</button><button type="button" class="ghost" data-cfg="load">Layouts</button><button type="button" class="ghost" data-cfg="exit">Exit workspace</button>';
  root.append(add);
  [...homes.keys()].forEach((id) => { if (!open.has(id)) { const h = homes.get(id); h.mark.replaceWith(h.e); homes.delete(id); } });
  set('ws.current', rows);
}
function act(a, ri, pi) {
  const r = rows[ri], p = r[pi];
  if (a === 'left' && pi > 0) [r[pi - 1], r[pi]] = [r[pi], r[pi - 1]];
  else if (a === 'right' && pi < r.length - 1) [r[pi + 1], r[pi]] = [r[pi], r[pi + 1]];
  else if (a === 'up' || a === 'down') {
    const d = a === 'up' ? -1 : 1;
    if (r.length === 1) { const j = ri + d; if (j >= 0 && j < rows.length) [rows[j], rows[ri]] = [rows[ri], rows[j]]; }
    else { r.splice(pi, 1); rows.splice(d < 0 ? ri : ri + 1, 0, [p]); }
  } else if (a === 'split') {
    if (r.length > 1) { r.splice(pi, 1); rows.splice(ri + 1, 0, [p]); }
    else if (ri > 0) { rows.splice(ri, 1); rows[ri - 1].push(p); } else if (rows[1]) { rows.splice(ri, 1); rows[0].unshift(p); }
    else toast('Add another pane to split beside it');
  } else if (a === 'col') p.c = !p.c;
  else if (a === 'close') r.splice(pi, 1);
  render();
  const f = root.querySelector(`.ws-pane[data-id="${p.id}"] [data-a="${a}"]`); if (f) f.focus();
}
function wire() {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (b) { const pn = b.closest('.ws-pane'); act(b.dataset.a, +pn.dataset.r, +pn.dataset.p); return; }
    const ad = e.target.closest('[data-add]'); if (ad) { rows.push([{ id: ad.dataset.add, w: 1 }]); render(); return; }
    const cf = e.target.closest('[data-cfg]'); if (cf) ({ save: () => saveAs(), load: pickConfig, exit: off })[cf.dataset.cfg]();
  });
  /* desktop gutter resize */
  root.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.ws-gut'); if (g) return resizeStart(e, g);
    const grip = e.target.closest('.ws-grip'); if (grip) return dragStart(e, grip.closest('.ws-pane'));
  });
  root.addEventListener('keydown', (e) => {
    const g = e.target.closest('.ws-gut'); if (!g || !/Arrow(Left|Right)/.test(e.key)) return;
    const r = rows[+g.dataset.r], i = +g.dataset.p, d = e.key === 'ArrowLeft' ? -0.1 : 0.1;
    r[i - 1].w = Math.max(0.2, (r[i - 1].w || 1) + d); r[i].w = Math.max(0.2, (r[i].w || 1) - d); e.preventDefault(); render(); root.querySelector(`.ws-gut[data-r="${g.dataset.r}"][data-p="${i}"]`).focus();
  });
}
function resizeStart(e, g) {
  const r = rows[+g.dataset.r], i = +g.dataset.p; const a = g.previousElementSibling, b = g.nextElementSibling;
  const wa = a.getBoundingClientRect().width, wb = b.getBoundingClientRect().width, sum = (r[i - 1].w || 1) + (r[i].w || 1), x0 = e.clientX;
  g.setPointerCapture(e.pointerId); g.classList.add('on');
  const mv = (ev) => { const nwa = Math.max(80, Math.min(wa + wb - 80, wa + ev.clientX - x0)); r[i - 1].w = sum * nwa / (wa + wb); r[i].w = sum - r[i - 1].w; a.style.flexGrow = r[i - 1].w; b.style.flexGrow = r[i].w; };
  const up = () => { g.removeEventListener('pointermove', mv); g.classList.remove('on'); set('ws.current', rows); };
  g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up, { once: true }); e.preventDefault();
}
function dragStart(e, pane) {
  const id = pane.dataset.id; pane.classList.add('ws-drag'); e.target.setPointerCapture(e.pointerId); let over = null;
  const mv = (ev) => { const t = document.elementFromPoint(ev.clientX, ev.clientY); const p = t && t.closest('.ws-pane'); root.querySelectorAll('.ws-over').forEach((x) => x.classList.remove('ws-over')); over = p && p !== pane ? p : null; if (over) over.classList.add('ws-over'); };
  const up = () => {
    e.target.removeEventListener('pointermove', mv); pane.classList.remove('ws-drag'); root.querySelectorAll('.ws-over').forEach((x) => x.classList.remove('ws-over'));
    if (!over) return; const tr = +over.dataset.r; const src = rows[+pane.dataset.r]; const p = src.splice(+pane.dataset.p, 1)[0];
    const target = rows[tr]; const below = +pane.dataset.r < tr || (+pane.dataset.r === tr && +pane.dataset.p < +over.dataset.p);
    rows.splice(src.length ? (below ? tr + 1 : tr) : (below ? tr : tr), 0, [p]); if (!src.length) rows = rows.filter((x) => x.length); void target; render();
  };
  e.target.addEventListener('pointermove', mv); e.target.addEventListener('pointerup', up, { once: true }); e.preventDefault();
}

function on(layout) {
  if (!root) { root = document.createElement('div'); root.id = 'workspace'; root.className = 'ws'; root.setAttribute('aria-label', 'Workspace'); $('.stage').after(root); wire(); }
  rows = clone(layout || get('ws.current', null) || DEFAULTS['Full studio'].rows);
  active = true; document.body.classList.add('ws-on'); set('ws.on', true); render(); syncBtn();
}
function off() { if (!active) return; restore(); root.replaceChildren(); active = false; document.body.classList.remove('ws-on'); set('ws.on', false); syncBtn(); window.dispatchEvent(new Event('resize')); }
const configs = () => ({ ...clone(DEFAULTS), ...get('ws.configs', {}) });
async function saveAs(name) {
  if (!active) on();
  if (!name) name = await sc.ui.ask({ title: 'Save layout', label: 'Layout name', value: get('ws.last', ''), okText: 'Save' }); if (!name) return;
  const key = await sc.ui.ask({ title: 'Hotkey (optional)', label: 'e.g. Alt+5, leave empty for none', value: (configs()[name] || {}).key || '', okText: 'Save' });
  const all = get('ws.configs', {}); all[name] = { rows: clone(rows), key: key && /^((ctrl|alt|shift)\+)+\S$/i.test(key.trim()) ? key.trim() : '' }; set('ws.configs', all); set('ws.last', name);
  if (sc.history && sc.history.commit) try { sc.history.commit('Workspace: ' + name); } catch (e) { /* auto-commit covers it */ }
  regConfigs(); toast('Saved layout ' + name, { kind: 'ok' });
}
function load(name) { const c = configs()[name]; if (!c) { toast('No layout ' + name, { kind: 'error' }); return; } if (active) restore(); on(c.rows); set('ws.last', name); toast('Layout: ' + name); }
function pickConfig() { if (sc.palette) sc.palette.open('Layout '); }
let unreg = [];
function regConfigs() {
  unreg.forEach((f) => f()); unreg = []; if (!sc.palette) return;
  for (const [n, c] of Object.entries(configs())) unreg.push(sc.palette.register({ id: 'ws.cfg.' + n, group: 'Layout', title: n, keys: c.key || '', run: () => load(n) }));
}
function syncBtn() { const b = $('#wsBtn'); if (b) b.setAttribute('aria-pressed', String(active)); }
function init() {
  const tools = $('#tools');
  if (tools && !$('#wsBtn')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'icon'; b.id = 'wsBtn'; b.title = 'Workspace (W)'; b.setAttribute('aria-label', 'Toggle workspace'); b.setAttribute('aria-pressed', 'false'); b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 11h16M12 11v8"/></svg>'; b.onclick = () => (active ? off() : on()); tools.prepend(b); }
  if (sc.palette) {
    sc.palette.register({ id: 'ws.toggle', group: 'Workspace', title: 'Toggle workspace', run: () => (active ? off() : on()) });
    sc.palette.register({ id: 'ws.save', group: 'Workspace', title: 'Save layout as', run: () => saveAs() });
    for (const k of Object.keys(PANES)) sc.palette.register({ id: 'ws.add.' + k, group: 'Pane', title: 'Show ' + PANES[k].title, run: () => { if (!active) on(); if (!rows.flat().some((p) => p.id === k)) rows.push([{ id: k, w: 1 }]); render(); } });
    regConfigs();
  }
  document.addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
    for (const [n, c] of Object.entries(configs())) { if (!c.key) continue; const k = c.key.toLowerCase().split('+'); const key = k.pop();
      if (e.key.toLowerCase() === key && (e.ctrlKey || e.metaKey) === k.includes('ctrl') && e.altKey === k.includes('alt') && e.shiftKey === k.includes('shift')) { e.preventDefault(); load(n); return; }
      if (e.code === 'Digit' + key && e.altKey && k.includes('alt') && !e.ctrlKey) { e.preventDefault(); load(n); return; } }
    if (e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); active ? off() : on(); }
  });
  if (get('ws.on', false)) setTimeout(() => on(), 400); /* let the panels build first */
}
sc.workspace = { on, off, apply: (l) => { if (active) restore(); on(l); }, layout: () => clone(rows), save: saveAs, load, configs, panes: PANES, get active() { return active; } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
