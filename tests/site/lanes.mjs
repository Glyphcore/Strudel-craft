// Lanes L2 (#75), Playwright half. Real superdough (@strudel/web 1.3.0, unmodified, from unpkg) in an OfflineAudioContext, programs compiled by
// site/engine/lanes.js. One PASS line per box that can be decided here; boxes that need the `strudel` CLI (another repo) print SKIP with the missing piece.
// Usage: node tests/site/lanes.mjs
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import crypto from 'crypto'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
import { compile } from '../../site/engine/lanes.js';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const PIN = /STRUDEL_WEB\s*=\s*'[^']*@strudel\/web@([\d.]+)/.exec(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'))?.[1] || '1.3.0';
const SWF = path.join(os.tmpdir(), `strudel-web-${PIN}.js`);
if (!fs.existsSync(SWF) || fs.statSync(SWF).size < 1e5) execFileSync('curl', ['-fsSL', '-o', SWF, `https://unpkg.com/@strudel/web@${PIN}/dist/index.js`]);
const SW = fs.readFileSync(SWF, 'utf8');
const CPS = 1, SR = 48000, CYC = 8;
const want = (k) => !process.env.LANES_ONLY || process.env.LANES_ONLY.split(',').includes(k); // LANES_ONLY=alloc,cost runs only those sections
const db = (x) => 20 * Math.log10(x);
const pass = (m) => console.log('PASS ' + m); const skip = (m, why) => console.log(`SKIP ${m}: ${why}`); const fail = (m) => { console.log('FAIL ' + m); process.exitCode = 1; };
const sha = (a) => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// the render pages are served over http (not about:blank): AudioWorklet modules (shape, crush, ...) cannot load into an offline context otherwise
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body>x</body></html>'); } if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;

// one fresh page per render: superdough's node pools are module-wide
async function render(code, { cycles = CYC, count = false } = {}) {
  const page = await browser.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '__blank'); await page.addScriptTag({ content: SW });
  const r = await page.evaluate(async ({ code, CPS, cycles, SR, count }) => {
    const rep = await initStrudel(); await rep.evaluate(code, false); const before = !!(window.soundMap && soundMap.get().bus);
    const host = { bus_sound: before, bus_control: typeof Pattern.prototype.bus === 'function' && typeof Pattern.prototype.busgain === 'function' && typeof Pattern.prototype.bmod === 'function' };
    const pat = rep.scheduler.pattern || rep.state.pattern;
    const off = new OfflineAudioContext(2, cycles * SR + SR, SR);
    setAudioContext(off); setSuperdoughAudioController(null);
    let wl = null; try { await loadWorklets(); } catch (e) { wl = String(e); }
    const nodes = {}; const undo = [];
    if (count) for (const n of ['OscillatorNode', 'GainNode', 'BiquadFilterNode', 'AudioBufferSourceNode', 'ConstantSourceNode', 'AudioWorkletNode', 'ConvolverNode', 'DelayNode', 'StereoPannerNode', 'WaveShaperNode', 'DynamicsCompressorNode']) {
      const C = window[n]; if (!C) continue; window[n] = new Proxy(C, { construct(t, a, nt) { nodes[n] = (nodes[n] || 0) + 1; if (n === 'AudioWorkletNode') { const k = n + ':' + a[1]; nodes[k] = (nodes[k] || 0) + 1; } return Reflect.construct(t, a, nt); } }); undo.push(() => { window[n] = C; });
      for (const f of Object.getOwnPropertyNames(BaseAudioContext.prototype).filter((k) => /^create/.test(k) && k.toLowerCase().includes(n.replace('Node', '').toLowerCase()))) { const o = BaseAudioContext.prototype[f]; BaseAudioContext.prototype[f] = function (...a) { nodes[n] = (nodes[n] || 0) + 1; return o.apply(this, a); }; undo.push(() => { BaseAudioContext.prototype[f] = o; }); }
    }
    const haps = pat.queryArc(0, cycles, { _cps: CPS }).filter((h) => h.hasOnset()).sort((a, b) => a.whole.begin - b.whole.begin);
    let n = 0; const fails = [];
    for (const h of haps) { h.ensureObjectValue && h.ensureObjectValue(); try { await superdough(h.value, h.whole.begin.valueOf() / CPS, h.duration / CPS, CPS, h.whole.begin.valueOf()); n++; } catch (e) { fails.push(String(e)); } }
    const t0 = performance.now(); const buf = await off.startRendering(); const ms = performance.now() - t0;
    undo.forEach((f) => f());
    return { wl, n, fails: fails.slice(0, 3), haps: haps.length, data: Array.from(buf.getChannelData(0)), ms, nodes, host };
  }, { code, CPS, cycles, SR, count });
  await page.close(); return { ...r, data: Float32Array.from(r.data), errs };
}
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
// diffDb compares [skipS, cyc - 50 ms]: the last reader fades out 10 ms after the last cycle, so the tail beyond the program is not compared
const diffDb = (a, b, skipS = 0.05, cyc = CYC) => { const i0 = Math.round(skipS * SR); const n = Math.min(a.length, b.length, Math.round((cyc - 0.05) * SR)); let d = 0, r = 0; for (let i = i0; i < n; i++) { d += (a[i] - b[i]) ** 2; r += a[i] ** 2; } return r === 0 ? (d === 0 ? -Infinity : Infinity) : db(Math.sqrt(d / r)); };
const lab = (t) => compile('x: ' + t).code;

