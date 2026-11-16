/* Record panel: one arm, one transport, one timeline of takes. A single Record captures, per the include boxes, the master audio,
   the lane / pad / control event stream and the code-state. Every take is a recipe (recipe.js, schemas/recipe.v1.json): versioned
   JSON that regenerates the result from scratch, with optional audio blobs as its outputs. Remake re-renders a recipe offline and checks
   the output against the stored audio hash. Imported recipes are inert data until Remake, after the user approves their dependencies.
   Tap: an AudioWorklet (Blob module; ScriptProcessor fallback) on the master bus GainNode from app.js, post master level; its output is
   silent and only pulled, so the mix is unchanged. Cycles mode cuts on sample frames mapped from the scheduler clock.
   Storage: IndexedDB "sc-recipes" (recipe.js); settings: localStorage sc.record.* (history-friendly, no audio).
   API: window.strudelCraft.capture = { open, close, toggle, configure, record, stop, toggleRec, renderExact, remake, importRecipe, exportRecipe,
   download, list, get, remove, rename, encodeWav, opts, state } */
import * as N from './numfmt.js';
import * as RL from './record-length.js';
import { FORMAT, VERSION, audioHash, collectDeps, validate, refsOf, verify, trusted, grant, store, pruneLegacy, sha256 } from './recipe.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const get = (k, d) => { try { const v = localStorage.getItem('sc.record.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.record.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (s) => N.clock(Math.max(0, s), { tenths: true }); /* mm:ss.s, fixed width (numfmt.js) */
const safe = (s) => (String(s || 'take').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'take').slice(0, 60);
const numStr = (x) => String(+(+x).toFixed(3));
const short = (h) => (h ? String(h).replace('sha256:', '').slice(0, 12) : '-');

const opts = {
  source: get('source', 'offline'), autoFix: get('autoFix', false), mode: get('mode', 'cycles'), n: get('n', 2), unit: get('unit', 'bars'), len: get('len', 4), toEnd: get('toEnd', false), startBar: get('startBar', ''), endBar: get('endBar', ''), countIn: get('countIn', 0), preRoll: get('preRoll', 0),
  name: get('name', 'take'), bits: get('bits', 16), fold: get('fold', true), audio: get('audio', true), events: get('events', true), code: get('code', true),
};
/* render host (docs/AUDIO_ENGINE.md, Part C): this page loaded as index.html?host=render inside a hidden iframe renders recipes for its parent */
const HOST = (() => { try { return new URLSearchParams(location.search).get('host') === 'render'; } catch (e) { return false; } })();
const st = { phase: 'idle', startFrame: 0, endFrame: 0, startCycle: 0, chunks: [], peak: 0, hold: 0, tap: null, tapCtx: null, open: false, rendering: false, run: {}, ev: null };

/* ---------- tap ---------- */
const WORKLET = `class ScCaptureTap extends AudioWorkletProcessor{constructor(){super();this.n=0;this.B=4096;this.L=new Float32Array(this.B);this.R=new Float32Array(this.B);this.f0=0;this.on=true;this.port.onmessage=(e)=>{this.on=!!e.data.on;if(!this.on)this.n=0;}}
process(inputs){if(!this.on)return true;const i=inputs[0]||[];const l=i[0],r=i[1]||i[0];const len=l?l.length:128;if(this.n===0)this.f0=currentFrame;
for(let k=0;k<len;k++){this.L[this.n]=l?l[k]:0;this.R[this.n]=r?r[k]:0;this.n++;if(this.n===this.B){this.port.postMessage({f0:this.f0,L:this.L,R:this.R},[this.L.buffer,this.R.buffer]);this.L=new Float32Array(this.B);this.R=new Float32Array(this.B);this.n=0;this.f0=currentFrame+k+1;}}return true;}}
registerProcessor('sc-capture-tap',ScCaptureTap);`;
const modules = new WeakMap();
async function attachTap() {
  const bus = sc.transport && sc.transport.bus; if (!bus) return null;
  if (st.tap && st.tapCtx === bus.ctx) return st.tap;
  detachTap();
  const ctx = bus.ctx; let node;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      if (!modules.has(ctx)) modules.set(ctx, ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))));
      await modules.get(ctx);
      node = new AudioWorkletNode(ctx, 'sc-capture-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      node.port.onmessage = (e) => onChunk(e.data.f0, e.data.L, e.data.R);
    } catch (e) { node = null; }
  }
  if (!node) { /* fallback: ScriptProcessor (deprecated but universal); playbackTime gives the frame */
    node = ctx.createScriptProcessor(4096, 2, 1);
    node.onaudioprocess = (e) => { const b = e.inputBuffer; onChunk(Math.round(e.playbackTime * ctx.sampleRate), b.getChannelData(0).slice(), (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice()); };
  }
  /* non-intrusive: the worklet has no outputs, so nothing leaves the tap and the audible path (bus.node -> destination) gets no extra stage or connection.
     The ScriptProcessor fallback must have an output to run; it goes to a MediaStream sink, never to ctx.destination. */
  if (node.numberOfOutputs > 0) { st.sink = ctx.createMediaStreamDestination(); node.connect(st.sink); }
  bus.own.add(node);
  bus.node.connect(node);
  st.tap = node; st.tapCtx = ctx; st.chunks = []; return node;
}
function detachTap() {
  if (!st.tap) return; try { st.tap.disconnect(); } catch (e) { /* gone */ }
  try { const b = sc.transport.bus; if (b && b.ctx === st.tapCtx) b.node.disconnect(st.tap); } catch (e) { /* gone */ }
  if (st.sink) { try { st.sink.disconnect(); } catch (e) { /* gone */ } st.sink = null; }
  if (st.tap.port) st.tap.port.onmessage = null; st.tap.onaudioprocess = null; st.tap = null; st.tapCtx = null;
}
function sr() { return st.tapCtx ? st.tapCtx.sampleRate : 48000; }
function onChunk(f0, L, R) {
  let p = 0; for (let i = 0; i < L.length; i += 4) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p) p = a; if (b > p) p = b; }
  st.peak = Math.max(st.peak * 0.85, p); st.hold = Math.max(st.hold, p);
  st.chunks.push({ f0, L, R });
  if (st.phase === 'recording') sampleEvents();
  const keepFrom = st.phase === 'recording' || st.phase === 'waiting' ? Math.min(st.startFrame, f0) - opts.preRoll * sr() - 8192 : f0 - (opts.preRoll + 1) * sr();
  while (st.chunks.length > 1 && st.chunks[0].f0 + st.chunks[0].L.length < keepFrom) st.chunks.shift();
  if (st.phase === 'recording' && st.endFrame && f0 + L.length >= st.endFrame) finish('done');
}
function slice(a, b) {
  const n = Math.max(0, b - a); const L = new Float32Array(n), R = new Float32Array(n);
  for (const c of st.chunks) {
    const s = Math.max(a, c.f0), e = Math.min(b, c.f0 + c.L.length); if (e <= s) continue;
    L.set(c.L.subarray(s - c.f0, e - c.f0), s - a); R.set(c.R.subarray(s - c.f0, e - c.f0), s - a);
  }
  return { L, R };
}

/* ---------- compressed take (webm/opus): MediaRecorder on a MediaStream sink fed from the same bus node as the tap ---------- */
const WEBM_MIME = (() => { try { return typeof MediaRecorder !== 'undefined' && ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || null; } catch (e) { return null; } })();
const comp = { mr: null, msd: null, chunks: [] };
function startCompressed() {
  if (!WEBM_MIME || !opts.audio || comp.mr) return;
  try {
    const bus = sc.transport.bus; comp.msd = st.tapCtx.createMediaStreamDestination(); bus.node.connect(comp.msd); comp.chunks = [];
    comp.mr = new MediaRecorder(comp.msd.stream, { mimeType: WEBM_MIME, audioBitsPerSecond: 128000 });
    comp.mr.ondataavailable = (e) => { if (e.data && e.data.size) comp.chunks.push(e.data); };
    comp.mr.start(250);
  } catch (e) { comp.mr = null; }
}
function stopCompressed() {
  const { mr, msd } = comp; comp.mr = null; comp.msd = null;
  const drop = () => { try { sc.transport.bus.node.disconnect(msd); } catch (e) { /* gone */ } };
  if (!mr) return Promise.resolve(null);
  return new Promise((ok) => { mr.onstop = () => { drop(); ok(comp.chunks.length ? { blob: new Blob(comp.chunks, { type: mr.mimeType || WEBM_MIME }), mime: mr.mimeType || WEBM_MIME } : null); }; try { mr.stop(); } catch (e) { drop(); ok(null); } });
}

