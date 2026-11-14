// Graph view soak (#52 stability): opens and closes the Graph view N times (default 50) in ONE page, and per round switches
// documents (demo, the 5000-atom document, lanes split / capture programs), collapses two tracks and undoes, opens the atom browser
// on the 5000-atom document and pages it, pans / zooms (wheel, Ctrl+wheel, drag, keys), and opens lane and capture node inspectors.
// After each round: forced GC (HeapProfiler.collectGarbage x2), then JS heap used, DOM nodes, event listeners (Memory.getDOMCounters),
// detached elements (live HTMLElement objects minus elements in the document), canvases, and live ResizeObserver /
// IntersectionObserver / MutationObserver targets, pending animation frames, timeouts and intervals (counted by an init script).
// A leak is a monotonic rise after GC: the gate compares round N with round 5 (warm caches, the library, lazy modules all loaded).
//   node tests/site/graph_soak.mjs [--rounds 50] [--json out.json] [--detail] [--snap <prefix>]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = +arg('--rounds', 50), JSON_OUT = arg('--json', null), SNAP = arg('--snap', null); // --snap <prefix>: heap snapshots after GC at round 5 and the last round
// Thresholds, from the measurements on #52 (2026-11-14, Chromium 1243 headless, 50 rounds, round 5 -> round 50 after GC):
//   before the fixes: DOM nodes 4855 -> 26144 (+473 per round), listeners 410 -> 590 (+4 per round), detached 2286 -> 22854 nodes
//     (one retained atom-browser tree of ~457 nodes per round), heap 11.96 -> 12.55 MB;
//   after: DOM nodes 2485 -> 2491 (+6), listeners 391 -> 391, detached 1 -> 8 (single #text nodes, likely held by buffered performance entries),
//     heap 11.78 -> 12.99 MB (+1.2; noisy 12.3-13.0 MB from round 10: JIT code and the browser performance-entry buffers per the heap
//     snapshot diff, no site objects growing).
// The bounds sit a few times above the after-fix noise and far below one leaked sheet per round (45 rounds x ~450 nodes).
const LIMIT = { heap_mb: 3, nodes: 150, listeners: 20, detached: 100, raf: 2, timeouts: 12, intervals: 1, observed: 4 };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// live-resource counters, installed before any site script
const PROBE = () => {
  const C = (window.__soak = { raf: new Set(), to: new Set(), iv: new Set(), obs: new Map(), canvases: [] });
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (f) => { const id = raf((t) => { C.raf.delete(id); f(t); }); C.raf.add(id); return id; };
  window.cancelAnimationFrame = (id) => { C.raf.delete(id); caf(id); };
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window), si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.setTimeout = (f, ms, ...a) => { const id = st((...x) => { C.to.delete(id); if (typeof f === 'function') f(...x); }, ms, ...a); C.to.add(id); return id; };
  window.clearTimeout = (id) => { C.to.delete(id); ct(id); };
  window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); C.iv.add(id); return id; };
  window.clearInterval = (id) => { C.iv.delete(id); ci(id); };
  for (const K of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    const O = window[K]; if (!O) continue; C.obs.set(K, 0); const live = new WeakMap();
    window[K] = class extends O {
      constructor(cb, o) { super(cb, o); live.set(this, new Set()); }
      observe(t, o) { const s = live.get(this); if (!s.has(t)) { s.add(t); C.obs.set(K, C.obs.get(K) + 1); } return super.observe(t, o); }
      unobserve(t) { const s = live.get(this); if (s.delete(t)) C.obs.set(K, C.obs.get(K) - 1); return super.unobserve(t); }
      disconnect() { const s = live.get(this); C.obs.set(K, C.obs.get(K) - s.size); s.clear(); return super.disconnect(); }
    };
  }
  const ce = Document.prototype.createElement;
  Document.prototype.createElement = function (n, o) { const e = ce.call(this, n, o); if (String(n).toLowerCase() === 'canvas') C.canvases.push(new WeakRef(e)); return e; };
};
const BIG = (n) => { let s = ''; for (let i = 0; i < n; i++) s += `atom("p${i}", { type: "mini", body: "bd*${(i % 8) + 1}" })\n`; return s + 'a: s(atoms.p0).gain(0.8)\nb: s(atoms.p1).gain(0.6)\nc: s(atoms.p2).gain(0.4)\n'; };
const EX1 = 'drums: s("bd*4, hh*8").lpf(4000)\n  .split(dry => dry,\n         wet => wet.room(0.9).rsize(6).lpf(900),\n         grit => grit.crush(5).hpf(2000).gain(0.4))\n';
const CAP = 'drums: s("bd*4, ~ sd ~ sd, hh*8").tags("drums")\ncapture("groove", "drums", { window: "1b..3b", what: ["events", "audio", "level"] })\nchop: n("0 3 2 1 4 7 6 5").from("groove").slice(8).gain(0.8)\nbass: note("c2*8").s("sawtooth").gain(recall("groove:level").range(1, 0.3))\n';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(PROBE);
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.stack || e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? '{"title":"t","body":""}' : '[]' }));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
// every wait disposes its handle: a kept ElementHandle / JSHandle retains its element tree in the page and reads as a site leak
const waitSel = async (sel, o) => (await page.waitForSelector(sel, o)).dispose();
const waitFn = async (fn, a, o) => (await page.waitForFunction(fn, a, o)).dispose();
await page.goto(BASE); await waitSel('#list li[data-id]');
await page.evaluate((t) => { window.__BIG = t; }, BIG(5000)); // built once in the page; the soak's own copy, not the site's

