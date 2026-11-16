// Aliases at the point of use (docs/PACK_SPEC.md 9.3 rule 8; #120). Pure ES module, no imports; shared by the atoms engine, the hooks pack adapter, the library,
// the site recipe lookup and the CLI. An alias is an older id of an item: a reference to it behaves exactly like the new id and raises one deprecation
// hint per alias (never an error). The hint goes to a sink: console.warn by default (the CLI prints it on stderr), a toast on the site (app.js).
const TOLD = new Set();
let SINK = (m) => { if (typeof console !== 'undefined') console.warn(m); };
export const setAliasSink = (f) => { SINK = typeof f === 'function' ? f : SINK; };
export const resetAliasHints = () => TOLD.clear();
/* once per kind+alias; returns true when it told */
export function aliasHint(kind, alias, to) {
  const k = kind + '!' + alias; if (TOLD.has(k)) return false; TOLD.add(k);
  SINK(`${kind} "${alias}" is an alias (deprecated): use "${to}"`); return true;
}
const word = (s) => new RegExp('(^|[^A-Za-z0-9_.-])' + String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_-])');
/* hook defs: add a copy of every def under each of its aliases (same params and chain; filing data dropped) so `.hook("oldName")` and hooks.bind(slot, "oldName") resolve.
   An alias that names a real def stays the real def. `text` = the program: a hint is raised only for aliases the program actually uses. -> { defs, aliases: { alias: target } } */
export function expandAliasDefs(defs, text = '') {
  const out = { ...defs }, aliases = {};
  for (const [name, d] of Object.entries(defs || {})) {
    if (!d || typeof d !== 'object') continue;
    for (const a of Array.isArray(d.aliases) ? d.aliases : []) {
      if (typeof a !== 'string' || Object.prototype.hasOwnProperty.call(defs, a) || Object.prototype.hasOwnProperty.call(aliases, a)) continue;
      const { folder, tags, aliases: _x, ...rest } = d; out[a] = { ...rest, doc: `Deprecated alias of ${name}` + (d.doc ? `. ${d.doc}` : '') }; aliases[a] = name;
      if (text && word(a).test(text)) aliasHint('hook', a, name);
    }
  }
  return { defs: out, aliases };
}
