#!/usr/bin/env node
// Batch pipeline (docs/DAW_STUDY.md section 5): node tools/dawstudy/batch.mjs MANIFEST.json [--stage 1|2|3|all]
// Stage 1 collect + hash + normalise: every input -> one JSONL record (dawstudy-stats@1 for projects, triage@1 for audio) in OUT/records.jsonl;
// Stage 2 aggregate per genre: form profiles (dawstudy.py forms), FX / automation / tension / density tables -> OUT/tables.json;
// Stage 3 compact context pack: OUT/pack.json (<= 8 KB: tables + concept candidates with evidence ids) for the concept-batcher agent.
// Optional: "bank" in the manifest appends form-bank records (tools/dawstudy/bank.py). Projects are read in place and never copied.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process'
const HERE = path.dirname(new URL(import.meta.url).pathname)
const LAB = process.env.SUNO_LAB || '/home/user/suno-track-lab'
const PACK_MAX = 8192
const args = process.argv.slice(2); const mf = args[0]
if (!mf) { console.error('usage: batch.mjs MANIFEST.json [--stage 1|2|3|all]'); process.exit(2) }
const stage = args.includes('--stage') ? args[args.indexOf('--stage') + 1] : 'all'
const M = JSON.parse(fs.readFileSync(mf, 'utf8')); const base = path.dirname(path.resolve(mf))
const R = p => path.isAbsolute(p) ? p : path.resolve(base, p)
const OUT = R(M.out || `batches/${M.batch}`); fs.mkdirSync(OUT, { recursive: true })
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const py = (script, a) => execFileSync('python3', [path.join(HERE, script), ...a], { encoding: 'utf8', maxBuffer: 64 << 20 })
const walk = (d, re) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name), re) : re.test(e.name) ? [path.join(d, e.name)] : []) : []
const PROJ = /\.(mmpz?|als|flp|rpp|ardour)$/i, AUDIO = /\.(wav|flac|mp3|ogg)$/i
const med = a => { const v = a.filter(x => typeof x === 'number').sort((x, y) => x - y); return v.length ? +(v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2).toFixed(2) : null }
const count = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)

