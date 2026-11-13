/* Syntax view (key 6): teaches the new paradigms from data/syntax.json (sourced from docs/HOOKS_SYNTAX.md and docs/BLUEPRINT.md).
   One tap on an example loads it into the Rack editor and plays it. Paradigms whose engine is not present are marked "coming".
   Every example is also an intellisense snippet (provider "syntax"). */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = () => window.Pattern && window.Pattern.prototype;
/* feature detection: built if the engine is loaded (some only after the first Play, when Strudel's globals exist) */
const HAS = {
  hooks: () => !!(sc.hooks && sc.hooks.bind && P() && P().use) || (!!sc.hooksLib && !window.Pattern),
  taps: () => !!(sc.hooks && sc.hooks.let && P() && P().tap && P().wire) || (!!sc.hooksLib && !window.Pattern),
  controls: () => !!(sc.controls && sc.controls.create),
  perform: () => !!(sc.controls && sc.pads),
  library: () => !!(sc.hooks && sc.hooks.inst),
  word: () => typeof window.word === 'function' || !window.Pattern,
  ghost: () => !!(sc.intellisense && sc.intellisense.registerInline),
  workspace: () => !!(sc.palette && sc.workspace && sc.range),
};
const data = fetch('data/syntax.json').then((r) => r.json()).catch(() => ({ sections: [] }));

/* intellisense snippets */
function registerSnippets() {
  if (!sc.intellisense || !sc.intellisense.register) return false;
  sc.intellisense.register({ id: 'syntax', items: async () => (await data).sections.flatMap((s) => (s.examples || []).filter((e) => e.code && !e.coming).map((e) => ({
    label: e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), category: 'syntax examples', detail: s.title, info: e.code, apply: e.code }))) });
  return true;
}
if (!registerSnippets()) { const iv = setInterval(() => { if (registerSnippets()) clearInterval(iv); }, 300); setTimeout(() => clearInterval(iv), 15000); }

async function render() {
  const root = $('#syntax'); if (!root) return; const d = await data;
  root.innerHTML = `<div class="panel-head"><h2>Syntax</h2><span class="sx-sub">New paradigms, each with runnable examples</span></div>
  <nav class="sx-toc" aria-label="Syntax sections">${d.sections.map((s) => `<a href="#sx-${s.id}" data-sx="${s.id}">${esc(s.title)}</a>`).join('')}</nav>
  ${d.sections.map((s) => { const built = (HAS[s.needs] || (() => false))();
    return `<section class="sx-sec" id="sx-${s.id}" aria-labelledby="sxh-${s.id}"><h3 id="sxh-${s.id}">${esc(s.title)} <span class="sx-badge" data-built="${built}">${built ? 'built' : 'coming'}</span></h3>
    <p>${esc(s.explain)}</p>
    ${(s.examples || []).map((e, i) => { const coming = e.coming || !built; return `<figure class="sx-ex">
      ${e.code ? `<pre><code>${esc(e.code)}</code></pre>` : ''}
      <figcaption><span>${esc(e.title)}</span>${coming ? '<span class="sx-badge" data-built="false">coming</span>' : `<button type="button" class="sx-run" data-sec="${s.id}" data-i="${i}">${e.action ? 'Open' : e.noplay ? 'Load' : 'Load and play'}</button>`}</figcaption></figure>`; }).join('')}
    </section>`; }).join('')}`;
  root.querySelectorAll('.sx-toc a').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); $('#sx-' + a.dataset.sx).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }));
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.sx-run'); if (!b) return;
    const sec = d.sections.find((s) => s.id === b.dataset.sec); const ex = sec.examples[+b.dataset.i];
    if (ex.action === 'perform') { window.__sc.setView('perform'); return; }
    window.__sc.setView('rack'); const ta = document.getElementById('code'); ta.value = ex.code; ta.dispatchEvent(new Event('input'));
    if (!ex.noplay) { if (window.__sc.S.playing) { /* live swap path picks the edit up */ } else await window.__sc.play(); }
    sc.ui && sc.ui.toast(`Loaded "${ex.title}" into Rack${ex.noplay ? '' : ' and playing'}. Revert restores the recipe.`, { kind: 'ok' });
  });
}
window.addEventListener('strudel:ready', () => setTimeout(render, 300));
sc.syntax = { render, has: (k) => (HAS[k] || (() => false))() };
render();
