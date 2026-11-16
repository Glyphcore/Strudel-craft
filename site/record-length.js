/* Record length model (pure, no DOM, importable from Node): bars / cycles / seconds, start bar, "to end of track".
   Time base: one cycle = cpb bars-worth of time; cpb (cycles per bar, default 1) and bpb (beats per bar, default 4) are the hooks registry
   settings (docs/HOOKS_SYNTAX.md 4.1). Bar N (1-based) starts at cycle (N-1)*cpb. Seconds = cycles / cps.
   bpm <-> cps follows the beats-per-bar: cps = bpm / (60 * bpb * cpb), so 128.8 bpm in 4/4 is 0.53667 cps and 140 bpm in 7/8 is 0.3333 cps.
   End of track (resolveEnd), first rule that applies wins:
     1 gates     the end of the last gate window of any hooks binding (a finite until, e.g. "9b..17b" -> bar 17); when the last window is open
                 ended ("@17b") the last section is assumed as long as the one before it (bar 17 + (17 - previous boundary))
     2 marker    a hooks marker named "end" (hooks.marker("end", "33b"))
     3 header    "// @daw bars=N" in the program (the DAW export header): N bars -> end bar N+1
     4 loop      the transport Loop range end, when Loop is on (site only)
     5 period    the longest lane pattern period (arrange([n, pat], ...) totals, <a b c> alternations, .slow(n)), at least 1 bar
   The result is an exclusive end bar ("33" = the take stops where bar 33 begins, so bar 32 is the last bar). Typing a value overrides it. */
import { blankComments } from './engine/comments.js';
export const MAX_MIN = 20;
export const MIN_CYCLES = 1 / 16;
export const UNITS = ['bars', 'cycles', 'seconds'];
export const CHIPS = { bars: [4, 8, 16, 32], cycles: [4, 8, 16, 32], seconds: [10, 30, 60, 120] };

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : NaN);
export const cpsFromBpm = (bpm, bpb = 4, cpb = 1) => bpm / (60 * bpb * cpb);
export const bpmFromCps = (cps, bpb = 4, cpb = 1) => cps * 60 * bpb * cpb;
export const barToCycle = (bar, cpb = 1) => (bar - 1) * cpb;
export const cycleToBar = (c, cpb = 1) => c / cpb + 1;
export const mmss = (sec) => { const t = Math.round(Math.max(0, sec) * 10) / 10; const m = Math.floor(t / 60); const s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); };

/* "12", "12.5", "12,5", "1:30" (seconds only) -> { ok, value } | { ok: false, error } */
export function parseLen(text, unit = 'bars') {
  const s = String(text == null ? '' : text).trim().replace(',', '.');
  if (!s) return { ok: false, error: 'Enter a length' };
  let m, v;
  if ((m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) { if (unit !== 'seconds') return { ok: false, error: 'm:ss only works with Seconds' }; v = +m[1] * 60 + +m[2]; }
  else if (/^\d+(\.\d+)?$|^\.\d+$/.test(s)) v = parseFloat(s);
  else return { ok: false, error: `"${String(text).trim()}" is not a number` };
  if (!(v > 0)) return { ok: false, error: 'Length must be more than 0' };
  return { ok: true, value: v };
}
export const parseStartBar = (text) => {
  const s = String(text == null ? '' : text).trim().replace(',', '.'); if (!s) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: `"${s}" is not a bar number` };
  const v = parseFloat(s); if (v < 1) return { ok: false, error: 'Bars start at 1' };
  return { ok: true, value: v };
};

export function toCycles(value, unit, { cps, cpb = 1 }) {
  return unit === 'bars' ? value * cpb : unit === 'seconds' ? value * cps : value;
}
export function derive(cycles, { cps, cpb = 1 }) { return { cycles, bars: cycles / cpb, seconds: cycles / cps }; }

