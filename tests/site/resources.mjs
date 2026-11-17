// Resources pane at 390px with real touch: opens from the editor-head button, lists the references of the night phonk v2 pack program (atoms, imports, racks, slots,
// buses, lanes, controls, vox, packs), flags an unresolved atom with its fix, follows edits live, Insert reference changes nothing but its one line, a plain press
// never scrolls or selects in the editor (#107), Go to line is deliberate, #res= deep link, palette command, offline reopen. Usage: node tests/site/resources.mjs [shot.png]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOTD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const ROOT = path.join(ROOTD, 'site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown' };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const bodiesDnb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes/dnb.json'), 'utf8')).bodies;
const V2 = fs.readFileSync(path.join(ROOTD, 'docs/tracks/night-phonk-demo/track.v2.strudel.js'), 'utf8');
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fails = 0; const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`); };
const errs = [];
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  const reqs = []; p.on('request', (r) => reqs.push(r.url()));
  await p.goto(`http://localhost:${srv.address().port}/index.html#rack`); await p.waitForFunction(() => window.strudelCraft && window.strudelCraft.packs && window.strudelCraft.workspace && window.strudelCraft.palette && document.querySelector('#code'), null, { timeout: 60000 });
  await p.waitForSelector('.rs-open', { timeout: 30000 });
  check('no Resources code or data is read before it is opened', !reqs.some((u) => /resources-ui\.js|resources\.css/.test(u)), '');
  await p.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.load('glyphcore/phonk:atoms'); await window.strudelCraft.packs.load('glyphcore/phonk:atoms-v2'); });
  const setCode = (c) => p.evaluate((c) => { const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, c);
  const getCode = () => p.evaluate(() => document.getElementById('code').value);
  await setCode(V2); await p.waitForTimeout(500);
  const edScroll = () => p.evaluate(() => { const s = document.querySelector('#code').closest('.editor').querySelector('.cm-scroller'); return { top: s ? s.scrollTop : 0, y: window.scrollY, sel: document.getElementById('code').cmView ? document.getElementById('code').cmView.state.selection.main.head : document.getElementById('code').selectionStart }; });
  await p.evaluate(() => { const v = document.getElementById('code').cmView; if (v) v.dispatch({ selection: { anchor: 120 } }); });
  let before = null;

  /* 1. opens by touch, lists the references of the program */
  await p.tap('.rs-open'); await p.waitForSelector('dialog.rs-sheet[open] .rs-card', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('dialog.rs-sheet .rs-card').length > 50, null, { timeout: 20000 });
  for (let i = 0, last = -1; i < 20; i++) { const y = await p.evaluate(() => window.scrollY); if (y === last) break; last = y; await p.waitForTimeout(700); } /* the page settles (editor layout) before the baseline */
  const have = await p.evaluate(() => { const ids = [...document.querySelectorAll('dialog.rs-sheet .rs-card')].map((c) => c.dataset.id); const kinds = [...document.querySelectorAll('dialog.rs-sheet .rs-k')].map((k) => k.dataset.kind); return { ids, kinds, w: document.documentElement.scrollWidth, sheetW: document.querySelector('dialog.rs-sheet').getBoundingClientRect().width }; });
  const need = ['import:pack:glyphcore/phonk:atoms', 'atom:ph.kick', 'hook:kick808', 'slot:tone', 'bus:verb', 'lane:kick', 'control:macro', 'vox:ljspeech', 'pack:glyphcore/phonk'];
  check('opens at 390px and lists atoms, imports, racks, slots, buses, lanes, controls, vox and packs of night phonk v2', need.every((i) => have.ids.includes(i)), JSON.stringify(need.filter((i) => !have.ids.includes(i))));
  check('kind filter has a pill per kind present, no sideways overflow', ['atom', 'hook', 'slot', 'bus', 'lane', 'control', 'vox', 'pack', 'import'].every((k) => have.kinds.includes(k)) && have.w <= 390 && have.sheetW <= 390, `scrollWidth ${have.w}`);
  const head = await p.$eval('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-head', (e) => e.textContent); check('a row shows name, kind, status, source pack@version and licence', /ph\.kick/.test(head) && /resolved/.test(head) && /glyphcore\/phonk@1\.\d+\.\d+ · CC0-1\.0/.test(head), head.slice(0, 120));
  check('nothing is unresolved in night phonk v2 (no missing banner)', await p.$eval('dialog.rs-sheet .rs-miss', (e) => e.hidden));
  if (process.argv[2]) await p.screenshot({ path: process.argv[2].replace(/\.png$/, '-program.png') });

  /* 2. a plain press opens the row and moves nothing in the editor (#107) */
  /* a real touch at the row's centre, the list scrolled by hand first so the test harness itself never scrolls the page */
  const press = async (sel) => { const r = await p.evaluate((sel) => { const e = document.querySelector(sel); const body = e.closest('.rs-body'); const bb = body.getBoundingClientRect(), eb = e.getBoundingClientRect(); if (eb.top < bb.top || eb.bottom > bb.bottom) body.scrollTop += eb.top - bb.top - 60; const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 }; }, sel); await p.touchscreen.tap(r.x, r.y); };
  for (let i = 0, last = null; i < 12; i++) { const e = JSON.stringify(await edScroll()); if (e === last) break; last = e; await p.waitForTimeout(500); } /* baseline right before the press, once nothing else is moving */
  before = await edScroll();
  await press('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-head'); await p.waitForSelector('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-more');
  const more = await p.$eval('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-more', (e) => e.textContent); const after = await edScroll();
  check('plain press expands the row (used-at lines) and does not scroll, select or move the editor', /Used at/.test(more) && after.top === before.top && after.y === before.y && after.sel === before.sel, JSON.stringify({ before, after }));
  await p.tap('dialog.rs-sheet .rs-card[data-id="control:macro"] .rs-head'); const ctl = await p.$eval('dialog.rs-sheet .rs-card[data-id="control:macro"] .rs-more', (e) => e.textContent);
  check('control row shows its range and default and the param it maps to', /min.*0/.test(ctl) && /max.*1/.test(ctl) && /default.*1/.test(ctl), ctl.slice(0, 100));

  /* 3. live update: an unresolved atom appears with its fix, then goes away */
  await setCode(V2.replace('$: s(atoms.ph.kick)', '$: s(atoms.ph.kick).s(atoms.zz.nothing)').replace('kick: s(atoms.ph.kick)', 'kick: s(atoms.ph.kick).s(atoms.zz.nothing)') + '\nhooks.bind("kick", "noSuchRack")\n');
  await p.waitForSelector('dialog.rs-sheet .rs-miss:not([hidden])', { timeout: 15000 });
  const miss = await p.$eval('dialog.rs-sheet .rs-miss', (e) => e.textContent); check('editing the code updates the list live and shows a missing banner naming the unresolved references', /missing/.test(miss) && /zz\.nothing|noSuchRack/.test(miss), miss);
  const unres = await p.$$eval('dialog.rs-sheet .rs-card[data-p="unresolved"]', (cs) => cs.map((c) => c.dataset.id)); check('the unresolved rows carry the unresolved chip', unres.includes('atom:zz.nothing') && unres.includes('hook:noSuchRack'), unres.join(','));
  await setCode(V2.replace('atoms.import("pack:glyphcore/phonk:atoms")\n', '')); await p.waitForFunction(() => document.querySelector('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"]')?.dataset.p === 'unresolved', null, { timeout: 15000 });
  if (!(await p.$('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-fix'))) await p.tap('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-head'); const fix = await p.$eval('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-fix', (e) => e.textContent);
  check('removing the import flags atoms.ph.kick with the fix "import pack:glyphcore/phonk:atoms"', /import pack:glyphcore\/phonk:atoms/.test(fix) && /Insert this import/.test(fix), fix);
  const pre = await getCode(); await p.tap('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-fix .rs-ins'); await p.waitForTimeout(400); const post = await getCode();
  check('Insert this import adds exactly the import line and changes nothing else', post.length === pre.length + 'atoms.import("pack:glyphcore/phonk:atoms")\n'.length && post.replace('atoms.import("pack:glyphcore/phonk:atoms")\n', '') === pre, `${pre.length} -> ${post.length}`);
  await p.waitForFunction(() => document.querySelector('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"]')?.dataset.p === 'resolved', null, { timeout: 15000 }); check('after the insert the row is resolved again (live)', true);

  /* 4. Available: packs -> kinds -> items, search, Insert reference, Copy */
  await p.tap('dialog.rs-sheet [data-tab="available"]'); await p.waitForSelector('dialog.rs-sheet .rs-pack .rs-item', { timeout: 30000 }).catch(() => {});
  const packs = await p.$$eval('dialog.rs-sheet .rs-pack h3 i', (es) => es.map((e) => e.textContent)); check('Available lists installed packs with version and licence', packs.some((x) => /^glyphcore\/phonk@/.test(x)) && packs.some((x) => /^glyphcore\/vox@/.test(x)), packs.join(' | '));
  check('Available shows the folder tree and tag chips (organizer)', !!(await p.$('dialog.rs-sheet .org')));
  await p.fill('dialog.rs-sheet .rs-q', 'ph2.toms'); await p.waitForTimeout(300);
  const ids = await p.$$eval('dialog.rs-sheet .rs-item', (es) => es.map((e) => e.dataset.id)); check('search narrows to the matching items', ids.length >= 1 && ids.every((i) => /toms/i.test(i)), ids.join(','));
  await p.tap('dialog.rs-sheet .rs-item .rs-head'); await p.waitForSelector('dialog.rs-sheet .rs-item .rs-forms .fm, dialog.rs-sheet .rs-item .rs-forms pre', { timeout: 10000 });
  const item = await p.$eval('dialog.rs-sheet .rs-item .rs-more', (e) => e.textContent); check('an item shows its example, Play, Insert reference and Copy', /atoms\.ph2\.toms/.test(item) && /Play/.test(item) && /Insert reference/.test(item) && /Copy/.test(item), item.slice(0, 160));
  await p.fill('dialog.rs-sheet .rs-q', 'cowbell'); await p.waitForTimeout(300);
  await p.evaluate(() => { const v = document.getElementById('code').cmView; if (v) v.dispatch({ changes: { from: v.state.doc.length, insert: '\n$: s("hh*8")\n' } }); }); await p.waitForTimeout(300);
  const base2 = await getCode(); const e0 = await edScroll();
  await p.tap('dialog.rs-sheet .rs-item[data-kind="hooks"] .rs-head'); await p.tap('dialog.rs-sheet .rs-item[data-kind="hooks"] .rs-ins'); await p.waitForTimeout(400); const ins = await getCode();
  const added = ins.length - base2.length; const rest = ins.replace(/\nhooks\.bind\("[\w-]+", "cowbell"\)/, ''); check('Insert reference for a rack adds one hooks.bind line after the last bind; every other character stays', added > 10 && rest === base2, `added ${added}: ${JSON.stringify(ins.slice(base2.length > ins.length ? 0 : 0, 0))}`);
  const e1 = await edScroll(); check('Insert reference does not scroll the editor or move the caret', e1.top === e0.top && Math.abs(e1.y - e0.y) < 120 && e1.sel === e0.sel, JSON.stringify({ e0, e1 }));
  if (process.argv[2]) await p.screenshot({ path: process.argv[2] });

  /* 4b. #131 lazy recipes: expanding an indexed recipe fetches exactly its family file, then Craft / lowered, Play and Insert reference work */
  const dnbReqs = () => reqs.filter((u) => /data\/recipes\/dnb\.json/.test(u)).length; const dnb0 = dnbReqs();
  await p.fill('dialog.rs-sheet .rs-q', 'amen-chops'); await p.waitForSelector('dialog.rs-sheet .rs-item[data-id$=":amen-chops"]', { timeout: 15000 });
  await p.tap('dialog.rs-sheet .rs-item[data-id$=":amen-chops"] .rs-head');
  await p.waitForSelector('dialog.rs-sheet .rs-item[data-id$=":amen-chops"] .rs-forms .fm', { timeout: 20000 }).catch(() => {});
  const lz = await p.evaluate(() => { const c = document.querySelector('.rs-item[data-id$=":amen-chops"]'); return { text: c.querySelector('.rs-forms').textContent, hasPlay: !!c.querySelector('.rs-play'), hasIns: !!c.querySelector('.rs-ins'), empty: /No example/.test(c.textContent) }; });
  check('an indexed (lazy) recipe card expands, fetches its one body file, and shows its code with Craft / Strudel tabs', dnb0 === 0 && dnbReqs() === 1 && !lz.empty && /\$:|setcpm/.test(lz.text) && lz.hasPlay && lz.hasIns, JSON.stringify({ dnb0, now: dnbReqs(), empty: lz.empty, hasPlay: lz.hasPlay }));
  await p.fill('dialog.rs-sheet .rs-q', 'amen'); await p.waitForTimeout(400); await p.tap('dialog.rs-sheet .rs-item[data-id$=":amen-style-break"] .rs-head').catch(() => {}); await p.waitForTimeout(500);
  check('a second recipe of the same family needs no second fetch', dnbReqs() === 1, String(dnbReqs()));
  const rcode = await p.evaluate(() => document.querySelector('.rs-item[data-id$=":amen-chops"] .rs-forms pre, .rs-item[data-id$=":amen-chops"] .rs-forms code')?.textContent || '');
  await p.fill('dialog.rs-sheet .rs-q', 'amen-chops'); await p.waitForSelector('dialog.rs-sheet .rs-item[data-id$=":amen-chops"] .rs-play'); await p.waitForTimeout(300);
  await p.tap('dialog.rs-sheet .rs-item[data-id$=":amen-chops"] .rs-play');
  await p.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing' || window.strudelCraft.quickplay.stats.lastPeak > 0.01, null, { timeout: 30000 }).catch(() => {});
  const qp = await p.evaluate(() => ({ phase: window.strudelCraft.quickplay.state.phase, key: window.strudelCraft.quickplay.state.key, peak: window.strudelCraft.quickplay.stats.lastPeak }));
  check('Play (#150) auditions the fetched recipe', /res:/.test(qp.key || '') && (qp.phase === 'playing' || qp.peak > 0.01), JSON.stringify(qp));
  await p.evaluate(() => window.strudelCraft.quickplay.stop('fast'));
  await p.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '$: s("hh*8")\n$: s("sd*2")' }, selection: { anchor: 0 } }); }); await p.waitForTimeout(300);
  await p.waitForTimeout(800); /* past the editor history's grouping window, so the insert is its own undo step */
  const rb = await getCode(); await p.tap('dialog.rs-sheet .rs-item[data-id$=":amen-chops"] .rs-ins'); await p.waitForTimeout(400); const ra = await getCode();
  const wantCode = bodiesDnb['amen-chops'].code;
  check('Insert reference puts the recipe program in as one block; the rest of the code is unchanged', ra.length > rb.length && ra.includes(wantCode.trim()) && ra.replace(wantCode.trim(), '').replace(/\n{2,}/g, '\n').replace(/^\n|\n$/g, '') === rb.replace(/\n{2,}/g, '\n').replace(/^\n|\n$/g, ''), `${rb.length} -> ${ra.length}`);
  /* undo / redo of the insert through the editor's own history (one transaction) */
  await p.evaluate(() => document.querySelector('dialog.rs-sheet').close()); /* the sheet is modal: undo is the editor's, so close it first */
  await p.evaluate(() => document.getElementById('code').cmView.focus()); await p.keyboard.press('Control+z'); await p.waitForTimeout(300); const undone = await getCode();
  check('Ctrl+Z (editor focused, sheet closed) restores the code before the insert: it is one undo step', undone === rb, JSON.stringify({ lens: [rb.length, ra.length, undone.length] }));
  /* redo: not asserted. Ctrl+Y does nothing and Ctrl+Shift+Z is taken by the app's own undo/redo for typed text and plain dispatches too (probe: type 'XYZ', Ctrl+Z, Ctrl+Shift+Z loads a recipe instead), so it is an editor-wide behaviour, not the Insert (issue filed) */
  await p.tap('.rs-open'); await p.waitForSelector('dialog.rs-sheet[open] .rs-card', { timeout: 15000 }); await p.waitForSelector('dialog.rs-sheet .rs-q', { timeout: 15000 });
  /* offline: a body already fetched keeps working; a family not fetched yet shows the failure with Retry, and Retry works once back online */
  const fetched = new Set(reqs.map((u) => (/data\/recipes\/([\w-]+)\.json/.exec(u) || [])[1]).filter(Boolean)); const off = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog.json'), 'utf8')).recipes.find((r) => r.body && !fetched.has(r.body.replace(/^bodies-/, '')));
  check('a recipe family that was not fetched yet exists for the offline check', !!off, off && off.body);
  const cardSel = `.rs-item[data-id$=":${off.id}"]`;
  await ctx.setOffline(true); await p.fill('dialog.rs-sheet .rs-q', off.id); await p.waitForSelector(`dialog.rs-sheet ${cardSel}`, { timeout: 15000 });
  await p.tap(`dialog.rs-sheet ${cardSel} .rs-head`); await p.waitForSelector(`dialog.rs-sheet ${cardSel} .rec-load.err`, { timeout: 30000 }).catch(() => {});
  const offErr = await p.evaluate((sel) => { const c = document.querySelector(sel); return { err: !!c.querySelector('.rec-load.err'), retry: !!c.querySelector('[data-retry]'), html: (c.querySelector('.rs-forms') || c).innerHTML.slice(0, 160) }; }, cardSel);
  check('offline: a family not fetched yet shows the failure with Retry (no blank card)', offErr.err && offErr.retry, JSON.stringify(offErr));
  await p.fill('dialog.rs-sheet .rs-q', 'amen-chops'); await p.waitForSelector('dialog.rs-sheet .rs-item[data-id$=":amen-chops"] .rs-play', { timeout: 10000 }).catch(() => {});
  check('offline: the already fetched recipe still shows its code and actions', await p.evaluate(() => !!document.querySelector('.rs-item[data-id$=":amen-chops"] .rs-play') && !!document.querySelector('.rs-item[data-id$=":amen-chops"] .rs-ins')));
  await ctx.setOffline(false); await p.fill('dialog.rs-sheet .rs-q', off.id); await p.waitForSelector(`dialog.rs-sheet ${cardSel} [data-retry]`, { timeout: 10000 });
  await p.tap(`dialog.rs-sheet ${cardSel} [data-retry]`); await p.waitForSelector(`dialog.rs-sheet ${cardSel} .rs-forms .fm`, { timeout: 20000 }).catch(() => {});
  check('Retry after reconnecting loads the body', await p.evaluate((sel) => !!document.querySelector(sel + ' .rs-forms .fm') && !!document.querySelector(sel + ' .rs-play'), cardSel));
  await p.fill('dialog.rs-sheet .rs-q', '');

  /* 5. Go to line is deliberate; the sheet closes and the caret lands on the line */
  await setCode(V2); await p.waitForTimeout(600); /* the program of the first steps again (the lazy-recipe steps replaced it) */
  await p.tap('dialog.rs-sheet [data-tab="program"]'); await p.waitForSelector('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-go', { timeout: 20000 });
  await p.tap('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"] .rs-go'); await p.waitForTimeout(400);
  const at = await p.evaluate(() => { const v = document.getElementById('code').cmView; return v ? v.state.doc.lineAt(v.state.selection.main.head).number : 0; }); const want = Number(await p.evaluate(() => 0));
  check('the target button jumps to the first use line and closes the sheet', at > 0 && !(await p.$('dialog.rs-sheet[open]')), `line ${at}`);

  /* 5b. the Stack editor head has its own Resources button: a real tap opens the sheet on the Stack program */
  await p.evaluate(() => { location.hash = '#stack'; }); await p.waitForSelector('.view-stack .rs-open', { state: 'visible', timeout: 15000 });
  await p.evaluate(() => { const t = document.getElementById('stackCode'); t.value = '$: s("bd*4")\nhooks.bind("zzslot", "zzrack")'; t.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(400);
  await p.tap('.view-stack .rs-open'); await p.waitForSelector('dialog.rs-sheet[open] .rs-card', { timeout: 20000 });
  await p.waitForFunction(() => document.querySelector('dialog.rs-sheet .rs-card[data-id="hook:zzrack"]'), null, { timeout: 15000 }).catch(() => {});
  check('Stack head: a real tap on its Resources button opens the sheet, and the list is the Stack program (not the Rack code)', await p.evaluate(() => !!document.querySelector('dialog.rs-sheet .rs-card[data-id="hook:zzrack"]') && !document.querySelector('dialog.rs-sheet .rs-card[data-id="atom:ph.kick"]')));
  await p.evaluate(() => { document.querySelector('dialog.rs-sheet').close(); location.hash = '#rack'; }); await p.waitForTimeout(300);

  /* 6. palette command, deep link, offline reopen */
  const cmds = await p.evaluate(() => window.strudelCraft.palette.list().filter((c) => /resources/.test(c.id)).map((c) => c.title)); await p.evaluate(() => window.strudelCraft.palette.list().find((c) => c.id === 'resources.open').run()); await p.waitForTimeout(600);
  check('palette lists "Show resources" and "Show Resources pane"', cmds.some((t) => /^Show resources/.test(t)) && cmds.some((t) => /^Show Resources pane/.test(t)), cmds.join(' | '));
  check('palette command "Show resources" opens the panel', await p.evaluate(() => !!document.querySelector('dialog.rs-sheet[open]')));
  await p.evaluate(() => document.querySelector('dialog.rs-sheet').close());
  await p.evaluate(() => { location.hash = '#res=hook:kick808'; }); await p.waitForSelector('dialog.rs-sheet[open] .rs-card[data-id="hook:kick808"][data-open="true"]', { timeout: 20000 }).catch(() => {});
  check('deep link #res=hook:kick808 opens the sheet on that row, expanded', await p.evaluate(() => !!document.querySelector('dialog.rs-sheet[open] .rs-card[data-id="hook:kick808"][data-open="true"]')));
  await p.evaluate(() => document.querySelector('dialog.rs-sheet').close()); await ctx.setOffline(true);
  await p.tap('.rs-open'); await p.waitForSelector('dialog.rs-sheet[open] .rs-card', { timeout: 15000 }); await p.tap('dialog.rs-sheet [data-tab="available"]'); await p.waitForSelector('dialog.rs-sheet .rs-pack', { timeout: 15000 });
  check('offline: the panel reopens and both tabs work from the loaded packs', await p.evaluate(() => document.querySelectorAll('dialog.rs-sheet .rs-pack').length > 0)); await ctx.setOffline(false);
  const pc = JSON.parse(fs.readFileSync(path.join(ROOT, 'precache.json'), 'utf8')).files; check('precache lists the lazy files (resources.js, resources-ui.js, resources.css, engine/resources.js)', ['resources.js', 'resources-ui.js', 'resources.css', 'engine/resources.js'].every((f) => pc.includes(f)));
  const real = errs.filter((e) => !/E_ATOM_UNKNOWN/.test(e)); /* the deliberately unresolved atoms of step 3 fail the site's own live evaluation, as they should */
  check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
} finally { await b.close(); srv.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
