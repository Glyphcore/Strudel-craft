// #198 field report: 3 simultaneous pad taps at 5 Hz for >= 20 s on 390px touch; every tap must journal, start a voice and be heard.
// Usage: node tests/site/perform_spam.mjs [--secs 20] [--site DIR] [--q "?drain=8"]
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf(k); return i < 0 ? d : A[i + 1]; };
const SITE = path.resolve(arg('--site', path.join(ROOT, 'site'))); const SECS = +arg('--secs', 20); const Qs = arg('--q', '');
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}/`;
const pad = (c, ref) => ({ pos: '0,' + c, target: { kind: 'tap', ref }, label: ref });
const MODEL = { tabs: [{ kind: 'bank', id: 'A', name: 'A' }], active: 0, perform: true, banks: { A: { id: 'A', rows: 4, cols: 4, pads: [pad(0, 'kick'), pad(1, 'hat'), pad(2, 'snare')] } }, boards: {}, controls: {}, maps: [], automation: {} };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); const page = await ctx.newPage();
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.evaluate((m) => localStorage.setItem('sc.perform', JSON.stringify(m)), MODEL); await page.goto(BASE + Qs); await page.waitForSelector('#list li[data-id]');
await page.evaluate(() => { const ta = document.getElementById('code'); ta.value = 'kick2: s("bd*2").gain(0)\nsetcps(0.5)\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); window.__sc.play(); });
await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && window.strudelCraft.perform, null, { timeout: 90000 });
await page.evaluate(() => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad'); await page.waitForFunction(() => window.strudelCraft.perform.audition.player.ready, null, { timeout: 90000 }).catch(() => {}); await page.waitForTimeout(2000);
const P = []; for (const c of [0, 1, 2]) { const bb = await page.locator(`.pp-pad[data-pos="0,${c}"]`).boundingBox(); P.push({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, id: c + 1 }); }
const cdp = await ctx.newCDPSession(page); const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
await page.evaluate(() => { const an = window.__sc.Bus.an, buf = new Float32Array(an.fftSize); window.__S = []; window.__iv = setInterval(() => { an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); window.__S.push([performance.now(), m]); }, 2); const p = window.strudelCraft.perform; window.__c0 = { count: p.audition.player.count }; window.__j0 = (p.journal || []).length; });
const rounds = Math.round(SECS * 5); const marks = [];
for (let i = 0; i < rounds; i++) { const t0 = Date.now(); marks.push(await page.evaluate(() => performance.now())); await touch('touchStart', P); await new Promise((r) => setTimeout(r, 40)); await touch('touchEnd', []); await new Promise((r) => setTimeout(r, Math.max(0, 200 - (Date.now() - t0)))); }
await page.waitForTimeout(500);
const R = await page.evaluate((marks) => { clearInterval(window.__iv); const p = window.strudelCraft.perform; /* heard = a fresh onset: peak in [mark, mark+150ms) exceeds the quietest level of the 100 ms before it by > 0.01 */ const heard = marks.map((m) => { const S = window.__S; const pre = S.filter(([t]) => t >= m - 100 && t < m).map((x) => x[1]); const post = S.filter(([t]) => t >= m && t < m + 150).map((x) => x[1]); return post.length && Math.max(...post) - (pre.length ? Math.min(...pre) : 0) > 0.01; }); const q = p.queue; return { missed: heard.map((h, i) => h ? -1 : i).filter((i) => i >= 0).join(), heard: heard.filter(Boolean).length, voices: p.audition.player.count - window.__c0.count, held: q ? q.held.size() : 0, qstats: q ? q.stats : null, err: p.audition.player.error, journal: (p.journal || []).length - window.__j0, state: window.__sc.audio.state }; }, marks);
const taps = rounds * 3; let fail = 0; const check = (n, ok, d) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
console.log(JSON.stringify({ rounds, taps, ...R }));
check(`${taps} taps (3 x ${rounds} at 5 Hz): every tap started a voice`, R.voices === taps && !R.err, `voices=${R.voices}/${taps} err=${R.err}`);
check('every round audible on the analyser (>= 98%)', R.heard >= rounds * 0.98, `heard=${R.heard}/${rounds}`);
check('nothing held at the end (no stuck hold)', R.held === 0, 'held=' + R.held);
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
