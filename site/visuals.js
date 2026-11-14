/* Visual feedback as on strudel.cc/learn/visual-feedback, built on Strudel's own draw code inside @strudel/web 1.3.0 (unmodified):
   - global .pianoroll() .punchcard() .spiral() .scope() .tscope() .fscope() .wordfall() .pitchwheel() draw on #test-canvas
     (painters from onPaint are driven by this file's frame loop, like strudel.cc's Drawer);
   - inline _pianoroll _punchcard _spiral _scope _tscope _fscope _wordfall _pitchwheel render in a canvas under the code line
     (Strudel's transpiler injects the widget id; we register the widget types and give each id its own canvas);
   - mini-notation highlighting of active events in the editor (hap.context.locations), tinted by .color();
   - each visual is a control type (strudelCraft.controls) and an intellisense item. */
const VIS = ['pianoroll', 'punchcard', 'spiral', 'scope', 'tscope', 'fscope', 'wordfall', 'pitchwheel'];
const INFO = {
  pianoroll: 'Piano roll of the pattern (cycles, playhead, vertical, labels, fold, autorange...)', punchcard: 'Piano roll that reflects all transformations after it',
  spiral: 'Events on a spiral, one turn per cycle', scope: 'Oscilloscope of the audio (alias of tscope)', tscope: 'Time-domain scope (thickness, scale, pos, smear, trigger)',
  fscope: 'Frequency-domain scope', wordfall: 'Vertical punchcard with labels', pitchwheel: 'Pitch circle of active notes (edo, hapcircles, circle)',
};
const sc = (window.strudelCraft = window.strudelCraft || {});
const widgetCanvases = new Map(); // id -> canvas
let cmApi = null; // set by intellisense.js via sc.visuals.attach

function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
/* inline widget canvases: CSS width 100% of the editor content (the CodeMirror block widget sets it), fixed CSS height
   (default 140 px, or the call's {height}); the backing store follows the CSS box through a ResizeObserver, so a canvas
   never changes size while a pattern runs unless the editor itself is resized. */
const DEFAULT_H = 140;
const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => { for (const e of es) fit(e.target); }) : null;
function fit(c) {
  if (!c.isConnected) return; const w = Math.round(c.clientWidth * dpr()), h = Math.round(c.clientHeight * dpr());
  if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; c.dispatchEvent(new Event('sc:resized')); }
}
function widgetCanvas(id, height) {
  let c = widgetCanvases.get(id);
  if (!c) { c = document.createElement('canvas'); c.className = 'sc-widget'; c.dataset.id = id; c.width = 600; c.height = DEFAULT_H; widgetCanvases.set(id, c); if (ro) ro.observe(c); }
  const hgt = Math.max(60, Math.min(600, Math.round(+height || +c.dataset.h || DEFAULT_H)));
  if (+c.dataset.h !== hgt) { c.dataset.h = hgt; c.style.height = hgt + 'px'; }
  fit(c); return c.getContext('2d');
}
sc.visualsWidgetHeight = (el) => +(el && el.dataset.h) || DEFAULT_H;

function globalCtx() {
  let c = document.getElementById('test-canvas');
  if (!c) { c = document.createElement('canvas'); c.id = 'test-canvas'; document.body.prepend(c); }
  const w = Math.round(window.innerWidth * dpr()), h = Math.round(window.innerHeight * dpr()); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c.getContext('2d');
}
function install() {
  const P = window.Pattern && window.Pattern.prototype; if (!P || P.__scVisuals) return; P.__scVisuals = true;
  /* the global canvas Strudel draws into: make it a calm full-page layer that never blocks touches */
  const style = document.createElement('style');
  style.textContent = '#test-canvas{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:1!important;opacity:.4;mix-blend-mode:screen}';
  document.head.append(style);
  for (const name of VIS) {
    const wname = '_' + name; if (!P[name]) continue;
    try { const rw = window.registerWidgetType || (window.strudel && window.strudel.registerWidgetType); if (rw) rw(wname); } catch (e) { /* ignore */ }
    P[wname] = function (id, opts) {
      if (typeof id !== 'string') { opts = id; id = wname; }
      const o = opts && typeof opts === 'object' ? opts : {};
      const ctx = widgetCanvas(id, o.height); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      /* as strudel.cc: tag the haps with the widget id; pianoroll/punchcard draw only haps carrying that tag */
      return this.tag(id)[name]({ ...o, ctx, id });
    };
  }
}

