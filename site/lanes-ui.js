/* Lanes L5 (#78, docs/LANES.md section 10): lane cards, split fan, bus / selection / capture nodes and tag chips in the Graph view.
   Loaded by graph.js with the Graph view (like atoms-ui.js), never with the shell. Holds no lane state: every render re-projects
   graph(model) (model.js, L4 data) onto the view; every edit is one model.js applyOp through graph.js doOps, or, where model.js has no
   op yet (adding / removing a tagged(...) statement, a selection's .send amount, a capture window), one splice of that statement's
   text, committed on the graph's shared undo stack. The only view state is which split fans are folded and the tag filter.
   Runtime: tags / tagged / mute / solo (#74), the audio layer .split .merge .send ret (#75) and capture / recall (#76) are live. Capture node
   actions call the capture runtime's public entry points only (docs/LANES.md 11e): Bounce = lanesCapture.host.bounce (a take in the Record
   list), Freeze / Thaw = lanesCapture.freeze / thaw (journaled), Use as sample = lanesCapture.host.resolve (registers cap_<name>) and then
   one inserted `.from("<name>")` lane (a text splice on the graph's undo stack). Audio of bus: and rolling captures is "coming" there, so
   those actions stay disabled with that reason. */
import * as acorn from './vendor/acorn-8.19.0.mjs';
import { checkWire } from './model.js';

const sc = (window.strudelCraft = window.strudelCraft || {});
const FOLD = 'sc.lanes.fold';
const ROWH = 52, TAGH = 52, PAD = 10;
const ANON = /^\$\d*$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } } };
const strOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.$mini === 'string' ? v.$mini : null);
const fmt = (v) => (typeof v === 'number' ? String(+v.toFixed(3)) : String(v));
const COMING = { pad: 'needs a pad-assign entry point in the Perform view' };

let X = null; // graph.js context (functions only)
let BUSY = null; // the capture action in flight { name, act } (one at a time: each one compiles the program and renders offline)
let V = {}; // voice counts per lane, valid only for the exact program text they were counted on (view cache, not lane state)
let P = { on: false, lanes: [], tags: [], state: {}, buses: [], captures: [], selections: [], refused: [], model: null, g: null, fold: new Set(store.get(FOLD, [])), filter: null };

