// Refresh tests/lanes/fixtures/l4_golden.json for catalog recipes whose CODE changed (the golden pins model / graph digests per document, so an
// edited recipe needs a new digest; unchanged documents keep theirs, which is what the invariant in l4.mjs section 7 is about).
//   node tests/lanes/fixtures/regen_l4_golden.mjs [--write]     (without --write: lists the documents whose digests differ)
import fs from 'node:fs'; import crypto from 'node:crypto';
import * as M from '../../../site/model.js';
const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8'); const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const gold = JSON.parse(rd('./l4_golden.json')); const changed = [];
for (const r of JSON.parse(rd('../../../site/data/catalog.json')).recipes) {
  const k = 'recipe:' + r.id; const m = M.parse(r.code); let gr; try { gr = sha(JSON.stringify(M.graph(m))); } catch (e) { gr = 'ERR ' + e.message; }
  const next = { graph: gr, model: sha(M.canonical(m)), hash: M.hash(m), gen: M.generate(m) === r.code };
  if (JSON.stringify(next) !== JSON.stringify(gold[k])) { changed.push(k); gold[k] = next; }
}
console.log(changed.length ? changed.join('\n') : 'in step');
if (process.argv.includes('--write') && changed.length) { const raw = rd('./l4_golden.json'); fs.writeFileSync(new URL('./l4_golden.json', import.meta.url), JSON.stringify(gold, null, /\n /.test(raw) ? 1 : 0) + (raw.endsWith('\n') ? '\n' : '')); console.log('wrote l4_golden.json'); }
