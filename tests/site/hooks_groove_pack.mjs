/* Regression for the groove presets as pack hooks defs (glyphcore/phonk:grooves, #120) on the real site: before the `groove` step was on the hooks allowlist
   (site/data/hooks-steps.json) the whole phonk hooks ingredient set was refused ("hooks ingredient not loaded (E_PACK_HOOKS_INVALID ... step groove ...)").
   Checks: (1) no refusal toast / console error, every groove-* def of the pack is in the live registry next to the racks; (2) `.hook("groove-lazy(3)")` moves haps
   off the straight positions and the site events equal the strudel CLI events over 4 cycles. Usage: node tests/site/hooks_groove_pack.mjs [--no-cli] */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url'; import os from 'os';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const CLI = path.join(process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli', 'strudel');
const GR = JSON.parse(fs.readFileSync(path.join(SITE, 'data/phonk/grooves.json'), 'utf8')).defs, NAMES = Object.keys(GR);
const PROG = `setcpm(120/4)\natoms.import("pack:glyphcore/phonk:atoms")\n$: note("c3*16").s("triangle").decay(0.08).sustain(0).gain(0.4).hook("groove-lazy(3)")\n$: s("hh*16").gain(0.3).hook("groove-pocket(2)")\n$: s("bd*4").hook("groove-swing(66)")\n`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length - 1); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage(); const errors = [], logs = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/E_PACK_HOOKS|not loaded|allowlist/.test(m.text())) logs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(`http://127.0.0.1:${server.address().port}${PREFIX}`);
await page.waitForFunction(() => window.__sc && window.strudelCraft && window.strudelCraft.packs, null, { timeout: 60000 });
await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.__sc.Engine.load(); });
const site = await page.evaluate(async (code) => {
  window.strudelCraft.hooks.reset(); await window.__sc.Engine.idle(code); const pat = window.__sc.Engine.repl.state.pattern; if (!pat) return { err: JSON.stringify(window.__sc.Engine.state.evalError || 'no pattern').slice(0, 300) };
  const defs = Object.keys(JSON.parse(window.strudelCraft.hooks.toJSON()).defs || {}); const out = [];
  for (const h of pat.queryArc(0, 4)) if (h.hasOnset()) { const v = h.value || {}; out.push([+h.whole.begin, v.s, v.n ?? v.note, v.gain]); }
  const toasts = [...document.querySelectorAll('.toast, #toasts *, [role=status]')].map((e) => e.textContent).filter((t) => /hooks ingredient not loaded|hook def.*skipped|E_PACK_HOOKS/.test(t));
  return { defs, out, toasts };
}, PROG);
check('the groove presets load next to the racks: all defs of glyphcore/phonk:grooves are in the live registry, no E_PACK_HOOKS_INVALID toast or console line', !site.err && NAMES.every((n) => site.defs.includes(n)) && site.defs.includes('kick808') && site.toasts.length === 0 && logs.length === 0, site.err || `${NAMES.filter((n) => site.defs.includes(n)).length}/${NAMES.length} groove defs, ${site.defs.length} defs total, toasts ${site.toasts.length}, console ${logs.length}`);
const straight = (c) => Math.abs(c * 16 - Math.round(c * 16)) < 1e-6;
const lazy = (site.out || []).filter((e) => e[1] === 'triangle');
check('.hook("groove-lazy(3)") works on the site: 64 onsets in 4 cycles, most off the straight 16th positions', lazy.length === 64 && lazy.filter((e) => !straight(e[0])).length > 40, `${lazy.length} onsets, ${lazy.filter((e) => !straight(e[0])).length} off-grid`);
if (process.argv.includes('--no-cli') || !fs.existsSync(CLI)) console.log('SKIP  CLI comparison (--no-cli or no CLI at ' + CLI + ')');
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grv-')); const f = path.join(tmp, 'p.strudel.js'); fs.writeFileSync(f, PROG);
  const out = execFileSync(CLI, ['events', f, '--cycles', '4', '--packs', path.join(ROOT, 'site/packs.lock.json')], { env: { ...process.env, STRUDEL_CRAFT: ROOT }, maxBuffer: 1 << 28 }).toString();
  const cli = JSON.parse(out).events.map((e) => [e.cycle, e.s, e.n ?? e.note, e.gain]); // the CLI rounds cycle to 1e-6: pair by sound after sorting, compare cycle to 2e-6
  const ord = (a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])) || a[0] - b[0], X = [...cli].sort(ord), Y = site.out.map((e) => [...e]).sort(ord);
  const diff = X.length !== Y.length ? ['count'] : X.filter((x, i) => x[1] !== Y[i][1] || String(x[2]) !== String(Y[i][2]) || Math.abs(x[0] - Y[i][0]) > 2e-6 || Math.abs((x[3] ?? 0) - (Y[i][3] ?? 0)) > 1e-3);
  check('site and CLI give the same groove events over 4 cycles (cycle to 2e-6, sound, note, gain)', diff.length === 0 && cli.length > 140, `cli ${cli.length}, site ${site.out.length}, differing ${diff.length} ${JSON.stringify(diff.slice(0, 2))}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
// critic reproducer (round 4): the pack named in a comment, a groove def hooked: nothing invalid, no error toast, haps differ from the unhooked pattern
const rep = await page.evaluate(async () => {
  const E = window.__sc.Engine, ev = async (c) => { window.strudelCraft.hooks.reset(); await E.idle(c); const p = E.repl.state.pattern; return p ? p.queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => +h.whole.begin) : null; };
  const hooked = await ev('// glyphcore/phonk:\n$: s("hh*8").hook("groove-pocket")'), st = window.strudelCraft.packHooks.state(), plain = await ev('$: s("hh*8")');
  const toasts = [...document.querySelectorAll('.toast, #toasts *, [role=status]')].map((e) => e.textContent).filter((t) => /not loaded|skipped|E_PACK_HOOKS|allowlist/i.test(t));
  return { hooked, plain, invalid: st.invalid, nDefs: st.defs.length, toasts };
});
check('reproducer `// glyphcore/phonk:` + hook("groove-pocket"): packHooks.state().invalid empty, defs installed, no error toast', rep.invalid.length === 0 && rep.nDefs > 9 && rep.toasts.length === 0, JSON.stringify({ invalid: rep.invalid, nDefs: rep.nDefs, toasts: rep.toasts }).slice(0, 300));
check('the hooked groove changes the haps versus the unhooked pattern (16 onsets each, positions differ)', rep.hooked && rep.plain && rep.hooked.length === rep.plain.length && rep.hooked.some((x, i) => Math.abs(x - rep.plain[i]) > 1e-6), JSON.stringify({ h: (rep.hooked || []).slice(0, 4), p: (rep.plain || []).slice(0, 4) }));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
