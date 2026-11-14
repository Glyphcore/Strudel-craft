/* Sound and visual regression test (#56 "Fix: no audio or waveforms"). Serves site/ under /Strudel-craft/ (the Pages path) with
   GitHub Pages caching (max-age=600) and, in Playwright Chromium on the S22 profile (360x780, DPR 3, touch, NO autoplay flag: Play is a real tap),
   runs two cases:
     fresh  - a fresh profile, no service worker;
     stale  - a service worker and HTTP cache installed by an older build (git archive of each OLD_BUILDS entry, else this build under another
              VERSION), then the server flips to this build and the page reloads (old shell files + new files). Before the first Play no
              modal may be open (an upgrade question is a toast, #84), and every scenario plays.
   In each case: Rack default recipe, Rack with the user's program, Stack with the user's program typed into an empty Stack, and a
   _scope/_pianoroll program. After Play it measures the peak on the master AnalyserNode (> 0.01), the AudioContext state (running),
   the audio status dot, non-blank pixels on the stage scope and the inline widget canvases, and fails on any page error or console error.
   Layout (fresh case): in every view, after typing in the editor and with the keyboard open (360x420): no horizontal overflow or viewport
   rescale, Play's centre inside the viewport and elementFromPoint there lands on Play; every Play press is a real tap (a blocked tap fails).
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
const OLD_BUILDS = ['8a48f53', 'e9bf37b']; /* older deployed builds whose service worker the stale case installs first: audio capture era (leaves an old take store) and the first installable PWA */
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

