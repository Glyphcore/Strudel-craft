#!/usr/bin/env node
// On-demand equivalence check of the two forms of Sirocco Foundry (issue #136). Needs Playwright + Chromium (see tools/racks/render_track.cjs) and network access to unpkg.
//   node docs/tracks/sirocco-foundry/check.mjs [--lane kick,pad,...] [--bars 16] [--keep DIR]
// For every lane in arrangement.mjs (or --lane), renders that lane solo, in the Craft form and in the standalone, over the first block of its bars (at most --bars, default 8),
// and compares (1) the hap count, which must be equal, (2) the level (LUFS), which must agree within 0.5 dB, (3) the share of energy below 120 Hz, which must agree within 3 points
// (one lane type, a supersaw pad, differs by about 2.5 points between two renders of the SAME form, so 3 is the render noise, not a difference), and prints the true peak and centroid.
// Exit 1 on any failure. The WAVs are deleted after each lane. build.mjs --check is the cheap check that the committed standalone is fresh; this one is the sound check.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { ON } from './arrangement.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..'), arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const only = arg('--lane', '') ? arg('--lane').split(',') : Object.keys(ON), MAXB = +arg('--bars', 8), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-check-'));
const FORMS = { craft: 'track.strudel.js', standalone: 'track.standalone.strudel.js' };
const render = (form, lane, a, b) => {
  const wav = path.join(TMP, `${form}-${lane}.wav`);
  const p = spawnSync('node', [path.join(ROOT, 'tools/racks/render_track.cjs'), path.join(HERE, FORMS[form]), wav, '--bars', `${a}-${b}`, '--solo', lane], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const j = (/\{"wrote".*\}/.exec(p.stdout) || [])[0]; if (!j) return { error: (p.stderr || p.stdout || '').slice(-200) };
  const info = JSON.parse(j), m = JSON.parse(spawnSync('node', [path.join(ROOT, 'tools/racks/measure.mjs'), '--bpm', '140', wav], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
  fs.rmSync(wav, { force: true }); return { haps: info.haps, fails: info.fails, lufs: m.lufs_integrated, tp: m.true_peak_dbtp, cent: m.spectral_centroid_hz, low: m.low_share_pct };
};
let bad = 0; const rows = [];
for (const lane of only) {
  const runs = (ON[lane] || []).map((r) => (Array.isArray(r) ? r : [r, r])); if (!runs.length) { console.log(`${lane}: not in arrangement.mjs`); bad++; continue; }
  const [a0, b0] = runs[0], a = a0, b = Math.max(Math.min(b0, a0 + MAXB - 1), a0 + 3), /* at least 4 bars so a single hit's reverb tail is inside the window (the reverb impulse is random: a 1-bar window read 2.4 dB apart) */ c = render('craft', lane, a, b), s = render('standalone', lane, a, b);
  if (c.error || s.error) { console.log(`${lane} ${a}-${b}: RENDER ERROR ${c.error || s.error}`); bad++; continue; }
  const silent = c.lufs < -150 && s.lufs < -150, dl = silent ? 0 : Math.abs(c.lufs - s.lufs), dlow = Math.abs(c.low - s.low), why = [];
  if (c.haps !== s.haps) why.push(`haps ${c.haps} vs ${s.haps}`); if (dl > 0.5) why.push(`level ${dl.toFixed(2)} dB`); if (dlow > 3) why.push(`low share ${dlow.toFixed(1)} pts`);
  if (c.fails || s.fails) why.push('failed events');
  console.log(`${why.length ? 'FAIL' : 'ok  '} ${lane.padEnd(9)} bars ${a}-${b}  haps ${c.haps}/${s.haps}  LUFS ${c.lufs}/${s.lufs}  tp ${c.tp}/${s.tp}  low% ${c.low}/${s.low}  cent ${c.cent}/${s.cent}${why.length ? '  <- ' + why.join(', ') : ''}`);
  rows.push({ lane, bars: [a, b], craft: c, standalone: s, fail: why }); if (why.length) bad++;
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(bad ? `${bad} lane(s) differ` : `all ${rows.length} lanes equal: haps, level within 0.5 dB, low share within 3 points`); process.exit(bad ? 1 : 0);
