// Quick play (docs/QUICKPLAY.md): audition in place from Syntax examples/headers and Recipes rows. 390px touch. Standalone: node tests/site/quickplay.mjs
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = [], errors = [], nums = {};
const check = (n, ok, d = '') => { checks.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// master peak over a window (time domain)
const peak = (ms) => page.evaluate(async (ms) => { const B = window.__sc.Bus; let pk = 0, first = null; const buf = new Float32Array(2048); const t0 = performance.now();
  await new Promise((r) => { const iv = setInterval(() => { if (B.an) { B.an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); if (m > pk) pk = m; if (m > 0.002 && first == null) first = performance.now() - t0; } if (performance.now() - t0 > ms) { clearInterval(iv); r(); } }, 10); }); return { pk, first }; }, ms);
const snap = () => page.evaluate(() => ({ code: document.getElementById('code').value, st: document.getElementById('code').scrollTop, sy: window.scrollY, ae: document.activeElement && document.activeElement.id, playing: window.__sc.S.playing, view: window.__sc.S.view, hash: location.hash, sel: window.__sc.S.sel }));
const tap = (loc) => loc.tap();
try {
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  // ---- Recipes row ----
  const before = await snap();
  const row = page.locator('#list li .qp').nth(2); await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox(); check('recipe play target is >= 44px', box.width >= 44 && box.height >= 44, `${box.width}x${box.height}`);
  const t0 = Date.now(); await tap(row);
  await page.waitForFunction(() => document.querySelector('#list .qp[data-state="playing"]'), null, { timeout: 90000 }); nums.coldMs = Date.now() - t0;
  const pr = await peak(1500); check('recipe audition: master peak > 0 while playing', pr.pk > 0.005, 'peak ' + pr.pk.toFixed(3));
  const mid = await snap();
  check('no navigation, editor text/scroll/focus and main program untouched', mid.code === before.code && mid.st === before.st && mid.view === 'rack' && mid.playing === false && mid.sel === before.sel && mid.ae === before.ae, JSON.stringify({ a: mid.ae, b: before.ae, v: mid.view, p: mid.playing }));
  check('tray shows with Solo, Loop and Stop (44px)', await page.evaluate(() => { const t = document.getElementById('qptray'); return !t.hidden && [...t.querySelectorAll('button')].every((b) => b.getBoundingClientRect().height >= 44); }));
  // switch to another row
  const row2 = page.locator('#list li .qp').nth(3); await row2.scrollIntoViewIfNeeded(); await tap(row2);
  await page.waitForFunction(() => { const b = document.querySelectorAll('#list .qp'); return b[3].dataset.state === 'playing' && b[2].dataset.state === 'idle'; }, null, { timeout: 60000 });
  check('tapping another row switches the audition (one at a time)', true);
  await tap(row2); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 5000 });
  await page.waitForTimeout(250); const sil = await peak(400); check('master peak is 0 after stop', sil.pk < 0.003, 'peak ' + sil.pk.toFixed(4));
  // warm press-to-first-sound
  const t1 = Date.now(); await tap(row2); const w = await peak(1200); nums.warm = await page.evaluate(() => window.strudelCraft.quickplay.stats.pressToSoundMs); nums.warmPeakFirstMs = w.first;
  check('warm press-to-first-sound measured (target <= 150 ms; scheduled-sound estimate and analyser)', nums.warm != null, JSON.stringify({ est: nums.warm, an: w.first }));
  await tap(row2); await page.waitForTimeout(200);
  // stop-all on main Stop: start audition then press transport play twice (play then stop)
  await tap(row2); await page.waitForFunction(() => document.querySelector('.qp[data-state="playing"]'), null, { timeout: 30000 });
  await page.evaluate(() => window.__sc.stop()); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 3000 });
  check('transport Stop stops the audition', true);
  // 4 cycles then stop
  await tap(row2); await page.waitForFunction(() => document.querySelector('.qp[data-state="playing"]'), null, { timeout: 30000 });
  const t2 = Date.now(); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 40000 }); nums.runMs = Date.now() - t2;
  check('stops itself after 4 cycles', nums.runMs > 1000, nums.runMs + ' ms left after the first sound');
  // ---- Syntax ----
  await page.evaluate(() => window.__sc.setView('syntax')); await page.waitForSelector('#syntax .sx-groups', { state: 'attached' });
  await page.evaluate(() => window.strudelCraft.syntax.go('copy')); await page.waitForSelector('#sx-copy .sx-ex');
  const s0 = await snap();
  const hdr = page.locator('#sx-copy .sx-head ~ .qp, #sx-copy h3 .qp'); check('section header has a play button', await hdr.count() === 1);
  const ex = page.locator('#sx-copy .sx-ex .qp').first(); await ex.scrollIntoViewIfNeeded(); await tap(ex);
  await page.waitForFunction(() => document.querySelector('#sx-copy .sx-ex .qp[data-state="playing"]'), null, { timeout: 60000 });
  const sp = await peak(1200); check('Syntax example plays in place (peak > 0), still on the Syntax view', sp.pk > 0.005 && await page.evaluate(() => window.__sc.S.view) === 'syntax', 'peak ' + sp.pk.toFixed(3));
  const s1 = await snap(); check('Syntax play leaves editor text, scroll and main program alone and keeps the deep link', s1.code === s0.code && s1.st === s0.st && s1.playing === false && s1.hash === s0.hash, s1.hash);
  await tap(ex); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 5000 });
  // Strudel tab open: plays the lowered form; no plain form -> reason
  // pack-dependent example (atoms.import)
  await page.evaluate(() => window.strudelCraft.syntax.go('forms')); await page.waitForSelector('#sx-forms .sx-ex');
  const pk = page.locator('#sx-forms .sx-ex .qp').first(); await pk.scrollIntoViewIfNeeded(); await tap(pk);
  await page.waitForFunction(() => document.querySelector('#sx-forms .sx-ex .qp[data-state="playing"]') || document.querySelector('.toast.error'), null, { timeout: 90000 });
  const pp = await peak(1500); check('pack-dependent example (atoms.import) plays', pp.pk > 0.005, 'peak ' + pp.pk.toFixed(3));
  await page.evaluate(() => window.strudelCraft.quickplay.stop('fast')); await page.waitForTimeout(300);
  // disabled with reason
  await page.evaluate(() => window.strudelCraft.syntax.go('pads')); await page.waitForSelector('#sx-pads .sx-ex');
  const dis = page.locator('#sx-pads .sx-ex .qp[aria-disabled="true"]'); check('a page-API example has a disabled play with a reason', await dis.count() > 0 && !!(await dis.first().getAttribute('data-why')));
  await dis.first().scrollIntoViewIfNeeded(); const db = await dis.first().boundingBox(); await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2); await page.waitForSelector('.toast'); check('tapping a disabled play shows the reason and stays in place', (await page.evaluate(() => window.__sc.S.view)) === 'syntax');
  console.log(JSON.stringify(nums));
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('run to the end', false, e.stack); }
await browser.close(); server.close();
const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} passed`); process.exit(failed.length ? 1 : 0);
