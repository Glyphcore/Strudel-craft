/* Quick play (#150): a play button on every Syntax example, Syntax section header and Recipes row that auditions that entry's code in place.
   No navigation, no view switch, no editor write, scroll or focus (#107): the button is only a button.
   How it sounds without touching the main program (docs/QUICKPLAY.md):
   - its own Strudel repl (webaudioRepl: its own scheduler and pattern), so the main program, its scheduler and the editor text are never replaced;
   - every note is routed to one dedicated superdough orbit (QP_ORBIT), whose output node carries the audition level and the stop fade;
   - the global slots a repl evaluation rebinds (time, cps, trigger, current pattern, started flag) are put back to the main repl's after every evaluate and stop;
   - the page master bus (meter, master level, mute on Stop) is shared: that is what "mixes with the program" means.
   Mix choice: the audition never replaces anything. While the program plays it mixes at LEVEL_MIX (0.6, -4.4 dB); alone it plays at LEVEL_ALONE (0.9).
   Solo (tray chip) mutes every other orbit (the main program) until the audition stops, then restores them.
   Length chip (persisted): End (default, record-length.js resolver, else continuous), Loop, or N bars; 20 min safety stop. One audition at a time: another play = switch.
   Stop: the transport Stop calls stop('fast') (25 ms fade); every ending fades, so no click. Tempo: the entry's own setcpm/setbpm/setcps, else the entry's bpm
   hint, else the page tempo knob. API: window.strudelCraft.quickplay = { press(btn, spec), play(spec), stop(how), sync(), state, stats } */
const sc = (window.strudelCraft = window.strudelCraft || {});
import * as RL from './record-length.js';
const QP_ORBIT = 13, LEVEL_MIX = 0.6, LEVEL_ALONE = 0.9, MAX_S = RL.MAX_MIN * 60, /* quickplay.maxS overrides it (tests use a short one) */ FADE_FAST = 0.025, FADE_END = 0.12, TAIL_MS = 380;
const S0 = () => window.__sc;
const lsGet = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const toast = (m, kind = 'info') => { try { sc.ui && sc.ui.toast(m, { kind }); } catch (e) { /* no ui */ } };
const state = { key: null, phase: 'idle', title: '', mode: ['end', 'loop', 'bars'].includes(lsGet('qp.mode', 'end')) ? lsGet('qp.mode', 'end') : 'end', bars: Math.max(1, Math.min(256, +lsGet('qp.bars', 8) || 8)), pos: '', solo: false, error: '' };
const stats = { pressToSoundMs: null, lastPeak: 0, plays: 0 };
let repl = null, run = null, token = 0, tray = null, raf = 0, poll = 0;

const ctrl = () => { try { return window.getSuperdoughAudioController(); } catch (e) { return null; } };
const orbit = () => { const c = ctrl(); return c && c.nodes ? c.nodes[QP_ORBIT] : null; };
const mainPlaying = () => !!(S0() && S0().S.playing);
const level = () => (mainPlaying() ? LEVEL_MIX : LEVEL_ALONE);

/* globals a repl rebinds when it is created or evaluates (core setTime / setCpsFunc / setTriggerFunc / setPattern / setIsStarted): back to the main repl's */
function restoreGlobals() {
  const E = S0() && S0().Engine, m = E && E.repl; if (!m) return;
  try {
    const sch = m.scheduler;
    if (window.setTime) window.setTime(() => sch.now());
    if (window.setCpsFunc) window.setCpsFunc(() => sch.cps);
    if (window.setPattern && m.state && m.state.pattern) window.setPattern(m.state.pattern);
    if (window.setIsStarted) window.setIsStarted(!!sch.started);
    const B = sc.bg && sc.bg.fire; if (window.setTriggerFunc && B && B.onTrigger) window.setTriggerFunc(B.onTrigger);
  } catch (e) { console.warn('quickplay: restore globals: ' + e.message); }
}

