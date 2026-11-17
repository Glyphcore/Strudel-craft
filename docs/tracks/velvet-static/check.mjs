// Parity check for this track. Fails (exit 1) when
//   1. track.standalone.strudel.js differs from a fresh build of track.strudel.js (lower.mjs --check), or
//   2. the Craft form and the standalone give different hap counts in a bar window (render_track.cjs prints `haps`), and a per-lane
//      bisection names the lanes that differ. Lanes that use .groove() may differ by up to two haps (the lowered groove is approximate: events at a window edge move across it).
//   node docs/tracks/velvet-static/check.mjs [--windows 1-8,49-56,105-112]     (needs Playwright + Chromium like render_track.cjs; about 1 min per render)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const craft = path.join(here, 'track.strudel.js'), std = path.join(here, 'track.standalone.strudel.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
let bad = 0; const fail = (m) => { bad++; console.log('FAIL', m); };
const low = spawnSync('node', [path.join(here, 'lower.mjs'), '--check'], { encoding: 'utf8' });
if (low.status !== 0) fail('the committed standalone is stale or the lowering failed: ' + (low.stdout + low.stderr).trim()); else console.log('ok   standalone = fresh build');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-check-'));
const haps = (file, bars, solo) => { const a = [path.join(root, 'tools/racks/render_track.cjs'), file, path.join(tmp, 'x.wav'), '--bars', bars, '--total', '160']; if (solo) a.push('--solo', solo);
  const r = spawnSync('node', a, { encoding: 'utf8', maxBuffer: 1 << 26 }); const m = /"haps":(\d+)/.exec(r.stdout || ''); return m ? +m[1] : null; };
const lanes = [...fs.readFileSync(craft, 'utf8').matchAll(/^([A-Za-z]\w*):(.*(?:\n(?:\s+|\.).*)*)/gm)].map((m) => ({ name: m[1], groove: /\.groove\(/.test(m[2]) }));
for (const w of arg('--windows', '1-8,49-56,105-112').split(',')) {
  const a = haps(craft, w), b = haps(std, w);
  if (a === null || b === null) { fail(`window ${w}: render failed`); continue; }
  if (a === b) { console.log(`ok   bars ${w}: ${a} haps in both`); continue; }
  console.log(`diff bars ${w}: Craft ${a}, standalone ${b}; per lane:`);
  for (const l of lanes) { const x = haps(craft, w, l.name + ",master,bus2"), y = haps(std, w, l.name + ",master,bus2"); if (x !== y) { const tol = l.groove && Math.abs(x - y) <= 2; console.log(`  ${tol ? 'tol ' : 'FAIL'} ${l.name}: ${x} vs ${y}${tol ? ' (groove, +-2)' : ''}`); if (!tol) bad++; } }
}
fs.rmSync(tmp, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
