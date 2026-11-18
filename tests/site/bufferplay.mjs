/* Playback from the render-ahead buffers (#199, site/renderahead.js "playback from the buffers", bgplay.js clock hooks, app.js Bus.live / Bus.buf).
   Audio is read from two AudioWorklet taps (audio thread, so a blocked main thread loses nothing): the master gain and the live sub-bus.
   1. a ready chunk is heard from the buffer, its live voices are silent (level on the live sub-bus)
   2. buffer vs live of the same bars: level per 100 ms window, null residual of one bar, largest sample step at the chunk joins
   3. edit while playing: the dirty chunk goes live, the others stay on the buffer; longest gap on the master, sample step at the hand-overs
   4. seek, loop wrap, tempo change: onset times on the master against the scheduler's own targets (ms)
   5. recipe switch (Engine.cut) and Stop drop the buffer sources; Play starts on the buffer again
   6. stress program, CPU throttle x4, main thread blocked in bursts: underruns / dropouts, live path vs buffer path
   8. the default: module loads at the first Play, whole program precomputed, next Play from the buffer
   9. hypothesis test: main thread blocked 0.5 / 1 / 2 s and page hidden, buffer path vs live scheduler: gaps, position
   7. (--lead) lead study under CPU throttle x4 from a cold start: fill time, render speed, share of play on the buffer, cost on the live path
   Writes docs/screens/bufferplay.json. Usage (repo root): node tests/site/bufferplay.mjs [--lead]   (wrap in engine/load/gate.sh heavy) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { features, highpass, compare } from './lib/glitch.mjs';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site'); const LEADSTUDY = process.argv.includes('--lead');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = []; const out = {}; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const LEAD = 16; const ONLY = process.env.BP_ONLY ? new Set(process.env.BP_ONLY.split(',')) : null, RUN = (k) => !ONLY || ONLY.has(k); /* BP_ONLY=A,B,C,D,F,E: sections 1-3, 4, 5, 6-7, 9, 8 (debugging) */
/* 0.5 cps: chunks of 2 cycles (4 s), pre-roll 1 cycle. Bass: 8 legato hits per cycle (continuous level); tick: one 4186 Hz blip per cycle (onset timing). The edit changes cycle 3. */
const PA = (n3, cpm = 120) => `setcpm(${cpm}/4)\nbass: note("<c2 d2 eb2 ${n3} g2 ab2 bb2 c3>").struct("x*8").s("sawtooth").lpf(700).gain(0.2)\ntick: s("sine").note("c8").decay(0.03).sustain(0).gain(0.2)\n`;
const STRESS = (g = '0.03') => ['setcpm(140/4)', `a: s("sawtooth*16").note("<c2 eb2 g2 bb2>").lpf(sine.range(300, 3000).slow(4)).room(0.4).gain(${g})`, 'b: note("c4 eb4 g4 bb4 c5 bb4 g4 eb4").fast(2).s("triangle").delay(0.4).room(0.5).gain(0.03)',
  'c: s("square*8").note("c3").decay(0.05).gain(0.02)', 'd: s("white*16").decay(0.03).hpf(6000).gain(0.02)', 'e: note("<[c3,eb3,g3] [bb2,d3,f3]>").s("sawtooth").room(0.6).lpf(1200).gain(0.02)', 'f: s("sine*4").note("c1").decay(0.2).gain(0.05)', ''].join('\n');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
