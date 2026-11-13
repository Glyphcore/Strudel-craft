// Lanes L5 (#78) section of the site smoke test: lane cards, split fan, tap ports and E_LANE_CROSS fixes, bus node and send amounts,
// tag chips (mute / solo statements, checked against the queried events), capture node, the keyboard-only send through the outline,
// targets / contrast, reduced motion and lazy loading. Called from tests/site/smoke.mjs; also runs alone:
//   node tests/site/lanes_ui.mjs      (serves site/, writes docs/screens/*-lane*.png and phone-390-capture-node.png, merges "lanes_ui" into metrics.json)
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as acorn from '../../site/vendor/acorn-8.19.0.mjs';

const LINE = (t) => t.split('\n');
const diff = (a, b) => ({ added: LINE(b).filter((l) => !LINE(a).includes(l)), removed: LINE(a).filter((l) => !LINE(b).includes(l)) });
// LANES section 7 example 1 and example 5, verbatim
const EX1 = `drums: s("bd*4, hh*8").lpf(4000)
  .split(dry => dry,
         wet => wet.room(0.9).rsize(6).lpf(900),
         grit => grit.crush(5).hpf(2000).gain(0.4))
`;
const EX5 = `drums: s("bd*4, hh*8").tags("drums")
snare: s("~ sd").tags("drums", "wet")
keys:  note("c e g").s("piano").tags("harm", "wet")
verb:  ret("verb").room(1).rsize(8)
tagged("wet").send("verb", 0.5)
tagged("drums").fx(x => x.hpf(40)).mute("33b..37b")
`;
const OWN = `keys: note("c e g").s("piano").send("verb", 0.2)
pad: note("c4").s("sawtooth").send("verb", 0.6)
verb: ret("verb").room(1)
`;
const TAPS = `drums: s("bd*4, ~ sd ~ sd").tap("hits", { export: true }).room(0.2)
bass: note("c2*8").s("sawtooth").gain(0.6)
a: s("hh*8").split(x => x.tap("inner").lpf(500), y => y.room(0.4))
b: s("cp*2").gain(tap("inner:env"))
`;
const TAGS = `drums: s("bd*4, hh*8").tags("drums")
snare: s("~ sd").tags("drums", "wet")
keys: note("c e g").s("triangle").tags("harm", "wet")
`;
const CAP = `drums: s("bd*4, ~ sd ~ sd, hh*8").tags("drums")
capture("groove", "drums", { window: "1b..3b", what: ["events", "audio", "level"] })
chop: n("0 3 2 1 4 7 6 5").from("groove").slice(8).gain(0.8)
bass: note("c2*8").s("sawtooth").gain(recall("groove:level").range(1, 0.3))
`;
const KEYS = `drums: s("bd*4").tags("drums")
keys: note("c e g").s("piano").tags("wet").send("verb", 0.5)
verb: ret("verb").room(1)
`;

// WCAG contrast of visible text inside the given selectors, against the composited background (same rule as atoms_ui.mjs)
const CONTRAST = (sel) => {
  const rgba = (s) => { const m = s.match(/[\d.]+/g); if (!m) return [0, 0, 0, 0]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let bg = [255, 255, 255, 1]; for (const l of layers.reverse()) bg = over(l, bg); return bg; };
  let min = Infinity, worst = null, n = 0;
  const els = [...document.querySelectorAll(sel)].filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && e.getClientRects().length);
  for (const e of els) {
    const cs = getComputedStyle(e); if (parseFloat(cs.opacity) === 0) continue;
    const bg = bgOf(e), fg = over(rgba(cs.color), bg); const L1 = lum(fg), L2 = lum(bg); const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); n++;
    if (r < min) { min = r; worst = `${e.tagName.toLowerCase()}.${e.className} "${e.textContent.trim().slice(0, 24)}"`; }
  }
  return { min: +min.toFixed(2), n, worst };
};
const TARGETS = (sel) => {
  const rs = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && !e.closest('[hidden]')).map((e) => ({ e, r: e.getBoundingClientRect() }));
  return { n: rs.length, min_w: rs.length ? +Math.min(...rs.map(({ r }) => r.width)).toFixed(1) : null, min_h: rs.length ? +Math.min(...rs.map(({ r }) => r.height)).toFixed(1) : null,
    small: rs.filter(({ r }) => r.width < 44 || r.height < 44).map(({ e, r }) => `${e.className}:${r.width.toFixed(0)}x${r.height.toFixed(0)}`).slice(0, 5) };
};
// the text range of the `.split(...)` call of a program (for "changes exactly the .split statement")
function splitRange(text) {
  let found = null; const walk = (n) => { if (!n || typeof n.type !== 'string' || found) return; if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'split') { found = [n.callee.property.start, n.end]; return; } for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); } };
  walk(acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })); return found;
}

