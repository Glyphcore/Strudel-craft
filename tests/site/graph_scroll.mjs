// Graph scroll-trap check: `node tests/site/graph_scroll.mjs` - at 360x780 (touch), zoom in fully, one-finger swipes scroll the page past the graph, Fit stays on screen while the canvas shows, canvas <= 70dvh.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.mjs': 'text/javascript' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const URL_ = `http://localhost:${server.address().port}/index.html#graph`;
const b = await chromium.launch(); let fail = 0; const errs = [];
const ok = (c, m) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
await p.goto(URL_); await p.waitForTimeout(2500); await p.evaluate(() => { const a = document.querySelector('a[data-view="graph"]'); a ? a.click() : location.hash = 'graph'; });
await p.waitForFunction(() => window.__graph && __graph.view, null, { timeout: 30000 });
await p.evaluate(() => { const t = [...document.querySelectorAll('.gx-tab')].find((x) => x.dataset.pane === 'graph'); t && t.click(); __graph.zoomTo(2, -200, -200); const sp = document.createElement('div'); sp.id = 'spacer'; sp.style.height = '1200px'; document.querySelector('.gx').after(sp); });
await p.waitForTimeout(300);
const geo = () => p.evaluate(() => { const v = document.querySelector('.gx-vp').getBoundingClientRect(), f = document.getElementById('gxHudFit').getBoundingClientRect(); return { vpTop: v.top, vpBot: v.bottom, vpH: v.height, fTop: f.top, fBot: f.bottom, sy: scrollY, max: document.documentElement.scrollHeight - innerHeight, s: __graph.V.s, ih: innerHeight }; });
let g = await geo(); ok(g.vpH <= 0.7 * g.ih + 1, `canvas height ${g.vpH.toFixed(0)} <= 70% of ${g.ih}`); ok(g.s >= 2, `zoomed fully in (s=${g.s})`);
const cdp = await ctx.newCDPSession(p);
const swipe = async (x, y0, y1) => { const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); await t('touchStart', [{ x, y: y0 }]); for (let i = 1; i <= 20; i++) { await t('touchMove', [{ x, y: y0 + (y1 - y0) * i / 20 }]); await p.waitForTimeout(16); } await t('touchEnd', []); await p.waitForTimeout(300); };
// scroll so the canvas fills the screen, then swipe on the canvas
await p.evaluate(() => document.querySelector('.gx-vp').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
const sy0 = (await geo()).sy; const vx0 = await p.evaluate(() => [__graph.V.x, __graph.V.y]);
let fitSeen = true, passed = false;
for (let i = 0; i < 12; i++) { g = await geo(); const mid = Math.max(g.vpTop + 20, Math.min(g.vpBot - 20, 400));
  const canvasOnScreen = g.vpBot > 60 && g.vpTop < g.ih - 60; if (canvasOnScreen && g.vpTop >= 0 && !(g.fTop >= 0 && g.fBot <= g.ih)) fitSeen = false;
  if (g.vpBot < 0) { passed = true; break; } await swipe(180, mid > g.vpTop && mid < g.vpBot ? mid : 500, (mid > g.vpTop && mid < g.vpBot ? mid : 500) - 300); }
g = await geo(); const vx1 = await p.evaluate(() => [__graph.V.x, __graph.V.y]);
ok(g.sy > sy0 + 200 || passed, `one-finger swipes on canvas scroll page (${sy0} -> ${g.sy}, max ${g.max})`);
ok(passed || g.sy >= g.max - 2, 'scrolled past the graph (or page end)');
ok(vx0[0] === vx1[0] && vx0[1] === vx1[1], 'graph did not pan on one finger');
ok(fitSeen, 'Fit on screen whenever canvas top is on screen');
await p.evaluate(() => document.querySelector('.gx-vp').scrollIntoView({ block: 'center' })); await p.waitForTimeout(200); g = await geo();
ok(g.fTop >= 0 && g.fBot <= g.ih, `Fit visible with canvas centred (${g.fTop.toFixed(0)}..${g.fBot.toFixed(0)})`);
await p.tap('#gxLock'); await p.waitForTimeout(200);  const lx = await p.evaluate(() => __graph.V.x); const y = Math.round((g.vpTop + g.vpBot) / 2);
await p.evaluate(() => __graph.zoomTo(1, 2000, 2000)); const sy2 = (await geo()).sy, vy2 = await p.evaluate(() => __graph.V.y); await swipe(180, y, y - 150); ok(await p.evaluate(() => document.querySelector('.gx').dataset.lock === 'on'), 'Interact lock on');
ok(await p.evaluate((v) => __graph.V.y !== v, vy2) && (await geo()).sy === sy2, 'Interact: one finger pans the graph, page stays');
await p.tap('#gxHudFit'); await p.waitForTimeout(300); ok((await geo()).s < 2, 'Fit works');
await p.tap('#gxCollapse'); await p.waitForTimeout(200); ok(await p.evaluate(() => getComputedStyle(document.querySelector('.gx-vp')).display === 'none' && !!document.getElementById('gxCollapse').offsetParent), 'collapse hides canvas, keeps toggle');
await p.tap('#gxCollapse');
await p.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/graph_scroll_360.png` });
if (errs.length) { fail++; console.log('errors', errs); }
await b.close(); server.close(); process.exit(fail ? 1 : 0);
