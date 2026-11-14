// Layout-stability test for live number readouts (no jitter). Usage: node tests/site/readout_layout.mjs
// At 360px, drives the transport-range readout through 0.0, 9.9, 10.0, 99.9, 100.0 cycles and 0:59, 1:00, 9:59, 10:00
// (played/remaining too) and asserts no child box of the readout row moves or resizes. Also unit-checks numfmt.js.
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const SITE = new URL('../../site', import.meta.url).pathname;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${srv.address().port}/`;
let fail = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '  -- ' + d : '')); if (!c) fail++; };
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 360, height: 780 }, hasTouch: true }); const errs = [];
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('pageerror', (e) => errs.push(e.message));
await pg.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"body":""}' }));
await pg.goto(B); await pg.waitForFunction(() => window.strudelCraft && strudelCraft.range && strudelCraft.num && document.getElementById('trC'));
await pg.evaluate(() => document.fonts.ready);
const unit = await pg.evaluate(() => { const N = strudelCraft.num; return [N.cyc(3), N.cyc(9.96), N.cyc(-0.01), N.clock(9), N.clock(59.6), N.clock(599), N.clock(600), N.clock(3600), N.clock(65.25, { tenths: true }), N.clock(59.96, { tenths: true })]; });
ok('numfmt fixed decimals and padded clocks', JSON.stringify(unit) === JSON.stringify(['3.0', '10.0', '0.0', '00:09', '01:00', '09:59', '10:00', '1:00:00', '01:05.3', '01:00.0']), JSON.stringify(unit));
/* stub the engine: playing, cps 1 (1 cycle = 1 s), a scheduler at cycle X, the background clock at played P */
await pg.evaluate(() => { const sc = strudelCraft; sc.__real = { es: sc.engineState, tr: sc.transport, bg: sc.bg };
  sc.__X = 0; sc.__P = 0; sc.engineState = () => ({ scheduler: { now: () => sc.__X, cps: 1, started: true } });
  sc.transport = { playing: true, stop() {}, setMaster() {}, masterDb: 0 }; sc.bg = { installed: true, get played() { return sc.__P; }, paused: 2 };
  sc.range.state.loop = false; sc.range.setLimit(20); });
const boxes = () => pg.evaluate(() => [...document.querySelectorAll('#trange .tr-row > *, #trPosTxt > *, #trLeft *')].filter((e) => e.offsetParent || e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return (e.id || e.className) + ':' + r.x.toFixed(2) + ',' + r.y.toFixed(2) + ',' + r.width.toFixed(2); }));
const set = async (x, p) => { await pg.evaluate(([x, p]) => { strudelCraft.__X = x; strudelCraft.__P = p; strudelCraft.range.tick(); }, [x, p]); await pg.waitForTimeout(30); return pg.evaluate(() => document.getElementById('trPosTxt').textContent + ' | ' + document.getElementById('trLeft').textContent); };
const vals = [[0, 0], [9.9, 9.9], [10, 10], [99.9, 59], [100, 60], [59, 599], [60, 600], [599, 61], [600, 1199]];
let base = null, moved = [];
for (const [x, p] of vals) { const txt = await set(x, p); const bx = await boxes(); if (!base) base = bx; else bx.forEach((v, i) => { if (v !== base[i]) moved.push(`${txt}: ${base[i]} -> ${v}`); }); console.log('  ' + txt); }
ok('360px readout: no child moves or resizes across 0.0/9.9/10.0/99.9/100.0 and 0:59/1:00/9:59/10:00', moved.length === 0 && base.length > 8, moved.slice(0, 4).join(' | ') + ` (${base.length} boxes)`);
const txt = await set(3, 0); ok('cycles keep ".0"', /c 3\.0\/|c\s*3\.0/.test(txt.replace(/\s+/g, ' ').replace(/ \//g, '/')) || txt.includes('3.0'), txt);
await pg.evaluate(() => { const sc = strudelCraft; sc.engineState = sc.__real.es; sc.transport = sc.__real.tr; sc.bg = sc.__real.bg; });
ok('no console errors', errs.length === 0, errs.join(' | '));
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
