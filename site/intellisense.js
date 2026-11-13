/* Strudel code intellisense: CodeMirror 6 (pinned, esm.sh) over the #code and #stackCode textareas.
   Completion items come from a runtime registry of providers: window.strudelCraft.intellisense.register(provider).
   provider = { id, items(ctx) -> Item[] | Promise<Item[]> }   (ctx = { word, method, string, text })
   Item = { label, category, detail?, info?, method?: bool (after "."), string?: bool (inside quotes), apply? } */
const V = { cm: '6.0.1', ac: '6.18.6', js: '6.2.3', view: '6' };
const DEPS = ''; /* shared @codemirror/state and view resolve to one copy via esm.sh semver ranges */
const LS = 'sc.intellisense.user';

const providers = new Map(); let cache = null;
const api = {
  register(p) { if (!p || !p.id || typeof p.items !== 'function') throw new Error('provider needs {id, items()}'); providers.set(p.id, p); cache = null; return () => { providers.delete(p.id); cache = null; }; },
  providers: () => [...providers.keys()],
  invalidate() { cache = null; },
  async all(ctx = {}) {
    if (!cache) cache = Promise.all([...providers.values()].map(async (p) => { try { return ((await p.items(ctx)) || []).map((it) => ({ ...it, provider: p.id, category: it.category || p.id })); } catch (e) { return []; } })).then((a) => a.flat());
    return cache;
  },
};
window.strudelCraft = window.strudelCraft || {}; window.strudelCraft.intellisense = api;

/* 1. static config data */
const staticData = fetch('data/intellisense/strudel.json').then((r) => r.json()).then((d) => d.items || []).catch(() => []);
api.register({ id: 'strudel-docs', items: () => staticData });

/* 1b. typed params (docs/CONTROL_BINDING.md section 1): params[fn][i] = { name, shape, ... } merged with mod_ranges + control types */
const shapes = Promise.all([fetch('data/intellisense/strudel.json').then((r) => r.json()).catch(() => ({})), fetch('data/mod_ranges.json').then((r) => r.json()).catch(() => ({ ranges: {} })), fetch('data/controls/types.json').then((r) => r.json()).catch(() => ({ types: [] }))])
  .then(([d, mr, ty]) => {
    const types = new Map((ty.types || []).map((t) => [t.id, t])); const drawnType = (id) => { let t = types.get(id); const seen = new Set(); while (t && !t.drawn && t.render && t.render.fallback && !seen.has(t.id)) { seen.add(t.id); t = types.get(t.render.fallback); } return t ? t.id : 'knob'; };
    const P = {};
    for (const [fn, ps] of Object.entries(d.params || {})) P[fn] = ps.map((q) => { const r = q.range && mr.ranges ? mr.ranges[q.range] : null; const o = { ...(r ? { min: r.min, max: r.max } : {}), ...q }; if (o.shape === 'number') o.control = drawnType(o.control || 'knob'); return o; });
    return P;
  });
