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
  const cb = (ph, dur) => {
    if (S.num_ticks_since_cps_change === 0) { S.num_cycles_at_cps_change = S.lastEnd; S.seconds_at_cps_change = ph; }
    S.num_ticks_since_cps_change++;
    const P = S.num_ticks_since_cps_change * dur * S.cps;
    try {
      const A = S.lastEnd; S.lastBegin = A;
      const x = S.num_cycles_at_cps_change + P; S.lastEnd = x; S.lastTick = ph;
      S.pattern.queryArc(A, x, { _cps: S.cps, cyclist: 'cyclist' }).forEach((h) => {
        if (!h.hasOnset()) return;
        const target = (h.whole.begin - S.num_cycles_at_cps_change) / S.cps + S.seconds_at_cps_change + latency;
        const d = h.duration / S.cps;
        B.stats.haps++; if (B.trace) { B.trace.push([+h.whole.begin, +target.toFixed(5)]); if (B.trace.length > 20000) B.trace.shift(); }
        onTrigger(h, target - ph, d, S.cps, target);
        if (h.value.cps !== undefined && S.cps != h.value.cps) { S.cps = h.value.cps; S.num_ticks_since_cps_change = 0; }
      });
    } catch (e) { logErr(e); }
  };
  const onTick = () => {
    const t = getTime(), w = now();
    B.stats.ticks++;
    if (B.lastWall) { const gap = (w - B.lastWall) / 1000; if (gap * 1000 > B.stats.maxGapMs) B.stats.maxGapMs = Math.round(gap * 1000); if (gap > LATE_GAP) { B.stats.lateTicks++; B.lastLate = w; B.boost = Math.min(LOOKAHEAD.max, Math.max(B.boost, gap * 1.5 + 0.1)); } }
    B.lastWall = w;
    /* window: Strudel's 0.2 s in the foreground; >= 1 s hidden; raised by late ticks; bounded; decays after 5 s of on-time ticks */
    if (!document.hidden && w - B.lastLate > 5000) B.boost = Math.max(0, B.boost * 0.97 - 0.002);
    B.lookahead = Math.min(LOOKAHEAD.max, Math.max(LOOKAHEAD.base, document.hidden ? LOOKAHEAD.hidden : 0, B.boost));
    if (phase === 0) phase = t + MIN_LATENCY;
    if (phase < t) { /* the window ran dry (frozen page, a stall beyond the lookahead): same cycle, from now; no catch-up, no skipped cycles */
      const gap = t - phase; B.stats.underruns++; if (B.lastT && phase > B.lastT) B.played += phase - B.lastT; B.lastT = t; /* played only up to where the scheduled audio ran out */ note('reanchor', { gap: +gap.toFixed(3), cycle: +(+S.lastEnd).toFixed(3) });
      phase = t + MIN_LATENCY; S.num_ticks_since_cps_change = 0;
      if (B.resumedAt && now() - B.resumedAt < 3000) B.resumedAt = 0; /* freeze/resume already recorded this pause */ else gapSegment(gap, 'audio clock ran past the lookahead');
    }
    const c = ctx(); if (c && c.state === 'running' && B.lastT && t > B.lastT) B.played += Math.min(t - B.lastT, LOOKAHEAD.max + 0.5);
    B.lastT = t;
    while (phase < t + B.lookahead) { phase = Math.round(phase * PRECISION) / PRECISION; cb(phase, DURATION); phase += DURATION; tick++; }
  };
  const timer = workerTimer(TICK_MS, onTick);
  B.clockKind = timer.kind === 'worker' ? 'worker' : 'main-thread (no Worker)';
  return {
    setDuration: () => DURATION, get duration() { return DURATION; }, interval: TICK_MS / 1000, minLatency: MIN_LATENCY, getPhase: () => phase,
    start() { timer.stop(); B.lastWall = 0; B.lastT = 0; B.played = 0; B.paused = 0; B.boost = 0; onTick(); timer.start(); },
    pause() { timer.stop(); },
    stop() { tick = 0; phase = 0; timer.stop(); },
  };
}
function install(S) {
  if (!S || S.__scBg || new URLSearchParams(location.search).get('bgclock') === 'off') return false;
  const getTime = () => window.getAudioContext().currentTime;
  if (typeof window.getTrigger !== 'function' || typeof window.webaudioOutput !== 'function' || !('num_ticks_since_cps_change' in S) || !S.clock) { note('install-skipped', { why: 'Strudel internals not found' }); return false; }
  const onTrigger = window.getTrigger({ defaultOutput: window.webaudioOutput, getTime });
  const wasStarted = S.started; if (wasStarted) S.clock.pause();
  S.__scBg = { strudelClock: S.clock }; S.clock = makeClock(S, getTime, onTrigger, S.latency != null ? S.latency : 0.1);
  if (wasStarted) S.clock.start();
  B.installed = true; note('install', { clock: B.clockKind }); return true;
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
function onPlay(title) { B.playing = true; B.seg = null; B.segs = []; B.frozen = false; segment('play'); wake(true); media(title); note('play', { title }); }
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
  return { clock: B.installed ? B.clockKind : 'strudel (main-thread setInterval, fixed 0.2 s)', policy: B.policy, wakeLock: !!B.wakeLock, context: c ? c.state : 'none',
    lookaheadMs: Math.round(B.lookahead * 1000), lookaheadBounds: { baseMs: LOOKAHEAD.base * 1000, hiddenMs: LOOKAHEAD.hidden * 1000, maxMs: LOOKAHEAD.max * 1000 },
    ...B.stats, underrunEstimate: B.stats.underruns, playedSec: +B.played.toFixed(2), pausedSec: +(B.paused + (B.seg && (B.seg.kind === 'paused' || B.seg.kind === 'interrupted') ? (now() - B.seg.t0) / 1000 : 0)).toFixed(2),
    segment: B.seg ? B.seg.kind : null };
}
function segments() { const t = now(); return B.segs.map((s) => ({ kind: s.kind, why: s.why, cycle: s.cycle, audio: s.audio, wall: s.wall, ms: s.ms != null ? s.ms : Math.round(t - s.t0) })); }
/* gaps between two audio-clock times (for capture takes): paused / interrupted segments that overlap [a, b] */
function gapsBetween(a, b) { return segments().filter((s) => (s.kind === 'paused' || s.kind === 'interrupted') && s.audio != null && s.audio + s.ms / 1000 >= a && s.audio <= b).map((s) => ({ kind: s.kind, cycle: s.cycle, audio: s.audio, seconds: +(s.ms / 1000).toFixed(3), why: s.why })); }
function setPolicy(p) { if (!POLICIES[p]) throw new Error('unknown policy ' + p); B.policy = p; lsSet('bg.policy', p); note('policy', { policy: p }); }
function setWake(on) { B.wake = !!on; lsSet('bg.wake', B.wake); wake(B.playing && B.wake); }

