// Drawn and computed instruments (docs/DRAWN_WAVEFORMS.md, #182 stage 1). Pure ES module: no DOM, no Node, no imports.
// A `waveforms@1` instrument is control points and parameters; this module turns it into Strudel program text plus, where needed, an
// in-memory WAV (mechanism B/C of the doc). Nothing here reads or writes an audio file; the caller turns bytes into a blob: URL.
//   validate(doc)            -> [{code, path, msg}]   (closed-world caps and the no-copy rule; the trusted check, mirrored by schemas/craftpack/1/kinds/waveforms.1.schema.json)
//   cycleOf(inst, pos?)      -> Float32Array(N)        one period from the drawn points (morph: frame at pos 0..1)
//   partialsOf(cycle, H)     -> {mag[], phase[]}       DFT, for `s("user").partials().phases()` (mechanism A)
//   wavetable(inst, n)       -> Float32Array(n*2048)   n frames through spectral interpolation (mechanism B)
//   oneShot(inst, o)         -> Float32Array           the cycle repeated with a baked decay (mechanism C)
//   wavBytes(samples, sr)    -> Uint8Array             16-bit mono PCM WAV
//   vary(inst, seed)         -> {name: value}          seeded parameter draw (same seed, same values)
//   soundName(inst), tables(inst)  the `wt_<id>` name and its WAV tables per register (what the pack adapter registers)
//   program(inst, o)         -> {code, key, wav?}      Strudel code for one note; `wav` is what must be registered with samples({[key]: [url]})

import { FAMILIES, fill, render as renderDrum } from './drums.js';

export const FRAME = 2048, MAX_POINTS = 256, MAX_BYTES = 5 * 1024 * 1024, MAX_INSTRUMENTS = 32, MAX_NUMBERS = 200000;
// Same rule as `$defs/safe` in the schema: data:, blob:, ://, base64 in any case; RIFF and RIFX as written (the binary headers are upper case, and "riff" is a music
// word); only printable ASCII plus a Latin allowlist (Latin-1 letters, Latin Extended-A/B, minus the compatibility forms that normalise to ASCII such as the long s).
// A schema cannot normalise unicode, so both paths use the allowlist; validate() also re-tests the NFKC form as a second belt.
const LATIN = /^[ -~\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u0131\u0134-\u013e\u0141-\u0148\u014a-\u017e\u0180-\u01c3\u01cd-\u01f0\u01f4-\u024f]*$/;
const BAD = (v) => /data:|blob:|:\/\/|base64/i.test(v) || /RIFF|RIFX/.test(v);
export const UNSAFE_RE = { test: (v) => BAD(v) || BAD(v.normalize('NFKC')) || !LATIN.test(v) };

