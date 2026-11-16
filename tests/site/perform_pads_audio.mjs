// #116 regression: every preset's pads make sound out of the box (touch taps at 390px, master analyser). Standalone: node tests/site/perform_pads_audio.mjs
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = [], errors = [], nums = {};
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const PHONK = fs.readFileSync(path.join(ROOT, 'docs/tracks/night-phonk-demo/track.standalone.strudel.js'), 'utf8');
const NOAUD = process.env.NO_AUDITION === '1'; // measure the "before" numbers: the pads only journal
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// peak of the master analyser (time domain) in a window after a touch tap on a pad
const tapPeak = (page, sel, ms = 700) => page.evaluate(async ({ sel, ms }) => {
  const an = window.__sc.Bus.an; const buf = new Float32Array(an ? an.fftSize : 2048); let peak = 0, first = null; const t0 = performance.now();
  const iv = setInterval(() => { if (!window.__sc.Bus.an) return; window.__sc.Bus.an.getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; } if (m > peak) peak = m; if (first == null && m > 0.01) first = performance.now() - t0; }, 6);
  window.__tapStart = t0; await new Promise((r) => setTimeout(r, ms)); clearInterval(iv); return { peak, first };
}, { sel, ms });

async function run(label, code, cold) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  await page.evaluate(() => { localStorage.removeItem('sc.perform'); localStorage.removeItem('sc.perform.presets'); }); await page.reload(); await page.waitForSelector('#list li[data-id]');
  if (code) await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, code);
  await page.evaluate(() => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad, #perform [role=tab]', { timeout: 60000 });
  await page.waitForFunction(() => window.strudelCraft.perform && window.strudelCraft.perform.presets, null, { timeout: 30000 });
  if (NOAUD) await page.evaluate(() => { window.strudelCraft.perform.audition.enabled = false; });
  let firstTap = true;
  for (const id of ['beatpad-4x4', 'minimal']) {
    await page.evaluate((id) => window.strudelCraft.perform.presets.apply(id), id); await page.waitForSelector('#perform .pp-pad');
    if (!cold) { const t0 = Date.now(); await page.waitForFunction(() => window.strudelCraft.perform.audition.player.ready, null, { timeout: 90000 }).catch(() => {}); nums.bootMs = Date.now() - t0; }
    const pads = await page.locator('#perform .pp-pad[data-state]:not([data-state=empty])').count();
    const lab = await page.locator('#perform .pp-pad .pp-ref').allInnerTexts();
    check(`${label} / ${id}: every pad is labelled with what it triggers`, lab.length === pads && lab.every((t) => /^♪ \w+/.test(t)) || NOAUD, lab.slice(0, 4).join(','));
    const silent = [], peaks = [], firsts = [];
    for (let i = 0; i < pads; i++) {
      const sel = `#perform .pp-pad:not([data-state=empty]) >> nth=${i}`; await page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - innerHeight * 0.35); }); await page.waitForTimeout(30); const box = await page.locator(sel).boundingBox();
      const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const p = e && e.closest('.pp-pad'); return p ? p.dataset.pos : (e && (e.className || e.tagName)); }, [box.x + box.width / 2, box.y + box.height / 2]); if (hit !== (await page.locator(sel).getAttribute('data-pos'))) nums.blocked = (nums.blocked || []).concat(`${label}/${id}#${i}:${hit}`);
      const scroll0 = await page.evaluate(() => window.scrollY); const sp = tapPeak(page, sel, firstTap ? (cold ? 30000 : 1500) : 500);
      if (firstTap) await page.waitForTimeout(50);
      if (process.env.DBG) console.log(i, JSON.stringify(box), await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.className || e.tagName) + ' ' + (e.closest('.pp-pad') || {}).dataset?.pos; }, [box.x + box.width / 2, box.y + box.height / 2]));
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      let r; if (firstTap) { // wait until the first sound arrives, then stop sampling early is not possible (single evaluate): accept the 25 s window
        r = await sp; firstTap = false; nums[label + '_firstTapMs'] = r.first; if (cold) check('cold first tap (engine not loaded yet) still sounds', r.peak > 0.01, JSON.stringify(r)); } else r = await sp;
      if (cold && i === 0 && !silent.length) { /* first pad measured above */ }
      peaks.push(+r.peak.toFixed(3)); if (r.first != null) firsts.push(r.first); if (r.peak < 0.01) silent.push(i);
      if ((await page.evaluate(() => window.scrollY)) !== scroll0) silent.push('scrolled' + i);
    }
    nums[`${label}/${id}`] = { pads, minPeak: Math.min(...peaks), medFirstMs: firsts.sort((a, b) => a - b)[Math.floor(firsts.length / 2)] };
    check(`${label} / ${id}: all ${pads} pads audible on the analyser (peak > 0.01), no scrolling`, silent.length === 0 && pads > 0, `silent=${JSON.stringify(silent)} peaks=${peaks.join(' ')}`);
    const last = await page.evaluate(() => window.strudelCraft.hooks.journal.filter((e) => e.pad).map((e) => e.op));
    check(`${label} / ${id}: presses still journaled (pad:tap entries)`, last.includes('pad:tap'), last.join());
  }
  const st = await page.evaluate(() => ({ err: window.strudelCraft.perform.audition.player.error, n: window.strudelCraft.perform.audition.player.count, lat: window.strudelCraft.perform.audition.player.lat.slice(-16), state: window.__sc.audio.state }));
  nums[label + '/player'] = st; check(`${label}: audio unlocked by the first tap, no player error`, st.state === 'running' && !st.err, JSON.stringify({ state: st.state, err: st.err }));
  // a reader wins: add tap("kick") to the code, the kick pad no longer auditions
  if (!NOAUD) { await page.evaluate(() => { const ta = document.getElementById('code'); ta.value += '\nconst r = tap("kick")\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); window.strudelCraft.perform.presets.apply('beatpad-4x4'); });
    await page.waitForSelector('#perform .pp-pad[data-pos="0,0"]'); const n0 = await page.evaluate(() => window.strudelCraft.perform.audition.player.count);
    await page.touchscreen.tap(...await page.locator('.pp-pad[data-pos="0,0"]').boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])); await page.waitForTimeout(200);
    check(`${label}: a pad the program reads (bare tap("kick")) does not audition`, (await page.evaluate(() => window.strudelCraft.perform.audition.player.count)) === n0); }
  if (label === 'demo') { await page.screenshot({ path: '/tmp/perform_pads_390.png' }); }
  await ctx.close();
}
try {
  await run('cold-demo', null, true);
  await run('demo', null);
  await run('night-phonk-demo', PHONK);
  check('every pad is reachable by touch (nothing overlays it once scrolled into view)', !nums.blocked, JSON.stringify(nums.blocked));
  console.log(JSON.stringify(nums));
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('run to the end', false, e.stack); }
await browser.close(); server.close();
const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} passed`); process.exit(failed.length ? 1 : 0);
