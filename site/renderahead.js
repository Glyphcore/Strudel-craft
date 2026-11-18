/* Render-ahead buffers (#195): the program is rendered ahead of the playhead into chunked buffers, in the offline render host (capture.js,
   the hidden ?host=render frame: its own Strudel + superdough, the live context is never touched).
   Chunk = 2^k cycles, about 4 s. A chunk's hash is taken from what the program yields for it: the haps of [chunk start - pre-roll, chunk end)
   with their times relative to the chunk start, plus the controls model, cps, sample rate, master level and the seed. So
   - an edit dirties only the chunks whose events changed (the others keep their buffers),
   - identical chunks (a loop) share one render, and an undo finds the old buffers again.
   Programs whose sound depends on things the haps do not carry (hooks gates and chains, ctl / slider automation) hash the program text and the
   absolute chunk index as well: for them every edit dirties every chunk (conservative, never stale).
   Each render starts pre-roll cycles early and the pre-roll is dropped, so tails of earlier notes are in the chunk (chunk_render.py idea).
   Order: from the playhead (the cursor when stopped) forward, until the contiguous ready extent is `lead` seconds ahead. Peaks (min / max per 256
   frames) are kept for every chunk; PCM only for the newest chunks, up to MEM bytes.
   Stems (lane waveforms on the timeline): once the mix chunks of the lead window are ready, each chunk gets one stem per lane (lane = the sound name,
   as on the timeline): the same render with only that lane's haps voiced (capture.renderRange { lane }). A stem's hash covers only its lane's haps,
   so an edit of one lane leaves the other lanes' stems alone. Only the peaks of a stem are kept. A chunk with a single lane uses its mix as the stem.
   This pass does not play from the buffers: play stays live (state().live says whether the chunk under the playhead was ready).
   Lazy: loaded by timeline.js only when the lead is > 0 (audio dot sheet "Render ahead lead", ?ahead=S, localStorage sc.ahead.lead). Off = 0.
   API: window.strudelCraft.ahead = { state, configure({ lead }), replan, view(c0, c1), chunks, reset }. Event in: sc-ahead { lead }. */
const sc = (window.strudelCraft = window.strudelCraft || {});
const PB = 256, SEED = 0x195a11, MEM = 48e6, TICK = 400, MAXLEAD = 120;
const HOSTED = /[?&]host=render\b/.test(location.search);
const A = { lead: 0, on: false, timer: 0, g: '', pat: null, chunkC: 2, pre: 1, cps: 0.5, rel: true, memo: new Map(), idx: new Map(), cache: new Map(), job: null, want: [], leadSec: 0, head: 0,
  err: '', retryAt: 0, dirty: [], leads: [], armed: false, fillMs: null, t0: 0, sig: '',
  n: { renders: 0, stemRenders: 0, reused: 0, invalidated: 0, aborted: 0, errors: 0, audioSec: 0, wallMs: 0, ticks: 0, liveTicks: 0 } };

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const sched = () => { const s = sc.engineState && sc.engineState(); return (s && s.scheduler) || (sc.transport && sc.transport.scheduler) || null; };
const playing = () => !!(sc.transport && sc.transport.playing);
const cpsNow = () => { const s = sched(); return (s && s.cps) || 0.5; };
const playhead = () => { if (playing()) { try { return Math.max(0, sched().now() || 0); } catch (e) { return 0; } } return sc.timeline && sc.timeline.pos ? Math.max(0, sc.timeline.pos() || 0) : 0; };
const ser = (v) => { try { return JSON.stringify(v, (k, x) => (typeof x === 'function' ? 'fn:' + cyrb53(String(x)) : x)); } catch (e) { return String(v); } };
const preOf = (i) => (i === 0 ? 0 : A.pre);

