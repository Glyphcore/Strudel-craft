// Playwright test for the pack sheet UI (issue #67, site/packs-ui.js). Usage: node tests/site/packs_ui.mjs
// One minimal check per UI box: sheet reachable from the palette by keyboard and lazy, licence/credits shown verbatim ("not declared" when absent),
// E_PACK_* codes visible, add/accept/remove through the site modal (no native dialog), pack-id badge on non-core recipes only, empty states.
// Screenshots: docs/screens/phone-390-packs.png, phone-360-packs-empty.png, phone-360-empty-browser.png, desktop-1440-packs.png.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site'), FIX = path.join(ROOT, 'tests/packs/fixtures'), SHOTS = path.join(ROOT, 'docs/screens');

// a generated pack that declares authors, attribution and a code ingredient
const GEN = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-packs-ui-'));
const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const put = (rel, text) => { const p = path.join(GEN, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return Buffer.from(text); };
const ATTR = { name: 'Test kick by Example Person', url: 'https://example.org/kick', license: 'CC-BY-4.0', text: '"Test kick" by Example Person, CC BY 4.0', changes: 'trimmed to 200 ms' };
{
  const r = put('credfx/r.json', JSON.stringify({ categories: [], labels: [], recipes: [{ id: 'credfx-one', title: 'Credit fixture one', intent: 'x', code: 'window.__recipeRan = 1; s("bd")', expr: 's("bd")', labels: [], needs: [] }] }));
  const pj = put('credfx/p.json', JSON.stringify({ id: 'prov', module: 'prov.js', provides: [] })), pm = put('credfx/prov.js', 'window.__canary = 1;\n');
  put('credfx/craftpack.json', JSON.stringify({ craftpack: '1.0.0', id: 'testco/credfx', version: '2.1.0', title: 'Credit fixture', license: 'CC-BY-4.0', authors: [{ name: 'testco' }], attribution: [ATTR], ingredients: [
    { id: 'recipes', kind: 'recipes', format: 'recipes@1', version: '1.0.0', path: 'r.json', hash: sha(r), bytes: r.length, load: 'eager' },
    { id: 'prov', kind: 'intellisense-provider', format: 'intellisense-provider@1', version: '1.0.0', path: 'p.json', hash: sha(pj), bytes: pj.length, code: true, modules: [{ path: 'prov.js', realm: 'sandbox', hash: sha(pm), bytes: pm.length }] }] }, null, 1));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const log = [];
const fxFile = (rel) => [path.join(GEN, rel), path.join(FIX, rel)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); log.push(p);
  let f; if (p.startsWith('/fx/')) f = fxFile(p.slice(4)); else { const q = p.endsWith('/') ? p + 'index.html' : p; f = path.join(SITE, q); if (!f.startsWith(SITE) || !fs.existsSync(f)) f = null; }
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const entry = (dir) => { const b = fs.readFileSync(fxFile(`${dir}/craftpack.json`)); const m = JSON.parse(b); return { id: m.id, version: m.version, source: `https://fixtures.test/fx/${dir}/`, mirrors: [`./fx/${dir}/`], manifest: sha(b), priority: 0, allowCode: [] }; };
const userLock = (...e) => JSON.stringify({ lock: 1, craftpack: '1.0.0', packs: e });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const noise = /api\.github\.com|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to load resource/;
const EVAL_TRAP = () => { window.__evalCalls = []; let real; Object.defineProperty(window, 'evaluate', { configurable: true, get() { return real && ((...a) => { window.__evalCalls.push(String(a[0]).slice(0, 200)); return real(...a); }); }, set(v) { real = v; } }); };
async function open({ lock, empty = false, width = 1440, height = 900, mobile = false, errors = [], dialogs = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await ctx.route(/^https:\/\/fixtures\.test\//, (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(fxFile(new URL(r.request().url()).pathname.slice(4))) }));
  await ctx.addInitScript(EVAL_TRAP);
  if (lock) await ctx.addInitScript((l) => { if (!localStorage.getItem('sc.packs.lock')) localStorage.setItem('sc.packs.lock', l); }, lock);
  if (empty) await ctx.route('**/packs.lock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"lock":1,"craftpack":"1.0.0","packs":[]}' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (dl) => { dialogs.push(dl.type()); dl.dismiss(); });
  log.length = 0;
  await page.goto(BASE); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs); await page.evaluate(() => window.strudelCraft.packs.ready);
  await page.waitForFunction(() => document.querySelector('#list li')); await page.waitForTimeout(300);
  return { ctx, page };
}
const viaPalette = async (page) => { await page.keyboard.press('Control+k'); await page.keyboard.type('packs'); await page.keyboard.press('Enter'); await page.waitForSelector('#packSheet[open]'); await page.waitForTimeout(250); };
const sheetText = (page) => page.$eval('#pkBody', (e) => e.innerText);

// 1. default site (shim only): lazy, reachable from the palette by keyboard, shim licence verbatim, empty "Your packs", no badge
{
  const errors = [], dialogs = [];
  const { ctx, page } = await open({ errors, dialogs });
  const lazy = !log.some((p) => /packs-ui\.(js|css)$/.test(p));
  const rows = await page.$$eval('#list .row', (r) => r.length), badges = await page.$$eval('#list .row .pk', (r) => r.length);
  check('default: 46 recipe rows, no pack badge, sheet files not fetched at boot', rows === 46 && badges === 0 && lazy, `rows ${rows}, badges ${badges}, lazy ${lazy}`);
  await viaPalette(page);
  const t = await sheetText(page), lic = await page.$eval('[data-pack="glyphcore/shim"] .pk-lic', (e) => e.textContent);
  const nd = await page.$$eval('[data-pack="glyphcore/shim"] .pk-nd', (n) => n.map((x) => x.textContent));
  check('palette (Ctrl+K "packs" Enter) opens the sheet; shim licence shown as recorded; absent fields "not declared"', lic === 'LicenseRef-undecided' && nd.length >= 2 && nd.every((x) => x === 'not declared') && /verified: matches the lock pin/.test(t), `licence ${lic}, not declared x${nd.length}`);
  check('empty state inside the sheet: "No packs added" under Your packs', /YOUR PACKS[\s\S]*No packs added/i.test(t));
  await page.click('#pkTab-credits'); const ct = await sheetText(page);
  await page.click('#pkTab-report'); const rt = await sheetText(page);
  check('Credits and Report tabs render (credits list the shim; report lists errors/warnings)', /glyphcore\/shim/.test(ct) && /LicenseRef-undecided/.test(ct) && /Errors \(\d+\)/i.test(rt), '');
  await page.click('#pkTab-packs'); await page.mouse.move(0, 0); await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: path.join(SHOTS, 'desktop-1440-packs.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  const closed = await page.$eval('#packSheet', (d) => !d.open);
  check('Esc closes the sheet; no console errors, no native dialogs', closed && !errors.length && !dialogs.length, errors.join(' | '));
  await ctx.close();
}

// 2. non-core packs: badge next to the item, verbatim credits, contains-code mark, E_PACK_HASH visible, no evaluate on load
{
  const errors = [], dialogs = [];
  const { ctx, page } = await open({ lock: userLock(entry('credfx'), entry('bad-hash')), width: 390, height: 844, mobile: true, errors, dialogs });
  const badge = await page.$$eval('#list li', (lis) => lis.filter((li) => li.querySelector('.pk')).map((li) => [li.dataset.id, li.querySelector('.pk').textContent]));
  const evals = await page.evaluate(() => window.__evalCalls.filter((c) => c.includes('__recipeRan')).length);
  check('non-core recipe shows its pack id next to the item, core recipes do not; not evaluated on load', badge.length === 1 && badge[0][0] === 'credfx-one' && badge[0][1] === 'testco/credfx' && evals === 0, JSON.stringify(badge) + ` evals ${evals}`);
  await page.click('#palFab'); await page.keyboard.type('packs'); await page.keyboard.press('Enter'); await page.waitForSelector('#packSheet[open]'); await page.waitForTimeout(250);
  const card = await page.$eval('[data-pack="testco/credfx"]', (e) => e.innerText);
  check('credfx card: licence, authors, attribution text/url/licence/changes exactly as recorded; contains-code mark', card.includes('CC-BY-4.0') && card.includes('testco') && card.includes(ATTR.text) && card.includes(ATTR.url) && card.includes(ATTR.changes) && /contains code/i.test(card), '');
  await page.click('[data-pack="testco/credfx"] .pk-ings summary');
  const ing = await page.$eval('[data-pack="testco/credfx"] [data-ing="prov"]', (e) => e.innerText);
  check('code ingredient: blocked with E_PACK_CODE_GRANT and a Grant button', /blocked/i.test(ing) && ing.includes('E_PACK_CODE_GRANT') && /Grant code/i.test(ing), ing.replace(/\s+/g, ' '));
  await page.evaluate(() => window.strudelCraft.packs.loadAll()); await page.waitForTimeout(200);
  const bad = await page.$eval('[data-pack="testco/bad-hash"]', (e) => e.innerText);
  check('failing pack shows its error code (E_PACK_HASH)', bad.includes('E_PACK_HASH'), bad.replace(/\s+/g, ' ').slice(0, 200));
  const tooSmall = await page.$$eval('#packSheet button, #packSheet summary', (b) => b.filter((x) => x.offsetParent && (x.getBoundingClientRect().height < 44 || x.getBoundingClientRect().width < 44)).map((x) => x.textContent.trim()));
  check('390 px: every sheet control is at least 44 x 44 px', !tooSmall.length, tooSmall.join(', '));
  await page.$eval('[data-pack="testco/credfx"]', (c) => { const b = document.getElementById('pkBody'); b.scrollTop = c.offsetTop - b.offsetTop - 8; }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'phone-390-packs.png') });
  // add by source -> proposal card -> accept (site modal), then remove (site modal)
  await page.click('.pk-add'); await page.waitForSelector('dialog.scm[open] input');
  await page.fill('dialog.scm input', 'https://fixtures.test/fx/collide-b/'); await page.click('dialog.scm .scm-ok');
  await page.waitForSelector('[data-proposal="https://fixtures.test/fx/collide-b/"][data-state="proposed"]');
  const prop = await page.$eval('[data-proposal="https://fixtures.test/fx/collide-b/"]', (e) => e.innerText);
  await page.click('[data-proposal="https://fixtures.test/fx/collide-b/"] .pk-go'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm .scm-ok');
  await page.waitForSelector('[data-pack="testco/collide-b"]'); await page.waitForTimeout(300);
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem('sc.packs.lock')).packs.map((e) => e.id));
  const b2 = await page.$$eval('#list .row .pk', (r) => r.map((x) => x.textContent));
  check('add by source: proposal shows licence and manifest, accept via site modal pins it in the user lock, list refreshes with its badge', /CC0-1\.0/.test(prop) && /sha256:/.test(prop) && added.includes('testco/collide-b') && b2.includes('testco/collide-b'), `lock ${added.join(',')} badges ${b2.join(',')}`);
  await page.click('[data-pack="testco/collide-b"] .pk-danger'); await page.waitForSelector('dialog.scm[open]'); await page.click('dialog.scm .scm-ok');
  await page.waitForFunction(() => !document.querySelector('[data-pack="testco/collide-b"]'));
  const gone = await page.evaluate(() => !window.strudelCraft.packs.list().some((p) => p.id === 'testco/collide-b'));
  check('remove via site modal; no console errors, no native dialogs', gone && !errors.length && !dialogs.length, errors.join(' | ') + ` dialogs ${dialogs.length}`);
  await ctx.close();
}

// 3. empty lock: browser empty state with a button to the sheet, sheet empty state, no console errors
{
  const errors = [], dialogs = [];
  const { ctx, page } = await open({ empty: true, width: 360, height: 780, mobile: true, errors, dialogs });
  const li = await page.$eval('#list li', (e) => e.innerText);
  check('empty lock: browser shows the "No recipes" empty state with Open packs', /No recipes/i.test(li) && /Open packs/i.test(li), li.replace(/\s+/g, ' '));
  await page.$eval('#list', (l) => l.scrollIntoView({ block: 'center' })); await page.screenshot({ path: path.join(SHOTS, 'phone-360-empty-browser.png') });
  await page.click('#emptyPacks'); await page.waitForSelector('#packSheet[open]'); await page.waitForTimeout(250);
  const t = await sheetText(page);
  check('empty lock: sheet shows "No packs loaded"; no console errors', /No packs loaded/i.test(t) && !errors.length && !dialogs.length, errors.join(' | '));
  await page.screenshot({ path: path.join(SHOTS, 'phone-360-packs-empty.png') });
  await ctx.close();
}

await browser.close(); server.close(); fs.rmSync(GEN, { recursive: true, force: true });
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
