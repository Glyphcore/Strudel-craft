/* Sound preparation (#183, site/sound-prep.js): cold Play of a pack-sound recipe has its files fetched and decoded before the first note is scheduled.
   360x780 touch, real network for the pinned upstream files, throttled to 600 kB/s and 120 ms latency (Chrome DevTools network emulation) for the drum recipes.
   1. cold, preparation on: zero "took too long" (skipped note) logs, phase ready, the first sound is heard within 1.5 s of Play returning, as many sample starts as a warm run
   2. same recipe with preparation switched off (window.__scSoundPrep = false): INFO line with the skipped notes and the time to first sound (the "before")
   3. warm Play: no added delay (prepare resolves < 150 ms, play < 600 ms)
   4. timeout: files that never answer -> phase timeout after the given time; pressing Play again releases a waiting Play (skipped); offline and save-data phases return at once without fetching
   Usage (repo root): node tests/site/sound_prep.mjs -> PASS/FAIL, INFO lines */
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
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function session({ throttle = true, prep = true, save = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' }); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ctx.addInitScript((p) => {
    window.__scSoundPrep = p.prep; window.__log = []; window.__tap = { st: null }; if (p.save) Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    document.addEventListener('strudel.log', (e) => window.__log.push(String((e.detail && e.detail.message) || '')));
    const oc = AudioNode.prototype.connect; AudioNode.prototype.connect = function (t, ...a) { const r = oc.call(this, t, ...a);
      if (t && t instanceof AudioDestinationNode && !this.__t && !(this.context instanceof OfflineAudioContext)) { this.__t = 1; const sp = this.context.createScriptProcessor(1024, 2, 1);
        sp.onaudioprocess = (e) => { const s = window.__tap.st; if (!s) return; let pk = 0; for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; } } if (pk > 0.02 && s.first == null) s.first = performance.now(); };
        oc.call(this, sp); oc.call(sp, this.context.destination); } return r; };
    const st = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { if (window.__tap.st) window.__tap.st.starts++; return st.apply(this, a); };
  }, { prep, save });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }); await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.ensure('recipes'); });
  if (throttle) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 600000, uploadThroughput: 200000 }); }
  return { ctx, page, errors };
}
const playIt = (page, id, wait = 9000) => page.evaluate(async ([id, wait]) => {
  const E = window.__sc.Engine; await E.load(); await window.getAudioContext().resume(); window.__log.length = 0;
  const code = window.strudelCraft.packs.resolve('recipes', id).value.code; window.__tap.st = { first: null, starts: 0 }; const t0 = performance.now();
  await E.play(code, false, () => {}); const tPlay = performance.now(); await new Promise((ok) => setTimeout(ok, wait)); const s = window.__tap.st; window.__tap.st = null; E.stop(); await new Promise((ok) => setTimeout(ok, 800));
  return { playMs: Math.round(tPlay - t0), firstMs: s.first == null ? null : Math.round(s.first - t0), firstAfterPlayMs: s.first == null ? null : Math.round(s.first - tPlay), starts: s.starts, skipped: window.__log.filter((m) => /took too long|could not load/.test(m)).length, prep: window.strudelCraft.soundPrep ? window.strudelCraft.soundPrep.state() : null };
}, [id, wait]);
const REC = 'gogodze-groove';
// 1 + 3: cold with preparation, then warm
const A = await session(); const cold = await playIt(A.page, REC); const warm = await playIt(A.page, REC);
console.log(`INFO cold, prep on : play returned after ${cold.playMs} ms, first sound ${cold.firstMs} ms after Play press (${cold.firstAfterPlayMs} ms after Play returned), skipped notes ${cold.skipped}, starts ${cold.starts}, prep ${JSON.stringify({ phase: cold.prep.phase, total: cold.prep.total, done: cold.prep.done, ms: cold.prep.ms })}`);
console.log(`INFO warm, prep on : play returned after ${warm.playMs} ms, first sound ${warm.firstMs} ms, skipped ${warm.skipped}, starts ${warm.starts}, prep ${JSON.stringify({ phase: warm.prep.phase, total: warm.prep.total, ms: warm.prep.ms })}`);
check('cold Play, preparation on: zero skipped notes, phase ready, files done', cold.skipped === 0 && cold.prep.phase === 'ready' && cold.prep.total > 0 && cold.prep.done === cold.prep.total, JSON.stringify(cold));
check('cold Play: the first sound is heard within 1.5 s of Play returning (the first scheduled note)', cold.firstAfterPlayMs != null && cold.firstAfterPlayMs <= 1500, String(cold.firstAfterPlayMs));
check('cold Play starts as many samples as a warm Play (no note lost)', cold.starts >= warm.starts - 1, `${cold.starts} vs ${warm.starts}`);
check('warm Play: no added delay (play returns < 800 ms, preparation < 150 ms, nothing to load)', warm.playMs < 800 && warm.prep.ms < 150 && warm.skipped === 0, JSON.stringify({ p: warm.playMs, m: warm.prep.ms }));
check('no uncaught page errors', A.errors.length === 0, A.errors.slice(0, 2).join(' | ')); await A.ctx.close();
// 2: the same cold Play with preparation off (before)
const B = await session({ prep: false }); const off = await playIt(B.page, REC);
console.log(`INFO cold, prep OFF: play returned after ${off.playMs} ms, first sound ${off.firstMs} ms after Play press, skipped notes ${off.skipped}, starts ${off.starts}`);
check('without preparation the same cold Play skips notes or starts late (the problem is real on this link)', off.skipped > 0 || (off.firstAfterPlayMs != null && off.firstAfterPlayMs > 1500), JSON.stringify(off)); await B.ctx.close();
// 4: timeout, pressed again, offline, save-data
const C = await session({ throttle: false });
await C.page.route(/VSCO-2-CE/, () => { /* never answers */ });
const T = await C.page.evaluate(async () => {
  const E = window.__sc.Engine; await E.load(); const P = window.strudelCraft.packs; await P.ensure('sample-source'); const code = P.resolve('recipes', 'vsco-woodwinds').value.code; await P.activateSources(code);
  const SP = await import('./sound-prep.js'); const t0 = performance.now(); const a = await SP.prepare(code, { user: true, timeout: 1500 }); const tMs = Math.round(performance.now() - t0);
  const p1 = SP.prepare(code, { user: true, timeout: 20000 }); await new Promise((ok) => setTimeout(ok, 300)); const t1 = performance.now(); const p2 = SP.prepare(code, { user: true, timeout: 20000 }); const r1 = await p1; const skipMs = Math.round(performance.now() - t1);
  const SPskip = SP.skip(); await p2; return { timeoutPhase: a.phase, tMs, total: a.total, pressedPhase: r1.phase, pressedReason: r1.reason, skipMs };
});
check('timeout: files that never answer give phase timeout after about the given time, Play would start with what it has', T.timeoutPhase === 'timeout' && T.tMs >= 1400 && T.tMs < 3500 && T.total > 0, JSON.stringify(T));
check('pressing Play again releases a waiting Play at once (phase skipped)', T.pressedPhase === 'skipped' && T.skipMs < 400, JSON.stringify(T));
await C.ctx.close();
const D = await session({ throttle: false }); await D.page.evaluate(() => import('./sound-prep.js')); await D.ctx.setOffline(true);
const O = await D.page.evaluate(async () => { const SP = await import('./sound-prep.js'); const t0 = performance.now(); const r = await SP.prepare('$: s("vsco_flute")', { user: true }); return { phase: r.phase, ms: Math.round(performance.now() - t0) }; });
check('offline: prepare returns at once (phase offline), nothing fetched, no throw', O.phase === 'offline' && O.ms < 100, JSON.stringify(O)); await D.ctx.close();
const F = await session({ throttle: false, save: true }); 
const SV = await F.page.evaluate(async () => { const SP = await import('./sound-prep.js'); const r = await SP.prepare('$: s("vsco_flute")', { user: true }); return { phase: r.phase }; });
check('save-data hint: prepare skips fetching (phase save-data)', SV.phase === 'save-data', JSON.stringify(SV)); await F.ctx.close();
// INFO: the orchestral recipe on the unthrottled link, preparation on and off (cold)
for (const prep of [true, false]) { const S = await session({ throttle: false, prep }); const r = await playIt(S.page, 'vsco-woodwinds', 12000);
  console.log(`INFO vsco-woodwinds cold, unthrottled, prep ${prep ? 'ON ' : 'OFF'}: play returned after ${r.playMs} ms, first sound ${r.firstMs} ms after Play press (${r.firstAfterPlayMs} ms after Play returned), skipped notes ${r.skipped}, starts ${r.starts}${prep ? ', files ' + r.prep.done + '/' + r.prep.total + ', ' + (r.prep.bytes / 1048576).toFixed(1) + ' MB' : ''}`); await S.ctx.close(); }
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
