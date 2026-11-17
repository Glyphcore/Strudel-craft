#!/usr/bin/env node
// Spectral pass over every instrument of glyphcore/drawn-core (#182): renders a short phrase per instrument through the site's offline recorder
// (tools/racks/render_track.cjs, so the sound goes through the real pack load path and render host), measures the WAV with tools/racks/measure.mjs
// (loudness, true peak, centroid, tilt) and with the rack audit's band definitions (energy below / above the class band relative to in-band energy,
// ultrasonic and sub-20 Hz share, DC, clipping), and judges it against the limits of its class in tools/racks/standard.json.
//   node tools/racks/drawn_measure.mjs [--only id,id] [--out docs/data/drawn-measure.json] [--keep DIR]
// Needs Playwright with Chrome/Chromium and network access to unpkg (env PLAYWRIGHT_MODULES, CHROMIUM_PATH as for render_track.cjs).
// The WAVs are temporary (never in the repo); the committed result is the JSON of numbers.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { readWav } from './measure.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const STD = JSON.parse(fs.readFileSync(path.join(HERE, 'standard.json'), 'utf8'));
const OUT = path.resolve(ROOT, opt('--out', 'docs/data/drawn-measure.json')), ONLY = (opt('--only', '') || '').split(',').filter(Boolean), KEEP = opt('--keep', '');

// [instrument id (pack ingredient), sound, class, phrase body]; gains as in the pack recipes
const K = (s) => `setcpm(100/4)\n$: s("${s}").gain(0.56)`;
const ITEMS = [
  ['kick', 'dr_kick', 'kick', K('dr_kick:0 ~ dr_kick:1 ~ dr_kick:2 ~ dr_kick:3 ~')],
  ['snare', 'dr_snare', 'snare', K('~ dr_snare:0 ~ dr_snare:1 ~ dr_snare:2 ~ dr_snare:3')],
  ['hat-closed', 'dr_hat_closed', 'hat', K('dr_hat_closed*8').replace('(0.56)', '(0.34)')],
  ['hat-open', 'dr_hat_open', 'hat', K('~ dr_hat_open:0 ~ dr_hat_open:1 ~ dr_hat_open:2 ~ dr_hat_open:3').replace('(0.56)', '(0.34)')],
  ['clap', 'dr_clap', 'perc', K('~ dr_clap:0 ~ dr_clap:1 ~ dr_clap:2 ~ dr_clap:3')],
  ['tom', 'dr_tom', 'kick', K('dr_tom:0 dr_tom:1 dr_tom:2 dr_tom:3')],
  ['drawn-bass', 'wt_drawn_bass', 'bass', 'setcpm(100/4)\n$: note("e1 e1 g1 a1 e1 d2 b1 g1").s("wt_drawn_bass").attack(0.004).decay(0.5).sustain(0).release(0.1).hpf(25).lpf(1400).gain(0.83)'],
  ['drawn-choir', 'wt_drawn_choir', 'pad', 'setcpm(80/4)\n$: note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>").s("wt_drawn_choir").wt("<0 0.5 1 0.5>").attack(0.4).release(0.8).unison(3).detune(0.15).lpf(3500).gain(0.35)'],
  ['drawn-electric', 'wt_drawn_electric', 'guitar', 'setcpm(100/4)\n$: note("<[e2,b2,e3] [g2,d3,g3] [a2,e3,a3] [g2,d3,g3]>").s("wt_drawn_electric").attack(0.004).decay(0.4).sustain(0.2).release(0.15).distort(0.5).lpf(4500).gain(0.8)'],
  ['drawn-viola', 'wt_drawn_viola', 'lead', 'setcpm(72/4)\n$: note("<c4 e4 g4 e4>").s("wt_drawn_viola").attack(0.12).release(0.4).vib(5.5).vibmod(0.3).lpf(4000).gain(0.5)'],
  ['drawn-cello', 'wt_drawn_cello', 'keys', 'setcpm(72/4)\n$: note("<e2 b2 c3 a2>").s("wt_drawn_cello").attack(0.16).release(0.5).vib(5).vibmod(0.3).gain(0.6)'],
];
// extra items appended by later stages (steel guitar, FM percussion, room) live in drawn_measure_items.json beside this file
const EXTRA = path.join(HERE, 'drawn_measure_items.json'); if (fs.existsSync(EXTRA)) for (const x of JSON.parse(fs.readFileSync(EXTRA, 'utf8'))) ITEMS.push([x.id, x.sound, x.class, x.code]);

