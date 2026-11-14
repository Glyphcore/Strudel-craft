/* Recipes: a take is a versioned "capture state" that can regenerate its audio from scratch (schemas/recipe.v1.json, docs/CAPTURE.md).
   This module builds, validates, stores, verifies and trusts recipes. It never evaluates program text: capture.js runs a recipe only on
   Remake, after the user approved its listed dependencies.
   Forward only: one schema version (1). Unknown or older versions are rejected; there are no legacy readers. */
const sc = (window.strudelCraft = window.strudelCraft || {});
export const FORMAT = 'strudel-craft/recipe';
export const VERSION = 1;
export const STRUDEL = { url: 'https://unpkg.com/@strudel/web@1.3.0/dist/index.js', name: '@strudel/web', version: '1.3.0' };
export const SUPERDOUGH = { name: 'superdough', version: '1.3.0', bundledIn: '@strudel/web@1.3.0' };
/* sample maps the site loads by branch; a recipe pins them to the commit they resolved to */
const SAMPLE_MAPS = [
  { bank: 'tidal-drum-machines', owner: 'felixroos', repo: 'dough-samples', ref: 'main', path: 'tidal-drum-machines.json' },
  { bank: 'dirt-samples', owner: 'tidalcycles', repo: 'dirt-samples', ref: 'main', path: 'strudel.json' },
];
/* known origins: anything else needs an explicit trust grant (modal, remembered per id + sha in sc.trust) */
const KNOWN = [/^https:\/\/unpkg\.com\/@strudel\/web@1\.3\.0\//, /^https:\/\/raw\.githubusercontent\.com\/(felixroos\/dough-samples|tidalcycles\/dirt-samples|Glyphcore\/Strudel-craft)\//i, /^file:/];
const HEX40 = /^[0-9a-f]{40}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;

/* ---------- hashing ---------- */
export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/* audio hash: interleaved little-endian float32 L,R of exactly `frames` frames */
export async function audioHash(L, R) {
  const n = L.length, buf = new Float32Array(n * 2); for (let i = 0; i < n; i++) { buf[2 * i] = L[i]; buf[2 * i + 1] = R[i]; }
  return sha256(new Uint8Array(buf.buffer));
}
async function fetchBytes(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return new Uint8Array(await r.arrayBuffer()); }

/* ---------- dependencies ---------- */
let strudelHash = null;
const pinnedCache = new Map();
async function resolveCommit(owner, repo, ref) {
  const k = `sc.pin.${owner}/${repo}@${ref}`; const hit = pinnedCache.get(k) || (() => { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } })();
  if (hit) return hit;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.sha' } });
  if (!r.ok) throw new Error(`cannot resolve ${owner}/${repo}@${ref} to a commit (HTTP ${r.status})`);
  const sha = (await r.text()).trim(); if (!HEX40.test(sha)) throw new Error(`${owner}/${repo}@${ref} did not resolve to a commit`);
  pinnedCache.set(k, sha); try { sessionStorage.setItem(k, JSON.stringify(sha)); } catch (e) { /* private */ } return sha;
}
const rawUrl = (owner, repo, sha, path) => `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
function packManifestUrl(source) {
  if (/^file:/.test(source)) { const p = source.replace(/^file:/, '').replace(/^\.?\/?/, '').replace(/\/?$/, '/'); return new URL((p === '/' ? '' : p) + 'craftpack.json', document.baseURI).href; }
  const m = /^github:([^/]+)\/([^@/]+)@([^/]+)(\/.*)?$/.exec(source);
  if (m) { if (!HEX40.test(m[3])) throw Object.assign(new Error(`floating ref ${source}: packs must be pinned to a 40-hex commit`), { ref: source }); return rawUrl(m[1], m[2], m[3], ((m[4] || '').replace(/^\//, '').replace(/\/?$/, '/') + 'craftpack.json').replace(/^\//, '')); }
  if (/^https:\/\//.test(source)) return source.replace(/\/?$/, '/') + 'craftpack.json';
  throw Object.assign(new Error(`unsupported pack source ${source}`), { ref: source });
}
function usesSamples(code) { return /\.bank\(|\bs(ound)?\(\s*["'`][^"'`]*\b(bd|sd|hh|oh|cp|rim|lt|mt|ht|cr|rd|casio|jazz|metal|east|crow|insect|wind|piano|gm_)/.test(code) || /samples\(/.test(code); }
function usesVox(code) { return /\bword\(|voxBank\(|["'`]v(ox|s)_/.test(code); }
/* exact external dependencies of a program: Strudel + superdough versions with the bundle hash, site build, packs (lock entries with
   ingredient hashes), sample maps pinned to the commit they resolve to, vox banks by id + content hash */
export async function collectDeps(code = '') {
  const deps = { strudel: { ...STRUDEL, sha256: null }, superdough: { ...SUPERDOUGH }, site: { build: 'dev', date: '' }, packs: [], samples: [], vox: [] };
  try { if (!strudelHash) strudelHash = sha256(await fetchBytes(STRUDEL.url)); deps.strudel.sha256 = await strudelHash; } catch (e) { strudelHash = null; deps.strudel.error = e.message; }
  try { const b = await (await fetch('build.json', { cache: 'no-store' })).json(); deps.site = { build: b.sha, date: b.date || '' }; } catch (e) { /* offline */ }
  if (sc.packs && sc.packs.list) {
    try { await sc.packs.ready; } catch (e) { /* report below */ }
    for (const p of sc.packs.list().filter((x) => x.state === 'ready')) {
      const e = { id: p.id, version: p.version, source: p.source, manifest: p.manifest, tier: p.tier, ingredients: [] };
      /* ingredient hashes come from the manifest the loader pinned: the bytes must hash to the lock's manifest hash before they are read */
      try { const bytes = await fetchBytes(packManifestUrl(p.source)); if ((await sha256(bytes)) !== p.manifest) throw new Error('manifest bytes do not match the lock hash'); const man = JSON.parse(new TextDecoder().decode(bytes)); e.ingredients = (man.ingredients || []).map((i) => ({ id: i.id, kind: i.kind, hash: i.hash || null, code: !!i.code })); } catch (err) { e.error = err.message; }
      deps.packs.push(e);
    }
  }
  if (usesSamples(code)) for (const m of SAMPLE_MAPS) {
    try { const sha = await resolveCommit(m.owner, m.repo, m.ref); const url = rawUrl(m.owner, m.repo, sha, m.path); deps.samples.push({ bank: m.bank, source: `github:${m.owner}/${m.repo}@${sha}/${m.path}`, url, sha256: await sha256(await fetchBytes(url)) }); }
    catch (e) { deps.samples.push({ bank: m.bank, source: `github:${m.owner}/${m.repo}@${m.ref}/${m.path}`, error: e.message }); }
  }
  if (usesVox(code) && window.voxBank && window.voxBank.list) for (const b of window.voxBank.list().filter((x) => x.active)) {
    try { const url = new URL(b.url, location.href).href; deps.vox.push({ bank: b.name, url, sha256: await sha256(await fetchBytes(url)) }); } catch (e) { deps.vox.push({ bank: b.name, error: e.message }); }
  }
  return deps;
}

/* ---------- validation (mirrors schemas/recipe.v1.json; forward only) ---------- */
export function validate(r) {
  const bad = (m) => { throw Object.assign(new Error(m), { code: 'E_RECIPE' }); };
  if (!r || typeof r !== 'object') bad('Not a recipe: expected a JSON object');
  if (r.format !== FORMAT) bad(`Not a Strudel Craft recipe (format "${r.format}", expected "${FORMAT}")`);
  if (r.version !== VERSION) bad(`Recipe version ${JSON.stringify(r.version)} is not supported: this site reads version ${VERSION} only (no older or newer formats)`);
  for (const k of ['id', 'name', 'created']) if (typeof r[k] !== 'string' || !r[k]) bad(`Recipe needs a ${k}`);
  const t = r.timing; if (!t || !(t.cps > 0) || typeof t.start !== 'number' || typeof t.stop !== 'number' || !(t.stop > t.start)) bad('Recipe timing needs cps > 0 and start < stop (cycles)');
  if (!r.includes || typeof r.includes !== 'object') bad('Recipe needs includes {audio, events, code}');
  if (!r.random || !Number.isInteger(r.random.seed)) bad('Recipe needs random.seed (integer)');
  if (r.includes.code && (!r.state || typeof r.state.source?.code !== 'string')) bad('Recipe says it includes code-state but has no state.source.code');
  const d = r.deps; if (!d || !d.strudel || !d.site || !Array.isArray(d.packs) || !Array.isArray(d.samples) || !Array.isArray(d.vox)) bad('Recipe needs deps {strudel, superdough, site, packs, samples, vox}');
  for (const p of d.packs) { if (!SHA.test(p.manifest || '')) bad(`Pack ${p.id}: manifest must be a sha256 hash`); if (/^(github|git\+)/.test(p.source) && !/@[0-9a-f]{40}(\/|$)/.test(p.source)) bad(`Pack ${p.id}: floating ref ${p.source} (pin a 40-hex commit)`); }
  for (const s of d.samples) { if (!/^github:[^@]+@[0-9a-f]{40}\//.test(s.source || '')) bad(`Sample bank ${s.bank}: floating ref ${s.source} (pin a 40-hex commit)`); if (!SHA.test(s.sha256 || '')) bad(`Sample bank ${s.bank}: needs a sha256 content hash`); }
  for (const v of d.vox) if (!SHA.test(v.sha256 || '')) bad(`Vox bank ${v.bank}: needs a sha256 content hash`);
  if (d.strudel.sha256 != null && !SHA.test(d.strudel.sha256)) bad('deps.strudel.sha256 must be a sha256 hash');
  for (const [k, o] of Object.entries(r.outputs || {})) if (o && !SHA.test(o.sha256 || '')) bad(`Output ${k} needs a sha256 hash`);
  return r;
}

/* ---------- trust + verification ---------- */
const trustKey = 'sc.trust';
const grants = () => { try { return JSON.parse(localStorage.getItem(trustKey)) || {}; } catch (e) { return {}; } };
export const trusted = (id, sha) => !!grants()[id + '@' + sha];
export function grant(id, sha) { const g = grants(); g[id + '@' + sha] = new Date().toISOString(); try { localStorage.setItem(trustKey, JSON.stringify(g)); } catch (e) { /* private */ } }
const known = (url) => KNOWN.some((re) => re.test(url)) || (url.startsWith(location.origin + '/'));
/* list every external ref of a recipe as {kind, id, ref, url, sha, known, code} */
export function refsOf(r) {
  const d = r.deps, out = [];
  out.push({ kind: 'strudel', id: `${d.strudel.name}@${d.strudel.version}`, ref: d.strudel.url, url: d.strudel.url, sha: d.strudel.sha256, known: known(d.strudel.url) });
  for (const p of d.packs) { let url = null; try { url = packManifestUrl(p.source); } catch (e) { /* refused in verify */ } out.push({ kind: 'pack', id: p.id, ref: p.source, url, sha: p.manifest, known: !!url && (p.tier === 'core' || p.tier === 'curated' || known(url)), code: p.ingredients.filter((i) => i.code).map((i) => i.id) }); }
  for (const s of d.samples) out.push({ kind: 'samples', id: s.bank, ref: s.source, url: s.url, sha: s.sha256, known: known(s.url || '') });
  for (const v of d.vox) out.push({ kind: 'vox', id: v.bank, ref: v.url, url: v.url, sha: v.sha256, known: known(v.url || '') });
  return out;
}
/* packs: one verification path, the pack loader's. A commit-pinned source goes through packs.verify(ref, hash) (same fetch, hash and
   cache path as loading; nothing is loaded). A shipped same-origin source (file:) is not commit-pinned, so packs.verify refuses it by
   design; it is checked against the loader's own state, whose manifest bytes were verified against the shipped lock on load. */
async function verifyPack(p) {
  const P = sc.packs; if (!P || !P.verify) return { ok: false, error: 'the pack loader is not available' };
  try { await P.ready; } catch (e) { /* state below */ }
  if (/^file:/.test(p.source)) {
    const live = P.list().find((x) => x.id === p.id);
    if (!live || live.state !== 'ready') return { ok: false, error: `pack ${p.id} is not loaded here` };
    if (live.source !== p.source) return { ok: false, have: live.manifest, error: `pack ${p.id} is loaded from ${live.source}, the recipe pins ${p.source}` };
    return { ok: live.manifest === p.manifest, have: live.manifest, via: 'loader (shipped lock)' };
  }
  const v = await P.verify(`${p.id}@${p.source}`, p.manifest);
  return v.ok ? { ok: true, have: p.manifest, via: 'packs.verify' } : { ok: false, have: v.actual || null, error: `${v.code}: ${v.message}`, via: 'packs.verify' };
}
/* fetch each pinned ref and compare its content hash; returns {ok, refs:[{...ref, have, ok, error}], notes:[]} */
export async function verify(r) {
  const res = []; const notes = [];
  for (const ref of refsOf(r)) {
    if (ref.kind === 'pack') { res.push({ ...ref, ...(await verifyPack(r.deps.packs.find((p) => p.id === ref.id))) }); continue; }
    if (!ref.sha) { res.push({ ...ref, ok: false, error: 'no content hash recorded' }); continue; }
    if (!ref.url) { res.push({ ...ref, ok: false, error: 'unsupported or floating ref' }); continue; }
    try { const bytes = await fetchBytes(ref.url); const have = await sha256(bytes); res.push({ ...ref, have, ok: have === ref.sha, bytes: ref.kind === 'samples' || ref.kind === 'vox' ? bytes : undefined }); }
    catch (e) { res.push({ ...ref, ok: false, error: e.message }); }
  }
  for (const p of r.deps.packs) {
    const live = sc.packs && sc.packs.list ? sc.packs.list().find((x) => x.id === p.id) : null;
    if (!live) notes.push(`Pack ${p.id} is not loaded here; its data ingredients are not available to the program.`);
    else if (live.manifest !== p.manifest) notes.push(`Pack ${p.id} loaded here has manifest ${live.manifest.slice(0, 19)}…, the recipe pins ${p.manifest.slice(0, 19)}…`);
  }
  return { ok: res.every((x) => x.ok), refs: res, notes };
}

/* ---------- store: IndexedDB "sc-recipes" (record = {id, recipe, audio: {capture?: {L, R, sr}, render?: {L, R, sr}}}) ---------- */
const DB = new Promise((res) => {
  try { const rq = indexedDB.open('sc-recipes', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('recipes', { keyPath: 'id' }); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (e) { res(null); }
});
const mem = new Map();
function tx(mode, fn) { return DB.then((db) => { if (!db) return fn(null); return new Promise((ok, no) => { const t = db.transaction('recipes', mode); const r = fn(t.objectStore('recipes')); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); t.onabort = () => no(t.error || new Error('storage full')); }); }); }
export const store = {
  async put(rec) { if (await DB) await tx('readwrite', (s) => s.put(rec)); else mem.set(rec.id, rec); return rec; },
  async get(id) { return (await DB) ? tx('readonly', (s) => s.get(id)) : mem.get(id); },
  async remove(id) { if (await DB) await tx('readwrite', (s) => s.delete(id)); else mem.delete(id); },
  async list() { const all = (await DB) ? await tx('readonly', (s) => s.getAll()) : [...mem.values()]; return (all || []).sort((a, b) => (a.recipe.created < b.recipe.created ? 1 : -1)); },
};
/* forward only: the pre-recipe take store and its settings are deleted once, but never silently. When old data exists a site modal
   offers "Download backup (JSON) and clear" or, under "Other options", "Clear" or "Keep for now" (nothing is deleted; asked again next load).
   The backup is a raw dump (no legacy reader): every store of IndexedDB `sc-capture` plus the `sc.capture.*` settings, typed arrays and blobs as base64. */
async function legacyDump() {
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const enc = async (v) => {
    if (v instanceof Blob) return { $blob: v.type, base64: b64(new Uint8Array(await v.arrayBuffer())) };
    if (v instanceof ArrayBuffer) return { $type: 'ArrayBuffer', base64: b64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { $type: v.constructor.name, base64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (Array.isArray(v)) return Promise.all(v.map(enc));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await enc(v[k]); return o; }
    return v;
  };
  const settings = {}; for (const k of Object.keys(localStorage)) if (k.startsWith('sc.capture.')) settings[k] = localStorage.getItem(k);
  const stores = {};
  try {
    const db = await new Promise((ok, no) => { const q = indexedDB.open('sc-capture'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); q.onblocked = () => no(new Error('blocked')); });
    for (const name of [...db.objectStoreNames]) stores[name] = await enc(await new Promise((ok, no) => { const r = db.transaction(name, 'readonly').objectStore(name).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
    db.close();
  } catch (e) { stores.error = String(e && e.message || e); }
  return { format: 'strudel-craft/legacy-takes-backup', note: 'Raw dump of the pre-recipe take store. Not importable; kept so nothing is lost.', created: new Date().toISOString(), settings, stores };
}
export async function pruneLegacy({ notify, ask, askFirst, saveBlob } = {}) {
  if (localStorage.getItem('sc.record.schema') === String(VERSION)) return false;
  let had = Object.keys(localStorage).some((k) => k.startsWith('sc.capture.'));
  try { if (indexedDB.databases) had = had || (await indexedDB.databases()).some((d) => d.name === 'sc-capture'); } catch (e) { /* unsupported */ }
  if (had) {
    if (!ask) return false; /* no modal available: never delete unasked */
    let backup = await (askFirst || ask)({ title: 'Old takes will be removed', message: 'Takes are now recipes, and the old take store cannot be converted. Download a JSON backup of the old takes and settings before they are cleared?', okText: 'Download backup (JSON) and clear', cancelText: 'Other options', notice: 'Old takes found' });
    if (!backup) {
      const clear = await ask({ title: 'Clear old takes without a backup?', message: 'The old audio takes and their settings are deleted from this device and cannot be recovered. "Keep for now" deletes nothing and asks again next time.', okText: 'Clear', cancelText: 'Keep for now', danger: true });
      if (!clear) return false;
    }
    if (backup) {
      try { const d = await legacyDump(); await saveBlob(new Blob([JSON.stringify(d)], { type: 'application/json' }), 'strudel-craft-old-takes-backup.json'); }
      catch (e) { if (notify) notify('Backup failed, old takes were kept: ' + (e.message || e)); return false; }
    }
  }
  await new Promise((r) => { try { const q = indexedDB.deleteDatabase('sc-capture'); q.onsuccess = q.onerror = q.onblocked = () => r(); } catch (e) { r(); } });
  for (const k of Object.keys(localStorage)) if (k.startsWith('sc.capture.')) localStorage.removeItem(k);
  localStorage.setItem('sc.record.schema', String(VERSION));
  if (had && notify) notify('Recorder updated: takes are now recipes. Old takes and their format were removed.');
  return had;
}
sc.recipe = { FORMAT, VERSION, sha256, audioHash, collectDeps, validate, refsOf, verify, trusted, grant, store };