/* the onset haps of whole cycles [a, b), or null when the pattern is not there yet (engine Worker cache still filling) */
function hapsOf(a, b) {
  const s = sched(), pat = s && s.pattern, bg = sc.bg, out = [];
  for (let c = a; c < b; c++) {
    let hs; try { const mh = bg && bg.cycleHaps ? bg.cycleHaps(c) : undefined; if (mh === 'pending') return null; hs = mh || (pat ? pat.queryArc(c, c + 1) : null); } catch (e) { return null; }
    if (!hs) return null; for (const h of hs) if (h.hasOnset && h.hasOnset()) out.push(h);
  }
  return out;
}
const laneOf = (v) => (typeof v === 'object' && v ? String(v.s != null ? v.s : (v.note != null || v.n != null ? 'synth' : 'event')) : 'event');
/* { h: mix hash, ls: [[lane, stem hash], ...] } of chunk i, or null while the pattern is not known */
function hashChunk(i) {
  if (A.memo.has(i)) return A.memo.get(i);
  const c0 = i * A.chunkC, pre = preOf(i), haps = hapsOf(c0 - pre, c0 + A.chunkC); if (!haps) return null;
  const by = new Map(), parts = [], head = A.g + '|' + pre + '|' + (A.rel ? '' : i) + '|';
  for (const h of haps) { const p = (Number(h.whole.begin) - c0).toFixed(5) + ',' + (Number(h.whole.end) - c0).toFixed(5) + ',' + ser(h.value); parts.push(p); const l = laneOf(h.value); if (!by.has(l)) by.set(l, []); by.get(l).push(p); }
  const o = { h: cyrb53(head + parts.join(';')) + '-' + parts.length, ls: [...by].slice(0, 24).map(([l, ps]) => [l, cyrb53(head + l + '|' + ps.join(';')) + '~' + ps.length]) }; A.memo.set(i, o); return o;
}
const hOf = (i) => { const o = A.idx.get(i); return o ? o.h : null; };
const ready = (h) => { const e = h && A.cache.get(h); return !!(e && e.st === 'ready'); };
const canRender = () => { const c = sc.capture; return !!(c && c.renderRange && c.state && !c.state.rendering && c.state.phase === 'idle') && performance.now() >= A.retryAt; };

