/* Index of externally fetched resources kept for offline use (#174). The bodies live in Cache Storage (sc-packs-1, sc-banks-1, the shell
   snapshot); this IndexedDB store answers "what do we hold, from where, which version, how big, when fetched" for the Packs view.
   Row: { url, pack, kind: 'manifest'|'entry'|'asset'|'newer', ref (manifest hash or pinned commit source), version, hash, size, fetchedAt }.
   `newer` rows (url = 'newer:<pack>') record a manifest the source now serves that differs from the lock's pin: fetched, never applied.
   createIndex(idb?) -> { put, all, byPack, del, delPack, ok }. Without IndexedDB (private mode, a test host) every call resolves to nothing. */
export function createIndex(idb = globalThis.indexedDB) {
  let dbp = null;
  const open = () => (dbp ||= new Promise((ok) => {
    if (!idb) return ok(null);
    try { const r = idb.open('sc-rescache', 1); r.onupgradeneeded = () => r.result.createObjectStore('res', { keyPath: 'url' }); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); r.onblocked = () => ok(null); } catch (e) { ok(null); }
  }));
  const run = async (mode, fn) => { const db = await open(); if (!db) return null; return new Promise((ok) => { try { const t = db.transaction('res', mode), s = t.objectStore('res'); let out = null; const q = fn(s); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => ok(out); t.onerror = t.onabort = () => ok(null); } catch (e) { ok(null); } }); };
  const all = async () => (await run('readonly', (s) => s.getAll())) || [];
  return {
    ok: async () => !!(await open()),
    put: (row) => run('readwrite', (s) => s.put({ fetchedAt: Date.now(), ...row })),
    all,
    byPack: async (id) => (await all()).filter((r) => r.pack === id),
    del: (url) => run('readwrite', (s) => s.delete(url)),
    delPack: async (id, keepKinds = []) => { const rows = (await all()).filter((r) => r.pack === id && !keepKinds.includes(r.kind)); await run('readwrite', (s) => { rows.forEach((r) => s.delete(r.url)); }); return rows; },
  };
}
