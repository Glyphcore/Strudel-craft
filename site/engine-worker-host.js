/* Page side of the engine Worker (#180 stage 1, docs/AUDIO_ENGINE.md section 7). Loaded lazily by bgplay.js only when ?engine=worker (or localStorage sc.flag.engine = "worker").
   The Worker (engine-worker.js) evaluates the program with the unmodified Strudel bundle, owns the transport clock and publishes timed events 1 to 2 s ahead; this module
   turns each delivered event into a voice with the page's unmodified superdough (B.fire.onTrigger), nothing more per event. The page-thread path (bgplay.js makeClock) stays the
   default and the fallback: a program that needs page state in its queries (hooks, ctl(), pads, taps, lanes, buses, capture) is not eligible and runs on it unchanged.
   Known limits, stage 1: the pattern is still evaluated once on the page (visuals, highlights, lane captures read it; they do not read the Worker's stream: the mirror is a follow-up);
   live event captures (the scheduler's own queries) record nothing while the Worker drives; a live edit, a seek or a tempo change is heard up to the lookahead later. */
import { readFlag } from './flags.js';
const PRELUDE = 'prelude/word.js';
/* Callbacks and side effects (.onTrigger(fn), .log(), .midi(), .osc()) run where the pattern is queried; in the Worker they would never fire (functions do not cross the port), so they stay on the page clock.
   page state a query could read: anything here keeps the program on the page-thread engine. The text tested is what the page hands to evaluate (the lanes pass has already
   turned .split / .merge / .send / ret into plain Strudel on superdough's buses), so those names are not listed; a program that still fails to evaluate in the Worker falls back. */
