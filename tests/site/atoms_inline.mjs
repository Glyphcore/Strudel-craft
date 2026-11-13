// Atoms A2 (#62): the site's "Open in strudel.cc" link for an atoms program decodes to plain Strudel (no `atoms.`, no `atom(`) that evaluates in
// unmodified Strudel (loaded from unpkg; skipped with the reason when offline). Usage: node tests/site/atoms_inline.mjs
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(BASE); await page.waitForFunction(() => window.strudelCraft?.atoms?.ready === true, null, { timeout: 30000 });
const PROG = `atom("kick4", { type: "mini", body: "bd*4" })\natom("key", { type: "scale", body: "C:minor" })\n$: s(atoms.kick4).bank("RolandTR909")\n$: n("0 2 4").scale(atoms.key)\n`;
await page.evaluate((t) => { const ta = document.getElementById('stackCode'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, PROG);
const href = await page.$eval('#stackOpen', (a) => a.href);
const dec = Buffer.from(decodeURIComponent(href.split('#')[1]), 'base64').toString('utf8');
check('strudel.cc link decodes to plain Strudel: no `atoms.`, no `atom(`', !/atoms\./.test(dec) && !/\batom\(/.test(dec), JSON.stringify(dec));
check('decoded code is the expected inlined program', dec === `$: s("bd*4").bank("RolandTR909")\n$: n("0 2 4").scale("C:minor")\n`);
const copied = await page.evaluate((t) => window.strudelCraft.atoms.inline(t), PROG); check('Copy path (atoms.inline) gives the same text', copied === dec);
try {
  await page.addScriptTag({ url: 'https://unpkg.com/@strudel/web@1.3.0/dist/index.js' });
  const res = await page.evaluate(async (code) => { const r = await window.initStrudel(); try { await r.evaluate(code, false); return r.state?.evalError ? String(r.state.evalError) : 'ok'; } catch (e) { return String(e); } }, dec);
  check('decoded code evaluates in plain Strudel (unmodified @strudel/web 1.3.0)', res === 'ok', res);
} catch (e) { console.log('SKIP evaluates in plain Strudel: could not load @strudel/web from unpkg (' + String(e.message).split('\n')[0] + ')'); }
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(bad ? 1 : 0);