export async function lanesUiSection({ browser, BASE, OUT, check, watch, metrics }) {
  const M = (metrics.lanes_ui = {});
  const settle = (page, ms = 350) => page.waitForTimeout(ms);
  const openGraph = async (page) => { await page.click('.views a[data-view="graph"]'); await page.waitForFunction(() => window.__graph && window.strudelCraft.lanesUI && document.querySelector('.gx .gn'), null, { timeout: 20000 }); };
  const load = async (page, text) => { await page.evaluate((t) => { window.__graph.reset(); const ta = document.getElementById('gxCode'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, text); await page.waitForFunction((t) => window.__graph.text === t, text); await settle(page, 200); };
  const text = (page) => page.evaluate(() => window.__graph.text);
  const at = (page, id, s = 1) => page.evaluate(([id, s]) => { const g = window.__graph, n = g.view.nmap.get(id); g.zoomTo(s, 12 - n.x * s, 12 - n.y * s); }, [id, s]);
  const press = (page, sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) throw new Error('no ' + sel); b.click(); }, sel); // a non-pointer activation (Enter / screen reader), same handler
  // phone screenshots: a tall 390 viewport so the canvas (66dvh) holds the whole card; no toast, no touch hint
  const shot = async (page, id, file) => { await page.setViewportSize({ width: 390, height: 1500 }); await page.evaluate(() => { document.querySelectorAll('.toasts .toast').forEach((t) => t.remove()); const g = document.querySelector('.gx'); g.classList.add('gx-touched'); g.querySelector('.gx-msg').textContent = ''; }); await settle(page, 200); await at(page, id, 0.9); await settle(page, 250); await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: 390, height: 1060 } }); await page.setViewportSize({ width: 390, height: 844 }); await settle(page, 150); };
  const answer = async (page, value) => { await page.waitForSelector('dialog.scm .scm-input'); await page.fill('dialog.scm .scm-input', value); await page.click('dialog.scm .scm-ok'); await settle(page, 250); };

  /* ---------- phone 390, touch ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, 'lanes-390');
    const reqs = []; page.on('request', (r) => reqs.push(r.url()));
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.evaluate(() => document.fonts.ready);
    const shellLoaded = reqs.some((u) => /lanes-ui\.(js|css)/.test(u));
    await openGraph(page);
    const graphLoaded = reqs.some((u) => /lanes-ui\.js/.test(u)) && reqs.some((u) => /lanes-ui\.css/.test(u));
    check('lanes ui: lanes-ui.js / .css load with the Graph view, not with the shell', !shellLoaded && graphLoaded, JSON.stringify({ shellLoaded, graphLoaded }));

    // split fan: LANES example 1 = one lane card with three branch sub-chains
    await load(page, EX1);
    const fan = await page.evaluate(() => ({ lanes: document.querySelectorAll('.gn.gl-lane').length, branches: [...document.querySelectorAll('.gn[data-id="track:drums"] .gl-bb')].map((b) => b.textContent), bars: document.querySelectorAll('.gn[data-id="track:drums"] .gl-fsvg .gw-audio').length }));
    await shot(page, 'track:drums', 'phone-390-lane-split.png');
    const t0 = await text(page); const ports0 = await page.$$eval('.gn[data-id="track:drums"] > .gp', (bs) => bs.map((b) => `${b.dataset.dir}:${b.dataset.port}:${b.dataset.type}`));
    await press(page, '.gn[data-id="track:drums"] .gl-addb'); await answer(page, 'crush => crush.crush(4)');
    const t1 = await text(page), r0 = splitRange(t0), r1 = splitRange(t1);
    const onlySplit = t0.slice(0, r0[0]) === t1.slice(0, r1[0]) && t0.slice(r0[1]) === t1.slice(r1[1]) && t1.slice(r1[0], r1[1]).includes('crush => crush.crush(4)');
    const nb = await page.$$eval('.gn[data-id="track:drums"] .gl-bb', (b) => b.length);
    await press(page, '.gn[data-id="track:drums"] .gl-fold'); await settle(page, 200);
    const folded = await page.evaluate(() => ({ ports: [...document.querySelectorAll('.gn[data-id="track:drums"] > .gp')].map((b) => `${b.dataset.dir}:${b.dataset.port}:${b.dataset.type}`), rows: document.querySelectorAll('.gn[data-id="track:drums"] .gl-bb').length, expanded: document.querySelector('.gn[data-id="track:drums"] .gl-fold').getAttribute('aria-expanded') }));
    await press(page, '.gn[data-id="track:drums"] .gl-fold'); await settle(page, 150);
    M.split = { fan, branches_after_add: nb, split_only: onlySplit, ports: ports0, folded };
    check('lanes ui: LANES example 1 renders one lane card with three branch sub-chains (audio bars)', fan.lanes === 1 && fan.branches.length === 3 && fan.bars >= 4, JSON.stringify(fan));
    check('lanes ui: + Branch changes exactly the .split(...) call in the code', onlySplit && nb === 4, JSON.stringify({ before: t0.slice(r0[0], r0[1]), after: t1.slice(r1[0], r1[1]) }));
    check('lanes ui: collapsing the fan keeps the card ports', folded.rows === 0 && folded.expanded === 'false' && JSON.stringify(folded.ports) === JSON.stringify(ports0) && ports0.includes('out:audio:audio'), JSON.stringify(folded));

    // tap ports: exported on the card edge (wired to another lane); local inside the fan, refused with E_LANE_CROSS + both fixes
    await load(page, TAPS);
    const edge = await page.evaluate(() => { const b = document.querySelector('.gn[data-id="track:drums"] > .gp-out[data-port="xtap:hits"]'); const l = document.querySelector('.gn[data-id="track:a"] .gl-card .gl-ltap[data-port="ltap:inner"]'); return { exported: !!b, edge: b && b.parentElement.classList.contains('gn'), local: !!l, localInside: !!(l && l.closest('.gl-fan')), localOnEdge: !!document.querySelector('.gn[data-id="track:a"] > .gp[data-port="ltap:inner"]'), refusedRow: !!document.querySelector('.gn[data-id="track:b"] .gl-ref') }; });
    await press(page, '.gp[data-node="track:drums"][data-port="xtap:hits"]'); await press(page, '.gp[data-node="track:bass"][data-port="gain"]');
    await page.waitForSelector('.gx-sheet form[data-bridge]'); await page.click('.gx-sheet form[data-bridge] button[type=submit]'); await settle(page);
    const tw = await text(page), wired = /bass: .*\.wire\("gain", "hits:env"/.test(tw) && (await page.evaluate(() => window.__graph.view.wires.some((w) => w.from.node === 'tap:hits' && w.to.node === 'track:bass')));
    const fixes = {};
    for (const [i, label] of [[0, 'Export tap'], [1, 'Add send']]) {
      await load(page, TAPS);
      await press(page, '.gl-ltap[data-node="track:a"][data-port="ltap:inner"]'); await press(page, '.gp[data-node="track:bass"][data-port="gain"]');
      await page.waitForSelector('.gx-sheet .gl-crossmsg');
      const sheet = await page.evaluate(() => ({ msg: document.querySelector('.gl-crossmsg').textContent, fixes: [...document.querySelectorAll('.gx-sheet .gl-fix')].map((b) => b.textContent) }));
      const before = await text(page); await page.click(`.gx-sheet .gl-fix[data-i="${i}"]`); await settle(page);
      const d = diff(before, await text(page)); fixes[label] = { sheet, added: d.added, removed: d.removed };
    }
    const ex = fixes['Export tap'], as = fixes['Add send'];
    M.taps = { edge, wired, fixes };
    check('lanes ui: an exported tap shows on the card edge and wires to another lane (.wire in code)', edge.exported && edge.edge && wired, JSON.stringify({ edge, wired }));
    check('lanes ui: a local tap is refused with the E_LANE_CROSS text and working Export tap / Add send buttons',
      edge.local && edge.localInside && !edge.localOnEdge && ex.sheet.msg.startsWith('E_LANE_CROSS: tap "inner" of lane "a"') && JSON.stringify(ex.sheet.fixes) === '["Export tap","Add send"]'
      && ex.added.length === 1 && ex.added[0].includes('a: s("hh*8").tap("inner", { export: true }).split(') && as.added.length === 1 && /^a: .*\.send\("a"\)$/.test(as.added[0]), JSON.stringify(fixes));

    // bus node: LANES example 5 = one verb node, two sends, one return; an amount edit rewrites only that .send(...) argument
    await load(page, EX5);
    const bus = await page.evaluate(() => ({ nodes: document.querySelectorAll('.gk-bus').length, sends: [...document.querySelectorAll('.gk-bus .gl-send')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()), returns: document.querySelector('.gk-bus .gl-ret').textContent }));
    const setAmt = (lane, v) => page.evaluate(([lane, v]) => { const i = document.querySelector(`.gk-bus .gl-amt[data-lane="${lane}"]`); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }, [lane, v]);
    let b0 = await text(page); await setAmt('snare', '0.3'); await settle(page); const dSel = diff(b0, await text(page));
    await load(page, OWN); b0 = await text(page); await setAmt('pad', '0.35'); await settle(page); const dOwn = diff(b0, await text(page));
    M.bus = { bus, selection_send: dSel, own_send: dOwn };
    check('lanes ui: LANES example 5 shows one verb bus with two sends and one return', bus.nodes === 1 && bus.sends.length === 2 && /Returns verb/.test(bus.returns), JSON.stringify(bus));
    check('lanes ui: changing a send amount rewrites only that .send(...) argument', dSel.removed.join() === 'tagged("wet").send("verb", 0.5)' && dSel.added.join() === 'tagged("wet").send("verb", 0.3)'
      && dOwn.removed.join() === 'pad: note("c4").s("sawtooth").send("verb", 0.6)' && dOwn.added.join() === 'pad: note("c4").s("sawtooth").send("verb", 0.35)', JSON.stringify({ dSel, dOwn }));

    // capture node: picker chip, window with bar steppers, state as a word, coming actions
    await load(page, CAP);
    await shot(page, 'capture:groove', 'phone-390-capture-node.png');
    const cap = await page.evaluate(() => { const n = document.querySelector('.gk-capture'); return { ports: [...n.querySelectorAll(':scope > .gp-out')].map((b) => `${b.dataset.port}:${b.dataset.type}`), state: n.querySelector('.gl-state').dataset.state, word: n.querySelector('.gl-state b').textContent, from: n.querySelector('.gl-wi[data-field=from]').value, until: n.querySelector('.gl-wi[data-field=until]').value, coming: [...n.querySelectorAll('.gl-cact')].map((b) => `${b.textContent.trim()}|${b.disabled}`), recallWire: window.__graph.view.wires.some((w) => w.from.node === 'capture:groove' && w.to.node === 'track:bass'), fromWire: window.__graph.view.wires.some((w) => w.from.node === 'capture:groove' && w.to.node === 'track:chop' && w.type === 'audio') }; });
    b0 = await text(page); await press(page, '.gk-capture .gl-step[data-field=until][data-d="1"]'); await settle(page); const dWin = diff(b0, await text(page));
    M.capture = { ...cap, window_step: dWin };
    check('lanes ui: capture node shows ev / audio / level ports, the window in bars with steppers, its state in words, and coming actions',
      cap.ports.join() === 'ev:pattern,audio:audio,level:signal' && cap.word === 'Empty' && cap.from === '1b' && cap.until === '3b' && cap.coming.length === 3 && cap.coming.every((c) => /coming\|true$/.test(c)) && cap.recallWire && cap.fromWire
      && dWin.added.join().includes('window: "1b..4b"'), JSON.stringify(M.capture));

    // targets and contrast at 390 (zoom 100 %): every lanes control >= 44 x 44, text >= 7:1; canvas cards and the outline
    await load(page, EX5 + 'a: s("hh*8").split(x => x.tap("inner").lpf(500), y => y.room(0.4))\n' + CAP.split('\n').slice(1).join('\n'));
    await page.evaluate(() => window.__graph.zoomTo(1, 12, 12)); await settle(page, 250);
    const tc = await page.evaluate(({ T, C }) => { const T2 = eval(T), C2 = eval(C); return { targets: T2('.gx .gl-b, .gx .gl-amt, .gx .gl-wi, .gx .gl-ltap'), contrast: C2('.gx .gl-card, .gx .gl-card *') }; }, { T: TARGETS.toString().replace(/^\(sel\) =>/, '(sel) =>'), C: CONTRAST.toString() });
    await page.click('#gxTab-outline'); await settle(page, 250);
    const to = await page.evaluate(({ T, C }) => { const T2 = eval(T), C2 = eval(C); return { targets: T2('.gx-outline .gl-b, .gx-outline .gl-amt, .gx-outline .gl-wi'), contrast: C2('.gx-outline .gl-otags *, .gx-outline .gl-obus *, .gx-outline .gl-ocap *, .gx-outline .gl-ol *') }; }, { T: TARGETS.toString(), C: CONTRAST.toString() });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.screenshot({ path: path.join(OUT, 'phone-390-lane-outline.png') });
    await page.click('#gxTab-graph');
    M.targets_390 = { canvas: tc.targets, outline: to.targets }; M.contrast_390 = { canvas: tc.contrast, outline: to.contrast }; M.scroll_width_390 = sw;
    check('lanes ui: every lanes control >= 44 x 44 CSS px at 390 (canvas cards and outline)', tc.targets.n > 10 && !tc.targets.small.length && to.targets.n > 5 && !to.targets.small.length, JSON.stringify(M.targets_390));
    check('lanes ui: lanes text contrast >= 7:1 (canvas cards and outline)', tc.contrast.min >= 7 && to.contrast.min >= 7, JSON.stringify(M.contrast_390));
    check('lanes ui: no horizontal scroll at 390 with lanes in the graph', sw <= 390, String(sw));
    await ctx.close();
  }

  /* ---------- desktop 1440: tags against the queried events, keyboard-only send, screenshot ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, 'lanes-1440');
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
    await openGraph(page);
    // voice hint: LANES example 1 is 12 source voices + 3 readers per cycle, against 36 with .layer (section 7, example 1), counted from the engine's queried events
    await load(page, EX1); await page.waitForTimeout(1500);
    await press(page, '.gn[data-id="track:drums"] .gl-vc');
    await page.waitForFunction(() => /\d+ \+ \d+/.test((document.querySelector('.gn[data-id="track:drums"] .gl-vres b') || {}).textContent || ''), null, { timeout: 60000 });
    const vh = await page.evaluate(() => ({ text: document.querySelector('.gn[data-id="track:drums"] .gl-vres').textContent, api: window.strudelCraft.lanesUI.state && null }));
    const vc = await page.evaluate(() => { const T = window.strudelCraft.transport; return T.compileCode(window.__graph.text).then((i) => { const hs = i.pattern.queryArc(0, 1).filter((h) => h.hasOnset()); return { src: hs.filter((h) => h.value.s !== 'bus').length, rd: hs.filter((h) => h.value.s === 'bus').length, bus_sounds: [...new Set(hs.filter((h) => h.value.s !== 'bus').map((h) => h.value.bus))] }; }); });
    M.voices = { shown: vh.text, recount: vc };
    check('lanes ui: the split of LANES example 1 shows the engine counts 12 source + 3 readers (.layer: 36)', /12 \+ 3/.test(vh.text) && /\.layer: 36/.test(vh.text) && vc.src === 12 && vc.rd === 3, JSON.stringify(M.voices));
    // tags: the chip's Mute adds one tagged("drums").mute() statement; the next cycle's events lose every drums lane; tapping again removes it
    const events = (code) => page.evaluate(async (code) => { const E = window.__sc.Engine; await E.idle(code); await E.idle(code); const c = Math.floor(E.scheduler.now ? E.scheduler.now() : 0) + 1; return E.scheduler.pattern.queryArc(c, c + 1).filter((h) => h.hasOnset()).map((h) => h.value.s); }, code);
    await load(page, TAGS);
    const ev0 = await events(TAGS);
    const t0 = await text(page); await press(page, '.gn[data-id="track:drums"] .gl-tg[data-tag="drums"][data-op="mute"]'); await settle(page);
    const t1 = await text(page), d1 = diff(t0, t1);
    const on = await page.evaluate(() => { const b = document.querySelector('.gn[data-id="track:snare"] .gl-tg[data-tag="drums"][data-op="mute"]'); return { pressed: b.getAttribute('aria-pressed'), text: b.textContent, icon: b.querySelector('i').textContent }; });
    const ev1 = await events(t1);
    await press(page, '.gn[data-id="track:drums"] .gl-tg[data-tag="drums"][data-op="mute"]'); await settle(page);
    const t2 = await text(page), ev2 = await events(t2);
    await press(page, '.gn[data-id="track:keys"] .gl-tg[data-tag="harm"][data-op="solo"]'); await settle(page);
    const t3 = await text(page), ev3 = await events(t3); const d3 = diff(t2, t3);
    await page.evaluate(() => window.__graph.undo());
    const cnt = (ev, s) => ev.filter((x) => x === s).length;
    M.tags = { added: d1.added, events_before: ev0, events_muted: ev1, events_after_unmute: ev2, chip: on, solo: { added: d3.added, events: ev3 } };
    check('lanes ui: tag chip Mute adds one tagged("drums").mute() and silences those lanes on the next cycle (queried events); again removes it',
      d1.added.join() === 'tagged("drums").mute()' && !d1.removed.length && on.pressed === 'true' && on.text.includes('Muted') && on.icon === '■'
      && cnt(ev0, 'bd') > 0 && cnt(ev0, 'sd') > 0 && cnt(ev1, 'bd') === 0 && cnt(ev1, 'hh') === 0 && cnt(ev1, 'sd') === 0 && cnt(ev1, 'triangle') === cnt(ev0, 'triangle')
      && t2 === t0 && cnt(ev2, 'bd') === cnt(ev0, 'bd'), JSON.stringify(M.tags));
    check('lanes ui: tag chip Solo adds one tagged("harm").solo() and only those lanes sound', d3.added.join() === 'tagged("harm").solo()' && ev3.length > 0 && ev3.every((s) => s === 'triangle'), JSON.stringify(M.tags.solo));

    // keyboard only, through the outline: drums -> Connect to… -> bus verb -> amount -> .send("verb", 0.3)
    await load(page, KEYS);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.getElementById('gxTab-code').focus(); });
    const tabTo = async (pred, max = 300) => { for (let i = 0; i < max; i++) { if (await page.evaluate(pred)) return i; await page.keyboard.press('Tab'); } return -1; };
    let keys = 0; const k1 = await tabTo(() => document.activeElement && document.activeElement.id === 'gxTab-outline'); keys += k1; await page.keyboard.press('Enter'); keys++;
    const k2 = await tabTo(() => { const a = document.activeElement; return a && a.closest('.gx-outline') && a.dataset.act === 'connect' && a.dataset.node === 'track:drums'; }); keys += k2; await page.keyboard.press('Enter'); keys++;
    await settle(page, 200);
    const k3 = await tabTo(() => { const a = document.activeElement; return a && a.closest('.gx-sheet') && /audio → verb/.test(a.textContent) && /send/.test(a.textContent); }, 40); keys += k3; await page.keyboard.press('Enter'); keys++;
    await page.waitForSelector('dialog.scm .scm-input'); await page.keyboard.type('0.3'); await page.keyboard.press('Enter'); keys += 4; await settle(page);
    const kt = await text(page), kd = diff(KEYS, kt);
    M.keyboard = { tabs: [k1, k2, k3], keys, added: kd.added, removed: kd.removed };
    check('lanes ui: keyboard only (outline Connect to… -> bus) adds .send("verb", 0.3) to drums', k1 >= 0 && k2 >= 0 && k3 >= 0 && kd.added.join() === 'drums: s("bd*4").tags("drums").send("verb", 0.3)' && kd.removed.join() === 'drums: s("bd*4").tags("drums")', JSON.stringify(M.keyboard));

    // desktop screenshot: example 5 with a split lane, a refused crossing and a capture
    await page.keyboard.press('Escape');
    await load(page, EX5 + 'a: s("hh*8").split(x => x.tap("inner").lpf(500), y => y.room(0.4))\nb: s("cp*2").gain(tap("inner:env"))\n' + CAP.split('\n').slice(1).join('\n'));
    await page.click('#gxTab-outline'); await page.evaluate(() => window.__graph.zoomTo(0.86, 12, 12)); await settle(page, 300);
    await page.screenshot({ path: path.join(OUT, 'desktop-1440-lanes.png') });
    await ctx.close();
  }

  /* ---------- reduced motion: the recording state is static and still in words ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage(); watch(page, 'lanes-reduced');
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await openGraph(page); await load(page, CAP);
    // no capture runtime yet (#76): the recording look is forced on the element to check the stylesheet only
    const rm = await page.evaluate(() => { const s = document.querySelector('.gk-capture .gl-state'); s.dataset.state = 'recording'; s.querySelector('b').textContent = 'Recording'; const cs = getComputedStyle(s.querySelector('i')); return { animation: cs.animationName, word: s.querySelector('b').textContent }; });
    M.reduced_motion = rm;
    check('lanes ui: reduced motion - recording state style has no animation, the state word stays (CSS only; capture runtime #76)', rm.animation === 'none' && rm.word === 'Recording', JSON.stringify(rm));
    await ctx.close();
  }
}

/* ---------- standalone ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), OUT = path.join(ROOT, 'docs/screens');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const checks = [], errors = [], metrics = {};
  const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
  const watch = (page, tag) => {
    page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: 'x', body: '' }) : '[]' }));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); }); page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try { await lanesUiSection({ browser, BASE, OUT, check, watch, metrics }); } catch (e) { check('lanes ui section ran to the end', false, e.stack); }
  await browser.close(); server.close();
  check('lanes ui: zero console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  const mf = path.join(OUT, 'metrics.json'); let all = {}; try { all = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { all = {}; }
  all.lanes_ui = { date: new Date().toISOString(), ...metrics.lanes_ui }; fs.writeFileSync(mf, JSON.stringify(all, null, 1));
  const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} lanes ui checks passed; ${errors.length} console errors`);
  process.exit(failed.length ? 1 : 0);
}
