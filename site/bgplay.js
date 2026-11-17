/* Background playback (#56 "Background playback: no skips or stutter when hidden, locked or throttled").
   Strudel 1.3.0's scheduler (core Cyclist + zyklus clock, unmodified from unpkg) ticks from a main-thread setInterval every 100 ms
   and schedules a fixed window of 0.2 s ahead of AudioContext.currentTime (interval 0.1 + overlap 0.1), 0.05 s per callback.
   A tick that comes later than that window drops its query ("skip query: too late") while the cycle count still advances, so a
   throttled hidden tab (1 s timers, 1 per minute after 5 min) plays with holes, and a frozen page jumps ahead when it wakes.
   This module replaces the scheduler's `clock` instance property at runtime (Strudel's code stays untouched) with:
   - ticks from a dedicated Web Worker timer (worker timers are not throttled like main-thread timers), always against
     AudioContext.currentTime, never Date.now;
   - the same per-tick work as the Cyclist (same fields: lastBegin/lastEnd/lastTick/num_ticks_since_cps_change/..., same
     query and onTrigger call), so transport-range seek/loop and capture keep working;
   - an adaptive lookahead: 0.2 s in the foreground (Strudel's own), at least 1.0 s while hidden, raised after late ticks,
     bounded at 2.0 s, decaying back when the page is visible and ticks are on time;
   - no catch-up and no skipped cycles: when the window ran dry anyway (frozen page, a stall longer than the lookahead) the clock
     re-anchors the same cycle at the current audio time and records a pause.
   It also tracks pauses (segment timeline), applies the background policy, holds a screen wake lock while playing in the
   foreground, publishes Media Session metadata and handlers, and exposes diagnostics. API: window.strudelCraft.bg */
import * as N from './numfmt.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const lsGet = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
export const LOOKAHEAD = { base: 0.2, hidden: 1.0, max: 2.0 }; /* seconds of audio scheduled ahead; base = Strudel's interval + overlap */
const TICK_MS = 50, DURATION = 0.05, MIN_LATENCY = 0.01, LATE_GAP = 0.15, PRECISION = 1e4;
/* Query batching (docs/AUDIO_ENGINE.md, win W2): every pattern query pays a fixed cost in the hooks / lanes / maps passes (5.5 ms per query on night
   phonk v2, measured), so Strudel's 20 queries of 0.05 s per second spend most of the scheduler's time on overhead. ?sched=batch (or localStorage
   sc.flag.sched) queries 0.2 s windows instead (5 per second); the audio is scheduled 0.2 to 0.4 s ahead instead of 0.2 to 0.25 s.
   ?sched=strudel keeps Strudel's 0.05 s windows. */
const FLAG_SCHED = (() => { try { return new URLSearchParams(location.search).get('sched') || localStorage.getItem('sc.flag.sched') || 'strudel'; } catch (e) { return 'strudel'; } })();
const QSPAN = FLAG_SCHED === 'batch' ? 0.2 : DURATION;
/* late windows: ?late=reanchor (default) moves the clock so the first onset keeps LATE_GUARD of margin; ?late=drop is Strudel's behaviour (superdough drops them) */
const FLAG_LATE = (() => { try { return new URLSearchParams(location.search).get('late') || localStorage.getItem('sc.flag.late') || 'reanchor'; } catch (e) { return 'reanchor'; } })();
/* Phone-trial candidates (#180 follow-up), each its own flag (URL or localStorage sc.flag.<name>), all off by default, no UI. They change nothing in Strudel: the AudioContext constructor is
   wrapped before Strudel creates its context, the rest uses documented Web APIs.
   ?hint=playback|<seconds>  AudioContext latencyHint (Strudel's own context is opened with the default "interactive": the smallest output buffer, 10 ms base latency)
   ?session=playback         navigator.audioSession.type (Safari 16.4+: a playback session keeps audio running when the app is backgrounded or the ringer switch is on)
   ?lookahead=<seconds>      foreground schedule-ahead (page clock 0.2 s, bounded 0.2..1; engine Worker 0.6 s)
   ?scrollla=on              while the page scrolls or is touched, schedule as far ahead as when hidden (1 s)
   ?poly=<n>                 cap on simultaneous voices (superdough setMaxPolyphony)
   ?persist=1                keep the flags of this URL in localStorage (an installed app starts without a query); ?persist=clear removes them */
/* ?persist=1 stores every trial flag named in this URL in localStorage (sc.flag.<name>), so an installed app, which starts from "./" without a query, keeps them; ?persist=clear removes them all */
try { const u = new URLSearchParams(location.search), P = u.get('persist'), NAMES = ['engine', 'resync', 'hint', 'session', 'lookahead', 'scrollla', 'poly', 'sched', 'late', 'vis'];
  if (P === 'clear') for (const k of NAMES) localStorage.removeItem('sc.flag.' + k); else if (P) for (const k of NAMES) if (u.has(k)) localStorage.setItem('sc.flag.' + k, u.get(k)); } catch (e) { /* private mode */ }
