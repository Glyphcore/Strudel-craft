# DAW study: structure statistics from licensed projects

Issues #153 (tools), #154 (sources, profiles); rules #152 docs/RESEARCH_ETHICS.md. Sources found: docs/DAW_STUDY_SOURCES.md. Profiles and
"how to make a similar form" guides: docs/FORM_PROFILES.md.

## 1. What it does
`tools/dawstudy/` reads a DAW project and writes **structure statistics only** (no notes, pitches, patterns, sample audio, names of
tracks, or any copy of the file): tempo, meter, length, sections, layers per bar and per section, track roles, clip lengths, FX chain
types and order, automation targets and shapes, send / bus / sidechain counts, coarse synth ranges (bucketed). A `forms` pass merges the
statistics of one genre into a form profile. Pure Python standard library (gzip, zlib, xml.etree, struct).

```
python3 tools/dawstudy/dawstudy.py stats FILE [--out S.json] [--md S.md] [--prov PROV.json] [--format .mmpz]
python3 tools/dawstudy/dawstudy.py forms DIR_OR_STATS... --genre G --out docs/dawstudy/profiles/G.json [--md G.md]
python3 tools/dawstudy/dawstudy.py check docs/dawstudy          # schema + complete provenance, exit 1 on any invalid file
python3 tools/dawstudy/fetch.py lmms-repo --dirs demos ... --out docs/dawstudy [--delay 120]
python3 tools/dawstudy/test_dawstudy.py                          # synthetic fixtures, one check per format, licence gate, check, forms
```
suno-track-lab wrapper: `engine/dawstudy/run.sh stats|forms|check|fetch|test ...` (STRUDEL_CRAFT, default /home/user/strudel-craft).

## 2. Formats
| format | container | read |
|---|---|---|
| LMMS `.mmp` / `.mmpz` | XML; `.mmpz` = Qt qCompress (4-byte big-endian length + zlib) | head bpm / time signature; tracks type 0 (instrument: plug-in name, FX chain, mixer channel, patterns pos / len in ticks of 192 per bar, notes counted), 1 (beat / bassline: inner tracks play where the bb clips sit; one inner pattern per bb index at pos / 192), 2 (sample clips), 5 / 6 (automation clips: points, progression 0 = step, else linear; target = the tag of the element whose id the clip names); mixer channels (FX chains, sends); envelope / filter data bucketed |
| Ableton Live `.als` | gzip XML | MasterTrack / MainTrack tempo and time signature; MidiTrack / AudioTrack / GroupTrack / ReturnTrack; arrangement clips (Time, CurrentStart, CurrentEnd; MidiNoteEvent counted); devices (tag, plug-in name); sidechain (SideChain OnOff true + RoutedInput); sends (TrackSendHolder > 0); automation (PointeeId -> the parameter that owns AutomationTarget Id; the pre-song default event is dropped); Locators = markers |
| FL Studio `.flp` | FLhd + FLdt event stream | own reader (PyFLP is GPL-3.0, not imported). Event sizes by id range (0-63 byte, 64-127 word, 128-191 dword, 192-255 LEB128 length + data). Ids used: 17 / 18 meter, 66 / 156 tempo, 64 channel, 65 pattern, 192 / 203 channel name, 193 pattern name, 201 plug-in name (an FX-type name goes to the mixer list, else the channel generator), 224 pattern notes (24-byte records counted), 231 playlist items (32- or 28-byte records), 239 track name, 148 / 205 time markers. **Checked only against our synthetic fixture: accuracy on real FL files is UNVERIFIED** (no licensed FLP was found, DAW_STUDY_SOURCES.md) |
| REAPER `.rpp` | text chunks | TEMPO, MARKER, TRACK NAME / ISBUS / AUXRECV, FXCHAIN plug-ins, ITEM POSITION / LENGTH (seconds -> beats at the project tempo; tempo envelopes not followed, UNVERIFIED for tempo changes), MIDI note-ons counted, VOLENV2 / PANENV2 / PARMENV points |
| Ardour `.ardour` | XML | sample positions (Ardour 6) or `a<superclock>` (282240000 / s) / `b<ticks>` (1920 per beat, Ardour 7+); TempoMap; Routes (Processor plug-ins, intsend sends); Playlist regions by orig-track-id; Locations IsMark / IsSection = markers |

