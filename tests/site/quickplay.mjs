// Quick play (docs/QUICKPLAY.md): audition in place from Syntax examples/headers and Recipes rows. 390px touch. Standalone: node tests/site/quickplay.mjs
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const checks = [], errors = [], nums = {};
const check = (n, ok, d = '') => { checks.push({ n, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await ctx.newPage();
await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// master peak over a window (time domain)
const peak = (ms) => page.evaluate(async (ms) => { const B = window.__sc.Bus; let pk = 0, first = null; const buf = new Float32Array(2048); const t0 = performance.now();
  await new Promise((r) => { const iv = setInterval(() => { if (B.an) { B.an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); if (m > pk) pk = m; if (m > 0.002 && first == null) first = performance.now() - t0; } if (performance.now() - t0 > ms) { clearInterval(iv); r(); } }, 10); }); return { pk, first }; }, ms);
const snap = () => page.evaluate(() => ({ code: document.getElementById('code').value, st: document.getElementById('code').scrollTop, sy: window.scrollY, ae: document.activeElement && document.activeElement.id, playing: window.__sc.S.playing, view: window.__sc.S.view, hash: location.hash, sel: window.__sc.S.sel }));
const tap = (loc) => loc.tap();
try {
  await page.goto(BASE); await page.waitForSelector('#list li[data-id]');
  // ---- Recipes row ----
  const before = await snap();
  const row = page.locator('#list li .qp').nth(2); await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox(); check('recipe play target is >= 44px', box.width >= 44 && box.height >= 44, `${box.width}x${box.height}`);
  const t0 = Date.now(); await tap(row);
  await page.waitForFunction(() => document.querySelector('#list .qp[data-state="playing"]'), null, { timeout: 90000 }); nums.coldMs = Date.now() - t0;
  const pr = await peak(1500); check('recipe audition: master peak > 0 while playing', pr.pk > 0.005, 'peak ' + pr.pk.toFixed(3));
  const mid = await snap();
  check('no navigation, editor text/scroll/focus and main program untouched', mid.code === before.code && mid.st === before.st && mid.view === 'rack' && mid.playing === false && mid.sel === before.sel && mid.ae === before.ae, JSON.stringify({ a: mid.ae, b: before.ae, v: mid.view, p: mid.playing }));
  check('tray shows with Solo, Loop and Stop (44px)', await page.evaluate(() => { const t = document.getElementById('qptray'); return !t.hidden && [...t.querySelectorAll('button')].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().height >= 44); }));
  // switch to another row
  const row2 = page.locator('#list li .qp').nth(3); await row2.scrollIntoViewIfNeeded(); await tap(row2);
  await page.waitForFunction(() => { const b = document.querySelectorAll('#list .qp'); return b[3].dataset.state === 'playing' && b[2].dataset.state === 'idle'; }, null, { timeout: 60000 });
  check('tapping another row switches the audition (one at a time)', true);
  await tap(row2); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 5000 });
  await page.waitForTimeout(250); const sil = await peak(400); check('master peak is 0 after stop', sil.pk < 0.003, 'peak ' + sil.pk.toFixed(4));
  // warm press-to-first-sound
  const t1 = Date.now(); await tap(row2); const w = await peak(1200); nums.warm = await page.evaluate(() => window.strudelCraft.quickplay.stats.pressToSoundMs); nums.warmPeakFirstMs = w.first;
  check('warm press-to-first-sound measured (target <= 150 ms; scheduled-sound estimate and analyser)', nums.warm != null, JSON.stringify({ est: nums.warm, an: w.first }));
  await tap(row2); await page.waitForTimeout(200);
  // stop-all on main Stop: start audition then press transport play twice (play then stop)
  await tap(row2); await page.waitForFunction(() => document.querySelector('.qp[data-state="playing"]'), null, { timeout: 30000 });
  await page.evaluate(() => window.__sc.stop()); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 3000 });
  check('transport Stop stops the audition', true);
  // length: End (default) resolves the entry's end; a plain loop never stops; N bars is opt-in; choice persisted
  const A = await snap();
  const run = (code) => page.evaluate((code) => window.strudelCraft.quickplay.play({ key: 't:' + Math.random(), title: 'T', code }), code);
  await run('// @daw bars=2\nsetcpm(240/4)\n$: s("bd*2")'); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 60000 });
  console.log('DBG', await page.evaluate(() => JSON.stringify({ f: window.strudelCraft.quickplay.run.found, e: window.strudelCraft.quickplay.run.endC })));
  const t2 = Date.now(); check('default mode is End and the tray shows bar position', await page.evaluate(() => window.strudelCraft.quickplay.state.mode) === 'end' && /bar \d+ \/ 2/.test(await page.locator('.qp-pos').innerText()), await page.locator('.qp-pos').innerText());
  await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle', null, { timeout: 15000 }); nums.endMs = Date.now() - t2;
  check('an end-resolved entry (@daw bars=2) stops at its end (within a bar)', nums.endMs < 4500, nums.endMs + ' ms');
  await run('setcpm(240/4)\n$: s("bd hh")'); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(9500); const still = await page.evaluate(() => ({ ph: window.strudelCraft.quickplay.state.phase, c: window.strudelCraft.quickplay.run && window.strudelCraft.quickplay.run.cyc }));
  check('a looping entry keeps playing past 8 cycles until stopped', still.ph === 'playing' && still.c > 8, JSON.stringify(still));
  await page.evaluate(() => { window.strudelCraft.quickplay.state.bars = 999; }); /* the run is already past cycle 8: an 8-bar run would end (and hide the tray) before the stop tap below; a long N keeps the chip test about the chip */
  await page.locator('#qptray .qp-mode').tap(); await page.locator('#qptray .qp-mode').tap();
  check('mode chip cycles End > Loop > N bars and is remembered', (await page.evaluate(() => localStorage.getItem('sc.qp.mode'))) === '"bars"' && /bars/i.test(await page.locator('#qptray .qp-mode').innerText()), (await page.evaluate(() => localStorage.getItem('sc.qp.mode'))) + ' ' + await page.locator('#qptray .qp-mode').innerText());
  await page.locator('#qptray .qp-mode').tap(); await page.locator('#qptray .qp-stop').tap(); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle', null, { timeout: 5000 });
  const B = await snap(); check('no editor, scroll or view change from the length runs', B.code === A.code && B.st === A.st && B.view === 'rack');
  // ---- Syntax ----
  await page.evaluate(() => window.__sc.setView('syntax')); await page.waitForSelector('#syntax .sx-groups', { state: 'attached' });
  await page.evaluate(() => window.strudelCraft.syntax.go('copy')); await page.waitForSelector('#sx-copy .sx-ex');
  const s0 = await snap();
  const hdr = page.locator('#sx-copy .sx-head ~ .qp, #sx-copy h3 .qp'); check('section header has a play button', await hdr.count() === 1);
  const ex = page.locator('#sx-copy .sx-ex .qp').first(); await ex.scrollIntoViewIfNeeded(); await tap(ex);
  await page.waitForFunction(() => document.querySelector('#sx-copy .sx-ex .qp[data-state="playing"]'), null, { timeout: 60000 });
  const sp = await peak(1200); check('Syntax example plays in place (peak > 0), still on the Syntax view', sp.pk > 0.005 && await page.evaluate(() => window.__sc.S.view) === 'syntax', 'peak ' + sp.pk.toFixed(3));
  const s1 = await snap(); check('Syntax play leaves editor text, scroll and main program alone and keeps the deep link', s1.code === s0.code && s1.st === s0.st && s1.playing === false && s1.hash === s0.hash, s1.hash);
  await tap(ex); await page.waitForFunction(() => !document.querySelector('.qp[data-state="playing"]'), null, { timeout: 5000 });
  // Strudel tab open: plays the lowered form; no plain form -> reason
  // pack-dependent example (atoms.import)
  await page.evaluate(() => window.strudelCraft.syntax.go('forms')); await page.waitForSelector('#sx-forms .sx-ex');
  const pk = page.locator('#sx-forms .sx-ex .qp').first(); await pk.scrollIntoViewIfNeeded(); await tap(pk);
  await page.waitForFunction(() => document.querySelector('#sx-forms .sx-ex .qp[data-state="playing"]') || document.querySelector('.toast.error'), null, { timeout: 90000 });
  const pp = await peak(1500); check('pack-dependent example (atoms.import) plays', pp.pk > 0.005, 'peak ' + pp.pk.toFixed(3));
  await page.evaluate(() => window.strudelCraft.quickplay.stop('fast')); await page.waitForTimeout(300);
  // disabled with reason
  await page.evaluate(() => window.strudelCraft.syntax.go('pads')); await page.waitForSelector('#sx-pads .sx-ex');
  const dis = page.locator('#sx-pads .sx-ex .qp[aria-disabled="true"]'); check('a page-API example has a disabled play with a reason', await dis.count() > 0 && !!(await dis.first().getAttribute('data-why')));
  await dis.first().scrollIntoViewIfNeeded(); const db = await dis.first().boundingBox(); await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2); await page.waitForSelector('.toast'); check('tapping a disabled play shows the reason and stays in place', (await page.evaluate(() => window.__sc.S.view)) === 'syntax');
  // taps:1 (hooks.let publishes the tap) plays
  await page.evaluate(() => window.strudelCraft.syntax.go('taps')); await page.waitForSelector('#sx-taps .sx-ex');
  const tp = page.locator('#sx-taps .sx-ex .qp').nth(1); await tp.scrollIntoViewIfNeeded(); check('taps:1 (hooks.let + tap reader) is playable', await tp.getAttribute('aria-disabled') !== 'true'); await tap(tp);
  await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing' || document.querySelector('.toast.error'), null, { timeout: 60000 });
  const tpk = await peak(1500); check('taps:1 entry makes sound', tpk.pk > 0.005, 'peak ' + tpk.pk.toFixed(3)); await page.evaluate(() => window.strudelCraft.quickplay.stop('fast')); await page.waitForTimeout(300);
  // end through hooks gates and hooks.marker('end'): record-length resolver after the audition's evaluate
  const H = 'setcpm(240/4)\nhooks.def("lift", { chain: [["lpf", 400]] })\n';
  for (const [name, code, end] of [['marker end 3b', H + 'hooks.marker("end", "3b")\nnote("c3 e3").s("sawtooth").use("fx")', 2], ['gate 2b..4b beats marker 6b', H + 'hooks.bind("fx", "lift", "2b..4b")\nhooks.marker("end", "6b")\nnote("c3 e3").s("sawtooth").use("fx")', 3]]) {
    await page.evaluate((c) => window.strudelCraft.quickplay.play({ key: 'g:' + Math.random(), title: 'G', code: c }), code); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing' || window.strudelCraft.quickplay.state.error, null, { timeout: 60000 });
    const g = await page.evaluate(() => { const r = window.strudelCraft.quickplay.run; return r && { endC: r.endC, rule: r.found && r.found.rule }; }); check(`End resolves ${name}`, g && Math.abs(g.endC - end) < 0.01, JSON.stringify(g));
    await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle', null, { timeout: 15000 });
  }
  // 20-minute safety (time shim: maxS = 1.5 s)
  await page.evaluate(() => { window.strudelCraft.quickplay.maxS = 1.5; window.strudelCraft.quickplay.play({ key: 'm:1', title: 'M', code: 'setcpm(240/4)\n$: s("bd hh")' }); });
  await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle' && window.strudelCraft.quickplay.stats.plays > 0, null, { timeout: 30000 }); await page.waitForSelector('.toast');
  check('the safety stop ends an endless audition with a message', /minutes/.test(await page.locator('.toast').first().innerText())); await page.evaluate(() => { delete window.strudelCraft.quickplay.maxS; });
  // Solo + main program playing + failing entries: orbit 1 and the master come back
  await page.evaluate(() => window.__sc.setView('rack')); await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing, null, { timeout: 60000 });
  const o1 = () => page.evaluate(() => { const o = window.getSuperdoughAudioController().nodes[1]; return o && o.output.gain.value; });
  await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 's:1', title: 'S', code: 'setcpm(240/4)\n$: s("hh*4")' })); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 });
  await page.locator('#qptray .qp-solo').tap(); await page.waitForTimeout(300); nums.solo = await o1();
  await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 's:2', title: 'Bad', code: '$: s("bd").notAFunction(3)' })); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle', null, { timeout: 30000 }); await page.waitForTimeout(300);
  const a1 = await o1(); const pa = await peak(800); check('after a failing entry with Solo on: orbit 1 back to 1 and the program is audible', nums.solo < 0.1 && a1 > 0.9 && pa.pk > 0.003, JSON.stringify({ solo: nums.solo, after: a1, peak: pa.pk }));
  await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 's:3', title: 'S', code: 'setcpm(240/4)\n$: s("hh*4")' })); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 });
  await page.locator('#qptray .qp-solo').tap(); await page.waitForTimeout(200);
  await page.evaluate(() => { const E = window.__sc.Engine; E.__p = E.prepare; E.prepare = async () => { throw new Error('prepare failed'); }; window.strudelCraft.quickplay.play({ key: 's:4', title: 'P', code: '$: s("bd")' }); });
  await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle', null, { timeout: 30000 }); await page.evaluate(() => { const E = window.__sc.Engine; E.prepare = E.__p; }); await page.waitForTimeout(300);
  const a2 = await o1(); const pb = await peak(800); check('after a failed prepare with Solo on: orbit 1 back to 1 and the program is audible', a2 > 0.9 && pb.pk > 0.003, JSON.stringify({ after: a2, peak: pb.pk }));
  await page.evaluate(() => window.__sc.stop());
  // isolation: the program's hooks registry, Record end and globals are unchanged by auditions; a second audition does not inherit the first's gates
  const MAIN = 'setcpm(240/4)\nhooks.def("mp", { chain: [["lpf", 300]] })\nhooks.bind("fx", "mp", "1b..3b")\nhooks.marker("end", "8b")\nnote("c3 e3").s("sawtooth").use("fx")';
  await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, MAIN);
  await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing, null, { timeout: 60000 });
  const reg = () => page.evaluate(async () => { const RL = await import('./record-length.js'); const h = window.strudelCraft.hooks; const plan = h.plan({ horizon: 1024 }); return JSON.stringify({ j: (({ atoms, ...o }) => o)(JSON.parse(h.toJSON())), p: plan, end: RL.resolveEnd({ plan, horizon: 1024, markers: plan.markers || null, code: '' }).cycle, g: [typeof window.setcpm, String(window.setcpm).length, String(window.hush).length] }); });
  await page.waitForTimeout(2500); const regBefore = await reg(); const fn0 = await page.evaluate(() => { window.__g0 = [window.setcpm, window.hush, window.all]; });
  const AUD1 = 'setcpm(240/4)\nhooks.def("ad", { chain: [["hpf", 900]] })\nhooks.bind("fx", "ad")\nhooks.marker("end", "2b")\nnote("e4 g4").s("triangle").use("fx")';
  await page.evaluate((c) => window.strudelCraft.quickplay.play({ key: 'i:1', title: 'I1', code: c }), AUD1); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 });
  const e1 = await page.evaluate(() => window.strudelCraft.quickplay.run.endC); check('the audition resolves its own End (marker 2b = 1 cycle), not the program marker (8)', Math.abs(e1 - 1) < 0.01, 'endC ' + e1);
  check('program globals (setcpm, hush, all) are the program\'s while auditioning', await page.evaluate(() => window.__g0[0] === window.setcpm && window.__g0[1] === window.hush && window.__g0[2] === window.all));
  await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'idle', null, { timeout: 20000 }); await page.waitForTimeout(200);
  { const ra = await reg(); check('after the audition the hooks plan / registry and Record end are exactly the program\'s', ra === regBefore, ra === regBefore ? '' : (() => { const a = JSON.parse(ra), b = JSON.parse(regBefore); return ['j', 'p', 'end', 'g'].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => k + ': ' + JSON.stringify(a[k]).slice(0, 300) + ' vs ' + JSON.stringify(b[k]).slice(0, 300)).join(' ;; '); })()); }
  await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 'i:2', title: 'I2', code: 'setcpm(240/4)\n$: s("bd hh")' })); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 });
  const e2 = await page.evaluate(() => { const r = window.strudelCraft.quickplay.run; return { endC: r.endC, rule: r.found.rule }; }); check('a second audition does not inherit the first one\'s marker or gates (endless)', e2.endC == null, JSON.stringify(e2));
  await page.evaluate(() => window.strudelCraft.quickplay.stop('fast')); await page.waitForTimeout(300);
  check('registry still the program\'s after the second audition; the program still sounds', (await reg()) === regBefore && (await peak(800)).pk > 0.003);
  // slot collision: program fx = lpf 300 on the bass; the audition binds its own fx = hpf 4000. The program's low band must not move while the audition plays.
  const low = (ms) => page.evaluate(async (ms) => { const an = window.__sc.Bus.an, f = new Float32Array(an.frequencyBinCount), hz = an.context.sampleRate / an.fftSize; let sum = 0, n = 0; const t0 = performance.now();
    await new Promise((r) => { const iv = setInterval(() => { an.getFloatFrequencyData(f); let e = 0; for (let k = 1; k * hz < 600; k++) e += Math.pow(10, f[k] / 10); sum += e; n++; if (performance.now() - t0 > ms) { clearInterval(iv); r(); } }, 20); }); return 10 * Math.log10(sum / n); }, ms);
  const MAIN2 = 'setcpm(240/4)\nhooks.def("murk", { chain: [["lpf", 300]] })\nhooks.bind("fx", "murk")\n$: note("c2").s("sawtooth").use("fx")\n$: s("hh*8").gain(.3)';
  await page.evaluate((c) => { const ta = document.getElementById('code'); ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement.blur(); }, MAIN2);
  await page.evaluate(() => window.__sc.stop()); await page.waitForTimeout(300); await page.evaluate(() => window.__sc.play()); await page.waitForFunction(() => window.__sc.S.playing, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const lo0 = await low(1500);
  await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 'c:1', title: 'C', code: 'setcpm(240/4)\nhooks.def("bright", { chain: [["hpf", 4000]] })\nhooks.bind("fx", "bright")\n$: note("c5*2").s("triangle").gain(.2).use("fx")' })); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 }); await page.waitForTimeout(800);
  const lo1 = await low(1500); nums.low = [lo0.toFixed(1), lo1.toFixed(1)];
  check('a colliding fx slot leaves the program\'s low band unchanged (within 1 dB) while the audition plays', Math.abs(lo1 - lo0) < 1, JSON.stringify(nums.low));
  check('the audition uses its own fx (its registry has the bright def, the program\'s does not)', await page.evaluate(() => { const h = window.strudelCraft.hooks, a = window.strudelCraft.quickplay.run.A; return a.R.defs.has('bright') && !JSON.parse(h.toJSON()).defs?.bright && !!JSON.parse(h.toJSON()).defs?.murk; }));
  // controls: an auditioned ctl() leaves the controls list, the Perform model and localStorage alone, also after a reload
  const ctlState = () => page.evaluate(() => JSON.stringify({ l: window.strudelCraft.perform.controls.list().map((c) => c.name), m: window.strudelCraft.perform.model().controls, ls: localStorage.getItem('sc.perform') }));
  await page.evaluate(() => window.strudelCraft.quickplay.stop('fast')); await page.waitForTimeout(300); const cs0 = await ctlState();
  await page.evaluate(() => window.strudelCraft.quickplay.play({ key: 'c:2', title: 'K', code: 'setcpm(240/4)\n$: s("hh*4").lpf(ctl("qpleak", { min: 200, max: 4000 })).gain(slider(0.4))' })); await page.waitForFunction(() => window.strudelCraft.quickplay.state.phase === 'playing', null, { timeout: 30000 });
  const kp = await peak(800); await page.evaluate(() => window.strudelCraft.quickplay.stop('fast')); await page.waitForTimeout(300); const cs1 = await ctlState();
  check('an auditioned ctl()/slider() plays and leaves controls list, model and localStorage unchanged', kp.pk > 0.003 && cs1 === cs0 && !cs1.includes('qpleak'), cs1.includes('qpleak') ? 'leaked' : 'peak ' + kp.pk.toFixed(3));
  await page.reload(); await page.waitForSelector('#list li[data-id]'); await page.evaluate(() => window.__sc.setView('perform')); await page.waitForFunction(() => window.strudelCraft.perform && window.strudelCraft.perform.controls, null, { timeout: 60000 });
  check('after a reload the Perform controls do not contain the audition\'s control', !(await ctlState()).includes('qpleak'));
  await page.evaluate(() => window.__sc.stop());
  console.log(JSON.stringify(nums));
  const real = errors.filter((e) => !/notAFunction/.test(e)); check('no console errors (the deliberate bad entry logs its own eval error)', real.length === 0, real.slice(0, 3).join(' | '));
} catch (e) { check('run to the end', false, e.stack); }
await browser.close(); server.close();
const failed = checks.filter((c) => !c.ok); console.log(`\n${checks.length - failed.length}/${checks.length} passed`); process.exit(failed.length ? 1 : 0);
