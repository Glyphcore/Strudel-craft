// Tests for tools/racks/measure.mjs and docs/genres (issue #125). Synthetic signals are generated here; no audio file is read.
// Usage: node tests/racks/measure.mjs    (PASS/FAIL lines, exit 1 on any FAIL)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { measure, writeWav, truePeak } from '../../tools/racks/measure.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const SR = 48000; let bad = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) bad++; };
const near = (name, got, want, tol) => check(name, Math.abs(got - want) <= tol, `got ${got} want ${want} +-${tol}`);
const amp = (db) => 10 ** (db / 20);
const sine = (secs, hz, db, phase = 0, sr = SR) => Float64Array.from({ length: Math.round(secs * sr) }, (_, i) => amp(db) * Math.sin(2 * Math.PI * hz * i / sr + phase));
const stereo = (x) => ({ sr: SR, L: x, R: x });
const cat = (...a) => { const o = new Float64Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

// 1. absolute level: stereo 1 kHz sine, both channels. Each channel has mean square a^2/2; K-weighting is 0 dB at 1 kHz up to the
// -0.691 LU offset the standard builds in; the two channels add (weights 1.0): L = -0.691 + 10log10(2 * a^2/2) + 0.691 = 20log10(a).
near('1 kHz -23 dBFS reads -23.0 LUFS', measure(stereo(sine(20, 1000, -23))).lufs_integrated, -23, 0.1);
near('1 kHz -33 dBFS reads -33.0 LUFS', measure(stereo(sine(20, 1000, -33))).lufs_integrated, -33, 0.1);

// 2. gating: 10 s at -36, 40 s at -23, 10 s at -36 dBFS (stereo 1 kHz). Expected value derived by hand from BS.1770 section 5.1:
// block loudness: -36 segment -36.0 LUFS, -23 segment -23.0 LUFS; blocks are 400 ms every 100 ms, so 597 blocks; blocks starting 10.0 .. 49.6 s lie
// fully in the loud segment (397); per boundary 3 blocks straddle it, with loud fraction p = .25 .5 .75 (power relative to the loud block =
// p + (1-p) * 10^-1.3, 10^-1.3 = 0.0501): .2876 + .5251 + .7625 = 1.5752 per boundary. Absolute gate (-70) removes nothing. Relative
// threshold = L(mean of all 597 blocks) - 10: mean power = (397 + 3.1504 + 194 * 0.0501) / 597 -> 0.6866 -> -23 - 1.63 = -24.63 -> threshold -34.63 LUFS.
// So the -36 blocks (and the p = 0 ones) are gated out, the 6 straddling blocks with p >= .25 (-23 - 5.4 dB or louder) stay: the sum over
// kept blocks is 397 + 3.1504 = 400.1504 over 403 blocks = 0.99293 -> 10log10 = -0.0309 dB -> -23.03 LUFS. An ungated mean would read -24.63.
const gated = measure(stereo(cat(sine(10, 1000, -36), sine(40, 1000, -23), sine(10, 1000, -36)))).lufs_integrated;
near('gating sequence -36/-23/-36 reads -23.03 LUFS (ungated would be -24.63)', gated, -23.03, 0.1);

// 3. true peak: fs/4 sine, 45 degree phase, amplitude 1: samples are +-0.7071 (sample peak -3.01 dBFS), the waveform peaks at 1.0 between samples.
const q = measure(stereo(sine(1, SR / 4, 0, Math.PI / 4)));
near('fs/4 sine, 45 deg: sample peak -3.01 dBFS', q.sample_peak_dbfs, -3.01, 0.05);
near('fs/4 sine, 45 deg: true peak 0.0 dBTP', q.true_peak_dbtp, 0, 0.2);

// 4. stereo: identical channels, and anti-phase (60 Hz so the signal is inside the below-120 Hz band)
const same = measure(stereo(sine(3, 60, -20)));
check('identical channels: correlation 1', same.lr_correlation_below_120 === 1 || Math.abs(same.lr_correlation_below_120 - 1) < 1e-6, `got ${same.lr_correlation_below_120}`);
check('identical channels: side-to-mid below -90 dB', same.side_to_mid_db_below_120 < -90, `got ${same.side_to_mid_db_below_120}`);
const x = sine(3, 60, -20); const anti = measure({ sr: SR, L: x, R: x.map((v) => -v) });
near('anti-phase: correlation -1', anti.lr_correlation_below_120, -1, 0.001);

// 5. onsets per bar and duck depth (tempo-aware): clicks on 16ths at 120 BPM (4/4: a bar is 2 s, 16 onsets per bar)
const bpm = 120, secs = 16, click = new Float64Array(SR * secs); for (let i = 0; i < 16 * secs / 2; i++) { const s = Math.round(i * 0.125 * SR); for (let j = 0; j < 400 && s + j < click.length; j++) click[s + j] = 0.5 * Math.exp(-j / 60) * Math.sin(j * 0.9); }
const cm = measure(stereo(click), { bpm }); near('16 clicks per bar at 120 BPM: onsets per bar', cm.onsets_per_bar, 16, 1.5);
const kk = new Float64Array(SR * 4), bb = new Float64Array(SR * 4); for (let i = 0; i < bb.length; i++) bb[i] = 0.5 * Math.sin(2 * Math.PI * 55 * i / SR);
for (let b = 0; b < 8; b++) { const s = Math.round((0.25 + b * 0.5) * SR); for (let j = 0; j < 2400; j++) kk[s + j] = 0.8 * Math.exp(-j / 800) * Math.sin(2 * Math.PI * 50 * j / SR); for (let j = 0; j < 12000 && s + j < bb.length; j++) bb[s + j] *= 1 - 0.5 * Math.exp(-j / 4800); }
const dd = measure(stereo(click.subarray(0, SR * 4)), { kick: stereo(kk), bass: stereo(bb) }).duck_depth_db; near('duck depth: bass dips about 6 dB at each kick', dd, 6, 1.5);

// 6. docs/genres: every file valid against the schema; every criterion has basis, source, confidence; standard/platform need a source
const GD = path.join(ROOT, 'docs', 'genres'); const schema = JSON.parse(fs.readFileSync(path.join(GD, 'genre.schema.json'), 'utf8'));
function validate(v, s, at, errs) { // the keywords the schema uses: $ref, const, enum, type, pattern, required, additionalProperties, properties, items, minItems
  if (s.$ref) s = schema.definitions[s.$ref.split('/').pop()];
  const t = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x === 'object' ? 'object' : typeof x);
  if (s.const !== undefined && v !== s.const) errs.push(`${at}: not ${s.const}`);
  if (s.enum && !s.enum.includes(v)) errs.push(`${at}: ${JSON.stringify(v)} not in enum`);
  if (s.type) { const ts = [].concat(s.type); if (!ts.includes(t(v)) && !(t(v) === 'number' && ts.includes('integer'))) { errs.push(`${at}: type ${t(v)}`); return; } }
  if (s.pattern && typeof v === 'string' && !new RegExp(s.pattern).test(v)) errs.push(`${at}: pattern`);
  if (t(v) === 'object') { for (const r of s.required || []) if (!(r in v)) errs.push(`${at}: missing ${r}`);
    for (const k of Object.keys(v)) { if (s.properties && k in s.properties) validate(v[k], s.properties[k], `${at}.${k}`, errs); else if (s.additionalProperties === false) errs.push(`${at}: extra ${k}`); else if (s.additionalProperties && typeof s.additionalProperties === 'object') validate(v[k], s.additionalProperties, `${at}.${k}`, errs); } }
  if (t(v) === 'array') { if (s.minItems && v.length < s.minItems) errs.push(`${at}: too short`); if (s.items) v.forEach((e, i) => validate(e, s.items, `${at}[${i}]`, errs)); }
}
const want = ['dubstep', 'drum-and-bass', 'house', 'tech-house', 'techno', 'trance', 'electro']; const errs = [];
for (const g of want) { const f = path.join(GD, g + '.json'); if (!fs.existsSync(f)) { errs.push('missing ' + g); continue; } const d = JSON.parse(fs.readFileSync(f, 'utf8')); validate(d, schema, g, errs);
  if (d.genre !== g) errs.push(g + ': genre field');
  for (const c of [...d.criteria, ...Object.values(d.method)]) { for (const k of ['basis', 'source', 'confidence']) if (c[k] === undefined && !(c.confidence === undefined && k === 'confidence' && !d.criteria.includes(c))) errs.push(`${g}/${c.id || 'method'}: no ${k}`);
    if ((c.basis === 'standard' || c.basis === 'platform') && !c.source) errs.push(`${g}/${c.id || 'method'}: ${c.basis} needs a source`); } }