/* gate end from a hooks.plan() result (slots -> scopes -> pieces {from, until, bindings}; fractions as "n" or "n/d" strings) */
const fr = (x) => { if (x == null) return null; const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(x)); return m ? +m[1] / +(m[2] || 1) : num(+x); };
export function gateEnd(plan, horizon) {
  if (!plan || !plan.slots) return null;
  const bounds = new Set(); let lastEnd = null, openStart = null;
  for (const slot of Object.values(plan.slots)) for (const pcs of Object.values(slot.scopes || {})) for (const p of pcs) {
    if (!p.bindings || !p.bindings.some((b) => !String(b).startsWith('else:'))) continue;
    const a = fr(p.from), z = fr(p.until);
    if (a > 1e-9) bounds.add(a);
    if (z != null && z < horizon - 1e-9) { bounds.add(z); lastEnd = Math.max(lastEnd == null ? 0 : lastEnd, z); }
    else if (a > 1e-9) openStart = Math.max(openStart == null ? 0 : openStart, a);
  }
  if (openStart != null && (lastEnd == null || openStart >= lastEnd)) {
    const prev = [...bounds].filter((b) => b < openStart - 1e-9).sort((x, y) => y - x)[0] || 0;
    return openStart + (openStart - prev);
  }
  return lastEnd;
}