/* hidden tab (as tests/site/background.mjs): document.hidden / visibilitychange and Chrome's 1 s floor on main-thread timers; worker timers and the audio thread are not throttled */
await ctx.addInitScript(() => { window.__hidden = false; Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden }); Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
  const si = window.setInterval.bind(window), st = window.setTimeout.bind(window); window.setInterval = (fn, ms, ...a) => { let last = 0; return si(() => { if (window.__hidden) { const n = performance.now(); if (n - last < 1000) return; last = n; } typeof fn === 'function' ? fn(...a) : 0; }, ms); };
  window.setTimeout = (fn, ms, ...a) => st(fn, window.__hidden ? Math.max(ms || 0, 1000) : ms, ...a); window.__setHidden = (h) => { window.__hidden = h; document.dispatchEvent(new Event('visibilitychange')); }; });
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); const wait = (ms) => page.waitForTimeout(ms); const cdp = await ctx.newCDPSession(page);
const T = (f, a) => page.evaluate(f, a); const ah = () => T(() => window.strudelCraft.ahead.state());
const setCode = (c) => T((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, c);
const started = () => page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 });
const stop = async () => { await T(() => window.__sc.stop()); await wait(350); await T(() => { const t = window.strudelCraft.timeline; t.setMode('off'); t.seek(0); }); };
const readyTo = (n, ms = 240000) => page.waitForFunction((n) => { const s = window.strudelCraft.ahead.state(); for (let i = 0; i < n; i++) if (!s.ready.includes(i)) return false; return true; }, n, { timeout: ms }).catch(() => {});
/* one run: trace on, play, body(), then state + trace + decisions + clock stats, stop */
async function run(body, o = {}) {
  await T(() => { window.strudelCraft.ahead.reset(); window.strudelCraft.bg.trace = true; window.__tap.m.length = 0; window.__tap.l.length = 0; }); const b0 = await T(() => window.strudelCraft.bg.stats());
  await T(() => window.__sc.play()); await started(); const mid = await body(); const st = await ah(); const b1 = await T(() => window.strudelCraft.bg.stats());
  const tStop = await T(() => window.__sc.Bus.ctx.currentTime); if (!o.keep) await stop(); else await wait(100);
  const trace = await T(() => window.strudelCraft.bg.trace.slice()), segs = await T(() => window.strudelCraft.ahead.segments()), anchors = await T(() => window.strudelCraft.ahead.anchors()), tEnd = tStop;
  return { mid, st, trace, segs, anchors, tEnd, skippedQueries: (b1.skippedQueries || 0) - (b0.skippedQueries || 0), bg: { lateTicks: b1.lateTicks - b0.lateTicks, underruns: b1.underruns - b0.underruns, covered: (b1.bufferCovered || 0) - (b0.bufferCovered || 0), pausedSec: b1.pausedSec, maxGapMs: b1.maxGapMs, lateHaps: b1.perf.lateHaps, gatedHaps: b1.perf.gatedHaps, haps: b1.perf.haps } };
}
/* mono PCM of a tap over audio-clock seconds [a, b) */
async function grab(name, a, b) {
  const s = await T(([name, a, b]) => { const sr = window.__sc.Bus.ctx.sampleRate, fa = Math.round(a * sr), fb = Math.round(b * sr), o = new Float32Array(Math.max(0, fb - fa)); let got = 0;
    for (const c of window.__tap[name]) { const s0 = Math.max(fa, c.f0), s1 = Math.min(fb, c.f0 + c.b.length); if (s1 > s0) { o.set(c.b.subarray(s0 - c.f0, s1 - c.f0), s0 - fa); got += s1 - s0; } }
    const u = new Uint8Array(o.buffer); let bin = ''; for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return { b64: btoa(bin), sr, got, n: o.length }; }, [name, a, b]);
  const buf = Buffer.from(s.b64, 'base64'); return { x: new Float32Array(buf.buffer, buf.byteOffset, buf.length >> 2).slice(), sr: s.sr, cover: s.n ? s.got / s.n : 0 };
}
const db = (v) => 10 * Math.log10(v + 1e-12);
const rmsDb = (x) => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return db(e / Math.max(1, x.length)); };
const maxStep = (x, sr, t, w = 0.03) => { let m = 0; const a = Math.max(1, Math.round((t - w) * sr)), b = Math.min(x.length, Math.round((t + w) * sr)); for (let i = a; i < b; i++) { const d = Math.abs(x[i] - x[i - 1]); if (d > m) m = d; } return m; };
const longestGapMs = (x, sr, floorDb = -50) => { const F = features(x, sr); let run = 0, best = 0; for (let k = 0; k < F.n; k++) { if (F.env[k] < floorDb) { run++; if (run > best) best = run; } else run = 0; } return best * 5; };
/* Where each tick (one per whole cycle) must sound, from position arithmetic alone: the cycle -> audio time mappings the clock used (ahead.anchors(): { from, tA, cps }; a new one per
   Play, seek, loop wrap, tempo change or re-anchor), not from scheduled events: buffer-played windows are not queried at all, so they have no events. A tick is "live" when the
   scheduler traced a triggered voice for it; otherwise it can only have come from a buffer. */
const ticks = (R) => { const A = R.anchors, o = []; for (let k = 0; k < A.length; k++) { const a = A[k], end = k + 1 < A.length ? A[k + 1].tA : R.tEnd - 0.1; for (let c = Math.ceil(a.from - 1e-6); ; c++) { const t = a.tA + (c - a.from) / a.cps; if (t >= end - 1e-4) break; o.push({ c, t, buf: !R.trace.some((h) => /c8/.test(h[2] || '') && h[3] === 0 && Math.abs(h[1] - t) < 0.005) }); } } return o; };
const tOfCycle = (R, c) => { const h = ticks(R).find((u) => u.c === c); return h ? h.t : null; };
/* measured onset of each tick on the master (4th-order high-pass at 3 kHz, first sample over 30 % of the blip's peak) minus its target, ms */
function tickErrors(tk, take, t0) {
  const hp = highpass(take.x, take.sr, 3000), res = [];
  for (const h of tk) { const a = Math.round((h.t - t0 - 0.04) * take.sr), b = Math.round((h.t - t0 + 0.04) * take.sr); if (a < 0 || b > hp.length) continue; let pk = 0; for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(hp[i]));
    if (pk < 1e-3) { res.push({ ...h, err: null }); continue; } let j = a; while (j < b && Math.abs(hp[j]) < 0.3 * pk) j++; res.push({ ...h, err: +(((j / take.sr) + t0 - h.t) * 1000).toFixed(2) }); }
  return res;
}
const worst = (es) => es.reduce((m, e) => (e.err == null ? Infinity : Math.max(m, Math.abs(e.err))), 0);

await page.goto(`http://127.0.0.1:${server.address().port}/index.html?ahead=${LEAD}#rack`); await page.waitForSelector('#list li[data-id]', { timeout: 60000 }); await page.waitForFunction(() => window.strudelCraft.timeline && window.strudelCraft.bg && window.strudelCraft.capture && window.strudelCraft.ahead, null, { timeout: 30000 });
await setCode(PA('f2')); await wait(500); await T(() => window.__sc.play()); await started(); await wait(600); await stop();
/* taps (audio thread): master gain and live sub-bus */
await T(async () => {
  const B = window.__sc.Bus, c = B.ctx; window.__tap = { m: [], l: [] };
  const js = `class P extends AudioWorkletProcessor{constructor(){super();this.B=4096;this.b=new Float32Array(this.B);this.n=0;this.f0=-1}process(i){const c=i[0],l=c&&c[0],r=(c&&c[1])||l;if(this.f0<0)this.f0=currentFrame;for(let k=0;k<128;k++)this.b[this.n++]=l?(l[k]+r[k])*0.5:0;if(this.n>=this.B){this.port.postMessage({f0:this.f0,b:this.b},[this.b.buffer]);this.b=new Float32Array(this.B);this.n=0;this.f0=-1}return true}}registerProcessor('sc-test-tap',P)`;
  await c.audioWorklet.addModule(URL.createObjectURL(new Blob([js], { type: 'application/javascript' })));
  const mk = (node, key) => { const w = new AudioWorkletNode(c, 'sc-test-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' }); w.port.onmessage = (e) => { window.__tap[key].push(e.data); }; node.connect(w); (window.__tapNodes = window.__tapNodes || []).push(w); };
  mk(B.gain, 'm'); mk(B.live, 'l');
});
check('Bus: live and buffer sub-buses feed the master gain', await T(() => { const b = window.strudelCraft.transport.bus; return !!(b && b.live && b.buf && b.node && b.live !== b.node); }));
await readyTo(4); let a = await ah();
check(`precompute while stopped: chunks 0-3 ready (lead ${LEAD} s)`, [0, 1, 2, 3].every((i) => a.ready.includes(i)), `ready ${a.ready.join()}, chunk ${a.chunkSec} s, renders at ${a.speed}x, error "${a.error}"`);

