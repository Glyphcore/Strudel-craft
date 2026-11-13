/* Perform view (#55): one tab strip of pad banks and control boards, pad grid (multi-touch + keyboard via the input
   registry), pad sheet, scenes, looper strip, board with renderers for the drawn control types and an edit mode, inline
   controls under the editors, learn / unlearn (maps + hooks.map lines in the code), automation lanes, library save, and the
   Strudel bindings ctl()/slider()/hooks.map(). All state lives in the engines (strudelCraft.pads / .controls / .hooks) and a
   persisted model (localStorage "sc.perform"); the views re-render from it. Loaded on first open of Perform or on first Play;
   its stylesheet (perform.css) loads with it, never with the shell. */
const sc = window.strudelCraft;
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter((x) => x != null)); return e; };
const ui = () => sc.ui;
const T = sc.engine.time;
const KEY = 'sc.perform';
const libP = () => import('./library.js').then((m) => m.lib);
const slug = (s) => String(s).trim().replace(/[^\w-]+/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 40) || 'item';

await new Promise((res) => { let l = document.querySelector('link[href="perform.css"]'); if (l && l.sheet) return res(); if (!l) { l = h('link', { rel: 'stylesheet', href: 'perform.css' }); document.head.append(l); } l.addEventListener('load', res, { once: true }); l.addEventListener('error', res, { once: true }); });

/* ---------------- model ---------------- */
const defModel = () => ({ tabs: [{ kind: 'bank', id: 'A', name: 'Bank A' }, { kind: 'board', id: 'main', name: 'Board' }], active: 0, perform: true,
  banks: { A: { id: 'A', rows: 4, cols: 4, pads: [] } }, boards: { main: { id: 'main', cells: [] } }, controls: {}, maps: [], automation: {} });
let M; try { M = JSON.parse(localStorage.getItem(KEY)) || defModel(); } catch (e) { M = defModel(); }
M.automation ||= {}; for (const b of Object.values(M.boards)) b.size ||= {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(M)); } catch (e) { /* full */ } };

/* ---------------- engines ---------------- */
const controls = sc.controls.create({ strict: false });
for (const [n, s] of Object.entries(M.controls)) { try { controls.declare(n, s); if (s.value !== undefined) controls.set(n, s.value); } catch (e) { /* skip */ } }
(M.maps || []).forEach((m) => { try { controls.map(m.control, m.dest, m); } catch (e) { /* skip */ } });
for (const [id, l] of Object.entries(M.automation)) controls.addLane(id, l);
let pads = null;
function rebuildPads() { pads = sc.pads.create({ banks: Object.values(M.banks), model: { settings: { bpb: 4, cpb: 1 } } }); pads.setBank(Math.max(0, Object.keys(M.banks).indexOf(curTab().id))); }
const curTab = () => M.tabs[M.active] || M.tabs[0];
const playing = () => { try { const st = sc.engineState && sc.engineState(); return !!(st && st.playing && st.scheduler); } catch (e) { return false; } };
const nowCycle = () => { try { const st = sc.engineState && sc.engineState(); return st && st.playing && st.scheduler ? st.scheduler.now() : 0; } catch (e) { return 0; } };
const persistControls = () => { const m = controls.toModel(); M.controls = m.controls || {}; M.maps = m.maps || []; M.automation = m.automation || {}; save(); };
const isNum = (name) => { try { const s = controls.declare(name); return !['toggle', 'button', 'xy', 'steps', 'select'].includes(s.type); } catch (e) { return false; } };

/* ---------------- Strudel bindings: ctl() / slider() read the controls engine (lanes included) at each event's time ---------------- */
const order = []; // declaration order in the program (source order)
const un = (v) => (v && typeof v === 'object' && typeof v.firstCycle === 'function' ? (v.__pure !== undefined ? v.__pure : (v.firstCycle()[0] || {}).value) : v);
function bindStrudel() {
  glue();
  if (!window.signal || window.__scCtl) return; window.__scCtl = true;
  const sig = (name) => window.signal((t) => { const v = controls.get(name, +t || nowCycle()); return typeof v === 'object' ? v.x : v; });
  const unSpec = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(un) : v && typeof v === 'object' && typeof v.firstCycle !== 'function' ? unSpec(v) : un(v)]));
  window.ctl = (name, spec = {}) => {
    name = String(un(name)); spec = unSpec(spec);
    if (!controls.list().some((c) => c.name === name)) { try { controls.declare(name, { type: 'knob', min: 0, max: 1, ...spec }); } catch (e) { /* conflict: keep the first */ } persistControls(); }
    declOrder(name); queueInline(); return sig(name);
  };
  window.sliderWithID = (id, value, min = 0, max = 1) => { id = String(un(id)); value = +un(value); min = +un(min); max = +un(max);
    if (/^k[0-9a-z]{6}/.test(id)) { ensureSite({ id, kind: 'slider', value, min, max }); return sig(id); }
    const f = controls.sliderWithID(id, value, min, max); declOrder(f.controlName); queueInline(); return sig(f.controlName); };
  /* ctl('label', spec) rewritten by engine/bind.js to ctlAt('<site id>', 'label', spec): the id is the identity, the label a display alias */
  window.ctlAt = (id, label, spec = {}) => { ensureSite({ id: String(un(id)), kind: 'ctl', label: label == null ? null : String(un(label)), spec: unSpec(spec) }); return sig(String(un(id))); };
}
/* hooks runtime glue (engine/hooks.js is not modified): hooks.map(control, dest, opts?, gate?) -> controls.map (idempotent, the line
   re-runs on every evaluate); pad journal entries are written into hooks.journal in the runtime's journal format. */
function glue() {
  const H = sc.hooks; if (!H || H.__scPerform) return; H.__scPerform = true;
  H.map = (control, dest, opts, gate) => {
    control = String(un(control)); dest = String(un(dest)); opts = un(opts) || {}; gate = un(gate);
    // a delayed live swap can evaluate text that an Unlearn already changed: only lines still in an editor count
    const inCode = ['code', 'stackCode'].some((id) => { const ta = document.getElementById(id); return ta && ta.value.split('\n').some((l) => mapLineRe(control, dest).test(l)); });
    if (inCode && !controls.maps().some((m) => m.control === control && m.dest === dest)) { try { controls.map(control, dest, opts, gate); persistControls(); queueInline(); } catch (e) { console.warn('[hooks.map]', e.message); } }
    return H;
  };
  bridge();
}
// a re-evaluation re-declares the same controls: the board only re-renders when the set of controls (or their maps) changed
let inlineT = 0, boardSig = ''; function queueInline() { clearTimeout(inlineT); inlineT = setTimeout(() => { renderInline(); const sig = JSON.stringify(controls.list().map((c) => [c.name, c.maps])); if (sig !== boardSig) { boardSig = sig; if (curTab().kind === 'board') render(); } }, 60); }
// source order of the running program: one evaluation calls ctl()/slider() back to back, so a gap starts a new list
let lastDecl = 0; const declOrder = (name) => { const t = performance.now(); if (t - lastDecl > 250) order.length = 0; lastDecl = t; if (!order.includes(name)) order.push(name); };
window.addEventListener('live:swap', (e) => { if (!/\b(ctl|slider)\s*\(/.test((e.detail && e.detail.code) || '')) { order.length = 0; queueInline(); } });

/* ---------------- pad journal -> hooks.journal ----------------
   The hooks runtime replays journal entries {cycle, op, args} with op bind [slot, hook], unbind [slot], let [name, value], replace, set.
   Pad entries carry {pad, on, target}; ops the runtime has no form for (unlet, open/close, tap/tap-end, action, let without a value)
   are written as "pad:<op>" so they are journaled but not applied. */
function toHooks(e) {
  const on = /^(bind|let|open|tap)$/.test(e.op); const b = { cycle: e.cycle, pad: e.pad, on, target: e.target };
  if (e.op === 'bind' && e.args.slot) return { ...b, op: 'bind', args: [e.args.slot, e.args.hook] };
  if (e.op === 'unbind' && e.args.slot) return { ...b, op: 'unbind', args: [e.args.slot] };
  if (e.op === 'let' && e.args.value !== undefined) return { ...b, op: 'let', args: [e.args.name, e.args.value] };
  return { ...b, op: 'pad:' + e.op, args: [] };
}
function bridge(j = sc.perform && sc.perform.journal) {
  const H = sc.hooks; if (!H || !j) return;
  const keep = H.journal.filter((e) => !e.pad); H.journal.length = 0; H.journal.push(...keep, ...j.map(toHooks));
  try { H.undef('__scPerformTouch'); } catch (e) { /* invalidates the runtime's journal cache */ }
}

/* ---------------- small site-modal helpers (no native dialogs) ---------------- */
function dlg(title, ...body) {
  const id = 'pfd' + Math.random().toString(36).slice(2, 7);
  const d = h('dialog', { class: 'scm pf-sheet', 'aria-labelledby': id }, h('div', { class: 'help-head' }, h('h2', { id }, title)), ...body);
  d.addEventListener('keydown', (e) => e.stopPropagation()); document.body.append(d); d.showModal(); return d;
}
function choose({ title, message, options }) { // options [{label, value, danger?}] -> value | null
  return new Promise((res) => {
    let d; const done = (v) => { d.close(); d.remove(); res(v); };
    d = dlg(title, h('div', { class: 'scm-body' }, message ? h('p', { class: 'scm-msg' }, message) : null,
      h('div', { class: 'pf-opts' }, ...options.map((o) => h('button', { type: 'button', class: 'pf-opt' + (o.danger ? ' danger' : ''), 'data-v': o.value, onclick: () => done(o.value) }, o.label))),
      h('div', { class: 'scm-acts' }, h('button', { type: 'button', class: 'ghost', onclick: () => done(null) }, 'Cancel'))));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    const f = d.querySelector('.pf-opt'); if (f) f.focus();
  });
}
function askList({ title, label, value = '', okText = 'OK', list }) { // text input with a datalist of suggestions
  return new Promise((res) => {
    let d; const done = (v) => { d.close(); d.remove(); res(v); };
    const inp = h('input', { id: 'pfAsk', class: 'scm-input', list: 'pfAskL', autocomplete: 'off', value });
    const dl = h('datalist', { id: 'pfAskL' }); Promise.resolve(list).then((xs) => (xs || []).forEach((x) => dl.append(h('option', { value: x }))));
    const f = h('form', { class: 'scm-body', method: 'dialog' }, h('label', { class: 'scm-lab', for: 'pfAsk' }, label), inp, dl,
      h('div', { class: 'scm-acts' }, h('button', { type: 'button', class: 'ghost', onclick: () => done(null) }, 'Cancel'), h('button', { type: 'submit', class: 'scm-ok' }, okText)));
    f.addEventListener('submit', (e) => { e.preventDefault(); done(inp.value.trim() || null); });
    d = dlg(title, f); d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }); inp.focus(); inp.select();
  });
}
const paramList = () => sc.intellisense.all().then((items) => [...new Set(items.filter((i) => !i.string && /param|control|strudel functions|your names/.test(i.category || '')).map((i) => i.label))].slice(0, 300));