/* ---------- clock: cycle <-> audio time (cyclist: hap at cycle c sounds at lastTick + (c - lastBegin)/cps + latency) ---------- */
function clock() {
  const s = sc.transport && sc.transport.scheduler; if (!s || !s.started) return null;
  const cps = s.cps || 0.5, lat = s.latency != null ? s.latency : 0.1;
  return { cps, timeOf: (c) => s.lastTick + (c - s.lastBegin) / cps + lat, cycleAt: (t) => s.lastBegin + (t - lat - s.lastTick) * cps };
}
async function waitTicking(ms = 4000) {
  const s0 = sc.transport.scheduler; const before = s0 ? s0.lastTick : 0; const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const s = sc.transport.scheduler, b = sc.transport.bus;
    if (s && s.started && b && s.lastTick !== before && s.num_ticks_since_cps_change > 0) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/* superdough keeps filter / compressor / supersaw nodes in module-wide WeakRef pools that ignore the context (nodePools.mjs). Two scoped fixes,
   nothing page-wide survives the render:
   - offline -> live: while our superdough() calls run, a connect() wrapper (installed for the render only, restored in finally) collects the
     offline context's nodes; before startRendering their own Symbol keys (superdough's POOL_KEY) are deleted, so on release they are torn
     down instead of pooled and the live context never gets one back.
   - live -> offline: a hap whose pooled node belongs to the live context throws InvalidAccessError; the failed call consumed (popped) that
     stale node, so the hap is retried (up to 64 times) until the pool hands out a fresh offline node. */
const process_timers = (() => { try { return (new URLSearchParams(location.search).get('timers') || localStorage.getItem('sc.flag.timers') || 'det') !== 'real'; } catch (e) { return true; } })(); /* flag timers=real: the superdough ended events as before (A/B for #115) */
function collectNodes(ctx) {
  const prev = AudioNode.prototype.connect, prevD = AudioNode.prototype.disconnect, seen = new Set();
  AudioNode.prototype.connect = function (dest, ...rest) { if (this.context === ctx) seen.add(this); if (dest instanceof AudioNode && dest.context === ctx) seen.add(dest); return prev.call(this, dest, ...rest); };
  /* superdough tears a voice down from an `ended` callback (Chain.releaseNodes -> disconnect) that runs on the main thread some time after the render passed the voice's end:
     a ringing tail (the vowel filters: five bandpass biquads, Q 40-140) was cut at a load-dependent instant, so renders differed by -22 dB. Offline nodes keep their connections
     until the render is over (the context is discarded), which makes the tail, and the render, independent of main-thread speed (#108). */
  AudioNode.prototype.disconnect = function (...a) { if (this.context === ctx) return undefined; return prevD.apply(this, a); };
  /* superdough fills a reverb's ConvolverNode asynchronously (reverbGen: a nested OfflineAudioContext, oncomplete sets convolver.buffer), so a render that does not wait
     starts that reverb at a load-dependent frame: the -16..-35 dB residual between whole-take renders (#115; stripping room/roomsize from the haps gives -126 dB, every
     hap alone is bit-identical). Convolvers of the render's context are collected; ready() resolves when each has its buffer, and is awaited before the render starts and
     before each chunk resumes. */
  const prevC = BaseAudioContext.prototype.createConvolver, convs = [];
  BaseAudioContext.prototype.createConvolver = function (...a) { const c = prevC.apply(this, a); if (this === ctx) convs.push(c); return c; };
  const ready = async (maxMs = 15000) => { const t0 = performance.now(); let waited = 0; while (convs.some((c) => !c.buffer) && performance.now() - t0 < maxMs) { await new Promise((r) => setTimeout(r, 2)); waited++; } await new Promise((r) => setTimeout(r, 0)); return { convolvers: convs.length, waited }; };
  const timers = process_timers ? emulateTimers(ctx) : null;
  return { seen, ready, timers, restore() { if (timers) timers.restore(); if (AudioNode.prototype.connect !== prev) AudioNode.prototype.connect = prev; if (AudioNode.prototype.disconnect !== prevD) AudioNode.prototype.disconnect = prevD; if (BaseAudioContext.prototype.createConvolver !== prevC) BaseAudioContext.prototype.createConvolver = prevC; } };
}
/* superdough runs part of its sound design from `ended` events on the main thread: webAudioTimeout (a ConstantSourceNode stopped at T whose onended runs the callback) drives
   the ducker (orbit duck: reads currentTime and the gain value when the event arrives, ramps from there), modulators and the voices' own release timeouts. In a realtime context
   the event arrives about at T; in an offline context the render runs ahead of the main thread, so the callback saw a load-dependent currentTime and gain: two renders of one
   recipe differed (-16..-35 dB, x4 throttle worse; stripping duckorbit from the haps gives -125 dB, #115). For the render's context the `onended` handler of a source whose
   stop time is known is taken over: it runs while the render is suspended at the first render quantum at or after T, in stop-time order, so currentTime and parameter values are
   what they would be in an ideal realtime run. Nodes without a known stop time keep the real event. at(sec, fn) puts a render-suspend point (chunk boundary) in the same ordered list. */
function emulateTimers(ctx) {
  const SP = AudioScheduledSourceNode.prototype, dOn = Object.getOwnPropertyDescriptor(SP, 'onended'), dStop = SP.stop; if (!dOn || !dOn.set || !dStop) return { at() { throw new Error('no source-node timers'); }, flush() {}, restore() {}, stats: {} };
  const sr = ctx.sampleRate, Q = 128, fr = (T) => Math.max(0, Math.ceil(T * sr / Q - 1e-6) * Q), pos = () => Math.round(ctx.currentTime * sr);
  const info = new WeakMap(), pend = [], armed = new Set(), chunk = new Map(), stats = { taken: 0, run: 0, late: 0 }; let seq = 0;
  const arm = (q) => { if (armed.has(q)) return; if (q <= pos()) return; armed.add(q); ctx.suspend(q / sr).then(() => fire(q)).catch(() => { armed.delete(q); for (const e of pend) if (e.q === q) { e.q = -1; stats.late++; } }); };
  const queue = (node, i) => { if (i.e) i.e.cancel = true; const T = i.T; const e = { q: fr(T), seq: seq++, node, cancel: false }; i.e = e; pend.push(e); dOn.set.call(node, null); stats.taken++; arm(e.q); };
  const runDue = () => { for (let again = true; again;) { again = false; pend.sort((a, b) => a.q - b.q || a.seq - b.seq); const p = pos();
    for (let k = 0; k < pend.length; k++) { const e = pend[k]; if (e.q > p) break; pend.splice(k, 1); k--; if (e.cancel) continue; const i = info.get(e.node), h = i && i.h; i.e = null; if (h) { stats.run++; try { h.call(e.node, new Event('ended')); } catch (err) { /* a cleanup that throws must not stop the render */ } again = true; } } } };
  const fire = async (q) => { try { runDue(); const fn = chunk.get(q); chunk.delete(q); let go = true; if (fn) go = (await fn()) !== false; runDue(); if (go) await ctx.resume(); } catch (e) { /* the render promise reports it */ } };
  Object.defineProperty(SP, 'onended', { configurable: true, enumerable: dOn.enumerable, get() { if (this.context !== ctx) return dOn.get.call(this); const i = info.get(this); return i && i.h ? i.h : dOn.get.call(this); },
    set(h) { if (this.context !== ctx) return dOn.set.call(this, h); let i = info.get(this); if (!i) info.set(this, (i = {})); if (i.e && !h) { i.e.cancel = true; i.e = null; } i.h = h || null; dOn.set.call(this, h ? function (ev) { stats.real = stats.real || {}; const k = this.constructor.name; stats.real[k] = (stats.real[k] || 0) + 1; return h.call(this, ev); } : h); if (h && i.T != null && !i.e) queue(this, i); } });
  SP.stop = function (T) { if (this.context === ctx) { let i = info.get(this); if (!i) info.set(this, (i = {})); i.T = T == null ? ctx.currentTime : Math.max(0, +T); if (i.h) queue(this, i); } return dStop.call(this, T); };
  return { at(sec, fn) { const q = fr(sec); chunk.set(q, fn); arm(q); }, flush: runDue, stats, restore() { if (SP.stop !== dStop) SP.stop = dStop; Object.defineProperty(SP, 'onended', dOn); } };
}
function unpool(nodes) { let n = 0; for (const node of nodes) for (const sym of Object.getOwnPropertySymbols(node)) { try { delete node[sym]; n++; } catch (e) { /* frozen */ } } return n; }

/* ---------- events + code-state ---------- */
function nowCycle() { const ck = clock(); return ck && st.tapCtx ? ck.cycleAt(st.tapCtx.currentTime) : 0; }
function sampleEvents() {
  const C = sc.perform && sc.perform.controls; if (!C || !st.ev) return; const c = +nowCycle().toFixed(4);
  for (const x of C.list()) { const v = x.value; if (v == null || typeof v === 'object') continue; if (st.ev.last.get(x.name) !== v) { st.ev.last.set(x.name, v); st.ev.controls.push({ cycle: c, control: x.name, value: v }); } }
}
const lsj = (k) => { try { return JSON.parse(localStorage.getItem('sc.' + k)); } catch (e) { return null; } };
let modHash = null;
/* everything that shapes the sound besides the deps: program (as played, with atoms resolved), controls (values, ranges, maps, lanes),
   AST control sites, the Perform model (pads = hook bindings, maps), mod ranges, sound-affecting settings */
async function codeState(srcOverride) {
  const T = sc.transport, src = srcOverride || (T && T.source()) || { code: '' };
  let resolved = src.code; try { if (sc.atoms && sc.atoms.inline) resolved = sc.atoms.inline(src.code); } catch (e) { /* keep */ }
  const C = sc.perform && sc.perform.controls;
  let sites = []; try { sites = (sc.binder && sc.binder.sites ? sc.binder.sites(src.kind === 'stack' ? 'stack' : 'rack') : []).map((s) => ({ id: s.id, path: s.path, label: s.label, param: s.param, type: s.type, value: s.value, range: s.range })); } catch (e) { sites = []; }
  if (!modHash) try { modHash = (await (async () => { const P = sc.packs; await P.ready; const d = P.describe('glyphcore/shim:ranges'); if (!d || !d.hash) throw new Error('no ranges'); return { path: d.path, sha256: d.hash }; })()); } catch (e) { modHash = null; }
  return JSON.parse(JSON.stringify({
    source: { kind: src.kind || 'solo', title: src.title || '', code: src.code || '', resolved, atoms: [...new Set((src.code || '').match(/\batoms\.[\w.]+/g) || [])] },
    controls: C ? C.toModel() : null, aliases: C && C.labelOf ? Object.fromEntries(C.list().map((x) => [C.labelOf(x.name), x.name]).filter(([l]) => l)) : {}, sites, perform: lsj('perform'), modRanges: modHash ? { path: modHash.path, sha256: modHash.sha256 } : null,
    settings: { tempo: (window.__sc && window.__sc.S.tempo) || lsj('tempo'), masterDb: T ? T.masterDb : null, follow: lsj('follow'), range: { start: lsj('range.start'), end: lsj('range.end'), loop: lsj('range.loop'), unit: lsj('range.unit') } },
  }));
}
function padEvents(c0, c1) {
  const fr = (x) => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(x)); return m ? +m[1] / +(m[2] || 1) : +x; };
  return ((sc.perform && sc.perform.journal) || []).map((e) => ({ cycle: fr(e.cycle), pad: e.pad, op: e.op, args: e.args || {} })).filter((e) => e.pad && e.cycle >= c0 - 1e-9 && e.cycle < c1 - 1e-9);
}
/* the pad entries of the hooks journal up to the take's end (bindings made before the start still hold), as the hooks runtime reads them */
function hookPadEntries(c1) {
  const H = sc.hooks; if (!H || !H.journal) return [];
  const fr = (x) => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(x)); return m ? +m[1] / +(m[2] || 1) : +x; };
  return JSON.parse(JSON.stringify(H.journal.filter((e) => e.pad && fr(e.cycle) < c1 - 1e-9)));
}
/* level fingerprint of an output: mono RMS per 10 ms block in dB (0.1 dB steps); Remake compares noise-based takes with it */
function envelope(L, R, rate) {
  const b = Math.max(1, Math.round(rate / 100)), n = Math.floor(L.length / b), out = new Array(n);
  for (let k = 0; k < n; k++) { let e = 0; for (let i = k * b; i < (k + 1) * b; i++) { const v = (L[i] + R[i]) / 2; e += v * v; } out[k] = Math.round(10 * Math.log10(e / b + 1e-12) * 10) / 10; }
  return out;
}
const usesNoise = (code) => /["'`\s,[<](white|pink|brown|crackle)\b|\bnoise\(/.test(code || '');
function envelopeMatch(a, b, tolDb = 1.5) {
  if (!a || !b || a.length !== b.length) return { ok: false, why: 'no comparable level fingerprint' };
  let n = 0, bad = 0, max = 0; for (let i = 0; i < a.length; i++) { if (a[i] < -50 && b[i] < -50) continue; n++; const d = Math.abs(a[i] - b[i]); if (d > max) max = d; if (d > tolDb) bad++; }
  return { ok: n > 0 && bad / n <= 0.02, blocks: n, over: bad, maxDb: +max.toFixed(2), tolDb };
}
const seed32 = () => crypto.getRandomValues(new Uint32Array(1))[0] | 0;
function newId() { return 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
async function uniqueName(base) { const names = new Set((await store.list()).map((r) => r.recipe.name)); let n = safe(base), i = 2; const b = n; while (names.has(n)) n = b + '-' + i++; return n; }
async function buildRecipe({ name, includes, timing, state, events, outputs = {} }) {
  const deps = await collectDeps(state ? state.source.code : '');
  return { format: FORMAT, version: VERSION, id: newId(), name: await uniqueName(name), created: new Date().toISOString(), includes, timing,
    random: { seed: seed32(), note: 'Math.random is seeded with this value during offline renders (noise, random phases); Strudel rand is cycle-deterministic' },
    state: includes.code ? state : null, events: includes.events || includes.code ? events || null : null, deps, outputs };
}

/* Hook 2 (#76): addTake({name, L, R, sr, cps, cycles, from, code}) stores an audio-only take (Float32Array L, R) in the take store, e.g. the bounce of
   a lane capture. recipe.meta.from names the source (capture name). Resolves with the stored record; it appears in the takes list and downloads as WAV. */
async function addTake({ name = 'take', L, R, sr, cps, cycles, from = null, code = null } = {}) {
  if (!(L instanceof Float32Array) || !(sr >= 8000) || !(cps > 0) || !(cycles > 0)) throw new Error('addTake needs L (Float32Array), sr >= 8000, cps > 0 and cycles > 0');
  R = R instanceof Float32Array ? R : L;
  const recipe = await buildRecipe({ name, includes: { audio: true, events: false, code: false }, timing: { cps: +(+cps).toFixed(6), start: 0, stop: cycles, cycles, loop: true, mode: 'cycles', exact: false, fold: false, preRoll: 0 } });
  recipe.meta = { from: from == null ? null : String(from), ...(code ? { code: String(code) } : {}) };
  recipe.outputs.capture = { sha256: await audioHash(L, R), sr, frames: L.length, how: 'offline', encoding: 'f32le-interleaved', envelope: envelope(L, R, sr) };
  const rec = { id: recipe.id, recipe, audio: { capture: { L, R, sr } } };
  await store.put(rec); renderTakes(); return rec;
}

/* ---------- length: bars / cycles / seconds, start bar, end of track (site/record-length.js, docs/CAPTURE.md "Length") ---------- */
const HZ = 1024; /* cycles scanned for gate windows when resolving the end of track */
function lenEnv() {
  const T = sc.transport || {}, H = sc.hooks || {};
  const cps = T.scheduler && T.scheduler.started && T.scheduler.cps ? T.scheduler.cps : ((window.__sc && window.__sc.S.tempo) || lsj('tempo') || 120) / 240;
  return { cps: +cps, cpb: +H.cpb > 0 ? +H.cpb : 1, bpb: +H.bpb > 0 ? +H.bpb : 4 };
}
function endInfo(env) {
  let planJ = null, markers = null, code = '';
  try { const H = sc.hooks; if (H && H.plan) { planJ = H.plan({ horizon: HZ }); markers = planJ.markers || null; } } catch (e) { /* no hooks */ }
  try { const s = sc.transport && sc.transport.source && sc.transport.source(); code = (s && s.code) || ''; } catch (e) { /* none */ }
  const r = sc.range && sc.range.state;
  return RL.resolveEnd({ plan: planJ, horizon: HZ, markers, loop: r ? { on: !!r.loop, end: +r.end } : null, code, ...env });
}
/* the take the panel describes right now: { ok, error, startCycle, stopCycle, cycles, bars, seconds, startBar, endBar, toEnd, end, env, explicitStart } */
function takePlan(over = {}) {
  const env = lenEnv(), r = sc.range && sc.range.state;
  const sb = RL.parseStartBar(over.startBar !== undefined ? over.startBar : opts.startBar); if (!sb.ok) return { ok: false, error: sb.error, field: 'start' };
  const eb = RL.parseStartBar(over.endBar !== undefined ? over.endBar : opts.endBar); if (!eb.ok) return { ok: false, error: eb.error.replace('bar number', 'end bar'), field: 'end' };
  const unit = over.unit || opts.unit, toEnd = over.toEnd !== undefined ? over.toEnd : opts.toEnd;
  const value = over.value !== undefined ? over.value : opts.len;
  const end = toEnd ? endInfo(env) : null;
  const p = RL.plan({ unit, value, toEnd, startBar: sb.value, endBar: eb.value, end, transportStart: Math.max(0, Math.floor((r && +r.start) || 0)), maxMin: r && r.maxMin || RL.MAX_MIN, extra: r && r.extra || 0, ...env });
  return { ...p, end, env, unit, explicitStart: sb.value != null };
}
const metaFor = (p, cycles, c0) => RL.timingMeta({ bars: +(cycles / p.env.cpb).toFixed(6), startBar: +(c0 / p.env.cpb + 1).toFixed(6), toEnd: p.toEnd }, { unit: p.unit, cpb: p.env.cpb, bpb: p.env.bpb, end: p.end });

/* ---------- record ---------- */
/* run: one-off overrides that are not persisted ({mode, n, countIn, name, at: absolute start cycle, step}); resolves with the saved record */
async function record(o = {}, run = {}) {
  if (st.phase !== 'idle') return null; /* busy: use stop() or toggleRec() */
  if (o && Object.keys(o).length) configure(o);
  const lp = run.n ? { ...takePlan({ unit: 'cycles', value: Math.max(1, run.n | 0), toEnd: false }), explicitStart: false } : takePlan();
  if (!lp.ok) { toast('Record: ' + lp.error, { kind: 'error' }); return null; }
  const ru = st.run = { plan: lp, mode: run.mode || opts.mode, n: lp.cycles, countIn: run.countIn != null ? run.countIn : opts.countIn, preRoll: run.mode ? 0 : opts.preRoll, name: run.name || opts.name, at: run.at, step: run.step };
  const done = st.done = new Promise((r) => { st.resolve = r; });
  if (!opts.audio && !opts.events && !opts.code) { toast('Tick at least one of Audio, Events, Code-state', { kind: 'error' }); st.resolve(null); return null; }
  if (st.rendering) { toast('Rendering, wait a moment', { kind: 'info' }); st.resolve(null); return null; }
  const T = sc.transport; if (!T) { st.resolve(null); return null; }
  if ((run.source || opts.source) === 'offline') { const r = await recordOffline(ru); st.resolve(r); return r; }
  st.phase = 'arming'; sync();
  try {
    if (!T.playing) { await T.play(); if (!T.playing) throw new Error('Press Play first (audio is blocked or nothing to play)'); if (!(await waitTicking())) throw new Error('The transport did not start'); }
    const tap = await attachTap(); if (!tap) throw new Error('No audio output yet: press Play once');
    if (st.tapCtx.state !== 'running') await st.tapCtx.resume();
    if (st.tap.port) st.tap.port.postMessage({ on: true });
    const ck = clock(); if (!ck) throw new Error('The transport is not running');
    const now = st.tapCtx.currentTime + 0.02, rate = sr(), c = ck.cycleAt(now);
    const k = Math.max(0, ru.countIn | 0);
    let startT, startCycle = null, at = ru.at;
    if (at == null && ru.plan.explicitStart) { if (ck.timeOf(ru.plan.startCycle) >= now) at = ru.plan.startCycle; else toast(`Bar ${RL.cycleToBar(ru.plan.startCycle, ru.plan.env.cpb)} has already passed; recording from the next bar`, { kind: 'info' }); }
    if (at != null) { startCycle = at; while (ck.timeOf(startCycle) < now) startCycle += ru.step || ru.n; startT = ck.timeOf(startCycle); }
    else if (ru.mode === 'cycles' || k > 0) { startCycle = Math.ceil(c - 1e-6) + k; startT = ck.timeOf(startCycle); } else startT = now;
    st.startCycle = startCycle; st.c0 = startCycle != null ? startCycle : ck.cycleAt(startT); st.cps = ck.cps;
    if (ru.plan.toEnd) { const left = ru.plan.stopCycle - st.c0; if (!(left > 0)) throw new Error(`Already past the end of track (bar ${RL.cycleToBar(ru.plan.stopCycle, ru.plan.env.cpb)})`); ru.n = left; }
    const pre = ru.mode === 'cycles' ? 0 : Math.max(0, +ru.preRoll || 0);
    const first = st.chunks.length ? st.chunks[0].f0 : Math.round(now * rate);
    st.startFrame = Math.max(first, Math.round((startT - pre) * rate)); st.recFrame = Math.round(startT * rate);
    if (ru.mode === 'cycles') st.endFrame = st.recFrame + Math.round(ru.n / ck.cps * rate);
    else if (ru.mode === 'until') { const r = sc.range && sc.range.state; const capS = r ? Math.max(1, r.maxMin * 60 + (r.extra || 0) - (r.elapsed || 0)) : 600; st.endFrame = st.recFrame + Math.round(capS * rate); }
    else st.endFrame = 0;
    st.src = T.source(); st.state = opts.code || opts.audio ? await codeState(st.src) : null;
    st.ev = opts.events ? { controls: [], last: new Map() } : null;
    st.hold = 0; st.phase = 'waiting'; st.t0 = performance.now(); st.perf0 = null;
    sync(); loop();
  } catch (e) { st.phase = 'idle'; sync(); toast('Record: ' + (e.message || e), { kind: 'error' }); st.resolve(null); }
  return done;
}
function toggleRec() { return st.phase === 'idle' ? record() : stop(); }
/* set options from code or the palette; persisted (sc.record.*) and reflected in the panel */
function configure(o = {}) {
  for (const k of Object.keys(opts)) if (o[k] !== undefined) { opts[k] = k === 'name' ? safe(o[k]) : k === 'len' ? (+o[k] > 0 ? +o[k] : opts.len) : k === 'startBar' || k === 'endBar' ? String(o[k] == null ? '' : o[k]).trim() : typeof opts[k] === 'number' ? +o[k] : typeof opts[k] === 'boolean' ? !!o[k] : o[k]; set(k, opts[k]); }
  if (!RL.UNITS.includes(opts.unit)) opts.unit = 'bars';
  opts.n = Math.max(1, Math.min(4096, opts.n | 0));
  if (o.n !== undefined && o.len === undefined && o.unit === undefined) { opts.unit = 'cycles'; opts.len = opts.n; opts.toEnd = false; set('unit', 'cycles'); set('len', opts.len); set('toEnd', false); } /* legacy: configure({ n }) is N cycles */
  if (el.w) {
    for (const r of el.w.querySelectorAll('.cap-seg input')) r.checked = String(opts[r.name.slice(4)]) === r.value;
    $('#capCount').value = String(opts.countIn); $('#capPre').value = String(opts.preRoll); $('#capName').value = opts.name; $('#capFold').checked = opts.fold;
    for (const k of ['audio', 'events', 'code']) $('#capInc_' + k).checked = opts[k];
  }
  sync(); return { ...opts };
}
function stop() {
  if (st.phase === 'rendering') { if (st.abort) st.abort.abort(); return; }
  if (st.phase === 'waiting' && (!st.tapCtx || st.tapCtx.currentTime * sr() < st.recFrame)) { st.phase = 'idle'; sync(); toast('Record cancelled', { kind: 'info' }); st.resolve(null); return; }
  if (st.phase === 'recording' || st.phase === 'waiting') finish(st.run.mode === 'cycles' ? 'early' : 'done');
}
let rafOn = false;
function loop() {
  if (rafOn) return; rafOn = true;
  const step = () => {
    if (st.phase === 'idle' && !st.open) { rafOn = false; return; }
    if (st.phase === 'idle' && opts.preRoll > 0 && sc.transport && sc.transport.playing && sc.transport.bus && st.tapCtx !== sc.transport.bus.ctx && !st.attaching) { st.attaching = true; attachTap().finally(() => { st.attaching = false; }); }
    if (st.phase === 'waiting' && st.tapCtx && st.tapCtx.currentTime * sr() >= st.recFrame) { st.phase = 'recording'; st.recAudio0 = st.tapCtx.currentTime; st.perf0 = perfNow(); startCompressed(); sync(); }
    if (st.phase === 'recording') sampleEvents();
    if ((st.phase === 'recording' || st.phase === 'waiting') && sc.transport && !sc.transport.playing) finish('transport');
    draw();
    st.raf = document.hidden ? setTimeout(step, 250) : requestAnimationFrame(step);
  };
  step();
}
/* hidden tabs throttle rAF: the worklet keeps posting chunks, so onChunk still ends cycle takes on time */
document.addEventListener('visibilitychange', () => { if (st.phase !== 'idle' && rafOn) { cancelAnimationFrame(st.raf); clearTimeout(st.raf); rafOn = false; loop(); } });

/* live take self-check: the tap stamps every block with the audio thread's frame counter (f0), so a hole in the frame sequence is a dropout of the tap;
   the scheduler counters (bgplay.js) say whether events were dropped (target already past) or the clock re-anchored (a stall longer than the
   lookahead: the musical position paused, i.e. tempo drift); Chrome's playout statistics, where present, count output glitches */
function perfNow() { const s = sc.bg && sc.bg.stats ? sc.bg.stats() : null; const c = st.tapCtx; const ps = c && c.playoutStats ? c.playoutStats : null;
  return { late: s ? s.perf.lateHaps + (s.perf.skippedHaps || 0) : 0, underruns: s ? s.underruns : 0, lt: s && s.perf.longTasks != null ? s.perf.longTasks : 0, worst: s ? s.perf.longTaskWorstMs : 0, glitch: ps && ps.fallbackFramesEvents != null ? ps.fallbackFramesEvents : null }; }
function frameGaps(a, b) { const cs = st.chunks.filter((c) => c.f0 + c.L.length > a && c.f0 < b).sort((x, y) => x.f0 - y.f0); let gaps = 0, missing = 0, at = a;
  for (const c of cs) { if (c.f0 > at) { gaps++; missing += c.f0 - at; } at = Math.max(at, c.f0 + c.L.length); } if (at < b) { gaps++; missing += b - at; } return { gaps, missing }; }
function selfCheck(a, b) {
  const p1 = perfNow(), p0 = st.perf0 || p1, fg = frameGaps(a, b);
  const c = { frameGaps: fg.gaps, missingFrames: fg.missing, droppedEvents: p1.late - p0.late, reanchors: p1.underruns - p0.underruns, longTasks: p1.lt - p0.lt, outputGlitches: p1.glitch != null && p0.glitch != null ? p1.glitch - p0.glitch : null };
  const why = [c.frameGaps ? `${c.frameGaps} gap${c.frameGaps > 1 ? 's' : ''} in the tap (${c.missingFrames} frames)` : '', c.droppedEvents ? `${c.droppedEvents} event${c.droppedEvents > 1 ? 's' : ''} scheduled too late (dropped)` : '', c.reanchors ? `${c.reanchors} clock re-anchor${c.reanchors > 1 ? 's' : ''} (timing jumps)` : '', c.outputGlitches ? `${c.outputGlitches} output glitch${c.outputGlitches > 1 ? 'es' : ''}` : ''].filter(Boolean);
  return { ok: !why.length, ...c, why: why.join(', ') || null };
}
async function finish(why) {
  if (st.phase !== 'recording' && st.phase !== 'waiting') return;
  const rate = sr(); let end = st.endFrame;
  const last = st.chunks.length ? st.chunks[st.chunks.length - 1] : null; const have = last ? last.f0 + last.L.length : st.startFrame;
  if (!end || why !== 'done' || end > have) end = Math.min(end || have, have);
  /* the audio and its self-check are taken now, before any await: while saving, onChunk keeps only the last second of blocks */
  const audio0 = opts.audio && end - st.recFrame >= rate * 0.05 ? slice(st.startFrame, end) : null, check = audio0 ? selfCheck(st.recFrame, end) : null;
  st.phase = 'saving'; sync();
  const webm = await stopCompressed();
  const ru = st.run, exact = ru.mode === 'cycles' && why === 'done';
  const recLen = Math.max(0, end - st.recFrame); const c0 = st.c0, c1 = exact ? c0 + ru.n : c0 + recLen / rate * st.cps;
  let rec = null;
  try {
    if (recLen < rate * 0.05) throw new Error('Nothing captured');
    const audio = audio0;
    const includes = { audio: !!opts.audio, events: !!opts.events, code: !!opts.code };
    const C = sc.perform && sc.perform.controls;
    const events = includes.events || includes.code ? { pads: padEvents(c0, c1), hooks: hookPadEntries(c1), controls: st.ev ? st.ev.controls : [], lanes: C ? (C.toModel().automation || {}) : {} } : null;
    const timing = { cps: +(+st.cps).toFixed(6), start: +c0.toFixed(6), stop: +c1.toFixed(6), cycles: +(c1 - c0).toFixed(6), loop: exact, mode: ru.mode, exact, fold: !!opts.fold, preRoll: (st.recFrame - st.startFrame) / rate, ...metaFor(ru.plan, c1 - c0, c0) };
    /* gaps (bgplay.js segments): a take that crossed a pause or interruption carries segment markers; the audio has the gap, Remake and
       the exact render do not (they render the cycles, not the wall clock) */
    const gaps = sc.bg && st.tapCtx && st.recAudio0 != null ? sc.bg.gapsBetween(st.recAudio0, st.tapCtx.currentTime) : [];
    if (gaps.length) timing.segments = gaps.map((g) => ({ kind: g.kind, cycle: g.cycle, audio: +(g.audio - st.recAudio0).toFixed(3), seconds: g.seconds }));
    const recipe = await buildRecipe({ name: ru.name, includes, timing, state: st.state, events });
    rec = { id: recipe.id, recipe, audio: {} };
    if (audio) { rec.audio.capture = { L: audio.L, R: audio.R, sr: rate }; recipe.outputs.capture = { sha256: await audioHash(audio.L, audio.R), sr: rate, frames: audio.L.length, how: 'realtime', encoding: 'f32le-interleaved', envelope: envelope(audio.L, audio.R, rate), check }; }
    if (audio && webm) rec.audio.webm = webm;
    await store.put(rec);
    /* reference render: an exact take with code-state gets an offline render whose hash Remake checks (stops the transport) */
    const flagged = check && !check.ok;
    if (audio && includes.code && (exact || (flagged && opts.autoFix))) {
      st.phase = 'idle'; sync();
      if (FLAG_REC === 'inline') { if (sc.transport.playing) sc.transport.stop(); await new Promise((r) => setTimeout(r, 500)); } /* inline: let live voices end before the offline swap; the host needs neither */
      const out = await renderRecipe(recipe, { sr: rate, calm: true });
      if (out && flagged) rec.replaced = { at: new Date().toISOString(), why: check.why };
      if (out) { rec.audio.render = { L: out.L, R: out.R, sr: out.sr }; recipe.outputs.render = { sha256: await audioHash(out.L, out.R), sr: out.sr, frames: out.L.length, how: 'offline', encoding: 'f32le-interleaved', haps: out.haps, fails: out.fails, envelope: envelope(out.L, out.R, out.sr), ...(out.underLoad ? { underLoad: out.underLoad } : {}) }; await store.put(rec); }
    }
    if (flagged && !rec.replaced) toast(`Live take "${recipe.name}" is flagged: ${check.why}. ${includes.code ? 'Tap to replace it with an offline render' : 'Tick Code-state to allow an offline re-render'}`, { kind: 'error', sticky: includes.code, onClick: includes.code ? () => rerender(recipe.id) : null });
    else if (flagged) toast(`Live take "${recipe.name}" was flagged (${check.why}); it now plays its offline render`, { kind: 'info', ms: 8000 });
    if (gaps.length) toast(`Take "${recipe.name}" had ${gaps.length} interruption${gaps.length > 1 ? 's' : ''} (${gaps.reduce((a, g) => a + g.seconds, 0).toFixed(1)} s paused); the recipe marks them (timing.segments)`, { kind: 'info', ms: 8000 });
    toast(`Take saved: ${recipe.name}. Download`, { kind: 'ok', ms: 6000, onClick: () => download(recipe.id, 'recipe') });
  } catch (e) { toast((e.message === 'Nothing captured' ? '' : 'Could not save take: ') + e.message, { kind: 'error' }); rec = null; }
  st.phase = 'idle'; if (!(opts.preRoll > 0)) st.chunks = []; st.ev = null; sync(); renderTakes(); st.resolve(rec);
}

/* ---------- offline render of a recipe (Remake, reference render, exact render) ---------- */
const seedWorklet = (seed) => `{let a=${seed >>> 0};Math.random=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}`;
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* Hook 1 (#76): beforeRender(fn) registers an async fn(recipe, { code }) that runs once before every offline render (exact render, reference
   render, Remake) with the recipe's program already compiled, so pattern-level captures (lanesCapture.host.resolve) can render and register their
   audio first. fn may call renderRecipe itself (nested renders skip the hooks). Returns an unregister function. A throwing hook aborts the render. */
const beforeHooks = new Set(), hostHooks = new WeakSet();
/* { host: true }: the hook is one the render host registers for itself too (engine/index.js lane captures), so a render sent to the host skips the
   page's copy. A page hook without it must run where the render runs, so a render with such a hook renders in the page (rec=inline behaviour) */
function beforeRender(fn, o = {}) { if (typeof fn !== 'function') throw new TypeError('beforeRender needs a function'); beforeHooks.add(fn); if (o.host) hostHooks.add(fn); return () => beforeHooks.delete(fn); }
/* every offline render goes to the render host (a hidden index.html?host=render page with its own Strudel and superdough) unless the page is the
   host itself or the flag says inline (?rec=inline / localStorage sc.flag.rec): the live engine keeps playing and is never suspended or swapped */
const FLAG_REC = (() => { try { return new URLSearchParams(location.search).get('rec') || localStorage.getItem('sc.flag.rec') || 'host'; } catch (e) { return 'host'; } })();
/* panel progress for every offline render: a render started elsewhere (Render exact, re-render, Remake, lane captures) gets its own abort signal so the panel's Cancel works,
   and its progress feeds the bar; the Record render passes its own signal and keeps it */
function setProg(p) {
  if (!el.prog) return; const on = p != null; el.prog.hidden = !(st.rendering || st.phase === 'rendering' || st.progAbort); if (!on) return;
  { const pc = Math.round(p * 100); el.bar.style.width = pc + '%'; el.pct.textContent = pc + ' %'; el.prog.querySelector('[role=progressbar]').setAttribute('aria-valuenow', String(pc)); }
}
function cancelRender() { const ac = st.abort || st.progAbort; if (ac) ac.abort(); }
async function renderRecipe(recipe, o = {}) {
  if (HOST) return renderRecipe0(recipe, o);
  const own = !o.signal, ac = own ? new AbortController() : null, inner = o.onProgress;
  if (own) st.progAbort = ac; setProg(0);
  try {
    const sig = own ? ac.signal : o.signal; let load = null;
    if (o.calm) { const cm = await waitCalm(sig); if (!cm.calm) load = { gapMs: cm.gapMs, waitedMs: cm.waitedMs }; }
    const out = await renderRecipe0(recipe, { ...o, signal: sig, onProgress: (p) => { setProg(p); inner && inner(p); } });
    if (out && load) out.underLoad = load;
    return out;
  }
  finally { if (own && st.progAbort === ac) st.progAbort = null; setProg(null); }
}
/* A render made while the main thread is slow (CPU throttled, a busy page) came out different from one made on a calm thread (#108: above-120 Hz level match 0.66-0.70 under x4
   against 0.88 after, same recipe). Renders attached to a take wait until the main thread is calm: the longest gap between 10 ms timer ticks over 500 ms is <= CALM_GAP_MS.
   At most CALM_MAX_MS; then it renders anyway and the take is marked outputs.render.underLoad (chip + Re-render offline). Cancel works while waiting; the transport is not touched. */
const CALM_GAP_MS = 45, CALM_MAX_MS = 10000;
async function waitCalm(signal) {
  const t0 = performance.now(); let gap = 0;
  for (;;) {
    gap = await new Promise((res) => { let last = performance.now(), worst = 0, n = 0; const iv = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (++n >= 50) { clearInterval(iv); res(worst); } }, 10); });
    if (signal && signal.aborted) throw abortErr();
    if (gap <= CALM_GAP_MS) return { calm: true, gapMs: Math.round(gap), waitedMs: Math.round(performance.now() - t0) };
    if (performance.now() - t0 >= CALM_MAX_MS) return { calm: false, gapMs: Math.round(gap), waitedMs: Math.round(performance.now() - t0) };
  }
}
async function renderRecipe0(recipe, o = {}) {
  const pageHook = [...beforeHooks].some((f) => !hostHooks.has(f));
  if (!HOST && !o.inline && FLAG_REC !== 'inline' && !st.inHook && !pageHook) return renderViaHost(recipe, o);
  return renderRecipeInline(recipe, o);
}
async function renderRecipeInline(recipe, o = {}) {
  if (!HOST && sc.transport && sc.transport.playing) sc.transport.stop(); /* inline renders swap superdough's context: nothing live may run meanwhile */
  if (beforeHooks.size && !st.inHook && recipe.state) {
    st.inHook = true;
    try {
      const C = sc.perform && sc.perform.controls; const S = recipe.state;
      if (S.aliases && Object.keys(S.aliases).length) { if (!C) await sc.transport.compileCode('silence'); const c = sc.perform && sc.perform.controls; if (c && c.alias) for (const [label, id] of Object.entries(S.aliases)) { try { c.alias(label, id); } catch (e) { /* keep */ } } }
      await sc.transport.compileCode(S.source.code);
      for (const fn of [...beforeHooks]) await fn(recipe, { code: S.source.code });
    } finally { st.inHook = false; }
  }
  return renderRecipeCore(recipe, o);
}
/* chunked offline render (docs/AUDIO_ENGINE.md, Part C): voices are created one chunk ahead of the offline render position (OfflineAudioContext.suspend at every
   chunk boundary), never all at once, and the main thread yields every ~8 ms of voice construction, so a long render neither freezes the page nor
   holds every voice of the take in memory. Superdough's polyphony cap (128 voices) sees voices end as the render advances, as in live play.
   onProgress(fraction), signal (AbortSignal: stops between chunks; the render rejects with AbortError). */
