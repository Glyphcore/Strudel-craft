/* Git-like client-side version history for all persisted site state (localStorage keys "sc.*").
   Content-addressed: blobs (SHA-256 of the value) are stored once; a commit is {id, parent, time, label, tree, changed}.
   Storage: IndexedDB "sc-history" (localStorage "schist.*" fallback). Diffs use jsdiff (diff@5.2.0, esm.sh), loaded on demand.
   API: window.strudelCraft.history = { commit, log, diff, checkout, search, subscribe, undo, redo, head, get, snapshot, docs: {put,get,list,revs,delete,subscribe} } */
const OWN = (k) => k.startsWith('sc.') && k !== 'sc.theme.tmp';
const nativeSet = Storage.prototype.setItem, nativeRemove = Storage.prototype.removeItem;

/* ---------- storage backend ---------- */
/* Schema versions: 1 = blobs, commits, meta. 2 = adds "docs" (keyed documents, library). The upgrade only creates missing stores and never touches existing ones. */
const DB_VERSION = 2;
const notify = (m, kind) => { try { window.strudelCraft.ui.toast(m, { kind: kind || 'info', ms: 8000 }); } catch (e) { setTimeout(() => { try { window.strudelCraft.ui.toast(m, { kind: kind || 'info', ms: 8000 }); } catch (e2) { console.warn('history:', m); } }, 1500); } };
const idb = new Promise((res) => {
  try {
    const rq = indexedDB.open('sc-history', DB_VERSION);
    rq.onupgradeneeded = () => { const db = rq.result; for (const [n, o] of [['blobs'], ['commits', { keyPath: 'id' }], ['meta'], ['docs']]) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, o); };
    rq.onblocked = () => notify('History is upgrading but another Strudel Craft tab is still open on the old version. Close or reload the other tabs; nothing is lost.', 'error');
    rq.onsuccess = () => { const db = rq.result; db.onversionchange = () => { db.close(); notify('Strudel Craft was updated in another tab. Reload this tab to keep saving history.', 'error'); }; res(db); };
    rq.onerror = () => res(null);
  } catch (e) { res(null); }
});
function tx(db, store, mode, fn) { return new Promise((res, rej) => { const t = db.transaction(store, mode); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); }
const LSP = 'schist.';
const backend = {
  async get(store, key) { const db = await idb; if (db) return tx(db, store, 'readonly', (s) => s.get(key)); try { return JSON.parse(localStorage.getItem(LSP + store + '.' + key)); } catch (e) { return undefined; } },
  async put(store, key, val) { const db = await idb; if (db) return tx(db, store, 'readwrite', (s) => (store === 'commits' ? s.put(val) : s.put(val, key))); try { nativeSet.call(localStorage, LSP + store + '.' + key, JSON.stringify(val)); } catch (e) { /* full */ } },
  async all(store) { const db = await idb; if (db) return tx(db, store, 'readonly', (s) => s.getAll()); const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LSP + store + '.')) try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) { /* skip */ } } return out; },
};

async function hash(text) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) {
    let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return 'f' + h.toString(16) + text.length.toString(16);
  }
}

