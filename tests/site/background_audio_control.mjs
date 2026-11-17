/* Control for tests/site/background_audio.mjs (#178): a bare upstream Strudel page (@strudel/web 1.3.0 from unpkg, initStrudel + evaluate, no site code) playing the
   same pattern under the same cases (a foreground, b hidden with 1 Hz main-thread timers, c touch scrolling, d 4x CPU) on the same phone profile.
   Upstream's scheduler captures its onTrigger in a closure, so lateness is read from what upstream itself reports: Strudel's logs "skip query: too late" (query dropped) and superdough's "cannot schedule sounds in the past" (voice dropped), plus the start times of the oscillators it creates (grid check) and their lead time over AudioContext.currentTime.
   Usage: node tests/site/background_audio_control.mjs [--secs 12] [--hidden-secs 60] [--scroll-secs 30] [--json OUT] */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SECS = +arg('--secs', 12), HID = +arg('--hidden-secs', 60), SCR = +arg('--scroll-secs', 30);
const HTML = `<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0"><div style="height:6000px">bare upstream strudel</div><script src="https://unpkg.com/@strudel/web@1.3.0/dist/index.js"></script>`;
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(HTML); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const ctx = await browser.newContext({ ignoreHTTPSErrors: !!PROXY, viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.addInitScript(() => {
  window.__hidden = false; window.__throttle = false; window.__ac = [];
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  const si = window.setInterval.bind(window), st = window.setTimeout.bind(window);
  window.setInterval = (fn, ms, ...a) => { let last = 0; return si(() => { if (window.__throttle) { const n = performance.now(); if (n - last < 1000) return; last = n; } typeof fn === 'function' ? fn(...a) : 0; }, ms); };
  window.setTimeout = (fn, ms, ...a) => st(fn, window.__throttle ? Math.max(ms || 0, 1000) : ms, ...a);
  window.__setHidden = (h) => { window.__hidden = h; window.__throttle = h; document.dispatchEvent(new Event('visibilitychange')); };
  const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { super(o); window.__ac.push(o ? JSON.stringify(o) : 'default'); } };
});
const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
await page.goto(BASE); await page.waitForFunction(() => window.initStrudel, null, { timeout: 60000 });
await page.evaluate(async () => { window.__m = []; window.__drops = 0; const cl = console.log.bind(console), cw = console.warn.bind(console); const f = (a) => { if (/skip query: too late|cannot schedule sounds in the past/.test(String(a[0]))) window.__drops++; };
  console.log = (...a) => { f(a); cl(...a); }; console.warn = (...a) => { f(a); cw(...a); };
  const st = AudioScheduledSourceNode.prototype.start; AudioScheduledSourceNode.prototype.start = function (t, ...r) { if (this instanceof OscillatorNode) window.__m.push([(t || 0) - this.context.currentTime, t || 0]); return st.call(this, t, ...r); };
  const r = await window.initStrudel(); window.__r = r; await r.evaluate('setcpm(120/4)\n$: note("c4*8").s("sine").gain(.05)'); });
await page.waitForTimeout(2500);
const results = {};
async function runCase(name, ms, during) {
  await page.evaluate(() => { window.__m = []; }); await during(ms);
  const m = await page.evaluate(() => window.__m.slice()); const t = m.map((x) => x[1]).sort((a, b) => a - b);
  let holes = 0; for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - t[i - 1] - 0.25) > 0.02) holes++;
  const drops = await page.evaluate(() => { const d = window.__drops; window.__drops = 0; return d; }); const o = { haps: m.length, dropLogs: drops, late: m.filter((x) => x[0] < 0).length, tight: m.filter((x) => x[0] >= 0 && x[0] < 0.02).length, minMarginMs: Math.round(Math.min(...m.map((x) => x[0])) * 1000), holes };
  results[name] = o; console.log(name, JSON.stringify(o));
}
const wait = (ms) => page.waitForTimeout(ms);
await runCase('a-foreground', SECS * 1000, wait);
await page.evaluate(() => window.__setHidden(true)); await runCase('b-hidden', HID * 1000, wait); await page.evaluate(() => window.__setHidden(false)); await wait(1500);
await runCase('c-scroll', SCR * 1000, async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 500, yDistance: -400, speed: 1500, gestureSourceType: 'touch' }).catch(() => {}); await cdp.send('Input.synthesizeScrollGesture', { x: 180, y: 300, yDistance: 400, speed: 1500, gestureSourceType: 'touch' }).catch(() => {}); } });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await runCase('d-cpu4x', SECS * 1000, wait); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
results.context = await page.evaluate(() => window.__ac); console.log('context', JSON.stringify(results.context));
const J = arg('--json', null); if (J) fs.writeFileSync(J, JSON.stringify(results, null, 1));
await browser.close(); server.close();
