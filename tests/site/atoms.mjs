// Atoms A3 (#63), browser side: the intellisense provider in the real editor (shape-filtered items, `atoms.` member completion,
// signature help inside atoms.kick4(, the "use atoms.name" action on a string literal) and the existing literal editors working on
// an atom reference's args (scrub clamps to the atomParam range, one compile, one history commit). Usage: node tests/site/atoms.mjs
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = []; const errors = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 't', html_url: '', body: '' }) : '[]' }));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

const DECLS = 'atom("kick4",   { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*${n}" })\n'
  + 'atom("sawLead", { type: "sound", body: "sawtooth" })\n'
  + 'atom("atDrop",  { type: "gate", body: "@17b" })\n';
const setDoc = (text) => page.evaluate((t) => { const v = document.getElementById('code').cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, userEvent: 'input' }); v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); }, text);
const docText = () => page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
const stats = () => page.evaluate(() => ({ ...window.strudelCraft.settle.stats }));
const settle = () => page.waitForTimeout(1800);
const opts = async () => { /* the popup opens while typing; a programmatic doc change asks for it explicitly */
  await page.evaluate(() => window.strudelCraft.intellisense.startCompletion(document.getElementById('code').cmView));
  await page.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 6000 }).catch(() => {});
  return page.$$eval('.cm-tooltip-autocomplete li', (ls) => ls.map((l) => l.textContent)); };
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(100); };

await page.goto(BASE);
await page.waitForFunction(() => document.documentElement.dataset.editor === 'cm6' && window.strudelCraft.atoms && window.strudelCraft.atoms.ready, null, { timeout: 30000 });
await page.waitForSelector('#list li');
const reg = await page.evaluate(() => ({ sources: window.strudelCraft.intellisense.sources(), ready: !!window.strudelCraft.atoms.ready }));
check('atoms registers one completion source on the existing registry', reg.sources.includes('atoms'), JSON.stringify(reg));

// Box: completion by shape
await setDoc(DECLS + '$: s(');
const inS = await opts();
await esc();
await setDoc(DECLS + 'hooks.bind("fx", "murk", ');
const inBind = await opts();
await esc();
check('completion by shape: inside s( the mini and sound atoms are offered and no gate atom; argument 2 of hooks.bind( offers the gate and point atoms only',
  inS.some((o) => /atoms\.kick4/.test(o)) && inS.some((o) => /atoms\.sawLead/.test(o)) && !inS.some((o) => /atoms\.atDrop/.test(o))
  && inBind.some((o) => /atoms\.atDrop/.test(o)) && !inBind.some((o) => /atoms\.kick4/.test(o)),
  JSON.stringify({ s: inS.filter((o) => /atoms\./.test(o)), bind: inBind.filter((o) => /atoms\./.test(o)) }));

// Box: member completion
await setDoc(DECLS + '$: s(atoms.');
const mem = await opts();
await esc();
const memData = await page.evaluate(() => {
  const a = window.strudelCraft.atoms;
  a.configure({ catalog: { snd: Array.from({ length: 5000 }, (_, i) => `bank${i}`).concat(['bd', 'sd']) } });
  const env = a.env(document.getElementById('code').cmView.state.doc.toString());
  const r = { all: a.memberItems(env, {}).map((i) => i.label), pre: a.memberItems(env, { path: 'snd.b' }).map((i) => i.label) };
  a.configure({ catalog: null }); return r;
});
check('member completion: after atoms. the editor lists the declared names and the catalog namespaces; a catalog namespace answers by prefix with at most 50 items',
  mem.some((o) => /atoms\.kick4/.test(o)) && mem.some((o) => /atoms\.snd/.test(o)) && memData.pre.length === 50 && memData.pre.every((l) => l.startsWith('atoms.snd.b')) && memData.all.includes('atoms.bank'),
  JSON.stringify({ popup: mem.slice(0, 6), prefixItems: memData.pre.length, first: memData.pre.slice(0, 3) }));

// Box: signature help
await setDoc(DECLS + '$: s(atoms.kick4(');
await page.waitForSelector('.cm-sighelp', { timeout: 6000 }).catch(() => {});
const sig = await page.textContent('.cm-sighelp').catch(() => '');
const sigActive = await page.textContent('.cm-sighelp .cm-sig-active').catch(() => '');
await esc();
check('signature help: inside atoms.kick4( the tooltip shows n with its range', /atoms\.kick4\(n\)/.test(sig.replace(/\s+/g, '')) && /1\.\.16/.test(sig) && sigActive === 'n', JSON.stringify({ sig, active: sigActive }));

