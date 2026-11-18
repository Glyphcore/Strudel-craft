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
/* Regression (found after #199, precomputed playback): a chunk was rendered from the code of the recipe just chosen while the scheduler still held the previous recipe's pattern
   (between the choice and the evaluation: engine prepare, sample banks). Its audio was stored under the previous recipe's chunk hash, so that recipe later played the other
   recipe's sound from its buffer, for good. Buffer mode, 390x844, real clicks on the recipe rows. A2 = 220 Hz with a slow gain ramp (every chunk has its own hash), B = 659 Hz.
   The gap is made long the way a sample recipe does it (Engine.prepare delayed by 700 ms) and a chunk is made missing (the precompute window grows right before the click). */
{ const A2 = 'setcpm(120/4)\nvoiceA: note("a3*4").s("sine").release(0.2).gain(saw.range(0.2, 0.4).slow(64))\n';
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); await c2.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  const p2 = await c2.newPage(); p2.on('pageerror', (e) => errors.push('390: ' + e.message)); const T2 = (f, a) => p2.evaluate(f, a), w2 = (ms) => p2.waitForTimeout(ms);
  await p2.goto(`http://127.0.0.1:${server.address().port}/index.html?ahead=12#rack`); await p2.waitForSelector('#list li[data-id]', { timeout: 60000 }); await p2.waitForFunction(() => window.strudelCraft.timeline && window.strudelCraft.ahead, null, { timeout: 30000 });
  await T2(async ([a, b]) => { const sc = window.__sc; const rs = sc.S.filtered.slice(0, 2); for (const r of rs) await sc.hydrate(r); sc.S.edits[rs[0].id] = a; sc.S.edits[rs[1].id] = b; sc.select(0, { audition: false }); }, [A2, B]);
  const tapRow = async (i) => { const r = p2.locator('#list li[data-id]').nth(i).locator('.row'); await r.evaluate((el) => el.scrollIntoView({ block: 'center' })); await r.click({ position: { x: 24, y: 12 } }); };
  const playing = () => p2.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && !window.__sc.S.busy, null, { timeout: 60000 });
  await p2.click('#playBtn'); await playing(); await p2.waitForFunction(() => { const a = window.strudelCraft.ahead.state(); return a.source === 'buffer' && a.rendering == null && a.renderN === a.renderM; }, null, { timeout: 90000 }).catch(() => {});
  await T2(async () => { const B = window.__sc.Bus, c = B.ctx; window.__tap = [];
    const js = `class P extends AudioWorkletProcessor{constructor(){super();this.B=2048;this.b=new Float32Array(this.B);this.n=0;this.f0=-1}process(i){const c=i[0],l=c&&c[0],r=(c&&c[1])||l;if(this.f0<0)this.f0=currentFrame;for(let k=0;k<128;k++)this.b[this.n++]=l?(l[k]+r[k])*0.5:0;if(this.n>=this.B){this.port.postMessage({f0:this.f0,b:this.b},[this.b.buffer]);this.b=new Float32Array(this.B);this.n=0;this.f0=-1}return true}}registerProcessor('sc-rs-tap',P)`;
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([js], { type: 'application/javascript' }))); const w = new AudioWorkletNode(c, 'sc-rs-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' }); w.port.onmessage = (e) => window.__tap.push(e.data); B.gain.connect(w); window.__tapNode = w;
    const E = window.__sc.Engine, p0 = E.prepare.bind(E); E.prepare = async (...a) => { await new Promise((r) => setTimeout(r, 700)); return p0(...a); }; });
  /* level of 220 Hz and 659 Hz over audio-clock seconds [a, b): max over 50 ms windows, dBFS of the sine amplitude */
  const tone = (a, b) => T2(([a, b]) => { const sr = window.__sc.Bus.ctx.sampleRate, fa = Math.round(a * sr), fb = Math.round(b * sr), x = new Float32Array(Math.max(0, fb - fa)); for (const c of window.__tap) { const s0 = Math.max(fa, c.f0), s1 = Math.min(fb, c.f0 + c.b.length); if (s1 > s0) x.set(c.b.subarray(s0 - c.f0, s1 - c.f0), s0 - fa); }
    const w = Math.round(0.05 * sr), lv = (hz) => { let m = -200; for (let o = 0; o + w <= x.length; o += w) { let re = 0, im = 0; for (let n = o; n < o + w; n++) { const p = 2 * Math.PI * hz * n / sr; re += x[n] * Math.cos(p); im += x[n] * Math.sin(p); } m = Math.max(m, 10 * Math.log10(4 * (re * re + im * im) / (w * w) + 1e-12)); } return +m.toFixed(1); }; return { a: lv(220), b: lv(659.26) }; }, [a, b]);
  const now2 = () => T2(() => window.__sc.Bus.ctx.currentTime);
  const hashesA = await T2(() => window.strudelCraft.ahead.chunks().filter((c) => c.st === 'ready').map((c) => c.hash));
  /* the window grows (chunks of A are missing now) and recipe B is chosen by a click while A plays */
  await T2(() => { window.strudelCraft.ahead.configure({ lead: 28, persist: false }); }); await tapRow(1); await w2(650);
  const gap = await T2(() => { const a = window.strudelCraft.ahead.state(); return { rendering: a.rendering, refused: a.rendersRefused || 0, src: (window.strudelCraft.transport.source() || {}).code.slice(14, 20) }; });
  await playing(); await w2(4500); const tB = await now2(), qB = await tone(tB - 3, tB - 0.2), sB = await T2(() => window.strudelCraft.ahead.state().source);
  check('390 px, buffer mode: a click on recipe B while A plays: B sounds (659 Hz), A is gone (220 Hz < -50 dBFS)', qB.b > -40 && qB.a < -50, `over 2.8 s: ${JSON.stringify(qB)}; source ${sB}; during the gap: chunk being rendered ${gap.rendering}, renders refused ${gap.refused}`);
  /* back to A by a click, Stop, Play: A starts at cycle 0 from its buffer; what plays there must be A. (Before the fix chunk 0 of A was rendered during the gap from B's code.) */
  await tapRow(0); await playing(); await w2(2500); await p2.click('#playBtn'); await w2(1200); /* Stop; the next Play of A starts on its chunk 0 buffer */
  await p2.click('#playBtn'); await playing(); await w2(3600); const tA = await now2(), qA = await tone(tA - 3, tA - 0.3);
  const back = await T2((known) => ({ src: window.strudelCraft.ahead.state().source, segs: window.strudelCraft.ahead.segments().filter((s) => s.i === 0).map((s) => s.mode).join(' > '), suspect: window.strudelCraft.ahead.chunks().filter((c) => c.st === 'ready' && !known.includes(c.hash)).map((c) => c.i) }), hashesA);
  check('390 px, buffer mode: back on recipe A, Play from its buffer: A sounds (220 Hz), B does not (659 Hz < -50 dBFS)', qA.a > -40 && qA.b < -50 && /buf/.test(back.segs), `first 3 s of A: ${JSON.stringify(qA)}; chunk 0: ${back.segs || 'no decision'}; source ${back.src}; chunks of A ready now that were not before the first switch: ${back.suspect.join() || 'none'}`);
  await T2(() => window.__sc.stop()); await c2.close(); }
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
