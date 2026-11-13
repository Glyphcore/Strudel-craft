// Shared by p1/p2/p7/p8 runtime tests: boots the CLI's real Strudel (unmodified @strudel/*), with hooks.js installed by the CLI.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const LAB = process.env.SUNO_LAB || '/home/user/suno-track-lab';
export const CLI_DIR = path.join(LAB, 'engine', 'strudel-cli');
export const CLI = path.join(CLI_DIR, 'cli.mjs');
export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const say = (m) => process.stdout.write(m + '\n');
export const pass = (m) => say('PASS ' + m);
export async function boot() {
  await import(pathToFileURL(path.join(CLI_DIR, 'lib/boot.mjs')).href);
  const E = await import(pathToFileURL(path.join(CLI_DIR, 'lib/engine.mjs')).href);
  const S = await E.loadStrudel();
  return { E, S, core: S.core, hooks: S.hooks, g: globalThis };
}
// hap list over [a,b): sorted, plain data (whole begin/end as numbers, value)
export const haps = (p, a, b, ctrl = { _cps: 1 }) => p.queryArc(a, b, ctrl).map((h) => ({ b: +(h.whole ? h.whole.begin : h.part.begin), e: +(h.whole ? h.whole.end : h.part.end), pb: +h.part.begin, pe: +h.part.end, v: h.value })).sort((x, y) => x.pb - y.pb || JSON.stringify(x.v).localeCompare(JSON.stringify(y.v)));
export const cli = (args, o = {}) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, STRUDEL_CRAFT: path.resolve(HERE, '../..') }, ...o });
export const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n));
