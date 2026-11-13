// Behavioral smoke test for the site (issue #32): `node tests/smoke.mjs`
// Needs: playwright (with Chromium) resolvable from Node, network access (Strudel loads from unpkg).
// Taps the AudioContext destination with an AnalyserNode (injected before the page runs), reads RMS every 10 ms.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404).end(); return; }
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/index.html`;

// Injected before page scripts: every node connected to a destination also feeds a tap analyser; 10 ms RMS poll.
const TAP = () => {
  const native = AudioNode.prototype.connect; const taps = new WeakMap();
  window.__rms = []; window.__ctxCount = 0;
  const NativeCtx = window.AudioContext;
  window.AudioContext = class extends NativeCtx { constructor(...a) { super(...a); window.__ctxCount++; } };
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !taps.has(dest.context)) {
      const an = new AnalyserNode(dest.context, { fftSize: 512 }); taps.set(dest.context, an);
      window.__tap = an; window.__buf = new Float32Array(512);
    }
    if (dest instanceof AudioDestinationNode && taps.has(dest.context)) native.call(this, taps.get(dest.context));
    return native.call(this, dest, ...rest);
  };
  setInterval(() => {
    if (!window.__tap) return; window.__tap.getFloatTimeDomainData(window.__buf);
    let s = 0; for (const v of window.__buf) s += v * v;
    window.__rms.push([performance.now(), 10 * Math.log10(s / window.__buf.length + 1e-14)]);
  }, 10);
};

const results = []; const note = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (page, ms) => page.evaluate((ms) => { const n = performance.now(); return window.__rms.filter(([t]) => t > n - ms).map((x) => x[1]); }, ms);
const maxDb = (a) => (a.length ? Math.max(...a) : -Infinity);
// first time (ms after t0) where RMS stays below `thr` for the rest of a 400 ms window; null if never
const silenceAfter = (page, t0, thr) => page.evaluate(([t0, thr]) => {
  const w = window.__rms.filter(([t]) => t >= t0 && t <= t0 + 1200);
  for (let i = 0; i < w.length; i++) if (w.slice(i).every(([, d]) => d < thr)) return w[i][0] - t0;
  return null;
}, [t0, thr]);

async function playAndMeasure(page, name) {
  await page.evaluate(() => window.__sc.Engine.load()); // wait for Strudel to finish loading so CDN time is not counted
  await page.evaluate(() => { window.__rms.length = 0; });
  const t0 = await page.evaluate(() => performance.now());
  await page.click('#playBtn');
  let ok = false, best = -Infinity, ms = null;
  for (let i = 0; i < 300 && !ok; i++) { await sleep(20); const t = await page.evaluate(() => performance.now()); best = Math.max(best, maxDb(await last(page, 40))); if (best > -50) { ok = true; ms = Math.round(t - t0); } }
  return { ok, best, ms };
}
async function stopAndMeasure(page) {
  await sleep(1500); // let the pattern run so there is something to silence
  const t0 = await page.evaluate(() => { const t = performance.now(); document.querySelector('#playBtn').click(); return t; });
  await sleep(1300);
  return silenceAfter(page, t0, -70);
}

let browser;
try {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.addInitScript(TAP);
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.goto(URL_); await page.waitForSelector('#list li');
  // pick two simple non-sample recipes
  const ids = await page.evaluate(() => window.__sc.S.filtered.filter((r) => r.expr && !r.needs_samples && !/\.bank\(/.test(r.code)).slice(0, 2).map((r) => r.id));
  const pick = (id) => page.evaluate((id) => { const i = window.__sc.S.filtered.findIndex((r) => r.id === id); window.__sc.select(i, { audition: false }); }, id);

  // 1 Play starts audio
  await pick(ids[0]);
  const p = await playAndMeasure(page);
  note('Play starts audio (RMS > -50 dBFS within 1 s)', p.ok && p.ms <= 1000, `peak=${p.best.toFixed(1)} dBFS after ${p.ms} ms`);

  // 2 Stop silences within 100 ms
  const sil = await stopAndMeasure(page);
  note('Stop silences (RMS < -70 dBFS within 100 ms)', sil !== null && sil <= 100, sil === null ? 'never silent within 1.2 s' : `silent after ${Math.round(sil)} ms`);

  // 3 Switching recipes leaves only the new one running
  await pick(ids[0]); await page.click('#playBtn'); await sleep(1500);
  await page.click('#nextBtn'); await sleep(2500);
  const sw = await page.evaluate(() => { const { S, Engine } = window.__sc; return { id: S.playingId, sel: S.filtered[S.sel].id, started: Engine.started, ctx: window.__ctxCount, playing: S.playing }; });
  note('Switching recipes: single scheduler, only new recipe active', sw.playing && sw.id === sw.sel && sw.id !== ids[0] && sw.started && sw.ctx === 1 && maxDb(await last(page, 300)) > -50, `playing=${sw.id} contexts=${sw.ctx} started=${sw.started}`);
  const t1 = await page.evaluate(() => { const t = performance.now(); document.querySelector('#playBtn').click(); return t; }); await sleep(300); void t1;

  // 4 Compose (stack view) plays and stops
  await page.goto(URL_ + '#stack'); await page.reload(); await page.waitForSelector('#list li');
  await page.evaluate((id) => { window.__sc.setView('stack'); window.__sc.S.stack.length || window.__sc.toggleStack(id); }, ids[0]);
  const c = await playAndMeasure(page); const csil = c.ok ? await stopAndMeasure(page) : null;
  note('Compose page plays (> -50 dBFS in 1 s) and stops (< -70 dBFS in 100 ms)', c.ok && c.ms <= 1000 && csil !== null && csil <= 100, `peak=${c.best.toFixed(1)} dBFS, silent after ${csil === null ? 'never' : Math.round(csil) + ' ms'}`);
} catch (e) { note('smoke harness', false, String(e).slice(0, 200)); }
finally { await browser?.close(); server.close(); }
process.exit(results.length >= 4 && results.every(Boolean) ? 0 : 1);
