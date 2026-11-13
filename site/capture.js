/* Audio capture: record what the transport plays (Rack or Stack) as loopable takes, keep them on the device, download them.
   Tap: an AudioWorklet (Blob module; ScriptProcessor fallback) hangs off the master bus GainNode from app.js (post master level,
   so a take is what is heard). Its output is silent and goes to the destination only to be pulled, so the mix is unchanged.
   Modes: free (until you stop), cycles (N cycles cut on sample frames mapped from the scheduler clock, so the clip loops),
   until stopped (capped by the play-time limit). Count-in and pre-roll. Exact: offline render of N cycles (OfflineAudioContext).
   Takes: IndexedDB "sc-capture" (records {meta, audio}); settings: localStorage sc.capture.* (history-friendly, no audio).
   API: window.strudelCraft.capture = { open, close, toggle, configure(opts), record(opts), stop, toggleRec, renderExact(n), list, get, remove, rename,
   encodeWav(take, bits), sidecar(take), fileName(take, ext), download(id, fmt), state } */
const sc = (window.strudelCraft = window.strudelCraft || {});
const $ = (s, r = document) => r.querySelector(s);
const get = (k, d) => { try { const v = localStorage.getItem('sc.capture.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem('sc.capture.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const toast = (m, o) => sc.ui && sc.ui.toast(m, o);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); const x = s - m * 60; return m + ':' + (x < 10 ? '0' : '') + x.toFixed(1); };
const safe = (s) => (String(s || 'take').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'take').slice(0, 60);
const numStr = (x) => String(+(+x).toFixed(3));

const opts = {
  mode: get('mode', 'cycles'), n: get('n', 2), countIn: get('countIn', 0), preRoll: get('preRoll', 0),
  name: get('name', 'take'), bits: get('bits', 16), fold: get('fold', true),
};
const st = { phase: 'idle', startFrame: 0, endFrame: 0, startCycle: 0, chunks: [], peak: 0, hold: 0, tap: null, tapCtx: null, info: null, cap: 0, open: false, rendering: false };

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
      node = new AudioWorkletNode(ctx, 'sc-capture-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      node.port.onmessage = (e) => onChunk(e.data.f0, e.data.L, e.data.R);
    } catch (e) { node = null; }
  }
  if (!node) { /* fallback: ScriptProcessor (deprecated but universal); playbackTime gives the frame */
    node = ctx.createScriptProcessor(4096, 2, 1);
    node.onaudioprocess = (e) => { const b = e.inputBuffer; onChunk(Math.round(e.playbackTime * ctx.sampleRate), b.getChannelData(0).slice(), (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice()); };
  }
  bus.own.add(node); /* own nodes bypass app.js's destination redirect, so this silent output never re-enters the bus */
  bus.node.connect(node); node.connect(ctx.destination);
  st.tap = node; st.tapCtx = ctx; st.chunks = []; return node;
}
function detachTap() {
  if (!st.tap) return; try { st.tap.disconnect(); } catch (e) { /* gone */ }
  try { const b = sc.transport.bus; if (b && b.ctx === st.tapCtx) b.node.disconnect(st.tap); } catch (e) { /* gone */ }
  if (st.tap.port) st.tap.port.onmessage = null; st.tap.onaudioprocess = null; st.tap = null; st.tapCtx = null;
}
function sr() { return st.tapCtx ? st.tapCtx.sampleRate : 48000; }
function onChunk(f0, L, R) {
  let p = 0; for (let i = 0; i < L.length; i += 4) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p) p = a; if (b > p) p = b; }
  st.peak = Math.max(st.peak * 0.85, p); st.hold = Math.max(st.hold, p);
  st.chunks.push({ f0, L, R });
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

