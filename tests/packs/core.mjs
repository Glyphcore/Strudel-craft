// Conformance runner for site/engine/packs-core.js against tests/packs/vectors.json (docs/PACK_SPEC.md 9.3, 15).
// Loads the fixture packs from disk (manifest + entry files, as a verified host would hand them over) and
// compares the report with the expected winners, shadowed ids and codes. Usage: node tests/packs/core.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePacks, verify } from '../../site/engine/packs-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

function loadFixture(dir) {
  const man = read(join(FIX, dir, 'craftpack.json'));
  return [man.id, {
    version: man.version,
    ingredients: man.ingredients.map((ing) => ({ id: ing.id, kind: ing.kind, data: read(join(FIX, dir, ing.path)) })),
  }];
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vectors = read(join(here, 'vectors.json'));
let failed = 0;

for (const c of vectors.cases) {
  const loaded = Object.fromEntries(c.packs.map(loadFixture));
  const got = resolvePacks(c.layers, loaded);
  const slim = {
    errors: got.errors.map((e) => ({ code: e.code, id: e.id })),
    warnings: got.warnings.map((w) => ({ code: w.code, kind: w.kind, name: w.name, winner: w.winner, shadowed: w.shadowed })),
    resolution: got.resolution,
  };
  if (eq(slim, c.expect)) {
    console.log(`ok   ${c.name}`);
  } else {
    failed++;
    console.log(`FAIL ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify(slim)}`);
  }
}
console.log(`${vectors.cases.length} vectors, ${failed} failed`);

// verify(ref, hash) over the synthetic fixture 'good' (docs/PACK_SPEC.md 11.1): a stub fetch serves the pinned github: URLs from tests/packs/fixtures
const SHA = 'a'.repeat(40), SRC = `github:testco/fx@${SHA}/good`, REF = 'testco/good';
const served = new Map(), requests = []; let offline = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  requests.push(String(url)); if (offline) throw new TypeError('offline');
  const m = new RegExp(`^https://raw\\.githubusercontent\\.com/testco/fx/${SHA}/good/(.+)$`).exec(String(url)); const f = m && join(FIX, 'good', m[1]);
  if (!m || !existsSync(f)) return new Response('', { status: 404 });
  return new Response(served.get(m[1]) || readFileSync(f));
};
const hx = (b) => 'sha256:' + createHash('sha256').update(b).digest('hex');
const man = read(join(FIX, 'good/craftpack.json')), ing = man.ingredients.find((i) => i.id === 'recipes');
const pyHash = (rel) => execFileSync('python3', ['-I', '-c', 'import sys; sys.path.insert(0, sys.argv[1]); import packs; print(packs.sha(open(sys.argv[2], "rb").read()))', join(here, '../../tools/packs'), join(FIX, 'good', rel)]).toString().trim();
const manifestHash = pyHash('craftpack.json'), itemHash = pyHash(ing.path);
const t = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`); };
let r = await verify(`${REF}@${SRC}`, manifestHash);
t('verify: pack ref matches the manifest hash that tools/packs/packs.py computes', r.ok === true && r.hash === manifestHash && r.source === SRC, r);
r = await verify(`${REF}:recipes@${SRC}`, itemHash);
t('verify: item ref matches the entry-file hash of packs.py (= manifest ingredient hash)', r.ok === true && itemHash === ing.hash, r);
served.set(ing.path, Buffer.concat([readFileSync(join(FIX, 'good', ing.path)), Buffer.from(' ')]));
r = await verify({ id: REF, item: 'recipes', source: SRC }, itemHash);
t('verify: a tampered byte gives E_PACK_HASH with the actual hash', r.ok === false && r.code === 'E_PACK_HASH' && r.expected === itemHash && /^sha256:[0-9a-f]{64}$/.test(r.actual) && r.actual !== itemHash, r);
served.clear();
r = await verify(`${REF}:nope@${SRC}`, itemHash); t('verify: unknown ingredient is refused (E_PACK_ID)', !r.ok && r.code === 'E_PACK_ID', r);
r = await verify(`${REF}@github:testco/fx@${SHA}/missing`, manifestHash); t('verify: unknown pack folder is E_PACK_UNAVAILABLE (HTTP 404, not offline)', !r.ok && r.code === 'E_PACK_UNAVAILABLE' && r.offline === false, r);
r = await verify(REF, manifestHash); t('verify: a ref with no source and no lock layer is E_PACK_SOURCE', !r.ok && r.code === 'E_PACK_SOURCE', r);
requests.length = 0;
for (const src of ['github:testco/fx@main/good', `https://example.org/good/`, 'file:./good', `git+https://example.org/r.git@${SHA}`]) { r = await verify(`${REF}@${src}`, manifestHash); t(`verify: unpinned or non-sha source ${src.slice(0, 24)} is refused without a fetch`, !r.ok && r.code === 'E_PACK_SOURCE', r); }
t('verify: refused sources fetched nothing', requests.length === 0, requests);
r = await verify(`${REF}@${SRC}`, 'sha256-' + manifestHash.slice(7)); t('verify: a hash not in the lock encoding is refused', !r.ok && r.code === 'E_PACK_HASH', r);
offline = true; r = await verify(`${REF}@${SRC}`, manifestHash); t('verify: offline without a cache is E_PACK_UNAVAILABLE with offline true', !r.ok && r.code === 'E_PACK_UNAVAILABLE' && r.offline === true, r);
offline = false; globalThis.fetch = realFetch;
process.exit(failed ? 1 : 0);
