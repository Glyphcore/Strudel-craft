/* Timeline (#175): the rolling DAW-style arrangement view that replaces the fixed one-cycle lane strip under the scope.
   One continuous time axis in bars (1 cycle = 1 bar), a ruler, lane rows (a Mix row on top, then one row per sound the pattern plays),
   a playhead tied to the transport clock, loop region from the transport range, and regions per lane. No solid cell fills:
   an empty lane is a baseline with bar ticks and a thin region outline. Waveform regions (#195): a lane draws a waveform at full lane height
   inside the spans of its events (onset to end of each hap). The audio comes from the render-ahead stem of that lane (renderahead.js) or, while
   that chunk is not ready, from the live tap (an AnalyserNode on the master bus, min / max per 1/64 cycle as the playhead passes; the tap is the
   master signal, shown in a lane only inside that lane's events, dimmer). A span with no audio known yet is a flat centre line. No pitch marks.
   The Mix row: the latest take (offline render or capture; peaks computed in short idle slices, cache per audio hash), else the render-ahead
   mix chunks, else the live tap.
   Scroll: native (momentum on touch). Follow modes: fixed (playhead stays at a set x, content scrolls under it), rolling (playhead moves,
   the view pages at the right edge), free. Manual pan or zoom suspends follow until the Follow button is tapped.
   Cost rules (#176/#180): the canvas size comes from a ResizeObserver, scroll offsets from a scroll listener, colours are read on theme
   change only, a frame redraws only when its pixels would differ (dirty flag), the loop runs only while playing and visible.
   Lazy: loaded after the first frame (index.html LATER); styles in timeline.css (loaded here). API: window.strudelCraft.timeline.
   Playhead time = scheduler cycle minus the audio output latency (AudioContext.outputLatency where the browser reports it, else 0).
   Lookahead (#195): the world ends LOOK bars past the program's specified end (capture.resolveEnd: gates, marker "end", "// @daw bars=N", loop end)
   or past the playhead for an open-ended program. What lies past the specified end is the pattern's projection: drawn ghosted, never written
   to the program. Reaching the right edge by hand (wheel, drag, touch, ArrowRight, End) extends the world to the next 5-minute mark (cap 60 min);
   the ruler shows bar numbers in the specified part and mm:ss in the projection, with a flag at every 5-minute mark.
   Render-ahead (#195, renderahead.js, loaded only when its lead is > 0): buffered extent on the ruler, Mix waveform from the chunk peaks. */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const lsGet = (k, d) => { try { const v = localStorage.getItem('sc.tl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('sc.tl.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const root = $('#tl'), scr = $('#tlScroll'), cv = $('#lanes');
if (root && scr && cv && !sc.timeline) init();

function init() {
  { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('timeline.css', import.meta.url).href; document.head.append(l); }
  const g = cv.getContext('2d');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const RULER = 24, ROW = coarse ? 44 : 32, MINPPB = 6, MAXPPB = 260, B = 256 /* frames per peak bucket */;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = innerWidth < 600;
  const T = { ppb: clamp(lsGet('ppb', phone ? 56 : 72), MINPPB, MAXPPB), mode: lsGet('mode', phone ? 'fixed' : 'rolling'), fix: clamp(lsGet('fix', 0.35), 0.1, 0.8),
    suspended: false, W: 0, H: 0, dpr: 1, GUT: 60, sx: 0, sy: 0, vx: 0, lastWrite: -1, dirty: true, playing: false, t: 0, cursor: 0, sel: -1, key: '', raf: 0, total: 16,
    lanes: [], cyc: new Map(), cycMax: 0, audio: null, peaks: new Map(), cost: [], frames: 0, col: null, ro: null, pend: 0,
    segs: [], norm: new Map(), wv: { mixBuf: 0, mixLive: 0, laneBuf: 0, laneLive: 0, laneFlat: 0 }, look: 8, spec: null, rule: '', base: 16, ext: 0, steps: 0, G: Infinity, labels: [], userAt: -1e9 };
  const STEP_S = 300, MAX_S = 3600; /* lookahead scroll step and cap, seconds */
  if (!['fixed', 'rolling', 'off'].includes(T.mode)) T.mode = 'rolling';
  const MODES = { fixed: ['Fixed', 'Playhead stays put, the arrangement scrolls under it'], rolling: ['Rolling', 'The playhead moves across the view and the view pages at the right edge'], off: ['Free', 'No follow: pan and zoom freely'] };

  /* ---------- DOM: toolbar and scroll extent (built here, so the shell carries only the empty container) ---------- */
  const bar = document.createElement('div'); bar.className = 'tl-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Timeline controls');
  const ico = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = { fixed: 'M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4', rolling: 'M4 12h13M13 7l5 5-5 5M20 4v16', off: 'M5 12h4M15 12h4M12 5v4M12 15v4' };
  bar.innerHTML = `<button type="button" class="tl-b tl-mode" data-act="mode"></button><button type="button" class="tl-b tl-follow" data-act="follow" aria-pressed="false">${ico('M12 4v6M12 14v6M4 12h6M14 12h6')}<span>Follow</span></button>`
    + `<button type="button" class="tl-b tl-sq" data-act="zo" aria-label="Zoom out" title="Zoom out (-)">${ico('M6 12h12')}</button><button type="button" class="tl-b tl-sq" data-act="zi" aria-label="Zoom in" title="Zoom in (+)">${ico('M6 12h12M12 6v12')}</button>`
    + `<button type="button" class="tl-b tl-fit" data-act="fit" title="Fit the whole length">Fit</button><span class="tl-sel" id="tlSel" role="status" aria-live="polite"></span>`;
  root.insertBefore(bar, scr);
  const sp = document.createElement('div'); sp.className = 'tl-sp'; scr.append(sp);
  const menu = document.createElement('div'); menu.className = 'tl-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); root.append(menu);
  scr.tabIndex = 0; scr.setAttribute('role', 'group'); scr.setAttribute('aria-label', 'Timeline: arrows scroll, plus and minus zoom, F follows, Up and Down pick a lane, Home goes to the start, End extends the lookahead to the next 5 minutes'); cv.removeAttribute('role'); cv.setAttribute('aria-hidden', 'true');
  const btn = (a) => bar.querySelector(`[data-act="${a}"]`);
  const selOut = $('#tlSel', bar);

  /* ---------- colours: read when the theme changes, not per frame ---------- */
  const readCol = () => { const cs = getComputedStyle(document.documentElement); const o = {}; for (const k of ['sig', 'sig-2', 'text', 'dim', 'faint', 'line', 'line-2', 'panel', 'panel-2', 'warn']) o[k] = cs.getPropertyValue('--' + k).trim() || '#888'; T.col = o; T.dirty = true; };
  new MutationObserver(() => { readCol(); invalidate(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  readCol();

  /* ---------- clock and data ---------- */
  const sched = () => { const s = sc.engineState && sc.engineState(); return s && s.scheduler; };
  const isPlaying = () => !!(sc.transport && sc.transport.playing);
  const latency = () => { const c = sc.transport && sc.transport.bus && sc.transport.bus.ctx; const l = c ? (c.outputLatency || 0) : 0; return l > 0 && l < 1 ? l : 0; };
  const cps = () => { const s = sched(); return (s && s.cps) || (sc.transport && sc.transport.cps) || 0.5; };
  function clockNow() { const s = sched(); if (!s) return T.t; let c = 0; try { c = s.now(); } catch (e) { c = 0; } return Math.max(0, (c || 0) - latency() * cps()); } /* #167: never negative */

  function laneIndex(name) { let i = T.lanes.indexOf(name); if (i < 0) { if (T.lanes.length >= 24) return 23; T.lanes.push(name); i = T.lanes.length - 1; layoutWorld(); } return i; }
  function queryCycle(c) {
    const s = sched(), pat = s && s.pattern; if (!pat) return false;
    let haps; const bg = sc.bg;
    try { const mh = bg && bg.cycleHaps ? bg.cycleHaps(c) : undefined; if (mh === 'pending') return false; haps = (mh || pat.queryArc(c, c + 1)).filter((h) => h.hasOnset && h.hasOnset()); } catch (e) { haps = []; }
    const out = [];
    for (const h of haps) {
      const v = h.value || {}; const name = typeof v === 'object' ? String(v.s != null ? v.s : (v.note != null || v.n != null ? 'synth' : 'event')) : 'event';
      const note = typeof v === 'object' ? (v.note != null ? v.note : v.n) : null;
      out.push({ b: Number(h.whole.begin), e: Number(h.whole.end), li: laneIndex(name), note: typeof note === 'number' ? note : null });
    }
    T.cyc.set(c, out); if (c > T.cycMax) T.cycMax = c; return true;
  }
  function setKey(k) { if (k === T.key) return; T.key = k; T.cyc.clear(); T.cycMax = 0; if (T.playing) T.lanes = []; T.dirty = true; refreshSpec(); }
  function ensure(c0, c1) { let n = 0; for (let c = Math.max(0, c0); c <= c1 && n < 6; c++) if (!T.cyc.has(c)) { if (!queryCycle(c)) break; n++; } if (n >= 6) T.more = true; if (T.cyc.size > 800) { for (const k of T.cyc.keys()) { if (k < c0 - 200 || k > c1 + 200) T.cyc.delete(k); } } }

  /* ---------- waveform of the Mix row: peaks per audio hash, computed in short slices ---------- */
  function setAudio(a, o = {}) { /* a = { L, R, sr }, o = { start (cycle), cycles, cps, hash, name } */
    if (!a || !a.L || !a.L.length) return null; const key = o.hash || (o.name || 'take') + ':' + a.L.length + ':' + a.sr;
    let p = T.peaks.get(key);
    if (!p) { const n = Math.ceil(a.L.length / B); p = { key, a, n, lo: new Float32Array(n), hi: new Float32Array(n), done: 0 }; T.peaks.set(key, p); if (T.peaks.size > 4) T.peaks.delete(T.peaks.keys().next().value); slice(p); }
    const k = o.cps || cps(); T.audio = { p, start: o.start || 0, cycles: o.cycles || a.L.length / a.sr * k, name: o.name || 'take' }; layoutWorld(); invalidate(); return key;
  }
  function slice(p) {
    const t0 = performance.now(); const { L, R } = p.a;
    while (p.done < p.n && performance.now() - t0 < 4) {
      const i0 = p.done * B, i1 = Math.min(L.length, i0 + B); let lo = 0, hi = 0;
      for (let i = i0; i < i1; i++) { const v = (L[i] + (R ? R[i] : L[i])) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; }
      p.lo[p.done] = lo; p.hi[p.done] = hi; p.done++;
    }
    invalidate(); if (p.done < p.n) setTimeout(() => slice(p), 0);
  }
  const bestAudio = (rec) => rec && rec.audio && (rec.audio.render || rec.audio.capture || rec.audio.remake) || null;
  async function useTake(id) {
    try { const { store } = await import('./recipe.js'); const rec = id ? await store.get(id) : (await store.list()).find((r) => bestAudio(r)); const a = bestAudio(rec); if (!a) return false;
      const tm = rec.recipe.timing || {}; const o = rec.recipe.outputs || {}; const h = (o.render && o.render.sha256) || (o.capture && o.capture.sha256);
      setAudio(a, { start: tm.start || 0, cycles: tm.cycles, cps: tm.cps, hash: h, name: rec.recipe.name }); return true; } catch (e) { return false; }
  }
  addEventListener('sc-take', (e) => { useTake(e.detail && e.detail.id); });

  /* ---------- live tap (#195): the master bus through an AnalyserNode, read once per frame while playing ---------- */
  const LB = 64, LV = { an: null, ctx: null, buf: null, m: new Map(), last: 0, k: -1 };
  function tap() {
    const bus = sc.transport && sc.transport.bus; if (!bus || !bus.node) return;
    if (LV.ctx !== bus.ctx) { LV.ctx = bus.ctx; try { const an = bus.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0; bus.node.connect(an); LV.an = an; LV.buf = new Float32Array(2048); } catch (e) { LV.an = null; } }
    if (!LV.an) return; const now = performance.now(), n = Math.min(2048, Math.max(64, Math.round((now - LV.last) / 1000 * LV.ctx.sampleRate))); LV.last = now;
    LV.an.getFloatTimeDomainData(LV.buf); let lo = 0, hi = 0; const b = LV.buf; for (let i = 2048 - n; i < 2048; i++) { const v = b[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const k = Math.floor(T.t * LB); let k0 = LV.k >= 0 && k > LV.k && k - LV.k <= 8 ? LV.k + 1 : k; LV.k = k; /* a frame longer than one bucket fills the buckets it skipped */
    for (; k0 <= k; k0++) {
      const c = Math.floor(k0 / LB), j = k0 - c * LB; let L = LV.m.get(c);
      if (!L) { L = { lo: new Float32Array(LB), hi: new Float32Array(LB), at: new Float64Array(LB) }; LV.m.set(c, L); if (LV.m.size > 720) LV.m.delete(LV.m.keys().next().value); }
      if (L.at[j] && now - L.at[j] < 400) { if (lo < L.lo[j]) L.lo[j] = lo; if (hi > L.hi[j]) L.hi[j] = hi; } else { L.lo[j] = lo; L.hi[j] = hi; } L.at[j] = now;
    }
  }
  /* waveform of cycles [ca, cb) in the box (top, h): lane = a lane name (its render-ahead stem, else the live tap) or null (Mix: mix chunk, else the live tap).
     One column per pixel, min..max; no data = a flat centre line (flat = false leaves it out). Levels are scaled by the largest peak seen for that source. */
  function wave(lane, ca, cb, top, h, ghost, flat) {
    const C = T.col, W = T.W, GUT = T.GUT, xa = Math.max(GUT, Math.floor(X(ca))), xb = Math.min(W, Math.ceil(X(cb))); if (xb <= xa) return;
    const half = h / 2 - 1, cy = top + h / 2, segs = T.segs, wv = T.wv, nk = lane == null ? '\u0000mix' : lane, ga = ghost ? 0.45 : 1; let si = 0, f0 = -1, mb = T.norm.get(nk) || 0.02, ml = T.norm.get('\u0000live') || 0.02, nb = 0, nl = 0, nf = 0;
    const line = (a, b) => { if (flat) { g.globalAlpha = 0.5 * ga; g.fillRect(a, Math.round(cy), b - a, 1); nf += b - a; } };
    g.fillStyle = C['sig-2'];
    for (let x = xa; x < xb; x++) {
      const c = cycAt(x), c2 = cycAt(x + 1); let lo = 0, hi = 0, src = 0;
      while (si < segs.length && segs[si].c1 <= c) si++;
      const sg = si < segs.length && segs[si].c0 <= c ? segs[si] : null, q = sg && (lane == null ? (sg.st === 'ready' ? sg.e : null) : sg.stems && sg.stems[lane]);
      if (q) { const sp = sg.c1 - sg.c0, b0 = clamp(Math.floor((c - sg.c0) / sp * q.n), 0, q.n - 1), b1 = clamp(Math.floor((c2 - sg.c0) / sp * q.n), b0, q.n - 1); for (let b = b0; b <= b1; b++) { if (q.lo[b] < lo) lo = q.lo[b]; if (q.hi[b] > hi) hi = q.hi[b]; } src = 1; }
      else if (LV.m.size) { const k0 = Math.floor(c * LB), k1 = Math.min(k0 + 16, Math.max(k0, Math.floor(c2 * LB - 1e-9))); for (let k = k0; k <= k1; k++) { const cc = Math.floor(k / LB), L = LV.m.get(cc); if (!L) continue; const j = k - cc * LB; if (!L.at[j]) continue; if (L.lo[j] < lo) lo = L.lo[j]; if (L.hi[j] > hi) hi = L.hi[j]; src = 2; } }
      if (!src) { if (f0 < 0) f0 = x; continue; }
      if (f0 >= 0) { line(f0, x); f0 = -1; }
      const pk = Math.max(hi, -lo); let m; if (src === 1) { if (pk > mb) mb = pk; m = mb; nb++; } else { if (pk > ml) ml = pk; m = ml; nl++; }
      g.globalAlpha = (src === 1 ? 0.9 : 0.55) * ga; const t = cy - Math.min(1, hi / m) * half, bt = cy - Math.max(-1, lo / m) * half; g.fillRect(x, t, 1, Math.max(1, bt - t));
    }
    if (f0 >= 0) line(f0, xb); g.globalAlpha = 1; T.norm.set(nk, mb); T.norm.set('\u0000live', ml);
    if (lane == null) { wv.mixBuf += nb; wv.mixLive += nl; } else { wv.laneBuf += nb; wv.laneLive += nl; wv.laneFlat += nf; }
  }

  /* ---------- geometry ---------- */
  const worldW = () => Math.ceil(T.total * T.ppb + Math.max(0, T.W - T.GUT) * 0.7);
  const worldH = () => RULER + (T.lanes.length + 1) * ROW + 8;
  function layoutWorld() {
    const ext = (T.audio ? T.audio.start + T.audio.cycles : 0), rg = sc.range && sc.range.state;
    T.base = Math.max(16, Math.ceil((Math.max(T.t, T.cursor, ext, rg && rg.loop ? rg.end : 0, T.spec || 0) + T.look) / 8) * 8);
    T.total = Math.max(T.base, T.ext); T.G = T.spec != null ? T.spec : (T.ext > T.base ? T.base : Infinity); /* G: where the projection (ghost) starts */
    const w = worldW() + 'px', h = Math.max(worldH(), 1) + 'px';
    if (sp.style.width !== w) sp.style.width = w; if (sp.style.height !== h) sp.style.height = h;
  }
  /* lookahead (#195): the specified end, and the 5-minute extension steps */
  function refreshSpec() {
    let e = null, rule = '';
    try { const r = sc.capture && sc.capture.resolveEnd && sc.capture.resolveEnd(); if (r && r.cycle > 0 && r.rule !== 'period') { e = +r.cycle; rule = r.rule; } } catch (err) { /* capture not loaded: open-ended */ }
    if (e !== T.spec || rule !== T.rule) { T.spec = e; T.rule = rule; layoutWorld(); invalidate(); }
  }
  const atEdge = () => scr.scrollLeft + scr.clientWidth >= scr.scrollWidth - 2;
  function extend() {
    const k = cps(), sec = T.total / k; if (sec >= MAX_S - 0.5) return false;
    T.ext = Math.ceil(Math.min(MAX_S, (Math.floor(sec / STEP_S + 1e-6) + 1) * STEP_S) * k - 1e-6); T.steps++; layoutWorld(); invalidate(); return true;
  }
  const user = () => { T.userAt = performance.now(); };
  for (const ev of ['wheel', 'touchstart', 'touchmove', 'touchend', 'pointerdown']) /* not pointermove: the browser sends one after a layout change under a resting mouse */ scr.addEventListener(ev, user, { passive: true });
  { let tm = 0; const later = () => { clearTimeout(tm); tm = setTimeout(refreshSpec, 350); }; document.addEventListener('input', later, true); document.addEventListener('change', later, true); }
  const X = (c) => T.GUT + c * T.ppb - T.vx;
  const cycAt = (x) => (x - T.GUT + T.vx) / T.ppb;
  const view = () => (T.mode !== 'off' && !T.suspended && T.playing) ? T.vx : T.sx;

  function invalidate() { T.dirty = true; if (!T.raf) T.raf = requestAnimationFrame(frame); }
  function resize(w, h) {
    T.W = Math.round(w); T.H = Math.round(h); T.dpr = Math.min(2, devicePixelRatio || 1); T.GUT = T.W < 520 ? 60 : 104;
    cv.width = Math.round(T.W * T.dpr); cv.height = Math.round(T.H * T.dpr); cv.style.width = T.W + 'px'; cv.style.height = T.H + 'px'; layoutWorld(); invalidate();
  }
  T.ro = new ResizeObserver((es) => { for (const e of es) { const r = e.contentRect; if (r.width && r.height && (Math.round(r.width) !== T.W || Math.round(r.height) !== T.H)) resize(r.width, r.height); } }); T.ro.observe(scr);
  scr.addEventListener('scroll', () => {
    const sl = scr.scrollLeft; T.sy = scr.scrollTop;
    if (Math.abs(sl - T.lastWrite) > 1.5) { T.sx = sl; if (T.playing && T.mode !== 'off' && !T.suspended) suspend(); T.vx = sl; if (performance.now() - T.userAt < 3000 && atEdge()) extend(); /* only a hand-made scroll extends the projection */ }
    else T.sx = sl;
    invalidate();
  }, { passive: true });

  /* ---------- follow ---------- */
  function suspend() { if (T.suspended) return; T.suspended = true; syncUi(); }
  function refollow() { T.suspended = false; if (T.mode === 'off') setMode('fixed'); syncUi(); if (T.playing) follow(true); invalidate(); }
  function setMode(m) { T.mode = m; lsSet('mode', m); T.suspended = false; syncUi(); if (T.playing || T.dirty) { follow(true); } invalidate(); }
  function writeScroll(x) { x = Math.max(0, Math.round(x)); if (x !== T.lastWrite) { T.lastWrite = x; scr.scrollLeft = x; } }
  function follow(force) {
    const vw = T.W - T.GUT, px = T.t * T.ppb;
    if (T.mode === 'fixed') T.vx = Math.max(0, px - T.fix * vw);
    else if (T.mode === 'rolling') { const sxp = T.GUT + px - T.vx; if (force || sxp > T.W - 10 || sxp < T.GUT - 1) T.vx = Math.max(0, px - 12); }
    else return;
    writeScroll(T.vx); T.sx = T.lastWrite;
  }
  function syncUi() {
    const m = btn('mode'), f = btn('follow'); const [lab, tip] = MODES[T.mode];
    m.innerHTML = ico(ICON[T.mode]) + '<span>' + lab + '</span>'; m.title = tip; m.setAttribute('aria-label', 'Playhead mode: ' + lab + '. Tap to change.');
    const on = T.mode !== 'off' && !T.suspended; f.setAttribute('aria-pressed', String(on)); f.dataset.state = T.mode === 'off' ? 'off' : T.suspended ? 'paused' : 'on';
    root.dataset.mode = T.mode; root.dataset.follow = T.mode === 'off' ? 'off' : T.suspended ? 'suspended' : 'on';
  }

  /* ---------- zoom ---------- */
  function setPpb(p, ax) {
    p = clamp(p, MINPPB, MAXPPB); if (Math.abs(p - T.ppb) < 0.01) return; T.userAt = -1e9; /* a zoom that clamps the scroll is not a scroll past the end */
    const a = ax == null ? T.GUT + (T.W - T.GUT) / 2 : ax, t = cycAt(a), cur = view();
    T.ppb = p; lsSet('ppb', +p.toFixed(2)); layoutWorld(); const nv = Math.max(0, t * p - (a - T.GUT));
    if (T.playing && T.mode !== 'off' && !T.suspended) follow(true); else { T.vx = nv; writeScroll(nv); T.sx = T.lastWrite; } void cur; invalidate();
  }
  const zoomBy = (k) => { if (T.playing && T.mode !== 'off') { /* zoom keeps following */ } setPpb(T.ppb * k, null); };
  function fit() { const len = Math.max(16, T.audio ? T.audio.start + T.audio.cycles : 0, (sc.range && sc.range.state && sc.range.state.loop) ? sc.range.state.end : 0, T.cycMax + 1); setPpb((T.W - T.GUT - 8) / len, T.GUT); T.vx = 0; writeScroll(0); T.sx = 0; T.suspended = true; syncUi(); invalidate(); }

  /* ---------- selection, seek, menu ---------- */
  const rowAt = (y) => { const i = Math.floor((y - RULER + T.sy) / ROW); return i >= 0 && i <= T.lanes.length ? i : -1; };
  const laneName = (i) => (i === 0 ? 'Mix' : T.lanes[i - 1]);
  function select(i) { T.sel = i; selOut.textContent = i >= 0 ? laneName(i) : ''; invalidate(); if (i >= 0) window.dispatchEvent(new CustomEvent('sc-lane-select', { detail: { lane: laneName(i), index: i, mix: i === 0 } })); }
  function seek(c) {
    c = Math.max(0, c); T.cursor = c; if (isPlaying() && sc.range && sc.range.seek) sc.range.seek(c); else { T.t = c; }
    if (!T.playing) T.t = c; layoutWorld(); invalidate();
  }
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let drag = null, press = null, lastDragEnd = 0;
  function closeMenu() { menu.hidden = true; menu.replaceChildren(); }
  function openMenu(x, y, li) {
    const t = Math.max(0, Math.floor(cycAt(x) * 4) / 4); const rs = sc.range && sc.range.state; const bar1 = Math.floor(t) + 1;
    const items = [['Seek here (bar ' + bar1 + ')', () => seek(t)], ['Loop starts here', () => loopEdge('start', t)], ['Loop ends here', () => loopEdge('end', t)], ['Playhead stays here', () => { T.fix = clamp((x - T.GUT) / (T.W - T.GUT), 0.1, 0.8); lsSet('fix', +T.fix.toFixed(3)); if (T.mode === 'off') setMode('fixed'); else { refollow(); } }]];
    if (li >= 0) items.unshift(['Select ' + laneName(li), () => select(li)]);
    if (li === 0) items.push(['Load latest take waveform', () => useTake(null)]);
    void rs; menu.replaceChildren(...items.map(([l, f]) => { const b = document.createElement('button'); b.type = 'button'; b.role = 'menuitem'; b.textContent = l; b.onclick = () => { closeMenu(); f(); }; return b; }));
    menu.hidden = false; const mw = 190; menu.style.left = clamp(x, 4, Math.max(4, root.clientWidth - mw - 4)) + 'px'; menu.style.top = clamp(y + 44, 44, Math.max(44, root.clientHeight - 4 * 44)) + 'px'; menu.firstChild.focus({ preventScroll: true });
  }
  function loopEdge(which, t) {
    const el = $(which === 'start' ? '#trStart' : '#trEnd'), rs = sc.range && sc.range.state; if (!el || !rs) return;
    const unit = rs.unit; el.value = unit === 'bar' ? String(+(t + 1).toFixed(2)) : unit === 'time' ? String(+(t / cps()).toFixed(2)) : String(+t.toFixed(2)); el.dispatchEvent(new Event('change', { bubbles: true }));
    invalidate();
  }
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); scr.focus({ preventScroll: true }); } });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);

  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = pt(e); press = { x, y, moved: false, id: e.pointerId, t: performance.now() };
    clearTimeout(press.lp); press.lp = setTimeout(() => { if (press && !press.moved) { const li = rowAt(y); const px = x; press.long = true; openMenu(px, y, y >= RULER ? li : -1); } }, 520);
    if (e.pointerType === 'mouse' && e.button === 0 && x > T.GUT) { drag = { x: e.clientX, y: e.clientY, sx: scr.scrollLeft, sy: scr.scrollTop }; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!press) return; const [x, y] = pt(e); if (Math.hypot(x - press.x, y - press.y) > 8) { press.moved = true; clearTimeout(press.lp); }
    if (drag && press.moved) { user(); scr.scrollLeft = drag.sx - (e.clientX - drag.x); scr.scrollTop = drag.sy - (e.clientY - drag.y); }
  });
  const endPress = () => { if (press) clearTimeout(press.lp); if (drag && press && press.moved) lastDragEnd = performance.now(); drag = null; };
  cv.addEventListener('pointerup', endPress); cv.addEventListener('pointercancel', () => { if (press) clearTimeout(press.lp); drag = null; });
  cv.addEventListener('click', (e) => {
    if (performance.now() - lastDragEnd < 60 || (press && (press.moved || press.long))) { press = null; return; } press = null;
    const [x, y] = pt(e); if (y < RULER) { if (x > T.GUT) seek(cycAt(x)); return; }
    const i = rowAt(y); if (i >= 0) select(i);
  });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (press) press.long = true; const [x, y] = pt(e); openMenu(x, y, y >= RULER ? rowAt(y) : -1); });

  /* wheel: ctrl/cmd zooms at the pointer; a horizontal wheel or shift pans (native); either is a manual move */
  scr.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const [x] = pt(e); suspend(); setPpb(T.ppb * Math.exp(-e.deltaY * 0.0025), x); return; }
    if (Math.abs(e.deltaX) > 0 || e.shiftKey) suspend();
  }, { passive: false });
  /* pinch (two touches) zooms around the midpoint; one finger scrolls natively and suspends follow */
  let pinch = null;
  scr.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { const [a, b] = e.touches; const r = cv.getBoundingClientRect(); pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ppb: T.ppb, ax: (a.clientX + b.clientX) / 2 - r.left }; suspend(); }
    else if (e.touches.length === 1 && T.playing && T.mode !== 'off') { /* a single touch only suspends once it actually scrolls (scroll listener) */ }
  }, { passive: true });
  scr.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { e.preventDefault(); const [a, b] = e.touches; setPpb(pinch.ppb * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d, pinch.ax); } }, { passive: false });
  scr.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; }, { passive: true });

  scr.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key; let used = true;
    if (k === 'ArrowRight' || k === 'ArrowLeft') { suspend(); const d = (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 4 : 1) * T.ppb; const nv = Math.max(0, view() + d); T.vx = nv; writeScroll(nv); T.sx = T.lastWrite; if (d > 0 && atEdge()) extend(); invalidate(); }
    else if (k === 'End') { suspend(); const nv = Math.max(0, scr.scrollWidth - scr.clientWidth); T.vx = nv; writeScroll(nv); T.sx = T.lastWrite; extend(); invalidate(); }
    else if (k === '+' || k === '=') { suspend(); zoomBy(1.25); } else if (k === '-' || k === '_') { suspend(); zoomBy(0.8); }
    else if (k === 'f' || k === 'F') refollow(); else if (k === 'Home') seek(0); else if (k === '0') fit();
    else if (k === 'ArrowDown') select(Math.min(T.lanes.length, T.sel + 1)); else if (k === 'ArrowUp') select(Math.max(0, T.sel < 0 ? 0 : T.sel - 1));
    else if (k === 'Enter' && T.sel >= 0) select(T.sel); else used = false;
    if (used) e.preventDefault();
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
    if (a === 'mode') setMode({ fixed: 'rolling', rolling: 'off', off: 'fixed' }[T.mode]);
    else if (a === 'follow') refollow(); else if (a === 'zi') { suspend(); zoomBy(1.25); } else if (a === 'zo') { suspend(); zoomBy(0.8); } else if (a === 'fit') fit();
  });

  /* ---------- drawing ---------- */
  const NICE = [1, 2, 4, 8, 16, 32, 64, 128], TSTEPS = [1, 2, 5, 10, 15, 30, 60, 150, 300];
  function draw() {
    const C = T.col, W = T.W, H = T.H, GUT = T.GUT, ppb = T.ppb, d = T.dpr, vx = view(), sy = T.sy;
    T.drawX = vx; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
    const rows = T.lanes.length + 1; const c0 = Math.floor(vx / ppb) - 1, c1 = Math.ceil((vx + W - GUT) / ppb) + 1;
    let step = 1; for (const s of NICE) { step = s; if (s * ppb >= 46) break; }
    g.font = '10px "JetBrains Mono", monospace'; g.textBaseline = 'alphabetic';
    /* rows area is clipped, so lanes scroll under the ruler and the header column */
    g.save(); g.beginPath(); g.rect(GUT, RULER, W - GUT, H - RULER); g.clip();
    /* bar grid */
    g.lineWidth = 1;
    for (let c = Math.max(0, c0); c <= c1; c++) {
      const x = Math.round(X(c)) + 0.5; const major = c % 4 === 0; if (c % step) { if (ppb >= 120) { g.strokeStyle = C.line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, H); g.stroke(); g.globalAlpha = 1; } continue; }
      g.strokeStyle = major ? C['line-2'] : C.line; g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, H); g.stroke();
      if (ppb >= 100) { g.strokeStyle = C.line; g.globalAlpha = 0.45; for (let q = 1; q < 4; q++) { const bx = Math.round(X(c + q / 4)) + 0.5; g.beginPath(); g.moveTo(bx, RULER); g.lineTo(bx, H); g.stroke(); } g.globalAlpha = 1; }
    }
    /* lane rows: baseline with bar ticks (the empty state), then regions */
    const nowC = T.playing ? T.t : -1;
    const play = T.playing; if (play || T.cyc.size || sched()) ensure(c0, c1); /* stopped too: the pattern of the last evaluation is the projection */
    T.segs = sc.ahead ? sc.ahead.view(Math.max(0, c0), c1 + 1) : []; { const wv = T.wv; wv.mixBuf = wv.mixLive = wv.laneBuf = wv.laneLive = wv.laneFlat = 0; }
    for (let i = 0; i < rows; i++) {
      const y0 = RULER + i * ROW - sy; if (y0 > H || y0 + ROW < RULER) continue; const mid = Math.round(y0 + ROW / 2) + 0.5;
      g.strokeStyle = C.line; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(GUT, Math.round(y0 + ROW) + 0.5); g.lineTo(W, Math.round(y0 + ROW) + 0.5); g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = C['line-2']; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(GUT, mid); g.lineTo(W, mid); g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = C.faint; g.beginPath(); for (let c = Math.max(0, c0); c <= c1; c++) { if (c % step) continue; const x = Math.round(X(c)) + 0.5; g.moveTo(x, mid - 3); g.lineTo(x, mid + 3); } g.stroke();
      if (i === 0) drawMix(y0, mid, vx); else drawLane(i, y0, c0, c1, nowC);
      if (i === T.sel) { g.strokeStyle = C.sig; g.globalAlpha = 0.9; g.strokeRect(GUT + 0.5, Math.round(y0) + 1.5, W - GUT - 1, ROW - 2); g.globalAlpha = 1; }
    }
    /* the specified end: a dashed line; what is right of it is the projection */
    if (T.G !== Infinity) { const xg = Math.round(X(T.G)) + 0.5; if (xg > GUT && xg < W) { g.strokeStyle = C.dim; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(xg, RULER); g.lineTo(xg, H); g.stroke(); g.setLineDash([]); } }
    /* loop region from the transport range */
    const rs = sc.range && sc.range.state;
    if (rs && rs.loop) { const xa = Math.round(X(rs.start)) + 0.5, xb = Math.round(X(rs.end)) + 0.5; g.strokeStyle = C.warn; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(xa, RULER); g.lineTo(xa, H); g.moveTo(xb, RULER); g.lineTo(xb, H); g.stroke(); g.setLineDash([]); }
    g.restore();
    /* ruler */
    g.fillStyle = C.panel; g.fillRect(GUT, 0, W - GUT, RULER); g.strokeStyle = C['line-2']; g.beginPath(); g.moveTo(GUT, RULER - 0.5); g.lineTo(W, RULER - 0.5); g.stroke();
    g.save(); g.beginPath(); g.rect(GUT, 0, W - GUT, RULER); g.clip(); g.fillStyle = C.dim;
    const G = T.G, labels = T.labels = [];
    for (let c = Math.max(0, c0); c <= c1; c++) { const x = Math.round(X(c)) + 0.5; const lab = c % step === 0 && c < G; g.strokeStyle = lab ? C.dim : C.line; g.beginPath(); g.moveTo(x, lab ? RULER - 9 : RULER - 4); g.lineTo(x, RULER); g.stroke(); if (lab) { g.fillText(String(c + 1), x + 3, 12); if (labels.length < 60) labels.push({ k: 'bar', text: String(c + 1), x }); } }
    { /* projection: mm:ss labels; a flag at every 5-minute mark on the whole ruler */
      const k = cps(), pps = ppb * k; let ts = 300; for (const s of TSTEPS) { if (s * pps >= 52) { ts = s; break; } }
      const mmss = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.round(t % 60)).padStart(2, '0');
      if (G < c1) { g.fillStyle = C.faint; g.strokeStyle = C.dim; for (let t = Math.ceil(Math.max(G, c0, 0) / k / ts - 1e-9) * ts; t * k <= c1; t += ts) { if (t % STEP_S === 0) continue; const x = Math.round(X(t * k)) + 0.5; g.beginPath(); g.moveTo(x, RULER - 9); g.lineTo(x, RULER); g.stroke(); g.fillText(mmss(t), x + 3, 12); if (labels.length < 60) labels.push({ k: 'time', text: mmss(t), x }); } }
      g.fillStyle = C['sig-2']; g.strokeStyle = C['sig-2']; for (let t = Math.max(STEP_S, Math.ceil(Math.max(c0, 0) / k / STEP_S) * STEP_S); t * k <= c1; t += STEP_S) { const x = Math.round(X(t * k)) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, RULER); g.stroke(); g.fillRect(x, 2, 5, 5); if (t * k >= G) g.fillText(mmss(t), x + 8, 12); labels.push({ k: 'mark', text: mmss(t), x }); }
      g.fillStyle = C.dim;
    }
    /* render-ahead buffers (#195): ready chunks as a bar along the top of the ruler, the chunk being rendered dimmer */
    for (const sg of T.segs) { if (!sg.e) continue; const xa = X(sg.c0), xb = X(sg.c1); g.fillStyle = sg.st === 'ready' ? C.sig : C.dim; g.globalAlpha = sg.st === 'ready' ? 0.85 : 0.6; g.fillRect(xa, 0, Math.max(1, xb - xa - 1), 3); g.globalAlpha = 1; }
    g.fillStyle = C.dim;
    if (rs && rs.loop) { const xa = X(rs.start), xb = X(rs.end); g.fillStyle = C.warn; g.globalAlpha = 0.9; g.fillRect(xa, RULER - 4, Math.max(2, xb - xa), 2); g.globalAlpha = 1; }
    g.restore();
    /* header column */
    g.fillStyle = C.panel; g.fillRect(0, 0, GUT, H); g.strokeStyle = C['line-2']; g.beginPath(); g.moveTo(GUT - 0.5, 0); g.lineTo(GUT - 0.5, H); g.stroke();
    g.fillStyle = C.faint; g.fillText('BAR', 6, 12);
    g.save(); g.beginPath(); g.rect(0, RULER, GUT - 1, H - RULER); g.clip();
    for (let i = 0; i < rows; i++) { const y0 = RULER + i * ROW - sy; if (y0 > H || y0 + ROW < RULER) continue; g.fillStyle = i === T.sel ? C.text : C.dim; g.fillText((i === 0 ? 'Mix' : T.lanes[i - 1]).slice(0, GUT > 80 ? 14 : 8), 6, y0 + ROW / 2 + 4); g.strokeStyle = C.line; g.beginPath(); g.moveTo(0, Math.round(y0 + ROW) + 0.5); g.lineTo(GUT, Math.round(y0 + ROW) + 0.5); g.stroke(); }
    g.restore();
    if (!T.lanes.length && !T.cyc.size) { g.fillStyle = C.faint; g.fillText(T.playing ? 'Listening for events' : 'Press play: lanes fill in here', GUT + 8, RULER + ROW * 1.5 + 4); }
    /* playhead (or the stopped cursor) */
    const px = Math.round(X(T.t)); if (px >= GUT - 1 && px <= W + 1) { g.fillStyle = C.sig; g.fillRect(px - 1, 0, 2, H); g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.closePath(); g.fill(); }
    T.px = px; T.dirty = false;
  }
  function drawMix(y0, mid, vx) {
    const C = T.col, a = T.audio, W = T.W, GUT = T.GUT; const h = ROW - 10; const ya = Math.round(y0) + 5;
    /* no take over a bar: the render-ahead mix chunks (the buffers the ruler shows), else the live tap (#195) */
    const v0 = Math.max(0, cycAt(GUT)), v1 = cycAt(W), wt = Math.round(y0) + 2, wh = ROW - 4;
    if (!a) { wave(null, v0, v1, wt, wh, false, false); if (!T.wv.mixBuf && !T.wv.mixLive) { g.fillStyle = C.faint; g.fillText('Play, render or capture: the waveform appears here', GUT + 8, mid - 6); } return; }
    if (a.start > v0) wave(null, v0, Math.min(v1, a.start), wt, wh, false, false); if (a.start + a.cycles < v1) wave(null, Math.max(v0, a.start + a.cycles), v1, wt, wh, false, false);
    const x0 = X(a.start), x1 = X(a.start + a.cycles);
    g.strokeStyle = C['sig-2']; g.globalAlpha = 0.6; g.strokeRect(Math.round(x0) + 0.5, ya + 0.5, Math.round(x1 - x0), h); g.globalAlpha = 1;
    const p = a.p, spb = p.a.sr * T.ppb ? (p.a.sr * (a.cycles / (p.a.L.length / p.a.sr))) / 1 : 0; void spb;
    const framesPerCycle = p.a.L.length / a.cycles; const fpx = framesPerCycle / T.ppb; /* frames per pixel */
    const xs = Math.max(GUT, Math.floor(x0)), xe = Math.min(W, Math.ceil(x1)); g.fillStyle = C['sig-2']; const half = h / 2 - 2, cy = ya + h / 2;
    for (let x = xs; x < xe; x++) {
      const f0 = (x - x0) * fpx, f1 = f0 + fpx; if (f1 < 0) continue; const b0 = Math.max(0, Math.floor(f0 / B)), b1 = Math.min(p.n - 1, Math.max(b0, Math.floor(f1 / B)));
      if (b0 >= p.done) break; let lo = 0, hi = 0; const e = Math.min(b1, p.done - 1); for (let b = b0; b <= e; b++) { if (p.lo[b] < lo) lo = p.lo[b]; if (p.hi[b] > hi) hi = p.hi[b]; }
      const top = cy - Math.min(1, hi * 1.4) * half, bot = cy - Math.max(-1, lo * 1.4) * half; g.fillRect(x, top, 1, Math.max(1, bot - top));
    }
    if (p.done < p.n) { const gx = x0 + (p.done * B / framesPerCycle) * T.ppb; if (gx > GUT && gx < W) { g.fillStyle = C.dim; g.fillRect(gx, ya + 2, 1, h - 4); } }
  }
  function drawLane(i, y0, c0, c1, nowC) {
    const C = T.col, li = i - 1; const top = Math.round(y0) + 2, h = ROW - 4; let run = -1; void nowC;
    const Gc = T.G === Infinity ? Infinity : Math.ceil(T.G - 1e-9), spans = [];
    const flush = (a, b) => { if (a < 0) return; const xa = Math.round(X(a)) + 0.5, xb = Math.round(X(b + 1)) + 0.5, gh = a >= Gc; g.strokeStyle = C['sig-2']; g.globalAlpha = gh ? 0.3 : 0.55; if (gh) g.setLineDash([3, 3]); g.strokeRect(xa, top + 0.5, xb - xa, h - 1); if (gh) g.setLineDash([]); g.globalAlpha = 1; };
    for (let c = Math.max(0, c0); c <= c1 + 1; c++) {
      const ev = c <= c1 ? T.cyc.get(c) : null; let has = false;
      if (ev) for (const e of ev) if (e.li === li) { has = true; spans.push([e.b, e.e]); }
      if (has) { if (run < 0) run = c; else if (c === Gc) { flush(run, c - 1); run = c; } } else if (run >= 0) { flush(run, c - 1); run = -1; }
    }
    if (run >= 0) flush(run, c1);
    /* waveform regions: the merged spans of this lane's events, split at the specified end (the projection is ghosted) */
    spans.sort((a, b) => a[0] - b[0]); const name = T.lanes[li], G = T.G; let a = -1, b = -1;
    const emit = (p, q) => { if (q <= p) return; if (p < G && q > G) { wave(name, p, G, top + 1, h - 2, false, true); wave(name, G, q, top + 1, h - 2, true, true); } else wave(name, p, q, top + 1, h - 2, p >= G, true); };
    for (const sp of spans) { if (sp[0] > b + 1e-6) { emit(a, b); a = sp[0]; b = sp[1]; } else if (sp[1] > b) b = sp[1]; }
    emit(a, b);
  }

  /* ---------- frame loop ---------- */
  function frame() {
    T.raf = 0; if (document.hidden) { return; }
    const t0 = performance.now(); const was = T.playing; T.playing = isPlaying();
    if (T.playing) {
      if (!was) { /* play starts: a cursor set while stopped is where it begins */ T.pend = T.cursor > 0.001 ? 40 : 0; }
      if (T.pend > 0 && sc.range && sc.range.seek) { T.pend--; if (sc.range.seek(T.cursor)) T.pend = 0; }
      const t = clockNow(); if (t !== T.t) { T.t = t; T.dirty = true; } tap();
      if (Math.floor(t) + 4 > T.total - 4) layoutWorld();
      if (T.mode !== 'off' && !T.suspended) { const ov = T.vx, ot = T.px; follow(false); if (ov !== T.vx || X(T.t) !== ot) T.dirty = true; }
      else if (T.px !== Math.round(X(T.t))) T.dirty = true;
    } else if (was) { T.cursor = T.t; T.dirty = true; syncUi(); }
    if (T.dirty && T.W) { draw(); T.frames++; }
    const dt = performance.now() - t0; if (T.dirty === false && (T.playing || dt > 0)) { T.cost.push(dt); if (T.cost.length > 2000) T.cost.splice(0, 1000); }
    const again = T.more; if (again) { T.more = false; T.dirty = true; } /* more cycles to query: next frame, also when stopped */
    if (T.playing && !document.hidden && !reduced.matches) T.raf = requestAnimationFrame(frame);
    else if (T.playing && reduced.matches) T.raf = setTimeout(() => { T.raf = 0; invalidate(); }, 100) && 0;
    else if (again && !T.raf) T.raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });

  /* the visuals loop calls ping() while it runs (it also carries the evaluation key); it starts ours when playing */
  function ping(key) { if (key != null) setKey(key); const p = isPlaying(); if (p !== T.playing || (p && !T.raf)) invalidate(); }

  syncUi(); resize(scr.clientWidth || 300, scr.clientHeight || 120);
  /* #196: a fresh feed (recipe switch) empties the lane model, cycle cache, live waveform and playhead state so nothing of the previous recipe stays */
  function reset() { T.cursor = 0; T.t = 0; T.key = null; T.cyc.clear(); T.cycMax = 0; T.lanes = []; LV.m.clear(); LV.k = -1; T.dirty = true; refreshSpec(); invalidate(); }
  sc.timeline = { reset, ping, state: () => ({ mode: T.mode, suspended: T.suspended, follow: root.dataset.follow, ppb: T.ppb, sx: T.sx, scrollLeft: scr.scrollLeft, t: T.t, cursor: T.cursor, playheadX: T.px, gutter: T.GUT, width: T.W, height: T.H, fix: T.fix, lanes: T.lanes.slice(), rowH: ROW, ruler: RULER, sel: T.sel, playing: T.playing, total: T.total, audio: T.audio ? { name: T.audio.name, done: T.audio.p.done, n: T.audio.p.n, start: T.audio.start, cycles: T.audio.cycles } : null, frames: T.frames,
      specEnd: T.spec, endRule: T.rule, look: T.look, ghostFrom: T.G === Infinity ? null : T.G, totalSec: T.total / cps(), steps: T.steps, scrollWidth: scr.scrollWidth, wave: { ...T.wv }, liveCycles: LV.m.size, labels: T.labels.map((l) => ({ k: l.k, text: l.text })), ahead: sc.ahead ? sc.ahead.state() : null }),
    setMode, refollow, zoom: zoomBy, setZoom: (p) => setPpb(p), fit, seek, select, setAudio, useTake, setKey, invalidate, rects: () => { const o = []; for (const [c, ev] of T.cyc) for (const e of ev) o.push({ lane: T.lanes[e.li], b: e.b, e: e.e, c, ghost: e.b >= T.G }); return o; }, extend, refresh: refreshSpec, clearLive: () => { LV.m.clear(); LV.k = -1; invalidate(); }, pos: () => (T.playing ? T.t : T.cursor), cost: T.cost, peakCount: () => T.peaks.size, MINPPB, MAXPPB };
  window.__tl = { cost: T.cost };
  /* render-ahead (#195): the module loads only when a lead is set (audio dot sheet, ?ahead=S, localStorage sc.ahead.lead); never in the render host */
  const aheadLead = () => { try { const q = new URLSearchParams(location.search); if (q.get('host') === 'render') return 0; const v = q.get('ahead'); return Math.max(0, +(v != null ? v : localStorage.getItem('sc.ahead.lead')) || 0); } catch (e) { return 0; } };
  const loadAhead = () => import('./renderahead.js').catch(() => null);
  addEventListener('sc-ahead', (e) => { if (!sc.ahead && e.detail && e.detail.lead > 0) loadAhead().then(() => sc.ahead && sc.ahead.configure({ lead: e.detail.lead })); });
  if (aheadLead() > 0) loadAhead();
  setTimeout(refreshSpec, 0); invalidate();
}
