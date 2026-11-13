/* Perform view (#55): one tab strip of pad banks and control boards, pad grid (multi-touch + keyboard via the input
   registry), pad sheet, board with renderers for the drawn control types, inline controls under the editors, Strudel bindings
   ctl()/slider(). All state lives in the engines (strudelCraft.pads / strudelCraft.controls) and a persisted model
   (localStorage "sc.perform"); the views re-render from it. Loaded on first open of Perform or on first Play. */
const sc = window.strudelCraft;
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter((x) => x != null)); return e; };
const ui = () => sc.ui;
const KEY = 'sc.perform';

/* ---------------- model ---------------- */
const defModel = () => ({ tabs: [{ kind: 'bank', id: 'A', name: 'Bank A' }, { kind: 'board', id: 'main', name: 'Board' }], active: 0, perform: true,
  banks: { A: { id: 'A', rows: 4, cols: 4, pads: [] } }, boards: { main: { id: 'main', cells: [] } }, controls: {}, maps: [] });
let M; try { M = JSON.parse(localStorage.getItem(KEY)) || defModel(); } catch (e) { M = defModel(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(M)); } catch (e) { /* full */ } };

/* ---------------- engines ---------------- */
const controls = sc.controls.create({ strict: false });
for (const [n, s] of Object.entries(M.controls)) { try { controls.declare(n, s); if (s.value !== undefined) controls.set(n, s.value); } catch (e) { /* skip */ } }
(M.maps || []).forEach((m) => { try { controls.map(m.control, m.dest, m); } catch (e) { /* skip */ } });
let pads = null;
function rebuildPads() { pads = sc.pads.create({ banks: Object.values(M.banks), model: { settings: { bpb: 4, cpb: 1 } } }); pads.setBank(Math.max(0, Object.keys(M.banks).indexOf(curTab().id))); }
const curTab = () => M.tabs[M.active] || M.tabs[0];
const nowCycle = () => { try { const st = sc.engineState && sc.engineState(); return st && st.playing && st.scheduler ? st.scheduler.now() : 0; } catch (e) { return 0; } };
const persistControls = () => { const m = controls.toModel(); M.controls = m.controls || {}; M.maps = m.maps || []; save(); };

/* ---------------- Strudel bindings: ctl() and slider() read the controls engine continuously ---------------- */
const order = []; // declaration order in the program (source order)
function bindStrudel() {
  if (!window.signal || window.__scCtl) return; window.__scCtl = true;
  const sig = (name) => window.signal(() => { const v = controls.get(name, nowCycle()); return typeof v === 'object' ? v.x : v; });
  const un = (v) => (v && typeof v === 'object' && typeof v.firstCycle === 'function' ? (v.__pure !== undefined ? v.__pure : (v.firstCycle()[0] || {}).value) : v);
  const unSpec = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(un) : v && typeof v === 'object' && typeof v.firstCycle !== 'function' ? unSpec(v) : un(v)]));
  window.ctl = (name, spec = {}) => {
    name = String(un(name)); spec = unSpec(spec);
    if (!controls.list().some((c) => c.name === name)) { try { controls.declare(name, { type: 'knob', min: 0, max: 1, ...spec }); } catch (e) { /* conflict: keep the first */ } persistControls(); }
    if (!order.includes(name)) order.push(name); queueInline(); return sig(name);
  };
  window.sliderWithID = (id, value, min = 0, max = 1) => { id = String(un(id)); value = +un(value); min = +un(min); max = +un(max); const f = controls.sliderWithID(id, value, min, max); if (!order.includes(f.controlName)) order.push(f.controlName); queueInline(); return sig(f.controlName); };
}
let inlineT = 0; function queueInline() { clearTimeout(inlineT); inlineT = setTimeout(renderInline, 60); }
window.addEventListener('live:swap', () => { order.length = 0; });

