/* Sound loading notice (#183, critic defect 3). Referenced sample packs (glyphcore/vsco, glyphcore/drumkits, vcsl ...) fetch their files the first
   time a note needs them; an orchestral recipe pulls 10 to 20 MB and sounds nothing for seconds. Strudel's sampler (superdough, unmodified)
   fetches each sample with the global fetch at play time, so this module counts the audio fetches in flight and tells the user:
     - one toast, shown only if a batch of audio fetches is still running after GRACE ms (a warm cache answers sooner: no notice; superdough drops a note
       whose file is not there within its ~0.1 s lookahead, so a slower fetch means notes are being skipped),
       updated in place: which sources, files done of total, megabytes;
     - when the batch ends: "Sounds ready" (short), or an error toast naming the source when files failed, saying so plainly when offline.
   Toasts live in the top layer (ui.js popover), so nothing in the page moves. API: window.strudelCraft.soundLoad = { state() } (tests). */
const sc = (window.strudelCraft = window.strudelCraft || {});
const AUDIO = /\.(wav|flac|mp3|ogg|oga|m4a|aac|opus|aif|aiff)(?:[?#]|$)/i, GRACE = 120, SETTLE = 500;
const orig = window.fetch.bind(window);
let srcs = [], failEl = null, readyEl = null, readyT = 0, b = null, toastEl = null, shown = 0, lastBatch = null;
const toast = (m, o) => { try { return sc.ui && sc.ui.toast(m, o); } catch (e) { return null; } };
const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';

/* a readable source name for a file URL: the sample-source pack entry whose base or index host it falls under, else owner/repo or the host */
function labelOf(url) {
  let u; try { u = new URL(url, location.href); } catch (e) { return 'sounds'; }
  for (const x of srcs) if (x && typeof x.base === 'string' && u.href.startsWith(x.base)) return x.title || x.id;
  if (u.origin === location.origin) return 'pack sounds';
  const seg = u.pathname.split('/').filter(Boolean);
  return u.hostname === 'raw.githubusercontent.com' && seg.length > 1 ? decodeURIComponent(seg[1]) : u.hostname;
}
const names = (set) => { const a = [...set]; return a.length <= 2 ? a.join(' and ') : `${a.slice(0, 2).join(', ')} and ${a.length - 2} more`; };
const refresh = () => { try { const P = sc.packs; if (P && P.get) P.get('sample-source').then((v) => { if (Array.isArray(v)) { srcs = v; paint(); } }, () => {}); } catch (e) { /* no packs on this host */ } };
const labels = (urls) => new Set(urls.map(labelOf));
function text() { return `Loading sounds: ${names(labels(b.urls))}. ${b.done} of ${b.total} files, ${mb(b.bytes)}. Notes whose file is not here yet are skipped this time round.`; }
function paint() {
  if (!b || !b.visible) return;
  if ((!toastEl || !toastEl.isConnected) && readyEl && readyEl.isConnected) { clearTimeout(readyT); toastEl = readyEl; readyEl = null; toastEl.dataset.soundLoad = 'loading'; } // one load toast at a time: a new batch takes over the ready toast instead of stacking
  if (!toastEl || !toastEl.isConnected) { toastEl = toast(text(), { kind: 'info', sticky: true }); if (toastEl) { toastEl.dataset.soundLoad = 'loading'; toastEl.style.fontVariantNumeric = 'tabular-nums'; const sp = toastEl.querySelector('span'); if (sp) sp.style.cssText = 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;height:4.2em;line-height:1.4'; } shown++; return; } // a fixed three-line text box: updates and the ready line never change the toast's height, so the toast stack never moves
  const s = toastEl.querySelector('span, .toast-act'); if (s) s.textContent = text();
}
const kill = (t) => { const x = t && t.querySelector('.toast-x'); if (x) x.click(); };
function finish() {
  const x = b; b = null; if (!x) return; clearTimeout(x.grace);
  x.ms = Math.round(performance.now() - x.t0); lastBatch = { total: x.total, done: x.done, failed: x.failed.length, bytes: x.bytes, ms: x.ms, visible: x.visible, labels: [...labels(x.urls)] };
  const loading = toastEl; toastEl = null;
  if (x.failed.length) {
    kill(loading); const where = names(new Set(x.failed.map((f) => labelOf(f.url)))), n = x.failed.length, files = n === 1 ? '1 sound file' : n + ' sound files';
    const msg = navigator.onLine === false || x.failed.every((f) => f.offline)
      ? `Offline: ${files} of ${where} ${n === 1 ? 'is' : 'are'} not on this device yet. Those notes stay silent until you are back online.`
      : `Could not load ${files} of ${where} (${[...new Set(x.failed.map((f) => f.why))].join(', ')}). Those notes stay silent; press Play again to retry.`;
    if (failEl && failEl.isConnected) { const sp = failEl.querySelector('span'); if (sp) sp.textContent = msg; return; } // one error toast at a time: later batches update it, never stack
    failEl = toast(msg, { kind: 'error' }); if (failEl) failEl.dataset.soundLoad = 'failed'; return;
  }
  if (!x.visible) return; // a warm cache: nothing was shown, nothing to clear
  const s = loading && loading.querySelector('span, .toast-act');
  if (s) { s.textContent = `Sounds ready: ${x.done} files, ${mb(x.bytes)}. Notes skipped while loading play the next time they come round.`; loading.dataset.soundLoad = 'ready'; if (readyEl && readyEl !== loading) kill(readyEl); clearTimeout(readyT); readyEl = loading; readyT = setTimeout(() => { kill(loading); if (readyEl === loading) readyEl = null; }, 2200); }
}
function begin(url) {
  if (!b) { refresh(); b = { t0: performance.now(), total: 0, done: 0, inflight: 0, bytes: 0, urls: [], failed: [], visible: false, settle: 0, grace: 0 }; }
  clearTimeout(b.settle); b.total++; b.inflight++; if (b.urls.length < 400) b.urls.push(url);
  if (!b.visible && !b.grace) { const me = b; b.grace = setTimeout(() => { if (b === me && me.inflight > 0) { me.visible = true; paint(); } }, GRACE); }
  paint(); return b;
}
function end(batch, ok, res, url, err) {
  if (batch !== b) return; batch.inflight--; if (ok) { batch.done++; const n = +(res && res.headers.get('content-length')) || 0; batch.bytes += n; }
  else batch.failed.push({ url, why: err ? 'network' : 'HTTP ' + (res && res.status), offline: !!err && navigator.onLine === false });
  paint(); if (batch.inflight === 0) batch.settle = setTimeout(() => { if (b === batch && batch.inflight === 0) finish(); }, SETTLE);
}
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input && (input.url || String(input));
  if (!url || /^(blob|data):/i.test(url) || !AUDIO.test(url)) return orig(input, init);
  const batch = begin(url);
  return orig(input, init).then((res) => { end(batch, res.ok, res, url); return res; }, (err) => { end(batch, false, null, url, err); throw err; });
};
sc.soundLoad = { state: () => ({ active: !!b, visible: !!(b && b.visible), shown, last: lastBatch }) };
