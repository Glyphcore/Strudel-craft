// Atoms A2 (docs/ATOMS.md sections 11, 12; issue #62): migration. extract(code, opts), parse(type, string, env), inline(code).
// Sibling of atoms.js, no DOM. Extraction only names strings already in the program; it never adds a sound, chord, note or instrument.
import * as acorn from '../vendor/acorn-8.19.0.mjs';
import { scan, buildEnv, compile, render, idFor, atomHash, config, inCatalog, typeOf_ } from './atoms.js';

const ALWAYS = new Set(['gate', 'tapref', 'slot', 'point']);        // names worth declaring even when used once (ATOMS 11 step 2)
const CATALOG_TYPES = new Set(['sound', 'bank']);                   // single tokens stay strings unless --catalog
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['snd', 'bank', 'scale', 'chord', 'import', 'atoms', 'atom']);
const NOTE = /^([a-gA-G][#bs]*-?\d*|-?\d+(\.\d+)?)$/, SOUND = /^[\w-]+$/, CHORD = /^[A-G][#b]*[^\s\[\]<>*\/!@?,|~]+$/, SCALE = /^[A-Ga-g][#b]*-?\d*(:[A-Za-z0-9 ]+)+$/;
const NUMTOK = /(?<=^|[*\/!@(,\s])(\d+(?:\.\d+)?)(?![\w.#])/g;

// ---------------------------------------------------------------- inline
// compile with formatting kept: atom(...) and atoms.import(...) statements are removed, references become their literals
export function inline(code, opts = {}) { return /\batoms?\b/.test(code) ? compile(code, null, { extra: opts.extra }).code : code; }

// ---------------------------------------------------------------- parse
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the declared atom (and args) whose output equals `string`, or null. Catalog atoms are never enumerated, so they are not searched.
export function parse(type, string, env) {
  for (const rec of env.byName.values()) {
    if (rec.type !== type) continue;
    try {
      if (!Object.keys(rec.params || {}).length) { if (render(env, rec).text === string) return { atom: rec, args: {} }; continue; }
      if (typeof rec.body === 'string') {
        const names = []; const re = new RegExp('^' + rec.body.split(/\$\{(\w+)\}/).map((x, i) => (i % 2 ? (names.push(x), '(.+?)') : esc(x))).join('') + '$');
        const m = re.exec(string); if (!m) continue;
        const args = {}; let ok = true;
        names.forEach((k, i) => { const spec = rec.params[k]; const raw = m[i + 1]; if (spec?.shape === 'number') { const n = Number(raw); if (String(n) !== raw) ok = false; args[k] = n; } else args[k] = raw; });
        if (ok && render(env, rec, args).text === string) return { atom: rec, args };
      }
    } catch { /* not this atom */ }
  }
  if (type === 'gate') { // "@17b" / "<17b" equal a point atom with .after() / .before()
    const m = /^([@<])(.+)$/.exec(string);
    if (m) { const p = parse('point', m[2], env); if (p) return { ...p, ops: [[m[1] === '@' ? 'after' : 'before']] }; }
  }
  return null;
}

// ---------------------------------------------------------------- typing of literals
const posOf = (c) => (c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? (c.object.type === 'Identifier' && c.object.name === 'hooks' ? 'hooks.' : '.') + c.property.name : null);
const tryP = (f, s) => { try { f(s); return true; } catch { return false; } };
function fits(t, v) { // does string v satisfy atom type t (needs the host parsers for the hooks types and mini)
  const C = config(), P = C.parsers;
  switch (t) {
    case 'mini': case 'progression': return !!C.mini && /\S/.test(v) && tryP(C.mini, v);
    case 'sound': return SOUND.test(v.replace(/:\d+$/, ''));
    case 'bank': return SOUND.test(v);
    case 'note': return NOTE.test(v);
    case 'chord': return CHORD.test(v);
    case 'scale': return SCALE.test(v);
    case 'gate': return !!P && /^[@<*]|\.\.|,/.test(v) && tryP(P.gate, v);
    case 'point': return !!P && !/^[@<*]/.test(v) && !v.includes('..') && tryP(P.point, v);
    case 'tapref': return !!P && tryP(P.ref, v);
    case 'slot': return !!P && tryP(P.ref, v) && !/:/.test(v);
    case 'hook': return !!P && tryP(P.expr, v);
    case 'name': return /^[A-Za-z_][\w-]*$/.test(v);
    default: return false;
  }
}
function literals(code) { // string literals with their call argument position (the existing literal-site scan, plus typing data)
  const has = /\batoms?\b/.test(code), sc = has ? scan(code) : { decls: [], imports: [], sites: [] };
  const skip = [...sc.decls.map((d) => d.stmt), ...sc.imports.map((d) => d.stmt), ...sc.sites.map((s) => [s.from, s.to])];
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  const out = [], marks = [];
  const walk = (n, parent, idx) => {
    if (n.type === 'Literal' && typeof n.value === 'string') {
      if (skip.some(([a, b]) => n.start >= a && n.end <= b)) return;
      const callee = parent?.type === 'CallExpression' && idx != null ? posOf(parent.callee) : null;
      out.push({ from: n.start, to: n.end, value: n.value, raw: code.slice(n.start, n.end), callee, arg: idx });
      return;
    }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'hooks' && n.callee.property.name === 'marker' && n.arguments[0]?.type === 'Literal' && n.arguments[1]?.type === 'Literal') marks.push([n.arguments[0].value, n.arguments[1].value]);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x, i) => x && typeof x.type === 'string' && walk(x, n, n.type === 'CallExpression' && k === 'arguments' ? i : null));
      else if (v && typeof v.type === 'string') walk(v, n, null);
    }
  };
  walk(ast, null, null);
  out.markers = marks; return out;
}

// ---------------------------------------------------------------- naming
const words = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean);
const camel = (ws) => ws.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('');
function miniName(text, withCount = true) {
  const toks = text.split(/[\s\[\]<>{}(),|]+/).filter(Boolean), alpha = [...new Set(toks.map((t) => /^[A-Za-z][A-Za-z0-9#]*/.exec(t)?.[0]).filter(Boolean))].slice(0, 2);
  const one = toks.length === 1 && /\*(\d+)$/.exec(toks[0]);
  const count = one ? one[1] : String(toks.filter((t) => t !== '~').length || toks.length);
  return (alpha.length ? camel(alpha) : 'pat') + (withCount ? count : '');
}
function suggest(type, text, ctx) {
  const ws = words(text);
  switch (type) {
    case 'mini': return miniName(text);
    case 'gate': { const m = /^([@<])([^,]+)$/.exec(text); return m ? (m[1] === '@' ? 'from' : 'before') + camel(['x', ...words(m[2])]).slice(1).replace(/^./, (c) => c.toUpperCase()) : 'gate' + camel(['x', ...ws]).slice(1).replace(/^./, (c) => c.toUpperCase()); }
    case 'point': return ctx.names[`point:${text}`] || ctx.markerFor(text) || 'at' + camel(['x', ...ws]).slice(1).replace(/^./, (c) => c.toUpperCase());
    default: return ws.length ? camel(ws) : type;
  }
}
const fixName = (n, type) => { let x = n.replace(/[^A-Za-z0-9_]/g, ''); if (!x) x = type; if (/^\d/.test(x)) x = type + x[0].toUpperCase() + x.slice(1); return x; };

// ---------------------------------------------------------------- extract
const lit = (s) => JSON.stringify(s);
const refText = (ns, key) => (IDENT.test(key) ? `atoms.${ns}.${key}` : `atoms.${ns}[${lit(key)}]`);
function catalogRef(type, v) { // -> reference text for a catalog atom present in the (host supplied) catalog, or null
  if (type === 'sound') { const m = /^([\w-]+?)(?::(\d+))?$/.exec(v); if (m && inCatalog('snd', m[1]) === true) return refText('snd', m[1]) + (m[2] ? `.n(${m[2]})` : ''); }
  if (type === 'bank' && inCatalog('bank', v) === true) return refText('bank', v);
  if (type === 'scale') { const i = v.indexOf(':'); if (i > 0 && inCatalog('scale', v.slice(i + 1)) === true) return `${refText('scale', v.slice(i + 1))}({ root: ${lit(v.slice(0, i))} })`; }
  if (type === 'chord') { const m = /^([A-G][#b]*)(.+)$/.exec(v); if (m && inCatalog('chord', m[2]) === true) return `${refText('chord', m[2])}({ root: ${lit(m[1])} })`; }
  return null;
}
// normalised AST (positions, raw text and quote style dropped): equal ASTs mean equal programs for the equivalence self-check
const norm = (code) => JSON.stringify(acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }), (k, v) => (k === 'start' || k === 'end' || k === 'raw' ? undefined : v));

export function extract(code, opts = {}) {
  const minUses = opts.minUses ?? 2, names0 = opts.names || {};
  const report = { atoms: [], catalogRefs: 0, candidates: [], refused: [], skipped: [], selfCheck: 'ast' };
  const refuse = (why) => { report.selfCheck = 'refused'; report.reason = why; return { code, atoms: [], report }; };
  let env; try { env = buildEnv(code, opts.extra); } catch (e) { return refuse(String(e.message)); }
  let lits; try { lits = literals(code); } catch (e) { return refuse('cannot parse program: ' + e.message); }
  const taken = new Set([...env.byName.keys(), ...RESERVED]);
  const uniq = (n) => { let x = n, i = 2; while (taken.has(x)) x = n + i++; taken.add(x); return x; };
  const ctx = { names: names0, markerFor: (p) => { const m = lits.markers.find(([n, v]) => v === p && IDENT.test(n) && !taken.has(n)); return m && m[0]; } };

  // 1 type every literal from its argument position
  const C = config(), P = C.positions || {};
  for (const l of lits) {
    const acc = l.callee && P[l.callee]?.[l.arg];
    if (acc) { const order = acc.includes('gate') && acc.includes('point') && !/^[@<]|\.\.|,/.test(l.value) ? ['point', 'gate'] : acc; l.type = order.find((t) => fits(t, l.value)); }
    if (!l.type && opts.text) l.type = 'text';
    if (!l.type) { report.skipped.push({ at: l.from, value: l.value, why: acc ? 'does not fit any accepted type' : 'untyped position' }); continue; }
    const T = typeOf_(l.type), q = T.quote === '"' ? '"' : null;
    if (/\\/.test(l.raw)) { report.skipped.push({ at: l.from, value: l.value, why: 'escape sequence' }); l.type = null; }
    else if (q && l.raw[0] !== q) { report.skipped.push({ at: l.from, value: l.value, why: `${l.type} atoms compile to a double-quoted pattern string` }); l.type = null; }
    else if (opts.catalog && (l.type === 'sound' || l.type === 'bank' || l.type === 'scale' || l.type === 'chord') && (l.cat = catalogRef(l.type, l.value))) { /* catalog reference */ }
    else if (CATALOG_TYPES.has(l.type)) { l.type = null; }
  }
  // 2 a string typed both as a pattern and as a string is ambiguous (the quote style differs): not rewritten, and say why
  const byText = new Map();
  for (const l of lits) if (l.type && !l.cat) { const k = l.value; (byText.get(k) || byText.set(k, []).get(k)).push(l); }
  for (const [v, ls] of byText) {
    const pat = ls.filter((l) => typeOf_(l.type).quote === '"'), str = ls.filter((l) => typeOf_(l.type).quote !== '"');
    if (pat.length && str.length) {
      const at = (l) => `offset ${l.from} (${l.type}${l.callee ? ' in ' + l.callee + '()' : ''})`;
      report.refused.push({ value: v, why: `used as a pattern string (${pat.map(at).join(', ')}) and as a plain string (${str.map(at).join(', ')}); one atom would change the quote style of one of them` });
      for (const l of ls) { l.type = null; }
    }
  }
  const live = lits.filter((l) => l.type);
  // 3 reuse existing atoms (parse), then group the rest by (type, canonical text)
  const edits = []; const groups = new Map();
  for (const l of live) {
    if (l.cat) { edits.push({ from: l.from, to: l.to, text: l.cat }); report.catalogRefs++; continue; }
    const hit = parse(l.type, l.value, env);
    if (hit) { edits.push({ from: l.from, to: l.to, text: refOf(hit.atom.name, hit.args, hit.ops) }); (report.reused ||= []).push({ name: hit.atom.name, at: l.from }); continue; }
    const k = l.type + '\0' + l.value; (groups.get(k) || groups.set(k, []).get(k)).push(l);
  }
  // gates "@P" / "<P" whose point P also appears in another form share one point atom
  const forms = new Map();
  for (const [k, ls] of groups) { const [t, v] = k.split('\0'); const m = t === 'gate' && /^([@<])([^,@<]+)$/.exec(v); if (m && fits('point', m[2])) { (forms.get(m[2]) || forms.set(m[2], new Set()).get(m[2])).add(m[1]); } else if (t === 'point') (forms.get(v) || forms.set(v, new Set()).get(v)).add('p'); }
  const pointOf = new Map(); for (const [p, f] of forms) if (f.size >= 2) pointOf.set(p, true);
  // --params: literals of one mini type differing in exactly one numeric token
  const unify = unifyParams(groups, minUses, report, !!opts.params);
  // 4 declare
  const decls = []; const idTaken = new Set(); const declOfKey = new Map();
  const order = [...groups.entries()].sort((a, b) => a[1][0].from - b[1][0].from);
  const declare = (rec, uses) => { rec.name = uniq(fixName(rec.name, rec.type)); rec.id = idFor(rec.type, rec.name, idTaken); idTaken.add(rec.id); rec.hash = atomHash(rec); decls.push({ ...rec, uses }); return rec; };
  const nameAtoms = new Map(); // base name text -> record (for facet derivations)
  const need = new Set(); // name atoms required by a tapref facet
  for (const [k] of order) { const [t, v] = k.split('\0'); if (t === 'tapref' && !/\//.test(v) && v.includes(':') && groups.has('name\0' + v.split(':')[0])) need.add('name\0' + v.split(':')[0]); }
  for (const [k, ls] of order) {
    const [t, v] = k.split('\0'); const uses = ls.length;
    if (unify.members.has(k)) continue;
    const m = t === 'gate' && /^([@<])([^,@<]+)$/.exec(v);
    if (m && pointOf.has(m[2])) continue;                              // handled through the point atom below
    if (!(uses >= minUses || ALWAYS.has(t) || need.has(k))) { report.skipped.push({ at: ls[0].from, value: v, why: `${uses} use(s), below --min-uses ${minUses}` }); continue; }
    const name = names0[`${t}:${v}`] || suggest(t, v, ctx);
    let rec;
    if (t === 'tapref' && !v.includes('/') && v.includes(':') && nameAtoms.has(v.split(':')[0])) rec = { name, type: t, from: { atom: nameAtoms.get(v.split(':')[0]).name, ops: [['facet', v.split(':')[1]]] }, src: `from: atoms.${nameAtoms.get(v.split(':')[0]).name}.facet(${lit(v.slice(v.indexOf(':') + 1))})` };
    else rec = { name, type: t, body: v };
    const d = declare(rec, uses); declOfKey.set(k, d); if (t === 'name') nameAtoms.set(v, d);
  }
  // point atoms (also the ones only reachable through gates)
  for (const p of pointOf.keys()) {
    const k = 'point\0' + p; const uses = (groups.get(k) || []).length + (groups.get('gate\0@' + p) || []).length + (groups.get('gate\0<' + p) || []).length;
    if (!declOfKey.has(k)) declOfKey.set(k, declare({ name: names0[`point:${p}`] || suggest('point', p, ctx), type: 'point', body: p }, uses));
  }
  // parameterised atoms
  for (const u of unify.atoms) { const d = declare({ name: u.name, type: 'mini', params: u.params, body: u.body }, u.uses); u.rec = d; }
  // 5 rewrite
  const refFor = (k) => declOfKey.get(k);
  for (const [k, ls] of groups) {
    const [t, v] = k.split('\0'); let text = null;
    const u = unify.of.get(k);
    if (u && u.rec) text = refOf(u.rec.name, { [u.param]: u.values.get(k) });
    else if (declOfKey.has(k)) text = refOf(declOfKey.get(k).name);
    else { const m = t === 'gate' && /^([@<])([^,@<]+)$/.exec(v); if (m && pointOf.has(m[2])) text = refOf(refFor('point\0' + m[2]).name, {}, [[m[1] === '@' ? 'after' : 'before']]); }
    if (text) for (const l of ls) edits.push({ from: l.from, to: l.to, text });
  }
  if (!edits.length) { report.atoms = []; return { code, atoms: [], report }; }
  edits.sort((a, b) => b.from - a.from);
  let out = code; for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  if (decls.length) {
    const block = decls.map(declText).join('\n') + '\n';
    const last = scan(code).decls.at(-1); let at = 0;
    if (last) { at = last.stmt[1]; if (code[at] === '\r') at++; if (code[at] === '\n') at++; const shift = edits.filter((e) => e.from < at).reduce((s, e) => s + e.text.length - (e.to - e.from), 0); at += shift; }
    out = out.slice(0, at) + block + out.slice(at);
  }
  // 6 self-check: the extracted program must inline back to the same program (and, with opts.events, to the same events)
  let plain; try { plain = inline(out, { extra: opts.extra }); if (norm(plain) !== norm(inline(code, { extra: opts.extra }))) throw new Error('inlined program differs from the original'); }
  catch (e) { return refuse(`self-check failed: ${String(e.message).split('\n')[0]}`); }
  if (opts.events) { try { const a = opts.events(plain), b = opts.events(inline(code, { extra: opts.extra })); if (JSON.stringify(a) !== JSON.stringify(b)) return refuse('self-check failed: events differ over 8 cycles'); report.selfCheck = 'events'; } catch (e) { return refuse(`self-check failed: ${e.message}`); } }
  report.atoms = decls.map((d) => ({ id: d.id, name: d.name, type: d.type, uses: d.uses }));
  return { code: out, atoms: decls.map(({ src, ...d }) => d), report };
}
function refOf(name, args = {}, ops = []) { const a = Object.keys(args).length ? `({ ${Object.entries(args).map(([k, v]) => `${k}: ${lit(v)}`).join(', ')} })` : ''; return `atoms.${name}${a}${ops.map(([o, ...x]) => `.${o}(${x.map(lit).join(', ')})`).join('')}`; }
function declText(d) {
  const parts = [`type: ${lit(d.type)}`];
  if (d.params) parts.push(`params: { ${Object.entries(d.params).map(([k, p]) => `${k}: { ${Object.entries(p).map(([a, b]) => `${a}: ${lit(b)}`).join(', ')} }`).join(', ')} }`);
  parts.push(d.src ? d.src : `body: ${lit(d.body)}`);
  return `atom(${lit(d.name)}, { ${parts.join(', ')} })`;
}
function unifyParams(groups, minUses, report, apply) {
  const res = { members: new Set(), of: new Map(), atoms: [] };
  const cand = new Map(); // type \0 skeleton \0 index -> Map(text -> {key, value})
  for (const [k, ls] of groups) {
    const [t, v] = k.split('\0'); if (t !== 'mini' || !/[A-Za-z]/.test(v)) continue;
    const toks = [...v.matchAll(NUMTOK)].filter((m) => String(Number(m[1])) === m[1]);
    toks.forEach((m, i) => { const sk = v.slice(0, m.index) + '\u0000' + v.slice(m.index + m[1].length); const ck = `${t}\0${sk}\0${i}`; (cand.get(ck) || cand.set(ck, []).get(ck)).push({ key: k, value: Number(m[1]), uses: ls.length, sk }); });
  }
  const list = [...cand.values()].filter((c) => c.length >= 2).sort((a, b) => b.length - a.length || groups.get(a[0].key)[0].from - groups.get(b[0].key)[0].from);
  const used = new Set();
  for (const c of list) {
    if (c.some((x) => used.has(x.key))) continue;
    const uses = c.reduce((s, x) => s + x.uses, 0); const body = c[0].sk.replace('\u0000', '${n}');
    const cs = [...c].sort((a, b) => a.value - b.value);
    report.candidates.push({ type: 'mini', body, values: cs.map((x) => x.value), uses, applied: apply && uses >= minUses });
    if (!apply || uses < minUses) continue;
    c.forEach((x) => used.add(x.key));
    const def = [...c].sort((a, b) => b.uses - a.uses || a.value - b.value)[0].value;
    const ints = c.every((x) => Number.isInteger(x.value));
    const u = { name: miniName(body.replace('${n}', ''), false) || 'pat', params: { n: { shape: 'number', ...(ints && { step: 1 }), default: def } }, body, uses, param: 'n', values: new Map(c.map((x) => [x.key, x.value])) };
    res.atoms.push(u); for (const x of c) { res.members.add(x.key); res.of.set(x.key, u); }
  }
  return res;
}

// the environment as `strudel atoms list` reports it: declared atoms plus the catalog atoms the code references (never the whole catalog)
export function list(code, extra) {
  const env = buildEnv(code, extra), res = compile(code, env, { extra });
  const decl = [...env.byName.values()].filter((r) => r.origin !== 'catalog').map((r) => ({ name: r.name, type: r.type, origin: r.origin }));
  const cat = [...new Set(res.refs.map((r) => r.atom))].filter((n) => env.synth(n) && !env.byName.has(n)).map((n) => ({ name: n, type: env.synth(n).type, origin: 'catalog' }));
  return [...decl, ...cat];
}
