/* Transport range: cycle position slider with scrub, loop start/end (cycle or bar), and a play-time clamp.
   Clamp: total played time per run (audio-clock time while running, not wall time) is limited to sc.range.maxMin minutes (default 20); remaining, played and paused time shown;
   at the limit the master fades (or stops, per settings) and playback stops. "+5 min" overrides for this run.
   Needs window.strudelCraft.transport (app.js hook). API: window.strudelCraft.range = { state, setLimit, extend, tick } */
import { cyc, clock } from './numfmt.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const get = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const st = { unit: get('range.unit', 'cycle'), start: get('range.start', 0), end: get('range.end', 16), loop: get('range.loop', false),
  maxMin: get('range.maxMin', 20), atLimit: get('range.atLimit', 'fade'), elapsed: 0, extra: 0, fading: false, wasPlaying: false, last: 0 };
const fmt = (s) => clock(Math.max(0, s)); /* mm:ss, h:mm:ss from an hour: fixed digit count (numfmt.js) */
const limit = () => st.maxMin * 60 + st.extra;
const sch = () => { const s = sc.engineState && sc.engineState(); return s && s.scheduler; };
const playing = () => !!(sc.transport && sc.transport.playing);
/* cycles are canonical; time is derived from the live cps, so a tempo change re-converts every shown value */
const cps = () => { const s = sch(); return (s && s.cps) || (sc.transport && sc.transport.cps) || 0.5; };
const mmss = (sec) => clock(Math.max(0, sec));
const u = (c) => (st.unit === 'bar' ? cyc(c + 1) : st.unit === 'time' ? clock(Math.max(0, c / cps()), { tenths: true }) : cyc(c)); // bars are 1-based (1 cycle = 1 bar of 4 beats here)
/* accepts "1:30" (m:ss) or a number in the current unit (seconds when the unit is time) -> cycles, NaN if unreadable */
export function parsePos(v, unit = st.unit, k = cps()) {
  v = String(v).trim(); const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v); if (m) return (+m[1] * 60 + +m[2]) * k;
  const n = parseFloat(v.replace(/^c\s*/i, '')); if (!isFinite(n)) return NaN;
  return unit === 'bar' ? n - 1 : unit === 'time' ? n * k : n;
}
const fromU = (v) => parsePos(v);
let el = {};

