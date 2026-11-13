// Controls engine (BLUEPRINT 10): type registry, ctl(), slider shim, maps, takeover, automation lanes, bounce. No DOM.
import { fromFrac, toFrac, parseLength, canonical } from './time.js';

const err = (code, msg) => Object.assign(new Error(`${code}: ${msg}`), { code });
const BUILTIN_URL = new URL('../data/controls/types.json', import.meta.url);

// ---------- curves: travel 0..1 <-> real value ----------
const shape = {
  lin: [(t, lo, hi) => lo + (hi - lo) * t, (v, lo, hi) => (v - lo) / (hi - lo || 1)],
  exp: [(t, lo, hi) => (lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t * t), (v, lo, hi) => (lo > 0 && hi > 0 ? Math.log(v / lo) / Math.log(hi / lo) : Math.sqrt(Math.max(0, (v - lo) / (hi - lo || 1))))],
  log: [(t, lo, hi) => lo + (hi - lo) * Math.log1p(9 * t) / Math.log(10), (v, lo, hi) => (Math.pow(10, (v - lo) / (hi - lo || 1)) - 1) / 9],
  db: [(t, lo, hi) => Math.pow(10, (lo + (hi - lo) * t) / 20), (v, lo, hi) => (20 * Math.log10(Math.max(v, 1e-9)) - lo) / (hi - lo || 1)],
  bipolar: [(t, lo, hi) => lo + (hi - lo) * t, (v, lo, hi) => (v - lo) / (hi - lo || 1)],
};
export const curveOut = (curve = 'lin', t, lo, hi) => (shape[curve] || shape.lin)[0](Math.min(1, Math.max(0, t)), lo, hi);
export const curveIn = (curve = 'lin', v, lo, hi) => (shape[curve] || shape.lin)[1](v, lo, hi);

// ---------- gates (subset of HOOKS_SYNTAX 4.3 needed here) ----------
export function gateOpen(gate, cycle, ctx = {}) {
  if (gate == null || gate === '*') return true;
  const pt = (p) => (typeof p === 'string' && ctx.markers && p in ctx.markers) ? pt(ctx.markers[p]) : parseLength(p, ctx.time || {});
  if (typeof gate === 'string') { const m = /^(?:(.*?)\.\.(.*)|<(.*)|@(.*))$/.exec(gate); if (!m) return true;
    return m[4] ? cycle >= pt(m[4]) : m[3] ? cycle < pt(m[3]) : cycle >= pt(m[1]) && cycle < pt(m[2]); }
  let c = cycle;
  if (gate.period) { const P = parseLength(gate.period, ctx.time || {}); const w0 = gate.windows ? pt(gate.windows[0][0]) : 0; if (c >= w0) c = w0 + ((c - w0) % P); }
  let open = true;
  if (gate.windows) open = gate.windows.some(([a, b]) => c >= pt(a) && c < pt(b));
  else { if (gate.from != null) open = open && c >= pt(gate.from); if (gate.until != null) open = open && c < pt(gate.until); }
  if (open && gate.when != null) { const w = gate.when; open = !!(w && typeof w === 'object' && w.control ? ctx.valueAt?.(w.control, cycle, { quant: gate.quant ?? 1 }) : w); }
  return open;
}

