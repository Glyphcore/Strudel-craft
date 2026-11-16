// Lowering: the authored Craft form of a program -> the plain Strudel form (what strudel.cc needs), generated, never hand-kept.
// docs/LOWERING.md. Used by tools/concepts/build.mjs (catalog recipes) and tools/lowering/build.mjs (Syntax examples).
//
//   atoms (atom(), atoms.import(), atoms.ns.name)   -> inlined by the atoms compiler (site/engine/atoms.js, the same pass as Copy / strudel.cc)
//   .hook("rack | groove(1)")  hygiene / rack / groove hooks -> the chain steps written out (.lpf(..).decay(..), .swingBy(..).late(..))
//   .groove({ swing: 58 })                          -> .swingBy / .late / .mul(velocity(rand...)) (lowerGroove)
// What cannot be written as plain Strudel (needs the Craft runtime at play time) is classified with a reason, never silently dropped:
//   hooks.bind / .use slots and gates, .tap / .wire, lanes (.tags, tagged, .split, .send, ret), ctl / slider controls, word() / vox banks.
// verify(): the lowered form must give the same events as the Craft form on the first cycles (CLI `strudel events`); drift is reported.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process'; import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
export const CLI = process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli';
export const hasCli = () => fs.existsSync(path.join(CLI, 'strudel'));
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/* ---------- classification ---------- */
// first match wins; each says why plain Strudel cannot hold it
export const BLOCKERS = [
  [/\.(?:tap|wire)\s*\(|\btap\s*\(/, 'taps', 'taps and wires read another lane live (the Craft runtime); plain Strudel cannot read another pattern as a control'],
  [/\.(?:tags|split|merge|send)\s*\(|\btagged\s*\(|\bret\b\s*[:(.]/, 'lanes', 'lanes (tags, selections, buses, sends) are compiled by the Craft lane engine to audio buses; strudel.cc has no lanes'],
  [/\b(?:ctl|slider)\s*\(|\bcontrols\.|\bhooks\.map\s*\(/, 'controls', 'controls (ctl, slider, hooks.map) are bound to knobs, faders and automation by the Craft runtime; a plain pattern has no live control'],
  [/\b(?:word|syl)\s*\(|\bvoxBank\s*\(|\bvox\s*\(/, 'prelude', 'word() and vox banks come from the Craft prelude (sample banks the site loads); strudel.cc does not have them'],
  [/\bstrudelCraft\s*\.|\bperf\s*\(|\bvisual\w*\s*\(|\bpads?\./, 'runtime', 'this calls the Craft site API (strudelCraft.*, perform, visuals); it runs inside this site only and has no plain Strudel form'],
  [/\bhooks\.inst\s*\(|lib:/, 'library', 'this instances or binds a component from the browser library (hooks.inst, lib:); only the Craft runtime can read the library'],
];
const strip = (code) => code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const SUGAR = [/\batoms?\b/, /\.hook\s*\(/, /\.groove\s*\(/, /\bhooks\.\w+\s*\(/, /\.use\s*\(/];
export function classify(code) {
  const c = strip(code);
  for (const [re, kind, why] of BLOCKERS) if (re.test(c)) return { state: 'runtime', kind, why };
  return SUGAR.some((re) => re.test(c)) ? { state: 'sugar' } : { state: 'plain' };
}

/* ---------- the lowering engine (racks, hygiene, grooves) ---------- */
export async function createLowering({ defs = {}, die = (m) => { throw new Error(m); } } = {}) {
  const A = await imp('site/engine/atoms.js'); const AC = await imp('site/engine/atoms-consumers.js'); const { HYGIENE } = await imp('site/engine/hygiene.js'); const G = await imp('site/engine/groove.js');
  A.loadTypes(fs.readFileSync(path.join(ROOT, 'site/data/atoms/types.json'), 'utf8'));
  const phonk = {}; const imports = {};
  const PH = path.join(ROOT, 'site/data/phonk');
  for (const f of fs.readdirSync(PH).filter((x) => x.endsWith('.json'))) {
    let d; try { d = rd(path.join(PH, f)); } catch (e) { continue; }
    if (d.defs && d.model) Object.assign(phonk, d.defs);
    if (d.format === 'atoms@1') { const id = f.replace(/\.json$/, ''); imports['pack:glyphcore/phonk:' + id] = AC.importedAtoms({ data: d, id: 'glyphcore/phonk:' + id, format: 'atoms@1', kind: 'atoms' }); }
  }
  const ALL = { ...HYGIENE, ...G.GROOVES, ...phonk, ...defs };
  const parseExpr = (e) => e.split('|').map((t) => t.trim()).filter(Boolean).map((t) => { const m = /^([\w-]+)(?:\((.*)\))?$/.exec(t); if (!m) die(`bad hook expression "${e}"`); return { name: m[1], args: m[2] ? m[2].split(',').map((x) => Number(x.trim())) : [] }; });
  function expand(expr, local = {}) { // hook expression -> plain chain steps with params substituted; `local` = defs the program itself declares (they win)
    const out = []; const ALL_ = local === ALL ? ALL : { ...ALL, ...local };
    for (const t of parseExpr(expr)) {
      const def = ALL_[t.name]; if (!def) die(`unknown rack or hook "${t.name}"`); if (!def.chain) die(`"${t.name}" is not chain-only`);
      const names = Object.keys(def.params || {}); const vals = Object.fromEntries(names.map((k, i) => [k, t.args[i] ?? def.params[k].default]));
      const sub = (x) => Array.isArray(x) ? x.map(sub) : x && typeof x === 'object' ? ('$param' in x ? vals[x.$param] : '$expr' in x ? Function(...names, `return (${x.$expr.replace(/[^\w\s.+\-*/()]/g, '')})`)(...names.map((k) => vals[k])) : '$mini' in x ? { $mini: x.$mini } : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sub(v)]))) : x;
      for (const [m, ...a] of def.chain) { if (m === 'hook') out.push(...expand(a[0], local)); else out.push([m, ...a.map(sub)]); }
    }
    return out;
  }
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  function lowerGroove(obj) { // the plain-Strudel version of one .groove(...) step (opens on strudel.cc)
    const o = G.normalise([obj]); let s = ''; const seed = (k) => (o.seed || k ? `.late(${r6(o.seed + k)})` : '');
    if (o.swing !== 50) s += `.swingBy(${r6(2 * o.swing / 100 - 1)}, ${o.grid / 2})`;
    if (o.vel) s += `.mul(velocity(rand${seed(0.37)}.range(${r6(1 - o.vel)}, 1)))`;
    const J = o.jitter / 1600, D = o.drift / 1600, off = o.push / 1600 - J - D;
    if (o.jitter) s += `.late(rand${seed(0)}.range(0, ${r6(2 * J)}).segment(16))`;
    if (o.drift) s += `.late(perlin${seed(0)}.range(0, ${r6(2 * D)}).slow(4).segment(16))`;
    if (off > 1e-9) s += `.late(${r6(off)})`; else if (off < -1e-9) s += `.early(${r6(-off)})`;
    return s;
  }
  const fmt = (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? JSON.stringify(v) : v && v.$mini !== undefined ? JSON.stringify(v.$mini) : JSON.stringify(v));
  function plain(steps, where) {
    return steps.map(([m, ...a]) => { if (m === 'groove') return lowerGroove(a[0]); if (m === 'wire') die(`${where}: a wire step cannot be lowered to plain Strudel`); return `.${m}(${a.map(fmt).join(', ')})`; }).join('');
  }
  const atomsPlain = (code) => { const env = A.buildEnv(code, { imports }); return A.compile(code, env).code; };
  // ---- static hooks: hooks.def / hooks.bind (no gate) / .use("slot") written out as the chain steps they stand for ----
  // end index (exclusive) of the call whose "(" is at `open`; strings and escapes are skipped
  const callEnd = (s, open) => { let d = 0, q = null; for (let i = open; i < s.length; i++) { const c = s[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; } if (c === '"' || c === "'" || c === '`') q = c; else if (c === '(') d++; else if (c === ')' && --d === 0) return i + 1; } return -1; };
  const argsOf = (text) => Function(`return [${text}]`)();
  class Runtime extends Error {}
  const rt = (why) => { throw new Runtime(why); };
  function staticHooks(code) { // -> code without the hooks.* statements and without .use() (steps inlined); throws Runtime(why) when a binding is live
    const local = {}; const binds = {}; let out = ''; let i = 0; const re = /\bhooks\.(\w+)\s*\(/g; let m;
    while ((m = re.exec(code))) {
      const open = m.index + m[0].length - 1, end = callEnd(code, open); if (end < 0) rt('a hooks call could not be read');
      const fn = m[1]; let args; try { args = argsOf(code.slice(open + 1, end - 1)); } catch (e) { rt(`hooks.${fn}() has an argument that is not plain data`); }
      if (fn === 'def') { const [name, spec] = args; if (typeof name !== 'string' || !spec || !Array.isArray(spec.chain) || Object.keys(spec).some((k) => !['chain', 'params'].includes(k))) rt(`the hook "${name}" is a function, a module with taps or an apply step, which only the Craft runtime can run`); local[name] = spec; }
      else if (fn === 'bind') { const [slot, spec, gate, opts] = args; if (gate !== undefined) rt('the binding is gated (it opens at a bar or in a range): gates are evaluated by the Craft runtime as the song plays, plain Strudel has no timeline of bindings'); if (opts) rt('the binding has options (order, priority, scope) that only the Craft runtime resolves'); (binds[slot] = binds[slot] || []).push(spec); }
      else rt(`hooks.${fn}() is a live value or registry call driven by the Craft runtime`);
      let stop = end; while (/[ \t]/.test(code[stop] || '')) stop++; if (code[stop] === ';') stop++; while (/[ \t]/.test(code[stop] || '')) stop++;
      out += code.slice(i, m.index); i = stop; re.lastIndex = stop;
    }
    out += code.slice(i);
    const stepsOf = (spec) => { if (Array.isArray(spec)) return spec; if (typeof spec === 'string') return expand(spec, local); rt('a binding with a function or an unreadable hook'); };
    out = out.replace(/\.use\s*\(\s*(["'])((?:(?!\1).)*)\1\s*(?:,\s*(\{[^{}]*\}))?\s*\)/g, (_, q, slot, o) => {
      const opts = o ? Function(`return (${o})`)() : {}; const bs = binds[slot] || [];
      if (Object.keys(opts).some((k) => !['mode', 'else', 'quant'].includes(k)) || (opts.mode && !['chain', 'swap'].includes(opts.mode))) rt(`the slot "${slot}" is used with options (stack mode, scope) that only the Craft runtime resolves`);
      if (!bs.length) { if (opts.else && opts.else !== 'bypass') rt(`the slot "${slot}" has no binding and its else is "${opts.else}", a runtime choice`); return ''; }
      return plain(opts.mode === 'swap' ? stepsOf(bs[bs.length - 1]) : bs.flatMap(stepsOf), 'slot ' + slot);
    });
    if (/\.use\s*\(|\bhooks\./.test(strip(out))) rt('a slot is used in a way that only the Craft runtime resolves');
    return { code: out.replace(/^[ \t]*\n/gm, '').replace(/\n{3,}/g, '\n\n'), local };
  }
  // the groove steps taken out of a program: the pair that is left must still give identical events; that is how a groove-only difference is told from drift
  const GROOVE_SEG = /^\s*groove[-\w]*\s*(\([^)]*\))?\s*$/;
  function stripGroove(code) {
    const dropSegs = (s) => s.split('|').filter((x) => !GROOVE_SEG.test(x)).map((x) => x.trim()).join(' | ');
    return code.replace(/\.groove\s*\(\s*\{[^{}]*\}\s*\)/g, '')
      .replace(/\.hook\s*\(\s*(["'])((?:(?!\1).)*)\1\s*\)/g, (_, q, e) => { const r = dropSegs(e); return r ? `.hook(${q}${r}${q})` : ''; })
      .replace(/(\bhooks\.bind\s*\(\s*(?:"[^"]*"|'[^']*')\s*,\s*)(["'])((?:(?!\2).)*)\2/g, (_, pre, q, e) => { const r = dropSegs(e); return r ? `${pre}${q}${r}${q}` : `${pre}[]`; });
  }
  // plain text of a whole program: atoms inlined, static hooks written out, then .hook("...") and .groove({...}) written out
  function lower(code, { noGroove = false } = {}) {
    const c = classify(code);
    if (c.state === 'plain') return { state: 'plain', lowered: null };
    if (c.state === 'runtime') return { state: 'runtime', lowered: null, kind: c.kind, why: c.why };
    const run = (kind, why) => ({ state: 'runtime', lowered: null, kind, why });
    let out = /\batoms?\b/.test(code) ? atomsPlain(code) : code; let local = {}; if (noGroove) out = stripGroove(out);
    try { ({ code: out, local } = staticHooks(out)); } catch (e) { if (e instanceof Runtime) return run('hooks', e.message); return run('hooks', /bad hook expression/.test(e.message) ? `a binding uses a decorator or library reference (${e.message.replace(/^bad hook expression /, '')}), which only the Craft runtime resolves` : `a hook here has no chain form (${e.message}); it runs in the Craft runtime only`); }
    try {
      out = out.replace(/\.hook\s*\(\s*(["'])((?:(?!\1).)*)\1\s*\)/g, (_, q, expr) => plain(expand(expr, local), 'hook'));
      out = out.replace(/\.groove\s*\(\s*(\{[^{}]*\})\s*\)/g, (_, o) => lowerGroove(Function(`return (${o})`)()));
    } catch (e) { return run('hook', `a hook in this program has no chain form (${e.message}); it runs in the Craft runtime only`); }
    if (/\.(?:hook|groove)\s*\(/.test(strip(out))) return run('hook', 'a hook or groove call here takes a computed argument; it runs in the Craft runtime only');
    if (noGroove) return { state: 'lowered', lowered: out.trim() + '\n', craft: stripGroove(/\batoms?\b/.test(code) ? atomsPlain(code) : code).trim() + '\n' };
    return out.trim() === code.trim() ? { state: 'plain', lowered: null } : { state: 'lowered', lowered: out.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'.repeat(code.endsWith('\n') ? 1 : 0) };
  }
  const noGrooveOf = (code) => { const r = lower(code, { noGroove: true }); return r.state === 'lowered' ? { craft: r.craft, lowered: r.lowered } : null; };
  return { A, AC, G, ALL, imports, expand, plain, lowerGroove, fmt, lower, atomsPlain, noGrooveOf };
}

/* ---------- hap equality (CLI `strudel events`) ---------- */
const round = (v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v);
const norm = (events) => events.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'layer').map(([k, v]) => [k, round(v)])));
let hooksFile = null;
function ensureHooks(defs) {
  if (hooksFile) return hooksFile; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lowering-')); hooksFile = path.join(d, 'hooks.json');
  fs.writeFileSync(hooksFile, JSON.stringify({ model: 1, defs })); return hooksFile;
}
// a lock without the shim pack (its pin goes stale whenever catalog.json / syntax.json change, which is what this tool writes): content packs only
let lockFile = null;
function ensureLock() {
  if (lockFile) return lockFile; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lowering-')); lockFile = path.join(d, 'packs.lock.json');
  const lock = rd(path.join(ROOT, 'site/packs.lock.json')); lock.packs = lock.packs.filter((p) => p.id !== 'glyphcore/shim').map((p) => (p.source.startsWith('file:') ? { ...p, source: 'file:' + path.resolve(ROOT, 'site', p.source.slice(5)) } : p));
  fs.writeFileSync(lockFile, JSON.stringify(lock)); return lockFile;
}
function events(code, { defs, cycles }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lowering-')); const f = path.join(d, 'in.strudel.js'); fs.writeFileSync(f, code);
  const args = ['events', f, '--cycles', String(cycles), '--hooks', ensureHooks(defs), '--packs', ensureLock(), '--prelude', path.join(ROOT, 'docs/tracks/night-phonk-demo/cli-site-base.js'), '--prelude', path.join(ROOT, 'site/prelude/word.js')];
  const p = spawnSync(path.join(CLI, 'strudel'), args, { encoding: 'utf8', env: { ...process.env, STRUDEL_CRAFT: ROOT }, maxBuffer: 1 << 28, timeout: 120000 });
  fs.rmSync(d, { recursive: true, force: true });
  if (p.status !== 0) return { error: ((p.stderr || '') + (p.stdout || '')).trim().split('\n').filter(Boolean).pop() || `exit ${p.status}` };
  try { return { events: JSON.parse(p.stdout).events }; } catch (e) { return { error: 'events output is not JSON' }; }
}
// -> { equal, cycles, events } | { equal: false, cycles, reason }
export function verify(craft, lowered, { defs, cycles = 4 } = {}) {
  const a = events(craft, { defs, cycles }), b = events(lowered, { defs, cycles });
  if (a.error || b.error) return { equal: false, cycles, reason: a.error ? 'Craft form: ' + a.error : 'Strudel form: ' + b.error };
  const A = norm(a.events), B = norm(b.events);
  if (A.length !== B.length) return { equal: false, cycles, reason: `event count differs (${A.length} Craft, ${B.length} Strudel)` };
  for (let i = 0; i < A.length; i++) if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) return { equal: false, cycles, reason: `event ${i} differs: ${JSON.stringify(A[i])} vs ${JSON.stringify(B[i])}`.slice(0, 300) };
  return { equal: true, cycles, events: A.length };
}
