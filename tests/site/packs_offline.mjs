/* Offline cache for fetched packs (#174). A third-party pack (recipes, hooks, atoms) is referenced as a pinned github: source with a mirror; a local
   fixture server on another origin stands in for the git host (no third-party network for the pack). Mobile Chromium, site served under /Strudel-craft/
   with the service worker stamped, so the installed-app path is the one tested.
   1. fetched once online: cached in sc-packs-1 and indexed (files, bytes, fetched-at, ref, version); storage state is reported
   2. offline reload, and a separate launch in standalone display mode: recipes, hooks and atoms load, a program plays, ZERO requests reach the host
   3. online reload: the cache is revalidated in the background; a changed manifest is fetched and reported ("newer"), the session keeps its version;
      Packs view shows it, Refresh re-verifies, Update applies it
   4. a tampered cached body fails its hash: rejected, removed from cache and index, the ingredient is unavailable (not run); online it is re-fetched
   5. a pack never fetched, offline: named toast and Packs view message (E_PACK_UNAVAILABLE), nothing uncaught
   6. Packs view: cache state per pack, Remove from cache works, quota and persistence shown
   Usage (repo root): node tests/site/packs_offline.mjs  -> PASS/FAIL lines, exit 1 on any FAIL */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const A = await import(path.join(ROOT, 'site/engine/atoms.js'));
A.loadTypes(fs.readFileSync(path.join(SITE, 'data/atoms/types.json'), 'utf8'));
const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- fixture packs (served by the stand-in git host)
const rec = { name: 'zo.kick', type: 'mini', rev: 1, body: 'bd*3' };
const FILES = {
  'r.json': JSON.stringify({ categories: [], labels: [], recipes: [{ id: 'zo-groove', title: 'ZO Groove', intent: 'x', code: 's("bd*2")', expr: 's("bd*2")', labels: [], needs: [] }] }),
  'h.json': JSON.stringify({ model: 1, meta: { id: 'testco/offl:h' }, defs: { zoRack: { chain: [['gain', 0.3]] } } }),
  'a.json': JSON.stringify({ format: 'atoms@1', name: 'zo', doc: 'offline fixture', atoms: { [A.idFor('mini', 'zo.kick')]: { ...rec, hash: A.atomHash(rec) } } }),
};
const ing = (id, kind, p) => ({ id, kind, format: kind + '@1', version: '1.0.0', path: p, hash: sha(Buffer.from(FILES[p])), bytes: FILES[p].length, load: id === 'r' ? 'eager' : 'lazy' });
const manifest = (id, version) => JSON.stringify({ craftpack: '1.0.0', id, version, license: 'CC0-1.0', title: id, ingredients: [ing('r', 'recipes', 'r.json'), ing('h', 'hooks', 'h.json'), ing('a', 'atoms', 'a.json')] }, null, 1) + '\n';
let offlVersion = '1.0.0'; const neverMan = manifest('testco/never', '1.0.0');
const hostLog = [];
const fixture = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname; hostLog.push(p); const m = /^\/(offl|never)\/(.+)$/.exec(p);
  const body = !m ? null : m[2] === 'craftpack.json' ? (m[1] === 'offl' ? manifest('testco/offl', offlVersion) : neverMan) : FILES[m[2]];
  res.writeHead(body == null ? 404 : 200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(body ?? '');
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const HOST = `http://127.0.0.1:${fixture.address().port}`;
const entry = (dir, man) => ({ id: 'testco/' + dir, version: '1.0.0', source: 'github:testco/' + dir + '@' + 'a'.repeat(40), mirrors: [`${HOST}/${dir}/`], manifest: sha(Buffer.from(man)), priority: 0, allowCode: [] });
const lockWith = (...e) => JSON.stringify({ lock: 1, craftpack: '1.0.0', packs: e });
const OFFL = entry('offl', manifest('testco/offl', '1.0.0')), NEVER = entry('never', neverMan);

// ---------------------------------------------------------------- site server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg' };
const VER = 'sc-pkoff-1';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = TYPES[path.extname(f)] || 'application/octet-stream';
  if (p === '/sw.js') { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", `const VERSION = '${VER}';`)); }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const results = []; const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const errors = []; const noise = /api\.github\.com|ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch|error loading/;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await ctx.addInitScript((l) => { if (!sessionStorage.getItem('sc.t174.seeded')) { sessionStorage.setItem('sc.t174.seeded', '1'); if (!localStorage.getItem('sc.packs.lock')) localStorage.setItem('sc.packs.lock', l); } }, lockWith(OFFL));
let offline = false; const offlineHost = [];
ctx.on('request', (r) => { if (offline && r.url().startsWith(HOST)) offlineHost.push(r.url()); });
const watch = (pg) => { pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push('console: ' + m.text()); }); };
const page = await ctx.newPage(); watch(page);
const packsReady = (pg) => pg.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }).then(() => pg.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.loadAll(); }));
const state = (pg, id = 'testco/offl') => pg.evaluate((id) => { const p = window.strudelCraft.packs.list().find((x) => x.id === id); return p && { state: p.state, version: p.version, err: p.errors.map((e) => e.code + ' ' + e.message), ings: Object.fromEntries(p.ingredients.map((i) => [i.id, i.state + (i.reason ? ' ' + i.reason.code : '')])) }; }, id);
const toasts = (pg) => pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

