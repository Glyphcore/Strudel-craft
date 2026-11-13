/* Live progress checklist in the ? dialog, read from the public tracker issue Glyphcore/Strudel-craft#56 (unauthenticated).
   "## Heading" = group, "- [x]" done, "- [ ]" open, "(~)" in progress. Polls with If-None-Match (304s are free):
   60 s while the dialog is open, 5 min while closed. Falls back to the cached copy (localStorage) with a toast. */
const REPO = 'Glyphcore/Strudel-craft', ISSUE = 56;
const API = `https://api.github.com/repos/${REPO}/issues/${ISSUE}`;
const LABELS = `https://api.github.com/repos/${REPO}/issues?state=open&per_page=50`;
const CK = 'sctrack.cache'; // not "sc." so it stays out of the history store
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function parse(md) {
  const groups = []; let g = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(line); if (h) { g = { title: h[1], items: [] }; groups.push(g); continue; }
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line); if (!m) continue;
    if (!g) { g = { title: 'Tasks', items: [] }; groups.push(g); }
    let text = m[2].trim(); const wip = /\(~\)/.test(text); text = text.replace(/\(~\)\s*/g, '').trim();
    g.items.push({ text, state: m[1].toLowerCase() === 'x' ? 'done' : wip ? 'wip' : 'open' });
  }
  return groups.filter((x) => x.items.length);
}
const load = () => { try { return JSON.parse(localStorage.getItem(CK)) || {}; } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(CK, JSON.stringify(o)); } catch (e) { /* full */ } };
let cache = load(); let prev = null; let timer = 0; let failedOnce = false;
const toast = (m, kind) => window.strudelCraft && window.strudelCraft.ui && window.strudelCraft.ui.toast(m, { kind, ms: 8000 });

async function get(url, etag) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...(etag ? { 'If-None-Match': etag } : {}) }, cache: 'no-store' });
  if (r.status === 304) return { notModified: true };
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? 'rate limited' : 'HTTP ' + r.status);
  return { etag: r.headers.get('ETag'), json: await r.json() };
}
async function poll() {
  if (!navigator.onLine) { cache.err = 'offline'; render(); schedule(); return; }
  try {
    const a = await get(API, cache.etag);
    if (!a.notModified) { cache = { ...cache, etag: a.etag, body: a.json.body, title: a.json.title, url: a.json.html_url }; }
    try { const b = await get(LABELS, cache.letag); if (!b.notModified) cache = { ...cache, letag: b.etag, status: b.json.filter((i) => !i.pull_request && i.labels.some((l) => /^status:/.test(l.name))).map((i) => ({ n: i.number, t: i.title, url: i.html_url, s: i.labels.filter((l) => /^status:/.test(l.name)).map((l) => l.name.slice(7)).join(', ') })) }; } catch (e) { /* optional */ }
    cache.at = Date.now(); cache.err = null; save(cache); failedOnce = false;
  } catch (e) { cache.err = e.message; if (!failedOnce || ($('#help') && $('#help').open)) toast('Progress tracker: ' + e.message + ', showing the cached copy', 'info'); failedOnce = true; }
  render(); schedule();
}
function schedule() { clearTimeout(timer); const open = $('#help') && $('#help').open; timer = setTimeout(poll, open ? 60000 : 300000); }
function ago(t) { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; }
const pct = (items) => { const d = items.filter((i) => i.state === 'done').length + 0.5 * items.filter((i) => i.state === 'wip').length; return items.length ? Math.round((100 * d) / items.length) : 0; };
function bar(p, label) { return `<div class="tk-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`; }
function render() {
  const host = $('#tracker'); if (!host) return;
  const groups = parse(cache.body); const all = groups.flatMap((g) => g.items);
  const before = prev || new Map(); const now = new Map(all.map((i) => [i.text, i.state]));
  host.innerHTML = groups.length ? `
    <div class="tk-head"><b>Progress</b> <span class="tk-pct">${pct(all)}%</span> <a href="${esc(cache.url || '#')}" target="_blank" rel="noopener" class="tk-src">#${ISSUE}</a> <span class="tk-ago" id="tkAgo">updated ${ago(cache.at)}</span>${cache.err ? `<span class="tk-err">cached copy (${esc(cache.err)})</span>` : ''}</div>
    ${bar(pct(all), 'Overall progress')}
    ${groups.map((g) => `<section class="tk-g"><div class="tk-gh"><span>${esc(g.title)}</span><span>${g.items.filter((i) => i.state === 'done').length}/${g.items.length}</span></div>${bar(pct(g.items), g.title + ' progress')}
      <ul>${g.items.map((i) => `<li class="tk-${i.state}${prev && before.get(i.text) !== i.state ? ' tk-changed' : ''}"><span class="tk-dot" aria-hidden="true"></span><span class="sr">${i.state === 'done' ? 'done' : i.state === 'wip' ? 'in progress' : 'open'}: </span>${esc(i.text)}</li>`).join('')}</ul></section>`).join('')}
    ${cache.status && cache.status.length ? `<section class="tk-g"><div class="tk-gh"><span>Open issues by status</span></div><ul>${cache.status.map((s) => `<li class="tk-open"><a href="${esc(s.url)}" target="_blank" rel="noopener">#${s.n}</a> ${esc(s.t)} <em>${esc(s.s)}</em></li>`).join('')}</ul></section>` : ''}`
    : `<p class="tk-ago">${cache.err ? 'Progress tracker unavailable (' + esc(cache.err) + ')' : 'Progress tracker loading…'}</p>`;
  prev = now;
}
function ui() {
  const d = $('#help'); if (!d) return;
  const box = document.createElement('div'); box.id = 'tracker'; box.className = 'tracker'; box.setAttribute('aria-live', 'polite');
  d.append(box); render();
  new MutationObserver(() => { if (d.open) { poll(); } else schedule(); }).observe(d, { attributes: true, attributeFilter: ['open'] });
  setInterval(() => { const a = $('#tkAgo'); if (a) a.textContent = 'updated ' + ago(cache.at); }, 1000);
  poll();
}
window.addEventListener('online', () => poll());
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
window.strudelCraft = window.strudelCraft || {}; window.strudelCraft.tracker = { parse, poll, data: () => cache };
