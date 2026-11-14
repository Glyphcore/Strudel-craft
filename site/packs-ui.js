/* Pack sheet (#67, docs/PACK_SPEC.md sections 7, 9, 10): lazy-loaded on first open (palette "Packs", the empty recipe browser, a ?pack= link).
   Shows what each manifest declares, verbatim: id, version, authors, licence, licenseFile, attribution, the manifest hash and its verification,
   ingredient states with their E_PACK_ / W_PACK_ codes, the "contains code" mark. Missing fields read "not declared"; no licence is assumed.
   Actions (add by source, accept a proposal, remove, prefer, keep offline, grant) confirm through the site modal (strudelCraft.ui), notices are toasts.
   Data comes only from window.strudelCraft.packs (site/packs.js). API: open({tab}), close(), get isOpen.
   Code tab (#71): the code-ingredient switch (default off) and every code grant this browser holds, each with pack id, code hash and Revoke.
   A grant or switching code on happens only from the site modal after a real (trusted) click or key press inside it; nothing else here writes consent. */
const sc = (window.strudelCraft = window.strudelCraft || {});
const P = () => sc.packs;
const ui = () => sc.ui;
const toast = (m, o) => ui() && ui().toast(m, o);
const ND = 'not declared';

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const link = (u, text) => (safeUrl(u) ? h('a', { href: u, target: '_blank', rel: 'noopener' }, text || u) : h('span', {}, text || String(u)));
const short = (hash) => (typeof hash === 'string' ? hash.replace(/^(sha256:[0-9a-f]{10})[0-9a-f]+$/, '$1…') : ND);
const bytes = (n) => (n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------- state */
let d = null, body = null, tab = 'packs', raf = 0, unsub = [];
const TABS = [['packs', 'Packs'], ['code', 'Code'], ['credits', 'Credits'], ['report', 'Report']];
const confirmedHere = new Map(); // qualified id -> code hash, for grants made through the trust dialog in this tab (in memory only)
/* real user gesture: the last click / key press before a modal resolves must be trusted, recent and inside the site modal (a script's el.click() is not) */
let lastAct = null;
function watchGestures() {
  if (watchGestures.on) return; watchGestures.on = true;
  for (const t of ['click', 'keydown']) document.addEventListener(t, (e) => { lastAct = { trusted: e.isTrusted === true, t: performance.now(), modal: !!(e.target && e.target.closest && e.target.closest('dialog.scm')) }; }, true);
}
const realGesture = () => !!lastAct && lastAct.trusted && lastAct.modal && performance.now() - lastAct.t < 2000 && (!navigator.userActivation || navigator.userActivation.isActive);
const dismissed = new Set(), progress = {};

function loadCss() {
  if (document.querySelector('link[data-pk]')) return Promise.resolve();
  return new Promise((ok) => { const l = h('link', { rel: 'stylesheet', href: new URL('packs-ui.css', import.meta.url).href, 'data-pk': '' }); l.onload = ok; l.onerror = ok; document.head.append(l); });
}
function build() {
  d = h('dialog', { class: 'pk', id: 'packSheet', 'aria-labelledby': 'pkTitle' });
  const head = h('div', { class: 'help-head pk-head' },
    h('div', { class: 'pk-titles' }, h('h2', { id: 'pkTitle' }, 'Packs'), h('p', { class: 'pk-sum', id: 'pkSum', 'aria-live': 'polite' }, '')),
    h('button', { type: 'button', class: 'icon', id: 'pkClose', 'aria-label': 'Close packs', onclick: close }, '×'));
  const tabs = h('div', { class: 'pk-tabs', role: 'tablist', 'aria-label': 'Pack sheet sections' },
    ...TABS.map(([id, t]) => h('button', { type: 'button', role: 'tab', id: 'pkTab-' + id, 'data-tab': id, 'aria-controls': 'pkBody', onclick: () => { tab = id; render(); } }, t)));
  tabs.addEventListener('keydown', (e) => { if (!/^Arrow(Left|Right)$/.test(e.key)) return; const ids = TABS.map((x) => x[0]); tab = ids[(ids.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]; render(); d.querySelector(`[data-tab="${tab}"]`).focus(); e.preventDefault(); });
  body = h('div', { class: 'pk-body', id: 'pkBody', role: 'tabpanel', tabindex: '0' });
  d.append(head, tabs, body);
  d.addEventListener('keydown', (e) => e.stopPropagation()); // the instrument's single-key shortcuts stay out of the sheet
  d.addEventListener('click', (e) => { if (e.target === d) close(); });
  d.addEventListener('close', () => { unsub.forEach((f) => f()); unsub = []; });
  document.body.append(d);
}
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (d && d.open) render(); }); };

