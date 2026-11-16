/* Lazy recipe bodies (#131). Serves site/ under /Strudel-craft/ like Pages, mobile Chromium (390 px, touch):
   1. first paint lists every row from the index; only the body file of the selected recipe's family is fetched, none of the others
   2. tap on a recipe of another family: spinner status row while its family file is on the way, then the full inspector and program (exactly one request for that file)
   3. a failed body file shows the failure with Retry; Retry loads it
   4. the first text search loads the remaining bodies and finds a word that only the program text holds
   5. deep link #r/<id> of a recipe in a never-opened family opens with its program
   6. installed app, network off, reload on that deep link: the program is there and Play starts (the body files are in precache.json / the snapshot)
   Usage (repo root): node tests/site/recipes_lazy.mjs -> PASS/FAIL lines, exit 1 on any FAIL */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': p === '/sw.js' ? 'no-cache' : 'max-age=600' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
let fail = 0; const check = (name, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const idx = JSON.parse(fs.readFileSync(path.join(SITE, 'data/catalog.json'), 'utf8')).recipes; const fams = [...new Set(idx.map((r) => r.body))];
const first = idx[0], other = idx.find((r) => r.body === 'bodies-dubstep'), file = (b) => 'data/recipes/' + b.replace(/^bodies-/, '') + '.json';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '' }) : '[]' }));
const errors = []; const page = await ctx.newPage(); const reqs = [];
page.on('request', (r) => { if (r.url().includes('/data/recipes/')) reqs.push(r.url().slice(BASE.length)); });
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Failed to fetch|error loading|not loaded/.test(m.text())) errors.push(m.text()); });
const codeOf = () => page.evaluate(() => document.querySelector('#code').value);
let delayMs = 0, blocked = false;
await ctx.route(/\/data\/recipes\/dubstep\.json/, async (r) => { if (blocked) return r.abort('failed'); if (delayMs) await new Promise((ok) => setTimeout(ok, delayMs)); return r.continue(); });

/* 1 */
await page.goto(BASE + '#r/' + first.id, { waitUntil: 'load' });
await page.waitForFunction((n) => document.querySelectorAll('#list li[data-id]').length >= n && document.querySelector('#code').value.length > 5, idx.length, { timeout: 30000 });
check(`first paint: all ${idx.length}+ rows from the index, the selected recipe's program loaded`, (await codeOf()).length > 5);
const fetched1 = [...new Set(reqs)];
check('only the selected recipe family file was fetched (' + file(first.body) + ')', fetched1.length === 1 && fetched1[0] === file(first.body), fetched1.join(','));
/* 2 */
delayMs = 700; reqs.length = 0;
await page.tap(`#list li[data-id="${other.id}"] .row`);
await page.waitForSelector('#inspector .rec-load', { timeout: 5000 }).then(() => check('tap on a recipe of another family: a spinner status row shows while its file loads', true), () => check('tap on a recipe of another family: a spinner status row shows while its file loads', false));
const pend = await page.evaluate(() => ({ role: document.querySelector('#inspector .rec-load')?.getAttribute('role'), title: document.querySelector('#inspector .title')?.textContent }));
await page.waitForFunction(() => !document.querySelector('#inspector .rec-load') && document.querySelector('#code').value.length > 5, null, { timeout: 15000 });
check('the status row gives way to the full inspector and the program (title kept, role=status)', pend.role === 'status' && pend.title === other.title && (await codeOf()).length > 5, JSON.stringify(pend));
check('exactly one request for that family file', reqs.filter((u) => u === file(other.body)).length === 1, reqs.join(','));
const stack = await page.evaluate(async (id) => { const b = document.querySelector(`#list li[data-id="${id}"] .add`); return { disabled: b.disabled }; }, other.id);
check('the stack button reflects the index flag (stackable) before and after the body', stack.disabled === !other.stackable, JSON.stringify(stack));
/* 3 */
delayMs = 0; blocked = true; const third = idx.find((r) => r.body === 'bodies-dubstep' && r.id !== other.id);
const fresh = await ctx.newPage(); fresh.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack).split('\n').slice(0, 4).join(' | ')));
await fresh.goto(BASE + '#r/' + third.id, { waitUntil: 'load' });
await fresh.waitForFunction(() => window.strudelCraft && window.strudelCraft.organizer, null, { timeout: 30000 }); /* the organizer's late route() re-opens the recipe once: settle before the failure is read */
await fresh.waitForSelector('#inspector .rec-load.err', { timeout: 20000 }).then(() => check('a failed body file shows the failure with a Retry button', true), () => check('a failed body file shows the failure with a Retry button', false));
blocked = false; await fresh.click('#inspector .rec-load.err button');
await fresh.waitForFunction(() => !document.querySelector('#inspector .rec-load') && document.querySelector('#code').value.length > 5, null, { timeout: 15000 }).then(() => check('Retry loads the file and opens the recipe', true), () => check('Retry loads the file and opens the recipe', false));
await fresh.close();
/* 4 */
reqs.length = 0; await page.fill('#q', 'RolandTR909');
await page.waitForFunction(() => { const m = /^(\d+) \/ (\d+)/.exec(document.querySelector('#count').textContent); return m && +m[1] > 0 && +m[1] < +m[2]; }, null, { timeout: 20000 });
await page.waitForTimeout(800); const hits = await page.evaluate(() => document.querySelectorAll('#list li[data-id]').length); const all = [...new Set(reqs)];
check('first text search loads the other family files and matches program text only', hits > 0 && fams.filter((b) => b !== other.body && b !== first.body).every((b) => all.includes(file(b))), `${hits} hits; fetched ${all.length} files`);
await page.fill('#q', '');
/* 5 + 6 */
const dp = await ctx.newPage(); await dp.goto(BASE + '#r/' + third.id, { waitUntil: 'load' });
await dp.waitForFunction(() => document.querySelector('#code').value.length > 5 && !document.querySelector('#inspector .rec-load'), null, { timeout: 30000 });
const want = JSON.parse(fs.readFileSync(path.join(SITE, file(third.body)), 'utf8')).bodies[third.id].code;
check('deep link #r/<id> of a never-opened family opens with its program', (await dp.evaluate(() => document.querySelector('#code').value)).replace(/\s+/g, ' ').trim() === want.replace(/\s+/g, ' ').trim());
await dp.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
const cached = await dp.evaluate(async () => { const out = []; for (const k of await caches.keys()) out.push(...(await (await caches.open(k)).keys()).map((r) => r.url)); return out; });
const missing = fams.map(file).filter((f) => !cached.includes(BASE + f));
check('the service worker snapshot holds every recipe body file (precache.json)', missing.length === 0, missing.join(','));
await ctx.setOffline(true); await dp.reload({ waitUntil: 'load' });
await dp.waitForFunction(() => document.querySelector('#code').value.length > 5 && !document.querySelector('#inspector .rec-load') && document.documentElement.dataset.editor === 'cm6', null, { timeout: 30000 }).catch(() => {});
check('offline reload on the deep link: the program is there', (await dp.evaluate(() => document.querySelector('#code').value)).length > 5);
await dp.click('#playBtn'); await dp.waitForFunction(() => window.__sc && window.__sc.S.playing && window.__sc.S.playingId, null, { timeout: 30000 }).catch(() => {});
const pl = await dp.evaluate(() => ({ playing: window.__sc.S.playing, id: window.__sc.S.playingId })); check('offline: Play starts that recipe', pl.playing && pl.id === third.id, JSON.stringify(pl));
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
