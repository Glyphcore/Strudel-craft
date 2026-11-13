// word() + voxBank() headless check: node tests/site/vox.mjs
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg' };
const srv = http.createServer((q, r) => {  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!fs.existsSync(f)) { console.log('404', p); r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await b.newPage(); const errs = [], fails = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (process.env.V) console.log('C:', m.text().slice(0, 200)); if (m.type() === 'error' || /not found|no vox/i.test(m.text())) errs.push(m.text()); }); page.on('requestfailed', (r) => fails.push(r.url()));
await page.goto(`http://127.0.0.1:${srv.address().port}/`); await page.waitForSelector('#list li[data-id]');
const peakOf = async (code, ms) => page.evaluate(async ([code, ms]) => {
  const sc = window.__sc; await sc.Engine.play(code, false, () => {}); const an = sc.Bus.an, buf = new Float32Array(an.fftSize); let best = 0; const t0 = performance.now();
  while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const x of buf) best = Math.max(best, Math.abs(x)); await new Promise((r) => setTimeout(r, 50)); }
  return { peakLin: +best.toFixed(4), evalError: sc.Engine.state.evalError ? String(sc.Engine.state.evalError.message || sc.Engine.state.evalError) : null, active: window.voxBank.list().filter((b) => b.active).map((b) => b.name) };
}, [code, ms]);
await peakOf('$: s("bd")', 500).catch(()=>0);
const a = await peakOf('$: word("<call me baby>").note("c4")', 8000);
console.log('demo', JSON.stringify(a));
const c = await peakOf(`await voxBank('call-me-baby')
$: word("<call me baby>").note("c3")`, 5000);
console.log('cmb', JSON.stringify(c));
console.log('errors', JSON.stringify(errs), 'failed', JSON.stringify(fails.filter((u) => !/unpkg|cdn|fonts/.test(u))));
await b.close(); srv.close();
const bad = errs.filter((e) => /vox/i.test(e) || !/getTrigger/.test(e));
process.exit(a.peakLin > 0.001 && !a.evalError && !bad.length ? 0 : 1);
