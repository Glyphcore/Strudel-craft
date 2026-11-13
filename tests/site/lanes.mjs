// Lanes L2 (#75), Playwright half: bus-reader seam measured with real superdough (@strudel/web 1.3.0, unmodified, from unpkg) in an
// OfflineAudioContext. Usage: node tests/site/lanes.mjs
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SWF = path.join(os.tmpdir(), 'strudel-web-1.3.0.js');
if (!fs.existsSync(SWF) || fs.statSync(SWF).size < 1e5) execFileSync('curl', ['-fsSL', '-o', SWF, 'https://unpkg.com/@strudel/web@1.3.0/dist/index.js']);
const SW = fs.readFileSync(SWF, 'utf8');
const CPS = 1, CYC = 8, SR = 48000;
const progs = {
  unsplit: `s("sine").freq(220).attack(0.005).release(0.005).sustain(1).slow(${CYC}).gain(0.5)`,
  split5: `stack(s("sine").freq(220).attack(0.005).release(0.005).sustain(1).slow(${CYC}).gain(0.5).dry(0).bus(64), s("bus").n(64).attack(0.005).release(0.005).gain(1))`,
  split: `stack(s("sine").freq(220).attack(0.005).release(0.005).sustain(1).slow(${CYC}).gain(0.5).dry(0).bus(64), s("bus").n(64).attack(0.01).release(0.01).gain(1))`,
};
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function render(code) {
  const page = await browser.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setContent('<html><body>x</body></html>'); await page.addScriptTag({ content: SW });
  const r = await page.evaluate(async ({ code, CPS, CYC, SR }) => {
    const W = window; const rep = await initStrudel(); await rep.evaluate(code, false);
    const pat = rep.scheduler.pattern || rep.state.pattern;
    const off = new OfflineAudioContext(2, CYC * SR + SR, SR); const live = getAudioContext();
    setAudioContext(off); setSuperdoughAudioController(null);
    try { await loadWorklets(); } catch (e) {}
    const haps = pat.queryArc(0, CYC, { _cps: CPS }).filter(h => h.hasOnset()).sort((a, b) => a.whole.begin - b.whole.begin);
    let n = 0, fails = [];
    for (const h of haps) { h.ensureObjectValue && h.ensureObjectValue(); try { await superdough(h.value, h.whole.begin.valueOf() / CPS, h.duration / CPS, CPS, h.whole.begin.valueOf()); n++; } catch (e) { fails.push(String(e)); } }
    const buf = await off.startRendering();
    return { n, fails: fails.slice(0, 3), haps: haps.length, data: Array.from(buf.getChannelData(0)), versions: { has_bus_sound: !!(window.soundMap && soundMap.get().bus) } };
  }, { code, CPS, CYC, SR });
  await page.close(); return { ...r, errs };
}
const out = {};
for (const k of Object.keys(progs)) { const r = await render(progs[k]); out[k] = Float32Array.from(r.data); console.log(k, 'haps', r.haps, 'played', r.n, r.fails, r.errs.slice(0, 2), r.versions); }
await browser.close();
const db = x => 20 * Math.log10(x);
function stats(x) {
  let maxStep = 0, ms = 0; for (let i = SR / 4; i < CYC * SR - SR / 4; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
  const w = Math.round(0.01 * SR), rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const ref = rms(SR / 2, SR * 1 - w - 100); const dev = [];
  for (let c = 1; c < CYC; c++) dev.push(db(rms(c * SR - w, c * SR + w) / ref));
  return { maxStep, dev };
}
const a = stats(out.unsplit), b = stats(out.split), c5 = stats(out.split5);
const step = x => (db(x.maxStep) - db(a.maxStep)), dev = x => Math.max(...x.dev.map((v, i) => Math.abs(v - a.dev[i])));
let nd = 0, ns = 0, mx = 0; for (let i = Math.round(0.05 * SR); i < (CYC - 0.05) * SR; i++) { const d = out.split[i] - out.unsplit[i]; nd += d * d; ns += out.unsplit[i] ** 2; mx = Math.max(mx, Math.abs(d)); }
console.log(`seam 10 ms attack/release: max step ${step(b).toFixed(3)} dB vs unsplit (tol 1), boundary level dev ${dev(b).toFixed(3)} dB (tol 0.1), interior diff ${db(Math.sqrt(nd / ns)).toFixed(1)} dB RMS`);
console.log(`seam  5 ms attack/release (design text): max step ${step(c5).toFixed(3)} dB, boundary level dev ${dev(c5).toFixed(3)} dB (superdough clamps release to >= 10 ms)`);
const ok = step(b) <= 1 && dev(b) <= 0.1;
console.log(ok ? 'PASS seam (site offline render): reader cross-fade is unity at 10 ms' : 'FAIL seam');
process.exit(ok ? 0 : 1);
