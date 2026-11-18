/* #196: choosing another recipe while playing starts a fresh audio feed. After the switch nothing of recipe A sounds (event level: no A hap triggered after the
   switch; audio level: no A energy on the master), the live source-node count returns to baseline over N switches, and the timeline lanes hold only B.
   ?ahead=0 (#199): the counts and levels here are those of live voices; with precomputed playback a playing recipe has no voices at all (the buffer side of the switch is
   tests/site/bufferplay.mjs section 5: Engine.cut drops the buffer sources).
   Usage (repo root): node tests/site/recipe_switch.mjs   (wrap in engine/load/gate.sh medium) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = []; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const A = 'setcpm(120/4)\nvoiceA: note("a3 a3 a3 a3").s("sine").release(3).sustain(1).gain(0.4)\n';
const B = 'setcpm(120/4)\nvoiceB: note("e5 ~ e5 ~").s("triangle").release(0.1).gain(0.2)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await ctx.addInitScript(() => { /* count live source nodes: started and not yet ended */
  const live = new Set(); window.__live = live; const P = AudioScheduledSourceNode.prototype, st = P.start;
  const sp = P.stop; P.stop = function (...a) { this.__stop = a[0]; return sp.apply(this, a); };
  P.start = function (...a) { this.__start = a[0]; live.add(this); this.addEventListener('ended', () => live.delete(this)); return st.apply(this, a); };
});
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); const wait = (ms) => page.waitForTimeout(ms); const T = (f, a) => page.evaluate(f, a);
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?ahead=0#rack`); await page.waitForSelector('#list li[data-id]', { timeout: 60000 }); await page.waitForFunction(() => window.strudelCraft.timeline, null, { timeout: 30000 });
await T(async ([a, b]) => { const sc = window.__sc; const rs = sc.S.filtered.slice(0, 2); for (const r of rs) await sc.hydrate(r); sc.S.edits[rs[0].id] = a; sc.S.edits[rs[1].id] = b; sc.select(0, { audition: false }); }, [A, B]);
const start = async () => { await T(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 }); await wait(2500); };
await start(); await T(() => window.__sc.stop()); await T(async () => { const c = window.__sc.Bus.ctx, t = c.currentTime + 4; while (c.currentTime < t) await new Promise((r) => setTimeout(r, 100)); }); const base = await T(() => window.__live.size); /* engine-lifetime sources (orbit helpers) after one play/stop */
await T(() => window.__sc.select(0, { audition: false })); await start();
const live0 = await T(() => window.__live.size);
// energy at 220 Hz (voice A) vs 659 Hz (voice B) on the master analyser
const probe = () => T(async () => { const B = window.__sc.Bus; const an = B.an; const f = new Float32Array(an.frequencyBinCount); const sr = B.ctx.sampleRate, bin = (hz) => Math.round(hz / (sr / 2) * an.frequencyBinCount); let a = -200, b = -200; const t0 = performance.now(); while (performance.now() - t0 < 400) { an.getFloatFrequencyData(f); a = Math.max(a, f[bin(220)]); b = Math.max(b, f[bin(659)]); await new Promise((r) => setTimeout(r, 20)); } return { a, b }; });
const pa = await probe(); check('A is audible before the switch (220 Hz > -70 dB)', pa.a > -70, JSON.stringify(pa));
// switch mid-note; record every hap the scheduler triggers after the switch
await T(() => { const bg = window.strudelCraft.bg; bg.trace = true; window.__sw = window.__sc.Bus.ctx.currentTime; window.__sc.select(1); });
await wait(700);
const trig = await T(() => (window.strudelCraft.bg.trace || []).map((x) => x[2])); const pb = await probe(); await wait(3500); const pb2 = await probe(); check('B sounds after the switch (659 Hz > -70 dB)', pb2.b > -70, JSON.stringify(pb2));
check('event level: no recipe A hap is triggered after the switch', trig.length > 0 && !trig.some((x) => /sine/.test(x)), trig.length + ' haps: ' + [...new Set(trig)].join(' | '));
check('audio level: A energy at 220 Hz 31+ dB under its pre-switch level 0.7 s after the switch (< -55 dB)', pb.a < -55, JSON.stringify(pb));
const ln = await T(() => window.strudelCraft.timeline.state().lanes); check('timeline lanes hold only the new recipe (triangle, not sine)', ln.includes('triangle') && !ln.includes('sine'), ln.join(','));
const rects = await T(() => window.strudelCraft.timeline.rects().map((r) => r.lane)); check('timeline rects only from the new recipe', rects.length > 0 && rects.every((l) => l === 'triangle'), [...new Set(rects)].join(','));
// leak check: N switches
const N = 12; for (let i = 0; i < N; i++) { await T((k) => window.__sc.select(k % 2 ? 0 : 1), i); await wait(350); }
await wait(1500); const liveN = await T(() => window.__live.size);
check(`source-node count after ${N} switches stays near the single-recipe baseline`, liveN <= live0 + 6, `${live0} -> ${liveN}`);

await T(() => window.__sc.stop()); await T(async () => { const c = window.__sc.Bus.ctx, t = c.currentTime + 4; while (c.currentTime < t) await new Promise((r) => setTimeout(r, 100)); }); const liveS = await T(() => window.__live.size);
check(`source-node count after ${N} switches and stop equals the one-play baseline`, liveS <= base, `baseline ${base}, after ${liveS}`);
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