/* ---- buttons ---- */
const btns = (key) => [...document.querySelectorAll('[data-qp]')].filter((b) => !key || b.dataset.qp === key);
export function sync() {
  for (const b of btns()) {
    const on = b.dataset.qp === state.key && state.phase !== 'idle';
    b.dataset.state = on ? state.phase : 'idle'; b.setAttribute('aria-pressed', String(on && state.phase === 'playing'));
    if (!on) { b.style.removeProperty('--qp-p'); b.style.removeProperty('--qp-lv'); }
    const t = b.dataset.title || '';
    if (b.getAttribute('aria-disabled') !== 'true') b.setAttribute('aria-label', (on ? 'Stop ' : 'Quick play ') + t);
  }
  paintTray();
}
function mkTray() {
  if (tray) return tray;
  tray = document.createElement('div'); tray.className = 'qp-tray'; tray.id = 'qptray'; tray.hidden = true; tray.setAttribute('role', 'group'); tray.setAttribute('aria-label', 'Quick play audition');
  tray.innerHTML = '<span class="qp-tt" role="status" aria-live="polite"></span><span class="qp-pos"></span><button type="button" class="qp-solo" aria-pressed="false" title="Solo: mute the program until this audition stops">Solo</button><button type="button" class="qp-mode" title="Length: End plays to the end of the entry (loops when it has none), Loop never stops, N bars stops after N bars"></button><span class="qp-step" hidden><button type="button" class="qp-dn" aria-label="Fewer bars">-</button><button type="button" class="qp-up" aria-label="More bars">+</button></span><button type="button" class="qp-stop" aria-label="Stop the audition" title="Stop the audition"><i class="qp-i" aria-hidden="true"></i></button>';
  tray.addEventListener('click', (e) => {
    if (e.target.closest('.qp-stop')) stop('fast');
    else if (e.target.closest('.qp-mode')) { state.mode = state.mode === 'end' ? 'loop' : state.mode === 'loop' ? 'bars' : 'end'; lsSet('qp.mode', state.mode); applyMode(); paintTray(); }
    else if (e.target.closest('.qp-dn, .qp-up')) { state.bars = Math.max(1, Math.min(256, state.bars + (e.target.closest('.qp-up') ? (state.bars >= 16 ? 4 : 1) : -(state.bars > 16 ? 4 : 1)))); lsSet('qp.bars', state.bars); applyMode(); paintTray(); }
    else if (e.target.closest('.qp-solo')) setSolo(!state.solo);
  });
  document.body.append(tray); return tray;
}
function paintTray() {
  const on = state.phase !== 'idle'; if (!on && !tray) return; const t = mkTray(); t.hidden = !on; if (!on) return;
  t.querySelector('.qp-tt').textContent = (state.phase === 'loading' ? (S0() && S0().Engine.repl ? 'Loading ' + state.title : 'Loading audio engine') : 'Auditioning ' + state.title);
  const m = t.querySelector('.qp-mode'); m.textContent = state.mode === 'end' ? 'End' : state.mode === 'loop' ? 'Loop' : state.bars + ' bars'; m.setAttribute('aria-pressed', String(state.mode !== 'end')); t.querySelector('.qp-step').hidden = state.mode !== 'bars'; t.querySelector('.qp-pos').textContent = state.pos;
  t.querySelector('.qp-solo').setAttribute('aria-pressed', String(state.solo));
}

/* ---- solo: every orbit but ours goes to 0 and comes back ---- */
function applySolo() {
  const c = ctrl(); if (!c || !c.nodes) return; const t = c.audioContext ? c.audioContext.currentTime : 0;
  for (const [k, o] of Object.entries(c.nodes)) { if (+k === QP_ORBIT || !o || !o.output) continue; try { const p = o.output.gain; p.cancelScheduledValues(t); p.setTargetAtTime(state.solo ? 0 : 1, t, 0.01); } catch (e) { /* node gone */ } }
}
function setSolo(on) { state.solo = on; applySolo(); paintTray(); }

/* ---- the repl and its output ---- */
async function getRepl() {
  if (repl) return repl;
  const W = window; const TR = W.transpiler || (W.strudel && W.strudel.transpiler); if (!W.webaudioRepl || !W.webaudioOutput || !TR) throw new Error('The Strudel engine is not ready');
  const ctx = W.getAudioContext();
  const defaultOutput = async (hap, dt, dur, cps, t) => {
    if (!run) return; if (hap.value && typeof hap.value === 'object') hap.value.orbit = QP_ORBIT;
    if (stats.firstAt == null && run.t0 != null) { stats.firstAt = performance.now(); stats.pressToSoundMs = Math.round(stats.firstAt - run.t0 + Math.max(0, (t - ctx.currentTime)) * 1000); }
    await W.webaudioOutput(hap, dt, dur, cps, t); fixOrbit();
  };
  repl = W.webaudioRepl({ getTime: () => ctx.currentTime, defaultOutput, transpiler: TR, audioContext: ctx });
  restoreGlobals(); return repl;
}
function fixOrbit() {
  const o = orbit(); if (!o || !o.output || !run) return;
  if (!run.out) {
    run.out = o; try { run.an = new AnalyserNode(o.output.context, { fftSize: 512 }); o.output.connect(run.an); run.buf = new Float32Array(run.an.fftSize); } catch (e) { run.an = null; }
    const p = o.output.gain, t = o.output.context.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(level(), t);
  }
  if (state.solo) applySolo();
}

