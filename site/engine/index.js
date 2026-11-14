// Assembles the engine on window.strudelCraft (controls, pads, input). UI wiring lives in #55.
import { createRegistry } from './controls.js';
import * as controlsMod from './controls.js';
import * as padsMod from './pads.js';
import * as inputMod from './input.js';
import * as timeMod from './time.js';
import { validate } from './validate.js';
import * as hooksMod from './hooks.js';
import * as lanesMod from './lanes.js';

const sc = (globalThis.strudelCraft = globalThis.strudelCraft || {});
const registry = createRegistry();
sc.input = sc.input || inputMod.createInput();
sc.controls = Object.assign(sc.controls || {}, { registerType: registry.registerType, registerRenderer: registry.registerRenderer, types: registry.types,
  registry, create: (o) => controlsMod.createControls({ registry, ...o }), lib: controlsMod,
  ready: (sc.packs ? sc.packs.ready : Promise.resolve()).then(() => registry).catch(() => registry) }); // control types arrive through the pack loader's `control-types` adapter
sc.pads = Object.assign(sc.pads || {}, { create: padsMod.createPads, looper: padsMod.createLooper, lib: padsMod, keyboardProvider: inputMod.keyboardProvider, touchProvider: inputMod.touchProvider,
  webmidiProvider: inputMod.webmidiProvider, router: inputMod.createRouter, defaultKeyboardMap: inputMod.DEFAULT_KEYBOARD_MAP });
sc.engine = { time: timeMod, validate };

