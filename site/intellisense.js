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
      opts.push({ label: it.label, type: it.method ? 'method' : it.string ? 'text' : it.category === 'presets' ? 'variable' : 'function', detail: it.detail, info: it.info, section: it.category, apply: it.apply, boost: it.provider === 'strudel-docs' ? 2 : it.provider === 'user' ? 1 : 0 });
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
  const docs = new Map(); (await staticData).forEach((d) => docs.set(d.label, d));
  const { hoverTooltip } = await import(`https://esm.sh/@codemirror/view@${V.view}`);
  const hover = hoverTooltip((view, pos) => {
    const { from, to, text } = view.state.doc.lineAt(pos); let s = pos, e = pos;
    while (s > from && /[\w$]/.test(text[s - from - 1])) s--; while (e < to && /[\w$]/.test(text[e - from])) e++;
    const d = docs.get(text.slice(s - from, e - from)); if (!d) return null;
    return { pos: s, end: e, above: true, create() { const dom = document.createElement('div'); dom.className = 'cm-sig'; dom.textContent = d.detail + ' - ' + d.info; return { dom }; } };
  });
  const theme = EditorView.theme({ '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sig-2)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--sig-2-soft) !important' }, '.cm-matchingBracket': { background: 'var(--panel-3)', outline: '1px solid var(--line-2)' }, '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px wavy var(--bad)' }, '.cm-diagnostic-error': { borderLeftColor: 'var(--bad)' }, '.cm-tooltip-autocomplete ul li': { padding: '6px 8px', minHeight: '32px' }, '&': { background: 'var(--panel-2)', color: 'var(--text)', fontSize: '.86rem', borderRadius: '0 0 var(--r2) var(--r2)' }, '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0', caretColor: 'var(--sig-2)' }, '.cm-gutters': { background: 'transparent', border: '0', color: 'var(--dim)' }, '&.cm-focused': { outline: '2px solid var(--sig-2)', outlineOffset: '-2px' }, '.cm-scroller': { minHeight: '150px', lineHeight: '1.6' }, '.cm-tooltip': { background: 'var(--panel)', border: '1px solid var(--line, #333)', color: 'var(--text)' }, '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--sig-2)', color: '#000' }, '.cm-completionSection': { color: 'var(--dim)', fontSize: '.72rem', textTransform: 'uppercase', padding: '4px 8px' }, '.cm-sig': { padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '.78rem', maxWidth: '320px' }, '.cm-activeLine, .cm-activeLineGutter': { background: 'transparent' } });
  for (const id of ['code', 'stackCode']) {
    const ta = document.getElementById(id); if (!ta) continue;
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'); let view; let syncing = false; let learnT = 0;
    view = new EditorView({
      doc: desc.get.call(ta), parent: ta.parentNode,
      extensions: [basicSetup, lint.lintGutter(), javascript(), theme, hl, hover, EditorView.lineWrapping, ac.autocompletion({ override: [source], activateOnTyping: true, icons: false }),
        EditorView.contentAttributes.of({ 'aria-label': ta.getAttribute('aria-label') || (id === 'code' ? 'Recipe code' : 'Stack program'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => { if (!u.docChanged || syncing) return; const v = u.state.doc.toString(); desc.set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); clearTimeout(learnT); learnT = setTimeout(() => learn(v), 1200); })],
    });
    ta.after(view.dom);
    Object.defineProperty(ta, 'value', { configurable: true, get: () => desc.get.call(ta), set: (v) => { desc.set.call(ta, v); if (view.state.doc.toString() !== v) { syncing = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } }); syncing = false; } } });
    ta.hidden = true; ta.style.display = 'none'; ta.tabIndex = -1; ta.cmView = view;
  }
  const viewFor = (v) => document.getElementById(v === 'stack' ? 'stackCode' : 'code').cmView;
  window.addEventListener('live:error', (e) => {
    const view = viewFor(e.detail.view); if (!view) return; const doc = view.state.doc;
    const ln = e.detail.line && e.detail.line >= 1 && e.detail.line <= doc.lines ? doc.line(e.detail.line) : doc.line(doc.lines);
    view.dispatch(lint.setDiagnostics(view.state, [{ from: ln.from, to: ln.to, severity: 'error', message: e.detail.message }]));
  });
  window.addEventListener('live:ok', (e) => { const view = viewFor(e.detail.view); if (view) view.dispatch(lint.setDiagnostics(view.state, [])); });
  document.documentElement.dataset.editor = 'cm6';
}
mount().catch((e) => { console.warn('Intellisense editor unavailable, plain textarea kept:', e.message); window.strudelCraft.ui && window.strudelCraft.ui.toast('Code helper offline: plain editor in use', { kind: 'info' }); });
