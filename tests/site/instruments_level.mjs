/* Level capture of recipes from t=0 (#183, #184): real browser, 360x780 touch profile, real network, a tap on every node connected to the audio destination (1024-sample blocks).
   Per recipe, on a fresh browser context (cold: empty HTTP/SW caches) and then again on the same page (warm): peak of the first 2 s after Play, steady-state peak (6 s to 12 s), clipped samples (>= 0.999).
   PASS = no clipped sample, steady peak within LEVEL (default 0.2,0.6), and first-2-seconds peak no more than 3 dB above the steady peak (the #184 onset burst: haps stacked while samples loaded).
   IDS=a,b selects recipes; LEVEL=lo,hi the steady range. tests/site/freepats_level.mjs runs this with the three FreePats recipes.
   Usage (repo root): node tests/site/instruments_level.mjs */
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
const IDS = (process.env.IDS || 'salamander-piano-chords,salamander-piano-melody,vcsl-marimba,vcsl-harp-pluck,vcsl-drum-kit').split(','), [LO, HI] = (process.env.LEVEL || '0.2,0.6').split(',').map(Number);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = [];
for (const id of IDS) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' }); const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }); await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.ensure('recipes'); });
  for (const phase of ['cold', 'warm']) {
    const r = await page.evaluate(async (id) => {
      const E = window.__sc.Engine; await E.load(); const ac = window.getAudioContext(); await ac.resume();
      if (!window.__tap) { const proc = ac.createScriptProcessor(1024, 2, 2), mute = ac.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(ac.destination); window.__tap = { proc, st: null };
        proc.onaudioprocess = (e) => { const t = window.__tap.st; if (!t) return; let pk = 0; for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; if (v >= 0.999) t.clip++; } } t.w.push([performance.now() - t.t0, pk]); };
        const orig = AudioNode.prototype.connect; AudioNode.prototype.connect = function (dst, ...a) { if (dst === ac.destination && this !== window.__tap.proc && this.context === ac) { try { orig.call(this, window.__tap.proc); } catch (e) { /* tap only */ } } return orig.call(this, dst, ...a); }; }
      const rr = window.strudelCraft.packs.resolve('recipes', id); if (!rr) throw new Error('no recipe ' + id);
      window.__tap.st = { t0: performance.now(), clip: 0, w: [] }; await E.play(rr.value.code, false, () => {}); await new Promise((ok) => setTimeout(ok, 12000));
      const t = window.__tap.st; window.__tap.st = null; E.stop(); await new Promise((ok) => setTimeout(ok, 1500));
      const mx = (a, b) => Math.max(0, ...t.w.filter((x) => x[0] >= a && x[0] < b).map((x) => x[1]));
      return { first2: mx(0, 2000), steady: mx(6000, 12000), clip: t.clip, blocks: t.w.length };
    }, id);
    console.log(`INFO ${id} ${phase}: first 2 s peak=${r.first2.toFixed(3)} steady peak=${r.steady.toFixed(3)} clipped=${r.clip}`);
    check(`${id} ${phase}: no clipped sample, steady peak ${LO}..${HI}, first-2-s peak within 3 dB of steady`, r.blocks > 200 && r.clip === 0 && r.steady >= +LO && r.steady <= +HI && r.first2 <= r.steady * 1.4142, JSON.stringify(r));
  }
  await ctx.close();
}
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
