// Playwright check for docs/CONTROL_BINDING.md at 360px: typed lpf( suggestions, controls without Play (and after reload),
// AST-bound value survives an unrelated edit, broken code is inert (no layout shift), rapid typing -> one compile.
// Usage: node tests/site/binding.mjs
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = []; const errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: '', body: '' }) : '[]' }));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

const CODE = `// binding test\n$: note("c3 e3 g3").s("sawtooth").lpf(slider(800, 20, 20000))._pianoroll()\n$: s("sawtooth*2").gain(ctl('vol', { type: 'fader', min: 0, max: 2 }))\n`;
const setDoc = (text) => page.evaluate((t) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, userEvent: 'input' }); }, text);
const cells = () => page.$$eval('#code ~ .cm-editor, .pc-inline .pc-cell', () => [...document.querySelectorAll('.pc-inline:not([hidden]) .pc-cell')].map((c) => c.dataset.site));
const stats = () => page.evaluate(() => ({ ...window.strudelCraft.settle.stats }));
const settle = () => page.waitForTimeout(1800);

await page.goto(BASE); await page.waitForFunction(() => document.documentElement.dataset.editor === 'cm6' && !!window.strudelCraft.createSettle, null, { timeout: 30000 });
await page.waitForSelector('#list li .row');
await setDoc(CODE);
await page.waitForFunction(() => document.querySelectorAll('.pc-inline .pc-cell').length === 2, null, { timeout: 60000 }).catch(() => {});
let c = await cells(); check('controls render from code without Play', c.length === 2, c.join(','));
// reload: on load, no Play
await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.editor === 'cm6', null, { timeout: 30000 }); await page.waitForFunction(() => document.querySelectorAll('.pc-inline .pc-cell').length === 2 && document.querySelector('.cm-editor canvas.sc-widget'), null, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(500);
const noPlay = await page.evaluate(() => ({ cells: document.querySelectorAll('.pc-inline .pc-cell').length, roll: !!document.querySelector('.cm-editor canvas.sc-widget'), painted: (() => { const c = document.querySelector('.cm-editor canvas.sc-widget'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })(), started: window.__sc.Engine.started, playing: window.__sc.S.playing }));
check('on load without Play: controls and pianoroll present, audio not started', noPlay.cells === 2 && noPlay.roll && noPlay.painted > 0 && !noPlay.started && !noPlay.playing, JSON.stringify(noPlay));
const ids0 = await cells();

// 1. typing inside lpf( offers numbers + knob controls, signature help bolds the param
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ selection: { anchor: v.state.doc.length } }); v.focus(); });
await page.keyboard.type('$: note("c2").lpf(', { delay: 30 });
await page.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 5000 }).catch(() => {});
const opts = await page.$$eval('.cm-tooltip-autocomplete li', (ls) => ls.map((l) => l.textContent));
const sigb = await page.$eval('.cm-sighelp .cm-sig-active', (b) => b.textContent).catch(() => '');
check('lpf( suggests frequency values and knob controls', opts.some((o) => /^800/.test(o)) && opts.some((o) => /^slider\(800, 20, 20000\)/.test(o)) && opts.some((o) => /^ctl\('lpf', \{ type: 'knob'/.test(o)) && !opts.some((o) => /^(stack|setcpm)/.test(o)), opts.slice(0, 6).join(' | '));
check('signature help highlights active param', sigb === 'frequency', sigb);
await page.keyboard.press('Escape');
await setDoc(CODE); await settle();

// play for the inert and settle checks
await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 });
await settle();
// 2. value survives an unrelated edit
const id = (await cells())[0];
check('site ids stable across reload', id === ids0[0], `${id} vs ${ids0[0]}`);
await page.evaluate((i) => { window.strudelCraft.perform.controls.set(i, 3000); window.strudelCraft.perform.renderInline(); }, id);
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, insert: 'setcpm(30)\n// unrelated\n' }, userEvent: 'input' }); });
await settle();
const after = await page.evaluate((i) => ({ v: window.strudelCraft.perform.controls.get(i), ids: [...document.querySelectorAll('.pc-inline .pc-cell')].map((c) => c.dataset.site) }), id);
check('control keeps value + id after an unrelated edit', after.v === 3000 && after.ids[0] === id, JSON.stringify(after));

// 3. broken code: audio + controls unchanged, no layout shift
const snap = () => page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); };
  return { boxes: [r('#code ~ .cm-editor, .editor .cm-editor'), r('.pc-inline'), r('#liveChip'), r('#playBtn')], evals: window.__sc.Engine.evalCount, pat: window.__sc.Engine.state.activeCode, cells: [...document.querySelectorAll('.pc-inline .pc-cell')].map((c) => c.dataset.site).join(), v: window.strudelCraft.perform.controls.get(document.querySelector('.pc-inline .pc-cell').dataset.site) }; });
const before = await snap();
await page.evaluate(() => { const v = document.getElementById('code').cmView; const t = v.state.doc.toString(); const i = t.indexOf('.lpf('); v.dispatch({ changes: { from: i + 4, to: i + 5, insert: ')' }, userEvent: 'input' }); });
await settle();
const broken = await snap(); const marks = await page.evaluate(() => ({ dot: document.querySelector('#liveChip').dataset.v, underline: !!document.querySelector('.cm-lintRange-error'), gutter: !!document.querySelector('.cm-lint-marker-error'), playing: window.__sc.S.playing }));
check('broken code: audio + controls unchanged, no layout shift', JSON.stringify(before) === JSON.stringify(broken) && marks.playing, JSON.stringify({ before, broken }));
check('broken code: gutter marker, underline, chip dot', marks.dot === 'invalid' && marks.underline && marks.gutter, JSON.stringify(marks));
await setDoc(CODE); await settle();

// 4. rapid typing -> one compile after settle
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ selection: { anchor: v.state.doc.line(1).to } }); v.focus(); });
const s0 = await stats(); await page.keyboard.type(' quick typing', { delay: 40 }); await settle(); const s1 = await stats();
check('rapid typing triggers one compile after settle', s1.compiles - s0.compiles === 1 && s1.pokes - s0.pokes >= 10, JSON.stringify({ compiles: s1.compiles - s0.compiles, pokes: s1.pokes - s0.pokes }));
await page.screenshot({ path: path.join(SITE, '../docs/screens/binding-360.png') });
const bad = errors.filter((e) => !/Failed to load resource|favicon/.test(e));
check('no console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close(); server.close();
const fail = checks.filter((x) => !x.ok).length; console.log(`${checks.length - fail}/${checks.length} passed`); process.exit(fail ? 1 : 0);
