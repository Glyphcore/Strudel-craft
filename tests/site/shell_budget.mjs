// Eager-shell guard (#59): the cheap proxy for the Lighthouse gate (tests/site/lighthouse_relative.mjs stays the manual gate).
// Static, no browser: reads site/index.html and fails when
//   1. a script, stylesheet, modulepreload or preload loads with the page and is not on EAGER below (new eager weight must be a decision),
//      or an EAGER entry is no longer in index.html (stale list);
//   2. the eager shell grows past BUDGET bytes: index.html + every eager file + the static import graph of every eager module (raw bytes,
//      what the uncompressed local Lighthouse server sends);
//   3. a module of the deferred set (index.html LATER) is pulled into the eager graph by a static import;
//   4. a manifest of the shipped lock, or a recipes entry of one (the catalog view reads all of them before the first frame), is not preloaded:
//      that is a lock -> manifest -> entry request chain in front of the first frame with recipes.
// Usage: node tests/site/shell_budget.mjs   (also run by tests/site/smoke.mjs). Exit 1 on any FAIL.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');

/* the explicit allow-list: "<kind> <href>". Kinds: script (classic), module, style, modulepreload, preload. Adding an entry here is the decision
   to make the first paint wait for it; keep the budget in step and re-measure with tests/site/lighthouse_relative.mjs. */
export const EAGER = [
  'preload fonts/ChakraPetch-500.woff2', 'preload data/catalog.json', 'modulepreload packs.js', 'modulepreload packs-kinds.js', 'modulepreload engine/packs-core.js',
  'preload packs.lock.json', 'preload craftpack.json', 'preload data/vox/craftpack.json', 'preload data/phonk/craftpack.json', 'preload data/phonk/presets.json',
  'preload app.js', 'style style.css', 'script ui.js', 'script forms.js', 'script app.js', 'module packs.js', 'style workspace.css', 'module palette.js', 'style pwa.css', 'module pwa.js',
];
/* the budget leaves under 3% for small fixes, not for a new feature: data/catalog.json alone is 109,978 of it */
export const BUDGET_MEASURED = 419_567; // index.html + 18 eager files + their static imports, 2026-11-16 (b9e7024 + the #59 rework)
export const BUDGET = 430_000; // +2.8%

export function shellBudget() {
  const checks = []; const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const tags = [];
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) { const a = m[1]; const src = /\bsrc="([^"]+)"/.exec(a); if (!src) continue; tags.push(`${/type="module"/.test(a) ? 'module' : 'script'} ${src[1]}`); }
  for (const m of html.matchAll(/<link\b([^>]*)>/g)) {
    const a = m[1]; const rel = (/\brel="([^"]+)"/.exec(a) || [])[1]; const href = (/\bhref="([^"]+)"/.exec(a) || [])[1];
    if (!href || href.startsWith('data:')) continue;
    if (rel === 'stylesheet') tags.push('style ' + href); else if (rel === 'modulepreload' || rel === 'preload') tags.push(rel + ' ' + href);
  }
  const extra = tags.filter((t) => !EAGER.includes(t)); const stale = EAGER.filter((t) => !tags.includes(t));
  check('every eager script/stylesheet/preload in index.html is on the allow-list', !extra.length, extra.length ? 'not allowed: ' + extra.join(', ') + ' (load it after the first frame, or add it to EAGER with a re-measure)' : tags.length + ' entries');
  check('the allow-list has no stale entries', !stale.length, stale.join(', '));
  // static import graph of the eager modules
  const files = new Set(['index.html']); const modules = [];
  for (const t of tags) { const [kind, href] = t.split(' '); files.add(href); if (kind === 'module' || kind === 'modulepreload') modules.push(href); }
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return; seen.add(rel); files.add(rel);
    const src = fs.readFileSync(path.join(SITE, rel), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] || m[2])));
  };
  for (const m of modules) walk(m);
  const missing = [...files].filter((f) => !fs.existsSync(path.join(SITE, f)));
  check('every eager file exists', !missing.length, missing.join(', '));
  const sizes = [...files].filter((f) => !missing.includes(f)).map((f) => [f, fs.statSync(path.join(SITE, f)).size]).sort((a, b) => b[1] - a[1]);
  const total = sizes.reduce((s, [, b]) => s + b, 0);
  check(`eager shell is within the byte budget (${total} of ${BUDGET} bytes)`, total <= BUDGET, `${files.size} files; largest: ${sizes.slice(0, 6).map(([f, b]) => `${f} ${b}`).join(', ')}`);
  const later = JSON.parse('[' + ((/const LATER = \[([^\]]*)\]/.exec(html) || [])[1] || '').replace(/'/g, '"') + ']');
  const pulled = later.filter((u) => files.has(u));
  check(`no deferred module (${later.length} in LATER) is in the eager import graph`, later.length > 0 && !pulled.length, pulled.join(', ') || (later.length ? '' : 'LATER list not found in index.html'));
  // shipped lock: manifests and recipes entries preloaded
  const lock = JSON.parse(fs.readFileSync(path.join(SITE, 'packs.lock.json'), 'utf8')); const want = [];
  for (const p of lock.packs || []) {
    if (!String(p.source || '').startsWith('file:')) continue;
    const dir = p.source.slice(5).replace(/^\.\/?/, ''); const man = path.posix.join(dir || '.', 'craftpack.json');
    want.push(man);
    const m = JSON.parse(fs.readFileSync(path.join(SITE, man), 'utf8'));
    for (const i of m.ingredients || []) if (i.kind === 'recipes') want.push(path.posix.join(dir || '.', i.path));
  }
  const notPre = want.filter((u) => !tags.includes('preload ' + u));
  check('every shipped-lock manifest and recipes entry is preloaded (no request chain before the first frame)', !notPre.length, notPre.length ? 'add <link rel="preload" as="fetch" crossorigin> for: ' + notPre.join(', ') : want.join(', '));
  return { checks, total, budget: BUDGET, files: sizes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = shellBudget(); for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  -- ' + c.detail : ''}`);
  if (process.argv.includes('--list')) for (const [f, b] of r.files) console.log(String(b).padStart(8), f);
  process.exit(r.checks.every((c) => c.ok) ? 0 : 1);
}
