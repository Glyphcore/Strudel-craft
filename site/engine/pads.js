// Pad engine (BLUEPRINT 9): banks, modes, quantise, choke, scenes, looper, bounce. No DOM, no audio.
import { quantise, parseLength, toFrac, fromFrac } from './time.js';

const EPS = 1e-9;
const OPS = { component: ['open', 'close'], hook: ['bind', 'unbind'], var: ['let', 'unlet'], tap: ['tap', 'tap-end'], action: ['action', null], scene: ['scene', null] };

export function padDefaults(pad) {
  const kind = pad.target.kind;
  const mode = pad.mode || (kind === 'tap' ? 'gate' : 'toggle');
  const quant = pad.quant ?? (kind === 'tap' ? 'none' : 'bar');
  return { mode, quant, offQuant: pad.offQuant ?? quant, velocity: pad.velocity ?? 0.8, length: pad.length };
}

export function createPads({ banks = [], settings = {}, model = {} } = {}) {
  const t = { bpb: model.settings?.bpb ?? model.bpb ?? 4, cpb: model.settings?.cpb ?? model.cpb ?? 1, cps: model.settings?.cps ?? model.cps };
  let intents = [], seq = 0, bankIx = 0;
  const bankOf = (id) => banks.find(b => b.id === id);
  const parse = (addr) => { // "bank/r,c" or "r,c" (active bank)
    const [b, rc] = addr.includes('/') ? addr.split('/') : [banks[bankIx]?.id, addr];
    const [r, c] = rc.split(',').map(Number); const bank = bankOf(b);
    if (!bank) throw new Error('E_BAD_ARG: no bank ' + b);
    return { bank, r, c, addr: `${b}/${r},${c}`, pad: (bank.pads || []).find(p => p.pos === `${r},${c}`) };
  };
  const order = (addr) => { const p = parse(addr); return [banks.indexOf(p.bank), p.r, p.c]; };
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const q = (c, qq) => quantise(c, qq, t);
  const lenOf = (pad) => parseLength(pad.length ?? '1b', t);

  function press(addr, cycle, velocity) {
    const p = parse(addr); if (!p.pad) return;
    const d = padDefaults(p.pad), kind = p.pad.target.kind;
    const vel = p.pad.velocity === 'input' ? (velocity ?? 0.8) : (typeof p.pad.velocity === 'number' ? p.pad.velocity : 0.8);
    if (kind === 'scene') { const n = Number(p.pad.target.ref.replace('scene:', '')); return launchScene(p.bank.id, n, cycle); }
    if (kind === 'action') { intents.push({ cycle: q(cycle, 'none'), type: 'act', addr: p.addr, seq: seq++ }); return; }
    const base = { addr: p.addr, velocity: vel, seq: seq++ };
    if (d.mode === 'toggle') intents.push({ ...base, type: 'toggle', cycle: q(cycle, d.quant), offCycle: q(cycle, d.offQuant) });
    else intents.push({ ...base, type: 'on', cycle: q(cycle, d.quant), rebase: d.mode === 'retrigger' });
  }
  function release(addr, cycle) {
    const p = parse(addr); if (!p.pad) return;
    const d = padDefaults(p.pad);
    if (d.mode === 'gate') intents.push({ addr: p.addr, type: 'off', cycle: q(cycle, d.offQuant), seq: seq++, user: true });
  }
  function launchScene(bankId, n, cycle) {
    const bank = bankOf(bankId);
    intents.push({ type: 'scene', bank: bankId, n, cycle: q(cycle, bank.sceneQuant ?? 'bar'), seq: seq++ });
  }
  function action(name, cycle) { intents.push({ cycle: q(cycle, 'none'), type: 'act', action: name, seq: seq++ }); }

  const chokeKeys = (addr) => {
    const { bank, pad, r, c } = parse(addr); const ks = [];
    if (pad?.choke != null) ks.push('g' + pad.choke);
    if (bank.scenes === 'row') ks.push(`col:${bank.id}:${c}`); if (bank.scenes === 'col') ks.push(`row:${bank.id}:${r}`);
    return ks;
  };

  // Resolve all intents into a journal: [{cycle, op, pad, target, args, rebase?, choke?}], deterministic for any press order.
  function resolve() {
    const active = new Map(); // addr -> {epoch}
    let pending = intents.map(i => ({ ...i })), epoch = 0; const out = [];
    const emit = (cycle, on, addr, extra = {}) => {
      const { pad } = parse(addr), kind = pad.target.kind, ref = pad.target.ref;
      const args = { ...(pad.args || {}) };
      if (kind === 'hook') Object.assign(args, { slot: pad.target.slot, hook: ref });
      if (kind === 'var') Object.assign(args, { name: ref, ...(on ? { value: pad.target.value } : {}) });
      if (kind === 'component') args.instance = ref;
      if (kind === 'tap') { args.name = ref; if (on) args.velocity = extra.velocity; }
      out.push({ cycle: toFrac(cycle), op: OPS[kind][on ? 0 : 1], pad: addr, target: { kind, ref, ...(pad.target.slot ? { slot: pad.target.slot } : {}) }, args, ...(extra.rebase ? { rebase: true } : {}), ...(extra.choke ? { choke: true } : {}) });
    };
    const turnOff = (c, addr, extra) => { if (!active.has(addr)) return; active.delete(addr); emit(c, false, addr, extra); };
    while (pending.length) {
      const c = Math.min(...pending.map(i => i.cycle));
      const grp = pending.filter(i => Math.abs(i.cycle - c) < EPS); pending = pending.filter(i => !grp.includes(i));
      const startActive = new Set(active.keys());
      const offs = [], ons = [], sceneKeys = new Map();
      const byPad = new Map();
      for (const i of grp.sort((a, b) => a.seq - b.seq)) {
        if (i.type === 'off') { if (i.epoch != null && active.get(i.addr)?.epoch !== i.epoch) continue; offs.push(i.addr); }
        else if (i.type === 'on') ons.push(i);
        else if (i.type === 'toggle') byPad.set(i.addr, [...(byPad.get(i.addr) || []), i]);
        else if (i.type === 'scene') {
          const bank = bankOf(i.bank); const row = (bank.pads || []).filter(p => { const [r, cc] = p.pos.split(',').map(Number); return (bank.scenes === 'col' ? cc : r) === i.n; });
          const lanes = new Set(row.map(p => p.pos.split(',').map(Number)[bank.scenes === 'col' ? 0 : 1]));
          const ix = bank.scenes === 'col' ? 0 : 1;
          for (const a of active.keys()) { const pp = parse(a); if (pp.bank.id !== bank.id) continue; const lane = [pp.r, pp.c][ix], sc = [pp.r, pp.c][1 - ix];
            if (sc !== i.n && (lanes.has(lane) || bank.sceneStopsEmpty)) offs.push(a); }
          for (const p of row) ons.push({ addr: `${bank.id}/${p.pos}`, type: 'on', velocity: padDefaults(p).velocity, scene: true, seq: i.seq });
        } else if (i.type === 'act') out.push({ cycle: toFrac(c), op: 'action', pad: i.addr || null, target: { kind: 'action', ref: i.action || parse(i.addr).pad.target.ref }, args: {} });
      }
      for (const [addr, list] of byPad) { if (list.length % 2 === 0) continue; // parity of toggles in one window
        const i = list[0];
        if (startActive.has(addr)) { if (i.offCycle <= c + EPS) offs.push(addr); else pending.push({ addr, type: 'off', cycle: i.offCycle, seq: i.seq, epoch: active.get(addr).epoch }); }
        else ons.push({ addr, type: 'on', velocity: i.velocity, seq: i.seq }); }
      offs.sort((a, b) => cmp(order(a), order(b))); ons.sort((a, b) => cmp(order(a.addr), order(b.addr)) || a.seq - b.seq);
      // within one choke key at one cycle only the last on in pad order survives (order independent)
      const survive = ons.filter((o, ix) => !ons.some((p, jx) => jx > ix && p.addr !== o.addr && chokeKeys(o.addr).some(k => chokeKeys(p.addr).includes(k))));
      const uniq = []; for (const o of survive) { const e = uniq.find(u => u.addr === o.addr); if (e) Object.assign(e, o); else uniq.push({ ...o }); }
      for (const a of offs) turnOff(c, a);
      for (const o of uniq) for (const a of [...active.keys()]) if (a !== o.addr && chokeKeys(o.addr).some(k => chokeKeys(a).includes(k))) turnOff(c, a, { choke: true });
      for (const o of uniq) {
        const { pad } = parse(o.addr), d = padDefaults(pad);
        const was = active.has(o.addr);
        if (was && !(o.rebase || d.mode === 'retrigger')) continue;
        const ep = ++epoch; active.set(o.addr, { epoch: ep });
        emit(c, true, o.addr, { velocity: o.velocity, rebase: was });
        if (d.mode === 'oneshot' || (d.mode === 'retrigger' && d.length != null) || (o.scene && d.mode === 'oneshot'))
          pending.push({ addr: o.addr, type: 'off', cycle: c + lenOf(pad), seq: o.seq, epoch: ep });
      }
    }
    out.sort((a, b) => fromFrac(a.cycle) - fromFrac(b.cycle)); // stable: offs/chokes were pushed before ons per cycle
    return out;
  }

  return { press, release, launchScene, action, resolve, reset() { intents = []; seq = 0; },
    setBank(i) { bankIx = i; }, bank: () => banks[bankIx]?.id, banks: () => banks, settings: () => settings,
    nextBank(d = 1) { bankIx = (bankIx + d + banks.length) % banks.length; } };
}

