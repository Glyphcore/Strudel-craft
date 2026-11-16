/* Perform audition (docs/PERFORM_PRESETS.md section 4, #116): a pad that nothing in the program reads still sounds when pressed.
   Voices are plain superdough synth values (no sample banks, so the first tap is instant and offline-safe), chosen by the pad's ref name
   (kick, snare, ...), an explicit pad.audition voice name, or the pad's index in the bank (Beatpad order). The press is journaled by the pad
   engine as before; this module only plays the sound. DOM-free except createPlayer (needs the page's superdough). */
const D = (o) => o;
/* name -> { label, vs: [superdough values], dur }. gain is the base level; velocity scales it. */
export const VOICES = {
  kick: { dur: 0.4, vs: [D({ s: 'sine', note: 'c2', penv: 30, pdecay: 0.07, decay: 0.32, sustain: 0, release: 0.02, gain: 1.1 })] },
  snare: { dur: 0.25, vs: [D({ s: 'white', decay: 0.17, sustain: 0, release: 0.02, hpf: 1800, gain: 0.7 }), D({ s: 'triangle', note: 'a3', penv: 10, pdecay: 0.04, decay: 0.1, sustain: 0, gain: 0.6 })] },
  clap: { dur: 0.25, vs: [D({ s: 'white', decay: 0.16, sustain: 0, release: 0.02, bpf: 1500, bpq: 1.2, gain: 1.2 })] },
  hat: { dur: 0.1, vs: [D({ s: 'white', decay: 0.04, sustain: 0, release: 0.01, hpf: 7500, gain: 0.55 })] },
  ohat: { dur: 0.4, vs: [D({ s: 'white', decay: 0.28, sustain: 0, release: 0.05, hpf: 7000, gain: 0.5 })] },
  rim: { dur: 0.1, vs: [D({ s: 'sine', note: 'g5', decay: 0.04, sustain: 0, release: 0.01, gain: 0.7 }), D({ s: 'white', decay: 0.02, sustain: 0, hpf: 3000, gain: 0.4 })] },
  tom: { dur: 0.45, vs: [D({ s: 'sine', note: 'g2', penv: 12, pdecay: 0.1, decay: 0.38, sustain: 0, release: 0.03, gain: 1 })] },
  perc: { dur: 0.2, vs: [D({ s: 'triangle', note: 'e5', penv: -5, pdecay: 0.05, decay: 0.12, sustain: 0, release: 0.02, gain: 0.7 })] },
  bass: { dur: 0.6, vs: [D({ s: 'sawtooth', note: 'c2', lpf: 520, decay: 0.45, sustain: 0.2, release: 0.1, gain: 0.7 })] },
  stab: { dur: 0.3, vs: ['c4', 'eb4', 'g4'].map((n) => D({ s: 'sawtooth', note: n, lpf: 2200, decay: 0.16, sustain: 0, release: 0.04, gain: 0.3 })) },
  chord: { dur: 1.1, vs: ['c3', 'eb3', 'g3', 'bb3'].map((n) => D({ s: 'triangle', note: n, decay: 0.9, sustain: 0.1, release: 0.2, gain: 0.35 })) },
  lead: { dur: 0.5, vs: [D({ s: 'square', note: 'c5', lpf: 3200, decay: 0.35, sustain: 0.15, release: 0.1, gain: 0.35 })] },
  fx: { dur: 0.7, vs: [D({ s: 'white', attack: 0.02, decay: 0.45, sustain: 0, release: 0.2, hpf: 3500, gain: 1 })] },
  riser: { dur: 1.4, vs: [D({ s: 'white', attack: 0.4, decay: 0.3, sustain: 0, release: 0.2, hpf: 1200, gain: 0.9 })] },
  hit: { dur: 0.7, vs: [D({ s: 'sine', note: 'c1', penv: 36, pdecay: 0.12, decay: 0.55, sustain: 0, release: 0.05, gain: 1.1 }), D({ s: 'white', decay: 0.12, sustain: 0, hpf: 600, gain: 0.5 })] },
  crash: { dur: 1.4, vs: [D({ s: 'white', decay: 1.1, sustain: 0, release: 0.2, hpf: 5000, gain: 0.45 })] },
};
const ORDER = Object.keys(VOICES); // Beatpad order: pad index 0..15 (row-major) -> kick ... crash
const ALIAS = { bd: 'kick', sd: 'snare', cp: 'clap', hh: 'hat', oh: 'ohat', lt: 'tom', mt: 'tom', ht: 'tom', cr: 'crash', kick: 'kick', 'open-hat': 'ohat', openhat: 'ohat' };
export const voiceNames = () => ORDER.slice();
/* pad + its index in the bank -> voice name: explicit pad.audition, else the ref / label name, else the index */
export function voiceFor(pad, index) {
  const pick = (s) => { s = String(s || '').toLowerCase().replace(/[^a-z-]/g, ''); return VOICES[s] ? s : ALIAS[s] || null; };
  return pick(pad.audition) || pick(pad.target && pad.target.ref) || pick(pad.label) || ORDER[((index % ORDER.length) + ORDER.length) % ORDER.length];
}
/* does the program read the pad? Only a bare tap("x") / wire(..., "x") call is a reader; .tap("x") on a lane is the writer (publishes the lane) */
export function readsTap(ref, texts) {
  const r = String(ref).replace(/\(.*$/, '').replace(/@.*$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const q = `['"\`]${r}['"\`]`;
  const re = new RegExp(`(?<![.\\w$])(?:tap|wire)\\s*\\([^)\\n]*${q}`);
  return (texts || []).some((t) => String(t.text || '').split('\n').some((l) => re.test(l)));
}
/* a press -> the list of [value, durationSeconds] to hand to superdough */
export function plan(name, velocity) {
  const v = VOICES[name]; if (!v) return []; const k = velocity == null ? 1 : 0.45 + 0.55 * Math.max(0, Math.min(1, velocity));
  return v.vs.map((x) => [{ ...x, gain: +(x.gain * k).toFixed(3) }, v.dur]);
}
/* player: env = { sd: () => window.superdough, ctx: () => audio context | null, load: () => Promise (engine), unmute: () => void, worklets: () => Promise } */
export function createPlayer(env) {
  const st = { ready: false, pending: [], lat: [], count: 0, last: null, error: null, unlocked: false };
  let booting = null;
  const fire = (name, vel, t0) => {
    const ctx = env.ctx(); const sd = env.sd(); if (!ctx || !sd) return false;
    env.unmute(); const at = ctx.currentTime + (st.count < 2 ? 0.12 : 0.03); /* superdough drops a voice whose time passed while it built (first voices take longer) */
    for (const [v, d] of plan(name, vel)) { try { const r = sd({ ...v }, at, d, 1, 0); if (r && r.catch) r.catch((e) => { st.error = e.message; }); } catch (e) { st.error = e.message; } }
    st.count++; st.last = { name, at, ctxTime: ctx.currentTime }; if (t0 != null) { st.lat.push(performance.now() - t0); if (st.lat.length > 200) st.lat.shift(); } return true;
  };
  const boot = () => booting || (booting = (async () => {
    await env.load(); const ctx = env.ctx(); if (ctx && ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* blocked */ } }
    try { await env.worklets(); } catch (e) { /* synth voices need none */ }
    try { const sd = env.sd(); const c = env.ctx(); if (sd && c) for (const w of ['sine', 'white', 'sawtooth', 'square', 'triangle']) sd({ s: w, note: 'c3', gain: 0.0001, decay: 0.02, sustain: 0, lpf: 800, hpf: 300 }, c.currentTime + 0.02, 0.05, 1, 0); } catch (e) { /* warm-up only */ }
    st.ready = true; st.unlocked = !!(env.ctx() && env.ctx().state === 'running'); const now = performance.now();
    for (const p of st.pending.splice(0)) if (now - p.t0 < 4000) fire(p.name, p.vel, p.t0);
  })().catch((e) => { st.error = e.message; booting = null; }));
  /* resume inside the gesture (sync), play at once when the engine is up, else queue and boot */
  st.play = (name, vel, t0 = performance.now()) => {
    const ctx = env.ctx(); if (ctx && ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* later */ } }
    if (st.ready || (ctx && env.sd())) { if (ctx && ctx.state === 'running' || st.ready) return fire(name, vel, t0); }
    st.pending.push({ name, vel, t0 }); boot(); return false;
  };
  st.prewarm = () => { if (!st.ready && !booting) boot(); };
  return st;
}
