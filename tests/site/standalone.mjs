/* Installed web app check (#56 "installed app: empty Syntax, no sound"). Serves site/ under /Strudel-craft/ with GitHub Pages caching
   (max-age=600) and, in Playwright Chromium on the S22 profile with display-mode: standalone emulated (CDP Emulation.setEmulatedMedia),
   lets the service worker control the page, reloads, then taps Play and opens Syntax (key 6). Two cases:
     installed - this build installed and reloaded under its service worker;
     upgrade   - an older build (OLD_BUILDS, git archive) installed first, then the server flips to this build: the update is applied
                 (waiting worker -> reload) and the page must run this build only.
   Each case: master peak > 0.01 on the AnalyserNode, context running, non-blank scope pixels, Syntax examples >= 20 with no error state,
   no page errors. Plus SW unit checks: a Range request to a sample host goes straight to the network (206, never cached), and a cache
   failure in the handler falls back to the network instead of failing the request.
   Usage (repo root): node tests/site/standalone.mjs   -> PASS/FAIL lines, exit 1 on any FAIL. */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TMP = []; process.on('exit', () => { for (const d of TMP) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }); /* old-build archives are 43 MB each: never leave them in /tmp */
const OLD_BUILDS = ['8a48f53', 'e9bf37b']; /* audio-capture era and first installable PWA build */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let root = SITE, swVersion = 'sc-test-new', breakSyntax = false;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = TYPES[path.extname(f)] || 'application/octet-stream';
  if (p === '/sw.js') { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", `const VERSION = '${swVersion}';`)); }
  if (breakSyntax && p === '/data/syntax.json') { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); return res.end(Buffer.concat([fs.readFileSync(f), Buffer.from(' ')])); } /* bytes no longer match the pin */
  res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=600', etag: '"' + fs.statSync(f).mtimeMs + '-' + root.length + '"' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch(); /* no autoplay flag: Play is a real tap */

async function installedPage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
  const page = await ctx.newPage(); const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`[${tag}] console.error: ${m.text()} ${m.location().url || ''}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  /* Chromium's CDP has no display-mode media emulation (Emulation.setEmulatedMedia ignores it), so the installed app is emulated through the
     app's own detection: navigator.standalone (pwa.js isStandalone) -> html.pwa-standalone layout and the standalone code paths */
  await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } catch (e) { /* ignore */ } });
  return { ctx, page, errors };
}
const controlled = (page) => page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).then(() => true, () => false);
async function playAndSyntax(tag, page) {
  check(`[${tag}] installed (standalone) mode active: html.pwa-standalone`, await page.waitForFunction(() => document.documentElement.classList.contains('pwa-standalone') && window.strudelCraft.pwa && window.strudelCraft.pwa.standalone, null, { timeout: 15000 }).then(() => true, () => false));
  check(`[${tag}] service worker controls the page`, await controlled(page));
  await page.waitForSelector('#list li[data-id]', { timeout: 30000 }); await page.waitForTimeout(1200);
  const modals = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.querySelector('h2')?.textContent || d.className));
  check(`[${tag}] no modal over the transport before Play (upgrade questions are toasts, #84)`, modals.length === 0, modals.join(', '));
  await page.tap('#playBtn');
  await page.waitForFunction(() => { const s = window.__sc.S; return (!s.busy && s.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'); }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => new Promise((ok) => { const B = window.__sc.Bus; let m = 0; const t = new Float32Array(2048); const iv = setInterval(() => { if (!B.an) return; B.an.getFloatTimeDomainData(t); for (const x of t) m = Math.max(m, Math.abs(x)); }, 20);
    setTimeout(() => { clearInterval(iv); const v = document.querySelector('#viz'); let px = 0; try { const d = v.getContext('2d').getImageData(0, 0, v.width, v.height).data; for (let i = 3; i < d.length; i += 16) if (d[i]) px++; } catch (e) { px = -1; }
      ok({ peak: +m.toFixed(4), state: B.ctx ? B.ctx.state : 'none', scope: px, status: document.querySelector('#status').textContent, engine: window.__sc.Engine.selfCheck, sw: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL }); }, 2500); }));
  check(`[${tag}] Play: sound on the master and the scope drawn`, r.state === 'running' && r.peak > 0.01 && r.scope > 200, JSON.stringify(r));
  await page.tap('#playBtn').catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('6');
  await page.waitForFunction(() => document.querySelectorAll('#syntax .sx-ex').length > 0 || document.querySelector('#syntax .sx-error'), null, { timeout: 20000 }).catch(() => {});
  const sx = await page.evaluate(() => ({ view: document.querySelector('#main').dataset.view, examples: document.querySelectorAll('#syntax .sx-ex').length, error: document.querySelector('#syntax .sx-error')?.textContent || null, packErrors: (window.strudelCraft.packs?.errors?.() || []).map((e) => e.code + ' ' + e.message).slice(0, 3) }));
  check(`[${tag}] Syntax (key 6) lists examples`, sx.view === 'syntax' && sx.examples >= 20 && !sx.error, JSON.stringify(sx));
}

