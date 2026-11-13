// Site wiring for atoms (docs/ATOMS.md; #62, #63): loads the type registry and argument positions, exposes the toolkit as
// window.strudelCraft.atoms, and registers the consumers - intellisense source and signature provider, literal-editor shapes for
// reference args, the hooks atoms channel (id map, point markers, `$atom` resolver), map destinations and revision records.
// "Open in strudel.cc" and "Copy" call atoms.inline(code) first (app.js `plain`), because `atoms` does not exist outside this toolkit.
// Visible UI (reference popover, atom cards, browser) is #64: here everything is data.
import * as A from './engine/atoms.js';
import * as M from './engine/atoms-migrate.js';
import * as C from './engine/atoms-consumers.js';

const json = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(u + ' ' + r.status))));
const sc = (window.strudelCraft = window.strudelCraft || {});
const LOG = 'sc.atoms.log'; // atom revisions (kind: "atom") live with the rest of the history store
let prevAtoms = {}, imports = {};

const editorText = () => ['code', 'stackCode'].map((id) => { const t = document.getElementById(id); return t ? t.value : ''; }).join('\n');
const envCache = new Map(); let lastEnv = null;
// While the program is being typed it rarely parses; the environment then comes from the declaration lines alone, and failing that
// from the last good one, so completions and editors keep working mid-edit (the site stays on the last good compile either way).
function envFor(code = editorText()) {
  if (envCache.has(code)) return envCache.get(code);
  const build = (src) => { try { return A.buildEnv(src, { atoms: prevAtoms, imports }, { diag: [] }); } catch (e) { return null; } };
  const decls = () => code.split('\n').filter((l) => /^\s*(atom|atoms\.import)\s*\(/.test(l)).join('\n');
  const env = build(code) || build(decls()) || lastEnv;
  if (env) lastEnv = env;
  if (envCache.size > 8) envCache.clear();
  envCache.set(code, env); return env;
}
// atom revisions: reconcile the declarations against the last known map and append one record per new revision
function record(env) {
  let r; try { r = A.reconcile(prevAtoms, env); } catch (e) { return null; }
  const recs = C.revisions(prevAtoms, r.atoms, { time: Date.now() });
  if (recs.length) { let log = []; try { log = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) { log = []; } try { localStorage.setItem(LOG, JSON.stringify([...log, ...recs].slice(-500))); } catch (e) { /* storage full */ } }
  prevAtoms = r.atoms; return r;
}
// the compile pass, run before protect() and Strudel's transpiler (app.js protectCode): plain Strudel out, atoms inlined.
// Also refreshes the hooks atoms channel so hooks.plan / toJSON / the journal carry atom ids, and point atoms register their markers.
function prepare(code) {
  if (!/\batoms?\b/.test(code)) return code;
  const env = envFor(code); if (!env) return code;
  wireRuntime();
  let res; try { res = A.compile(code, env, { overrides: overrides(env) }); } catch (e) { return code; }
  const r = record(env);
  try { const rt = sc.hooks; if (rt && rt.atoms) C.installHooks(rt, env, { ids: r ? r.ids : {} }); } catch (e) { /* runtime not ready */ }
  return res.code;
}
// live atom params: `atom:<id>.<param>` map destinations get their value from the controls engine (ATOMS section 10)
function overrides(env) {
  const p = sc.perform; const ctl = p && p.controls; if (!ctl || !ctl.maps) return undefined;
  try { const o = C.mapOverrides(env, ctl.maps().filter((m) => C.ATOM_DEST.test(String(m.dest))), (name) => ctl.valueAt(name.split(':')[0], 0)); return Object.keys(o).length ? o : undefined; } catch (e) { return undefined; }
}

sc.atoms = {
  ...A, ...M, ...C, prepare,
  inline: (code, o) => { if (!sc.atoms.ready && /\batoms?\b/.test(code)) throw new Error('atoms data not loaded yet'); return M.inline(code, o); },
  env: envFor, atomsOf: () => prevAtoms, imports: (set) => { if (set) imports = { ...imports, ...set }; envCache.clear(); return imports; },
  log: () => { try { return JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) { return []; } },
  // reference sites in the editor text and the popover data of one site (the popover itself is #64)
  sites: (code = editorText()) => { const env = envFor(code); return env ? C.sites(code, env) : []; },
  open: (siteId, code = editorText()) => { const env = envFor(code); return env ? C.siteData(code, env, siteId) : null; },
};

// ---------------------------------------------------------------- intellisense (ATOMS section 10)
const calleeKey = (ctx) => { // argContext -> the key data/atoms/positions.json uses
  if (!ctx || !ctx.fn) return null;
  const before = ctx.text.slice(0, ctx.open - ctx.fn.length);
  if (/\bhooks\.$/.test(before)) return 'hooks.' + ctx.fn;
  return ctx.method ? '.' + ctx.fn : ctx.fn;
};
function install() {
  const api = sc.intellisense; if (!api) return;
  api.registerSource({
    id: 'atoms',
    complete(ctx) {
      const env = envFor(); if (!env) return null;
      const text = ctx.text, arg = ctx.arg;
      const callee = arg ? calleeKey({ ...arg, text }) : null;
      // 1. member completion after `atoms.` (names, namespaces, catalog by prefix query) - exclusive for that position
      const mem = /(^|[^\w$.])atoms\.([\w.]*)$/.exec(text);
      if (mem && !arg?.quote) {
        const path = mem[2], from = ctx.pos - path.length - 'atoms.'.length;
        const items = C.memberItems(env, { path, types: callee ? C.typesAt(callee, arg.arg) : null });
        return { from, options: items.map((it, i) => ({ label: it.label, detail: it.detail, info: it.info, type: it.namespace ? 'namespace' : 'variable', apply: it.apply || it.label, section: { name: 'atoms', rank: -1 }, boost: 60 - i })), validFor: /^[\w$.]*$/ };
      }
      // 2. inside a string literal that an atom already compiles to: "use atoms.name", rewriting only that literal
      if (arg && arg.quote) {
        const q = arg.quote, open = text.lastIndexOf(q);
        if (open >= 0) {
          const doc = ctx.doc || text, end = doc.indexOf(q, Math.max(open + 1, ctx.pos));
          const value = doc.slice(open + 1, end < 0 ? ctx.pos : end);
          const act = value ? C.literalAction(env, { text: value, callee, arg: arg.arg }) : null;
          if (act) {
            const to = end < 0 ? ctx.pos : end + 1;
            return { from: ctx.pos, options: [{ label: act.label, detail: 'atom', info: `${act.type} atom "${value}"`, type: 'variable', boost: 70, section: { name: 'atoms', rank: -1 },
              apply: (view) => view.dispatch({ changes: { from: open, to, insert: act.apply }, selection: { anchor: open + act.apply.length }, userEvent: 'input.complete' }) }] };
          }
        }
      }
      // 3. typed argument position: atoms whose type fits, added to the shape suggestions
      if (arg && !arg.quote) {
        const items = C.argItems(env, { callee, arg: arg.arg, shape: null });
        if (items.length) return { merge: true, options: items.map((it, i) => ({ label: it.label, detail: it.detail, info: it.info, type: 'variable', apply: it.apply, section: { name: 'atoms', rank: -1 }, boost: 45 - i })) };
      }
      return null;
    },
  });
  api.registerSignature({
    id: 'atoms',
    signature(ctx) {
      const m = /atoms\.([\w.]+)\s*\($/.exec(ctx.text.slice(0, (ctx.arg && ctx.arg.open != null ? ctx.arg.open : ctx.text.length) + 1));
      if (!m) return null;
      const env = envFor(); if (!env) return null;
      const s = C.signature(env, m[1]); if (!s || !s.params.length) return null;
      return { fn: s.fn, params: s.params };
    },
  });
}
// literal editors: an atom reference's args are literal sites with the atom's atomParam shape (scrub, chips, steps, piano, toggle).
// literals.js is imported by the editor after CodeMirror mounts, so the registration waits for it.
const whenReady = (get, fn, tries = 60) => { if (get()) return fn(); if (tries > 0) setTimeout(() => whenReady(get, fn, tries - 1), 250); };
function installEditors() {
  const lit = sc.literals; if (!lit) return;
  lit.registerEditor({
    id: 'atoms',
    shape(l) {
      const code = editorText(), env = envFor(code); if (!env) return null;
      return C.shapeAt(code, env, l.from, l.to);
    },
  });
}

// reference popover (#64): an `atoms.*` reference is one token; a tap on it or Enter with the caret inside opens atoms-pop.js (loaded
// on first use). Taps on an argument literal inside the reference stay with the literal editors.
function installPopover() {
  for (const id of ['code', 'stackCode']) {
    const v = sc.intellisense.refView && sc.intellisense.refView(id); if (!v || v.__axPop) continue; v.__axPop = 1;
    const at = (pos) => { const doc = v.state.doc.toString(); if (!/\batoms\./.test(doc)) return null; const s = sc.atoms.sites(doc).find((x) => pos >= x.from && pos <= x.to); return s && !s.argSites.some((a) => pos >= a.from && pos <= a.to) ? s : null; };
    const go = (s, focus) => import('./atoms-pop.js').then((m) => m.open(v, s, { focus })).catch((e) => console.warn('atom popover unavailable:', e.message));
    let down = null;
    v.scrollDOM.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
    v.scrollDOM.addEventListener('pointerup', (e) => { const d = down; down = null; if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; const p = v.posAtCoords({ x: e.clientX, y: e.clientY }); const s = p == null ? null : at(p); if (s) go(s, false); }, true);
    v.contentDOM.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.cm-tooltip-autocomplete')) return; const r = v.state.selection.main; if (!r.empty) return; const s = at(r.head); if (s && r.head > s.from && r.head < s.to) { e.preventDefault(); e.stopPropagation(); go(s, true); } }, true);
  }
}
// Strudel's own mini() and the hooks runtime parsers are the atom validators (no second copies, ATOMS section 3)
function wireRuntime() {
  try {
    const rt = sc.hooks, o = {};
    if (typeof window.mini === 'function') o.mini = window.mini;
    if (rt && rt.parsers) o.parsers = rt.parsers;
    if (rt && rt.atoms && typeof rt.atoms.use === 'function') rt.atoms.use({ resolve: (ref) => { const env = envFor(); return env ? C.target(env, ref) : null; } });
    if (Object.keys(o).length) A.configure(o);
  } catch (e) { /* runtime not ready */ }
}
window.addEventListener('strudel:ready', wireRuntime);
window.addEventListener('strudel:hooks-changed', wireRuntime);

Promise.all([json('data/atoms/types.json'), json('data/atoms/positions.json')])
  .then(([types, positions]) => {
    A.loadTypes(types); A.configure({ positions }); sc.atoms.ready = true;
    whenReady(() => sc.intellisense, install); whenReady(() => sc.literals, installEditors); whenReady(() => sc.intellisense && sc.intellisense.refView && sc.intellisense.refView('code'), installPopover); wireRuntime();
    try { const s = sc.sounds || (sc.perform && sc.perform.sounds); if (s) A.configure({ catalog: { snd: s } }); } catch (e) { /* no sound catalog yet */ }
    document.addEventListener('input', () => envCache.clear(), true);
  })
  .catch((e) => console.warn('atoms data failed to load:', e.message));
