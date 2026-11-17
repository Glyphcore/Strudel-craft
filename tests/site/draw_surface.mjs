/* Draw surface (#182 stage 3, docs/DRAWN_WAVEFORMS.md section 8): drives site/draw.js in Chromium at 390x844 (touch, phone) through the real page.
   Checks: the surface opens from the tools menu and has no file input, audio or video element (nothing to import or trace); a drag on the pad changes
   the drawn cycle; Hear sounds at once (destination peak between -40 and -1 dBFS) and a shape change reaches the sound within 300 ms (harmonic 2 of the
   preview moves by more than 10 dB, saw -> square); the envelope handle moves sustain; a morph keyframe is added; Save goes through the site modal
   (never a native dialog), the stored document passes validate() of site/engine/waveforms.js and round-trips (stored == surface output, also after a
   reload); Use in Rack puts s("wt_<id>") in the editor and Play through the real path (packs.activateSources, Strudel from unpkg) registers the sound and
   is audible; a tampered store entry is refused by validate() and registers nothing; a dropped file is refused with a toast. Frame time while hearing is
   printed (INFO). SHOTS=<dir> writes 390 px and 1440 px screenshots. Usage (repo root): node tests/site/draw_surface.mjs */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length) || 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(fs.readFileSync(f));
});
await new Promise((ok) => server.listen(0, ok)); const BASE = `http://localhost:${server.address().port}${PREFIX}`;
let fail = 0; const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); if (!ok) fail++; };
const SHOTS = process.env.SHOTS || '';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = [], natives = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => { // peak tap on every path into a destination (the preview context and Strudel's)
  window.__pk = 0; const oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (t, ...a) {
    const r = oc.call(this, t, ...a);
    if (t && t instanceof AudioDestinationNode && !this.__t && !(this.context instanceof OfflineAudioContext)) { this.__t = 1; const sp = this.context.createScriptProcessor(1024, 2, 1);
      sp.onaudioprocess = (e) => { for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > window.__pk) window.__pk = v; } } };
      oc.call(this, sp); oc.call(sp, this.context.destination); }
    return r; };
});
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => { natives.push(d.type()); d.dismiss(); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.drawn && window.strudelCraft.packs, null, { timeout: 60000 });
await page.evaluate(() => localStorage.removeItem('sc.drawn'));

// open from the tools menu (phone: behind the More button)
await page.click('#moreBtn'); await page.click('#drawBtn'); await page.waitForSelector('#drawSurface:not([hidden])', { timeout: 20000 });
const bad = await page.evaluate(() => document.querySelector('#drawSurface').querySelectorAll('input[type=file], audio, video').length);
check('surface opens from the tools menu; it has no file input, audio or video element (nothing to import or trace)', bad === 0, 'found ' + bad);
const probe = () => page.evaluate(async () => { const m = await import('./draw.js'); const s = m.probe.state(); return { frame: [...s.frames[s.sel]], frames: s.frames.length, env: s.env, inst: m.probe.instrument(), hearing: m.probe.hearing() }; });

// draw a stroke: two bumps across the pad
const before = (await probe()).frame, box = await page.locator('.dw-pad').boundingBox();
await page.mouse.move(box.x + 2, box.y + box.height * 0.5); await page.mouse.down();
for (let i = 0; i <= 40; i++) { const t = i / 40; await page.mouse.move(box.x + 2 + t * (box.width - 4), box.y + box.height * (0.5 - 0.42 * Math.sin(4 * Math.PI * t) * (t < 0.5 ? 1 : 0.4))); }
await page.mouse.up();
const drawn = (await probe()).frame, moved = drawn.filter((v, i) => Math.abs(v - before[i]) > 0.05).length;
check('a drag on the pad redraws the cycle (points changed of 64)', moved >= 32, moved + ' changed');