/* 1 + 2: buffer run, then the same bars live */
if (RUN('A')) {
const RB = await run(async () => { await wait(5000); const s = await ah(); await wait(4200); return s; });
const tb0 = tOfCycle(RB, 0), tb4 = tOfCycle(RB, 4); const mB = await grab('m', tb0, tb0 + 8.5), lB = await grab('l', tb0, tb0 + 8.5);
const liveB = RB.trace.filter((h) => h[3] === 0).length, liveDb = rmsDb(lB.x.subarray(Math.round(0.2 * lB.sr), Math.round(7.8 * lB.sr))), masterDb = rmsDb(mB.x.subarray(Math.round(0.2 * mB.sr), Math.round(7.8 * mB.sr)));
check('1. a ready chunk is heard from the buffer: state() reports buffer-played seconds, source buffer', RB.st.bufSec > 7 && RB.mid.source === 'buffer' && mB.cover > 0.999, `bufSec ${RB.st.bufSec}, source mid-play "${RB.mid.source}", buffer sources started ${RB.st.bufSegs}, tap cover ${mB.cover.toFixed(4)}`);
check('1. the live voices of buffered chunks are silent (live sub-bus level) while the master carries the program', liveDb < -90 && masterDb > -45 && liveB === 0 && RB.skippedQueries > 100, `live sub-bus ${liveDb.toFixed(1)} dBFS, master ${masterDb.toFixed(1)} dBFS over cycles 0.1-3.9; voices triggered by the scheduler ${liveB}; clock windows advanced without a pattern query ${RB.skippedQueries}`);
await T(() => window.strudelCraft.ahead.configure({ play: false, persist: false }));
const RL = await run(async () => { await wait(9200); }); await T(() => window.strudelCraft.ahead.configure({ play: true, persist: false }));
const tl0 = tOfCycle(RL, 0); const mL = await grab('m', tl0, tl0 + 8.5);
check('2. control run with buffer play off is all live', RL.st.bufSec === 0 && RL.trace.every((h) => h[3] === 0), `bufSec ${RL.st.bufSec}, why "${RL.st.why}"`);
{ const FB = features(mB.x, mB.sr), FL = features(mL.x, mL.sr), W = 20, diffs = []; /* 100 ms windows = 20 hops of 5 ms, mean energy */
  for (let k = 0; k + W <= Math.min(FB.n, FL.n, 1600); k += W) { let eb = 0, el = 0; for (let i = k; i < k + W; i++) { eb += Math.pow(10, FB.env[i] / 10); el += Math.pow(10, FL.env[i] / 10); } const dl = db(el / W), dbb = db(eb / W); if (dl > -50) diffs.push(Math.abs(dbb - dl)); }
  const mx = Math.max(...diffs), med = diffs.slice().sort((x, y) => x - y)[diffs.length >> 1];
  out.level = { windows: diffs.length, maxDb: +mx.toFixed(2), medianDb: +med.toFixed(3) };
  check('2. buffer vs live, same bars: level within 1.5 dB per 100 ms window', diffs.length >= 70 && mx <= 1.5, `${diffs.length} windows over cycles 0-4: max ${mx.toFixed(2)} dB, median ${med.toFixed(3)} dB`);
  /* null test of one bar (cycle 1): best integer lag within +-64 samples */
  const sr = mB.sr, n = Math.round(2 * sr), ob = Math.round(2 * sr), ol = Math.round(2 * sr); let best = Infinity, lag = 0, ref = 0; for (let i = 0; i < n; i++) ref += mL.x[ol + i] ** 2;
  for (let g = -64; g <= 64; g++) { let e = 0; for (let i = 0; i < n; i += 4) { const d = mB.x[ob + i + g] - mL.x[ol + i]; e += d * d; } if (e < best) { best = e; lag = g; } }
  let e = 0; for (let i = 0; i < n; i++) { const d = mB.x[ob + i + lag] - mL.x[ol + i]; e += d * d; } const nul = db(e / ref);
  out.null = { bar: 'cycle 1', residualDb: +nul.toFixed(1), lagSamples: lag };
  check('2. null test of one bar, buffer minus live', nul < -20, `residual ${nul.toFixed(1)} dB relative to the live bar at lag ${lag} samples (${(lag / sr * 1000).toFixed(2)} ms)`);
  const joins = [2, 4].map((c) => ({ c, buf: maxStep(mB.x, sr, c * 2), live: maxStep(mL.x, sr, c * 2) })); out.joins = joins.map((j) => ({ cycle: j.c, bufferStep: +j.buf.toFixed(4), liveStep: +j.live.toFixed(4) }));
  check('2. no click at the chunk joins (largest sample step < 0.1)', joins.every((j) => j.buf < 0.1), joins.map((j) => `cycle ${j.c}: buffer ${j.buf.toFixed(4)}, live ${j.live.toFixed(4)}`).join('; '));
  const eb = tickErrors(ticks(RB).filter((h) => h.c < 4), mB, tb0), el = tickErrors(ticks(RL).filter((h) => h.c < 4), mL, tl0); out.onset = { bufferMs: eb.map((x) => x.err), liveMs: el.map((x) => x.err) };
  check('playhead alignment in steady play: tick onsets on the master against the scheduler targets', worst(eb) < 10 && eb.every((x) => x.buf), `buffer ${eb.map((x) => x.err).join(', ')} ms; live ${el.map((x) => x.err).join(', ')} ms`);
  void tb4; }

/* 3: edit while playing. 1 cps here: chunks of 4 cycles (4 s), so a chunk has bar lines inside it. Cycle 3 changes (f2 -> a2) while chunk 0 is sounding:
   the old buffer keeps playing (no live fallback), the new render is spliced in at a bar line with a 20 ms cross-fade. */
await setCode(PA('f2', 240)); await wait(900); await readyTo(2);
const RE = await run(async () => { await page.waitForFunction(() => window.__sc.Engine.scheduler.now() >= 0.25, null, { timeout: 30000 }); await setCode(PA('a2', 240)); await page.waitForFunction(() => window.__sc.Engine.scheduler.now() >= 8.3, null, { timeout: 40000 }); });
{ const t0 = tOfCycle(RE, 0), m = await grab('m', t0, t0 + 8), sr = m.sr; const by = (i) => RE.segs.filter((s) => s.i === i).map((s) => s.mode + (s.from != null && s.mode === 'spliced' ? '@' + s.from : '')).join(' > ');
  const liveN = RE.trace.filter((h) => h[3] === 0).length, sp = RE.segs.filter((s) => s.mode === 'spliced'), sp0 = sp.find((s) => s.i === 0), tSp = sp0 ? sp0.tS - t0 : 0;
  const gap = longestGapMs(m.x.subarray(Math.round(0.1 * sr), Math.round(7.9 * sr)), sr), gapL = longestGapMs(mL.x.subarray(Math.round(0.1 * sr), Math.round(8 * sr)), sr), step = sp0 ? maxStep(m.x, sr, tSp) : 0;
  const tone = (hz, a, b) => { let re = 0, im = 0; const n0 = Math.round(a * sr), n1 = Math.round(b * sr); for (let n = n0; n < n1; n++) { const w = 2 * Math.PI * hz * n / sr; re += m.x[n] * Math.cos(w); im += m.x[n] * Math.sin(w); } return db((re * re + im * im) / ((n1 - n0) ** 2)); };
  const newDb = tone(110, 3.3, 3.95), oldDb = tone(87.31, 3.3, 3.95), before = tone(110, 1.3, 1.95);
  out.edit = { chunks: [0, 1].map((i) => ({ i, path: by(i) })), liveHaps: liveN, splices: RE.st.splices, splicedAtCycle: sp0 ? sp0.from : null, oldAudioHeldSec: +RE.st.staleSec.toFixed(2), longestGapMs: gap, liveControlGapMs: gapL, stepAtSplice: +step.toFixed(4), cycle3: { a2Db: +newDb.toFixed(1), f2Db: +oldDb.toFixed(1) } };
  check('3. edit while playing: the old buffer keeps playing (no live fallback), only the dirty chunks render again', liveN === 0 && /^buf > stale/.test(by(0)) && RE.st.released === 0, `chunk 0: ${by(0)}; chunk 1: ${by(1)}; live haps ${liveN}; released to live ${RE.st.released}; renders ${RE.st.renders}`);
  check('3. the new render is spliced in at a bar line and is what is heard after it', !!sp0 && Number.isInteger(sp0.from) && sp0.from >= 2 && sp0.from <= 3 && newDb > oldDb + 10 && newDb > before + 10, `spliced at cycle ${sp0 && sp0.from} (${tSp.toFixed(3)} s), old audio held ${RE.st.staleSec.toFixed(2)} s; cycle 3: 110 Hz (new a2) ${newDb.toFixed(1)} dB, 87.3 Hz (old f2) ${oldDb.toFixed(1)} dB, 110 Hz in cycle 1 ${before.toFixed(1)} dB`);
  check('3. no gap > 20 ms on the master across the edit; no click at the splice (sample step < 0.1)', gap <= 20 && step < 0.1, `longest run below -50 dBFS: ${gap} ms (all-live control ${gapL} ms); largest step at the splice ${step.toFixed(4)}`); }
await setCode(PA('f2')); await wait(900); await readyTo(4);
}

