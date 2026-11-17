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
/* context-sensitive extras, registered by site modules (atoms-site.js): a completion source may add to or replace the options of one
   position, a signature provider answers for callees the typed-param table does not know (docs/ATOMS.md section 10).
   source    = { id, complete(ctx) -> { from, options, merge?, validFor? } | null }
   signature = { id, signature(ctx) -> { fn, params: [{ name, shape, min, max, unit, options, default }], arg? } | null }
   ctx = { text (doc up to the caret), pos, explicit, arg (argContext) } */
const sources = new Map(), sigs = new Map();
api.registerSource = (p) => { if (!p || !p.id || typeof p.complete !== 'function') throw new Error('source needs {id, complete()}'); sources.set(p.id, p); cache = null; return () => { sources.delete(p.id); }; };
api.registerSignature = (p) => { if (!p || !p.id || typeof p.signature !== 'function') throw new Error('signature provider needs {id, signature()}'); sigs.set(p.id, p); return () => { sigs.delete(p.id); }; };
api.sources = () => [...sources.keys()];
api.signatureAt = (ctx) => { for (const s of sigs.values()) { try { const r = s.signature(ctx); if (r) return r; } catch (e) { /* provider offline */ } } return null; };
api.completeFrom = async (ctx) => { const out = []; for (const s of sources.values()) { try { const r = await s.complete(ctx); if (r && r.options && r.options.length) out.push({ id: s.id, ...r }); } catch (e) { /* provider offline */ } } return out; };
window.strudelCraft = window.strudelCraft || {}; window.strudelCraft.intellisense = api;

/* 1. static config data */
/* the `strudel-docs` provider is registered by the pack loader's `intellisense` adapter (packs-kinds.js) */
const packs = () => window.strudelCraft.packs;

/* 1b. typed params (docs/CONTROL_BINDING.md section 1): params[fn][i] = { name, shape, ... } merged with mod_ranges + control types */
/* #170: the editor's data (typed params, intellisense docs) comes from the IndexedDB cache when this build + pack set has one (decor.js);
   the packs refresh it in the background, so a warm start mounts the editor without waiting for the pack ingredients */
const viaCache = (name, load) => { const D = window.strudelCraft.decor; return D && D.cached ? D.cached(name, load).catch(() => load()) : load(); };
const shapes = viaCache('params', () => Promise.all([packs().paramShapes().catch(() => ({})), packs().controlTypes().catch(() => ({ types: [] }))])
  .then(([d, ty]) => {
    const mr = { ranges: d.ranges || {} };
    const types = new Map((ty.types || []).map((t) => [t.id, t])); const drawnType = (id) => { let t = types.get(id); const seen = new Set(); while (t && !t.drawn && t.render && t.render.fallback && !seen.has(t.id)) { seen.add(t.id); t = types.get(t.render.fallback); } return t ? t.id : 'knob'; };
    const P = {};
    for (const [fn, ps] of Object.entries(d.params || {})) P[fn] = ps.map((q) => { const r = q.range && mr.ranges ? mr.ranges[q.range] : null; const o = { ...(r ? { min: r.min, max: r.max } : {}), ...q }; if (o.shape === 'number') o.control = drawnType(o.control || 'knob'); return o; });
    return P;
  }));
