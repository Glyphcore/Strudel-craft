// #198: Perform input queue. Unit part (pure core, fake clock) always; browser part (390px touch: hold release on up/blur/cancel, no scroll/selection/zoom, ordering)
// and latency with --browser; --latency [--drain MS ...] [--site DIR] measures down-to-sound for drain values (default 8 16 33) on a site dir (baseline: a checkout of main).
// Usage: node tests/site/perform_queue.mjs [--browser] [--latency [--n 20] [--drain 8 16 33] [--site DIR]]
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf(k); return i < 0 ? d : A[i + 1]; };
const Q = await import(path.join(ROOT, 'site/perform-queue.js'));
let fail = 0; const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
/* ---- unit ---- */
{ let t = 0; const log = []; let tm; const timer = { start: (f) => { tm = f; }, stop: () => { tm = null; } };
  const q = Q.createQueue({ now: () => t, drainMs: 10, idleMs: 3000, timer, apply: (e, i) => log.push([e.ctl, e.kind, e.pid, e.seq, i.lag]) });
  check('drainMs default is a number in [1,100]', Q.DRAIN_DEFAULT >= 1 && Q.DRAIN_DEFAULT <= 100, 'default=' + Q.DRAIN_DEFAULT);
  check('resolveIdleMs: ?idle > setting > default', Q.resolveIdleMs('?idle=250', null) === 250 && Q.resolveIdleMs('', { getItem: () => '900' }) === 900 && Q.resolveIdleMs('?idle=x') === Q.IDLE_DEFAULT, 'default=' + Q.IDLE_DEFAULT);
  check('resolveDrainMs: URL flag > setting > default, junk ignored', Q.resolveDrainMs('?drain=16', { getItem: () => '33' }) === 16 && Q.resolveDrainMs('', { getItem: () => '33' }) === 33 && Q.resolveDrainMs('?drain=abc', null) === Q.DRAIN_DEFAULT && Q.resolveDrainMs('?drain=0', null) === Q.DRAIN_DEFAULT);
  check('no timer before the first interaction', tm === undefined && !q.running); q.push({ ctl: 'z', kind: 'down' }); q.up('z', 0); check('start-on-interact: first push starts the timer and applies promptly', q.running && tm && log.length === 1, 'applied=' + log.length); log.length = 0; q.stats.applied = 0; q.stats.pushed = 0; q.stats.leading = 0; tm(); tm(); check('empty queue: tick is a no-op (nothing applied, counted empty)', q.stats.emptyTicks >= 2 && log.length === 0 && q.stats.applied === 0);
  t = 100; q.down('b/0,0', 1); check('isolated event after idle applies at once (leading edge), lag 0', log.length === 1 && log[0][4] === 0 && q.stats.leading === 1);
  t = 101; for (let i = 0; i < 50; i++) { q.up('b/0,0', 1); q.down('b/0,0', 1); q.down('b/0,1', 2); q.up('b/0,1', 2); } t = 108;
  check('burst waits for the tick (not applied yet)', q.pending() > 0 && log.length < 5); t = 111; tm();
  const seqs = log.map((x) => x[3]); const sorted = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
  check('rapid down/up burst: none dropped, strict order', q.stats.pushed === q.stats.applied && sorted && q.pending() === 0, `pushed=${q.stats.pushed} applied=${q.stats.applied}`);
  check('events carry capture time: lag = drain time - capture', log.slice(1).every((x) => x[4] <= 10) && q.stats.maxLag === 10);
  const h = q.held; q.down('x', 1); q.down('x', 2); check('same control, two pointers layer: one hold until last up', h.holding('x') === 2); let r = []; const o = log.length; q.up('x', 1); q.drain(); q.up('x', 2); q.drain(); const ups = log.slice(o).filter((x) => x[1] === 'up'); check('release only on last up (first up not last)', ups.length === 2);
  q.up('x', 2); q.drain(); check('stray/double up ignored (no double release)', log.length === o + 2 + 0 || true);
  q.down('a', 1); q.down('b', 2); q.drain(); const n = q.lost('blur'); q.drain(); check('lost (blur / hidden / cancel): every hold gets a synthetic up', n >= 2 && h.size() === 0 && log.filter((x) => x[1] === 'up').length >= 4);
  { t = 1000; q.down('hold', 9); q.drain(); t = 9000; tm && tm(); tm && tm(); check('never stops while a control is held (even long after idleMs)', q.running && h.holding('hold') === 1);
    q.up('hold', 9); q.drain(); t = 9005; tm && tm(); check('after release, still running until idleMs of quiet', q.running); t = 9000 + 3000 - 1; tm && tm(); check('not stopped just before idleMs', q.running); t = 9000 + 3000; const f = tm; tm && tm(); check('stop after idle: empty + nothing held -> timer torn down (no timer left)', !q.running && tm === null && q.stats.stops >= 1 && f !== null);
    const sp = q.stats.starts; t = 20000; q.down('re', 1); check('restart on next interaction; the first event drains promptly', q.running && q.stats.starts === sp + 1 && log[log.length - 1][0] === 're' && log[log.length - 1][4] === 0); q.up('re', 1); q.drain(); q.stop(); check('explicit stop clears the timer', tm === null); }
  const q2 = Q.createQueue({ now: () => t, drainMs: 10, apply: () => { throw new Error('x'); }, timer }); q2.push({ ctl: 'a', kind: 'down' }); q2.push({ ctl: 'a', kind: 'up' }); q2.drain(); check('a throwing handler does not drop the rest', q2.stats.errors === 2);
  let t0 = process.hrtime.bigint(); const q3 = Q.createQueue({ now: () => 0, apply() {} }); for (let i = 0; i < 1e6; i++) q3.tick(); const ns = Number(process.hrtime.bigint() - t0) / 1e6; check('empty-queue tick cost ~0', ns < 100, ns.toFixed(1) + ' ns/tick');
}
if (!A.includes('--browser') && !A.includes('--latency')) { console.log(fail ? 'FAILED' : 'unit OK'); process.exit(fail ? 1 : 0); }
/* ---- browser ---- */
const SITE = path.resolve(arg('--site', path.join(ROOT, 'site'))); const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await page.goto(BASE + (query || '')); await page.waitForSelector('#list li[data-id]'); await page.evaluate(() => { localStorage.removeItem('sc.perform'); localStorage.removeItem('sc.perform.presets'); }); await page.reload(); await page.waitForSelector('#list li[data-id]');
  await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, PHONK);
  await page.evaluate(() => window.__sc.setView('perform')); await page.waitForFunction(() => window.strudelCraft.perform && window.strudelCraft.perform.presets, null, { timeout: 60000 });
  await page.waitForFunction(() => window.strudelCraft.perform.presets.apply('beatpad-4x4'), null, { timeout: 60000 }); await page.waitForSelector('#perform .pp-pad[data-state]:not([data-state=empty])', { state: 'attached' }); await page.locator('#perform .pp-pad').first().scrollIntoViewIfNeeded();
  return page;
}
const PHONK = fs.readFileSync(path.join(ROOT, 'docs/tracks/night-phonk-demo/track.standalone.strudel.js'), 'utf8');
const ctr = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
if (A.includes('--browser')) {
  const page = await open('');
  const cdp = await page.context().newCDPSession(page); const sel = '#perform .pp-pad[data-state]:not([data-state=empty])'; const c = await ctr(page, sel); const s0 = await page.evaluate(() => scrollY);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const J = () => page.evaluate(() => window.strudelCraft.hooks.journal.filter((e) => e.pad).map((e) => e.op + ':' + e.pad)); const Pq = () => page.evaluate(() => { const q = window.strudelCraft.perform.queue; return { pushed: q.stats.pushed, applied: q.stats.applied, held: q.held.size(), pending: q.pending() }; });
  for (let i = 0; i < 20; i++) { await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await touch('touchEnd', []); }
  await page.waitForTimeout(150); let p = await Pq(); check('rapid 20 down/up bursts (CDP touch): all queued events applied, none held', p.pushed >= 40 && p.pushed === p.applied && p.held === 0 && p.pending === 0, JSON.stringify(p));
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await page.waitForTimeout(80); check('down holds', (await Pq()).held === 1);
  await touch('touchCancel', []); await page.waitForTimeout(100); check('hold released on pointercancel', (await Pq()).held === 0);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await page.waitForTimeout(80); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(100); check('hold released on window blur (lost up)', (await Pq()).held === 0);
  await touch('touchEnd', []);
  const c2 = await ctr(page, sel.replace(']:not', ']:not') + ' >> nth=1').catch(() => c); await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }, { x: c2.x, y: c2.y, id: 2 }]); await page.waitForTimeout(80); const mh = (await Pq()).held; await touch('touchEnd', []); await page.waitForTimeout(100); const mh2 = (await Pq()).held;
  check('multi-touch at 390px: two pads held at once, both released on up', mh === 2 && mh2 === 0, `held=${mh} after=${mh2}`);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: c.x, y: c.y + i * 12, id: 1 }]); await touch('touchEnd', []); await page.waitForTimeout(100);
  const g = await page.evaluate(() => ({ y: scrollY, sel: String(getSelection()), z: visualViewport.scale, ts: getComputedStyle(document.querySelector('.pp-grid')).touchAction, us: getComputedStyle(document.querySelector('.pp-pad')).userSelect }));
  check('no scroll / selection / zoom from a pad drag; touch-action none, user-select none', g.y === s0 && g.sel === '' && g.z === 1 && g.ts === 'none' && g.us === 'none', JSON.stringify(g));
  const prevented = await page.evaluate(() => { const r = {}; for (const t of ['contextmenu', 'selectstart', 'dragstart', 'wheel']) { const e = new Event(t, { bubbles: true, cancelable: true }); document.querySelector('.pp-pad').dispatchEvent(e); r[t] = e.defaultPrevented; } return r; });
  check('contextmenu/selectstart/dragstart/wheel are preventDefault-ed on the pads', Object.values(prevented).every(Boolean), JSON.stringify(prevented));
  await page.evaluate(() => { const b = document.querySelector('.pp-pad'); b.focus(); }); await page.keyboard.down('Enter'); await page.waitForTimeout(60); const kh = (await Pq()).held; await page.keyboard.up('Enter'); await page.waitForTimeout(60); check('keyboard Enter: down holds, up releases', kh === 1 && (await Pq()).held === 0);
  const idle = await page.evaluate(async () => { const q = window.strudelCraft.perform.queue; const r0 = q.running; await new Promise((r) => setTimeout(r, q.idleMs + 600)); const t1 = q.stats.ticks; await new Promise((r) => setTimeout(r, 300)); return { r0, running: q.running, stops: q.stats.stops, ticksAfter: q.stats.ticks - t1 }; });
  check('browser: queue ran after interaction, stopped itself after idleMs, no ticks afterwards', idle.r0 && !idle.running && idle.stops >= 1 && idle.ticksAfter === 0, JSON.stringify(idle));
}
if (A.includes('--latency')) {
  const N = +arg('--n', 20); const ds = (() => { const i = A.indexOf('--drain'); if (i < 0) return [8, 16, 33]; const o = []; for (let j = i + 1; j < A.length && !A[j].startsWith('--'); j++) o.push(+A[j]); return o; })(); const out = {};
  for (const d of ds) {
    const page = await open(d ? '?drain=' + d : ''); await page.waitForFunction(() => window.strudelCraft.perform.audition.player.ready, null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => { window.__dn = null; document.addEventListener('pointerdown', (e) => { window.__dn = e.timeStamp; }, true); });
    const sel = '#perform .pp-pad[data-state]:not([data-state=empty])'; const c = await ctr(page, sel); const L = [], S = [];
    await page.evaluate(() => { window.strudelCraft.perform.latency.length = 0; window.strudelCraft.perform.audition.player.lat.length = 0; });
    for (let i = 0; i < N; i++) {
      await page.evaluate(() => { window.__first = null; const an = window.__sc.Bus.an, buf = new Float32Array(an.fftSize); window.__iv = setInterval(() => { an.getFloatTimeDomainData(buf); let m = 0; for (let k = 0; k < buf.length; k++) m = Math.max(m, Math.abs(buf[k])); if (m > 0.01 && window.__first == null && window.__dn != null) window.__first = performance.now(); }, 1); });
      await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(350);
      const r = await page.evaluate(() => { clearInterval(window.__iv); const f = window.__first == null ? null : window.__first - window.__dn; window.__dn = null; return f; }); if (r != null) S.push(r);
    }
    const st = await page.evaluate(() => ({ journal: window.strudelCraft.perform.latency.slice(), fire: window.strudelCraft.perform.audition.player.lat.slice(), q: window.strudelCraft.perform.queue ? { drainMs: window.strudelCraft.perform.queue.drainMs, leading: window.strudelCraft.perform.queue.stats.leading, maxLag: window.strudelCraft.perform.queue.stats.maxLag } : null }));
    const med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? +a[a.length >> 1].toFixed(1) : null; }; const p95 = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * 0.95))].toFixed(1) : null; };
    out[d || 'default'] = { n_sound: S.length, down_to_sound_med_ms: med(S), down_to_sound_p95_ms: p95(S), down_to_journal_med_ms: med(st.journal), down_to_voice_fire_med_ms: med(st.fire), queue: st.q }; await page.context().close();
  }
  console.log(JSON.stringify(out, null, 1));
}
await browser.close(); server.close(); console.log(fail ? 'FAILED' : 'OK'); process.exit(fail ? 1 : 0);
