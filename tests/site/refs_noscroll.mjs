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
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy, { steps: 6 }); await page.mouse.move(cx - 30, cy, { steps: 12 }); /* crosses the start once: the default soft takeover picks up there */ await page.waitForTimeout(150);
const mid = await st();  await page.mouse.up(); await page.waitForTimeout(300);
const s1 = await st(); const val1 = await getV(id);
check('pointerdown + drag does not scroll the editor', mid.top === s0.top && s1.top === s0.top && s1.y === s0.y, `${s0.top} -> ${mid.top} -> ${s1.top}`);
check('drag changed the value', val1 !== val0, `${val0} -> ${val1}`);
await page.evaluate((i) => window.strudelCraft.refs.highlight(i, { scroll: false }), id); await page.waitForTimeout(200);
check('highlight(scroll:false) marks the span without scrolling', (await st()).top === s0.top && await page.locator('.cm-ref-primary').count() > 0);
await page.evaluate((i) => window.strudelCraft.refs.gotoCode(i), id); await page.waitForTimeout(500);
const s2 = await st(); check('explicit gotoCode scrolls the editor to the span', Math.abs(s2.top - s0.top) > 100, `${s0.top} -> ${s2.top}`);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close(); console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
