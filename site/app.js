/* Strudel Craft instrument UI. No framework, no build step.
   Strudel (@strudel/web 1.3.0, AGPL-3.0-or-later) is loaded unmodified from unpkg on the first Play. */
'use strict';

const STRUDEL_WEB = 'https://unpkg.com/@strudel/web@1.3.0/dist/index.js';
const SAMPLE_MAPS = ['https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json', 'github:tidalcycles/dirt-samples'];
const TEMPO = { min: 40, max: 240, def: 120 };
const MASTER = { min: -60, max: 6, def: -6 };
const SPEC = { min: -100, max: -20 }; // analyser byte range in dB (relative to full scale)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem('sc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mdInline = (s) => escapeHtml(s || '').replace(/`([^`]+)`/g, '<code>$1</code>');

/* strudel.cc stores the program in the URL hash: encodeURIComponent(base64(UTF-8 bytes)). */
function strudelUrl(code) { const b = new TextEncoder().encode(code); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return 'https://strudel.cc/#' + encodeURIComponent(btoa(s)); }

/* ---------- audio tap ----------
   Strudel connects its output to AudioContext.destination. We wrap AudioNode.prototype.connect so that
   connection lands on our master GainNode instead, which feeds analysers and then the real destination.
   The Strudel bundle itself is not modified. */
const Bus = { ctx: null, gain: null, an: null, anL: null, anR: null, own: new WeakSet(), db: MASTER.def };
const nativeConnect = AudioNode.prototype.connect;
function ensureBus(ctx) {
  if (Bus.ctx === ctx) return;
  Bus.ctx = ctx;
  const g = new GainNode(ctx, { gain: dbToGain(Bus.db) });
  const an = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.78, minDecibels: SPEC.min, maxDecibels: SPEC.max });
  const sp = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const anL = new AnalyserNode(ctx, { fftSize: 1024 }); const anR = new AnalyserNode(ctx, { fftSize: 1024 });
  for (const n of [g, an, sp, anL, anR]) Bus.own.add(n);
  nativeConnect.call(g, an); nativeConnect.call(an, ctx.destination);
  nativeConnect.call(g, sp); nativeConnect.call(sp, anL, 0); nativeConnect.call(sp, anR, 1);
  Object.assign(Bus, { gain: g, an, anL, anR, fbuf: new Uint8Array(an.frequencyBinCount), tbuf: new Float32Array(an.fftSize), lbuf: new Float32Array(1024), rbuf: new Float32Array(1024) });
}
AudioNode.prototype.connect = function (dest, ...rest) {
  if (dest instanceof AudioDestinationNode && !Bus.own.has(this) && !(typeof OfflineAudioContext !== 'undefined' && dest.context instanceof OfflineAudioContext)) {
    ensureBus(dest.context); nativeConnect.call(this, Bus.gain, ...rest); return dest;
  }
  return nativeConnect.call(this, dest, ...rest);
};
function dbToGain(db) { return db <= MASTER.min ? 0 : Math.pow(10, db / 20); }
function setMaster(db) { Bus.db = db; if (Bus.gain && !Bus.muted) Bus.gain.gain.setTargetAtTime(dbToGain(db), Bus.ctx.currentTime, 0.015); }
/* Stop: ramp master to 0 in ~15 ms so voice/reverb tails are cut (Strudel's stop only halts scheduling). */
function muteBus() {
  Bus.muted = true; if (!Bus.gain) return;
  const p = Bus.gain.gain, t = Bus.ctx.currentTime;
  p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + 0.015);
}
function unmuteBus() {
  Bus.muted = false; if (!Bus.gain) return;
  const p = Bus.gain.gain, t = Bus.ctx.currentTime;
  p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(dbToGain(Bus.db), t + 0.01);
}

/* ---------- engine ---------- */
const Engine = {
  ready: null, repl: null, samplesLoaded: false, state: {},
  load() {
    if (!this.ready) this.ready = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = STRUDEL_WEB; s.crossOrigin = 'anonymous';
      s.onload = () => {
        try { window.initStrudel({ onUpdateState: (st) => { this.state = st; } }).then((r) => { this.repl = r; res(r); try { window.dispatchEvent(new CustomEvent('strudel:ready')); } catch (e2) { /* ignore */ } }, rej); } catch (e) { rej(e); }
      };
      s.onerror = () => { this.ready = null; rej(new Error('Could not load the Strudel engine from unpkg (offline?)')); };
      document.head.append(s);
    });
    return this.ready;
  },
  get scheduler() { return this.repl && this.repl.scheduler; },
  async play(code, needsSamples, say) {
    say('Loading engine'); await this.load();
    if (needsSamples && !this.samplesLoaded) { say('Loading sample banks'); for (const m of SAMPLE_MAPS) await window.samples(m); this.samplesLoaded = true; }
    try { const c = window.getAudioContext && window.getAudioContext(); if (c && c.state !== 'running') await c.resume(); } catch (e) { /* resumed on gesture below */ }
    this.state.evalError = undefined;
    unmuteBus();
    await window.evaluate(code);
    if (this.state.evalError) throw this.state.evalError;
    const ctx = window.getAudioContext && window.getAudioContext();
    if (ctx && ctx.state !== 'running') throw new Error('Audio is blocked by the browser. Tap Play again to allow sound.');
  },
  async swap(code) {
    /* hot-swap on the next cycle boundary; on failure the previous pattern keeps playing */
    const sch = this.scheduler; let wait = 0;
    try { const now = sch.now(); const cps = sch.cps || 0.5; wait = Math.max(0, (Math.ceil(now) - now) / cps * 1000 - 30); } catch (e) { wait = 0; }
    if (wait > 4000) wait = 0;
    await new Promise((r) => setTimeout(r, wait));
    this.state.evalError = undefined;
    await window.evaluate(code);
    if (this.state.evalError) throw this.state.evalError;
  },
  stop() { muteBus(); try { if (this.repl) this.repl.stop(); else if (window.hush) window.hush(); } catch (e) { /* not started */ } },
  get started() { return !!(this.scheduler && this.scheduler.started); },
};

/* ---------- app state ---------- */
const S = {
  cat: null, labelsById: {}, recipes: [], filtered: [], sel: 0, view: 'rack',
  q: '', chips: new Set(), vonly: false,
  edits: store.get('edits', {}), stack: store.get('stack', []), tempo: store.get('tempo', TEMPO.def), master: store.get('master', MASTER.def),
  playing: false, playingId: null, playingSource: null, busy: false,
};
S.stack = Array.isArray(S.stack) ? S.stack.filter((l) => l && typeof l.id === 'string') : [];
Bus.db = S.master;
const cur = () => S.filtered[S.sel] || null;
const byId = (id) => S.recipes.find((r) => r.id === id);

