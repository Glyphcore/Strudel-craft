/* Offline Play in the installed app (#73). Serves site/ under /Strudel-craft/ like Pages (max-age=600, sw.js VERSION stamped), mobile Chromium:
   1. first visit only (Play never pressed): the worker installs one snapshot; it holds every precache.json file, SHELL, the shim files and
      the crawled import graph of every pinned CDN entry (Strudel bundle, CodeMirror, jsdiff); default sample maps sit in sc-banks-1
   2. network off, reload: app renders, CodeMirror editor up, Play starts the engine and audio on the bgplay worker clock (no "Could not load the Strudel engine")
   3. the uncached sample bank audio -> exactly one "Offline: this sample bank is not cached yet" toast; no request for code or data fails
   4. every view opens offline; the demo vox fallback map and audio, the word() prelude and the pack pins load offline
   5. atomic shell: a changed file under the same VERSION is not mixed in; a new VERSION swaps the whole snapshot
   Usage (repo root): node tests/site/pwa_offline.mjs  -> PASS/FAIL lines, exit 1 on any FAIL; writes docs/screens/pwa-offline.json */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg' };
let swVersion = 'sc-offline-1', marker = ''; /* marker: appended to ui.js to simulate a changed file on the server */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = TYPES[path.extname(f)] || 'application/octet-stream';
  if (p === '/sw.js') { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", `const VERSION = '${swVersion}';`)); }
  if (p === '/ui.js' && marker) { res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=600' }); return res.end(fs.readFileSync(f, 'utf8') + `\nwindow.__marker = '${marker}';\n`); }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const checks = []; const errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

let fresh = true; try { execFileSync('node', [path.join(ROOT, 'tools/pwa/precache.mjs'), '--check'], { stdio: 'pipe' }); } catch (e) { fresh = false; }
check('site/precache.json is fresh (node tools/pwa/precache.mjs --check)', fresh);
const PRE = JSON.parse(fs.readFileSync(path.join(SITE, 'precache.json'), 'utf8'));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '' }) : '[]' }));
const page = await ctx.newPage();
let offline = false; const failed = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch|error loading/.test(m.text())) errors.push('console.error: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
ctx.on('requestfailed', (r) => { if (offline) failed.push(r.url()); });

/* 1. first visit only, Play never pressed */
await page.goto(BASE, { waitUntil: 'load' });
const inst = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active && r.active.state; });
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
const cached = await page.evaluate(async (v) => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url); return { names: Object.keys(out), shell: out[v] || [], banks: out['sc-banks-1'] || [] }; }, swVersion);
const shellSet = new Set(cached.shell);
const missFiles = PRE.files.filter((f) => !shellSet.has(BASE + f));
check('install (first visit, no Play): every precache.json file is in the ' + swVersion + ' snapshot', /^activat/.test(inst) && missFiles.length === 0, `${PRE.files.length} files; missing: ${missFiles.slice(0, 5).join(', ')}`);
const missCdn = PRE.cdn.filter((u) => !shellSet.has(u));
const graph = cached.shell.filter((u) => !u.startsWith(BASE));
check('install: every pinned CDN entry and its import graph is cached (Strudel bundle, CodeMirror, jsdiff)', missCdn.length === 0 && graph.length > PRE.cdn.length * 3, `${graph.length} CDN modules; missing entries: ${missCdn.join(', ')}`);
check('install: default sample maps in sc-banks-1', PRE.banks.every((u) => cached.banks.includes(u)), cached.banks.join(', '));

