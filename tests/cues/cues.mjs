// CraftCues format + tools (#162): schema validity of the examples, round-trip fuzz (text -> JSON -> text exact), inline //@ extraction on
// torture inputs with the #142 masker, lint rules on a fixture, KB resolver, CLI smoke. Usage: node tests/cues/cues.mjs  (exit 1 on any FAIL)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { execFileSync } from 'node:child_process'; import { createRequire } from 'node:module';
import * as C from '../../site/engine/cues.js'; import { blankComments } from '../../site/engine/comments.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const require = createRequire(import.meta.url);
let fails = 0; const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  -- ' + x : ''}`); };
let Ajv; try { Ajv = require('ajv'); } catch { Ajv = require('/opt/node-tools/node_modules/ajv'); } /* ajv 6 (draft-07 engine; the schema keeps to keywords it shares with 2020-12) */
const SCH = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/craftcues.v1.json'), 'utf8')); delete SCH.$schema;
const ajv = new (Ajv.default || Ajv)({ allErrors: true, validateSchema: false }); const validate = ajv.compile(SCH);
const CLI = path.join(ROOT, 'tools/craftcues/cues.mjs'); const cli = (...a) => execFileSync('node', [CLI, ...a], { encoding: 'utf8', env: { ...process.env, FORM_BANK: '/nonexistent/bank.jsonl' } }); /* the fb- check is about a missing bank */

/* 1. examples: every shipped cue set parses, lints without errors and its JSON validates */
const sets = [...fs.readdirSync(path.join(ROOT, 'docs/tracks'), { recursive: true })].filter((f) => /\.craftcues$/.test(f)).map((f) => path.join(ROOT, 'docs/tracks', f));
for (const f of sets) { const { doc, problems } = C.parse(fs.readFileSync(f, 'utf8')); const j = C.toJSON(doc); const ok = validate(j); const errs = C.lint(doc, { problems }).filter((d) => d.level === 'error');
  check(`${path.relative(ROOT, f)}: ${doc.cues.length} cues, schema-valid, lint 0 errors`, ok && !errs.length && doc.cues.length > 0, ok ? errs.map((e) => e.code).join(',') : ajv.errorsText(validate.errors)); }
check('at least one example cue set is shipped', sets.length >= 1, String(sets.length));

