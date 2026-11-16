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
import { compare, mono, readWav } from './lib/glitch.mjs';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), PREFIX = '/Strudel-craft/';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = path.resolve(arg('--site', path.join(ROOT, 'site'))), REF = arg('--ref', null), REF_FROM = +arg('--ref-from', 15), THR = +arg('--throttle', 4), AT = 17, N = 4;
if (!REF) { console.log('FAIL  --ref REF.wav is required (tests/site/ref_render.sh DIR v2 16 8)'); process.exit(1); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
let fails = 0; const report = {}; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const W = readWav(fs.readFileSync(REF)); const CPS = +arg('--cps', 0.5); /* the site's Tempo knob default (120 BPM) rewrites setcpm; ref_render.sh does the same */
const refWin = (c0, frames, sr) => { const a = Math.round((c0 - REF_FROM) / CPS * W.sr), b = a + Math.round(frames / sr * W.sr); return { x: mono(W.L.subarray(a, b), W.R.subarray(a, b)), sr: W.sr }; };
const fromB64 = (b64) => new Float32Array(Uint8Array.from(Buffer.from(b64, 'base64')).buffer);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.capture, null, { timeout: 90000 });
await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; await P.load('glyphcore/phonk:atoms'); await P.load('glyphcore/phonk:presets'); window.__sc.setView('syntax'); });
for (let k = 0; k < 5; k++) { await page.waitForFunction(() => document.querySelectorAll('#sx-tracks .sx-run').length > 1, null, { timeout: 60000 }); await page.waitForTimeout(500); if (await page.evaluate(() => { const b = document.querySelectorAll('#sx-tracks .sx-run')[1]; if (!b) return false; b.click(); return true; })) break; }
await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy && window.__sc.Engine.started, null, { timeout: 120000 }); await page.waitForTimeout(5000);
/* the take's mono PCM as base64 + its recipe facts */
const PCM = `(rec, kind) => { const a = rec.audio[kind]; const m = new Float32Array(a.L.length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (a.L[i] + a.R[i]); const b = new Uint8Array(m.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return { b64: btoa(s), sr: a.sr, frames: a.L.length }; }`;

