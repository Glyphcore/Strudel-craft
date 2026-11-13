/* Transport range: cycle position slider with scrub, loop start/end (cycle or bar), and a play-time clamp.
   Clamp: total play time per run is limited to sc.range.maxMin minutes (default 20); remaining time shown;
   at the limit the master fades (or stops, per settings) and playback stops. "+5 min" overrides for this run.
   Needs window.strudelCraft.transport (app.js hook). API: window.strudelCraft.range = { state, setLimit, extend, tick } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const get = (k, d) => { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const st = { unit: get('range.unit', 'cycle'), start: get('range.start', 0), end: get('range.end', 16), loop: get('range.loop', false),
  maxMin: get('range.maxMin', 20), atLimit: get('range.atLimit', 'fade'), elapsed: 0, extra: 0, fading: false, wasPlaying: false, last: 0 };
const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const limit = () => st.maxMin * 60 + st.extra;
const sch = () => { const s = sc.engineState && sc.engineState(); return s && s.scheduler; };
const playing = () => !!(sc.transport && sc.transport.playing);
const u = (c) => (st.unit === 'bar' ? c + 1 : c); // bars are 1-based (1 cycle = 1 bar of 4 beats here)
const fromU = (v) => (st.unit === 'bar' ? v - 1 : v);
let el = {};

function build() {
  const host = $('.stage'); if (!host || $('#trange')) return;
  const w = document.createElement('div'); w.className = 'trange'; w.id = 'trange';
  w.innerHTML = `<label class="sr" for="trPos">Position</label>
    <input id="trPos" class="tr-pos" type="range" min="0" max="16" step="0.01" value="0" aria-valuetext="cycle 0">
    <div class="tr-row">
      <output id="trOut" class="tr-out">0.00</output>
      <button type="button" class="ghost tr-unit" id="trUnit" title="Count loop points in cycles or bars">cycle</button>
      <label class="tr-num"><span>Start</span><input id="trStart" type="number" step="1" inputmode="decimal"></label>
      <label class="tr-num"><span>End</span><input id="trEnd" type="number" step="1" inputmode="decimal"></label>
      <button type="button" class="ghost tr-loop" id="trLoop" aria-pressed="false" title="Loop between start and end">Loop</button>
      <span class="tr-left" id="trLeft" title="Remaining play time before the clamp">20:00 left</span>
      <button type="button" class="ghost tr-more" id="trMore" hidden title="Extend the clamp by 5 minutes for this run">+5 min</button>
      <button type="button" class="icon tr-set" id="trSet" aria-label="Play-time limit settings" title="Play-time limit"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 13V9M10 3h4"/></svg></button>
    </div>`;
  host.append(w);
  el = { pos: $('#trPos'), out: $('#trOut'), unit: $('#trUnit'), start: $('#trStart'), end: $('#trEnd'), loop: $('#trLoop'), left: $('#trLeft'), more: $('#trMore') };
  const sync = () => { el.unit.textContent = st.unit; el.start.value = u(st.start); el.end.value = u(st.end); el.loop.setAttribute('aria-pressed', String(st.loop)); el.pos.min = st.start; el.pos.max = Math.max(st.end, st.start + 1); };
  sync();
  el.unit.onclick = () => { st.unit = st.unit === 'cycle' ? 'bar' : 'cycle'; set('range.unit', st.unit); sync(); };
  const pts = () => { let a = fromU(+el.start.value || 0), b = fromU(+el.end.value || 0); a = Math.max(0, a); if (b <= a) b = a + 1; st.start = a; st.end = b; set('range.start', a); set('range.end', b); sync(); };
  el.start.onchange = pts; el.end.onchange = pts;
  el.loop.onclick = () => { st.loop = !st.loop; set('range.loop', st.loop); sync(); sc.ui && sc.ui.toast(st.loop ? `Looping ${st.unit} ${u(st.start)} to ${u(st.end)}` : 'Loop off'); };
  el.pos.addEventListener('input', () => seek(+el.pos.value));
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
  const v = await sc.ui.ask({ title: 'Play-time limit', label: 'Maximum minutes per run (projected stop)', value: String(st.maxMin), okText: 'Save' });
  if (v == null) return; const n = parseFloat(v); if (!(n > 0 && n <= 600)) { sc.ui.toast('Enter minutes between 0 and 600', { kind: 'error' }); return; }
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
  if (p) st.elapsed += dt;
  const left = limit() - st.elapsed;
  if (p && left <= 0 && !st.fading) hitLimit();
  if (!el.pos) return;
  const s = sch(); let c = 0; try { c = p && s ? s.now() : 0; } catch (e) { c = 0; }
  if (p && s) installLoop(s);
  if (c > +el.pos.max && !st.loop) el.pos.max = Math.ceil(c / 4) * 4;
  if (document.activeElement !== el.pos) el.pos.value = c;
  el.pos.setAttribute('aria-valuetext', st.unit + ' ' + u(c).toFixed(1));
  el.out.textContent = (st.unit === 'bar' ? 'bar ' + Math.floor(u(c)) : 'cyc ' + c.toFixed(2));
  el.left.textContent = fmt(left) + ' left'; el.left.dataset.warn = String(p && left < 60);
  el.more.hidden = !(p && (left < 60 || st.fading));
}
/* sample-accurate loop: the Cyclist writes lastEnd after each tick's query; when it crosses End we store
   Start + overshoot and zero the tick count, so the next tick re-anchors its time origin there (no timer lag). */
function installLoop(s) {
  if (s.__scLoop || !('num_ticks_since_cps_change' in s)) return; s.__scLoop = true;
  let raw = s.lastEnd;
  Object.defineProperty(s, 'lastEnd', { configurable: true, get: () => raw, set: (x) => {
    if (st.loop && !st.fading && playing() && x >= st.end && st.end > st.start) { raw = st.start + Math.min(x - st.end, st.end - st.start); s.num_ticks_since_cps_change = 0; }
    else raw = x;
  } });
}
function setLimit(min) { st.maxMin = min; set('range.maxMin', min); }
sc.range = { state: st, setLimit, extend, tick, seek };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
