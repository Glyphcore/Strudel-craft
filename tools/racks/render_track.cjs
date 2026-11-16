// Render a whole track (Craft form or standalone) to a float stereo WAV with the site's own offline recorder (issue #136; generalises render_demo.cjs).
// Serves site/ locally, loads packs, puts the program into the Rack editor, plays once (so the engine and sources are live), then calls
// strudelCraft.capture.recordOffline for the bar range. Needs Playwright + Chromium and network access to unpkg (Strudel is loaded unmodified).
//   node tools/racks/render_track.cjs TRACK.js OUT.wav [--bars 1-128] [--tail 2] [--solo a,b] [--mute a,b] [--quiet a,b] [--load pack:ingredient ...]
//   --bars A-B   1-based inclusive bar range (one cycle = one bar); default 1-128 (or 1-N with --total N)
//   --tail N     extra bars rendered after B so reverb and delay tails ring out (default 0)
//   --solo L,..  keep only these lane labels (every other `name:` lane at column 0 gets a leading underscore = muted); --mute L,.. mute these lanes
//   --quiet L,.. keep the lane firing (so sidechain ducks and taps still trigger) but silence its output: appends .postgain(0) to the lane's statement
//   --load ID    pack ingredient to load before evaluating (repeatable), e.g. glyphcore/edm:racks-edm-core; ingredients named in `pack:` imports are loaded automatically
// Env: PLAYWRIGHT_MODULES  directory containing node_modules/playwright (default: normal resolution, then `npm root -g`)
//      CHROMIUM_PATH       Chromium executable (default: Playwright's own browser)
const fs = require('fs'), http = require('http'), path = require('path'), { execSync } = require('child_process');
const args = process.argv.slice(2), flags = new Set(['--bars', '--tail', '--solo', '--mute', '--quiet', '--load', '--total']);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; }, all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && flags.has(args[i - 1])));
const [TRACK, OUT] = pos;
if (!TRACK || !OUT) { console.error('usage: render_track.cjs TRACK.js OUT.wav [--bars 1-128] [--tail 2] [--solo a,b] [--mute a,b] [--quiet a,b] [--load id]'); process.exit(2); }
const [B0, B1] = arg('--bars', '1-' + arg('--total', '128')).split('-').map(Number), TAIL = +arg('--tail', 0);
const list = (k) => (arg(k, '') || '').split(',').map((s) => s.trim()).filter(Boolean), SOLO = list('--solo'), MUTE = list('--mute'), QUIET = list('--quiet');
const SITE = path.resolve(__dirname, '../../site'), PFX = '/Strudel-craft/';
let code = fs.readFileSync(path.resolve(TRACK), 'utf8');
// lane filter: a lane is a line `name: ...` at column 0 (continuation lines are indented or start with `.`)
if (SOLO.length || MUTE.length) {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(_?)([A-Za-z]\w*):/.exec(lines[i]);
    if (m) { const off = (SOLO.length && !SOLO.includes(m[2])) || MUTE.includes(m[2]); if (off && !m[1]) lines[i] = '_' + lines[i]; }
  }
  code = lines.join('\n');
}
if (QUIET.length) {
  const L = code.split('\n'); let i = 0;
  while (i < L.length) {
    const m = /^_?([A-Za-z]\w*):/.exec(L[i]);
    if (m && QUIET.includes(m[1])) { let j = i; while (j + 1 < L.length && /^(\s+\S|\.)/.test(L[j + 1]) && !/^\s*\/\//.test(L[j + 1])) j++; L[j] = L[j].replace(/(\s*\/\/.*)?$/, '.postgain(0)$1'); i = j + 1; } else i++;
  }
  code = L.join('\n');
}
const loads = [...all('--load'), ...[...code.matchAll(/pack:([\w-]+\/[\w-]+):([\w-]+)/g)].map((m) => m[1] + ':' + m[2])];
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
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.error('pageerror', e.message.slice(0, 200))); page.on('dialog', (d) => { console.error('NATIVE DIALOG', d.message()); d.dismiss(); });
  await page.goto(BASE); await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.capture, null, { timeout: 90000 });
  await page.evaluate(async (ids) => { const P = window.strudelCraft.packs; await P.ready; for (const id of ids) await P.load(id); window.__sc.setView('rack'); }, [...new Set(loads)]);
  await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input')); }, code);
  await page.evaluate(() => window.__sc.play());
  await page.waitForFunction(() => window.__sc.S.playing && !window.__sc.S.busy && window.__sc.Engine.started, null, { timeout: 180000 }); await page.waitForTimeout(2000);
  await page.evaluate(() => window.__sc.stop());
  const o = await page.evaluate(async ([cycles, at]) => {
    const C = window.strudelCraft.capture; C.configure({ source: 'offline', audio: true, events: false, code: true });
    const rec = await C.recordOffline(cycles, { at, name: 'o' }); if (!rec) return { error: 'no take' };
    const a = rec.audio.render, enc = (x) => { const u = new Uint8Array(x.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    return { sr: a.sr, cps: rec.recipe.timing.cps, fails: rec.recipe.outputs.render.fails, L: enc(a.L), R: enc(a.R) };
  }, [B1 - B0 + 1 + TAIL, B0 - 1]);
  if (o.error) { console.error(o.error); process.exit(1); }
  const L = new Float32Array(Uint8Array.from(Buffer.from(o.L, 'base64')).buffer), R = new Float32Array(Uint8Array.from(Buffer.from(o.R, 'base64')).buffer), n = L.length, bf = Buffer.alloc(44 + n * 8);
  bf.write('RIFF', 0); bf.writeUInt32LE(36 + n * 8, 4); bf.write('WAVEfmt ', 8); bf.writeUInt32LE(16, 16); bf.writeUInt16LE(3, 20); bf.writeUInt16LE(2, 22); bf.writeUInt32LE(o.sr, 24); bf.writeUInt32LE(o.sr * 8, 28);
  bf.writeUInt16LE(8, 32); bf.writeUInt16LE(32, 34); bf.write('data', 36); bf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { bf.writeFloatLE(L[i], 44 + i * 8); bf.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(OUT, bf); console.log(JSON.stringify({ wrote: OUT, frames: n, sample_rate: o.sr, cps: o.cps, bpm: +(o.cps * 240).toFixed(2), bars: [B0, B1], tail: TAIL, fails: o.fails, packs: [...new Set(loads)] })); await b.close(); srv.close();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
