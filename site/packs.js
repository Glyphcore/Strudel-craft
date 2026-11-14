// Site pack loader (docs/PACK_SPEC.md sections 8-11, 13): reads the lock layers, verifies the hash tree, applies ingredients through the
// kind adapters of packs-kinds.js, caches verified bytes for offline use and reports the resolution. Exposed as window.strudelCraft.packs.
// Fail closed and never throw from loading: a bad ingredient is reported once and skipped. Code ingredients run only in the sandbox host
// (packs-sandbox.js, #71) and only when the pack is hash-verified, the ingredient is granted AND trusted for its code hash, and the flag is on;
// assets are never fetched by the loader (they stream on first play, the service worker verifies them).
import { resolve as coreResolve, API, aliasOf, itemIds, verify as coreVerify, pinnedBases } from './engine/packs-core.js';
import { KINDS, DEFERRED, sanitize, whenHas } from './packs-kinds.js';

export { API, sanitize };
const MAX_ENTRY = 5 * 1024 * 1024, EAGER_ITEM = 256 * 1024, EAGER_PACK = 1024 * 1024;
const LAYERS = ['shipped', 'user', 'session'];
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha = async (bytes) => 'sha256:' + hex(await crypto.subtle.digest('SHA-256', bytes));
const semver = (v) => String(v).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) || null;
function satisfies(range, ver) { // ^, ~, >=, exact, *: enough for `engines.craft`
  const v = semver(ver); if (!v) return false; range = String(range).trim(); if (range === '*' || range === '') return true;
  const m = /^(\^|~|>=|=)?\s*(\d+\.\d+\.\d+)/.exec(range); if (!m) return false; const r = semver(m[2]);
  const ge = v[0] > r[0] || (v[0] === r[0] && (v[1] > r[1] || (v[1] === r[1] && v[2] >= r[2])));
  if (m[1] === '>=') return ge; if (m[1] === '~') return ge && v[0] === r[0] && v[1] === r[1]; if (m[1] === '^') return ge && (r[0] ? v[0] === r[0] : v[1] === r[1]);
  return v.join('.') === r.join('.');
}
const confined = (p) => typeof p === 'string' && p && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '..');
const slash = (u) => (u.endsWith('/') ? u : u + '/');
const bare = (id) => String(id).replace(/^.*:/, '');

