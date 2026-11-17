/* Sound loading notice and source warnings (#183, critic defect 3 and the e3df609 hand-off). Chromium at 390x844 touch, real network for Strudel and samples.
   A. site/sound-load.js: a cold play of vsco-woodwinds shows a "Loading sounds" toast (naming the source and counting files) BEFORE the first audible
      block at the destination, turns it into "Sounds ready" and removes it; no layout shift during the load (layout-shift API); a warm play (same page,
      then a reload on the warm HTTP cache) shows no notice; offline with nothing cached gives one error toast that says offline; an HTTP failure names
      the source. Never a native dialog.
   B. site/packs-ui.js: a user pack whose sample-source base is unpinned shows W_PACK_SOURCE_PIN in plain words in its pack card, one on another host shows
      W_PACK_SOURCE_HOST; neither shows the other's warning, and no shipped pack card shows either. Fixture packs are built in a temp dir from
      site/data/drumkits (tools/packs/packs.py hash --write). Usage (repo root): node tests/site/sound_loading.mjs */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import crypto from 'crypto'; import { spawnSync } from 'child_process'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SITE = path.join(ROOT, 'site'), PREFIX = '/Strudel-craft/';
const FX = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.md': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  p = p.slice(PREFIX.length) || 'index.html'; const rootDir = p.startsWith('fx/') ? FX : SITE, f = path.join(rootDir, p.startsWith('fx/') ? p.slice(3) : p);
  if (!f.startsWith(rootDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(fs.readFileSync(f));
});
await new Promise((ok) => server.listen(0, ok)); const BASE = `http://localhost:${server.address().port}${PREFIX}`;
let fail = 0; const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); if (!ok) fail++; };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errors = [], natives = [];
const INIT = () => { // first audible block at the destination and when each sound-load toast state first appears; layout shifts
  window.__t = { audible: 0, states: {}, cls: 0 }; const oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (t, ...a) { const r = oc.call(this, t, ...a);
    if (t && t instanceof AudioDestinationNode && !this.__t && !(this.context instanceof OfflineAudioContext)) { this.__t = 1; const sp = this.context.createScriptProcessor(1024, 2, 1);
      sp.onaudioprocess = (e) => { if (window.__t.armed && !window.__t.audible) for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) { const d = e.inputBuffer.getChannelData(c); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.003) { window.__t.audible = performance.now(); return; } } };
      oc.call(this, sp); oc.call(sp, this.context.destination); }
    return r; };
  const watch = () => new MutationObserver(() => { for (const el of document.querySelectorAll('[data-sound-load]')) { const s = el.dataset.soundLoad; if (!window.__t.states[s]) window.__t.states[s] = { t: performance.now(), text: el.textContent }; } }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sound-load'] }); if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (window.__t.armed && !e.hadRecentInput) { window.__t.cls += e.value; (window.__t.src ||= []).push(...(e.sources || []).map((x) => (x.node && (x.node.id || x.node.className || x.node.nodeName)) + ' ' + JSON.stringify([x.previousRect.y, x.currentRect.y, x.previousRect.height, x.currentRect.height]))); } }).observe({ type: 'layout-shift', buffered: false }); } catch (e) { /* no API */ }
};
async function boot(ctx) { const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => { natives.push(d.type()); d.dismiss(); });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.soundLoad && window.strudelCraft.packs && window.__sc, null, { timeout: 60000 });
  await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.ensure('recipes'); await window.__sc.Engine.load(); await window.getAudioContext().resume(); }); return page; }
