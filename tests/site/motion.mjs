// Perform motion takes in the capture list (issue #72 addendum): `node tests/site/motion.mjs` (serves site/, playwright + network).
// At 360x740: record a 1-bar lane on a ctl() knob -> a "lane" take appears in the capture list with Download / Export audio / Copy code;
// the Download blob parses as strudel-craft/motion@1 JSON with the lane's events; Export audio saves a non-silent WAV take of the lane;
// Import JSON loads the take back; a looper pad take lands as a "pads" take; 44px targets; no console errors.
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
const BASE = `http://localhost:${server.address().port}/index.html`;
let fail = 0; const ok = (name, pass, info = '') => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const CODE = 'note("c3 e3 g3 b3").s("sawtooth").cutoff(ctl("cut", {type: "knob", min: 200, max: 4000, unit: "Hz"}))';
const MODEL = { tabs: [{ kind: 'bank', id: 'A', name: 'Bank A' }, { kind: 'board', id: 'main', name: 'Board' }], active: 0, perform: true,
  banks: { A: { id: 'A', rows: 4, cols: 4, pads: [{ pos: '1,0', target: { kind: 'tap', ref: 'hit' }, quant: 'none', label: 'hit' }] } },
  boards: { main: { id: 'main', cells: [], size: {} } }, controls: {}, maps: [], automation: {} };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
await page.evaluate((m) => { localStorage.setItem('sc.perform', JSON.stringify(m)); return new Promise((r) => { const q = indexedDB.deleteDatabase('sc-capture'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); }, MODEL);
await page.reload(); await page.waitForSelector('#list li[data-id]');
await page.click('#list li[data-id="minor-arp"] .row').catch(() => page.click('#list li[data-id] .row'));
await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
await page.evaluate(() => window.__sc.play());
await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && window.strudelCraft.perform && window.strudelCraft.perform.applyLane, null, { timeout: 90000 });
await page.evaluate(() => window.__sc.setView('perform'));
const knob = '#perform .pc-cell[data-name="cut"] [role=slider]';
// open the board tab so the knob is on screen
await page.click('#perform [role=tab]:has-text("Board")').catch(() => {}); await page.waitForSelector(knob, { timeout: 15000 });

// 1. record a 1-bar lane
await page.click('#pfLaneRec'); let i = 0; const t0 = Date.now();
while (Date.now() - t0 < 9000 && !(await page.evaluate(() => !window.strudelCraft.perform.lanes.run && [...window.strudelCraft.perform.controls.lanes().keys()].some((k) => k.startsWith('lane:'))))) { await page.focus(knob); await page.keyboard.press(i++ % 16 < 8 ? 'PageUp' : 'PageDown'); await page.waitForTimeout(70); }
await page.waitForFunction(async () => (await window.strudelCraft.capture.list()).some((m) => m.type === 'lane'), null, { timeout: 5000 }).catch(() => {});
const lane = await page.evaluate(async () => (await window.strudelCraft.capture.list()).find((m) => m.type === 'lane'));
const toastSeen = await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Take saved: .*Download/.test(t.textContent)));
ok('lane take appears in the capture list (+ "Take saved, Download" toast)', !!lane && lane.kind === 'motion' && lane.events > 1 && toastSeen, JSON.stringify(lane && { name: lane.name, events: lane.events, control: lane.control, cycles: lane.cycles, toastSeen }));

await page.evaluate(() => window.strudelCraft.capture.open()); await page.waitForSelector(`#capTakes li[data-id="${lane.id}"]`);
const row = await page.evaluate((id) => { const li = document.querySelector(`#capTakes li[data-id="${id}"]`); const bs = [...li.querySelectorAll('button')].filter((b) => b.getClientRects().length);
  return { badge: li.querySelector('.cap-badge').textContent, acts: bs.map((b) => b.dataset.act), small: bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map((b) => b.dataset.act), right: Math.max(...bs.map((b) => b.getBoundingClientRect().right)) }; }, lane.id);
ok('lane row: badge, Download/Export audio/Copy code buttons, 44px targets inside 360', row.badge === 'lane' && ['mjson', 'maudio', 'mcode', 'load'].every((a) => row.acts.includes(a)) && !row.small.length && row.right <= 360, JSON.stringify(row));