function build() {
  /* #59: the markup ships in index.html so the stage has its final height at first paint (no layout shift); built here only if missing */
  const host = $('.stage'); let w = $('#trange'); if (!host || (w && w.dataset.bound)) return;
  if (!w) { w = document.createElement('div'); w.className = 'trange'; w.id = 'trange'; w.innerHTML = `<label class="sr" for="trPos">Position</label>
    <input id="trPos" class="tr-pos" type="range" min="0" max="16" step="0.01" value="0" aria-valuetext="cycle 0">
    <div class="tr-row">
      <button type="button" class="ghost tr-out" id="trOut" title="Go to a cycle or m:ss"><span class="tr-read" id="trPosTxt">c <span class="num" id="trC" style="--w:6ch">0.0</span><span class="tr-sep">/</span><span class="num" id="trCE" style="--w:6ch">16.0</span><span class="tr-sep">·</span><span class="num" id="trT" style="--w:7ch">00:00</span><span class="tr-sep">/</span><span class="num" id="trTE" style="--w:7ch">00:32</span></span></button>
      <button type="button" class="ghost tr-unit" id="trUnit" title="Loop points in cycles, bars or m:ss">cycle</button>
      <label class="tr-num"><span>Start</span><input id="trStart" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
      <label class="tr-num"><span>End</span><input id="trEnd" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
      <button type="button" class="ghost tr-loop" id="trLoop" aria-pressed="false" title="Loop between start and end">Loop</button>
      <span class="tr-left" id="trLeft" title="Remaining play time before the clamp"><span class="num" id="trL" style="--w:7ch">20:00</span> left<span class="tr-pp" id="trPP"> · played <span class="num" id="trPl" style="--w:7ch">00:00</span><span class="tr-pz" id="trPz"> · paused <span class="num" id="trPa" style="--w:7ch">00:00</span></span></span></span>
      <button type="button" class="ghost tr-more" id="trMore" hidden title="Extend the clamp by 5 minutes for this run">+5 min</button>
      <button type="button" class="icon tr-set" id="trSet" aria-label="Play-time limit settings" title="Play-time limit"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 13V9M10 3h4"/></svg></button>
    </div>`; host.append(w); }
  w.dataset.bound = '1';
  el = { pos: $('#trPos'), out: $('#trOut'), unit: $('#trUnit'), start: $('#trStart'), end: $('#trEnd'), loop: $('#trLoop'), left: $('#trLeft'), more: $('#trMore') };
  const sync = () => { el.unit.textContent = st.unit === 'time' ? 'm:ss' : st.unit; el.start.value = u(st.start); el.end.value = u(st.end); el.loop.setAttribute('aria-pressed', String(st.loop)); el.pos.min = st.start; el.pos.max = Math.max(st.end, st.start + 1); };
  sync();
  el.unit.onclick = () => { st.unit = { cycle: 'bar', bar: 'time', time: 'cycle' }[st.unit] || 'cycle'; set('range.unit', st.unit); sync(); };
  const pts = () => { let a = fromU(el.start.value), b = fromU(el.end.value); if (!isFinite(a)) a = st.start; if (!isFinite(b)) b = st.end; a = Math.max(0, a); if (b <= a) b = a + 1; st.start = a; st.end = b; set('range.start', a); set('range.end', b); sync(); };
  el.start.onchange = pts; el.end.onchange = pts;
  el.loop.onclick = () => { st.loop = !st.loop; set('range.loop', st.loop); sync(); sc.ui && sc.ui.toast(st.loop ? `Looping ${st.unit} ${u(st.start)} to ${u(st.end)}` : 'Loop off'); };
  el.pos.addEventListener('input', () => seek(+el.pos.value));
  el.out.onclick = async () => { if (!sc.ui) return; const v = await sc.ui.ask({ title: 'Go to', label: 'Cycle (e.g. 12) or time m:ss (e.g. 0:24)', value: cyc(sch() && playing() ? sch().now() : 0), okText: 'Go' }); if (v == null) return; const c = parsePos(v, /:/.test(v) ? 'time' : 'cycle'); if (!isFinite(c)) { sc.ui.toast('Enter a cycle or m:ss', { kind: 'error' }); return; } if (!seek(c)) sc.ui.toast('Press Play first, then seek'); };
  el.sync = sync;
  el.more.onclick = () => extend(300);
  $('#trSet').onclick = settings;
  sc.palette && sc.palette.register({ id: 'range.loop', group: 'Transport', title: 'Toggle loop range', run: () => el.loop.click() });
  sc.palette && sc.palette.register({ id: 'range.limit', group: 'Settings', title: 'Play-time limit', run: settings });
  sc.palette && sc.palette.register({ id: 'range.extend', group: 'Transport', title: 'Extend play time +5 min', run: () => extend(300) });
  setInterval(tick, 100);
}
/* Strudel 1.3.0's default Cyclist has no setCycle (only the worker neocyclist does). Its time origin is settable:
   each tick queries [lastEnd, num_cycles_at_cps_change + ticks*dur*cps], and when num_ticks_since_cps_change is 0 the
   next tick re-anchors num_cycles_at_cps_change = lastEnd at the current clock time. So setting lastEnd and zeroing the
   tick count makes the next query start exactly at cycle c (sample-accurate at the next clock tick, about 50 ms). */
