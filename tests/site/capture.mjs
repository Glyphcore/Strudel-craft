// Record panel audio checks (#72): `node tests/site/capture.mjs` (serves site/, playwright + network for unpkg). Recovered from the pre-recipe
// capture test and updated for the Record panel (takes are recipes). At 360x740: 44px targets and no overflow, palette record.* actions, Record
// 2 cycles -> take listed with a non-silent waveform, exact loop length, WAV 16 / 24 header and length, file name <name>_<cycles>c_<cps>cps.wav,
// storage quota line, rename and delete through site modals, recording survives Rack -> Stack -> Rack, exact offline render length.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const errs = [];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true })).newPage();
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(`http://localhost:${server.address().port}/index.html`); await page.waitForSelector('#list li[data-id]');
await page.click('#list li[data-id] .row');
const lay = await page.evaluate(() => { const b = document.getElementById('capBtn').getBoundingClientRect(); return { w: b.width, h: b.height, sw: document.documentElement.scrollWidth }; });
ok('transport record button 44px, no horizontal overflow at 360', lay.w >= 44 && lay.h >= 44 && lay.sw <= 360, JSON.stringify(lay));
const pal = await page.evaluate(() => window.strudelCraft.palette.list().filter((i) => i.id.startsWith('record.')).map((i) => i.id));
ok('palette record.* actions registered', pal.length >= 4, pal.join(','));
await page.click('#capBtn'); await page.waitForSelector('#capSheet:not([hidden])');
await page.evaluate(() => window.strudelCraft.capture.configure({ audio: true, events: false, code: false, mode: 'cycles', n: 2, name: 'loop' }));
const tgt = await page.evaluate(() => { const els = [...document.querySelectorAll('#capSheet button, #capSheet select, #capSheet input[type=text], #capSheet .cap-seg span')].filter((e) => e.getClientRects().length); const small = els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 && r.width < 43.5; }).map((e) => e.id || e.className || e.tagName); return { n: els.length, small, right: Math.max(...els.map((e) => e.getBoundingClientRect().right)), left: Math.min(...els.map((e) => e.getBoundingClientRect().left)) }; });
ok('panel targets >= 44px (one side) and fit 360', tgt.small.length === 0 && tgt.left >= 0 && tgt.right <= 360.5, JSON.stringify(tgt));
const q = await page.textContent('#capQuota').catch(() => '');
ok('storage usage / quota line shown', /MB|Storage/.test(q || ''), q);

await page.click('#capRec');
await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'recording', null, { timeout: 90000 });
await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'idle', null, { timeout: 30000 });
await page.waitForSelector('#capTakes li[data-id]');
const r = await page.evaluate(async () => {
  const C = window.strudelCraft.capture; const [m] = await C.list(); const t = await C.get(m.id); const a = t.audio.capture;
  const parse = async (bits) => { const dv = new DataView(await C.encodeWav(a, bits).arrayBuffer()); const s4 = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); let o = 12, fmt = null, data = null;
    while (o + 8 <= dv.byteLength) { const id = s4(o), sz = dv.getUint32(o + 4, true); if (id === 'fmt ') fmt = { pcm: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) }; if (id === 'data') data = { size: sz, at: o + 8 }; o += 8 + sz + (sz & 1); }
    return { riff: s4(0), wave: s4(8), riffLen: dv.getUint32(4, true), total: dv.byteLength, fmt, data }; };
  let peak = 0; for (const x of a.L) peak = Math.max(peak, Math.abs(x));
  const cv = document.querySelector('#capTakes li[data-id] canvas'); const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
  return { cycles: m.timing.cycles, cps: m.timing.cps, frames: a.L.length, sr: a.sr, peak, lit, px: px.length / 4, w16: await parse(16), w24: await parse(24) };
});
const want = Math.round(2 / r.cps * r.sr);
ok('take listed: 2 cycles, exact loop length', r.cycles === 2 && r.frames === want, `frames ${r.frames} want ${want} (cps ${r.cps}, sr ${r.sr})`);
ok('non-silent take and waveform', r.peak > 0.01 && r.lit > r.px * 0.02, `peak ${r.peak.toFixed(3)}, waveform ${r.lit}/${r.px} px lit`);
const hdr = (w, bytes) => w.riff === 'RIFF' && w.wave === 'WAVE' && w.riffLen === w.total - 8 && w.fmt.pcm === 1 && w.fmt.ch === 2 && w.fmt.sr === r.sr && w.fmt.bits === bytes * 8 && w.data.size === r.frames * 2 * bytes;
ok('WAV 16 header valid, data = frames*4', hdr(r.w16, 2), JSON.stringify(r.w16.fmt) + ' ' + r.w16.data.size);
ok('WAV 24 header valid, data = frames*6', hdr(r.w24, 3), JSON.stringify(r.w24.fmt) + ' ' + r.w24.data.size);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#capTakes li[data-id] [data-act="wav"]')]);
ok('download anchor delivers <name>_<cycles>c_<cps>cps.wav', /^loop_2c_0\.5cps\.wav$/.test(dl.suggestedFilename()), dl.suggestedFilename());