/* ---------------- control renderers ---------------- */
const fmt = (v, s) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v)) + (s.unit ? ' ' + s.unit : '');
function setVal(name, v) { try { controls.set(name, v); } catch (e) { ui().toast(e.message, { kind: 'error' }); } persistControls(); refreshValues(name); }
function refreshValues(name) { document.querySelectorAll(`[data-ctl="${CSS.escape(name)}"]`).forEach((el) => el.__sync && el.__sync()); }
function numberish(kind) {
  return (host, name, s) => {
    const [lo, hi] = [s.min ?? 0, s.max ?? 1]; const step = s.step || (hi - lo) / 100;
    const el = h('div', { class: 'pc-' + kind, role: 'slider', tabindex: 0, 'aria-label': name, 'aria-valuemin': lo, 'aria-valuemax': hi, 'data-ctl': name });
    const fill = h('i', { class: 'pc-fill' }); const out = h('output', { class: 'pc-val' });
    el.append(fill, out);
    el.__sync = () => { const v = controls.get(name); const t = controls.travelOf(name, v); el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuetext', fmt(v, s)); out.textContent = fmt(v, s); el.style.setProperty('--t', t); };
    let drag = null;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); drag = { y: e.clientY, x: e.clientX, t: controls.travelOf(name) }; e.preventDefault(); el.focus({ preventScroll: true }); });
    el.addEventListener('pointermove', (e) => { if (!drag) return; const d = kind === 'slider' ? (e.clientX - drag.x) / Math.max(80, el.clientWidth) : (drag.y - e.clientY) / 160; controls.input('value', name, Math.min(1, Math.max(0, drag.t + d))); persistControls(); refreshValues(name); });
    const end = () => { drag = null; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const m = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (m) { e.preventDefault(); e.stopPropagation(); setVal(name, Math.min(hi, Math.max(lo, +(controls.get(name) + m * step).toFixed(6)))); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setVal(name, e.key === 'Home' ? lo : hi); }
      else if (e.key === 'Enter') { e.preventDefault(); typed(); }
    });
    el.addEventListener('dblclick', typed);
    async function typed() { const v = await ui().ask({ title: 'Set ' + name, label: `Value (${lo} to ${hi})`, value: String(controls.get(name)), okText: 'Set' }); if (v != null && v !== '' && !isNaN(+v)) setVal(name, Math.min(hi, Math.max(lo, +v))); }
    el.__sync(); host.append(el); return el;
  };
}
const R = {
  slider: numberish('slider'), fader: numberish('fader'), knob: numberish('knob'),
  number: (host, name, s) => { const el = h('input', { type: 'number', class: 'pc-number', 'data-ctl': name, 'aria-label': name, min: s.min, max: s.max, step: s.step || 'any' }); el.__sync = () => { el.value = controls.get(name); }; el.addEventListener('change', () => setVal(name, +el.value)); el.__sync(); host.append(el); return el; },
  toggle: (host, name) => { const el = h('button', { type: 'button', class: 'pc-toggle', 'data-ctl': name, 'aria-label': name }); el.__sync = () => { const on = !!controls.get(name); el.setAttribute('aria-pressed', String(on)); el.textContent = on ? 'ON' : 'OFF'; }; el.addEventListener('click', () => setVal(name, controls.get(name) ? 0 : 1)); el.__sync(); host.append(el); return el; },
  button: (host, name) => { const el = h('button', { type: 'button', class: 'pc-toggle', 'data-ctl': name, 'aria-label': name }, 'HOLD'); el.__sync = () => el.setAttribute('aria-pressed', String(!!controls.get(name))); el.addEventListener('pointerdown', () => setVal(name, 1)); const up = () => setVal(name, 0); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.__sync(); host.append(el); return el; },
  select: (host, name, s) => { const el = h('select', { class: 'pc-select', 'data-ctl': name, 'aria-label': name }, ...(s.options || []).map((o) => h('option', { value: o }, o))); el.__sync = () => { el.value = controls.get(name); }; el.addEventListener('change', () => setVal(name, el.value)); el.__sync(); host.append(el); return el; },
  xy: (host, name, s) => {
    const el = h('div', { class: 'pc-xy', role: 'slider', tabindex: 0, 'aria-label': name + ' (x/y)', 'data-ctl': name }); const dot = h('i'); el.append(dot);
    const ax = (a) => [s.axes?.[a]?.min ?? 0, s.axes?.[a]?.max ?? 1];
    el.__sync = () => { const v = controls.get(name) || { x: 0, y: 0 }; const [xl, xh] = ax('x'), [yl, yh] = ax('y'); dot.style.left = ((v.x - xl) / (xh - xl || 1)) * 100 + '%'; dot.style.top = (1 - (v.y - yl) / (yh - yl || 1)) * 100 + '%'; el.setAttribute('aria-valuetext', `x ${(+v.x).toFixed(2)}, y ${(+v.y).toFixed(2)}`); };
    const at = (e) => { const r = el.getBoundingClientRect(); const [xl, xh] = ax('x'), [yl, yh] = ax('y'); const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)); setVal(name, { x: xl + fx * (xh - xl), y: yl + fy * (yh - yl) }); };
    let on = false; el.addEventListener('pointerdown', (e) => { on = true; el.setPointerCapture(e.pointerId); at(e); e.preventDefault(); }); el.addEventListener('pointermove', (e) => on && at(e)); el.addEventListener('pointerup', () => { on = false; });
    el.addEventListener('keydown', (e) => { const d = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', 1], ArrowDown: ['y', -1] }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); const v = { ...(controls.get(name) || { x: 0, y: 0 }) }; const [lo, hi] = ax(d[0]); v[d[0]] = Math.min(hi, Math.max(lo, v[d[0]] + d[1] * (hi - lo) / 50)); setVal(name, v); });
    el.__sync(); host.append(el); return el;
  },
  steps: (host, name) => { const el = h('input', { type: 'text', class: 'pc-steps', 'data-ctl': name, 'aria-label': name + ' steps', spellcheck: 'false', autocapitalize: 'off' }); el.__sync = () => { el.value = controls.get(name); }; el.addEventListener('change', () => setVal(name, el.value)); el.__sync(); host.append(el); return el; },
};
for (const [id, fn] of Object.entries(R)) sc.controls.registerRenderer(id, fn);
function renderControl(host, name) {
  const s = controls.declare(name); const chain = sc.controls.registry.fallbackChain(s.type); const drawn = chain[chain.length - 1];
  const cell = h('div', { class: 'pc-cell' });
  const maps = controls.maps().filter((m) => m.control.split(':')[0] === name).map((m) => m.dest);
  cell.append(h('div', { class: 'pc-head' }, h('b', {}, name), h('span', { class: 'pc-type' }, s.type)));
  (R[drawn] || R.number)(cell, name, s);
  if (drawn !== s.type) cell.append(h('p', { class: 'pc-note' }, `basic view (${s.type} shown as ${drawn})`));
  cell.append(h('button', { type: 'button', class: 'pc-map ghost', title: 'Remap', onclick: () => remap(name) }, maps.length ? '→ ' + maps.join(', ') : 'Map…'));
  host.append(cell); return cell;
}
async function remap(name) {
  const d = await ui().ask({ title: 'Map ' + name, label: 'Destination (param or hook ref, empty to unmap)', value: controls.maps().find((m) => m.control === name)?.dest || '', okText: 'Map' });
  if (d == null) return; const ms = controls.maps(); for (let i = ms.length - 1; i >= 0; i--) if (ms[i].control === name) ms.splice(i, 1);
  if (d.trim()) controls.map(name, d.trim()); persistControls(); render(); renderInline(); ui().toast(d.trim() ? `${name} → ${d.trim()}` : `${name} unmapped`, { kind: 'ok' });
}

