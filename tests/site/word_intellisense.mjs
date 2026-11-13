// #44: typing word("ca in the editor offers `call` (provider `words`). Usage: node tests/site/word_intellisense.mjs [shot.png]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const b = await chromium.launch(); let ok = false;
try {
  const p = await b.newPage(); await p.goto(`http://localhost:${srv.address().port}/index.html`); await p.waitForSelector('#list li');
  const reg = await p.evaluate(async () => { await new Promise((r) => setTimeout(r, 500)); const a = window.strudelCraft.intellisense; return { prov: a.providers().includes('words'), call: (await a.all()).some((i) => i.label === 'call' && i.provider === 'words') }; });
  console.log(`${reg.prov && reg.call ? 'PASS' : 'FAIL'}  registry has words provider with call`, JSON.stringify(reg));
  let ui = false;
  try {
    const ed = p.locator('.cm-content:visible').first(); await ed.waitFor({ timeout: 15000 }); await ed.click(); await p.keyboard.press('Control+a'); await p.keyboard.press('Delete'); await p.keyboard.type('word("ca');
    await p.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 8000 }); ui = (await p.locator('.cm-tooltip-autocomplete li').allTextContents()).some((t) => /call/.test(t));
    if (process.argv[2]) await p.screenshot({ path: process.argv[2] });
  } catch (e) { console.log('  editor:', e.message.split('\n')[0]); }
  console.log(`${ui ? 'PASS' : 'FAIL'}  completion popup lists call after word("ca`); ok = reg.prov && reg.call && ui;
} finally { await b.close(); srv.close(); }
process.exit(ok ? 0 : 1);
