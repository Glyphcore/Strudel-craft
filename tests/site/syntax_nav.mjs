// Syntax view navigation (#149, follow-up of #120/#144): measures open-view time and scroll frame time on CPU x4, and (without --measure-only) checks the
// 390px touch flow: expand a family, search 'foreshadow', pin, deep link, reload persistence, old anchors, perf bound, clean console.
// Usage: node tests/site/syntax_nav.mjs [--measure-only] [--site DIR]   (NODE_PATH must reach playwright)
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const SITE = path.resolve(arg('--site') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../site')); const MEASURE_ONLY = process.argv.includes('--measure-only');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`; let fail = 0;
const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const newPage = async (w = 390, h = 844) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600, isMobile: w < 600 }); const page = await ctx.newPage(); const errs = [];
  page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); }); return { ctx, page, errs }; };
const boot = async (page, hash = '') => { await page.goto(BASE + hash); await page.waitForFunction(() => !!window.__sc && document.querySelector('#list li .row'), null, { timeout: 30000 }); };
const throttle = async (page, rate) => { const c = await page.context().newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate }); return c; };

/* ---- measurement: cold open of the Syntax view and a steady scroll, CPU x4 ---- */
async function measure(w) {
  const { ctx, page, errs } = await newPage(w, w < 600 ? 844 : 900); await boot(page); await page.waitForTimeout(2500); const c = await throttle(page, 4);
  const open = await page.evaluate(async () => { const t0 = performance.now(); document.querySelector('.views a[data-view="syntax"]').click();
    while (!(document.querySelectorAll('#syntax .sx-sec').length >= 100 && (document.querySelector('#syntax .sx-ex, #syntax .sx-grp')))) await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; });
  await page.waitForTimeout(1500);
  const scroll = await page.evaluate(async () => { const H = document.documentElement.scrollHeight - innerHeight, fr = []; let last = performance.now(), y = 0; const step = 120; /* fixed px per frame on every tree, so before/after are comparable */
    await new Promise((done) => { const f = (t) => { fr.push(t - last); last = t; y += step; scrollTo(0, y); if (y < H && y < 12000 && fr.length < 300) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
    fr.shift(); fr.sort((a, b) => a - b); return { frames: fr.length, slow: fr.filter((x) => x > 50).length, p50: fr[fr.length >> 1], p95: fr[Math.floor(fr.length * 0.95)], max: fr[fr.length - 1], pageH: H + innerHeight, nodes: document.querySelectorAll('#syntax *').length }; });
  await c.detach(); await ctx.close(); return { w, open: Math.round(open), ...Object.fromEntries(Object.entries(scroll).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v])), errs };
}
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const M = []; for (const w of [390, 1440]) { const runs = []; for (let i = 0; i < 3; i++) runs.push(await measure(w)); const m = { ...runs[0], open: med(runs.map((r) => r.open)), p95: med(runs.map((r) => r.p95)), p50: med(runs.map((r) => r.p50)), slow: med(runs.map((r) => r.slow)), max: med(runs.map((r) => r.max)), errs: runs.flatMap((r) => r.errs), runs: runs.map((r) => r.open + '/' + r.p95).join(' ') }; M.push(m); console.log('MEASURE ' + JSON.stringify(m)); }
if (MEASURE_ONLY) { await browser.close(); server.close(); process.exit(0); }
const m390 = M[0]; check('perf bound: cold open of the Syntax view at 390px, CPU x4, under 2500 ms (measured 2026-11-17, 3 runs: 810-1281 ms; the tree before #149 was 984-1224 ms, so this is a regression bound, not a speed-up claim)', m390.open < 2500, m390.open + ' ms');
check('perf bound: scroll at 390px, CPU x4: fewer than 20 frames over 50 ms and p95 under 120 ms (measured, fixed 120 px/frame over the first 12000 px: 5 slow, p95 66 ms; before #149 0 slow, p95 17 ms; the idle app alone shows p95 up to 70)', m390.slow < 20 && m390.p95 < 120, m390.slow + ' slow, p95 ' + m390.p95 + ' ms');
check('perf bound: Syntax DOM under 6000 nodes while collapsed (measured 2013; 6446 before #149)', m390.nodes < 6000, String(m390.nodes));

/* ---- the 390px touch flow ---- */
const { ctx, page, errs } = await newPage(390, 844); await boot(page);
const edScroll = () => page.evaluate(() => { const v = document.getElementById('code'); const cm = v && v.cmView; return (cm ? cm.scrollDOM.scrollTop : 0) + ',' + scrollY; });
await page.tap('.views a[data-view="syntax"]'); await page.waitForSelector('#syntax .sx-grp'); await page.waitForTimeout(600);
const total = await page.locator('#syntax .sx-sec').count(); check('all sections are present as stubs (>= 132)', total >= 132, String(total));
check('families collapsed by default', await page.locator('#syntax .sx-ghead[aria-expanded="true"]').count() === 0);
check('lazy: no example bodies rendered while collapsed', await page.locator('#syntax .sx-ex').count() === 0);
const small = await page.evaluate(() => [...document.querySelectorAll('#syntax .sx-ghead, #syntax .sx-pin, #syntax .sx-search, #syntax .sx-jump a, #syntax .sx-head')].filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5)).map((e) => e.className));
check('touch targets are at least 44px', small.length === 0, small.slice(0, 3).join());
await page.locator('#syntax .sx-ghead[data-g="composition/foreshadow"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const ed0 = await edScroll();
await page.locator('#syntax .sx-ghead[data-g="composition/foreshadow"]').tap(); await page.waitForTimeout(200);
check('tap expands a family (aria-expanded, rows visible)', await page.locator('#syntax .sx-ghead[data-g="composition/foreshadow"]').getAttribute('aria-expanded') === 'true' && await page.locator('#syntax .sx-grp[data-g="composition/foreshadow"] .sx-sec:visible').count() > 0);
check('pressing does not scroll the editor or jump the page (#107)', (await edScroll()) === ed0, ed0 + ' -> ' + await edScroll());
await page.fill('#syntax .sx-search', 'foreshadow'); await page.waitForTimeout(400);
const vis = await page.evaluate(() => [...document.querySelectorAll('#syntax .sx-sec')].filter((e) => !e.hidden && e.offsetParent).map((e) => e.id));
check("search 'foreshadow' narrows to the foreshadow concepts", vis.length > 0 && vis.length < 30 && await page.locator('#syntax .sx-count').innerText().then((t) => /\d+ \/ \d+/.test(t)), vis.length + ' visible');
const sticky = await page.evaluate(() => { scrollTo(0, 600); const b = document.querySelector('#syntax .sx-bar').getBoundingClientRect(); return b.top < 120 && b.bottom > 0; }); check('search bar stays sticky while scrolling', sticky);
const first = vis[0]; await page.locator('#' + first + ' .sx-head').tap(); await page.waitForTimeout(500);
check('opening a section renders its body lazily and sets #syntax=<id>', await page.locator('#' + first + ' .sx-fm, #' + first + ' .sx-ex').count() > 0 && location_hash(await page.url()) === 'syntax=' + first.replace(/^sx-/, ''), await page.url());
function location_hash(u) { return decodeURIComponent(new URL(u).hash.slice(1)); }
const id1 = first.replace(/^sx-/, '');
check('recent lists the opened section', await page.locator('#syntax .sx-recent [data-go="' + id1 + '"]').count() === 1);
await page.locator('#' + first + ' .sx-pin').tap(); await page.waitForTimeout(200);
check('pin marks the section and lists it in Pinned', await page.locator('#' + first + ' .sx-pin').getAttribute('aria-pressed') === 'true' && await page.locator('#syntax .sx-pinned [data-go="' + first.replace(/^sx-/, '') + '"]').count() === 1);
await page.close(); await ctx.close();
/* deep link in a fresh context (cold), then reload persistence in the same context */
{ const n = await newPage(390, 844); await boot(n.page, '#syntax=' + id1); await n.page.waitForSelector('#sx-' + id1 + ' .sx-body:not([hidden])', { timeout: 15000 }); await n.page.waitForTimeout(500);
  const r = await n.page.evaluate((id) => { const e = document.getElementById('sx-' + id).getBoundingClientRect(); return { top: e.top, view: document.querySelector('.view-syntax').offsetParent !== null }; }, id1);
  check('deep link #syntax=<id> opens the view, expands the family and the section, and scrolls to it', r.view && r.top > -5 && r.top < 400, JSON.stringify(r));
  await n.page.evaluate((id) => { document.querySelector('#sx-' + id + ' .sx-pin').click(); }, id1); await n.page.evaluate(() => document.querySelector('#syntax .sx-ghead[aria-expanded="true"]').dataset.g);
  const g = await n.page.evaluate((id) => document.getElementById('sx-' + id).closest('.sx-grp').dataset.g, id1);
  await n.page.goto(BASE + '#syntax'); await n.page.reload(); await n.page.waitForSelector('#syntax .sx-grp', { timeout: 20000 }); await n.page.waitForTimeout(500);
  check('reload keeps the expanded family and the pin', await n.page.locator(`#syntax .sx-ghead[data-g="${g}"]`).getAttribute('aria-expanded') === 'true' && await n.page.locator('#syntax .sx-pinned [data-go]').count() >= 1, g);
  /* old anchors: every non-composition section is reachable by #sx-<id> and by the API, and its element ids stay */
  const old = JSON.parse(fs.readFileSync(path.join(SITE, 'data/syntax.json'), 'utf8')).sections.map((s) => s.id); const bad = [];
  for (const id of old) { const ok = await n.page.evaluate(async (id) => { location.hash = '#sx-' + id; await new Promise((r) => setTimeout(r, 120)); const s = document.getElementById('sx-' + id); return !!s && !!document.getElementById('sxh-' + id) && s.querySelector('.sx-body') && !s.querySelector('.sx-body').hidden; }, id); if (!ok) bad.push(id); }
  check(`old anchors #sx-<id> reach all ${old.length} original sections`, bad.length === 0, bad.join());
  await n.page.keyboard.press('Escape'); await n.page.fill('#syntax .sx-search', ''); await n.page.focus('#syntax .sx-search'); await n.page.keyboard.press('ArrowDown'); await n.page.waitForTimeout(100);
  check('keyboard: ArrowDown from the search moves focus into the list', await n.page.evaluate(() => document.activeElement && /sx-ghead|sx-head/.test(document.activeElement.className)));
  await n.page.screenshot({ path: path.resolve(SITE, '../docs/screens/phone-390-syntax-nav.png') }); check('console clean (390px flow)', n.errs.length === 0, n.errs.slice(0, 2).join(' | '));
  await n.ctx.close(); }
for (const [vw, vh] of [[1440, 900], [1024, 700], [390, 844]]) { const d = await newPage(vw, vh); await boot(d.page, '#syntax'); await d.page.waitForSelector('#syntax .sx-grp'); await d.page.waitForTimeout(500);
  if (vw === 1440) await d.page.screenshot({ path: path.resolve(SITE, '../docs/screens/desktop-1440-syntax-nav.png') });
  if (vw === 1440) check('desktop: families listed, console clean', await d.page.locator('#syntax .sx-grp').count() >= 15 && d.errs.length === 0, d.errs.slice(0, 2).join(' | '));
  const bh = await d.page.evaluate(() => { scrollTo(0, 600); return Math.round(document.querySelector('#syntax .sx-bar').getBoundingClientRect().height); });
  check(`sticky .sx-bar is at most 35% of the viewport at ${vw}x${vh}`, bh <= vh * 0.35, `${bh}px of ${vh} (${Math.round(bh / vh * 100)}%)`); await d.ctx.close(); }
{ const s = await newPage(360, 740); await boot(s.page, '#syntax'); await s.page.waitForSelector('#syntax .sx-grp'); const ov = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('360px: no horizontal overflow', ov <= 0, String(ov)); await s.ctx.close(); }
await browser.close(); server.close(); console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
