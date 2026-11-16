#!/usr/bin/env node
// Sound measurement and genre scoring (docs/RACK_STANDARD.md section 8, issue #125). Plain Node, no dependencies.
//   node tools/racks/measure.mjs FILE.wav [--bpm N] [--beats-per-bar 4] [--kick K.wav --bass B.wav]
//   node tools/racks/measure.mjs --score docs/genres/GENRE.json [--strict] FILE.wav [same options]
// Prints one JSON object of numbers (the measurement), or with --score one line per criterion plus a summary.
// Duck depth: Hilbert envelope of the bass; exact for held ducks, reads an instantaneous-attack exponential-release duck 1 to 2 dB shallow, so --score does not score it.
// Method: integrated loudness and gating per ITU-R BS.1770 (K-weighting, 400 ms blocks, 75 % overlap, -70 LUFS absolute gate, -10 LU relative
// gate); loudness range per EBU Tech 3342 (3 s blocks, -70 absolute, -20 LU relative, 10th to 95th percentile); true peak by 4x oversampling
// (windowed-sinc polyphase, 12 taps per side). Exit: 0 all pass, 1 a miss (a `convention` miss only counts with --strict), 2 usage.
import fs from 'node:fs'; import { fileURLToPath } from 'node:url';

export function readWav(file) { // PCM 16/24/32 or float32/64 RIFF -> { sr, L, R } (mono is duplicated to both channels)
  const b = fs.readFileSync(file); let p = 12, fmt = null, data = null;
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a wav: ' + file);
  while (p + 8 <= b.length) { const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }; if (fmt.tag === 0xfffe) fmt.tag = b.readUInt16LE(p + 32); }
    if (id === 'data') data = b.subarray(p + 8, Math.min(b.length, p + 8 + sz)); p += 8 + sz + (sz & 1); }
  if (!fmt || !data) throw new Error('not a wav: ' + file);
  const bytes = fmt.bits / 8, n = Math.floor(data.length / (bytes * fmt.ch)); const ch = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { const o = (i * fmt.ch + Math.min(c, fmt.ch - 1)) * bytes;
    ch[c][i] = fmt.tag === 3 ? (fmt.bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o)) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 24 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648; }
  return { sr: fmt.sr, L: ch[0], R: ch[1] };
}
export function writeWav(file, sr, L, R) { // float32 stereo
  const n = L.length, b = Buffer.alloc(44 + n * 8); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 8, 28); b.writeUInt16LE(8, 32); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { b.writeFloatLE(L[i], 44 + i * 8); b.writeFloatLE(R[i], 48 + i * 8); } fs.writeFileSync(file, b);
}

// ---------- helpers ----------
const db10 = (x) => (x > 0 ? 10 * Math.log10(x) : -Infinity); const db20 = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const rnd = (x, d = 2) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);
const fin = (x, floor = -200) => (x === -Infinity ? floor : x); // JSON has no -Infinity
function biquad(x, b0, b1, b2, a1, a2) { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; }
function fft(re, im) { const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, c = a + len / 2; const xr = re[c] * cr - im[c] * ci, xi = re[c] * ci + im[c] * cr; re[c] = re[a] - xr; im[c] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }

// ---------- loudness (BS.1770, Tech 3342) ----------
export function kWeight(x, sr) { // stage 1 high-shelf, stage 2 RLB high-pass; coefficients derived for any sample rate (they equal the standard's at 48 kHz)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / sr);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416; let a0 = 1 + K / Q + K * K;
  const y = biquad(x, (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr); a0 = 1 + K / Q + K * K;
  return biquad(y, 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
}
function blockPowers(zL, zR, sr, win, step) { // mean square sum over channels (weights 1.0) per sliding block
  const w = Math.round(win * sr), s = Math.round(step * sr), n = zL.length, cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + zL[i] * zL[i] + zR[i] * zR[i]; const out = [];
  for (let st = 0; st + w <= n; st += s) out.push((cs[st + w] - cs[st]) / w); return out;
}
const lk = (p) => -0.691 + db10(p);
export function loudness(wav) {
  const { sr } = wav, zL = kWeight(wav.L, sr), zR = kWeight(wav.R, sr);
  const gate = (P, rel) => { const a = P.filter((p) => lk(p) > -70); if (!a.length) return []; const m = a.reduce((s, v) => s + v, 0) / a.length; return a.filter((p) => lk(p) > lk(m) + rel); };
  const mb = blockPowers(zL, zR, sr, 0.4, 0.1), g = gate(mb, -10);
  const integrated = g.length ? lk(g.reduce((s, v) => s + v, 0) / g.length) : -Infinity;
  const sb = gate(blockPowers(zL, zR, sr, 3, 0.1), -20).map(lk).sort((a, b) => a - b); let lra = null;
  if (sb.length) { const q = (f) => sb[Math.min(sb.length - 1, Math.floor(f * (sb.length - 1) + 0.5))]; lra = q(0.95) - q(0.1); }
  return { integrated, lra };
}

// ---------- true peak (4x oversampling) ----------
export function truePeak(x) {
  const H = 12, OS = 4, taps = []; for (let ph = 1; ph < OS; ph++) { const t = []; for (let k = -H + 1; k <= H; k++) { const d = k - ph / OS, w = 0.5 + 0.5 * Math.cos(Math.PI * d / (H + 0.5));
    t.push(Math.abs(d) < 1e-12 ? 1 : (Math.sin(Math.PI * d) / (Math.PI * d)) * w); } taps.push(t); }
  let pk = 0; const n = x.length;
  for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a;
    for (let ph = 0; ph < taps.length; ph++) { let s = 0; const t = taps[ph]; for (let k = -H + 1, j = 0; k <= H; k++, j++) { const idx = i + k; if (idx >= 0 && idx < n) s += x[idx] * t[j]; } if (Math.abs(s) > pk) pk = Math.abs(s); } }
  return pk;
}

// ---------- spectrum ----------
const NF = 8192; const HANN = Float64Array.from({ length: NF }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NF));
function ltas(L, R, from = 0, to = L.length) { // mean channel power per bin (Welch, Hann, 50 % overlap)
  const P = new Float64Array(NF / 2 + 1); let frames = 0; const a = new Float64Array(NF), ai = new Float64Array(NF), b = new Float64Array(NF), bi = new Float64Array(NF);
  for (let st = from; frames === 0 || st + NF <= to; st += NF / 2) { for (let i = 0; i < NF; i++) { const k = st + i; a[i] = k < to ? L[k] * HANN[i] : 0; b[i] = k < to ? R[k] * HANN[i] : 0; ai[i] = 0; bi[i] = 0; }
    fft(a, ai); fft(b, bi); for (let k = 0; k <= NF / 2; k++) P[k] += (a[k] * a[k] + ai[k] * ai[k] + b[k] * b[k] + bi[k] * bi[k]) / 2; frames++; if (st + NF > to) break; }
  return P;
}
const bandSum = (P, sr, f0, f1) => { const bin = sr / NF; let s = 0; for (let k = Math.max(1, Math.ceil(f0 / bin)); k <= Math.min(P.length - 1, Math.floor(f1 / bin)); k++) s += P[k]; return s; };
function tilt(P, sr) { // slope in dB per octave of the power spectral density, 1/3-octave bands 100 Hz to 10 kHz (pink noise = -3)
  const bin = sr / NF, xs = [], ys = [];
  for (let c = 100; c <= 10000 * 1.001; c *= 2 ** (1 / 3)) { const f0 = c / 2 ** (1 / 6), f1 = c * 2 ** (1 / 6); let s = 0, cnt = 0;
    for (let k = Math.ceil(f0 / bin); k <= Math.floor(f1 / bin) && k < P.length; k++) { s += P[k]; cnt++; } if (cnt && s > 0) { xs.push(Math.log2(c)); ys.push(db10(s / cnt)); } }
  if (xs.length < 3) return null; const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length; let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; } return num / den;
}
function centroid(P, sr) { const bin = sr / NF; let s = 0, w = 0; for (let k = 1; k < P.length; k++) { s += k * bin * P[k]; w += P[k]; } return w > 0 ? s / w : null; }
function lowMono(wav, hz = 120) { // 4th-order Butterworth low-pass (two biquads), then L/R correlation and side/mid
  const lp = (x, Q) => { const K = Math.tan(Math.PI * hz / wav.sr), a0 = 1 + K / Q + K * K; return biquad(x, K * K / a0, 2 * K * K / a0, K * K / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0); };
  const l = lp(lp(wav.L, 0.5411961), 1.3065630), r = lp(lp(wav.R, 0.5411961), 1.3065630); let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0;
  for (let i = 0; i < l.length; i++) { ll += l[i] * l[i]; rr += r[i] * r[i]; lr += l[i] * r[i]; const m = (l[i] + r[i]) / 2, s = (l[i] - r[i]) / 2; mm += m * m; ss += s * s; }
  return { corr: ll > 1e-18 && rr > 1e-18 ? lr / Math.sqrt(ll * rr) : null, stm: mm > 1e-18 || ss > 1e-18 ? db10(ss / Math.max(mm, 1e-300)) : null };
}