/* 4: seek, loop wrap, tempo change */
if (RUN('B')) {
const RS = await run(async () => {
  await page.waitForFunction(() => window.__sc.Engine.scheduler.now() >= 1.4, null, { timeout: 30000 }); await T(() => window.strudelCraft.timeline.seek(4)); await wait(2600);
  await T(() => { const r = window.strudelCraft.range.state; r.start = 4; r.end = 6; r.loop = true; }); await wait(7500); await T(() => { const r = window.strudelCraft.range.state; r.loop = false; r.start = 0; r.end = 16; }); const s = await ah(); return s; });
{ const all = ticks(RS), t0 = all[0].t, m = await grab('m', t0, t0 + 13), es = tickErrors(all, m, t0), seq = es.map((x) => x.c), iSeek = seq.findIndex((c, i) => i > 0 && c === 4 && seq[i - 1] < 4), wraps = seq.filter((c, i) => i > iSeek && c === 4).length;
  const after = es.slice(iSeek), w = worst(after); out.seekLoop = { cycles: seq, errMs: es.map((x) => x.err), buffered: es.map((x) => x.buf), resyncs: RS.st.resyncs, bufUnderruns: RS.st.bufUnderruns };
  check('4. seek while playing (#207: cut, clean live start in the chunk it lands in): the new position is aligned with the clock (< 10 ms)', iSeek > 0 && !after[0].buf && Math.abs(after[0].err) < 10, `tick cycles ${seq.join()} (seek at index ${iSeek}); first tick after the seek ${after[0] && after[0].err} ms, from the buffer: ${after[0] && after[0].buf}`);
  const iWrap = es.findIndex((x, i) => i > iSeek && x.c === 4), looped = es.slice(iWrap);
  check('4. loop wrap while playing: every wrap plays from the buffer and stays aligned (< 10 ms)', wraps >= 2 && looped.length >= 3 && looped.every((x) => x.buf) && w < 10, `${wraps} wraps to cycle 4; worst |onset - target| ${w} ms over ${after.length} ticks (${after.map((x) => x.err).join(', ')}); resyncs ${RS.st.resyncs}, buffer underruns ${RS.st.bufUnderruns}`); }
const RT = await run(async () => { await page.waitForFunction(() => window.__sc.Engine.scheduler.now() >= 1.3, null, { timeout: 30000 }); await setCode(PA('f2', 150));
  await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return Math.abs(s.cps - 0.625) < 1e-6 && s.source === 'buffer'; }, null, { timeout: 120000 }).catch(() => {}); await wait(5200); return ah(); });
{ const all = ticks(RT), t0 = all[0].t, tEnd = all[all.length - 1].t, m = await grab('m', t0, tEnd + 0.2), es = tickErrors(all, m, t0), fastBuf = es.filter((x, i) => i > 0 && x.buf && Math.abs((x.t - es[i - 1].t) - 1.6) < 0.01), w = worst(fastBuf), wl = worst(es.filter((x) => !x.buf));
  if (process.env.BP_DEBUG) console.log('DBG', JSON.stringify({ anchors: RT.anchors, tEnd: RT.tEnd, c8: RT.trace.filter((h) => /c8/.test(h[2] || '')).map((h) => [h[0], h[1], h[3]]), segs: RT.segs.map((x) => [x.i, x.mode, x.from, x.tS, x.why]) }));
  out.tempo = { cps: RT.mid.cps, bufferedTicksAtNewTempo: fastBuf.length, worstMs: w, worstLiveMs: wl, errMs: es.map((x) => x.err), buffered: es.map((x) => x.buf) };
  check('4. tempo change while playing: live at once, back on the buffer at the new tempo, aligned (< 10 ms)', RT.mid.source === 'buffer' && fastBuf.length >= 2 && w < 10 && es.some((x) => !x.buf), `cps ${RT.mid.cps}; ${fastBuf.length} buffered ticks 1.6 s apart, worst ${w} ms; live ticks in between worst ${wl} ms; ticks (cycle:source:err ms): ${es.map((x) => x.c + ':' + (x.buf ? 'b' : 'l') + ':' + x.err).join(' ')}`); }
