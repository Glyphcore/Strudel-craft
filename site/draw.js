/* Draw surface (#182 stage 3, docs/DRAWN_WAVEFORMS.md section 8): draw one cycle (and up to 8 morph keyframes), shape its harmonics, draw an ADSR
   amplitude envelope, hear it at once (a held note that retriggers through the envelope, the wave swapped live on every stroke), and save it as a named
   instrument that a program plays as s("wt_<id>"). Output is a waveforms@1 instrument (control points and envelope points); validate() of
   site/engine/waveforms.js is the only gate and runs before every save. No audio file is ever imported, dropped or shown (section 1, the no-copy rule).
   Loaded on demand by drawn-user.js (window.strudelCraft.drawn.open). Dialogs: the site modal and toasts only (ui.js). */
import { validate, cycleOf, partialsOf, soundName } from './engine/waveforms.js';

const sc = window.strudelCraft, ui = () => sc.ui, D = () => sc.drawn;
const N = 64, H = 16, HOLD = 0.6, MAXF = 8, NOTES = { c2: 65.406, c3: 130.813, c4: 261.626 };
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v)), r4 = (v) => Math.round(v * 1e4) / 1e4;
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.filter((x) => x != null)); return e; };
const toast = (m, o) => ui() && ui().toast(m, o);
const ms = (s) => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s'), db = (g) => (g <= 0.001 ? '-inf dB' : (20 * Math.log10(g)).toFixed(1) + ' dB');

/* ---------------------------------------------------------------- shapes and data */
const SHAPES = {
  sine: (x) => Math.sin(2 * Math.PI * x), triangle: (x) => (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4), saw: (x) => (x < 0.5 ? 2 * x : 2 * x - 2),
  square: (x) => (x < 0.5 ? 0.8 : -0.8), pulse: (x) => (x < 0.2 ? 0.8 : -0.2), organ: (x) => 0.6 * Math.sin(2 * Math.PI * x) + 0.3 * Math.sin(4 * Math.PI * x) + 0.2 * Math.sin(6 * Math.PI * x),
};
const shape = (k) => Float32Array.from({ length: N }, (_, i) => r4(clamp(SHAPES[k](i / N))));
const blank = () => ({ id: null, title: '', words: '', frames: [shape('sine')], sel: 0, env: { a: 0.01, d: 0.3, s: 0.7, r: 0.4 }, note: 'c3', tab: 'wave', dirty: false });
const pointsOf = (f) => { const p = []; for (let i = 0; i < N; i++) p.push([r4(i / N), r4(clamp(f[i]))]); p.push([1, r4(clamp(f[0]))]); return p; };
function frameOf(points) { // our own grid is read as is; any other curve (a pack instrument) is resampled linearly onto N points
  if (points.length === N + 1 && points.every((p, i) => p[0] === r4(i / N))) return Float32Array.from(points.slice(0, N), (p) => p[1]);
  const pts = points.slice().sort((a, b) => a[0] - b[0]), f = new Float32Array(N);
  for (let i = 0; i < N; i++) { const x = i / N; let j = 0; while (j < pts.length - 2 && pts[j + 1][0] <= x) j++; const a = pts[j], b = pts[j + 1] || a, t = b[0] === a[0] ? 0 : clamp((x - a[0]) / (b[0] - a[0]), 0, 1); f[i] = r4(clamp(a[1] + (b[1] - a[1]) * t)); }
  return f;
}
export function toInstrument(s = st) {
  const { a, d, s: sus, r } = s.env, inst = { id: s.id, title: s.title || s.id, family: 'drawn', origin: 'drawn', license: 'own work' };
  if (s.words) inst.descriptors = { sentence: s.words };
  inst.cycle = { points: pointsOf(s.frames[0]), interp: 'linear' };
  if (s.frames.length > 1) inst.morph = { frames: s.frames.map((f, i) => ({ pos: r4(i / (s.frames.length - 1)), points: pointsOf(f) })), interp: 'spectral', out: 16 };
  inst.env = { amp: { points: [[0, 0, 'lin'], [r4(a), 1, 'lin'], [r4(a + d), r4(sus), 'exp'], [r4(a + d + r), 0, 'exp']], adsr: true } };
  return inst;
}
export function fromInstrument(inst) {
  const s = blank(); s.id = inst.id; s.title = inst.title || inst.id; s.words = (inst.descriptors && typeof inst.descriptors.sentence === 'string') ? inst.descriptors.sentence : '';
  s.frames = inst.morph ? inst.morph.frames.slice().sort((x, y) => x.pos - y.pos).map((f) => frameOf(f.points)) : [frameOf(inst.cycle.points)];
  const p = inst.env && inst.env.amp && inst.env.amp.points;
  if (p && p.length === 4) s.env = { a: p[1][0], d: r4(p[2][0] - p[1][0]), s: p[2][1], r: r4(p[3][0] - p[2][0]) };
  return s;
}
const slug = (t) => String(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/* harmonic k (1..H) of a frame: magnitude and phase, so a bar drag changes only that harmonic */
function harm(f) { const out = []; for (let k = 1; k <= H; k++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const w = 2 * Math.PI * k * i / N; re += f[i] * Math.cos(w); im -= f[i] * Math.sin(w); } out.push({ mag: 2 * Math.hypot(re, im) / N, ph: Math.atan2(im, re) }); } return out; }
function setHarm(f, k, mag) {
  const cur = harm(f)[k - 1], ph = cur.mag > 1e-4 ? cur.ph : -Math.PI / 2, dm = mag - cur.mag;
  for (let i = 0; i < N; i++) f[i] += dm * Math.cos(2 * Math.PI * k * i / N + ph);
  let pk = 0; for (const v of f) pk = Math.max(pk, Math.abs(v)); const g = pk > 1 ? 1 / pk : 1; for (let i = 0; i < N; i++) f[i] = r4(f[i] * g);
}