/* 1. first visit, online */
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => {});
await packsReady(page);
await page.waitForFunction(() => window.strudelCraft.packs.cacheInfo().then((c) => c['testco/offl'] && c['testco/offl'].files >= 4), null, { timeout: 15000, polling: 300 }).catch(() => {});
const s1 = await state(page), ci = await page.evaluate(() => window.strudelCraft.packs.cacheInfo().then((c) => c['testco/offl'])), st = await page.evaluate(() => window.strudelCraft.packs.storage());
check('online: pack, hooks and atoms load from the git host stand-in', s1.state === 'ready' && Object.values(s1.ings).every((x) => x === 'ready'), JSON.stringify(s1));
check('online: cache index lists the pack (4 files, bytes, fetched-at, ref, version)', ci.cached && ci.files === 4 && ci.bytes > 100 && ci.fetchedAt > 0 && /^github:testco\/offl@/.test(ci.ref) && ci.version === '1.0.0', JSON.stringify(ci));
check('storage state is readable (usage, quota, persistence flag)', st.usage != null && st.quota != null && typeof st.persisted === 'boolean', JSON.stringify(st));

/* 2. offline reload, then a separate standalone launch */
offline = true; await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' }); await packsReady(page);
const s2 = await state(page);
const rows = await page.evaluate(() => [...document.querySelectorAll('#list li[data-id]')].map((x) => x.dataset.id));
const play = await page.evaluate(async () => { const P = window.strudelCraft.packs; const r = P.resolve('recipes', 'zo-groove'); const h = await P.raw('testco/offl:h'), a = await P.raw('testco/offl:a'); await window.__sc.Engine.play(r.value.code, false, () => {}); return { recipe: !!r, hook: !!(h && h.defs.zoRack), atom: !!(a && Object.keys(a.atoms).length), playing: !!window.__sc.S.playing || window.__sc.Engine.started }; });
check('offline reload: pack manifest, recipes, hooks and atoms load from the cache and a pack recipe plays', s2.state === 'ready' && Object.values(s2.ings).every((x) => x === 'ready') && rows.includes('zo-groove') && play.recipe && play.hook && play.atom && play.playing, JSON.stringify({ s2, play, rows: rows.length }));
const standalone = await ctx.newPage(); watch(standalone);
await standalone.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
await standalone.goto(BASE, { waitUntil: 'load' }); await packsReady(standalone);
const s3 = await state(standalone), cls = await standalone.evaluate(() => document.documentElement.classList.contains('pwa-standalone') && !!navigator.serviceWorker.controller);
check('installed-app launch (standalone, service worker in control), offline: the same pack loads', cls && s3.state === 'ready' && Object.values(s3.ings).every((x) => x === 'ready'), JSON.stringify({ cls, s3 }));
check('offline: no request reached the git host (nothing attempted, nothing to fail)', offlineHost.length === 0, offlineHost.join(', '));
await standalone.close();