export function createPacks(opts = {}) {
  const base = opts.base || (typeof document !== 'undefined' ? document.baseURI : location.href);
  const doFetch = opts.fetch || ((u, o) => globalThis.fetch(u, o));
  const store = 'storage' in opts ? opts.storage : (() => { try { return globalThis.localStorage; } catch (e) { return null; } })();
  const CACHE = opts.cacheName || 'sc-packs-1', SHIPPED = opts.shippedLock || 'packs.lock.json', LS_LOCK = 'sc.packs.lock', LS_PREFER = 'sc.packs.prefer', LS_OFFLINE = 'sc.packs.offline', LS_TRUST = 'sc.packs.trust', LS_CODE = 'sc.packs.code';
  const search = 'search' in opts ? opts.search : (typeof location !== 'undefined' ? location.search : '');
  const sc = () => (globalThis.strudelCraft = globalThis.strudelCraft || {});
  const lsGet = (k, d) => { try { return JSON.parse(store.getItem(k)) ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or off */ } };

  const listeners = {}; const emit = (type, ev) => (listeners[type] || []).forEach((f) => { try { f(ev); } catch (e) { /* listener bug stays out of the loader */ } });
  const errors = [], warnings = [];
  const note = (arr, code, message, extra) => { if (!arr.some((x) => x.code === code && x.message === message)) arr.push({ code, message, ...extra }); };
  const err = (code, message, extra) => note(errors, code, message, extra), warn = (code, message, extra) => note(warnings, code, message, extra);

  const tracked = [];
  let layers = [], packs = new Map(), proposalList = [], dirty = true, cached = null, seq = 0;
  const hostCtx = { api: API, strudel: null };
  const ingQ = (p, i) => `${p.id}:${i.id}`;

  // ---------------------------------------------------------------- code ingredients: consent gate (docs/PACK_SPEC.md 10.3). Nothing runs unless every condition holds.
  const HASHRE = /^sha256:[0-9a-f]{64}$/;
  const codeEnabled = () => !!store && lsGet(LS_CODE, false) === true; // flag, default off
  const trustOf = (pid, iid) => (lsGet(LS_TRUST, {})[pid] || {})[iid] || null;
  const codeHashOf = (entry, ing) => sha(new TextEncoder().encode(JSON.stringify({ manifest: entry.manifest, entry: ing.hash, modules: ing.modules.map((m) => [m.path, m.hash]) })));
  function gate(pack, ing) { // null = may run in the sandbox; else { code, message } (the ingredient stays blocked)
    const ad = KINDS[ing.kind], granted = (pack.entry.allowCode || []).includes(ing.id);
    if (!granted) return { code: 'E_PACK_CODE_GRANT', message: 'needs a grant' };
    if (!ad.sandbox || ing.modules.some((m) => m.realm === 'main')) return { code: 'E_PACK_CODE_GRANT', message: ad.sandbox ? 'main-realm code is not run by this host yet (#69)' : 'this kind has no sandbox runner on this host yet' };
    if (!codeEnabled()) return { code: 'E_PACK_CODE_GRANT', message: 'code ingredients are switched off (feature flag)' };
    if (!pack.entry.manifest || !HASHRE.test(String(ing.hash)) || !ing.modules.length || ing.modules.some((m) => !HASHRE.test(String(m.hash)))) return { code: 'E_PACK_HASH', message: 'code is not hash-pinned; it is never run unverified' };
    const t = trustOf(pack.id, ing.id);
    if (!t) return { code: 'E_PACK_CODE_TRUST', message: 'not trusted: the trust dialog was not accepted for this code' };
    if (t.hash !== ing.codeHash) return { code: 'E_PACK_CODE_TRUST', message: 'the code changed since it was trusted (new hash); trust it again to run it' };
    return null;
  }

  // ---------------------------------------------------------------- bytes: cache-first for immutable roots, verified before they are cached
  const cachePromise = () => (typeof caches !== 'undefined' ? caches.open(CACHE).catch(() => null) : Promise.resolve(null));
  const inflight = new Map();
  async function fetchBytes(url, immutable) {
    if (immutable) { const c = await cachePromise(); const hit = c && await c.match(url); if (hit) return { bytes: new Uint8Array(await hit.arrayBuffer()), cached: true }; }
    const key = url; if (inflight.has(key)) return inflight.get(key);
    const p = (async () => { const res = await doFetch(url); if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { http: res.status }); return { bytes: new Uint8Array(await res.arrayBuffer()), cached: false }; })();
    inflight.set(key, p); try { return await p; } finally { inflight.delete(key); }
  }
  async function keep(url, bytes) { const c = await cachePromise(); if (c) await c.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {}); }
  // fetch one pack file, verify against `hash`, cache only after the hash matches. Tries every candidate base; the hash tree decides.
  async function getVerified(pack, rel, hash, cap = MAX_ENTRY) {
    let lastErr = null;
    for (const b of pack.bases) {
      const url = new URL(rel, b).href;
      try {
        let r = await fetchBytes(url, pack.immutable);
        if (r.bytes.length > cap) throw Object.assign(new Error(`${rel} is larger than ${cap} bytes`), { code: 'E_PACK_SIZE' });
        if (hash && (await sha(r.bytes)) !== hash) {
          if (r.cached) { try { r = await fetchBytes(url, false); } catch (e) { /* offline: the cached bytes stay, reported as a mismatch */ } } // cached bytes that do not match: re-read once from the network; a matching read replaces the entry
          const actual = await sha(r.bytes); if (actual !== hash) { lastErr = Object.assign(new Error(`${rel} does not match its hash`), { code: 'E_PACK_HASH', actual }); continue; }
        }
        if (pack.immutable && !r.cached) await keep(url, r.bytes);
        pack.base = b; return r.bytes;
      } catch (e) {
        if (e.code === 'E_PACK_SIZE') throw e;
        if (!lastErr || lastErr.code !== 'E_PACK_HASH') lastErr = Object.assign(e, { code: e.http ? 'E_PACK_UNAVAILABLE' : 'E_PACK_UNAVAILABLE', offline: !e.http });
      }
    }
    throw lastErr || Object.assign(new Error('no source for ' + pack.id), { code: 'E_PACK_SOURCE' });
  }

  // verify(ref, hash): public integrity check of a pinned reference through the same fetch+hash+cache path; loads and activates nothing (docs/PACK_SPEC.md 11.1)
  const verify = async (ref, hash) => { await ready; return coreVerify(ref, hash, {
    known: (id) => { const e = layers.flatMap((L) => L.packs).find((x) => x.id === id); return e ? { source: e.source, manifest: e.manifest, mirrors: e.mirrors } : null; },
    bases: (source, k) => (k?.mirrors || []).map((m) => new URL(slash(m), base).href),
    get: (bases, rel, hash, o) => getVerified({ id: 'verify', bases, immutable: !!o.cache, base: null }, rel, hash),
  }); };

  // ---------------------------------------------------------------- lock layers
  const sourceBases = (entry, layer) => {
    const out = (entry.mirrors || []).map((m) => new URL(slash(m), base).href), s = String(entry.source || '');
    if (pinnedBases(s)) out.push(...pinnedBases(s));
    else if (/^https:\/\/[^\s]+\/$/.test(s)) out.push(s);
    else if (s.startsWith('file:') && layer === 'shipped') out.push(new URL(slash(s.slice(5)), base).href); // the shim pack: same-origin, hash-pinned
    return out;
  };
  const tierOf = (entry, layer) => (/^file:/.test(entry.source || '') && layer !== 'shipped' ? 'local' : layer === 'shipped' ? (/^glyphcore\//.test(entry.id) ? 'core' : 'curated') : layer === 'session' ? 'local' : 'user');
  const readUser = () => { const l = lsGet(LS_LOCK, null); return l && Array.isArray(l.packs) ? l : { lock: 1, craftpack: API, packs: [] }; };
  const saveUser = (l) => { lsSet(LS_LOCK, l); emit('lock', { layer: 'user' }); };
  const effective = () => { const pref = lsGet(LS_PREFER, {}); return layers.map((L) => ({ name: L.name, packs: L.packs.map((e) => (pref[e.id] != null ? { ...e, priority: pref[e.id] } : e)) })); };

  // ---------------------------------------------------------------- pack and ingredient records
  async function loadPack(entry, layer) {
    const pack = { id: entry.id, version: entry.version, layer, entry, source: entry.source, tier: tierOf(entry, layer), seq: seq++, state: 'loading', errors: [], ingredients: new Map(), manifest: entry.manifest, man: null,
      bases: [], immutable: true, base: null, license: null, attribution: [], title: entry.id };
    packs.set(pack.id, pack); dirty = true;
    const fail = (code, message, state = 'failed') => { pack.state = state; pack.errors.push({ code, message }); err(code, message, { id: pack.id }); dirty = true; emit('state', { pack: pack.id }); return pack; };
    pack.bases = sourceBases(entry, layer);
    if (!pack.bases.length) return fail('E_PACK_SOURCE', `${entry.id}: source ${entry.source} cannot be fetched by this host (needs a mirror)`);
    pack.immutable = !(layer === 'shipped' && /^file:/.test(entry.source || '')); // the shim lives in the deploy and changes with it: shell caching, not the pack cache
    let bytes;
    try { bytes = await getVerified(pack, 'craftpack.json', entry.manifest, 1024 * 1024); } catch (e) { return fail(e.code || 'E_PACK_UNAVAILABLE', `${entry.id}: manifest: ${e.message}`, e.offline ? 'unavailable' : 'failed'); }
    let man; try { man = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return fail('E_PACK_SCHEMA', `${entry.id}: manifest is not JSON`); }
    pack.man = man;
    if (man.id !== entry.id) return fail('E_PACK_NAMESPACE', `${entry.id}: the manifest names ${man.id}`);
    const major = semver(man.craftpack)?.[0];
    if (major !== 1) return fail('E_PACK_SPEC', `${entry.id}: craftpack ${man.craftpack} is not supported (host reads 1.x)`);
    if (semver(man.craftpack)[1] > semver(API)[1]) warn('W_PACK_NEWER', `${entry.id}: craftpack ${man.craftpack} is newer than this host (${API})`, { id: pack.id });
    for (const k of ['version', 'license', 'ingredients']) if (man[k] == null || (k === 'ingredients' && (!Array.isArray(man[k]) || !man[k].length))) return fail('E_PACK_SCHEMA', `${entry.id}: manifest has no ${k}`);
    if (man.engines?.craft && !satisfies(man.engines.craft, API)) return fail('E_PACK_ENGINE', `${entry.id}: needs craft ${man.engines.craft}, this host is ${API}`, 'skipped');
    for (const [dep] of Object.entries(man.dependencies || {})) if (!layers.some((L) => L.packs.some((e) => e.id === dep))) return fail('E_PACK_DEP_MISSING', `${entry.id}: dependency ${dep} is not in the lock`, 'skipped');
    Object.assign(pack, { version: man.version, title: man.title || man.id, description: man.description, license: man.license, licenseFile: man.licenseFile, attribution: man.attribution || [], authors: man.authors || [], homepage: man.homepage, repository: man.repository });
    if (/^LicenseRef-/.test(man.license) && !man.licenseFile) warn('W_PACK_LICENSE', `${pack.id}: ${man.license} without licenseFile`, { id: pack.id });
    const ids = new Set(); let eagerBytes = 0;
    for (const raw of man.ingredients) {
      const ing = { id: raw.id, kind: raw.kind, format: raw.format, version: raw.version, path: raw.path, hash: raw.hash, bytes: raw.bytes, title: raw.title, description: raw.description, tags: raw.tags,
        license: raw.license || man.license, attribution: raw.attribution || null, redistribution: raw.redistribution, requires: raw.requires || [], code: raw.code === true, modules: raw.modules || [], assets: raw.assets || null,
        hosts: raw.hosts, load: raw.load || (raw.assets ? 'manual' : 'lazy'), state: 'listed', reason: null, data: null, dispose: null, promise: null, pack };
      pack.ingredients.set(ing.id, ing);
      const bad = (code, message, state = 'failed') => { ing.state = state; ing.reason = { code, message }; if (state === 'skipped') warn(code, `${ingQ(pack, ing)}: ${message}`, { id: pack.id }); else err(code, `${ingQ(pack, ing)}: ${message}`, { id: pack.id }); };
      if (ids.has(ing.id)) { bad('E_PACK_ID', 'duplicate ingredient id'); continue; } ids.add(ing.id);
      const ad = KINDS[ing.kind];
      if (!ad || !ad.formats.some((f) => f.split('@')[0] === String(ing.format).split('@')[0] && f.split('@')[1] === String(ing.format).split('@')[1]?.split('.')[0])) {
        if (/^x-/.test(ing.kind) && !ad) { ing.state = 'skipped'; ing.reason = { code: 'W_PACK_KIND', message: 'extension kind without an adapter' }; continue; } // silent
        bad('W_PACK_KIND', DEFERRED.has(ing.kind) ? `kind ${ing.kind} has no adapter on this host yet` : `unknown kind or format ${ing.kind} ${ing.format}`, 'skipped'); continue;
      }
      if (raw.hosts && !raw.hosts.includes('site')) { ing.state = 'skipped'; ing.reason = { code: 'W_PACK_KIND', message: 'not for this host' }; continue; }
      if (!confined(ing.path)) { bad('E_PACK_PATH', `path ${ing.path} leaves the pack root`); continue; }
      if (ing.modules.some((m) => !confined(m.path))) { bad('E_PACK_PATH', 'a module path leaves the pack root'); continue; }
      if (ing.modules.length && !ing.code) { bad('E_PACK_CODE_UNDECLARED', 'modules without code: true'); continue; }
      if (ad.code === 'never' && ing.code) { bad('E_PACK_SCHEMA', `kind ${ing.kind} is data only but is marked code`); continue; }
      if (ad.code === 'always' && !ing.code) { bad('E_PACK_CODE_UNDECLARED', `kind ${ing.kind} is code but is not marked code: true`); continue; }
      if (ing.modules.some((m) => m.realm === 'main') && !(pack.tier === 'core' || pack.tier === 'local')) { bad('E_PACK_CODE_REALM', 'main-realm code is refused outside the core and local tiers'); continue; }
      if (ing.bytes > MAX_ENTRY) { bad('E_PACK_SIZE', `entry file is ${ing.bytes} bytes (cap ${MAX_ENTRY})`); continue; }
      if (ing.code) { // flagged code: runs only through the gate (grant + trust for this code hash + flag + hash-verified), only in the sandbox host
        ing.codeHash = await codeHashOf(entry, ing);
        const g = gate(pack, ing); ing.granted = (entry.allowCode || []).includes(ing.id); ing.blockedReason = g ? g.message : null;
        if (ad.code === 'always' && g) { ing.state = 'blocked'; ing.reason = g; err(g.code, `${ingQ(pack, ing)}: ${g.message}`, { id: pack.id }); continue; }
      }
      if (ing.load === 'eager' && pack.tier !== 'core') { // budgets outside the shipped lock
        eagerBytes += ing.bytes || 0;
        if ((ing.bytes || 0) > EAGER_ITEM || eagerBytes > EAGER_PACK) { ing.load = 'lazy'; warn('W_PACK_EAGER', `${ingQ(pack, ing)}: eager budget exceeded, loaded lazily`, { id: pack.id }); }
      }
    }
    pack.state = 'ready'; dirty = true; emit('state', { pack: pack.id });
    return pack;
  }

  // ---------------------------------------------------------------- ingredients
  const ctxFor = (pack, ing) => ({
    pack: pack.id, ingredient: ing.id, id: (item) => `${pack.id}:${item}`, alias: (k) => aliasOf(pack.id, k),
    asset: (p) => (confined(p) ? new URL(p, pack.base).href : null),
    assetDir: (entryPath, _base) => slash(new URL(_base || '.', new URL(entryPath, pack.base)).href),
    wins: (kind, key) => { const e = report().resolution[kind]?.[key]; return !e || e.winner === `${pack.id}:${key}`; },
    track: (pr) => { tracked.push(Promise.resolve(pr).catch(() => {})); },
    samples: async (map, baseUrl) => { const s = await whenHas(() => (typeof globalThis.samples === 'function' ? globalThis.samples : null), 30000); if (s) await s(map, baseUrl); },
  });
  const setState = (ing, state, reason) => { ing.state = state; ing.reason = reason || null; dirty = true; emit('state', { pack: ing.pack.id, ingredient: ing.id, state }); };
  function loadIng(ing) {
    if (ing.promise) return ing.promise;
    if (['skipped', 'failed'].includes(ing.state) || (ing.state === 'blocked' && KINDS[ing.kind].code === 'always')) return (ing.promise = Promise.resolve(ing.state));
    ing.promise = (async () => {
      const pack = ing.pack, ad = KINDS[ing.kind];
      try {
        for (const r of ing.requires) { // same pack (bare) or a pack named in dependencies (author/pack:ingredient)
          const t = r.includes(':') ? packs.get(r.split(':')[0])?.ingredients.get(r.split(':')[1]) : pack.ingredients.get(r);
          if (!t) throw Object.assign(new Error(`requires ${r}, which is not available`), { code: 'E_PACK_DEP_MISSING' });
          const s = await loadIng(t); if (s === 'failed' || s === 'unavailable') throw Object.assign(new Error(`requires ${r}, which is ${s}`), { code: 'E_PACK_DEP_MISSING' });
        }
        setState(ing, 'loading');
        const bytes = await getVerified(pack, ing.path, ing.hash, MAX_ENTRY);
        let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw Object.assign(new Error('entry file is not JSON'), { code: 'E_PACK_SCHEMA' }); }
        const bad = data && typeof data === 'object' ? ad.check(data) : 'entry file must be an object';
        if (bad) throw Object.assign(new Error(bad), { code: 'E_PACK_SCHEMA' });
        ing.data = ad.prepare ? ad.prepare(data) : data; dirty = true;
        if (ad.apply) { const d = await ad.apply(ing, ing.data, ctxFor(pack, ing)); if (typeof d === 'function') ing.dispose = d; }
        if (ing.code && ad.sandbox && !gate(pack, ing)) { const d = await ad.sandbox(ing, ing.data, sandboxCtx(pack, ing, ing.data)); if (typeof d === 'function') ing.dispose = d; setState(ing, 'ready'); } // the module itself starts on first use, never here
        else if (ing.code) { ing.state = 'blocked'; ing.reason = { code: 'E_PACK_CODE_GRANT', message: ing.blockedReason }; err('E_PACK_CODE_GRANT', `${ingQ(pack, ing)}: ${ing.blockedReason} (data part loaded)`, { id: pack.id }); setState(ing, 'blocked', ing.reason); }
        else setState(ing, 'ready');
      } catch (e) {
        ing.data = null; dirty = true;
        const code = e.code || (e.offline ? 'E_PACK_UNAVAILABLE' : 'E_PACK_SCHEMA');
        const state = e.offline ? 'unavailable' : 'failed';
        err(code, `${ingQ(pack, ing)}: ${e.message}`, { id: pack.id }); setState(ing, state, { code, message: e.message });
        if (state === 'unavailable') ing.promise = null; // one attempt per online transition (see the online listener)
        return state;
      }
      return ing.state;
    })();
    return ing.promise;
  }
  // the sandbox for one ingredient: module bytes come from the verified buffer (read once, hash-checked, then handed over as data); started lazily by the first call
  function sandboxCtx(pack, ing, data) {
    let sb = null, starting = null, src = null; const mod = ing.modules.find((m) => m.path === data.module) || null;
    const dead = (e) => { if (['E_PACK_SANDBOX_TIMEOUT', 'E_PACK_SANDBOX_PROTOCOL'].includes(e.code) && ing.state === 'ready') { ing.sandboxFailed = true; err(e.code, `${ingQ(pack, ing)}: ${e.message}`, { id: pack.id }); setState(ing, 'failed', { code: e.code, message: e.message }); } };
    const ensure = () => {
      if (sb && sb.state === 'ready') return Promise.resolve(sb);
      return (starting ||= (async () => {
        const g = gate(pack, ing); if (g) throw Object.assign(new Error(g.message), { code: g.code }); // re-checked at every start: revoke or flag-off takes effect
        if (!mod) throw Object.assign(new Error(`module ${data.module} is not declared in modules`), { code: 'E_PACK_CODE_UNDECLARED' });
        if (src == null) src = new TextDecoder('utf-8', { fatal: true }).decode(await getVerified(pack, mod.path, mod.hash, 512 * 1024));
        const m = await import('./packs-sandbox.js'); const s = m.createSandbox({ source: src }); s.on((ev) => { if (ev.type === 'stopped') dead(ev); });
        await s.start(); sb = s; return s;
      })().finally(() => { starting = null; }));
    };
    return { ensure, call: async (method, input, o) => (await ensure()).call(method, input, o), stop: () => { if (sb) sb.stop(); sb = null; src = null; }, ready: () => !!sb && sb.state === 'ready' };
  }
  const dropErrors = (ing) => { for (let k = errors.length - 1; k >= 0; k--) if (/^E_PACK_(CODE|HASH|SANDBOX)/.test(errors[k].code) && errors[k].message.startsWith(ingQ(ing.pack, ing) + ':')) errors.splice(k, 1); };
  function regate(ing) { // grant / revoke / flag change: take effect now, in both directions
    const ad = KINDS[ing.kind]; if (!ing.code || !ad.sandbox) return; const g = gate(ing.pack, ing); ing.blockedReason = g ? g.message : null; ing.granted = (ing.pack.entry.allowCode || []).includes(ing.id);
    if (g && ing.state !== 'blocked') { try { ing.dispose && ing.dispose(); } catch (e) { /* adapter cleanup */ } ing.dispose = null; ing.promise = null; ing.data = null; ing.sandboxFailed = false; ing.state = 'blocked'; ing.reason = g; err(g.code, `${ingQ(ing.pack, ing)}: ${g.message}`, { id: ing.pack.id }); }
    else if (!g && (ing.state === 'blocked' || ing.sandboxFailed)) { dropErrors(ing); ing.promise = null; ing.sandboxFailed = false; ing.state = 'listed'; ing.reason = null; loadIng(ing); }
    else if (g) { ing.reason = g; }
    dirty = true; emit('state', { pack: ing.pack.id, ingredient: ing.id });
  }
  const findIng = (ref) => { const [p, i] = String(ref).includes(':') ? String(ref).split(':') : [null, String(ref)]; if (p) return packs.get(p)?.ingredients.get(i) || null; const all = [...packs.values()].flatMap((x) => [...x.ingredients.values()]).filter((x) => x.id === i); return all.length === 1 ? all[0] : null; };
  const allIngsAny = () => [...packs.values()].flatMap((p) => [...p.ingredients.values()]);
  const allIngs = () => [...packs.values()].filter((p) => p.state === 'ready').flatMap((p) => [...p.ingredients.values()]);

  // ---------------------------------------------------------------- resolution
  function orderedPacks() { const rank = (n) => { const i = LAYERS.indexOf(n); return i < 0 ? 9 : i; }; const pr = {}; for (const L of effective()) for (const e of L.packs) pr[e.id] = pr[e.id] ?? (e.priority ?? 0); return [...packs.values()].sort((a, b) => (pr[b.id] ?? 0) - (pr[a.id] ?? 0) || rank(a.layer) - rank(b.layer) || a.seq - b.seq); }
  function report() {
    if (!dirty && cached) return cached;
    const loaded = {};
    for (const p of packs.values()) loaded[p.id] = { version: p.version, ingredients: [...p.ingredients.values()].filter((i) => i.data && (i.state === 'ready' || i.state === 'blocked')).map((i) => ({ id: i.id, kind: i.kind, data: i.data })) };
    const core = coreResolve(effective(), loaded);
    cached = { errors: [...core.errors, ...errors], warnings: [...core.warnings, ...warnings], resolution: core.resolution }; dirty = false; return cached;
  }
  const valueOf = (kind, ing, item) => { const hit = KINDS[kind].items(ing.data).find(([k]) => k === item); return hit ? hit[1] : undefined; };
  function resolveRef(kind, ref) {
    ref = String(ref); const m = /^([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*):(.+)$/.exec(ref); let qid = null;
    if (m) qid = ref; else { const w = report().resolution[kind]?.[ref]; if (!w) return null; qid = w.winner; }
    const [pid, ...rest] = qid.split(':'); const item = rest.join(':'), pack = packs.get(pid); if (!pack || !KINDS[kind]) return null;
    for (const ing of pack.ingredients.values()) if (ing.kind === kind && ing.data) { const v = valueOf(kind, ing, item); if (v !== undefined) return { id: qid, pack: pid, ingredient: ing.id, value: v }; }
    return null;
  }
  function items(kind) {
    const res = report().resolution[kind] || {}, out = [];
    for (const [name, e] of Object.entries(res)) { const r = resolveRef(kind, e.winner); out.push({ name, id: e.winner, pack: e.winner.split(':')[0], ingredient: r?.ingredient, value: r?.value, shadowed: e.shadowed, ...(e.aliases ? { aliases: e.aliases } : {}) }); }
    return out;
  }

  // ---------------------------------------------------------------- pull views (the consumers of today's data/ files)
  async function get(kind, name) {
    const ad = KINDS[kind]; if (!ad) return null; await indexed; // manifests verified; a view never waits for unrelated eager ingredients
    const ings = orderedPacks().filter((p) => p.state === 'ready').flatMap((p) => [...p.ingredients.values()]).filter((i) => i.kind === kind && (!name || i.id === name) && !['skipped', 'failed'].includes(i.state));
    await Promise.all(ings.map(loadIng));
    return ad.view(ings.filter((i) => i.data).map((i) => ({ pack: i.pack.id, ingredient: i.id, data: i.data })), name);
  }
  const view = {
    catalog: () => get('recipes'), controlTypes: () => get('control-types'), syntax: () => get('syntax'), doc: (name) => get('docs', name),
    paramShapes: () => get('param-shapes'), editors: () => get('param-editors'), completions: () => get('intellisense'), words: () => get('x-glyphcore.words'),
  };

  // ---------------------------------------------------------------- public data API (for the pack sheet)
  const ingInfo = (i) => ({ id: i.id, qualified: ingQ(i.pack, i), kind: i.kind, format: i.format, version: i.version, title: i.title, description: i.description, tags: i.tags, state: i.state, reason: i.reason,
    code: i.code, granted: !!i.granted, trusted: !!(i.code && i.codeHash && (trustOf(i.pack.id, i.id) || {}).hash === i.codeHash), codeHash: i.codeHash || null, modules: i.modules.map((m) => ({ path: m.path, hash: m.hash, realm: m.realm || 'sandbox', bytes: m.bytes })), bytes: i.bytes, hash: i.hash, path: i.path, load: i.load, license: i.license, attribution: i.attribution, redistribution: i.redistribution,
    assets: i.assets ? { files: i.assets.files, bytes: i.assets.bytes } : null, requires: i.requires });
  const list = () => [...packs.values()].map((p) => ({ id: p.id, version: p.version, title: p.title, description: p.description, tier: p.tier, layer: p.layer, source: p.source, manifest: p.manifest, priority: effective().flatMap((L) => L.packs).find((e) => e.id === p.id)?.priority ?? 0,
    state: p.state, errors: p.errors.slice(), license: p.license, licenseFile: p.licenseFile, attribution: p.attribution, authors: p.authors, homepage: p.homepage, repository: p.repository,
    code: [...p.ingredients.values()].some((i) => i.code), offline: !!lsGet(LS_OFFLINE, {})[p.id], ingredients: [...p.ingredients.values()].map(ingInfo) }));
  const credits = () => list().filter((p) => p.state === 'ready').map((p) => ({ pack: p.id, title: p.title, version: p.version, license: p.license, licenseFile: p.licenseFile, authors: p.authors, attribution: p.attribution, homepage: p.homepage,
    ingredients: p.ingredients.filter((i) => i.attribution || i.license !== p.license).map((i) => ({ id: i.id, license: i.license, attribution: i.attribution, redistribution: i.redistribution })) }));

  // ---------------------------------------------------------------- lock editing: add / remove / prefer / grant
  const parseSource = (s) => /^(github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}(\/\S*)?|https:\/\/\S+\/)$/.test(s);
  async function peek(source, mirrors) { // fetch the manifest only (a proposal never fetches more)
    const entry = { id: '?', source, mirrors }; const pack = { id: source, bases: sourceBases(entry, 'user'), immutable: false, base: null };
    if (!parseSource(source)) throw Object.assign(new Error(`source ${source} is not a pinned github: or https:// folder`), { code: 'E_PACK_SOURCE' });
    const bytes = await getVerified(pack, 'craftpack.json', null, 1024 * 1024);
    const man = JSON.parse(new TextDecoder().decode(bytes));
    return { man, manifest: await sha(bytes), base: pack.base };
  }
  async function propose(source, o = {}) {
    const p = { source, mirrors: o.mirrors || [], state: 'loading', error: null, id: null };
    proposalList.push(p); emit('state', { proposal: source });
    try {
      const { man, manifest } = await peek(source, p.mirrors);
      const owner = /^github:([^/]+)\//.exec(source); if (owner && String(man.id).split('/')[0] !== owner[1].toLowerCase()) throw Object.assign(new Error(`${man.id} is outside the namespace of github owner ${owner[1]}`), { code: 'E_PACK_NAMESPACE' });
      Object.assign(p, { state: 'proposed', id: man.id, version: man.version, title: man.title || man.id, license: man.license, attribution: man.attribution || [], manifest,
        ingredients: (man.ingredients || []).map((i) => ({ id: i.id, kind: i.kind, bytes: i.bytes, code: i.code === true, load: i.load })), code: (man.ingredients || []).some((i) => i.code === true) });
    } catch (e) { Object.assign(p, { state: 'failed', error: { code: e.code || 'E_PACK_SCHEMA', message: e.message } }); }
    emit('state', { proposal: source }); return p;
  }
  async function accept(p, o = {}) { // the add dialog was accepted: pin the manifest hash the user saw. Never grants code (10.1).
    if (typeof p === 'string') p = proposalList.find((x) => x.source === p); if (!p || p.state !== 'proposed') return null;
    if ([...packs.keys()].includes(p.id)) { p.state = 'failed'; p.error = { code: 'E_PACK_NAMESPACE', message: `${p.id} is already in a lock layer` }; return p; }
    const entry = { id: p.id, version: p.version, source: p.source, manifest: p.manifest, ...(p.mirrors?.length ? { mirrors: p.mirrors } : {}), priority: 0, allowCode: [] };
    const layer = o.layer === 'session' ? 'session' : 'user';
    if (layer === 'user') { const l = readUser(); l.packs.push(entry); saveUser(l); }
    let L = layers.find((x) => x.name === layer); if (!L) layers.push((L = { name: layer, packs: [] })); L.packs.push(entry);
    p.state = 'accepted'; await loadPack(entry, layer); await applyEager(); emit('report', {}); return p;
  }
  async function add(source, o = {}) { const p = await propose(source, o); return p.state === 'proposed' ? accept(p, o) : p; }
  async function remove(id) {
    const pk = packs.get(id); if (!pk) return false;
    for (const i of pk.ingredients.values()) { try { i.dispose && i.dispose(); } catch (e) { /* adapter cleanup */ } }
    packs.delete(id); for (const L of layers) L.packs = L.packs.filter((e) => e.id !== id);
    const l = readUser(); l.packs = l.packs.filter((e) => e.id !== id); if (store) saveUser(l);
    { const t = lsGet(LS_TRUST, {}); if (t[id]) { delete t[id]; lsSet(LS_TRUST, t); } }
    dirty = true; await evict(); emit('report', {}); emit('state', { pack: id }); return true;
  }
  function prefer(id) { // "prefer this pack": priority 10 (9.3 rule 3); written into the user lock entry, or a user-side overlay for a shipped pack
    id = String(id).replace(/:.*$/, ''); const l = readUser(), e = l.packs.find((x) => x.id === id);
    if (e) { e.priority = 10; saveUser(l); const L = layers.find((x) => x.name === 'user'); const le = L && L.packs.find((x) => x.id === id); if (le) le.priority = 10; }
    else { const p = lsGet(LS_PREFER, {}); p[id] = 10; lsSet(LS_PREFER, p); emit('lock', { layer: 'user' }); }
    dirty = true; emit('report', {}); return true;
  }
  function grant(ref) { // the trust dialog was accepted: allowCode on the user lock entry + a trust record for this exact code hash. Only the dialog calls this.
    const ing = findIng(ref); if (!ing || !ing.code || !ing.codeHash) return false; const l = readUser(), e = l.packs.find((x) => x.id === ing.pack.id); if (!e) return false;
    e.allowCode = [...new Set([...(e.allowCode || []), ing.id])]; saveUser(l); ing.pack.entry.allowCode = e.allowCode;
    const t = lsGet(LS_TRUST, {}); (t[ing.pack.id] ||= {})[ing.id] = { hash: ing.codeHash, modules: Object.fromEntries(ing.modules.map((m) => [m.path, m.hash])), at: Date.now() }; lsSet(LS_TRUST, t);
    regate(ing); return true;
  }
  function revoke(ref) {
    const ing = findIng(ref); if (!ing) return false; const l = readUser(), e = l.packs.find((x) => x.id === ing.pack.id);
    if (e) { e.allowCode = (e.allowCode || []).filter((x) => x !== ing.id); saveUser(l); } ing.pack.entry.allowCode = (ing.pack.entry.allowCode || []).filter((x) => x !== ing.id);
    const t = lsGet(LS_TRUST, {}); if (t[ing.pack.id]) { delete t[ing.pack.id][ing.id]; lsSet(LS_TRUST, t); } regate(ing); return true;
  }
  const CAN = ['Run in an isolated frame with no network, no storage and no access to this page', 'Receive plain data for its kind (for example the text around the caret) and return plain data'];
  const CANNOT = ['Read or change this page, your recipes, history or settings', 'Fetch anything, store anything, open windows or navigate', 'Run for more than a fraction of a second or send large messages (it is stopped)'];
  function codeInfo(ref) { // what the trust dialog shows; `changed` lists module paths whose hash differs from the trusted version
    const ing = findIng(ref); if (!ing || !ing.code) return null; const p = ing.pack, t = trustOf(p.id, ing.id), was = (t && t.modules) || {};
    const changed = t ? ing.modules.filter((m) => was[m.path] !== m.hash).map((m) => m.path).concat(Object.keys(was).filter((k) => !ing.modules.some((m) => m.path === k))) : [];
    return { pack: p.id, ingredient: ing.id, qualified: ingQ(p, ing), authors: p.authors || [], license: p.license ?? null, manifest: p.manifest, hash: ing.codeHash, modules: ing.modules.map((m) => ({ path: m.path, hash: m.hash, bytes: m.bytes })),
      trusted: !!t && t.hash === ing.codeHash, hadTrust: !!t, changed, flag: codeEnabled(), can: CAN, cannot: CANNOT, sandboxed: !!KINDS[ing.kind].sandbox };
  }
  function setCodeEnabled(on) { lsSet(LS_CODE, !!on); for (const i of allIngsAny()) regate(i); emit('report', {}); return codeEnabled(); }
  const raw = async (ref) => { await indexed; const i = findIng(ref); if (!i || ['skipped', 'failed'].includes(i.state)) return null; await loadIng(i); return i.data || null; }; // an ingredient's whole parsed file (e.g. the lanes block no kind view carries)
  const describe = (ref) => { const i = findIng(ref); return i ? { ...ingInfo(i), pack: i.pack.id, manifest: i.pack.manifest, tier: i.pack.tier } : null; };

  // ---------------------------------------------------------------- cache housekeeping and offline
  async function evict() { // entries of packs in no lock layer are removed (9.5)
    const c = await cachePromise(); if (!c) return; const live = [...packs.values()].flatMap((p) => p.bases);
    for (const r of await c.keys()) if (!live.some((b) => r.url.startsWith(b)) && !r.url.includes('__sc_packs')) await c.delete(r);
  }
  async function offline(id, on = true) {
    const pk = packs.get(id); if (!pk) return false; const flags = lsGet(LS_OFFLINE, {});
    if (!on) { delete flags[id]; lsSet(LS_OFFLINE, flags); emit('state', { pack: id }); return true; }
    let done = 0, total = 0;
    for (const ing of pk.ingredients.values()) await loadIng(ing);
    for (const ing of pk.ingredients.values()) if (ing.assets) {
      const idxPath = `${ing.assets.root}/${ing.assets.index}`.replace(/^\.\//, '').replace(/^\.\//, '');
      let idx; try { idx = new TextDecoder().decode(await getVerified(pk, idxPath, ing.assets.hash)); } catch (e) { err(e.code || 'E_PACK_UNAVAILABLE', `${ingQ(pk, ing)}: asset index: ${e.message}`, { id }); continue; }
      const lines = idx.split('\n').filter(Boolean).map((l) => [l.slice(0, 64), l.slice(66)]); total += lines.length;
      for (const [h, rel] of lines) { try { await getVerified(pk, `${ing.assets.root}/${rel}`.replace(/^\.\//, ''), 'sha256:' + h, 64 * 1024 * 1024); } catch (e) { err(e.code || 'E_PACK_UNAVAILABLE', `${ingQ(pk, ing)}: ${rel}: ${e.message}`, { id }); } done++; emit('offline', { id, done, total }); }
    }
    flags[id] = { files: total, at: Date.now() }; lsSet(LS_OFFLINE, flags);
    try { navigator.storage && navigator.storage.persist && await navigator.storage.persist(); } catch (e) { /* the browser may refuse */ }
    emit('state', { pack: id }); return { files: total, done };
  }
  async function announce() { // tell the service worker which roots are pack URLs (never cached by the shell handler) and where asset indexes live
    try {
      const reg = navigator.serviceWorker && navigator.serviceWorker.controller; if (!reg) return;
      const roots = [...packs.values()].filter((p) => p.immutable && p.base).map((p) => ({ base: p.base, assets: [...p.ingredients.values()].filter((i) => i.assets).map((i) => ({ dir: new URL(slash(i.assets.root), p.base).href, index: new URL(`${i.assets.root}/${i.assets.index}`, p.base).href, hash: i.assets.hash })) }));
      await new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = ok; reg.postMessage({ type: 'sc-packs', roots }, [ch.port2]); setTimeout(ok, 1500); });
    } catch (e) { /* no service worker: the page cache alone still works */ }
  }

  // ---------------------------------------------------------------- boot
  async function applyEager() {
    const ings = orderedPacks().filter((p) => p.state === 'ready').flatMap((p) => [...p.ingredients.values()]).filter((i) => i.load === 'eager' && i.state === 'listed');
    await Promise.all(ings.map(loadIng)); await Promise.race([Promise.all(tracked.splice(0)), new Promise((ok) => setTimeout(ok, 3000))]); await announce(); dirty = true;
  }
  async function boot() {
    layers = [{ name: 'shipped', packs: [] }, { name: 'user', packs: [] }, { name: 'session', packs: [] }];
    try { const r = await doFetch(new URL(SHIPPED, base).href); if (r.ok) { const j = await r.json(); if (j && j.lock === 1 && Array.isArray(j.packs)) layers[0].packs = j.packs; else err('E_PACK_SCHEMA', `${SHIPPED} is not a lock`); } }
    catch (e) { /* offline with no cached lock: an empty shipped layer, the editor still works */ }
    layers[1].packs = store ? readUser().packs : [];
    if (opts.session) layers[2].packs = opts.session;
    const first = new Set(); const todo = [];
    for (const L of layers) { const inL = new Set(); for (const e of L.packs) { if (inL.has(e.id) || first.has(e.id)) { inL.add(e.id); continue; } inL.add(e.id); first.add(e.id); todo.push([e, L.name]); } }
    dirty = true; await Promise.all(todo.map(([e, l]) => loadPack(e, l))); indexedOk();
    for (const p of new URLSearchParams(search || '').getAll('pack')) proposalList.push({ source: p, mirrors: [], state: 'new', id: null }); // a link only proposes; nothing is fetched until peek()
    await applyEager(); emit('report', {});
  }
  let indexedOk; const indexed = new Promise((ok) => { indexedOk = ok; });
  const ready = Promise.resolve().then(boot).catch((e) => { err('E_PACK_SCHEMA', 'loader boot failed: ' + e.message); indexedOk(); });
  if (typeof window !== 'undefined') window.addEventListener('online', () => { for (const i of allIngs()) if (i.state === 'unavailable') { i.promise = null; i.state = 'listed'; } for (const p of packs.values()) if (p.state === 'unavailable') loadPack(p.entry, p.layer).then(applyEager); applyEager(); });

  return {
    api: API, ready, verify, list, credits, describe, resolve: resolveRef, items, report, get, raw, ...view, sanitize,
    load: async (ref) => { await ready; const i = findIng(ref); if (!i) return 'unknown'; return loadIng(i); },
    loadAll: async () => { await ready; await Promise.all(allIngs().map(loadIng)); return report(); },
    // a view's own retry (Syntax Retry button): failed or unavailable ingredients of `kind` are read again; failure(kind) names why they failed
    retry: async (kind) => { await ready; for (const i of allIngs()) if (i.kind === kind && ['failed', 'unavailable'].includes(i.state)) { i.promise = null; i.data = null; setState(i, 'listed'); } return get(kind); },
    failure: (kind) => { const i = allIngs().find((x) => x.kind === kind && ['failed', 'unavailable', 'blocked'].includes(x.state)); return i ? { ingredient: ingQ(i.pack, i), state: i.state, ...(i.reason || {}) } : null; },
    ensure: async (kind) => { await ready; await Promise.all(allIngs().filter((i) => i.kind === kind).map(loadIng)); return items(kind); },
    add, remove, prefer, grant, revoke, codeInfo, codeEnabled, setCodeEnabled, offline, propose, accept, proposals: () => proposalList.map((p) => ({ ...p })), peek: async (source) => { const p = proposalList.find((x) => x.source === source && x.state === 'new'); if (!p) return null; proposalList.splice(proposalList.indexOf(p), 1); return propose(source); },
    on: (type, fn) => { (listeners[type] ||= []).push(fn); return () => { listeners[type] = listeners[type].filter((f) => f !== fn); }; },
    registerKind: (def) => { KINDS[def.kind] = { code: 'never', check: () => null, items: () => [], view: () => [], ...def, formats: def.formats }; return () => { delete KINDS[def.kind]; }; },
    // vox banks (voxBank('<id>') in prelude/word.js asks here before its own table): bare pack name, pack name without `vox-`, or the qualified ingredient id
    banks: () => allIngs().filter((i) => i.kind === 'vox-bank' && i.pack.state === 'ready').map((i) => ({ name: i.pack.id.split('/')[1].replace(/^vox-/, ''), id: ingQ(i.pack, i), pack: i.pack.id, state: i.state })),
    hasBank: (n) => !!bankOf(n),
    activateBank: async (n) => { const i = bankOf(n); if (!i) throw new Error('no vox bank ' + n); await loadIng(i); if (i.state === 'unavailable' || i.state === 'failed') throw new Error(i.reason?.message || 'bank ' + i.state); return ingQ(i.pack, i); },
    // the shim pack's own entry path for a kind (controls.js loadBuiltinTypes in headless hosts)
    entryUrl: (kind, name) => { const i = allIngs().find((x) => x.kind === kind && (!name || x.id === name)); return i ? new URL(i.path, i.pack.base).href : null; },
  };
  function bankOf(n) { n = String(n); return allIngs().find((i) => i.kind === 'vox-bank' && i.pack.state === 'ready' && (ingQ(i.pack, i) === n || i.pack.id === n || i.pack.id.split('/')[1] === n || i.pack.id.split('/')[1].replace(/^vox-/, '') === n)) || null; }
}

if (typeof window !== 'undefined' && !window.__scPacksNoAuto) { const sc = (globalThis.strudelCraft = globalThis.strudelCraft || {}); sc.packs = createPacks(); }