// hear at once
await page.evaluate(() => { window.__pk = 0; }); await page.click('.dw-hear'); await page.waitForTimeout(1200);
const pk = await page.evaluate(() => window.__pk), hearing = (await probe()).hearing;
check('Hear sounds the drawn cycle: destination peak between -40 and -1 dBFS', hearing && pk > 0.01 && pk < 0.891, `peak ${pk.toFixed(3)} (${(20 * Math.log10(pk || 1e-9)).toFixed(1)} dBFS)`);
const h2 = () => page.evaluate(async () => { const m = await import('./draw.js'), an = m.probe.analyser(), d = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(d); const bin = (hz) => d[Math.round(hz / (an.context.sampleRate / an.fftSize))]; return bin(2 * 130.813) - bin(130.813); });
await page.click('.dw-shapes button:text-is("saw")'); await page.waitForTimeout(300); const sawH2 = await h2();
const t0 = Date.now(); await page.click('.dw-shapes button:text-is("square")'); await page.waitForTimeout(300); const sqH2 = await h2(), lat = Date.now() - t0;
check('a shape change reaches the sound while hearing (harmonic 2 re harmonic 1 moves > 10 dB, saw -> square, read 300 ms after the tap)', sawH2 - sqH2 > 10, `saw ${sawH2.toFixed(1)} dB, square ${sqH2.toFixed(1)} dB, read after ${lat} ms`);
await page.evaluate(async () => (await import('./draw.js')).probe.resetFrames()); await page.waitForTimeout(2000);
const fr = await page.evaluate(async () => (await import('./draw.js')).probe.frames()); const srt = fr.slice().sort((a, b) => a - b);
console.log(`INFO frame time while hearing (scope + pad redraw at 390 px): ${fr.length} frames, median ${srt[srt.length >> 1]?.toFixed(1)} ms, p95 ${srt[Math.floor(srt.length * 0.95)]?.toFixed(1)} ms`);
await page.click('.dw-hear'); await page.waitForTimeout(200);
// redraw a freehand cycle for the saved instrument (keeps it the author's own shape)
await page.mouse.move(box.x + 2, box.y + box.height * 0.6); await page.mouse.down();
for (let i = 0; i <= 30; i++) { const t = i / 30; await page.mouse.move(box.x + 2 + t * (box.width - 4), box.y + box.height * (0.5 - 0.4 * Math.sin(2 * Math.PI * t) - 0.15 * Math.sin(6 * Math.PI * t))); }
await page.mouse.up();

// envelope: drag the decay/sustain handle down
await page.click('#dwTab-env'); const s0 = (await probe()).env.s, eb = await page.locator('.dw-envc').boundingBox();
const env0 = (await probe()).env; // handle position from the same geometry as draw.js: x = pad + segA + segD, y = pad + (1 - s) * (h - 2 pad)
const pad = 12, Wc = eb.width - 2 * pad, hx = eb.x + pad + (Wc / 4) * Math.sqrt(env0.a / 2) + (Wc / 4) * Math.sqrt(env0.d / 2), hy = eb.y + pad + (1 - env0.s) * (eb.height - 2 * pad);
await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx + 10, hy + eb.height * 0.3, { steps: 6 }); await page.mouse.up();
const env1 = (await probe()).env, readout = await page.textContent('.dw-envout');
check('the envelope handle moves sustain (and decay), shown in real units', env1.s < s0 - 0.1 && /S -?\d/.test(readout) && /ms|s/.test(readout), `${JSON.stringify(env0)} -> ${JSON.stringify(env1)}; "${readout}"`);

// morph: add a keyframe, give it a saw
await page.click('#dwTab-morph'); await page.click('.dw-key[aria-label^="Add a keyframe"]'); await page.click('.dw-shapes button:text-is("saw")');
check('morph: a second keyframe is added and drawn', (await probe()).frames === 2);

