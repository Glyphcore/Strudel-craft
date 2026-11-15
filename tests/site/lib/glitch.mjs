/* Glitch metric for a captured take against a reference render of the same program and window (docs/AUDIO_ENGINE.md).
   Works on mono Float32 PCM at any sample rate; features live on a 5 ms grid, so two renders at different rates compare.
   - envelope: RMS per 5 ms hop (dB), and its high-passed twin (first difference) for onsets
   - onsets: rise of the high-passed envelope > 6 dB over 10 ms above a floor, 40 ms refractory
   - align: lag (in hops, +-0.6 s) that maximises the correlation of the two envelopes
   - onset match: each reference onset to the nearest candidate onset within 25 ms; deviation stats, drift (least-squares slope of the deviations, ms per s)
   - dropouts: runs of >= 2 hops (10 ms) where the reference is above -40 dBFS and the candidate is >= 18 dB below it
   - clicks: hops whose peak second difference exceeds 2x the reference's 99.9th-percentile hop value and 3x the reference at the same hop
   No dependencies: node or browser. */
export const HOP_S = 0.005;
export function mono(L, R) { const n = L.length, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = R ? 0.5 * (L[i] + R[i]) : L[i]; return m; }
export function features(x, sr) {
  const hop = Math.round(sr * HOP_S), n = Math.floor(x.length / hop), env = new Float32Array(n), hpe = new Float32Array(n), d2 = new Float32Array(n);
  for (let k = 0; k < n; k++) { let e = 0, h = 0, c = 0; const a = k * hop;
    for (let i = a; i < a + hop; i++) { const v = x[i]; e += v * v; if (i > 0) { const d = v - x[i - 1]; h += d * d; } if (i > 1) { const s = Math.abs(v - 2 * x[i - 1] + x[i - 2]); if (s > c) c = s; } }
    env[k] = 10 * Math.log10(e / hop + 1e-12); hpe[k] = 10 * Math.log10(h / hop + 1e-12); d2[k] = c; }
  return { hop, n, env, hpe, d2, sr };
}
export function onsets(F, floorDb = -45) {
  const out = []; let last = -1e9;
  for (let k = 2; k < F.n; k++) { const rise = F.hpe[k] - Math.min(F.hpe[k - 1], F.hpe[k - 2]); if (F.hpe[k] > floorDb && rise > 6 && (k - last) * HOP_S > 0.04) { out.push(k * HOP_S); last = k; } }
  return out;
}
export function align(A, B, maxLagS = 0.6) {
  const M = Math.round(maxLagS / HOP_S), n = Math.min(A.n, B.n); let best = 0, bv = -Infinity;
  const a = A.env, b = B.env; const ma = mean(a, n), mb = mean(b, n);
  for (let lag = -M; lag <= M; lag++) { let s = 0, c = 0; for (let k = Math.max(0, -lag); k < n && k + lag < B.n; k++) { s += (a[k] - ma) * (b[k + lag] - mb); c++; } const v = c ? s / c : -Infinity; if (v > bv) { bv = v; best = lag; } }
  return best;
}
const mean = (x, n) => { let s = 0; for (let i = 0; i < n; i++) s += x[i]; return s / n; };
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
/* ref, cand: { x: Float32Array mono, sr } over the same musical window; returns the metric (numbers only) */
export function compare(ref, cand, o = {}) {
  const A = features(ref.x, ref.sr), B = features(cand.x, cand.sr), lag = o.lag != null ? o.lag : align(A, B);
  const oa = onsets(A), ob = onsets(B).map((t) => t - lag * HOP_S);
  const dev = [], tt = []; let missing = 0;
  for (const t of oa) { let bj = null, bd = Infinity; for (const u of ob) { const d = Math.abs(u - t); if (d < bd) { bd = d; bj = u; } if (u > t + 0.05) break; } if (bj != null && bd <= 0.025) { dev.push((bj - t) * 1000); tt.push(t); } else missing++; }
  let slope = 0; if (dev.length > 2) { const mt = tt.reduce((s, v) => s + v, 0) / tt.length, md = dev.reduce((s, v) => s + v, 0) / dev.length; let nu = 0, de = 0; for (let i = 0; i < dev.length; i++) { nu += (tt[i] - mt) * (dev[i] - md); de += (tt[i] - mt) ** 2; } slope = de ? nu / de : 0; }
  const ad = dev.map(Math.abs);
  let drop = 0, dropHops = 0, run = 0, clicks = 0, within3 = 0, audible = 0; const thr = pct(Array.from(A.d2), 0.999) * 2;
  for (let k = 0; k < A.n; k++) { const j = k + lag; if (j < 0 || j >= B.n) continue;
    const loud = A.env[k] > -40; if (loud) { audible++; if (Math.abs(A.env[k] - B.env[j]) <= 3) within3++; }
    if (loud && B.env[j] <= A.env[k] - 18) { run++; dropHops++; } else { if (run >= 2) drop++; run = 0; }
    if (B.d2[j] > thr && B.d2[j] > 3 * A.d2[k]) clicks++; }
  if (run >= 2) drop++;
  return { lagMs: +(lag * HOP_S * 1000).toFixed(1), refOnsets: oa.length, candOnsets: ob.length, matched: dev.length, missingOnsets: missing,
    onsetDevMedMs: +((pct(ad, 0.5) ?? 0)).toFixed(2), onsetDevP95Ms: +((pct(ad, 0.95) ?? 0)).toFixed(2), onsetDevMaxMs: ad.length ? +Math.max(...ad).toFixed(2) : 0,
    driftMsPerS: +slope.toFixed(3), dropouts: drop, dropoutMs: dropHops * HOP_S * 1000, clicks, levelWithin3dB: audible ? +(within3 / audible).toFixed(4) : null, seconds: +(A.n * HOP_S).toFixed(2) };
}
/* minimal WAV reader (PCM 16/24/32, float32), returns { L, R, sr } */
export function readWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let p = 12, fmt = null, data = null;
  while (p + 8 <= dv.byteLength) { const id = String.fromCharCode(...buf.subarray(p, p + 4)), sz = dv.getUint32(p + 4, true); if (id === 'fmt ') fmt = { tag: dv.getUint16(p + 8, true), ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) }; if (id === 'data') data = { off: p + 8, sz: Math.min(sz, dv.byteLength - p - 8) }; p += 8 + sz + (sz & 1); }
  if (!fmt || !data) throw new Error('not a WAV');
  const bps = fmt.bits / 8, n = Math.floor(data.sz / (bps * fmt.ch)), L = new Float32Array(n), R = new Float32Array(n);
  const tag = fmt.tag === 0xfffe ? (fmt.bits === 32 ? 3 : 1) : fmt.tag;
  const rd = (o) => tag === 3 ? dv.getFloat32(o, true) : bps === 2 ? dv.getInt16(o, true) / 32768 : bps === 3 ? ((dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16)) / 8388608) : dv.getInt32(o, true) / 2147483648;
  for (let i = 0; i < n; i++) { const o = data.off + i * bps * fmt.ch; L[i] = rd(o); R[i] = fmt.ch > 1 ? rd(o + bps) : L[i]; }
  return { L, R, sr: fmt.sr };
}
