#!/usr/bin/env node
// Aliasing of the basic oscillators at C7 measured in headless Chromium (#106), with the same estimator as tools/racks/audit.mjs (power outside +-2 % of every harmonic of f0
// relative to the power at the harmonics, 0.3-1.8 s of a steady note). sine / triangle / sawtooth / square are raw OscillatorNodes in an OfflineAudioContext (what superdough
// builds); supersaw goes through the site's own render host (Stack program note("c7").s("supersaw"), supersaw phases are seeded by the render, so the number repeats).
//   PLAYWRIGHT_DIR=<path to playwright> node tools/racks/alias_chromium.mjs [--json OUT.json] [--no-supersaw]
import { createRequire } from 'module'; import fs from 'fs'; import http from 'http'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..'), STD = JSON.parse(fs.readFileSync(path.join(HERE, 'standard.json'), 'utf8')), SR = STD.test.sr, N = STD.test.fft, BIN = SR / N;
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2; const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
function aliasDb(x, f0) { const from = Math.round(0.3 * SR), to = Math.min(x.length, Math.round(1.8 * SR)); const P = new Float64Array(N / 2 + 1); let frames = 0; const re = new Float64Array(N), im = new Float64Array(N);
  for (let st = from; st + N <= to; st += N / 2) { for (let i = 0; i < N; i++) { re[i] = x[st + i] * HANN[i]; im[i] = 0; } fft(re, im); for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; frames++; }
  let harm = 0, rest = 0; for (let k = Math.ceil(100 / BIN); k < P.length; k++) { const f = k * BIN, h = Math.max(1, Math.round(f / f0)), tol = Math.max(6 * BIN, 0.02 * h * f0); if (Math.abs(f - h * f0) <= tol) harm += P[k]; else rest += P[k]; }
  return Math.round(10 * 10 * Math.log10(rest / harm)) / 10; }
const F0 = 440 * 2 ** ((96 - 69) / 12); // C7 = midi 96
const browser = await chromium.launch(); const page = await browser.newPage(); const out = { browser: browser.version(), sr: SR, note: 'c7', f0: +F0.toFixed(2), alias_db: {} };
const raw = await page.evaluate(async ({ sr, f0 }) => { const r = {}; for (const type of ['sine', 'triangle', 'sawtooth', 'square']) { const c = new OfflineAudioContext(1, 2 * sr, sr), o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f0; g.gain.value = 0.3; o.connect(g).connect(c.destination); o.start(0); r[type] = Array.from((await c.startRendering()).getChannelData(0)); } return r; }, { sr: SR, f0: F0 });
for (const [k, v] of Object.entries(raw)) out.alias_db[k] = aliasDb(Float64Array.from(v), F0);
if (!argv.includes('--no-supersaw')) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' }, SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
  const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); } p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const sp = await browser.newPage();
  await sp.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
  await sp.goto(`http://127.0.0.1:${server.address().port}${PREFIX}`); await sp.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.capture, null, { timeout: 90000 });
  const pcm = await sp.evaluate(async () => { const S = window.__sc.S; S.stackEdit = 'setcpm(30)\nnote("c7").s("supersaw").gain(0.4)'; window.__sc.setView('stack'); const C = window.strudelCraft.capture; C.configure({ source: 'offline', audio: true, events: false, code: true });
    const rec = await C.recordOffline(1, { at: 0, name: 'alias' }); if (!rec) return null; return { L: Array.from(rec.audio.render.L), sr: rec.audio.render.sr }; });
  if (pcm && pcm.sr === SR) out.alias_db.supersaw = aliasDb(Float64Array.from(pcm.L), F0); else out.alias_db.supersaw = null, out.supersawNote = pcm ? `render sr ${pcm.sr} != ${SR}` : 'no take';
  server.close();
}
await browser.close(); console.log(JSON.stringify(out)); if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(out, null, 1));
