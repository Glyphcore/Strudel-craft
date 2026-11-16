#!/usr/bin/env node
// Rack quality audit (docs/RACK_STANDARD.md): renders a standard test phrase per instrument class through every rack with the headless
// strudel CLI, measures the spectrum and levels, and reports pass or fail against tools/racks/standard.json.
//   node tools/racks/audit.mjs [--only racks,catalog,syntax] [--item NAME[,NAME...]] [--out DIR] [--baseline REPORT.json] [--no-structure] [--samples-dir KIT]
//                              [--hooks FILE]... [--catalog FILE] [--syntax FILE] [--jobs N] [--keep] [--quiet]
// Writes OUT/report.json and OUT/report.md (default OUT = tools/racks/out, gitignored). Exit 0 = no failure, 1 = failures, 2 = usage / CLI missing.
// Sources audited: hook defs of the given hooks files (default: site/data/racks/hygiene.json, site/data/phonk/racks*.json, racks*.json of every other pack in site/data),
// site/data/catalog.json recipes, site/data/syntax.json examples. Classes come from tools/racks/targets.json.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const CLI = process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli';
const argv = process.argv.slice(2); const flag = (n) => argv.includes(n); const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const optAll = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
const STD = JSON.parse(fs.readFileSync(path.join(HERE, 'standard.json'), 'utf8')); const TGT = JSON.parse(fs.readFileSync(path.join(HERE, 'targets.json'), 'utf8'));
const OUT = path.resolve(opt('--out', path.join(HERE, 'out'))); const only = (opt('--only', 'racks,catalog,syntax')).split(','); const one = opt('--item', null);
const jobs = +opt('--jobs', Math.max(1, Math.min(4, os.cpus().length))); const structure = !flag('--no-structure'); const quiet = flag('--quiet');
const KIT = path.resolve(opt('--samples-dir', path.join(HERE, 'samples', 'kit'))); // pinned synthesized drum kit (samples/LICENSE.md, CC0): sample-bank recipes render offline
const SR = STD.test.sr, N = STD.test.fft, BIN = SR / N;
if (!fs.existsSync(path.join(CLI, 'strudel'))) { console.error(`strudel CLI not found at ${CLI} (set STRUDEL_CLI)`); process.exit(2); }

