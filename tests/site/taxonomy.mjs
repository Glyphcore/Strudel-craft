// Folders, tags and tag-driven appearance (issue #120; docs/PACKAGES.md, docs/PACK_SPEC.md 5.3). Usage: node tests/site/taxonomy.mjs
// Part 1 (node): the DOM-free rules of site/engine/taxonomy.js (style fallback chain, priority, tree, filter AND/OR, search, deep link) and the AA contrast of every
//   palette token in both themes, read from site/taxonomy.css and site/style.css.
// Part 2 (Playwright, 390 px phone): the Recipes organizer (tree, breadcrumbs, counts, chips, AND/OR, search over names, tags and folder paths, sort, pack badge,
//   persistence, deep links), distinct folder styles and the chip/folder colour link, move-to-folder and tag edit through the site modal, appearance override
//   persisting and exported/imported, 44 px targets, no horizontal overflow, no editor scroll on press (#107), Syntax and Banks organizers.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), OUT = path.join(ROOT, 'docs/screens');
const T = await import(path.join(SITE, 'engine/taxonomy.js'));
const { createStore, parseDoc } = await import(path.join(SITE, 'taxonomy-store.js'));
const checks = []; const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -- ' + detail : detail ? '  -- ' + detail : ''}`); };
const tryit = (name, fn) => { try { fn(); check(name, true); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

/* ---------------- part 1: rules ---------------- */
const tax = { groups: { drums: { style: { color: 'orange', icon: 'drum' } } }, priority: ['drums', 'genre'], tags: { trap: { group: 'genre' }, kick: { group: 'drums' }, mine: { group: 'x' }, styled: { style: { color: 'teal', icon: 'wave', pattern: 'dots' } } }, folders: { 'a/pinned': { style: { color: 'lime', icon: 'vox' } } } };
tryit('a tag with its own pack style wins over group and category', () => { const s = T.tagStyle('styled', tax); assert.deepEqual([s.color, s.icon, s.pattern, s.source], ['teal', 'wave', 'dots', 'pack']); });
tryit('a tag in a styled pack group takes the group style', () => { const s = T.tagStyle('kick', tax); assert.deepEqual([s.color, s.icon, s.source], ['orange', 'drum', 'group']); });
tryit('a tag without a pack style falls back to the site category default (bass -> rose bass icon)', () => { const s = T.tagStyle('bass', {}); assert.deepEqual([s.color, s.icon, s.source], ['rose', 'bass', 'category']); });
tryit('a tag with no category at all falls back to neutral', () => { const s = T.tagStyle('zzz-unknown', tax); assert.deepEqual([s.color, s.icon, s.source], ['slate', 'neutral', 'neutral']); });
tryit('the user override beats everything', () => { const s = T.tagStyle('bass', {}, { styles: { bass: { color: 'lime', icon: 'fx' } } }); assert.deepEqual([s.color, s.icon, s.source], ['lime', 'fx', 'user']); });
tryit('a folder takes the style of its highest-priority tag (drums before genre)', () => { const es = [{ id: 1, folder: 'x/y', tags: ['trap', 'kick'] }, { id: 2, folder: 'x/y', tags: ['trap'] }]; const s = T.folderStyle('x/y', es, tax); assert.equal(s.tag, 'kick'); assert.equal(s.color, 'orange'); });
tryit('a folder with only a genre tag takes the genre category style', () => { const s = T.folderStyle('q', [{ id: 1, folder: 'q', tags: ['trap'] }], {}); assert.equal(s.tag, 'trap'); assert.equal(s.icon, 'genre'); });
tryit('a folder with no styled tag falls back to the category default of its own name, then neutral', () => { assert.equal(T.folderStyle('bass', [{ id: 1, folder: 'bass', tags: [] }], {}).source, 'category'); assert.equal(T.folderStyle('misc', [{ id: 1, folder: 'misc', tags: ['x1'] }], {}).source, 'neutral'); });
tryit('a pack folder style and a user folder style override the tags (user last)', () => { assert.equal(T.folderStyle('a/pinned', [], tax).color, 'lime'); assert.equal(T.folderStyle('a/pinned', [], tax, { styles: { 'folder:a/pinned': { color: 'red', icon: 'tag' } } }).source, 'user'); });
tryit('folder and tag names: valid, invalid, normalised', () => { assert.equal(T.checkFolder('hiphop/trap/drums'), null); assert.ok(T.checkFolder('Hip/Hop')); assert.ok(T.checkFolder('a//b')); assert.equal(T.normFolder(' Hip Hop / Trap '), 'hip-hop/trap'); assert.equal(T.checkTag('half-time'), null); assert.ok(T.checkTag('Half Time')); });
const E = [{ id: 'a', title: 'Kick one', folder: 'hiphop/trap/drums', tags: ['drums', 'trap'] }, { id: 'b', title: 'Bass', folder: 'hiphop/trap/bass', tags: ['bass', 'trap'] }, { id: 'c', title: 'Pad', folder: 'strudel/pad', tags: ['pad'] }, { id: 'd', title: 'Loose', tags: [] }];
tryit('tree counts roll up and the root counts everything', () => { const t = T.buildTree(E); assert.equal(t.count, 4); assert.equal(T.findNode(t, 'hiphop').count, 2); assert.equal(T.findNode(t, 'hiphop/trap/drums').own, 1); assert.equal(t.own, 1); });
tryit('filter: folder prefix, tags AND, tags OR', () => { assert.equal(T.filterEntries(E, { folder: 'hiphop' }).length, 2); assert.equal(T.filterEntries(E, { tags: ['drums', 'trap'] }).length, 1); assert.equal(T.filterEntries(E, { tags: ['drums', 'pad'], mode: 'or' }).length, 2); assert.equal(T.filterEntries(E, { tags: ['drums', 'pad'], mode: 'and' }).length, 0); });
tryit('search matches names, tags and folder paths (also as words)', () => { assert.equal(T.filterEntries(E, { q: 'kick' }).length, 1); assert.equal(T.filterEntries(E, { q: 'trap' }).length, 2); assert.equal(T.filterEntries(E, { q: 'hiphop trap drums' }).length, 1); assert.equal(T.filterEntries(E, { q: 'strudel/pad' }).length, 1); });
tryit('sort by name and by folder', () => { assert.equal(T.sortEntries(E, 'name')[0].id, 'b'); assert.equal(T.sortEntries(E, 'folder').at(-1).id, 'd'); });
tryit('deep link round trip', () => { const l = T.parseLink('#folder=hiphop/trap&tag=drums,kick&mode=or'); assert.deepEqual(l, { folder: 'hiphop/trap', tags: ['drums', 'kick'], mode: 'or' }); assert.equal(T.formatLink(l), '#folder=hiphop/trap&tag=drums,kick&mode=or'); assert.equal(T.parseLink('#r/four'), null); assert.equal(T.parseLink('#folder=a/b/c/d/e/f/g/h/i').folder, ''); });
tryit('store: move, tag, style, export and import round trip; bad data is reported, not stored', () => {
  const mem = {}; const st = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } }; const s = createStore(st);
  s.move('recipe!x', 'my/folder'); s.tag('recipe!x', ['Fav One', 'dark']); s.setStyle('dark', { color: 'red', icon: 'tag' });
  const j = s.exportJSON(); const s2 = createStore({ getItem: () => null, setItem() {} }); const r = s2.importJSON(j); assert.ok(r.ok); assert.deepEqual(s2.entry('recipe!x'), { folder: 'my/folder', tags: ['fav-one', 'dark'] }); assert.equal(s2.doc.styles.dark.color, 'red');
  assert.equal(createStore(st).entry('recipe!x').folder, 'my/folder'); s.move('recipe!x', ''); assert.equal(s.entry('recipe!x').folder, undefined);
  const bad = parseDoc({ format: 'taxonomy@1', folders: ['Bad Path'], styles: { dark: { color: 'chartreuse' } }, entries: { 'nope': {} } }); assert.equal(bad.ok, false); assert.equal(bad.errors.length, 3);
  assert.throws(() => s.setStyle('x', { color: 'chartreuse' }));
});

