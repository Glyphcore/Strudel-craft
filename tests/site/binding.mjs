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
const settleLive = async () => { await page.waitForTimeout(600); await page.waitForFunction(() => !window.strudelCraft.settle.pending().length, null, { timeout: 5000 }); await page.waitForTimeout(3200); }; /* a live swap waits for the next cycle boundary */

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

// 5. smart literal editors (CONTROL_BINDING section 7)
const LIT = `$: note("<[c3,e3,g3] [a2,c3]>").s("sawtooth").lpf(800).vowel("a")\n`;
await setDoc(LIT); await settle();
const at = async (needle, k = 1) => { await page.evaluate(() => document.getElementById('code').cmView.dom.scrollIntoView({ block: 'center' })); await page.waitForTimeout(600); return page.evaluate(([n, k]) => { const v = document.getElementById('code').cmView; const i = v.state.doc.toString().indexOf(n) + k; const c = v.coordsAtPos(i); const vv = window.visualViewport || { offsetLeft: 0, offsetTop: 0 }; return { x: c.left + 1 - vv.offsetLeft, y: (c.top + c.bottom) / 2 - vv.offsetTop }; }, [needle, k]); }; /* touch input is in visual-viewport coordinates */
const cdp = await page.context().newCDPSession(page); /* real touch input: pointer events of type touch, like a phone */
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const tap = async (pt) => { await touch('touchStart', pt.x, pt.y); await page.waitForTimeout(40); await touch('touchEnd'); await page.waitForTimeout(80); };
const docText = () => page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
{ const c0 = await stats(); const p0 = await at('800', 1); await touch('touchStart', p0.x, p0.y);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', p0.x + i * 8, p0.y); await page.waitForTimeout(16); }
  const mid = await docText(); await touch('touchEnd'); await settle(); const end = await docText(); const c1 = await stats();
  const m = /lpf\(([\d.]+)\)/.exec(end);
  check('drag on lpf(800) scrubs: source unchanged mid-gesture, one rewrite + one compile after release', mid.includes('lpf(800)') && m && +m[1] > 800 && +m[1] <= 20000 && c1.compiles - c0.compiles === 1, JSON.stringify({ now: m && m[1], compiles: c1.compiles - c0.compiles })); }
{ const p1 = await at('vowel("a', 7); await tap(p1); await page.waitForSelector('.lit-pop[data-editor="combobox"]', { timeout: 3000 }).catch(() => {});
  const ed = await page.getAttribute('.lit-pop', 'data-editor').catch(() => null); await page.click('.lit-pop .lit-opt[data-v="o"]').catch(() => {}); await settle();
  check('vowel("a") opens an enum combobox; picking o rewrites only that literal', ed === 'combobox' && (await docText()).includes('vowel("o")') && (await docText()).includes('lpf('), ed); }
{ const p2 = await at('e3', 1); await tap(p2); await page.waitForSelector('.lit-pop[data-editor="chips"]', { timeout: 3000 }).catch(() => {});
  const ed = await page.getAttribute('.lit-pop', 'data-editor').catch(() => null); const box0 = await page.evaluate(() => document.querySelector('.cm-editor').getBoundingClientRect().height);
  await page.click('.lit-pop .lit-chip[data-v="b3"]').catch(() => {}); await settle(); const t = await docText();
  check('chord token opens a multiselect; adding b3 rewrites the chord group', ed === 'chips' && t.includes('[c3,e3,g3,b3]') && t.includes('[a2,c3]'), JSON.stringify({ ed, t: t.slice(0, 60), box0 })); await page.keyboard.press('Escape'); }
await page.evaluate(() => window.strudelCraft.literals.close());
// note editor applies live: octave change rewrites the literal at once, keeping pitch class and accidental
{ await setDoc(`$: note("eb3 g3").s("sawtooth")\n`); await settle(); const c0 = await stats();
  const pn = await at('eb3', 1); await tap(pn); await page.waitForSelector('.lit-pop[data-editor="piano"]', { timeout: 3000 }).catch(() => {});
  await page.click('#litOctUp').catch(() => {}); await page.waitForTimeout(100); const t1 = await docText(); const shown = await page.textContent('.lit-pop .lit-val').catch(() => '');
  await page.click('#litOctUp').catch(() => {}); await settle(); const t2 = await docText(); const c1 = await stats(); const open = await page.$('.lit-pop[data-editor="piano"]');
  check('note editor: octave + applies to the source at once (eb3 -> eb4 -> eb5), no confirm tap; one compile after settle', t1.includes('note("eb4 g3")') && shown === 'eb4' && t2.includes('note("eb5 g3")') && !!open && c1.compiles - c0.compiles === 1, JSON.stringify({ t1: t1.slice(0, 22), shown, t2: t2.slice(0, 22), compiles: c1.compiles - c0.compiles })); }
