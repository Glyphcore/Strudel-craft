/* Copy code widget: a 44px icon button pinned at the top-right of every code field (Rack editor, Stack program, Syntax examples).
   Tap copies the whole document (CodeMirror state.doc, never the DOM, for the editors; the example text for Syntax blocks) with
   navigator.clipboard.writeText, falling back to a hidden textarea + execCommand('copy') where the clipboard API is blocked.
   Long-press, right-click, ArrowDown or Shift+F10 on the button opens its menu: Copy selection (when there is one), Copy as a shareable
   link (#code/z<base64url deflate-raw> or #code/p<base64url> without CompressionStream; opening it loads the code into Rack), and
   Copy with controls and state (a recipe v1 JSON with includes {code} only; see schemas/recipe.v1.json).
   API: window.strudelCraft.copycode = { copy(target, mode), text(target), link(code), decode(hash), loadHash(hash), recipe(target), attach() }
   target: 'rack' | 'stack' | a .sx-ex figure; mode: 'code' | 'selection' | 'link' | 'recipe'. Palette: Copy > Copy code (and the three variants). */
import { FORMAT, VERSION, STRUDEL, SUPERDOUGH, collectDeps } from './recipe.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const ICON = '<svg class="cc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg><svg class="cc-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg>';
const TA = { rack: 'code', stack: 'stackCode' };
const viewOf = (t) => { const ta = document.getElementById(TA[t]); return ta && ta.cmView; };
const visible = () => { const v = window.__sc && window.__sc.S && window.__sc.S.view; return v === 'stack' ? 'stack' : 'rack'; };

/* ---------- text sources ---------- */
function text(t = visible()) {
  if (t && t.nodeType) { const pre = t.querySelector('pre'); return t.dataset.code != null ? t.dataset.code : pre ? pre.textContent : ''; }
  const v = viewOf(t); if (v) return v.state.doc.toString();
  const ta = document.getElementById(TA[t]); return ta ? ta.value : '';
}
function selection(t = visible()) {
  if (t && t.nodeType) { const s = window.getSelection(); return s && s.rangeCount && t.contains(s.anchorNode) ? String(s) : ''; }
  const v = viewOf(t); if (!v) return '';
  return v.state.selection.ranges.filter((r) => !r.empty).map((r) => v.state.sliceDoc(r.from, r.to)).join('\n');
}

/* ---------- clipboard ---------- */
function legacyCopy(s) {
  const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  const prev = document.activeElement; document.body.append(ta); ta.select(); ta.setSelectionRange(0, s.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove(); if (prev && prev.focus) prev.focus({ preventScroll: true }); return ok;
}
async function write(s) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(s); return true; } } catch (e) { /* blocked: fall back */ }
  return legacyCopy(s);
}
/* async payloads (recipe deps): ClipboardItem with a promise keeps the user gesture; else write after the await */
async function writeLater(promise) {
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': promise.then((s) => new Blob([s], { type: 'text/plain' })) })]); return true; } catch (e) { /* fall through */ }
  }
  return write(await promise);
}

/* ---------- share link ---------- */
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const pipe = async (bytes, Stream, fmt) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(fmt))).arrayBuffer());
async function link(code) {
  const raw = new TextEncoder().encode(code); let tag = 'p', body = raw;
  if (window.CompressionStream) try { body = await pipe(raw, CompressionStream, 'deflate-raw'); tag = 'z'; } catch (e) { body = raw; tag = 'p'; }
  return location.origin + location.pathname + '#code/' + tag + b64u(body);
}
async function decode(hash) {
  const m = /^#?code\/([zp])([\w-]*)$/.exec(hash || ''); if (!m) return null;
  const bytes = unb64u(m[2]); return new TextDecoder().decode(m[1] === 'z' ? await pipe(bytes, DecompressionStream, 'deflate-raw') : bytes);
}
async function loadHash(hash = location.hash) {
  let code; try { code = await decode(hash); } catch (e) { toast('That code link is damaged and could not be read', { kind: 'error' }); return false; }
  if (code == null) return false;
  if (window.__sc) window.__sc.setView('rack', { push: false });
  const ta = document.getElementById('code'); ta.value = code; ta.dispatchEvent(new Event('input'));
  history.replaceState(null, '', '#rack');
  toast('Loaded shared code into Rack. Press Play to hear it; Revert restores the recipe.', { kind: 'ok' });
  return true;
}