/* 3. back online: background revalidation finds a new manifest; the session is not changed underneath */
offline = false; await ctx.setOffline(false); offlVersion = '1.1.0'; hostLog.length = 0;
const before = await page.evaluate(() => window.strudelCraft.packs.cacheInfo().then((c) => c['testco/offl'].fetchedAt));
await page.reload({ waitUntil: 'load' }); await packsReady(page);
for (let k = 0; k < 60; k++) { if (await page.evaluate(() => window.strudelCraft.packs.cacheInfo().then((c) => !!(c['testco/offl'] && c['testco/offl'].newer)))) break; await page.waitForTimeout(500); }
const nw = await page.evaluate(() => window.strudelCraft.packs.cacheInfo().then((c) => ({ ...c['testco/offl'], live: window.strudelCraft.packs.list().find((x) => x.id === 'testco/offl').version })));
const tt = await toasts(page);
check('online revalidation: a newer manifest is fetched and recorded; the running session keeps its pinned version', nw.newer && nw.newer.version === '1.1.0' && nw.live === '1.0.0' && nw.version === '1.0.0' && hostLog.includes('/offl/craftpack.json'), JSON.stringify({ newer: nw.newer, live: nw.live }));
check('the UI reports it (toast names the pack and says it is not applied)', tt.some((t) => /testco\/offl: a newer version \(1\.1\.0\)/.test(t) && /session is unchanged/.test(t)), tt.join(' | '));
const PK = BASE + 'packs-ui.js';
await page.evaluate((u) => import(u).then((m) => m.open({ tab: 'packs' })), PK);
await page.waitForSelector('#packSheet [data-pack="testco/offl"] [data-cache="cached"]', { timeout: 10000 }).catch(() => {});
const card = await page.evaluate(() => { const c = document.querySelector('#packSheet [data-pack="testco/offl"]'); return c && { text: c.textContent, acts: [...c.querySelectorAll('[data-act]')].map((b) => b.dataset.act), store: (document.querySelector('#pkStore') || {}).textContent }; });
check('Packs view: cache state per pack (cached files/size/fetched-at, version and ref), newer version, actions', card && /cached: 4 files/.test(card.text) && /fetched/.test(card.text) && /newer version 1\.1\.0 fetched, not applied/.test(card.text) && ['refresh', 'update', 'uncache'].every((a) => card.acts.includes(a)), JSON.stringify(card && { acts: card.acts }));
check('Packs view: quota use and persistence state shown', card && /Offline storage: .* used of .*\(\d+%\)/.test(card.store) && /persistent/.test(card.store), card && card.store);
await page.click('#packSheet [data-pack="testco/offl"] [data-act="refresh"]');
await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /re-fetched and verified/.test(t.textContent)), null, { timeout: 15000 }).catch(() => {});
const after = await page.evaluate(() => window.strudelCraft.packs.cacheInfo().then((c) => c['testco/offl'].fetchedAt));
const rt = await toasts(page); check("Refresh re-fetches and re-verifies the cached files and updates fetched-at", after > before && rt.some((t) => /3 files re-fetched and verified/.test(t)), `${before} -> ${after}; ${rt.join(" | ")}`);
await page.click('#packSheet [data-pack="testco/offl"] [data-act="update"]');
await page.click('dialog.scm button:has-text("Update")');
await page.waitForFunction(() => window.strudelCraft.packs.list().find((x) => x.id === 'testco/offl' && x.version === '1.1.0' && x.state === 'ready'), null, { timeout: 20000 }).catch(() => {});
const upd = await state(page); const ci2 = await page.evaluate(() => window.strudelCraft.packs.cacheInfo().then((c) => c['testco/offl']));
check('Update applies the fetched version on demand (pin, version, cache)', upd.version === '1.1.0' && ci2.cached && !ci2.newer && ci2.version === '1.1.0', JSON.stringify({ v: upd.version, newer: ci2.newer, files: ci2.files }));
await page.evaluate(() => import('./packs-ui.js').then((m) => m.close()));