function globals() {
  const k = cpsNow(), T = sc.transport || {}; let code = '', ctl = '';
  try { const s = T.source && T.source(); code = (s && s.code) || ''; if (sc.atoms && sc.atoms.inline) code = sc.atoms.inline(code); } catch (e) { /* keep */ }
  try { const C = sc.perform && sc.perform.controls; ctl = C ? JSON.stringify(C.toModel()) : ''; } catch (e) { ctl = ''; }
  const rel = !/\bhooks\b|\.hook\(|\.use\(|\bctl\(|\bslider\(/.test(code);
  const sr = (T.bus && T.bus.ctx && T.bus.ctx.sampleRate) || 0;
  return { k, rel, g: [k.toFixed(6), sr, SEED, T.masterDb, cyrb53(ctl), rel ? '' : cyrb53(code)].join('|') };
}

function plan() {
  if (!A.on || HOSTED) return;
  const s = sched(), pat = s && s.pattern; const G = globals(); let changed = false;
  const chunkC = Math.max(1, Math.min(8, 2 ** Math.round(Math.log2(4 * G.k)))), pre = Math.max(1, Math.min(chunkC, Math.round(2 * G.k)));
  if (G.g !== A.g || pat !== A.pat || chunkC !== A.chunkC) {
    /* the program, the controls or the tempo changed: re-hash the known chunks; the ones whose hash moved are dirty */
    const geo = chunkC !== A.chunkC; A.g = G.g; A.pat = pat; A.rel = G.rel; A.cps = G.k; A.chunkC = chunkC; A.pre = pre; A.memo.clear(); const dirty = [];
    if (geo) A.idx.clear();
    for (const [i, old] of [...A.idx]) { const o = hashChunk(i); if (o == null) { A.idx.delete(i); continue; } A.idx.set(i, o); if (o.h === old.h) continue; dirty.push(i); A.n.invalidated++; if (ready(o.h)) A.n.reused++; }
    if (dirty.length) { A.dirty = dirty.sort((a, b) => a - b); } changed = true;
  }
  const t = playhead(), i0 = Math.floor(t / A.chunkC), n = Math.ceil(A.lead * A.cps / A.chunkC) + 1, want = [];
  for (let i = i0; i < i0 + n; i++) { const o = hashChunk(i); if (o == null) break; if (!A.idx.has(i)) { A.idx.set(i, o); if (ready(o.h)) { A.n.reused++; changed = true; } } want.push({ i, h: o.h, o }); }
  A.want = want;
  if (A.idx.size > 400) for (const i of [...A.idx.keys()]) if (i < i0 - 150 || i > i0 + n + 150) A.idx.delete(i);
  let r = i0; while (r < i0 + n && ready(hOf(r))) r++;
  A.head = r * A.chunkC; A.leadSec = Math.max(0, Math.min(A.head - t, n * A.chunkC) / A.cps);
  if (playing()) { A.n.ticks++; if (!ready(hOf(i0))) A.n.liveTicks++; if (!A.armed && A.leadSec >= A.lead * 0.9) { A.armed = true; A.fillMs = Math.round(performance.now() - A.t0); } if (A.armed) { A.leads.push(+A.leadSec.toFixed(2)); if (A.leads.length > 2000) A.leads.splice(0, 1000); } }
  else { A.t0 = performance.now(); }
  if (A.job) { if (!want.some((w) => w.h === A.job.h || w.o.ls.some((l) => l[1] === A.job.h))) { A.job.ac.abort(); } }
  else {
    const nx = want.find((w) => !A.cache.has(w.h));
    if (nx) { if (canRender()) start(nx.i, nx.h, null); }
    else for (const w of want) { /* mix first; then the stems, nearest chunk first */
      const m = A.cache.get(w.h); if (!m || m.st !== 'ready') continue; let go = false;
      for (const [lane, sh] of w.o.ls) { if (A.cache.has(sh)) continue; if (w.o.ls.length === 1) { A.cache.set(sh, m); changed = true; continue; } if (canRender()) start(w.i, sh, lane); go = true; break; }
      if (go) break;
    }
  }
  const sig = A.head + ':' + (A.job ? A.job.h : '') + ':' + A.cache.size; if (sig !== A.sig || changed) { A.sig = sig; sc.timeline && sc.timeline.invalidate(); }
}

function start(i, h, lane) {
  const c0 = i * A.chunkC, pre = preOf(i), k = A.cps, ac = new AbortController(), e = { h, st: 'rendering', at: performance.now(), stem: lane != null }, t0 = performance.now();
  A.cache.set(h, e); A.job = { h, i, ac, lane };
  Promise.resolve().then(() => sc.capture.renderRange(c0 - pre, c0 + A.chunkC, { seed: SEED, signal: ac.signal, cps: k, lane })).then((out) => {
    const f0 = Math.min(out.L.length, Math.round(pre / k * out.sr)), L = out.L.subarray(f0), R = (out.R || out.L).subarray(f0), n = Math.ceil(L.length / PB), lo = new Float32Array(n), hi = new Float32Array(n);
    for (let b = 0; b < n; b++) { let a = 0, z = 0; const i1 = Math.min(L.length, (b + 1) * PB); for (let j = b * PB; j < i1; j++) { const v = (L[j] + R[j]) * 0.5; if (v < a) a = v; if (v > z) z = v; } lo[b] = a; hi[b] = z; }
    Object.assign(e, { st: 'ready', L: lane != null ? null : L, R: lane != null ? null : R, sr: out.sr, frames: L.length, n, lo, hi, fails: out.fails || 0, ms: Math.round(performance.now() - t0), at: performance.now() });
    if (lane != null) A.n.stemRenders++; else { A.n.renders++; A.n.audioSec += L.length / out.sr; A.n.wallMs += performance.now() - t0; } A.err = ''; trim();
  }, (err) => {
    A.cache.delete(h);
    if (err && err.name === 'AbortError') A.n.aborted++; else { A.n.errors++; A.err = (err && err.message) || String(err); A.retryAt = performance.now() + 5000; }
  }).finally(() => { A.job = null; plan(); });
}
/* memory: PCM of the chunks nobody waits for goes first (their peaks stay); the cache itself is capped */
function trim() {
  const wanted = new Set(A.want.map((w) => w.h)), known = new Set(); for (const o of A.idx.values()) { known.add(o.h); for (const l of o.ls) known.add(l[1]); }
  let bytes = 0; const es = [...A.cache.values()].filter((e) => e.st === 'ready').sort((a, b) => b.at - a.at);
  for (const e of es) { if (!e.L) continue; const b = e.frames * 8; if (bytes + b > MEM && !wanted.has(e.h)) { e.L = e.R = null; } else bytes += b; }
  if (A.cache.size > 1600) for (const [h, e] of [...A.cache]) { if (A.cache.size <= 1200) break; if (e.st === 'ready' && !known.has(h)) A.cache.delete(h); }
}
/* the chunks over cycles [c0, c1): { i, c0, c1, st, e (mix: n, lo, hi), stems: { lane: ready stem entry } } */
function view(c0, c1) {
  const out = []; if (!A.on && !A.cache.size) return out;
  for (let i = Math.max(0, Math.floor(c0 / A.chunkC)); i * A.chunkC < c1; i++) { const o = A.idx.get(i), e = o && A.cache.get(o.h); if (!o) continue; let stems = null; for (const [l, sh] of o.ls) { const q = A.cache.get(sh); if (q && q.st === 'ready') (stems = stems || {})[l] = q; } if (e || stems) out.push({ i, c0: i * A.chunkC, c1: (i + 1) * A.chunkC, st: e ? e.st : 'queued', e, stems }); }
  return out;
}
function chunks() { return [...A.idx].sort((a, b) => a[0] - b[0]).map(([i, o]) => { const e = A.cache.get(o.h); return { i, c0: i * A.chunkC, c1: (i + 1) * A.chunkC, hash: o.h, st: e ? e.st : 'queued', ms: e && e.ms, pcm: !!(e && e.L), stems: Object.fromEntries(o.ls.map(([l, sh]) => { const q = A.cache.get(sh); return [l, { hash: sh, st: q ? q.st : 'queued' }]; })) }; }); }
function state() {
  const l = A.leads.slice().sort((a, b) => a - b), cs = chunks(); let pcm = 0; for (const e of A.cache.values()) if (e.L) pcm += e.frames * 8;
  return { on: A.on, lead: A.lead, leadSec: +A.leadSec.toFixed(2), head: A.head, chunkCycles: A.chunkC, chunkSec: +(A.chunkC / A.cps).toFixed(3), preCycles: A.pre, cps: A.cps, relative: A.rel,
    ready: cs.filter((c) => c.st === 'ready').map((c) => c.i), rendering: A.job ? A.job.i : null, renderingLane: A.job ? A.job.lane : null, stemsReady: cs.reduce((a, c) => a + Object.values(c.stems).filter((x) => x.st === 'ready').length, 0), stemsMissing: cs.reduce((a, c) => a + Object.values(c.stems).filter((x) => x.st !== 'ready').length, 0), dirty: A.dirty.slice(), ...A.n,
    speed: A.n.wallMs ? +(A.n.audioSec / (A.n.wallMs / 1000)).toFixed(2) : null, live: !ready(hOf(Math.floor(playhead() / A.chunkC))), liveShare: A.n.ticks ? +(A.n.liveTicks / A.n.ticks).toFixed(3) : null,
    leadMin: l.length ? l[0] : null, leadMedian: l.length ? l[l.length >> 1] : null, leadSamples: l.length, fillMs: A.fillMs, pcmBytes: pcm, cached: A.cache.size, error: A.err };
}
function reset() { A.leads = []; A.armed = false; A.fillMs = null; A.t0 = performance.now(); for (const k of Object.keys(A.n)) A.n[k] = 0; }
function configure(o = {}) {
  if (o.lead != null) { A.lead = Math.max(0, Math.min(MAXLEAD, +o.lead || 0)); if (o.persist !== false) try { localStorage.setItem('sc.ahead.lead', String(A.lead)); } catch (e) { /* private mode */ } }
  A.on = A.lead > 0 && !HOSTED; clearInterval(A.timer); A.timer = 0;
  if (A.on) { A.timer = setInterval(plan, TICK); plan(); } else { if (A.job) A.job.ac.abort(); A.leadSec = 0; sc.timeline && sc.timeline.invalidate(); }
  return state();
}
addEventListener('sc-ahead', (e) => { if (e.detail && e.detail.lead != null && +e.detail.lead !== A.lead) configure({ lead: e.detail.lead }); });
sc.ahead = { state, configure, replan: plan, view, chunks, reset, cyrb53 };
{ let lead = 0; try { const q = new URLSearchParams(location.search).get('ahead'); lead = +(q != null ? q : localStorage.getItem('sc.ahead.lead')) || 0; } catch (e) { lead = 0; } if (lead > 0) configure({ lead, persist: false }); }
