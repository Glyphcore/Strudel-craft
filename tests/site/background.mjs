/* Background playback test (#56 "Background playback"). Serves site/ and, in Playwright Chromium, plays a known pattern
   (note("c4*8"), 8 haps per cycle at cps 0.5 = one hap every 0.25 s) and captures every hap the scheduler hands to the output
   (strudelCraft.bg.trace: [cycle, target audio time]). Emulation, since headless Chromium never hides a tab on its own:
   - hidden: document.hidden / visibilityState report hidden and visibilitychange fires (init script);
   - Chrome's hidden-tab timer throttling: main-thread setInterval / setTimeout run at most once per second while hidden
     (init script; dedicated workers are exempt, as in Chrome);
   - CPU starvation: CDP Emulation.setCPUThrottlingRate 4;
   - freeze: CDP Page.setWebLifecycleState frozen -> active;
   - OS suspension: AudioContext.suspend() -> resume().
   Asserts: no missed haps (every 1/8 cycle present once, no holes), spacing of scheduled times equal to the pattern (no catch-up
   burst: no two haps closer than 0.24 s), lookahead >= 1 s while hidden and back to 0.2 s in the foreground, a frozen page and a
   suspended context resume at the same cycle with a paused segment and a "Resumed at cycle" toast, the "pause when hidden"
   policy, and the play-time clamp counting played time only.
   Usage (repo root): node tests/site/background.mjs [--baseline]   (--baseline: Strudel's own clock, ?bgclock=off, measured not asserted) */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const BASELINE = process.argv.includes('--baseline');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/${BASELINE ? '?bgclock=off' : ''}`;
const checks = []; const errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const info = (name, detail) => console.log(`INFO  ${name}  -- ${detail}`);
const CODE = 'setcpm(120/4)\n$: note("c4*8").s("sine").gain(.05)';
const STEP = 1 / 8, CPS = 0.5;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
await ctx.addInitScript(() => {
  window.__hidden = false; window.__throttle = false;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  const si = window.setInterval.bind(window), st = window.setTimeout.bind(window);
  window.setInterval = (fn, ms, ...a) => { let last = 0; return si(() => { if (window.__throttle) { const n = performance.now(); if (n - last < 1000) return; last = n; } typeof fn === 'function' ? fn(...a) : 0; }, ms); };
  window.setTimeout = (fn, ms, ...a) => st(fn, window.__throttle ? Math.max(ms || 0, 1000) : ms, ...a);
  window.__setHidden = (h) => { window.__hidden = h; window.__throttle = h; document.dispatchEvent(new Event('visibilitychange')); };
  /* spans the scheduler queried (both clocks call pattern.queryArc with controls.cyclist), plus Strudel's own skip log */
  window.__spans = []; window.__skips = 0; const cl = console.log.bind(console); console.log = (...a) => { if (/skip query: too late/.test(String(a[0]))) window.__skips++; cl(...a); };
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(1000);
const ed = page.locator('.view[data-for=rack] .cm-content:visible').first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(CODE); await page.waitForTimeout(600);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.evaluate(() => window.__sc.play());
await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 });
await page.waitForTimeout(1200);
/* span recorder on the playing pattern; hap trace from the background clock */
await page.evaluate(() => { const S = window.__sc.Engine.scheduler, p = S.pattern, q = p.queryArc.bind(p); p.queryArc = (a, b, o) => { if (o && o.cyclist) window.__spans.push([+a, +b]); return q(a, b, o); }; if (window.strudelCraft.bg) window.strudelCraft.bg.trace = true; });
const t0wall = Date.now();
const S = (fn) => page.evaluate(fn);
const audioNow = () => S(() => window.getAudioContext().currentTime);
const cycle = () => S(() => +window.__sc.Engine.scheduler.lastEnd);
const holes = (spans) => { const out = []; for (let i = 1; i < spans.length; i++) { const d = spans[i][0] - spans[i - 1][1]; if (Math.abs(d) > 1e-6 && spans[i][0] > spans[i - 1][1]) out.push(+d.toFixed(3)); } return out; };

/* 1. hidden + main-thread timer throttling + CPU x4 for 8 s */
await S(() => window.__setHidden(true)); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.waitForTimeout(3000);
const hiddenStats = await S(() => window.strudelCraft.bg && window.strudelCraft.bg.stats());
await page.waitForTimeout(5000);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await S(() => window.__setHidden(false));
await page.waitForTimeout(1500);
let spans = await S(() => window.__spans.slice()); const skips1 = await S(() => window.__skips);
const h1 = holes(spans);
if (BASELINE) info('baseline (Strudel clock): hidden + throttled timers + CPU x4, 8 s', `${skips1} "skip query: too late", ${h1.length} holes in the queried cycles, ${(h1.reduce((a, b) => a + b, 0) / STEP).toFixed(0)} haps dropped`);
else {
  check('hidden + throttled timers + CPU x4: no holes in the queried cycles, no "skip query"', h1.length === 0 && skips1 === 0, `holes ${JSON.stringify(h1.slice(0, 5))}, skips ${skips1}, spans ${spans.length}`);
  check('lookahead >= 1 s while hidden, worker clock', hiddenStats && hiddenStats.lookaheadMs >= 1000 && hiddenStats.clock === 'worker', JSON.stringify(hiddenStats));
  await page.waitForTimeout(6000);
  const fg = await S(() => window.strudelCraft.bg.stats());
  check('lookahead back to 0.2 s in the foreground (live edits stay quick)', fg.lookaheadMs <= 250, `${fg.lookaheadMs} ms`);
}

/* 2. freeze 3 s. CDP Page.setWebLifecycleState frozen is tried first, but headless Chromium does not freeze a page that plays audio (no
   freeze event, timers keep running), so the frozen page is modelled exactly: the freeze event, a main thread that runs nothing for
   3 s while the audio clock and the worker keep going, then the resume event. */
await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await new Promise((r) => setTimeout(r, 500)); await cdp.send('Page.setWebLifecycleState', { state: 'active' });
const cdpFroze = await S(() => window.strudelCraft.bg ? window.strudelCraft.bg.events().some((e) => e.type === 'freeze') : false);
info('CDP Page.setWebLifecycleState frozen on an audible page', cdpFroze ? 'froze the page' : 'no effect in headless Chromium (no freeze event); modelled below');
const cBefore = await cycle(); const aBefore = await audioNow();
await S(() => { document.dispatchEvent(new Event('freeze')); const t = performance.now(); while (performance.now() - t < 3000) { /* frozen main thread */ } document.dispatchEvent(new Event('resume')); });
await page.waitForTimeout(1500);
const aAfter = await audioNow();
spans = await S(() => window.__spans.slice()); const h2 = holes(spans);
const jump = (() => { const i = spans.findIndex((s) => s[0] >= cBefore - 1e-6); const later = spans.slice(Math.max(0, i)); const hole = holes(later); return +hole.reduce((a, b) => a + b, 0).toFixed(3); })();
if (BASELINE) info('baseline (Strudel clock): frozen 3 s (modelled)', `audio clock moved ${(aAfter - aBefore).toFixed(2)} s; queried cycles jumped ${jump} cycles (${(jump / STEP).toFixed(0)} haps dropped, fast-forward)`);
else {
  check('frozen 3 s then resumed: same cycle, no fast-forward (no holes)', h2.length === 0, `holes ${JSON.stringify(h2.slice(0, 5))}, cycle before ${cBefore.toFixed(2)}, audio moved ${(aAfter - aBefore).toFixed(2)} s`);
  const seg = await S(() => window.strudelCraft.bg.segments().filter((s) => s.kind === 'paused').map((s) => s.ms));
  check('freeze recorded as a paused segment (>= 2.5 s)', seg.some((ms) => ms >= 2500), JSON.stringify(seg));
  const toast = await S(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => /Resumed at cycle/.test(t)) || '');
  check('"Resumed at cycle N, paused m:ss" toast', /Resumed at cycle \d+, paused 0:0[2-4]/.test(toast), toast);
}

/* 2b. a 2.5 s stall with no lifecycle events (a busy or starved main thread): the clock re-anchors the same cycle and records the pause */
if (!BASELINE) {
  await S(() => { const t = performance.now(); while (performance.now() - t < 2500) { /* stall */ } });
  await page.waitForTimeout(1200);
  spans = await S(() => window.__spans.slice());
  const st2 = await S(() => window.strudelCraft.bg.stats()); const segs2 = await S(() => window.strudelCraft.bg.segments().filter((x) => x.kind === 'paused').map((x) => x.ms));
  /* the lookahead raised by the freeze (bounded at 2 s) still covers most of this stall: only the uncovered part is a pause */
  check('2.5 s main-thread stall: the raised lookahead covers up to 2 s of it, the rest re-anchors at the same cycle (no holes) as an underrun and a short paused segment', holes(spans).length === 0 && st2.underruns >= 2 && segs2.length >= 2 && segs2[segs2.length - 1] >= 300 && segs2[segs2.length - 1] <= 2600, `underruns ${st2.underruns}, paused ms ${JSON.stringify(segs2)}`);
} else {
  const sk0 = await S(() => window.__skips); await S(() => { const t = performance.now(); while (performance.now() - t < 2500) { /* stall */ } }); await page.waitForTimeout(1200);
  const sp = await S(() => window.__spans.slice()); info('baseline (Strudel clock): 2.5 s main-thread stall', `${(await S(() => window.__skips)) - sk0} "skip query", ${holes(sp).length} holes total, cycles fast-forwarded`);
}

/* 3. OS suspends audio 2 s */
const cS0 = await S(() => window.__sc.Engine.scheduler.now());
await S(() => window.getAudioContext().suspend()); await page.waitForTimeout(2000);
const cS1 = await S(() => window.__sc.Engine.scheduler.now());
await S(() => window.getAudioContext().resume()); await page.waitForTimeout(1500);
spans = await S(() => window.__spans.slice());
if (!BASELINE) {
  check('suspended context: cycle position frozen while suspended', Math.abs(cS1 - cS0) < 0.06, `now() ${cS0.toFixed(3)} -> ${cS1.toFixed(3)}`);
  check('suspended then resumed: no holes', holes(spans).length === 0, JSON.stringify(holes(spans).slice(0, 5)));
  const segs = await S(() => window.strudelCraft.bg.segments().map((s) => s.kind + ':' + s.ms));
  check('suspension recorded as a paused segment (>= 1.5 s)', segs.some((x) => /^paused:(\d+)/.test(x) && +x.split(':')[1] >= 1500 && +x.split(':')[1] < 2600), segs.join(' '));
}

/* 4. hap trace: every 1/8 cycle once, spacing equal to the pattern within each anchored run, never a burst */
if (!BASELINE) {
  const tr = await S(() => window.strudelCraft.bg.trace.slice());
  const cyc = tr.map((x) => Math.round(x[0] / STEP)); const set = new Set(cyc);
  const lo = Math.min(...cyc), hi = Math.max(...cyc); const missing = []; for (let k = lo; k <= hi; k++) if (!set.has(k)) missing.push(k * STEP);
  check('no missed haps: every 1/8 cycle scheduled exactly once', missing.length === 0 && set.size === cyc.length, `${cyc.length} haps over cycles ${(lo * STEP).toFixed(2)}..${(hi * STEP).toFixed(2)}, missing ${missing.length} ${JSON.stringify(missing.slice(0, 6))}, duplicates ${cyc.length - set.size}`);
  const gaps = []; for (let i = 1; i < tr.length; i++) gaps.push(tr[i][1] - tr[i - 1][1]);
  const exact = gaps.filter((g) => Math.abs(g - STEP / CPS) < 0.002).length;
  check('scheduled times follow the pattern: no two haps closer than 0.24 s (no catch-up burst)', Math.min(...gaps) >= 0.24, `min ${Math.min(...gaps).toFixed(4)} s, ${exact}/${gaps.length} spacings exactly ${STEP / CPS} s, longest ${Math.max(...gaps).toFixed(2)} s (the pauses)`);
}

/* 5. policy: pause when hidden */
if (!BASELINE) {
  await S(() => window.strudelCraft.bg.setPolicy('pause'));
  await S(() => window.__setHidden(true)); await page.waitForTimeout(1500);
  const hs = await S(() => window.getAudioContext().state);
  await S(() => window.__setHidden(false)); await page.waitForTimeout(1500);
  const vs = await S(() => window.getAudioContext().state);
  spans = await S(() => window.__spans.slice());
  check('policy "pause when hidden": suspended while hidden, running again on return, no holes', hs === 'suspended' && vs === 'running' && holes(spans).length === 0, `${hs} -> ${vs}`);
  await S(() => window.strudelCraft.bg.setPolicy('continue'));
}

/* 6. clamp counts played time only */
if (!BASELINE) {
  await page.waitForTimeout(400);
  const r = await S(() => ({ elapsed: window.strudelCraft.range.state.elapsed, played: window.strudelCraft.bg.played, paused: window.strudelCraft.bg.paused, left: document.querySelector('#trLeft').textContent }));
  const wall = (Date.now() - t0wall) / 1000 + 1.2;
  check('play-time clamp counts played time only (frozen and suspended time excluded), readout shows played and paused', Math.abs(r.elapsed - r.played) < 0.6 && r.paused >= 6 && Math.abs(r.elapsed + r.paused - wall) < 2 && /played \d+:\d\d · paused \d+:\d\d/.test(r.left), `clamp ${r.elapsed.toFixed(1)} s, played ${r.played.toFixed(1)} s, paused ${r.paused.toFixed(1)} s, wall ${wall.toFixed(1)} s, "${r.left}"`);
  const st = await S(() => window.strudelCraft.bg.stats());
  info('diagnostics after the run', JSON.stringify(st));
  info('lifecycle events', JSON.stringify(await S(() => window.strudelCraft.bg.events().map((e) => e.type))));
}
if (!BASELINE) {
  /* drawing stops while hidden; Media Session; diagnostics sheet; settings in the ? dialog */
  const d0 = await S(() => ({ cost: window.__viz.cost.length, skips: window.__sc && 0 }));
  await S(() => window.__setHidden(true)); await page.waitForTimeout(1500); const d1 = await S(() => window.__viz.cost.length); await S(() => window.__setHidden(false)); await page.waitForTimeout(600);
  const d2 = await S(() => window.__viz.cost.length);
  check('no visual drawing while hidden, drawing again when visible', d1 - d0.cost <= 1 && d2 > d1, `frames drawn hidden ${d1 - d0.cost}, after return ${d2 - d1}`);
  const ms = await S(() => ({ title: navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title, state: navigator.mediaSession && navigator.mediaSession.playbackState }));
  check('Media Session: metadata and playing state while playing', !!ms.title && ms.state === 'playing', JSON.stringify(ms));
  await page.click('#audioSt'); await page.waitForSelector('#bgDiag[open]', { timeout: 5000 }).catch(() => {});
  const dg = await S(() => { const d = document.querySelector('#bgDiag'); return d && d.open ? d.textContent : ''; });
  check('audio dot opens the diagnostics sheet (late ticks, max gap, lookahead, underruns, segments, policy)', ['Lookahead in use', 'Max tick gap', 'Underruns', 'Segments', 'When the app is hidden'].every((k) => dg.includes(k)), dg.slice(0, 160).replace(/\s+/g, ' '));
  await page.keyboard.press('Escape');
  const hs = await S(() => !!document.querySelector('#help .bg-set #bgPolicy') && !!document.querySelector('#help #bgWake'));
  check('background settings (policy, keep screen on) in the ? dialog', hs);
  await S(() => window.__sc.stop()); await page.waitForTimeout(300);
  const ms2 = await S(() => navigator.mediaSession.playbackState);
  check('Stop: Media Session paused, segment closed', ms2 === 'paused' && (await S(() => window.strudelCraft.bg.stats().segment)) === null, ms2);
}
check('no page errors or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close(); server.close();
const fails = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
