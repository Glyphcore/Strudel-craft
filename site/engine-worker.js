/* Engine Worker (#180 stage 1). Classic worker script, started from a Blob by engine-worker-host.js, only when ?engine=worker (or sc.flag.engine) is on.
   It runs the unmodified Strudel bundle (@strudel/web 1.3.0 text handed over by the page, evaluated with importScripts) with stand-ins for what a worker lacks
   (no DOM, no AudioContext): the program is evaluated and queried here, never rendered. It owns the transport clock (a worker timer, not throttled when the page
   is hidden) and publishes timed events 1 to 2 s ahead as batches over the port:
     page -> worker: {t:'init', bundle, prelude, preludeUrl} | {t:'start', code, cps, lastEnd, secAt, cycAt, la, anchor:[ctxTime, perfNow]} | {t:'code', code}
                     | {t:'set', cps?, lastEnd?, secAt?, cycAt?} | {t:'q', id, c} | {t:'anchor', a:[ctxTime, perfNow]} | {t:'la', la} | {t:'stop'}
     worker -> page: {t:'ready'} | {t:'started', n} | {t:'error', msg} | {t:'q', id, c, haps:[{wb, we, pb, pe, v, cx}]} | {t:'batch', epoch, haps:[{b, e, wb, we, v, ph, d}], st:{cps, lastBegin, lastEnd, lastTick, secAt, cycAt, ticks}}
   The per-tick arithmetic is the Cyclist's (cycle <-> seconds through seconds_at_cps_change / num_cycles_at_cps_change), the same as site/bgplay.js. Event type = the
   event bus of the device adapter contract (#180): {kind:'hap'|'note', source:'pattern', t: audio time, ...}; virtual MIDI in joins the same stream later. */
'use strict';
/* everything inside one function: the Strudel bundle exports every control name (begin, end, phase, ...) as a global and would overwrite top-level names here */
(() => {
const noop = () => {};
const dummy = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k === 'value' ? 0 : dummy()), apply: () => dummy(), set: () => true });
let ANCHOR = [0, 0]; /* [AudioContext.currentTime, performance.timeOrigin + performance.now() ms] sampled on the page (epoch ms: the two threads have different time origins) */
const audioNow = () => ANCHOR[0] + (performance.timeOrigin + performance.now() - ANCHOR[1]) / 1000;
self.window = self;
self.AudioContext = class { constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = dummy(); this.audioWorklet = { addModule: async () => {} }; this.baseLatency = 0; } get currentTime() { return audioNow(); } resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } addEventListener() {} };
for (const k of ['BaseAudioContext', 'OfflineAudioContext']) self[k] = self.AudioContext;
for (const k of ['AudioNode', 'GainNode', 'AudioWorkletNode', 'AudioBuffer']) self[k] = class {};
let preludeUrl = '';
const doc = { createElement: () => ({ style: {}, addEventListener: noop, setAttribute: noop }), head: { append: noop }, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, body: { append: noop }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, hidden: false, get currentScript() { return { src: preludeUrl }; } };
self.document = doc; self.dispatchEvent = noop; self.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
self.strudelCraft = self.strudelCraft || {};

let repl = null, S = null, timer = 0, running = false, epoch = 0, LA = 1.2, phase = 0, code = '';
const START_GUARD = 1.0 /* first events keep this much margin while the page is busy starting the run */, TICK_MS = 50, QSPAN = 0.05, PRECISION = 1e4, MIN_LATENCY = 0.01, LATENCY = 0.1;
const clean = (v) => { /* structured clone refuses functions: keep plain data only */
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (Array.isArray(v)) return v.map(clean);
  const o = {}; for (const k of Object.keys(v)) { const x = clean(v[k]); if (x !== undefined) o[k] = x; } return o; };

async function init(m) {
  preludeUrl = m.preludeUrl; importScripts(m.bundle);
  self.samples = async () => {}; /* sample maps are the page's job (superdough's registry lives there); queries do not need the audio */
  repl = await self.initStrudel({ prebake: noop });
  if (m.prelude) { try { importScripts(m.prelude); } catch (e) { postMessage({ t: 'error', msg: 'prelude: ' + e.message }); } }
  S = repl.scheduler; S.stop(); /* the repl's own clock must never run here: we tick ourselves */
  postMessage({ t: 'ready' });
}
async function evalCode(src) { const t0 = performance.now(); postMessage({ t: 'log', msg: 'eval start ' + src.length }); try { await repl.evaluate(src, false); } finally { postMessage({ t: 'log', msg: 'eval done ' + Math.round(performance.now() - t0) + ' ms' }); } }

