// Graph zoom-out check: `node tests/site/graph_zoom.mjs` - at min zoom and after Fit, every node is rendered, visible and inside the viewport (360 and 1440 px).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.mjs': 'text/javascript' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const URL_ = `http://localhost:${server.address().port}/index.html#graph`;
const b = await chromium.launch(); let fail = 0; const errs = [];
const probe = (p) => p.evaluate(() => { const vp = document.querySelector('.gx-vp').getBoundingClientRect(); const ns = [...document.querySelectorAll('.gx .gn')];
  const vis = ns.filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width >= 2 && r.height >= 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.2 && r.right > vp.left && r.left < vp.right && r.bottom > vp.top && r.top < vp.bottom; }).length;
  const inside = ns.filter((e) => { const r = e.getBoundingClientRect(); return r.left >= vp.left - 1 && r.right <= vp.right + 1 && r.top >= vp.top - 1 && r.bottom <= vp.bottom + 1; }).length;
  return { total: __graph.view.nodes.length, dom: ns.length, vis, inside, s: +__graph.V.s.toFixed(3), level: __graph.level, vp: [vp.width, vp.height] }; });
for (const [w, h] of [[360, 740], [1440, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && console.log("console:", m.text())); await p.goto(URL_); await p.waitForTimeout(3000); await p.evaluate(() => { const a = document.querySelector(`a[data-view="graph"]`); a ? a.click() : location.hash = "graph"; }); await p.waitForFunction(() => window.__graph && __graph.view, null, { timeout: 30000 });
  await p.evaluate(() => { const t = [...document.querySelectorAll('.gx-tab')].find((x) => x.dataset.pane === 'graph'); t && t.click(); __graph.fixture(150, 300); });
  for (const step of ['fit', 'min']) {
    await p.evaluate((st) => { if (st === 'fit') document.getElementById('gxFit').click(); else { const r = document.querySelector('.gx-vp').getBoundingClientRect(); for (let i = 0; i < 40; i++) document.querySelector('.gx-vp').dispatchEvent(new WheelEvent('wheel', { deltaY: 200, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); } }, step);
    await p.waitForTimeout(400); const r = await probe(p);
    const ok = r.dom === r.total && r.vis === r.total && r.inside === r.total; if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${w}px ${step}`, JSON.stringify(r));
  }
  await p.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/graph_min_${w}.png` }); await p.close();
}
if (errs.length) { fail++; console.log('page errors', errs); }
await b.close(); server.close(); process.exit(fail ? 1 : 0);
