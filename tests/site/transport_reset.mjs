/* #206: position resets on recipe select (transport readout, scheduler, timeline clock) and on '<' (return to start, #startBtn); no '>' and no prev/next recipe on the transport; Home = return to start.
   Usage (repo root): node tests/site/transport_reset.mjs   (wrap in engine/load/gate.sh medium) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = []; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const A = 'setcpm(120/4)\nvoiceA: note("a3 a3 a3 a3").s("sine").release(0.2).gain(0.2)\n';
const B = 'setcpm(120/4)\nvoiceB: note("e5 ~ e5 ~").s("triangle").release(0.1).gain(0.2)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); const wait = (ms) => page.waitForTimeout(ms); const T = (f, a) => page.evaluate(f, a);
await page.goto(`http://127.0.0.1:${server.address().port}/index.html#rack`); await page.waitForSelector('#list li[data-id]', { timeout: 60000 }); await page.waitForFunction(() => window.strudelCraft.timeline, null, { timeout: 30000 });
await T(async ([a, b]) => { const sc = window.__sc; const rs = sc.S.filtered.slice(0, 2); for (const r of rs) await sc.hydrate(r); sc.S.edits[rs[0].id] = a; sc.S.edits[rs[1].id] = b; sc.select(0, { audition: false }); }, [A, B]);
const pos = () => T(() => { const sc = window.__sc, tl = window.strudelCraft.timeline.state(); let now = null; try { now = sc.Engine.scheduler.now(); } catch (e) { /* none */ } return { readout: parseFloat(document.querySelector('#cycleOut').textContent), now, tlT: tl.t, cursor: tl.cursor }; });
const playing = async () => { await T(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 }); };
// 1. recipe select while playing
await playing(); await wait(4000); const p0 = await pos(); check('position advanced before switch (readout > 1 cycle)', p0.readout > 1, JSON.stringify(p0));
await T(() => window.__sc.select(1)); await wait(700); const p1 = await pos();
check('select while playing: transport readout back near 0 (< 0.8)', p1.readout < 0.8, JSON.stringify(p1));
check('select while playing: scheduler.now() near 0 (< 0.8)', p1.now != null && p1.now < 0.8, JSON.stringify(p1));
check('select while playing: timeline clock near 0 (< 0.8)', p1.tlT < 0.8, JSON.stringify(p1));
// 2. recipe select while stopped after play
await wait(2500); await T(() => window.__sc.stop()); await wait(300); await T(() => window.__sc.select(0)); await wait(300); const p2 = await pos();
check('select while stopped: readout 0', p2.readout === 0, JSON.stringify(p2));
check('select while stopped: timeline cursor/clock 0', (p2.cursor || 0) === 0 && (p2.tlT || 0) === 0, JSON.stringify(p2));
// 2b. play after a stopped select begins at 0, not at the old stop position
await playing(); await wait(600); const p3 = await pos(); check('play after a stopped select starts near 0 (< 1.2)', p3.readout < 1.2, JSON.stringify(p3)); await T(() => window.__sc.stop()); await wait(300);
// 3. return to start
await playing(); await wait(3500); const q0 = await pos();
await T(() => document.querySelector('#startBtn') && document.querySelector('#startBtn').click()); await wait(700); const q1 = await pos();
check('return-to-start button exists with aria-label', await T(() => { const b = document.querySelector('#startBtn'); return !!b && b.getAttribute('aria-label') === 'Return to start'; }));
check('return to start while playing: readout < 0.8 and still playing', q1.readout < 0.8 && q0.readout > 1 && await T(() => window.__sc.S.playing), JSON.stringify([q0, q1]));
await T(() => window.__sc.stop()); await wait(300);
await T(() => document.querySelector('#startBtn').click()); await wait(300);
check('return to start while stopped: stays stopped at 0', await T(() => !window.__sc.S.playing) && (await pos()).readout === 0);
check('no next button in DOM, no prev-recipe button', await T(() => !document.querySelector('#nextBtn') && !document.querySelector('#prevBtn') && ![...document.querySelectorAll('.transport button')].some((b) => /recipe/i.test(b.getAttribute('aria-label') || ''))));
check('start button 44px target', await T(() => { const r = document.querySelector('#startBtn').getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }));
// keys: Home returns to start; Up/Down no longer move the selection from the transport/body
await playing(); await wait(3000); await T(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Home'); await wait(700);
check('Home key returns to start', (await pos()).readout < 0.8);
await T(() => window.__sc.stop());
await page.setViewportSize({ width: 390, height: 800 }); await wait(300);
check('390px: no horizontal overflow and transport buttons visible', await T(() => document.documentElement.scrollWidth <= innerWidth && ['#startBtn', '#playBtn'].every((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; })));
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