/* ---------------------------------------------------------------- state, undo */
let st = blank(), undo = [], redo = [], root = null, el = {};
const snap = () => JSON.stringify({ frames: st.frames.map((f) => [...f]), env: st.env, sel: st.sel });
const restore = (j) => { const o = JSON.parse(j); st.frames = o.frames.map((f) => Float32Array.from(f)); st.env = o.env; st.sel = Math.min(o.sel, st.frames.length - 1); };
function mark() { undo.push(snap()); if (undo.length > 60) undo.shift(); redo = []; st.dirty = true; }
function stepUndo(back) { const from = back ? undo : redo, to = back ? redo : undo; if (!from.length) return; to.push(snap()); restore(from.pop()); st.dirty = true; touch(); }
const frame = () => st.frames[st.sel];

/* ---------------------------------------------------------------- audio: a held note through the drawn envelope, the wave swapped live */
const A = { ctx: null, out: null, an: null, osc: null, vca: null, on: false, timer: 0, buf: null };
function ctxOf() {
  if (A.ctx) return A.ctx;
  const AC = window.AudioContext || window.webkitAudioContext; A.ctx = new AC();
  A.out = A.ctx.createGain(); A.out.gain.value = 0.32; A.an = A.ctx.createAnalyser(); A.an.fftSize = 2048; A.an.smoothingTimeConstant = 0; A.buf = new Float32Array(A.an.fftSize);
  A.out.connect(A.an); A.an.connect(A.ctx.destination); return A.ctx;
}
function periodic() { // the same route the saved sound takes: the drawn points through cycleOf, 48 harmonics
  const c = cycleOf({ cycle: { points: pointsOf(frame()), interp: 'linear' } }, 0, 1024), { mag, phase } = partialsOf(c, 48);
  const re = new Float32Array(49), im = new Float32Array(49); mag.forEach((m, i) => { re[i + 1] = m * Math.cos(phase[i]); im[i + 1] = -m * Math.sin(phase[i]); });
  return A.ctx.createPeriodicWave(re, im);
}
function trig() {
  if (!A.on) return; const t = A.ctx.currentTime + 0.02, { a, d, s, r } = st.env, g = A.vca.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + a); g.setTargetAtTime(s, t + a, Math.max(0.005, d / 4)); g.setTargetAtTime(0, t + a + d + HOLD, Math.max(0.005, r / 4));
  A.timer = setTimeout(trig, (a + d + HOLD + r + 0.15) * 1000);
}
async function hear(on) {
  if (on === A.on) return; const c = ctxOf();
  if (on) {
    try { await c.resume(); } catch (e) { /* blocked until a gesture */ }
    if (c.state !== 'running') { toast('Audio is blocked by the browser. Tap Hear again.', { kind: 'error' }); return; }
    A.on = true; A.osc = c.createOscillator(); A.vca = c.createGain(); A.vca.gain.value = 0; A.osc.frequency.value = NOTES[st.note]; A.osc.setPeriodicWave(periodic());
    A.osc.connect(A.vca); A.vca.connect(A.out); A.osc.start(); trig(); loop();
  } else {
    A.on = false; clearTimeout(A.timer); const t = c.currentTime, o = A.osc, v = A.vca;
    v.gain.cancelScheduledValues(t); v.gain.setTargetAtTime(0, t, 0.02); o.stop(t + 0.15); o.onended = () => { o.disconnect(); v.disconnect(); };
  }
  el.hear.setAttribute('aria-pressed', String(A.on)); el.hear.querySelector('span').textContent = A.on ? 'Hearing' : 'Hear'; draw();
}
const liveWave = () => { if (A.on && A.osc) A.osc.setPeriodicWave(periodic()); };