// ---------- 1. host (site half) ----------
if (want('host')) {
  const r = await render('s("sine")', { cycles: 1 });
  if (!r.host.bus_sound || !r.host.bus_control || r.errs.length) fail(`Host: ${JSON.stringify(r.host)} ${r.errs[0] || ''}`);
  else pass(`Host (site half): @strudel/web ${PIN} (site pin, unpkg bundle ${SWF}, ${fs.statSync(SWF).size} bytes) has the "bus" sound registered (after initStrudel) and the bus, busgain, bmod controls; the stub-host E_LANE_HOST half is in tests/lanes/l2.mjs; the CLI's superdough version cannot be read here (CLI not in this repo)`);
}

// ---------- 2. seam (site offline render) ----------
const progs = {
  unsplit: `s("sine").freq(220).attack(0.005).release(0.005).sustain(1).slow(${CYC}).gain(0.5)`,
  split5: `stack(s("sine").freq(220).attack(0.005).release(0.005).sustain(1).slow(${CYC}).gain(0.5).dry(0).bus(64), s("bus").n(64).attack(0.005).release(0.005).gain(1))`,
};
const sine = 'x: s("sine").freq(220).attack(0.005).release(0.005).sustain(1).slow(8).gain(0.5)';
const out = !want('seam') ? {} : { unsplit: (await render(progs.unsplit)).data, split5: (await render(progs.split5)).data, split: (await render(compile(sine + '.split(d => d)').code)).data };
if (want('seam')) {
  const stats = (x) => { let maxStep = 0; for (let i = SR / 4; i < CYC * SR - SR / 4; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1])); const w = Math.round(0.01 * SR); const ref = rms(x, SR / 2, SR - w - 100); const dev = []; for (let c = 1; c < CYC; c++) dev.push(db(rms(x, c * SR - w, c * SR + w) / ref)); return { maxStep, dev }; };
  const a = stats(out.unsplit), b = stats(out.split), c5 = stats(out.split5);
  const step = (x) => db(x.maxStep) - db(a.maxStep); const dev = (x) => Math.max(...x.dev.map((v, i) => Math.abs(v - a.dev[i])));
  const interior = diffDb(out.unsplit, out.split);
  if (process.env.LANES_DEBUG) { let mi = 0, mv = 0; for (let i = 4800; i < out.split.length - 4800; i++) { const d = Math.abs(out.split[i] - out.unsplit[i]); if (d > mv) { mv = d; mi = i; } } console.log('DEBUG maxdiff', mv, 'at', mi / SR, 'split', out.split[mi], 'unsplit', out.unsplit[mi], 'rms ratio', rms(out.split, 4800, 300000) / rms(out.unsplit, 4800, 300000)); }
  const ok = step(b) <= 1 && dev(b) <= 0.1 && /^x: stack\(/.test(compile(sine + '.split(d => d)').code);
  console.log(`  seam: compiled .split(d => d): max step ${step(b).toFixed(3)} dB vs unsplit (tol 1), boundary level dev ${dev(b).toFixed(3)} dB (tol 0.1), interior diff ${interior.toFixed(1)} dB RMS; 5 ms reader (first draft): step ${step(c5).toFixed(3)} dB, level dev ${dev(c5).toFixed(3)} dB`);
  if (ok) pass('Seam, site offline render (compiled .split(d => d), 10 ms reader, 8 cycles): unity. The CLI render half is open'); else fail('Seam');
  skip('Seam, CLI render half', 'the `strudel render` command lives in another repo (engine/strudel-cli), not in this checkout');
}