/* ---- length: the Record 'To end of track' resolver (record-length.js: gates, hooks.marker('end'), @daw bars header, arrange period); no finite end = continuous ---- */
function resolveLen(R, code, cps) {
  try {
    let plan = null, markers = null; const H = sc.hooks; if (H && H.plan) { plan = H.plan({ horizon: 1024 }); markers = plan.markers || null; }
    const e = RL.resolveEnd({ plan, horizon: 1024, markers, code, cps });
    const finite = e.rule !== 'period' || RL.arrangeBars(code) != null; /* a plain looping pattern (or a bare <a b c> alternation) has no end */
    return finite && e.cycle > 0 ? { cycles: e.cycle, rule: e.rule, note: e.note } : { cycles: null, rule: 'none', note: 'no finite end: loops until stopped' };
  } catch (e) { return { cycles: null, rule: 'none', note: 'end not readable: loops until stopped' }; }
}
function applyMode(r = run) { if (!r) return; r.endC = state.mode === 'bars' ? state.bars : state.mode === 'loop' ? null : r.found ? r.found.cycles : null; if (r.tail && (r.endC == null || (r.cyc || 0) < r.endC)) { /* a stop already scheduled stays */ } }
/* ---- isolation: what an audition's evaluate rebinds is saved before it and put back after it / on the final release ----
   1. the program's repl-bound globals (all, each, hush, cpm, setcps/setcpm..., Pattern.prototype.p/q/d1..): saved and restored around the evaluate;
   2. the hooks registry (defs, binds, markers, slots, vars, taps...): the audition is evaluated against a blank registry (so its own End resolves from its own
      markers and gates, and an earlier audition's entries are gone), then merged over the program's for playback; the final release restores the program's exactly
      (skipped when the program re-evaluated meanwhile: its registry is then already newer). */