/* ---------------- pads ---------------- */
const STATE_MARK = { empty: '·', loaded: '○', queued: '◔', on: '●', recording: '◉' };
function padState(bank, pos) {
  const pad = bank.pads.find((p) => p.pos === pos); if (!pad) return { state: 'empty' };
  const addr = `${bank.id}/${pos}`; const j = pads.resolve().filter((e) => e.pad === addr); const c = nowCycle();
  const frac = (x) => { const [a, b] = String(x).split('/').map(Number); return b ? a / b : a; };
  const past = j.filter((e) => frac(e.cycle) <= c + 1e-9), future = j.filter((e) => frac(e.cycle) > c + 1e-9);
  const last = past[past.length - 1]; const on = last && /^(bind|let|tap|open)$/.test(last.op);
  if (future.length) return { state: 'queued', pad, beats: Math.max(0, Math.ceil((frac(future[0].cycle) - c) * 4)) };
  return { state: on ? 'on' : 'loaded', pad };
}
function renderBank(host, bank) {
  const grid = h('div', { class: 'pp-grid', style: `--cols:${bank.cols}`, role: 'grid', 'aria-label': 'Pads ' + bank.id });
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
    grid.append(row);
  }
  grid.addEventListener('pointerdown', (e) => { const b = e.target.closest('.pp-pad'); if (!b) return; e.preventDefault(); if (!M.perform) return; b.setPointerCapture(e.pointerId); press(bank, b.dataset.pos, e.pressure && e.pressure !== 0.5 ? e.pressure : undefined); b.__pid = e.pointerId; });
  const rel = (e) => { const b = e.target.closest('.pp-pad'); if (!b || !M.perform) return; release(bank, b.dataset.pos); };
  grid.addEventListener('pointerup', rel); grid.addEventListener('pointercancel', rel);
  grid.addEventListener('click', (e) => { const b = e.target.closest('.pp-pad'); if (!b) return; if (!M.perform || !bank.pads.find((p) => p.pos === b.dataset.pos)) padSheet(bank, b.dataset.pos); });
  grid.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.pp-pad')) { e.preventDefault(); e.stopPropagation(); const pos = e.target.closest('.pp-pad').dataset.pos; if (M.perform && bank.pads.find((p) => p.pos === pos)) { press(bank, pos); release(bank, pos); } else padSheet(bank, pos); } });
  host.append(grid);
}
function press(bank, pos, vel) { if (!bank.pads.find((p) => p.pos === pos)) return; pads.press(`${bank.id}/${pos}`, nowCycle(), vel); journalChanged(); }
function release(bank, pos) { if (!bank.pads.find((p) => p.pos === pos)) return; pads.release(`${bank.id}/${pos}`, nowCycle()); journalChanged(); }
let jT = 0; function journalChanged() { const j = pads.resolve(); sc.perform.journal = j; window.dispatchEvent(new CustomEvent('pads:journal', { detail: j })); cancelAnimationFrame(jT); jT = requestAnimationFrame(renderPadsOnly); }
function renderPadsOnly() { const t = curTab(); if (t.kind !== 'bank') return; const host = $('#pfBody'); if (!host) return; host.querySelectorAll('.pp-pad').forEach((b) => { const st = padState(M.banks[t.id], b.dataset.pos); b.dataset.state = st.state; b.querySelector('.pp-mark').textContent = STATE_MARK[st.state]; let bt = b.querySelector('.pp-beats'); if (st.state === 'queued') { if (!bt) { bt = h('span', { class: 'pp-beats' }); b.append(bt); } bt.textContent = st.beats + ' beats'; } else if (bt) bt.remove(); }); }
setInterval(() => { if ((sc.engineState && sc.engineState().playing) && document.querySelector('.pp-pad[data-state="queued"]')) renderPadsOnly(); }, 120);