// validate(doc): the check the site trusts (the JSON schema is the published mirror of it; tests/site/waveforms_caps.mjs runs both over
// the same fixtures). Closed world: every object lists its fields, anything else is E_WF_UNKNOWN. Every array, string and key is capped.
export function validate(doc) {
  const out = [], bad = (code, path, msg) => { if (out.length < 200) out.push({ code, path, msg }); };
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  let size = 0;
  try { size = JSON.stringify(doc)?.length ?? 0; } catch { bad('E_WF_SHAPE', '', 'not plain JSON'); return out; }
  if (size > MAX_BYTES) { bad('E_WF_SIZE', '', `document is ${size} bytes, cap ${MAX_BYTES}`); return out; }
  let numbers = 0;
  const str = (v, p, max, re) => {
    if (typeof v !== 'string') return bad('E_WF_TYPE', p, 'string expected');
    if (v.length > max) bad('E_WF_LEN', p, `string longer than ${max}`);
    if (UNSAFE_RE.test(v)) bad('E_WF_AUDIO', p, 'string looks like audio data or a URL');
    if (re && !re.test(v)) bad('E_WF_PATTERN', p, 'does not match ' + re);
  };
  const num = (v, p, lo, hi) => { numbers++; if (typeof v !== 'number' || !Number.isFinite(v)) return bad('E_WF_TYPE', p, 'number expected'); if (v < lo || v > hi) bad('E_WF_RANGE', p, `${v} outside ${lo}..${hi}`); };
  const int = (v, p, lo, hi) => { num(v, p, lo, hi); if (!Number.isInteger(v)) bad('E_WF_TYPE', p, 'integer expected'); };
  const en = (v, p, list) => { if (!list.includes(v)) bad('E_WF_ENUM', p, 'one of ' + list.join(', ')); };
  const arr = (v, p, lo, hi, each) => { if (!Array.isArray(v)) return bad('E_WF_TYPE', p, 'array expected'); if (v.length < lo || v.length > hi) bad('E_WF_ARRAY', p, `${v.length} items, allowed ${lo}..${hi}`); else v.forEach((x, i) => each(x, `${p}[${i}]`)); };
  // obj: spec = {field: checker}; required = names; any other key is unknown and its name is itself checked for audio-looking text
  const obj = (v, p, spec, required = []) => {
    if (!isObj(v)) return bad('E_WF_TYPE', p, 'object expected');
    for (const k of Object.keys(v)) { if (k.length > 48 || UNSAFE_RE.test(k)) bad('E_WF_KEY', p, 'key too long or audio-looking'); else if (!Object.hasOwn(spec, k)) bad('E_WF_UNKNOWN', `${p}.${k}`, 'unknown field'); else spec[k](v[k], `${p}.${k}`); }
    for (const r of required) if (!(r in v)) bad('E_WF_REQUIRED', `${p}.${r}`, 'required');
  };
  const map = (v, p, maxProps, keyRe, each) => {
    if (!isObj(v)) return bad('E_WF_TYPE', p, 'object expected');
    const ks = Object.keys(v); if (ks.length > maxProps) bad('E_WF_ARRAY', p, `${ks.length} keys, cap ${maxProps}`);
    for (const k of ks) { if (k.length > 24 || UNSAFE_RE.test(k) || !keyRe.test(k)) bad('E_WF_KEY', `${p}.${k}`, 'bad key'); else each(v[k], `${p}.${k}`); }
  };
  const NAME = /^[a-z][a-z0-9_]{0,23}$/, NOTE = /^[a-g][#bs]?-?[0-9]$/;
  const points = (v, p) => arr(v, p, 4, MAX_POINTS, (pt, q) => arr(pt, q, 2, 2, (x, r) => num(x, r, -1, 1)));
  const curve = (v, p) => obj(v, p, { points, interp: (x, q) => en(x, q, ['spline', 'linear']), res: (x, q) => en(x, q, [256, 512, 1024, 2048]) }, ['points']);
  const env = (v, p) => obj(v, p, {
    points: (x, q) => arr(x, q, 2, 64, (pt, r) => arr(pt, r, 2, 3, (y, s) => (typeof y === 'string' ? en(y, s, ['lin', 'exp', 'step', 'hold']) : num(y, s, -100, 100)))),
    adsr: (x, q) => { if (typeof x !== 'boolean') bad('E_WF_TYPE', q, 'boolean expected'); },
  }, ['points']);
  const inst = (v, p) => obj(v, p, {
    id: (x, q) => str(x, q, 48, /^[a-z0-9][a-z0-9_-]{0,47}$/),
    title: (x, q) => str(x, q, 80),
    family: (x, q) => str(x, q, 32, /^[a-z0-9][a-z0-9-]{0,31}$/),
    origin: (x, q) => en(x, q, ['drawn', 'computed']),
    realism: (x, q) => en(x, q, ['stand-in', 'usable', 'good']),
    license: (x, q) => str(x, q, 40),
    descriptors: (x, q) => map(x, q, 12, NAME, (y, r) => (typeof y === 'string' ? str(y, r, 60) : num(y, r, -100000, 100000))),
    cycle: curve,
    model: (x, q) => obj(x, q, {
      kind: (y, r) => en(y, r, Object.keys(FAMILIES)),
      params: (y, r) => map(y, r, 8, NAME, (z, t) => { num(z, t, -100000, 100000); const k = t.slice(t.lastIndexOf('.') + 1), f = FAMILIES[x && x.kind]; if (f && Object.hasOwn(f, k) && typeof z === 'number' && (z < f[k][1] || z > f[k][2])) bad('E_WF_PARAM', t, `${k} outside ${f[k][1]}..${f[k][2]}`); else if (f && !Object.hasOwn(f, k)) bad('E_WF_UNKNOWN', t, `${k} is not a parameter of ${x.kind}`); }),
      variants: (y, r) => int(y, r, 1, 16),
    }, ['kind']),
    morph: (x, q) => obj(x, q, {
      frames: (y, r) => arr(y, r, 2, 8, (f, s) => obj(f, s, { pos: (z, t) => num(z, t, 0, 1), points }, ['pos', 'points'])),
      interp: (y, r) => en(y, r, ['spectral', 'linear']),
      out: (y, r) => int(y, r, 2, 64),
    }, ['frames']),
    env: (x, q) => obj(x, q, { amp: env, pitch: env, filter: env }),
    registers: (x, q) => arr(x, q, 0, 8, (r, s) => obj(r, s, {
      from: (a, t) => str(a, t, 4, NOTE), to: (a, t) => str(a, t, 4, NOTE), use: (a, t) => en(a, t, ['cycle', 'morph']),
      gain: (a, t) => num(a, t, 0, 2), tilt: (a, t) => num(a, t, -12, 12),
    }, ['from', 'to'])),
    params: (x, q) => map(x, q, 16, NAME, (c, r) => obj(c, r, {
      min: (a, t) => num(a, t, -1e6, 1e6), max: (a, t) => num(a, t, -1e6, 1e6), default: (a, t) => num(a, t, -1e6, 1e6),
      to: (a, t) => str(a, t, 16, /^[a-z][a-z0-9]{0,15}$/), unit: (a, t) => str(a, t, 8, /^[a-z%]{0,8}$/),
    }, ['min', 'max', 'default'])),
    vary: (x, q) => obj(x, q, { seed: (y, r) => int(y, r, 0, 4294967295), spread: (y, r) => map(y, r, 16, NAME, (z, s) => num(z, s, 0, 1)) }),
  }, ['id', 'family', 'origin', 'license']);
  obj(doc, '', { instruments: (v, p) => arr(v, p, 0, MAX_INSTRUMENTS, (it, q) => {
    inst(it, q);
    if (isObj(it)) {
      if (!it.cycle && !it.morph && !it.model) bad('E_WF_SHAPE', q, 'cycle, morph or model required');
      for (const [k, c] of Object.entries(it.params || {})) if (isObj(c) && !(c.min <= c.default && c.default <= c.max)) bad('E_WF_PARAM', `${q}.params.${k}`, 'default outside min..max');
    }
  }) }, ['instruments']);
  if (numbers > MAX_NUMBERS) bad('E_WF_NUMBERS', '', `${numbers} numbers in the document, cap ${MAX_NUMBERS}`);
  return out;
}

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// Piecewise curve through [x, y] points (x in 0..1, ascending); 'spline' = Catmull-Rom on y, 'linear' otherwise. Cyclic ends close at y(0).
function sampleCurve(points, n, interp) {
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    let j = 0; while (j < pts.length - 2 && pts[j + 1][0] <= x) j++;
    const a = pts[j], b = pts[j + 1], t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
    if (interp === 'spline') {
      const p0 = pts[Math.max(0, j - 1)][1], p1 = a[1], p2 = b[1], p3 = pts[Math.min(pts.length - 1, j + 2)][1];
      out[i] = clamp1(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t));
    } else out[i] = a[1] + (b[1] - a[1]) * t;
  }
  let m = 0; for (const v of out) m += v; m /= n; for (let i = 0; i < n; i++) out[i] -= m; // no DC
  return out;
}