// ---- journal readers (no sound: pads only publish) ----
export function windows(journal, pad) { // [[on, off|null]] in cycles, rebase closes the previous window
  const w = []; let open = null;
  for (const e of journal) { if (e.pad !== pad) continue; const c = fromFrac(e.cycle);
    if (e.op === 'bind' || e.op === 'let' || e.op === 'open' || e.op === 'tap') { if (open != null) w.push([open, c]); open = c; }
    else if (['unbind', 'unlet', 'close', 'tap-end'].includes(e.op)) { if (open != null) w.push([open, c]); open = null; } }
  if (open != null) w.push([open, null]); return w;
}
export function activeAt(journal, cycle, kind) {
  const pads = [...new Set(journal.map(e => e.pad).filter(Boolean))];
  return journal.length ? pads.filter(p => windows(journal, p).some(([a, b]) => a <= cycle + EPS && (b == null || cycle < b - EPS))
    && (!kind || journal.find(e => e.pad === p).target.kind === kind)).map(p => journal.find(e => e.pad === p)) : [];
}
export function varAt(journal, name, base, cycle) { // latest active assignment wins; previous value returns after
  const act = activeAt(journal, cycle, 'var').filter(e => e.args.name === name).map(e => ({ e, on: windows(journal, e.pad).find(([a, b]) => a <= cycle && (b == null || cycle < b))[0] }));
  if (!act.length) return base; act.sort((a, b) => a.on - b.on); return act[act.length - 1].e.args.value ?? base;
}
export function tapEvents(journal, name) {
  const evs = []; for (const pad of new Set(journal.filter(e => e.op === 'tap' && e.args.name === name).map(e => e.pad))) {
    const ons = journal.filter(e => e.pad === pad && e.op === 'tap'); const ws = windows(journal, pad);
    ons.forEach((e, i) => evs.push({ begin: fromFrac(e.cycle), end: ws[i]?.[1] ?? null, value: { velocity: e.args.velocity } })); }
  return evs.sort((a, b) => a.begin - b.begin);
}

