// Mixer preset faders must change the audio of their own lane only (#113 critic). Standalone: node tests/site/perform_mix_audio.mjs
// Two sine lanes at 262 Hz (kick) and 784 Hz (bass); the master analyser's FFT peak near each frequency is the per-lane level.
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const require = createRequire(import.meta.url); const { chromium } = require('playwright'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const CODE = 'kick: note("c4*8").s("sine").gain(0.8).legato(1)\nbass: note("g5*8").s("sine").gain(0.8).legato(1)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  await page.evaluate(() => { localStorage.removeItem('sc.perform.presets'); });
  await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
  await page.evaluate(() => window.__sc.play());
  await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && window.strudelCraft.perform, null, { timeout: 90000 });
  await page.evaluate(() => window.__sc.setView('perform')); await page.waitForTimeout(500);
  await page.locator('#pfPresetBtn').click(); await page.waitForSelector('#pfPresets'); await page.locator('[data-preset="mixer-lanes"]').click(); await page.waitForSelector('#perform .pc-cell'); await page.waitForTimeout(2500);
  const code = await page.inputValue('#code');
  check('preset wrote the lane-qualified maps', /hooks\.map\('mix_kick', 'kick\.gain'\)/.test(code) && /hooks\.map\('mix_bass', 'bass\.gain'\)/.test(code));
  const lvl = () => page.evaluate(() => new Promise((ok) => { const an = window.__sc.Bus.an, sr = an.context.sampleRate, hz = sr / an.fftSize, f = new Float32Array(an.frequencyBinCount); const band = (c) => { let m = -200; for (let i = Math.round(c / hz) - 2; i <= Math.round(c / hz) + 2; i++) m = Math.max(m, f[i]); return m; };
    let k = -200, b = -200; const iv = setInterval(() => { an.getFloatFrequencyData(f); k = Math.max(k, band(262)); b = Math.max(b, band(784)); }, 25);
    setTimeout(() => { clearInterval(iv); ok({ kick: +k.toFixed(1), bass: +b.toFixed(1) }); }, 2000); }));
  const set = async (n, v) => { await page.evaluate(([n, v]) => window.strudelCraft.perform.controls.set(n, v), [n, v]); await page.waitForTimeout(1500); };
  const d = await lvl(); const z = (await set('mix_kick', 0), await lvl()); const h = (await set('mix_kick', 1.5), await lvl()); await set('mix_kick', 1);
  console.log('dB peaks (kick 262Hz / bass 784Hz): default', JSON.stringify(d), 'kick=0', JSON.stringify(z), 'kick=1.5', JSON.stringify(h));
  check('kick fader 0 silences the kick lane (>=30 dB down)', z.kick < d.kick - 30, `${d.kick} -> ${z.kick} dB`);
  check('kick fader 1.5 raises the kick lane (>= +2 dB)', h.kick > d.kick + 2, `${d.kick} -> ${h.kick} dB`);
  check('bass lane unchanged by the kick fader (within 2 dB)', Math.abs(z.bass - d.bass) < 2 && Math.abs(h.bass - d.bass) < 2, `${d.bass} / ${z.bass} / ${h.bass} dB`);
  await set('mix_bass', 0); const bz = await lvl();
  check('bass fader 0 silences bass only', bz.bass < d.bass - 30 && Math.abs(bz.kick - d.kick) < 2, JSON.stringify(bz));
} finally { await browser.close(); server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
