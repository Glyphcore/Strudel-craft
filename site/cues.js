/* CraftCues (docs/CRAFTCUES.md; #163): score annotations on the site. Tiny lazy entry: it only registers the entry points and a cheap watcher;
   cues-ui.js (strip, Score sheet, KB card), cues.css, engine/cues.js and engine/cues-kb.js load when a playing program carries cues
   (inline //@ comments, a shipped sidecar in data/cues/index.json, or cues saved in this browser) or when the Score sheet opens.
   Entry points: Ctrl+K > "Show score cues", "Add cue at the current bar", "Captions on / off"; the deep link #cues; a Score button in the editor heads;
   quick play (#150) emits qp:play / qp:stop, and an audition whose code carries //@ cues shows the strip on the audition clock. */
import { whenHas } from './packs-kinds.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
let mod = null; const ui = () => (mod = mod || import('./cues-ui.js'));
sc.cues = Object.assign(sc.cues || {}, { openScore: (o) => ui().then((m) => m.openScore(o)), addAtBar: () => ui().then((m) => m.addAtBar()), toggle: () => ui().then((m) => m.toggleCaptions()), attach: (o) => ui().then((m) => m.attach(o)), ui });
const lsHas = () => { try { for (let i = 0; i < localStorage.length; i++) if (/^sc\.cues\./.test(localStorage.key(i))) return true; } catch (e) { /* private */ } return false; };
whenHas(() => sc.palette).then((pal) => {
  if (!pal) return;
  pal.register({ id: 'cues.score', group: 'Cues', title: 'Show score cues (sections, layers, concepts by bar)', run: () => sc.cues.openScore() });
  pal.register({ id: 'cues.add', group: 'Cues', title: 'Add cue at the current bar', run: () => sc.cues.addAtBar() });
  pal.register({ id: 'cues.captions', group: 'Cues', title: 'Captions on / off (score cues while playing)', run: () => sc.cues.toggle() });
});
/* the watcher: while the transport plays, a program with cues gets the strip (one string test per 600 ms; nothing loads for programs without cues) */
let index = null; const idx = () => (index = index || fetch(new URL('data/cues/index.json', document.baseURI)).then((r) => (r.ok ? r.json() : { sets: [] })).catch(() => ({ sets: [] })));
let last = '';
setInterval(async () => {
  const T = sc.transport; if (!T || !T.playing || mod) return; let s = null; try { s = T.source && T.source(); } catch (e) { return; } if (!s || !s.code) return;
  const head = s.code.slice(0, 200); if (head === last) return; last = head;
  if (/\/\/@|\/\*@/.test(s.code) || lsHas()) { sc.cues.attach(); return; }
  const ix = await idx(); if ((ix.sets || []).some((x) => (x.recipe && x.recipe === s.id) || (x.first && s.code.startsWith(x.first)))) sc.cues.attach();
}, 600);
window.addEventListener('qp:play', (e) => { const d = e.detail || {}; if (d.code && /\/\/@|\/\*@/.test(d.code)) ui().then((m) => m.attachQuick(d)); });
function buttons() {
  for (const id of ['code', 'stackCode']) {
    const el = document.getElementById(id); const head = el && el.closest('.panel') && el.closest('.panel').querySelector('.panel-head .acts, .panel-head'); if (!head || head.querySelector('.cu-score-open')) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost cu-score-open'; b.textContent = 'Score'; b.title = 'Score cues: sections, layer roles, concepts by bar (CraftCues)';
    b.setAttribute('aria-haspopup', 'dialog'); b.addEventListener('click', () => sc.cues.openScore()); head.append(b);
  }
}
whenHas(() => document.getElementById('code')).then((c) => { if (c) buttons(); });
/* intellisense inside //@ comments: kinds after the time, @scopes (lanes of the program), KB ids / relations / meta after "|" (engine/cues.js completeCue; the
   composer catalog ids come from data/composition.json, fetched on the first //@ completion only) */
let ids = null; const kbIds = () => (ids = ids || Promise.all(['data/composition.json', 'data/syntax.json'].map((u) => fetch(new URL(u, document.baseURI)).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
  .then(([c, s]) => [...((c && c.sections) || []).map((x) => ({ id: String(x.id).toUpperCase(), title: x.title })), ...((s && s.sections) || []).map((x) => ({ id: 'syntax:' + x.id, title: x.title }))]));
whenHas(() => sc.intellisense && sc.intellisense.registerSource && sc.intellisense).then((is) => {
  if (!is) return;
  is.registerSource({ id: 'craftcues', async complete(ctx) {
    const line = String(ctx.text || '').split('\n').pop(); if (!/\/\/@/.test(line)) return null;
    const E = await import('./engine/cues.js'); const doc = String(ctx.doc || ctx.text || '');
    const lanes = [...new Set(doc.split('\n').map((l) => (/^\s*([A-Za-z_$][\w$]*)\s*:\s*\S/.exec(l) || [])[1]).filter(Boolean))];
    const r = E.completeCue(line, { lanes, ids: /\|/.test(line) ? await kbIds() : [], sections: (E.programHeader(doc).sections || []).map((s) => s.name) }); if (!r || !r.options.length) return null;
    return { from: ctx.pos - (line.length - r.from), options: r.options.map((o) => ({ label: o.label, detail: o.detail, type: 'keyword' })), validFor: /^[^\s|]*$/ };
  } });
});
