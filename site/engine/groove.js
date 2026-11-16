// Groove (docs/CONVENTIONS.md section 4, docs/HOOKS_SYNTAX.md 4.2c): slightly off-grid, organic timing and velocity as one pattern method,
// pat.groove(swing, push, jitter, vel, drift, seed, grid) or pat.groove({ swing, push, ... }), plus the standard-library groove presets
// (chain-only hook defs, like the hygiene racks). Deterministic: every offset is a function of (seed, the hap's exact onset), never of the
// query span, the clock or Math.random, so a chunked offline render, a live query and a re-render give the same haps. Units are tempo-free:
// a step is 1/grid of a cycle (grid 16 = a 16th in 4/4 at one cycle per bar); push, jitter and drift are in percent of a 16th (1/16 cycle).
// Signal order per hap: swing (a monotone piecewise-linear time map inside each pair of steps, MPC-style percentage) -> push (constant)
// -> jitter (triangular, bounded) -> drift (smooth value noise over 4 cycles); velocity is scaled down only (peaks never grow).
// Strudel is not modified: the method is added to Pattern.prototype by install() in hooks.js after a collision check. Data + one method.
export const GROOVE_PARAMS = Object.freeze([
  { name: 'swing', min: 50, max: 75, default: 50, unit: '%', doc: 'MPC swing: where the 2nd step of each pair sits, in % of the pair (50 straight, 66.7 triplet, 75 dotted)' },
  { name: 'push', min: -50, max: 50, default: 0, unit: '% of a 16th', doc: 'constant offset: + drags (late), - rushes (early)' },
  { name: 'jitter', min: 0, max: 25, default: 0, unit: '% of a 16th', doc: 'per-hit timing spread, triangular, never beyond +-jitter' },
  { name: 'vel', min: 0, max: 0.5, default: 0, unit: '', doc: 'per-hit velocity spread: velocity x (1 - vel * u), u in [0, 1)' },
  { name: 'drift', min: 0, max: 20, default: 0, unit: '% of a 16th', doc: 'slow timing wander, smooth over 4 cycles' },
  { name: 'seed', min: 0, max: 65535, default: 0, unit: '', doc: 'random stream; give each voice its own so they do not move together' },
  { name: 'grid', min: 2, max: 64, default: 16, unit: 'steps / cycle', doc: 'swing grid: 16 swings 16ths, 8 swings 8ths' },
]);
const NAMES = GROOVE_PARAMS.map((p) => p.name); const DEF = Object.fromEntries(GROOVE_PARAMS.map((p) => [p.name, p.default]));
const TICKS = 15360; // offsets are rounded to 1/15360 cycle (960 per 16th), so hap times stay exact fractions
const DRIFT_PERIOD = 4;

// 32-bit hash of (seed, exact onset n/d, lane) -> [0, 1)
const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
export function rnd(seed, n, d, lane = 0) {
  let h = mix((seed | 0) ^ 0x9e3779b9); h = mix(h ^ (n | 0)); h = mix(h ^ Math.imul(d | 0, 0x27d4eb2d)); h = mix(h ^ Math.imul(lane + 1, 0x165667b1));
  return h / 4294967296;
}
export function normalise(args) {
  const o = args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && typeof args[0].query !== 'function' ? args[0] : Object.fromEntries(args.map((v, i) => [NAMES[i], v]).filter(([, v]) => v !== undefined));
  const out = { ...DEF };
  for (const [k, v] of Object.entries(o)) {
    const p = GROOVE_PARAMS.find((q) => q.name === k); if (!p) throw Object.assign(new Error(`E_BAD_ARG: groove has no param "${k}" (${NAMES.join(', ')})`), { code: 'E_BAD_ARG' });
    if (typeof v !== 'number' || !Number.isFinite(v)) throw Object.assign(new Error(`E_BAD_ARG: groove ${k} must be a number`), { code: 'E_BAD_ARG' });
    out[k] = Math.min(p.max, Math.max(p.min, v));
  }
  out.seed = Math.round(out.seed); out.grid = Math.round(out.grid); return out;
}
// offsets in cycles for one onset (exact fraction t)
export function plan(o, t) {
  const n = Number(t.s) * Number(t.n), d = Number(t.d), tf = t.valueOf(), u16 = 1 / 16 / 100;
  const a = rnd(o.seed, n, d, 1), b = rnd(o.seed, n, d, 2);
  let off = o.push * u16 + (a + b - 1) * o.jitter * u16;
  if (o.drift) { const k = Math.floor(tf / DRIFT_PERIOD), f = tf / DRIFT_PERIOD - k, s = f * f * (3 - 2 * f); const g0 = rnd(o.seed, k, 1, 7) * 2 - 1, g1 = rnd(o.seed, k + 1, 1, 7) * 2 - 1; off += (g0 + (g1 - g0) * s) * o.drift * u16; }
  return { off, velMul: o.vel ? 1 - o.vel * rnd(o.seed, n, d, 3) : 1 };
}
export function swingMap(o, x) { // x in cycles (number) -> warped x; identity when swing is 50
  if (o.swing === 50) return x; const s = 1 / o.grid, a = (2 * o.swing / 100 - 1) * s, k = Math.floor(x / (2 * s)), r = x - 2 * s * k;
  return 2 * s * k + (r < s ? r * (s + a) / s : s + a + (r - s) * (s - a) / s);
}
export const maxShift = (o) => ((2 * o.swing / 100 - 1) / o.grid) + (Math.abs(o.push) + o.jitter + o.drift) / 1600;

