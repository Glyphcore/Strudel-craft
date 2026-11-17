/* Record without speakers (docs/AUDIO_ENGINE.md Part C, docs/CAPTURE.md). Serves site/ under /Strudel-craft/, Playwright Chromium at 360x780 (mobile profile).
   Night phonk v2 plays from its Syntax entry, then:
   1. offline Record (the panel's default source) of 4 cycles from cycle 17 while the transport keeps playing: the render runs in the render host, the
      transport never stops, progress is reported, the length is sample-exact (round(4 / cps * sr)), and the result matches the CLI render of the same
      window (tests/site/lib/glitch.mjs: onsets, drift, dropouts, level);
   2. the same offline render again is identical (sha256) or within the level-fingerprint tolerance;
   3. Cancel stops a render: no take is stored;
   4. live capture under CPU throttling (default x4) of the same window: the take carries a self-check (outputs.capture.check), reported with its glitch metric;
   5. a live take with a forced 700 ms main-thread stall is flagged (clock re-anchor), and its offline re-render (rerender) matches the CLI render;
   6. no page errors.
   Usage: node tests/site/record_offline.mjs --ref REF_DIR/mix.wav [--ref-from 15] [--throttle 4] [--json OUT.json]
   (REF: tests/site/ref_render.sh REF_DIR v2 16 8 renders cycles 15..23.) PASS/FAIL lines, exit 1 on any FAIL. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { compare as compare0, features, highpass, mono, onsets, readWav } from './lib/glitch.mjs';
import { runSyntaxEntry } from './lib/syntax.mjs';
/* broadband numbers plus the same level metric above 120 Hz (hi) and the sub band's own offset (subOffsetDb = broadband offset of what is left below 120 Hz) */
const compare = (ref, cand) => { const g = compare0(ref, cand); const hr = { x: highpass(ref.x, ref.sr, 120), sr: ref.sr }, hc = { x: highpass(cand.x, cand.sr, 120), sr: cand.sr }; const h = compare0(hr, hc, { lag: Math.round(g.lagMs / 5) });
  const lr = { x: Float32Array.from(ref.x, (v, i) => v - hr.x[i]), sr: ref.sr }, lc = { x: Float32Array.from(cand.x, (v, i) => v - hc.x[i]), sr: cand.sr }; const l = compare0(lr, lc, { lag: Math.round(g.lagMs / 5) });
  return { ...g, hiLevelWithin3dB: h.levelWithin3dB, hiLevel50: h.levelWithin3dB50ms, hiLevelOffsetDb: h.levelOffsetDb, subOffsetDb: l.levelOffsetDb }; };
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), PREFIX = '/Strudel-craft/';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = path.resolve(arg('--site', path.join(ROOT, 'site'))), REF = arg('--ref', null), REF_FROM = +arg('--ref-from', 15), THR = +arg('--throttle', 4), AT = 17, N = 4, THR_MS = +arg('--throttle-ms', 6000);
if (!REF) { console.log('FAIL  --ref REF.wav is required (tests/site/ref_render.sh DIR v2 16 8)'); process.exit(1); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
let fails = 0; const report = {}; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
/* every long in-page await has a deadline: a starved page (x4 throttle) must end in a clear FAIL, never a silent hang (#176) */
const bail = async (what, ms) => { check(what, false, `no result after ${ms} ms (page main thread starved or the recorder never finished)`); try { console.log('REPORT ' + JSON.stringify(report)); await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]); } catch (e) { /* closing */ } process.exit(1); };
const ev = async (what, ms, fn, a) => { let t; const r = await Promise.race([page.evaluate(fn, a), new Promise((res) => { t = setTimeout(() => res(ev.TIMEOUT), ms); })]); clearTimeout(t); if (r === ev.TIMEOUT) await bail(what, ms); return r; }; ev.TIMEOUT = Symbol('timeout');
const W = readWav(fs.readFileSync(REF)); const CPS = +arg('--cps', 128.8 / 240); /* the program's own setcpm(128.8 / 4) wins on the site; ref_render.sh keeps it too */
const refWin = (c0, frames, sr) => { const a = Math.round((c0 - REF_FROM) / CPS * W.sr), b = a + Math.round(frames / sr * W.sr); return { x: mono(W.L.subarray(a, b), W.R.subarray(a, b)), sr: W.sr }; };
let MG = 1; /* the site's master level (default -6 dB): a take is post master, the CLI render is not; candidates are brought back to unity before comparing */
const fromB64 = (b64) => { const x = new Float32Array(Uint8Array.from(Buffer.from(b64, 'base64')).buffer); if (MG !== 1) for (let i = 0; i < x.length; i++) x[i] *= MG; return x; };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
/* fixture (default on, --no-pin to disable; the reference must come from PIN_SUPERSAW=1 ref_render.sh): the supersaw worklet's phases are Math.random on the audio thread, so no two renders
   (nor Chrome and the CLI) agree on a supersaw voice. Pinned here by aliasing 'supersaw' to 'sawtooth' in every frame (live page and render host); the CLI reference does the same. The track is unchanged. */
