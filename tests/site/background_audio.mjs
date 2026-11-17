/* Phone audio glitches (#178): background + scroll + CPU load. Serves site/, Chromium with a phone profile (360x780, touch, mobile UA), plays
   note("c4*8") at cps 0.5 (one hap every 0.25 s) and, per case, reads the scheduler counters of strudelCraft.bg (lateness = target audio time minus
   AudioContext.currentTime at schedule time; a negative value is a late event that superdough drops) and the scheduled-time trace:
   (a) foreground idle, (b) page hidden (visibility override + Chrome's 1 Hz main-thread timer throttling; workers exempt), (c) continuous touch scrolling,
   (d) 4x CPU throttle (CDP). Asserts per case: zero late events, zero re-anchored windows, no gap in the scheduled output (trace spacing 0.25 s,
   no missing hap). The AudioContext options are printed (informational: the site and upstream both use the default hint).
   Usage: node tests/site/background_audio.mjs [--secs 12] [--hidden-secs 60] [--scroll-secs 30] [--json OUT]   (defaults: 12 / 60 / 30 / 12 s) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SECS = +arg('--secs', 12), HID = +arg('--hidden-secs', 60), SCR = +arg('--scroll-secs', 30);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = []; const check = (n, ok, d = '') => { checks.push({ name: n, ok: !!ok, detail: d }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy; /* sandboxes reach unpkg only through the agent proxy */
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const ctx = await browser.newContext({ ignoreHTTPSErrors: !!PROXY, viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
await ctx.addInitScript(() => {
  window.__hidden = false; window.__throttle = false; window.__ac = [];
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  const si = window.setInterval.bind(window), st = window.setTimeout.bind(window), raf = window.requestAnimationFrame.bind(window);
  window.setInterval = (fn, ms, ...a) => { let last = 0; return si(() => { if (window.__throttle) { const n = performance.now(); if (n - last < 1000) return; last = n; } typeof fn === 'function' ? fn(...a) : 0; }, ms); };
  window.setTimeout = (fn, ms, ...a) => st(fn, window.__throttle ? Math.max(ms || 0, 1000) : ms, ...a);
  window.requestAnimationFrame = (fn) => raf((t) => { if (window.__hidden) { window.__rafHidden = (window.__rafHidden || 0) + 1; return; } fn(t); }); /* a hidden page runs no rAF; counted if it would have */
  window.__setHidden = (h) => { window.__hidden = h; window.__throttle = h; document.dispatchEvent(new Event('visibilitychange')); };
  const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { super(o); window.__ac.push(o ? JSON.stringify(o) : 'default'); } };
});
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); if (process.argv.includes('--debug')) page.on('console', (m) => { if (/error|warn/.test(m.type())) console.error('console.' + m.type() + ': ' + m.text().slice(0, 200)); });
const cdp = await ctx.newCDPSession(page);
await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(1000);
const ed = page.locator('.view[data-for=rack] .cm-content:visible').first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('setcpm(120/4)\n$: note("c4*8").s("sine").gain(.05)\n' + '// filler line to make the page scroll\n'.repeat(60)); await page.waitForTimeout(600);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 }); await page.waitForTimeout(1500);
const E = (f, a) => page.evaluate(f, a);
const results = {};
async function runCase(name, ms, during) {
  await E(() => { const B = window.strudelCraft.bg; B.trace = true; window.strudelCraft.bg.__t0 = window.getAudioContext().currentTime; });
  const s0 = await E(() => window.strudelCraft.bg.stats()); const lt0 = s0.perf;
  await E(() => { window.strudelCraft.bg.trace = true; });
  await during(ms);
  const r = await E(() => { const B = window.strudelCraft.bg, s = B.stats(), tr = B.trace.slice(); B.trace = null; return { s, tr, now: window.getAudioContext().currentTime }; });
  /* gap check: the scheduled targets must be the pattern's 0.25 s grid with no missing hap */
  const t = r.tr.map((x) => x[1]).sort((a, b) => a - b); let worst = 0, holes = 0; for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1]; if (Math.abs(d - 0.25) > 0.02) { holes++; worst = Math.max(worst, Math.abs(d - 0.25)); } }
  const o = { haps: t.length, late: r.s.perf.lateHaps - lt0.lateHaps, tight: r.s.perf.tightHaps - lt0.tightHaps, minMarginMs: r.s.perf.minMarginMs, rescued: r.s.perf.rescuedWindows - lt0.rescuedWindows, underruns: r.s.underruns - s0.underruns, lateTicks: r.s.lateTicks - s0.lateTicks, maxGapMs: r.s.maxGapMs, lookaheadMs: r.s.lookaheadMs, longTasks: r.s.perf.longTasks - (lt0.longTasks || 0), longTaskWorstMs: r.s.perf.longTaskWorstMs, holes, worstHoleS: +worst.toFixed(3) };
  results[name] = o; console.log(name, JSON.stringify(o));
  check(`${name}: no late events (target before currentTime), no re-anchored window`, o.late === 0 && o.rescued === 0 && o.underruns === 0, `late ${o.late} rescued ${o.rescued} underruns ${o.underruns} minMargin ${o.minMarginMs} ms`);
  check(`${name}: no gap in the scheduled output`, o.holes === 0 && o.haps >= Math.floor(ms / 1000 * 4 * 0.8), `${o.haps} haps, ${o.holes} off-grid spacings`);
}
const wait = (ms) => page.waitForTimeout(ms);
await runCase('a-foreground', SECS * 1000, wait);
await E(() => window.__setHidden(true)); await runCase('b-hidden', HID * 1000, wait); const hidRaf = await E(() => window.__rafHidden || 0); await E(() => window.__setHidden(false)); await wait(1500);
await runCase('c-scroll', SCR * 1000, async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 500, yDistance: -400, speed: 1500, gestureSourceType: 'touch' }).catch(() => {}); await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 300, yDistance: 400, speed: 1500, gestureSourceType: 'touch' }).catch(() => {}); } });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await runCase('d-cpu4x', SECS * 1000, wait); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const ac = await E(() => window.__ac); const hint = ac.map((x) => (/latencyHint/.test(x) ? JSON.parse(x).latencyHint : x));
const tc = await E(() => ({ clock: window.strudelCraft.bg.stats().clock, base: window.getAudioContext().baseLatency, mediaSession: navigator.mediaSession.metadata && navigator.mediaSession.metadata.title, playbackState: navigator.mediaSession.playbackState }));
results.context = { opened: hint, ...tc, rafSkippedWhileHidden: hidRaf };
console.log('context', JSON.stringify(results.context));
console.log('INFO  AudioContext options (upstream superdough opens new AudioContext() = "interactive"; the control does the same):', JSON.stringify(ac));
check('Media Session metadata + playing state while playing', !!tc.mediaSession && tc.playbackState === 'playing', JSON.stringify(tc));
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
const J = arg('--json', null); if (J) fs.writeFileSync(J, JSON.stringify(results, null, 1));
await browser.close(); server.close();
const bad = checks.filter((c) => !c.ok); console.log(`${checks.length - bad.length}/${checks.length} checks passed`); process.exit(bad.length ? 1 : 0);