await setCode(PA('f2')); await wait(900); await readyTo(4);
}

/* 5: Stop and the recipe switch (Engine.cut, #196) drop the buffer sources; Play starts on the buffer again */
if (RUN('C')) { await T(() => { window.strudelCraft.ahead.reset(); }); await T(() => window.__sc.play()); await started(); await wait(2500); const s0 = await ah(); await T(() => window.__sc.stop()); await wait(250); const s1 = await ah();
  await T(() => { window.__tap.m.length = 0; }); const t1 = await T(() => window.__sc.Bus.ctx.currentTime); await wait(600); const q = await grab('m', t1 + 0.1, t1 + 0.5);
  check('5. Stop drops the buffer sources (none left, master silent)', s0.bufSources > 0 && s0.source === 'buffer' && s1.bufSources === 0 && rmsDb(q.x) < -90, `sources ${s0.bufSources} -> ${s1.bufSources}; master ${rmsDb(q.x).toFixed(1)} dBFS 0.1-0.5 s after Stop`);
  await T(() => { const t = window.strudelCraft.timeline; t.seek(0); }); await T(() => window.__sc.play()); await started(); await wait(2500); const s2 = await ah();
  check('5. Play after Stop starts on the buffer again', s2.source === 'buffer' && s2.bufSec > s0.bufSec, `source "${s2.source}", bufSec ${s0.bufSec} -> ${s2.bufSec}`);
  const n0 = await T(() => window.__sc.S.sel); await T(() => { window.__tap.m.length = 0; }); await T(async () => { const sc = window.__sc; await sc.Engine.cut(); }); await wait(60); const s3 = await ah(); await wait(150); const t2 = await T(() => window.__sc.Bus.ctx.currentTime); await wait(500); const q2 = await grab('m', t2, t2 + 0.4);
  check('5. recipe switch: Engine.cut() drops the buffer playback sources', s2.bufSources > 0 && s3.bufSources === 0 && rmsDb(q2.x) < -90, `sources ${s2.bufSources} -> ${s3.bufSources} right after cut; master ${rmsDb(q2.x).toFixed(1)} dBFS after it (recipe index ${n0})`);
  await T(() => window.__sc.stop()); await wait(300);
  /* the real path: pick the next recipe while playing (select -> Engine.cut -> play) */
  await T(() => { const t = window.strudelCraft.timeline; t.seek(0); }); await T(() => window.__sc.play()); await started(); await wait(2200); const s4 = await ah(); await T(async () => { const sc = window.__sc; const r = sc.S.filtered[sc.S.sel + 1]; await sc.hydrate(r); sc.select(sc.S.sel + 1); }); await wait(120); const s5 = await ah();
  await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 }).catch(() => {}); await wait(1500); const s6 = await ah(); const pl = await T(() => window.__sc.S.playing);
  check('5. choosing another recipe mid-play: buffer sources gone at the cut, the new recipe plays', s4.source === 'buffer' && s5.bufSources === 0 && pl, `before "${s4.source}" (${s4.bufSources} sources); after select ${s5.bufSources} sources; 1.5 s later playing ${pl}, source "${s6.source}"${s6.why ? ' (' + s6.why + ')' : ''}`);
  await T(() => window.__sc.stop()); await wait(300); await T(() => { const sc = window.__sc; sc.select(sc.S.sel - 1, { audition: false }); }); await wait(400); }

