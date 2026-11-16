// Lazy-load failures (#59): a deferred module that cannot be fetched is a toast naming the file with a Retry action (never a native dialog),
// the UI stays usable, Retry imports it once the network is back; a lazy view that fails hands back to the previous view (no half-open view).
// Also: the hooks intellisense providers (b3133ef) are registered by the time the first completion popup opens.
// Usage: node tests/site/lazy_fail.mjs   (Playwright Chromium; exit 1 on any FAIL)
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const blocked = new Set(); const hits = {};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const rel = p.slice(1); if (blocked.has(rel)) { hits[rel] = (hits[rel] || 0) + 1; res.writeHead(503); return res.end(); }
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = []; const check = (name, ok, detail = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };
const browser = await chromium.launch();
const open = async (tag) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const page = await ctx.newPage(); const errs = [], dialogs = [];
  page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/issues/') ? JSON.stringify({ title: 'Live tracker', html_url: 'https://github.com/Glyphcore/Strudel-craft/issues/56', body: '## Site\n- [x] done' }) : '[]' }));
  page.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`)); page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
  return { ctx, page, errs, dialogs };
};
const errorToast = (page, text) => page.locator('.toast.error', { hasText: text }).last();

/* 1. a deferred module of the boot set */
{
  blocked.add('tracker.js');
  const { ctx, page, errs, dialogs } = await open('boot');
  await page.goto(BASE);
  const t = errorToast(page, 'tracker.js');
  await t.waitFor({ timeout: 15000 }).catch(() => {});
  check('a blocked deferred module is named in an error toast', await t.isVisible(), (await t.textContent().catch(() => '')) || 'no toast');
  check('the toast has a Retry action', (await t.locator('.toast-do').textContent().catch(() => '')) === 'Retry');
  const st = await page.evaluate(() => ({ failed: window.strudelCraft.lazyFailed, is: !!window.strudelCraft.intellisense, tracker: !!window.strudelCraft.tracker, booted: !!window.strudelCraft.booted }));
  check('only that module failed; the rest of the deferred set loaded', JSON.stringify(st.failed) === '["tracker.js"]' && st.is && !st.tracker, JSON.stringify(st));
  await page.click('.views a[data-view="stack"]');
  check('the UI stays usable (views switch, Play enabled)', await page.evaluate(() => document.getElementById('main').dataset.view === 'stack' && !document.getElementById('playBtn').disabled));
  blocked.delete('tracker.js');
  await t.locator('.toast-do').click();
  await page.waitForFunction(() => window.strudelCraft.tracker && window.strudelCraft.lazyFailed && !window.strudelCraft.lazyFailed.length, null, { timeout: 10000 }).catch(() => {});
  const after = await page.evaluate(() => ({ failed: window.strudelCraft.lazyFailed, tracker: !!window.strudelCraft.tracker }));
  check('Retry imports the module once it is reachable again', after.tracker && after.failed.length === 0, JSON.stringify(after));
  check('no native dialog, no uncaught page error', !dialogs.length && !errs.length, [...dialogs, ...errs].join(' | '));
  await ctx.close();
}
/* 2. a lazy view (the existing view loader) */
{
  const { ctx, page, errs, dialogs } = await open('view');
  await page.goto(BASE + '#stack'); await page.waitForFunction(() => window.strudelCraft.booted).then(() => page.evaluate(() => window.strudelCraft.booted));
  blocked.add('syntax.js');
  await page.click('.views a[data-view="syntax"]');
  const t = errorToast(page, 'syntax.js'); await t.waitFor({ timeout: 10000 }).catch(() => {});
  check('a lazy view that cannot load is named in an error toast with Retry', await t.isVisible() && (await t.locator('.toast-do').textContent().catch(() => '')) === 'Retry', (await t.textContent().catch(() => '')) || 'no toast');
  const v = await page.evaluate(() => ({ view: document.getElementById('main').dataset.view, current: document.querySelector('.views a[aria-current="page"]')?.dataset.view }));
  check('no half-open view: it hands back to the view it came from', v.view === 'stack' && v.current === 'stack', JSON.stringify(v));
  blocked.delete('syntax.js');
  await t.locator('.toast-do').click();
  await page.waitForFunction(() => document.getElementById('main').dataset.view === 'syntax' && !document.querySelector('#syntax > .pf-hint') && document.querySelectorAll('#syntax *').length > 5, null, { timeout: 10000 }).catch(() => {});
  const ok = await page.evaluate(() => ({ view: document.getElementById('main').dataset.view, nodes: document.querySelectorAll('#syntax *').length }));
  check('Retry opens the view once the module is reachable', ok.view === 'syntax' && ok.nodes > 5, JSON.stringify(ok));
  check('no native dialog, no uncaught page error (view)', !dialogs.length && !errs.length, [...dialogs, ...errs].join(' | '));
  await ctx.close();
}
/* 3. hooks intellisense providers are in the registry when the first completion popup opens */
{
  const { ctx, page, errs } = await open('complete');
  await page.addInitScript(() => { new MutationObserver((ms, o) => { if (document.querySelector('.cm-tooltip-autocomplete')) { const api = window.strudelCraft && window.strudelCraft.intellisense; window.__firstPopup = { providers: api ? api.providers() : null, items: [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((l) => l.textContent) }; o.disconnect(); } }).observe(document, { childList: true, subtree: true }); });
  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById('code') && document.getElementById('code').cmView, null, { timeout: 20000 });
  await page.locator('#code + .cm-editor .cm-content, .cm-editor .cm-content').first().click();
  await page.keyboard.press('Control+End'); await page.keyboard.type('\n$: s("bd").wir'); /* wire() comes only from the hooks provider (hooks-intellisense.js staticItems) */
  await page.evaluate(() => window.strudelCraft.intellisense.startCompletion(document.getElementById('code').cmView));
  await page.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 6000 }).catch(() => {});
  const fp = await page.evaluate(() => window.__firstPopup || null);
  const items = await page.$$eval('.cm-tooltip-autocomplete li', (ls) => ls.map((l) => l.textContent));
  check('first completion popup: hooks and model providers already registered', fp && fp.providers && fp.providers.includes('hooks') && fp.providers.includes('model'), JSON.stringify(fp && fp.providers));
  check('the first popup offers the hooks completion wire()', (fp && fp.items.some((x) => x.startsWith('wire'))) || items.some((x) => x.startsWith('wire')), items.slice(0, 6).join(' | '));
  check('no uncaught page error (completion)', !errs.length, errs.join(' | '));
  await ctx.close();
}
await browser.close(); server.close();
console.log(`${checks.filter(Boolean).length}/${checks.length} passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
