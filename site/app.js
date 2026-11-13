/* Strudel Craft: shared helpers + page modules. No build step. */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
const STRUDEL_WEB = 'https://unpkg.com/@strudel/web@1.3.0';
const SAMPLE_MAPS = ['https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json', 'github:tidalcycles/dirt-samples'];

/* strudel.cc stores the program in the URL hash: encodeURIComponent(base64(UTF-8 bytes)). Format read from the strudel.cc REPL bundle. */
function strudelUrl(code) { const b = new TextEncoder().encode(code); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return 'https://strudel.cc/#' + encodeURIComponent(btoa(s)); }

async function loadJSON(name) { const r = await fetch('data/' + name + '.json'); if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.json(); }

function nav(page) {
  const links = [['index.html', 'Catalog', 'catalog'], ['compose.html', 'Compose', 'compose'], ['plugins.html', 'Plugins', 'plugins'], ['practices.html', 'Best practices', 'practices']];
  const h = el('header', { class: 'top' }, el('div', { class: 'wrap' }, el('h1', {}, 'Strudel Craft'),
    el('button', { id: 'theme', 'aria-label': 'Toggle light or dark theme', onclick: toggleTheme }, 'Theme'),
    el('nav', { 'aria-label': 'Pages' }, links.map(([h2, t, id]) => el('a', Object.assign({ href: h2 }, id === page ? { 'aria-current': 'page' } : {}), t)))));
  document.body.prepend(h);
}
function toggleTheme() { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch (e) {} }
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