// ---------- lanes ----------
export function sampleLane(lane, cycle) {
  const pts = lane.points.map(([t, v, s]) => [fromFrac(t), v, s || 'lin']); if (!pts.length) return undefined;
  const len = lane.length ? parseLength(lane.length) : fromFrac(pts[pts.length - 1][0]);
  const P = lane.period != null ? parseLength(lane.period) : null;
  let t = cycle; if (P) t = ((cycle % P) + P) % P;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length; i++) {
    const [t0, v0, s] = pts[i], nx = pts[i + 1];
    if (!nx) return v0;
    if (t >= t0 && t < nx[0]) { if (s === 'hold' || lane.mode === 'steps') return v0; const u = (t - t0) / (nx[0] - t0);
      return s === 'exp' && v0 > 0 && nx[1] > 0 ? v0 * Math.pow(nx[1] / v0, u) : v0 + (nx[1] - v0) * u; }
  }
  return pts[pts.length - 1][1];
}
// Ramer-Douglas-Peucker on [t, v] pairs, vertical error vs the chord.
export function rdp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]]; let worst = -1, wi = 0;
  for (let i = 1; i < pts.length - 1; i++) { const u = (pts[i][0] - a[0]) / (b[0] - a[0] || 1), e = Math.abs(pts[i][1] - (a[1] + (b[1] - a[1]) * u)); if (e > worst) { worst = e; wi = i; } }
  if (worst <= tol) return [a, b];
  return [...rdp(pts.slice(0, wi + 1), tol).slice(0, -1), ...rdp(pts.slice(wi), tol)];
}
export function recordLane({ moves, range, mode = 'curve', length, period, control, grid = 16, priority, gate }) {
  const [lo, hi] = range; let pts;
  if (mode === 'steps') { // sample the raw moves on a per-bar grid and hold
    const n = Math.round(length * grid), at = (t) => { let v = moves[0][1]; for (const [mt, mv] of moves) { if (mt <= t + 1e-9) v = mv; else break; } return v; };
    pts = Array.from({ length: n }, (_, i) => [i / grid, at(i / grid), 'hold']);
    pts = pts.filter((p, i) => i === 0 || p[1] !== pts[i - 1][1]);
  } else pts = rdp(moves.map(([t, v]) => [t, v]), 0.005 * (hi - lo)).map(([t, v]) => [t, v, 'lin']);
  return { control, length: toFrac(length), period: toFrac(period ?? length), mode, ...(priority != null ? { priority } : {}), ...(gate ? { gate } : {}), points: pts.map(([t, v, s]) => [toFrac(t), v, s]) };
}
export function rescaleLane(lane, from, to) {
  if (lane.absolute) return { ...lane };
  const k = (v) => to.min + (v - from.min) / (from.max - from.min) * (to.max - to.min);
  return { ...lane, points: lane.points.map(([t, v, s]) => [t, k(v), s]) };
}
export function bounceLane(lane, { grid = 16 } = {}) {
  const L = parseLength(lane.length ?? lane.points.at(-1)[0]), P = lane.period ?? lane.length;
  if (lane.mode === 'steps') {
    const cycles = Math.max(1, Math.ceil(L)), cells = [];
    for (let c = 0; c < cycles; c++) cells.push('[' + Array.from({ length: grid }, (_, i) => sampleLane(lane, c + i / grid)).join(' ') + ']');
    return { $mini: `<${cells.join(' ')}>`, period: P };
  }
  return { $curve: lane.points.map(p => p.slice()), period: P };
}
// Bounce a lane to Strudel program text: a continuous `signal` (curve lanes, same arithmetic as sampleLane) or a mini-notation cat (steps lanes).
export function laneCode(lane, name) {
  const n = (t) => { const f = toFrac(t); return f.includes('/') ? `(${f})` : f; };
  const P = lane.period != null ? parseLength(lane.period) : null;
  if (lane.mode === 'steps') { const b = bounceLane(lane); return `const ${name} = mini('${b.$mini}')\n`; }
  const pts = lane.points.map(([t, v, s]) => `[${n(t)}, ${v}, '${s || 'lin'}']`).join(', ');
  return `const ${name} = signal((t) => { const pts = [${pts}]; const P = ${P}; let c = +t; if (P) c = ((c % P) + P) % P; if (c <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length; i++) { const t0 = pts[i][0], v0 = pts[i][1], s = pts[i][2], nx = pts[i + 1]; if (!nx) return v0;
    if (c >= t0 && c < nx[0]) { if (s === 'hold') return v0; const u = (c - t0) / (nx[0] - t0); return s === 'exp' && v0 > 0 && nx[1] > 0 ? v0 * Math.pow(nx[1] / v0, u) : v0 + (nx[1] - v0) * u; } }
  return pts[pts.length - 1][1]; })\n`;
}
export function evalBounced(b, cycle, grid = 16) {
  if (b.$curve) return sampleLane({ points: b.$curve, period: b.period, length: b.period }, cycle);
  const cells = [...b.$mini.slice(1, -1).matchAll(/\[([^\]]*)\]/g)].map(m => m[1].split(' ').map(Number));
  const c = Math.floor(cycle) % cells.length, i = Math.floor((cycle - Math.floor(cycle)) * cells[c].length + 1e-9);
  return cells[c][i];
}