/* ---------------- control renderers ---------------- */
const fmt = (v, s) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v)) + (s.unit ? ' ' + s.unit : '');
const cur = (name) => controls.get(name, nowCycle());
/* exact numeric entry (site modal, never a native prompt): unit-aware, accepts values outside the range, offers "Extend range to fit" */
function enterValue(name) {
  name = controls.resolve(name); const s = controls.declare(name); const lo = s.min ?? 0, hi = s.max ?? 1; const clamp = s.clamp || 'hard';
  return new Promise((res) => {
    let d; const done = (v) => { d.close(); d.remove(); res(v); };
    const inp = h('input', { id: 'pfNum', class: 'scm-input', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: String(+(+controls.get(name)).toFixed(6)), 'aria-describedby': 'pfNumHint' });
    const hint = h('p', { id: 'pfNumHint', class: 'pc-range-hint' }); const ext = h('button', { type: 'button', class: 'ghost', id: 'pfExtend', disabled: true }, 'Extend range to fit');
    const parse = () => controls.parseValue(inp.value, { unit: s.unit || '' });
    const upd = () => { const v = parse(); const out = !isNaN(v) && (v < lo || v > hi); ext.disabled = !out; hint.textContent = isNaN(v) ? `Not a value. Range ${lo} to ${hi}${s.unit ? ' ' + s.unit : ''}` : `Range ${lo} to ${hi}${s.unit ? ' ' + s.unit : ''} · clamp ${clamp}` + (out ? (clamp === 'hard' ? ' · Set clamps to the range' : ' · outside the range') : ''); };
    ext.addEventListener('click', () => { const v = parse(); if (isNaN(v)) return; setRange(name, { min: Math.min(lo, v), max: Math.max(hi, v) }); setVal(name, v); done(v); });
    const f = h('form', { class: 'scm-body', method: 'dialog' }, h('label', { class: 'scm-lab', for: 'pfNum' }, `Value${s.unit ? ' (' + s.unit + ')' : ''}: e.g. 1.5k, -6 dB, 2:30`), inp, hint,
      h('div', { class: 'scm-acts' }, h('button', { type: 'button', class: 'ghost', onclick: () => done(null) }, 'Cancel'), ext, h('button', { type: 'submit', class: 'scm-ok' }, 'Set')));
    f.addEventListener('submit', (e) => { e.preventDefault(); const v = parse(); if (isNaN(v)) { upd(); inp.focus(); return; } setVal(name, clamp === 'hard' ? Math.min(hi, Math.max(lo, v)) : v); done(v); });
    inp.addEventListener('input', upd); upd();
    d = dlg('Set ' + (controls.labelOf(name) || name), f); d.classList.add('pc-num-dlg'); d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); }); inp.focus(); inp.select();
  });
}
/* range override per AST id, persisted in the model (M.ranges); the param shape stays the fallback */
function setRange(name, r) { name = controls.resolve(name); M.ranges = M.ranges || {}; M.ranges[name] = { ...(M.ranges[name] || {}), ...r }; try { controls.setRange(name, M.ranges[name]); } catch (e) { ui().toast(e.message, { kind: 'error' }); } persistControls(); render(); renderInline(); }
function rangeSheet(name) {
  name = controls.resolve(name); const s = controls.declare(name);
  return new Promise((res) => {
    let d; const done = (v) => { d.close(); d.remove(); res(v); };
    const fld = (id, lab, val, attrs = {}) => h('label', { class: 'scm-lab pc-rf', for: id }, lab, h('input', { id, class: 'scm-input', inputmode: 'decimal', value: val ?? '', ...attrs }));
    const sel = (id, lab, opts, val) => h('label', { class: 'scm-lab pc-rf', for: id }, lab, h('select', { id, class: 'scm-input' }, ...opts.map((o) => { const e = h('option', { value: o }, o); if (o === val) e.selected = true; return e; })));
    const f = h('form', { class: 'scm-body pc-range-form', method: 'dialog' },
      fld('pfMin', 'Min', s.min), fld('pfMax', 'Max', s.max), fld('pfStep', 'Step', s.step ?? ''), fld('pfUnit', 'Unit', s.unit ?? '', { inputmode: 'text' }),
      sel('pfCurve', 'Curve', ['lin', 'log', 'exp'], s.curve || 'lin'), sel('pfClamp', 'Clamp', ['hard', 'soft', 'none'], s.clamp || 'hard'),
      h('div', { class: 'scm-acts' }, h('button', { type: 'button', class: 'ghost', onclick: () => done(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'ghost', id: 'pfRangeReset', onclick: () => { if (M.ranges) delete M.ranges[name]; const st = [...(SITES.rack || []), ...(SITES.stack || [])].find((x) => x.id === name); if (st) { try { controls.redeclare(name, specOf(st)); } catch (e) { /* keep */ } } persistControls(); render(); renderInline(); done('reset'); } }, 'Shape default'),
        h('button', { type: 'submit', class: 'scm-ok' }, 'Save')));
    f.addEventListener('submit', (e) => { e.preventDefault(); const u = d.querySelector('#pfUnit').value.trim(); const num = (id) => { const t = d.querySelector(id).value.trim(); return t === '' ? null : controls.parseValue(t, { unit: u }); };
      const r = { min: num('#pfMin'), max: num('#pfMax'), step: num('#pfStep'), unit: u || null, curve: d.querySelector('#pfCurve').value, clamp: d.querySelector('#pfClamp').value };
      if ([r.min, r.max].some((x) => x == null || isNaN(x)) || r.min >= r.max) { ui().toast('Min must be below max', { kind: 'error' }); return; } if (r.step != null && !(r.step > 0)) r.step = null;
      setRange(name, r); done(r); });
    d = dlg('Range: ' + (controls.labelOf(name) || name), f); d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
  });
}
function setVal(name, v) { try { controls.set(name, v); } catch (e) { ui().toast(e.message, { kind: 'error' }); } persistControls(); refreshValues(name); touched(name); }
function refreshValues(name) { document.querySelectorAll(`[data-ctl="${CSS.escape(name)}"]`).forEach((el) => el.__sync && el.__sync()); }
function numberish(kind) {
  return (host, name, s) => {
    const [lo, hi] = [s.min ?? 0, s.max ?? 1]; const step = s.step || (hi - lo) / 100;
    const el = h('div', { class: 'pc-' + kind, role: 'slider', tabindex: 0, 'aria-label': name, 'aria-valuemin': lo, 'aria-valuemax': hi, 'data-ctl': name });
    const fill = h('i', { class: 'pc-fill' }); const out = h('output', { class: 'pc-val' });
    el.append(fill, out);
    el.__sync = () => { const v = cur(name); const t = controls.travelOf(name, v); el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuetext', fmt(v, s)); out.textContent = fmt(v, s); el.style.setProperty('--t', t); };
    let drag = null;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); drag = { y: e.clientY, x: e.clientX, t: controls.travelOf(name), onVal: e.target === out, t0: performance.now() }; e.preventDefault(); el.focus({ preventScroll: true }); });
    el.addEventListener('pointermove', (e) => { if (!drag) return; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true; else if (!drag.moved) return; const d = kind === 'slider' ? (e.clientX - drag.x) / Math.max(80, el.clientWidth) : (drag.y - e.clientY) / 160; controls.input('value', name, Math.min(1, Math.max(0, drag.t + d))); persistControls(); refreshValues(name); touched(name); });
    const end = (e) => { const d = drag; drag = null; if (!d) return; if (e.type === 'pointerup' && d.onVal && !d.moved && performance.now() - d.t0 < 400) typed(); }; /* tap the number: exact entry (long-press = reference inspector) */
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const m = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (m) { e.preventDefault(); e.stopPropagation(); setVal(name, Math.min(hi, Math.max(lo, +(controls.get(name) + m * step).toFixed(6)))); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setVal(name, e.key === 'Home' ? lo : hi); }
      else if (e.key === 'Enter') { e.preventDefault(); typed(); }
    });
    el.addEventListener('dblclick', typed);
    function typed() { return enterValue(name); }
    el.__sync(); host.append(el); return el;
  };
}
const R = {
  slider: numberish('slider'), fader: numberish('fader'), knob: numberish('knob'),
  number: (host, name, s) => { const el = h('input', { type: 'number', class: 'pc-number', 'data-ctl': name, 'aria-label': name, min: s.min, max: s.max, step: s.step || 'any' }); el.__sync = () => { el.value = cur(name); }; el.addEventListener('change', () => setVal(name, +el.value)); el.__sync(); host.append(el); return el; },
  toggle: (host, name) => { const el = h('button', { type: 'button', class: 'pc-toggle', 'data-ctl': name, 'aria-label': name }); el.__sync = () => { const on = !!cur(name); el.setAttribute('aria-pressed', String(on)); el.textContent = on ? 'ON' : 'OFF'; }; el.addEventListener('click', () => setVal(name, controls.get(name) ? 0 : 1)); el.__sync(); host.append(el); return el; },
  button: (host, name) => { const el = h('button', { type: 'button', class: 'pc-toggle', 'data-ctl': name, 'aria-label': name }, 'HOLD'); el.__sync = () => el.setAttribute('aria-pressed', String(!!cur(name))); el.addEventListener('pointerdown', () => setVal(name, 1)); const up = () => setVal(name, 0); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.__sync(); host.append(el); return el; },
  select: (host, name, s) => { const el = h('select', { class: 'pc-select', 'data-ctl': name, 'aria-label': name }, ...(s.options || []).map((o) => h('option', { value: o }, o))); el.__sync = () => { el.value = cur(name); }; el.addEventListener('change', () => setVal(name, el.value)); el.__sync(); host.append(el); return el; },
  xy: (host, name, s) => {
    const el = h('div', { class: 'pc-xy', role: 'slider', tabindex: 0, 'aria-label': name + ' (x/y)', 'data-ctl': name }); const dot = h('i'); el.append(dot);
    const ax = (a) => [s.axes?.[a]?.min ?? 0, s.axes?.[a]?.max ?? 1];
    el.__sync = () => { const v = cur(name) || { x: 0, y: 0 }; const [xl, xh] = ax('x'), [yl, yh] = ax('y'); dot.style.left = ((v.x - xl) / (xh - xl || 1)) * 100 + '%'; dot.style.top = (1 - (v.y - yl) / (yh - yl || 1)) * 100 + '%'; el.setAttribute('aria-valuetext', `x ${(+v.x).toFixed(2)}, y ${(+v.y).toFixed(2)}`); };
    const at = (e) => { const r = el.getBoundingClientRect(); const [xl, xh] = ax('x'), [yl, yh] = ax('y'); const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)); setVal(name, { x: xl + fx * (xh - xl), y: yl + fy * (yh - yl) }); };
    let on = false; el.addEventListener('pointerdown', (e) => { on = true; el.setPointerCapture(e.pointerId); at(e); e.preventDefault(); }); el.addEventListener('pointermove', (e) => on && at(e)); el.addEventListener('pointerup', () => { on = false; });
    el.addEventListener('keydown', (e) => { const d = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', 1], ArrowDown: ['y', -1] }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); const v = { ...(controls.get(name) || { x: 0, y: 0 }) }; const [lo, hi] = ax(d[0]); v[d[0]] = Math.min(hi, Math.max(lo, v[d[0]] + d[1] * (hi - lo) / 50)); setVal(name, v); });
    el.__sync(); host.append(el); return el;
  },
  steps: (host, name) => { const el = h('input', { type: 'text', class: 'pc-steps', 'data-ctl': name, 'aria-label': name + ' steps', spellcheck: 'false', autocapitalize: 'off' }); el.__sync = () => { el.value = cur(name); }; el.addEventListener('change', () => setVal(name, el.value)); el.__sync(); host.append(el); return el; },
};
for (const [id, fn] of Object.entries(R)) sc.controls.registerRenderer(id, fn);
const laneOf = (name) => controls.lanes().get('lane:' + name);
function renderControl(host, name, { board, site } = {}) {
  const ref = name; name = controls.resolve(name);
  const s = controls.declare(name); const chain = sc.controls.registry.fallbackChain(s.type); const drawn = chain[chain.length - 1];
  const size = board ? board.size[name] || '1x1' : '1x1';
  const cell = h('div', { class: 'pc-cell', 'data-name': controls.labelOf(name) || ref, 'data-id': name, 'data-size': size, 'data-learn': M.learn ? 'armed' : null, 'data-rec': A.run && A.run.name === name ? 'on' : A.armed && isNum(name) ? 'armed' : null });
  const maps = controls.maps().filter((m) => m.control.split(':')[0] === name).map((m) => m.dest);
  const label = site ? (site.label || labels.get(name) || `${site.param || 'ctl'}·${site.arg < 0 ? 0 : site.arg}`) : (labels.get(name) || name);
  cell.append(h('div', { class: 'pc-head', title: site ? `${name} · ${site.path}` : name }, h('b', {}, label), site && site.slot ? h('span', { class: 'pc-type' }, 'slot ' + site.slot) : null, laneOf(name) ? h('span', { class: 'pc-lane', title: 'Automation lane' }, '◆ lane') : null, h('span', { class: 'pc-type' }, s.type)));
  const body = h('div', { class: 'pc-body' }); (R[drawn] || R.number)(body, name, s); cell.append(body);
  if (isNum(name)) cell.append(h('p', { class: 'pc-range', title: 'Range (tap the value to type one; Range… in the menu to edit)' }, `${s.min ?? 0} to ${s.max ?? 1}${s.unit ? ' ' + s.unit : ''}${s.clamp && s.clamp !== 'hard' ? ' · ' + s.clamp : ''}`));
  if (drawn !== s.type) cell.append(h('p', { class: 'pc-note' }, `basic view (${s.type} shown as ${drawn})`));
  if (board && M.boardEdit) cell.append(h('button', { type: 'button', class: 'pc-map pc-edit', onclick: () => cellEdit(board, name) }, '✥ Edit cell'));
  else cell.append(h('button', { type: 'button', class: 'pc-map ghost', title: 'Map, learn, lane, send', 'aria-label': `${name}: ${maps.length ? 'mapped to ' + maps.join(', ') : 'not mapped'}. Options`, onclick: () => cellSheet(name) }, maps.length ? '→ ' + maps.join(', ') : 'Map…'));
  host.append(cell); return cell;
}