async function copyText(text, btn) { try { await navigator.clipboard.writeText(text); } catch (e) { const t = el('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch (e2) {} t.remove(); } const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1200); }

/* ---- live player (one shared instance, started from a button tap) ---- */
const Player = {
  ready: null, playing: null, samplesLoaded: false,
  load() {
    if (!this.ready) this.ready = new Promise((res, rej) => { const s = document.createElement('script'); s.src = STRUDEL_WEB; s.onload = () => { try { res(initStrudel()); } catch (e) { rej(e); } }; s.onerror = () => rej(new Error('Could not load @strudel/web from unpkg (offline?)')); document.head.append(s); });
    return this.ready;
  },
  async play(code, needsSamples, onStatus) {
    onStatus('Loading engine...'); await this.load();
    if (needsSamples && !this.samplesLoaded) { onStatus('Loading sample banks...'); for (const m of SAMPLE_MAPS) await samples(m); this.samplesLoaded = true; }
    onStatus('Starting...'); const ev = window.evaluate || (window.strudelRepl && window.strudelRepl.evaluate);
    if (!ev) throw new Error('Strudel evaluate() not found');
    await ev(code); this.playing = code; onStatus('Playing');
  },
  stop(onStatus) { try { if (window.hush) window.hush(); } catch (e) {} this.playing = null; onStatus && onStatus('Stopped'); },
};
window.__player = Player;

function playButtons(getCode, needsSamples, statusEl) {
  const btn = el('button', { class: 'primary' }, 'Play'); const stop = el('button', {}, 'Stop');
  const say = (m) => (statusEl.textContent = m);
  btn.addEventListener('click', async () => { try { await Player.play(getCode(), needsSamples(), say); } catch (e) { say('Error: ' + e.message); console.error(e); } });
  stop.addEventListener('click', () => Player.stop(say));
  return [btn, stop];
}

function recipeCard(r, labelsById) {
  const status = el('div', { class: 'status', role: 'status' });
  const badge = r.verified ? el('span', { class: 'badge ok' }, 'rendered ok') : el('span', { class: 'badge no' }, 'not verified');
  const meas = r.verified ? el('span', { class: 'meta' }, ` ${r.rms_dbfs} dBFS rms, centroid ${r.centroid_hz} Hz`) : null;
  const pre = el('pre', {}, el('code', {}, r.code));
  const copy = el('button', { onclick: (e) => copyText(r.code, e.currentTarget) }, 'Copy');
  const open = el('a', { class: 'btn', href: strudelUrl(r.code), target: '_blank', rel: 'noopener' }, 'Open in strudel.cc');
  const [p, s] = playButtons(() => r.code, () => r.needs_samples, status);
  return el('article', { class: 'card', id: r.id },
    el('h3', {}, r.title), el('div', {}, badge, meas, r.unverified.length ? el('span', { class: 'badge warn', style: 'margin-left:6px', title: r.unverified.join(', ') }, 'docs UNVERIFIED: ' + r.unverified.join(', ')) : null),
    el('p', {}, r.intent), el('div', { class: 'tags' }, r.labels.map((l) => el('span', { class: 'tag' }, labelsById[l] ? labelsById[l].title : l))),
    pre, el('div', { class: 'row' }, p, s, copy, open), status,
    r.needs_samples ? el('p', { class: 'meta' }, 'Uses sample banks (drum machines); the player loads them on first play, which needs network access.') : null,
    !r.verified && r.error ? el('p', { class: 'meta' }, 'Headless check: ' + r.error) : null,
    el('details', {}, el('summary', {}, 'Notes and source'), el('p', {}, r.notes), el('p', {}, el('a', { href: r.source, rel: 'noopener' }, r.source))));
}

function chipGroup(cat, labels, selected, onChange) {
  const d = el('details', { class: 'cat' }, el('summary', {}, cat.title)); const box = el('div', { class: 'chips' });
  for (const l of labels.filter((x) => x.category === cat.id)) {
    const b = el('button', { class: 'chip', 'aria-pressed': 'false', title: l.words.join(', ') }, l.title);
    b.addEventListener('click', () => { const on = !selected.has(l.id); on ? selected.add(l.id) : selected.delete(l.id); b.setAttribute('aria-pressed', on); onChange(); });
    box.append(b);
  }
  d.append(box); return d;
}

const norm = (s) => s.toLowerCase();
function matches(r, q, selected, verifiedOnly, labelsById) {
  if (verifiedOnly && !r.verified) return false;
  for (const l of selected) if (!r.labels.includes(l)) return false;
  if (!q) return true;
  const hay = norm([r.title, r.intent, r.notes, r.code, ...r.labels.flatMap((l) => [l, ...(labelsById[l] ? labelsById[l].words : [])])].join(' '));
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

async function pageCatalog() {
  const cat = await loadJSON('catalog'); const labelsById = Object.fromEntries(cat.labels.map((l) => [l.id, l]));
  const selected = new Set(); const q = $('#q'); const vo = $('#vonly'); const list = $('#list'); const count = $('#count');
  const render = () => { const rs = cat.recipes.filter((r) => matches(r, norm(q.value.trim()), selected, vo.checked, labelsById)); list.replaceChildren(...rs.map((r) => recipeCard(r, labelsById))); count.textContent = rs.length + ' of ' + cat.recipes.length + ' recipes'; };
  $('#filters').append(...cat.categories.map((c) => chipGroup(c, cat.labels, selected, render)));
  q.addEventListener('input', render); vo.addEventListener('change', render); $('#clear').addEventListener('click', () => { selected.clear(); q.value = ''; document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', 'false')); render(); });
  render(); if (location.hash.length > 1) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
}

async function pageCompose() {
  const cat = await loadJSON('catalog'); const labelsById = Object.fromEntries(cat.labels.map((l) => [l.id, l]));
  const rs = cat.recipes.filter((r) => r.expr); const selected = new Set(); const picked = new Set(); const list = $('#list'); const out = $('#out'); const bpm = $('#bpm'); const status = $('#status');
  const build = () => { const chosen = rs.filter((r) => picked.has(r.id)); const b = Math.max(40, Math.min(240, +bpm.value || 120));
    out.value = chosen.length ? `setcpm(${b}/4)\n\n$: stack(\n${chosen.map((r) => '  // ' + r.title + '\n  ' + r.expr.replace(/\n/g, '\n  ')).join(',\n')}\n)\n` : '// pick recipes above'; $('#open').href = strudelUrl(out.value); $('#npick').textContent = chosen.length + ' picked'; };
  const render = () => { const vis = rs.filter((r) => matches(r, '', selected, false, labelsById)); list.replaceChildren(...vis.map((r) => {
    const cb = el('input', { type: 'checkbox', id: 'p-' + r.id }); cb.checked = picked.has(r.id); cb.addEventListener('change', () => { cb.checked ? picked.add(r.id) : picked.delete(r.id); build(); });
    return el('div', { class: 'pick' }, cb, el('label', { for: 'p-' + r.id }, el('strong', {}, r.title), el('br'), el('span', { class: 'meta' }, r.intent + (r.verified ? '' : ' (not verified)')))); })); };
  $('#filters').append(...cat.categories.map((c) => chipGroup(c, cat.labels, selected, render)));
  bpm.addEventListener('input', build); out.addEventListener('input', () => ($('#open').href = strudelUrl(out.value)));
  $('#copy').addEventListener('click', (e) => copyText(out.value, e.currentTarget));
  const [p, s] = playButtons(() => out.value, () => rs.some((r) => picked.has(r.id) && r.needs_samples), status); $('#play').append(p, s);
  render(); build();
}

async function pageDoc(name) {
  const d = await loadJSON(name); const root = $('#doc'); const q = $('#q');
  const secs = d.sections.map((s) => { const sec = el('section', {}, el('h2', {}, s.title)); const rows = [];
    for (const b of s.blocks) { if (b.type === 'html') { const div = el('div'); div.innerHTML = b.html; sec.append(div); } else { const tb = el('tbody'); for (const r of b.rows) { const tr = el('tr'); for (const c of r) { const td = el('td'); td.innerHTML = c; tr.append(td); } tb.append(tr); rows.push(tr); }
      sec.append(el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, b.columns.map((c) => el('th', {}, c)))), tb))); } }
    return { sec, rows, title: s.title }; });
  root.replaceChildren(...secs.map((s) => s.sec));
  if (q) q.addEventListener('input', () => { const w = norm(q.value).split(/\s+/).filter(Boolean); for (const s of secs) { let any = false; for (const tr of s.rows) { const ok = w.every((x) => norm(tr.textContent).includes(x)); tr.hidden = !ok; any = any || ok; } if (s.rows.length) s.sec.hidden = w.length > 0 && !any; } });
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page; nav(page);
  const run = { catalog: pageCatalog, compose: pageCompose, plugins: () => pageDoc('plugins'), practices: () => pageDoc('practices') }[page];
  run().catch((e) => { console.error(e); const m = $('#doc, #list'); if (m) m.textContent = 'Failed to load data: ' + e.message; });
});
