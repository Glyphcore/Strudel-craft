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
   Playback (#199): a ready chunk is played from an AudioBufferSourceNode on the buffer sub-bus (app.js Bus.buf), locked to the scheduler's cycle -> audio time
   mapping; its haps are gated in the clock (bgplay.js makeClock: no voice is triggered, the live sub-bus is silent for that chunk). The live scheduler is the
   fallback for a chunk that is not ready. Joins are 20 ms cross-fades (the chunk's pre-roll supplies the 20 ms before its start). See "playback from the buffers" below.
   Lazy: loaded by timeline.js only when the lead is > 0 (audio dot sheet "Render ahead lead", ?ahead=S, localStorage sc.ahead.lead). Off = 0.
   API: window.strudelCraft.ahead = { drop(i) (test hook, #214: forgets chunk i's render), state, configure({ lead, play }), replan, view(c0, c1), chunks, reset, segments, cut; clock hooks: sync, gate, sounding }.
   Event in: sc-ahead { lead }. Flags: ?ahead=S (lead), ?aheadplay=off|on (localStorage sc.ahead.play). */
const sc = (window.strudelCraft = window.strudelCraft || {});
/* #199: the default is to precompute the whole program: lead DEF_LEAD s, bounded by the program's specified end (capture.resolveEnd); an open-ended program gets OPEN_LEAD s ahead.
   PCM is kept as 16-bit (4 bytes per stereo frame), at most MEM bytes; over the cap the chunks farthest behind the playhead lose their PCM first (their peaks stay). */
const PB = 256, SEED = 0x195a11, MEM = 64e6, TICK = 100, MAXLEAD = 3600, DEF_LEAD = 600, OPEN_LEAD = 32;
const HOSTED = /[?&]host=render\b/.test(location.search);
const A = { lead: 0, on: false, timer: 0, g: '', pat: null, chunkC: 2, pre: 1, cps: 0.5, rel: true, memo: new Map(), idx: new Map(), prev: new Map(), end: null, endAt: 0, cache: new Map(), job: null, want: [], leadSec: 0, head: 0,
  err: '', retryAt: 0, dirty: [], leads: [], armed: false, fillMs: null, t0: 0, sig: '',
  n: { renders: 0, stemRenders: 0, reused: 0, invalidated: 0, aborted: 0, errors: 0, rendersHeld: 0, rendersRefused: 0, audioSec: 0, wallMs: 0, ticks: 0, liveTicks: 0 } };

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
    if (!hs) return null; for (const h of hs) if (h.hasOnset && h.hasOnset()) { out.push(h); if ((h.context && h.context.onTrigger) || (h.value && h.value.analyze != null)) out.ext = true; /* midi / osc / custom outputs, and voices that feed a superdough analyser (_scope, _spectrum): never buffer-played */ }
  }
  return out;
}
const laneOf = (v) => (typeof v === 'object' && v ? String(v.s != null ? v.s : (v.note != null || v.n != null ? 'synth' : 'event')) : 'event');
/* What a chunk is made of, as the render host can report it back: the sorted list of sound and note of every hap. A render is kept only when the events it was made from give the
   same signature as the pattern's chunk (#214): between choosing a recipe (or typing) and its evaluation the transport's code and the scheduler's pattern are two programs, and a
   chunk rendered then would put one program's audio under the other's hash. */
const noteOf = (v) => (v && typeof v === 'object' ? String(v.note != null ? v.note : v.n != null ? v.n : '') : '');
const sigOf = (vals) => cyrb53(vals.map((v) => laneOf(v) + ':' + noteOf(v)).sort().join(','));
/* { h: mix hash, ls: [[lane, stem hash], ...] } of chunk i, or null while the pattern is not known */
function hashChunk(i) {
  if (A.memo.has(i)) return A.memo.get(i);
  const c0 = i * A.chunkC, pre = preOf(i), haps = hapsOf(c0 - pre, c0 + A.chunkC); if (!haps) return null;
  const by = new Map(), parts = [], head = A.g + '|' + pre + '|' + (A.rel ? '' : i) + '|';
  for (const h of haps) { const p = (Number(h.whole.begin) - c0).toFixed(5) + ',' + (Number(h.whole.end) - c0).toFixed(5) + ',' + ser(h.value); parts.push(p); const l = laneOf(h.value); if (!by.has(l)) by.set(l, []); by.get(l).push(p); }
  const o = { ext: !!haps.ext, sig: sigOf(haps.map((h) => h.value)), h: cyrb53(head + parts.join(';')) + '-' + parts.length, ls: [...by].slice(0, 24).map(([l, ps]) => [l, cyrb53(head + l + '|' + ps.join(';')) + '~' + ps.length]) }; A.memo.set(i, o); return o;
}
const hOf = (i) => { const o = A.idx.get(i); return o ? o.h : null; };
const ready = (h) => { const e = h && A.cache.get(h); return !!(e && e.st === 'ready'); };
const canRender = () => { if (A.codeOk === false) { A.n.rendersHeld++; return false; } const c = sc.capture; return !!(c && c.renderRange && c.state && !c.state.rendering && c.state.phase === 'idle') && performance.now() >= A.retryAt; };

function globals() {
  const k = cpsNow(), T = sc.transport || {}; let code = '', ctl = '';
  try { const s = T.source && T.source(); code = (s && s.code) || ''; if (sc.atoms && sc.atoms.inline) code = sc.atoms.inline(code); } catch (e) { /* keep */ }
  try { const C = sc.perform && sc.perform.controls; ctl = C ? JSON.stringify(C.toModel()) : ''; } catch (e) { ctl = ''; }
  const rel = !/\bhooks\b|\.hook\(|\.use\(|\bctl\(|\bslider\(/.test(code);
  const sr = (T.bus && T.bus.ctx && T.bus.ctx.sampleRate) || 0;
  return { k, rel, mdb: T.masterDb, code: cyrb53(code), g: [k.toFixed(6), sr, SEED, T.masterDb, cyrb53(ctl), rel ? '' : cyrb53(code)].join('|') };
}

function plan() {
  if (!A.on || HOSTED) return;
  const s = sched(), pat = s && s.pattern; const G = globals(); let changed = false;
  const chunkC = Math.max(1, Math.min(8, 2 ** Math.round(Math.log2(4 * G.k)))), pre = Math.max(1, Math.min(chunkC, Math.round(2 * G.k)));
  if (G.g !== A.g || pat !== A.pat || chunkC !== A.chunkC) {
    /* the program, the controls or the tempo changed: re-hash the known chunks; the ones whose hash moved are dirty */
    const geo = chunkC !== A.chunkC; if (pat !== A.pat) A.patCode = G.code; /* the code this pattern was evaluated from */ A.g = G.g; A.mdb = G.mdb; A.pat = pat; A.rel = G.rel; A.cps = G.k; A.chunkC = chunkC; A.pre = pre; A.memo.clear(); const dirty = [];
    const keepOld = P.cont && !geo && G.k === A.cps; /* an edit during continuous play: the old buffer of a dirty chunk stays usable until its new render is ready (never across Stop, a recipe switch or a tempo change) */
    if (geo) A.idx.clear(); if (!keepOld) A.prev.clear(); A.endAt = 0;
    for (const [i, old] of [...A.idx]) { const o = hashChunk(i); if (o == null) { A.idx.delete(i); continue; } A.idx.set(i, o); if (o.h === old.h) continue; if (keepOld) { const pe = A.cache.get(old.h); if (pe && pe.st === 'ready' && pe.L) A.prev.set(i, old.h); } dirty.push(i); A.n.invalidated++; if (ready(o.h)) A.n.reused++; }
    if (dirty.length) { A.dirty = dirty.sort((a, b) => a - b); } changed = true; if (geo) releaseAll('chunk size changed'); else checkDecisions(keepOld);
  }
  /* window: `lead` seconds from the playhead, not past the program's specified end (re-read every 2 s); open-ended programs: at most OPEN_LEAD s */
  if (performance.now() > A.endAt) { A.endAt = performance.now() + 2000; let e = null; try { const r = sc.capture && sc.capture.resolveEnd && sc.capture.resolveEnd(); if (r && r.cycle > 0 && r.rule !== 'period') e = +r.cycle; } catch (err) { e = null; } A.end = e; }
  const t = playhead(), i0 = Math.floor(t / A.chunkC), span = A.end != null && A.end > t ? Math.min(A.lead * A.cps, A.end - i0 * A.chunkC) : Math.min(A.lead, OPEN_LEAD) * A.cps, n = Math.max(1, Math.ceil(span / A.chunkC - 1e-9) + (A.end != null && A.end > t ? 0 : 1)), want = [];
  for (let i = i0; i < i0 + n; i++) { const o = hashChunk(i); if (o == null) break; if (!A.idx.has(i)) { A.idx.set(i, o); if (ready(o.h)) { A.n.reused++; changed = true; } } want.push({ i, h: o.h, o }); }
  A.want = want; if (P.S && P.S.started && !P.off && P.S.pattern === A.pat) P.cont = true;
  if (A.idx.size > 400) for (const i of [...A.idx.keys()]) if (i < i0 - 150 || i > i0 + n + 150) A.idx.delete(i);
  let r = i0; while (r < i0 + n && ready(hOf(r))) r++;
  A.head = r * A.chunkC; A.leadSec = Math.max(0, Math.min(A.head - t, n * A.chunkC) / A.cps);
  if (playing()) { A.n.ticks++; if (!ready(hOf(i0))) A.n.liveTicks++; if (!A.armed && A.leadSec >= Math.min(A.lead, (n - 1) * A.chunkC / A.cps) * 0.9) { A.armed = true; A.fillMs = Math.round(performance.now() - A.t0); } if (A.armed) { A.leads.push(+A.leadSec.toFixed(2)); if (A.leads.length > 2000) A.leads.splice(0, 1000); } }
  else { A.t0 = performance.now(); }
  A.codeOk = A.patCode == null || G.code === A.patCode; /* the transport's code is not what the scheduler holds (a recipe was just chosen, text typed but not compiled): no render until it is */
  if (A.job) { if (!want.some((w) => w.h === A.job.h || w.o.ls.some((l) => l[1] === A.job.h))) { A.job.ac.abort(); } }
  else {
    /* #199: while playing, a chunk the playhead is already in (and that plays live) cannot be used any more: the next chunks come first, so a cold start reaches the buffer one chunk in */
    const d0 = P.dec.get(i0), skip = playing() && !ready(hOf(i0)) && !(d0 && d0.mode === 'buf') ? i0 : -1, nx = want.find((w) => !A.cache.has(w.h) && w.i !== skip) || want.find((w) => !A.cache.has(w.h));
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
  const c0 = i * A.chunkC, pre = preOf(i), k = A.cps, ac = new AbortController(), e = { h, st: 'rendering', at: performance.now(), stem: lane != null }, t0 = performance.now(), mdb = A.mdb, sig0 = (A.idx.get(i) || {}).sig;
  A.cache.set(h, e); A.job = { h, i, ac, lane };
  Promise.resolve().then(() => sc.capture.renderRange(c0 - pre, c0 + A.chunkC, { seed: SEED, signal: ac.signal, cps: k, lane, list: true })).then((out) => {
    if (sig0 && out.hapInfo && sigOf(out.hapInfo.map((x) => x.v)) !== sig0) { A.cache.delete(h); A.n.rendersRefused++; A.retryAt = performance.now() + 500; return; } /* made from another program than the pattern's chunk: not kept */
    /* #199: the event list of the chunk comes out of the same pass as its audio (one queryArc over the cycle range, no clock involved); kept for the timeline */
    if (lane == null && out.hapInfo) { const r4 = (x) => Math.round(x * 1e4) / 1e4; e.ev = out.hapInfo.map((x) => { const b = r4(x.t * k - pre), v = x.v, /* cycles relative to the chunk start: identical chunks share one render */ nt = v && typeof v === 'object' ? (v.note != null ? v.note : v.n) : null; return { b, e: r4(b + (x.d || 0) * k), lane: laneOf(v), note: typeof nt === 'number' ? nt : null }; }).filter((x) => x.b >= -1e-6); }
    const f0 = Math.min(out.L.length, Math.round(pre / k * out.sr)), L = out.L.subarray(f0), R = (out.R || out.L).subarray(f0), n = Math.ceil(L.length / PB), lo = new Float32Array(n), hi = new Float32Array(n);
    for (let b = 0; b < n; b++) { let a = 0, z = 0; const i1 = Math.min(L.length, (b + 1) * PB); for (let j = b * PB; j < i1; j++) { const v = (L[j] + R[j]) * 0.5; if (v < a) a = v; if (v > z) z = v; } lo[b] = a; hi[b] = z; }
    if (lane == null) { const hf = Math.min(f0, Math.round(XF * out.sr)); e.hL = out.L.slice(f0 - hf, f0); e.hR = (out.R || out.L).slice(f0 - hf, f0); e.mg = mdb == null ? 1 : mdb <= -60 ? 0 : Math.pow(10, mdb / 20); /* #199: 20 ms of pre-roll for the cross-fade; master gain the render was made at */ }
    Object.assign(e, { st: 'ready', L: lane != null ? null : i16(L), R: lane != null ? null : i16(R), sr: out.sr, frames: L.length, n, lo, hi, fails: out.fails || 0, ms: Math.round(performance.now() - t0), at: performance.now() });
    if (lane != null) A.n.stemRenders++; else { A.n.renders++; A.n.audioSec += L.length / out.sr; A.n.wallMs += performance.now() - t0; } A.err = ''; trim();
  }, (err) => {
    A.cache.delete(h);
    if (err && err.name === 'AbortError') A.n.aborted++; else { A.n.errors++; A.err = (err && err.message) || String(err); A.retryAt = performance.now() + 5000; }
  }).finally(() => { A.job = null; plan(); });
}
/* memory: PCM of the chunks nobody waits for goes first (their peaks stay); the cache itself is capped */
const i16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = f[i] * 32767; o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v); } return o; };
function trim() {
  const known = new Set(); for (const o of A.idx.values()) { known.add(o.h); for (const l of o.ls) known.add(l[1]); }
  /* keep order: what a source is playing or about to play, then the chunks from the playhead forward (nearest first), then the ones behind it (nearest first), then unreferenced renders (newest first) */
  const i0 = Math.floor(playhead() / A.chunkC), rank = new Map(); for (const d of P.dec.values()) if (d.h) rank.set(d.h, -1);
  for (const [i, o] of A.idx) { const r = i >= i0 ? i - i0 : 1e6 + (i0 - i); if (!rank.has(o.h) || rank.get(o.h) > r) rank.set(o.h, r); const ph = A.prev.get(i); if (ph && !rank.has(ph)) rank.set(ph, r + 0.5); }
  let bytes = 0; const es = [...A.cache.values()].filter((e) => e.st === 'ready' && e.L).sort((a, b) => (rank.has(a.h) ? rank.get(a.h) : 2e6) - (rank.has(b.h) ? rank.get(b.h) : 2e6) || b.at - a.at);
  for (const e of es) { const b = e.frames * 4; if (bytes + b > MEM) { e.L = e.R = e.hL = e.hR = null; A.n.trimmed = (A.n.trimmed || 0) + 1; } else bytes += b; }
  if (A.cache.size > 1600) for (const [h, e] of [...A.cache]) { if (A.cache.size <= 1200) break; if (e.st === 'ready' && !known.has(h)) A.cache.delete(h); }
}

/* ---------- playback from the buffers (#199) ----------
   Clock hooks (bgplay.js makeClock, page-thread engine): sync(S, latency, anchored, from) before every query window, gate(hap, target) per onset hap,
   sounding(t) when a window ran dry. Mapping: audio time of cycle c = (c - S.num_cycles_at_cps_change) / S.cps + S.seconds_at_cps_change + latency.
   Decision per chunk, sticky until the chunk has passed, the mapping changes (seek, loop wrap, cps, re-anchor) or the chunk gets dirty:
   - buf: one source for [from, chunk end) on Bus.buf, gain 1 / master-gain-at-render (the render includes the master level, Bus.buf feeds the master gain).
     Fade-in over the 20 ms before its start (head = the last 20 ms of the pre-roll), fade-out over its last 20 ms: buffer -> buffer is a linear cross-fade,
     buffer -> live a fade-out with the live voices starting at the boundary. Its haps are gated.
   - live: the scheduler triggers as always (why is kept for the dot sheet).
   A buf decision is taken when the scheduler reaches the chunk (gate), or earlier in the 100 ms tick for a chunk that continues a buffer chain (up to
   HORIZON s ahead: the sources are in the audio thread's hands long before a main-thread stall) or starts within NEAR s.
   live -> buf: the live sub-bus ramps to 0 over the same 20 ms; right after, the old live tails are dropped (superdough resetGlobalEffects: their sound is in the
   buffer through its pre-roll, so nothing sounds twice) and the sub-bus re-opens for direct voices.
   Dirty (edit, control move, pads journal, tempo) or no longer eligible: haps from the scheduler horizon on are live at once; the stale source fades out
   at the first live onset (no gap), at the latest one cycle (max 1 s) after the horizon.
   Never buffer-played: Perform view open, 3 s after a pads journal change, a Quick play audition, a recording, the engine Worker, chunks with custom
   onTrigger haps (midi, osc), chunks whose PCM was trimmed (64 MB cap), a master at -inf when rendered. */
const XF = 0.02, HORIZON = 30, NEAR = 1.5, HOLD = 3000;
const P = { play: true, dec: new Map(), segs: [], S: null, lat: 0.1, key: null, kcps: 0, from: 0, liveSince: false, lastLiveT: -1, mute: null, holdUntil: 0, why: 'stopped', log: [], anchors: [], done: 0,
  n: { bufSegs: 0, bufUnderruns: 0, splices: 0, staleSec: 0, released: 0, resyncs: 0, tailResets: 0, liveHaps: 0, gatedHaps: 0 } };
const tOf = (c) => (c - P.S.num_cycles_at_cps_change) / P.S.cps + P.S.seconds_at_cps_change + P.lat;
const cOf = (t) => (t - P.S.seconds_at_cps_change - P.lat) * P.S.cps + P.S.num_cycles_at_cps_change;
const bus = () => { const T = sc.transport; return T ? (T.ensureBus ? T.ensureBus() : T.bus) : null; };
const logSeg = (r) => { P.log.push(r); if (P.log.length > 400) P.log.splice(0, 200); };
function eligible() {
  if (!P.play) return 'buffer play off'; if (!A.on) return 'lead 0'; const S = P.S; if (!S) return 'stopped';
  try { const en = sc.bg && sc.bg.engine && sc.bg.engine(); if (en && en.worker) return 'engine Worker'; } catch (e) { /* page engine */ }
  const m = document.getElementById('main'); if (m && m.dataset.view === 'perform') return 'Perform view';
  if (performance.now() < P.holdUntil) return 'pads';
  const c = sc.capture && sc.capture.state; if (c && c.phase && c.phase !== 'idle') return 'recording';
  if (Math.abs(S.cps - A.cps) > 1e-9) return 'tempo change';
  return '';
}
function endSeg(s) { if (s.gone) return; s.gone = true; const i = P.segs.indexOf(s); if (i >= 0) P.segs.splice(i, 1); try { s.g.disconnect(); } catch (e) { /* gone */ } let now = s.end; try { now = s.g.context.currentTime; } catch (e) { /* closed */ } P.done += Math.max(0, Math.min(s.end, now) - s.tS); }
/* a source stopped before its start time never plays and Chromium sends it no `ended` event: it is released here, and the event is sent for whoever counts source nodes */
function never(s) { try { s.src.onended = null; s.src.dispatchEvent(new Event('ended')); } catch (e) { /* gone */ } endSeg(s); }
/* fade the source out over XF from audio time a (not before its fade-in is done); a source that has not started by then never plays */
function fadeOut(s, a) {
  if (s.gone) return; const ctx = s.g.context, now = ctx.currentTime; a = Math.max(a, now);
  if (a <= s.t0 + 0.001) { s.end = s.tS; try { s.g.gain.cancelScheduledValues(0); s.g.gain.setValueAtTime(0, now); s.src.stop(); } catch (e) { /* ended */ } never(s); return; }
  a = Math.max(a, s.tIn + 0.001); if (a + XF >= s.end) return;
  try { const p = s.g.gain; p.cancelScheduledValues(a); p.setValueAtTime(s.lvl, a); p.linearRampToValueAtTime(0, a + XF); s.src.stop(a + XF + 0.01); s.end = a + XF; } catch (e) { /* ended */ }
}
function unmuteLive(reset) {
  const m = P.mute; P.mute = null; const b = sc.transport && sc.transport.bus; if (!b || !b.live) return; const now = b.ctx.currentTime, p = b.live.gain;
  if (reset) { const q = sc.quickplay && sc.quickplay.state; if (m && P.lastLiveT <= m.at + 0.001 && !(q && q.phase && q.phase !== 'idle')) { try { if (window.resetGlobalEffects) { window.resetGlobalEffects(); P.n.tailResets++; } } catch (e) { /* tails stay */ } } P.liveSince = false; }
  p.cancelScheduledValues(now); p.setValueAtTime(reset ? 0 : p.value, now); p.linearRampToValueAtTime(1, now + 0.01);
}
function schedule(i, e, from, spliced = false) {
  const b = bus(); if (!b || !b.buf) return null; const ctx = b.ctx, k = P.S.cps, now = ctx.currentTime, c0 = i * A.chunkC, c1 = c0 + A.chunkC, tS = tOf(from), tE = tOf(c1);
  const hf = e.hL ? e.hL.length : 0, off = hf / e.sr + (from - c0) / k, fade = Math.min(XF, off); let t0 = tS - fade, late = 0;
  if (t0 < now + 0.003) { late = now + 0.003 - t0; t0 = now + 0.003; }
  if (tE - t0 < 3 * XF) return null;
  const ab = ctx.createBuffer(2, hf + e.frames, e.sr); if (hf) { ab.copyToChannel(e.hL, 0, 0); ab.copyToChannel(e.hR, 1, 0); }
  { const l = ab.getChannelData(0), r = ab.getChannelData(1), L = e.L, R = e.R, q = 1 / 32767; for (let j = 0, m = e.frames; j < m; j++) { l[hf + j] = L[j] * q; r[hf + j] = R[j] * q; } }
  const src = new AudioBufferSourceNode(ctx, { buffer: ab }), g = new GainNode(ctx, { gain: 0 }), lvl = 1 / e.mg, ramp = fade > 0 || late > 0, tIn = ramp ? Math.max(tS, t0 + 0.005) : t0;
  src.connect(g); g.connect(b.buf); src.start(t0, Math.max(0, off - fade + late));
  if (ramp) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lvl, tIn); } else g.gain.setValueAtTime(lvl, t0);
  g.gain.setValueAtTime(lvl, tE - XF); g.gain.linearRampToValueAtTime(0, tE); src.stop(tE + 0.01);
  const s = { i, h: e.h, src, g, lvl, from, c1, tS, tE, t0, tIn, end: tE, late: +late.toFixed(4) }; src.onended = () => endSeg(s); P.segs.push(s); P.n.bufSegs++;
  const chained = P.segs.some((x) => x !== s && !x.gone && Math.abs(x.end - tS) < 0.003);
  if (!spliced && late > 0.005 && !P.liveSince && !P.segs.some((x) => x !== s && !x.gone && x.t0 <= now && now < x.end)) P.n.bufUnderruns++; /* started behind its time with no live voice and no other buffer sounding: a gap that was heard */
  if (!spliced && !chained && P.liveSince && b.live) { /* live -> buffer: the live voices and their tails leave over the same 20 ms */
    if (P.mute) unmuteLive(false); const a = Math.max(now, tS - XF), z = Math.max(tS, a + 0.005), p = b.live.gain; p.cancelScheduledValues(a); p.setValueAtTime(1, a); p.linearRampToValueAtTime(0, z); P.mute = { at: z, s }; }
  return s;
}
/* between a new pattern (Play, recipe switch, edit) and the next plan the chunk index is the old one: a chunk is trusted when its fresh hash is the indexed one;
   in continuous play a mismatch is an edit and the indexed (old) buffer may keep playing; after Stop or a recipe switch it may not */
const sameGlobals = () => { try { return globals().g === A.g; } catch (e) { return false; } };
function freshHash(i) { const m = A.memo; A.memo = new Map(); try { return hashChunk(i); } catch (e) { return null; } finally { A.memo = m; } }
function decide(i, lazy) {
  let d = P.dec.get(i); if (d) return d;
  const c0 = i * A.chunkC, from = Math.max(c0, P.from), o = A.idx.get(i); let e = o && A.cache.get(o.h), foreign = false;
  if (o && P.S.pattern !== A.pat && !P.cont) { const f = sameGlobals() ? freshHash(i) : null; foreign = !f || f.h !== o.h; }
  /* an edited chunk whose new render is not there yet plays its previous buffer (spliced at a bar line when the new one is ready, see splice) */
  if (o && !o.ext && P.cont && !(e && e.st === 'ready' && e.L)) { const pe = A.cache.get(A.prev.get(i)); if (pe && pe.st === 'ready' && pe.L && pe.mg > 0) e = pe; }
  /* Quick play (own scheduler, own orbit on Bus.live): buffer playback goes on, but no live -> buffer hand-over is started while an audition runs (it would duck the audition for 20 ms and reset its orbit) */
  const qp = sc.quickplay && sc.quickplay.state, audition = !!(qp && qp.phase && qp.phase !== 'idle');
  const why = eligible() || (audition && P.liveSince ? 'Quick play audition (no hand-over until it ends)' : i === P.cleanChunk ? 'seek: clean start, buffer from the next chunk' : foreign ? 'program changed, chunk not rendered yet' : !o ? 'chunk not hashed yet' : o.ext ? 'custom output or analyser in the chunk' : !(e && e.st === 'ready') ? 'chunk not ready' : !e.L ? 'chunk audio trimmed' : !(e.mg > 0) ? 'master at -inf when rendered' : '');
  let s = null; if (!why) { try { s = schedule(i, e, from); } catch (err) { s = null; A.err = 'buffer play: ' + (err && err.message); } }
  if (!s) { if (!lazy) return null; d = { mode: 'live', why: why || 'chunk tail too short' }; P.why = d.why; logSeg({ i, mode: 'live', from, why: d.why }); }
  else { d = { mode: 'buf', from, h: e.h, rel: null, s, stale: e.h !== o.h }; logSeg({ i, mode: d.stale ? 'buf-old' : 'buf', from, tS: +s.tS.toFixed(5), tE: +s.tE.toFixed(5), late: s.late }); }
  P.dec.set(i, d); return d;
}
function release(i, d, why) {
  if (d.mode !== 'buf' || d.rel != null) return; const S = P.S, c1 = (i + 1) * A.chunkC, hz = Math.max(d.from, +S.lastEnd || 0); P.n.released++; P.why = why;
  if (hz >= c1) { d.rel = c1; return; } /* every hap of the chunk is already queried: it ends on the buffer */
  if (hz <= d.from + 1e-9) { fadeOut(d.s, 0); if (P.mute && P.mute.s === d.s) unmuteLive(false); P.dec.delete(i); logSeg({ i, mode: 'cancelled', why }); return; } /* nothing gated yet: decide again when the scheduler gets there */
  d.rel = hz; logSeg({ i, mode: 'released', from: hz, why }); fadeOut(d.s, tOf(hz) + Math.min(1, 1 / S.cps) - XF / 2);
}
function releaseAll(why = 'chunk size changed') { for (const [i, d] of [...P.dec]) release(i, d, why); }
/* an edit: a chunk on the buffer keeps playing its old audio (no live fallback, no gap); it is marked stale and spliced when its new render is ready */
function checkDecisions(hold = true) { for (const [i, d] of [...P.dec]) { if (d.mode !== 'buf' || d.rel != null) continue; const o = A.idx.get(i); if (!o) release(i, d, 'chunk dirty'); else if (o.h !== d.h && !hold) release(i, d, 'tempo or program changed'); else if (o.h !== d.h) { if (!d.stale) { d.stale = true; d.staleAt = performance.now(); logSeg({ i, mode: 'stale', why: 'edit: old buffer until the new render is ready' }); } } else d.stale = false; } }
/* hand-over old -> new buffer of chunk i: a source that has not started is replaced; a sounding one is cross-faded (20 ms) at the next bar line (whole cycle) at least 150 ms away */
function splice(i, d) {
  const o = A.idx.get(i); if (!o) return release(i, d, 'chunk dirty'); if (o.h === d.h) { d.stale = false; return; } if (o.ext) return release(i, d, 'custom output or analyser in the chunk');
  const e = A.cache.get(o.h); if (!(e && e.st === 'ready' && e.L && e.mg > 0)) return; const now = d.s.g.context.currentTime, c1 = (i + 1) * A.chunkC; let from = d.from;
  if (d.s.t0 <= now + 0.05) { from = Math.ceil(cOf(now + 0.15) - 1e-9); if (from >= c1) return; }
  let s = null; try { s = schedule(i, e, from, true); } catch (err) { s = null; } if (!s) return;
  fadeOut(d.s, from === d.from ? 0 : s.tS - XF); d.s = s; d.h = o.h; d.stale = false; P.n.splices++; if (d.staleAt) P.n.staleSec += (performance.now() - d.staleAt) / 1000; logSeg({ i, mode: 'spliced', from, tS: +s.tS.toFixed(5), tE: +s.tE.toFixed(5), late: s.late });
}
/* clock hook: before each query window. An edit (new pattern) is re-hashed at once; a new cycle -> time mapping ends the sources of the old one at its start. */
function sync(S, lat, anchored, from) {
  P.S = S; P.lat = lat; if (!A.on || HOSTED) return;
  if (!anchored) return;
  P.off = false;
  const key = S.seconds_at_cps_change + lat - S.num_cycles_at_cps_change / S.cps; if (P.key != null && Math.abs(key - P.key) < 5e-4 && S.cps === P.kcps) return;
  P.key = key; P.kcps = S.cps; P.from = +from || 0; P.n.resyncs++; const tA = tOf(P.from); P.anchors.push({ from: P.from, tA: +tA.toFixed(5), cps: S.cps }); if (P.anchors.length > 200) P.anchors.splice(0, 100);
  for (const s of P.segs.slice()) fadeOut(s, tA - XF);
  if (P.mute && P.mute.s && P.mute.s.end <= P.mute.s.tS) unmuteLive(false);
  P.dec.clear();
  /* #207: after a seek the chunk it lands in plays live (a clean start: the chunk's audio carries the tails of the notes before it, which is right in sequence and a leftover after a jump); chunk 0 has no pre-roll */
  P.cleanChunk = -1; if (P.clean) { P.clean = false; const i = Math.floor(P.from / A.chunkC + 1e-9); if (i > 0) P.cleanChunk = i; }
  /* the chunk at the new position is decided before the query (a cold first query can cost more than the 0.1 s the source needs to start on time) */
  if (A.chunkC > 0) { try { decide(Math.floor(P.from / A.chunkC + 1e-9), false); } catch (e) { /* decided in gate */ } }
}
/* clock hook: true = this onset hap belongs to a buffer-played chunk (no voice) */
function gate(h, target) {
  if (!A.on || !P.S || HOSTED || P.off) return false;
  const b = +h.whole.begin, i = Math.floor(b / A.chunkC + 1e-9), d = decide(i, true);
  if (d.mode === 'buf' && b >= d.from - 1e-9) {
    if (d.rel == null || b < d.rel - 1e-9) { P.n.gatedHaps++; return true; }
    if (!d.x) { d.x = true; fadeOut(d.s, target - XF / 2); } /* released: the first live onset takes over from the stale buffer */
  }
  P.n.liveHaps++; P.liveSince = true; if (target > P.lastLiveT) P.lastLiveT = target; return false;
}
/* clock hook: the query window [a, b) lies in buffer-played chunks: the clock only advances its position (no pattern query, no events, no voices). Position-based playback:
   the audio is already in the audio thread's hands and the playhead is arithmetic on the audio clock, so a stalled or hidden page has nothing to catch up on. */
function covers(a, b) {
  if (!A.on || !P.S || HOSTED || P.off || !(A.chunkC > 0)) return false;
  for (let i = Math.floor(a / A.chunkC + 1e-9), i1 = Math.floor((b - 1e-9) / A.chunkC); i <= i1; i++) { const d = decide(i, true); if (d.mode !== 'buf' || d.rel != null || d.from > Math.max(a, i * A.chunkC) + 1e-9) return false; }
  return true;
}
/* the events of cycle c from the same render pass as its audio (capture.renderRange hapInfo), or null when that chunk is not rendered: [{ b, e, lane, note }] */
function cycleEvents(c) { if (!A.on || !(A.chunkC > 0)) return null; const i = Math.floor(c / A.chunkC + 1e-9), c0 = i * A.chunkC, o = A.idx.get(i), e = o && A.cache.get(o.h); if (!(e && e.st === 'ready' && e.ev)) return null; return e.ev.filter((x) => x.b >= c - c0 - 1e-6 && x.b < c - c0 + 1 - 1e-6).map((x) => ({ b: x.b + c0, e: x.e + c0, lane: x.lane, note: x.note })); }
const sounding = (t) => P.segs.some((s) => !s.gone && s.t0 <= t && t < s.end);
function ptick() {
  const S = P.S, T = sc.transport, b = T && T.bus; if (!S || !b) return; const now = b.ctx.currentTime;
  if (P.mute && now >= P.mute.at + 0.002) unmuteLive(true);
  { const q = sc.quickplay && sc.quickplay.state, solo = !!(q && q.solo && q.phase && q.phase !== 'idle'); if (solo !== !!P.solo && b.buf) { P.solo = solo; b.buf.gain.setTargetAtTime(solo ? 0 : 1, now, 0.01); } } /* Quick play Solo mutes the program: the buffer sub-bus too */
  if (!S.started || P.off) { P.why = 'stopped'; return; }
  const why = eligible(); if (why) { P.why = why; releaseAll(why); return; }
  const i0 = Math.floor(cOf(now) / A.chunkC);
  for (const [i, d] of [...P.dec]) if (d.mode === 'buf' && d.rel == null && d.stale) splice(i, d);
  for (let j = Math.max(0, i0), jz = i0 + Math.ceil(HORIZON * S.cps / A.chunkC) + 1; j <= jz; j++) {
    const d = P.dec.get(j); if (d) continue; const c0 = j * A.chunkC; if (c0 < P.from) continue; const tS = tOf(c0); if (tS - now > HORIZON) break; if (tS <= now + 0.03) continue;
    const pv = P.dec.get(j - 1); if (!((pv && pv.mode === 'buf' && pv.rel == null) || tS - now < NEAR)) break; if (!decide(j, false)) break;
  }
  for (const k of [...P.dec.keys()]) if (k < i0 - 1) P.dec.delete(k);
}
/* Stop and Engine.cut() (#196): every buffer source goes with the master ramp; decisions are forgotten; the live sub-bus is open again */
function cut() {
  for (const s of P.segs.slice()) { try { const now = s.g.context.currentTime; if (s.t0 > now + 0.03) { s.end = s.tS; s.src.stop(); never(s); continue; } s.end = Math.min(s.end, now + 0.02); s.g.gain.cancelScheduledValues(now); s.g.gain.setTargetAtTime(0, now, 0.004); s.src.stop(now + 0.03); } catch (e) { /* ended */ } }
  P.dec.clear(); P.key = null; P.why = 'stopped'; P.liveSince = false; P.lastLiveT = -1; P.cont = false; A.prev.clear(); P.clean = false; P.cleanChunk = -1; P.off = true; /* nothing is scheduled until the clock starts again (Engine.cut lets it run 25 ms more) */
  if (P.mute) { P.mute = null; const b = sc.transport && sc.transport.bus; if (b && b.live) { const t = b.ctx.currentTime + 0.03; b.live.gain.cancelScheduledValues(0); b.live.gain.setValueAtTime(0, t - 0.001); b.live.gain.setValueAtTime(1, t); } }
}
function playState() {
  const S = P.S, b = sc.transport && sc.transport.bus, now = b ? b.ctx.currentTime : 0; let cur = 0, on = false;
  for (const s of P.segs) if (!s.gone) { cur += Math.max(0, Math.min(s.end, now) - s.tS); if (s.t0 <= now && now < s.end) on = true; }
  const d = S && S.started && A.on ? P.dec.get(Math.floor(cOf(now) / A.chunkC)) : null, buf = on && !!d && d.mode === 'buf' && (d.rel == null || cOf(now) < d.rel);
  const M = A.want.length, N = A.want.filter((w) => ready(w.h)).length, stale = [...P.dec.values()].filter((x) => x.mode === 'buf' && x.stale).length;
  return { renderN: N, renderM: M, status: !A.on ? 'off' : N < M ? 'rendering ' + N + ' of ' + M : 'ready', staleChunks: stale, programEnd: A.end, memCapBytes: MEM, play: P.play, source: buf ? 'buffer' : 'live', why: buf ? '' : (S && S.started ? (d && d.mode === 'live' ? d.why : P.why) : 'stopped'), bufSec: +(P.done + cur).toFixed(2), bufSources: P.segs.filter((s) => !s.gone && s.end > now).length, ...P.n };
}
addEventListener('pads:journal', () => { P.holdUntil = performance.now() + HOLD; A.g = ''; /* pads read by the program change its haps: re-hash */ });
/* the chunks over cycles [c0, c1): { i, c0, c1, st, e (mix: n, lo, hi), stems: { lane: ready stem entry } } */
function view(c0, c1) {
  const out = []; if (!A.on && !A.cache.size) return out;
  for (let i = Math.max(0, Math.floor(c0 / A.chunkC)); i * A.chunkC < c1; i++) { const o = A.idx.get(i), e = o && A.cache.get(o.h); if (!o) continue; let stems = null; for (const [l, sh] of o.ls) { const q = A.cache.get(sh); if (q && q.st === 'ready') (stems = stems || {})[l] = q; } if (e || stems) out.push({ i, c0: i * A.chunkC, c1: (i + 1) * A.chunkC, st: e ? e.st : 'queued', e, stems }); }
  return out;
}
function chunks() { return [...A.idx].sort((a, b) => a[0] - b[0]).map(([i, o]) => { const e = A.cache.get(o.h); return { i, c0: i * A.chunkC, c1: (i + 1) * A.chunkC, hash: o.h, st: e ? e.st : 'queued', ms: e && e.ms, pcm: !!(e && e.L), stems: Object.fromEntries(o.ls.map(([l, sh]) => { const q = A.cache.get(sh); return [l, { hash: sh, st: q ? q.st : 'queued' }]; })) }; }); }
function state() {
  const l = A.leads.slice().sort((a, b) => a - b), cs = chunks(); let pcm = 0; for (const e of A.cache.values()) if (e.L) pcm += e.frames * 4;
  return { on: A.on, lead: A.lead, leadSec: +A.leadSec.toFixed(2), head: A.head, chunkCycles: A.chunkC, chunkSec: +(A.chunkC / A.cps).toFixed(3), preCycles: A.pre, cps: A.cps, relative: A.rel,
    ready: cs.filter((c) => c.st === 'ready').map((c) => c.i), rendering: A.job ? A.job.i : null, renderingLane: A.job ? A.job.lane : null, stemsReady: cs.reduce((a, c) => a + Object.values(c.stems).filter((x) => x.st === 'ready').length, 0), stemsMissing: cs.reduce((a, c) => a + Object.values(c.stems).filter((x) => x.st !== 'ready').length, 0), dirty: A.dirty.slice(), ...A.n,
    speed: A.n.wallMs ? +(A.n.audioSec / (A.n.wallMs / 1000)).toFixed(2) : null, live: !ready(hOf(Math.floor(playhead() / A.chunkC))), liveShare: A.n.ticks ? +(A.n.liveTicks / A.n.ticks).toFixed(3) : null,
    ...playState(), leadMin: l.length ? l[0] : null, leadMedian: l.length ? l[l.length >> 1] : null, leadSamples: l.length, fillMs: A.fillMs, pcmBytes: pcm, cached: A.cache.size, error: A.err };
}
function reset() { A.leads = []; A.armed = false; A.fillMs = null; A.t0 = performance.now(); for (const k of Object.keys(A.n)) A.n[k] = 0; for (const k of Object.keys(P.n)) P.n[k] = 0; P.done = 0; P.log = []; P.anchors = []; }
function configure(o = {}) {
  if (o.lead != null) { A.lead = Math.max(0, Math.min(MAXLEAD, +o.lead || 0)); if (o.persist !== false) try { localStorage.setItem('sc.ahead.lead', String(A.lead)); } catch (e) { /* private mode */ } }
  if (o.play != null) { P.play = !!o.play; if (o.persist !== false) try { localStorage.setItem('sc.ahead.play', P.play ? 'on' : 'off'); } catch (e) { /* private mode */ } if (!P.play) releaseAll('buffer play off'); }
  A.on = A.lead > 0 && !HOSTED; clearInterval(A.timer); A.timer = 0;
  /* one 100 ms timer: the plan runs on every tick while the scheduler runs (a control move must dirty its chunks at once), every fourth tick when stopped */
  if (A.on) { let n = 0; A.timer = setInterval(() => { if ((P.S && P.S.started) || n++ % 4 === 0) plan(); ptick(); }, TICK); plan(); } else { if (A.job) A.job.ac.abort(); A.leadSec = 0; cut(); sc.timeline && sc.timeline.invalidate(); }
  return state();
}
addEventListener('sc-ahead', (e) => { if (e.detail && e.detail.lead != null && +e.detail.lead !== A.lead) configure({ lead: e.detail.lead }); });
sc.ahead = { state, configure, replan: plan, view, chunks, reset, cyrb53, sync, gate, covers, sounding, cut, drop: (i) => { const o = A.idx.get(i); if (o) A.cache.delete(o.h); plan(); }, cycleEvents, cleanStart: () => { P.clean = true; }, segments: () => P.log.slice(), anchors: () => P.anchors.slice() };
{ let lead = 0; try { const u = new URLSearchParams(location.search), q = u.get('ahead'), pl = u.get('aheadplay'), st = q != null ? q : localStorage.getItem('sc.ahead.lead'); lead = st === 'full' || st === '1' || st === 'on' ? DEF_LEAD : st == null ? 0 : +st || 0; /* #199 hotfix: default OFF (live scheduler); ?ahead=1|full opts in */ const v = pl === 'on' || pl === 'off' ? pl : localStorage.getItem('sc.ahead.play'); P.play = v !== 'off'; } catch (e) { lead = 0; } if (lead > 0) configure({ lead, persist: false }); }
