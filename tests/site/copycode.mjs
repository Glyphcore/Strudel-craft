// Copy code widget: `node tests/site/copycode.mjs` (serves site/, playwright + network for esm.sh / unpkg).
// At 360x740 with clipboard permission: the Rack button is 44x44 at the editor's top-right, does not overlap the code text or the
// live chip; tapping it puts the CodeMirror doc (in an error state) on the clipboard and shows the "Copied" toast + check mark;
// the Stack and Syntax buttons copy their text; the menu (long-press) copies a selection, a share link that round-trips, a valid
// recipe v1 JSON; the palette has "Copy code"; no console errors. Screenshot: docs/screens/phone-360-copycode.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.join(REPO, 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; }
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
}).listen(0);
const ORIGIN = `http://localhost:${server.address().port}`, BASE = ORIGIN + '/index.html';
let fail = 0; const ok = (name, pass, info = '') => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|Unexpected token|SyntaxError/.test(m.text())) errs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
await page.waitForSelector('#code ~ .cm-editor .cc-btn', { timeout: 60000 });
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));

// error-state code with a long line (must not run under the button)
const BAD = '$: note("c3 e3 g3 b3").s("sawtooth").lpf(800).room(.3).delay(.25).gain(.7).release(.2)\n$: s("bd*4").bank(  // unclosed';
await page.evaluate((c) => { const t = document.getElementById('code'); t.value = c; t.dispatchEvent(new Event('input')); }, BAD);
await page.click('#evalBtn').catch(() => {}); await page.waitForTimeout(800);
const geo = await page.evaluate(() => {
  const cm = document.querySelector('#code ~ .cm-editor'), b = cm.querySelector('.cc-btn').getBoundingClientRect(), e = cm.getBoundingClientRect();
  const chip = document.getElementById('liveChip').getBoundingClientRect();
  const ov = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
  const texts = [...cm.querySelectorAll('.cm-line')].flatMap((l) => { const r = document.createRange(); r.selectNodeContents(l); return [...r.getClientRects()]; }).filter((r) => r.width > 0);
  return { w: b.width, h: b.height, dx: Math.round(e.right - b.right), dy: Math.round(b.top - e.top), chip: ov(b, chip), text: texts.some((r) => ov(b, r)), right: Math.round(b.right), vw: 360 };
});
ok('rack button 44x44 pinned top-right', geo.w === 44 && geo.h === 44 && geo.dx === 0 && geo.dy === 0, JSON.stringify(geo));
ok('button covers neither code text nor live chip; inside the 360 viewport', !geo.text && !geo.chip && geo.right <= geo.vw, JSON.stringify(geo));
await page.evaluate(() => navigator.clipboard.writeText('-'));
await page.tap('#code ~ .cm-editor .cc-btn');
await page.waitForSelector('.toast.ok', { timeout: 5000 }).catch(() => {});
const doc = await page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
ok('tap copies the CodeMirror doc (error state) to the clipboard', (await clip()) === doc && doc === BAD, JSON.stringify((await clip()).slice(0, 40)));
ok('"Copied" toast + check mark', /Copied/.test(await toastText()) && (await page.getAttribute('#code ~ .cm-editor .cc-btn', 'data-done')) === '1', await toastText());
await page.evaluate(() => document.querySelector('#code ~ .cm-editor').scrollIntoView({ block: 'center' }));
await page.screenshot({ path: path.join(REPO, 'docs/screens/phone-360-copycode.png') });

// menu: long-press -> selection, link, recipe
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ selection: { anchor: 4, head: 20 } }); });
const box = await page.locator('#code ~ .cm-editor .cc-btn').boundingBox();
const cdp = await ctx.newCDPSession(page); const pt = [{ x: box.x + 22, y: box.y + 22 }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await page.waitForTimeout(800); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const menuOpen = await page.isVisible('#ccMenu'); ok('long-press opens the menu', menuOpen);
if (!menuOpen) await page.evaluate(() => document.querySelector('#code ~ .cm-editor .cc-btn').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
await page.click('#ccMenu [data-mode="selection"]'); await page.waitForTimeout(200);
ok('Copy selection', (await clip()) === BAD.slice(4, 20), await clip());
await page.click('#code ~ .cm-editor .cc-btn', { button: 'right' }); await page.click('#ccMenu [data-mode="link"]'); await page.waitForTimeout(400);
const link = await clip(); const back = await page.evaluate((u) => window.strudelCraft.copycode.decode(new URL(u).hash), link);
ok('Copy as shareable link round-trips', /#code\/[zp][\w-]+$/.test(link) && back === BAD, link.slice(0, 80));
await page.click('#code ~ .cm-editor .cc-btn', { button: 'right' }); await page.click('#ccMenu [data-mode="recipe"]');
let rec = null; for (let i = 0; i < 40 && !rec; i++) { await page.waitForTimeout(250); try { const j = JSON.parse(await clip()); if (j.format) rec = j; } catch (e) { /* not yet */ } }
ok('Copy with controls and state = recipe v1 JSON', rec && rec.format === 'strudel-craft/recipe' && rec.version === 1 && rec.state.source.code === BAD && rec.includes.code === true, rec ? Object.keys(rec).join(',') : 'none');

// share link opens into Rack
const p2 = await ctx.newPage(); await p2.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, BASE)); await p2.waitForSelector('#list li[data-id]');
await p2.waitForFunction((c) => document.getElementById('code').value === c, BAD, { timeout: 20000 }).catch(() => {});
ok('share link loads the code into Rack', (await p2.evaluate(() => document.getElementById('code').value)) === BAD); await p2.close();

// stack + syntax
await page.evaluate(() => window.__sc.setView('stack')); await page.waitForSelector('#stackCode ~ .cm-editor .cc-btn');
await page.tap('#stackCode ~ .cm-editor .cc-btn'); await page.waitForTimeout(300);
ok('stack button copies the stack doc', (await clip()) === (await page.evaluate(() => document.getElementById('stackCode').cmView.state.doc.toString())));
await page.evaluate(() => window.__sc.setView('syntax')); await page.waitForSelector('#syntax .sx-ex .cc-btn', { state: 'attached', timeout: 20000 });
const sx = page.locator('#syntax .sx-ex:has(pre)').first(); await sx.scrollIntoViewIfNeeded(); await sx.locator('.cc-btn').tap(); await page.waitForTimeout(300);
ok('syntax example button copies the example', (await clip()) === (await sx.locator('pre').textContent()));
const pal = await page.evaluate(() => window.strudelCraft.palette.filter('copy code').map((x) => x.title));
ok('palette has "Copy code"', pal.includes('Copy code'), pal.join(' / '));
ok('no console errors', errs.length === 0, errs.join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
