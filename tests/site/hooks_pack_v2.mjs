/* #91: the pack version of night phonk v2 (docs/tracks/night-phonk-demo/track.v2.strudel.js, racks + racks-v2 from glyphcore/phonk, loaded by the hooks adapter)
   on the real site: (1) the same events as the strudel CLI (CLI: --packs site/packs.lock.json + the merged racks as --hooks) over cycles 0..N, compared as
   multisets of (onset cycle, sound, note/n, gain); (2) audibly: the site plays it (transport range at drop A) and the master analyser peaks > 0.01.
   Usage: node tests/site/hooks_pack_v2.mjs [--cycles 20] [--no-cli]     (the CLI part needs the suno-track-lab strudel CLI, STRUDEL_CLI dir to override) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/', TR = path.join(ROOT, 'docs/tracks/night-phonk-demo');
const CYC = (() => { const i = process.argv.indexOf('--cycles'); return i > 0 ? +process.argv[i + 1] : 20; })();
const CLI = path.join(process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli', 'strudel');
const PACK = fs.readFileSync(path.join(TR, 'track.v2.strudel.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(`http://127.0.0.1:${server.address().port}${PREFIX}`);
await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 });
await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.load('glyphcore/phonk:atoms'); await window.__sc.Engine.load(); });

// 1. events: site vs CLI
const key = (cycle, s, n, g) => `${(+cycle).toFixed(3)}|${s}|${n ?? ''}|${g == null ? '' : (+g).toFixed(3)}`;
const site = await page.evaluate(async ({ code, cyc }) => {
  window.strudelCraft.hooks.reset(); await window.__sc.Engine.idle(code); const pat = window.__sc.Engine.repl.state.pattern; if (!pat) return { err: JSON.stringify(window.__sc.Engine.state.evalError || 'no pattern').slice(0, 300) };
  const defs = Object.keys(JSON.parse(window.strudelCraft.hooks.toJSON()).defs || {}); const out = [];
  for (let b = 0; b < cyc; b += 4) for (const h of pat.queryArc(b, Math.min(cyc, b + 4))) if (h.hasOnset()) { const v = h.value || {}; out.push([+h.whole.begin, v.s, v.n ?? v.note, v.gain]); }
  return { defs: defs.length, out };
}, { code: PACK, cyc: CYC });
check('site evaluates the v2 pack program (racks + racks-v2 defs installed, events produced)', !site.err && site.defs >= 40 && site.out.length > 100, site.err || `${site.defs} defs, ${site.out && site.out.length} onset haps in ${CYC} cycles`);
if (process.argv.includes('--no-cli') || !fs.existsSync(CLI)) console.log('SKIP  CLI comparison (--no-cli or no CLI at ' + CLI + ')');
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hkv2-')); const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/phonk/racks.json'), 'utf8')), b = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/phonk/racks-v2.json'), 'utf8'));
  Object.assign(a.defs, b.defs); const hk = path.join(tmp, 'hooks.json'); fs.writeFileSync(hk, JSON.stringify(a));
  const out = execFileSync(CLI, ['events', path.join(TR, 'track.v2.strudel.js'), '--cycles', String(CYC), '--packs', path.join(ROOT, 'site/packs.lock.json'), '--hooks', hk, '--prelude', path.join(TR, 'cli-site-base.js'), '--prelude', path.join(ROOT, 'site/prelude/word.js')], { env: { ...process.env, STRUDEL_CRAFT: ROOT }, maxBuffer: 1 << 28 }).toString();
  const cli = JSON.parse(out).events; const A = {}, B = {}; for (const e of cli) { const k = key(e.cycle, e.s, e.n ?? e.note, e.gain); A[k] = (A[k] || 0) + 1; } for (const [c, s, n, g] of site.out) { const k = key(c, s, n, g); B[k] = (B[k] || 0) + 1; }
  const diff = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => A[k] !== B[k]);
  check(`site and CLI give the same events over ${CYC} cycles (cycle, sound, note, gain)`, diff.length === 0 && cli.length === site.out.length, `cli ${cli.length}, site ${site.out.length}, differing keys ${diff.length} ${diff.slice(0, 3).map((k) => k + ' cli' + (A[k] || 0) + '/site' + (B[k] || 0)).join('; ')}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 2. audible: Play the pack version on the site from drop A (bar 17); the master analyser peaks
await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, PACK);
await page.evaluate(() => Object.assign(window.strudelCraft.range.state, { start: 16 })); await page.evaluate(() => window.__sc.play());
await page.waitForFunction(() => (window.__sc.S.playing && window.__sc.Engine.started) || document.querySelector('#status').classList.contains('err'), null, { timeout: 120000 }).catch(() => {}); await page.waitForTimeout(3000);
const pk = await page.evaluate(() => new Promise((ok) => { const an = window.__sc.Bus.an; let m = 0; const t = new Float32Array(an ? an.fftSize : 2048); const iv = setInterval(() => { if (an) { an.getFloatTimeDomainData(t); for (const x of t) m = Math.max(m, Math.abs(x)); } }, 30); setTimeout(() => { clearInterval(iv); ok({ peak: +m.toFixed(4), playing: window.__sc.S.playing, defs: Object.keys(JSON.parse(window.strudelCraft.hooks.toJSON()).defs || {}).length, cps: +(window.__sc.Engine.scheduler.cps || 0).toFixed(4), cycle: +window.__sc.Engine.scheduler.now().toFixed(1), status: document.querySelector('#status').textContent.slice(0, 100) }); }, 4000); }));
check('the pack version (not a recipe) plays on the site from drop A: racks installed in the live registry, program tempo 128.8 bpm, cycle >= 16, master peak > 0.01', pk.playing && pk.defs >= 40 && Math.abs(pk.cps - 128.8 / 240) < 0.003 && pk.cycle >= 16 && pk.peak > 0.01, JSON.stringify(pk));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