// ---- spectrum (the rack audit's definitions: band energy below / above relative to in-band energy)
const N = 8192, HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = u + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr; re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
function measureBands(wav, band) {
  const { L, R, sr } = wav, n = L.length, P = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N); let peak = 0, clip = 0, sl = 0, sr2 = 0, sq = 0;
  for (let i = 0; i < n; i++) { const m = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (m > peak) peak = m; if (m >= 0.999) clip++; sl += L[i]; sr2 += R[i]; sq += (L[i] * L[i] + R[i] * R[i]) / 2; }
  for (let st = 0; st + N <= n || st === 0; st += N / 2) { for (const X of [L, R]) { for (let i = 0; i < N; i++) { re[i] = st + i < n ? X[st + i] * HANN[i] : 0; im[i] = 0; } fft(re, im); for (let k = 0; k <= N / 2; k++) P[k] += (re[k] * re[k] + im[k] * im[k]) / 2; } if (st + N >= n) break; }
  const BIN = sr / N, sum = (f0, f1) => { let s = 0; for (let k = Math.max(0, Math.ceil(f0 / BIN)); k <= Math.min(N / 2, Math.floor(f1 / BIN)); k++) s += P[k]; return s; }, db10 = (x) => (x > 1e-30 ? 10 * Math.log10(x) : -140), r1 = (x) => Math.round(x * 10) / 10;
  const total = sum(2, sr / 2) || 1e-30, inb = sum(band[0], band[1]) || 1e-30;
  return { peak_db: r1(20 * Math.log10(Math.max(peak, 1e-9))), clipped: clip, dc_db: r1(20 * Math.log10(Math.max(Math.abs(sl / n), Math.abs(sr2 / n), 1e-9))), sub20_db: r1(db10(sum(2, 20) / total)), ultra_db: r1(db10(sum(STD.global.ultra_hz, sr / 2) / total)),
    below_db: r1(db10(sum(2, band[0] - BIN) / inb)), above_db: r1(db10(sum(band[1] + BIN, sr / 2) / inb)), inband_pct: r1(100 * inb / total) };
}
function judge(m, cls) {
  const C = { ...STD.global, ...STD.classes[cls] }, out = [], le = (name, v, lim) => { if (lim != null && v != null) out.push({ name, value: v, limit: '<= ' + lim, ok: v <= lim }); };
  le('below_db', m.below_db, C.below_max_db); le('above_db', m.above_db, C.above_max_db); le('ultra_db', m.ultra_db, C.ultra_max_db ?? STD.global.ultra_max_db); le('sub20_db', m.sub20_db, C.sub20_max_db ?? STD.global.sub20_max_db);
  le('peak_db', m.peak_db, C.peak_max_db); le('dc_db', m.dc_db, C.dc_max_db ?? STD.global.dc_max_db); le('clipped', m.clipped, 0);
  if (C.peak_min_db != null || STD.global.peak_min_db != null) out.push({ name: 'peak_min_db', value: m.peak_db, limit: '>= ' + (C.peak_min_db ?? STD.global.peak_min_db), ok: m.peak_db >= (C.peak_min_db ?? STD.global.peak_min_db) });
  return out;
}

const HYG = { kick: 'hygiene-kick', snare: 'hygiene-snare', hat: 'hygiene-hat', bass: 'hygiene-bass' }; // the rack hygiene hooks (site/engine/hygiene.js): the band scope every rack chain starts with
const withHook = (code, h) => code.split('\n').map((l) => (l.startsWith('$:') ? l + `.hook("${h}")` : l)).join('\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drawn-measure-')), results = [];
function renderAndMeasure(id, cls, code) {
  const js = path.join(tmp, id + '.js'), wav = path.join(tmp, id + '.wav'); fs.writeFileSync(js, code + '\n');
  const bars = STD.classes[cls].bars || 2;
  const r = spawnSync('node', [path.join(HERE, 'render_track.cjs'), js, wav, '--bars', '1-' + bars, '--tail', '1'], { encoding: 'utf8', timeout: 300000, env: process.env });
  if (r.status !== 0 || !fs.existsSync(wav)) return { error: (r.stderr || r.stdout || 'render failed').slice(-300) };
  const info = JSON.parse(r.stdout.trim().split('\n').pop()), M = JSON.parse(spawnSync('node', [path.join(HERE, 'measure.mjs'), wav], { encoding: 'utf8' }).stdout), B = measureBands(readWav(wav), STD.classes[cls].band);
  const checks = judge(B, cls); if (KEEP) { fs.mkdirSync(KEEP, { recursive: true }); fs.copyFileSync(wav, path.join(KEEP, id + '.wav')); }
  return { bars, render: { haps: info.haps, fails: info.fails }, loudness: { lufs: M.lufs_integrated, true_peak_dbtp: M.true_peak_dbtp, crest_db: M.crest_db, centroid_hz: M.spectral_centroid_hz, tilt_db_oct: M.spectral_tilt_db_oct }, bands: B, checks, pass: info.fails === 0 && info.haps > 0 && checks.every((c) => c.ok) };
}
const line = (id, cls, m) => `${m.pass ? 'PASS' : 'FAIL'} ${id} (${cls}): haps ${m.render.haps} fails ${m.render.fails}; peak ${m.bands.peak_db} dB, centroid ${m.loudness.centroid_hz} Hz, below ${m.bands.below_db} above ${m.bands.above_db} ultra ${m.bands.ultra_db}${m.checks.filter((c) => !c.ok).length ? ' | ' + m.checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.value} (${c.limit})`).join(', ') : ''}`;
for (const [id, sound, cls, code] of ITEMS) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  const raw = renderAndMeasure(id, cls, code); if (raw.error) { results.push({ id, sound, class: cls, error: raw.error }); console.log('ERR ' + id); continue; }
  const res = { id, sound, class: cls, band: STD.classes[cls].band, ...raw }; console.log(line(id, cls, raw));
  if (HYG[cls]) { const h = renderAndMeasure(id + '-hyg', cls, withHook(code, HYG[cls])); if (h.error) res.with_hygiene = { hook: HYG[cls], error: h.error }; else { res.with_hygiene = { hook: HYG[cls], ...h }; console.log('  ' + line(id + ' +' + HYG[cls], cls, h)); } }
  results.push(res);
}
fs.rmSync(tmp, { recursive: true, force: true });
if (!ONLY.length) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify({ about: 'tools/racks/drawn_measure.mjs: every instrument of glyphcore/drawn-core rendered through the site offline recorder, raw and (for the classes that have one) through the rack hygiene hook, judged against its class in tools/racks/standard.json (#182)', date: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n'); console.log('wrote ' + path.relative(ROOT, OUT)); }
process.exit(results.some((r) => r.error || !r.pass) ? 1 : 0);