const qflag = (k) => { try { return new URLSearchParams(location.search).get(k) || localStorage.getItem('sc.flag.' + k) || ''; } catch (e) { return ''; } };
const FLAG_HINT = qflag('hint'), FLAG_SESSION = qflag('session'), FLAG_LA = +qflag('lookahead') || 0, FLAG_SCROLLLA = qflag('scrollla') === 'on', FLAG_POLY = +qflag('poly') || 0;
if (FLAG_LA > 0) LOOKAHEAD.base = Math.min(1, Math.max(0.2, FLAG_LA));
if (FLAG_HINT && window.AudioContext && !window.AudioContext.__scHint) { const AC = window.AudioContext, hint = isNaN(+FLAG_HINT) ? FLAG_HINT : +FLAG_HINT; window.AudioContext = class extends AC { constructor(o) { super({ ...(o || {}), latencyHint: hint }); } }; window.AudioContext.__scHint = hint; }
let scrollAt = 0; const scrolling = () => FLAG_SCROLLLA && performance.now() - scrollAt < 1000;
if (FLAG_SCROLLLA) for (const ev of ['scroll', 'touchmove', 'wheel']) addEventListener(ev, () => { scrollAt = performance.now(); }, { capture: true, passive: true });
function playFlags() { try { if (FLAG_SESSION && navigator.audioSession) navigator.audioSession.type = FLAG_SESSION; } catch (e) { /* unsupported */ } try { if (FLAG_POLY && window.setMaxPolyphony) window.setMaxPolyphony(FLAG_POLY); } catch (e) { /* not ready */ } }
const LATE_GUARD = 0.015;
export const POLICIES = {
  continue: 'Continue in background if audio is running; pause cleanly if the OS suspends it',
  pause: 'Pause when the app is hidden; resume on return',
};
const fmt = (s) => N.clock(Math.max(0, s));

/* ---------- worker timer ---------- */
function workerTimer(ms, fn) {
  let w = null, id = 0;
  try {
    const src = 'let t=0;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
  } catch (e) { w = null; }
  return {
    kind: w ? 'worker' : 'main',
    start() { if (w) w.postMessage(ms); else { clearInterval(id); id = setInterval(fn, ms); } },
    stop() { if (w) w.postMessage(0); else clearInterval(id); },
  };
}

/* ---------- state ---------- */
const B = {
  installed: false, clockKind: 'strudel', policy: lsGet('bg.policy', 'continue'), wake: lsGet('bg.wake', true),
  lookahead: LOOKAHEAD.base, boost: 0, lastWall: 0, lastT: 0, lastLate: 0,
  stats: { ticks: 0, lateTicks: 0, maxGapMs: 0, underruns: 0, haps: 0 },
  played: 0, paused: 0, segs: [], log: [], trace: null, seg: null, playing: false, wakeLock: null,
};
const now = () => performance.now();
/* scheduler cost counters (docs/AUDIO_ENGINE.md): query and voice-construction time on the main thread, late haps (target already past: superdough drops them),
   tight haps (< 20 ms margin), the smallest margin seen. Reset on Play. */
/* voices in flight, estimated from events: each triggered hap counts until its end + 0.25 s (release tails); superdough's own pool is not reachable */
const VF = []; const inFlight = () => { const c = ctx(); if (!c) return 0; const t = c.currentTime; let n = 0; for (let i = VF.length - 1; i >= 0; i--) if (VF[i] > t) n++; return n; };
/* main-thread long tasks while playing (PerformanceObserver 'longtask'): count and worst, reset on Play */
const LT = { n: 0, worst: 0, total: 0 }; try { new PerformanceObserver((l) => { if (!B.playing) return; for (const e of l.getEntries()) { LT.n++; LT.total += e.duration; if (e.duration > LT.worst) LT.worst = e.duration; } }).observe({ type: 'longtask' }); } catch (e) { LT.na = true; }
const PF = {}; function resetPerf() { VF.length = 0; Object.assign(LT, { n: 0, worst: 0, total: 0 }); Object.assign(PF, { tickMs: 0, tickMax: 0, queryMs: 0, queryMax: 0, voiceMs: 0, voiceMax: 0, late: 0, tight: 0, haps: 0, rescued: 0, skipped: 0, minMargin: Infinity }); } resetPerf();
const ctx = () => { try { return window.getAudioContext ? window.getAudioContext() : null; } catch (e) { return null; } };
const sched = () => { const s = sc.engineState && sc.engineState(); return s && s.scheduler; };
const cycleNow = () => { const s = sched(); try { return s && s.started ? +s.now().toFixed(3) : (s ? +(+s.lastEnd || 0).toFixed(3) : 0); } catch (e) { return 0; } };
function note(type, detail) { B.log.push({ type, wall: Date.now(), audio: ctx() ? +ctx().currentTime.toFixed(3) : null, ...(detail || {}) }); if (B.log.length > 60) B.log.shift(); }

