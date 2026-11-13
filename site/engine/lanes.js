// Lanes L1: the event layer (docs/LANES.md sections 3, 4, 5.4, 8; issue #74). One standalone ES module, no imports, no DOM; the site and
// the CLI share it. Two halves:
//   - pure text: scan(src), compile(src) -> { code, map, graph }, check(src, { strict }), parseSelector(str). Lane graph + diagnostics.
//   - runtime: install(S, hooks, { outer }) adds Pattern.prototype.tags, the globals tagged() and lanes, and applies selections to the
//     haps of the outermost query. Strudel is never modified: public API only, `.tag` is called, not replaced.
// Audio routing (split, send, ret) and capture are later phases; nothing here touches superdough.

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
      for (const c of cs) {
        if (!c.bare && (c.name === 'tags' || c.name === 'tag') && c.depth === 0) for (const a of c.args) { const t = strLit(a); if (t != null && t && !lane.tags.includes(t)) lane.tags.push(t); }
        if (!c.bare && c.name === 'tap') { const n = strLit(c.args[0] || ''); if (n != null) lane.taps.push({ name: n, export: /\bexport\s*:\s*true\b/.test(c.args[1] || '') }); }
        if (c.bare && c.name === 'tap') { const r = strLit(c.args[0] || ''); if (r != null) lane.reads.push(r); }
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
  const errors = diag.filter((d) => d.level === 'error'); const warnings = diag.filter((d) => d.level === 'warn');
  return { errors, warnings, ok: !errors.length, fail: errors.length > 0 || (!!o.strict && warnings.length > 0) };
}

// compile pass skeleton: finds lanes, taps, tags and selections and returns the program unchanged (identity map). Later phases rewrite
// .split/.send/ret here (L2); L1 only reads. graph is plain data, deterministic for one input.
export function compile(src) {
  const text = String(src); const g = scan(text); const lanesOnly = g.lanes.map(({ _t, ...l }) => l);
  const graph = sortKeys({ version: 1, mode: g.mode, lanes: lanesOnly, tags: g.tags, selections: g.selections, diagnostics: [] });
  const d = check(g); graph.diagnostics = d.errors.concat(d.warnings).map((x) => sortKeys(x));
  return { code: text, map: [{ from: 0, to: 0, length: text.length }], graph };
}
export const graphJSON = (src) => JSON.stringify(compile(src).graph, null, 1);

// ---------------- runtime ----------------
let ACTIVE = null; // the installed instance; process-wide wrappers read it, so a second install (tests, hot reload) takes over cleanly
export function install(S, hooks, opts = {}) {
  const { Pattern } = S;
  if (!Pattern || !hooks || !hooks.ext || !hooks.gateAt) throw code('E_BAD_ARG', 'lanes.install needs the Strudel Pattern and the hooks runtime');
  if (hooks.__lanesInstance) { ACTIVE = hooks.__lanesInstance; return hooks.__lanesInstance; }
  const proto = Pattern.prototype; const useGlobal = opts.global !== false;
  if (proto.tags && !proto.tags.__lanes) throw code('E_NAME_COLLISION', 'Pattern.prototype.tags already exists in the loaded Strudel');
  if (useGlobal) for (const n of ['tagged', 'lanes']) if (n in globalThis && !globalThis[n]?.__lanes) throw code('E_NAME_COLLISION', `global ${n} already exists`);
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
  function apply(haps, args) {
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
    stamping: () => live().length > 0,
    // live toggle of one op of one selection; journalled so a headless render replays it (docs/LANES.md 4.3)
    set(id, op, on, at) {
      const s = sels.find((x) => x.id === id); if (!s) throw code('E_BAD_ARG', `no selection "${id}"`); if (!s.ops.some((o) => o.op === op)) throw code('E_BAD_ARG', `selection ${id} has no ${op}`);
      hooks.record('sel', [id, op, !!on], at ?? 'next'); return L;
    },
    apply, compile, check, scan, parseSelector, selectorString,
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
