/* Command palette. Chord (default Ctrl+K, configurable in sc.palette.chord) opens a toast-style menu of actions.
   Typing filters (verbatim prefix first, then fuzzy subsequence); arrows/Enter or digits 1-9 pick. On phones a floating
   button opens the same menu. API: window.strudelCraft.palette = { register({id, title, group, keys, run}) -> unregister,
   open(), close(), list(), filter(q) } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const items = new Map();
const get = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function score(q, text) {
  q = q.toLowerCase().trim(); const t = text.toLowerCase(); if (!q) return 1;
  if (t.startsWith(q)) return 1000 - t.length;
  const wi = t.split(/[\s:/-]+/).findIndex((w) => w.startsWith(q)); if (wi >= 0) return 800 - wi;
  const at = t.indexOf(q); if (at >= 0) return 600 - at;
  let i = 0, s = 0, run = 0; for (const ch of t) { if (ch === q[i]) { i++; run++; s += run; } else run = 0; if (i === q.length) break; }
  return i === q.length ? 100 + s : -1;
}
export function filter(q) {
  return [...items.values()].map((it) => ({ it, s: score(q, (it.group ? it.group + ' ' : '') + it.title) }))
    .filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.it);
}
function register(it) { if (!it || !it.id || !it.run) throw new Error('palette.register needs {id, title, run}'); items.set(it.id, { title: it.id, ...it }); return () => items.delete(it.id); }

let box = null, input, listEl, shown = [], sel = 0, prevFocus = null;
function build() {
  box = document.createElement('div'); box.className = 'pal'; box.id = 'palette'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Command palette');
  box.innerHTML = '<div class="pal-in"><label class="sr" for="palQ">Filter commands</label><input id="palQ" type="search" autocomplete="off" spellcheck="false" placeholder="Type to filter, 1-9 to pick" role="combobox" aria-controls="palList" aria-expanded="true"><kbd aria-hidden="true">Esc</kbd></div><ol class="pal-list" id="palList" role="listbox"></ol>';
  document.body.append(box);
  input = box.querySelector('input'); listEl = box.querySelector('ol');
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (/^[1-9]$/.test(e.key) && !/\d/.test(input.value)) { e.preventDefault(); pick(+e.key - 1); }
  });
  listEl.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(+li.dataset.i); });
  document.addEventListener('pointerdown', (e) => { if (!box.hidden && !box.contains(e.target) && !e.target.closest('#palFab')) close(); });
  const fab = document.createElement('button'); fab.type = 'button'; fab.id = 'palFab'; fab.className = 'pal-fab'; fab.setAttribute('aria-label', 'Open command palette');
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h13"/></svg>';
  fab.addEventListener('click', () => (box.hidden ? open() : close()));
  document.body.append(fab);
}
function render() {
  shown = filter(input.value).slice(0, 30);
  listEl.innerHTML = shown.length ? shown.map((it, i) => `<li role="option" data-i="${i}" id="pal${i}" aria-selected="${i === sel}"${i === sel ? ' class="on"' : ''}><span class="pal-n">${i < 9 ? i + 1 : ''}</span><span class="pal-t">${it.group ? `<i>${esc(it.group)}</i>` : ''}${esc(it.title)}</span>${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : ''}</li>`).join('') : '<li class="pal-empty">No match</li>';
  input.setAttribute('aria-activedescendant', shown.length ? 'pal' + sel : '');
  const on = listEl.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function pick(i) { const it = shown[i]; if (!it) return; close(); try { it.run(); } catch (e) { sc.ui && sc.ui.toast('Command failed: ' + e.message, { kind: 'error' }); } }
function open(q = '') { if (!box) build(); prevFocus = document.activeElement; box.hidden = false; input.value = q; sel = 0; render(); input.focus(); }
function close() { if (!box || box.hidden) return; box.hidden = true; if (prevFocus && prevFocus.focus) prevFocus.focus(); }

/* chord: "Ctrl+K" by default; any "Mod+Key" string */
function chordMatch(e) {
  const c = String(get('palette.chord', 'Ctrl+K')).toLowerCase().split('+'); const key = c.pop();
  const mods = { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey };
  return e.key.toLowerCase() === key && ['ctrl', 'alt', 'shift'].every((m) => c.includes(m) === mods[m] || (m === 'shift' && !c.includes('shift')));
}
document.addEventListener('keydown', (e) => { if (chordMatch(e)) { e.preventDefault(); e.stopPropagation(); box && !box.hidden ? close() : open(); } }, true);

register({ id: 'palette.chord', group: 'Settings', title: 'Set palette chord', run: async () => {
  const v = sc.ui && (await sc.ui.ask({ title: 'Palette chord', label: 'Shortcut, e.g. Ctrl+K or Alt+P', value: get('palette.chord', 'Ctrl+K'), okText: 'Save' }));
  if (v && /^((ctrl|alt|shift)\+)+\S$/i.test(v.trim())) { set('palette.chord', v.trim()); sc.ui.toast('Palette chord: ' + v.trim(), { kind: 'ok' }); } else if (v) sc.ui.toast('Use Mod+Key, e.g. Ctrl+K', { kind: 'error' });
} });
const nav = (v, n) => register({ id: 'view.' + v, group: 'View', title: n, run: () => { location.hash = '#' + v; } });
[['rack', 'Rack'], ['stack', 'Stack'], ['ref', 'Reference'], ['practice', 'Practice'], ['perform', 'Perform'], ['syntax', 'Syntax'], ['graph', 'Graph']].forEach(([v, n]) => nav(v, n));
register({ id: 'transport.toggle', group: 'Transport', title: 'Play / stop', keys: 'Space', run: () => document.getElementById('playBtn').click() });
register({ id: 'ui.theme', group: 'View', title: 'Toggle theme', keys: 'T', run: () => document.getElementById('themeBtn').click() });
register({ id: 'packs.sheet', group: 'Packs', title: 'Packs, licences and credits', run: () => import('./packs-ui.js').then((m) => m.open()) }); /* #67: sheet loads on first use */
register({ id: 'ui.help', group: 'View', title: 'Shortcuts and progress', keys: '?', run: () => document.getElementById('helpBtn').click() });

sc.palette = { register, open, close, list: () => [...items.values()], filter, score };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
