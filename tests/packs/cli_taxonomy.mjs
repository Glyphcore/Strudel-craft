// CLI filters by folder and tag (issue #120): `strudel packs list --folder --tag`, `strudel library list --folder --tag`, `strudel complete` tags.
// The CLI lives in suno-track-lab/engine/strudel-cli (STRUDEL_CLI); without it this test skips. Run: node tests/packs/cli_taxonomy.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli';
if (!fs.existsSync(path.join(CLI, 'strudel'))) { console.log('SKIP  the strudel CLI is not at ' + CLI + ' (set STRUDEL_CLI)'); process.exit(0); }
const run = (...a) => spawnSync(path.join(CLI, 'strudel'), a, { encoding: 'utf8', env: { ...process.env, STRUDEL_CRAFT: ROOT }, maxBuffer: 1 << 26 });
const LOCK = path.join(ROOT, 'site/packs.lock.json'); let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok   ' + name); };
const list = (...a) => JSON.parse(run('packs', 'list', '--lock', LOCK, '--json', ...a).stdout);
ok('packs list --folder filters items at or below the folder', () => { const r = list('--folder', 'hiphop/trap'); assert.ok(r.length >= 6); assert.ok(r.every((x) => x.folder.startsWith('hiphop/trap'))); });
ok('--tag is AND, --any-tag is OR', () => { const a = list('--tag', 'trap,drums'), o = list('--any-tag', 'trap,drums'); assert.ok(a.length > 0 && a.every((x) => x.tags.includes('trap') && x.tags.includes('drums'))); assert.ok(o.length > a.length); });
ok('folder and tag combine; kinds (recipe, atom, hook) all carry them', () => { const r = list('--folder', 'hiphop', '--tag', 'drums'); assert.ok(new Set(r.map((x) => x.kind)).size >= 2); assert.ok(list('--tag', 'rack').some((x) => x.kind === 'hook')); });
ok('a bad folder or tag name is an error, not an empty list', () => { const r = run('packs', 'list', '--lock', LOCK, '--folder', 'a/b/c/d/e/f/g/h/i'); assert.notEqual(r.status, 0); assert.match(r.stderr, /--folder/); });
ok('without filters packs list is unchanged (packs with ingredients)', () => { const r = list(); assert.ok(r.some((p) => p.id === 'glyphcore/phonk' && p.ingredients.length >= 10)); });
ok('strudel complete includes tags and folders with counts', () => { const r = JSON.parse(run('complete', 'tag:dr', '--packs', LOCK).stdout); assert.ok(r.items.some((i) => i.name === 'tag:drums' && i.kind === 'tag' && i.n > 5)); const f = JSON.parse(run('complete', 'folder:hiphop/tr', '--packs', LOCK).stdout); assert.ok(f.items.some((i) => i.name === 'folder:hiphop/trap')); });
ok('library list --folder/--tag filters components saved with folder and tags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-')); const m = path.join(dir, 'k.json'); fs.writeFileSync(m, JSON.stringify({ model: 1, meta: { name: 'k' }, tracks: [] }));
  const s = run('library', 'save', m, '--name', 'kick1', '--kind', 'fragment', '--tags', 'drums,dark', '--library', path.join(dir, 'L')); assert.equal(s.status, 0, s.stderr);
  const all = JSON.parse(run('library', 'list', '--library', path.join(dir, 'L')).stdout); assert.equal(all.length, 1);
  assert.equal(JSON.parse(run('library', 'list', '--library', path.join(dir, 'L'), '--tag', 'drums').stdout).length, 1);
  assert.equal(JSON.parse(run('library', 'list', '--library', path.join(dir, 'L'), '--tag', 'bass').stdout).length, 0);
  assert.equal(JSON.parse(run('library', 'list', '--library', path.join(dir, 'L'), '--folder', 'x').stdout).length, 0);
});
console.log(`${n} checks passed`);