/* segment timeline: running | hidden-running | paused | interrupted, each with the cycle and audio-clock time where it began */
function kindNow() {
  const c = ctx(); if (!B.playing) return null;
  if (!c || c.state === 'closed' || c.state === 'interrupted') return 'interrupted';
  if (c.state !== 'running' || B.frozen) return 'paused';
  return document.hidden ? 'hidden-running' : 'running';
}
function segment(why, kind = kindNow()) {
  const t = now(), cur = B.seg;
  if (cur && cur.kind === kind) return;
  if (cur) { cur.ms = Math.round(t - cur.t0); if (cur.kind === 'paused' || cur.kind === 'interrupted') B.paused += cur.ms / 1000; }
  const was = cur && cur.kind;
  if (!kind) { B.seg = null; return; }
  const c = ctx();
  B.seg = { kind, why, t0: t, wall: Date.now(), audio: c ? +c.currentTime.toFixed(3) : null, cycle: cycleNow() };
  B.segs.push(B.seg); if (B.segs.length > 200) B.segs.shift();
  if ((was === 'paused' || was === 'interrupted') && (kind === 'running' || kind === 'hidden-running') && cur.ms >= 1000) {
    sc.ui && sc.ui.toast(`Resumed at cycle ${Math.floor(B.seg.cycle)}, paused ${fmt(cur.ms / 1000)}`, { kind: 'info' });
  }
  window.dispatchEvent(new CustomEvent('bg:segment', { detail: { ...B.seg } }));
}
/* a gap the clock had to re-anchor over: a closed paused segment of that length */
function gapSegment(sec, why) {
  const c = ctx(), t = now();
  if (B.seg) { B.seg.ms = Math.round(t - B.seg.t0 - sec * 1000); }
  const g = { kind: 'paused', why, t0: t - sec * 1000, wall: Date.now() - sec * 1000, audio: c ? +(c.currentTime - sec).toFixed(3) : null, cycle: cycleNow(), ms: Math.round(sec * 1000) };
  B.segs.push(g); B.paused += sec;
  B.seg = null; segment('resumed after ' + why);
  if (sec >= 1) sc.ui && sc.ui.toast(`Resumed at cycle ${Math.floor(g.cycle)}, paused ${fmt(sec)}`, { kind: 'info' });
}

