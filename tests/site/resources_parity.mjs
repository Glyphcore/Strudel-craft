// Search parity: the Available tab and `strudel refs --available --q Q` hold the same ids for the same query (index-field scope by default; `--deep` / "Search descriptions too"
// adds recipe body text in both). 390px headless pane vs the CLI, 12 queries default + 3 deep. Usage: node tests/site/resources_parity.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOTD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const ROOT = path.join(ROOTD, 'site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const R = await import(pathToFileURL(path.join(ROOT, 'engine/resources.js')).href);
const CLI = path.join(process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli', 'strudel'); const PROG = path.join(ROOTD, 'docs/tracks/night-phonk-demo/track.v2.strudel.js');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const cli = (q, deep) => R.availableIds(JSON.parse(execFileSync(CLI, ['refs', PROG, '--available', '--q', q, '--json', ...(deep ? ['--deep'] : [])], { env: { ...process.env, STRUDEL_CRAFT: ROOTD }, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })).available);
const b = await chromium.launch(); const errs = [];
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await p.goto(`http://localhost:${srv.address().port}/index.html#rack`); await p.waitForSelector('.rs-open', { timeout: 60000 });
  await p.evaluate(async (c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); }, fs.readFileSync(PROG, 'utf8'));
  await p.tap('.rs-open'); await p.waitForSelector('dialog.rs-sheet[open] .rs-card', { timeout: 30000 }); await p.tap('dialog.rs-sheet [data-tab="available"]'); await p.waitForSelector('dialog.rs-sheet .rs-q', { timeout: 30000 });
  await p.waitForFunction(() => window.strudelCraft.resources.panel.st.avail, null, { timeout: 30000 });
  const pane = async (q) => { await p.fill('dialog.rs-sheet .rs-q', q); await p.waitForTimeout(250); return p.evaluate(async () => { const m = await import('./engine/resources.js'); return m.availableIds(window.strudelCraft.resources.panel.st.avail); }); };
  const same = (a, c) => a.length === c.length && a.every((x, i) => x === c[i]);
  for (const q of ['amen', 'kick', 'bass', 'riser', '808', 'feel', 'pad', 'wobble', 'hat', 'drop', 'sub', 'ljspeech', 'phonk']) { const a = await pane(q), c = cli(q, false); check(`default scope "${q}": pane = CLI`, same(a, c), `pane ${a.length}, cli ${c.length}${same(a, c) ? '' : ', only pane ' + a.filter((x) => !c.includes(x)).slice(0, 3) + ' only cli ' + c.filter((x) => !a.includes(x)).slice(0, 3)}`); }
  await p.fill('dialog.rs-sheet .rs-q', 'amen'); const before = await pane('amen');
  await p.tap('dialog.rs-sheet .rs-deep-i'); await p.waitForFunction(() => window.strudelCraft.resources.panel.st.deep && !window.strudelCraft.resources.panel.st.deepN, null, { timeout: 120000 }); await p.waitForTimeout(300);
  for (const q of ['amen', 'kick', 'growl']) { await p.fill('dialog.rs-sheet .rs-q', q); await p.waitForTimeout(300); const a = await p.evaluate(async () => (await import('./engine/resources.js')).availableIds(window.strudelCraft.resources.panel.st.avail)); const c = cli(q, true); check(`deep "${q}": pane (Search descriptions too) = CLI --deep`, same(a, c), `pane ${a.length}, cli ${c.length}`); if (q === 'amen') check('deep only adds ids to the default result and finds the body-only match', before.every((x) => a.includes(x)) && a.length > before.length && a.some((x) => /dubstep-sub-growl$/.test(x)), `${before.length} -> ${a.length}`); }
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally { await b.close(); srv.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