export function loadCss() {
  let l = document.querySelector('link[href="lanes-ui.css"]'); if (l && l.sheet) return Promise.resolve();
  if (!l) { l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lanes-ui.css'; document.head.append(l); }
  return new Promise((res) => { l.addEventListener('load', res, { once: true }); l.addEventListener('error', res, { once: true }); });
}

/* ---------------------------------------------------------------- projection */
// one tag op is "chip state" when the program has exactly `tagged("<tag>").mute()` (or .solo()): no gate, no other op
function chipState(model) {
  const st = {};
  for (const s of model.selections || []) {
    const tag = strOf(s.selector); if (!tag || !/^[\w-]+$/.test(tag) || (s.ops || []).length !== 1) continue;
    const o = s.ops[0]; if ((o.op === 'mute' || o.op === 'solo') && o.gate === undefined && o.on !== false) (st[tag] ||= {})[o.op] = true;
  }
  return st;
}
function lanesOf(model) {
  const out = []; let anon = 0;
  for (const t of model.tracks || []) if (!(t.chain == null && t.source == null)) out.push({ id: ANON.test(t.name) ? `$${anon++}` : t.name, name: t.name, tags: t.tags || [], t });
  return out;
}
const laneById = (id) => P.lanes.find((l) => l.id === id);
const port = (n, dir, name, type, label) => { const arr = dir === 'in' ? n.ins : n.outs; let p = arr.find((x) => x.name === name); if (!p) { p = { name, type, label: label || name, dir }; arr.push(p); } else if (type) p.type = type; return p; };

export function decorate(view, model, g) {
  P = { ...P, on: false, model, g, lanes: [], tags: [], state: {}, buses: [], captures: [], selections: [], refused: (g && g.refused) || [] };
  const lane = view.nodes.some((n) => n.raw && ((n.kind === 'track' && n.raw.tags) || ['bus', 'selection', 'capture'].includes(n.kind)));
  if (!lane) return view;
  P.on = true; P.lanes = lanesOf(model); P.state = chipState(model);
  P.tags = [...new Set(P.lanes.flatMap((l) => l.tags))];
  const byG = new Map(g.nodes.map((n) => [n.id, n]));
  for (const v of view.nodes) {
    if (v.kind === 'track' && v.raw.tags) laneCard(v, model, byG);
    else if (v.kind === 'bus') busNode(v);
    else if (v.kind === 'selection') selNode(v);
    else if (v.kind === 'capture') capNode(v);
    else if (v.kind === 'tap' && v.raw.local) v.sub = `tap · local to ${v.raw.lane} branch ${v.raw.branch + 1}`;
  }
  // audio wire badges carry the send amount; a send made by a selection names it
  for (const w of view.wires) if (w.type === 'audio') {
    const b = view.nmap.get(w.to.node);
    if (b && b.kind === 'bus') { const s = (b.raw.sends || []).find((x) => `track:${(laneById(x.lane) || {}).name}` === w.from.node); if (s) w.badge = fmt(s.amount) + (s.via ? ' sel' : ''); }
    else if (view.nmap.get(w.from.node) && view.nmap.get(w.from.node).kind === 'bus') w.badge = 'ret';
  }
  return view;
}

function laneCard(v, model, byG) {
  const t = (model.tracks || []).find((x) => x.name === v.label), L = P.lanes.find((l) => l.name === v.label); if (!t || !L) return;
  port(v, 'out', 'audio', 'audio', 'audio');
  if (t.ret) port(v, 'in', 'in', 'audio', `ret ${t.ret}`);
  const xt = (t.chain || []).filter((s) => s[0] === 'tap' && typeof s[1] === 'string' && isObj(s[2]) && s[2].export === true).map((s) => s[1].split(':')[0]);
  for (const name of xt) port(v, 'out', 'xtap:' + name, 'signal', `${name} tap`);
  const sp = t.split, branches = sp ? sp.branches.map((b, i) => ({ ...b, i, taps: (b.chain || []).map((s, k) => (s[0] === 'tap' && typeof s[1] === 'string' ? { name: s[1].split(':')[0], k } : null)).filter(Boolean) })) : [];
  const refused = P.refused.filter((r) => r.to && r.to.lane === L.id);
  const folded = P.fold.has(t.name);
  v.lane = { id: L.id, name: t.name, tags: L.tags, split: sp ? { site: sp.site, branches, merge: sp.merge, mix: sp.mix, pre: sp.pre } : null, folded, refused, ret: t.ret || null, sends: t.sends || [], xtaps: xt };
  v.sub = 'lane' + (t.ret ? ` · return ${t.ret}` : '') + (sp ? ` · split ${branches.length}` : '') + (t.muted ? ' · muted' : '');
  v.extraH = laneH(v.lane);
  v.body = (top) => `<div class="gl-card" style="top:${top}px">${laneHtml(v.lane)}</div>`;
}
// voice hint (LANES 9): one cycle of the lane, compiled by the engine on its own; source voices + readers vs what .layer would build
function voicesHtml(l) {
  const v = V[l.name], ok = v && X && v.key === X.text(), n = l.split.branches.length;
  const res = ok ? `<span class="gl-vres" role="status"><b>${v.src} + ${v.rd}</b> = ${v.src + v.rd} voices / cycle<br><span class="gl-why">.layer: ${v.src * n} (${v.src} × ${n})</span></span>` : '<span class="gl-vres gl-why" role="status">source + readers vs .layer, per cycle</span>';
  return `<div class="gl-voices"><button type="button" class="gl-b gl-vc" data-act="gl-voices" data-lane="${esc(l.name)}" aria-label="${esc(`Count the voices of ${l.name} for one cycle (compiles the lane; stops playback)`)}">Voices</button>${res}</div>`;
}
export async function countVoices(lane) {
  const T = sc.transport; if (!T || !T.compileCode) return X.refuse('The engine is not available here');
  const text = X.text(), body = topLevel(text), st = body && body.find((s) => s.type === 'LabeledStatement' && s.label.name === lane); if (!st) return X.refuse(`No lane ${lane} in the program`);
  const L = P.lanes.find((x) => x.name === lane), n = L && L.t.split ? L.t.split.branches.length : 0; if (!n) return X.refuse(`${lane} has no split`);
  if (T.playing && !(await sc.ui.askYesNo({ title: 'Count voices', message: `Counting compiles ${lane} on its own and stops playback. Stop and count?`, okText: 'Stop and count' }))) return null;
  X.say(`Counting the voices of ${lane}…`);
  let haps; try { const info = await T.compileCode(text.slice(st.start, st.end)); haps = info.pattern.queryArc(0, 1).filter((h) => h.hasOnset()); } catch (e) { X.refuse(`${lane} did not compile: ${e.message}`); return null; }
  const rd = haps.filter((h) => h.value && h.value.s === 'bus').length, src = haps.length - rd;
  V[lane] = { key: text, src, rd, branches: n, layer: src * n }; X.rerender(); X.say(`${lane}: ${src} source + ${rd} reader voices per cycle; .layer would build ${src * n}`);
  return V[lane];
}
function laneH(l) {
  let h = l.tags.length * TAGH;
  if (l.split) { h += ROWH; if (!l.folded) h += l.split.branches.reduce((s, b) => s + ROWH + b.taps.length * ROWH, 0) + 36 + ROWH; }
  h += l.refused.length * ROWH;
  return h ? h + PAD : 0;
}
const tagHtml = (tag, where) => {
  const s = P.state[tag] || {};
  const b = (op, on) => `<button type="button" class="gl-b gl-tg gl-${op}" data-act="gl-tag" data-tag="${esc(tag)}" data-op="${op}" aria-pressed="${!!on}" aria-label="${esc(`${op === 'mute' ? 'Mute' : 'Solo'} every lane tagged ${tag}${on ? ' (on: tap to remove the statement)' : ''}`)}"><i aria-hidden="true">${on ? '■' : '□'}</i>${on ? (op === 'mute' ? 'Muted' : 'Solo on') : (op === 'mute' ? 'Mute' : 'Solo')}</button>`;
  return `<div class="gl-tag" role="group" aria-label="${esc(`Tag ${tag}${s.mute ? ', muted' : ''}${s.solo ? ', soloed' : ''}${where ? ' on ' + where : ''}`)}"><span class="gl-tn">#${esc(tag)}</span>${b('mute', s.mute)}${b('solo', s.solo)}</div>`;
};
function chainText(b) { if (b.chain === null) return b.src; return b.chain.length ? b.chain.map((s) => '.' + s[0]).join('') : 'pass-through'; }
function laneHtml(l) {
  let html = l.tags.map((t) => tagHtml(t, l.name)).join('');
  if (l.split) {
    const sp = l.split, n = sp.branches.length;
    html += `<div class="gl-fhead"><button type="button" class="gl-b gl-fold" data-act="gl-fold" data-lane="${esc(l.name)}" aria-expanded="${!l.folded}" aria-label="${esc(`${l.folded ? 'Expand' : 'Collapse'} the split fan of ${l.name} (${n} branches); the card keeps its ports`)}"><i aria-hidden="true">${l.folded ? '▸' : '▾'}</i>split · ${n}</button>`
      + `<button type="button" class="gl-b gl-addb" data-act="gl-addb" data-lane="${esc(l.name)}" aria-label="${esc(`Add a branch to the split of ${l.name}`)}">+ Branch</button></div>`;
    if (!l.folded) {
      let y = 0; const rows = []; let body = '';
      for (const b of sp.branches) {
        rows.push(y + 22);
        body += `<li style="height:${ROWH}px"><button type="button" class="gl-b gl-bb" data-act="gl-branch" data-lane="${esc(l.name)}" data-i="${b.i}" aria-label="${esc(`Branch ${b.i + 1} of ${l.name}: ${b.param || 'branch'} ${chainText(b)}`)}"><b>${esc(b.param || 'b' + (b.i + 1))}</b><code>${esc(chainText(b))}</code></button></li>`;
        y += ROWH;
        for (const tp of b.taps) {
          body += `<li style="height:${ROWH}px" class="gl-ltrow"><button type="button" class="gp gp-out gt-signal gl-ltap" data-node="track:${esc(l.name)}" data-port="ltap:${esc(tp.name)}" data-dir="out" data-type="signal" aria-label="${esc(`${l.name} branch ${b.i + 1} local tap ${tp.name}: usable only inside this branch`)}"><span class="gp-l">${esc(tp.name)}</span><span class="gl-loc">local</span><i class="gp-dot" aria-hidden="true"></i></button></li>`;
          y += ROWH;
        }
      }
      const H = y, top = rows[0], bot = rows[rows.length - 1];
      const bar = (d) => `<path class="gw gw-audio" d="${d}"/><path class="gw-audio-in" d="${d}"/>`;
      const svg = `<svg class="gl-fsvg" width="200" height="${H}" viewBox="0 0 200 ${H}" aria-hidden="true">${bar(`M8 0V${bot}`)}${rows.map((r) => bar(`M8 ${r}H22`)).join('')}${rows.map((r) => bar(`M180 ${r}H192`)).join('')}${bar(`M192 ${top}V${bot + 14}`)}</svg>`;
      const join = sp.merge && sp.merge !== true ? `merge ${esc(chainText(sp.merge))}` : sp.merge ? 'merge (sum bus)' : 'Σ sum at the orbit';
      html += `<div class="gl-fan" style="height:${H + 36}px">${svg}<ol class="gl-br" aria-label="${esc(`Split fan of ${l.name}: one audio input, ${n} branches`)}">${body}</ol><p class="gl-join" style="top:${H}px">${join}${sp.mix ? ` · mix ${esc(sp.mix.join(' / '))}` : ''}${sp.pre ? ' · pre' : ''}</p></div>`
        + voicesHtml(l);
    }
  }
  html += l.refused.map((r, i) => `<button type="button" class="gl-b gl-ref" data-act="gl-refused" data-i="${P.refused.indexOf(r)}" aria-label="${esc(r.message + '. Open the fixes.')}"><b>E_LANE_CROSS</b> ${esc(`refused: ${r.from.lane} tap read`)}</button>`).join('');
  return html;
}

function busNode(v) {
  port(v, 'in', 'in', 'audio', 'sends'); port(v, 'out', 'out', 'audio', 'returns');
  const b = v.raw; v.bus = { name: b.name, sends: (b.sends || []).map((s) => { const L = laneById(s.lane); return { ...s, own: !!(L && (L.t.sends || []).some((x) => x.bus === b.name)) }; }), returns: b.returns || [] };
  v.sub = `bus · ${v.bus.sends.length} send${v.bus.sends.length === 1 ? '' : 's'} · ${v.bus.returns.length} ret`;
  v.extraH = v.bus.sends.length * ROWH + 44 + 40 + PAD;
  v.body = (top) => `<div class="gl-card" style="top:${top}px">${busHtml(v.bus)}</div>`;
  P.buses.push(v.bus);
}
const selName = (id) => { const s = (P.model.selections || []).find((x) => x.id === id); return s ? `tagged("${strOf(s.selector)}")` : id; };
function busHtml(b) {
  const rows = b.sends.map((s) => `<label class="gl-send"><span class="gl-sl"><b>${esc(s.lane)}</b>${s.own || s.via ? `<em>${s.own ? 'own .send' : ''}${s.own && s.via ? ' + ' : ''}${s.via ? 'via ' + esc(s.via.map(selName).join(', ')) : ''}</em>` : ''}</span><input class="gl-amt" type="number" inputmode="decimal" min="0" max="1" step="0.05" value="${esc(fmt(s.amount))}" data-bus="${esc(b.name)}" data-lane="${esc(s.lane)}" aria-label="${esc(`Send amount from ${s.lane} to bus ${b.name}, 0 to 1${s.own ? ', its own .send' : s.via ? ', set by ' + s.via.map(selName).join(', ') : ''}`)}"></label>`).join('');
  return rows + `<p class="gl-ret"><b>Returns</b> ${b.returns.length ? esc(b.returns.join(', ')) : '<i>none: add a lane that starts with ret("' + esc(b.name) + '")</i>'}</p>`
    + `<p class="gl-coming">${b.returns.length ? 'plays through its returns' : 'silent until a ret lane reads it (W_BUS_NO_RETURN)'}</p>`;
}
function selNode(v) {
  const r = v.raw; v.sel = { id: r.id.replace(/^selection:/, ''), selector: r.selector, ops: r.ops || [], matches: r.matches || [], gate: r.gate, error: r.error };
  v.sub = 'selection · ' + (v.sel.ops.join(' ') || 'no op'); if (r.error) v.err = 'E_BAD_SELECTOR: ' + r.error;
  v.label = `tagged("${r.selector}")`;
  v.extraH = 44 + 44 + 52 + PAD;
  v.body = (top) => `<div class="gl-card" style="top:${top}px">${selHtml(v.sel)}</div>`;
  P.selections.push(v.sel);
}
const selHtml = (s) => `<p class="gl-ops"><code>${esc(s.ops.map((o) => '.' + o + '()').join(''))}</code>${s.gate !== undefined ? ` <span class="gl-win">${esc(typeof s.gate === 'string' ? s.gate : JSON.stringify(s.gate))}</span>` : ''}</p>`
  + `<p class="gl-match"><b>Matches</b> ${s.matches.length ? esc(s.matches.join(', ')) : '<i>no lane</i>'}</p>`
  + `<button type="button" class="gl-b gl-pad" disabled aria-disabled="true" title="${esc(COMING.pad)}">Send to pad <span class="gl-soon">coming</span></button>`;

function capNode(v) {
  const r = v.raw;
  for (const p of (r.ports && r.ports.out) || []) port(v, 'out', p.name, p.type);
  const order = ((r.ports && r.ports.out) || []).map((p) => p.name); v.outs.sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name)); // ev, audio, level as recorded
  const win = r.window !== undefined ? (typeof r.window === 'string' ? r.window : JSON.stringify(r.window)) : null;
  const picker = r.tap || strOf(r.selector) || String(r.selector || '');
  v.cap = { name: r.name, picker, kind: r.tap ? 'tap' : /^bus:/.test(picker) ? 'bus' : picker === 'master' ? 'master' : 'selector', error: r.error || null, matches: r.matches || [], what: r.what || [], window: win, last: r.last, live: r.live, state: capState(r.name, r.last !== undefined), sample: capSample(r.name) };
  v.sub = 'capture · ' + v.cap.what.join(' ');
  if (r.error && v.cap.kind !== 'bus') v.err = 'E_BAD_SELECTOR: ' + r.error; // bus:<name> is a capture picker (LANES 6.1), not a selector
  v.extraH = 44 + (win !== null || r.last !== undefined ? 2 * ROWH : 0) + 44 + 3 * ROWH + (v.cap.sample ? ROWH : 0) + PAD;
  v.body = (top) => `<div class="gl-card" style="top:${top}px">${capHtml(v.cap)}</div>`;
  P.captures.push(v.cap);
}
// a capture's state comes from the capture runtime (#76, loaded with the first program that names capture / recall / .from); before that every capture is empty
// Two readings on top of the runtime word (LANES 6.2): a window capture whose audio was rendered (Bounce / Use as sample) is fixed, so "frozen"; and while
// the transport plays, a live window capture reads from the play position: empty before From, recording until Until, then the runtime's word. The runtime
// alone would say "frozen" at once, because look-ahead queries of the visuals reach Until first (the recall timing itself is right; bug #87).
const ST = { empty: 'Empty', recording: 'Recording', frozen: 'Frozen' };
function capPos() { try { const T = sc.transport; return T && T.playing ? sc.engineState().scheduler.now() : null; } catch (e) { return null; } }
function capState(name, rolling) {
  const rt = sc.lanes && typeof sc.lanes.captureState === 'function' ? sc.lanes.captureState(name) : null; let st = ['empty', 'recording', 'frozen'].includes(rt) ? rt : 'empty';
  const C = sc.lanesCapture, d = C && C.defs && C.defs().find((x) => x.name === name);
  if (!rolling && st === 'empty' && C && C.audio && C.audio(name)) st = 'frozen';
  if (!rolling && d && d.from != null && d.until != null) {
    const now = capPos(), an = C.analyze && C.analyze(), cc = an && an.captures.find((x) => x.name === name), live = d.live === true || (d.live !== false && cc && !cc.pure);
    if (now != null && live) st = now < d.from ? 'empty' : now < d.until ? 'recording' : st;
  }
  return st;
}
function stateWhy(c) {
  const roll = c.last !== undefined, busy = BUSY && BUSY.name === c.name ? BUSY : null;
  return busy ? `${busy.verb}…` : c.state === 'empty' ? (c.window !== null ? `fills during ${c.window}, frozen after` : roll ? 'rolling: fills once it has run' : 'nothing captured yet')
    : c.state === 'recording' ? (roll ? `rolling: always the last ${c.last}` : `window ${c.window} is open`) : roll ? 'held by a journaled freeze' : `holds ${c.window}`;
}
// the state word follows playback: a light poll updates the words in place (no re-render, focus stays), only while capture nodes are shown
function capTick() {
  if (!X || !P.on || !P.captures.length || document.hidden) return;
  for (const c of P.captures) {
    const st = capState(c.name, c.last !== undefined); if (st === c.state) continue; c.state = st;
    for (const el of X.root().querySelectorAll(`.gl-state[data-cap="${CSS.escape(c.name)}"]`)) { el.dataset.state = st; el.querySelector('b').textContent = ST[st]; el.querySelector('.gl-why').textContent = stateWhy(c); }
  }
}
// the registered sample of a capture (Use as sample ran): read from the runtime's audio store, never kept here
function capSample(name) { const C = sc.lanesCapture, e = C && C.audio && C.audio(name); return e && e.registered ? { sound: 'cap_' + name, cycles: +(e.frames / e.sr * e.cps).toFixed(3) } : null; }
// why a capture action cannot run (null: it can); `coming` marks what the capture runtime has not built yet (LANES 11e)
function capWhy(c, a) {
  if (BUSY) return { why: BUSY.name === c.name && BUSY.act === a ? 'running…' : `waiting: ${BUSY.verb.toLowerCase()} ${BUSY.name}` };
  if (a === 'freeze' || a === 'thaw') return c.last === undefined ? { why: 'a window capture holds itself after Until' } : null;
  if (c.kind === 'bus') return { why: 'audio of a bus: capture', coming: true }; // the graph data reads bus:<name> as a bad selector; the runtime parses it
  if (c.error) return { why: 'fix the picker in Code first' };
  if (c.kind === 'tap') return { why: 'a tap capture records events only' };
  if (!c.what.includes('audio')) return { why: 'records no audio: add "audio" to what' };
  if (c.last !== undefined) return { why: 'audio of a rolling capture', coming: true };
  if (a === 'sample' && X && X.readonly()) return { why: 'read-only here' };
  return null;
}
const CACT = { bounce: ['Bounce to takes', 'Bouncing', 'renders the window, adds a take to Record'], freeze: ['Freeze', 'Freezing', 'holds the rolling content from a cycle'], thaw: ['Thaw', 'Thawing', 'follows the rolling window again'], sample: ['Use as sample', 'Rendering', 'registers cap_<name>, inserts a .from lane'] };
const winParts = (w) => { const m = /^(.*?)\.\.(.*)$/.exec(w || ''); return m ? [m[1], m[2]] : [w || '', '']; };
function capHtml(c) {
  const step = (field, which, label) => `<button type="button" class="gl-b gl-step" data-act="gl-win" data-cap="${esc(c.name)}" data-field="${field}" data-d="${which}" aria-label="${esc(`${label} ${which < 0 ? 'one bar earlier' : 'one bar later'}`)}">${which < 0 ? '−' : '+'}</button>`;
  const fld = (field, label, val) => `<div class="gl-wf"><span class="gl-wl">${label}</span>${step(field, -1, `${c.name} ${label}`)}<input class="gl-wi" value="${esc(val)}" data-cap="${esc(c.name)}" data-field="${field}" aria-label="${esc(`${c.name} window ${label} (bars, for example 3b)`)}" autocapitalize="off" spellcheck="false">${step(field, 1, `${c.name} ${label}`)}</div>`;
  let win = '';
  if (c.window !== null) { const [a, b] = winParts(c.window); win = fld('from', 'From', a) + fld('until', 'Until', b); }
  else if (c.last !== undefined) win = fld('last', 'Last', String(c.last)) + '<p class="gl-why">rolling: always the bars before now</p>';
  const roll = c.last !== undefined, busy = BUSY && BUSY.name === c.name ? BUSY : null, why = stateWhy(c);
  const act = (a) => {
    const [label, verb, info] = CACT[a], w = capWhy(c, a), run = busy && busy.act === a, sub = w ? w.why : info.replace('<name>', c.name);
    return `<button type="button" class="gl-b gl-cact" data-act="gl-cap" data-op="${a}" data-cap="${esc(c.name)}"${w ? ' aria-disabled="true"' : ''}${run ? ' aria-busy="true"' : ''}`
      + ` aria-label="${esc(`${label} ${c.name}: ${sub}${w && w.coming ? ' (coming)' : ''}`)}"><span class="gl-cl">${run ? `<i aria-hidden="true">■</i>${verb}…` : label}${w && w.coming ? ' <span class="gl-soon">coming</span>' : ''}</span><span class="gl-why">${esc(sub)}</span></button>`;
  };
  const smp = c.sample ? `<p class="gl-smp"><span class="gl-sn"><b>Sample</b> <code>${esc(c.sample.sound)}</code> <span class="gl-why">${fmt(c.sample.cycles)} c</span></span><button type="button" class="gl-b gl-copy" data-act="gl-cap-copy" data-cap="${esc(c.name)}" aria-label="${esc(`Copy the sample name ${c.sample.sound}`)}">Copy</button></p>` : '';
  return `<p class="gl-pick"><span class="gl-chip" title="picker">${esc(c.picker)}</span><span class="gl-match">${c.matches.length ? esc(c.matches.join(', ')) : 'no lane yet'}</span></p>${win}`
    + `<p class="gl-state" data-cap="${esc(c.name)}" data-state="${c.state}"${busy ? ' data-busy="true"' : ''} role="status"><i aria-hidden="true"></i><b>${ST[c.state]}</b> <span class="gl-why">${esc(why)}</span></p>`
    + act('bounce') + act(roll && c.state === 'frozen' ? 'thaw' : 'freeze') + act('sample') + smp;
}

