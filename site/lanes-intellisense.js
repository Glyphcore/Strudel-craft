/* Lanes intellisense (docs/LANES.md section 10, issue #77). Pure completion functions over the typed-param data (data/intellisense/strudel.json
   `lanes`) and the program's model (model.js parse), plus install(): one completion source and one literal-editor shape provider registered through
   the existing registries (intellisense.registerSource, literals.registerEditor). No new visible UI: it only changes which options a position offers.
     complete({ text, pos, doc, arg }, data, model) -> { from, options, validFor } | null
       - inside a `.split(` / `.merge(` branch callback after `w.`: only the bus-safe `branch` control set (never s, n, note, bus, dry)
       - tagged(" / capture(name, " / .tags(": tags seen in the program, #lane ids, selector operators
       - .send(" and ret(": bus names (declared by a send, a ret or a selection send)
       - recall(" : capture names; recall("name: : only the facets that capture records; .from(" : captures that record audio
     enumFor(method, argIndex, model) -> string[]  options for a literal editor (combobox) on those arguments */
import { facetsOf, defaultWhat, FACETS } from './engine/lanes-data.js';
import { scan } from './engine/lanes.js';

const IDENT = /[\w$]/;
// scan the text before the caret: the stack of open brackets, with `.split(` / `.merge(` openings and arrow functions that start inside them
export function branchContext(text) {
  const st = []; let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') {
      const m = /\.\s*(split|merge)\s*$/.exec(text.slice(Math.max(0, i - 24), i));
      st.push({ c, i, call: c === '(' && m ? m[1] : null, arrows: [] });
    } else if (c === ')' || c === ']' || c === '}') st.pop();
    else if (c === '=' && text[i + 1] === '>') {
      const m = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, i - 40), i)) || /\(\s*([A-Za-z_$][\w$]*)\s*\)\s*$/.exec(text.slice(Math.max(0, i - 40), i));
      if (m && st.length) st[st.length - 1].arrows.push({ name: m[1], at: i + 2 });
    }
  }
  const top = st[st.length - 1]; if (!top || !top.call || !top.arrows.length) return null;
  const arrow = top.arrows[top.arrows.length - 1], body = text.slice(arrow.at);
  // the body so far must be a method chain on the parameter, ending in `.` + partial name (no unclosed brackets of its own)
  const m = new RegExp(`^\\s*${arrow.name.replace(/\$/g, '\\$')}((?:\\s*\\.\\s*[\\w$]+\\s*\\((?:[^()]|\\([^()]*\\))*\\))*)\\s*\\.\\s*([\\w$]*)$`).exec(body);
  return m ? { call: top.call, param: arrow.name, partial: m[2] } : null;
}
const unique = (a) => [...new Set(a)];
export function programNames(model) {
  const m = model || {}, tracks = (m.tracks || []).filter((t) => !(t.chain == null && t.source == null)), anon = { n: 0 };
  const lanes = tracks.map((t) => (/^\$\d*$/.test(t.name) ? `$${anon.n++}` : t.name));
  const tags = unique([...tracks.flatMap((t) => t.tags || []), ...Object.values(m.captures || {}).flatMap(() => [])]).sort();
  const str = (v) => (typeof v === 'string' ? v : null);
  const buses = unique([...Object.keys(m.buses || {}), ...tracks.flatMap((t) => (t.sends || []).map((s) => s.bus)), ...tracks.map((t) => t.ret).filter(Boolean),
    ...(m.selections || []).flatMap((s) => (s.ops || []).filter((o) => o.op === 'send').map((o) => str(o.bus)).filter(Boolean))]).sort();
  const captures = {}; for (const [n, c] of Object.entries(m.captures || {})) { const what = Array.isArray(c.what) ? c.what : defaultWhat(str(c.picker)); captures[n] = { what, facets: facetsOf(what), picker: str(c.picker) }; }
  return { lanes, tags, buses, captures };
}
const opt = (label, detail, info, extra = {}) => ({ label, detail, info, type: 'text', ...extra });
export function complete(ctx, data, model) {
  const text = ctx.text, L = (data && data.lanes) || {}, arg = ctx.arg;
  // 1. branch callback: member completion of the bus-safe control set
  const bc = branchContext(text);
  if (bc && (!arg || !arg.quote)) {
    const from = ctx.pos - bc.partial.length;
    return { from, options: (L.branchControls || []).map((c, i) => ({ label: c.label, type: 'method', detail: c.detail, info: c.info, section: { name: `${bc.call} branch (bus-safe)`, rank: -1 }, boost: 60 - i })), validFor: /^[\w$]*$/, exclusive: true };
  }
  if (!arg || !arg.quote) return null;
  const N = programNames(model), word = /[^\s"'`,]*$/.exec(text)[0], call = arg.fn, method = call, i0 = arg.arg;
  const sec = (name) => ({ name, rank: -1 });
  if ((call === 'tagged' && i0 === 0) || (call === 'capture' && i0 === 1) || ((call === 'tags' || call === 'tag') && !!arg.method)) {
    const after = /[#!&|()*\s]*([#\w-]*)$/.exec(word), part = after ? after[1] : '', from = ctx.pos - part.length;
    const lanes = N.lanes.map((l) => opt('#' + l, 'lane', `lane ${l}`, { section: sec('lanes') }));
    const tags = N.tags.map((t) => opt(t, 'tag', `tag ${t}`, { section: sec('tags') }));
    const ops = call === 'tags' || call === 'tag' ? [] : (L.selectorOperators || []).filter((o) => !part).map((o) => opt(o.label, 'operator', o.info, { section: sec('operators') }));
    return { from, options: call === 'tags' || call === 'tag' ? tags : [...tags, ...lanes, ...ops], validFor: /^[#\w-]*$/ };
  }
  if ((call === 'send' && arg.method && i0 === 0) || (call === 'ret' && !arg.method && i0 === 0)) {
    return { from: ctx.pos - word.length, options: N.buses.map((b) => opt(b, 'bus', `named bus ${b}`, { section: sec('buses') })), validFor: /^[\w-]*$/ };
  }
  if (call === 'recall' && !arg.method && i0 === 0) {
    const c = word.indexOf(':');
    if (c < 0) return { from: ctx.pos - word.length, options: Object.entries(N.captures).map(([n, k]) => opt(n, 'capture', `records ${k.what.join(', ')}`, { section: sec('captures') })), validFor: /^[\w-]*$/ };
    const cap = N.captures[word.slice(0, c)]; if (!cap) return null;
    return { from: ctx.pos - (word.length - c - 1), options: cap.facets.map((f) => opt(f, 'facet', `${(L.facets || {})[f] || f} of ${word.slice(0, c)}`, { section: sec('facets') })), validFor: /^[\w-]*$/ };
  }
  if (call === 'from' && arg.method && i0 === 0) {
    return { from: ctx.pos - word.length, options: Object.entries(N.captures).filter(([, k]) => k.what.includes('audio')).map(([n]) => opt(n, 'capture', 'records audio', { section: sec('captures') })), validFor: /^[\w-]*$/ };
  }
  void method; void FACETS;
  return null;
}
// options for a literal editor (a combobox) on a string argument of a lane method
export function enumFor(method, argIndex, model) {
  const N = programNames(model);
  if ((method === 'tags' || method === 'tag')) return N.tags;
  if (method === 'send' && argIndex === 0) return N.buses;
  if (method === 'ret' && argIndex === 0) return N.buses;
  if (method === 'recall' && argIndex === 0) return Object.keys(N.captures);
  if (method === 'from' && argIndex === 0) return Object.entries(N.captures).filter(([, k]) => k.what.includes('audio')).map(([n]) => n);
  return null;
}

// the model of a document that does not parse yet (an unclosed string or bracket while typing): lanes, tags, sends, returns and captures read from the text
export function textModel(doc) {
  const g = scan(doc), anon = g.lanes.filter((l) => l.label === '$');
  const tracks = g.lanes.map((l) => ({ name: l.label === '$' ? '$' + (anon.indexOf(l) + 1) : l.label, tags: l.tags, source: ['s'], chain: [] }));
  const buses = {}; for (const x of doc.matchAll(/\b(?:\.send|ret)\(\s*["']([\w-]+)["']/g)) buses[x[1]] = { returns: [] };
  const captures = {};
  for (const x of doc.matchAll(/\bcapture\(\s*["']([\w-]+)["']\s*,\s*["']([^"']*)["']\s*(?:,\s*\{([^}\n]*)\})?/g)) {
    const w = /what\s*:\s*\[([^\]]*)\]/.exec(x[3] || ''); captures[x[1]] = { picker: x[2], ...(w ? { what: [...w[1].matchAll(/["'](\w+)["']/g)].map((y) => y[1]) } : {}) };
  }
  return { tracks, buses, captures };
}
export function install(win = window) {
  const sc = win.strudelCraft; if (!sc || !sc.intellisense || !sc.intellisense.registerSource) return null;
  let data = null, cache = { text: null, model: null }; const load = (async () => { while (!sc.packs) await new Promise((ok) => setTimeout(ok, 8)); await sc.packs.ready; return sc.packs.raw('glyphcore/shim:strudel-docs'); })().then((d) => { data = d || {}; }).catch(() => { data = {}; });
  const modelOf = async (doc) => { if (cache.text === doc) return cache.model; const { parse } = await import('./model.js'); let m = {}; try { m = parse(doc); } catch (e) { m = {}; } if (!m.tracks && !m.captures && !m.selections) m = textModel(doc); cache = { text: doc, model: m }; return m; };
  sc.intellisense.registerSource({ id: 'lanes', async complete(ctx) { await load; const r = complete(ctx, data, await modelOf(ctx.doc || ctx.text)); return r && r.options.length ? r : null; } });
  const lit = sc.literals;
  if (lit && lit.registerEditor) lit.registerEditor({ id: 'lanes', shape(l) {
    if (l.kind !== 'string' || !l.param || !cache.model) return null; // the model of the last completion request (refreshed while typing)
    const o = enumFor(l.param, l.arg, cache.model); return o && o.length ? { name: l.param, shape: 'enum', options: o } : null;
  } });
  return { complete, enumFor };
}
if (typeof window !== 'undefined' && window.strudelCraft && window.strudelCraft.intellisense) window.strudelCraft.lanesIntellisense = install(window);
