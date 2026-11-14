// Playwright test for the UI side of the sandbox host (issue #71): Code tab (switch, trust list, revoke), gesture-only grants, consent invariants
// (links, ?pack= proposals and history restores never grant or switch code on) and the sandboxed control renderer (slot, label, focus, clamp,
// fallback, clickjacking). Usage: node tests/site/packs_code_ui.mjs. Fixtures are generated into a temp dir; screenshots go to $SHOTS or the temp dir.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const GEN = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-codeui-'));
const SHOTS = process.env.SHOTS || GEN;
const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const put = (rel, text) => { const p = path.join(GEN, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return Buffer.from(text); };

// ---------------------------------------------------------------- fixtures
function mkPack(dir, id, ings) { // ings: [{id, kind, format, entry, modules: {path: src}}]
  const list = ings.map((g) => { const e = put(`${dir}/${g.id}.json`, JSON.stringify(g.entry));
    const mods = Object.entries(g.modules || {}).map(([p, src]) => { const b = put(`${dir}/${p}`, src); return { path: p, realm: 'sandbox', hash: sha(b), bytes: b.length }; });
    return { id: g.id, kind: g.kind, format: g.format, version: '1.0.0', path: g.id + '.json', hash: sha(e), bytes: e.length, ...(mods.length ? { code: true, modules: mods } : {}) }; });
  put(`${dir}/craftpack.json`, JSON.stringify({ craftpack: '1.0.0', id, version: '1.0.0', license: 'CC0-1.0', authors: [{ name: 'testco' }], ingredients: list }, null, 1) + '\n');
}
mkPack('prov', 'testco/prov', [{ id: 'prov', kind: 'intellisense-provider', format: 'intellisense-provider@1', entry: { id: 'prov', module: 'prov.js' }, modules: { 'prov.js': `craft.handle('complete', () => [{ label: 'zzfx', category: 'Fixture' }]);` } }]);
// control-types: a dial drawn in the sandbox; `input` proposes values far outside min..max so the host has to clamp
const DIAL = `craft.handle('draw', ({ value, min, max, w, h, dpr }) => { const c = craft.canvas(); if (!c) return { drawn: false }; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d'); g.fillStyle = 'rgb(255,0,255)'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = 'rgb(0,255,0)'; g.fillRect(0, 0, c.width * (value - min) / (max - min || 1), c.height); return { drawn: true }; });
craft.handle('input', (e) => ({ set: e.kind === 'key' ? (e.key === 'ArrowUp' || e.key === 'End' ? 1e9 : -1e9) : e.x * 1000 }));`;
const SLOW = `craft.handle('draw', () => new Promise(() => {})); craft.handle('input', () => new Promise(() => {}));`;
const ctlPack = (dir, id, src) => mkPack(dir, id, [{ id: 'dial', kind: 'control-types', format: 'control-types@1', entry: { types: [{ id: id.replace('/', '.') + '.dial', value: 'number', label: 'Dial', render: { fallback: 'knob' }, renderer: { module: 'dial.js' } }] }, modules: { 'dial.js': src } }]);
ctlPack('dial', 'testco/dial', DIAL); ctlPack('slowdial', 'testco/slowdial', SLOW);

const TYPES = { '.mjs': 'text/javascript', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const hits = [];
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); hits.push(p);
  let f; if (p.startsWith('/fx/')) f = path.join(GEN, p.slice(4)); else { const q = p.endsWith('/') ? p + 'index.html' : p; f = path.join(SITE, q); if (!f.startsWith(SITE)) f = null; }
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const entry = (dir, allow = []) => { const b = fs.readFileSync(path.join(GEN, dir, 'craftpack.json')); const m = JSON.parse(b); return { id: m.id, version: m.version, source: `https://fixtures.test/fx/${dir}/`, mirrors: [`./fx/${dir}/`], manifest: sha(b), priority: 0, allowCode: allow }; };
const userLock = (...e) => JSON.stringify({ lock: 1, craftpack: '1.0.0', packs: e });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errs = []; const noise = /api\.github\.com|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to load resource|Content Security Policy|sandbox|serviceWorker/i;
async function open({ lock, flag = false, trust = null, hash = '', search = '', viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await ctx.addInitScript((a) => { try { if (a.l && !localStorage.getItem('sc.packs.lock')) localStorage.setItem('sc.packs.lock', a.l); if (a.f && !localStorage.getItem('sc.packs.code')) localStorage.setItem('sc.packs.code', 'true'); if (a.t && !localStorage.getItem('sc.packs.trust')) localStorage.setItem('sc.packs.trust', a.t); } catch (e) { /* sandboxed frames */ } }, { l: lock, f: flag, t: trust });
  const page = await ctx.newPage(); page.on('pageerror', (e) => { if (!/serviceWorker|localStorage.*sandboxed/i.test(e.message)) errs.push('pageerror: ' + e.message); }); page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(BASE + search + hash); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.ui); await page.evaluate(() => window.strudelCraft.packs.ready);
  return { ctx, page };
}
const consent = (page) => page.evaluate(() => ({ code: localStorage.getItem('sc.packs.code'), trust: localStorage.getItem('sc.packs.trust'), allow: (JSON.parse(localStorage.getItem('sc.packs.lock') || '{"packs":[]}').packs || []).map((e) => (e.allowCode || []).join('+')).join(',') }));
const openCode = async (page) => { await page.evaluate(async () => { const m = await import('./packs-ui.js'); await m.sheet.open({ tab: 'code' }); }); await page.waitForSelector('#pkCodeSwitch'); };
const modalOpen = (page) => page.evaluate(() => !!document.querySelector('dialog.scm[open]'));

// ---- 1. the switch: default off, explained, scripted clicks do nothing, a real click + real confirm turns it on, off needs no confirm
{
  const { ctx, page } = await open({ lock: userLock(entry('prov')) });
  await openCode(page);
  const s0 = await page.evaluate(() => { const b = document.querySelector('#pkCodeSwitch'); const r = b.getBoundingClientRect(); return { checked: b.getAttribute('aria-checked'), role: b.getAttribute('role'), h: r.height, text: document.querySelector('#pkCodeWhat').textContent }; });
  check('Code tab: switch is role=switch, aria-checked=false by default, >= 44 px, explains what on allows and does not allow', s0.checked === 'false' && s0.role === 'switch' && s0.h >= 44 && /Turning it on allows/.test(s0.text) && /It does not allow/.test(s0.text) && /never trusts anything by itself/.test(s0.text), JSON.stringify({ ...s0, text: s0.text.slice(0, 80) }));
  await page.evaluate(() => document.querySelector('#pkCodeSwitch').click()); await page.waitForSelector('dialog.scm[open]'); await page.evaluate(() => document.querySelector('dialog.scm[open] .scm-ok').click()); await page.waitForTimeout(200);
  const a = { modal: await modalOpen(page), ...(await consent(page)) };
  await page.click('#pkCodeSwitch'); await page.waitForSelector('dialog.scm[open]'); await page.evaluate(() => document.querySelector('dialog.scm[open] form').requestSubmit()); await page.waitForTimeout(200);
  const b = await consent(page);
  await page.click('#pkCodeSwitch'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm[open] .scm-ok'); await page.waitForTimeout(200);
  const c = { ...(await consent(page)), checked: await page.getAttribute('#pkCodeSwitch', 'aria-checked'), en: await page.evaluate(() => window.strudelCraft.packs.codeEnabled()) };
  check('switch: scripted click + scripted OK does not switch on; a real click + scripted form submit does not either; a real click + real OK does', !a.modal && a.code === null && b.code === null && c.code === 'true' && c.checked === 'true' && c.en === true, JSON.stringify({ a, b, c }));
  await page.click('#pkCodeSwitch'); await page.waitForTimeout(150);
  check('switch off: immediate, no modal', !(await modalOpen(page)) && (await page.evaluate(() => window.strudelCraft.packs.codeEnabled())) === false);
  await page.focus('#pkTab-code'); await page.keyboard.press('ArrowRight'); const t1 = await page.evaluate(() => document.activeElement.id); await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); const foc = await page.evaluate(() => document.activeElement.id);
  await page.keyboard.press('Enter'); await page.waitForSelector('dialog.scm[open]'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  check('keyboard: tabs move with arrows; Tab reaches the switch, Enter opens the modal, Enter confirms', t1 === 'pkTab-credits' && foc === 'pkCodeSwitch' && (await page.evaluate(() => window.strudelCraft.packs.codeEnabled())) === true, `${t1} ${foc}`);
  await ctx.close();
}

// ---- 2. grant only through the trust modal with a real gesture; the trust list shows pack id + full code hash, "confirmed here"; revoke
{
  const { ctx, page } = await open({ lock: userLock(entry('prov')), flag: true });
  await page.evaluate(async () => { const m = await import('./packs-ui.js'); await m.sheet.open({ tab: 'packs' }); });
  await page.waitForSelector('[data-pack="testco/prov"] details'); await page.click('[data-pack="testco/prov"] details summary');
  const grantBtn = '[data-pack="testco/prov"] [data-ing="prov"] button';
  await page.evaluate((s) => document.querySelector(s).click(), grantBtn); await page.waitForSelector('dialog.scm[open]'); await page.evaluate(() => document.querySelector('dialog.scm[open] .scm-ok').click()); await page.waitForTimeout(200);
  const m0 = await modalOpen(page), gA = await consent(page);
  await page.click(grantBtn); await page.waitForSelector('dialog.scm[open]'); await page.evaluate(() => document.querySelector('dialog.scm[open] .scm-ok').click()); await page.waitForTimeout(200);
  const g0 = await consent(page);
  await page.click(grantBtn); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm[open] .scm-ok'); await page.waitForTimeout(300);
  const g1 = await consent(page);
  check('grant: scripted Grant click + scripted OK grants nothing; real Grant click + scripted OK grants nothing; a real click + real OK grants (allowCode + trust record)', !m0 && gA.trust === null && gA.allow === '' && g0.trust === null && g0.allow === '' && g1.allow === 'prov' && /testco\/prov/.test(g1.trust || ''), JSON.stringify({ m0, g0, g1: { ...g1, trust: (g1.trust || '').slice(0, 40) } }));
  await page.click('#pkTab-code'); await page.waitForSelector('[data-grant="testco/prov:prov"]');
  const row = await page.evaluate(() => { const li = document.querySelector('[data-grant="testco/prov:prov"]'); return { text: li.textContent, conf: li.dataset.confirmed, status: li.dataset.status, hash: JSON.parse(localStorage.getItem('sc.packs.trust'))['testco/prov'].prov.hash }; });
  check('trust list: pack id, ingredient, full code hash, "confirmed here", runs', row.text.includes('testco/prov') && row.text.includes(':prov') && row.text.includes(row.hash) && /^sha256:[0-9a-f]{64}$/.test(row.hash) && row.conf === 'here' && row.status === 'ok' && /confirmed here/.test(row.text), JSON.stringify(row).slice(0, 220));
  // history: the grant is in history; a restore of it after revoking + switching off grants nothing back
  const hist = await page.evaluate(async () => { const H = window.strudelCraft.history; await H.flush(); const log = await H.log(); const c = log.find((x) => x.changed.includes('packs.trust') && x.changed.includes('packs.lock')) || log.find((x) => x.changed.includes('packs.trust')); const st = c ? await H.get(c.id) : {}; return { id: c && c.id, label: c && c.label, changed: c && c.changed, n: log.length, had: !!((JSON.parse(st['packs.trust'] || '{}')['testco/prov'] || {}).prov) && /"prov"/.test(st['packs.lock'] || ''), flagThen: st['packs.code'] }; });
  await page.click('[data-grant="testco/prov:prov"] button'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm[open] .scm-ok'); await page.waitForTimeout(200);
  const rv = { ...(await consent(page)), st: await page.evaluate(() => window.strudelCraft.packs.list().find((p) => p.id === 'testco/prov').ingredients[0].state) };
  check('revoke from the trust list (site modal): trust record and allowCode gone, ingredient blocked', rv.allow === '' && !((JSON.parse(rv.trust || '{}')['testco/prov'] || {}).prov) && rv.st === 'blocked', JSON.stringify(rv));
  await page.click('#pkCodeSwitch'); await page.waitForTimeout(100);
  const after = await page.evaluate(async (id) => { const H = window.strudelCraft.history; await H.flush(); await H.checkout(id); return { code: localStorage.getItem('sc.packs.code'), trust: localStorage.getItem('sc.packs.trust'), allow: JSON.parse(localStorage.getItem('sc.packs.lock')).packs.map((e) => (e.allowCode || []).join('+')).join(',') }; }, hist.id);
  check('history: the grant appears as a commit (packs.trust / packs.lock changed); restoring it after revoke + switch off brings back no trust, no allowCode, flag stays off', !!hist.id && hist.had && hist.flagThen === 'true' && hist.changed.includes('packs.trust') && after.code !== 'true' && !((JSON.parse(after.trust || '{}')['testco/prov'] || {}).prov) && after.allow === '', JSON.stringify({ hist, after }));
  await ctx.close();
}

// ---- 3. a grant not made through the modal here (written by page script, or an orphan) is listed as "not confirmed here" and can be revoked
{
  const forged = JSON.stringify({ 'testco/prov': { prov: { hash: 'sha256:' + 'a'.repeat(64), modules: { 'prov.js': 'sha256:x' }, at: 1 } }, 'evil/ghost': { x: { hash: 'sha256:' + 'b'.repeat(64), at: 2 } } });
  const { ctx, page } = await open({ lock: userLock(entry('prov', ['prov'])), trust: forged });
  await openCode(page);
  const r = await page.evaluate(() => [...document.querySelectorAll('[data-grant]')].map((li) => [li.dataset.grant, li.dataset.confirmed, li.dataset.status, li.querySelector('.pk-conf') && li.querySelector('.pk-conf').textContent]));
  check('every grant listed, incl. ones written outside the dialog and for packs not loaded: "not confirmed here", stale / orphan status', r.length === 2 && r.every((x) => x[1] === 'not' && x[3] === 'not confirmed here') && r.find((x) => x[0] === 'testco/prov:prov')[2] === 'stale' && r.find((x) => x[0] === 'evil/ghost:x')[2] === 'orphan', JSON.stringify(r));
  await page.click('[data-grant="evil/ghost:x"] button'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm[open] .scm-ok'); await page.waitForTimeout(200);
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem('sc.packs.trust')));
  check('revoke an orphan grant: its record is removed', !t['evil/ghost'] && !!t['testco/prov'], JSON.stringify(t).slice(0, 120));
  // 360 / 390 / 1440 layout of the Code tab: no horizontal overflow, every button >= 44 px
  for (const w of [360, 390, 1440]) {
    await page.setViewportSize({ width: w, height: w > 1000 ? 900 : 780 }); await page.waitForTimeout(150);
    const L = await page.evaluate(() => { const d = document.querySelector('#packSheet'); const b = [...d.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect()); return { over: d.querySelector('.pk-body').scrollWidth - d.querySelector('.pk-body').clientWidth, small: b.filter((r) => r.height < 44 || r.width < 44).length }; });
    await page.screenshot({ path: path.join(SHOTS, `packs-code-${w}.png`) });
    check(`Code tab at ${w} px: no horizontal overflow, all buttons >= 44 px`, L.over <= 0 && L.small === 0, JSON.stringify(L));
  }
  await ctx.close();
}

// ---- 4. links never grant or switch on: #code/ link, ?pack= proposal accepted through the sheet
{
  const code = `localStorage.setItem('sc.packs.code','true'); localStorage.setItem('sc.packs.trust', '{}'); s("bd")`;
  const link = '#code/p' + Buffer.from(code).toString('base64url');
  const { ctx, page } = await open({ lock: userLock(entry('prov')), hash: link }); await page.waitForTimeout(800);
  const c = await consent(page); const ed = await page.evaluate(() => document.querySelector('#code') && document.querySelector('#code').value);
  check('#code/ link: the code loads into the editor but nothing runs: flag off, no trust record, no allowCode', /sc\.packs\.code/.test(ed || '') && c.code === null && c.trust === null && c.allow === '', JSON.stringify(c));
  await ctx.close();
}
{
  const { ctx, page } = await open({ lock: userLock(), search: '?pack=' + encodeURIComponent('https://fixtures.test/fx/prov/') });
  await page.route('https://fixtures.test/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GEN, new URL(r.request().url()).pathname.slice(4))) }));
  await page.evaluate(async () => { const m = await import('./packs-ui.js'); await m.sheet.open({ tab: 'packs' }); });
  await page.waitForSelector('[data-proposal] button'); await page.click('[data-proposal] button:not(.ghost)'); await page.waitForSelector('[data-proposal] .pk-go', { timeout: 5000 });
  await page.click('[data-proposal] .pk-go'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm[open] .scm-ok'); await page.waitForTimeout(800);
  const c = await consent(page);
  check('?pack= proposal fetched and added with real clicks: allowCode empty, no trust record, flag off', c.allow === '' && c.trust === null && c.code === null, JSON.stringify(c));
  await ctx.close();
}

// ---- 5. sandboxed control renderer: draws in its own frame inside the host slot, host clamps set(), fallback when untrusted / timed out / killed, clickjacking
const zlib = await import('zlib');
function pngPixels(buf) { // minimal PNG decoder (8-bit RGB/RGBA, non-interlaced): enough for Playwright screenshots
  let p = 8, w = 0, hgt = 0, ct = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = d.readUInt32BE(0); hgt = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * hgt * bpp), stride = w * bpp;
  for (let y = 0; y < hgt; y++) { const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0; let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } row[i] = v & 255; } }
  return { w, h: hgt, bpp, px: out };
}
const colours = (png) => { let mag = 0, grn = 0; for (let i = 0; i < png.px.length; i += png.bpp) { const r = png.px[i], g = png.px[i + 1], b = png.px[i + 2]; if (r > 200 && g < 60 && b > 200) mag++; if (r < 60 && g > 200 && b < 60) grn++; } return { mag, grn }; };
const TYPE = 'testco.dial.dial';
const mount = (page, id, o = {}) => page.evaluate(({ id, o }) => { const reg = window.strudelCraft.controls.registry; const fn = o.keep ? window.__keptRenderer : reg.renderer(id); if (!fn) return null; if (!o.keep) window.__keptRenderer = fn;
  let host = document.getElementById('pkcHost'); if (!host) { host = document.createElement('div'); host.id = 'pkcHost'; host.style.cssText = 'position:fixed;left:40px;top:120px;width:260px;padding:8px;background:var(--panel)'; document.body.append(host); }
  host.replaceChildren(); window.__io = { v: 2, sets: [], get() { return this.v; }, set(v) { this.sets.push(v); this.v = v; } };
  window.__ctl = fn(host, 'dial1', { type: id, min: 0, max: 10, step: 0.5, unit: 'dB' }, window.__io); return true; }, { id, o });
{
  const { ctx, page } = await open({ lock: userLock(entry('dial')), flag: true });
  await page.evaluate(() => window.strudelCraft.packs.load('testco/dial:dial')); await page.waitForTimeout(200);
  const pre = await page.evaluate((id) => { const reg = window.strudelCraft.controls.registry; const ing = window.strudelCraft.packs.list().find((p) => p.id === 'testco/dial').ingredients[0]; return { chain: reg.fallbackChain(id), renderer: !!reg.renderer(id), st: ing.state, code: ing.reason && ing.reason.code, frames: document.querySelectorAll('iframe').length }; }, TYPE);
  check('control-types without a grant: blocked, no sandboxed renderer, the type renders through its fallback (knob); no frame', pre.st === 'blocked' && pre.code === 'E_PACK_CODE_GRANT' && !pre.renderer && pre.chain[0] === TYPE && pre.chain[1] === 'knob' && pre.frames === 0, JSON.stringify(pre));
  await page.evaluate(async () => { const p = window.strudelCraft.packs; p.grant('testco/dial:dial'); await p.load('testco/dial:dial'); }); // grant = the trust dialog's accept (section 2 tests the dialog path)
  await page.waitForFunction((id) => !!window.strudelCraft.controls.registry.renderer(id), TYPE, { timeout: 8000 });
  await mount(page, TYPE); await page.waitForFunction(() => window.__ctl.state === 'live', null, { timeout: 5000 }); await page.waitForTimeout(400);
  const box = await page.evaluate(() => { const st = document.querySelector('#pkcHost .pkc-stage'), f = st.querySelector('iframe'), a = st.getBoundingClientRect(), b = f.getBoundingClientRect(), tag = document.querySelector('#pkcHost .pkc-tag');
    const c = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
    return { sandbox: f.getAttribute('sandbox'), inert: f.inert, pe: getComputedStyle(f).pointerEvents, tab: f.tabIndex, aria: f.getAttribute('aria-hidden'), allow: f.getAttribute('allow'), inside: b.left >= a.left - 0.5 && b.top >= a.top - 0.5 && b.right <= a.right + 0.5 && b.bottom <= a.bottom + 0.5,
      hit: c === st, tag: tag.textContent, tagOutside: tag.getBoundingClientRect().bottom <= a.top + 0.5, role: st.getAttribute('role'), label: st.getAttribute('aria-label'), z: getComputedStyle(st.closest('.pkc')).zIndex, iso: getComputedStyle(st.closest('.pkc')).isolation, rect: [a.x, a.y, a.width, a.height].map(Math.round) }; });
  check('renderer frame: sandbox=allow-scripts only, inert, no pointer events, not focusable, aria-hidden; clipped inside its slot; a click at its centre hits the host slot, not the frame', box.sandbox === 'allow-scripts' && box.inert === true && box.pe === 'none' && box.tab === -1 && box.aria === 'true' && box.allow === '' && box.inside && box.hit, JSON.stringify(box));
  check('host label: visible "third-party" tag naming the pack, outside the frame box; host slot is role=slider with an accessible name; own stacking context at z-index 0', /third-party\s+testco\/dial/.test(box.tag) && box.tagOutside && box.role === 'slider' && /third-party control from testco\/dial/.test(box.label) && box.z === '0' && box.iso === 'isolate', JSON.stringify(box));
  const r = box.rect; const clip = { x: r[0] + 2, y: r[1] + 2, width: r[2] - 4, height: r[3] - 4 };
  const c0 = colours(pngPixels(await page.screenshot({ clip })));
  check('the module draws in its frame (OffscreenCanvas): its colours inside the slot, value 2 of 0..10 = about 20 % green', c0.mag > 100 && c0.grn > 50 && c0.grn / (c0.grn + c0.mag) > 0.1 && c0.grn / (c0.grn + c0.mag) < 0.35, JSON.stringify(c0));
  await page.mouse.click(r[0] + r[2] / 2, r[1] + r[3] / 2); await page.waitForTimeout(300);
  const afterPtr = await page.evaluate(() => ({ v: window.__io.v, sets: window.__io.sets.slice(), focus: document.activeElement === document.querySelector('#pkcHost .pkc-stage'), now: document.querySelector('#pkcHost .pkc-stage').getAttribute('aria-valuenow') }));
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); const afterKey = await page.evaluate(() => window.__io.v);
  check('set() outside min..max is clamped by the host: pointer answer 500 -> 10 (max), key answer -1e9 -> 0 (min); the slot takes focus', afterPtr.v === 10 && afterPtr.sets.every((v) => v >= 0 && v <= 10) && afterPtr.focus && afterPtr.now === '10' && afterKey === 0, JSON.stringify({ afterPtr, afterKey }));
  await page.waitForTimeout(300); const c1 = colours(pngPixels(await page.screenshot({ clip })));
  check('redraw follows the host value (0 -> no green)', c1.grn < 20 && c1.mag > 100, JSON.stringify(c1));
  await page.evaluate(() => { const h = document.getElementById('pkcHost'); h.style.zIndex = '30'; h.style.top = '300px'; h.style.boxShadow = '0 0 0 1px var(--line-2)'; }); for (const w of [390, 1440]) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, `packs-control-live-${w}.png`) }); } await page.evaluate(() => { const h = document.getElementById('pkcHost'); h.style.zIndex = ''; h.style.top = '120px'; h.style.boxShadow = ''; });
  await page.setViewportSize({ width: 1440, height: 900 });
  // clickjacking: below modals, toasts and the transport; not focusable and not hit while a modal is open
  const cj = await page.evaluate(async () => {
    const st = document.querySelector('#pkcHost .pkc-stage'), host = document.getElementById('pkcHost'), a = st.getBoundingClientRect();
    const pend = window.strudelCraft.ui.askYesNo({ title: 'Trust code?', message: 'test', okText: 'OK' }); await new Promise((r) => setTimeout(r, 100));
    const hitModal = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2); const dlg = document.querySelector('dialog.scm[open]');
    st.focus(); const stFocus = document.activeElement === st; const inertOut = !dlg.contains(st);
    dlg.querySelector('.ghost').click(); await pend;
    const t = window.strudelCraft.ui.toast('toast over the control', { sticky: true }); const tr = t.getBoundingClientRect();
    host.style.left = (tr.left - 10) + 'px'; host.style.top = (tr.top - 40) + 'px'; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tHit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2); const toastOnTop = t.contains(tHit);
    t.querySelector('.toast-x').click();
    const tp = document.querySelector('.transport'); let transportOnTop = null; if (tp && tp.getBoundingClientRect().height) { const q = tp.getBoundingClientRect(); host.style.top = (q.top - 60) + 'px'; host.style.left = '40px'; await new Promise((r) => requestAnimationFrame(r)); const e = document.elementFromPoint(80, q.top + 10); transportOnTop = tp.contains(e); }
    host.style.left = '40px'; host.style.top = '120px';
    return { modalHit: !!dlg && (hitModal === dlg || dlg.contains(hitModal)), stFocus, inertOut, toastOnTop, transportOnTop };
  });
  await page.evaluate(() => { window.__p = window.strudelCraft.ui.askYesNo({ title: 'x', message: 'y' }); }); await page.waitForSelector('dialog.scm[open]');
  const tabs = []; for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); tabs.push(await page.evaluate(() => document.activeElement === document.querySelector('#pkcHost .pkc-stage') || !!document.activeElement.closest('#pkcHost'))); }
  await page.keyboard.press('Escape');
  check('clickjacking: with a site modal open, a click over the control hits the modal, the slot cannot take focus (script or Tab); toasts and the transport stay above the frame', cj.modalHit && !cj.stFocus && !tabs.some(Boolean) && cj.toastOnTop && cj.transportOnTop !== false, JSON.stringify({ ...cj, tabs }));
  // killed (code switched off at runtime) -> host fallback; a stale renderer mounted after that -> fallback with the gate code
  await page.evaluate(() => window.strudelCraft.packs.setCodeEnabled(false)); await page.waitForTimeout(200);
  const k = await page.evaluate(() => ({ st: window.__ctl.state, frames: document.querySelectorAll('#pkcHost iframe').length, fb: !!document.querySelector('#pkcHost input.pkc-fb'), note: document.querySelector('#pkcHost .pkc-note').textContent, renderer: !!window.strudelCraft.controls.registry.renderer('testco.dial.dial'), drawn: window.strudelCraft.controls.registry.type('testco.dial.dial').drawn }));
  await page.fill('#pkcHost input.pkc-fb', '7.5'); const fbv = await page.evaluate(() => window.__io.v);
  check('code switched off while drawn: frame removed, host-drawn fallback control (works: value 7.5), renderer withdrawn', k.st === 'fallback' && k.frames === 0 && k.fb && /stopped/.test(k.note) && !k.renderer && !k.drawn && fbv === 7.5, JSON.stringify({ k, fbv }));
  await mount(page, TYPE, { keep: true }); await page.waitForFunction(() => window.__ctl.state === 'fallback', null, { timeout: 3000 });
  const u = await page.evaluate(() => ({ note: document.querySelector('#pkcHost .pkc-note').textContent, frames: document.querySelectorAll('#pkcHost iframe').length }));
  check('untrusted / off: a renderer mounted while the gate fails starts no frame and shows the host fallback with the reason', u.frames === 0 && /E_PACK_CODE_GRANT/.test(u.note), JSON.stringify(u));
  await page.evaluate(() => { const h = document.getElementById('pkcHost'); h.style.zIndex = '30'; h.style.top = '300px'; h.style.boxShadow = '0 0 0 1px var(--line-2)'; }); for (const w of [360, 390, 1440]) { await page.setViewportSize({ width: w, height: 800 }); await page.screenshot({ path: path.join(SHOTS, `packs-control-fallback-${w}.png`) }); }
  await ctx.close();
}
{
  const { ctx, page } = await open({ lock: userLock(entry('slowdial')), flag: true });
  await page.evaluate(async () => { const p = window.strudelCraft.packs; p.grant('testco/slowdial:dial'); await p.load('testco/slowdial:dial'); });
  await page.waitForFunction(() => !!window.strudelCraft.controls.registry.renderer('testco.slowdial.dial'), null, { timeout: 8000 });
  await mount(page, 'testco.slowdial.dial'); await page.waitForFunction(() => window.__ctl.state === 'live', null, { timeout: 5000 });
  for (let i = 0; i < 4; i++) { await page.focus('#pkcHost .pkc-stage').catch(() => {}); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(200); }
  await page.waitForFunction(() => window.__ctl.state === 'fallback', null, { timeout: 4000 }).catch(() => {});
  const t = await page.evaluate(() => ({ st: window.__ctl.state, note: document.querySelector('#pkcHost .pkc-note').textContent, v: window.__io.v, ing: window.strudelCraft.packs.list().find((p) => p.id === 'testco/slowdial').ingredients[0].state }));
  check('a renderer that never answers: keys still move the value (host step), three timeouts stop the frame, host fallback shown, ingredient failed', t.st === 'fallback' && /E_PACK_SANDBOX_TIMEOUT/.test(t.note) && t.v > 2 && t.ing === 'failed', JSON.stringify(t));
  await page.evaluate(() => { const h = document.getElementById('pkcHost'); h.style.zIndex = '30'; h.style.top = '300px'; h.style.boxShadow = '0 0 0 1px var(--line-2)'; }); await page.setViewportSize({ width: 390, height: 800 }); await page.screenshot({ path: path.join(SHOTS, 'packs-control-timeout-390.png') });
  await ctx.close();
}
{
  const { ctx, page } = await open({ lock: userLock(entry('dial', ['dial'])), flag: true }); // allowCode without a trust record (a lock edited outside the dialog)
  await page.evaluate(() => window.strudelCraft.packs.load('testco/dial:dial')); await page.waitForTimeout(300); const r = await page.evaluate(() => ({ renderer: !!window.strudelCraft.controls.registry.renderer('testco.dial.dial'), frames: document.querySelectorAll('iframe').length, st: window.strudelCraft.packs.list().find((p) => p.id === 'testco/dial').ingredients[0].state, why: window.strudelCraft.packs.list().find((p) => p.id === 'testco/dial').ingredients[0].reason?.message }));
  check('allowCode without a trust record: blocked (not trusted), no renderer, no frame', !r.renderer && r.frames === 0 && r.st === 'blocked' && /not trusted/.test(r.why || ''), JSON.stringify(r));
  await ctx.close();
}

check('no unexpected page or console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); server.close();
const failed = results.filter((x) => !x).length; console.log(`${results.length} checks, ${failed} failed (screenshots in ${SHOTS})`); process.exit(failed ? 1 : 0);
