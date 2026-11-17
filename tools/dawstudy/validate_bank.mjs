#!/usr/bin/env node
// Form bank validator (docs/FORM_BANK.md): node tools/dawstudy/validate_bank.mjs BANK.jsonl [--owners OWNERS.json]
// Enforces: schema keys, a method from the four tags, confidence 0..1, form_role, licence for external sources (must be an allowed class: by-nc, nd, all rights reserved, unknown, blank are refused), owner-only for
// suno-playlist-own (owner in owners.json allowed handles; fail closed), derived_from ids exist, no audio blobs, no note data, id = content hash.
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const a = process.argv.slice(2); const file = a[0]
if (!file) { console.error('usage: validate_bank.mjs BANK.jsonl [--owners OWNERS.json]'); process.exit(2) }
const oi = a.indexOf('--owners'); let owners = null
if (oi >= 0) { const o = JSON.parse(fs.readFileSync(a[oi + 1], 'utf8')); owners = new Set((o.allowed || o.handles || o.owners || o).map?.(h => String(h.handle ?? h).toLowerCase()) ?? []) }
const METHODS = new Set(['inferred-from-project-data', 'project-rendered-then-analysed', 'analysed-from-audio', 'pieced-together'])
const KINDS = new Set(['daw-project', 'suno-playlist-own', 'rendered-project', 'catalog-example'])
const ROLES = new Set(['intro', 'verse', 'chorus', 'build', 'drop', 'breakdown', 'bridge', 'solo', 'transition', 'outro', 'body', 'other'])
const NOTE_KEYS = /"(notes?|pitch(es)?|midi|melody|key_number|velocity|step_positions?|pattern)"\s*:/i
const AUDIO = /"(audio|wav|pcm|samples?|blob|b64|base64)"\s*:|data:audio|UklGR/  // UklGR = base64 of "RIFF"
const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v)
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); const ids = new Set(); const errs = []; const recs = []
lines.forEach((l, i) => { try { const r = JSON.parse(l); recs.push([i + 1, r, l]); ids.add(r.id) } catch (e) { errs.push(`line ${i + 1}: not JSON`) } })
// licence allowlist: one source of truth, common.licence_class in tools/dawstudy/common.py; asked once for all records
let licErr = []
try { licErr = JSON.parse(execFileSync('python3', [path.join(path.dirname(new URL(import.meta.url).pathname), 'common.py'), 'licence-check'], { input: JSON.stringify(recs.map(([, r]) => r.source ?? null)), encoding: 'utf8', maxBuffer: 64 << 20 })) }
catch (x) { errs.push('licence check could not run: ' + String(x.message).split('\n')[0]) }
for (const [i, [n, r, l]] of recs.entries()) {
  const e = m => errs.push(`line ${n} ${r.id ?? ''}: ${m}`)
  for (const k of ['id', 'source', 'picked', 'method', 'confidence', 'evidence', 'features', 'labels', 'derived_from']) if (!(k in r)) e('missing ' + k)
  if (!METHODS.has(r.method)) e('method not one of the four tags')
  if (!(r.confidence >= 0 && r.confidence <= 1)) e('confidence outside 0..1')
  if (!KINDS.has(r.source?.kind)) e('source.kind')
  if (!ROLES.has(r.labels?.form_role)) e('labels.form_role')
  const ref = r.source?.ref ?? {}
  if (r.source?.kind === 'daw-project' && !(ref.licence && ref.licence_class)) e('external source without licence / licence_class')
  if (licErr[i]) e('licence refused: ' + licErr[i])
  if (r.source?.kind === 'daw-project' && !(ref.url && ref.sha256 && ref.accessed)) e('external source without url / sha256 / accessed')
  if (r.source?.kind === 'suno-playlist-own') {
    if (!ref.owner) e('suno record without owner handle')
    else if (!owners) e('suno record: pass --owners data/suno/owners.json (owner-only, fail closed)')
    else if (!owners.has(String(ref.owner).toLowerCase())) e('suno owner not in owners.json')
  }
  if (r.method === 'pieced-together' && !(r.derived_from?.length)) e('composite without derived_from')
  for (const d of r.derived_from ?? []) if (!ids.has(d)) e('derived_from id not in bank: ' + d)
  if (NOTE_KEYS.test(l)) e('note data key present')
  if (AUDIO.test(l) || l.length > 20000) e('audio blob or oversized record')
  const { id, ...rest } = r
  const h = 'fb-' + crypto.createHash('sha256').update(canon(rest)).digest('hex').slice(0, 16)
  if (id !== h) e('id is not the content hash')
}
console.log(`${recs.length} records, ${errs.length} problems`); for (const x of errs.slice(0, 50)) console.log('FAIL ' + x)
process.exit(errs.length ? 1 : 0)
