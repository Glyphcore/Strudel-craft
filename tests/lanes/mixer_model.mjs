// Mixer read model (docs/REFACTOR_PLAN.md phase 1, site/engine/mixer-model.js): channel strips derived from the lane graph of the night phonk v2
// track. Pure: lanes.js compile() + mixer-model.js channels(), no Strudel, no audio.  node tests/lanes/mixer_model.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const LN = await imp('site/engine/lanes.js'); const MX = await imp('site/engine/mixer-model.js');
let fail = 0; const ok = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  got ' + JSON.stringify(got)}`); if (!cond) fail++; };
const src = fs.readFileSync(path.join(ROOT, 'docs/tracks/night-phonk-demo/track.v2.standalone.strudel.js'), 'utf8');
const graph = LN.compile(src).graph; const m = MX.channels(graph); const ch = (id) => m.channels.find((c) => c.id === id);
ok('m1 one strip per lane', m.channels.length === graph.lanes.length && m.channels.length === 23, m.channels.length);
ok('m2 returns are strips of kind return with their bus', ch('verb')?.kind === 'return' && ch('verb').bus === 'verb' && ch('glue')?.kind === 'return', [ch('verb'), ch('glue')]);
ok('m3 a tag send becomes a send on every member', ch('lead').sends.some((s) => s.bus === 'verb' && s.amount === 0.35 && s.to === 'verb') && ch('kick').sends.some((s) => s.bus === 'glue'), ch('lead')?.sends);
ok('m4 a return lists its inputs', ['pad', 'lead', 'ctr', 'bell'].every((id) => ch('verb').inputs.includes(id)) && ch('glue').inputs.includes('sub'), ch('verb')?.inputs);
ok('m5 tags are control groups with members', m.groups.find((g) => g.id === 'drums')?.members.join() === 'kick,snare,ghost,hats', m.groups.find((g) => g.id === 'drums'));
ok('m6 gated mutes land on the strips they select (gate as written: an atom ref before the atoms pass)', ch('kick').mutes.some((x) => x.op === 'mute' && x.gate === 'atoms.ph2.noDrums') && ch('sub').mutes.some((x) => x.selector === '#sub'), ch('kick')?.mutes);
ok('m7 orbits carried, no bus numbers', ch('sub').orbit === 3 && !JSON.stringify(m).includes('512'), ch('sub')?.orbit);
ok('m8 master collects every strip; no dangling sends', m.master.inputs.length === 23 && m.dangling.length === 0, m.dangling);
ok('m9 pure: same text, same model', JSON.stringify(MX.channels(LN.compile(src).graph)) === JSON.stringify(m));
const d = MX.channels(LN.compile('a: s("bd").send("nowhere", 0.5)\n').graph);
ok('m10 a send without a return is reported as dangling', d.dangling.join() === 'nowhere', d);
ok('m11 empty graph', MX.channels(null).channels.length === 0);
console.log(fail ? `mixer_model: ${fail} FAILED` : 'mixer_model: all passed'); process.exit(fail ? 1 : 0);
