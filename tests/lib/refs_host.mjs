// Test/dev host for the Resources model in plain Node: the shipped lock read from site/ (file: sources), the atoms engine configured the way the CLI does,
// the hooks registry replaced by the defs the program binds (a stand-in for hooks.toJSON()). The CLI twin builds the same facade from its own pack loader.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const imp = (f) => import(pathToFileURL(path.join(SITE, 'engine', f)).href);
export async function loadHost(code, { lock = 'packs.lock.json', skipPacks = [] } = {}) {
  const C = await imp('packs-core.js'); const R = await imp('resources.js'); const A = await imp('atoms.js');
  const lk = JSON.parse(fs.readFileSync(path.join(SITE, lock), 'utf8')); const packs = lk.packs.filter((p) => !skipPacks.includes(p.id));
  const loaded = {}, mans = {};
  for (const e of packs) { const dir = path.join(SITE, e.source.replace(/^file:/, '')); const man = JSON.parse(fs.readFileSync(path.join(dir, 'craftpack.json'), 'utf8')); mans[e.id] = man; const ings = [];
    for (const ing of man.ingredients || []) { try { ings.push({ id: ing.id, kind: ing.kind, data: JSON.parse(fs.readFileSync(path.join(dir, ing.path), 'utf8')) }); } catch { /* not a json entry */ } }
    loaded[e.id] = { version: man.version, ingredients: ings }; }
  const layers = [{ name: 'shipped', packs }]; const res = C.resolve(layers, loaded);
  const P = { layers, loaded, mans, resolution: res.resolution }; const facade = R.packsFacade(P);
  if (!A.types().length) A.loadTypes(JSON.parse(fs.readFileSync(path.join(SITE, 'data/atoms/types.json'), 'utf8')));
  A.configure({ positions: JSON.parse(fs.readFileSync(path.join(SITE, 'data/atoms/positions.json'), 'utf8')) });
  const imports = {}; const AC = await imp('atoms-consumers.js');
  for (const [pid, lp] of Object.entries(loaded)) for (const ing of lp.ingredients) if (ing.kind === 'atoms' && ing.data && ing.data.atoms) imports[`pack:${pid}:${ing.id}`] = AC.importedAtoms({ id: `${pid}:${ing.id}`, data: ing.data });
  let env = null, refs = [], error = null;
  try { env = A.buildEnv(code, { imports }, { diag: [] }); refs = A.compile(code, env, {}).refs || []; } catch (e) { error = e; }
  const H = await imp('hygiene.js'); const G = await imp('groove.js');
  const defs = {}; for (const r of Object.values(loaded)) for (const ing of r.ingredients) if (ing.kind === 'hooks') Object.assign(defs, ing.data.defs || {});
  const banks = JSON.parse(fs.readFileSync(path.join(SITE, 'data/vox/banks.json'), 'utf8'));
  return { R, host: { atoms: { env, refs, error }, hooks: { json: { defs }, plan: { taps: [] }, stdlib: [...Object.keys(H.HYGIENE), ...Object.keys(G.GROOVES)] }, packs: facade, vox: (banks.banks || banks).map((b) => ({ name: b.name, pack: 'glyphcore/vox', kind: b.kind })) }, P };
}
