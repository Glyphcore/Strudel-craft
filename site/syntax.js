/* Syntax view (key 6): teaches the new paradigms from data/syntax.json (sourced from docs/HOOKS_SYNTAX.md and docs/BLUEPRINT.md) and lists the
   composition concepts from data/composition.json (docs/COMPOSITION.md; a second syntax@1 ingredient, folder composition/<family>).
   One tap on an example loads it into the Rack editor and plays it. Paradigms whose engine is not present are marked "coming".
   Every example is also an intellisense snippet (provider "syntax"). */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = () => window.Pattern && window.Pattern.prototype;
/* feature detection: built if the engine is loaded (some only after the first Play, when Strudel's globals exist) */
const HAS = {
  hooks: () => !!(sc.hooks && sc.hooks.bind && P() && P().use) || (!!sc.hooksLib && !window.Pattern),
  taps: () => !!(sc.hooks && sc.hooks.let && P() && P().tap && P().wire) || (!!sc.hooksLib && !window.Pattern),
  lanes: () => !!(sc.lanes && sc.lanes.closed && P() && P().tags) || (!!sc.lanesLib && !window.Pattern),
  controls: () => !!(sc.controls && sc.controls.create),
  visuals: () => !!sc.visuals,
  perform: () => !!(sc.controls && sc.pads),
  library: () => !!(sc.hooks && sc.hooks.inst),
  word: () => typeof window.word === 'function' || !window.Pattern,
  ghost: () => !!(sc.intellisense && sc.intellisense.registerInline),
  workspace: () => !!(sc.palette && sc.workspace && sc.range),
  capture: () => !!sc.capture,
  copycode: () => !!sc.copycode,
  core: () => true,
};
/* Syntax data comes through the pack loader (glyphcore/shim: data/syntax.json, hash-pinned). If it cannot load (a pin that does not match,
   offline with nothing cached), the view says so with the error code, offers Retry, and shows these bundled core examples instead of an empty pane. */
const FALLBACK = [{ id: 'core', title: 'Core (bundled)', needs: 'core', explain: 'Plain Strudel that works without any pack: the full Syntax examples come back when the syntax data loads.', examples: [
  { title: 'Drum loop', code: 's("bd*4, ~ sd, hh*8").bank("RolandTR909")' },
  { title: 'Bass line', code: 'note("c2 c2 eb2 g1").s("sawtooth").lpf(600).decay(.2)' },
  { title: 'Chords with reverb', code: 'note("<[c3,eb3,g3] [ab2,c3,eb3]>").s("supersaw").room(.5).gain(.6)' },
  { title: 'Two layers', code: '$: s("bd*2, hh*4")\n$: note("c3 e3 g3 b3").s("triangle").delay(.25)' },
] }];
const load = (again) => (again && window.strudelCraft.packs.retry ? window.strudelCraft.packs.retry('syntax') : window.strudelCraft.packs.syntax()).then((d) => { if (!d || !Array.isArray(d.sections) || !d.sections.length) { const f = window.strudelCraft.packs.failure && window.strudelCraft.packs.failure('syntax'); throw f ? Object.assign(new Error(`${f.ingredient} ${f.state}: ${f.message || ''}`), { code: f.code }) : Object.assign(new Error('the syntax data has no sections'), { code: 'E_SYNTAX_EMPTY' }); } return d; })
  .catch((e) => { const msg = `${(e && e.code) || 'E_SYNTAX_LOAD'}: ${(e && e.message) || e}`; console.warn('syntax: ' + msg); return { sections: FALLBACK, error: msg }; });
let data = load();

/* intellisense snippets */
function registerSnippets() {
  if (!sc.intellisense || !sc.intellisense.register) return false;
  sc.intellisense.register({ id: 'syntax', items: async () => (await data).sections.flatMap((s) => (s.examples || []).filter((e) => e.code && !e.coming).map((e) => ({
    label: e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), category: 'syntax examples', detail: s.title, info: e.code, apply: e.code }))) });
  return true;
}
if (!registerSnippets()) { const iv = setInterval(() => { if (registerSnippets()) clearInterval(iv); }, 300); setTimeout(() => clearInterval(iv), 15000); }

/* ---- navigation at 132+ sections (#149): the #120 organizer (folder tree, tag chips) plus a sticky search, collapsed families, jump strip,
   Pinned / Recent (local), lazy section bodies and the deep link #syntax=<id> (the old #sx-<id> and the element ids sx-<id> / sxh-<id> still work) ---- */