export function after(nodesEl) {
  if (!P.on) return;
  for (const el of nodesEl.querySelectorAll('.gk-track, .gk-bus, .gk-selection, .gk-capture')) {
    const n = X && X.view() && X.view().nmap.get(el.dataset.id); if (!n) continue;
    if (n.lane) { el.classList.add('gl-lane'); if (n.lane.split) el.classList.add('gl-split'); }
  }
}

/* ---------------------------------------------------------------- connection rules (lanes part; graph.js asks first) */
const laneOfNode = (n) => (n && n.lane ? n.lane.id : n && n.kind === 'track' ? (P.lanes.find((l) => l.name === n.label) || {}).id : null);
export function rule(out, inn, on, tn) {
  if (!P.on) return null;
  if (out.port.startsWith('ltap:')) {
    const name = out.port.slice(5);
    if (tn.kind === 'track' && tn.id !== on.id) return { ok: false, reason: `E_LANE_CROSS: tap "${name}" of lane "${on.label}" is local to its split and cannot be used in lane "${tn.label}"`, crossing: { from: `tap:${name}`, to: tn.id } };
    return { ok: false, reason: `Tap ${name} is local to a branch of ${on.label}: inside the branch it is read in Code.` };
  }
  if (on.kind === 'tap' && on.raw && on.raw.local && tn.kind === 'track' && laneOfNode(tn) !== on.raw.lane) return { ok: false, reason: `E_LANE_CROSS: tap "${on.label}" is local to a split of lane "${on.raw.lane}"`, crossing: { from: on.id, to: tn.id } };
  if (out.port.startsWith('xtap:')) {
    const name = out.port.slice(5);
    if (inn.type === 'param' && tn.kind === 'track' && tn.id !== on.id && X.view().nmap.has(`tap:${name}`)) return { ok: true, does: 'wire', out: { node: `tap:${name}`, port: 'env', dir: 'out', type: 'signal' }, inn };
    return { ok: false, reason: `Exported tap ${name} drives a param of another lane (a tap read with a facet and range).` };
  }
  if (out.type === 'audio' || inn.type === 'audio') {
    if (on.kind === 'track' && tn.kind === 'bus' && out.port === 'audio') {
      const lid = laneOfNode(on), dup = (tn.bus.sends || []).some((s) => s.lane === lid && !s.via);
      return dup ? { ok: false, reason: `${on.label} already sends to ${tn.bus.name}: change the amount on the bus node.` } : { ok: true, does: 'send', lanes: true, out, inn };
    }
    if (on.kind === 'bus') return { ok: false, reason: `A return is a lane that starts with ret("${on.bus.name}"): write it in Code.` };
    return { ok: false, reason: 'Audio wires run from a lane’s audio output to a bus (a named send).' };
  }
  return null;
}
export async function connect(r) {
  if (r.does !== 'send') return false;
  const on = X.view().nmap.get(r.out.node), tn = X.view().nmap.get(r.inn.node);
  const a = await sc.ui.ask({ title: `Send ${on.label} to ${tn.bus.name}`, label: 'Send amount, 0 to 1', value: '0.5', okText: 'Add send' });
  if (a == null) { X.say('Send cancelled'); return false; }
  const v = Number(a); if (a.trim() === '' || !Number.isFinite(v) || v < 0 || v > 1) { X.refuse(`"${a}" is not an amount from 0 to 1`); return false; }
  return X.doOps([{ op: 'addSend', track: on.label, bus: tn.bus.name, amount: v }], `${on.label} sends ${v} to ${tn.bus.name}`);
}
// refused crossing: the E_LANE_CROSS text and the two fixes, in the inspector sheet (never a native dialog)
export function crossSheet(c) {
  const cross = c && c.code ? c : checkWire(X.model(), c.from, c.to);
  if (cross.ok) return X.refuse('This wire is allowed.');
  P.cross = cross; const h = X.h;
  X.openSheet('Refused: E_LANE_CROSS', h('div', { class: 'gx-insp gl-cross', role: 'alert' },
    h('p', { class: 'gl-crossmsg' }, cross.message),
    h('p', { class: 'gx-hint' }, 'A split branch is closed: what it publishes stays inside it. Export the tap from the lane (before its split, the same events), or send the lane’s audio to a named bus.'),
    h('div', { class: 'gx-acts' }, h('button', { type: 'button', class: 'ghost', 'data-act': 'close' }, 'Cancel'),
      ...cross.fixes.map((f, i) => h('button', { type: 'button', class: i ? 'ghost gl-fix' : 'gx-ok gl-fix', 'data-act': 'gl-fix', 'data-i': String(i), 'aria-label': `${f.label}: ${f.op.op === 'exportTap' ? `.tap("${f.op.tap}", { export: true }) on ${f.op.track}` : `.send("${f.op.bus}") on ${f.op.track}`}` }, f.label)))), { label: 'Refused wire: E_LANE_CROSS' });
  const first = document.querySelector('.gl-fix'); if (first) first.focus();
  X.say('Refused: ' + cross.message); // the sheet is the live region; no second toast
  return cross;
}
function applyFix(i) {
  const f = P.cross && P.cross.fixes[i]; if (!f) return false;
  const ok = X.doOps([f.op], f.op.op === 'exportTap' ? `${f.op.track} exports tap ${f.op.tap}` : `${f.op.track} sends to bus ${f.op.bus}`);
  if (ok) { X.closeSheet(); sc.ui.toast(f.op.op === 'exportTap' ? `Exported ${f.op.tap} from ${f.op.track}: wire it from the card edge` : `Added .send("${f.op.bus}") to ${f.op.track}: add a ret("${f.op.bus}") lane to hear it`, { kind: 'ok' }); }
  return ok;
}
export function connectItems(n) { // non-pointer path for refused crossings: list them so they can be tried (and fixed) from the keyboard
  if (!P.on || !n.lane || !n.lane.split) return [];
  const h = X.h, out = [];
  for (const b of n.lane.split.branches) for (const tp of b.taps) for (const m of X.view().nodes) if (m.kind === 'track' && m.id !== n.id) for (const p of m.ins.filter((q) => q.type === 'param')) {
    out.push(h('li', {}, h('button', { type: 'button', class: 'ghost', 'data-act': 'gl-try', 'data-from': `tap:${tp.name}`, 'data-to': m.id }, h('b', {}, `${tp.name} (local) → ${m.label} · ${p.label}`), h('span', {}, ' refused: E_LANE_CROSS'))));
  }
  return out;
}