/* ---------- the clock (mirror of Strudel 1.3.0 Cyclist's tick, ticked from a worker, adaptive window, re-anchor instead of skip) ---------- */
function makeClock(S, getTime, onTrigger, latency) {
  let tick = 0, phase = 0;
  const logErr = (e) => { try { (window.errorLogger || console.warn)(e); } catch (x) { /* ignore */ } };
  let shift = 0; /* seconds the clock moved forward while re-anchoring late windows inside this tick */
  const cb = (ph, dur) => {
    if (S.num_ticks_since_cps_change === 0) { S.num_cycles_at_cps_change = S.lastEnd; S.seconds_at_cps_change = ph; }
    S.num_ticks_since_cps_change++;
    const P = (ph + dur - S.seconds_at_cps_change) * S.cps; /* = ticks * dur * cps for a constant dur (Strudel's form); exact for batched windows too */
    try {
      const A = S.lastEnd; S.lastBegin = A;
      const x = S.num_cycles_at_cps_change + P; S.lastEnd = x; S.lastTick = ph;
      const q0 = now(); const hs = S.pattern.queryArc(A, x, { _cps: S.cps, cyclist: 'cyclist' }); const q1 = now(); PF.queryMs += q1 - q0; if (q1 - q0 > PF.queryMax) PF.queryMax = q1 - q0;
      /* a late window is re-anchored, not dropped (flag late=reanchor, default): when the window's first onset would already be in the past (the query
         or a stall ate the margin), the clock moves by that much (the musical position pauses, as after an underrun) and every hap keeps its place
         relative to the others; superdough would otherwise drop each late voice, a hole in the rhythm and in every bus reader */
      if (FLAG_LATE === 'reanchor') { let first = Infinity; for (const h of hs) if (h.hasOnset()) { const tg = (h.whole.begin - S.num_cycles_at_cps_change) / S.cps + S.seconds_at_cps_change + latency; if (tg < first) first = tg; }
        const nowT = getTime(); if (first < nowT + LATE_GUARD) { const dl = nowT + LATE_GUARD - first; S.seconds_at_cps_change += dl; S.lastTick = ph + dl; shift += dl; PF.rescued++; B.stats.underruns++; note('reanchor-late', { shift: +dl.toFixed(3), cycle: +(+A).toFixed(3) }); if (dl > 0.02) gapSegment(dl, 'late window re-anchored'); } }
      hs.forEach((h) => {
        if (!h.hasOnset()) return;
        const target = (h.whole.begin - S.num_cycles_at_cps_change) / S.cps + S.seconds_at_cps_change + latency;
        const d = h.duration / S.cps;
        B.stats.haps++; if (B.trace) { let jv = ''; try { jv = JSON.stringify(h.value); } catch (e) { /* unserialisable */ } B.trace.push([+h.whole.begin, +target.toFixed(5), jv]); if (B.trace.length > 20000) B.trace.shift(); }
        /* late-hap accounting: superdough 1.3.0 drops a voice whose target is already in the past ("cannot schedule sounds in the past") */
        PF.haps++; const m = target - getTime(); if (m < 0) PF.late++; else if (m < 0.02) PF.tight++; if (m < PF.minMargin) PF.minMargin = m;
        VF.push(target + d + 0.25); if (VF.length > 4096) VF.splice(0, 2048);
        const v0 = now(); const pr = onTrigger(h, target - ph, d, S.cps, target); const dv = now() - v0; PF.voiceMs += dv; if (dv > PF.voiceMax) PF.voiceMax = dv;
        /* superdough checks the time again after awaiting the sound (samples, vox): a voice whose target passed meanwhile is skipped silently
           ("skip hap: still loading"); when the trigger settles after its target, count it as skipped */
        if (pr && typeof pr.then === 'function') pr.then(() => { if (getTime() > target) PF.skipped++; }, () => {});
        if (h.value.cps !== undefined && S.cps != h.value.cps) { S.cps = h.value.cps; S.num_ticks_since_cps_change = 0; }
      });
    } catch (e) { logErr(e); }
  };
  /* ticks arrive from a worker: a message posted before stop()/pause() is still queued on the main thread when stop() returns (a busy page, CPU
     throttle), so a stopped clock must ignore it. A ghost tick after Cyclist.stop() (lastEnd = 0, stale cycle origin and tick count) queried [0, old position),
     found every hap "late" and re-anchored the clock by that many seconds (the next run read cycle -6..-118), or wrote lastEnd back to the old cycle (the next run
     began there). `running` is set by start() and cleared by stop()/pause(). */
  let running = false;
  const onTick = () => { if (!running) return; const w0 = now(); try { onTick0(); } finally { const dt = now() - w0; PF.tickMs += dt; if (dt > PF.tickMax) PF.tickMax = dt; } };
  const onTick0 = () => {
    const t = getTime(), w = now();
    B.stats.ticks++;
    if (B.lastWall) { const gap = (w - B.lastWall) / 1000; if (gap * 1000 > B.stats.maxGapMs) B.stats.maxGapMs = Math.round(gap * 1000); if (gap > LATE_GAP) { B.stats.lateTicks++; B.lastLate = w; B.boost = Math.min(LOOKAHEAD.max, Math.max(B.boost, gap * 1.5 + 0.1)); } }
    B.lastWall = w;
    /* window: Strudel's 0.2 s in the foreground; >= 1 s hidden; raised by late ticks; bounded; decays after 5 s of on-time ticks */
    if (!document.hidden && w - B.lastLate > 5000) B.boost = Math.max(0, B.boost * 0.97 - 0.002);
    B.lookahead = Math.min(LOOKAHEAD.max, Math.max(LOOKAHEAD.base, document.hidden || scrolling() ? LOOKAHEAD.hidden : 0, B.boost));
    if (phase === 0) phase = t + MIN_LATENCY;
    if (phase < t) { /* the window ran dry (frozen page, a stall beyond the lookahead): same cycle, from now; no catch-up, no skipped cycles */
      const gap = t - phase; B.stats.underruns++; if (B.lastT && phase > B.lastT) B.played += phase - B.lastT; B.lastT = t; /* played only up to where the scheduled audio ran out */ note('reanchor', { gap: +gap.toFixed(3), cycle: +(+S.lastEnd).toFixed(3) });
      phase = t + MIN_LATENCY; S.num_ticks_since_cps_change = 0;
      if (B.resumedAt && now() - B.resumedAt < 3000) B.resumedAt = 0; /* freeze/resume already recorded this pause */ else gapSegment(gap, 'audio clock ran past the lookahead');
    }
    const c = ctx(); if (c && c.state === 'running' && B.lastT && t > B.lastT) B.played += Math.min(t - B.lastT, LOOKAHEAD.max + 0.5);
    B.lastT = t;
    while (phase < t + B.lookahead) { phase = Math.round(phase * PRECISION) / PRECISION; shift = 0; cb(phase, QSPAN); phase += QSPAN + shift; tick++; }
  };
  const timer = workerTimer(TICK_MS, onTick);
  B.clockKind = timer.kind === 'worker' ? 'worker' : 'main-thread (no Worker)';
  return {
    setDuration: () => DURATION, get duration() { return DURATION; }, interval: TICK_MS / 1000, minLatency: MIN_LATENCY, getPhase: () => phase,
    start() { resetPerf(); timer.stop(); B.lastWall = 0; B.lastT = 0; B.played = 0; B.paused = 0; B.boost = 0; running = true; onTick(); timer.start(); },
    pause() { running = false; timer.stop(); },
    stop() { running = false; tick = 0; phase = 0; timer.stop(); },
  };
}
/* engine Worker (#180 stage 1, flag): ?engine=worker or localStorage sc.flag.engine. Off by default; the page-thread clock above is the fallback and the default. */
const FLAG_ENGINE = (() => { try { return new URLSearchParams(location.search).get('engine') || localStorage.getItem('sc.flag.engine') || 'page'; } catch (e) { return 'page'; } })();
async function attachWorker(S, repl) {
  const m = await import('./engine-worker-host.js');
  const ctl = { fire: () => B.fire, note, scrolling, laFg: FLAG_LA > 0 ? FLAG_LA : 0.6, stats: B.stats, skipped: () => { PF.skipped++; },
    account(target, d, hap) { const m0 = target - ctl.time(); B.stats.haps++; PF.haps++; if (m0 < 0) PF.late++; else if (m0 < 0.02) PF.tight++; if (m0 < PF.minMargin) PF.minMargin = m0; VF.push(target + d + 0.25); if (VF.length > 4096) VF.splice(0, 2048); if (B.trace) { let jv = ''; try { jv = JSON.stringify(hap.v); } catch (e) { /* unserialisable */ } B.trace.push([hap.wb, +target.toFixed(5), jv]); } }, time: () => window.getAudioContext().currentTime };
  const h = await m.attach({ S, repl, base: S.clock, getTime: ctl.time, ctl, flags: { blank: sc.blankComments } });
  B.worker = h; B.clockKind = 'engine worker (events published 0.6 s ahead, 2 s hidden)'; note('engine-worker-attached');
}
function install(S, repl) {
  if (!S || S.__scBg || new URLSearchParams(location.search).get('bgclock') === 'off') return false;
  const getTime = () => window.getAudioContext().currentTime;
  if (typeof window.getTrigger !== 'function' || typeof window.webaudioOutput !== 'function' || !('num_ticks_since_cps_change' in S) || !S.clock) { note('install-skipped', { why: 'Strudel internals not found' }); return false; }
  const onTrigger = window.getTrigger({ defaultOutput: window.webaudioOutput, getTime });
  const wasStarted = S.started; if (wasStarted) S.clock.pause();
  S.__scBg = { strudelClock: S.clock }; S.clock = makeClock(S, getTime, onTrigger, S.latency != null ? S.latency : 0.1);
  if (wasStarted) S.clock.start();
  B.fire = { onTrigger, getTime, latency: S.latency != null ? S.latency : 0.1 };
  B.installed = true; note('install', { clock: B.clockKind });
  if (FLAG_ENGINE === 'worker' && repl && !wasStarted) attachWorker(S, repl).catch((e) => { note('engine-worker-failed', { why: e.message }); console.warn('engine worker: ' + e.message + ' (page-thread engine stays)'); });
  return true;
}

