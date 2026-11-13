// Playwright smoke test for the static site (issue #10).
// Usage: node tests/site/smoke.mjs [--quick]   (uses the pre-installed Playwright Chromium)
// Serves site/ on a local port, drives the UI, plays every catalog recipe, measures frame time,
// writes screenshots + docs/screens/metrics.json, and exits non-zero on any console error or failed check.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'docs/screens');
const QUICK = process.argv.includes('--quick');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const errors = []; const checks = []; const metrics = { date: new Date().toISOString(), chromium: null, recipes: [], frame: {} };
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
{ /* user rule: no native alert/prompt/confirm anywhere in site/ */
  const fsm = await import('node:fs'); const pm = await import('node:path'); const hits = [];
  const walk = (dir) => { for (const f of fsm.readdirSync(dir, { withFileTypes: true })) { const fp = pm.join(dir, f.name); if (f.isDirectory()) { if (f.name !== 'data' && f.name !== 'fonts') walk(fp); } else if (/\.(m?js|html)$/.test(f.name)) fsm.readFileSync(fp, 'utf8').split('\n').forEach((l, i) => { if (/(^|[^\w.$])(alert|prompt|confirm)\s*\(|window\.(alert|prompt|confirm)\b/.test(l)) hits.push(pm.relative(dir, fp) + ':' + (i + 1)); }); } };
  walk(new URL('../../site', import.meta.url).pathname);
  check('no native alert/prompt/confirm in site/', hits.length === 0, hits.join(', '));
}
const watch = (page, tag) => {
  /* the live tracker polls api.github.com; stub it so rate limits never fail the smoke run */
  page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', etag: '"smoke"' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', html_url: 'https://github.com/Glyphcore/Strudel-craft/issues/56', body: '## Site\n- [x] done item\n- [ ] (~) wip item\n- [ ] open item' }) : '[]' }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
};
const stats = (arr) => { const a = [...arr].sort((x, y) => x - y); const mean = a.reduce((s, x) => s + x, 0) / (a.length || 1); return { n: a.length, mean_ms: +mean.toFixed(2), p95_ms: +(a[Math.floor(a.length * 0.95)] || 0).toFixed(2), max_ms: +(a[a.length - 1] || 0).toFixed(2) }; };
// rAF interval (frame time) plus the visualiser's own per-frame draw cost (window.__viz.cost).
async function measureFrames(page, ms) {
  const r = await page.evaluate((ms) => new Promise((res) => { const c0 = window.__viz.cost.length; const d = []; let last = 0; const t0 = performance.now(); const f = (t) => { if (last) d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res({ d, cost: window.__viz.cost.slice(c0) }); }; requestAnimationFrame(f); }), ms);
  const out = r.d; out.draw = stats(r.cost); return out;
}
const waitPlaying = (page, timeout = 60000) => page.waitForFunction(() => { const s = window.__sc.S; return (!s.busy && s.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'); }, null, { timeout });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
metrics.chromium = browser.version();

/* ---------- desktop 1440 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, '1440');
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  await page.evaluate(() => document.fonts.ready);
  const n = await page.locator('#list li[data-id]').count();
  const total = await page.evaluate(async () => (await (await fetch('data/catalog.json')).json()).recipes.length);
  check('catalog renders every recipe in the browser', n === total && total > 0, `${n}/${total}`);
  await page.screenshot({ path: path.join(OUT, 'desktop-1440-idle.png') });

  // keyboard: views 1-4
  for (const [k, v] of [['2', 'stack'], ['3', 'ref'], ['4', 'practice'], ['1', 'rack']]) { await page.keyboard.press(k); const got = await page.getAttribute('#main', 'data-view'); check(`key ${k} -> ${v} view`, got === v, got); }
  await page.keyboard.press('3'); await page.waitForSelector('#refDoc table'); check('reference view renders tables', await page.locator('#refDoc table').count() > 0);
  await page.keyboard.press('4'); await page.waitForSelector('#pracDoc section'); check('practice view renders sections', await page.locator('#pracDoc section').count() > 3);
  await page.keyboard.press('1');
  // cheat sheet
  await page.keyboard.press('Shift+Slash'); check('? opens cheat sheet', await page.evaluate(() => document.querySelector('#help').open));
  check('cheat sheet lists >= 12 shortcuts', (await page.locator('#keys dt').count()) >= 12);
  await page.keyboard.press('Escape'); check('Esc closes cheat sheet', !(await page.evaluate(() => document.querySelector('#help').open)));
  // arrows move selection
  const sel0 = await page.evaluate(() => window.__sc.S.sel); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const sel1 = await page.evaluate(() => window.__sc.S.sel); check('ArrowDown moves selection', sel1 === sel0 + 2, `${sel0} -> ${sel1}`);
  await page.keyboard.press('ArrowUp'); check('ArrowUp moves selection', (await page.evaluate(() => window.__sc.S.sel)) === sel0 + 1);
  // search focus + Esc
  await page.keyboard.press('/'); check('/ focuses search', await page.evaluate(() => document.activeElement.id === 'q'));
  await page.keyboard.type('pad'); const nf = await page.locator('#list li[data-id]').count(); check('search filters list', nf > 0 && nf < n, `${nf} match "pad"`);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); check('Esc clears search', (await page.locator('#list li[data-id]').count()) === n);
  // tempo / master knobs via keys + undo
  const t0 = await page.evaluate(() => window.__sc.S.tempo); await page.keyboard.press(']'); await page.keyboard.press(']');
  check('] raises tempo', (await page.evaluate(() => window.__sc.S.tempo)) === t0 + 2);
  await page.keyboard.press('Control+z'); check('Ctrl+Z undoes tempo change', (await page.evaluate(() => window.__sc.S.tempo)) === t0 + 1);
  await page.keyboard.press('Control+z');
  const m0 = await page.evaluate(() => window.__sc.S.master); await page.keyboard.press('-'); check('- lowers master', (await page.evaluate(() => window.__sc.S.master)) === m0 - 1); await page.keyboard.press('=');
  // knob drag + aria
  const kb = await page.locator('.tp-knobs .knob').first().boundingBox();
  await page.mouse.move(kb.x + 20, kb.y + 25); await page.mouse.down(); await page.mouse.move(kb.x + 20, kb.y - 15, { steps: 5 }); await page.mouse.up();
  const t2 = await page.evaluate(() => window.__sc.S.tempo); check('dragging tempo knob up raises tempo', t2 > t0, `${t0} -> ${t2}`);
  check('knob exposes role=slider with valuetext', (await page.getAttribute('.tp-knobs .knob', 'aria-valuetext')).endsWith('BPM'));
  await page.keyboard.press('Control+z');

  // Space plays / stops
  await page.click('#list li[data-id="reese-style-detuned-bass"] .row'); await page.locator('#list').focus().catch(() => {});
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space'); await waitPlaying(page);
  check('Space starts playback', await page.evaluate(() => window.__sc.S.playing && window.__sc.Engine.started), await page.textContent('#status'));
  await page.waitForTimeout(1500);
  const lanes = await page.evaluate(() => window.__sc.Engine.scheduler.pattern.queryArc(0, 1).length);
  check('pattern lanes have haps to draw', lanes > 0, `${lanes} haps in cycle 0`);
  const peak = await page.textContent('#peakOut'); check('master meter shows signal', /^-?\d/.test(peak), peak);
  // frame time during playback (desktop, no throttling)
  const fd = await measureFrames(page, 6000); metrics.frame.desktop_1440 = { ...stats(fd), viz_draw: fd.draw };
  check('frame time during playback measured (1440)', fd.length > 100, JSON.stringify(metrics.frame.desktop_1440));
  await page.screenshot({ path: path.join(OUT, 'desktop-1440-playing.png') });
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  check('Space stops playback', !(await page.evaluate(() => window.__sc.S.playing)));

  // stack: A adds, view 2 plays the stack, undo removes
  await page.evaluate(() => { const s = window.__sc.S; s.stack = []; });
  for (const id of ['synth-kick', 'syncopated-bass', 'supersaw-pad']) { await page.click(`#list li[data-id="${id}"] .row`); await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('a'); }
  check('A adds selected recipes to the stack', (await page.evaluate(() => window.__sc.S.stack.length)) === 3);
  await page.keyboard.press('2'); await page.keyboard.press('Space'); await waitPlaying(page);
  check('stack view plays the stacked program', await page.evaluate(() => window.__sc.S.playingSource === 'stack' && window.__sc.Engine.started), await page.textContent('#status'));
  await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, 'desktop-1440-stack.png') });
  await page.keyboard.press('Control+z'); check('Ctrl+Z undoes stack add', (await page.evaluate(() => window.__sc.S.stack.length)) === 2);
  await page.keyboard.press('Space'); await page.keyboard.press('1');

  // every recipe playable from the UI
  const ids = await page.$$eval('#list li[data-id]', (ls) => ls.map((l) => l.dataset.id));
  for (const id of QUICK ? ids.slice(0, 4) : ids) {
    await page.click(`#list li[data-id="${id}"] .row`);
    await page.evaluate(() => document.activeElement.blur());
    if (!(await page.evaluate(() => window.__sc.S.playing))) await page.keyboard.press('Space');
    else await page.keyboard.press('Enter');
    await page.waitForFunction((id) => { const s = window.__sc.S; return (!s.busy && s.playing && s.playingId === id) || document.querySelector('#status').classList.contains('err'); }, id, { timeout: 90000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate((id) => { const sc = window.__sc; const st = sc.Engine.state; let haps = 0; try { const c = Math.floor(sc.Engine.scheduler.now()); haps = sc.Engine.scheduler.pattern.queryArc(c, c + 4).length; } catch (e) { haps = -1; } return { id, playing: sc.S.playing && sc.S.playingId === id, started: sc.Engine.started, evalError: st.evalError ? String(st.evalError.message || st.evalError) : null, schedulerError: st.schedulerError ? String(st.schedulerError.message || st.schedulerError) : null, status: document.querySelector('#status').textContent, peak: document.querySelector('#peakOut').textContent, haps_next4cycles: haps }; }, id);
    r.ok = r.playing && r.started && !r.evalError && !r.schedulerError && r.haps_next4cycles > 0;
    metrics.recipes.push(r); console.log(`  ${r.ok ? 'ok ' : 'BAD'} ${id.padEnd(40)} peak ${r.peak.padEnd(9)} haps ${r.haps_next4cycles}${r.evalError ? ' eval: ' + r.evalError : ''}`);
  }
  const bad = metrics.recipes.filter((r) => !r.ok);
  check(`every catalog recipe plays from the UI (${metrics.recipes.length})`, !bad.length && metrics.recipes.length === (QUICK ? 4 : total), bad.map((r) => r.id).join(', '));
  metrics.recipes_audible = metrics.recipes.filter((r) => r.peak !== '-inf dB').length;
  await page.keyboard.press('Space');
  await ctx.close();
}

/* ---------- phone 390 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); watch(page, '390');
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.evaluate(() => document.fonts.ready);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); check('no horizontal scroll at 390px', sw <= 390, `scrollWidth ${sw}`);
  const small = await page.$$eval('button, a.btn, .views a, [role=slider]', (els) => els.filter((e) => e.offsetParent && !e.classList.contains('chip')).map((e) => e.getBoundingClientRect()).filter((r) => r.width && (r.width < 44 || r.height < 44)).length);
  check('touch targets >= 44px (except filter chips)', small === 0, `${small} smaller`);
  await page.screenshot({ path: path.join(OUT, 'phone-390-idle.png') });
  await page.tap('#list li[data-id="minor-arp"] .row'); await page.tap('#playBtn'); await waitPlaying(page);
  check('tap Play works on phone', await page.evaluate(() => window.__sc.Engine.started));
  await page.waitForTimeout(1500);
  const fd = await measureFrames(page, 6000); metrics.frame.phone_390 = { ...stats(fd), viz_draw: fd.draw };
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const ft = await measureFrames(page, 6000); metrics.frame.phone_390_cpu4x = { ...stats(ft), viz_draw: ft.draw }; await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check('frame time during playback measured (390, and 4x CPU throttle)', fd.length > 100 && ft.length > 20, JSON.stringify({ normal: metrics.frame.phone_390, cpu4x: metrics.frame.phone_390_cpu4x }));
  await page.screenshot({ path: path.join(OUT, 'phone-390-playing.png') });
  await page.screenshot({ path: path.join(OUT, 'phone-390-playing-full.png'), fullPage: true });
  await page.tap('#playBtn');
  await ctx.close();
}

/* ---------- light theme, reduced motion, redirects ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(); watch(page, 'reduced');
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  const td = await page.$eval('#playBtn', (b) => getComputedStyle(b).transitionDuration);
  check('reduced motion: transitions are 0s', td.split(',').every((x) => parseFloat(x) === 0), td);
  await page.keyboard.press('t'); check('T toggles light theme', (await page.getAttribute('html', 'data-theme')) === 'light');
  await page.click('#list li[data-id="pad-swell"] .row'); await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('Space'); await waitPlaying(page);
  await page.waitForTimeout(800);
  const vf = await page.evaluate(() => new Promise((r) => { const n0 = window.__viz.frames.length; setTimeout(() => r({ frames: window.__viz.frames.slice(n0) }), 3000); }));
  metrics.frame.reduced_motion_viz = stats(vf.frames);
  check('reduced motion: visualiser throttled to <= 10 fps', vf.frames.length > 5 && metrics.frame.reduced_motion_viz.mean_ms >= 90, JSON.stringify(metrics.frame.reduced_motion_viz));
  await page.screenshot({ path: path.join(OUT, 'desktop-1440-light-playing.png') });
  await page.keyboard.press('Space'); await page.keyboard.press('t');
  // offline after first load: service worker serves the shell
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise((r) => setTimeout(r, 500))));
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('#list li[data-id]', { timeout: 10000 }).catch(() => {});
  check('works offline after first load (service worker)', (await page.locator('#list li[data-id]').count()) > 0);
  await ctx.setOffline(false);
  for (const [f, v] of [['compose.html', 'stack'], ['plugins.html', 'ref'], ['practices.html', 'practice']]) {
    await page.goto(BASE + f); await page.waitForFunction((v) => document.querySelector('#main') && document.querySelector('#main').dataset.view === v, v, { timeout: 10000 }).catch(() => {});
    check(`${f} redirects into the app (${v})`, (await page.evaluate(() => document.querySelector('#main') && document.querySelector('#main').dataset.view)) === v, page.url());
  }
  await page.goto(BASE + '#r/fm-bell'); await page.waitForSelector('#list li[aria-current="true"]');
  check('deep link #r/<id> selects that recipe', (await page.getAttribute('#list li[aria-current="true"]', 'data-id')) === 'fm-bell');
  await ctx.close();
}

await browser.close(); server.close();
check('zero console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
metrics.console_errors = errors; metrics.checks = checks;
fs.writeFileSync(path.join(OUT, QUICK ? 'metrics-quick.json' : 'metrics.json'), JSON.stringify(metrics, null, 1));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; ${errors.length} console errors; frame ${JSON.stringify(metrics.frame)}`);
process.exit(failed.length ? 1 : 0);
