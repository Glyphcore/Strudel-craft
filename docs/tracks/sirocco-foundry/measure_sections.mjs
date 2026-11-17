#!/usr/bin/env node
// Whole-track and per-section measurement of a Sirocco Foundry render (issue #136). Needs ffmpeg and tools/racks/measure.mjs.
//   node docs/tracks/sirocco-foundry/measure_sections.mjs RENDER.wav OUT.json [--workdir DIR]
// 1. measures the render, 2. applies ONE static gain to the target (default -14.8 LUFS integrated, `--target`) (no limiter, no compression), 3. measures the normalised file,
// 4. slices it on bar lines per section of form.json (140 bpm, one bar = 240/140 s) and measures each slice.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..'), MEASURE = path.join(ROOT, 'tools/racks/measure.mjs');
const [IN, OUT] = process.argv.slice(2); const wd = process.argv.includes('--workdir') ? process.argv[process.argv.indexOf('--workdir') + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
const TARGET = process.argv.includes('--target') ? +process.argv[process.argv.indexOf('--target') + 1] : -14.8;
const form = JSON.parse(fs.readFileSync(path.join(HERE, 'form.json'), 'utf8')), BAR = 240 / form.bpm;
const measure = (f, extra = []) => JSON.parse(spawnSync('node', [MEASURE, '--bpm', String(form.bpm), ...extra, f], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
const raw = measure(IN), gain = TARGET - raw.lufs_integrated, norm = path.join(wd, 'normalised.wav');
spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', IN, '-af', `volume=${gain.toFixed(4)}dB`, '-c:a', 'pcm_f32le', norm]);
const whole = measure(norm), sections = []; let bar = 1;
for (const s of form.form) {
  const f = path.join(wd, `s_${s.section}.wav`);
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', ((bar - 1) * BAR).toFixed(5), '-t', (s.bars * BAR).toFixed(5), '-i', norm, '-c:a', 'pcm_f32le', f]);
  const m = measure(f); sections.push({ section: s.section, bars: `${bar}-${bar + s.bars - 1}`, lufs: m.lufs_integrated, true_peak_dbtp: m.true_peak_dbtp, centroid_hz: m.spectral_centroid_hz, low_share_pct: m.low_share_pct, corr_below_120: m.lr_correlation_below_120, side_mid_db_below_120: m.side_to_mid_db_below_120 }); bar += s.bars;
}
const out = { render: path.basename(IN), static_gain_db: +gain.toFixed(2), raw, whole_normalised: whole, sections };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`gain ${gain.toFixed(2)} dB | whole ${whole.lufs_integrated} LUFS tp ${whole.true_peak_dbtp} dc ${whole.dc_offset_dbfs} clip ${whole.clipped_samples} corr<120 ${whole.lr_correlation_below_120} s/m ${whole.side_to_mid_db_below_120}`);
for (const s of sections) console.log(`${s.section.padEnd(10)} ${s.bars.padEnd(8)} ${String(s.lufs).padStart(7)} LUFS  tp ${String(s.true_peak_dbtp).padStart(6)}  cent ${s.centroid_hz}  low% ${s.low_share_pct}`);
