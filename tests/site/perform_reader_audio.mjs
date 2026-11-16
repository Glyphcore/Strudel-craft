// #118 / #114 follow-up: a bare tap("kick") reader answers its Perform pad live. Standalone: node tests/site/perform_reader_audio.mjs
// Per form (gain / mask / trigger): master-analyser peak while the Beatpad "kick" pad is idle (must be 0), held (> 0.01) and after release (back to 0).
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const { chromium } = createRequire(import.meta.url)('playwright'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const FORMS = {
  gain: '$: note("c4*8").s("sine").legato(1).gain(tap("kick"))\n',
  mask: '$: note("c4*8").s("sine").legato(1).mask(tap("kick"))\n',
  trigger: '$: tap("kick").note("c4").s("sine").legato(0.5)\n',
};
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const peak = (page, ms) => page.evaluate((ms) => new Promise((ok) => { let pk = 0; let buf = null; const iv = setInterval(() => { const an = window.__sc.Bus.an; if (!an) return; buf = buf || new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); }, 20); setTimeout(() => { clearInterval(iv); ok(+pk.toFixed(4)); }, ms); }), ms);
try {
  for (const [form, code] of Object.entries(FORMS)) { if (process.env.FORM && process.env.FORM !== form) continue;
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.evaluate(() => { localStorage.removeItem('sc.perform'); localStorage.removeItem('sc.perform.presets'); });
    await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, code);
    await page.evaluate(() => window.__sc.setView('perform')); await page.waitForFunction(() => window.strudelCraft.perform && window.strudelCraft.perform.presets, null, { timeout: 60000 });
    await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 90000 }); await page.waitForTimeout(1000);
    console.log('apply', await page.evaluate(() => window.strudelCraft.perform.presets.apply('beatpad-4x4'))); await page.waitForSelector('#perform .pp-pad:not([data-state=empty])'); await page.waitForTimeout(500);
    console.log(await page.evaluate(() => JSON.stringify([...document.querySelectorAll('.pp-pad')].slice(0,3).map(p=>[p.dataset.pos,p.dataset.state,p.textContent]))+document.querySelector('.pf-tab[aria-selected=true]').textContent));
    const orphan = await page.evaluate(() => document.querySelector('.pp-pad[data-pos="0,0"]').dataset.orphan || document.querySelector('.pp-pad[data-pos="0,0"]').textContent);
    const idle = await peak(page, 1200);
    const b = await page.locator('.pp-pad[data-pos="0,0"]').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    const held = await peak(page, 1600); await page.mouse.up(); await page.waitForTimeout(1500);
    const after = await peak(page, 1000);
    const pad = await page.evaluate(() => window.strudelCraft.hooks.journal.filter((e) => e.pad).map((e) => e.op + ':' + (e.args || [])[0] + '@' + e.cycle).join(' '));
    console.log(form, JSON.stringify({ idle, held, after, pad, label: String(orphan).slice(0, 30) }));
    check(`${form}: idle peak 0 (nothing sounds until the pad is held)`, idle < 0.002, String(idle));
    check(`${form}: held pad -> peak > 0.01`, held > 0.01, String(held));
    check(`${form}: after release the output returns to 0 ${form === 'trigger' ? '(one short hit, legato 0.5)' : ''}`, after < 0.002, String(after));
    check(`${form}: no audition voice (reader wins) and no console errors`, errs.length === 0, errs.slice(0, 2).join(' | ')); await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
