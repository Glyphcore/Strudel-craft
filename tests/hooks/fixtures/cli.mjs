// Shared harness helper for the lines that need the external `strudel` CLI (engine/strudel-cli, another repo).
// Resolves the binary from STRUDEL_CLI (a path, or a command name looked up on PATH) or `strudel` on PATH; a .mjs/.js/.cjs target is run with
// this node. Runs with argv arrays only (no shell, no string command), a timeout and no input from the network (nothing here opens a socket).
// STRUDEL_CRAFT defaults to this checkout so the CLI loads the site modules under test. Absent CLI -> a SKIP line, never a pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isExec = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return isFile(f); } catch { return false; } };
const onPath = (name, env) => { for (const d of String(env.PATH || '').split(path.delimiter)) if (d && isExec(path.join(d, name))) return path.join(d, name); return null; };

// -> { cmd, pre } (pre = leading argv for script targets) or { skip: reason }
export function resolveCli(env = process.env) {
  const want = env.STRUDEL_CLI;
  let file = null, why = 'no `strudel` on PATH and STRUDEL_CLI is not set';
  if (want) { file = isFile(want) ? path.resolve(want) : (!want.includes(path.sep) ? onPath(want, env) : null); if (!file) why = `STRUDEL_CLI=${want} is not a file and not on PATH`; }
  else file = onPath('strudel', env);
  if (!file) return { skip: `\`strudel\` CLI not available (${why}); set STRUDEL_CLI=<path to the strudel binary or cli.mjs>` };
  return /\.(mjs|cjs|js)$/.test(file) ? { cmd: process.execPath, pre: [file] } : { cmd: file, pre: [] };
}

// runCli(argv, { timeoutMs, cwd, env, input }) -> { skip } | { status, signal, stdout, stderr, timedOut }
export function runCli(args, { timeoutMs = 120000, cwd, env: extra = {}, input } = {}) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new TypeError('runCli takes an argv array of strings');
  const env = { STRUDEL_CRAFT: REPO, ...process.env, ...extra }, r = resolveCli(env); if (r.skip) return { skip: r.skip };
  const p = spawnSync(r.cmd, [...r.pre, ...args], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1 << 26, cwd, env, input, shell: false });
  const timedOut = p.error?.code === 'ETIMEDOUT';
  if (p.error && !timedOut) throw new Error(`could not run ${r.cmd}: ${p.error.message}`);
  return { status: p.status, signal: p.signal, stdout: p.stdout || '', stderr: p.stderr || '', timedOut };
}

// cliLine(label, fn, opts): SKIP when the CLI is absent; otherwise fn(run) must assert (a failed assertion, a timeout or a spawn error throws = FAIL)
// and may return a detail string for the PASS line. `run(argv, o)` is runCli bound to opts and throws on timeout.
export function cliLine(label, fn, opts = {}) {
  const r = resolveCli({ ...process.env, ...(opts.env || {}) });
  if (r.skip) { console.log(`SKIP ${label}: ${r.skip}`); return 'skip'; }
  const run = (args, o = {}) => { const x = runCli(args, { ...opts, ...o, env: { ...(opts.env || {}), ...(o.env || {}) } }); if (x.timedOut) throw new Error(`CLI timed out: strudel ${args.join(' ')}`); return x; };
  const detail = fn(run); console.log(`PASS ${label}${detail ? ': ' + detail : ''}`); return 'pass';
}
// A line whose CLI invocation the CLI-side comments do not pin down: always SKIP, with the missing piece named.
export const cliUnspecified = (label, missing) => { console.log(`SKIP ${label}: CLI invocation not specified: ${missing}`); return 'skip'; };

// Minimal RIFF/WAVE reader for assertions on `-o x.wav` outputs.
export function wavInfo(file) {
  const b = fs.readFileSync(file); if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a RIFF/WAVE file`);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { format: b.readUInt16LE(o + 8), channels: b.readUInt16LE(o + 10), sampleRate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === 'data') { data = Math.min(n, b.length - o - 8); break; } o += 8 + n + (n & 1); }
  if (!fmt || data == null) throw new Error(`${file}: no fmt/data chunk`);
  return { ...fmt, frames: data / (fmt.channels * fmt.bits / 8), bytes: b.length };
}
