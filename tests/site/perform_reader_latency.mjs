// #119: press-to-sound latency of the live tap-pad reader. Standalone: node tests/site/perform_reader_latency.mjs [--n 15] [--limit 80]
// Real touch (CDP Input.dispatchTouchEvent) on the Beatpad "kick" pad; the page records the pointerdown event time and polls the master analyser
// in a tight loop; latency = first analyser sample above 0.01 minus the event time. p50 must be <= 80 ms (trigger form), gain/mask forms are reported.
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const { chromium } = createRequire(import.meta.url)('playwright'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; }; const N = arg('n', 15), LIMIT = arg('limit', 80);
const ALL = {
  trigger: '$: tap("kick").note("c4").s("sine").legato(0.5)\n',
  mask: '$: note("c4*8").s("sine").legato(1).mask(tap("kick"))\n',
  gain: '$: note("c4*8").s("sine").legato(1).gain(tap("kick"))\n',
};
const FORMS = process.env.FORMS ? Object.fromEntries(Object.entries(ALL).filter(([k]) => process.env.FORMS.split(',').includes(k))) : ALL;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [form, code] of Object.entries(FORMS)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.evaluate(() => { localStorage.removeItem('sc.perform'); localStorage.removeItem('sc.perform.presets'); });
    await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, code);
    await page.evaluate(() => window.__sc.setView('perform')); await page.waitForFunction(() => window.strudelCraft.perform && window.strudelCraft.perform.presets, null, { timeout: 60000 });
    await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 }); await page.waitForTimeout(1000);
    await page.evaluate(() => window.strudelCraft.perform.presets.apply('beatpad-4x4')); await page.waitForSelector('#perform .pp-pad:not([data-state=empty])'); await page.waitForTimeout(800);
    // page-side probe: event time of the touch's pointerdown, then the first analyser read above the threshold (a MessageChannel loop reads every ~1 ms)
    await page.evaluate(() => {
      const P = window.__lat = { down: 0, first: 0, on: false, runs: [] }; const mc = new MessageChannel(); let buf = null;
      document.addEventListener('pointerdown', (e) => { P.down = e.timeStamp; P.first = 0; P.max = 0; P.on = true; }, true);
      mc.port1.onmessage = () => { if (P.on && !P.first) { const an = window.__sc.Bus.an; if (an) { buf = buf || new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf); let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); P.max = Math.max(P.max || 0, pk); if (pk > 0.01) P.first = performance.now(); } } mc.port2.postMessage(0); };
      mc.port2.postMessage(0);
    });
    const b = await page.locator('.pp-pad[data-pos="0,0"]').boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const cdp = await ctx.newCDPSession(page); const lat = [];
    for (let i = 0; i < N; i++) {
      await page.waitForTimeout(700); // the previous hit has decayed (silence before the press)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(450);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const dbg = await page.evaluate(() => { const P = window.__lat; P.on = false; return [P.down, P.first, +(P.max || 0).toFixed(4), window.strudelCraft.perform.lastCatch && window.strudelCraft.perform.lastCatch.fired]; }); const r = dbg[0] && dbg[1] ? dbg[1] - dbg[0] : -1; if (process.env.DBG) console.log('  press', i, JSON.stringify(dbg)); if (r >= 0) lat.push(+r.toFixed(1)); await page.waitForTimeout(250);
    }
    const info = await page.evaluate(() => window.strudelCraft.perform.lastCatch || null);
    console.log(form, JSON.stringify({ n: lat.length, p50: pct(lat, 0.5), p90: pct(lat, 0.9), max: Math.max(...lat), lat, lastCatch: info && { fired: info.fired, haps: (info.haps || []).slice(0, 3) } }));
    if (form === 'trigger') { check(`trigger: ${lat.length}/${N} presses produced a first analyser sample`, lat.length >= N * 0.9); check(`trigger: press to first sound p50 <= ${LIMIT} ms`, lat.length > 0 && pct(lat, 0.5) <= LIMIT, `p50 ${pct(lat, 0.5)} ms, p90 ${pct(lat, 0.9)} ms`); }
    else check(`${form}: every press sounds (info: p50 ${pct(lat, 0.5)} ms)`, lat.length >= N * 0.9);
    check(`${form}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | ')); await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
