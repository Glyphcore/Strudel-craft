// Input-provider registry + keymap router (BLUEPRINT 9.6, 10.4). No DOM at import time.
export const DEFAULT_KEYBOARD_MAP = (() => {
  const rows = [['Digit1', 'Digit2', 'Digit3', 'Digit4'], ['KeyQ', 'KeyW', 'KeyE', 'KeyR'], ['KeyA', 'KeyS', 'KeyD', 'KeyF'], ['KeyZ', 'KeyX', 'KeyC', 'KeyV']];
  const m = {};
  rows.forEach((r, i) => r.forEach((code, j) => { m['kbd:' + code] = `${i},${j}`; }));
  m['kbd:BracketLeft'] = 'action:bank:prev'; m['kbd:BracketRight'] = 'action:bank:next';
  return m;
})();

export function createInput() {
  const providers = new Map(), subs = new Set();
  const register = (p) => {
    if (!p || !p.id || typeof p.start !== 'function') throw new Error('E_BAD_ARG: provider needs id and start(emit)');
    if (providers.has(p.id)) providers.get(p.id).off();
    let live = true;
    const emit = (ev) => { if (live) subs.forEach(fn => fn({ ...ev, provider: p.id })); };
    const stop = p.start(emit);
    const off = () => { if (!live) return; live = false; providers.delete(p.id); if (typeof stop === 'function') stop(); };
    providers.set(p.id, { p, off });
    return off;
  };
  return {
    register,
    unregister: (id) => providers.get(id)?.off(),
    providers: () => [...providers.values()].map(({ p }) => ({ id: p.id, ...(p.describe ? p.describe() : {}) })),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

// Router: provider events -> pads / controls / actions through the active keymap.
// target strings: "r,c" pad in active bank, "action:NAME", "ctl:name", "ctl:name+0.05".
export function createRouter({ input, keymaps, active = {}, pads, controls, clock, cps = () => 1, latencyMs = 0 }) {
  const toCycle = (ev) => ev.cycle ?? (clock && ev.time != null ? clock.cycle + ((ev.time - latencyMs) - clock.ms) / 1000 * cps() : 0);
  const lookup = (ev) => (keymaps[active[ev.provider]] || keymaps[active.default] || {})[ev.control];
  return input.subscribe((ev) => {
    const t = lookup(ev); if (t == null) return;
    const cycle = toCycle(ev);
    if (ev.type === 'on' || ev.type === 'off') {
      if (t.startsWith('ctl:')) { if (ev.type === 'on') { const m = /^ctl:([^+-]+)([+-][\d.]+)?$/.exec(t); controls?.nudge(m[1], m[2] ? Number(m[2]) : 0.05); } return; }
      if (t.startsWith('action:')) { if (ev.type === 'on') pads.action(t.slice(7), cycle); return; }
      (ev.type === 'on' ? pads.press : pads.release)(t, cycle, ev.velocity);
    } else if ((ev.type === 'value' || ev.type === 'delta') && t.startsWith('ctl:')) {
      const name = t.slice(4).replace(/[+-][\d.]+$/, '');
      controls?.input(ev.type, name, ev.value, { control: ev.control });
    }
  });
}

const isTextTarget = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable === true);

// Keyboard provider (event.code, perform mode only, never from text fields).
export function keyboardProvider({ target, perform = () => false, now = () => Date.now() } = {}) {
  return {
    id: 'keyboard',
    describe: () => ({ label: 'Computer keyboard', velocity: false, controls: Object.keys(DEFAULT_KEYBOARD_MAP).map(id => ({ id, label: id.slice(8) })) }),
    start(emit) {
      const held = new Set();
      const h = (type) => (e) => {
        if (!perform() || isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (type === 'on') { if (e.repeat || held.has(e.code)) return; held.add(e.code); } else held.delete(e.code);
        emit({ type, control: 'kbd:' + e.code, velocity: 0.8, time: now() });
      };
      const d = h('on'), u = h('off');
      target.addEventListener('keydown', d); target.addEventListener('keyup', u);
      return () => { target.removeEventListener('keydown', d); target.removeEventListener('keyup', u); };
    },
  };
}

// Touch provider (logic only): the UI calls press(r,c,velocity) / release(r,c).
export function touchProvider({ now = () => Date.now() } = {}) {
  let emit = null;
  return {
    id: 'touch',
    describe: () => ({ label: 'On-screen grid', velocity: true, controls: [] }),
    start(e) { emit = e; return () => { emit = null; }; },
    press: (r, c, velocity = 0.8) => emit?.({ type: 'on', control: `touch:${r},${c}`, velocity, time: now() }),
    release: (r, c) => emit?.({ type: 'off', control: `touch:${r},${c}`, time: now() }),
  };
}

// Web MIDI stub: feature-detected, no pad-engine change. Emits value for CC.
export function webmidiProvider({ access } = {}) {
  return {
    id: 'webmidi',
    describe: () => ({ label: 'Web MIDI', velocity: true, controls: [] }),
    start(emit) {
      const nav = access || (typeof navigator !== 'undefined' && navigator.requestMIDIAccess);
      if (!nav) return () => {};
      return () => {};
    },
  };
}
