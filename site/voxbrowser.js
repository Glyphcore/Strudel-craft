/* Banks browser (#85): what every vox bank holds, so you know what you can type. Loaded on first open (Syntax head button, Ctrl+K > Banks,
   workspace pane "Banks"). Data and audio go through vox-banks.js (pack loader for bank files, a clip is fetched only when auditioned).
   One panel component, mounted in the sheet (dialog) and/or a workspace pane; both follow the active bank. Notices are toasts; no native dialogs. */
const sc = window.strudelCraft;
const V = () => sc.voxBanks;
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 60;
const ICON = { play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>', stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>', back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' };

function loadCss() {
  if (document.querySelector('link[data-vb]')) return Promise.resolve();
  return new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('voxbrowser.css', import.meta.url).href; l.dataset.vb = ''; l.onload = ok; l.onerror = ok; document.head.append(l); });
}
const pitchText = (b) => (b.notes && b.notes.length ? b.notes.join(' ') : b.range && b.range.length ? `${b.range[0]} to ${b.range[1]}, natural pitch` : 'pitch unknown');
const fmtDur = (d) => (d ? (d[0] === d[1] ? d[0].toFixed(2) : `${d[0].toFixed(2)}-${d[1].toFixed(2)}`) + ' s' : '');
const clipLabel = (c) => (c.note || 'take') + (c.i ? ':' + c.i : '');

/* insert into the Rack editor: `$: snippet` on a new line after the caret line (or at the end when the editor was never used), plus the voxBank line it needs */
export function insert(bank, code) {
  const ta = document.getElementById('code'); if (!ta) return false;
  const doc0 = ta.value || ''; const need = bank.name !== 'demo' && !doc0.includes(V().line(bank));
  const text = (need ? `await ${V().line(bank)}\n` : '') + '$: ' + code;
  const v = ta.cmView;
  if (v) {
    const d = v.state.doc, head = v.state.selection.main.head; let at, ins;
    if (!d.length) { at = 0; ins = text; }
    else if (head === 0 && !v.hasFocus) { at = d.length; ins = (d.sliceString(d.length - 1) === '\n' ? '' : '\n') + text; }
    else { const ln = d.lineAt(head); if (!ln.text.trim()) { at = ln.from; ins = text; } else { at = ln.to; ins = '\n' + text; } }
    v.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, scrollIntoView: true, userEvent: 'input.paste' });
  } else { ta.value = doc0 + (doc0 && !doc0.endsWith('\n') ? '\n' : '') + text; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  if (!ta.closest('.ws-pane') && window.__sc && window.__sc.S && window.__sc.S.view !== 'rack') window.__sc.setView('rack');
  return true;
}