let sxOrg = null, sxHost = null, sxMod = null; let sxSecs = [], sxData = null, sxQuery = '';
const NAVKEY = 'sc.syntax.nav';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };
const NAV = (() => { const s = lsGet(NAVKEY, {}); return { open: new Set(s.open || []), pins: Array.isArray(s.pins) ? s.pins : [], recent: Array.isArray(s.recent) ? s.recent : [] }; })();
const navSave = () => lsSet(NAVKEY, { open: [...NAV.open], pins: NAV.pins, recent: NAV.recent });
const secOpen = new Set(); /* sections whose body is shown right now (not persisted) */
/* a section is an entry in syntax/<needs> (or its own folder + tags: the Composition concepts, data/composition.json: composition/<family>, #120 tags) */
const sxEntries = (d) => (d.sections || []).map((s) => { const need = String(s.needs || 'core').toLowerCase().replace(/[^a-z0-9]+/g, '-'), st = (HAS[s.needs] || (() => false))() ? 'built' : 'coming';
  return { id: s.id, kind: 'syntax', title: s.title, pack: s.pack || 'glyphcore/shim', folder: s.folder || 'syntax/' + need, tags: s.tags ? [...s.tags, st] : ['syntax', need, st], hay: [s.title, s.id, s.folder || need, (s.tags || []).join(' '), s.explain || ''].join(' ').toLowerCase() }; });
