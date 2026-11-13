// Hooks P5 (#51): intellisense providers. Run: node tests/hooks/p5.mjs
// Browser boxes run against site/ in Playwright; boxes needing the hooks runtime (#47) print SKIP with the missing piece.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { bootRuntime } from './fixtures/rt.mjs';
import { createLibrary, installInstances } from '../../site/library.js';
import { fallbackStore } from '../../site/library-store.js';
import { tapControls, modelItems } from '../../site/hooks-intellisense.js';
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
const NO_RT = '@strudel/core/@strudel/mini not installed (set STRUDEL_MODULES=<dir with @strudel/>); the hooks runtime cannot be evaluated';
const RT = await bootRuntime(); // real unmodified Strudel + site/engine/hooks.js, evaluated in Node and exposed to the page as strudelCraft.hooks.manifest()
const memStore = () => { const o = {}; return { getItem: (k) => o[k] ?? null, setItem: (k, v) => { o[k] = v; } }; };
const PADC = { model: 1, tracks: [{ name: 'pad', source: ['note', { $mini: 'c3 e3' }], chain: [['tap', 'env']] }], exports: { taps: ['env'], slots: ['fx'], params: {}, requires: { taps: ['kick'] } } };
let nodeLib = null;
if (RT) { nodeLib = createLibrary(fallbackStore(memStore())); nodeLib.save(PADC, { name: 'pad', kind: 'track' }); installInstances(RT.hooks, { lib: nodeLib, S: RT.S, tap: RT.tap }); }
const browser = await chromium.launch(); const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
if (RT) await page.exposeFunction('__rtManifest', () => RT.hooks.manifest());
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
  const rtOn = () => page.evaluate(() => { window.strudelCraft.hooks = { manifest: () => window.__rtManifest() }; });
  const rtRefresh = () => page.evaluate(() => window.strudelCraft.hooksIntellisense.refresh());
  if (!RT) skip('Data-driven slots and hooks (evaluated hooks.def/.use -> bind completion)', NO_RT + '; model-text path is checked below instead'); else {
    await rtOn(); await setCode('');
    RT.hooks.reset(); RT.hooks.def('murk', { params: { hz: { min: 20, max: 20000, default: 400 } } }); RT.hooks.bind('fx', 'murk');
    await rtRefresh(); const its = await items(); const m = has(its, 'murk', 'hook names'), d = has(its, 'murk(400)', 'hook names');
    assert(has(its, 'fx', 'slots') && m && d && m.info.includes('20..20000'));
    pass('Data-driven (evaluated runtime): after hooks.def("murk",{hz 20..20000}) + hooks.bind("fx","murk") evaluated by the real runtime, slot fx, hook murk and murk(400) with the range in info');
  }
  { await setCode('hooks.def("murk", { params: { hz: { min: 20, max: 20000, default: 400 } } })\nhooks.bind("fx", "murk")\n$: s("bd").use("fx")\n');
    const its = await items(); assert(has(its, 'fx', 'slots')); const m = has(its, 'murk', 'hook names'), d = has(its, 'murk(400)', 'hook names');
    assert(m && d && m.info.includes('20..20000') && m.info.includes('default 400'));
    pass('(model-text path) slot fx and hook murk / murk(400) with param range in info; no reload (provider re-registered on input)'); }
  if (!RT) skip('Runtime load: hooks.load(json) / hooks.undef', NO_RT); else {
    RT.hooks.load({ model: 1, defs: { late1: { params: { amt: { min: 0, max: 1, default: 0.5 } }, chain: [['gain', { $param: 'amt' }]] } } });
    await page.evaluate(() => window.dispatchEvent(new Event('strudel:hooks-changed'))); await page.waitForTimeout(150);
    assert(has(await items(), 'late1', 'hook names'), 'late1 after load');
    RT.hooks.undef('late1'); await page.evaluate(() => window.dispatchEvent(new Event('strudel:hooks-changed'))); await page.waitForTimeout(150);
    assert(!has(await items(), 'late1', 'hook names'), 'late1 after undef');
    pass('Runtime load: hooks.load(json) adding late1 makes late1 appear in completions with no page reload; hooks.undef("late1") removes it');
  }
  { await setCode('hooks.marker("drop", 17)\n');
    const its = await items(); assert(has(its, 'drop', 'markers'));
    for (const g of ['@17b', '<17b', '9b..17b']) assert(has(its, g, 'gates') && has(its, g, 'gates').string);
    pass('Markers and gates: marker names and templates "@17b", "<17b", "9b..17b" offered as string items'); }
  { await setCode('hooks.def("wob", { decorator: true, params: { rate: { min: 1, max: 8, default: 2 } } })\nhooks.let("cut", 400)\n$: s("bd").tap("kick")\n');
    const its = await items();
    for (const l of ['kick', 'kick:onset', 'kick:gate', 'kick:env']) assert(has(its, l, 'taps'), l);
    assert(has(its, 'cut', 'variables')); assert(has(its, 'wob', 'decorators').apply === 'wob(2)[]');
    pass('(P2, model-level) taps kick, kick:onset/gate/env; variables; decorator template name(args)[...]');
    if (!RT) skip('(P2) controls present on the tapped events', NO_RT); else {
      RT.hooks.reset(); RT.S.s(RT.S.mini('bd*2')).gain(0.5).tap('kick');
      const tc = tapControls(RT.tap, ['kick']); assert.deepEqual(tc.kick, ['gain', 's']);
      const its2 = modelItems({ tapControls: tc }, null); assert(has(its2, 'kick:gain', 'taps') && has(its2, 'kick:s', 'taps') && has(its2, 'kick:onset', 'taps'));
      pass('(P2) controls on tapped events: tap("kick") events carry gain and s (read from the real runtime); kick:gain and kick:s offered next to kick:onset');
    } }
  { const r = await page.evaluate(async () => {
      const l = await import('./library.js');
      l.lib.save({ model: 1, tracks: [{ name: 'pad', source: ['s', { $mini: 'x' }], chain: [['tap', 'env']] }], exports: { taps: ['env'], slots: ['fx'], params: {}, requires: { taps: ['kick'] } } }, { name: 'pad', kind: 'track' });
      const t = document.getElementById('code'); t.value = 'hooks.inst("pad@1", { as: "pad2" })\n'.replace('hooks.inst', '$: hooks.inst'); t.dispatchEvent(new Event('input', { bubbles: true }));
      await window.strudelCraft.hooksIntellisense.refresh(); const a = window.strudelCraft.intellisense; a.invalidate(); return a.all({}); });
    const c = has(r, 'pad@1', 'components'); assert(c && c.info.includes('env') && c.info.includes('requires: kick'));
    assert(has(r, 'pad2/fx', 'slots') && has(r, 'pad2/env', 'taps'));
    pass('(P4, model-level) hooks.inst offers name@rev with exports and requires in info; pad2/ slots and taps offered');
    if (!RT) skip('(P4) hooks.inst runtime instance', NO_RT); else {
      RT.hooks.reset(); RT.hooks.inst('pad@1', { as: 'pad2', remap: { kick: 'drums/kick' } });
      await rtOn(); await setCode(''); await rtRefresh(); const its3 = await items();
      assert(has(its3, 'pad2/fx', 'slots') && has(its3, 'pad2/env', 'taps'));
      pass('(P4) runtime instance: hooks.inst("pad@1",{as:"pad2"}) evaluated by the real runtime makes pad2/fx slot and pad2/env tap appear');
    } }
} catch (e) { console.log('FAIL ' + (e.stack || e)); await browser.close(); server.close(); process.exit(1); }
await browser.close(); server.close();
if (errs.length) { console.log('FAIL page errors: ' + errs.join(' | ')); process.exit(1); }
