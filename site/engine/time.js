// Shared time helpers: cycles are JS numbers in memory, "n/d" strings in the model (BLUEPRINT 5).
export const GRID = 96; // 'none' quantise rounds to 1/96 cycle (BLUEPRINT 9.3)

export function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }
export function toFrac(x, maxDen = 9600) {
  if (typeof x === 'string') return x;
  if (Number.isInteger(x)) return String(x);
  const sign = x < 0 ? -1 : 1; let v = Math.abs(x), h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = v;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b); const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(v - h1 / k1) < 1e-12) break;
    b = 1 / (b - a);
  }
  const g = gcd(h1, k1);
  return `${sign * h1 / g}/${k1 / g}`;
}
export function fromFrac(s) {
  if (typeof s === 'number') return s;
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s));
  if (!m) throw new Error('bad fraction: ' + s);
  return Number(m[1]) / Number(m[2] || 1);
}
// Point-style length/point: number (cycles), "n/d", "2c" cycles, "1b" bars, "0.5s" seconds (needs cps).
export function parseLength(v, { cpb = 1, cps } = {}) {
  if (typeof v === 'number') return v;
  const m = /^(-?[\d.]+(?:\/\d+)?)([bcs]?)$/.exec(String(v).trim());
  if (!m) throw new Error('bad length: ' + v);
  const n = m[1].includes('/') ? fromFrac(m[1]) : Number(m[1]);
  if (m[2] === 'b') return n * cpb;
  if (m[2] === 's') { if (!cps) throw new Error('E_NO_CPS'); return n * cps; }
  return n;
}
// Next boundary at or after cycle c. quant: none|beat|bar|cycle|n cycles.
export function quantise(c, quant = 'bar', { bpb = 4, cpb = 1 } = {}) {
  const eps = 1e-9;
  const up = (x, u) => Math.ceil(x / u - eps) * u;
  if (quant === 'none') return Math.round(c * GRID) / GRID;
  if (quant === 'beat') return up(c, cpb / bpb);
  if (quant === 'bar') return up(c, cpb);
  if (quant === 'cycle') return up(c, 1);
  const n = typeof quant === 'number' ? quant : parseLength(quant, { cpb });
  if (n <= 0) return Math.round(c * GRID) / GRID;
  return up(c, n);
}
// Provider time (ms) -> cycle once, with a clock {nowMs, nowCycle} and cps.
export function msToCycle(ms, { clock, cps, latencyMs = 0 }) {
  return clock.cycle + ((ms - latencyMs) - clock.ms) / 1000 * cps;
}
export function canonical(v) {
  const walk = (x) => Array.isArray(x) ? x.map(walk)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, walk(x[k])])) : x;
  return JSON.stringify(walk(v), null, 1);
}
