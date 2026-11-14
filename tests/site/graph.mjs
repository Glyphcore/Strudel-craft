// Graph view section of the site smoke test (issue #52). Called from tests/site/smoke.mjs; also runs alone:
//   node tests/site/graph.mjs        (serves site/, writes docs/screens/*-graph.png and merges "graph" into docs/screens/metrics.json)
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const LINE = (t) => t.split('\n');
const diff = (a, b) => ({ added: LINE(b).filter((l) => !LINE(a).includes(l)), removed: LINE(a).filter((l) => !LINE(b).includes(l)) });

// WCAG contrast of every visible text element inside .gx against its composited background
const CONTRAST = () => {
  const rgba = (s) => { const m = s.match(/[\d.]+/g); if (!m) return [0, 0, 0, 0]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let bg = [255, 255, 255, 1]; for (const l of layers.reverse()) bg = over(l, bg); return bg; };
  let min = Infinity, worst = null, n = 0;
  const els = [...document.querySelectorAll('.gx *')].filter((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  for (const e of els) {
    if (e.closest('[disabled], .dim, .gx-mirror, [aria-hidden=true] .gx-mirror')) continue;
    const cs = getComputedStyle(e); if (cs.color === 'rgba(0, 0, 0, 0)' || parseFloat(cs.opacity) === 0) continue;
    const bg = bgOf(e), fg = over(rgba(cs.color), bg); const L1 = lum(fg), L2 = lum(bg); const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); n++;
    if (r < min) { min = r; worst = `${e.tagName.toLowerCase()}.${e.className} "${e.textContent.trim().slice(0, 30)}" ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)})`; }
  }
  return { min: +min.toFixed(2), n, worst };
};
const TARGETS = () => {
  const els = [...document.querySelectorAll('.gx button, .gx input, .gx select, .gx [role=tab]')].filter((e) => e.getClientRects().length && !e.closest('[hidden]'));
  const vp = document.querySelector('.gx-vp').getBoundingClientRect();
  const vis = els.filter((e) => { if (!e.closest('.gx-world')) return true; const r = e.getBoundingClientRect(); return r.right > vp.left && r.left < vp.right && r.bottom > vp.top && r.top < vp.bottom; });
  const rs = vis.map((e) => ({ e, r: e.getBoundingClientRect() }));
  const small = rs.filter(({ r }) => r.width < 44 || r.height < 44).map(({ e, r }) => `${e.className || e.tagName}:${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
  const ports = rs.filter(({ e }) => e.classList.contains('gp'));
  return { n: rs.length, ports: ports.length, min_w: +Math.min(...rs.map(({ r }) => r.width)).toFixed(1), min_h: +Math.min(...rs.map(({ r }) => r.height)).toFixed(1), port_min: ports.length ? [+Math.min(...ports.map(({ r }) => r.width)).toFixed(1), +Math.min(...ports.map(({ r }) => r.height)).toFixed(1)] : null, small: small.slice(0, 8) };
};

// Queried events of a program before and after a remapped collapse, in node: unmodified @strudel/core + @strudel/mini (node_modules or
// STRUDEL_MODULES) with site/engine/hooks.js; the instance plays through the library's hooks.inst (installInstances), with the record the
// browser saved. Structured tracks are built step by step ($mini -> mini, $tap -> tap(...).range). Returns { skip } without Strudel.
async function remapEvents(before, after, rec, control) {
  const { bootRuntime, haps } = await import('../hooks/fixtures/rt.mjs');
  const RT = await bootRuntime(); if (!RT) return { skip: '@strudel/core/@strudel/mini not installed (set STRUDEL_MODULES=<dir with @strudel/>)' };
  const { parse } = await import('../../site/model.js'), { createLibrary, installInstances } = await import('../../site/library.js'), { fallbackStore } = await import('../../site/library-store.js');
  const mem = () => { const o = {}; return { getItem: (k) => o[k] ?? null, setItem: (k, v) => { o[k] = v; } }; };
  const L = createLibrary(fallbackStore(mem())); L.store.put(rec);
  const sub = (v) => (Array.isArray(v) ? v.map(sub) : v && typeof v === 'object' ? ('$mini' in v ? RT.S.mini(v.$mini) : '$tap' in v ? (v.range ? RT.tap(v.$tap).range(...v.range) : RT.tap(v.$tap)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]))) : v);
  const track = (t) => { let p = RT.S[t.source[0]](...t.source.slice(1).map(sub)); for (const [m, ...a] of t.chain || []) p = p[m](...a.map(sub)); return p; };
  const events = (text) => {
    RT.hooks.reset(); RT.hooks.live = false; installInstances(RT.hooks, { lib: L, S: RT.S, tap: RT.tap });
    const m = parse(text), pats = (m.tracks || []).map(track);
    for (const i of m.instances || []) pats.push(RT.hooks.inst(i.component, { as: i.as, ...(i.remap ? { remap: i.remap } : {}), ...(i.args ? { args: i.args } : {}) }));
    return haps(RT.S.stack(...pats), 0, 4).map((h) => JSON.stringify([h.b, h.v])).sort();
  };
  const a = events(before), b = events(after), c = control ? events(control) : null; // control: a program reading another tap, so the comparison is shown to see the tap
  return { before: a.length, after: b.length, same: JSON.stringify(a) === JSON.stringify(b), control_differs: c ? JSON.stringify(c) !== JSON.stringify(a) : null, sample: b.filter((x) => x.includes('hh')).slice(0, 2) };
}

export async function graphSection({ browser, BASE, OUT, check, watch, metrics }) {
  const M = (metrics.graph = {});
  const gx = (page) => page.waitForFunction(() => window.__graph && document.querySelector('.gx .gn'), null, { timeout: 20000 });
  const settle = (page) => page.waitForTimeout(450);

  /* ---------- phone 390, touch ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, 'graph-390');
    const reqs = []; page.on('request', (r) => reqs.push(r.url()));
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.waitForTimeout(1500);
    const shellGraph = reqs.filter((u) => /\/graph\.(js|css)(\?|$)/.test(u));
    const shellBytes = await page.evaluate(() => performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation')).filter((e) => !/unpkg|esm\.sh|github/.test(e.name)).reduce((s, e) => s + (e.encodedBodySize || 0), 0));
    M.shell = { graph_files_requested_with_shell: shellGraph.length, shell_same_origin_bytes: shellBytes };
    check('graph: graph.js / graph.css are not loaded with the shell', shellGraph.length === 0, `${shellGraph.length} graph requests on first load; shell ${shellBytes} B same-origin`);
    await page.tap('.views a[data-view="graph"]'); await gx(page);
    check('graph: view opens from the nav and loads graph.js on first open', reqs.some((u) => /\/graph\.js/.test(u)) && (await page.getAttribute('#main', 'data-view')) === 'graph');
    await page.evaluate(() => window.__graph.reset()); await page.evaluate(() => window.__graph.zoomTo(1));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth); check('graph: no horizontal scroll at 390px', sw <= 390, `scrollWidth ${sw}`);

    // touch wiring without drag: tap port, tap compatible port
    const t0 = await page.evaluate(() => window.__graph.text);
    await page.evaluate(() => window.__graph.center('def:murk', 1)); await settle(page);
    await page.tap('.gp[data-node="def:murk"][data-port="out"]');
    const armed = await page.evaluate(() => window.__graph.armed && window.__graph.armed.node);
    await page.evaluate(() => window.__graph.center('slot:bass/fx', 1)); await settle(page);
    const lit = await page.getAttribute('.gp[data-node="slot:bass/fx"][data-port="hook"]', 'class');
    const dimmed = await page.locator('.gp.dim').count();
    await page.tap('.gp[data-node="slot:bass/fx"][data-port="hook"]'); await settle(page);
    const t1 = await page.evaluate(() => window.__graph.text); const d1 = diff(t0, t1);
    const wired = await page.evaluate(() => window.__graph.view.wires.filter((w) => w.type === 'hook').map((w) => w.id));
    check('graph: tap port, tap compatible port creates the wire (touch, 390px)', armed === 'def:murk' && /\blit\b/.test(lit) && dimmed > 0 && wired.length === 1, `armed ${armed}; target "${lit}"; ${dimmed} ports dimmed; wires ${wired}`);
    check('graph: wiring hook -> slot adds exactly one hooks.bind line to the code', d1.added.length === 1 && /^hooks\.bind\("bass\/fx", "murk"\)$/.test(d1.added[0]) && d1.removed.length === 0, JSON.stringify(d1));
    M.two_views = { added: d1.added, removed: d1.removed };

    // incompatible target refused with a visible reason
    await page.evaluate(() => window.__graph.center('def:open', 1)); await settle(page);
    await page.tap('.gp[data-node="def:open"][data-port="out"]');
    await page.evaluate(() => window.__graph.center('track:kick', 1)); await settle(page);
    const tb = await page.evaluate(() => window.__graph.text);
    await page.tap('.gp[data-node="track:kick"][data-port="gain"]'); await page.waitForTimeout(200);
    const reason = await page.textContent('.gx-msg'); const vis = await page.isVisible('.gx-msg');
    check('graph: incompatible target is refused with a visible reason', vis && /^Refused: /.test(reason) && (await page.evaluate(() => window.__graph.text)) === tb, reason);
    M.refusal = reason;

    // delete the hooks.bind line in the code view -> the wire disappears
    await page.tap('.gx-tab[data-pane="code"]');
    await page.evaluate(() => { const ta = document.querySelector('#gxCode'); ta.value = ta.value.split('\n').filter((l) => !l.startsWith('hooks.bind(')).join('\n'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page);
    const after = await page.evaluate(() => window.__graph.view.wires.filter((w) => w.type === 'hook').length);
    check('graph: deleting the hooks.bind line in code removes the wire', after === 0 && (await page.evaluate(() => window.__graph.text)) === t0, `${after} hook wires left`);
    await page.tap('.gx-tab[data-pane="graph"]');

    // type bridging: tap -> param asks for facet and range, result is a .wire(...) argument
    await page.evaluate(() => window.__graph.center('tap:kick', 1)); await settle(page);
    await page.tap('.gp[data-node="tap:kick"][data-port="ev"]');
    await page.evaluate(() => window.__graph.center('track:bass', 1)); await settle(page);
    await page.tap('.gp[data-node="track:bass"][data-port="lpf"]');
    await page.waitForSelector('.gx-sheet form[data-bridge] input[name=facet]');
    const asked = await page.evaluate(() => ({ facets: [...document.querySelectorAll('.gx-sheet input[name=facet]')].map((i) => i.value), range: !!document.querySelector('.gx-sheet input[name=lo]') && !!document.querySelector('.gx-sheet input[name=hi]') }));
    await page.tap('.gx-sheet input[value=env]'); await page.fill('.gx-sheet input[name=lo]', '200'); await page.fill('.gx-sheet input[name=hi]', '2000');
    const tw0 = await page.evaluate(() => window.__graph.text);
    await page.tap('.gx-sheet .gx-ok'); await settle(page);
    const tw1 = await page.evaluate(() => window.__graph.text); const dw = diff(tw0, tw1);
    const sigWire = await page.evaluate(() => window.__graph.view.wires.some((w) => w.type === 'signal' && w.from.node === 'tap:kick' && w.to.node === 'track:bass' && w.to.port === 'lpf'));
    check('graph: tap -> param asks facet and range and writes a .wire(...) in code', asked.facets.join() === 'onset,gate,env' && asked.range && dw.added.length === 1 && dw.added[0].includes('.wire("lpf", "kick:env", { range: [200, 2000] })') && sigWire, JSON.stringify({ asked, added: dw.added }));
    M.bridge = { asked, added: dw.added };

    // gate editing: two bindings; editing one binding's window rewrites only that line; the badge shows the window
    await page.evaluate(() => { const g = window.__graph; g.center('def:murk', 1); }); await settle(page);
    await page.tap('.gp[data-node="def:murk"][data-port="out"]'); await page.evaluate(() => window.__graph.center('slot:bass/fx', 1)); await settle(page); await page.tap('.gp[data-node="slot:bass/fx"][data-port="hook"]'); await settle(page);
    await page.evaluate(() => window.__graph.center('def:open', 1)); await settle(page);
    await page.tap('.gp[data-node="def:open"][data-port="out"]'); await page.evaluate(() => window.__graph.center('slot:bass/fx', 1)); await settle(page); await page.tap('.gp[data-node="slot:bass/fx"][data-port="hook"]'); await settle(page);
    const tg0 = await page.evaluate(() => window.__graph.text);
    const bid = await page.evaluate(() => window.__graph.view.wires.find((w) => w.binding && w.b.hook === 'murk').id);
    // the binding wire is picked from the outline list (its badge may sit under a node at this pan); the inspector opens over the canvas
    await page.tap('.gx-tab[data-pane="outline"]'); await page.tap(`.gx-outline [data-wire="${bid}"]`); await page.waitForSelector('.gx-sheet form[data-binding]');
    await page.fill('#gxG-from', '9b'); await page.tap('.gx-sheet [data-act=bar][aria-label="from one bar later"]'); await page.tap('.gx-sheet [data-act=bar][aria-label="from one bar earlier"]');
    await page.fill('#gxG-until', '17b'); await page.tap('.gx-sheet .gx-ok'); await settle(page);
    const tg1 = await page.evaluate(() => window.__graph.text); const dg = diff(tg0, tg1);
    const badge = await page.evaluate(() => { const w = window.__graph.view.wires.find((x) => x.binding && x.b.hook === 'murk'); return document.querySelector(`.gb[data-wire="${CSS.escape(w.id)}"]`).textContent; });
    check('graph: changing a binding window rewrites only that binding’s gate; badge shows the window', dg.removed.length === 1 && dg.removed[0] === 'hooks.bind("bass/fx", "murk")' && dg.added.length === 1 && dg.added[0] === 'hooks.bind("bass/fx", "murk", "9b..17b")' && tg1.includes('hooks.bind("bass/fx", "open")') && /9b\.\.17b/.test(badge), JSON.stringify({ ...dg, badge }));
    M.gate = { ...dg, badge };
    await page.tap('.gx-sheet [data-act=close]');
    await page.evaluate(() => { const g = window.__graph; const n = g.view.nmap.get('slot:bass/fx'); g.zoomTo(0.85, 366 - (n.x + 220) * 0.85 - 8, 170 - n.y * 0.85); }); await settle(page);
    await page.screenshot({ path: path.join(OUT, 'phone-390-graph.png') });

    // targets >= 44 px at mid zoom (100 % and the 85 % lower edge of mid)
    M.targets = {};
    for (const s of [1, 0.85]) { await page.evaluate((s) => { window.__graph.center('track:bass', s); }, s); await settle(page); M.targets['zoom_' + Math.round(s * 100)] = await page.evaluate(TARGETS); }
    const T = M.targets;
    check('graph: ports and controls >= 44x44 CSS px at mid zoom (390px)', Object.values(T).every((t) => t.min_w >= 44 && t.min_h >= 44 && t.ports > 0), JSON.stringify(T));

    // collapse: long-press starts multi-select, tap adds, Collapse to subgraph -> one component node with exported ports, breadcrumb
    await page.evaluate(() => window.__graph.center('track:hat', 1)); await settle(page);
    const cdp = await ctx.newCDPSession(page);
    const hb = await page.locator('.gn[data-id="track:hat"] .gn-head').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x + 40, y: hb.y + 20 }] }); await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100);
    const multi = await page.evaluate(() => window.__graph.sel);
    await page.evaluate(() => window.__graph.center('track:perc', 1)); await settle(page);
    await page.tap('.gn[data-id="track:perc"] .gn-head'); await page.waitForTimeout(100);
    const sel2 = await page.evaluate(() => window.__graph.sel);
    const before = await page.evaluate(() => window.__graph.model);
    await page.tap('.gx-selbar [data-act=collapse]'); await page.waitForSelector('dialog.scm input');
    await page.fill('dialog.scm input', 'drums'); await page.tap('dialog.scm .scm-ok'); await settle(page);
    const col = await page.evaluate(() => { const g = window.__graph; const comps = g.view.nodes.filter((n) => n.kind === 'component'); return { comps: comps.map((c) => ({ id: c.id, outs: c.outs.map((p) => p.name), sub: c.sub })), tracks: g.view.nodes.filter((n) => n.kind === 'track').map((n) => n.label), text: g.text }; });
    await page.evaluate(() => window.__graph.center('inst:drums', 1)); await settle(page);
    await page.tap('.gn[data-id="inst:drums"] .gn-head'); await page.waitForTimeout(120); await page.tap('.gn[data-id="inst:drums"] .gn-head'); await settle(page);
    const crumbs = await page.textContent('.gx-crumbs'); const path_ = await page.evaluate(() => window.__graph.path);
    const inner = await page.evaluate(() => window.__graph.view.nodes.map((n) => n.id));
    check('graph: long-press + tap multi-select, Collapse yields one component node with exported ports; entering shows the breadcrumb',
      multi.join() === 'track:hat' && sel2.join() === 'track:hat,track:perc' && col.comps.length === 1 && col.comps[0].outs.includes('hat') && !col.tracks.includes('hat') && !col.tracks.includes('perc') && /\$: hooks\.inst\("drums@\d+", \{ as: "drums" \}\)/.test(col.text) && path_.join('/') === 'drums' && /Song.*drums/.test(crumbs) && inner.includes('track:hat'),
      JSON.stringify({ multi, sel2, comps: col.comps, crumbs, inner }));
    // model-level playback equivalence (the CLI "strudel events" comparison is not available in this environment)
    const eq = await page.evaluate((before) => { const g = window.__graph; const flat = g.expand(g.model); const strip = (t) => (t.source ? JSON.stringify([t.source, ...(t.chain || [])].filter((s) => s[0] !== 'tap')) : t.src.trim()); const b = Object.fromEntries((before.tracks || []).map((t) => [t.name, strip(t)])); const a = Object.fromEntries((flat.tracks || []).map((t) => [t.name.replace(/^drums_/, ''), strip(t)])); return { same: JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]])) === JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])), before: Object.keys(b), after: (flat.tracks || []).map((t) => t.name) }; }, before);
    M.collapse = { comps: col.comps, crumbs: crumbs.trim(), expand_equivalent_chains: eq };
    check('graph: collapse keeps every track chain when the instance is expanded (model level)', eq.same, JSON.stringify(eq));
    await page.tap('.gx-crumb[data-depth="0"]'); await settle(page);

    // opaque code node: detected ports, no literal editors, text only
    await page.evaluate(() => window.__graph.reset()); await page.evaluate(() => window.__graph.center('code:code1', 1)); await settle(page);
    await page.tap('.gn[data-id="code:code1"] .gn-head'); await page.waitForSelector('.gx-sheet .gx-src');
    const op = await page.evaluate(() => { const n = window.__graph.view.nmap.get('code:code1'); return { ins: n.ins.map((p) => p.name), outs: n.outs.map((p) => p.name), editors: document.querySelectorAll('.gn[data-id="code:code1"] input, .gx-sheet .gx-lit').length, text: !!document.querySelector('.gx-sheet [data-act=edittext]') }; });
    await page.evaluate(() => window.__graph.center('tap:kick', 1)); await settle(page);
    await page.tap('.gp[data-node="tap:kick"][data-port="ev"]'); await page.evaluate(() => window.__graph.center('code:code1', 1)); await settle(page);
    const tc = await page.evaluate(() => window.__graph.text); await page.evaluate(() => window.__graph.center('code:code1', 1)); await settle(page); await page.tap('.gp[data-node="code:code1"][data-port="kick:env"]'); await page.waitForTimeout(150);
    const ref2 = await page.textContent('.gx-msg');
    check('graph: opaque code node renders detected ports and is not editable beyond text', op.ins.includes('kick:env') && op.outs.includes('out') && op.editors === 0 && op.text && /Refused: Opaque code/.test(ref2) && (await page.evaluate(() => window.__graph.text)) === tc, JSON.stringify({ ...op, refusal: ref2 }));
    M.opaque = op;

    // light theme contrast at 390 (dark measured on desktop)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await page.evaluate(() => window.__graph.center('track:bass', 1)); await page.tap('.gn[data-id="track:bass"] .gn-head'); await page.waitForTimeout(700);
    M.contrast_light_390 = await page.evaluate(CONTRAST);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(700);
    M.contrast_dark_390 = await page.evaluate(CONTRAST);

    // performance: 150 nodes / 300 wires, pan + pinch-like zoom, phone profile (390, 4x CPU throttle)
    await page.tap('.gx-sheet [data-act=close]').catch(() => {});
    await page.evaluate(() => window.__graph.fixture(150, 300)); await page.evaluate(() => window.__graph.zoomTo(0.7, 0, 0)); await settle(page);
    const nodesN = await page.locator('.gx .gn').count(), wiresN = await page.locator('.gx .gb').count();
    const run = (mode) => page.evaluate((mode) => new Promise((res) => { const g = window.__graph, d = []; let last = 0, i = 0; const t0 = performance.now(); const f = (t) => { if (last) d.push(t - last); last = t; i++; if (mode === 'pan') g.zoomTo(g.V.s, -((i * 9) % 1400), -((i * 5) % 900)); else { const s = 0.5 + 0.77 * (1 + Math.sin(i / 20)) / 2; g.zoomTo(s, 195 - (195 - g.V.x) * s / g.V.s, 300 - (300 - g.V.y) * s / g.V.s); } if (t - t0 < 4000) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); }), mode);
    // frame time = rAF interval. Timers are coarsened to 100 us, so one 60 Hz frame reads 16.6-16.8 ms; "vsync" rounds each interval to whole frames (x 16.67 ms)
    const VS = 1000 / 60;
    const st = (arr) => { const a = [...arr].sort((x, y) => x - y), q = a.map((x) => Math.max(1, Math.round(x / VS)) * VS); return { n: a.length, mean_ms: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2), p95_ms: +a[Math.floor(a.length * 0.95)].toFixed(2), p95_vsync_ms: +q[Math.floor(q.length * 0.95)].toFixed(2), dropped_pct: +(100 * a.filter((x) => x > VS * 1.5).length / a.length).toFixed(1), max_ms: +a[a.length - 1].toFixed(2) }; };
    const empty = await page.evaluate(() => new Promise((res) => { const d = []; let last = 0; const t0 = performance.now(); const f = (t) => { if (last) d.push(t - last); last = t; if (t - t0 < 2000) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); }));
    const pan = await run('pan'), zoom = await run('zoom');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const pan4 = await run('pan'), zoom4 = await run('zoom');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    M.perf = { profile: 'smoke phone profile: 390x844, dpr 2, touch', nodes: nodesN, wires: wiresN, empty_raf_loop: st(empty), pan: st(pan), zoom: st(zoom), all: st([...pan, ...zoom]), cpu4x: { pan: st(pan4), zoom: st(zoom4) } };
    check('graph: 150-node / 300-wire fixture pans and zooms with p95 frame time <= 16.7 ms (phone profile)', nodesN === 150 && wiresN === 300 && M.perf.all.p95_vsync_ms <= 16.7, JSON.stringify(M.perf));
    await page.evaluate(() => window.__graph.clearFixture());
    await ctx.close();
  }

  /* ---------- keyboard only through the outline (no pointer events) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, 'graph-kbd');
    await page.goto(BASE + '#graph'); await gx(page); await page.evaluate(() => window.__graph.reset());
    const pointerEvents = []; await page.exposeFunction('__ptr', (t) => pointerEvents.push(t));
    await page.evaluate(() => ['pointerdown', 'mousedown', 'touchstart'].forEach((t) => document.addEventListener(t, () => window.__ptr(t), true)));
    const t0 = await page.evaluate(() => window.__graph.text);
    await page.focus('#gxTab-outline'); await page.keyboard.press('Enter');
    await page.focus('.gx-outline [data-act=connect][data-node="def:murk"]'); await page.keyboard.press('Enter');
    await page.waitForSelector('.gx-sheet [data-act=pick]');
    let found = false;
    for (let i = 0; i < 12 && !found; i++) { const txt = await page.evaluate(() => document.activeElement && document.activeElement.textContent); if (/bass \/ fx/.test(txt || '')) found = true; else await page.keyboard.press('Tab'); }
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const d = diff(t0, await page.evaluate(() => window.__graph.text));
    const wires = await page.evaluate(() => [...document.querySelectorAll('.gx-outline [data-act=wire]')].map((b) => b.textContent));
    check('graph: keyboard-only wire through the outline list (Connect to...)', found && pointerEvents.length === 0 && d.added.length === 1 && d.added[0] === 'hooks.bind("bass/fx", "murk")' && wires.some((w) => /murk\.out → bass \/ fx\.hook/.test(w)), JSON.stringify({ found, pointer: pointerEvents.length, added: d.added }));
    M.keyboard = { added: d.added, pointer_events: pointerEvents.length };
    // one undo stack for graph edits and code edits
    await page.focus('#gxTab-code'); await page.keyboard.press('Enter'); await page.focus('#gxCode'); await page.keyboard.press('End'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n// note'); await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => window.__graph.text);
    await page.keyboard.press('Control+z'); const u1 = await page.evaluate(() => window.__graph.text);
    await page.keyboard.press('Control+z'); const u2 = await page.evaluate(() => window.__graph.text);
    check('graph: one undo stack covers a code edit and a graph edit', t2.trimEnd().endsWith('// note') && !u1.includes('// note') && u1.includes('hooks.bind') && u2 === t0, JSON.stringify({ t2: t2.slice(-30), u1: u1.slice(-30), u2eq: u2 === t0 }));
    await ctx.close();
  }

  /* ---------- collapse with required taps: remap (library "Requires and remap"; the CLI's library collapse writes the same) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, 'graph-remap');
    await page.goto(BASE + '#graph'); await gx(page); await page.evaluate(() => window.__graph.reset());
    const DUCK = 'duck: s("hh*4").gain(tap("kick:env").range(0.2, 1))';
    const select = async (id) => { await page.evaluate((id) => window.__graph.center(id, 1), id); await settle(page); if ((await page.getAttribute('#gxMulti', 'aria-pressed')) !== 'true') await page.click('#gxMulti'); if (!(await page.evaluate((id) => window.__graph.sel.includes(id), id))) await page.click(`.gn[data-id="${id}"] .gn-head`); await page.waitForTimeout(80); };
    const name = async (n) => { await page.waitForSelector('dialog.scm input'); await page.fill('dialog.scm input', n); await page.click('dialog.scm .scm-ok'); await settle(page); };
    // the library's own output for the same input: generate(replaceWithInstance(model, ids, { component, as, remap }))
    const expected = (t0, ids, inst) => page.evaluate(({ t0, ids, inst }) => { const g = window.__graph; return g.generate(g.replaceWithInstance(g.parse(t0), ids, inst)); }, { t0, ids, inst });
    const revOf = (t, n) => +(new RegExp(`hooks\\.inst\\("${n}@(\\d+)"`).exec(t) || [])[1];
    const R = (M.remap = {});

    // 1. one required tap, one provider: automatic remap { kick: "kick" }, no modal
    const t0 = `setcpm(30)\nkick: s("bd ~ ~ bd").gain(0.8).tap("kick")\n${DUCK}\n`;
    await page.evaluate((t) => window.__graph.load(t), t0); await settle(page);
    await select('track:duck'); await page.click('.gx-selbar [data-act=collapse]');
    const sawRemapModal = await page.waitForSelector('dialog.scm[data-remap]', { timeout: 400 }).then(() => true, () => false);
    await name('duckc');
    const t1 = await page.evaluate(() => window.__graph.text), rev1 = revOf(t1, 'duckc');
    const want1 = await expected(t0, ['track:duck'], { component: `duckc@${rev1}`, as: 'duckc', remap: { kick: 'kick' } });
    const node1 = await page.evaluate(() => { const g = window.__graph, n = g.view.nmap.get('inst:duckc'); const b = document.querySelector('.gp[data-node="inst:duckc"][data-port="req:kick"]'); return { reqs: n.reqs, label: b && b.querySelector('.gp-l').textContent, err: n.err, wire: g.view.wires.some((w) => w.remap === 'kick' && w.from.node === 'tap:kick' && w.to.node === 'inst:duckc'), outline: (document.querySelector('.gx-outline [data-act=select][data-node="inst:duckc"]') || {}).textContent || '' }; });
    check('graph: collapse with one required tap and one provider remaps automatically; code equals the library replaceWithInstance output',
      !sawRemapModal && t1 === want1 && t1.includes('$: hooks.inst("duckc@' + rev1 + '", { as: "duckc", remap: { kick: "kick" } })') && node1.label === 'kick ← kick' && !node1.err && node1.wire && /requires kick ← kick/.test(node1.outline),
      JSON.stringify({ sawRemapModal, line: t1.split('\n').find((l) => l.includes('hooks.inst')), eq: t1 === want1, node1 }));
    R.auto = { line: t1.split('\n').find((l) => l.includes('hooks.inst')), equals_library_output: t1 === want1, port_label: node1.label, outline: node1.outline.trim() };
    // queried events before and after, node side: unmodified @strudel/core+mini + site/engine/hooks.js + library installInstances (hooks.inst)
    const rec1 = await page.evaluate((r) => window.__graph.lib.get('duckc', r), rev1);
    const ev = await remapEvents(t0, t1, rec1, t0.replace('tap("kick:env")', 'tap("none:env")'));
    if (ev.skip) console.log('SKIP  graph: remap collapse queried events before = after  -- ' + ev.skip);
    else check('graph: remap collapse: queried events identical before and after (hooks.inst with the remap, cycles 0-4)', ev.same && ev.before > 0 && ev.control_differs, JSON.stringify(ev));
    R.events = ev;
    // undo restores the original text exactly
    await page.click('#gxUndo'); await settle(page);
    const u1 = await page.evaluate(() => window.__graph.text);
    check('graph: undo after a remapped collapse restores the original text exactly', u1 === t0, JSON.stringify({ same: u1 === t0 }));

    // 2. two providers (two instances export kick): the site modal lists both; each choice gives the matching code
    const kr = await page.evaluate(() => window.__graph.lib.save({ model: 1, tracks: [{ name: 'k', source: ['s', { $mini: 'bd*4' }], chain: [['tap', 'kick']] }], exports: { taps: ['kick'], params: {} } }, { name: 'kicker', kind: 'track' }).rev);
    const t2 = `setcpm(30)\n$: hooks.inst("kicker@${kr}", { as: "a" })\n$: hooks.inst("kicker@${kr}", { as: "b" })\n${DUCK}\n`;
    await page.evaluate((t) => window.__graph.load(t), t2); await settle(page);
    const base2 = await page.evaluate(() => window.__graph.text);
    // cancel leaves the document byte-identical and asks nothing else
    await select('track:duck'); await page.click('.gx-selbar [data-act=collapse]'); await page.waitForSelector('dialog.scm[data-remap]');
    const choices = await page.evaluate(() => [...document.querySelectorAll('dialog.scm[data-remap] input[type=radio]')].map((i) => i.value));
    await page.click('dialog.scm[data-remap] button.ghost'); await settle(page);
    const c0 = await page.evaluate(() => ({ text: window.__graph.text, dialogs: document.querySelectorAll('dialog.scm').length, msg: document.querySelector('.gx-msg').textContent }));
    check('graph: two providers open the site modal listing both; Cancel leaves the document byte-identical', choices.join() === 'a/kick,b/kick' && c0.text === base2 && c0.dialogs === 0, JSON.stringify({ choices, same: c0.text === base2, dialogs: c0.dialogs, msg: c0.msg }));
    const pick = async (v) => {
      await select('track:duck'); await page.click('.gx-selbar [data-act=collapse]'); await page.waitForSelector('dialog.scm[data-remap]');
      await page.check(`dialog.scm[data-remap] input[value="${v}"]`); await page.click('dialog.scm[data-remap] .scm-ok'); await name('duckc');
      const t = await page.evaluate(() => window.__graph.text), r = revOf(t, 'duckc');
      return { t, r, want: await expected(base2, ['track:duck'], { component: `duckc@${r}`, as: 'duckc', remap: { kick: v } }) };
    };
    const pb = await pick('b/kick');
    const node2 = await page.evaluate(() => { const g = window.__graph; return { label: (document.querySelector('.gp[data-node="inst:duckc"][data-port="req:kick"] .gp-l') || {}).textContent, wire: g.view.wires.some((w) => w.remap === 'kick' && w.from.node === 'inst:b' && w.from.port === 'kick') }; });
    await page.click('#gxUndo'); await settle(page); const ub = await page.evaluate(() => window.__graph.text);
    const pa = await pick('a/kick');
    check('graph: two providers: each modal choice gives the matching code (remap b/kick, then a/kick), equal to the library output',
      pb.t === pb.want && pb.t.includes('remap: { kick: "b/kick" }') && pa.t === pa.want && pa.t.includes('remap: { kick: "a/kick" }') && ub === base2 && node2.label === 'kick ← b/kick' && node2.wire,
      JSON.stringify({ b: pb.t.split('\n').find((l) => l.includes('"duckc')), a: pa.t.split('\n').find((l) => l.includes('"duckc')), eqB: pb.t === pb.want, eqA: pa.t === pa.want, undoB: ub === base2, node2 }));
    R.modal = { choices, b: pb.t.split('\n').find((l) => l.includes('"duckc')), a: pa.t.split('\n').find((l) => l.includes('"duckc')) };
    // inspector: the remap select rewrites the instance line in one undo step
    await page.evaluate(() => window.__graph.center('inst:duckc', 1)); await settle(page);
    await page.click('.gn[data-id="inst:duckc"] .gn-head'); await page.waitForSelector('.gx-sheet select.gx-remap[data-tap="kick"]');
    const opts = await page.evaluate(() => [...document.querySelectorAll('.gx-sheet select.gx-remap option')].map((o) => o.value));
    await page.selectOption('.gx-sheet select.gx-remap[data-tap="kick"]', 'b/kick'); await settle(page);
    const ti = await page.evaluate(() => window.__graph.text);
    const wantI = await expected(base2, ['track:duck'], { component: `duckc@${pa.r}`, as: 'duckc', remap: { kick: 'b/kick' } });
    const outl = await page.evaluate(() => (document.querySelector('.gx-outline [data-act=select][data-node="inst:duckc"]') || {}).textContent || '');
    await page.click('#gxUndo'); await settle(page); const ui1 = await page.evaluate(() => window.__graph.text);
    check('graph: inspector remap select rewrites the instance line (one undo step); outline shows the mapping',
      opts.includes('a/kick') && opts.includes('b/kick') && !opts.includes('duckc/kick') && ti === wantI && /requires kick ← b\/kick/.test(outl) && ui1 === pa.t,
      JSON.stringify({ opts, eq: ti === wantI, outline: outl.trim(), undo: ui1 === pa.t }));
    R.inspector = { options: opts, after: ti.split('\n').find((l) => l.includes('"duckc')), outline: outl.trim() };

    // 3. no provider: refused with the reason in the status line and a toast; the document is unchanged
    const t3 = `setcpm(30)\npad: note("c3 e3")\n${DUCK}\n`;
    await page.evaluate((t) => window.__graph.load(t), t3); await settle(page);
    const base3 = await page.evaluate(() => window.__graph.text);
    await select('track:duck'); await page.click('.gx-selbar [data-act=collapse]'); await page.waitForTimeout(300);
    const r3 = await page.evaluate(() => ({ text: window.__graph.text, msg: document.querySelector('.gx-msg').textContent, toast: [...document.querySelectorAll('.toast.error')].map((t) => t.textContent).join(' | '), dialogs: document.querySelectorAll('dialog.scm').length }));
    check('graph: collapse whose required tap has no provider is refused (status line + toast), document unchanged',
      r3.text === base3 && /^Refused: .*"kick".*E_COMPONENT_REQUIRES/.test(r3.msg) && /E_COMPONENT_REQUIRES/.test(r3.toast) && r3.dialogs === 0, JSON.stringify(r3));
    R.refused = r3.msg;
    await ctx.close();
  }

  /* ---------- desktop 1440: side by side, selection sync, screenshot, contrast ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); watch(page, 'graph-1440');
    await page.goto(BASE + '#graph'); await gx(page); await page.evaluate(() => window.__graph.reset()); await page.evaluate(() => window.__graph.fit()); await settle(page);
    const side = await page.evaluate(() => ({ canvas: document.querySelector('.gx-canvas').getBoundingClientRect().width, code: document.querySelector('.gx-code').getBoundingClientRect().width }));
    await page.click('.gn[data-id="track:bass"] .gn-head'); await page.waitForTimeout(150);
    const mark = await page.evaluate(() => (document.querySelector('.gx-mirror mark') || {}).textContent || '');
    const caret = await page.evaluate(() => { const ta = document.querySelector('#gxCode'); const i = ta.value.indexOf('kick: s('); return i; });
    await page.evaluate((i) => { const ta = document.querySelector('#gxCode'); ta.focus(); ta.setSelectionRange(i + 3, i + 3); ta.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, caret);
    const sel = await page.evaluate(() => window.__graph.sel);
    check('graph: desktop shows code and graph side by side with selection sync both ways', side.canvas > 600 && side.code > 300 && mark.startsWith('bass: note(') && sel.join() === 'track:kick', JSON.stringify({ side, mark: mark.slice(0, 40), sel }));
    // plan strip + wiring for the screenshot
    await page.evaluate(() => window.__graph.setText ? 0 : 0);
    await page.evaluate(() => { const g = window.__graph; g.reset(); });
    await page.click('#gxPlanBtn');
    await page.evaluate(() => { const ta = document.querySelector('#gxCode'); ta.value = ta.value.replace('hooks.let("root", 48)\n', 'hooks.let("root", 48)\nhooks.bind("bass/fx", "murk", "<drop")\nhooks.bind("bass/fx", "open", "drop..33b")\n').replace('.lpf(800)', '.lpf(800).wire("lpf", "kick:env", { range: [200, 2000] })'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page); await page.evaluate(() => window.__graph.fit()); await settle(page);
    const plan = await page.evaluate(() => [...document.querySelectorAll('.gpl-seg')].map((s) => [s.textContent, s.style.left, s.style.width]));
    check('graph: plan strip draws binding windows against bars', plan.length >= 3 && plan.some(([t]) => t === 'open'), JSON.stringify(plan));
    await page.click('.gn[data-id="track:bass"] .gn-head'); await settle(page);
    M.contrast_dark_1440 = await page.evaluate(CONTRAST);
    await page.click('.gx-sheet [data-act=close]'); await page.evaluate(() => window.__graph.zoomTo(0.9, 16, 16)); await settle(page);
    await page.screenshot({ path: path.join(OUT, 'desktop-1440-graph.png') });
    const C = [M.contrast_dark_1440, M.contrast_dark_390, M.contrast_light_390];
    check('graph: text contrast >= 7:1 (dark 1440, dark 390, light 390)', C.every((c) => c && c.min >= 7), JSON.stringify(C));
    // animation runs normally while playing (control for the reduced-motion check)
    await page.evaluate(() => document.body.classList.add('playing')); await page.waitForTimeout(200);
    M.animations_normal = await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.gx')).length);
    await page.evaluate(() => document.body.classList.remove('playing'));
    await ctx.close();
  }

  /* ---------- reduced motion ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage(); watch(page, 'graph-reduced');
    await page.goto(BASE + '#graph'); await gx(page); await page.evaluate(() => window.__graph.reset());
    await page.evaluate(() => document.body.classList.add('playing')); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ anims: document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.gx')).length, live: document.querySelector('.gx').hasAttribute('data-live'), pulse: getComputedStyle(document.querySelector('.gw-pulse')).opacity, badge: getComputedStyle(document.querySelector('.gb-pattern span'), '::after').content }));
    await page.evaluate(() => document.body.classList.remove('playing'));
    M.reduced_motion = { ...r, animations_without_reduce: M.animations_normal };
    check('graph: reduced motion runs no wire animation; live state still shown', r.anims === 0 && r.live && +r.pulse > 0 && /▸/.test(r.badge) && M.animations_normal > 0, JSON.stringify(M.reduced_motion));
    await ctx.close();
  }
  return M;
}

/* ---------- standalone ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), OUT = path.join(ROOT, 'docs/screens');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const checks = [], errors = [], metrics = {};
  const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
  const watch = (page, tag) => {
    page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: 'x', body: '' }) : '[]' }));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); }); page.on('requestfailed', (r) => console.log('requestfailed', r.url().slice(0, 120), r.failure() && r.failure().errorText)); page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try { await graphSection({ browser, BASE, OUT, check, watch, metrics }); } catch (e) { check('graph section ran to the end', false, e.stack); }
  await browser.close(); server.close();
  check('graph: zero console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  const mf = path.join(OUT, 'metrics.json'); let all = {}; try { all = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { all = {}; }
  all.graph = { date: new Date().toISOString(), ...metrics.graph }; fs.writeFileSync(mf, JSON.stringify(all, null, 1));
  const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} graph checks passed; ${errors.length} console errors`);
  process.exit(failed.length ? 1 : 0);
}