// ---------- onsets and ducking ----------
export function onsets(wav, hop = 512, fr = 1024) { // spectral-flux peak picking on the mono sum; returns onset times in seconds
  const n = wav.L.length, nb = fr / 2 + 1, win = Float64Array.from({ length: fr }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / fr)); const flux = []; let prev = new Float64Array(nb);
  const re = new Float64Array(fr), im = new Float64Array(fr);
  for (let st = 0; st + fr <= n; st += hop) { for (let i = 0; i < fr; i++) { re[i] = (wav.L[st + i] + wav.R[st + i]) / 2 * win[i]; im[i] = 0; } fft(re, im); const cur = new Float64Array(nb); let f = 0;
    for (let k = 1; k < nb; k++) { cur[k] = Math.log1p(800 * Math.hypot(re[k], im[k]) / fr); const d = cur[k] - prev[k]; if (d > 0) f += d; } flux.push(f); prev = cur; }
  const mx = Math.max(0, ...flux), out = [];
  for (let i = 0; i < flux.length; i++) { let ok = flux[i] > 0.1 * mx; for (let j = Math.max(0, i - 4); j <= Math.min(flux.length - 1, i + 4) && ok; j++) if (j !== i && (flux[j] > flux[i] || (flux[j] === flux[i] && j < i))) ok = false; if (ok) out.push((i * hop + fr / 2) / wav.sr); }
  return out;
}
function rmsEnv(x, sr, hopMs, winMs) { const h = Math.max(1, Math.round(sr * hopMs / 1000)), w = Math.round(sr * winMs / 1000), c = new Float64Array(x.length + 1); for (let i = 0; i < x.length; i++) c[i + 1] = c[i] + x[i] * x[i]; const out = []; for (let i = w; i <= x.length; i += h) out.push(Math.sqrt((c[i] - c[i - w]) / w)); return { env: out, dt: h / sr, lag: w / sr }; } // sliding RMS: every point is the level over the last winMs
function hilbertEnv(x) { // magnitude of the analytic signal (FFT, negative frequencies zeroed, positive doubled): the amplitude envelope of a tonal signal with no per-period ripple
  let N = 1; while (N < x.length) N <<= 1; const re = new Float64Array(N), im = new Float64Array(N); re.set(x); fft(re, im);
  for (let k = 1; k < N / 2; k++) { re[k] *= 2; im[k] *= 2; } for (let k = N / 2 + 1; k < N; k++) { re[k] = 0; im[k] = 0; }
  for (let k = 0; k < N; k++) im[k] = -im[k]; fft(re, im); const out = new Float64Array(x.length); for (let i = 0; i < x.length; i++) out[i] = Math.hypot(re[i], im[i]) / N; return out; } // inverse FFT by conjugation (magnitude is unaffected by the final conjugate)