check('7 genre files valid against the schema, every criterion has basis/source/confidence, standard/platform have a source', errs.length === 0, errs.slice(0, 5).join('; '));

// 7. --score: exit codes. -14 dBFS stereo sine = -14 LUFS, true peak -14 dBTP: delivery passes, convention criteria miss (PLR 0).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure125-')); const ok = path.join(dir, 'ok.wav'), loud = path.join(dir, 'loud.wav'); writeWav(ok, SR, sine(8, 1000, -14), sine(8, 1000, -14)); writeWav(loud, SR, sine(8, 1000, -3), sine(8, 1000, -3));
const run = (...a) => spawnSync('node', [path.join(ROOT, 'tools/racks/measure.mjs'), ...a], { encoding: 'utf8' }); const gj = path.join(GD, 'dubstep.json');
const r1 = run('--score', gj, ok); check('--score: only convention misses -> exit 0, reported as provisional', r1.status === 0 && /MISS\s+plr .*\(provisional\)/.test(r1.stdout) && /PASS\s+delivery-loudness/.test(r1.stdout), `status ${r1.status}`);
const r2 = run('--score', gj, '--strict', ok); check('--score --strict: convention misses fail -> exit 1', r2.status === 1, `status ${r2.status}`);
const r3 = run('--score', gj, loud); check('--score: a platform miss (loud render) -> exit 1', r3.status === 1 && /MISS\s+delivery-loudness/.test(r3.stdout), `status ${r3.status}`);
const r4 = run(ok); let j = null; try { j = JSON.parse(r4.stdout); } catch {} check('plain run prints JSON with the measurement keys', !!j && ['lufs_integrated', 'lra_lu', 'true_peak_dbtp', 'sample_peak_dbfs', 'plr_db', 'crest_db', 'dc_offset_dbfs', 'clipped_samples', 'low_share_pct', 'spectral_tilt_db_oct', 'spectral_centroid_hz', 'lr_correlation_below_120', 'side_to_mid_db_below_120'].every((k) => k in j), r4.stderr.slice(0, 100));
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? `FAILED ${bad}` : 'ALL PASS'); process.exit(bad ? 1 : 0);
