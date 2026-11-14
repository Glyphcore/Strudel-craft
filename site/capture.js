/* Record panel: one arm, one transport, one timeline of takes. A single Record captures, per the include boxes, the master audio,
   the lane / pad / control event stream and the code-state. Every take is a recipe (recipe.js, schemas/recipe.v1.json): versioned
   JSON that regenerates the result from scratch, with optional audio blobs as its outputs. Remake re-renders a recipe offline and checks
   the output against the stored audio hash. Imported recipes are inert data until Remake, after the user approves their dependencies.
   Tap: an AudioWorklet (Blob module; ScriptProcessor fallback) on the master bus GainNode from app.js, post master level; its output is
   silent and only pulled, so the mix is unchanged. Cycles mode cuts on sample frames mapped from the scheduler clock.
   Storage: IndexedDB "sc-recipes" (recipe.js); settings: localStorage sc.record.* (history-friendly, no audio).
   API: window.strudelCraft.capture = { open, close, toggle, configure, record, stop, toggleRec, renderExact, remake, importRecipe, exportRecipe,
   download, list, get, remove, rename, encodeWav, opts, state } */
import { FORMAT, VERSION, audioHash, collectDeps, validate, refsOf, verify, trusted, grant, store, pruneLegacy, sha256 } from './recipe.js';
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const get = (k, d) => { try { const v = localStorage.getItem('sc.record.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.record.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); const x = s - m * 60; return m + ':' + (x < 10 ? '0' : '') + x.toFixed(1); };
const safe = (s) => (String(s || 'take').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'take').slice(0, 60);
const numStr = (x) => String(+(+x).toFixed(3));
const short = (h) => (h ? String(h).replace('sha256:', '').slice(0, 12) : '-');

const opts = {
  mode: get('mode', 'cycles'), n: get('n', 2), countIn: get('countIn', 0), preRoll: get('preRoll', 0),
  name: get('name', 'take'), bits: get('bits', 16), fold: get('fold', true), audio: get('audio', true), events: get('events', true), code: get('code', true),
};
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
function collectNodes(ctx) {
  const prev = AudioNode.prototype.connect, seen = new Set();
  AudioNode.prototype.connect = function (dest, ...rest) { if (this.context === ctx) seen.add(this); if (dest instanceof AudioNode && dest.context === ctx) seen.add(dest); return prev.call(this, dest, ...rest); };
  return { seen, restore() { if (AudioNode.prototype.connect !== prev) AudioNode.prototype.connect = prev; } };
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
    settings: { tempo: lsj('tempo'), masterDb: T ? T.masterDb : null, follow: lsj('follow'), range: { start: lsj('range.start'), end: lsj('range.end'), loop: lsj('range.loop'), unit: lsj('range.unit') } },
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

/* ---------- record ---------- */
/* run: one-off overrides that are not persisted ({mode, n, countIn, name, at: absolute start cycle, step}); resolves with the saved record */
async function record(o = {}, run = {}) {
  if (st.phase !== 'idle') return null; /* busy: use stop() or toggleRec() */
  if (o && Object.keys(o).length) configure(o);
  const ru = st.run = { mode: run.mode || opts.mode, n: Math.max(1, (run.n || opts.n) | 0), countIn: run.countIn != null ? run.countIn : opts.countIn, preRoll: run.mode ? 0 : opts.preRoll, name: run.name || opts.name, at: run.at, step: run.step };
  const done = st.done = new Promise((r) => { st.resolve = r; });
  if (!opts.audio && !opts.events && !opts.code) { toast('Tick at least one of Audio, Events, Code-state', { kind: 'error' }); st.resolve(null); return null; }
  if (st.rendering) { toast('Rendering, wait a moment', { kind: 'info' }); st.resolve(null); return null; }
  const T = sc.transport; if (!T) { st.resolve(null); return null; }
  st.phase = 'arming'; sync();
  try {
    if (!T.playing) { await T.play(); if (!T.playing) throw new Error('Press Play first (audio is blocked or nothing to play)'); if (!(await waitTicking())) throw new Error('The transport did not start'); }
    const tap = await attachTap(); if (!tap) throw new Error('No audio output yet: press Play once');
    if (st.tapCtx.state !== 'running') await st.tapCtx.resume();
    if (st.tap.port) st.tap.port.postMessage({ on: true });
    const ck = clock(); if (!ck) throw new Error('The transport is not running');
    const now = st.tapCtx.currentTime + 0.02, rate = sr(), c = ck.cycleAt(now);
    const k = Math.max(0, ru.countIn | 0);
    let startT, startCycle = null;
    if (ru.at != null) { startCycle = ru.at; while (ck.timeOf(startCycle) < now) startCycle += ru.step || ru.n; startT = ck.timeOf(startCycle); }
    else if (ru.mode === 'cycles' || k > 0) { startCycle = Math.ceil(c - 1e-6) + k; startT = ck.timeOf(startCycle); } else startT = now;
    st.startCycle = startCycle; st.c0 = startCycle != null ? startCycle : ck.cycleAt(startT); st.cps = ck.cps;
    const pre = ru.mode === 'cycles' ? 0 : Math.max(0, +ru.preRoll || 0);
    const first = st.chunks.length ? st.chunks[0].f0 : Math.round(now * rate);
    st.startFrame = Math.max(first, Math.round((startT - pre) * rate)); st.recFrame = Math.round(startT * rate);
    if (ru.mode === 'cycles') st.endFrame = st.recFrame + Math.round(ru.n / ck.cps * rate);
    else if (ru.mode === 'until') { const r = sc.range && sc.range.state; const capS = r ? Math.max(1, r.maxMin * 60 + (r.extra || 0) - (r.elapsed || 0)) : 600; st.endFrame = st.recFrame + Math.round(capS * rate); }
    else st.endFrame = 0;
    st.src = T.source(); st.state = opts.code || opts.audio ? await codeState(st.src) : null;
    st.ev = opts.events ? { controls: [], last: new Map() } : null;
    st.hold = 0; st.phase = 'waiting'; st.t0 = performance.now();
    sync(); loop();
  } catch (e) { st.phase = 'idle'; sync(); toast('Record: ' + (e.message || e), { kind: 'error' }); st.resolve(null); }
  return done;
}
function toggleRec() { return st.phase === 'idle' ? record() : stop(); }
/* set options from code or the palette; persisted (sc.record.*) and reflected in the panel */
function configure(o = {}) {
  for (const k of Object.keys(opts)) if (o[k] !== undefined) { opts[k] = k === 'name' ? safe(o[k]) : typeof opts[k] === 'number' ? +o[k] : typeof opts[k] === 'boolean' ? !!o[k] : o[k]; set(k, opts[k]); }
  opts.n = Math.max(1, Math.min(64, opts.n | 0));
  if (el.w) {
    for (const r of el.w.querySelectorAll('.cap-seg input')) r.checked = String(opts[r.name.slice(4)]) === r.value;
    $('#capCount').value = String(opts.countIn); $('#capPre').value = String(opts.preRoll); $('#capName').value = opts.name; $('#capFold').checked = opts.fold;
    for (const k of ['audio', 'events', 'code']) $('#capInc_' + k).checked = opts[k];
  }
  sync(); return { ...opts };
}
function stop() {
  if (st.phase === 'waiting' && (!st.tapCtx || st.tapCtx.currentTime * sr() < st.recFrame)) { st.phase = 'idle'; sync(); toast('Record cancelled', { kind: 'info' }); st.resolve(null); return; }
  if (st.phase === 'recording' || st.phase === 'waiting') finish(st.run.mode === 'cycles' ? 'early' : 'done');
}
let rafOn = false;
function loop() {
  if (rafOn) return; rafOn = true;
  const step = () => {
    if (st.phase === 'idle' && !st.open) { rafOn = false; return; }
    if (st.phase === 'idle' && opts.preRoll > 0 && sc.transport && sc.transport.playing && sc.transport.bus && st.tapCtx !== sc.transport.bus.ctx && !st.attaching) { st.attaching = true; attachTap().finally(() => { st.attaching = false; }); }
    if (st.phase === 'waiting' && st.tapCtx && st.tapCtx.currentTime * sr() >= st.recFrame) { st.phase = 'recording'; st.recAudio0 = st.tapCtx.currentTime; startCompressed(); sync(); }
    if (st.phase === 'recording') sampleEvents();
    if ((st.phase === 'recording' || st.phase === 'waiting') && sc.transport && !sc.transport.playing) finish('transport');
    draw();
    st.raf = document.hidden ? setTimeout(step, 250) : requestAnimationFrame(step);
  };
  step();
}
/* hidden tabs throttle rAF: the worklet keeps posting chunks, so onChunk still ends cycle takes on time */
document.addEventListener('visibilitychange', () => { if (st.phase !== 'idle' && rafOn) { cancelAnimationFrame(st.raf); clearTimeout(st.raf); rafOn = false; loop(); } });

async function finish(why) {
  if (st.phase !== 'recording' && st.phase !== 'waiting') return;
  const rate = sr(); let end = st.endFrame;
  const last = st.chunks.length ? st.chunks[st.chunks.length - 1] : null; const have = last ? last.f0 + last.L.length : st.startFrame;
  if (!end || why !== 'done' || end > have) end = Math.min(end || have, have);
  st.phase = 'saving'; sync();
  const webm = await stopCompressed();
  const ru = st.run, exact = ru.mode === 'cycles' && why === 'done';
  const recLen = Math.max(0, end - st.recFrame); const c0 = st.c0, c1 = exact ? c0 + ru.n : c0 + recLen / rate * st.cps;
  let rec = null;
  try {
    if (recLen < rate * 0.05) throw new Error('Nothing captured');
    const audio = opts.audio ? slice(st.startFrame, end) : null;
    const includes = { audio: !!opts.audio, events: !!opts.events, code: !!opts.code };
    const C = sc.perform && sc.perform.controls;
    const events = includes.events || includes.code ? { pads: padEvents(c0, c1), hooks: hookPadEntries(c1), controls: st.ev ? st.ev.controls : [], lanes: C ? (C.toModel().automation || {}) : {} } : null;
    const timing = { cps: +(+st.cps).toFixed(6), start: +c0.toFixed(6), stop: +c1.toFixed(6), cycles: +(c1 - c0).toFixed(6), loop: exact, mode: ru.mode, exact, fold: !!opts.fold, preRoll: (st.recFrame - st.startFrame) / rate };
    /* gaps (bgplay.js segments): a take that crossed a pause or interruption carries segment markers; the audio has the gap, Remake and
       the exact render do not (they render the cycles, not the wall clock) */
    const gaps = sc.bg && st.tapCtx && st.recAudio0 != null ? sc.bg.gapsBetween(st.recAudio0, st.tapCtx.currentTime) : [];
    if (gaps.length) timing.segments = gaps.map((g) => ({ kind: g.kind, cycle: g.cycle, audio: +(g.audio - st.recAudio0).toFixed(3), seconds: g.seconds }));
    const recipe = await buildRecipe({ name: ru.name, includes, timing, state: st.state, events });
    rec = { id: recipe.id, recipe, audio: {} };
    if (audio) { rec.audio.capture = { L: audio.L, R: audio.R, sr: rate }; recipe.outputs.capture = { sha256: await audioHash(audio.L, audio.R), sr: rate, frames: audio.L.length, how: 'realtime', encoding: 'f32le-interleaved', envelope: envelope(audio.L, audio.R, rate) }; }
    if (audio && webm) rec.audio.webm = webm;
    await store.put(rec);
    /* reference render: an exact take with code-state gets an offline render whose hash Remake checks (stops the transport) */
    if (audio && includes.code && exact) {
      st.phase = 'idle'; sync();
      if (sc.transport.playing) sc.transport.stop(); await new Promise((r) => setTimeout(r, 500)); /* let live voices end and in-flight superdough() calls settle before the offline swap */
      const out = await renderRecipe(recipe, { sr: rate });
      if (out) { rec.audio.render = { L: out.L, R: out.R, sr: out.sr }; recipe.outputs.render = { sha256: await audioHash(out.L, out.R), sr: out.sr, frames: out.L.length, how: 'offline', encoding: 'f32le-interleaved', haps: out.haps, fails: out.fails, envelope: envelope(out.L, out.R, out.sr) }; await store.put(rec); }
    }
    if (gaps.length) toast(`Take "${recipe.name}" had ${gaps.length} interruption${gaps.length > 1 ? 's' : ''} (${gaps.reduce((a, g) => a + g.seconds, 0).toFixed(1)} s paused); the recipe marks them (timing.segments)`, { kind: 'info', ms: 8000 });
    toast(`Take saved: ${recipe.name}. Download`, { kind: 'ok', ms: 6000, onClick: () => download(recipe.id, 'recipe') });
  } catch (e) { toast((e.message === 'Nothing captured' ? '' : 'Could not save take: ') + e.message, { kind: 'error' }); rec = null; }
  st.phase = 'idle'; if (!(opts.preRoll > 0)) st.chunks = []; st.ev = null; sync(); renderTakes(); st.resolve(rec);
}

/* ---------- offline render of a recipe (Remake, reference render, exact render) ---------- */
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* Hook 1 (#76): beforeRender(fn) registers an async fn(recipe, { code }) that runs once before every offline render (exact render, reference
   render, Remake) with the recipe's program already compiled, so pattern-level captures (lanesCapture.host.resolve) can render and register their
   audio first. fn may call renderRecipe itself (nested renders skip the hooks). Returns an unregister function. A throwing hook aborts the render. */
const beforeHooks = new Set();
function beforeRender(fn) { if (typeof fn !== 'function') throw new TypeError('beforeRender needs a function'); beforeHooks.add(fn); return () => beforeHooks.delete(fn); }
async function renderRecipe(recipe, o = {}) {
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
async function renderRecipeCore(recipe, { sr: rateIn } = {}) {
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
    const haps = info.pattern.queryArc(start, end, { _cps: cps }).filter((h) => h.hasOnset()).sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    let fails = 0, retries = 0, warm = 0;
    const pass = async (ctx, count) => {
      W.setAudioContext(ctx); W.setSuperdoughAudioController(null); swapped = true;
      try { await W.loadWorklets(); } catch (e) { /* worklet effects unavailable offline */ }
      col = collectNodes(ctx); let f = 0, r = 0;
      for (const h of haps) {
        h.ensureObjectValue && h.ensureObjectValue(); const t = (h.whole.begin.valueOf() - start) / cps;
        for (let k = 0; ; k++) {
          try { await W.superdough({ ...h.value }, t, h.duration / cps, cps, h.whole.begin.valueOf()); break; } /* a copy per call: superdough may write into the value */
          catch (e) { if (e && e.name === 'InvalidAccessError' && k < 64) { r++; continue; } f++; break; }
        }
      }
      col.restore(); unpool(col.seen); if (count) { fails = f; retries = r; } else warm = r;
    };
    /* warm-up pass on a throwaway context: a failed superdough() call can leave a partial voice behind, so stale live nodes are drained
       from the pools here (never rendered) and the real pass only ever gets fresh nodes: renders are bit-identical across sessions */
    rnd = Math.random; Math.random = mulberry(recipe.random.seed);
    await pass(new OfflineAudioContext(2, 128, rate), false);
    /* seeded Math.random for the real pass only (noise buffers, random phases); restored in finally */
    Math.random = mulberry(recipe.random.seed);
    const off = new OfflineAudioContext(2, frames + tail, rate);
    await pass(off, true);
    const buf = await off.startRendering();
    await new Promise((r) => setTimeout(r, 300)); /* let the offline onended cleanups run while the offline context is still current */
    W.setAudioContext(live); W.setSuperdoughAudioController(ctl); swapped = false;
    const L = buf.getChannelData(0).slice(0, frames), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(0, frames);
    if (tail) { const tl = buf.getChannelData(0), tr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : tl; for (let i = 0; i < tail && i < frames; i++) { L[i] += tl[frames + i]; R[i] += tr[frames + i]; } }
    const db = S.settings && S.settings.masterDb != null ? S.settings.masterDb : (T.masterDb || 0); const g = db <= -60 ? 0 : Math.pow(10, db / 20); /* master level, so renders match realtime takes */
    if (g !== 1) for (let i = 0; i < frames; i++) { L[i] = Math.fround(L[i] * g); R[i] = Math.fround(R[i] * g); }
    return { L, R, sr: rate, haps: haps.length, fails, retries, warm };
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
/* Render exact N cycles of the current program as a recipe (code-state + render output) */
async function renderExact(n = opts.n) {
  if (st.rendering || st.phase !== 'idle') return null;
  const T = sc.transport;
  try {
    const info = await T.compile(); n = Math.max(1, n | 0);
    const state = await codeState({ kind: info.kind, title: info.title, code: info.code });
    const includes = { audio: true, events: false, code: true };
    const recipe = await buildRecipe({ name: opts.name, includes, state, timing: { cps: +(+info.cps).toFixed(6), start: 0, stop: n, cycles: n, loop: true, mode: 'cycles', exact: true, fold: !!opts.fold, preRoll: 0 } });
    if (T.playing) { T.stop(); await new Promise((r) => setTimeout(r, 150)); }
    const out = await renderRecipe(recipe);
    const rec = { id: recipe.id, recipe, audio: { render: { L: out.L, R: out.R, sr: out.sr } } };
    recipe.outputs.render = { sha256: await audioHash(out.L, out.R), sr: out.sr, frames: out.L.length, how: 'offline', encoding: 'f32le-interleaved', haps: out.haps, fails: out.fails, envelope: envelope(out.L, out.R, out.sr) };
    await store.put(rec); renderTakes();
    toast(`Rendered ${recipe.name}: ${n} cycles, ${out.L.length} frames${out.fails ? `, ${out.fails} events failed offline` : ''}`, { kind: out.fails ? 'info' : 'ok' });
    return rec;
  } catch (e) { toast('Render: ' + (e.message || e), { kind: 'error' }); return null; }
}

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
  for (const s of r.deps.samples) { const q = v.refs.find((x) => x.kind === 'samples' && x.id === s.bank); const map = JSON.parse(new TextDecoder().decode(q.bytes)); const sha = /@([0-9a-f]{40})\//.exec(s.source)[1]; if (typeof map._base === 'string') map._base = map._base.replace(/\/(main|master)\//, `/${sha}/`); await sc.transport.loadSampleMap(map); }
  for (const b of r.deps.vox) if (window.voxBank) await window.voxBank(b.url);
  const notes = [...v.notes]; if (r.deps.site.build !== (await siteBuild())) notes.push(`Made with site build ${r.deps.site.build}, this is ${await siteBuild()}.`);
  let out; try { out = await renderRecipe(r); } catch (e) { toast('Remake: ' + e.message, { kind: 'error' }); return { error: e.message }; }
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
    <div class="cap-read"><output id="capTime" class="cap-time">0:00.0</output><span id="capState" class="cap-state" role="status" aria-live="polite">Ready</span></div>
    <canvas id="capMeter" class="cap-meter" role="img" aria-label="Record input level"></canvas>
    <button type="button" class="icon ghost" id="capClose" aria-label="Close record panel">&times;</button>
  </div>
  <fieldset class="cap-inc"><legend>Include</legend>
    <label class="switch"><input id="capInc_audio" type="checkbox"${opts.audio ? ' checked' : ''}><span>Audio</span></label>
    <label class="switch"><input id="capInc_events" type="checkbox"${opts.events ? ' checked' : ''}><span>Events (lanes, pads, controls)</span></label>
    <label class="switch"><input id="capInc_code" type="checkbox"${opts.code ? ' checked' : ''}><span>Code-state</span></label>
  </fieldset>
  <div class="cap-opts">
    ${seg('mode', 'Arm', [['free', 'Free'], ['cycles', 'Cycles'], ['until', 'Until stop']], opts.mode)}
    <div class="cap-num"><span class="cap-lab" id="capNLab">Cycles</span><div class="cap-step"><button type="button" class="ghost" data-step="-1" aria-label="Fewer cycles">-</button><output id="capN" aria-labelledby="capNLab">${opts.n}</output><button type="button" class="ghost" data-step="1" aria-label="More cycles">+</button></div></div>
    <label class="cap-sel"><span class="cap-lab">Count-in</span><select id="capCount">${[0, 1, 2, 4].map((v) => `<option value="${v}"${v === opts.countIn ? ' selected' : ''}>${v ? v + ' cyc' : 'Off'}</option>`).join('')}</select></label>
    <label class="cap-sel"><span class="cap-lab">Pre-roll</span><select id="capPre">${[0, 0.5, 1, 2, 4].map((v) => `<option value="${v}"${v === opts.preRoll ? ' selected' : ''}>${v ? v + ' s' : 'Off'}</option>`).join('')}</select></label>
    <label class="cap-name"><span class="cap-lab">Name</span><input id="capName" type="text" autocomplete="off" spellcheck="false" enterkeyhint="done" maxlength="60" value="${esc(opts.name)}"></label>
    ${seg('bits', 'WAV', [[16, '16 bit'], [24, '24 bit']], opts.bits)}
  </div>
  <div class="cap-exact"><button type="button" id="capExact" class="ghost">Render exact <b id="capExactN">${opts.n}</b> cycles</button><label class="switch"><input id="capFold" type="checkbox"${opts.fold ? ' checked' : ''}><span>Fold tail (seamless)</span></label></div>
  <p class="cap-hint" id="capHint"></p>
  <div class="cap-imp"><button type="button" id="capImport" class="ghost">Import recipe</button><input type="file" id="capFile" accept="application/json,.json" hidden></div>
  <ol class="cap-takes" id="capTakes" aria-label="Takes"></ol>
  <p class="cap-quota" id="capQuota"></p>`;
  document.body.append(w);
  el = { tb, w, rec: $('#capRec'), lab: $('#capRecLabel'), time: $('#capTime'), state: $('#capState'), meter: $('#capMeter'), n: $('#capN'), hint: $('#capHint'), takes: $('#capTakes'), exact: $('#capExact') };
  $('#capClose').addEventListener('click', () => close());
  el.rec.addEventListener('click', () => toggleRec());
  el.exact.addEventListener('click', () => renderExact());
  $('#capImport').addEventListener('click', () => $('#capFile').click());
  $('#capFile').addEventListener('change', async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { await importRecipe(f); } catch (err) { await sc.ui.askYesNo({ title: 'Import refused', message: err.message, okText: 'OK' }); } });
  w.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'cap-mode') configure({ mode: t.value }); else if (t.name === 'cap-bits') configure({ bits: +t.value });
    else if (t.id === 'capCount') configure({ countIn: +t.value }); else if (t.id === 'capPre') configure({ preRoll: +t.value });
    else if (t.id === 'capFold') configure({ fold: t.checked }); else if (t.id === 'capName') configure({ name: t.value });
    else if (t.id && t.id.startsWith('capInc_')) configure({ [t.id.slice(7)]: t.checked });
  });
  w.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]'); if (s) { configure({ n: opts.n + +s.dataset.step }); return; }
    const b = e.target.closest('[data-act]'); if (!b) return; const li = b.closest('[data-id]'); if (li) takeAct(b.dataset.act, li.dataset.id, b);
  });
  w.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !w.closest('.ws-body')) { e.stopPropagation(); close(); } });
  sync();
}
function sync() {
  if (!el.w) return;
  const busy = st.phase !== 'idle';
  el.rec.setAttribute('aria-pressed', String(busy)); el.lab.textContent = st.phase === 'waiting' ? 'Cancel' : busy ? 'Stop' : 'Record';
  el.w.dataset.phase = st.phase; el.tb.dataset.phase = st.phase; document.body.classList.toggle('capturing', busy);
  el.tb.setAttribute('aria-label', busy ? 'Record panel: recording' : 'Record panel');
  el.n.textContent = opts.n; $('#capExactN').textContent = opts.n; $('#capNLab').closest('.cap-num').classList.toggle('off', opts.mode !== 'cycles');
  el.exact.disabled = st.rendering || busy; el.exact.firstChild.textContent = st.rendering ? 'Rendering ' : 'Render exact ';
  el.rec.disabled = st.rendering;
  for (const i of el.w.querySelectorAll('.cap-opts input, .cap-opts select, .cap-opts button, .cap-inc input')) i.disabled = busy;
  const inc = ['audio', 'events', 'code'].filter((k) => opts[k]).map((k) => (k === 'code' ? 'code-state' : k)).join(' + ') || 'nothing';
  el.hint.textContent = (opts.mode === 'cycles' ? `Cycles: starts and stops on cycle boundaries (${opts.n}), loops cleanly; with audio + code-state the transport stops at the end for an exact reference render.` : opts.mode === 'until' ? 'Until stop: records until you stop or the play-time limit.' : 'Free: records from now until you stop.') + ` Records ${inc}.` + (WEBM_MIME ? ' Realtime audio takes also keep a WebM/opus copy.' : ' WebM/opus copies are not available in this browser (no MediaRecorder opus); WAV only.');
  if (!busy) { el.state.textContent = st.rendering ? 'Rendering offline' : 'Ready'; el.time.textContent = '0:00.0'; }
}
function draw() {
  if (!el.w || el.w.hidden && st.phase === 'idle') return;
  const rate = sr(), now = st.tapCtx ? st.tapCtx.currentTime * rate : 0;
  if (st.phase === 'waiting') { const ck = clock(); const left = (st.recFrame - now) / rate; el.time.textContent = '-' + fmtT(left); el.state.textContent = ck && st.startCycle != null ? `Count-in: ${Math.max(0, Math.ceil(left * ck.cps))}` : 'Starting'; }
  else if (st.phase === 'recording') {
    const t = (now - st.recFrame) / rate; el.time.textContent = fmtT(t);
    el.state.textContent = st.run.mode === 'cycles' ? `Cycle ${Math.min(st.run.n, t * st.cps).toFixed(1)} / ${st.run.n}` : st.run.mode === 'until' ? `Cap ${fmtT((st.endFrame - st.recFrame) / rate)}` : 'Recording';
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
  el.takes.innerHTML = list.length ? list.map(({ recipe: r, audio, remake: rm, imported }) => {
    const hasAudio = !!(audio.render || audio.capture || audio.remake);
    const chips = ['audio', 'events', 'code'].filter((k) => r.includes[k]).map((k) => `<i class="cap-badge" data-type="${k}">${k === 'code' ? 'code' : k}</i>`).join('');
    const ver = rm ? (rm.match === 'tolerance' ? '<i class="cap-badge" data-type="ok">remake ~ok</i>' : rm.match === true ? '<i class="cap-badge" data-type="ok">remake ok</i>' : rm.match === false ? '<i class="cap-badge" data-type="bad">differs</i>' : '') : imported ? '<i class="cap-badge" data-type="inert">inert</i>' : '';
    const deps = r.deps.packs.length + r.deps.samples.length + r.deps.vox.length + 1;
    return `<li data-id="${r.id}" class="cap-tk">
    <canvas class="cap-wave" aria-hidden="true"></canvas>
    <div class="cap-tk-info"><b class="cap-tk-name">${chips}${ver}<span class="cap-tk-label">${esc(r.name)}</span></b><span class="cap-tk-sub">${numStr(r.timing.cycles)}c · ${numStr(r.timing.cps)} cps · c${numStr(r.timing.start)}-${numStr(r.timing.stop)}${r.meta && r.meta.from ? ' · from ' + esc(r.meta.from) : ''} · ${deps} dep${deps > 1 ? 's' : ''}${r.outputs.render ? ' · ' + short(r.outputs.render.sha256) : ''}</span></div>
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
  build();
  pruneLegacy({ notify: (m) => toast(m, { kind: 'info', ms: 8000 }), ask: (o) => sc.ui.askYesNo(o), askFirst: (o) => (sc.ui.askLater || sc.ui.askYesNo)(o), saveBlob }).catch(() => {});
  const P = sc.palette; if (P) {
    P.register({ id: 'record.open', group: 'Record', title: 'Open record panel', run: () => open() });
    P.register({ id: 'record.toggle', group: 'Record', title: 'Record / stop take', run: () => { open(); toggleRec(); } });
    P.register({ id: 'record.cycles', group: 'Record', title: 'Record N cycles (loop)', run: () => { open(); if (st.phase === 'idle') { configure({ mode: 'cycles' }); record(); } } });
    P.register({ id: 'record.exact', group: 'Record', title: 'Render exact N cycles (offline)', run: () => { open(); renderExact(); } });
    P.register({ id: 'record.import', group: 'Record', title: 'Import recipe', run: () => { open(); $('#capFile').click(); } });
  }
}
sc.capture = { open, close, toggle: toggleSheet, configure, record, stop, toggleRec, renderExact, remake, importRecipe, webmSupported: () => WEBM_MIME, beforeRender, addTake, exportRecipe: async (id) => exportRecipe(await store.get(id)), renderRecipe,
  download, list: () => store.list().then((l) => l.map((x) => ({ ...x.recipe, remake: x.remake || null, imported: x.imported || null, audio: Object.keys(x.audio) }))), get: (id) => store.get(id), remove: (id) => store.remove(id).then(renderTakes), rename, encodeWav, opts, state: st };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