export function cycleOf(inst, pos = 0, n = FRAME) {
  if (!inst.cycle) { // morph only: the frame at `pos` of a 9-frame table
    const t = wavetable(inst, 9, n), f = Math.round(pos * 8);
    return t.slice(f * n, (f + 1) * n);
  }
  return sampleCurve(inst.cycle.points, n, inst.cycle.interp || 'spline');
}

export function partialsOf(cycle, H = 32) {
  const N = cycle.length, mag = [], phase = [];
  for (let k = 1; k <= H; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const a = 2 * Math.PI * k * i / N; re += cycle[i] * Math.cos(a); im -= cycle[i] * Math.sin(a); }
    mag.push(+(2 * Math.hypot(re, im) / N).toFixed(5)); phase.push(+Math.atan2(im, re).toFixed(4));
  }
  return { mag, phase };
}

// n frames from the drawn keyframes: complex harmonic coefficients are interpolated, then re-synthesised (spectral interpolation).
export function wavetable(inst, n = 16, frame = FRAME, o = {}) {
  const tilt = o.tilt || 0, gain = o.gain ?? 1, useMorph = inst.morph && (o.use !== 'cycle' || !inst.cycle);
  const kf = (useMorph ? inst.morph.frames : [{ pos: 0, points: inst.cycle.points }]).slice().sort((a, b) => a.pos - b.pos);
  const H = 48, co = kf.map((f) => {
    const c = sampleCurve(f.points, frame, inst.cycle?.interp || 'spline'), re = [], im = [];
    for (let k = 1; k <= H; k++) { let r = 0, m = 0; for (let i = 0; i < frame; i++) { const a = 2 * Math.PI * k * i / frame; r += c[i] * Math.cos(a); m -= c[i] * Math.sin(a); } const w = Math.pow(k, tilt / 6.02); re.push(w * 2 * r / frame); im.push(w * 2 * m / frame); } // tilt: dB per octave of harmonic number
    return { pos: f.pos, re, im };
  });
  const out = new Float32Array(n * frame);
  for (let fi = 0; fi < n; fi++) {
    const pos = n === 1 ? 0 : fi / (n - 1);
    let j = 0; while (j < co.length - 2 && co[j + 1].pos <= pos) j++;
    const a = co[j], b = co[Math.min(j + 1, co.length - 1)], t = b.pos === a.pos ? 0 : Math.min(1, Math.max(0, (pos - a.pos) / (b.pos - a.pos)));
    for (let k = 0; k < H; k++) {
      const re = a.re[k] + (b.re[k] - a.re[k]) * t, im = a.im[k] + (b.im[k] - a.im[k]) * t;
      for (let i = 0; i < frame; i++) { const ph = 2 * Math.PI * (k + 1) * i / frame; out[fi * frame + i] += re * Math.cos(ph) - im * Math.sin(ph); }
    }
  }
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) for (let i = 0; i < out.length; i++) out[i] = out[i] / (pk * 1.1) * gain;
  return out;
}

