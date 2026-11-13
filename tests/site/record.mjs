// Record panel + recipes (#72 follow-on): `node tests/site/record.mjs` (serves site/, playwright + network for unpkg).
// At 360x740, profile A: one Record with audio + events + code-state (2 cycles) -> a recipe take with chips, an exact reference render,
// 44px targets; the downloaded recipe is valid v1 JSON with pinned deps. Profile B (clean): import -> inert; Remake (approve) -> the audio
// hash matches. Tampered pack hash -> load refused with a modal naming the ref. Older version -> import refused. Legacy take store pruned
// with a notice. Panel docks as a workspace pane at 360. No console errors.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
const CODE = 'note("c3 e3 g3 b3").s("sawtooth").cutoff(ctl("cut", {type: "knob", min: 200, max: 4000, unit: "Hz"})).release(.2)';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function profile() {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); return { ctx, page };
}
/* poll an async page predicate (waitForFunction treats a returned Promise as truthy) */
const until = async (page, fn, arg, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(250); } return false; };
const modalOk = async (page, re) => { await page.waitForSelector('dialog.scm[open]', { timeout: 30000 }); const t = await page.textContent('dialog.scm[open]'); if (re && !re.test(t)) return t; await page.click('dialog.scm[open] .scm-ok'); return t; };

// ---------- profile A: record ----------
const A = await profile(); let p = A.page;
await p.click('#list li[data-id="minor-arp"] .row').catch(() => p.click('#list li[data-id] .row'));
await p.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
await p.evaluate(() => window.__sc.play());
await p.waitForFunction(() => window.__sc.S.playing && window.strudelCraft.perform && window.strudelCraft.perform.controls.has(window.strudelCraft.perform.controls.resolve('cut')), null, { timeout: 90000 });
await p.evaluate(() => { const C = window.strudelCraft.perform.controls; C.set(C.resolve('cut'), 1234); });
await p.click('#capBtn'); await p.waitForSelector('#capSheet:not([hidden])');
await p.evaluate(() => window.strudelCraft.capture.configure({ audio: true, events: true, code: true, mode: 'cycles', n: 2, countIn: 0, name: 'loop' }));
const tgt = await p.evaluate(() => { const els = [...document.querySelectorAll('#capSheet button, #capSheet select, #capSheet input[type=text], #capSheet .cap-seg span, #capSheet .switch')].filter((e) => e.getClientRects().length && !e.closest('[hidden]')); const r = document.getElementById('capSheet').getBoundingClientRect(); return { n: els.length, small: els.filter((e) => { const b = e.getBoundingClientRect(); return b.width < 44 || b.height < 44; }).map((e) => e.id || e.className || e.textContent).slice(0, 5), left: r.left, right: r.right, sw: document.documentElement.scrollWidth }; });
if (process.env.DBG) console.log(await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 361).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))));
ok('panel at 360: 44px targets, include boxes, fits', !tgt.small.length && tgt.left >= 0 && tgt.right <= 360, JSON.stringify(tgt));
const pal = await p.evaluate(() => window.strudelCraft.palette.list().filter((i) => i.id.startsWith('record.')).map((i) => i.id));
ok('palette record.* actions', pal.length >= 5, pal.join(','));
await p.click('#capRec');
await p.waitForFunction(() => window.strudelCraft.capture.state.phase === 'recording', null, { timeout: 60000 });
await p.evaluate(() => { const C = window.strudelCraft.perform.controls; setTimeout(() => C.set(C.resolve('cut'), 1500), 1500); });
await until(p, async () => { const l = await window.strudelCraft.capture.list(); return !!(l.length && l[0].outputs.render && !window.strudelCraft.capture.state.rendering); });
const t = await p.evaluate(async () => (await window.strudelCraft.capture.list())[0]); if (process.env.DBG) console.log(JSON.stringify(t).slice(0, 1500));
ok('one Record: recipe with audio + events + code-state, realtime capture + exact reference render', t.includes.audio && t.includes.events && t.includes.code && t.outputs.capture && t.outputs.render && t.timing.cycles === 2 && t.events.controls.length >= 1 && t.state.source.code.includes('sawtooth'), JSON.stringify({ timing: t.timing, outputs: Object.keys(t.outputs), events: t.events.controls.length, render: t.outputs.render.sha256.slice(0, 19) }));
const chips = await p.evaluate(() => [...document.querySelectorAll('#capTakes li[data-id]:first-child .cap-badge')].map((b) => b.textContent));
ok('timeline row shows include chips', ['audio', 'events', 'code'].every((c) => chips.includes(c)), chips.join(','));
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#capTakes li[data-id]:first-child [data-act="recipe"]')]);
const file = path.join(TMP, dl.suggestedFilename()); await dl.saveAs(file); const R = JSON.parse(fs.readFileSync(file, 'utf8'));
const pinsOk = /^sha256:[0-9a-f]{64}$/.test(R.deps.strudel.sha256) && R.deps.packs.length >= 1 && R.deps.packs.every((x) => /^sha256:/.test(x.manifest) && x.ingredients.every((i) => i.hash === null || /^sha256:/.test(i.hash))) && R.deps.site.build;
ok('downloaded recipe: format v1, pinned deps (Strudel bundle hash, pack manifest + ingredient hashes, build), state, events, outputs', R.format === 'strudel-craft/recipe' && R.version === 1 && pinsOk && R.state.controls && R.state.modRanges && Number.isInteger(R.random.seed) && /\.recipe\.json$/.test(dl.suggestedFilename()), `${dl.suggestedFilename()} packs ${R.deps.packs.map((x) => x.id)}`);
await p.evaluate(() => { document.querySelectorAll('.toast').forEach((x) => x.remove()); });
await p.screenshot({ path: path.join(REPO, 'docs/screens/phone-360-record.png') });
// workspace pane
await p.evaluate(() => { window.strudelCraft.capture.close(); window.strudelCraft.workspace.on([[{ id: 'record', w: 1 }]]); });
await p.waitForTimeout(400);
const ws = await p.evaluate(() => { const s = document.getElementById('capSheet'); const r = s.getBoundingClientRect(); return { inPane: !!s.closest('.ws-body'), visible: r.height > 100, right: r.right, sw: document.documentElement.scrollWidth }; });
ok('panel docks as a workspace pane at 360', ws.inPane && ws.visible && ws.right <= 360, JSON.stringify(ws));
await p.evaluate(() => window.strudelCraft.workspace.off());