/* painters (onPaint visuals) + highlight loop */
let raf = 0;
function frame() {
  raf = requestAnimationFrame(frame);
  if (document.hidden) return; /* hidden: no painting or highlighting */
  const st = sc.engineState && sc.engineState(); if (!st || !st.playing || !st.pattern || !st.scheduler) { clearHighlight(); return; }
  let t; try { t = st.scheduler.now(); } catch (e) { return; }
  let haps = [];
  try { haps = st.pattern.queryArc(Math.max(0, t - 2), t + 2).filter((h) => h.hasOnset ? true : true); } catch (e) { haps = []; }
  try {
    const painters = st.pattern.getPainters ? st.pattern.getPainters() : [];
    if (painters.length) {
      const g = globalCtx(); if (g) g.clearRect(0, 0, g.canvas.width, g.canvas.height);
      for (const id of widgetCanvases.keys()) { const c = widgetCanvases.get(id); if (painted.has(id)) c.getContext('2d').clearRect(0, 0, c.width, c.height); }
      painters.forEach((p) => { try { p(g, t, haps, [-2, 2]); } catch (e) { /* bad painter */ } });
    }
  } catch (e) { /* ignore */ }
  highlight(st, t, haps);
}
const painted = new Set();

/* evaluated text has AST-bound ids injected (engine/bind.js): map its offsets back to the editor text */
function unbind(raw) { const b = sc.binder; if (!b || !b.original) return { code: raw, back: (p) => p }; return { code: b.original(raw), back: (p) => b.toOriginal(raw, p) }; }
/* mini-notation highlighting */
let lastKey = '';
function clearHighlight() { if (!cmApi || !lastKey) return; lastKey = ''; cmApi.setHighlights('code', []); cmApi.setHighlights('stackCode', []); }
function highlight(st, t, haps) {
  if (!cmApi) return;
  const id = st.srcView === 'stack' ? 'stackCode' : 'code'; const doc = cmApi.doc(id); const raw = st.activeCode || st.code || ''; const { code, back } = unbind(raw);
  const off = code.endsWith(doc) ? code.length - doc.length : code.indexOf(doc) >= 0 ? code.indexOf(doc) : -1;
  if (off < 0) { cmApi.setHighlights(id, []); return; }
  const out = []; const seen = new Set();
  for (const h of haps) {
    if (!h.whole || !(h.whole.begin <= t && t < h.whole.end)) continue;
    const locs = (h.context && h.context.locations) || []; const color = h.value && typeof h.value === 'object' ? h.value.color : null;
    for (const l of locs) { const from = back(l.start) - off, to = back(l.end) - off; if (from < 0 || to > doc.length || from >= to) continue; const k = from + ':' + to; if (seen.has(k)) continue; seen.add(k); out.push({ from, to, color }); }
  }
  const key = id + JSON.stringify(out); if (key === lastKey) return; lastKey = key;
  cmApi.setHighlights(id, out); cmApi.setHighlights(id === 'code' ? 'stackCode' : 'code', []);
}