export function duckDepth(kick, bass) { // -> { depth_db, kicks, reason }; depth_db is null (with a reason) when fewer than 4 kick intervals are usable
  const mono = (w) => Float64Array.from(w.L, (v, i) => (v + w.R[i]) / 2), km = mono(kick), bm = mono(bass), ke = rmsEnv(km, kick.sr, 2, 8), kmax = Math.max(...ke.env); if (!(kmax > 0)) return { depth_db: null, kicks: 0, reason: 'kick stem is silent' };
  const hits = []; let last = -1; for (let i = 1; i < ke.env.length; i++) if (ke.env[i] > kmax * 0.2 && ke.env[i - 1] <= kmax * 0.2 && (last < 0 || (i - last) * ke.dt > 0.2)) { hits.push((i + 1) * ke.dt - ke.lag); last = i; } // kick onsets: the kick stem's 8 ms RMS crosses 20 % of its maximum
  if (hits.length < 4) return { depth_db: null, kicks: 0, reason: 'fewer than 4 kicks found in the kick stem' };
  const sr = bass.sr, h = hilbertEnv(bm), w = Math.max(1, Math.round(0.005 * sr)), c = new Float64Array(h.length + 1); for (let i = 0; i < h.length; i++) c[i + 1] = c[i] + h[i]; // c: running sum for the 5 ms smoothing
  const env = (i) => { const a = Math.max(0, i - (w >> 1)), b = Math.min(h.length, a + w); return (c[b] - c[a]) / (b - a); }, gaps = hits.slice(1).map((t, i) => t - hits[i]).sort((a, b) => a - b), med = gaps[gaps.length >> 1];
  let top = 0; for (let i = 0; i < h.length; i += 16) if (h[i] > top) top = h[i]; const floor = top * 1e-3, depths = [];
  for (let k = 0; k < hits.length; k++) { const t0 = hits[k], t1 = k + 1 < hits.length ? hits[k + 1] : t0 + med, i0 = Math.round(t0 * sr), i1 = Math.round(t1 * sr), id = Math.min(i1, i0 + Math.round(0.15 * sr)); if (i1 > h.length || i1 - i0 < 0.05 * sr) continue;
    let dk = Infinity; for (let i = Math.max(0, i0 - Math.round(0.01 * sr)); i < id; i++) dk = Math.min(dk, env(i)); const all = []; for (let i = i0; i < i1; i += 4) all.push(env(i)); all.sort((a, b) => a - b); const up = all[Math.min(all.length - 1, Math.floor(0.9 * all.length))];
    if (!(up > floor) || !(dk > 0)) continue; depths.push(db20(up / dk)); } // bass silent or absent in this interval: skipped
  if (depths.length < 4) return { depth_db: null, kicks: depths.length, reason: 'fewer than 4 usable kick intervals (bass silent or absent in the others)' };
  depths.sort((x, y) => x - y); return { depth_db: depths[depths.length >> 1], kicks: depths.length, reason: null }; }


// ---------- the measurement ----------
export function measure(wav, opt = {}) {
  const { L, R, sr } = wav, n = L.length; let sp = 0, clip = 0, sl = 0, sr_ = 0, sq = 0; const CLIP = 0.999;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > sp) sp = a; if (b > sp) sp = b; if (a >= CLIP) clip++; if (b >= CLIP) clip++; sl += L[i]; sr_ += R[i]; sq += L[i] * L[i] + R[i] * R[i]; }
  const ld = loudness(wav), tp = Math.max(truePeak(L), truePeak(R)), P = ltas(L, R), nyq = sr / 2, total = bandSum(P, sr, 20, nyq) || 1e-30, lm = lowMono(wav);
  const o = { file_seconds: rnd(n / sr, 3), sample_rate: sr, lufs_integrated: rnd(fin(ld.integrated)), lra_lu: rnd(ld.lra), true_peak_dbtp: rnd(fin(db20(tp))), sample_peak_dbfs: rnd(fin(db20(sp))),
    plr_db: rnd(db20(tp) - ld.integrated), crest_db: rnd(db20(sp) - db10(sq / (2 * n))), dc_offset_dbfs: rnd(fin(db20(Math.max(Math.abs(sl / n), Math.abs(sr_ / n))))), clipped_samples: clip,
    low_share_pct: rnd(100 * bandSum(P, sr, 20, 250) / total), spectral_tilt_db_oct: rnd(tilt(P, sr)), spectral_centroid_hz: rnd(centroid(P, sr), 0),
    lr_correlation_below_120: rnd(lm.corr, 3), side_to_mid_db_below_120: lm.stm == null ? null : rnd(fin(lm.stm)) };
  if (opt.bpm) { const bpb = opt.beatsPerBar || 4, barS = bpb * 60 / opt.bpm, bars = n / sr / barS; o.tempo_bpm = opt.bpm; o.bars = rnd(bars, 2); o.onsets_per_bar = rnd(onsets(wav).length / bars, 1);
    const bn = Math.round(barS * sr), span = 8 * bn; if (n >= span + bn) { let best = 0, bs = 0; for (let st = 0; st + span <= n; st += bn) { let e = 0; for (let i = st; i < st + span; i += 8) e += L[i] * L[i] + R[i] * R[i]; if (e > best) { best = e; bs = st; } }
      o.spectral_centroid_densest_8_bars_hz = rnd(centroid(ltas(L, R, bs, bs + span), sr), 0); o.densest_8_bars_start_bar = Math.round(bs / bn); } }
  if (opt.kick && opt.bass) { const d = duckDepth(opt.kick, opt.bass); o.duck_depth_db = rnd(d.depth_db); o.duck_kicks_used = d.kicks; if (d.reason) o.duck_unavailable = d.reason; }
  return o;
}