const openGraph = async () => { await page.click('.views a[data-view="graph"]'); await waitFn(() => window.__graph && window.strudelCraft.atomsUI && window.strudelCraft.lanesUI && document.querySelector('#main').dataset.view === 'graph' && document.querySelector('.gx .gn'), null, { timeout: 30000 }); };
const closeGraph = async () => { await page.click('.views a[data-view="rack"]'); await waitFn(() => document.querySelector('#main').dataset.view === 'rack'); };
const loadDoc = (t) => page.evaluate((t) => window.__graph.load(t === '@BIG' ? window.__BIG : t === '@DEMO' ? window.__graph.DEMO : t), t);
const settle = (ms = 120) => page.waitForTimeout(ms);

async function round() {
  await openGraph();
  // documents
  await loadDoc('@DEMO'); await settle();
  // pan / zoom: wheel pan, Ctrl+wheel zoom, drag pan on empty canvas, keyboard zoom, fit
  const vp = await page.locator('.gx-vp').boundingBox();
  await page.mouse.move(vp.x + vp.width - 30, vp.y + vp.height - 30);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(40, 60);
  await page.keyboard.down('Control'); for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120); for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120); await page.keyboard.up('Control');
  await page.evaluate(() => window.__graph.zoomTo(0.5, 600, 400));
  await page.mouse.move(vp.x + vp.width - 20, vp.y + 20); await page.mouse.down(); await page.mouse.move(vp.x + vp.width - 220, vp.y + 120, { steps: 6 }); await page.mouse.up();
  await page.evaluate(() => window.__graph.fit()); await settle(200);
  // collapse two tracks, enter, leave, undo
  await page.evaluate(() => { window.__graph.center('track:hat', 1); }); await settle();
  await page.click('#gxMulti');
  await page.click('.gn[data-id="track:hat"] .gn-head'); await page.evaluate(() => window.__graph.center('track:perc', 1)); await settle(); await page.click('.gn[data-id="track:perc"] .gn-head');
  await page.click('.gx-selbar [data-act=collapse]'); await waitSel('dialog.scm input'); await page.fill('dialog.scm input', 'soak'); await page.click('dialog.scm .scm-ok');
  await waitFn(() => window.__graph.view.nodes.some((n) => n.kind === 'component'));
  await page.evaluate(() => { document.querySelector('.gx-crumbs'); window.__graph.undo(); }); await settle();
  // the 5000-atom document and its atom browser, three pages
  await loadDoc('@BIG'); await waitFn(() => window.__graph.view.nodes.filter((n) => n.kind === 'atom').length === 3, null, { timeout: 30000 });
  await page.evaluate(() => window.strudelCraft.atomsUI.browse(null)); await waitSel('#axList li');
  for (let i = 0; i < 2; i++) await page.evaluate(() => document.querySelector('[data-act=ax-more]').click());
  await page.fill('.ax-q', 'p12'); await settle(80); await page.evaluate(() => document.querySelector('.gx-sheet [data-act=close]').click());
  // lanes: split fan card, capture node inspector
  await loadDoc(EX1); await settle();
  await page.evaluate(() => { const n = window.__graph.view.nodes.find((x) => x.kind === 'track'); if (n) window.__graph.center(n.id, 1); }); await settle();
  await page.evaluate(() => { const b = document.querySelector('.gn.gk-track .gn-head'); if (b) b.click(); });
  await loadDoc(CAP); await settle();
  await page.evaluate(() => { window.__graph.center('capture:groove', 1); const b = document.querySelector('.gn[data-id="capture:groove"] .gn-head'); if (b) b.click(); }); await settle();
  await page.keyboard.press('Escape'); await page.evaluate(() => window.__graph.fixture(150, 300)); await page.evaluate(() => window.__graph.zoomTo(0.7, 0, 0)); await settle(); await page.evaluate(() => window.__graph.clearFixture());
  await closeGraph(); await settle(250);
}

