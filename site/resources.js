/* Resources (docs/RESOURCES.md): the references the program uses, resolved live, and everything installed that you can reference. Tiny lazy entry:
   it only registers the entry points; resources-ui.js (panel), engine/resources.js (the model, shared with `strudel refs`) and resources.css load on first open.
   Entry points: a Resources button in the editor heads (Rack code, Stack program), Ctrl+K > "Show resources" (sheet) and "Show Resources pane" (workspace
   pane, desktop side panel), the workspace pane `resources`, and the deep link #res=<id> (e.g. #res=atom:ph.kick, #res=available:cowbell). */
import { whenHas } from './packs-kinds.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const ui = () => import('./resources-ui.js');
sc.resources = Object.assign(sc.resources || {}, { openSheet: (o) => ui().then((m) => m.openSheet(o)), openLink: (h) => ui().then((m) => m.openLink(h)), mount: (el) => ui().then((m) => m.mount(el)) });

whenHas(() => sc.palette).then((pal) => {
  if (!pal) return;
  pal.register({ id: 'resources.open', group: 'Resources', title: 'Show resources (what this program uses, and what is available)', run: () => sc.resources.openSheet() });
  pal.register({ id: 'resources.available', group: 'Resources', title: 'Browse available resources (packs, atoms, racks, banks)', run: () => sc.resources.openSheet({ tab: 'available' }) });
  pal.register({ id: 'resources.pane', group: 'Pane', title: 'Show Resources pane', run: () => { const w = sc.workspace; if (!w) return sc.resources.openSheet(); if (!w.active) w.on(); const l = w.layout(); if (!l.flat().some((p) => p.id === 'resources')) w.apply([...l, [{ id: 'resources', w: 1 }]]); } });
});
whenHas(() => sc.workspace && sc.workspace.panes).then((P) => {
  if (!P || P.resources) return; let el = null;
  P.resources = { title: 'Resources', make: () => { if (el) return el; el = document.createElement('div'); el.className = 'rs-pane'; el.innerHTML = '<p class="pf-hint">Loading resources…</p>'; ui().then((m) => m.mount(el)).then(() => { const h = el.querySelector('.pf-hint'); if (h) h.remove(); }); return el; } };
});
/* the Resources button in the editor heads: a plain button that opens the sheet (never touches the editor) */
function buttons() {
  for (const id of ['code', 'stackCode']) {
    const head = document.getElementById(id) && document.getElementById(id).closest('.panel') && document.getElementById(id).closest('.panel').querySelector('.panel-head .acts, .panel-head'); if (!head || head.querySelector('.rs-open')) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost rs-open'; b.textContent = 'Resources'; b.title = 'Every reference this program uses, and what is available to add';
    b.setAttribute('aria-haspopup', 'dialog'); b.addEventListener('click', () => sc.resources.openSheet()); head.append(b);
  }
}
whenHas(() => document.getElementById('code')).then((c) => { if (c) buttons(); });