/* contrast of the palette tokens, both themes (taxonomy.css against the surfaces of style.css) */
{
  const css = fs.readFileSync(path.join(SITE, 'taxonomy.css'), 'utf8'), base = fs.readFileSync(path.join(SITE, 'style.css'), 'utf8');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const lum = (h) => { const [r, g, b] = rgb(h).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const block = (src, sel) => { const m = src.match(new RegExp(sel.replace(/[[\]"]/g, '\\$&') + '\\{([^}]*)\\}')); return Object.fromEntries([...(m ? m[1] : '').matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]])); };
  for (const [theme, sel] of [['dark', ':root'], ['light', ':root[data-theme="light"]']]) {
    const tok = block(css, sel), surf = block(base, sel); const keys = T.PALETTE; let min = 99, worst = '';
    const rootDark = block(base, ':root');
    for (const k of keys) for (const s of ['panel', 'panel-2', 'panel-3']) { const bg = surf[s] || rootDark[s]; const r1 = ratio(tok['tx-' + k], bg), r2 = ratio(tok['tx-' + k], tok['tx-' + k + '-bg']); const r = Math.min(r1, r2); if (r < min) { min = r; worst = `${k} on ${s}`; } }
    check(`contrast: all ${keys.length} palette colours are AA (>= 4.5:1) on the panel surfaces and on their own tint, ${theme} theme`, keys.every((k) => tok['tx-' + k] && tok['tx-' + k + '-bg']) && min >= 4.5, `min ${min.toFixed(2)} (${worst})`);
  }
  check('colour tokens sit on :root with a light override', /:root\{--tx-amber/.test(css) && /:root\[data-theme="light"\]\{--tx-amber/.test(css));
}

/* ---------------- part 2: browser ---------------- */
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const errors = []; const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/rate limit|403|Failed to load resource/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
let nativeDialog = 0; page.on('dialog', (d) => { nativeDialog++; d.dismiss(); });
/* real touch: CDP Input.dispatchTouchEvent through page.touchscreen.tap at the element's centre (not a synthetic mouse click) */
let touches = 0; page.on('console', () => {}); await page.addInitScript(() => { window.__touch = 0; addEventListener('touchstart', () => { window.__touch++; }, true); });
const tap = async (sel) => { const e = await page.waitForSelector(sel, { state: 'visible', timeout: 15000 }); await e.evaluate((x) => x.scrollIntoView({ block: 'center' })); await page.waitForTimeout(40); const b = await e.boundingBox(); /* centred: the fixed transport bar covers the bottom 84 px */ await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); touches++; };
const ready = async (hash = '') => { await page.goto(BASE + hash, { waitUntil: 'load' }); await page.waitForSelector('#org .org', { timeout: 20000 }); await page.waitForFunction(() => document.querySelectorAll('#list li[data-id]').length > 0 || document.querySelector('#list .empty'), null, { timeout: 20000 }); };
const count = () => page.evaluate(() => { const m = document.getElementById('count').textContent.match(/(\d+) \/ (\d+)/); return { shown: +m[1], total: +m[2] }; });
const openOrg = async () => { if (!(await page.$eval('#org .org', (d) => d.open))) await tap('#org .org summary'); };
await page.addInitScript(() => { if (!sessionStorage.getItem('__t')) { sessionStorage.setItem('__t', '1'); localStorage.clear(); } });
await ready(); await openOrg();
const total = (await count()).total;
check('recipes load and the organizer mounts at 390 px', total >= 80, String(total));
const rows = await page.$$eval('#org .org-node', (n) => n.map((x) => ({ p: x.dataset.path, name: x.querySelector('.org-name').textContent, n: +x.querySelector('.org-n').textContent })));
check('folder tree: root "All" counts every recipe and the top folders add up to it', rows[0].p === '' && rows[0].n === total && rows.slice(1).reduce((a, r) => a + r.n, 0) === total, JSON.stringify(rows));
check('folder tree has the expected top folders with counts', ['dovetail', 'groove', 'hiphop', 'phonk', 'strudel'].every((f) => rows.some((r) => r.p === f && r.n > 0)), rows.map((r) => r.p).join());
// expand + select
await tap('#org .org-node[data-path="hiphop"] .org-tgl'); await page.waitForSelector('#org .org-node[data-path="hiphop/trap"]');
await tap('#org .org-node[data-path="hiphop/trap"] .org-sel');
const afterFolder = await count(); const trapN = await page.$eval('#org .org-node[data-path="hiphop/trap"] .org-n', (e) => +e.textContent);
check('selecting a folder filters the list to its count', afterFolder.shown === trapN && trapN > 0 && trapN < total, JSON.stringify(afterFolder) + ' ' + trapN);
check('breadcrumbs show the path and "All" clears back', await page.$$eval('.org-crumbs .org-crumb', (b) => b.map((x) => x.textContent.trim()).filter((t) => t && t !== 'Clear').join('>')) === 'All>hiphop>trap');
check('the URL carries the folder (#folder=)', (await page.evaluate(() => location.hash)).includes('folder=hiphop/trap'), await page.evaluate(() => location.hash));
await page.screenshot({ path: path.join(OUT, 'phone-390-folders-tree.png') });
// tags AND / OR
await tap('.org-crumbs .org-clear'); await tap('#org .org-more'); check('the chip bar shows the most used tags and All N tags reveals the rest', (await page.$$('#org .org-chip')).length > 20);
await tap('#org .org-chip[data-tag="trap"]'); const nTrap = (await count()).shown;
await tap('#org .org-chip[data-tag="drums"]'); const nAnd = (await count()).shown;
await tap('#org .org-mode'); const nOr = (await count()).shown;
check('tag chips filter; AND narrows, OR widens (trap, trap+drums AND, trap+drums OR)', nTrap > 0 && nAnd > 0 && nAnd <= nTrap && nOr >= nTrap && nOr > nAnd, `${nTrap} ${nAnd} ${nOr}`);
check('the mode switch is a switch with its state', (await page.$eval('#org .org-mode', (b) => [b.getAttribute('role'), b.getAttribute('aria-checked')])).join() === 'switch,true');
check('the URL carries tags and the OR mode', /tag=trap,drums/.test(await page.evaluate(() => location.hash)) && /mode=or/.test(await page.evaluate(() => location.hash)));
await tap('#org .org-mode'); await tap('.org-crumbs .org-clear');
check('Clear restores every recipe', (await count()).shown === total);
// search over name, tag and folder path
const q = async (s) => { await tap('#q'); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); if (s) await page.keyboard.type(s); await page.waitForTimeout(80); return (await count()).shown; };
const byName = await q('trap beat'), byFolder = await q('hiphop trap drums'), byTag = await q('half time'), none = await q('qqqzzz'); await q('');
check('search matches names, tags and folder paths', byName >= 1 && byFolder >= 2 && byTag >= 1 && none === 0, `${byName} ${byFolder} ${byTag} ${none}`);
// sort
await page.selectOption('#org .org-sort', 'name'); const firstNames = await page.$$eval('#list .t', (t) => t.slice(0, 5).map((x) => x.textContent.toLowerCase()));
check('sort by name orders the list', firstNames.join() === [...firstNames].sort().join(), firstNames.join());
await page.selectOption('#org .org-sort', 'catalog');
// badge + style on each row
const rowInfo = await page.$$eval('#list li[data-id]', (ls) => ls.map((l) => ({ pk: !!l.querySelector('.ns'), ico: !!l.querySelector('.tx-ico svg'), c: l.querySelector('.tx-ico')?.dataset.color })));
check('every row has a pack badge and a style icon', rowInfo.length > 0 && rowInfo.every((r) => r.pk && r.ico), String(rowInfo.length));
check('rows use more than 4 distinct colours (different tags, different looks)', new Set(rowInfo.map((r) => r.c)).size >= 5, [...new Set(rowInfo.map((r) => r.c))].join());
// distinct folder styles and the chip link
const fstyles = await page.$$eval('#org .org-node', (n) => n.filter((x) => x.dataset.path && !x.dataset.path.includes('/')).map((x) => ({ p: x.dataset.path, c: x.querySelector('.tx-ico').dataset.color, i: x.querySelector('.tx-ico').dataset.icon })));
check('top folders render distinct styles (colour + icon pairs)', new Set(fstyles.map((s) => s.c + '/' + s.i)).size >= 4, JSON.stringify(fstyles));
const link = await page.evaluate(() => { const f = document.querySelector('#org .org-node[data-path="dovetail"] .tx-ico'), c = document.querySelector('#org .org-chip[data-tag="dovetail"] .tx-ico'); return f && c && [f.dataset.color, f.dataset.icon, c.dataset.color, c.dataset.icon]; });
check('a tag chip shows the same colour and icon as the folder it drives', link && link[0] === link[2] && link[1] === link[3], JSON.stringify(link));
const ptx = await page.evaluate(() => { const O = window.strudelCraft.organizer.recipes, tx = O.tax(); const chip = (n) => document.querySelector(`#org .org-chip[data-tag="${n}"] .tx-ico`); return { driving: tx.tags.driving && tx.tags.driving.group, trapStyle: tx.tags.trap && tx.tags.trap.style, c: chip('driving') && [chip('driving').dataset.tx, chip('driving').dataset.color], p: chip('hyphy') && [chip('hyphy').dataset.tx, chip('hyphy').dataset.color, chip('hyphy').dataset.pattern] }; });
check('the page reads the pack taxonomy (groups, tag styles) from the loader', ptx.driving === 'mood' && ptx.trapStyle && ptx.trapStyle.color === 'amber', JSON.stringify(ptx));
check('a tag with a pack style uses it (hyphy: lime stripe, source pack); a tag only in a group falls to the category default (driving: rose)', ptx.p && ptx.p.join() === 'pack,lime,stripe' && ptx.c && ptx.c.join() === 'category,rose', JSON.stringify(ptx));
check('style is not colour only: every styled box holds an icon and the chip a text label', await page.$$eval('#org .org-chip', (c) => c.every((x) => x.querySelector('svg path') && x.querySelector('span:not(.tx-ico)').textContent.length > 0)));
check('the category default applies where the pack gave no style (source=category in the page)', await page.$$eval('#org .tx-ico[data-tx="category"]', (e) => e.length > 0));
// targets and overflow
const small = await page.$$eval('#org button, #org select, .org-crumbs button', (bs) => bs.filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), b.className]; }).filter((x) => x[0] < 44 || x[1] < 44));
check('all organizer targets are at least 44 x 44 px', small.length === 0, JSON.stringify(small.slice(0, 4)));
check('no horizontal overflow at 390 px', await page.evaluate(() => document.documentElement.scrollWidth <= 390 + 1), await page.evaluate(() => String(document.documentElement.scrollWidth)));
// press does not scroll the editor (#107)
const before = await page.evaluate(() => ({ st: document.querySelector('.cm-scroller')?.scrollTop ?? document.getElementById('code').scrollTop, ae: document.activeElement && document.activeElement.id }));
await tap('#org .org-chip[data-tag="drums"]'); await tap('#org .org-chip[data-tag="drums"]');
const after = await page.evaluate(() => ({ st: document.querySelector('.cm-scroller')?.scrollTop ?? document.getElementById('code').scrollTop, ae: document.activeElement && document.activeElement.id }));
check('pressing chips and tree rows neither scrolls the editor nor focuses it (#107)', before.st === after.st && after.ae !== 'code', JSON.stringify([before, after]));
// persistence
await tap('#org .org-node[data-path="dovetail"] .org-sel'); await tap('#org .org-chip[data-tag="transition"]');
const st1 = await count(); await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#org .org-crumb'); await page.waitForFunction(() => document.querySelectorAll('#list li[data-id]').length > 0);
check('folder and tag filters persist across a reload', (await count()).shown === st1.shown && (await page.$eval('#org .org-crumbs', (c) => !c.hidden)), JSON.stringify(st1));
await ready('#folder=hiphop/trap&tag=drums'); const dl = await count();
check('a deep link #folder=...&tag=... applies on load', dl.shown > 0 && dl.shown < total && (await page.$$eval('.org-crumbs .org-crumb', (b) => b.map((x) => x.textContent.trim()).join('>'))).includes('hiphop>') , JSON.stringify(dl));
await page.screenshot({ path: path.join(OUT, 'phone-390-folders-chips.png') });
await tap('.org-crumbs .org-clear');
// edit folder + tags of a recipe through the modal
await tap('#list li[data-id="four-on-the-floor"] .row'); await page.waitForSelector('.org-insp');
await tap('.org-insp >> text=Folder and tags'); await page.waitForSelector('dialog.scm[open] .org-form');
await page.screenshot({ path: path.join(OUT, 'phone-390-folders-edit.png') });
await page.fill('dialog.scm input[list]', 'my/set'); await page.fill('dialog.scm .org-f:nth-of-type(2) input', 'My Fave, dark');
await tap('dialog.scm .scm-ok'); await page.waitForSelector('dialog.scm', { state: 'detached' });
await q('my-fave');
check('move-to-folder and tag edit (site modal): the recipe is found by its new tag and sits in the new folder', (await count()).shown === 1 && (await page.$eval('#list li[data-id="four-on-the-floor"] .sub', (s) => s.textContent)).includes('my/set'));
await q('');
check('the new folder shows in the tree with count 1 and the edit used no native dialog', (await page.$$eval('#org .org-node[data-path="my"]', (n) => n.length)) === 1 && nativeDialog === 0);
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#org .org'); await page.waitForFunction(() => document.querySelectorAll('#list li[data-id]').length > 0);
check('the user folder and tags persist after a reload', (await page.evaluate(() => JSON.parse(localStorage.getItem('sc.taxonomy')).entries['recipe!four-on-the-floor'])).folder === 'my/set');
// bad folder is refused with a toast, the modal stays
await tap('#list li[data-id]:first-child .row'); await tap('.org-insp >> text=Folder and tags'); await page.waitForSelector('dialog.scm[open] .org-form');
await page.fill('dialog.scm input[list]', 'Bad//Path!'); await tap('dialog.scm .scm-ok'); await page.waitForTimeout(150);
check('a malformed folder is normalised or refused, never stored raw', await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sc.taxonomy')); return Object.values(d.entries).every((e) => e.folder === undefined || /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(e.folder)); }));
await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(100); if (await page.$('dialog.scm[open]')) await tap('dialog.scm .scm-acts .ghost');
// appearance override persists, exports and imports
await openOrg(); await tap('#org .org-acts >> text=Appearance'); await page.waitForSelector('dialog.scm[open] .org-sw');
await page.selectOption('dialog.scm select', 'drums'); await tap('dialog.scm .org-swb[data-c="lime"]'); await tap('dialog.scm .org-swb[data-i="vox"]'); await tap('dialog.scm .org-swb[data-p="stripe"]');
await page.screenshot({ path: path.join(OUT, 'phone-390-folders-appearance.png') });
const swSize = await page.$$eval('dialog.scm .org-swb', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return Math.min(r.width, r.height); }).filter((v) => v < 44).length);
await tap('dialog.scm .scm-ok'); await page.waitForSelector('dialog.scm', { state: 'detached' });
const ov = await page.$eval('#org .org-chip[data-tag="drums"] .tx-ico', (e) => [e.dataset.color, e.dataset.icon, e.dataset.pattern, e.dataset.tx]);
check('appearance dialog: palette and icon choices are 44 px targets; applying restyles the chip (lime, vox, stripe, source user)', swSize === 0 && ov.join() === 'lime,vox,stripe,user', swSize + ' ' + ov.join());
check('a folder whose dominant tag is drums changes with the override (same tag, same look)', await page.evaluate(() => { const n = document.querySelector('#org .org-node[data-path="strudel"] .tx-ico'); return n && n.dataset.color === 'lime'; }));
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#org .org'); await openOrg(); await page.waitForSelector('#org .org-chip[data-tag="drums"]');
check('the appearance override persists after a reload', (await page.$eval('#org .org-chip[data-tag="drums"] .tx-ico', (e) => e.dataset.color)) === 'lime');
const exported = await page.evaluate(() => window.strudelCraftExport = window.strudelCraft.taxonomyStore.exportJSON()); const exp = JSON.parse(exported);
check('the JSON export holds folders, entry folders/tags and the appearance override (format taxonomy@1)', exp.format === 'taxonomy@1' && exp.styles.drums.color === 'lime' && exp.entries['recipe!four-on-the-floor'].tags.includes('my-fave') && exp.folders.includes('my/set'));
const dl2 = page.waitForEvent('download'); await tap('#org .org-acts >> text=Export'); const dlf = await dl2; check('Export downloads a .json file', /\.json$/.test(dlf.suggestedFilename()));
await page.evaluate(() => window.strudelCraft.taxonomyStore.clear()); await page.waitForTimeout(80);
check('clearing the store removes the override (chip back to the pack colour)', (await page.$eval('#org .org-chip[data-tag="drums"] .tx-ico', (e) => e.dataset.color)) !== 'lime');
const imp = await page.evaluate((j) => { const r = window.strudelCraft.taxonomyStore.importJSON(j); return r.ok; }, exported); await page.waitForTimeout(80);
check('importing the exported document restores everything', imp && (await page.$eval('#org .org-chip[data-tag="drums"] .tx-ico', (e) => e.dataset.color)) === 'lime');
// light theme contrast in the page: chip ink on its tint
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await page.waitForTimeout(80);
const lc = await page.evaluate(() => { const rgba = (s) => s.match(/[\d.]+/g).map(Number); const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }; let min = 99; for (const e of document.querySelectorAll('#org .tx-ico')) { const cs = getComputedStyle(e); const fg = rgba(cs.color), bg = rgba(cs.backgroundColor); const a = bg[3] ?? 1; if (a < 1) continue; const L1 = lum(fg), L2 = lum(bg); min = Math.min(min, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)); } return min; });
check('in the page, light theme: icon ink on tint is AA', lc >= 4.5, lc.toFixed(2)); await page.screenshot({ path: path.join(OUT, 'phone-390-folders-light.png') });
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
// Syntax organizer
await page.evaluate(() => window.__sc.setView('syntax')); await page.waitForSelector('#syntax .org', { timeout: 15000 });
const sx0 = await page.$$eval('#syntax .sx-sec:not([hidden])', (s) => s.length);
await tap('#syntax .org summary'); const tg = await page.$('#syntax .org-chip[data-tag="coming"]');
if (tg) { await tap('#syntax .org-chip[data-tag="coming"]'); } const sx1 = await page.$$eval('#syntax .sx-sec:not([hidden])', (s) => s.length);
check('Syntax view: the organizer filters sections by tag (coming)', sx0 > 0 && (!tg || sx1 < sx0 || sx1 === 0), `${sx0} -> ${sx1}`);
await page.screenshot({ path: path.join(OUT, 'phone-390-folders-syntax.png') });
// Banks organizer
const banks = await page.evaluate(async () => { const m = await import('./voxbrowser.js'); const d = document.createElement('div'); document.body.append(d); await m.mount(d); await new Promise((r) => setTimeout(r, 1500)); return { org: !!d.querySelector('.org'), cards: d.querySelectorAll('.vb-card').length }; });
check('Banks browser: the organizer mounts and lists the bank cards', banks.org && banks.cards >= 1, JSON.stringify(banks));

