/* Record panel UI pass: offline render shows progress and a working Cancel (no take stored); a live take whose self-check failed shows a visible flag with a
   Re-render offline action; no native dialogs. Needs network (unpkg). Usage: node tests/site/record_ui.mjs */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const BASE = `http://localhost:${server.address().port}/index.html`; let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true })).newPage(); const errs = [];
page.on('pageerror', (e) => !/different audio context/.test(String(e)) && errs.push((e.stack||String(e)).split('\n').slice(0,4).join(' < '))); page.on('dialog', (d) => { errs.push('native dialog ' + d.type()); d.dismiss(); });
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.capture, null, { timeout: 90000 });
await page.evaluate(() => { const ta = document.getElementById('code'); ta.value = 'note("c3 e3 g3 b3").s("sawtooth").release(.2)'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); });
await page.click('#capBtn'); await page.waitForSelector('#capSheet:not([hidden])');
ok('offline is the default source', await page.evaluate(() => window.strudelCraft.capture.opts.source === 'offline'));
ok('progress strip hidden when idle', await page.evaluate(() => document.getElementById('capProg').hidden));
/* a long render so the strip is observable; Cancel via the strip button */
await page.evaluate(() => { window.strudelCraft.capture.configure({ n: 64 }); window.__r = window.strudelCraft.capture.recordOffline(64, { name: 'cancelme' }); });
await page.waitForFunction(() => !document.getElementById('capProg').hidden && parseInt(document.getElementById('capBar').style.width) > 0, null, { timeout: 120000 });
const vis = await page.evaluate(() => ({ now: document.querySelector('.cap-bar').getAttribute('role'), pct: document.getElementById('capPct').textContent, h: document.getElementById('capCancel').getBoundingClientRect().height, r: document.getElementById('capCancel').getBoundingClientRect().right }));
ok('progress shown with percent and a 44px Cancel inside 360px', /\d+ %/.test(vis.pct) && vis.h >= 44 && vis.r <= 360, JSON.stringify(vis));
await page.screenshot({ path: path.join(ROOT, '../docs/screens/record-ui-progress-360.png') });
await page.click('#capCancel'); const res = await page.evaluate(() => window.__r.then((x) => x === null)); const dbg = await page.evaluate(() => [document.getElementById('capProg').hidden, window.strudelCraft.capture.state.phase, window.strudelCraft.capture.state.rendering, !!window.strudelCraft.capture.state.progAbort, window.strudelCraft.capture.state.abort]); if (process.env.DBG) console.log(res, dbg, await page.evaluate(() => { window.strudelCraft.capture.configure({}); return document.getElementById('capProg').outerHTML.slice(0, 120) + document.getElementById('capProg').hidden; }), await page.evaluate(() => window.strudelCraft.capture.list().then((l) => l.map((t) => t.name))));
ok('Cancel aborts the render (no take)', res && (await page.evaluate(() => window.strudelCraft.capture.list())).filter((t) => t.name === 'cancelme').length === 0 && await page.evaluate(() => document.getElementById('capProg').hidden));
/* flagged live take */
await page.evaluate(async () => { const C = window.strudelCraft.capture; const rec = await C.recordOffline(1, { name: 'flagged' }); const r = await C.get(rec.id || rec.recipe.id);
  r.recipe.outputs.capture = { check: { ok: false, why: '2 gaps in the tap (1024 frames), 1 event scheduled too late (dropped)' } }; r.recipe.timing.mode = 'cycles'; await C.putTake(r); });
await page.waitForSelector('.cap-tk[data-flag] .cap-flag', { timeout: 30000 });
const fl = await page.evaluate(() => { const f = document.querySelector('.cap-flag'); const b = f.querySelector('button'); return { t: f.textContent, bh: b && b.getBoundingClientRect().height, r: f.getBoundingClientRect().right }; });
ok('flagged take shows reasons in text and a Re-render offline button', /gaps in the tap/.test(fl.t) && /Re-render offline/.test(fl.t) && fl.bh >= 44 && fl.r <= 360, JSON.stringify(fl));
await page.evaluate(() => document.querySelectorAll('.toast, [role=status].toast').forEach((t) => t.remove())); await page.evaluate(() => document.querySelector('.cap-tk[data-flag]').scrollIntoView({ block: 'center' })); await page.screenshot({ path: path.join(ROOT, '../docs/screens/record-ui-flag-360.png') });
ok('no page errors or native dialogs', errs.length === 0, errs.join(' | ')); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
