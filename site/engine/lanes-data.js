// Lanes L4 data consumers (docs/LANES.md section 10; issue #77). Pure module, no DOM, no Strudel: stable AST site ids for split / branch / send /
// selection / capture sites, static selector matching against lanes, the capture facet table, branch-safe controls and the wire-crossing rule.
// model.js builds records and graph() nodes from these helpers; intellisense (lanes-intellisense.js) and pads read them too.
// Bus numbers never appear here: they are allocated per compile by the audio layer (L2) and are not data.
import * as B from './bind.js';
import { parseSelector } from './lanes.js';
import { LAYERS, pickerKind, defaultWhat } from './lanes-pick.js';
export { LAYERS, pickerKind, defaultWhat };

const FIX = { split: 'p', branch: 'p', send: 'p', selection: 'g', capture: 'q' };
export const SITE_KINDS = Object.keys(FIX);
export const SEL_OPS = ['fx', 'send', 'mute', 'solo', 'gain', 'orbit', 'capture'];
// what a capture records, by picker kind (LANES 6.1): a tap ref gives events only
// recall facets, by recorded layer (LANES 6.3 and 3: facet = ev | audio | level | onset | gate | control-name)
export const FACET_LAYER = { ev: 'events', onset: 'events', gate: 'events', audio: 'audio', level: 'level' };
export const FACETS = ['ev', 'audio', 'level', 'onset', 'gate'];
export const facetsOf = (what) => FACETS.filter((f) => what.includes(FACET_LAYER[f]));
// same text as the runtime's refusal of recall("name:facet") on a layer the capture does not record (lanes-capture.js)
export const E_CAPTURE_FACET = (name, facet, what) => `E_CAPTURE_LAYER: recall("${name}:${facet}") needs the ${FACET_LAYER[facet]} layer, but capture "${name}" records ${what.join(', ')}`;
export const facetWire = (facet) => (facet === 'audio' ? { port: 'audio', type: 'audio' } : facet === 'level' ? { port: 'level', type: 'signal' } : { port: 'ev', type: 'pattern' });

