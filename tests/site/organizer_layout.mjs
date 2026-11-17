// Organizer layout (#179): the folder tree + tag chips must never push the Recipes list or the Syntax entries out of their container.
// For Recipes and Syntax at 1440x900, 1024x700, 768x1024, 390x844, 360x740 with the folder tree and all tags expanded and 8 tags selected (wrapping rows):
// bounded filter region, list/entries >= 45% of the viewport and not clipped by any ancestor, filters and entries do not intersect, the toggle hides/shows
// the filters and is remembered, the last row is reachable, a press never scrolls the editor (#107).
// Usage: node tests/site/organizer_layout.mjs [--site DIR]   (NODE_PATH must reach playwright)
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const SITE = path.resolve(arg('--site') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../site'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch(); const errs = [];
const boot = async (ctx, view) => { const page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto(BASE); await page.waitForFunction(() => !!window.__sc && document.querySelector('#list li .row'), null, { timeout: 30000 });
  if (view === 'syntax') { await page.evaluate(() => document.querySelector('.views a[data-view="syntax"]').click()); await page.waitForSelector('#syntax .sx-grp'); await page.waitForSelector('#syntax .org-chip', { state: 'attached' }); }
  else await page.waitForSelector('#org .org-chip', { state: 'attached' });
  return page; };
/* in-page helpers: rect intersection area, the visible height of an element after every clipping ancestor and the viewport (above the transport) */
const helpers = () => {
  window.__R = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height }; };
  window.__ix = (a, b) => Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) * Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));
  window.__vis = (e) => { const r = window.__R(e); let t = Math.max(r.t, 0), b = Math.min(r.b, (document.querySelector('.transport') || { getBoundingClientRect: () => ({ top: innerHeight }) }).getBoundingClientRect().top);
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) { const o = getComputedStyle(p); if (o.overflowY !== 'visible' && p !== document.body) { const q = p.getBoundingClientRect(); t = Math.max(t, q.top); b = Math.min(b, q.bottom); } }
    return Math.max(0, b - t); };
};
async function expandAll(page, host) {
  const open = await page.evaluate((h) => document.querySelector(h + ' details.org').open, host);
  if (!open) await page.locator(host + ' details.org > summary').click();
  for (let i = 0; i < 4; i++) await page.evaluate((h) => document.querySelectorAll(h + ' .org-tgl[aria-expanded="false"]').forEach((b) => b.click()), host);
  await page.evaluate((h) => { const m = document.querySelector(h + ' .org-more'); if (m && m.textContent.startsWith('All')) m.click(); const mb = document.querySelector(h + ' .org-mode'); if (mb.getAttribute('aria-checked') !== 'true') mb.click(); [...document.querySelectorAll(h + ' .org-chip')].slice(0, 8).forEach((c) => c.click()); }, host);
  await page.waitForTimeout(300);
}
const VPS = [[1440, 900], [1024, 700], [768, 1024], [390, 844], [360, 740]];
for (const [w, h] of VPS) for (const view of ['recipes', 'syntax']) {
  const tag = `${view} ${w}x${h}`; const host = view === 'syntax' ? '#syntax' : '#org';
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 }); const page = await boot(ctx, view); await page.evaluate(helpers);
  const ed0 = await page.evaluate(() => scrollY);
  /* toggle: opens, closes, state remembered across a reload */
  const sum = page.locator(host + ' details.org > summary');
  if (await page.evaluate((x) => document.querySelector(x + ' details.org').open, host)) await sum.click();
  check(`${tag}: the filter toggle is a >= 44px summary button with aria-expanded=false when closed`, await sum.getAttribute('aria-expanded') === 'false' && (await sum.boundingBox()).height >= 43.5);
  await expandAll(page, host);
  check(`${tag}: the toggle opens the filters (aria-expanded=true) and shows the active count`, await sum.getAttribute('aria-expanded') === 'true' && (await page.locator(host + ' [data-org-count]').innerText()) === '8');
  const hostSel = view === 'syntax' ? '#syntax .org-host' : '#org';
  const m = await page.evaluate(({ hs, view }) => { const H = document.querySelector(hs); const r = window.__R(H); const o = { host: r, hostScroll: H.scrollHeight > H.clientHeight + 1, vh: innerHeight };
    const L = document.querySelector(view === 'syntax' ? '#syntax .sx-groups' : '#list'); L.scrollIntoView({ block: 'start' }); const live = document.querySelector('.org-host'); void live; return o; }, { hs: hostSel, view });
  check(`${tag}: filter region is bounded (<= 42% of the viewport) and scrolls itself`, m.host.h <= h * 0.42 + 1 && m.hostScroll, Math.round(m.host.h) + ' px, scroll ' + m.hostScroll);
  if (view === 'recipes') {
    await page.evaluate(() => document.querySelector('#list').scrollIntoView({ block: 'nearest' })); await page.waitForTimeout(150);
    const r = await page.evaluate((hs) => { const L = document.querySelector('#list'), H = document.querySelector(hs), B = document.querySelector('.browser'); return { vis: window.__vis(L), len: L.children.length, ix: window.__ix(window.__R(L), window.__R(H)), ixs: window.__ix(window.__R(L), window.__R(document.querySelector('#q'))), inBrowser: window.__R(L).b <= window.__R(B).b + 1 || getComputedStyle(B).position === 'static', bt: getComputedStyle(B).position }; }, hostSel);
    check(`${tag}: the list has results and shows >= 45% of the viewport (visible after every clipping ancestor)`, r.len > 0 && r.vis >= h * 0.45 - 1, `${Math.round(r.vis)} of ${h}, ${r.len} rows`);
    check(`${tag}: filter panel and list do not intersect`, r.ix === 0 && r.ixs === 0);
    const last = await page.evaluate(() => { const L = document.querySelector('#list'); L.scrollTop = L.scrollHeight; const li = L.lastElementChild; if (getComputedStyle(L).overflowY === 'visible') li.scrollIntoView({ block: 'end' }); const a = window.__R(li), b = window.__R(L); const tp = document.querySelector('.transport').getBoundingClientRect().top; return { inList: a.b <= b.b + 1 || getComputedStyle(L).overflowY === 'visible', onScreen: a.b <= tp + 1 && a.t >= 0, vis: window.__vis(li) }; });
    check(`${tag}: the last row is reachable by scrolling`, last.onScreen && last.vis > 20, JSON.stringify(last));
  } else {
    await page.evaluate(() => scrollTo(0, 0));
    const r = await page.evaluate((hs) => { const H = document.querySelector(hs), G = document.querySelector('#syntax .sx-groups'), Bar = document.querySelector('#syntax .sx-bar'); const hr = window.__R(H), g = window.__R(G), b = window.__R(Bar);
      return { bar: b.h, ixg: window.__ix(hr, g), ixb: window.__ix(hr, b), bg: window.__ix(b, g), hostBelowBar: hr.t >= b.b - 1 }; }, hostSel);
    check(`${tag}: the sticky search/jump bar is <= 30% of the viewport (was 507 px at >= 900 wide)`, r.bar <= h * 0.3, Math.round(r.bar) + ' px');
    check(`${tag}: filter panel, search bar and entries do not intersect`, r.ixg === 0 && r.ixb === 0 && r.bg === 0, JSON.stringify(r));
    const s = await page.evaluate(() => { const G = document.querySelector('#syntax .sx-groups'), Bar = document.querySelector('#syntax .sx-bar'); const barB = () => Bar.getBoundingClientRect().bottom;
      scrollTo(0, G.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(Bar).top) - Bar.getBoundingClientRect().height); const gh = [...G.querySelectorAll('.sx-ghead')].find((e) => e.offsetParent && e.getBoundingClientRect().top >= barB() - 1); const rr = gh.getBoundingClientRect(); const top = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
      const tp = document.querySelector('.transport').getBoundingClientRect().top; return { visible: tp - barB(), head: top === gh || gh.contains(top), expand: gh.dataset.g }; });
    check(`${tag}: entries get >= 45% of the viewport below the sticky bar and the first family head is not covered`, s.visible >= h * 0.45 - 1 && s.head, `${Math.round(s.visible)} of ${h}`);
    const edBefore = await page.evaluate(() => { const v = document.getElementById('code'); return (v && v.cmView ? v.cmView.scrollDOM.scrollTop : 0); });
    await page.locator(`#syntax .sx-ghead[data-g="${s.expand}"]`).click(); await page.waitForTimeout(250);
    check(`${tag}: pressing a family does not scroll the editor (#107)`, (await page.evaluate(() => { const v = document.getElementById('code'); return (v && v.cmView ? v.cmView.scrollDOM.scrollTop : 0); })) === edBefore);
    const last = await page.evaluate(() => { const gs = [...document.querySelectorAll('#syntax .sx-grp')].filter((e) => !e.hidden); const L = gs[gs.length - 1]; const tp = document.querySelector('.transport').getBoundingClientRect().top; scrollTo(0, L.getBoundingClientRect().bottom + scrollY - tp + 4); const r = L.getBoundingClientRect(); /* phones keep the recipe browser below the Syntax view, so the page continues after the last family */ return { ok: r.bottom <= tp + 1 && r.top >= 0, b: r.bottom, tp, t: r.top, y: scrollY, H: document.documentElement.scrollHeight }; });
    check(`${tag}: the last family is reachable by scrolling`, last.ok, JSON.stringify(last));
  }
  /* toggle hides and shows, and is remembered */
  await page.evaluate(() => scrollTo(0, 0));
  await sum.click(); await page.waitForTimeout(200); const closed = await page.evaluate((x) => !document.querySelector(x + ' details.org').open, host);
  const hh = await page.evaluate((hs) => window.__R(document.querySelector(hs)).h, hostSel);
  check(`${tag}: the toggle hides the filters (panel collapses to the summary row plus one crumb row, <= 124 px)`, closed && hh <= 124, Math.round(hh) + ' px');
  await page.reload(); await page.waitForFunction(() => !!window.__sc && document.querySelector('#list li .row'), null, { timeout: 30000 });
  if (view === 'syntax') { await page.evaluate(() => document.querySelector('.views a[data-view="syntax"]').click()); await page.waitForSelector('#syntax .org-chip', { state: 'attached' }); } else await page.waitForSelector('#org .org-chip', { state: 'attached' });
  check(`${tag}: the closed state is remembered after a reload`, await page.evaluate((x) => !document.querySelector(x + ' details.org').open, host));
  await page.locator(host + ' details.org > summary').click(); await page.waitForTimeout(200); await page.reload(); await page.waitForFunction(() => !!window.__sc && document.querySelector('#list li .row'), null, { timeout: 30000 });
  if (view === 'syntax') { await page.evaluate(() => document.querySelector('.views a[data-view="syntax"]').click()); await page.waitForSelector('#syntax .org-chip', { state: 'attached' }); } else await page.waitForSelector('#org .org-chip', { state: 'attached' });
  check(`${tag}: the open state is remembered after a reload`, await page.evaluate((x) => document.querySelector(x + ' details.org').open, host));
  void ed0; await ctx.close();
}
check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close(); server.close(); console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
