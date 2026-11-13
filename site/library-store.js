// Library store adapter (BLUEPRINT 6): the ONLY file that knows where components live.
// Five calls: put(record) -> { id, rev, hash }, get(id, rev?), list(filter?), revs(id), subscribe(fn).
// In the browser the records persist in `window.strudelCraft.history.docs` (namespace "library", IndexedDB store "docs" of "sc-history", #58).
// The library contract is synchronous, the docs API is async, so `docsStore` serves reads from a memory copy that is hydrated from docs and
// writes through to it. Without the docs API (node tests, no IndexedDB) the in-memory + localStorage ("sc.library") `fallbackStore` is used.
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const KEY = 'sc.library';
const fail = (c, m) => Object.assign(new Error(`${c} ${m}`), { code: c });

export function fallbackStore(storage = (typeof localStorage !== 'undefined' ? localStorage : null), { sink = null, key = KEY } = {}) {
  let data = {}; const subs = new Set();
  try { if (storage) data = JSON.parse(storage.getItem(key) || '{}'); } catch { data = {}; }
  const save = () => { try { storage && storage.setItem(key, JSON.stringify(data)); } catch { /* quota: memory copy stays */ } };
  return {
    kind: 'fallback',
    put(record) {
      const { name: id, rev, hash } = record.meta || {};
      if (!id || !Number.isInteger(rev) || !hash) throw fail('E_BAD_RECORD', 'record needs meta.name, rev, hash');
      const list = (data[id] ||= []), old = list[rev - 1];
      if (old) { if (old.meta.hash !== hash) throw fail('E_REV_IMMUTABLE', `${id}@${rev} is stored and cannot be overwritten`); return { id, rev, hash }; }
      if (rev !== list.length + 1) throw fail('E_BAD_REV', `${id} next rev is ${list.length + 1}, got ${rev}`);
      list.push(clone(record)); save(); if (sink) sink(id, rev, clone(record)); subs.forEach(f => { try { f({ id, rev, hash }); } catch { /* subscriber errors never break put */ } });
      return { id, rev, hash };
    },
    get(id, rev) { const l = data[id] || []; return clone(rev === undefined ? l[l.length - 1] : l[rev - 1]); },
    list(filter) {
      return Object.entries(data).map(([id, l]) => l[l.length - 1].meta).filter(m => !filter || ((!filter.kind || m.kind === filter.kind) && (!filter.tag || (m.tags || []).includes(filter.tag))))
        .map(m => ({ id: m.name, ...clone(m) }));
    },
    revs(id) { return (data[id] || []).map(r => ({ rev: r.meta.rev, hash: r.meta.hash, parent: r.meta.parent })); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    // docsStore hydration: adopt a longer rev chain from the persistent store; returns the ids whose local chain is longer (to persist)
    _adopt(id, recs) { const l = (data[id] ||= []); if (recs.length > l.length) { data[id] = recs.map(clone); subs.forEach(f => { try { f({ id, rev: recs.length, hash: recs[recs.length - 1].meta.hash }); } catch { /* ignore */ } }); } return l.length > recs.length ? l.slice(recs.length).map(clone) : []; },
    _ids() { return Object.keys(data); },
  };
}

const NS = 'library';
export function docsStore(docs, storage = (typeof localStorage !== 'undefined' ? localStorage : null), onError = (e) => { try { window.strudelCraft.ui.toast('Library could not save: ' + e.message, { kind: 'error' }); } catch { console.warn('library:', e); } }) {
  // warm cache in localStorage "schist.library" (not an sc.* key, so it is not a timeline entry) so early reads work before hydration; the legacy "sc.library" copy is migrated into docs once, then hydrate from docs
  const inner = fallbackStore(storage, { key: 'schist.library', sink: (id, rev, rec) => { docs.put(NS, id, rec, { rev }).catch(onError); } });
  try { const old = storage && JSON.parse(storage.getItem(KEY) || '{}'); for (const [id, l] of Object.entries(old || {})) if (!inner._ids().includes(id)) l.forEach(rec => inner.put(rec)); } catch { /* no legacy copy */ }
  const ready = (async () => {
    const have = new Set((await docs.list(NS)).map(d => d.id));
    for (const id of new Set([...have, ...inner._ids()])) {
      const rv = await docs.revs(NS, id), recs = [];
      for (const r of rv) { const g = await docs.get(NS, id, r.rev); if (g) recs.push(g.doc); }
      for (const [i, rec] of inner._adopt(id, recs).entries()) await docs.put(NS, id, rec, { rev: recs.length + i + 1 });
    }
  })().catch(onError);
  return { ...inner, kind: 'docs', ready };
}

const FIVE = ['put', 'get', 'list', 'revs', 'subscribe'];
export function defaultStore() {
  const h = typeof window !== 'undefined' && window.strudelCraft && window.strudelCraft.history;
  if (h && FIVE.every(k => typeof h[k] === 'function') && h.docs === undefined) return h;
  if (h && h.docs && typeof h.docs.put === 'function' && typeof indexedDB !== 'undefined') return docsStore(h.docs);
  return fallbackStore();
}