export async function open(o = {}) {
  if (o.tab) tab = o.tab;
  await loadCss(); if (!d) build(); watchGestures();
  const p = P();
  if (p && !unsub.length) unsub = ['state', 'report', 'lock'].map((t) => p.on(t, schedule)).concat(p.on('offline', (ev) => { progress[ev.id] = ev; schedule(); }));
  render(); if (!d.open) d.showModal();
  (d.querySelector(`[data-tab="${tab}"]`) || d.querySelector('#pkClose')).focus();
  if (p) p.ready.then(schedule);
}
export function close() { if (d && d.open) d.close(); }

/* ---------------------------------------------------------------- render */
function render() {
  const p = P();
  d.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  body.setAttribute('aria-labelledby', 'pkTab-' + tab);
  const keep = body.scrollTop;
  if (!p) { body.replaceChildren(h('p', { class: 'pk-hint' }, 'The pack loader is not available on this page.')); return; }
  const list = p.list(), rep = p.report();
  const ings = list.flatMap((x) => x.ingredients);
  d.querySelector('#pkSum').textContent = `${plural(list.length, 'pack')} · ${ings.filter((i) => i.state === 'ready').length}/${ings.length} ingredients ready · ${plural(rep.errors.length, 'error')} · ${plural(rep.warnings.length, 'warning')}`;
  body.replaceChildren(...(tab === 'credits' ? creditsTab(p) : tab === 'report' ? reportTab(rep) : tab === 'code' ? codeTab(p, list) : packsTab(p, list, rep)));
  body.scrollTop = keep;
}

function packsTab(p, list, rep) {
  const out = [];
  const props = p.proposals().filter((x) => !dismissed.has(x.source) && x.state !== 'accepted');
  out.push(h('div', { class: 'pk-bar' },
    h('button', { type: 'button', class: 'pk-add', onclick: addBySource }, h('span', { 'aria-hidden': 'true' }, '+'), 'Add pack by source'),
    h('p', { class: 'pk-hint' }, 'A pinned github: folder (owner/repo@40-hex-commit/path) or an https:// folder that holds a craftpack.json.')));
  if (list.some((x) => x.code)) out.push(h('p', { class: 'pk-codenote', 'data-on': String(p.codeEnabled()) }, p.codeEnabled() ? 'Code ingredients are on: trusted code runs in isolated frames. ' : 'Code ingredients are off: no pack code runs. ',
    h('button', { type: 'button', class: 'ghost', onclick: () => { tab = 'code'; render(); d.querySelector('[data-tab="code"]').focus(); } }, 'Code settings')));
  if (props.length) out.push(section('Proposed', props.map((x) => proposalCard(p, x))));
  const shipped = list.filter((x) => x.layer === 'shipped'), mine = list.filter((x) => x.layer !== 'shipped');
  if (!list.length) out.push(emptyState('No packs loaded', 'No content pack is in any lock layer, so there are no recipes, reference pages or completions from packs. The editor still works: type a program in the Stack view and press Play.'));
  else {
    if (shipped.length) out.push(section('Shipped with the site', shipped.map((x) => packCard(p, x, rep, list.length))));
    out.push(section('Your packs', mine.length ? mine.map((x) => packCard(p, x, rep, list.length)) : [emptyState('No packs added', 'Packs you add are kept in this browser’s lock and load after the shipped ones. Adding a pack never changes the sound of an existing program: a bare name keeps its first owner unless you prefer another pack.')]));
  }
  return out;
}
const section = (title, kids) => h('section', { class: 'pk-sec' }, h('h3', {}, title), ...kids);
function crate() { // empty crate: the pack glyph
  const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'pk-empty-g');
  path.setAttribute('d', 'M6 17 24 8l18 9-18 9zM6 17v15l18 9 18-9V17M24 26v15M15 12.5l18 9'); s.append(path); return s;
}
const emptyState = (title, text) => h('div', { class: 'pk-empty' }, crate(),
  h('p', { class: 'pk-empty-t' }, title), h('p', {}, text));

