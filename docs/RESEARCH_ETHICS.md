# Research ethics: DAW-project study, sound sources and "inspired by" guides

Owner: `daw-sme`. Decided 2026-11-16 before any DAW-project analysis or industrial / rock / metal sound work (issue linked in the header of
docs/DAW_STUDY.md). This file binds every agent, tool and pack in the repo. When a rule here and a convenience conflict, the rule wins and the
gap is written down as a gap.

## 1. What may be studied (DAW projects)
A project file may be opened by `tools/dawstudy/` only when one of these holds, and the basis is recorded per file (section 4):

| basis | examples | why it is allowed |
|---|---|---|
| open licence that allows adaptation and commercial use | CC0, CC-BY, CC-BY-SA, Free Art Licence, GPL / LGPL / Artistic / MIT / BSD project files | the licence grants study and derivative use; statistics are published with attribution (BY / SA) |
| vendor-bundled demo / template projects whose EULA lets the licensee open them | DAW demo sets that ship with an installed DAW the user owns | the licensee may open them in the DAW; we keep statistics only. Not done in this repo so far: no installer, no account (gaps in docs/DAW_STUDY_SOURCES.md) |
| producer "free project file" releases whose written terms allow study | a release page that says "free to use / learn from" | only when the terms are cited verbatim-short and linked; "free download" alone is not a licence |
| the user's own projects | files the user hands over | the user owns them |

Not allowed: NC (non-commercial) and ND (no-derivatives) Creative Commons variants, "all rights reserved", "copyright", unknown or missing
licences, files re-uploaded by someone who is not the author, leaked or paid projects, anything behind a login wall whose terms forbid
automated access. Why NC / ND are excluded although statistics are facts, not expression: our outputs feed CC0 packs that allow commercial
use, and an ND / NC author has said they do not want derived work; we take the conservative reading. A licence the tool cannot classify
is refused (fail closed).

**The allowlist is one function.** `common.licence_class` in `tools/dawstudy/common.py` is the only allowlist; it returns a class
(`cc0`, `by`, `by-sa`, `fal`, `gpl`, `artistic`, `permissive`) or `None` (refused). Classes: CC0, CC-BY, CC-BY-SA, Free Art Licence, GPL family,
Artistic, and MIT / BSD (`permissive`). The issue text (#152) listed a narrower set as a summary; this table is the decision (owner:
orchestrator, 2026-11-17). Artistic, MIT and BSD are allowed because they permit use, copying and analysis of the work, and we commit no
project file and no audio, only statistics with attribution and the hash. Enforcement (every path calls it, none keeps its own list):
`dawstudy.stats_file` (and `dawstudy.py stats`, exit 3), `batch.mjs` stage 1 (names the refused project, exit 3), `bank.py` append (writes
nothing, exit 3), `fetch.py`, and `validate_bank.mjs` (rejects by-nc, nd, all-rights-reserved, unknown and blank licences with
`licence refused: ...`, and a `licence_class` that does not match the licence text). Tests: `tools/dawstudy/test_dawstudy.py`.

## 2. What is extracted and kept
Structure statistics only (schema in docs/DAW_STUDY.md): tempo, time signature, key when declared, section order and lengths in bars (from
arrangement markers, or from clip-boundary changes when there are none, labelled `inferred`), track / layer counts per section and per bar
(the density curve), track roles by instrument / plug-in type, clip lengths (bars), device / effect chain types and their order, send / bus
topology, sidechain routing, automation targets and coarse shapes (rise / fall / step / LFO-like, start and end in bars), and coarse
synth ranges (ADSR and filter cut-off bucketed to octaves or 10 ms steps).
Never extracted or kept: notes, pitches, melodies, chord voicings, drum patterns (step positions), lyrics, sample audio, sample file
names that identify a commercial pack, plug-in preset dumps, the project file itself or any part of it. The parser reads note data only
to count notes per bar (density) and discards it in the same function; no pitch or position leaves the parser.
Storage: the project file is downloaded into a scratch directory outside the repo, hashed (sha256), parsed, and deleted in the same run
(`tools/dawstudy/fetch.py`); the repo keeps only `docs/dawstudy/<genre>/<id>.stats.json` (statistics + provenance) and the aggregated form
profiles. Test fixtures are tiny synthetic projects written by our own code (`tools/dawstudy/fixtures.py`), never real projects.

## 3. Sounds
- No ripping: no sample is cut from a released track, a stem, a sample pack, a preset library or a DAW's factory content.
- Industrial / mechanical hits, guitar-like voices, drums and FX are made by synthesis in our own code (modal / FM / noise sources,
  resonator banks, comb filters, generated impulses, transient shaping, Karplus-Strong style plucked strings), so they are CC0-1.0 as our
  own work and render in the strudel CLI. Native superdough voices first; AudioWorklet stages (shape, distort, crush, supersaw, tremolo)
  only where they are the sound (docs/RACK_STANDARD.md section 9).
- A recording may be used only if it is CC0-1.0 (not CC-BY, not "royalty free"), with the licence recorded per file (URL, author, access
  date, sha256) in the pack manifest. None is used so far.
- Recipes for sound design are written in our own words; sources that explain techniques (manuals, Sound On Sound, Attack Magazine,
  Ableton Learn, producer interviews and tutorials) are cited by URL and paraphrased, never copied beyond a short quoted phrase.

## 4. Provenance record (one per studied file)
`{ "url", "page_url", "author", "title", "licence" (as written on the source), "licence_class" (cc0|by|by-sa|fal|gpl|...),
"accessed" (ISO date), "sha256", "bytes", "format", "parser", "kept": "statistics only" }`. A stats file without a complete record is
invalid (`tools/dawstudy/check` fails).

## 5. "Inspired by artist A" guides
A guide describes form and approach: section order and typical lengths, layer counts per section, tempo and feel ranges, sound-design
chain types (e.g. "FM source, resampled, distorted, band-split, then re-filtered"), mix and master habits as the artist or credible
sources describe them. It never reproduces a melody, riff, chord progression of a specific song, a rhythm or an arrangement bar-for-bar,
lyrics, or a sound's exact preset. Claims are labelled: `measured` (from statistics in docs/dawstudy/), `producer-reported` (an
interview or tutorial, cited), `design call` (ours), `UNVERIFIED` (believed but not sourced). Artist names are used only to say what
approach a guide describes, never as a promise of a sound-alike.

## 6. Gaps are stated, not filled
If no licensed project exists for a genre, docs/DAW_STUDY_SOURCES.md says "not found" and docs/FORM_PROFILES.md uses producer-reported or
design-call numbers with that label. A number is never presented as measured unless a stats file in docs/dawstudy/ produced it.

## 7. Code and tool licences
External GPL / AGPL tools run as separate binaries; their code is not vendored or imported into our modules. PyFLP (GPL-3.0) is
therefore not imported; `tools/dawstudy/flp.py` is our own reader of the FL Studio event stream written from the container layout
(FLhd / FLdt chunks, event id ranges), cited in docs/DAW_STUDY.md. Strudel stays unmodified (AGPL, CLAUDE.md).
