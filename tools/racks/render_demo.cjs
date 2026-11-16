// Render the night phonk demo to a float stereo WAV with the site's own offline recorder (issue #125 box 6).
// Serves site/ locally, loads the glyphcore/phonk packs, runs the 2nd Syntax track, calls strudelCraft.capture.recordOffline.
// Needs: Playwright with Chromium, and network access to unpkg (Strudel is loaded unmodified from there).
//   node tools/racks/render_demo.cjs OUT.wav [--cycles 8] [--at 17]
// Env: PLAYWRIGHT_MODULES  directory containing node_modules/playwright (default: normal resolution, then `npm root -g`)
//      CHROMIUM_PATH       Chromium executable (default: Playwright's own browser)
const fs = require('fs'), http = require('http'), path = require('path'), { execSync } = require('child_process');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!OUT) { console.error('usage: render_demo.cjs OUT.wav [--cycles 8] [--at 17]'); process.exit(2); }
const CYCLES = +arg('--cycles', 8), AT = +arg('--at', 17), SITE = path.resolve(__dirname, '../../site'), PFX = '/Strudel-craft/';
function load() {
  const dirs = [process.env.PLAYWRIGHT_MODULES && path.join(process.env.PLAYWRIGHT_MODULES, 'node_modules'), execSync('npm root -g').toString().trim()].filter(Boolean);
  try { return require('playwright'); } catch (e) {}
  for (const d of dirs) { try { return require(require.resolve('playwright', { paths: [d] })); } catch (e) {} }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULES or install it globally');
}
const { chromium } = load();
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (!p.startsWith(PFX)) { r.writeHead(404); return r.end(); } p = p.slice(PFX.length - 1); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}${PFX}`;
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', body: '## Site\n- [x] d' }) : '[]' }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.error('pageerror', e.message.slice(0, 150)));
  await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.capture, null, { timeout: 90000 });
  await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.ready; await P.load('glyphcore/phonk:atoms'); await P.load('glyphcore/phonk:presets'); window.__sc.setView('syntax'); });
  for (let k = 0; k < 5; k++) {
    await page.waitForFunction(() => document.querySelectorAll('#sx-tracks .sx-run').length > 1, null, { timeout: 60000 }); await page.waitForTimeout(500);
    if (await page.evaluate(() => { const x = document.querySelectorAll('#sx-tracks .sx-run')[1]; if (!x) return false; x.click(); return true; })) break;
  }
  await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy && window.__sc.Engine.started, null, { timeout: 120000 }); await page.waitForTimeout(3000);
  const o = await page.evaluate(async ([cycles, at]) => {
    const C = window.strudelCraft.capture; C.configure({ source: 'offline', audio: true, events: true, code: true });
    const rec = await C.recordOffline(cycles, { at, name: 'o' }); if (!rec) return { error: 'no take' };
    const a = rec.audio.render, enc = (x) => { const u = new Uint8Array(x.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    return { sr: a.sr, cps: rec.recipe.timing.cps, L: enc(a.L), R: enc(a.R) };
  }, [CYCLES, AT]);
  if (o.error) { console.error(o.error); process.exit(1); }
  const L = new Float32Array(Uint8Array.from(Buffer.from(o.L, 'base64')).buffer), R = new Float32Array(Uint8Array.from(Buffer.from(o.R, 'base64')).buffer), n = L.length, bf = Buffer.alloc(44 + n * 8);
  bf.write('RIFF', 0); bf.writeUInt32LE(36 + n * 8, 4); bf.write('WAVEfmt ', 8); bf.writeUInt32LE(16, 16); bf.writeUInt16LE(3, 20); bf.writeUInt16LE(2, 22); bf.writeUInt32LE(o.sr, 24); bf.writeUInt32LE(o.sr * 8, 28);
  bf.writeUInt16LE(8, 32); bf.writeUInt16LE(32, 34); bf.write('data', 36); bf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { bf.writeFloatLE(L[i], 44 + i * 8); bf.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(OUT, bf); console.log(JSON.stringify({ wrote: OUT, frames: n, sample_rate: o.sr, cps: o.cps, bpm: +(o.cps * 240).toFixed(2) })); await b.close(); srv.close();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