/* ---------------- learn / unlearn: one maps entry + one hooks.map(...) line in the playing editor ---------------- */
const editorFor = () => { const st = sc.engineState && sc.engineState(); const v = st && st.playing ? st.srcView : (document.getElementById('main')?.dataset.view === 'stack' ? 'stack' : 'rack'); return document.getElementById(v === 'stack' ? 'stackCode' : 'code'); };
const mapLine = (c, d) => `hooks.map('${c.replace(/'/g, "\\'")}', '${d.replace(/'/g, "\\'")}')`;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mapLineRe = (c, d) => new RegExp(`^\\s*hooks\\s*\\.\\s*map\\(\\s*(['"])${reEsc(c)}\\1\\s*,\\s*(['"])${reEsc(d)}\\2[^\\n]*\\)\\s*;?\\s*$`);
function codeEdit(fn) { const ta = editorFor(); if (!ta) return false; const v = fn(ta.value); if (v === ta.value) return false; ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; }
function doMap(name, dest) {
  if (!controls.maps().some((m) => m.control === name && m.dest === dest)) { try { controls.map(name, dest); } catch (e) { ui().toast(e.message, { kind: 'error' }); return; } }
  persistControls(); codeEdit((s) => (s.split('\n').some((l) => mapLineRe(name, dest).test(l)) ? s : mapLine(name, dest) + '\n' + s));
  render(); renderInline(); ui().toast(`Learned: ${name} → ${dest}`, { kind: 'ok' });
}
function unlearn(name, dest) {
  const ms = controls.maps(); for (let i = ms.length - 1; i >= 0; i--) if (ms[i].control.split(':')[0] === name && ms[i].dest === dest) ms.splice(i, 1);
  persistControls(); codeEdit((s) => s.split('\n').filter((l) => !mapLineRe(name, dest).test(l)).join('\n'));
  render(); renderInline(); ui().toast(`Unlearned: ${name} → ${dest}`, { kind: 'ok' });
}
async function learn() {
  if (M.learn) { M.learn = null; render(); renderInline(); return; }
  const dest = await askList({ title: 'Learn', label: 'Destination (param, or track.param)', value: 'cutoff', okText: 'Pick', list: paramList() }); if (!dest) return;
  M.learn = dest; render(); renderInline(); ui().toast(`Learn: move a control to map it to ${dest}`, { kind: 'info' });
}
function touched(name) {
  if (M.learn) { const d = M.learn; M.learn = null; doMap(name, d); }
  recTouch(name);
}
async function cellSheet(name) {
  const maps = controls.maps().filter((m) => m.control.split(':')[0] === name).map((m) => m.dest); const lane = laneOf(name);
  const boards = M.tabs.filter((t) => t.kind === 'board' && !(M.boards[t.id].cells.includes(name)));
  const v = await choose({ title: name, message: maps.length ? `Mapped to ${maps.join(', ')}` : 'Not mapped yet', options: [
    ...(isNum(name) ? [{ label: 'Set value…', value: 'value' }, { label: 'Range (min, max, step)…', value: 'range' }] : []),
    { label: 'Map to…', value: 'map' }, ...maps.map((d) => ({ label: `Unlearn → ${d}`, value: 'un:' + d, danger: true })),
    ...(isNum(name) ? [{ label: lane ? 'Overdub lane (1 bar)' : 'Record lane (1 bar)', value: 'rec' }] : []),
    ...(lane ? [{ label: 'Save lane to library', value: 'savelane' }, { label: 'Clear lane', value: 'clearlane', danger: true }] : []),
    ...boards.map((t) => ({ label: `Send to board "${t.name}"`, value: 'send:' + t.id })),
  ] });
  if (!v) return;
  if (v === 'value') { await enterValue(name); return; }
  if (v === 'range') { await rangeSheet(name); return; }
  if (v === 'map') { const d = await askList({ title: 'Map ' + name, label: 'Destination (param, or track.param)', value: 'cutoff', okText: 'Map', list: paramList() }); if (d) doMap(name, d); }
  else if (v.startsWith('un:')) unlearn(name, v.slice(3));
  else if (v === 'rec') { A.overdub = !!lane; A.armed = true; A.only = name; render(); renderInline(); ui().toast(`Lane armed: move ${name} to record 1 bar`, { kind: 'info' }); }
  else if (v === 'savelane') saveLib('lane', name);
  else if (v === 'clearlane') { A.undo.push({ id: 'lane:' + name, prev: lane }); controls.lanes().delete('lane:' + name); persistControls(); render(); renderInline(); }
  else if (v.startsWith('send:')) { const b = M.boards[v.slice(5)]; if (!b.cells.length) b.cells = controls.list().map((c) => c.name).filter((n) => n !== name); b.cells.push(name); save(); ui().toast(`${name} sent to the board`, { kind: 'ok' }); render(); }
}