await page.evaluate(() => window.strudelCraft.literals.close());
await setDoc(CODE); await settle();

// 8. node-aware accept (CONTROL_BINDING section 10): ghost Tab and popup accept replace/merge the node, never duplicate; one undo step
{ const caseG = async (doc, caret, ghost) => { await setDoc(doc); await page.evaluate(([c, g]) => { const v = document.getElementById('code').cmView; v.focus(); v.dispatch({ selection: { anchor: c } }); window.strudelCraft.intellisense.ghost.show(v, g); }, [caret, ghost]); await page.keyboard.press('Tab'); await page.waitForTimeout(80); return docText(); };
  const R = {};
  R.prefix = await caseG('$: n("0").lp\n', 12, 'f(800)');
  R.complete = await caseG('$: n("0").lpf(800)\n', 13, '(800)');
  R.parens = await caseG('$: n("0").lpf()\n', 13, '(800)');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(80); R.undo = await docText();
  R.chain = await caseG('$: n("0").lpf(800).decay(0.1)\n', 18, '.decay(0.1)');
  // popup: caret mid-token "lp|f" picks lpf; caret in an arg value swaps it
  const caseP = async (doc, caret, pick) => { await setDoc(doc); await page.evaluate((c) => { const v = document.getElementById('code').cmView; v.focus(); v.dispatch({ selection: { anchor: c } }); window.strudelCraft.intellisense.startCompletion(v); }, caret); await page.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 3000 }).catch(() => {});
    const ok = await page.evaluate((p) => { const li = [...document.querySelectorAll('.cm-tooltip-autocomplete li')].find((l) => l.textContent.startsWith(p)); if (li) { li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); li.click(); } return !!li; }, pick); await page.waitForTimeout(120); return ok ? docText() : 'no option ' + pick; };
  R.mid = await caseP('$: n("0").lpf(800)\n', 12, 'lpf');
  R.swap = await caseP('$: n("0").lpf(800)\n', 15, '2000');
  check('accept: prefix partial lp + f(800) -> lpf(800)', R.prefix.startsWith('$: n("0").lpf(800)\n'), R.prefix);
  check('accept: already-complete token is a no-op (no duplicate)', R.complete.startsWith('$: n("0").lpf(800)\n'), R.complete);
  check('accept: existing parens merge (lpf() + (800) -> lpf(800))', R.parens.startsWith('$: n("0").lpf(800)\n'), R.parens);
  check('accept: chained call already present is not re-inserted', R.chain.startsWith('$: n("0").lpf(800).decay(0.1)\n'), R.chain);
  check('accept: one undo step restores the pre-accept text', R.undo.startsWith('$: n("0").lpf()\n'), R.undo.slice(0, 40));
  check('accept: caret mid-token (lp|f) picks lpf without duplicating', R.mid.startsWith('$: n("0").lpf(800)\n'), R.mid);
  check('accept: caret in an arg value swaps the value (800 -> 2000)', R.swap.startsWith('$: n("0").lpf(2000)\n'), R.swap);
  await setDoc(CODE); await settle(); }

// 7. range spec (CONTROL_BINDING section 9): type 5000 into a 0..1 slider, "Extend range to fit" widens it and persists per id
{ await setDoc(`$: note("c3").s("sawtooth").gain(slider(0.5, 0, 1))\n`); await settle();
  await page.evaluate(() => document.querySelector('.pc-inline').scrollIntoView({ block: 'center' })); await page.waitForTimeout(600);
  const v = await page.evaluate(() => { const e = document.querySelector('.pc-inline .pc-cell .pc-val'); const r = e.getBoundingClientRect(); const vv = window.visualViewport; return { x: r.left + r.width / 2 - vv.offsetLeft, y: r.top + r.height / 2 - vv.offsetTop, id: e.closest('.pc-cell').dataset.site }; });
  await tap(v); await page.waitForSelector('#pfNum', { timeout: 3000 }).catch(() => {});
  await page.fill('#pfNum', '5000').catch(() => {}); const hint = await page.textContent('#pfNumHint').catch(() => ''); await page.click('#pfExtend').catch(() => {}); await page.waitForTimeout(300);
  const r = await page.evaluate((id) => { const C = window.strudelCraft.perform.controls; const s = C.declare(id); return { min: s.min, max: s.max, v: C.get(id), saved: (window.strudelCraft.perform.model().ranges || {})[id], hint: document.querySelector(`.pc-inline .pc-cell[data-site="${id}"] .pc-range`)?.textContent }; }, v.id);
  check('typing 5000 into a 0..1 slider offers and applies "Extend range to fit" (persisted per id)', r.min === 0 && r.max >= 5000 && r.v === 5000 && r.saved && r.saved.max >= 5000 && /5000/.test(r.hint || '') && /outside|clamps/.test(hint || ''), JSON.stringify({ ...r, hint2: hint }));
  const pv = await page.evaluate(() => { const p = window.strudelCraft.perform.controls.parseValue; return [p('1.5k', { unit: 'Hz' }), p('-6 dB', { unit: 'dB' }), p('2:30'), p('250ms', { unit: 's' })]; });
  check('unit-aware parsing: 1.5k Hz, -6 dB, 2:30, 250ms', JSON.stringify(pv) === '[1500,-6,150,0.25]', JSON.stringify(pv));
  await setDoc(CODE); await settle(); }