// ---------- 3. parallel FX, merge, deterministic allocation (site offline renders) ----------
const SRC = 'note("c3 e3 g3 b3").s("triangle").release(0.1).gain(0.5)'; const SRC2 = 'note("c4 e4").s("sine").release(0.1).gain(0.4)'; const C4 = 4;
const R = {};
for (const [k, t] of Object.entries({
  plain: SRC, dry: `${SRC}.split(d => d)`, par: `${SRC}.split(d => d, w => w.lpf(300))`,
  merge: `${SRC}.split(a => a, b => b).merge(m => m.shape(0.5))`, post: `${SRC}.split(a => a, b => b).shape(0.5)`,
})) { const code = k === 'plain' ? 'x: ' + t : compile('x: ' + t).code; R[k] = await render(code, { cycles: C4 }); if (R[k].fails.length || R[k].errs.length) fail(`render ${k}: ${R[k].fails[0] || R[k].errs[0]}`); }
{
  const dd = diffDb(R.plain.data, R.dry.data, 0.02, C4); const pd = diffDb(R.dry.data, R.par.data, 0.02, C4);
  if (dd <= -60 && pd > -40 && rms(R.par.data) > 0) pass(`Parallel FX: split with branches d => d and w => w.lpf(300) differs from the dry-only split render (difference ${pd.toFixed(1)} dB re dry); the dry-only split render matches the unsplit source at ${dd.toFixed(1)} dB RMS of the difference (limit -60; the first 20 ms are skipped: the first reader fades in over 10 ms at playback start)`);
  else fail(`Parallel FX dd=${dd} pd=${pd}`);
}
{
  const g = compile('x: ' + `${SRC}.split(a => a, b => b).merge(m => m.shape(0.5))`); const gp = compile('x: ' + `${SRC}.split(a => a, b => b).shape(0.5)`);
  const md = diffDb(R.merge.data, R.post.data, 0.02, C4); const mergeBus = g.graph.audio.splits[0].merge;
  if (md > -60 && g.graph.diagnostics.length === 0 && gp.graph.diagnostics.some((d) => d.code === 'W_LANE_POST_SPLIT') && mergeBus === 65) pass(`Merge: .split(a, b).merge(m => m.shape(0.5)) renders ${md.toFixed(1)} dB (re merge) away from the same effect written after the split without merge, which raises W_LANE_POST_SPLIT; one merge reader (bus ${mergeBus}) per cycle is checked on the queried haps in tests/lanes/l2.mjs`);
  else fail(`Merge md=${md}`);
}
if (want('alloc')) {
  // rendered through the real page: lanes.prepare in the evaluation pipeline, then the site's exact offline renderer (deterministic: a copy of each hap value per superdough call, warm-up pass)
  const siteSha = async (source) => {
    const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    try {
      await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.click('#list li[data-id="minor-arp"] .row');
      await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, source);
      return await page.evaluate(async () => { const rec = await window.strudelCraft.capture.renderExact(2); const o = rec.recipe.outputs.render; return { sha: o.sha256, frames: o.frames, fails: o.fails }; });
    } finally { await page.close(); }
  };
  const V = "v: " + `${SRC2}.split(d => d)`; const U = 'u: note("c2").s("sine").gain(0).split(d => d)'; // u is an unrelated lane that plays nothing audible
  const A = V; const B = U + '\n' + V;
  const a = compile(A); const b = compile(B); const nums = (c) => JSON.stringify(c.graph.audio.splits.filter((s) => s.lane === 'v').map((s) => [s.lane, s.bus]));
  const ha = await siteSha(A); const hb = await siteSha(B); const ha2 = await siteSha(A);
  console.log(`  allocation: A ${ha.sha.slice(0, 16)} B (silent lane inserted above) ${hb.sha.slice(0, 16)} A again ${ha2.sha.slice(0, 16)}; frames ${ha.frames}, failed events ${ha.fails}`);
  if (nums(a) !== nums(b) && ha.sha === hb.sha && ha.sha === ha2.sha && !ha.fails) pass(`Deterministic allocation (render half, site exact render of 2 cycles): inserting an unrelated split lane above moves the lane's bus numbers (${nums(a)} vs ${nums(b)}) and the rendered audio SHA-256 is identical (${ha.sha.slice(0, 16)}...; the same program twice also matches)`);
  else fail(`Deterministic allocation ${nums(a)} ${nums(b)} ${ha.sha} ${hb.sha} ${ha2.sha}`);
}
if (want('sends')) {
  // sends: return level with the sends at 0 and at 0.3 (the return lane alone: the other lanes get dry(0), the stem recipe of docs/LANES.md 8, done by hand here)
  const send = (amt) => compile(`d: s("sine").note("c3").dry(0).send("verb", ${amt})\nv: ret("verb").room(0.5).lpf(3000)`);
  const r0 = await render(send(0).code, { cycles: 2 }); const r1 = await render(send(0.3).code, { cycles: 2 });
  console.log(`  sends (return lane alone, other lane dry(0)): level with sends 0 = ${rms(r0.data).toExponential(2)}, with 0.3 = ${rms(r1.data).toExponential(2)}`);
  if (rms(r0.data) < 1e-6 && rms(r1.data) > 1e-3) pass('Sends (site offline render, hand-made stem): the return lane is silent with both sends at 0 and sounds with 0.3; the `strudel stems` form of this box is open (CLI)');
  else fail('Sends');
}

