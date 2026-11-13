// Conformance runner for site/engine/packs-core.js against tests/packs/vectors.json (docs/PACK_SPEC.md 9.3, 15).
// Loads the fixture packs from disk (manifest + entry files, as a verified host would hand them over) and
// compares the report with the expected winners, shadowed ids and codes. Usage: node tests/packs/core.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePacks } from '../../site/engine/packs-core.js';

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
process.exit(failed ? 1 : 0);
