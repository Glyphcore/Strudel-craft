// Graph scroll-trap + drag check: `node tests/site/graph_scroll.mjs` - at 360x780 (touch): one-finger node drag moves the node (snapped, clamped), one-finger port drag draws a wire, zoomed fully in an empty-canvas swipe scrolls the page past the graph, Fit stays on screen, canvas <= 70dvh; desktop mouse and pen drag nodes and mouse pans.
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
await p.evaluate(() => { const t = [...document.querySelectorAll('.gx-tab')].find((x) => x.dataset.pane === 'graph'); t && t.click(); __graph.zoomTo(2, 3000, 3000); const sp = document.createElement('div'); sp.id = 'spacer'; sp.style.height = '1200px'; document.querySelector('.gx').after(sp); });
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
// one-finger node drag (touch, Interact off)
await p.evaluate(() => { document.querySelector('.gx').dataset.lock = 'off'; document.getElementById('gxLock').setAttribute('aria-pressed', 'false'); __graph.center('track:bass', 1); document.querySelector('.gx-vp').scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(300);
const nodeBox = async (id) => { const e = p.locator(`.gn[data-id="${id}"] .gn-head`); return e.boundingBox(); };
const pos = (id) => p.evaluate((id) => { const n = __graph.view.nmap.get(id); return { x: n.x, y: n.y }; }, id);
let hb = await nodeBox('track:bass'); const n0 = await pos('track:bass'); const sy3 = (await geo()).sy;
await (async () => { const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); const x = hb.x + 60, y = hb.y + 20; await t('touchStart', [{ x, y }]); for (let i = 1; i <= 20; i++) { await t('touchMove', [{ x: x + i * 2, y: y + i * 4 }]); await p.waitForTimeout(16); } await t('touchEnd', []); await p.waitForTimeout(300); })();
const n1 = await pos('track:bass');
ok(n1.x !== n0.x || n1.y !== n0.y, `touch: one-finger node drag moves the node (${n0.x},${n0.y} -> ${n1.x},${n1.y})`);
ok(n1.x % 12 === 0 && n1.y % 12 === 0 && n1.x >= 0 && n1.y >= 0, 'dragged node snaps to the 12 px grid and stays in content space');
ok((await geo()).sy === sy3, 'node drag does not scroll the page');
// one-finger wire drag from a port (no Interact): the drag path appears mid-gesture
const port = await p.evaluate(() => { const e = document.querySelector('.gn[data-id="track:bass"] .gp-out'); const r = e.getBoundingClientRect(); return { x: r.left + r.width - 12, y: r.top + r.height / 2 }; });
let sawWire = false; await (async () => { const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); await t('touchStart', [{ x: port.x, y: port.y }]); for (let i = 1; i <= 12; i++) { await t('touchMove', [{ x: port.x - i * 6, y: port.y + i * 6 }]); await p.waitForTimeout(16); } sawWire = await p.evaluate(() => !!document.querySelector('.gw-drag')); await t('touchEnd', []); await p.waitForTimeout(200); })();
ok(sawWire, 'touch: one-finger drag from a port draws a wire without Interact');
await ctx.close();
// desktop: mouse and pen drag nodes, mouse drag on empty canvas pans
const dctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const d = await dctx.newPage(); d.on('pageerror', (e) => errs.push(String(e)));
await d.goto(URL_); await d.waitForTimeout(2000); await d.evaluate(() => { location.hash = 'graph'; }); await d.waitForFunction(() => window.__graph && __graph.view, null, { timeout: 30000 });
await d.evaluate(() => __graph.center('track:bass', 1)); await d.waitForTimeout(300);
const dpos = (id) => d.evaluate((id) => { const n = __graph.view.nmap.get(id); return [n.x, n.y]; }, id);
let db = await d.locator('.gn[data-id="track:bass"] .gn-head').boundingBox(); const m0 = await dpos('track:bass');
await d.mouse.move(db.x + 60, db.y + 20); await d.mouse.down(); for (let i = 1; i <= 10; i++) await d.mouse.move(db.x + 60 + i * 8, db.y + 20 + i * 5); await d.mouse.up(); await d.waitForTimeout(200);
const m1 = await dpos('track:bass'); ok(m1[0] !== m0[0] || m1[1] !== m0[1], `mouse: node drag moves (${m0} -> ${m1})`);
db = await d.locator('.gn[data-id="track:bass"] .gn-head').boundingBox();
await d.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); const ev = (type, dx, dy) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: x + dx, clientY: y + dy, bubbles: true, buttons: type === 'pointerup' ? 0 : 1 })); ev('pointerdown', 0, 0); for (let i = 1; i <= 10; i++) ev('pointermove', i * 6, i * 6); ev('pointerup', 60, 60); }, { x: db.x + 60, y: db.y + 20 });
const m2 = await dpos('track:bass'); ok(m2[0] !== m1[0] || m2[1] !== m1[1], `pen: node drag moves (${m1} -> ${m2})`);
const v0 = await d.evaluate(() => [__graph.V.x, __graph.V.y]); const vr = await d.locator('.gx-vp').boundingBox();
await d.mouse.move(vr.x + vr.width - 140, vr.y + vr.height - 30); await d.mouse.down(); for (let i = 1; i <= 10; i++) await d.mouse.move(vr.x + vr.width - 140 - i * 6, vr.y + vr.height - 30 - i * 3); await d.mouse.up(); await d.waitForTimeout(400);
const v1 = await d.evaluate(() => [__graph.V.x, __graph.V.y]); ok(v1[0] !== v0[0] || v1[1] !== v0[1], 'mouse: empty-canvas drag pans the view');
if (errs.length) { fail++; console.log('errors', errs); }
await b.close(); server.close(); process.exit(fail ? 1 : 0);
