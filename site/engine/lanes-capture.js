// Lanes L3: capture and recall (docs/LANES.md sections 6, 11e; issue #76). One standalone ES module, no DOM; the site and the CLI share it.
//   - static: analyze(src, o) / checkCaptures: capture definitions, purity, dependency order, E_CAPTURE_* diagnostics (also run by lanes.check through lanes.EXT)
//   - runtime: installCapture(L, S, hooks, o) adds the globals capture() and recall(), Pattern.prototype.from, and L.captures (freeze / thaw / content / audio store).
//   - audio helpers that need no browser: levelOf (RMS per 1/64 cycle), frames, budgets; the browser half (render the picked lanes, register `cap_<name>`) is
//     host code that calls L.captures.setAudio.
// Strudel and superdough are used through public API only. Nothing here changes a program that does not call capture / recall / .from.
import { LAYERS, pickerKind, defaultWhat } from './lanes-pick.js';
import { statements, calls, scan, parseSelector, matcher, EXT, check as checkLanes } from './lanes.js';

const code = (c, m) => Object.assign(new Error(`${c}: ${m}`), { code: c });
export { LAYERS, pickerKind, defaultWhat };
export const FACET_LAYER = { ev: 'events', onset: 'events', gate: 'events', audio: 'audio', level: 'level' };
export const LIMITS = { maxSeconds: 32, maxHaps: 20000, levelPerCycle: 64, guard: 1, memoryMB: 96, memoryMBSmall: 32, sr: 48000 };
export const memoryLimit = (deviceMemory) => (deviceMemory != null && deviceMemory <= 4 ? LIMITS.memoryMBSmall : LIMITS.memoryMB) * 1024 * 1024;
export const frames = (cycles, cps, sr) => Math.round(cycles / cps * sr);
const NAME = /^[A-Za-z_][\w-]*$/;

