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

check('no unexpected page or console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); server.close();
const failed = results.filter((x) => !x).length; console.log(`${results.length} checks, ${failed} failed (screenshots in ${SHOTS})`); process.exit(failed ? 1 : 0);