/* ---------------- automation: record / overdub / undo a lane on one control ---------------- */
const A = { armed: false, only: null, overdub: false, bars: 1, run: null, undo: [] }; // transient record mode; results live in the controls engine
function recArm() { if (A.armed || A.run) { A.armed = false; A.run = null; A.only = null; render(); renderInline(); return; } if (!playing()) { ui().toast('Press Play first: lanes record against the transport', { kind: 'info' }); return; } A.armed = true; A.only = null; A.overdub = false; render(); renderInline(); }
function recTouch(name) {
  if (!A.run) { if (!A.armed || (A.only && A.only !== name) || !isNum(name)) return; if (!playing()) { ui().toast('Press Play first: lanes record against the transport', { kind: 'info' }); A.armed = false; render(); return; }
    const id = 'lane:' + name, prev = controls.lanes().get(id); if (prev) controls.lanes().delete(id); // the lane is out while you play over it
    A.armed = false; A.run = { name, c0: nowCycle(), len: A.bars, moves: [], prev, overdub: A.overdub && !!prev }; render(); renderInline(); }
  if (A.run.name !== name) return; const c = nowCycle(); A.run.moves.push([c, +controls.get(name, c)]); if (c >= A.run.c0 + A.run.len) recFinish();
}
function recFinish() {
  const r = A.run; A.run = null; A.only = null; if (!r) return; const s = controls.declare(r.name), L = r.len, id = 'lane:' + r.name;
  const ph = (c) => Math.round((((c % L) + L) % L) * 96) / 96;
  let pts = new Map(); for (const [c, v] of r.moves) pts.set(ph(c), v);
  if (r.overdub && r.prev) { const span = r.moves.length ? r.moves[r.moves.length - 1][0] - r.moves[0][0] : 0, p0 = ph(r.moves[0][0]); // keep old points outside the touched span
    const inSpan = (t) => (((t - p0) % L) + L) % L <= span + 1e-9; const old = new Map(r.prev.points.map(([t, v]) => [T.fromFrac(t), v])); for (const [t, v] of old) if (!inSpan(t) && !pts.has(t)) pts.set(t, v); }
  const moves = [...pts].sort((a, b) => a[0] - b[0]);
  if (!moves.length) { if (r.prev) controls.addLane(id, r.prev); render(); return; }
  const lane = sc.controls.lib.recordLane({ moves, range: [s.min ?? 0, s.max ?? 1], mode: 'curve', length: L, period: L, control: r.name });
  A.undo.push({ id, prev: r.prev || null }); controls.addLane(id, lane); persistControls(); render(); renderInline();
  ui().toast(`Lane ${r.overdub ? 'overdubbed' : 'recorded'} on ${r.name}: ${lane.points.length} points, ${L} bar`, { kind: 'ok' });
}
function recUndo() { const u = A.undo.pop(); if (!u) { ui().toast('Nothing to undo', { kind: 'info' }); return; } if (u.prev) controls.addLane(u.id, u.prev); else controls.lanes().delete(u.id); persistControls(); render(); renderInline(); ui().toast('Lane change undone', { kind: 'ok' }); }

/* ---------------- pads ---------------- */
const STATE_MARK = { empty: '·', loaded: '○', queued: '◔', on: '●', recording: '◉' };
const frac = (x) => T.fromFrac(x);
function padState(bank, pos) {
  const pad = bank.pads.find((p) => p.pos === pos); if (!pad) return { state: 'empty' };
  const addr = `${bank.id}/${pos}`; const j = (sc.perform.journal || []).filter((e) => e.pad === addr); const c = nowCycle();
  const past = j.filter((e) => frac(e.cycle) <= c + 1e-9), future = j.filter((e) => frac(e.cycle) > c + 1e-9);
  const last = past[past.length - 1]; const on = last && /^(bind|let|tap|open)$/.test(last.op);
  if (future.length && (!Tk.rec || frac(future[0].cycle) < Tk.rec.to)) return { state: 'queued', pad, beats: Math.max(0, Math.ceil((frac(future[0].cycle) - c) * 4)) };
  if (Tk.rec && c >= Tk.rec.from && on) return { state: 'recording', pad };
  return { state: on ? 'on' : 'loaded', pad };
}
function renderBank(host, bank) {
  const scenes = bank.scenes === 'row' || bank.scenes === 'col' ? bank.scenes : null;
  const grid = h('div', { class: 'pp-grid', style: `--cols:${bank.cols + (scenes === 'row' ? 1 : 0)}`, role: 'grid', 'aria-label': 'Pads ' + bank.id });
  const sceneBtn = (n, what) => h('button', { type: 'button', class: 'pp-scene', 'data-scene': n, 'aria-label': `Launch scene ${n + 1} (${what} ${n + 1})` }, h('span', { 'aria-hidden': 'true' }, '▶'), h('span', {}, 'S' + (n + 1)));
  for (let r = 0; r < bank.rows; r++) {
    const row = h('div', { role: 'row', class: 'pp-row' });
    for (let c = 0; c < bank.cols; c++) {
      const pos = `${r},${c}`; const st = padState(bank, pos); const pad = st.pad;
      const b = h('button', { type: 'button', role: 'gridcell', class: 'pp-pad', 'data-pos': pos, 'data-state': st.state, style: pad && pad.color ? `--pc:${pad.color}` : null,
        'aria-label': `Pad ${pos} ${pad ? (pad.label || pad.target.ref) : 'empty'}, ${st.state}${st.beats ? ', ' + st.beats + ' beats' : ''}` },
        h('span', { class: 'pp-mark', 'aria-hidden': 'true' }, STATE_MARK[st.state]),
        h('span', { class: 'pp-label' }, pad ? (pad.label || pad.target.ref) : ''),
        h('span', { class: 'pp-ref' }, pad ? `${pad.target.kind}:${pad.target.ref}` : '+'),
        st.state === 'queued' ? h('span', { class: 'pp-beats' }, st.beats + ' beats') : null);
      row.append(b);
    }
    if (scenes === 'row') row.append(h('span', { role: 'gridcell', class: 'pp-scell' }, sceneBtn(r, 'row')));
    grid.append(row);
  }
  if (scenes === 'col') grid.append(h('div', { role: 'row', class: 'pp-row pp-srow' }, ...Array.from({ length: bank.cols }, (_, c) => h('span', { role: 'gridcell', class: 'pp-scell' }, sceneBtn(c, 'column')))));
  grid.addEventListener('pointerdown', (e) => { const b = e.target.closest('.pp-pad'); if (!b) return; e.preventDefault(); if (!M.perform) return; b.setPointerCapture(e.pointerId); press(bank, b.dataset.pos, e.pressure && e.pressure !== 0.5 ? e.pressure : undefined, e.timeStamp); b.__pid = e.pointerId; });
  const rel = (e) => { const b = e.target.closest('.pp-pad'); if (!b || !M.perform) return; release(bank, b.dataset.pos); };
  grid.addEventListener('pointerup', rel); grid.addEventListener('pointercancel', rel);
  grid.addEventListener('click', (e) => { const s = e.target.closest('.pp-scene'); if (s) { pads.launchScene(bank.id, +s.dataset.scene, nowCycle()); journalChanged(); return; } const b = e.target.closest('.pp-pad'); if (!b) return; if (!M.perform || !bank.pads.find((p) => p.pos === b.dataset.pos)) padSheet(bank, b.dataset.pos); });
  grid.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.pp-pad')) { e.preventDefault(); e.stopPropagation(); const pos = e.target.closest('.pp-pad').dataset.pos; if (M.perform && bank.pads.find((p) => p.pos === pos)) { press(bank, pos); release(bank, pos); } else padSheet(bank, pos); } });
  host.append(grid);
}
const lat = [], work = []; // ms: pointerdown event time -> journal entry written; pointerdown handler start -> journal entry written (main-thread work)
function press(bank, pos, vel, t0) { const w0 = performance.now(); if (!bank.pads.find((p) => p.pos === pos)) return; pads.press(`${bank.id}/${pos}`, nowCycle(), vel); journalChanged(); if (t0 != null) { const t1 = performance.now(); lat.push(t1 - t0); work.push(t1 - w0); if (lat.length > 500) { lat.shift(); work.shift(); } } }
function release(bank, pos) { if (!bank.pads.find((p) => p.pos === pos)) return; pads.release(`${bank.id}/${pos}`, nowCycle()); journalChanged(); }
let jT = 0; function journalChanged() { const j = pads.resolve(); sc.perform.journal = j; bridge(j); window.dispatchEvent(new CustomEvent('pads:journal', { detail: j })); cancelAnimationFrame(jT); jT = requestAnimationFrame(renderPadsOnly); }
function renderPadsOnly() { const t = curTab(); if (t.kind !== 'bank') return; const host = $('#pfBody'); if (!host) return; host.querySelectorAll('.pp-pad').forEach((b) => { const st = padState(M.banks[t.id], b.dataset.pos); if (b.dataset.state === st.state && st.state !== 'queued') return; b.dataset.state = st.state; b.querySelector('.pp-mark').textContent = STATE_MARK[st.state]; let bt = b.querySelector('.pp-beats'); if (st.state === 'queued') { if (!bt) { bt = h('span', { class: 'pp-beats' }); b.append(bt); } bt.textContent = st.beats + ' beats'; } else if (bt) bt.remove(); const pad = st.pad; b.setAttribute('aria-label', `Pad ${b.dataset.pos} ${pad ? (pad.label || pad.target.ref) : 'empty'}, ${st.state}${st.beats ? ', ' + st.beats + ' beats' : ''}`); }); }

