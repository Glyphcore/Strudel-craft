// Pressing / dragging a control must never scroll the editor (refs.js highlight on pointerdown uses scroll:false); the explicit jump does.
// Usage: node tests/site/refs_noscroll.mjs
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`; let fail = 0; const errors = [];
const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
page.on('pageerror', (e) => errors.push(e.message));
const pad = (n) => Array.from({ length: n }, (_, i) => `// pad ${i}`).join('\n');
const CODE = pad(80) + `\n$: note("c3 e3 g3").s("sawtooth").lpf(slider(800, 20, 20000))\n` + pad(80) + '\n';
await page.goto(BASE); await page.waitForFunction(() => document.documentElement.dataset.editor === 'cm6' && !!window.strudelCraft.refs, null, { timeout: 30000 });
await page.waitForSelector('#list li .row');
await page.evaluate((t) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, userEvent: 'input' }); }, CODE);
await page.waitForSelector('.pc-inline .pc-cell', { timeout: 60000 }); await page.waitForTimeout(1500);
const st = () => page.evaluate(() => { const v = document.getElementById('code').cmView; return { top: v.scrollDOM.scrollTop + scrollY, y: scrollY }; });
/* park the view with the control at the very top edge: a centring jump would move it by ~half a screen */
const away = async () => { await page.evaluate(() => { const c = document.querySelector('.pc-inline .pc-cell'); scrollBy(0, c.getBoundingClientRect().top - 8); }); await page.waitForTimeout(300); };
await away(); const s0 = await st(); check('view parked with the control at the top edge', s0.top > 50, JSON.stringify(s0));
const cell = page.locator('.pc-inline .pc-cell [data-ctl]').first(); const id = await page.locator('.pc-inline .pc-cell').first().getAttribute('data-site'); const getV = () => page.evaluate(() => { const e = document.querySelector('.pc-inline .pc-cell [data-ctl]'); return String(window.strudelCraft.perform.controls.get(e.dataset.ctl)); }); const val0 = await getV(id);
const box = await cell.boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy, { steps: 8 }); /* one direction only: never crosses the start value */ await page.waitForTimeout(150);
const mid = await st();  await page.mouse.up(); await page.waitForTimeout(300);
const s1 = await st(); const val1 = await getV(id);
check('pointerdown + drag does not scroll the editor', mid.top === s0.top && s1.top === s0.top && s1.y === s0.y, `${s0.top} -> ${mid.top} -> ${s1.top}`);
check('one-directional first drag changes the value (on-screen controls jump, no dead pickup)', val1 !== val0, `${val0} -> ${val1}`);
const hw = await page.evaluate(() => { const c = window.strudelCraft.perform.controls; const n = document.querySelector('.pc-inline .pc-cell [data-ctl]').dataset.ctl; const t = c.travelOf(n), v0 = c.get(n); const opt = { control: 'midi:cc7' };
  const away = Math.min(0.99, t + 0.2); c.input('value', n, away, opt); const v1 = c.get(n); c.input('value', n, Math.min(1, away + 0.05), opt); const v2 = c.get(n); c.input('value', n, t, opt); const v3 = c.get(n); return { v0, v1, v2, v3, t }; });
check('hardware input still uses pickup (ignored until it crosses the current value)', hw.v1 === hw.v0 && hw.v2 === hw.v0, JSON.stringify(hw));
await page.evaluate((i) => window.strudelCraft.refs.highlight(i, { scroll: false }), id); await page.waitForTimeout(200);
check('highlight(scroll:false) marks the span without scrolling', (await st()).top === s0.top && await page.evaluate(() => !!window.strudelCraft.intellisense.decorState('code').primary));
await page.evaluate((i) => window.strudelCraft.refs.gotoCode(i), id); await page.waitForTimeout(500);
const s2 = await st(); check('explicit gotoCode scrolls the editor to the span', Math.abs(s2.top - s0.top) > 100, `${s0.top} -> ${s2.top}`);
/* tooltip target button */
await away(); const s3 = await st();
await page.evaluate((i) => window.strudelCraft.refs.tip(document.querySelector('.pc-inline .pc-cell'), i), id); await page.waitForTimeout(150);
const gb = await page.locator('.ref-tip-go').boundingBox(); await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.waitForTimeout(500);
const s4 = await st(); check('tooltip target button scrolls the editor to the code', Math.abs(s4.top - s3.top) > 100, `${s3.top} -> ${s4.top}`);
await page.keyboard.press('Escape');
/* touch long-press: synthetic touch pointer events on the cell (not the control child) */
const touch = (type, el, x, y) => page.evaluate(([t, sel, x, y]) => document.querySelector(sel).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77, isPrimary: true, clientX: x, clientY: y })), [type, '.pc-inline .pc-cell', x, y]);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toasts *')].filter((n) => /jump to code/.test(n.textContent) && !n.children.length).length);
await page.evaluate(() => { try { localStorage.removeItem('sc.refs.hint'); } catch (e) {} });
await away(); const s5 = await st(); const cb = await page.locator('.pc-inline .pc-cell').first().boundingBox(); const px = cb.x + 4, py = cb.y + 4;
await touch('pointerdown', 0, px, py); await page.waitForTimeout(250); await touch('pointermove', 0, px + 30, py); await page.waitForTimeout(500); await touch('pointerup', 0, px + 30, py);
const s6 = await st(); check('touch hold with >10px movement cancels the long-press jump', Math.abs(s6.top - s5.top) < 5 && await toasts() === 0, `${s5.top} -> ${s6.top}`);
await touch('pointerdown', 0, px, py); await page.waitForTimeout(700); const s7 = await st(); await touch('pointerup', 0, px, py);
check('500 ms still touch long-press triggers gotoCode', Math.abs(s7.top - s5.top) > 100, `${s5.top} -> ${s7.top}`);
check('long-press shows the one-time toast', await toasts() === 1);
await away(); await touch('pointerdown', 0, px, py); await page.waitForTimeout(700); await touch('pointerup', 0, px, py); await page.waitForTimeout(200);
check('toast is shown only once', await toasts() === 1);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close(); console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