function settingsHtml() {
  return `<section class="bg-set" aria-labelledby="bgSetH"><h3 id="bgSetH">Background playback</h3>
    <label class="bg-row"><span>When the app is hidden</span><select id="bgPolicy">${Object.entries(POLICIES).map(([k, v]) => `<option value="${k}"${k === B.policy ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="bg-row bg-check"><input type="checkbox" id="bgWake"${B.wake ? ' checked' : ''}> <span>Keep the screen on while playing (foreground)</span></label></section>`;
}
function bindSettings(root) {
  const p = $('#bgPolicy', root), w = $('#bgWake', root);
  if (p) p.onchange = () => { setPolicy(p.value); sc.ui && sc.ui.toast('Background: ' + POLICIES[p.value], { kind: 'ok' }); };
  if (w) w.onchange = () => setWake(w.checked);
}
function addHelpSettings() { const h = $('#help'); if (!h || $('#help .bg-set')) return; const d = document.createElement('div'); d.innerHTML = settingsHtml(); const keys = $('#keys', h); (keys ? keys.parentNode : h).insertBefore(d.firstElementChild, keys ? keys.nextSibling : null); bindSettings(h); }
function openDiagnostics() {
  let d = $('#bgDiag');
  if (!d) { d = document.createElement('dialog'); d.id = 'bgDiag'; d.className = 'bg-diag'; d.setAttribute('aria-labelledby', 'bgDiagH'); document.body.append(d); d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('.bg-close')) d.close(); }); }
  const render = () => {
    const s = stats(), segs = segments().slice(-12).reverse();
    d.innerHTML = `<div class="help-head"><h2 id="bgDiagH">Audio and background</h2><button type="button" class="icon bg-close" aria-label="Close">&times;</button></div>
      <dl class="bg-stats">${[['Clock', s.clock], ['Audio context', s.context], ['Lookahead in use', N.span(N.ms(s.lookaheadMs), 7) + ' ms (' + N.span(N.ms(s.lookaheadBounds.baseMs), 7) + ' foreground, ' + N.span(N.ms(s.lookaheadBounds.hiddenMs), 7) + ' hidden, max ' + N.span(N.ms(s.lookaheadBounds.maxMs), 7) + ')'],
        ['Ticks / late ticks', N.span(s.ticks, 8) + ' / ' + N.span(s.lateTicks, 6)], ['Max tick gap', N.span(N.ms(s.maxGapMs), 7) + ' ms'], ['Underruns (re-anchored)', N.span(s.underruns, 6)], ['Played / paused', N.span(fmt(s.playedSec), 7) + ' / ' + N.span(fmt(s.pausedSec), 7)], ['Wake lock', s.wakeLock ? 'held' : 'off']]
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <h3>Segments</h3><ol class="bg-segs">${segs.length ? segs.map((g) => `<li data-kind="${g.kind}"><b>${g.kind}</b> c ${N.span(N.cyc(+g.cycle), 6)} · ${N.span(fmt(g.ms / 1000), 7)} <span>${g.why || ''}</span></li>`).join('') : '<li>Nothing yet: press Play</li>'}</ol>
      ${settingsHtml()}`;
    bindSettings(d);
  };
  render(); if (!d.open) d.showModal(); clearInterval(d._t); d._t = setInterval(() => { if (!d.open) return clearInterval(d._t); if (!d.contains(document.activeElement) || document.activeElement === d) render(); }, 1000);
}

bindLifecycle();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addHelpSettings); else addHelpSettings();
sc.bg = { install, onPlay, onStop, stats, segments, gapsBetween, events: () => B.log.slice(), setPolicy, setWake, openDiagnostics, POLICIES, LOOKAHEAD,
  get installed() { return B.installed; }, get played() { return B.played; }, get paused() { return stats().pausedSec; }, get policy() { return B.policy; },
  set trace(on) { B.trace = on ? [] : null; }, get trace() { return B.trace; } };
