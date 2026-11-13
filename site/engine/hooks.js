// Hooks runtime (docs/HOOKS_SYNTAX.md sections 3-6, 9; issues #47 core, #48 taps/variables/decorators).
// One standalone ES module, no imports. The host hands over Strudel's public Pattern API:
//   const { hooks, tap } = install({ Pattern, stack, silence, reify, signal, Fraction })
// Strudel is never modified: we only add methods to Pattern.prototype (use, wrap, ns, tap, wire) after a collision check.
// hooks.live = false (default, headless): API errors throw. hooks.live = true: the query path never throws, failing slots
// bypass and failing taps yield their default (one diag entry + console line per code and message).

const code = (c, m) => Object.assign(new Error(`${c}: ${m}`), { code: c });
const isObj = (x) => x !== null && typeof x === 'object' && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, sortKeys(x[k])])) : x);
const GATEKEYS = ['from', 'until', 'windows', 'period', 'when', 'latch', 'quant', 'unreached', 'scanLimit'];
const NUMRE = '\\d+(?:\\.\\d+)?(?:/\\d+)?';
const TAPREF = /^(?:((?:[\w-]+:)?[\w*-]+)\/)?([A-Za-z][\w-]*)(?::([A-Za-z]\w*))?$/;
const METHODS = ['use', 'wrap', 'ns', 'tap', 'wire'];

// Rewrite double-quoted string literals that sit directly in the argument list of hooks.*(...), .use/.wrap/.ns/.tap/.wire(...) and
// tap(...) into single-quoted ones, so Strudel's transpiler does not turn gates ("@3b"), hook expressions ("a | b") or slot names
// into mini-notation. Strings inside nested calls (s("bd*4") inside a wrap callback) are left alone.
export function protect(src) {
  const re = /(?:\bhooks\s*\.\s*[A-Za-z]+|\.\s*(?:use|wrap|ns|tap|wire)|\btap|\bctl)\s*\(/g; const edits = new Map(); let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length; let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (ch === '"' || ch === "'" || ch === '`') {
        const st = i; i++; while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++; }
        if (ch === '"' && depth === 1) edits.set(st, i);
        i++; continue;
      }
      if (ch === '(') depth++; else if (ch === ')') depth--;
      i++;
    }
  }
  let out = src;
  for (const [st, en] of [...edits].sort((a, b) => b[0] - a[0])) { const body = out.slice(st + 1, en).replace(/\\"/g, '"').replace(/'/g, "\\'"); out = out.slice(0, st) + "'" + body + "'" + out.slice(en + 1); }
  return out;
}

