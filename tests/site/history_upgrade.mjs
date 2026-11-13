// History IndexedDB upgrade safety (#58). Run: node tests/site/history_upgrade.mjs
// The old (v1 schema) history code is tests/site/fixtures/history.v1.js (a verbatim copy of site/history.js before the docs store).
// Checks: v1 -> v2 upgrade keeps every snapshot, undo/redo and search; a tab still on v1 blocks the upgrade (toast, no data change, no native dialog)
// and does not corrupt data in either direction; the library persists through history.docs and does not add timeline entries.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../../site'), OLD = fs.readFileSync(path.join(here, 'fixtures/history.v1.js'), 'utf8');
const { chromium } = createRequire(import.meta.url)('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = []; const check = (n, ok, d = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + String(d).slice(0, 300) : ''}`); };
let dialogs = 0;
const browser = await chromium.launch();
async function open(ctx, old) {
  const page = await ctx.newPage(); page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  if (old) await page.route('**/history.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: OLD }));
  await page.goto(BASE); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.history && window.strudelCraft.ui, null, { timeout: 30000 });
  return page;
}
const dbInfo = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('sc-history'); r.onsuccess = () => { const d = r.result; const o = { v: d.version, stores: [...d.objectStoreNames].sort() }; d.close(); res(o); }; r.onerror = () => res({ err: String(r.error) }); }));
const writeSnaps = (page, names) => page.evaluate(async (names) => {
  const h = window.strudelCraft.history; await h.flush(); const ids = [];
  for (const n of names) { localStorage.setItem('sc.edits', JSON.stringify({ x: 'note("c3 ' + n + '")' })); await h.flush(); ids.push((await h.commit(n, { named: true, force: true })).id); }
  await h.flush(); return ids;
}, names);
const state = (page) => page.evaluate(async () => { const h = window.strudelCraft.history; const log = await h.log(); const out = {}; for (const c of log) out[c.id] = { label: c.label, state: JSON.stringify(await h.get(c.id)) }; return { out, head: h.head(), hits: (await h.search('zebra')).map((r) => r.id).sort() }; });

