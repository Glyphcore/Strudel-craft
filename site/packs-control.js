/* Sandboxed control renderer (#71, docs/PACK_SPEC.md 10.4). Loaded lazily by the `control-types` adapter, only for a granted, trusted
   ingredient while code ingredients are switched on. The pack's module draws into an OffscreenCanvas inside its own sandboxed frame
   (allow-scripts only, opaque origin, no network); the frame is mounted in this slot but is inert and has no pointer events, so it never
   receives a click, a key or focus. The host owns everything interactive: the slot is the focusable role="slider", it turns pointer and
   key input into plain data for the module (`call('input', ...)`), accepts only `{set: finite number}` back and clamps it to the spec's
   min..max before it reaches the control. A visible "third-party" label naming the pack sits outside the frame's box. If the code is not
   trusted, times out or is killed, the slot shows a host-drawn fallback control instead.
   mountSandboxControl(host, {type, name, spec, io: {get(), set(v)}, pack, ingredient, spawn(el) -> Promise<sandbox>}) -> {el, sync(), destroy(), state} */
const NUM = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function loadCss() {
  if (document.querySelector('link[data-pkc]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('packs-control.css', import.meta.url).href, 'data-pkc': '' }));
}
const fmt = (v, unit) => { const a = Math.abs(v); const s = a >= 1000 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); return unit ? s + ' ' + unit : s; };

export function mountSandboxControl(host, o) {
  loadCss();
  const spec = o.spec || {}, lo = NUM(spec.min, 0), hi0 = NUM(spec.max, 1), hi = hi0 > lo ? hi0 : lo + 1, step = NUM(spec.step, 0) > 0 ? spec.step : (hi - lo) / 100;
  const clamp = (v) => Math.min(hi, Math.max(lo, v));
  const io = o.io || { v: lo, get() { return this.v; }, set(v) { this.v = v; } };
  const label = (o.type && o.type.label) || o.name || 'control';
  const get = () => { const v = Number(io.get()); return Number.isFinite(v) ? clamp(v) : lo; };
  let state = 'starting', sb = null, drawing = false, drawAgain = false, inFlight = false, nextInput = null, gone = false;

  const tag = h('span', { class: 'pkc-tag' }, h('b', {}, 'third-party'), ' ', o.pack || 'pack');
  const val = h('span', { class: 'pkc-val', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'pkc-stage' });
  const note = h('p', { class: 'pkc-note', role: 'status' });
  const el = h('div', { class: 'pkc', 'data-pkc': o.pack + ':' + o.ingredient, 'data-state': state, 'data-type': o.type ? o.type.id : null },
    h('div', { class: 'pkc-head' }, tag, val), stage, note);
  const slider = (on) => {
    if (on) { stage.setAttribute('role', 'slider'); stage.tabIndex = 0; stage.setAttribute('aria-label', `${label}, third-party control from ${o.pack}`); stage.setAttribute('aria-valuemin', lo); stage.setAttribute('aria-valuemax', hi); }
    else { stage.removeAttribute('role'); stage.removeAttribute('tabindex'); }
  };
  slider(true);
  const sync = () => { const v = get(); val.textContent = fmt(v, spec.unit); stage.setAttribute('aria-valuenow', String(v)); stage.setAttribute('aria-valuetext', fmt(v, spec.unit)); if (state === 'live') draw(); else if (fb && fb.__sync) fb.__sync(); };
  const setValue = (v) => { if (typeof v !== 'number' || !Number.isFinite(v)) return; io.set(clamp(v)); sync(); };

  // ---------------------------------------------------------------- drawing: one call in flight, coalesced to the latest value and size
  async function draw() {
    if (state !== 'live' || !sb) return; if (drawing) { drawAgain = true; return; }
    drawing = true; const r = stage.getBoundingClientRect();
    try { await sb.call('draw', { value: get(), min: lo, max: hi, w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)), dpr: Math.min(3, window.devicePixelRatio || 1), focused: document.activeElement === stage }); }
    catch (e) { /* a slow frame is dropped; three in a row stop the sandbox (fallback below) */ }
    drawing = false; if (drawAgain) { drawAgain = false; requestAnimationFrame(draw); }
  }
  // ---------------------------------------------------------------- input: host events -> plain data -> {set} -> clamp
  async function send(input) {
    if (state !== 'live' || !sb) return false;
    if (inFlight) { nextInput = input; return true; } inFlight = true;
    try { const r = await sb.call('input', input); if (r && typeof r === 'object' && !Array.isArray(r) && typeof r.set === 'number' && Number.isFinite(r.set)) setValue(r.set); }
    catch (e) { /* dropped */ }
    inFlight = false; if (nextInput) { const n = nextInput; nextInput = null; send(n); }
    return true;
  }
  const at = (e) => { const r = stage.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))), y: Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1))) }; };
  let down = false;
  stage.addEventListener('pointerdown', (e) => { if (state !== 'live') return; down = true; stage.setPointerCapture(e.pointerId); stage.focus({ preventScroll: true }); send({ kind: 'down', ...at(e), value: get() }); e.preventDefault(); });
  stage.addEventListener('pointermove', (e) => { if (down) send({ kind: 'move', ...at(e), value: get() }); });
  const up = (e) => { if (!down) return; down = false; send({ kind: 'up', ...at(e), value: get() }); };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  const KEYS = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
  stage.addEventListener('keydown', (e) => {
    if (state !== 'live') return; const k = e.key; if (!(k in KEYS) && k !== 'Home' && k !== 'End') return;
    e.preventDefault(); e.stopPropagation();
    const own = k === 'Home' ? lo : k === 'End' ? hi : get() + KEYS[k] * step; // the host's own step: keyboard always works, even if the module answers nothing
    setValue(own); send({ kind: 'key', key: k, value: get() });
  });
  stage.addEventListener('focus', () => draw()); stage.addEventListener('blur', () => draw());
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null; if (ro) ro.observe(stage);

  // ---------------------------------------------------------------- fallback: host-drawn, used when the code is untrusted, timed out or killed
  let fb = null;
  function fallback(why) {
    if (gone) return; state = 'fallback'; el.dataset.state = state; slider(false); sb = null;
    stage.replaceChildren(); // removes the frame if it is still there
    fb = h('input', { type: 'range', class: 'pkc-fb', min: lo, max: hi, step, 'aria-label': `${label} (basic control; third-party renderer from ${o.pack} not running)` });
    fb.__sync = () => { fb.value = String(get()); };
    fb.addEventListener('input', () => setValue(Number(fb.value)));
    stage.append(fb); fb.__sync();
    note.textContent = why; sync();
  }

  host.append(el); sync();
  Promise.resolve().then(() => o.spawn(stage)).then((s) => {
    if (gone) { s.stop(); return; }
    sb = s; state = 'live'; el.dataset.state = state;
    s.on((ev) => { if (ev.type === 'stopped' && !gone) fallback(`Third-party renderer stopped (${ev.code}); showing a basic control.`); });
    draw();
  }, (e) => fallback(`${e && e.code ? e.code + ': ' : ''}${(e && e.message) || 'not running'}. Showing a basic control.`));

  return {
    el, sync, get state() { return state; },
    destroy() { gone = true; if (ro) ro.disconnect(); if (sb) sb.stop(); sb = null; el.remove(); },
  };
}