function field(label, value) { return [h('dt', {}, label), h('dd', {}, value == null || value === '' || (Array.isArray(value) && !value.length) ? h('span', { class: 'pk-nd' }, ND) : value)]; }
function people(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return h('ul', { class: 'pk-ppl' }, arr.map((a) => h('li', {}, typeof a === 'string' ? a : [a.name != null ? String(a.name) : h('span', { class: 'pk-nd' }, 'name ' + ND), a.url ? [' ', link(a.url, '(' + a.url + ')')] : null])));
}
function attribution(arr) { // {name, url, license, text, changes}, each field shown as recorded
  if (!Array.isArray(arr) || !arr.length) return null;
  return h('ul', { class: 'pk-attr' }, arr.map((a) => typeof a === 'string' ? h('li', {}, a) : h('li', {},
    a.text != null ? h('q', {}, String(a.text)) : null,
    h('span', { class: 'pk-attr-m' }, a.name != null ? String(a.name) : null, a.url ? [' ', link(a.url)] : null, a.license != null ? [' · ', h('code', {}, String(a.license))] : null),
    a.changes != null ? h('span', { class: 'pk-attr-m' }, 'Changes: ' + String(a.changes)) : null)));
}
const licence = (l) => (l == null || l === '' ? null : h('code', { class: 'pk-lic' }, String(l)));
const stateMark = (s) => h('span', { class: 'pk-st', 'data-s': s }, s);
const codeMark = () => h('span', { class: 'pk-code', title: 'Contains code: runs only in an isolated sandbox, and only after you grant it for this exact code' }, 'contains code');

function verification(x) {
  const errs = x.errors || [];
  if (x.state === 'ready') return h('span', { class: 'pk-ok' }, 'verified: matches the lock pin');
  if (x.state === 'loading') return 'checking';
  const e = errs[0]; return h('span', { class: 'pk-bad' }, e ? [h('code', {}, e.code), ' ', e.message] : x.state);
}
function ingVerification(i) {
  if (i.state === 'ready') return 'hash verified';
  if (i.state === 'listed') return `not loaded yet (${i.load}); checked against its hash when it loads`;
  if (i.state === 'loading') return 'loading';
  return null;
}