const groupOf = (e) => e.folder.split('/').slice(0, 2).join('/');
const groupTitle = (g) => { const [a, b] = g.split('/'); return b ? `${a[0].toUpperCase() + a.slice(1)} / ${b.replace(/-/g, ' ')}` : g; };
/* concept notes (why it works, when, measure, anti-patterns): a definition list under the section text */
const notesHtml = (n) => (Array.isArray(n) && n.length ? `<dl class="sx-notes">${n.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${Array.isArray(v) ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(v)}</dd>`).join('')}</dl>` : '');
/* Quick play (quickplay.js): audition in place, never a jump. Disabled with the reason when the example cannot stand alone. */
const qpWhy = (e) => /\bstrudelCraft\./.test(e.code || '') ? 'A page-API script: it changes your settings or panels, so it is not played as an audition' : e.action ? 'Opens another view: nothing to audition here' : e.noplay ? 'A fragment: it needs the surrounding program, so it cannot play alone' : (/(?<![.\w$])(?:tap|wire)\s*\(/.test(e.code || '') && !/\.tap\s*\(|\bhooks\.let\s*\(/.test(e.code || '')) ? 'Reads a tap that your program or the Perform pads publish: it needs them' : '';
const firstPlayable = (s) => (s.examples || []).findIndex((e) => e.code && !e.coming && !qpWhy(e));
const hdrQp = (s, built) => { const i = built ? firstPlayable(s) : -1; if (i < 0) return ''; return qpBtn(s.id, i, s.examples[i]).replace('data-qp="syntax:' + s.id + ':' + i + '"', 'data-qp="syntax:' + s.id + ':' + i + '" data-hdr="1"'); };
const qpBtn = (sid, i, e) => { const why = e.code ? qpWhy(e) : 'No code to play'; return `<button type="button" class="qp" data-qp="syntax:${sid}:${i}" data-title="${esc(e.title)}" aria-pressed="false" aria-label="Quick play ${esc(e.title)}"${why ? ` aria-disabled="true" data-why="${esc(why)}" title="${esc(why)}"` : ' title="Quick play: audition here, nothing is loaded or opened"'}><i class="qp-i" aria-hidden="true"></i></button>`; };
/* the code of an example in the form that is open (Craft, or the Strudel tab); a form without code gives the reason */
function qpSpec(s, i, fig) { const ex = s.examples[i]; const fm = fig && fig.querySelector('.fm'); let code = ex.code;
  if (fm && fm.dataset.form) { code = fm.dataset.code; if (!code) return { why: `No plain Strudel form for "${ex.title}" (${ex.lowered_note || 'Craft runtime only'}): switch to the Craft tab to play it` }; }
  return { key: `syntax:${s.id}:${i}`, title: ex.title, code }; }
const bodyHtml = (s, built) => `<p>${esc(s.explain)}</p>${notesHtml(s.notes)}
    ${(s.examples || []).map((e, i) => { const coming = e.coming || !built; return `<figure class="sx-ex">
      ${e.code ? `<div class="sx-fm" data-sec="${s.id}" data-i="${i}"></div>` : ''}
      ${e.flow ? `<ol class="sx-flow" aria-label="Signal flow">${e.flow.map((f) => `<li><b>${esc(f[0])}</b><span>${esc(f[1])}</span></li>`).join('')}</ol>` : ''}
      ${e.explain ? `<p class="sx-exnote">${esc(e.explain)}</p>` : ''}
      <figcaption><span>${esc(e.title)}</span>${coming ? '<span class="sx-badge" data-built="false">coming</span>' : `${qpBtn(s.id, i, e)}<button type="button" class="sx-run" data-sec="${s.id}" data-i="${i}">${e.action ? 'Open' : e.noplay ? 'Load' : 'Load and play'}</button>`}</figcaption></figure>`; }).join('')}`;
/* both forms of every example: Craft (as authored) and Strudel (generated lowering, or the reason there is none); site/forms.js */
function hydrate(el, s) { const F = sc.forms;
  el.querySelectorAll('.sx-fm').forEach((h) => { const ex = s.examples[+h.dataset.i];
    if (!F) { h.innerHTML = `<pre><code>${esc(ex.code)}</code></pre>`; return; }
    h.replaceWith(F.render({ craft: ex.code, lowered: ex.lowered, lowered_note: ex.lowered_note, lowered_check: ex.lowered_check }, { insert: (code, which) => {
      window.__sc.setView('rack'); const ta = document.getElementById('code'); ta.value = code; ta.dispatchEvent(new Event('input'));
      sc.ui && sc.ui.toast(`Inserted the ${which === 'craft' ? 'Craft' : 'Strudel'} form of "${ex.title}" into the Rack editor. Revert restores the recipe.`, { kind: 'ok' }); } })); }); }
const builtOf = (s) => (HAS[s.needs] || (() => false))();
function fillBody(secEl) { const body = secEl.querySelector('.sx-body'); if (body.dataset.ready) return; const s = sxData.sections.find((x) => x.id === secEl.id.slice(3)); body.innerHTML = bodyHtml(s, builtOf(s)); hydrate(body, s); body.dataset.ready = '1'; }
function setSec(secEl, open) { const b = secEl.querySelector('.sx-head'), body = secEl.querySelector('.sx-body'); const id = secEl.id.slice(3);
  if (open) { fillBody(secEl); secOpen.add(id); } else secOpen.delete(id);
  body.hidden = !open; b.setAttribute('aria-expanded', String(open)); secEl.dataset.open = open ? '1' : '0'; }
function setHash(id) { const h = id ? '#syntax=' + id : '#syntax'; if (location.hash !== h) history.replaceState(null, '', h); }
const groupEl = (g) => document.querySelector(`#syntax .sx-grp[data-g="${CSS.escape(g)}"]`);
function showGroup(g, open, persist = true) { const el = groupEl(g); if (!el) return; if (persist) { open ? NAV.open.add(g) : NAV.open.delete(g); navSave(); } sxApply(); }
function chips(list, label) { return list.length ? `<span class="sx-lab">${label}</span>${list.map((id) => { const e = sxSecs.find((x) => x.id === id); return e ? `<button type="button" class="sx-go" data-go="${esc(id)}">${esc(e.title)}</button>` : ''; }).join('')}` : ''; }
function paintLists() { const root = $('#syntax'); if (!root) return; const p = root.querySelector('.sx-pinned'), r = root.querySelector('.sx-recent');
  p.innerHTML = chips(NAV.pins, 'Pinned'); p.hidden = !NAV.pins.length; r.innerHTML = chips(NAV.recent.filter((x) => !NAV.pins.includes(x)).slice(0, 6), 'Recent'); r.hidden = !r.innerHTML;
  root.querySelectorAll('.sx-pin').forEach((b) => { const on = NAV.pins.includes(b.dataset.pin); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', (on ? 'Unpin ' : 'Pin ') + b.dataset.title); }); }
/* jump to a section: open its family, clear what hides it, open the body, scroll to it, remember it */
function go(id, o = {}) { const root = $('#syntax'); if (!root || !sxData) return false; const e = sxSecs.find((x) => x.id === id); if (!e) return false;
  if (sxQuery) { sxQuery = ''; const q = root.querySelector('.sx-search'); if (q) q.value = ''; }
  if (sxOrg && !sxOrg.pass(sc.taxonomyOverlay ? sc.taxonomyOverlay(e) : e)) sxOrg.set({ folder: '', tags: [] });
  NAV.open.add(groupOf(e)); NAV.recent = [id, ...NAV.recent.filter((x) => x !== id)].slice(0, 8); navSave(); sxApply();
  const el = document.getElementById('sx-' + id); setSec(el, true); paintLists(); setHash(id);
  el.scrollIntoView({ block: 'start', behavior: 'auto' }); if (o.focus) el.querySelector('.sx-head').focus({ preventScroll: true }); return true; }
function hashGo() { const m = /^#(?:syntax=|sx-)([\w.-]+)$/.exec(decodeURIComponent(location.hash)); if (m && sxData) go(m[1]); }
function sxApply() { const root = $('#syntax'); if (!root || !sxData) return; const O = sc.taxonomyOverlay || ((e) => e);
  const keep = new Set((sxOrg ? sxOrg.sort(sxSecs.map((e) => O(e))).filter((e) => sxOrg.pass(e)) : sxSecs).map((e) => e.id)); const toks = sxQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = !!toks.length || !!(sxOrg && (sxOrg.state.folder || sxOrg.state.tags.length)); let shown = 0; const per = {};
  for (const e of sxSecs) { const ok = keep.has(e.id) && toks.every((t) => e.hay.includes(t)); const el = document.getElementById('sx-' + e.id); if (el.hidden === ok) el.hidden = !ok; if (ok) { shown++; per[groupOf(e)] = (per[groupOf(e)] || 0) + 1; } }
  root.querySelectorAll('.sx-grp').forEach((g) => { const k = g.dataset.g, n = per[k] || 0, open = n > 0 && (filtering || NAV.open.has(k)); g.hidden = !n; const h = g.querySelector('.sx-ghead'); h.setAttribute('aria-expanded', String(open)); g.querySelector('.sx-gbody').hidden = !open;
    g.querySelector('.sx-gn').textContent = filtering ? `${n} / ${g.dataset.total}` : g.dataset.total; if (open && !g.dataset.painted) paintGroup(g); });
  root.querySelectorAll('.sx-jump a').forEach((a) => { a.hidden = !per[a.dataset.g]; });
  root.querySelector('.sx-count').textContent = `${shown} / ${sxSecs.length} sections${filtering ? ' match' : ''}`; root.querySelector('.sx-clear').hidden = !sxQuery; }
/* tag-driven appearance (#120): the group and its rows take the folder / entry style (pack taxonomy defaults, the user's overrides on top) */
function paintGroup(g) { if (!sxOrg || !sxMod) return; g.dataset.painted = '1'; const st = sxOrg.folderStyle(g.dataset.g); const a = sxMod.styleAttrs(st); g.setAttribute('style', a.style); g.dataset.pattern = a.pattern; const ic = g.querySelector('.sx-gico'); ic.replaceChildren(sxMod.ico(st));
  g.querySelectorAll('.sx-sec').forEach((el) => { const e = sxSecs.find((x) => x.id === el.id.slice(3)); if (e) el.setAttribute('style', sxMod.styleAttrs(sxOrg.entryStyle(sc.taxonomyOverlay ? sc.taxonomyOverlay(e) : e)).style); }); }
function structure(d) {
  const groups = []; const by = {}; for (const e of sxSecs) { const g = groupOf(e); if (!by[g]) groups.push(by[g] = { g, items: [] }); by[g].items.push(e); }
  const sec = (e) => { const s = d.sections.find((x) => x.id === e.id), built = builtOf(s);
    return `<section class="sx-sec" id="sx-${e.id}" aria-labelledby="sxh-${e.id}" data-open="0"><h3 id="sxh-${e.id}"><button type="button" class="sx-head" aria-expanded="false" aria-controls="sxb-${e.id}"><span class="sx-title">${esc(s.title)}</span> <span class="sx-badge" data-built="${built}">${built ? 'built' : 'coming'}</span></button>
      ${hdrQp(s, built)}<button type="button" class="sx-pin" data-pin="${e.id}" data-title="${esc(s.title)}" aria-pressed="false" aria-label="Pin ${esc(s.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8v2l-2 2v5l3 3v2h-4v5h-2v-5H7v-2l3-3V7L8 5z"/></svg></button></h3><div class="sx-body" id="sxb-${e.id}" hidden></div></section>`; };
  return `<nav class="sx-jump" data-keys="own" aria-label="Jump to a family">${groups.map((x) => `<a href="#syntax" data-g="${x.g}">${esc(groupTitle(x.g))} <b>${x.items.length}</b></a>`).join('')}</nav>`
    + `\u0000` + `<div class="sx-lists"><div class="sx-pinned sx-chips" hidden></div><div class="sx-recent sx-chips" hidden></div></div><div class="sx-groups" data-keys="own">${groups.map((x) => `<section class="sx-grp" data-g="${x.g}" data-total="${x.items.length}" aria-label="${esc(groupTitle(x.g))}"><h2 class="sx-gh"><button type="button" class="sx-ghead" data-g="${x.g}" aria-expanded="false"><span class="sx-gico" aria-hidden="true"></span><span class="sx-gt">${esc(groupTitle(x.g))}</span><span class="sx-gn">${x.items.length}</span><i class="sx-chev" aria-hidden="true"></i></button></h2><div class="sx-gbody" hidden>${x.items.map(sec).join('')}</div></section>`).join('')}</div>`; }
async function render(force) {
  const root = $('#syntax'); if (!root) return; const d = await data; sxData = d; sxSecs = sxEntries(d);
  if (root.querySelector('.sx-groups') && !force && !d.error === !root.querySelector('.sx-error')) { root.querySelectorAll('.sx-sec').forEach((el) => { const s = d.sections.find((x) => x.id === el.id.slice(3)), b = builtOf(s), bd = el.querySelector('.sx-badge'); if (bd && bd.dataset.built !== String(b)) { bd.dataset.built = String(b); bd.textContent = b ? 'built' : 'coming'; const body = el.querySelector('.sx-body'); if (body.dataset.ready) { delete body.dataset.ready; if (!body.hidden) fillBody(el); } } }); return; }
  const parts = structure(d).split('\u0000');
  root.innerHTML = `<div class="panel-head"><h2>Syntax</h2><span class="sx-sub">New paradigms and composition concepts, each with runnable examples</span></div>
  ${d.error ? `<div class="sx-error" role="alert"><p><b>Syntax examples could not load.</b> ${esc(d.error)}. Showing the bundled core examples.</p><button type="button" class="sx-retry">Retry</button></div>` : ''}
  <div class="sx-bar"><div class="sx-find"><input type="search" class="sx-search" placeholder="Search ${sxSecs.length} sections (title, tag, text)" aria-label="Search the Syntax sections" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button type="button" class="sx-clear ghost" hidden aria-label="Clear search">Clear</button></div>
  <p class="count-line sx-count" role="status" aria-live="polite"></p>${parts[0]}</div><div class="org-host sx-orghost"></div>${parts[1]}`;
  sxHost = root.querySelector('.sx-orghost');
  const q = root.querySelector('.sx-search'); let tm = 0; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { sxQuery = q.value.trim(); sxApply(); }, 120); });
  q.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { q.value = ''; sxQuery = ''; sxApply(); } });
  if (!sxMod) import('./organizer.js').then((O) => { sxMod = O; sxOrg = O.createOrganizer({ kind: 'syntax', host: sxHost, entries: () => sxSecs, link: false, sorts: ['catalog', 'name', 'folder'], onChange: sxApply }); sxApply(); }).catch(() => {});
  else if (sxOrg) { sxOrg = sxMod.createOrganizer({ kind: 'syntax', host: sxHost, entries: () => sxSecs, link: false, sorts: ['catalog', 'name', 'folder'], onChange: sxApply }); }
  paintLists(); sxApply(); hashGo();
  if (root.dataset.bound) return; root.dataset.bound = '1'; /* one delegated handler: render() can run again on Retry */
  window.addEventListener('hashchange', () => { if ($('#syntax')) hashGo(); });
  root.addEventListener('keydown', (ev) => { const t = ev.target; if (!t.closest) return; const k = ev.key; const list = () => [...root.querySelectorAll('.sx-search, .sx-ghead, .sx-sec:not([hidden]) .sx-head')].filter((e) => e.offsetParent !== null && !e.closest('[hidden]'));
    if ((k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') && (t.matches('.sx-ghead, .sx-head') || (t.matches('.sx-search') && k === 'ArrowDown'))) { const l = list(), i = l.indexOf(t); const n = k === 'Home' ? l[1] : k === 'End' ? l[l.length - 1] : l[Math.max(0, Math.min(l.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))]; if (n) { ev.preventDefault(); n.focus(); } return; }
    if (t.matches('.sx-ghead') && (k === 'ArrowRight' || k === 'ArrowLeft')) { const open = t.getAttribute('aria-expanded') === 'true'; if ((k === 'ArrowRight') !== open) { ev.preventDefault(); showGroup(t.dataset.g, k === 'ArrowRight'); } } });
  root.addEventListener('click', async (ev) => {
    if (ev.target.closest('.sx-retry')) { ev.target.closest('.sx-retry').disabled = true; data = load(true); await render(true); const d2 = await data; sc.ui && sc.ui.toast(d2.error ? 'Syntax examples still unavailable: ' + d2.error : 'Syntax examples loaded', { kind: d2.error ? 'error' : 'ok' }); return; }
    const gh = ev.target.closest('.sx-ghead'); if (gh) { const open = gh.getAttribute('aria-expanded') !== 'true'; if (sxQuery || (sxOrg && (sxOrg.state.folder || sxOrg.state.tags.length))) { gh.setAttribute('aria-expanded', String(open)); gh.closest('.sx-grp').querySelector('.sx-gbody').hidden = !open; return; } showGroup(gh.dataset.g, open); return; }
    const hd = ev.target.closest('.sx-head'); if (hd) { const el = hd.closest('.sx-sec'), open = hd.getAttribute('aria-expanded') !== 'true'; setSec(el, open); if (open) { const id = el.id.slice(3); NAV.recent = [id, ...NAV.recent.filter((x) => x !== id)].slice(0, 8); navSave(); paintLists(); setHash(id); } else if (decodeURIComponent(location.hash) === '#syntax=' + el.id.slice(3)) setHash(''); return; }
    const qb = ev.target.closest('.qp'); if (qb) { const d3 = await data; const [, sid, ix] = qb.dataset.qp.split(':'); const s3 = d3.sections.find((x) => x.id === sid); if (!s3) return;
      import('./quickplay.js').then((m) => m.press(qb, () => qpSpec(s3, +ix, [...qb.closest('.sx-sec').querySelectorAll('.sx-ex')][+ix] || null))).catch((err) => sc.ui && sc.ui.toast('Quick play could not load: ' + err.message, { kind: 'error' })); return; }
    const pn = ev.target.closest('.sx-pin'); if (pn) { const id = pn.dataset.pin; NAV.pins = NAV.pins.includes(id) ? NAV.pins.filter((x) => x !== id) : [id, ...NAV.pins]; navSave(); paintLists(); return; }
    const gt = ev.target.closest('.sx-go'); if (gt) { go(gt.dataset.go); return; }
    const jp = ev.target.closest('.sx-jump a'); if (jp) { ev.preventDefault(); const g = jp.dataset.g; if (sxQuery) { sxQuery = ''; root.querySelector('.sx-search').value = ''; } NAV.open.add(g); navSave(); sxApply(); groupEl(g).scrollIntoView({ block: 'start', behavior: 'auto' }); return; }
    if (ev.target.closest('.sx-clear')) { const q2 = root.querySelector('.sx-search'); q2.value = ''; sxQuery = ''; sxApply(); return; }
    const b = ev.target.closest('.sx-run'); if (!b) return; const d = await data;
    const sec = d.sections.find((s) => s.id === b.dataset.sec); const ex = sec.examples[+b.dataset.i];
    if (ex.action === 'perform') { window.__sc.setView('perform'); return; }
    window.__sc.setView('rack'); const ta = document.getElementById('code'); ta.value = ex.code; ta.dispatchEvent(new Event('input'));
    if (!ex.noplay) { if (window.__sc.S.playing) { /* live swap path picks the edit up */ } else await window.__sc.play(); }
    sc.ui && sc.ui.toast(`Loaded "${ex.title}" into Rack${ex.noplay ? '' : ' and playing'}. Revert restores the recipe.`, { kind: 'ok' });
  });
}
window.addEventListener('strudel:ready', () => setTimeout(() => render(), 300));
sc.syntax = { render, go, has: (k) => (HAS[k] || (() => false))() };
render();
