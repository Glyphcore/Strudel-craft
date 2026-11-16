// Comment-torture suite (issue: "Comments break the linter in the code box"). Node only, no browser.
// Every text pass must see comment-blind program text (site/engine/comments.js): the same program with comments inserted everywhere must give
// zero diagnostics, the same compiled code (modulo the comments), the same control ids and literal ids, and the same record length.
// Usage: node tests/site/comments.mjs     (events equality with and without comments is the CLI half: engine/strudel-cli/test/comments_test.mjs in suno-track-lab)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from '../../site/vendor/acorn-8.19.0.mjs';
import { blankComments, commentRanges, inComment } from '../../site/engine/comments.js';
import * as L from '../../site/engine/lanes.js';
import { protect } from '../../site/engine/hooks.js';
import * as B from '../../site/engine/bind.js';
import * as A from '../../site/engine/atoms.js';
import { lanePeriod, arrangeBars } from '../../site/record-length.js';
import { mergeAccept } from '../../site/inline.js';
import { branchContext } from '../../site/lanes-intellisense.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let n = 0; const pass = (m) => { n++; console.log('PASS ' + m); };
const norm = (t) => String(t).replace(/\s+/g, '');
const oracle = (src) => { const cs = []; acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, onComment: (b, t, s, e) => cs.push([s, e]) }); const o = src.split(''); for (const [s, e] of cs) for (let k = s; k < e; k++) if (o[k] !== '\n' && o[k] !== '\r') o[k] = ' '; return o.join(''); };

// ---- 1. the user's program, verbatim ----
const FIX = fs.readFileSync(path.join(HERE, 'fixtures/comment_split_bug.strudel.js'), 'utf8');
{
  const r = L.compile(FIX); assert.deepEqual(r.graph.diagnostics, [], 'fixture: zero diagnostics');
  assert.doesNotThrow(() => L.prepare(FIX)); assert.ok(L.check(FIX).ok);
  const bare = FIX.replace(/ *\/\/[^\n]*/g, '');
  assert.equal(norm(blankComments(r.code)), norm(L.compile(bare).code), 'fixture: compiled code equals the comment-free program');
  assert.equal(blankComments(FIX).length, FIX.length);
  pass('user fixture: zero diagnostics, prepare does not throw, same compiled code as without comments');
}

