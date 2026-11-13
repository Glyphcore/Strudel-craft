// Atoms A4 (#64) section of the site smoke test: lazy reference-counted atom cards in the Graph view, derived cards, the atom
// browser (type filter from the port, pages of 50, More / scroll), the code-editor reference popover, the keyboard-only path,
// targets / contrast, reduced motion and the 5000-atom first-paint comparison. Called from tests/site/smoke.mjs; also runs alone:
//   node tests/site/atoms_ui.mjs      (serves site/, writes docs/screens/phone-390-atom-*.png, merges "atoms_ui" into metrics.json)
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const LINE = (t) => t.split('\n');
const diff = (a, b) => ({ added: LINE(b).filter((l) => !LINE(a).includes(l)), removed: LINE(a).filter((l) => !LINE(b).includes(l)) });
const PROG = `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}", doc: "four on the floor" })
atom("loud", { type: "mini", body: "0.8 0.6" })
atom("atDrop", { type: "gate", body: "@17b" })
atom("onDrop", { type: "point", body: "17b" })
atom("hats", { type: "mini", body: "hh*8" })
hooks.def("murk", { chain: [["lpf", 400]] })
hooks.bind("bass/fx", "murk")
kick: s(atoms.kick4).gain(0.8)
k2: s(atoms.kick4({ n: 8 })).gain(0.5)
hat: s(atoms.hats).gain(0.5)
bass: note("c2 eb2").s("sawtooth").gain(0.7).use("fx")
`;
const BIG = (n) => { let s = ''; for (let i = 0; i < n; i++) s += `atom("p${i}", { type: "mini", body: "bd*${(i % 8) + 1}" })\n`; return s + 'a: s(atoms.p0).gain(0.8)\nb: s(atoms.p1).gain(0.6)\nc: s(atoms.p2).gain(0.4)\n'; };

// WCAG contrast of visible text inside the given selectors, against the composited background
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

