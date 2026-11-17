/* #185: refresh and entry selection. Pack recipes without `source` (fp-*, vcsl-*, drawn-*, vsco-*, brd-*) threw in the inspector ("Cannot read properties of undefined (reading 'replace')"), which the boot caught as "Failed to load recipes" and which left the previous entry's inspector on screen.
   Per viewport (1440, 390): refresh twice on a deep link, every entry selected by link shows its own inspector, 30 rapid J presses, no page errors. Usage: node tests/site/inspector_select.mjs */
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
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && /\[inspector\]/.test(m.text())) errs.push(m.text()); });
  const tag = `${w}px `; const state = () => page.evaluate(() => [document.querySelector('#status')?.textContent || '', document.querySelector('#nowTitle')?.textContent || '', document.querySelector('#inspector .title')?.textContent || '', document.querySelector('#inspector .rec-load.err') ? 'ERR' : '']);
  const ready = (n) => page.waitForFunction((n) => document.querySelectorAll('#list li[data-id]').length >= n, n, { timeout: 30000 });
  /* 1 refresh twice on a deep link to a pack recipe that has no source: no toast, inspector shows it */
  await page.goto(BASE + '#r/fp-harp', { waitUntil: 'load' }); await ready(100);
  for (let i = 0; i < 2; i++) { await page.reload({ waitUntil: 'load' }); await ready(100); await page.waitForTimeout(1500); const s = await state(); check(tag + `refresh ${i + 1} on #r/fp-harp: no "Failed to load recipes", inspector is the open entry`, !/Failed to load/.test(s[0]) && s[2] && s[2] === s[1] && !s[3], JSON.stringify(s)); }
  const ids = await page.$$eval('#list li[data-id]', (l) => l.map((x) => x.dataset.id));
  /* 2 every entry, selected by hash, shows its own inspector (no exception, no stale content) */
  const bad = [];
  for (const id of ids) { await page.evaluate((i) => { location.hash = '#r/' + i; }, id); try { await page.waitForFunction(() => { const t = document.querySelector('#nowTitle')?.textContent, i = document.querySelector('#inspector .title')?.textContent; return t && t === i; }, null, { timeout: 4000 }); } catch { bad.push(id); } }
  check(tag + `inspector follows all ${ids.length} entries (selected by link)`, !bad.length, bad.slice(0, 8).join(','));
  /* 3 rapid keyboard selection, then the inspector is the final entry's */
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); }); await page.evaluate(() => { location.hash = '#r/' + document.querySelector('#list li[data-id]').dataset.id; });
  await page.waitForTimeout(300); for (let i = 0; i < 30; i++) await page.keyboard.press('j');
  await page.waitForTimeout(800); const k = await state();
  check(tag + 'rapid keyboard selection (30 x J): inspector is the selected entry', k[2] && k[2] === k[1] && !k[3], JSON.stringify(k));
  check(tag + 'no page errors', !errs.length, errs.slice(0, 2).join(' | ')); await ctx.close();
}
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