/* ---------- recipe (code-state only) ---------- */
const lsj = (k) => { try { return JSON.parse(localStorage.getItem('sc.' + k)); } catch (e) { return null; } };
const timeout = (p, ms, fb) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(fb()), ms))]);
async function recipe(t = visible()) {
  const code = text(t); const fig = t && t.nodeType; const kind = fig ? 'solo' : t === 'stack' ? 'stack' : 'solo';
  let resolved = code; try { if (sc.atoms && sc.atoms.inline) resolved = sc.atoms.inline(code); } catch (e) { /* keep */ }
  const C = sc.perform && sc.perform.controls; let sites = [];
  try { sites = (!fig && sc.binder && sc.binder.sites ? sc.binder.sites(kind === 'stack' ? 'stack' : 'rack') : []).map((s) => ({ id: s.id, path: s.path, label: s.label, param: s.param, type: s.type, value: s.value, range: s.range })); } catch (e) { sites = []; }
  const S = window.__sc && window.__sc.S; const es = sc.engineState ? sc.engineState() : {};
  const cps = (es.scheduler && es.scheduler.cps) || ((S && S.tempo) || 120) / 240;
  const title = fig ? (t.querySelector('figcaption span') || {}).textContent || 'example' : kind === 'stack' ? 'stack' : ((document.getElementById('nowTitle') || {}).textContent || 'rack');
  const deps = await timeout(collectDeps(code).catch(() => null), 4000, () => null) || { strudel: { ...STRUDEL, sha256: null }, superdough: { ...SUPERDOUGH }, site: { build: 'dev', date: '' }, packs: [], samples: [], vox: [], partial: true };
  return JSON.stringify({ format: FORMAT, version: VERSION, id: 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(title).trim().replace(/[^\w.-]+/g, '-').slice(0, 60) || 'take', created: new Date().toISOString(),
    includes: { audio: false, events: false, code: true }, timing: { cps: +(+cps).toFixed(6), start: 0, stop: 1, cycles: 1, loop: true, mode: 'cycles', exact: false },
    random: { seed: (Math.random() * 2 ** 31) | 0, note: 'Math.random is seeded with this value during offline renders' },
    state: { source: { kind, title, code, resolved, atoms: [...new Set(code.match(/\batoms\.[\w.]+/g) || [])] }, controls: !fig && C ? C.toModel() : null, sites, perform: lsj('perform'),
      settings: { tempo: lsj('tempo'), masterDb: sc.transport ? sc.transport.masterDb : null, follow: lsj('follow'), range: { start: lsj('range.start'), end: lsj('range.end'), loop: lsj('range.loop'), unit: lsj('range.unit') } } },
    events: null, deps, outputs: {} }, null, 2);
}

/* ---------- actions ---------- */
const LABEL = { code: 'Copied', selection: 'Copied selection', link: 'Copied shareable link', recipe: 'Copied recipe JSON (code, controls and state)' };
async function copy(t = visible(), mode = 'code', btn) {
  let ok;
  if (mode === 'recipe') ok = await writeLater(recipe(t));
  else if (mode === 'link') ok = await writeLater(link(text(t)));
  else { const s = mode === 'selection' ? selection(t) : text(t); if (mode === 'selection' && !s) { toast('Nothing selected', { kind: 'info', ms: 1500 }); return false; } ok = await write(s); }
  if (ok) { toast(LABEL[mode], { kind: 'ok', ms: 1600 }); if (btn) { btn.dataset.done = '1'; clearTimeout(btn.__t); btn.__t = setTimeout(() => delete btn.dataset.done, 1400); } }
  else toast('The browser blocked the clipboard. Tap to try again', { kind: 'error', sticky: true, onClick: () => copy(t, mode, btn) });
  return ok;
}

