/* Audio engine measurements (docs/AUDIO_ENGINE.md, Part A). Serves site/ under /Strudel-craft/, Playwright Chromium at 360x780 (mobile profile),
   loads a night phonk program from its Syntax entry, then plays from a seek point under CDP CPU throttling and records:
   - main-thread long tasks (PerformanceObserver 'longtask') and long animation frames with script attribution ('long-animation-frame')
   - a CDP sampling profile, main-thread time grouped by the nearest site-file caller (evaluate, compile passes, visuals, scheduler, ...)
   - scheduler counters from strudelCraft.bg.stats(): tick lateness, query and voice-construction time, late haps (target already past), min margin
   - superdough's own drop warnings ("cannot schedule sounds in the past", "still loading") from the console
   - optionally a live capture of N cycles (Record panel tap) compared with the CLI render of the same window (tests/site/lib/glitch.mjs)
   Usage: node tests/site/engine_perf.mjs [--prog v1|v2] [--throttle 4] [--hidden] [--secs 20] [--capture 4] [--ref REF.wav --ref-from CYCLE]
                                           [--query k=v ...] [--json OUT.json]
   Prints one JSON object (and writes it with --json). Exit 0 unless the page fails to load. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { compare, mono, readWav } from './lib/glitch.mjs';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), PREFIX = '/Strudel-craft/';
const SITE = (() => { const i = process.argv.indexOf('--site'); return i > 0 ? path.resolve(process.argv[i + 1]) : path.join(ROOT, 'site'); })(); /* --site DIR: serve another build (a baseline from git archive) */
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PROG = arg('--prog', 'v2'), THR = +arg('--throttle', 1), HIDDEN = process.argv.includes('--hidden'), SECS = +arg('--secs', 20), CAP = +arg('--capture', 0);
const SEEK = +arg('--seek', PROG === 'v2' ? 16 : 48); /* drop A (bar 17) in v2, drop 2 (bar 49) in v1 */
const QUERY = process.argv.flatMap((a, i) => (a === '--query' ? [process.argv[i + 1]] : [])).join('&');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}${QUERY ? '?' + QUERY : ''}`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
await ctx.addInitScript(() => {
  const P = (window.__perf = { lt: [], loaf: [], on: false });
  try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.lt.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch (e) { P.ltErr = e.message; }
  try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.loaf.push({ d: e.duration, block: e.blockingDuration, scripts: (e.scripts || []).map((s) => ({ d: s.duration, inv: s.invokerType + ' ' + String(s.invoker || '').slice(0, 60), src: String(s.sourceURL || '').replace(/^.*\//, '') + ':' + (s.sourceFunctionName || '?') })) }); }).observe({ type: 'long-animation-frame', buffered: false }); } catch (e) { P.loafErr = e.message; }
});
const page = await ctx.newPage(); const cons = { past: 0, loading: 0, errors: [] };
page.on('pageerror', (e) => cons.errors.push(e.message.slice(0, 160))); if (process.argv.includes('--debug')) page.on('console', (m) => { if (/error|warn/.test(m.type())) console.error('console.' + m.type() + ': ' + m.text().slice(0, 240)); });
page.on('console', (m) => { const t = m.text(); if (/cannot schedule sounds in the past/.test(t)) cons.past++; else if (/still loading/.test(t)) cons.loading++; });
await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.__sc.audio && window.strudelCraft && window.strudelCraft.packs, null, { timeout: 90000 });
await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; await P.load('glyphcore/phonk:atoms'); await P.load('glyphcore/phonk:presets'); });
await page.evaluate(() => window.__sc.setView('syntax')); const NTH = PROG === 'v2' ? 1 : 0;
/* the Syntax view re-renders on strudel:ready; click the entry from inside the page, retried until the program plays */
for (let k = 0; k < 5; k++) { await page.waitForFunction((n) => document.querySelectorAll('#sx-tracks .sx-run').length > n, NTH, { timeout: 150000 }); await page.waitForTimeout(500);
  if (await page.evaluate((n) => { const b = document.querySelectorAll('#sx-tracks .sx-run')[n]; if (!b) return false; b.click(); return true; }, NTH)) break; }
 await page.waitForFunction(() => { const s = window.__sc.S; return (!s.busy && s.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'); }, null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000); /* warm: samples and vox banks fetched and decoded */
await page.tap('#playBtn'); await page.waitForFunction(() => !window.__sc.S.playing, null, { timeout: 10000 }).catch(() => {});
await page.evaluate((c) => Object.assign(window.strudelCraft.range.state, { start: c }), SEEK);
const cdp = await ctx.newCDPSession(page);
if (THR > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
cons.past = 0; cons.loading = 0; await page.evaluate(() => { window.__perf.on = true; window.__perf.t0 = performance.now(); });
const t0 = Date.now(); await page.tap('#playBtn');
await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy, null, { timeout: 120000 }).catch(() => {});
const playMs = Date.now() - t0;
let other = null, vis = 'visible';
if (HIDDEN) { other = await ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); await page.waitForTimeout(300); vis = await page.evaluate(() => document.visibilityState);
  if (vis !== 'hidden') { /* headless did not hide the page: simulate (document.hidden + visibilitychange), the lifecycle bgplay and capture react to */
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); vis = 'simulated-hidden'; } }
let take = null;
if (CAP > 0) {
  take = await page.evaluate(async ({ n, at }) => { const C = window.strudelCraft.capture; C.configure({ source: 'live', audio: true, events: false, code: false });
    const rec = await C.record({}, { mode: 'cycles', n, at, name: 'perf' }); if (!rec || !rec.audio.capture) return null;
    const { L, R, sr } = rec.audio.capture; const m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = 0.5 * (L[i] + R[i]);
    const b = new Uint8Array(m.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    await C.remove(rec.id); return { sr, frames: L.length, start: rec.recipe.timing.start, segments: rec.recipe.timing.segments || [], b64: btoa(s) }; }, { n: CAP, at: SEEK + 1 });
}
if (process.argv.includes('--probe')) console.error('probe', JSON.stringify(await page.evaluate(() => { const st = window.strudelCraft.engineState(); const p = st.pattern; const c = Math.floor(st.scheduler.now()); const T = (f) => { const a = performance.now(); const n = f(); return [+(performance.now() - a).toFixed(1), n]; };
  return { cycle1: T(() => p.queryArc(c, c + 1).length), cycle4: T(() => p.queryArc(c - 2, c + 2).length), tick50ms: T(() => { let n = 0; for (let i = 0; i < 20; i++) n += p.queryArc(c + i * 0.027, c + (i + 1) * 0.027).length; return n; }) }; })));
const rest = SECS * 1000 - (Date.now() - t0); if (rest > 0) await page.waitForTimeout(rest);
/* measurement window over: lift the throttling first, so collecting the numbers does not wait behind a saturated main thread */
if (THR > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const prof = (await cdp.send('Profiler.stop')).profile;
const res = await page.evaluate((secs) => { const P = window.__perf; P.on = false; const lt = P.lt; const bg = window.strudelCraft.bg.stats();
  const by = {}; for (const f of P.loaf) for (const s of f.scripts) { const k = s.src + ' <' + s.inv.split(' ')[0] + '>'; (by[k] = by[k] || { n: 0, ms: 0 }).n++; by[k].ms += s.d; }
  return { wallS: +((performance.now() - P.t0) / 1000).toFixed(1), measuredS: secs, longTasks: { n: lt.length, totalMs: Math.round(lt.reduce((a, b) => a + b, 0)), worstMs: Math.round(Math.max(0, ...lt)), over100: lt.filter((x) => x > 100).length, err: P.ltErr },
    loaf: { n: P.loaf.length, worstMs: Math.round(Math.max(0, ...P.loaf.map((f) => f.d))), blockingMs: Math.round(P.loaf.reduce((a, f) => a + (f.block || 0), 0)), top: Object.entries(by).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12).map(([k, v]) => [k, v.n, Math.round(v.ms)]), err: P.loafErr },
    bg: { clock: bg.clock, sched: bg.sched, ticks: bg.ticks, lateTicks: bg.lateTicks, maxGapMs: bg.maxGapMs, underruns: bg.underruns, lookaheadMs: bg.lookaheadMs, playedS: bg.playedSec, ...bg.perf } }; }, SECS);
/* profile: self time per node, attributed to the nearest site-file frame on its stack (else to its own file) */
const nodes = new Map(prof.nodes.map((n) => [n.id, n])); const parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const self = new Map(); for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0) / 1000);
const file = (u) => (u || '').replace(/^.*\/Strudel-craft\//, '').replace(/^https?:\/\/unpkg\.com\/(@[^/]+\/[^/]+|[^/]+).*$/, 'unpkg:$1').replace(/\?.*$/, '');
const cat = {}, leafCat = {}; let total = 0;
for (const [id, ms] of self) { const n = nodes.get(id); const fn = n.callFrame.functionName; if (fn === '(idle)') continue; total += ms;
  let k = id, site = null; while (k != null) { const f = nodes.get(k).callFrame; const u = file(f.url); if (u && !u.startsWith('unpkg:') && !/^(vendor|http)/.test(u)) { site = u + ':' + (f.functionName || '(anon)') + (process.argv.includes('--lines') ? '@' + (f.lineNumber + 1) : ''); break; } k = parent.get(k); }
  const key = site || (n.callFrame.url ? file(n.callFrame.url) + ' (no site caller)' : fn); cat[key] = (cat[key] || 0) + ms;
  const lk = (file(n.callFrame.url) || '') + ':' + (fn || '(anon)'); leafCat[lk] = (leafCat[lk] || 0) + ms; }
const incl = {}; if (process.argv.includes('--incl')) for (const [id, ms] of self) { const seen = new Set(); let k = id; while (k != null) { const f = nodes.get(k).callFrame; const u = file(f.url); if (u && !u.startsWith('unpkg:')) { const key = u + ':' + (f.functionName || '(anon)') + '@' + (f.lineNumber + 1); if (!seen.has(key)) { seen.add(key); incl[key] = (incl[key] || 0) + ms; } } k = parent.get(k); } }
const top = (o, k = 16) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, b]) => [a, Math.round(b)]);
const out = { prog: PROG, throttle: THR, hidden: HIDDEN ? vis : false, query: QUERY || null, seek: SEEK, playToStartMs: playMs, ...res, cpu: { busyMs: Math.round(total), profileS: +((prof.endTime - prof.startTime) / 1e6).toFixed(1), busyPct: +(total / ((prof.endTime - prof.startTime) / 1000) * 100).toFixed(1), byCaller: top(cat), bySelf: top(leafCat, 12), ...(process.argv.includes('--incl') ? { inclusive: top(incl, 40) } : {}) }, superdough: { droppedPast: cons.past, stillLoading: cons.loading }, pageErrors: cons.errors.length };
if (take) {
  const x = new Float32Array(Uint8Array.from(Buffer.from(take.b64, 'base64')).buffer); out.capture = { frames: take.frames, sr: take.sr, start: take.start, segments: take.segments.length };
  const REF = arg('--ref', null); if (REF) { const w = readWav(fs.readFileSync(REF)); const from = +arg('--ref-from', 0); const cps = +arg('--cps', 0.5); /* site Tempo knob default */ const a = Math.round((take.start - from) / cps * w.sr), b = a + Math.round(take.frames / take.sr * w.sr);
    out.capture.glitch = compare({ x: mono(w.L.subarray(a, b), w.R.subarray(a, b)), sr: w.sr }, { x, sr: take.sr }); }
  const D = arg('--save-take', null); if (D) fs.writeFileSync(D, Buffer.from(x.buffer));
}
const J = JSON.stringify(out); console.log(J); const jo = arg('--json', null); if (jo) fs.writeFileSync(jo, JSON.stringify(out, null, 1));
await browser.close(); server.close();
