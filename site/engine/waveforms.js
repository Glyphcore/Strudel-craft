// Drawn and computed instruments (docs/DRAWN_WAVEFORMS.md, #182 stage 1). Pure ES module: no DOM, no Node, no imports.
// A `waveforms@1` instrument is control points and parameters; this module turns it into Strudel program text plus, where needed, an
// in-memory WAV (mechanism B/C of the doc). Nothing here reads or writes an audio file; the caller turns bytes into a blob: URL.
//   validate(doc)            -> [{code, path, msg}]   (schema caps, the no-copy rule; schemas/craftpack/1/kinds/waveforms.1.schema.json is the full schema)
//   cycleOf(inst, pos?)      -> Float32Array(N)        one period from the drawn points (morph: frame at pos 0..1)
//   partialsOf(cycle, H)     -> {mag[], phase[]}       DFT, for `s("user").partials().phases()` (mechanism A)
//   wavetable(inst, n)       -> Float32Array(n*2048)   n frames through spectral interpolation (mechanism B)
//   oneShot(inst, o)         -> Float32Array           the cycle repeated with a baked decay (mechanism C)
//   wavBytes(samples, sr)    -> Uint8Array             16-bit mono PCM WAV
//   vary(inst, seed)         -> {name: value}          seeded parameter draw (same seed, same values)
//   program(inst, o)         -> {code, key, wav?}      Strudel code for one note; `wav` is what must be registered with samples({[key]: [url]})

export const FRAME = 2048, MAX_POINTS = 256, MAX_ARRAY = 256;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function validate(doc) {
  const out = [], bad = (code, path, msg) => out.push({ code, path, msg });
  if (!doc || !Array.isArray(doc.instruments)) { bad('E_WF_SHAPE', '', 'instruments[] required'); return out; }
  const walk = (v, p) => {
    if (typeof v === 'string') {
      if (/^data:|RIFF|base64,/i.test(v)) bad('E_WF_AUDIO', p, 'string looks like audio data');
    } else if (Array.isArray(v)) {
      if (v.length > MAX_ARRAY && v.every((x) => typeof x === 'number')) bad('E_WF_ARRAY', p, `array of ${v.length} numbers exceeds ${MAX_ARRAY}`);
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };
  doc.instruments.forEach((it, i) => {
    const p = `instruments[${i}]`;
    if (!ID_RE.test(it.id || '')) bad('E_WF_ID', p + '.id', 'bad id');
    if (!it.family) bad('E_WF_FAMILY', p + '.family', 'family required');
    if (!['drawn', 'computed'].includes(it.origin)) bad('E_WF_ORIGIN', p + '.origin', 'origin is drawn or computed');
    if (!it.license) bad('E_WF_LICENSE', p + '.license', 'license required');
    if (!it.cycle && !it.morph) bad('E_WF_SHAPE', p, 'cycle or morph required');
    const pts = (a, q) => { if (!Array.isArray(a) || a.length < 4 || a.length > MAX_POINTS) bad('E_WF_POINTS', q, `points: 4..${MAX_POINTS}`); };
    if (it.cycle) pts(it.cycle.points, p + '.cycle.points');
    if (it.morph) {
      const f = it.morph.frames || [];
      if (f.length < 2 || f.length > 8) bad('E_WF_FRAMES', p + '.morph.frames', 'keyframes: 2..8');
      f.forEach((fr, j) => pts(fr.points, `${p}.morph.frames[${j}].points`));
    }
    for (const [k, c] of Object.entries(it.params || {})) if (!(c.min <= c.default && c.default <= c.max)) bad('E_WF_PARAM', `${p}.params.${k}`, 'default outside min..max');
    walk(it, p);
  });
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
export function wavetable(inst, n = 16, frame = FRAME) {
  const kf = (inst.morph ? inst.morph.frames : [{ pos: 0, points: inst.cycle.points }]).slice().sort((a, b) => a.pos - b.pos);
  const H = 48, co = kf.map((f) => {
    const c = sampleCurve(f.points, frame, inst.cycle?.interp || 'spline'), re = [], im = [];
    for (let k = 1; k <= H; k++) { let r = 0, m = 0; for (let i = 0; i < frame; i++) { const a = 2 * Math.PI * k * i / frame; r += c[i] * Math.cos(a); m -= c[i] * Math.sin(a); } re.push(2 * r / frame); im.push(2 * m / frame); }
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
  if (pk > 0) for (let i = 0; i < out.length; i++) out[i] /= pk * 1.1;
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
export function program(inst, { mechanism = 'A', note = 'c3', seed, gain = 0.5 } = {}) {
  const v = vary(inst, seed), ctl = Object.entries(inst.params || {}).filter(([, c]) => c.to).map(([k, c]) => `.${c.to}(${v[k]})`).join('');
  if (mechanism === 'A') {
    const { mag, phase } = partialsOf(cycleOf(inst, 0), 32);
    return { key: 'user', code: `note("${note}").s("user").partials(${JSON.stringify(mag)}).phases(${JSON.stringify(phase)})${ctl}.gain(${gain})` };
  }
  if (mechanism === 'B') {
    const key = 'wt_' + inst.id.replace(/-/g, '_'), frames = inst.morph?.out ?? 16;
    return { key, wav: wavBytes(wavetable(inst, frames)), code: `note("${note}").s("${key}")${inst.params?.position ? '' : '.wt(0.5)'}${ctl}.gain(${gain})` };
  }
  const key = inst.id.replace(/-/g, '_');
  return { key, wav: wavBytes(oneShot(inst)), code: `s("${key}")${ctl}.gain(${gain})` };
}