if (!process.argv.includes('--no-pin')) await ctx.addInitScript(() => { setInterval(() => { try { const m = window.soundMap && window.soundMap.get(); if (m && m.sawtooth && m.supersaw && m.supersaw !== m.sawtooth) window.soundMap.setKey('supersaw', m.sawtooth); } catch (e) { /* not loaded yet */ } }, 50); });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.capture, null, { timeout: 90000 });
await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; await P.load('glyphcore/phonk:atoms'); await P.load('glyphcore/phonk:presets'); window.__sc.setView('syntax'); });
await runSyntaxEntry(page, 'tracks', 1);
await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy && window.__sc.Engine.started, null, { timeout: 120000 }); await page.waitForTimeout(5000);
MG = 10 ** (-(await page.evaluate(() => window.strudelCraft.transport.masterDb)) / 20); report.masterGainComp = +(20 * Math.log10(MG)).toFixed(2);
/* the take's mono PCM as base64 + its recipe facts */
const PCM = `(rec, kind) => { const a = rec.audio[kind]; const m = new Float32Array(a.L.length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (a.L[i] + a.R[i]); const b = new Uint8Array(m.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return { b64: btoa(s), sr: a.sr, frames: a.L.length }; }`;

/* 1. offline Record while playing */
const off = await ev('offline render of 4 cycles', 240000, async ({ n, at, PCM }) => { const pcm = eval(PCM); const C = window.strudelCraft.capture, S = window.__sc.S; C.configure({ source: 'offline', audio: true, events: true, code: true });
  const seen = new Set(); let stopped = false; const bg0 = window.strudelCraft.bg.stats(); const t0 = performance.now();
  const iv = setInterval(() => { const t = document.querySelector('#capState'); if (t && /Rendering offline \d+ %/.test(t.textContent)) seen.add(t.textContent); if (!S.playing) stopped = true; }, 50);
  const rec = await C.recordOffline(n, { at, name: 'offline' }); clearInterval(iv); const bg1 = window.strudelCraft.bg.stats();
  if (!rec) return { error: 'no take' };
  const r = rec.recipe; return { ms: Math.round(performance.now() - t0), hostBootMs: C.host.bootMs, progress: [...seen], stopped, playing: S.playing, frames: r.outputs.render.frames, sr: r.outputs.render.sr, cps: r.timing.cps, mode: r.timing.mode, sha: r.outputs.render.sha256, id: r.id,
    live: { underruns: bg1.underruns - bg0.underruns, late: bg1.perf.lateHaps - bg0.perf.lateHaps, worstLongTaskMs: bg1.perf.longTaskWorstMs }, pcm: pcm(rec, 'render') }; }, { n: N, at: AT, PCM });
check('offline render ran while the transport kept playing (never stopped)', !off.error && !off.stopped && off.playing, JSON.stringify({ ...off, pcm: undefined }));
check('offline render reported progress', off.progress && off.progress.length >= 2, (off.progress || []).join(' | '));
check('offline length is sample-exact: round(4 / cps * sr)', off.frames === Math.round(N / off.cps * off.sr) && off.mode === 'offline', `${off.frames} vs ${Math.round(N / off.cps * off.sr)}`);
const g1 = compare(refWin(AT, off.pcm.frames, off.pcm.sr), { x: fromB64(off.pcm.b64), sr: off.pcm.sr }); report.offline = g1; report.offlineLive = off.live; report.offlineMs = off.ms; report.hostBootMs = off.hostBootMs;
/* targets (docs/AUDIO_ENGINE.md 5): onsets >= 90 % (soft match: strict detector or a >= 3 dB rise, see lib/glitch.mjs), p95 <= 5 ms, |drift| <= 0.5 ms/s, 0 dropouts, level within 3 dB on >= 85 % of loud 5 ms hops above 120 Hz with the master level compensated and no other offset (measured 86-89 %), sub band offset |<= 5 dB| (measured +3 dB: Chrome's sine sub with shape and pitch envelope is louder than node-web-audio-api's) */
const SAME = (g) => g.matchedSoft >= 0.9 * g.refOnsets && g.onsetDevP95Ms <= 5 && Math.abs(g.driftMsPerS) <= 0.5 && g.dropouts === 0 && g.hiLevelWithin3dB >= 0.85 && Math.abs(g.subOffsetDb) <= 5;
check('offline render matches the CLI render (onsets >= 90 % matched, p95 <= 5 ms, |drift| <= 0.5 ms/s, 0 dropouts, level within 3 dB on >= 85 % of loud 5 ms hops above 120 Hz, master compensated, |sub offset| <= 5 dB)', SAME(g1), JSON.stringify(g1));