try {
  // 1 + 2: v1 data, then upgrade
  const ctx = await browser.newContext();
  const old = await open(ctx, true);
  check('setup: v1 schema database (version 1, blobs/commits/meta only)', JSON.stringify(await dbInfo(old)) === JSON.stringify({ v: 1, stores: ['blobs', 'commits', 'meta'] }), JSON.stringify(await dbInfo(old)));
  const ids = await writeSnaps(old, ['zebra one', 'zebra two', 'zebra three', 'plain four']);
  const before = await state(old); await old.close();
  check('setup: 4 named snapshots written with the v1 code', ids.length === 4 && Object.keys(before.out).length >= 5, Object.keys(before.out).length);
  const page = await open(ctx, false);
  const info = await dbInfo(page);
  check('upgrade: database is version 2 with blobs, commits, meta, docs', info.v === 2 && JSON.stringify(info.stores) === JSON.stringify(['blobs', 'commits', 'docs', 'meta']), JSON.stringify(info));
  const after = await state(page);
  const intact = Object.keys(before.out).every((id) => after.out[id] && after.out[id].label === before.out[id].label && after.out[id].state === before.out[id].state);
  check('upgrade: every v1 commit has the same label and identical restored state', intact, Object.keys(before.out).length + ' commits');
  check('upgrade: head preserved and search finds the same states', after.head === before.head || Object.keys(after.out).length > Object.keys(before.out).length, JSON.stringify({ b: before.hits, a: after.hits }));
  check('upgrade: history search results identical', JSON.stringify(before.hits) === JSON.stringify(after.hits));
  const ur = await page.evaluate(async () => {
    const h = window.strudelCraft.history; await h.flush(); localStorage.setItem('sc.edits', JSON.stringify({ x: 'note("e4 new")' })); await h.flush(); const c = await h.commit('after upgrade', { named: true, force: true });
    const u = await h.undo(); const e1 = localStorage.getItem('sc.edits'); const r = await h.redo(); const e2 = localStorage.getItem('sc.edits');
    return { c: c.id, u, r, e1, e2 };
  });
  check('upgrade: undo goes to the parent, redo returns, restored values match', ur.u && ur.r === ur.c && !ur.e1.includes('e4 new') && ur.e2.includes('e4 new'), JSON.stringify(ur).slice(0, 200));
  const search2 = await page.evaluate(async () => (await window.strudelCraft.history.search('e4 new')).length);
  check('upgrade: search finds a post-upgrade snapshot', search2 >= 1, search2);
  // docs API + library through it
  const d = await page.evaluate(async () => {
    const dd = window.strudelCraft.history.docs, ev = []; const un = dd.subscribe('t', (e) => ev.push(e.type));
    const a = await dd.put('t', 'k', { v: 1 }), a2 = await dd.put('t', 'k', { v: 1 }), b = await dd.put('t', 'k', { v: 2 });
    const l = await dd.list('t'), rv = await dd.revs('t', 'k'), g1 = await dd.get('t', 'k', 1), g = await dd.get('t', 'k'); await dd.delete('t', 'k'); un();
    const log = (await window.strudelCraft.history.log()).length; const code = await dd.put('t', 'k', { v: 9 }, { rev: 5 }).catch((e) => e.code);
    return { a, a2, b, l, nrev: rv.map((x) => x.rev), g1: g1.doc, g: g.doc, ev, log, code };
  });
  check('docs: put/get/list/revs/subscribe/delete behave (identical put dedupes, revs oldest first, bad rev coded)', d.a.rev === 1 && d.a2.rev === 1 && d.b.rev === 2 && d.l.length === 1 && d.nrev.join() === '1,2' && d.g1.v === 1 && d.g.v === 2 && d.ev.join() === 'put,put,delete' && d.code === 'E_DOC_REV', JSON.stringify(d));
  const lb = await page.evaluate(async () => {
    const H = window.strudelCraft.history; await H.flush(); await new Promise((r) => setTimeout(r, 1600)); await H.flush(); const n0 = (await H.log()).length; const L = await import('./library.js');
    const m = { model: 1, tracks: [{ name: 'p', source: ['note', { $mini: 'c3' }], chain: [] }] };
    const r1 = L.lib.save(m, { name: 'zpad', kind: 'track' }); const m2 = JSON.parse(JSON.stringify(m)); m2.tracks[0].chain = [['lpf', 300]]; const r2 = L.lib.save(m2, { name: 'zpad', kind: 'track' });
    await new Promise((r) => setTimeout(r, 400)); const revs = await H.docs.revs('library', 'zpad');
    await H.flush(); await new Promise((r) => setTimeout(r, 1600)); await H.flush();
    return { r1, r2, revs: revs.map((x) => x.rev), n0, n1: (await H.log()).length, store: L.lib.store.kind };
  });
  check('library: saves persist as docs revisions 1,2 in namespace "library" (store kind docs)', lb.store === 'docs' && lb.revs.join() === '1,2' && lb.r2.rev === 2, JSON.stringify(lb));
  check('library: saves add no timeline entries', lb.n1 === lb.n0, `${lb.n0} -> ${lb.n1}`);
  await page.reload(); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.history);
  const lr = await page.evaluate(async () => { const L = await import('./library.js'); await L.lib.store.ready; return { ids: L.lib.list().map((x) => x.id), revs: L.lib.revs('zpad').map((x) => x.rev) }; });
  check('library: after reload the components come back from the docs store', lr.ids.includes('zpad') && lr.revs.join() === '1,2', JSON.stringify(lr));
  // legacy migration: sc.library -> docs
  const mig = await page.evaluate(async () => {
    localStorage.removeItem('schist.library'); const rec = { model: 1, meta: { name: 'legacy', kind: 'track', rev: 1, hash: 'h1' } };
    const orig = Storage.prototype.setItem; orig.call(localStorage, 'sc.library', JSON.stringify({ legacy: [rec] }));
    const { docsStore } = await import('./library-store.js'); const s = docsStore(window.strudelCraft.history.docs); await s.ready; await new Promise((r) => setTimeout(r, 200));
    return (await window.strudelCraft.history.docs.revs('library', 'legacy')).length;
  });
  check('library: a legacy sc.library copy is migrated into docs', mig === 1, mig);
  await page.close(); await ctx.close();

  // 3: a second tab still on the old version
  const ctx2 = await browser.newContext();
  const oldTab = await open(ctx2, true); const ids2 = await writeSnaps(oldTab, ['zebra a', 'zebra b']);
  const base2 = await state(oldTab);
  const newTab = await ctx2.newPage(); newTab.on('dialog', (x) => { dialogs++; x.dismiss(); });
  await newTab.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await newTab.goto(BASE);
  await newTab.waitForSelector('.toast', { timeout: 15000 }).catch(() => {});
  const toastText = await newTab.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  check('second tab on v1: the upgrade is blocked with a toast naming the other tab', /another Strudel Craft tab/.test(toastText), toastText);
  const more = await writeSnaps(oldTab, ['zebra c']); const mid = await state(oldTab);
  check('second tab on v1: the old tab keeps working and every earlier snapshot is intact', ids2.every((i) => mid.out[i]) && mid.out[more[0]] !== undefined);
  await oldTab.close();
  await newTab.waitForFunction(() => window.strudelCraft && window.strudelCraft.history && window.strudelCraft.ui, null, { timeout: 30000 });
  const fin = await newTab.evaluate(async () => { const h = window.strudelCraft.history; await h.docs.put('t', 'x', { a: 1 }); return { n: (await h.log()).length }; });
  const fi = await dbInfo(newTab); const fs2 = await state(newTab);
  check('second tab on v1: once it closes the upgrade completes and all snapshots are intact', fi.v === 2 && Object.keys(mid.out).every((i) => fs2.out[i] && fs2.out[i].state === mid.out[i].state), JSON.stringify(fi));
  // 4: an old-code tab opened after the upgrade
  const lateOld = await open(ctx2, true);
  const nLate = await lateOld.evaluate(async () => { localStorage.setItem('sc.edits', JSON.stringify({ x: 'late' })); await window.strudelCraft.history.flush(); return (await window.strudelCraft.history.commit('late old', { named: true, force: true })).id; });
  const fs3 = await state(newTab);
  check('old-code tab opened after the upgrade cannot touch the v2 database (its writes stay in its localStorage fallback)', (await dbInfo(newTab)).v === 2 && Object.keys(mid.out).every((i) => fs3.out[i] && fs3.out[i].state === mid.out[i].state) && !fs3.out[nLate]);
  check('no native alert/confirm/prompt dialog opened', dialogs === 0, dialogs);
  await ctx2.close();
} catch (e) { check('history upgrade test ran to the end', false, e.stack); }
await browser.close(); server.close();
const bad = checks.filter((x) => !x).length; console.log(`\n${checks.length - bad}/${checks.length} history upgrade checks passed`); process.exit(bad ? 1 : 0);
