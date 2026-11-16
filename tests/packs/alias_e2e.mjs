// Aliases end to end (issue #120, the critic's fixture shape): pack zed/alias with atom zz.newkick (aliases: zz.oldkick), hook def newRack (aliases: oldRack),
// recipe new-r (aliases: old-r). The old name behaves exactly like the new one at the point of use, with one deprecation hint, never an error.
//   site modules (node): atoms engine compile, packs-hooks install into a stub registry, library lookup, hint once-per-alias
//   CLI (suno-track-lab/engine/strudel-cli, STRUDEL_CLI): `strudel events` for atoms.zz.oldkick == atoms.zz.newkick, .hook("oldRack") == .hook("newRack"), pack:zed/alias:old-r == new-r
// Run: node tests/packs/alias_e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = await import(path.join(ROOT, 'site/engine/atoms.js'));
const AL = await import(path.join(ROOT, 'site/engine/aliases.js'));
A.loadTypes(fs.readFileSync(path.join(ROOT, 'site/data/atoms/types.json'), 'utf8'));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok   ' + name); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-')); const dir = path.join(tmp, 'pack'); fs.mkdirSync(dir);
// ---- fixture pack
const rec = { name: 'zz.newkick', type: 'mini', rev: 1, body: 'bd*3' }; const aid = A.idFor('mini', 'zz.newkick');
const atoms = { format: 'atoms@1', name: 'zz', doc: 'alias fixture', atoms: { [aid]: { ...rec, hash: A.atomHash(rec), aliases: ['zz.oldkick'] } } };
const hooks = { model: 1, meta: { id: 'zed/alias:h' }, defs: { newRack: { chain: [['gain', 0.3]], aliases: ['oldRack'] } } };
const recipes = { recipes: [{ id: 'new-r', title: 'New', code: '$: s("bd*2")', expr: 's("bd*2")', labels: [], aliases: ['old-r'] }] };
fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(atoms)); fs.writeFileSync(path.join(dir, 'h.json'), JSON.stringify(hooks)); fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify(recipes));
const man = { craftpack: '1.0.0', id: 'zed/alias', version: '1.0.0', license: 'CC0-1.0', ingredients: [
  { id: 'a', kind: 'atoms', format: 'atoms@1', version: '1.0.0', path: 'a.json', hash: 'sha256:' + '0'.repeat(64) },
  { id: 'h', kind: 'hooks', format: 'hooks@1', version: '1.0.0', path: 'h.json', hash: 'sha256:' + '0'.repeat(64) },
  { id: 'r', kind: 'recipes', format: 'recipes@1', version: '1.0.0', path: 'r.json', hash: 'sha256:' + '0'.repeat(64) }] };
fs.writeFileSync(path.join(dir, 'craftpack.json'), JSON.stringify(man));
execFileSync('python3', [path.join(ROOT, 'tools/packs/packs.py'), 'hash', dir, '--write']);
const v = spawnSync('python3', [path.join(ROOT, 'tools/packs/packs.py'), 'validate', dir], { encoding: 'utf8' });
ok('the fixture pack validates (aliases are legal data)', () => assert.equal(v.status, 0, v.stdout + v.stderr));

// ---- site: atoms engine
const told = []; AL.setAliasSink((m) => told.push(m));
const imports = { 'pack:zed/alias:a': Object.fromEntries(Object.entries(atoms.atoms).map(([id, a]) => [id, { ...a, pack: 'a' }])) };
const comp = (code) => { const extra = { imports }; const env = A.buildEnv(code, extra); return A.compile(code, env, { extra }).code; };
const newC = comp('atoms.import("pack:zed/alias:a")\n$: s(atoms.zz.newkick)'), oldC = comp('atoms.import("pack:zed/alias:a")\n$: s(atoms.zz.oldkick)');
ok('site atoms engine: atoms.zz.oldkick compiles to the same program as atoms.zz.newkick', () => { assert.equal(oldC, newC); assert.match(newC, /bd\*3/); });
ok('one deprecation hint naming the new id, once per alias, none for the new name', () => { assert.equal(told.length, 1); assert.match(told[0], /zz\.oldkick.*zz\.newkick/); comp('atoms.import("pack:zed/alias:a")\n$: s(atoms.zz.oldkick)'); assert.equal(told.length, 1); });
ok('with an `as` namespace the alias is prefixed like the atom', () => { const c = comp('atoms.import("pack:zed/alias:a", { as: "k" })\n$: s(atoms.k.zz.oldkick)'); assert.match(c, /bd\*3/); });
ok('a real atom named like an alias wins (no alias lookup when the name exists)', () => { const c = comp('atoms.import("pack:zed/alias:a")\natom("zz.oldkick", { type: "mini", body: "sd" })\n$: s(atoms.zz.oldkick)'); assert.match(c, /sd/); });

