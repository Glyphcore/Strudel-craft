// Lanes L3, browser half (docs/LANES.md 6, 11e; issue #76): audio and level of a capture on the site. No UI. Loaded lazily with engine/lanes-capture.js the first time a
// program names capture / recall / .from (engine/index.js, strudelCraft.lanesCaptureEnsure). Public API only: the site's own offline renderer (strudelCraft.capture.renderRecipe,
// owned by the Record panel) renders the picked lanes, superdough's public registerSound plays the result as sound `cap_<name>`.
import { statements, scan } from './engine/lanes.js';

const code = (c, m) => Object.assign(new Error(`${c}: ${m}`), { code: c });
const SEED = 0x5c1a5; // fixed Math.random seed of capture renders, so a pure capture is reproducible

// The program with only the picked lanes: every statement that is not a lane stays (setcps, consts, hooks, captures), lanes outside the picker go.
// Sends of a kept lane reach a ret(...) lane only if that lane is picked too; a capture is what its lanes play on their own outputs.
export function restricted(src, cap) {
  const g = scan(src); const lane = new Map(g.lanes.map((l) => [l.line, l.id])); const keep = new Set(cap.lanes);
  return statements(src).filter((st) => !lane.has(st.line) || cap.kind === 'master' || keep.has(lane.get(st.line))).map((st) => st.text).join('\n');
}

export function createHost(sc, W = window) {
  const C = () => sc.lanesCapture;
  const cacheBuf = new WeakMap(); // AudioContext -> Map(name -> AudioBuffer)
  const bufferFor = (ac, name, e) => { let m = cacheBuf.get(ac); if (!m) cacheBuf.set(ac, (m = new Map())); const k = name; const have = m.get(k); if (have && have.__e === e) return have.b; const b = ac.createBuffer(2, e.L.length, e.sr); b.copyToChannel(e.L, 0); b.copyToChannel(e.R || e.L, 1); m.set(k, { __e: e, b }); return b; };
  // superdough sound for a captured buffer: speed (negative reverses), unit "c" (loopAt), begin / end, loop, and the attack / decay / sustain / release of the bus sound's defaults
  const sound = (name, e) => (t, value, onended) => {
    const ac = W.getAudioContext(); let b = bufferFor(ac, name, e); const speed = value.speed ?? 1; if (speed < 0) { const r = ac.createBuffer(2, b.length, b.sampleRate); for (let c = 0; c < 2; c++) r.copyToChannel(b.getChannelData(c).slice().reverse(), c); b = r; }
    let rate = Math.abs(speed); if (value.unit === 'c') rate *= b.duration; const src = ac.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    const { begin = 0, end = 1, loop, loopBegin = 0, loopEnd = 1 } = value; const dur = b.duration; if (loop) { src.loop = true; src.loopStart = loopBegin * dur; src.loopEnd = loopEnd * dur; }
    const a = value.attack ?? 0.001, rel = value.release ?? 0.01; const hold = value.duration ?? ((end - begin) * dur / rate); const play = (end - begin) * dur / rate; const stopAt = t + Math.min(loop ? hold : Math.min(hold, play), 1e6);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + a); g.gain.setValueAtTime(1, Math.max(t + a, stopAt)); g.gain.linearRampToValueAtTime(0, stopAt + rel);
    src.connect(g); src.start(t, begin * dur); src.stop(stopAt + rel + 0.01); src.onended = () => { try { g.disconnect(); } catch (er) { /* gone */ } onended && onended(); };
    return { node: g, nodes: { source: [src] }, stop: (x) => { try { src.stop(x); } catch (er) { /* already stopped */ } } };
  };
  async function renderCapture(src, name) { // pass 1 of LANES 6.2 for one capture: the picked lanes over the window, offline
    const c = C(); const an = c.analyze(); const cc = an && an.captures.find((x) => x.name === name); const d = c.defs().find((x) => x.name === name);
    if (!cc || !d) throw code('E_BAD_ARG', `no capture "${name}" in the evaluated program`);
    if (d.kind === 'bus') throw code('E_CAPTURE_LAYER', `bus:<name> audio capture is not built yet (coming); pick the lanes or master`);
    if (d.last != null) throw code('E_CAPTURE_LAYER', `audio of a rolling capture is not built yet (coming); use a window`);
    if (!sc.capture || !sc.capture.renderRecipe) throw code('E_CAPTURE_HOST', 'the site offline renderer (strudelCraft.capture.renderRecipe) is not available');
    const T = sc.transport; const info = await T.compileCode(restricted(src, cc)); if (!info.pattern) throw code('E_CAPTURE_HOST', 'the picked lanes did not compile to a pattern');
    const cps = +(+info.cps).toFixed(6); const code0 = restricted(src, cc);
    const recipe = { id: 'lanes-capture-' + name, name: 'capture ' + name, state: { source: { kind: 'code', code: code0 }, settings: { masterDb: 0 } }, timing: { cps, start: d.from, stop: d.until, cycles: d.until - d.from, loop: false, mode: 'cycles' }, random: { seed: SEED }, outputs: {}, events: {} };
    const out = await sc.capture.renderRecipe(recipe, { sr: 48000 }); return { ...out, cps };
  }
  // all audio captures of the program, in dependency order; the original program is compiled again at the end
  async function resolve(src) {
    const c = C(); const an = c.analyze(); const done = [];
    try {
      for (const name of an.order) { const d = c.defs().find((x) => x.name === name); if (!d || !d.what.some((w) => w !== 'events')) continue; if (d.last != null || d.kind === 'bus') continue;
        const out = await renderCapture(src, name); const e = c.setAudio(name, { L: out.L, R: out.R, sr: out.sr }, { cps: out.cps }); c.register(name, { registerSound: (key, ent) => W.registerSound(key, sound(name, ent), { type: 'sample' }) }); done.push({ name, frames: e.frames, sr: out.sr }); }
    } finally { await sc.transport.compileCode(src); }
    return done;
  }
  return { renderCapture, resolve, sound, restricted };
}