/* ---------------------------------------------------------------- text splices (statements model.js has no op for yet) */
const OPTS = { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
function topLevel(text) { try { return acorn.parse(text, OPTS).body; } catch (e) { return null; } }
function chainOf(e) { const calls = []; let cur = e; while (cur && cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression' && !cur.callee.computed) { calls.unshift(cur); cur = cur.callee.object; } return { root: cur, calls }; }
function taggedStatements(text) {
  const body = topLevel(text); if (!body) return null;
  return body.map((st) => {
    if (st.type !== 'ExpressionStatement') return null; const { root, calls } = chainOf(st.expression);
    if (!root || root.type !== 'CallExpression' || root.callee.type !== 'Identifier' || root.callee.name !== 'tagged' || !calls.length) return null;
    const a = root.arguments[0]; return { st, selector: a && a.type === 'Literal' ? a.value : null, calls, ops: calls.map((c) => c.callee.property.name) };
  }).filter(Boolean);
}
const cut = (text, st) => { let a = st.start, b = st.end; if (text[b] === '\n') b++; else if (a > 0 && text[a - 1] === '\n') a--; return text.slice(0, a) + text.slice(b); };
// a tag chip's mute / solo: adds one `tagged("<tag>").<op>()` statement, or removes it when it is there
export function toggleTag(tag, op) {
  if (X.readonly()) return X.refuse('Read-only here');
  const text = X.text(), list = taggedStatements(text); if (!list) return X.refuse('The program does not parse: fix it in Code first');
  const hit = list.find((s) => s.selector === tag && s.ops.length === 1 && s.ops[0] === op && !s.calls[0].arguments.length);
  const next = hit ? cut(text, hit.st) : text + (text && !text.endsWith('\n') ? '\n' : '') + `tagged(${JSON.stringify(tag)}).${op}()\n`;
  const ok = X.commit(next, hit ? `Removed tagged("${tag}").${op}()` : `Added tagged("${tag}").${op}()`);
  if (ok) sc.ui.toast(hit ? `${tag}: ${op} off` : `${tag}: ${op === 'mute' ? 'muted' : 'soloed'} from the next cycle`, { kind: 'ok', ms: 1800 });
  return ok;
}
// one send amount: a lane's own .send(bus, x) goes through applyOp literal; a selection's group send is that statement's argument
export function setAmount(bus, laneId, v) {
  if (!Number.isFinite(v) || v < 0 || v > 1) return X.refuse(`A send amount is 0 to 1 (got ${v})`);
  const b = P.buses.find((x) => x.name === bus), s = b && b.sends.find((x) => x.lane === laneId); if (!s) return X.refuse(`${laneId} does not send to ${bus}`);
  const L = laneById(laneId), t = L && L.t, own = t && (t.chain || []).findIndex((c) => c[0] === 'send' && strOf(c[1]) === bus);
  if (own >= 0) { // the lane's own .send wins over a group send (graph data merges both into one entry)
    const step = t.chain[own];
    return X.doOps(step.length > 2 ? [{ op: 'literal', track: t.name, step: own, arg: 1, value: v }] : [{ op: 'removeStep', track: t.name, index: own }, { op: 'insertStep', track: t.name, index: own, step: ['send', step[1], v] }], `${t.name} → ${bus} = ${v}`);
  }
  const sel = (P.model.selections || []).find((x) => s.via && x.id === s.via[0]); if (!sel) return X.refuse('That send is not editable here: edit it in Code');
  const sig = (x) => `${strOf(x.selector)}|${(x.ops || []).map((o) => o.op).join('.')}`, nth = (P.model.selections || []).filter((x, i, a) => a.indexOf(sel) > i && sig(x) === sig(sel)).length;
  const text = X.text(), hit = (taggedStatements(text) || []).filter((x) => `${x.selector}|${x.ops.join('.')}` === sig(sel))[nth]; if (!hit) return X.refuse('The selection statement moved: edit it in Code');
  const call = hit.calls.find((c) => c.callee.property.name === 'send' && c.arguments[0] && c.arguments[0].value === bus); if (!call) return X.refuse('No .send there');
  const a = call.arguments;
  const next = a[1] ? text.slice(0, a[1].start) + fmt(v) + text.slice(a[1].end) : text.slice(0, a[0].end) + ', ' + fmt(v) + text.slice(a[0].end);
  return X.commit(next, `tagged("${strOf(sel.selector)}").send("${bus}") = ${v} (${s.via.length ? 'every match' : laneId})`);
}
// capture window / rolling length: the literal inside that capture(...) statement
function barStep(v, d) { const m = /^(\d+(?:\.\d+)?)b$/.exec(String(v).trim()); if (m) return Math.max(1, +m[1] + d) + 'b'; const c = /^(\d+(?:\.\d+)?)$/.exec(String(v).trim()); if (c) return String(Math.max(0, +c[1] + d)); return v ? null : '1b'; }
export function setWindow(name, field, value) {
  if (X.readonly()) return X.refuse('Read-only here');
  const text = X.text(), body = topLevel(text); if (!body) return X.refuse('The program does not parse');
  const st = body.find((s) => s.type === 'ExpressionStatement' && s.expression.type === 'CallExpression' && s.expression.callee.name === 'capture' && s.expression.arguments[0] && s.expression.arguments[0].value === name);
  const o = st && st.expression.arguments[2]; const key = field === 'last' ? 'last' : 'window';
  const p = o && o.type === 'ObjectExpression' && o.properties.find((q) => q.key && (q.key.name === key || q.key.value === key));
  if (!p || p.value.type !== 'Literal' || typeof p.value.value !== 'string') return X.refuse(`capture("${name}") has no plain ${key} string: edit it in Code`);
  let nv = value;
  if (key === 'window') { const [a, b] = winParts(p.value.value); nv = field === 'from' ? `${value}..${b}` : `${a}..${value}`; }
  if (!/^[\w.+-]+(\.\.[\w.+-]+)?$/.test(nv)) return X.refuse(`"${nv}" is not a window (for example 1b..3b)`);
  return X.commit(text.slice(0, p.value.start) + JSON.stringify(nv) + text.slice(p.value.end), `capture ${name} ${key} = ${nv}`);
}
async function addBranch(lane) {
  const fn = await sc.ui.ask({ title: `Add a branch to ${lane}`, label: 'Branch: effects on the lane audio, for example b => b.room(0.5)', value: 'b => b.room(0.5)', okText: 'Add branch' });
  if (fn == null) return X.say('Cancelled');
  return X.doOps([{ op: 'addBranch', track: lane, fn: fn.trim() }], `Added a branch to ${lane}`);
}
function fold(lane, on) { if (on === undefined) on = !P.fold.has(lane); if (on) P.fold.add(lane); else P.fold.delete(lane); store.set(FOLD, [...P.fold]); X.rerender(); return on; }

/* ---------------------------------------------------------------- capture node actions (capture runtime #76, public entry points only) */
const cerr = (c, m) => Object.assign(new Error(`${c}: ${m}`), { code: c });
const capOf = (name) => P.captures.find((c) => c.name === name);
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const STOP_TAIL_MS = 1500; // longest voice tail we wait for after stopping playback (notes of one cycle at 1 cps plus release)
// the program as the capture runtime sees it: compile the graph's text (that loads capture / recall and defines the captures); stops playback, so ask first
async function prime(name, verb) {
  const T = sc.transport; if (!T || !T.compileCode) throw cerr('E_CAPTURE_HOST', 'the engine is not available on this page');
  if (T.playing && !(await sc.ui.askYesNo({ title: `${verb} ${name}`, message: `${verb} compiles this program and renders the capture offline, which stops playback. Stop and continue?`, okText: 'Stop and continue' }))) return null;
  if (T.playing) { // let the realtime voices end before the offline render swaps the audio context (a voice ending mid-swap throws in superdough, bug #88)
    T.stop(); toast('Stopped playback; letting the voices ring out before the offline render…', { kind: 'info', ms: 2000 }); await new Promise((r) => setTimeout(r, STOP_TAIL_MS));
  }
  const text = X.text(); await T.compileCode(text);
  const C = sc.lanesCapture; if (!C || !C.host) throw cerr('E_CAPTURE_HOST', 'the capture runtime did not load');
  if (!C.defs().some((d) => d.name === name)) throw cerr('E_BAD_ARG', `capture "${name}" is not in the evaluated program`);
  return { C, text };
}
// one action at a time; progress in the node (busy word, no animation) and in toasts; any failure is a toast naming the reason
async function runCap(name, act, fn) {
  const c = capOf(name); if (!c) return X.refuse(`No capture ${name} in the program`);
  const w = capWhy(c, act); if (w) return X.refuse(`${CACT[act][0]} ${name}: ${w.why}${w.coming ? ' (coming)' : ''}`);
  const back = focusKey(); BUSY = { name, act, verb: CACT[act][1] }; X.rerender(); refocus(back); X.say(`${CACT[act][1]} ${name}…`);
  try { return await fn(c); } catch (e) { X.refuse(`${CACT[act][0]} ${name} failed: ${(e && e.message) || e}`); return null; } finally { BUSY = null; X.rerender(); refocus(back); }
}
// keep keyboard focus on the same control across the re-render an action causes (canvas, inspector or outline)
let lastFocus = null;
function focusKey() { const a = document.activeElement; return a && a.dataset && a.dataset.cap ? { sel: `[data-act="${a.dataset.act}"][data-cap="${CSS.escape(a.dataset.cap)}"]`, outline: !!a.closest('.gx-outline') } : lastFocus; }
function refocus(k) { lastFocus = k; if (!k) return; const el = [...X.root().querySelectorAll(k.sel)].find((e) => !!e.closest('.gx-outline') === k.outline && e.getClientRects().length); if (el && document.activeElement !== el && !document.querySelector('dialog[open]')) el.focus({ preventScroll: true }); }
export function bounce(name) {
  return runCap(name, 'bounce', async (c) => {
    const pr = await prime(name, 'Bounce'); if (!pr) return null;
    toast(`Bouncing ${name}: rendering ${c.window} offline…`, { kind: 'info', ms: 4000 });
    const rec = await pr.C.host.bounce(name, pr.text);
    const take = (rec && rec.name) || 'capture ' + name;
    toast(`Bounced ${name}: take "${take}" is in the Record list (open it)`, { kind: 'ok', ms: 7000, onClick: () => sc.capture && sc.capture.open && sc.capture.open() });
    X.say(`Bounced ${name} into the takes list as "${take}"`); return rec;
  });
}
// Freeze / Thaw of a rolling capture at a cycle: journaled (Remake replays it); no program text changes
export function freeze(name, at) { return freezeOp(name, 'freeze', at); }
export function thaw(name, at) { return freezeOp(name, 'thaw', at); }
const cycOf = (c) => { const [n, q] = String(c).split('/'); return +n / (q ? +q : 1); };
function freezeOp(name, op, at) {
  return runCap(name, op, async (c) => {
    let C = sc.lanesCapture; if (!C || !C.defs().some((d) => d.name === name)) { const pr = await prime(name, CACT[op][0]); if (!pr) return null; C = pr.C; }
    const d = C.defs().find((x) => x.name === name), J = (sc.hooks && sc.hooks.journal) || [];
    const lastF = J.filter((e) => e.op === 'freeze' && e.args[0] === name).map((e) => cycOf(e.cycle)).pop();
    let now = null; try { const T = sc.transport; if (T && T.playing) now = Math.ceil(sc.engineState().scheduler.now()); } catch (e) { now = null; }
    const dflt = now != null ? now : op === 'freeze' ? Math.ceil((d.last || 1) + (d.guard || 0) + 1) : Math.ceil((lastF || 0) + (d.last || 1) + (d.guard || 0));
    if (at === undefined) {
      at = await sc.ui.ask({ title: `${CACT[op][0]} ${name}`, message: op === 'freeze' ? `Holds the last ${c.last} of ${name} from that cycle on, until a Thaw. Journaled: Remake replays it.` : `${name} follows its rolling window again from that cycle.`, label: 'At cycle (a number, or a bar such as 3b)', value: String(dflt), okText: CACT[op][0] });
      if (at == null) { X.say('Cancelled'); return null; }
    }
    const v = /^\s*\d+(\.\d+)?\s*$/.test(String(at)) ? +at : String(at).trim();
    C[op](name, v);
    toast(op === 'freeze' ? `${name} frozen from cycle ${v}: its recalls play the held content` : `${name} thawed from cycle ${v}: its recalls follow the window again`, { kind: 'ok', ms: 3500 });
    return { name, op, at: v };
  });
}
// Use as sample: render the capture and register it as cap_<name> (host.resolve), then insert one `.from("<name>")` lane after asking for its name
export async function useAsSample(name, lane) {
  const got = await runCap(name, 'sample', async () => {
    const pr = await prime(name, 'Use as sample'); if (!pr) return null;
    toast(`Rendering ${name} to the sample cap_${name}…`, { kind: 'info', ms: 4000 });
    await pr.C.host.resolve(pr.text);
    const e = pr.C.audio(name); if (!e || !e.registered) throw cerr('E_CAPTURE_HOST', `capture "${name}" gave no audio`);
    const d = pr.C.defs().find((x) => x.name === name);
    return { sound: 'cap_' + name, cycles: d && d.until != null ? +(d.until - d.from).toFixed(3) : +(e.frames / e.sr * e.cps).toFixed(3), frames: e.frames, sr: e.sr };
  });
  if (!got) return got;
  return { ...got, lane: await insertSample(name, got.cycles, lane) };
}
async function insertSample(name, cycles, lane) {
  const used = new Set(P.lanes.map((l) => l.name)); const base = (name.replace(/[^\w$]/g, '_').replace(/^(\d)/, '_$1')) + 'Smp'; let def = base; for (let i = 2; used.has(def); i++) def = base + i;
  const line = (ln) => `${ln}: s("x").from(${JSON.stringify(name)})${cycles ? `.loopAt(${fmt(cycles)})` : ''}`;
  if (lane === undefined) {
    toast(`cap_${name} is a sample now (${fmt(cycles)} cycles): use it in any s("...")`, { kind: 'ok', ms: 4000 });
    lane = await sc.ui.ask({ title: `Use cap_${name} as a sample`, message: `Inserts one lane that plays it: ${line(def)}. The sample stays registered either way.`, label: 'Lane name', value: def, okText: 'Insert lane' });
  }
  if (lane == null) { X.say(`cap_${name} is registered; no lane inserted (Copy puts the name on the clipboard)`); return null; }
  lane = String(lane).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(lane)) { X.refuse(`"${lane}" is not a lane name (letters, digits, _)`); return null; }
  if (used.has(lane)) { X.refuse(`There is already a lane ${lane}`); return null; }
  const text = X.text(), next = text + (text && !text.endsWith('\n') ? '\n' : '') + line(lane) + '\n';
  if (!X.commit(next, `Added lane ${lane}: .from("${name}")`)) return null;
  toast(`Lane ${lane} plays cap_${name} (Undo removes it)`, { kind: 'ok', ms: 3500 }); return lane;
}
async function copySample(name) {
  const t = 'cap_' + name;
  try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* no clipboard */ } ta.remove(); }
  toast(`Copied ${t}`, { kind: 'ok', ms: 1800 }); X.say(`Copied ${t}`); return t;
}