/* ---------- record ---------- */
async function record(o = {}) {
  if (st.phase !== 'idle') return; /* busy: use stop() or toggleRec() */
  if (o && Object.keys(o).length) configure(o);
  if (st.rendering) { toast('Rendering, wait a moment', { kind: 'info' }); return; }
  const T = sc.transport; if (!T) return;
  st.phase = 'arming'; sync();
  try {
    if (!T.playing) { await T.play(); if (!T.playing) throw new Error('Press Play first (audio is blocked or nothing to play)'); if (!(await waitTicking())) throw new Error('The transport did not start'); }
    const tap = await attachTap(); if (!tap) throw new Error('No audio output yet: press Play once');
    if (st.tapCtx.state !== 'running') await st.tapCtx.resume();
    if (st.tap.port) st.tap.port.postMessage({ on: true });
    const ck = clock(); if (!ck) throw new Error('The transport is not running');
    const now = st.tapCtx.currentTime + 0.02, rate = sr(), c = ck.cycleAt(now);
    const k = Math.max(0, opts.countIn | 0);
    let startT, startCycle = null;
    if (opts.mode === 'cycles' || k > 0) { startCycle = Math.ceil(c - 1e-6) + k; startT = ck.timeOf(startCycle); } else startT = now;
    st.startCycle = startCycle; st.cps = ck.cps;
    const pre = opts.mode === 'cycles' ? 0 : Math.max(0, +opts.preRoll || 0);
    const first = st.chunks.length ? st.chunks[0].f0 : Math.round(now * rate);
    st.startFrame = Math.max(first, Math.round((startT - pre) * rate)); st.recFrame = Math.round(startT * rate);
    if (opts.mode === 'cycles') st.endFrame = st.recFrame + Math.round(Math.max(1, opts.n) / ck.cps * rate);
    else if (opts.mode === 'until') { const r = sc.range && sc.range.state; const capS = r ? Math.max(1, r.maxMin * 60 + (r.extra || 0) - (r.elapsed || 0)) : 600; st.endFrame = st.recFrame + Math.round(capS * rate); }
    else st.endFrame = 0;
    st.src = T.source(); st.hold = 0; st.phase = 'waiting'; st.t0 = performance.now();
    sync(); loop();
  } catch (e) { st.phase = 'idle'; sync(); toast('Record: ' + (e.message || e), { kind: 'error' }); }
}
function toggleRec() { return st.phase === 'idle' ? record() : stop(); }
/* set capture options from code or the palette; persisted (sc.capture.*) and reflected in the sheet */
function configure(o = {}) {
  for (const k of Object.keys(opts)) if (o[k] !== undefined) { opts[k] = k === 'name' ? safe(o[k]) : typeof opts[k] === 'number' ? +o[k] : typeof opts[k] === 'boolean' ? !!o[k] : o[k]; set(k, opts[k]); }
  opts.n = Math.max(1, Math.min(64, opts.n | 0));
  if (el.w) { for (const r of el.w.querySelectorAll('.cap-seg input')) r.checked = String(opts[r.name.slice(4)]) === r.value; $('#capCount').value = String(opts.countIn); $('#capPre').value = String(opts.preRoll); $('#capName').value = opts.name; $('#capFold').checked = opts.fold; }
  sync(); return { ...opts };
}
function stop() {
  if (st.phase === 'waiting' && (!st.tapCtx || st.tapCtx.currentTime * sr() < st.recFrame)) { st.phase = 'idle'; sync(); toast('Record cancelled', { kind: 'info' }); return; }
  if (st.phase === 'recording' || st.phase === 'waiting') finish(opts.mode === 'cycles' ? 'early' : 'done');
}
let rafOn = false;
function loop() {
  if (rafOn) return; rafOn = true;
  const step = () => {
    if (st.phase === 'idle' && !st.open) { rafOn = false; return; }
    if (st.phase === 'idle' && opts.preRoll > 0 && sc.transport && sc.transport.playing && sc.transport.bus && st.tapCtx !== sc.transport.bus.ctx && !st.attaching) { st.attaching = true; attachTap().finally(() => { st.attaching = false; }); }
    if (st.phase === 'waiting' && st.tapCtx && st.tapCtx.currentTime * sr() >= st.recFrame) { st.phase = 'recording'; sync(); }
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
  const { L, R } = slice(st.startFrame, end);
  if (L.length < rate * 0.05) { st.phase = 'idle'; sync(); toast('Nothing captured', { kind: 'error' }); return; }
  const recLen = end - st.recFrame; const cycles = recLen / rate * st.cps;
  const exact = opts.mode === 'cycles' && why === 'done';
  try {
    const take = await save({ L, R, sr: rate, cycles: exact ? opts.n : +cycles.toFixed(3), cps: st.cps, mode: opts.mode, exact, loop: exact, how: 'realtime',
      preRoll: (st.recFrame - st.startFrame) / rate, startCycle: st.startCycle, why });
    toast(`Saved ${take.meta.name} (${fmtT(L.length / rate)})`, { kind: 'ok' });
  } catch (e) { toast('Could not save take: ' + e.message, { kind: 'error' }); }
  st.phase = 'idle'; if (!(opts.preRoll > 0)) st.chunks = []; sync(); renderTakes();
}

/* ---------- exact offline render ---------- */
/* superdough pools filter/compressor nodes in module-wide WeakRef pools that ignore the context. After an offline render the pools
   hold offline nodes (and during it, live ones), and reusing one throws "different audio context". Installed on the first render:
   a WeakRef to an AudioNode of a context other than superdough's current one derefs to undefined, so the pool skips it. */
function guardPools() {
  if (guardPools.on || typeof WeakRef === 'undefined') return; guardPools.on = true;
  const deref = WeakRef.prototype.deref;
  WeakRef.prototype.deref = function () { const v = deref.call(this); if (v instanceof AudioNode && typeof window.getAudioContext === 'function') { try { if (v.context !== window.getAudioContext()) return undefined; } catch (e) { /* keep */ } } return v; };
}
async function renderExact(n = opts.n) {
  const W = window; const T = sc.transport;
  if (st.rendering || st.phase !== 'idle') return;
  if (!W.OfflineAudioContext) { toast('This browser has no OfflineAudioContext: use Record (cycles)', { kind: 'error' }); return; }
  st.rendering = true; sync();
  let live = null, ctl = null, swapped = false, wasRunning = false;
  try {
    const info = await T.compile();
    if (!info.pattern) throw new Error('No pattern compiled');
    for (const f of ['setAudioContext', 'getAudioContext', 'superdough', 'loadWorklets', 'getSuperdoughAudioController', 'setSuperdoughAudioController']) if (typeof W[f] !== 'function') throw new Error('Strudel offline API missing: ' + f);
    if (T.playing) { T.stop(); await new Promise((r) => setTimeout(r, 150)); } /* let in-flight live superdough() calls (async) finish on the live context */
    guardPools();
    const cps = info.cps; n = Math.max(1, n | 0);
    live = W.getAudioContext(); ctl = W.getSuperdoughAudioController();
    /* freeze the live clock: superdough's onended cleanups create nodes on the current context, so no live source may end while the offline one is current */
    wasRunning = live.state === 'running'; if (wasRunning) await live.suspend();
    const rate = live.sampleRate, frames = Math.round(n / cps * rate), tail = opts.fold ? Math.round(Math.min(4, n / cps) * rate) : 0;
    const off = new OfflineAudioContext(2, frames + tail, rate);
    W.setAudioContext(off); W.setSuperdoughAudioController(null); swapped = true;
    try { await W.loadWorklets(); } catch (e) { /* worklet effects unavailable offline */ }
    const haps = info.pattern.queryArc(0, n, { _cps: cps }).filter((h) => h.hasOnset()).sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    let fails = 0;
    for (const h of haps) {
      try { h.ensureObjectValue && h.ensureObjectValue(); const t = h.whole.begin.valueOf() / cps; await W.superdough(h.value, t, h.duration / cps, cps, h.whole.begin.valueOf()); } catch (e) { fails++; }
    }
    const buf = await off.startRendering();
    await new Promise((r) => setTimeout(r, 300)); /* let the offline onended cleanups run while the offline context is still current */
    W.setAudioContext(live); W.setSuperdoughAudioController(ctl); swapped = false;
    const L = buf.getChannelData(0).slice(0, frames), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(0, frames);
    const g = T.masterDb <= -60 ? 0 : Math.pow(10, (T.masterDb || 0) / 20); /* master level, so exact and realtime takes match */
    if (tail) { const tl = buf.getChannelData(0), tr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : tl; for (let i = 0; i < tail && i < frames; i++) { L[i] += tl[frames + i]; R[i] += tr[frames + i]; } }
    if (g !== 1) for (let i = 0; i < frames; i++) { L[i] *= g; R[i] *= g; }
    const take = await save({ L, R, sr: rate, cycles: n, cps, mode: 'cycles', exact: true, loop: true, how: 'offline', fold: !!tail, src: { kind: info.kind, title: info.title, code: info.code }, haps: haps.length, fails });
    toast(`Rendered ${take.meta.name}: ${n} cycles, ${frames} frames${fails ? `, ${fails} events failed offline` : ''}`, { kind: fails ? 'info' : 'ok' });
  } catch (e) { toast('Render: ' + (e.message || e), { kind: 'error' }); }
  finally { if (swapped) { try { W.setAudioContext(live); W.setSuperdoughAudioController(ctl); } catch (e) { /* restore */ } } if (wasRunning && live) live.resume().catch(() => {}); st.rendering = false; sync(); renderTakes(); }
}

/* ---------- store (IndexedDB "sc-capture", object store "takes": {meta, audio}) ---------- */
const DB = new Promise((res) => {
  try { const rq = indexedDB.open('sc-capture', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('takes', { keyPath: 'meta.id' }); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (e) { res(null); }
});
const mem = new Map();
function tx(mode, fn) { return DB.then((db) => { if (!db) return fn(null); return new Promise((ok, no) => { const t = db.transaction('takes', mode); const r = fn(t.objectStore('takes')); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); t.onabort = () => no(t.error || new Error('storage full')); }); }); }
function peaks(L, R, cols = 160) {
  const out = new Float32Array(cols * 2), step = L.length / cols;
  for (let c = 0; c < cols; c++) { let lo = 0, hi = 0; for (let i = Math.floor(c * step), e = Math.min(L.length, Math.floor((c + 1) * step)); i < e; i++) { const v = (L[i] + R[i]) / 2; if (v < lo) lo = v; if (v > hi) hi = v; } out[c * 2] = lo; out[c * 2 + 1] = hi; }
  return out;
}
async function save(t) {
  const src = t.src || st.src || (sc.transport && sc.transport.source()) || {};
  const list = await listMeta(); const base = safe(opts.name); let name = base, i = 2; const names = new Set(list.map((m) => m.name));
  while (names.has(name)) name = base + '-' + i++;
  let pk = 0; for (let k = 0; k < t.L.length; k++) { const a = Math.abs(t.L[k]); if (a > pk) pk = a; }
  const meta = { id: 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: 'take', name, created: new Date().toISOString(),
    sr: t.sr, frames: t.L.length, seconds: t.L.length / t.sr, cycles: t.cycles, cps: +(+t.cps).toFixed(6), mode: t.mode, exact: !!t.exact, loop: !!t.loop, how: t.how,
    preRoll: t.preRoll || 0, fold: !!t.fold, haps: t.haps, fails: t.fails || 0, startCycle: t.startCycle, peak: pk, peaks: Array.from(peaks(t.L, t.R)),
    source: { kind: src.kind || null, title: src.title || null, code: src.code || '' }, bytes: t.L.length * 8 };
  const rec = { meta, audio: { L: t.L, R: t.R } };
  if (await DB) await tx('readwrite', (s) => s.put(rec)); else mem.set(meta.id, rec);
  quota(); return rec;
}
async function listMeta() { const db = await DB; const all = db ? await tx('readonly', (s) => s.getAll()) : [...mem.values()]; return (all || []).map((r) => r.meta).sort((a, b) => (a.created < b.created ? 1 : -1)); }
async function getTake(id) { const db = await DB; return db ? tx('readonly', (s) => s.get(id)) : mem.get(id); }
async function remove(id) { if (await DB) await tx('readwrite', (s) => s.delete(id)); else mem.delete(id); quota(); }
async function rename(id, name) { const r = await getTake(id); if (!r) return; r.meta.name = safe(name); if (await DB) await tx('readwrite', (s) => s.put(r)); else mem.set(id, r); return r.meta.name; }
let quotaMsg = '';
async function quota() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const { usage = 0, quota: q = 0 } = await navigator.storage.estimate(); const free = q - usage;
    quotaMsg = q && (usage / q > 0.8 || free < 64e6) ? `Storage nearly full: ${(free / 1e6).toFixed(0)} MB left of ${(q / 1e6).toFixed(0)} MB. Download and delete old takes.` : '';
    const el = $('#capQuota'); if (el) { el.textContent = quotaMsg || (q ? `${(usage / 1e6).toFixed(1)} MB used, ${(free / 1e6).toFixed(0)} MB free` : ''); el.classList.toggle('warn', !!quotaMsg); }
    if (quotaMsg && !quota.warned) { quota.warned = true; toast(quotaMsg, { kind: 'error' }); }
    if (navigator.storage.persist && !quota.asked) { quota.asked = true; navigator.storage.persist().catch(() => {}); }
  } catch (e) { /* estimate unsupported */ }
}

