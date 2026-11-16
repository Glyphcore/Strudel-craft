/* Quick play (#150): a play button on every Syntax example, Syntax section header and Recipes row that auditions that entry's code in place.
   No navigation, no view switch, no editor write, scroll or focus (#107): the button is only a button.
   How it sounds without touching the main program (docs/QUICKPLAY.md):
   - its own Strudel repl (webaudioRepl: its own scheduler and pattern), so the main program, its scheduler and the editor text are never replaced;
   - every note is routed to one dedicated superdough orbit (QP_ORBIT), whose output node carries the audition level and the stop fade;
   - the global slots a repl evaluation rebinds (time, cps, trigger, current pattern, started flag) are put back to the main repl's after every evaluate and stop;
   - the page master bus (meter, master level, mute on Stop) is shared: that is what "mixes with the program" means.
   Mix choice: the audition never replaces anything. While the program plays it mixes at LEVEL_MIX (0.6, -4.4 dB); alone it plays at LEVEL_ALONE (0.9).
   Solo (tray chip) mutes every other orbit (the main program) until the audition stops, then restores them.
   Loop: 4 cycles by default then a short fade; the Loop chip (persisted) repeats until stopped. One audition at a time: another play = switch.
   Stop: the transport Stop calls stop('fast') (25 ms fade); every ending fades, so no click. Tempo: the entry's own setcpm/setbpm/setcps, else the entry's bpm
   hint, else the page tempo knob. API: window.strudelCraft.quickplay = { press(btn, spec), play(spec), stop(how), sync(), state, stats } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const QP_ORBIT = 13, LEVEL_MIX = 0.6, LEVEL_ALONE = 0.9, CYCLES = 4, FADE_FAST = 0.025, FADE_END = 0.12, TAIL_MS = 380;
const S0 = () => window.__sc;
const lsGet = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const toast = (m, kind = 'info') => { try { sc.ui && sc.ui.toast(m, { kind }); } catch (e) { /* no ui */ } };
const state = { key: null, phase: 'idle', title: '', loop: lsGet('qp.loop', false) === true, solo: false, error: '' };
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
  tray.innerHTML = '<span class="qp-tt" role="status" aria-live="polite"></span><button type="button" class="qp-solo" aria-pressed="false" title="Solo: mute the program until this audition stops">Solo</button><button type="button" class="qp-loop" aria-pressed="false" title="Loop until stopped (off: ' + CYCLES + ' cycles, then stop)">Loop</button><button type="button" class="qp-stop" aria-label="Stop the audition" title="Stop the audition"><i class="qp-i" aria-hidden="true"></i></button>';
  tray.addEventListener('click', (e) => {
    if (e.target.closest('.qp-stop')) stop('fast');
    else if (e.target.closest('.qp-loop')) { state.loop = !state.loop; lsSet('qp.loop', state.loop); paintTray(); }
    else if (e.target.closest('.qp-solo')) setSolo(!state.solo);
  });
  document.body.append(tray); return tray;
}
function paintTray() {
  const on = state.phase !== 'idle'; if (!on && !tray) return; const t = mkTray(); t.hidden = !on; if (!on) return;
  t.querySelector('.qp-tt').textContent = (state.phase === 'loading' ? 'Loading ' : 'Auditioning ') + state.title;
  t.querySelector('.qp-loop').setAttribute('aria-pressed', String(state.loop)); t.querySelector('.qp-solo').setAttribute('aria-pressed', String(state.solo));
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
  const Q = S0(); const r = { key: spec.key, t0, me, mutedBus: false, cycles: CYCLES };
  try {
    const code = withTempo(spec.code, spec);
    await Q.Engine.prepare(code, !!spec.samples, () => {});
    if (me !== token) return;
    const ctx = window.getAudioContext();
    if (ctx.state !== 'running') { toast('Audio is blocked by the browser: tap the play button again to allow sound', 'error'); throw Object.assign(new Error('blocked'), { silent: true }); }
    if (!Q.S.playing && Q.Bus.muted) { Q.unmuteBus(); r.mutedBus = true; }
    await Q.ensureCode(code); const prot = Q.protectCode(code);
    const R = await getRepl(); if (me !== token) { if (r.mutedBus && !Q.S.playing) Q.muteBus(); return; }
    R.state.evalError = undefined; run = r;
    await R.evaluate(prot, true); restoreGlobals();
    if (R.state.evalError) throw R.state.evalError;
    if (me !== token) return;
    r.start = R.scheduler.now(); state.phase = 'playing'; stats.plays++; sync(); startLoops();
  } catch (e) {
    if (me !== token) return;
    run = null; state.phase = 'idle'; state.key = null; state.error = e && e.message || String(e); sync(); restoreGlobals();
    if (r.mutedBus && !Q.S.playing) Q.muteBus();
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
    stopLoops(); const wasSolo = state.solo; state.solo = false; if (wasSolo) applySolo();
    state.phase = 'idle'; state.key = null; sync();
    const Q = S0(); if (Q && !Q.S.playing) { try { Q.muteBus(); } catch (e) { /* no bus */ } }
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
    let cyc = 0; try { cyc = repl.scheduler.now() - r.start; } catch (e) { /* stopped */ }
    const p = state.loop ? (((cyc % CYCLES) + CYCLES) % CYCLES) / CYCLES : Math.min(1, cyc / CYCLES);
    for (const b of btns(r.key)) { b.style.setProperty('--qp-p', p.toFixed(3)); b.style.setProperty('--qp-lv', Math.min(1, lv * 2.2).toFixed(3)); }
    if (tray) { tray.style.setProperty('--qp-p', p.toFixed(3)); tray.style.setProperty('--qp-lv', Math.min(1, lv * 2.2).toFixed(3)); }
  };
  raf = requestAnimationFrame(frame);
  poll = setInterval(() => {
    const r = run; if (!r || state.phase !== 'playing' || r.ending) return;
    let cyc = 0; try { cyc = repl.scheduler.now() - r.start; } catch (e) { return; }
    if (!state.loop && cyc >= CYCLES && !r.tail) { r.tail = true; try { repl.scheduler.stop(); } catch (e) { /* idle */ } setTimeout(() => { if (run === r) endRun(r, FADE_END, false); }, TAIL_MS); }
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
sc.quickplay = { press, play, stop, sync, state, stats, QP_ORBIT, LEVEL_MIX, LEVEL_ALONE, CYCLES };
sync();