// ---------- profile B: clean import + Remake ----------
const B = await profile(); p = B.page;
await p.evaluate(() => { localStorage.setItem('sc.capture.mode', '"cycles"'); localStorage.removeItem('sc.record.schema'); });
await p.reload(); await p.waitForSelector('#list li[data-id]');
await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((x) => /takes are now recipes/.test(x.textContent)), null, { timeout: 10000 }).catch(() => {});
const pr = await p.evaluate(() => ({ toast: [...document.querySelectorAll('.toast')].some((x) => /takes are now recipes/.test(x.textContent)), key: localStorage.getItem('sc.capture.mode') }));
ok('legacy take store pruned once with a notice', pr.toast && pr.key === null, JSON.stringify(pr));
await p.click('#capBtn'); await p.waitForSelector('#capSheet:not([hidden])');
await p.setInputFiles('#capFile', file); await p.waitForSelector('#capTakes li[data-id] .cap-badge[data-type="inert"]', { timeout: 10000 });
const inert = await p.evaluate(() => ({ playing: window.__sc.S.playing, started: !!(window.__sc.Engine.repl) }));
ok('import is inert (nothing evaluated or played)', !inert.playing && !inert.started, JSON.stringify(inert));
await p.click('#capTakes li[data-id] [data-act="remake"]');
const approve = await modalOk(p, /approve dependencies/i);
await until(p, async () => { const l = await window.strudelCraft.capture.list(); return !!(l[0] && l[0].remake); }, null, 120000);
const rm = await p.evaluate(async () => (await window.strudelCraft.capture.list())[0]);
const ctlOk = await p.evaluate(() => { try { const C = window.strudelCraft.perform.controls; return { ok: true, list: C.list().map((x) => [x.name, x.value]) }; } catch (e) { const C = window.strudelCraft.perform.controls; return { ok: false, err: e.message, stack: e.stack.split('\n').slice(0, 3).join(' | '), hc: C.history('cut'), hk: C.history('kkenzvc'), rc: C.resolve('cut'), rk: C.resolve('kkenzvc') }; } });
ok('controls engine intact after Remake (state restored)', ctlOk.ok, JSON.stringify(ctlOk) + ' aliases ' + JSON.stringify(R.state.aliases));
ok('clean profile Remake: approval modal lists deps, audio hash matches', /strudel/.test(approve) && /pack/.test(approve) && rm.remake.match === true && rm.remake.sha256 === R.outputs.render.sha256, JSON.stringify({ got: rm.remake.sha256.slice(0, 19), want: R.outputs.render.sha256.slice(0, 19), notes: rm.remake.notes }));

// tampered ref -> refused
const T = JSON.parse(JSON.stringify(R)); T.id = 'tampered'; T.name = 'tampered'; const h = T.deps.packs[0].manifest; T.deps.packs[0].manifest = h.slice(0, -1) + (h.endsWith('0') ? '1' : '0');
const tf = path.join(TMP, 'tampered.recipe.json'); fs.writeFileSync(tf, JSON.stringify(T));
await p.setInputFiles('#capFile', tf); await until(p, async () => (await window.strudelCraft.capture.list()).some((x) => x.name === 'tampered'));
const tid = await p.evaluate(async () => (await window.strudelCraft.capture.list()).find((x) => x.name === 'tampered').id);
await p.click(`#capTakes li[data-id="${tid}"] [data-act="remake"]`); await modalOk(p, /approve/i);
const refusal = await modalOk(p, /refused/i);
const after = await p.evaluate(async (id) => (await window.strudelCraft.capture.list()).find((x) => x.id === id).remake, tid);
ok('tampered pack hash: load refused, modal names the ref', /Load refused/.test(refusal) && refusal.includes(T.deps.packs[0].id) && !after, refusal.replace(/\s+/g, ' ').slice(0, 160));

// older / unknown version -> rejected
const O = { ...R, version: 0 }; const of = path.join(TMP, 'old.recipe.json'); fs.writeFileSync(of, JSON.stringify(O));
await p.setInputFiles('#capFile', of); const old = await modalOk(p, /refused/i);
ok('older recipe version rejected with a clear message', /version 0 is not supported/.test(old), old.replace(/\s+/g, ' ').slice(0, 140));
ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(fail ? `record: ${fail} FAIL` : 'record: all PASS'); process.exit(fail ? 1 : 0);