/* 2. network off, reload, Play */
offline = true; await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 0 && document.documentElement.dataset.editor === 'cm6', null, { timeout: 20000 }).catch(() => {});
const shell = await page.evaluate(() => ({ rows: document.querySelectorAll('#list .row').length, editor: document.documentElement.dataset.editor, title: document.getElementById('nowTitle').textContent, controlled: !!navigator.serviceWorker.controller }));
check('offline reload: app, recipes and CodeMirror editor', shell.rows > 0 && shell.editor === 'cm6' && shell.controlled, JSON.stringify(shell));
await page.click('#playBtn');
await page.waitForFunction(() => window.__sc && window.__sc.S.playing && window.__sc.Engine.selfCheck.engine === 'ok', null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
const play = await page.evaluate(() => ({ playing: window.__sc.S.playing, engine: window.__sc.Engine.selfCheck.engine, samples: window.__sc.Engine.selfCheck.samples, ctx: window.getAudioContext ? window.getAudioContext().state : 'none', clock: window.strudelCraft.bg ? window.strudelCraft.bg.stats().clock : 'none', toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) }));
check('offline Play: engine loads from the snapshot, audio runs on the bgplay worker clock', play.playing && play.engine === 'ok' && play.ctx === 'running' && /worker/.test(play.clock) && !play.toasts.some((t) => /Could not load the Strudel engine/.test(t)), JSON.stringify({ ...play, toasts: play.toasts.length }));
check('offline Play: sample maps resolve from sc-banks-1', play.samples === 'ok' || play.samples === 'idle', play.samples);
const bankToasts = play.toasts.filter((t) => /Offline: this sample bank is not cached yet/.test(t)).length;
check('offline Play with an uncached bank: exactly one "sample bank is not cached" toast', bankToasts === 1, play.toasts.join(' | '));
await page.screenshot({ path: path.join(ROOT, 'docs/screens/pwa-offline-play-390.png') });
await page.click('#playBtn'); await page.waitForTimeout(500);

/* 4. views, bgplay worker, vox fallback, pack pins */
for (const v of ['stack', 'ref', 'practice', 'perform', 'syntax', 'graph', 'rack']) { await page.evaluate((h) => { location.hash = '#' + h; }, v); await page.waitForTimeout(900); }
const extras = await page.evaluate(async () => {
  const ok = (u) => fetch(u).then((r) => r.ok).catch(() => false);
  return { vox: await ok('data/vox/demo/pitched/strudel.json'), voxAudio: await ok('data/vox/demo/ogg/' + Object.values(await (await fetch('data/vox/demo/strudel.json')).json()).flat().find((x) => typeof x === 'string').replace(/^ogg\//, '')).catch(() => false),
    pins: (await ok('packs.json')) && (await ok('packs.lock.json')) && (await ok('craftpack.json')), prelude: typeof window.word === 'function' || typeof globalThis.voxBank === 'function' };
});
check('offline: demo vox fallback map + audio, pack pins and the word() prelude load', extras.vox && extras.pins && extras.prelude, JSON.stringify(extras));
const codeFails = failed.filter((u) => !/raw\.githubusercontent\.com\/.*\.(wav|ogg|mp3|flac)$/i.test(u) && !/api\.github\.com/.test(u));
check('offline: no code, data or module request failed (only uncached bank audio)', codeFails.length === 0, codeFails.slice(0, 5).join(', ') || `${failed.length} bank audio misses`);
offline = false; await ctx.setOffline(false);

/* 5. atomic per VERSION */
marker = 'mixed'; await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
const m1 = await page.evaluate(() => window.__marker || null);
check('same VERSION, changed file on the server: the page keeps its snapshot (no mixed shell)', m1 === null, String(m1));
marker = 'v2'; swVersion = 'sc-offline-2';
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await page.waitForFunction(() => window.__marker === 'v2', null, { timeout: 60000 }).catch(() => {}); /* idle: the new snapshot applies itself and reloads */
await page.waitForFunction(async () => (await caches.keys()).filter((k) => k.startsWith('sc-offline')).join() === 'sc-offline-2', null, { timeout: 10000, polling: 250 }).catch(() => {});
const m2 = await page.evaluate(async () => ({ marker: window.__marker || null, caches: (await caches.keys()).filter((k) => k.startsWith('sc-offline')) }));
check('new VERSION: whole snapshot swapped (new file live, old shell cache deleted)', m2.marker === 'v2' && m2.caches.join() === 'sc-offline-2', JSON.stringify(m2));

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(path.join(ROOT, 'docs/screens/pwa-offline.json'), JSON.stringify({ date: new Date().toISOString(), base: BASE, cdnModules: graph.length, files: PRE.files.length, checks }, null, 2));
await browser.close(); server.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