/* 1. offline Record while playing */
const off = await page.evaluate(async ({ n, at, PCM }) => { const pcm = eval(PCM); const C = window.strudelCraft.capture, S = window.__sc.S; C.configure({ source: 'offline', audio: true, events: true, code: true });
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
const SAME = (g) => g.matched >= 0.7 * g.refOnsets && g.onsetDevP95Ms <= 5 && Math.abs(g.driftMsPerS) <= 0.5 && g.dropouts === 0 && g.levelWithin3dBAligned >= 0.7; /* Chrome vs node-web-audio-api on clean renders: measured 76-88 % onsets matched, 75-85 % of loud hops within 3 dB after the offset */
check('offline render matches the CLI render (onsets >= 70 % matched, p95 <= 5 ms, |drift| <= 0.5 ms/s, 0 dropouts, level within 3 dB after the median offset on >= 70 % of loud 5 ms hops)', SAME(g1), JSON.stringify(g1));

/* 2. determinism */
const again = await page.evaluate(async ({ n, at, id }) => { const C = window.strudelCraft.capture; const rec = await C.recordOffline(n, { at, name: 'offline-again' }); const a = await C.get(id); const env = (x) => x.recipe.outputs.render.envelope; let bad = 0, cnt = 0; const e1 = env(a), e2 = env(rec); for (let i = 0; i < Math.min(e1.length, e2.length); i++) { if (e1[i] < -50 && e2[i] < -50) continue; cnt++; if (Math.abs(e1[i] - e2[i]) > 1.5) bad++; } return { same: rec.recipe.outputs.render.sha256 === a.recipe.outputs.render.sha256, within: cnt ? 1 - bad / cnt : 0 }; }, { n: N, at: AT, id: off.id });
check('offline render is deterministic as far as superdough allows (same sha256, or level fingerprint within 1.5 dB on >= 95 % of blocks: supersaw phases are random on the audio thread)', again.same || again.within >= 0.95, JSON.stringify(again)); report.determinism = again;

/* 3. cancel */
const cancel = await page.evaluate(async () => { const C = window.strudelCraft.capture; const n0 = (await C.list()).length; const p = C.recordOffline(16, { at: 0, name: 'cancel-me' }); await new Promise((r) => setTimeout(r, 1500)); C.stop(); const r = await p; return { result: r, stored: (await C.list()).length - n0 }; });
check('Cancel stops an offline render and stores nothing', cancel.result === null && cancel.stored === 0, JSON.stringify(cancel));

/* 4 + 5. live takes: seek to cycle 16, record cycles 17..21 under throttling; then a take with a forced stall */
const cdp = await ctx.newCDPSession(page);
/* the take starts at cycle LAT (2 cycles after the seek point, inside the reference's 15..23); Record starts the transport itself */
const LAT = AT + 1;
const live = async (stall) => { await page.evaluate(() => { const T = window.strudelCraft.transport; if (T.playing) T.stop(); }); await page.waitForTimeout(800);
  await page.evaluate((c) => Object.assign(window.strudelCraft.range.state, { start: c }), LAT - 2); await page.evaluate(() => window.strudelCraft.transport.play());
  await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy, null, { timeout: 120000 });
  if (THR > 1 && !stall) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
  const r = await page.evaluate(async ({ n, at, stall, PCM }) => { const pcm = eval(PCM); const C = window.strudelCraft.capture; C.configure({ source: 'live', audio: true, events: true, code: true, autoFix: false });
    if (stall) { const iv = setInterval(() => { if (C.state.phase === 'recording' && window.strudelCraft.capture.state.recAudio0 != null) { clearInterval(iv); setTimeout(() => { const t = performance.now(); while (performance.now() - t < 700) { /* a frozen main thread */ } }, 1500); } }, 20); }
    const rec = await C.record({}, { mode: 'cycles', n, at, name: stall ? 'stalled' : 'live' }); if (!rec) return { error: 'no take' };
    return { check: rec.recipe.outputs.capture.check, id: rec.recipe.id, hasRender: !!rec.audio.render, cap: pcm(rec, 'capture'), render: rec.audio.render ? pcm(rec, 'render') : null, start: rec.recipe.timing.start }; }, { n: N, at: LAT, stall, PCM });
  if (THR > 1 && !stall) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return r; };
const L4 = await live(false);
if (L4.error) check(`live take under x${THR} throttling`, false, L4.error);
else { const gl = compare(refWin(L4.start, L4.cap.frames, L4.cap.sr), { x: fromB64(L4.cap.b64), sr: L4.cap.sr }); report.liveThrottled = { check: L4.check, glitch: gl };
  const bad = gl.dropouts > 0 || gl.missingOnsets > 0.15 * gl.refOnsets || Math.abs(gl.driftMsPerS) > 0.5; report.liveThrottledWindow = L4.start;
  check(`live take under x${THR} throttling carries a self-check with no false negative (flagged whenever the glitch metric shows dropouts, > 15 % missing onsets or drift)`, !!L4.check && (!bad || !L4.check.ok), JSON.stringify({ check: L4.check, glitch: gl }));
  if (L4.render) { const gr = compare(refWin(L4.start, L4.render.frames, L4.render.sr), { x: fromB64(L4.render.b64), sr: L4.render.sr }); report.liveThrottledRender = gr; check('its reference render (offline, host) matches the CLI render', SAME(gr), JSON.stringify(gr)); } }
const LS = await live(true);
if (LS.error) check('live take with a forced stall', false, LS.error);
else { const gl = compare(refWin(LS.start, LS.cap.frames, LS.cap.sr), { x: fromB64(LS.cap.b64), sr: LS.cap.sr }); report.liveStall = { check: LS.check, glitch: gl };
  check('a live take with a 700 ms main-thread stall is flagged (re-anchor or dropped events)', LS.check && !LS.check.ok && (LS.check.reanchors > 0 || LS.check.droppedEvents > 0), JSON.stringify(LS.check));
  const rr = await page.evaluate(async ({ id, PCM }) => { const pcm = eval(PCM); const rec = await window.strudelCraft.capture.rerender(id); return rec ? { replaced: !!rec.replaced, pcm: pcm(rec, 'render') } : null; }, { id: LS.id, PCM });
  const gr = rr ? compare(refWin(LS.start, rr.pcm.frames, rr.pcm.sr), { x: fromB64(rr.pcm.b64), sr: rr.pcm.sr }) : null; report.liveStallRerender = gr;
  check('its offline re-render replaces it and matches the CLI render (clean)', rr && rr.replaced && SAME(gr), JSON.stringify(gr)); }
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
const J = arg('--json', null); if (J) fs.writeFileSync(J, JSON.stringify(report, null, 1));
console.log('REPORT ' + JSON.stringify(report));
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
