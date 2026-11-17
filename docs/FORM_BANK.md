# Form bank: observations with provenance

Issue #154 (with #153). One JSONL record per observation; features only (no audio, no notes, no melodies); provenance is mandatory.
Store: suno-track-lab `data/form-bank/bank.jsonl` (the working bank, may hold records of the user's own Suno tracks); strudel-craft keeps
**read-only summaries** only, `docs/data/form-bank/summary.json` (counts and medians per genre / form role / method; no source refs, no
owner handles). Records are deduplicated by content hash; a dump over 1 MB is gzipped outside git (`bank.jsonl.gz` under a scratch path)
and only its summary is committed.

## Record
| key | meaning |
|---|---|
| `id` | `fb-` + first 16 hex of sha256 of the canonical record without `id` (sorted keys, compact separators, integral floats as integers); appending an existing id is a no-op |
| `source.kind` | `daw-project` \| `suno-playlist-own` \| `rendered-project` \| `catalog-example` |
| `source.ref` | daw-project: `url`, `page_url`, `sha256`, `licence`, `licence_class`, `accessed`, `title`, `author`; suno: `owner` (must be in data/suno/owners.json), `clip_id`, `sha256`, `path_hash`, `accessed`; composite: a note |
| `picked` | `bars` [first, last] (1-based), `layers` (roles), `stage` (section, tension, triage, slice, composite) |
| `method` | `inferred-from-project-data` \| `project-rendered-then-analysed` \| `analysed-from-audio` (an abstraction of audio, features only) \| `pieced-together` (a composite) |
| `confidence` | 0..1 (markers 0.8, inferred sections 0.5, tension events by agreeing evidence, triage by evidence count, composites by mean x source coverage) |
| `evidence` | short strings (which automation ramp, which density step, which audio feature) |
| `features` | numbers only: bars, layers median / max, position in the song (0..1), tempo, rms, low, flux, centroid, onsets, width, medians for composites |
| `labels` | `form_role` (intro, verse, chorus, build, drop, breakdown, bridge, solo, transition, outro, body, other), `genres` (#120 taxonomy genre words), `section_source` |
| `derived_from` | ids of the observations a composite was pieced together from (must exist in the bank) |

## Rules (enforced by `node tools/dawstudy/validate_bank.mjs BANK [--owners data/suno/owners.json]`)
No audio blobs (no audio / wav / pcm / base64 keys, no RIFF base64, records <= 20 KB); no note data keys (notes, pitch, midi, melody,
velocity, pattern, step positions); external sources carry licence, licence class, URL, sha256 and access date; `suno-playlist-own`
records carry an owner handle that is in owners.json (no owners file = refused, fail closed); a method from the four tags; composites list
`derived_from`; the id equals the content hash. Licences follow docs/RESEARCH_ETHICS.md: `bank.py` append refuses a daw-project record whose licence is not allowed (exit 3, nothing written) and `validate_bank.mjs` rejects one (`licence refused`).

## Commands
```
python3 tools/dawstudy/bank.py from-stats docs/dawstudy/*/*.stats.json --bank B      # genre = the stats file's folder
python3 tools/dawstudy/bank.py from-triage T.triage.json --bank B --genre G
python3 tools/dawstudy/bank.py composite --bank B --genre G [--role drop]
python3 tools/dawstudy/bank.py summary --bank B --out docs/data/form-bank/summary.json
engine/dawstudy/query.sh [--genre G] [--role R] [--method M] [--summary]   # suno-track-lab; `query.sh validate` runs the validator with owners.json
```
