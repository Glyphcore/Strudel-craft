// #169: editor interactions follow VS Code. (1) literal popover stays inside the visual viewport (flip, clamp, re-place on scroll/resize),
// (2) it drags by its grab strip (mouse + touch), clamped, selection untouched, Alt+arrows nudge, double-click resets, reset on close,
// (3) pointerdown anywhere in the code area sets the caret within one frame on a cold load, every node type, (4) inlay hints are inline,
// not copied, not caret stops, no line-height change. Usage: node tests/site/editor_interact.mjs
import { createRequire } from 'module';
import { execFileSync } from 'node:child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
let bad = 0; const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
const cache = new Map(); const errors = [];
async function fresh(opts) { /* a cold page: new context, nothing cached by the browser */
  const ctx = await browser.newContext(opts); const p = await ctx.newPage();
  if (process.env.HTTPS_PROXY) await p.route(/esm\.sh|unpkg\.com|githubusercontent|jsdelivr/, (r) => { const u = r.request().url(); try { if (!cache.has(u)) cache.set(u, execFileSync('curl', ['-sL', u], { maxBuffer: 1e8 })); r.fulfill({ status: 200, contentType: u.endsWith('.json') ? 'application/json' : 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: cache.get(u) }); } catch (e) { r.abort(); } });
  await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: '', body: '' }) : '[]' }));
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE); await p.waitForFunction(() => document.documentElement.dataset.editor === 'cm6' && !!window.strudelCraft.literals, null, { timeout: 60000 });
  return p;
}
const setDoc = (p, text) => p.evaluate((t) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, selection: { anchor: 0 }, userEvent: 'input.paste' }); }, text);
const inside = (b, vw, vh, m = 7.5) => b && b.left >= m && b.top >= m && b.right <= vw - m && b.bottom <= vh - m;
const popBox = (p) => p.evaluate(() => { const e = document.querySelector('.lit-pop'); if (!e) return null; const r = e.getBoundingClientRect(); const v = window.visualViewport; return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: v.width, vh: v.height }; });

