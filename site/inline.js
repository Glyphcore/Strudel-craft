/* Ghost-text inline suggestions (Copilot-style) for the CodeMirror editors. Local providers only: no network, no LLM.
   Registry: strudelCraft.intellisense.registerInline({ id, priority?, suggest(ctx) -> string[] | Promise<string[]> })
   ctx = { before, after, line, doc, pos }. First non-empty suggestions (by priority, high first) are shown; Ctrl/Alt+] cycles. */
/* Node-aware accept (docs/CONTROL_BINDING.md section 10): one change that replaces the node under the caret and merges with what
   is already there. doc/pos: document and caret; text: suggestion; opts.from: start of the typed prefix (popup) or null (ghost text:
   text continues the node). Returns { from, to, insert, caret, noop }. */
const ID = /[\w$]/, TOKQ = /[^\s"'`\[\]<>{},()|*!@%?:~]/;
function inQuote(doc, pos) { const ls = doc.lastIndexOf('\n', pos - 1) + 1; let q = null; for (let i = ls; i < pos; i++) { const c = doc[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'" || c === '`') q = c; } return q; }
export function mergeAccept(doc, pos, text, { from = null } = {}) {
  const q = inQuote(doc, pos); const cls = q ? TOKQ : ID; const ghost = from == null;
  let a = ghost ? pos : from; let b = pos; if (!ghost) while (b < doc.length && cls.test(doc[b])) b++; /* popup: the whole node under the caret is replaced */
  const le = doc.indexOf('\n', b); const rest = doc.slice(b, le < 0 ? doc.length : le);
  /* chain calls already present later in the statement are not re-inserted */
  let full = text.replace(/\.([A-Za-z_$][\w$]*)\(([^()]*)\)/g, (m, name) => (rest.startsWith(m) || !new RegExp('\\.' + name + '\\(').test(rest) ? m : ''));
  let h = 0; if (!ghost) while (h < full.length && cls.test(full[h])) h++;
  const head = full.slice(0, h), tail = full.slice(h);
  let j = b; for (const ch of tail) if (j < doc.length && doc[j] === ch && doc[j] !== '\n') j++; /* existing parens, closers, args are consumed, not duplicated */
  const insert = head + tail; const to = j; const cur = doc.slice(a, to);
  return { from: a, to, insert, caret: a + insert.length, noop: cur === insert };
}

export function setupInline(api, cm) {
  const { EditorView, Decoration, WidgetType, StateField, StateEffect, Prec, keymap, ac, indentMore } = cm;
  const inline = new Map();
  api.registerInline = (p) => { if (!p || !p.id || typeof p.suggest !== 'function') throw new Error('inline provider needs {id, suggest()}'); inline.set(p.id, p); return () => inline.delete(p.id); };
  api.inlineProviders = () => [...inline.keys()];

  /* ---- (a) n-gram next-token model: catalog recipes + the user's history store ---- */
  const TOK = /\.[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"[^"\n]*"|[()[\],:]/g;
  const tokens = (s) => s.match(TOK) || [];
  const grams = new Map(); // "a b" -> Map(next -> count), also "b" unigram context
  function train(text, w = 1) {
    const t = ['^', ...tokens(text)];
    for (let i = 1; i < t.length; i++) for (const ctx of [t[i - 2] + ' ' + t[i - 1], t[i - 1]]) { if (ctx.includes('undefined')) continue; let m = grams.get(ctx); if (!m) grams.set(ctx, (m = new Map())); m.set(t[i], (m.get(t[i]) || 0) + w); }
  }
  const top = (ctx, k) => { const m = grams.get(ctx); return m ? [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]) : []; };
  const nextTok = (a, b, k = 3) => { const r = top(a + ' ' + b, k); return r.length ? r : top(b, k); };
  const join = (prev, toks) => toks.reduce((s, t, i) => { const p = i ? toks[i - 1] : prev; return s + (p === ',' ? ' ' : '') + t; }, '');
  fetch('data/catalog.json').then((r) => r.json()).then((d) => d.recipes.forEach((r) => train(r.code || ''))).catch(() => {});
  async function trainHistory() {
    const h = window.strudelCraft && window.strudelCraft.history; if (!h) return;
    try { const log = (await h.log()).slice(0, 40); for (const c of log) { const s = await h.get(c.id); if (s) { train(s['ui:rack-editor'] || '', 2); train(s['ui:stack-editor'] || '', 2); } } } catch (e) { /* ignore */ }
  }
  setTimeout(trainHistory, 1500);
  api.registerInline({
    id: 'ngram', priority: 10,
    suggest({ before, after }) {
      if (/\w$/.test(before) && !/\.\w*$/.test(before)) return []; // mid-word: leave it to the popup
      if (after.trim() && !/^[)\]"]/.test(after)) return [];
      const t = ['^', ...tokens(before)]; if (t.length < 2) return [];
      const firsts = nextTok(t[t.length - 2], t[t.length - 1], 3); const out = [];
      for (const f of firsts) {
        const seq = [f]; let a = t[t.length - 1], b = f;
        for (let i = 0; i < 5; i++) { const n = nextTok(a, b, 1)[0]; if (!n || n === '^' || n.startsWith('$')) break; seq.push(n); a = b; b = n; if (n === ')' && seq.filter((x) => x === '(').length <= seq.filter((x) => x === ')').length) break; }
        let s = join(t[t.length - 1], seq);
        if (after.startsWith(')') && s.endsWith(')')) s = s.slice(0, -1); if (after.startsWith('"') && s.endsWith('"')) s = s.slice(0, -1);
        if (s.trim()) out.push(s);
      }
      return out;
    },
  });

  /* ---- (b) snippet templates: default args + the chain that usually follows ---- */
  const ARGS = { lpf: ['800', '400', '2000'], hpf: ['200', '600'], bpf: ['1000'], lpq: ['4', '8'], gain: ['0.8', '0.5'], room: ['0.4', '0.8'], size: ['4'], delay: ['0.25', '0.5'], delaytime: ['0.375', '0.25'], delayfeedback: ['0.4'], decay: ['0.2', '0.1'], sustain: ['0', '0.5'], attack: ['0.01', '0.5'], release: ['0.3', '1'], pan: ['sine.range(0.2,0.8)', '0.5'], fast: ['2'], slow: ['2', '4'], bank: ['"RolandTR909"', '"RolandTR808"'], s: ['"bd*4"', '"hh*8"', '"sawtooth"'], note: ['"c3 e3 g3"', '"<c2 g1>"'], n: ['"0 2 4 7"'], scale: ['"C:minor"'], distort: ['0.5'], crush: ['8'], shape: ['0.4'], velocity: ['0.8'], speed: ['1'], struct: ['"x ~ x ~"'], euclid: ['3, 8'], setcpm: ['120/4'], jux: ['rev'], every: ['4, fast(2)'], degradeBy: ['0.3'], clip: ['0.5'], postgain: ['0.8'] };
  const CHAIN = { lpf: ['.lpq(4)', '.decay(0.2).sustain(0)'], decay: ['.sustain(0)', '.sustain(0).release(0.1)'], sustain: ['.release(0.3)'], attack: ['.decay(0.2).sustain(0.5).release(1)'], s: ['.bank("RolandTR909")', '.gain(0.8)', '.lpf(800)'], note: ['.s("sawtooth")', '.s("sine")', '.s("triangle")'], room: ['.size(4)'], delay: ['.delaytime(0.375).delayfeedback(0.4)'], bank: ['.gain(0.8)'], n: ['.scale("C:minor")'], scale: ['.s("triangle")'] };
  api.registerInline({
    id: 'snippets', priority: 20,
    suggest({ before, after }) {
      let m = /(?:\.|\b)([A-Za-z]\w*)\($/.exec(before);
      if (m && ARGS[m[1]]) return ARGS[m[1]].map((a) => (after.startsWith(')') ? a : a + ')'));
      m = /(?:\.|\b)([A-Za-z]\w*)\([^()]*\)$/.exec(before);
      if (m && CHAIN[m[1]] && !after.trim()) return CHAIN[m[1]];
      return [];
    },
  });

  /* ---- (c) bracket / argument closing ---- */
  api.registerInline({
    id: 'closers', priority: 5,
    suggest({ before, after }) {
      if (after.trim()) return []; const st = []; let q = false;
      for (const ch of before) { if (ch === '"') { q = !q; if (q) st.push('"'); else st.pop(); } else if (!q && (ch === '(' || ch === '[')) st.push(ch === '(' ? ')' : ']'); else if (!q && (ch === ')' || ch === ']')) st.pop(); }
      return st.length ? [st.reverse().map((c) => (c === '"' ? '"' : c)).join('')] : [];
    },
  });

  /* ---- stub for a future remote / LLM provider (not wired) ----
     api.registerInline({ id: 'remote', priority: 0, async suggest(ctx) { return (await fetch(URL, {method:'POST', body: JSON.stringify(ctx)})).json(); } }) */
  api.remoteInlineStub = { id: 'remote', priority: 0, suggest: async () => [] };

  /* ---- CodeMirror wiring ---- */
  const setGhost = StateEffect.define();
  class Ghost extends WidgetType {
    constructor(text, n, i) { super(); this.text = text; this.n = n; this.i = i; }
    eq(o) { return o.text === this.text && o.i === this.i && o.n === this.n; }
    toDOM(view) {
      const w = document.createElement('span'); w.className = 'cm-ghost-wrap';
      const g = document.createElement('span'); g.className = 'cm-ghost'; g.textContent = this.text; w.append(g);
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'cm-ghost-tab'; chip.textContent = this.n > 1 ? `Tab ${this.i + 1}/${this.n}` : 'Tab'; chip.setAttribute('aria-label', 'Accept suggestion: ' + this.text);
      chip.addEventListener('mousedown', (e) => e.preventDefault());
      chip.addEventListener('click', (e) => { e.preventDefault(); accept(view); view.focus(); });
      w.append(chip); return w;
    }
    ignoreEvent() { return false; }
  }
  const field = StateField.define({
    create: () => null,
    update(v, tr) { for (const e of tr.effects) if (e.is(setGhost)) return e.value; if (tr.docChanged || tr.selection) return null; return v; },
    provide: (f) => EditorView.decorations.from(f, (v) => (v ? Decoration.set([Decoration.widget({ widget: new Ghost(v.alts[v.i], v.alts.length, v.i), side: 1 }).range(v.pos)]) : Decoration.none)),
  });
  function accept(view) { /* one transaction, node-aware merge; ghost recomputed afterwards against the new doc */
    const g = view.state.field(field); if (!g) return false; const t = g.alts[g.i]; const r = mergeAccept(view.state.doc.toString(), g.pos, t);
    if (r.noop) view.dispatch({ selection: { anchor: r.caret }, effects: setGhost.of(null) }); else view.dispatch({ changes: { from: r.from, to: r.to, insert: r.insert }, selection: { anchor: r.caret }, userEvent: 'input.complete' });
    return true; }
  function dismiss(view) { if (!view.state.field(field)) return false; view.dispatch({ effects: setGhost.of(null) }); return true; }
  function cycle(view, d) { const g = view.state.field(field); if (!g || g.alts.length < 2) return !!g; view.dispatch({ effects: setGhost.of({ ...g, i: (g.i + d + g.alts.length) % g.alts.length }) }); return true; }
  let seq = 0;
  async function compute(view) {
    const my = ++seq; const st = view.state; const sel = st.selection.main; if (!sel.empty) return;
    if (ac.completionStatus(st)) return;
    const line = st.doc.lineAt(sel.head); const ctx = { before: line.text.slice(0, sel.head - line.from), after: line.text.slice(sel.head - line.from), line: line.number, doc: st.doc.toString(), pos: sel.head };
    if (!ctx.before.trim()) return;
    const ps = [...inline.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0)); let alts = [];
    for (const p of ps) { try { const r = ((await p.suggest(ctx)) || []).filter((x) => x && typeof x === 'string'); for (const x of r) if (!alts.includes(x)) alts.push(x); } catch (e) { /* ignore */ } if (alts.length >= 3) break; }
    alts = alts.slice(0, 5);
    if (my !== seq || view.state !== st || !alts.length || ac.completionStatus(view.state)) return;
    view.dispatch({ effects: setGhost.of({ pos: sel.head, alts, i: 0 }) });
  }
  let t = 0;
  const trigger = EditorView.updateListener.of((u) => {
    if (!u.docChanged || !u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))) return;
    clearTimeout(t); t = setTimeout(() => compute(u.view), 180);
  });
  const keys = Prec.highest(keymap.of([
    { key: 'Tab', run: (v) => (ac.completionStatus(v.state) === 'active' ? ac.acceptCompletion(v) : accept(v) || indentMore(v)) },
    { key: 'Escape', run: (v) => dismiss(v) },
    { key: 'Ctrl-]', run: (v) => cycle(v, 1) }, { key: 'Alt-]', run: (v) => cycle(v, 1) },
    { key: 'Ctrl-[', run: (v) => cycle(v, -1) }, { key: 'Alt-[', run: (v) => cycle(v, -1) },
  ]));
  const theme = EditorView.theme({ '.cm-ghost': { opacity: '.45', fontStyle: 'italic' }, '.cm-ghost-tab': { marginLeft: '6px', padding: '0 8px', minHeight: '28px', minWidth: '44px', fontSize: '.68rem', letterSpacing: '.08em', textTransform: 'uppercase', border: '1px solid var(--sig-2)', borderRadius: 'var(--r1)', background: 'transparent', color: 'var(--sig-2)', verticalAlign: 'middle', cursor: 'pointer' } });
  /* auto-dismiss (CONTROL_BINDING section 11): blur, scroll, tap elsewhere, idle 5 s, view/modal switch; always inert (decoration only) */
  const live = new Set(); let idleT = 0, scroll0 = 0;
  const dismissAll = () => { for (const v of live) { try { if (v.state.field(field)) v.dispatch({ effects: setGhost.of(null) }); if (ac.completionStatus(v.state)) ac.closeCompletion(v); } catch (e) { /* view gone */ } } live.clear(); clearTimeout(idleT); };
  const watch = EditorView.updateListener.of((u) => { const g = u.state.field(field); if (g && !u.startState.field(field)) { live.add(u.view); scroll0 = window.scrollY + u.view.scrollDOM.scrollTop; clearTimeout(idleT); idleT = setTimeout(dismissAll, 5000); } if (ac.completionStatus(u.state) === 'active') live.add(u.view); });
  const domH = EditorView.domEventHandlers({ blur: () => { setTimeout(dismissAll, 0); }, scroll: (e, v) => { if (Math.abs(v.scrollDOM.scrollTop + window.scrollY - scroll0) > 24) dismissAll(); } });
  if (!api.__ghostDocWired) { api.__ghostDocWired = true;
    document.addEventListener('pointerdown', (e) => { if (!live.size || (e.target.closest && (e.target.closest('.cm-ghost-tab') || e.target.closest('.cm-tooltip-autocomplete')))) return; dismissAll(); }, true);
    window.addEventListener('scroll', () => { if (live.size && Math.abs(window.scrollY - scroll0) > 24) dismissAll(); }, { passive: true });
    window.addEventListener('hashchange', dismissAll); document.addEventListener('toggle', dismissAll, true);
    new MutationObserver(() => { if (live.size && document.querySelector('dialog[open]')) dismissAll(); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true }); }
  api.dismissSuggestions = dismissAll;
  return { extension: [field, trigger, keys, theme, watch, domH], accept, dismiss, ghost: (view) => view.state.field(field), show: (view, alts, pos = view.state.selection.main.head) => view.dispatch({ effects: setGhost.of({ pos, alts: [].concat(alts), i: 0 }) }), mergeAccept };
}
