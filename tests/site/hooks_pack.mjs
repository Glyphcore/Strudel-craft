/* Site adapter for pack kind `hooks` (#91). Usage: node tests/site/hooks_pack.mjs [--bars N]   (default: the track's full 80 bars)
   Serves site/ (Playwright Chromium), evaluates docs/tracks/night-phonk-demo/track.strudel.js (pack version: racks come from glyphcore/phonk:racks) and
   track.standalone.strudel.js (racks inlined) through the real pipeline (Engine.idle: atoms.prepare -> packHooks -> protect -> Strudel's transpiler) and compares
   the queried haps over the whole track: value, whole, part, tags; then a short offline level comparison of both. Also: a program that names no pack gets no defs,
   re-evaluation is idempotent, and a hooks ingredient of a pack removed from the lock leaves no defs. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/', TR = path.join(ROOT, 'docs/tracks/night-phonk-demo');
const BARS = (() => { const i = process.argv.indexOf('--bars'); return i > 0 ? +process.argv[i + 1] : 80; })();
const PACK = fs.readFileSync(path.join(TR, 'track.strudel.js'), 'utf8'), STAND = fs.readFileSync(path.join(TR, 'track.standalone.strudel.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}${PREFIX}`);
await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 });
await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.load('glyphcore/phonk:atoms'); await window.__sc.Engine.load(); });
const defsNow = () => page.evaluate(() => Object.keys(JSON.parse(window.strudelCraft.hooks.toJSON()).defs || {}).sort());
const idle = (code) => page.evaluate(async (c) => { window.strudelCraft.hooks.reset(); await window.__sc.Engine.idle(c); return true; }, code);

// 1. adapter: the ingredient is loaded through the loader, defs installed, nothing else
const ing = await page.evaluate(async () => { const P = window.strudelCraft.packs; await P.load('glyphcore/phonk:racks'); const p = P.list().find((x) => x.id === 'glyphcore/phonk'); const i = p.ingredients.find((x) => x.id === 'racks'); return { state: i.state, kind: i.kind, code: i.code, reason: i.reason }; });
check('glyphcore/phonk:racks (hooks@1) loads through the loader (no W_PACK_KIND skip)', ing.state === 'ready' && ing.kind === 'hooks', JSON.stringify(ing));
await idle('s("bd")'); check('a program that names no pack hooks leaves the registry without defs', (await defsNow()).length === 0, JSON.stringify(await defsNow()));
await idle(PACK.split('\n').slice(0, 7).join('\n'));
const names = await defsNow(); check('pack program: the racks defs are in the registry after hooks.reset() + evaluation', names.length >= 19 && names.includes('kick808') && names.includes('pump'), names.length + ' defs');
await idle(PACK.split('\n').slice(0, 7).join('\n')); check('re-evaluation is idempotent (same defs, same bindings)', JSON.stringify(await defsNow()) === JSON.stringify(names));

// 2. the track: same haps, standalone vs pack
const haps = (code) => page.evaluate(async ({ code, bars }) => {
  window.strudelCraft.hooks.reset(); await window.__sc.Engine.idle(code); const pat = window.__sc.Engine.repl.state.pattern; if (!pat) return { err: 'no pattern ' + JSON.stringify(window.__sc.Engine.state.evalError && String(window.__sc.Engine.state.evalError)) };
  const fr = (x) => (x && x.toFraction ? x.toFraction() : String(x)), val = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? '[fn]' : x));
  const out = []; for (let b = 0; b < bars; b += 4) for (const h of pat.queryArc(b, Math.min(bars, b + 4))) out.push([fr(h.part.begin), fr(h.part.end), h.whole ? fr(h.whole.begin) + '-' + fr(h.whole.end) : '', val(h.value), JSON.stringify((h.context && h.context.tags) || [])].join('|'));
  return { n: out.length, haps: out.sort() };
}, { code, bars: BARS });
const a = await haps(STAND), b = await haps(PACK);
check(`standalone queries ${BARS} bars`, a.n > 1000, a.err || a.n + ' haps'); check('pack version queries the same', !b.err && b.n > 1000, b.err || b.n + ' haps');
const same = !a.err && !b.err && a.n === b.n && a.haps.every((x, i) => x === b.haps[i]);
check('pack version has the same events as the standalone (value, part, whole, tags)', same, same ? a.n + ' haps' : `${a.n} vs ${b.n}; first diff ${a.haps.findIndex((x, i) => x !== b.haps[i])}: ${(a.haps.find((x, i) => x !== (b.haps || [])[i]) || '').slice(0, 200)} <> ${((b.haps || []).find((x, i) => x !== a.haps[i]) || '').slice(0, 200)}`);

// 3. short offline render (bars 17-18 of the drop, superdough on an OfflineAudioContext, seeded Math.random): level and sample-sum comparison, standalone vs pack
const render = (code) => page.evaluate(async ({ code, from, to }) => {
  const W = window; window.strudelCraft.hooks.reset(); await W.__sc.Engine.idle(code); const pat = W.__sc.Engine.repl.state.pattern; const cps = 128.8 / 240, rate = 22050;
  const mul = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const haps = pat.queryArc(from, to, { _cps: cps }).filter((h) => h.hasOnset()).sort((x, y) => x.whole.begin.valueOf() - y.whole.begin.valueOf());
  const live = W.getAudioContext(), ctl = W.getSuperdoughAudioController(), rnd = Math.random; let fails = 0;
  const pass = async (ctx, count) => { W.setAudioContext(ctx); W.setSuperdoughAudioController(null); try { await W.loadWorklets(); } catch (e) { /* offline worklets */ }
    for (const h of haps) { h.ensureObjectValue && h.ensureObjectValue(); const t = (h.whole.begin.valueOf() - from) / cps; try { await W.superdough({ ...h.value }, t, h.duration / cps, cps, h.whole.begin.valueOf()); } catch (e) { if (count) fails++; } } };
  try { Math.random = mul(1); await pass(new OfflineAudioContext(2, 128, rate), false); Math.random = mul(1);
    const frames = Math.round((to - from) / cps * rate), off = new OfflineAudioContext(2, frames, rate); await pass(off, true); const buf = await off.startRendering();
    const L = buf.getChannelData(0); let pk = 0, ss = 0, sum = 0; for (let i = 0; i < L.length; i++) { const v = L[i]; pk = Math.max(pk, Math.abs(v)); ss += v * v; sum += v * (i % 97 + 1); }
    return { haps: haps.length, fails, peak: +pk.toFixed(5), rms: +Math.sqrt(ss / L.length).toFixed(5), sum: +sum.toFixed(3) };
  } finally { Math.random = rnd; W.setAudioContext(live); W.setSuperdoughAudioController(ctl); }
}, { code, from: 16, to: 18 });
const ra = await render(STAND), rb = await render(PACK); // two identical runs differ by ~0.3% rms and a few % peak (unseeded noise sources inside superdough), so levels compare with a tolerance
check('offline render of bars 17-18: both produce audio', ra.peak > 0.01 && rb.peak > 0.01, JSON.stringify([ra, rb]));
check('offline render: same haps, RMS within 2% and peak within 10% (standalone vs pack)', ra.haps === rb.haps && Math.abs(ra.rms / rb.rms - 1) < 0.02 && Math.abs(ra.peak / rb.peak - 1) < 0.1, JSON.stringify([ra, rb]));
// negative control: without the adapter the pack program has no racks, and the events differ
const off = await page.evaluate(async (code) => { const h = window.strudelCraft.packHooks; window.strudelCraft.packHooks = null; try { window.strudelCraft.hooks.reset(); await window.__sc.Engine.idle(code); const p = window.__sc.Engine.repl.state.pattern; return p ? p.queryArc(16, 17).map((x) => JSON.stringify(x.value)).sort().join('\n').length : -1; } catch (e) { return -2; } finally { window.strudelCraft.packHooks = h; } }, PACK);
const on = await page.evaluate(async (code) => { window.strudelCraft.hooks.reset(); await window.__sc.Engine.idle(code); return window.__sc.Engine.repl.state.pattern.queryArc(16, 17).map((x) => JSON.stringify(x.value)).sort().join('\n').length; }, PACK);
check('negative control: without the adapter the pack program does not give the same events', off !== on, `${off} vs ${on}`);

// 4. removal: the pack leaves the lock -> a later evaluation carries none of its defs
await page.evaluate(async () => { await window.strudelCraft.packs.remove('glyphcore/phonk'); });
await idle('s("bd")'); check('a pack removed from the lock leaves no defs', (await defsNow()).length === 0, JSON.stringify(await defsNow()));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
