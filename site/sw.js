/* Offline cache: app shell network-first, pinned Strudel bundle and sample maps cache-first. */
const VERSION = 'sc-dev'; /* replaced with sc-<sha> by .github/workflows/pages.yml on every deploy */
const SHELL = ['./', 'index.html', 'style.css', 'ui.js', 'app.js', 'build.json', 'intellisense.js', 'inline.js', 'history.js', 'data/intellisense/strudel.json', 'data/catalog.json', 'data/plugins.json', 'data/practices.json',
  'fonts/ChakraPetch-500.woff2', 'fonts/ChakraPetch-700.woff2', 'fonts/JetBrainsMono.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const pinned = url.hostname === 'unpkg.com' && url.pathname.includes('@strudel/web@1.3.0');
  const samplesMap = url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('.json');
  if (pinned || samplesMap) {
    e.respondWith(caches.open(VERSION).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