export async function atomsUiSection({ browser, BASE, OUT, check, watch, metrics }) {
  const M = (metrics.atoms_ui = {});
  const settle = (page, ms = 450) => page.waitForTimeout(ms);
  const openGraph = async (page) => { await page.click('.views a[data-view="graph"]'); await page.waitForFunction(() => window.__graph && window.strudelCraft.atomsUI && document.querySelector('.gx .gn'), null, { timeout: 20000 }); };
  const load = async (page, text) => { await page.evaluate((t) => { const ta = document.getElementById('gxCode'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, text); await page.waitForFunction((t) => window.__graph.text === t, text); await settle(page, 200); };
  const cards = (page) => page.evaluate(() => window.strudelCraft.atomsUI.cards());
  const text = (page) => page.evaluate(() => window.__graph.text);
  const card = (cs, name, derived = false) => cs.find((c) => c.name === name && c.derived === derived);

  /* ---------- phone 390, touch ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, 'atoms-390');
    const reqs = []; page.on('request', (r) => reqs.push(r.url()));
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(1200);
    check('atoms ui: atoms-ui.js / atoms-pop.js are not loaded with the shell', !reqs.some((u) => /atoms-(ui|pop)\.(js|css)/.test(u)));
    await openGraph(page); await page.evaluate(() => window.__graph.reset());
    check('atoms ui: atoms-ui.js loads with the Graph view', reqs.some((u) => /atoms-ui\.js/.test(u)));
    await load(page, PROG);

    // lazy cards: only referenced atoms get a card (5 declared, 2 referenced + 1 derived reference)
    let cs = await cards(page); const dom = await page.locator('.gk-atom').count();
    check('atoms ui: cards only for referenced atoms (5 declared, kick4 + derived kick4({ n: 8 }) + hats)', cs.length === 3 && dom === 3 && !cs.some((c) => ['loud', 'atDrop', 'onDrop'].includes(c.name)), `${cs.map((c) => c.name + (c.derived ? '*' : '') + ' x' + c.count).join(', ')}; ${dom} in DOM`);
    const dv = card(cs, 'kick4', true);
    const link = await page.evaluate(() => window.__graph.view.wires.filter((w) => w.atom && w.to.port === 'from').map((w) => `${w.from.node}>${w.to.node}`));
    check('atoms ui: derived atoms.kick4({ n: 8 }) has its own card linked to the kick4 card', !!dv && dv.parent === 'atom:az1dsgr' && link.length === 1 && link[0].startsWith('atom:az1dsgr>'), JSON.stringify(link));

    // derived arg edit rewrites only that argument
    const t0 = await text(page);
    await page.evaluate((id) => window.__graph.center(id, 1), dv.id); await settle(page);
    const argIn = page.locator(`.ax-in[data-card='${dv.id}'][data-field=arg][data-param=n]`);
    await argIn.fill('6'); await argIn.press('Enter'); await settle(page);
    const d1 = diff(t0, await text(page));
    check('atoms ui: changing n on the derived card rewrites only that argument', d1.added.length === 1 && d1.removed.length === 1 && d1.added[0] === 'k2: s(atoms.kick4({ n: 6 })).gain(0.5)' && d1.removed[0] === 'k2: s(atoms.kick4({ n: 8 })).gain(0.5)', JSON.stringify(d1));
    M.derived_edit = d1;

    // reference counting via the browser from a port: tap kick.gain, Atoms, pick loud; then hat.gain -> loud
    const wireLoud = async (track) => {
      await page.evaluate((id) => window.__graph.center(id, 1), `track:${track}`); await settle(page);
      await page.tap(`.gp[data-node="track:${track}"][data-port="gain"]`); await page.tap('#gxAtoms'); await page.waitForSelector('.ax-rowb');
      const types = await page.$$eval('.ax-chip', (b) => b.map((x) => x.textContent));
      await page.tap('.ax-rowb[data-name="loud"]'); await settle(page);
      return types;
    };
    const types1 = await wireLoud('kick'); cs = await cards(page);
    const loud1 = card(cs, 'loud');
    const types2 = await wireLoud('hat'); cs = await cards(page);
    const loud2 = cs.filter((c) => c.name === 'loud');
    const shown = await page.$eval(`.gn[data-id="atom:${loud2[0] ? loud2[0].id.slice(5) : ''}"] .ax-n`, (e) => e.textContent).catch(() => null);
    check('atoms ui: browser from a param port filters by the port (gain: MINI)', types1.join() === 'MINI' && types2.join() === 'MINI', types1.join());
    check('atoms ui: a second port on the same atom raises the shown count to 2, no second card', loud1 && loud1.count === 1 && loud2.length === 1 && loud2[0].count === 2 && shown === '×2', `after 1: ${loud1 && loud1.count}; after 2: ${loud2.map((c) => c.count)} shown "${shown}"`);
    const pos = await page.evaluate(() => { const e = document.querySelector('.gn[data-id="atom:a2985tv"]'); return e && [e.style.left, e.style.top]; });
    await page.evaluate(() => window.__graph.center('atom:a2985tv', 1)); await settle(page);
    await page.screenshot({ path: path.join(OUT, 'phone-390-atom-card.png') });

    // remove both references (Detach in the card inspector), card goes; undo brings it back at the same position
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.__graph.center('atom:a2985tv', 1)); await settle(page, 300);
      await page.tap('.gn[data-id="atom:a2985tv"] .gn-head'); await page.waitForSelector('[data-act=ax-detach]');
      await page.tap('[data-act=ax-detach]'); await settle(page, 300);
    }
    const gone = (await cards(page)).filter((c) => c.name === 'loud').length;
    await page.evaluate(() => window.__graph.undo()); await settle(page, 300);
    const back = await page.evaluate(() => { const e = document.querySelector('.gn[data-id="atom:a2985tv"]'); return e && [e.style.left, e.style.top]; });
    const backCount = card(await cards(page), 'loud');
    check('atoms ui: removing both references removes the card; undo brings it back at the same position', gone === 0 && back && pos && back[0] === pos[0] && back[1] === pos[1] && backCount && backCount.count === 1, `gone ${gone}; before ${pos}; after undo ${back}`);
    await page.evaluate(() => window.__graph.redo()); await settle(page, 300);

    // body edit: every referencing node's preview follows after one commit; one declaration line changes
    const t2 = await text(page); const past0 = await page.evaluate(() => window.__graph.text);
    await page.evaluate(() => window.__graph.center('atom:az1dsgr', 1)); await settle(page);
    const bodyIn = page.locator(`.ax-in[data-card='atom:az1dsgr'][data-field=body]`);
    let commits = 0; await page.exposeFunction('__axCommit', () => { commits++; }).catch(() => {});
    await page.evaluate(() => { const ta = document.getElementById('gxCode'); const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'); let last = ta.value; const iv = setInterval(() => { if (d.get.call(ta) !== last) { last = d.get.call(ta); window.__axCommit(); } }, 5); setTimeout(() => clearInterval(iv), 3000); });
    await bodyIn.fill('bd*${n} [~ sd]'); await bodyIn.press('Enter'); await settle(page, 600);
    const t3 = await text(page); const d3 = diff(t2, t3);
    const pv = await page.evaluate(() => [...document.querySelectorAll('.gn-steps')].map((e) => e.textContent));
    const kickPv = pv.find((s) => s.includes('atoms.kick4 ')), k2Pv = pv.find((s) => s.includes('atoms.kick4(n: 6)'));
    check('atoms ui: editing the card body updates every referencing node preview after one commit', commits === 1 && kickPv && kickPv.includes('"bd*4 [~ sd]"') && k2Pv && k2Pv.includes('"bd*6 [~ sd]"'), `commits ${commits}; ${kickPv} | ${k2Pv}`);
    check('atoms ui: the code shows one changed declaration line', d3.added.length === 1 && d3.removed.length === 1 && /^atom\("kick4"/.test(d3.added[0]) && d3.added[0].includes('"bd*${n} [~ sd]"'), JSON.stringify(d3)); void past0;
    M.body_edit = { commits, diff: d3 };

    // browser from a gate port: gate / point atoms only
    await page.evaluate(() => window.__graph.center('slot:bass/fx', 1)); await settle(page);
    await page.tap('.gp[data-node="slot:bass/fx"][data-port="gate:b1"]'); await page.tap('#gxAtoms'); await page.waitForSelector('.ax-rowb');
    const gateRows = await page.$$eval('.ax-rowb', (b) => b.map((x) => [x.dataset.name, x.querySelector('.ax-badge').textContent]));
    check('atoms ui: browser from a gate port lists only gate / point atoms', gateRows.length === 2 && gateRows.every(([, t]) => t === 'GATE' || t === 'POINT'), JSON.stringify(gateRows));
    await page.tap('.ax-rowb[data-name="atDrop"]'); await settle(page);
    check('atoms ui: choosing a gate atom sets the binding gate', /hooks\.bind\("bass\/fx", "murk", atoms\.atDrop\)/.test(await text(page)));

    // catalog namespace: 50 per page, More and scroll fetch the next page
    await page.evaluate(() => window.strudelCraft.atoms.configure({ catalog: { ...(window.strudelCraft.atoms.config().catalog || {}), snd: Array.from({ length: 180 }, (_, i) => 'smp' + String(i).padStart(3, '0')) } }));
    await page.evaluate(() => window.__graph.center('track:kick', 1)); await settle(page);
    await page.tap('.gp[data-node="track:kick"][data-port="s"]'); await page.tap('#gxAtoms'); await page.waitForSelector('.ax-rowb');
    await page.tap('.ax-nsb[data-ns=snd]'); await settle(page, 150);
    const p1 = await page.locator('.ax-rowb').count();
    await page.evaluate(() => document.querySelector('.ax-more').click()); await settle(page, 150); const p2 = await page.locator('.ax-rowb').count();
    await page.evaluate(() => { const s = document.querySelector('.gx-sheet'); s.scrollTop = s.scrollHeight; }); await settle(page, 400); const p3 = await page.locator('.ax-rowb').count();
    check('atoms ui: catalog namespace shows 50 rows per page; More and scroll fetch the next page', p1 === 50 && p2 === 100 && p3 === 150, `${p1} -> More ${p2} -> scroll ${p3}`);
    M.browser_pages = [p1, p2, p3];
    await page.evaluate(() => { const s = document.querySelector('.gx-sheet'); s.scrollTop = 0; });
    await page.tap('.ax-nsb[data-ns=doc]'); await settle(page, 150);
    await page.evaluate(() => { const s = document.querySelector('.gx-sheet'), q = document.querySelector('.ax-types'); s.scrollTop = q.offsetTop - 8; }); await settle(page, 150);
    await page.screenshot({ path: path.join(OUT, 'phone-390-atom-browser.png') });

    // targets and contrast at 390
    const tBrowser = await page.evaluate(TARGETS, '.ax-br button, .ax-br input, .gx-sheet [data-act=close]');
    const cBrowser = await page.evaluate(CONTRAST, '.ax-br *');
    await page.keyboard.press('Escape'); await settle(page, 200);
    await page.evaluate(() => window.__graph.center('atom:az1dsgr', 1)); await settle(page);
    const tCard = await page.evaluate(TARGETS, '.gk-atom .ax-in, .gk-atom .gn-head, .gk-atom .gp');
    const cCard = await page.evaluate(CONTRAST, '.gk-atom *');
    const badges = await page.$$eval('.gk-atom .ax-badge', (b) => b.map((x) => x.textContent.trim()));
    M.targets = { card: tCard, browser: tBrowser }; M.contrast = { card: cCard, browser: cBrowser }; M.type_badges = badges;
    check('atoms ui: card controls and browser rows at least 44 x 44 CSS px at 390', tCard.min_w >= 44 && tCard.min_h >= 44 && tBrowser.min_w >= 44 && tBrowser.min_h >= 44, JSON.stringify({ tCard, tBrowser }));
    check('atoms ui: card and browser text contrast at least 7:1; type shown as a text badge', cCard.min >= 7 && cBrowser.min >= 7 && badges.length >= 3 && badges.every((b) => /^[A-Z]+$/.test(b)), JSON.stringify({ cCard, cBrowser, badges }));

    // code-editor popover: tap, Enter, Escape, Detach, no layout shift
    await page.tap('.views a[data-view="rack"]').catch(() => page.evaluate(() => window.__sc.setView && window.__sc.setView('rack')));
    await page.waitForFunction(() => { const t = document.getElementById('code'); return t && t.cmView && window.strudelCraft.atoms && window.strudelCraft.atoms.ready; }, null, { timeout: 30000 });
    const CODE = 'atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*${n}" })\n$: s(atoms.kick4).gain(0.8)\n$: s(atoms.kick4({ n: 8 })).gain(0.5)\n';
    await page.evaluate((c) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); }, CODE);
    await page.waitForFunction(() => document.getElementById('code').cmView.__axPop, null, { timeout: 20000 });
    const ref = await page.evaluate(() => { const v = document.getElementById('code').cmView; const d = v.state.doc.toString(); const i = d.indexOf('atoms.kick4)') + 3; v.dom.scrollIntoView({ block: 'start' }); const c = v.coordsAtPos(i); return { i, x: c.left + 2, y: (c.top + c.bottom) / 2 }; });
    const boxes = () => page.evaluate(() => [...document.querySelectorAll('#code ~ .cm-editor .cm-line, .cm-editor .cm-line')].slice(0, 6).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v)).join(','); }).join(' '));
    const b0 = await boxes();
    await page.touchscreen.tap(ref.x, ref.y); await page.waitForSelector('.ax-pop', { timeout: 8000 }).catch(() => null);
    const tapOpen = await page.locator('.ax-pop').count(); const b1 = await boxes();
    const popTxt = await page.locator('.ax-pop').textContent().catch(() => '');
    await page.keyboard.press('Escape'); await settle(page, 150);
    const escClosed = (await page.locator('.ax-pop').count()) === 0;
    await page.evaluate((i) => { const v = document.getElementById('code').cmView; v.focus(); v.dispatch({ selection: { anchor: i } }); }, ref.i);
    const before = await page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
    await page.keyboard.press('Enter'); await page.waitForSelector('.ax-pop', { timeout: 8000 }).catch(() => null);
    const enterOpen = await page.locator('.ax-pop').count(); const afterEnter = await page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
    check('atoms ui: popover opens on tap and on Enter with the caret on a reference (Enter inserts nothing)', tapOpen === 1 && enterOpen === 1 && before === afterEnter && /bd\*4/.test(popTxt), `tap ${tapOpen}, enter ${enterOpen}; "${popTxt.slice(0, 80)}"`);
    check('atoms ui: Escape closes the popover; opening it shifts no code line', escClosed && b0 === b1, `${b0} | ${b1}`);
    const cnt = () => page.evaluate(() => { const a = window.strudelCraft.atoms; const doc = document.getElementById('code').cmView.state.doc.toString(); return { sites: a.sites(doc).filter((s) => s.atom === 'kick4').length, card: (window.__graph ? (window.__graph.parse(doc) && a.atomCards(window.__graph.parse(doc)).find((c) => c.name === 'kick4') || {}).count : null) }; });
    const c0 = await cnt();
    await page.tap('.ax-pop [data-ax=detach]'); await settle(page, 300);
    const c1 = await cnt(); const doc1 = await page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
    check('atoms ui: Detach replaces that one reference with its compiled string; the card count drops by 1', c1.sites === c0.sites - 1 && c1.card === c0.card - 1 && doc1.includes('$: s("bd*4").gain(0.8)') && doc1.includes('atoms.kick4({ n: 8 })'), `${JSON.stringify(c0)} -> ${JSON.stringify(c1)}`);
    M.popover = { tap: tapOpen, enter: enterOpen, escape_closes: escClosed, line_boxes_unchanged: b0 === b1, count: [c0, c1] };
    await ctx.close();
  }

  /* ---------- keyboard only (desktop 1440) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, 'atoms-kbd');
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
    await page.click('.views a[data-view="graph"]'); await page.waitForFunction(() => window.__graph && window.strudelCraft.atomsUI && document.querySelector('.gx .gn'), null, { timeout: 20000 });
    await page.evaluate(() => window.__graph.reset()); await load(page, PROG);
    const t0 = await text(page);
    const tabTo = async (sel, max = 400) => { for (let i = 0; i < max; i++) { if (await page.evaluate((s) => document.activeElement && document.activeElement.matches(s), sel)) return true; await page.keyboard.press('Tab'); } return false; };
    const steps = [];
    steps.push(await tabTo('#gxTab-outline')); await page.keyboard.press('Enter');
    steps.push(await tabTo('[data-act=connect][data-node="track:hat"]')); await page.keyboard.press('Enter'); await settle(page, 200);
    steps.push(await tabTo('[data-act=ax-for][data-node="track:hat"][data-port="gain"]', 60)); await page.keyboard.press('Enter'); await page.waitForSelector('.ax-q');
    steps.push(await page.evaluate(() => document.activeElement.matches('.ax-q')));
    await page.keyboard.type('lou'); await settle(page, 100); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await settle(page, 300);
    const d = diff(t0, await text(page));
    check('atoms ui: keyboard only (Tab, Enter, type, ArrowDown) creates an atom reference on a port', steps.every(Boolean) && d.added.length === 1 && d.added[0] === 'hat: s(atoms.hats).gain(atoms.loud)', `steps ${steps}; ${JSON.stringify(d)}`);
    M.keyboard = { steps, diff: d };
    await ctx.close();
  }

  /* ---------- reduced motion ---------- */
  {
    const run = async (reducedMotion) => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
      const page = await ctx.newPage(); watch(page, 'atoms-rm-' + reducedMotion);
      await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await openGraph(page); await page.evaluate(() => window.__graph.reset()); await load(page, PROG);
      await load(page, PROG.replace('hat: s(atoms.hats).gain(0.5)', 'hat: s(atoms.hats).gain(atoms.loud)'));
      const appear = await page.evaluate(() => { const e = document.querySelector('.gn.ax-new'); return e ? getComputedStyle(e).animationName : 'no-new-card'; });
      await load(page, PROG);
      const ghosts = await page.locator('.ax-ghost').count(); const ghostAnim = ghosts ? await page.evaluate(() => getComputedStyle(document.querySelector('.ax-ghost')).animationName) : 'none';
      await ctx.close(); return { appear, ghosts, ghostAnim };
    };
    const full = await run('no-preference'), red = await run('reduce');
    M.reduced_motion = { full, reduce: red };
    check('atoms ui: card appear / disappear animate, and not with reduced motion', full.appear === 'ax-appear' && full.ghosts === 1 && red.appear === 'none' && red.ghosts === 0, JSON.stringify(M.reduced_motion));
  }

  /* ---------- lazy cards at scale: 5000 declared atoms, 3 referenced ---------- */
  {
    const firstPaint = async (prog) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); watch(page, 'atoms-scale');
      await page.addInitScript((t) => { try { localStorage.setItem('sc.graph', JSON.stringify(t)); localStorage.setItem('sc.graph.pos', '{}'); } catch (e) { /* none */ } }, prog);
      await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(800);
      const ms = await page.evaluate(() => new Promise((res) => {
        const t0 = performance.now(); document.querySelector('.views a[data-view="graph"]').click();
        const poll = () => { if (document.querySelector('.gx .gk-atom')) requestAnimationFrame(() => res(performance.now() - t0)); else setTimeout(poll, 2); }; poll();
      }));
      const n = await page.locator('.gk-atom').count(); const scene = await page.evaluate(() => window.strudelCraft.atomsUI.cards().length);
      await ctx.close(); return { ms: +ms.toFixed(1), dom_cards: n, scene_cards: scene };
    };
    const big = BIG(5000), small = BIG(3);
    const rounds = []; for (let i = 0; i < 3; i++) rounds.push({ small: await firstPaint(small), big: await firstPaint(big) });
    const med = (k) => rounds.map((r) => r[k].ms).sort((a, b) => a - b)[1];
    const sm = med('small'), bg = med('big'), delta = +(((bg - sm) / sm) * 100).toFixed(1);
    M.lazy = { declared_5000: { first_paint_ms: bg, dom_cards: rounds[0].big.dom_cards, scene_cards: rounds[0].big.scene_cards }, declared_3: { first_paint_ms: sm, dom_cards: rounds[0].small.dom_cards }, delta_pct: delta, rounds };
    check('atoms ui: 5000 declared atoms and 3 referenced render exactly 3 atom cards', rounds.every((r) => r.big.dom_cards === 3 && r.big.scene_cards === 3 && r.small.dom_cards === 3), JSON.stringify(rounds.map((r) => [r.big.dom_cards, r.small.dom_cards])));
    // reported, not gated here: parse() is lazy (tests/atoms/a4_lazy.mjs); what remains is anything that enumerates model.atoms (docs/ATOMS.md, laziness)
    console.log(`INFO  atoms ui: Graph first paint 3 declared ${sm} ms, 5000 declared ${bg} ms (${delta}% ; gate 10%)`);
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
  try { await atomsUiSection({ browser, BASE, OUT, check, watch, metrics }); } catch (e) { check('atoms ui section ran to the end', false, e.stack); }
  await browser.close(); server.close();
  check('atoms ui: zero console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  const mf = path.join(OUT, 'metrics.json'); let all = {}; try { all = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { all = {}; }
  all.atoms_ui = { date: new Date().toISOString(), ...metrics.atoms_ui }; fs.writeFileSync(mf, JSON.stringify(all, null, 1));
  const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} atoms ui checks passed; ${errors.length} console errors`);
  process.exit(failed.length ? 1 : 0);
}