// Hooks runtime (#47/#48): installed on the page's Strudel globals once they exist (strudel:ready). The site runs live: queries never throw.
// Program text should go through strudelCraft.hooksLib.protect(code) before evaluation (double-quoted strings in hooks calls would become mini-notation).
sc.outer = sc.outer || []; // functions (haps, [begin, end, controls]) -> haps run by the outermost-query wrapper below, before the control maps (lanes selections)
sc.hooksLib = { ...hooksMod, protect: (src) => { try { sc.lanes?.reset?.(); } catch (e) { /* selections stay */ } if (sc.lanes?.prepare) src = sc.lanes.prepare(src).code; return hooksMod.protect(src); } }; // lanes.prepare: .split/.merge/.send/ret compile to plain Strudel on superdough buses (docs/LANES.md 5); a coded E_LANE_* / E_BUS_RANGE error propagates to the evaluation // protect() runs before every evaluation: selections of the previous program are dropped, the new program re-registers its own
sc.lanesLib = lanesMod;
// capture / recall / .from (docs/LANES.md 6, issue #76) load lazily the first time a program names them; app.js awaits this before every evaluation
sc.lanesCaptureEnsure = async (src) => {
  if (sc.lanesCapture || !sc.lanes || !/\bcapture\s*\(|\brecall\s*\(|\.\s*from\s*\(/.test(String(src))) return sc.lanesCapture || null;
  const m = await import('./lanes-capture.js'); if (sc.lanesCapture) return sc.lanesCapture; const C = m.installCapture(sc.lanes, globalThis, sc.hooks, { schedulerOnly: true, clock: () => { const sch = sc.transport && sc.transport.scheduler; return sch && sch.started ? sch.now() : null; } }); sc.lanesCapture = C; sc.lanesCaptureLib = m;
  try { const h = await import('../lanes-capture-site.js'); C.host = h.createHost(sc); } catch (e) { console.warn('[lanes] capture audio host:', e.message); }
  return C;
};
// Record panel hook (#76): every offline render (exact, reference, Remake) runs the capture passes first, in dependency order. Registered once per page, at load, because the first
// Remake of a fresh page has to find it already there; programs without capture / recall / .from cost one regex test. Teardown: strudelCraft.lanesCaptureHookOff().
const hookCapture = () => {
  if (sc.lanesCaptureHookOff || !sc.capture || !sc.capture.beforeRender) return;
  const off = sc.capture.beforeRender(async (recipe, o) => { if (!/\bcapture\s*\(|\brecall\s*\(|\.\s*from\s*\(/.test(String(o.code))) return; const C = await sc.lanesCaptureEnsure(o.code); if (C && C.host) await C.host.resolve(o.code); });
  sc.lanesCaptureHookOff = () => { off(); sc.lanesCaptureHookOff = null; };
};
hookCapture(); globalThis.document?.addEventListener('DOMContentLoaded', hookCapture); globalThis.addEventListener?.('strudel:ready', hookCapture);
sc.installHooks = (S = globalThis, o = {}) => {
  if (!S.Pattern || !S.signal || !S.Fraction) throw new Error('installHooks: Strudel globals (Pattern, signal, Fraction, ...) not ready');
  const r = hooksMod.install({ Pattern: S.Pattern, stack: S.stack, silence: S.silence, reify: S.reify, signal: S.signal, Fraction: S.Fraction, mini: S.mini }, o);
  r.hooks.live = true; sc.hooks = r.hooks; sc.tap = r.tap; sc.lanes = lanesMod.install({ Pattern: S.Pattern }, r.hooks, { outer: sc.outer, global: o.global }); return r;
};
const tryHooks = () => { if (!sc.hooks && globalThis.Pattern && globalThis.signal) { try { sc.installHooks(); } catch (e) { console.warn('[hooks]', e.message); } } };
tryHooks(); globalThis.addEventListener?.('strudel:ready', tryHooks);

// Intellisense: control names and type ids from every controls engine created through strudelCraft.controls.create (the Perform view makes one).
const instances = new Set(); const baseCreate = sc.controls.create;
sc.controls.create = (o) => { const c = baseCreate({ onChange: () => sc.hooks?.invalidate?.(), ...o }); for (const k of ['declare', 'ctl', 'load']) { const f = c[k]; c[k] = (...a) => { const r = f(...a); sc.intellisense?.invalidate?.(); return r; }; } instances.add(c); return c; };
sc.controls.completions = () => [...instances].flatMap((c) => c.completions());
const regControls = () => sc.intellisense?.register({ id: 'controls', items: () => sc.controls.completions() });
if (!regControls()) { const later = () => regControls(); if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later); else setTimeout(later, 0); }
// Maps apply to events: the outermost queryArc on a pattern passes its haps through every controls engine that has maps (unmapped: no-op).
// Pattern.prototype.queryArc is wrapped once; nested queries (hooks internals, signals) are not re-mapped.
const mapKey = (d) => { try { const h = globalThis.reify({})[d](1).queryArc(0, 0)[0]; const k = h && h.value && Object.keys(h.value)[0]; return k || d; } catch { return d; } };
const rangeOfDest = (d) => { const H = sc.hooks, r = H?.ranges?.[mapKey(d)] || H?.ranges?.[d] || H?.ranges?.[H?.canon ? H.canon(d) : d]; return r ? [r.min, r.max] : null; };
let qDepth = 0;
const wrapQuery = () => { const P = globalThis.Pattern?.prototype; if (!P || P.__scMaps || typeof P.queryArc !== 'function') return; P.__scMaps = true; const orig = P.queryArc;
  P.queryArc = function (...a) { qDepth++; try { const haps = orig.apply(this, a); if (qDepth > 1) return haps; let out = haps; for (const f of sc.outer) out = f(out, a); for (const c of instances) if (c.maps().length) out = c.applyMaps(out, { key: mapKey, rangeOf: rangeOfDest }); return out; } finally { qDepth--; } }; };
wrapQuery(); globalThis.addEventListener?.('strudel:ready', wrapQuery);
export default sc;

// AST-bound control sites + the one settle scheduler (docs/CONTROL_BINDING.md); app.js wires the run phases.
import * as bindMod from './bind.js';
import { createSettle } from './settle.js';
sc.bindLib = bindMod; sc.binder = sc.binder || bindMod.createBinder(); sc.createSettle = createSettle;
globalThis.dispatchEvent?.(new CustomEvent('sc:engine'));