/* ---------- encode ---------- */
function infoChunk(fields) {
  const enc = new TextEncoder(); const parts = Object.entries(fields).map(([id, v]) => { const b = enc.encode(String(v) + '\0'); return { id, b, pad: b.length & 1 }; });
  const size = 4 + parts.reduce((a, p) => a + 8 + p.b.length + p.pad, 0); const out = new Uint8Array(8 + size); const dv = new DataView(out.buffer);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  w4(0, 'LIST'); dv.setUint32(4, size, true); w4(8, 'INFO'); let o = 12;
  for (const p of parts) { w4(o, p.id); dv.setUint32(o + 4, p.b.length, true); out.set(p.b, o + 8); o += 8 + p.b.length + p.pad; }
  return out;
}
function encodeWav(take, bits = 16) {
  const { L, R } = take.audio, m = take.meta, n = L.length, bps = bits === 24 ? 3 : 2, data = n * 2 * bps;
  const info = infoChunk({ INAM: m.name, ISFT: 'Strudel Craft capture', ICRD: m.created.slice(0, 10), ICMT: JSON.stringify({ cycles: m.cycles, cps: m.cps, exact: m.exact, loop: m.loop, how: m.how, source: m.source }) });
  const buf = new ArrayBuffer(44 + info.length + data), dv = new DataView(buf), u8 = new Uint8Array(buf);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) u8[o + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, 36 + info.length + data, true); w4(8, 'WAVE');
  w4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, m.sr, true);
  dv.setUint32(28, m.sr * 2 * bps, true); dv.setUint16(32, 2 * bps, true); dv.setUint16(34, bits === 24 ? 24 : 16, true);
  u8.set(info, 36); let o = 36 + info.length; w4(o, 'data'); dv.setUint32(o + 4, data, true); o += 8;
  const max = bits === 24 ? 8388607 : 32767;
  for (let i = 0; i < n; i++) for (const ch of [L, R]) {
    let v = Math.round(Math.max(-1, Math.min(1, ch[i])) * max);
    if (bps === 2) { dv.setInt16(o, v, true); o += 2; } else { if (v < 0) v += 0x1000000; u8[o] = v & 255; u8[o + 1] = (v >> 8) & 255; u8[o + 2] = (v >> 16) & 255; o += 3; }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
function sidecar(take) { const m = { ...take.meta }; delete m.peaks; return new Blob([JSON.stringify({ format: 'strudel-craft/capture@1', file: fileName(take, 'wav'), ...m }, null, 2)], { type: 'application/json' }); }
function fileName(take, ext) { const m = take.meta; return `${safe(m.name)}_${numStr(m.cycles)}c_${numStr(m.cps)}cps.${ext}`; }
function compressedType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [t, ext] of [['audio/webm;codecs=opus', 'webm'], ['audio/ogg;codecs=opus', 'ogg'], ['audio/mp4', 'm4a']]) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return { type: t, ext };
  return null;
}
/* compressed: play the take once through a silent private AudioContext into MediaRecorder (real time, never audible) */
async function encodeCompressed(take, onProgress) {
  const ct = compressedType(); if (!ct) throw new Error('No compressed encoder in this browser: use WAV');
  const m = take.meta, ctx = new AudioContext({ sampleRate: m.sr }); if (ctx.state !== 'running') await ctx.resume();
  const ab = ctx.createBuffer(2, m.frames, m.sr); ab.copyToChannel(take.audio.L, 0); ab.copyToChannel(take.audio.R, 1);
  const dst = ctx.createMediaStreamDestination(); const s = ctx.createBufferSource(); s.buffer = ab; s.connect(dst);
  const rec = new MediaRecorder(dst.stream, { mimeType: ct.type, audioBitsPerSecond: 160000 }); const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((ok) => { rec.onstop = ok; });
  rec.start(250); s.start(); const t0 = ctx.currentTime;
  const iv = setInterval(() => onProgress && onProgress(Math.min(1, (ctx.currentTime - t0) / m.seconds)), 200);
  await new Promise((ok) => { s.onended = ok; }); await new Promise((r) => setTimeout(r, 150)); rec.stop(); await done; clearInterval(iv); ctx.close();
  return { blob: new Blob(parts, { type: ct.type.split(';')[0] }), ext: ct.ext };
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
async function download(id, fmt = 'wav16') {
  const t = await getTake(id); if (!t) return;
  if (fmt === 'json') return saveBlob(sidecar(t), fileName(t, 'json'));
  if (fmt === 'wav16' || fmt === 'wav24') return saveBlob(encodeWav(t, fmt === 'wav24' ? 24 : 16), fileName(t, 'wav'));
  const note = $(`#capTakes [data-id="${id}"] .cap-tk-sub`); const was = note && note.textContent;
  try { const { blob, ext } = await encodeCompressed(t, (p) => { if (note) note.textContent = `Encoding ${Math.round(p * 100)}%`; }); saveBlob(blob, fileName(t, ext)); }
  catch (e) { toast(e.message, { kind: 'error' }); } finally { if (note) note.textContent = was; }
}

/* ---------- UI ---------- */
const ICON_REC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" class="cap-dot"/><circle cx="12" cy="12" r="10" class="cap-ring"/></svg>';
let el = {};
function seg(name, label, items, val) {
  return `<fieldset class="cap-seg" data-k="${name}"><legend>${label}</legend>${items.map(([v, t]) => `<label><input type="radio" name="cap-${name}" value="${v}"${String(v) === String(val) ? ' checked' : ''}><span>${t}</span></label>`).join('')}</fieldset>`;
}
function build() {
  if ($('#capSheet')) return;
  const tb = document.createElement('button'); tb.type = 'button'; tb.id = 'capBtn'; tb.className = 'tp-btn cap-btn'; tb.setAttribute('aria-label', 'Capture audio'); tb.setAttribute('aria-expanded', 'false'); tb.setAttribute('aria-controls', 'capSheet'); tb.title = 'Capture (record takes)';
  tb.innerHTML = ICON_REC; tb.addEventListener('click', () => toggleSheet());
  const host = $('.tp-main'); if (host) host.append(tb);
  const w = document.createElement('section'); w.id = 'capSheet'; w.className = 'cap'; w.hidden = true; w.setAttribute('aria-label', 'Audio capture');
  w.innerHTML = `
  <div class="cap-head">
    <button type="button" class="cap-rec" id="capRec" aria-pressed="false">${ICON_REC}<span id="capRecLabel">Record</span></button>
    <div class="cap-read"><output id="capTime" class="cap-time">0:00.0</output><span id="capState" class="cap-state" role="status" aria-live="polite">Ready</span></div>
    <canvas id="capMeter" class="cap-meter" role="img" aria-label="Capture input level"></canvas>
    <button type="button" class="icon ghost" id="capClose" aria-label="Close capture">&times;</button>
  </div>
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
  <ol class="cap-takes" id="capTakes" aria-label="Takes"></ol>
  <p class="cap-quota" id="capQuota"></p>`;
  document.body.append(w);
  el = { tb, w, rec: $('#capRec'), lab: $('#capRecLabel'), time: $('#capTime'), state: $('#capState'), meter: $('#capMeter'), n: $('#capN'), hint: $('#capHint'), takes: $('#capTakes'), exact: $('#capExact') };
  $('#capClose').addEventListener('click', () => close());
  el.rec.addEventListener('click', () => toggleRec());
  el.exact.addEventListener('click', () => renderExact());
  w.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'cap-mode') { opts.mode = t.value; set('mode', opts.mode); }
    else if (t.name === 'cap-bits') { opts.bits = +t.value; set('bits', opts.bits); }
    else if (t.id === 'capCount') { opts.countIn = +t.value; set('countIn', opts.countIn); }
    else if (t.id === 'capPre') { opts.preRoll = +t.value; set('preRoll', opts.preRoll); }
    else if (t.id === 'capFold') { opts.fold = t.checked; set('fold', opts.fold); }
    else if (t.id === 'capName') { opts.name = safe(t.value); t.value = opts.name; set('name', opts.name); }
    sync();
  });
  w.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]'); if (s) { opts.n = Math.max(1, Math.min(64, opts.n + +s.dataset.step)); set('n', opts.n); sync(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return; const id = b.closest('[data-id]').dataset.id; takeAct(b.dataset.act, id, b);
  });
  w.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  sync();
}
function sync() {
  if (!el.w) return;
  const busy = st.phase !== 'idle';
  el.rec.setAttribute('aria-pressed', String(busy)); el.lab.textContent = st.phase === 'waiting' ? 'Cancel' : busy ? 'Stop' : 'Record';
  el.w.dataset.phase = st.phase; el.tb.dataset.phase = st.phase; document.body.classList.toggle('capturing', busy);
  el.tb.setAttribute('aria-label', busy ? 'Capture: recording, open controls' : 'Capture audio');
  el.n.textContent = opts.n; $('#capExactN').textContent = opts.n; $('#capNLab').closest('.cap-num').classList.toggle('off', opts.mode !== 'cycles');
  el.exact.disabled = st.rendering || busy; el.exact.firstChild.textContent = st.rendering ? 'Rendering ' : 'Render exact ';
  for (const i of el.w.querySelectorAll('.cap-opts input, .cap-opts select, .cap-opts button')) i.disabled = busy;
  el.hint.textContent = opts.mode === 'cycles' ? `Starts and stops on cycle boundaries: ${opts.n} cycle${opts.n > 1 ? 's' : ''}, loops cleanly. Pre-roll is ignored.`
    : opts.mode === 'until' ? 'Records until you stop or the play-time limit is reached.' : 'Records from now until you stop.';
  if (!busy) { el.state.textContent = st.rendering ? 'Rendering offline' : 'Ready'; el.time.textContent = '0:00.0'; }
}
function draw() {
  if (!el.w || el.w.hidden && st.phase === 'idle') return;
  const rate = sr(), now = st.tapCtx ? st.tapCtx.currentTime * rate : 0;
  if (st.phase === 'waiting') { const ck = clock(); const left = (st.recFrame - now) / rate; el.time.textContent = '-' + fmtT(left); el.state.textContent = ck && st.startCycle != null ? `Count-in: ${Math.max(0, Math.ceil(left * ck.cps))}` : 'Starting'; }
  else if (st.phase === 'recording') {
    const t = (now - st.recFrame) / rate; el.time.textContent = fmtT(t);
    el.state.textContent = opts.mode === 'cycles' ? `Cycle ${Math.min(opts.n, t * st.cps).toFixed(1)} / ${opts.n}` : opts.mode === 'until' ? `Cap ${fmtT((st.endFrame - st.recFrame) / rate)}` : 'Recording';
  }
  const c = el.meter, dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (!W || !H) return; if (c.width !== W) c.width = W; if (c.height !== H) c.height = H;
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(el.w); const db = st.peak > 0 ? 20 * Math.log10(st.peak) : -90; const x = Math.max(0, Math.min(1, (db + 60) / 60)) * W;
  g.fillStyle = cs.getPropertyValue('--line').trim() || '#262d36'; g.fillRect(0, 0, W, H);
  g.fillStyle = db > -1 ? (cs.getPropertyValue('--bad').trim() || '#f66') : st.phase === 'recording' ? (cs.getPropertyValue('--bad').trim() || '#f66') : (cs.getPropertyValue('--sig-2').trim() || '#2fd6c3'); g.fillRect(0, 0, x, H);
  st.peak *= 0.92;
}
async function renderTakes() {
  if (!el.takes) return;
  const list = await listMeta();
  el.takes.innerHTML = list.length ? list.map((m) => `<li data-id="${m.id}" class="cap-tk">
    <canvas class="cap-wave" aria-hidden="true"></canvas>
    <div class="cap-tk-info"><b class="cap-tk-name">${esc(m.name)}</b><span class="cap-tk-sub">${numStr(m.cycles)}c · ${numStr(m.cps)} cps · ${fmtT(m.seconds)}${m.exact ? ' · loop' : ''}${m.how === 'offline' ? ' · exact' : ''}</span></div>
    <div class="cap-tk-acts">
      <button type="button" class="ghost icon" data-act="play" aria-label="Play ${esc(m.name)}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" class="fill"/></svg></button>
      <button type="button" class="ghost icon" data-act="rename" aria-label="Rename ${esc(m.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>
      <button type="button" class="ghost icon" data-act="dl" aria-label="Download ${esc(m.name)}" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>
      <button type="button" class="ghost icon" data-act="del" aria-label="Delete ${esc(m.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>
    </div>
    <div class="cap-dl" hidden><button type="button" data-act="wav16">WAV 16</button><button type="button" data-act="wav24">WAV 24</button>${compressedType() ? `<button type="button" data-act="comp">${compressedType().ext.toUpperCase()}</button>` : ''}<button type="button" data-act="json">JSON</button></div>
  </li>`).join('') : '<li class="cap-empty">No takes yet. Record or render one; takes stay on this device.</li>';
  for (const li of el.takes.querySelectorAll('li[data-id]')) { const m = list.find((x) => x.id === li.dataset.id); wave(li.querySelector('canvas'), m.peaks); }
  quota();
}
function wave(c, pk) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round((c.clientWidth || 96) * dpr), H = Math.round((c.clientHeight || 40) * dpr); c.width = W; c.height = H;
  const g = c.getContext('2d'), cols = pk.length / 2, cs = getComputedStyle(c);
  let mx = 1e-6; for (const v of pk) mx = Math.max(mx, Math.abs(v)); const k = (H / 2 - dpr) / Math.max(mx, 0.05);
  g.fillStyle = cs.getPropertyValue('--sig-2').trim() || '#2fd6c3';
  for (let i = 0; i < cols; i++) { const x = Math.floor(i * W / cols), w = Math.max(1, Math.floor(W / cols) - (W / cols > 2 ? 1 : 0)); const y0 = H / 2 - pk[i * 2 + 1] * k, y1 = H / 2 - pk[i * 2] * k; g.fillRect(x, y0, w, Math.max(dpr, y1 - y0)); }
}
let player = null, playerId = null;
async function takeAct(act, id, btn) {
  const li = btn.closest('li');
  if (act === 'play') {
    if (player && playerId === id) { player.pause(); return; }
    if (player) player.pause();
    const t = await getTake(id); if (!t) return;
    const a = new Audio(); a.src = URL.createObjectURL(encodeWav(t, 16)); a.loop = true; player = a; playerId = id; /* HTMLAudio, not the WebAudio bus: previews are never recorded */
    const pb = btn; pb.setAttribute('aria-pressed', 'true');
    a.onpause = () => { pb.setAttribute('aria-pressed', 'false'); URL.revokeObjectURL(a.src); if (player === a) { player = null; playerId = null; } };
    a.play().catch((e) => toast('Preview: ' + e.message, { kind: 'error' }));
  } else if (act === 'rename') {
    const cur = li.querySelector('.cap-tk-name').textContent;
    const v = await sc.ui.ask({ title: 'Rename take', label: 'Name (letters, digits, - _ .)', value: cur, okText: 'Rename' });
    if (v && v.trim()) { const n = await rename(id, v); toast('Renamed to ' + n, { kind: 'ok' }); renderTakes(); }
  } else if (act === 'del') {
    const cur = li.querySelector('.cap-tk-name').textContent;
    if (await sc.ui.askYesNo({ title: 'Delete take', message: `Delete "${cur}" from this device? Download it first to keep it.`, okText: 'Delete', danger: true })) { if (playerId === id && player) player.pause(); await remove(id); toast('Deleted ' + cur, { kind: 'info' }); renderTakes(); }
  } else if (act === 'dl') {
    const d = li.querySelector('.cap-dl'); d.hidden = !d.hidden; btn.setAttribute('aria-expanded', String(!d.hidden));
  } else if (act === 'wav16' || act === 'wav24' || act === 'json' || act === 'comp') download(id, act === 'comp' ? 'comp' : act);
}
function dock() { const tp = $('.transport'); if (tp && el.w) el.w.style.setProperty('--cap-bottom', Math.round(tp.getBoundingClientRect().height) + 'px'); }
addEventListener('resize', () => st.open && dock());
function open() { build(); dock(); el.w.hidden = false; st.open = true; el.tb.setAttribute('aria-expanded', 'true'); document.body.classList.add('cap-open'); renderTakes(); loop(); el.rec.focus({ preventScroll: true }); }
function close() { if (!el.w) return; el.w.hidden = true; st.open = false; el.tb.setAttribute('aria-expanded', 'false'); document.body.classList.remove('cap-open'); el.tb.focus({ preventScroll: true }); }
function toggleSheet() { el.w && !el.w.hidden ? close() : open(); }

function init() {
  build();
  const P = sc.palette; if (P) {
    P.register({ id: 'capture.open', group: 'Capture', title: 'Open capture', run: () => open() });
    P.register({ id: 'capture.record', group: 'Capture', title: 'Record / stop take', run: () => { open(); toggleRec(); } });
    P.register({ id: 'capture.cycles', group: 'Capture', title: 'Record N cycles (loop)', run: () => { open(); if (st.phase === 'idle') { configure({ mode: 'cycles' }); record(); } } });
    P.register({ id: 'capture.exact', group: 'Capture', title: 'Render exact N cycles (offline)', run: () => { open(); renderExact(); } });
  }
}
sc.capture = { open, close, toggle: toggleSheet, record, stop, toggleRec, configure, renderExact, list: listMeta, get: getTake, remove, rename, encodeWav, sidecar, fileName, download, opts, state: st };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
