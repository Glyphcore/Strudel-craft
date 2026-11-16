// First-open timing of the Recipes view (#131), CPU x4: node tests/site/recipes_first_open.mjs [SITE_DIR] [--runs N] [--cpu 4]
// Per run (fresh context, cold cache): list = ms from navigation to the Recipes list showing every row; first = ms until the first recipe's program is in the editor;
// family = ms from a click on a recipe of a later family (the last row) until its program is in the editor; bytes = data/ bytes fetched by the end of `first`.
// Works on any built site dir (the baseline measurement serves an older site folder). Prints JSON plus a median line.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url); let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const args = process.argv.slice(2); const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SITE = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--'))) || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../site'));
const RUNS = +opt('--runs', 3), CPU = +opt('--cpu', 4);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, s) => { const f = path.join(SITE, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(fs.readFileSync(f)); }).listen(0);
await new Promise((ok) => server.on('listening', ok)); const ORIGIN = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(); const rows = [];
for (let n = 0; n < RUNS; n++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }); const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  
  const t0 = Date.now(); await page.goto(ORIGIN + '/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => { const c = document.querySelector('#count'); const m = c && /^(\d+) \/ (\d+) recipes$/.exec(c.textContent); return m && +m[2] > 0 && document.querySelectorAll('#list li[data-id]').length === +m[2]; }, null, { timeout: 120000, polling: 25 });
  const list = Date.now() - t0;
  await page.waitForFunction(() => { const t = document.querySelector('#code'); return t && t.value && t.value.length > 5; }, null, { timeout: 120000, polling: 25 });
  const first = Date.now() - t0; const dataBytes = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/data\//.test(e.name)).reduce((s, e) => s + (e.decodedBodySize || 0), 0));
  const last = await page.evaluate(() => { const li = [...document.querySelectorAll('#list li[data-id]')].pop(); return li.dataset.id; });
  const before = await page.evaluate(() => document.querySelector('#code').value);
  const t1 = Date.now(); await page.evaluate((id) => document.querySelector(`#list li[data-id="${id}"] .row`).click(), last);
  await page.waitForFunction((b) => { const t = document.querySelector('#code'); return t && t.value && t.value !== b && t.value.length > 5; }, before, { timeout: 120000, polling: 25 });
  const family = Date.now() - t1; rows.push({ list, first, family, dataBytesAtFirst: dataBytes, last }); await ctx.close();
}
await browser.close(); server.close();
const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(JSON.stringify({ site: SITE, cpu: CPU, rows }, null, 1)); console.log(`MEDIAN cpu x${CPU} (${RUNS} runs): list ${med('list')} ms, first program ${med('first')} ms, later-family open ${med('family')} ms, data bytes ${med('dataBytesAtFirst')}`);