// ---- site: hooks pack adapter
const H = await import(path.join(ROOT, 'site/packs-hooks.js'));
{ let loaded = null; const stub = { load: (d) => { loaded = d; }, undef() {}, toJSON: () => '{}' }; AL.resetAliasHints(); told.length = 0;
  const allow = { has: () => true, args: () => ({}), limits: { args: 8 }, wireTarget: () => true };
  H.install(stub, [{ pack: 'zed/alias', ingredient: 'h', data: hooks }], { told: new Set() }, {}, () => {}, { allow: { ...allow, has: (x) => x === 'gain', args: () => null }, text: '$: s("bd").hook("oldRack")' });
  ok('site hooks adapter: the old def name is installed with the same chain, filing data dropped', () => { assert.ok(loaded && loaded.defs.oldRack, JSON.stringify(loaded)); assert.deepEqual(loaded.defs.oldRack.chain, loaded.defs.newRack.chain); assert.equal(loaded.defs.oldRack.aliases, undefined); assert.match(loaded.defs.oldRack.doc, /alias of newRack/); });
  ok('hook alias hint only when the program uses the old name', () => { assert.equal(told.length, 1); assert.match(told[0], /oldRack.*newRack/); }); }

// ---- site: library refs and recipe ids
const { createLibrary } = await import(path.join(ROOT, 'site/library.js')); const { fallbackStore } = await import(path.join(ROOT, 'site/library-store.js'));
ok('site library: get(oldName) resolves the renamed component with a hint', () => { told.length = 0; AL.resetAliasHints(); const lib = createLibrary(fallbackStore(null)); lib.save({ model: 1, tracks: [] }, { name: 'kick-v2', kind: 'track', aliases: ['kick'] }); assert.equal(lib.get('kick').meta.name, 'kick-v2'); assert.equal(told.length, 1); assert.match(told[0], /kick.*kick-v2/); });

// ---- CLI
const CLI = process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli';
if (!fs.existsSync(path.join(CLI, 'strudel'))) console.log('SKIP  CLI half: no strudel CLI at ' + CLI);
else {
  const run = (...a) => spawnSync(path.join(CLI, 'strudel'), a, { encoding: 'utf8', env: { ...process.env, STRUDEL_CRAFT: ROOT }, maxBuffer: 1 << 26 });
  const ev = (prog, ...extra) => { const f = path.join(tmp, 'p' + n + '.strudel.js'); fs.writeFileSync(f, prog); const r = run('events', f, '--cycles', '2', ...extra); assert.equal(r.status, 0, r.stderr); return r; };
  const pk = ['--pack', dir]; const nz = (r) => { const j = JSON.parse(r.stdout); delete j.source; return JSON.stringify(j); };
  const a1 = ev('atoms.import("pack:zed/alias:a")\n$: s(atoms.zz.newkick)', ...pk), a2 = ev('atoms.import("pack:zed/alias:a")\n$: s(atoms.zz.oldkick)', ...pk);
  ok('CLI: events for atoms.zz.oldkick equal atoms.zz.newkick (both 6 events over 2 cycles)', () => { assert.equal(nz(a2), nz(a1)); assert.equal(JSON.parse(a1.stdout).layers[0].events, 6); });
  ok('CLI: a deprecation warning on stderr names the new id; none for the new name', () => { assert.match(a2.stderr, /zz\.oldkick.*zz\.newkick/); assert.doesNotMatch(a1.stderr, /alias/); });
  const hf = path.join(dir, 'h.json');
  const h1 = ev('$: s("bd*2").hook("newRack")', '--hooks', hf), h2 = ev('$: s("bd*2").hook("oldRack")', '--hooks', hf);
  ok('CLI: .hook("oldRack") equals .hook("newRack") (hook def alias via --hooks)', () => { assert.equal(nz(h2), nz(h1)); assert.match(h2.stderr, /oldRack.*newRack/); assert.ok(JSON.stringify(JSON.parse(h1.stdout)).includes('0.3'), 'the def really applies gain 0.3'); });
  const r1 = run('events', 'pack:zed/alias:new-r', '--pack', dir, '--packs-allow-code', 'zed/alias', '--cycles', '2'), r2 = run('events', 'pack:zed/alias:old-r', '--pack', dir, '--packs-allow-code', 'zed/alias', '--cycles', '2');
  ok('CLI: pack:zed/alias:old-r (a catalog id alias) equals new-r, with a stderr hint', () => { assert.equal(r1.status, 0, r1.stderr); assert.equal(r2.status, 0, r2.stderr); assert.equal(nz(r2), nz(r1)); assert.match(r2.stderr, /old-r.*new-r/); });
  const lib = path.join(tmp, 'L'); const mf = path.join(tmp, 'k.json'); fs.writeFileSync(mf, JSON.stringify({ model: 1, meta: { name: 'k' }, tracks: [] }));
  ok('CLI: library save --aliases / --save-folder, list --folder finds it', () => { const s = run('library', 'save', mf, '--name', 'kick-v2', '--kind', 'fragment', '--aliases', 'kick', '--save-folder', 'drums/kick', '--library', lib); assert.equal(s.status, 0, s.stderr); const l = JSON.parse(run('library', 'list', '--library', lib, '--folder', 'drums').stdout); assert.equal(l.length, 1); assert.deepEqual(l[0].aliases, ['kick']); });
}
console.log(`${n} checks passed`);