/* marker point "33b", "17.3b", "64c", "1:30" (+/- offset in c|b|s) -> cycles, null when not readable */
export function pointToCycle(raw, { cpb = 1, bpb = 4, cps = 0 } = {}) {
  if (typeof raw === 'number') return raw >= 0 ? raw : null;
  const s = String(raw).trim(); let m, base, rest = '';
  if ((m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) return cps ? (+m[1] * 60 + +m[2]) * cps : null;
  if ((m = /^(\d+)\.(\d+)b(.*)$/.exec(s))) { base = ((+m[1] - 1) + (+m[2] - 1) / bpb) * cpb; rest = m[3]; }
  else if ((m = /^(\d+(?:\.\d+)?)([cbs]?)(.*)$/.exec(s))) { const n = +m[1]; if (m[2] === 'b') { if (n < 1) return null; base = (n - 1) * cpb; } else if (m[2] === 's') { if (!cps) return null; base = n * cps; } else base = n; rest = m[3]; }
  else return null;
  if (rest) { const o = /^([+-])(\d+(?:\.\d+)?)([cbs]?)$/.exec(rest); if (!o) return null; const k = +o[2] * (o[3] === 'b' ? cpb : o[3] === 's' ? cps : 1); base += o[1] === '+' ? k : -k; }
  return base >= 0 ? base : null;
}

/* static lane period in cycles from program text: arrange([n, pat], ...) totals, <a b c> items, .slow(n); >= 1 */
export function arrangeBars(src) {
  src = blankComments(src);
  const m = /\barrange\s*\(/.exec(src); if (!m) return null;
  let i = m.index + m[0].length, depth = 0, tot = 0, start = -1, first = true;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if ('([{'.includes(c)) { if (depth === 0 && c === '[') { start = k + 1; first = true; } depth++; }
    else if (')]}'.includes(c)) { if (depth === 0) return tot || null; depth--; }
    else if (c === ',' && depth === 1 && first && start >= 0) { const n = Number(src.slice(start, k).trim()); if (!Number.isFinite(n)) return null; tot += n; first = false; }
  }
  return null;
}
export function lanePeriod(code) {
  const src = blankComments(code || ''); let p = 1;
  const layers = src.split(/^(?=\s*(?:\$|[A-Za-z_]\w*)\s*:)/m);
  for (const L of layers) { const a = arrangeBars(L); if (a) p = Math.max(p, a); }
  for (const m of src.matchAll(/<([^<>]*)>/g)) p = Math.max(p, m[1].trim().split(/\s+/).filter(Boolean).length);
  for (const m of src.matchAll(/\.slow\(\s*(\d+(?:\.\d+)?)\s*\)/g)) p = Math.max(p, Math.ceil(+m[1]));
  return p;
}

/* -> { cycle, bar, rule: 'gates'|'marker'|'header'|'loop'|'period', note } (bar = exclusive end bar, 1-based) */
export function resolveEnd({ plan = null, horizon = 1024, markers = null, loop = null, code = '', cpb = 1, bpb = 4, cps = 0 } = {}) {
  const mk = (cycle, rule, note) => ({ cycle, bar: cycleToBar(cycle, cpb), rule, note });
  const g = gateEnd(plan, horizon); if (g != null && g > 0) return mk(g, 'gates', 'end of the last gate section');
  const mv = markers && (markers.end != null ? markers.end : null);
  if (mv != null) { const c = pointToCycle(mv, { cpb, bpb, cps }); if (c != null && c > 0) return mk(c, 'marker', 'marker "end"'); }
  const hd = /@daw[^\n]*\bbars=(\d+(?:\.\d+)?)/.exec(String(code || '')); if (hd && +hd[1] > 0) return mk(+hd[1] * cpb, 'header', '"// @daw bars=N" header');
  if (loop && loop.on && loop.end > 0) return mk(loop.end, 'loop', 'Loop range end');
  return mk(lanePeriod(code) * 1, 'period', 'longest lane pattern period');
}

/* The take for the panel's fields. in: { unit, value, startBar|null, toEnd, transportStart (cycles), cps, cpb, bpb, end (resolveEnd result, needed for toEnd), maxMin, extra, endBar (typed override) }
   out: { ok, error, startCycle, stopCycle, cycles, bars, seconds, startBar, endBar, toEnd } */
export function plan(o) {
  const { unit = 'bars', cps, cpb = 1, maxMin = MAX_MIN, extra = 0 } = o; const fail = (error) => ({ ok: false, error });
  if (!(cps > 0)) return fail('Tempo is not known yet');
  if (!UNITS.includes(unit)) return fail('Unit must be bars, cycles or seconds');
  const s0 = o.startBar != null ? barToCycle(o.startBar, cpb) : Math.max(0, num(o.transportStart) || 0);
  if (!(s0 >= 0)) return fail('Start bar must be 1 or later');
  let cycles;
  if (o.toEnd) {
    const endC = o.endBar != null ? barToCycle(o.endBar, cpb) : o.end && o.end.cycle;
    if (!(endC > 0)) return fail('End of track is not known');
    cycles = endC - s0; if (!(cycles > 0)) return fail(`Start is at or after the end of track (bar ${+cycleToBar(endC, cpb).toFixed(3)})`);
  } else {
    if (!(o.value > 0)) return fail('Length must be more than 0');
    cycles = toCycles(o.value, unit, { cps, cpb });
  }
  if (cycles < MIN_CYCLES - 1e-12) return fail('Too short: the minimum is 1/16 of a cycle');
  const sec = cycles / cps, lim = maxMin * 60 + extra;
  if (sec > lim + 1e-6) return fail(`Longer than the ${mmss(lim).replace(/\.0$/, '')} play-time limit (this is ${mmss(sec)}). Shorten it, or raise the limit in Play-time limit settings.`);
  const r6 = (x) => +x.toFixed(6);
  return { ok: true, startCycle: r6(s0), stopCycle: r6(s0 + cycles), cycles: r6(cycles), bars: r6(cycles / cpb), seconds: r6(sec), startBar: r6(cycleToBar(s0, cpb)), endBar: r6(cycleToBar(s0 + cycles, cpb)), toEnd: !!o.toEnd };
}

/* the optional timing fields a recipe stores next to cycles/start/stop (schemas/recipe.v1.json timing.bars ...) */
export function timingMeta(p, { unit, cpb = 1, bpb = 4, end = null } = {}) {
  return { bars: p.bars, startBar: p.startBar, unit, bpb, cpb, ...(p.toEnd ? { toEnd: true, ...(end ? { endRule: end.rule } : {}) } : {}) };
}
/* compat check for stored fields: old recipes (cycles only) pass; new ones must agree with cycles/start */
export function checkTimingMeta(t) {
  if (t.bars == null && t.startBar == null) return null;
  const cpb = t.cpb == null ? 1 : t.cpb;
  if (!(cpb > 0)) return 'timing.cpb must be above 0';
  if (t.bars != null && !(Math.abs(t.bars * cpb - t.cycles) < 1e-4 * Math.max(1, t.cycles))) return `timing.bars (${t.bars}) disagrees with timing.cycles (${t.cycles}) at ${cpb} cycles per bar`;
  if (t.startBar != null && !(Math.abs((t.startBar - 1) * cpb - t.start) < 1e-4 * Math.max(1, t.start))) return `timing.startBar (${t.startBar}) disagrees with timing.start (${t.start})`;
  return null;
}