/* ---------------------------------------------------------------- drawing */
let css = null, frameMs = [], lastT = 0;
const tokens = () => { const s = getComputedStyle(root); return { sig: s.getPropertyValue('--sig').trim(), sig2: s.getPropertyValue('--sig-2').trim(), line: s.getPropertyValue('--line').trim(), line2: s.getPropertyValue('--line-2').trim(), dim: s.getPropertyValue('--faint').trim(), soft: s.getPropertyValue('--sig-soft').trim(), text: s.getPropertyValue('--text').trim() }; };
function fit(cv) { const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr)); if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; } const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); return { g, w, h: hh, dpr }; }
let cursor = 0, hsel = 0, esel = 0;
function drawPad() {
  const { g, w, h: hh, dpr } = fit(el.pad), c = css, y = (v) => hh / 2 - v * (hh / 2 - 8 * dpr), x = (i) => (i / N) * w;
  g.clearRect(0, 0, w, hh); g.lineWidth = dpr; g.strokeStyle = c.line;
  for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, hh); g.stroke(); }
  for (const v of [0.5, -0.5]) { g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v)); g.stroke(); }
  g.strokeStyle = c.line2; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
  if (st.tab === 'morph') for (const [j, f] of st.frames.entries()) { if (j === st.sel) continue; g.strokeStyle = c.dim; g.globalAlpha = 0.45; g.beginPath(); for (let i = 0; i <= N; i++) g[i ? 'lineTo' : 'moveTo'](x(i), y(f[i % N])); g.stroke(); g.globalAlpha = 1; }
  if (A.on && A.an) { // scope: what you hear, one period from a rising zero crossing
    A.an.getFloatTimeDomainData(A.buf); const per = A.ctx.sampleRate / NOTES[st.note]; let z = 0; for (let i = 1; i < A.buf.length - per; i++) if (A.buf[i - 1] < 0 && A.buf[i] >= 0) { z = i; break; }
    let pk = 0; for (let i = 0; i < per; i++) pk = Math.max(pk, Math.abs(A.buf[z + i] || 0)); const k = pk > 1e-4 ? 1 / pk : 0;
    g.strokeStyle = c.sig2; g.lineWidth = 1.5 * dpr; g.beginPath(); for (let i = 0; i < per; i += 2) g[i ? 'lineTo' : 'moveTo'](i / per * w, y(clamp((A.buf[z + i] || 0) * k * 0.9))); g.stroke();
  }
  const f = frame(); g.beginPath(); g.moveTo(0, y(0)); for (let i = 0; i <= N; i++) g.lineTo(x(i), y(f[i % N])); g.lineTo(w, y(0)); g.closePath(); g.fillStyle = c.soft; g.fill();
  g.strokeStyle = c.sig; g.lineWidth = 2.5 * dpr; g.lineJoin = 'round'; g.shadowColor = c.sig; g.shadowBlur = 10 * dpr; g.beginPath(); for (let i = 0; i <= N; i++) g[i ? 'lineTo' : 'moveTo'](x(i), y(f[i % N])); g.stroke(); g.shadowBlur = 0;
  if (document.activeElement === el.pad) { g.fillStyle = c.text; g.beginPath(); g.arc(x(cursor), y(f[cursor]), 5 * dpr, 0, 7); g.fill(); }
}
function drawHarm() {
  const { g, w, h: hh, dpr } = fit(el.harm), c = css, hs = harm(frame()), bw = w / H; g.clearRect(0, 0, w, hh);
  hs.forEach((o, i) => { const v = Math.min(1, o.mag), bh = v * (hh - 16 * dpr); g.fillStyle = i === hsel && document.activeElement === el.harm ? c.text : i === 0 ? c.sig : c.sig2; g.globalAlpha = 0.35 + 0.65 * Math.min(1, v * 2); g.fillRect(i * bw + 2 * dpr, hh - 12 * dpr - bh, bw - 4 * dpr, bh); g.globalAlpha = 1; g.fillStyle = c.dim; g.font = `${9 * dpr}px ${getComputedStyle(root).getPropertyValue('--mono')}`; g.textAlign = 'center'; g.fillText(String(i + 1), i * bw + bw / 2, hh - 2 * dpr); });
}
const SEG = { a: 2, d: 2, r: 3 }, segW = (w, k, v) => (w / 4) * Math.sqrt(v / SEG[k]), segV = (w, k, px) => clamp(Math.pow(clamp(px / (w / 4), 0, 1), 2) * SEG[k], k === 'a' ? 0.001 : 0.01, SEG[k]);
function envGeom(w, hh, dpr) { const { a, d, s, r } = st.env, pad = 12 * dpr, W = w - 2 * pad, y = (v) => pad + (1 - v) * (hh - 2 * pad); const xa = pad + segW(W, 'a', a), xd = xa + segW(W, 'd', d), xh = xd + W / 8, xr = xh + segW(W, 'r', r); return { pad, W, y, pts: [[pad, y(0)], [xa, y(1)], [xd, y(s)], [xh, y(s)], [xr, y(0)]] }; }
function drawEnv() {
  const { g, w, h: hh, dpr } = fit(el.env), c = css, { pts } = envGeom(w, hh, dpr); g.clearRect(0, 0, w, hh);
  g.strokeStyle = c.line; g.lineWidth = dpr; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, hh); g.stroke(); }
  g.beginPath(); pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](px, py)); g.lineTo(pts[4][0], pts[0][1]); g.fillStyle = c.soft; g.fill();
  g.strokeStyle = c.sig; g.lineWidth = 2.5 * dpr; g.shadowColor = c.sig; g.shadowBlur = 10 * dpr; g.beginPath(); pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](px, py)); g.stroke(); g.shadowBlur = 0;
  [1, 2, 4].forEach((pi, k) => { const [px, py] = pts[pi], on = document.activeElement === el.env && (k === 0 ? esel === 0 : k === 1 ? esel === 1 || esel === 2 : esel === 3); g.fillStyle = on ? c.text : c.sig2; g.beginPath(); g.arc(px, py, (on ? 9 : 7) * dpr, 0, 7); g.fill(); });
}
function draw() {
  css = tokens(); const tab = st.tab;
  if (tab === 'env') drawEnv(); else { drawPad(); drawHarm(); }
  const { a, d, s, r } = st.env; el.envOut.textContent = `A ${ms(a)}  D ${ms(d)}  S ${db(s)}  R ${ms(r)}`;
}
function loop() { if (!A.on || !root || root.hidden) return; const t = performance.now(); if (lastT) { frameMs.push(t - lastT); if (frameMs.length > 600) frameMs.shift(); } lastT = t; draw(); requestAnimationFrame(loop); }
let pending = 0; function touch(wave = true) { renderChrome(); if (wave) liveWave(); if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(); }); }

