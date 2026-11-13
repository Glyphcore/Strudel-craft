/* Hooks intellisense (HOOKS_SYNTAX 7, issue #51). Two providers through the existing registry (intellisense.js is unchanged):
   `hooks` = fixed vocabulary (methods, functions, gate templates); `model` = names from the program's manifest (defs, bindings, markers,
   taps, vars, instances) and the component library. Re-registering the same id is the registry's cache-bust; done on every code/library change.
   Manifest source: window.strudelCraft.hooks.manifest() when the hooks runtime provides it, else model.parse() of the editor text. */
const METHODS = [['use', '.use(slot)', 'Run the hook bound to a slot (bypass while unbound or closed).'], ['wrap', '.wrap(slot)', 'Wrap the pattern in the hook bound to a slot.'],
  ['tap', '.tap(name)', 'Publish this pattern as a named tap.'], ['wire', '.wire(tap, control)', 'Drive a control from a tap.'], ['ns', '.ns(name)', 'Namespace this track\'s slots and taps.']];
const FUNCS = [['tap', 'tap(name)'], ['hooks.def', 'hooks.def(name, manifest)'], ['hooks.undef', 'hooks.undef(name)'], ['hooks.bind', 'hooks.bind(slot, hook, gate?)'],
  ['hooks.replace', 'hooks.replace(slot, hook, when?)'], ['hooks.load', 'hooks.load(json)'], ['hooks.inst', 'hooks.inst(component, { as, args?, gate? })']];