/* Immediate catch-up (#119): the scheduler has already queried and scheduled everything up to S.lastEnd (about 0.25 s of music ahead of the
   sound it is about to make), so a hap caused by a live press (a Perform tap pad read by the program) would only sound ~0.3 s later. The
   caller has written the press into the journal; this queries [from, lastEnd) once (flagged like a scheduler query, so lane captures see it)
   and triggers the onset haps the filter accepts: a hap that starts at the press (`atPress`) at now + lead, any other at its normal time (never
   earlier than now + lead). The scheduler's own next window starts at lastEnd, where these haps have no onset, so nothing sounds twice. */
function catchUp(from, accept, o = {}) {
  const S = sched(), F = B.fire; if (!S || !S.started || !F || !B.installed) return { fired: 0, reason: 'not running' };
  const t = F.getTime(), lead = o.lead != null ? o.lead : 0.03; const A = +from; let x = +S.lastEnd; if (!(x > A)) x = A + 1e-4;
  const hs = S.pattern.queryArc(A, x, { _cps: S.cps, cyclist: 'cyclist' }).filter((h) => h.hasOnset() && accept(h));
  const out = [];
  for (const h of hs) {
    const natural = (h.whole.begin - S.num_cycles_at_cps_change) / S.cps + S.seconds_at_cps_change + F.latency;
    const at = o.atPress && o.atPress(h) ? t + lead : Math.max(natural, t + lead);
    const d = h.duration / S.cps; B.stats.haps++; if (B.trace) B.trace.push([+h.whole.begin, +at.toFixed(5)]);
    VF.push(at + d + 0.25); if (VF.length > 4096) VF.splice(0, 2048);
    try { const pr = F.onTrigger(h, at - t, d, S.cps, at); if (pr && typeof pr.catch === 'function') pr.catch(() => {}); } catch (e) { (window.errorLogger || console.warn)(e); }
    out.push({ cycle: +h.whole.begin, in: +(at - t).toFixed(4) });
  }
  return { fired: out.length, haps: out, horizon: x, at: t };
}

