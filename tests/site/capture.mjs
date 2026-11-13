// Audio capture check (issue #72): `node tests/site/capture.mjs` (serves site/, needs playwright + network for unpkg).
// At 360x740: Record 2 cycles -> the take is listed with a non-silent waveform; WAV blob length and header are valid;
// recording survives a Rack -> Stack -> Rack tab switch; exact offline render gives N/cps*sr frames; 44px targets, no overflow.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.join(REPO, 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; }
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://localhost:${server.address().port}/index.html`;
let fail = 0; const ok = (name, pass, info = '') => { if (!pass) fail++; console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${info}` + (process.env.CAP_STACK ? ` [errs ${errs.length}]` : "")); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true });
const errs = [];
if (process.env.CAP_STACK) await page.addInitScript(() => { const c = AudioNode.prototype.connect; AudioNode.prototype.connect = function (d, ...r) { if (d && d.context && d.context !== this.context) console.warn('XCTX ' + this.constructor.name + '->' + d.constructor.name + ' ' + (this.context instanceof OfflineAudioContext) + '/' + (d.context instanceof OfflineAudioContext) + ' ' + new Error().stack.split('\n').slice(1, 9).join(' | ')); return c.call(this, d, ...r); }; });
page.on('console', (m) => { if (m.text().startsWith('XCTX')) console.log(m.text().slice(0, 1200)); }); page.on('pageerror', (e) => errs.push(String(e) + (process.env.CAP_STACK ? e.stack : ''))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text() + (process.env.CAP_STACK ? JSON.stringify(m.location()) : '')); });
await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('sc-capture'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.evaluate(() => { localStorage.setItem('sc.capture.mode', '"cycles"'); localStorage.setItem('sc.capture.n', '2'); localStorage.setItem('sc.capture.name', '"loop"'); });
await page.reload(); await page.waitForSelector('#list li[data-id]');
await page.click('#list li[data-id="minor-arp"] .row').catch(() => page.click('#list li[data-id] .row'));

// transport button + layout at 360
const lay = await page.evaluate(() => { const b = document.getElementById('capBtn').getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right, sw: document.documentElement.scrollWidth, tp: document.querySelector('.transport').scrollWidth }; });
ok('transport capture button 44px, no horizontal overflow at 360', lay.w >= 44 && lay.h >= 44 && lay.sw <= 360 && lay.tp <= 360 && lay.right <= 360, JSON.stringify(lay));
const pal = await page.evaluate(() => window.strudelCraft.palette.list().filter((i) => i.id.startsWith('capture.')).map((i) => i.id));
ok('palette actions registered', pal.length >= 4, pal.join(','));

await page.click('#capBtn'); await page.waitForSelector('#capSheet:not([hidden])');
const tgt = await page.evaluate(() => { const els = [...document.querySelectorAll('#capSheet button, #capSheet select, #capSheet input[type=text], #capSheet .cap-seg span')].filter((e) => e.getClientRects().length && !e.closest('[hidden]')); const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map((e) => e.id || e.className || e.textContent); const r = document.getElementById('capSheet').getBoundingClientRect(); return { n: els.length, small, left: r.left, right: r.right }; });
ok('sheet targets >= 44px and fit 360', tgt.small.length === 0 && tgt.left >= 0 && tgt.right <= 360, JSON.stringify(tgt));

// record 2 cycles from stopped: Record starts the transport, cuts on cycle boundaries
await page.click('#capRec');
await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'recording', null, { timeout: 90000 });
const tStart = Date.now();
await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'idle', null, { timeout: 20000 });
const recMs = Date.now() - tStart;
await page.waitForSelector('#capTakes li[data-id]');
const r = await page.evaluate(async () => {
  const C = window.strudelCraft.capture; const [m] = await C.list(); const t = await C.get(m.id);
  const blob = C.encodeWav(t, 16); const dv = new DataView(await blob.arrayBuffer()); const s4 = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  let o = 12, fmt = null, data = null; while (o + 8 <= dv.byteLength) { const id = s4(o), sz = dv.getUint32(o + 4, true); if (id === 'fmt ') fmt = { pcm: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) }; if (id === 'data') { data = { off: o + 8, size: sz }; break; } o += 8 + sz + (sz & 1); }
  const b24 = C.encodeWav(t, 24); const cv = document.querySelector('#capTakes li[data-id] canvas'); const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
  return { m: { name: m.name, frames: m.frames, sr: m.sr, cps: m.cps, cycles: m.cycles, exact: m.exact, peak: m.peak, src: !!m.source.code }, file: C.fileName(t, 'wav'), riff: s4(0), wave: s4(8), size: blob.size, riffLen: dv.getUint32(4, true), fmt, data, b24: b24.size, lit, total: cv.width * cv.height };
});
const want = Math.round(2 / r.m.cps * r.m.sr);
ok('take listed: 2 cycles, exact loop length', r.m.cycles === 2 && r.m.exact && r.m.frames === want, `frames ${r.m.frames} want ${want} (cps ${r.m.cps}, sr ${r.m.sr}, ${recMs} ms wall)`);
ok('non-silent take and waveform', r.m.peak > 0.01 && r.lit > r.total * 0.05, `peak ${r.m.peak.toFixed(3)}, waveform ${r.lit}/${r.total} px lit`);
ok('WAV 16 header valid, length = header + frames*4', r.riff === 'RIFF' && r.wave === 'WAVE' && r.riffLen === r.size - 8 && r.fmt && r.fmt.pcm === 1 && r.fmt.ch === 2 && r.fmt.sr === r.m.sr && r.fmt.bits === 16 && r.data.size === r.m.frames * 4 && r.data.off + r.data.size === r.size, JSON.stringify({ size: r.size, fmt: r.fmt, data: r.data }));
ok('WAV 24 length = frames*6 + header', r.b24 - r.size === r.m.frames * 2, `${r.b24} vs ${r.size}`);
ok('file name <name>_<cycles>c_<cps>cps.wav, sidecar has source', /^loop_2c_0\.5cps\.wav$/.test(r.file) && r.m.src, r.file);

// download via anchor (Blob + download attribute)
await page.click('#capTakes li[data-id] [data-act="dl"]');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#capTakes li[data-id] [data-act="wav16"]')]);
ok('download anchor delivers the WAV', dl.suggestedFilename() === r.file, dl.suggestedFilename());
const kn = await page.evaluate(() => [...document.querySelectorAll('.tp-knobs .kl b')].map((b) => [b.scrollWidth, Math.round(b.getBoundingClientRect().width), b.closest('.tp-knobs').getBoundingClientRect().right <= innerWidth]));
ok('transport knob readouts whole at 360 with the capture button', kn.every(([sw, w, inV]) => sw <= w + 1 && inV), JSON.stringify(kn));
await page.evaluate(() => { document.getElementById('capSheet').scrollTop = 0; });
await page.screenshot({ path: path.join(REPO, 'docs/screens/phone-360-capture.png') });

const [dc] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#capTakes li[data-id] [data-act="comp"]')]);
const cpath = await dc.path(); const csize = cpath ? fs.statSync(cpath).size : 0;
ok('compressed download (MediaRecorder)', /^loop_2c_0\.5cps\.(webm|ogg|m4a)$/.test(dc.suggestedFilename()) && csize > 2000, `${dc.suggestedFilename()} ${csize} B`);
// tab switch while recording (free mode): Rack -> Stack -> Rack, take keeps going
await page.click('#capSheet .cap-seg[data-k="mode"] label:has-text("Free")');
await page.click('#capRec'); await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'recording', null, { timeout: 10000 });
await page.evaluate(() => { location.hash = '#stack'; }); await page.waitForTimeout(1200);
const mid = await page.evaluate(() => ({ phase: window.strudelCraft.capture.state.phase, playing: window.strudelCraft.transport.playing }));
await page.evaluate(() => { location.hash = '#rack'; }); await page.waitForTimeout(1000);
await page.click('#capRec'); await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'idle', null, { timeout: 10000 });
const fr = await page.evaluate(async () => (await window.strudelCraft.capture.list())[0]);
ok('recording survives tab switches', mid.phase === 'recording' && fr.mode === 'free' && fr.seconds > 2, JSON.stringify({ mid, seconds: fr.seconds }));

// exact offline render
await page.evaluate(() => window.strudelCraft.capture.renderExact(2));
const ex = await page.evaluate(async () => (await window.strudelCraft.capture.list())[0]);
ok('render exact 2 cycles: sample-exact length, non-silent', ex.how === 'offline' && ex.frames === Math.round(2 / ex.cps * ex.sr) && ex.peak > 0.01 && ex.haps > 0 && ex.fails === 0, JSON.stringify({ how: ex.how, frames: ex.frames, peak: ex.peak, haps: ex.haps, fails: ex.fails }));
const lag = await page.evaluate(async () => {
  const C = window.strudelCraft.capture; const all = await C.list(); const rt = await C.get(all.find((m) => m.how === 'realtime' && m.mode === 'cycles').id), of = await C.get(all.find((m) => m.how === 'offline').id);
  const env = (x, sr) => { const hop = Math.round(sr / 1000), n = Math.floor(Math.min(x.length, sr * 3) / hop), e = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < hop; k++) s += x[i * hop + k] ** 2; e[i] = Math.sqrt(s / hop); } return e; };
  const a = env(rt.audio.L, rt.meta.sr), b = env(of.audio.L, of.meta.sr); let best = 0, bl = 0;
  for (let l = -60; l <= 60; l++) { let s = 0; for (let i = 300; i < Math.min(a.length, b.length) - 61; i++) s += a[i] * b[i + l]; if (s > best) { best = s; bl = l; } }
  return bl; });
ok('realtime cycle cut aligns with the exact render (onset lag <= 10 ms)', Math.abs(lag) <= 10, `lag ${lag} ms`);
const after = await page.evaluate(async () => { await window.__sc.play(); await new Promise((r) => setTimeout(r, 800)); return window.strudelCraft.transport.playing; });
ok('live playback works after an offline render', after);
// Syntax view example (docs-follow-code): load-and-play configures and opens capture
await page.evaluate(() => { window.strudelCraft.capture.close(); window.__sc.setView('syntax'); });
await page.waitForSelector('.sx-run[data-sec="capture"][data-i="0"]', { timeout: 15000 });
await page.click('.sx-run[data-sec="capture"][data-i="0"]');
await page.waitForFunction(() => window.strudelCraft.capture.opts.n === 4 && window.strudelCraft.capture.opts.name === 'arp-loop', null, { timeout: 30000 }).catch(() => {});
const sx = await page.evaluate(() => ({ n: window.strudelCraft.capture.opts.n, mode: window.strudelCraft.capture.opts.mode, open: !document.getElementById('capSheet').hidden, ui: document.getElementById('capN').textContent }));
ok('Syntax example configures and opens capture', sx.n === 4 && sx.mode === 'cycles' && sx.open && sx.ui === '4', JSON.stringify(sx));
ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => { window.__sc.setView('rack'); window.strudelCraft.capture.open(); }); await page.waitForTimeout(500);
await page.screenshot({ path: path.join(REPO, 'docs/screens/desktop-1440-capture.png') });
await browser.close(); server.close();
console.log(fail ? `capture: ${fail} FAIL` : 'capture: all PASS'); process.exit(fail ? 1 : 0);