/* 2. round-trip fuzz: 500 random canonical docs, print -> parse -> print exact, JSON equal, schema-valid */
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32); const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['hook', 'enters', '*late*', 'riser', 'a: b', 'x|y', 'café', '808', 'sub-bass', '"quoted"', 'M9', '->', 'pipe\\|esc', '\\|', '\\\\', 'end\\', '\\\\|x', '|lead'];
const time = () => { const a = 1 + Math.floor(rnd() * 80); const r = rnd(); if (r < 0.2) return String(a); if (r < 0.5) return `${a}-${a + Math.floor(rnd() * 8) + 1}`; if (r < 0.7) return `${a}.${1 + Math.floor(rnd() * 4)}-${a + 1}.${1 + Math.floor(rnd() * 4)}`; if (r < 0.8) return `${a}s-${a + 3}.5s`; if (r < 0.9) return '*'; return 'sec:drop-a'; };
const scope = () => pick(['track', 'sec:drop-a', 'bell', 'bell,stab', 'bell->lead', 'lead~ctr', 'kick+sub', 'tag:conf', 'bus:verb']);
let rtOk = 0, rtBad = null, lineBad = 0, lineEx = '';
for (let n = 0; n < 500; n++) {
  const cues = []; const k = 1 + Math.floor(rnd() * 6);
  for (let i = 0; i < k; i++) { const c = { id: `c${n}_${i}`, at: time(), kind: pick(C.KINDS), scope: scope(), body: Array.from({ length: Math.floor(rnd() * 6) }, () => pick(WORDS)).join(' ').trim(), refs: rnd() < 0.5 ? [pick(['MOT-05', 'FS-01', 'hook:cowbell', 'genre:dubstep', 'fb-0123456789abcdef', 'syntax:lanes'])] : [], rel: i && rnd() < 0.4 ? [{ type: pick(C.RELS), target: `c${n}_0` }] : [], meta: rnd() < 0.5 ? { src: pick(C.SOURCES), conf: Math.round(rnd() * 100) / 100, ...(rnd() < 0.3 ? { more: pick(['https://x.test/a b', 'a | b "q"']) } : {}) } : {} };
    if (rnd() < 0.15) { c.pair = time(); if (c.pair === '*') delete c.pair; } if (rnd() < 0.1) c.body += '\nsecond line'; cues.push(c); }
  const doc = C.fromJSON({ header: { track: 't' + n, bars: 84, bpm: 128.8, beats: 4, sections: [{ name: 'drop-a', from: 17, to: 32 }] }, notes: rnd() < 0.3 ? ['a note'] : [], cues });
  const t1 = C.print(doc); const r = C.parse(t1); const t2 = C.print(r.doc); const j1 = JSON.stringify(C.toJSON(doc)), j2 = JSON.stringify(C.toJSON(r.doc));
  if (t1 === t2 && j1 === j2 && !r.problems.length && validate(C.toJSON(r.doc))) rtOk++; else if (!rtBad) { const a = t1.split('\n'), b = t2.split('\n'); const i = a.findIndex((x, k) => x !== b[k]); rtBad = { line: i, a: a[i], b: b[i], p: r.problems, jeq: j1 === j2, dj: (() => { let k = 0; while (j1[k] === j2[k]) k++; return [j1.slice(k - 80, k + 80), j2.slice(k - 80, k + 80)]; })(), v: ajv.errorsText(validate.errors) }; }
  for (const c of r.doc.cues) { const l = C.parseLine(C.printLine(c)); const flat = String(c.body).replace(/\n/g, ' / '); if (!l.cue || l.cue.body !== flat) { lineBad++; if (!lineEx) lineEx = JSON.stringify({ want: flat, got: l.cue && l.cue.body }); } }
}
check('one-line (//@) form: bodies with \\|, \\\\ and bare | round-trip in all 500 sets (escape rule: \\| is a pipe, \\\\ a backslash, other backslashes literal)', lineBad === 0, lineEx);
check('round-trip fuzz: 500 random canonical cue sets, text -> JSON -> text exact and schema-valid', rtOk === 500, rtBad ? JSON.stringify(rtBad).slice(0, 600) : '');
{ let ok = 0; for (const t of ['17-24 motif @bell: hook | MOT-05 | resolves:a conf=0.5 src=author', '17.3-18.1 tension @lead~ctr: rub \\| two | id=x1', '9-12 => 17-24 foreshadow @bell: tease']) { const a = C.parseLine(t).cue; const b = C.parseLine(C.printLine(a)).cue; if (JSON.stringify(a) === JSON.stringify(b)) ok++; } check('one-line form (inline //@) round-trips', ok === 3, String(ok)); }
{ const c = C.parseLine('M9@17 -> M9@49 callback @bell: returns').cue; check('callback sugar M9@17 -> M9@49 normalises to at 17, pair 49, motif M9', c.at === '17' && c.pair === '49' && c.meta.motif === 'M9' && c.kind === 'callback'); }
{ const h = { bpm: 120, beats: 4, bars: 32 }; const s = C.spanOf('17-24', h), b = C.spanOf('17.3-18.1', h), t = C.spanOf('8s-16s', h); check('spans: 17-24 = [17,25), 17.3-18.1 = [17.5,18.25), 8s-16s at 120 bpm = [5,9)', s[0] === 17 && s[1] === 25 && b[0] === 17.5 && b[1] === 18.25 && t[0] === 5 && t[1] === 9, JSON.stringify([s, b, t])); }

/* 3. inline extraction on torture inputs; the masker blanks the cues */
const TORTURE = [
  '// @daw bars=32', 'setcpm(120/4)', 'const u = "https://x.test//@ 1-2 note: not a cue"', "const s = '//@ 3 note: in a string'", 'const t = `//@ 4 note ${"//@ 5"} still template`',
  'const re = /\\/\\/@ 6/g', '/* //@ 7 note: inside a block comment, not a cue block */', 'bell: s("x").gain(0.5) //@ 9-12 motif: bell answers | MOT-01', '//@ 13-16 tension @lead~ctr: rub | TEN-01 | id=rub',
  'lead: note("c d")', '/*@', ' 17-20 release @lead: lands | resolves:rub', ' 21 note: second line of the block', '*/', '\r', 'kick: s("bd") //@ density: four on the floor', 'arrange([4, s("a")], [8, s("b") //@ section: second segment', '])'];