// ---------- 4. cost (voices, nodes, render time) ----------
if (want('cost')) {
  const CH = 'note("[c3,e3,g3,b3]").s("supersaw").release(0.3)';
  const progsC = { layer: `x: ${CH}.layer(a => a, b => b.room(0.9), c => c.crush(5))`, split: compile(`x: ${CH}.split(a => a, b => b.room(0.9), c => c.crush(5))`).code };
  const cost = {};
  for (const k of Object.keys(progsC)) { const runs = []; for (let i = 0; i < 3; i++) runs.push(await render(progsC[k], { cycles: 4, count: true })); runs.sort((a, b) => a.ms - b.ms); const m = runs[1]; cost[k] = { haps: m.haps, played: m.n, osc: (m.nodes.OscillatorNode || 0) + Object.entries(m.nodes).filter(([k]) => /^AudioWorkletNode:supersaw/.test(k)).reduce((t, [, v]) => t + v, 0), nodes: Object.entries(m.nodes).filter(([k]) => !k.includes(':')).reduce((t, [, v]) => t + v, 0), ms: m.ms, ok: !m.fails.length && !m.errs.length }; }
  console.log('  cost (4 cycles, median of 3, offline): ' + JSON.stringify(cost));
  if (cost.layer.ok && cost.split.ok && cost.split.osc > 0 && cost.split.osc < cost.layer.osc && cost.split.nodes < cost.layer.nodes) pass(`Cost: 4-note supersaw chord, 3 branches, per cycle: .layer ${cost.layer.haps / 4} voices / ${cost.layer.osc / 4} oscillator sources / ${cost.layer.nodes / 4} nodes / ${cost.layer.ms.toFixed(0)} ms render for 4 cycles; .split ${cost.split.haps / 4} haps (4 source voices + 3 readers) / ${cost.split.osc / 4} oscillator sources / ${cost.split.nodes / 4} nodes / ${cost.split.ms.toFixed(0)} ms`);
  else fail('Cost ' + JSON.stringify(cost));
}
await browser.close();

// ---------- 5. site e2e: LANES 5.1 plays on the real page ----------
if (want('e2e')) {
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await b2.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const CODE = 'drums: s("bd*4, hh*8").lpf(4000)\n  .split(dry => dry,\n         wet => wet.room(0.9).rsize(6).lpf(900),\n         grit => grit.crush(5).hpf(2000).gain(0.4))';
  try {
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.click('#list li[data-id="minor-arp"] .row');
    await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
    await page.evaluate(() => window.__sc.play());
    await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 });
    await page.waitForTimeout(3500);
    const peak = await page.evaluate(() => document.getElementById('peakOut').textContent); const diag = await page.evaluate(() => (window.strudelCraft.lanes?.diagnostics?.() || []).map((d) => d.code));
    const p = parseFloat(peak); const live = Number.isFinite(p) && p > -60;
    await page.evaluate(() => window.__sc.stop && window.__sc.stop()); await page.waitForTimeout(300);
    let ex = null; try { ex = await page.evaluate(async () => { const rec = await window.strudelCraft.capture.renderExact(2); const o = rec.recipe.outputs.render; return { frames: o.frames, sr: o.sr, fails: o.fails, haps: o.haps, rms: Math.sqrt(rec.audio.render.L.reduce((s, v) => s + v * v, 0) / rec.audio.render.L.length) }; }); } catch (e) { ex = { err: String(e) }; }
    console.log(`  site: peak ${peak}, console errors ${errs.length}, diagnostics [${diag}], exact render of 2 cycles ${JSON.stringify(ex)}`);
    if (live && !errs.length && ex && !ex.err && ex.rms > 1e-4 && !ex.fails) pass(`Site: the LANES 5.1 program plays on the page (master peak ${peak}, no console errors) and the offline exact render of 2 cycles is non-silent (${ex.frames} frames at ${ex.sr} Hz); the match with the CLI render length is open (CLI)`);
    else fail(`Site e2e peak=${peak} errs=${errs.slice(0, 2)} ex=${JSON.stringify(ex)}`);
  } catch (e) { fail('Site e2e threw ' + e.message); }
  await b2.close();
}
server.close();
console.log(process.exitCode ? 'lanes site L2: FAIL' : 'lanes site L2 done');
