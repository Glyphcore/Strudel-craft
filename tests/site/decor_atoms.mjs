// #170: decorated first paint + style atoms (docs/EDITOR_DECOR.md).
//   1. style atoms registry: create, update, remove; 1,000 state changes leak no sheet or rule
//   2. frames from navigation (rAF probe from the init script): no frame paints the code text undecorated, cold (new context) and warm (reload);
//      the editor's data comes from the IndexedDB cache on the warm start, entries of another build are dropped, and with the pack data
//      unreachable (offline data) the editor still gets its params and docs from the cache
//   3. MutationObserver on the code area (.cm-content + .cm-gutters of #code, and the Graph code pane mirror): zero attribute / child mutations during
//      8 bars of playback highlighting, hover across 20 tokens, selecting lanes, showing and clearing an error; mute / solo are text edits
//      (they write tagged("x").mute()), so the only mutations then are one mirror rewrite per edit and none in the rack editor
//   4. measured: scripting + style + layout ms (CDP Performance.getMetrics) over the 8 bars of playback
// Usage: node tests/site/decor_atoms.mjs                      (all checks, this checkout's site/)
//        node tests/site/decor_atoms.mjs --measure <siteDir>  (only the 8-bar measurement, e.g. a checkout from before #170)
import { createRequire } from 'module'; import { execFileSync } from 'node:child_process'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const MEASURE = process.argv[2] === '--measure';
const SITE = path.resolve(MEASURE && process.argv[3] ? process.argv[3] : path.join(path.dirname(fileURLToPath(import.meta.url)), '../../site'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
let SHA = 'build-a'; let blockData = false;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  if (p === '/build.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ sha: SHA, date: '' })); }
  if (blockData && /^\/data\/(intellisense\/|controls\/|mod_ranges)/.test(p)) { res.writeHead(503); return res.end(); }
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
let bad = 0; const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
const cdn = new Map(); const errors = [];
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (process.env.HTTPS_PROXY) await ctx.route(/esm\.sh|unpkg\.com|githubusercontent|jsdelivr/, (r) => { const u = r.request().url(); try { if (!cdn.has(u)) cdn.set(u, execFileSync('curl', ['-sL', u], { maxBuffer: 1e8 })); r.fulfill({ status: 200, body: cdn.get(u), headers: { 'content-type': /\.json(\?|$)/.test(u) ? 'application/json' : 'application/javascript', 'access-control-allow-origin': '*' } }); } catch (e) { r.abort(); } });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: '', body: '' }) : '[]' }));
  await ctx.addInitScript(() => { /* frame probe: what the code area of #code shows at each frame, from navigation */
    const F = (window.__frames = []);
    const probe = () => { const ta = document.getElementById('code'); let st = 'none';
      if (ta) { const v = ta.cmView;
        if (v) { const c = v.contentDOM; st = !c.offsetParent || !c.textContent.trim() ? 'empty' : c.querySelector('[data-tok]') && c.querySelector('span[class*="ͼ"]') ? 'cm' : 'cm-undecorated'; }
        else if (!ta.offsetParent || !ta.value.trim()) st = 'empty';
        else { const pd = ta.__pd; const col = getComputedStyle(ta).color; const clear = /rgba\(.*,\s*0\)$/.test(col) || col === 'transparent';
          st = pd && pd.pre.querySelector('span') && pd.pre.textContent.trim() === ta.value.trim() && clear ? 'pre' : clear ? 'hidden' : 'plain'; } }
      F.push(st); requestAnimationFrame(probe); };
    requestAnimationFrame(probe);
  });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const mounted = (page) => page.waitForFunction(() => document.documentElement.dataset.editor === 'cm6' && !!document.getElementById('code').cmView, null, { timeout: 90000 });