const prog = TORTURE.join('\n'); const ex = C.extract(prog); const got = ex.doc.cues.map((c) => `${c.at}|${c.kind}|${c.scope}`);
const want = ['9-12|motif|bell', '13-16|tension|lead~ctr', '17-20|release|lead', '21|note|track', '*|density|kick', '5-12|section|track'];
check('inline extraction finds exactly the real //@ and /*@ cues (strings, templates, regex, block comments, CRLF ignored)', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
check('inline cue defaults: lane label of the line, arrange segment bars, ids, header from @daw / setcpm', ex.doc.header.bars === 32 && ex.doc.header.bpm === 120 && ex.doc.cues.find((c) => c.id === 'rub') && ex.doc.cues[0]._line === 8);
check('inline relation resolves within the program (lint: no orphan)', !C.lint(ex.doc).some((d) => d.code === 'E_ORPHAN'));
{ const bl = blankComments(prog).split('\n'); const real = [8, 9, 11, 12, 13, 16, 17].every((n) => !/\/\/@|\/\*@|motif|release|density|section:/.test(bl[n - 1])); const kept = [3, 4, 5, 6].every((n) => bl[n - 1] === TORTURE[n - 1]);
  check('the #142 masker blanks every real cue (code sees spaces) and leaves //@ inside strings, templates and regex untouched', real && kept && blankComments(prog).length === prog.length); }
/* critic regressions (#162 review): one line each */
{ const d = C.extract('//@! sections: intro 1-8, drop-a 9-24\n//@ sec:drop-a section: the drop\n').doc.cues[0]; check('inline //@ sec:name keeps its time (no body leak)', d.at === 'sec:drop-a' && d.kind === 'section' && d.body === 'the drop', JSON.stringify([d.at, d.body])); }
{ const r = C.parseLine('M9@17 -> M9@49: body'); check('callback pair accepts a colon right after it (M9@17 -> M9@49: body)', r.cue && r.cue.at === '17' && r.cue.pair === '49' && r.cue.body === 'body' && !r.problems.length, JSON.stringify(r.problems)); }
{ const d = C.extract('const u = "https://x.test/a"\nx: arrange([4, s("a")], [8, s("b") //@ note: seg two\n])\n').doc.cues[0]; check('arrange default times survive // inside a string (masker, not a regex)', d && d.at === '5-12', d && d.at); }
{ const c = C.parseLine('17 note: x | more="a | b" src=author').cue; const b = C.parseLine(C.printLine({ ...c, id: 'z' })).cue; check('a quoted meta value containing | round-trips', c.meta.more === 'a | b' && b.meta.more === 'a | b' && b.meta.src === 'author', JSON.stringify(b.meta)); }

/* 4. lint rules */
const FIX = `CRAFTCUES 1\nbars: 32\nbpm: 120\nsections: a 1-16, b 17-32\n\ns1\n1-16 section @track: a\n\ns2\n12-20 section @track: overlaps a\n\nt\n5-8 tension @bell: up\n\nr\n6-9 release @bell: down | resolves:t\n\nlong\n3 note @track: ${'x'.repeat(150)}\n\nout\n30-40 note @track: past the end\n\norph\n2 note @track: who | echoes:nobody | ZZZ-99\n\ns1\n4 note @track: duplicate id\n`;
{ const r = C.parse(FIX); const ds = C.lint(r.doc, { problems: r.problems, kb: (id) => ({ status: /^ZZZ/.test(id) ? 'unknown' : 'resolved' }) }); const codes = new Set(ds.map((d) => d.code));
  for (const c of ['W_OVERLAP', 'W_CONFLICT', 'W_LONG', 'W_OUTSIDE', 'E_ORPHAN', 'W_KB', 'E_DUP_ID']) check(`lint reports ${c}`, codes.has(c), [...codes].join(',')); }
{ const r = C.parse('not a cue file\n'); check('lint/parse: a missing CRAFTCUES magic line is an error', r.problems.some((p) => p.code === 'E_MAGIC')); }

/* 5. KB resolver (Node: composition, syntax, packs, genres, form bank tolerated) */
{ const out = JSON.parse('[' + cli('kb', 'MOT-05', 'FS-01', 'syntax:lanes', 'hook:cowbell', 'genre:dubstep', 'fb-0123456789abcdef', '--json').trim().split('\n').join(',') + ']');
  const by = Object.fromEntries(out.map((c) => [c.id, c])); check('KB: MOT-05, FS-01, syntax:lanes, hook:cowbell, genre:dubstep resolve with title and link', ['MOT-05', 'FS-01', 'syntax:lanes', 'hook:cowbell', 'genre:dubstep'].every((i) => by[i].status === 'resolved' && by[i].title && by[i].link), JSON.stringify(out.map((c) => c.status)));
  check('KB: deep links #syntax=mot-05 / #res=hook:cowbell', by['MOT-05'].link === '#syntax=mot-05' && by['hook:cowbell'].link === '#res=hook:cowbell');
  check('KB: fb- id without a bank is not-loaded (tolerated, not unknown)', by['fb-0123456789abcdef'].status === 'not-loaded'); }

/* 6. CLI smoke: vtt / srt / merge / extract */
{ const f = sets[0]; const v = cli('vtt', f); const s = cli('srt', f); check('CLI vtt: WEBVTT header, cue timings HH:MM:SS.mmm --> HH:MM:SS.mmm', /^WEBVTT/.test(v) && /\n\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\n/.test(v));
  check('CLI srt: numbered cues with comma milliseconds', /^1\n\d\d:\d\d:\d\d,\d{3} --> /.test(s));
  const tmp = path.join(ROOT, 'tests/cues/.tmp.craftcues'); fs.writeFileSync(tmp, 'CRAFTCUES 1\n\nintro\n1-4 note @track: replaced by analysis? no | src=inferred\n\nnew1\n2 note @track: generated | src=inferred\n');
  const m = C.parse(cli('merge', f, tmp)).doc; fs.unlinkSync(tmp); const base = C.parse(fs.readFileSync(f, 'utf8')).doc;
  check('CLI merge: authored wins by id, new generated ids are added', m.cues.length === base.cues.length + 1 && m.cues.find((c) => c.id === 'intro').meta.src === 'author'); }
/* from-bank usability: one source by default, inferred/analysed deduped, sha prefix (>= 8 hex), licence/author/sha in meta */
{ const R = (id, sha, bars, method, conf) => ({ id, confidence: conf, labels: { form_role: 'drop' }, method, picked: { bars, stage: 'section' }, evidence: [], source: { ref: { sha256: sha, licence: 'Artistic 2.0', author: 'A B' } } });
  const A = 'a'.repeat(64), B = 'b'.repeat(64), recs = [R('fb-0000000000000001', A, [1, 8], 'inferred-from-project-data', 0.5), R('fb-0000000000000002', A, [1, 8], 'project-rendered-then-analysed', 0.55), R('fb-0000000000000003', A, [9, 16], 'inferred-from-project-data', 0.5), R('fb-0000000000000004', B, [1, 8], 'inferred-from-project-data', 0.5)];
  const d = C.fromBank(recs); check('from-bank: defaults to one source (the largest) and dedupes inferred vs analysed per section (analysis wins)', d.cues.length === 2 && d.cues.every((c) => c.meta.sha === 'aaaaaaaaaaaa') && d.cues.some((c) => c.meta.src === 'analysis' && c.at === '1-8'), JSON.stringify(d.cues.map((c) => [c.at, c.meta.src])));
  check('from-bank: licence, author and sha ride in the cue meta and survive print/parse', C.parse(C.print(d)).doc.cues.every((c) => c.meta.licence === 'Artistic 2.0' && c.meta.author === 'A B' && c.meta.sha === 'aaaaaaaaaaaa'));
  check('from-bank: --source-sha takes a prefix (>= 8 hex), --all keeps every source', C.fromBank(recs, { source: 'bbbbbbbb' }).cues.length === 1 && C.fromBank(recs, { all: true }).cues.length === 3);
  let err = ''; try { C.fromBank(recs, { source: 'bbbb' }); } catch (e) { err = e.message; } check('from-bank: a sha prefix shorter than 8 hex is refused (E_SHA_PREFIX)', /E_SHA_PREFIX/.test(err), err); }
console.log(fails ? `${fails} FAIL` : 'all PASS'); process.exit(fails ? 1 : 0);