const play = (page, id, ms) => page.evaluate(async ([id, ms]) => { const T = window.__t; T.audible = 0; T.states = {}; T.cls = 0; T.src = []; const r = window.strudelCraft.packs.resolve('recipes', id); const t0 = performance.now(); T.armed = true;
  await window.__sc.Engine.play(r.value.code, false, () => {}); await new Promise((ok) => setTimeout(ok, ms)); window.__sc.Engine.stop(); T.armed = false; await new Promise((ok) => setTimeout(ok, 3000));
  const rel = (x) => (x ? Math.round(x - t0) : null); return { audible: rel(T.audible), loading: T.states.loading && { t: rel(T.states.loading.t), text: T.states.loading.text }, ready: T.states.ready && { t: rel(T.states.ready.t), text: T.states.ready.text }, failed: T.states.failed && T.states.failed.text, left: document.querySelectorAll('[data-sound-load]').length, cls: +T.cls.toFixed(4), src: (T.src || []).slice(0, 6), st: window.strudelCraft.soundLoad.state() }; }, [id, ms]);

// A1 cold, then warm in the same page, then warm after a reload (HTTP cache)
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await ctx.addInitScript(INIT); const page = await boot(ctx);
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.5 * 1024 * 1024, uploadThroughput: 512 * 1024 }); // a phone link (about 12 Mbit/s); cache hits are not throttled
  const cold = await play(page, 'vsco-woodwinds', 16000);
  check('cold: a "Loading sounds" toast names the source and counts files, and appears before the first audible block', cold.loading && /Loading sounds: .*VSCO.*\d+ of \d+ files/.test(cold.loading.text) && cold.audible && cold.loading.t < cold.audible, JSON.stringify({ loading: cold.loading, audible: cold.audible }));
  check('cold: it turns into "Sounds ready" and is removed (nothing left on screen)', cold.ready && /Sounds ready: \d+ files, [\d.]+ MB\. Notes skipped/.test(cold.ready.text) && cold.left === 0 && !cold.failed, JSON.stringify({ ready: cold.ready, left: cold.left, last: cold.st.last }));
  check('cold: no layout shift while loading at 390 px (toasts are in the top layer)', cold.cls === 0, 'CLS ' + cold.cls + ' ' + JSON.stringify(cold.src));
  const warm = await play(page, 'vsco-woodwinds', 5000);
  check('warm (same page): no notice, and it sounds', !warm.loading && !warm.failed && warm.audible, JSON.stringify(warm));
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.soundLoad && window.__sc, null, { timeout: 60000 });
  await page.evaluate(async () => { await window.strudelCraft.packs.ready; await window.strudelCraft.packs.ensure('recipes'); await window.__sc.Engine.load(); await window.getAudioContext().resume(); });
  const warm2 = await play(page, 'vsco-woodwinds', 6000);
  check('warm (reload, files in the browser cache): no notice, and it sounds', !warm2.loading && !warm2.failed && warm2.audible, JSON.stringify({ audible: warm2.audible, last: warm2.st.last }));
  await ctx.close(); }
// A2 offline with nothing cached; A3 an HTTP failure
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await ctx.addInitScript(INIT); const page = await boot(ctx);
  await ctx.setOffline(true); const off = await play(page, 'gogodze-groove', 4000); await ctx.setOffline(false);
  check('offline, nothing cached: one error toast that says offline and names the source; no loading notice left', off.failed && /^Offline: \d+ sound files? of .+ not on this device/.test(off.failed) && off.left <= 1, JSON.stringify({ failed: off.failed, left: off.left }));
  await ctx.close(); }
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await ctx.addInitScript(INIT); const page = await boot(ctx);
  await page.route(/raw\.githubusercontent\.com\/.*\.(wav|flac)/i, (r) => r.fulfill({ status: 404, body: 'nope' }));
  const nf = await play(page, 'gogodze-groove', 4000);
  check('HTTP failure: an error toast says the files could not load, with the status and the source', nf.failed && /^Could not load \d+ sound files? of .+ \(HTTP 404\)/.test(nf.failed), nf.failed);
  await ctx.close(); }