function packCard(p, x, rep, count) {
  const own = rep.errors.concat(rep.warnings).filter((e) => e.id === x.id);
  const offl = progress[x.id] && x.offline !== true ? `${progress[x.id].done}/${progress[x.id].total} files` : null;
  const acts = [];
  if (count > 1 && x.state === 'ready') acts.push(x.priority >= 10 ? h('span', { class: 'pk-pref' }, 'Preferred') : h('button', { type: 'button', class: 'ghost', onclick: () => doPrefer(p, x) }, 'Prefer'));
  if (!/^file:/.test(x.source || '') && x.state === 'ready') acts.push(h('button', { type: 'button', class: 'ghost', 'aria-pressed': String(!!x.offline), onclick: () => doOffline(p, x) }, x.offline ? 'Offline: kept' : 'Keep offline'));
  if (x.layer !== 'shipped') acts.push(h('button', { type: 'button', class: 'ghost pk-danger', onclick: () => doRemove(p, x) }, 'Remove'));
  const issue = x.ingredients.some((i) => i.state === 'failed' || i.state === 'unavailable');
  return h('article', { class: 'pk-card', 'data-pack': x.id, 'data-state': x.state, 'data-issue': issue ? 'yes' : null, 'aria-label': 'Pack ' + x.id },
    h('header', { class: 'pk-card-h' },
      h('div', {}, h('p', { class: 'pk-id' }, x.id), x.title && x.title !== x.id ? h('p', { class: 'pk-title' }, x.title) : null),
      h('div', { class: 'pk-marks' }, h('span', { class: 'pk-ver' }, x.version != null ? 'v' + x.version : 'version ' + ND), h('span', { class: 'pk-tier' }, x.tier), x.code ? codeMark() : null, stateMark(x.state))),
    x.description ? h('p', { class: 'pk-desc' }, x.description) : null,
    h('dl', { class: 'pk-dl' },
      field('Authors', people(x.authors)),
      field('Licence', licence(x.license)),
      x.licenseFile ? field('Licence file', h('code', {}, x.licenseFile)) : null,
      field('Credits', attribution(x.attribution)),
      x.homepage ? field('Homepage', link(x.homepage)) : null,
      x.repository ? field('Repository', typeof x.repository === 'string' ? link(x.repository) : link(x.repository.url)) : null,
      field('Source', h('code', {}, x.source || ND)),
      field('Manifest', [h('code', { title: x.manifest || '' }, short(x.manifest)), ' ', verification(x)]),
      offl ? field('Offline', offl) : null),
    own.length ? h('ul', { class: 'pk-errs', 'aria-label': 'Errors and warnings for ' + x.id }, own.map((e) => h('li', { 'data-kind': /^W_/.test(e.code) ? 'warn' : 'err' }, h('code', {}, e.code), ' ', e.message))) : null,
    x.ingredients.length ? ingredients(p, x) : null,
    acts.length ? h('div', { class: 'pk-acts' }, acts) : null);
}
function ingredients(p, x) {
  const det = h('details', { class: 'pk-ings' }, h('summary', {}, `Ingredients (${x.ingredients.length})`));
  det.append(h('ul', {}, x.ingredients.map((i) => {
    const v = ingVerification(i);
    const lic = i.license !== x.license || i.attribution;
    return h('li', { 'data-ing': i.id, 'data-state': i.state },
      h('div', { class: 'pk-ing-h' }, h('span', { class: 'pk-ing-id' }, i.id), h('span', { class: 'pk-ing-k' }, i.format || i.kind), i.code ? codeMark() : null, stateMark(i.state)),
      h('p', { class: 'pk-ing-m' }, [i.bytes != null ? bytes(i.bytes) : null, i.assets ? `${plural(i.assets.files ?? 0, 'asset file')} ${bytes(i.assets.bytes)}` : null, v].filter(Boolean).join(' · ')),
      i.reason && i.state !== 'ready' ? h('p', { class: 'pk-ing-r' }, h('code', {}, i.reason.code), ' ', i.reason.message) : null,
      lic ? h('dl', { class: 'pk-dl pk-dl-s' }, field('Licence', licence(i.license)), i.attribution ? field('Credits', attribution(i.attribution)) : null) : null,
      i.redistribution === false ? h('p', { class: 'pk-ing-m' }, 'Not for redistribution (load from its source only)') : null,
      i.code && !i.trusted && x.layer !== 'shipped' ? h('button', { type: 'button', class: 'ghost', onclick: (e) => doGrant(p, x, i, e) }, 'Grant code') : null,
      i.code && i.trusted ? h('p', { class: 'pk-ing-m' }, 'Trusted for code ' + short(i.codeHash) + (p.codeEnabled() ? '' : '; code ingredients are switched off, so it does not run')) : null);
  })));
  return det;
}