api.params = () => shapes;
shapes.then((P) => { api.__paramsSync = P; });
/* argument context: innermost open call at pos, its arg index and whether the cursor is inside a string */
function argContext(text, pos) {
  const st = []; let q = null; const from = Math.max(0, pos - 4000);
  for (let i = from; i < pos; i++) {
    const c = text[i];
    if (q) { if (c === '\\') i++; else if (c === q) { q = null; } continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; if (st.length) st[st.length - 1].qs = i; continue; }
    if (c === '(' || c === '[' || c === '{') st.push({ c, i, commas: 0 }); else if (c === ')' || c === ']' || c === '}') st.pop(); else if (c === ',' && st.length) st[st.length - 1].commas++;
  }
  const top = st[st.length - 1]; if (!top || top.c !== '(') return null;
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, top.i - 60), top.i)); if (!m) return null;
  const pre = text.slice(0, top.i - m[1].length).trimEnd();
  return { fn: m[1], method: pre.endsWith('.'), arg: top.commas, quote: q, open: top.i };
}
api.argContext = argContext;
const NOTES = ['c3', 'e3', 'g3', 'a2', 'c2', 'g1', 'c3 e3 g3', '<c2 g1>', 'c3 eb3 g3 bb3', '[c3,e3,g3]'];
const fmtN = (v) => (typeof v === 'number' ? String(+v.toFixed(4)) : String(v));
function shapeOptions(p, ctx, items) {
  const inQ = !!ctx.quote; const Q = (x) => (inQ ? x : '"' + x + '"'); const out = [];
  const add = (label, detail, type = 'constant', apply) => out.push({ label, detail, type, apply });
  if (p.shape === 'number') {
    const lo = p.min ?? 0, hi = p.max ?? 1, def = p.default ?? lo; const u = p.unit ? ' ' + p.unit : '';
    const vals = [...new Set([def, ...(p.presets || [])])].filter((v) => typeof v !== 'number' || (v >= lo && v <= hi));
    vals.forEach((v) => add(fmtN(v), (p.unit || p.name) + (typeof v === 'number' ? ` (${lo} to ${hi})` : ''), 'constant'));
    if (!inQ) {
      add(`slider(${fmtN(def)}, ${fmtN(lo)}, ${fmtN(hi)})`, `${p.control} control, ${lo} to ${hi}${u}`, 'function');
      const spec = [`type: '${p.control}'`, `min: ${fmtN(lo)}`, `max: ${fmtN(hi)}`, p.curve && p.curve !== 'lin' ? `curve: '${p.curve}'` : null, p.unit ? `unit: '${p.unit}'` : null].filter(Boolean).join(', ');
      add(`ctl('${ctx.fn}', { ${spec} })`, `named ${p.control} control`, 'function');
      add(`sine.range(${fmtN(lo)}, ${fmtN(hi)})`, 'modulate across the range', 'function');
    }
  } else if (p.shape === 'sound') {
    const seen = new Set(); for (const it of items) if (it.string && (it.category === 'sounds' || it.category === 'loaded sounds') && !seen.has(it.label)) { seen.add(it.label); add(Q(it.label), 'sound', 'text'); }
  } else if (p.shape === 'enum') (p.options || []).forEach((o) => add(Q(o), p.name, 'enum'));
  else if (p.shape === 'note') NOTES.forEach((n) => add(Q(n), 'notes', 'text'));
  else if (p.shape === 'mini') (p.examples || []).forEach((n) => add(Q(n), 'mini-notation', 'text'));
  else if (p.shape === 'bool') { if (!inQ) ['true', 'false'].forEach((b) => add(b, 'bool', 'keyword')); }
  else if (p.shape === 'pattern') (p.examples || []).forEach((n) => add(n, 'pattern', 'function'));
  else if (p.shape === 'control') { const c = window.strudelCraft.perform; const names = c ? c.controls.list().map((x) => x.name) : []; names.forEach((n) => add(Q(n), 'control', 'variable')); if (!names.length) add(Q(ctx.fn === 'ctl' ? 'cutoff' : 'ctl'), 'new control label', 'variable'); }
  return out;
}

/* 2. catalog presets */
const catalog = fetch('data/catalog.json').then((r) => r.json()).catch(() => ({ recipes: [] }));
api.register({ id: 'catalog', items: async () => (await catalog).recipes.filter((r) => r.expr).map((r) => ({ label: r.id, category: 'presets', detail: r.title, info: r.intent + '\n' + r.expr, apply: r.expr })) });

/* 3. runtime discovery after Strudel loads: exported globals, Pattern methods, loaded sounds */
let runtime = [];
function discover() {
  const out = []; const seen = new Set();
  const add = (label, extra) => { const k = label + (extra.method ? '.' : ''); if (seen.has(k) || !/^[A-Za-z_$][\w$]*$/.test(label)) return; seen.add(k); out.push({ label, ...extra }); };
  try { const P = window.Pattern && window.Pattern.prototype; if (P) for (const k of Object.getOwnPropertyNames(P)) if (typeof P[k] === 'function' && !k.startsWith('_') && k !== 'constructor') add(k, { method: true, category: 'pattern methods', detail: 'Pattern.' + k }); } catch (e) { /* ignore */ }
  try { for (const k of Object.keys(window)) { if (k.length < 2 || k.startsWith('_') || k.startsWith('webkit') || k.startsWith('on')) continue; const v = window[k]; if (typeof v === 'function' && v.length <= 4 && baseline && !baseline.has(k)) add(k, { category: 'strudel functions', detail: k + '()' }); } } catch (e) { /* ignore */ }
  try { const sm = window.soundMap && (window.soundMap.get ? window.soundMap.get() : window.soundMap); if (sm) for (const k of Object.keys(sm)) out.push({ label: k, string: true, category: 'loaded sounds', detail: 'sound' }); } catch (e) { /* ignore */ }
  runtime = out; cache = null;
}
const baseline = new Set(Object.keys(window));
window.addEventListener('strudel:ready', () => { discover(); setTimeout(discover, 3000); });
api.register({ id: 'runtime', items: () => runtime });