// 2. Download JSON through the anchor
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click(`#capTakes li[data-id="${lane.id}"] .cap-dl [data-act="mjson"]`)]);
const jtext = fs.readFileSync(await dl.path(), 'utf8'); let J = null; try { J = JSON.parse(jtext); } catch (e) { /* invalid */ }
const want = await page.evaluate((id) => window.strudelCraft.capture.get(id).then((r) => r.model.lane.points.length), lane.id);
const evOk = J && Array.isArray(J.events) && J.events.length === want && J.events.every((e) => typeof e.cycle === 'number' && typeof e.time === 'number' && e.control === lane.control && typeof e.value === 'number')
  && J.events.every((e, k) => k === 0 || e.cycle >= J.events[k - 1].cycle) && Math.abs(J.events[1].time - J.events[1].cycle / J.cps) < 1e-4;
ok('Download blob is valid motion JSON with the lane events (cycle, time, control, value), cps, code, source', !!J && J.format === 'strudel-craft/motion@1' && J.type === 'lane' && evOk && J.cps > 0 && /signal\(/.test(J.code) && J.refs.control === lane.control && !!J.source.code, `${dl.suggestedFilename()} events ${J && J.events.length}/${want}`);

// 3. Copy as Strudel code
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
await page.click(`#capTakes li[data-id="${lane.id}"] [data-act="mcode"]`); await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok('Copy code puts the laneCode output on the clipboard', /const \w+ = signal\(/.test(clip), clip.slice(0, 60));

// 4. Export audio (re-record pass through the capture path) -> non-silent WAV take
const [dla] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(`#capTakes li[data-id="${lane.id}"] [data-act="maudio"]`)]);
const au = await page.evaluate(async (id) => (await window.strudelCraft.capture.list()).find((m) => m.from === id), lane.id);
const wav = fs.readFileSync(await dla.path()); if (process.env.DBG) console.log(await page.evaluate(async () => JSON.stringify((await window.strudelCraft.capture.list()).map((m) => ({ n: m.name, t: m.type, k: m.kind, f: m.from, p: m.peak })))));
ok('Export audio: non-silent WAV take of the lane length', !!au && au.type === 'audio' && au.peak > 0.01 && au.frames === Math.round(au.cycles / au.cps * au.sr) && wav.toString('ascii', 0, 4) === 'RIFF' && /\.wav$/.test(dla.suggestedFilename()), JSON.stringify(au && { name: au.name, peak: au.peak, cycles: au.cycles, frames: au.frames, file: dla.suggestedFilename(), bytes: wav.length }));

// 5. Import JSON loads the take back (lane cleared first)
await page.evaluate((c) => window.strudelCraft.perform.controls.lanes().delete('lane:' + c), lane.control);
const tmp = path.join(path.dirname(await dl.path()), 'motion-import.json'); fs.writeFileSync(tmp, jtext);
await page.setInputFiles('#capFile', tmp); await page.waitForTimeout(600);
const back = await page.evaluate((c) => ({ has: window.strudelCraft.perform.controls.lanes().has('lane:' + c), n: window.strudelCraft.capture.list().then((l) => l.filter((m) => m.type === 'lane').length) }), lane.control);
ok('Import JSON stores the take and loads the lane back into Perform', back.has, JSON.stringify(back));

// 6. looper pad take lands as a "pads" take
await page.evaluate(() => window.strudelCraft.capture.close()); await page.click('#perform [role=tab]:has-text("Bank A")').catch(() => {});
await page.waitForSelector('#pfTakeRec'); await page.click('#pfTakeRec');
const t1 = Date.now(); while (Date.now() - t1 < 7000 && !(await page.evaluate(async () => (await window.strudelCraft.capture.list()).some((m) => m.type === 'pads')))) { await page.keyboard.press('KeyQ'); await page.waitForTimeout(180); }
const pads = await page.evaluate(async () => { const m = (await window.strudelCraft.capture.list()).find((x) => x.type === 'pads'); if (!m) return null; const r = await window.strudelCraft.capture.get(m.id); const j = window.strudelCraft.capture.motionJson(r); return { events: m.events, ev0: j.events[0], code: j.code.slice(0, 40) }; });
ok('looper pad take kept as a "pads" take with pad events and bounceCode', !!pads && pads.events > 0 && pads.ev0.pad === 'A/1,0' && typeof pads.ev0.cycle === 'number' && /bounced/.test(pads.code), JSON.stringify(pads));

await page.evaluate(() => window.strudelCraft.capture.open()); await page.waitForTimeout(300);
await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const s = document.getElementById('capSheet'); s.scrollTop = document.getElementById('capTakes').offsetTop - 60; });
await page.screenshot({ path: path.join(REPO, 'docs/screens/phone-360-motion-takes.png') });
ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(fail ? `motion: ${fail} FAIL` : 'motion: all PASS'); process.exit(fail ? 1 : 0);