function targetOptions() { const dl = h('datalist', { id: 'pfTargets' }); sc.intellisense.all().then((items) => { const seen = new Set(); items.filter((i) => !i.string).slice(0, 400).forEach((i) => { if (seen.has(i.label)) return; seen.add(i.label); dl.append(h('option', { value: i.label }, i.category)); }); }); return dl; }
async function padSheet(bank, pos) {
  const pad = bank.pads.find((p) => p.pos === pos) || { pos, target: { kind: 'var', ref: '' }, mode: '', quant: '', label: '', color: '' };
  const d = h('dialog', { class: 'scm pf-sheet', 'aria-labelledby': 'pfsT' });
  const f = h('form', { class: 'scm-body', method: 'dialog' },
    h('label', { class: 'scm-lab', for: 'pfK' }, 'Target kind'), h('select', { id: 'pfK', class: 'scm-input' }, ...['var', 'hook', 'tap', 'component', 'action', 'scene'].map((k) => h('option', { value: k, selected: pad.target.kind === k }, k))),
    h('label', { class: 'scm-lab', for: 'pfR' }, 'Target (reference)'), h('input', { id: 'pfR', class: 'scm-input', list: 'pfTargets', value: pad.target.ref, autocomplete: 'off' }), targetOptions(),
    h('label', { class: 'scm-lab', for: 'pfM' }, 'Mode'), h('select', { id: 'pfM', class: 'scm-input' }, ...['', 'toggle', 'gate', 'oneshot', 'retrigger'].map((k) => h('option', { value: k, selected: (pad.mode || '') === k }, k || 'default'))),
    h('label', { class: 'scm-lab', for: 'pfQ' }, 'Quantise'), h('select', { id: 'pfQ', class: 'scm-input' }, ...['', 'none', 'beat', 'bar', '2b', '4b'].map((k) => h('option', { value: k, selected: (pad.quant || '') === k }, k || 'default'))),
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
    bank.pads = bank.pads.filter((p) => p.pos !== pos).concat([np]); save(); rebuildPads(); close(); render(); ui().toast(`Pad ${pos}: ${np.target.kind}:${ref}`, { kind: 'ok' });
  });
}

