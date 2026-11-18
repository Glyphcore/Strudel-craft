/* Rolling timeline (#175): continuous scroll, follow modes (fixed / rolling / free), manual pan suspends follow, seek on the ruler, zoom bounds, lane row heights,
   empty-state lanes without solid fills, waveform in the Mix region after peaks arrive (synthetic buffer and a real offline render), keyboard, frame cost, no page errors.
   Runs at 1440x900, 1024x700 and 390x844 (touch). Writes docs/screens/timeline-390.png and timeline-1440.png.
   #195: lookahead (ghosted projection past the specified end), 5-minute scroll steps by wheel and by touch, mm:ss ruler; writes timeline-lookahead-{390,1440}.png.
   Usage (repo root): node tests/site/timeline.mjs   (wrap in engine/load/gate.sh medium) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = []; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const PROG = 'setcpm(240/4)\nbell: n("0 2 4 3").scale("C4:minor").s("triangle").decay(0.1).gain(0.03)\nbass: note("c2 ~ c2 g1").s("sine").gain(0.03)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const VPS = [[1440, 900, false], [1024, 700, false], [390, 844, true]].filter((v) => !process.env.TL_VP || String(v[0]) === process.env.TL_VP);
for (const [w, h, touch] of VPS) {
  const tag = `${w}x${h}`; const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(tag + ' ' + e.message)); const wait = (ms) => page.waitForTimeout(ms);
  const T = (f, a) => page.evaluate(f, a); const st = () => T(() => window.strudelCraft.timeline.state());
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html#rack`); await page.waitForSelector('#list li[data-id]', { timeout: 60000 }); await page.waitForFunction(() => window.strudelCraft.timeline, null, { timeout: 30000 });
  await T((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, PROG); await wait(500);
  /* empty state: no solid fills (canvas pixels in the lane rows are mostly transparent) */
  const empty = await T(() => { const s = window.strudelCraft.timeline.state(); const c = document.getElementById('lanes'), g = c.getContext('2d'), d = c.width / s.width; const y0 = Math.round((s.ruler + 4) * d), hh = Math.round((s.rowH - 8) * d), x0 = Math.round((s.gutter + 4) * d), ww = Math.round((s.width - s.gutter - 8) * d);
    const px = g.getImageData(x0, y0, ww, hh).data; let a = 0; const seen = new Set(); for (let i = 3; i < px.length; i += 4) { if (px[i] > 8) a++; if (seen.size < 50) seen.add(px[i - 3] + ',' + px[i - 2] + ',' + px[i - 1] + ',' + px[i]); } return { ratio: a / (px.length / 4), distinct: seen.size }; });
  check(`${tag}: empty Mix lane is not a filled cell (opaque pixel ratio < 0.2)`, empty.ratio < 0.2, JSON.stringify(empty));
  const cssH = await T(() => document.getElementById('tl').getBoundingClientRect().height); check(`${tag}: timeline panel has a real height (>= 120 px)`, cssH >= 119, cssH + ' px');
  await T(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 }); await wait(2500);
  let s = await st(); check(`${tag}: lanes appear from the pattern (bell, bass) after Play`, s.lanes.includes('triangle') && s.lanes.includes('sine'), s.lanes.join(','));
  check(`${tag}: #195 live tap: lanes and the Mix row draw waveform columns from the played audio (no buffers)`, s.wave.laneLive > 20 && s.wave.mixLive > 20 && s.wave.laneBuf === 0 && s.liveCycles > 0, JSON.stringify(s.wave));
  const lanePx = await T(() => { const s = window.strudelCraft.timeline.state(); const c = document.getElementById('lanes'), g = c.getContext('2d'), d = c.width / s.width; const im = g.getImageData(Math.round(s.gutter * d), Math.round((s.ruler + s.rowH + 3) * d), c.width - Math.round(s.gutter * d), Math.round((s.rowH - 6) * d)); let n = 0; const rowsHit = new Set(); for (let i = 3; i < im.data.length; i += 4) if (im.data[i] > 60) { n++; rowsHit.add(Math.floor((i >> 2) / im.width)); } return { cover: n / (im.data.length / 4), tall: rowsHit.size / im.height }; });
  check(`${tag}: #195 lane waveform regions use the lane height and are not filled cells (covered < 60 %)`, lanePx.tall > 0.6 && lanePx.cover < 0.6, `rows touched ${(lanePx.tall * 100).toFixed(0)} %, covered ${(lanePx.cover * 100).toFixed(1)} %`);
  check(`${tag}: lane row height >= ${touch ? 44 : 32} px`, s.rowH >= (touch ? 44 : 32), s.rowH + '');
  /* events: drawn rectangles equal the queried haps for bar 2 (index 1) */
  const ev = await T(() => { const sc = window.strudelCraft; const pat = sc.engineState().scheduler.pattern; const n = pat.queryArc(1, 2).filter((x) => x.hasOnset()).length; const r = sc.timeline.rects().filter((x) => x.b >= 1 && x.b < 2).length; return { n, r }; });
  check(`${tag}: drawn event rects for bar 2 equal the queried haps`, ev.n > 0 && ev.n === ev.r, JSON.stringify(ev));
  /* fixed mode: playhead x constant while scrollLeft advances */
  await T(() => { window.strudelCraft.timeline.setMode('fixed'); window.strudelCraft.timeline.setZoom(60); window.strudelCraft.range.seek(8); }); await wait(900);
  const f0 = await st(); await wait(3000); const f1 = await st();
  check(`${tag}: Fixed: scrollLeft advances over more than one bar`, f1.scrollLeft - f0.scrollLeft > f1.ppb, `${f0.scrollLeft} -> ${f1.scrollLeft} (ppb ${f1.ppb})`);
  check(`${tag}: Fixed: playhead x constant (+-3 px)`, Math.abs(f1.playheadX - f0.playheadX) <= 3, `${f0.playheadX} vs ${f1.playheadX}`);
  /* rolling: playhead moves right, then pages */
  await T(() => { const t = window.strudelCraft.timeline; t.setZoom(150); t.setMode('rolling'); window.strudelCraft.range.seek(30); }); await wait(700);
  const xs = []; for (let i = 0; i < 14; i++) { xs.push((await st()).playheadX); await wait(300); }
  let rose = 0, paged = 0; for (let i = 1; i < xs.length; i++) { if (xs[i] > xs[i - 1] + 3) rose++; if (xs[i] < xs[i - 1] - 40) paged++; }
  check(`${tag}: Rolling: the playhead moves right and the view pages at the edge`, rose >= 3 && paged >= 1, `rose ${rose}, paged ${paged}`);
  /* manual pan suspends follow, Follow re-follows */
  await T(() => { document.getElementById('tlScroll').scrollLeft += 120; }); await wait(300);
  s = await st(); check(`${tag}: manual pan suspends follow`, s.follow === 'suspended', s.follow);
  const sx0 = (await st()).scrollLeft; await wait(1200); check(`${tag}: suspended view stays put while playing`, Math.abs((await st()).scrollLeft - sx0) <= 2);
  await page.locator('#tl [data-act="follow"]').click(); await wait(300); s = await st(); check(`${tag}: Follow tap re-follows`, s.follow === 'on', s.follow);
  /* seek on ruler while playing, zoom bounds, toggle persistence */
  const box = await page.locator('#lanes').boundingBox(); await T(() => window.strudelCraft.timeline.setMode('off'));
  const before = (await st()).t; await page.mouse.click(box.x + s.gutter + 90, box.y + 8); await wait(400);
  const after = await st(); check(`${tag}: ruler tap seeks (cursor moved, playing clock follows)`, after.cursor > 0 && Math.abs(after.t - after.cursor) < 3 && after.t !== before, `cursor ${after.cursor.toFixed(2)}, t ${after.t.toFixed(2)}`);
  await T(() => { window.strudelCraft.timeline.setZoom(1); }); const zmin = (await st()).ppb; await T(() => { window.strudelCraft.timeline.setZoom(99999); }); const zmax = (await st()).ppb;
  check(`${tag}: zoom is bounded`, zmin === 6 && zmax === 260, zmin + ' .. ' + zmax);
  await page.locator('#tl [data-act="mode"]').click(); const m1 = (await st()).mode; await page.locator('#tl [data-act="mode"]').click(); const m2 = (await st()).mode;
  check(`${tag}: mode button cycles (off -> fixed -> rolling) and stores it`, m1 === 'fixed' && m2 === 'rolling' && (await T(() => localStorage.getItem('sc.tl.mode'))) === '"rolling"', m1 + ',' + m2);
  /* keyboard */
  await T(() => { window.strudelCraft.timeline.setZoom(70); document.getElementById('tlScroll').focus(); }); const z0 = (await st()).ppb; await page.keyboard.press('+'); const z1 = (await st()).ppb; await page.keyboard.press('ArrowRight'); const fk = (await st()).follow; await page.keyboard.press('f'); const fk2 = (await st()).follow;
  check(`${tag}: keyboard: + zooms, arrows pan (suspend), F re-follows`, z1 > z0 && fk === 'suspended' && fk2 === 'on', `${z0}->${z1} ${fk} ${fk2}`);
  /* frame cost while playing */
  await T(() => window.strudelCraft.timeline.setZoom(70)); await wait(500); const c0 = await T(() => window.__tl.cost.length); await wait(4000); const cost = await T((n) => { const a = window.__tl.cost.slice(n); return { n: a.length, avg: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length) }; }, c0);
  check(`${tag}: frame cost avg < 4 ms`, cost.n > 20 && cost.avg < 4, `${cost.avg.toFixed(2)} ms over ${cost.n} frames`);
  /* stop: cursor shown */
  await T(() => window.__sc.stop()); await wait(500); s = await st(); check(`${tag}: stopped: cursor stays where playback ended`, !s.playing && Math.abs(s.cursor - s.t) < 0.5 && s.cursor > 0, s.cursor.toFixed(2));
  /* waveform: synthetic 8-bar buffer fills the Mix region progressively */
  const px0 = await T(() => { const s = window.strudelCraft.timeline.state(); const c = document.getElementById('lanes'), g = c.getContext('2d'), d = c.width / s.width; return { y: Math.round((s.ruler + 3) * d), h: Math.round((s.rowH - 6) * d), x: Math.round(s.gutter * d), w: c.width - Math.round(s.gutter * d) }; });
  const count = () => T((r) => { const g = document.getElementById('lanes').getContext('2d'); const d = g.getImageData(r.x, r.y, r.w, r.h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; }, px0);
  await T(() => window.strudelCraft.timeline.setMode('off')); await T(() => { const t = window.strudelCraft.timeline; t.setZoom(60); document.getElementById('tlScroll').scrollLeft = 0; }); await wait(300); const n0 = await count();
  await T(() => { const sr = 8000, n = sr * 8; const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = Math.sin(i * 0.05) * Math.exp(-((i % (sr / 2)) / sr) * 9) * 0.9; window.strudelCraft.timeline.setAudio({ L, R: L, sr }, { start: 0, cycles: 8, cps: 1, name: 'synthetic' }); });
  await page.waitForFunction(() => { const a = window.strudelCraft.timeline.state().audio; return a && a.done === a.n; }, null, { timeout: 20000 }); await wait(200); const n1 = await count();
  check(`${tag}: waveform fills the Mix region after audio is known (pixels ${n0} -> ${n1})`, n1 > n0 + 100);
  const dens = await T((r) => { const g = document.getElementById('lanes').getContext('2d'); const d = g.getImageData(r.x, r.y, r.w, r.h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n / (d.length / 4); }, px0);
  check(`${tag}: waveform region is not a solid block (covered < 60 %)`, dens < 0.6, (dens * 100).toFixed(1) + ' %');
  if (w !== 1024) { await page.screenshot({ path: path.join(ROOT, `docs/screens/timeline-${w === 390 ? 390 : 1440}.png`) }); }
  if (w === 1440) { /* real offline render: the take's audio reaches the Mix row through the sc-take event */
    const ok = await T(async () => { try { const r = await window.strudelCraft.capture.recordOffline(2); return !!r; } catch (e) { return String(e); } });
    if (ok === true) { await page.waitForFunction(() => { const a = window.strudelCraft.timeline.state().audio; return a && a.name !== 'synthetic' && a.done === a.n; }, null, { timeout: 90000 }).then(() => check(`${tag}: an offline render takes over the Mix waveform`, true), (e) => check(`${tag}: an offline render takes over the Mix waveform`, false, 'timeout')); }
    else check(`${tag}: offline render available`, false, String(ok));
  }
  /* #195 lookahead: the projection past the specified end is ghosted; hand scrolling past the end extends to the next 5-minute mark (wheel on desktop, a touch swipe at 390) */
  await T((c) => { const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, PROG + '// @daw bars=8\n'); await wait(700);
  await T(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing, null, { timeout: 60000 }); await wait(1200); await T(() => window.__sc.stop()); await wait(400);
  await T(() => { const t = window.strudelCraft.timeline; t.setMode('off'); t.seek(0); t.refresh(); t.setZoom(60); document.getElementById('tlScroll').scrollLeft = 5 * 60; }); await wait(400);
  s = await st(); check(`${tag}: lookahead: specified end 8 bars (header), world = end + ${s.look} bars`, s.specEnd === 8 && s.endRule === 'header' && s.total === 16 && s.steps === 0, `end ${s.specEnd} (${s.endRule}), total ${s.total}`);
  const gh = await T(() => { const r = window.strudelCraft.timeline.rects(); return { solid: r.filter((x) => x.b < 8 && !x.ghost).length, ghost: r.filter((x) => x.b >= 8 && x.ghost).length, wrong: r.filter((x) => (x.b >= 8) !== x.ghost).length }; });
  check(`${tag}: lookahead: events past the end are ghosted, the others are not`, gh.solid > 0 && gh.ghost > 0 && gh.wrong === 0, JSON.stringify(gh));
  if (w !== 1024) await page.screenshot({ path: path.join(ROOT, `docs/screens/timeline-lookahead-${w === 390 ? 390 : 1440}.png`) });
  const lb = await page.locator('#lanes').boundingBox(); const steps = [];
  if (touch) { /* real touch swipes (CDP touch events, native scrolling); before each one the view is put 150 px short of the end, the swipe goes past it */
    const cdp = await ctx.newCDPSession(page); const y = Math.round(lb.y + lb.height * 0.6), xr = Math.round(lb.x + lb.width - 24), tp = (x) => [{ x, y, id: 1 }];
    for (let k = 0; k < 3; k++) {
      await T(() => { const e = document.getElementById('tlScroll'); e.scrollLeft = e.scrollWidth - e.clientWidth - 150; }); await wait(250);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(xr) }); for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(xr - i * 26) }); await wait(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(600); const q = await st(); steps.push([q.steps, Math.round(q.totalSec), q.scrollWidth, Math.round(q.scrollLeft)]);
    } }
  else { await page.mouse.move(lb.x + lb.width * 0.7, lb.y + lb.height * 0.6); for (let i = 0; i < 3; i++) { await page.mouse.wheel(200000, 0); await wait(500); const q = await st(); steps.push([q.steps, Math.round(q.totalSec), q.scrollWidth, Math.round(q.scrollLeft)]); } }
  check(`${tag}: lookahead: ${touch ? 'touch swipes' : 'wheel scrolls'} past the end extend to 5, 10, 15 min`, steps.map((x) => x[1]).join() === '300,600,900' && steps[2][0] === 3 && steps[2][2] >= 900 * 60, JSON.stringify(steps));
  await T(() => { document.getElementById('tlScroll').scrollLeft = 300 * 60 - 150; }); await wait(400); s = await st();
  check(`${tag}: lookahead: mm:ss ruler with a 05:00 mark, reachable by scrolling`, s.labels.some((l) => l.k === 'mark' && l.text === '05:00') && s.labels.some((l) => l.k === 'time' && /^\d\d:\d\d$/.test(l.text)) && s.steps === 3, s.labels.map((l) => l.text).join(' '));
  await ctx.close();
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