/* undo/redo for knobs and stack edits (code edits use the textarea's own undo) */
const History = {
  past: [], future: [],
  push(entry) { this.past.push(entry); if (this.past.length > 100) this.past.shift(); this.future = []; },
  undo() { const e = this.past.pop(); if (!e) return say('Nothing to undo'); e.undo(); this.future.push(e); say('Undo: ' + e.label); },
  redo() { const e = this.future.pop(); if (!e) return say('Nothing to redo'); e.redo(); this.past.push(e); say('Redo: ' + e.label); },
};

/* ---------- status ---------- */
let statusEl;
function say(msg, err) { statusEl.textContent = msg; statusEl.classList.toggle('err', !!err); if (err && window.strudelCraft && window.strudelCraft.ui) window.strudelCraft.ui.toast(msg, { kind: 'error' }); }

/* ---------- knob ---------- */
function knob({ label, min, max, step, value, def, fmt, onChange, cls }) {
  const A0 = 135, SWEEP = 270, R = 20, C = 26;
  const pt = (a) => { const r = (a * Math.PI) / 180; return [C + R * Math.cos(r), C + R * Math.sin(r)]; };
  const [x0, y0] = pt(A0), [x1, y1] = pt(A0 + SWEEP);
  const arc = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 52 52'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path class="track" d="${arc}" pathLength="100"/><path class="val" d="${arc}" pathLength="100" stroke-dasharray="0 100"/><circle class="cap" cx="26" cy="26" r="13"/><line class="ptr" x1="26" y1="26" x2="26" y2="15"/>`;
  const valPath = svg.querySelector('.val'), ptr = svg.querySelector('.ptr');
  const out = el('b'); const root = el('div', { class: 'knob ' + (cls || ''), role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max }, svg, el('span', { class: 'kl' }, el('i', {}, label), out));
  let v = value;
  const render = () => {
    const f = (v - min) / (max - min);
    valPath.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
    ptr.setAttribute('transform', `rotate(${(-135 + f * SWEEP).toFixed(1)} 26 26)`);
    out.textContent = fmt(v); root.setAttribute('aria-valuenow', v); root.setAttribute('aria-valuetext', fmt(v));
  };
  const quant = (x) => Math.round(clamp(x, min, max) / step) * step;
  const set = (x, fire = true) => { const nv = +quant(x).toFixed(4); if (nv === v) return; v = nv; render(); if (fire) onChange(v); };
  const commit = (from) => { if (from === v) return; const to = v; History.push({ label: `${label} ${fmt(to)}`, undo: () => set(from), redo: () => set(to) }); };
  let drag = null;
  root.addEventListener('pointerdown', (e) => { if (e.button) return; root.setPointerCapture(e.pointerId); drag = { y: e.clientY, v, from: v }; root.classList.add('drag'); root.focus({ preventScroll: true }); e.preventDefault(); });
  root.addEventListener('pointermove', (e) => { if (!drag) return; const span = (max - min) / (e.shiftKey ? 800 : 180); set(drag.v + (drag.y - e.clientY) * span); });
  const end = () => { if (!drag) return; root.classList.remove('drag'); commit(drag.from); drag = null; };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('dblclick', () => { const f = v; set(def); commit(f); });
  let wheelFrom = null, wheelT = 0;
  root.addEventListener('wheel', (e) => { e.preventDefault(); if (wheelFrom === null) wheelFrom = v; set(v + (e.deltaY < 0 ? step : -step) * (e.shiftKey ? 1 : (step < 1 ? 1 : 1))); clearTimeout(wheelT); wheelT = setTimeout(() => { commit(wheelFrom); wheelFrom = null; }, 400); }, { passive: false });
  root.addEventListener('keydown', (e) => {
    const big = step * 10; const m = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big }[e.key];
    let nv = null; if (m !== undefined) nv = v + m; else if (e.key === 'Home') nv = min; else if (e.key === 'End') nv = max;
    if (nv === null) return; e.preventDefault(); e.stopPropagation(); const f = v; set(nv); commit(f);
  });
  render();
  return { root, get: () => v, set, nudge(d) { const f = v; set(v + d); commit(f); } };
}