/* ---------------------------------------------------------------- inspector and outline (every action without a pointer) */
export function inspect(n) {
  if (!P.on) return [];
  const h = X.h, wrap = (html, cls) => { const d = h('div', { class: 'gl-insp ' + cls }); d.innerHTML = html; return d; };
  if (n.lane) {
    const kids = [];
    if (n.lane.tags.length) kids.push(h('h4', { class: 'ax-h' }, 'Tags'), wrap(n.lane.tags.map((t) => tagHtml(t, n.lane.name)).join(''), 'gl-tags'));
    if (n.lane.split) kids.push(h('h4', { class: 'ax-h' }, `Split (${n.lane.split.branches.length} branches)`), wrap(n.lane.split.branches.map((b) => `<p class="gl-bline"><b>${esc(b.param || 'b' + (b.i + 1))}</b> <code>${esc(b.src)}</code></p>`).join('') + `<button type="button" class="gl-b gl-addb" data-act="gl-addb" data-lane="${esc(n.lane.name)}">+ Branch</button>`, 'gl-split'));
    if (n.lane.sends.length) kids.push(h('p', { class: 'gx-hint' }, 'Sends: ' + n.lane.sends.map((s) => `${s.bus} ${fmt(s.amount)}`).join(', ') + ' (amounts on the bus node)'));
    for (const r of n.lane.refused) kids.push(h('button', { type: 'button', class: 'ghost gl-ref', 'data-act': 'gl-refused', 'data-i': String(P.refused.indexOf(r)) }, r.message));
    return kids;
  }
  if (n.bus) return [wrap(busHtml(n.bus), 'gl-bus')];
  if (n.sel) return [wrap(selHtml(n.sel), 'gl-sel')];
  if (n.cap) return [wrap(capHtml(n.cap), 'gl-cap')];
  return [];
}
export function outline() {
  if (!P.on) return [];
  const h = X.h, html = (s, cls) => { const d = h('div', { class: cls }); d.innerHTML = s; return d; }, out = [];
  const f = P.filter, shown = P.lanes.filter((l) => !f || l.tags.includes(f));
  out.push(h('h3', { class: 'gx-oh', id: 'glLanesH' }, `Lanes (${shown.length}${f ? ' of ' + P.lanes.length : ''})`));
  if (P.tags.length) out.push(h('div', { class: 'gl-filter', role: 'group', 'aria-label': 'Filter lanes by tag' },
    h('button', { type: 'button', class: 'ghost gl-b gl-fchip', 'data-act': 'gl-filter', 'data-tag': '', 'aria-pressed': String(!f) }, 'All'),
    ...P.tags.map((t) => h('button', { type: 'button', class: 'ghost gl-b gl-fchip', 'data-act': 'gl-filter', 'data-tag': t, 'aria-pressed': String(f === t) }, '#' + t))));
  out.push(h('ul', { class: 'gx-ol gl-ol', 'aria-labelledby': 'glLanesH' }, ...shown.map((l) => h('li', {},
    h('button', { type: 'button', class: 'ghost gx-on', 'data-act': 'select', 'data-node': 'track:' + l.name }, h('b', {}, l.name), h('span', {}, ' ' + (l.tags.length ? l.tags.map((t) => '#' + t).join(' ') : 'no tags') + (l.t.split ? ` · split ${l.t.split.branches.length}` : '') + (l.t.ret ? ` · ret ${l.t.ret}` : ''))),
    h('button', { type: 'button', class: 'ghost', 'data-act': 'connect', 'data-node': 'track:' + l.name, 'aria-label': `Connect ${l.name} to… (sends to a bus)` }, 'Connect to…')))));
  if (P.tags.length) out.push(h('h3', { class: 'gx-oh' }, `Tags (${P.tags.length})`), html(P.tags.map((t) => tagHtml(t, 'every matching lane') + `<button type="button" class="gl-b gl-pad" disabled aria-disabled="true" title="${esc(COMING.pad)}">Send #${esc(t)} to pad <span class="gl-soon">coming</span></button>`).join(''), 'gl-otags'));
  const splits = P.lanes.filter((l) => l.t.split);
  if (splits.length) out.push(h('h3', { class: 'gx-oh' }, `Split fans (${splits.length})`), h('ul', { class: 'gx-ol gl-ol' }, ...splits.map((l) => h('li', { class: 'gl-osplit' },
    h('p', { class: 'gl-bline' }, h('b', {}, `${l.name}: `), `audio in → split → ${l.t.split.branches.length} branches → ${l.t.split.merge ? 'merge' : 'Σ sum'}`),
    ...l.t.split.branches.map((b, i) => h('p', { class: 'gl-bline' }, h('b', {}, `branch ${i + 1} ${b.param || ''}`), ' ', h('code', {}, b.src))),
    h('button', { type: 'button', class: 'ghost gl-b', 'data-act': 'gl-addb', 'data-lane': l.name }, 'Add branch…'),
    h('button', { type: 'button', class: 'ghost gl-b', 'data-act': 'gl-fold', 'data-lane': l.name, 'aria-expanded': String(!P.fold.has(l.name)) }, P.fold.has(l.name) ? 'Expand fan' : 'Collapse fan')))));
  if (P.buses.length) out.push(h('h3', { class: 'gx-oh' }, `Buses (${P.buses.length})`), ...P.buses.map((b) => html(`<p class="gl-bline"><b>bus ${esc(b.name)}</b></p>` + busHtml(b), 'gl-obus')));
  if (P.captures.length) out.push(h('h3', { class: 'gx-oh' }, `Captures (${P.captures.length})`), ...P.captures.map((c) => html(`<p class="gl-bline"><b>capture ${esc(c.name)}</b></p>` + capHtml(c), 'gl-ocap')));
  if (P.refused.length) out.push(h('h3', { class: 'gx-oh' }, `Refused wires (${P.refused.length})`), h('ul', { class: 'gx-ol gl-ol' }, ...P.refused.map((r, i) => h('li', {}, h('button', { type: 'button', class: 'ghost gx-on gl-ref', 'data-act': 'gl-refused', 'data-i': String(i) }, h('b', {}, 'E_LANE_CROSS'), h('span', {}, ` ${r.from.lane} → ${r.to.lane}: fixes`))))));
  return out;
}

