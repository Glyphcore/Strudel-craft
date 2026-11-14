/* #92 repro: AudioNode "the given destination is not connected" page errors (docs/KNOWN_ISSUES.md). Serves a site build under /Strudel-craft/
   (default: this repo's site/; --site DIR for another build, e.g. a `git archive bffd843 site` of the commit before the fix), Playwright Chromium at
   360x780 (touch, real taps), and plays two programs, counting uncaught page errors:
     1. tests/site/fixtures/word_lanes_send.strudel.js from bar 1 for 40 s (two sparse word() lanes tagged into one send, nothing else heavy: no errors
        even before the fix, the race needs voice load) and word_lanes_send_load.strudel.js (the same two lanes inside the v1 track: errors before the fix);
     2. docs/tracks/night-phonk-demo/track.standalone.strudel.js from bar 49 (drop 2) for 30 s (the load case; bisection: removing any one of several
        lane groups cleared it, so the whole track is the smallest program found).
   Usage: node tests/site/disconnect_repro.mjs [--site DIR] [--expect-errors]   PASS = 0 page errors (with --expect-errors: PASS = errors seen; case 1 alone never errors). */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), PREFIX = '/Strudel-craft/';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SITE = path.resolve(arg('--site') || path.join(ROOT, 'site')), EXPECT = process.argv.includes('--expect-errors');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const CASES = [['two sparse word() lanes into one send, alone', 'tests/site/fixtures/word_lanes_send.strudel.js', 0, 40], ['two sparse word() lanes into one send, in the v1 track', 'tests/site/fixtures/word_lanes_send_load.strudel.js', 0, 40], ['night phonk v1 drop 2 load', 'docs/tracks/night-phonk-demo/track.standalone.strudel.js', 48, 30]];
const browser = await chromium.launch(); let fails = 0;
for (const [name, file, start, secs] of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.__sc.audio && window.strudelCraft && window.strudelCraft.range, null, { timeout: 60000 });
  await page.evaluate((code) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); ta.value = code; ta.dispatchEvent(new Event('input')); }, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  await page.waitForTimeout(800); await page.evaluate((s) => Object.assign(window.strudelCraft.range.state, { start: s }), start);
  await page.tap('#playBtn'); await page.waitForTimeout(secs * 1000);
  const n = errs.filter((m) => /disconnect/.test(m)).length, ok = EXPECT && !/alone/.test(name) ? n > 0 : errs.length === 0; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${errs.length} page errors (${n} disconnect)${errs[0] ? ' -- ' + errs[0].slice(0, 100) : ''}`);
  await ctx.close();
}
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