// Project rendered, then analysed: LMMS projects render headlessly with the LMMS binary (GPL, run as a separate program) through the
// heavy load gate; the WAV is triaged and deleted at once. The record links the project stats and reports boundary agreement.
function renderAndTriage(f, s, h, inp) {
  const has = b => { try { execFileSync('sh', ['-c', `command -v ${b}`]); return true } catch { return false } }
  if (!/\.mmpz?$/i.test(f) || !has('lmms')) { console.log(`render skipped for ${path.basename(f)}: ${/\.mmpz?$/i.test(f) ? 'lmms not installed' : 'no headless renderer for this format'}`); return null }
  const wav = path.join(fs.mkdtempSync(path.join(OUT, '.render-')), 'r.wav'); const tj = path.join(OUT, 'triage', h.slice(0, 16) + '.render.triage.json')
  if (!fs.existsSync(path.dirname(wav))) fs.mkdirSync(path.dirname(wav), { recursive: true })
  fs.mkdirSync(path.dirname(tj), { recursive: true })
  try {
    if (!fs.existsSync(wav)) {}
    execFileSync(path.join(LAB, 'engine/load/gate.sh'), ['heavy', '--', 'timeout', '900', 'lmms', ...(process.getuid?.() === 0 ? ['--allowroot'] : []), 'render', f, '-o', wav, '-f', 'wav'], { stdio: 'ignore', env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' } })
    execFileSync('python3', [path.join(LAB, 'engine/dawstudy/triage.py'), wav, '--out', tj, '--bpm', String(s.tempo), '--offset', '0', '--source-kind', 'rendered-project', ...(inp.genre ? ['--genre', inp.genre] : [])], { stdio: 'ignore' })
  } catch (e) { console.log(`render or triage failed for ${path.basename(f)}: ${String(e.message).split('\n')[0]}`) } finally { fs.rmSync(path.dirname(wav), { recursive: true, force: true }) }
  if (!fs.existsSync(tj)) { console.log(`render failed for ${path.basename(f)}`); return null }
  const t = JSON.parse(fs.readFileSync(tj, 'utf8'))
  const pb = s.sections.slice(1).map(x => x.start_bar), tb = t.sections.slice(1).map(x => x.start_bar)
  t.project = { sha256: h, url: s.provenance?.url, licence: s.provenance?.licence, licence_class: s.provenance?.licence_class }
  t.agreement = { project_boundaries: pb, audio_boundaries: tb, matched_within_1_bar: pb.filter(b => tb.some(x => Math.abs(x - b) <= 1)).length, of: pb.length }
  fs.writeFileSync(tj, JSON.stringify(t, null, 1))
  return { id: t.sha256, kind: 'rendered-project', genre: inp.genre || 'untagged', triage: t, project_id: h }
}

function stage1() {
  const recs = []; const seen = new Set()
  const push = r => { if (!seen.has(r.id)) { seen.add(r.id); recs.push(r) } }
  for (const inp of M.inputs || []) {
    const files = [...(inp.files || []).map(R), ...(inp.dirs || []).flatMap(d => walk(R(d), inp.kind === 'audio' ? AUDIO : inp.kind === 'triage' ? /\.triage\.json$/ : inp.kind === 'stats' ? /\.stats\.json$/ : PROJ))]
    for (const f of files) {
      if (inp.kind === 'stats') { const s = JSON.parse(fs.readFileSync(f, 'utf8')); push({ id: s.provenance?.sha256 || sha(fs.readFileSync(f)), kind: 'daw-project', genre: inp.genre || path.basename(path.dirname(f)), stats: s }); continue }
      if (inp.kind === 'triage') { const t = JSON.parse(fs.readFileSync(f, 'utf8')); push({ id: t.sha256, kind: t.source_kind, genre: inp.genre || t.genres?.[0] || 'untagged', triage: t }); continue }
      const h = sha(fs.readFileSync(f))
      if (inp.kind === 'daw-project') {
        const side = f + '.prov.json'; const prov = fs.existsSync(side) ? JSON.parse(fs.readFileSync(side, 'utf8')) : inp.provenance ? { ...inp.provenance, sha256: h, bytes: fs.statSync(f).size, format: path.extname(f).slice(1) } : null
        if (!prov) { console.log(`refused ${path.basename(f)}: no provenance (docs/RESEARCH_ETHICS.md 4)`); continue }
        const pf = path.join(OUT, '.prov.tmp.json'); fs.writeFileSync(pf, JSON.stringify(prov))
        const s = JSON.parse(py('dawstudy.py', ['stats', f, '--prov', pf])); fs.rmSync(pf)
        push({ id: h, kind: 'daw-project', genre: inp.genre || 'untagged', stats: s })
        if (inp.render) { const r = renderAndTriage(f, s, h, inp); if (r) push(r) }
      } else if (inp.kind === 'audio') {
        const tj = path.join(OUT, 'triage', h.slice(0, 16) + '.triage.json'); fs.mkdirSync(path.dirname(tj), { recursive: true })
        const a = [f, '--out', tj, '--source-kind', inp.source_kind || 'suno-playlist-own', ...(inp.genre ? ['--genre', inp.genre] : []), ...(inp.owner ? ['--owner', inp.owner] : []), ...(inp.bpm ? ['--bpm', String(inp.bpm)] : [])]
        execFileSync('python3', [path.join(LAB, 'engine/dawstudy/triage.py'), ...a], { stdio: 'inherit' })
        push({ id: h, kind: inp.source_kind || 'suno-playlist-own', genre: inp.genre || 'untagged', triage: JSON.parse(fs.readFileSync(tj, 'utf8')) })
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'records.jsonl'), recs.map(r => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''))
  console.log(`stage 1: ${recs.length} records -> ${path.join(OUT, 'records.jsonl')}`)
  return recs
}

function stage2(recs) {
  const by = {}; for (const r of recs) (by[r.genre] ||= []).push(r)
  const tables = {}
  for (const [g, rs] of Object.entries(by)) {
    const st = rs.filter(r => r.stats), tr = rs.filter(r => r.triage)
    const t = { n_projects: st.length, n_audio: tr.length }
    if (st.length) {
      const d = path.join(OUT, 'stats', g); fs.mkdirSync(d, { recursive: true })
      for (const r of st) fs.writeFileSync(path.join(d, r.id.slice(0, 16) + '.stats.json'), JSON.stringify(r.stats))
      const pj = path.join(OUT, 'profiles', g + '.json'); fs.mkdirSync(path.dirname(pj), { recursive: true })
      py('dawstudy.py', ['forms', d, '--genre', g, '--out', pj, '--md', pj.replace(/\.json$/, '.md')])
      t.profile = JSON.parse(fs.readFileSync(pj, 'utf8')); fs.rmSync(d, { recursive: true })
      const ten = st.flatMap(r => (r.stats.tension || []).map(e => ({ ...e, src: r.id.slice(0, 12), pos: (e.bar - 1) / Math.max(1, r.stats.length_bars) })))
      t.tension = Object.fromEntries(Object.entries(count(ten.map(e => e.kind))).map(([k, n]) => [k, { n, pos_median: med(ten.filter(e => e.kind === k).map(e => e.pos)), len_median: med(ten.filter(e => e.kind === k && e.end_bar).map(e => e.end_bar - e.bar + 1)), evidence: [...new Set(ten.filter(e => e.kind === k).map(e => e.src))].slice(0, 6) }]))
      t.build_evidence = top(count(ten.filter(e => e.kind === 'build').flatMap(e => e.evidence.map(x => x.replace(/\d+/g, '#')))), 5)
    }
    if (tr.length) {
      const secs = tr.flatMap(r => r.triage.sections.map(s => ({ ...s, src: r.id.slice(0, 12) })))
      t.audio_sections = Object.fromEntries(Object.entries(count(secs.map(s => s.role))).map(([k, n]) => [k, { n, bars_median: med(secs.filter(s => s.role === k).map(s => s.bars)), rms_median: med(secs.filter(s => s.role === k).map(s => s.rms_db)), evidence: [...new Set(secs.filter(s => s.role === k).map(s => s.src))].slice(0, 6) }]))
      t.audio_orders = top(count(tr.map(r => r.triage.sections.map(s => s.role).join(' > '))), 3)
    }
    tables[g] = t
  }
  fs.writeFileSync(path.join(OUT, 'tables.json'), JSON.stringify(tables, null, 1))
  console.log(`stage 2: ${Object.keys(tables).length} genres -> ${path.join(OUT, 'tables.json')}`)
  return tables
}

function stage3(tables) {
  const pack = { schema: 'dawstudy-pack@1', batch: M.batch, rules: 'statistics only; cite evidence ids; label measured vs design call', genres: {}, candidates: [] }
  for (const [g, t] of Object.entries(tables)) {
    const P = t.profile; const e = { n: t.n_projects, audio: t.n_audio }
    if (P) Object.assign(e, { tempo: [P.tempo.min, P.tempo.median, P.tempo.max], bars: P.length_bars.median, orders: P.orders.slice(0, 3), sec_bars: P.section_bars_median, sec_layers: P.layers_median_by_section,
      fx: Object.fromEntries(Object.entries(P.fx_presence).slice(0, 6)), auto: P.automation_top.slice(0, 4), curve: P.density_curve_20.filter((_, i) => i % 2 === 0), tension: Object.fromEntries(Object.entries(t.tension || {}).map(([k, v]) => [k, [v.n, v.pos_median, v.len_median]])) })
    if (t.audio_sections) e.audio_sections = Object.fromEntries(Object.entries(t.audio_sections).map(([k, v]) => [k, [v.n, v.bars_median, v.rms_median]]))
    pack.genres[g] = e
    if (P && P.orders.length) pack.candidates.push({ kind: 'named-form', genre: g, order: P.orders[0][0], support: P.orders[0][1], of: P.n, sec_bars: P.section_bars_median, basis: P.basis, evidence: P.sources.map(s => (s.sha256 || '').slice(0, 12)).slice(0, 6) })
    if (P) { const L = P.layers_median_by_section; const ladder = ['intro', 'verse', 'build', 'body', 'chorus', 'drop', 'peak', 'breakdown', 'outro'].filter(k => k in L).map(k => [k, L[k]]); if (ladder.length >= 2) pack.candidates.push({ kind: 'layer-ladder', genre: g, ladder, evidence: P.sources.map(s => (s.sha256 || '').slice(0, 12)).slice(0, 6) }) }
    if (t.tension?.build) pack.candidates.push({ kind: 'transition-grammar', genre: g, build: [t.tension.build.n, t.tension.build.len_median], drop: t.tension.drop ? [t.tension.drop.n, t.tension.drop.pos_median] : null, how: (t.build_evidence || []).map(x => x[0]), evidence: t.tension.build.evidence })
  }
  let s = JSON.stringify(pack)
  while (Buffer.byteLength(s) > PACK_MAX && pack.candidates.length) { pack.candidates.pop(); pack.truncated = true; s = JSON.stringify(pack) }
  for (const g of Object.keys(pack.genres)) { if (Buffer.byteLength(s) <= PACK_MAX) break; delete pack.genres[g].curve; delete pack.genres[g].auto; pack.truncated = true; s = JSON.stringify(pack) }
  fs.writeFileSync(path.join(OUT, 'pack.json'), s + '\n')
  console.log(`stage 3: pack ${Buffer.byteLength(s)} bytes (max ${PACK_MAX}), ${pack.candidates.length} candidates -> ${path.join(OUT, 'pack.json')}`)
  if (M.bank) {
    const bank = R(M.bank); const tmp = fs.mkdtempSync(path.join(OUT, '.bank-'))
    const recs = fs.readFileSync(path.join(OUT, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    for (const r of recs) {
      const f = path.join(tmp, r.id.slice(0, 16) + '.json'); fs.writeFileSync(f, JSON.stringify(r.stats || r.triage))
      console.log(py('bank.py', [r.stats ? 'from-stats' : 'from-triage', f, '--bank', bank, '--genre', r.genre]).trim())
    }
    for (const g of Object.keys(tables)) console.log(py('bank.py', ['composite', '--bank', bank, '--genre', g]).trim())
    fs.rmSync(tmp, { recursive: true })
  }
}

const recs = stage === '2' || stage === '3' ? fs.readFileSync(path.join(OUT, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : stage1()
if (stage === '1') process.exit(0)
const tables = stage === '3' ? JSON.parse(fs.readFileSync(path.join(OUT, 'tables.json'), 'utf8')) : stage2(recs)
if (stage !== '2') stage3(tables)
