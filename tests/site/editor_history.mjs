// #177: editor-wide undo / redo. Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z (also Caps Lock: key "z") act on the code box text; programmatic edits and Insert (ta.value) are one step; on-screen buttons at 390px touch; Alt+Z steps version history, not while typing; live input event fires after undo/redo. Usage: node tests/site/editor_history.mjs
import { createRequire } from 'module';
import { execFileSync } from 'node:child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
let bad = 0; const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
const cache = new Map(); const errors = [];
async function fresh(opts) { /* a cold page: new context, nothing cached by the browser */
  const ctx = await browser.newContext(opts); const p = await ctx.newPage();
  if (process.env.HTTPS_PROXY) await p.route(/esm\.sh|unpkg\.com|githubusercontent|jsdelivr/, (r) => { const u = r.request().url(); try { if (!cache.has(u)) cache.set(u, execFileSync('curl', ['-sL', u], { maxBuffer: 1e8 })); r.fulfill({ status: 200, contentType: u.endsWith('.json') ? 'application/json' : 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: cache.get(u) }); } catch (e) { r.abort(); } });
  await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: '', body: '' }) : '[]' }));
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE); await p.waitForFunction(() => document.documentElement.dataset.editor === 'cm6' && !!window.strudelCraft.literals, null, { timeout: 60000 });
  return p;
}
const get = (p) => p.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
const put = (p, t) => p.evaluate((t) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, selection: { anchor: t.length } }); v.focus(); }, t);
const K = async (p, k) => { await p.keyboard.press(k); await p.waitForTimeout(60); };

const p = await fresh();
await p.evaluate(() => { window.__inputs = 0; document.getElementById('code').addEventListener('input', () => window.__inputs++); });
await put(p, 'abc'); await p.waitForTimeout(700); await p.keyboard.type('XYZ'); await p.waitForTimeout(700); /* new history group after the pause */
check('typed text', await get(p) === 'abcXYZ');
await K(p, 'Control+z'); check('Ctrl+Z undoes the typing', await get(p) === 'abc');
await K(p, 'Control+y'); check('Ctrl+Y redoes it', await get(p) === 'abcXYZ');
await K(p, 'Control+z'); await K(p, 'Control+Shift+Z'); check('Ctrl+Shift+Z redoes it (editor redo, not the app redo)', await get(p) === 'abcXYZ', await get(p));
await K(p, 'Control+z'); await K(p, 'Control+Shift+z'); check('Ctrl+Shift+Z with Caps Lock (key "z") redoes it', await get(p) === 'abcXYZ', await get(p));
await K(p, 'Control+z'); await p.evaluate(() => { window.__inputs = 0; }); await K(p, 'Control+y');
check('undo / redo fire the textarea input event (live compile hot swap path)', await p.evaluate(() => window.__inputs) >= 1);

/* programmatic edits: plain, paste-tagged and the app's own Insert path (textarea value + input event) */
for (const [name, run] of [
  ['plain view.dispatch', () => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: v.state.doc.length, insert: ' P1' } }); }],
  ['userEvent input.paste', () => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: v.state.doc.length, insert: ' P2' }, userEvent: 'input.paste' }); }],
  ['Insert (textarea value setter + input)', () => { const ta = document.getElementById('code'); ta.value = ta.value + '\n$: s("hh*8")'; ta.dispatchEvent(new Event('input')); }],
]) {
  await put(p, 'base'); await p.waitForTimeout(700); const before = await get(p);
  await p.evaluate(run); const after = await get(p);
  await K(p, 'Control+z'); const u = await get(p); await K(p, 'Control+Shift+Z'); const r = await get(p);
  check(`${name}: one undo step, redoable`, after !== before && u === before && r === after, JSON.stringify({ before, after, u, r }));
}

/* buttons at 390px touch */
const m = await fresh({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
await m.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'abc' }, annotations: [] }); });
const btn = (s) => m.evaluate((s) => { const b = document.querySelector('.view-rack [' + s + ']'); const r = b.getBoundingClientRect(); return { dis: b.disabled, w: r.width, h: r.height, x: r.x, y: r.y }; }, s);
let u = await btn('data-ed-undo'), r = await btn('data-ed-redo');
check('undo / redo buttons are at least 44px and inside the 390px viewport', u.w >= 44 && u.h >= 44 && r.w >= 44 && r.h >= 44 && u.x >= 0 && r.x + r.w <= 390, JSON.stringify({ u, r }));
await m.waitForTimeout(700); await m.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: v.state.doc.length, insert: 'Q' }, userEvent: 'input.type' }); });
u = await btn('data-ed-undo'); check('undo enabled after an edit, redo disabled', !u.dis && (await btn('data-ed-redo')).dis);
await m.tap('.view-rack [data-ed-undo]'); await m.waitForTimeout(60);
check('tap undo restores text and enables redo', await get(m) === 'abc' && !(await btn('data-ed-redo')).dis, await get(m));
await m.tap('.view-rack [data-ed-redo]'); await m.waitForTimeout(60);
check('tap redo reapplies, redo disabled again', await get(m) === 'abcQ' && (await btn('data-ed-redo')).dis, await get(m));
await m.tap('.view-rack [data-ed-versions]'); await m.waitForTimeout(300);
check('version history button opens the History panel', await m.evaluate(() => !!document.querySelector('#histDlg[open]')));
await m.keyboard.press('Escape');

/* Alt+Z: version history, never while typing in the editor / inputs; Ctrl+Z stays the editor's */
await put(p, 'keep'); await p.evaluate(() => { window.__hu = 0; window.__hr = 0; const h = window.strudelCraft.history; const u = h.undo, r = h.redo; h.undo = () => { window.__hu++; return u(); }; h.redo = () => { window.__hr++; return r(); }; });
const depth = () => p.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
await K(p, 'Alt+z'); check('Alt+Z while typing in the editor does not step version history or touch the text', await p.evaluate(() => window.__hu) === 0 && await depth() === 'keep');
await p.evaluate(() => { document.activeElement.blur(); document.body.focus(); });
await K(p, 'Alt+z'); await K(p, 'Alt+Shift+Z');
check('Alt+Z / Alt+Shift+Z from the page step version history undo / redo', await p.evaluate(() => [window.__hu, window.__hr]).then((a) => a[0] === 1 && a[1] === 1), JSON.stringify(await p.evaluate(() => [window.__hu, window.__hr])));
await p.evaluate(() => document.getElementById('q').focus()); await K(p, 'Alt+z');
check('Alt+Z in a search input does nothing', await p.evaluate(() => window.__hu) === 1);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(bad ? `${bad} FAILED` : 'ALL PASS'); process.exit(bad ? 1 : 0);