/* ---------- menu ---------- */
let menu = null, menuFor = null;
function closeMenu(focus = true) { if (!menu || menu.hidden) return; menu.hidden = true; const b = menuFor && menuFor.btn; if (b) b.setAttribute('aria-expanded', 'false'); if (focus && b) b.focus({ preventScroll: true }); menuFor = null; }
function openMenu(btn, t) {
  if (!menu) {
    menu = document.createElement('div'); menu.className = 'cc-menu'; menu.id = 'ccMenu'; menu.setAttribute('role', 'menu'); menu.hidden = true; document.body.append(menu);
    menu.addEventListener('click', (e) => { const it = e.target.closest('[data-mode]'); if (!it || it.disabled) return; const f = menuFor; closeMenu(); copy(f.t, it.dataset.mode, f.btn); });
    menu.addEventListener('keydown', (e) => { const its = [...menu.querySelectorAll('button:not([disabled])')]; const i = its.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length].focus(); } else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); } });
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.hidden && !menu.contains(e.target) && !(menuFor && menuFor.btn.contains(e.target))) closeMenu(false); }, true);
    window.addEventListener('resize', () => closeMenu(false));
  }
  const sel = selection(t);
  menu.innerHTML = `<button type="button" role="menuitem" data-mode="code">Copy code</button><button type="button" role="menuitem" data-mode="selection"${sel ? '' : ' disabled aria-disabled="true"'}>Copy selection${sel ? ` <i>${sel.length} chars</i>` : ''}</button><button type="button" role="menuitem" data-mode="link">Copy as shareable link</button><button type="button" role="menuitem" data-mode="recipe">Copy with controls and state <i>recipe JSON</i></button>`;
  menuFor = { btn, t }; menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; menu.style.top = top + 'px';
  (menu.querySelector('[data-mode="code"]')).focus({ preventScroll: true });
}

/* ---------- button ---------- */
function button(target) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-btn';
  b.setAttribute('aria-label', 'Copy code (hold or press Down for more copy options)'); b.title = 'Copy code (hold for more)';
  b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.innerHTML = ICON;
  const t = () => (typeof target === 'function' ? target() : target);
  let timer = 0, held = false, x0 = 0, y0 = 0, t0 = -1;
  b.addEventListener('pointerdown', (e) => { held = false; t0 = -1; if (e.button) return; t0 = e.timeStamp; x0 = e.clientX; y0 = e.clientY; clearTimeout(timer); timer = setTimeout(() => { held = true; if (navigator.vibrate) try { navigator.vibrate(8); } catch (er) { /* ignore */ } openMenu(b, t()); }, 480); });
  b.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 10) { clearTimeout(timer); t0 = -1; } });
  /* a busy main thread can delay the timer past the release: judge the hold by the input timestamps too */
  b.addEventListener('pointerup', (e) => { clearTimeout(timer); if (!held && t0 >= 0 && e.timeStamp - t0 >= 480) { held = true; openMenu(b, t()); } t0 = -1; });
  ['pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => { clearTimeout(timer); t0 = -1; }));
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(timer); if (!(menu && !menu.hidden && menuFor && menuFor.btn === b)) openMenu(b, t()); held = true; });
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (held) { held = false; return; } copy(t(), 'code', b); });
  b.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openMenu(b, t()); } });
  b.addEventListener('mousedown', (e) => e.preventDefault()); /* keep the editor selection and focus */
  return b;
}
function attachEditor(view) {
  const ta = document.getElementById(TA[view]); const v = ta && ta.cmView; const host = v ? v.dom : null;
  if (!host || host.querySelector(':scope > .cc-btn')) return !!host;
  host.classList.add('cc-host'); host.append(button(view)); return true;
}
function attachSyntax(root = document.getElementById('syntax')) {
  if (!root) return; root.querySelectorAll('.sx-ex').forEach((f) => { if (!f.querySelector('pre') || f.querySelector(':scope > .cc-btn')) return; f.classList.add('cc-host'); f.append(button(f)); });
}
function attach() { const a = attachEditor('rack'), b = attachEditor('stack'); attachSyntax(); return a && b; }

/* editors are upgraded to CodeMirror lazily (intellisense.js) and Syntax re-renders: watch both, cheaply */
function watch() {
  const tries = setInterval(() => { if (attach()) clearInterval(tries); }, 400); setTimeout(() => clearInterval(tries), 30000);
  const sx = document.getElementById('syntax'); if (sx) new MutationObserver(() => attachSyntax(sx)).observe(sx, { childList: true });
}
function registerPalette() {
  const P = sc.palette; if (!P || !P.register) return false;
  P.register({ id: 'copy.code', group: 'Copy', title: 'Copy code', run: () => copy(visible(), 'code') });
  P.register({ id: 'copy.selection', group: 'Copy', title: 'Copy code selection', run: () => copy(visible(), 'selection') });
  P.register({ id: 'copy.link', group: 'Copy', title: 'Copy code as shareable link', run: () => copy(visible(), 'link') });
  P.register({ id: 'copy.recipe', group: 'Copy', title: 'Copy code with controls and state (recipe JSON)', run: () => copy(visible(), 'recipe') });
  return true;
}
if (!registerPalette()) { const iv = setInterval(() => { if (registerPalette()) clearInterval(iv); }, 300); setTimeout(() => clearInterval(iv), 15000); }
sc.copycode = { copy, text, selection, link, decode, loadHash, recipe, attach };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
