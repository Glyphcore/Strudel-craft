// End-of-track parity (#139): the SAME programs through the site's Record panel resolver (browser, capture.resolveEnd) and the CLI
// (`strudel events IN --to-end`, stderr "end of track = bar N"), asserting the same take length in bars. Loop range is site only and not tested here.
// `node tests/site/record_length_parity.mjs` (needs the suno-track-lab CLI: SUNO_LAB, default /home/user/suno-track-lab; STRUDEL_CRAFT is this checkout).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), ROOT = path.join(REPO, 'site'), LAB = process.env.SUNO_LAB || '/home/user/suno-track-lab';
const require = createRequire(import.meta.url); let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const BASE = `http://localhost:${server.address().port}/index.html`;
let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const HEAD = 'hooks.def("lift", { chain: [["lpf", 400]] })\n', TAIL = 'note("c3 e3").s("sawtooth").use("fx")';
const FIX = [
  { name: 'gate 2b..4b beats marker end 6b', code: HEAD + 'hooks.bind("fx", "lift", "2b..4b")\nhooks.marker("end", "6b")\n' + TAIL, bars: 3, rule: 'gates' },
  { name: 'marker end 6b alone', code: HEAD + 'hooks.marker("end", "6b")\n' + TAIL, bars: 5, rule: 'marker' },
  { name: '@daw bars header ranks after gates and marker, before arrange', code: '// @daw bars=7\n' + HEAD + 'hooks.bind("fx", "lift", "1b..3b")\n' + TAIL, bars: 2, rule: 'gates' },
  { name: '@daw bars header alone', code: '// @daw bars=7\nnote("c3 e3").s("sawtooth").hook("lift")\n' + HEAD, bars: 7, rule: 'header' },
  { name: 'top-level unlabelled arrange total', code: 'arrange([2, s("bd")], [3, s("hh")])', bars: 5, rule: 'period' },
  { name: 'labelled lanes: longest arrange wins', code: '$: arrange([2, s("bd")], [2, s("hh")])\n$: arrange([4, s("cp")], [2, s("sd")])', bars: 6, rule: 'period' },
  { name: 'marker end 4.3b (fractional): site exact 3.5 bars, CLI rounds up', code: HEAD + 'hooks.marker("end", "4.3b")\n' + TAIL, bars: 3.5, cliBars: 4, rule: 'marker' },
];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
for (const [i, f] of FIX.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } }); const p = await ctx.newPage();
  await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await p.goto(BASE); await p.waitForSelector('#list li[data-id]'); await p.click('#list li[data-id] .row').catch(() => {});
  await p.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, f.code);
  await p.evaluate(() => window.__sc.play()); await p.waitForFunction(() => window.__sc.S.playing, null, { timeout: 90000 });
  const site = await p.evaluate(() => { const e = window.strudelCraft.capture.resolveEnd(); return { cycle: e.cycle, rule: e.rule }; }); await ctx.close();
  const file = path.join(tmp, `f${i}.strudel.js`); fs.writeFileSync(file, f.code);
  const r = spawnSync('node', [path.join(LAB, 'engine/strudel-cli/cli.mjs'), 'events', file, '--to-end'], { env: { ...process.env, STRUDEL_CRAFT: REPO }, encoding: 'utf8', timeout: 120000 });
  const m = /end of track = bar (\d+) \((\w+)\); (\d+) bars? from bar 1/.exec(r.stderr || ''); const cliBars = m ? +m[3] : null;
  ok(`${f.name}: site ${site.cycle} bars (${site.rule}) = CLI ${cliBars} (${m && m[2]})`, site.cycle === f.bars && site.rule === f.rule && cliBars === (f.cliBars || f.bars) && m[2] === f.rule, (r.stderr || '').split('\n').filter((l) => /to-end|Error/.test(l)).join(' | ').slice(0, 200));
}
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
