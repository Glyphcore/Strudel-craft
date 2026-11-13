/* Installable PWA checks (#73). Serves site/ under /Strudel-craft/ (the Pages path) and checks, in Playwright Chromium:
   CDP Page.getInstallabilityErrors == [], manifest parsed with no errors, every manifest icon loads at its declared size,
   every same-origin file the shell fetched is in the precache list, offline reload renders the app, an uncached bank shows the
   offline toast, the install offer sits in ? / overflow / palette and hides in standalone, the "New version" toast still appears.
   Usage (repo root): node tests/site/pwa.mjs   -> prints PASS/FAIL lines, exit 1 on any FAIL; writes docs/screens/pwa.json */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let swVersion = 'sc-test-1';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = TYPES[path.extname(f)] || 'application/octet-stream';
  if (p === '/sw.js') { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", `const VERSION = '${swVersion}';`)); }
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const checks = []; const errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const sameOrigin = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === new URL(BASE).origin) sameOrigin.add(u.pathname.slice(PREFIX.length) || './'); });

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'load' }); /* now controlled */
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
await page.waitForTimeout(1500);

/* 1. installability */
const cdp = await ctx.newCDPSession(page);
const inst = await cdp.send('Page.getInstallabilityErrors');
check('CDP Page.getInstallabilityErrors is empty at ' + PREFIX, inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
const man = await cdp.send('Page.getAppManifest');
check('manifest parsed without errors', man.url.endsWith(PREFIX + 'manifest.webmanifest') && man.errors.length === 0, man.url + ' ' + JSON.stringify(man.errors));
const mj = JSON.parse(man.data);
check('manifest fields', mj.start_url === './' && mj.scope === './' && mj.display === 'standalone' && mj.shortcuts.length === 4 && mj.theme_color === '#0b0d10', mj.shortcuts.map((s) => s.name).join(','));

/* 2. icons load with the declared size */
const icons = await page.evaluate(async (list) => Promise.all(list.map((i) => new Promise((res) => { const im = new Image(); im.onload = () => res({ src: i.src, sizes: i.sizes, w: im.naturalWidth, h: im.naturalHeight, ok: true }); im.onerror = () => res({ src: i.src, ok: false }); im.src = i.src; }))), mj.icons);
check('manifest icons load at declared sizes', icons.every((i) => i.ok && (i.sizes === 'any' || i.sizes === `${i.w}x${i.h}`)), icons.map((i) => `${i.src} ${i.w}x${i.h}`).join(', '));
const apple = await page.evaluate(() => fetch(document.querySelector('link[rel=apple-touch-icon]').href).then((r) => r.status));
check('apple-touch-icon 200', apple === 200);

/* 3. install offer: ? dialog, overflow menu, palette */
const offer = await page.evaluate(() => ({ help: !!document.querySelector('#help #pwaHelp:not([hidden])'), tools: !!document.querySelector('#tools #installBtn:not([hidden])'), pal: window.strudelCraft.palette.list().some((i) => i.id === 'app.install') }));
check('install offer in ? dialog, overflow menu and palette', offer.help && offer.tools && offer.pal, JSON.stringify(offer));
await page.click('#moreBtn'); await page.click('#installBtn'); /* no prompt event in automation -> the hint modal (site modal, not native) */
const hintShown = await page.waitForSelector('dialog.scm[open]', { timeout: 3000 }).then(() => true).catch(() => false);
check('Install without a prompt event opens the site hint modal', hintShown);
if (hintShown) await page.click('dialog.scm .scm-ok');

/* 4. precache covers what the shell fetched (all views opened once) */
for (const v of ['stack', 'ref', 'practice', 'perform', 'syntax', 'graph', 'rack']) { await page.evaluate((h) => { location.hash = '#' + h; }, v); await page.waitForTimeout(700); }
const precached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) out.push(...(await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)); return out; });
const pre = new Set(precached.map((p) => p.slice('/Strudel-craft/'.length) || './'));
const missing = [...sameOrigin].filter((p) => !pre.has(p) && p !== 'sw.js' && !p.startsWith('data/vox/')); /* vox banks are lazy pack ingredients (sc-packs-1 rules, tests/site/packs.mjs) */
check('every same-origin file the shell fetched is cached', missing.length === 0, missing.join(', ') || `${sameOrigin.size} files`);
const shellList = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
const notPrecached = [...sameOrigin].filter((p) => p !== 'sw.js' && p !== './' && !p.startsWith('data/') && !shellList.includes(`'${p}'`));
check('every fetched shell file (outside data/) is in the SHELL precache list', notPrecached.length === 0, notPrecached.join(', '));

/* 5. offline reload */
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 0, null, { timeout: 10000 }).catch(() => {});
const off = await page.evaluate(() => ({ rows: document.querySelectorAll('#list .row').length, title: document.getElementById('nowTitle').textContent, manifest: !!document.querySelector('link[rel=manifest]') }));
check('offline reload renders the app shell with recipes', off.rows > 0 && off.title !== 'Offline', JSON.stringify(off));
await page.evaluate(() => fetch('https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/bd/BT0A0A7.wav').catch(() => null));
const offToast = await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Offline: this sample bank is not cached/.test(t.textContent)), null, { timeout: 5000 }).then(() => true).catch(() => false);
check('uncached sample bank offline -> "Offline" toast', offToast);
await page.screenshot({ path: path.join(ROOT, 'docs/screens/pwa-offline-390.png') });
await ctx.setOffline(false);

/* 6. "New version, tap to reload" still offered after a deploy */
swVersion = 'sc-test-2';
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
const upd = await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /New version, tap to reload/.test(t.textContent)), null, { timeout: 15000 }).then(() => true).catch(() => false);
check('"New version, tap to reload" toast after a new sw.js', upd);
if (upd) { const nav = page.waitForEvent('framenavigated', { timeout: 10000 }).then(() => true).catch(() => false); await page.click('.toast-act'); check('tapping it reloads into the new version', await nav); }

/* 7. standalone (installed): offers hidden, standalone class set */
const p2 = await ctx.newPage();
await p2.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
p2.on('pageerror', (e) => errors.push('p2 pageerror: ' + e.message)); p2.on('console', (m) => { if (m.type() === 'error') errors.push('p2 console.error: ' + m.text()); });
await p2.goto(BASE + '?action=record#rack', { waitUntil: 'load' }); await p2.waitForTimeout(2500);
const st = await p2.evaluate(() => ({ cls: document.documentElement.classList.contains('pwa-standalone'), help: document.getElementById('pwaHelp').hidden, tools: document.getElementById('installBtn').hidden, pal: window.strudelCraft.palette.list().some((i) => i.id === 'app.install'), url: location.search, cap: !!document.querySelector('.cap:not([hidden])') }));
check('standalone: offers hidden, layout class set', st.cls && st.help && st.tools && !st.pal, JSON.stringify(st));
check('shortcut ?action=record opens capture and cleans the URL', st.cap && st.url === '', JSON.stringify({ cap: st.cap, url: st.url }));
await p2.screenshot({ path: path.join(ROOT, 'docs/screens/pwa-standalone-390.png') });

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(path.join(ROOT, 'docs/screens/pwa.json'), JSON.stringify({ date: new Date().toISOString(), base: BASE, installabilityErrors: inst.installabilityErrors, icons, checks }, null, 2));
await browser.close(); server.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
