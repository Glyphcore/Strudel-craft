// Lanes L4 (#77), graph data boxes: one minimal behavioural check each. Run: node tests/site/lanes_data.mjs  (no Strudel runtime, no browser: pure data)
// Boxes whose syntax needs the audio layer (#75) or capture (#76) at RUNTIME are checked here on the data side only (parse -> model -> graph -> applyOp from the
// documented syntax); the runtime half is the job of tests/lanes/l2.mjs / the capture issue and is not claimed here.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parse, generate, applyOp, graph, checkWire } from '../../site/model.js';

const pass = (m) => console.log('PASS ' + m);
const fx = (n) => fs.readFileSync(new URL(`../lanes/fixtures/l4_${n}.strudel.js`, import.meta.url), 'utf8');
const audioWires = (g) => g.wires.filter((w) => w.type === 'audio');

// Graph data: example 5 (tags, one bus node with two sends in and one return out, one chip per tagged statement, no per-match wires)
{
  const m = parse(fx('ex5')), g = graph(m), by = (id) => g.nodes.find((n) => n.id === id);
  assert.deepEqual(['drums', 'snare', 'keys'].map((n) => by(`track:${n}`).tags), [['drums'], ['drums', 'wet'], ['harm', 'wet']]);
  for (const n of g.nodes.filter((x) => x.kind === 'track')) assert.deepEqual(n.ports.out, [{ name: 'audio', type: 'audio' }], 'lane card has the audio output port');
  const buses = g.nodes.filter((n) => n.kind === 'bus'); assert.equal(buses.length, 1); assert.equal(buses[0].name, 'verb');
  const into = audioWires(g).filter((w) => w.to.node === 'bus:verb'), out = audioWires(g).filter((w) => w.from.node === 'bus:verb');
  assert.equal(into.length, 2); assert.deepEqual(into.map((w) => w.from.node).sort(), ['track:keys', 'track:snare']); assert.equal(out.length, 1); assert.equal(out[0].to.node, 'track:verb');
  const chips = g.nodes.filter((n) => n.kind === 'selection'); assert.equal(chips.length, 2, 'one chip per tagged(...) statement');
  assert.deepEqual(chips.map((c) => [c.selector, c.matches]), [['wet', ['snare', 'keys']], ['drums', ['drums', 'snare']]]);
  assert.equal(g.wires.filter((w) => chips.some((c) => w.from.node === c.id || w.to.node === c.id)).length, 0, 'no per-match wires');
  assert.deepEqual(m.buses, { verb: { returns: ['verb'] } });
  pass(`Graph data: example 5 gives ${g.nodes.filter((n) => n.kind === 'track').length} lane cards with tags, bus "verb" with ${into.length} sends in and ${out.length} return out, ${chips.length} selection chips listing ${chips.map((c) => c.matches.length).join(' and ')} matches, 0 per-match wires`);
}

// (L2) Split fan: example 1 (data side)
{
  const m = parse(fx('ex1')), g = graph(m);
  assert.equal(g.nodes.filter((n) => n.kind === 'track').length, 1);
  const branches = g.nodes.filter((n) => n.kind === 'branch'); assert.equal(branches.length, 3);
  assert.deepEqual(branches.map((b) => b.steps), [0, 3, 3]);
  assert.equal(audioWires(g).filter((w) => w.to.node === 'split:drums').length, 1, 'one audio wire feeds the fan');
  assert.equal(g.nodes.filter((n) => n.kind === 'join').length, 1);
  // a wire from inside a branch to another lane is refused (example 6), with both fixes as applyOp operations that change one statement each
  const m6 = parse(fx('ex6')), g6 = graph(m6); assert.equal(g6.refused.length, 1);
  const r = g6.refused[0]; assert.equal(r.code, 'E_LANE_CROSS'); assert.match(r.message, /^E_LANE_CROSS: .*"inner".*lane "a".*lane "b"/);
  assert.deepEqual(r.fixes.map((f) => f.label), ['Export tap', 'Add send']);
  assert.equal(g6.wires.some((w) => w.from.node === 'tap:inner' && w.to.node.startsWith('track:b')), false, 'no wire is drawn');
  const lines = (c) => c.split('\n'), changed = (a, b) => lines(a).map((l, i) => l !== lines(b)[i]).filter(Boolean).length;
  const src6 = fx('ex6'), outs = r.fixes.map((f) => generate(applyOp(m6, f.op)));
  assert.equal(outs[0], 'a: s("bd*4").tap("inner", { export: true }).split(x => x.tap("inner").lpf(500))\nb: s("hh*8").gain(tap("inner:env"))\n');
  assert.equal(outs[1], 'a: s("bd*4").split(x => x.tap("inner").lpf(500)).send("a")\nb: s("hh*8").gain(tap("inner:env"))\n');
  outs.forEach((o) => assert.equal(changed(src6, o), 1, 'one statement changes'));
  // the same check for a wire the UI proposes
  const c = checkWire(m6, 'tap:inner', 'track:b#0'); assert.equal(c.ok, false); assert.equal(c.code, 'E_LANE_CROSS'); assert.deepEqual(c.fixes.map((f) => f.label), ['Export tap', 'Add send']);
  const gf = graph(parse(outs[0])); assert.equal(gf.refused, undefined, 'after Export tap no refusal remains (#82)'); assert.ok(gf.wires.some((w) => w.from.node === 'tap:inner' && w.to.node.startsWith('track:b')), 'the wire tap:inner -> b is drawn after Export tap'); assert.equal(checkWire(parse(outs[0]), 'tap:inner', 'track:b#0').ok, true);
  assert.equal(checkWire(m6, 'tap:inner', 'track:a#0').ok, true, 'inside its own lane the wire is fine');
  pass(`Split fan (data side; runtime waits on #75): example 1 = 1 lane card, ${branches.length} branch sub-chains (${branches.map((b) => b.steps).join('/')} steps), 1 audio wire into the fan; example 6 refused ${r.code} with fixes ${r.fixes.map((f) => f.label).join(' / ')}, each a one-statement applyOp change`);
}

// (L3) Capture node: example 7 (data side)
{
  const m = parse(fx('ex7')), g = graph(m), cap = g.nodes.find((n) => n.id === 'capture:groove');
  assert.deepEqual(cap.ports.out.map((p) => p.name), ['ev', 'audio', 'level']); assert.deepEqual(cap.matches, ['drums']); assert.equal(m.settings.lanes, 'closed');
  const w = (to) => g.wires.filter((x) => x.from.node === 'capture:groove' && x.to.node === to).map((x) => `${x.from.port}:${x.type}`);
  assert.deepEqual(w('track:chop'), ['audio:audio']); assert.deepEqual(w('track:bass'), ['level:signal']);
  const tapCap = parse('capture("kx", "drums/kick", { window: "1b..5b" })\n'); assert.deepEqual(graph({ ...tapCap, tracks: [{ name: 'drums', source: ['s', 'bd'], chain: [], tags: [] }] }).nodes.find((n) => n.id === 'capture:kx').ports.out.map((p) => p.name), ['ev'], 'an event tap records events only');
  pass(`Capture node (data side; runtime waits on the capture issue): example 7 gives capture:groove with ports ${cap.ports.out.map((p) => p.name).join(', ')}, wires to chop (audio) and bass (level); a tap picker has only ev`);
}
console.log('lanes L4 graph data done');
