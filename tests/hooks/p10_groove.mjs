// Groove (.groove, groove-* presets; docs/HOOKS_SYNTAX.md 4.2c, docs/CONVENTIONS.md 4): one behavioural check per box. `node tests/hooks/p10_groove.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, haps, cli, sha, tmp, pass } from './harness.mjs';
const { hooks, g } = await boot();
const fresh = () => { hooks.reset(); hooks.live = false; hooks.horizon = undefined; };
const note = (x) => g.note(g.mini(x)).s('triangle');
const on = (p, a, b) => haps(p, a, b).filter((h) => h.b >= a && h.b < b && h.b === h.pb);
const near = (x, y, e = 1e-9) => Math.abs(x - y) <= e;

// swing: MPC percent on the step grid, a monotone map (order kept, durations close up)
{ fresh(); const h = on(note('c3*8').groove(66.7, 0, 0, 0, 0, 0, 8), 0, 1); assert.equal(h.length, 8);
  assert.ok(near(h[1].b, 0.125 + (2 * 0.667 - 1) / 8, 1e-4), String(h[1].b)); assert.ok(near(h[2].b, 0.25)); assert.ok(near(h[0].e, h[1].b, 1e-4));
  for (let i = 1; i < h.length; i++) assert.ok(h[i].b > h[i - 1].b); pass('swing 66.7 on grid 8 puts every second 8th on the triplet (0.1667), downbeats stay, order kept'); }
{ fresh(); const a = on(note('c3*16').groove({ swing: 50 }), 0, 1); const b = on(note('c3*16'), 0, 1); assert.deepEqual(a.map((x) => x.b), b.map((x) => x.b)); pass('all defaults = identity'); }
// push: tempo-free percent of a 16th
{ fresh(); const h = on(note('c3*4').groove({ push: 10 }), 0, 1); assert.ok(near(h[0].b, 0.1 / 16, 1e-4)); const r = on(note('c3*4').groove({ push: -10 }), 0.5, 1.5); assert.ok(near(r[0].b, 0.75 - 0.1 / 16, 1e-4)); pass('push +10 drags 1/160 cycle, -10 rushes the same'); }
// jitter / vel bounds and seeds
{ fresh(); const p = note('c3*16').groove({ jitter: 8, vel: 0.3, seed: 4 }); const h = on(p, -1, 9).filter((x) => Math.round(x.b * 16) >= 0 && Math.round(x.b * 16) < 128); assert.equal(h.length, 128);
  const offs = h.map((x) => x.b - Math.round(x.b * 16) / 16); assert.ok(offs.every((o) => Math.abs(o) <= 0.08 / 16 + 1e-6)); assert.ok(new Set(offs.map((o) => o.toFixed(6))).size > 50, "distinct offsets");
  const vs = h.map((x) => x.v.velocity); assert.ok(vs.every((v) => v <= 1 && v > 0.7 - 1e-9)); pass(`jitter 8 stays within +-0.5 % of a cycle (max ${Math.max(...offs.map(Math.abs)).toFixed(5)}), velocity in (0.7, 1]`);
  const s5 = on(note('c3*16').groove({ jitter: 8, seed: 5 }), 0, 1).map((x) => x.b); assert.notDeepEqual(s5, h.slice(0, 16).map((x) => x.b)); pass('another seed gives another stream'); }
// determinism: query-span independent (chunked = whole), repeatable
{ fresh(); const p = note('c3*16 e3*3').groove({ swing: 58, push: 6, jitter: 6, vel: 0.2, drift: 8, seed: 9 }); const whole = haps(p, 0, 8).filter((h) => h.b === h.pb).map((h) => `${h.b}:${h.e}:${h.v.velocity}`);
  const parts = []; for (let a = 0; a < 8; a += 0.37) for (const h of haps(p, a, Math.min(8, a + 0.37))) if (h.b === h.pb) parts.push(`${h.b}:${h.e}:${h.v.velocity}`);
  const inWin = (s) => +s.split(':')[0] >= 0 && +s.split(':')[0] < 8; assert.deepEqual(parts.filter(inWin).sort(), whole.filter(inWin).sort()); pass(`same onsets, ends and velocities whether queried whole or in 0.37-cycle chunks (${whole.length} haps)`); }
// presets are stdlib hook defs, seed as first param
{ fresh(); const a = on(note('c3*16').hook('groove-pocket(1)'), 0, 1).map((x) => x.b), b = on(note('c3*16').hook('groove-pocket(2)'), 0, 1).map((x) => x.b); assert.notDeepEqual(a, b);
  assert.ok(near(on(note('c3*16').hook('groove-swing(75)'), 0, 1)[1].b, 1.5 / 16, 1e-4)); assert.ok(!/groove-/.test(hooks.toJSON())); pass('groove-pocket(1) vs (2) differ; groove-swing(75) puts the 2nd 16th at 1.5/16; presets are not serialised'); }
{ fresh(); assert.throws(() => note('c3').groove({ swang: 3 }), (e) => e.code === 'E_BAD_ARG'); pass('unknown param -> E_BAD_ARG'); }
// headless render twice -> identical mix
{ const d = tmp('groove-'); const f = path.join(d, 'g.strudel.js'); fs.writeFileSync(f, 'setcpm(90/4)\n$: note("c3*16").s("triangle").decay(0.08).sustain(0).hpf(80).lpf(4000).gain(0.4).hook("groove-lazy(3)")\n');
  const r1 = cli(['render', f, path.join(d, 'a'), '--bars', '2']); const r2 = cli(['render', f, path.join(d, 'b'), '--bars', '2']); assert.equal(r1.status, 0, r1.stderr); assert.equal(r2.status, 0, r2.stderr);
  assert.equal(sha(path.join(d, 'a/mix.wav')), sha(path.join(d, 'b/mix.wav'))); pass('CLI render twice with groove-lazy(3): identical mix.wav'); }
