/* Flag validation (#180 follow-up, site/flags.js, docs/AUDIO_ENGINE.md section 8): every engine and trial flag validates before it is applied, persisted or listed in the diagnostics
   sheet; an invalid value is dropped and the site behaves as with no flag, audio included. Part 1 is pure (the validators and the storage rules); part 2 loads the site in Chromium with bad
   URL values, with a bad value persisted by an older build, and with an AudioContext that refuses the injected hint, and checks that Play still makes sound and nothing bad is listed or stored.
   Usage: node tests/site/flags.mjs. Exit 1 on a failed check. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { VALID, isValid, readFlag, persistFlags, sweepFlags } from '../../site/flags.js';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site');
const checks = []; const check = (n, ok, d = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };

/* 1. validators */
const GOOD = { engine: ['page', 'worker'], resync: ['on', 'off'], sched: ['strudel', 'batch'], late: ['reanchor', 'drop'], vis: ['cache', 'requery', 'every'], hint: ['interactive', 'balanced', 'playback', '0', '0.5', '3'],
  session: ['playback', 'auto', 'ambient'], lookahead: ['0.2', '0.6', '1'], scrollla: ['on', 'off'], poly: ['1', '24', '256'] };
const BAD = { engine: ['foo', '', 'Worker', '1'], resync: ['yes', 'ON', ''], sched: ['x', '0.2'], late: ['x', ''], vis: ['x', ''], hint: ['foo', '-1', '99999', 'NaN', 'Infinity', '', ' ', '1e999', 'Playback'],
  session: ['bogus', '', 'PLAYBACK'], lookahead: ['abc', '9', '0', '-1', '0.1', '', 'NaN'], scrollla: ['yes', 'true', '1', ''], poly: ['-5', '0', 'abc', '2.5', '', '999', '1e2'] };
check('every flag has a validator and a test table', Object.keys(VALID).every((k) => GOOD[k] && BAD[k]), Object.keys(VALID).join(','));
check('good values validate', Object.entries(GOOD).every(([k, l]) => l.every((v) => isValid(k, v))), '');
const badAccepted = Object.entries(BAD).flatMap(([k, l]) => l.filter((v) => isValid(k, v)).map((v) => k + '=' + JSON.stringify(v)));
check('bad values are rejected', badAccepted.length === 0, badAccepted.join(' '));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] }; };
{ const st = mem(); const q = '?persist=1&' + Object.entries(BAD).map(([k, l]) => k + '=' + encodeURIComponent(l.find((v) => v !== '') || 'x')).join('&');
  const stored = persistFlags(q, st); check('persist=1 stores no invalid value', stored.length === 0 && st.keys().length === 0, JSON.stringify(st.keys())); }
{ const st = mem(); const q = '?persist=1&' + Object.entries(GOOD).map(([k, l]) => k + '=' + l[0]).join('&'); const stored = persistFlags(q, st);
  check('persist=1 stores every valid value', stored.length === Object.keys(VALID).length && st.getItem('sc.flag.hint') === 'interactive'); persistFlags('?persist=clear', st); check('persist=clear removes them', st.keys().length === 0); }
{ const st = mem(); for (const [k, l] of Object.entries(BAD)) st.setItem('sc.flag.' + k, l.find((v) => v !== '') || 'x'); const got = Object.keys(VALID).map((k) => readFlag(k, '', st));
  check('a bad value persisted by an older build is ignored and removed on read', got.every((v) => v === '') && st.keys().length === 0, JSON.stringify(got)); }
{ const st = mem(); for (const [k, l] of Object.entries(BAD)) st.setItem('sc.flag.' + k, l.find((v) => v !== '') || 'x'); st.setItem('sc.flag.poly', '24'); const gone = sweepFlags(st); check('sweepFlags removes every stored invalid value and keeps valid ones', gone.length === Object.keys(VALID).length - 1 && st.keys().join() === 'sc.flag.poly', gone.join()); }
{ const st = mem(); st.setItem('sc.flag.hint', 'playback'); check('an invalid URL value falls back to a valid stored one, then to none', readFlag('hint', '?hint=foo', st) === 'playback' && readFlag('hint', '?hint=foo', mem()) === ''); }