function tick() {
  if (!running || !S.pattern) return;
  const t = audioNow(); const haps = [];
  while (phase < t + LA) {
    phase = Math.round(phase * PRECISION) / PRECISION;
    const ph = phase, dur = QSPAN;
    if (S.num_ticks_since_cps_change === 0) { S.num_cycles_at_cps_change = S.lastEnd; S.seconds_at_cps_change = ph; }
    S.num_ticks_since_cps_change++;
    const P = (ph + dur - S.seconds_at_cps_change) * S.cps;
    const A = S.lastEnd; S.lastBegin = A; const x = S.num_cycles_at_cps_change + P; S.lastEnd = x; S.lastTick = ph;
    let hs = []; try { hs = S.pattern.queryArc(A, x, { _cps: S.cps, cyclist: 'cyclist' }); } catch (e) { postMessage({ t: 'error', msg: String(e && e.message || e) }); }
    for (const h of hs) {
      if (!h.hasOnset()) continue;
      const target = (h.whole.begin - S.num_cycles_at_cps_change) / S.cps + S.seconds_at_cps_change + LATENCY;
      let v; try { v = clean(h.value); } catch (e) { continue; }
      haps.push({ kind: 'hap', source: 'pattern', t: target, ph, d: h.duration / S.cps, cps: S.cps, wb: +h.whole.begin, we: +h.whole.end, pb: +h.part.begin, pe: +h.part.end, v });
      if (h.value && h.value.cps !== undefined && S.cps != h.value.cps) { S.cps = h.value.cps; S.num_ticks_since_cps_change = 0; }
    }
    phase += QSPAN;
  }
  if (haps.length || tick.n++ % 10 === 0) postMessage({ t: 'batch', epoch, haps, st: { cps: S.cps, lastBegin: S.lastBegin, lastEnd: S.lastEnd, lastTick: S.lastTick, secAt: S.seconds_at_cps_change, cycAt: S.num_cycles_at_cps_change, ticks: S.num_ticks_since_cps_change } });
}
tick.n = 0;
function begin(m) {
  epoch++; S.cps = m.cps; S.lastEnd = m.lastEnd; S.num_cycles_at_cps_change = m.cycAt; S.seconds_at_cps_change = m.secAt; S.num_ticks_since_cps_change = 0;
  ANCHOR = m.anchor; LA = m.la; phase = audioNow() + START_GUARD; running = true; clearInterval(timer); timer = setInterval(tick, TICK_MS);
}
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === 'init') await init(m);
    else if (m.t === 'start') { code = m.code; await evalCode(code); begin(m); postMessage({ t: 'started', epoch, reset: true }); }
    else if (m.t === 'code') { /* live edit: new pattern, same clock; haps already published (up to the lookahead) still play */
      await evalCode(m.code); postMessage({ t: 'started', epoch, reset: true }); }
    else if (m.t === 'set') { epoch++; for (const k of ['cps', 'lastEnd']) if (m[k] != null) S[k] = m[k]; if (m.cycAt != null) S.num_cycles_at_cps_change = m.cycAt; if (m.secAt != null) S.seconds_at_cps_change = m.secAt; S.num_ticks_since_cps_change = 0; phase = audioNow() + (m.guard || MIN_LATENCY); postMessage({ t: 'started', epoch }); }
    else if (m.t === 'q') { /* event mirror (visuals, lanes, highlights): the haps of cycle `c` incl. fragments, as plain data with the source locations the highlight needs */
      let haps = []; try { haps = S.pattern ? S.pattern.queryArc(m.c, m.c + 1).map((h) => ({ wb: h.whole ? +h.whole.begin : null, we: h.whole ? +h.whole.end : null, pb: +h.part.begin, pe: +h.part.end, v: clean(h.value), cx: clean(h.context) })) : []; } catch (e) { haps = []; }
      postMessage({ t: 'q', id: m.id, c: m.c, haps }); }
    else if (m.t === 'anchor') ANCHOR = m.a;
    else if (m.t === 'la') LA = m.la;
    else if (m.t === 'stop') { running = false; clearInterval(timer); }
  } catch (err) { postMessage({ t: 'error', msg: String(err && err.message || err) }); }
};
})();