// rename and delete go through site modals (no native dialogs)
let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
await page.click('#capTakes li[data-id] [data-act="rename"]'); await page.waitForSelector('dialog.scm[open] input');
await page.fill('dialog.scm[open] input', 'renamed'); await page.click('dialog.scm[open] .scm-ok');
await page.waitForFunction(async () => (await window.strudelCraft.capture.list())[0].name === 'renamed', null, { timeout: 5000 }).catch(() => {});
const nm = await page.evaluate(async () => (await window.strudelCraft.capture.list())[0].name);
await page.click('#capTakes li[data-id] [data-act="del"]'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm[open] .scm-ok');
await page.waitForFunction(async () => (await window.strudelCraft.capture.list()).length === 0, null, { timeout: 5000 }).catch(() => {});
const left = await page.evaluate(async () => (await window.strudelCraft.capture.list()).length);
ok('rename and delete via site modals, no native dialog', nm === 'renamed' && left === 0 && native === 0, `${nm} left ${left} native ${native}`);

// recording survives Rack -> Stack -> Rack (free mode)
await page.evaluate(() => window.strudelCraft.capture.configure({ mode: 'free', name: 'free' }));
await page.click('#capRec'); await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'recording', null, { timeout: 15000 });
await page.evaluate(() => { location.hash = '#stack'; }); await page.waitForTimeout(1200);
const mid = await page.evaluate(() => window.strudelCraft.capture.state.phase);
await page.evaluate(() => { location.hash = '#rack'; }); await page.waitForTimeout(1000);
await page.evaluate(() => window.strudelCraft.capture.stop());
await page.waitForFunction(() => window.strudelCraft.capture.state.phase === 'idle', null, { timeout: 15000 });
const fr = await page.evaluate(async () => { const l = await window.strudelCraft.capture.list(); const t = l.find((x) => x.name.startsWith('free')); const g = t && await window.strudelCraft.capture.get(t.id); return g ? g.audio.capture.L.length / g.audio.capture.sr : 0; });
ok('recording survives tab switches', mid === 'recording' && fr > 2, `${mid} ${fr.toFixed(2)} s`);

// exact offline render
await page.evaluate(() => window.strudelCraft.capture.configure({ code: true }));
const ex = await page.evaluate(async () => { const rec = await window.strudelCraft.capture.renderExact(2); const o = rec.recipe.outputs.render; return { frames: o.frames, sr: o.sr, cps: rec.recipe.timing.cps, haps: o.haps, fails: o.fails, how: o.how }; });
ok('render exact 2 cycles: sample-exact length, 0 failed', ex.how === 'offline' && ex.frames === Math.round(2 / ex.cps * ex.sr) && ex.haps > 0 && ex.fails === 0, JSON.stringify(ex));
ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
