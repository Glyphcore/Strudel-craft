/* Resources pane UI (docs/RESOURCES.md). Loaded on first open (button, Ctrl+K > Show resources, workspace pane, #res=<id>); nothing here runs at boot.
   Two tabs on one panel component, mounted in a sheet (phone first) and/or a workspace pane (desktop side panel):
     In this program   every reference the code uses, resolved live (engine/resources.js buildModel; `strudel refs` prints the same list)
     Available         every installed pack -> kind -> item, with the #120 organizer (folders, tags, appearance), search, example (Craft + lowered), Play (#150),
                       Insert reference and Copy
   Presses only change this panel (#107): the editor is never scrolled, focused or selected by a plain press; "Go to line" is its own target button.
   Insert reference is one editor change at one place (engine/resources.js insertPlan); the program is never replaced. Notices are toasts, no native dialogs. */
import * as R from './engine/resources.js';
import { HYGIENE } from './engine/hygiene.js';
import { GROOVES } from './engine/groove.js';

const sc = window.strudelCraft;
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>', stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>', plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/></svg>', copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h11v13H8zM5 16V3h11" fill="none" stroke="currentColor" stroke-width="2"/></svg>' };
const CHIP = { resolved: 'resolved', shadowed: 'shadowed', alias: 'older id', unresolved: 'missing', unused: 'unused', unread: 'unread', code: 'code: needs allow', info: 'info' };
const CHIP_TIP = { shadowed: 'another pack defines the same name; the winner is used (#143)', alias: 'an older id of a renamed item (#120)', unused: 'imported or defined, but nothing uses it', unread: 'a tap that nothing reads (#114)', code: 'a code-bearing ingredient: runs only when allowed in the Packs sheet', unresolved: 'nothing in the loaded packs or the program provides this' };
const PAGE = 40;

/* ---------------- editor access ---------------- */
const activeId = () => { const v = window.__sc && window.__sc.S && window.__sc.S.view; return v === 'stack' ? 'stackCode' : 'code'; };
const ta = () => document.getElementById(activeId());
export const programText = () => { const t = ta(); return t ? t.value : ''; };
function view() { const t = ta(); return t && t.cmView; }
/* one insertion at one offset; the selection, focus and scroll stay where the user left them */
export function insertReference(item, opts = {}) {
  const t = ta(); if (!t) return { ok: false };
  const doc = t.value; const v = view(); const caret = opts.caret === undefined ? (v && v.hasFocus ? v.state.selection.main.head : null) : opts.caret;
  const plan = R.insertPlan(doc, item, caret); if (!plan) return { ok: false, why: 'nothing to insert' }; if (plan.noop) return { ok: true, noop: true, reason: plan.reason };
  if (v) { const sel = v.state.selection.main; const shift = (p) => (p >= plan.from ? p + plan.insert.length : p); v.dispatch({ changes: { from: plan.from, insert: plan.insert }, selection: { anchor: shift(sel.anchor), head: shift(sel.head) }, userEvent: 'input.paste', scrollIntoView: false }); }
  else { const a = t.selectionStart, b = t.selectionEnd; t.value = doc.slice(0, plan.from) + plan.insert + doc.slice(plan.from); t.setSelectionRange(a >= plan.from ? a + plan.insert.length : a, b >= plan.from ? b + plan.insert.length : b); t.dispatchEvent(new Event('input', { bubbles: true })); }
  return { ok: true, line: plan.line, plan };
}
export function gotoLine(line) {
  const t = ta(); if (!t) return false; const v = view();
  if (v) { const n = Math.max(1, Math.min(line, v.state.doc.lines)); const ln = v.state.doc.line(n); const CM = sc.intellisense && sc.intellisense.cm; v.dispatch({ selection: { anchor: ln.from }, scrollIntoView: true, userEvent: 'select' }); v.focus(); return true; }
  const off = t.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0); t.focus(); t.setSelectionRange(off, off); return true;
}