/* ---------- core ---------- */
const subs = new Set(); const blobCache = new Map(); let commits = null; let head = null; let redoStack = [];
const emit = (type, data) => subs.forEach((f) => { try { f({ type, ...data }); } catch (e) { /* ignore */ } });
async function load() { if (!commits) { commits = new Map(((await backend.all('commits')) || []).map((c) => [c.id, c])); head = (await backend.get('meta', 'head')) || null; redoStack = (await backend.get('meta', 'redo')) || []; } }
async function saveMeta() { await backend.put('meta', 'head', head); await backend.put('meta', 'redo', redoStack); }
const UI_KEYS = { 'ui:rack-editor': 'Rack editor', 'ui:stack-editor': 'Stack editor', 'ui:panel': 'Visible panel' };
function uiText() {
  /* full editor docs (textarea mirrors the whole CodeMirror doc; the DOM is virtualised) + visible panel text */
  const o = {}; const v = (id) => { const t = document.getElementById(id); return t ? (t.cmView ? t.cmView.state.doc.toString() : t.value) : ''; };
  o['ui:rack-editor'] = v('code'); o['ui:stack-editor'] = v('stackCode');
  const parts = []; for (const sel of ['#nowTitle', '#srcLabel', '#inspector', '#status', '#liveMsg', '#liveMsgStack']) { const e = document.querySelector(sel); if (e && !e.hidden && e.innerText) parts.push(e.innerText.trim()); }
  o['ui:panel'] = parts.join('\n'); return o;
}
function snapshot() { const s = { ...uiText() }; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (OWN(k)) s[k.slice(3)] = localStorage.getItem(k); } return s; }
async function blob(h) { if (blobCache.has(h)) return blobCache.get(h); const v = await backend.get('blobs', h); blobCache.set(h, v); return v; }
async function treeOf(state) { const t = {}; for (const [k, v] of Object.entries(state)) { const h = await hash(v); t[k] = h; if (!blobCache.has(h)) { blobCache.set(h, v); await backend.put('blobs', h, v); } } return t; }
async function stateOf(id) { const c = commits.get(id); if (!c) return null; const s = {}; for (const [k, h] of Object.entries(c.tree)) s[k] = await blob(h); return s; }
const same = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };

let busy = Promise.resolve();
const serial = (fn) => (busy = busy.then(fn, fn));

async function commit(label = 'edit', opts = {}) {
  return serial(async () => {
    await load(); const tree = await treeOf(snapshot()); const parent = head ? commits.get(head) : null;
    if (parent && same(parent.tree, tree) && !opts.force) return parent;
    const keys = new Set([...Object.keys(tree), ...Object.keys(parent ? parent.tree : {})]);
    const changed = [...keys].filter((k) => !parent || parent.tree[k] !== tree[k]);
    const time = Date.now(); const id = (await hash(JSON.stringify({ tree, parent: head, time, label }))).slice(0, 12);
    const c = { id, parent: head, time, label, auto: !!opts.auto, named: !!opts.named, tree, changed };
    commits.set(id, c); await backend.put('commits', id, c); head = id; if (!opts.keepRedo) redoStack = []; await saveMeta();
    emit('commit', { commit: c }); return c;
  });
}
async function log() { await load(); return [...commits.values()].sort((a, b) => b.time - a.time).map(({ tree, ...c }) => ({ ...c, head: c.id === head })); }
async function get(id) { await load(); return stateOf(id); }
async function checkout(id, opts = {}) {
  return serial(async () => {
    await load(); const s = await stateOf(id); if (!s) throw new Error('no such state ' + id);
    suppress = true;
    try {
      const cur = snapshot(); for (const k of Object.keys(cur)) if (!k.startsWith('ui:') && !(k in s)) nativeRemove.call(localStorage, 'sc.' + k);
      for (const [k, v] of Object.entries(s)) if (v != null && !k.startsWith('ui:')) nativeSet.call(localStorage, 'sc.' + k, v);
      try { window.strudelCraft.app && window.strudelCraft.app.reload(); } catch (e) { console.warn('history: app reload failed', e); window.strudelCraft.ui && window.strudelCraft.ui.toast('History restore could not refresh the page state', { kind: 'error' }); }
    } finally { setTimeout(() => { suppress = false; }, 50); }
    if (!opts.fromUndo) redoStack = []; head = id; await saveMeta(); emit('checkout', { id }); return id;
  });
}
async function undo() { await flush(); await load(); const c = head && commits.get(head); if (!c || !c.parent) return null; redoStack.push(head); await checkout(c.parent, { fromUndo: true }); return c.parent; }
async function redo() { await load(); const id = redoStack.pop(); if (!id) return null; await checkout(id, { fromUndo: true }); return id; }

