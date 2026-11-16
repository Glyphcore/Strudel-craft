// Two forms of every recipe's code (docs/LOWERING.md, site/forms.js): `node tests/site/forms.mjs` (serves site/, playwright).
// 390x844 touch: the Rack inspector of a concept recipe shows Craft and Strudel tabs (44 px targets), the Craft tab has atoms / .hook, the Strudel tab has neither,
// each Copy puts exactly that form on the clipboard, Insert into editor puts Craft in the editor by default and the Strudel form from the Strudel tab;
// a plain recipe says both forms are identical; a Syntax example that needs the Craft runtime says why (Copy Strudel disabled), a lowered one copies its plain form;
// no horizontal overflow at 390 px; data: every catalog recipe with a lowered form carries a passing check, and the hap-equality build check (tools/lowering/build.mjs --check) passes.
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import { spawnSync } from 'node:child_process';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const ROOT = path.join(REPO, 'site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const ORIGIN = `http://localhost:${server.address().port}`; let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog.json'), 'utf8')).recipes; const syn = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/syntax.json'), 'utf8'));

// ---- data
const lowered = cat.filter((r) => r.lowered); const R = cat.find((r) => r.id === 'boom-bap-kick'), P = cat.find((r) => !r.lowered);
ok('catalog: concept recipes carry a distinct lowered form', lowered.length >= 41 && lowered.every((r) => r.lowered !== r.code && !/\batoms\b|\.hook\(/.test(r.lowered)), `${lowered.length} of ${cat.length}`);
ok('catalog: every lowered form has a build-time check; none differs unexplained', lowered.every((r) => r.lowered_check && (r.lowered_check.equal || r.lowered_check.approx)), `${lowered.filter((r) => r.lowered_check.equal).length} identical events, ${lowered.filter((r) => r.lowered_check.approx).length} approximate (grooves)`);
const exs = syn.sections.flatMap((s) => s.examples).filter((e) => e.code);
ok('syntax: each example has a lowered form, a reason it has none, or is plain', exs.every((e) => !(e.lowered && e.lowered_note)) && exs.some((e) => e.lowered) && exs.some((e) => e.lowered_note), `${exs.filter((e) => e.lowered).length} lowered, ${exs.filter((e) => e.lowered_note).length} runtime-only, ${exs.filter((e) => !e.lowered && !e.lowered_note).length} identical`);
const byTitle = (s) => exs.find((e) => e.title === s);
const rep = byTitle('Replace a hygiene rack for the whole program'), fad = byTitle('Fader for one lane'), gated = byTitle('Drop-in at bar 3 (@3b)');
ok('syntax: a static def + hook lowers (program-local def wins), a fader names ctl/hooks.map, a gated bind names the gate', rep && /hpf\(300\).*lpf\(5000\)/.test(rep.lowered) && !/hooks\./.test(rep.lowered) && fad && /hooks\.map/.test(fad.lowered_note) && gated && /gated/.test(gated.lowered_note));
const slotEx = byTitle('A slot and a hook'); ok('syntax: static hooks.def + hooks.bind + .use is lowered', slotEx && slotEx.lowered && !/hooks\.|\.use\(/.test(slotEx.lowered) && slotEx.lowered_check && slotEx.lowered_check.equal);
ok('intellisense: <id> offers r.lowered || r.expr, so every lowered recipe has it', /const plain = r\.lowered \|\| r\.expr/.test(fs.readFileSync(path.join(ROOT, 'intellisense.js'), 'utf8')));
const docMd = fs.readFileSync(path.join(REPO, 'docs/LOWERING.md'), 'utf8'); const st = JSON.parse(spawnSync('node', [path.join(REPO, 'tools/lowering/build.mjs'), '--check', '--no-verify'], { encoding: 'utf8' }).stdout || '{}').stats;
ok('docs/LOWERING.md counts are the tool\'s counts', st && docMd.includes(`${st.syntax.total} with code`) && docMd.includes(`${st.syntax.lowered} lowered`) && docMd.includes(`${st.catalog.lowered} have a distinct Strudel form`), JSON.stringify(st));
ok('docs/LOWERING.md states the uncovered cases (take / library views, edited-recipe strudel.cc link)', /take and library views/.test(docMd) && /edited/.test(docMd));
// drift is never hidden: inject the two critic drifts (an edited gain in a plain recipe, an extra .gain in a groove recipe) into a scratch copy of the data; the build must fail on both
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lowering-drift-')); fs.mkdirSync(path.join(tmp, 'site/data'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'docs'));
  for (const f of ['site/data/syntax.json', 'docs/LOWERING.md']) fs.copyFileSync(path.join(REPO, f), path.join(tmp, f));
  const c2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog.json'), 'utf8')); const get = (id) => c2.recipes.find((r) => r.id === id);
  const run = () => { fs.writeFileSync(path.join(tmp, 'site/data/catalog.json'), JSON.stringify(c2, null, 1).replace(/"(peak|rms_dbfs|bpm_hint)": (-?\d+)(,?)\n/g, '"$1": $2.0$3\n')); return spawnSync('node', [path.join(REPO, 'tools/lowering/build.mjs'), '--check'], { encoding: 'utf8', env: { ...process.env, LOWERING_DATA_ROOT: tmp, STRUDEL_CRAFT: REPO } }); };
  const cliOk = fs.existsSync((process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli') + '/strudel');
  if (cliOk) {
    const a = get('chopped-chords'), b = get('groove-mpc-swing'); const a0 = a.lowered, b0 = b.lowered;
    a.lowered = a0.replace('.gain(0.2)', '.gain(0.9*0.2)'); const r1 = run(); const o1 = JSON.parse(r1.stdout || '{}');
    ok('drift injected into a plain recipe (.gain(0.2) -> .gain(0.9*0.2)) fails the check', r1.status === 1 && (o1.drift || []).some((d) => d.startsWith('catalog chopped-chords')), (r1.stdout || r1.stderr).slice(0, 160));
    a.lowered = a0; b.lowered = b0 + '.gain(0.37)'; const r2 = run(); const o2 = JSON.parse(r2.stdout || '{}');
    ok('drift injected into a groove recipe (+ .gain(0.37)) is not labelled approximate: the check fails', r2.status === 1 && (o2.drift || []).some((d) => d.startsWith('catalog groove-mpc-swing')) && !(o2.approx || []).includes('catalog groove-mpc-swing'), (r2.stdout || r2.stderr).slice(0, 160));
    b.lowered = b0; const r3 = run(); ok('the untouched copy passes', r3.status === 0, (r3.stdout || r3.stderr).slice(0, 160));
  } else ok('drift injection (skipped: no CLI)', true);
  fs.rmSync(tmp, { recursive: true, force: true });
}
const lb = spawnSync('node', [path.join(REPO, 'tools/lowering/build.mjs'), '--check', '--verify'], { encoding: 'utf8', env: { ...process.env, STRUDEL_CRAFT: REPO } });
const noCli = /ENOENT|no such/.test(lb.stderr || '') || !fs.existsSync((process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli') + '/strudel');
ok('hap equality: tools/lowering/build.mjs --check --verify re-runs every Craft/Strudel pair through `strudel events` (exit 0)', lb.status === 0 || noCli, noCli ? 'skipped: no CLI' : (lb.stdout || lb.stderr).slice(0, 300));

// ---- UI at 390
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
const clip = () => page.evaluate(() => navigator.clipboard.readText()); const editor = () => page.evaluate(() => { const t = document.getElementById('code'); return t.cmView ? t.cmView.state.doc.toString() : t.value; });
await page.goto(ORIGIN + '/index.html#r/' + R.id); await page.waitForSelector('#inspector .fm', { timeout: 30000 });
const fm = page.locator('#inspector .fm');
const tabs = await fm.locator('.fm-tab').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, w: r.width, h: r.height }; }));
ok('inspector: Craft and Strudel tabs, 44 px targets', tabs.length === 2 && tabs[0].t === 'Craft' && tabs[1].t === 'Strudel' && tabs.every((x) => x.h >= 44 && x.w >= 44), JSON.stringify(tabs));
const shown = (f) => fm.locator(`.fm-panel[data-f=${f}] pre`).textContent();
ok('Craft tab (default) shows the authored code with atoms and .hook', (await shown('craft')) === R.code && /atoms\./.test(R.code) && /\.hook\(/.test(R.code));
await fm.locator('.fm-copy').tap(); await page.waitForTimeout(250);
ok('Copy Craft puts the Craft form on the clipboard', (await clip()) === R.code);
await fm.locator('.fm-ins').tap(); await page.waitForTimeout(300);
ok('Insert into editor inserts the Craft form by default', (await editor()) === R.code);
await fm.locator('.fm-tab[data-f=strudel]').tap(); await page.waitForTimeout(150);
const sv = await fm.locator('.fm-panel[data-f=strudel] pre').isVisible(); const cv = await fm.locator('.fm-panel[data-f=craft]').isVisible();
ok('Strudel tab shows the lowered plain form (Craft hidden)', sv && !cv && (await shown('strudel')) === R.lowered && !/\batoms\b|\.hook\(/.test(await shown('strudel')));
ok('Strudel tab states the check', /Checked: the same \d+ events/.test(await fm.locator('.fm-panel[data-f=strudel] .fm-note').textContent()), await fm.locator('.fm-panel[data-f=strudel] .fm-note').textContent());
await fm.locator('.fm-copy').tap(); await page.waitForTimeout(250);
ok('Copy Strudel puts the lowered form on the clipboard', (await clip()) === R.lowered);
await fm.locator('.fm-ins').tap(); await page.waitForTimeout(300);
ok('Insert (Strudel) puts the lowered form in the editor', (await editor()) === R.lowered);
const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); ok('no horizontal overflow at 390 px', ov.sw <= ov.cw + 1, JSON.stringify(ov));
fs.mkdirSync(path.join(REPO, 'docs/screens'), { recursive: true }); await page.locator('#inspector').scrollIntoViewIfNeeded(); await fm.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(REPO, 'docs/screens/phone-390-forms-rack.png') });
// a recipe without sugar: identical
await page.goto(ORIGIN + '/index.html#r/' + P.id); await page.waitForSelector(`#inspector .fm`); await page.waitForFunction((t) => document.querySelector('#inspector .title')?.textContent === t, P.title);
const f2 = page.locator('#inspector .fm'); await f2.locator('.fm-tab[data-f=strudel]').tap();
ok('plain recipe: the Strudel tab says both forms are identical and has the same code', /Identical to the Craft form/.test(await f2.locator('.fm-panel[data-f=strudel] .fm-note').textContent()) && (await f2.locator('.fm-panel[data-f=strudel] pre').textContent()) === P.code && (await f2.locator('.fm-badge').textContent()) === 'identical');
// Syntax view
await page.evaluate(() => window.__sc.setView('syntax')); await page.waitForFunction(() => window.strudelCraft.syntax && window.strudelCraft.syntax.go('slots'), null, { timeout: 30000 }); await page.waitForSelector('#syntax .sx-ex .fm', { timeout: 30000 });
const rt = syn.sections.flatMap((s) => s.examples).find((e) => e.lowered_note), lo = syn.sections.flatMap((s) => s.examples).find((e) => e.lowered && e.lowered_check && e.lowered_check.equal);
const fig = (title) => page.locator('#syntax .sx-ex', { has: page.locator('figcaption span', { hasText: title }) }).first();
const a = fig(rt.title); await a.scrollIntoViewIfNeeded(); await a.locator('.fm-tab[data-f=strudel]').tap();
ok('Syntax: a runtime-only example says why and has no Strudel code', (await a.locator('.fm-panel[data-f=strudel] .fm-note').textContent()).includes(rt.lowered_note) && (await a.locator('.fm-panel[data-f=strudel] pre').count()) === 0 && await a.locator('.fm-copy').isDisabled());
const b = fig(lo.title); await b.scrollIntoViewIfNeeded(); await b.locator('.fm-copy').tap(); await page.waitForTimeout(250);
const c1 = await clip(); await b.locator('.fm-tab[data-f=strudel]').tap(); await b.locator('.fm-copy').tap(); await page.waitForTimeout(250);
ok('Syntax: Copy Craft and Copy Strudel copy the two forms of a lowered example', c1 === lo.code && (await clip()) === lo.lowered && lo.code !== lo.lowered);
const ov2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...document.querySelectorAll('#syntax .fm')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length })); ok('Syntax: no horizontal overflow at 390 px', ov2.sw <= ov2.cw + 1 && ov2.over === 0, JSON.stringify(ov2));
await b.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(REPO, 'docs/screens/phone-390-forms-syntax.png') });
ok('no console errors', errs.length === 0, errs.join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