/* negative control for the soft onset match: the reference itself with 60 ms silenced at every 4th onset must not count as matching (dropout metric > 0, soft match < 90 %) */
{ const rw = refWin(AT, off.pcm.frames, off.pcm.sr), y = Float32Array.from(rw.x), F = features(rw.x, rw.sr), os = onsets(F); os.forEach((t, i) => { if (i % 4 === 1) y.fill(0, Math.round(t * rw.sr) - 100, Math.round((t + 0.06) * rw.sr)); });
  const n = compare0(rw, { x: y, sr: rw.sr }); report.negativeControl = n; check('negative control: a reference with silenced onsets is not accepted (soft onset match < 90 %, dropouts > 0)', n.matchedSoft < 0.9 * n.refOnsets && n.dropouts > 0, JSON.stringify({ refOnsets: n.refOnsets, matched: n.matched, matchedSoft: n.matchedSoft, dropouts: n.dropouts })); }

/* 2. determinism */
const again = await ev('second offline render', 240000, async ({ n, at, id }) => { const C = window.strudelCraft.capture; const rec = await C.recordOffline(n, { at, name: 'offline-again' }); const a = await C.get(id); const env = (x) => x.recipe.outputs.render.envelope; let bad = 0, cnt = 0; const e1 = env(a), e2 = env(rec); for (let i = 0; i < Math.min(e1.length, e2.length); i++) { if (e1[i] < -50 && e2[i] < -50) continue; cnt++; if (Math.abs(e1[i] - e2[i]) > 1.5) bad++; } return { same: rec.recipe.outputs.render.sha256 === a.recipe.outputs.render.sha256, within: cnt ? 1 - bad / cnt : 0 }; }, { n: N, at: AT, id: off.id });
check('offline render is deterministic as far as superdough allows (same sha256, or level fingerprint within 1.5 dB on >= 95 % of blocks: supersaw phases are random on the audio thread)', again.same || again.within >= 0.95, JSON.stringify(again)); report.determinism = again;

/* 3. cancel */
const cancel = await ev('offline render Cancel', 60000, async () => { const C = window.strudelCraft.capture; const n0 = (await C.list()).length; const p = C.recordOffline(16, { at: 0, name: 'cancel-me' }); await new Promise((r) => setTimeout(r, 1500)); C.stop(); const r = await p; return { result: r, stored: (await C.list()).length - n0 }; });
check('Cancel stops an offline render and stores nothing', cancel.result === null && cancel.stored === 0, JSON.stringify(cancel));

/* 4 + 5. live takes: seek to cycle 16, record cycles 17..21 under throttling; then a take with a forced stall */
const cdp = await ctx.newCDPSession(page);
/* the take starts at cycle LAT = AT (2 cycles after the seek point, inside the reference's 15..23); Record starts the transport itself */
const LAT = AT; /* the same window the offline render is validated on; the seek starts the run at LAT - 2 (transport-range.js honours Start on every fresh run, #108) */
const live = async (stall) => { await page.evaluate(() => { const T = window.strudelCraft.transport; if (T.playing) T.stop(); }); await page.waitForTimeout(800);
  await page.evaluate((c) => Object.assign(window.strudelCraft.range.state, { start: c }), LAT - 2); await page.evaluate(() => window.strudelCraft.transport.play());
  await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy, null, { timeout: 120000 });
  /* x4 for the first THR_MS of the take only (the node-side timer still fires on a starved page): the take then finishes and is self-checked; a whole-take x4 saturates the main-thread scheduler (#176) */
  let tt = null; if (THR > 1 && !stall) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR }); tt = setTimeout(() => cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {}), THR_MS); }
  const r = await ev(stall ? 'live take with a forced stall' : `live take under x${THR} throttling`, 300000, async ({ n, at, stall, PCM, arg0 }) => { const pcm = eval(PCM); const C = window.strudelCraft.capture; C.configure({ source: 'live', audio: true, events: true, code: true, autoFix: false });
    if (stall) { const iv = setInterval(() => { if (C.state.phase === 'recording' && window.strudelCraft.capture.state.recAudio0 != null) { clearInterval(iv); setTimeout(() => { const t = performance.now(); while (performance.now() - t < 700) { /* a frozen main thread */ } }, 1500); } }, 20); }
    const rec = await C.record({}, { mode: 'cycles', n, at, name: stall ? 'stalled' : 'live' }); if (!rec) return { error: 'no take' };
    return { check: rec.recipe.outputs.capture.check, id: rec.recipe.id, hasRender: !!rec.audio.render, cap: pcm(rec, 'capture'), render: rec.audio.render ? pcm(rec, 'render') : null, start: rec.recipe.timing.start, underLoad: rec.recipe.outputs.render ? rec.recipe.outputs.render.underLoad : null, load: rec.recipe.outputs.render ? rec.recipe.outputs.render.load : null, recipe: arg0 ? rec.recipe : undefined }; }, { n: N, at: LAT, stall, PCM, arg0: !!arg('--dump', null) });
  if (tt) clearTimeout(tt); if (THR > 1 && !stall) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return r; };