function targetOptions() { const dl = h('datalist', { id: 'pfTargets' }); sc.intellisense.all().then((items) => { const seen = new Set(); items.filter((i) => !i.string).slice(0, 400).forEach((i) => { if (seen.has(i.label)) return; seen.add(i.label); dl.append(h('option', { value: i.label }, i.category)); }); }); return dl; }
async function padSheet(bank, pos) {
  const pad = bank.pads.find((p) => p.pos === pos) || { pos, target: { kind: 'var', ref: '' }, mode: '', quant: '', label: '', color: '' };
  const d = h('dialog', { class: 'scm pf-sheet', 'aria-labelledby': 'pfsT' });
  const f = h('form', { class: 'scm-body', method: 'dialog' },
    h('label', { class: 'scm-lab', for: 'pfK' }, 'Target kind'), h('select', { id: 'pfK', class: 'scm-input' }, ...['var', 'hook', 'tap', 'component', 'action', 'scene'].map((k) => h('option', { value: k, selected: pad.target.kind === k }, k))),
    h('label', { class: 'scm-lab', for: 'pfR' }, 'Target (reference)'), h('input', { id: 'pfR', class: 'scm-input', list: 'pfTargets', value: pad.target.ref, autocomplete: 'off' }), targetOptions(),
    h('label', { class: 'scm-lab', for: 'pfM' }, 'Mode'), h('select', { id: 'pfM', class: 'scm-input' }, ...['', 'toggle', 'gate', 'oneshot', 'retrigger'].map((k) => h('option', { value: k, selected: (pad.mode || '') === k }, k || 'default'))),
    h('label', { class: 'scm-lab', for: 'pfQ' }, 'Quantise'), h('select', { id: 'pfQ', class: 'scm-input' }, ...['', 'none', 'beat', 'bar', '2b', '4b'].map((k) => h('option', { value: k, selected: (pad.quant || '') === k }, k || 'default'))),
    h('label', { class: 'scm-lab', for: 'pfV' }, 'Value for var targets (unit-aware: 1.5k, -6 dB, 2:30; empty = on/off)'), h('input', { id: 'pfV', class: 'scm-input', inputmode: 'decimal', value: pad.target.value ?? '', autocomplete: 'off' }),
    h('label', { class: 'scm-lab', for: 'pfC' }, 'Choke group (number, empty for none)'), h('input', { id: 'pfC', class: 'scm-input', inputmode: 'numeric', value: pad.choke ?? '' }),
    h('label', { class: 'scm-lab', for: 'pfL' }, 'Label'), h('input', { id: 'pfL', class: 'scm-input', value: pad.label || '' }),
    h('label', { class: 'scm-lab', for: 'pfCo' }, 'Colour'), h('input', { id: 'pfCo', class: 'scm-input', type: 'color', value: pad.color || '#2ed3c6' }),
    h('div', { class: 'scm-acts' }, h('button', { type: 'button', class: 'ghost', value: 'clear', id: 'pfClear' }, 'Clear pad'), h('button', { type: 'button', class: 'ghost', id: 'pfCancel' }, 'Cancel'), h('button', { type: 'submit', class: 'scm-ok' }, 'Save')));
  d.append(h('div', { class: 'help-head' }, h('h2', { id: 'pfsT' }, `Pad ${pos} (${bank.id})`)), f); document.body.append(d); d.showModal(); $('#pfR', d).focus();
  const close = () => { d.close(); d.remove(); };
  $('#pfCancel', d).addEventListener('click', close); d.addEventListener('cancel', close);
  $('#pfClear', d).addEventListener('click', () => { bank.pads = bank.pads.filter((p) => p.pos !== pos); save(); rebuildPads(); close(); render(); });
  d.addEventListener('keydown', (e) => e.stopPropagation());
  f.addEventListener('submit', (e) => {
    e.preventDefault(); const ref = $('#pfR', d).value.trim(); if (!ref) { ui().toast('Pick a target first', { kind: 'info' }); return; }
    const np = { pos, target: { kind: $('#pfK', d).value, ref }, label: $('#pfL', d).value.trim() || undefined, color: $('#pfCo', d).value };
    const m = $('#pfM', d).value, q = $('#pfQ', d).value, ch = $('#pfC', d).value.trim(); if (m) np.mode = m; if (q) np.quant = q; if (ch !== '') np.choke = +ch;
    const vt = $('#pfV', d).value.trim(); if (vt !== '') { const pv = controls.parseValue(vt); if (isNaN(pv)) { ui().toast('Value: not a number (try 1.5k, -6 dB, 2:30)', { kind: 'error' }); return; } np.target.value = pv; }
    bank.pads = bank.pads.filter((p) => p.pos !== pos).concat([np]); save(); rebuildPads(); close(); render(); ui().toast(`Pad ${pos}: ${np.target.kind}:${ref}`, { kind: 'ok' });
  });
}

