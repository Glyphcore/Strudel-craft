// Mixer read model (docs/REFACTOR_PLAN.md phase 1): channel strips derived from the lane graph (lanes.js compile(src).graph).
// Pure module, no DOM, no Strudel, no audio: the same function serves the site model, the graph view, a mixer UI and the CLI.
// A lane is a channel; a `ret(name)` lane is a return channel fed by a named bus; `master` is where everything without another output ends.
// Tags are control groups (one selection moves every member); they do not sum audio. Bus numbers never appear here (they are allocated per
// compile). Nothing is edited here: edits stay text edits (`.send`, `tags`, `tagged(...)`), this module only describes what the text says.
export const MIXER_VERSION = 1;
const num = (x) => { const n = typeof x === 'number' ? x : parseFloat(String(x)); return Number.isFinite(n) ? n : null; };
const txt = (a) => String(a).replace(/^(['"`])([\s\S]*)\1$/, '$2');
const selTags = (sel) => String(sel).split(/[|&!()\s]+/).filter((t) => t && t[0] !== '#');
const selIds = (sel) => String(sel).split(/[|&!()\s]+/).filter((t) => t[0] === '#').map((t) => t.slice(1));

// graph: the object `strudel lanes IN` prints (lanes, audio.{sends,returns,splits,wires}, selections, tags)
export function channels(graph) {
  const g = graph || {}; const lanes = g.lanes || []; const a = g.audio || {};
  const returns = new Map((a.returns || []).map((r) => [r.lane, r.bus])); // lane id -> bus it returns
  const busLane = new Map((a.returns || []).map((r) => [r.bus, r.lane]));
  const strips = lanes.map((l) => {
    const isRet = returns.has(l.id);
    const sends = (a.sends || []).filter((s) => s.lane === l.id).map((s) => ({ bus: s.bus, to: busLane.get(s.bus) || null, amount: num(s.amount), expr: num(s.amount) == null ? String(s.amount) : undefined, line: s.line }));
    const splits = (a.splits || []).filter((s) => s.lane === l.id).length;
    // selections that address this lane (by tag or #id): gates and group moves the strip is under
    const under = (g.selections || []).filter((s) => selIds(s.selector).includes(l.id) || selTags(s.selector).some((t) => (l.tags || []).includes(t)));
    const mutes = under.flatMap((s) => (s.ops || []).filter((o) => o.op === 'mute' || o.op === 'solo').map((o) => ({ op: o.op, gate: o.args && o.args.length ? txt(o.args[0]) : '*', selector: s.selector, line: s.line })));
    return { id: l.id, kind: isRet ? 'return' : 'lane', label: l.label || l.id, line: l.line, orbit: l.orbit ?? null, bus: isRet ? returns.get(l.id) : undefined,
      tags: [...(l.tags || [])], inserts: Object.keys(l.fx || {}), splits, sends, mutes, taps: (l.taps || []).map((t) => (typeof t === 'string' ? t : t.name)), reads: [...(l.reads || [])], out: 'master' };
  });
  const feeds = (id) => strips.filter((s) => s.sends.some((x) => x.to === id)).map((s) => s.id);
  for (const s of strips) if (s.kind === 'return') s.inputs = feeds(s.id);
  const tagSet = [...new Set(lanes.flatMap((l) => l.tags || []))];
  const groups = tagSet.map((t) => ({ id: t, kind: 'tag', members: strips.filter((s) => s.tags.includes(t)).map((s) => s.id),
    sends: (g.selections || []).filter((s) => selTags(s.selector).includes(t)).flatMap((s) => (s.ops || []).filter((o) => o.op === 'send').map((o) => ({ bus: txt(o.args[0]), amount: num(o.args[1]), selector: s.selector, line: s.line }))) }));
  const dangling = [...new Set(strips.flatMap((s) => s.sends.filter((x) => !x.to).map((x) => x.bus)))]; // a send to a bus nobody returns
  return { version: MIXER_VERSION, channels: strips, groups, master: { id: 'master', kind: 'master', inputs: strips.map((s) => s.id) }, dangling };
}
// one line per strip, for logs and tests
export const describe = (m) => m.channels.map((c) => `${c.kind === 'return' ? 'ret ' : ''}${c.id}${c.orbit != null ? ' @' + c.orbit : ''}${c.tags.length ? ' [' + c.tags.join(',') + ']' : ''}${c.sends.map((s) => ` -> ${s.bus}${s.amount != null ? ':' + s.amount : ''}`).join('')}${c.inputs ? ' <- ' + c.inputs.join(',') : ''}`).join('\n');