export const INELIGIBLE = /\.\s*(onTrigger|log|midi|osc|serial|mqtt)\s*\(|\bhooks\s*\.|\bctl\s*\(|\.\s*tap\s*\(|\.\s*use\s*\(|\bpad\s*\(|\bcapture\s*\(|\brecall\s*\(|\.\s*from\s*\(|\bmapKey\b|\bstrudelCraft\b|\bwindow\s*\.|\bdocument\s*\.|\blocalStorage\b/;
export const eligible = (code, blank) => { const t = blank ? blank(String(code)) : String(code); return !INELIGIBLE.test(t); };

export async function attach(env) {
  const { S, repl, base, getTime, ctl, flags } = env; /* ctl: {fire(), account(target, d), note(type, d), stats} supplied by bgplay.js */
  const strudelSrc = [...document.scripts].map((s) => s.src).find((u) => /@strudel\/web/.test(u)); if (!strudelSrc) throw new Error('engine worker: Strudel bundle URL not found');
  const [bundleTxt, workerTxt, preludeTxt] = await Promise.all([fetch(strudelSrc).then((r) => r.text()), fetch(new URL('engine-worker.js', import.meta.url)).then((r) => r.text()), fetch(new URL(PRELUDE, import.meta.url)).then((r) => r.text()).catch(() => '')]);
  const blobUrl = (t) => URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
  const w = new Worker(blobUrl(workerTxt));
  const ready = new Promise((ok, no) => { const h = (e) => { if (e.data.t === 'ready') { ok(); } else if (e.data.t === 'error') no(new Error(e.data.msg)); }; w.addEventListener('message', h); setTimeout(() => no(new Error('engine worker: start timeout')), 30000); });
  w.postMessage({ t: 'init', bundle: blobUrl(bundleTxt), prelude: preludeTxt ? blobUrl(preludeTxt) : '', preludeUrl: new URL(PRELUDE, import.meta.url).href });
  await ready;
  const mir = { cache: new Map(), pend: new Map(), id: 0, TTL: 3500, req: 0, ms: 0 };
  const st = { mode: 'page', epoch: 0, pending: null, workerCode: null, last: null, batches: 0, haps: 0, dropped: 0, errors: [], log: [], resyncs: 0, rsLog: [], minM: Infinity, late: 0, lateLog: [], hidden: !!document.hidden };
  const LA_FG = ctl.laFg || 0.6, LA_BG = 2.0;
  /* default: a late delivered event is handed to superdough, which drops it (a hole); the position never pauses against the clock. ?resync=on (or localStorage sc.flag.resync = on) is opt-in:
     the Worker resumes from the first late event with a 1 s margin (nothing dropped, the position pauses about 1.1 s per stall) */
  const RESYNC = readFlag('resync', location.search, (() => { try { return localStorage; } catch (e) { return null; } })()) === 'on';
  const la = () => (document.hidden || (ctl.scrolling && ctl.scrolling()) ? LA_BG : LA_FG); let laSent = 0; setInterval(() => { if (st.mode === 'worker' && la() !== laSent) { laSent = la(); w.postMessage({ t: 'la', la: laSent }); } }, 250);
  const anchor = () => [getTime(), performance.timeOrigin + performance.now()];
  w.onerror = (e) => { st.errors.push('worker: ' + e.message); (window.errorLogger || console.warn)('engine worker: ' + e.message); };
  w.onmessageerror = () => st.errors.push('worker: message could not be cloned');
  w.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'error') { st.errors.push(m.msg); (window.errorLogger || console.warn)('engine worker: ' + m.msg); if (st.mode === 'worker' && !st.batches) toPage(); return; }
    if (m.t === 'started') { st.epoch = m.epoch; if (m.reset) mirrorReset(); return; }
    if (m.t === 'q') { const p = mir.pend.get(m.id); mir.pend.delete(m.id); if (p && p.gen === mir.gen) mir.cache.set(m.c, { at: performance.now(), haps: rebuild(m.haps) }); return; }
    if (m.t === 'log') { st.log.push(m.msg); if (st.log.length > 20) st.log.shift(); return; }
    if (m.t !== 'batch' || st.mode !== 'worker') return;
    w.postMessage({ t: 'anchor', a: anchor() }); /* every batch refreshes the worker's audio-clock estimate */
    if (m.epoch !== st.epoch) { st.dropped += m.haps.length; return; }
    const s = m.st, L = st.last;
    if (L && (S.cps !== L.cps || S.lastEnd !== L.lastEnd)) { /* something else moved the clock (tempo knob, seek, loop): follow it */
      w.postMessage({ t: 'set', cps: S.cps, lastEnd: S.lastEnd, cycAt: S.num_cycles_at_cps_change, secAt: S.seconds_at_cps_change }); st.last = null; return; }
    S.cps = s.cps; S.lastBegin = s.lastBegin; S.lastEnd = s.lastEnd; S.lastTick = s.lastTick; S.seconds_at_cps_change = s.secAt; S.num_cycles_at_cps_change = s.cycAt; S.num_ticks_since_cps_change = s.ticks; st.last = { cps: s.cps, lastEnd: s.lastEnd };
    const F = ctl.fire(); if (!F) return; st.batches++;
    /* the page was blocked longer than the lookahead (a start, a freeze): events already past would be dropped by superdough. Play the ones before the first late event, and have the Worker
       resume from that cycle with a fresh margin (the musical position pauses, as after an underrun on the page clock; nothing is skipped or doubled). */
    let list = m.haps, t0 = getTime(), late = Infinity; for (const h of m.haps) if (h.t - t0 < 0 && h.wb < late) late = h.wb;
    if (RESYNC && late !== Infinity) { list = m.haps.filter((h) => h.wb < late); st.resyncs++; if (st.rsLog.length < 20) st.rsLog.push([+t0.toFixed(2), +(Math.min(...m.haps.map((h) => h.t)) - t0).toFixed(3), m.haps.length]); st.last = null; ctl.note('worker-resync', { cycle: +late.toFixed(3) }); w.postMessage({ t: 'set', lastEnd: late, guard: 1.0 }); }
    for (const h of list) {
      st.haps++; ctl.account(h.t, h.d, h); const mm = h.t - getTime(); if (mm < st.minM) st.minM = mm; if (mm < 0) { st.late++; if (st.lateLog.length < 12) st.lateLog.push([+(mm * 1000).toFixed(0), +getTime().toFixed(2), m.haps.length]); }
      const hap = { value: h.v, whole: { begin: { valueOf: () => h.wb }, end: { valueOf: () => h.we } }, part: { begin: { valueOf: () => h.pb }, end: { valueOf: () => h.pe } }, duration: h.d * h.cps, context: {}, ensureObjectValue() {}, hasOnset: () => true };
      try { const pr = F.onTrigger(hap, h.t - h.ph, h.d, h.cps, h.t); if (pr && typeof pr.then === 'function') pr.then(() => { if (getTime() > h.t) ctl.skipped(); }, () => {}); } catch (err) { (window.errorLogger || console.warn)(err); }
    }
  };
  mir.gen = 0;
  /* event mirror: cycle -> haps (real Hap objects rebuilt from the Worker's plain data), asked from the Worker, cached; the page no longer queries the pattern for visuals and lanes */
  function rebuild(list) {
    const F = window.Fraction, TS = window.TimeSpan, H = window.Hap; if (!F || !TS || !H) return [];
    return list.map((x) => new H(x.wb == null ? undefined : new TS(F(x.wb), F(x.we)), new TS(F(x.pb), F(x.pe)), x.v, x.cx || {}));
  }
  function cycleHaps(c) {
    if (st.mode !== 'worker' || !st.last) return undefined; /* not driven: the caller queries the page pattern as before */
    let cur = 0; try { cur = Math.floor(S.now()); } catch (err) { /* not started */ } const now = performance.now(), e = mir.cache.get(c);
    if (e && (now - e.at < mir.TTL || c < cur)) return e.haps;
    if (![...mir.pend.values()].some((p) => p.c === c)) { const id = ++mir.id; mir.pend.set(id, { c, gen: mir.gen }); mir.req++; w.postMessage({ t: 'q', id, c }); }
    return e ? e.haps : 'pending';
  }
  const mirrorReset = () => { mir.gen++; mir.cache.clear(); mir.pend.clear(); };
  document.addEventListener('visibilitychange', () => { if (st.mode === 'worker') w.postMessage({ t: 'la', la: la() }); });

  /* evaluate hook: remembers the program text before the scheduler starts (Cyclist.start runs inside evaluate), and forwards live edits */
  const ev0 = repl.evaluate.bind(repl);
  const wrapped = async (code, ...a) => {
    st.pending = code;
    const r = await ev0(code, ...a);
    if (st.mode === 'worker') { if (eligible(code, flags.blank)) { if (code !== st.workerCode) { st.workerCode = code; w.postMessage({ t: 'code', code }); } } else toPage(); }
    return r;
  };
  repl.evaluate = wrapped; if (window.evaluate === ev0 || window.evaluate) window.evaluate = wrapped;

  function toWorker() {
    base.pause(); st.mode = 'worker'; st.last = null; st.workerCode = st.pending;
    w.postMessage({ t: 'start', code: st.pending, cps: S.cps, lastEnd: S.lastEnd || 0, cycAt: S.num_cycles_at_cps_change || 0, secAt: S.seconds_at_cps_change || 0, la: la(), anchor: anchor() });
    ctl.note('engine-worker', { eligible: true });
  }
  function toPage() { w.postMessage({ t: 'stop' }); st.mode = 'page'; ctl.note('engine-page', { eligible: false }); base.start(); }
  const clock = {
    setDuration: () => 0.05, get duration() { return 0.05; }, interval: 0.05, minLatency: 0.01, getPhase: () => (st.last ? S.lastTick : base.getPhase()),
    start() { if (st.pending != null && eligible(st.pending, flags.blank)) toWorker(); else { st.mode = 'page'; base.start(); } },
    pause() { if (st.mode === 'worker') w.postMessage({ t: 'stop' }); st.mode = 'page'; base.pause(); },
    stop() { if (st.mode === 'worker') w.postMessage({ t: 'stop' }); st.mode = 'page'; base.stop(); },
  };
  S.clock = clock; const started = S.started;
  return { cycleHaps, state: () => ({ mirror: { requests: mir.req, cached: mir.cache.size }, mode: st.mode, batches: st.batches, haps: st.haps, dropped: st.dropped, errors: st.errors.slice(), log: st.log.slice(), minMarginMs: st.minM === Infinity ? null : Math.round(st.minM * 1000), resync: RESYNC, late: st.late, resyncs: st.resyncs, rsLog: st.rsLog, lateLog: st.lateLog, epoch: st.epoch }), clock, worker: w, wasStarted: started };
}
