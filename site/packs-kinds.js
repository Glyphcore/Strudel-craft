// Craftpack kind adapters for the site (docs/PACK_SPEC.md sections 5, 10.2, 11). The only code that knows both a kind and a registry.
// Each adapter: { formats, code: 'never'|'optional'|'always', check(data) -> message|null, items(data) -> [[bareId, value]],
//                 view(entries, name) -> consumer-shaped data (pull side), apply(ingredient, data, ctx) -> dispose|undefined (push side) }.
// Data only: nothing here evaluates program text or fetches a content URL. The browser checks structure; full schemas run in CI (tools/packs).

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const sc = () => (globalThis.strudelCraft = globalThis.strudelCraft || {});
// poll a registry that another module creates later (module order is not guaranteed); gives up quietly after 20 s
export const whenHas = (get, ms = 20000) => new Promise((ok) => {
  const t0 = Date.now(); const tick = () => { let v; try { v = get(); } catch (e) { v = null; } if (v) ok(v); else if (Date.now() - t0 > ms) ok(null); else setTimeout(tick, 40); }; tick();
});
const firstWins = (entries, pick, key) => { const seen = new Set(), out = []; for (const e of entries) for (const x of pick(e.data) || []) { const k = key(x); if (seen.has(k)) continue; seen.add(k); out.push([x, e]); } return out; };
const mergeKeyed = (entries, section) => { const out = {}; for (const e of entries) for (const [k, v] of Object.entries(e.data[section] || {})) if (!(k in out)) out[k] = v; return out; };

// ---------------------------------------------------------------- HTML sanitiser (section 5, `docs`): allow-listed tags and attributes for every pack
const TAGS = new Set('p div span strong em b i u s code pre kbd small sub sup br hr a ul ol li dl dt dd blockquote h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr th td caption'.split(' '));
const DROP = new Set('script style iframe object embed link meta base form input button textarea select svg math noscript template frame frameset'.split(' '));
const ATTRS = { '*': ['class', 'title'], a: ['href', 'title'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };
const SAFE_HREF = /^(https?:|mailto:|#|\.{0,2}\/)/i;
export function sanitize(html) {
  const s = String(html ?? '');
  if (typeof document === 'undefined') return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
  const t = document.createElement('template'); t.innerHTML = s; // inert: scripts do not run, images do not load
  const walk = (node) => {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) { el.remove(); continue; }
      walk(el);
      if (!TAGS.has(tag)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (!((ATTRS['*'].includes(n)) || (ATTRS[tag] || []).includes(n)) || n.startsWith('on')) { el.removeAttribute(a.name); continue; }
        if (n === 'href' && !SAFE_HREF.test(a.value.trim().replace(/[\u0000- ]/g, ''))) el.removeAttribute(a.name);
      }
      if (tag === 'a') { el.setAttribute('rel', 'noopener'); el.removeAttribute('target'); }
    }
  };
  walk(t.content); return t.innerHTML;
}
// #59: same result as one pass, but it yields to the event loop every ~8 ms, so sanitising a large docs pack is never one long task
const cleanDocs = async (d) => {
  let t = performance.now(); const pace = async () => { if (performance.now() - t > 8) { await new Promise((ok) => setTimeout(ok, 0)); t = performance.now(); } };
  const sections = [];
  for (const sec of d.sections || []) {
    const blocks = [];
    for (const b of sec.blocks || []) { blocks.push(b.type === 'html' ? { ...b, html: sanitize(b.html) } : b.rows ? { ...b, rows: b.rows.map((r) => r.map((c) => sanitize(c))) } : b); await pace(); }
    sections.push({ ...sec, blocks });
  }
  return { ...d, sections };
};

