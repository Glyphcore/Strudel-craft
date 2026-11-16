/* Glitch metric for a captured take against a reference render of the same program and window (docs/AUDIO_ENGINE.md).
   Works on mono Float32 PCM at any sample rate; features live on a 5 ms grid, so two renders at different rates compare.
   - envelope: RMS per 5 ms hop (dB), and its high-passed twin (first difference) for onsets
   - onsets: rise of the high-passed envelope > 6 dB over 10 ms above a floor, 40 ms refractory
   - align: lag (in hops, +-0.15 s) that maximises the correlation of the two envelopes
   - onset match: each reference onset to the nearest candidate onset within 25 ms; deviation stats, drift (least-squares slope of the deviations, ms per s)
   - soft onset match (matchedSoft): a reference onset the strict detector missed in the candidate still counts when the candidate's own high-passed envelope rises by >= 3 dB (half the
     detection threshold) within +-25 ms. Two engines (Chrome vs node-web-audio-api) put some rises within 0.3 dB of the 6 dB threshold on either side (docs/AUDIO_ENGINE.md 5);
     a real dropout stays flat there, so it is not matched (record_offline.mjs has the negative control).
   - dropouts: runs of >= 2 hops (10 ms) where the reference is above -40 dBFS and the candidate is >= 18 dB below it (after the median level offset)
   - level: share of loud hops within 3 dB, raw and after removing the median offset (levelOffsetDb: master gain, gain staging)
   - clicks: hops whose peak second difference exceeds 2x the reference's 99.9th-percentile hop value and 3x the reference at the same hop
   No dependencies: node or browser. */
export const HOP_S = 0.005;
export function mono(L, R) { const n = L.length, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = R ? 0.5 * (L[i] + R[i]) : L[i]; return m; }
/* 4th-order Butterworth high-pass (two RBJ biquads): compare above the sub band, where Chrome and the CLI engine measurably differ (docs/AUDIO_ENGINE.md 5) */
export function highpass(x, sr, fc) { let y = Float32Array.from(x); for (const q of [0.5412, 1.3066]) { const w = 2 * Math.PI * fc / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const o = new Float32Array(y.length);
    for (let i = 0; i < y.length; i++) { const v = y[i], r = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = r; o[i] = r; } y = o; } return y; }
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
export function align(A, B, maxLagS = 0.15) { /* a take cut more than 150 ms off its window is itself an error: it shows as unmatched onsets, not as a lag */
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
  let soft = dev.length; { const hp = B.hpe; const matchedT = new Set(tt); for (const t of oa) { if (matchedT.has(t)) continue; const j0 = Math.round(t / HOP_S) + lag; let best = 0;
    for (let j = j0 - 5; j <= j0 + 5; j++) if (j >= 2 && j < B.n && hp[j] > -45) best = Math.max(best, hp[j] - Math.min(hp[j - 1], hp[j - 2])); if (best >= 3) soft++; } }
  let drop = 0, dropHops = 0, run = 0, clicks = 0, within3 = 0, audible = 0, within3o = 0; const thr = pct(Array.from(A.d2), 0.999) * 2;
  /* constant level offset (master gain, bus gain staging): the median of the per-hop differences over loud hops */
  const diffs = []; for (let k = 0; k < A.n; k++) { const j = k + lag; if (j >= 0 && j < B.n && A.env[k] > -40) diffs.push(B.env[j] - A.env[k]); } const off = pct(diffs, 0.5) ?? 0;
  /* level on 50 ms blocks (10 hops, mean energy): what is heard as loudness; a 5 ms hop at a transient moves several dB with a one-hop timing difference between two engines */
  let b50 = 0, b50ok = 0; for (let k = 0; k + 10 <= A.n; k += 10) { let ea = 0, eb = 0, okb = true; for (let i = 0; i < 10; i++) { const j = k + i + lag; if (j < 0 || j >= B.n) { okb = false; break; } ea += Math.pow(10, A.env[k + i] / 10); eb += Math.pow(10, B.env[j] / 10); }
    if (!okb) continue; const da = 10 * Math.log10(ea / 10 + 1e-12), db = 10 * Math.log10(eb / 10 + 1e-12); if (da > -40) { b50++; if (Math.abs(da - db) <= 3) b50ok++; } }
  for (let k = 0; k < A.n; k++) { const j = k + lag; if (j < 0 || j >= B.n) continue;
    const loud = A.env[k] > -40; if (loud) { audible++; if (Math.abs(A.env[k] - B.env[j]) <= 3) within3++; if (Math.abs(A.env[k] + off - B.env[j]) <= 3) within3o++; }
    if (loud && B.env[j] <= A.env[k] + off - 18) { run++; dropHops++; } else { if (run >= 2) drop++; run = 0; }
    if (B.d2[j] > thr && B.d2[j] > 3 * A.d2[k]) clicks++; }
  if (run >= 2) drop++;
  return { lagMs: +(lag * HOP_S * 1000).toFixed(1), refOnsets: oa.length, candOnsets: ob.length, matched: dev.length, matchedSoft: soft, missingOnsets: missing,
    onsetDevMedMs: +((pct(ad, 0.5) ?? 0)).toFixed(2), onsetDevP95Ms: +((pct(ad, 0.95) ?? 0)).toFixed(2), onsetDevMaxMs: ad.length ? +Math.max(...ad).toFixed(2) : 0,
    driftMsPerS: +slope.toFixed(3), dropouts: drop, dropoutMs: dropHops * HOP_S * 1000, clicks, levelWithin3dB50ms: b50 ? +(b50ok / b50).toFixed(4) : null, levelWithin3dB: audible ? +(within3 / audible).toFixed(4) : null, levelOffsetDb: +off.toFixed(2), levelWithin3dBAligned: audible ? +(within3o / audible).toFixed(4) : null, seconds: +(A.n * HOP_S).toFixed(2) };
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
