/* Site modal (input / yes-no) and toast components. Never use the browser's native dialogs.
   window.strudelCraft.ui = { ask({title, label, value, okText}) -> Promise<string|null>,
                              askYesNo({title, message, okText, danger}) -> Promise<boolean>,
                              toast(message, {kind: 'info'|'ok'|'error', ms}) } */
(() => {
  const sc = (window.strudelCraft = window.strudelCraft || {});
  const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } e.append(...kids); return e; };
  let n = 0;
  function modal({ title, message, label, value, okText = 'OK', cancelText = 'Cancel', input = false, danger = false }) {
    return new Promise((resolve) => {
      const id = 'scm' + ++n; const prev = document.activeElement;
      const field = input ? h('input', { type: 'text', id: id + 'i', class: 'scm-input', autocomplete: 'off', enterkeyhint: 'done' }) : null; if (field) field.value = value || '';
      const ok = h('button', { type: 'submit', class: danger ? 'scm-ok danger' : 'scm-ok' }, okText);
      const cancel = h('button', { type: 'button', class: 'ghost' }, cancelText);
      const form = h('form', { method: 'dialog', class: 'scm-body' },
        message ? h('p', { class: 'scm-msg', id: id + 'm' }, message) : '',
        field ? h('label', { for: id + 'i', class: 'scm-lab' }, label || title) : '', field || '',
        h('div', { class: 'scm-acts' }, cancel, ok));
      const d = h('dialog', { class: 'scm', 'aria-labelledby': id + 't' }, h('div', { class: 'help-head' }, h('h2', { id: id + 't' }, title)), form);
      if (message) d.setAttribute('aria-describedby', id + 'm');
      let done = false;
      const finish = (v) => { if (done) return; done = true; d.close(); d.remove(); if (prev && prev.focus) prev.focus({ preventScroll: true }); resolve(v); };
      form.addEventListener('submit', (e) => { e.preventDefault(); finish(input ? field.value : true); });
      cancel.addEventListener('click', () => finish(input ? null : false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(input ? null : false); });
      d.addEventListener('click', (e) => { if (e.target === d) finish(input ? null : false); });
      d.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(input ? null : false); return; }
        if (e.key !== 'Tab') return;
        const f = [...d.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      document.body.append(d); d.showModal(); (field || ok).focus(); if (field) field.select();
    });
  }
  let stack = null;
  function toast(message, { kind = 'info', ms, sticky = false, onClick = null } = {}) {
    if (!stack) { stack = h('div', { class: 'toasts', role: 'region', 'aria-label': 'Notifications' }); document.body.append(stack); }
    const t = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, h('span', {}, String(message)), h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss' }, '×'));
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
    t.querySelector('button').addEventListener('click', kill);
    if (onClick) { const sp = t.querySelector('span'); const b = h('button', { type: 'button', class: 'toast-act' }, String(message)); sp.replaceWith(b); b.addEventListener('click', () => { onClick(); kill(); }); }
    stack.append(t); try { if (!stack.hasAttribute('popover')) stack.setAttribute('popover', 'manual'); if (stack.matches(':popover-open')) stack.hidePopover(); stack.showPopover(); } catch (e) { /* no popover API: plain fixed layer */ }
    while (stack.children.length > 3) stack.firstChild.remove();
    if (!sticky) setTimeout(kill, ms || (kind === 'error' ? 6000 : 2600)); return t;
  }
  sc.ui = { ask: (o) => modal({ ...o, input: true }), askYesNo: (o) => modal({ ...o, input: false }), toast };
})();
/* Phone chrome: overflow tools sheet and header that hides on scroll down, returns on scroll up. */
(() => {
  const ready = () => {
    const more = document.getElementById('moreBtn'), tools = document.getElementById('tools'), top = document.querySelector('.top');
    if (!more || !tools || !top) return;
    const mq = matchMedia('(max-width:760px),(max-height:500px) and (orientation:landscape)');
    const follow = document.querySelector('.tp-src'), home = follow && follow.parentNode;
    const place = () => { if (!follow) return; if (mq.matches) tools.append(follow); else if (follow.parentNode !== home) home.prepend(follow); };
    place(); mq.addEventListener('change', place);
    const set = (o) => { tools.classList.toggle('open', o); more.setAttribute('aria-expanded', String(o)); };
    more.addEventListener('click', (e) => { e.stopPropagation(); set(!tools.classList.contains('open')); });
    document.addEventListener('click', (e) => { if (!tools.contains(e.target)) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tools.classList.contains('open')) { set(false); more.focus(); } });
    const nav = document.querySelector('.views');
    const showTab = () => requestAnimationFrame(() => { const a = nav && nav.querySelector('[aria-current="page"]'); if (a && mq.matches) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: 'auto' }); });
    showTab(); addEventListener('hashchange', showTab); setTimeout(showTab, 400);
    let last = scrollY, acc = 0;
    addEventListener('scroll', () => {
      const y = scrollY, d = y - last; last = y;
      if (!mq.matches || y < 60) { top.classList.remove('hide'); acc = 0; return; }
      acc = (Math.sign(d) === Math.sign(acc)) ? acc + d : d;
      if (acc > 24 && !tools.classList.contains('open')) top.classList.add('hide'); else if (acc < -12) top.classList.remove('hide');
    }, { passive: true });
    top.addEventListener('focusin', () => top.classList.remove('hide'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
