// Copy code widget: `node tests/site/copycode.mjs` (serves site/, playwright + network for esm.sh / unpkg).
// At 360x740 with clipboard permission: the Rack button is 44x44 at the editor's top-right, does not overlap the code text or the
// live chip; tapping it puts the CodeMirror doc (in an error state) on the clipboard and shows the "Copied" toast + check mark;
// the Stack and Syntax buttons copy their text; the menu (long-press) copies a selection, a share link that round-trips, a valid
// recipe v1 JSON; the palette has "Copy code"; no console errors. Screenshot: docs/screens/phone-360-copycode.png
// Untrusted links (#80 rework): 400 MB / 100 MB deflate bombs, a 1.5 MB #code/p link and malformed payloads are refused with a toast
// (running page and fresh load), no crash, editor untouched, nothing plays; a normal link round-trips in a fresh profile without
// evaluating; encoding over 256 KiB is refused. Keyboard (1280px): Tab to the button, Enter / Space copy without playing, Down / Up open
// the menu (doc byte-identical, selection unchanged), Home / End move, Esc returns focus; header buttons' Enter / Space never play.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.join(REPO, 'site');
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; }
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
}).listen(0);
const ORIGIN = `http://localhost:${server.address().port}`, BASE = ORIGIN + '/index.html';
let fail = 0; const ok = (name, pass, info = '') => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|Unexpected token|SyntaxError/.test(m.text())) errs.push(m.text()); });
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
await page.waitForSelector('#code ~ .cm-editor .cc-btn', { timeout: 60000 });
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));

// error-state code with a long line (must not run under the button)
const BAD = '$: note("c3 e3 g3 b3").s("sawtooth").lpf(800).room(.3).delay(.25).gain(.7).release(.2)\n$: s("bd*4").bank(  // unclosed';
await page.evaluate((c) => { const t = document.getElementById('code'); t.value = c; t.dispatchEvent(new Event('input')); }, BAD);
await page.click('#evalBtn').catch(() => {}); await page.waitForTimeout(800);
const geo = await page.evaluate(() => {
  const cm = document.querySelector('#code ~ .cm-editor'), b = cm.querySelector('.cc-btn').getBoundingClientRect(), e = cm.getBoundingClientRect();
  const chip = document.getElementById('liveChip').getBoundingClientRect();
  const ov = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
  const texts = [...cm.querySelectorAll('.cm-line')].flatMap((l) => { const r = document.createRange(); r.selectNodeContents(l); return [...r.getClientRects()]; }).filter((r) => r.width > 0);
  return { w: b.width, h: b.height, dx: Math.round(e.right - b.right), dy: Math.round(b.top - e.top), chip: ov(b, chip), text: texts.some((r) => ov(b, r)), right: Math.round(b.right), vw: 360 };
});
ok('rack button 44x44 pinned top-right', geo.w === 44 && geo.h === 44 && geo.dx === 0 && geo.dy === 0, JSON.stringify(geo));
ok('button covers neither code text nor live chip; inside the 360 viewport', !geo.text && !geo.chip && geo.right <= geo.vw, JSON.stringify(geo));
await page.evaluate(() => navigator.clipboard.writeText('-'));
await page.tap('#code ~ .cm-editor .cc-btn');
await page.waitForSelector('.toast.ok', { timeout: 5000 }).catch(() => {});
const doc = await page.evaluate(() => document.getElementById('code').cmView.state.doc.toString());
ok('tap copies the CodeMirror doc (error state) to the clipboard', (await clip()) === doc && doc === BAD, JSON.stringify((await clip()).slice(0, 40)));
ok('"Copied" toast + check mark', /Copied/.test(await toastText()) && (await page.getAttribute('#code ~ .cm-editor .cc-btn', 'data-done')) === '1', await toastText());
await page.evaluate(() => document.querySelector('#code ~ .cm-editor').scrollIntoView({ block: 'center' }));
await page.screenshot({ path: path.join(REPO, 'docs/screens/phone-360-copycode.png') });