// ---- looper ----
export function createLooper({ length = 4, origin = 0 } = {}) {
  const perf = { length: toFrac(length), origin: toFrac(origin), layers: [] };
  const L = () => fromFrac(perf.length), O = () => fromFrac(perf.origin);
  const capture = (journal) => ({ events: journal.filter(e => e.pad && ['bind', 'unbind', 'let', 'unlet', 'open', 'close', 'tap', 'tap-end'].includes(e.op)).map(e => ({ c: fromFrac(e.cycle), e }))
    .filter(({ c }) => c >= O() - EPS && c < O() + L() - EPS)
    .map(({ c, e }) => ({ t: toFrac(c - O()), pad: e.pad, type: ['bind', 'let', 'open', 'tap'].includes(e.op) ? 'on' : 'off', ...(e.args.velocity != null ? { velocity: e.args.velocity } : {}) })) });
  return {
    performance: perf,
    record(journal) { perf.layers = [capture(journal)]; return perf; },        // replace
    overdub(journal) { perf.layers.push(capture(journal)); return perf; },
    undo() { perf.layers.pop(); return perf; },
    // periodic journal: entries once with the period, nothing unrolled
    periodic() { return { period: perf.length, origin: perf.origin, entries: perf.layers.flatMap(l => l.events).sort((a, b) => fromFrac(a.t) - fromFrac(b.t)) }; },
    // expansion for evaluation / tests only
    expand(untilCycle) {
      const p = this.periodic(), out = [];
      for (let k = 0; O() + k * L() < untilCycle - EPS; k++) for (const e of p.entries) { const c = O() + k * L() + fromFrac(e.t); if (c < untilCycle - EPS) out.push({ ...e, cycle: c }); }
      return out.sort((a, b) => a.cycle - b.cycle);
    },
    eventCount: () => perf.layers.reduce((n, l) => n + l.events.length, 0),
  };
}

