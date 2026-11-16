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
  ['bbexpr scalar string', [['s', 'bd'], ['bbexpr', 't*(t>>15^t>>66)']], 'bbexpr'],
  ['bbexpr array (skips the mini-notation parse)', [['s', 'bd'], ['bbexpr', ['(()=>{window.__pwn=1})(),t']]], 'bbexpr'],
  ['byteBeatExpression array', [['byteBeatExpression', ['1']]], 'byteBeatExpression'],
  ['speak', [['speak', 'en', 'hello']], 'speak'],
  ['visual pianoroll', [['pianoroll']], 'pianoroll'],
  ['visual _scope', [['_scope']], '_scope'],
  // wire's first argument is the control it writes: only a control flagged "wire" in hooks-steps.json (round 3: animate added a canvas and a `frame` global)
  ['wire to animate (critic reproducer)', [['s', 'bd'], ['wire', 'animate', 't:ev']], 'animate'],
  ['wire to a visual (pianoroll)', [['s', 'bd'], ['wire', 'pianoroll', 't:ev']], 'pianoroll'],
  ['wire to bbexpr', [['s', 'bd'], ['wire', 'bbexpr', 't:ev']], 'bbexpr'],
  ['wire to speak', [['s', 'bd'], ['wire', 'speak', 't:ev']], 'speak'],
  ['wire to a prototype member (constructor)', [['s', 'bd'], ['wire', 'constructor', 't:ev']], 'constructor'],
  ['wire to a prototype member (__lookupGetter__)', [['s', 'bd'], ['wire', '__lookupGetter__', 't:ev']], '__lookupGetter__'],
  ['wire to a non-control allowlisted method (fast)', [['s', 'bd'], ['wire', 'fast', 't:ev']], 'fast'],
  ['wire to a string control (s)', [['s', 'bd'], ['wire', 's', 't:ev']], 's'],
  ['s selects bytebeat (data-only worklet source)', [['s', 'bytebeat']], 's'],
  ['s $mini with zzfx among tokens', [['s', { $mini: 'bd, zzfx' }]], 's'],
  ['sound z_sawtooth', [['sound', 'z_sawtooth']], 'sound'],
  ['wire to wire', [['s', 'bd'], ['wire', 'wire', 't:ev']], 'wire'],
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
  out.pwn = window.__pwn === undefined;
  out.reg = [typeof globalThis.isControlName, typeof globalThis.getControlName, (() => { try { window.strudelCraft.hooks.reset(); const p = globalThis.s('x').wire('lpf', 'k:env'); const q = globalThis.s('x').wire('animate', 'k:env'); return 'no throw ' + typeof p + typeof q; } catch (e) { return e.code; } })()];
  // general: one def per allowlisted method with a representative valid argument; evaluate and query 2 cycles each; versus a control run without hooks defs, the set of window globals and the count of canvas/iframe/audio/script nodes must be unchanged
  const ARGS = { range: [0, 1], euclid: [3, 8], struct: ['x ~ x x'], mask: ['1 0 1 1'], s: ['bd'], sound: ['bd'], bank: ['RolandTR909'], vowel: ['a'], note: ['c3'], chop: [2], fast: [2], slow: [2], segment: [4], wire: ['gain', 't:ev'], hook: ['base'], duckorbit: [1], n: [1] };
  const names = Object.keys(steps.methods), nodes = () => ['canvas', 'iframe', 'audio', 'script'].map((t) => document.querySelectorAll(t).length).join(',');
  const run = async (hooked) => { const errs = []; for (const m of names) { try { await window.__sc.Engine.idle(hooked ? `s("bd*2").hook("g_${m}")` : 's("bd*2")'); const pat = window.__sc.Engine.repl.state.pattern; try { pat && pat.queryArc(0, 2, { _cps: 1 }); } catch (e) { errs.push(m + ': ' + e.message); } } catch (e) { errs.push(m + ': ' + e.message); } } return errs; };
  const g0 = new Set(Object.getOwnPropertyNames(window)); await run(false); const ctlGlobals = Object.getOwnPropertyNames(window).filter((k) => !g0.has(k)), ctlNodes = nodes(); const wk0 = window.__wk.length;
  const defs = { base: { chain: [['gain', 1]] } }; for (const m of names) defs['g_' + m] = { chain: [[m, ...(ARGS[m] || [0.5])]] };
  const gr = m.install(H, [{ pack: 'gen/p', ingredient: 'x', data: { model: 1, defs } }], { defs: new Map(), told: new Set() }, {}, () => {}, { allow });
  const gerrs = await run(true); H.reset();
  out.gen = { methods: names.length, installed: gr.defs.length, invalid: gr.invalid.map((i) => i.errors[0].message), errs: gerrs.slice(0, 5), nErrs: gerrs.length, newGlobals: Object.getOwnPropertyNames(window).filter((k) => !g0.has(k) && !ctlGlobals.includes(k) && k !== '__wk'), nodesCtl: ctlNodes, nodesHooked: nodes(), wk: window.__wk.length - wk0 };
  // parity guard: EVERY hooks ingredient of EVERY pack in the shipped lock (site/packs.lock.json, source file:<dir> relative to site/) through the real validator; none may be rejected
  const lock = await (await fetch('packs.lock.json')).json(); out.parity = { packs: 0, ingredients: 0, defs: 0, rejected: [] };
  for (const pk of lock.packs) { const dir = String(pk.source).replace(/^file:/, '').replace(/\/$/, ''); const man = await (await fetch(dir + '/craftpack.json')).json(); out.parity.packs++;
    for (const ing of (man.ingredients || []).filter((i) => i.kind === 'hooks')) { const data = await (await fetch(dir + '/' + ing.path)).json(); out.parity.ingredients++;
      const pr = m.install(H, [{ pack: pk.id, ingredient: ing.path, data }], { defs: new Map(), told: new Set() }, {}, () => {}, { allow }); out.parity.defs += Object.keys(data.defs || {}).length;
      for (const i of pr.invalid) out.parity.rejected.push(pk.id + ':' + ing.path + ' ' + (i.errors[0] && i.errors[0].message || '').slice(0, 120)); H.reset(); } }
  return out;
}, cases);
await page.waitForTimeout(500);
const wk = await page.evaluate(() => window.__wk);
check(`allowlist data loaded by the installer, ${r.size} methods active`, r.size > 30, String(r.size));
for (const c of r.cases) check(`${c.name}: rejected E_PACK_HOOKS_INVALID naming ${c.method}`, c.invalid.length === 1 && c.invalid[0].code === 'E_PACK_HOOKS_INVALID' && c.invalid[0].msg.includes(`"${c.method}"`) && !c.installed.length && c.toast === 1, JSON.stringify(c));
check('positive control: an allowlisted def installs', r.control.defs.includes('fine') && r.control.invalid === 0, JSON.stringify(r.control));
check('no attacker def in the hooks registry', !r.registry.includes('evil'), JSON.stringify(r.registry));
check('no message reached byte-beat-processor (and none was created)', !wk.some((w) => /byte-beat/.test(w[0])), JSON.stringify(wk.filter((w) => /byte/.test(w[0]))));
check('no canvas added, no new window global, attacker code never ran', r.canvasAdded === 0 && r.newGlobals.length === 0 && r.pwn, JSON.stringify({ canvas: r.canvasAdded, globals: r.newGlobals }));
check(`general: a def for each of the ${r.gen.methods} allowlisted methods installs (plus base) and plays`, r.gen.installed === r.gen.methods + 1 && r.gen.invalid.length === 0, JSON.stringify({ invalid: r.gen.invalid.slice(0, 3) }));
check('general: query errors are none', r.gen.nErrs === 0, JSON.stringify(r.gen.errs));
check('general: window globals and canvas/iframe/audio/script node counts unchanged versus the control run, nothing posted to a worklet', r.gen.newGlobals.length === 0 && r.gen.nodesCtl === r.gen.nodesHooked && r.gen.wk === 0, JSON.stringify({ globals: r.gen.newGlobals, ctl: r.gen.nodesCtl, hooked: r.gen.nodesHooked, wk: r.gen.wk }));
check('engine in the page resolves wire targets from Strudel\'s registry (isControlName / getControlName present); a non-control throws E_BAD_ARG', r.reg[0] === 'function' && r.reg[1] === 'function' && r.reg[2] === 'E_BAD_ARG', JSON.stringify(r.reg));
check(`parity: every hooks ingredient of every shipped lock pack validates (${r.parity.packs} packs, ${r.parity.ingredients} ingredients, ${r.parity.defs} defs)`, r.parity.ingredients >= 6 && r.parity.rejected.length === 0, JSON.stringify(r.parity.rejected.slice(0, 5)));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
