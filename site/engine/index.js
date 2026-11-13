// Assembles the engine on window.strudelCraft (controls, pads, input). UI wiring lives in #55.
import { createRegistry } from './controls.js';
import * as controlsMod from './controls.js';
import * as padsMod from './pads.js';
import * as inputMod from './input.js';
import * as timeMod from './time.js';
import { validate } from './validate.js';
import * as hooksMod from './hooks.js';

const sc = (globalThis.strudelCraft = globalThis.strudelCraft || {});
const registry = createRegistry();
sc.input = sc.input || inputMod.createInput();
sc.controls = Object.assign(sc.controls || {}, { registerType: registry.registerType, registerRenderer: registry.registerRenderer, types: registry.types,
  registry, create: (o) => controlsMod.createControls({ registry, ...o }), lib: controlsMod,
  ready: fetch(new URL('../data/controls/types.json', import.meta.url)).then(r => r.json()).then(j => { j.types.forEach(registry.registerType); return registry; }).catch(() => registry) });
sc.pads = Object.assign(sc.pads || {}, { create: padsMod.createPads, looper: padsMod.createLooper, lib: padsMod, keyboardProvider: inputMod.keyboardProvider, touchProvider: inputMod.touchProvider,
  webmidiProvider: inputMod.webmidiProvider, router: inputMod.createRouter, defaultKeyboardMap: inputMod.DEFAULT_KEYBOARD_MAP });
sc.engine = { time: timeMod, validate };

// Hooks runtime (#47/#48): installed on the page's Strudel globals once they exist (strudel:ready). The site runs live: queries never throw.
// Program text should go through strudelCraft.hooksLib.protect(code) before evaluation (double-quoted strings in hooks calls would become mini-notation).
sc.hooksLib = hooksMod;
sc.installHooks = (S = globalThis, o = {}) => {
  if (!S.Pattern || !S.signal || !S.Fraction) throw new Error('installHooks: Strudel globals (Pattern, signal, Fraction, ...) not ready');
  const r = hooksMod.install({ Pattern: S.Pattern, stack: S.stack, silence: S.silence, reify: S.reify, signal: S.signal, Fraction: S.Fraction, mini: S.mini }, o);
  r.hooks.live = true; sc.hooks = r.hooks; sc.tap = r.tap; return r;
};
const tryHooks = () => { if (!sc.hooks && globalThis.Pattern && globalThis.signal) { try { sc.installHooks(); } catch (e) { console.warn('[hooks]', e.message); } } };
tryHooks(); globalThis.addEventListener?.('strudel:ready', tryHooks);

// Intellisense: control names and type ids from every controls engine created through strudelCraft.controls.create (the Perform view makes one).
const instances = new Set(); const baseCreate = sc.controls.create;
sc.controls.create = (o) => { const c = baseCreate(o); for (const k of ['declare', 'ctl', 'load']) { const f = c[k]; c[k] = (...a) => { const r = f(...a); sc.intellisense?.invalidate?.(); return r; }; } instances.add(c); return c; };
sc.controls.completions = () => [...instances].flatMap((c) => c.completions());
const regControls = () => sc.intellisense?.register({ id: 'controls', items: () => sc.controls.completions() });
if (!regControls()) { const later = () => regControls(); if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later); else setTimeout(later, 0); }
// Maps apply to events: the outermost queryArc on a pattern passes its haps through every controls engine that has maps (unmapped: no-op).
// Pattern.prototype.queryArc is wrapped once; nested queries (hooks internals, signals) are not re-mapped.
const mapKey = (d) => { try { const h = globalThis.reify({})[d](1).queryArc(0, 0)[0]; const k = h && h.value && Object.keys(h.value)[0]; return k || d; } catch { return d; } };
const rangeOfDest = (d) => { const H = sc.hooks, r = H?.ranges?.[mapKey(d)] || H?.ranges?.[d] || H?.ranges?.[H?.canon ? H.canon(d) : d]; return r ? [r.min, r.max] : null; };
let qDepth = 0;
const wrapQuery = () => { const P = globalThis.Pattern?.prototype; if (!P || P.__scMaps || typeof P.queryArc !== 'function') return; P.__scMaps = true; const orig = P.queryArc;
  P.queryArc = function (...a) { qDepth++; try { const haps = orig.apply(this, a); if (qDepth > 1) return haps; let out = haps; for (const c of instances) if (c.maps().length) out = c.applyMaps(out, { key: mapKey, rangeOf: rangeOfDest }); return out; } finally { qDepth--; } }; };
wrapQuery(); globalThis.addEventListener?.('strudel:ready', wrapQuery);
export default sc;

// AST-bound control sites + the one settle scheduler (docs/CONTROL_BINDING.md); app.js wires the run phases.
import * as bindMod from './bind.js';
import { createSettle } from './settle.js';
sc.bindLib = bindMod; sc.binder = sc.binder || bindMod.createBinder(); sc.createSettle = createSettle;
globalThis.dispatchEvent?.(new CustomEvent('sc:engine'));