const frames = async (page) => { await mounted(page); await page.waitForTimeout(600); return page.evaluate(() => window.__frames.slice()); };
const summary = (f) => { const c = {}; for (const s of f) c[s] = (c[s] || 0) + 1; return c; };
const PROG = 'setcps(1)\n$: note("c3 e3 g3 b3").s("sine").gain(0.25)\n$: n("0 2 4 7").scale("C4:minor").s("triangle").gain(0.2).color("cyan")\n';
const setDoc = (page, t) => page.evaluate((t) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, userEvent: 'input' }); }, t);
const metrics = async (cdp) => { const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])); return { script: m.ScriptDuration * 1000, style: m.RecalcStyleDuration * 1000, layout: m.LayoutDuration * 1000 }; };
async function play8(page) { /* 8 bars (cycles) at setcps(1); returns the main-thread deltas and how often the playhead changed */
  await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started, null, { timeout: 180000 }); await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  await page.evaluate(() => { window.__ph = { changes: 0, last: '' }; const tick = () => { if (!window.__ph) return; const ds = window.strudelCraft.intellisense.decorState && window.strudelCraft.intellisense.decorState('code'); const k = ds ? ds.active.join('|') + ds.atoms.playhead : [...document.querySelectorAll('.cm-sc-active')].map((e) => e.textContent).join('|'); if (k !== window.__ph.last) { window.__ph.last = k; window.__ph.changes++; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const m0 = await metrics(cdp); await page.waitForTimeout(8000); const m1 = await metrics(cdp);
  const ph = await page.evaluate(() => { const p = window.__ph; window.__ph = null; return p.changes; });
  await page.evaluate(() => window.__sc.stop()); await page.waitForTimeout(300);
  const d = { script: +(m1.script - m0.script).toFixed(1), style: +(m1.style - m0.style).toFixed(1), layout: +(m1.layout - m0.layout).toFixed(1) }; d.total = +(d.script + d.style + d.layout).toFixed(1); d.playheadChanges = ph; return d;
}

if (MEASURE) {
  const { ctx, page } = await context(); await page.goto(BASE); await mounted(page); await setDoc(page, PROG); await page.waitForTimeout(1500);
  const runs = []; for (let i = 0; i < 3; i++) runs.push(await play8(page));
  console.log('MEASURE ' + SITE + ' ' + JSON.stringify(runs)); await ctx.close(); await browser.close(); server.close(); process.exit(0);
}

/* 1. style atoms registry */
{ const { ctx, page } = await context(); await page.goto(BASE); await mounted(page);
  const r = await page.evaluate(async () => {
    const { atom, atoms } = await import('/style-atoms.js'); const n0 = document.adoptedStyleSheets.length, s0 = atoms.sheets();
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'u-x' })); const col = () => getComputedStyle(el).color;
    const a = atom('t-unit'); const created = document.adoptedStyleSheets.length === n0 + 1 && atoms.list().some((x) => x.name === 't-unit');
    a.set('x', '.u-x{color:rgb(255, 0, 0)}'); const c1 = col(); a.set('x', '.u-x{color:rgb(0, 0, 255)}'); const c2 = col(); const one = a.size === 1;
    a.delete('x'); const c3 = col();
    for (let i = 0; i < 1000; i++) { const k = 'k' + (i % 7); a.set(k, `.u-x[data-k="${i % 7}"]{outline:${i % 5}px solid red}`); if (i % 3 === 0) a.delete(k); }
    const mid = a.size; a.clear(); const cleared = a.size === 0 && a.keys().length === 0;
    a.remove(); const removed = document.adoptedStyleSheets.length === n0 && !atoms.list().some((x) => x.name === 't-unit') && atoms.sheets() === s0; el.remove();
    return { adopted: atoms.adopted, created, c1, c2, one, c3, mid, cleared, removed, sheets: atoms.list() };
  });
  check('style atoms: create adopts one sheet and lists it', r.adopted && r.created);
  check('style atoms: set / update / delete change the computed style', r.c1 === 'rgb(255, 0, 0)' && r.c2 === 'rgb(0, 0, 255)' && r.one && r.c3 !== r.c2, `${r.c1} ${r.c2} ${r.c3}`);
  check('style atoms: 1,000 state changes leave at most 7 rules, clear and remove leave no rule and no sheet', r.mid <= 7 && r.cleared && r.removed, JSON.stringify({ mid: r.mid, atoms: r.sheets }));
  await ctx.close(); }