const yieldNow = () => (globalThis.scheduler && typeof globalThis.scheduler.yield === 'function' ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
const abortErr = () => Object.assign(new Error('Render cancelled'), { name: 'AbortError' });
export const CHUNK_S = 2, LEAD_S = 0.25;
async function renderRecipeCore(recipe, { sr: rateIn, onProgress = null, signal = null, chunk = CHUNK_S, warm: doWarm = !HOST, dbg = null } = {}) {
  const W = window, T = sc.transport, S = recipe.state;
  if (!S) throw new Error('This take has no code-state, so it cannot be rendered');
  if (st.rendering) throw new Error('A render is already running');
  if (!W.OfflineAudioContext) throw new Error('This browser has no OfflineAudioContext');
  st.rendering = true; sync();
  const C = () => sc.perform && sc.perform.controls;
  let live = null, ctl = null, swapped = false, wasRunning = false, col = null, prevCtl = null, rnd = null, prevJ = null;
  try {
    /* labels -> AST control ids (ctl("cut") reads the site id it was bound to when recorded); the aliases must exist before the program
       declares its controls, so the Perform tools are loaded first with an empty program */
    if (S.aliases && Object.keys(S.aliases).length) { if (!C()) await T.compileCode('silence'); if (C() && C().alias) for (const [label, id] of Object.entries(S.aliases)) { try { C().alias(label, id); } catch (e) { /* keep */ } } }
    const info = await T.compileCode(S.source.code);
    if (!info.pattern) throw new Error('The program did not compile to a pattern');
    if (C() && S.controls) {
      /* exact control state: the model (specs, maps, lanes) plus a value history of just the start value and the recorded, cycle-stamped
         control events; the previous model and histories come back in finally */
      const c = C(); prevCtl = { model: c.toModel(), hist: Object.fromEntries(c.list().map((x) => [x.name, c.history ? c.history(x.name) : null])) };
      try { c.load(JSON.parse(JSON.stringify(S.controls))); } catch (e) { /* a same-named control with another spec stays; Remake then reports a differing hash */ }
      if (c.setHistory) for (const [n, spec] of Object.entries(S.controls.controls || {})) {
        const v0 = spec.value !== undefined ? spec.value : spec.default; const evs = ((recipe.events && recipe.events.controls) || []).filter((e) => e.control === n);
        c.setHistory(n, [{ cycle: -Infinity, value: v0 }, ...evs.map((e) => ({ cycle: e.cycle, value: e.value }))]);
      }
    }
    /* pad events: the hooks runtime reads pad bindings from its journal at query time, so the recorded pad entries replace the live
       ones for the render (non-pad entries stay); the live journal comes back in finally */
    const H = sc.hooks, padJ = recipe.events && recipe.events.hooks;
    if (H && H.journal && padJ) { prevJ = H.journal.slice(); const keep = H.journal.filter((e) => !e.pad); H.journal.length = 0; H.journal.push(...keep, ...JSON.parse(JSON.stringify(padJ))); try { H.undef('__scPerformTouch'); } catch (e) { /* cache bust */ } }
    for (const f of ['setAudioContext', 'getAudioContext', 'superdough', 'loadWorklets', 'getSuperdoughAudioController', 'setSuperdoughAudioController']) if (typeof W[f] !== 'function') throw new Error('Strudel offline API missing: ' + f);
    const { cps, start, stop: end } = recipe.timing;
    live = W.getAudioContext(); ctl = W.getSuperdoughAudioController();
    /* freeze the live clock: superdough's onended cleanups create nodes on the current context, so no live source may end while the offline one is current */
    wasRunning = live.state === 'running'; if (wasRunning) await live.suspend();
    const rate = rateIn || (recipe.outputs.render && recipe.outputs.render.sr) || (recipe.outputs.capture && recipe.outputs.capture.sr) || live.sampleRate;
    const frames = Math.round((end - start) / cps * rate), tail = recipe.timing.fold ? Math.round(Math.min(4, (end - start) / cps) * rate) : 0;
    /* the take's haps, one cycle per query with a yield between (one query over a long take was a long task); onset fragments only, so each hap once */
    const haps = []; for (let c = start; c < end - 1e-9; c = Math.min(end, Math.floor(c + 1))) { const c1 = Math.min(end, Math.floor(c + 1)); for (const h of info.pattern.queryArc(c, c1, { _cps: cps })) if (h.hasOnset()) haps.push(h); if (signal && signal.aborted) throw abortErr(); await yieldNow(); }
    haps.sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    let fails = 0, retries = 0, warm = 0;
    let items = haps.map((h, i) => { h.ensureObjectValue && h.ensureObjectValue(); return { h, i, t: (h.whole.begin.valueOf() - start) / cps }; });
    /* debug (tests/site/hap_diff.mjs, #115): dbg.only = hap indices to voice (time and length unchanged), dbg.list = also return each hap's sound and parameters */
    const hapInfo = dbg && dbg.list ? items.map(({ h, i, t }) => ({ i, t: +t.toFixed(4), v: JSON.parse(JSON.stringify(h.value, (k, x) => (typeof x === 'function' ? undefined : x))) })) : null;
    if (dbg && dbg.strip) for (const x of items) { x.h = Object.create(x.h); const v = { ...x.h.value }; for (const k of dbg.strip) delete v[k]; Object.defineProperty(x.h, 'value', { value: v }); } /* leave parameters out (find the one that varies) */
    if (dbg && dbg.only) { const keep = new Set(dbg.only); items = items.filter((x) => keep.has(x.i)); }
    let f = 0, r = 0, idx = 0;
    const voice = async (h, t) => {
      for (let k = 0; ; k++) {
        try { await W.superdough({ ...h.value }, t, h.duration / cps, cps, h.whole.begin.valueOf()); break; } /* a copy per call: superdough may write into the value */
        catch (e) { if (e && e.name === 'InvalidAccessError' && k < 64) { r++; continue; } f++; break; }
      }
    };
    /* voices for every hap before `until` (seconds from the render start), yielding every ~8 ms */
    const schedule = async (until) => { let y0 = performance.now(); while (idx < items.length && items[idx].t < until) { const { h, t } = items[idx++]; await voice(h, t); if (performance.now() - y0 > 8) { await yieldNow(); y0 = performance.now(); if (signal && signal.aborted) throw abortErr(); } } if (col) { unpool(col.seen); col.seen.clear(); await col.ready(); } }; /* offline nodes lose their pool key at once: released offline nodes are torn down, never pooled, so no live voice gets one */
    const use = async (ctx) => { W.setAudioContext(ctx); W.setSuperdoughAudioController(null); swapped = true;
      /* the worklets' Math.random (supersaw phases and other audio-thread randomness) lives in the context's AudioWorkletGlobalScope: a module
         loaded before superdough's own seeds it with the recipe seed, so those phases repeat render after render */
      try { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([seedWorklet(recipe.random.seed)], { type: 'application/javascript' }))); } catch (e) { /* no worklets */ }
      try { await W.loadWorklets(); } catch (e) { /* worklet effects unavailable offline */ } col = collectNodes(ctx); f = 0; r = 0; idx = 0; };
    rnd = Math.random;
    if (doWarm) {
      /* warm-up pass on a throwaway context: a failed superdough() call can leave a partial voice behind, so stale live nodes are drained
         from the pools here (never rendered) and the real pass only ever gets fresh nodes: renders are bit-identical across sessions.
         The render host (a separate page that never plays) has no live nodes, so it skips this pass. */
      Math.random = mulberry(recipe.random.seed);
      await use(new OfflineAudioContext(2, 128, rate)); await schedule(Infinity); col.restore(); unpool(col.seen); warm = r;
    }
    /* seeded Math.random for the real pass only (noise buffers, random phases); restored in finally */
    Math.random = mulberry(recipe.random.seed);
    const total = frames + tail, off = new OfflineAudioContext(2, total, rate);
    await use(off);
    const step = Math.max(0.5, +chunk || CHUNK_S), dur = total / rate; let failed = null;
    await schedule(step + LEAD_S);
    for (let k = 1; k * step < dur; k++) {
      const chunkFn = async () => {
        try { await yieldNow(); /* ended-voice events before the next chunk */ if (signal && signal.aborted) throw abortErr(); onProgress && onProgress(Math.min(1, (k * step) / dur)); await schedule((k + 1) * step + LEAD_S); }
        catch (e) { failed = e; return false; }
      };
      if (col.timers) col.timers.at(k * step, chunkFn);
      else off.suspend(k * step).then(async () => { if ((await chunkFn()) !== false) off.resume(); });
    }
    const cancelled = new Promise((_, no) => { if (signal) signal.addEventListener('abort', () => no(abortErr()), { once: true }); });
    if (col.timers) col.timers.flush();
    const buf = await Promise.race([off.startRendering(), cancelled, new Promise((_, no) => { const iv = setInterval(() => { if (failed) { clearInterval(iv); no(failed); } }, 50); off.addEventListener('complete', () => clearInterval(iv)); })]);
    fails = f; retries = r; col.restore(); unpool(col.seen); onProgress && onProgress(1);
    await new Promise((r) => setTimeout(r, 300)); /* let the offline onended cleanups run while the offline context is still current */
    W.setAudioContext(live); W.setSuperdoughAudioController(ctl); swapped = false;
    const L = buf.getChannelData(0).slice(0, frames), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(0, frames);
    if (tail) { const tl = buf.getChannelData(0), tr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : tl; for (let i = 0; i < tail && i < frames; i++) { L[i] += tl[frames + i]; R[i] += tr[frames + i]; } }
    const db = S.settings && S.settings.masterDb != null ? S.settings.masterDb : (T.masterDb || 0); const g = db <= -60 ? 0 : Math.pow(10, db / 20); /* master level, so renders match realtime takes */
    if (g !== 1) for (let i = 0; i < frames; i++) { L[i] = Math.fround(L[i] * g); R[i] = Math.fround(R[i] * g); }
    return { L, R, sr: rate, haps: haps.length, fails, retries, warm, ...(hapInfo ? { hapInfo } : {}), ...(dbg && col && col.timers ? { timerStats: { ...col.timers.stats } } : {}) };
  } finally {
    if (rnd) Math.random = rnd;
    if (prevJ && sc.hooks) { sc.hooks.journal.length = 0; sc.hooks.journal.push(...prevJ); try { sc.hooks.undef('__scPerformTouch'); } catch (e) { /* cache bust */ } }
    if (col) col.restore();
    if (swapped) { try { W.setAudioContext(live); W.setSuperdoughAudioController(ctl); } catch (e) { /* restore */ } }
    if (prevCtl && C()) { try { const c = C(); c.load(prevCtl.model); if (c.setHistory) for (const [n, h] of Object.entries(prevCtl.hist)) if (h && h.length) c.setHistory(n, h); } catch (e) { /* keep */ } }
    if (wasRunning && live) live.resume().catch(() => {});
    st.rendering = false; sync();
  }
}
/* ---------- render host (docs/AUDIO_ENGINE.md, Part C) ----------
   Parent: one hidden same-origin iframe (index.html?host=render) created on first use and kept; render requests go by postMessage with the recipe
   (plus pinned sample maps and vox banks for Remake), progress comes back, the PCM comes back as transferred Float32Arrays. Cancel posts a cancel.
   Host: the same site with its own Strudel + superdough instance; it never plays, so its renders never touch the live context, its node pools
   hold no live nodes, and the parent's transport is never stopped. The host's main thread is the page's main thread (same origin), so the render
   yields every ~8 ms of voice construction and between chunks. */