// ---------------------------------------------------------------- literals and points (static; the runtime prefers hooks.parsers.point)
function lit(t) { // JS literal text -> value, or undefined when it is not a plain literal (string, number, true/false/null, array, object)
  let i = 0; const ws = () => { while (i < t.length && /\s/.test(t[i])) i++; }; const fail = () => { throw 0; };
  const val = () => {
    ws(); const c = t[i];
    if (c === '"' || c === "'" || c === '`') { let o = ''; i++; while (i < t.length && t[i] !== c) { if (t[i] === '\\') i++; o += t[i++]; } if (i >= t.length) fail(); i++; return o; }
    if (c === '[') { i++; const a = []; ws(); while (t[i] !== ']') { a.push(val()); ws(); if (t[i] === ',') i++; ws(); if (i >= t.length) fail(); } i++; return a; }
    if (c === '{') { i++; const o = {}; ws(); while (t[i] !== '}') { ws(); const k = /^[A-Za-z_$][\w$]*/.exec(t.slice(i)); let key; if (k) { key = k[0]; i += key.length; } else key = val(); ws(); if (t[i++] !== ':') fail(); o[key] = val(); ws(); if (t[i] === ',') i++; ws(); if (i >= t.length) fail(); } i++; return o; }
    const m = /^(true|false|null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/.exec(t.slice(i)); if (!m) fail(); i += m[0].length; return JSON.parse(m[0]);
  };
  try { const v = val(); ws(); return i === t.length ? v : undefined; } catch { return undefined; }
}
export function point(raw, c = {}) { // cycles (number) or null; the same grammar as hooks points for the forms a window uses
  const cpb = c.cpb ?? 1, bpb = c.bpb ?? 4; if (typeof raw === 'number') return raw >= 0 ? raw : null; const s = String(raw).trim(); let m;
  if ((m = /^(\d+)\.(\d+)b$/.exec(s))) return ((+m[1] - 1) + (+m[2] - 1) / bpb) * cpb;
  if ((m = /^(\d+(?:\.\d+)?)b$/.exec(s))) return +m[1] >= 1 ? (+m[1] - 1) * cpb : null;
  if ((m = /^(\d+(?:\.\d+)?)c?$/.exec(s))) return +m[1];
  if ((m = /^(\d+(?:\.\d+)?)s$/.exec(s))) return c.cps ? +m[1] * c.cps : null;
  return null;
}
export function span(raw, c = {}) { // length in cycles of "2b" / "2c" / "4s" / number
  const cpb = c.cpb ?? 1; if (typeof raw === 'number') return raw; const m = /^(\d+(?:\.\d+)?)([bcs]?)$/.exec(String(raw).trim()); if (!m) return null;
  return m[2] === 'b' ? +m[1] * cpb : m[2] === 's' ? (c.cps ? +m[1] * c.cps : null) : +m[1];
}
const strLit = (t) => { const v = lit(String(t ?? '').trim()); return typeof v === 'string' ? v : null; };
// a capture definition from its call arguments (text or values): { name, picker, what, from, until | last, live, max, guard }
export function define(name, picker, opts = {}, ctx = {}) {
  if (typeof name !== 'string' || !NAME.test(name)) throw code('E_CAPTURE_NAME', `capture name "${name}" must be a name (letters, digits, _ and -)`);
  if (typeof picker !== 'string' || !picker.trim()) throw code('E_CAPTURE_LAYER', `capture "${name}" needs a picker (selector, tap ref, bus:<name> or master)`);
  const o = opts || {}; const kind = pickerKind(picker.trim()); const what = o.what === undefined ? defaultWhat(picker.trim()) : [].concat(o.what);
  for (const w of what) if (!LAYERS.includes(w)) throw code('E_CAPTURE_LAYER', `capture "${name}": unknown layer "${w}" (events, audio, level)`);
  if (kind === 'tap' && what.some((w) => w !== 'events')) throw code('E_CAPTURE_LAYER', `capture "${name}": a tap ref gives events only, not ${what.filter((w) => w !== 'events').join(', ')}`);
  if ((kind === 'bus' || kind === 'master') && what.includes('events')) throw code('E_CAPTURE_LAYER', `capture "${name}": ${picker} has no events (audio and level only)`);
  const d = { name, picker: picker.trim(), kind, what: LAYERS.filter((l) => what.includes(l)), live: o.live === undefined ? 'auto' : o.live, max: o.max ?? LIMITS.maxSeconds, guard: o.guard ?? LIMITS.guard };
  if (o.window !== undefined && o.last !== undefined) throw code('E_CAPTURE_LIMIT', `capture "${name}": window and last are exclusive`);
  if (o.last !== undefined) { const l = span(o.last, ctx); if (!(l > 0)) throw code('E_CAPTURE_LIMIT', `capture "${name}": last "${o.last}" is not a length`); d.last = l; d.from = null; d.until = null; }
  else {
    const w = o.window; const [a, b] = Array.isArray(w) ? w : typeof w === 'string' && w.includes('..') ? w.split('..') : w && typeof w === 'object' ? [w.from, w.until] : [null, null];
    const f = a == null ? null : point(a, ctx), u = b == null ? null : point(b, ctx); if (f == null || u == null || !(u > f)) throw code('E_CAPTURE_LIMIT', `capture "${name}": needs window: "<from>..<until>" (a single bounded window, until after from) or last: "<length>"`);
    d.from = f; d.until = u; d.last = null;
  }
  return d;
}
export const lengthOf = (d) => (d.last != null ? d.last : d.until - d.from);

// ---------------------------------------------------------------- static analysis
const BODY = /^(\$|[A-Za-z_]\w*)\s*:(?!:)\s*/;
const LIVE_SRC = [[/\bctl\s*\(/, 'a ctl() control'], [/\bhooks\s*\.\s*map\b/, 'a control map'], [/\btap\s*\(\s*["'`]pads?[/:]/, 'a pad tap'], [/\b(?:input|midin|midiin|mouse|audioIn)\s*\(/, 'an input']];
const faceName = (s) => { const i = String(s).indexOf(':'); return i < 0 ? [String(s), 'ev'] : [s.slice(0, i), s.slice(i + 1)]; };
export function analyze(src, o = {}) {
  const text = String(src); const sts = statements(text); const g = scan(text); const diag = [];
  const add = (level, c, msg, line, extra = {}) => diag.push({ level, code: c, msg, ...(line ? { line } : {}), ...extra });
  const ctx = { cpb: o.cpb ?? 1, bpb: o.bpb ?? 4, cps: o.cps }; let cps = o.cps; const sc = /\bsetcps\s*\(\s*(-?[\d.]+)\s*\)|\bsetCps\s*\(\s*(-?[\d.]+)\s*\)/.exec(text); if (sc) cps = +(sc[1] ?? sc[2]); else if (cps == null) { const bpm = /\bsetcpm\s*\(\s*([\d.]+)\s*\)/.exec(text); if (bpm) cps = +bpm[1] / 60; }
  ctx.cps = cps ?? 0.5;
  const laneAt = new Map(g.lanes.map((l) => [l.line, l])); const captures = []; const recalls = []; const lanesText = new Map();
  for (const st of sts) {
    const lane = laneAt.get(st.line); if (lane) lanesText.set(lane.id, st.text);
    const cs = calls(st.text);
    for (const c of cs) {
      if (c.bare && c.name === 'capture' && !lane && c.depth === 0) {
        const name = strLit(c.args[0]), picker = strLit(c.args[1]); const op = c.args[2] === undefined ? {} : lit(c.args[2]);
        if (name == null || picker == null || op === undefined) { add('error', 'E_CAPTURE_NAME', 'capture(name, picker, opts) needs a literal name, a literal picker and a literal options object so it can be checked', st.line); continue; }
        try { captures.push({ ...define(name, picker, op, ctx), line: st.line }); } catch (e) { add('error', e.code || 'E_CAPTURE_LIMIT', e.message.replace(/^E_\w+: /, ''), st.line, { capture: name }); }
      }
      if ((c.bare && c.name === 'recall') || (!c.bare && c.name === 'from')) {
        const spec = strLit(c.args[0]); if (spec == null) continue; const [name, facet] = faceName(spec); const op = c.name === 'from' ? {} : c.args[1] === undefined ? {} : lit(c.args[1]);
        recalls.push({ name, facet: c.name === 'from' ? 'audio' : facet, lane: lane ? lane.id : null, line: st.line + (st.text.slice(0, c.at).match(/\n/g) || []).length, gate: op && op.gate, via: c.name });
      }
    }
  }
  const byName = new Map(); for (const c of captures) { if (byName.has(c.name)) add('error', 'E_CAPTURE_NAME', `capture "${c.name}" is defined twice (lines ${byName.get(c.name).line} and ${c.line})`, c.line, { capture: c.name }); else byName.set(c.name, c); }
  const sounds = o.sounds ? new Set(o.sounds) : null; for (const c of captures) if (sounds && sounds.has('cap_' + c.name)) add('error', 'E_CAPTURE_NAME', `the sound name "cap_${c.name}" already exists`, c.line, { capture: c.name });
  const laneTags = g.lanes.map((l) => ({ id: l.id, tags: l.tags }));
  const sel = (c) => { if (c.kind === 'tap') { const lane = c.picker.split('/')[0]; return laneTags.filter((l) => l.id === lane).map((l) => l.id); } if (c.kind !== 'selector') return []; try { const f = (n) => (n.all ? () => true : n.tag ? (l) => l.tags.includes(n.tag) : n.lane ? (l) => l.id === n.lane : n.not ? ((h) => (l) => !h(l))(f(n.not)) : ((ls) => (n.or ? (l) => ls.some((h) => h(l)) : (l) => ls.every((h) => h(l))))((n.or || n.and).map(f))); const h = f(parseSelector(c.picker)); return laneTags.filter(h).map((l) => l.id); } catch (e) { add('error', 'E_BAD_SELECTOR', String(e.message).replace(/^E_\w+: /, ''), c.line, { capture: c.name }); return []; } };
  for (const c of captures) c.lanes = sel(c);
  // layers a recall needs
  for (const r of recalls) { const c = byName.get(r.name); if (!c) { add('warn', 'W_CAPTURE_UNKNOWN', `recall("${r.name}") has no capture(...) of that name in this program`, r.line, { capture: r.name }); continue; } const layer = FACET_LAYER[r.facet]; if (layer && !c.what.includes(layer)) add('error', 'E_CAPTURE_LAYER', `${r.via === 'from' ? '.from' : 'recall'}("${r.name}${r.via === 'from' ? '' : ':' + r.facet}") needs the ${layer} layer, but capture "${r.name}" records ${c.what.join(', ')}`, r.line, { capture: r.name }); }
  // dependencies: capture C depends on capture N when a picked lane of C recalls N
  const dep = new Map(captures.map((c) => [c.name, new Set()])); for (const c of captures) for (const r of recalls) if (r.lane && c.lanes.includes(r.lane) && byName.has(r.name)) dep.get(c.name).add(r.name);
  const order = []; const state = new Map(); const cyc = new Set();
  const visit = (n, stack) => { if (state.get(n) === 2) return; if (state.get(n) === 1) { const i = stack.indexOf(n); cyc.add(stack.slice(i).concat(n).join(' -> ')); return; } state.set(n, 1); for (const m of [...dep.get(n)].sort()) visit(m, stack.concat(n)); state.set(n, 2); order.push(n); };
  for (const c of captures) visit(c.name, []);
  for (const path of cyc) { const first = byName.get(path.split(' -> ')[0]); add('error', 'E_CAPTURE_CYCLE', `capture dependency cycle: ${path} (a picked lane recalls the capture that picks it)`, first && first.line, { capture: first && first.name }); }
  // purity (section 6.2): a picked lane with a live source, or one that recalls a live capture, makes a capture live
  const reason = new Map();
  const own = (c) => { for (const id of c.lanes) { const t = lanesText.get(id) || ''; for (const [re, why] of LIVE_SRC) { const m = re.exec(t); if (m) { if (/ctl/.test(why) && o.automated) { const names = [...t.matchAll(/\bctl\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((x) => x[1]); if (names.length && names.every((n) => o.automated.includes(n))) continue; } return `lane "${id}" reads ${why}`; } } } return null; };
  const resolve = (n, seen = new Set()) => { if (reason.has(n)) return reason.get(n); if (seen.has(n)) return null; seen.add(n); const c = byName.get(n); let r = own(c); if (!r) for (const m of [...dep.get(n)].sort()) { const x = resolve(m, seen); if (x) { r = `it recalls capture "${m}", which is live (${x})`; break; } } reason.set(n, r); return r; };
  for (const c of captures) {
    const why = resolve(c.name); c.pure = !why; c.liveReason = why || null;
    if (c.live === false && why) add('error', 'E_CAPTURE_LIVE', `capture "${c.name}" has live: false but ${why}; offline resolution is impossible`, c.line, { capture: c.name });
    c.isLive = c.live === true ? true : c.live === false ? false : !!why;
    c.availableAt = c.isLive ? (c.until != null ? c.until + c.guard : null) : 0;
    const secs = lengthOf(c) / ctx.cps; if (c.what.some((w) => w !== 'events') && secs > c.max + 1e-9) add('error', 'E_CAPTURE_LIMIT', `capture "${c.name}" records ${secs.toFixed(1)} s of audio, over max ${c.max} s (never truncated)`, c.line, { capture: c.name });
  }
  for (const r of recalls) { // E_CAPTURE_EARLY: a gate that opens before the capture is usable
    const c = byName.get(r.name); if (!c || !c.isLive || c.availableAt == null || r.gate == null) continue; const first = typeof r.gate === 'string' ? point(r.gate.split('..')[0], ctx) : Array.isArray(r.gate) ? point(r.gate[0], ctx) : null;
    if (first != null && first < c.availableAt - 1e-9) add('warn', 'E_CAPTURE_EARLY', `recall("${r.name}") is gated to open at cycle ${first}, before live capture "${r.name}" is usable (until ${c.until} + guard ${c.guard} = cycle ${c.availableAt})`, r.line, { capture: r.name });
  }
  return { captures: captures.map(({ ...c }) => c), recalls, order, diagnostics: diag, cps: ctx.cps };
}
export function checkCaptures(src, o = {}) { const t = String(src); return /\bcapture\s*\(|\brecall\s*\(|\.\s*from\s*\(/.test(t) ? analyze(t, o).diagnostics : []; }
if (!EXT.includes(checkCaptures)) EXT.push(checkCaptures);

// ---------------------------------------------------------------- level and memory (pure functions)
// RMS and peak of the stereo sum per 1/64 cycle, linear 0..1 against full scale (LANES 6.1, 12.6). `cycles` = length of the capture.
export function levelOf(Lc, Rc, sr, cps, cycles, per = LIMITS.levelPerCycle) {
  const n = Math.max(1, Math.round(cycles * per)); const rms = new Float32Array(n), peak = new Float32Array(n); const step = sr / cps / per;
  for (let i = 0; i < n; i++) { const a = Math.round(i * step), b = Math.min(Lc.length, Math.round((i + 1) * step)); let s = 0, p = 0; for (let k = a; k < b; k++) { const l = Lc[k], r = Rc ? Rc[k] : l; s += (l * l + r * r) / 2; const m = Math.max(Math.abs(l), Math.abs(r)); if (m > p) p = m; } rms[i] = b > a ? Math.sqrt(s / (b - a)) : 0; peak[i] = p; }
  return { rms, peak, per };
}
export function createBudget(limit) { // bytes; rolling captures nobody read are dropped first (LANES 6.4)
  const items = new Map(); const B = { limit, items, used: 0 };
  B.reserve = (name, bytes, o = {}) => {
    if (items.has(name)) { B.used -= items.get(name).bytes; items.delete(name); }
    if (B.used + bytes > B.limit) { for (const [k, v] of [...items]) { if (B.used + bytes <= B.limit) break; if (v.rolling && !v.read) { B.used -= v.bytes; items.delete(k); if (o.onDrop) o.onDrop(k); } } }
    if (B.used + bytes > B.limit) throw code('E_CAPTURE_MEMORY', `capture "${name}" needs ${(bytes / 1048576).toFixed(1)} MB; ${(B.used / 1048576).toFixed(1)} of ${(B.limit / 1048576).toFixed(0)} MB are in use and nothing unread can be dropped`);
    items.set(name, { bytes, rolling: !!o.rolling, read: !!o.read }); B.used += bytes; return true;
  };
  B.read = (name) => { const v = items.get(name); if (v) v.read = true; };
  B.release = (name) => { const v = items.get(name); if (v) { B.used -= v.bytes; items.delete(name); } };
  return B;
}
export const audioBytes = (nframes) => nframes * 2 * 4;

// ---------------------------------------------------------------- runtime
let CURRENT = null;
export function installCapture(L, S, hooks, o = {}) {
  if (L.captures && L.captures.__cap) { CURRENT = L.captures; return L.captures; }
  const { Pattern } = S; const F = S.Fraction, Hap = S.Hap, TimeSpan = S.TimeSpan, State = S.State;
  if (!F || !Hap || !TimeSpan) throw code('E_BAD_ARG', 'installCapture needs Fraction, Hap and TimeSpan of Strudel');
  const proto = Pattern.prototype; const useGlobal = o.global !== false; const mark = (f) => { f.__cap = true; return f; };
  if (proto.from && !proto.from.__cap) throw code('E_NAME_COLLISION', 'Pattern.prototype.from already exists in the loaded Strudel');
  if (useGlobal) for (const n of ['capture', 'recall']) if (n in globalThis && !globalThis[n]?.__cap && !(typeof Element !== 'undefined' && globalThis[n] instanceof Element)) throw code('E_NAME_COLLISION', `global ${n} already exists`);
  const plain = (x) => (x && typeof x === 'object' && typeof x.__pure === 'string' && typeof x.query === 'function' ? x.__pure : x);
  const num = (x) => (typeof x === 'number' ? x : +String(x));
  const cyc = (c) => { const [n, d] = String(c).split('/'); return +n / (d ? +d : 1); };
  const defs = new Map(); const store = new Map(); const budget = createBudget(o.memoryBytes ?? memoryLimit(globalThis.navigator?.deviceMemory)); const diag = []; const seen = new Set();
  let src = ''; let an = null; let program = o.program || null; let busy = 0; let tapRead = null; const resolving = [];
  const note = (level, c, msg) => { const k = c + '|' + msg; if (seen.has(k)) return; seen.add(k); diag.push({ level, code: c, msg }); if (hooks.live) console.warn(`[lanes] ${c} ${msg}`); };
  const analysis = () => { if (!an && src) { try { an = analyze(src, { cpb: hooks.cpb, bpb: hooks.bpb, cps: hooks.cps, automated: o.automated, sounds: undefined }); } catch { an = { captures: [], recalls: [], diagnostics: [] }; } } return an; };
  const cpsNow = (ctrl) => hooks.cps ?? ctrl?._cps ?? 0.5;
  const ptx = () => ({ cpb: hooks.cpb, bpb: hooks.bpb, cps: hooks.cps });

  // the program pattern: the receiver of the outermost query (or set by the host); live recording sees the final haps of every outermost query
  if (!proto.queryArc.__capProg) {
    const orig = proto.queryArc; const w = function queryArc(...a) { if (!busy && !w.__depth) program = this; w.__depth = (w.__depth || 0) + 1; try { return orig.apply(this, a); } finally { w.__depth--; } };
    w.__capProg = true; w.__lanes = orig.__lanes; w.__lanesSel = orig.__lanesSel; w.__scMaps = orig.__scMaps; Object.defineProperty(w, 'name', { value: 'queryArc' }); proto.queryArc = w;
  }
  L.stampers.push(() => defs.size > 0);

  // ---- captured events: relative wholes (Fractions), values, tags, lane id ----
  const rec = (h, base) => ({ wb: h.whole ? h.whole.begin.sub(base) : null, we: h.whole ? h.whole.end.sub(base) : null, pb: h.part.begin.sub(base), pe: h.part.end.sub(base), value: h.value, tags: h.context?.tags ? [...h.context.tags] : [], lane: h.context?.lane ?? null });
  const pickOf = (d) => {
    if (d.kind === 'tap') { const ref = d.picker; return { tap: ref }; }
    return { m: matcher(parseSelector(d.picker)) };
  };
  const laneMatches = (d, laneId) => { if (d.kind !== 'selector' && d.kind !== 'tap') return false; const a = analysis(); if (!a) return true; const lane = (a.lanesInfo || (a.lanesInfo = scan(src).lanes)).find((l) => l.id === laneId); if (!lane) return true; if (d.kind === 'tap') return d.picker.split('/')[0] === laneId; const f = (n) => (n.all ? true : n.tag ? lane.tags.includes(n.tag) : n.lane ? n.lane === lane.id : n.not ? !f(n.not) : n.or ? n.or.some(f) : n.and.every(f)); try { return f(parseSelector(d.picker)); } catch { return true; } };
  function queryProgram(b, e, ctrl) { // the picked program's haps over [b, e) without the outermost-query wrappers (selections are applied here once)
    const prog = program; if (!prog) return [];
    const st = new State(new TimeSpan(F(b), F(e)), ctrl); let haps = prog.query(st); haps = L.apply(haps, [b, e, ctrl]); return haps;
  }
  function pickHaps(d, haps) {
    const p = pickOf(d); if (p.m) return haps.filter(p.m);
    return [];
  }
  const onsetIn = (h, a, z) => { if (!h.whole) return false; const t = +h.whole.begin; return t >= a - 1e-12 && t < z - 1e-12; };
  function offline(d, a, z, ctrl) { // events of the picked lanes with onsets in [a, z), relative to a
    const base = F(a); busy++; resolving.push(d); try {
      let haps = queryProgram(a, z, ctrl); let out;
      if (d.kind === 'tap') { const T = (o.tap || globalThis.tap); if (typeof T !== 'function') throw code('E_CAPTURE_LAYER', `capture "${d.name}": tap refs need the hooks runtime`); const tp = T(d.picker); out = tp.query(new State(new TimeSpan(F(a), F(z)), ctrl)); } else out = pickHaps(d, haps);
      const r = out.filter((h) => onsetIn(h, a, z)).map((h) => rec(h, base)); if (r.length > LIMITS.maxHaps) throw code('E_CAPTURE_LIMIT', `capture "${d.name}" has ${r.length} events (limit ${LIMITS.maxHaps})`);
      return r;
    } finally { resolving.pop(); busy--; }
  }

  // ---- live recording ----
  const rec2 = new Map(); // name -> { haps: [], closed, seenTo }
  const keyOf = (r) => JSON.stringify([String(r.wb), String(r.pb), r.lane, r.value]);
  const observe = (haps, args) => {
    if (busy || !defs.size) return; const [b, e] = [+args[0], +args[1]];
    for (const d of defs.values()) {
      if (!isLive(d) || !d.what.includes('events')) continue; const R = rec2.get(d.name) || (rec2.set(d.name, { haps: new Map(), closed: false, to: 0 }), rec2.get(d.name));
      const upper = d.until != null ? d.until : Infinity; if (R.closed) continue;
      const base = F(d.from ?? 0); const pk = pickHaps(d, haps).filter((h) => (d.until != null ? onsetIn(h, d.from, d.until) : h.whole && +h.whole.begin >= 0));
      if (d.kind === 'tap') { busy++; try { const T = o.tap || globalThis.tap; for (const h of T(d.picker).query(new State(new TimeSpan(F(b), F(e)), args[2] || {}))) if (h.whole && onsetIn(h, d.from ?? 0, upper)) { const r = rec(h, base); r.abs = +h.whole.begin; R.haps.set(keyOf(r), r); } } catch { /* tap not published yet */ } finally { busy--; } }
      else for (const h of pk) { const r = rec(h, base); r.abs = +h.whole.begin; R.haps.set(keyOf(r), r); }
      if (d.last != null) for (const [k, r] of R.haps) if (r.abs < e - d.last - d.guard - 2) R.haps.delete(k);
      if (R.haps.size > LIMITS.maxHaps) { note('error', 'E_CAPTURE_LIMIT', `capture "${d.name}" has more than ${LIMITS.maxHaps} events`); R.closed = true; }
      if (e >= upper - 1e-12) R.closed = true; R.to = Math.max(R.to, e);
    }
  };
  L.after.push(observe);
  const isLive = (d) => { if (d.live === true) return true; if (d.live === false) return false; const a = analysis(); const c = a && a.captures.find((x) => x.name === d.name); return !!(c && !c.pure); };

  // ---- state of a capture at cycle c: { haps, len, origin } or null (not available: the else branch) ----
  const memo = new Map();
  const frozenAt = (name, c) => { let last = null; for (const e of hooks.journal) if ((e.op === 'freeze' || e.op === 'thaw') && e.args[0] === name && cyc(e.cycle) <= c + 1e-12) if (!last || cyc(e.cycle) >= cyc(last.cycle)) last = e; return last && last.op === 'freeze' ? cyc(last.cycle) : null; };
  function state(name, c, ctrl) {
    const d = defs.get(name); if (!d) return null; const live = isLive(d); const len = lengthOf(d);
    if (d.last == null) { // window
      if (live) { const t = d.until + d.guard; if (c < t - 1e-12) return null; const R = rec2.get(name); if (!R || !R.closed) return null; return { haps: [...R.haps.values()].sort((x, y) => x.abs - y.abs), len }; }
      const k = `${name}|w`; if (!memo.has(k)) memo.set(k, offline(d, d.from, d.until, { ...(ctrl || {}), _cps: cpsNow(ctrl) })); return { haps: memo.get(k), len };
    }
    const at = frozenAt(name, c); const eff = at == null ? c : at; const q = Math.floor(eff - d.guard + 1e-12); if (q <= 0) return null; const a = q - d.last;
    const kl = `${name}|q${q}`; if (live && memo.has(kl)) return memo.get(kl);
    if (live) { const R = rec2.get(name); if (!R) return null; const haps = [...R.haps.values()].filter((r) => r.abs >= a - 1e-12 && r.abs < q - 1e-12).map((r) => ({ ...r, wb: r.wb.sub(F(a - (d.from ?? 0))), we: r.we.sub(F(a - (d.from ?? 0))), pb: r.pb.sub(F(a - (d.from ?? 0))), pe: r.pe.sub(F(a - (d.from ?? 0))) })); const res = { haps, len, q }; memo.set(kl, res); return res; }
    const k = `${name}|q${q}`; if (!memo.has(k)) memo.set(k, offline(d, Math.max(a, 0), q, { ...(ctrl || {}), _cps: cpsNow(ctrl) }).map((r) => (a < 0 ? shift(r, -a) : r))); return { haps: memo.get(k), len, q };
  }
  const shift = (r, x) => ({ ...r, wb: r.wb && r.wb.add(F(x)), we: r.we && r.we.add(F(x)), pb: r.pb.add(F(x)), pe: r.pe.add(F(x)) });
  const availAt = (d) => (isLive(d) ? (d.until != null ? d.until + d.guard : (d.guard + 1)) : 0);

  // ---- recall ----
  const parseSpec = (spec) => { const [name, facet] = faceName(String(plain(spec))); return { name, facet }; };
  const gateOpen = (g, id) => { if (g == null) return () => true; const f = hooks.gateAt(plain(g), id); return (t, ctrl) => f(t, ctrl); };
  function guardCycle(name, laneId) { // a lane that recalls the capture being resolved (or one it depends on): the cycle of LANES 6.2
    const top = resolving[resolving.length - 1]; if (!top) return 'go';
    if (resolving.some((x) => x.name === name)) { const hit = resolving.filter((x, i) => i >= resolving.findIndex((y) => y.name === name)); if (laneId == null || hit.some((x) => laneMatches(x, laneId))) throw code('E_CAPTURE_CYCLE', `capture "${name}" is recalled by a lane that it picks (${resolving.map((x) => x.name).concat(name).join(' -> ')})`); return 'skip'; }
    if (laneId != null && !laneMatches(top, laneId)) return 'skip'; return 'go';
  }
  const piecesOf = (b, e) => { // [begin, end) Fractions split at cycle boundaries; a zero-width span is one piece
    if (e.lte(b)) return [[b, b]]; const out = []; let x = b; while (x.lt(e)) { const nx = x.nextSam().min(e); out.push([x, nx]); x = nx; } return out;
  };
  const evHaps = (st, b, e, at, once) => {
    const { haps, len } = st; const out = []; const lenF = F(len), atF = F(at); const l0 = Math.floor((+b - at) / len), l1 = Math.ceil((+e - at) / len);
    for (let k = l0; k < Math.max(l1, l0 + 1); k++) {
      if (once && k !== 0) continue; const off = atF.add(F(k).mul(lenF));
      for (const r of haps) {
        const pb = r.pb.add(off), pe = r.pe.add(off); const sb = pb.max(b), se = pe.min(e);
        if (b.eq(e)) { if (!(pb.lte(b) && b.lt(pe))) continue; } else if (!sb.lt(se)) continue;
        out.push(new Hap(r.wb ? new TimeSpan(r.wb.add(off), r.we.add(off)) : undefined, new TimeSpan(sb, se.lt(sb) ? sb : se), r.value, { tags: [] }));
      }
    }
    return out;
  };
  function capPattern(name, facet, opts) {
    const at = opts.at != null ? num(plain(opts.at)) : 0; const once = !!opts.once; const gate = gateOpen(opts.gate, `recall.${name}`);
    return new Pattern((state0) => {
      const sp = state0.span; const ctrl = state0.controls || {}; const d = defs.get(name); if (!d) { note('warn', 'W_CAPTURE_UNKNOWN', `recall("${name}") has no capture of that name`); return []; }
      const lane = ctrl.id != null ? String(ctrl.id) : null; if (guardCycle(name, lane) === 'skip') return [];
      if (FACET_LAYER[facet] && !d.what.includes(FACET_LAYER[facet])) { note('error', 'E_CAPTURE_LAYER', `recall("${name}:${facet}") needs the ${FACET_LAYER[facet]} layer, but capture "${name}" records ${d.what.join(', ')}`); return []; }
      const out = [];
      for (const [x, y] of piecesOf(sp.begin, sp.end)) {
        if (!gate(x, ctrl)) continue; if (+x < availAt(d) - 1e-12) continue;
        if (facet === 'level') { // a signal from the captured audio's level, looping with the capture's length (window captures; rolling levels are coming)
          const lv = store.get(name)?.level; if (!lv || d.last != null) continue; budget.read(name); const len = lengthOf(d); const p = ((+x - at) % len + len) % len; out.push(new Hap(undefined, new TimeSpan(x, y), lv.rms[Math.min(lv.rms.length - 1, Math.floor(p * lv.per))], {})); continue;
        }
        const st = state(name, +x, ctrl); if (!st) continue; budget.read(name);
        if (facet === 'ev') out.push(...evHaps(st, x, y, at, once));
        else if (facet === 'onset' || facet === 'gate') for (const h of evHaps(st, x, y, at, once)) out.push(new Hap(h.whole, h.part, true, h.context));
        else { // a control of the captured events: held from the latest captured event at or before x
          const p = ((+x - at) % st.len + st.len) % st.len; let v; for (const r of st.haps) if (r.wb && +r.wb <= p + 1e-12 && r.value && typeof r.value === 'object' && facet in r.value) v = r.value[facet]; if (v !== undefined) out.push(new Hap(undefined, new TimeSpan(x, y), v, {}));
        }
      }
      return out;
    });
  }
  const audioPattern = (name, opts) => { // s("cap_<name>").loopAt(length), one hap per loop, empty before the audio is available
    const d = defs.get(name); const s = S.s || globalThis.s; if (!s) throw code('E_BAD_ARG', 'recall(...:audio) needs the s() control');
    const len = d ? lengthOf(d) : 1; const p = s('cap_' + name).loopAt(len); return gated(name, p, opts);
  };
  const gated = (name, p, opts = {}) => new Pattern((state0) => {
    const ctrl = state0.controls || {}; const d = defs.get(name); if (!d) { note('warn', 'W_CAPTURE_UNKNOWN', `capture "${name}" is not defined`); return []; }
    const lane = ctrl.id != null ? String(ctrl.id) : null; if (guardCycle(name, lane) === 'skip') return [];
    const st = store.get(name); const cps0 = st && st.cps; const now = hooks.cps ?? ctrl._cps; if (cps0 && now && Math.abs(cps0 - now) > 1e-6) { note('warn', 'W_CAPTURE_TEMPO', `capture "${name}" was recorded at cps ${cps0}, now ${now}: the audio is repitched (stretch needs the CLI warp tool and is refused on the site)`); }
    const gate = gateOpen(opts.gate, `recall.${name}`); const sp = state0.span; const out = [];
    for (const [x, y] of piecesOf(sp.begin, sp.end)) { if (!gate(x, ctrl)) continue; if (+x < availAt(d) - 1e-12) continue; budget.read(name); out.push(...p.query(state0.setSpan(new TimeSpan(x, y)))); }
    return out;
  });
  const recall = mark((spec, opts = {}) => {
    const { name, facet } = parseSpec(spec); const op = plain(opts) || {}; if (!(facet === 'ev' || facet === 'audio' || facet === 'level' || facet === 'onset' || facet === 'gate' || /^[A-Za-z_]\w*$/.test(facet))) throw code('E_CAPTURE_LAYER', `unknown facet "${facet}"`);
    if (facet === 'audio') { const p = audioPattern(name, op); return p; }
    return capPattern(name, facet, op);
  });
  const capture = mark((name, picker, opts = {}) => {
    const n = plain(name), p = plain(picker); const op = {}; for (const [k, v] of Object.entries(plain(opts) || {})) op[k] = Array.isArray(v) ? v.map(plain) : plain(v);
    const d = define(n, p, op, ptx()); if (hooks.cps && d.what.some((w) => w !== 'events') && lengthOf(d) / hooks.cps > d.max + 1e-9) throw code('E_CAPTURE_LIMIT', `capture "${n}" records ${(lengthOf(d) / hooks.cps).toFixed(1)} s of audio, over max ${d.max} s (never truncated)`); if (!hooks.frozen || !defs.has(n)) { const prev = defs.get(n); const same = prev && JSON.stringify(prev) === JSON.stringify(d); if (prev && !same && !hooks.frozen) throw code('E_CAPTURE_NAME', `capture "${n}" is already defined with another picker or window`); if (!prev) defs.set(n, d); }
    const sm = o.soundMap || globalThis.soundMap; try { const have = sm && typeof sm.get === 'function' ? sm.get() : null; if (have && have['cap_' + n] && !(store.get(n) && store.get(n).registered)) throw code('E_CAPTURE_NAME', `the sound name "cap_${n}" already exists`); } catch (e) { if (e.code) throw e; }
    return { __capture: true, name: n, picker: d.picker, what: d.what };
  });
  proto.from = mark(function from(name, opts) { const n = String(plain(name)); const p = this.s ? this.s('cap_' + n) : this; return gated(n, p, plain(opts) || {}); });
  if (useGlobal) { globalThis.capture = capture; globalThis.recall = recall; }

  // ---- registry glue ----
  const reset = () => { defs.clear(); memo.clear(); rec2.clear(); resolving.length = 0; an = null; for (const [k, v] of store) if (!v.registered) store.delete(k); };
  hooks.ext.reset.push(reset); hooks.ext.load && hooks.ext.load.push(() => memo.clear());
  const p0 = L.prepare; L.prepare = function prepare(s, ...r) { if (s !== src) { src = String(s); an = null; memo.clear(); } return p0.call(this, s, ...r); };
  const C = {
    __cap: true, defs: () => [...defs.values()].map((d) => ({ ...d })), analyze: () => analysis(), diagnostics: () => diag.map((d) => ({ ...d })),
    freeze(name, at) { if (!defs.has(name)) throw code('E_BAD_ARG', `no capture "${name}"`); hooks.record('freeze', [name], at ?? 'next'); memo.clear(); return C; },
    thaw(name, at) { if (!defs.has(name)) throw code('E_BAD_ARG', `no capture "${name}"`); hooks.record('thaw', [name], at ?? 'next'); memo.clear(); return C; },
    setProgram(p) { program = p; return C; },
    // events of a capture at cycle c (the state a recall at c sees), plain data; null before it is available
    content(name, c = Infinity) { const d = defs.get(name); if (!d) return null; if (c < availAt(d) - 1e-12) return null; const st = state(name, Number.isFinite(c) ? c : availAt(d) + (d.last || 0) + 1, {}); return st && { len: st.len, haps: st.haps.map((r) => ({ begin: +r.wb, end: +r.we, value: r.value, tags: r.tags, lane: r.lane })) }; },
    availableAt: (name) => { const d = defs.get(name); return d ? availAt(d) : null; },
    // audio of a capture, delivered by the host (the site renders the picked lanes offline, the CLI reads its WAV): checks the budget, derives the level
    setAudio(name, pcm, meta = {}) {
      const d = defs.get(name); if (!d) throw code('E_BAD_ARG', `no capture "${name}"`); const cps = meta.cps ?? cpsNow({}); const len = lengthOf(d); const nf = pcm.L.length;
      if (nf / pcm.sr > d.max + 1e-9) throw code('E_CAPTURE_LIMIT', `capture "${name}" has ${(nf / pcm.sr).toFixed(1)} s of audio, over max ${d.max} s`);
      budget.reserve(name, audioBytes(nf), { rolling: d.last != null, onDrop: (k) => { store.delete(k); note('warn', 'E_CAPTURE_MEMORY', `rolling capture "${k}" was dropped (nobody read it) to make room`); } });
      const level = d.what.includes('level') ? levelOf(pcm.L, pcm.R, pcm.sr, cps, len) : null; const e = { ...pcm, cps, frames: nf, level, registered: false, ...meta }; store.set(name, e); return e;
    },
    audio: (name) => store.get(name) || null, budget, level: (name) => store.get(name)?.level || null,
    register(name, host) { const e = store.get(name); if (!e) throw code('E_BAD_ARG', `no audio for capture "${name}"`); host.registerSound('cap_' + name, e); e.registered = true; return e; },
    frames, memo, state: (name, c) => state(name, c, {}), pending: () => [...defs.keys()],
  };
  // the state word the capture node shows (lanes-ui.js capState): empty (nothing yet), recording (window open or a rolling capture running), frozen (window closed / a journaled freeze)
  L.captureState = (name) => {
    const d = defs.get(name); if (!d) return 'empty';
    if (d.last != null) { const R = rec2.get(name); if (hooks.journal.some((e) => e.op === 'freeze' && e.args[0] === name) && frozenAt(name, Infinity) != null) return 'frozen'; return isLive(d) ? (R && R.to ? 'recording' : 'empty') : (memo.size || program ? 'recording' : 'empty'); }
    if (isLive(d)) { const R = rec2.get(name); return R && R.closed ? 'frozen' : R && R.to ? 'recording' : 'empty'; }
    return [...memo.keys()].some((k) => k === `${name}|w`) ? 'frozen' : 'empty';
  };
  L.captures = C; CURRENT = C; return C;
}
export const current = () => CURRENT;
