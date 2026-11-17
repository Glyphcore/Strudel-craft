// Bytes fetched on the way to first paint (#166): node tests/site/first_paint_bytes.mjs [SITE_DIR] [--idle MS]
// Serves SITE_DIR, loads index.html (service worker blocked), and tabulates every response by category: "shell" = what had arrived when the Recipes list
// showed every row, "idle" = what the deferred set (LATER), pack manifests and data fetched afterwards (--idle ms, default 6000). Raw body bytes, no compression.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url); let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const args = process.argv.slice(2); const SITE = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i && args[i - 1] === '--idle')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../site'));
const IDLE = +(args.includes('--idle') ? args[args.indexOf('--idle') + 1] : 6000);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(SITE, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(fs.readFileSync(f)); }).listen(0);
await new Promise((ok) => server.on('listening', ok)); const O = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(); const ctx = await browser.newContext({ serviceWorkers: 'block' }); const page = await ctx.newPage(); const log = [];
page.on('requestfinished', async (r) => { if (!r.url().startsWith(O)) return; try { log.push([Date.now(), r.url().slice(O.length), (await r.sizes()).responseBodySize]); } catch { /* aborted */ } });
await page.goto(O + 'index.html'); await page.waitForFunction(() => { const c = document.querySelector('#count'); const m = c && /^(\d+) \/ (\d+) recipes$/.exec(c.textContent); return m && +m[2] > 0 && document.querySelectorAll('#list li[data-id]').length === +m[2]; }, null, { timeout: 60000 });
const mark = Date.now(); await page.waitForTimeout(IDLE); await browser.close(); server.close();
const cat = (u) => (/^data\/(catalog|recipes)/.test(u) ? 'recipes index/bodies' : /^data\/(syntax|composition|plugins|practices)/.test(u) ? 'syntax data' : /^data\/intellisense|intellisense\.js/.test(u) ? 'intellisense' : /craftpack\.json|packs\.lock|presets\.json|^data\/[a-z-]+\/(atoms|feel)/.test(u) ? 'pack manifests/data' : /\.css$|\.woff2$/.test(u) ? 'css/fonts' : /^(index\.html|app|ui|forms|packs|palette|pwa)/.test(u) ? 'shell code' : 'other js/data');
const rows = {}; let a = 0, b = 0;
for (const [t, u, n] of log) { const k = (t <= mark ? 'shell ' : 'idle  ') + cat(u); rows[k] = (rows[k] || 0) + n; if (t <= mark) a += n; else b += n; }
for (const [k, v] of Object.entries(rows).sort()) console.log(String(v).padStart(9), k);
console.log(`${String(a).padStart(9)} TOTAL at list-ready\n${String(b).padStart(9)} TOTAL idle (${IDLE} ms after)`);
