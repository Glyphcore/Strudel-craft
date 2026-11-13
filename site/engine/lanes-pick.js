// Capture picker kinds and default `what` (docs/LANES.md 6.1; #76, #77): the single source of truth shared by the capture runtime
// (lanes-capture.js) and the data layer (lanes-data.js, model.js, intellisense). Pure, no imports, no side effects.
export const LAYERS = ['events', 'audio', 'level'];
export const pickerKind = (p) => (p === 'master' ? 'master' : /^bus:[\w-]+$/.test(p) ? 'bus' : /^[\w$-]+\/[\w-]+$/.test(p) ? 'tap' : 'selector');
export const defaultWhat = (picker) => (pickerKind(picker) === 'tap' ? ['events'] : pickerKind(picker) === 'selector' ? [...LAYERS] : ['audio', 'level']);