function proposalCard(p, x) {
  const kids = [h('p', { class: 'pk-id' }, x.id || x.source), h('p', { class: 'pk-desc' }, h('code', {}, x.source))];
  const acts = [];
  if (x.state === 'new') {
    kids.push(h('p', { class: 'pk-hint' }, 'A link proposes this pack. Nothing has been fetched yet.'));
    acts.push(h('button', { type: 'button', onclick: () => doPeek(p, x) }, 'Fetch manifest'));
  } else if (x.state === 'loading') kids.push(h('p', { class: 'pk-hint' }, 'Fetching the manifest'));
  else if (x.state === 'failed') kids.push(h('p', { class: 'pk-errs' }, h('code', {}, x.error ? x.error.code : 'E_PACK_SCHEMA'), ' ', x.error ? x.error.message : 'failed'));
  else if (x.state === 'proposed') {
    kids.push(h('dl', { class: 'pk-dl' },
      field('Version', x.version != null ? String(x.version) : null), field('Licence', licence(x.license)), field('Credits', attribution(x.attribution)),
      field('Manifest', h('code', { title: x.manifest }, short(x.manifest))),
      field('Ingredients', h('ul', { class: 'pk-ppl' }, (x.ingredients || []).map((i) => h('li', {}, h('span', { class: 'pk-ing-id' }, i.id), ' ', h('span', { class: 'pk-ing-k' }, i.kind), i.bytes != null ? ' ' + bytes(i.bytes) : '', i.code ? [' ', codeMark()] : null))))));
    if (x.code) kids.push(h('p', { class: 'pk-hint' }, 'Contains code. Adding never grants it: code stays blocked until you grant it for its exact hash, and then runs only in an isolated sandbox while code ingredients are switched on.'));
    acts.push(h('button', { type: 'button', class: 'pk-go', onclick: () => doAccept(p, x) }, 'Add pack'));
  }
  acts.push(h('button', { type: 'button', class: 'ghost', onclick: () => { dismissed.add(x.source); render(); } }, 'Dismiss'));
  return h('article', { class: 'pk-card pk-prop', 'data-proposal': x.source, 'data-state': x.state }, ...kids, h('div', { class: 'pk-acts' }, acts));
}

function creditsTab(p) {
  const cr = p.credits();
  if (!cr.length) return [emptyState('No credits to show', 'No pack is loaded, so nothing needs attribution.')];
  return [h('p', { class: 'pk-hint' }, 'Licence and attribution of every loaded pack, as each manifest records them.'),
    h('ol', { class: 'pk-credits' }, cr.map((c) => h('li', { 'data-pack': c.pack },
      h('p', { class: 'pk-id' }, c.title && c.title !== c.pack ? `${c.title} (${c.pack})` : c.pack, c.version != null ? ' v' + c.version : ''),
      h('dl', { class: 'pk-dl' }, field('Licence', licence(c.license)), c.licenseFile ? field('Licence file', h('code', {}, c.licenseFile)) : null, field('Authors', people(c.authors)), field('Credits', attribution(c.attribution))),
      c.ingredients.length ? h('ul', { class: 'pk-attr' }, c.ingredients.map((i) => h('li', {}, h('span', { class: 'pk-ing-id' }, i.id), ' ', i.license != null ? h('code', {}, String(i.license)) : h('span', { class: 'pk-nd' }, 'licence ' + ND), attribution(i.attribution), i.redistribution === false ? ' (not for redistribution)' : ''))) : null)))];
}
function reportTab(rep) {
  const row = (e, kind) => h('li', { 'data-kind': kind }, h('code', {}, e.code), e.id ? h('span', { class: 'pk-ing-k' }, e.id) : null, ' ', e.message);
  const out = [];
  out.push(section(`Errors (${rep.errors.length})`, rep.errors.length ? [h('ul', { class: 'pk-errs' }, rep.errors.map((e) => row(e, 'err')))] : [h('p', { class: 'pk-hint' }, 'None.')]));
  out.push(section(`Warnings (${rep.warnings.length})`, rep.warnings.length ? [h('ul', { class: 'pk-errs' }, rep.warnings.map((e) => row(e, 'warn')))] : [h('p', { class: 'pk-hint' }, 'None.')]));
  const sh = Object.entries(rep.resolution || {}).flatMap(([kind, m]) => Object.entries(m).filter(([, e]) => e.shadowed && e.shadowed.length).map(([name, e]) => ({ kind, name, e })));
  out.push(section(`Shadowed names (${sh.length})`, sh.length ? [h('ul', { class: 'pk-errs' }, sh.map(({ kind, name, e }) => h('li', {}, h('span', { class: 'pk-ing-k' }, kind), ' ', h('code', {}, name), ' → ', h('code', {}, e.winner), ' over ', e.shadowed.map((s, k) => [k ? ', ' : '', h('code', {}, String(s))]))))] : [h('p', { class: 'pk-hint' }, 'No bare name has more than one owner.')]));
  return out;
}