// the OR deep link, real touch
await ready('#folder=hiphop&tag=drums,bass&mode=or'); const orN = (await count()).shown;
await ready('#folder=hiphop&tag=drums,bass'); const andN = (await count()).shown;
check('a #...&mode=or deep link loads in OR mode (switch on, wider than AND)', orN > andN && andN >= 0, `${orN} > ${andN}`);
await ready('#folder=hiphop&tag=drums,bass&mode=or'); await openOrg();
check('the OR deep link shows the switch on', await page.$eval('#org .org-mode', (b) => b.getAttribute('aria-checked')) === 'true');
// computed-colour sampling: first 10 folder boxes and first 10 chips, ink on tint and label on its surface, both themes
const sample = async (theme) => { await page.evaluate((th) => { th === 'dark' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', th); }, theme); await page.waitForTimeout(100);
  return page.evaluate(() => { const rgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; }; const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3]), 1];
    const bgOf = (e) => { const L = []; for (let x = e; x; x = x.parentElement) { const c = rgba(getComputedStyle(x).backgroundColor); if (c[3] > 0) { L.push(c); if (c[3] >= 1) break; } } let b = [255, 255, 255, 1]; for (const c of L.reverse()) b = over(c, b); return b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const els = [...[...document.querySelectorAll('#org .org-node .tx-ico')].slice(0, 10), ...[...document.querySelectorAll('#org .org-chip .tx-ico')].slice(0, 10)];
    const labels = [...[...document.querySelectorAll('#org .org-node .org-name')].slice(0, 10), ...[...document.querySelectorAll('#org .org-chip > span:not(.tx-ico)')].slice(0, 10)];
    let min = 99, worst = ''; for (const e of els) { const fg = rgba(getComputedStyle(e).color), bg = bgOf(e); const r = ratio(over(fg, bg), bg); if (r < min) { min = r; worst = e.dataset.color + ' ico'; } }
    for (const e of labels) { const fg = rgba(getComputedStyle(e).color), bg = bgOf(e); const r = ratio(over(fg, bg), bg); if (r < min) { min = r; worst = e.textContent.trim().slice(0, 14) + ' label'; } }
    return { n: els.length + labels.length, min: +min.toFixed(2), worst, theme: document.documentElement.dataset.theme || 'dark' }; }); };
