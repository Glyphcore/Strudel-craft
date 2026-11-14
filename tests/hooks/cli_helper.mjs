// Unit test of tests/hooks/fixtures/cli.mjs against a tiny fake executable written to a temp dir (the real CLI is another repo). Run: node tests/hooks/cli_helper.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveCli, runCli, cliLine, cliUnspecified, wavInfo } from './fixtures/cli.mjs';

const pass = (m) => console.log('PASS ' + m);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clihelper-')), empty = fs.mkdtempSync(path.join(os.tmpdir(), 'clihelper-empty-'));
const fake = path.join(dir, 'strudel');
fs.writeFileSync(fake, `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === 'echo') { process.stdout.write(JSON.stringify({ argv: a.slice(1), craft: process.env.STRUDEL_CRAFT, cwd: process.cwd() })); }
else if (a[0] === 'fail') { process.stderr.write('E_FAKE boom'); process.exit(3); }
else if (a[0] === 'sleep') { setTimeout(() => {}, 60000); }
else if (a[0] === 'wav') { const n = 10, b = Buffer.alloc(44 + n * 8); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(44100, 24); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(n * 8, 40); require('fs').writeFileSync(a[1], b); }
`);
fs.chmodSync(fake, 0o755);
const withCli = { env: { STRUDEL_CLI: fake } };
const logs = []; const real = console.log; const cap = (f) => { console.log = (m) => logs.push(m); try { return f(); } finally { console.log = real; } };

// SKIP: nothing on PATH, STRUDEL_CLI unset or pointing nowhere
{
  const none = { PATH: empty, STRUDEL_CLI: undefined }, r = resolveCli(none); assert.ok(r.skip && /STRUDEL_CLI/.test(r.skip));
  assert.ok(resolveCli({ PATH: empty, STRUDEL_CLI: path.join(empty, 'nope') }).skip.includes('nope'));
  assert.deepEqual(Object.keys(runCli(['echo'], { env: none })), ['skip']);
  logs.length = 0; const st = cap(() => cliLine('absent line', () => { assert.fail('must not run'); }, { env: none }));
  assert.equal(st, 'skip'); assert.ok(logs[0].startsWith('SKIP absent line: `strudel` CLI not available'));
  assert.equal(cap(() => cliUnspecified('x', 'the flag')), 'skip'); assert.equal(logs.at(-1), 'SKIP x: CLI invocation not specified: the flag');
  pass('helper SKIP: no binary on PATH or in STRUDEL_CLI gives a SKIP line with the reason, and the assertion callback never runs');
}
// PASS: resolution through STRUDEL_CLI and through PATH, argv without a shell, cwd, exit code, stdout and stderr captured
{
  const r = runCli(['echo', 'a b', '$(echo hacked);', '*'], { ...withCli, cwd: dir }); assert.equal(r.status, 0); assert.equal(r.timedOut, false);
  const j = JSON.parse(r.stdout); assert.deepEqual(j.argv, ['a b', '$(echo hacked);', '*']); assert.ok(j.craft.endsWith('Strudel-craft/') || fs.existsSync(path.join(j.craft, 'site')), 'STRUDEL_CRAFT defaults to this checkout'); assert.equal(fs.realpathSync(j.cwd), fs.realpathSync(dir));
  assert.equal(JSON.parse(runCli(['echo'], { env: { STRUDEL_CLI: undefined, PATH: dir } }).stdout).argv.length, 0, 'found as `strudel` on PATH');
  assert.equal(JSON.parse(runCli(['echo'], { env: { STRUDEL_CLI: 'strudel', PATH: dir } }).stdout).argv.length, 0, 'STRUDEL_CLI may be a command name');
  const f = runCli(['fail'], withCli); assert.equal(f.status, 3); assert.equal(f.stderr, 'E_FAKE boom'); assert.equal(f.stdout, '');
  assert.throws(() => runCli('echo hi', withCli), TypeError);
  logs.length = 0; assert.equal(cap(() => cliLine('ok line', (run) => { const x = run(['echo', 'z']); assert.equal(x.status, 0); return `argv ${JSON.parse(x.stdout).argv}`; }, withCli)), 'pass'); assert.equal(logs[0], 'PASS ok line: argv z');
  const w = path.join(dir, 'o.wav'); runCli(['wav', w], withCli); assert.deepEqual(wavInfo(w), { format: 3, channels: 2, sampleRate: 44100, bits: 32, frames: 10, bytes: 124 });
  pass('helper PASS: argv arrays reach the program literally (no shell), exit code / stdout / stderr / cwd captured, STRUDEL_CLI and PATH resolution, PASS line printed, wavInfo reads a header');
}
// FAIL: a failed assertion, a timeout and a wrong argument type all throw (the calling script then exits non-zero)
{
  assert.throws(() => cap(() => cliLine('bad line', (run) => { assert.equal(run(['fail']).status, 0, 'expected exit 0'); }, withCli)), /expected exit 0/);
  assert.ok(!logs.some((l) => l.startsWith('PASS bad line')));
  const t0 = Date.now(); assert.throws(() => cap(() => cliLine('slow line', (run) => { run(['sleep']); }, { ...withCli, timeoutMs: 300 })), /timed out/); assert.ok(Date.now() - t0 < 10000);
  assert.equal(runCli(['sleep'], { ...withCli, timeoutMs: 300 }).timedOut, true);
  pass('helper FAIL: a failing assertion and a timeout throw (no PASS line), the timeout kills the child within the limit');
}