/* ---------------- board ---------------- */
function renderBoard(host, board) {
  const names = board.cells.length ? board.cells : controls.list().map((c) => c.name);
  const g = h('div', { class: 'pc-board' }); names.forEach((n) => { try { renderControl(g, n); } catch (e) { /* undeclared */ } });
  if (!names.length) g.append(h('p', { class: 'pc-empty' }, 'No controls yet. Add one here, or use ctl("name", {type: "knob", min, max}) or slider(v, min, max) in your code.'));
  host.append(g);
  host.append(h('div', { class: 'pf-row' }, h('button', { type: 'button', class: 'ghost', onclick: addControl }, '+ Control')));
}
async function addControl() {
  const name = await ui().ask({ title: 'New control', label: 'Name', value: 'cutoff', okText: 'Next' }); if (!name) return;
  const type = await ui().ask({ title: 'Control type', label: 'Type: ' + sc.controls.types().map((t) => t.id).join(', '), value: 'knob', okText: 'Add' }); if (!type) return;
  try { controls.declare(name.trim(), { type: type.trim(), min: 0, max: 1 }); } catch (e) { ui().toast(e.message, { kind: 'error' }); return; }
  const b = M.boards[curTab().id]; if (b && b.cells.length && !b.cells.includes(name)) b.cells.push(name);
  persistControls(); render();
}

/* ---------------- inline controls under the editors ---------------- */
function renderInline() {
  for (const [id, view] of [['code', 'rack'], ['stackCode', 'stack']]) {
    const ta = document.getElementById(id); if (!ta) continue; const panel = ta.closest('.editor'); let strip = panel.querySelector('.pc-inline');
    const st = sc.engineState && sc.engineState(); const mine = st && (st.srcView || 'rack') === view;
    const names = mine ? order.filter((n) => { try { controls.declare(n); return true; } catch (e) { return false; } }) : [];
    if (!names.length) { if (strip) strip.remove(); continue; }
    if (!strip) { strip = h('div', { class: 'pc-inline', role: 'group', 'aria-label': 'Controls in this program' }); panel.append(strip); }
    strip.replaceChildren(); names.forEach((n) => renderControl(strip, n));
  }
}