/* ---------------------------------------------------------------- pointer and keys */
function padPointer() {
  let last = null;
  const at = (e) => { const r = el.pad.getBoundingClientRect(); return [clamp(Math.floor((e.clientX - r.left) / r.width * N), 0, N - 1), clamp(1 - 2 * (e.clientY - r.top) / r.height)]; };
  const paint = (e) => { const f = frame(); for (const ev of (e.getCoalescedEvents && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e])) { const [i, v] = at(ev); if (last) { const [i0, v0] = last, n = Math.abs(i - i0); for (let k = 0; k <= n; k++) { const t = n ? k / n : 1; f[Math.round(i0 + (i - i0) * t)] = r4(v0 + (v - v0) * t); } } else f[i] = r4(v); last = [i, v]; cursor = i; } touch(); };
  el.pad.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); mark(); last = null; el.pad.setPointerCapture(e.pointerId); paint(e); });
  el.pad.addEventListener('pointermove', (e) => { if (el.pad.hasPointerCapture(e.pointerId)) paint(e); });
  const end = (e) => { if (el.pad.hasPointerCapture(e.pointerId)) el.pad.releasePointerCapture(e.pointerId); last = null; };
  el.pad.addEventListener('pointerup', end); el.pad.addEventListener('pointercancel', end);
  el.pad.addEventListener('keydown', (e) => {
    const f = frame(), step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { cursor = (cursor + (e.key === 'ArrowLeft' ? N - 1 : 1)) % N; } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { mark(); f[cursor] = r4(clamp(f[cursor] + (e.key === 'ArrowUp' ? step : -step))); } else if (e.key === 'Home') cursor = 0; else if (e.key === 'End') cursor = N - 1; else return;
    e.preventDefault(); e.stopPropagation(); touch(); el.padOut.textContent = `Point ${cursor + 1} of ${N}: ${f[cursor].toFixed(2)}`;
  });
  el.pad.addEventListener('focus', () => draw()); el.pad.addEventListener('blur', () => draw());
}
function harmPointer() {
  const at = (e) => { const r = el.harm.getBoundingClientRect(); return [clamp(Math.floor((e.clientX - r.left) / r.width * H), 0, H - 1), clamp(1 - (e.clientY - r.top) / (r.height - 12), 0, 1)]; };
  const set = (e) => { const [k, v] = at(e); hsel = k; setHarm(frame(), k + 1, v); touch(); };
  el.harm.addEventListener('pointerdown', (e) => { e.preventDefault(); mark(); el.harm.setPointerCapture(e.pointerId); set(e); });
  el.harm.addEventListener('pointermove', (e) => { if (el.harm.hasPointerCapture(e.pointerId)) set(e); });
  el.harm.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') hsel = clamp(hsel + (e.key === 'ArrowLeft' ? -1 : 1), 0, H - 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { mark(); setHarm(frame(), hsel + 1, clamp(harm(frame())[hsel].mag + (e.key === 'ArrowUp' ? 0.05 : -0.05), 0, 1)); } else return;
    e.preventDefault(); e.stopPropagation(); touch(); el.harmOut.textContent = `Harmonic ${hsel + 1}: ${db(harm(frame())[hsel].mag)}`;
  });
  el.harm.addEventListener('focus', () => draw()); el.harm.addEventListener('blur', () => draw());
}
function envPointer() {
  let which = null;
  el.env.addEventListener('pointerdown', (e) => {
    const r = el.env.getBoundingClientRect(), dpr = el.env.width / r.width, px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr, { pts } = envGeom(el.env.width, el.env.height, dpr);
    let best = 1e9; for (const pi of [1, 2, 4]) { const dd = Math.hypot(pts[pi][0] - px, (pts[pi][1] - py) * 0.5); if (dd < best) { best = dd; which = pi; } }
    e.preventDefault(); mark(); el.env.setPointerCapture(e.pointerId); move(e);
  });
  const move = (e) => {
    if (!el.env.hasPointerCapture(e.pointerId) || !which) return;
    const r = el.env.getBoundingClientRect(), dpr = el.env.width / r.width, px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr, { pad, W, y, pts } = envGeom(el.env.width, el.env.height, dpr);
    if (which === 1) st.env.a = r4(segV(W, 'a', px - pad));
    if (which === 2) { st.env.d = r4(segV(W, 'd', px - pts[1][0])); st.env.s = r4(clamp(1 - (py - pad) / (y(0) - pad), 0, 1)); }
    if (which === 4) st.env.r = r4(segV(W, 'r', px - pts[3][0]));
    touch(false);
  };
  el.env.addEventListener('pointermove', move);
  el.env.addEventListener('keydown', (e) => {
    const k = ['a', 'd', 's', 'r'][esel];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') esel = clamp(esel + (e.key === 'ArrowLeft' ? -1 : 1), 0, 3);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { mark(); const f = e.key === 'ArrowUp' ? 1 : -1; if (k === 's') st.env.s = r4(clamp(st.env.s + f * 0.05, 0, 1)); else st.env[k] = r4(clamp(st.env[k] * (f > 0 ? 1.15 : 1 / 1.15), k === 'a' ? 0.001 : 0.01, SEG[k])); } else return;
    e.preventDefault(); e.stopPropagation(); touch(false); el.envKey.textContent = 'Editing ' + ['attack', 'decay', 'sustain', 'release'][esel];
  });
  el.env.addEventListener('focus', () => draw()); el.env.addEventListener('blur', () => draw());
}