/* ---------------------------------------------------------------- wiring into graph.js */
export function install(ctx) {
  X = ctx; const root = ctx.root();
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act^="gl-"]'); if (!b || !root.contains(b) || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'gl-cap': { const c = capOf(d.cap), w = c && capWhy(c, d.op); if (w) return X.refuse(`${CACT[d.op][0]} ${d.cap}: ${w.why}${w.coming ? ' (coming)' : ''}`); lastFocus = focusKey(); return d.op === 'bounce' ? bounce(d.cap) : d.op === 'sample' ? useAsSample(d.cap) : freezeOp(d.cap, d.op); }
      case 'gl-cap-copy': return copySample(d.cap);
      case 'gl-tag': return toggleTag(d.tag, d.op);
      case 'gl-fold': return fold(d.lane);
      case 'gl-addb': return addBranch(d.lane);
      case 'gl-voices': return countVoices(d.lane);
      case 'gl-branch': return X.select('track:' + d.lane);
      case 'gl-refused': return crossSheet(P.refused[+d.i]);
      case 'gl-try': return crossSheet({ from: d.from, to: d.to });
      case 'gl-fix': return applyFix(+d.i);
      case 'gl-filter': P.filter = d.tag || null; X.rerender(); { const nb = root.querySelector(`.gl-fchip[data-tag="${CSS.escape(d.tag)}"]`); if (nb) nb.focus(); } return;
      case 'gl-win': { const inp = b.parentElement.querySelector('.gl-wi'); const nv = barStep(inp.value, +d.d); if (nv == null) return X.refuse(`"${inp.value}" is not a bar (for example 3b)`); return setWindow(d.cap, d.field, nv); }
      default: return undefined;
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('.gl-amt')) setAmount(t.dataset.bus, t.dataset.lane, Number(t.value));
    else if (t.matches('.gl-wi')) setWindow(t.dataset.cap, t.dataset.field, t.value.trim());
  });
  if (!install.tick) install.tick = setInterval(capTick, 400);
  const P2 = sc.palette;
  if (P2 && !install.reg) {
    install.reg = true;
    P2.register({ id: 'lanes.outline', group: 'Lanes', title: 'Lanes: lane list, tags, buses, captures (Graph outline)', run: () => { location.hash = '#graph'; const t = document.getElementById('gxTab-outline'); if (t) { t.click(); const hd = document.getElementById('glLanesH'); if (hd) hd.scrollIntoView({ block: 'start' }); } } });
    P2.register({ id: 'lanes.fold', group: 'Lanes', title: 'Lanes: collapse or expand every split fan', run: () => { const all = P.lanes.filter((l) => l.t.split).map((l) => l.name); const on = all.some((n) => !P.fold.has(n)); all.forEach((n) => (on ? P.fold.add(n) : P.fold.delete(n))); store.set(FOLD, [...P.fold]); X.rerender(); } });
  }
  sc.lanesUI = { countVoices, toggleTag, setAmount, setWindow, addBranch, fold, cross: crossSheet, bounce, freeze, thaw, useAsSample, copySample, state: () => ({ on: P.on, lanes: P.lanes.map((l) => ({ id: l.id, name: l.name, tags: l.tags })), tags: P.tags, chips: P.state, buses: P.buses, captures: P.captures, selections: P.selections, refused: P.refused, folded: [...P.fold] }) };
  return sc.lanesUI;
}
