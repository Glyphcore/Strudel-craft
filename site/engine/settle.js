// One settle scheduler (docs/CONTROL_BINDING.md section 4): quiet ~350 ms, max wait ~1.5 s, stale runs cancelled by token.
// createSettle({ quiet, maxWait, run(views, ctx) }) ; ctx.alive() is false once a newer run started.
export function createSettle({ quiet = 350, maxWait = 1500, run, now = () => Date.now(), timers = globalThis } = {}) {
  const pending = new Set(); let t = 0, first = 0, token = 0;
  const stats = { pokes: 0, runs: 0, compiles: 0, cancelled: 0 };
  const listeners = new Set();
  const emit = (state, view, extra) => listeners.forEach((f) => { try { f({ state, view, ...extra }); } catch (e) { /* ignore */ } });
  function fire() {
    timers.clearTimeout(t); t = 0; first = 0; if (!pending.size) return;
    const views = [...pending]; pending.clear(); const my = ++token; stats.runs++;
    const ctx = { token: my, alive: () => my === token, stats, emit, cancelled: () => { stats.cancelled++; } };
    return Promise.resolve().then(() => run(views, ctx)).catch((e) => console.warn('[settle]', e));
  }
  return {
    poke(view = 'rack') {
      stats.pokes++; pending.add(view); emit('dirty', view);
      const n = now(); if (!first) first = n; timers.clearTimeout(t);
      const wait = Math.max(0, Math.min(quiet, maxWait - (n - first)));
      t = timers.setTimeout(fire, wait);
    },
    flush: fire, stats, on(f) { listeners.add(f); return () => listeners.delete(f); },
    get token() { return token; }, pending: () => [...pending],
  };
}