/* ---------------- the host: site registries -> engine/resources.js host ---------------- */
async function siteHost(code, kinds) {
  const P = sc.packs; const host = {};
  if (P) {
    await P.ready; await Promise.all(kinds.map((k) => P.ensure(k).catch(() => null)));
    const items = (kind) => { try { return P.items(kind) || []; } catch { return []; } };
    const names = {}; for (const k of ['atoms', 'hooks']) for (const i of items(k)) (names[`${i.pack}:${i.ingredient}`] ||= []).push(i.name);
    const list = P.list().map((p) => ({ ...p, ingredients: p.ingredients.map((i) => ({ ...i, names: names[`${p.id}:${i.id}`] || [] })) }));
    host.packs = { list, items, resolution: (P.report() || {}).resolution || {} };
  }
  const A = sc.atoms; host.atoms = { env: null, refs: [], error: null };
  if (A && /\batoms?\b/.test(code)) { try { const env = A.env(code); host.atoms.env = env; if (env) host.atoms.refs = A.compile(code, env, {}).refs || []; } catch (e) { host.atoms.error = { code: e.code, message: e.message }; } }
  const stdlib = [...Object.keys(HYGIENE), ...Object.keys(GROOVES)]; host.hooks = { json: null, plan: null, diagnostics: [], stdlib };
  const H = sc.hooks; if (H) { try { host.hooks.json = JSON.parse(H.toJSON()); } catch { /* none */ } try { const pl = H.plan(); host.hooks.plan = pl; host.hooks.diagnostics = pl.diagnostics || []; } catch { /* none */ } }
  host.vox = voxCache.map((b) => ({ name: b.name, short: b.short, kind: b.kind, words: b.words, clips: b.clips, pack: b.origin === 'shipped' || !b.origin ? 'glyphcore/vox' : null }));
  return host;
}
let voxCache = []; const loadVox = () => (sc.voxBanks ? sc.voxBanks.list().then((l) => { voxCache = l || []; }, () => {}) : Promise.resolve());

