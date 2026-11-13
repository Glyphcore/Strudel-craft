// AST-bound control sites (docs/CONTROL_BINDING.md): find slider()/ctl() calls, give each a stable id, reconcile across edits,
// rewrite to sliderWithID('id', ...) / ctlAt('id', ...). Pure module, no DOM. Parser: acorn 8.19.0 (vendored, unmodified).
import * as acorn from '../vendor/acorn-8.19.0.mjs';

const OPTS = { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
export function parse(code) { try { return { ok: true, ast: acorn.parse(code, OPTS) }; } catch (e) { return { ok: false, error: e, line: e.loc ? e.loc.line : null, message: String(e.message) }; } }

export function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
export const hashId = (path) => 'k' + fnv(path).toString(36).padStart(7, '0').slice(-6);

const calleeName = (c) => (c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null);
function chainOf(call) { // method names from the chain root: note("c").s("x").lpf(...) -> note.s.lpf
  const out = []; let n = call;
  while (n) {
    if (n.type === 'CallExpression') { const nm = calleeName(n.callee); if (nm) out.unshift(nm); n = n.callee.type === 'MemberExpression' ? n.callee.object : null; }
    else if (n.type === 'MemberExpression') { if (!n.computed) out.unshift(n.property.name); n = n.object; }
    else { if (n.type === 'Identifier') out.unshift(n.name); n = null; }
  }
  return out.join('.');
}
const lit = (n) => (!n ? undefined : n.type === 'Literal' ? n.value : n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' ? -n.argument.value : undefined);
function objLit(n) { if (!n || n.type !== 'ObjectExpression') return undefined; const o = {}; for (const p of n.properties) { if (p.type !== 'Property') continue; const k = p.key.name ?? p.key.value; const v = p.value.type === 'ArrayExpression' ? p.value.elements.map(lit) : lit(p.value); if (v !== undefined) o[k] = v; } return o; }

// sites(code) -> { ok, sites[] } ; sites without ids yet (path only)
export function sites(code) {
  const p = parse(code); if (!p.ok) return { ok: false, error: p };
  const out = [];
  const walk = (node, anc, layer) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && (node.callee.name === 'slider' || node.callee.name === 'ctl')) {
      const segs = []; let param = null, arg = -1, slot = null;
      for (let i = 0; i < anc.length; i++) {
        const a = anc[i], child = anc[i + 1] || node;
        if (a.type === 'CallExpression') { const ai = a.arguments.indexOf(child); if (ai >= 0) { segs.push(chainOf(a) + '#' + ai); param = calleeName(a.callee); arg = ai; } }
      }
      for (let i = anc.length - 1; i >= 0; i--) { const a = anc[i]; if (a.type !== 'CallExpression') continue; const nm = calleeName(a.callee); const s0 = lit(a.arguments[0]);
        if (['use', 'wrap', 'tap', 'bind'].includes(nm) && typeof s0 === 'string') { slot = s0; break; } }
      const kind = node.callee.name, a0 = node.arguments;
      const site = { kind, layer, path: `L${layer}/${segs.join('>') || 'top'}`, param, arg, start: node.start, end: node.end, calleeEnd: node.callee.end, nargs: a0.length, slot };
      if (kind === 'slider') { site.value = lit(a0[0]); site.min = lit(a0[1]) ?? 0; site.max = lit(a0[2]) ?? 1; site.label = null; }
      else { const l = lit(a0[0]); site.label = typeof l === 'string' ? l : null; site.spec = objLit(a0[1]) || {}; }
      out.push(site);
    }
    anc.push(node);
    for (const k in node) { if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue; const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, anc, layer)); else if (v && typeof v.type === 'string') walk(v, anc, layer); }
    anc.pop();
  };
  p.ast.body.forEach((st, i) => walk(st, [], i));
  const seen = new Map(); for (const s of out) { const n = seen.get(s.path) || 0; seen.set(s.path, n + 1); if (n) s.path += '~' + n; }
  return { ok: true, sites: out, ast: p.ast };
}

// reconcile(prev, next): assign ids to next (path -> signature -> position -> new). Returns next with .id and .match
export function reconcile(prev = [], next = []) {
  const free = new Set(prev); const used = new Set();
  const take = (s, o, how) => { s.id = o.id; s.match = how; free.delete(o); used.add(o.id); };
  for (const s of next) { const o = [...free].find((x) => x.path === s.path && x.kind === s.kind); if (o) take(s, o, 'path'); }
  const pairs = (pred, cost) => { const c = []; for (const s of next) if (!s.id) for (const o of free) if (pred(s, o)) c.push([cost(s, o), s, o]); c.sort((a, b) => a[0] - b[0]); for (const [, s, o] of c) if (!s.id && free.has(o)) take(s, o, pred === sig ? 'structure' : 'position'); };
  const sig = (s, o) => s.kind === o.kind && s.param === o.param && s.arg === o.arg;
  pairs(sig, (s, o) => Math.abs(s.layer - o.layer) * 1000 + Math.abs(s.start - o.start));
  pairs((s, o) => s.kind === o.kind && s.layer === o.layer, (s, o) => Math.abs(s.start - o.start));
  const ids = new Set([...prev.map((x) => x.id), ...next.filter((x) => x.id).map((x) => x.id)]);
  for (const s of next) if (!s.id) { let id = hashId(s.path), n = 1; while (ids.has(id)) id = hashId(s.path + '#' + n++); s.id = id; s.match = 'new'; ids.add(id); }
  return next;
}

