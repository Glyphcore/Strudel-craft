// Perform presets + outputs/sources (docs/PERFORM_PRESETS.md). Standalone: node tests/site/perform_presets.mjs
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = [], errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const MODEL = { tabs: [{ kind: 'bank', id: 'A', name: 'Bank A' }, { kind: 'board', id: 'main', name: 'Board' }], active: 0, perform: true,
  banks: { A: { id: 'A', rows: 4, cols: 4, pads: [{ pos: '0,0', target: { kind: 'tap', ref: 'hit' }, label: 'hit' }, { pos: '0,1', target: { kind: 'tap', ref: 'drums' }, label: 'drums' }, { pos: '0,2', target: { kind: 'tap', ref: 'hat' }, label: 'hat' }] } },
  boards: { main: { id: 'main', cells: [], size: {} } }, controls: {}, maps: [], automation: {} };
const CODE = 'kick: s("bd*2")\nbass: note("c2 eg2").s("sawtooth")\n// reads tap("drums") here\nsetcps(0.5)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  await page.evaluate((m) => { localStorage.setItem('sc.perform', JSON.stringify(m)); localStorage.removeItem('sc.perform.presets'); }, MODEL); await page.reload(); await page.waitForSelector('#list li[data-id]');
  await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, CODE);
  await page.evaluate(() => window.__sc.play());
  await page.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && window.strudelCraft.perform && window.strudelCraft.hooks, null, { timeout: 90000 });
  await page.evaluate(() => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad');

  // --- item 2: the 2-hit tap pad ---
  const j0 = await page.evaluate(() => window.strudelCraft.hooks.journal.filter((e) => e.pad).length);
  await page.locator('.pp-pad[data-pos="0,0"]').click({ delay: 150 }); await page.waitForTimeout(300);
  const ent = await page.evaluate(() => window.strudelCraft.hooks.journal.filter((e) => e.pad === 'A/0,0').map((e) => e.op));
  check('one tap-pad hit = exactly 2 journal entries (pad:tap, pad:tap-end)', ent.length === 2 && ent[0] === 'pad:tap' && ent[1] === 'pad:tap-end' && j0 === 0, JSON.stringify(ent));
  check('orphan tap pad is marked and toasts once what the 2 hits are', await page.locator('.pp-pad[data-pos="0,0"] .pp-orph').count() === 1 && /2 hits per press/.test(await page.locator('.toast, #toasts, [role=status]').allInnerTexts().then((a) => a.join(' '))));
  check('a tap pad whose code line exists is not marked', await page.locator('.pp-pad[data-pos="0,1"] .pp-orph').count() === 0);
  const sum = await page.locator('#pfOutputs summary').innerText();
  check('Outputs lists the pads and counts the unread ones', /\(3, 2 not read/.test(sum), sum);
  const sc0 = await page.evaluate(() => [...document.querySelectorAll('.cm-scroller')].reduce((a, x) => a + x.scrollTop, 0) + ':' + document.querySelector('#code').scrollTop);
  await page.evaluate(() => { document.querySelector('#pfOutputs').open = true; });
  await page.locator('.pf-o[data-key="A/0,0"] .pf-o-name').click();
  check('tap reveals the source and explains the 2 hits', /2 journal entries/.test(await page.locator('.pf-o[data-key="A/0,0"] .pf-o-note').innerText()) && await page.locator('.pf-o[data-key="A/0,0"] .pf-o-go').count() === 0);
  await page.locator('.pf-o[data-key="A/0,1"] .pf-o-name').click();
  check('a pad with a code line shows "Rack L3: ..."', /Rack L3:.*tap\("drums"\)/.test(await page.locator('.pf-o[data-key="A/0,1"] .pf-o-line').innerText()));
  const sc1 = await page.evaluate(() => [...document.querySelectorAll('.cm-scroller')].reduce((a, x) => a + x.scrollTop, 0) + ':' + document.querySelector('#code').scrollTop); check('revealing never scrolls the editor', sc0 === sc1, sc0 + ' vs ' + sc1);
  check('the go-to-code target button exists and is the only jump', await page.locator('.pf-o[data-key="A/0,1"] .pf-o-go').count() === 1);

  // outputs <-> graph: "Show in graph" highlights the matching node ("hat" is a node of the graph demo), a missing one is explained
  await page.locator('.pf-o[data-key="A/0,2"] .pf-o-name').click(); await page.locator('.pf-o[data-key="A/0,2"] .pf-o-graph').click();
  await page.waitForFunction(() => document.querySelectorAll('.pf-graph-glow').length > 0, null, { timeout: 8000 }).then(() => check('Show in graph highlights the matching node', true), () => check('Show in graph highlights the matching node', false));
  await page.evaluate(() => window.__sc.setView('perform')); await page.waitForSelector('#perform .pp-pad');
  // --- item 1: presets ---
  await page.locator('#pfPresetBtn').click(); await page.waitForSelector('#pfPresets');
  const titles = await page.locator('.pf-pre-apply b').allTextContents();
  check('four built-in presets', ['Beatpad 4x4', 'Mixer faders per lane', 'Macro knobs for the hooks', 'Minimal'].every((t) => titles.includes(t)), titles.join('|'));
  await page.locator('[data-preset="beatpad-4x4"]').click(); await page.waitForSelector('#pfPresets', { state: 'detached' });
  const bp = await page.evaluate(() => { const m = window.strudelCraft.perform.model(); const t = m.tabs[m.active]; return { kind: t.kind, name: t.name, pads: m.banks[t.id].pads.length, takeover: m.takeover, tabs: m.tabs.length }; });
  check('Beatpad 4x4: one tap gives a 16-pad bank, jump takeover, own tabs kept', bp.kind === 'bank' && bp.pads === 16 && bp.takeover === 'jump' && bp.tabs === 3, JSON.stringify(bp));
  await page.locator('#pfPresetBtn').click(); await page.locator('[data-preset="mixer-lanes"]').click();
  await page.waitForSelector('#perform .pc-cell'); const mix = await page.evaluate(() => window.strudelCraft.perform.model().boards['pn-mixer-lanes'].cells);
  check('Mixer faders per lane: one fader per lane label (kick, bass), mapped to <lane>.gain', mix.join() === 'mix_kick,mix_bass' && /hooks\.map\('mix_kick', 'kick\.gain'\)/.test(await page.inputValue('#code')), mix.join());
  await page.locator('#pfPresetBtn').click(); await page.locator('[data-preset="minimal"]').click();
  const keys = await page.evaluate(() => window.strudelCraft.perform.model().keys);
  check('Minimal: keyboard map replaces the default (Space -> 0,0)', keys && keys.Space === '0,0');

  // user presets: save, persist across reload, export / import, delete
  await page.locator('#pfPresetBtn').click(); await page.locator('#pfPreSave').click(); await page.fill('.scm-input', 'My pads'); await page.keyboard.press('Enter');
  await page.waitForSelector('[data-preset="my-pads"]');
  check('Save current as preset adds a user preset', await page.locator('[data-preset="my-pads"]').count() === 1);
  await page.reload(); await page.waitForSelector('#list li[data-id]');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('sc.perform.presets')).presets.map((p) => p.id));
  check('user presets persist locally (sc.perform.presets)', persisted.includes('my-pads'), persisted.join());
  const imp = await page.evaluate(async () => { const m = await import('./perform-presets.js'); const doc = m.exportDoc(m.store.list()); const r = m.parseImport(JSON.stringify(doc), new Set(['my-pads'])); const bad = m.parseImport('{"id":"x","title":"t"}'); return { fmt: doc.format, ids: r.presets.map((p) => p.id), bad: bad.errors.length }; });
  check('export document is perform-presets@1; import renames clashing ids and rejects invalid presets', imp.fmt === 'perform-presets@1' && imp.ids[0] === 'my-pads-2' && imp.bad === 1, JSON.stringify(imp));
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('run to the end', false, e.stack); }
await browser.close(); server.close();
const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} passed`); process.exit(failed.length ? 1 : 0);
