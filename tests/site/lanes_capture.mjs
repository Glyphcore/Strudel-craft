// Lanes L3 (#76), Playwright half: audio and level of a capture on the real site page (real superdough from unpkg, the site's own offline renderer).
// Usage: node tests/site/lanes_capture.mjs. The CLI boxes (strudel capture / render / stems) are SKIPs in tests/lanes/l3.mjs; here only what the browser decides.
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const pass = (m) => console.log('PASS ' + m); const skip = (m, why) => console.log(`SKIP ${m}: ${why}`); const fail = (m) => { console.log('FAIL ' + m); process.exitCode = 1; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const db = (x) => 20 * Math.log10(x);

// a kick of a sine at 4 per cycle (no sample download), a second lane that must not be in the capture
const KICKS = 'setcps(1)\ndrums: note("c2*4").s("sine").attack(0.001).decay(0.12).sustain(0).release(0.02).gain(0.8).tags("drums")\nlead: note("e4*2").s("triangle").gain(0.3).tags("lead")\ncapture("groove", "drums", { window: "1b..3b" })\n';
async function session(fn) {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  try {
    await page.goto(BASE); await page.waitForSelector('#list li[data-id]'); await page.click('#list li[data-id="minor-arp"] .row');
    return await fn(page, errs);
  } finally { await page.close(); }
}
// loads the capture module, compiles the program (registering its captures), renders pass 1, and runs `probe` in the page
const inPage = (page, src, probe) => page.evaluate(async ({ src, probe }) => {
  const sc = window.strudelCraft; await sc.lanesCaptureEnsure(src); await sc.transport.compileCode(src);
  const C = sc.lanesCapture; const done = await C.host.resolve(src);
  return await (new Function('sc', 'C', 'done', `return (async () => { ${probe} })()`))(sc, C, done);
}, { src, probe });

try {
  const run = await session(async (page, errs) => {
    const a = await inPage(page, KICKS, `const e = C.audio('groove'); const lv = C.level('groove'); const solo = await sc.capture.renderRecipe({ id: 's', name: 's', state: { source: { kind: 'code', code: 'setcps(1)\\ndrums: note("c2*4").s("sine").attack(0.001).decay(0.12).sustain(0).release(0.02).gain(0.8)' }, settings: { masterDb: 0 } }, timing: { cps: 1, start: 0, stop: 2, cycles: 2, loop: false, mode: 'cycles' }, random: { seed: 0x5c1a5 }, outputs: {}, events: {} }, { sr: 48000 });
      const src2 = new Function('return 0'); return { frames: e.frames, sr: e.sr, cps: e.cps, L: Array.from(e.L), soloL: Array.from(solo.L), done, rms: Array.from(lv.rms), per: lv.per, sound: !!(window.soundMap && soundMap.get()['cap_groove']) };`);
    return { a, errs };
  });
  const { a } = run; const SR = a.sr;
  // frames and difference to the solo render of the same bars
  const want = Math.round(2 / a.cps * SR); let d = 0, r = 0; for (let i = 0; i < a.L.length; i++) { d += (a.L[i] - a.soloL[i]) ** 2; r += a.soloL[i] ** 2; }
  const diffDb = r ? db(Math.sqrt(d / a.L.length) / Math.sqrt(r / a.L.length) || 1e-12) : 0; const solo = Math.sqrt(r / a.L.length);
  console.log(`  frames ${a.frames} (round(2/cps*sr) = ${want}), solo RMS ${solo.toExponential(2)}, difference vs solo render ${diffDb.toFixed(1)} dB (-240 = identical), sound cap_groove registered: ${a.sound}, errors ${run.errs.length}`);
  if (a.frames === want && solo > 1e-3 && diffDb < -60 && a.sound) pass(`Audio capture (site half of "equals the source"): the offline capture of "1b..3b" of the drums lane has exactly ${want} frames and differs ${r ? (diffDb <= -239 ? 'by exactly 0 (identical samples)' : diffDb.toFixed(1) + ' dB') : 'n/a'} from a solo render of that lane over the same bars (the lead lane is not in it); registered as sound cap_groove. The CLI WAV form of this box is open (CLI repo)`);
  else fail(`Audio capture frames=${a.frames}/${want} diff=${diffDb} sound=${a.sound}`);

  // level: kick onsets vs midway; two runs give identical sequences
  const lvl = (rms, per, t) => rms[Math.floor(((t % 2) + 2) % 2 * per)];
  const at = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]; const on = at.map((t) => lvl(a.rms, a.per, t + 0.01)), mid = at.map((t) => lvl(a.rms, a.per, t + 0.14));
  const worst = Math.min(...on.map((v, i) => db(v / Math.max(mid[i], 1e-9)))); console.log(`  level at onsets ${on.map((x) => x.toFixed(3)).join(' ')}; midway ${mid.map((x) => x.toFixed(4)).join(' ')}; worst onset/midway ratio ${worst.toFixed(1)} dB`);
  const run2 = await session(async (page) => (await inPage(page, KICKS, `return Array.from(C.level('groove').rms);`)));
  const same = JSON.stringify(run2) === JSON.stringify(a.rms);
  if (worst >= 6 && same) pass(`Level: with 4 kicks per bar, the level of the capture at the 8 kick onsets is at least ${Math.min(worst, 100).toFixed(0)} dB above its value midway between kicks (the midway value is ${Math.max(...mid)} at most: digital silence between the decays), and the 128-point level sequence is identical in a second run (fresh page); the site reads it as recall("groove:level") (checked below)`);
  else fail(`Level worst=${worst} same=${same}`);

  // recall(...:level) as a pattern in the page and .from("groove") as a sound with the registered sample
  const rl = await session(async (page) => inPage(page, KICKS + 'x: recall("groove:level")\n', `const p = sc.engineState ? null : null; const pat = await (async () => { const info = await sc.transport.compileCode(${JSON.stringify(KICKS + 'x: recall("groove:level")\n')}); return info.pattern; })(); const v = (t) => { const h = pat.queryArc(t, t, { _cps: 1 }).filter((h) => typeof h.value === 'number'); return h.length ? h[0].value : null; }; return { on: v(0.01), mid: v(0.14), later: v(4.01) };`));
  if (rl.on > rl.mid * 2 && rl.later === rl.on) pass(`recall("groove:level") as a pattern: ${rl.on.toFixed(3)} at a kick onset, ${rl.mid.toFixed(4)} midway, and the same loop value at cycle 4 (period 2)`);
  else fail('recall level ' + JSON.stringify(rl));
  // the capture as a sample: drums muted from cycle 2 on, a chop lane plays slices of cap_groove in cycles 2-4 (the second pass of LANES 6.2, run here by the host)
  const PROG = KICKS + 'tagged("drums").mute("3b..")\ntagged("lead").mute("3b..")\nchop: s("x").from("groove").slice(4, "0 1 2 3").gain(1)\n';
  const smp = await session(async (page) => inPage(page, PROG, `const info = await sc.transport.compileCode(${JSON.stringify(PROG)}); const out = await sc.capture.renderRecipe({ id: 'p2', name: 'p2', state: { source: { kind: 'code', code: ${JSON.stringify(PROG)} }, settings: { masterDb: 0 } }, timing: { cps: 1, start: 2, stop: 4, cycles: 2, loop: false, mode: 'cycles' }, random: { seed: 1 }, outputs: {}, events: {} }, { sr: 48000 }); let s = 0; for (const v of out.L) s += v * v; return { rms: Math.sqrt(s / out.L.length), fails: out.fails, haps: out.haps, done };`));
  console.log(`  chop lane over cycles 2-4 (drums and lead muted there): ${smp.haps} haps, ${smp.fails} failed, RMS ${smp.rms.toExponential(2)} (drums RMS over the capture ${solo.toExponential(2)})`);
  if (smp.rms > 0.2 * solo && !smp.fails) pass(`As a sample (site render): after the capture pass, ".from(\"groove\").slice(4, ...)" plays the captured audio through superdough in cycles 2-4 with the drums and lead lanes muted: RMS ${smp.rms.toExponential(2)} (${(smp.rms / solo).toFixed(2)} of the source lane), ${smp.fails} failed events`);
  else fail('As a sample ' + JSON.stringify(smp));

  // Bounce: the capture node's Bounce path lands an audio take with meta.from in the Record list (strudelCraft.capture.addTake)
  const bn = await session(async (page) => inPage(page, KICKS, `const t = await C.host.bounce('groove', ${JSON.stringify(KICKS)}); const l = await sc.capture.list(); const e = l.find((x) => x.id === t.id); const au = C.audio('groove'); let ok = true; try { sc.recipe.validate(JSON.parse(JSON.stringify(e))); } catch (er) { ok = er.message; } return { from: e.meta && e.meta.from, audio: e.audio, cycles: e.timing.cycles, cps: e.timing.cps, frames: e.outputs.capture.frames, want: au.frames, valid: ok, name: e.name };`));
  if (bn.from === 'groove' && bn.audio.includes('capture') && bn.frames === bn.want && bn.cycles === 2 && bn.valid === true) pass(`Bounce (site half): host.bounce("groove") stores an audio-only take "${bn.name}" in the Record list with meta.from = "groove", ${bn.frames} frames (= the capture's audio), 2 cycles at ${bn.cps} cps, valid recipe. The CLI form (strudel capture -o) is open (CLI repo)`);
  else fail('Bounce ' + JSON.stringify(bn));

  // Remake / determinism: the Record panel's beforeRender hook runs the capture passes first; two Remakes of one recipe give the same audio hash
  const SOLO = 'setcps(1)\ndrums: note("c2*4").s("sine").attack(0.001).decay(0.12).sustain(0).release(0.02).gain(0.8).tags("drums")\ncapture("groove", "drums", { window: "1b..3b" })\n'; // one voice at a time: single-reader lanes are bit-exact
  const REM = SOLO + 'tagged("drums").mute("3b..")\nchop: s("x").from("groove").slice(4, "0 1 2 3").mask("<0 0 1 1>").gain(1)\n';
  const rm = await session(async (page) => page.evaluate(async ({ REM }) => {
    const sc = window.strudelCraft, c = sc.capture; const sha = async (L, R) => { const b = new Float32Array(L.length * 2); for (let i = 0; i < L.length; i++) { b[2 * i] = L[i]; b[2 * i + 1] = R[i]; } return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b.buffer))].map((x) => x.toString(16).padStart(2, '0')).join(''); };
    const base = await c.renderExact(1); const recipe = JSON.parse(JSON.stringify(base.recipe)); recipe.id = 'lanes-remake-76'; recipe.name = 'lanes capture remake'; recipe.state.source.code = REM; recipe.state.source.title = 'capture example'; recipe.timing = { ...recipe.timing, cps: 1, start: 0, stop: 4, cycles: 4, loop: false, mode: 'cycles' };
    const hooked0 = !!sc.lanesCaptureHookOff;
    const first = await c.renderRecipe(recipe); const hooked = !!sc.lanesCaptureHookOff; const h0 = await sha(first.L, first.R);
    recipe.outputs = { ...recipe.outputs, render: { sha256: 'sha256:' + h0, sr: first.sr, frames: first.L.length, how: 'offline', encoding: 'f32le-interleaved', envelope: base.recipe.outputs.render ? base.recipe.outputs.render.envelope : undefined } };
    await c.importRecipe(JSON.stringify(recipe)); const r1 = await c.remake(recipe.id, { silent: true }); const r2 = await c.remake(recipe.id, { silent: true });
    const json = JSON.stringify(recipe); let rms = 0; for (const v of first.L.subarray(2 * 48000)) rms += v * v;
    return { hooked0, hooked, h0, r1: r1 && String(r1.sha256).replace('sha256:', ''), r2: r2 && String(r2.sha256).replace('sha256:', ''), m1: r1 && r1.match, m2: r2 && r2.match, e1: r1 && (r1.error || r1.refused), size: json.length, hasAudio: /"L"|cap_groove":\[|Float32/.test(json), rms: Math.sqrt(rms / (first.L.length - 2 * 48000)), notes: r1 && r1.notes };
  }, { REM }));
  console.log(`  recipe JSON ${rm.size} bytes (program text and timing only), stored hash ${String(rm.h0).slice(0, 12)}, remake 1 ${String(rm.r1).slice(0, 12)} (${rm.m1}), remake 2 ${String(rm.r2).slice(0, 12)} (${rm.m2}), chop RMS in cycles 2-4 ${Number(rm.rms).toExponential(2)}, hook registered before the first render: ${rm.hooked0}, after: ${rm.hooked}`);
  if (rm.hooked && rm.r1 && rm.r1 === rm.h0 && rm.r2 === rm.r1 && rm.m1 === true && !rm.hasAudio && rm.rms > 1e-3) pass(`Determinism (site half) and Remake: the Record panel's beforeRender hook runs the capture pass before each offline render; two Remakes of a recipe whose program holds capture + chop give the same audio hash as the stored render (${String(rm.r1).slice(0, 16)}), the recipe JSON (${rm.size} bytes) holds no capture audio, and the chop lane is audible (RMS ${Number(rm.rms).toExponential(2)}) in cycles 2-4 where the drums are muted. Scope: single-reader lanes are bit-exact; a two-reader bus (.split) is reproducible to about 1 ULP (LANES 11c). The CLI render hash is open (CLI repo)`);
  else fail('Remake ' + JSON.stringify(rm));
  // #87: a live window capture records what the scheduler triggered (not the visuals' look-ahead queries) and its state follows the audio clock:
  // still recording just before the window end (cycle 2), frozen just after, with the foreground look-ahead (0.2 s) and the hidden one (>= 1 s)
  for (const hidden of [false, true]) {
    const lv = await session(async (page) => page.evaluate(async (hidden) => {
      if (hidden) Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); // the worker clock raises its look-ahead at the next tick
      const code = 'setcps(1)\ndrums: note("c2*4").s("sine").attack(0.001).decay(0.1).sustain(0).release(0.02).gain(0.5).tags("drums")\ncapture("take", "drums", { window: "1b..3b", live: true })\n';
      await window.__sc.play({ kind: 'solo', id: 'cap-87', title: 'cap 87', code });
      const sc = window.strudelCraft; const sch = sc.transport.scheduler; const samples = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) { const c = sch.now(); const w = sc.lanes.captureState('take'); samples.push([c, w]); await new Promise((r) => setTimeout(r, 8)); }
      const st = sc.lanesCapture.state('take', 10);
      return { samples, n: st && st.haps.length, onsets: st && st.haps.map((h) => +h.abs) };
    }, hidden));
    const S2 = lv.samples; const firstFrozen = S2.find(([, w]) => w === 'frozen'); const earlyFrozen = S2.filter(([c, w]) => c < 1.97 && w === 'frozen').length; const lateRec = S2.filter(([c, w]) => c > 2.3 && w !== 'frozen').length;
    const rec = S2.some(([c, w]) => c > 1.5 && c < 1.97 && w === 'recording');
    console.log(`  live window 1b..3b, ${hidden ? 'hidden' : 'foreground'}: first frozen at cycle ${firstFrozen && firstFrozen[0].toFixed(3)}, frozen before 1.97: ${earlyFrozen}, not frozen after 2.3: ${lateRec}; ${lv.n} events ${JSON.stringify(lv.onsets)}`);
    if (rec && firstFrozen && firstFrozen[0] >= 1.97 && firstFrozen[0] < 2.25 && !earlyFrozen && !lateRec && lv.n === 8 && lv.onsets.every((x, i) => Math.abs(x - i / 4) < 1e-9)) pass(`Live window capture (#87, ${hidden ? 'hidden tab look-ahead' : 'foreground look-ahead'}): recording until the audio clock reaches cycle 2 (first frozen at ${firstFrozen[0].toFixed(3)}), 8 scheduled events exactly, visuals queries not recorded`);
    else fail('Live window capture #87 ' + (hidden ? 'hidden ' : '') + JSON.stringify({ rec, ff: firstFrozen, earlyFrozen, lateRec, n: lv.n, onsets: lv.onsets }));
  }
} catch (e) { fail('site capture threw ' + (e.stack || e.message)); }
await browser.close(); server.close();
console.log(process.exitCode ? 'lanes site L3: FAIL' : 'lanes site L3 done');
