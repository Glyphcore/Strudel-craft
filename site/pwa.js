/* Installable app (PWA, #73): install offer in the ? dialog, the overflow tools menu and the command palette, one-time toast after the
   user has engaged (never on first load), Add to Home Screen hint where the browser offers no install event (iOS Safari, Firefox),
   standalone detection, manifest shortcuts (?action=record), file handling (?action=open-file, launchQueue -> capture import),
   offline notices from sw.js. API: window.strudelCraft.pwa = { install(), canPrompt, installed, standalone } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s) => document.querySelector(s);
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const KEY = 'sc.pwa.toasted';
const mqStandalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)');
const isStandalone = () => mqStandalone.matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferred = null, installed = isStandalone();
const offers = new Set();

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>';
function sync() {
  installed = installed || isStandalone();
  document.documentElement.classList.toggle('pwa-standalone', isStandalone());
  for (const el of offers) el.hidden = installed;
}

function hint() {
  const message = isIOS
    ? 'In Safari, tap Share (the square with an arrow), then "Add to Home Screen". Strudel Craft then opens full screen and works offline after the first visit.'
    : /Firefox\//.test(ua)
      ? 'Open the browser menu and choose "Install" (or "Add to Home screen"). The app works offline after the first visit.'
      : 'Open the browser menu and choose "Install app" or "Add to Home screen". In Chrome on Android the option appears once the page has loaded.';
  return sc.ui.askYesNo({ title: 'Install Strudel Craft', message, okText: 'Got it', cancelText: 'Close' });
}
async function install() {
  if (installed) { toast('Already installed: open Strudel Craft from your home screen', { kind: 'ok' }); return 'installed'; }
  if (!deferred) { await hint(); return 'hint'; }
  const p = deferred; deferred = null;
  try { await p.prompt(); const c = await p.userChoice; if (c && c.outcome === 'accepted') { installed = true; sync(); } return c && c.outcome; } catch (e) { toast('Install failed: ' + e.message, { kind: 'error' }); return 'error'; }
}

function offerInHelp() {
  const d = $('#help'); if (!d || $('#pwaHelp')) return;
  const box = document.createElement('div'); box.id = 'pwaHelp'; box.className = 'pwa-help';
  box.innerHTML = `<div><b>Install app</b><span>Runs full screen from the home screen, works offline after the first visit.</span></div><button type="button" class="pwa-btn">${ICON}<span>Install</span></button>`;
  box.querySelector('button').addEventListener('click', () => { d.close(); install(); });
  const head = d.querySelector('.help-head'); head ? head.after(box) : d.prepend(box); offers.add(box);
}
function offerInTools() {
  const tools = $('#tools'); if (!tools || $('#installBtn')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'icon'; b.id = 'installBtn'; b.setAttribute('aria-label', 'Install app'); b.title = 'Install app';
  b.innerHTML = ICON; b.addEventListener('click', () => { tools.classList.remove('open'); install(); });
  tools.prepend(b); offers.add(b);
}
let unreg = null;
function offerInPalette() {
  const P = sc.palette; if (!P || !P.register) return false;
  if (unreg) unreg(); if (!installed) unreg = P.register({ id: 'app.install', group: 'App', title: 'Install app', run: () => install() }); return true;
}

/* one-time toast after engagement: two engaged actions (Play, view switch, recipe pick) and 45 s on the page, never on first load */
let engaged = 0; const t0 = performance.now();
function nudge() {
  if (installed || (!deferred && !isIOS)) return;
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }
  if (++engaged < 2 || performance.now() - t0 < 45000) return;
  try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode */ }
  toast('Install Strudel Craft as an app', { kind: 'info', ms: 9000, onClick: () => install() });
}

/* manifest shortcut ?action=record and file handler ?action=open-file */
const until = (f, ms = 8000) => new Promise((res) => { const s = performance.now(); (function k() { const v = f(); if (v || performance.now() - s > ms) res(v); else setTimeout(k, 100); })(); });
async function launchActions() {
  const q = new URLSearchParams(location.search), act = q.get('action');
  if (act) { q.delete('action'); history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
  if (act === 'record') { const c = await until(() => sc.capture); if (c) c.open(); }
  if ('launchQueue' in window) window.launchQueue.setConsumer(async (p) => {
    for (const h of (p.files || [])) {
      try { const f = await h.getFile(); const c = await until(() => sc.capture); if (!c) throw new Error('capture not loaded'); c.open(); await c.importRecipe(f); } catch (e) { toast('Open file: ' + e.message, { kind: 'error' }); }
    }
  });
}

/* offline notices: sw.js posts {type: 'sc-offline', kind: 'bank'|'pack', url} when a bank file is neither cached nor reachable */
const told = new Set();
function onSwMessage(e) {
  const d = e.data; if (!d || d.type !== 'sc-offline') return;
  const host = (() => { try { const u = new URL(d.url); return u.pathname.split('/').slice(0, 4).join('/'); } catch (x) { return d.url; } })();
  if (told.has(host)) return; told.add(host);
  toast(d.kind === 'pack' ? 'Offline: this vocal bank is not cached yet. It loads when you are back online.' : 'Offline: this sample bank is not cached yet. It loads when you are back online.', { kind: 'error' });
}

function boot() {
  offerInHelp(); offerInTools(); sync(); if (!offerInPalette()) until(() => sc.palette).then(offerInPalette);
  mqStandalone.addEventListener('change', () => { sync(); offerInPalette(); });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; sync(); });
  addEventListener('appinstalled', () => { installed = true; deferred = null; sync(); offerInPalette(); toast('Installed. Open Strudel Craft from your home screen', { kind: 'ok' }); });
  const play = $('#playBtn'); if (play) play.addEventListener('click', nudge);
  addEventListener('hashchange', nudge);
  const list = $('#list'); if (list) list.addEventListener('click', nudge);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage);
  addEventListener('offline', () => toast('Offline: the app and cached banks keep playing', { kind: 'info' }));
  launchActions();
}
/* the event can fire before DOMContentLoaded */
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
sc.pwa = { install, hint, get canPrompt() { return !!deferred; }, get installed() { return installed; }, get standalone() { return isStandalone(); } };