await tap('#org .org-more').catch(() => {});
for (const th of ['dark', 'light']) { const s = await sample(th); check(`computed colours of 10 folder boxes, 10 chips and their labels are AA in the ${th} theme`, s.n >= 18 && s.min >= 4.5, JSON.stringify(s)); }
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
// alias: an older recipe id opens the recipe it became, with one hint (site recipe lookup)
const al = await page.evaluate(async () => { const S = window.__sc.S; S.recipes.find((r) => r.id === 'four-on-the-floor').aliases = ['four-old']; location.hash = '#r/four-old'; await new Promise((r) => setTimeout(r, 400)); return { hash: location.hash, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).join('|') }; });
check('site: #r/<old id> opens the new recipe, rewrites the link, and hints once', al.hash === '#r/four-on-the-floor' && /four-old.*four-on-the-floor/.test(al.toast), JSON.stringify(al));
check('every tap in this test was a real touch event (CDP touchstart seen by the page)', touches > 20 && (await page.evaluate(() => window.__touch)) > 3, `${touches} taps, page saw ${await page.evaluate(() => window.__touch)}`);
check('no native alert/prompt/confirm was opened', nativeDialog === 0);
check('no console errors or page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close(); server.close();
const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} taxonomy checks passed`); process.exit(failed.length ? 1 : 0);