api.params = () => shapes;
shapes.then((P) => { api.__paramsSync = P; });
/* argument context: innermost open call at pos, its arg index and whether the cursor is inside a string */
function argContext(text, pos) {
  const SC = window.strudelCraft; if (SC.blankComments) { if (SC.inComment(text, pos)) return null; text = SC.blankComments(text); } /* comments are blank (same offsets); no signature or completion inside one, and a quote or paren in a comment is not code */
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
const catalog = packs().catalog().catch(() => ({ recipes: [] }));
/* a preset inserts its plain Strudel form: the one-line expression, or the generated lowering (`lowered`) for recipes with Craft syntax, which have no single expression;
   those also offer `<id>.craft`, the authored Craft program (docs/LOWERING.md) */
/* #131: the catalog is an index; the first completion request fetches the recipe bodies (one hash-verified file per family, precached for offline) and merges them here */
async function withBodies() {
  const c = await catalog, P = packs(), keys = [...new Set(c.recipes.filter((r) => r.body && r.code == null).map((r) => (r.pack || 'glyphcore/shim') + '|' + r.body))], got = {};
  await Promise.all(keys.map(async (k) => { const [pk, b] = k.split('|'); got[k] = await P.recipeBodies(pk, b).catch(() => null); }));
  return c.recipes.map((r) => { const g = r.body && r.code == null ? got[(r.pack || 'glyphcore/shim') + '|' + r.body] : null; return g && g[r.id] ? { ...r, ...g[r.id] } : r; });
}
api.register({ id: 'catalog', items: async () => (await withBodies()).flatMap((r) => { const plain = r.lowered || r.expr; return [
  ...(plain ? [{ label: r.id, category: 'presets', detail: r.title + (r.lowered ? ' (Strudel)' : ''), info: r.intent + '\n' + plain, apply: plain }] : []),
  ...(r.lowered ? [{ label: r.id + '.craft', category: 'presets', detail: r.title + ' (Craft)', info: r.intent + '\n' + r.code, apply: r.code }] : [])]; }) });

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
  const [{ EditorView }, ac, { javascript }, { keymap }] = await Promise.all([
    import(`https://esm.sh/codemirror@${V.cm}${DEPS}`), import(`https://esm.sh/@codemirror/autocomplete@${V.ac}${DEPS}`),
    import(`https://esm.sh/@codemirror/lang-javascript@${V.js}${DEPS}`), import(`https://esm.sh/@codemirror/view@${V.view}`)]);
  /* popup accept = node-aware merge (inline.js mergeAccept): replaces the node under the caret, no duplicate parens/args/chain calls, one transaction */
  const mergedApply = (o) => { const text = typeof o.apply === 'string' ? o.apply : typeof o.apply === 'function' ? null : o.label; if (text == null) return o;
    return { ...o, apply: (view, completion, from) => { const r = inlineMod.mergeAccept(view.state.doc.toString(), view.state.selection.main.head, text, { from });
      view.dispatch({ ...(r.noop ? {} : { changes: { from: r.from, to: r.to, insert: r.insert } }), selection: { anchor: r.caret }, annotations: ac.pickedCompletion.of(completion), userEvent: 'input.complete' }); } }; };
  async function source(context) {
    /* registered sources first: one may replace the options of this position (merge: true adds to them) */
    const pre = context.state.doc.sliceString(0, context.pos);
    const extra = await api.completeFrom({ text: pre, doc: context.state.doc.toString(), pos: context.pos, explicit: context.explicit, arg: argContext(pre, pre.length) });
    const excl = extra.find((r) => !r.merge);
    if (excl) return { from: excl.from, options: excl.options.map(mergedApply), validFor: excl.validFor };
    const added = extra.filter((r) => r.merge).flatMap((r) => r.options);
    { /* typed argument position: shape-driven suggestions only */
      const text = context.state.doc.sliceString(Math.max(0, context.pos - 4000), context.pos); const base = Math.max(0, context.pos - 4000);
      const ctx = argContext(text, text.length); const P = await shapes; const p = ctx && P[ctx.fn] && P[ctx.fn][ctx.arg];
      if (p) {
        const wre = ctx.quote ? /[^\s"'`]*$/ : /[\w$.]*$/; const w = wre.exec(text)[0]; let from = context.pos - w.length;
        if (!ctx.quote && !w && !context.explicit && !/[(,]\s*$/.test(text)) return null;
        const opts = [...shapeOptions(p, ctx, await api.all()), ...added];
        if (ctx.quote && opts.length) { /* inside quotes: replace the word, drop our quotes */ opts.forEach((o) => { o.label = o.label.replace(/^"|"$/g, ''); }); }
        if (opts.length) return { from, options: opts.map(mergedApply).map((o, i) => ({ ...o, section: { name: `${ctx.fn} · ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}`, rank: -1 }, boost: 50 - i })), validFor: ctx.quote ? /^[^\s"'`]*$/ : /^[\w$.]*$/, filter: !!w && !context.explicit };
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
    return { from, options: [...opts, ...added].map(mergedApply), validFor: /^[\w$]*$/ };
  }
  const [lang, { tags: t }, srch, { atom, safeColor }] = await Promise.all([import('https://esm.sh/@codemirror/language@6'), import('https://esm.sh/@lezer/highlight@1'), import('https://esm.sh/@codemirror/search@6'), import('./style-atoms.js')]);
  const { HighlightStyle, syntaxHighlighting } = lang;
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
  /* editor-wide undo / redo (#177): CodeMirror's historyKeymap covers Ctrl+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z, but with Caps Lock on (or
     any layout reporting the unshifted letter) Ctrl+Shift+Z arrives as key "z" and would run undo; handle it here. The app's own
     shortcuts ignore keys typed in the editor. Alt+Z / Alt+Shift+Z step the app's version history instead (app.js). */
  const editorRedoKey = (e, v) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); cmds.redo(v); return true; } return false; };
  /* on-screen undo / redo buttons (phones have no shortcuts): disabled when the editor's history is empty; one tap = one undo step */
  function wireHistoryButtons(ids) {
    for (const id of ids) {
      const ta = document.getElementById(id); const v = ta && ta.cmView; if (!v) continue;
      const head = ta.closest('.editor'); const u = head && head.querySelector('[data-ed-undo]'); const r = head && head.querySelector('[data-ed-redo]'); if (!u || !r) continue;
      const sync = () => { u.disabled = !cmds.undoDepth(v.state); r.disabled = !cmds.redoDepth(v.state); };
      u.addEventListener('click', () => { cmds.undo(v); v.focus(); }); r.addEventListener('click', () => { cmds.redo(v); v.focus(); });
      for (const b of [u, r]) b.addEventListener('pointerdown', (e) => e.preventDefault()); /* the editor keeps its selection and focus */
      v.dispatch({ effects: smod.StateEffect.appendConfig.of(EditorView.updateListener.of(sync)) }); sync();
    }
  }
  const [vmod, smod, cmds, inlineMod] = await Promise.all([import(`https://esm.sh/@codemirror/view@${V.view}`), import('https://esm.sh/@codemirror/state@6'), import('https://esm.sh/@codemirror/commands@6'), import('./inline.js')]);
  const ghost = inlineMod.setupInline(api, { EditorView, Decoration: vmod.Decoration, WidgetType: vmod.WidgetType, StateField: smod.StateField, StateEffect: smod.StateEffect, Prec: smod.Prec, keymap, ac, indentMore: cmds.indentMore });
  api.ghost = ghost; api.startCompletion = (view) => ac.startCompletion(view);
  const docs = new Map(); ((await viaCache('docs', () => packs().completions())) || []).forEach((d) => docs.set(d.label, d));
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
      if (!ctx) return null;
      let ps = P0[ctx.fn], fn = ctx.fn;
      if (!ps) { /* callees the typed-param table does not know (atoms, docs/ATOMS.md section 10) */
        const r = api.signatureAt({ text, pos, explicit: false, arg: ctx });
        if (!r || !r.params || !r.params.length) return null;
        ps = r.params; fn = r.fn || ctx.fn;
      }
      return { pos: pos - text.length + ctx.open, fn, arg: Math.min(ctx.arg, ps.length - 1), ps, over: ctx.arg >= ps.length };
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
  const theme = EditorView.theme({ '.cm-sig-active': { color: 'var(--sig-2)', fontWeight: '700' }, '.cm-sighelp small': { color: 'var(--dim)' }, '.cm-tooltip.cm-sighelp, .cm-tooltip.cm-tooltip-hover': { pointerEvents: 'none' }, /* informational tooltips (sig help, word hover, lint hover) sit above the caret line; taps on the code under them must reach the editor */ '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sig-2)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--sig-2-soft) !important' }, '.cm-sc-state': { width: '1.4em' }, '.cm-sc-state .cm-gutterElement': { padding: '0' }, '.cm-sc-state .cm-gutterElement > i': { display: 'block', width: '100%', height: '100%' }, '.cm-sc-err': { borderLeft: '3px solid var(--bad)' }, '.cm-tooltip-autocomplete ul li': { padding: '6px 8px', minHeight: '32px' }, '&': { background: 'var(--panel-2)', color: 'var(--text)', fontSize: '.86rem', borderRadius: '0 0 var(--r2) var(--r2)' }, '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0', caretColor: 'var(--sig-2)' }, '.cm-gutters': { background: 'transparent', border: '0', color: 'var(--dim)' }, '&.cm-focused': { outline: '2px solid var(--sig-2)', outlineOffset: '-2px' }, '.cm-scroller': { minHeight: '150px', lineHeight: '1.6' }, '.cm-tooltip': { background: 'var(--panel)', border: '1px solid var(--line, #333)', color: 'var(--text)' }, '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--sig-2)', color: '#000' }, '.cm-completionSection': { color: 'var(--dim)', fontSize: '.72rem', textTransform: 'uppercase', padding: '4px 8px' }, '.cm-sig': { padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '.78rem', maxWidth: '320px' }, '.cm-activeLine, .cm-activeLineGutter': { background: 'transparent' } });
  /* visual feedback hooks: active-event highlights and inline widget canvases (visuals.js) */
  const setW = smod.StateEffect.define();
  class CanvasW extends vmod.WidgetType {
    /* inline visual: a block widget below the calling line, in the scroll flow, as wide as the content; height reserved up front */
    constructor(el) { super(); this.el = el; this.h = (window.strudelCraft.visualsWidgetHeight || (() => 140))(el); }
    eq(o) { return o.el === this.el && o.h === this.h; }
    get estimatedHeight() { return this.h + 8; }
    toDOM(view) { const d = document.createElement('div'); d.className = 'cm-sc-widget'; d.setAttribute('aria-hidden', 'true'); d.contentEditable = 'false'; d.style.height = (this.h + 8) + 'px'; d.append(this.el);
      if (typeof ResizeObserver === 'function') { let last = 0; const r = new ResizeObserver(() => { const hh = d.offsetHeight; if (hh && hh !== last) { last = hh; view.requestMeasure(); } }); r.observe(d); d.__ro = r; }
      return d; }
    destroy(dom) { if (dom.__ro) dom.__ro.disconnect(); }
    ignoreEvent() { return true; } }
  const wField = smod.StateField.define({ create: () => vmod.Decoration.none, update(v, tr) { v = v.map(tr.changes); for (const e of tr.effects) if (e.is(setW)) v = vmod.Decoration.set(e.value.map((w) => vmod.Decoration.widget({ widget: new CanvasW(w.el), block: true, side: 1 }).range(w.pos)), true); return v; }, provide: (f) => EditorView.decorations.from(f) });
  /* #170 identity layer (docs/EDITOR_DECOR.md): every token of the text is a span with a stable data-tok id and every line carries data-ln; ids are
     assigned when a line's text changes (mapped through edits otherwise) and never for a state change. Visual state (playhead, reference marks,
     error line, bracket match, selection matches) is a rule in a style atom (style-atoms.js) that targets those ids: the code DOM is not touched. */
  let TOK = 0; const TRE = /[ \t]+|[\w$#]+|[^\s\w$#]/gu;
  function tokRanges(doc, a, b) {
    const out = [];
    for (let n = doc.lineAt(a).number, last = doc.lineAt(b).number; n <= last; n++) {
      const L = doc.line(n); const ln = 'l' + (++TOK).toString(36); out.push(vmod.Decoration.line({ attributes: { 'data-ln': ln }, ln }).range(L.from));
      TRE.lastIndex = 0; let m; while ((m = TRE.exec(L.text))) { const tok = (++TOK).toString(36); out.push(vmod.Decoration.mark({ attributes: { 'data-tok': tok }, tok }).range(L.from + m.index, L.from + TRE.lastIndex)); }
    }
    return out;
  }
  const tokField = smod.StateField.define({
    create: (st) => vmod.Decoration.set(tokRanges(st.doc, 0, st.doc.length), true),
    update(v, tr) {
      if (!tr.docChanged) return v; let lo = Infinity, hi = -1; tr.changes.iterChangedRanges((fa, ta, fb, tb) => { if (fb < lo) lo = fb; if (tb > hi) hi = tb; });
      const d = tr.state.doc; const a = d.lineAt(Math.min(lo, d.length)).from, b = d.lineAt(Math.min(hi, d.length)).to;
      return v.map(tr.changes).update({ filterFrom: a, filterTo: b, filter: () => false, add: tokRanges(d, a, b), sort: true });
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const toksIn = (st, from, to) => { const ids = []; if (from < to) st.field(tokField).between(from, to, (f, e, v) => { if (v.spec.tok && e > from && f < to) ids.push(v.spec.tok); }); return ids; };
  const lineId = (st, pos) => { let id = null; st.field(tokField).between(pos, pos, (f, e, v) => { if (v.spec.ln) { id = v.spec.ln; return false; } }); return id; };
  /* line-state gutter: one stable marker per line (data-ln); reference and error lines are atom rules on it */
  class LnMark extends vmod.GutterMarker { constructor(id) { super(); this.id = id; } eq(o) { return o.id === this.id; } toDOM() { const i = document.createElement('i'); if (this.id) i.dataset.ln = this.id; return i; } }
  const stateGutter = vmod.gutter({ class: 'cm-sc-state', lineMarker: (view, line) => { const id = lineId(view.state, line.from); return id ? new LnMark(id) : null; }, lineMarkerChange: (u) => u.docChanged, initialSpacer: () => new LnMark('') });
  const T = (t) => `.cm-content [data-tok="${t}"]`, G = (l) => `.cm-sc-state [data-ln="${l}"]`; /* measured (#170): an id selector costs the same per sheet change in Chromium (the change walks the tree either way) */
  const viewOf = (id) => { const t = document.getElementById(id); return t && t.cmView; };
  /* reference inspector marks (refs.js): soft background on the source span, matching tint on related spans, gutter indicator */
  api.refMarks = (id, marks) => {
    const v = viewOf(id); if (!v) return; const st = v.state, n = st.doc.length; const ok = (r) => r && r[0] >= 0 && r[1] <= n && r[0] < r[1];
    const prim = marks && ok(marks.primary) ? marks.primary : null; const rel = ((marks && marks.related) || []).filter(ok); const want = new Map(); const lines = new Map();
    for (const r of rel) { for (const t of toksIn(st, r[0], r[1])) want.set('t' + t, `${T(t)}{background:color-mix(in srgb,var(--sig-2) 10%,transparent);text-decoration:underline dashed var(--sig-2);text-underline-offset:3px}`); lines.set(lineId(st, st.doc.lineAt(r[0]).from), 'rel'); }
    if (prim) { for (const t of toksIn(st, prim[0], prim[1])) want.set('t' + t, `${T(t)}{background:var(--sig-2-soft);box-shadow:inset 0 -1.5px 0 var(--sig-2)}`); lines.set(lineId(st, st.doc.lineAt(prim[0]).from), 'pri'); }
    for (const [l, k] of lines) if (l) want.set('l' + l, k === 'pri' ? `${G(l)}{box-shadow:inset 3px 0 0 var(--sig-2)}` : `${G(l)}{box-shadow:inset 2px 0 0 color-mix(in srgb,var(--sig-2) 55%,transparent)}`);
    atom('editor-refs:' + id).replace(want); v.__refs = prim || rel.length ? { id: (marks && marks.id) || '', primary: prim, related: rel } : null;
    if (prim && marks.scroll !== false) v.dispatch({ effects: EditorView.scrollIntoView(prim[0], { y: 'center' }) });
  };
  api.refView = (id) => viewOf(id);
  /* runtime error (live:error): the line is underlined and its gutter marker turns red, from one atom; hover shows the message */
  function setError(id, e) {
    const v = viewOf(id); if (!v) return; const A = atom('editor-error:' + id);
    if (!e) { A.clear(); v.__err = null; return; }
    const doc = v.state.doc; const L = e.line && e.line >= 1 && e.line <= doc.lines ? doc.line(e.line) : doc.line(doc.lines); const l = lineId(v.state, L.from);
    A.replace([['line', `.cm-content [data-ln="${l}"]{text-decoration:underline wavy var(--bad);text-decoration-skip-ink:none;text-underline-offset:4px}`], ['gut', `${G(l)}{box-shadow:inset 3px 0 0 var(--bad);background:color-mix(in srgb,var(--bad) 22%,transparent)}`]]);
    v.__err = { line: L.number, ln: l, message: String(e.message || '') };
  }
  const errHover = hoverTooltip((view, pos) => { const e = view.__err; if (!e) return null; const L = view.state.doc.lineAt(pos); if (lineId(view.state, L.from) !== e.ln) return null;
    return { pos: L.from, end: L.to, above: true, create() { const dom = document.createElement('div'); dom.className = 'cm-sig cm-sc-err'; dom.setAttribute('role', 'tooltip'); dom.textContent = e.message; return { dom }; } }; });
  /* caret state: matching bracket and other occurrences of a selected word, as atom rules (replaces CodeMirror's class-toggling bracketMatching / highlightSelectionMatches) */
  const caretState = (id) => EditorView.updateListener.of((u) => {
    if (!u.selectionSet && !u.docChanged) return; const st = u.state, sel = st.selection.main; const want = [];
    if (sel.empty) { const m = lang.matchBrackets(st, sel.head, -1) || lang.matchBrackets(st, sel.head, 1);
      if (m) { const d = m.matched ? '{background:var(--panel-3);outline:1px solid var(--line-2)}' : '{color:var(--bad)}'; for (const r of [m.start, m.end]) if (r) for (const t of toksIn(st, r.from, r.to)) want.push(['b' + t, T(t) + d]); } }
    else if (sel.to - sel.from <= 60) { const w = st.sliceDoc(sel.from, sel.to);
      if (/^[\w$]+$/.test(w)) { const re = new RegExp('(?<![\\w$])' + w.replace(/\$/g, '\\$') + '(?![\\w$])', 'g'); const text = st.doc.toString(); let m, k = 0;
        while ((m = re.exec(text)) && k < 200) { if (m.index === sel.from) continue; k++; for (const t of toksIn(st, m.index, m.index + w.length)) want.push(['s' + t, `${T(t)}{background:color-mix(in srgb,var(--sig-2) 18%,transparent)}`]); } } }
    atom('editor-caret:' + id).replace(want);
  });
  /* test and tooling surface: what the atoms currently show, as text */
  api.decorState = (id) => { const v = viewOf(id); if (!v) return null; const sl = (r) => v.state.sliceDoc(r[0], r[1]);
    return { active: (v.__hs || []).map((h) => v.state.sliceDoc(h.from, h.to)), primary: v.__refs && v.__refs.primary ? sl(v.__refs.primary) : null, related: v.__refs ? v.__refs.related.map(sl) : [], refId: v.__refs ? v.__refs.id : null, error: v.__err ? { line: v.__err.line, message: v.__err.message } : null,
      atoms: ['playhead', 'refs', 'error', 'caret'].reduce((o, k) => { o[k] = atom('editor-' + k + ':' + id).size; return o; }, {}) }; };
  /* while a pointer is down in an editor (and shortly after), visual decorations wait: no transaction may race the tap's selection */
  let ptrBusy = 0; const busy = () => performance.now() < ptrBusy;
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.cm-editor')) ptrBusy = performance.now() + 10000; }, true);
  const release = () => { if (ptrBusy) ptrBusy = performance.now() + 300; }; document.addEventListener('pointerup', release, true); document.addEventListener('pointercancel', release, true);
  const vizApi = {
    doc: (id) => { const t = document.getElementById(id); return t && t.cmView ? t.cmView.state.doc.toString() : ''; },
    /* playhead: the tokens under each active event's source location, one atom rule per token; no transaction, nothing in the code DOM changes */
    setHighlights: (id, hs) => { const v = viewOf(id); if (!v) return; const st = v.state, n = st.doc.length; const want = new Map(); v.__hs = hs.filter((h) => h.to <= n && h.from < h.to);
      for (const h of v.__hs) { const c = safeColor(h.color); const r = c ? `{outline:1.5px solid ${c};border-radius:2px;background:color-mix(in srgb,${c} 25%,transparent)}` : '{outline:1.5px solid var(--sig-2);border-radius:2px;background:var(--sig-2-soft)}'; for (const t of toksIn(st, h.from, h.to)) want.set(t, T(t) + r); }
      atom('editor-playhead:' + id).replace(want); },
    /* only dispatch when the widget set really changes: a transaction while a tap's DOM selection is pending makes the caret snap back */
    setWidgets: (id, ws) => { const t = document.getElementById(id); const v = t && t.cmView; if (!v) return; const n = v.state.doc.length; const lineEnd = (p) => v.state.doc.lineAt(Math.min(p, n)).to;
      const list = ws.filter((w) => w.pos <= n).map((w) => ({ ...w, pos: lineEnd(w.pos) })).sort((a, b) => a.pos - b.pos);
      const ids = (v.__wIds = v.__wIds || new WeakMap()); let k = v.__wKeyN || 0; const key = list.map((w) => { if (!ids.has(w.el)) ids.set(w.el, ++k); return w.pos + ':' + ids.get(w.el); }).join(','); v.__wKeyN = k;
      if ((key === v.__wKey && v.__wDoc === v.state.doc) || busy()) return; v.__wKey = key; v.__wDoc = v.state.doc; v.dispatch({ effects: setW.of(list) }); },
  };
  /* one pointer handler for the code area (#169): pointerdown anywhere in it (text, widgets, ghost chip, padding, empty space) puts the caret at the
     nearest position on that event, synchronously, for every node type and pointer type; widgets that act on the tap (literals, ghost chip) still do.
     Native selection waited for the compatibility mousedown (after touchend on touch); the literal gesture even swallowed it on numbers. */
  function pointerCaret(view) {
    const sd = view.scrollDOM; let undo = null; const focus = (v) => { if (v.hasFocus) { v.update([]); return; } v.focus(); v.update([]); }; /* update([]) re-reads focus now: .cm-focused (and the caret) otherwise waits for the focus event */
    sd.addEventListener('pointerdown', (e) => {
      view.__down = true; undo = null;
      if (!e.isPrimary || e.button > 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target; if (t.closest && (t.closest('input,textarea,select') || t.closest('.cm-gutters,.cm-panels,.cm-tooltip'))) return;
      const r = sd.getBoundingClientRect(); if (e.clientX > r.left + sd.clientWidth || e.clientY > r.top + sd.clientHeight) return; /* scrollbars */
      const gw = t.closest && t.closest('.cm-ghost-wrap'); let pos;
      try { pos = gw ? view.posAtDOM(gw) : view.posAtCoords({ x: e.clientX, y: e.clientY }, false); } catch (err) { return; }
      if (pos == null) return; const prev = view.state.selection; const cur = prev.main;
      if (cur.empty && cur.head === pos) { focus(view); return; } /* already there (keeps the ghost chip's tap intact) */
      undo = prev; view.dispatch({ selection: { anchor: pos }, userEvent: 'select.pointer' });
      focus(view); /* every pointer type: Chromium focuses the editor on touchstart anyway, but CM only paints the caret (.cm-focused) once its own focus event lands, ~100 ms later on touch */
    }, true);
    sd.addEventListener('pointerup', (e) => { view.__down = false; undo = null; }, true);
    sd.addEventListener('pointercancel', (e) => { view.__down = false; if (undo && e.pointerType === 'touch') view.dispatch({ selection: undo, userEvent: 'select.pointer' }); undo = null; }, true); /* a scroll started: the caret stays where it was */
  }
  /* CodeMirror's basicSetup minus the features that toggle classes in the code DOM on caret moves (active line, active line gutter, bracket
     matching, selection matches, crosshair cursor): bracket and selection matches are caretState atoms, the active line was themed invisible */
  const setup = [vmod.lineNumbers(), vmod.highlightSpecialChars(), cmds.history(), lang.foldGutter(), vmod.drawSelection(), vmod.dropCursor(), smod.EditorState.allowMultipleSelections.of(true),
    lang.indentOnInput(), lang.syntaxHighlighting(lang.defaultHighlightStyle, { fallback: true }), ac.closeBrackets(), vmod.rectangularSelection(),
    keymap.of([...ac.closeBracketsKeymap, ...cmds.defaultKeymap, ...srch.searchKeymap, ...cmds.historyKeymap, ...lang.foldKeymap, ...ac.completionKeymap])];
  for (const id of ['code', 'stackCode']) {
    const ta = document.getElementById(id); if (!ta) continue;
    if (window.strudelCraft.decor) window.strudelCraft.decor.release(ta); /* the decorated pre-paint leaves in the same task the editor arrives: no frame between */
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'); let view; let syncing = false; let learnT = 0;
    view = new EditorView({
      doc: desc.get.call(ta), parent: ta.parentNode,
      extensions: [smod.Prec.highest(EditorView.domEventHandlers({ keydown: (e, v) => editorRedoKey(e, v) })), ghost.extension, tokField, wField, sigField, setup, stateGutter, javascript(), theme, hl, hover, errHover, caretState(id), EditorView.editorAttributes.of({ 'data-ed': id }), EditorView.lineWrapping, ac.autocompletion({ override: [source], activateOnTyping: true, icons: false }),
        EditorView.contentAttributes.of({ 'aria-label': ta.getAttribute('aria-label') || (id === 'code' ? 'Recipe code' : 'Stack program'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => { if (!u.docChanged || syncing) return; const v = u.state.doc.toString(); desc.set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); clearTimeout(learnT); learnT = setTimeout(() => learn(v), 1200); })],
    });
    ta.after(view.dom); pointerCaret(view);
    Object.defineProperty(ta, 'value', { configurable: true, get: () => desc.get.call(ta), set: (v) => { desc.set.call(ta, v); if (view.state.doc.toString() !== v) { syncing = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } }); syncing = false; } } });
    ta.hidden = true; ta.style.display = 'none'; ta.tabIndex = -1; ta.cmView = view;
    import('./refs.js').then((m) => m.attachEditor(view, id)).catch((e) => console.warn('reference inspector unavailable:', e.message));
    import('./literals.js').then((m) => m.attach(view, id)).catch((e) => console.warn('literal editors unavailable:', e.message));
  }
  const viewFor = (v) => document.getElementById(v === 'stack' ? 'stackCode' : 'code').cmView;
  wireHistoryButtons(['code', 'stackCode']);
  const edFor = (v) => (v === 'stack' ? 'stackCode' : 'code'); void viewFor;
  window.addEventListener('live:error', (e) => setError(edFor(e.detail.view), { line: e.detail.line, message: e.detail.message }));
  window.addEventListener('live:ok', (e) => setError(edFor(e.detail.view), null));
  if (window.strudelCraft.visuals) window.strudelCraft.visuals.attach(vizApi); else window.addEventListener('load', () => window.strudelCraft.visuals && window.strudelCraft.visuals.attach(vizApi));
  document.documentElement.dataset.editor = 'cm6';
}
/* offline the installed app mounts CodeMirror from the service worker snapshot (sw.js crawls the esm.sh graph at install); without it the plain
   editable textarea stays and the editor upgrades once the network is back */
let mounted = false;
const start = () => { if (mounted) return; mounted = true; mount().catch((e) => { mounted = false; console.warn('Intellisense editor unavailable, plain textarea kept:', e.message); window.strudelCraft.ui && window.strudelCraft.ui.toast('Code helper offline: plain editor in use', { kind: 'info' }); window.addEventListener('online', start, { once: true }); }); };
start();