/* 6: stress, CPU throttle x4, main thread blocked in bursts; reference = offline render of the same cycles */
if (RUN('D')) {
await setCode(STRESS()); await wait(900); await readyTo(5, 300000); a = await ah();
const refR = await T(async () => { const o = await window.strudelCraft.capture.renderRange(0, 8, { seed: 0x195a11 }); const n = o.L.length, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = 0.5 * (o.L[i] + (o.R || o.L)[i]); const u = new Uint8Array(m.buffer); let bin = ''; for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return { b64: btoa(bin), sr: o.sr }; });
const refBuf = Buffer.from(refR.b64, 'base64'), ref = { x: new Float32Array(refBuf.buffer, refBuf.byteOffset, refBuf.length >> 2).slice(), sr: refR.sr }; await readyTo(5, 300000);
let NORM = 0; for (let i = 0; i < ref.x.length; i++) NORM = Math.max(NORM, Math.abs(ref.x[i])); NORM = 0.5 / (NORM || 1); for (let i = 0; i < ref.x.length; i++) ref.x[i] *= NORM; /* the program is quiet: both sides are scaled by the same factor (reference peak at -6 dBFS) so the metric's -40 dBFS floors apply */
const BURSTS = [350, 900, 500, 1400, 700];
const stressRun = async (label, hidden = false) => {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const R = await run(async () => { if (hidden) await T(() => window.__setHidden(true)); await T((l) => { let i = 0; window.__bi = setInterval(() => { const d = l[i++ % l.length], t = performance.now(); while (performance.now() - t < d) { /* blocked */ } }, 2400); }, BURSTS); await wait(13200); await T(() => clearInterval(window.__bi)); const st = await ah(); if (hidden) await T(() => window.__setHidden(false)); return st; });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  /* Play re-seeks to the transport range Start right after the first tick (app behaviour, also live): the mapping in force is the last one made within 0.5 s of the start; a later one is a position jump */
  const a0 = R.anchors.filter((a) => a.tA < R.anchors[0].tA + 0.5).pop(), t0 = a0.tA - a0.from / a0.cps, jumps = R.anchors.filter((a) => a.tA >= R.anchors[0].tA + 0.5).length; let m = await grab('m', t0, t0 + 12.5); for (let i = 0; i < m.x.length; i++) m.x[i] *= NORM; const g = compare({ x: ref.x.subarray(0, Math.round(12.5 * ref.sr)), sr: ref.sr }, m);
  const liveHaps = R.trace.filter((h) => h[3] === 0).length;
  const o = { label, clock: R.bg, resyncs: R.st.resyncs, released: R.st.released, segs: R.segs, bufferSec: R.st.bufSec, bufUnderruns: R.st.bufUnderruns, lateStarts: R.segs.filter((s) => s.late > 0).map((s) => ({ chunk: s.i, lateMs: Math.round(s.late * 1000) })), liveDecisions: R.segs.filter((s) => s.mode !== 'buf').map((s) => s.i + ':' + s.mode + ':' + s.why), liveHaps, positionJumps: jumps, skippedQueries: R.skippedQueries, audio: { refOnsets: g.refOnsets, matched: g.matched, missingOnsets: g.missingOnsets, dropouts: g.dropouts, dropoutMs: g.dropoutMs, clicks: g.clicks, lagMs: g.lagMs, levelWithin3dB50ms: g.levelWithin3dB50ms, driftMsPerS: g.driftMsPerS, tapCover: +m.cover.toFixed(4) } };
  return o;
};
const SB = await stressRun('buffer'); await wait(500); await readyTo(5, 300000);
await T(() => window.strudelCraft.ahead.configure({ play: false, persist: false })); const SL = await stressRun('live'); await T(() => window.strudelCraft.ahead.configure({ play: true, persist: false }));
await wait(500); await readyTo(5, 300000); const HB = await stressRun('buffer, hidden tab', true); await wait(500);
await T(() => window.strudelCraft.ahead.configure({ play: false, persist: false })); const HL = await stressRun('live, hidden tab', true); await T(() => window.strudelCraft.ahead.configure({ play: true, persist: false }));
const row = (o) => `position jumps ${o.positionJumps}, late ticks ${o.clock.lateTicks}, clock underruns ${o.clock.underruns}, paused ${o.clock.pausedSec} s, late haps ${o.clock.lateHaps}, buffer underruns ${o.bufUnderruns}; audio vs reference: onsets matched ${o.audio.matched}/${o.audio.refOnsets}, dropouts ${o.audio.dropouts} (${o.audio.dropoutMs} ms), 50 ms level blocks within 3 dB ${o.audio.levelWithin3dB50ms}`;
check('6. hypothesis, hidden tab (1 s timers) + throttle x4 + bursts: live vs pre-rendered buffer (reported either way)', HB.bufUnderruns === 0 && HB.audio.dropouts === 0 && HB.liveHaps === 0 && HB.positionJumps === 0, `LIVE: ${row(HL)} || BUFFER: ${row(HB)}`);
out.stress = { hidden: { buffer: HB, live: HL }, program: 'stress: 6 layers, 16ths, reverb + delay, 140 bpm', cpuThrottle: 4, mainThreadBlocksMs: BURSTS, every: 2400, seconds: 12.5, buffer: SB, live: SL };
check('6. throttle x4 + blocked main thread: the live path reports late ticks and underruns', SL.clock.lateTicks > 0 && SL.clock.underruns > 0, `live: late ticks ${SL.clock.lateTicks}, underruns (re-anchors) ${SL.clock.underruns}, paused ${SL.clock.pausedSec} s, late haps ${SL.clock.lateHaps}; audio vs reference: onsets matched ${SL.audio.matched}/${SL.audio.refOnsets}, dropouts ${SL.audio.dropouts} (${SL.audio.dropoutMs} ms), 50 ms level blocks within 3 dB ${SL.audio.levelWithin3dB50ms}`);
check('6. same load on the buffer path: 0 underruns heard', SB.bufUnderruns === 0 && SB.clock.underruns === 0 && SB.audio.dropouts === 0 && SB.liveHaps === 0 && SB.positionJumps === 0, `buffer: late ticks ${SB.clock.lateTicks}, clock underruns ${SB.clock.underruns}, stalls covered by a sounding buffer ${SB.clock.covered}, buffer underruns ${SB.bufUnderruns}, voices triggered ${SB.liveHaps}, position jumps ${SB.positionJumps}; audio vs reference: onsets matched ${SB.audio.matched}/${SB.audio.refOnsets}, dropouts ${SB.audio.dropouts} (${SB.audio.dropoutMs} ms), 50 ms level blocks within 3 dB ${SB.audio.levelWithin3dB50ms}; late starts ${JSON.stringify(SB.lateStarts)}; live decisions ${SB.liveDecisions.join(' ') || 'none'}`);
}