/* ---------- transport hooks (app.js calls these) ---------- */
async function wake(on) {
  try {
    if (on && B.wake && !document.hidden && 'wakeLock' in navigator) { if (!B.wakeLock) { B.wakeLock = await navigator.wakeLock.request('screen'); B.wakeLock.addEventListener('release', () => { B.wakeLock = null; }); } }
    else if (B.wakeLock) { const l = B.wakeLock; B.wakeLock = null; await l.release(); }
  } catch (e) { B.wakeLock = null; note('wakelock-refused', { why: e.message }); }
}
function media(title) {
  const ms = navigator.mediaSession; if (!ms) return;
  try {
    if (title != null && typeof MediaMetadata !== 'undefined') ms.metadata = new MediaMetadata({ title: title || 'Strudel Craft', artist: 'Strudel Craft', album: 'Live pattern', artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    ms.playbackState = B.playing ? 'playing' : 'paused';
    if (!media.bound) {
      media.bound = true; const T = () => sc.transport;
      ms.setActionHandler('play', () => { if (T() && !T().playing) T().play(); });
      ms.setActionHandler('pause', () => { if (T() && T().playing) T().stop(); });
      try { ms.setActionHandler('stop', () => { if (T() && T().playing) T().stop(); }); } catch (e) { /* older engines */ }
    }
  } catch (e) { /* Media Session is optional */ }
}
function onPlay(title) { playFlags(); B.playing = true; B.seg = null; B.segs = []; B.frozen = false; segment('play'); wake(true); media(title); note('play', { title }); }
function onStop() { B.playing = false; segment('stop', null); wake(false); media(); note('stop'); }

/* ---------- lifecycle tracking + policy ---------- */
let bound = false;
function bindLifecycle() {
  if (bound) return; bound = true;
  document.addEventListener('visibilitychange', async () => {
    note(document.hidden ? 'hidden' : 'visible');
    const c = ctx();
    if (B.playing && B.policy === 'pause' && c) {
      if (document.hidden && c.state === 'running') { B.policyPaused = true; try { await c.suspend(); } catch (e) { /* ignore */ } }
      else if (!document.hidden && B.policyPaused) { B.policyPaused = false; try { await c.resume(); } catch (e) { /* the audio dot offers Enable audio */ } }
    }
    if (!document.hidden && B.playing) wake(true);
    segment(document.hidden ? 'hidden' : 'visible');
  });
  for (const ev of ['pagehide', 'pageshow', 'blur', 'focus']) window.addEventListener(ev, (e) => note(ev, ev.startsWith('page') ? { persisted: !!e.persisted } : null));
  document.addEventListener('freeze', () => { B.frozen = true; note('freeze'); segment('freeze'); });
  document.addEventListener('resume', () => { B.frozen = false; B.resumedAt = now(); note('resume'); segment('resume'); });
  const watchCtx = () => { const c = ctx(); if (!c || c.__scBgWatch) return; c.__scBgWatch = true; c.addEventListener('statechange', () => { note('ctx-' + c.state); segment('audio ' + c.state); }); };
  window.addEventListener('strudel:ready', watchCtx); setInterval(watchCtx, 2000);
}

/* ---------- diagnostics + settings ---------- */
function stats() {
  const c = ctx();
  return { clock: B.installed ? B.clockKind : 'strudel (main-thread setInterval, fixed 0.2 s)', engine: FLAG_ENGINE, policy: B.policy, wakeLock: !!B.wakeLock, context: c ? c.state : 'none',
    lookaheadMs: Math.round(B.lookahead * 1000), lookaheadBounds: { baseMs: LOOKAHEAD.base * 1000, hiddenMs: LOOKAHEAD.hidden * 1000, maxMs: LOOKAHEAD.max * 1000 },
    ...B.stats, underrunEstimate: B.stats.underruns, playedSec: +B.played.toFixed(2), pausedSec: +(B.paused + (B.seg && (B.seg.kind === 'paused' || B.seg.kind === 'interrupted') ? (now() - B.seg.t0) / 1000 : 0)).toFixed(2),
    segment: B.seg ? B.seg.kind : null,
    sched: FLAG_SCHED, late: FLAG_LATE, querySpanMs: Math.round(QSPAN * 1000), engineMode: B.worker ? B.worker.state().mode : 'page', engineWorkerAttached: !!B.worker, flags: { hint: FLAG_HINT || null, session: FLAG_SESSION || null, lookahead: FLAG_LA || null, scrollla: FLAG_SCROLLLA, poly: FLAG_POLY || null },
    audio: c ? { sampleRate: c.sampleRate, baseLatencyMs: Math.round((c.baseLatency || 0) * 1000), outputLatencyMs: Math.round((c.outputLatency || 0) * 1000), hint: (window.AudioContext && window.AudioContext.__scHint) || 'interactive (default)' } : null,
    perf: { tickMs: Math.round(PF.tickMs), tickMaxMs: +PF.tickMax.toFixed(1), queryMs: Math.round(PF.queryMs), queryMaxMs: +PF.queryMax.toFixed(1), voiceMs: Math.round(PF.voiceMs), voiceMaxMs: +PF.voiceMax.toFixed(1),
      voicesInFlight: inFlight(), longTasks: LT.na ? null : LT.n, longTaskWorstMs: Math.round(LT.worst), longTaskMs: Math.round(LT.total),
      haps: PF.haps, voiceMsPerHap: PF.haps ? +(PF.voiceMs / PF.haps).toFixed(3) : 0, lateHaps: PF.late, skippedHaps: PF.skipped, tightHaps: PF.tight, rescuedWindows: PF.rescued, minMarginMs: PF.minMargin === Infinity ? null : Math.round(PF.minMargin * 1000) } };
}
function segments() { const t = now(); return B.segs.map((s) => ({ kind: s.kind, why: s.why, cycle: s.cycle, audio: s.audio, wall: s.wall, ms: s.ms != null ? s.ms : Math.round(t - s.t0) })); }
/* gaps between two audio-clock times (for capture takes): paused / interrupted segments that overlap [a, b] */
function gapsBetween(a, b) { return segments().filter((s) => (s.kind === 'paused' || s.kind === 'interrupted') && s.audio != null && s.audio + s.ms / 1000 >= a && s.audio <= b).map((s) => ({ kind: s.kind, cycle: s.cycle, audio: s.audio, seconds: +(s.ms / 1000).toFixed(3), why: s.why })); }
function setPolicy(p) { if (!POLICIES[p]) throw new Error('unknown policy ' + p); B.policy = p; lsSet('bg.policy', p); note('policy', { policy: p }); }
function setWake(on) { B.wake = !!on; lsSet('bg.wake', B.wake); wake(B.playing && B.wake); }

/* engine flags (docs/AUDIO_ENGINE.md): persisted in localStorage sc.flag.*, read at load, so a change applies after a reload */
export const FLAGS = { sched: { label: 'Scheduler query windows', opts: { strudel: 'Strudel 0.05 s', batch: 'Batched 0.2 s' } }, late: { label: 'Late windows', opts: { reanchor: 'Re-anchor the clock', drop: 'Drop late events (Strudel)' } }, vis: { label: 'Visuals and highlights', opts: { cache: 'Cached per cycle', requery: 'Re-query every frame' } }, engine: { label: 'Audio engine (experimental)', opts: { page: 'Page thread', worker: 'Engine Worker (stage 1)' } } };
const flagNow = (k) => (k === 'sched' ? FLAG_SCHED : k === 'late' ? FLAG_LATE : k === 'engine' ? FLAG_ENGINE : (sc.visuals && sc.visuals.flag) || 'cache');
function flagsHtml() { return `<section class="bg-set" aria-labelledby="bgFlagH"><h3 id="bgFlagH">Engine (applies after reload)</h3>${Object.entries(FLAGS).map(([k, f]) => `<label class="bg-row"><span>${f.label}</span><select data-flag="${k}">${Object.entries(f.opts).map(([v, t]) => `<option value="${v}"${v === flagNow(k) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}</section>`; }
function settingsHtml() {
  return flagsHtml() + `<section class="bg-set" aria-labelledby="bgSetH"><h3 id="bgSetH">Background playback</h3>
    <label class="bg-row"><span>When the app is hidden</span><select id="bgPolicy">${Object.entries(POLICIES).map(([k, v]) => `<option value="${k}"${k === B.policy ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="bg-row bg-check"><input type="checkbox" id="bgWake"${B.wake ? ' checked' : ''}> <span>Keep the screen on while playing (foreground)</span></label></section>`;
}
function bindSettings(root) {
  const p = $('#bgPolicy', root), w = $('#bgWake', root);
  if (p) p.onchange = () => { setPolicy(p.value); sc.ui && sc.ui.toast('Background: ' + POLICIES[p.value], { kind: 'ok' }); };
  if (w) w.onchange = () => setWake(w.checked);
  for (const sel of (root || document).querySelectorAll('select[data-flag]')) sel.onchange = () => { try { localStorage.setItem('sc.flag.' + sel.dataset.flag, sel.value); } catch (e) { /* private mode */ } sc.ui && sc.ui.toast(FLAGS[sel.dataset.flag].label + ': ' + FLAGS[sel.dataset.flag].opts[sel.value] + ' after reload', { kind: 'info' }); };
}
function addHelpSettings() { const h = $('#help'); if (!h || $('#help .bg-set')) return; const d = document.createElement('div'); d.innerHTML = settingsHtml(); const keys = $('#keys', h); const at = keys ? keys.nextSibling : null; for (const el of [...d.children]) (keys ? keys.parentNode : h).insertBefore(el, at); bindSettings(h); }
function openDiagnostics() {
  let d = $('#bgDiag');
  if (!d) { d = document.createElement('dialog'); d.id = 'bgDiag'; d.className = 'bg-diag'; d.setAttribute('aria-labelledby', 'bgDiagH'); document.body.append(d); d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('.bg-close')) d.close(); }); }
  const render = () => {
    const s = stats(), segs = segments().slice(-12).reverse();
    d.innerHTML = `<div class="help-head"><h2 id="bgDiagH">Audio and background</h2><button type="button" class="icon bg-close" aria-label="Close">&times;</button></div>
      <dl class="bg-stats">${[['Clock', s.clock], ['Audio context', s.context], ['Lookahead in use', N.span(N.ms(s.lookaheadMs), 7) + ' ms (' + N.span(N.ms(s.lookaheadBounds.baseMs), 7) + ' foreground, ' + N.span(N.ms(s.lookaheadBounds.hiddenMs), 7) + ' hidden, max ' + N.span(N.ms(s.lookaheadBounds.maxMs), 7) + ')'],
        ['Ticks / late ticks', N.span(s.ticks, 8) + ' / ' + N.span(s.lateTicks, 6)], ['Max tick gap', N.span(N.ms(s.maxGapMs), 7) + ' ms'], ['Underruns (re-anchored)', N.span(s.underruns, 6)], ['Engine', s.engineWorkerAttached ? 'engine Worker, now on the ' + s.engineMode + ' clock' : 'page thread (' + s.clock + ', flag ' + s.engine + ')'], ['Output', s.audio ? s.audio.sampleRate + ' Hz, latency hint ' + s.audio.hint + ', base ' + s.audio.baseLatencyMs + ' ms, output ' + s.audio.outputLatencyMs + ' ms' : 'no context'], ['Trial flags', Object.entries(s.flags).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join(', ') || 'none'], ['Long tasks / worst', (s.perf.longTasks == null ? 'n/a' : N.span(s.perf.longTasks, 6)) + ' / ' + N.span(N.ms(s.perf.longTaskWorstMs), 6) + ' ms'],
        ['Late haps (dropped) / skipped / tight', N.span(s.perf.lateHaps, 6) + ' / ' + N.span(s.perf.skippedHaps, 6) + ' / ' + N.span(s.perf.tightHaps, 6)], ['Voices in flight', N.span(s.perf.voicesInFlight, 5)], ['Query / voice time', N.span(N.ms(s.perf.queryMs), 7) + ' / ' + N.span(N.ms(s.perf.voiceMs), 7) + ' ms'], ['Played / paused', N.span(fmt(s.playedSec), 7) + ' / ' + N.span(fmt(s.pausedSec), 7)], ['Wake lock', s.wakeLock ? 'held' : 'off']]
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <h3>Segments</h3><ol class="bg-segs">${segs.length ? segs.map((g) => `<li data-kind="${g.kind}"><b>${g.kind}</b> c ${N.span(N.cyc(+g.cycle), 6)} · ${N.span(fmt(g.ms / 1000), 7)} <span>${g.why || ''}</span></li>`).join('') : '<li>Nothing yet: press Play</li>'}</ol>
      ${settingsHtml()}`;
    bindSettings(d);
  };
  render(); if (!d.open) d.showModal(); clearInterval(d._t); d._t = setInterval(() => { if (!d.open) return clearInterval(d._t); if (!d.contains(document.activeElement) || document.activeElement === d) render(); }, 1000);
}

bindLifecycle();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addHelpSettings); else addHelpSettings();
sc.bg = { install, catchUp, cycleHaps: (c) => (B.worker ? B.worker.cycleHaps(c) : undefined), engine: () => ({ flag: FLAG_ENGINE, worker: B.worker ? B.worker.state() : null }), onPlay, onStop, stats, segments, gapsBetween, events: () => B.log.slice(), setPolicy, setWake, openDiagnostics, POLICIES, LOOKAHEAD,
  get installed() { return B.installed; }, get played() { return B.played; }, get paused() { return stats().pausedSec; }, get policy() { return B.policy; },
  set trace(on) { B.trace = on ? [] : null; }, get trace() { return B.trace; } };