// Pad on/off pairs of a performance -> per pad [[t_on, t_off]] (cycle fractions inside the loop).
export function performanceWindows(perf) {
  const res = {}; const open = {};
  const evs = perf.layers.flatMap(l => l.events).sort((a, b) => fromFrac(a.t) - fromFrac(b.t) || (a.type === 'off' ? -1 : 1));
  for (const e of evs) { const t = fromFrac(e.t);
    if (e.type === 'on') open[e.pad] = { t, v: e.velocity }; else if (open[e.pad]) { (res[e.pad] ||= []).push({ on: open[e.pad].t, off: t, velocity: open[e.pad].v }); delete open[e.pad]; } }
  for (const p of Object.keys(open)) (res[p] ||= []).push({ on: open[p].t, off: fromFrac(perf.length), velocity: open[p].v });
  return res;
}
// Bounce to code-data: tap pads -> {$events|$mini}, other pads -> windows+period gates.
export function bounce(perf, { tapPads = {}, grid = 16, quant = 'grid' } = {}) {
  const w = performanceWindows(perf), L = fromFrac(perf.length), out = { vars: {}, gates: {} };
  for (const [pad, ws] of Object.entries(w)) {
    if (tapPads[pad]) {
      if (quant === 'none') out.vars[tapPads[pad]] = { $events: ws.map(x => [toFrac(x.on), toFrac(x.off), { velocity: x.velocity }]), period: perf.length };
      else { const steps = grid * L, cells = Array(steps).fill('~'); ws.forEach(x => { cells[Math.round(x.on * grid) % steps] = 'x'; }); out.vars[tapPads[pad]] = { $mini: cells.join(' '), period: perf.length }; }
    } else out.gates[pad] = { windows: ws.map(x => [toFrac(x.on), toFrac(x.off)]), period: perf.length };
  }
  return out;
}
export function expandGate(gate, from, to, origin = 0) {
  const P = fromFrac(gate.period), out = [];
  for (let k = 0; origin + k * P < to; k++) for (const [a, b] of gate.windows) { const x = origin + k * P + fromFrac(a), y = origin + k * P + fromFrac(b); if (x < to) out.push([x, Math.min(y, to)]); }
  return out;
}