// save through the site modal
await page.click('.dw-save'); await page.waitForSelector('dialog.scm #dwName', { timeout: 5000 });
await page.fill('#dwName', 'Test Lead'); await page.fill('#dwWords', 'bright, buzzy, a bit hollow');
const hint = await page.textContent('#dwSound'); await page.click('dialog.scm .scm-ok'); await page.waitForTimeout(400);
const saved = await page.evaluate(async () => { const W = await import('./engine/waveforms.js'), doc = JSON.parse(localStorage.getItem('sc.drawn')), m = await import('./draw.js'); return { doc, errs: W.validate(doc), out: m.probe.instrument(), t: W.tables(doc.instruments[0]) && Object.keys(W.tables(doc.instruments[0])) }; });
const inst = saved.doc && saved.doc.instruments[0];
check('Save uses the site modal (no native dialog) and names the sound', natives.length === 0 && /wt_test_lead/.test(hint), `hint "${hint}", native dialogs ${natives.length}`);
check('the stored document passes validate() (waveforms@1): one drawn instrument with cycle, 2-frame morph and ADSR envelope', saved.errs.length === 0 && inst && inst.id === 'test-lead' && inst.origin === 'drawn' && inst.cycle.points.length === 65 && inst.morph.frames.length === 2 && inst.env.amp.points.length === 4, JSON.stringify(saved.errs.slice(0, 2)));
check('round trip: what is stored equals what the surface produces', JSON.stringify(inst) === JSON.stringify(saved.out));
const url = page.url(); await page.goto(url, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.drawn, null, { timeout: 60000 });
const rt = await page.evaluate(async () => { await window.strudelCraft.drawn.open('test-lead'); const m = await import('./draw.js'); return { a: JSON.stringify(m.probe.instrument()), b: JSON.stringify(JSON.parse(localStorage.getItem('sc.drawn')).instruments[0]), chip: document.querySelector('.dw-chip[aria-current=true]')?.textContent }; });
check('round trip after a reload: the saved instrument loads back into the surface unchanged', rt.a === rt.b && rt.chip === 'wt_test_lead', 'chip ' + rt.chip + (rt.a === rt.b ? '' : ' first difference at ' + [...rt.a].findIndex((c, i) => c !== rt.b[i]) + ': ' + rt.a.slice([...rt.a].findIndex((c, i) => c !== rt.b[i]) - 40).slice(0, 90) + ' vs ' + rt.b.slice([...rt.a].findIndex((c, i) => c !== rt.b[i]) - 40).slice(0, 90)));
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'draw-390.png') }); }

// use in Rack, then Play through the real path
await page.click('.dw-acts button:text-is("Use in Rack")'); await page.waitForTimeout(300);
const code = await page.evaluate(() => document.getElementById('code').value);
check('Use in Rack puts s("wt_test_lead") into the Rack editor and closes the surface', /s\("wt_test_lead"\)/.test(code) && await page.evaluate(() => document.querySelector('#drawSurface').hidden), code.split('\n').pop());
const play = await page.evaluate(async (c) => { const E = window.__sc.Engine; await E.load(); await window.getAudioContext().resume(); const sm = () => Object.keys(window.soundMap.get()); const pre = sm().includes('wt_test_lead'); window.__pk = 0; await E.play(c, false, () => {}); await new Promise((ok) => setTimeout(ok, 4000)); const pk = window.__pk; E.stop(); return { pre, post: sm().includes('wt_test_lead'), pk }; }, code);
check('Play registers wt_test_lead (lazily) and it sounds through Strudel: peak between -40 and -1 dBFS', !play.pre && play.post && play.pk > 0.01 && play.pk < 0.891, JSON.stringify(play));

// a tampered store is refused by validate(); a dropped file is refused
const tam = await page.evaluate(async () => { const D = window.strudelCraft.drawn, good = D.get('test-lead'), evil = { ...good, id: 'evil', title: 'data:audio/wav;base64,UklGRg' };
  const saveErr = await D.save(evil); localStorage.setItem('sc.drawn', JSON.stringify({ instruments: [good, evil] })); const hit = await D.activate('s("wt_evil")');
  return { saveErr: saveErr.map((e) => e.code), hit: hit.length, reg: Object.keys(window.soundMap.get()).includes('wt_evil') }; });
check('a tampered instrument is refused by validate() on save and on activation; nothing is registered', tam.saveErr.includes('E_WF_AUDIO') && tam.hit === 0 && !tam.reg, JSON.stringify(tam));
await page.evaluate(() => window.strudelCraft.drawn.open());
const drop = await page.evaluate(async () => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(64)], 'take.wav', { type: 'audio/wav' })); document.querySelector('#drawSurface').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await new Promise((ok) => setTimeout(ok, 100)); return [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '); });
check('a dropped audio file is refused with a toast (no-copy rule)', /not accepted/.test(drop), drop.slice(0, 120));
if (SHOTS) { await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'draw-1440.png') }); }
check('no uncaught page errors and no native dialogs', errors.length === 0 && natives.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