const HS = { frame: null, ready: null, seq: 0, pending: new Map(), bootMs: null };
function hostFrame() {
  if (HS.ready) return HS.ready;
  const t0 = performance.now();
  HS.ready = new Promise((ok, no) => {
    const f = document.createElement('iframe'); f.src = new URL('index.html?host=render', document.baseURI).href; f.title = 'Offline render host'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.inert = true;
    f.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;border:0;visibility:hidden';
    const fail = setTimeout(() => { HS.ready = null; f.remove(); no(new Error('The offline render host did not start')); }, 90000);
    addEventListener('message', (e) => {
      if (e.source !== f.contentWindow || e.origin !== location.origin) return; const d = e.data || {};
      if (d.type === 'sc-host-ready') { clearTimeout(fail); HS.bootMs = Math.round(performance.now() - t0); ok(f); return; }
      const P = HS.pending.get(d.id); if (!P) return;
      if (d.type === 'sc-host-progress') P.onProgress && P.onProgress(d.p);
      else if (d.type === 'sc-host-done') { HS.pending.delete(d.id); P.ok(d.out); }
      else if (d.type === 'sc-host-error') { HS.pending.delete(d.id); P.no(Object.assign(new Error(d.message), { name: d.name || 'Error' })); }
    });
    document.body.append(f); HS.frame = f;
  });
  return HS.ready;
}
function renderViaHost(recipe, o = {}) { /* one render at a time in the host: requests queue */
  const job = (HS.queue || Promise.resolve()).catch(() => {}).then(async () => { st.rendering = true; sync(); try { return await renderViaHost0(recipe, o); } finally { st.rendering = false; sync(); } });
  HS.queue = job; return job;
}
async function renderViaHost0(recipe, o = {}) {
  const f = await hostFrame(); const id = ++HS.seq;
  if (o.signal && o.signal.aborted) throw abortErr();
  return new Promise((ok, no) => {
    HS.pending.set(id, { ok, no, onProgress: o.onProgress });
    if (o.signal) o.signal.addEventListener('abort', () => { f.contentWindow.postMessage({ type: 'sc-host-cancel', id }, location.origin); }, { once: true });
    f.contentWindow.postMessage({ type: 'sc-host-render', id, recipe: JSON.parse(JSON.stringify(recipe)), o: { sr: o.sr, chunk: o.chunk, maps: o.maps || null, vox: o.vox || null, dbg: o.dbg || null } }, location.origin);
  });
}
if (HOST) {
  const jobs = new Map();
  addEventListener('message', async (e) => {
    if (e.source !== parent || e.origin !== location.origin) return; const d = e.data || {};
    if (d.type === 'sc-host-cancel') { const j = jobs.get(d.id); if (j) j.abort(); return; }
    if (d.type !== 'sc-host-render') return;
    const ac = new AbortController(); jobs.set(d.id, ac); const post = (m, tr) => parent.postMessage(m, location.origin, tr || []);
    try {
      const T = sc.transport, code = d.recipe.state && d.recipe.state.source ? d.recipe.state.source.code : '';
      if (d.o.maps) for (const m of d.o.maps) await T.loadSampleMap(m); else if (T.ensureSamples) await T.ensureSamples(code);
      if (d.o.vox && window.voxBank) for (const u of d.o.vox) await window.voxBank(u);
      let last = 0; const out = await renderRecipe(d.recipe, { sr: d.o.sr, chunk: d.o.chunk, dbg: d.o.dbg, signal: ac.signal, onProgress: (p) => { const now = performance.now(); if (p >= 1 || now - last > 200) { last = now; post({ type: 'sc-host-progress', id: d.id, p }); } } });
      post({ type: 'sc-host-done', id: d.id, out }, [out.L.buffer, out.R.buffer]);
    } catch (err) { post({ type: 'sc-host-error', id: d.id, message: err.message || String(err), name: err.name }); } finally { jobs.delete(d.id); }
  });
  const ready = () => parent.postMessage({ type: 'sc-host-ready' }, location.origin);
  /* superdough caches its white / pink / brown noise buffers for the life of the page (noise.mjs); filled here once from a fixed seed, before any
     render, every render of the host sees the same buffers and the same Math.random sequence, so noise takes repeat too */
  const fillNoise = async () => { const W = window; if (typeof W.superdough !== 'function' || typeof W.setAudioContext !== 'function') return; const live = W.getAudioContext(), ctl = W.getSuperdoughAudioController(), rnd = Math.random;
    try { const off = new OfflineAudioContext(2, 2205, 44100); W.setAudioContext(off); W.setSuperdoughAudioController(null); Math.random = mulberry(0x5c0153); for (const n of ['white', 'pink', 'brown']) { try { await W.superdough({ s: n, gain: 0 }, 0.01, 0.01, 1, 0); } catch (e) { /* type missing */ } } await off.startRendering(); }
    finally { Math.random = rnd; W.setAudioContext(live); W.setSuperdoughAudioController(ctl); } };
  Promise.resolve(sc.packs && sc.packs.ready).catch(() => {}).then(() => (sc.transport && sc.transport.warm ? sc.transport.warm() : null)).then(fillNoise).catch(() => {}).then(ready);
}

