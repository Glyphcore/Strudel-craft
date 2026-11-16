// Record length UI (#139, docs/CAPTURE.md "Length"): `node tests/site/record_length.mjs` (serves site/, playwright + network for unpkg).
// At 390x780: unit selector (default Bars), typed field (44px, inline errors, clamp message), chips, "To end of track" resolves bar 17 for a
// program gated "9b..17b", start bar; typed 12 bars -> offline take with exactly round(12 / cps * sr) frames and timing.bars/startBar;
// an old cycle-only recipe still validates and Remakes to the same hash; no editor scroll on press; no console errors.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), ROOT = path.join(REPO, 'site');
const require = createRequire(import.meta.url); let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const BASE = `http://localhost:${server.address().port}/index.html`;
let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const CODE = 'setcpm(128.8 / 4)\nhooks.def("lift", { chain: [["lpf", 400]] })\nhooks.bind("fx", "lift", "9b..17b")\nnote("c3 e3 g3 b3").s("sawtooth").release(.2).use("fx")';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true });
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await p.goto(BASE); await p.waitForSelector('#list li[data-id]');
await p.click('#list li[data-id] .row').catch(() => {});
await p.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
await p.evaluate(() => window.__sc.play()); await p.waitForFunction(() => window.__sc.S.playing, null, { timeout: 90000 });
await p.click('#capBtn'); await p.waitForSelector('#capSheet:not([hidden])');
const C = (fn, a) => p.evaluate(fn, a);
ok('default unit is Bars', await C(() => document.querySelector('input[name="cap-unit"]:checked').value === 'bars'));
const geo = await C(() => { const i = document.getElementById('capLen'), r = i.getBoundingClientRect(); const s = document.getElementById('capSheet').getBoundingClientRect(); return { h: r.height, mode: i.inputMode, right: s.right, sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll('#capSheet .cap-chip, #capSheet .cap-endchip, #capSheet .cap-in, #capSheet .cap-stepb')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43.5).length }; });
ok('field: inputmode decimal, 44px, no small targets, fits 390', geo.mode === 'decimal' && geo.h >= 44 && !geo.small && geo.right <= 390 && geo.sw <= 390, JSON.stringify(geo));
await p.click('#capLen', { clickCount: 3 }); await p.keyboard.type('12');
ok('typed 12 shows 12 bars, cycles, mm:ss, no error', await C(() => /^12 bars · 12 cycles · 00:\d\d\.\d/.test(document.getElementById('capDerive').textContent) && document.getElementById('capLenErr').hidden), await C(() => document.getElementById('capDerive').textContent));
await p.click('#capLen', { clickCount: 3 }); await p.keyboard.type('abc');
ok('invalid text: inline error, field flagged, no native dialog', await C(() => !document.getElementById('capLenErr').hidden && /not a number/.test(document.getElementById('capLenErr').textContent) && document.getElementById('capLen').getAttribute('aria-invalid') === 'true'));
await p.click('#capLen', { clickCount: 3 }); await p.keyboard.type('999');
ok('999 bars hits the 20-minute clamp message', await C(() => /20:00 play-time limit/.test(document.getElementById('capLenErr').textContent)), await C(() => document.getElementById('capLenErr').textContent));
await p.click('#capLen', { clickCount: 3 }); await p.keyboard.type('12'); await p.keyboard.press('Tab');
await p.click('.cap-chip[data-chip="8"]'); ok('chip 8 sets 8 bars', await C(() => document.getElementById('capLen').value === '8' && /^8 bars/.test(document.getElementById('capDerive').textContent)));
const conv = await C(() => { const s = document.querySelector('input[name="cap-unit"][value="seconds"]'); s.click(); return { v: document.getElementById('capLen').value, chips: [...document.querySelectorAll('.cap-chip')].map((x) => x.textContent) }; });
ok('switching to Seconds converts 8 bars to seconds (at 128.8 bpm ~14.9 s) and swaps chips', Math.abs(+conv.v - 8 / (128.8 / 240)) < 0.06 && conv.chips.join() === '10,30,60,120', JSON.stringify(conv));
await C(() => document.querySelector('input[name="cap-unit"][value="bars"]').click());
await p.click('#capToEnd');
const end = await C(() => ({ d: document.getElementById('capDerive').textContent, sum: window.strudelCraft.capture.resolveEnd() }));
ok('To end of track resolves bar 17 from the gate "9b..17b" and shows it', end.sum.rule === 'gates' && end.sum.bar === 17 && /bar 1 to 17/.test(end.d) && /last gate section/.test(end.d), JSON.stringify(end));
await p.fill('#capStart', '9'); ok('start bar 9 + to end = 8 bars', await C(() => /^8 bars/.test(document.getElementById('capDerive').textContent)));
await p.fill('#capEnd', '13'); ok('typed end bar 13 overrides: 4 bars from bar 9', await C(() => /^4 bars/.test(document.getElementById('capDerive').textContent) && /typed end/.test(document.getElementById('capDerive').textContent)));
await p.fill('#capEnd', ''); await p.fill('#capStart', '20'); ok('start past the end: inline error', await C(() => /end of track/.test(document.getElementById('capLenErr').textContent)));
await p.fill('#capStart', ''); await C(() => window.strudelCraft.capture.configure({ toEnd: false, startBar: '', endBar: '' }));
await p.screenshot({ path: path.join(REPO, 'docs/screens/phone-390-record-length.png') });
// typed 12 bars -> offline take, exact frames, no editor scroll
await p.click('#capLen', { clickCount: 3 }); await p.keyboard.type('12'); await p.keyboard.press('Tab');
await C(() => window.strudelCraft.capture.configure({ source: 'offline', name: 'twelve' }));
const sy0 = await C(() => window.scrollY); await p.click('#capRec');
const t0 = Date.now(); let rec = null; while (Date.now() - t0 < 240000 && !rec) { rec = await C(async () => { const l = await window.strudelCraft.capture.list(); const t = l.find((x) => x.name.startsWith('twelve')); return t && t.outputs.render ? t : null; }); if (!rec) await p.waitForTimeout(500); }
ok('typed 12 bars -> offline take', !!rec); if (rec) {
  const t = rec.timing; ok('timing: cycles 12, bars 12, startBar 1, unit bars, cpb 1, bpb 4', t.cycles === 12 && t.bars === 12 && t.startBar === 1 && t.unit === 'bars' && t.cpb === 1 && t.bpb === 4, JSON.stringify(t));
  ok('frames = round(12 / cps * sr) exactly', rec.outputs.render.frames === Math.round(12 / t.cps * rec.outputs.render.sr) && Math.abs(t.cps - 128.8 / 240) < 1e-4, `${rec.outputs.render.frames} cps ${t.cps}`);
  ok('pressing Record did not scroll the page', (await C(() => window.scrollY)) === sy0);
  const o = await C(async (id) => { const m = await import('./recipe.js'); const full = await window.strudelCraft.capture.get(id); const r = JSON.parse(JSON.stringify(full.recipe)); for (const k of ['bars', 'startBar', 'bpb', 'cpb', 'unit', 'toEnd', 'endRule']) delete r.timing[k]; r.id = 'old-cycle-recipe'; r.name = 'old-cycle';
    let valid = true; try { m.validate(r); } catch (e) { valid = e.message; } await window.strudelCraft.capture.putTake({ id: r.id, recipe: r, audio: full.audio }); const rm = await window.strudelCraft.capture.remake(r.id, { silent: true });
    return { valid, match: rm && rm.match, sha: rm && rm.sha256, want: r.outputs.render.sha256 }; }, rec.id);
  ok('old cycle-only recipe validates and Remakes to the same audio hash', o.valid === true && (o.match === true || o.sha === o.want), JSON.stringify(o)); }
const bad = await C(async () => { const m = await import('./recipe.js'); const full = await window.strudelCraft.capture.list(); const r = JSON.parse(JSON.stringify(full[0])); delete r.remake; delete r.imported; delete r.audio; r.timing.bars = 99; try { m.validate(r); return 'accepted'; } catch (e) { return e.message; } });
ok('a recipe whose bars disagree with cycles is refused', /disagrees/.test(bad), bad);
ok('no console errors', !errs.length, errs.join(' | ').slice(0, 300));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
