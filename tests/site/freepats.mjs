/* glyphcore/freepats (#181): lazy CC0 instruments. 360x780 touch profile, site under /Strudel-craft/ with the service worker stamped.
   1. first load: no freepats sounds map or ogg is requested (eager shell unchanged)
   2. ensure('sounds') + play each recipe: the recipe plays and its instrument's ogg arrive
   3. offline reload: the same recipes play with the oggs served from the cache (no failed request)
   Usage (repo root): node tests/site/freepats.mjs -> PASS/FAIL lines, exit 1 on any FAIL */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length) || 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const body = p === 'sw.js' ? fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", "const VERSION = 'sc-fp-1';") : fs.readFileSync(f);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(body);
});
await new Promise((ok) => server.listen(0, ok)); const BASE = `http://localhost:${server.address().port}${PREFIX}`;
let fail = 0; const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); if (!ok) fail++; };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
const page = await ctx.newPage(); const errors = [], seen = [], bad = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('request', (r) => seen.push(r.url())); page.on('requestfailed', (r) => { if (/freepats/.test(r.url())) bad.push(r.url().split('freepats/')[1]); });
const ready = () => page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }).then(() => page.evaluate(async () => { await window.strudelCraft.packs.ready; }));
const run = () => page.evaluate(async () => {
  const P = window.strudelCraft.packs; await P.ensure('sounds'); const out = {};
  for (const id of ['fp-harp', 'fp-organ', 'fp-xylophone']) { const r = P.resolve('recipes', id); try { await window.__sc.Engine.play(r.value.code, false, () => {}); out[id] = 'played'; } catch (e) { out[id] = String(e).slice(0, 120); } await new Promise((ok) => setTimeout(ok, 2500)); }
  return { out, st: P.list().find((p) => p.id === 'glyphcore/freepats')?.state };
});
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => {}); await ready();
const eager = seen.filter((u) => /data\/freepats\//.test(u));
check('first load: no freepats ogg is requested (JSON only)', eager.length > 0 && eager.every((u) => /\.json$/.test(u)), eager.map((u) => u.split('freepats/')[1]).join(','));
const r1 = await run(); const oggs = new Set(seen.filter((u) => /freepats\/sounds\/.*\.ogg/.test(u)).map((u) => u.split('sounds/')[1].split('/')[0]));
check('online: three recipes play, pack ready', Object.values(r1.out).every((v) => v === 'played') && r1.st === 'ready', JSON.stringify(r1));
check('online: samples of harp, organ and xylophone were fetched lazily', ['harp', 'organ', 'xylophone'].every((i) => oggs.has(i)), [...oggs].join(','));
await ctx.setOffline(true); seen.length = 0; bad.length = 0; await page.reload({ waitUntil: 'load' }); await ready();
const r2 = await run();
check('offline reload: three recipes play from the cache, no failed freepats request', Object.values(r2.out).every((v) => v === 'played') && r2.st === 'ready' && bad.length === 0, JSON.stringify(r2) + ' bad=' + bad.join(','));
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