/* 2. the site */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
async function run(query, { stored = {}, refuse = null } = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: !!PROXY, viewport: { width: 360, height: 780 } });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
  await ctx.addInitScript(({ stored, refuse }) => { try { if (!sessionStorage.__seeded) { for (const [k, v] of Object.entries(stored)) localStorage.setItem('sc.flag.' + k, v); sessionStorage.__seeded = '1'; } } catch (e) { /* none */ }
    if (refuse != null) { const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { if (o && o.latencyHint === refuse) throw new TypeError('latencyHint refused (test)'); super(o); } }; } }, { stored, refuse });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + query); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(800);
  const ed = page.locator('.view[data-for=rack] .cm-content:visible').first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('setcpm(120/4)\n$: note("c4*8").s("sine").gain(.05)'); await page.waitForTimeout(800);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => window.__sc.play()).catch(() => {});
  const ok = await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && window.getAudioContext().state === 'running', null, { timeout: 60000 }).then(() => true, () => false);
  await page.waitForTimeout(1200);
  const out = await page.evaluate(() => { const b = window.strudelCraft.bg, s = b.stats(); return { flags: s.flags, audio: s.audio, haps: s.perf.haps, engine: s.engine, store: Object.keys(localStorage).filter((k) => k.startsWith('sc.flag.')).map((k) => k + '=' + localStorage.getItem(k)), lookaheadMs: s.lookaheadMs }; });
  await ctx.close(); return { ok, errs, ...out };
}
const none = (f) => !f.hint && !f.session && !f.lookahead && !f.scrollla && !f.poly;
const bad = await run('?hint=foo&session=bogus&lookahead=9&scrollla=yes&poly=-5&engine=xx&resync=maybe&persist=1');
check('bad URL values with persist=1: audio plays, nothing listed in force, nothing stored', bad.ok && bad.haps > 4 && none(bad.flags) && bad.store.length === 0 && bad.engine === 'page' && bad.lookaheadMs === 200 && bad.audio.hint === 'interactive (default)', JSON.stringify({ ok: bad.ok, haps: bad.haps, flags: bad.flags, store: bad.store, engine: bad.engine, la: bad.lookaheadMs, hint: bad.audio && bad.audio.hint, errs: bad.errs.slice(0, 1) }));
const old = await run('', { stored: { hint: 'foo', session: 'bogus', lookahead: '9', scrollla: 'yes', poly: '-5', engine: 'xx', resync: 'maybe', sched: 'x', late: 'x' } });
check('bad values persisted by an older build: audio plays, ignored, removed from storage', old.ok && old.haps > 4 && none(old.flags) && old.store.length === 0 && old.engine === 'page', JSON.stringify({ ok: old.ok, flags: old.flags, store: old.store, errs: old.errs.slice(0, 1) }));
const good = await run('?hint=playback&poly=24&lookahead=0.4&persist=1');
check('valid values are applied and stored', good.ok && good.flags.hint === 'playback' && good.flags.poly === 24 && good.flags.lookahead === 0.4 && good.audio.hint === 'playback' && good.store.length === 3, JSON.stringify({ flags: good.flags, hint: good.audio && good.audio.hint, store: good.store }));
const refused = await run('?hint=7', { refuse: 7 });
check('a context that refuses the injected hint falls back to default options: audio plays, hint not listed', refused.ok && refused.haps > 4 && !refused.flags.hint && refused.audio.hint === 'interactive (default)', JSON.stringify({ ok: refused.ok, flags: refused.flags, hint: refused.audio && refused.audio.hint, errs: refused.errs.slice(0, 1) }));
await browser.close(); server.close(); const nbad = checks.filter((c) => !c).length; console.log(`${checks.length - nbad}/${checks.length} checks passed`); process.exit(nbad ? 1 : 0);