// ---------- registry ----------
export function createRegistry(initial = []) {
  const types = new Map(), renderers = new Map();
  const api = {
    registerType(t) { if (!t || !t.id) throw err('E_BAD_ARG', 'type needs id'); types.set(t.id, { drawn: false, render: {}, keys: [], ...t }); return () => types.delete(t.id); },
    registerRenderer(id, fn) { renderers.set(id, fn); const t = types.get(id); if (t) t.drawn = true; return () => { renderers.delete(id); }; },
    types: () => [...types.values()],
    type: (id) => types.get(id),
    renderer: (id) => renderers.get(id),
    // chain of types from id to the first drawn type; unknown ids live as `number`
    fallbackChain(id) { const chain = []; let t = types.get(id) ?? types.get('number'); const seen = new Set();
      while (t && !seen.has(t.id)) { chain.push(t.id); seen.add(t.id); if (t.drawn) return chain; t = types.get(t.render?.fallback); }
      return chain; },
    checkSpec(spec, { strict = false } = {}) { if (!types.has(spec.type) && strict) throw err('E_CONTROL_TYPE', `unknown control type "${spec.type}"`); return true; },
  };
  initial.forEach(api.registerType);
  return api;
}
export async function loadBuiltinTypes(registry, fetcher) {
  const j = fetcher ? await (await fetcher(BUILTIN_URL)).json() : JSON.parse((await import('node:fs')).readFileSync(BUILTIN_URL, 'utf8'));
  j.types.forEach(registry.registerType); return registry;
}

// ---------- engine ----------
const kindOf = (spec) => ({ toggle: 'bool', button: 'bool', xy: 'vec2', steps: 'steps', select: 'enum' })[spec.type] || 'number';
const eqSpec = (a, b) => canonical(a) === canonical(b);