/* ---------------- looper strip: record / overdub / undo a take of pad presses, replay it, save it ---------------- */
const Tk = { looper: null, bank: null, bars: 1, overdub: false, rec: null, play: null }; // transient transport of the looper; the take lives in pads.looper
function takeRec() {
  if (Tk.rec) { takeStop(); return; }
  if (!playing()) { ui().toast('Press Play first: takes record against the transport', { kind: 'info' }); return; }
  const from = Math.ceil(nowCycle() - 1e-9); Tk.rec = { from, to: from + Tk.bars, overdub: Tk.overdub && !!Tk.looper && Tk.bank === curTab().id }; render();
}
function takeStop() {
  const r = Tk.rec; Tk.rec = null; if (!r) return; const bank = curTab().id;
  const j = (sc.perform.journal || []).filter((e) => e.pad && e.pad.startsWith(bank + '/') && frac(e.cycle) >= r.from - 1e-9 && frac(e.cycle) < r.to - 1e-9);
  if (r.overdub) { const P = Tk.looper.performance, O = frac(P.origin), L = frac(P.length); const have = new Set(Tk.looper.periodic().entries.map((e) => `${frac(e.t)}|${e.pad}|${e.type}`));
    const shifted = j.map((e) => ({ ...e, cycle: T.toFrac(O + ((((frac(e.cycle) - r.from) % L) + L) % L)) })).filter((e) => !have.has(`${frac(e.cycle) - O}|${e.pad}|${/^(bind|let|open|tap)$/.test(e.op) ? 'on' : 'off'}`));
    Tk.looper.overdub(shifted); }
  else { Tk.looper = sc.pads.looper({ length: Tk.bars, origin: r.from }); Tk.bank = bank; Tk.looper.record(j); }
  render(); ui().toast(`Take: ${Tk.looper.eventCount()} events in ${frac(Tk.looper.performance.length)} bar`, { kind: 'ok' });
}
function takeUndo() { if (!Tk.looper) return; Tk.looper.undo(); render(); }
function takePlay() {
  if (Tk.play) { Tk.play = null; render(); return; }
  if (!Tk.looper || !Tk.looper.eventCount()) { ui().toast('Record or load a take first', { kind: 'info' }); return; }
  if (!playing()) { ui().toast('Press Play first: takes replay against the transport', { kind: 'info' }); return; }
  Tk.play = { base: Math.ceil(nowCycle() - 1e-9), k: 0 }; takeSchedule(); render();
}
function takeSchedule() { // schedule replay one loop ahead as pad intents (the pad engine quantises and journals them as live presses)
  const p = Tk.play; if (!p || !Tk.looper) return; const L = frac(Tk.looper.performance.length); const per = Tk.looper.periodic(); let n = 0;
  while (p.base + p.k * L < nowCycle() + L) {
    for (const e of per.entries) { const cyc = p.base + p.k * L + frac(e.t); const [b, pos] = e.pad.split('/'); const pad = (M.banks[b]?.pads || []).find((x) => x.pos === pos); if (!pad) continue;
      const mode = sc.pads.lib.padDefaults(pad).mode;
      if (e.type === 'on') pads.press(e.pad, cyc, e.velocity); else if (mode === 'gate') pads.release(e.pad, cyc); else if (mode === 'toggle') pads.press(e.pad, cyc); n++; }
    p.k++;
  }
  if (n) journalChanged();
}
async function takeLoad() {
  const L = await libP(); const recs = L.list({ kind: 'performance' });
  if (!recs.length) { ui().toast('No takes in the library yet', { kind: 'info' }); return; }
  const v = await choose({ title: 'Load take', options: recs.map((r) => ({ label: `${r.name}@${r.rev}`, value: r.name })) }); if (!v) return;
  const rec = L.get(v); const lp = sc.pads.looper({ length: frac(rec.performance.length), origin: frac(rec.performance.origin) }); lp.performance.layers = JSON.parse(JSON.stringify(rec.performance.layers));
  Tk.looper = lp; Tk.bank = rec.bank || curTab().id; render(); ui().toast(`Loaded take ${v}: ${lp.eventCount()} events`, { kind: 'ok' });
}
function renderLooper(host) {
  const c = nowCycle(); const r = Tk.rec;
  const stat = r ? (c < r.from ? `Rec starts in ${Math.max(1, Math.ceil((r.from - c) * 4))} beats` : `◉ Recording: ${Math.max(0, Math.ceil((r.to - c) * 4))} beats left`)
    : Tk.looper ? `Take: ${Tk.looper.eventCount()} events, ${frac(Tk.looper.performance.length)} bar, ${Tk.looper.performance.layers.length} layer${Tk.looper.performance.layers.length === 1 ? '' : 's'}${Tk.play ? ', playing' : ''}` : 'No take yet';
  host.append(h('div', { class: 'pf-looper', role: 'group', 'aria-label': 'Looper' },
    h('button', { type: 'button', class: 'pf-rec', id: 'pfTakeRec', 'aria-pressed': String(!!r), onclick: takeRec }, r ? '■ Stop' : '● Rec'),
    h('label', { class: 'pf-sel' }, h('span', { class: 'sr' }, 'Take length'), h('select', { id: 'pfTakeBars', onchange: (e) => { Tk.bars = +e.target.value; } }, ...[1, 2, 4].map((n) => h('option', { value: n, selected: Tk.bars === n }, n + ' bar')))),
    h('button', { type: 'button', id: 'pfTakeOd', 'aria-pressed': String(Tk.overdub), onclick: () => { Tk.overdub = !Tk.overdub; render(); } }, 'Overdub'),
    h('button', { type: 'button', id: 'pfTakeUndo', disabled: !Tk.looper || !Tk.looper.performance.layers.length, onclick: takeUndo }, '↶ Undo'),
    h('button', { type: 'button', id: 'pfTakePlay', 'aria-pressed': String(!!Tk.play), disabled: !Tk.looper, onclick: takePlay }, Tk.play ? '■ Stop take' : '▶ Play take'),
    h('button', { type: 'button', id: 'pfTakeSave', disabled: !Tk.looper, onclick: () => saveLib('take') }, 'Save take'),
    h('button', { type: 'button', id: 'pfTakeLoad', class: 'ghost', onclick: takeLoad }, 'Takes…'),
    h('output', { class: 'pf-stat', id: 'pfTakeStat', 'aria-live': 'polite' }, stat)));
}

/* ---------------- library save: bank, board, take, lane ---------------- */
async function saveLib(kind, arg) {
  const t = curTab(); const def = kind === 'lane' ? `lane-${arg}` : kind === 'take' ? `take-${Tk.bank || t.id}` : `${kind}-${t.name}`;
  const n = await ui().ask({ title: `Save ${kind} to library`, label: 'Name', value: slug(def), okText: 'Save' }); if (!n) return;
  const name = slug(n); let model;
  if (kind === 'bank') model = { model: 1, bank: M.banks[t.id] };
  else if (kind === 'board') { const b = M.boards[t.id]; const names = b.cells.length ? b.cells : controls.list().map((c) => c.name); const all = controls.toModel();
    model = { model: 1, board: { ...b, cells: names }, controls: Object.fromEntries(names.filter((x) => all.controls?.[x]).map((x) => [x, all.controls[x]])), maps: (all.maps || []).filter((m) => names.includes(m.control.split(':')[0])) }; }
  else if (kind === 'take') { const ps = new Set(Tk.looper.periodic().entries.map((e) => e.pad)); model = { model: 1, bank: Tk.bank, performance: Tk.looper.performance, pads: Object.fromEntries([...ps].map((a) => { const [b, pos] = a.split('/'); const p = (M.banks[b]?.pads || []).find((x) => x.pos === pos); return [a, p ? p.target : null]; })) }; }
  else if (kind === 'lane') model = { model: 1, automation: { ['lane:' + arg]: laneOf(arg) }, controls: { [arg]: controls.toModel().controls?.[arg] } };
  try { const L = await libP(); const r = L.save(JSON.parse(JSON.stringify(model)), { name, kind: kind === 'take' ? 'performance' : kind }); ui().toast(`Saved ${name}@${r.rev} (${kind === 'take' ? 'performance' : kind})`, { kind: 'ok' }); return r; }
  catch (e) { ui().toast('Save failed: ' + e.message, { kind: 'error' }); }
}