/* ---------------------------------------------------------------- actions: confirm in the site modal, report in a toast */
const refreshRecipes = () => sc.recipes && sc.recipes.reload && sc.recipes.reload();
async function addBySource() {
  const p = P(); if (!p || !ui()) return;
  const src = await ui().ask({ title: 'Add pack', label: 'Source: github:owner/repo@commit/path or https://…/', value: '', okText: 'Fetch manifest' });
  if (!src || !src.trim()) return;
  toast('Fetching the manifest only');
  const x = await p.propose(src.trim());
  if (x.state === 'failed') { toast(`${x.error.code}: ${x.error.message}`, { kind: 'error' }); render(); return; }
  tab = 'packs'; render(); const card = body.querySelector(`[data-proposal="${CSS.escape(x.source)}"]`); if (card) { card.scrollIntoView({ block: 'nearest' }); const b = card.querySelector('.pk-go'); if (b) b.focus(); }
}
async function doPeek(p, x) {
  const r = await p.peek(x.source); render();
  if (r && r.state === 'failed') toast(`${r.error.code}: ${r.error.message}`, { kind: 'error' });
}
async function doAccept(p, x) {
  const ok = await ui().askYesNo({ title: 'Add ' + x.id + '?', message: `Pins manifest ${short(x.manifest)} in this browser's lock. Licence: ${x.license ?? ND}. ${x.code ? 'It contains code; adding does not grant it.' : 'Data only.'} Bare names already in use keep their current owner.`, okText: 'Add pack' });
  if (!ok) return;
  const r = await p.accept(x.source);
  if (r && r.state === 'accepted') { toast('Added ' + x.id, { kind: 'ok' }); await refreshRecipes(); }
  else toast(r && r.error ? `${r.error.code}: ${r.error.message}` : 'Could not add ' + x.id, { kind: 'error' });
  render();
}
async function doRemove(p, x) {
  const ok = await ui().askYesNo({ title: 'Remove ' + x.id + '?', message: 'Removes it from this browser’s lock and drops its cached files. Programs that use its names stop finding them.', okText: 'Remove', danger: true });
  if (!ok) return;
  await p.remove(x.id); toast('Removed ' + x.id, { kind: 'ok' }); await refreshRecipes(); render();
}
async function doPrefer(p, x) {
  const ok = await ui().askYesNo({ title: 'Prefer ' + x.id + '?', message: 'Bare names it shares with other packs resolve to this pack from now on, which can change how existing programs sound. Qualified ids (author/pack:item) are unaffected.', okText: 'Prefer' });
  if (!ok) return;
  p.prefer(x.id); toast('Preferred ' + x.id, { kind: 'ok' }); await refreshRecipes(); render();
}
async function doOffline(p, x) {
  if (x.offline) { await p.offline(x.id, false); toast(x.id + ' is no longer kept offline'); render(); return; }
  const size = x.ingredients.reduce((s, i) => s + (i.bytes || 0) + ((i.assets && i.assets.bytes) || 0), 0);
  const ok = await ui().askYesNo({ title: 'Keep ' + x.id + ' offline?', message: `Downloads every entry and asset file (${bytes(size) || 'size not declared'}) and checks each against its hash.`, okText: 'Download' });
  if (!ok) return;
  const r = await p.offline(x.id, true); delete progress[x.id];
  toast(r ? `${x.id}: kept offline (${plural(r.files || 0, 'asset file')})` : 'Could not keep ' + x.id + ' offline', { kind: r ? 'ok' : 'error' }); render();
}
async function doGrant(p, x, i, ev) { // the trust dialog (site modal): pack, author, licence as recorded, code hash, changed modules, what the code can and cannot do
  const c = p.codeInfo(i.qualified); if (!c) { toast('Could not grant ' + i.qualified, { kind: 'error' }); return; }
  const lines = [`Pack ${c.pack} by ${c.authors.length ? c.authors.map((a) => a.name || a).join(', ') : ND}. Licence as recorded: ${c.license ?? ND}.`, `Code hash ${c.hash}`,
    `Modules: ${c.modules.map((m) => `${m.path} (${m.hash ? short(m.hash) : ND})`).join(', ')}.`, c.hadTrust && c.changed.length ? `CHANGED since you last trusted it: ${c.changed.join(', ')}.` : c.hadTrust ? 'Changed since you last trusted it.' : 'First time for this code.',
    'It can: ' + c.can.join('; ') + '.', 'It cannot: ' + c.cannot.join('; ') + '.', c.flag ? 'Applies to this exact code only; a new version asks again.' : 'Code ingredients are switched off in this browser, so granting does not run it until they are switched on.'];
  const ok = await ui().askYesNo({ title: 'Trust code in ' + i.qualified + '?', message: lines.join(' '), okText: 'Trust this code', danger: true });
  if (!ok) return;
  if (!realGesture()) { toast('Not granted: the dialog was not confirmed by a click or key press', { kind: 'error' }); return; }
  const done = p.grant(i.qualified); if (done) confirmedHere.set(i.qualified, c.hash);
  toast(done ? 'Trusted ' + i.qualified : 'Could not grant ' + i.qualified, { kind: done ? 'ok' : 'error' }); render();
}