/* ---------------- the panel ---------------- */
let paneN = 0;
export function createPanel(root, o = {}) {
  const st = { tab: o.tab || 'program', kind: 'all', problems: false, q: '', open: new Set(), more: {}, model: null, avail: null, host: null, playing: null, flash: null, busy: false, bodies: new Map(), bodyErr: new Map(), loading: new Set(), deep: false, deepN: null };
  root.classList.add('rs'); root.innerHTML = '';
  const tabs = document.createElement('div'); tabs.className = 'rs-tabs'; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" role="tab" data-tab="program">In this program <b class="rs-n" data-n="program"></b></button><button type="button" role="tab" data-tab="available">Available <b class="rs-n" data-n="available"></b></button>';
  const banner = document.createElement('div'); banner.className = 'rs-miss'; banner.hidden = true; banner.setAttribute('role', 'status');
  const bar = document.createElement('div'); bar.className = 'rs-bar'; const orgHost = document.createElement('div'); orgHost.className = 'org-host rs-org'; orgHost.hidden = true;
  const body = document.createElement('div'); body.className = 'rs-body'; root.append(tabs, banner, bar, orgHost, body);
  let org = null; let seq = 0;
  const withOv = (e) => (sc.taxonomyOverlay ? sc.taxonomyOverlay(e) : e);
  const availEntries = () => (st.avail || []).flatMap((p) => p.kinds.flatMap((k) => k.ingredients.flatMap((g) => g.items.map((i) => ({ id: i.id, kind: 'resource', title: i.name, pack: p.id, folder: i.folder || `${p.id.split('/')[1]}/${k.kind}`, tags: [...new Set([...(i.tags || []), k.kind === 'vox-bank' ? 'vox' : k.kind])] })))));
  import('./organizer.js').then((O) => { org = O.createOrganizer({ kind: 'resources', host: orgHost, entries: availEntries, link: false, sorts: ['catalog', 'name', 'folder', 'pack'], onChange: () => { if (st.tab === 'available') drawAvail(); } }); if (st.tab === 'available') draw(); }).catch(() => {});

  const kindsOf = (m) => KIND_PILLS.filter((k) => m.counts[k]);
  const KIND_PILLS = R.KIND_ORDER;
  const chips = (r) => (r.status.length ? r.status : ['info']).map((s) => `<span class="rs-chip" data-s="${s}" title="${esc(CHIP_TIP[s] || '')}">${CHIP[s] || s}</span>`).join('');
  const srcText = (r) => (r.source ? (r.source.pack ? `${r.source.pack}@${r.source.version || '?'}${r.source.license ? ' · ' + r.source.license : ''}` : r.source.qualified) : '');
  const paramText = (p) => `<span class="rs-p"><b>${esc(p.name)}</b>${p.type ? ` ${esc(p.type)}` : ''}${p.min !== undefined || p.max !== undefined ? ` <i>${p.min ?? ''}..${p.max ?? ''}</i>` : ''}${p.default !== undefined ? ` = ${esc(p.default)}` : ''}${p.unit ? ' ' + esc(p.unit) : ''}</span>`;

  /* ----- In this program ----- */
  const card = (r) => {
    const open = st.open.has(r.id); const lines = [...new Set(r.uses.map((u) => u.line))];
    return `<li class="rs-card" data-id="${esc(r.id)}" data-kind="${r.kind}" data-p="${r.primary}" ${open ? 'data-open="true"' : ''} ${st.flash === r.id ? 'data-flash="true"' : ''}>
      <button type="button" class="rs-head" aria-expanded="${open}" aria-label="${esc(r.name)}, ${esc(r.kind)}, ${esc(r.primary)}"><span class="rs-name">${esc(r.name)}</span><span class="rs-kind">${esc(r.kind)}</span>${chips(r)}
        <span class="rs-src">${esc(srcText(r))}</span>${r.desc ? `<span class="rs-desc">${esc(r.desc)}</span>` : ''}</button>
      ${lines.length ? `<button type="button" class="rs-go" data-go="${lines[0]}" aria-label="Go to line ${lines[0]} in the code" title="Go to line ${lines[0]} (jumps the editor)">${ICON.target}<i>${lines[0]}</i></button>` : ''}
      ${open ? `<div class="rs-more">${r.params.length ? `<div class="rs-params"><span class="rs-l">Params</span>${r.params.map(paramText).join('')}</div>` : ''}
        ${lines.length ? `<div class="rs-uses"><span class="rs-l">Used at</span>${lines.slice(0, 24).map((n) => `<button type="button" class="rs-ln" data-go="${n}" aria-label="Go to line ${n}">${n}</button>`).join('')}${lines.length > 24 ? `<i>+${lines.length - 24}</i>` : ''}</div>` : ''}
        ${r.notes.length ? `<ul class="rs-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${r.fix ? `<div class="rs-fix"><span class="rs-l">Fix</span> ${esc(r.fix)}${r.fixLine ? ` <code>${esc(r.fixLine)}</code>` : ''}${r.fixLine ? ` <button type="button" class="rs-ins" data-fix="${esc(r.id)}">${ICON.plus}Insert this import</button>` : ''}</div>` : ''}
        <div class="rs-act"><button type="button" class="ghost rs-cp" data-copy="${esc(r.kind === 'atom' ? 'atoms.' + r.name : r.name)}">${ICON.copy}Copy name</button></div></div>` : ''}</li>`;
  };
  const drawProgram = () => {
    const m = st.model; if (!m) { body.innerHTML = '<p class="rs-hint">Reading the program…</p>'; return; }
    bar.hidden = false; bar.innerHTML = `<div class="rs-kinds" role="group" aria-label="Kind"><button type="button" class="rs-k" data-kind="all" aria-pressed="${st.kind === 'all'}">All <b>${m.total}</b></button>${kindsOf(m).map((k) => `<button type="button" class="rs-k" data-kind="${k}" aria-pressed="${st.kind === k}">${R.KIND_LABEL[k]} <b>${m.counts[k]}</b></button>`).join('')}</div>
      <label class="rs-prob"><input type="checkbox" ${st.problems ? 'checked' : ''}> Problems only</label>`;
    const probs = (r) => r.status.some((s) => ['unresolved', 'unused', 'unread', 'code', 'shadowed', 'alias'].includes(s));
    const list = m.refs.filter((r) => (st.kind === 'all' || r.kind === st.kind) && (!st.problems || probs(r)));
    body.innerHTML = list.length ? `<ul class="rs-list">${list.map(card).join('')}</ul>` : `<p class="rs-hint">${m.total ? 'Nothing matches this filter.' : 'This program uses no atoms, racks, taps, lanes, controls, vox banks or packs yet. Open Available to browse what you can add.'}</p>`;
    banner.hidden = !m.missing.length;
    if (m.missing.length) banner.innerHTML = `<b>${m.missing.length} missing</b> <span>${m.missing.slice(0, 3).map((x) => `<button type="button" class="rs-mi" data-open="${esc(x.id)}">${esc(x.name)}</button>`).join('')}${m.missing.length > 3 ? ` +${m.missing.length - 3}` : ''}</span>`;
    root.querySelector('[data-n="program"]').textContent = m.total ? String(m.total) : '';
    /* CraftCues (#163): the KB ids the program's score cues reference, resolved (cues-ui.js resourcesSection; loads only when the program carries cues) */
    { const code = programText(); if (sc.cues && sc.cues.ui) sc.cues.ui().then((cm) => cm.resourcesSection(code)).then((html) => { if (!html || st.tab !== 'program') return; const old = body.querySelector('.rs-cues'); if (old) old.remove(); body.insertAdjacentHTML('beforeend', html); }).catch(() => {}); }
  };

  /* ----- Available ----- */
  const itemRow = (it) => {
    const open = st.open.has(it.id); const src = `${it.pack}@${it.version || '?'}${it.license ? ' · ' + it.license : ''}`;
    return `<li class="rs-card rs-item" data-id="${esc(it.id)}" data-kind="${it.kind}" ${open ? 'data-open="true"' : ''}>
      <button type="button" class="rs-head" aria-expanded="${open}" aria-label="${esc(it.name)}, ${esc(R.KIND_NOUN[it.kind] || it.kind)}"><span class="rs-name">${esc(it.name)}</span><span class="rs-kind">${esc(R.KIND_NOUN[it.kind] || it.kind)}</span>${it.shadowed ? '<span class="rs-chip" data-s="shadowed">shadowed</span>' : ''}<span class="rs-src">${esc(src)}</span>${it.desc ? `<span class="rs-desc">${esc(it.desc)}</span>` : ''}${it.intent ? `<span class="rs-desc">${esc(it.intent)}</span>` : ''}</button>
      ${open ? `<div class="rs-more">${it.tags && it.tags.length ? `<div class="rs-tags">${it.tags.map((t) => `<span class="rs-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${it.params.length ? `<div class="rs-params"><span class="rs-l">Params</span>${it.params.map(paramText).join('')}</div>` : ''}
        <div class="rs-forms" data-forms="${esc(it.id)}"></div>
        <div class="rs-act">${it.play ? `<button type="button" class="rs-play" data-qp="res:${esc(it.id)}" data-play="${esc(it.id)}" aria-label="Play ${esc(it.name)}">${ICON.play}Play</button>` : ''}${it.insert && it.insert.text ? `<button type="button" class="rs-ins" data-insert="${esc(it.id)}">${ICON.plus}Insert reference</button>` : ''}<button type="button" class="ghost rs-cp" data-copy-item="${esc(it.id)}">${ICON.copy}Copy</button></div></div>` : ''}</li>`;
  };
  const byId = (id) => { for (const p of st.avail || []) for (const k of p.kinds) for (const g of k.ingredients) for (const i of g.items) if (i.id === id) return i; return null; };
  const drawAvail = () => {
    bar.hidden = false; orgHost.hidden = !org;
    bar.innerHTML = `<input type="search" class="rs-q" placeholder="Search packs, atoms, racks, banks" value="${esc(st.q)}" aria-label="Search available resources" autocomplete="off" autocapitalize="off" spellcheck="false">
      <label class="rs-prob rs-deep"><input type="checkbox" class="rs-deep-i" ${st.deep ? 'checked' : ''}> Search descriptions too${st.deepN ? ` <i class="rs-deepn" role="status">loading recipe files ${st.deepN[0]}/${st.deepN[1]}…</i>` : ''}</label>`;
    const body0 = body; if (!st.avail) { body0.innerHTML = '<p class="rs-hint">Loading installed packs…</p>'; return; }
    if (org) org.refresh();
    const ov = (i) => ({ id: i.id, kind: 'resource', title: i.name, pack: i.pack, folder: i.folder || `${i.pack.split('/')[1]}/${i.kind}`, tags: [...new Set([...(i.tags || []), i.kind === 'vox-bank' ? 'vox' : i.kind])] });
    const pass = (i) => !org || org.pass(withOv(ov(i)));
    let n = 0; const html = st.avail.map((p) => {
      const kinds = p.kinds.map((k) => { const all = k.ingredients.flatMap((g) => g.items).filter(pass); n += all.length; if (!all.length) return ''; const lim = st.more[p.id + k.kind] || PAGE; const key = `${p.id}|${k.kind}`;
        return `<details class="rs-kg" data-key="${esc(key)}" ${st.open.has('k:' + key) || st.q ? 'open' : ''}><summary>${esc(k.noun)}s <b>${all.length}</b></summary><ul class="rs-list">${all.slice(0, lim).map(itemRow).join('')}</ul>${all.length > lim ? `<button type="button" class="ghost rs-more-b" data-more="${esc(p.id + k.kind)}">Show ${Math.min(PAGE, all.length - lim)} more</button>` : ''}</details>`; }).join('');
      return kinds ? `<section class="rs-pack"><h3><span>${esc(p.title)}</span><i>${esc(p.id)}@${esc(p.version || '?')}${p.license ? ' · ' + esc(p.license) : ''}</i></h3>${p.description ? `<p class="rs-pd">${esc(p.description)}</p>` : ''}${kinds}</section>` : '';
    }).join('');
    body.innerHTML = html || '<p class="rs-hint">Nothing matches. Clear the search or the folder and tag filters.</p>';
    root.querySelector('[data-n="available"]').textContent = n ? String(n) : '';
    for (const holder of body.querySelectorAll('[data-forms]')) mountForms(holder, byId(holder.dataset.forms));
  };
  const lowerOf = (code) => { try { const a = sc.atoms; if (a && a.inline && /\batoms?\b/.test(code)) { const l = a.inline(code); if (l && l !== code) return l; } } catch { /* stays Craft only */ } return null; };
  /* #131: an indexed recipe has no code until its family file is read: one recipeBodies() fetch per file (hash-verified, cached), a status row with a spinner, Retry on failure */
  const bodyKey = (it) => `${it.pack}|${it.body}`;
  const avail = (host) => withBodies(R.available(host || st.host || {}, { q: st.q, deep: st.deep, bodies: st.bodies })); /* one scope with `strudel refs --available`: index fields; deep adds recipe body text */
  const withBodies = (list) => { for (const p of list) for (const k of p.kinds) for (const g of k.ingredients) for (const i of g.items) if (i.lazy) { const b = st.bodies.get(bodyKey(i)); if (b) R.applyBody(i, b[i.name]); } return list; };
  const loadBody = (it) => {
    const key = bodyKey(it); if (st.loading.has(key)) return; st.loading.add(key); st.bodyErr.delete(key);
    const P = sc.packs; Promise.resolve(P && P.recipeBodies ? P.recipeBodies(it.pack, it.body) : null).then((b) => { if (!b) throw new Error(`The recipe file ${it.body} could not be loaded. Check the connection, then retry.`); st.bodies.set(key, b); withBodies(st.avail || []); }).catch((e) => { st.bodyErr.set(key, e && e.message ? e.message : 'could not be loaded'); }).finally(() => { st.loading.delete(key); if (st.tab === 'available') drawAvail(); });
  };
  /* "Search descriptions too": read every family file once (with progress), then match the recipes' body text as well */
  const deepLoad = async () => {
    if (st.deep) {
      const files = R.lazyFiles(st.host || {}).filter((f) => !st.bodies.has(`${f.pack}|${f.body}`)); let n = 0, bad = 0; st.deepN = files.length ? [0, files.length] : null; drawAvail();
      const P = sc.packs; const queue = files.slice(); const worker = async () => { for (let f = queue.shift(); f; f = queue.shift()) { try { const b = P && P.recipeBodies ? await P.recipeBodies(f.pack, f.body) : null; if (b) st.bodies.set(`${f.pack}|${f.body}`, b); else bad++; } catch { bad++; } st.deepN = [++n, files.length]; const e = root.querySelector('.rs-deepn'); if (e) e.textContent = `loading recipe files ${n}/${files.length}…`; } };
      await Promise.all([worker(), worker(), worker()]); st.deepN = null; if (bad) toast(`${bad} recipe file${bad === 1 ? '' : 's'} could not be loaded; those recipes match on their index fields only`, { kind: 'info' });
    }
    st.avail = avail(); drawAvail();
  };
  const mountForms = (holder, it) => {
    if (!it) return;
    if (it.lazy) {
      const err = st.bodyErr.get(bodyKey(it));
      if (err) { holder.innerHTML = `<div class="rec-load err" role="alert"><span>${esc(err)}</span><button type="button" class="ghost" data-retry="${esc(it.id)}">Retry</button></div>`; return; }
      holder.innerHTML = '<div class="rec-load" role="status"><i class="spin" aria-hidden="true"></i><span>Loading recipe…</span></div>'; loadBody(it); return;
    }
    const code = it.play || it.snippet || ''; if (!code) { holder.innerHTML = '<p class="rs-hint">No example for this item.</p>'; return; }
    const craft = it.kind === 'atoms' ? `${it.insert.text}\n$: ${it.snippet}` : code; const lowered = it.lowered || lowerOf(craft);
    const form = { craft, ...(lowered ? { lowered } : {}), ...(!lowered && it.lowered_note ? { lowered_note: it.lowered_note } : {}), ...(!lowered && !it.lowered_note && /\batoms?\b|hooks\./.test(craft) ? { lowered_note: 'it needs the Craft runtime (atoms, hooks)' } : {}), ...(it.lowered_check ? { lowered_check: it.lowered_check } : {}) };
    if (sc.forms && sc.forms.render) holder.append(sc.forms.render(form, { key: 'rs-' + it.id }));
    else holder.innerHTML = `<pre class="rs-pre">${esc(craft)}</pre>`;
  };

  /* ----- model refresh ----- */
  const refresh = async (force) => {
    const me = ++seq; const code = programText(); const mentions = [/\batoms?\b/.test(code) && 'atoms', /\bhooks\./.test(code) && 'hooks', /voxBank/.test(code) && 'vox-bank'].filter(Boolean);
    const kinds = [...new Set([...mentions, ...(st.tab === 'available' ? ['atoms', 'hooks', 'vox-bank'] : [])])];
    await loadVox(); const host = await siteHost(code, kinds.filter((k) => k !== 'vox-bank')); if (me !== seq) return; st.host = host;
    st.model = R.buildModel(code, host); st.code = code;
    if (st.tab === 'available' || force === 'avail') st.avail = avail(host);
    draw(); o.onModel && o.onModel(st.model);
  };
  const draw = () => {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === st.tab));
    banner.hidden = st.tab !== 'program' || !(st.model && st.model.missing.length); orgHost.hidden = st.tab !== 'available' || !org;
    const sy = body.scrollTop; if (st.tab === 'program') drawProgram(); else drawAvail();
    body.scrollTop = sy; if (st.tab === 'program') { bar.querySelector('.rs-prob') || 0; }
  };
  let timer = 0; const soon = () => { clearTimeout(timer); timer = setTimeout(() => refresh(), 350); };
  const offs = [];
  const listen = (t, ev, f, opt) => { t.addEventListener(ev, f, opt); offs.push(() => t.removeEventListener(ev, f, opt)); };
  for (const id of ['code', 'stackCode']) { const t = document.getElementById(id); if (t) listen(t, 'input', soon); }
  for (const ev of ['live:ok', 'strudel:idle', 'live:swap', 'sc:packs']) listen(window, ev, soon);
  if (sc.packs && sc.packs.on) { const off = sc.packs.on('report', soon); offs.push(off); const off2 = sc.packs.on('state', soon); offs.push(off2); }
  const edv = () => view(); /* CodeMirror's own doc change (typing, completions) updates the textarea through its sync; poll the text cheaply as the last resort */
  const poll = setInterval(() => { if (root.isConnected && programText() !== st.code && st.tab) soon(); }, 1200); offs.push(() => clearInterval(poll));

  /* ----- events ----- */
  const goto = (n) => { if (o.beforeGoto) o.beforeGoto(); gotoLine(+n); };
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button,input'); if (!t || !root.contains(t)) return;
    if (t.dataset.tab) { st.tab = t.dataset.tab; st.open.clear(); draw(); if (st.tab === 'available' && !st.avail) refresh('avail'); else if (st.tab === 'available') drawAvail(); return; }
    if (t.classList.contains('rs-head')) { const id = t.closest('.rs-card').dataset.id; st.open.has(id) ? st.open.delete(id) : st.open.add(id); draw(); return; }
    if (t.classList.contains('rs-k')) { st.kind = t.dataset.kind; draw(); return; }
    if (t.dataset.retry) { const it = byId(t.dataset.retry); if (it) { st.bodyErr.delete(bodyKey(it)); drawAvail(); } return; }
    if (t.dataset.go) { goto(t.dataset.go); return; }
    if (t.dataset.open) { st.open.add(t.dataset.open); st.kind = 'all'; st.problems = false; st.flash = t.dataset.open; draw(); body.querySelector(`[data-id="${CSS.escape(t.dataset.open)}"]`)?.scrollIntoView({ block: 'nearest' }); return; }
    if (t.dataset.copy) { copy(t.dataset.copy); return; }
    if (t.dataset.copyItem) { const it = byId(t.dataset.copyItem); if (it) copy(it.play || it.snippet || it.ref || it.name); return; }
    if (t.dataset.more) { st.more[t.dataset.more] = (st.more[t.dataset.more] || PAGE) + PAGE; drawAvail(); return; }
    if (t.dataset.fix) { const r = st.model.refs.find((x) => x.id === t.dataset.fix); if (r && r.fixLine) done(insertReference({ insert: { type: 'import', text: r.fixLine } }), r.fixLine); return; }
    if (t.dataset.insert) { const it = byId(t.dataset.insert); if (!it) return; if (it.kind === 'hooks') { const slot = (st.model && st.model.refs.find((r) => r.kind === 'slot' && r.status.includes('info'))); const text = `hooks.bind("${slot ? slot.name : 'slot'}", "${it.name}")`; done(insertReference({ ...it, insert: { type: 'bind', text } }), text); } else done(insertReference(it), it.insert.text, it); return; }
    if (t.dataset.play) { const it = byId(t.dataset.play); if (it && sc.quickplay) sc.quickplay.press(t, () => ({ key: 'res:' + it.id, title: it.name, code: it.play })); return; }
    if (t.matches('.rs-deep-i')) { st.deep = t.checked; deepLoad(); return; }
    if (t.matches('.rs-prob input')) { st.problems = t.checked; draw(); }
  });
  root.addEventListener('input', (e) => { if (e.target.matches('.rs-q')) { st.q = e.target.value; st.avail = avail(); const pos = e.target.selectionStart; drawAvail(); const q = bar.querySelector('.rs-q'); q.focus({ preventScroll: true }); q.setSelectionRange(pos, pos); } });
  root.addEventListener('keydown', (e) => e.stopPropagation());
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch { const x = document.createElement('textarea'); x.value = text; x.style.cssText = 'position:fixed;opacity:0'; document.body.append(x); x.select(); try { document.execCommand('copy'); } catch { /* none */ } x.remove(); } toast('Copied ' + (text.length > 40 ? text.slice(0, 40) + '…' : text), { kind: 'ok', ms: 1800 }); };
  const done = (r, text, it) => {
    if (!r.ok) { toast('Could not insert: ' + (r.why || 'no editor'), { kind: 'error' }); return; }
    if (r.noop) { if (it && it.ref) copy(it.ref); else toast('Already in the program', { kind: 'info', ms: 2200 }); if (it && it.ref) toast(`Already imported; copied ${it.ref}`, { kind: 'info', ms: 2400 }); return; }
    toast(`Inserted at line ${r.line}: ${text.length > 46 ? text.slice(0, 46) + '…' : text}`, { kind: 'ok', ms: 4000, action: { label: 'Go to line', run: () => goto(r.line) } });
    soon();
  };
  const api = { root, st, refresh, ready: refresh(), open(id) { st.tab = 'program'; st.open.add(id); st.flash = id; st.kind = 'all'; draw(); const c = body.querySelector(`[data-id="${CSS.escape(id)}"]`); if (c) c.scrollIntoView({ block: 'nearest' }); return !!c; }, search(q) { st.tab = 'available'; st.q = q; return refresh('avail'); }, dispose() { offs.forEach((f) => f && f()); clearTimeout(timer); } };
  return api;
}

/* ---------------- sheet + pane ---------------- */
function loadCss() {
  if (document.querySelector('link[data-rs]')) return Promise.resolve();
  return new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('resources.css', import.meta.url).href; l.dataset.rs = ''; l.onload = ok; l.onerror = ok; document.head.append(l); });
}
let sheet = null, panel = null;
export async function openSheet(o = {}) {
  await loadCss();
  if (!sheet) {
    sheet = document.createElement('dialog'); sheet.className = 'rs-sheet'; sheet.id = 'resourcesSheet'; sheet.setAttribute('aria-labelledby', 'rsTitle');
    sheet.innerHTML = '<div class="help-head"><h2 id="rsTitle">Resources</h2><button type="button" class="icon" id="rsClose" aria-label="Close resources">&times;</button></div><div class="rs-host"></div>';
    sheet.querySelector('#rsClose').addEventListener('click', () => sheet.close());
    sheet.addEventListener('keydown', (e) => e.stopPropagation()); sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
    sheet.addEventListener('close', () => { if (sc.quickplay && sc.quickplay.state.key && String(sc.quickplay.state.key).startsWith('res:')) sc.quickplay.stop('fast'); });
    document.body.append(sheet);
    panel = createPanel(sheet.querySelector('.rs-host'), { beforeGoto: () => sheet.close(), tab: o.tab });
  }
  if (o.tab) { panel.st.tab = o.tab; }
  if (!sheet.open) sheet.showModal();
  await panel.refresh(o.tab === 'available' ? 'avail' : undefined);
  (sheet.querySelector('.rs-tabs [aria-selected="true"]') || sheet.querySelector('#rsClose')).focus({ preventScroll: true });
  return panel;
}
export async function mount(el) { await loadCss(); el.classList.add('rs-pane'); return createPanel(el, { id: 'rsp' + ++paneN }); }
export async function openLink(h) { /* #res=<id> or #res=available:<query> */
  const v = decodeURIComponent(String(h).replace(/^#?res=?/, '')); const p = await openSheet(v.startsWith('available:') ? { tab: 'available' } : {});
  if (v.startsWith('available:')) await p.search(v.slice(10)); else if (v) { await p.refresh(); if (!p.open(v)) await p.search(v.replace(/^[a-z]+:/, '')); }
  return p;
}
sc.resources = sc.resources || {}; Object.assign(sc.resources, { openSheet, mount, openLink, insertReference, gotoLine, model: () => (panel && panel.st.model) || null });
Object.defineProperties(sc.resources, { panel: { get: () => panel, configurable: true }, sheet: { get: () => sheet, configurable: true } });