## 3. Schema `dawstudy-stats@1`
| key | meaning |
|---|---|
| `tempo`, `meter`, `key` | bpm (first tempo), [num, den], key only when the project declares it (none of the formats read here does) |
| `length_bars`, `length_s` | last clip end, in bars of the meter |
| `tracks.total / with_clips / by_role / by_kind` | role = keyword class of name + plug-in (kick, snare, hat, perc, drums, sub, bass, guitar, vox, lead, pad, keys, fx, other); names are dropped |
| `sections[]` | `{role, start_bar, bars, layers_median, layers_max, roles, source}`; `source: marker` (markers / locators named intro, verse, chorus, build, drop, breakdown, bridge, solo, outro, else other) or `inferred` |
| `density.layers_per_bar` | tracks sounding per bar (a clip covering any part of the bar), `median`, `max`; `notes_per_bar_by_role` median (note counts only) |
| `clip_bars` | histogram of clip lengths in bars |
| `fx.chains[]`, `fx.type_frequency` | per track / bus: device types in order (eq, compressor, multiband, limiter, filter, distortion, reverb, delay, modulation, stereo, gate, pitch_fx, amp_cab, sidechain, gain, other) |
| `automation[]` | `{target, shape, start_bar, end_bar}`; target volume, cutoff, resonance, pan, send, tempo, pitch, wet, mute, macro, other; shape rise, fall, step, lfo (3+ direction changes), curve, flat |
| `tension[]` | builds, drops, breakdowns, fills, switches derived from project data without rendering: `{kind, bar, end_bar?, evidence[], confidence}`. Evidence: automation ramps (cutoff / volume / send / wet / resonance / pitch rise of >= 1 bar = build, its end + 1 = drop candidate when layers rise; a fall = breakdown or fade), fx-role clips (>= 2 bars = riser: build + drop at its end; 1 bar = impact / fill), density steps (+3 layers or x1.5 vs the two bars before = drop; -3 or x0.6 = breakdown), mute / enable steps (switch, i.e. a device or track turned on at a boundary). Each agreeing piece adds confidence (cap 0.95); neighbouring bars of one kind merge |
| `routing` | `buses`, `sends`, `sidechains` (compressor sidechain inputs, peak controllers) |
| `synth_ranges[]` | LMMS envelope times bucketed to 10 ms (the 0..1 -> 5 s mapping is UNVERIFIED across LMMS versions) and filter cut-off to the nearest octave |
| `provenance` | RESEARCH_ETHICS.md section 4; `check` refuses a file without it |

Section inference (no markers, e.g. every LMMS project): the role set active in each 4-bar block; a block whose set differs from the
previous one by Jaccard distance > 0.34 starts a section; sections are labelled by layer density: `intro` (first, below the median),
`outro` (last, below the median), `peak` (mean layers >= 0.8 of the song maximum), `breakdown` (<= 0.5), `body` (between). Inferred labels
describe density, not the author's intent; a profile counts them separately from marker-named sections. Rejected: k-means on bar vectors
(unstable on short songs), 8-bar blocks (misses 4-bar intros, common in the data).

## 4. Form profile `dawstudy-form@1` (`forms`)
n, basis (`measured`; `n < 3` says indicative only), tempo min / median / max, length, median bars and median layers per section role, the
5 most common section orders, role presence (fraction of projects), FX presence, top FX chains by role, top automation target / shape pairs,
median tracks and sends, projects with sidechain, a 20-point density curve (median layers per 5 % of the song), common clip lengths, sources.

## 5. Batch pipeline (at scale; never per track by hand)
```
node tools/dawstudy/batch.mjs MANIFEST.json [--stage 1|2|3|all]      # suno-track-lab: engine/dawstudy/batch.sh MANIFEST (medium load gate)
```
Manifest: `{ "batch", "out", "bank"?, "inputs": [ { "kind": "daw-project", "files"|"dirs", "genre", "provenance"? (else a FILE.prov.json
sidecar per project; none = refused; a licence outside the RESEARCH_ETHICS.md allowlist (by-nc, nd, all rights reserved, unknown, blank) = refused, named, stage 1 exits 3), "render"? }, { "kind": "stats", "dirs" }, { "kind": "audio", "files"|"dirs", "genre", "owner",
"source_kind", "bpm"? }, { "kind": "triage", "dirs" } ] }`.
- Stage 1 collect + hash + normalise: one JSONL record per source in `OUT/records.jsonl` (`{id = sha256, kind, genre, stats | triage}`);
  projects are parsed in place (never copied); audio goes through the triage (section 6). `render: true` on LMMS projects renders with
  the LMMS binary (GPL, a separate program, `lmms --render`) through `engine/load/gate.sh heavy`, triages the WAV, deletes it, and stores a
  `rendered-project` record with boundary agreement (project-data boundaries matched within one bar by audio boundaries). Run on 2026-11-16 with LMMS 1.2.2
  (`lmms render FILE -o OUT.wav -f wav`, `--allowroot` as root): 21 / 21 projects rendered and triaged (FORM_PROFILES.md section 1).
