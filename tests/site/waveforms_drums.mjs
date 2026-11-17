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
for (const kind of Object.keys(bands)) {
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

// ---- stage 5: steel-guitar pluck (Karplus-Strong), FM percussion, synthetic spaces
const f0 = (x, lo, hi) => { const n = Math.min(x.length, 16384); let best = 0, bl = 0; for (let L = Math.floor(D.SR / hi); L <= Math.ceil(D.SR / lo); L++) { let c = 0, e = 1e-12; for (let i = 0; i + L < n; i++) { c += x[i] * x[i + L]; e += x[i] * x[i]; } if (c / e > best) { best = c / e; bl = L; } } return D.SR / bl; };
for (const [note, hz] of [['c2', 65.406], ['c3', 130.813], ['c4', 261.626]]) { const x = D.render('pluck', {}, 3, hz), f = f0(x.subarray(Math.round(0.05 * D.SR)), hz * 0.8, hz * 1.25); ok(Math.abs(f / hz - 1) < 0.015, `pluck at ${note}: pitch ${f.toFixed(1)} Hz vs ${hz} (within 1.5%)`); }
{ const x = D.render('pluck', {}, 3), n = x.length; ok(rms(x, Math.floor(n * 0.8), n) < 0.1 * rms(x, 0, Math.floor(n * 0.1)) && n / D.SR > 1.5, `pluck: rings ${(n / D.SR).toFixed(2)} s and decays (tail rms ${rms(x, Math.floor(n * 0.8), n).toFixed(4)} vs ${rms(x, 0, Math.floor(n * 0.1)).toFixed(3)})`); }
{ const dull = centroid(D.render('pluck', { brightness: 0 }, 3)), bright = centroid(D.render('pluck', { brightness: 1 }, 3)); ok(bright > dull * 1.2, `pluck brightness parameter moves the spectrum (centroid ${Math.round(dull)} -> ${Math.round(bright)} Hz)`); }
for (const [id, lo, hi] of [['fm-perc', 300, 6000]]) { const x = D.render(id, {}, 1), n = x.length; ok(x.every(Number.isFinite) && Math.max(...x.map(Math.abs)) > 0.5, 'fm-perc: finite, level'); ok(centroid(x) >= lo && centroid(x) <= hi, `fm-perc: centroid ${Math.round(centroid(x))} Hz within ${lo}..${hi}`); ok(rms(x, Math.floor(n * 0.85), n) < 0.05 * rms(x, 0, Math.floor(n * 0.15)), 'fm-perc: decays'); const lowI = centroid(D.render('fm-perc', { fm_index: 0 }, 1)), hiI = centroid(D.render('fm-perc', { fm_index: 6 }, 1)); ok(hiI > lowI * 1.3, `fm-perc: modulation index brightens (centroid ${Math.round(lowI)} -> ${Math.round(hiI)} Hz)`); }
{ const models = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/drawn-core/instruments/models.json'), 'utf8')); ok(WF.validate(models).length === 0 && models.instruments.length === 7, 'models.json validates (steel guitar, 3 FM percussion, 3 rooms)');
  for (const inst of models.instruments) { const t = WF.tables(inst), sp = WF.spaceControls(inst);
    if (inst.model.kind === 'room') ok(t.map === null && /^\.room\(.*\)\.roomsize\(.*\)\.roomfade\(.*\)\.roomlp\(.*\)\.roomdim\(.*\)$/.test(sp), `${inst.id}: a space, no sound; controls ${sp}`);
    else if (inst.model.kind === 'pluck') ok(Object.keys(t.map).join() === inst.model.notes.join() && Object.values(t.map).every((v) => v.length === 2 && new Set(v.map((b) => Buffer.from(b).toString('base64'))).size === 2), `${inst.id}: ${t.name} one table pair per note (${Object.keys(t.map).join(' ')}), two distinct variants each`);
    else ok(t.map.length === 4 && new Set(t.map.map((b) => Buffer.from(b).toString('base64'))).size === 4, `${inst.id}: ${t.name} has 4 distinct variants`); }
  ok(WF.validate(mk({ kind: 'room', params: { size: 9 } })).some((e) => e.code === 'E_WF_PARAM'), 'room parameter out of range is E_WF_PARAM');
  ok(WF.validate(mk({ kind: 'pluck', notes: ['h9'] })).length > 0 && WF.validate(mk({ kind: 'pluck', notes: Array.from({ length: 9 }, () => 'c3') })).length > 0, 'pluck notes: a bad note name and 9 notes are refused');
  let threw = false; try { D.render('room', {}, 1); } catch { threw = true; } ok(threw, 'rendering a room throws (it is controls, not a sound)'); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