/* ---------- offline Record (the panel's default source): the current program, N cycles from the transport range start, rendered by the host,
   no audible playback; events = the control histories and the pad / hooks journals as they stand ---------- */
function controlEvents(c0, c1) {
  const C = sc.perform && sc.perform.controls; if (!C || !C.history) return [];
  const out = []; for (const x of C.list()) { const h = C.history(x.name) || []; for (const e of h) if (isFinite(e.cycle) && e.cycle >= c0 - 1e-9 && e.cycle < c1 - 1e-9 && (e.value == null || typeof e.value !== 'object')) out.push({ cycle: +(+e.cycle).toFixed(4), control: x.name, value: e.value }); }
  return out.sort((a, b) => a.cycle - b.cycle);
}
async function recordOffline(ru) {
  const T = sc.transport; st.phase = 'rendering'; st.abort = new AbortController(); sync();
  try {
    const src = T.source(); if (!src || src.empty || !src.code) throw new Error('Nothing to render: pick a recipe or add Stack layers');
    const r = sc.range && sc.range.state; const pl = ru.plan; const c0 = ru.at != null ? ru.at : pl ? pl.startCycle : Math.max(0, Math.floor((r && +r.start) || 0)), c1 = c0 + ru.n;
    const cps = lenEnv().cps;
    const state = await codeState(src); const C = sc.perform && sc.perform.controls;
    const includes = { audio: true, events: !!opts.events, code: true };
    const events = { pads: padEvents(c0, c1), hooks: hookPadEntries(c1), controls: controlEvents(c0, c1), lanes: C ? (C.toModel().automation || {}) : {} };
    const timing = { cps: +(+cps).toFixed(6), start: c0, stop: c1, cycles: ru.n, loop: true, mode: 'offline', exact: true, fold: !!opts.fold, preRoll: 0, ...(pl ? metaFor(pl, ru.n, c0) : {}) };
    const recipe = await buildRecipe({ name: ru.name, includes, timing, state, events });
    const t0 = performance.now();
    const out = await renderRecipe(recipe, { signal: st.abort.signal, onProgress: (p) => { st.progress = p; if (el.state) el.state.textContent = `Rendering offline ${Math.round(p * 100)} %`; } });
    const rec = { id: recipe.id, recipe, audio: { render: { L: out.L, R: out.R, sr: out.sr } } };
    recipe.outputs.render = { sha256: await audioHash(out.L, out.R), sr: out.sr, frames: out.L.length, how: 'offline', encoding: 'f32le-interleaved', haps: out.haps, fails: out.fails, envelope: envelope(out.L, out.R, out.sr), ms: Math.round(performance.now() - t0) };
    await store.put(rec); renderTakes();
    toast(`Rendered "${recipe.name}" offline: ${pl ? `${N.fix(pl.bars, pl.bars % 1 ? 2 : 0)} bars from bar ${N.fix(pl.startBar, pl.startBar % 1 ? 2 : 0)}` : `${ru.n} cycles from cycle ${c0}`}, ${out.L.length} frames${out.fails ? `, ${out.fails} events failed` : ''}. Download`, { kind: out.fails ? 'info' : 'ok', ms: 6000, onClick: () => download(recipe.id, 'recipe') });
    return rec;
  } catch (e) { toast(e.name === 'AbortError' ? 'Offline render cancelled' : 'Offline render: ' + (e.message || e), { kind: e.name === 'AbortError' ? 'info' : 'error' }); return null; }
  finally { st.phase = 'idle'; st.abort = null; st.progress = 0; sync(); }
}
/* re-render a flagged live take from its recipe; the render becomes the take's audio (Play, WAV) and the live capture stays as outputs.capture */
async function rerender(id) {
  const rec = await store.get(id); if (!rec || !rec.recipe.state) { toast('This take has no code-state, so it cannot be re-rendered', { kind: 'error' }); return null; }
  try {
    const out = await renderRecipe(rec.recipe, { sr: rec.recipe.outputs.capture && rec.recipe.outputs.capture.sr, calm: true });
    rec.audio.render = { L: out.L, R: out.R, sr: out.sr }; rec.recipe.outputs.render = { sha256: await audioHash(out.L, out.R), sr: out.sr, frames: out.L.length, how: 'offline', encoding: 'f32le-interleaved', haps: out.haps, fails: out.fails, envelope: envelope(out.L, out.R, out.sr), ...(out.underLoad ? { underLoad: out.underLoad } : {}) };
    rec.replaced = { at: new Date().toISOString(), why: rec.recipe.outputs.capture && rec.recipe.outputs.capture.check ? rec.recipe.outputs.capture.check.why : 'manual' };
    await store.put(rec); renderTakes(); toast(`"${rec.recipe.name}" now plays its offline render`, { kind: 'ok' }); return rec;
  } catch (e) { failToast('Re-render', e); return null; }
}

/* Render exact N cycles of the current program as a recipe (code-state + render output) */
async function renderExact(n) {
  if (st.rendering || st.phase !== 'idle') return null;
  const T = sc.transport;
  try {
    const lp = n != null ? takePlan({ unit: 'cycles', value: Math.max(1, n | 0), toEnd: false, startBar: '' }) : takePlan(); if (!lp.ok) { toast('Render: ' + lp.error, { kind: 'error' }); return null; }
    const info = await T.compile(); n = lp.cycles; const c0 = lp.startCycle;
    const state = await codeState({ kind: info.kind, title: info.title, code: info.code });
    const includes = { audio: true, events: false, code: true };
    const recipe = await buildRecipe({ name: opts.name, includes, state, timing: { cps: +(+info.cps).toFixed(6), start: c0, stop: +(c0 + n).toFixed(6), cycles: n, loop: true, mode: 'cycles', exact: true, fold: !!opts.fold, preRoll: 0, ...metaFor(lp, n, c0) } });
    if (T.playing && FLAG_REC === 'inline') { T.stop(); await new Promise((r) => setTimeout(r, 150)); }
    const out = await renderRecipe(recipe);
    const rec = { id: recipe.id, recipe, audio: { render: { L: out.L, R: out.R, sr: out.sr } } };
    recipe.outputs.render = { sha256: await audioHash(out.L, out.R), sr: out.sr, frames: out.L.length, how: 'offline', encoding: 'f32le-interleaved', haps: out.haps, fails: out.fails, envelope: envelope(out.L, out.R, out.sr) };
    await store.put(rec); renderTakes();
    toast(`Rendered ${recipe.name}: ${N.fix(lp.bars, lp.bars % 1 ? 2 : 0)} bars (${N.fix(n, n % 1 ? 2 : 0)} cycles) from bar ${N.fix(lp.startBar, lp.startBar % 1 ? 2 : 0)}, ${out.L.length} frames${out.fails ? `, ${out.fails} events failed offline` : ''}`, { kind: out.fails ? 'info' : 'ok' });
    return rec;
  } catch (e) { failToast('Render', e); return null; }
}
function failToast(what, e) { if (e && e.name === 'AbortError') toast(what + ' cancelled', { kind: 'info' }); else toast(what + ': ' + ((e && e.message) || e), { kind: 'error' }); }