- Stage 2 aggregate per genre: form profiles (`forms`), tension tables (count, median position in the song, median length, evidence ids),
  the most common build evidence, audio section tables -> `OUT/tables.json`, `OUT/profiles/<genre>.json|md`. Re-run on the analysed set: `fetch.py restage --from docs/dawstudy --to SCRATCH` writes the projects and a manifest
  to a scratch dir (sha256 verified), then `batch.mjs SCRATCH/manifest.json`; delete SCRATCH afterwards.
- Stage 3 compact context pack `OUT/pack.json` (`dawstudy-pack@1`, at most 8192 bytes; candidates are dropped, then curves, until it fits,
  `truncated: true`): per genre tempo, bars, top orders, section bars and layers, FX presence, automation, a 10-point density curve, tension;
  concept candidates `named-form`, `layer-ladder`, `transition-grammar`, each with evidence ids (sha256 prefixes). With `bank` the records are
  appended to the form bank (docs/FORM_BANK.md) with per-genre composites.

## 6. Audio triage before stems (own tracks; suno-track-lab)
Stem separation is the expensive step; the mix alone decides where it is worth running.
```
python3 engine/dawstudy/triage.py AUDIO --out T.triage.json [--bpm B --offset S | --audio-model audio_model.json] [--genre G] [--owner H --clip-id ID]
engine/dawstudy/slice_extract.sh T.triage.json... --audio A | --audio-dir D [--separator demucs|none]     # heavy gate, one job at a time
python3 engine/dawstudy/test_triage.py                                                                     # synthetic mix with known form
```
Per bar from the mix: RMS, band energies (sub, low, mid, high), onset count, spectral flux, centroid, roll-off, side / mid width, chroma
change, repetition (best match >= 4 bars away), novelty (4-bar checkerboard on the bar self-similarity matrix). Boundaries: novelty peaks
and single-bar level steps >= 4 dB, each refined to the bar with the largest bar-to-bar feature change, min 4 bars apart. Labels: drop
(within 4 dB of the loudest level and low end present), build (rising high band and centroid, a louder section with low end next: the
noise-sweep signature), intro / outro (first / last, below median), breakdown (3 dB under the median or low end out), body; fill = a flux
spike in a section's last bar. Worth-slicing score per bar: boundaries +-1, the last 2 build bars, the first 2 drop bars, fills, the most
repeated bar of each section; merged into at most `--max-slices` ranges. slice_extract cuts each range (+ half a bar of context), runs
demucs htdemucs on the excerpt only, measures each stem per bar, writes the numbers into the triage file and deletes excerpt and stems.
Suno material: own clips only (`engine/suno/suno.sh pull`, owners.json fail closed); audio stays gitignored, only triage features are kept.
Synthetic check (120 bpm, 44 bars): build 9-16, drop 17-32, breakdown 33-40 found exactly; slices cover bars 16 and 17.

## 7. Concept batcher (compact context)
`.claude/agents/concept-batcher.md` (haiku; Read, Grep, Write). Contract: input = one `pack.json` path (<= 8192 bytes, `dawstudy-pack@1`;
it refuses anything else and never opens records, stats, triage, projects or audio); output = one `concoctions@1` JSON (<= 12 items,
<= 6 KB): `named-form`, `recipe-to-try`, `layer-ladder`, `transition-grammar`, each with our own short name, a spec (sections with bars,
layers per role, transition steps with lengths), evidence ids from the pack only, basis (measured | design call), confidence (<= 0.4 when the
genre has n < 3) and one sentence why; reply one line. Consumers: docs/FORM_PROFILES.md and tools/concepts families. Brief template:
suno-track-lab docs/CONTEXT_PROTOCOL.md.