/* ---------------- board + edit mode (place, resize presets, move, "Move to...") ---------------- */
const SIZES = [['1x1', 'Small (1×1)'], ['2x1', 'Wide (2×1)'], ['2x2', 'Large (2×2)']];
function boardNames(board) { return board.cells.length ? board.cells : controls.list().map((c) => c.name); }
function renderBoard(host, board) {
  const names = boardNames(board);
  const bar = h('div', { class: 'pf-row pf-boardbar' },
    h('button', { type: 'button', id: 'pfLearn', 'aria-pressed': String(!!M.learn), onclick: learn }, M.learn ? `Learning → ${M.learn} (cancel)` : 'Learn'),
    h('button', { type: 'button', id: 'pfLaneRec', class: 'pf-rec', 'aria-pressed': String(A.armed || !!A.run), onclick: recArm }, A.run ? `◉ Rec ${A.run.name}` : A.armed ? '● Armed (cancel)' : '● Rec lane'),
    h('label', { class: 'pf-sel' }, h('span', { class: 'sr' }, 'Lane length'), h('select', { id: 'pfLaneBars', onchange: (e) => { A.bars = +e.target.value; } }, ...[1, 2, 4].map((n) => h('option', { value: n, selected: A.bars === n }, n + ' bar')))),
    h('button', { type: 'button', id: 'pfLaneUndo', disabled: !A.undo.length, onclick: recUndo }, '↶ Lane'),
    h('button', { type: 'button', id: 'pfEdit', 'aria-pressed': String(!!M.boardEdit), onclick: () => { M.boardEdit = !M.boardEdit; if (M.boardEdit && !board.cells.length) board.cells = names.slice(); save(); render(); } }, M.boardEdit ? 'Done editing' : 'Edit layout'));
  host.append(bar);
  const msg = M.learn ? `Learn: move any control to map it to ${M.learn}.` : A.run ? `Recording ${A.run.name}: ${Math.max(0, Math.ceil((A.run.c0 + A.run.len - nowCycle()) * 4))} beats left.` : A.armed ? `Lane armed: move ${A.only || 'a number control'} to record ${A.bars} bar${A.bars > 1 ? 's' : ''}${A.overdub ? ' (overdub)' : ''}.` : M.boardEdit ? 'Edit layout: place controls, pick a size, move them or send them to another board.' : '';
  host.append(h('p', { class: 'pf-banner', id: 'pfBanner', role: 'status', hidden: !msg }, msg));
  const g = h('div', { class: 'pc-board', 'data-edit': M.boardEdit ? 'on' : null }); names.forEach((n) => { try { renderControl(g, n, { board }); } catch (e) { /* undeclared */ } });
  if (!names.length) g.append(h('p', { class: 'pc-empty' }, 'No controls yet. Add one here, or use ctl("name", {type: "knob", min, max}) or slider(v, min, max) in your code.'));
  host.append(g);
  host.append(h('div', { class: 'pf-row' }, h('button', { type: 'button', class: 'ghost', onclick: addControl }, '+ Control'), M.boardEdit ? h('button', { type: 'button', class: 'ghost', id: 'pfPlace', onclick: () => placeControl(board) }, '+ Place') : null));
}
async function addControl() {
  const name = await ui().ask({ title: 'New control', label: 'Name', value: 'cutoff', okText: 'Next' }); if (!name) return;
  const type = await choose({ title: 'Control type', options: sc.controls.types().map((t) => ({ label: t.id + (t.drawn ? '' : ' (basic view)'), value: t.id })) }); if (!type) return;
  try { controls.declare(name.trim(), { type: type.trim(), min: 0, max: 1 }); } catch (e) { ui().toast(e.message, { kind: 'error' }); return; }
  const b = M.boards[curTab().id]; if (b && b.cells.length && !b.cells.includes(name)) b.cells.push(name.trim());
  persistControls(); render();
}
async function placeControl(board) {
  const free = controls.list().map((c) => c.name).filter((n) => !board.cells.includes(n));
  if (!free.length) { ui().toast('Every control is on this board', { kind: 'info' }); return; }
  const v = await choose({ title: 'Place a control', options: free.map((n) => ({ label: n, value: n })) }); if (!v) return; board.cells.push(v); save(); render();
}
async function cellEdit(board, name) {
  const i = board.cells.indexOf(name); const others = M.tabs.filter((t) => t.kind === 'board' && t.id !== board.id);
  const v = await choose({ title: 'Cell: ' + name, message: `Size ${board.size[name] || '1x1'}, position ${i + 1} of ${board.cells.length}`, options: [
    ...SIZES.map(([k, l]) => ({ label: (board.size[name] || '1x1') === k ? `● ${l}` : l, value: 'size:' + k })),
    { label: '◀ Move earlier', value: 'mv:-1' }, { label: 'Move later ▶', value: 'mv:1' },
    ...others.map((t) => ({ label: `Move to "${t.name}"…`, value: 'to:' + t.id })), { label: 'Remove from board', value: 'rm', danger: true }] });
  if (!v) return;
  if (v.startsWith('size:')) { const k = v.slice(5); if (k === '1x1') delete board.size[name]; else board.size[name] = k; }
  else if (v.startsWith('mv:')) { const j = i + +v.slice(3); if (j >= 0 && j < board.cells.length) [board.cells[i], board.cells[j]] = [board.cells[j], board.cells[i]]; }
  else if (v.startsWith('to:')) { const dst = M.boards[v.slice(3)]; if (!dst.cells.length) dst.cells = controls.list().map((c) => c.name).filter((n) => n !== name); if (!dst.cells.includes(name)) dst.cells.push(name); if (board.size[name]) dst.size[name] = board.size[name]; board.cells.splice(i, 1); delete board.size[name]; ui().toast(`${name} moved to "${M.tabs.find((t) => t.id === dst.id).name}"`, { kind: 'ok' }); }
  else if (v === 'rm') { board.cells.splice(i, 1); delete board.size[name]; }
  save(); render();
}

/* ---------------- AST-bound sites (docs/CONTROL_BINDING.md) ---------------- */
const SITES = { rack: [], stack: [] }; const lits = new Map(); const labels = new Map();
/* range spec (CONTROL_BINDING section 9): user override per AST id (M.ranges) > code literal / ctl spec > param shape > 0..1 */
const CURVE = { linear: 'lin', lin: 'lin', log: 'log', exp: 'exp', db: 'db', bipolar: 'bipolar' };
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o && o[k] !== undefined).map((k) => [k, k === 'curve' ? CURVE[o[k]] || 'lin' : o[k]]));
function shapeOf(site) { const P = sc.intellisense && sc.intellisense.__paramsSync; const sh = P && site.param && P[site.param] && P[site.param][Math.max(0, site.arg)]; return sh && sh.shape === 'number' ? sh : null; }
function specOf(site) {
  const sh = shapeOf(site); const ov = (M.ranges || {})[site.id] || {};
  const base = site.kind === 'slider' ? { type: 'slider', ...pick(sh, ['step', 'unit', 'curve', 'clamp']), min: site.min ?? 0, max: site.max ?? 1, default: site.value ?? site.min ?? 0 }
    : { type: 'knob', min: 0, max: 1, ...pick(sh, ['min', 'max', 'step', 'unit', 'curve', 'clamp']), ...(site.spec || {}) };
  if (base.curve) base.curve = CURVE[base.curve] || 'lin';
  return { clamp: 'soft', ...base, ...pick(ov, ['min', 'max', 'step', 'unit', 'curve', 'clamp']), site: true };
}
function ensureSite(site) {
  const sp = specOf(site); if (site.label) { labels.set(site.id, site.label); controls.alias(site.label, site.id); }
  try {
    if (!controls.has(site.id)) controls.declare(site.id, sp);
    else { const c = controls.declare(site.id); if (['type', 'min', 'max', 'curve', 'unit', 'step', 'clamp'].some((k) => c[k] !== sp[k])) controls.redeclare(site.id, sp); }
    const lit = sp.default; const prev = lits.get(site.id); /* literal edit in code = intent: value follows it */
    if (prev !== undefined && lit !== undefined && prev !== lit && typeof lit === 'number') controls.set(site.id, sp.clamp === 'hard' ? Math.min(sp.max, Math.max(sp.min, lit)) : lit);
    if (lit !== undefined) lits.set(site.id, lit);
  } catch (e) { /* bad spec: keep the last good one */ }
}
window.addEventListener('controls:sites', (e) => { const { view, sites } = e.detail; SITES[view] = sites; sites.forEach(ensureSite); persistControls(); renderInline(); });

/* ---------------- inline controls under the editors ---------------- */
/* strip = sites of that view's last good compile (AST-derived), keyed by site id and diffed in place; ctl()/slider() calls outside
   the binder (legacy order list) still show when that view is playing */