const GN = ['all', 'each', 'hush', 'cpm', 'setCps', 'setcps', 'setCpm', 'setcpm', 'compileKabel'];
const PK = () => ['p', 'q', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => ['d' + i, 'p' + i, 'q' + i])];
function saveGlobals() { const P = window.Pattern && window.Pattern.prototype; return { g: GN.map((k) => [k, window[k]]), d: P ? PK().map((k) => [k, Object.getOwnPropertyDescriptor(P, k)]) : [] }; }
function putGlobals(v) { for (const [k, x] of v.g) { try { if (x === undefined) delete window[k]; else window[k] = x; } catch (e) { /* locked */ } } const P = window.Pattern && window.Pattern.prototype; if (P) for (const [k, d] of v.d) { try { if (d) Object.defineProperty(P, k, d); else delete P[k]; } catch (e) { /* locked */ } } }
let hbase = null, hbaseEval = 0, hadd = null;
const blankHooks = (b) => ({ R: { markers: new Map(), scopes: new Map(), slots: new Map(), declared: new Set(), defs: new Map(), bindings: [], vars: new Map(), sets: [], wires: [], taps: new Map(), reads: new Set(), laneMode: b.R.laneMode }, bid: b.bid, seq: b.seq, sid: b.sid, frozen: false, cpb: b.cpb, bpb: b.bpb, cps: b.cps, journal: b.journal });
function unhook(r) { const H = sc.hooks; if (!hbase || !H || !H.restore) { hbase = null; return; } if (run && run !== r) return; const same = S0() && S0().Engine.evalCount === hbaseEval; try { if (same) H.restore(hbase); else if (hadd) H.unmerge(hadd, hbase); } catch (e) { console.warn('quickplay: hooks restore: ' + e.message); } hbase = null; hadd = null; }
/* one cleanup for every exit (error, failed prepare, blocked, switch, Stop, page hide): Solo off and the program's orbits back to 1, the bus muted again if we unmuted it */
function release(r) {
  const was = state.solo; state.solo = false; if (was) applySolo();
  const Q = S0(); if (r && r.mutedBus && Q && !Q.S.playing) { try { Q.muteBus(); } catch (e) { /* no bus */ } r.mutedBus = false; }
}
/* ---- run ---- */
function withTempo(code, spec) {
  const Q = S0(); if (Q.hasOwnTempo(code)) return code;
  const bpm = spec.bpm || Q.S.tempo; return `setcpm(${bpm}/4)\n` + code;
}
export async function play(spec) {
  if (!spec || !spec.code) return;
  if (state.key === spec.key && state.phase !== 'idle') return stop('fast');
  const me = ++token; const prev = run; const t0 = performance.now();
  state.key = spec.key; state.title = spec.title || ''; state.phase = 'loading'; state.error = ''; stats.firstAt = null; stats.pressToSoundMs = null; sync();
  if (prev) await endRun(prev, FADE_FAST, true);
  const Q = S0(); const r = { key: spec.key, t0, me, mutedBus: false };
  try {
    const code = withTempo(spec.code, spec);
    await Q.Engine.prepare(code, !!spec.samples, () => {});
    if (me !== token) return;
    const ctx = window.getAudioContext();
    if (ctx.state !== 'running') { toast('Audio is blocked by the browser: tap the play button again to allow sound', 'error'); throw Object.assign(new Error('blocked'), { silent: true }); }
    if (!Q.S.playing && Q.Bus.muted) { Q.unmuteBus(); r.mutedBus = true; }
    await Q.ensureCode(code); const prot = Q.protectCode(code);
    const R = await getRepl(); if (me !== token) { release(r); return; }
    R.state.evalError = undefined; run = r;
    const H = sc.hooks && sc.hooks.snapshot ? sc.hooks : null, G = saveGlobals(); let A = null;
    if (H) { if (hbase) H.restore(hbase); else { hbase = H.snapshot(); hbaseEval = Q.Engine.evalCount; } H.restore(blankHooks(hbase)); }
    try { await R.evaluate(prot, true); } finally { putGlobals(G); restoreGlobals(); }
    if (R.state.evalError) { if (H) H.restore(hbase); throw R.state.evalError; }
    if (me !== token) return;
    r.start = R.scheduler.now(); r.t0a = ctx.currentTime; r.cps = R.scheduler.cps || 0.5; r.found = resolveLen(R, prot, r.cps);
    if (H) { A = H.snapshot(); hadd = A; H.restore(hbase); H.merge(A); } applyMode(r);
    state.phase = 'playing'; stats.plays++; sync(); startLoops();
  } catch (e) {
    if (me !== token) return;
    run = null; state.phase = 'idle'; state.key = null; state.error = e && e.message || String(e); sync(); restoreGlobals();
    release(r); unhook(r);
    try { repl && repl.scheduler.stop(); } catch (er) { /* idle */ }
    if (!(e && e.silent)) toast(`Quick play: ${spec.title || 'example'} did not play: ${state.error}`, 'error');
  }
}
/* end a run: stop scheduling, fade the orbit, dispose it (a fresh orbit, with fresh delay/reverb, next time), restore solo and the muted bus */
async function endRun(r, fade, hard) {
  if (!r || r.ending) return; r.ending = true;
  try { repl && repl.scheduler.stop(); } catch (e) { /* idle */ }
  const o = r.out || orbit();
  if (o && o.output) { try { const p = o.output.gain, t = o.output.context.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + fade); } catch (e) { /* gone */ } }
  await new Promise((ok) => setTimeout(ok, fade * 1000 + 15));
  try { if (r.an) r.an.disconnect(); } catch (e) { /* gone */ }
  if (o) { try { o.disconnect(); } catch (e) { /* gone */ } const c = ctrl(); if (c && c.nodes && c.nodes[QP_ORBIT] === o) delete c.nodes[QP_ORBIT]; }
  if (run === r) run = null;
  if (!hard) {
    stopLoops(); release(r); unhook(r); const Q = S0(); if (Q && !Q.S.playing) { try { Q.muteBus(); } catch (e) { /* no bus */ } }
    state.phase = 'idle'; state.key = null; sync();
    restoreGlobals();
  }
}
export function stop(how) {
  token++; const r = run; if (!r) { if (state.phase !== 'idle') { state.phase = 'idle'; state.key = null; stopLoops(); sync(); } return Promise.resolve(); }
  return endRun(r, how === 'fast' ? FADE_FAST : FADE_END, false);
}