export function installGroove(S) {
  const { Pattern, Fraction } = S; const proto = Pattern.prototype;
  if (proto.groove && !proto.groove.__hooks) throw Object.assign(new Error('E_NAME_COLLISION: Pattern.prototype.groove already exists in the loaded Strudel'), { code: 'E_NAME_COLLISION' });
  const q = (x) => Fraction(Math.round(x * TICKS)).div(TICKS);
  const groove = function (...args) {
    const o = normalise(args); const pat = this; if (o.swing === 50 && !o.push && !o.jitter && !o.vel && !o.drift) return pat;
    const pad = Fraction(Math.ceil(maxShift(o) * TICKS) + 1).div(TICKS);
    return new Pattern((state) => {
      const span = state.span; const TS = span.constructor; const wide = new TS(span.begin.sub(pad), span.end.add(pad)); const out = [];
      for (const hap of pat.query(state.setSpan(wide))) {
        if (!hap.whole) { const p = hap.part.intersection(span); if (p) out.push(new hap.constructor(undefined, p, hap.value, hap.context)); continue; }
        const { off, velMul } = plan(o, hap.whole.begin);
        const mapT = (t) => q(swingMap(o, t.valueOf()) + off);
        const whole = new TS(mapT(hap.whole.begin), mapT(hap.whole.end)); const part0 = new TS(mapT(hap.part.begin), mapT(hap.part.end));
        const part = part0.intersection(span); if (!part) continue;
        const v = hap.value; const value = velMul !== 1 && v && typeof v === 'object' && !Array.isArray(v) ? { ...v, velocity: (v.velocity ?? 1) * velMul } : v;
        out.push(new hap.constructor(whole, part, value, hap.context));
      }
      return out;
    });
  };
  groove.__hooks = true; proto.groove = groove;
}

// Standard-library groove presets (chain-only hook defs; a pack or program def of the same name wins). Each takes `seed` as its first
// param so voices of one feel can share a preset and still not move together: "groove-pocket(2)". Values are percent of a 16th.
const g = (vals) => ({ params: { seed: { min: 0, max: 65535, default: 0 } }, chain: [['groove', { ...vals, seed: { $param: 'seed' } }]] });
export const GROOVES = Object.freeze({
  'groove-straight': g({ jitter: 1, vel: 0.04 }),
  'groove-pocket': g({ swing: 57, jitter: 3, vel: 0.12, drift: 1 }),
  'groove-lazy': g({ swing: 55, push: 8, jitter: 4, vel: 0.1, drift: 3 }),
  'groove-bounce': g({ swing: 53, push: -3, jitter: 2, vel: 0.15 }),
  'groove-rolling': g({ jitter: 1.5, vel: 0.18 }),
  'groove-cloud': g({ swing: 56, push: 5, jitter: 5, vel: 0.08, drift: 5 }),
  'groove-swing': { params: { pct: { min: 50, max: 75, default: 58 }, grid: { min: 2, max: 64, default: 16 } }, chain: [['groove', { swing: { $param: 'pct' }, grid: { $param: 'grid' } }]] },
  'groove-push': { params: { pct: { min: -50, max: 50, default: 0 } }, chain: [['groove', { push: { $param: 'pct' } }]] },
  'groove-human': { params: { jitter: { min: 0, max: 25, default: 3 }, vel: { min: 0, max: 0.5, default: 0.1 }, seed: { min: 0, max: 65535, default: 0 } }, chain: [['groove', { jitter: { $param: 'jitter' }, vel: { $param: 'vel' }, seed: { $param: 'seed' } }]] },
});