/* 4. living user list: identifiers and quoted values the user types, persisted */
let user = []; try { user = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { user = []; }
function learn(text) {
  const known = new Set(user.map((u) => u.label + '|' + !!u.string)); let added = 0;
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) if (!known.has(m[1] + '|false')) { user.push({ label: m[1], category: 'your names' }); known.add(m[1] + '|false'); added++; }
  for (const m of text.matchAll(/"([^"\n]{2,40})"/g)) if (!known.has(m[1] + '|true')) { user.push({ label: m[1], string: true, category: 'your values' }); known.add(m[1] + '|true'); added++; }
  if (added) { user = user.slice(-300); try { localStorage.setItem(LS, JSON.stringify(user)); } catch (e) { /* ignore */ } cache = null; }
}
api.register({ id: 'user', items: () => user });
api.learn = learn; api.forget = () => { user = []; try { localStorage.removeItem(LS); } catch (e) { /* ignore */ } cache = null; };

/* editor */
async function mount() {
  const [{ EditorView, basicSetup }, ac, { javascript }, { keymap }] = await Promise.all([
    import(`https://esm.sh/codemirror@${V.cm}${DEPS}`), import(`https://esm.sh/@codemirror/autocomplete@${V.ac}${DEPS}`),
    import(`https://esm.sh/@codemirror/lang-javascript@${V.js}${DEPS}`), import(`https://esm.sh/@codemirror/view@${V.view}`)]);
  async function source(context) {
    { /* typed argument position: shape-driven suggestions only */
      const text = context.state.doc.sliceString(Math.max(0, context.pos - 4000), context.pos); const base = Math.max(0, context.pos - 4000);
      const ctx = argContext(text, text.length); const P = await shapes; const p = ctx && P[ctx.fn] && P[ctx.fn][ctx.arg];
      if (p) {
        const wre = ctx.quote ? /[^\s"'`]*$/ : /[\w$.]*$/; const w = wre.exec(text)[0]; let from = context.pos - w.length;
        if (!ctx.quote && !w && !context.explicit && !/[(,]\s*$/.test(text)) return null;
        const opts = shapeOptions(p, ctx, await api.all());
        if (ctx.quote && opts.length) { /* inside quotes: replace the word, drop our quotes */ opts.forEach((o) => { o.label = o.label.replace(/^"|"$/g, ''); }); }
        if (opts.length) return { from, options: opts.map((o, i) => ({ ...o, section: { name: `${ctx.fn} · ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}`, rank: -1 }, boost: 50 - i })), validFor: ctx.quote ? /^[^\s"'`]*$/ : /^[\w$.]*$/, filter: !!w };
        void base;
      }
    }
    const line = context.state.doc.lineAt(context.pos); const before = line.text.slice(0, context.pos - line.from);
    const w = /[\w$]*$/.exec(before); const word = w[0]; const from = context.pos - word.length;
    const quotes = (before.match(/"/g) || []).length % 2 === 1; const method = !quotes && before.slice(0, before.length - word.length).endsWith('.');
    const afterParen = /\(\s*"?$/.test(before.slice(0, before.length - word.length));
    if (!word && !context.explicit && !method && !afterParen) return null;
    const items = await api.all();
    const opts = []; const seen = new Set();
    for (const it of items) {
      if (!!it.string !== quotes) continue; if (!quotes && !!it.method !== method && !(it.category === 'presets' && !method)) continue;
      const k = it.label + '|' + it.category; if (seen.has(k)) continue; seen.add(k);
      opts.push({ label: it.label, type: it.method ? 'method' : it.string ? 'text' : it.category === 'presets' ? 'variable' : 'function', detail: it.detail, info: it.info, section: { name: it.category, rank: it.provider === 'strudel-docs' ? 0 : it.provider === 'user' ? 1 : it.provider === 'catalog' ? 2 : 3 }, apply: it.apply, boost: it.provider === 'strudel-docs' ? 2 : it.provider === 'user' ? 1 : 0 });
    }
    return { from, options: opts, validFor: /^[\w$]*$/ };
  }
  const [{ HighlightStyle, syntaxHighlighting }, { tags: t }] = await Promise.all([import('https://esm.sh/@codemirror/language@6'), import('https://esm.sh/@lezer/highlight@1')]);
  const hl = syntaxHighlighting(HighlightStyle.define([
    { tag: [t.string, t.special(t.string)], color: 'var(--sig)' },
    { tag: [t.number, t.bool, t.null], color: 'var(--warn)' },
    { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.labelName], color: 'var(--sig-2)' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName], color: 'var(--text)', fontWeight: '600' },
    { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--text)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--dim)', fontStyle: 'italic' },
    { tag: [t.punctuation, t.bracket, t.operator, t.separator], color: 'var(--faint)' },
    { tag: t.invalid, color: 'var(--bad)' },
  ]));
  const lint = await import(`https://esm.sh/@codemirror/lint@6.8.5`);
  const [vmod, smod, cmds, inlineMod] = await Promise.all([import(`https://esm.sh/@codemirror/view@${V.view}`), import('https://esm.sh/@codemirror/state@6'), import('https://esm.sh/@codemirror/commands@6'), import('./inline.js')]);
  const ghost = inlineMod.setupInline(api, { EditorView, Decoration: vmod.Decoration, WidgetType: vmod.WidgetType, StateField: smod.StateField, StateEffect: smod.StateEffect, Prec: smod.Prec, keymap, ac, indentMore: cmds.indentMore });
  api.ghost = ghost;
  const docs = new Map(); (await staticData).forEach((d) => docs.set(d.label, d));
  const { hoverTooltip } = await import(`https://esm.sh/@codemirror/view@${V.view}`);
  const hover = hoverTooltip((view, pos) => {
    const { from, to, text } = view.state.doc.lineAt(pos); let s = pos, e = pos;
    while (s > from && /[\w$]/.test(text[s - from - 1])) s--; while (e < to && /[\w$]/.test(text[e - from])) e++;
    const d = docs.get(text.slice(s - from, e - from)); if (!d) return null;
    return { pos: s, end: e, above: true, create() { const dom = document.createElement('div'); dom.className = 'cm-sig'; dom.textContent = d.detail + ' - ' + d.info; return { dom }; } };
  });
  /* signature help: the active param of the innermost call is bold (CONTROL_BINDING section 1) */
  const P0 = await shapes;
  const sigField = smod.StateField.define({
    create: () => null,
    update(v, tr) {
      if (!tr.docChanged && !tr.selection) return v; const st = tr.state; const pos = st.selection.main.head;
      const text = st.doc.sliceString(Math.max(0, pos - 4000), pos); const ctx = argContext(text, text.length);
      const ps = ctx && P0[ctx.fn]; if (!ps) return null;
      return { pos: pos - text.length + ctx.open, fn: ctx.fn, arg: Math.min(ctx.arg, ps.length - 1), ps, over: ctx.arg >= ps.length };
    },
    provide: (f) => vmod.showTooltip.from(f, (v) => v && { pos: v.pos, above: true, strictSide: false, arrow: false, create() {
      const dom = document.createElement('div'); dom.className = 'cm-sig cm-sighelp'; dom.setAttribute('role', 'tooltip');
      dom.append(v.fn + '(');
      v.ps.forEach((p, i) => { if (i) dom.append(', '); const b = document.createElement(i === v.arg && !v.over ? 'b' : 'span'); b.textContent = p.name; if (i === v.arg && !v.over) b.className = 'cm-sig-active'; dom.append(b); });
      dom.append(')'); const p = v.ps[v.arg]; const d = document.createElement('small');
      d.textContent = ' ' + p.shape + (p.shape === 'number' ? ` ${p.min ?? ''}..${p.max ?? ''}${p.unit ? ' ' + p.unit : ''}` : p.options ? ': ' + p.options.slice(0, 4).join(' ') : '');
      dom.append(d); return { dom };
    } }),
  });
  const theme = EditorView.theme({ '.cm-sig-active': { color: 'var(--sig-2)', fontWeight: '700' }, '.cm-sighelp small': { color: 'var(--dim)' }, '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sig-2)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--sig-2-soft) !important' }, '.cm-matchingBracket': { background: 'var(--panel-3)', outline: '1px solid var(--line-2)' }, '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px wavy var(--bad)' }, '.cm-diagnostic-error': { borderLeftColor: 'var(--bad)' }, '.cm-tooltip-autocomplete ul li': { padding: '6px 8px', minHeight: '32px' }, '&': { background: 'var(--panel-2)', color: 'var(--text)', fontSize: '.86rem', borderRadius: '0 0 var(--r2) var(--r2)' }, '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0', caretColor: 'var(--sig-2)' }, '.cm-gutters': { background: 'transparent', border: '0', color: 'var(--dim)' }, '&.cm-focused': { outline: '2px solid var(--sig-2)', outlineOffset: '-2px' }, '.cm-scroller': { minHeight: '150px', lineHeight: '1.6' }, '.cm-tooltip': { background: 'var(--panel)', border: '1px solid var(--line, #333)', color: 'var(--text)' }, '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--sig-2)', color: '#000' }, '.cm-completionSection': { color: 'var(--dim)', fontSize: '.72rem', textTransform: 'uppercase', padding: '4px 8px' }, '.cm-sig': { padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '.78rem', maxWidth: '320px' }, '.cm-activeLine, .cm-activeLineGutter': { background: 'transparent' } });
  /* visual feedback hooks: active-event highlights and inline widget canvases (visuals.js) */
  const setHl = smod.StateEffect.define(), setW = smod.StateEffect.define();
  class CanvasW extends vmod.WidgetType { constructor(el) { super(); this.el = el; } eq(o) { return o.el === this.el; } toDOM() { const d = document.createElement('div'); d.className = 'cm-sc-widget'; d.append(this.el); return d; } ignoreEvent() { return true; } }
  const hlField = smod.StateField.define({ create: () => vmod.Decoration.none, update(v, tr) { v = v.map(tr.changes); for (const e of tr.effects) if (e.is(setHl)) v = vmod.Decoration.set(e.value.map((h) => vmod.Decoration.mark({ class: 'cm-sc-active', attributes: h.color ? { style: `outline-color:${h.color};background:color-mix(in srgb, ${h.color} 25%, transparent)` } : {} }).range(h.from, h.to)), true); return v; }, provide: (f) => EditorView.decorations.from(f) });
  const wField = smod.StateField.define({ create: () => vmod.Decoration.none, update(v, tr) { v = v.map(tr.changes); for (const e of tr.effects) if (e.is(setW)) v = vmod.Decoration.set(e.value.map((w) => vmod.Decoration.widget({ widget: new CanvasW(w.el), block: true, side: 1 }).range(w.pos)), true); return v; }, provide: (f) => EditorView.decorations.from(f) });
  /* reference inspector marks (refs.js): soft background on the source span, matching tint on related spans, gutter indicator */
  const setRef = smod.StateEffect.define();
  class RefGutter extends vmod.GutterMarker { constructor(c) { super(); this.elementClass = c; } }
  const refField = smod.StateField.define({ create: () => ({ deco: vmod.Decoration.none, gut: smod.RangeSet.empty }), update(v, tr) {
    let { deco, gut } = v; deco = deco.map(tr.changes); gut = gut.map(tr.changes);
    for (const e of tr.effects) if (e.is(setRef)) { const n = tr.state.doc.length; const ok = (r) => r && r[0] >= 0 && r[1] <= n && r[0] < r[1]; const rs = [];
      if (ok(e.value.primary)) rs.push(vmod.Decoration.mark({ class: 'cm-ref-primary', attributes: { 'data-ref': e.value.id || '' } }).range(e.value.primary[0], e.value.primary[1]));
      for (const r of e.value.related || []) if (ok(r)) rs.push(vmod.Decoration.mark({ class: 'cm-ref-related' }).range(r[0], r[1]));
      deco = vmod.Decoration.set(rs, true);
      const lines = new Set(); if (ok(e.value.primary)) lines.add(tr.state.doc.lineAt(e.value.primary[0]).from); for (const r of e.value.related || []) if (ok(r)) lines.add(tr.state.doc.lineAt(r[0]).from);
      gut = smod.RangeSet.of([...lines].sort((a, b) => a - b).map((f) => new RefGutter(ok(e.value.primary) && tr.state.doc.lineAt(e.value.primary[0]).from === f ? 'cm-ref-gutter' : 'cm-ref-gutter rel').range(f)), true); }
    return { deco, gut };
  }, provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), vmod.gutterLineClass.from(f, (v) => v.gut)] });
  api.refMarks = (id, marks) => { const t = document.getElementById(id); const v = t && t.cmView; if (!v) return; v.dispatch({ effects: [setRef.of(marks || {})].concat(marks && marks.primary && marks.scroll !== false ? [EditorView.scrollIntoView(marks.primary[0], { y: 'center' })] : []) }); };
  api.refView = (id) => { const t = document.getElementById(id); return t && t.cmView; };
  const vizApi = {
    doc: (id) => { const t = document.getElementById(id); return t && t.cmView ? t.cmView.state.doc.toString() : ''; },
    setHighlights: (id, hs) => { const t = document.getElementById(id); const v = t && t.cmView; if (!v) return; const n = v.state.doc.length; v.dispatch({ effects: setHl.of(hs.filter((h) => h.to <= n)) }); },
    setWidgets: (id, ws) => { const t = document.getElementById(id); const v = t && t.cmView; if (!v) return; const n = v.state.doc.length; const lineEnd = (p) => v.state.doc.lineAt(Math.min(p, n)).to; v.dispatch({ effects: setW.of(ws.filter((w) => w.pos <= n).map((w) => ({ ...w, pos: lineEnd(w.pos) })).sort((a, b) => a.pos - b.pos)) }); },
  };
  for (const id of ['code', 'stackCode']) {
    const ta = document.getElementById(id); if (!ta) continue;
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'); let view; let syncing = false; let learnT = 0;
    view = new EditorView({
      doc: desc.get.call(ta), parent: ta.parentNode,
      extensions: [ghost.extension, hlField, wField, sigField, refField, basicSetup, lint.lintGutter(), javascript(), theme, hl, hover, EditorView.lineWrapping, ac.autocompletion({ override: [source], activateOnTyping: true, icons: false }),
        EditorView.contentAttributes.of({ 'aria-label': ta.getAttribute('aria-label') || (id === 'code' ? 'Recipe code' : 'Stack program'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => { if (!u.docChanged || syncing) return; const v = u.state.doc.toString(); desc.set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); clearTimeout(learnT); learnT = setTimeout(() => learn(v), 1200); })],
    });
    ta.after(view.dom);
    Object.defineProperty(ta, 'value', { configurable: true, get: () => desc.get.call(ta), set: (v) => { desc.set.call(ta, v); if (view.state.doc.toString() !== v) { syncing = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } }); syncing = false; } } });
    ta.hidden = true; ta.style.display = 'none'; ta.tabIndex = -1; ta.cmView = view;
    import('./refs.js').then((m) => m.attachEditor(view, id)).catch((e) => console.warn('reference inspector unavailable:', e.message));
    import('./literals.js').then((m) => m.attach(view, id)).catch((e) => console.warn('literal editors unavailable:', e.message));
  }
  const viewFor = (v) => document.getElementById(v === 'stack' ? 'stackCode' : 'code').cmView;
  window.addEventListener('live:error', (e) => {
    const view = viewFor(e.detail.view); if (!view) return; const doc = view.state.doc;
    const ln = e.detail.line && e.detail.line >= 1 && e.detail.line <= doc.lines ? doc.line(e.detail.line) : doc.line(doc.lines);
    view.dispatch(lint.setDiagnostics(view.state, [{ from: ln.from, to: ln.to, severity: 'error', message: e.detail.message }]));
  });
  window.addEventListener('live:ok', (e) => { const view = viewFor(e.detail.view); if (view) view.dispatch(lint.setDiagnostics(view.state, [])); });
  if (window.strudelCraft.visuals) window.strudelCraft.visuals.attach(vizApi); else window.addEventListener('load', () => window.strudelCraft.visuals && window.strudelCraft.visuals.attach(vizApi));
  document.documentElement.dataset.editor = 'cm6';
}
const start = () => mount().catch((e) => { console.warn('Intellisense editor unavailable, plain textarea kept:', e.message); window.strudelCraft.ui && window.strudelCraft.ui.toast('Code helper offline: plain editor in use', { kind: 'info' }); });
/* offline: keep the plain editable textarea, upgrade when the network is back */
if (navigator.onLine) start(); else window.addEventListener('online', start, { once: true });
