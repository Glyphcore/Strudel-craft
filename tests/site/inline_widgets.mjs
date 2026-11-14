// Inline visuals (_pianoroll, _scope ...): CodeMirror block widgets under the calling line, in the scroll flow, at the editor width,
// moving with the text, no layout shift on Play; Rack and Stack, 360 px and 1440 px. Usage: node tests/site/inline_widgets.mjs
// Playwright smoke test for the static site (issue #10).
// Usage: node tests/site/smoke.mjs [--quick]   (uses the pre-installed Playwright Chromium)
// Serves site/ on a local port, drives the UI, plays every catalog recipe, measures frame time,
// writes screenshots + docs/screens/metrics.json, and exits non-zero on any console error or failed check.
import { createRequire } from 'module';
import { execFileSync } from 'node:child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'docs/screens');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
async function run(W) {
  const p = await (await browser.newContext({ viewport: { width: W, height: 800 }, hasTouch: W < 500, isMobile: W < 500 })).newPage();
  if (process.env.HTTPS_PROXY) await p.route(/esm\.sh|unpkg\.com|githubusercontent|api\.github|jsdelivr/, r => { const u=r.request().url(); if (u.includes('api.github')) return r.fulfill({status:200, contentType:'application/json', body:'{"body":""}'}); try { const body = execFileSync('curl', ['-sL', u], {maxBuffer: 1e8}); r.fulfill({ status: 200, contentType: u.endsWith('.json')?'application/json':'application/javascript', headers: {'access-control-allow-origin':'*'}, body }); } catch (e) { r.abort(); } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text().slice(0,160)));
  await p.goto(BASE + '#r/sub-bass'); await p.waitForFunction(()=>document.documentElement.dataset.editor==='cm6',null,{timeout:40000});
  const CODE = '$: note("c3 e3 g3 b3").s("triangle")\n  ._pianoroll()\n$: s("sine").note("c2*2")\n  ._scope()\n$: note("c4").s("sine").gain(0.3)';
  let ok = true; const check = (n, c, d='') => { if (!c) ok = false; console.log(`${c ? 'PASS' : 'FAIL'} [${W}] ${n} ${d}`); };
  async function measure(view) {
    return p.evaluate((view) => {
      const ed = document.querySelector(`.view-${view} .cm-editor`); const sc = ed.querySelector('.cm-scroller'); const er = sc.getBoundingClientRect();
      const rel = (r) => ({ x: Math.round(r.left - er.left), y: Math.round(r.top - er.top + sc.scrollTop), w: Math.round(r.width), h: Math.round(r.height) });
      const content = ed.querySelector('.cm-content'); const cs = getComputedStyle(content); const cr = content.getBoundingClientRect();
      const innerW = Math.round(cr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      const lines = [...ed.querySelectorAll('.cm-line')].map((l) => rel(l.getBoundingClientRect()));
      const ws = [...ed.querySelectorAll('.cm-sc-widget')].map((w) => ({ ...rel(w.getBoundingClientRect()), inScroller: sc.contains(w), cw: w.querySelector('canvas').width, ch: w.querySelector('canvas').height, cssW: Math.round(w.querySelector('canvas').getBoundingClientRect().width) }));
      return { innerW, lines, ws, overlays: document.querySelectorAll('canvas.sc-widget').length - ed.querySelectorAll('.cm-sc-widget canvas').length - document.querySelectorAll('.view:not(.view-' + view + ') .cm-sc-widget canvas').length };
    }, view);
  }
  for (const view of ['rack', 'stack']) {
    if (view === 'stack') { await p.evaluate(() => { const s = window.__sc.S; if (!s.stack.length) window.__sc.toggleStack('sub-bass'); }); await p.click('.views a[data-view=stack]'); await p.waitForTimeout(600); }
    await p.evaluate(([c, id]) => { const v = document.getElementById(id).cmView; v.focus(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c }, userEvent: 'input.paste' }); }, [CODE, view === 'rack' ? 'code' : 'stackCode']);
      await p.waitForFunction((view) => document.querySelectorAll(`.view-${view} .cm-sc-widget`).length === 2, view, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    const m = await measure(view);
    if (m.ws.length !== 2) console.log('debug', await p.evaluate(() => { const S = window.__sc.S; const es = window.strudelCraft.engineState(); const es2 = window.strudelCraft.engineState(); const b = window.strudelCraft.binder; const orig = b && b.original ? b.original(es2.activeCode) : es2.activeCode; const d = document.getElementById('stackCode').cmView.state.doc.toString(); return JSON.stringify({ wpos: (es2.widgets || []).map((w) => [w.from, w.to, b && b.toOriginal ? b.toOriginal(es2.activeCode, w.to) : null]), rawLen: es2.activeCode.length, origLen: orig.length, docLen: d.length, ends: orig.endsWith(d), origTail: orig.slice(-60), docTail: d.slice(-60), busy: S.busy, dot: document.getElementById('liveChip')?.dataset.v, cs: window.__sc.Engine && 0, src: (()=>{ try { return 0; } catch(e){} })(), live: S.live, stackEdit: (S.stackEdit || '').slice(0, 30), doc: document.getElementById('stackCode').cmView.state.doc.toString().slice(0, 30), chip: document.getElementById('liveChip')?.dataset.state, view: S.view, playing: S.playing, src: S.srcView, stack: S.stack.length, err: String(es.evalError || ''), widgets: (es.widgets || []).length, act: (es.activeCode || '').slice(0, 80) }); }));
  check(`${view}: two widgets before Play`, m.ws.length === 2, JSON.stringify(m.ws));
    if (m.ws.length === 2) {
      const [a, c] = m.ws, L = m.lines;
      check(`${view}: pianoroll widget right under line 2`, Math.abs(a.y - (L[1].y + L[1].h)) <= 2, `${a.y} vs ${L[1].y + L[1].h}`);
      check(`${view}: line 3 below the first widget`, L[2].y >= a.y + a.h - 1, `${L[2].y} >= ${a.y + a.h}`);
      check(`${view}: scope widget under line 4`, Math.abs(c.y - (L[3].y + L[3].h)) <= 2 && L[4].y >= c.y + c.h - 1);
      check(`${view}: inside the scroll container`, a.inScroller && c.inScroller);
      check(`${view}: at the editor width`, Math.abs(a.cssW - m.innerW) <= 2 && Math.abs(c.cssW - m.innerW) <= 2, `${a.cssW}/${m.innerW}`);
      check(`${view}: backing store matches CSS box`, Math.abs(a.cw - a.cssW * (await p.evaluate(() => Math.min(2, devicePixelRatio)))) <= 2);
      check(`${view}: no detached overlay canvases`, m.overlays === 0, m.overlays);
      // typing above moves widgets with the text
      await p.evaluate((id) => { const v = document.getElementById(id).cmView; v.dispatch({ changes: { from: 0, insert: '// added line\n' } }); }, view === 'rack' ? 'code' : 'stackCode');
      await p.waitForTimeout(400); const m2 = await measure(view);
      check(`${view}: typing above moves widgets down`, m2.ws.length === 2 && m2.ws[0].y > a.y && Math.abs((m2.ws[0].y - a.y) - (m2.lines[1].y - L[0].y)) <= 2, `${a.y}->${m2.ws[0]?.y}`);
      await p.evaluate((id) => { const v = document.getElementById(id).cmView; v.dispatch({ changes: { from: 0, to: 14 } }); }, view === 'rack' ? 'code' : 'stackCode');
      await p.waitForTimeout(1200);
    }
    const pre = await measure(view);
    if (view === 'rack') { await p.click('#playBtn'); await p.waitForFunction(()=>document.body.classList.contains('playing'),null,{timeout:60000}); }
    await p.waitForTimeout(2500);
    const post = await measure(view);
    check(`${view}: no layout shift on Play`, JSON.stringify(pre.ws.map(w=>[w.y,w.h,w.cssW,w.cw,w.ch])) === JSON.stringify(post.ws.map(w=>[w.y,w.h,w.cssW,w.cw,w.ch])) && JSON.stringify(pre.lines) === JSON.stringify(post.lines), JSON.stringify(pre.ws.map(w=>[w.y,w.h,w.cw])) + ' / ' + JSON.stringify(post.ws.map(w=>[w.y,w.h,w.cw])));
    const ink = await p.evaluate((view) => [...document.querySelectorAll(`.view-${view} .cm-sc-widget canvas`)].map(c => { const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=3;i<d.length;i+=16) if (d[i]) n++; return n; }), view);
    check(`${view}: both widgets draw while playing`, ink.length === 2 && ink.every((n) => n > 50), JSON.stringify(ink));
    await p.evaluate((view)=>document.querySelector(`.view-${view} .cm-editor`).scrollIntoView(), view); await p.screenshot({ path: path.join(OUT, `inline-widgets-${view}-${W}.png`) });
  }
  check('no console errors', errs.length === 0, errs.slice(0,3).join(' | '));
  await p.context().close(); return ok;
}
let all = true; for (const W of [360, 1440]) all = (await run(W)) && all;
await browser.close(); server.close();
console.log(all ? 'inline widgets: all checks passed' : 'inline widgets: FAILED'); process.exit(all ? 0 : 1);