function pretty(v) { if (v == null) return ''; try { const o = JSON.parse(v); if (typeof o === 'string') return o; if (o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every((x) => typeof x === 'string')) return Object.entries(o).map(([k, x]) => `## ${k}\n${x}`).join('\n'); return JSON.stringify(o, null, 2); } catch (e) { return v; } }
let jsdiff = null;
async function diff(a, b) {
  await load(); if (!jsdiff) jsdiff = await import('https://esm.sh/diff@5.2.0');
  const sa = (a ? await stateOf(a) : {}) || {}, sb = (b ? await stateOf(b) : snapshot()) || {};
  const out = [];
  for (const k of [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort()) {
    if (sa[k] === sb[k]) continue;
    out.push({ key: k, status: !(k in sa) ? 'added' : !(k in sb) ? 'removed' : 'changed', hunks: jsdiff.diffLines(pretty(sa[k]), pretty(sb[k])).map((p) => ({ op: p.added ? '+' : p.removed ? '-' : '=', text: p.value })) });
  }
  return out;
}
async function search(q, opts = {}) {
  await load(); const re = q instanceof RegExp ? q : opts.regex ? new RegExp(q, opts.flags || 'i') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const res = [];
  for (const c of [...commits.values()].sort((x, y) => y.time - x.time)) {
    const hits = [];
    for (const [k, h] of Object.entries(c.tree)) {
      const text = pretty(await blob(h)); const lines = text.split('\n');
      lines.forEach((ln, i) => { re.lastIndex = 0; if (re.test(ln)) hits.push({ key: k, field: UI_KEYS[k] || ('saved ' + k), line: i + 1, context: ln.trim().slice(0, 160) }); });
    }
    if (hits.length) res.push({ id: c.id, time: c.time, label: c.label, hits: hits.slice(0, 8) });
  }
  return res;
}
function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

/* ---------- docs: keyed, revisioned documents (own object store "docs"; never part of the timeline, undo/redo or search) ----------
   One record per document key "ns\u0000id": { ns, id, revs: [{ rev, hash, time, doc }] } (revs oldest first, rev = index + 1). */
const dsubs = new Map();
const derr = (code, msg) => Object.assign(new Error(code + ' ' + msg), { code });
const dkey = (ns, id) => { if (typeof ns !== 'string' || !ns || typeof id !== 'string' || !id) throw derr('E_DOC_ARG', 'ns and id must be non-empty strings'); return ns + '\u0000' + id; };
const dclone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function docRmw(key, fn) {
  /* one readwrite transaction: read, decide, write (atomic across tabs) */
  return idb.then((db) => new Promise((res, rej) => {
    if (!db) { try { const cur = JSON.parse(localStorage.getItem(LSP + 'docs.' + key)); const [next, out] = fn(cur); if (next) nativeSet.call(localStorage, LSP + 'docs.' + key, JSON.stringify(next)); else if (next === null) nativeRemove.call(localStorage, LSP + 'docs.' + key); res(out); } catch (e) { rej(e); } return; }
    let out, failed = null; const t = db.transaction('docs', 'readwrite'); const s = t.objectStore('docs');
    const g = s.get(key);
    g.onsuccess = () => { try { const [next, o] = fn(g.result); out = o; if (next) s.put(next, key); else if (next === null) s.delete(key); } catch (e) { failed = e; t.abort(); } };
    t.oncomplete = () => res(out); t.onabort = () => rej(failed || t.error || derr('E_DOC_IO', 'transaction aborted')); t.onerror = () => {};
  }));
}
async function docRead(key) { const db = await idb; if (db) return tx(db, 'docs', 'readonly', (s) => s.get(key)); try { return JSON.parse(localStorage.getItem(LSP + 'docs.' + key)); } catch (e) { return undefined; } }
const dfire = (ns, ev) => (dsubs.get(ns) || []).forEach((f) => { try { f(ev); } catch (e) { /* subscriber errors never break a put */ } });
const docs = {
  async put(ns, id, doc, opts = {}) {
    const key = dkey(ns, id); if (doc === undefined) throw derr('E_DOC_ARG', 'doc is required');
    const text = JSON.stringify(doc), h = await hash(text), want = opts.rev; let added = false;
    const r = await docRmw(key, (cur) => {
      const rec = cur || { ns, id, revs: [] }, last = rec.revs[rec.revs.length - 1];
      if (want !== undefined) {
        if (!Number.isInteger(want) || want < 1) throw derr('E_DOC_REV', 'rev must be a positive integer');
        const old = rec.revs[want - 1]; if (old) { if (old.hash !== h) throw derr('E_DOC_IMMUTABLE', id + '@' + want + ' is stored and cannot be overwritten'); return [undefined, { rev: want, hash: h }]; }
        if (want !== rec.revs.length + 1) throw derr('E_DOC_REV', id + ' next rev is ' + (rec.revs.length + 1) + ', got ' + want);
      } else if (last && last.hash === h) return [undefined, { rev: last.rev, hash: h }];
      const rev = rec.revs.length + 1; rec.revs.push({ rev, hash: h, time: Date.now(), doc: JSON.parse(text) }); added = true; return [rec, { rev, hash: h }];
    });
    if (added) dfire(ns, { type: 'put', ns, id, rev: r.rev, hash: r.hash });
    return r;
  },
  async get(ns, id, rev) { const rec = await docRead(dkey(ns, id)); if (!rec || !rec.revs.length) return undefined; const r = rev === undefined ? rec.revs[rec.revs.length - 1] : rec.revs[rev - 1]; return r && { id, rev: r.rev, hash: r.hash, time: r.time, doc: dclone(r.doc) }; },
  async list(ns) { dkey(ns, '-'); const all = (await backend.all('docs')) || []; return all.filter((r) => r && r.ns === ns && r.revs.length).map((r) => { const l = r.revs[r.revs.length - 1]; return { id: r.id, rev: l.rev, hash: l.hash, time: l.time }; }).sort((a, b) => (a.id < b.id ? -1 : 1)); },
  async revs(ns, id) { const rec = await docRead(dkey(ns, id)); return rec ? rec.revs.map(({ rev, hash, time }) => ({ rev, hash, time })) : []; },
  async delete(ns, id) { const key = dkey(ns, id); const had = await docRmw(key, (cur) => [cur ? null : undefined, !!cur]); if (had) dfire(ns, { type: 'delete', ns, id }); return had; },
  subscribe(ns, fn) { dkey(ns, '-'); if (typeof fn !== 'function') throw derr('E_DOC_ARG', 'fn must be a function'); if (!dsubs.has(ns)) dsubs.set(ns, new Set()); dsubs.get(ns).add(fn); return () => dsubs.get(ns).delete(fn); },
};

/* ---------- auto-commit on debounced persisted edits ---------- */
let suppress = false, autoT = 0, pending = null;
function schedule(label) { pending = label; clearTimeout(autoT); autoT = setTimeout(() => { const l = pending; pending = null; commit(l, { auto: true }); }, 1200); }
async function flush() { if (pending) { clearTimeout(autoT); const l = pending; pending = null; await commit(l, { auto: true }); } return busy; }
/* editor keys commit from the shared settle scheduler (app.js settleRun, CONTROL_BINDING section 4) once it exists */
const SETTLED = new Set(['sc.edits', 'sc.stackEdit']); const viaSettle = (k) => SETTLED.has(String(k)) && !!(window.strudelCraft && window.strudelCraft.settle);
Storage.prototype.setItem = function (k, v) { nativeSet.call(this, k, v); if (this === localStorage && !suppress && OWN(String(k)) && !viaSettle(k)) schedule(({ edits: 'code edit', stack: 'stack change', stackEdit: 'stack code edit', tempo: 'tempo', master: 'master level', live: 'live toggle', theme: 'theme', 'intellisense.user': 'learned names' })[String(k).slice(3)] || 'edit ' + String(k).slice(3)); };
Storage.prototype.removeItem = function (k) { nativeRemove.call(this, k); if (this === localStorage && !suppress && OWN(String(k))) schedule('remove ' + String(k).slice(3)); };
/* any editor content change, whatever the source (typing, preset load, paste, tab switch, swap, restore) */
let lastUi = '';
setInterval(() => { if (suppress || document.hidden) return; const u = uiText(); const key = u['ui:rack-editor'] + '\u0000' + u['ui:stack-editor']; if (key !== lastUi) { const first = !lastUi; lastUi = key; if (!first && !(window.strudelCraft && window.strudelCraft.settle)) schedule('editor change'); } }, 700);
/* leaving or hiding the page: write the pending autosave now (the debounce timer may never fire in a frozen or discarded page) */
window.addEventListener('pagehide', () => { flush(); }); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('live:swap', (e) => { clearTimeout(autoT); pending = null; commit('live swap: ' + e.detail.id + (e.detail.why ? ' (' + e.detail.why + ')' : ''), { auto: true, force: true }); });

const api = { docs, commit: (label, o) => commit(label, { ...(o || {}), named: !!label && !(o && o.auto) }), log, diff, checkout, search, subscribe, undo, redo, get, snapshot, flush, head: () => head };
window.strudelCraft = window.strudelCraft || {}; window.strudelCraft.history = api;
load().then(() => { if (!head) commit('initial state', { auto: true }); });

/* ---------- UI: dialog with timeline scrubber, diff, search ---------- */
const $ = (s) => document.querySelector(s);
const fmtTime = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let list = []; let sel = null;
function renderDiff(target, d) {
  target.innerHTML = d.length ? d.map((f) => `<div class="hd-file"><b>${esc(f.key)}</b> <span class="hd-st">${f.status}</span></div><pre class="hd-pre">${f.hunks.map((h) => h.op === '=' ? `<span class="hd-eq">${esc(h.text.split('\n').slice(-3).join('\n'))}</span>` : `<span class="hd-${h.op === '+' ? 'add' : 'del'}">${esc(h.text.replace(/^(?=.)/gm, h.op + ' '))}</span>`).join('')}</pre>`).join('') : '<p class="hd-none">No differences.</p>';
}
async function refresh() {
  const dlg = $('#histDlg'); if (!dlg || !dlg.open) return;
  list = (await log()).reverse(); const sc = $('#histScrub'); sc.max = Math.max(0, list.length - 1);
  if (sel == null || !list.find((c) => c.id === sel)) sel = head; const i = Math.max(0, list.findIndex((c) => c.id === sel)); sc.value = i;
  const opts = list.map((c, j) => `<option value="${c.id}">#${j + 1} ${esc(c.label)} - ${fmtTime(c.time)}</option>`).reverse().join('');
  for (const id of ['#histA', '#histB']) { const s = $(id); const v = s.value; s.innerHTML = opts; if (v) s.value = v; }
  if (!$('#histA').value || !list.find((c) => c.id === $('#histA').value)) $('#histA').value = (list[list.length - 2] || list[0] || {}).id || '';
  if (!$('#histB').value) $('#histB').value = head || '';
  await showSel();
}
async function showSel() {
  const c = list.find((x) => x.id === sel); if (!c) return;
  $('#histInfo').textContent = `#${list.indexOf(c) + 1}/${list.length} · ${c.label} · ${fmtTime(c.time)}${c.id === head ? ' · current' : ''} · changed: ${c.changed.join(', ') || '-'}`;
  $('#histRestore').disabled = c.id === head;
  renderDiff($('#histPreview'), await diff(c.id, null));
}
function ui() {
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'icon'; btn.id = 'histBtn'; btn.title = 'History (H)'; btn.setAttribute('aria-label', 'Version history'); btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const tools = $('.top .tools'); if (tools) tools.prepend(btn);
  const d = document.createElement('dialog'); d.id = 'histDlg'; d.setAttribute('aria-labelledby', 'histTitle'); d.className = 'hist';
  d.innerHTML = `<div class="help-head"><h2 id="histTitle">History</h2><button type="button" class="icon" id="histClose" aria-label="Close history">&times;</button></div>
  <div class="hist-body">
    <div class="hist-row"><button type="button" class="ghost" id="histUndo">Undo</button><button type="button" class="ghost" id="histRedo">Redo</button><button type="button" class="ghost" id="histSnap">Snapshot</button></div>
    <label class="hist-lab" for="histScrub">Timeline</label>
    <div class="hist-row"><button type="button" class="ghost" id="histPrev" aria-label="Older state">&lsaquo;</button><input type="range" id="histScrub" min="0" max="0" step="1"><button type="button" class="ghost" id="histNext" aria-label="Newer state">&rsaquo;</button></div>
    <p class="hist-info" id="histInfo"></p>
    <div class="hist-row"><button type="button" id="histRestore">Restore this state</button></div>
    <details><summary>Changes from this state to now</summary><div id="histPreview" class="hist-diff"></div></details>
    <h3 class="hist-lab">Diff any two states</h3>
    <div class="hist-row hist-col"><select id="histA" aria-label="From state"></select><select id="histB" aria-label="To state"></select><button type="button" class="ghost" id="histDiffBtn">Diff</button></div>
    <div id="histDiff" class="hist-diff"></div>
    <h3 class="hist-lab">Search history</h3>
    <div class="hist-row"><input type="search" id="histQ" placeholder="text or /regex/" aria-label="Search history"><label class="hist-re"><input type="checkbox" id="histRe"> regex</label></div>
    <ol id="histHits" class="hist-hits"></ol>
  </div>`;
  document.body.append(d);
  const say = (m, kind) => window.strudelCraft.ui.toast(m, { kind: kind || 'ok' });
  btn.addEventListener('click', () => { if (!d.open) d.showModal(); flush().then(refresh); });
  $('#histClose').addEventListener('click', () => d.close());
  $('#histUndo').addEventListener('click', async () => { const id = await undo(); say(id ? 'Undone' : 'Nothing to undo', id ? 'ok' : 'info'); sel = head; refresh(); });
  $('#histRedo').addEventListener('click', async () => { const id = await redo(); say(id ? 'Redone' : 'Nothing to redo', id ? 'ok' : 'info'); sel = head; refresh(); });
  $('#histSnap').addEventListener('click', async () => { const n = await window.strudelCraft.ui.ask({ title: 'Name this snapshot', label: 'Snapshot name', value: 'snapshot ' + new Date().toLocaleTimeString(), okText: 'Save' }); if (n == null) return; await flush(); await commit(n, { named: true, force: true }); sel = head; refresh(); say('Snapshot saved: ' + n); });
  const scrub = (i) => { i = Math.max(0, Math.min(list.length - 1, i)); $('#histScrub').value = i; sel = list[i] && list[i].id; showSel(); };
  $('#histScrub').addEventListener('input', (e) => scrub(+e.target.value));
  $('#histPrev').addEventListener('click', () => scrub(+$('#histScrub').value - 1));
  $('#histNext').addEventListener('click', () => scrub(+$('#histScrub').value + 1));
  $('#histRestore').addEventListener('click', async () => { if (!sel) return; await flush(); await checkout(sel); await commit('restore #' + (list.findIndex((c) => c.id === sel) + 1), { auto: true, force: true }); sel = head; refresh(); say('Restored'); });
  $('#histDiffBtn').addEventListener('click', async () => renderDiff($('#histDiff'), await diff($('#histA').value, $('#histB').value)));
  let qT = 0;
  const runQ = async () => {
    const q = $('#histQ').value.trim(); const ol = $('#histHits'); if (!q) { ol.innerHTML = ''; return; }
    let rs; try { const m = /^\/(.+)\/([gimsuy]*)$/.exec(q); rs = m ? await search(m[1], { regex: true, flags: m[2] || 'i' }) : await search(q, { regex: $('#histRe').checked }); } catch (e) { ol.innerHTML = `<li class="hd-none">${esc(e.message)}</li>`; return; }
    if (!list.length) list = (await log()).reverse();
    ol.innerHTML = rs.length ? rs.map((r) => `<li><div class="hh-top"><b>#${list.findIndex((c) => c.id === r.id) + 1}</b> ${esc(r.label)} <time>${fmtTime(r.time)}</time></div>${r.hits.map((h) => `<div class="hh-ctx"><span>${esc(h.field)}:${h.line}</span> ${esc(h.context)}</div>`).join('')}<div class="hist-row"><button type="button" class="ghost" data-jump="${r.id}">Show</button><button type="button" class="ghost" data-restore="${r.id}">Restore</button></div></li>`).join('') : '<li class="hd-none">No state matches.</li>';
  };
  $('#histQ').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(runQ, 200); }); $('#histRe').addEventListener('change', runQ);
  $('#histHits').addEventListener('click', async (e) => {
    const j = e.target.closest('[data-jump]'), r = e.target.closest('[data-restore]');
    if (j) { sel = j.dataset.jump; await refresh(); $('#histInfo').scrollIntoView({ block: 'center' }); }
    if (r) { await flush(); await checkout(r.dataset.restore); await commit('restore from search', { auto: true, force: true }); sel = head; refresh(); say('Restored'); }
  });
  subscribe(() => refresh());
  document.addEventListener('keydown', (e) => {
    const t = e.target; const field = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (!field && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); btn.click(); }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