// ---------- measurement ----------
export function readWav(file) { // float32 / pcm16 RIFF -> [L, R] Float64Array
  const b = fs.readFileSync(file); let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) { const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }; if (id === 'data') data = b.subarray(p + 8, Math.min(b.length, p + 8 + sz)); p += 8 + sz + (sz & 1); }
  if (!fmt || !data) throw new Error('not a wav: ' + file);
  const bytes = fmt.bits / 8, n = Math.floor(data.length / (bytes * fmt.ch)); const ch = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { const o = (i * fmt.ch + Math.min(c, fmt.ch - 1)) * bytes; ch[c][i] = fmt.tag === 3 ? data.readFloatLE(o) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : data.readInt32LE(o) / 2147483648; }
  return { sr: fmt.sr, L: ch[0], R: ch[1] };
}
function fft(re, im) { // in-place radix-2
  const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b2 = a + len / 2; const xr = re[b2] * cr - im[b2] * ci, xi = re[b2] * ci + im[b2] * cr; re[b2] = re[a] - xr; im[b2] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
// long-term average spectra (Welch, Hann, 50 % overlap): P = mean channel power, M = mid, S = side, per bin
export function ltas(L, R, from = 0, to = L.length) {
  const P = new Float64Array(N / 2 + 1), M = new Float64Array(N / 2 + 1), S = new Float64Array(N / 2 + 1); let frames = 0;
  const lr = new Float64Array(N), li = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N);
  for (let st = from; st < to && (frames === 0 || st + N <= to); st += N / 2) {
    for (let i = 0; i < N; i++) { const k = st + i; const w = HANN[i]; lr[i] = k < to ? L[k] * w : 0; rr[i] = k < to ? R[k] * w : 0; li[i] = 0; ri[i] = 0; }
    fft(lr, li); fft(rr, ri);
    for (let k = 0; k <= N / 2; k++) { const a = lr[k], b = li[k], c = rr[k], d = ri[k]; P[k] += (a * a + b * b + c * c + d * d) / 2; M[k] += ((a + c) ** 2 + (b + d) ** 2) / 4; S[k] += ((a - c) ** 2 + (b - d) ** 2) / 4; }
    frames++;
  }
  return { P, M, S, frames };
}
const db10 = (x) => (x > 1e-30 ? Math.max(-140, 10 * Math.log10(x)) : -140); const db20 = (x) => (x > 1e-15 ? Math.max(-140, 20 * Math.log10(x)) : -140);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const sum = (A, f0, f1) => { let s = 0; const a = Math.max(0, Math.ceil(f0 / BIN)), b = Math.min(A.length - 1, Math.floor(f1 / BIN)); for (let k = a; k <= b; k++) s += A[k]; return s; };
export function measure(wav, band) {
  const { L, R } = wav; const n = L.length; let peak = 0, clip = 0, sl = 0, sr = 0, sll = 0, srr = 0, slr = 0;
  for (let i = 0; i < n; i++) { const a = L[i], b = R[i]; const m = Math.max(Math.abs(a), Math.abs(b)); if (m > peak) peak = m; if (m >= 0.999) clip++; sl += a; sr += b; sll += a * a; srr += b * b; slr += a * b; }
  // gated RMS: 50 ms blocks within 60 dB of the loudest block
  const blk = Math.round(SR * 0.05); const e = []; for (let i = 0; i + blk <= n; i += blk) { let s = 0; for (let j = i; j < i + blk; j++) s += (L[j] * L[j] + R[j] * R[j]) / 2; e.push(s / blk); }
  const top = Math.max(1e-30, ...e); const act = e.filter((x) => x > top * 1e-6); const rms = Math.sqrt(act.reduce((a, b) => a + b, 0) / Math.max(1, act.length));
  const { P, M, S } = ltas(L, R); const nyq = SR / 2; const total = sum(P, 2, nyq) || 1e-30; const lowHz = STD.test.low_mono_hz;
  const o = { seconds: r1(n / SR), peak_db: r1(db20(peak)), rms_db: r1(db20(rms)), crest_db: r1(db20(peak) - db20(rms)), clip, dc_db: r1(db20(Math.max(Math.abs(sl / n), Math.abs(sr / n)))),
    sub20_db: r1(db10(sum(P, 2, 20) / total)), ultra_db: r1(db10(sum(P, STD.global.ultra_hz, nyq) / total)),
    corr: sll > 1e-20 && srr > 1e-20 ? Math.round(slr / Math.sqrt(sll * srr) * 1000) / 1000 : null,
    side_low_db: r1(db10(sum(S, 2, lowHz) / total)) };
  let c = 0, w = 0; for (let k = 1; k < P.length; k++) { c += k * BIN * P[k]; w += P[k]; } o.centroid_hz = Math.round(c / (w || 1));
  // envelope range (gate class, #122): 10 ms RMS windows between the first and last window within 60 dB of the loudest; p95 - p10 in dB. A trance gate
  // must open and close (a sustained pad measures a few dB; a 16-step gate with a 40 ms release measures 20+)
  { const w10 = Math.round(SR * 0.01); const lv = []; for (let i = 0; i + w10 <= n; i += w10) { let s2 = 0; for (let j = i; j < i + w10; j++) s2 += (L[j] * L[j] + R[j] * R[j]) / 2; lv.push(db10(s2 / w10)); }
    const tp = Math.max(...lv); let a0 = lv.findIndex((x) => x > tp - 60), a1 = lv.length - 1; while (a1 > a0 && lv[a1] <= tp - 60) a1--; const act2 = lv.slice(Math.max(0, a0), a1 + 1).sort((x, y) => x - y);
    o.env_range_db = act2.length > 10 ? r1(act2[Math.floor(0.95 * (act2.length - 1))] - act2[Math.floor(0.1 * (act2.length - 1))]) : null; }
  if (band) { const inb = sum(P, band[0], band[1]) || 1e-30; o.below_db = r1(db10(sum(P, 2, band[0] - BIN) / inb)); o.above_db = r1(db10(sum(P, band[1] + BIN, nyq) / inb)); o.inband_pct = r1(100 * inb / total); }
  return o;
}
const midi = (name) => { const m = /^([a-g])([#b]?)(-?\d)$/i.exec(name); const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); return pc + 12 * (+m[3] + 1); };
// aliasing estimate: steady high note; power outside +-2 % (min 6 bins) of every harmonic of f0, relative to the power at the harmonics
export function aliasDb(wav, note) {
  const f0 = 440 * 2 ** ((midi(note) - 69) / 12); const from = Math.round(0.3 * SR), to = Math.min(wav.L.length, Math.round(1.8 * SR)); if (to - from < N / 2) return null;
  const { P } = ltas(wav.L, wav.R, from, to); let harm = 0, rest = 0; const lo = Math.ceil(100 / BIN);
  for (let k = lo; k < P.length; k++) { const f = k * BIN; const h = Math.max(1, Math.round(f / f0)); const tol = Math.max(6 * BIN, 0.02 * h * f0); if (Math.abs(f - h * f0) <= tol) harm += P[k]; else rest += P[k]; }
  return harm > 1e-20 ? r1(db10(rest / harm)) : null;
}
export function judge(m, cls, extra = {}) {
  const C = { ...STD.global, ...(STD.classes[cls] || {}) }; const checks = []; const add = (name, value, limit, ok) => { if (value != null) checks.push({ name, value, limit, ok }); };
  const max = (name, v, lim) => add(name, v, '<= ' + lim, v <= lim); const min = (name, v, lim) => add(name, v, '>= ' + lim, v >= lim);
  if (C.band) { max('below', m.below_db, C.below_max_db); max('above', m.above_db, C.above_max_db); }
  max('sub20', m.sub20_db, C.sub20_max_db); max('ultra', m.ultra_db, C.ultra_max_db); max('dc', m.dc_db, C.dc_max_db); max('clip', m.clip, C.clip_max);
  max('peak', m.peak_db, C.peak_max_db); min('level', m.peak_db, C.peak_min_db); min('crest', m.crest_db, C.crest_min_db);
  if (C.env_range_min_db != null) min('envrange', m.env_range_db, C.env_range_min_db);
  if (m.corr != null) min('corr', m.corr, C.corr_min); if (m.side_low_db != null) max('lowmono', m.side_low_db, C.side_low_max_db);
  if (C.alias && m.alias_db != null) max('alias', m.alias_db, C.alias.max_db);
  if (extra.head != null) add('head', extra.head.found, extra.head.want, extra.head.found === extra.head.want);
  return checks;
}

// ---------- items ----------
// default: the hygiene racks, the phonk racks, then every racks*.json of the other content packs under site/data (a directory with a craftpack.json)
const packRacks = fs.readdirSync(path.join(ROOT, 'site/data')).filter((d) => d !== 'phonk' && fs.existsSync(path.join(ROOT, 'site/data', d, 'craftpack.json'))).sort()
  .flatMap((d) => fs.readdirSync(path.join(ROOT, 'site/data', d)).filter((f) => /^racks.*\.json$/.test(f)).sort().map((f) => `site/data/${d}/${f}`));
const hooksFiles = optAll('--hooks').length ? optAll('--hooks') : ['site/data/racks/hygiene.json', 'site/data/phonk/racks.json', 'site/data/phonk/racks-v2.json', 'site/data/phonk/racks-hiphop.json', ...packRacks].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
const merged = { model: 1, defs: {} }; for (const f of hooksFiles) Object.assign(merged.defs, JSON.parse(fs.readFileSync(f, 'utf8')).defs || {});
const items = [];
if (only.includes('racks')) for (const [name, def] of Object.entries(merged.defs)) {
  const t = TGT.racks[name]; if (!t) { items.push({ kind: 'rack', id: name, cls: null, skip: 'no class in tools/racks/targets.json' }); continue; }
  if (t.skip) { items.push({ kind: 'rack', id: name, cls: t.class || null, skip: t.skip }); continue; }
  const C = STD.classes[t.class]; if (!C) { items.push({ kind: 'rack', id: name, cls: t.class, skip: 'unknown class' }); continue; }
  const pre = `setcpm(${STD.test.cpm})\n` + (C.vox ? "await voxBank('vocalset')\n" : '') + `hooks.bind("x", ${JSON.stringify(t.expr || name)})\n`;
  const head = def.chain && def.chain[0] && def.chain[0][0] === 'hook' ? def.chain[0][1] : 'none';
  items.push({ kind: 'rack', id: name, cls: t.class, code: pre + `$: ${t.phrase || C.phrase}.use("x")\n`, bars: C.bars || 2, vox: !!C.vox,
    alias: C.alias && !t.noalias ? { note: C.alias.note, code: pre + `$: note("${C.alias.note}").use("x").delay(0).room(0)\n` } : null,
    head: structure && TGT.hygiene && t.class !== 'move' && !/^hygiene-/.test(name) ? { found: head, want: 'hygiene-' + t.class } : null });
}
if (only.includes('catalog')) for (const r of JSON.parse(fs.readFileSync(opt('--catalog', path.join(ROOT, 'site/data/catalog.json')), 'utf8')).recipes) {
  const t = TGT.catalog[r.id] || {}; items.push({ kind: 'catalog', id: r.id, cls: t.class || 'demo', code: r.lowered || r.code, bars: t.bars || 2, skip: r.needs_samples && !fs.existsSync(KIT) ? 'needs a sample bank (no --samples-dir kit)' : t.skip });
}
if (only.includes('syntax')) for (const sec of JSON.parse(fs.readFileSync(opt('--syntax', path.join(ROOT, 'site/data/syntax.json')), 'utf8')).sections) for (const ex of sec.examples || []) {
  const id = `${sec.id}/${ex.title}`; const t = TGT.syntax[id] || {}; items.push({ kind: 'syntax', id, cls: t.class || 'demo', code: ex.code, bars: t.bars || 2, skip: typeof ex.code !== 'string' ? 'no code (UI walkthrough)' : t.skip, site: true });
}
const ones = one ? new Set(one.split(',')) : null; const todo = items.filter((i) => !ones || ones.has(i.id)); // --item a,b,c audits several items

// ---------- render ----------
fs.mkdirSync(OUT, { recursive: true }); const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rack-audit-')); const hooksPath = path.join(work, 'hooks.json'); fs.writeFileSync(hooksPath, JSON.stringify(merged));
const TRACK = path.join(ROOT, 'docs/tracks/night-phonk-demo');
function render(code, bars, dir, site) {
  return new Promise((res) => {
    fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'in.strudel.js'); fs.writeFileSync(f, code);
    const args = ['render', f, dir, '--bars', String(bars), '--hooks', hooksPath]; if (fs.existsSync(KIT)) args.push('--samples-dir', KIT); if (site) args.push('--packs', path.join(ROOT, 'site/packs.lock.json'), '--prelude', path.join(TRACK, 'cli-site-base.js'), '--prelude', path.join(ROOT, 'site/prelude/word.js'));
    const p = spawn(path.join(CLI, 'strudel'), args, { env: { ...process.env, STRUDEL_CRAFT: ROOT } }); let err = ''; p.stdout.on('data', (d) => { err += d; }); p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 900000);
    p.on('close', (rc) => { clearTimeout(timer); const w = path.join(dir, 'mix.wav'); res(rc === 0 && fs.existsSync(w) ? { wav: w } : { error: `exit ${rc}: ` + (err.trim().split('\n').filter((l) => /error|Error|not found|E_[A-Z]/.test(l)).pop() || err.trim().split('\n').pop() || '').slice(0, 200) }); });
  });
}
async function runItem(it, idx) {
  if (it.skip) return { ...pub(it), status: 'skip', reason: it.skip };
  const dir = path.join(work, String(idx)); const r = await render(it.code, it.bars, dir, it.site || it.vox);
  if (r.error) return { ...pub(it), status: 'skip', reason: 'not rendered offline: ' + r.error };
  const wav = readWav(r.wav); const C = STD.classes[it.cls] || {}; const m = measure(wav, C.band);
  if (m.peak_db <= -120) { if (!flag('--keep')) fs.rmSync(dir, { recursive: true, force: true }); return { ...pub(it), status: 'skip', reason: 'silent in the offline render' }; }
  if (it.alias) { const a = await render(it.alias.code, 1, path.join(dir, 'alias'), it.vox); if (a.wav) m.alias_db = aliasDb(readWav(a.wav), it.alias.note); }
  const checks = judge(m, it.cls, { head: it.head }); const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  if (!flag('--keep')) fs.rmSync(dir, { recursive: true, force: true });
  return { ...pub(it), status: failed.length ? 'fail' : 'pass', failed, metrics: m, checks };
}
const pub = (it) => ({ kind: it.kind, id: it.id, class: it.cls });
const results = new Array(todo.length); let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => { while (next < todo.length) { const i = next++; results[i] = await runItem(todo[i], i); if (!quiet) process.stderr.write(`${results[i].status.padEnd(4)} ${results[i].kind}:${results[i].id}${results[i].failed?.length ? '  [' + results[i].failed.join(' ') + ']' : ''}${results[i].reason ? '  (' + results[i].reason + ')' : ''}\n`); } }));
if (!flag('--keep')) fs.rmSync(work, { recursive: true, force: true });

