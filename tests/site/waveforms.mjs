// Drawn/computed instruments (#182 stage 1): `node tests/site/waveforms.mjs`
// Needs Playwright with Chrome/Chromium and Strudel. Env: STRUDEL_WEB_DIR = a folder holding dist/index.mjs of @strudel/web (default: unpkg 1.3.0),
// PLAYWRIGHT_DIR (default /opt/node-tools/node_modules/playwright), CHROME_PATH (optional executable).
// Checks: (1) fixtures valid (caps: tests/site/waveforms_caps.mjs), (2) seeded variation, (3) each mechanism plays through unmodified Strudel with the
// destination peak between -40 and -1 dBFS, the one-shot (46 ms class) measured with a poll shorter than its length, (4) two shapes give
// different spectra on every route, (5) no audio file is tracked in the repo.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath } from 'url'; import { execSync } from 'child_process';
const require = createRequire(import.meta.url), HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const WF = await import(path.join(ROOT, 'site/engine/waveforms.js'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const sine = { id: 'sine-ish', family: 'test', origin: 'drawn', license: 'CC0-1.0', cycle: { points: Array.from({ length: 17 }, (_, i) => [i / 16, Math.sin(2 * Math.PI * i / 16)]), interp: 'spline' },
  params: { detune: { min: 0, max: 40, default: 12, to: 'detune' }, att: { min: 0, max: 1, default: 0.1, to: 'attack' }, lpf: { min: 200, max: 8000, default: 3000, to: 'lpf' } }, vary: { seed: 7, spread: { detune: 0.3, att: 0.2, lpf: 0.4 } } };
const saw = { ...sine, id: 'saw-ish', cycle: { points: [[0, -0.9], [0.45, 0], [0.9, 0.9], [0.92, -0.9]], interp: 'linear' } };
const morph = { id: 'morph-ish', family: 'test', origin: 'drawn', license: 'CC0-1.0', morph: { frames: [{ pos: 0, points: sine.cycle.points }, { pos: 1, points: saw.cycle.points }] } };

// (1) fixtures valid (the cap and bypass cases live in tests/site/waveforms_caps.mjs, which runs schema and validate() together)
ok(WF.validate({ instruments: [sine, saw, morph] }).length === 0, 'fixtures (single cycle, morph) validate');
ok(WF.validate({ instruments: [{ ...sine, descriptors: { note: 'data:audio/wav;base64,AAAA' } }] }).some((e) => e.code === 'E_WF_AUDIO'), 'a data:audio string is rejected');
const sch = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/craftpack/1/kinds/waveforms.1.schema.json'), 'utf8')), idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/craftpack/1/kinds/index.json'), 'utf8'));
ok(sch.title === 'waveforms@1' && idx.kinds.waveforms?.code === 'never' && idx.kinds.waveforms.schema === 'kinds/waveforms.1.schema.json', 'schema parses and the kinds index lists waveforms (code: never)');

// (2) variation
const a1 = JSON.stringify(WF.vary(sine, 5)), a2 = JSON.stringify(WF.vary(sine, 5)), b = WF.vary(sine, 6), a = WF.vary(sine, 5);
ok(a1 === a2, 'same seed gives identical parameter sets');
ok(Object.keys(a).filter((k) => a[k] !== b[k]).length >= 3, 'two seeds differ in at least 3 parameters');

// (5) no audio files tracked
const sh = (c) => execSync(c, { cwd: ROOT, maxBuffer: 1 << 26 }).toString().split('\n').filter(Boolean);
const added = [...sh('git diff --name-only --diff-filter=AM origin/main'), ...sh('git ls-files --others --exclude-standard')].filter((f) => /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(f));
ok(added.length === 0, `no audio file added or changed against origin/main (found ${added.length}); the instrument is data, the WAV exists only in page memory`);

