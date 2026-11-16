// WebVTT validity with a standard parser (#162): Chromium's own WebVTT parser (a <track> on a <video>, mode "hidden") reads the CLI output of every shipped
// cue set; the parsed cue count and the start / end times must equal what the engine wrote. Usage: node tests/cues/vtt_browser.mjs  (exit 1 on any FAIL)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
import * as C from '../../site/engine/cues.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
let fails = 0; const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -- ' + x : ''}`); };
const sets = [...fs.readdirSync(path.join(ROOT, 'docs/tracks'), { recursive: true })].filter((f) => /\.craftcues$/.test(f)).map((f) => path.join(ROOT, 'docs/tracks', f));
const b = await chromium.launch(); const p = await b.newPage();
try {
  for (const f of sets) {
    const doc = C.parse(fs.readFileSync(f, 'utf8')).doc; const vtt = C.toVTT(doc); const want = [...vtt.matchAll(/^(\S+)\n(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})$/gm)].map((m) => ({ id: m[1], a: +m[2] * 3600 + +m[3] * 60 + +m[4] + +m[5] / 1000, b: +m[6] * 3600 + +m[7] * 60 + +m[8] + +m[9] / 1000 }));
    const got = await p.evaluate(async (text) => { document.body.innerHTML = ''; const v = document.createElement('video'); const t = document.createElement('track'); t.kind = 'captions'; t.default = true; t.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' })); v.append(t); document.body.append(v); t.track.mode = 'hidden';
      const r = await new Promise((ok) => { t.addEventListener('load', () => ok('load')); t.addEventListener('error', () => ok('error')); setTimeout(() => ok('timeout'), 5000); });
      return { r, cues: [...(t.track.cues || [])].map((c) => ({ id: c.id, a: c.startTime, b: c.endTime, text: c.text })) }; }, vtt);
    const same = got.cues.length === want.length && got.cues.every((c, i) => c.id === want[i].id && Math.abs(c.a - want[i].a) < 1e-3 && Math.abs(c.b - want[i].b) < 1e-3);
    check(`${path.relative(ROOT, f)}: Chromium's WebVTT parser loads ${want.length} cues with the same ids and times`, got.r === 'load' && same && want.length > 0, `${got.r}, parsed ${got.cues.length} of ${want.length}`);
    const s = C.toSRT(doc); check(`${path.basename(f)}: SRT has the same cue count`, (s.match(/ --> /g) || []).length === want.length);
  }
} finally { await b.close(); }
console.log(fails ? `${fails} FAIL` : 'all PASS'); process.exit(fails ? 1 : 0);
