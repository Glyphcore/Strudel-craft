// Assembles the engine on window.strudelCraft (controls, pads, input). UI wiring lives in #55.
import { createRegistry } from './controls.js';
import * as controlsMod from './controls.js';
import * as padsMod from './pads.js';
import * as inputMod from './input.js';
import * as timeMod from './time.js';
import { validate } from './validate.js';

const sc = (globalThis.strudelCraft = globalThis.strudelCraft || {});
const registry = createRegistry();
sc.input = sc.input || inputMod.createInput();
sc.controls = Object.assign(sc.controls || {}, { registerType: registry.registerType, registerRenderer: registry.registerRenderer, types: registry.types,
  registry, create: (o) => controlsMod.createControls({ registry, ...o }), lib: controlsMod,
  ready: fetch(new URL('../data/controls/types.json', import.meta.url)).then(r => r.json()).then(j => { j.types.forEach(registry.registerType); return registry; }).catch(() => registry) });
sc.pads = Object.assign(sc.pads || {}, { create: padsMod.createPads, looper: padsMod.createLooper, lib: padsMod, keyboardProvider: inputMod.keyboardProvider, touchProvider: inputMod.touchProvider,
  webmidiProvider: inputMod.webmidiProvider, router: inputMod.createRouter, defaultKeyboardMap: inputMod.DEFAULT_KEYBOARD_MAP });
sc.engine = { time: timeMod, validate };
export default sc;