/* ---------- Remake: approve deps, trust unknown sources, verify pins, render, compare hashes ---------- */
const ask = (o) => sc.ui.askYesNo(o);
async function remake(id, { silent = false } = {}) {
  const rec = await store.get(id); if (!rec) return null; const r = rec.recipe;
  try { validate(r); } catch (e) { await ask({ title: 'Recipe refused', message: e.message, okText: 'OK' }); return { refused: e.message }; }
  if (!r.includes.code || !r.state) { await ask({ title: 'Cannot remake', message: `"${r.name}" has no code-state, so nothing can regenerate it. Record with Code-state ticked.`, okText: 'OK' }); return { refused: 'no code-state' }; }
  const refs = refsOf(r); const lines = r.state.source.code.split('\n').length;
  const list = refs.map((x) => `${x.kind} ${x.id}: ${x.ref} (${short(x.sha)})${x.known ? '' : ' [unknown source]'}${x.code && x.code.length ? ` [code ingredients not run: ${x.code.join(', ')}]` : ''}`).join('\n');
  if (!silent && !(await ask({ title: 'Remake: approve dependencies', message: `Runs the recipe's program (${lines} line${lines > 1 ? 's' : ''}, "${r.state.source.title || r.name}") with:\n${list}\nSite build ${r.deps.site.build}. Code ingredients from packs never run (sandbox, #71).`, okText: 'Approve and remake' }))) return { cancelled: true };
  for (const x of refs.filter((q) => !q.known && !trusted(q.id, q.sha))) {
    if (!(await ask({ title: `Trust ${x.id}?`, message: `${x.kind} ${x.id} comes from an unknown source:\n${x.ref}\npinned at ${x.sha}. Trust this exact version? (remembered for this id and hash)`, okText: 'Trust' }))) return { cancelled: true, untrusted: x.id };
    grant(x.id, x.sha);
  }
  const v = await verify(r); const bad = v.refs.find((q) => !q.ok);
  if (bad) {
    const msg = `${bad.kind} ${bad.id} (${bad.ref}): ${bad.error ? bad.error : `expected ${bad.sha}, got ${bad.have}`}. Nothing was loaded or run.`;
    await ask({ title: 'Load refused: hash mismatch', message: msg, okText: 'OK' }); toast('Remake refused: ' + bad.id, { kind: 'error' }); return { refused: bad.id, ref: bad.ref };
  }
  const maps = []; for (const s of r.deps.samples) { const q = v.refs.find((x) => x.kind === 'samples' && x.id === s.bank); const map = JSON.parse(new TextDecoder().decode(q.bytes)); const sha = /@([0-9a-f]{40})\//.exec(s.source)[1]; if (typeof map._base === 'string') map._base = map._base.replace(/\/(main|master)\//, `/${sha}/`); maps.push(map); }
  const vox = r.deps.vox.map((b) => b.url);
  if (FLAG_REC === 'inline') { for (const m of maps) await sc.transport.loadSampleMap(m); for (const u of vox) if (window.voxBank) await window.voxBank(u); } /* the render host loads them itself (renderViaHost o.maps / o.vox) */
  const notes = [...v.notes]; if (r.deps.site.build !== (await siteBuild())) notes.push(`Made with site build ${r.deps.site.build}, this is ${await siteBuild()}.`);
  let out; try { out = await renderRecipe(r, { maps, vox }); } catch (e) { toast('Remake: ' + e.message, { kind: 'error' }); return { error: e.message }; }
  if (r.events && r.events.pads && r.events.pads.length && !r.events.hooks) notes.push('Pad events were recorded but this recipe has no hooks journal, so they are not replayed.');
  if (r.events && r.events.performance) notes.push('Looper pad takes are not replayed in offline renders yet: the render plays the program without the looper.');
  const got = await audioHash(out.L, out.R); const want = r.outputs.render ? r.outputs.render.sha256 : null;
  let match = want ? got === want : null, tol = null;
  /* bit-exact first; otherwise the level fingerprint within 1.5 dB. Noise is random per session, and very low filter cutoffs can render with
     tiny numeric differences between runs (denormal handling in the browser's offline audio thread), so these compare by tolerance and say so */
  if (want && !match && r.outputs.render.envelope) { tol = envelopeMatch(r.outputs.render.envelope, envelope(out.L, out.R, out.sr)); if (tol.ok) { match = 'tolerance';
    notes.push(`${usesNoise(r.state.source.code) ? 'Noise is random per session' : 'The bit-exact hash differs (tiny numeric differences, e.g. very low filter cutoffs)'}, so this take is compared by its level fingerprint: ${tol.blocks} blocks of 10 ms, max ${tol.maxDb} dB apart (tolerance ${tol.tolDb} dB).`); } }
  rec.audio.remake = { L: out.L, R: out.R, sr: out.sr }; rec.remake = { at: new Date().toISOString(), sha256: got, match, tolerance: tol, notes }; await store.put(rec); renderTakes();
  if (match === true) toast(`Remake matches the stored audio (sha256 ${short(got)})${notes.length ? '. ' + notes.join(' ') : ''}`, { kind: 'ok', ms: notes.length ? 9000 : 4000 });
  else if (match === 'tolerance') toast(`Remake matches within tolerance (level fingerprint, max ${tol.maxDb} dB apart); the bit-exact hash differs. ${notes.join(' ')}`, { kind: 'ok', ms: 9000 });
  else if (!silent) await ask({ title: want ? 'Remake differs' : 'Remake done (no exact render stored)', message: want ? `Stored ${want}\nRemade ${got}\n${notes.join('\n') || 'All pinned dependencies verified; the difference comes from randomness or state outside the recipe (see docs/CAPTURE.md).'}` : `Remade ${got}. This take kept only a realtime capture, which cannot be compared bit for bit; the remake is stored as its exact render.`, okText: 'OK' });
  return { match, tolerance: tol, sha256: got, expected: want, notes, haps: out.haps, fails: out.fails };
}
let buildP = null; const siteBuild = () => (buildP = buildP || fetch('build.json', { cache: 'no-store' }).then((x) => x.json()).then((b) => b.sha).catch(() => 'dev'));

/* ---------- import / export ---------- */
function exportRecipe(rec) { return JSON.parse(JSON.stringify(rec.recipe)); }
async function importRecipe(fileOrText) {
  const text = typeof fileOrText === 'string' ? fileOrText : await fileOrText.text();
  let r; try { r = JSON.parse(text); } catch (e) { throw new Error('Not JSON'); }
  validate(r);
  if (await store.get(r.id)) r = { ...r, id: newId(), name: await uniqueName(r.name) };
  await store.put({ id: r.id, recipe: r, audio: {}, imported: new Date().toISOString() }); renderTakes();
  toast(`Imported ${r.name}: inert until you press Remake and approve its dependencies`, { kind: 'ok' }); return r.id;
}

/* ---------- Perform lane / pad takes land in the same timeline as event recipes ---------- */
addEventListener('perform:take', async (e) => {
  const d = e.detail || {}; const fr = (x) => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(x)); return m ? +m[1] / +(m[2] || 1) : +x; };
  try {
    const sch = sc.transport && sc.transport.scheduler; const cps = (sch && sch.cps) || 0.5;
    const len = d.type === 'pads' ? fr(d.performance.length) : fr(d.lane.period || d.lane.length || 1), start = d.type === 'pads' ? fr(d.performance.origin || 0) : 0;
    const events = d.type === 'pads' ? { pads: [], controls: [], lanes: {}, performance: d.performance, bank: d.bank, targets: d.pads || {} } : { pads: [], controls: [], lanes: { ['lane:' + d.control]: d.lane } };
    const recipe = await buildRecipe({ name: d.type === 'pads' ? 'pads-' + (d.bank || 'take') : 'lane-' + d.control, includes: { audio: false, events: true, code: true }, state: await codeState(), events,
      timing: { cps: +(+cps).toFixed(6), start, stop: start + len, cycles: len, loop: true, mode: 'cycles', exact: true, fold: !!opts.fold, preRoll: 0 } });
    await store.put({ id: recipe.id, recipe, audio: {} }); renderTakes();
    toast(`Take saved: ${recipe.name}. Download`, { kind: 'ok', ms: 6000, onClick: () => download(recipe.id, 'recipe') });
  } catch (err) { toast('Could not keep the take: ' + err.message, { kind: 'error' }); }
});
function eventCode(r) {
  const ev = r.events; if (!ev) return '';
  const lanes = Object.entries(ev.lanes || {}); const name = (s) => String(s).replace(/[^\w]/g, '_').replace(/^(\d)/, '_$1');
  let code = lanes.map(([id, l]) => (sc.controls && sc.controls.lib ? sc.controls.lib.laneCode(l, name(id.replace(/^lane:/, 'lane_'))) : '')).join('');
  if (ev.performance && sc.pads && sc.pads.lib) code += sc.pads.lib.bounceCode(ev.performance, { pads: ev.targets || {}, name: r.name });
  return code;
}