const GATES = [['"@17b"', 'at bar 17'], ['"<17b"', 'until bar 17'], ['"9b..17b"', 'bars 9 to 17']];
const FACETS = ['onset', 'gate', 'env'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const range = (p) => Object.entries(p || {}).map(([k, v]) => `${k}: ${v.min ?? ''}..${v.max ?? ''} default ${v.default ?? ''}${v.unit ? ' ' + v.unit : ''}`).join('; ');

export function staticItems() {
  return [
    ...METHODS.map(([label, detail, info]) => ({ label, method: true, category: 'hooks', detail, info })),
    ...FUNCS.map(([label, detail]) => ({ label, category: 'hooks', detail, info: detail })),
    ...GATES.map(([label, info]) => ({ label: label.replace(/"/g, ''), string: true, category: 'gates', detail: 'gate', info, apply: label.replace(/"/g, '') })),
  ];
}

/* model: a model object (model.js shape); library: { list(), get(name, rev) } or null. Pure: no DOM. */
export function modelItems(model, library) {
  const out = [], seen = new Set(), m = model || {};
  const add = (it) => { const k = it.label + '|' + it.category; if (!seen.has(k)) { seen.add(k); out.push({ string: true, ...it }); } };
  const slots = new Set([...(m.bindings || []).map((b) => b.slot), ...Object.keys(m.slots || {})]);
  const taps = new Map(); const tap = (n, extra) => { if (!taps.has(n)) taps.set(n, new Set(FACETS)); (extra || []).forEach((f) => taps.get(n).add(f)); };
  for (const t of m.tracks || []) {
    for (const s of t.chain || []) { if ((s[0] === 'use' || s[0] === 'wrap') && typeof s[1] === 'string') slots.add(s[1]); if (s[0] === 'tap' && typeof s[1] === 'string') tap(s[1]); }
    for (const x of (t.src || '').matchAll(/\.(?:use|wrap)\(\s*"([^"]+)"/g)) slots.add(x[1]);
    for (const x of (t.src || '').matchAll(/\btap\(\s*"([^"]+)"/g)) tap(x[1]);
  }
  for (const [name, d] of Object.entries(m.defs || {})) for (const [tn, spec] of Object.entries(d.taps || {})) tap(tn, isObj(spec) ? Object.keys(spec.facets || {}) : []);
  for (const s of [...slots].sort()) {
    const bs = (m.bindings || []).filter((b) => b.slot === s);
    add({ label: s, category: 'slots', detail: 'slot', info: bs.length ? bs.map((b) => `${b.hook}${b.gate ? ' ' + JSON.stringify(b.gate) : ''}`).join('\n') : 'unbound' });
  }
  for (const [name, d] of Object.entries(m.defs || {})) {
    const ps = d.params || {}, keys = Object.keys(ps);
    if (d.decorator) { add({ label: name, category: 'decorators', detail: `${name}(${keys.join(', ')})[...]`, info: range(ps), apply: `${name}(${keys.map((k) => ps[k].default ?? k).join(', ')})[]` }); continue; }
    add({ label: name, category: 'hook names', detail: 'hook', info: range(ps) || 'no params' });
    if (keys.length) add({ label: `${name}(${keys.map((k) => ps[k].default).join(', ')})`, category: 'hook names', detail: 'hook with defaults', info: range(ps) });
  }
  for (const k of Object.keys(m.markers || {}).sort()) add({ label: k, category: 'markers', detail: 'marker', info: JSON.stringify(m.markers[k]) });
  for (const k of Object.keys(m.vars || {}).sort()) add({ label: k, category: 'variables', detail: 'variable', info: JSON.stringify(m.vars[k]).slice(0, 200) });
  const comps = new Map();
  if (library) for (const r of library.list() || []) {
    const rev = (library.revs ? library.revs(r.id) : []).length || r.rev || 1, rec = library.get ? library.get(r.id) : null, ex = (rec && rec.exports) || {};
    const ref = `${r.id}@${rev}`; comps.set(r.id, ex);
    add({ label: ref, category: 'components', detail: r.kind || 'component', info: `exports: taps ${(ex.taps || []).join(', ') || '-'}; slots ${(ex.slots || []).join(', ') || '-'}; params ${Object.keys(ex.params || {}).join(', ') || '-'}\nrequires: ${((ex.requires || {}).taps || []).join(', ') || '-'}` });
  }
  for (const i of m.instances || []) {
    const name = String(i.component).split('@')[0], ex = comps.get(name) || {};
    for (const s of ex.slots || []) add({ label: `${i.as}/${s}`, category: 'slots', detail: `slot of ${i.as}`, info: `instance of ${i.component}` });
    for (const t of ex.taps || []) tap(`${i.as}/${t}`);
  }
  for (const [n, fs] of [...taps].sort((a, b) => a[0].localeCompare(b[0]))) for (const f of [n, ...[...fs].map((x) => `${n}:${x}`)]) add({ label: f, category: 'taps', detail: 'tap', info: f === n ? 'tap' : 'facet ' + f.split(':')[1] });
  return out;
}

/* hooks.completions(ctx): every item, or narrowed when ctx.before (text before the cursor) shows a bind/inst argument position. */
export function completions(ctx, model, library) {
  const all = [...staticItems(), ...modelItems(model, library)], b = (ctx && ctx.before) || '';
  const m = /hooks\.(bind|replace|inst)\(\s*("[^"]*"\s*,\s*)?"[^"]*$/.exec(b);
  if (!m) return all;
  const second = !!m[2], want = m[1] === 'inst' ? ['components'] : second ? ['hook names', 'decorators'] : ['slots'];
  return all.filter((i) => want.includes(i.category));
}

export function install(win = window, opts = {}) {
  const api = win.strudelCraft && win.strudelCraft.intellisense; if (!api) return null;
  let model = null, library = opts.library || null, timer = 0;
  const text = () => ['code', 'stackCode'].map((id) => { const t = win.document.getElementById(id); return t ? t.value : ''; }).join('\n');
  const register = () => {
    api.register({ id: 'hooks', items: () => staticItems() });
    api.register({ id: 'model', items: () => modelItems(model, library) });
  };
  const refresh = async () => {
    const rt = win.strudelCraft.hooks;
    try { model = rt && typeof rt.manifest === 'function' ? await rt.manifest() : (await import('./model.js')).parse(text()); } catch (e) { /* keep previous model */ }
    register();
  };
  const sched = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
  register();
  (async () => { if (!library) try { const l = await import('./library.js'); library = l.lib; library.store.subscribe && library.store.subscribe(sched); } catch (e) { /* no library */ } refresh(); })();
  win.document.addEventListener('input', sched, true);
  win.addEventListener('strudel:hooks-changed', refresh);
  return { refresh };
}
if (typeof window !== 'undefined' && window.strudelCraft && window.strudelCraft.intellisense) window.strudelCraft.hooksIntellisense = install(window);