/* old builds for the stale cases */
const TMP = []; process.on('exit', () => { for (const d of TMP) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }); /* old-build archives are 43 MB each: never leave them in /tmp */
const OLDS = [];
if (!LIVE) for (const b of OLD_BUILDS) {
  try { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-old-')); TMP.push(d); execSync(`git -C "${ROOT}" archive ${b} site | tar -x -C "${d}"`, { stdio: 'pipe' }); OLDS.push([b, path.join(d, 'site')]); }
  catch (e) { OLDS.push([b + ' (this build)', SITE]); console.log(`note: git archive ${b} unavailable, that stale case uses this build under an old VERSION`); }
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
/* Play with a real touch only (user activation): a covered or off-screen Play button fails the run (no keyboard or JS-click fallback) */
const tapFails = [];
async function pressPlay(page) { try { await page.tap('#playBtn', { timeout: 5000 }); } catch (e) { tapFails.push(String(e.message).split('\n').find((l) => /intercepts|outside|not visible/.test(l)) || e.message.split('\n')[0]); await page.focus('#playBtn'); await page.keyboard.press('Enter'); } }
/* layout at 360px: no horizontal overflow, no viewport rescale, Play's centre inside the viewport and elementFromPoint at it lands on Play */
const layout = (page) => page.evaluate(() => {
  const de = document.documentElement, b = document.querySelector('#playBtn').getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
  const h = document.elementFromPoint(x, y); const hit = !!h && document.querySelector('#playBtn').contains(h);
  return { ok: de.scrollWidth <= de.clientWidth && scrollX === 0 && innerHeight === de.clientHeight && y < de.clientHeight && hit, sw: de.scrollWidth, cw: de.clientWidth, ih: innerHeight, ch: de.clientHeight, sx: scrollX, play: [Math.round(x), Math.round(y)], at: h ? (h.closest('[id]')?.id || h.tagName) : null };
});
async function layoutCase(tag, page) {
  for (const v of ['rack', 'stack', 'perform', 'graph', 'syntax', 'ref', 'practice']) { await page.evaluate((v) => window.__sc.setView(v), v); await page.waitForTimeout(500); const r = await layout(page); check(`[${tag}] layout ${v}: no sideways scroll, Play hit-tests at its centre`, r.ok, JSON.stringify(r)); }
  await typeCode(page, 'rack', USER + '\n// a long comment line typed on a phone that runs well past the width of the editor pane');
  let r = await layout(page); check(`[${tag}] layout after typing in the editor (edited badge, long line)`, r.ok, JSON.stringify(r));
  const rv = await page.evaluate(() => { const e = document.querySelector('#revertBtn').getBoundingClientRect(); const d = document.querySelector('#dirty'); return { dirty: !!d && !d.hidden, l: Math.round(e.left), r: Math.round(e.right), w: Math.round(e.width), h: Math.round(e.height), vw: document.documentElement.clientWidth }; });
  check(`[${tag}] #81 edited Rack header: Revert fully visible with a 44px target`, rv.dirty && rv.l >= 0 && rv.r <= rv.vw && rv.w >= 44 && rv.h >= 44, JSON.stringify(rv));
  await page.setViewportSize({ width: 360, height: 420 }); await page.waitForTimeout(500); /* keyboard open: interactive-widget=resizes-content shrinks the layout viewport */
  r = await layout(page); check(`[${tag}] layout with the keyboard open (360x420): Play above the keyboard and hit-testable`, r.ok, JSON.stringify(r));
  await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(400);
  const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
  check(`[${tag}] viewport meta resizes content for the on-screen keyboard`, /interactive-widget=resizes-content/.test(meta), meta);
}
async function stopIfPlaying(page) { if (await page.evaluate(() => window.__sc.S.playing)) { await pressPlay(page); await page.waitForFunction(() => !window.__sc.S.playing, null, { timeout: 5000 }).catch(() => {}); } }
async function typeCode(page, view, code) {
  await page.evaluate((v) => window.__sc.setView(v), view); await page.waitForTimeout(400);
  const sel = view === 'stack' ? '#stackCode' : '#code';
  const ed = page.locator(`.view[data-for=${view}] .cm-content:visible, ${sel}:visible`).first(); await ed.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(code); await page.waitForTimeout(600);
}
/* peak over 2.5 s on the master analyser, context state, status dot, non-blank pixels on the scope and the inline widgets */
const measure = (page) => page.evaluate(() => new Promise((ok) => {
  const B = window.__sc.Bus; let m = 0; const t = new Float32Array(2048);
  /* every pixel: the pianoroll draws thin bars and a 1px playhead that a strided sample can miss entirely, depending on canvas width and DPR */
  const ink = (c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; } catch (e) { return -1; } };
  const wmax = new Map(); let k = 0; /* widgets: visible ones only, max over the window (a single frame can be between notes) */
  const iv = setInterval(() => { if (B.an) { B.an.getFloatTimeDomainData(t); for (const x of t) m = Math.max(m, Math.abs(x)); } if (++k % 10 === 0) document.querySelectorAll('canvas.sc-widget').forEach((c) => { if (c.offsetParent) wmax.set(c, Math.max(wmax.get(c) || 0, ink(c))); }); }, 20);
  setTimeout(() => {
    clearInterval(iv);
    const v = document.querySelector('#viz');
    ok({ peak: +m.toFixed(4), state: B.ctx ? B.ctx.state : 'none', dot: document.querySelector('#audioSt')?.dataset.state, scope: v ? ink(v) : -1, widgets: [...wmax.values()], playing: window.__sc.S.playing, status: document.querySelector('#status').textContent, active: (window.__sc.Engine.state.activeCode || '').replace(/\s+/g, ' ').slice(0, 60) });
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
  await layoutCase('fresh', page);
  check('[fresh] no page errors, console errors or name collisions', errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

/* stale service worker: an older build installs its SW and fills the HTTP cache, then the server flips to this build */
for (const [b, OLD] of OLDS) {
  const tag = 'stale ' + b;
  root = OLD; swVersion = 'sc-test-old-' + b.split(' ')[0];
  const { page, ctx, errors } = await newPage(tag);
  await page.goto(BASE); await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(2500);
  check(`[${tag}] old service worker controls the page`, await page.evaluate(() => !!navigator.serviceWorker.controller));
  root = SITE; swVersion = 'sc-test-new'; errors.length = 0;
  await page.reload(); await page.waitForSelector('#list li[data-id]', { timeout: 30000 }); await page.waitForTimeout(1500);
  check(`[${tag}] page runs this build after reload (no mixed old shell)`, await page.evaluate(() => !!document.querySelector('#audioSt') && !!(window.__sc && window.__sc.audio)));
  await page.waitForTimeout(1500);
  const pre = await page.evaluate(() => ({ modals: [...document.querySelectorAll('dialog[open]')].map((d) => d.querySelector('h2')?.textContent || d.className), toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.replace(/×$/, '')) }));
  check(`[${tag}] after the upgrade no modal covers the transport (upgrade questions are toasts)`, pre.modals.length === 0, JSON.stringify(pre));
  await scenario(tag, page);
  check(`[${tag}] no page errors, console errors or name collisions`, errors.length === 0, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

check('Play pressed with a real tap every time (never covered, never off screen)', tapFails.length === 0, tapFails.slice(0, 3).join(' | '));
await browser.close(); server.close();
const fails = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fails.length}/${checks.length} checks passed`);
process.exit(fails.length ? 1 : 0);