/* 7: lead study, cold start under CPU throttle x4 (nothing cached: the gain literal changes every hash) */
if (LEADSTUDY && RUN('D')) {
  out.leadStudy = [];
  const cold = async (lead, gain, sec = 40) => {
    await T((l) => window.strudelCraft.ahead.configure({ lead: l, persist: false }), lead || 0.001); if (!lead) await T(() => window.strudelCraft.ahead.configure({ lead: 0, persist: false }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await setCode(STRESS(gain)); await wait(300);
    const src = []; const R = await run(async () => { for (let i = 0; i < sec * 2; i++) { await wait(500); const s = await ah(); src.push(s.source === 'buffer' ? 1 : 0); } return ah(); });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const firstBuf = src.indexOf(1), o = { lead, seconds: sec, renderSpeedX: R.st.speed, renders: R.st.renders, chunkSec: R.st.chunkSec, fillMs: R.st.fillMs, leadMedian: R.st.leadMedian, leadMin: R.st.leadMin, firstBufferAfterS: firstBuf < 0 ? null : firstBuf / 2, bufferShare: +(src.reduce((x, y) => x + y, 0) / src.length).toFixed(3), bufferShareAfterFirst: firstBuf < 0 ? 0 : +(src.slice(firstBuf).reduce((x, y) => x + y, 0) / (src.length - firstBuf)).toFixed(3), bufSec: R.st.bufSec, bufUnderruns: R.st.bufUnderruns, clock: R.bg };
    out.leadStudy.push(o); console.log('lead ' + lead + ': ' + JSON.stringify(o)); return o;
  };
  await cold(0, '0.031'); await cold(16, '0.033'); await cold(600, '0.035');
}
/* 9: the hypothesis test. A whole program (16 bars) is precomputed; mid-play the main thread is blocked for 0.5, 1 and 2 s, then the page is hidden (1 s timers) with one more 1.5 s block.
   Position = audio clock arithmetic: tick c must sound at t0 + c / cps. Buffer path vs the live scheduler under the same stalls. */
if (RUN('F')) {
  await setCode(PA('f2') + '// @daw bars=16\n'); await wait(900); await T(() => window.strudelCraft.ahead.configure({ lead: 600, persist: false }));
  await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return s.status === 'ready' && s.renderM === 8; }, null, { timeout: 300000 }).catch(() => {}); const pre = await ah();
  const block = (ms) => T((ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* blocked */ } }, ms);
  const stallRun = async (label) => { const R = await run(async () => { await wait(2500); await block(500); await wait(3000); await block(1000); await wait(3000); await block(2000); await wait(2500); await T(() => window.__setHidden(true)); await wait(2500); await block(1500); await wait(4000); const st = await ah(); await T(() => window.__setHidden(false)); return st; });
    const a0 = R.anchors.filter((a) => a.tA < R.anchors[0].tA + 0.5).pop(), jumps = R.anchors.filter((a) => a.tA >= R.anchors[0].tA + 0.5).length, dur = Math.min(26, R.tEnd - a0.tA - 0.3), m = await grab('m', a0.tA, a0.tA + dur), exp = []; for (let c = 0; c / a0.cps < dur - 0.1; c++) exp.push({ c, t: a0.tA + (c - a0.from) / a0.cps });
    const es = tickErrors(exp, m, a0.tA), ok = es.filter((x) => x.err != null && Math.abs(x.err) < 10).length, gap = longestGapMs(m.x.subarray(Math.round(0.1 * m.sr)), m.sr);
    return { label, ticksExpected: es.length, ticksOnPosition: ok, tickErrMs: es.map((x) => x.err), longestGapMs: gap, positionJumps: jumps, clock: R.bg, bufUnderruns: R.st.bufUnderruns, voicesTriggered: R.trace.filter((h) => h[3] === 0).length, skippedQueries: R.skippedQueries, sourceAtEnd: R.mid.source, tapCover: +m.cover.toFixed(4) }; };
  const FB = await stallRun('buffer'); await T(() => window.strudelCraft.ahead.configure({ play: false, persist: false })); const FL = await stallRun('live'); await T(() => window.strudelCraft.ahead.configure({ play: true, persist: false }));
  out.hypothesis = { program: '16 bars, 2 layers, 0.5 cps', stallsMs: [500, 1000, 2000, 'hidden + 1500'], chunksNotReady: pre.renderM - pre.renderN, chunks: pre.renderM, buffer: FB, live: FL };
  const line = (o) => `${o.ticksOnPosition}/${o.ticksExpected} ticks within 10 ms of position (errors ms: ${o.tickErrMs.map((x) => (x == null ? 'miss' : x)).join(' ')}), longest gap ${o.longestGapMs} ms, position jumps ${o.positionJumps}, clock underruns ${o.clock.underruns}, paused ${o.clock.pausedSec} s, late ticks ${o.clock.lateTicks}, voices triggered ${o.voicesTriggered}`;
  check('9. stalled main thread (0.5 / 1 / 2 s) + hidden page: buffer playback has no gap and no position jump, no main-thread events', FB.ticksOnPosition === FB.ticksExpected && FB.longestGapMs <= 20 && FB.positionJumps === 0 && FB.bufUnderruns === 0 && FB.voicesTriggered === 0 && FB.sourceAtEnd === 'buffer' && FB.tapCover > 0.999, `chunks not ready before Play: ${pre.renderM - pre.renderN} of ${pre.renderM}; BUFFER: ${line(FB)}`);
  check('9. the live scheduler path glitches under the same stalls (gap or position jump)', FL.longestGapMs > 20 || FL.ticksOnPosition < FL.ticksExpected || FL.positionJumps > 0, `LIVE: ${line(FL)}`);
  await setCode(PA('f2')); await wait(600); }