/* idle (no Play): place the canvases and paint once from the queried events, static (CONTROL_BINDING section 6) */
let lastIdle = null; /* idle compile can finish before the editor attaches: re-place on attach */
window.addEventListener('strudel:idle', (e) => idlePaint(e.detail));
function idlePaint(st) {
  lastIdle = st; if (!st || !st.pattern || !cmApi) return; install(); placeWidgets(st);
  requestAnimationFrame(() => { try {
    const haps = st.pattern.queryArc(0, 4); const painters = st.pattern.getPainters ? st.pattern.getPainters() : [];
    for (const id of painted) { const c = widgetCanvases.get(id); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); }
    painters.forEach((p) => { try { p(globalCtx(), 2, haps, [-2, 2]); } catch (err) { /* bad painter */ } });
  } catch (err) { /* query failed: canvas stays blank */ } });
}
/* inline widgets: place each _visual canvas under its code line */
function placeWidgets(st) {
  if (!cmApi) return; const { code, back } = unbind(st.activeCode || '');
  /* the evaluated program belongs to the editor whose text it ends with (state events can arrive before srcView flips on a tab swap) */
  const pref = st.srcView === 'stack' ? ['stackCode', 'code'] : ['code', 'stackCode'];
  const id = pref.find((e) => { const d = cmApi.doc(e); return d && code.endsWith(d); }) || pref[0]; const doc = cmApi.doc(id);
  const off = code.endsWith(doc) ? code.length - doc.length : -1; const ws = [];
  painted.clear();
  for (const w of st.widgets || []) {
    if (!w || !/^_/.test(w.type || '')) continue; const wid = `${w.id || ''}_widget_${w.type}_${w.index}`; painted.add(wid);
    const pos = back(w.to != null ? w.to : w.from) - (off < 0 ? 0 : off); if (off < 0 || pos < 0 || pos > doc.length) continue;
    widgetCanvas(wid); ws.push({ pos, el: widgetCanvases.get(wid) });
  }
  cmApi.setWidgets(id, ws); cmApi.setWidgets(id === 'code' ? 'stackCode' : 'code', []);
}

window.addEventListener('strudel:ready', () => { install(); if (!raf) raf = requestAnimationFrame(frame); });
/* after every successful swap (edit, tab switch) re-place from the engine's settled state */
window.addEventListener('live:ok', () => { const es = sc.engineState && sc.engineState(); if (es && es.playing && es.widgets && es.activeCode) placeWidgets(es); });
window.addEventListener('strudel:state', (e) => { const st = e.detail; const es = sc.engineState && sc.engineState(); if (!es || !es.playing) return; if (st && st.widgets && st.activeCode && !st.pending) placeWidgets({ ...st, srcView: (sc.engineState && sc.engineState().srcView) || 'rack' }); });

/* registries: control types + intellisense */
function registerTypes() {
  const c = sc.controls; if (!c || !c.registerType) return false;
  for (const name of VIS) {
    c.registerType({ id: 'visual.' + name, value: 'visual', label: name, keys: [name, '_' + name], info: INFO[name] });
    c.registerType({ id: 'visual._' + name, value: 'visual', label: '_' + name + ' (inline)', keys: ['_' + name], info: INFO[name] + ' - inline band under the calling line (editor width, 140 px or { height })', render: { fallback: 'visual.' + name } });
    if (c.registerRenderer) c.registerRenderer('visual.' + name, (host, spec = {}) => { const cv = document.createElement('canvas'); cv.className = 'sc-widget'; cv.dataset.visual = name; if (host) host.append(cv); return cv; });
  }
  return true;
}
if (!registerTypes()) { const iv = setInterval(() => { if (registerTypes()) clearInterval(iv); }, 500); setTimeout(() => clearInterval(iv), 20000); }
function registerIntellisense() {
  const is = sc.intellisense; if (!is || !is.register) return false;
  is.register({ id: 'visuals', items: () => [
    ...VIS.flatMap((n) => [{ label: n, method: true, category: 'visuals', detail: '.' + n + '()', info: INFO[n] + ' (global, full page)' }, { label: '_' + n, method: true, category: 'visuals', detail: '._' + n + '()', info: INFO[n] + ' (inline: a band under the calling line, editor width, 140 px or { height })' }]),
    { label: 'color', method: true, category: 'visuals', detail: '.color("cyan magenta")', info: 'Colour for events in visuals and highlighting' },
  ] });
  return true;
}
if (!registerIntellisense()) { const iv = setInterval(() => { if (registerIntellisense()) clearInterval(iv); }, 300); setTimeout(() => clearInterval(iv), 20000); }

sc.visuals = { list: VIS, attach(api) { cmApi = api; const es = sc.engineState && sc.engineState(); if (lastIdle && !(es && es.playing)) idlePaint(lastIdle); }, canvas: (id) => widgetCanvases.get(id) };
