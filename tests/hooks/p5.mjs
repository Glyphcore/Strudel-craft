// Hooks P5 (#51): intellisense providers. Run: node tests/hooks/p5.mjs
// Browser boxes run against site/ in Playwright; boxes needing the hooks runtime (#47) print SKIP with the missing piece.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const NO_RT = 'hooks runtime (#47) has no hooks.def/load/undef evaluation or window.strudelCraft.hooks.manifest() yet';
const browser = await chromium.launch(); const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.hooksIntellisense);
const items = () => page.evaluate(() => { const a = window.strudelCraft.intellisense; a.invalidate(); return a.all({}); });
const setCode = async (v) => { await page.evaluate((v) => { const t = document.getElementById('code'); t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }, v); await page.evaluate(() => window.strudelCraft.hooksIntellisense.refresh()); };
const has = (its, label, cat) => its.find((i) => i.label === label && (!cat || i.category === cat));
try {
  { const p = await page.evaluate(() => window.strudelCraft.intellisense.providers()); assert(p.includes('hooks') && p.includes('model'));
    pass('providers() includes hooks and model after load'); }
  { const its = await items();
    for (const [n, sig] of [['use', '.use('], ['wrap', '.wrap('], ['tap', '.tap('], ['wire', '.wire('], ['ns', '.ns(']]) { const i = its.find((x) => x.label === n && x.method && x.category === 'hooks'); assert(i && i.detail.includes(sig), n); }
    pass('Methods: use, wrap, tap, wire, ns offered after "." with signatures in detail'); }
  skip('Data-driven slots and hooks (evaluated hooks.def/.use -> bind completion)', NO_RT + '; model-text path is checked below instead');
  { await setCode('hooks.def("murk", { params: { hz: { min: 20, max: 20000, default: 400 } } })\nhooks.bind("fx", "murk")\n$: s("bd").use("fx")\n');
    const its = await items(); assert(has(its, 'fx', 'slots')); const m = has(its, 'murk', 'hook names'), d = has(its, 'murk(400)', 'hook names');
    assert(m && d && m.info.includes('20..20000') && m.info.includes('default 400'));
    pass('(model-text path) slot fx and hook murk / murk(400) with param range in info; no reload (provider re-registered on input)'); }
  skip('Runtime load: hooks.load(json) / hooks.undef', NO_RT);
  { await setCode('hooks.marker("drop", 17)\n');
    const its = await items(); assert(has(its, 'drop', 'markers'));
    for (const g of ['@17b', '<17b', '9b..17b']) assert(has(its, g, 'gates') && has(its, g, 'gates').string);
    pass('Markers and gates: marker names and templates "@17b", "<17b", "9b..17b" offered as string items'); }
  { await setCode('hooks.def("wob", { decorator: true, params: { rate: { min: 1, max: 8, default: 2 } } })\nhooks.let("cut", 400)\n$: s("bd").tap("kick")\n');
    const its = await items();
    for (const l of ['kick', 'kick:onset', 'kick:gate', 'kick:env']) assert(has(its, l, 'taps'), l);
    assert(has(its, 'cut', 'variables')); assert(has(its, 'wob', 'decorators').apply === 'wob(2)[]');
    pass('(P2, model-level) taps kick, kick:onset/gate/env; variables; decorator template name(args)[...]');
    skip('(P2) controls present on the tapped events', NO_RT + '; needs rendered events'); }
  { const r = await page.evaluate(async () => {
      const l = await import('./library.js');
      l.lib.save({ model: 1, tracks: [{ name: 'pad', source: ['s', { $mini: 'x' }], chain: [['tap', 'env']] }], exports: { taps: ['env'], slots: ['fx'], params: {}, requires: { taps: ['kick'] } } }, { name: 'pad', kind: 'track' });
      const t = document.getElementById('code'); t.value = 'hooks.inst("pad@1", { as: "pad2" })\n'.replace('hooks.inst', '$: hooks.inst'); t.dispatchEvent(new Event('input', { bubbles: true }));
      await window.strudelCraft.hooksIntellisense.refresh(); const a = window.strudelCraft.intellisense; a.invalidate(); return a.all({}); });
    const c = has(r, 'pad@1', 'components'); assert(c && c.info.includes('env') && c.info.includes('requires: kick'));
    assert(has(r, 'pad2/fx', 'slots') && has(r, 'pad2/env', 'taps'));
    pass('(P4, model-level) hooks.inst offers name@rev with exports and requires in info; pad2/ slots and taps offered');
    skip('(P4) hooks.inst runtime instance', NO_RT); }
} catch (e) { console.log('FAIL ' + (e.stack || e)); await browser.close(); server.close(); process.exit(1); }
await browser.close(); server.close();
if (errs.length) { console.log('FAIL page errors: ' + errs.join(' | ')); process.exit(1); }