// ---------------------------------------------------------------- adapters
const noop = () => {};
const ctxTrack = (ing, p) => { ing.pending = Promise.resolve(p).catch(() => {}); }; // the registration settles after `load`; tests await ing.pending
const edSrc = (d) => (isObj(d.editors) ? d.editors : d); // the shim file keeps the editors spec under `editors`
export const KINDS = {
  'recipes': { formats: ['recipes@1'], code: 'never',
    check: (d) => (Array.isArray(d.recipes) ? null : 'recipes must be an array'),
    items: (d) => d.recipes.map((r) => [r.id, r]),
    view(entries) { // {categories, labels, recipes}: bare ids first-come by precedence; every recipe carries its pack id
      const recipes = firstWins(entries, (d) => d.recipes, (r) => r.id).map(([r, e]) => ({ labels: [], needs: [], unverified: [], intent: '', notes: '', expr: r.code, ...r, pack: e.pack })); // defaults the Rack view reads without checking
      const cats = firstWins(entries, (d) => d.categories, (c) => c.id).map(([c]) => c), labels = firstWins(entries, (d) => d.labels, (l) => l.id).map(([l]) => ({ words: [], ...l }));
      const head = entries[0] ? entries[0].data : {};
      return { version: head.version, strudel_web: head.strudel_web, url_format: head.url_format, url_format_verified: head.url_format_verified, categories: cats, labels, recipes };
    } },
  'control-types': { formats: ['control-types@1'], code: 'optional',
    check: (d) => (Array.isArray(d.types) ? null : 'types must be an array'),
    items: (d) => d.types.map((t) => [t.id, t]),
    view: (entries) => ({ version: 1, types: firstWins(entries, (d) => d.types, (t) => t.id).map(([t]) => t) }),
    apply(ing, d, ctx) { // controls.registerType; a type already registered (an earlier, higher-precedence pack) is kept
      const undo = []; ctx.track(whenHas(() => sc().controls && sc().controls.registry).then((reg) => {
        if (!reg) return; const have = new Set(reg.types().map((t) => t.id));
        for (const t of d.types) if (!have.has(t.id)) undo.push(reg.registerType(t));
      }));
      return () => undo.forEach((u) => typeof u === 'function' && u());
    },
    // sandboxed renderers (#71): a type with `renderer: {module}` gets a registry renderer that draws inside its own sandboxed frame (packs-control.js);
    // registered only when the gate passes, withdrawn on revoke / flag off. Without it the type renders through `render.fallback` (data part above).
    sandbox(ing, d, sb) {
      let dead = false; const offs = [];
      const tps = (Array.isArray(d.types) ? d.types : []).filter((t) => t && typeof t.id === 'string' && t.renderer && typeof t.renderer.module === 'string' && ing.modules.some((m) => m.path === t.renderer.module));
      if (tps.length) ctxTrack(ing, (async () => {
        const reg = await whenHas(() => sc().controls && sc().controls.registry); if (!reg || dead) return;
        const C = await import('./packs-control.js'); if (dead) return;
        for (const t of tps) {
          await whenHas(() => reg.type(t.id), 5000); if (dead) return; const ty = reg.type(t.id); if (!ty) continue;
          const off = reg.registerRenderer(t.id, (host, name, spec, io) => C.mountSandboxControl(host, { type: ty, name, spec, io, pack: ing.pack.id, ingredient: ing.id, spawn: (el) => sb.spawn(el, t.renderer.module), registry: reg }));
          offs.push(() => { off(); const x = reg.type(t.id); if (x) x.drawn = false; });
        }
      })());
      return () => { dead = true; offs.forEach((f) => f()); sb.stop(); };
    } },
  'intellisense': { formats: ['intellisense@1'], code: 'never',
    check: (d) => (Array.isArray(d.items) ? null : 'items must be an array'),
    items: (d) => d.items.map((i) => [`${i.category || ''}|${i.label}`, i]),
    view: (entries) => firstWins(entries, (d) => d.items, (i) => `${i.category || ''}|${i.label}`).map(([i]) => i),
    apply(ing, d, ctx) { // intellisense.register: one static provider per ingredient
      let off = null; ctx.track(whenHas(() => sc().intellisense && sc().intellisense.register && sc().intellisense).then((api) => { if (api) off = api.register({ id: d.provider || ctx.ingredient, items: () => d.items }); }));
      return () => { if (typeof off === 'function') off(); };
    } },
  'param-shapes': { formats: ['param-shapes@1'], code: 'never',
    check: (d) => (isObj(d) ? null : 'param-shapes must be an object'),
    items: (d) => ['params', 'ranges', 'canon'].flatMap((s) => Object.entries(d[s] || {}).map(([k, v]) => [`${s}.${k}`, v])),
    view: (entries) => ({ params: mergeKeyed(entries, 'params'), shapes: firstWins(entries, (d) => d.shapes, (s) => JSON.stringify(s)).map(([s]) => s), ranges: mergeKeyed(entries, 'ranges'), canon: mergeKeyed(entries, 'canon') }) },
  'param-editors': { formats: ['param-editors@1'], code: 'optional',
    check: (d) => (isObj(d) ? null : 'param-editors must be an object'),
    items: (d) => Object.entries(edSrc(d)).filter(([k, v]) => isObj(v) && k !== '_doc').flatMap(([s, o]) => Object.entries(o).map(([k, v]) => [`${s}.${k}`, v])),
    view: (entries) => { const out = {}; const es = entries.map((e) => ({ ...e, data: edSrc(e.data) })); for (const s of ['byShape', 'byGroup', 'gestures', 'defaults', 'pools']) { const m = mergeKeyed(es, s); if (Object.keys(m).length) out[s] = m; } return out; } },
  'syntax': { formats: ['syntax@1'], code: 'never',
    check: (d) => (Array.isArray(d.sections) ? null : 'sections must be an array'),
    items: (d) => d.sections.map((s) => [s.id, s]),
    view: (entries) => ({ sections: firstWins(entries, (d) => d.sections, (s) => s.id).map(([s, e]) => ({ ...s, pack: e.pack })) }) },
  'docs': { formats: ['docs@1'], code: 'never',
    check: (d) => (Array.isArray(d.sections) ? null : 'sections must be an array'),
    items: () => [],
    prepare: cleanDocs, // sanitised once, before the data is stored (async: packs.js awaits it)
    view: (entries) => (entries[0] ? entries[0].data : { sections: [] }) },
  'sounds': { formats: ['sounds@1'], code: 'never',
    check: (d) => (isObj(d) ? null : 'a sound map must be an object'),
    items: (d) => Object.entries(d).filter(([k]) => k !== '_base'),
    view: (entries) => Object.assign({}, ...entries.slice().reverse().map((e) => e.data)),
    apply(ing, d, ctx) { // samples(map, base): winners under the bare key, every key under its mini-safe alias (9.3 rule 5)
      const map = {}; for (const [k, v] of Object.entries(d)) { if (k === '_base') continue; if (ctx.wins('sounds', k)) map[k] = v; map[ctx.alias(k)] = v; }
      ctx.track(ctx.samples(map, ctx.assetDir(ing.path, d._base)));
    } },
  'vox-bank': { formats: ['vox-bank@1'], code: 'never',
    check: (d) => (isObj(d) && isObj(d.maps) ? null : 'a vox bank needs maps'),
    items: (d) => Object.entries({ ...(d.maps.flat || {}), ...(d.maps.pitched || {}) }).filter(([k]) => k !== '_base'),
    view: (entries) => entries.map((e) => ({ pack: e.pack, ingredient: e.ingredient, prefix: e.data.prefix, words: e.data.words })),
    async apply(ing, d, ctx) { // registered when the bank is activated (manual): same samples() path as today's voxBank()
      const map = { ...(d.maps.flat || {}), ...(d.maps.pitched || {}) }; delete map._base;
      return ctx.samples(map, ctx.assetDir(ing.path, (d.maps.pitched || d.maps.flat || {})._base));
    } },
  'atoms': { formats: ['atoms@1'], code: 'never',
    check: (d) => (isObj(d.atoms) ? null : 'atoms must be an object'),
    items: (d) => Object.values(d.atoms).map((a) => [a.name, a]),
    view: (entries) => entries.map((e) => ({ pack: e.pack, ingredient: e.ingredient, atoms: e.data.atoms })),
    async apply(ing, d, ctx) { // E_ATOM_HASH on any mismatch; the imports are then reachable as atoms.import("pack:author/pack:ingredient")
      const AC = await import('./engine/atoms-consumers.js'); // loaded only when an atoms ingredient exists
      const imp = AC.importedAtoms({ id: ctx.id(ctx.ingredient), data: d });
      const a = await whenHas(() => sc().atoms && sc().atoms.imports); if (a) a({ ['pack:' + ctx.id(ctx.ingredient)]: imp });
    } },
  // extension kind: data-only passthrough (hosts without an adapter skip an x- kind silently, section 3)
  'x-glyphcore.words': { formats: ['x-glyphcore.words@1'], code: 'never',
    check: (d) => (Array.isArray(d.items) ? null : 'items must be an array'),
    items: () => [],
    view: (entries) => firstWins(entries, (d) => d.items, (i) => `${i.kind}|${i.name}`).map(([i]) => i) },
  // extension kind (#85): the vox bank index pack (glyphcore/vox, tools/vox/bank_index.py): banks.json plus each bank's words.json and pitched map,
  // read whole through packs.raw() by the Banks browser and word() completions only when opened. Data only; registers nothing.
  'x-glyphcore.vox-data': { formats: ['x-glyphcore.vox-data@1'], code: 'never',
    check: (d) => (isObj(d) ? null : 'vox data must be an object'),
    items: () => [],
    view: (entries) => entries.map((e) => ({ pack: e.pack, ingredient: e.ingredient })) },
  // code-bearing kinds: the data part is never run here. Without the sandbox host (#71) they are `blocked` (fail closed).
  // sandboxed code kind (#71): `sandbox(ing, data, sb)` runs only when the loader's gate passes; the module starts on the first completion, never on load
  'intellisense-provider': { formats: ['intellisense-provider@1'], code: 'always',
    check: (d) => (typeof d.module === 'string' && d.module ? null : 'module must name a declared module path'),
    items: () => [], view: () => [],
    sandbox(ing, d, sb) {
      let off = null, dead = false; const id = typeof d.id === 'string' && d.id ? d.id : ing.id;
      const hasApi = whenHas(() => sc().intellisense && sc().intellisense.registerSource && sc().intellisense).then((api) => {
        if (!api || dead) return; off = api.registerSource({ id: 'pack:' + ing.pack.id + ':' + ing.id, async complete(c) {
          if (ing.state !== 'ready') return null;
          const line = c.doc.slice(c.doc.lastIndexOf('\n', c.pos - 1) + 1, (c.doc.indexOf('\n', c.pos) + 1 || c.doc.length + 1) - 1);
          const input = { before: c.text.slice(-2000), after: c.doc.slice(c.pos, c.pos + 500), line: line.slice(0, 500), pos: c.pos };
          const go = sb.ensure().then(() => sb.call('complete', input, { timeoutMs: Number(d.timeoutMs) > 0 ? Math.min(Number(d.timeoutMs), 1000) : undefined }));
          let r; try { r = await Promise.race([go, new Promise((ok) => setTimeout(() => ok(null), 400))]); } catch (e) { return null; } // a slow or failing module never blocks the popup
          const { cleanItems } = await import('./packs-sandbox.js'); const items = cleanItems(r, id); if (!items.length) return null;
          const w = /[\w$]*$/.exec(c.text)[0];
          return { from: c.pos - w.length, merge: true, options: items.map((i) => ({ label: i.label, type: i.method ? 'method' : 'function', detail: i.detail, info: i.info, apply: i.apply, section: { name: i.category, rank: 3 } })) };
        } });
      });
      ing.dispose = null; void hasApi;
      return () => { dead = true; if (typeof off === 'function') off(); sb.stop(); };
    } },
  'prelude': { formats: ['prelude@1'], code: 'always', check: () => null, items: () => [], view: () => [] },
};
export const knownKind = (kind) => Object.prototype.hasOwnProperty.call(KINDS, kind);
// kinds the spec defines but this host has no adapter for yet: skipped with W_PACK_KIND, never an error
export const DEFERRED = new Set(['hooks', 'components', 'layouts', 'palette-actions', 'visuals']);