// B: source warnings in the pack sheet, user packs only
const SHA = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const GOOD = JSON.parse(fs.readFileSync(path.join(SITE, 'data/drumkits/sources/sources.json'), 'utf8')).sources[0].base, PIN = GOOD.match(/[0-9a-f]{40}/)[0];
const make = (name, base) => { const d = path.join(FX, name); fs.cpSync(path.join(SITE, 'data/drumkits'), d, { recursive: true });
  const f = path.join(d, 'sources/sources.json'), j = JSON.parse(fs.readFileSync(f, 'utf8')); for (const s of j.sources) { s.base = base; s.id = s.id + '-' + name; } fs.writeFileSync(f, JSON.stringify(j, null, 1));
  const m = path.join(d, 'craftpack.json'), mj = JSON.parse(fs.readFileSync(m, 'utf8')); mj.id = 'testco/' + name; fs.writeFileSync(m, JSON.stringify(mj, null, 1));
  const r = spawnSync('python3', ['-I', path.join(ROOT, 'tools/packs/packs.py'), 'hash', d, '--write'], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr);
  const b = fs.readFileSync(m); return { id: 'testco/' + name, version: mj.version, source: `https://fixtures.test/fx/${name}/`, mirrors: [`./fx/${name}/`], manifest: SHA(b), priority: 0, allowCode: [] }; };
const lock = JSON.stringify({ lock: 1, craftpack: '1.0.0', packs: [make('unpinned', 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.big-rusty-drums/main/'), make('offhost', 'https://samples.example.com/owner/kit/' + PIN + '/')] });
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await ctx.addInitScript((l) => { localStorage.setItem('sc.packs.lock', l); }, lock);
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => { natives.push(d.type()); d.dismiss(); });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.strudelCraft && window.strudelCraft.packsSheet && window.strudelCraft.packs, null, { timeout: 60000 });
  await page.evaluate(() => window.strudelCraft.packsSheet.open()); await page.waitForSelector('#packSheet[open]');
  await page.waitForSelector('[data-pack="testco/unpinned"] li[data-code="W_PACK_SOURCE_PIN"]', { timeout: 15000 }).catch(() => {}); await page.waitForSelector('[data-pack="testco/offhost"] li[data-code="W_PACK_SOURCE_HOST"]', { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(() => { const card = (id) => document.querySelector(`[data-pack="${id}"]`), codes = (id) => [...(card(id) ? card(id).querySelectorAll('li[data-code]') : [])].map((li) => li.dataset.code);
    const plain = (id, c) => { const li = card(id) && card(id).querySelector(`li[data-code="${c}"] .pk-plain`); return li ? li.textContent : null; };
    const shipped = [...document.querySelectorAll('[data-pack^="glyphcore/"]')].filter((c) => c.querySelector('li[data-code^="W_PACK_SOURCE_"]')).map((c) => c.dataset.pack);
    return { un: codes('testco/unpinned'), off: codes('testco/offhost'), pinText: plain('testco/unpinned', 'W_PACK_SOURCE_PIN'), hostText: plain('testco/offhost', 'W_PACK_SOURCE_HOST'), shipped, shippedCards: document.querySelectorAll('[data-pack^="glyphcore/"]').length }; });
  check('user pack on a branch base: W_PACK_SOURCE_PIN in plain words ("can change under you"), and not the host warning', r.un.includes('W_PACK_SOURCE_PIN') && !r.un.includes('W_PACK_SOURCE_HOST') && /can change under you/.test(r.pinText || ''), JSON.stringify({ un: r.un, pinText: r.pinText }));
  check('user pack on another host: W_PACK_SOURCE_HOST in plain words ("Not available offline", names the host), and not the pin warning', r.off.includes('W_PACK_SOURCE_HOST') && !r.off.includes('W_PACK_SOURCE_PIN') && /Not available offline: .*samples\.example\.com/.test(r.hostText || ''), JSON.stringify({ off: r.off, hostText: r.hostText }));
  check('shipped packs show neither warning', r.shippedCards > 3 && r.shipped.length === 0, `${r.shippedCards} shipped cards; with warnings: ${r.shipped.join(', ') || 'none'}`);
  await ctx.close(); }
check('no uncaught page errors and no native dialogs', errors.length === 0 && natives.length === 0, errors.slice(0, 2).join(' | '));
fs.rmSync(FX, { recursive: true, force: true }); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