/* ---------------------------------------------------------------- chrome: tabs, keyframes, saved list */
function renderChrome() {
  root.dataset.tab = st.tab;
  for (const b of el.tabs.querySelectorAll('[role=tab]')) { const on = b.dataset.tab === st.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  el.name.textContent = st.id ? soundName({ id: st.id }) : 'unsaved';
  el.name.title = st.id ? (st.title + (st.dirty ? ' (changed, not saved)' : '')) : 'Not saved yet';
  root.classList.toggle('dirty', st.dirty);
  el.keys.replaceChildren(...st.frames.map((_, i) => h('button', { type: 'button', class: 'dw-key', 'aria-pressed': String(i === st.sel), 'aria-label': `Keyframe ${i + 1} at position ${st.frames.length > 1 ? (i / (st.frames.length - 1)).toFixed(2) : 0}`, onclick: () => { st.sel = i; touch(); } }, String(i + 1))),
    h('button', { type: 'button', class: 'dw-key ghost', 'aria-label': 'Add a keyframe (a copy of the selected one)', disabled: st.frames.length >= MAXF || null, onclick: () => { mark(); st.frames.splice(st.sel + 1, 0, Float32Array.from(frame())); st.sel++; touch(); } }, '+'),
    h('button', { type: 'button', class: 'dw-key ghost', 'aria-label': 'Remove the selected keyframe', disabled: st.frames.length <= 1 || null, onclick: () => { mark(); st.frames.splice(st.sel, 1); st.sel = Math.max(0, st.sel - 1); touch(); } }, '−'));
  for (const b of el.notes.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.note === st.note));
  el.del.disabled = !st.id;
  const mine = (D() && D().list()) || [];
  el.saved.replaceChildren(...(mine.length ? mine.map((i) => h('button', { type: 'button', class: 'dw-chip', 'aria-current': i.id === st.id ? 'true' : null, title: i.title || i.id, onclick: () => loadSaved(i.id) }, soundName(i))) : [h('span', { class: 'dw-none' }, 'Nothing saved yet. Draw, then Save.')]));
}
async function keepGoing() { return !st.dirty || await ui().askYesNo({ title: 'Discard changes?', message: 'The drawing has changes that are not saved.', okText: 'Discard', danger: true }); }
async function loadSaved(id) { if (id === st.id && !st.dirty) return; if (!(await keepGoing())) return; const inst = D().get(id); if (!inst) return; st = { ...fromInstrument(inst), note: st.note, tab: st.tab }; undo = []; redo = []; touch(); }
function setTab(t) { st.tab = t; touch(false); }

