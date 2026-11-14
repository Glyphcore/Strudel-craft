/* Track demo: night phonk (#89). Serves site/ under /Strudel-craft/ (or --live URL), Playwright Chromium at 360x780 (S22 profile, real taps).
   Syntax view > "Track demo: night phonk" > Load and play: the Rack editor holds exactly docs/tracks/night-phonk-demo/track.standalone.strudel.js,
   the transport plays, the master analyser peaks above 0.01 and the stage scope draws pixels, in the intro and after seeking to the drop
   (bar 17) and to drop 2 (bar 49); the glyphcore/phonk pack is in the site lock and loads (atoms and presets ready); no page errors.
   Usage (repo root): node tests/site/track_demo.mjs [--live URL] [--debug]   -> PASS/FAIL lines, exit 1 on any FAIL. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const LIVE = (() => { const i = process.argv.indexOf('--live'); return i > 0 ? process.argv[i + 1] : null; })();
const WANT = fs.readFileSync(path.join(ROOT, 'docs/tracks/night-phonk-demo/track.standalone.strudel.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = LIVE || `http://127.0.0.1:${server.address().port}${PREFIX}`;
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); if (process.argv.includes('--debug')) page.on('console', (m) => console.log('console.' + m.type() + ': ' + m.text().slice(0, 300))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push('console.error: ' + m.text()); });
await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.__sc.audio && window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 });
const pk = await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; await P.load('glyphcore/phonk:atoms'); await P.load('glyphcore/phonk:presets');
  const p = P.list().find((x) => x.id === 'glyphcore/phonk'); return p ? { state: p.state, ings: p.ingredients.map((i) => `${i.id}:${i.state}`) } : null; });
check('glyphcore/phonk is in the site lock; atoms and presets load', pk && pk.state === 'ready' && pk.ings.includes('atoms:ready') && pk.ings.includes('presets:ready'), JSON.stringify(pk));
await page.evaluate(() => window.__sc.setView('syntax')); const btn = page.locator('#sx-tracks .sx-run').first(); await btn.waitFor({ timeout: 30000 }); await btn.scrollIntoViewIfNeeded();
const title = await page.locator('#sx-tracks figcaption span').first().textContent(); check('Syntax entry "Track demo: night phonk" is listed', title === 'Track demo: night phonk', title);
await btn.tap(); await page.waitForTimeout(3000);
await page.waitForFunction(() => { const s = window.__sc.S; return (!s.busy && s.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'); }, null, { timeout: 90000 }).catch(() => {});
const got = await page.evaluate(() => window.strudelCraft.copycode.text('rack'));
check('Rack editor holds the standalone text exactly', got === WANT, `${(got || '').length} vs ${WANT.length} chars`);
const measure = () => page.evaluate(() => new Promise((ok) => { const B = window.__sc.Bus; let m = 0; const t = new Float32Array(2048);
  const ink = (c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; } catch (e) { return -1; } };
  let sc = 0; const iv = setInterval(() => { if (B.an) { B.an.getFloatTimeDomainData(t); for (const x of t) m = Math.max(m, Math.abs(x)); } const v = document.querySelector('#viz'); if (v) sc = Math.max(sc, ink(v)); }, 50);
  setTimeout(() => { clearInterval(iv); ok({ peak: +m.toFixed(4), scope: sc, state: B.ctx ? B.ctx.state : 'none', playing: window.__sc.S.playing, status: document.querySelector('#status').textContent.slice(0, 120) }); }, 4000); }));
await page.waitForTimeout(6000); let r = await measure(); check('intro plays: peak > 0.01, scope pixels', r.playing && r.state === 'running' && r.peak > 0.01 && r.scope > 200, JSON.stringify(r));
for (const [name, cyc] of [['drop (bar 17)', 16], ['drop 2 (bar 49)', 48]]) {
  /* stop, set the transport range start, Play again with a real tap (seeking a playing bus program is tracked separately) */
  await page.tap('#playBtn'); await page.waitForFunction(() => !window.__sc.S.playing, null, { timeout: 10000 }).catch(() => {});
  await page.evaluate((c) => Object.assign(window.strudelCraft.range.state, { start: c }), cyc); await page.tap('#playBtn');
  await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy, null, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(4000); r = await measure();
  check(`${name} plays: peak > 0.01, scope pixels`, r.playing && r.peak > 0.01 && r.scope > 200, JSON.stringify(r)); }
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