// ---- 2. torture templates: @@ = comment slot ----
const COMMENTS = ['// plain', '/* block */', '// tap("x") slider(0,1) split(a => a, b => b) .bus(3) ret("r") setcpm(99) $: x:', '/* it\'s "quoted" and `ticked` */', '// don\'t ) ( ] [ } { "', '// https://example.com/a?b=1&c=//d', '/* a */ /* b */', '// unicode: ü 音 \u{1F3B5} ', '/* multi\nline\n tap("y") */', '/* fake end */ ', '// */ tap(', '// <a b c d e f g h> .slow(9) arrange([9, s("x")])'];
const BLOCKS = COMMENTS.filter((c) => c.startsWith('/*') && !c.includes('*/ '.repeat(0)) && c.indexOf('*/') === c.length - 2 || c === '/* a */ /* b */');
const TEMPLATE = [
  'setcpm(120/4)@@',
  '@@',
  'lead: note("c3 e3 g3 <a3 b3>")@b.s("sawtooth")@@',
  '  .lpf(slider(800, 200, 4000))@@',
  '  .gain(@b0.4@b)',
  '  .split(lo => lo.lpf(100),@@',
  '         hi => hi.hpf(100).postgain(0.45)@b) @@',
  'pad: note("c2").s("sine").tap("padtap", { export: true })@@',
  '$: s("bd*2").gain(@bslider(0.5, 0, 1)@b)@@',
  'bass: note("c1").s("square").send("fx", 0.3)@@',
  'fx: ret("fx").lpf(900)@@',
  'const url = "https://x.test/a//b"; const re = /a\\/\\/b/g@b; const t = `tpl // not a comment ${1 /* real comment */ + 1} /* nor this */`@@',
].join('\n');
const fill = (tpl, eol, blk = (i) => '') => { let i = 0; return tpl.replace(/@@|@b/g, (m) => (m === '@@' ? eol(i++) : blk(i++))); };
const BASE = fill(TEMPLATE, () => '');
const pick = (i) => ' ' + COMMENTS[i % COMMENTS.length]; const pickB = (i) => ' ' + BLOCKS[i % BLOCKS.length] + ' ';
const variants = {
  'every slot, line comments at line ends': fill(TEMPLATE, (i) => ' // ' + COMMENTS[i % COMMENTS.length].replace(/^\/\/|^\/\*|\*\/$/g, '').split('\n')[0]),
  'every slot, all comment kinds': fill(TEMPLATE, pick, pickB),
  'CRLF': fill(TEMPLATE, pick, pickB).replace(/\n/g, '\r\n'),
  'EOF without newline': fill(TEMPLATE, pick, pickB) + '\n// last line, no newline',
  'EOF block comment': BASE + '\n/* last */',
  'leading comments': '// first line\n/* second */\n' + BASE,
};
// strings, templates and regex literals keep their "comment-looking" text: slots 11/12 hold code that contains // and /* inside literals
for (const [name, src] of Object.entries(variants)) { if (process.env.DBG) fs.writeFileSync("/home/user/v1.js", src);
  // blanking equals the acorn oracle, keeps length and newlines, is idempotent, keeps strings
  if (!/last line, no newline|last \*\//.test(src) || true) { const b = blankComments(src); assert.equal(b.length, src.length, name); assert.equal(b, oracle(src), name + ': masker equals acorn onComment ranges'); assert.equal(blankComments(b), b); assert.ok(b.includes('"https://x.test/a//b"') && b.includes('/a\\/\\/b/g') && b.includes('tpl // not a comment') && b.includes('/* nor this */'), name + ': literals kept'); }
  const r = L.compile(src); assert.deepEqual(r.graph.diagnostics, [], name + ': lanes diagnostics'); assert.doesNotThrow(() => L.prepare(src), name);
  assert.equal(norm(blankComments(r.code)), norm(blankComments(L.compile(BASE).code)), name + ': compiled code equals the comment-free program');
  assert.deepEqual(JSON.parse(JSON.stringify(L.compile(src).graph)).lanes.map((l) => [l.id, l.taps, l.reads]), L.compile(BASE).graph.lanes.map((l) => [l.id, l.taps, l.reads]), name + ': lane graph');
  // hooks.protect: same output modulo comments (a `tap(` inside a comment starts nothing)
  assert.equal(norm(blankComments(protect(src))), norm(blankComments(protect(BASE))), name + ': protect');
  // control ids and literal ids are stable and the site offsets point at the call
  const s0 = B.sites(BASE); const s1 = B.sites(src); assert.ok(s1.ok, name + ': parses');
  assert.deepEqual(s1.sites.map((s) => [s.path, s.param, s.arg, s.value, s.min, s.max]), s0.sites.map((s) => [s.path, s.param, s.arg, s.value, s.min, s.max]), name + ': control sites');
  for (const s of s1.sites) assert.ok(/^(slider|ctl)\s*\(/.test(src.slice(s.start, s.end)), name + ': site offsets');
  const ids = (code) => { const rr = B.sites(code); return B.reconcile([], rr.sites).map((x) => x.id); };
  assert.deepEqual(ids(src), ids(BASE), name + ': control ids stable');
  assert.deepEqual(B.literals(src).literals.map((x) => [x.path, x.id]), B.literals(BASE).literals.map((x) => [x.path, x.id]), name + ': literal ids stable');
  const rw = B.rewriteMap(src, B.reconcile([], s1.sites)).code; assert.ok(/sliderWithID\('k\w+', 800/.test(rw), name + ': rewrite');
  assert.equal(norm(blankComments(rw)).replace(/sliderWithID\('k\w+',/g, 'slider('), norm(blankComments(BASE)), name + ': rewrite keeps the rest');
  // record length: comment text never contributes a period
  assert.equal(lanePeriod(src), lanePeriod(BASE), name + ': lanePeriod');
  // atoms scan is acorn based
  assert.deepEqual(A.scan(src).decls ?? A.scan(src), A.scan(BASE).decls ?? A.scan(BASE), name + ': atoms scan');
}
pass(`${Object.keys(variants).length} torture variants: masker = acorn, zero diagnostics, same compiled code, protect, control ids, literal ids, lane period, atoms scan`);

// ---- 3. masker unit cases ----
{
  const cases = [['a // b\nc', 'a     \nc'], ['"//x" // y', '"//x"     '], ["'/*' /* z */ q", "'/*'         q"], ['x = /\\/\\// // c', 'x = /\\/\\//     '], ['`a ${ b /* c */ } // d` // e', '`a ${ b         } // d`     '], ['a / b // c / d', 'a / b ' + ' '.repeat(8)], ['f(/*x*/1)/*unterminated', 'f(     1)' + ' '.repeat(14)], ['x\r\n// c\r\ny', 'x\r\n    \r\ny'], ['a // b\u2028c', 'a     \u2028c'], ['', ''], ['no comments', 'no comments']];
  for (const [i, o] of cases) assert.equal(blankComments(i), o, JSON.stringify(i));
  assert.ok(inComment('a // b', 5) && !inComment('a // b\nc', 8) && inComment('a /* b */ c', 6) && !inComment('a /* b */ c', 11) && inComment('/* open', 7) && !inComment('s("//x")', 6), 'inComment');
  assert.equal(commentRanges('a /* x */ // y').length, 2);
  pass('masker unit cases (strings, templates with ${}, regex literals, division, CRLF, unterminated block, inComment)');
}

// ---- 4. editor helpers ----
{
  // mergeAccept: an apostrophe or `.lpf(` in a comment on the line is not code
  const doc = "note(\"c\").lpf(3)  // don't .gain(1) \"x";
  const withC = mergeAccept("note(\"c\").s(\"sa\") // don't use .gain(2)", 17, 'sawtooth', { from: 15 });
  const without = mergeAccept("note(\"c\").s(\"sa\")", 17, 'sawtooth', { from: 15 });
  assert.equal(withC.insert, without.insert, 'mergeAccept ignores comment text'); assert.equal(withC.from, without.from);
  const ghost = mergeAccept('s("a").lpf(300) // it\'s .gain(0.5) here', 15, '.gain(0.5)'); assert.ok(typeof ghost.insert === 'string');
  const ctxB = branchContext('s("a").split(x => x.lpf(1), // it\'s ( "q\n y => y.');
  assert.deepEqual(ctxB && ctxB.call, 'split', 'branchContext survives quotes/parens in comments'); void doc;
  pass('inline.mergeAccept and lanes branchContext ignore comment text');
}

// ---- 5. events with and without comments: the CLI half (engine/strudel-cli/test/comments_test.mjs in suno-track-lab; STRUDEL_CRAFT=<this checkout>) ----

console.log(`\n${n} groups passed`);
