// Boots an unmodified @strudel/core + @strudel/mini (from node_modules, or STRUDEL_MODULES=<dir containing @strudel/>) and installs the hooks runtime.
// Returns null when Strudel is not installed, so callers can SKIP with the exact reason.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';
register('./kabel-shim.mjs', import.meta.url);
const load = async (name) => {
  try { return await import(name); } catch { /* try STRUDEL_MODULES */ }
  const dir = process.env.STRUDEL_MODULES; if (!dir) return null;
  const pkg = path.join(dir, name); const j = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  const ex = typeof j.exports === 'object' && j.exports['.'] ? (j.exports['.'].import || j.exports['.'].default || j.exports['.']) : j.module || j.main;
  return import(pathToFileURL(path.join(pkg, ex)).href);
};
export async function bootRuntime() {
  const core = await load('@strudel/core'), mini = await load('@strudel/mini');
  if (!core || !mini) return null;
  Object.assign(globalThis, core, { mini: mini.mini });
  const { install } = await import('../../../site/engine/hooks.js');
  const r = install({ Pattern: core.Pattern, stack: core.stack, silence: core.silence, reify: core.reify, signal: core.signal, Fraction: core.Fraction, mini: mini.mini });
  return { core, mini, ...r, S: { ...core, mini: mini.mini } };
}
export const haps = (p, a, b) => p.queryArc(a, b, { _cps: 1 }).map((h) => ({ b: +h.whole.begin, v: h.value }));
