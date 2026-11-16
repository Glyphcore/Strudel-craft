// CraftCues site UI (#163) at 390 px with real touch. Night phonk v2 (shipped sidecar, 25 cues) plays: the captions strip shows the expected cues at bars
// 17, 33 and 65 (seeked with the transport), its bar is within 1 bar of the scheduler's; a chip tap opens the KB card and moves nothing in the editor;
// Score sheet (sections, kind filter, add cue at bar, export .vtt / .craftcues / JSON parse back); Resources Cues section; an inline //@ program: strip,
// deliberate Go to code; Record take carries cues and the WAV download writes a .vtt; quick play of the Syntax cues example shows the strip.
// Usage: node tests/site/cues.mjs [shot.png]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import * as C from '../../site/engine/cues.js';
const ROOTD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const ROOT = path.join(ROOTD, 'site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.png': 'image/png', '.craftcues': 'text/plain' };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const V2 = fs.readFileSync(path.join(ROOTD, 'docs/tracks/night-phonk-demo/track.v2.strudel.js'), 'utf8');
const INLINE = '// @daw bars=16\nsetcpm(240/4)\n//@ 1-8 section: first half | form:intro\nbell: n("0 2 4 3").scale("C4:minor").s("triangle").decay(0.1).gain(0.3) //@ 1-16 motif: the bell cell | MOT-01 | id=cell\n//@ 9-16 section: second half | form:drop\nbass: n("<0 -2>").scale("C2:minor").s("sawtooth").lpf(500).gain(0.3)\n';
let fails = 0; const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`); };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|AudioContext|404/.test(m.text())) errs.push(m.text()); });
  await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  const reqs = []; p.on('request', (r) => reqs.push(r.url()));
  await p.goto(`http://localhost:${srv.address().port}/index.html#rack`); await p.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.cues && window.strudelCraft.palette && document.querySelector('#code') && document.querySelector('.cu-score-open'), null, { timeout: 60000 });
  check('nothing of the cues UI loads before a program with cues plays or the sheet opens', !reqs.some((u) => /cues-ui\.js|cues\.css|engine\/cues/.test(u)));
  await p.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.load('glyphcore/phonk:atoms'); await window.strudelCraft.packs.load('glyphcore/phonk:atoms-v2'); });
  const setCode = (c) => p.evaluate((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } document.activeElement && document.activeElement.blur(); }, c);
  const ed = () => p.evaluate(() => { const ta = document.getElementById('code'); const s = ta.closest('.editor') && ta.closest('.editor').querySelector('.cm-scroller'); return { top: s ? s.scrollTop : 0, y: window.scrollY, sel: ta.cmView ? ta.cmView.state.selection.main.head : ta.selectionStart }; });
  const tapEl = async (sel) => { const r = await p.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => { const q = x.getBoundingClientRect(); return q.width > 0 && q.height > 0; }); if (!e) return null; if (sel.includes('-open')) e.scrollIntoView({ block: 'center' }); else if (e.closest('.cu-chips')) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; }, sel); if (!r) throw new Error('no ' + sel); await p.touchscreen.tap(r.x, r.y); };

  /* 1. night phonk v2 plays with its shipped cue set */
  await setCode(V2); await p.evaluate(() => window.__sc.play());
  await p.waitForSelector('.cu-strip:not([hidden])', { timeout: 120000 });
  check('the captions strip appears above the transport while night phonk v2 plays', await p.evaluate(() => { const s = document.querySelector('.cu-strip').getBoundingClientRect(), f = document.querySelector('footer.transport').getBoundingClientRect(); return s.bottom <= f.top + 1 && s.width <= 390; }));
  const want = { 17: ['drop-a', 'pump-a', 'bell-hook'], 33: ['relief-1', 'relief-release'], 65: ['drop-c', 'drop-c-res', 'bell-hook'] }; const drift = [];
  for (const [bar, ids] of Object.entries(want)) {
    await p.evaluate((c) => window.strudelCraft.range.seek(c), +bar - 1 + 0.25);
    await p.waitForFunction((bar) => { const s = document.querySelector('.cu-strip'); return s && +s.dataset.bar >= bar && +s.dataset.bar <= bar + 1; }, +bar, { timeout: 20000 }).catch(() => {});
    const r = await p.evaluate(() => ({ bar: +document.querySelector('.cu-strip').dataset.bar, now: window.strudelCraft.transport.scheduler.now(), ids: [...document.querySelectorAll('.cu-strip .cu-chip')].map((c) => c.dataset.id) }));
    drift.push(Math.abs(r.bar - (Math.floor(r.now) + 1)));
    check(`bar ${bar}: the strip shows ${ids.join(', ')}`, ids.every((i) => r.ids.includes(i)), `strip bar ${r.bar}: ${r.ids.join(',')}`);
  }
  check('caption bar within 1 bar of the transport bar at every check', drift.every((d) => d <= 1), JSON.stringify(drift));
  const hot = await p.evaluate(() => ({ hot: document.querySelectorAll('[data-cue-hot="true"]').length, rows: [...document.querySelectorAll('[data-lane]')].filter((e) => e.getBoundingClientRect().width > 0).length }));
  check('layer-scoped cues light the lane rows / graph nodes they name when those are on screen', hot.rows === 0 || hot.hot > 0, JSON.stringify(hot));
  /* 2. chip tap: KB card, nothing moves */
  await p.evaluate(() => window.strudelCraft.range.seek(16.25)); await p.waitForSelector('.cu-strip .cu-chip[data-id="drop-a"]', { timeout: 20000 });
  await p.evaluate(() => { const v = document.getElementById('code').cmView; if (v) v.dispatch({ selection: { anchor: 120 } }); }); await p.waitForTimeout(1500);
  const before = await ed(); await tapEl('.cu-strip .cu-chip[data-id="drop-a"]'); await p.waitForSelector('dialog.scm[open] .cu-card', { timeout: 10000 });
  const card = await p.$eval('dialog.scm[open] .cu-card', (e) => e.textContent); const after = await ed();
  check('a chip tap opens the KB card (form:drop, ARR-02 resolved with a link)', /ARR-02/.test(card) && /resolved/.test(card) && /Open in Syntax/.test(card), card.slice(0, 120));
  check('the chip tap does not scroll, focus or select in the editor', after.top === before.top && after.y === before.y && after.sel === before.sel, JSON.stringify({ before, after }));
  if (process.argv[2]) await p.screenshot({ path: process.argv[2].replace(/\.png$/, '-card.png') });
  await p.evaluate(() => document.querySelector('dialog.scm[open] .scm-acts .ghost').click());
  if (process.argv[2]) await p.screenshot({ path: process.argv[2] });
  /* 3. Resources: Cues section */
  await p.evaluate(() => window.strudelCraft.resources.openSheet()); await p.waitForSelector('dialog.rs-sheet[open]', { timeout: 30000 }); await p.waitForSelector('dialog.rs-sheet[open] .rs-cues', { timeout: 30000, state: 'attached' });
  const rc = await p.$eval('dialog.rs-sheet .rs-cues', (e) => ({ n: +e.dataset.cues, t: e.textContent })); check('the Resources sheet has a Cues section with the KB ids the cues reference', rc.n >= 10 && /MOT-01|FS-05/.test(rc.t), `${rc.n} ids`);
  await p.evaluate(() => document.querySelector('dialog.rs-sheet').close());
  /* 4. Score sheet */
  await tapEl('.cu-score-open'); await p.waitForSelector('dialog.cu-sheet[open] .cu-sec', { timeout: 10000 });
  const secs = await p.$$eval('dialog.cu-sheet .cu-sec h3', (h) => h.map((x) => x.textContent)); check('Score sheet lists cues grouped by section', secs.some((s) => /drop-a 17-32/.test(s)) && secs.some((s) => /relief-1/.test(s)), secs.join(' | '));
  await tapEl('dialog.cu-sheet .cu-pill[data-kind="section"]'); const ks = await p.$$eval('dialog.cu-sheet .cu-item', (l) => [...new Set(l.map((x) => x.dataset.k))]); check('kind filter shows only that kind', ks.length === 1 && ks[0] === 'section', ks.join(','));
  const dl = async (x) => { const [d] = await Promise.all([p.waitForEvent('download'), p.evaluate((x) => document.querySelector(`dialog.cu-sheet [data-x="${x}"]`).click(), x)]); const f = path.join(ROOTD, 'tests/site/.cues-dl-' + x); await d.saveAs(f); const t = fs.readFileSync(f, 'utf8'); fs.unlinkSync(f); return { name: d.suggestedFilename(), t }; };
  const ev = await dl('vtt'), ec = await dl('craftcues'), ej = await dl('json');
  check('export .vtt / .craftcues / JSON download and parse back', /\.vtt$/.test(ev.name) && /^WEBVTT/.test(ev.t) && C.parse(ec.t).doc.cues.length >= 25 && JSON.parse(ej.t).cues.length >= 25, [ev.name, ec.name, ej.name].join(' '));
  await tapEl('dialog.cu-sheet .cu-pill[data-kind="all"]'); await tapEl('dialog.cu-sheet .cu-add'); await p.waitForSelector('dialog.scm[open] .cu-form', { timeout: 10000 });
  await p.fill('dialog.scm[open] textarea[name="body"]', 'added from the test'); await p.evaluate(() => document.querySelector('dialog.scm[open] .scm-ok').click());
  await p.waitForFunction(() => [...document.querySelectorAll('dialog.cu-sheet .cu-item')].some((x) => /added from the test/.test(x.textContent)), null, { timeout: 10000 }).catch(() => {});
  check('Add cue at bar writes a cue that the sheet lists (stored in this browser)', await p.evaluate(() => [...document.querySelectorAll('dialog.cu-sheet .cu-item')].some((x) => /added from the test/.test(x.textContent)) && Object.keys(localStorage).some((k) => /^sc\.cues\./.test(k))));
  await p.evaluate(() => document.querySelector('dialog.cu-sheet').close()); await p.evaluate(() => window.__sc.stop()); await p.waitForTimeout(300);
  /* 5. inline //@ program: strip, Go to code is deliberate */
  await setCode(INLINE); await p.evaluate(() => window.__sc.play()); await p.waitForFunction(() => { const s = window.strudelCraft.transport.scheduler; return window.strudelCraft.transport.playing && s && s.started; }, null, { timeout: 30000 }); await p.waitForTimeout(800);
  for (let i = 0; i < 6; i++) { await p.evaluate(() => window.strudelCraft.range.seek(0.25)); await p.waitForTimeout(700); if (await p.evaluate(() => window.strudelCraft.transport.scheduler.now() < 12)) break; }
  await p.waitForFunction(() => document.querySelector('.cu-strip .cu-chip[data-id="cell"]'), null, { timeout: 60000 }).catch(async () => { console.log('DEBUG', JSON.stringify(await p.evaluate(() => ({ playing: window.strudelCraft.transport.playing, src: (window.strudelCraft.transport.source() || {}).code?.slice(0, 40), ids: window.strudelCraft.cues.doc && window.strudelCraft.cues.doc.cues.map((c) => c.id).slice(0, 8), hidden: document.querySelector('.cu-strip').hidden, chips: [...document.querySelectorAll('.cu-chip')].map((c) => c.dataset.id) })))); });
  await p.evaluate(() => { const v = document.getElementById('code').cmView; if (v) v.dispatch({ selection: { anchor: 10 } }); }); await p.waitForTimeout(800);
  const b2 = await ed(); await tapEl('.cu-strip .cu-chip[data-id="cell"]'); await p.waitForSelector('dialog.scm[open] .cu-go', { timeout: 10000 }); const a2 = await ed();
  check('inline cue: the chip opens the card with a Go to code button; the press alone moves nothing', a2.sel === b2.sel && a2.top === b2.top);
  await p.evaluate(() => document.querySelector('dialog.scm[open] .cu-go').click()); await p.waitForTimeout(400);
  const line = await p.evaluate(() => { const ta = document.getElementById('code'); const v = ta.cmView; return v ? v.state.doc.lineAt(v.state.selection.main.head).number : ta.value.slice(0, ta.selectionStart).split('\n').length; });
  check('Go to code puts the caret on the cue line (line 4)', line === 4, String(line));
  /* 6. Record: the take carries cues, the WAV download writes a .vtt next to it */
  await p.evaluate(() => { window.strudelCraft.capture.configure({ source: 'live', audio: true, events: false, code: true, mode: 'cycles', n: 1, name: 'cuetake' }); window.strudelCraft.capture.record(); });
  let take = null; for (let i = 0; i < 120 && !(take && take.audio && take.audio.length); i++) { await p.waitForTimeout(500); take = await p.evaluate(async () => (await window.strudelCraft.capture.list()).find((x) => x.name === 'cuetake') || null); }
  take = take || {};
  check('the take stores the program cues (recipe field cues, craftcues@1)', take.cues && take.cues.format === 'craftcues@1' && take.cues.cues.length >= 3 && ['cell', 'L3', 'L5'].every((i) => take.cues.cues.some((c) => c.id === i)), take.cues ? String(take.cues.cues.length) : 'none');
  const names = []; p.on('download', (d) => names.push(d.suggestedFilename())); await p.evaluate((id) => window.strudelCraft.capture.download(id, 'wav16'), take.id); await p.waitForTimeout(2500);
  check('the WAV download writes a .vtt with the same base name', names.some((n) => /\.wav$/.test(n)) && names.some((n) => /\.vtt$/.test(n) && names.some((w) => w.replace(/\.wav$/, '') === n.replace(/\.vtt$/, ''))), names.join(' '));
  await p.evaluate(() => window.__sc.stop()); await p.waitForTimeout(300);
  /* 7. quick play of the Syntax cues example shows the strip on the audition clock */
  await p.evaluate(() => { location.hash = '#syntax=cues'; }); await p.waitForTimeout(1500);
  await p.waitForFunction(() => document.querySelector('.qp[data-qp^="syntax:cues:"]'), null, { timeout: 30000 }).catch(() => {});
  const qsel = await p.evaluate(() => { const all = [...document.querySelectorAll('.qp[data-qp^="syntax:cues:"]')]; for (const x of all) x.scrollIntoView({ block: 'center' }); const b = all.find((x) => { const q = x.getBoundingClientRect(); return q.width > 0 && q.height > 0; }); if (!b) return null; b.scrollIntoView({ block: 'center' }); b.dataset.cuTest = '1'; return b.dataset.qp; });
  if (qsel) { await tapEl('.qp[data-cu-test="1"]'); await p.waitForFunction(() => { const s = document.querySelector('.cu-strip'); return s && !s.hidden && s.querySelector('.cu-chip'); }, null, { timeout: 60000 }).catch(() => {}); }
  check('quick play of the Syntax cues example shows captions', !!qsel && await p.evaluate(() => { const s = document.querySelector('.cu-strip'); return !!(s && !s.hidden && s.querySelector('.cu-chip')); }), String(qsel));
  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.close(); }
console.log(fails ? `${fails} FAIL` : 'all PASS'); process.exit(fails ? 1 : 0);
