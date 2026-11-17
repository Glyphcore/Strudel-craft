/* sample-source `base` rules (#183 defect 2). Shipped packs: https, pinned to a 40-hex commit, on a host sw.js caches (packs.py validate --strict). Any pack: https only.
   A user pack with an unpinned or other-host https base still loads and gets a warning (adapter `warnings`, shown by the loader as W_PACK_SOURCE_PIN / W_PACK_SOURCE_HOST).
   Cases: http, ftp, branch base, off-host base under --strict, unpinned user pack warns, good pack clean, host list in step with sw.js. Usage (repo root): node tests/site/source_base.mjs */
import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), PK = path.join(ROOT, 'tools/packs/packs.py');
let fail = 0; const check = (n, ok, d = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); if (!ok) fail++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')); const GOOD = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/drumkits/sources/sources.json'), 'utf8')).sources[0].base;
const sha = GOOD.match(/[0-9a-f]{40}/)[0];
const run = (args) => { const r = spawnSync('python3', ['-I', PK, ...args], { encoding: 'utf8' }); return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const make = (name, base) => { const d = path.join(tmp, name); fs.cpSync(path.join(ROOT, 'site/data/drumkits'), d, { recursive: true }); const f = path.join(d, 'sources/sources.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.sources[0].base = base; fs.writeFileSync(f, JSON.stringify(j, null, 1)); run(['hash', d, '--write']); return d; };
const cases = {
  http: ['http://raw.githubusercontent.com/x/y/' + sha + '/', 'E_PACK_SCHEMA', 'base'],
  ftp: ['ftp://raw.githubusercontent.com/x/y/' + sha + '/', 'E_PACK_SCHEMA', 'base'],
};
for (const [k, [b, code, field]] of Object.entries(cases)) { const r = run(['validate', make(k, b)]); check(`${k} base rejected as an error naming the field`, r.rc === 1 && r.out.includes(code) && r.out.includes(field), r.out.split('\n')[0]); }
const branch = make('branch', 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.big-rusty-drums/main/');
check('branch base: --strict fails with W_PACK_SOURCE_PIN', (r => r.rc === 1 && r.out.includes('W_PACK_SOURCE_PIN'))(run(['validate', branch, '--strict'])));
check('branch base: without --strict it validates (a user pack loads) and prints the warning', (r => r.rc === 0 && r.out.includes('W_PACK_SOURCE_PIN'))(run(['validate', branch])));
for (const [k, b] of Object.entries({ mid: 'https://raw.githubusercontent.com/o/r/master/' + sha + '/', repo: 'https://raw.githubusercontent.com/' + sha + '/r/main/', tail: 'https://raw.githubusercontent.com/o/r/main/x/' + sha + '/' }))
  check(`hex outside the ref position (${k}) fails --strict with W_PACK_SOURCE_PIN`, (r => r.rc === 1 && r.out.includes('W_PACK_SOURCE_PIN'))(run(['validate', make(k, b), '--strict'])));
const off = make('off', 'https://evil.example.com/x/' + sha + '/');
check('off-host pinned base: --strict fails with W_PACK_SOURCE_HOST', (r => r.rc === 1 && r.out.includes('W_PACK_SOURCE_HOST'))(run(['validate', off, '--strict'])));
const good = make('good', GOOD);
check('the shipped pinned base on raw.githubusercontent.com passes --strict', run(['validate', good, '--strict']).rc === 0);
// the site adapter: same rules for packs loaded in the browser
const K = (await import(path.join(ROOT, 'site/packs-kinds.js'))).KINDS['sample-source']; const src = (base) => ({ sources: [{ id: 'u', title: 'u', sounds: ['x'], map: { x: ['a.wav'] }, base, license: 'unknown', terms_url: 'https://example.com/t' }] });
check('adapter rejects an http base naming the field', /sources\[0\]\.base must be an https URL/.test(K.check(src('http://h/x/')) || ''), String(K.check(src('http://h/x/'))));
check('adapter rejects an ftp base', !!K.check(src('ftp://h/x/')));
check('adapter accepts an unpinned branch base but warns W_PACK_SOURCE_PIN', K.check(src('https://raw.githubusercontent.com/o/r/main/')) === null && K.warnings(src('https://raw.githubusercontent.com/o/r/main/')).some((w) => w.code === 'W_PACK_SOURCE_PIN'));
check('adapter accepts an off-host base but warns W_PACK_SOURCE_HOST', K.check(src('https://example.com/' + sha + '/')) === null && K.warnings(src('https://example.com/' + sha + '/')).some((w) => w.code === 'W_PACK_SOURCE_HOST'));
for (const b of ['https://raw.githubusercontent.com/o/r/master/' + sha + '/', 'https://raw.githubusercontent.com/o/r/main/x/' + sha + '/']) check('adapter warns W_PACK_SOURCE_PIN for hex outside the ref position: ' + b.slice(34, 60), K.warnings(src(b)).some((w) => w.code === 'W_PACK_SOURCE_PIN'));
check('adapter: the shipped pinned base gives no warning', K.warnings(src(GOOD)).length === 0);
const swSrc = fs.readFileSync(path.join(ROOT, 'site/sw.js'), 'utf8'), pySrc = fs.readFileSync(PK, 'utf8');
check('CACHED_HOSTS (packs.py, packs-kinds.js) matches the host sw.js caches', /hostname === 'raw\.githubusercontent\.com'/.test(swSrc) && /CACHED_HOSTS = \{"raw\.githubusercontent\.com"/.test(pySrc) && /CACHED_HOSTS = \{ 'raw\.githubusercontent\.com'/.test(fs.readFileSync(path.join(ROOT, 'site/packs-kinds.js'), 'utf8')));
fs.rmSync(tmp, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