/* ---------- visuals ---------- */
const Viz = {
  colors: {}, frames: [], cost: [], last: 0, raf: 0, running: false, laneCache: { key: '', haps: [], lanes: [] }, peaks: [-Infinity, -Infinity], hold: [-Infinity, -Infinity],
  readColors() { const cs = getComputedStyle(document.documentElement); for (const k of ['sig', 'sig-2', 'text', 'dim', 'faint', 'line', 'line-2', 'panel', 'panel-2', 'warn', 'bad', 'ok']) this.colors[k] = cs.getPropertyValue('--' + k).trim(); },
  fit(c) { const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return dpr; },
  init() {
    this.viz = $('#viz'); this.lanes = $('#lanes'); this.meter = $('#meter'); this.cycleOut = $('#cycleOut'); this.cpsOut = $('#cpsOut'); this.peakOut = $('#peakOut');
    this.readColors();
    new ResizeObserver(() => this.drawAll(performance.now())).observe(this.viz);
    window.__viz = { frames: this.frames, cost: this.cost, get interval() { return reducedMotion.matches ? 100 : 0; } };
    this.drawAll(performance.now());
  },
  start() { if (this.running) return; this.running = true; this.last = 0; this.raf = requestAnimationFrame((t) => this.tick(t)); },
  stopSoon() { this.stopAt = performance.now() + 900; },
  tick(t) {
    const minDt = reducedMotion.matches ? 100 : 0;
    if (!this.last || t - this.last >= minDt - 1) {
      if (this.last) { this.frames.push(t - this.last); if (this.frames.length > 2000) this.frames.splice(0, 1000); }
      this.last = t; const d0 = performance.now(); this.drawAll(t); this.cost.push(performance.now() - d0); if (this.cost.length > 2000) this.cost.splice(0, 1000);
    }
    if (!S.playing && this.stopAt && t > this.stopAt) { this.running = false; this.stopAt = 0; this.drawAll(t); return; }
    this.raf = requestAnimationFrame((tt) => this.tick(tt));
  },
  drawAll(t) { this.drawViz(); this.drawLanes(); this.drawMeter(); },
  drawViz() {
    const c = this.viz, dpr = this.fit(c), g = c.getContext('2d'), W = c.width, H = c.height, C = this.colors;
    g.clearRect(0, 0, W, H);
    // frequency grid (log, real Hz)
    const fmin = 30, fmax = 16000, lx = (f) => (Math.log(f / fmin) / Math.log(fmax / fmin)) * W;
    g.font = `${10 * dpr}px "JetBrains Mono", monospace`; g.fillStyle = C.faint; g.strokeStyle = C.line; g.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(lx(f)) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    const dbY = (db) => Math.round(((SPEC.max - db) / (SPEC.max - SPEC.min)) * H) + 0.5;
    for (const db of [-40, -60, -80]) { const y = dbY(db); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const tag = (txt, x, y) => { const w = g.measureText(txt).width; g.fillStyle = C.panel; g.globalAlpha = 0.85; g.fillRect(x - 2 * dpr, y - 10 * dpr, w + 4 * dpr, 13 * dpr); g.globalAlpha = 1; g.fillStyle = C.dim; g.fillText(txt, x, y); };
    const labels = () => { g.font = `${10 * dpr}px "JetBrains Mono", monospace`; for (const db of (H / dpr < 110 ? [-60] : [-40, -60, -80])) tag(db + ' dB', 4 * dpr, dbY(db) - 3 * dpr); for (const f of [100, 1000, 10000]) tag(f >= 1000 ? f / 1000 + 'k Hz' : f + ' Hz', lx(f) + 3 * dpr, H - 4 * dpr); };
    if (!Bus.an) { labels(); g.fillStyle = C.dim; g.font = `${12 * dpr}px "Chakra Petch", sans-serif`; g.fillText('SPECTRUM / SCOPE  ·  press PLAY', 12 * dpr, 20 * dpr); return; }
    const sr = Bus.ctx.sampleRate, bins = Bus.fbuf, N = bins.length; Bus.an.getByteFrequencyData(bins);
    const bands = W / dpr < 500 ? 56 : 120, bw = W / bands;
    g.fillStyle = C['sig-2'];
    for (let i = 0; i < bands; i++) {
      const f0 = fmin * Math.pow(fmax / fmin, i / bands), f1 = fmin * Math.pow(fmax / fmin, (i + 1) / bands);
      const b0 = Math.floor((f0 / (sr / 2)) * N), b1 = Math.max(b0 + 1, Math.ceil((f1 / (sr / 2)) * N)); let m = 0;
      for (let b = b0; b < b1 && b < N; b++) if (bins[b] > m) m = bins[b];
      const h = (m / 255) * H; if (h > 0.5) g.fillRect(i * bw + 1, H - h, Math.max(1, bw - 2), h);
    }
    // scope
    const tb = Bus.tbuf; Bus.an.getFloatTimeDomainData(tb);
    let z = 0; for (let i = 1; i < tb.length / 2; i++) if (tb[i - 1] < 0 && tb[i] >= 0) { z = i; break; }
    const span = Math.min(tb.length - z, 1024); g.strokeStyle = C.text; g.globalAlpha = 0.85; g.lineWidth = 1.5 * dpr; g.beginPath();
    for (let i = 0; i < span; i++) { const x = (i / (span - 1)) * W, y = H * 0.45 - tb[z + i] * H * 0.4; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.globalAlpha = 1; labels();
  },
  queryLanes(c0) {
    const sch = Engine.scheduler; const pat = sch && sch.pattern; if (!pat) return this.laneCache;
    const key = c0 + '|' + (S.playingId || '') + '|' + Engine.evalCount;
    if (this.laneCache.key === key) return this.laneCache;
    let haps = [];
    try { haps = pat.queryArc(c0, c0 + 1).filter((h) => h.hasOnset && h.hasOnset()); } catch (e) { haps = []; }
    const lanes = []; const out = [];
    for (const h of haps) {
      const v = h.value || {}; const name = typeof v === 'object' ? String(v.s != null ? v.s : (v.note != null || v.n != null ? 'synth' : 'event')) + (v.bank ? '' : '') : 'event';
      let li = lanes.indexOf(name); if (li < 0) { if (lanes.length >= 8) li = 7; else { lanes.push(name); li = lanes.length - 1; } }
      out.push({ b: Number(h.whole.begin) - c0, e: Number(h.whole.end) - c0, li, note: typeof v === 'object' ? (v.note != null ? v.note : v.n) : null });
    }
    this.laneCache = { key, haps: out, lanes };
    return this.laneCache;
  },
  drawLanes() {
    const c = this.lanes, dpr = this.fit(c), g = c.getContext('2d'), W = c.width, H = c.height, C = this.colors;
    g.clearRect(0, 0, W, H);
    const gutter = 64 * dpr; const sch = Engine.scheduler; const playing = S.playing && Engine.started;
    const now = playing ? sch.now() : 0; const c0 = Math.floor(now); const frac = now - c0;
    if (this.cycleOut) { this.cycleOut.textContent = playing ? now.toFixed(2) : '0.00'; this.cpsOut.textContent = sch ? (sch.cps * 60 * 4).toFixed(0) + ' bpm' : '-'; }
    // beat grid: 4 beats, 16 steps
    for (let i = 0; i <= 16; i++) { const x = Math.round(gutter + (i / 16) * (W - gutter)) + 0.5; g.strokeStyle = i % 4 ? C.line : C['line-2']; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    g.font = `${10 * dpr}px "JetBrains Mono", monospace`;
    if (!playing) { g.fillStyle = C.faint; g.fillText('LANES', 8 * dpr, 16 * dpr); return; }
    const { haps, lanes } = this.queryLanes(c0); const n = Math.max(1, lanes.length); const lh = H / n;
    lanes.forEach((name, i) => { g.fillStyle = C.dim; g.fillText(name.slice(0, 9), 8 * dpr, i * lh + lh / 2 + 4 * dpr); if (i) { g.strokeStyle = C.line; g.beginPath(); g.moveTo(0, Math.round(i * lh) + 0.5); g.lineTo(W, Math.round(i * lh) + 0.5); g.stroke(); } });
    const pad = Math.max(Math.min(6 * dpr, lh * 0.2), (lh - 30 * dpr) / 2);
    for (const h of haps) {
      const x0 = gutter + clamp(h.b, 0, 1) * (W - gutter), x1 = gutter + clamp(h.e, 0, 1) * (W - gutter);
      const on = frac >= h.b && frac < h.e;
      g.fillStyle = on ? C.sig : C['sig-2']; g.globalAlpha = on ? 1 : 0.55;
      g.fillRect(x0 + 1, h.li * lh + pad, Math.max(2 * dpr, x1 - x0 - 2), lh - pad * 2);
    }
    g.globalAlpha = 1;
    const px = Math.round(gutter + frac * (W - gutter)); g.fillStyle = C.sig; g.fillRect(px - dpr, 0, 2 * dpr, H);
  },
  drawMeter() {
    const c = this.meter, dpr = this.fit(c), g = c.getContext('2d'), W = c.width, H = c.height, C = this.colors;
    g.clearRect(0, 0, W, H); const rowH = (H - 2 * dpr) / 2; const fx = (db) => clamp((db + 60) / 66, 0, 1) * W;
    for (let ch = 0; ch < 2; ch++) {
      let pk = -Infinity;
      if (Bus.anL && S.playing) { const buf = ch ? Bus.rbuf : Bus.lbuf; (ch ? Bus.anR : Bus.anL).getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; } pk = m > 0 ? 20 * Math.log10(m) : -Infinity; }
      const fall = reducedMotion.matches ? 6 : 1.2; this.peaks[ch] = Math.max(pk, (this.peaks[ch] === -Infinity ? -70 : this.peaks[ch]) - fall);
      this.hold[ch] = Math.max(pk, (this.hold[ch] === -Infinity ? -70 : this.hold[ch]) - 0.25);
      const y = ch * (rowH + 2 * dpr);
      g.fillStyle = C['panel-2']; g.fillRect(0, y, W, rowH);
      const w = fx(this.peaks[ch]); const w0 = fx(-12), w1 = fx(0);
      g.fillStyle = C['sig-2']; g.fillRect(0, y, Math.min(w, w0), rowH);
      if (w > w0) { g.fillStyle = C.warn; g.fillRect(w0, y, Math.min(w, w1) - w0, rowH); }
      if (w > w1) { g.fillStyle = C.bad; g.fillRect(w1, y, w - w1, rowH); }
      const hx = fx(this.hold[ch]); if (this.hold[ch] > -60) { g.fillStyle = C.text; g.fillRect(hx - dpr, y, 2 * dpr, rowH); }
    }
    g.fillStyle = C.line; for (const db of [-48, -36, -24, -12, 0]) g.fillRect(Math.round(fx(db)), 0, dpr, H);
    const p = Math.max(this.hold[0], this.hold[1]);
    this.peakOut.textContent = p > -60 ? p.toFixed(1) + ' dB' : '-inf dB';
  },
};

/* ---------- transport ---------- */
let tempoK, masterK;
function hasOwnTempo(code) { return /set(cpm|cps|bpm)\s*\(/.test(code); }
function withTempo(code) {
  const t = S.tempo; const re = /setcpm\s*\((?:[^()]|\([^()]*\))*\)/g;
  if (re.test(code)) return code.replace(re, `setcpm(${t}/4)`);
  if (/set(cps|bpm)\s*\(/.test(code)) return code; // leave unusual tempo calls alone
  return `setcpm(${t}/4)\n` + code;
}
function recipeCode(r) { return S.edits[r.id] != null ? S.edits[r.id] : r.code; }
function stackLayers() { return S.stack.map((l) => ({ ...l, r: byId(l.id) })).filter((l) => l.r && l.r.expr); }
function stackProgram() {
  const ls = stackLayers(); if (!ls.length) return '// Stack is empty: add recipes with + in the browser';
  return `setcpm(${S.tempo}/4)\n\n` + ls.map((l) => `// ${l.r.title}${l.db ? ` (${l.db > 0 ? '+' : ''}${l.db} dB)` : ''}\n${l.on ? '' : '_'}$: ${l.r.expr.trim()}${l.db ? `\n  .postgain(${(+dbToGain(l.db).toFixed(3))})` : ''}`).join('\n\n') + '\n';
}
/* one global transport: the playing program comes from the visible tab (Follow tab) or the tab it started on */
const EDIT_VIEWS = ['rack', 'stack'];
function playView() { if (S.playing && !S.follow) return S.srcView || 'rack'; return EDIT_VIEWS.includes(S.view) ? S.view : (S.srcView || 'rack'); }
function currentSource(view = playView()) {
  if (view === 'stack') { const ls = stackLayers(); return { kind: 'stack', id: 'stack', title: ls.length ? `Stack · ${ls.length} layer${ls.length > 1 ? 's' : ''}` : 'Stack (empty)', code: stackText(), samples: ls.some((l) => l.r.needs_samples), empty: !ls.length }; }
  const r = cur(); if (!r) return null;
  return { kind: 'solo', id: r.id, title: r.title, code: withTempo(recipeCode(r)), samples: r.needs_samples || /\.bank\(|\bs\("(?:bd|hh|sd|cp|oh)/.test(recipeCode(r)) };
}
Engine.evalCount = 0;
async function play(src = currentSource()) {
  if (!src) return;
  if (src.empty) { say('Stack is empty. Add layers with + or A.', true); return; }
  const btn = $('#playBtn'); btn.classList.add('busy'); S.busy = true;
  const pv = playView();
  try {
    await Engine.play(src.code, src.samples, (m) => say(m + '…'));
    Engine.evalCount++;
    S.playing = true; S.playingId = src.id; S.playingSource = src.kind; S.srcView = src.kind === 'stack' ? 'stack' : pv;
    say('Playing ' + src.title); Viz.start(); setLiveChip(S.live ? 'live' : 'off'); window.dispatchEvent(new CustomEvent('live:ok', { detail: { view: S.view } }));
  } catch (e) {
    say('Error: ' + (e && e.message ? e.message : e), true);
    if (!Engine.started) S.playing = false;
  } finally { btn.classList.remove('busy'); S.busy = false; syncTransport(); }
}
function stop() { Engine.stop(); S.playing = false; S.playingId = null; say('Stopped'); Viz.stopSoon(); syncTransport(); }
function toggle() { if (S.playing) stop(); else play(); }
function syncTransport() {
  if ($('#liveChip')) syncLiveChip();
  const b = $('#playBtn'); b.setAttribute('aria-pressed', S.playing); $('#playLabel').textContent = S.playing ? 'Stop' : 'Play';
  b.setAttribute('aria-label', S.playing ? 'Stop' : 'Play');
  document.body.classList.toggle('playing', S.playing);
  $$('#list li').forEach((li) => li.classList.toggle('playing', S.playing && li.dataset.id === S.playingId));
  const src = currentSource(); $('#srcLabel').textContent = playView() === 'stack' ? 'Stack' : 'Solo';
  const bd = $('#srcBadge'); if (bd) { bd.hidden = !S.playing; bd.textContent = (S.srcView || 'rack') === 'stack' ? 'Stack' : 'Rack'; bd.dataset.locked = String(!S.follow); }
  const fb = $('#followBtn'); if (fb) fb.setAttribute('aria-pressed', String(!!S.follow));
  $('#nowTitle').textContent = src ? src.title : 'No recipe';
}
/* state bridge for history.js: re-read persisted state after a checkout */
window.strudelCraft = window.strudelCraft || {};
window.strudelCraft.app = {
  reload() {
    S.edits = store.get('edits', {}); S.stack = store.get('stack', []);
    const t = store.get('tempo', TEMPO.def), m = store.get('master', MASTER.def);
    if (tempoK && t !== S.tempo) { S.tempo = t; tempoK.set(t, false); }
    if (masterK && m !== S.master) { S.master = m; masterK.set(m, false); setMaster(m); }
    S.live = store.get('live', 'on') !== 'off';
    const r = cur(); if (r) $('#code').value = recipeCode(r);
    renderStack(); renderList(); renderSelection(false);
    const se = store.get('stackEdit', null); if (se != null) { S.stackEdit = se; $('#stackCode').value = se; }
    syncTransport(); liveCode();
  },
};
let liveT = 0, codeT = 0;
S.follow = store.get('follow', true);
S.live = (() => { try { return store.get('live', 'on') !== 'off'; } catch (e) { return true; } })();
function setLiveChip(state, msg) {
  const c = $('#liveChip'); if (!c) return; c.dataset.state = state; $('#liveState').textContent = state; c.title = msg || (state === 'live' ? 'Edits apply on the next cycle' : state === 'off' ? 'Live updates off: tap to turn on' : state === 'error' ? 'Last good pattern still playing' : 'Press Play to go live');
  for (const [id, v] of [['#liveMsg', 'rack'], ['#liveMsgStack', 'stack']]) { const m = $(id); if (m) { const on = state === 'error' && S.view === v; m.hidden = !on; m.textContent = on ? msg : ''; } }
}
function syncLiveChip() { if (!S.live) setLiveChip('off'); else if (!S.playing) setLiveChip('paused'); else if ($('#liveChip').dataset.state !== 'error') setLiveChip('live'); }
function errLine(e) { const m = /\((\d+):(\d+)\)/.exec(String(e && e.message)); if (e && e.loc && e.loc.line) return e.loc.line; return m ? +m[1] : null; }
function syntaxCheck(view) {
  const code = view === 'stack' ? stackText() : (cur() ? recipeCode(cur()) : '');
  try { new Function(code); window.dispatchEvent(new CustomEvent('live:ok', { detail: { view } })); setMsg(view, ''); } catch (e) {
    const msg = 'Not playing yet: ' + String(e.message).slice(0, 120); const m = /<anonymous>:(\d+)/.exec(e.stack || ''); setMsg(view, msg);
    window.dispatchEvent(new CustomEvent('live:error', { detail: { view, line: m ? +m[1] - 2 : null, message: msg } }));
  }
}
function setMsg(view, msg) { const m = $(view === 'stack' ? '#liveMsgStack' : '#liveMsg'); if (m) { m.hidden = !msg; m.textContent = msg; } }
let swapping = Promise.resolve();
function swapTo(src, why) {
  return (swapping = swapping.then(async () => {
    if (!S.playing || !src || src.empty) return false;
    try {
      await Engine.swap(src.code); Engine.evalCount++;
      S.playingId = src.id; S.playingSource = src.kind; S.srcView = src.kind === 'stack' ? 'stack' : 'rack';
      setLiveChip(S.live ? 'live' : 'off'); window.dispatchEvent(new CustomEvent('live:ok', { detail: { view: S.srcView } }));
      window.dispatchEvent(new CustomEvent('live:swap', { detail: { id: src.id, kind: src.kind, code: src.code, why } }));
      say('Playing ' + src.title); syncTransport(); return true;
    } catch (e) { say('Swap failed: ' + (e && e.message ? e.message : e), true); return false; }
  }));
}
function onViewChanged() { if (S.playing && S.follow && EDIT_VIEWS.includes(S.view) && S.view !== S.srcView) swapTo(currentSource(), 'tab ' + S.view); }
function liveCode(view = S.view) {
  clearTimeout(codeT);
  codeT = setTimeout(async () => {
    if (S.playing && EDIT_VIEWS.includes(view) && view !== playView()) { syntaxCheck(view); return; }
    if (!S.live || !S.playing || S.busy) return; const src = currentSource(); if (!src || src.empty) return;
    try {
      await Engine.swap(src.code); Engine.evalCount++; S.playingId = src.id;
      setLiveChip('live'); window.dispatchEvent(new CustomEvent('live:ok', { detail: { view: S.view } }));
      window.dispatchEvent(new CustomEvent('live:swap', { detail: { id: src.id, kind: src.kind, code: src.code } }));
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 140);
      const off = src.kind === 'solo' && src.code !== recipeCode(cur()) ? (src.code.split('\n').length - recipeCode(cur()).split('\n').length) : 0;
      const ln = errLine(e); setLiveChip('error', msg);
      window.dispatchEvent(new CustomEvent('live:error', { detail: { view: S.view, line: ln ? ln - off : null, message: msg } }));
    }
  }, 300);
}
function liveUpdate() { clearTimeout(liveT); liveT = setTimeout(() => { if (!S.playing) return; const src = currentSource(); if (src && (src.id === S.playingId || src.kind === 'stack')) swapTo(src, 'update'); }, 160); }

/* ---------- browser ---------- */
const norm = (s) => s.toLowerCase();
function matches(r) {
  if (S.vonly && !r.verified) return false;
  for (const l of S.chips) if (!r.labels.includes(l)) return false;
  const q = norm(S.q.trim()); if (!q) return true;
  const hay = norm([r.title, r.intent, r.notes, r.code, ...r.labels.flatMap((l) => [l, ...(S.labelsById[l] ? S.labelsById[l].words : [])])].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
function renderList(keepId) {
  const prevId = keepId || (cur() && cur().id);
  S.filtered = S.recipes.filter(matches);
  const idx = S.filtered.findIndex((r) => r.id === prevId); S.sel = idx >= 0 ? idx : 0;
  const list = $('#list');
  if (!S.filtered.length) list.replaceChildren(el('li', { class: 'empty' }, 'No recipe matches. Clear filters with Esc.'));
  else list.replaceChildren(...S.filtered.map((r, i) => {
    const inStack = S.stack.some((l) => l.id === r.id);
    return el('li', { 'data-id': r.id, 'aria-current': i === S.sel ? 'true' : 'false', class: S.playing && r.id === S.playingId ? 'playing' : null },
      el('button', { type: 'button', class: 'row', 'data-i': i, title: r.intent },
        el('span', { class: 'n', 'aria-hidden': 'true' }, String(S.recipes.indexOf(r) + 1).padStart(2, '0')), el('span', { class: 't' }, r.title),
        el('span', { class: 'k' + (r.verified ? ' ok' : '') }, r.verified ? 'ok' : r.needs_samples ? 'smp' : '·')),
      el('button', { type: 'button', class: 'add', 'data-add': r.id, 'aria-pressed': inStack ? 'true' : 'false', disabled: !r.expr, 'aria-label': (inStack ? 'Remove ' : 'Add ') + r.title + (inStack ? ' from stack' : ' to stack'), title: r.expr ? 'Stack (A)' : 'Uses top-level statements: solo only' }, inStack ? '−' : '+'));
  }));
  $('#count').textContent = `${S.filtered.length} / ${S.recipes.length} recipes`;
  const n = S.chips.size + (S.vonly ? 1 : 0); $('#filterCount').textContent = n ? String(n) : '';
  renderSelection(false);
}
function select(i, { scroll = true, audition = true } = {}) {
  if (!S.filtered.length) return;
  S.sel = (i + S.filtered.length) % S.filtered.length;
  $$('#list li').forEach((li, j) => li.setAttribute('aria-current', j === S.sel ? 'true' : 'false'));
  if (scroll) { const li = $$('#list li')[S.sel]; if (li) li.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' }); }
  renderSelection(true);
  if (audition && S.playing && S.view === 'rack') play();
}
function renderSelection(updateHash) {
  const r = cur(); const code = $('#code'); const ins = $('#inspector');
  if (!r) { code.value = ''; ins.replaceChildren(el('p', {}, 'Nothing selected.')); syncTransport(); return; }
  if (document.activeElement !== code) code.value = recipeCode(r);
  $('#dirty').hidden = S.edits[r.id] == null; $('#revertBtn').disabled = S.edits[r.id] == null;
  if (r.bpm_hint && r.bpm_hint !== S.tempo) { tempoK.set(r.bpm_hint, false); S.tempo = r.bpm_hint; updateStackCode(); }
  const labs = r.labels.map((l) => el('span', { class: 'tag' }, S.labelsById[l] ? S.labelsById[l].title : l));
  const inStack = S.stack.some((l) => l.id === r.id);
  ins.replaceChildren(...[
    el('h2', {}, 'Inspector'), el('p', { class: 'title' }, r.title), el('p', { class: 'intent', html: mdInline(r.intent.charAt(0).toUpperCase() + r.intent.slice(1)) }),
    el('div', { class: 'badges' }, r.verified ? el('span', { class: 'badge ok' }, 'Rendered OK') : el('span', { class: 'badge dim' }, r.needs_samples ? 'Sample banks · not headless-checked' : 'Not verified'),
      r.unverified.length ? el('span', { class: 'badge warn', title: r.unverified.join(', ') }, 'Docs unverified: ' + r.unverified.join(', ')) : null,
      hasOwnTempo(r.code) ? el('span', { class: 'badge dim' }, 'Tempo in code: knob rewrites setcpm') : null),
    r.verified ? el('div', { class: 'meas' }, el('div', {}, el('i', {}, 'RMS'), el('b', {}, r.rms_dbfs + ' dBFS')), el('div', {}, el('i', {}, 'Centroid'), el('b', {}, r.centroid_hz + ' Hz'))) : null,
    el('div', { class: 'tags' }, labs),
    r.notes ? el('p', { html: mdInline(r.notes) }) : null,
    r.needs_samples ? el('p', {}, 'Loads drum-machine sample banks on first play (network).') : null,
    el('div', { class: 'acts' },
      el('button', { type: 'button', class: 'ghost', onclick: (e) => copyText(recipeCode(r), e.currentTarget) }, 'Copy ', el('kbd', {}, 'C')),
      el('a', { class: 'btn ghost', href: strudelUrl(recipeCode(r)), target: '_blank', rel: 'noopener' }, 'strudel.cc ', el('kbd', {}, 'O')),
      r.expr ? el('button', { type: 'button', class: 'ghost', onclick: () => toggleStack(r.id) }, inStack ? 'Unstack' : 'Stack', ' ', el('kbd', {}, 'A')) : null),
    el('p', { class: 'src' }, 'Source: ', el('a', { href: r.source, rel: 'noopener', target: '_blank' }, r.source.replace(/^https?:\/\//, '')))].filter(Boolean));
  if (updateHash && S.view === 'rack') history.replaceState(null, '', '#r/' + r.id);
  syncTransport();
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch (e) { const t = el('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch (e2) { /* ignore */ } t.remove(); }
  say('Copied to clipboard'); if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 600); }
}

/* filters */
function buildFilters() {
  $('#filters').replaceChildren(...S.cat.categories.map((c) => el('div', { class: 'fgroup' }, el('h3', {}, c.title),
    el('div', { class: 'chips' }, S.cat.labels.filter((l) => l.category === c.id).map((l) => el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-label': l.id, title: l.words.join(', ') }, l.title))))));
  if (matchMedia('(min-width: 761px)').matches) $('#filtersBox').open = false;
}

/* ---------- stack ---------- */
function saveStack() { store.set('stack', S.stack); }
function setStack(next, label) {
  const before = JSON.stringify(S.stack), after = JSON.stringify(next); if (before === after) return;
  const apply = (json) => { S.stack = JSON.parse(json); saveStack(); renderStack(); renderList(); if (S.playingSource === 'stack') liveUpdate(); };
  History.push({ label, undo: () => apply(before), redo: () => apply(after) }); apply(after);
}
function toggleStack(id) { const r = byId(id); if (!r || !r.expr) return say('“' + (r ? r.title : id) + '” uses top-level statements and plays solo only.', true); const has = S.stack.some((l) => l.id === id); setStack(has ? S.stack.filter((l) => l.id !== id) : [...S.stack, { id, on: true, db: 0 }], (has ? 'unstack ' : 'stack ') + r.title); say((has ? 'Removed from' : 'Added to') + ' stack: ' + r.title); }
function renderStack() {
  const ls = stackLayers(); const ol = $('#layers');
  $('#stackCount').textContent = ls.length ? String(ls.length) : '';
  if (!ls.length) ol.replaceChildren(el('li', { class: 'empty' }, 'No layers yet.'));
  else ol.replaceChildren(...ls.map((l, i) => {
    const k = knob({ label: 'Level', min: -24, max: 6, step: 0.5, value: l.db || 0, def: 0, cls: 'sm', fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', onChange: (v) => { S.stack[i] = { ...S.stack[i], db: v }; saveStack(); updateStackCode(); if (S.playingSource === 'stack') liveUpdate(); } });
    k.root.setAttribute('aria-label', 'Level of ' + l.r.title);
    return el('li', { class: 'layer' + (l.on ? '' : ' muted') },
      el('button', { type: 'button', class: 'mute', 'aria-pressed': l.on ? 'false' : 'true', 'aria-label': (l.on ? 'Mute ' : 'Unmute ') + l.r.title, onclick: () => { const nx = S.stack.map((x, j) => (j === i ? { ...x, on: !x.on } : x)); setStack(nx, (l.on ? 'mute ' : 'unmute ') + l.r.title); } }, l.on ? 'ON' : 'M'),
      el('span', { class: 'lname', title: l.r.title }, l.r.title), k.root,
      el('button', { type: 'button', class: 'rm', 'aria-label': 'Remove ' + l.r.title, onclick: () => setStack(S.stack.filter((_, j) => j !== i), 'unstack ' + l.r.title) }, '×'));
  }));
  updateStackCode();
}
function stackText() { return S.stackEdit != null ? S.stackEdit : stackProgram(); }
function updateStackCode() { const ta = $('#stackCode'); if (document.activeElement !== ta) S.stackEdit = null; const code = stackText(); if (document.activeElement !== ta) ta.value = code; $('#stackOpen').href = strudelUrl(code); syncTransport(); }

/* ---------- docs views ---------- */
async function loadDoc(name, root, toc, q) {
  const d = await loadJSON(name); const secs = [];
  d.sections.forEach((s, si) => {
    const id = name + '-' + si; const sec = el('section', { id }); if (s.title) sec.append(el('h3', {}, s.title)); const rows = [];
    for (const b of s.blocks) {
      if (b.type === 'html') sec.append(el('div', { html: b.html }));
      else { const tb = el('tbody'); for (const r of b.rows) { const tr = el('tr'); for (const c of r) tr.append(el('td', { html: c })); tb.append(tr); rows.push(tr); }
        sec.append(el('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': (s.title || name) + ' table' }, el('table', {}, el('thead', {}, el('tr', {}, b.columns.map((c) => el('th', { scope: 'col' }, c)))), tb))); }
    }
    secs.push({ sec, rows, title: s.title, id });
  });
  $$('a', root).forEach((a) => a.setAttribute('rel', 'noopener'));
  root.replaceChildren(...secs.map((s) => s.sec));
  $$('a', root).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  toc.replaceChildren(el('h2', { style: 'padding:6px 10px' }, 'Sections'), ...secs.filter((s) => s.title).map((s) => el('a', { href: '#' + s.id, onclick: (e) => { e.preventDefault(); document.getElementById(s.id).scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' }); } }, s.title)));
  q.addEventListener('input', () => { const w = norm(q.value).split(/\s+/).filter(Boolean); for (const s of secs) { let any = false; for (const tr of s.rows) { const ok = w.every((x) => norm(tr.textContent).includes(x)); tr.hidden = !ok; any = any || ok; } const txt = norm(s.sec.textContent); s.sec.hidden = w.length > 0 && !(s.rows.length ? any : w.every((x) => txt.includes(x))); } });
}
const docsLoaded = {};
function ensureDoc(view) {
  if (docsLoaded[view]) return; docsLoaded[view] = true;
  const p = view === 'ref' ? loadDoc('plugins', $('#refDoc'), $('#refToc'), $('#refQ')) : loadDoc('practices', $('#pracDoc'), $('#pracToc'), $('#pracQ'));
  p.catch((e) => { docsLoaded[view] = false; say('Could not load ' + view + ': ' + e.message, true); });
}
async function loadJSON(name) { const r = await fetch('data/' + name + '.json'); if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.json(); }

/* ---------- views + routing ---------- */
const VIEWS = ['rack', 'stack', 'ref', 'practice'];
function setView(v, { push = true } = {}) {
  if (!VIEWS.includes(v)) v = 'rack';
  S.view = v; $('#main').dataset.view = v;
  $$('.views a').forEach((a) => (a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (v === 'ref' || v === 'practice') ensureDoc(v);
  if (push) history.replaceState(null, '', v === 'rack' && cur() ? '#r/' + cur().id : '#' + v);
  syncTransport(); Viz.drawAll(performance.now()); onViewChanged();
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (VIEWS.includes(h)) return setView(h, { push: false });
  const id = h.startsWith('r/') ? h.slice(2) : h;
  const i = S.filtered.findIndex((r) => r.id === id);
  setView('rack', { push: false }); if (i >= 0) select(i, { audition: false });
}

/* ---------- keyboard ---------- */
const KEYS = [
  ['Space', 'Play / stop'], ['↑ ↓  or  K J', 'Previous / next recipe (auditions while playing)'], ['Enter', 'Play the selected recipe'],
  ['[  ]', 'Tempo −1 / +1 BPM (Shift: ±10)'], ['−  =', 'Master −1 / +1 dB'], ['A', 'Add / remove selected recipe in the stack'],
  ['1 2 3 4', 'Rack / Stack / Ref / Practice'], ['/', 'Search recipes'], ['Esc', 'Clear search, close dialog, leave a field'],
  ['Ctrl/⌘ + Enter', 'Run the code in the editor'], ['Ctrl/⌘ + Z', 'Undo knob or stack change (Shift: redo)'],
  ['C', 'Copy code'], ['O', 'Open in strudel.cc'], ['T', 'Toggle theme'], ['H', 'Version history (undo, timeline, diff, search)'], ['?', 'This cheat sheet'],
];
function isField(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
function onKey(e) {
  const t = e.target, mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); runEditor(); return; }
  if (isField(t)) {
    if (e.key === 'Escape') { if (document.querySelector('.cm-tooltip-autocomplete')) return; if (t.type === 'search' && t.value) { t.value = ''; t.dispatchEvent(new Event('input')); } else t.blur(); e.preventDefault(); }
    else if (t.id === 'q' && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); t.blur(); const b = $$('#list .row')[S.sel]; if (b) b.focus(); if (e.key === 'Enter') play(); }
    return;
  }
  if ($('#help').open) return;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? History.redo() : History.undo(); return; }
  if (mod && e.key === 'y') { e.preventDefault(); History.redo(); return; }
  if (mod || e.altKey) return;
  const k = e.key;
  const act = {
    ' ': toggle, Enter: () => { if (t && t.closest && t.closest('.add, .inspector button, .layer button, a, .tools button, .tp-btn, .play, summary, .chip, #clear, #evalBtn, #revertBtn, #stackClear, #stackCopy')) return 'native'; play(); },
    ArrowDown: () => moveSel(1), ArrowUp: () => moveSel(-1), j: () => moveSel(1), k: () => moveSel(-1),
    '[': () => tempoK.nudge(e.shiftKey ? -10 : -1), ']': () => tempoK.nudge(e.shiftKey ? 10 : 1), '{': () => tempoK.nudge(-10), '}': () => tempoK.nudge(10),
    '-': () => masterK.nudge(-1), '=': () => masterK.nudge(1), '+': () => masterK.nudge(1), _: () => masterK.nudge(-1),
    a: () => cur() && toggleStack(cur().id), A: () => cur() && toggleStack(cur().id),
    1: () => setView('rack'), 2: () => setView('stack'), 3: () => setView('ref'), 4: () => setView('practice'),
    '/': () => { const q = $('#q'); if (S.view === 'ref') $('#refQ').focus(); else if (S.view === 'practice') $('#pracQ').focus(); else { q.focus(); q.select(); } },
    Escape: () => { if (S.q || S.chips.size || S.vonly) clearFilters(); },
    c: () => { const s = currentSource(); if (s) copyText(S.view === 'stack' ? stackText() : recipeCode(cur())); },
    o: () => { const code = S.view === 'stack' ? stackText() : cur() && recipeCode(cur()); if (code) window.open(strudelUrl(code), '_blank', 'noopener'); },
    t: toggleTheme, '?': openHelp,
  }[k];
  if (!act) return;
  if (k === ' ' && t && t.closest && t.closest('.knob')) { /* space on knob still toggles */ }
  if (act() === 'native') return;
  e.preventDefault();
}
function moveSel(d) { select(S.sel + d); const b = $$('#list .row')[S.sel]; if (b && document.activeElement && document.activeElement.classList.contains('row')) b.focus({ preventScroll: true }); }
function runEditor() {
  if (S.view === 'stack') { S.stackEdit = $('#stackCode').value; play(); return; }
  const ta = document.activeElement && document.activeElement.id === 'code' ? document.activeElement : $('#code');
  const r = cur(); if (!r) return; commitEdit(ta.value);
  if (S.view !== 'rack') setView('rack'); play();
}
function commitEdit(val) { const r = cur(); if (!r) return; if (val === r.code) delete S.edits[r.id]; else S.edits[r.id] = val; $('#dirty').hidden = S.edits[r.id] == null; $('#revertBtn').disabled = S.edits[r.id] == null; store.set('edits', S.edits); }
function clearFilters() { S.q = ''; $('#q').value = ''; S.chips.clear(); S.vonly = false; $('#vonly').checked = false; $$('.chip').forEach((b) => b.setAttribute('aria-pressed', 'false')); renderList(); say('Filters cleared'); }

/* ---------- theme / help ---------- */
function toggleTheme() { const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = next; try { localStorage.setItem('sc.theme', next); } catch (e) { /* ignore */ } $('meta[name="theme-color"]').content = next === 'light' ? '#efece6' : '#0b0d10'; Viz.readColors(); Viz.drawAll(performance.now()); say('Theme: ' + next); }
function openHelp() { const d = $('#help'); if (!d.open) d.showModal(); }

/* ---------- boot ---------- */
async function boot() {
  statusEl = $('#status');
  tempoK = knob({ label: 'Tempo', min: TEMPO.min, max: TEMPO.max, step: 1, value: S.tempo, def: TEMPO.def, fmt: (v) => v + ' BPM', onChange: (v) => { S.tempo = v; store.set('tempo', v); updateStackCode(); liveUpdate(); } });
  masterK = knob({ label: 'Master', min: MASTER.min, max: MASTER.max, step: 0.5, value: S.master, def: MASTER.def, fmt: (v) => (v <= MASTER.min ? '-inf' : (v > 0 ? '+' : '') + v.toFixed(1)) + ' dB', onChange: (v) => { S.master = v; store.set('master', v); setMaster(v); } });
  $('#tempoKnob').replaceWith(tempoK.root); $('#masterKnob').replaceWith(masterK.root);
  $('#keys').replaceChildren(...KEYS.flatMap(([k, d]) => [el('dt', {}, el('kbd', {}, k)), el('dd', {}, d)]));
  Viz.init();

  // events
  $('#playBtn').addEventListener('click', toggle);
  $('#prevBtn').addEventListener('click', () => select(S.sel - 1)); $('#nextBtn').addEventListener('click', () => select(S.sel + 1));
  $('#themeBtn').addEventListener('click', toggleTheme); $('#helpBtn').addEventListener('click', openHelp); $('#helpClose').addEventListener('click', () => $('#help').close());
  $('#help').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#list').addEventListener('click', (e) => {
    const add = e.target.closest('.add'); if (add) { toggleStack(add.dataset.add); return; }
    const row = e.target.closest('.row'); if (row) { const i = +row.dataset.i; if (i === S.sel && !S.playing) play(); else select(i, { scroll: false }); }
  });
  $('#list').addEventListener('dblclick', (e) => { if (e.target.closest('.row')) play(); });
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderList(); });
  $('#vonly').addEventListener('change', (e) => { S.vonly = e.target.checked; renderList(); });
  $('#clear').addEventListener('click', clearFilters);
  $('#filters').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; const id = b.dataset.label; const on = !S.chips.has(id); on ? S.chips.add(id) : S.chips.delete(id); b.setAttribute('aria-pressed', on); renderList(); });
  const code = $('#code');
  code.addEventListener('input', () => { commitEdit(code.value); liveCode('rack'); });
  $('#followBtn').addEventListener('click', () => { S.follow = !S.follow; store.set('follow', S.follow); say(S.follow ? 'Transport follows the visible tab' : 'Transport locked to ' + (S.srcView || 'rack')); syncTransport(); onViewChanged(); });
  $('#liveChip').addEventListener('click', () => { S.live = !S.live; try { store.set('live', S.live ? 'on' : 'off'); } catch (e) { /* ignore */ } $('#liveChip').setAttribute('aria-pressed', S.live); setLiveChip(S.live ? (S.playing ? 'live' : 'paused') : 'off'); if (S.live) liveCode(); });
  $('#liveChip').setAttribute('aria-pressed', S.live);
  const sc = $('#stackCode'); sc.addEventListener('input', () => { S.stackEdit = sc.value === stackProgram() ? null : sc.value; store.set('stackEdit', S.stackEdit); $('#stackOpen').href = strudelUrl(stackText()); liveCode('stack'); });
  $('#evalBtn').addEventListener('click', runEditor);
  $('#revertBtn').addEventListener('click', () => { const r = cur(); if (!r) return; delete S.edits[r.id]; store.set('edits', S.edits); code.value = r.code; renderSelection(false); liveUpdate(); });
  $('#stackCopy').addEventListener('click', (e) => copyText(stackText(), e.currentTarget));
  $('#stackClear').addEventListener('click', () => setStack([], 'clear stack'));
  $$('.views a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setView(a.dataset.view); }));
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', (e) => { if (e.key === ' ' && !isField(e.target) && !$('#help').open) e.preventDefault(); });
  window.addEventListener('hashchange', route);
  const onScheme = () => { Viz.readColors(); Viz.drawAll(performance.now()); }; reducedMotion.addEventListener('change', onScheme);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Bus.ctx && Bus.ctx.state === 'suspended' && S.playing) say('Audio paused by the browser. Press Play to resume.', true); });

  // data
  try {
    S.cat = await loadJSON('catalog');
    S.labelsById = Object.fromEntries(S.cat.labels.map((l) => [l.id, l])); S.recipes = S.cat.recipes;
    buildFilters(); renderList(); renderStack(); route();
    say(`${S.recipes.length} recipes loaded. Press Play or Space.`);
  } catch (e) { say('Failed to load recipes: ' + e.message, true); $('#nowTitle').textContent = 'Offline'; }

  fetch('build.json', { cache: 'no-store' }).then((r) => r.json()).then((b) => { const e = $('#buildBadge'); if (e) { e.textContent = b.sha === 'dev' ? 'dev' : b.sha + (b.date ? ' ' + b.date : ''); e.title = 'Build ' + b.sha + (b.date ? ', ' + b.date : ''); } }).catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const offer = (w) => { if (!w || offer.shown) return; offer.shown = true; window.strudelCraft.ui.toast('New version, tap to reload', { kind: 'info', sticky: true, onClick: () => w.postMessage('SKIP_WAITING') }); };
    let reloading = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && offer.shown) { reloading = true; location.reload(); } });
    const reg = () => navigator.serviceWorker.register('sw.js').then((r) => {
      if (r.waiting && navigator.serviceWorker.controller) offer(r.waiting);
      r.addEventListener('updatefound', () => { const w = r.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
    }).catch(() => { /* optional */ });
    'requestIdleCallback' in window ? requestIdleCallback(reg, { timeout: 4000 }) : setTimeout(reg, 2000);
  }
}
window.__sc = { S, Engine, Bus, play, stop, select, setView, History, toggleStack };
document.addEventListener('DOMContentLoaded', boot);