// Mechanism C: the drawn period repeated `cycles` times at `period` samples each, with an exponential decay baked in.
export function oneShot(inst, { period = 256, cycles = 64, decay = 0.9 } = {}) {
  const c = sampleCurve(inst.cycle ? inst.cycle.points : inst.morph.frames[0].points, period, 'spline'), out = new Float32Array(period * cycles);
  let pk = 0; for (const v of c) pk = Math.max(pk, Math.abs(v));
  for (let k = 0; k < cycles; k++) { const g = Math.pow(decay, k * 4 / cycles * 4) / (pk * 1.1 || 1); for (let i = 0; i < period; i++) out[k * period + i] = c[i] * g; }
  return out;
}

export function wavBytes(samples, sr = 44100) {
  const n = samples.length, b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(clamp1(samples[i]) * 32767), true);
  return b;
}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Seeded draw: value = default +/- spread * range, uniform, clamped to min..max. Names are visited in sorted order so the result is stable.
export function vary(inst, seed = inst.vary?.seed ?? 0) {
  const r = mulberry32(seed >>> 0), out = {};
  for (const k of Object.keys(inst.params || {}).sort()) {
    const c = inst.params[k], s = inst.vary?.spread?.[k] ?? 0, u = r() * 2 - 1;
    out[k] = +Math.min(c.max, Math.max(c.min, c.default + u * s * (c.max - c.min))).toFixed(4);
  }
  return out;
}