/* 2. frames: cold, warm, stale build, data offline */
{ const { ctx, page } = await context();
  await page.goto(BASE); const cold = await frames(page); const s0 = await page.evaluate(() => window.strudelCraft.decor.stats());
  const cs = summary(cold); const coldBad = (cs.plain || 0) + (cs['cm-undecorated'] || 0);
  check('cold load: no frame paints the code text undecorated (at most the first)', coldBad <= 1, JSON.stringify(cs));
  await page.waitForTimeout(1500); /* the cache writes settle */
  await page.reload(); const warm = await frames(page); const ws = summary(warm); const s1 = await page.evaluate(() => window.strudelCraft.decor.stats());
  check('warm load: no frame paints the code text undecorated', !(ws.plain || 0) && !(ws['cm-undecorated'] || 0) && (ws.cm || 0) > 0, JSON.stringify(ws));
  check('warm load: the editor data (params, docs) comes from the IndexedDB cache', s0.misses >= 2 && s1.hits >= 2, JSON.stringify({ cold: s0, warm: s1 }));
  const pre = await page.evaluate(() => window.strudelCraft.decor.lex('$: note("c3")// x').map((t) => t[2]).join(' '));
  check('pre-paint lexer: tokens coloured as the editor does', pre === 'var pun ws fn pun str pun com', pre);
  SHA = 'build-b'; await page.reload(); await frames(page); await page.waitForTimeout(800); const s2 = await page.evaluate(() => window.strudelCraft.decor.stats());
  check('new build hash: stale entries are dropped and re-read', s2.dropped >= 2 && s2.misses >= 2, JSON.stringify(s2));
  await page.waitForTimeout(1500); blockData = true; await page.reload(); const off = await frames(page); await page.waitForTimeout(500);
  const o = await page.evaluate(async () => { const P = await window.strudelCraft.intellisense.params(); return { st: window.strudelCraft.decor.stats(), params: Object.keys(P || {}).length }; }); blockData = false;
  check('pack data unreachable: the editor mounts decorated with params from the cache', o.st.hits >= 2 && o.params > 20 && !(summary(off).plain || 0), JSON.stringify({ ...o, frames: summary(off) }));
  await ctx.close(); }
const pc = JSON.parse(fs.readFileSync(path.join(SITE, 'precache.json'), 'utf8')).files; const sw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
check('offline: decor.js and style-atoms.js are in the service worker snapshot (precache.json), the search module in its CDN list', ['decor.js', 'style-atoms.js'].every((f) => pc.includes(f)) && JSON.parse(fs.readFileSync(path.join(SITE, 'precache.json'), 'utf8')).cdn.some((u) => u.includes('@codemirror/search')) && sw.includes('precache.json'));