/* ---------------------------------------------------------------- save, use, export */
async function nameForm(o = {}) {
  const taken = await D().packNames(), mine = D().list();
  const nameIn = h('input', { type: 'text', id: 'dwName', class: 'scm-input', autocomplete: 'off', maxlength: '48', value: o.title || '', enterkeyhint: 'next' });
  const wordsIn = h('input', { type: 'text', id: 'dwWords', class: 'scm-input', autocomplete: 'off', maxlength: '60', value: o.words || '', placeholder: 'bright, short, a bit hollow', enterkeyhint: 'done' });
  const hint = h('p', { class: 'scm-msg dw-hint', id: 'dwSound' }, 'Plays as s("wt_...")');
  const upd = () => { const id = slug(nameIn.value); hint.textContent = id ? `Plays as s("${soundName({ id })}")` : 'Type a name (letters and digits)'; }; nameIn.addEventListener('input', upd); upd();
  const body = h('div', { class: 'dw-form' }, h('label', { for: 'dwName', class: 'scm-lab' }, 'Name'), nameIn, hint, h('label', { for: 'dwWords', class: 'scm-lab' }, 'Describe it in words (optional; words only, never a recording)'), wordsIn);
  return ui().form({ title: o.heading || 'Save instrument', okText: 'Save', body,
    validate: () => {
      const id = slug(nameIn.value); if (!id) return 'Give it a name with at least one letter or digit.';
      const snd = soundName({ id }); if (taken.has(snd)) return `${snd} is a shipped instrument; pick another name.`;
      if (mine.some((i) => soundName(i) === snd && i.id !== o.keep)) return `You already have ${snd}. Load it from Your instruments to change it, or pick another name.`;
      const errs = validate({ instruments: [toInstrument({ ...st, id, title: nameIn.value.trim().slice(0, 80) || id, words: wordsIn.value.trim() })] });
      return errs.length ? `Not saved: ${errs[0].msg} (${errs[0].code} at ${errs[0].path || 'the instrument'})` : null;
    },
    collect: () => ({ id: slug(nameIn.value), title: nameIn.value.trim().slice(0, 80) || slug(nameIn.value), words: wordsIn.value.trim() }) });
}
async function commit() {
  const inst = toInstrument(), errs = await D().save(inst);
  if (errs.length) { toast(`Not saved: ${errs[0].code} ${errs[0].path}: ${errs[0].msg}`, { kind: 'error' }); return false; }
  st.dirty = false; renderChrome(); toast(`Saved. Play it as s("${soundName(inst)}")`, { kind: 'ok' }); return true;
}
async function saveAs() { const v = await nameForm({ title: st.title, words: st.words, heading: st.id ? 'Save as a new instrument' : 'Save instrument' }); if (!v) return false; st.id = v.id; st.title = v.title; st.words = v.words; return commit(); }
const save = () => (st.id ? commit() : saveAs());
async function rename() { if (!st.id) return saveAs(); const old = st.id, v = await nameForm({ title: st.title, words: st.words, heading: 'Rename or describe', keep: old }); if (!v) return; st.id = v.id; st.title = v.title; st.words = v.words; if (await commit() && v.id !== old) D().remove(old); renderChrome(); }
async function del() { if (!st.id) return; if (!(await ui().askYesNo({ title: 'Delete instrument?', message: `${soundName({ id: st.id })} is removed from this browser. Programs that use it go silent on that sound.`, okText: 'Delete', danger: true }))) return; D().remove(st.id); toast(`Deleted ${soundName({ id: st.id })}`, { kind: 'ok' }); st.id = null; st.dirty = true; renderChrome(); }
export function program(inst = toInstrument()) {
  const p = inst.env.amp.points, a = p[1][0], d = r4(p[2][0] - p[1][0]), s = p[2][1], r = r4(p[3][0] - p[2][0]);
  return `// ${inst.title}: drawn in the draw surface (no audio file)\nsetcpm(90/4)\n$: note("<[c3 eb3 g3 bb3] [ab2 c3 eb3 g3]>").s("${soundName(inst)}")${inst.morph ? '.wt("<0 0.33 0.66 1>")' : ''}.attack(${a}).decay(${d}).sustain(${s}).release(${r}).lpf(5000).gain(0.5)`;
}
async function useInRack() {
  if (st.dirty || !st.id) { if (!(await save())) return; }
  const code = program(); await hear(false); close();
  if (window.__sc) { window.__sc.setView('rack', { push: false }); if (window.__sc.holdLink) window.__sc.holdLink(); }
  const ta = document.getElementById('code'); if (ta) { ta.value = code; ta.dispatchEvent(new Event('input')); }
  toast(`${soundName(toInstrument())} is in the Rack editor. Press Play to hear it; Revert restores the recipe.`, { kind: 'ok' });
}
function exportDoc() {
  const doc = { instruments: D().list() }; if (!doc.instruments.length) { toast('Nothing saved yet to export.', { kind: 'info' }); return; }
  const errs = validate(doc); if (errs.length) { toast(`Export refused: ${errs[0].code} ${errs[0].path}`, { kind: 'error' }); return; }
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })), download: 'drawn-instruments.waveforms.json' }); document.body.append(a); a.click(); a.remove();
  toast('Exported your instruments as waveforms@1 data (a pack ingredient).', { kind: 'ok' });
}