// One note of the instrument as Strudel program text. mechanism: 'A' partials, 'B' wavetable, 'C' one-shot.
// The name a program uses for the instrument: a wavetable voice, so it takes note() and the wt/warp/unison controls. `drawn-bass` -> `wt_drawn_bass`.
export const soundName = (inst) => (inst.model ? 'dr_' : 'wt_') + inst.id.replace(/-/g, '_'); // a model is a computed one-shot (dr_), a wave is a wavetable voice (wt_)

// The WAV tables a pack adapter registers for one instrument: {name, map} where map is `[wav]` or, with registers, `{note: [wav]}` (Strudel picks the closest
// note key and repitches from it). Pure data in, bytes out; the caller makes blob URLs. Registers use the cycle or the morph, with their own gain and tilt.
export function tables(inst) {
  if (inst.model) { // computed one-shots: `variants` related hits from one parameter set; s("dr_kick:2") picks variant 2 (n)
    const m = inst.model, n = m.variants ?? 1, base = fill(m.kind, m.params), seed0 = inst.vary?.seed ?? 0, spread = inst.vary?.spread || {}, out = [];
    for (let v = 0; v < n; v++) {
      const p = { ...base }, r = mulberry32((seed0 + v * 101) >>> 0);
      for (const k of Object.keys(FAMILIES[m.kind]).sort()) { const u = r() * 2 - 1, [, lo, hi] = FAMILIES[m.kind][k], sp = v === 0 ? 0 : (spread[k] ?? 0); p[k] = Math.min(hi, Math.max(lo, base[k] + u * sp * (hi - lo))); }
      out.push(wavBytes(renderDrum(m.kind, p, seed0 + v), 44100));
    }
    return { name: soundName(inst), map: out };
  }
  const name = soundName(inst), out = inst.morph?.out ?? 16, mk = (o) => wavBytes(wavetable(inst, (o.use === 'cycle' && inst.cycle) || !inst.morph ? 1 : out, FRAME, o));
  if (!inst.registers || !inst.registers.length) return { name, map: [mk({})] };
  const map = {}; for (const r of inst.registers) (map[r.from] ||= []).push(mk({ use: r.use, gain: r.gain, tilt: r.tilt }));
  return { name, map };
}

export function program(inst, { mechanism = 'A', note = 'c3', seed, gain = 0.5 } = {}) {
  const v = vary(inst, seed), ctl = Object.entries(inst.params || {}).filter(([, c]) => c.to).map(([k, c]) => `.${c.to}(${v[k]})`).join('');
  if (mechanism === 'A') {
    const { mag, phase } = partialsOf(cycleOf(inst, 0), 32);
    return { key: 'user', code: `note("${note}").s("user").partials(${JSON.stringify(mag)}).phases(${JSON.stringify(phase)})${ctl}.gain(${gain})` };
  }
  if (mechanism === 'B') {
    const key = soundName(inst), frames = inst.morph?.out ?? 16;
    return { key, wav: wavBytes(wavetable(inst, frames)), code: `note("${note}").s("${key}")${inst.params?.position ? '' : '.wt(0.5)'}${ctl}.gain(${gain})` };
  }
  const key = inst.id.replace(/-/g, '_');
  return { key, wav: wavBytes(oneShot(inst)), code: `s("${key}")${ctl}.gain(${gain})` };
}
