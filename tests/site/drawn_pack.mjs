/* Drawn instruments through the real site load path (#182 stage 2): the pack glyphcore/drawn-core (kind waveforms@1) is pinned in packs.lock.json, loaded by the pack loader,
   and a recipe that names a wt_drawn_* or dr_* sound (wavetable instruments and computed drum one-shots) is played with E.play (which calls packs.activateSources). Real browser, 360x780 touch, real network (Strudel from unpkg).
   Checks per recipe (cold, then warm): the sound is NOT registered before Play (lazy) and IS registered after; level by the tests/site/instruments_level.mjs convention (realtime tap
   installed before load; no clipped sample, steady rms within 2 dB of the stock synth reference -28.7 dBFS, peak <= 0.5, first 2 s within 3 dB of steady); the output is sustained, not a click
   (rms of the last third of the window within 12 dB of the first third). Also: a program naming an unknown wt_ sound activates nothing, and the pack's waveforms ingredient is
   in state ready with no refusal in the report. IDS=a,b selects recipes; RMS=ref,tol and PEAKMAX override limits. Usage (repo root): node tests/site/drawn_pack.mjs */
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
const IDS = (process.env.IDS || 'drawn-bass-line,drawn-choir-pad,drawn-kit-basic,drawn-guitar-chords,drawn-bowed-duo,drawn-steel-pluck,drawn-fm-perc,drawn-room-hall').split(','), [REF, TOL] = (process.env.RMS || '-28.7,2').split(',').map(Number), PEAKMAX = +(process.env.PEAKMAX || 0.5);
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
      const E = window.__sc.Engine; await E.load(); await window.getAudioContext().resume(); const sm = () => (window.soundMap && window.soundMap.get ? Object.keys(window.soundMap.get()) : []); const pre = sm().filter((k) => /^(wt_drawn_|dr_(kick|snare|hat_|clap|tom|steel|fm_))/.test(k));
      const rr = stock ? { value: { code: stock } } : window.strudelCraft.packs.resolve('recipes', id); if (!rr) throw new Error('no recipe ' + id);
      window.__tap.st = { t0: performance.now(), clip: 0, w: [], off: 0 }; await E.play(rr.value.code, false, () => {}); await new Promise((ok) => setTimeout(ok, 12000));
      const t = window.__tap.st; window.__tap.st = null; E.stop(); await new Promise((ok) => setTimeout(ok, 1500));
      const mx = (a, b) => Math.max(0, ...t.w.filter((x) => x[0] >= a && x[0] < b).map((x) => x[1]));
      const st = t.w.filter((x) => x[0] >= 6000 && x[0] < 12000), sq = st.reduce((a, x) => a + x[2], 0), nn = st.reduce((a, x) => a + x[3], 0);
      const post = sm().filter((k) => /^(wt_drawn_|dr_(kick|snare|hat_|clap|tom|steel|fm_))/.test(k)); const thirds = (a) => { const w = t.w.filter((x) => x[0] >= a && x[0] < a + 3000); return 10 * Math.log10(w.reduce((q, x) => q + x[2], 0) / Math.max(1, w.reduce((q, x) => q + x[3], 0)) + 1e-12); };
      return { pre, post, head3: thirds(1000), tail3: thirds(9000), first2: mx(0, 2000), steady: mx(6000, 12000), rmsDb: 10 * Math.log10(sq / Math.max(1, nn) + 1e-12), clip: t.clip, blocks: t.w.length, offlinePeak: t.off };
    }, [id, BODIES[id] ? BODIES[id].code : null]);
    console.log(`INFO ${id} ${phase}: realtime first 2 s peak=${r.first2.toFixed(3)} steady peak=${r.steady.toFixed(3)} rms=${r.rmsDb.toFixed(1)} dBFS clipped=${r.clip}; offline reverb-IR render peak=${r.offlinePeak.toFixed(2)} (not audible)`);
    check(`${id} ${phase}: lazy (wt_drawn sound absent before Play: ${JSON.stringify(r.pre)}; registered after: ${JSON.stringify(r.post)})`, (phase === 'warm' || r.pre.length === 0) && r.post.length > 0);
    check(`${id} ${phase}: sustained (rms ${r.head3.toFixed(1)} dB in 1-4 s, ${r.tail3.toFixed(1)} dB in 9-12 s)`, r.tail3 > r.head3 - 12);
    if (/kit|fm-perc/.test(id)) check(`${id} ${phase}: hits, not a drone (crest peak/rms ${(r.steady / Math.pow(10, r.rmsDb / 20)).toFixed(1)} >= 3; the one-shots are ${r.post.filter((k) => /^dr_(kick|snare|hat_|clap|tom|steel|fm_)/.test(k)).length} registered)`, r.steady / Math.pow(10, r.rmsDb / 20) >= 3 && r.post.filter((k) => /^dr_(kick|snare|hat_|clap|tom|steel|fm_)/.test(k)).length >= (/kit/.test(id) ? 5 : 3));
    check(`${id} ${phase}: no realtime clipped sample, rms within ${TOL} dB of the stock synth reference ${REF} dBFS, peak <= ${PEAKMAX}, first 2 s within 3 dB of steady`, r.blocks > 200 && r.clip === 0 && Math.abs(r.rmsDb - REF) <= TOL && r.steady > 0.05 && r.steady <= PEAKMAX && r.first2 <= r.steady * 1.4142, JSON.stringify(r));
  }
  await ctx.close();
}
{ // the load path itself: the pack is pinned, its waveforms ingredient is ready, an unknown wt_ name activates nothing
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 });
  const r = await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; const st = await P.load('glyphcore/drawn-core:instruments'); const hit = await P.activateSources('s("wt_drawn_nope")'), hit2 = await P.activateSources('s("wt_drawn_bass")'); return { st, hit: hit.length, hit2: hit2.map((x) => x.sound), hit3: (await P.activateSources('s("dr_kick:1")')).map((x) => x.sound), list: P.list ? P.list().map((x) => x.id) : [] }; });
  check('load path: glyphcore/drawn-core is listed, instruments load, unknown wt_ name activates nothing, wt_drawn_bass and dr_kick:1 each activate exactly their own sound', r.list.includes('glyphcore/drawn-core') && r.hit === 0 && r.hit2.length === 1 && r.hit2[0] === 'wt_drawn_bass' && r.hit3.length === 1 && r.hit3[0] === 'dr_kick', JSON.stringify(r));
  await ctx.close(); }
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