export function createControls({ registry = createRegistry(), model = {}, time = {}, strict = false, markers = {} } = {}) {
  const specs = new Map(), hist = new Map(), maps = [], lanes = new Map(), dests = new Map(), picked = new Map(), boards = [];
  let anon = 0;
  const ctx = { time, markers, valueAt: (n, c, o) => api.valueAt(n, c, o) };
  const baseSpec = (s) => { const k = kindOf(s); const n = { ...s };
    if (k === 'number' && n.min == null && n.max == null && ['slider', 'fader', 'knob', 'encoder', 'ribbon'].includes(n.type)) { n.min = 0; n.max = 1; }
    return n; };
  const range = (s) => [s.min ?? 0, s.max ?? 1];
  const checkVal = (name, s, v) => { if (kindOf(s) !== 'number' || typeof v !== 'number') return;
    const [lo, hi] = range(s); if (v < lo - 1e-9 || v > hi + 1e-9) throw err('E_BAD_ARG', `${name}=${v} outside ${lo}..${hi}`); };
  const initialValue = (s) => s.value ?? s.default ?? (kindOf(s) === 'bool' ? 0 : kindOf(s) === 'vec2' ? { x: s.axes?.x?.default ?? 0, y: s.axes?.y?.default ?? 0 } : kindOf(s) === 'steps' ? 'x ~ ~ ~' : kindOf(s) === 'enum' ? s.options?.[0] : (s.min ?? 0));

  function declare(name, spec) {
    if (spec == null) { if (!specs.has(name)) throw err('E_CONTROL_UNKNOWN', name); return specs.get(name); }
    const s = baseSpec(spec); registry.checkSpec(s, { strict });
    if (specs.has(name)) { const { value, ...old } = specs.get(name), { value: _v, ...nw } = s; if (!eqSpec(old, nw)) throw err('E_CONTROL_CONFLICT', `control "${name}" declared with a different spec`); return specs.get(name); }
    const v = initialValue(s); checkVal(name, s, v);
    if (s.min != null && s.max != null && s.min > s.max) throw err('E_BAD_ARG', 'min > max');
    specs.set(name, s); hist.set(name, [{ cycle: -Infinity, value: v }]); return s;
  }
  const manual = (name, cycle = Infinity) => { const h = hist.get(name); let v = h[0].value; for (const e of h) if (e.cycle <= cycle) v = e.value; return v; };
  // value of a control at a cycle: open lane (highest priority), else manual value. opts.quant: gate semantics (state as of last boundary)
  function valueAt(name, cycle = 0, { quant } = {}) {
    const c = quant ? Math.floor(cycle / quant) * quant : cycle;
    let best = null;
    for (const l of lanes.values()) if (l.control === name && gateOpen(l.gate, c, ctx) && (!best || (l.priority ?? 0) >= (best.priority ?? 0))) best = l;
    return best ? sampleLane(best, c) : manual(name, c);
  }
  function axis(name, ax) { const [n, a] = name.split(':'); return a || ax; }

  // pattern-like reference: query(begin, end) -> haps (value steady, or steps onsets); valueAt(cycle)
  function ctl(name, spec) {
    const s = declare(name, spec); const k = kindOf(s);
    const ref = { kind: 'control', name, type: s.type, valueAt: (c = 0) => valueAt(name, c) };
    if (k === 'vec2') { ref.x = { kind: 'control', name: name + ':x', valueAt: (c = 0) => valueAt(name, c).x }; ref.y = { kind: 'control', name: name + ':y', valueAt: (c = 0) => valueAt(name, c).y }; }
    ref.query = (b, e) => {
      if (k === 'steps') { const steps = String(valueAt(name, b)).trim().split(/\s+/), per = s.per != null ? parseLength(s.per) : 1, n = s.count ?? steps.length, out = [];
        for (let cyc = Math.floor(b / per) * per; cyc < e; cyc += per) steps.forEach((x, i) => { if (x === '~' || x === '0' || x === 'false') return; const t0 = cyc + i / n * per; if (t0 >= b && t0 < e) out.push({ begin: t0, end: t0 + per / n, value: x === 'x' ? 1 : Number(x) }); });
        return out; }
      return [{ begin: b, end: e, value: valueAt(name, b) }];
    };
    return ref;
  }
  // Strudel's own slider(): transpiler emits sliderWithID(id, value, min, max); host defines it. Anonymous control, not mappable.
  function sliderWithID(id, value, min = 0, max = 1) {
    const name = '@' + id; if (!specs.has(name)) { specs.set(name, { type: 'slider', min, max, default: value, anonymous: true }); hist.set(name, [{ cycle: -Infinity, value }]); }
    const r = ctl(name); const f = (b, e) => r.query(b, e); f.id = id; f.controlName = name; f.valueAt = r.valueAt; return f;
  }
  function set(name, value, cycle = -Infinity) {
    const s = declare(name); const k = kindOf(s); if (k === 'bool') value = value ? 1 : 0;
    if (k === 'vec2' && typeof value === 'object') { for (const a of ['x', 'y']) { const ax = s.axes?.[a]; if (ax?.min != null && (value[a] < ax.min || value[a] > ax.max)) throw err('E_BAD_ARG', `${name}:${a}`); } }
    checkVal(name, s, value); const h = hist.get(name); h.push({ cycle, value }); h.sort((a, b) => a.cycle - b.cycle); return value;
  }
  const travelOf = (name, v = manual(name)) => { const s = specs.get(name), [lo, hi] = range(s); return Math.min(1, Math.max(0, curveIn(s.curve, v, lo, hi))); };
  const fromTravel = (name, t) => { const s = specs.get(name), [lo, hi] = range(s); let v = curveOut(s.curve, t, lo, hi); if (s.step) v = Math.round(v / s.step) * s.step; return Math.min(hi, Math.max(lo, v)); };
  // input events: absolute 'value' with soft takeover, relative 'delta', nudge
  function input(type, name, value, { control = name } = {}) {
    const s = declare(name); if (type === 'delta') return set(name, fromTravel(name, travelOf(name) + value));
    const mode = model.pads?.settings?.takeover ?? 'pickup', key = control + '>' + name, st = picked.get(key) || { picked: false, prev: null };
    const cur = travelOf(name);
    if (mode === 'pickup' && !st.picked) {
      const crossed = Math.abs(value - cur) < 1e-9 || (st.prev != null && (st.prev - cur) * (value - cur) <= 0);
      st.prev = value; picked.set(key, st); if (!crossed) return manual(name); st.picked = true;
    }
    return set(name, fromTravel(name, value));
  }
  const nudge = (name, d) => set(name, fromTravel(name, travelOf(name) + d));

  // ---------- maps ----------
  function registerDest(dest, { min, max, base }) { dests.set(dest, { min, max, base }); }
  function map(control, dest, opts = {}, gate) { const m = { control, dest, ...(opts.range ? { range: opts.range } : {}), ...(opts.curve ? { curve: opts.curve } : {}), ...(opts.op ? { op: opts.op } : {}), ...(opts.priority != null ? { priority: opts.priority } : {}), ...((gate ?? opts.gate) != null ? { gate: gate ?? opts.gate } : {}) };
    declare(control.split(':')[0]); maps.push(m); return m; }
  function mapOut(m, cycle) {
    const [cn, ax] = m.control.split(':'); const s = specs.get(cn); let v = valueAt(cn, cycle); if (kindOf(s) === 'vec2') v = v[ax || 'x'];
    const sp = kindOf(s) === 'vec2' ? { ...(s.axes?.[ax || 'x'] || {}), curve: s.axes?.[ax || 'x']?.curve } : s; const [lo, hi] = [sp.min ?? 0, sp.max ?? 1];
    const t = kindOf(s) === 'bool' ? v : Math.min(1, Math.max(0, curveIn(sp.curve, v, lo, hi)));
    const d = dests.get(m.dest) || {}; const r = m.range || [d.min ?? 0, d.max ?? 1];
    return curveOut(m.curve, t, r[0], r[1]);
  }
  function resolveDest(dest, cycle, base) {
    const d = dests.get(dest); let v = base ?? d?.base;
    const live = maps.map((m, i) => ({ m, i })).filter(({ m }) => m.dest === dest && gateOpen(m.gate, cycle, ctx));
    const sets = live.filter(({ m }) => (m.op || 'set') === 'set').sort((a, b) => ((a.m.priority ?? 0) - (b.m.priority ?? 0)) || a.i - b.i);
    if (sets.length) v = mapOut(sets.at(-1).m, cycle);
    for (const { m } of live) { if (m.op === 'add') v += mapOut(m, cycle); else if (m.op === 'mul') v *= mapOut(m, cycle); }
    return v;
  }

  // ---------- lanes / model io ----------
  const addLane = (id, lane) => { lanes.set(id, lane); return lane; };
  function load(m) {
    for (const [n, s] of Object.entries(m.controls || {})) { const { value, ...rest } = s; declare(n, rest); if (value !== undefined) hist.get(n)[0].value = value; }
    maps.length = 0; (m.maps || []).forEach(x => maps.push({ ...x })); boards.length = 0; (m.boards || []).forEach(b => boards.push(b));
    lanes.clear(); for (const [id, l] of Object.entries(m.automation || {})) lanes.set(id, l); return api;
  }
  function toModel() {
    const out = {}; const named = [...specs].filter(([n, s]) => !s.anonymous);
    if (named.length) out.controls = Object.fromEntries(named.map(([n, s]) => [n, { ...s, ...(manual(n) !== s.default && manual(n) !== undefined ? { value: manual(n) } : (s.value !== undefined ? { value: s.value } : {})) }]));
    if (maps.length) out.maps = maps.map(m => ({ ...m })); if (boards.length) out.boards = boards.map(b => ({ ...b }));
    if (lanes.size) out.automation = Object.fromEntries(lanes);
    return out;
  }
  function list() {
    return [...specs].filter(([, s]) => !s.anonymous).map(([name, s]) => ({ name, type: s.type, range: kindOf(s) === 'number' ? range(s) : null, value: manual(name),
      maps: maps.filter(m => m.control.split(':')[0] === name).map(m => m.dest), lanes: [...lanes].filter(([, l]) => l.control === name).map(([id]) => id) }));
  }
  function applySet(list) { for (const kv of [].concat(list)) { const [n, v] = kv.split('='); const s = declare(n); set(n, kindOf(s) === 'number' || kindOf(s) === 'bool' ? Number(v) : v); } }
  function completions() {
    const names = [...specs].filter(([, s]) => !s.anonymous).flatMap(([n, s]) => [[n, s], ...(kindOf(s) === 'vec2' ? [[n + ':x', s], [n + ':y', s]] : [])]);
    return [...names.map(([n, s]) => ({ label: n, category: 'control', detail: `${s.type} control`, info: JSON.stringify(range(s)), inside: ['tap("', 'hooks.map("'] })),
      ...registry.types().map(t => ({ label: t.id, category: 'control-type', detail: `control type (${t.value})`, inside: ['type: "'] }))];
  }
  const api = { registry, declare, ctl, sliderWithID, set, get: (n, c) => valueAt(n, c), valueAt, input, nudge, travelOf, map, maps: () => maps, registerDest, resolveDest, addLane, lanes: () => lanes,
    load, toModel, list, applySet, completions, boards: () => boards, gateOpen: (g, c) => gateOpen(g, c, ctx),
    // gate helper: a toggle control as a bind `when`
    when: (name, quant = 1) => ({ control: name, quant }) };
  return api;
}