/* 3. mutation observer on the code area, 4. measured */
{ const { ctx, page } = await context(); await page.goto(BASE); await mounted(page); await setDoc(page, PROG); await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__mut = { code: [], mirror: [] }; const ed = document.querySelector('.cm-editor[data-ed="code"]');
    const obs = (key, el) => new MutationObserver((rs) => { for (const r of rs) window.__mut[key].push({ type: r.type, attr: r.attributeName, node: r.target.nodeName + '.' + (r.target.className || ''), t: performance.now() }); }).observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    obs('code', ed.querySelector('.cm-content')); obs('code', ed.querySelector('.cm-gutters')); window.__obsMirror = (el) => obs('mirror', el); });
  const take = (k) => page.evaluate((k) => { const m = window.__mut[k].splice(0); return m; }, k);
  const d = await play8(page); const mPlay = await take('code');
  check('8 bars of playback highlighting: zero mutations in the code area, the playhead moved', mPlay.length === 0 && d.playheadChanges >= 16, JSON.stringify({ mutations: mPlay.length, first: mPlay[0], playheadChanges: d.playheadChanges }));
  console.log('MEASURE after #170 (8 bars, ms): ' + JSON.stringify(d));
  const toks = await page.evaluate(() => [...document.querySelectorAll('.cm-editor[data-ed="code"] .cm-content [data-tok]')].filter((e) => e.textContent.trim()).slice(0, 20).map((e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  await take('code'); for (const [x, y] of toks) { await page.mouse.move(x, y, { steps: 2 }); await page.waitForTimeout(80); } await page.waitForTimeout(400);
  const tip = await page.evaluate(() => !!document.querySelector('.cm-tooltip-hover, .cm-tooltip')); const mHover = await take('code'); await page.mouse.move(5, 5);
  check('hover across 20 tokens: zero mutations in the code area', toks.length === 20 && mHover.length === 0, JSON.stringify({ tokens: toks.length, mutations: mHover.length, first: mHover[0], tooltip: tip }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('live:error', { detail: { view: 'rack', line: 2, message: 'boom' } }))); await page.waitForTimeout(150);
  const shown = await page.evaluate(() => ({ ds: window.strudelCraft.intellisense.decorState('code').error, wavy: [...document.querySelectorAll('.cm-editor[data-ed="code"] .cm-line')].map((e) => getComputedStyle(e).textDecorationStyle).indexOf('wavy'), gut: [...document.querySelectorAll('.cm-editor[data-ed="code"] .cm-sc-state [data-ln]')].some((e) => getComputedStyle(e).boxShadow !== 'none') }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('live:ok', { detail: { view: 'rack' } }))); await page.waitForTimeout(150);
  const cleared = await page.evaluate(() => ({ ds: window.strudelCraft.intellisense.decorState('code').error, wavy: [...document.querySelectorAll('.cm-editor[data-ed="code"] .cm-line')].some((e) => getComputedStyle(e).textDecorationStyle === 'wavy') }));
  const mErr = await take('code');
  check('show and clear an error: line 2 underlined + gutter marker, then cleared; zero mutations in the code area', shown.ds && shown.ds.line === 2 && shown.wavy === 1 && shown.gut && !cleared.ds && !cleared.wavy && mErr.length === 0, JSON.stringify({ shown, cleared, mutations: mErr.length }));
  /* Graph view: its code pane mirror + lanes */
  await page.evaluate(() => window.__sc.setView('graph')); await page.waitForFunction(() => window.__graph && document.querySelector('.gx-mirror'), null, { timeout: 30000 });
  const LANES = 'setcps(1)\ndrums: note("c2*4").s("sine").gain(0.5).tags("drums")\nlead: note("e4*2").s("triangle").gain(0.3).tags("lead")\nbass: note("c2 eb2").s("sawtooth").gain(0.3)\n';
  await page.evaluate((t) => window.__graph.load(t), LANES); await page.waitForTimeout(600);
  await page.evaluate(() => window.__obsMirror(document.querySelector('.gx-mirror'))); await take('code'); await take('mirror');
  const picked = [];
  for (const id of ['track:drums', 'track:lead', 'track:bass', 'track:drums']) { await page.click(`.gn[data-id="${id}"] .gn-head`); await page.waitForTimeout(150); picked.push(await page.evaluate(() => ([...document.querySelectorAll('.gx-mirror [data-sp]')].find((e) => getComputedStyle(e).boxShadow !== 'none') || {}).textContent || '')); }
  const mSel = [...await take('code'), ...await take('mirror')];
  check('selecting lanes: the selected statement is highlighted in the code pane, zero mutations in either code area', picked[0].startsWith('drums:') && picked[1].startsWith('lead:') && picked[2].startsWith('bass:') && mSel.length === 0, JSON.stringify({ picked: picked.map((p) => p.slice(0, 12)), mutations: mSel.length, first: mSel[0] }));
  let edits = 0; const before = await page.evaluate(() => window.__graph.text);
  for (const op of ['mute', 'solo']) for (let k = 0; k < 2; k++) { const b = page.locator(`[data-act="gl-tag"][data-tag="drums"][data-op="${op}"]`).first(); await b.click(); await page.waitForTimeout(250); edits++; }
  const after = await page.evaluate(() => window.__graph.text); const mc = await take('code'), mm = await take('mirror');
  check('mute / solo toggles: text edits only (one mirror rewrite per edit, no attribute mutation), zero mutations in the rack editor', mc.length === 0 && mm.length <= edits && mm.length >= 1 && !mm.some((m) => m.type === 'attributes') && after === before, JSON.stringify({ edits, mirror: mm.length, rack: mc.length, restored: after === before }));
  await ctx.close(); }
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
console.log(bad ? `${bad} FAIL` : 'ALL PASS'); await browser.close(); server.close(); process.exit(bad ? 1 : 0);