/* 4. a tampered cache entry is rejected and removed */
const TARGET = `${HOST}/offl/h.json`;
await page.evaluate(async (u) => { const c = await caches.open('sc-packs-1'); await c.put(u, new Response('{"model":1,"defs":{"evil":{"chain":[]}}}')); }, TARGET);
offline = true; await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' }); await packsReady(page);
const tam = await page.evaluate(async (u) => { const p = window.strudelCraft.packs; const i = p.list().find((x) => x.id === 'testco/offl').ingredients.find((x) => x.id === 'h'); const c = await caches.open('sc-packs-1'); const rows = await new Promise((ok) => { const r = indexedDB.open('sc-rescache'); r.onsuccess = () => { const g = r.result.transaction('res').objectStore('res').getAll(); g.onsuccess = () => ok(g.result.map((x) => x.url)); }; });
  return { ing: i.state + ' ' + (i.reason && i.reason.code), cached: !!(await c.match(u)), indexed: rows.includes(u), data: !!(await p.raw('testco/offl:h')) }; }, TARGET);
check('tampered cached entry: hash check fails, entry removed from cache and index, ingredient not loaded offline', /^unavailable E_PACK_HASH$|^failed E_PACK_HASH$/.test(tam.ing) && !tam.cached && !tam.indexed && !tam.data, JSON.stringify(tam));
offline = false; await ctx.setOffline(false);
await page.reload({ waitUntil: 'load' }); await packsReady(page);
const heal = await page.evaluate(async (u) => ({ cached: !!(await (await caches.open('sc-packs-1')).match(u)), state: window.strudelCraft.packs.list().find((x) => x.id === 'testco/offl').ingredients.find((x) => x.id === 'h').state }), TARGET);
check('online again: the entry is re-fetched, verified and cached', heal.cached && heal.state === 'ready', JSON.stringify(heal));

/* 5. never fetched, offline */
await page.evaluate((l) => localStorage.setItem('sc.packs.lock', l), lockWith({ ...OFFL, manifest: sha(Buffer.from(manifest('testco/offl', '1.1.0'))), version: '1.1.0' }, NEVER));
offline = true; await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' }); await packsReady(page);
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /testco\/never/.test(t.textContent)), null, { timeout: 10000 }).catch(() => {});
const nv = await state(page, 'testco/never'), tn = await toasts(page);
check('never-fetched pack offline: named toast, state unavailable with a plain message (no uncaught error)', nv.state === 'unavailable' && /E_PACK_UNAVAILABLE/.test(nv.err.join()) && /never fetched/.test(nv.err.join()) && tn.some((t) => /Offline: testco\/never was never fetched here/.test(t)), JSON.stringify({ nv, tn }));
await page.evaluate((u) => import(u).then((m) => m.open({ tab: 'packs' })), PK);
await page.waitForSelector('#packSheet [data-pack="testco/never"]', { timeout: 10000 });
const nc = await page.evaluate(() => { const c = document.querySelector('#packSheet [data-pack="testco/never"]'); return c.textContent; });
check('Packs view names the unavailable pack and what to do', /never fetched on this device/.test(nc) && /open it once while online/.test(nc), nc.slice(0, 200));
await page.evaluate(() => import('./packs-ui.js').then((m) => m.close()));
offline = false; await ctx.setOffline(false);

/* 6. remove from cache */
await page.evaluate((l) => localStorage.setItem('sc.packs.lock', l), lockWith({ ...OFFL, manifest: sha(Buffer.from(manifest('testco/offl', '1.1.0'))), version: '1.1.0' }));
await page.reload({ waitUntil: 'load' }); await packsReady(page);
await page.evaluate((u) => import(u).then((m) => m.open({ tab: 'packs' })), PK);
await page.waitForSelector('#packSheet [data-pack="testco/offl"] [data-act="uncache"]', { timeout: 10000 });
await page.click('#packSheet [data-pack="testco/offl"] [data-act="uncache"]');
await page.click('dialog.scm button:has-text("Remove from cache")');
await page.waitForFunction(() => window.strudelCraft.packs.cacheInfo().then((c) => !c['testco/offl'].cached), null, { timeout: 10000, polling: 300 });
const left = await page.evaluate(async () => { const c = await caches.open('sc-packs-1'); return (await c.keys()).filter((r) => r.url.includes('/offl/')).length; });
check('Remove from cache: cached files and index rows gone, pack stays in the lock', left === 0 && (await state(page)).state === 'ready', 'left ' + left);

check('no console errors or uncaught exceptions', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close(); server.close(); fixture.close();
process.exit(results.every(Boolean) ? 0 : 1);