// ---------- report ----------
const count = (k, s) => results.filter((r) => (!k || r.kind === k) && r.status === s).length;
const summary = Object.fromEntries(['rack', 'catalog', 'syntax'].map((k) => [k, { pass: count(k, 'pass'), fail: count(k, 'fail'), skip: count(k, 'skip') }])); summary.all = { pass: count(null, 'pass'), fail: count(null, 'fail'), skip: count(null, 'skip') };
const report = { standard: STD.version, structure, hooks: hooksFiles.map((f) => path.relative(ROOT, f)), summary, results };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const base = opt('--baseline', null) ? JSON.parse(fs.readFileSync(opt('--baseline'), 'utf8')) : null; const bmap = new Map((base?.results || []).map((r) => [r.kind + ':' + r.id, r]));
const cols = ['below_db', 'above_db', 'sub20_db', 'ultra_db', 'dc_db', 'peak_db', 'crest_db', 'corr', 'side_low_db', 'alias_db']; const v = (x) => (x == null ? '-' : String(x));
let md = `# Rack audit\n\nStandard v${STD.version} (tools/racks/standard.json, docs/RACK_STANDARD.md). Energy ratios in dB: below / above = outside the class band relative to in-band; sub20 and >18k relative to the total; side<${STD.test.low_mono_hz} = side (L-R) energy below ${STD.test.low_mono_hz} Hz relative to the total; alias = inharmonic relative to harmonic power on a steady high note.\n\n`;
md += `| group | pass | fail | skipped |\n|---|---|---|---|\n` + ['rack', 'catalog', 'syntax', 'all'].map((k) => `| ${k} | ${summary[k].pass} | ${summary[k].fail} | ${summary[k].skip} |`).join('\n') + '\n';
if (base) md += `\nBaseline: ${base.summary.all.pass} pass, ${base.summary.all.fail} fail, ${base.summary.all.skip} skipped.\n`;
for (const k of ['rack', 'catalog', 'syntax']) { const rs = results.filter((r) => r.kind === k); if (!rs.length) continue;
  md += `\n## ${k}\n\n| item | class | below | above | sub20 | >18k | DC | peak | crest | corr | side<${STD.test.low_mono_hz} | alias | result |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rs) { if (r.status === 'skip') { md += `| ${r.id} | ${v(r.class)} | | | | | | | | | | | skipped: ${r.reason} |\n`; continue; }
    const b = bmap.get(r.kind + ':' + r.id)?.metrics; const cell = (c) => (b && b[c] != null && b[c] !== r.metrics[c] ? `${v(b[c])} -> ${v(r.metrics[c])}` : v(r.metrics[c]));
    md += `| ${r.id} | ${r.class} | ${cols.map(cell).join(' | ')} | ${r.status === 'pass' ? 'pass' : 'FAIL: ' + r.failed.join(', ')}${b ? ` (was ${bmap.get(r.kind + ':' + r.id).status}${bmap.get(r.kind + ':' + r.id).failed?.length ? ': ' + bmap.get(r.kind + ':' + r.id).failed.join(', ') : ''})` : ''} |\n`; } }
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(JSON.stringify({ out: OUT, ...summary }));
process.exit(summary.all.fail ? 1 : 0);