/* ---------- 1 + 2: popover placement and drag ---------- */
const FILL = Array.from({ length: 40 }, (_, i) => `// filler ${i}`).join('\n');
const POPCODE = `${FILL}\n$: note("c3 e3").s("sawtooth").lpf(800)\n`;
for (const [W, H, touch] of [[1280, 720, false], [390, 844, true]]) {
  const p = await fresh({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
  await setDoc(p, POPCODE); await p.waitForTimeout(800);
  const lid = await p.evaluate(() => { const l = window.strudelCraft.literals.list().find((x) => x.kind === 'number' && x.value === 800); return l && l.id; });
  /* put the token's line on the last visible line of the viewport */
  await p.evaluate(() => { document.body.style.paddingBottom = '2000px'; const v = document.getElementById('code').cmView; v.dispatch({ effects: v.constructor.scrollIntoView ? [] : [] }); const t = v.state.doc.toString().indexOf('lpf(800)'); v.dom.scrollIntoView({ block: 'center' }); const c = v.coordsAtPos(t); window.scrollBy(0, c.bottom - (innerHeight - 6)); });
  await p.waitForTimeout(200);
  const row = await p.evaluate(() => { const v = document.getElementById('code').cmView; const c = v.coordsAtPos(v.state.doc.toString().indexOf('lpf(800)')); return { top: c.top, bottom: c.bottom, vh: innerHeight }; });
  await p.evaluate((id) => window.strudelCraft.literals.open(id), lid); await p.waitForSelector('.lit-pop', { timeout: 5000 }); await p.waitForTimeout(300);
  let b = await popBox(p);
  check(`[${W}] popover on a token in the last visible line is fully inside the viewport`, inside(b, b.vw, b.vh) && row.bottom > row.vh - 60, JSON.stringify({ row, b }));
  const covers = b.top < row.bottom && b.bottom > row.top; check(`[${W}] popover does not cover the token line when there is room (flipped above)`, !covers, JSON.stringify({ row, b }));
  await p.evaluate(() => window.scrollBy(0, 120)); await p.waitForTimeout(250); b = await popBox(p);
  check(`[${W}] page scrolled with the popover open: still inside the viewport`, inside(b, b.vw, b.vh), JSON.stringify(b));
  const W2 = Math.round(W * 0.7), H2 = Math.round(H * 0.6); await p.setViewportSize({ width: W2, height: H2 }); await p.waitForTimeout(350); b = await popBox(p);
  check(`[${W}] window resized while open: inside the new viewport`, inside(b, b.vw, b.vh), JSON.stringify(b));
  await p.setViewportSize({ width: W, height: H }); await p.evaluate(() => window.scrollBy(0, -120)); await p.waitForTimeout(350);
  b = await popBox(p); const sel0 = await p.evaluate(() => document.getElementById('code').cmView.state.selection.main.head); let start = b; await p.keyboard.press('Escape'); await p.evaluate((id) => window.strudelCraft.literals.open(id), lid); await p.waitForSelector('.lit-pop'); await p.waitForTimeout(300); start = await popBox(p); /* offset-0 reference after the scroll/resize round trip */
  const grip = async () => { const r = await p.evaluate(() => { const r = document.querySelector('.lit-head').getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; }); return r; };
  const cdp = touch ? await p.context().newCDPSession(p) : null;
  const drag = async (dx, dy) => { const g = await grip(); if (touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [g] }); for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x + dx * i / 8, y: g.y + dy * i / 8 }] }); await p.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x + dx, g.y + dy, { steps: 8 }); await p.mouse.up(); } await p.waitForTimeout(120); return popBox(p); };
  const s = 40; let m = await drag(-s, -s); check(`[${W}] ${touch ? 'touch' : 'mouse'} drag moves the popover`, Math.abs(m.left - (start.left - s)) < 3 || m.left < start.left || m.top < start.top, JSON.stringify({ start, m }));
  const L = await drag(-3000, 0), T = await drag(0, -3000); let R = await drag(3000, 0), Bt = await drag(0, 3000);
  check(`[${W}] drag clamps at left/top/right/bottom edges`, L.left >= 7.5 && T.top >= 7.5 && R.right <= R.vw - 7.5 && Bt.bottom <= Bt.vh - 7.5 && L.left < 12 && T.top < 12, JSON.stringify({ L: L.left, T: T.top, R: R.vw - R.right, B: Bt.vh - Bt.bottom }));
  const sel1 = await p.evaluate(() => document.getElementById('code').cmView.state.selection.main.head);
  check(`[${W}] drag does not change the editor selection`, sel0 === sel1, `${sel0} ${sel1}`);
  await p.evaluate(() => document.querySelector('.lit-head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await p.waitForTimeout(100); let r0 = await popBox(p);
  check(`[${W}] double-click on the strip snaps back`, Math.abs(r0.left - start.left) < 2 && Math.abs(r0.top - start.top) < 2, JSON.stringify({ start, r0 }));
  await drag(-30, -20); const moved = await popBox(p); await p.evaluate((id) => window.strudelCraft.literals.set(id, '900'), lid); await p.waitForTimeout(300); const after = await popBox(p);
  check(`[${W}] popover keeps its position while the value is edited`, Math.abs(after.left - moved.left) < 2 && Math.abs(after.top - moved.top) < 2, JSON.stringify({ moved, after }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100); const closed = await p.$('.lit-pop');
  await p.evaluate((id) => window.strudelCraft.literals.open(id), lid); await p.waitForSelector('.lit-pop'); await p.waitForTimeout(300); const re = await popBox(p);
  check(`[${W}] offset resets on close (reopen at the placed position)`, !closed && Math.abs(re.left - start.left) < 2 && Math.abs(re.top - start.top) < 2, JSON.stringify({ start, re }));
  await p.evaluate(() => { const f = document.querySelector('.lit-pop input'); if (f) f.focus(); }); const a0 = await popBox(p);
  await p.keyboard.down('Alt'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Alt'); await p.waitForTimeout(100); const a1 = await popBox(p);
  check(`[${W}] Alt+arrows nudge the popover`, a1.left < a0.left - 8 && a1.top < a0.top - 8, JSON.stringify({ a0, a1 }));
  await p.context().close();
}

/* ---------- 3: caret on pointerdown, cold load, every node type ---------- */
const CARET = `$: note("c3 e3 g3").s("sawtooth").lpf(800)\n\n$: s("bd*4").gain(0.8)\n`;
const probe = () => { window.__p = []; document.addEventListener('pointerdown', (e) => { const v = document.getElementById('code').cmView; const rec = { t: e.timeStamp, type: e.pointerType }; window.__p.push(rec); requestAnimationFrame((now) => { rec.head = v.state.selection.main.head; rec.empty = v.state.selection.main.empty; rec.dt = Math.round(performance.now() - (e.timeStamp)); requestAnimationFrame(() => requestAnimationFrame(() => { const c = document.querySelector('#code ~ .cm-editor .cm-cursor, .cm-editor .cm-cursor'); const r = c && c.getBoundingClientRect(); rec.cursor = !!(r && r.height > 2) && v.hasFocus; })); }); }, true); };
const KINDS = {
  'plain text (note)': (d) => ({ at: d.indexOf('note') + 2, exp: d.indexOf('note') + 2 }),
  'mini-notation token (e3)': (d) => ({ at: d.indexOf('e3') + 1, exp: d.indexOf('e3') + 1 }),
  'string literal (sawtooth)': (d) => ({ at: d.indexOf('sawtooth') + 3, exp: d.indexOf('sawtooth') + 3 }),
  'number literal widget (800)': (d) => ({ at: d.indexOf('800') + 1, exp: d.indexOf('800') + 1 }),
  'number literal widget (0.8)': (d) => ({ at: d.indexOf('0.8') + 2, exp: d.indexOf('0.8') + 2 }),
  'end of line': (d) => ({ eol: 0, exp: d.indexOf('\n') }),
  'empty line': (d) => ({ empty: 1, exp: d.indexOf('\n') + 1 }),
  'gutter-adjacent padding': (d) => ({ pad: 2, exp: d.indexOf('\n') + 2 }),
  'inlay hint': (d) => ({ inlay: 0 }),
};
for (const name of Object.keys(KINDS)) {
  const p = await fresh({ viewport: { width: 1280, height: 720 } });
  await setDoc(p, CARET); await p.evaluate(() => document.getElementById('code').cmView.dom.scrollIntoView({ block: 'center' }));
  if (name === 'inlay hint') await p.waitForSelector('.cm-inlay', { timeout: 15000 }).catch(() => {}); else await p.waitForTimeout(600);
  await p.evaluate(probe);
  const target = await p.evaluate(([k, spec]) => { const v = document.getElementById('code').cmView; const d = v.state.doc.toString(); const s = spec; let pt, exp = s.exp;
    if (s.at != null) { const c = v.coordsAtPos(s.at); pt = { x: c.left + 1, y: (c.top + c.bottom) / 2 }; }
    else if (s.eol != null) { const l = v.state.doc.line(1); const c = v.coordsAtPos(l.to); pt = { x: Math.min(c.left + 60, v.contentDOM.getBoundingClientRect().right - 10), y: (c.top + c.bottom) / 2 }; }
    else if (s.empty != null) { const l = v.state.doc.line(2); const c = v.coordsAtPos(l.from); pt = { x: c.left + 40, y: (c.top + c.bottom) / 2 }; }
    else if (s.pad != null) { const l = v.state.doc.line(1); const c = v.coordsAtPos(l.from); pt = { x: c.left - 4, y: (c.top + c.bottom) / 2 }; exp = l.from; }
    else { const h = document.querySelector('.cm-inlay'); if (!h) return null; const r = h.getBoundingClientRect(); pt = { x: r.left + 6, y: r.top + r.height / 2 }; exp = v.posAtDOM(h); }
    return { pt, exp }; }, [name, KINDS[name](CARET)]);
  if (!target) { check(`caret: ${name}`, false, 'target not rendered'); await p.context().close(); continue; }
  await p.mouse.move(target.pt.x, target.pt.y); await p.mouse.down(); await p.waitForTimeout(250); await p.mouse.up(); await p.waitForTimeout(400);
  const r = await p.evaluate(() => window.__p[0] || {}); const fin = await p.evaluate(() => document.getElementById('code').cmView.state.selection.main.head);
  check(`caret: ${name}: selection at the expected offset one frame after pointerdown, caret rendered (cold load)`, r.head === target.exp && r.empty && r.cursor && fin === target.exp, JSON.stringify({ exp: target.exp, ...r, fin, t: undefined }));
  console.log(`      ${name}: pointerdown -> selection set ${r.dt} ms (first frame), caret painted: ${r.cursor}`);
  await p.context().close();
}
{ /* touch: selection on pointerdown too (previously waited for the compatibility mousedown after touchend) */
  const p = await fresh({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await setDoc(p, CARET); await p.evaluate(() => document.getElementById('code').cmView.dom.scrollIntoView({ block: 'center' })); await p.waitForTimeout(600); await p.evaluate(probe);
  const pt = await p.evaluate(() => { const v = document.getElementById('code').cmView; const d = v.state.doc.toString(); const c = v.coordsAtPos(d.indexOf('sawtooth') + 3); return { x: c.left + 1, y: (c.top + c.bottom) / 2, exp: d.indexOf('sawtooth') + 3 }; });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] }); await p.waitForTimeout(250);
  const mid = await p.evaluate(() => window.__p[0]); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(400);
  const r = await p.evaluate(() => window.__p[0]); const fin = await p.evaluate(() => { const c = document.querySelector('.cm-focused .cm-cursor'); const b = c && c.getBoundingClientRect(); return { cursor: !!(b && b.height > 2), head: document.getElementById('code').cmView.state.selection.main.head }; });
  check('caret: touch tap on a string: selection set on pointerdown (finger still down), caret rendered after the tap', r.type === 'touch' && mid.head === pt.exp && r.cursor && fin.cursor, JSON.stringify({ exp: pt.exp, mid: mid.head, cursor: r.cursor, fin }));
  await p.context().close();
}
{ /* inline widget kinds: the ghost chip still accepts, the pianoroll widget takes the caret */
  const p = await fresh({ viewport: { width: 1280, height: 720 } });
  await setDoc(p, `$: note("c3 e3").s("sawtooth")\n  ._pianoroll()\n$: s("bd")\n`); await p.evaluate(() => document.getElementById('code').cmView.dom.scrollIntoView({ block: 'center' }));
  await p.waitForSelector('.cm-sc-widget', { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(500); await p.evaluate(probe);
  const w = await p.evaluate(() => { const e = document.querySelector('.cm-sc-widget'); if (!e) return null; const r = e.getBoundingClientRect(); const v = document.getElementById('code').cmView; return { x: r.left + r.width / 2, y: r.top + r.height / 2, line2End: v.state.doc.line(2).to }; });
  if (!w) check('caret: pianoroll inline widget', false, 'widget not rendered'); else {
    await p.mouse.click(w.x, w.y); await p.waitForTimeout(500); const r = await p.evaluate(() => window.__p[0]);
    check('caret: click on the pianoroll inline widget places the caret (line end of its calling line) on pointerdown', r.head === w.line2End && r.cursor, JSON.stringify({ exp: w.line2End, head: r.head, cursor: r.cursor })); }
  await p.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' } }); v.dom.scrollIntoView({ block: 'center' }); v.focus(); }); await p.keyboard.type('$: s("bd").lpf(800)', { delay: 20 });
  await p.waitForSelector('.cm-ghost-tab', { timeout: 6000 }).catch(() => {}); const chip = await p.evaluate(() => { const e = document.querySelector('.cm-ghost-tab'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, before: document.getElementById('code').cmView.state.doc.length }; });
  if (!chip) check('caret: ghost Tab chip', false, 'no ghost'); else { await p.evaluate(probe); await p.mouse.click(chip.x, chip.y); await p.waitForTimeout(300); const after = await p.evaluate(() => document.getElementById('code').cmView.state.doc.length); check('ghost Tab chip: the tap still accepts (caret placed beside it first)', after > chip.before, `${chip.before} -> ${after}`); }
  await p.context().close();
}

/* ---------- 4: inlay hints ---------- */
{
  const p = await fresh({ viewport: { width: 1280, height: 720 } });
  const base = `$: note("c3 e3").s("sawtooth").lpf(800)\n$: s("bd").gain(0.8)\n`;
  await p.evaluate(() => document.getElementById('code').cmView.dom.scrollIntoView({ block: 'center' }));
  const lh = () => p.evaluate(() => { const v = document.getElementById('code').cmView; const ls = [...v.dom.querySelectorAll('.cm-line')].slice(0, 2); return ls.map((l) => ({ lh: getComputedStyle(l).lineHeight, rows: Math.round(l.getBoundingClientRect().height / (parseFloat(getComputedStyle(l).lineHeight) || 22)), h: Math.round(l.getBoundingClientRect().height * 10) / 10 })); });
  await p.evaluate(() => window.strudelCraft.intellisense.inlayHints.enabled(false)); await setDoc(p, base); await p.waitForTimeout(700); const h0 = await lh(); const a0 = await p.evaluate(() => { const v = document.getElementById('code').cmView; const gs = [...v.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter((g) => /^\d+$/.test(g.textContent) && g.getBoundingClientRect().height > 0); return [...v.dom.querySelectorAll('.cm-line')].slice(0, 2).map((l, i) => gs[i] ? gs[i].getBoundingClientRect().top - l.getBoundingClientRect().top : 99); }); const n0 = await p.$$eval('.cm-inlay', (e) => e.length);
  await p.evaluate(() => window.strudelCraft.intellisense.inlayHints.enabled(true)); await setDoc(p, base + ' '); await p.waitForSelector('.cm-inlay', { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(400); const h1 = await lh();
  const info = await p.evaluate(() => { const v = document.getElementById('code').cmView; const hs = [...v.dom.querySelectorAll('.cm-inlay')]; const txt = hs.map((h) => h.dataset.hint); const h = hs.find((x) => x.dataset.hint.startsWith('freq')) || hs[0];
    const before = h && h.nextSibling ? h.nextSibling.textContent : ''; const cs = h && getComputedStyle(h, '::before'); const r = h && h.getBoundingClientRect(); const inline = h && getComputedStyle(h).display === 'inline';
    const gs = [...v.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter((g) => /^\d+$/.test(g.textContent) && g.getBoundingClientRect().height > 0); const ls = [...v.dom.querySelectorAll('.cm-line')]; const align = ls.slice(0, 2).map((l, i) => gs[i] ? gs[i].getBoundingClientRect().top - l.getBoundingClientRect().top : 99);
    return { n: hs.length, txt, inline, sel: cs && cs.userSelect, bg: cs && cs.backgroundColor, w: r && r.width, align, content: v.dom.querySelector('.cm-content').textContent.includes('freq'), docHas: v.state.doc.toString().includes('freq') }; });
  check('inlay hints: parameter names appear inline before literal arguments', n0 === 0 && info.n >= 2 && info.inline && info.w > 10, JSON.stringify({ n0, ...info }));
  check('inlay hints: no line-height change (every row keeps the line height) and line numbers stay aligned with their lines', h0[1].h === h1[1].h && h0[0].lh === h1[0].lh && Math.abs(h1[0].h / h1[0].rows - h0[0].h / h0[0].rows) < 1 && info.align.every((d, i) => Math.abs(d - a0[i]) < 2), JSON.stringify({ h0, h1, align: info.align }));
  check('inlay hints: muted text with a rounded background, user-select none, text not in the DOM text or the document', info.sel === 'none' && /(rgba?|color)\(/.test(info.bg) && !info.content && !info.docHas, JSON.stringify(info));
  /* copy: select everything, copy, the clipboard text is the document */
  const copied = await p.evaluate(async () => { const v = document.getElementById('code').cmView; v.focus(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); let data = ''; const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }); v.contentDOM.dispatchEvent(ev); data = ev.clipboardData.getData('text/plain'); return { data, doc: v.state.doc.toString() }; });
  check('inlay hints: excluded from copy', copied.data === copied.doc && !/freq|gain:|:\s*800/.test(copied.data.replace(/gain\(/, '')), JSON.stringify(copied).slice(0, 160));
  /* caret stops: walking right through `lpf(800)` visits each doc offset exactly once, and the caret never sits "inside" a hint */
  const walk = await p.evaluate(() => { const v = document.getElementById('code').cmView; const d = v.state.doc.toString(); const a = d.indexOf('lpf(') + 3; v.focus(); v.dispatch({ selection: { anchor: a } }); return { a, d: d.length }; });
  const seen = []; for (let i = 0; i < 6; i++) { await p.keyboard.press('ArrowRight'); seen.push(await p.evaluate(() => document.getElementById('code').cmView.state.selection.main.head)); }
  check('inlay hints: ArrowRight moves one document character per press (no stops on hints)', seen.every((x, i) => x === walk.a + i + 1), JSON.stringify({ a: walk.a, seen }));
  await p.context().close();
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(bad ? `${bad} FAILED` : 'ALL PASS'); process.exit(bad ? 1 : 0);