export function createPanel(root, o = {}) {
  const st = { mode: 'list', kind: 'all', bank: null, q: '', pitch: '', tech: '', shown: PAGE, sel: new Map(), playing: null, busy: '' };
  root.classList.add('vb'); root.innerHTML = '';
  const top = document.createElement('div'); top.className = 'vb-top';
  const body = document.createElement('div'); body.className = 'vb-body';
  root.append(top, body);
  let banks = [];

  const drawTop = () => {
    const a = V().active(); const b = banks.find((x) => x.name === a || x.short === a);
    top.innerHTML = `<span class="vb-dot" aria-hidden="true"></span><span class="vb-act-l">Active</span><code class="vb-line" title="The line that switches to this bank">${esc(b ? V().line(b) : `voxBank('${a}')`)}</code>${window.voxBank ? '' : '<span class="vb-def">default, loads on first word()</span>'}`;
  };
  const drawList = () => {
    const shown = banks.filter((b) => st.kind === 'all' || b.kind === st.kind);
    body.innerHTML = `<div class="vb-kinds" role="group" aria-label="Bank kind">${[['all', 'All'], ['word', 'Word banks'], ['sound', 'Sound banks']].map(([k, t]) => `<button type="button" class="vb-chip" data-kind="${k}" aria-pressed="${st.kind === k}">${t}</button>`).join('')}</div>
    <p class="vb-hint">Word banks play with <code>word("baby:1")</code>, sound banks with <code>s("vs_a")</code>. Open a bank to see every word, take and pitch.</p>
    <ul class="vb-banks" aria-label="Vox banks">${shown.map((b) => `<li class="vb-card" data-bank="${esc(b.name)}" data-active="${!!b.active}" data-kind="${b.kind}">
      <button type="button" class="vb-open-b" data-open="${esc(b.name)}" aria-label="Open bank ${esc(b.short || b.name)}"><span class="vb-bn">${esc(b.short || b.name)}</span>
        <span class="vb-pill" data-k="${b.kind}">${b.kind === 'sound' ? 'sound bank' : 'word bank'}</span>${b.active ? '<span class="vb-pill vb-on">active</span>' : ''}${b.origin !== 'shipped' ? `<span class="vb-pill">${b.origin}</span>` : ''}
        <span class="vb-counts"><b class="vb-w">${b.words ?? '?'}</b> ${b.kind === 'sound' ? 'keys' : 'words'} · <b class="vb-c">${b.clips ?? '?'}</b> clips</span>
        <span class="vb-pitch">${esc(pitchText(b))}</span>
        <span class="vb-lic">${esc(b.licence || b.license || '')}</span></span></button>
      <button type="button" class="ghost vb-use" data-use="${esc(b.name)}" ${b.active ? 'aria-pressed="true"' : ''}>${b.active ? 'In use' : 'Use'}</button></li>`).join('') || '<li class="vb-empty">No banks of this kind</li>'}</ul>`;
  };
  const filtered = () => {
    const b = st.bank; const q = st.q.trim().toLowerCase();
    let es = b.entries.filter((e) => (!st.pitch || e.notes.includes(st.pitch)) && (!st.tech || e.technique === st.tech));
    if (q) es = es.map((e) => { const n = e.name.toLowerCase(), w = String(e.word).toLowerCase(); const s = n === q || w === q ? 0 : n.startsWith(q) || w.startsWith(q) ? 1 : n.includes(q) || w.includes(q) || e.key.includes(q) ? 2 : -1; return [s, e]; }).filter(([s]) => s >= 0).sort((x, y) => x[0] - y[0]).map(([, e]) => e);
    return es;
  };
  const clipOf = (e) => { const k = st.sel.get(e.key); if (k != null && e.clips[k]) return e.clips[k]; if (st.pitch) { const c = e.clips.find((x) => x.note === st.pitch); if (c) return c; } return e.clips[0]; };
  const row = (e) => { const c = clipOf(e), b = st.bank, snip = c ? V().snippet(b, e, c) : ''; const playing = st.playing && c && st.playing === c.url;
    const chips = e.clips.slice(0, 12).map((x, i) => `<button type="button" class="vb-pc" data-key="${esc(e.key)}" data-ci="${i}" aria-pressed="${x === c}" aria-label="Play ${esc(e.name)} ${esc(clipLabel(x))}${x.dur ? ', ' + x.dur.toFixed(2) + ' s' : ''}">${esc(clipLabel(x))}</button>`).join('') + (e.clips.length > 12 ? `<span class="vb-more-c">+${e.clips.length - 12}</span>` : '');
    return `<li class="vb-row" data-key="${esc(e.key)}">
      <button type="button" class="vb-play" data-play="${esc(e.key)}" aria-label="${playing ? 'Stop' : 'Play'} ${esc(e.name)}${c && c.note ? ' at ' + esc(c.note) : ''}" ${c ? '' : 'disabled'} data-on="${!!playing}">${playing ? ICON.stop : ICON.play}<i class="vb-lvl" aria-hidden="true"></i></button>
      <div class="vb-main"><span class="vb-name">${esc(e.name)}</span>${e.word && e.word.toLowerCase() !== e.name && b.kind !== 'sound' ? `<span class="vb-word">${esc(e.word)}</span>` : ''}
        <span class="vb-sub">${b.kind === 'sound' ? `${e.clips.length} recording${e.clips.length === 1 ? '' : 's'}` : `${e.takes} take${e.takes === 1 ? '' : 's'}${e.notes.length > 1 ? ` × ${e.notes.length} pitches` : ''}`}${e.vowel ? ` · vowel ${e.vowel} · ${e.technique}` : ''}${e.notes.length ? ' · ' + (e.notes.length > 6 ? `${e.notes[0]} to ${e.notes[e.notes.length - 1]}` : e.notes.join(' ')) : ''}${e.dur ? ' · ' + fmtDur(e.dur) : ''}</span>
        <div class="vb-pcs" role="group" aria-label="Takes and pitches of ${esc(e.name)}">${chips}</div></div>
      <button type="button" class="vb-ins" data-ins="${esc(e.key)}" ${c ? '' : 'disabled'} aria-label="Insert ${esc(snip)} into the code" title="Insert into the code"><span class="vb-plus">${ICON.plus}</span><code>${esc(snip)}</code></button></li>`; };
  const drawBank = () => {
    const b = st.bank; const es = filtered(); const techs = [...new Set(b.entries.map((e) => e.technique).filter(Boolean))];
    body.innerHTML = `<div class="vb-bhead"><button type="button" class="ghost vb-back" data-back aria-label="All banks">${ICON.back}<span>Banks</span></button>
      <h3 class="vb-bt">${esc(b.short || b.name)} <span class="vb-pill" data-k="${b.kind}">${b.kind === 'sound' ? 'sound bank' : 'word bank'}</span></h3>
      <button type="button" class="vb-use vb-use-main" data-use="${esc(b.name)}" ${b.active ? 'aria-pressed="true"' : ''}>${b.active ? 'In use' : 'Use this bank'}</button></div>
      <p class="vb-meta"><b>${b.entries.length}</b> ${b.kind === 'sound' ? 'keys' : 'words'} · <b>${new Set(b.entries.flatMap((e) => e.clips.map((c) => c.url))).size}</b> clips · ${esc(pitchText(b))}</p>
      <details class="vb-licd"><summary>${esc(b.licence || b.license || 'licence')}</summary><ul>${(b.attribution || []).map((x) => `<li>${esc(x.text || x.name)}${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">source</a>` : ''}${x.changes ? `<br><small>${esc(x.changes)}</small>` : ''}</li>`).join('')}${b.source ? `<li><small>${esc(b.source)}</small></li>` : ''}</ul></details>
      <div class="vb-tools"><label class="sr" for="${o.id}q">Search ${esc(b.name)}</label><input id="${o.id}q" class="vb-q" type="search" placeholder="Search ${b.kind === 'sound' ? 'keys: a, forte' : 'words: baby, love'}" autocomplete="off" spellcheck="false" value="${esc(st.q)}">
        ${b.notes && b.notes.length > 1 ? `<label class="sr" for="${o.id}p">Pitch</label><select id="${o.id}p" class="vb-p"><option value="">Any pitch</option>${b.notes.map((n) => `<option ${st.pitch === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
        ${techs.length > 1 ? `<label class="sr" for="${o.id}t">Technique</label><select id="${o.id}t" class="vb-t"><option value="">Any technique</option>${techs.map((n) => `<option ${st.tech === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}</div>
      <p class="vb-count" role="status" aria-live="polite">${es.length === b.entries.length ? `${es.length} ${b.kind === 'sound' ? 'keys' : 'words'}` : `${es.length} of ${b.entries.length}`}${b.entries.length && !b.entries[0].clips.length ? ' · clips are not listed for this bank' : ''}</p>
      <ul class="vb-list" aria-label="Entries of ${esc(b.name)}">${es.slice(0, st.shown).map(row).join('') || '<li class="vb-empty">Nothing matches</li>'}</ul>
      ${es.length > st.shown ? `<button type="button" class="ghost vb-moreb" data-more>Show ${Math.min(PAGE, es.length - st.shown)} more (${es.length - st.shown} left)</button>` : ''}`;
  };
  const draw = () => { drawTop(); if (st.mode === 'bank' && st.bank) drawBank(); else drawList(); };
  const redrawRows = () => { const ul = body.querySelector('.vb-list'); if (!ul) return draw(); const es = filtered(); ul.innerHTML = es.slice(0, st.shown).map(row).join('') || '<li class="vb-empty">Nothing matches</li>';
    const c = body.querySelector('.vb-count'); if (c) c.textContent = es.length === st.bank.entries.length ? `${es.length} ${st.bank.kind === 'sound' ? 'keys' : 'words'}` : `${es.length} of ${st.bank.entries.length}`;
    const m = body.querySelector('.vb-moreb'); if (m) m.remove(); if (es.length > st.shown) { const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ghost vb-moreb'; bt.dataset.more = ''; bt.textContent = `Show ${Math.min(PAGE, es.length - st.shown)} more (${es.length - st.shown} left)`; body.append(bt); } };

  async function refresh() { try { banks = await V().list(); } catch (e) { banks = []; } if (st.bank) { const nb = banks.find((x) => x.name === st.bank.name); if (nb) st.bank.active = nb.active; } draw(); }
  async function openBank(name, focus = true) {
    st.busy = name; body.setAttribute('aria-busy', 'true');
    const card = body.querySelector(`[data-open="${CSS.escape(name)}"]`); if (card) card.classList.add('vb-loading');
    try { const b = await V().open(name); const nb = banks.find((x) => x.name === b.name); st.bank = { ...b, active: nb ? nb.active : b.active }; st.mode = 'bank'; st.q = ''; st.pitch = ''; st.tech = ''; st.shown = PAGE; st.sel.clear(); draw(); if (focus) { const q = body.querySelector('.vb-q'); q && q.focus({ preventScroll: true }); } }
    catch (e) { toast(`Bank ${name} could not open: ${e.message}`, { kind: 'error' }); if (card) card.classList.remove('vb-loading'); }
    finally { st.busy = ''; body.removeAttribute('aria-busy'); }
  }
  async function use(name, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try { const ln = await V().use(name); toast(`Active bank: ${ln}`, { kind: 'ok' }); }
    catch (e) { toast(`Could not switch bank: ${e.message}`, { kind: 'error' }); }
    finally { await refresh(); }
  }
  const entryOf = (key) => st.bank && st.bank.entries.find((e) => e.key === key);
  async function play(e, c) {
    if (st.playing === c.url) { V().stop(); st.playing = null; redrawRows(); return; }
    st.playing = c.url; redrawRows();
    try { await V().audition(c); } catch (err) { toast(`Could not play ${e.name}: ${err.message}`, { kind: 'error' }); }
    if (st.playing === c.url) { st.playing = null; redrawRows(); }
  }
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('button,[data-open]'); if (!t || !root.contains(t)) return;
    if (t.dataset.kind) { st.kind = t.dataset.kind; drawList(); body.querySelector(`[data-kind="${st.kind}"]`).focus(); return; }
    if (t.dataset.open) return openBank(t.dataset.open);
    if (t.dataset.use !== undefined && t.dataset.use) return use(t.dataset.use, t);
    if (t.hasAttribute('data-back')) { st.mode = 'list'; st.bank = null; V().stop(); st.playing = null; draw(); const c = body.querySelector('.vb-open-b'); c && c.focus(); return; }
    if (t.hasAttribute('data-more')) { st.shown += PAGE; redrawRows(); return; }
    if (t.dataset.play) { const e = entryOf(t.dataset.play); const c = e && clipOf(e); if (c) play(e, c); return; }
    if (t.dataset.ci) { const e = entryOf(t.dataset.key); if (!e) return; st.sel.set(e.key, +t.dataset.ci); const c = e.clips[+t.dataset.ci]; st.playing = null; V().stop(); play(e, c).then(() => { const b2 = body.querySelector(`.vb-pc[data-key="${CSS.escape(e.key)}"][data-ci="${t.dataset.ci}"]`); b2 && b2.focus({ preventScroll: true }); }); return; }
    if (t.dataset.ins) { const e = entryOf(t.dataset.ins); const c = e && clipOf(e); if (!c) return; const code = V().snippet(st.bank, e, c); if (insert(st.bank, code)) toast(`Inserted ${code}${st.bank.name !== 'demo' ? ` (needs ${V().line(st.bank)})` : ''}`, { kind: 'ok' }); return; }
  });
  root.addEventListener('input', (ev) => { if (ev.target.classList.contains('vb-q')) { st.q = ev.target.value; st.shown = PAGE; redrawRows(); } });
  root.addEventListener('change', (ev) => { if (ev.target.classList.contains('vb-p')) { st.pitch = ev.target.value; st.sel.clear(); st.shown = PAGE; redrawRows(); } else if (ev.target.classList.contains('vb-t')) { st.tech = ev.target.value; st.shown = PAGE; redrawRows(); } });
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && st.mode === 'bank' && !ev.target.closest('dialog.vb-sheet')) { st.mode = 'list'; st.bank = null; draw(); } });
  /* live feedback: the playing button's ring follows the clip's level */
  const offL = V().on('level', (ev) => { if (!root.isConnected) return; const b = root.querySelector('.vb-play[data-on="true"]'); if (b) b.style.setProperty('--lvl', Math.min(1, ev.level * 1.6).toFixed(3)); });
  const offA = V().on('active', () => { if (root.isConnected) refresh(); });
  drawTop(); body.innerHTML = '<p class="vb-hint">Reading the bank index…</p>';
  const ready = refresh().then(() => (o.bank ? openBank(o.bank, false) : null));
  return { root, ready, open: openBank, dispose: () => { offL(); offA(); }, state: st };
}

/* ---- sheet ---- */
let sheet = null, panel = null;
export async function openSheet(name) {
  await loadCss();
  if (!sheet) {
    sheet = document.createElement('dialog'); sheet.className = 'vb-sheet'; sheet.id = 'banksSheet'; sheet.setAttribute('aria-labelledby', 'vbTitle');
    sheet.innerHTML = '<div class="help-head"><h2 id="vbTitle">Banks</h2><button type="button" class="icon" id="vbClose" aria-label="Close banks">&times;</button></div><div class="vb-host"></div>';
    sheet.querySelector('#vbClose').addEventListener('click', () => sheet.close());
    sheet.addEventListener('keydown', (e) => e.stopPropagation()); /* the instrument's single-key shortcuts stay out of the sheet */
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
    sheet.addEventListener('close', () => V().stop());
    document.body.append(sheet);
    panel = createPanel(sheet.querySelector('.vb-host'), { id: 'vbs' });
  }
  if (!sheet.open) sheet.showModal();
  await panel.ready; if (name) await panel.open(name); else { panel.state.mode = panel.state.bank ? 'bank' : 'list'; }
  (sheet.querySelector('.vb-q') || sheet.querySelector('.vb-open-b') || sheet.querySelector('#vbClose')).focus({ preventScroll: true });
  return panel;
}
let paneN = 0;
export async function mount(el) { await loadCss(); return createPanel(el, { id: 'vbp' + ++paneN }); }
sc.voxBrowser = { openSheet, mount, insert, get sheet() { return sheet; }, get panel() { return panel; } };