export function install(S, opts = {}) {
  const { Pattern, stack, silence, reify, signal, Fraction } = S;
  const miniP = (str) => { const m = S.mini || globalThis.mini; return m ? m(str) : reify(str); }; // plain strings are not mini-notation in Strudel until parsed
  if (!Pattern || !signal || !reify || !stack || !Fraction) throw code('E_BAD_ARG', 'install needs { Pattern, stack, silence, reify, signal, Fraction }');
  const proto = Pattern.prototype;
  for (const m of METHODS) if (proto[m] && !proto[m].__hooks) throw code('E_NAME_COLLISION', `Pattern.prototype.${m} already exists in the loaded Strudel`);
  const useGlobal = opts.global !== false;
  if (useGlobal) for (const g of ['hooks', 'tap']) if (g in globalThis && !globalThis[g]?.__hooks) throw code('E_NAME_COLLISION', `global ${g} already exists`);

  const isFr = (x) => x !== null && typeof x === 'object' && typeof x.compare === 'function' && 'd' in x; // Strudel's Fraction is a factory: Fraction(n)
  const F = (x) => (isFr(x) ? x : Fraction(x));
  const F0 = F(0);
  const frStr = (f) => { const g = F(f); const n = g.s * g.n; return String(g.d) === '1' ? String(n) : `${n}/${g.d}`; };
  const hooks = { cpb: 1, bpb: 4, cps: undefined, horizon: undefined, live: false, position: undefined, scanLimit: 256, ranges: opts.ranges, canon: opts.canon, journal: [], __hooks: true, version: 1 };

  // ---------------- registry state ----------------
  const R = {};
  const diag = []; const seen = new Set();
  const memo = new Map(); const built = new WeakMap(); const astCache = new Map();
  let frozen = false; let version = 0; let effCache = null; let bid = 0; let seq = 0; let sid = 0; const active = new Set();
  function clear() { R.markers = new Map(); R.scopes = new Map(); R.slots = new Map(); R.declared = new Set(); R.defs = new Map(); R.bindings = []; R.vars = new Map(); R.sets = []; R.wires = []; R.taps = new Map(); R.reads = new Set(); }
  clear();
  const touch = () => { version++; memo.clear(); effCache = null; };
  const note = (level, c, msg) => { const k = c + '|' + msg; if (seen.has(k)) return; seen.add(k); diag.push({ level, code: c, msg }); if (hooks.live) console.warn(`[hooks] ${c} ${msg}`); };
  const fail = (c, msg) => { note('error', c, msg); if (!hooks.live) throw code(c, msg); return null; };

  // ---------------- points and gates ----------------
  const pctx = (cps = hooks.cps) => ({ cpb: hooks.cpb, bpb: hooks.bpb, cps, markers: R.markers });
  const bad = (s) => code('E_BAD_GATE', `cannot parse point "${s}"`);
  function unitVal(n, u, c, offset) {
    if (u === 'b') return offset ? n.mul(c.cpb) : n.sub(1).mul(c.cpb);
    if (u === 's') { if (!c.cps) throw code('E_NO_CPS', 'seconds need a known cps'); return n.mul(F(c.cps)); }
    return n;
  }
  // -> Fraction (cycles) or null when a marker is unresolved
  function parsePoint(raw, c, d = 0) {
    if (typeof raw === 'number') { if (raw < 0) throw bad(raw); return F(raw); }
    if (isFr(raw)) return raw;
    const s = String(raw).trim(); if (!s || d > 8) throw bad(s);
    if (c.markers.has(s)) return parsePoint(c.markers.get(s), c, d + 1);
    let m; let base; let rest = '';
    if ((m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) { if (!c.cps) throw code('E_NO_CPS', 'seconds need a known cps'); return F(String(+m[1] * 60 + +m[2])).mul(F(c.cps)); }
    if ((m = /^(\d+)\.(\d+)b(.*)$/.exec(s))) { const bar = +m[1]; const beat = +m[2]; if (bar < 1 || beat < 1 || beat > c.bpb) throw bad(s); base = F(bar - 1).add(F(beat - 1).div(c.bpb)).mul(c.cpb); rest = m[3]; }
    else if ((m = new RegExp(`^(${NUMRE})([cbs]?)(.*)$`).exec(s))) { const n = F(m[1]); if (m[2] === 'b' && n.compare(1) < 0) throw bad(s); base = unitVal(n, m[2], c, false); rest = m[3]; }
    else if ((m = /^([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(s))) { if (!c.markers.has(m[1])) return null; base = parsePoint(c.markers.get(m[1]), c, d + 1); if (base === null) return null; rest = m[2]; }
    else throw bad(s);
    if (rest) { const o = new RegExp(`^([+-])(${NUMRE})([cbs]?)$`).exec(rest); if (!o) throw bad(s); const off = unitVal(F(o[2]), o[3], c, true); base = o[1] === '+' ? base.add(off) : base.sub(off); }
    if (base.compare(0) < 0) throw code('E_BAD_GATE', `negative point "${s}"`);
    return base;
  }
  const lenCycles = (v, cps) => { // length in cycles: number, "2c", "0.5s" (needs cps)
    if (typeof v === 'number') return v;
    const m = /^([\d.]+)([cs]?)$/.exec(String(v).trim()); if (!m) throw code('E_BAD_ARG', `bad length "${v}"`);
    if (m[2] === 's') { if (!cps) throw code('E_NO_CPS', 'seconds need a known cps'); return +m[1] * cps; }
    return +m[1];
  };
  function gateFromString(s) {
    const wins = s.split(',').map((x) => x.trim()).map((w) => {
      if (!w) throw code('E_BAD_GATE', `empty window in "${s}"`);
      if (w === '*') return [null, null];
      if (w[0] === '@') return [w.slice(1).trim(), null];
      if (w[0] === '<') return [null, w.slice(1).trim()];
      const i = w.indexOf('..'); if (i < 0) throw code('E_BAD_GATE', `unparsable gate "${s}"`);
      const a = w.slice(0, i).trim(); const z = w.slice(i + 2).trim(); if (!a && !z) throw code('E_BAD_GATE', `unparsable gate "${s}"`);
      return [a || null, z || null];
    });
    if (wins.length === 1) { const [a, z] = wins[0]; const o = {}; if (a != null) o.from = a; if (z != null) o.until = z; return o; }
    return { windows: wins.map(([a, z]) => [a ?? '0', z]) };
  }
  function checkGate(o) {
    const pc = pctx(); const P = (p) => { try { return parsePoint(p, pc); } catch (e) { if (e.code === 'E_NO_CPS') return null; throw e; } };
    const pair = (a, z) => { const x = a == null ? F0 : P(a); const y = z == null ? null : P(z); if (x && y && y.compare(x) <= 0) throw code('E_BAD_GATE', `until <= from (${a ?? 0} .. ${z})`); };
    if (o.windows) { if (!Array.isArray(o.windows) || o.windows.some((w) => !Array.isArray(w))) throw code('E_BAD_GATE', 'windows must be [[from, until], ...]'); o.windows.forEach(([a, z]) => pair(a, z)); }
    else pair(o.from, o.until);
    if (o.period != null && !(lenCycles(o.period, hooks.cps || 1) > 0)) throw code('E_BAD_GATE', 'period must be > 0');
    if (o.unreached != null && !['else', 'open', 'error'].includes(o.unreached)) P(o.unreached);
  }
  function normGate(g) {
    if (g == null || g === '*') return {};
    let o;
    if (typeof g === 'string') o = gateFromString(g);
    else if (isObj(g)) { o = {}; for (const k of Object.keys(g)) { if (!GATEKEYS.includes(k)) throw code('E_BAD_GATE', `unknown gate key "${k}"`); if (g[k] !== undefined) o[k] = g[k]; } }
    else if (g && typeof g.query === 'function') o = { when: g };
    else throw code('E_BAD_GATE', 'gate must be a string or an object');
    checkGate(o); return o;
  }

  // ---------------- conditions ----------------
  const truthy = (v) => (typeof v === 'string' ? !['', '0', 'false', '~'].includes(v) : typeof v === 'object' && v !== null ? true : !!v);
  const whenCache = new WeakMap();
  function whenPattern(w) {
    if (w && typeof w.query === 'function') return w;
    if (typeof w === 'string') { const m = TAPREF.exec(w); if (m && (m[3] || R.vars.has(m[2]) || R.taps.has(m[2]))) return makeTap(w); return miniP(w); }
    return reify(w);
  }
  function condAt(when, t, cx) {
    if (when && typeof when === 'object' && typeof when.valueAt === 'function') return truthy(when.valueAt(+t));
    return whenPattern(when).queryArc(t, t, cx.cps ? { _cps: cx.cps } : {}).some((h) => truthy(h.value));
  }
  const cxOf = (ctrl) => ({ cps: hooks.cps ?? ctrl?._cps, H: hooks.horizon != null ? F(hooks.horizon) : null });

  // entry: { id?, gate, closes?, quant? } -> { open(t), edges(b, e), startAt(t), never, wins }
  function compileGate(entry, cx) {
    const key = entry.id ? `${entry.id}|${cx.cps}|${cx.H}|${entry.quant}|${hooks.scanLimit}` : null;
    if (key && memo.has(key)) return memo.get(key);
    const c = buildGate(entry, cx); if (key) memo.set(key, c); return c;
  }
  function buildGate(entry, cx) {
    const g = entry.gate || {}; const pc = pctx(cx.cps);
    const q = g.quant !== undefined ? F(g.quant) : F(entry.quant ?? 1);
    const qz = (x) => (q.compare(0) > 0 ? x.div(q).ceil().mul(q) : x);
    const sq = q.compare(0) > 0 ? q : F(1);
    let unresolved = false;
    const P = (p) => { const r = parsePoint(p, pc); if (r === null) { unresolved = true; return F0; } return r; };
    let wins = g.windows ? g.windows.map(([a, z]) => [P(a ?? 0), z == null ? null : P(z)]) : [[g.from == null ? F0 : P(g.from), g.until == null ? null : P(g.until)]];
    wins = wins.map(([a, z]) => [qz(a), z && qz(z)]);
    let cap = null;
    for (const cl of entry.closes || []) { const x = qz(P(cl)); if (cap === null || x.compare(cap) < 0) cap = x; }
    const clip = (ws) => (cap ? ws.map(([a, z]) => [a, !z || z.compare(cap) > 0 ? cap : z]) : ws).filter(([a, z]) => !z || a.compare(z) < 0);
    wins = clip(wins);
    const period = g.period != null ? F(lenCycles(g.period, cx.cps)) : null;
    const inWins = (ws, t) => ws.some(([a, z]) => t.compare(a) >= 0 && (!z || t.compare(z) < 0));
    const c = { q: sq, wins, period, cap, when: g.when, latch: !!g.latch, never: false, id: entry.id };
    const periodic = (t) => { if (!period || !c.wins.length) return t; const w0 = c.wins[0][0]; return t.compare(w0) < 0 ? null : w0.add(t.sub(w0).mod(period)); };
    let reach = !unresolved && wins.length > 0;
    if (reach && cx.H) reach = wins.some(([a]) => a.compare(cx.H) < 0);
    if (reach && g.when != null) {
      const lim = (from) => { const l = from.add(hooks.scanLimit); return cx.H && cx.H.compare(l) < 0 ? cx.H : l; };
      if (c.latch) {
        const a0 = wins[0][0]; const end = lim(a0); let found = null;
        for (let t = a0; t.compare(end) < 0; t = t.add(sq)) if (inWins(wins, t) && condAt(g.when, t, cx)) { found = t; break; }
        if (found) c.wins = [[found, wins[0][1]]]; else reach = false;
      } else if (cx.H) {
        const end = lim(wins[0][0]); let any = false;
        for (let t = wins[0][0]; t.compare(end) < 0 && !any; t = t.add(sq)) if (inWins(wins, t) && condAt(g.when, t, cx)) any = true;
        reach = any;
      }
    }
    if (!reach) {
      const policy = g.unreached ?? 'else'; const label = entry.label || entry.id || 'gate';
      if (!cx.H) c.never = true;
      else if (policy === 'error') { c.never = true; fail('E_GATE_UNREACHED', `${label} never opens inside the ${frStr(cx.H)}-cycle horizon`); }
      else if (policy === 'open') { c.wins = clip([[F0, null]]); c.when = null; c.latch = false; c.period = null; if (!c.wins.length) c.never = true; }
      else if (policy === 'else') { c.never = true; note('warn', 'W_GATE_UNREACHED', `${label} never opens inside the ${frStr(cx.H)}-cycle horizon (closed behaviour kept)`); }
      else { c.wins = clip([[qz(P(policy)), g.until == null ? null : qz(P(g.until))]]); c.when = null; c.latch = false; c.period = null; if (!c.wins.length) c.never = true; }
    }
    c.open = (t) => {
      if (c.never) return false;
      if (c.cap && t.compare(c.cap) >= 0) return false;
      const tt = c.period ? periodic(t) : t; if (tt === null) return false;
      if (!inWins(c.wins, tt)) return false;
      if (c.when != null && !c.latch) return condAt(c.when, c.q.compare(0) > 0 ? t.div(c.q).floor().mul(c.q) : t, cx);
      return true;
    };
    c.startAt = (t) => {
      if (!c.wins.length) return F0;
      let off = F0; let tt = t;
      if (c.period) { const w0 = c.wins[0][0]; if (t.compare(w0) >= 0) { off = c.period.mul(t.sub(w0).div(c.period).floor()); tt = t.sub(off); } }
      const w = c.wins.find(([a, z]) => tt.compare(a) >= 0 && (!z || tt.compare(z) < 0));
      return (w ? w[0] : c.wins[0][0]).add(off);
    };
    c.edges = (b, e) => {
      const out = []; if (c.never) return out;
      const push = (x) => { if (x.compare(b) > 0 && x.compare(e) < 0) out.push(x); };
      if (c.cap) push(c.cap);
      if (c.period && c.wins.length && c.period.compare(0) > 0) {
        const w0 = c.wins[0][0]; const k0 = Math.max(0, +b.sub(w0).div(c.period).floor());
        for (let k = k0; k < k0 + 100000; k++) { const off = c.period.mul(k); if (w0.add(off).compare(e) >= 0) break; for (const [a, z] of c.wins) { push(a.add(off)); if (z) push(z.add(off)); } }
      } else for (const [a, z] of c.wins) { push(a); if (z) push(z); }
      if (c.when != null && !c.latch) for (let x = b.div(c.q).ceil().mul(c.q); x.compare(e) < 0; x = x.add(c.q)) push(x);
      return out;
    };
    return c;
  }
  function cutSpan(span, cuts) {
    const seenC = new Map(); for (const x of cuts) if (x.compare(span.begin) > 0 && x.compare(span.end) < 0) seenC.set(frStr(x), x);
    const pts = [span.begin, ...[...seenC.values()].sort((a, b) => a.compare(b)), span.end]; const T = span.constructor; const out = [];
    for (let i = 0; i + 1 < pts.length; i++) out.push(new T(pts[i], pts[i + 1]));
    return out;
  }

  // ---------------- hook expressions ----------------
  function parseExpr(src) {
    if (astCache.has(src)) return astCache.get(src);
    let i = 0; const err = () => code('E_BAD_ARG', `bad hook expression "${src}" at ${i}`);
    const ws = () => { while (src[i] === ' ') i++; };
    function arg(txt) {
      txt = txt.trim(); let m;
      if ((m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(txt))) return { k: m[1], v: scalar(m[2].trim()) };
      return { v: scalar(txt) };
    }
    function scalar(t) { if (/^-?\d+(\.\d+)?$/.test(t)) return +t; if (/^(['"]).*\1$/.test(t)) return t.slice(1, -1); return t; }
    function term() {
      ws(); const m = /^[A-Za-z_][\w-]*/.exec(src.slice(i)); if (!m) throw err();
      const name = m[0]; i += name.length; ws(); const t = { name, args: [], named: {}, deco: null, innerSrc: null };
      if (src[i] === '(') {
        i++; let depth = 0; let cur = ''; let q = null; const parts = [];
        for (; i < src.length; i++) {
          const ch = src[i];
          if (q) { cur += ch; if (ch === q) q = null; continue; }
          if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
          if (ch === '(') depth++;
          if (ch === ')') { if (depth === 0) break; depth--; }
          if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
          cur += ch;
        }
        if (src[i] !== ')') throw err(); i++; if (cur.trim() || parts.length) parts.push(cur);
        for (const p of parts) { const a = arg(p); if (a.k) t.named[a.k] = a.v; else t.args.push(a.v); }
        ws();
      }
      if (src[i] === '[') { i++; const st = i; t.deco = pipe(); t.innerSrc = src.slice(st, i).trim(); ws(); if (src[i] !== ']') throw err(); i++; }
      return t;
    }
    function pipe() { const terms = [term()]; ws(); while (src[i] === '|') { i++; terms.push(term()); ws(); } return { terms }; }
    const ast = pipe(); ws(); if (i < src.length) throw err();
    astCache.set(src, ast); return ast;
  }
  const BUILTIN = new Set(['every', 'mix', 'gated', 'sometimes', 'ns', 'tapped', 'with']);
  function namesOf(spec, out = new Set()) {
    if (typeof spec !== 'string') return out;
    const walk = (ast) => { for (const t of ast.terms) { if (!(t.deco && BUILTIN.has(t.name) && !R.defs.has(t.name))) out.add(t.name); if (t.deco) walk(t.deco); } };
    walk(parseExpr(spec)); return out;
  }
  const ident = (p) => p;
  function evalExpr(src, vals) { // arithmetic over params only: numbers, + - * /, parentheses
    let i = 0; const s = src.replace(/\s+/g, '');
    const prim = () => {
      if (s[i] === '(') { i++; const v = add(); i++; return v; }
      if (s[i] === '-') { i++; return -prim(); }
      let m = /^\d+(\.\d+)?/.exec(s.slice(i)); if (m) { i += m[0].length; return +m[0]; }
      m = /^[A-Za-z_]\w*/.exec(s.slice(i)); if (!m || !(m[0] in vals)) throw code('E_BAD_ARG', `$expr "${src}": unknown name`);
      i += m[0].length; const v = vals[m[0]]; if (typeof v !== 'number') throw code('E_BAD_ARG', `$expr "${src}": param ${m[0]} is not a number`); return v;
    };
    const mul = () => { let v = prim(); while (s[i] === '*' || s[i] === '/') { const o = s[i++]; const r = prim(); v = o === '*' ? v * r : v / r; } return v; };
    const add = () => { let v = mul(); while (s[i] === '+' || s[i] === '-') { const o = s[i++]; const r = mul(); v = o === '+' ? v + r : v - r; } return v; };
    const v = add(); if (i < s.length) throw code('E_BAD_ARG', `$expr "${src}": cannot parse`); return v;
  }
  function sub(x, vals, inner) { // substitute $param / $tap / $mini / $expr / $hook in a chain argument
    if (Array.isArray(x)) return x.map((y) => sub(y, vals, inner));
    if (isObj(x)) {
      if ('$param' in x) { if (!(x.$param in vals)) throw code('E_BAD_ARG', `unknown param ${x.$param}`); return vals[x.$param]; }
      if ('$tap' in x) return makeTap(x.$tap);
      if ('$mini' in x) return miniP(x.$mini);
      if ('$expr' in x) return evalExpr(x.$expr, vals);
      if ('$hook' in x) { if (x.$hook !== 'inner') throw code('E_BAD_ARG', `$hook "${x.$hook}" (only "inner")`); return inner || ident; }
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sub(v, vals, inner)]));
    }
    return x;
  }
  // value of a param at piece start p0: default < binding args < expression args < open set
  function paramValues(name, def, t, ctx) {
    const params = def.params || {}; const names = Object.keys(params); const out = {};
    const named = { ...(ctx.args || {}), ...(ctx.named || {}), ...t.named };
    for (const k of Object.keys(named)) if (!names.includes(k)) throw code('E_BAD_ARG', `hook "${name}" has no param "${k}"`);
    t.args.forEach((_, i) => { if (i >= names.length) throw code('E_BAD_ARG', `hook "${name}" takes ${names.length} args`); });
    names.forEach((k, i) => {
      let v = params[k].default; if (named[k] !== undefined) v = named[k]; if (t.args[i] !== undefined) v = t.args[i];
      const s = openSet(`${name}.${k}`, ctx.p0, ctx.cx); if (s) v = s.value;
      checkParam(name, k, params[k], v); out[k] = isPatternValue(v) ? valuePattern(v) : v;
    });
    return out;
  }
  const isPatternValue = (v) => v && typeof v === 'object' && (typeof v.query === 'function' || '$tap' in v || '$mini' in v);
  function checkParam(hook, k, spec, v) {
    if (typeof v === 'number') { if ((spec.min != null && v < spec.min) || (spec.max != null && v > spec.max)) throw code('E_BAD_ARG', `${hook}.${k}=${v} outside ${spec.min}..${spec.max}`); }
  }
  function openSet(key, p0, cx) {
    let best = null;
    for (const s of eff().sets) if (s.key === key && compileGate({ id: 'set:' + s.seq, gate: s.gate, quant: 1 }, cx).open(p0) && (!best || s.seq >= best.seq)) best = s;
    return best;
  }
  function valuePattern(v) {
    if (v && typeof v.query === 'function') return v;
    if (isObj(v)) { if ('$tap' in v) return makeTap(v.$tap); if ('$mini' in v) return miniP(v.$mini); }
    return typeof v === 'string' ? miniP(v) : reify(v);
  }
  const wrapFn = (def, vals, ctx, innerFn) => (pat) => {
    if (def.apply) {
      const r = def.apply(pat, { args: vals, inner: innerFn || ident, slot: ctx.slot, scope: ctx.scope, from: ctx.from, hooks });
      if (!r || typeof r.query !== 'function') throw code('E_HOOK_THREW', 'hook did not return a Pattern');
      return r;
    }
    return (def.chain || []).reduce((p, [m, ...a]) => p[m](...a.map((x) => sub(x, vals, innerFn))), pat);
  };
  function compileTerm(t, ctx) {
    const def = R.defs.get(t.name);
    if (t.deco) {
      const bi = BUILTIN.has(t.name) && !def;
      if (!bi && !def) { note('error', 'E_UNKNOWN_HOOK', `unknown decorator "${t.name}"`); return ident; }
      if (!bi && !def.decorator) { fail('E_NOT_DECORATOR', `"${t.name}" is a plain hook, not a decorator (bracket form not allowed)`); return ident; }
      const innerCtx = t.name === 'with' && bi ? { ...ctx, named: { ...ctx.named, ...t.named } } : ctx;
      const inner = compileExpr(t.deco, innerCtx);
      if (bi) return builtin(t, inner, ctx);
      return wrapFn(def, paramValues(t.name, def, t, ctx), ctx, inner);
    }
    if (!def) {
      if (BUILTIN.has(t.name)) { fail('E_BAD_ARG', `decorator "${t.name}" needs [..]`); return ident; }
      note('error', 'E_UNKNOWN_HOOK', `unknown hook "${t.name}"`); return ident;
    }
    return wrapFn(def, paramValues(t.name, def, t, ctx), ctx, ctx.innerWrap || null);
  }
  function compileExpr(ast, ctx) { const fns = ast.terms.map((t) => compileTerm(t, ctx)); return (pat) => fns.reduce((p, f) => f(p), pat); }
  function builtin(t, inner, ctx) {
    const a = t.args;
    switch (t.name) {
      case 'every': return (pat) => pat.every(a[0] ?? 2, inner);
      case 'mix': return (pat) => stack(pat, inner(pat).mul(reify({ gain: a[0] ?? 0.5 })));
      case 'sometimes': return (pat) => pat.sometimesBy(a[0] ?? 0.5, inner);
      case 'ns': return (pat) => inner(pat).ns(String(a[0]));
      case 'tapped': return (pat) => inner(pat).tap(String(a[0]));
      case 'with': return inner;
      case 'gated': {
        const g = normGate(a[0] ?? '*');
        return (pat) => { const open = inner(pat); return new Pattern((state) => { const c = compileGate({ gate: g, label: 'gated' }, cxOf(state.controls)); return cutSpan(state.span, c.edges(state.span.begin, state.span.end)).flatMap((sp) => (c.open(sp.begin) ? open : pat).query(state.setSpan(sp))); }); };
      }
      default: return inner;
    }
  }
  function compileSpec(spec, ctx) { // spec: expression string | { chain, params } | function (opaque)
    if (typeof spec === 'string') return compileExpr(parseExpr(spec), ctx);
    if (typeof spec === 'function') return wrapFn({ apply: spec }, {}, ctx, ctx.innerWrap || null);
    if (isObj(spec)) return wrapFn(spec, {}, ctx, null);
    throw code('E_BAD_ARG', 'hook must be a name, a chain array, or a function');
  }
  const isApplySpec = (spec) => typeof spec === 'function' || (typeof spec === 'string' && parseExpr(spec).terms.length === 1 && !!R.defs.get(parseExpr(spec).terms[0].name)?.apply);
  function guarded(mk, src) { // mk: () => (pat -> pat). our own codes -> fail(), anything else -> E_HOOK_THREW + bypass
    return (pat) => {
      try { return mk()(pat); } catch (e) {
        if (e.code && e.code !== 'E_HOOK_THREW') { note('error', e.code, e.message.replace(/^E_\w+: /, '')); if (!hooks.live) throw e; return pat; }
        note('error', 'E_HOOK_THREW', `${src}: ${e.message}`); return pat;
      }
    };
  }

  // ---------------- effective registry (program + journal) ----------------
  const specOf = (h) => (typeof h === 'string' ? h : typeof h === 'function' ? h : isObj(h) ? h : Array.isArray(h) ? { chain: h } : (() => { throw code('E_BAD_ARG', 'bad hook'); })());
  const normSlot = (ref) => String(ref).replace(/^track:/, '').replace(/\/track:/, '/');
  const splitSlot = (ref) => { const s = normSlot(ref); const i = s.lastIndexOf('/'); return i < 0 ? { sel: null, name: s } : { sel: s.slice(0, i), name: s.slice(i + 1) }; };
  function mkBinding(slot, hook, gate, o = {}, id) {
    if (!/^([\w*:-]+\/)?[A-Za-z][\w-]*$/.test(normSlot(slot))) throw code('E_BAD_ARG', `bad slot ref "${slot}"`);
    const b = { id, slot: normSlot(slot), hook: specOf(hook), gate: normGate(gate), order: o.order ?? 0, priority: o.priority ?? 0, seq: ++seq };
    if (o.args) b.args = { ...o.args }; if (o.else != null) b.else = specOf(o.else); if (o.rebase) b.rebase = true; if (o.closes) b.closes = [...o.closes];
    if (typeof b.hook === 'string') validateSpec(b.hook); if (typeof b.else === 'string') validateSpec(b.else);
    return b;
  }
  function validateSpec(s) { // syntax + checks that are possible now (defs may come later)
    const ast = parseExpr(s);
    const walk = (a) => { for (const t of a.terms) { const def = R.defs.get(t.name);
      if (t.deco && def && !def.decorator) throw code('E_NOT_DECORATOR', `"${t.name}" is a plain hook, not a decorator`);
      if (def?.params && !t.deco) { const names = Object.keys(def.params); t.args.forEach((v, i) => { if (names[i]) checkParam(t.name, names[i], def.params[names[i]], v); else throw code('E_BAD_ARG', `hook "${t.name}" takes ${names.length} args`); }); for (const k of Object.keys(t.named)) if (!names.includes(k)) throw code('E_BAD_ARG', `hook "${t.name}" has no param "${k}"`); }
      if (t.deco) walk(t.deco); } };
    walk(ast);
  }
  function eff() {
    if (effCache) return effCache;
    const bs = R.bindings.map((b) => ({ ...b, closes: b.closes ? [...b.closes] : undefined }));
    const vars = new Map([...R.vars].map(([k, v]) => [k, v.map((x) => ({ ...x }))]));
    const sets = R.sets.map((s) => ({ ...s }));
    let j = 0; const order = hooks.journal.map((e, i) => ({ e, i })).sort((a, b) => F(a.e.cycle).compare(F(b.e.cycle)) || a.i - b.i);
    const close = (pred, at) => { for (const b of bs) if (pred(b)) b.closes = [...(b.closes || []), at]; };
    for (const { e } of order) {
      const at = String(e.cycle); const a = e.args || [];
      if (e.op === 'replace') { const slot = normSlot(a[0]); close((b) => b.slot === slot, at); const nb = { id: `j${++j}`, slot, hook: specOf(a[1]), gate: { from: at }, order: a[2]?.order ?? 0, priority: a[2]?.priority ?? 0, seq: 1e6 + j }; if (a[2]?.args) nb.args = a[2].args; if (a[2]?.else != null) nb.else = specOf(a[2].else); if (a[2]?.rebase) nb.rebase = true; bs.push(nb); }
      else if (e.op === 'unbind') { const t = normSlot(a[0]); close((b) => b.id === t || b.slot === t, at); }
      else if (e.op === 'bind') bs.push({ id: `j${++j}`, slot: normSlot(a[0]), hook: specOf(a[1]), gate: { from: at }, order: a[3]?.order ?? 0, priority: a[3]?.priority ?? 0, seq: 1e6 + j });
      else if (e.op === 'set') sets.push({ key: a[0], value: a[1], gate: { from: at }, seq: 1e6 + ++j });
      else if (e.op === 'let') { const l = vars.get(a[0]) || []; l.push({ value: a[1], gate: { from: at }, priority: a[3]?.priority ?? 0, seq: 1e6 + ++j }); vars.set(a[0], l); }
    }
    effCache = { bindings: bs, vars, sets }; return effCache;
  }

  // ---------------- slots: planning ----------------
  const slotCfg = (name) => ({ mode: 'chain', else: 'bypass', quant: 1, ...(R.slots.get(name) || {}) });
  function declareSlot(name, o = {}) {
    R.declared.add(name); const cur = R.slots.get(name) || {}; const next = { ...cur };
    for (const k of ['mode', 'else', 'quant']) if (o[k] !== undefined) {
      if (cur[k] !== undefined && JSON.stringify(cur[k]) !== JSON.stringify(o[k])) throw code('E_SLOT_CONFLICT', `slot "${name}" declared with ${k}=${JSON.stringify(cur[k])} and ${JSON.stringify(o[k])}`);
      if (k === 'mode' && !['chain', 'swap', 'stack'].includes(o[k])) throw code('E_BAD_ARG', `slot mode "${o[k]}"`);
      next[k] = o[k];
    }
    if (Object.keys(next).length) { R.slots.set(name, next); touch(); }
  }
  function scopeDesc(id) {
    if (!id) return null; const s = normSlot(id); const m = /^(stem|bus):(.+)$/.exec(s);
    if (m) return { name: null, [m[1]]: m[2] };
    const decl = R.scopes.get(s) || {}; return { name: s, stem: decl.stem != null ? String(decl.stem) : undefined, bus: decl.bus != null ? String(decl.bus) : undefined };
  }
  function candidates(bindings, slot, scopeId) {
    const sc = scopeDesc(scopeId); const out = [];
    for (const b of bindings) {
      const { sel, name } = splitSlot(b.slot); if (name !== slot) continue; let level;
      if (sel == null) level = 0; else if (sel === '*') level = 1;
      else if (!sc) continue;
      else { const m = /^(stem|bus):(.+)$/.exec(sel);
        if (m) { if (sc[m[1]] === undefined || sc[m[1]] !== m[2]) continue; level = m[1] === 'bus' ? 2 : 3; }
        else { if (sc.name !== sel) continue; level = 4; } }
      out.push({ b, level });
    }
    return out;
  }
  const hookNamesOf = (b) => { const s = new Set(); try { namesOf(b.hook, s); namesOf(b.else, s); } catch { /* reported at compile */ } return s; };
  function shadowCheck(slot, gs) {
    const single = (x) => !x.g.period && x.g.wins.length === 1 && x.b.gate.when == null && !x.g.never;
    const beats = (a, b) => a.b.priority > b.b.priority || (a.b.priority === b.b.priority && (a.level > b.level || (a.level === b.level && a.b.seq > b.b.seq)));
    for (const b of gs) { if (!single(b)) continue;
      for (const a of gs) { if (a === b || !single(a) || !beats(a, b)) continue;
        const [a0, a1] = a.g.wins[0]; const [b0, b1] = b.g.wins[0];
        if (a0.compare(b0) <= 0 && (!a1 || (b1 && b1.compare(a1) <= 0))) { note('warn', 'W_SHADOWED', `binding ${b.b.id} on "${slot}" can never win against ${a.b.id} (same window, lower priority)`); break; } } }
  }
  const noItems = (span, cfg) => [{ span, items: [], key: 'none', cfg }];
  function planPieces(slot, scopeId, span, ctrl) {
    const cx = cxOf(ctrl); const cfg = slotCfg(slot); const E = eff();
    const cand = candidates(E.bindings, slot, scopeId);
    if (!cand.length) return noItems(span, cfg);
    const gs = cand.map((x) => ({ ...x, g: compileGate({ id: x.b.id, gate: x.b.gate, closes: x.b.closes, quant: cfg.quant, label: `binding ${x.b.id} on "${slot}"` }, cx) }));
    if (cfg.mode === 'swap') shadowCheck(slot, gs);
    const cuts = gs.flatMap((x) => x.g.edges(span.begin, span.end));
    const names = new Set(); gs.forEach((x) => hookNamesOf(x.b).forEach((n) => names.add(n)));
    const relSets = E.sets.filter((s) => names.has(s.key.split('.')[0]));
    for (const s of relSets) cuts.push(...compileGate({ id: 'set:' + s.seq, gate: s.gate, quant: 1 }, cx).edges(span.begin, span.end));
    return cutSpan(span, cuts).map((sp) => {
      const p0 = sp.begin; const open = gs.filter((x) => x.g.open(p0)); const ord = (a, b) => a.level - b.level || a.b.order - b.b.order || a.b.seq - b.b.seq; const items = [];
      if (cfg.mode === 'swap') {
        const w = [...open].sort((a, b) => b.b.priority - a.b.priority || b.level - a.level || b.b.seq - a.b.seq)[0];
        if (w) items.push({ b: w.b, kind: 'hook', from: w.g.startAt(p0) });
      } else if (cfg.mode === 'stack') { for (const x of [...open].sort(ord)) items.push({ b: x.b, kind: 'hook', from: x.g.startAt(p0) }); }
      else for (const x of [...gs].sort(ord)) { if (open.includes(x)) items.push({ b: x.b, kind: 'hook', from: x.g.startAt(p0) }); else if (x.b.else != null) items.push({ b: x.b, kind: 'else' }); }
      if (!items.some((i) => i.kind === 'hook' || (cfg.mode === 'chain' && i.kind === 'else'))) items.push({ kind: 'slot-else' });
      const sig = relSets.filter((s) => compileGate({ id: 'set:' + s.seq, gate: s.gate, quant: 1 }, cx).open(p0)).map((s) => s.seq).join('.');
      return { span: sp, items, cfg, p0, cx, key: `${version}|${cfg.mode}|${items.map((i) => `${i.b?.id || 'se'}${i.kind[0]}${i.from ? '@' + frStr(i.from) : ''}`).join(',')}|${sig}` };
    });
  }
  function itemFn(it, piece, slot, scope, wrapInner) {
    const ctx = { slot, scope, p0: piece.p0, cx: piece.cx, args: it.b?.args, from: it.from, named: {}, innerWrap: wrapInner };
    const spec = it.kind === 'slot-else' ? piece.cfg.else : it.kind === 'else' ? it.b.else : it.b.hook;
    if (spec === 'bypass') return ident; if (spec === 'silence') return () => silence;
    const fn = guarded(() => compileSpec(spec, ctx), typeof spec === 'string' ? spec : 'hook');
    let f = wrapInner && !isApplySpec(spec) ? (pat) => fn(wrapInner(pat)) : fn;
    if (it.b?.rebase && it.from && it.kind === 'hook') { const g = f; f = (pat) => g(pat.early(it.from)).late(it.from); }
    return f;
  }
  function useOrWrap(src, slotRef, wrapInner, o = {}) {
    const { sel, name } = splitSlot(slotRef); declareSlot(name, o);
    return new Pattern((state) => {
      const scope = sel ?? o.ns ?? state.controls?._hookNs;
      const pieces = planPieces(name, scope, state.span, state.controls);
      if (pieces.length === 1 && pieces[0].key === 'none' && pieces[0].cfg.else === 'bypass') return (wrapInner ? wrapInner(src) : src).query(state);
      return pieces.flatMap((p) => {
        let m = built.get(src); if (!m || m.v !== version || m.w !== wrapInner) { m = { v: version, w: wrapInner, map: new Map() }; built.set(src, m); }
        let pat = m.map.get(p.key);
        if (!pat) {
          const fns = p.items.map((it) => itemFn(it, p, name, scope, wrapInner));
          pat = p.cfg.mode === 'stack' && fns.length ? stack(...fns.map((f) => f(src))) : fns.reduce((x, f) => f(x), src);
          if (!p.items.some((i) => i.kind !== 'slot-else') && wrapInner && p.cfg.else === 'bypass') pat = wrapInner(src);
          m.map.set(p.key, pat);
        }
        return pat.query(state.setSpan(p.span));
      });
    });
  }

  // ---------------- taps ----------------
  const guard = (key, run, dflt) => {
    if (active.has(key)) { const path = [...active]; const loop = path.slice(path.indexOf(key)).sort().join(' <-> '); note('error', 'E_TAP_CYCLE', `tap reads form a loop: ${loop}`); return dflt(); }
    active.add(key); try { return run(); } finally { active.delete(key); }
  };
  const tapKey = (sel, name) => (sel ? `${normSlot(sel)}/${name}` : name);
  function publish(ref, pat, opts) {
    const p = TAPREF.exec(ref); if (!p || p[3]) throw code('E_BAD_ARG', `bad tap name "${ref}"`);
    R.taps.set(tapKey(p[1], p[2]), { pat, opts }); return pat;
  }
  function lookupTap(P, scopeId) {
    const sc = scopeDesc(scopeId); const keys = [];
    if (P.sel) keys.push(tapKey(P.sel, P.name));
    else { if (sc?.name) keys.push(`${sc.name}/${P.name}`); if (sc?.stem) keys.push(`stem:${sc.stem}/${P.name}`); if (sc?.bus) keys.push(`bus:${sc.bus}/${P.name}`); keys.push(`*/${P.name}`, P.name); }
    for (const k of keys) if (R.taps.has(k)) { R.reads.add(k); return R.taps.get(k).pat; }
    return null;
  }
  function parseRef(ref) {
    const m = TAPREF.exec(ref); if (!m) throw code('E_BAD_ARG', `bad tap ref "${ref}"`);
    if (['out', 'audio'].includes(m[3])) throw code('E_TAP_AUDIO', `audio-level tap "${ref}" is reserved; use mixdown follow`);
    return { sel: m[1], name: m[2], facet: m[3] };
  }
  const first = (haps) => haps.find((h) => h.value !== undefined);
  function latestOnset(T, t, lb, ctrl) {
    const tf = +t; const haps = [...T.queryArc(tf - lb, tf, ctrl), ...T.queryArc(t, t, ctrl)]; let best = null;
    for (const h of haps) { if (!h.hasOnset() || !h.whole) continue; const b = +h.whole.begin; if (b <= tf + 1e-12 && (!best || b > best.begin)) best = { begin: b, hap: h }; }
    return best;
  }
  const lenOf = (v, d, ctrl) => lenCycles(v ?? d, hooks.cps ?? ctrl?._cps);
  function paramTimeline(name, param, t, cx) {
    const def = R.defs.get(name); const s = openSet(`${name}.${param}`, t, cx); return s ? s.value : def.params[param].default;
  }
  function evalCont(P, o, t, ctrl, gateN) {
    const facet = P.facet; const cx = cxOf(ctrl);
    if (gateN && !compileGate({ gate: gateN, label: 'gated read' }, cx).open(t)) return o.default;
    const key = `${P.sel ? P.sel + '/' : ''}${P.name}:${facet}`;
    return guard(key, () => {
      const def = !P.sel && R.defs.get(P.name);
      if (def?.params && facet in def.params) { const v = paramTimeline(P.name, facet, t, cx); return isPatternValue(v) ? first(valuePattern(v).queryArc(t, t, ctrl))?.value : v; }
      if (def?.taps && facet in def.taps) return first(makeTap(def.taps[facet], o).queryArc(t, t, ctrl))?.value ?? o.default;
      const T = lookupTap(P, ctrl?._hookNs);
      if (!T) { note('error', 'E_UNKNOWN_TAP', `no tap "${P.name}" for read "${key}"`); return o.default; }
      if (facet === 'gate') return T.queryArc(t, t, ctrl).length ? 1 : 0;
      const on = latestOnset(T, t, o.lookback ?? 4, ctrl);
      if (facet === 'env') {
        if (!on) return o.default ?? 0;
        const a = lenOf(o.a, 0, ctrl); const r = lenOf(o.r, 0.25, ctrl); const dt = +t - on.begin;
        if (a > 0 && dt < a) return dt / a;
        const u = r > 0 ? (dt - a) / r : 1; if (u >= 1) return 0;
        return o.curve === 'exp' ? (Math.exp(-5 * u) - Math.exp(-5)) / (1 - Math.exp(-5)) : 1 - u;
      }
      if (!on) return o.default;
      let v = on.hap.value; if (isObj(v)) { v = v[facet] ?? (hooks.canon ? v[hooks.canon(facet)] : undefined); }
      return v === undefined ? o.default : v;
    }, () => o.default);
  }
  function makeTap(ref, o = {}) {
    const P = parseRef(ref); const facet = P.facet || 'ev'; const gateN = o.gate != null ? normGate(o.gate) : null;
    if (facet !== 'ev' && facet !== 'onset') { P.facet = facet; return signal((t, ctrl) => evalCont(P, o, F(t), ctrl, gateN) ?? 0); }
    return new Pattern((state) => {
      const key = `${P.sel ? P.sel + '/' : ''}${P.name}:${facet}`; const ctrl = state.controls;
      const run = (sp) => guard(key, () => {
        const st = state.setSpan(sp);
        if (!P.sel && facet === 'ev' && (eff().vars.has(P.name))) return assignPattern(eff().vars.get(P.name), 'var:' + P.name).query(st);
        const T = lookupTap(P, ctrl?._hookNs);
        if (!T) { note('error', 'E_UNKNOWN_TAP', `no tap "${P.name}" for read "${key}"`); return []; }
        const haps = T.query(st); return facet === 'onset' ? haps.map((h) => h.withValue(() => 1)) : haps;
      }, () => []);
      if (!gateN) return run(state.span);
      const c = compileGate({ gate: gateN, label: 'gated read' }, cxOf(ctrl));
      return cutSpan(state.span, c.edges(state.span.begin, state.span.end)).flatMap((sp) => (c.open(sp.begin) ? run(sp) : []));
    });
  }
  // sampled value of a tap at cycle t (continuous facets; discrete ones give the first hap value). undefined = leave untouched
  function readValue(ref, o, t, ctrl) {
    const P = parseRef(ref); const facet = P.facet || 'ev';
    if (facet !== 'ev' && facet !== 'onset') return evalCont({ ...P, facet }, o, F(t), ctrl, o.gate != null ? normGate(o.gate) : null);
    return first(makeTap(ref, o).queryArc(t, t, ctrl))?.value ?? o.default;
  }
  function assignPattern(list, label) { // vars / module params: swap of assignments (highest priority, then latest)
    return new Pattern((state) => {
      const cx = cxOf(state.controls);
      const gs = list.map((a, i) => ({ a, g: compileGate({ id: `${label}:${i}:${a.seq}`, gate: a.gate, closes: a.closes, quant: 1, label }, cx) }));
      const cuts = gs.flatMap((x) => x.g.edges(state.span.begin, state.span.end));
      return cutSpan(state.span, cuts).flatMap((sp) => {
        const open = gs.filter((x) => x.g.open(sp.begin)).sort((x, y) => (y.a.priority ?? 0) - (x.a.priority ?? 0) || y.a.seq - x.a.seq)[0];
        return open ? valuePattern(open.a.value).query(state.setSpan(sp)) : [];
      });
    });
  }
  const aliasKey = (param) => { try { const h = reify({})[param](1).queryArc(0, 0)[0]; const k = h && isObj(h.value) && Object.keys(h.value)[0]; return k || param; } catch { return param; } };
  const rangeOf = (param, key) => { const r = hooks.ranges?.[key] || hooks.ranges?.[param] || hooks.ranges?.[hooks.canon ? hooks.canon(param) : param]; return r ? [r.min, r.max] : [0, 1]; };
  function wireFn(src, param, ref, o = {}) {
    const key = aliasKey(param); const [lo, hi] = o.range || rangeOf(param, key); const op = o.op || 'set';
    if (!['set', 'add', 'mul'].includes(op)) throw code('E_BAD_ARG', `wire op "${op}"`);
    parseRef(ref);
    return new Pattern((state) => src.query(state).map((hap) => {
      const t = hap.wholeOrPart().begin; const v = readValue(ref, o, t, state.controls);
      if (v === undefined || typeof v !== 'number') return hap;
      const x = o.curve === 'exp' && lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, v) : v * (hi - lo) + lo;
      return hap.withValue((val) => { const out = isObj(val) ? { ...val } : { value: val }; out[key] = op === 'set' || out[key] === undefined ? x : op === 'add' ? out[key] + x : out[key] * x; return out; });
    }));
  }

  // ---------------- Pattern surface ----------------
  const mark = (f) => { f.__hooks = true; return f; };
  proto.use = mark(function use(slotRef, o) { return useOrWrap(this, slotRef, null, o); });
  proto.wrap = mark(function wrap(slotRef, inner, o) { if (typeof inner !== 'function') throw code('E_BAD_ARG', 'wrap needs an inner function'); return useOrWrap(this, slotRef, inner, o); });
  proto.ns = mark(function ns(id) {
    const src = this; const sc = normSlot(id);
    for (const t of src._hookTaps || []) R.taps.set(`${sc}/${t.name}`, { pat: t.src, opts: t.opts });
    return new Pattern((state) => {
      const ws = R.wires.filter((w) => w.dest.slice(0, w.dest.lastIndexOf('.')) === sc);
      let p = src; for (const w of ws) { const { dest, tap: tr, ...wo } = w; p = wireFn(p, dest.slice(dest.lastIndexOf('.') + 1), tr, wo); }
      return p.query(state.setControls({ ...state.controls, _hookNs: sc }));
    });
  });
  proto.tap = mark(function tap(name, o) {
    const src = this; publish(name, src, o); const P = TAPREF.exec(name);
    const p = new Pattern((state) => { const sc = state.controls?._hookNs; if (sc && !P[1]) R.taps.set(`${normSlot(sc)}/${P[2]}`, { pat: src, opts: o }); return src.query(state); });
    p._hookTaps = [{ name: P[2], src, opts: o }]; return p;
  });
  proto.wire = mark(function wire(param, ref, o) { return wireFn(this, param, ref, o); });
  const tap = mark((ref, o) => makeTap(ref, o));

  // ---------------- lifecycle ----------------
  const livePoint = (at, quant = 1) => { // "next" | "nextN" | "now" -> Fraction cycle, or null when `at` is a normal point
    if (typeof at !== 'string' || !/^(now|next\d*)$/.test(at)) return null;
    if (!hooks.live) throw code('E_LIVE_ONLY', `"${at}" needs a live host (headless renders replay a journal)`);
    const pos = typeof hooks.position === 'function' ? hooks.position() : hooks.position; if (pos == null) throw code('E_LIVE_ONLY', 'no scheduler position');
    const p = F(pos); if (at === 'now') return p;
    const n = at === 'next' ? F(quant) : F(+at.slice(4)); return p.div(n).ceil().mul(n);
  };
  const find = (idOrSlot) => { const t = normSlot(idOrSlot); return R.bindings.filter((b) => b.id === t || b.slot === t); };
  Object.assign(hooks, {
    def(name, spec) {
      if (!/^[A-Za-z][\w-]*$/.test(name)) throw code('E_BAD_ARG', `bad hook name "${name}"`);
      const d = Array.isArray(spec) ? { chain: spec } : typeof spec === 'function' ? { apply: spec, opaque: true } : { ...spec };
      if (!isObj(spec) && !Array.isArray(spec) && typeof spec !== 'function') throw code('E_BAD_ARG', 'def needs an object, chain array or function');
      if (d.apply) d.opaque = true;
      for (const [m] of d.chain || []) if (typeof proto[m] !== 'function') throw code('E_UNKNOWN_METHOD', `chain step "${m}" is not a Pattern method`);
      R.defs.set(name, d); touch(); return hooks;
    },
    undef(name) { R.defs.delete(name); touch(); return hooks; },
    bind(slot, hook, gate, o) {
      const b = mkBinding(slot, hook, gate, o, `b${++bid}`); R.bindings.push(b); declareSeen(b); touch(); return b.id;
    },
    unbind(idOrSlot, at) {
      const targets = find(idOrSlot); const lp = livePoint(at);
      if (lp) { hooks.journal.push({ cycle: frStr(lp), op: 'unbind', args: [normSlot(idOrSlot)] }); touch(); return hooks; }
      if (at == null) R.bindings = R.bindings.filter((b) => !targets.includes(b));
      else { normGate({ from: 0, until: at }); targets.forEach((b) => { b.closes = [...(b.closes || []), at]; }); }
      touch(); return hooks;
    },
    replace(slot, hook, at, o) {
      const lp = livePoint(at, R.slots.get(splitSlot(slot).name)?.quant ?? 1);
      if (lp) { hooks.journal.push({ cycle: frStr(lp), op: 'replace', args: o ? [normSlot(slot), specOf(hook), o] : [normSlot(slot), specOf(hook)] }); touch(); return hooks; }
      if (at != null) hooks.unbind(slot, at);
      else R.bindings = R.bindings.filter((b) => b.slot !== normSlot(slot));
      return hooks.bind(slot, hook, at == null ? '*' : { from: at }, o);
    },
    set(key, value, gate) {
      const m = /^([A-Za-z][\w-]*)\.(\w+)$/.exec(key); if (!m) throw code('E_BAD_ARG', `set key must be "hook.param", got "${key}"`);
      const def = R.defs.get(m[1]);
      if (def) { if (!def.params?.[m[2]]) throw code('E_BAD_ARG', `hook "${m[1]}" has no param "${m[2]}"`); checkParam(m[1], m[2], def.params[m[2]], value); }
      const s = { key, value, gate: normGate(gate), seq: ++seq }; R.sets.push(s); touch(); return s.seq;
    },
    let(name, value, gate, o = {}) {
      if (!/^[A-Za-z][\w-]*$/.test(name)) throw code('E_BAD_ARG', `bad variable name "${name}"`);
      const l = R.vars.get(name) || []; l.push({ value, gate: normGate(gate), priority: o.priority ?? 0, seq: ++seq }); R.vars.set(name, l); touch(); return hooks;
    },
    marker(name, point) { if (!/^[A-Za-z][\w-]*$/.test(name)) throw code('E_BAD_ARG', `bad marker name "${name}"`); R.markers.set(name, point); parsePoint(point, { ...pctx(), markers: R.markers }); touch(); return hooks; },
    scope(name, anc = {}) { R.scopes.set(normSlot(name), { ...anc }); touch(); return hooks; },
    slot(name, cfg = {}) { declareSlot(normSlot(name), cfg); return hooks; },
    wire(dest, tapRef, o = {}) { if (!/^[\w-]+\.\w+$/.test(dest)) throw code('E_BAD_ARG', `wire dest must be "scope.param", got "${dest}"`); parseRef(tapRef); R.wires.push({ dest, tap: tapRef, ...o }); touch(); return hooks; },
    publish(ref, pat, o) { return publish(ref, pat, o); },
    decorate(target, deco) {
      const bs = find(target); if (!bs.length) throw code('E_UNKNOWN_HOOK', `no binding "${target}"`);
      for (const b of bs) { if (typeof b.hook !== 'string') throw code('E_BAD_ARG', 'decorate needs a hook-name expression'); const h = `${deco}[${b.hook}]`; validateSpec(h); b.hook = h; }
      touch(); return hooks;
    },
    undecorate(target) {
      for (const b of find(target)) if (typeof b.hook === 'string') { const ast = parseExpr(b.hook); if (ast.terms.length === 1 && ast.terms[0].deco) b.hook = ast.terms[0].innerSrc; }
      touch(); return hooks;
    },
    fn(name) { return (pat) => new Pattern((st) => guarded(() => compileSpec(name, { slot: null, p0: st.span.begin, cx: cxOf(st.controls), named: {} }), String(name))(pat).query(st)); },
    pipe(...names) { return hooks.fn(names.join(' | ')); },
    reset(o = {}) { frozen = false; clear(); bid = 0; seq = 0; sid = 0; active.clear(); if (!o.keepJournal) hooks.journal.length = 0; diag.length = 0; seen.clear(); touch(); return hooks; },
    diag: () => diag.map((d) => ({ ...d })),
    clearDiag() { diag.length = 0; seen.clear(); },
  });
  const declareSeen = (b) => { const { name } = splitSlot(b.slot); void name; };

  // ---------------- check / plan ----------------
  hooks.check = () => {
    const E = eff(); const cx = cxOf({});
    for (const b of E.bindings) {
      const { name } = splitSlot(b.slot);
      if (!R.declared.has(name)) note('error', 'E_UNKNOWN_SLOT', `binding ${b.id} addresses slot "${name}" that no pattern uses`);
      for (const spec of [b.hook, b.else]) if (typeof spec === 'string') {
        try { compileSpec(spec, { slot: name, p0: F0, cx, args: b.args, named: {} }); } catch { /* recorded */ }
      }
      try { compileGate({ id: b.id, gate: b.gate, closes: b.closes, quant: slotCfg(name).quant, label: `binding ${b.id} on "${name}"` }, cx); } catch { /* recorded */ }
    }
    const used = new Set(); for (const b of E.bindings) { hookNamesOf(b).forEach((n) => used.add(n)); }
    for (const [n, d] of R.defs) { if (d.taps) Object.values(d.taps).forEach(() => {}); if (!used.has(n) && !d.decorator) note('warn', 'W_UNUSED_HOOK', `hook "${n}" is defined but never bound`); }
    for (const k of R.taps.keys()) if (!R.reads.has(k)) note('warn', 'W_UNUSED_TAP', `tap "${k}" is published but never read`);
    return { errors: diag.filter((d) => d.level === 'error'), warnings: diag.filter((d) => d.level === 'warn') };
  };
  hooks.plan = (o = {}) => {
    const H = o.horizon ?? hooks.horizon; const prev = hooks.horizon; if (o.horizon != null) hooks.horizon = o.horizon;
    try {
      const E = eff(); const names = new Set([...R.declared, ...E.bindings.map((b) => splitSlot(b.slot).name)]);
      const scopes = ['', ...new Set([...R.scopes.keys(), ...E.bindings.map((b) => splitSlot(b.slot).sel).filter((s) => s && s !== '*')])].sort();
      const slots = {}; const cps = hooks.cps;
      const T = H == null ? null : F(H);
      for (const name of [...names].sort()) {
        slots[name] = { config: slotCfg(name), scopes: {} };
        for (const sc of scopes) {
          if (!T) continue; const pcs = []; let span = null;
          const mk = new (class { constructor(b, e) { this.begin = b; this.end = e; } })(F0, T);
          span = mk;
          let pieces; try { pieces = planPieces(name, sc || null, span, cps ? { _cps: cps } : {}); } catch (e) { note('error', e.code || 'E_HOOK_THREW', e.message); continue; }
          for (const p of pieces) { const desc = p.items.map((i) => (i.kind === 'slot-else' ? 'else:' + p.cfg.else : i.kind === 'else' ? `${i.b.id}:else` : i.b.id));
            const last = pcs[pcs.length - 1]; if (last && last.bindings.join() === desc.join()) last.until = frStr(p.span.end); else pcs.push({ from: frStr(p.span.begin), until: frStr(p.span.end), bindings: desc }); }
          if (pcs.some((x) => x.bindings.some((b) => !b.startsWith('else:')) ) || sc === '') slots[name].scopes[sc || '*global*'] = pcs;
        }
      }
      return sortKeys({ horizon: T ? frStr(T) : null, cps: cps ?? null, slots, taps: [...R.taps.keys()].sort(), vars: [...E.vars.keys()].sort(), markers: Object.fromEntries(R.markers),
        diagnostics: diag.map((d) => ({ ...d })) });
    } finally { hooks.horizon = prev; }
  };

  // ---------------- JSON ----------------
  const hookJSON = (h) => (typeof h === 'function' ? { opaque: true, src: h.toString() } : isObj(h) && h.chain ? { chain: h.chain, ...(h.params ? { params: h.params } : {}) } : h);
  const valJSON = (v) => (v && typeof v === 'object' && typeof v.query === 'function' ? { opaque: true, src: 'Pattern' } : v);
  const gateJSON = (g) => { const o = { ...g }; if (o.when && typeof o.when === 'object' && typeof o.when.query === 'function') o.when = { opaque: true, src: 'Pattern' }; else if (o.when && typeof o.when === 'object' && typeof o.when.valueAt === 'function') o.when = { opaque: true, src: 'control' }; return o; };
  hooks.toJSON = () => {
    const o = { model: 1 };
    if (hooks.cpb !== 1) o.cpb = hooks.cpb; if (hooks.bpb !== 4) o.bpb = hooks.bpb; if (hooks.cps != null) o.cps = hooks.cps;
    if (R.markers.size) o.markers = Object.fromEntries(R.markers);
    if (R.scopes.size) o.scopes = Object.fromEntries(R.scopes);
    const slots = Object.fromEntries([...R.slots].filter(([, v]) => Object.keys(v).length)); if (Object.keys(slots).length) o.slots = slots;
    if (R.defs.size) o.defs = Object.fromEntries([...R.defs].map(([k, d]) => { const { apply, opaque, ...rest } = d; return [k, apply ? { ...rest, opaque: true, src: apply.toString() } : rest]; }));
    if (R.bindings.length) o.bindings = R.bindings.map((b) => ({ id: b.id, slot: b.slot, hook: hookJSON(b.hook), ...(b.args ? { args: b.args } : {}), ...(Object.keys(b.gate).length ? { gate: gateJSON(b.gate) } : {}),
      ...(b.order ? { order: b.order } : {}), ...(b.priority ? { priority: b.priority } : {}), ...(b.else != null ? { else: hookJSON(b.else) } : {}), ...(b.rebase ? { rebase: true } : {}), ...(b.closes ? { closes: b.closes } : {}) }));
    if (R.vars.size) o.vars = Object.fromEntries([...R.vars].map(([k, l]) => [k, l.map((a) => ({ value: valJSON(a.value), ...(Object.keys(a.gate).length ? { gate: gateJSON(a.gate) } : {}), ...(a.priority ? { priority: a.priority } : {}) }))]));
    if (R.sets.length) o.sets = R.sets.map((s) => ({ key: s.key, value: valJSON(s.value), ...(Object.keys(s.gate).length ? { gate: gateJSON(s.gate) } : {}) }));
    if (R.wires.length) o.wires = R.wires.map((w) => ({ ...w }));
    if (hooks.journal.length) o.journal = hooks.journal.map((e) => ({ cycle: String(e.cycle), op: e.op, args: e.args.map((x) => (typeof x === 'function' ? { opaque: true, src: x.toString() } : x)) }));
    return JSON.stringify(sortKeys(o), null, 1);
  };
  hooks.load = (json, lo = {}) => {
    const j = typeof json === 'string' ? JSON.parse(json) : json; if (!isObj(j)) throw code('E_BAD_ARG', 'load needs a config object or JSON text');
    if (j.model != null && j.model > 1) throw code('E_BAD_ARG', `config model ${j.model} is newer than this runtime (1)`);
    const un = (x, where) => { if (isObj(x) && x.opaque) { if (!lo.allowCode) throw code('E_OPAQUE', `${where} is an opaque function hook; load with { allowCode: true } to accept it`); return (0, eval)(`(${x.src})`); } return x; };
    if (j.cpb != null) hooks.cpb = j.cpb; if (j.bpb != null) hooks.bpb = j.bpb; if (j.cps != null) hooks.cps = j.cps;
    for (const [k, v] of Object.entries(j.markers || {})) hooks.marker(k, v);
    for (const [k, v] of Object.entries(j.scopes || {})) hooks.scope(k, v);
    for (const [k, v] of Object.entries(j.slots || {})) hooks.slot(k, v);
    for (const [k, d] of Object.entries(j.defs || {})) hooks.def(k, d.opaque ? { ...d, opaque: undefined, src: undefined, apply: un(d, `def "${k}"`) } : d);
    for (const b of j.bindings || []) {
      const hook = isObj(b.hook) && b.hook.opaque ? un(b.hook, `binding ${b.id}`) : b.hook; const el = isObj(b.else) && b.else.opaque ? un(b.else, `binding ${b.id} else`) : b.else;
      const nb = mkBinding(b.slot, hook, b.gate, { order: b.order, priority: b.priority, args: b.args, else: el, rebase: b.rebase, closes: b.closes }, b.id || `b${++bid}`);
      const n = /^b(\d+)$/.exec(nb.id); if (n) bid = Math.max(bid, +n[1]); R.bindings.push(nb);
    }
    for (const [k, l] of Object.entries(j.vars || {})) for (const a of l) hooks.let(k, un(a.value, `var ${k}`), a.gate, { priority: a.priority });
    for (const s of j.sets || []) hooks.set(s.key, un(s.value, `set ${s.key}`), s.gate);
    for (const w of j.wires || []) { const { dest, tap: tr, ...wo } = w; hooks.wire(dest, tr, wo); }
    for (const e of j.journal || []) hooks.journal.push({ cycle: String(e.cycle), op: e.op, args: (e.args || []).map((x, i) => un(x, `journal ${e.op}`)) });
    touch(); return hooks;
  };

  // Strudel's transpiler turns every "double quoted" literal into a mini-notation Pattern. A simple name ("fx") survives as a pattern with
  // `__pure`; we unwrap that at the API boundary. Anything with mini syntax ("@3b", "<3b", "a | b") must be single-quoted, or
  // run the program text through protect() first (the CLI does), which rewrites the string arguments of hooks calls.
  const plain = (x) => {
    if (x && typeof x === 'object') {
      if (typeof x.__pure === 'string' && typeof x.query === 'function') return x.__pure;
      if (Array.isArray(x)) return x.map(plain);
      if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)]));
    }
    return x;
  };
  for (const k of Object.keys(hooks)) if (typeof hooks[k] === 'function' && !['diag', 'clearDiag', 'toJSON', 'check', 'plan', 'fn', 'pipe', 'publish'].includes(k)) { const f = hooks[k]; hooks[k] = (...a) => f(...a.map(plain)); }
  for (const k of METHODS) { const f = proto[k]; proto[k] = mark(function (...a) { return f.apply(this, a.map(plain)); }); }
  const tap0 = tap; const tapP = mark((...a) => tap0(...a.map(plain)));

  // Per-layer evaluation (HOOKS_SYNTAX 4.9.3): after the registry pass the host freezes the registry, so re-running a header's
  // def/bind/set/let does not duplicate anything; use/wrap/ns/tap/wire keep working (publishing is idempotent).
  for (const k of ['def', 'undef', 'bind', 'unbind', 'replace', 'set', 'let', 'marker', 'scope', 'slot', 'wire', 'decorate', 'undecorate', 'load']) {
    const f = hooks[k]; hooks[k] = (...a) => (frozen ? (k === 'bind' || k === 'set' ? undefined : hooks) : f(...a));
  }
  hooks.freeze = () => { frozen = true; return hooks; }; hooks.thaw = () => { frozen = false; return hooks; }; Object.defineProperty(hooks, 'frozen', { get: () => frozen });
  if (useGlobal) { globalThis.hooks = hooks; globalThis.tap = tapP; }
  return { hooks, tap: tapP };
}