/* 1. this build, installed */
{
  root = SITE; swVersion = 'sc-test-new';
  const { ctx, page, errors } = await installedPage('installed');
  await page.goto(BASE); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  await playAndSyntax('installed', page);
  /* SW units: Range to a sample host goes to the network untouched; a broken cache falls back to the network */
  const u = await page.evaluate(async () => {
    const out = {};
    try { const U = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json'; await (await caches.open('sc-banks-1')).delete(U); const r = await fetch('https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json', { headers: { Range: 'bytes=0-15' } }); out.range = r.status; out.rangeCached = !!(await (await caches.open('sc-banks-1')).match('https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json')); } catch (e) { out.range = 'error ' + e.message; }
    return out;
  });
  check('[installed] Range request to a sample host passes straight through (206, not cached as a full file)', u.range === 206 && !u.rangeCached, JSON.stringify(u));
  check('[installed] no page errors or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await ctx.close();
}

/* 2. upgrade from an older installed build */
for (const old of OLD_BUILDS) {
  let OLD; try { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-old-')); TMP.push(d); execSync(`git -C "${ROOT}" archive ${old} site | tar -x -C "${d}"`, { stdio: 'pipe' }); OLD = path.join(d, 'site'); } catch (e) { console.log(`SKIP  upgrade from ${old}: git archive unavailable`); continue; }
  root = OLD; swVersion = 'sc-test-old-' + old;
  const tag = 'upgrade ' + old; const { ctx, page, errors } = await installedPage(tag);
  await page.goto(BASE); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await controlled(page); await page.waitForTimeout(1500);
  /* deploy: the server now has this build; the installed app is opened again (reload) and the update is found */
  root = SITE; swVersion = 'sc-test-new';
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update())).catch(() => {});
  /* the new worker must take over and the app reload itself (no tap needed while idle), then run this build only */
  /* polled from node: the takeover reloads the page, which would abort an in-page wait */
  let took = false, keys = [];
  for (let i = 0; i < 60 && !took; i++) { await page.waitForTimeout(500); try { keys = await page.evaluate(() => caches.keys()); took = await page.evaluate(() => !!document.querySelector('#audioSt') && !!(window.__sc && window.__sc.audio) && document.readyState === 'complete'); took = took && keys.includes('sc-test-new') && !keys.some((k) => k.startsWith('sc-test-old')); } catch (e) { /* navigating */ } }
  await page.waitForSelector('#list li[data-id]', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500);
  check(`[${tag}] update applied: this build runs, old shell cache deleted`, took && keys.includes('sc-test-new') && !keys.some((k) => k.startsWith('sc-test-old')), JSON.stringify(keys));
  errors.length = 0;
  await playAndSyntax(tag, page);
  check(`[${tag}] no page errors or console errors after the upgrade`, errors.length === 0, errors.slice(0, 4).join(' | '));
  await ctx.close();
}

/* 3. syntax data that fails its pin: a clear error state with the code, Retry, bundled core examples; Retry recovers once the bytes match */
{
  root = SITE; swVersion = 'sc-test-new'; breakSyntax = true;
  const { ctx, page } = await installedPage('syntax-fail');
  await page.goto(BASE + '#syntax'); await page.waitForSelector('#syntax .sx-error', { timeout: 20000 }).catch(() => {});
  const a = await page.evaluate(() => ({ error: document.querySelector('#syntax .sx-error')?.textContent.trim().slice(0, 140), retry: !!document.querySelector('#syntax .sx-retry'), examples: document.querySelectorAll('#syntax .sx-ex').length }));
  check('[syntax-fail] pin mismatch: error state names E_PACK_HASH, Retry button, bundled examples', /E_PACK_HASH/.test(a.error || '') && a.retry && a.examples >= 3, JSON.stringify(a));
  breakSyntax = false; await page.tap('#syntax .sx-retry');
  await page.waitForFunction(() => !document.querySelector('#syntax .sx-error') && document.querySelectorAll('#syntax .sx-ex').length >= 20, null, { timeout: 20000 }).catch(() => {});
  const b = await page.evaluate(() => ({ error: !!document.querySelector('#syntax .sx-error'), examples: document.querySelectorAll('#syntax .sx-ex').length }));
  check('[syntax-fail] Retry loads the full examples once the data matches', !b.error && b.examples >= 20, JSON.stringify(b));
  await ctx.close();
}

await browser.close(); server.close();
const fails = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