/* ---------------------------------------------------------------- Code tab: the switch and the trust list */
function codeTab(p, list) {
  const on = p.codeEnabled(), grants = p.trusts ? p.trusts() : [];
  const codeIngs = list.flatMap((x) => x.ingredients.filter((i) => i.code).map((i) => ({ ...i, layer: x.layer })));
  const sw = h('button', { type: 'button', class: 'pk-switch', id: 'pkCodeSwitch', role: 'switch', 'aria-checked': String(on), 'aria-describedby': 'pkCodeWhat', onclick: (e) => doCodeSwitch(p, !on, e) },
    h('span', { class: 'pk-sw-track', 'aria-hidden': 'true' }, h('span', { class: 'pk-sw-knob' })), h('span', { class: 'pk-sw-l' }, 'Code ingredients'), h('span', { class: 'pk-sw-v' }, on ? 'On' : 'Off'));
  const out = [h('section', { class: 'pk-sec pk-codeset', 'data-on': String(on) }, h('h3', {}, 'Switch'), sw,
    h('div', { class: 'pk-what', id: 'pkCodeWhat' },
      h('p', {}, on ? 'On: code you have trusted runs, each ingredient in its own isolated frame. Off (the default): no pack code runs at all, even if you trusted it.' : 'Off (the default): no pack code runs, even code you trusted. Turning it on lets trusted code run; it never trusts anything by itself.'),
      h('div', { class: 'pk-cc' },
        h('div', {}, h('p', { class: 'pk-cc-h' }, 'Turning it on allows'), h('ul', {}, ['Code you trusted in the trust dialog, for its exact hash, to run in a sandboxed frame', 'That code to receive plain data for its kind (the text around the caret, a control value) and return plain data'].map((t) => h('li', {}, t)))),
        h('div', {}, h('p', { class: 'pk-cc-h' }, 'It does not allow'), h('ul', {}, ['Any code you have not trusted, or a new version of trusted code', 'Network, storage, this page, your recipes, history or settings', 'Links, imported recipes or history restores to trust code or switch this on'].map((t) => h('li', {}, t))))))),
  ];
  const rows = grants.map((g) => trustRow(p, g));
  out.push(section(`Trusted code (${grants.length})`, rows.length ? [h('p', { class: 'pk-hint' }, 'Every code grant this browser holds. Revoke any you do not recognise: program text you run in the page (a recipe, a shared link after Play) has full page access and could have written one.'), h('ul', { class: 'pk-trust' }, rows)]
    : [emptyState('Nothing trusted', codeIngs.length ? `${plural(codeIngs.length, 'code ingredient')} in your packs; each stays blocked until you grant it from its pack card.` : 'No pack with code is loaded, and no code is trusted in this browser.')]));
  return out;
}
function trustRow(p, g) {
  const here = confirmedHere.get(g.qualified) === g.hash && g.hash != null;
  const status = !g.record ? ['lock', g.layer === 'shipped' ? 'Listed in the shipped lock (reviewed); runs only after you also trust it' : 'In the lock (allowCode) without a trust record: it cannot run'] : !g.loaded ? ['orphan', 'Its pack is not loaded'] : !g.current ? ['stale', 'Code changed since this grant: it does not run'] : g.allowCode ? ['ok', p.codeEnabled() ? 'Runs when used' : 'Would run, but code ingredients are off'] : ['lock', 'Not in the lock (allowCode): it cannot run'];
  const conf = here ? h('span', { class: 'pk-conf', 'data-c': 'here' }, 'confirmed here') : g.record ? h('span', { class: 'pk-conf', 'data-c': 'not', title: 'Not made through the trust dialog in this tab: from an earlier visit, another tab or a script' }, 'not confirmed here') : null;
  const canRevoke = !(g.layer === 'shipped' && !g.record);
  return h('li', { 'data-grant': g.qualified, 'data-status': status[0], 'data-confirmed': here ? 'here' : 'not' },
    h('div', { class: 'pk-ing-h' }, h('span', { class: 'pk-ing-id' }, g.pack), h('span', { class: 'pk-ing-k' }, ':' + g.ingredient), conf),
    h('dl', { class: 'pk-dl pk-dl-s' }, field('Code hash', g.hash ? h('code', { class: 'pk-hash' }, g.hash) : null), field('Granted', g.at ? new Date(g.at).toLocaleString() : null), g.modules.length ? field('Modules', g.modules.join(', ')) : null),
    h('p', { class: 'pk-ing-m', 'data-status': status[0] }, status[1]),
    canRevoke ? h('button', { type: 'button', class: 'ghost pk-danger', 'aria-label': 'Revoke code trust for ' + g.qualified, onclick: () => doRevoke(p, g) }, 'Revoke') : null);
}
async function doRevoke(p, g) {
  const ok = await ui().askYesNo({ title: 'Revoke ' + g.qualified + '?', message: `Removes the trust record${g.hash ? ' for code ' + g.hash : ''} and its allowCode entry. The ingredient stops at once and stays blocked until you trust it again.`, okText: 'Revoke', danger: true });
  if (!ok) return;
  const done = p.revoke(g.qualified); confirmedHere.delete(g.qualified); toast(done ? 'Revoked ' + g.qualified : 'Nothing to revoke for ' + g.qualified, { kind: done ? 'ok' : 'error' }); render();
  const f = d && d.querySelector('#pkCodeSwitch'); if (f) f.focus();
}
async function doCodeSwitch(p, want, ev) {
  if (!want) { p.setCodeEnabled(false); toast('Code ingredients off: no pack code runs', { kind: 'ok' }); render(); d.querySelector('#pkCodeSwitch')?.focus(); return; } // switching off needs no confirmation
  const n = (p.trusts ? p.trusts() : []).filter((g) => g.record && g.current && g.allowCode).length;
  const ok = await ui().askYesNo({ title: 'Switch code ingredients on?', message: `Code you trusted for its exact hash may then run, each ingredient in an isolated frame with no network, no storage and no access to this page. ${n ? plural(n, 'grant') + ' would take effect now.' : 'Nothing is trusted yet, so nothing runs until you grant an ingredient.'} Untrusted or changed code stays blocked. You can switch it off at any time.`, okText: 'Switch on' });
  if (!ok) return;
  if (!realGesture()) { toast('Not switched on: the dialog was not confirmed by a click or key press', { kind: 'error' }); return; }
  p.setCodeEnabled(true); toast('Code ingredients on', { kind: 'ok' }); render(); d.querySelector('#pkCodeSwitch')?.focus();
}

export const sheet = { open, close, get isOpen() { return !!(d && d.open); } };