/* ---------------------------------------------------------------- build */
const ICON = { hear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>', x: '&times;' };
function build() {
  const tab = (t, label) => h('button', { type: 'button', role: 'tab', id: 'dwTab-' + t, 'aria-controls': 'dwStage', 'data-tab': t, onclick: () => setTab(t) }, label);
  el.tabs = h('div', { class: 'dw-tabs', role: 'tablist', 'aria-label': 'What to draw' }, tab('wave', 'Wave'), tab('morph', 'Morph'), tab('env', 'Envelope'));
  el.tabs.addEventListener('keydown', (e) => { const order = ['wave', 'morph', 'env'], i = order.indexOf(st.tab); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setTab(order[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]); el.tabs.querySelector('[aria-selected=true]').focus(); } });
  el.name = h('button', { type: 'button', class: 'dw-name ghost', 'aria-label': 'Instrument name: rename or describe', onclick: () => rename() });
  el.pad = h('canvas', { class: 'dw-pad', tabindex: '0', role: 'img', 'aria-label': 'Wave pad: drag to draw one cycle. Keyboard: Left and Right pick a point, Up and Down move it (Shift: fine).' });
  el.harm = h('canvas', { class: 'dw-harm', tabindex: '0', role: 'img', 'aria-label': 'Harmonics 1 to 16: drag a bar to set that harmonic. Keyboard: Left and Right pick, Up and Down set.' });
  el.env = h('canvas', { class: 'dw-envc', tabindex: '0', role: 'img', 'aria-label': 'Amplitude envelope: drag the attack, decay and sustain, and release handles. Keyboard: Left and Right pick a stage, Up and Down change it.' });
  el.padOut = h('output', { class: 'dw-read', 'aria-live': 'polite' }, 'Drag on the pad to draw one cycle');
  el.harmOut = h('output', { class: 'dw-read', 'aria-live': 'polite' }, 'Harmonics: drag a bar');
  el.envOut = h('output', { class: 'dw-read dw-envout' }); el.envKey = h('output', { class: 'dw-read', 'aria-live': 'polite' }, 'Drag a handle');
  el.keys = h('div', { class: 'dw-keys', role: 'group', 'aria-label': 'Morph keyframes (the wt position sweeps from the first to the last)' });
  const shapes = h('div', { class: 'dw-shapes', role: 'group', 'aria-label': 'Start from a shape' }, ...Object.keys(SHAPES).map((k) => h('button', { type: 'button', class: 'ghost', onclick: () => { mark(); st.frames[st.sel] = shape(k); touch(); } }, k)),
    h('button', { type: 'button', class: 'ghost', title: 'Smooth (Ctrl+Z to undo)', onclick: () => { mark(); const f = frame(), g = Float32Array.from(f); for (let i = 0; i < N; i++) f[i] = r4((g[(i + N - 1) % N] + 2 * g[i] + g[(i + 1) % N]) / 4); touch(); } }, 'smooth'),
    h('button', { type: 'button', class: 'ghost', title: 'Invert', onclick: () => { mark(); const f = frame(); for (let i = 0; i < N; i++) f[i] = r4(-f[i]); touch(); } }, 'invert'));
  el.notes = h('div', { class: 'dw-notes', role: 'radiogroup', 'aria-label': 'Held note' }, ...Object.keys(NOTES).map((n) => h('button', { type: 'button', role: 'radio', 'data-note': n, onclick: () => { st.note = n; if (A.on) A.osc.frequency.setTargetAtTime(NOTES[n], A.ctx.currentTime, 0.01); renderChrome(); } }, n.toUpperCase())));
  el.hear = h('button', { type: 'button', class: 'dw-hear', 'aria-pressed': 'false', title: 'Hear a held note through the envelope (H)', onclick: () => hear(!A.on) }); el.hear.innerHTML = ICON.hear + '<span>Hear</span>';
  el.del = h('button', { type: 'button', class: 'ghost', onclick: () => del() }, 'Delete');
  el.saved = h('div', { class: 'dw-saved', role: 'group', 'aria-label': 'Your instruments' });
  const closeB = h('button', { type: 'button', class: 'icon', 'aria-label': 'Close the draw surface (Esc)', onclick: () => close() }); closeB.innerHTML = ICON.x;
  root = h('section', { class: 'dw', id: 'drawSurface', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'dwTitle', hidden: true },
    h('div', { class: 'dw-head' }, h('h2', { id: 'dwTitle' }, 'Draw'), el.name, h('span', { class: 'dw-flag', 'aria-hidden': 'true' }), el.tabs, closeB),
    h('div', { class: 'dw-stage', id: 'dwStage', role: 'tabpanel', 'aria-labelledby': 'dwTitle' },
      h('div', { class: 'dw-wave' }, el.keys, el.pad, el.padOut, el.harm, el.harmOut, shapes),
      h('div', { class: 'dw-envp' }, el.env, el.envOut, el.envKey)),
    h('div', { class: 'dw-deck' }, el.notes, el.hear,
      h('div', { class: 'dw-acts' }, h('button', { type: 'button', class: 'dw-save', onclick: () => save() }, 'Save'), h('button', { type: 'button', onclick: () => useInRack() }, 'Use in Rack'),
        h('button', { type: 'button', class: 'ghost', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => stepUndo(true) }, 'Undo'), h('button', { type: 'button', class: 'ghost', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', onclick: () => stepUndo(false) }, 'Redo'))),
    h('div', { class: 'dw-lib' }, h('h2', {}, 'Your instruments'), el.saved,
      h('div', { class: 'dw-acts' }, h('button', { type: 'button', class: 'ghost', onclick: async () => { if (await keepGoing()) { st = { ...blank(), note: st.note, tab: st.tab }; undo = []; redo = []; touch(); } } }, 'New'),
        h('button', { type: 'button', class: 'ghost', onclick: () => saveAs() }, 'Save as'), el.del, h('button', { type: 'button', class: 'ghost', onclick: () => exportDoc() }, 'Export')),
      h('p', { class: 'dw-rule' }, 'Drawn by hand, stored as points: no audio file is imported, traced or shown. Keys: H hear, Ctrl+Z undo, Esc close.')));
  document.body.append(root);
  padPointer(); harmPointer(); envPointer();
  root.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, field = /INPUT|TEXTAREA/.test(e.target.tagName);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.stopPropagation(); stepUndo(!e.shiftKey); return; }
    if (mod && e.key === 'y') { e.preventDefault(); e.stopPropagation(); stepUndo(false); return; }
    if (!mod && !e.altKey && !field && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); e.stopPropagation(); hear(!A.on); return; }
    if (e.key !== ' ' && e.key !== 'Tab' && !mod) e.stopPropagation(); // the sheet owns its keys; Space stays the transport's Play
  });
  // the no-copy rule (section 1): nothing can be dropped in to trace or import
  for (const t of ['dragover', 'drop']) root.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop') toast('Drawn instruments are drawn, not imported: audio files are not accepted (no-copy rule).', { kind: 'info' }); });
  new ResizeObserver(() => { if (!root.hidden) draw(); }).observe(root);
  const fit2 = () => { const ft = document.querySelector('footer.transport'); root.style.bottom = (ft ? ft.getBoundingClientRect().height : 0) + 'px'; };
  window.addEventListener('resize', fit2); fit2(); el.fit = fit2;
  sc.drawn.onChange(() => root && !root.hidden && renderChrome());
}
let prevFocus = null;
export function open(id) {
  if (!root) build();
  prevFocus = document.activeElement; root.hidden = false; el.fit(); document.documentElement.classList.add('dw-open');
  if (id && D().get(id)) { st = { ...fromInstrument(D().get(id)), note: st.note, tab: st.tab }; undo = []; redo = []; }
  renderChrome(); draw(); (root.querySelector('[role=tab][aria-selected=true]') || el.pad).focus({ preventScroll: true });
}
export function close() { if (!root || root.hidden) return; hear(false); root.hidden = true; document.documentElement.classList.remove('dw-open'); if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); }
/* test and diagnostics hook: the current instrument, the live preview analyser and the measured frame times while hearing */
export const probe = { state: () => st, instrument: () => toInstrument(), analyser: () => A.an, hearing: () => A.on, frames: () => frameMs.slice(), resetFrames: () => { frameMs = []; lastT = 0; } };