// 6. reference inspector (CONTROL_BINDING section 8): long-press a knob -> tooltip id + path, source span marked; tap a literal -> its control glows
{ await page.evaluate(() => document.querySelector('.pc-inline').scrollIntoView({ block: 'center' })); await page.waitForTimeout(600);
  const k = await page.evaluate(() => { const e = document.querySelector('.pc-inline .pc-cell [role=slider]'); const r = e.getBoundingClientRect(); const vv = window.visualViewport; return { x: r.left + r.width / 2 - vv.offsetLeft, y: r.top + r.height / 2 - vv.offsetTop, id: e.closest('.pc-cell').dataset.site }; });
  await touch('touchStart', k.x, k.y); await page.waitForTimeout(700); await touch('touchEnd'); await page.waitForTimeout(150);
  const t = await page.evaluate(() => { const tip = document.getElementById('scRefTip'); const dd = (n) => tip && tip.querySelector(`dd[data-k="${n}"]`)?.textContent; const pm = document.querySelector('.cm-ref-primary');
    return { shown: !!tip && !tip.hidden, id: dd('id'), path: dd('path'), described: !!document.querySelector('[aria-describedby="scRefTip"]'), span: pm ? [...document.querySelectorAll('.cm-ref-primary')].map((x) => x.textContent).join('') : '', gutter: !!document.querySelector('.cm-ref-gutter') }; });
  check('long-press a knob: tooltip shows id + path, source span highlighted with gutter mark', t.shown && t.id === k.id && /^L\d+\//.test(t.path || '') && t.described && /^slider\(800/.test(t.span) && t.gutter, JSON.stringify(t));
  await page.keyboard.press('Escape'); await page.evaluate(() => window.strudelCraft.refs.clear());
  const p3 = await at('slider(800', 8); await tap(p3); await page.waitForTimeout(250);
  const g = await page.evaluate(() => [...document.querySelectorAll('.pc-inline .pc-cell.ref-glow, .pc-inline .ref-glow')].map((e) => e.closest('.pc-cell')?.dataset.site));
  check('tap a literal in the code: its control glows', g.includes(k.id), JSON.stringify(g));
  await page.evaluate(() => { window.strudelCraft.literals.close(); window.strudelCraft.refs.clear(); window.strudelCraft.refs.hideTip(); }); }

// play for the inert and settle checks
await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 60000 });
await settleLive();
// 2. value survives an unrelated edit
const id = (await cells())[0];
check('site ids stable across reload', id === ids0[0], `${id} vs ${ids0[0]}`);
await page.evaluate((i) => { window.strudelCraft.perform.controls.set(i, 3000); window.strudelCraft.perform.renderInline(); }, id);
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, insert: '// unrelated\n' }, userEvent: 'input' }); });
await settleLive();
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
await setDoc(CODE); await settleLive();

// 4. rapid typing -> one compile after settle
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ selection: { anchor: v.state.doc.line(1).to } }); v.focus(); });
const s0 = await stats(); await page.keyboard.type(' quick typing', { delay: 40 }); await settleLive(); const s1 = await stats();
check('rapid typing triggers one compile after settle', s1.compiles - s0.compiles === 1 && s1.pokes - s0.pokes >= 10, JSON.stringify({ compiles: s1.compiles - s0.compiles, pokes: s1.pokes - s0.pokes }));
await page.screenshot({ path: path.join(SITE, '../docs/screens/binding-360.png') });
const bad = errors.filter((e) => !/Failed to load resource|favicon/.test(e));
check('no console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close(); server.close();
const fail = checks.filter((x) => !x.ok).length; console.log(`${checks.length - fail}/${checks.length} passed`); process.exit(fail ? 1 : 0);