/* ---------------- tabs + view ---------------- */
function render() {
  const root = $('#perform'); if (!root) return; const t = curTab();
  const strip = h('div', { class: 'pf-tabs', role: 'tablist', 'aria-label': 'Pad banks and boards' },
    ...M.tabs.map((tb, i) => h('button', { type: 'button', role: 'tab', id: 'pft' + i, class: 'pf-tab', 'aria-selected': String(i === M.active), tabindex: i === M.active ? 0 : -1, 'aria-controls': 'pfBody', 'data-i': i },
      h('span', { class: 'pf-ic', 'aria-hidden': 'true' }, tb.kind === 'bank' ? '▦' : '◎'), h('span', {}, tb.name), h('span', { class: 'sr' }, tb.kind === 'bank' ? ' (pad bank)' : ' (control board)'))));
  strip.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) select(+b.dataset.i); });
  strip.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); select(e.key === 'Home' ? 0 : M.tabs.length - 1, true); return; } if (!d) return; e.preventDefault(); e.stopPropagation(); if (e.altKey) move(d); else select((M.active + d + M.tabs.length) % M.tabs.length, true); });
  const tools = h('div', { class: 'pf-tools' }, h('details', { class: 'pf-more' }, h('summary', {}, 'Tabs ⋯'), h('div', { class: 'pf-menu' },
    h('button', { type: 'button', class: 'ghost', onclick: () => addTab('bank') }, '+ Bank'), h('button', { type: 'button', class: 'ghost', onclick: () => addTab('board') }, '+ Board'),
    h('button', { type: 'button', class: 'ghost', onclick: renameTab }, 'Rename'), h('button', { type: 'button', class: 'ghost', onclick: dupTab }, 'Duplicate'),
    h('button', { type: 'button', class: 'ghost', 'aria-label': 'Move tab left', onclick: () => move(-1) }, '◀'), h('button', { type: 'button', class: 'ghost', 'aria-label': 'Move tab right', onclick: () => move(1) }, '▶'),
    h('button', { type: 'button', class: 'ghost', onclick: delTab }, 'Delete'))),
    t.kind === 'bank' ? h('button', { type: 'button', class: 'pf-mode', 'aria-pressed': String(!!M.perform), onclick: () => { M.perform = !M.perform; save(); render(); } }, M.perform ? 'Perform mode' : 'Edit mode') : null);
  const body = h('div', { id: 'pfBody', class: 'pf-body', role: 'tabpanel', 'aria-labelledby': 'pft' + M.active, tabindex: 0 });
  if (t.kind === 'bank') { renderBank(body, M.banks[t.id]); body.append(h('p', { class: 'pf-hint' }, M.perform ? 'Perform: tap or hold pads (keys 1-4, Q-R, A-F, Z-V). Empty pads open the pad sheet.' : 'Edit: tap a pad to set its target, mode, quantise, choke, colour and label.')); }
  else renderBoard(body, M.boards[t.id]);
  root.replaceChildren(strip, tools, body);
}
function select(i, focus) { M.active = i; save(); if (curTab().kind === 'bank') pads.setBank(Object.keys(M.banks).indexOf(curTab().id)); render(); if (focus) $('#pft' + i).focus(); }
function uid(p) { let i = 1; while (M.banks[p + i] || M.boards[p + i]) i++; return p + i; }
function addTab(kind) { const id = uid(kind === 'bank' ? 'B' : 'board'); if (kind === 'bank') M.banks[id] = { id, rows: 4, cols: 4, pads: [] }; else M.boards[id] = { id, cells: [] }; M.tabs.push({ kind, id, name: kind === 'bank' ? 'Bank ' + id : 'Board ' + id.replace('board', '') }); rebuildPads(); select(M.tabs.length - 1, true); }
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

/* ---------------- boot ---------------- */
rebuildPads(); bindStrudel(); window.addEventListener('strudel:ready', bindStrudel); wireInput();
sc.perform = { model: () => M, render, renderInline, controls, pads: () => pads, journal: [], capturing: (e) => isPerformView() && !e.ctrlKey && !e.metaKey && !e.altKey && /^(Digit[1-4]|Key[QWERASDFZXCV]|Bracket(Left|Right))$/.test(e.code) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable };
render();
