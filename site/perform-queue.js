/* Perform input queue (#198): pure core, no DOM. Pad/pointer/key events are stamped at capture, queued and applied in order by a fixed ~30 Hz
   handler (setInterval, not rAF; a worker timer is opt-in via env.worker or a timer is injectable). Events are never coalesced or dropped. A leading edge
   keeps an isolated tap at today's latency: an event arriving while the queue is idle and the last drain is older than one interval is
   applied at once; only bursts wait for the tick (at most one interval, and each carries its capture time + lag to the handler).
   Held box (createHeld): per control, the set of pointer ids holding it. Rules: a down from a new pointer on a held control LAYERS (the
   hold lasts until the last pointer is up, every down still fires apply: retrigger is the pad mode's business); up/cancel from a pointer
   that holds nothing is ignored (no double release); releaseAll() (blur, visibilitychange, lostpointercapture, multi-touch loss) returns
   a synthetic 'up' for every hold so a gate/filter/stutter can never stick. */
export const DRAIN_DEFAULT = 1; // ms; chosen by measurement (docs: Perform input queue), overridable by ?drain=<ms> or localStorage sc.perform.drainMs
export function resolveDrainMs(search = '', storage = null, def = DRAIN_DEFAULT) {
  const ok = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null; };
  let v = null; try { v = ok(new URLSearchParams(search).get('drain')); } catch (e) { /* none */ }
  if (v == null && storage) { try { v = ok(storage.getItem('sc.perform.drainMs')); } catch (e) { /* none */ } }
  return v == null ? def : v;
}
export const IDLE_DEFAULT = 3000; // ms with an empty queue and nothing held before the timer is torn down; ?idle=<ms> or localStorage sc.perform.idleMs
export function resolveIdleMs(search = '', storage = null, def = IDLE_DEFAULT) {
  const ok = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 && n <= 600000 ? n : null; };
  let v = null; try { v = ok(new URLSearchParams(search).get('idle')); } catch (e) { /* none */ } if (v == null && storage) { try { v = ok(storage.getItem('sc.perform.idleMs')); } catch (e) { /* none */ } }
  return v == null ? def : v;
}
export function createHeld() {
  const m = new Map(); // ctl -> Set(pid)
  return {
    down(ctl, pid) { let s = m.get(ctl); if (!s) m.set(ctl, s = new Set()); const first = s.size === 0; s.add(pid); return { first, count: s.size }; },
    up(ctl, pid) { const s = m.get(ctl); if (!s || !s.delete(pid)) return null; if (!s.size) m.delete(ctl); return { last: !s.size, count: s.size }; },
    holding: (ctl) => (m.get(ctl) ? m.get(ctl).size : 0),
    has: (ctl, pid) => !!(m.get(ctl) && m.get(ctl).has(pid)),
    size: () => m.size,
    releaseAll() { const out = []; for (const [ctl, s] of m) for (const pid of s) out.push({ ctl, pid }); m.clear(); return out; },
  };
}
const worker = () => { try { const u = URL.createObjectURL(new Blob(['let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' })); const w = new Worker(u); URL.revokeObjectURL(u); return w; } catch (e) { return null; } };
/* env = { now, apply(ev, info), interval, timer: { start(fn, ms), stop() } } ; ev = { ctl, kind: 'down'|'up'|..., value, pid, t, seq } ; info = { lag, batch, i } */
export function createQueue(env = {}) {
  const now = env.now || (() => performance.now()); const interval = env.drainMs || env.interval || DRAIN_DEFAULT; const q = []; /* drainMs is a parameter */ const idleMs = env.idleMs != null ? env.idleMs : IDLE_DEFAULT; let lastAct = 0; let seq = 0, running = false, tm = null, lastDrain = -1e9, draining = false;
  const st = { starts: 0, stops: 0, pushed: 0, applied: 0, ticks: 0, emptyTicks: 0, leading: 0, maxLag: 0, errors: 0, maxBatch: 0 };
  const held = createHeld();
  const defTimer = () => { const w = env.worker ? worker() : null; /* a Blob worker per interaction cost ~15 ms of main-thread time and tripped the sound-load toast (#198 rework): setInterval is the default, env.worker opts in */ if (w) { let f; w.onmessage = () => f && f(); return { start: (fn, ms) => { f = fn; w.postMessage(ms); }, stop: () => { f = null; w.postMessage(0); w.terminate(); } }; } let id = 0; return { start: (fn, ms) => { id = setInterval(fn, ms); }, stop: () => clearInterval(id) }; };
  function drain() {
    if (draining || !q.length) return 0; draining = true; const batch = q.splice(0); const t = now(); lastDrain = t; st.maxBatch = Math.max(st.maxBatch, batch.length);
    batch.forEach((ev, i) => { const lag = Math.max(0, t - ev.t); st.maxLag = Math.max(st.maxLag, lag); try { env.apply(ev, { lag, batch: batch.length, i }); st.applied++; } catch (e) { st.errors++; st.lastError = e && e.message; } });
    draining = false; return batch.length;
  }
  function tick() { st.ticks++; if (!q.length) { st.emptyTicks++; if (!held.size() && now() - lastAct >= idleMs) stop(); return 0; } return drain(); }
  function push(ev) {
    start(); lastAct = now(); const e = { value: 1, pid: 0, ...ev, t: ev.t != null ? ev.t : now(), seq: ++seq }; st.pushed++; const idle = !q.length && !draining && (e.kind !== 'down' || now() - lastDrain >= interval); /* releases never wait (measured: a release deferred to the tick delayed the next sound by ~15 ms); a down after another drain within drainMs batches */ q.push(e);
    if (idle) { st.leading++; drain(); } return e;
  }
  /* pointer-style helper: tracks holds so up/cancel release exactly once and a lost up can be synthesised */
  function down(ctl, pid, extra) { const h = held.down(ctl, pid); return push({ ...extra, ctl, kind: 'down', pid, layer: !h.first }); }
  function up(ctl, pid, extra) { lastAct = now(); const h = held.up(ctl, pid); if (!h) return null; return push({ ...extra, ctl, kind: 'up', pid, last: h.last }); }
  function lost(reason) { const hs = held.releaseAll(); hs.forEach((x) => push({ ctl: x.ctl, kind: 'up', pid: x.pid, last: true, lost: reason || 'lost' })); drain(); return hs.length; }
  function start() { if (running) return; running = true; st.starts++; tm = (env.timer || defTimer()); tm.start(tick, interval); }
  function stop() { if (!running) return; running = false; st.stops++; tm && tm.stop(); tm = null; }
  return {
    push, down, up, lost, drain, tick, held, stats: st, pending: () => q.length,
    start, stop, drainMs: interval, idleMs,
    get running() { return running; },
  };
}
