// #85 Banks browser at 360px: lists every bank with counts, search finds "baby" in sung, audition is audible, insert places the snippet,
// word(" completions follow the active bank. Bank files are read only after the panel opens. Usage: node tests/site/voxbrowser.mjs [shot.png]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown' };
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); }).listen(0);
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = []; const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const errs = [];
try {
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const reqs = [];
  p.on('request', (r) => reqs.push(r.url())); p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  /* the word() prelude's own demo map (loaded with the engine, before #85) is not a browser read */
  const bankFiles = () => reqs.filter((u) => /data\/vox\/.*(words\.json|strudel\.json|banks\.json)$/.test(u)).map((u) => u.replace(/^.*data\/vox\//, '')).filter((f) => f !== 'demo/pitched/strudel.json' || reqs.filter((u) => u.endsWith(f)).length > 1);
  await p.goto(`http://localhost:${srv.address().port}/index.html#syntax`); await p.waitForSelector('#list li');
  await p.waitForSelector('#syntax .vb-open', { timeout: 15000 });
  await p.waitForTimeout(800);
  check('no bank words.json / strudel.json / banks.json read before the panel opens', bankFiles().length === 0, JSON.stringify(bankFiles()));

  /* 1. the panel lists all banks with counts */
  await p.tap('#syntax .vb-open'); await p.waitForSelector('dialog.vb-sheet[open] .vb-card', { timeout: 15000 });
  const cards = await p.$$eval('dialog.vb-sheet .vb-card', (cs) => cs.map((c) => ({ name: c.dataset.bank, kind: c.dataset.kind, w: +c.querySelector('.vb-w').textContent, c: +c.querySelector('.vb-c').textContent, active: c.dataset.active, pitch: c.querySelector('.vb-pitch').textContent, lic: c.querySelector('.vb-lic').textContent })));
  const want = ['demo', 'call-me-baby', 'ljspeech', 'vocalset', 'sung'];
  check('panel lists all 5 shipped banks with word and clip counts, kind, pitches and licence', want.every((n) => cards.some((c) => c.name === n && c.w > 0 && c.c > 0 && c.pitch && c.lic)) && cards.find((c) => c.name === 'vocalset').kind === 'sound' && cards.find((c) => c.name === 'demo').active === 'true', JSON.stringify(cards.map((c) => [c.name, c.kind, c.w, c.c])));
  check('only the bank index was read on open (no per-bank file yet)', bankFiles().join() === 'banks.json', JSON.stringify(bankFiles()));
  if (process.argv[2]) await p.screenshot({ path: process.argv[2].replace(/\.png$/, '-list.png') });
  const wide = await p.evaluate(() => document.documentElement.scrollWidth); check('no sideways overflow at 360px', wide <= 360, 'scrollWidth ' + wide);

  /* 2. search finds "baby" in the sung bank */
  await p.tap('dialog.vb-sheet [data-open="sung"]'); await p.waitForSelector('dialog.vb-sheet .vb-q');
  await p.fill('dialog.vb-sheet .vb-q', 'baby'); await p.waitForTimeout(200);
  const rows = await p.$$eval('dialog.vb-sheet .vb-row', (rs) => rs.map((r) => ({ key: r.dataset.key, chips: [...r.querySelectorAll('.vb-pc')].map((c) => c.textContent), ins: r.querySelector('.vb-ins code').textContent })));
  check('search "baby" in sung finds vox_baby with its five pitches', rows.length >= 1 && rows[0].key === 'vox_baby' && rows[0].chips.join(' ') === 'd#3 a3 d#4 a4 d#5', JSON.stringify(rows.slice(0, 2)));
  check('sung bank files came through the pack loader only when opened', ['sung/words.json', 'sung/pitched/strudel.json'].every((f) => bankFiles().includes(f)) && !reqs.some((u) => /\.ogg$/.test(u)), JSON.stringify(bankFiles()));
  if (process.argv[2]) await p.screenshot({ path: process.argv[2] });

  /* 3. audition produces sound */
  await p.tap('dialog.vb-sheet .vb-row[data-key="vox_baby"] .vb-pc[data-ci="1"]');
  await p.waitForFunction(() => window.strudelCraft.voxBanks.lastPeak > 0.01, null, { timeout: 8000 }).catch(() => {});
  const peak = await p.evaluate(() => window.strudelCraft.voxBanks.lastPeak);
  check('audition of baby at a3 is audible (peak on the clip analyser)', peak > 0.01, 'peak ' + peak.toFixed(3) + ', clip ' + (reqs.find((u) => /baby_a3\.ogg$/.test(u)) || 'not fetched').replace(/^.*\//, ''));

  /* 4. insert places the snippet */
  const snip = await p.$eval('dialog.vb-sheet .vb-row[data-key="vox_baby"] .vb-ins code', (c) => c.textContent);
  await p.tap('dialog.vb-sheet .vb-row[data-key="vox_baby"] .vb-ins'); await p.waitForTimeout(300);
  const code = await p.evaluate(() => document.getElementById('code').value);
  check('insert puts the snippet and its voxBank line into the Rack code', snip === 'word("baby").note("a3")' && code.includes('$: word("baby").note("a3")') && code.includes("await voxBank('sung')"), JSON.stringify({ snip, tail: code.slice(-80) }));

  /* 5. completions follow the active bank */
  await p.evaluate(() => document.getElementById('banksSheet').close());
  const popup = async () => {
    await p.evaluate(() => { location.hash = '#rack'; });
    const ed = p.locator('.view-rack .cm-content').first(); await ed.waitFor({ timeout: 15000 }); await ed.click();
    await p.keyboard.press('Control+a'); await p.keyboard.press('Delete'); await p.keyboard.type('word("lo');
    await p.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 10000 });
    await p.waitForTimeout(300);
    const r = await p.$$eval('.cm-tooltip-autocomplete li, .cm-tooltip-autocomplete completion-section', (ls) => ls.map((l) => l.textContent));
    await p.keyboard.press('Escape'); return r;
  };
  const before = await popup();
  const sw = await p.evaluate(async () => { try { return await window.strudelCraft.voxBanks.use('sung'); } catch (e) { return 'ERR ' + e.message; } });
  const after = await popup();
  const sec = (l) => l.filter((t) => /^words · /.test(t));
  check('word(" completions come from the active bank and change after switching (demo -> sung)', sec(before)[0] === 'words · demo' && sec(after)[0] === 'words · sung' && after.some((t) => /^love/.test(t)) && JSON.stringify(before) !== JSON.stringify(after), JSON.stringify({ sw, before: before.slice(0, 4), after: after.slice(0, 4) }));
  check('voxBank.list() is richer and voxBank.words(name) lists entries', await p.evaluate(async () => { const l = window.voxBank.list(); const s = l.find((x) => x.name === 'sung'); const w = await window.voxBank.words('vocalset'); return !!(s && s.active && s.clips === 998 && s.kind === 'word' && s.licence && w.some((e) => e.key === 'vs_a_forte' && e.notes.length)); }));
  const hover = await p.evaluate(async () => window.strudelCraft.voxBanks.describeActive()); check('hover / long-press text names the active bank and its size', /Active bank: sung · word bank · 200 words · 998 clips/.test(hover), hover);
  const sx = await p.evaluate(async () => (await window.strudelCraft.packs.syntax()).sections.some((s) => s.id === 'banks')); check('Syntax view has a Banks section', sx);
  check('no page errors', !errs.filter((e) => !/getTrigger|favicon|Failed to load resource/.test(e)).length, JSON.stringify(errs.slice(0, 3)));
} finally { await b.close(); srv.close(); }
const ok = results.every(Boolean); console.log(`${results.filter(Boolean).length}/${results.length} ${ok ? 'PASS' : 'FAIL'}`); process.exit(ok ? 0 : 1);
