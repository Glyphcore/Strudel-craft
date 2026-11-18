/* Render-ahead buffers (#195, site/renderahead.js): the lead is set in the audio dot sheet, chunks render in the offline host and show on the timeline
   (ruler extent + Mix waveform), an edit dirties only the chunks whose events changed, and the lead in seconds is measured under a stress program.
   Writes docs/screens/renderahead-1440.png and docs/screens/renderahead.json (the measured numbers).
   Usage (repo root): node tests/site/renderahead.mjs   (wrap in engine/load/gate.sh heavy: it renders offline while playing) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = []; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const LEAD = 12;
/* 8-cycle phrase at 0.5 cps: chunks of 2 cycles (4 s), pre-roll 1 cycle. The edit changes cycle 7 only: chunk 3 (cycles 6-7).
   (Chunk 4 has cycle 7 as its pre-roll and would be dirty too; at a 12 s lead from cycle 0 it is not in the window.) */
const INV = (last) => `setcpm(120/4)\nbass: note("<c2 d2 eb2 f2 g2 ab2 bb2 ${last}>").s("sawtooth").lpf(700).decay(0.4).gain(0.05)\nhat: s("triangle*4").note("c6").decay(0.05).gain(0.03)\n`;
const STRESS = ['setcpm(140/4)', 'a: s("sawtooth*16").note("<c2 eb2 g2 bb2>").lpf(sine.range(300, 3000).slow(4)).room(0.4).gain(0.03)', 'b: note("c4 eb4 g4 bb4 c5 bb4 g4 eb4").fast(2).s("triangle").delay(0.4).room(0.5).gain(0.03)',
  'c: s("square*8").note("c3").decay(0.05).gain(0.02)', 'd: s("white*16").decay(0.03).hpf(6000).gain(0.02)', 'e: note("<[c3,eb3,g3] [bb2,d3,f3]>").s("sawtooth").room(0.6).lpf(1200).gain(0.02)', 'f: s("sine*4").note("c1").decay(0.2).gain(0.05)', ''].join('\n');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); const wait = (ms) => page.waitForTimeout(ms);
