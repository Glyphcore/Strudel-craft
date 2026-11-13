// Lanes L1: the event layer (docs/LANES.md sections 3, 4, 5.4, 8; issue #74). One standalone ES module, no imports, no DOM; the site and
// the CLI share it. Two halves:
//   - pure text: scan(src), compile(src) -> { code, map, graph }, check(src, { strict }), parseSelector(str). Lane graph + diagnostics.
//   - runtime: install(S, hooks, { outer }) adds Pattern.prototype.tags, the globals tagged() and lanes, and applies selections to the
//     haps of the outermost query. Strudel is never modified: public API only, `.tag` is called, not replaced.
// L2 (#75): the audio layer is a text-to-text compile pass (audioPass, prepare): .split / .merge / .send / ret / .wire("p", "bus:name") and group
// tagged().send become plain Strudel on superdough's own buses (bus, busgain, dry, s("bus"), bmod). Nothing here touches superdough; capture is a later phase.

const code = (c, m) => Object.assign(new Error(`${c}: ${m}`), { code: c });
const isObj = (x) => x !== null && typeof x === 'object' && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, sortKeys(x[k])])) : x);

// ---------------- selectors (section 3: sel-or = sel-and { "|" sel-and }; sel-and = sel-not { "&" sel-not }; sel-not = [ "!" ] atom) ----------------
const SELTOK = /\s*(\(|\)|&|\||!|\*|#[\w$.-]+|[A-Za-z_][\w-]*)/y;
export function parseSelector(src) {
  const s = String(src); const toks = []; let i = 0;
  while (i < s.length) { SELTOK.lastIndex = i; const m = SELTOK.exec(s); if (!m) { if (!s.slice(i).trim()) break; throw code('E_BAD_SELECTOR', `cannot parse selector "${s}" at ${i}`); } toks.push(m[1]); i = SELTOK.lastIndex; }
  let k = 0; const bad = () => code('E_BAD_SELECTOR', `cannot parse selector "${s}"`);
  const or = () => { let n = and(); while (toks[k] === '|') { k++; n = { or: [n, and()] }; } return n; };
  const and = () => { let n = not(); while (toks[k] === '&') { k++; n = { and: [n, not()] }; } return n; };
  const not = () => { if (toks[k] === '!') { k++; return { not: not() }; } return atom(); };
  const atom = () => {
    const t = toks[k++]; if (t === undefined) throw bad();
    if (t === '(') { const n = or(); if (toks[k++] !== ')') throw bad(); return n; }
    if (t === '*') return { all: true };
    if (t[0] === '#') return { lane: t.slice(1) };
    if (/^[A-Za-z_]/.test(t)) return { tag: t };
    throw bad();
  };
  if (!toks.length) throw bad();
  const ast = or(); if (k < toks.length) throw bad(); return ast;
}
export function selectorString(n) { // canonical text (fully parenthesised where mixed)
  if (n.all) return '*'; if (n.tag) return n.tag; if (n.lane) return '#' + n.lane; if (n.not) return '!' + selectorString(n.not);
  const j = n.or ? ' | ' : ' & '; const l = n.or || n.and; return '(' + l.map(selectorString).join(j) + ')';
}
export function matcher(ast) {
  const f = (n) => {
    if (n.all) return () => true;
    if (n.tag) return (t) => t.tags.includes(n.tag);
    if (n.lane) return (t) => t.lane === n.lane;
    if (n.not) { const g = f(n.not); return (t) => !g(t); }
    const l = (n.or || n.and).map(f);
    return n.or ? (t) => l.some((g) => g(t)) : (t) => l.every((g) => g(t));
  };
  const g = f(ast); return (hap) => g({ tags: hap.context?.tags || [], lane: hap.context?.lane });
}

// ---------------- text scan ----------------
// Walks JS text once, skipping strings, comments and template literals. Calls cb(i, ch, depth) for every code character.
function walk(src, cb) {
  let depth = 0; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { const st = i; i++; while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++; } i++; if (cb(st, ch, depth, i) === false) return; continue; }
    if ('([{'.includes(ch)) { if (cb(i, ch, depth) === false) return; depth++; i++; continue; }
    if (')]}'.includes(ch)) { depth--; if (cb(i, ch, depth) === false) return; i++; continue; }
    if (cb(i, ch, depth) === false) return; i++;
  }
}
const strLit = (t) => { t = t.trim(); const m = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/s.exec(t); return m ? m[2].replace(/\\(.)/g, '$1') : null; };
function splitArgs(txt) {
  const out = []; let cur = ''; let start = 0;
  walk(txt, (i, ch, d, end) => { if (ch === ',' && d === 0) { out.push(txt.slice(start, i)); start = i + 1; } });
  out.push(txt.slice(start)); return out.map((x) => x.trim()).filter((x) => x !== '');
}
// statements: [{ start, end, text, line }]. A statement ends at `;` or at a newline outside brackets unless the next line continues it.
export function statements(src) {
  const out = []; let start = 0; const lineAt = (p) => src.slice(0, p).split('\n').length;
  const push = (end) => {
    let text = src.slice(start, end); let off = 0; for (;;) { const m = /^\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(text); if (!m) break; text = text.slice(m[0].length); off += m[0].length; } // leading comments belong to no statement
    if (text.trim()) { const lead = text.length - text.trimStart().length; out.push({ start: start + off + lead, end, text: text.trim(), line: lineAt(start + off + lead) }); } start = end;
  };
  const contAfter = (p) => { let j = p; for (;;) { while (j < src.length && /\s/.test(src[j])) j++; if (src[j] === '/' && src[j + 1] === '/') { while (j < src.length && src[j] !== '\n') j++; continue; } if (src[j] === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? src.length : e + 2; continue; } break; } return j < src.length && (/[.?]/.test(src[j]) && !(src[j] === '.' && /\d/.test(src[j + 1] || '')) || /^(\)|\]|\}|&&|\|\||\?\?|[+*%<>=-])/.test(src.slice(j, j + 2))); };
  let lastSig = '';
  walk(src, (i, ch, d, end) => {
    if (d === 0 && ch === ';') { push(i + 1); lastSig = ''; return; }
    if (d === 0 && ch === '\n') { if (lastSig && !/[,+\-*/%&|?:=<>(.]/.test(lastSig) && !contAfter(i)) push(i); return; }
    if (!/\s/.test(ch)) lastSig = end ? ch === '"' || ch === "'" || ch === '`' ? 'a' : ch : ch;
  });
  push(src.length); return out;
}
// method calls `.name(args)` and bare calls `name(args)` inside a text: [{ name, bare, depth, args: [text], at }]
export function calls(text) {
  const out = [];
  walk(text, (i, ch, d) => {
    if (ch !== '(') return; let j = i - 1; while (j >= 0 && /\s/.test(text[j])) j--; let e = j; while (j >= 0 && /[\w$]/.test(text[j])) j--; if (e === j) return;
    const name = text.slice(j + 1, e + 1); let k = j; while (k >= 0 && /\s/.test(text[k])) k--; const bare = text[k] !== '.';
    let depthEnd = null; let close = i; walk(text.slice(i), (p, c, dd) => { if (c === ')' && dd === 0) { close = i + p; return false; } });
    out.push({ name, bare, depth: d, at: j + 1, args: splitArgs(text.slice(i + 1, close)) });
  });
  return out.sort((a, b) => a.at - b.at);
}
// ---------------- audio layer (L2, docs/LANES.md sections 5.1 to 5.4) ----------------
// text helpers: index of the ")" matching the "(" at `open` (strings and comments skipped), depth-0 method calls of an expression, branch arrows.
function matchParen(t, open) { let close = -1; walk(t.slice(open), (p, c, d) => { if (c === ')' && d === 0) { close = open + p; return false; } }); return close; }
function chain(t) {
  const out = []; const re = /\.\s*([A-Za-z_$][\w$]*)\s*\(/y;
  walk(t, (i, ch, d) => { if (ch !== '.' || d !== 0) return; re.lastIndex = i; const m = re.exec(t); if (!m) return; const open = i + m[0].length - 1; const close = matchParen(t, open); if (close < 0) return; out.push({ name: m[1], dot: i, open, close, end: close + 1, args: splitArgs(t.slice(open + 1, close)) }); });
  return out;
}
const mask = (t) => { // same length, strings and comments blanked (newlines kept)
  const o = t.split(''); let i = 0; const blank = (a, b) => { for (let k = a; k < b; k++) if (o[k] !== '\n') o[k] = ' '; };
  while (i < t.length) {
    const ch = t[i];
    if (ch === '/' && t[i + 1] === '/') { const e = t.indexOf('\n', i); const z = e < 0 ? t.length : e; blank(i, z); i = z; continue; }
    if (ch === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); const z = e < 0 ? t.length : e + 2; blank(i, z); i = z; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { const st = i; i++; while (i < t.length && t[i] !== ch) { if (t[i] === '\\') i++; i++; } i++; blank(st + 1, Math.min(i - 1, t.length)); continue; }
    i++;
  }
  return o.join('');
};
const hasArrow = (a) => /=>/.test(mask(a));
function arrow(a) { // `x => x.fx()`: the parameter starts the body and appears nowhere else -> { param, rest }; null otherwise
  const m = /^\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([\s\S]+)$/.exec(a.trim()); if (!m) return null;
  const p = m[1]; const b = m[2].trim(); if (b[0] === '{' || !b.startsWith(p) || /[\w$]/.test(b[p.length] || ' ')) return null;
  const rest = b.slice(p.length); if (new RegExp('(^|[^\\w$.])' + p.replace(/\$/g, '\\$') + '(?![\\w$])').test(mask(rest))) return null; return { param: p, rest };
}
// Bus numbers (section 5.3): split and lane buses from 64 in source order, named buses from 512 in name order. The reader has a 10 ms attack and release and
// gain(1) (docs/LANES.md 12.1: superdough floors a bus sound's release at 10 ms, so 5 ms sums to 1.5x at each seam; measured unity at 10 ms, tests/site/lanes.mjs).
export const BUS = { lane0: 64, named0: 512, fade: 0.01 };
const reader = (k) => `s("bus").n(${k}).attack(${BUS.fade}).release(${BUS.fade}).gain(1)`;
const SOURCE_CTL = new Set(['s', 'sound', 'n', 'note', 'freq', 'midinote', 'bus', 'dry']);
const NONLINEAR = new Set(['shape', 'distort', 'distortion', 'crush', 'coarse', 'compressor', 'squiz', 'waveloss', 'triode', 'krush', 'fold', 'clip']);
export const HARD = ['E_LANE_HOST', 'E_LANE_SOURCE', 'E_LANE_CROSS', 'E_LANE_CYCLE', 'E_BUS_RANGE', 'E_LANE_OPTS']; // errors prepare() throws
const QUICK = /\bsplit\s*\(|\bmerge\s*\(|\bsend\s*\(|\bret\s*\(|bus:|\.\s*bus\s*\(/;
const BODY = /^(?:(?:\$|[A-Za-z_]\w*)\s*:(?!:)|(?:const|let|var)\s+[\w$]+\s*=(?!=))\s*/;

// -> { code, map, diag, audio }. Statements that use none of the audio features are copied byte for byte.
function audioPass(text, g, o = {}) {
  const diag = []; const sts = statements(text); const laneAt = new Map(g.lanes.map((l) => [l.line, l]));
  const add = (level, c, msg, line, extra = {}) => diag.push({ level, code: c, msg, ...(line ? { line } : {}), ...extra });
  const info = sts.map((st) => { const m = BODY.exec(st.text); const off = m ? m[0].length : 0; let body = st.text.slice(off); let semi = ''; if (body.endsWith(';')) { body = body.slice(0, -1); semi = ';'; } return { st, off, body, semi, tagged: /^tagged\s*\(/.test(st.text), lane: laneAt.get(st.line) }; });
  for (const x of info) for (const c of calls(x.st.text)) if (!c.bare && c.name === 'bus') { const v = num(c.args[0] || ''); if (v != null && v >= BUS.lane0) add('error', 'E_BUS_RANGE', `.bus(${v}) is in the range the compiler allocates (>= ${BUS.lane0}); user buses are 0..${BUS.lane0 - 1}`, x.st.line); }
  // group sends: tagged(sel)....send(name, amount) is resolved against the static lane tags and handled like a .send on each matching lane
  const extra = new Map(); const names = new Set();
  for (const x of info) {
    if (!x.tagged) continue; const cs = chain(x.st.text).filter((c) => c.name === 'send'); if (!cs.length) continue;
    const head = calls(x.st.text).find((c) => c.bare && c.name === 'tagged'); let match = null; try { match = matcher(parseSelector(strLit(head?.args[0] || '') ?? '')); } catch (e) { continue; }
    for (const s of cs) {
      const name = strLit(s.args[0] || ''); if (name == null) { add('error', 'E_LANE_OPTS', 'tagged(...).send needs a literal bus name', x.st.line); continue; }
      names.add(name); const hit = g.lanes.filter((l) => match({ context: { tags: l.tags, lane: l.id } }));
      if (!hit.length) add('warn', 'W_LANE_SELECT_EMPTY', `tagged(${head.args[0]}).send("${name}") matches no lane (only literal .tags(...) on a lane's chain and #lane ids are matched at compile time)`, x.st.line);
      for (const l of hit) { if (!extra.has(l.line)) extra.set(l.line, []); extra.get(l.line).push(`.send(${JSON.stringify(name)}, ${s.args[1] || '1'})`); }
    }
  }
  for (const x of info) { if (x.tagged) continue; for (const c of calls(x.body)) { const a0 = strLit(c.args[0] || ''); if (!c.bare && c.name === 'send' && a0 != null) names.add(a0); if (c.bare && c.name === 'ret' && a0 != null) names.add(a0); if (!c.bare && c.name === 'wire' && /^bus:/.test(strLit(c.args[1] || '') || '')) names.add(strLit(c.args[1]).slice(4)); } }
  const NAMED = Object.fromEntries([...names].sort().map((n, i) => [n, BUS.named0 + i])); let next = BUS.lane0; const allocated = [];
  const audio = { buses: { named: NAMED, lane: allocated }, splits: [], sends: [], returns: [], wires: [] }; const lanesOf = [];
  const out = []; const map = []; let pos = 0; let outLen = 0; let changed = false;
  const put = (from, to, t) => { const keep = text.slice(pos, from); map.push({ from: pos, to: outLen, length: keep.length }); out.push(keep, t); outLen += keep.length + t.length; pos = to; changed = true; };
  for (const x of info) {
    const { st } = x; const line = st.line; const lane = x.lane; const stEnd = st.start + st.text.length;
    if (x.tagged) { // the send ops are compiled away; the other ops stay
      const cs = chain(st.text).filter((c) => c.name === 'send');
      if (cs.length) { let t = st.text; for (const c of cs.slice().reverse()) t = t.slice(0, c.dot) + t.slice(c.end); put(st.start, stEnd, chain(t).length ? t : ''); }
      continue;
    }
    let body = x.body; if (extra.has(line)) body += extra.get(line).join('');
    if (!QUICK.test(body)) continue;
    const lid = lane ? lane.id : `L${line}`; const ctx = { line, lid, sends: [], rets: [], err: (c, m) => add('error', c, m, line, { lane: lid }), next: () => { allocated.push(next); return next++; }, splits: [], wireNames: [] };
    let nb = body;
    try {
      nb = rewrite(body, ctx, NAMED, add);
      for (const c of calls(body)) if (c.bare && c.name === 'ret' && strLit(c.args[0] || '') == null) ctx.err('E_LANE_OPTS', 'ret needs a literal bus name');
      nb = nb.replace(/\bret\s*\(\s*(["'])([\w-]+)\1\s*\)/g, (m, q, n) => { ctx.rets.push(n); return reader(NAMED[n]); });
    } catch (e) { if (e.code) { add('error', e.code, e.message.replace(/^E_\w+: /, ''), line, { lane: lid }); nb = body; } else throw e; }
    if (nb === body) continue;
    for (const s of ctx.sends) audio.sends.push({ lane: lid, bus: s.name, amount: s.amount, line });
    for (const r of ctx.rets) audio.returns.push({ lane: lid, bus: r, line });
    for (const s of ctx.splits) audio.splits.push({ lane: lid, line, ...s });
    for (const w of ctx.wireNames) audio.wires.push({ lane: lid, bus: w, line });
    lanesOf.push({ lid, line, rets: ctx.rets, sends: ctx.sends.map((s) => s.name) });
    put(st.start, stEnd, st.text.slice(0, x.off) + nb + x.semi);
  }
  map.push({ from: pos, to: outLen, length: text.length - pos }); out.push(text.slice(pos));
  const featured = audio.splits.length + audio.sends.length + audio.returns.length + audio.wires.length > 0;
  if (featured && o.host && (o.host.busSound === false || o.host.busControl === false)) add('error', 'E_LANE_HOST', `this host's superdough has no ${o.host.busSound === false ? '"bus" sound' : '`bus` control'} (older than 1.3.0); the audio split is refused and is never replaced by .layer`, (audio.splits[0] || audio.sends[0] || audio.returns[0] || audio.wires[0]).line);
  const retNames = new Set([...audio.returns.map((r) => r.bus), ...audio.wires.map((w) => w.bus)]);
  for (const n of [...new Set(audio.sends.map((s) => s.bus))].sort()) if (!retNames.has(n)) add('warn', 'W_BUS_NO_RETURN', `bus "${n}" is sent to but has no ret("${n}") or wire`, audio.sends.find((s) => s.bus === n).line, { bus: n });
  // cycle: a lane that returns bus A and sends to bus B is an edge A -> B
  const edges = new Map(); for (const l of lanesOf) for (const r of l.rets) for (const s of l.sends) { if (!edges.has(r)) edges.set(r, []); edges.get(r).push({ to: s, lane: l }); }
  const state = new Map(); const reported = new Set();
  const dfs = (n, path) => {
    state.set(n, 1);
    for (const e of edges.get(n) || []) {
      if (state.get(e.to) === 1) { if (!reported.has(e.lane.lid)) { reported.add(e.lane.lid); const cyc = [...path.slice(Math.max(0, path.indexOf(e.to))), n, e.to]; add('error', 'E_LANE_CYCLE', `cycle in the send graph: ${cyc.join(' -> ')} (lane "${e.lane.lid}" returns "${n}" and sends to "${e.to}"); Web Audio would mute the loop silently`, e.lane.line, { lane: e.lane.lid }); } }
      else if (!state.has(e.to)) dfs(e.to, [...path, n]);
    }
    state.set(n, 2);
  };
  for (const n of [...edges.keys()].sort()) if (!state.has(n)) dfs(n, []);
  // names published inside a split branch are private to that branch
  const pub = new Set(g.lanes.flatMap((l) => l.taps.map((t) => t.name)));
  for (const l of g.lanes) for (const r of l.reads) {
    const m = TAPRE.exec(r); if (!m || pub.has(m[2])) continue; const owner = g.lanes.find((x) => (x.branchTaps || []).includes(m[2]) && (!m[1] || x.id === m[1]));
    if (!owner || (owner.id === l.id && l.readsIn?.[r])) continue;
    add('error', 'E_LANE_CROSS', `lane "${l.id}" reads "${r}", a tap published inside a split branch of lane "${owner.id}"; branch names are private to their branch (publish it from the lane chain with { export: true } or add a send)`, l.readLine?.[r] || l.line, { lanes: [l.id, owner.id] });
  }
  return { code: changed ? out.join('') : text, map: changed ? map : [{ from: 0, to: 0, length: text.length }], diag, audio: featured ? audio : null };
}

// Rewrites one expression (a lane body). Order: arguments of ordinary calls first (so stack(a.split(f), b) works), .wire to a bus, .send collected, then the first
// .split (with an adjacent .merge) becomes stack(source -> bus, one reader per branch [, merge reader]); branches are rewritten again (nesting).
function rewrite(expr, ctx, NAMED, add) {
  expr = mapArgs(expr, ctx, NAMED, add);
  let cs = chain(expr);
  for (const c of cs.slice().reverse()) if (c.name === 'wire' && /^bus:[\w-]+$/.test(strLit(c.args[1] || '') || '')) { // .wire("lpf", "bus:lfo", { depth: 800 }) -> .bmod({ bus: 512, control: 'lpf', depth: 800 })
    const name = strLit(c.args[1]).slice(4); const p = strLit(c.args[0] || ''); const op = (c.args[2] || '').trim(); const inner = op[0] === '{' ? op.slice(1, op.lastIndexOf('}')).trim() : '';
    ctx.wireNames.push(name);
    expr = expr.slice(0, c.dot) + `.bmod({ bus: ${NAMED[name]}, control: ${p != null ? `'${p}'` : c.args[0]}${inner ? ', ' + inner : ''} })` + expr.slice(c.end);
  }
  cs = chain(expr);
  const sends = cs.filter((c) => c.name === 'send'); const mine = [];
  for (const c of sends.slice().reverse()) { const n = strLit(c.args[0] || ''); if (n == null) ctx.err('E_LANE_OPTS', '.send needs a literal bus name'); else mine.unshift({ name: n, amount: c.args[1] || '1' }); expr = expr.slice(0, c.dot) + expr.slice(c.end); }
  ctx.sends.push(...mine); if (sends.length) cs = chain(expr);
  const si = cs.findIndex((c) => c.name === 'split' && c.args.length && hasArrow(c.args[0]));
  let parts = []; let last = null;
  if (si < 0) { if (cs.some((c) => c.name === 'merge' && (!c.args.length || hasArrow(c.args[0])))) ctx.err('E_LANE_SOURCE', '.merge needs a .split before it'); }
  else {
    const sp = cs[si]; const head = expr.slice(0, sp.dot); const nx = cs[si + 1]; const hasMerge = !!nx && nx.name === 'merge' && expr.slice(sp.end, nx.dot).trim() === '';
    const tail = expr.slice(hasMerge ? nx.end : sp.end); const args = sp.args.slice(); let mix = null; let pre = false;
    if (args.length && /^\{/.test(args[args.length - 1].trim())) {
      const op = args.pop(); const mm = /\bmix\s*:\s*\[([^\]]*)\]/.exec(op); if (mm) mix = splitArgs(mm[1]); const pm = /\bpre\s*:\s*(true|false)/.exec(op); pre = !!pm && pm[1] === 'true';
      if (/[A-Za-z]/.test(op.replace(/\bmix\b|\bpre\b|\btrue\b|\bfalse\b/g, '').replace(/\[[^\]]*\]/g, ''))) ctx.err('E_LANE_OPTS', `split options are { mix: [numbers], pre: boolean }, got ${op.trim()}`);
    }
    if (mix && mix.length !== args.length) ctx.err('E_LANE_OPTS', `mix has ${mix.length} entries for ${args.length} branches`);
    if (!hasMerge && chain(tail).some((c) => c.name === 'split' || c.name === 'merge')) ctx.err('E_LANE_SOURCE', 'a second .split after a split needs a .merge in between, or nest it inside a branch');
    if (!hasMerge) for (const c of chain(tail)) if (NONLINEAR.has(c.name)) add('warn', 'W_LANE_POST_SPLIT', `.${c.name}(...) after .split(...) without .merge is applied to each branch separately, not to the sum; use .merge(m => m.${c.name}(...))`, ctx.line, { lane: ctx.lid });
    const k = ctx.next(); const k2 = hasMerge ? ctx.next() : null; last = hasMerge ? k2 : k;
    parts.push(head.trimEnd() + (pre ? '' : '.dry(0)') + `.bus(${k})`);
    args.forEach((a, i) => {
      const ar = arrow(a); if (!ar) { ctx.err('E_LANE_SOURCE', `branch ${i + 1} must be written x => x.effect(...): an arrow whose body starts with its own parameter and uses it once (got ${a.trim().slice(0, 40)})`); return; }
      branchCheck(ar.rest, i + 1, ctx);
      const post = mix ? `.postgain(${mix[i] ?? 1})` : '';
      parts.push(rewrite(reader(k) + ar.rest + post + (hasMerge ? `.dry(0).bus(${k2})` : tail), ctx, NAMED, add));
    });
    ctx.splits.push({ bus: k, ...(hasMerge ? { merge: k2 } : {}), branches: args.length, ...(mix ? { mix: mix.map((m) => +m) } : {}), ...(pre ? { pre: true } : {}) });
    if (hasMerge) {
      const m0 = nx.args[0]; let rest = '';
      if (m0) { const ar = arrow(m0); if (!ar) ctx.err('E_LANE_SOURCE', `.merge needs x => x.effect(...) (got ${m0.trim().slice(0, 40)})`); else { branchCheck(ar.rest, 'merge', ctx); rest = ar.rest; } }
      parts.push(rewrite(reader(k2) + rest + tail, ctx, NAMED, add));
    }
  }
  if (mine.length) { // sends read the lane's last bus: the split bus, the merge bus, or a lane bus of their own when there is no split
    if (last == null) { last = ctx.next(); parts = [expr + `.bus(${last})`]; }
    for (const s of mine) parts.push(reader(last) + `.dry(0).bus(${NAMED[s.name]}).busgain(${s.amount})`);
  }
  return parts.length ? `stack(\n  ${parts.join(',\n  ')})` : expr;
}
// ordinary calls: rewrite their (non-function) arguments, so audio features inside stack(...), .add(...) etc. are found
function mapArgs(expr, ctx, NAMED, add) {
  if (!QUICK.test(expr)) return expr;
  const me = mask(expr); const depthAt = []; let d0 = 0; for (let i = 0; i < me.length; i++) { depthAt[i] = d0; if ('([{'.includes(me[i])) d0++; else if (')]}'.includes(me[i])) d0--; }
  const skip = new Set(['split', 'merge', 'send', 'wire', 'ret', 'tap', 'tagged', 'tags', 'tag']); const re = /([A-Za-z_$][\w$]*)\s*\(/g; let out = ''; let pos = 0; let m;
  while ((m = re.exec(me))) {
    const open = m.index + m[0].length - 1; if (depthAt[open] !== 0 || m.index < pos || skip.has(m[1])) continue; const close = matchParen(expr, open); if (close < 0) continue;
    const inner = expr.slice(open + 1, close); if (!QUICK.test(inner)) continue;
    const parts = splitArgs(inner); const re2 = parts.map((p) => (hasArrow(p) ? p : rewrite(p, ctx, NAMED, add))); if (re2.every((p, i) => p === parts[i])) continue;
    out += expr.slice(pos, open + 1) + re2.join(', '); pos = close;
  }
  return out + expr.slice(pos);
}
function branchCheck(rest, label, ctx) {
  for (const c of chain(rest)) if (SOURCE_CTL.has(c.name)) ctx.err('E_LANE_SOURCE', `branch ${label} sets .${c.name}(...): a branch receives a bus reader and may only add effects and gating, not change what it is`);
  if (/\bret\s*\(/.test(mask(rest))) ctx.err('E_LANE_CROSS', `ret(...) inside branch ${label}: a return starts a lane and cannot sit inside a split`);
}

const LANE = /^(\$|[A-Za-z_][\w]*)\s*:(?!:)/;
const TAPRE = /^(?:([\w:*-]+)\/)?([A-Za-z][\w-]*)(?::([A-Za-z]\w*))?$/;
const ORBIT_PARAMS = { roomsize: 'roomsize', rsize: 'roomsize', size: 'roomsize', sz: 'roomsize', roomfade: 'roomfade', rfade: 'roomfade', roomlp: 'roomlp', rlp: 'roomlp', roomdim: 'roomdim', rdim: 'roomdim',
  delaytime: 'delaytime', delayt: 'delaytime', dt: 'delaytime', delayfeedback: 'delayfeedback', delayfb: 'delayfeedback', dfb: 'delayfeedback' };
const num = (t) => { const v = strLit(t) ?? t; return /^-?\d+(\.\d+)?$|^-?\.\d+$/.test(String(v).trim()) ? +v : null; };

// -> { lanes, mode, selections, tags }  (the lane graph, section 8; deterministic: source order, sorted sets)
export function scan(src) {
  const sts = statements(String(src)); const lanes = []; const selections = []; let mode = 'open'; let anon = 0;
  for (const st of sts) {
    const m = LANE.exec(st.text);
    if (m && !/^(default|case)\b/.test(st.text)) {
      const label = m[1]; if (label[0] === '_' || label.endsWith('_')) continue; // muted by Strudel
      const body = st.text.slice(m[0].length); const id = label === '$' ? `$${anon++}` : label;
      const cs = calls(body); const lane = { id, label, line: st.line, tags: [], taps: [], reads: [], orbit: 1, fx: {}, _t: body.replace(/\s+/g, '') };
      const brs = []; for (const c of cs) if (!c.bare && (c.name === 'split' || c.name === 'merge') && c.args.some((a) => /=>/.test(a))) { const o = body.indexOf('(', c.at); const e = matchParen(body, o); if (e > o) brs.push([o, e]); }
      const inBranch = (at) => brs.some(([a, b]) => at > a && at < b); const lineOf = (at) => st.line + (body.slice(0, at).match(/\n/g) || []).length;
      for (const c of cs) {
        if (!c.bare && (c.name === 'tags' || c.name === 'tag') && c.depth === 0) for (const a of c.args) { const t = strLit(a); if (t != null && t && !lane.tags.includes(t)) lane.tags.push(t); }
        if (!c.bare && c.name === 'tap') { const n = strLit(c.args[0] || ''); if (n != null) { if (inBranch(c.at)) (lane.branchTaps = lane.branchTaps || []).push(n); else lane.taps.push({ name: n, export: /\bexport\s*:\s*true\b/.test(c.args[1] || '') }); } }
        if (c.bare && c.name === 'tap') { const r = strLit(c.args[0] || ''); if (r != null) { lane.reads.push(r); (lane.readLine = lane.readLine || {})[r] = lineOf(c.at); lane.readsIn = lane.readsIn || {}; if (inBranch(c.at)) lane.readsIn[r] = true; } }
        if (!c.bare && c.name === 'wire') { const r = strLit(c.args[1] || ''); if (r != null) lane.reads.push(r); }
        if (!c.bare && c.depth === 0 && c.name === 'orbit') { const v = num(c.args[0] || ''); if (v != null) lane.orbit = v; }
        if (!c.bare && c.depth === 0) {
          const p = ORBIT_PARAMS[c.name]; if (p) { const v = num(c.args[0] || ''); if (v != null) lane.fx[p] = v; }
          if (c.name === 'room' || c.name === 'delay') { const t = strLit(c.args[0] || ''); const parts = t != null ? t.split(':') : []; if (c.name === 'room' && parts[1] !== undefined && num(parts[1]) != null) lane.fx.roomsize = num(parts[1]); if (c.name === 'delay') { if (parts[1] !== undefined && num(parts[1]) != null) lane.fx.delaytime = num(parts[1]); if (parts[2] !== undefined && num(parts[2]) != null) lane.fx.delayfeedback = num(parts[2]); } }
        }
      }
      lane.tags.sort(); lanes.push(lane); continue;
    }
    if (/^lanes\s*\.\s*closed\s*\(\s*\)/.test(st.text)) { mode = 'closed'; continue; }
    if (/^lanes\s*\.\s*open\s*\(\s*\)/.test(st.text)) { mode = 'open'; continue; }
    if (/^tagged\s*\(/.test(st.text)) {
      const cs = calls(st.text); const head = cs.find((c) => c.bare && c.name === 'tagged'); const sel = head ? strLit(head.args[0] || '') : null;
      selections.push({ selector: sel, line: st.line, ops: cs.filter((c) => !c.bare && c.depth === 0).map((c) => ({ op: c.name, args: c.args })) });
    }
  }
  const tags = [...new Set(lanes.flatMap((l) => l.tags))].sort();
  return { mode, lanes, selections, tags };
}

// ---------------- checks (section 5.4, event-level codes) ----------------
export const EXT = []; // static checks of later layers (lanes-capture.js registers its own): (src, o) -> diagnostics
export function check(src, o = {}) {
  const g = typeof src === 'string' ? scan(src) : src; const diag = []; const add = (level, c, msg, extra = {}) => diag.push({ level, code: c, msg, ...extra });
  const byLabel = new Map(); for (const l of g.lanes) if (l.label !== '$') { if (!byLabel.has(l.label)) byLabel.set(l.label, []); byLabel.get(l.label).push(l); }
  for (const [label, ls] of byLabel) if (ls.length > 1 && ls.some((l) => l._t !== ls[0]._t)) add('error', 'E_LANE_DUP', `lane "${label}" is defined ${ls.length} times (lines ${ls.map((l) => l.line).join(', ')}); Strudel silently keeps the last`, { lanes: [label] });
  const orbits = new Map();
  for (const l of g.lanes) for (const [p, v] of Object.entries(l.fx || {})) { const k = `${l.orbit}|${p}`; if (!orbits.has(k)) orbits.set(k, []); orbits.get(k).push({ id: l.id, v }); }
  for (const [k, e] of [...orbits].sort()) { const vals = new Set(e.map((x) => x.v)); if (e.length > 1 && vals.size > 1) { const [orbit, p] = k.split('|'); add('warn', 'W_LANE_ORBIT_FX', `orbit ${orbit}: ${p} differs between lanes (${e.map((x) => `${x.id}=${x.v}`).join(', ')}); one orbit has one ${p.startsWith('room') ? 'reverb' : 'delay'}`, { lanes: [...new Set(e.map((x) => x.id))], orbit: +orbit, param: p }); } }
  const closed = g.mode === 'closed';
  for (const l of g.lanes) for (const r of l.reads) {
    const m = TAPRE.exec(r); if (!m) continue; const name = m[2]; const qual = m[1];
    const owners = g.lanes.filter((x) => x.id !== l.id && x.taps.some((t) => t.name === name) && (!qual || x.id === qual));
    if (!owners.length || (!qual && l.taps.some((t) => t.name === name))) continue;
    if (owners.some((x) => x.taps.some((t) => t.name === name && t.export))) continue;
    const ow = owners[0].id;
    if (closed) add('error', 'E_LANE_PRIVATE', `lane "${l.id}" reads tap "${r}" of lane "${ow}", which is not exported`, { lanes: [l.id, ow] });
    else add('warn', 'W_LANE_IMPLICIT_EXPORT', `lane "${l.id}" reads tap "${r}" of lane "${ow}", which is not exported (open mode)`, { lanes: [l.id, ow] });
  }
  for (const s of g.selections) { try { parseSelector(s.selector ?? ''); } catch (e) { add('error', 'E_BAD_SELECTOR', e.message.replace(/^E_\w+: /, ''), {}); } }
  for (const d of o.audio || (typeof src === 'string' ? audioPass(src, g, o).diag : [])) diag.push(d);
  if (typeof src === 'string') for (const f of EXT) for (const d of f(src, o) || []) diag.push(d);
  const errors = diag.filter((d) => d.level === 'error'); const warnings = diag.filter((d) => d.level === 'warn');
  return { errors, warnings, ok: !errors.length, fail: errors.length > 0 || (!!o.strict && warnings.length > 0) };
}

// compile pass: finds lanes, taps, tags and selections (L1) and rewrites .split / .merge / .send / ret / .wire("p", "bus:n") / tagged().send to plain Strudel on
// superdough buses (L2). A program that uses none of these comes back byte for byte (identity map). graph is plain data, deterministic for one input;
// graph.audio (splits, sends, returns, wires, named bus numbers) exists only when the program uses an audio feature. o.host = { busSound, busControl } (booleans).
export function compile(src, o = {}) {
  const text = String(src); const g = scan(text); const lanesOnly = g.lanes.map(({ _t, ...l }) => l);
  const au = audioPass(text, g, o);
  const graph = sortKeys({ version: 1, mode: g.mode, lanes: lanesOnly, tags: g.tags, selections: g.selections, diagnostics: [], ...(au.audio ? { audio: au.audio } : {}) });
  const d = check(g, { ...o, audio: au.diag }); graph.diagnostics = d.errors.concat(d.warnings).map((x) => sortKeys(x));
  return { code: au.code, map: au.map, graph };
}
// what the site runs before every evaluation: the compiled code, or a coded throw for the audio errors (HARD). Programs with no audio feature are returned untouched
// without parsing. The other diagnostics stay in graph.diagnostics (and `lanes.diagnostics()` once installed).
export function prepare(src, o = {}) {
  const text = String(src); if (!QUICK.test(text)) return { code: text, graph: null };
  const r = compile(text, o); const bad = r.graph.diagnostics.find((d) => d.level === 'error' && HARD.includes(d.code));
  if (bad) throw Object.assign(code(bad.code, bad.msg + (bad.line ? ` (line ${bad.line})` : '')), { line: bad.line, diagnostics: r.graph.diagnostics });
  return r;
}
export const graphJSON = (src) => JSON.stringify(compile(src).graph, null, 1);

// ---------------- runtime ----------------
// window.<id> named access: the site's <canvas id="lanes"> made `lanes` look taken, so lanes never installed (E_NAME_COLLISION on every load).
// An element reached only through named access is not a binding anyone owns; the global assignment below shadows it (the page reads it by id).
const isNamedElement = (v) => typeof Element !== 'undefined' && v instanceof Element;
let ACTIVE = null; // the installed instance; process-wide wrappers read it, so a second install (tests, hot reload) takes over cleanly
export function install(S, hooks, opts = {}) {
  const { Pattern } = S;
  if (!Pattern || !hooks || !hooks.ext || !hooks.gateAt) throw code('E_BAD_ARG', 'lanes.install needs the Strudel Pattern and the hooks runtime');
  if (hooks.__lanesInstance) { ACTIVE = hooks.__lanesInstance; return hooks.__lanesInstance; }
  const proto = Pattern.prototype; const useGlobal = opts.global !== false;
  if (proto.tags && !proto.tags.__lanes) throw code('E_NAME_COLLISION', 'Pattern.prototype.tags already exists in the loaded Strudel');
  if (useGlobal) for (const n of ['tagged', 'lanes']) if (n in globalThis && !globalThis[n]?.__lanes && !isNamedElement(globalThis[n])) throw code('E_NAME_COLLISION', `global ${n} already exists`);
  const mark = (f) => { f.__lanes = true; return f; };
  const plain = (x) => (x && typeof x === 'object' && typeof x.__pure === 'string' && typeof x.query === 'function' ? x.__pure : x);
  const cyc = (c) => { const [n, d] = String(c).split('/'); return +n / (d ? +d : 1); };
  const sels = []; let n = 0;
  const L = { __lanes: true, version: 1 };

  proto.tags = mark(function tags(...ts) {
    let p = this; for (const t of ts.flat().map(plain)) { if (typeof t !== 'string' || !t) throw code('E_BAD_ARG', 'tags(...) takes non-empty strings'); p = p.tag(t); } return p;
  });

  // ---- selections ----
  const gateOf = (g) => { if (g === undefined || g === null || g === true) return { gate: null, on: true }; if (g === false) return { gate: null, on: false }; const x = plain(g); if (typeof x !== 'string' && !isObj(x)) throw code('E_BAD_GATE', 'mute/solo take a gate string, an object or a boolean'); hooks.parsers.gate(x); return { gate: x, on: true }; };
  class Selection {
    constructor(selector, id) { this.id = id; this.selector = selector; this.ast = parseSelector(selector); this.ops = []; this.__lanes = true; }
    fx(f) { if (typeof f !== 'function') throw code('E_BAD_ARG', 'fx needs a function'); this.ops.push({ op: 'fx', fn: f }); return this; }
    gain(v) { this.ops.push({ op: 'gain', value: plain(v) }); return this; }
    orbit(v) { this.ops.push({ op: 'orbit', value: plain(v) }); return this; }
    mute(g) { const x = gateOf(g); this.ops.push({ op: 'mute', ...(x.gate != null ? { gate: x.gate } : {}), ...(x.on ? {} : { on: false }) }); return this; }
    send() { throw code('E_LANE_COMPILE', 'tagged(...).send(name, amount) is resolved by the compile pass (lanes.prepare); evaluate the program through it'); }
    solo(g) { const x = gateOf(g); this.ops.push({ op: 'solo', ...(x.gate != null ? { gate: x.gate } : {}), ...(x.on ? {} : { on: false }) }); return this; }
  }
  const fnSrc = (f) => f.toString();
  const keyOf = (s) => JSON.stringify([selectorString(s.ast), s.ops.map((o) => (o.op === 'fx' ? ['fx', fnSrc(o.fn)] : [o.op, o.value ?? o.gate ?? null, o.on ?? true]))]);
  const live = () => { const seen = new Set(); return sels.filter((s) => { const k = keyOf(s); if (seen.has(k)) return false; seen.add(k); return true; }); }; // identical statements collapse: re-evaluation is idempotent
  const tagged = mark((selector) => {
    const sel = new Selection(String(plain(selector)), `s${++n}`); if (!hooks.frozen) sels.push(sel); return sel;
  });
  const opFn = (o) => (o.op === 'fx' ? o.fn : o.op === 'gain' ? (x) => x.gain(o.value) : (x) => x.orbit(o.value));
  const journal = () => hooks.journal.filter((e) => e.op === 'sel').map((e, i) => ({ c: cyc(e.cycle), i, id: e.args[0], op: e.args[1], on: e.args[2] })).sort((a, b) => a.c - b.c || a.i - b.i);
  const activeAt = (jr, sel, o, hap, ctrl) => {
    const t = hap.whole ? hap.whole.begin : hap.part.begin; let on = o.on !== false;
    for (const e of jr) { if (e.c > +t + 1e-12) break; if (e.id === sel.id && e.op === o.op) on = !!e.on; }
    if (!on) return false;
    return o.gate == null ? true : hooks.gateAt(o.gate, `${sel.id}.${o.op}`)(t, ctrl);
  };
  const stampLane = (haps, id) => haps.map((h) => (h.context?.lane === id ? h : h.setContext({ ...h.context, lane: id })));
  // ---- audio layer at runtime: the host check, bus allocation of the last compile, and checks on the queried haps (E_LANE_SOURCE, W_LANE_REFRAIN) ----
  let alloc = null; let cdiag = []; const rdiag = []; const rseen = new Set();
  const rnote = (level, c, msg) => { const k = c + '|' + msg; if (rseen.has(k)) return; rseen.add(k); rdiag.push({ level, code: c, msg }); if (hooks.live) console.warn(`[lanes] ${c} ${msg}`); };
  const hostOf = () => { const sm = opts.soundMap || globalThis.soundMap; const P = S.Pattern; return { busSound: sm && typeof sm.get === 'function' && Object.keys(sm.get() || {}).length ? !!sm.get().bus : undefined, busControl: P ? typeof P.prototype.bus === 'function' && typeof P.prototype.busgain === 'function' : undefined }; };
  const cover = (iv, b, e) => { let t = 0; let cur = b; for (const [x, y] of iv.map(([x, y]) => [Math.max(x, b), Math.min(y, e)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0])) { if (y > cur) { t += y - Math.max(x, cur); cur = y; } } return t; };
  function checkAudio(haps, args) {
    const [b, e] = [+args[0], +args[1]]; const feed = new Map(); const rd = new Map(); const iv = (h) => { const w = h.whole || h.part; return [+w.begin, +w.end]; };
    for (const h of haps) {
      const v = h.value; if (!v || typeof v !== 'object') continue; const n = +v.n;
      if (alloc.has(n) && typeof v.s === 'string' && v.s !== 'bus' && (v.bus == null || alloc.has(+v.bus))) rnote('error', 'E_LANE_SOURCE', `a hap reads allocated bus ${n} but its sound is "${v.s}": a branch must not change .s of its reader`);
      if (v.s === 'bus' && alloc.has(n)) { if (v.note !== undefined || v.freq !== undefined) rnote('error', 'E_LANE_SOURCE', `a reader of bus ${n} sets note or freq: a branch must not change what its reader is`); const key = n + '|' + JSON.stringify(v) + '|' + (iv(h)[1] - iv(h)[0]).toFixed(6); if (!rd.has(key)) rd.set(key, { n, iv: [] }); rd.get(key).iv.push(iv(h)); }
      if (v.bus != null && alloc.has(+v.bus)) { const k = +v.bus; if (!feed.has(k)) feed.set(k, []); feed.get(k).push(iv(h)); }
    }
    for (const { n, iv: ivs } of rd.values()) { const f = feed.get(n); if (!f) continue; const total = cover(f, b, e); if (total <= 1e-9) continue; const gap = (total - Math.min(total, cover(ivs, b, e))) / total; if (gap > 1e-6) rnote('warn', 'W_LANE_REFRAIN', `a reader of bus ${n} leaves ${(gap * 100).toFixed(0)}% of the playing source silent in cycles ${b}..${e} (fine for a gate, a surprise otherwise)`); }
  }
  const after = []; const stampers = []; // observers of the outermost query's final haps (lanes-capture.js records live captures); extra reasons to stamp lane ids
  function apply(haps, args) {
    const out = apply0(haps, args); if (after.length) for (const f of after) { try { f(out, args); } catch (err) { /* observers never break playback */ } } return out;
  }
  function apply0(haps, args) {
    if (alloc && alloc.size) { try { checkAudio(haps, args); } catch (err) { /* checks never break playback */ } }
    const list = live(); if (!list.length) return haps;
    const [b, e, ctrl] = args; let out = haps; const jr = journal(); const solos = [];
    for (const sel of list) {
      const match = matcher(sel.ast);
      for (const o of sel.ops) {
        if (o.op === 'fx' || o.op === 'gain' || o.op === 'orbit') {
          const m = out.filter(match); if (!m.length) continue; const rest = out.filter((h) => !match(h));
          const P = new Pattern((st) => m.filter((h) => { const sb = +st.span.begin; const se = +st.span.end; const pb = +h.part.begin; const pe = +h.part.end; return (pb < se && pe > sb) || (sb === se && pb <= sb && sb < pe); }));
          const r = opFn(o)(P); if (!r || typeof r.queryArc !== 'function') throw code('E_BAD_ARG', 'fx function must return a Pattern');
          out = rest.concat(r.queryArc(b, e, ctrl));
        } else if (o.op === 'mute') out = out.filter((h) => !(match(h) && activeAt(jr, sel, o, h, ctrl)));
        else if (o.op === 'solo') solos.push({ sel, o, match });
      }
    }
    if (solos.length) out = out.filter((h) => { const act = solos.filter((s) => activeAt(jr, s.sel, s.o, h, ctrl)); return !act.length || act.some((s) => s.match(h)); });
    return out;
  }

  // lane id on every hap, only while selections exist (a program without selections yields the same haps as before)
  if (!proto.withState.__lanes) {
    proto.withState = mark(function withState(f) {
      const self = this;
      return new Pattern((state) => { const st = f(state); const id = st?.controls?.id; const haps = self.query(st); return id == null || id === state.controls?.id || !ACTIVE || !ACTIVE.stamping() ? haps : stampLane(haps, String(id)); });
    });
  }

  // ---- registry glue ----
  hooks.ext.reset.push(() => { sels.length = 0; n = 0; });
  hooks.ext.toJSON.push((o) => {
    const l = live(); if (!l.length) return;
    o.selections = l.map((s) => ({ id: s.id, selector: selectorString(s.ast), ops: s.ops.map((x) => (x.op === 'fx' ? { op: 'fx', opaque: true, src: fnSrc(x.fn) } : { ...x, ...(x.value && typeof x.value === 'object' ? { value: { opaque: true, src: 'Pattern' } } : {}) })) }));
  });
  hooks.ext.load.push((j, lo = {}) => {
    for (const s of j.selections || []) {
      const sel = new Selection(s.selector, s.id); const m = /^s(\d+)$/.exec(s.id); if (m) n = Math.max(n, +m[1]);
      for (const x of s.ops || []) {
        if (x.op === 'fx') { if (!lo.allowCode) throw code('E_OPAQUE', `selection ${s.id} has an opaque fx function; load with { allowCode: true } to accept it`); sel.ops.push({ op: 'fx', fn: (0, eval)(`(${x.src})`) }); }
        else sel.ops.push({ ...x });
      }
      sels.push(sel);
    }
  });

  Object.assign(L, {
    closed() { hooks.laneMode('closed'); return L; }, open() { hooks.laneMode('open'); return L; }, mode: () => hooks.laneMode(),
    reset() { sels.length = 0; n = 0; return L; }, selections: () => live().map((s) => ({ id: s.id, selector: selectorString(s.ast), ops: s.ops.map((o) => o.op) })),
    stamping: () => live().length > 0 || stampers.some((f) => f()), after, stampers,
    // the compile pass the site runs before every evaluation (docs/LANES.md 8): compiled code, or a coded throw for the audio errors; remembers the bus allocation
    prepare(src, o = {}) {
      alloc = null; cdiag = []; rdiag.length = 0; rseen.clear();
      const r = prepare(src, { host: hostOf(), ...o }); if (r.graph) { cdiag = r.graph.diagnostics; const a = r.graph.audio; if (a) alloc = new Set([...(a.buses.lane || []), ...Object.values(a.buses.named)]); for (const d of cdiag) if (d.level === 'warn' && hooks.live) console.warn(`[lanes] ${d.code} ${d.msg}`); } return r;
    },
    diagnostics: () => cdiag.concat(rdiag).map((d) => ({ ...d })), host: hostOf,
    // live toggle of one op of one selection; journalled so a headless render replays it (docs/LANES.md 4.3)
    set(id, op, on, at) {
      const s = sels.find((x) => x.id === id); if (!s) throw code('E_BAD_ARG', `no selection "${id}"`); if (!s.ops.some((o) => o.op === op)) throw code('E_BAD_ARG', `selection ${id} has no ${op}`);
      hooks.record('sel', [id, op, !!on], at ?? 'next'); return L;
    },
    apply, compile, check, scan, parseSelector, selectorString, BUS,
  });
  if (opts.outer) opts.outer.push(apply);
  else if (!proto.queryArc.__lanesSel) {
    const orig = proto.queryArc; let depth = 0;
    proto.queryArc = mark(function queryArc(...a) { depth++; try { const haps = orig.apply(this, a); return depth > 1 || !ACTIVE ? haps : ACTIVE.apply(haps, a); } finally { depth--; } });
    proto.queryArc.__lanesSel = true;
  }
  if (useGlobal) { globalThis.tagged = tagged; globalThis.lanes = L; }
  hooks.__lanesInstance = L; ACTIVE = L; L.tagged = tagged; return L;
}