function renderInline() {
  for (const [id, view] of [['code', 'rack'], ['stackCode', 'stack']]) {
    const ta = document.getElementById(id); if (!ta) continue; const panel = ta.closest('.editor'); let strip = panel.querySelector('.pc-inline');
    let list = (SITES[view] || []).filter((x) => controls.has(x.id));
    if (!list.length) { const st = sc.engineState && sc.engineState(); const mine = st && st.playing && (st.srcView || 'rack') === view;
      list = mine ? order.filter((n) => { try { controls.declare(n); return true; } catch (e) { return false; } }).map((n) => ({ id: n, legacy: true })) : []; }
    if (!list.length) { if (strip) strip.hidden = true; continue; }
    if (!strip) { strip = h('div', { class: 'pc-inline', role: 'group', 'aria-label': 'Controls in this program' }); panel.append(strip); }
    strip.hidden = false;
    let banner = strip.querySelector('.pf-banner'); if (M.learn && !banner) { banner = h('p', { class: 'pf-banner', role: 'status' }); strip.prepend(banner); } if (banner) { if (M.learn) banner.textContent = `Learn: move a control to map it to ${M.learn}.`; else { banner.remove(); banner = null; } }
    const have = new Map([...strip.querySelectorAll(':scope > .pc-cell')].map((c) => [c.dataset.site, c])); const keep = new Set(); let prev = banner;
    for (const st of list) {
      const sig = JSON.stringify([controls.declare(st.id), st.label, st.param, st.arg, st.slot, M.learn, A.armed, A.run && A.run.name, !!laneOf(st.id), controls.maps().filter((m) => m.control.split(':')[0] === st.id).map((m) => m.dest)]);
      let cell = have.get(st.id);
      const make = () => { const c = renderControl(h('div'), st.id, { site: st.legacy ? null : st }); c.dataset.site = st.id; c.dataset.sig = sig; return c; };
      if (cell && cell.dataset.sig !== sig) { const nc = make(); cell.replaceWith(nc); cell = nc; }
      else if (!cell) cell = make();
      else cell.querySelectorAll('[data-ctl]').forEach((el) => el.__sync && el.__sync());
      keep.add(st.id); const want = prev ? prev.nextSibling : strip.firstChild; if (want !== cell) strip.insertBefore(cell, want); prev = cell;
    }
    for (const [k, c] of have) if (!keep.has(k)) c.remove();
  }
}
/* ---------------- tabs + view ---------------- */
function render() {
  const root = $('#perform'); if (!root) return; const t = curTab();
  const strip = h('div', { class: 'pf-tabs', role: 'tablist', 'aria-label': 'Pad banks and boards' },
    ...M.tabs.map((tb, i) => h('button', { type: 'button', role: 'tab', id: 'pft' + i, class: 'pf-tab', 'aria-selected': String(i === M.active), tabindex: i === M.active ? 0 : -1, 'aria-controls': 'pfBody', 'data-i': i, 'data-kind': tb.kind },
      h('span', { class: 'pf-ic', 'aria-hidden': 'true' }, tb.kind === 'bank' ? '▦' : '◎'), h('span', {}, tb.name), h('span', { class: 'sr' }, tb.kind === 'bank' ? ' (pad bank)' : ' (control board)'))));
  strip.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) select(+b.dataset.i); });
  strip.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); select(e.key === 'Home' ? 0 : M.tabs.length - 1, true); return; } if (!d) return; e.preventDefault(); e.stopPropagation(); if (e.altKey) move(d); else { const i0 = +(e.target.closest('[role=tab]')?.dataset.i ?? M.active); select((i0 + d + M.tabs.length) % M.tabs.length, true); } });
  const bank = t.kind === 'bank' ? M.banks[t.id] : null;
  const tools = h('div', { class: 'pf-tools' }, h('details', { class: 'pf-more' }, h('summary', {}, 'Tabs ⋯'), h('div', { class: 'pf-menu' },
    h('button', { type: 'button', class: 'ghost', onclick: () => addTab('bank') }, '+ Bank'), h('button', { type: 'button', class: 'ghost', onclick: () => addTab('board') }, '+ Board'),
    h('button', { type: 'button', class: 'ghost', onclick: renameTab }, 'Rename'), h('button', { type: 'button', class: 'ghost', onclick: dupTab }, 'Duplicate'),
    h('button', { type: 'button', class: 'ghost', 'aria-label': 'Move tab left', onclick: () => move(-1) }, '◀'), h('button', { type: 'button', class: 'ghost', 'aria-label': 'Move tab right', onclick: () => move(1) }, '▶'),
    bank ? h('button', { type: 'button', class: 'ghost', id: 'pfScenes', onclick: () => { bank.scenes = !bank.scenes ? 'row' : bank.scenes === 'row' ? 'col' : undefined; if (!bank.scenes) delete bank.scenes; save(); render(); } }, `Scenes: ${bank.scenes === 'row' ? 'rows' : bank.scenes === 'col' ? 'columns' : 'off'}`) : null,
    h('button', { type: 'button', class: 'ghost', id: 'pfSaveTab', onclick: () => saveLib(t.kind) }, 'Save to library'),
    h('button', { type: 'button', class: 'ghost', onclick: delTab }, 'Delete'))),
    bank ? h('button', { type: 'button', class: 'pf-mode', 'aria-pressed': String(!!M.perform), onclick: () => { M.perform = !M.perform; save(); render(); } }, h('span', { 'aria-hidden': 'true' }, M.perform ? '▶ ' : '✎ '), M.perform ? 'Perform mode' : 'Edit mode') : null);
  const body = h('div', { id: 'pfBody', class: 'pf-body', role: 'tabpanel', 'aria-labelledby': 'pft' + M.active, tabindex: 0 });
  if (bank) { renderBank(body, bank); renderLooper(body); body.append(h('p', { class: 'pf-hint' }, M.perform ? 'Perform: tap or hold pads (keys 1-4, Q-R, A-F, Z-V). Empty pads open the pad sheet.' : 'Edit: tap a pad to set its target, mode, quantise, choke, colour and label.')); }
  else renderBoard(body, M.boards[t.id]);
  const a = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null; const keep = a && (a.id ? '#' + CSS.escape(a.id) : a.dataset.ctl ? `[data-ctl="${CSS.escape(a.dataset.ctl)}"]` : null);
  root.replaceChildren(strip, tools, body); const back = keep && root.querySelector(keep); if (back) back.focus({ preventScroll: true });
}
function select(i, focus) { M.active = i; save(); if (curTab().kind === 'bank') pads.setBank(Object.keys(M.banks).indexOf(curTab().id)); render(); if (focus) $('#pft' + i).focus(); }
function uid(p) { let i = 1; while (M.banks[p + i] || M.boards[p + i]) i++; return p + i; }
function addTab(kind) { const id = uid(kind === 'bank' ? 'B' : 'board'); if (kind === 'bank') M.banks[id] = { id, rows: 4, cols: 4, pads: [] }; else M.boards[id] = { id, cells: [], size: {} }; M.tabs.push({ kind, id, name: kind === 'bank' ? 'Bank ' + id : 'Board ' + id.replace('board', '') }); rebuildPads(); select(M.tabs.length - 1, true); }
async function renameTab() { const t = curTab(); const n = await ui().ask({ title: 'Rename tab', label: 'Name', value: t.name, okText: 'Rename' }); if (n && n.trim()) { t.name = n.trim(); save(); render(); } }
function dupTab() { const t = curTab(); const id = uid(t.kind === 'bank' ? 'B' : 'board'); if (t.kind === 'bank') M.banks[id] = { ...JSON.parse(JSON.stringify(M.banks[t.id])), id }; else M.boards[id] = { ...JSON.parse(JSON.stringify(M.boards[t.id])), id }; M.tabs.splice(M.active + 1, 0, { kind: t.kind, id, name: t.name + ' copy' }); rebuildPads(); select(M.active + 1, true); }
function move(d) { const i = M.active, j = i + d; if (j < 0 || j >= M.tabs.length) return; [M.tabs[i], M.tabs[j]] = [M.tabs[j], M.tabs[i]]; M.active = j; save(); render(); $('#pft' + j).focus(); }
async function delTab() { if (M.tabs.length < 2) { ui().toast('Keep at least one tab', { kind: 'info' }); return; } const t = curTab(); if (!(await ui().askYesNo({ title: 'Delete tab', message: `Delete "${t.name}"? Its pads or board layout go with it.`, okText: 'Delete', danger: true }))) return; M.tabs.splice(M.active, 1); if (t.kind === 'bank') delete M.banks[t.id]; else delete M.boards[t.id]; M.active = Math.max(0, M.active - 1); rebuildPads(); save(); render(); }

/* ---------------- keyboard via the input registry ---------------- */
const isPerformView = () => document.getElementById('main')?.dataset.view === 'perform' && curTab().kind === 'bank' && M.perform;
let routerOff = null;
function wireInput() {
  if (routerOff) return; const input = sc.input;
  input.register(sc.pads.keyboardProvider({ target: document, perform: isPerformView }));
  routerOff = input.subscribe((ev) => {
    if (ev.provider !== 'keyboard') return; const t = sc.pads.defaultKeyboardMap[ev.control]; if (!t || !isPerformView()) return;
    const bank = M.banks[curTab().id]; if (t.startsWith('action:')) { if (ev.type === 'on') select((M.active + (t.endsWith('next') ? 1 : -1) + M.tabs.length) % M.tabs.length); return; }
    (ev.type === 'on' ? press : release)(bank, t, ev.velocity);
    const b = document.querySelector(`.pp-pad[data-pos="${t}"]`); if (b) b.classList.toggle('pp-hit', ev.type === 'on');
  });
}

/* ---------------- transport tick: queued marks, lane playback, take record/replay ---------------- */
let lastStat = '';
setInterval(() => {
  const on = playing(); const view = document.getElementById('main')?.dataset.view;
  if (A.run && nowCycle() >= A.run.c0 + A.run.len) recFinish();
  if (Tk.rec && on && nowCycle() >= Tk.rec.to) takeStop();
  if (Tk.play && on) takeSchedule(); else if (Tk.play && !on) { Tk.play = null; if (view === 'perform') render(); }
  if (!on) return;
  if (controls.lanes().size) for (const id of controls.lanes().keys()) refreshValues(id.slice(5));
  if (view !== 'perform') return;
  if (curTab().kind === 'bank') { if (document.querySelector('.pp-pad[data-state="queued"], .pp-pad[data-state="recording"]') || Tk.rec || Tk.play) renderPadsOnly(); const s = $('#pfTakeStat'); if (s && Tk.rec) { const c = nowCycle(), r = Tk.rec; const t = c < r.from ? `Rec starts in ${Math.max(1, Math.ceil((r.from - c) * 4))} beats` : `◉ Recording: ${Math.max(0, Math.ceil((r.to - c) * 4))} beats left`; if (t !== lastStat) { s.textContent = lastStat = t; } } }
  else if (A.run) { const b = $('#pfBanner'); if (b) b.textContent = `Recording ${A.run.name}: ${Math.max(0, Math.ceil((A.run.c0 + A.run.len - nowCycle()) * 4))} beats left.`; }
}, 100);

/* ---------------- boot ---------------- */
rebuildPads();
sc.perform = { model: () => M, render, renderInline, controls, sites: (v) => SITES[v] || [], pads: () => pads, journal: [], latency: lat, work, glue: bindStrudel, looper: () => Tk.looper, take: Tk, lanes: A,
  capturing: (e) => isPerformView() && !e.ctrlKey && !e.metaKey && !e.altKey && /^(Digit[1-4]|Key[QWERASDFZXCV]|Bracket(Left|Right))$/.test(e.code) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable };
bindStrudel(); window.addEventListener('strudel:ready', bindStrudel); wireInput();
if (sc.binder) { for (const v of ['rack', 'stack']) { SITES[v] = sc.binder.sites(v); SITES[v].forEach(ensureSite); } }
render(); renderInline();
