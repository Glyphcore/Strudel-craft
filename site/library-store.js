// Library store adapter (BLUEPRINT 6): the ONLY file that knows where components live.
// Five calls: put(record) -> { id, rev, hash }, get(id, rev?), list(filter?), revs(id), subscribe(fn).
// `window.strudelCraft.history` on main exposes commit/log/diff/checkout/..., not these five calls, so until the history store grows them
// (workflow issue) this adapter uses its own in-memory + localStorage ("sc.library") fallback with the same five calls.
// If a store that does provide the five calls is present, it is used as is.
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const KEY = 'sc.library';
const fail = (c, m) => Object.assign(new Error(`${c} ${m}`), { code: c });

export function fallbackStore(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  let data = {}; const subs = new Set();
  try { if (storage) data = JSON.parse(storage.getItem(KEY) || '{}'); } catch { data = {}; }
  const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(data)); } catch { /* quota: memory copy stays */ } };
  return {
    kind: 'fallback',
    put(record) {
      const { name: id, rev, hash } = record.meta || {};
      if (!id || !Number.isInteger(rev) || !hash) throw fail('E_BAD_RECORD', 'record needs meta.name, rev, hash');
      const list = (data[id] ||= []), old = list[rev - 1];
      if (old) { if (old.meta.hash !== hash) throw fail('E_REV_IMMUTABLE', `${id}@${rev} is stored and cannot be overwritten`); return { id, rev, hash }; }
      if (rev !== list.length + 1) throw fail('E_BAD_REV', `${id} next rev is ${list.length + 1}, got ${rev}`);
      list.push(clone(record)); save(); subs.forEach(f => { try { f({ id, rev, hash }); } catch { /* subscriber errors never break put */ } });
      return { id, rev, hash };
    },
    get(id, rev) { const l = data[id] || []; return clone(rev === undefined ? l[l.length - 1] : l[rev - 1]); },
    list(filter) {
      return Object.entries(data).map(([id, l]) => l[l.length - 1].meta).filter(m => !filter || ((!filter.kind || m.kind === filter.kind) && (!filter.tag || (m.tags || []).includes(filter.tag))))
        .map(m => ({ id: m.name, ...clone(m) }));
    },
    revs(id) { return (data[id] || []).map(r => ({ rev: r.meta.rev, hash: r.meta.hash, parent: r.meta.parent })); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

const FIVE = ['put', 'get', 'list', 'revs', 'subscribe'];
export function defaultStore() {
  const h = typeof window !== 'undefined' && window.strudelCraft && window.strudelCraft.history;
  return h && FIVE.every(k => typeof h[k] === 'function') ? h : fallbackStore();
}
