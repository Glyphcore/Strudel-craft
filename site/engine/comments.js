// Shared comment masker (issue: comments broke the linter). Standalone ES module, no imports; the site, the CLI and every text pass use it.
// blankComments(src): same length, every comment (// to end of line, /* */) replaced by spaces (newlines kept), so offsets, line numbers, source maps and AST-bound ids
// do not move. Strings, template literals (with nested ${ } code) and regex literals are respected: `//` inside "https://x", `/*` inside a regex or a backtick string is
// not a comment. Every text pass that splits arguments, scans statements or runs a regex over program text works on blankComments(src), never on raw text.
const REGEX_AFTER = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
/* Per-string memo (#176): the per-frame passes (cue reload check, tempo, samples) ask about the same few program texts many times a second; strings are immutable, so the key is the text itself and an edit is a new key. The cached ranges array is shared: callers must not mutate it. */
const memo = (fn) => { const m = new Map(); return (t) => { t = String(t); let v = m.get(t); if (v === undefined) { v = fn(t); m.set(t, v); if (m.size > 12) m.delete(m.keys().next().value); } return v; }; };
export const blankComments = memo(blankComments0);
function blankComments0(src) {
  const t = String(src); const r = commentRanges(t); if (!r.length) return t;
  const o = t.split(''); for (const [a, b] of r) for (let k = a; k < b; k++) if (o[k] !== '\n' && o[k] !== '\r' && o[k] !== '\u2028' && o[k] !== '\u2029') o[k] = ' ';
  return o.join('');
}
/* true when position pos (a caret between characters) sits inside a comment: inside it, or at its end when it is unterminated or a line comment */
export const inComment = (src, pos) => { const t = String(src); return commentRanges(t).some(([a, b]) => pos > a && (pos < b || (pos === b && !(t[a + 1] === '*' && b - a >= 4 && t.slice(a, b).endsWith('*/'))))); };
/* commentRanges(src) -> [[from, to)] of every comment (a line comment ends before its newline; an unterminated block comment runs to the end). */
export const commentRanges = memo((src) => commentRanges0(src));
function commentRanges0(src) {
  const t = String(src); if (!/\/[\/*]/.test(t)) return [];
  const n = t.length; const ranges = []; const blank = (a, b) => { ranges.push([a, b]); };
  let last = ''; let lastWord = ''; const stack = []; // stack: brace depths where a template ${ resumes
  const tpl = (i) => { // from just after a backtick or a closing } of ${ ; returns index after the template end, or after a ${ (pushed)
    while (i < n) { const c = t[i]; if (c === '\\') { i += 2; continue; } if (c === '`') return i + 1; if (c === '$' && t[i + 1] === '{') { stack.push(depth); depth++; return -(i + 2); } i++; }
    return n;
  };
  let depth = 0; let i = 0;
  while (i < n) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') { let e = i; while (e < n && t[e] !== '\n' && t[e] !== '\r' && t[e] !== '\u2028' && t[e] !== '\u2029') e++; blank(i, e); i = e; continue; }
    if (c === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); const z = e < 0 ? n : e + 2; blank(i, z); i = z; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && t[i] !== c && t[i] !== '\n') { if (t[i] === '\\') i++; i++; } i++; last = 'a'; lastWord = ''; continue; }
    if (c === '`') { const r = tpl(i + 1); if (r < 0) { i = -r; last = '{'; lastWord = ''; } else { i = r; last = 'a'; lastWord = ''; } continue; }
    if (c === '/') { // regex literal or division: a regex follows an operator, an opening bracket, a comma, a statement start or a keyword
      if (!last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || REGEX_AFTER.test(lastWord)) {
        let k = i + 1; let cls = false; while (k < n && t[k] !== '\n') { if (t[k] === '\\') k++; else if (t[k] === '[') cls = true; else if (t[k] === ']') cls = false; else if (t[k] === '/' && !cls) break; k++; }
        if (t[k] === '/') { k++; while (k < n && /[a-z]/i.test(t[k])) k++; i = k; last = 'a'; lastWord = ''; continue; }
      }
      last = c; lastWord = ''; i++; continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (stack.length && stack[stack.length - 1] === depth) { stack.pop(); const r = tpl(i + 1); if (r < 0) { i = -r; last = '{'; } else { i = r; last = 'a'; } lastWord = ''; continue; } }
    if (/[\w$]/.test(c)) { let k = i; while (k < n && /[\w$]/.test(t[k])) k++; lastWord = t.slice(i, k); last = 'a'; i = k; continue; }
    if (!/\s/.test(c)) { last = c; lastWord = ''; }
    i++;
  }
  return ranges;
}

