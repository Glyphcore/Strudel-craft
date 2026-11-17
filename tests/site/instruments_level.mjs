/* referenced instrument recipes levels (#183): real browser capture of each recipe's mix at the audio destination (360x780 touch profile).
   A script processor taps every node connected to the context destination (after reverb, gain and the engine's own chain); per recipe it reports peak, samples over 0.99 and rms over 10 s.
   PASS = peak <= 0.98 and zero clipped samples. Usage (repo root): node tests/site/instruments_level.mjs (real network for the referenced maps; peak must land in 0.2 to 0.6) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length) || 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const body = p === 'sw.js' ? fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", "const VERSION = 'sc-fp-1';") : fs.readFileSync(f);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(body);
});
await new Promise((ok) => server.listen(0, ok)); const BASE = `http://localhost:${server.address().port}${PREFIX}`;
let fail = 0; const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); if (!ok) fail++; };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }); await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.ensure('recipes'); });
for (const id of (process.env.IDS ? process.env.IDS.split(',') : ['salamander-piano-chords', 'salamander-piano-melody', 'vcsl-marimba', 'vcsl-harp-pluck', 'vcsl-drum-kit'])) {
  const r = await page.evaluate(async (id) => {
    const E = window.__sc.Engine; await E.load(); const ac = window.getAudioContext(); await ac.resume();
    if (!window.__tap) { const proc = ac.createScriptProcessor(4096, 2, 2), mute = ac.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(ac.destination); window.__tap = { proc, st: null };
      proc.onaudioprocess = (e) => { const t = window.__tap.st; if (!t) return; for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > t.peak) t.peak = v; if (v > 0.99) t.clip++; t.sum += v * v; t.n++; } } };
      const orig = AudioNode.prototype.connect; AudioNode.prototype.connect = function (dst, ...a) { if (dst === ac.destination && this !== window.__tap.proc && this.context === ac) { try { orig.call(this, window.__tap.proc); } catch (e) { /* tap only */ } } return orig.call(this, dst, ...a); }; }
    const rr = window.strudelCraft.packs.resolve('recipes', id); if (!rr) throw new Error('no recipe ' + id + '; ings=' + JSON.stringify(window.strudelCraft.packs.list().filter((p) => /vcsl|salam/.test(p.id)).map((p) => [p.id, p.state, p.errors.map((e) => e.code), Object.fromEntries(Object.entries(p.ingredients || {}).map(([k, v]) => [k, v.state || v]))]))); const code = rr.value.code; await E.play(code, false, () => {}); await new Promise((ok) => setTimeout(ok, 14000));
    window.__tap.st = { peak: 0, clip: 0, sum: 0, n: 0 }; await new Promise((ok) => setTimeout(ok, 10000)); const t = window.__tap.st; window.__tap.st = null;
    try { await window.__sc.Engine.stop?.(); } catch (e) { /* ignore */ } return { peak: t.peak, clip: t.clip, rmsDb: 10 * Math.log10(t.sum / Math.max(1, t.n) + 1e-12), n: t.n };
  }, id);
  console.log(`INFO ${id}: peak=${r.peak.toFixed(3)} clipped=${r.clip} rms=${r.rmsDb.toFixed(1)} dBFS samples=${r.n}`);
  check(id + ': captured audio, peak in 0.2..0.6, no clipped sample', r.n > 100000 && r.peak >= 0.2 && r.peak <= 0.6 && r.clip === 0, JSON.stringify(r));
}
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