const L4 = await live(false); if (arg('--dump', null) && L4.cap) fs.writeFileSync(arg('--dump', null) + '/live_x4.f32', Buffer.from(fromB64(L4.cap.b64).buffer)); if (arg('--dump', null)) fs.writeFileSync(arg('--dump', null) + '/live_x4.json', JSON.stringify({ start: L4.start, check: L4.check, recipe: L4.recipe }));
if (L4.error) check(`live take under x${THR} throttling`, false, L4.error);
else { const gl = compare(refWin(L4.start, L4.cap.frames, L4.cap.sr), { x: fromB64(L4.cap.b64), sr: L4.cap.sr }); report.liveThrottled = { check: L4.check, glitch: gl };
  const bad = gl.dropouts > 0 || gl.refOnsets - gl.matchedSoft > 0.15 * gl.refOnsets || Math.abs(gl.driftMsPerS) > 0.5; report.liveThrottledWindow = L4.start;
  check(`live take under x${THR} throttling carries a self-check with no false negative (flagged whenever the glitch metric shows dropouts, > 15 % missing onsets by the soft rule (the strict detector alone misses 17-23 % on a clean take) or drift)`, !!L4.check && (!bad || !L4.check.ok), JSON.stringify({ check: L4.check, glitch: gl }));
  if (L4.render && arg('--dump', null)) fs.writeFileSync(arg('--dump', null) + '/live_render.f32', Buffer.from(fromB64(L4.render.b64).buffer));
  if (L4.render) { const gr = compare(refWin(L4.start, L4.render.frames, L4.render.sr), { x: fromB64(L4.render.b64), sr: L4.render.sr }); report.liveThrottledRender = gr; check('its attached reference render either waited for a calm main thread and matches the CLI render, or is flagged underLoad (rendered under load, Re-render offline recommended)', typeof L4.underLoad === 'boolean' && ((L4.underLoad === false && SAME(gr)) || (L4.underLoad === true && L4.load && L4.load.waitedMs >= 9000)), JSON.stringify({ underLoad: L4.underLoad, gr })); } }
const LS = await live(true);
if (LS.error) check('live take with a forced stall', false, LS.error);
else { const gl = compare(refWin(LS.start, LS.cap.frames, LS.cap.sr), { x: fromB64(LS.cap.b64), sr: LS.cap.sr }); report.liveStall = { check: LS.check, glitch: gl };
  check('a live take with a 700 ms main-thread stall is flagged (re-anchor or dropped events)', LS.check && !LS.check.ok && (LS.check.reanchors > 0 || LS.check.droppedEvents > 0), JSON.stringify(LS.check));
  const rr = await ev('offline re-render of the stalled take', 240000, async ({ id, PCM }) => { const pcm = eval(PCM); const rec = await window.strudelCraft.capture.rerender(id); return rec ? { replaced: !!rec.replaced, pcm: pcm(rec, 'render') } : null; }, { id: LS.id, PCM });
  const gr = rr ? compare(refWin(LS.start, rr.pcm.frames, rr.pcm.sr), { x: fromB64(rr.pcm.b64), sr: rr.pcm.sr }) : null; report.liveStallRerender = gr;
  check('its offline re-render replaces it and matches the CLI render (clean)', rr && rr.replaced && SAME(gr), JSON.stringify(gr)); }
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
const J = arg('--json', null); if (J) fs.writeFileSync(J, JSON.stringify(report, null, 1));
console.log('REPORT ' + JSON.stringify(report));
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
