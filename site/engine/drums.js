// Computed drum voices (docs/DRAWN_WAVEFORMS.md section 6.1, #182 stage 4). Pure ES module: no DOM, no Node, no imports.
// Each family is a small DSP model driven by a declared parameter set; nothing is sampled or measured from a recording. render(kind, params, seed)
// returns a Float32Array one-shot at SR (peak-normalised, then scaled by `level`). The seed only drives the noise source, so one parameter set
// gives a family of related hits (variants), and the same seed gives the same samples.
//   FAMILIES[kind]  = { name: [default, min, max], ... }       the declared parameters and ranges (validate() checks a model against it)
//   fill(kind, params)  -> every declared parameter, defaults filled in
//   render(kind, params, seed) -> Float32Array

export const SR = 44100;
export const FAMILIES = {
  kick: { start_hz: [180, 100, 400], end_hz: [48, 35, 70], sweep_s: [0.08, 0.02, 0.25], body_decay_s: [0.35, 0.12, 0.9], click: [0.25, 0, 0.6], drive: [0.2, 0, 0.8], level: [0.9, 0.5, 1] },
  snare: { tone_hz: [190, 150, 260], tone_decay_s: [0.12, 0.05, 0.3], noise_decay_s: [0.2, 0.08, 0.45], noise_hp_hz: [1500, 800, 4000], snap: [0.5, 0, 1], level: [0.9, 0.5, 1] },
  'hat-closed': { tone_hz: [330, 250, 450], metal: [0.7, 0, 1], hp_hz: [7000, 5000, 10000], decay_s: [0.05, 0.02, 0.1], level: [0.8, 0.5, 1] },
  'hat-open': { tone_hz: [330, 250, 450], metal: [0.7, 0, 1], hp_hz: [7000, 5000, 10000], decay_s: [0.35, 0.2, 0.9], level: [0.8, 0.5, 1] },
  clap: { bursts: [4, 2, 6], burst_gap_s: [0.012, 0.006, 0.025], tail_decay_s: [0.18, 0.08, 0.4], bp_hz: [1200, 800, 2500], bp_q: [1.2, 0.5, 3], level: [0.9, 0.5, 1] },
  tom: { start_hz: [140, 70, 300], end_hz: [90, 50, 180], sweep_s: [0.12, 0.04, 0.3], decay_s: [0.4, 0.15, 0.9], click: [0.15, 0, 0.4], level: [0.9, 0.5, 1] },
};

export function fill(kind, params = {}) {
  const f = FAMILIES[kind], out = {}; for (const k of Object.keys(f)) out[k] = params[k] ?? f[k][0]; return out;
}

function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 * 2 - 1; }; }
const env = (t, decay) => Math.exp(-6.9 * t / decay); // 60 dB over `decay` seconds
const twoPi = 2 * Math.PI;
function hp1(x, hz) { const a = Math.exp(-twoPi * hz / SR); let px = 0, py = 0; for (let i = 0; i < x.length; i++) { const y = a * (py + x[i] - px); px = x[i]; py = y; x[i] = y; } return x; }
function bp(x, hz, q) { // RBJ band-pass (constant 0 dB peak)
  const w = twoPi * hz / SR, al = Math.sin(w) / (2 * q), b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y; } return x;
}
function finish(x, level) { // 3 ms fade out, peak to `level` * 0.9
  const n = x.length, fade = Math.min(n, Math.round(0.003 * SR)); for (let i = 0; i < fade; i++) x[n - 1 - i] *= i / fade;
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); const g = pk > 0 ? 0.9 * level / pk : 0; for (let i = 0; i < n; i++) x[i] *= g; return x;
}
function lp1(x, hz) { const a = 1 - Math.exp(-twoPi * hz / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; } return x; }
const len = (s) => Math.ceil(SR * s);

export function render(kind, params, seed = 0) {
  const p = fill(kind, params), r = rng(seed * 7919 + 17);
  if (kind === 'kick' || kind === 'tom') {
    const dec = kind === 'kick' ? p.body_decay_s : p.decay_s, x = new Float32Array(len(dec * 1.25 + 0.03)), tau = p.sweep_s / 3, ck = lp1(Float32Array.from({ length: x.length }, () => r()), 3500); let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR, f = p.end_hz + (p.start_hz - p.end_hz) * Math.exp(-t / tau); ph += twoPi * f / SR;
      let v = Math.sin(ph) * env(t, dec) + p.click * 2.5 * ck[i] * Math.exp(-t / 0.0015);
      if (kind === 'kick') { const g = 1 + p.drive * 6; v = Math.tanh(g * v) / Math.tanh(g); }
      x[i] = v;
    }
    return finish(x, p.level);
  }
  if (kind === 'snare') {
    const d = Math.max(p.tone_decay_s, p.noise_decay_s), x = new Float32Array(len(d * 1.25 + 0.03)), nz = new Float32Array(x.length); let ph = 0;
    for (let i = 0; i < x.length; i++) nz[i] = r() * env(i / SR, p.noise_decay_s);
    hp1(nz, p.noise_hp_hz); lp1(nz, 5000); lp1(nz, 5000);
    for (let i = 0; i < x.length; i++) { const t = i / SR; ph += twoPi * (p.tone_hz * (1 + 0.25 * Math.exp(-t / 0.012))) / SR; x[i] = 0.6 * Math.sin(ph) * env(t, p.tone_decay_s) + (0.4 + 0.6 * p.snap) * nz[i]; }
    return finish(x, p.level);
  }
  if (kind === 'hat-closed' || kind === 'hat-open') {
    const x = new Float32Array(len(p.decay_s * 1.25 + 0.02)), ratios = [2, 3, 4.16, 5.43, 6.79, 8.21], ph = ratios.map(() => r() * Math.PI);
    for (let i = 0; i < x.length; i++) { const t = i / SR; let m = 0; for (let k = 0; k < 6; k++) m += Math.sin(ph[k] + twoPi * ratios[k] * p.tone_hz * t) >= 0 ? 1 : -1; x[i] = (p.metal * m / 6 + (1 - p.metal) * r()) * env(t, p.decay_s); }
    hp1(x, p.hp_hz); hp1(x, p.hp_hz);
    return finish(x, p.level);
  }
  if (kind === 'clap') {
    const nb = Math.round(p.bursts), total = nb * p.burst_gap_s + p.tail_decay_s * 1.25 + 0.02, x = new Float32Array(len(total));
    for (let i = 0; i < x.length; i++) {
      const t = i / SR, k = Math.min(nb, Math.floor(t / p.burst_gap_s)); let e;
      if (k < nb) e = Math.exp(-(t - k * p.burst_gap_s) / 0.004); else e = 0.8 * env(t - nb * p.burst_gap_s, p.tail_decay_s);
      x[i] = r() * e;
    }
    bp(x, p.bp_hz, p.bp_q); bp(x, p.bp_hz, p.bp_q);
    return finish(x, p.level);
  }
  throw new Error('unknown drum family ' + kind);
}