/* 8: the default (nothing set): the module loads at the first Play, the program is precomputed, the next Play is from the buffer */
if (RUN('E')) { const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(e.message)); await p2.goto(`http://127.0.0.1:${server.address().port}/index.html#rack`); await p2.waitForSelector('#list li[data-id]', { timeout: 60000 }); await p2.waitForFunction(() => window.strudelCraft.timeline && window.strudelCraft.bg && window.strudelCraft.capture, null, { timeout: 30000 });
  const atLoad = await p2.evaluate(() => !!window.strudelCraft.ahead);
  await p2.evaluate((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, PA('f2') + '// @daw bars=16\n'); await p2.waitForTimeout(600);
  await p2.evaluate(() => window.__sc.play()); await p2.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 }); await p2.waitForTimeout(1200); const first = await p2.evaluate(() => (window.strudelCraft.ahead ? window.strudelCraft.ahead.state() : null)); await p2.evaluate(() => window.__sc.stop());
  await p2.waitForFunction(() => { const s = window.strudelCraft.ahead && window.strudelCraft.ahead.state(); return s && s.status === 'ready'; }, null, { timeout: 240000 }).catch(() => {}); const rdy = await p2.evaluate(() => window.strudelCraft.ahead.state());
  await p2.evaluate(() => window.strudelCraft.timeline.seek(0)); await p2.evaluate(() => window.__sc.play()); await p2.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 }); await p2.waitForTimeout(2500); const second = await p2.evaluate(() => window.strudelCraft.ahead.state());
  await p2.evaluate(() => window.strudelCraft.bg.openDiagnostics()); await p2.waitForTimeout(300); const rowT = await p2.evaluate(() => { const dt = [...document.querySelectorAll('#bgDiag dt')].find((x) => x.textContent === 'Render ahead'); return dt ? dt.nextElementSibling.textContent : null; }); await p2.evaluate(() => { document.getElementById('bgDiag').close(); window.__sc.stop(); });
  out.default = { loadedAtPageLoad: atLoad, lead: rdy.lead, programEndCycle: rdy.programEnd, chunks: rdy.renderM, renders: rdy.renders, renderSpeedX: rdy.speed, pcmBytes: rdy.pcmBytes, memCapBytes: rdy.memCapBytes, firstPlaySource: first && first.source, secondPlaySource: second.source, sheetRow: rowT };
  check('8. default: nothing loads at page load; the first Play loads the module and the whole program is precomputed', !atLoad && !!first && rdy.status === 'ready' && rdy.programEnd === 16 && rdy.renderM === 8 && rdy.renderN === 8, `loaded at page load: ${atLoad}; lead ${rdy.lead} s; program end at cycle ${rdy.programEnd}; ${rdy.renderN} of ${rdy.renderM} chunks, ${rdy.renders} renders at ${rdy.speed}x; PCM ${(rdy.pcmBytes / 1e6).toFixed(2)} MB of ${(rdy.memCapBytes / 1e6).toFixed(0)} MB`);
  check('8. default: the next Play is from the precomputed buffer; the audio dot sheet says so', second.source === 'buffer' && /ready/.test(rowT || '') && /source buffer/.test(rowT || ''), `first Play "${first && first.source}", second Play "${second.source}"; sheet: ${rowT}`); await p2.close(); }
{ const f = path.join(ROOT, 'docs/screens/bufferplay.json'); let prev = {}; if (ONLY) { try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { prev = {}; } } fs.writeFileSync(f, JSON.stringify({ ...prev, ...out }, null, 1) + '\n'); } /* a partial run (BP_ONLY) replaces only its own sections */
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
