// No-copy caps of the waveforms kind (#182): `node tests/site/waveforms_caps.mjs` (Node only; ajv from AJV_DIR or /opt/node-tools).
// Runs the SAME fixtures through the JSON schema (ajv) and through validate() of site/engine/waveforms.js. Each good fixture must pass both;
// each bypass fixture (the critic's cases from #182 plus others) must be rejected by BOTH, and the test fails if either accepts one.
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let Ajv; try { Ajv = require('ajv'); } catch { Ajv = require((process.env.AJV_DIR || '/opt/node-tools/node_modules') + '/ajv'); } // ajv 6: the schema keeps to keywords shared with draft-07
const SCH = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/craftpack/1/kinds/waveforms.1.schema.json'), 'utf8'));
const check = new (Ajv.default || Ajv)({ allErrors: false, validateSchema: false }).compile(SCH);
const WF = await import(path.join(ROOT, 'site/engine/waveforms.js'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const pts = (n, f = (x) => Math.sin(2 * Math.PI * x)) => Array.from({ length: n }, (_, i) => [+(i / n).toFixed(4), +f(i / n).toFixed(4)]);
const base = () => ({ id: 'a-wave', family: 'test', origin: 'drawn', license: 'CC0-1.0', cycle: { points: pts(16) } });
const inst = (extra) => ({ instruments: [{ ...base(), ...extra }] });
const full = inst({
  title: 'Full', realism: 'usable', descriptors: { pitch: 'c3-c5', attack_ms: 180, brightness: 'mid' },
  morph: { frames: [{ pos: 0, points: pts(16) }, { pos: 1, points: pts(16, (x) => 1 - 2 * x) }], interp: 'spectral', out: 16 },
  env: { amp: { points: [[0, 0, 'exp'], [0.2, 1, 'lin'], [1, 0]], adsr: true }, pitch: { points: [[0, -0.3], [0.1, 0]] } },
  registers: [{ from: 'c2', to: 'b3', use: 'morph', gain: 1, tilt: -2 }],
  params: { detune: { min: 0, max: 40, default: 12, to: 'detune', unit: 'cent' } }, vary: { seed: 7, spread: { detune: 0.3 } },
});
const mdl = (model) => ({ instruments: [{ id: 'm1', family: 'x', origin: 'computed', license: 'CC0-1.0', model }] });
const good = {
  'model pluck with notes': mdl({ kind: 'pluck', notes: ['c2', 'c3'], variants: 2, params: { decay_s: 2 } }), 'model room': mdl({ kind: 'room', params: { size: 1 } }), 'model fm-perc': mdl({ kind: 'fm-perc', variants: 4 }), 'single cycle': inst({}), 'morph only': { instruments: [{ id: 'm', family: 'f', origin: 'computed', license: 'CC0-1.0', morph: full.instruments[0].morph }] }, 'all optional fields': full, 'empty list': { instruments: [] }, '256 points': inst({ cycle: { points: pts(256) } }), 'Latin titles and credits (Latin-1, Latin Extended-A/B)': inst({ title: 'Caf\u00e9 \u00fcber na\u00efve \u00f1and\u00fa \u0141\u00f3d\u017a Dvo\u0159\u00e1k', descriptors: { credit: 'M\u00fcller & S\u00f8ren' } }),
  'lowercase riff is a music word (RIFF is the header)': inst({ title: 'bass riff', descriptors: { style: 'riffy' } }) };
const big = (n, v = 0) => Array.from({ length: n }, () => v);
const bad = {
  'model with 9 notes': mdl({ kind: 'pluck', notes: Array.from({ length: 9 }, () => 'c3') }), 'model note not a note': mdl({ kind: 'pluck', notes: ['zz9'] }), 'model unknown kind': mdl({ kind: 'cowbell' }), 'model with 9 params': mdl({ kind: 'kick', params: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['p' + i, 1])) }), 'model with samples array': mdl({ kind: 'kick', samples: [0, 1] }),
  'unknown field with 5000 [x,y] pairs': inst({ extra: pts(5000) }),
  'unknown field, 20 arrays of 200 numbers': inst({ extra: Array.from({ length: 20 }, () => big(200)) }),
  'env.amp.points with 100000 pairs': inst({ env: { amp: { points: Array.from({ length: 100000 }, (_, i) => [i % 50, 0]) } } }),
  'cycle with 300 points': inst({ cycle: { points: pts(300) } }),
  'cycle with 3-number points': inst({ cycle: { points: Array.from({ length: 8 }, () => [0, 0, 0]) } }),
  'cycle point out of range': inst({ cycle: { points: pts(8).map((p, i) => (i ? p : [0, 5])) } }),
  'flat 4096-number array in a field': inst({ cycle: { points: big(4096) } }),
  '100000-char title': inst({ title: 'x'.repeat(100000) }),
  '5000-char CSV of numbers as title': inst({ title: Array.from({ length: 1000 }, (_, i) => (i / 1000).toFixed(3)).join(',') }),
  'descriptor key data:audio/wav;base64': inst({ descriptors: { ['data:audio/wav;base64,UklGRiQA']: 'x' } }),
  'descriptor key 100000 chars': inst({ descriptors: { ['k'.repeat(100000)]: 'x' } }),
  '12 descriptor keys of 100000 chars': inst({ descriptors: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i).repeat(100000), 'x'])) }),
  '13 descriptors': inst({ descriptors: Object.fromEntries(Array.from({ length: 13 }, (_, i) => ['d' + i, 1])) }),
  'data:audio in title': inst({ title: 'data:audio/wav;base64,UklGRiQAAABXQVZF' }),
  'data:audio in license': inst({ license: 'data:audio/wav;base64,AAAA' }),
  'data:audio in descriptor value': inst({ descriptors: { note: 'data:audio/wav;base64,AAAA' } }),
  'RIFF header in title': inst({ title: 'RIFF$\u0000\u0000\u0000WAVEfmt ' }),
  'base64 marker mid-string': inst({ title: 'see base64,AAAA' }),
  'zero-width space inside data:': inst({ title: 'data\u200b:audio/wav' }),
  'fullwidth colon in data:': inst({ title: 'data\uff1aaudio/wav' }),
  'long s makes base64 after NFKC': inst({ title: 'ba\u017fe64,AAAA' }),
  'Cyrillic a in data:': inst({ title: 'd\u0430ta:x' }),
  'combining acute': inst({ title: 'e\u0301' }),
  'emoji in title': inst({ title: 'beat \ud83e\udd41' }),
  'CJK title': inst({ title: '\u30c9\u30e9\u30e0' }),
  'Latin ligature IJ (NFKC to ASCII)': inst({ title: '\u0132ata:' }),
  'NUL / control character': inst({ title: 'a\u0000b' }),
  'DaTa: in any case': inst({ title: 'DaTa:x' }),
  'blob: URL in title': inst({ title: 'blob:https://x/1234' }),
  'http URL in descriptor': inst({ descriptors: { src: 'https://example.com/a.wav' } }),
  'license 41 chars': inst({ license: 'L'.repeat(41) }),
  'param name carrying data:': inst({ params: { ['data:x']: { min: 0, max: 1, default: 0 } } }),
  'param key __proto__-style name': JSON.parse('{"instruments":[{"id":"a-wave","family":"test","origin":"drawn","license":"CC0-1.0","cycle":{"points":' + JSON.stringify(pts(8)) + '},"params":{"__proto__":{"min":0,"max":1,"default":0}}}]}'),
  'unknown key constructor': JSON.parse('{"instruments":[{"id":"a-wave","family":"test","origin":"drawn","license":"CC0-1.0","cycle":{"points":' + JSON.stringify(pts(8)) + '},"constructor":1}]}'),
  'unknown top-level field': { instruments: [], notes: 'x' },
  'unknown field in cycle': inst({ cycle: { points: pts(8), samples: [0.1, 0.2] } }),
  'unknown field in a morph frame': inst({ morph: { frames: [{ pos: 0, points: pts(8), pcm: [1] }, { pos: 1, points: pts(8) }] } }),
  'morph with 9 frames': inst({ morph: { frames: Array.from({ length: 9 }, (_, i) => ({ pos: i / 8, points: pts(8) })) } }),
  'env curve slot carrying data:': inst({ env: { amp: { points: [[0, 0, 'data:audio/wav;base64,AAAA'], [1, 0]] } } }),
  'env point with 4 entries': inst({ env: { amp: { points: [[0, 0, 'lin', 1], [1, 0]] } } }),
  '9 registers': inst({ registers: Array.from({ length: 9 }, () => ({ from: 'c2', to: 'c3' })) }),
  '33 instruments': { instruments: Array.from({ length: 33 }, (_, i) => ({ ...base(), id: 'w' + i })) },
  '256 instruments of 256-point curves (the 8.3 MB case)': { instruments: Array.from({ length: 256 }, (_, i) => ({ ...base(), id: 'w' + i, cycle: { points: pts(256) } })) },
  'missing origin': (() => { const d = inst({}); delete d.instruments[0].origin; return d; })(),
  'neither cycle nor morph': (() => { const d = inst({}); delete d.instruments[0].cycle; return d; })(),
  'top level is an array': [],
};
for (const [n, d] of Object.entries(good)) {
  const s = check(d), r = WF.validate(d);
  ok(s && r.length === 0, `good: ${n} accepted by schema (${s}) and validate() (${r.length} errors${r[0] ? ' ' + r[0].code : ''})`);
}
let both = 0;
for (const [n, d] of Object.entries(bad)) {
  const s = check(d), r = WF.validate(d);
  ok(!s && r.length > 0, `bypass rejected by schema (${!s}) and validate() (${r.length > 0 ? r[0].code : 'ACCEPTED'}): ${n}`);
  if (!s && r.length > 0) both++;
}
// semantic rule JSON Schema cannot express (default inside min..max): validate() only, stated as such in the schema description
ok(WF.validate(inst({ params: { a: { min: 0, max: 1, default: 5 } } })).some((e) => e.code === 'E_WF_PARAM'), 'validate()-only rule: param default outside min..max is E_WF_PARAM');
// validate() must reject a document over the byte cap before walking it, and say why
const huge = { instruments: [], pad: 'x'.repeat(6 * 1024 * 1024) };
ok(WF.validate(huge).some((e) => e.code === 'E_WF_SIZE') && !check(huge), 'a 6 MB document is E_WF_SIZE in validate() and rejected by the schema');
// schema-valid ceiling: 32 instruments with every array at its cap and 22-char numbers stays under 5 MB (the stated bound)
const wide = (n) => Array.from({ length: n }, (_, i) => [-0.12345678901234567, 0.12345678901234567]);
const maxInst = (i) => ({ ...base(), id: 'm' + i, cycle: { points: wide(256) }, morph: { frames: Array.from({ length: 8 }, (_, j) => ({ pos: j / 7, points: wide(256) })) }, env: { amp: { points: Array.from({ length: 64 }, () => [0.12345678901234567, 0.12345678901234567, 'lin']) }, pitch: { points: Array.from({ length: 64 }, () => [0.12345678901234567, 0.12345678901234567, 'lin']) }, filter: { points: Array.from({ length: 64 }, () => [0.12345678901234567, 0.12345678901234567, 'lin']) } } });
const ceiling = { instruments: Array.from({ length: 32 }, (_, i) => maxInst(i)) }, bytes = JSON.stringify(ceiling).length;
ok(bytes < 5 * 1024 * 1024 && check(ceiling) && WF.validate(ceiling).length === 0, `the largest schema-valid document is ${(bytes / 1048576).toFixed(2)} MB (< 5 MB) and both accept it`);
console.log(fails ? `${fails} FAILED` : `ALL PASS (${Object.keys(good).length} good, ${both}/${Object.keys(bad).length} bypasses rejected by both)`); process.exit(fails ? 1 : 0);
