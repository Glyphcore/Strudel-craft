/* Offline cache: app shell network-first, pinned Strudel bundle and sample maps cache-first. */
const VERSION = 'sc-dev'; /* replaced with sc-<sha> by .github/workflows/pages.yml on every deploy */
const SHELL = ['./', 'index.html', 'style.css', 'ui.js', 'app.js', 'build.json', 'intellisense.js', 'hooks-intellisense.js', 'word-intellisense.js', 'model.js', 'library.js', 'library-store.js', 'vendor/acorn-8.19.0.mjs', 'inline.js', 'literals.js', 'refs.js', 'workspace.css', 'palette.js', 'workspace.js', 'transport-range.js', 'visuals.js', 'tracker.js', 'engine/index.js', 'engine/controls.js', 'engine/pads.js', 'engine/input.js', 'engine/time.js', 'engine/validate.js', 'engine/hooks.js', 'engine/bind.js', 'engine/settle.js', 'engine/atoms.js', 'engine/atoms-migrate.js', 'engine/atoms-consumers.js', 'atoms-site.js', 'data/atoms/types.json', 'data/atoms/positions.json', 'syntax.js', 'prelude/word.js', 'packs.js', 'packs-kinds.js', 'engine/packs-core.js', 'packs.lock.json', 'craftpack.json', 'history.js', 'capture.js', 'capture.css',
  'fonts/ChakraPetch-500.woff2', 'fonts/ChakraPetch-700.woff2', 'fonts/JetBrainsMono.woff2'];
/* The shim pack's content files are named by its manifest, not listed here (data-driven: they move with the packs in P4). */
const shimFiles = () => fetch('craftpack.json').then((r) => r.json()).then((m) => [...new Set(m.ingredients.map((i) => i.path))]).catch(() => []);
self.addEventListener('install', (e) => { e.waitUntil(Promise.all([caches.open(VERSION), shimFiles()]).then(([c, files]) => c.addAll([...SHELL, ...files]))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && !k.startsWith('sc-packs-')).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
/* ---- packs (docs/PACK_SPEC.md 9.5): cache `sc-packs-1` survives deploys. The page registers pack roots here; a request under a root is served
   cache-first, never copied into the shell cache, and asset files (audio) are hash-checked against the verified asset index before they are cached. ---- */
const PACKS = 'sc-packs-1', ROOTS = 'https://sc.invalid/__sc_packs_roots';
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const packRoots = () => caches.open(PACKS).then((c) => c.match(ROOTS)).then((r) => (r ? r.json() : [])).catch(() => []);
async function assetHash(root, a, url) {
  const c = await caches.open(PACKS); let idx = await c.match(a.index);
  if (!idx) { const r = await fetch(a.index); if (!r.ok) return null; const b = await r.arrayBuffer(); if ('sha256:' + hex(await crypto.subtle.digest('SHA-256', b)) !== a.hash) return null; await c.put(a.index, new Response(b)); idx = await c.match(a.index); }
  const rel = url.slice(a.dir.length), line = (await idx.text()).split('\n').find((l) => l.slice(66) === rel); return line ? 'sha256:' + line.slice(0, 64) : null;
}
async function packFetch(req, root) {
  const c = await caches.open(PACKS), hit = await c.match(req); if (hit) return hit;
  const res = await fetch(req); if (!res.ok) return res;
  const a = root.assets.find((x) => req.url.startsWith(x.dir) && req.url !== x.index);
  if (!a) return res; /* manifest and entry files are verified and cached by the page loader, not here */
  const want = await assetHash(root, a, req.url), buf = await res.clone().arrayBuffer();
  if (!want || 'sha256:' + hex(await crypto.subtle.digest('SHA-256', buf)) !== want) return new Response('E_PACK_HASH', { status: 502, statusText: 'E_PACK_HASH' });
  await c.put(req, new Response(buf, { headers: res.headers })); return res;
}
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'sc-packs') { rootsMem = e.data.roots; e.waitUntil(caches.open(PACKS).then((c) => c.put(ROOTS, new Response(JSON.stringify(e.data.roots)))).then(() => e.ports[0] && e.ports[0].postMessage('ok'))); }
});
let rootsMem = null; const rootsReady = packRoots().then((r) => { rootsMem = r; });
function shellFetch(req, url) { /* Promise<Response>, or null = leave the request to the browser */
  const pinned = url.hostname === 'unpkg.com' && url.pathname.includes('@strudel/web@1.3.0');
  const cdnModule = url.hostname === 'esm.sh'; /* pinned CodeMirror / jsdiff modules: cache-first so the editor works offline */
  const samplesMap = url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('.json');
  if (pinned || samplesMap || cdnModule) return caches.open(VERSION).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; });
  if (url.origin !== self.location.origin) return null;
  return fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const go = () => { const root = (rootsMem || []).find((r) => req.url.startsWith(r.base)); return root ? packFetch(req, root) : shellFetch(req, url); };
  if (rootsMem === null) { e.respondWith(rootsReady.then(() => go() || fetch(req))); return; } /* service worker just woke up: roots are still loading */
  const p = go(); if (p) e.respondWith(p);
});
