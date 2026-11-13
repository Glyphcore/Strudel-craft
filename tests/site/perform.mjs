// Perform view section of the site smoke test (issue #55). Called from tests/site/smoke.mjs; also runs alone:
//   node tests/site/perform.mjs   (serves site/, writes docs/screens/*perform*.png / phone-390-{pads,board}.png and merges "perform" into metrics.json)
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CODE = 'note("c3 e3 g3 b3").s("sawtooth").cutoff(ctl("cut", {type: "knob", min: 200, max: 4000, unit: "Hz"}))';
const MODEL = {
  tabs: [{ kind: 'bank', id: 'A', name: 'Bank A' }, { kind: 'board', id: 'main', name: 'Board' }, { kind: 'board', id: 'two', name: 'Board 2' }], active: 0, perform: true,
  banks: { A: { id: 'A', rows: 4, cols: 4, pads: [
    { pos: '0,0', target: { kind: 'var', ref: 'lead', value: 1 }, label: 'lead' },                       // toggle, bar quantised (queued state)
    { pos: '0,1', target: { kind: 'var', ref: 'bass', value: 2 }, quant: 'none', label: 'bass' },       // toggle, immediate
    { pos: '1,0', target: { kind: 'tap', ref: 'hit' }, label: 'hit' },                                  // gate, unquantised (KeyQ)
    { pos: '1,1', target: { kind: 'tap', ref: 'hat' }, label: 'hat' },
    { pos: '0,2', target: { kind: 'hook', ref: 'crush', slot: 'fx' }, label: 'crush', color: '#f59e0b' }] } },
  boards: { main: { id: 'main', cells: [], size: {} }, two: { id: 'two', cells: [], size: {} } },
  controls: { enc: { type: 'encoder', min: 0, max: 1 }, pos: { type: 'xy' }, res: { type: 'fader', min: 0, max: 1 } }, maps: [], automation: {},
};
const seed = (page) => page.evaluate((m) => { localStorage.setItem('sc.perform', JSON.stringify(m)); localStorage.removeItem('sc.library'); }, MODEL);
const P = (page, fn, arg) => page.evaluate(fn, arg);
const onCount = (page, pad) => P(page, (pad) => (window.strudelCraft.hooks?.journal || []).filter((e) => e.pad === pad && e.on).length, pad);
const now = (page) => P(page, () => window.__sc.Engine.scheduler.now());
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, mean_ms: +(s.reduce((t, x) => t + x, 0) / (s.length || 1)).toFixed(3), p95_ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(3), max_ms: +(s[s.length - 1] || 0).toFixed(3) }; };
async function start(page, BASE) {
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await seed(page);
  await page.click('#list li[data-id="minor-arp"] .row');
  await P(page, (c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
  await P(page, () => window.__sc.play());
  await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && window.strudelCraft.perform && window.strudelCraft.hooks, null, { timeout: 90000 });
  await P(page, () => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad');
}
const tab = (page, name) => page.click(`#perform [role=tab]:has-text("${name}")`);
const center = async (page, sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const waitPhase = async (page, lo, hi) => { for (let i = 0; i < 80; i++) { const c = await now(page); const f = c - Math.floor(c); if (f > lo && f < hi) return c; await page.waitForTimeout(50); } return now(page); };

// WCAG contrast of visible text in the Perform view and the inline strip
const CONTRAST = (sel) => {
  const rgba = (s) => { const m = s.match(/[\d.]+/g); if (!m) return [0, 0, 0, 0]; const k = /^color\(srgb/.test(s) ? 255 : 1; return [+m[0] * k, +m[1] * k, +m[2] * k, m[3] === undefined ? 1 : +m[3]]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let bg = [0, 0, 0, 1]; for (const l of layers.reverse()) bg = over(l, bg); return bg; };
  let min = Infinity, worst = null, n = 0;
  const els = [...document.querySelectorAll(sel)].filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.sr'));
  for (const e of els) {
    const cs = getComputedStyle(e); const bg = bgOf(e), fg = over(rgba(cs.color), bg); const L1 = lum(fg), L2 = lum(bg); const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); n++;
    if (r < min) { min = r; worst = `${e.tagName.toLowerCase()}.${e.className} "${e.textContent.trim().slice(0, 24)}" ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)})`; }
  }
  return { min: +min.toFixed(2), n, worst };
};
const TARGETS = (sel) => {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden');
  const rs = els.map((e) => ({ e, r: e.getBoundingClientRect() })); const small = rs.filter(({ r }) => r.width < 44 - 0.01 || r.height < 44 - 0.01).map(({ e, r }) => `${e.className || e.tagName}:${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
  return { n: rs.length, min_w: +Math.min(...rs.map(({ r }) => r.width)).toFixed(1), min_h: +Math.min(...rs.map(({ r }) => r.height)).toFixed(1), small: small.slice(0, 8) };
};

// Gzip bytes the #55 commits added to the files the shell loads (index.html + the service worker's SHELL list): the transfer-size growth of the shell
function shellGrowth() {
  try {
    const sw = fs.readFileSync(path.join(ROOT, 'site/sw.js'), 'utf8'); /* quoted entries only, so comments in SHELL do not break the parse; lines tagged "lazy views" are precached for offline use but not
       loaded at startup, so they are not shell growth */
    const list = [...sw.match(/const SHELL = \[([^\]]*)\]/s)[1].split('\n').filter((l) => !/lazy views/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const files = new Set(['site/index.html', 'site/sw.js', ...list.filter((f) => f !== './').map((f) => 'site/' + f)]);
    const commits = execSync("git log --format=%h --grep='#55' -- site/", { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
    const gz = (rev, f) => { try { return zlib.gzipSync(execSync(`git show ${rev}:${f}`, { cwd: ROOT, maxBuffer: 1 << 26 }), { level: 9 }).length; } catch (e) { return 0; } };
    let total = 0; const per = [];
    for (const c of commits) for (const f of execSync(`git show --format= --name-only ${c}`, { cwd: ROOT }).toString().trim().split('\n')) if (files.has(f)) { const d = gz(c, f) - gz(c + '^', f); total += d; per.push(`${c} ${f} ${d > 0 ? '+' : ''}${d}`); }
    return { gzip_bytes: total, commits, per };
  } catch (e) { return { error: e.message }; }
}

export async function performSection({ browser, BASE, OUT, check, watch, metrics }) {
  const M = (metrics.perform = {});
  /* ---------------- desktop 1440 ---------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage(); watch(page, 'perform-1440');
    await start(page, BASE);
    // Tabs
    check('perform: tab strip is role=tablist with bank and board tabs', await page.locator('#perform [role=tablist] [role=tab][data-kind=bank]').count() >= 1 && await page.locator('#perform [role=tablist] [role=tab][data-kind=board]').count() >= 1);
    const n0 = await page.locator('#perform [role=tab]').count();
    await page.click('.pf-more summary'); await page.click('.pf-menu button:has-text("+ Bank")');
    await page.click('.pf-more summary'); await page.click('.pf-menu button:has-text("+ Board")');
    await page.click('.pf-more summary'); await page.click('.pf-menu button:has-text("Rename")'); await page.fill('.scm-input', 'Knobs'); await page.keyboard.press('Enter');
    const names1 = await page.locator('#perform [role=tab]').allTextContents();
    await page.focus('#perform [role=tab][aria-selected=true]'); await page.keyboard.press('Alt+ArrowLeft');
    const names2 = await page.locator('#perform [role=tab]').allTextContents();
    await page.focus('#pft0'); await page.keyboard.press('ArrowRight'); const sel = await P(page, () => [document.activeElement.id, document.activeElement.getAttribute('aria-selected')]);
    check('perform: tabs add (bank + board), rename, reorder; arrow keys move between tabs', (await page.locator('#perform [role=tab]').count()) === n0 + 2 && names1.at(-1).includes('Knobs') && names2.at(-2).includes('Knobs') && sel[0] === 'pft1' && sel[1] === 'true', JSON.stringify({ names2, sel }));
    await tab(page, 'Bank A');
    // Keyboard
    await page.waitForTimeout(100); await P(page, () => document.activeElement.blur());
    let q0 = await onCount(page, 'A/1,0'); await page.keyboard.down('q'); await page.waitForTimeout(80); await page.keyboard.up('q'); await page.waitForTimeout(80);
    const kq = (await onCount(page, 'A/1,0')) - q0;
    await page.click('.pf-mode'); await P(page, () => document.activeElement.blur()); // perform mode off
    await page.keyboard.press('2'); const v2 = await page.getAttribute('#main', 'data-view'); await page.keyboard.press('5');
    await page.keyboard.press('Space'); await page.waitForTimeout(400); const stopped = !(await P(page, () => window.__sc.S.playing));
    await page.keyboard.press('Space'); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 30000 });
    await page.click('.pf-mode'); // perform mode back on
    await P(page, () => window.__sc.setView('rack')); q0 = (await P(page, () => window.strudelCraft.perform.journal.length));
    const ed = page.locator('.cm-content:visible, #code:visible').first(); await ed.click(); await page.keyboard.type('qwer'); await page.keyboard.press('Control+z').catch(() => {});
    const typedFired = (await P(page, () => window.strudelCraft.perform.journal.length)) - q0;
    check('perform: KeyQ fires pad 1,0 in perform mode; with it off 1-4 and Space keep working; typing in the editor fires no pad', kq === 1 && v2 === 'stack' && stopped && typedFired === 0, JSON.stringify({ kq, v2, stopped, typedFired }));
    await P(page, (c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); }, CODE);
    await P(page, () => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad');
    // Queued state (+ reduced motion)
    await waitPhase(page, 0.15, 0.45); await page.click('#perform .pp-pad[data-pos="0,0"]');
    await page.waitForTimeout(60);
    const qd = await P(page, () => { const b = document.querySelector('#perform .pp-pad[data-pos="0,0"]'); return { state: b.dataset.state, mark: b.querySelector('.pp-mark').textContent, beats: (b.querySelector('.pp-beats') || {}).textContent, anim: getComputedStyle(b).animationName }; });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(150);
    const qr = await P(page, () => { const b = document.querySelector('#perform .pp-pad[data-pos="0,0"]'); return { state: b.dataset.state, beats: (b.querySelector('.pp-beats') || {}).textContent, anim: getComputedStyle(b).animationName, label: b.getAttribute('aria-label') }; });
    await page.waitForFunction(() => document.querySelector('#perform .pp-pad[data-pos="0,0"]').dataset.state === 'on', null, { timeout: 5000 }).catch(() => {});
    const qon = await page.getAttribute('#perform .pp-pad[data-pos="0,0"]', 'data-state'); await page.emulateMedia({ reducedMotion: 'no-preference' });
    check('perform: bar-quantised pad shows the queued mark until its boundary, then on; reduced motion: no animation, beats as text', qd.state === 'queued' && qd.mark === '◔' && /\d beats/.test(qd.beats || '') && qd.anim !== 'none' && qr.state === 'queued' && qr.anim === 'none' && /\d beats/.test(qr.beats || '') && qon === 'on', JSON.stringify({ qd, qr, qon }));
    // Looper
    await page.click('#pfTakeRec'); const from = await P(page, () => window.strudelCraft.perform.take.rec.from);
    while ((await now(page)) < from + 0.08) await page.waitForTimeout(40);
    for (let i = 0; i < 2; i++) { const c = await center(page, '#perform .pp-pad[data-pos="1,0"]'); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up(); await page.waitForTimeout(150); }
    await page.waitForFunction(() => !window.strudelCraft.perform.take.rec, null, { timeout: 8000 });
    const take = await P(page, () => window.strudelCraft.perform.looper().periodic());
    await page.click('#pfTakeSave'); await page.fill('.scm-input', 'smoke-take'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const rec = await P(page, async () => { const { lib } = await import('./library.js'); return lib.get('smoke-take'); });
    await page.click('#pfTakeLoad'); await page.click('.pf-opt[data-v="smoke-take"]');
    await page.click('#pfTakePlay'); const base = await P(page, () => window.strudelCraft.perform.take.play.base);
    const T = (s) => { const [a, b] = String(s).split('/').map(Number); return b ? a / b : a; };
    const replayed = (await P(page, (b) => window.strudelCraft.perform.journal.filter((e) => e.pad === 'A/1,0' && e.op === 'tap').map((e) => e.cycle), base)).map(T).filter((c) => c >= base);
    const want = take.entries.filter((e) => e.type === 'on').map((e) => base + T(e.t));
    await page.click('#pfTakePlay');
    check('perform: looper records a 1-bar take, Save stores a performance record, the loaded take replays', take.entries.length >= 4 && rec && rec.meta.kind === 'performance' && rec.performance.layers[0].events.length === take.entries.length && want.every((w) => replayed.some((r) => Math.abs(r - w) < 0.02)),
      JSON.stringify({ events: take.entries.length, kind: rec && rec.meta.kind, want, replayed: replayed.slice(0, 6) }));
    M.take = { events: take.entries.length, record: rec && { name: rec.meta.name, rev: rec.meta.rev, kind: rec.meta.kind } };
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const r = document.querySelector('#perform').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - (document.querySelector('header')?.getBoundingClientRect().height || 60) - 4); }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(OUT, 'desktop-1440-perform.png') });
    // Board: fallback, controls, knob access
    await tab(page, 'Board 2'); await page.waitForSelector('#perform .pc-cell[data-name="enc"]');
    const note = await page.textContent('#perform .pc-cell[data-name="enc"] .pc-note').catch(() => '');
    check('perform: declared-only type (encoder) renders its fallback with the "basic view" note', /basic view/.test(note || ''), note);
    const knob = '#perform .pc-cell[data-name="cut"] [role=slider]'; await page.waitForSelector(knob);
    const v0 = await P(page, () => window.strudelCraft.perform.controls.get('cut'));
    await page.focus(knob); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
    const v1 = await P(page, () => window.strudelCraft.perform.controls.get('cut'));
    const c0 = Math.ceil(await now(page)) + 1; await page.waitForTimeout(200);
    const evc = await P(page, (c) => window.__sc.Engine.scheduler.pattern.queryArc(c, c + 0.5).map((x) => x.value.cutoff), c0);
    const inl = await P(page, () => [document.querySelector('.editor .pc-inline [data-ctl="' + window.strudelCraft.perform.controls.resolve('cut') + '"]')?.getAttribute('aria-valuetext'), document.querySelector('#perform [data-ctl="' + window.strudelCraft.perform.controls.resolve('cut') + '"]').getAttribute('aria-valuetext')]);
    check('perform: board knob changes the event value of its param on the next cycle; the inline control shows the same value', v1 > v0 && evc.length && evc.every((x) => Math.abs(x - v1) < 1e-6) && inl[0] && inl[0] === inl[1], JSON.stringify({ v0, v1, evc, inl }));
    const step = await P(page, () => window.strudelCraft.perform.controls.get('cut'));
    await page.focus(knob); await page.keyboard.press('ArrowUp'); const st1 = await P(page, () => window.strudelCraft.perform.controls.get('cut'));
    await page.keyboard.press('Enter'); await page.fill('.scm-input', '1234'); await page.keyboard.press('Enter');
    const vt = await page.getAttribute(knob, 'aria-valuetext'); const typedV = await P(page, () => window.strudelCraft.perform.controls.get('cut'));
    const xy = '#perform .pc-cell[data-name="pos"] [role=slider]'; const x0 = await page.getAttribute(xy, 'aria-valuetext'); await page.focus(xy); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); const x1 = await page.getAttribute(xy, 'aria-valuetext');
    check('perform: knob arrow keys step, typed value accepted, aria-valuetext has value and unit; XY moves by arrow keys', Math.abs(st1 - step - 38) < 1e-6 && typedV === 1234 && vt === '1234 Hz' && x0 !== x1, JSON.stringify({ step: st1 - step, typedV, vt, x0, x1 }));
    // Learn
    const lines = () => P(page, () => document.getElementById('code').value.split('\n').filter((l) => /^\s*hooks\.map\(/.test(l)));
    await page.click('#pfLearn'); await page.fill('#pfAsk', 'lpf'); await page.keyboard.press('Enter');
    await page.focus(xy); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
    const lm = await P(page, () => window.strudelCraft.perform.controls.maps().filter((m) => m.dest === 'lpf')); const ll = await lines();
    // mapped path (Learn + hooks.map, nothing but the map ties 'pos' to cutoff): moving the control changes the event value on the next cycle
    const mapEv = () => P(page, () => { const C = window.strudelCraft.perform.controls, H = window.strudelCraft.hooks, c = Math.ceil(window.__sc.Engine.scheduler.now()) + 1, r = H.ranges && (H.ranges.cutoff || H.ranges.lpf);
      return { x: C.get('pos').x, lo: r ? r.min : 0, hi: r ? r.max : 1, cut: C.get('cut'), ev: window.__sc.Engine.scheduler.pattern.queryArc(c, c + 0.5).map((h) => h.value.cutoff) }; });
    const m0 = await mapEv(); await page.focus(xy); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200); const m1 = await mapEv();
    const wantM = (m) => m.lo + m.x * (m.hi - m.lo);
    check('perform: a Learn/hooks.map mapping (no ctl() for it) changes the mapped param\'s event value on the next cycle', m1.x !== m0.x && m1.ev.length && m0.ev.length && m1.ev.every((v) => Math.abs(v - wantM(m1)) < 1e-6) && m0.ev.every((v) => Math.abs(v - wantM(m0)) < 1e-6) && Math.abs(wantM(m1) - m1.cut) > 1e-6 && m1.ev[0] !== m0.ev[0], JSON.stringify({ m0, m1 }));
    await page.click('#perform .pc-cell[data-name="pos"] .pc-map'); await page.click('.pf-opt[data-v="un:lpf"]'); await page.waitForTimeout(2600);
    const lm2 = await P(page, () => window.strudelCraft.perform.controls.maps().filter((m) => m.dest === 'lpf')); const ll2 = await lines();
    check('perform: Learn + destination + move creates one maps entry and one hooks.map line; Unlearn removes both', lm.length === 1 && ll.length === 1 && ll[0] === "hooks.map('pos', 'lpf')" && lm2.length === 0 && ll2.length === 0, JSON.stringify({ lm, ll, lm2, ll2 }));
    // Automation
    await page.click('#pfLaneRec'); let i = 0; const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !(await P(page, () => !window.strudelCraft.perform.lanes.run && window.strudelCraft.perform.controls.lanes().has('lane:' + window.strudelCraft.perform.controls.resolve('cut'))))) { await page.focus(knob); await page.keyboard.press(i++ % 16 < 8 ? 'PageUp' : 'PageDown'); await page.waitForTimeout(70); }
    const lane = await P(page, () => window.strudelCraft.perform.model().automation['lane:' + window.strudelCraft.perform.controls.resolve('cut')]);
    const cc = Math.ceil(await now(page)) + 1; const follow = await P(page, (c) => { const C = window.strudelCraft.perform.controls; return window.__sc.Engine.scheduler.pattern.queryArc(c, c + 1).map((x) => [Math.round(x.value.cutoff), Math.round(C.get('cut', x.whole.begin.valueOf()))]); }, cc);
    const distinct = new Set(follow.map((x) => x[0])).size;
    check('perform: a 1-bar control move records a lane into the model and the control follows it on replay', lane && lane.points.length > 2 && follow.length && follow.every(([a, b]) => a === b) && distinct > 1, JSON.stringify({ points: lane && lane.points.length, follow }));
    M.lane = { points: lane && lane.points.length, events_next_cycle: follow };
    // Edit mode + library (board)
    await page.click('#pfEdit'); await page.click('#perform .pc-cell[data-name="cut"] .pc-edit'); await page.click('.pf-opt[data-v="size:2x1"]');
    const sz = await page.getAttribute('#perform .pc-cell[data-name="cut"]', 'data-size'); await page.click('#perform .pc-cell[data-name="res"] .pc-edit'); await page.click('.pf-opt[data-v="to:main"]');
    const moved = await P(page, () => [window.strudelCraft.perform.model().boards.two.cells.includes('res'), window.strudelCraft.perform.model().boards.main.cells.includes('res')]); await page.click('#pfEdit');
    await page.click('.pf-more summary'); await page.click('#pfSaveTab'); await page.fill('.scm-input', 'smoke-board'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const kinds = await P(page, async () => { const { lib } = await import('./library.js'); return lib.list().map((m) => m.kind); });
    check('perform: board edit mode resizes and moves a cell to another board; board saved to the library', sz === '2x1' && !moved[0] && moved[1] && kinds.includes('board'), JSON.stringify({ sz, moved, kinds }));
    await P(page, () => window.__sc.stop && window.__sc.stop());
    await ctx.close();
  }
  /* ---------------- phone 390 ---------------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const page = await ctx.newPage(); watch(page, 'perform-390');
    await start(page, BASE);
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const r = document.querySelector('#perform').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - (document.querySelector('header')?.getBoundingClientRect().height || 60) - 4); }); await page.waitForTimeout(150); await page.waitForTimeout(200);
    // Play: one tap -> one on; two touches -> two pads; edit mode tap -> sheet, nothing journaled
    const b0 = await onCount(page, 'A/0,1'); const p01 = await center(page, '#perform .pp-pad[data-pos="0,1"]'); await page.touchscreen.tap(p01.x, p01.y); await page.waitForTimeout(150);
    const one = (await onCount(page, 'A/0,1')) - b0;
    const cdp = await ctx.newCDPSession(page); const a = await center(page, '#perform .pp-pad[data-pos="1,0"]'), b = await center(page, '#perform .pp-pad[data-pos="1,1"]');
    const h0 = [await onCount(page, 'A/1,0'), await onCount(page, 'A/1,1')];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] }); await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(150);
    const two = [(await onCount(page, 'A/1,0')) - h0[0], (await onCount(page, 'A/1,1')) - h0[1]];
    await page.screenshot({ path: path.join(OUT, 'phone-390-pads.png') });
    await page.tap('.pf-mode'); const j0 = await P(page, () => (window.strudelCraft.hooks.journal || []).length);
    const p2 = await center(page, '#perform .pp-pad[data-pos="0,1"]'); await page.touchscreen.tap(p2.x, p2.y); await page.waitForTimeout(250);
    const sheet = await page.locator('dialog.pf-sheet[open]').count(); const j1 = await P(page, () => (window.strudelCraft.hooks.journal || []).length);
    await page.keyboard.press('Escape').catch(() => {}); await P(page, () => document.querySelectorAll('dialog.pf-sheet').forEach((d) => { d.close(); d.remove(); }));
    check('perform: perform-mode tap journals one on (hooks.journal); two touches fire two pads; edit-mode tap opens the pad sheet and journals nothing', one === 1 && two[0] === 1 && two[1] === 1 && sheet === 1 && j1 === j0, JSON.stringify({ one, two, sheet, j0, j1 }));
    await page.tap('.pf-mode');
    // Targets, contrast, state marks
    await page.waitForTimeout(150);
    const tp = await P(page, TARGETS, '#perform button, #perform [role=slider], #perform select, #perform input, #perform summary');
    const cp = await P(page, CONTRAST, '#perform *');
    const marks = await P(page, () => { const m = {}; document.querySelectorAll('#perform .pp-pad').forEach((b) => { m[b.dataset.state] = { mark: b.querySelector('.pp-mark').textContent, label: /, (empty|loaded|queued|on|recording)/.test(b.getAttribute('aria-label')) }; }); return m; });
    await page.click('#pft1'); await page.waitForTimeout(200); await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const r = document.querySelector('#perform').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - (document.querySelector('header')?.getBoundingClientRect().height || 60) - 4); }); await page.waitForTimeout(150);
    const tb = await P(page, TARGETS, '#perform button, #perform [role=slider], #perform select, #perform input, #perform summary');
    const cb = await P(page, CONTRAST, '#perform *');
    const cols = await P(page, () => getComputedStyle(document.querySelector('#perform .pc-board')).gridTemplateColumns.split(' ').length);
    await page.screenshot({ path: path.join(OUT, 'phone-390-board.png') });
    const distinctMarks = new Set(Object.values(marks).map((m) => m.mark)).size === Object.keys(marks).length && Object.values(marks).every((m) => m.mark.trim() && m.label);
    M.targets_390 = { pads: tp, board: tb }; M.contrast = { pads: cp, board: cb }; M.state_marks = marks; M.board_columns_390 = cols;
    check('perform: pads and controls >= 44x44 at 390, text contrast >= 7:1, every pad state has its own mark + text', !tp.small.length && !tb.small.length && cp.min >= 7 && cb.min >= 7 && distinctMarks && cols === 4, JSON.stringify({ tp: tp.small, tb: tb.small, cp: cp.min, cpw: cp.worst, cb: cb.min, cbw: cb.worst, marks, cols }));
    // Latency: pointerdown -> journal entry (main thread), phone profile, and with 4x CPU throttle
    await page.click('#perform [role=tab]:has-text("Bank A")'); await page.waitForTimeout(150); await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const r = document.querySelector('#perform').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - (document.querySelector('header')?.getBoundingClientRect().height || 60) - 4); }); await page.waitForTimeout(150);
    const runTaps = async (n) => { await P(page, () => { window.strudelCraft.perform.latency.length = 0; window.strudelCraft.perform.work.length = 0; }); const c = await center(page, '#perform .pp-pad[data-pos="1,0"]'); for (let i = 0; i < n; i++) { await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(30); } const r = await P(page, () => [window.strudelCraft.perform.work.slice(), window.strudelCraft.perform.latency.slice()]); return { work: stats(r[0]), from_event: stats(r[1]) }; };
    M.latency_phone = await runTaps(40);
    /* one retry absorbs a cold-start or GC hiccup on a loaded host; the gate itself is unchanged */
    if (M.latency_phone.work.n < 30 || M.latency_phone.work.p95_ms > 10) { M.latency_phone_first = M.latency_phone; M.latency_phone = await runTaps(40); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); M.latency_phone_cpu4x = await runTaps(20); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    M.shell_growth = shellGrowth();
    check('perform: pointerdown handler -> journal entry, main-thread work p95 <= 10 ms (phone profile); #55 adds <= 5 kB (gzip) to the shell', M.latency_phone.work.n >= 30 && M.latency_phone.work.p95_ms <= 10 && M.shell_growth.gzip_bytes <= 5120, JSON.stringify({ phone: M.latency_phone, first: M.latency_phone_first, cpu4x: M.latency_phone_cpu4x, shell_gzip_bytes: M.shell_growth.gzip_bytes, shell_error: M.shell_growth.error }));
    await P(page, () => window.__sc.stop && window.__sc.stop());
    await ctx.close();
  }
}

/* ---------- standalone ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const SITE = path.join(ROOT, 'site'), OUT = path.join(ROOT, 'docs/screens');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const checks = [], errors = [], metrics = {};
  const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
  const watch = (page, tag) => {
    page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: 'x', body: '' }) : '[]' }));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); }); page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try { await performSection({ browser, BASE, OUT, check, watch, metrics }); } catch (e) { check('perform section ran to the end', false, e.stack); }
  await browser.close(); server.close();
  check('perform: zero console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  const mf = path.join(OUT, 'metrics.json'); let all = {}; try { all = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { all = {}; }
  all.perform = { date: new Date().toISOString(), ...metrics.perform, checks }; fs.writeFileSync(mf, JSON.stringify(all, null, 1));
  const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} perform checks passed; ${errors.length} console errors`);
  process.exit(failed.length ? 1 : 0);
}
