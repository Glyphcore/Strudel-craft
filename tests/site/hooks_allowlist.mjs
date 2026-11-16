/* Regression for the hooks step allowlist (#91 rework 2). Usage: node tests/site/hooks_allowlist.mjs
   Serves site/ (Playwright Chromium) and runs the real installer (site/packs-hooks.js + site/data/hooks-steps.json, the same code sc.packHooks uses) against the real hooks
   runtime with attacker defs: bbexpr as a scalar string and as an array (the byte-beat AudioWorklet compiles it with `new Function`), speak, a visual (pianoroll, _scope).
   Each must be rejected with E_PACK_HOOKS_INVALID naming the method, no def installed, no message to `byte-beat-processor`, no canvas, no new window global. */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
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
await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.__sc.Engine.load(); });
// spy: every AudioWorkletNode constructed and every message posted to a worklet
await page.evaluate(() => { window.__wk = []; const O = window.AudioWorkletNode; window.AudioWorkletNode = class extends O { constructor(c, name, o) { super(c, name, o); window.__wk.push([name, 'new']); const pm = this.port.postMessage.bind(this.port); this.port.postMessage = (m, t) => { window.__wk.push([name, 'msg']); return pm(m, t); }; } }; });
const cases = [
  ['bbexpr scalar string', [['s', 'bytebeat'], ['bbexpr', 't*(t>>15^t>>66)']], 'bbexpr'],
  ['bbexpr array (skips the mini-notation parse)', [['s', 'bytebeat'], ['bbexpr', ['(()=>{window.__pwn=1})(),t']]], 'bbexpr'],
  ['byteBeatExpression array', [['byteBeatExpression', ['1']]], 'byteBeatExpression'],
  ['speak', [['speak', 'en', 'hello']], 'speak'],
  ['visual pianoroll', [['pianoroll']], 'pianoroll'],
  ['visual _scope', [['_scope']], '_scope'],
];
const r = await page.evaluate(async (cases) => {
  const m = await import(location.pathname.replace(/[^/]*$/, '') + 'packs-hooks.js'); const steps = await m.loadSteps(); const allow = m.chainable(globalThis.Pattern, steps);
  await window.__sc.Engine.idle('s("bd")'); // warm-up: Strudel's own evaluation defines its globals once
  const H = window.strudelCraft.hooks; const out = { size: allow.size, cases: [] }; const globalsBefore = new Set(Object.getOwnPropertyNames(window)); const canvasBefore = document.querySelectorAll('canvas').length;
  for (const [name, chain, method] of cases) {
    const st = { defs: new Map(), told: new Set() }, toasts = [];
    const res = m.install(H, [{ pack: 'evil/p', ingredient: 'x', data: { model: 1, defs: { evil: { chain } } } }], st, {}, (t) => toasts.push(t), { allow });
    out.cases.push({ name, method, invalid: res.invalid.map((i) => ({ code: i.code, msg: i.errors[0].message })), installed: res.defs, toast: toasts.length });
  }
  // positive control through the real glue: a shipped pack installs
  const ok = m.install(H, [{ pack: 'x/ok', ingredient: 'r', data: { model: 1, params: {}, defs: { fine: { params: { d: { default: 1 } }, chain: [['lpf', { $param: 'd' }], ['gain', 0.5]] } } } }], { defs: new Map(), told: new Set() }, {}, () => {}, { allow });
  out.control = { defs: ok.defs, invalid: ok.invalid.length }; H.undef('fine');
  await window.__sc.Engine.idle('s("bd").hook("evil")').catch(() => {});
  out.registry = Object.keys(JSON.parse(H.toJSON()).defs || {});
  out.canvasAdded = document.querySelectorAll('canvas').length - canvasBefore; out.newGlobals = Object.getOwnPropertyNames(window).filter((k) => !globalsBefore.has(k) && k !== '__wk');
  out.pwn = window.__pwn === undefined; return out;
}, cases);
await page.waitForTimeout(500);
const wk = await page.evaluate(() => window.__wk);
check(`allowlist data loaded by the installer, ${r.size} methods active`, r.size > 30, String(r.size));
for (const c of r.cases) check(`${c.name}: rejected E_PACK_HOOKS_INVALID naming ${c.method}`, c.invalid.length === 1 && c.invalid[0].code === 'E_PACK_HOOKS_INVALID' && c.invalid[0].msg.includes(`"${c.method}"`) && !c.installed.length && c.toast === 1, JSON.stringify(c));
check('positive control: an allowlisted def installs', r.control.defs.includes('fine') && r.control.invalid === 0, JSON.stringify(r.control));
check('no attacker def in the hooks registry', !r.registry.includes('evil'), JSON.stringify(r.registry));
check('no message reached byte-beat-processor (and none was created)', !wk.some((w) => /byte-beat/.test(w[0])), JSON.stringify(wk.filter((w) => /byte/.test(w[0]))));
check('no canvas added, no new window global, attacker code never ran', r.canvasAdded === 0 && r.newGlobals.length === 0 && r.pwn, JSON.stringify({ canvas: r.canvasAdded, globals: r.newGlobals }));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