/* ---------- encode + download ---------- */
function infoChunk(fields) {
  const enc = new TextEncoder(); const parts = Object.entries(fields).map(([id, v]) => { const b = enc.encode(String(v) + '\0'); return { id, b, pad: b.length & 1 }; });
  const size = 4 + parts.reduce((a, p) => a + 8 + p.b.length + p.pad, 0); const out = new Uint8Array(8 + size); const dv = new DataView(out.buffer);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  w4(0, 'LIST'); dv.setUint32(4, size, true); w4(8, 'INFO'); let o = 12;
  for (const p of parts) { w4(o, p.id); dv.setUint32(o + 4, p.b.length, true); out.set(p.b, o + 8); o += 8 + p.b.length + p.pad; }
  return out;
}
/* PCM WAV, 16 or 24 bit stereo; LIST/INFO carries the name, recipe id and the output's sha256 */
function encodeWav(a, bits = 16, info = {}) {
  const { L, R, sr: rate } = a, n = L.length, bps = bits === 24 ? 3 : 2, data = n * 2 * bps;
  const ic = infoChunk({ INAM: info.name || 'take', ISFT: 'Strudel Craft recorder', ICRD: (info.created || new Date().toISOString()).slice(0, 10), ICMT: JSON.stringify(info.comment || {}) });
  const buf = new ArrayBuffer(44 + ic.length + data), dv = new DataView(buf), u8 = new Uint8Array(buf);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) u8[o + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, 36 + ic.length + data, true); w4(8, 'WAVE');
  w4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2 * bps, true); dv.setUint16(32, 2 * bps, true); dv.setUint16(34, bits === 24 ? 24 : 16, true);
  u8.set(ic, 36); let o = 36 + ic.length; w4(o, 'data'); dv.setUint32(o + 4, data, true); o += 8;
  const max = bits === 24 ? 8388607 : 32767;
  for (let i = 0; i < n; i++) for (const ch of [L, R]) {
    let v = Math.round(Math.max(-1, Math.min(1, ch[i])) * max);
    if (bps === 2) { dv.setInt16(o, v, true); o += 2; } else { if (v < 0) v += 0x1000000; u8[o] = v & 255; u8[o + 1] = (v >> 8) & 255; u8[o + 2] = (v >> 16) & 255; o += 3; }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const baseName = (r) => `${safe(r.name)}_${numStr(r.timing.cycles)}c_${numStr(r.timing.cps)}cps`;
const bestAudio = (rec) => rec.audio.render ? ['render', rec.audio.render] : rec.audio.capture ? ['capture', rec.audio.capture] : rec.audio.remake ? ['remake', rec.audio.remake] : [null, null];
async function download(id, fmt = 'recipe') {
  const rec = await store.get(id); if (!rec) return; const r = rec.recipe;
  if (fmt === 'recipe') return saveBlob(new Blob([JSON.stringify(exportRecipe(rec), null, 2)], { type: 'application/json' }), baseName(r) + '.recipe.json');
  if (fmt === 'webm') { const w = rec.audio.webm; if (!w) { toast(WEBM_MIME ? 'This take has no compressed audio (only realtime takes with Audio ticked have it)' : 'This browser cannot record webm/opus (MediaRecorder)', { kind: 'info' }); return; } return saveBlob(w.blob, baseName(r) + (/ogg/.test(w.mime) ? '.ogg' : '.webm')); }
  const [k, a] = fmt === 'wav16' || fmt === 'wav24' ? bestAudio(rec) : [fmt, rec.audio[fmt]];
  if (!a) { toast('This take has no audio yet: Remake it first', { kind: 'info' }); return; }
  return saveBlob(encodeWav(a, fmt === 'wav24' || opts.bits === 24 && fmt !== 'wav16' ? 24 : 16, { name: r.name, created: r.created, comment: { recipe: r.id, output: k, sha256: (r.outputs[k] || rec.remake || {}).sha256, cps: r.timing.cps, cycles: r.timing.cycles } }), baseName(r) + (k === 'capture' ? '' : '_' + k) + '.wav');
}

/* ---------- UI ---------- */
const ICON_REC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" class="cap-dot"/><circle cx="12" cy="12" r="10" class="cap-ring"/></svg>';
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" class="fill"/></svg>',
  remake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>',
  dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  ren: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>',
  del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
};
let el = {};
function seg(name, label, items, val) {
  return `<fieldset class="cap-seg" data-k="${name}"><legend>${label}</legend>${items.map(([v, t]) => `<label><input type="radio" name="cap-${name}" value="${v}"${String(v) === String(val) ? ' checked' : ''}><span>${t}</span></label>`).join('')}</fieldset>`;
}
function build() {
  if ($('#capSheet')) return;
  const tb = document.createElement('button'); tb.type = 'button'; tb.id = 'capBtn'; tb.className = 'tp-btn cap-btn'; tb.setAttribute('aria-label', 'Record panel'); tb.setAttribute('aria-expanded', 'false'); tb.setAttribute('aria-controls', 'capSheet'); tb.title = 'Record (audio, events, code-state)';
  tb.innerHTML = ICON_REC; tb.addEventListener('click', () => toggleSheet());
  const host = $('.tp-main'); if (host) host.append(tb);
  const w = document.createElement('section'); w.id = 'capSheet'; w.className = 'cap'; w.hidden = true; w.setAttribute('aria-label', 'Record');
  w.innerHTML = `
  <div class="cap-head">
    <button type="button" class="cap-rec" id="capRec" aria-pressed="false">${ICON_REC}<span id="capRecLabel">Record</span></button>
    <div class="cap-read"><output id="capTime" class="cap-time num" style="--w:8ch">00:00.0</output><span id="capState" class="cap-state" role="status" aria-live="polite">Ready</span></div>
    <canvas id="capMeter" class="cap-meter" role="img" aria-label="Record input level"></canvas>
    <button type="button" class="icon ghost" id="capClose" aria-label="Close record panel">&times;</button>
  </div>
  <div class="cap-prog" id="capProg" hidden><div class="cap-bar" role="progressbar" aria-label="Offline render progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="capBar"></i></div><output id="capPct" class="cap-pct num">0 %</output><button type="button" id="capCancel" class="cap-cancel">Cancel</button></div>
  <fieldset class="cap-inc"><legend>Include</legend>
    <label class="switch"><input id="capInc_audio" type="checkbox"${opts.audio ? ' checked' : ''}><span>Audio</span></label>
    <label class="switch"><input id="capInc_events" type="checkbox"${opts.events ? ' checked' : ''}><span>Events (lanes, pads, controls)</span></label>
    <label class="switch"><input id="capInc_code" type="checkbox"${opts.code ? ' checked' : ''}><span>Code-state</span></label>
  </fieldset>
  <div class="cap-opts">
    ${seg('source', 'Source', [['offline', 'Offline render'], ['live', 'Live capture']], opts.source)}
    ${seg('mode', 'Arm', [['free', 'Free'], ['cycles', 'Cycles'], ['until', 'Until stop']], opts.mode)}
    <div class="cap-len">
      ${seg('unit', 'Length', [['bars', 'Bars'], ['cycles', 'Cycles'], ['seconds', 'Seconds']], opts.unit)}
      <div class="cap-lenrow">
        <button type="button" class="ghost cap-stepb" data-step="-1" aria-label="Shorter">-</button>
        <input id="capLen" class="cap-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="done" aria-label="Length" aria-describedby="capDerive capLenErr" value="${opts.len}">
        <button type="button" class="ghost cap-stepb" data-step="1" aria-label="Longer">+</button>
        <button type="button" class="ghost cap-endchip" id="capToEnd" aria-pressed="${opts.toEnd}">To end of track</button>
      </div>
      <div class="cap-chips" id="capChips" role="group" aria-label="Quick lengths"></div>
      <div class="cap-lenrow cap-fromto">
        <label class="cap-sel"><span class="cap-lab">Start bar</span><input id="capStart" class="cap-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="done" placeholder="transport start" aria-describedby="capLenErr" value="${esc(opts.startBar)}"></label>
        <label class="cap-sel" id="capEndLab"><span class="cap-lab">End bar (to end)</span><input id="capEnd" class="cap-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="done" placeholder="auto" aria-describedby="capLenErr" value="${esc(opts.endBar)}"></label>
      </div>
      <p class="cap-derive" id="capDerive" aria-live="polite"></p>
      <p class="cap-err" id="capLenErr" role="alert" hidden></p>
    </div>
    <label class="cap-sel"><span class="cap-lab">Count-in</span><select id="capCount">${[0, 1, 2, 4].map((v) => `<option value="${v}"${v === opts.countIn ? ' selected' : ''}>${v ? v + ' cyc' : 'Off'}</option>`).join('')}</select></label>
    <label class="cap-sel"><span class="cap-lab">Pre-roll</span><select id="capPre">${[0, 0.5, 1, 2, 4].map((v) => `<option value="${v}"${v === opts.preRoll ? ' selected' : ''}>${v ? v + ' s' : 'Off'}</option>`).join('')}</select></label>
    <label class="cap-name"><span class="cap-lab">Name</span><input id="capName" type="text" autocomplete="off" spellcheck="false" enterkeyhint="done" maxlength="60" value="${esc(opts.name)}"></label>
    ${seg('bits', 'WAV', [[16, '16 bit'], [24, '24 bit']], opts.bits)}
  </div>
  <div class="cap-exact"><button type="button" id="capExact" class="ghost">Render exact <b id="capExactN"></b></button><label class="switch"><input id="capFold" type="checkbox"${opts.fold ? ' checked' : ''}><span>Fold tail (seamless)</span></label></div>
  <p class="cap-hint" id="capHint"></p>
  <div class="cap-imp"><button type="button" id="capImport" class="ghost">Import recipe</button><input type="file" id="capFile" accept="application/json,.json" hidden></div>
  <ol class="cap-takes" id="capTakes" aria-label="Takes"></ol>
  <p class="cap-quota" id="capQuota"></p>`;
  document.body.append(w);
  el = { tb, w, rec: $('#capRec'), lab: $('#capRecLabel'), time: $('#capTime'), state: $('#capState'), meter: $('#capMeter'), hint: $('#capHint'), takes: $('#capTakes'), exact: $('#capExact'), prog: $('#capProg'), bar: $('#capBar'), pct: $('#capPct') };
  $('#capCancel').addEventListener('click', cancelRender);
  $('#capClose').addEventListener('click', () => close());
  el.rec.addEventListener('click', () => toggleRec());
  el.exact.addEventListener('click', () => renderExact());
  $('#capImport').addEventListener('click', () => $('#capFile').click());
  $('#capFile').addEventListener('change', async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { await importRecipe(f); } catch (err) { await sc.ui.askYesNo({ title: 'Import refused', message: err.message, okText: 'OK' }); } });
  w.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'cap-source') configure({ source: t.value }); else if (t.name === 'cap-mode') configure({ mode: t.value }); else if (t.name === 'cap-bits') configure({ bits: +t.value }); else if (t.name === 'cap-unit') setUnit(t.value);
    else if (t.id === 'capLen') commitLen(); else if (t.id === 'capStart') { const r = RL.parseStartBar(t.value); if (r.ok) configure({ startBar: t.value }); else updateLen(); } else if (t.id === 'capEnd') { const r = RL.parseStartBar(t.value); if (r.ok) configure({ endBar: t.value }); else updateLen(); }
    else if (t.id === 'capCount') configure({ countIn: +t.value }); else if (t.id === 'capPre') configure({ preRoll: +t.value });
    else if (t.id === 'capFold') configure({ fold: t.checked }); else if (t.id === 'capName') configure({ name: t.value });
    else if (t.id && t.id.startsWith('capInc_')) configure({ [t.id.slice(7)]: t.checked });
  });
  w.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]'); if (s) { const k = opts.unit === 'seconds' ? 5 : 1; configure({ len: Math.max(k, +(opts.len + k * +s.dataset.step).toFixed(3)), toEnd: false }); return; }
    const ch = e.target.closest('[data-chip]'); if (ch) { configure({ len: +ch.dataset.chip, toEnd: false }); return; }
    if (e.target.closest('#capToEnd')) { configure({ toEnd: !opts.toEnd }); return; }
    const b = e.target.closest('[data-act]'); if (!b) return; const li = b.closest('[data-id]'); if (li) takeAct(b.dataset.act, li.dataset.id, b);
  });
  w.addEventListener('input', (e) => { const t = e.target; if (t.id === 'capLen' || t.id === 'capStart' || t.id === 'capEnd') typing(t); });
  w.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (st.rendering || st.phase === 'rendering')) { e.stopPropagation(); cancelRender(); return; }
    if (e.key === 'Escape' && !w.closest('.ws-body')) { e.stopPropagation(); close(); } });
  sync();
}
/* length fields: typed input validates live (inline error, nothing persisted until valid), chips and steps set the number, "To end of track" resolves the end */
const fx = (v) => N.fix(v, v % 1 ? 2 : 0);
function lenSum() { const p = takePlan(); return p.ok ? (p.toEnd ? `to the end of track, bar ${fx(p.endBar)}` : `${fx(p.bars)} bars`) + ` from bar ${fx(p.startBar)}` : 'an invalid length'; }
function typing(t) {
  const r = t.id === 'capLen' ? RL.parseLen(t.value, opts.unit) : RL.parseStartBar(t.value);
  if (!r.ok) { showErr(r.error, t); return; }
  if (t.id === 'capLen') { opts.len = r.value; opts.toEnd = false; set('len', r.value); set('toEnd', false); }
  else if (t.id === 'capStart') { opts.startBar = t.value.trim(); set('startBar', opts.startBar); } else { opts.endBar = t.value.trim(); set('endBar', opts.endBar); }
  updateLen(t);
}
function commitLen() { const t = $('#capLen'), r = RL.parseLen(t.value, opts.unit); if (r.ok) configure({ len: r.value, toEnd: false }); else showErr(r.error, t); }
function setUnit(u) {
  const env = lenEnv(), c = RL.toCycles(opts.len, opts.unit, env), v = u === 'bars' ? c / env.cpb : u === 'seconds' ? c / env.cps : c;
  configure({ unit: u, len: +v.toFixed(u === 'seconds' ? 1 : 2) || 1 });
}
function showErr(msg, field) { const e = $('#capLenErr'); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; for (const i of el.w.querySelectorAll('.cap-in')) i.removeAttribute('aria-invalid'); if (msg && field) field.setAttribute('aria-invalid', 'true'); }
function updateLen(active) {
  if (!el.w) return;
  const p = takePlan(), busy = st.phase !== 'idle';
  const inp = $('#capLen'); if (inp && inp !== active && inp !== document.activeElement) inp.value = String(+(+opts.len).toFixed(3));
  for (const [id, v] of [['capStart', opts.startBar], ['capEnd', opts.endBar]]) { const i = $('#' + id); if (i && i !== active && i !== document.activeElement) i.value = v; }
  $('#capEndLab').hidden = !opts.toEnd; $('#capToEnd').setAttribute('aria-pressed', String(opts.toEnd)); inp.disabled = opts.toEnd || busy;
  $('#capChips').innerHTML = RL.CHIPS[opts.unit].map((v) => `<button type="button" class="ghost cap-chip" data-chip="${v}" aria-pressed="${!opts.toEnd && +opts.len === v}"${busy ? ' disabled' : ''}>${v}</button>`).join('');
  for (const b of el.w.querySelectorAll('.cap-stepb')) b.disabled = busy || opts.toEnd;
  const d = $('#capDerive'), x = $('#capExactN');
  if (p.ok) {
    const how = p.toEnd && p.end ? (opts.endBar ? 'typed end' : { gates: 'last gate section', marker: 'marker "end"', loop: 'Loop range end', period: 'longest lane period' }[p.end.rule]) : '';
    d.textContent = `${fx(p.bars)} bars \u00b7 ${fx(p.cycles)} cycles \u00b7 ${N.clock(p.seconds, { tenths: true })} \u00b7 bar ${fx(p.startBar)} to ${fx(p.endBar)} (last bar ${fx(p.endBar - 1)})${how ? ' \u00b7 end: ' + how : ''}`;
    x.textContent = p.toEnd ? `to end (bar ${fx(p.endBar)})` : `${fx(opts.unit === 'bars' ? p.bars : opts.unit === 'cycles' ? p.cycles : p.seconds)} ${opts.unit}`;
    showErr('');
  } else { d.textContent = ''; x.textContent = '-'; showErr(p.error, p.field === 'start' ? $('#capStart') : p.field === 'end' ? $('#capEnd') : inp); }
}
function sync() {
  if (!el.w) return;
  const busy = st.phase !== 'idle';
  el.rec.setAttribute('aria-pressed', String(busy)); el.lab.textContent = st.phase === 'waiting' || st.phase === 'rendering' ? 'Cancel' : busy ? 'Stop' : opts.source === 'offline' ? 'Render' : 'Record';
  el.w.dataset.phase = st.phase; el.tb.dataset.phase = st.phase; document.body.classList.toggle('capturing', busy);
  el.tb.setAttribute('aria-label', busy ? 'Record panel: recording' : 'Record panel');
  el.exact.disabled = st.rendering || busy; el.exact.firstChild.textContent = st.rendering ? 'Rendering ' : 'Render exact ';
  el.rec.disabled = st.rendering && st.phase !== 'rendering'; /* Cancel stays available while an offline Record renders */
  for (const i of el.w.querySelectorAll('.cap-opts input, .cap-opts select, .cap-opts button, .cap-inc input')) i.disabled = busy;
  updateLen();
  const inc = ['audio', 'events', 'code'].filter((k) => opts[k]).map((k) => (k === 'code' ? 'code-state' : k)).join(' + ') || 'nothing';
  el.w.dataset.source = opts.source;
  el.prog.hidden = !(st.rendering || st.phase === 'rendering'); if (el.prog.hidden) { el.bar.style.width = '0%'; }
  if (opts.source === 'offline') { el.hint.textContent = `Offline render: ${lenSum()} of the current program, rendered in the background with no playback (the live engine keeps playing). Hooks, pads, control histories and lanes are in the recipe; Arm, count-in and pre-roll apply to live capture only.`; if (!busy) { el.state.textContent = st.rendering ? 'Rendering offline' : 'Ready'; el.time.textContent = '00:00.0'; } return; }
  el.hint.textContent = (opts.mode === 'cycles' ? `Cycles: starts and stops on cycle boundaries (${lenSum()}), loops cleanly; with audio + code-state the transport stops at the end for an exact reference render.` : opts.mode === 'until' ? 'Until stop: records until you stop or the play-time limit.' : 'Free: records from now until you stop.') + ` Records ${inc}.` + (WEBM_MIME ? ' Realtime audio takes also keep a WebM/opus copy.' : ' WebM/opus copies are not available in this browser (no MediaRecorder opus); WAV only.');
  if (!busy) { el.state.textContent = st.rendering ? 'Rendering offline' : 'Ready'; el.time.textContent = '00:00.0'; }
}
function draw() {
  if (!el.w || el.w.hidden && st.phase === 'idle') return;
  const rate = sr(), now = st.tapCtx ? st.tapCtx.currentTime * rate : 0;
  if (st.phase === 'waiting') { const ck = clock(); const left = (st.recFrame - now) / rate; el.time.textContent = '-' + fmtT(left); el.state.textContent = ck && st.startCycle != null ? `Count-in: ${Math.max(0, Math.ceil(left * ck.cps))}` : 'Starting'; }
  else if (st.phase === 'recording') {
    const t = (now - st.recFrame) / rate; el.time.textContent = fmtT(t);
    el.state.textContent = st.run.mode === 'cycles' ? `Cycle ${N.cyc(Math.min(st.run.n, t * st.cps)).padStart(N.cyc(st.run.n).length, '\u2007')} / ${N.cyc(st.run.n)}` : st.run.mode === 'until' ? `Cap ${fmtT((st.endFrame - st.recFrame) / rate)}` : 'Recording';
  }
  const c = el.meter, dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (!W || !H) return; if (c.width !== W) c.width = W; if (c.height !== H) c.height = H;
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(el.w); const db = st.peak > 0 ? 20 * Math.log10(st.peak) : -90; const x = Math.max(0, Math.min(1, (db + 60) / 60)) * W;
  g.fillStyle = cs.getPropertyValue('--line').trim() || '#262d36'; g.fillRect(0, 0, W, H);
  g.fillStyle = db > -1 || st.phase === 'recording' ? (cs.getPropertyValue('--bad').trim() || '#f66') : (cs.getPropertyValue('--sig-2').trim() || '#2fd6c3'); g.fillRect(0, 0, x, H);
  st.peak *= 0.92;
}
function peaksOf(a, cols = 160) {
  const out = new Float32Array(cols * 2); if (!a) return out; const { L, R } = a, step = L.length / cols;
  for (let c = 0; c < cols; c++) { let lo = 0, hi = 0; for (let i = Math.floor(c * step), e = Math.min(L.length, Math.floor((c + 1) * step)); i < e; i++) { const v = (L[i] + R[i]) / 2; if (v < lo) lo = v; if (v > hi) hi = v; } out[c * 2] = lo; out[c * 2 + 1] = hi; }
  return out;
}
async function renderTakes() {
  if (!el.takes) return;
  const list = await store.list();
  el.takes.innerHTML = list.length ? list.map(({ recipe: r, audio, remake: rm, imported, replaced }) => {
    const hasAudio = !!(audio.render || audio.capture || audio.remake);
    const ck = r.outputs && r.outputs.capture && r.outputs.capture.check;
    const ul = r.outputs && r.outputs.render && r.outputs.render.underLoad;
    const chips = ['audio', 'events', 'code'].filter((k) => r.includes[k]).map((k) => `<i class="cap-badge" data-type="${k}">${k === 'code' ? 'code' : k}</i>`).join('')
      + (r.timing.mode === 'offline' ? '<i class="cap-badge" data-type="ok">offline</i>' : '') + (ul ? '<i class="cap-badge" data-type="bad" title="rendered while the main thread was busy; re-render offline recommended">under load</i>' : '') + (ck && !ck.ok ? `<i class="cap-badge" data-type="bad" title="${esc(ck.why)}">${replaced ? "replaced" : "flagged"}</i>` : '');
    const ver = rm ? (rm.match === 'tolerance' ? '<i class="cap-badge" data-type="ok">remake ~ok</i>' : rm.match === true ? '<i class="cap-badge" data-type="ok">remake ok</i>' : rm.match === false ? '<i class="cap-badge" data-type="bad">differs</i>' : '') : imported ? '<i class="cap-badge" data-type="inert">inert</i>' : '';
    const loadRow = ul ? `<p class="cap-flag" role="note"><b>Rendered under load</b> the main thread was busy (${ul.gapMs} ms gaps after waiting ${Math.round(ul.waitedMs / 1000)} s), so this render may differ from a calm one. <button type="button" data-act="rerender">Re-render offline</button></p>` : '';
    const flagRow = ck && !ck.ok ? `<p class="cap-flag" role="note"><b>${replaced ? 'Replaced' : 'Dropouts'}</b> ${esc(ck.why)}${replaced ? '. This take plays its offline render.' : '. The live capture may have gaps or timing jumps.'}${!replaced && r.includes.code ? ' <button type="button" data-act="rerender">Re-render offline</button>' : ''}</p>` : '';
    const deps = r.deps.packs.length + r.deps.samples.length + r.deps.vox.length + 1;
    return `<li data-id="${r.id}" class="cap-tk"${ck && !ck.ok ? ' data-flag="1"' : ''}>
    <canvas class="cap-wave" aria-hidden="true"></canvas>
    <div class="cap-tk-info"><b class="cap-tk-name">${chips}${ver}<span class="cap-tk-label">${esc(r.name)}</span></b><span class="cap-tk-sub">${N.cyc(r.timing.cycles)}c · ${N.fix(r.timing.cps, 3)} cps · c${N.cyc(r.timing.start)}-${N.cyc(r.timing.stop)}${r.meta && r.meta.from ? ' · from ' + esc(r.meta.from) : ''} · ${deps} dep${deps > 1 ? 's' : ''}${r.outputs.render ? ' · ' + short(r.outputs.render.sha256) : ''}</span></div>
    ${flagRow}${loadRow}
    <div class="cap-tk-acts">
      <button type="button" class="ghost icon" data-act="play" aria-label="Play ${esc(r.name)}" aria-pressed="false"${hasAudio ? '' : ' disabled'}>${ICON.play}</button>
      <button type="button" class="ghost icon" data-act="remake" aria-label="Remake ${esc(r.name)}"${r.includes.code ? '' : ' disabled'}>${ICON.remake}</button>
      <button type="button" class="ghost icon" data-act="rename" aria-label="Rename ${esc(r.name)}">${ICON.ren}</button>
      <button type="button" class="ghost icon" data-act="del" aria-label="Delete ${esc(r.name)}">${ICON.del}</button>
    </div>
    <div class="cap-dl"><button type="button" data-act="recipe">Recipe</button>${hasAudio ? '<button type="button" data-act="wav">WAV</button>' : ''}${audio.webm ? '<button type="button" data-act="webm" title="Compressed take, opus in webm (length within about 0.1 s of the cycle cut)">WebM</button>' : ''}${r.events && (Object.keys(r.events.lanes || {}).length || r.events.performance) ? '<button type="button" data-act="code">Copy code</button>' : ''}</div>
  </li>`;
  }).join('') : '<li class="cap-empty">No takes yet. Record or render one; takes stay on this device as recipes.</li>';
  for (const li of el.takes.querySelectorAll('li[data-id]')) { const rec = list.find((x) => x.id === li.dataset.id); const [, a] = bestAudio(rec); if (a) wave(li.querySelector('canvas'), peaksOf(a)); else eventWave(li.querySelector('canvas'), rec.recipe); }
  quota();
}
function wave(c, pk) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round((c.clientWidth || 96) * dpr), H = Math.round((c.clientHeight || 40) * dpr); c.width = W; c.height = H;
  const g = c.getContext('2d'), cols = pk.length / 2, cs = getComputedStyle(c);
  let mx = 1e-6; for (const v of pk) mx = Math.max(mx, Math.abs(v)); const k = (H / 2 - dpr) / Math.max(mx, 0.05);
  g.fillStyle = cs.getPropertyValue('--sig-2').trim() || '#2fd6c3';
  for (let i = 0; i < cols; i++) { const x = Math.floor(i * W / cols), w = Math.max(1, Math.floor(W / cols) - (W / cols > 2 ? 1 : 0)); const y0 = H / 2 - pk[i * 2 + 1] * k, y1 = H / 2 - pk[i * 2] * k; g.fillRect(x, y0, w, Math.max(dpr, y1 - y0)); }
}
function eventWave(c, r) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round((c.clientWidth || 96) * dpr), H = Math.round((c.clientHeight || 40) * dpr); c.width = W; c.height = H;
  const g = c.getContext('2d'), cs = getComputedStyle(c); g.fillStyle = cs.getPropertyValue('--sig').trim() || '#ff6a1a';
  const ev = r.events || {}, t0 = r.timing.start, len = r.timing.cycles || 1; const xs = [...(ev.pads || []).map((e) => e.cycle - t0), ...(ev.controls || []).map((e) => e.cycle - t0)];
  if (ev.performance) for (const l of ev.performance.layers) for (const e of l.events) { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(e.t)); xs.push(m ? +m[1] / +(m[2] || 1) : +e.t); }
  for (const l of Object.values(ev.lanes || {})) for (const p of l.points || []) { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(p[0])); xs.push(m ? +m[1] / +(m[2] || 1) : +p[0]); }
  for (const x of xs) g.fillRect(Math.floor(Math.max(0, Math.min(1, x / len)) * (W - 2 * dpr)), H * 0.2, 1.5 * dpr, H * 0.6);
  if (!xs.length) { g.fillStyle = cs.getPropertyValue('--line').trim() || '#262d36'; g.fillRect(0, H / 2, W, dpr); }
}
let player = null, playerId = null;
async function takeAct(act, id, btn) {
  const li = btn.closest('li');
  if (act === 'play') {
    if (player && playerId === id) { player.pause(); return; }
    if (player) player.pause();
    const rec = await store.get(id); const [, a] = bestAudio(rec); if (!a) return;
    const au = new Audio(); au.src = URL.createObjectURL(encodeWav(a, 16, { name: rec.recipe.name })); au.loop = true; player = au; playerId = id; /* HTMLAudio, not the WebAudio bus: previews are never recorded */
    btn.setAttribute('aria-pressed', 'true');
    au.onpause = () => { btn.setAttribute('aria-pressed', 'false'); URL.revokeObjectURL(au.src); if (player === au) { player = null; playerId = null; } };
    au.play().catch((e) => toast('Preview: ' + e.message, { kind: 'error' }));
  } else if (act === 'remake') { btn.disabled = true; try { await remake(id); } finally { btn.disabled = false; } }
  else if (act === 'rerender') { btn.disabled = true; try { await rerender(id); } finally { btn.disabled = false; } }
  else if (act === 'rename') {
    const cur = li.querySelector('.cap-tk-label').textContent;
    const v = await sc.ui.ask({ title: 'Rename take', label: 'Name (letters, digits, - _ .)', value: cur, okText: 'Rename' });
    if (v && v.trim()) { const n = await rename(id, v); toast('Renamed to ' + n, { kind: 'ok' }); renderTakes(); }
  } else if (act === 'del') {
    const cur = li.querySelector('.cap-tk-label').textContent;
    if (await sc.ui.askYesNo({ title: 'Delete take', message: `Delete "${cur}" (recipe and audio) from this device? Download the recipe first to keep it.`, okText: 'Delete', danger: true })) { if (playerId === id && player) player.pause(); await store.remove(id); toast('Deleted ' + cur, { kind: 'info' }); renderTakes(); }
  } else if (act === 'recipe') download(id, 'recipe');
  else if (act === 'wav') download(id, opts.bits === 24 ? 'wav24' : 'wav16');
  else if (act === 'webm') download(id, 'webm');
  else if (act === 'code') { const rec = await store.get(id); const code = eventCode(rec.recipe); if (!code) { toast('No events to bounce', { kind: 'info' }); return; }
    try { await navigator.clipboard.writeText(code); toast('Strudel code copied', { kind: 'ok' }); } catch (e) { await sc.ui.ask({ title: 'Strudel code', label: 'Copy this code', value: code.replace(/\n/g, ' '), okText: 'Done' }); } }
}
async function rename(id, name) { const rec = await store.get(id); if (!rec) return; rec.recipe.name = await uniqueName(name); await store.put(rec); return rec.recipe.name; }
let quotaMsg = '';
async function quota() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const { usage = 0, quota: q = 0 } = await navigator.storage.estimate(); const free = q - usage;
    quotaMsg = q && (usage / q > 0.8 || free < 64e6) ? `Storage nearly full: ${(free / 1e6).toFixed(0)} MB left of ${(q / 1e6).toFixed(0)} MB. Download and delete old takes.` : '';
    const e = $('#capQuota'); if (e) { e.textContent = quotaMsg || (q ? `${(usage / 1e6).toFixed(1)} MB used, ${(free / 1e6).toFixed(0)} MB free` : ''); e.classList.toggle('warn', !!quotaMsg); }
    if (quotaMsg && !quota.warned) { quota.warned = true; toast(quotaMsg, { kind: 'error' }); }
    if (navigator.storage.persist && !quota.asked) { quota.asked = true; navigator.storage.persist().catch(() => {}); }
  } catch (e) { /* estimate unsupported */ }
}
function dock() { const tp = $('.transport'); if (tp && el.w) el.w.style.setProperty('--cap-bottom', Math.round(tp.getBoundingClientRect().height) + 'px'); }
addEventListener('resize', () => st.open && dock());
function open() { build(); dock(); el.w.hidden = false; st.open = true; el.tb.setAttribute('aria-expanded', 'true'); document.body.classList.add('cap-open'); renderTakes(); loop(); if (!el.w.closest('.ws-body')) el.rec.focus({ preventScroll: true }); }
function close() { if (!el.w) return; if (el.w.closest('.ws-body')) return; el.w.hidden = true; st.open = false; el.tb.setAttribute('aria-expanded', 'false'); document.body.classList.remove('cap-open'); el.tb.focus({ preventScroll: true }); }
function toggleSheet() { el.w && !el.w.hidden && !el.w.closest('.ws-body') ? close() : open(); }