// ---------------------------------------------------------------- site ids
export const fnvId = (kind, key) => FIX[kind] + B.fnv(key).toString(36).padStart(7, '0').slice(-6);
export const captureId = (name) => fnvId('capture', 'capture:' + name); // name-keyed, like atoms: renames are a new id, edits are not
const calleeName = (c) => (c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null);
const isFn = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression');
const str = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null);
// `a.b(...).c(...)` -> method names from the chain root (the control-binding rule, bind.js chainOf)
function chain(call) {
  const out = []; let n = call;
  while (n) {
    if (n.type === 'CallExpression') { const nm = calleeName(n.callee); if (nm) out.unshift(nm); n = n.callee.type === 'MemberExpression' ? n.callee.object : null; }
    else if (n.type === 'MemberExpression') { if (!n.computed) out.unshift(n.property.name); n = n.object; }
    else { if (n.type === 'Identifier') out.unshift(n.name); n = null; }
  }
  return out.join('.');
}
const rootOf = (call) => { let n = call; while (n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression') n = n.callee.object; return n; };

// sites of an AST (or code): { kind, path, layer, param, arg, start, end, ... } without ids
export function findSites(ast) {
  const out = [];
  const walk = (node, layer) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      const m = node.callee.property.name, base = `L${layer}/${chain(node)}`;
      if (m === 'split') {
        out.push({ kind: 'split', layer, path: base, param: 'split', arg: -1, start: node.start, end: node.end, branches: node.arguments.filter(isFn).length });
        node.arguments.forEach((a, i) => { if (isFn(a)) out.push({ kind: 'branch', layer, path: `${base}#${i}`, param: 'split', arg: i, start: a.start, end: a.end }); });
      } else if (m === 'merge' && node.arguments.some(isFn)) {
        node.arguments.forEach((a, i) => { if (isFn(a)) out.push({ kind: 'branch', layer, path: `${base}#${i}`, param: 'merge', arg: i, start: a.start, end: a.end }); });
      } else if (m === 'send') out.push({ kind: 'send', layer, path: `${base}#0`, param: 'send', arg: 0, start: node.start, end: node.end, bus: str(node.arguments[0]) });
    }
    for (const k in node) { if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue; const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, layer)); else if (v && typeof v.type === 'string') walk(v, layer); }
  };
  ast.body.forEach((st, i) => {
    walk(st, i);
    const e = st.type === 'ExpressionStatement' ? st.expression : null;
    if (!e || e.type !== 'CallExpression') return;
    const root = rootOf(e);
    if (root && root.type === 'CallExpression' && root.callee.type === 'Identifier' && root.callee.name === 'tagged') {
      const ops = []; for (let n = e; n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression'; n = n.callee.object) ops.unshift(n.callee.property.name);
      out.push({ kind: 'selection', layer: i, path: `L${i}/tagged`, param: `${str(root.arguments[0]) ?? '?'}.${ops.join('.')}`, arg: 0, start: st.start, end: st.end, selector: str(root.arguments[0]), ops });
    } else if (e.callee.type === 'Identifier' && e.callee.name === 'capture' && str(e.arguments[0]) !== null) {
      out.push({ kind: 'capture', layer: i, path: `capture:${str(e.arguments[0])}`, param: 'capture', arg: 0, start: st.start, end: st.end, name: str(e.arguments[0]) });
    }
  });
  const seen = new Map(); for (const s of out) { const n = seen.get(s.path) || 0; seen.set(s.path, n + 1); if (n) s.path += '~' + n; }
  return out;
}
const prefixFix = (sites) => { // reconcile() names new sites `k<hash>`; lane sites carry their kind letter instead (p split/branch/send, g selection)
  const taken = new Set(sites.filter((s) => s.match !== 'new').map((s) => s.id)); for (const s of sites) if (s.match === 'new') taken.add(s.id);
  for (const s of sites) if (s.match === 'new' && s.id[0] === 'k') { let id = FIX[s.kind] + s.id.slice(1), n = 1; while (taken.has(id) && id !== s.id) id = fnvId(s.kind, s.path + '#' + n++); taken.delete(s.id); s.id = id; taken.add(id); }
  return sites;
};
// laneSites(code, prev) -> { ok, sites }. Ids are kept by the control-binding reconciliation (path, structure, position); captures are name-keyed.
export function laneSites(code, prev = []) {
  const p = B.parse(code); if (!p.ok) return { ok: false, error: p };
  const all = findSites(p.ast), caps = all.filter((s) => s.kind === 'capture'), rest = all.filter((s) => s.kind !== 'capture');
  for (const c of caps) { c.id = captureId(c.name); c.match = 'name'; }
  B.reconcile(prev.filter((s) => s.kind !== 'capture'), rest); prefixFix(rest);
  return { ok: true, sites: [...rest, ...caps].sort((a, b) => a.start - b.start) };
}
// ids a model gets on first sight (no history): path hashes. Same strings laneSites yields for the first compile of that text.
export function siteIds(ast) {
  const s = findSites(ast); const used = new Set();
  for (const x of s) { let id = x.kind === 'capture' ? captureId(x.name) : fnvId(x.kind, x.path), n = 1; while (used.has(id)) id = fnvId(x.kind, x.path + '#' + n++); used.add(id); x.id = id; }
  return s;
}
// runtime id of a selection (lanes.js hands out s1, s2, ... in evaluation order, identical statements collapsing): the site id is the address
export function selectionRuntimeId(sites, id) {
  const sel = sites.filter((s) => s.kind === 'selection').sort((a, b) => a.start - b.start), nums = new Map(); let n = 0;
  for (const s of sel) { const key = s.selector + '|' + s.ops.join('.'); if (!nums.has(key)) nums.set(key, ++n); if (s.id === id) return `s${nums.get(key)}`; }
  return null;
}
// pad target { kind: 'selection', ref: <site id>, op: 'mute' | 'solo' } + the current code -> the lanes.set arguments ([id, op]); null when the statement is gone
export function padSelection(code, target, prev = []) {
  const r = laneSites(code, prev); if (!r.ok) return null;
  const s = r.sites.find((x) => x.kind === 'selection' && x.id === target.ref); if (!s) return null;
  const id = selectionRuntimeId(r.sites, s.id); const op = target.op || (s.ops.includes('mute') ? 'mute' : s.ops.includes('solo') ? 'solo' : null);
  return id && op && s.ops.includes(op) ? { id, op, sites: r.sites } : null;
}

// ---------------------------------------------------------------- selectors on static lanes
// lane: { id, tags }. A selector may be a string or null; returns { ok, matches: [lane id], error }
export function matchLanes(selector, lanes) {
  let ast; try { ast = parseSelector(String(selector)); } catch (e) { return { ok: false, matches: [], error: String(e.message).replace(/^E_\w+: /, '') }; }
  const f = (n) => {
    if (n.all) return () => true; if (n.tag) return (l) => (l.tags || []).includes(n.tag); if (n.lane) return (l) => l.id === n.lane; if (n.not) { const g = f(n.not); return (l) => !g(l); }
    const ls = (n.or || n.and).map(f); return n.or ? (l) => ls.some((g) => g(l)) : (l) => ls.every((g) => g(l));
  };
  const g = f(ast); return { ok: true, matches: lanes.filter(g).map((l) => l.id) };
}
// the same grammar over tagged items (atoms, pack items): `strudel atoms list --tag "<selector>"` and the atom browser filter. `#id` matches item.id.
export function filterByTags(items, selector) {
  if (selector == null || !String(selector).trim()) return items.slice();
  let ast; try { ast = parseSelector(String(selector)); } catch (e) { throw Object.assign(new Error(String(e.message)), { code: 'E_BAD_SELECTOR' }); }
  const f = (n, it) => (n.all ? true : n.tag ? (it.tags || []).includes(n.tag) : n.lane ? (it.id === n.lane || it.name === n.lane) : n.not ? !f(n.not, it) : n.or ? n.or.some((x) => f(x, it)) : n.and.every((x) => f(x, it)));
  return items.filter((it) => f(ast, it));
}

// ---------------------------------------------------------------- crossing rule (LANES 5.3, 5.4, 10)
export const E_LANE_CROSS = (what, from, to) => `E_LANE_CROSS: ${what} of lane "${from}" is local to its split and cannot be used in lane "${to}"; export a tap or use a named send`;
