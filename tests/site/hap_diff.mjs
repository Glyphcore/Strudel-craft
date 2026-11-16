/* Per-hap render diff (#115, docs/AUDIO_ENGINE.md section 5): night phonk v2, cycles 17..21, rendered in the render host with only some haps voiced
   (capture.js dbg.only; time and length unchanged), twice per hap, under CPU throttle x1 and x4. Residual = energy of (a - b) relative to a, in dB (-inf = bit-identical).
   Usage: node tests/site/hap_diff.mjs [--mode groups|all|whole] [--range A-B] [--runs 2] [--strip shape,room,...] [--json OUT.json] [--no-pin]
   whole --range A-B: only haps A..B-1 of the window (bisect: the smallest range whose runs differ).
   groups: the first hap of every (sound + parameter-name set) group; all: every hap (slow); whole: the whole window, N runs, residual of every pair. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), PREFIX = '/Strudel-craft/';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = path.resolve(arg('--site', path.join(ROOT, 'site'))), MODE = arg('--mode', 'groups'), RUNS = +arg('--runs', 2), AT = 17, N = 4;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', body: '## Site\n- [x] done' }) : '[]' }));
if (!process.argv.includes('--no-pin')) await ctx.addInitScript(() => { setInterval(() => { try { const m = window.soundMap && window.soundMap.get(); if (m && m.sawtooth && m.supersaw && m.supersaw !== m.sawtooth) window.soundMap.setKey('supersaw', m.sawtooth); } catch (e) { /* not loaded */ } }, 50); });
const page = await ctx.newPage();
await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.capture, null, { timeout: 90000 });
await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; await P.load('glyphcore/phonk:atoms'); await P.load('glyphcore/phonk:presets'); window.__sc.setView('syntax'); });
for (let k = 0; k < 5; k++) { await page.waitForFunction(() => document.querySelectorAll('#sx-tracks .sx-run').length > 1, null, { timeout: 60000 }); await page.waitForTimeout(500); if (await page.evaluate(() => { const b = document.querySelectorAll('#sx-tracks .sx-run')[1]; if (!b) return false; b.click(); return true; })) break; }
await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy && window.__sc.Engine.started, null, { timeout: 120000 });
await page.evaluate(() => { window.strudelCraft.transport.stop(); }); await page.waitForTimeout(1500); /* transport stopped, as in the issue */
const cdp = await ctx.newCDPSession(page);
/* a recipe for the window (the take is stored; its recipe is what the host renders) + the hap list */
const base = await page.evaluate(async ({ n, at }) => { const C = window.strudelCraft.capture; C.configure({ source: 'offline', audio: true, events: false, code: true });
  const rec = await C.recordOffline(n, { at, name: 'hapdiff' }); window.__hd = rec.recipe; const out = await C.renderRecipe(rec.recipe, { dbg: { list: true, only: [] } });
  return { haps: out.hapInfo, haps0: out.haps }; }, { n: N, at: AT });
const key = (h) => { const v = h.v; return (v.s || '?') + '|' + Object.keys(v).filter((k) => !['s', 'note', 'n', 'gain', 'velocity', 'clip', 'dur', 'duration', 'color'].includes(k)).sort().join(','); };
/* residual of two renders in the page; one function, same dBs everywhere */
const DIFF = `(a, b) => { let ea = 0, ed = 0, pk = 0; for (const ch of ['L', 'R']) { const x = a[ch], y = b[ch]; for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; ea += x[i] * x[i]; ed += d * d; if (Math.abs(d) > pk) pk = Math.abs(d); } } return { resDb: ed === 0 ? -Infinity : 10 * Math.log10(ed / Math.max(ea, 1e-20)), peakDiff: pk, energy: ea }; }`;
let THR_NOW = 1; const STRIP = arg('--strip', null) ? arg('--strip').split(',') : null;
const run = (only, tag) => page.evaluate(async ({ only, DIFF, runs, STRIP, thr }) => { const C = window.strudelCraft.capture, diff = eval(DIFF); const outs = []; window.__outs = window.__outs || {}; window.__outs[thr] = outs; for (let r = 0; r < runs; r++) outs.push(await C.renderRecipe(window.__hd, { dbg: { only: only || undefined, strip: STRIP }, inline: false }));
  const pairs = []; for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) pairs.push(diff(outs[i], outs[j])); return { pairs, stats: outs.map((o) => o.timerStats) }; }, { only, DIFF, runs: RUNS, STRIP, thr: THR_NOW });
const rows = []; const groups = new Map(); base.haps.forEach((h) => { const k = key(h); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h.i); });
console.log(`haps ${base.haps.length}, groups ${groups.size}`); if (arg('--show', null)) { const [a, b] = arg('--show').split('-').map(Number); for (const h of base.haps.slice(a, b)) console.log(h.i, h.t, JSON.stringify(h.v)); }
for (const thr of (arg('--throttles', '1,4')).split(',').map(Number)) { THR_NOW = thr; await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
  if (MODE === 'whole') { const rg = arg('--range', null), sel = rg ? Array.from({ length: +rg.split('-')[1] - +rg.split('-')[0] }, (_, q) => q + +rg.split('-')[0]) : null; const { pairs: p, stats } = await run(sel); if (stats && stats[0]) console.log('timers (run 0): ' + JSON.stringify(stats[0])); const worst = p.reduce((m, x) => Math.max(m, x.resDb), -Infinity); rows.push({ throttle: thr, whole: p.map((x) => +x.resDb.toFixed(1)), worst: +worst.toFixed(1) }); console.log(`x${thr} whole window${arg('--range', '') ? ' haps ' + arg('--range') : ''}: ${p.map((x) => x.resDb.toFixed(1)).join(', ')} dB`); continue; }
  for (const [k, idx] of groups) { const pick = MODE === 'all' ? idx : [idx[0]];
    for (const i of pick) { const p = (await run([i])).pairs[0]; const h = base.haps[i]; rows.push({ throttle: thr, hap: i, group: k, count: idx.length, t: h.t, resDb: p.resDb === -Infinity ? null : +p.resDb.toFixed(1), peakDiff: p.peakDiff, energyDb: +(10 * Math.log10(p.energy + 1e-20)).toFixed(1) }); console.log(`x${thr} hap ${i} ${k} (x${idx.length}) residual ${p.resDb === -Infinity ? 'bit-identical' : p.resDb.toFixed(1) + ' dB'} peakDiff ${p.peakDiff.toExponential(2)}`); } } }
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
if (MODE === 'whole') { const x = await page.evaluate(({ DIFF }) => { const o = window.__outs; if (!o[1] || !o[4]) return null; return eval(DIFF)(o[1][0], o[4][0]); }, { DIFF }); if (x) { rows.push({ cross: 'x1 vs x4', resDb: x.resDb }); console.log(`x1 vs x4 render: ${x.resDb.toFixed(1)} dB`); } }
const J = arg('--json', null); if (J) fs.writeFileSync(J, JSON.stringify({ haps: base.haps.length, groups: groups.size, rows }, null, 1));
await browser.close(); server.close();
