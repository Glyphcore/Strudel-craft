/* Style atoms (#170): visual state for the code areas lives in small stylesheets outside them, one per concern, never in the code DOM.
   Spans in a code area carry stable identity attributes only (data-tok, data-ln, data-sp), written when the text changes; a state change
   (playhead, reference marks, error line, bracket match, graph selection) inserts or deletes one rule here that targets spans by attribute.
   atom(name) -> { name, set(key, rule), delete(key), has(key), keys(), size, clear(), replace(entries), remove() }
     rule = one complete CSS rule ("sel{decl}"); set() with the same text is a no-op; replace(entries) = clear + set each [key, rule]
   atoms.list() -> [{ name, rules }]; atoms.sheets() -> how many sheets the registry owns (adopted or <style>); docs/EDITOR_DECOR.md */
const reg = new Map();
const adopt = typeof document !== 'undefined' && 'adoptedStyleSheets' in Document.prototype && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype;
function make(name) {
  let sheet, node = null;
  if (adopt) { sheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
  else { node = document.createElement('style'); node.dataset.atom = name; document.head.append(node); sheet = node.sheet; }
  const keys = []; const text = new Map(); /* keys[i] is the key of sheet.cssRules[i] */
  const del = (k) => { const i = keys.indexOf(k); if (i < 0) return false; sheet.deleteRule(i); keys.splice(i, 1); text.delete(k); return true; };
  const a = {
    name,
    set(k, rule) { k = String(k); if (text.get(k) === rule) return a; del(k); try { sheet.insertRule(rule, keys.length); keys.push(k); text.set(k, rule); } catch (e) { console.warn('[style-atoms] ' + name + ': bad rule for ' + k); } return a; },
    delete(k) { del(String(k)); return a; },
    has: (k) => text.has(String(k)), keys: () => keys.slice(), get size() { return keys.length; },
    clear() { while (keys.length) { sheet.deleteRule(keys.length - 1); keys.pop(); } text.clear(); return a; },
    replace(entries) { const want = new Map(entries || []); for (const k of keys.slice()) if (!want.has(k)) del(k); for (const [k, r] of want) a.set(k, r); return a; },
    remove() { a.clear(); if (node) node.remove(); else document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); reg.delete(name); },
  };
  return a;
}
export function atom(name) { if (!reg.has(name)) reg.set(name, make(name)); return reg.get(name); }
export const atoms = { atom, list: () => [...reg.values()].map((a) => ({ name: a.name, rules: a.size })), sheets: () => reg.size, adopted: adopt };
/* a CSS value from a pattern (.color("cyan")) is only used when it is a plain colour token; anything else falls back to the theme colour */
export const safeColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%/]+\))$/i.test(c.trim()) ? c.trim() : null);
const sc = (globalThis.strudelCraft = globalThis.strudelCraft || {}); sc.styleAtoms = atoms;
