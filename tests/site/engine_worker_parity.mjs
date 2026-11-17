/* Event parity of the engine Worker (#180 stage 1): the same program played by the page-thread clock (?engine=page) and by the Worker (?engine=worker) must hand the same events to
   superdough: same set of (onset cycle, value) in cycles 2..8 of the run, and the same timing law (target - onset/cps constant within 5 ms: no drift, no re-anchor, no skipped hap).
   Sound is then identical by construction (same hap values into the same superdough); the rendered-LU check of tools/racks/measure.mjs does not apply to the live path (offline renders never
   use the live clock). Also a live edit and a stop/play round trip on the Worker, and fallback of an ineligible program (hooks.*) to the page clock.
   Usage: node tests/site/engine_worker_parity.mjs [--prog docs/tracks/velvet-static/track.standalone.strudel.js ...]. Exit 1 on a failed check. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site');
const progs = process.argv.flatMap((a, i) => (a === '--prog' ? [process.argv[i + 1]] : [])); if (!progs.length) progs.push('docs/tracks/velvet-static/track.standalone.strudel.js', 'docs/tracks/sirocco-foundry/track.standalone.strudel.js');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const checks = []; const check = (n, ok, d = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
async function run(code, engine, secs, after) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: !!PROXY, viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '?engine=' + engine); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(800);
  const ed = page.locator('.view[data-for=rack] .cm-content:visible').first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(code); await page.waitForTimeout(1200);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 120000 });
  await page.evaluate(() => { window.strudelCraft.bg.trace = true; }); await page.waitForTimeout(secs * 1000);
  const out = await page.evaluate(() => ({ tr: window.strudelCraft.bg.trace.slice(), cps: window.__sc.Engine.scheduler.cps, eng: window.strudelCraft.bg.engine(), st: window.strudelCraft.bg.stats() }));
  if (after) out.after = await after(page); out.errs = errs; await ctx.close(); return out;
}
const key = (e) => (+e[0]).toFixed(4) + '|' + e[2];
const win = (tr) => tr.filter((e) => e[0] >= 2 && e[0] < 8);
for (const p of progs) {
  const code = fs.readFileSync(path.resolve(ROOT, p), 'utf8'), name = path.basename(path.dirname(p));
  const A = await run(code, 'page', 16), B = await run(code, 'worker', 16);
  check(`${name}: worker engine drove the run`, B.eng.worker && B.eng.worker.mode === 'worker' && B.eng.worker.batches > 20, JSON.stringify({ mode: B.eng.worker && B.eng.worker.mode, batches: B.eng.worker && B.eng.worker.batches, err: B.eng.worker && B.eng.worker.errors }));
  const a = win(A.tr), b = win(B.tr); const ma = new Map(); for (const e of a) ma.set(key(e), (ma.get(key(e)) || 0) + 1); const mb = new Map(); for (const e of b) mb.set(key(e), (mb.get(key(e)) || 0) + 1);
  let miss = 0, extra = 0; for (const [k, n] of ma) if ((mb.get(k) || 0) !== n) miss++; for (const [k] of mb) if (!ma.has(k)) extra++;
  check(`${name}: same events (onset, value) in cycles 2..8`, a.length > 50 && miss === 0 && extra === 0, `${a.length} page / ${b.length} worker events, ${miss} missing, ${extra} extra`);
  const dev = (tr, cps) => { const d = win(tr).map((e) => e[1] - e[0] / cps); const m = d.slice().sort((x, y) => x - y)[Math.floor(d.length / 2)]; return Math.max(...d.map((x) => Math.abs(x - m))); };
  const da = dev(A.tr, A.cps), db = dev(B.tr, B.cps);
  check(`${name}: timing law holds (target - onset/cps constant within 5 ms)`, db < 0.005, `page ${(da * 1000).toFixed(1)} ms, worker ${(db * 1000).toFixed(1)} ms`);
  check(`${name}: no late event on the worker path`, B.st.perf.lateHaps === 0 && B.errs.length === 0, `late ${B.st.perf.lateHaps}, min margin ${B.st.perf.minMarginMs} ms (page path ${A.st.perf.minMarginMs} ms)`);
}
/* live edit and stop/play on the Worker; an ineligible program stays on the page clock */
const edit = await run('setcpm(120/4)\n$: note("c4*8").s("sine").gain(.05)', 'worker', 6, async (page) => {
  const t0 = await page.evaluate(() => window.getAudioContext().currentTime); await page.evaluate(() => { window.strudelCraft.bg.trace = true; });
  const ed = page.locator('.view[data-for=rack] .cm-content:visible').first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('setcpm(120/4)\n$: note("e4*8").s("sine").gain(.05)'); await page.waitForTimeout(400); await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => window.__sc.play()).catch(() => {}); await page.waitForTimeout(5000);
  return page.evaluate((t0) => ({ t0, tr: window.strudelCraft.bg.trace.slice(), mode: window.strudelCraft.bg.engine().worker.mode }), t0); });
const ev = edit.after; const lastNote = ev.tr.length ? ev.tr[ev.tr.length - 1][2] : '';
check('live edit on the Worker: new pattern is playing within the lookahead', /e4/.test(lastNote) && ev.mode === 'worker', `last event ${lastNote}, mode ${ev.mode}`);
const inel = await run('setcpm(120/4)\n$: note("c4*8").s("sine").gain(.05).gain(hooks.x ?? 1)', 'worker', 4);
check('ineligible program (hooks.*) stays on the page-thread clock', inel.eng.worker && inel.eng.worker.mode === 'page', JSON.stringify(inel.eng.worker && inel.eng.worker.mode));
await browser.close(); server.close(); const bad = checks.filter((c) => !c).length; console.log(`${checks.length - bad}/${checks.length} checks passed`); process.exit(bad ? 1 : 0);
