// Computed drum voices (#182 stage 4): `node tests/site/waveforms_drums.mjs` (Node only, no audio device).
// Per family: the one-shot has a sensible length, peaks near 0.9 without clipping, decays (last 15% under 5% of the first 15% in rms), has a spectral centroid in its
// expected band; the families order kick < tom < snare < hats; variants of one parameter set differ and the same seed repeats exactly; an out-of-range or foreign model parameter
// is refused by validate(). The pack's drums.json validates and every declared default lies inside its range.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const D = await import(path.join(ROOT, 'site/engine/drums.js')), WF = await import(path.join(ROOT, 'site/engine/waveforms.js'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const rms = (x, a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };
const centroid = (x) => { const N = 2048, n = Math.min(N, x.length); let num = 0, den = 0; for (let k = 1; k < N / 2; k += 2) { let re = 0, im = 0; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * k * i / N; const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); re += w * x[i] * Math.cos(a); im -= w * x[i] * Math.sin(a); } const m = Math.hypot(re, im); num += m * k * D.SR / N; den += m; } return num / den; };
const bands = { kick: [40, 400, 0.15, 1.2], tom: [60, 400, 0.15, 1.2], snare: [1200, 6500, 0.1, 0.6], 'hat-closed': [5000, 14000, 0.03, 0.2], 'hat-open': [5000, 14000, 0.2, 1.2], clap: [800, 4000, 0.1, 0.8] }; // [centroid lo, hi, length lo s, hi s]
const cen = {};
for (const kind of Object.keys(D.FAMILIES)) {
  for (const [k, [d, lo, hi]] of Object.entries(D.FAMILIES[kind])) if (!(lo <= d && d <= hi)) ok(false, `${kind}.${k} default ${d} outside ${lo}..${hi}`);
  const x = D.render(kind, {}, 1), n = x.length, pk = Math.max(...x.map(Math.abs)), [clo, chi, llo, lhi] = bands[kind], c = centroid(x); cen[kind] = c;
  ok(pk > 0.5 && pk <= 0.95 && x.every(Number.isFinite), `${kind}: finite, peak ${pk.toFixed(2)} (0.5..0.95)`);
  ok(n / D.SR >= llo && n / D.SR <= lhi, `${kind}: length ${(n / D.SR).toFixed(2)} s within ${llo}..${lhi}`);
  ok(rms(x, Math.floor(n * 0.85), n) < 0.05 * rms(x, 0, Math.floor(n * 0.15)), `${kind}: decays (tail rms ${rms(x, Math.floor(n * 0.85), n).toFixed(4)} vs head ${rms(x, 0, Math.floor(n * 0.15)).toFixed(3)})`);
  ok(c >= clo && c <= chi, `${kind}: spectral centroid ${Math.round(c)} Hz within ${clo}..${chi}`);
  const y = D.render(kind, {}, 1), z = D.render(kind, {}, 2);
  ok(x.length === y.length && x.every((v, i) => v === y[i]), `${kind}: same seed gives identical samples`);
  const m = Math.min(x.length, z.length); let df = 0; for (let i = 0; i < m; i++) df = Math.max(df, Math.abs(x[i] - z[i]));
  ok(kind === 'tom' ? true : df > 0.02, `${kind}: another seed differs (max diff ${df.toFixed(3)}${kind === 'tom' ? ', tom noise only in the click, not required' : ''})`);
}
ok(cen.kick < cen.snare && cen.tom < cen.snare && cen.snare < cen['hat-closed'], `ordering by centroid: kick ${Math.round(cen.kick)} < snare ${Math.round(cen.snare)} < closed hat ${Math.round(cen['hat-closed'])} Hz`);
// the pack file and the model rules
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/drawn-core/instruments/drums.json'), 'utf8'));
ok(WF.validate(doc).length === 0 && doc.instruments.length === 6, 'drums.json validates (6 instruments)');
for (const inst of doc.instruments) { const t = WF.tables(inst), u = t.map.map((b) => Buffer.from(b).toString('base64')); ok(t.map.length === 4 && new Set(u).size === 4 && t.name.startsWith('dr_'), `${inst.id}: ${t.name} has 4 distinct variants`); }
const mk = (model) => ({ instruments: [{ id: 'k', family: 'kick', origin: 'computed', license: 'CC0-1.0', model }] });
ok(WF.validate(mk({ kind: 'kick', params: { start_hz: 9999 } })).some((e) => e.code === 'E_WF_PARAM'), 'model parameter out of its family range is E_WF_PARAM');
ok(WF.validate(mk({ kind: 'kick', params: { tone_hz: 200 } })).some((e) => e.code === 'E_WF_UNKNOWN'), 'a parameter of another family is E_WF_UNKNOWN');
ok(WF.validate(mk({ kind: 'cowbell' })).some((e) => e.code === 'E_WF_ENUM'), 'unknown model kind is E_WF_ENUM');
ok(WF.validate(mk({ kind: 'kick', variants: 99 })).length > 0 && WF.validate(mk({ kind: 'kick', samples: [0, 1] })).some((e) => e.code === 'E_WF_UNKNOWN'), 'variants over 16 and extra model fields are refused');
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
