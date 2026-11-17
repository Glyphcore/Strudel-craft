/* Level capture of recipes from t=0 (#183, #184): real browser, 360x780 touch, real network. The tap is installed BEFORE page load (addInitScript) on every node that connects to the
   destination of a realtime AudioContext (one ScriptProcessor per node, 1024-sample blocks, peaks per 1 s window from the Play call).
   Offline contexts are excluded on purpose: Strudel renders its reverb impulse (`.room()`, an OfflineAudioContext: white noise through a lowpass) on the first reverb voice; its destination
   peaks near 1.0 about 1 s after Play but never reaches the speakers. #184 chased that as an "onset burst" (measured with offline contexts included: 0.93 to 1.05 in the first second on
   a45c244 and later; realtime only: 0.12 to 0.17 against steady 0.15 to 0.19). The check keeps both numbers visible and fails if the realtime output ever rises.
   Per recipe, fresh context (cold), then the same page again (warm): PASS = no realtime sample >= 0.999, steady rms (6 to 12 s, whole window incl. rests) within 2 dB of the stock synth reference -28.7 dBFS (mean of the stock recipes reese-style-detuned-bass -24.8, chord-stabs -33.9, minor-motif -27.4 measured by this same tap), steady peak 0.05..0.5, first 2 s no more than 3 dB above steady.
   IDS=a,b selects recipes (a stock recipe id from site/data/recipes/*.json plays its body); RMS=ref,tol and PEAKMAX override the limits. tests/site/freepats_level.mjs runs the FreePats recipes. Usage (repo root): node tests/site/instruments_level.mjs */
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
const IDS = (process.env.IDS || 'salamander-piano-chords,salamander-piano-melody,vcsl-marimba,vcsl-harp-pluck,vcsl-drum-kit').split(','), [REF, TOL] = (process.env.RMS || '-28.7,2').split(',').map(Number), PEAKMAX = +(process.env.PEAKMAX || 0.5);
const BODIES = {}; for (const f of fs.readdirSync(path.join(SITE, 'data/recipes'))) Object.assign(BODIES, JSON.parse(fs.readFileSync(path.join(SITE, 'data/recipes', f), 'utf8')).bodies || {}); // stock site recipes (synth references) are read from their body files
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = [];
for (const id of IDS) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' }); const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await ctx.addInitScript(() => {
    window.__tap = { st: null, offline: 0 }; const oc = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (t, ...a) {
      const r = oc.call(this, t, ...a);
      if (t && t instanceof AudioDestinationNode && !this.__t) { this.__t = 1;
        if (this.context instanceof OfflineAudioContext) { window.__tap.offline++; if (!this.__off) { this.__off = 1; const sp = this.context.createScriptProcessor(2048, 2, 1); sp.onaudioprocess = (e) => { const s = window.__tap.st; if (!s) return; for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > s.off) s.off = v; } } }; oc.call(this, sp); oc.call(sp, this.context.destination); } return r; }
        const c = this.context, sp = c.createScriptProcessor(1024, 2, 1);
        sp.onaudioprocess = (e) => { const s = window.__tap.st; if (!s) return; let pk = 0, sq = 0, nn = 0; for (let ch = 0; ch < e.inputBuffer.numberOfChannels; ch++) { const d = e.inputBuffer.getChannelData(ch); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sq += v * v; nn++; if (v >= 0.999) s.clip++; } } s.w.push([performance.now() - s.t0, pk, sq, nn]); };
        oc.call(this, sp); oc.call(sp, c.destination); }
      return r; };
  });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }); await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.ensure('recipes'); });
  for (const phase of ['cold', 'warm']) {
    const r = await page.evaluate(async ([id, stock]) => {
      const E = window.__sc.Engine; await E.load(); await window.getAudioContext().resume();
      const rr = stock ? { value: { code: stock } } : window.strudelCraft.packs.resolve('recipes', id); if (!rr) throw new Error('no recipe ' + id);
      window.__tap.st = { t0: performance.now(), clip: 0, w: [], off: 0 }; await E.play(rr.value.code, false, () => {}); await new Promise((ok) => setTimeout(ok, 12000));
      const t = window.__tap.st; window.__tap.st = null; E.stop(); await new Promise((ok) => setTimeout(ok, 1500));
      const mx = (a, b) => Math.max(0, ...t.w.filter((x) => x[0] >= a && x[0] < b).map((x) => x[1]));
      const st = t.w.filter((x) => x[0] >= 6000 && x[0] < 12000), sq = st.reduce((a, x) => a + x[2], 0), nn = st.reduce((a, x) => a + x[3], 0);
      return { first2: mx(0, 2000), steady: mx(6000, 12000), rmsDb: 10 * Math.log10(sq / Math.max(1, nn) + 1e-12), clip: t.clip, blocks: t.w.length, offlinePeak: t.off };
    }, [id, BODIES[id] ? BODIES[id].code : null]);
    console.log(`INFO ${id} ${phase}: realtime first 2 s peak=${r.first2.toFixed(3)} steady peak=${r.steady.toFixed(3)} rms=${r.rmsDb.toFixed(1)} dBFS clipped=${r.clip}; offline reverb-IR render peak=${r.offlinePeak.toFixed(2)} (not audible)`);
    check(`${id} ${phase}: no realtime clipped sample, rms within ${TOL} dB of the stock synth reference ${REF} dBFS, peak <= ${PEAKMAX}, first 2 s within 3 dB of steady`, r.blocks > 200 && r.clip === 0 && Math.abs(r.rmsDb - REF) <= TOL && r.steady > 0.05 && r.steady <= PEAKMAX && r.first2 <= r.steady * 1.4142, JSON.stringify(r));
  }
  await ctx.close();
}
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
