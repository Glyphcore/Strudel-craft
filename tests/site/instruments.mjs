/* Referenced sample-source packs glyphcore/vcsl and glyphcore/salamander-piano (#183 stage A). 360x780 touch profile, real network for the referenced maps.
   1. first load and a drums-free Play of a synth: nothing is requested from strudel.b-cdn.net or the sample hosts
   2. play vcsl-marimba: vcsl.json then marimba wav files arrive (200); piano.json does not; the sound is registered
   3. play salamander-piano-chords: piano.json then piano mp3 arrive (200)
   Usage (repo root): node tests/site/instruments.mjs -> PASS/FAIL lines, exit 1 on any FAIL */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length) || 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const body = p === 'sw.js' ? fs.readFileSync(f, 'utf8').replace("const VERSION = 'sc-dev';", "const VERSION = 'sc-fp-1';") : fs.readFileSync(f);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(body);
});
await new Promise((ok) => server.listen(0, ok)); const BASE = `http://localhost:${server.address().port}${PREFIX}`;
let fail = 0; const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); if (!ok) fail++; };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
const page = await ctx.newPage(); const errors = [], reqs = [], resp = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('request', (r) => reqs.push(r.url())); page.on('response', (r) => resp.push([r.url(), r.status()]));
const ready = () => page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 }).then(() => page.evaluate(async () => { await window.strudelCraft.packs.ready; }));
const play = (id) => page.evaluate(async (id) => { const r = window.strudelCraft.packs.resolve('recipes', id); await window.__sc.Engine.play(r.value.code, false, () => {}); await new Promise((ok) => setTimeout(ok, 6000)); return !!r; }, id);
const ext = () => reqs.filter((u) => /strudel\.b-cdn\.net|raw\.githubusercontent\.com\/(sgossner|felixroos)/.test(u));
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => {}); await ready();
await page.evaluate(async () => { await window.__sc.Engine.play('$: note("c3 e3").s("sawtooth").gain(0.1)', false, () => {}); await new Promise((ok) => setTimeout(ok, 1500)); });
check('first load and a synth-only Play: no request to the referenced hosts', ext().length === 0, ext().join(','));
await play('vcsl-marimba');
const wav = resp.filter(([u, s]) => /VCSL.*Marimba.*\.wav/i.test(decodeURIComponent(u)) && s === 200).length, map = resp.some(([u, s]) => /vcsl\.json/.test(u) && s === 200);
const reg = await page.evaluate(() => { const m = window.soundMap && window.soundMap.get(); return !!(m && m.marimba); });
check('vcsl-marimba: map 200, marimba wav 200 (' + wav + '), sound registered', map && wav > 0 && reg, `map=${map} wav=${wav} reg=${reg}`);
check('piano map is not requested while only the VCSL recipe has played', !reqs.some((u) => /piano\.json/.test(u)), '');
await play('salamander-piano-chords');
const mp3 = resp.filter(([u, s]) => /dough-samples.*piano.*\.mp3/.test(u) && s === 200).length, pmap = resp.some(([u, s]) => /piano\.json/.test(u) && s === 200);
const preg = await page.evaluate(() => { const m = window.soundMap && window.soundMap.get(); return !!(m && m.piano); });
check('salamander-piano-chords: piano.json 200, piano mp3 200 (' + mp3 + '), sound registered', pmap && mp3 > 0 && preg, `map=${pmap} mp3=${mp3} reg=${preg}`);
/* offline report (informational, no assertion): what the caches do with referenced sources */
await ctx.setOffline(true); const failed = []; page.on('requestfailed', (r) => failed.push(r.url())); resp.length = 0; await page.reload({ waitUntil: 'load' }); await ready().catch(() => {});
await play('vcsl-marimba').catch(() => {});
const okAudio = resp.filter(([u, st]) => /VCSL.*\.wav/i.test(decodeURIComponent(u)) && st === 200).length;
console.log(`INFO offline after one online play: map host failed=${failed.some((u) => /strudel\.b-cdn\.net/.test(u))}, VCSL wav served from cache=${okAudio}, failed requests=${failed.length}`);
check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