// (3)(4) browser
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const WEB = process.env.STRUDEL_WEB_DIR;
const html = `<!doctype html><meta charset=utf8><script type=module>
import * as W from ${JSON.stringify(WEB ? '/web/dist/index.mjs' : 'https://unpkg.com/@strudel/web@1.3.0/dist/index.mjs')};
window.W = W; window.ready = true;</script>`;
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname); let f = null;
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(html); }
  if (u.startsWith('/web/') && WEB) f = path.join(WEB, u.slice(5)); else if (u.startsWith('/site/')) f = path.join(ROOT, 'site', u.slice(6));
  if (!f || !f.startsWith(WEB || ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(f).pipe(r);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
if (process.env.WF_DEBUG) page.on('console', (m) => console.log('console', m.text().slice(0, 200)));
await page.goto(`http://127.0.0.1:${srv.address().port}/`); await page.waitForFunction('window.ready', null, { timeout: 60000 });
const progs = {}; for (const [n, inst] of [['sine', sine], ['saw', saw]]) for (const m of ['A', 'B', 'C']) {
  const p = WF.program(inst, { mechanism: m, seed: 3 }); progs[n + m] = { code: p.code, key: p.key, wav: p.wav ? Array.from(p.wav) : null };
}
const res = await page.evaluate(async (progs) => {
  const W = window.W; await W.initStrudel({ prebake: () => W.defaultPrebake?.() }); const ac = W.getAudioContext(); await ac.resume(); await W.initAudio?.(); // loads the worklet modules the wavetable voice needs
  const an = ac.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (d, ...x) { if (d === ac.destination && this !== an) orig.call(this, an); return orig.call(this, d, ...x); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), td = new Float32Array(4096), fd = new Float32Array(2048);
  // poll every 8 ms (window 4096 samples is ~85 ms), so even a 46 ms burst is seen; keep the spectrum of the loudest poll
  async function meas(code, ms) {
    W.hush(); await sleep(900); let peak = 0, best = null; const prof = []; const t0 = performance.now();
    W.evaluate('setcps(2);' + code); // 0.5 s cycles: the wavetable voice skips a first hit while it decodes, the next one plays
    while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(td); let m = 0, e = 0; for (const v of td) { m = Math.max(m, Math.abs(v)); e += v * v; } prof.push([Math.round(performance.now() - t0), +Math.sqrt(e / td.length).toFixed(5)]); if (m > peak) { peak = m; an.getFloatFrequencyData(fd); best = Array.from(fd); } await sleep(8); }
    let num = 0, den = 0; if (best) best.forEach((db, i) => { const mg = 10 ** (db / 20); num += mg * i * ac.sampleRate / 4096; den += mg; });
    W.hush(); return { prof, peak: +peak.toFixed(4), centroid: Math.round(num / (den || 1)) };
  }
  const out = {}; const urls = {};
  for (const [name, p] of Object.entries(progs)) {
    if (p.wav) { urls[name] = URL.createObjectURL(new Blob([new Uint8Array(p.wav)], { type: 'audio/wav' })); await W.samples({ [p.key + '_' + name]: [urls[name]] }); }
  }
  for (const [name, p] of Object.entries(progs)) { const code = p.wav ? p.code.replace(`"${p.key}"`, `"${p.key}_${name}"`) : p.code; out[name] = await meas(code, 1800); }
  out.silent = await meas('silence', 400);
  return out;
}, progs);
await browser.close(); srv.close();
console.log(JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { peak: v.peak, centroid: v.centroid }]))));
for (const k of ['sineA', 'sineB', 'sineC', 'sawA', 'sawB', 'sawC']) ok(res[k].peak > 0.01 && res[k].peak < 0.891, `${k} plays: peak ${res[k].peak} (${(20 * Math.log10(res[k].peak)).toFixed(1)} dBFS) within -40..-1`);
// Sustain, not just presence: the longest stretch where the 85 ms RMS stays above 15% of its own maximum. A mute after 9 of 64 cycles must fail it.
const runMs = (prof, frac = 0.15) => { const mx = Math.max(...prof.map((q) => q[1])), thr = mx * frac; let best = 0, start = null, last = null; for (const [t, r] of prof) { if (r >= thr && mx > 0) { if (start === null) start = t; last = t; best = Math.max(best, last - start); } else start = null; } return best; };
for (const k of ['sineA', 'sineB', 'sineC', 'sawA', 'sawB', 'sawC']) ok(runMs(res[k].prof) >= 300, `${k} sustains: ${runMs(res[k].prof)} ms above 15% of its RMS peak (needs >= 300; the one-shot is ${Math.round(64 * 256 / 44.1)} ms long plus the 85 ms window)`);
{ // the check can fail: the same one-shot muted after 9 of 64 cycles, run through a sliding 4096-sample RMS at an 8 ms hop
  const rmsProfile = (x, sr = 44100) => { const o = []; for (let i = 0; i + 4096 <= x.length + 4096; i += Math.round(sr * 0.008)) { let e = 0; for (let j = Math.max(0, i - 4096); j < Math.min(x.length, i); j++) e += x[j] * x[j]; o.push([Math.round(i / sr * 1000), Math.sqrt(e / 4096)]); } return o; };
  const shot = WF.oneShot(saw), cut = shot.slice(); cut.fill(0, 9 * 256);
  const full = runMs(rmsProfile(shot)), muted = runMs(rmsProfile(cut));
  ok(full >= 300 && muted < 300, `sustain check discriminates: full one-shot ${full} ms, muted after 9 of 64 cycles ${muted} ms`);
  const q = (a, b) => Math.sqrt(shot.slice(a, b).reduce((e, v) => e + v * v, 0) / (b - a)), n = shot.length;
  ok(q(n - n / 8, n) > 0.1 * q(0, n / 8), `one-shot data: last eighth RMS ${q(n - n / 8, n).toFixed(3)} vs first eighth ${q(0, n / 8).toFixed(3)} (no silent tail)`);
}
ok(res.silent.peak < 0.001, `silence stays silent (peak ${res.silent.peak})`);
for (const m of ['A', 'B', 'C']) { const s = res['sine' + m].centroid, w = res['saw' + m].centroid; ok(Math.abs(w - s) / Math.min(w, s) > 0.2, `route ${m}: two shapes, different spectra (centroid sine ${s} Hz, saw ${w} Hz)`); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
