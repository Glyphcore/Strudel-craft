/* Load matrix for #178: a real, dense standalone program on the phone profile, one configuration per run, three separate budgets:
   (1) scheduler: late haps, re-anchored windows, tick gaps (strudelCraft.bg.stats); (2) audio thread: AudioContext.playbackStats (underrunEvents/duration) and
   renderCapacity (average/peak load, underrunRatio) where Chromium exposes them; (3) main thread: ms per query pass, voice-build ms, nodes created per second,
   long tasks. Levers are measurement-only (nothing lands): --query sched=batch, --raf off (visuals off), --hint playback|<seconds> (wraps new AudioContext()),
   --poly N (setMaxPolyphony). Cases: --hidden (visibility + 1 Hz timers), --scroll (touch gestures), --throttle N (CDP CPU).
   Usage: node tests/site/background_audio_load.mjs --prog docs/tracks/velvet-static/track.standalone.strudel.js [--throttle 6] [--hidden] [--scroll] [--secs 30] [--warm 10000]
          [--query k=v] [--raf off] [--hint playback] [--poly 24] [--json OUT]. Prints one JSON line. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }, has = (k) => process.argv.includes(k);
const PROG = arg('--prog'), THR = +arg('--throttle', 1), SECS = +arg('--secs', 30), HINT = arg('--hint', null), POLY = +arg('--poly', 0), RAFOFF = arg('--raf', 'on') === 'off';
const QUERY = process.argv.flatMap((a, i) => (a === '--query' ? [process.argv[i + 1]] : [])).join('&');
const code = fs.readFileSync(path.resolve(ROOT, PROG), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/${QUERY ? '?' + QUERY : ''}`;
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const ctx = await browser.newContext({ ignoreHTTPSErrors: !!PROXY, viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
await ctx.addInitScript(({ hint, rafoff }) => {
  window.__hidden = false; window.__throttle = false; window.__nodes = 0; window.__lt = { n: 0, worst: 0 };
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  const si = window.setInterval.bind(window), st = window.setTimeout.bind(window), raf = window.requestAnimationFrame.bind(window);
  window.setInterval = (fn, ms, ...a) => { let last = 0; return si(() => { if (window.__throttle) { const n = performance.now(); if (n - last < 1000) return; last = n; } typeof fn === 'function' ? fn(...a) : 0; }, ms); };
  window.setTimeout = (fn, ms, ...a) => st(fn, window.__throttle ? Math.max(ms || 0, 1000) : ms, ...a);
  window.requestAnimationFrame = (fn) => (rafoff || window.__hidden ? 0 : raf(fn));
  window.__setHidden = (h) => { window.__hidden = h; window.__throttle = h; document.dispatchEvent(new Event('visibilitychange')); };
  const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { super(hint ? { ...(o || {}), latencyHint: isNaN(+hint) ? hint : +hint } : o); window.__ctxOpts = [hint || 'default', this.baseLatency]; } };
  for (const k of Object.getOwnPropertyNames(BaseAudioContext.prototype)) if (/^create/.test(k)) { const f = BaseAudioContext.prototype[k]; BaseAudioContext.prototype[k] = function (...a) { window.__nodes++; return f.apply(this, a); }; }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.n++; if (e.duration > window.__lt.worst) window.__lt.worst = e.duration; } }).observe({ type: 'longtask' }); } catch (e) { /* n/a */ }
}, { hint: HINT, rafoff: RAFOFF });
const page = await ctx.newPage(); const errors = [], drops = { past: 0, loading: 0 };
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120))); page.on('console', (m) => { const t = m.text(); if (/cannot schedule sounds in the past/.test(t)) drops.past++; else if (/still loading/.test(t)) drops.loading++; });
page.on('crash', () => console.error('PAGE CRASH')); page.on('close', () => console.error('PAGE CLOSE')); browser.on('disconnected', () => console.error('BROWSER GONE'));
const cdp = await ctx.newCDPSession(page);
await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(1000);
const ed = page.locator('.view[data-for=rack] .cm-content:visible').first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(code); await page.waitForTimeout(1500);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => (window.__sc.S.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'), null, { timeout: 180000 });
const started = await page.evaluate(() => window.__sc.S.playing && window.__sc.Engine.started);
if (!started) { console.log(JSON.stringify({ error: 'did not start', status: await page.evaluate(() => document.querySelector('#status').textContent.slice(0, 200)) })); process.exit(2); }
if (POLY) await page.evaluate((n) => window.setMaxPolyphony && window.setMaxPolyphony(n), POLY);
await page.waitForTimeout(+arg('--warm', 10000)); /* samples fetched and decoded */
const snap = () => page.evaluate(() => { const c = window.getAudioContext(), s = window.strudelCraft.bg.stats(), ps = c.playbackStats; return { s, nodes: window.__nodes, lt: { ...window.__lt }, ps: ps ? { events: ps.underrunEvents, dur: ps.underrunDuration, avgLat: ps.averageLatency } : null }; });
await page.evaluate(() => { const c = window.getAudioContext(); if (c.renderCapacity) { window.__rc = []; c.renderCapacity.addEventListener('update', (e) => window.__rc.push([e.averageLoad, e.peakLoad, e.underrunRatio])); c.renderCapacity.start({ updateInterval: 1 }); } });
await cdp.send('Performance.enable'); const pm = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])); const pm0 = await pm();
const a = await snap(); if (THR > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR }); if (has('--hidden')) await page.evaluate(() => window.__setHidden(true));
const t0 = Date.now();
if (has('--scroll')) { while (Date.now() - t0 < SECS * 1000) { await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 500, yDistance: -400, speed: 1500, gestureSourceType: 'touch' }).catch(() => {}); await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 300, yDistance: 400, speed: 1500, gestureSourceType: 'touch' }).catch(() => {}); } }
else await page.waitForTimeout(SECS * 1000);
if (THR > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); const wall = (Date.now() - t0) / 1000;
const pm1 = await pm(); const b = await snap(); const rc = await page.evaluate(() => window.__rc || null); const co = await page.evaluate(() => window.__ctxOpts);
const p = (k) => b.s.perf[k] - a.s.perf[k], d = (k) => b.s[k] - a.s[k];
const out = { prog: path.basename(path.dirname(PROG)), thr: THR, hidden: has('--hidden'), scroll: has('--scroll'), rafOff: RAFOFF, query: QUERY || null, ctx: co ? co.join('/') : null, poly: POLY || null, wallS: +wall.toFixed(1),
  sched: { haps: p('haps'), lateHaps: p('lateHaps'), skipped: p('skippedHaps'), tight: p('tightHaps'), rescued: p('rescuedWindows'), underruns: d('underruns'), lateTicks: d('lateTicks'), maxGapMs: b.s.maxGapMs, minMarginMs: b.s.perf.minMarginMs, lookaheadMs: b.s.lookaheadMs, superdoughPast: drops.past, stillLoading: drops.loading },
  audio: { underrunEvents: b.ps && b.ps.events - a.ps.events, underrunMs: b.ps && Math.round((b.ps.dur - a.ps.dur) * 1000), avgLatencyMs: b.ps && Math.round(b.ps.avgLat * 1000), rc: rc && rc.length ? { avg: +(rc.reduce((x, y) => x + y[0], 0) / rc.length).toFixed(2), peak: +Math.max(...rc.map((y) => y[1])).toFixed(2), underrunRatio: +Math.max(...rc.map((y) => y[2])).toFixed(3) } : null },
  main: { taskMsPerS: Math.round((pm1.TaskDuration - pm0.TaskDuration) * 1000 / wall), scriptMsPerS: Math.round((pm1.ScriptDuration - pm0.ScriptDuration) * 1000 / wall), queryMsPerS: Math.round(p('queryMs') / wall), queryMaxMs: b.s.perf.queryMaxMs, tickMsPerS: Math.round(p('tickMs') / wall), voiceMsPerS: Math.round(p('voiceMs') / wall), nodesPerS: Math.round((b.nodes - a.nodes) / wall), longTasks: b.lt.n - a.lt.n, longTaskWorstMs: Math.round(b.lt.worst), voicesInFlight: b.s.perf.voicesInFlight }, errors: errors.length, engine: await page.evaluate(() => window.strudelCraft.bg.engine()) };
console.log(JSON.stringify(out)); const J = arg('--json', null); if (J) fs.writeFileSync(J, JSON.stringify(out, null, 1));
await browser.close(); server.close();