/* ---- the meter and the cycle limit ---- */
function startLoops() {
  stopLoops();
  const frame = () => {
    raf = requestAnimationFrame(frame); const r = run; if (!r || state.phase !== 'playing') return;
    let lv = 0; if (r.an) { r.an.getFloatTimeDomainData(r.buf); for (let i = 0; i < r.buf.length; i++) { const v = Math.abs(r.buf[i]); if (v > lv) lv = v; } stats.lastPeak = Math.max(stats.lastPeak, lv); }
    let cyc = 0; try { cyc = repl.scheduler.now() - r.start; } catch (e) { /* stopped */ } r.cyc = cyc;
    const p = r.endC ? Math.min(1, cyc / r.endC) : ((cyc % 1) + 1) % 1;
    const el = Math.max(0, window.getAudioContext().currentTime - r.t0a); state.pos = (r.endC ? `bar ${Math.min(r.endC, Math.floor(cyc) + 1)} / ${+r.endC.toFixed(2)}` : `bar ${Math.floor(cyc) + 1}`) + ' · ' + RL.mmss(el).replace(/\.\d$/, ''); const pe = tray && tray.querySelector('.qp-pos'); if (pe) pe.textContent = state.pos;
    for (const b of btns(r.key)) { b.style.setProperty('--qp-p', p.toFixed(3)); b.style.setProperty('--qp-lv', Math.min(1, lv * 2.2).toFixed(3)); }
    if (tray) { tray.style.setProperty('--qp-p', p.toFixed(3)); tray.style.setProperty('--qp-lv', Math.min(1, lv * 2.2).toFixed(3)); }
  };
  raf = requestAnimationFrame(frame);
  poll = setInterval(() => {
    const r = run; if (!r || state.phase !== 'playing' || r.ending) return;
    let cyc = 0; try { cyc = repl.scheduler.now() - r.start; } catch (e) { return; }
    const el = window.getAudioContext().currentTime - r.t0a;
    if (el > (sc.quickplay.maxS || MAX_S) && !r.tail) { r.tail = true; toast(`Audition stopped after ${RL.MAX_MIN} minutes (the safety limit)`, 'info'); endRun(r, FADE_FAST, false); return; }
    if (r.endC && cyc >= r.endC && !r.tail) { r.tail = true; try { repl.scheduler.stop(); } catch (e) { /* idle */ } setTimeout(() => { if (run === r) endRun(r, FADE_END, false); }, TAIL_MS); }
    if (state.solo) applySolo();
  }, 40);
}
function stopLoops() { cancelAnimationFrame(raf); raf = 0; clearInterval(poll); poll = 0; if (tray) { tray.style.removeProperty('--qp-p'); tray.style.removeProperty('--qp-lv'); } }

/* ---- the entry point for buttons: spec() builds { key, title, code, bpm?, samples? } at press time (the form that is open, the edit that is current) ---- */
export async function press(btn, spec) {
  if (btn.getAttribute('aria-disabled') === 'true') { toast(btn.dataset.why || 'This entry cannot play on its own', 'info'); return; }
  const s = spec(); if (s && s.why) { toast(s.why, 'info'); return; }
  btn.dataset.title = s.title || ''; await play(s);
}
/* ---- lazy wiring (this module is loaded after the first frame, so the eager shell carries none of it) ---- */
const cssReady = new Promise((ok) => { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./quickplay.css', import.meta.url).href, onload: ok, onerror: ok }); document.head.append(l); });
const recipe = (id) => { const A = S0(); return A && A.S.recipes.find((r) => r.id === id); };
function rowButtons() {
  const list = document.getElementById('list'); if (!list) return;
  for (const li of list.querySelectorAll('li[data-id]')) {
    if (li.querySelector('.qp')) continue; const r = recipe(li.dataset.id); if (!r) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'qp'; b.dataset.qp = 'recipe:' + r.id; b.dataset.title = r.title; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Quick play ' + r.title); b.title = 'Quick play: audition here, nothing is loaded or opened';
    b.innerHTML = '<i class="qp-i" aria-hidden="true"></i>'; li.insertBefore(b, li.querySelector('.add'));
  }
  sync();
}
cssReady.then(() => {
  const list = document.getElementById('list'); if (!list) return; rowButtons();
  new MutationObserver(() => rowButtons()).observe(list, { childList: true });
  list.addEventListener('click', (e) => { const qb = e.target.closest('.qp'); if (!qb) return; e.stopImmediatePropagation(); const r = recipe(qb.dataset.qp.slice(7)); if (r) press(qb, () => ({ key: qb.dataset.qp, title: r.title, code: S0().S.edits[r.id] != null ? S0().S.edits[r.id] : r.code, bpm: r.bpm_hint, samples: !!r.needs_samples })); }, true);
  /* warm the engine while idle so the first tap does not pay the cold start (Strudel from the CDN, hooks, perform glue, worklets) */
  const warm = () => { const A = S0(); if (A && A.Engine && !A.Engine.repl) A.Engine.prepare('', false, () => {}).catch(() => {}); };
  setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(warm, { timeout: 5000 }) : warm()), 1500);
});

window.addEventListener('pagehide', () => { stop('fast'); });
sc.quickplay = { press, play, stop, sync, state, stats, QP_ORBIT, LEVEL_MIX, LEVEL_ALONE, get run() { return run; } };
sync();
