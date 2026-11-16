// #118: pad-first layout + no toast over pads. Standalone: node tests/site/perform_layout.mjs [--shots DIR]
// At 390x844 and 360x740 (touch): right after applying each built-in preset (no scrolling) the pad grid must be on screen, every pad centre
// must be hit by elementFromPoint (nothing overlays it), and pad targets stay >= 44 px.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null; if (shots) fs.mkdirSync(shots, { recursive: true });
const checks = [], nums = {}; const errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch();
for (const [W, H] of [[390, 844], [360, 740]]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  await page.evaluate(() => { localStorage.removeItem('sc.perform'); localStorage.removeItem('sc.perform.presets'); }); await page.reload(); await page.waitForSelector('#list li[data-id]');
  await page.evaluate(() => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad', { timeout: 60000 });
  await page.waitForFunction(() => window.strudelCraft.perform && window.strudelCraft.perform.presets, null, { timeout: 30000 });
  for (const id of ['beatpad-4x4', 'minimal']) {
    await page.evaluate((id) => window.scrollTo(0, 0), id);
    await page.evaluate((id) => window.strudelCraft.perform.presets.apply(id), id); await page.waitForSelector('#perform .pp-pad');
    const r = await page.evaluate(() => {
      const pads = [...document.querySelectorAll('#perform .pp-pad:not([data-state=empty])')]; const bad = []; let minSide = 1e9, maxBottom = 0, minTop = 1e9, maxRight = 0;
      pads.forEach((p) => { const b = p.getBoundingClientRect(); for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) { const e = document.elementFromPoint(b.x + b.width * fx, b.y + b.height * fy); if (!e || e.closest('.pp-pad') !== p) bad.push(p.dataset.pos + '@' + fx + ',' + fy + ':' + (e && (e.className || e.tagName))); } minSide = Math.min(minSide, b.width, b.height); maxBottom = Math.max(maxBottom, b.bottom); maxRight = Math.max(maxRight, b.right); minTop = Math.min(minTop, b.top); });
      const toast = document.querySelector('.toast'); const tp = document.querySelector('footer.transport').getBoundingClientRect().top; return { tp, maxRight, innerW: innerWidth, n: pads.length, bad, minSide, maxBottom, minTop, innerH: innerHeight, scrollY, toast: toast ? toast.textContent : null, over: document.documentElement.scrollWidth > innerWidth };
    });
    nums[`${W}x${H}/${id}`] = { pads: r.n, gridTop: Math.round(r.minTop), gridBottom: Math.round(r.maxBottom), minSide: Math.round(r.minSide) };
    check(`${W}x${H} ${id}: all ${r.n} pads fully on screen with no scrolling (bottom ${Math.round(r.maxBottom)} <= transport top ${Math.round(r.tp)}, right ${Math.round(r.maxRight)} <= ${r.innerW})`, r.n > 0 && r.maxBottom <= r.tp && r.maxRight <= r.innerW && r.scrollY === 0);
    check(`${W}x${H} ${id}: elementFromPoint hits every pad centre and all four corners (palette FAB, toasts) right after applying the preset (no toast over pads)`, r.bad.length === 0, r.bad.join(',') + (r.toast ? ' toast=' + r.toast : ''));
    check(`${W}x${H} ${id}: pad targets >= 44 px`, r.minSide >= 44, String(r.minSide));
    check(`${W}x${H} ${id}: no horizontal overflow`, !r.over);
    if (shots) await page.screenshot({ path: path.join(shots, `${W}x${H}-${id}.png`) });
  }
  { // toast pointer events: status toasts (info, ok) never capture a tap and show no X; error, sticky and actionable ones do
    const t = await page.evaluate(() => { const ui = window.strudelCraft.ui; document.querySelectorAll('.toasts .toast').forEach((x) => x.remove());
      const spec = [['info', { kind: 'info', ms: 20000 }], ['ok', { kind: 'ok', ms: 20000 }], ['error', { kind: 'error', ms: 20000 }], ['sticky', { kind: 'info', sticky: true }], ['act', { kind: 'ok', ms: 20000, onClick: () => {} }]];
      return spec.map(([name, o]) => { document.querySelectorAll('.toasts .toast').forEach((x) => x.remove()); const x = ui.toast(name + ' one', o); const b = x.querySelector('.toast-x'); return { text: name, pe: getComputedStyle(x).pointerEvents, x: b ? getComputedStyle(b).display : 'none', attr: x.getAttribute('data-live') }; }); });
    const by = Object.fromEntries(t.map((r) => [r.text, r]));
    check('status toasts (info, ok): pointer-events none, no X, no data-live attribute', ['info', 'ok'].every((k) => by[k] && by[k].pe === 'none' && by[k].x === 'none' && by[k].attr === null), JSON.stringify(t));
    check('error, sticky and actionable toasts: pointer-events auto', ['error', 'sticky', 'act'].every((k) => by[k] && by[k].pe === 'auto'), JSON.stringify(t));
    await page.evaluate(() => document.querySelectorAll('.toasts .toast').forEach((x) => x.remove()));
  }
  await ctx.close();
}
console.log(JSON.stringify(nums)); check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} passed`); process.exit(failed.length ? 1 : 0);