async function measure(i) {
  for (let k = 0; k < 2; k++) await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(100);
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const d = await cdp.send('Memory.getDOMCounters');
  // detached DOM still retained by JS: DOM.getDetachedDomNodes trees, counted node by node
  const det = await cdp.send('DOM.getDetachedDomNodes').catch(() => ({ detachedNodes: [] }));
  const size = (n) => 1 + (n.children || []).reduce((s, c) => s + size(c), 0);
  const detached = det.detachedNodes.reduce((s, d) => s + size(d.treeNode), 0), detachedTrees = det.detachedNodes.length;
  const kinds = {}; // detached roots by tag.class, to name what is retained
  for (const d of det.detachedNodes) { const t = d.treeNode, a = t.attributes || [], ci = a.findIndex((x, j) => j % 2 === 0 && x === 'class'); const k = `${t.localName || t.nodeName}${ci >= 0 ? '.' + a[ci + 1].split(' ')[0] : ''}`; kinds[k] = (kinds[k] || 0) + 1; }
  const pg = await page.evaluate(() => { const C = window.__soak;
    return { raf: C.raf.size, timeouts: C.to.size, intervals: C.iv.size, observed: [...C.obs.values()].reduce((s, x) => s + x, 0), obs: Object.fromEntries(C.obs), canvases_live: C.canvases.filter((w) => w.deref()).length, canvases_doc: document.querySelectorAll('canvas').length, ls_kb: Math.round(JSON.stringify(localStorage).length / 1024) }; });
  return { round: i, heap_mb: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: d.nodes, listeners: d.jsEventListeners, documents: d.documents, detached, detached_trees: detachedTrees, ...pg, detached_kinds: kinds };
}

const rows = [];
rows.push(await measure(0));
for (let i = 1; i <= ROUNDS; i++) {
  await round();
  const r = await measure(i); rows.push(r);
  if (SNAP && (i === Math.min(5, ROUNDS) || i === ROUNDS)) {
    const chunks = []; const on = (e) => chunks.push(e.chunk); cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
    fs.writeFileSync(`${SNAP}-r${i}.heapsnapshot`, chunks.join(''));
  }
  if (i === 1 || i % 5 === 0) console.log(`round ${String(i).padStart(3)}  heap ${r.heap_mb} MB  nodes ${r.nodes}  listeners ${r.listeners}  detached ${r.detached} (${r.detached_trees} trees)  raf ${r.raf}  timeouts ${r.timeouts}  intervals ${r.intervals}  observed ${JSON.stringify(r.obs)}  canvases ${r.canvases_live}/${r.canvases_doc}  ls ${r.ls_kb} kB${process.argv.includes('--detail') ? '  detached roots ' + JSON.stringify(r.detached_kinds) : ''}`);
}
await browser.close(); server.close();
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
const ref = rows[Math.min(5, ROUNDS)], last = rows[rows.length - 1];
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  -- ${detail}`); };
for (const k of ['heap_mb', 'nodes', 'listeners', 'detached', 'raf', 'timeouts', 'intervals', 'observed']) {
  const dlt = +(last[k] - ref[k]).toFixed(2);
  check(`graph soak: ${k} after ${ROUNDS} rounds within +${LIMIT[k]} of round ${ref.round} (after GC)`, dlt <= LIMIT[k], `round ${ref.round} ${ref[k]} -> round ${last.round} ${last[k]} (${dlt >= 0 ? '+' : ''}${dlt})`);
}
// monotonic rise: the last 10 rounds' heap minimum must not sit above round 5's heap by more than the bound either
const tailMin = Math.min(...rows.slice(-10).map((r) => r.heap_mb));
check('graph soak: no monotonic heap rise (min of the last 10 rounds vs round 5)', tailMin - ref.heap_mb <= LIMIT.heap_mb, `min ${tailMin} MB vs ${ref.heap_mb} MB`);
check('graph soak: zero page errors / console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
process.exit(fails ? 1 : 0);
