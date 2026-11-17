/* Transport clock after stop + play (#167). The background clock (site/bgplay.js) ticks the scheduler from a worker; a tick the worker had already posted is still queued on the
   main thread when stop() returns. Before the fix that ghost tick ran against Cyclist.stop()'s state (lastEnd 0, stale cycle origin) and either re-anchored the clock by tens
   of seconds (the next run read cycle -6..-118) or wrote lastEnd back to the old position (the next run began there).
   The ghost is made deterministic: seek far ahead, block the main thread 300 ms (the worker keeps posting ticks), call stop() in the same task, then play.
   Runs: stop/play x20 plain, x20 with the ghost, Start > 0, with a quick-play audition between, hidden page, tempo knob change, CPU x4.
   Asserts per run: clock >= Start - 0.1 shortly after play and keeps increasing; the Position readout agrees; then, after a ghost, the Record start cycle
   (live take, cycles mode) and the captions strip bar (an inline //@ program) are right after the cycle.
   Usage (repo root): node tests/site/transport_stop_play.mjs   (about 3 min) */
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.craftcues': 'text/plain', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = [];
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const PROG = '// @daw bars=16\nsetcpm(240/4)\n//@ 1-8 section: first half | form:intro\nbell: n("0 2 4 3").scale("C4:minor").s("triangle").decay(0.1).gain(0.03) //@ 1-16 motif: the bell cell | MOT-01 | id=cell\n//@ 9-16 section: second half | form:drop\nbass: n("<0 -2>").scale("C2:minor").s("sawtooth").lpf(500).gain(0.03)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await ctx.addInitScript(() => { /* headless Chromium never hides a tab: emulate document.hidden (background.mjs does the same) */
  window.__hidden = false; Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden }); Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  window.__setHidden = (h) => { window.__hidden = h; document.dispatchEvent(new Event('visibilitychange')); }; });
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); const cdp = await ctx.newCDPSession(page);
const wait = (ms) => page.waitForTimeout(ms);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html#rack`); await page.waitForSelector('#list li[data-id]', { timeout: 60000 }); await wait(800);
  await page.evaluate((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } document.activeElement && document.activeElement.blur(); }, PROG); await wait(600);
  const play = async () => { await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 }); };
  const now = () => page.evaluate(() => +window.__sc.Engine.scheduler.now().toFixed(3));
  const stop = (ghost, seekTo) => page.evaluate(({ ghost, seekTo }) => { if (seekTo != null) window.strudelCraft.range.seek(seekTo); return new Promise((res) => setTimeout(() => { if (ghost) { const t0 = performance.now(); while (performance.now() - t0 < 300); } window.__sc.stop(); res(); }, seekTo != null ? 500 : 0)); }, { ghost, seekTo });
  const setStart = (s) => page.evaluate((s) => { const r = window.strudelCraft.range.state; r.start = s; r.end = Math.max(r.end, s + 16); }, s);
  /* one stop/play cycle: returns the readings; ghost = queue stale worker ticks behind a busy main thread before stop(); first = ms before the first reading */
  const cycle = async ({ ghost = false, start = 0, first = 400, tol = 0.1, seekTo = null, audition = false, hide = false, readout = true }) => {
    await play(); await wait(600); await stop(ghost, seekTo != null ? seekTo : ghost ? 40.25 : null); await wait(150);
    if (audition) { await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 'a' + Math.random(), title: 'T', code: 'note("e3*2").s("sine").gain(.02)' })); await wait(700); }
    if (hide) await page.evaluate(() => window.__setHidden(true));
    await play(); await wait(first); const a = await now(); await wait(500); const b = await now(); const lo = Math.max(0, start) - tol;
    if (hide) await page.evaluate(() => window.__setHidden(false));
    let rd = null; if (readout) { await wait(400); const c = await now(); const t = await page.evaluate(() => parseFloat((document.getElementById('trC').textContent || '').replace(/,/g, ''))); rd = { c, t }; }
    return { a, b, ok: a >= lo && b >= lo && b > a + 0.05 && b - a < 3 && (!rd || Math.abs(rd.t - rd.c) < 0.6), rd };
  };
  const block = async (label, n, o, pre) => { const bad = []; let min = Infinity; for (let i = 0; i < n; i++) { if (pre) await pre(i); const r = await cycle(o); min = Math.min(min, r.a, r.b); if (!r.ok) bad.push(`#${i} ${JSON.stringify(r)}`); } check(`${label}: ${n} stop/play runs, clock >= ${o.start || 0} - ${o.tol || 0.1}, increasing, readout agrees`, !bad.length, bad.length ? bad.slice(0, 3).join(' ') : `min ${min.toFixed(2)}`); };

  await block('plain', 20, {});
  await block('after a stale worker tick (busy main thread, seek 40, stop in the same task)', 20, { ghost: true });
  await setStart(4); await block('range Start 4 with the stale tick', 8, { ghost: true, start: 4 }); await setStart(0);
  await block('quick-play audition between stop and play (stale tick too)', 6, { ghost: true, audition: true });
  await block('page hidden while the run starts (stale tick too)', 6, { ghost: true, hide: true, readout: false });
  await block('tempo knob changed while playing (stale tick too)', 6, { ghost: true }, async (i) => { await play(); await page.focus('.tp-knobs .knob'); for (let j = 0; j < 4; j++) await page.keyboard.press(i % 2 ? ']' : '['); await wait(500); await page.evaluate(() => document.activeElement && document.activeElement.blur()); });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await block('CPU x4 (stale tick too; lookahead grows, first reading at 1.4 s)', 6, { ghost: true, first: 1400, tol: 0.3 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  /* Record start cycle and the captions strip after a stale tick */
  await play(); await wait(500); await stop(true, 40.25); await wait(200); await play(); await wait(900);
  const n0 = await now(); const take = await page.evaluate(async () => { const C = window.strudelCraft.capture; C.configure({ source: 'live', audio: false, events: false, code: true, mode: 'cycles', n: 1, name: 'clocktake', startBar: '' }); return await C.record(); });
  const t0 = take && take.recipe && take.recipe.timing && take.recipe.timing.start;
  check('Record start cycle is the next cycle after the clock, not negative or the old position', t0 != null && n0 >= 0 && t0 >= Math.floor(n0) && t0 <= n0 + 3, `now ${n0} start ${t0}`);
  await page.evaluate(() => window.__sc.stop()); await wait(300);
  await play(); await wait(500); await stop(true, 40.25); await wait(200); await play();
  await page.waitForSelector('.cu-strip:not([hidden])', { timeout: 60000 }).catch(() => {}); await wait(1200);
  const cs = await page.evaluate(() => { const s = document.querySelector('.cu-strip'); return { bar: s ? +s.dataset.bar : null, now: window.__sc.Engine.scheduler.now() }; });
  check('captions strip bar follows the clock after a stale tick', cs.bar != null && Math.abs(cs.bar - (Math.floor(cs.now) + 1)) <= 1 && cs.now >= -0.1, JSON.stringify(cs));
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); server.close(); }
console.log(fails ? `${fails} FAIL` : 'all PASS'); process.exit(fails ? 1 : 0);
