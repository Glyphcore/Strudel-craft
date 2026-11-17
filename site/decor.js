/* Decorated first paint for the code areas (#170, docs/EDITOR_DECOR.md).
   1. Until a decorator is up, style.css keeps the #code / #stackCode text transparent (never painted undecorated); this module is the first
      deferred module (index.html LATER) and lays a token-coloured <pre> over each textarea, mirroring its text, so the code is readable and
      decorated before CodeMirror arrives (and stays decorated if the editor cannot load). intellisense.js releases the overlay in the same
      task that mounts the editor: no frame between them.
   2. The editor's data (intellisense docs, typed param shapes) is cached in IndexedDB (sc-decor) keyed by the build hash (build.json) and
      the pack set (sc.packs.lock / sc.packs.prefer): a warm start mounts the editor from the cache, the packs refresh it in the background;
      entries of another build are dropped when the cache opens.
   window.strudelCraft.decor = { lex(text), attach(ta), release(ta), cached(name, load), stats(), build() } */
import { atom } from './style-atoms.js';
const sc = (window.strudelCraft = window.strudelCraft || {});

/* ---- lexer: the pre-paint uses the colours of the editor's highlight style (intellisense.js hl) ---- */
const KW = new Set('const let var function return if else for while do break continue new typeof instanceof in of await async class extends import export from default try catch finally throw switch case yield delete void this'.split(' '));
const LIT = new Set(['true', 'false', 'null', 'undefined']);
const RE = /(\/\/[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\[\s\S])*`?)|(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_$][\w$]*)|(\s+)|([\s\S])/gi;
export function lex(text) {
  const out = []; let m; RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    const s = m.index, e = RE.lastIndex; let k;
    if (m[1] || m[2]) k = 'com'; else if (m[3]) k = 'str'; else if (m[4]) k = 'num';
    else if (m[5]) { const w = m[5]; k = LIT.has(w) ? 'num' : KW.has(w) ? 'kw' : /^\s*\(/.test(text.slice(e, e + 40)) || text[s - 1] === '.' ? 'fn' : 'var'; }
    else if (m[6]) k = 'ws'; else k = 'pun';
    out.push([s, e, k]);
  }
  return out;
}
function render(text) {
  const f = document.createDocumentFragment(); let run = '', rk = null;
  const flush = () => { if (!run) return; if (rk === 'ws') f.append(run); else { const s = document.createElement('span'); s.className = 'pd-' + rk; s.textContent = run; f.append(s); } run = ''; };
  for (const [a, b, k] of lex(text)) { if (k !== rk) { flush(); rk = k; } run += text.slice(a, b); }
  flush(); f.append('\n'); return f;
}

/* ---- overlay ---- */
const theme = atom('predecor-theme');
[['wrap', '.sc-pd-wrap{position:relative}'],
 ['ta', '.sc-pd-wrap>textarea{color:transparent!important;animation:none!important;caret-color:var(--sig-2)}'],
 ['pre', '.sc-pd{position:absolute;left:0;top:0;margin:0;overflow:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;border:0;background:none;color:var(--text)}'],
 ['str', '.sc-pd .pd-str{color:var(--sig)}'], ['num', '.sc-pd .pd-num{color:var(--warn)}'], ['kw', '.sc-pd .pd-kw{color:var(--sig-2)}'],
 ['fn', '.sc-pd .pd-fn{font-weight:600}'], ['com', '.sc-pd .pd-com{color:var(--dim);font-style:italic}'], ['pun', '.sc-pd .pd-pun{color:var(--faint)}']].forEach(([k, r]) => theme.set(k, r));
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'];
const DESC = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
const live = new Set();
export function attach(ta) {
  if (!ta || ta.__pd || ta.cmView || ta.hidden) return null;
  const wrap = document.createElement('div'); wrap.className = 'sc-pd-wrap'; const pre = document.createElement('pre'); pre.className = 'sc-pd'; pre.setAttribute('aria-hidden', 'true');
  const focused = document.activeElement === ta, s0 = ta.selectionStart, s1 = ta.selectionEnd;
  ta.before(wrap); wrap.append(ta, pre); if (focused) { ta.focus({ preventScroll: true }); ta.setSelectionRange(s0, s1); }
  const cs = getComputedStyle(ta); for (const p of COPY) pre.style[p] = cs[p];
  let last = null;
  const sync = () => { pre.style.width = ta.clientWidth + 'px'; pre.style.height = ta.clientHeight + 'px'; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  const paint = () => { const v = DESC.get.call(ta); if (v !== last) { last = v; pre.replaceChildren(render(v)); } sync(); };
  Object.defineProperty(ta, 'value', { configurable: true, get: () => DESC.get.call(ta), set: (v) => { DESC.set.call(ta, v); paint(); } });
  ta.addEventListener('input', paint); ta.addEventListener('scroll', sync);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null; if (ro) ro.observe(ta);
  paint();
  const h = { pre, release() { ta.removeEventListener('input', paint); ta.removeEventListener('scroll', sync); if (ro) ro.disconnect(); delete ta.value; wrap.before(ta); wrap.remove(); delete ta.__pd; live.delete(h); } };
  ta.__pd = h; live.add(h); if (!document.documentElement.dataset.editor) document.documentElement.dataset.editor = 'pre';
  return h;
}
export function release(ta) { if (ta && ta.__pd) ta.__pd.release(); }

/* ---- IndexedDB cache of the editor's data, keyed by build hash + pack set ---- */
let buildP = null;
export const build = () => (buildP = buildP || fetch('build.json', { cache: 'no-store' }).then((r) => r.json()).then((b) => String(b.sha || 'dev')).catch(() => 'offline'));
const packSig = () => { try { return (localStorage.getItem('sc.packs.lock') || '') + '|' + (localStorage.getItem('sc.packs.prefer') || ''); } catch (e) { return ''; } };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const ST = { hits: 0, misses: 0, puts: 0, dropped: 0, errors: 0 };
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = build().then((b) => new Promise((ok) => {
    if (b === 'offline') { /* build unknown (offline and no snapshot): read whatever is cached, drop nothing */ }
    let rq; try { rq = indexedDB.open('sc-decor', 1); } catch (e) { ST.errors++; return ok(null); }
    rq.onupgradeneeded = () => rq.result.createObjectStore('b');
    rq.onerror = () => { ST.errors++; ok(null); };
    rq.onsuccess = () => {
      const d = rq.result; if (b === 'offline') return ok({ d, b: null });
      const tx = d.transaction('b', 'readwrite'); const cur = tx.objectStore('b').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return; if (c.value && c.value.build !== b) { c.delete(); ST.dropped++; } c.continue(); };
      tx.oncomplete = () => ok({ d, b }); tx.onerror = () => ok({ d, b });
    };
  }));
  return dbP;
}
const idb = (h, mode, fn) => new Promise((ok) => { try { const tx = h.d.transaction('b', mode); const r = fn(tx.objectStore('b')); tx.oncomplete = () => ok(r && r.result); tx.onerror = tx.onabort = () => { ST.errors++; ok(undefined); }; } catch (e) { ST.errors++; ok(undefined); } });
/* cached(name, load): the stored value for this build + pack set when there is one (load() then refreshes it in the background), else load() stored */
export async function cached(name, load) {
  const h = await db(); const sig = hash(packSig()); const key = name;
  const hit = h ? await idb(h, 'readonly', (s) => s.get(key)) : undefined;
  const store = (v) => { if (!h || v == null) return v; let val; try { val = structuredClone(v); } catch (e) { return v; } idb(h, 'readwrite', (s) => s.put({ build: h.b || (hit && hit.build) || 'offline', sig, data: val, at: Date.now() }, key)).then(() => { ST.puts++; }); return v; };
  if (hit && hit.sig === sig && (h.b == null || hit.build === h.b)) { ST.hits++; Promise.resolve().then(load).then((v) => { if (v != null && JSON.stringify(v) !== JSON.stringify(hit.data)) store(v); }).catch(() => {}); return hit.data; }
  ST.misses++; return store(await load());
}
export const stats = () => ({ ...ST, overlays: live.size });

sc.decor = { lex, attach, release, cached, stats, build };
for (const id of ['code', 'stackCode']) attach(document.getElementById(id));