// rewrite(code, sites) -> code with ids injected (from the end, offsets stay valid); rewriteMap also returns the edits
export function rewriteMap(code, list) {
  let out = code; const edits = [];
  for (const s of [...list].sort((a, b) => b.start - a.start)) {
    const fn = s.kind === 'slider' ? 'sliderWithID' : 'ctlAt';
    const open = out.indexOf('(', s.calleeEnd); if (open < 0) continue;
    const ins = `${fn}('${s.id}'${s.nargs ? ', ' : ''}`; out = out.slice(0, s.start) + ins + out.slice(open + 1);
    edits.unshift({ at: s.start, del: open + 1 - s.start, ins: ins.length });
  }
  return { code: out, edits };
}
export const rewrite = (code, list) => rewriteMap(code, list).code;
// position in rewritten text -> position in the original text
export function toOriginal(edits, pos) {
  let delta = 0;
  for (const e of edits) { const ns = e.at + delta; if (pos < ns) break; if (pos < ns + e.ins) return e.at; delta += e.ins - e.del; }
  return pos - delta;
}

// per-view state: last good sites; prepare() reconciles without committing; rewritten texts remember their edits (visual offsets)
export function createBinder() {
  const good = new Map(); const maps = new Map();
  return {
    prepare(view, code) { const r = sites(code); if (!r.ok) return { ok: false, error: r.error }; reconcile(good.get(view) || [], r.sites); const w = rewriteMap(code, r.sites);
      maps.set(w.code, { orig: code, edits: w.edits }); if (maps.size > 16) maps.delete(maps.keys().next().value); return { ok: true, sites: r.sites, code: w.code }; },
    commit(view, list) { good.set(view, list.map((s) => ({ ...s }))); },
    sites: (view) => good.get(view) || [],
    original: (rew) => { const m = maps.get(rew); return m ? m.orig : rew; },
    toOriginal: (rew, pos) => { const m = maps.get(rew); return m ? toOriginal(m.edits, pos) : pos; },
  };
}

// ---------- literal sites (smart parameter editors, CONTROL_BINDING section 7) ----------
// mini-notation tokens inside a string: words, numbers, rests; groups = innermost [..] / <..> around a token
const TOK = /~|[A-Za-z0-9#_.\-]+/g;
export function miniTokens(str) {
  const out = []; let m; TOK.lastIndex = 0;
  while ((m = TOK.exec(str))) {
    const from = m.index, to = from + m[0].length; let depth = 0, open = -1, oc = '';
    for (let i = from - 1; i >= 0; i--) { const c = str[i]; if (c === ']' || c === '>' || c === '}') depth++; else if (c === '[' || c === '<' || c === '{') { if (depth) depth--; else { open = i; oc = c; break; } } }
    let close = -1; if (open >= 0) { depth = 0; for (let i = to; i < str.length; i++) { const c = str[i]; if (c === '[' || c === '<' || c === '{') depth++; else if (c === ']' || c === '>' || c === '}') { if (depth) depth--; else { close = i; break; } } } }
    const prevCh = str[from - 1];
    if (prevCh === '*' || prevCh === '/' || prevCh === '@' || prevCh === '!' || prevCh === ':' || prevCh === '?' || prevCh === '(') { out.push({ text: m[0], from, to, mod: true }); continue; }
    out.push({ text: m[0], from, to, group: open >= 0 && close > open ? { open, close, kind: oc, chord: oc === '[' && str.slice(open + 1, close).includes(',') } : null });
  }
  return out;
}
// literals(code) -> [{ id, path, kind: number|string|bool|token, param, arg, from, to, value, token?, group?, strFrom }]
export function literals(code) {
  const p = parse(code); if (!p.ok) return { ok: false, error: p };
  const out = [];
  const walk = (node, anc, layer) => {
    if (!node || typeof node.type !== 'string') return;
    const isNeg = node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number';
    if (node.type === 'Literal' || isNeg) {
      const segs = []; let param = null, arg = -1;
      for (let i = 0; i < anc.length; i++) { const a = anc[i], child = anc[i + 1] || node;
        if (a.type === 'CallExpression') { const ai = a.arguments.indexOf(child); if (ai >= 0) { segs.push(chainOf(a) + '#' + ai); param = calleeName(a.callee); arg = ai; } }
        else if (a.type === 'ArrayExpression') { const ai = a.elements.indexOf(child); if (ai >= 0) segs.push('[' + ai + ']'); } }
      const path = `L${layer}/${segs.join('>') || 'top'}`; const v = isNeg ? -node.argument.value : node.value;
      if (typeof v === 'number' || typeof v === 'boolean') out.push({ path, kind: typeof v, param, arg, from: node.start, to: node.end, value: v });
      else if (typeof v === 'string') {
        const q = code[node.start]; const body = node.start + 1;
        out.push({ path, kind: 'string', param, arg, from: node.start, to: node.end, value: v, quote: q });
        if (q !== '`') miniTokens(v).forEach((t, i) => out.push({ path: path + '@' + i, kind: 'token', param, arg, from: body + t.from, to: body + t.to, value: t.text, mod: !!t.mod,
          group: t.group ? { from: body + t.group.open, to: body + t.group.close + 1, kind: t.group.kind, chord: t.group.chord } : null, str: { from: node.start, to: node.end } }));
      }
      return;
    }
    anc.push(node);
    for (const k in node) { if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue; const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, anc, layer)); else if (v && typeof v.type === 'string') walk(v, anc, layer); }
    anc.pop();
  };
  p.ast.body.forEach((st, i) => walk(st, [], i));
  const seen = new Map(); for (const l of out) { const n = seen.get(l.path) || 0; seen.set(l.path, n + 1); if (n) l.path += '~' + n; l.id = 'l' + hashId(l.path).slice(1); }
  return { ok: true, literals: out };
}
export const literalAt = (code, pos) => { const r = literals(code); if (!r.ok) return null; const hit = r.literals.filter((l) => pos >= l.from && pos <= l.to); return hit.find((l) => l.kind === 'token') || hit[0] || null; };