const T = (f, a) => page.evaluate(f, a); const ah = () => T(() => window.strudelCraft.ahead.state());
const setCode = (c) => T((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, c);
const playStop = async (ms) => { await T(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 }); await wait(ms); await T(() => window.__sc.stop()); await wait(400); await T(() => { const t = window.strudelCraft.timeline; t.setMode('off'); t.seek(0); t.setZoom(60); document.getElementById('tlScroll').scrollLeft = 0; }); };
await page.goto(`http://127.0.0.1:${server.address().port}/index.html#rack`); await page.waitForSelector('#list li[data-id]', { timeout: 60000 }); await page.waitForFunction(() => window.strudelCraft.timeline && window.strudelCraft.bg && window.strudelCraft.capture, null, { timeout: 30000 });
check('nothing at page load: renderahead.js loads at the first Play (#199) or with an explicit lead', await T(() => !window.strudelCraft.ahead));
/* this test sets its own 12 s window in the sheet below; the default (whole program from the first Play, #199) is tests/site/bufferplay.mjs section 8 */
await T(() => localStorage.setItem('sc.ahead.lead', '0'));
await setCode(INV('c3')); await wait(500); await playStop(1500);
/* the lead is set in the audio dot sheet */
await T(() => window.strudelCraft.bg.openDiagnostics()); await page.fill('#bgDiag #bgAhead', String(LEAD)); await page.dispatchEvent('#bgDiag #bgAhead', 'change');
await page.waitForFunction(() => window.strudelCraft.ahead && window.strudelCraft.ahead.state().on, null, { timeout: 15000 });
let a = await ah(); check(`audio dot sheet: "Render ahead lead" sets the lead (${LEAD} s) and loads the module`, a.lead === LEAD && a.on && (await T(() => localStorage.getItem('sc.ahead.lead'))) === String(LEAD), `chunk ${a.chunkCycles} cycles = ${a.chunkSec} s, pre-roll ${a.preCycles}`);
await T(() => document.activeElement && document.activeElement.blur()); await wait(1300); const row = await T(() => { const dt = [...document.querySelectorAll('#bgDiag dt')].find((x) => x.textContent === 'Render ahead'); return dt ? dt.nextElementSibling.textContent : null; });
check('audio dot sheet: a live "Render ahead" row', !!row && /(ready|rendering \d+ of \d+).* s ahead/.test(row), String(row)); await T(() => document.getElementById('bgDiag').close());
/* chunks 0..4 render while stopped (precompute, cursor at 0) */
await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return [0, 1, 2, 3].every((i) => s.ready.includes(i)) && s.rendering == null; }, null, { timeout: 180000 }).catch(() => {});
a = await ah(); check('precompute while stopped: chunks 0-3 ready, lead reaches the target', [0, 1, 2, 3].every((i) => a.ready.includes(i)) && a.leadSec >= LEAD, `ready ${a.ready.join()}, lead ${a.leadSec} s, ${a.renders} renders at ${a.speed}x, error "${a.error}"`);
/* buffered extent on the ruler and the Mix waveform from the same buffers (no take in this profile) */
const px = await T(() => { const s = window.strudelCraft.timeline.state(); const c = document.getElementById('lanes'), g = c.getContext('2d'), d = c.width / s.width; const cnt = (y, h) => { const im = g.getImageData(Math.round(s.gutter * d), Math.round(y * d), c.width - Math.round(s.gutter * d), Math.max(1, Math.round(h * d))).data; let n = 0; for (let i = 3; i < im.length; i += 4) if (im[i] > 40) n++; return n; }; return { ruler: cnt(1, 1), mix: cnt(s.ruler + 6, s.rowH - 12), audio: s.audio }; });
check('timeline: buffered extent drawn on the ruler', px.ruler > 200, px.ruler + ' px in the ruler top row');
check('timeline: Mix row waveform comes from the chunk buffers (no take loaded)', px.audio == null && px.mix > 300, px.mix + ' px');
/* stems: one per lane and chunk; the lanes draw their waveform from them (stopped: no live tap involved for these bars) */
await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return s.stemsMissing === 0 && s.rendering == null; }, null, { timeout: 240000 }).catch(() => {}); await T(() => window.strudelCraft.timeline.clearLive()); await wait(400);
a = await ah(); const wv = (await T(() => window.strudelCraft.timeline.state())).wave; const stems0 = a.stemRenders;
check('stems: every lane of chunks 0-3 has a stem; lane waveforms come from the buffers', a.stemsMissing === 0 && a.stemsReady >= 8 && wv.laneBuf > 300 && wv.laneLive === 0 && wv.mixBuf > 300, `${a.stemsReady} stems ready (${a.stemRenders} renders), lane columns: buffer ${wv.laneBuf}, live ${wv.laneLive}, flat ${wv.laneFlat}; mix buffer columns ${wv.mixBuf}`);
await page.screenshot({ path: path.join(ROOT, 'docs/screens/renderahead-1440.png') });
/* invalidation: the edit changes cycle 7 only */
const before = await T(() => window.strudelCraft.ahead.chunks().map((c) => [c.i, c.hash, c.st])); const r0 = a.renders;
await setCode(INV('c4')); await wait(700); await playStop(1200);
await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return s.dirty.length > 0; }, null, { timeout: 20000 }).catch(() => {});
a = await ah(); const after = await T(() => window.strudelCraft.ahead.chunks().map((c) => [c.i, c.hash, c.st])); const hb = new Map(before.map((x) => [x[0], x[1]]));
const moved = after.filter((x) => hb.has(x[0]) && hb.get(x[0]) !== x[1]).map((x) => x[0]), kept = after.filter((x) => hb.get(x[0]) === x[1] && x[2] === 'ready').map((x) => x[0]);
check('edit of cycle 7: only chunk 3 is dirty; chunks 0-2 keep their buffers', a.dirty.join() === '3' && moved.join() === '3' && [0, 1, 2].every((i) => kept.includes(i)), `dirty ${a.dirty.join()}, hash moved ${moved.join()}, kept ready ${kept.join()}, invalidated ${a.invalidated}`);
await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return s.ready.includes(3) && s.rendering == null; }, null, { timeout: 120000 }).catch(() => {});
await page.waitForFunction(() => { const s = window.strudelCraft.ahead.state(); return s.stemsMissing === 0 && s.rendering == null; }, null, { timeout: 120000 }).catch(() => {});
a = await ah(); check('the edited lane gets one new stem; the other lane keeps its stems', a.stemRenders - stems0 === 1 && a.stemsMissing === 0, `${a.stemRenders - stems0} new stem renders`);
check('only the dirty chunk renders again', a.renders - r0 === 1 && a.ready.includes(3), `${a.renders - r0} new renders`);
/* undo: the old buffers are found again, nothing renders */
const r1 = a.renders; await setCode(INV('c3')); await wait(700); await playStop(1200); await wait(1500); a = await ah();
check('undo of the edit re-uses the old buffers (no new render)', a.renders === r1 && [0, 1, 2, 3].every((i) => a.ready.includes(i)), `${a.renders - r1} new renders, ready ${a.ready.join()}`);
/* stress: lead in seconds while playing */
await setCode(STRESS); await wait(700); await T(() => window.strudelCraft.ahead.reset());
await T(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 });
const tl = []; for (let i = 0; i < 80; i++) { await wait(500); const s = await ah(); tl.push(s.leadSec); }
a = await ah(); const bgs = await T(() => { const s = window.strudelCraft.bg.stats(); return { lateTicks: s.lateTicks, underruns: s.underruns, maxGapMs: Math.round(s.maxGapMs) }; }); await T(() => window.__sc.stop());
const out = { program: 'stress: 6 layers, 16ths, reverb + delay, 140 bpm', playedSec: 40, leadTarget: LEAD, chunkSec: a.chunkSec, fillMs: a.fillMs, leadMin: a.leadMin, leadMedian: a.leadMedian, leadSamples: a.leadSamples, renderSpeedX: a.speed, renders: a.renders, stemRenders: a.stemRenders, stemsReady: a.stemsReady, stemsMissing: a.stemsMissing, liveShare: a.liveShare, errors: a.errors, lastError: a.error, leadEvery500ms: tl, live: bgs };
fs.writeFileSync(path.join(ROOT, 'docs/screens/renderahead.json'), JSON.stringify(out, null, 1) + '\n');
check('stress: render-ahead lead measured while playing (seconds)', a.renders > 0 && a.speed > 0 && a.errors === 0, `lead median ${a.leadMedian} s, min ${a.leadMin} s of ${LEAD} s target; first full after ${a.fillMs} ms; renders ${a.speed}x realtime (${a.renders} chunks of ${a.chunkSec} s); playhead on live ${a.liveShare}; stems ${a.stemsReady} ready / ${a.stemsMissing} missing (${a.stemRenders} renders); late ticks ${bgs.lateTicks}, underruns ${bgs.underruns}`);
check('stress: the render head stays ahead of the playhead (median lead > one chunk)', a.leadMedian != null && a.leadMedian > a.chunkSec, `${a.leadMedian} s`);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