// menu: long-press -> selection, link, recipe
await page.evaluate(() => { const v = document.getElementById('code').cmView; v.dispatch({ selection: { anchor: 4, head: 20 } }); });
const box = await page.locator('#code ~ .cm-editor .cc-btn').boundingBox();
const cdp = await ctx.newCDPSession(page); const pt = [{ x: box.x + 22, y: box.y + 22 }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await page.waitForTimeout(800); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const menuOpen = await page.isVisible('#ccMenu'); ok('long-press opens the menu', menuOpen);
if (!menuOpen) await page.evaluate(() => document.querySelector('#code ~ .cm-editor .cc-btn').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
await page.click('#ccMenu [data-mode="selection"]'); await page.waitForTimeout(200);
ok('Copy selection', (await clip()) === BAD.slice(4, 20), await clip());
await page.click('#code ~ .cm-editor .cc-btn', { button: 'right' }); await page.click('#ccMenu [data-mode="link"]'); await page.waitForTimeout(400);
const link = await clip(); const back = await page.evaluate((u) => window.strudelCraft.copycode.decode(new URL(u).hash), link);
ok('Copy as shareable link round-trips', /#code\/[zp][\w-]+$/.test(link) && back === BAD, link.slice(0, 80));
await page.click('#code ~ .cm-editor .cc-btn', { button: 'right' }); await page.click('#ccMenu [data-mode="recipe"]');
let rec = null; for (let i = 0; i < 40 && !rec; i++) { await page.waitForTimeout(250); try { const j = JSON.parse(await clip()); if (j.format) rec = j; } catch (e) { /* not yet */ } }
ok('Copy with controls and state = recipe v1 JSON', rec && rec.format === 'strudel-craft/recipe' && rec.version === 1 && rec.state.source.code === BAD && rec.includes.code === true, rec ? Object.keys(rec).join(',') : 'none');

// share link opens into Rack
const p2 = await ctx.newPage(); await p2.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, BASE)); await p2.waitForSelector('#list li[data-id]');
await p2.waitForFunction((c) => document.getElementById('code').value === c, BAD, { timeout: 20000 }).catch(() => {});
ok('share link loads the code into Rack', (await p2.evaluate(() => document.getElementById('code').value)) === BAD); await p2.close();

// stack + syntax
await page.evaluate(() => window.__sc.setView('stack')); await page.waitForSelector('#stackCode ~ .cm-editor .cc-btn');
await page.tap('#stackCode ~ .cm-editor .cc-btn'); await page.waitForTimeout(300);
ok('stack button copies the stack doc', (await clip()) === (await page.evaluate(() => document.getElementById('stackCode').cmView.state.doc.toString())));
await page.evaluate(() => window.__sc.setView('syntax')); await page.waitForSelector('#syntax .sx-ex .cc-btn', { state: 'attached', timeout: 20000 });
const sx = page.locator('#syntax .sx-ex:has(pre)').first(); await sx.scrollIntoViewIfNeeded(); await sx.locator('.cc-btn').tap(); await page.waitForTimeout(300);
ok('syntax example button copies the example', (await clip()) === (await sx.locator('pre').textContent()));
const pal = await page.evaluate(() => window.strudelCraft.palette.filter('copy code').map((x) => x.title));
ok('palette has "Copy code"', pal.includes('Copy code'), pal.join(' / '));

// ---- untrusted share links: oversized, bombs and malformed payloads are refused with a toast; the editor is untouched; nothing plays
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const LIM = await page.evaluate(() => window.strudelCraft.copycode.limits);
ok('documented limits: 256 KiB of code', LIM && LIM.code === 262144 && LIM.hash > 0, JSON.stringify(LIM));
const BOMB400 = '#code/z' + b64(zlib.deflateRawSync(Buffer.alloc(400 * 2 ** 20), { level: 9 }));
const BOMB100 = '#code/z' + b64(zlib.deflateRawSync(Buffer.alloc(100 * 2 ** 20), { level: 9 })); // under the length cap: exercises the streaming cap
const BIGP = '#code/p' + b64(Buffer.from('$: s("bd")\n'.repeat(Math.ceil(1.5 * 2 ** 20 * 0.75 / 11))).subarray(0, 1.5 * 2 ** 20 * 0.75)); // a 1.5 MB link (~1.1 MB of code)
const OVERP = '#code/p' + b64(Buffer.from('x'.repeat(LIM.code + 1)));
const BADS = {
  [`bomb 400 MB of zeros (#code/z, ${Math.round(BOMB400.length / 1024)} kB link)`]: BOMB400,
  [`bomb 100 MB of zeros (#code/z, ${Math.round(BOMB100.length / 1024)} kB link, streaming cap)`]: BOMB100,
  '1.5 MB #code/p': BIGP, 'plain one byte over the limit': OVERP,
  'malformed base64': '#code/z@@@!!', 'base64 length 4n+1': '#code/pAAAAA', 'malformed deflate': '#code/z' + b64(Buffer.from([0xff, 0xff, 0xff, 0xff, 1, 2, 3])),
  'truncated deflate': '#code/z' + b64(zlib.deflateRawSync(Buffer.from('$: s("bd*4")'.repeat(50))).subarray(0, 12)),
  'wrong prefix': '#code/x' + b64(Buffer.from('$: s("bd")')), 'empty payload': '#code/p', 'empty after inflate': '#code/z' + b64(zlib.deflateRawSync(Buffer.alloc(0))),
  'whitespace only': '#code/p' + b64(Buffer.from('  \n ')), 'non-UTF-8': '#code/p' + b64(Buffer.from([0x24, 0x3a, 0x20, 0xff, 0xfe, 0xc3])),
};
const KEEP = '$: note("c3 g3").s("triangle") // keep me';
const editorDoc = (pg) => pg.evaluate(() => { const t = document.getElementById('code'); return t.cmView ? t.cmView.state.doc.toString() : t.value; });
// (a) in a running page: the hash changes to a bad link
await page.evaluate(() => window.__sc.setView('rack'));
for (const [name, h] of Object.entries(BADS)) {
  await page.evaluate((c) => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const t = document.getElementById('code'); t.value = c; t.dispatchEvent(new Event('input')); }, KEEP);
  const t0 = Date.now(); await page.evaluate((x) => { location.hash = x; }, h);
  const msg = await page.waitForFunction(() => { const t = [...document.querySelectorAll('.toast.error')].map((x) => x.textContent).join(' | '); return t || false; }, null, { timeout: 4000 }).then((x) => x.jsonValue()).catch(() => '');
  const ms = Date.now() - t0, d = await editorDoc(page), pl = await page.evaluate(() => !!window.__sc.S.playing);
  ok(`bad link refused: ${name}`, !!msg && d === KEEP && !pl && ms < 4000, `${ms} ms, toast "${String(msg).replace(/×$/, '').slice(0, 90)}"`);
}
// (b) on first load in a fresh profile (the crash case): toast, no crash, the editor holds the page's own default
const fresh = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
await fresh.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
const base = await fresh.newPage(); await base.goto(BASE + '#rack'); await base.waitForSelector('#code ~ .cm-editor'); const DEF = await editorDoc(base); await base.close();
for (const [name, h] of [['bomb 400 MB of zeros', BOMB400], ['bomb 100 MB of zeros', BOMB100], ['1.5 MB #code/p', BIGP], ['malformed deflate', BADS['malformed deflate']]]) {
  const pg = await fresh.newPage(); let crashed = false; pg.on('crash', () => { crashed = true; });
  const perr = []; pg.on('pageerror', (e) => perr.push(String(e)));
  const t0 = Date.now(); await pg.goto(BASE + h).catch((e) => { crashed = 'goto: ' + e.message.split('\n')[0]; });
  const msg = crashed ? '' : await pg.waitForFunction(() => [...document.querySelectorAll('.toast.error')].map((x) => x.textContent).join(' | ') || false, null, { timeout: 8000 }).then((x) => x.jsonValue()).catch(() => '');
  const ms = Date.now() - t0;
  const st = crashed ? {} : await pg.evaluate(() => ({ playing: !!window.__sc.S.playing, hash: location.hash }));
  const d = crashed ? null : await pg.waitForSelector('#code ~ .cm-editor', { timeout: 20000 }).then(() => editorDoc(pg));
  ok(`fresh load refuses: ${name}`, !crashed && !!msg && d === DEF && !st.playing && st.hash === '#rack' && !perr.length && ms < 8000, `${crashed ? 'CRASHED ' + crashed : ms + ' ms'}, toast "${String(msg).replace(/×$/, '').slice(0, 80)}" ${perr.join(' ')}`);
  await pg.close();
}
// (c) a normal link still round-trips in a fresh profile and never plays or evaluates
const goodLink = await page.evaluate((c) => window.strudelCraft.copycode.link(c), '$: s("bd*4, hh*8") // ünïcode\tok\nglobalThis.__PWN = 1');
const gp = await fresh.newPage(); await gp.goto(goodLink.replace(/^https?:\/\/[^/]+\/[^#]*/, BASE)); await gp.waitForSelector('#code ~ .cm-editor');
await gp.waitForFunction(() => /ünïcode/.test(document.getElementById('code').value), null, { timeout: 10000 }).catch(() => {}); await gp.waitForTimeout(800);
const gs = await gp.evaluate(() => ({ code: document.getElementById('code').value, playing: !!window.__sc.S.playing, pwn: globalThis.__PWN, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | ') }));
ok('normal link round-trips in a fresh profile, no play, no eval', gs.code === '$: s("bd*4, hh*8") // ünïcode\tok\nglobalThis.__PWN = 1' && !gs.playing && gs.pwn === undefined && /Loaded shared code/.test(gs.toast), JSON.stringify({ ...gs, code: gs.code.slice(0, 30) }));
await gp.close(); await fresh.close();
// (d) encoding refuses to produce a link above the limit, with a toast
await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
const encRej = await page.evaluate(async (n) => { const t = document.getElementById('code'); const before = t.value; t.value = '// ' + 'x'.repeat(n); t.dispatchEvent(new Event('input'));
  await navigator.clipboard.writeText('-'); const r = await window.strudelCraft.copycode.copy('rack', 'link'); const clip = await navigator.clipboard.readText();
  let threw = ''; try { await window.strudelCraft.copycode.link('x'.repeat(n + 1)); } catch (e) { threw = e.message; }
  t.value = before; t.dispatchEvent(new Event('input'));
  return { r, clip, threw, toast: [...document.querySelectorAll('.toast.error')].map((x) => x.textContent).join(' | ') }; }, LIM.code);
ok('encoding refuses a link over the limit, with a toast', encRej.r === false && encRej.clip === '-' && /256 kB/.test(encRej.toast) && /256 kB/.test(encRej.threw), JSON.stringify(encRej).slice(0, 200));

// ---- keyboard only (desktop): the copy button owns its keys; nothing leaks to the global shortcuts
const kctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await kctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
await kctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
const kp = await kctx.newPage(); const kerr = []; kp.on('pageerror', (e) => kerr.push(String(e)));
await kp.goto(BASE); await kp.waitForSelector('#list li[data-id]'); await kp.waitForSelector('#code ~ .cm-editor .cc-btn', { timeout: 60000 });
const GOOD = '$: s("bd*4, hh*8").gain(.8) // keyboard test';
await kp.evaluate((c) => { const t = document.getElementById('code'); t.value = c; t.dispatchEvent(new Event('input')); document.activeElement && document.activeElement.blur(); }, GOOD);
const kstate = () => kp.evaluate(() => ({ doc: document.getElementById('code').cmView.state.doc.toString(), sel: window.__sc.S.sel, playing: !!window.__sc.S.playing, active: document.activeElement && (document.activeElement.className || document.activeElement.tagName), onBtn: !!(document.activeElement && document.activeElement.matches('#code ~ .cm-editor .cc-btn')), menu: !!(document.getElementById('ccMenu') && !document.getElementById('ccMenu').hidden), item: document.activeElement && document.activeElement.dataset.mode }));
let tabs = 0; for (; tabs < 120 && !(await kstate()).onBtn; tabs++) await kp.keyboard.press('Tab');
const s0 = await kstate(); ok('Tab reaches the Rack copy button', s0.onBtn, `${tabs} Tabs`);
await kp.evaluate(() => navigator.clipboard.writeText('-')); await kp.keyboard.press('Enter'); await kp.waitForTimeout(700);
let s1 = await kstate(); ok('Enter on the button copies and nothing plays', (await kp.evaluate(() => navigator.clipboard.readText())) === GOOD && !s1.playing && s1.doc === GOOD && s1.onBtn, JSON.stringify({ ...s1, doc: s1.doc === GOOD }));
await kp.evaluate(() => navigator.clipboard.writeText('-')); await kp.keyboard.press(' '); await kp.waitForTimeout(700);
s1 = await kstate(); ok('Space on the button copies and nothing plays', (await kp.evaluate(() => navigator.clipboard.readText())) === GOOD && !s1.playing && s1.doc === GOOD, JSON.stringify({ ...s1, doc: s1.doc === GOOD }));
await kp.keyboard.press('ArrowDown'); await kp.waitForTimeout(400);
let s2 = await kstate(); ok('ArrowDown opens the menu on its first item; editor doc byte-identical, library selection unchanged', s2.menu && s2.item === 'code' && s2.doc === GOOD && s2.sel === s0.sel && !s2.playing, JSON.stringify({ ...s2, doc: s2.doc === GOOD }));
await kp.keyboard.press('ArrowDown'); await kp.keyboard.press('End'); s2 = await kstate(); const endItem = s2.item; await kp.keyboard.press('Home'); s2 = await kstate();
ok('menu: Down / End / Home move within the menu', endItem === 'recipe' && s2.item === 'code' && s2.doc === GOOD && s2.sel === s0.sel, `${endItem} -> ${s2.item}`);
await kp.keyboard.press('Escape'); await kp.waitForTimeout(200);
const s3 = await kstate(); ok('Esc closes the menu and returns focus to the button', !s3.menu && s3.onBtn && s3.doc === GOOD, JSON.stringify({ ...s3, doc: s3.doc === GOOD }));
await kp.keyboard.press('ArrowUp'); s2 = await kstate(); ok('ArrowUp opens the menu on its last item', s2.menu && s2.item === 'recipe' && s2.doc === GOOD && s2.sel === s0.sel, s2.item);
await kp.keyboard.press('Enter'); await kp.waitForTimeout(1500); s2 = await kstate();
ok('Enter on a menu item runs it, nothing plays, doc unchanged', !s2.menu && !s2.playing && s2.doc === GOOD && /strudel-craft\/recipe/.test(await kp.evaluate(() => navigator.clipboard.readText())), JSON.stringify({ ...s2, doc: s2.doc === GOOD }));
await kp.keyboard.press('Home'); await kp.keyboard.press('End'); await kp.keyboard.press('ArrowLeft'); await kp.keyboard.press('ArrowRight'); s2 = await kstate();
ok('Home / End / Left / Right on the button reach no global shortcut', s2.doc === GOOD && s2.sel === s0.sel && !s2.playing, JSON.stringify({ ...s2, doc: s2.doc === GOOD }));
await kp.evaluate(() => { if (window.__sc.S.playing) window.__sc.stop(); });
// the other header buttons reachable by Tab: Enter / Space activate them only (no play, no reload of the editor code)
for (const id of ['themeBtn', 'helpBtn', 'histBtn']) {
  for (const key of ['Enter', ' ']) {
    const has = await kp.evaluate((i) => { const b = document.getElementById(i); if (!b) return false; b.focus(); return document.activeElement === b; }, id); if (!has) { ok(`header #${id} ${key === ' ' ? 'Space' : key}`, true, 'not on this page'); continue; }
    const th0 = await kp.evaluate(() => document.documentElement.dataset.theme || document.documentElement.className);
    await kp.keyboard.press(key); await kp.waitForTimeout(400);
    const r = await kp.evaluate(() => ({ playing: !!window.__sc.S.playing, doc: document.getElementById('code').cmView.state.doc.toString(), help: document.getElementById('help').open, dlg: !!document.querySelector('dialog[open]'), theme: document.documentElement.dataset.theme || document.documentElement.className }));
    const activated = id === 'themeBtn' ? r.theme !== th0 : r.dlg || r.help;
    ok(`header #${id} ${key === ' ' ? 'Space' : key}: activates it, nothing plays, doc unchanged`, activated && !r.playing && r.doc === GOOD, JSON.stringify({ ...r, doc: r.doc === GOOD }));
    await kp.keyboard.press('Escape'); await kp.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }); await kp.waitForTimeout(150);
  }
}
ok('keyboard run: no page errors', kerr.length === 0, kerr.join(' | '));
await kctx.close();
ok('no console errors', errs.length === 0, errs.join(' | '));
await browser.close(); server.close(); process.exit(fail ? 1 : 0);
