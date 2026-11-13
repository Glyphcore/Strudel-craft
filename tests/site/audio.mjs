/* Sound and visual regression test (#56 "Fix: no audio or waveforms"). Serves site/ under /Strudel-craft/ (the Pages path) with
   GitHub Pages caching (max-age=600) and, in Playwright Chromium on the S22 profile (360x780, DPR 3, touch, NO autoplay flag: Play is a real tap),
   runs two cases:
     fresh  - a fresh profile, no service worker;
     stale  - a service worker and HTTP cache installed by an older build (git archive of OLD_BUILD, else this build under another VERSION),
              then the server flips to this build and the page reloads (old shell files + new files).
   In each case: Rack default recipe, Rack with the user's program, Stack with the user's program typed into an empty Stack, and a
   _scope/_pianoroll program. After Play it measures the peak on the master AnalyserNode (> 0.01), the AudioContext state (running),
   the audio status dot, non-blank pixels on the stage scope and the inline widget canvases, and fails on any page error or console error.
   Usage (repo root): node tests/site/audio.mjs [--live URL]   -> PASS/FAIL lines, exit 1 on any FAIL.
   --live runs the fresh case against a deployed URL (no stale case). */
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
const OLD_BUILD = '8a48f53'; /* an older deployed build (audio capture era) whose service worker the stale case installs first */
const LIVE = (() => { const i = process.argv.indexOf('--live'); return i > 0 ? process.argv[i + 1] : null; })();
const USER = `$: note("c2*8").s("sawtooth").gain(ctl("macro", { type: "knob", min: 0, max: 1, default: 0.6 }))
$: s("supersaw*8").room(0.1).sometimes(x => x.vowel("e a"))
hooks.map('macro', 'room', { range: [0, 0.8] })`;
const VIZ = `$: note("c2 e2 g2 b2").s("sawtooth").lpf(800)._scope()
$: s("supersaw*4").note("c4 e4")._pianoroll()`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let root = SITE, swVersion = 'sc-test-new';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = TYPES[path.extname(f)] || 'application/octet-stream';
  if (p === '/sw.js') { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", `const VERSION = '${swVersion}';`)); }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=600', etag: '"' + fs.statSync(f).mtimeMs + '-' + root.length + '"' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = LIVE || `http://127.0.0.1:${server.address().port}${PREFIX}`;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

/* old build for the stale case */
let OLD = null;
if (!LIVE) {
  try { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-old-')); execSync(`git -C "${ROOT}" archive ${OLD_BUILD} site | tar -x -C "${d}"`, { stdio: 'pipe' }); OLD = path.join(d, 'site'); }
  catch (e) { OLD = SITE; console.log('note: git archive unavailable, the stale case uses this build under an old VERSION'); }
}

const browser = await chromium.launch(); /* no --autoplay-policy flag: audio must start from the tap */
async function newPage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
  const page = await ctx.newPage(); const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`); if (m.type() === 'warning' && /E_NAME_COLLISION/.test(m.text())) errors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  return { ctx, page, errors };
}
/* Play with a real touch (user activation); if the fixed transport is covered at that point, focus it and press Enter (also a user gesture) */
async function pressPlay(page) { try { await page.tap('#playBtn', { timeout: 3000 }); } catch (e) { await page.focus('#playBtn'); await page.keyboard.press('Enter'); } }
async function stopIfPlaying(page) { if (await page.evaluate(() => window.__sc.S.playing)) { await pressPlay(page); await page.waitForFunction(() => !window.__sc.S.playing, null, { timeout: 5000 }).catch(() => {}); } }
async function typeCode(page, view, code) {
  await page.evaluate((v) => window.__sc.setView(v), view); await page.waitForTimeout(400);
  const sel = view === 'stack' ? '#stackCode' : '#code';
  const ed = page.locator(`.view[data-for=${view}] .cm-content:visible, ${sel}:visible`).first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(code); await page.waitForTimeout(600);
}
/* peak over 2.5 s on the master analyser, context state, status dot, non-blank pixels on the scope and the inline widgets */
const measure = (page) => page.evaluate(() => new Promise((ok) => {
  const B = window.__sc.Bus; let m = 0; const t = new Float32Array(2048);
  const iv = setInterval(() => { if (!B.an) return; B.an.getFloatTimeDomainData(t); for (const x of t) m = Math.max(m, Math.abs(x)); }, 20);
  setTimeout(() => {
    clearInterval(iv);
    const ink = (c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i]) n++; return n; } catch (e) { return -1; } };
    const v = document.querySelector('#viz');
    ok({ peak: +m.toFixed(4), state: B.ctx ? B.ctx.state : 'none', dot: document.querySelector('#audioSt')?.dataset.state, scope: v ? ink(v) : -1, widgets: [...document.querySelectorAll('canvas.sc-widget')].map(ink), playing: window.__sc.S.playing, status: document.querySelector('#status').textContent, active: (window.__sc.Engine.state.activeCode || '').replace(/\s+/g, ' ').slice(0, 60) });
  }, 2500);
}));
const waitPlaying = (page) => page.waitForFunction(() => { const s = window.__sc.S; return (!s.busy && s.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'); }, null, { timeout: 60000 }).catch(() => {});

async function scenario(tag, page) {
  /* Rack, default recipe */
  await pressPlay(page); await waitPlaying(page); await page.waitForTimeout(1500);
  let r = await measure(page);
  check(`[${tag}] Rack default: sound on the master`, r.playing && r.state === 'running' && r.peak > 0.01, JSON.stringify(r));
  check(`[${tag}] Rack default: scope drawn, status dot on`, r.scope > 200 && r.dot === 'on', `scope ${r.scope} px, dot ${r.dot}`);
  await stopIfPlaying(page);
  /* Rack, the user's program */
  await typeCode(page, 'rack', USER); await pressPlay(page); await waitPlaying(page); await page.waitForTimeout(1500);
  r = await measure(page);
  check(`[${tag}] Rack user program: sound + scope`, r.playing && r.peak > 0.01 && r.scope > 200 && /sawtooth/.test(r.active), JSON.stringify(r));
  await stopIfPlaying(page);
  /* Stack: empty layers, program typed by the user */
  await page.evaluate(() => document.querySelector('#stackClear')?.click()); await page.waitForTimeout(300);
  await typeCode(page, 'stack', USER); await pressPlay(page); await waitPlaying(page); await page.waitForTimeout(1500);
  r = await measure(page);
  check(`[${tag}] Stack typed program (no layers): sound + scope`, r.playing && r.peak > 0.01 && r.scope > 200 && /^\$: note\("c2\*8"\)/.test(r.active) && /Stack program/.test(r.status), JSON.stringify(r));
  await stopIfPlaying(page);
  /* inline visuals */
  await typeCode(page, 'rack', VIZ); await pressPlay(page); await waitPlaying(page); await page.waitForTimeout(1500);
  r = await measure(page);
  check(`[${tag}] _scope/_pianoroll widgets drawn while playing`, r.playing && r.peak > 0.01 && r.widgets.length >= 2 && r.widgets.every((n) => n > 50), JSON.stringify(r));
  await stopIfPlaying(page);
}

/* unit: sample detection (edited / typed code loads the maps; pure synth programs do not) */
{
  const { page, ctx } = await newPage('unit'); await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.__sc.audio, null, { timeout: 30000 });
  const u = await page.evaluate(() => { const f = window.__sc.audio.needsSamplesFor; return [f('s("bd*4")'), f('s("casio:2")'), f('sound("piano")'), f('n("0").s("sawtooth")'), f('s("supersaw*8")'), f('note("c").sound("sine")'), f('s("hh").bank("RolandTR909")')]; });
  check('needsSamplesFor: sampled names load the maps, synths do not', JSON.stringify(u) === JSON.stringify([true, true, true, false, false, false, true]), JSON.stringify(u));
  await ctx.close();
}

/* fresh profile */
{
  const { page, ctx, errors } = await newPage('fresh');
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]', { timeout: 30000 }); await page.waitForTimeout(1500);
  check('[fresh] audio status dot present before Play', await page.evaluate(() => ['off', 'ready'].includes(document.querySelector('#audioSt')?.dataset.state)));
  await scenario('fresh', page);
  check('[fresh] no page errors, console errors or name collisions', errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

/* stale service worker: an older build installs its SW and fills the HTTP cache, then the server flips to this build */
if (!LIVE) {
  root = OLD; swVersion = 'sc-test-old';
  const { page, ctx, errors } = await newPage('stale');
  await page.goto(BASE); await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(2500);
  check('[stale] old service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));
  root = SITE; swVersion = 'sc-test-new'; errors.length = 0;
  await page.reload(); await page.waitForSelector('#list li[data-id]', { timeout: 30000 }); await page.waitForTimeout(1500);
  check('[stale] page runs this build after reload (no mixed old shell)', await page.evaluate(() => !!document.querySelector('#audioSt') && !!(window.__sc && window.__sc.audio)));
  await scenario('stale', page);
  check('[stale] no page errors, console errors or name collisions', errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

await browser.close(); server.close();
const fails = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