// Box: string-to-atom suggestion
await setDoc(DECLS + '$: s("sawtooth');
const strOpts = await opts();
const hasUse = strOpts.some((o) => /use atoms\.sawLead/.test(o));
let applied = '';
if (hasUse) {
  const li = page.locator('.cm-tooltip-autocomplete li', { hasText: 'use atoms.sawLead' }).first();
  await li.click().catch(() => {});
  await page.waitForTimeout(250); applied = await docText();
  if (applied.endsWith('"sawtooth')) { await page.keyboard.press('Enter'); await page.waitForTimeout(250); applied = await docText(); }
}
await esc();
check('string-to-atom suggestion: the literal "sawtooth" gets a "use atoms.sawLead" action that rewrites only that literal',
  hasUse && applied === DECLS + '$: s(atoms.sawLead', JSON.stringify({ hasUse, tail: applied.slice(DECLS.length) }));

// Box: editors on an atom reference's arg
await setDoc(DECLS + '$: s(atoms.kick4({ n: 8 })).gain(0.8)\n');
await settle();
const litInfo = await page.evaluate(() => {
  const list = window.strudelCraft.literals.list();
  const l = list.find((x) => x.kind === 'number' && x.value === 8);
  return l ? { id: l.id, editor: l.editor, shape: l.shape } : null;
});
const c0 = await stats(); const h0 = await page.evaluate(async () => (await window.strudelCraft.history.log()).length);
await page.evaluate(() => document.getElementById('code').cmView.dom.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
const pt = await page.evaluate(() => { const v = document.getElementById('code').cmView; const i = v.state.doc.toString().indexOf('n: 8') + 3; const c = v.coordsAtPos(i); const vv = window.visualViewport || { offsetLeft: 0, offsetTop: 0 }; return { x: c.left + 1 - vv.offsetLeft, y: (c.top + c.bottom) / 2 - vv.offsetTop }; });
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', pt.x, pt.y);
for (let i = 1; i <= 12; i++) { await touch('touchMove', pt.x + i * 30, pt.y); await page.waitForTimeout(16); }
const mid = await docText();
await touch('touchEnd');
await settle();
const end = await docText(); const c1 = await stats(); const h1 = await page.evaluate(async () => (await window.strudelCraft.history.log()).length);
check('editors: scrubbing the 8 in atoms.kick4({ n: 8 }) rewrites only that number, clamps to the atom\'s 1..16, and produces one compile and one history commit',
  litInfo && litInfo.editor === 'scrub' && litInfo.shape && litInfo.shape.min === 1 && litInfo.shape.max === 16
  && mid === DECLS + '$: s(atoms.kick4({ n: 8 })).gain(0.8)\n' && end === DECLS + '$: s(atoms.kick4({ n: 16 })).gain(0.8)\n'
  && c1.compiles - c0.compiles === 1 && h1 - h0 === 1,
  JSON.stringify({ shape: litInfo && litInfo.shape, editor: litInfo && litInfo.editor, end: end.slice(DECLS.length).trim(), compiles: c1.compiles - c0.compiles, commits: h1 - h0 }));

await setDoc('$: s(atoms.nope)\n');
let dlg = 0; page.on('dialog', (d) => { dlg++; d.dismiss(); });
await page.click('#playBtn');
await page.waitForFunction(() => document.querySelector('#status').classList.contains('err'), null, { timeout: 60000 }).catch(() => {});
const unk = await page.evaluate(() => ({ status: document.querySelector('#status').textContent, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|'), playing: window.__sc ? window.__sc.S.playing : null }));
check('unknown atom: playing s(atoms.nope) shows E_ATOM_UNKNOWN with the name (no "is not defined"), the code is unchanged, nothing plays and no native dialog fires',
  /E_ATOM_UNKNOWN/.test(unk.status) && /nope/.test(unk.status) && !/is not defined/.test(unk.status + unk.toast) && (await docText()) === '$: s(atoms.nope)\n' && !unk.playing && dlg === 0, JSON.stringify({ ...unk, dlg }));

const realErrors = errors.filter((e) => !/E_ATOM_UNKNOWN/.test(e)); // the reported eval error is logged by the engine
check('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
await browser.close(); server.close();
const bad = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed.`);
process.exit(bad.length ? 1 : 0);