function seek(c) {
  const s = sch(); if (!s || !playing()) return false; c = Math.max(0, +c || 0);
  try {
    if (typeof s.setCycle === 'function') s.setCycle(c);
    else if ('num_ticks_since_cps_change' in s && 'lastEnd' in s) { s.lastEnd = c; s.lastBegin = c; s.num_ticks_since_cps_change = 0; }
    else return false;
    return true;
  } catch (e) { return false; }
}
async function settings() {
  if (!sc.ui) return;
  const v = await sc.ui.ask({ title: 'Play-time limit', label: 'Maximum minutes per run (e.g. 20, 2:30, 90s, 1h; range 1 to 600 min)', value: String(st.maxMin), okText: 'Save' });
  if (v == null) return; const p = sc.controls && sc.controls.lib && sc.controls.lib.parseValue; const n = p ? p(v, { unit: 'min' }) : parseFloat(v);
  if (!(n > 0)) { sc.ui.toast('Enter a positive time (e.g. 20, 2:30, 90s)', { kind: 'error' }); return; }
  if (n > 600 && !(await sc.ui.askYesNo({ title: 'Beyond the 600 min range', message: `Extend the play-time range to fit ${+n.toFixed(2)} min?`, okText: 'Extend range to fit' }))) return;
  st.maxMin = n; set('range.maxMin', n);
  const f = await sc.ui.askYesNo({ title: 'At the limit', message: 'Fade out over 4 seconds before stopping? (No = stop at once)', okText: 'Fade out' });
  st.atLimit = f ? 'fade' : 'stop'; set('range.atLimit', st.atLimit); sc.ui.toast(`Limit ${n} min, ${st.atLimit === 'fade' ? 'fade out' : 'hard stop'}`, { kind: 'ok' });
}
function extend(sec) { st.extra += sec; if (st.fading) cancelFade(); sc.ui && sc.ui.toast(`Limit extended to ${fmt(limit())}`, { kind: 'ok' }); tick(); }
let fadeT = 0;
function cancelFade() { clearInterval(fadeT); st.fading = false; sc.transport && sc.transport.setMaster(sc.transport.masterDb); }
function hitLimit() {
  const t = sc.transport; if (!t) return;
  if (st.atLimit === 'stop') { t.stop(); sc.ui && sc.ui.toast('Play-time limit reached: stopped', { kind: 'info' }); return; }
  st.fading = true; const base = t.masterDb, t0 = performance.now(), dur = 4000;
  sc.ui && sc.ui.toast('Play-time limit: fading out. +5 min to keep going', { kind: 'info', ms: 4000 });
  fadeT = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / dur); t.setMaster(base - 60 * k);
    if (k >= 1) { clearInterval(fadeT); st.fading = false; t.stop(); t.setMaster(base); }
  }, 50);
}
function tick() {
  const now = performance.now(), dt = st.last ? (now - st.last) / 1000 : 0; st.last = now;
  const p = playing();
  if (p && !st.wasPlaying) { st.elapsed = 0; st.extra = 0; const s = sch(); if (st.loop && s && s.now() < st.start) seek(st.start); }
  if (!p && st.fading) { clearInterval(fadeT); st.fading = false; }
  st.wasPlaying = p;
  /* the clamp counts played time only: audio-clock time while the context runs, from the background clock (bgplay.js); paused,
     suspended or frozen time is not played time. Without the background clock: wall time between ticks, capped at 1 s per tick. */
  const bg = sc.bg && sc.bg.installed ? sc.bg : null;
  if (p) st.elapsed = bg ? bg.played : st.elapsed + Math.min(dt, 1);
  st.pausedSec = p && bg ? bg.paused : 0;
  const left = limit() - st.elapsed;
  if (p && left <= 0 && !st.fading) hitLimit();
  if (!el.pos || document.hidden) return; /* hidden: the clamp still runs, the readout waits */
  const s = sch(); let c = 0; try { c = p && s ? s.now() : 0; } catch (e) { c = 0; }
  if (p && s) installLoop(s);
  if (c > +el.pos.max && !st.loop) el.pos.max = Math.ceil(c / 4) * 4;
  if (document.activeElement !== el.pos) el.pos.value = c;
  const k = cps(); if (k !== st.lastCps) { st.lastCps = k; if (document.activeElement !== el.start && document.activeElement !== el.end) el.sync(); }
  /* end = loop End when looping, otherwise the clamp end projected from the current position */
  const endC = st.loop ? st.end : c + Math.max(0, left) * k;
  /* every value has a fixed decimal count and its own fixed-width box (.num), so nothing around it moves */
  put('trC', cyc(c)); put('trCE', cyc(endC)); put('trT', mmss(c / k)); put('trTE', mmss(endC / k));
  if (st.lastAria !== $('#trC').textContent) { st.lastAria = $('#trC').textContent; el.pos.setAttribute('aria-valuetext', `cycle ${cyc(c)}, ${mmss(c / k)}`); }
  put('trL', fmt(left)); put('trPl', fmt(st.elapsed)); put('trPa', fmt(st.pausedSec || 0));
  $('#trPP').style.visibility = p ? 'visible' : 'hidden'; $('#trPz').style.visibility = p && st.pausedSec >= 1 ? 'visible' : 'hidden'; /* hidden, not removed: width stays */
  el.left.dataset.warn = String(p && left < 60);
  el.left.title = `Remaining play time before the clamp. Played ${fmt(st.elapsed)} (audio time while running), paused ${fmt(st.pausedSec || 0)}`;
  el.more.hidden = !(p && (left < 60 || st.fading));
}
/* sample-accurate loop: the Cyclist writes lastEnd after each tick's query; when it crosses End we store
   Start + overshoot and zero the tick count, so the next tick re-anchors its time origin there (no timer lag). */
function installLoop(s) {
  if (s.__scLoop || !('num_ticks_since_cps_change' in s)) return; s.__scLoop = true;
  let raw = s.lastEnd;
  Object.defineProperty(s, 'lastEnd', { configurable: true, get: () => raw, set: (x) => {
    const len = st.end - st.start, ov = x - st.end;
    /* inside the loop: wrap and carry the sub-tick overshoot; entering from outside (loop just enabled or points moved): jump to Start */
    if (st.loop && !st.fading && playing() && len > 0 && (ov >= 0 || x < st.start)) { raw = st.start + (ov >= 0 && ov < 0.1 ? ov : 0); s.num_ticks_since_cps_change = 0; }
    else raw = x;
  } });
}
const put = (id, t) => { const e = document.getElementById(id); if (e && e.textContent !== t) e.textContent = t; };
function setLimit(min) { st.maxMin = min; set('range.maxMin', min); }
sc.range = { state: st, setLimit, extend, tick, seek, parsePos };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