function init() {
  if (HOST) return; /* the render host has no panel, prompts or store writes */
  build();
  pruneLegacy({ notify: (m) => toast(m, { kind: 'info', ms: 8000 }), ask: (o) => sc.ui.askYesNo(o), askFirst: (o) => (sc.ui.askLater || sc.ui.askYesNo)(o), saveBlob }).catch(() => {});
  const P = sc.palette; if (P) {
    P.register({ id: 'record.open', group: 'Record', title: 'Open record panel', run: () => open() });
    P.register({ id: 'record.toggle', group: 'Record', title: 'Record / stop take', run: () => { open(); toggleRec(); } });
    P.register({ id: 'record.cycles', group: 'Record', title: 'Record N bars (loop)', run: () => { open(); if (st.phase === 'idle') { configure({ mode: 'cycles' }); record(); } } });
    P.register({ id: 'record.exact', group: 'Record', title: 'Render exact N bars (offline)', run: () => { open(); renderExact(); } });
    P.register({ id: 'record.import', group: 'Record', title: 'Import recipe', run: () => { open(); $('#capFile').click(); } });
  }
}
sc.capture = { open, close, toggle: toggleSheet, configure, record, stop, toggleRec, renderExact, remake, rerender, putTake: (rec) => store.put(rec).then(renderTakes), recordOffline: (n, o = {}) => { const lp = n == null && !o.at ? takePlan() : { ...takePlan({ unit: 'cycles', value: Math.max(1, n | 0 || opts.n), toEnd: false, startBar: '' }), explicitStart: false }; if (!lp.ok) { toast('Render: ' + lp.error, { kind: 'error' }); return Promise.resolve(null); } return recordOffline({ plan: lp, n: lp.cycles, name: o.name || opts.name, at: o.at }); }, plan: takePlan, resolveEnd: () => endInfo(lenEnv()), host: { warm: () => hostFrame().then(() => HS.bootMs), get bootMs() { return HS.bootMs; }, get frame() { return HS.frame; } }, flag: FLAG_REC, isHost: HOST, importRecipe, webmSupported: () => WEBM_MIME, beforeRender, addTake, exportRecipe: async (id) => exportRecipe(await store.get(id)), renderRecipe,
  download, list: () => store.list().then((l) => l.map((x) => ({ ...x.recipe, remake: x.remake || null, imported: x.imported || null, audio: Object.keys(x.audio) }))), get: (id) => store.get(id), remove: (id) => store.remove(id).then(renderTakes), rename, encodeWav, opts, state: st };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
