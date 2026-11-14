// Record hooks for lanes capture (#76): `node tests/site/record_hooks.mjs` (serves site/, playwright + network for unpkg).
// capture.addTake stores an audio take with meta.from (listed, WAV header valid, recipe validates); capture.beforeRender runs once before an
// offline render with the program compiled, a nested renderRecipe inside it does not recurse, and unregistering stops it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const ROOT = path.join(REPO, 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
const page = await (await browser.newContext({ viewport: { width: 360, height: 740 }, acceptDownloads: true })).newPage();
page.on('pageerror', (e) => errs.push(String(e)));
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(`http://localhost:${server.address().port}/index.html`); await page.waitForSelector('#list li[data-id]');
await page.waitForFunction(() => window.strudelCraft.capture && window.strudelCraft.capture.addTake);

// hook 2: addTake
const t = await page.evaluate(async () => {
  const c = window.strudelCraft.capture, n = 44100, L = new Float32Array(n).map((_, i) => 0.5 * Math.sin(i / 20));
  const rec = await c.addTake({ name: 'groove', L, sr: 44100, cps: 0.5, cycles: 1, from: 'groove' });
  const l = await c.list(); const e = l.find((x) => x.id === rec.id);
  let valid = true; try { window.strudelCraft.recipe.validate(JSON.parse(JSON.stringify(e))); } catch (er) { valid = er.message; }
  let bad = null; try { await c.addTake({ L: 1 }); } catch (er) { bad = er.message; }
  return { from: e.meta && e.meta.from, audio: e.audio, includes: e.includes, valid, bad, id: rec.id, shown: !!document.querySelector('#capTakes') };
});
ok('addTake: take listed with meta.from, audio output, valid recipe', t.from === 'groove' && t.audio.includes('capture') && t.includes.audio && !t.includes.code && t.valid === true, JSON.stringify(t));
ok('addTake: bad input refused', /addTake needs/.test(t.bad || ''), String(t.bad));
await page.click('#capBtn'); await page.waitForSelector('#capSheet:not([hidden])');
const sub = await page.locator('#capTakes li[data-id] .cap-tk-sub').first().textContent();
ok('addTake: takes list shows the source', /from groove/.test(sub), sub);
const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate((id) => window.strudelCraft.capture.download(id, 'wav16'), t.id)]);
const wavP = path.join(fs.mkdtempSync('/tmp/rh-'), 'x.wav'); await dl.saveAs(wavP); const b = fs.readFileSync(wavP);
ok('addTake: WAV 16 header valid, 44100 frames', b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' && b.readUInt32LE(24) === 44100 && /_1c_0\.5cps\.wav$/.test(dl.suggestedFilename()), dl.suggestedFilename());

// hook 1: beforeRender
const h = await page.evaluate(async () => {
  const sc = window.strudelCraft, c = sc.capture, calls = [];
  const off = c.beforeRender(async (recipe, ctx) => { calls.push({ code: ctx.code === recipe.state.source.code }); const r = await c.renderRecipe({ ...recipe, id: 'nested' }); calls.push({ nestedFrames: r.L.length }); });
  const first = await c.renderExact(1); const n1 = calls.length;
  off(); await c.renderExact(1); const n2 = calls.length;
  let thrown = null; const off2 = c.beforeRender(async () => { throw new Error('boom'); }); try { await c.renderRecipe(first.recipe); } catch (e) { thrown = e.message; } off2();
  const after = await c.renderRecipe(first.recipe);
  return { calls, n1, n2, thrown, afterFrames: after.L.length, rendering: c.state.rendering };
});
ok('beforeRender: hook ran once before the render (program passed), nested render did not recurse', h.n1 === 2 && h.calls[0].code && h.calls[1].nestedFrames > 0, JSON.stringify(h.calls));
ok('beforeRender: unregister stops it; a throwing hook aborts and a later render still works', h.n2 === 2 && h.thrown === 'boom' && h.afterFrames > 0 && !h.rendering, JSON.stringify({ n2: h.n2, thrown: h.thrown, f: h.afterFrames }));
ok('no page errors', errs.length === 0, JSON.stringify(errs).slice(0, 200));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