// ---------- scoring against docs/genres/*.json ----------
export function score(m, genre, strict = false) {
  const rows = []; let fail = false;
  for (const c of genre.criteria) { const v = m[c.metric];
    if (v == null) { rows.push({ id: c.id, status: 'skip', value: null, min: c.min ?? null, max: c.max ?? null, basis: c.basis, why: 'not measured (needs ' + (c.needs || c.metric) + ')' }); continue; }
    if (c.metric === 'duck_depth_db') { rows.push({ id: c.id, status: 'unreliable', value: v, min: c.min ?? null, max: c.max ?? null, basis: c.basis, why: 'unreliable, not scored: reads an exponential-release duck 1 to 2 dB shallow (docs/RACK_STANDARD.md section 8)' }); continue; }
    const ok = (c.min == null || v >= c.min) && (c.max == null || v <= c.max), prov = c.basis === 'convention';
    rows.push({ id: c.id, status: ok ? 'pass' : 'miss', value: v, min: c.min ?? null, max: c.max ?? null, basis: c.basis, provisional: prov && !ok ? true : undefined, confidence: c.confidence });
    if (!ok && (!prov || strict)) fail = true; }
  return { rows, fail };
}
export const fmtRow = (r) => `${(r.status === 'unreliable' ? 'UNREL' : r.status.toUpperCase()).padEnd(4)} ${r.id.padEnd(28)} value ${r.value == null ? 'n/a' : r.value}  range [${r.min ?? '-inf'}, ${r.max ?? 'inf'}]  basis ${r.basis}${r.provisional ? ' (provisional)' : ''}${r.why ? '  ' + r.why : ''}`;

// ---------- CLI ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const argv = process.argv.slice(2), val = new Set(['--bpm', '--beats-per-bar', '--kick', '--bass', '--score']); const opt = {}; let file = null, genreFile = null, strict = false;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--strict') strict = true; else if (val.has(a)) { const v = argv[++i]; if (a === '--bpm') opt.bpm = +v; else if (a === '--beats-per-bar') opt.beatsPerBar = +v; else if (a === '--score') genreFile = v; else opt[a.slice(2)] = v; } else if (a.startsWith('--')) { console.error('unknown option ' + a); process.exit(2); } else file = a; }
  if (!file || (opt.kick && !opt.bass) || (opt.bass && !opt.kick) || (opt.bpm != null && !(opt.bpm > 0))) { console.error('usage: measure.mjs [--score GENRE.json [--strict]] [--bpm N] [--beats-per-bar 4] [--kick K.wav --bass B.wav] FILE.wav'); process.exit(2); }
  try { if (opt.kick) { opt.kick = readWav(opt.kick); opt.bass = readWav(opt.bass); }
    const m = measure(readWav(file), opt);
    if (!genreFile) console.log(JSON.stringify(m, null, 2));
    else { const g = JSON.parse(fs.readFileSync(genreFile, 'utf8')); const r = score(m, g, strict); console.log(`${g.genre}: ${file}`); for (const row of r.rows) console.log(fmtRow(row));
      const c = (s) => r.rows.filter((x) => x.status === s).length; console.log(`pass ${c('pass')}  miss ${c('miss')}  skip ${c('skip')}  unreliable ${c('unreliable')}${strict ? '  (strict)' : ''} -> ${r.fail ? 'FAIL' : 'OK'}`); process.exit(r.fail ? 1 : 0); }
  } catch (e) { console.error(e.message); process.exit(2); }
}
