# Composition: a catalog of design concepts, with recipes and measurable checks

Owner: `daw-sme`. Tracker: Strudel-craft#56. Research behind it: docs/COMPOSITION_RESEARCH.md (producer-reported, cited).
Tools: suno-track-lab `engine/composer` (motif ledger, density, foreshadow, spectrogram scan, feel pick, discord, layer relations, bar clusters).
Workflow: suno-track-lab `.claude/skills/composer/SKILL.md` (copy in `.claude/skills/composer/` here).

This file is the vocabulary for composing a track as design decisions, not as copies. Every concept has an id (`MOT-03`), a definition,
why it works (music and sound science), when to use it, a recipe in our syntax (Craft form: atoms, hooks, lanes, `.groove`, forms as gates
or masks), the generated plain-Strudel form where one exists, a measurable check (what the composer tools report, what to look for in a
spectrogram or band map) and anti-patterns. The catalog part below is generated from `tools/composition/catalog.mjs` by
`node tools/composition/build.mjs`, which also writes `site/data/composition.json` (the Syntax view lists every concept under the folder
`composition/<family>` with Craft / Strudel tabs, tags and the notes).

## 1. Rules that apply to every concept
- **Never infer instruments into user music.** A concept names roles (bass, lead, pad); which instrument fills a role is the user's call.
  Genre words that imply instruments (phonk -> cowbell, 808) are flagged and left out unless asked.
- **Never mask production techniques** (risers, sweeps, builds, drops, automation, filter moves, sidechain, EDM-style dynamics) because they
  are associated with EDM; non-EDM tracks use them too. Exclude only specific outcomes the user named.
- **No ripping.** Research is for understanding components and forms. No melody, sample, stem or arrangement of a specific track is reproduced;
  the example cells here are generic (C minor degrees) and written for this doc. Audio scans are for audio the user owns.
- **Words.** Vocal concepts use vowels and syllables only; lyrics are the user's and never written or changed here.
- **Solo lead by default.** No crowd, choir, gang or stacked harmonies unless asked (suno-track-lab CLAUDE.md).

## 2. How the families fit together
```
brief -> motif seed (MOT) -> section map (ARR, EN) -> density plan (LAY) -> foreshadow plan (FS) -> interplay and migration (INT, XT)
      -> harmony and borrowing (HAR, BOR) -> tension, clashes, resolution (TEN, DIS) -> binding (ASN, CMP, SYN, SND, VOX) -> transitions (TR)
      -> groove and feel (GRV) -> build -> checks (engine/composer) -> refine
```
Prerequisites (concept DAG, docs/CONCEPT_DAG.md): a motif ledger needs events (`strudel events`) or stems (engine/motifs); foreshadow needs the
ledger and a form; density needs a form; feel pick needs scan stats or events; discord needs pitched events or audio.

## 3. Measurable checks (engine/composer, suno-track-lab)
| command | input | reports | concepts |
|---|---|---|---|
| `run.sh ledger SRC OUT --form F` | program or events JSON | motifs M1..Mn: first statement, every statement (bar, layer) and its relation (exact, octave, transposed, sequence, displaced, inverted, retrograde, retro-inverted, augmented, diminished, ornamented, fragment, extension, expanded, compressed, contour), grown-from links, migration across layers, flags (stated once, never returns, single layer), rhythm cells and rhythm echoes, phrases, contour families | MOT, INT, XT, FS-06, CLU-06 |
| `run.sh density SRC OUT --form F [--genre G]` | program, or `--stems DIR` | active layers per bar, roles (core / support / ornament / atmos), band energy per bar, per-section mean vs target, suggestions (add, remove, embellish, subtract, slot) and density.png | LAY, EN, TR, CMP-05 |
| `run.sh foreshadow SRC OUT --form F [--hook Mn]` | program or events | per hook: pre-echo, withheld payoff, callback, planted harmony (PASS / FAIL) with suggestions | FS |
| `run.sh scan AUDIO OUT --bpm B --form F` | audio the user owns | mel spectrogram PNG per section, band map PNG; swing16 / swing8 fitted on the onset envelope (calibrated: max error 0.5 points over 50-66 % at 90-174 bpm), jitter, push, ghosts (snare-band attack per 16th step, hat leakage removed), syncopation, autocorrelation (hemiola hint), half-time | GRV, TEN-03, SND |
| `run.sh feel SRC OUT` | scan.json or a program | ranked feel templates, the import line, nearest groove preset, a measured `.groove({...})` | GRV-07 |
| `run.sh discord SRC OUT [--key K]` | program (or audio) | Sethares roughness per bar and section, clashes and their resolution, interval classes (m2/M7, tritone, cluster), key, borrowed degrees per section, key shifts, chromatic mediants | DIS, BOR, HAR, CLU-01/02 |
| `run.sh layers SRC OUT` / `--stems DIR` | program or stems | per pair: rhythm and envelope rhyme, colour (vowel, filter, source), onset complement, band overlap, length and pan contrast, onset lock over chance (synergy candidates only when positive); stems: MFCC cosine, masking index, ungated K-weighted energy of the sum over the power sum (reinforce / neutral / cancel; disjoint layers read 0 dB), centroid shift | ASN, CMP, SYN |
| `run.sh cluster SRC OUT [--form F] [--min-run 2]` | program or audio | k-means bar labels smoothed so one-bar boundary runs join a neighbour, runs, silhouette, adjusted Rand index vs the form (and with intro = outro) | CLU-05, ARR, TEN-05 |

The density targets (LAY-03) are a design call, stated in engine/composer/README.md and in every DENSITY.md report.

Reading a spectrogram scan: a drop shows energy in sub and bass plus broadband transients; a build shows the low bands thinning and the
presence band rising; a callback shows the hook's horizontal partial lines returning, quieter or lower; a clash shows close parallel lines
(beating) in the mid band; an ear-candy hit is an isolated vertical line at a phrase boundary.

## 4. Ids, folders and tags
Ids are `FAMILY-NN`, stable once published (append, never renumber). Folder `composition/<family>` (motif, interplay, cross-texture,
foreshadow, layering, tension, energy, transition, groove, harmony, borrowing, discordance, assonance, complement, synergy, clustering,
sound-design, vocal-instrument, arrangement). Tags: `composition`, the family folder, technique words shared with the catalog taxonomy
(#120: `call-response`, `sidechain`, `filter-sweep`, `build-drop`, `riser`, `swing`, `human-feel`, `formant`, `four-floor`, `half-time` ...),
`measured` when an engine/composer command checks it, and the lowering status (`lowered`, `craft-runtime`, `plain`).

## 5. Add a concept
1. Append an entry to `tools/composition/catalog.mjs` (fields: fam, id, title, def, why, when, code, check, anti, tags, tool, needs).
2. `node tools/composition/build.mjs` (lowers and verifies the example through the CLI; a failure is listed under `problems`, exit 1).
3. `python3 tools/packs/shim.py`, `node tools/pwa/precache.mjs`; `node tools/composition/build.mjs --check` exits 0.
4. Docs follow code: this file is regenerated; update docs/CONCEPT_DAG.md, site/README.md and the #56 tracker.

## 6. Catalog
<!-- catalog:start (generated by node tools/composition/build.mjs from tools/composition/catalog.mjs; do not edit here) -->

| family | ids | folder |
|---|---|---|
| Motif transformations | MOT-01 .. MOT-11 (11) | composition/motif |
| Interplay | INT-01 .. INT-07 (7) | composition/interplay |
| Cross-textural development | XT-01 .. XT-05 (5) | composition/cross-texture |
| Foreshadowing | FS-01 .. FS-06 (6) | composition/foreshadow |
| Layering and density | LAY-01 .. LAY-08 (8) | composition/layering |
| Tension and release | TEN-01 .. TEN-05 (5) | composition/tension |
| Energy curves | EN-01 .. EN-03 (3) | composition/energy |
| Transitions and dovetails | TR-01 .. TR-07 (7) | composition/transition |
| Groove and feel | GRV-01 .. GRV-07 (7) | composition/groove |
| Harmonic design | HAR-01 .. HAR-04 (4) | composition/harmony |
| Tone borrowing | BOR-01 .. BOR-08 (8) | composition/borrowing |
| Discordance | DIS-01 .. DIS-06 (6) | composition/discordance |
| Assonance and consonance | ASN-01 .. ASN-06 (6) | composition/assonance |
| Complementing | CMP-01 .. CMP-05 (5) | composition/complement |
| Synergy | SYN-01 .. SYN-05 (5) | composition/synergy |
| Clustering | CLU-01 .. CLU-07 (7) | composition/clustering |
| Sound-design layering | SND-01 .. SND-04 (4) | composition/sound-design |
| Vocal as instrument | VOX-01 .. VOX-03 (3) | composition/vocal-instrument |
| Arrangement maps | ARR-01 .. ARR-04 (4) | composition/arrangement |

### Motif transformations

One short cell, many statements: the listener tracks identity through change. Every transformation keeps one property (rhythm, contour, intervals) and changes another.

#### MOT-01 Transposition

- **Definition.** The whole cell moved up or down by a fixed interval; intervals and rhythm are kept.
- **Why it works.** Interval and rhythm patterns are what memory encodes for a melody (contour plus interval), so the cell is recognised at a new pitch; a new register also changes brightness and the chord it sits on.
- **When.** Second half of a 16-bar phrase, a lift into the last drop, answering phrases.
- **Measure.** composer ledger: relation "transposed" (or "octave") to the first statement, with the semitone offset. (engine/composer `ledger`)
- **Anti-patterns.** Transposing every repeat (the listener loses the home pitch); Chromatic transposition that leaves the key by accident (check composer discord, out-of-key share).
- **Tags.** composition, motif, lead, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).scale("C4:minor").s("triangle").hook("hygiene-lead")
$: n(atoms.m).add(n(4)).scale("C4:minor").s("triangle").hook("hygiene-lead").late(1)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(150).lpf(8000)
$: n("0 2 4 3").add(n(4)).scale("C4:minor").s("triangle").hpf(150).lpf(8000).late(1)
```

#### MOT-02 Sequence

- **Definition.** A transposition repeated in steps in consecutive windows (a chain: up a step, up a step).
- **Why it works.** Predictable stepwise displacement creates momentum: the ear extrapolates the next step and the arrival on a stable degree releases it.
- **When.** Builds, pre-drops, bridges; two or three links, then break the chain.
- **Measure.** composer ledger: relation "sequence" (transposed repeat in the next window of the same layer). (engine/composer `ledger`)
- **Anti-patterns.** Sequences longer than 3-4 links (a predictable rosalia tires fast); Sequencing every layer in parallel (all motion, no anchor).
- **Tags.** composition, motif, build, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).add(n("<0 1 2 4>")).scale("C4:minor").s("sawtooth").hook("hygiene-lead").lpf(1800)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").add(n("<0 1 2 4>")).scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).lpf(1800)
```

#### MOT-03 Inversion

- **Definition.** Each interval flips direction (up a third becomes down a third), tonally inside the scale.
- **Why it works.** Contour is the strongest melodic cue; flipping it keeps rhythm and interval sizes, so the cell is related yet heard as an answer.
- **When.** Response phrases, second verse or second drop, counterlines against the original.
- **Measure.** composer ledger: relation "inverted". (engine/composer `ledger`)
- **Anti-patterns.** Inverting a cell whose identity is its rhythm only (no audible change); Real (chromatic) inversion that leaves the key.
- **Tags.** composition, motif, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
atom("mInv", { type: "mini", body: "0 -2 -4 -3" })
$: n(atoms.m).scale("C4:minor").s("triangle").hook("hygiene-lead")
$: n(atoms.mInv).scale("C4:minor").s("triangle").hook("hygiene-lead").late(1)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(150).lpf(8000)
$: n("0 -2 -4 -3").scale("C4:minor").s("triangle").hpf(150).lpf(8000).late(1)
```

#### MOT-04 Retrograde and retro-inversion

- **Definition.** The pitches (and optionally the rhythm) played backwards; retro-inversion also flips intervals.
- **Why it works.** A weaker relation than transposition (memory is forward), so it reads as new material with a family resemblance; good for development sections that must not sound like the hook.
- **When.** Breakdowns, B-sections, turnarounds.
- **Measure.** composer ledger: relation "retrograde" / "retro-inverted". (engine/composer `ledger`)
- **Anti-patterns.** Expecting listeners to recognise retrograde of a long line (only short cells survive).
- **Tags.** composition, motif, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).scale("C4:minor").s("sawtooth").hook("hygiene-pluck")
$: n(atoms.m).rev().scale("C4:minor").s("sawtooth").hook("hygiene-pluck").late(1)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(120).lpf(7000)
$: n("0 2 4 3").rev().scale("C4:minor").s("sawtooth").hpf(120).lpf(7000).late(1)
```

#### MOT-05 Augmentation and diminution

- **Definition.** Note values doubled (augmentation) or halved (diminution); pitches kept.
- **Why it works.** Time-scaling keeps contour and intervals; augmentation reads as weight and calm, diminution as urgency. In half-time genres augmentation turns a drop riff into a pad line.
- **When.** Augment for intros, breakdowns and outro callbacks; diminish in builds and fills.
- **Measure.** composer ledger: relation "augmented" / "diminished" (IOIs x2 / x0.5). (engine/composer `ledger`)
- **Anti-patterns.** Diminution past the 1/16 grid at club tempos (smear); Augmenting into sustained notes that mask the vocal band.
- **Tags.** composition, motif, pad, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).scale("C4:minor").s("triangle").hook("hygiene-lead")
$: n(atoms.m).slow(2).scale("C3:minor").s("supersaw").hook("hygiene-pad").gain(0.3)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(150).lpf(8000)
$: n("0 2 4 3").slow(2).scale("C3:minor").s("supersaw").hpf(180).lpf(6000).gain(0.3)
```

#### MOT-06 Fragmentation

- **Definition.** A piece of the cell (usually its head or tail) repeated on its own.
- **Why it works.** The fragment is cheap to recognise and leaves room; repetition of a fragment builds expectation for the whole.
- **When.** Teasers (FS-01), builds (shorter and shorter fragments), fills.
- **Measure.** composer ledger: relation "fragment" (a contiguous piece of >= 3 notes). (engine/composer `ledger`)
- **Anti-patterns.** Fragments of a cell that has not yet been established and will never come (no payoff).
- **Tags.** composition, motif, build, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).linger("<1 0.5 0.25 0.25>").scale("C4:minor").s("triangle").hook("hygiene-lead")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").linger("<1 0.5 0.25 0.25>").scale("C4:minor").s("triangle").hpf(150).lpf(8000)
```

#### MOT-07 Extension

- **Definition.** The cell continues past its end with new notes (an answer tail), often to reach a cadence.
- **Why it works.** The head keeps identity, the tail adds direction; ending on a stable degree gives closure.
- **When.** The 4th bar of a 4-bar phrase, phrase endings before section changes.
- **Measure.** composer ledger: relation "extension" or a motif "grown from" the first (grown_from). (engine/composer `ledger`)
- **Anti-patterns.** Tails that never resolve (no cadence anywhere in the track).
- **Tags.** composition, motif, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
atom("tail", { type: "mini", body: "2 1 0 -1" })
$: n(cat(atoms.m, atoms.m, atoms.m, atoms.tail)).scale("C4:minor").s("sawtooth").hook("hygiene-lead").lpf(2000)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n(cat("0 2 4 3", "0 2 4 3", "0 2 4 3", "2 1 0 -1")).scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).lpf(2000)
```

#### MOT-08 Rhythmic displacement

- **Definition.** The same cell starting at a different point of the bar (an eighth or a beat later).
- **Why it works.** Metric position changes accent: the same notes against the grid make new syncopation (rhythmic dissonance) without new material.
- **When.** Second half of a drop, switch-ups, tension before a downbeat.
- **Measure.** composer ledger: relation "displaced" (same intervals and rhythm, shifted start); composer feel: syncopation index rises. (engine/composer `ledger`)
- **Anti-patterns.** Displacing the kick or the bass root (the floor loses the one).
- **Tags.** composition, motif, syncopated, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).scale("C4:minor").s("triangle").hook("hygiene-lead")
$: n(atoms.m).late(0.125).scale("C5:minor").s("triangle").hook("hygiene-pluck").gain(0.5)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(150).lpf(8000)
$: n("0 2 4 3").late(0.125).scale("C5:minor").s("triangle").hpf(120).lpf(7000).gain(0.5)
```

#### MOT-09 Interval expansion and compression

- **Definition.** Same contour and rhythm, wider or narrower steps.
- **Why it works.** Contour identity holds while range changes energy: expansion opens (lift), compression tightens (tension, chromatic menace).
- **When.** Expand in the last drop; compress in builds and dark breakdowns.
- **Measure.** composer ledger: relation "expanded" / "compressed" (same contour, larger / smaller interval sum). (engine/composer `ledger`)
- **Anti-patterns.** Expansion past an octave in a lead that must sit in the vocal band.
- **Tags.** composition, motif, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
atom("mWide", { type: "mini", body: "0 4 7 5" })
$: n("<0 1>").pick([atoms.m, atoms.mWide]).scale("C4:minor").s("sawtooth").hook("hygiene-lead")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("<0 1>").pick(["0 2 4 3", "0 4 7 5"]).scale("C4:minor").s("sawtooth").hpf(150).lpf(8000)
```

#### MOT-10 Reharmonization

- **Definition.** The melody kept, the chords under it changed (relative minor, borrowed chord, new bass note).
- **Why it works.** The same melody note gets a new function (root, third, ninth): its colour and stability change while the tune is recognised.
- **When.** Last chorus or drop, breakdowns (sentimental lift), outros.
- **Measure.** composer discord: chord roots per bar change while composer ledger keeps the melody "exact". (engine/composer `discord`)
- **Anti-patterns.** Reharmonising under a vocal hook without checking clashes (minor 2nds against held melody notes).
- **Tags.** composition, motif, harmony, keys, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hook("hygiene-lead")
$: chord("<Cm Cm Ab Ab Fm Fm G G>/2").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(150).lpf(8000)
$: chord("<Cm Cm Ab Ab Fm Fm G G>/2").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### MOT-11 Ornament

- **Definition.** Extra notes around the cell: grace notes, turns, trills, ghosted repeats; the cell notes stay on their steps.
- **Why it works.** Adds detail on repeats without changing identity; the ear hears the frame plus decoration.
- **When.** Embellishment ladder (LAY-05): the 3rd and 4th repeat of a loop.
- **Measure.** composer ledger: relation "ornamented". (engine/composer `ledger`)
- **Anti-patterns.** Ornaments on every note (the frame disappears); Grace notes on the bass at low frequencies (mud).
- **Tags.** composition, motif, accents, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
$: n(atoms.m).off(1/16, x => x.add(n(1)).gain(0.4)).scale("C4:minor").s("triangle").hook("hygiene-pluck")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").off(1/16, x => x.add(n(1)).gain(0.4)).scale("C4:minor").s("triangle").hpf(120).lpf(7000)
```

### Interplay

How two or more lines share time and register: who speaks, who answers, who holds.

#### INT-01 Call and response

- **Definition.** One phrase asks, another answers, in alternating time slots.
- **Why it works.** Turn-taking keeps each voice audible (no masking in time) and sets up a predictable cycle that can then be broken.
- **When.** Riddim and dubstep bass phrases (A/B basses), lead vs vocal chop, hook sections.
- **Measure.** composer layers: high onset_complement between the two lanes and composer ledger shows the answer as a related motif (inverted, transposed). (engine/composer `layers`)
- **Anti-patterns.** Answer louder or busier than the call every time (no hierarchy); Both voices in the same band (they still mask across the seam).
- **Tags.** composition, interplay, call-response, lead, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").mask("<1 0>")
$: n("4 3 1 0").scale("C5:minor").s("triangle").hook("hygiene-pluck").mask("<0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).mask("<1 0>")
$: n("4 3 1 0").scale("C5:minor").s("triangle").hpf(120).lpf(7000).mask("<0 1>")
```

#### INT-02 Counterline

- **Definition.** A second melody that moves against the first: contrary or oblique motion, notes in the first line's rests.
- **Why it works.** Independent contour (contrary motion) is heard as a separate stream (auditory stream segregation); filling rests adds detail without masking.
- **When.** Second half of drops, relief sections, last chorus.
- **Measure.** engine/motifs counterlines (contrary/oblique share); composer layers onset_complement > 0.7. (engine/composer `layers`)
- **Anti-patterns.** Parallel fifths/octaves for long stretches (fuses into one stream); A counterline in the same register as the vocal.
- **Tags.** composition, interplay, lead, counterline, measured, lowered

Craft form:

```js
$: n("0 ~ 2 ~ 4 ~ 3 ~").scale("C4:minor").s("sawtooth").hook("hygiene-lead")
$: n("~ 7 ~ 6 ~ 5 ~ 4").scale("C4:minor").s("triangle").hook("hygiene-pluck").gain(0.5)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 ~ 2 ~ 4 ~ 3 ~").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000)
$: n("~ 7 ~ 6 ~ 5 ~ 4").scale("C4:minor").s("triangle").hpf(120).lpf(7000).gain(0.5)
```

#### INT-03 Hocket

- **Definition.** One line split note by note between two voices or timbres.
- **Why it works.** The ear fuses the line (pitch proximity) while the timbre alternation adds motion and stereo interest.
- **When.** Plucks and bells in breakdowns; stereo ping-pong leads.
- **Measure.** composer layers: onset_complement close to 1 and rhythm_rhyme close to 0 for the pair; pan_contrast > 0.4. (engine/composer `layers`)
- **Anti-patterns.** Hocketing across very different registers (the line breaks into two streams).
- **Tags.** composition, interplay, stereo, pluck, measured, lowered

Craft form:

```js
$: n("0 2 4 3 2 4 5 4").scale("C4:minor").s("triangle").hook("hygiene-pluck").struct("x ~ x ~ x ~ x ~").pan(0.2)
$: n("0 2 4 3 2 4 5 4").scale("C4:minor").s("square").hook("hygiene-pluck").struct("~ x ~ x ~ x ~ x").pan(0.8).gain(0.4)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3 2 4 5 4").scale("C4:minor").s("triangle").hpf(120).lpf(7000).struct("x ~ x ~ x ~ x ~").pan(0.2)
$: n("0 2 4 3 2 4 5 4").scale("C4:minor").s("square").hpf(120).lpf(7000).struct("~ x ~ x ~ x ~ x").pan(0.8).gain(0.4)
```

#### INT-04 Handoff (relay)

- **Definition.** The motif passes from one instrument to another at a section or phrase boundary.
- **Why it works.** Continuity of material with a change of colour: the listener follows the motif, so the arrangement can change around it.
- **When.** Section changes (lead to pluck at the breakdown, pluck to vocal at the hook).
- **Measure.** composer ledger: the motif lists both layers in migration order with no gap bar between them. (engine/composer `ledger`)
- **Anti-patterns.** Handoff with an empty bar in between (the thread drops).
- **Tags.** composition, interplay, transition, lead, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").mask("<1 1 0 0>")
$: n("0 2 4 3").scale("C5:minor").s("triangle").hook("hygiene-pluck").mask("<0 0 1 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).mask("<1 1 0 0>")
$: n("0 2 4 3").scale("C5:minor").s("triangle").hpf(120).lpf(7000).mask("<0 0 1 1>")
```

#### INT-05 Unison and octave doubling

- **Definition.** Two timbres play the same line at the same pitch or octaves apart.
- **Why it works.** Partials of both sounds fuse into one richer timbre (common fate); the octave adds brightness without a new line.
- **When.** Drops (lead + supersaw octave), bass + sub doubling, emphasis on a hook bar.
- **Measure.** composer layers (stems): synergy lufs_gain_db > 0 (coherent), assonance mfcc_cosine high; composer ledger relation "octave". (engine/composer `layers`)
- **Anti-patterns.** Doubling with slight detune at low pitch (beating in the sub, see DIS-03); Doubling everything (density with no new information).
- **Tags.** composition, interplay, lead, layering, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").superimpose(x => x.add(n(7)).s("square").gain(0.3))
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).superimpose(x => x.add(n(7)).s("square").gain(0.3))
```

#### INT-06 Imitation and canon

- **Definition.** A second voice repeats the first after a delay, at the same or another pitch.
- **Why it works.** The echo creates a predictable texture of overlapping copies (delay lines are acoustic canons); at a fifth it implies harmony.
- **When.** Arps, plucks, ambient intros; DnB and progressive layers.
- **Measure.** composer ledger: the same motif in two layers (or one) with "transposed" / "displaced" relations a fixed delay apart. (engine/composer `ledger`)
- **Anti-patterns.** Canon at a tempo-unrelated delay (smear); Imitation in the low end.
- **Tags.** composition, interplay, delay-echo, pluck, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hook("hygiene-pluck").off(1/4, x => x.add(n(4)).gain(0.5))
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(120).lpf(7000).off(1/4, x => x.add(n(4)).gain(0.5))
```

#### INT-07 Pedal and ostinato under melody

- **Definition.** A held or repeated bass note (pedal) or riff (ostinato) while the melody and chords move.
- **Why it works.** A fixed reference makes harmonic motion above it audible as tension (non-chord tones against the pedal) and gives trance-like continuity.
- **When.** Intros, builds (dominant pedal), phonk and techno grooves.
- **Measure.** composer discord: roughness rises when upper chords leave the pedal and falls on return; engine/motifs chord loop over one bass root. (engine/composer `discord`)
- **Anti-patterns.** A pedal under a chord that clashes for many bars without resolution (check unresolved clashes).
- **Tags.** composition, interplay, bass, drone, measured, lowered

Craft form:

```js
$: note("g1*8").s("sawtooth").hook("hygiene-bass").lpf(400)
$: n("<0 2 4 3>*2").scale("G3:minor").s("triangle").hook("hygiene-keys")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("g1*8").s("sawtooth").hpf(40).lpf(3500).lpf(400)
$: n("<0 2 4 3>*2").scale("G3:minor").s("triangle").hpf(80).lpf(7000)
```

### Cross-textural development

The same idea travels between instruments, registers and domains (pitch to rhythm, synth to voice), so a long track stays one piece.

#### XT-01 Motif migration

- **Definition.** The motif is stated by different layers over the track: bass, then lead, pluck, vocal syllable, pad, percussion rhythm.
- **Why it works.** One idea in many colours gives unity with variety; each new texture is a new event even though no new material is added.
- **When.** Long tracks (3+ minutes), extended mixes, any track whose sections risk sounding unrelated.
- **Measure.** composer ledger: one motif with 3+ layers in its migration list. (engine/composer `ledger`)
- **Anti-patterns.** Migration with a different motif in each layer (no thread); Every layer stating the motif at once (no migration, only doubling).
- **Tags.** composition, cross-texture, motif, measured, lowered

Craft form:

```js
atom("m", { type: "mini", body: "0 2 4 3" })
atom("one", { type: "mini", body: "<1 0 0 0>" })
atom("two", { type: "mini", body: "<0 1 0 0>" })
atom("three", { type: "mini", body: "<0 0 1 0>" })
$: n(atoms.m).scale("C2:minor").s("sawtooth").hook("hygiene-bass").mask(atoms.one)
$: n(atoms.m).scale("C4:minor").s("sawtooth").hook("hygiene-lead").mask(atoms.two)
$: n(atoms.m).scale("C5:minor").s("triangle").hook("hygiene-pluck").mask(atoms.three)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C2:minor").s("sawtooth").hpf(40).lpf(3500).mask("<1 0 0 0>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).mask("<0 1 0 0>")
$: n("0 2 4 3").scale("C5:minor").s("triangle").hpf(120).lpf(7000).mask("<0 0 1 0>")
```

#### XT-02 Timbral morphing

- **Definition.** The same notes, with the timbre changing over time (filter, vowel, waveform, FM index).
- **Why it works.** Timbre is a separate perceptual dimension: a slow change of spectral centroid reads as development and energy without new pitches.
- **When.** Long loops (techno, riddim), builds, breakdowns.
- **Measure.** composer scan: spectral centroid / band map changes per bar while composer ledger reports "exact" statements. (engine/composer `scan`)
- **Anti-patterns.** Morphing that ends where it began with no arrival; Morphing several layers in sync (one wash).
- **Tags.** composition, cross-texture, filter-sweep, formant, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C3:minor").s("sawtooth").hook("hygiene-bass").lpf(sine.slow(8).range(300, 3000)).vowel("<a e i o>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C3:minor").s("sawtooth").hpf(40).lpf(3500).lpf(sine.slow(8).range(300, 3000)).vowel("<a e i o>")
```

#### XT-03 Rhythm from pitch

- **Definition.** The motif's rhythm alone, played on an unpitched layer (rim, hat, noise).
- **Why it works.** Rhythm is a strong identity cue; the percussion echo keeps the motif present while the melody rests, and builds anticipation.
- **When.** Builds and intros before the hook (FS-01), breakdowns.
- **Measure.** composer ledger: rhythm_echoes lists the motif and the unpitched layer. (engine/composer `ledger`)
- **Anti-patterns.** A rhythm echo that is an even grid (carries no identity).
- **Tags.** composition, cross-texture, drums, measured, lowered

Craft form:

```js
atom("mr", { type: "mini", body: "x ~ x x ~ x ~ ~" })
$: n("0 ~ 2 4 ~ 3 ~ ~").scale("C4:minor").s("triangle").hook("hygiene-lead").mask("<0 1>")
$: s("white").struct(atoms.mr).decay(0.04).hpf(4000).gain(0.4).mask("<1 0>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 ~ 2 4 ~ 3 ~ ~").scale("C4:minor").s("triangle").hpf(150).lpf(8000).mask("<0 1>")
$: s("white").struct("x ~ x x ~ x ~ ~").decay(0.04).hpf(4000).gain(0.4).mask("<1 0>")
```

#### XT-04 Pitch from rhythm

- **Definition.** A drum or percussion rhythm becomes a melodic line (the hat accents become pluck notes).
- **Why it works.** Binding melody to the groove makes them lock (shared onsets); the melody feels inevitable.
- **When.** Drops, especially percussion-led genres (electro, hyphy, riddim).
- **Measure.** composer layers: rhythm_rhyme close to 1 between the drum lane and the melodic lane. (engine/composer `layers`)
- **Anti-patterns.** Copying a dense hat pattern into a melody (too many notes).
- **Tags.** composition, cross-texture, pluck, measured, lowered

Craft form:

```js
atom("hatAcc", { type: "mini", body: "x ~ ~ x ~ ~ x ~" })
$: s("white").struct(atoms.hatAcc).decay(0.03).hpf(6000).gain(0.4)
$: n("0 3 5").scale("C4:minor").struct(atoms.hatAcc).s("triangle").hook("hygiene-pluck")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("white").struct("x ~ ~ x ~ ~ x ~").decay(0.03).hpf(6000).gain(0.4)
$: n("0 3 5").scale("C4:minor").struct("x ~ ~ x ~ ~ x ~").s("triangle").hpf(120).lpf(7000)
```

#### XT-05 Motif as vocal syllable

- **Definition.** The motif sung on vowels or syllables (no words), or a synthetic vowel playing its pitches.
- **Why it works.** Voice-like formants grab attention (speech sensitivity) and make a synth motif feel human at the hook.
- **When.** Hooks and drops of melodic genres; phonk vocal chops; breakdowns.
- **Measure.** composer layers: shared vowel with another layer (ASN-01); composer ledger: motif in the vox lane. (engine/composer `ledger`)
- **Anti-patterns.** Writing lyrics into the user's track (never infer words); Vowel filters on a sub-bass fundamental (formants sit above 300 Hz).
- **Tags.** composition, cross-texture, vox, formant, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("<a o>").hook("hygiene-vox").lpf(3000)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("<a o>").hpf(150).lpf(8000).lpf(3000)
```

### Foreshadowing

Plant early, pay later: partial statements before the hook, the full hook at the drop, a callback at the end.

#### FS-01 Pre-echo teaser

- **Definition.** A fragment or the rhythm of the drop hook in the intro or build.
- **Why it works.** Exposure creates familiarity; the full statement later is then recognised and rewarding (mere exposure, expectation).
- **When.** Intro bar 5-8, build bars 1-4.
- **Measure.** composer foreshadow: pre_echo PASS (fragment, filtered or rhythm echo before the first drop). (engine/composer `foreshadow`)
- **Anti-patterns.** The full hook at full level in the intro (payoff given away, see FS-04).
- **Tags.** composition, foreshadow, intro-reveal, measured, lowered

Craft form:

```js
atom("hook", { type: "mini", body: "0 2 4 3 2 ~ 0 ~" })
$: n(atoms.hook).linger(0.25).scale("C4:minor").s("triangle").hook("hygiene-pluck").lpf(800).mask("<1 1 0 0>")
$: n(atoms.hook).scale("C4:minor").s("sawtooth").hook("hygiene-lead").mask("<0 0 1 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3 2 ~ 0 ~").linger(0.25).scale("C4:minor").s("triangle").hpf(120).lpf(7000).lpf(800).mask("<1 1 0 0>")
$: n("0 2 4 3 2 ~ 0 ~").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).mask("<0 0 1 1>")
```

#### FS-02 Filtered, reversed or sparse preview

- **Definition.** The hook itself, low-passed, reversed or thinned (degraded), before the drop.
- **Why it works.** Removing brightness or notes keeps identity at lower salience: the listener half-hears it, and the drop "opens" it.
- **When.** Builds (opening filter), the bar before the drop (reversed), intros.
- **Measure.** composer foreshadow: teasers marked "filtered" (lpf < 2 kHz or level < 0.6 x drop); composer scan band map: highs absent before the drop. (engine/composer `foreshadow`)
- **Anti-patterns.** A filter so closed the teaser is inaudible (no exposure).
- **Tags.** composition, foreshadow, filter-sweep, measured, lowered

Craft form:

```js
$: n("0 2 4 3 2 ~ 0 ~").scale("C4:minor").s("sawtooth").hook("hygiene-lead").lpf(sine.slow(4).range(300, 900)).degradeBy(0.4).mask("<1 0>")
$: n("0 2 4 3 2 ~ 0 ~").rev().scale("C4:minor").s("sawtooth").hook("hygiene-lead").hpf(1200).gain(0.3).mask("<0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3 2 ~ 0 ~").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).lpf(sine.slow(4).range(300, 900)).degradeBy(0.4).mask("<1 0>")
$: n("0 2 4 3 2 ~ 0 ~").rev().scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).hpf(1200).gain(0.3).mask("<0 1>")
```

#### FS-03 Planted harmony

- **Definition.** The drop's chord loop sounds early (pad, bass pedal) before the hook melody arrives.
- **Why it works.** The harmonic frame primes the key and the melody's target notes; the hook then lands on expected ground.
- **When.** Intros and breakdowns that lead into a drop.
- **Measure.** composer foreshadow: planted_harmony PASS (drop pitch-class sets found before the first drop). (engine/composer `foreshadow`)
- **Anti-patterns.** New chords only at the drop (the hook arrives on unknown ground).
- **Tags.** composition, foreshadow, harmony, measured, lowered

Craft form:

```js
$: chord("<Cm Ab Eb Bb>").voicing().s("supersaw").hook("hygiene-pad").lpf(700).gain(0.25)
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").mask("<0!4 1!4>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab Eb Bb>").voicing().s("supersaw").hpf(180).lpf(6000).lpf(700).gain(0.25)
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).mask("<0!4 1!4>")
```

#### FS-04 Delayed payoff

- **Definition.** The full, bright, same-layer statement of the hook is withheld until the drop (or a later drop).
- **Why it works.** Anticipation is the source of the reward response; withholding the expected event raises its value when it lands.
- **When.** Every drop-based form; second drops can withhold one more layer.
- **Measure.** composer foreshadow: withheld PASS (no full unfiltered same-layer statement before the first drop). (engine/composer `foreshadow`)
- **Anti-patterns.** Withholding so long the hook never fully arrives; Revealing it in bar 1 of the intro.
- **Tags.** composition, foreshadow, build-drop, gate, measured, craft-runtime

Craft form:

```js
atom("pay", { type: "gate", body: "@3b" })
hooks.bind("open", [["lpf", 6000]], atoms.pay)
hooks.bind("open", [["lpf", 600]], "<3b")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").use("open")
```

Strudel form: none (the binding is gated (it opens at a bar or in a range): gates are evaluated by the Craft runtime as the song plays, plain Strudel has no timeline of bindings).

#### FS-05 Callback and outro return

- **Definition.** The hook (or its seed) returns after the last drop: augmented, filtered or on another layer.
- **Why it works.** Return closes the form (rounded binary logic); the listener leaves with the hook in memory.
- **When.** Outro, last 4-8 bars.
- **Measure.** composer foreshadow: callback PASS (a statement after the last drop or in the last section). (engine/composer `foreshadow`)
- **Anti-patterns.** An outro of new material that never returns to the hook.
- **Tags.** composition, foreshadow, fade-out, measured, lowered

Craft form:

```js
$: n("0 2 4 3").slow(2).scale("C4:minor").s("supersaw").hook("hygiene-pad").lpf(1200).gain(0.3)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").slow(2).scale("C4:minor").s("supersaw").hpf(180).lpf(6000).lpf(1200).gain(0.3)
```

#### FS-06 Return after contrast

- **Definition.** After a contrasting section (breakdown, bridge) the motif returns, often varied (MOT family).
- **Why it works.** Contrast resets habituation, so the return feels fresh; variation on return signals progress.
- **When.** Second drop, last chorus.
- **Measure.** composer ledger: the motif is not flagged "never returns"; a gap of >= 4 bars precedes a later statement. (engine/composer `ledger`)
- **Anti-patterns.** Motifs stated in one section only (ledger flag "never returns").
- **Tags.** composition, foreshadow, motif, form, measured, lowered

Craft form:

```js
$: n("<[0 2 4 3] [~] [0 2 4 3] [0 4 7 5]>").scale("C4:minor").s("sawtooth").hook("hygiene-lead")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("<[0 2 4 3] [~] [0 2 4 3] [0 4 7 5]>").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000)
```

### Layering and density

How many things sound at once, in which roles and frequency slots, and how a loop evolves on each repeat.

#### LAY-01 Detail budget per section

- **Definition.** Plan how many events and layers each section may have, from the energy curve (EN-01).
- **Why it works.** Attention is limited: the ear follows 2-3 streams in focus; detail beyond that becomes texture. A budget keeps the peak sections peaky.
- **When.** Before building: write the budget into the brief, check after each render.
- **Measure.** composer density: mean layers per section inside the role target; suggestions "add" / "remove". (engine/composer `density`)
- **Anti-patterns.** Every section at the same density (flat energy curve); The intro already at drop density.
- **Tags.** composition, layering, form, measured, lowered

Craft form:

```js
atom("intro", { type: "mini", body: "<1 1 0 0 0 0>" })
atom("drop", { type: "mini", body: "<0 0 1 1 1 1>" })
$: s("bd*4").hook("hygiene-kick").mask(atoms.drop)
$: s("hh*8").hook("hygiene-hat").gain(0.4)
$: note("c2*8").s("sawtooth").hook("hygiene-bass").mask(atoms.drop)
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").gain(0.2).mask(atoms.intro)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000).mask("<0 0 1 1 1 1>")
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db").gain(0.4)
$: note("c2*8").s("sawtooth").hpf(40).lpf(3500).mask("<0 0 1 1 1 1>")
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.2).mask("<1 1 0 0 0 0>")
```

#### LAY-02 Layer ladder: core, support, ornament, atmos

- **Definition.** Each layer gets a role: core (beat, bass, hook), support (chords, counterline), ornament (fills, one-shots), atmos (pads, noise, reverb beds).
- **Why it works.** Roles make subtraction decisions easy (remove ornaments first, never the core) and keep the hierarchy readable.
- **When.** Every arrangement; label lanes with tags so selections follow roles.
- **Measure.** composer density: the "roles" map (core, support, ornament, atmos per layer) and the per-bar role counts. (engine/composer `density`)
- **Anti-patterns.** Two core leads fighting for attention; No atmos layer anywhere (dry, small).
- **Tags.** composition, layering, tag, measured, craft-runtime

Craft form:

```js
kick: s("bd*4").hook("hygiene-kick").tags("core")
bass: note("c2*8").s("sawtooth").hook("hygiene-bass").tags("core")
keys: chord("<Cm Ab>").voicing().s("triangle").hook("hygiene-keys").tags("support")
fill: s("~ ~ ~ sd*4").hook("hygiene-snare").tags("ornament").mask("<0 0 0 1>")
air: s("pink").hpf(6000).gain(0.05).tags("atmos")
tagged("ornament | atmos").mute("<2b")
```

Strudel form: none (lane tags and selections (.tags, tagged().mute / solo / fx) choose events by lane while the program plays, through the Craft lane engine; plain Strudel has no tags or selections).

#### LAY-03 Simultaneous layer counts per genre and section

- **Definition.** Target ranges of simultaneous lanes (each drum piece counts) per section role, scaled per genre.
- **Why it works.** Producer-reported norms (COMPOSITION_RESEARCH.md): drops are the fullest section, cloud and riddim stay sparse, big-room and DnB carry more. Design call: intro 2-6, verse 4-9, build 5-10, drop 8-14, breakdown 3-7, outro 2-6 lanes; genre factor cloud 0.6, riddim 0.75, trap 0.85, phonk 0.9, house / dubstep / DnB 1.0, big room 1.1.
- **When.** Planning and checking; override the factor with --genre.
- **Measure.** composer density --genre G: section means against the scaled targets. (engine/composer `density`)
- **Anti-patterns.** Treating the numbers as rules (they are conventions; the brief wins).
- **Tags.** composition, layering, measured, lowered

Craft form:

```js
// the targets live in engine/composer/density.py (TARGETS, GENRE); a sparse riddim drop:
$: s("bd ~ ~ ~ ~ ~ ~ ~, ~ ~ ~ ~ sd ~ ~ ~").hook("hygiene-kick")
$: s("hh*8").hook("hygiene-hat").gain(0.3)
$: note("c1 ~ ~ c1 ~ ~ c1 ~").s("sine").hook("hygiene-sub")
$: note("c2 ~ ~ c2 ~ ~ c2 ~").s("sawtooth").hook("hygiene-growl").lpf(sine.fast(2).range(300, 1500))
```

Strudel form (generated, same events on 4 cycles):

```js
// the targets live in engine/composer/density.py (TARGETS, GENRE); a sparse riddim drop:
$: s("bd ~ ~ ~ ~ ~ ~ ~, ~ ~ ~ ~ sd ~ ~ ~").hpf(30).lpf(7000)
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db").gain(0.3)
$: note("c1 ~ ~ c1 ~ ~ c1 ~").s("sine").hpf(25)
$: note("c2 ~ ~ c2 ~ ~ c2 ~").s("sawtooth").hpf(70).lpf(9000).lpf(sine.fast(2).range(300, 1500))
```

#### LAY-04 Frequency-slot allocation

- **Definition.** Each layer owns a band (sub, bass, low-mid, mid, high-mid, presence, air); at most one owner in sub and two in bass.
- **Why it works.** Simultaneous masking is strongest within a critical band: two sounds in one slot blur; in different slots both stay clear.
- **When.** Sound selection and octave choice before EQ; carve with hpf/lpf after.
- **Measure.** composer density: "slot" suggestions (sub shared by > 1, bass by > 2 layers); composer layers masking_risk; composer scan band map. (engine/composer `density`)
- **Anti-patterns.** Two layers in the sub band without ducking (SYN-01); Every layer full range (no slot left).
- **Tags.** composition, layering, mix, low-end, measured, lowered

Craft form:

```js
$: note("c1*4").s("sine").hook("hygiene-sub")
$: note("c3 eb3 g3 bb3").s("sawtooth").hook("hygiene-keys").hpf(250)
$: note("c5 g5").s("triangle").hook("hygiene-pluck").hpf(1200)
$: s("hh*8").hook("hygiene-hat")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c1*4").s("sine").hpf(25)
$: note("c3 eb3 g3 bb3").s("sawtooth").hpf(80).lpf(7000).hpf(250)
$: note("c5 g5").s("triangle").hpf(120).lpf(7000).hpf(1200)
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db")
```

#### LAY-05 Embellishment ladder per repeat

- **Definition.** Each repeat of a loop adds or changes one small thing: repeat 1 plain, 2 + ornament, 3 + counter-rhythm, 4 + fill.
- **Why it works.** Exact repetition habituates within 2-4 cycles; one change per repeat keeps attention while the loop identity stays.
- **When.** Every 8-16 bar loop in drops and verses.
- **Measure.** composer density: no "embellish" suggestion (same active set for >= 8 bars). (engine/composer `density`)
- **Anti-patterns.** Random variation (probability with no plan); Changing the hook itself on every repeat.
- **Tags.** composition, layering, accents, probability, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hook("hygiene-pluck").sometimesBy("<0 0 0.3 0.6>", x => x.ply(2))
$: s("hh*8").hook("hygiene-hat").gain(0.4).lastOf(4, x => x.fast(2))
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(120).lpf(7000).sometimesBy("<0 0 0.3 0.6>", x => x.ply(2))
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db").gain(0.4).lastOf(4, x => x.fast(2))
```

#### LAY-06 Ear-candy cadence

- **Definition.** Small one-shots (reverse cymbal, vocal chop, delay throw, riser) placed at phrase marks: every 4, 8 or 16 bars.
- **Why it works.** Phrase boundaries are where attention resets; a marker there confirms the grid and rewards listening (producer-reported: once per 8 bars).
- **When.** Drops and verses; fewer in intros (DJ mixing room).
- **Measure.** composer density: ornament-role layers have onsets every 4-8 bars; no "embellish" suggestion. (engine/composer `density`)
- **Anti-patterns.** Ear candy on every bar (it becomes texture); Candy that masks the vocal.
- **Tags.** composition, layering, fx, transition, measured, lowered

Craft form:

```js
$: s("white").attack(0.4).decay(0.05).sustain(0).hpf(3000).gain(0.25).struct("<~ ~ ~ [~ ~ ~ x]>")
$: s("bd*4").hook("hygiene-kick")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("white").attack(0.4).decay(0.05).sustain(0).hpf(3000).gain(0.25).struct("<~ ~ ~ [~ ~ ~ x]>")
$: s("bd*4").hpf(30).lpf(7000)
```

#### LAY-07 Detail by register

- **Definition.** Busy parts high, slow parts low: the bass moves least, the top moves most.
- **Why it works.** Low frequencies need longer to be resolved (fewer cycles per note) and mask more; fast detail is clear only in the highs.
- **When.** Writing parts: check note rates per band.
- **Measure.** composer density + ledger: onset rate per band (sub and bass lanes lowest). (engine/composer `density`)
- **Anti-patterns.** Fast 1/16 basslines with long release (smear).
- **Tags.** composition, layering, low-end, measured, lowered

Craft form:

```js
$: note("c1 ~ ~ ~ c1 ~ ~ ~").s("sine").hook("hygiene-sub")
$: note("c3 ~ eb3 ~").s("sawtooth").hook("hygiene-keys")
$: note("c5 eb5 g5 bb5 c6 bb5 g5 eb5").s("triangle").hook("hygiene-arp").gain(0.3)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c1 ~ ~ ~ c1 ~ ~ ~").s("sine").hpf(25)
$: note("c3 ~ eb3 ~").s("sawtooth").hpf(80).lpf(7000)
$: note("c5 eb5 g5 bb5 c6 bb5 g5 eb5").s("triangle").hpf(150).lpf(8000).gain(0.3)
```

#### LAY-08 Contrast by subtraction

- **Definition.** Energy by removing layers before an arrival: a drop-out bar, a beat of silence, the kick gone for the last bar of the build.
- **Why it works.** Loudness and density are judged relative to what came before (adaptation); a gap makes the return feel larger than adding more would.
- **When.** The bar or beat before each drop; inside drops every 8-16 bars.
- **Measure.** composer density: no "subtract" suggestion before drops; the curve dips in the bar before a drop. (engine/composer `density`)
- **Anti-patterns.** Subtracting the hook (subtract support and ornaments first).
- **Tags.** composition, layering, build-drop, sparse, measured, lowered

Craft form:

```js
atom("gap", { type: "mini", body: "<1 1 1 [1 1 1 0]>" })
$: s("bd*4").hook("hygiene-kick").mask(atoms.gap)
$: note("c2*8").s("sawtooth").hook("hygiene-bass").mask(atoms.gap)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000).mask("<1 1 1 [1 1 1 0]>")
$: note("c2*8").s("sawtooth").hpf(40).lpf(3500).mask("<1 1 1 [1 1 1 0]>")
```

### Tension and release

The grammar of expectation: harmonic, rhythmic, spectral and dynamic tension, and where it lands.

#### TEN-01 Harmonic tension

- **Definition.** Dominant function, leading tones, suspensions and non-chord tones that want to move.
- **Why it works.** Tonal expectation: unstable degrees (7, 4, b2) predict motion to stable ones (1, 3, 5); delaying it holds tension.
- **When.** Pre-drop bars (V or bVII), turnarounds.
- **Measure.** composer discord: the leading tone (raised 7) named in the pre-drop section; roughness peak resolved on the drop downbeat. (engine/composer `discord`)
- **Anti-patterns.** A dominant that never resolves anywhere in the track.
- **Tags.** composition, tension, harmony, measured, lowered

Craft form:

```js
$: chord("<Cm Ab Fm G7>").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
$: n("<[0 2 4 3] [2 4 5 4] [3 5 7 5] [6 5 4 6]>").scale("C4:harmonic minor").s("sawtooth").hook("hygiene-lead")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab Fm G7>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
$: n("<[0 2 4 3] [2 4 5 4] [3 5 7 5] [6 5 4 6]>").scale("C4:harmonic minor").s("sawtooth").hpf(150).lpf(8000)
```

#### TEN-02 Rhythmic tension

- **Definition.** Subdivision acceleration: snare 1/4 -> 1/8 -> 1/16 -> 1/32 rolls, hats doubling, ratchets.
- **Why it works.** Increasing event rate raises arousal and predicts an endpoint (the downbeat).
- **When.** The last 2-8 bars of a build.
- **Measure.** composer density: onsets per bar rising through the build; composer cluster: build bars in their own cluster. (engine/composer `density`)
- **Anti-patterns.** Rolls that run into the drop downbeat (the gap is lost).
- **Tags.** composition, tension, build-drop, crescendo, measured, lowered

Craft form:

```js
$: s("sd").hook("hygiene-snare").fast("<4 8 16 [32 0]>").velocity(saw.range(0.4, 1).slow(4))
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("sd").hpf(120).lpf(10000).ftype("24db").fast("<4 8 16 [32 0]>").velocity(saw.range(0.4, 1).slow(4))
```

#### TEN-03 Spectral tension

- **Definition.** Brightness rises before the arrival: high-pass rising on the mix, low-pass opening on leads, noise risers.
- **Why it works.** Spectral centroid correlates with perceived tension and energy; removing lows (HPF) makes the return of the low end the release.
- **When.** Builds; the whole mix or the music bus, not the kick alone.
- **Measure.** composer scan: band map shows sub and bass falling, presence rising across the build; centroid up. (engine/composer `scan`)
- **Anti-patterns.** Masking production moves because they sound "EDM": risers and filter builds are tools in any genre (user directive).
- **Tags.** composition, tension, filter-sweep, riser, measured, lowered

Craft form:

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").hpf(saw.range(200, 2000).slow(4)).gain(0.25)
$: s("white").hook("hygiene-riser").attack(6).release(0.1).lpf(saw.range(500, 9000).slow(4)).gain(0.2).slow(4)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).hpf(saw.range(200, 2000).slow(4)).gain(0.25)
$: s("white").hpf(150).lpf(12500).ftype("24db").attack(6).release(0.1).lpf(saw.range(500, 9000).slow(4)).gain(0.2).slow(4)
```

#### TEN-04 Dynamic tension: the gap

- **Definition.** Silence or near-silence (a beat or a bar) immediately before the drop.
- **Why it works.** A gap resets loudness adaptation and creates maximal temporal expectation of the downbeat.
- **When.** Before drops; before a beat switch.
- **Measure.** composer density: the last bar before a drop has fewer layers (no "subtract" suggestion). (engine/composer `density`)
- **Anti-patterns.** A gap with a reverb tail filling it completely.
- **Tags.** composition, tension, build-drop, sparse, measured, lowered

Craft form:

```js
atom("lastBeat", { type: "mini", body: "<1 1 1 [1 1 1 0]>" })
$: s("bd*4, hh*8").hook("hygiene-kick").mask(atoms.lastBeat)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4, hh*8").hpf(30).lpf(7000).mask("<1 1 1 [1 1 1 0]>")
```

#### TEN-05 Release grammar

- **Definition.** What happens on the arrival downbeat: impact, sub returns, hook enters, filter fully open, crash.
- **Why it works.** Several cues landing together (cross-modal: low end, brightness, loudness, hook) make the arrival unambiguous.
- **When.** Drop downbeats; chorus downbeats.
- **Measure.** composer cluster: the drop starts a new cluster on its first bar; composer density: the curve jumps at the drop bar. (engine/composer `cluster`)
- **Anti-patterns.** Staggered entries after the downbeat that blur the arrival (unless intended: then make it a pattern).
- **Tags.** composition, tension, build-drop, measured, lowered

Craft form:

```js
$: s("bd*4").hook("hygiene-kick").mask("<0 1>")
$: note("c1").s("sine").hook("hygiene-impact").decay(1.5).struct("<~ x>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").mask("<0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000).mask("<0 1>")
$: note("c1").s("sine").hpf(25).lpf(5000).decay(1.5).struct("<~ x>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).mask("<0 1>")
```

### Energy curves

The macro shape of a track: energy per section and the ramps inside a phrase.

#### EN-01 Macro energy arc

- **Definition.** An energy level 1-10 per section written before building: e.g. intro 3, build 5, drop 9, break 4, build 6, drop 10, outro 3.
- **Why it works.** Contrast between sections drives interest; the second peak higher than the first rewards staying.
- **When.** The brief; the density budget derives from it (LAY-01).
- **Measure.** composer density curve and composer scan band map follow the planned arc; the last drop >= the first. (engine/composer `density`)
- **Anti-patterns.** A flat arc (every section at 8); The highest point in the first 30 seconds.
- **Tags.** composition, energy, form, dynamics, measured, lowered

Craft form:

```js
atom("energy", { type: "mini", body: "<0.3 0.5 0.9 0.4 0.6 1 0.3>" })
$: s("bd*4, hh*8").hook("hygiene-kick").gain(atoms.energy)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4, hh*8").hpf(30).lpf(7000).gain("<0.3 0.5 0.9 0.4 0.6 1 0.3>")
```

#### EN-02 Phrase ramp

- **Definition.** Inside a 8 or 16-bar section, energy rises toward the phrase end (fills, opening filter, added hats).
- **Why it works.** Phrase-level expectation: the end of a hypermetric unit is where change is expected.
- **When.** Every section that leads into another.
- **Measure.** composer density: within-section layer count or onset count rises to the last bar. (engine/composer `density`)
- **Anti-patterns.** Every phrase ending with the same fill (habituates).
- **Tags.** composition, energy, crescendo, measured, lowered

Craft form:

```js
$: s("hh*8").hook("hygiene-hat").gain(saw.range(0.2, 0.6).slow(8))
$: s("~ sd").hook("hygiene-snare").lastOf(8, x => x.ply(4))
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db").gain(saw.range(0.2, 0.6).slow(8))
$: s("~ sd").hpf(120).lpf(10000).ftype("24db").lastOf(8, x => x.ply(4))
```

#### EN-03 False drop

- **Definition.** The build leads to an expected drop, but a different, sparser section (or a second build) arrives instead.
- **Why it works.** Violated expectation is surprising and makes the real drop that follows stronger.
- **When.** Second build; once per track at most.
- **Measure.** composer cluster: the bar after the build belongs to a breakdown-like cluster, the following one to the drop cluster. (engine/composer `cluster`)
- **Anti-patterns.** False drops twice in one track.
- **Tags.** composition, energy, build-drop, form, measured, lowered

Craft form:

```js
$: s("bd*4").hook("hygiene-kick").mask("<1 0 1 1>")
$: note("c2*8").s("sawtooth").hook("hygiene-bass").mask("<0 0 1 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000).mask("<1 0 1 1>")
$: note("c2*8").s("sawtooth").hpf(40).lpf(3500).mask("<0 0 1 1>")
```

### Transitions and dovetails

How one section hands over to the next (docs/CONVENTIONS.md section 6 holds the shipped dt. atoms).

#### TR-01 Pickup fill

- **Definition.** A short fill in the last beat(s) before the new section (snare, toms, 808 slide).
- **Why it works.** Anacrusis: the upbeat points at the downbeat and connects the sections.
- **When.** Every section change; vary the fill per occurrence.
- **Measure.** composer density: an ornament-role onset in the last beat of each section. (engine/composer `density`)
- **Anti-patterns.** The same fill before every section.
- **Tags.** composition, transition, dovetail, measured, lowered

Craft form:

```js
$: s("bd*4").hook("hygiene-kick")
$: s("<~ ~ ~ [~ ~ ~ [sd sd sd sd]]>").hook("hygiene-snare")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000)
$: s("<~ ~ ~ [~ ~ ~ [sd sd sd sd]]>").hpf(120).lpf(10000).ftype("24db")
```

#### TR-02 Riser and impact

- **Definition.** A riser that ends exactly on the downbeat, an impact that starts on it (dt.rise / dt.hit).
- **Why it works.** Continuous pitch / noise rise predicts an endpoint; the impact confirms it.
- **When.** Builds into drops, section changes in cinematic and EDM forms (and any genre that wants them).
- **Measure.** composer scan: presence band rising over the build bars, a broadband onset on the drop bar. (engine/composer `scan`)
- **Anti-patterns.** A riser that stops before the downbeat (dead air) or overruns it.
- **Tags.** composition, transition, riser, measured, lowered

Craft form:

```js
atoms.import("pack:glyphcore/edm:atoms-edm-core")
$: s("white").hook("hygiene-riser").attack(3.5).release(0.05).lpf(saw.range(400, 8000).slow(2)).gain(0.2).struct("<x ~>").slow(2)
$: note("c1").s("sine").hook("hygiene-impact").decay(1.2).struct("<~ ~ x ~>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("white").hpf(150).lpf(12500).ftype("24db").attack(3.5).release(0.05).lpf(saw.range(400, 8000).slow(2)).gain(0.2).struct("<x ~>").slow(2)
$: note("c1").s("sine").hpf(25).lpf(5000).decay(1.2).struct("<~ ~ x ~>")
```

#### TR-03 Drop-out bar

- **Definition.** All or most layers stop for the bar or beat before the new section (see TEN-04).
- **Why it works.** Contrast by subtraction at the seam.
- **When.** Before drops and beat switches.
- **Measure.** composer density: dip in the last bar of the section. (engine/composer `density`)
- **Anti-patterns.** Drop-outs before every section.
- **Tags.** composition, transition, sparse, measured, lowered

Craft form:

```js
$: s("bd*4, hh*8").hook("hygiene-kick").mask("<1 1 1 0>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4, hh*8").hpf(30).lpf(7000).mask("<1 1 1 0>")
```

#### TR-04 Reverse swell

- **Definition.** A reversed tail (reverse cymbal, reversed chord) ending on the downbeat.
- **Why it works.** An amplitude envelope rising into the downbeat is an inverted decay: it reads as anticipation.
- **When.** Into drops and choruses; into a vocal entry.
- **Measure.** composer scan: energy rising through the last bar, ending at the downbeat. (engine/composer `scan`)
- **Anti-patterns.** A swell that ends after the downbeat.
- **Tags.** composition, transition, riser, measured, lowered

Craft form:

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-reverse").attack(1.8).release(0.02).gain(0.25).struct("<~ x>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(200).lpf(12000).ftype("24db").attack(1.8).release(0.02).gain(0.25).struct("<~ x>")
```

#### TR-05 Overlap tail and crossfade

- **Definition.** A layer of the old section rings into the new one, or two layers cross-fade over a bar.
- **Why it works.** Continuity across the seam: the ear follows the overlapping element through the change.
- **When.** Breakdowns into drops (pad tail), section changes in house and DnB.
- **Measure.** composer density: the old layer active in the first bar of the new section. (engine/composer `density`)
- **Anti-patterns.** Long tails in the low band across a drop (mud on the downbeat).
- **Tags.** composition, transition, crossfade, measured, lowered

Craft form:

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").release(3).gain("<0.3 0.15>")
$: note("c2*8").s("sawtooth").hook("hygiene-bass").gain("<0 0.5>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).release(3).gain("<0.3 0.15>")
$: note("c2*8").s("sawtooth").hpf(40).lpf(3500).gain("<0 0.5>")
```

#### TR-06 Delay throw

- **Definition.** One word or note sent to a long delay at a phrase end; the echoes bridge the gap.
- **Why it works.** Echoes keep the last event alive across silence, connecting phrases.
- **When.** Phrase ends, before drops, vocal tags.
- **Measure.** composer scan: energy continuing in the mid band through the gap bar. (engine/composer `scan`)
- **Anti-patterns.** Throws on every phrase.
- **Tags.** composition, transition, delay-echo, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hook("hygiene-pluck").delay("<0 0 0 0.6>").delaytime(0.375).delayfeedback(0.55)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(120).lpf(7000).delay("<0 0 0 0.6>").delaytime(0.375).delayfeedback(0.55)
```

#### TR-07 Turnaround

- **Definition.** The last bar of a loop changes chord or riff so the loop "turns" back to the start.
- **Why it works.** Harmonic rhythm acceleration at the cycle end marks the boundary and drives back to bar 1.
- **When.** 4 and 8-bar loops; hip-hop and house.
- **Measure.** composer discord: a chord change in the last bar of each loop; composer cluster: the turnaround bar forms its own small cluster. (engine/composer `cluster`)
- **Anti-patterns.** Turnarounds on every bar.
- **Tags.** composition, transition, harmony, measured, lowered

Craft form:

```js
$: chord("<Cm Cm Cm [Ab G]>").voicing().s("triangle").hook("hygiene-keys")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Cm Cm [Ab G]>").voicing().s("triangle").hpf(80).lpf(7000)
```

### Groove and feel

Rhythm sequence archetypes and micro-timing: swing, push and pull, ghost notes, polymeter (docs/CONVENTIONS.md sections 4-5).

#### GRV-01 Rhythm sequence archetypes

- **Definition.** Named drum skeletons: four-on-the-floor (house, big room), two-step (DnB), half-time (dubstep, trap, phonk), boom-bap, tresillo 3+3+2, electro broken kick, hyphy bounce.
- **Why it works.** Each archetype sets the metric hierarchy listeners dance to; genre recognition starts from it.
- **When.** Pick one per section; a beat switch changes it (ARR-04).
- **Measure.** composer scan / feel: modal onset pattern, half-time flag, syncopation index. (engine/composer `feel`)
- **Anti-patterns.** Mixing two archetypes in one section by accident (ambiguous downbeat).
- **Tags.** composition, groove, four-floor, half-time, drums, measured, lowered

Craft form:

```js
$: s("bd*4, ~ cp ~ cp, [~ hh]*4").hook("hygiene-kick")  // four-floor
$: s("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~, ~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~").hook("hygiene-kick").mask("<0 1>")  // two-step
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4, ~ cp ~ cp, [~ hh]*4").hpf(30).lpf(7000)  // four-floor
$: s("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~, ~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~").hpf(30).lpf(7000).mask("<0 1>")  // two-step
```

#### GRV-02 Swing

- **Definition.** The second 16th (or 8th) of each pair delayed: 50 % straight, 54-58 % pocket, 66.7 % triplet (pat.groove swing).
- **Why it works.** Long-short pairs create lilt; small swing values are felt rather than heard.
- **When.** Hip-hop, house hats, boom-bap; little or none in big room and riddim.
- **Measure.** composer feel / scan: swing16 within 1-2 % of the target. (engine/composer `feel`)
- **Anti-patterns.** Two swings stacked (pat.groove and swingBy) (they compose); Swinging the kick and not the hats (flam feel).
- **Tags.** composition, groove, swing, human-feel, measured, approx

Craft form:

```js
$: s("hh*16").hook("hygiene-hat").groove({ swing: 57, seed: 1 }).gain(0.4)
$: s("bd ~ ~ bd ~ ~ bd ~, ~ sd").hook("hygiene-kick")
```

Strudel form (generated, approximate: the groove is approximated, the rest has the same events):

```js
$: s("hh*16").hpf(5000).lpf(14500).ftype("24db").swingBy(0.14, 8).gain(0.4)
$: s("bd ~ ~ bd ~ ~ bd ~, ~ sd").hpf(30).lpf(7000)
```

#### GRV-03 Push and pull

- **Definition.** A constant early (push, rush) or late (pull, drag) offset per voice, in % of a 16th.
- **Why it works.** Relative timing between voices sets feel: late snares feel laid back, early hats urgent.
- **When.** Lazy / cloud feels (snare + 5-10 %), bouncy feels (hats - 3 %).
- **Measure.** composer feel / scan: push_high_vs_low_pct16. (engine/composer `feel`)
- **Anti-patterns.** Pushing the whole mix (nothing changes relatively).
- **Tags.** composition, groove, human-feel, swing, measured, approx

Craft form:

```js
$: s("~ sd").hook("hygiene-snare").groove({ push: 8, seed: 2 })
$: s("bd ~ ~ bd").hook("hygiene-kick")
```

Strudel form (generated, approximate: the groove is approximated, the rest has the same events):

```js
$: s("~ sd").hpf(120).lpf(10000).ftype("24db").late(0.005)
$: s("bd ~ ~ bd").hpf(30).lpf(7000)
```

#### GRV-04 Micro-timing (humanize)

- **Definition.** Small per-hit timing spread (jitter 1-5 % of a 16th) and slow drift, seeded and deterministic.
- **Why it works.** Players deviate 5-20 ms; a little variance reads as alive, too much as sloppy.
- **When.** Hats, percussion, keys; not the kick in four-floor genres.
- **Measure.** composer feel / scan: jitter_pct16 within the feel template range. (engine/composer `feel`)
- **Anti-patterns.** Random jitter on the kick and sub (phase smear).
- **Tags.** composition, groove, human-feel, measured, approx

Craft form:

```js
$: s("hh*16").hook("hygiene-hat").groove({ jitter: 3, vel: 0.12, drift: 1, seed: 3 }).gain(0.4)
```

Strudel form (generated, approximate: the groove is approximated, the rest has the same events):

```js
$: s("hh*16").hpf(5000).lpf(14500).ftype("24db").mul(velocity(rand.late(3.37).range(0.88, 1))).late(rand.late(3).range(0, 0.00375).segment(16)).late(perlin.late(3).range(0, 0.00125).slow(4).segment(16)).early(0.0025).gain(0.4)
```

#### GRV-05 Ghost notes

- **Definition.** Quiet notes (velocity 0.1-0.35) between the main hits, mostly snare and hats.
- **Why it works.** Ghosts fill the subdivision grid at low salience: the groove gets motion without changing its accents.
- **When.** Boom-bap, DnB breaks, funk-derived house, phonk.
- **Measure.** composer feel / scan: ghost_share and ghosts_per_bar. (engine/composer `feel`)
- **Anti-patterns.** Ghosts as loud as accents (they stop being ghosts).
- **Tags.** composition, groove, accents, drums, measured, lowered

Craft form:

```js
$: s("~ sd ~ sd").hook("hygiene-snare")
$: s("~ ~ ~ sd ~ ~ sd ~ ~ sd ~ ~ ~ ~ ~ sd").hook("hygiene-snare").velocity(0.22)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("~ sd ~ sd").hpf(120).lpf(10000).ftype("24db")
$: s("~ ~ ~ sd ~ ~ sd ~ ~ sd ~ ~ ~ ~ ~ sd").hpf(120).lpf(10000).ftype("24db").velocity(0.22)
```

#### GRV-06 Polymeter and hemiola

- **Definition.** A cycle of 3 (or 6) against the 4 of the bar: a 3-step riff over 16ths, 3+3+2 groupings.
- **Why it works.** Phase drift between cycles creates moving accents over a stable pulse (realigns every LCM steps).
- **When.** Techno, DnB riffs, trap hats, builds.
- **Measure.** composer scan / feel: hemiola_hint (autocorrelation at lag 3 or 6 beats lag 4 and 8). (engine/composer `feel`)
- **Anti-patterns.** Polymeter on the kick in a dance track (the floor loses the pulse).
- **Tags.** composition, groove, polyrhythm, syncopated, measured, lowered

Craft form:

```js
$: note("c3 eb3 g3").fast(16/3).s("triangle").hook("hygiene-arp").gain(0.4)
$: s("bd*4").hook("hygiene-kick")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c3 eb3 g3").fast(16/3).s("triangle").hpf(150).lpf(8000).gain(0.4)
$: s("bd*4").hpf(30).lpf(7000)
```

#### GRV-07 Picking a feel

- **Definition.** Choose a feel template (feel-boombap, lazy, trap, hyphy, cloud, halftime, ukf, riddim, brostep) from measured or intended stats.
- **Why it works.** A feel is a coherent set of tempo, archetype and groove settings; picking one keeps all voices consistent.
- **When.** At the start, or from a reference you own: composer scan, then composer feel.
- **Measure.** composer feel: ranked feels with distances; the measured .groove line. (engine/composer `feel`)
- **Anti-patterns.** Copying a reference track's pattern (measure feel stats, never transcribe or duplicate).
- **Tags.** composition, groove, feel, measured, approx

Craft form:

```js
setcpm(140/4)
atoms.import("pack:glyphcore/phonk:feel-trap", { as: "feel" })
hooks.bind("kick", atoms.feel.kickRack)
$: s(atoms.feel.kick).velocity(atoms.feel.kickVel).use("kick")
```

Strudel form (generated, approximate: the groove is approximated, the rest has the same events):

```js
setcpm(140/4)
$: s("<[x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~] [x ~ ~ x ~ ~ ~ ~ ~ ~ x ~ ~ ~ x ~]>").velocity("1").hpf(30).lpf(7000).hpf(30).lpf(7000).s("sine").freq(55).penv(36).pdecay(0.04).decay(0.28).sustain(0).noise(0.12).shape(0.4).gain(0.8).hpf(40).mul(velocity(rand.late(1.37).range(0.82, 1))).late(rand.late(1).range(0, 0.001875).segment(16)).early(0.000938)
```

### Harmonic design

Chord loops, voice leading, pedals and harmonic rhythm.

#### HAR-01 Voice leading

- **Definition.** Chord changes with the smallest moves per voice; common tones held.
- **Why it works.** Small moves keep voices as continuous streams; pads sound smooth instead of jumping.
- **When.** Pads, supersaw chords, keys.
- **Measure.** engine/motifs chord loop; pitch moves per voice <= 2 semitones (voicing()). (engine/composer `discord`)
- **Anti-patterns.** Root-position block chords jumping a fifth each change.
- **Tags.** composition, harmony, pad, measured, lowered

Craft form:

```js
$: chord("<Cm7 Abmaj7 Ebmaj7 Bb7>").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm7 Abmaj7 Ebmaj7 Bb7>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### HAR-02 Bass-note pedal

- **Definition.** The bass holds one note while chords change above (I - IV/I - bVII/I).
- **Why it works.** Inverted and slash chords over a pedal give tension and colour with a stable floor.
- **When.** Intros, builds, phonk and techno drones.
- **Measure.** composer discord: one bar root across chord changes; roughness changes per chord. (engine/composer `discord`)
- **Anti-patterns.** A pedal through a whole track with no release.
- **Tags.** composition, harmony, drone, measured, lowered

Craft form:

```js
$: note("c2*4").s("sawtooth").hook("hygiene-bass")
$: chord("<Cm Fm Bb Cm>").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2*4").s("sawtooth").hpf(40).lpf(3500)
$: chord("<Cm Fm Bb Cm>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### HAR-03 Harmonic rhythm

- **Definition.** How often chords change: 1 per 2 bars (house, dubstep), 1 per bar (pop), 2 per bar (turnarounds).
- **Why it works.** Faster harmonic rhythm raises energy and forward motion; slower lets texture and groove lead.
- **When.** Accelerate into a drop or chorus, slow down in breakdowns.
- **Measure.** composer discord / engine/motifs: chord changes per bar per section. (engine/composer `discord`)
- **Anti-patterns.** Changing harmonic rhythm under a vocal phrase mid-line.
- **Tags.** composition, harmony, measured, lowered

Craft form:

```js
$: chord("<Cm Ab Eb Bb>/2").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab Eb Bb>/2").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### HAR-04 Modal colour per genre

- **Definition.** Pick the mode for its colour: Aeolian (most EDM), Dorian (house, liquid), Phrygian (phonk, darker dubstep), harmonic minor (Italo, trance tension).
- **Why it works.** The characteristic degree (natural 6 in Dorian, b2 in Phrygian) carries the mood.
- **When.** At the brief; borrowing (BOR) can mix modes per section.
- **Measure.** composer discord: borrowing names b2 (Phrygian) or natural 6 (Dorian) against the minor key. (engine/composer `discord`)
- **Anti-patterns.** Phrygian b2 against a held natural 2 (unwanted clash).
- **Tags.** composition, harmony, dark, measured, lowered

Craft form:

```js
$: n("0 1 3 4 1 0").scale("C4:phrygian").s("square").hook("hygiene-bell").gain(0.4)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 1 3 4 1 0").scale("C4:phrygian").s("square").hpf(300).lpf(8000).gain(0.4)
```

### Tone borrowing

Borrow pitch material from a parallel mode or key, or timbre, envelope and groove from another layer or genre.

#### BOR-01 Modal interchange (borrowed chords)

- **Definition.** A chord from the parallel mode inside the key: iv, bVI, bVII in major; IV, major V in minor.
- **Why it works.** One altered degree (b6, b7, or a raised 6 / 7) changes colour without leaving the tonic (music theory: mode mixture).
- **When.** Sentimental lifts, pre-choruses, last chords before a drop.
- **Measure.** composer discord: borrowing lists b6 (mixture, bVI / iv) in that section. (engine/composer `discord`)
- **Anti-patterns.** Borrowing every bar (the key stops being clear).
- **Tags.** composition, borrowing, harmony, measured, lowered

Craft form:

```js
$: chord("<C F Fm C>").voicing().s("triangle").hook("hygiene-keys")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<C F Fm C>").voicing().s("triangle").hpf(80).lpf(7000)
```

#### BOR-02 Parallel and relative shifts

- **Definition.** A section in the parallel major/minor (C minor -> C major) or the relative key (C minor -> Eb major).
- **Why it works.** Same tonic, opposite mode (parallel) or same notes, new centre (relative): big mood change with continuity.
- **When.** Breakdowns, bridges, the final drop.
- **Measure.** composer discord: key_shift on the section (or major 3 "parallel major" named). (engine/composer `discord`)
- **Anti-patterns.** Shifting mode under a sustained vocal note that clashes.
- **Tags.** composition, borrowing, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("<C4:minor C4:major>").s("triangle").hook("hygiene-lead")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("<C4:minor C4:major>").s("triangle").hpf(150).lpf(8000)
```

#### BOR-03 Picardy third

- **Definition.** A minor piece ends on a major tonic chord.
- **Why it works.** The raised third surprises at the cadence and reads as release or hope.
- **When.** Outros, the last chord of a breakdown.
- **Measure.** composer discord: "major 3 (Picardy / parallel major)" in the last section. (engine/composer `discord`)
- **Anti-patterns.** Using it on every loop (it becomes the key).
- **Tags.** composition, borrowing, bright, measured, lowered

Craft form:

```js
$: chord("<Cm Fm G C>").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Fm G C>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### BOR-04 Chromatic mediants

- **Definition.** Chords a third apart that share at most one tone (C major -> E major, Cm -> Ab with a major-third root move and borrowed quality).
- **Why it works.** Large colour shift with smooth common-tone voice leading: cinematic and "lift" effect.
- **When.** Section seams, trailer-like moments, melodic dubstep breakdowns.
- **Measure.** composer discord: chromatic_mediants list. (engine/composer `discord`)
- **Anti-patterns.** Mediant shifts under a modal vocal melody.
- **Tags.** composition, borrowing, harmony, measured, lowered

Craft form:

```js
$: chord("<Cm E Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm E Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### BOR-05 Key-shift lift

- **Definition.** The last chorus or drop moves up (often 1 or 2 semitones; a fourth or fifth for a broader lift).
- **Why it works.** Raised pitch raises brightness and arousal; the familiar hook in a new key feels like a lift.
- **When.** The final hook; once per track.
- **Measure.** composer discord: key_shift with lift_semitones in the last drop; composer ledger: "transposed" statements there. (engine/composer `discord`)
- **Anti-patterns.** A lift without preparation (pivot chord or gap).
- **Tags.** composition, borrowing, build-drop, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("<C4:minor C4:minor D4:minor D4:minor>").s("sawtooth").hook("hygiene-lead")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("<C4:minor C4:minor D4:minor D4:minor>").s("sawtooth").hpf(150).lpf(8000)
```

#### BOR-06 Timbre borrowing

- **Definition.** Take the timbre of one layer for another: neuro growl formants on a pad, a vocal formant on the bass, bell FM on a pluck.
- **Why it works.** Shared spectral envelope across layers binds them (ASN) and makes a new colour from known material.
- **When.** Drops of bass genres; breakdowns that reuse the drop's colour softly.
- **Measure.** composer layers: shared vowel or high MFCC cosine (stems) between the two layers. (engine/composer `layers`)
- **Anti-patterns.** Borrowing a timbre into the same band (masking instead of binding).
- **Tags.** composition, borrowing, formant, measured, lowered

Craft form:

```js
$: note("c2*4").s("sawtooth").hook("hygiene-bass").vowel("o")
$: chord("<Cm Ab>").voicing().s("sawtooth").hook("hygiene-pad").vowel("o").gain(0.2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2*4").s("sawtooth").hpf(40).lpf(3500).vowel("o")
$: chord("<Cm Ab>").voicing().s("sawtooth").hpf(180).lpf(6000).vowel("o").gain(0.2)
```

#### BOR-07 Groove and envelope borrowing

- **Definition.** One layer takes another layer's rhythm or envelope (the hat rhythm on a pluck, the kick envelope on a pad via sidechain), or a genre feel on a new style.
- **Why it works.** Shared onsets and envelopes lock layers into one groove (common fate).
- **When.** Drops; genre blends (hyphy feel under a house chord).
- **Measure.** composer layers: rhythm_rhyme / envelope_rhyme high for the pair. (engine/composer `layers`)
- **Anti-patterns.** Borrowing a groove that fights the main archetype.
- **Tags.** composition, borrowing, groove, measured, lowered

Craft form:

```js
atom("hats", { type: "mini", body: "~ x ~ x ~ x ~ x" })
$: s("hh").struct(atoms.hats).hook("hygiene-hat").gain(0.4)
$: n("0 2 4 2").scale("C5:minor").struct(atoms.hats).s("triangle").hook("hygiene-pluck")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("hh").struct("~ x ~ x ~ x ~ x").hpf(5000).lpf(14500).ftype("24db").gain(0.4)
$: n("0 2 4 2").scale("C5:minor").struct("~ x ~ x ~ x ~ x").s("triangle").hpf(120).lpf(7000)
```

#### BOR-08 Harmonic skeleton borrowing

- **Definition.** A section reuses another section's chord loop or bass skeleton with new material on top.
- **Why it works.** Continuity of harmony makes contrasting melodies belong to one piece.
- **When.** Breakdowns over the drop loop; verses over the hook chords.
- **Measure.** composer foreshadow: planted_harmony; composer discord: same roots per bar in both sections. (engine/composer `foreshadow`)
- **Anti-patterns.** Different loops in every section (no harmonic identity).
- **Tags.** composition, borrowing, harmony, measured, lowered

Craft form:

```js
atom("loop", { type: "mini", body: "<Cm Ab Eb Bb>" })
$: chord(atoms.loop).voicing().s("supersaw").hook("hygiene-pad").gain(0.2).mask("<1 1 0 0>")
$: chord(atoms.loop).voicing().s("triangle").hook("hygiene-keys").struct("x ~ x x").mask("<0 0 1 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab Eb Bb>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.2).mask("<1 1 0 0>")
$: chord("<Cm Ab Eb Bb>").voicing().s("triangle").hpf(80).lpf(7000).struct("x ~ x x").mask("<0 0 1 1>")
```

### Discordance

Intentional clashes (minor seconds, tritones, clusters, beating unisons) placed where tension is the point, and resolved on purpose.

#### DIS-01 Minor-second and tritone stabs

- **Definition.** Short stabs whose voicing contains a minor 2nd, major 7th or tritone.
- **Why it works.** Partials within a critical band beat and roughen (Plomp-Levelt); short duration keeps the roughness a hit, not a texture.
- **When.** Dark drops, industrial dubstep, phonk bells (the cowbell's near-tritone partials), horror tints.
- **Measure.** composer discord: interval classes m2/M7, tritone in the section; roughness peaks on the stabs. (engine/composer `discord`)
- **Anti-patterns.** Sustained clashes under a vocal (unintended "out of tune").
- **Tags.** composition, discordance, dark, stab, measured, lowered

Craft form:

```js
$: note("<[c4,gb4] [c4,db4]>").s("square").hook("hygiene-stab").decay(0.12).sustain(0).struct("x ~ ~ x ~ ~ x ~")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("<[c4,gb4] [c4,db4]>").s("square").hpf(120).lpf(8000).decay(0.12).sustain(0).struct("x ~ ~ x ~ ~ x ~")
```

#### DIS-02 Cluster stabs

- **Definition.** Three or more adjacent scale tones at once (c-d-eb), short.
- **Why it works.** Maximum roughness per event; reads as a percussive, metallic hit.
- **When.** Impacts, industrial textures, builds.
- **Measure.** composer discord: interval class "cluster"; roughness x2+ the section median on the hit bars. (engine/composer `discord`)
- **Anti-patterns.** Low clusters (below ~200 Hz: mud, not bite).
- **Tags.** composition, discordance, clustering, measured, lowered

Craft form:

```js
$: note("[c4,d4,eb4]").s("sawtooth").hook("hygiene-stab").decay(0.1).sustain(0).struct("<x ~ ~ ~>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("[c4,d4,eb4]").s("sawtooth").hpf(120).lpf(8000).decay(0.1).sustain(0).struct("<x ~ ~ ~>")
```

#### DIS-03 Detuned unison beating

- **Definition.** Two or more copies of a voice detuned by a few cents (supersaw, reese).
- **Why it works.** Beating at the frequency difference gives motion and width; at low pitch it becomes audible pulsing.
- **When.** Reese basses (DnB, neuro), supersaw chords; keep the sub itself clean.
- **Measure.** composer discord: roughness counts detuned copies (unison, detune); composer layers stems: the sub stem stays clean (no beating under 60 Hz). (engine/composer `discord`)
- **Anti-patterns.** Detuning the sub (phase cancellation, mono collapse).
- **Tags.** composition, discordance, bass, reese, measured, lowered

Craft form:

```js
$: note("c2").s("supersaw").unison(2).detune(0.3).hook("hygiene-reese").lpf(1200).struct("x@3 ~")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2").s("supersaw").unison(2).detune(0.3).hpf(30).lpf(5000).lpf(1200).struct("x@3 ~")
```

#### DIS-04 Bitonal layers

- **Definition.** Two layers in keys a tritone or semitone apart for a short span.
- **Why it works.** Two tonal centres compete; the ear cannot settle: strong unease, best brief.
- **When.** Horror tints, the last bars of an industrial build.
- **Measure.** composer discord: per-section key fit drops; out-of-key share rises in that section only. (engine/composer `discord`)
- **Anti-patterns.** Bitonality for whole sections without intent.
- **Tags.** composition, discordance, tense, measured, lowered

Craft form:

```js
$: n("0 2 4").scale("C4:minor").s("triangle").hook("hygiene-pluck")
$: n("0 2 4").scale("F#3:minor").s("sawtooth").hook("hygiene-lead").gain(0.3).mask("<0 0 0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4").scale("C4:minor").s("triangle").hpf(120).lpf(7000)
$: n("0 2 4").scale("F#3:minor").s("sawtooth").hpf(150).lpf(8000).gain(0.3).mask("<0 0 0 1>")
```

#### DIS-05 Dissonance-to-resolution timing

- **Definition.** Place the clash on a weak or pre-arrival position and resolve on the downbeat (appoggiatura logic).
- **Why it works.** Tension then release; an unresolved clash reads as error, a resolved one as intent.
- **When.** Pre-drop bars, phrase ends.
- **Measure.** composer discord: every clash has resolved_at within 2 bars; unresolved list empty (or intended). (engine/composer `discord`)
- **Anti-patterns.** Clashes left hanging at section ends.
- **Tags.** composition, discordance, tension, measured, lowered

Craft form:

```js
$: chord("<[c4,db4,g4] [c4,eb4,g4]>").s("supersaw").hook("hygiene-pad").gain(0.25)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<[c4,db4,g4] [c4,eb4,g4]>").s("supersaw").hpf(180).lpf(6000).gain(0.25)
```

#### DIS-06 Roughness as sound design

- **Definition.** Distortion, FM and ring-style sidebands that create inharmonic, rough spectra (wet industrial, growls).
- **Why it works.** Inharmonic partials close together raise sensory roughness; it reads as aggression and grit.
- **When.** Growl and riddim basses, industrial dubstep, phonk distortion; keep the sub separate.
- **Measure.** composer discord --audio on the stem: roughness per bar; composer scan band map: grit above 200 Hz, a clean sub band. (engine/composer `discord`)
- **Anti-patterns.** Distorting the sub with the growl (one band split first, SND-02).
- **Tags.** composition, discordance, growl, fm, measured, lowered

Craft form:

```js
$: note("c2 ~ c2 ~").s("sawtooth").hook("hygiene-growl").fm(3).fmh(1.41).distort(2).lpf(2000)
$: note("c1 ~ c1 ~").s("sine").hook("hygiene-sub")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2 ~ c2 ~").s("sawtooth").hpf(70).lpf(9000).fm(3).fmh(1.41).distort(2).lpf(2000)
$: note("c1 ~ c1 ~").s("sine").hpf(25)
```

### Assonance and consonance

Sound-similarity that binds layers: shared formants, harmonic series, colours, rhythm cells and envelopes.

#### ASN-01 Shared vowel formants

- **Definition.** Two layers filtered to the same vowel (bass and vocal syllables both on "o").
- **Why it works.** Formants are the strongest cue for sound similarity in voice-like sounds; shared formants bind layers into one colour.
- **When.** Talking basses with vocal chops, formant pads with leads.
- **Measure.** composer layers: colour "shared vowel" for the pair; stems: high MFCC cosine. (engine/composer `layers`)
- **Anti-patterns.** Same vowel and same band (masking).
- **Tags.** composition, assonance, formant, measured, lowered

Craft form:

```js
$: note("c2*4").s("sawtooth").hook("hygiene-bass").vowel("<o a>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("<o a>").hook("hygiene-vox").gain(0.4)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2*4").s("sawtooth").hpf(40).lpf(3500).vowel("<o a>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("<o a>").hpf(150).lpf(8000).gain(0.4)
```

#### ASN-02 Shared harmonic series

- **Definition.** Layers placed on partials of one fundamental (octaves, fifths over the bass root).
- **Why it works.** Harmonic partials fuse (harmonicity): the layers sound like one rich tone.
- **When.** Pads over a sub, drones, bell layers.
- **Measure.** composer discord: low roughness with many voices; composer layers stems: lufs_gain_db >= 0 (no cancellation). (engine/composer `discord`)
- **Anti-patterns.** Tempered thirds high above a sub expecting perfect fusion (slight beating is normal).
- **Tags.** composition, assonance, consonance, measured, lowered

Craft form:

```js
$: note("c1").s("sine").hook("hygiene-sub")
$: note("[c3,g3,c4,e4]").s("triangle").hook("hygiene-pad").gain(0.2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c1").s("sine").hpf(25)
$: note("[c3,g3,c4,e4]").s("triangle").hpf(180).lpf(6000).gain(0.2)
```

#### ASN-03 Repeated colour and noise texture

- **Definition.** One noise colour (vinyl, tape hiss, pink air) or one reverb space shared by several layers.
- **Why it works.** A common acoustic signature (same room, same noise floor) makes separate sources sound recorded together.
- **When.** Lo-fi, phonk, cloud; any mix that feels disjointed.
- **Measure.** composer layers: same room / filter colour; composer scan: a constant noise floor in the brilliance band. (engine/composer `layers`)
- **Anti-patterns.** Noise so loud it masks transients.
- **Tags.** composition, assonance, texture, measured, lowered

Craft form:

```js
$: s("bd ~ sd ~").hook("hygiene-kick").room(0.3).size(2)
$: n("0 2 4 3").scale("C4:minor").s("triangle").hook("hygiene-keys").room(0.3).size(2)
$: s("pink").hpf(4000).gain(0.03)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd ~ sd ~").hpf(30).lpf(7000).room(0.3).size(2)
$: n("0 2 4 3").scale("C4:minor").s("triangle").hpf(80).lpf(7000).room(0.3).size(2)
$: s("pink").hpf(4000).gain(0.03)
```

#### ASN-04 Rhyming rhythm cells

- **Definition.** Two layers share a rhythm cell (same onsets) with different pitches or sounds.
- **Why it works.** Shared onsets group layers by common fate; the groove gets one identity.
- **When.** Drops: bass and stab, kick and sub, chord stabs and hats.
- **Measure.** composer layers: rhythm_rhyme close to 1 for the pair. (engine/composer `layers`)
- **Anti-patterns.** Every layer on the same cell (no complement left, see CMP-02).
- **Tags.** composition, assonance, groove, measured, lowered

Craft form:

```js
atom("cell", { type: "mini", body: "x ~ x ~ ~ x ~ x" })
$: note("c2").struct(atoms.cell).s("sawtooth").hook("hygiene-bass")
$: chord("Cm").voicing().struct(atoms.cell).s("square").hook("hygiene-stab").decay(0.1).sustain(0)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2").struct("x ~ x ~ ~ x ~ x").s("sawtooth").hpf(40).lpf(3500)
$: chord("Cm").voicing().struct("x ~ x ~ ~ x ~ x").s("square").hpf(120).lpf(8000).decay(0.1).sustain(0)
```

#### ASN-05 Rhyming envelopes

- **Definition.** Layers share an attack/decay shape (all plucky, or all swelling).
- **Why it works.** Envelope shape is a primary timbre cue; matching envelopes make layers belong to one gesture.
- **When.** Pluck layers, stab stacks, pad beds.
- **Measure.** composer layers: envelope_rhyme close to 1. (engine/composer `layers`)
- **Anti-patterns.** One slow-attack layer inside a pluck stack (smears the transient).
- **Tags.** composition, assonance, measured, lowered

Craft form:

```js
$: note("c4 eb4 g4").s("triangle").hook("hygiene-pluck").attack(0.002).decay(0.15).sustain(0)
$: note("c5 g5").s("square").hook("hygiene-pluck").attack(0.002).decay(0.15).sustain(0).gain(0.3)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c4 eb4 g4").s("triangle").hpf(120).lpf(7000).attack(0.002).decay(0.15).sustain(0)
$: note("c5 g5").s("square").hpf(120).lpf(7000).attack(0.002).decay(0.15).sustain(0).gain(0.3)
```

#### ASN-06 Onset alliteration

- **Definition.** Several layers start together on chosen beats (accents everyone hits), then separate.
- **Why it works.** Coincident onsets are heard as one accent: hits get weight; the rest of the bar stays clear.
- **When.** Accents on 1 and the "and of 2" in hip-hop; drop downbeats.
- **Measure.** composer layers: onset_lock above chance for the accent layers. (engine/composer `layers`)
- **Anti-patterns.** Everything on every accent (flams if timing differs).
- **Tags.** composition, assonance, accents, measured, lowered

Craft form:

```js
$: s("bd ~ ~ bd ~ ~ ~ ~").hook("hygiene-kick")
$: note("c2 ~ ~ c2 ~ eb2 ~ ~").s("sawtooth").hook("hygiene-bass")
$: chord("Cm").voicing().struct("x ~ ~ x ~ ~ ~ ~").s("square").hook("hygiene-stab").decay(0.1).sustain(0)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd ~ ~ bd ~ ~ ~ ~").hpf(30).lpf(7000)
$: note("c2 ~ ~ c2 ~ eb2 ~ ~").s("sawtooth").hpf(40).lpf(3500)
$: chord("Cm").voicing().struct("x ~ ~ x ~ ~ ~ ~").s("square").hpf(120).lpf(8000).decay(0.1).sustain(0)
```

### Complementing

One layer fills the gaps of another: in frequency, time, stereo, length and dynamics.

#### CMP-01 Spectral complement and mask-aware carving

- **Definition.** Layers that compete get mirrored filtering: where one is boosted, the other is cut (or high/low-passed apart).
- **Why it works.** Masking is band-local: removing overlap gives each layer its own critical bands (producer-reported "puzzle-piece" EQ).
- **When.** Kick vs bass, vocal vs lead, pads vs keys.
- **Measure.** composer layers (stems): masking_index falls after carving; composer density: no slot suggestions. (engine/composer `layers`)
- **Anti-patterns.** Carving so deep a layer sounds hollow solo and in context.
- **Tags.** composition, complement, mix, measured, lowered

Craft form:

```js
$: note("c2*8").s("sawtooth").hook("hygiene-bass").lpf(900)
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").hpf(500).gain(0.2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2*8").s("sawtooth").hpf(40).lpf(3500).lpf(900)
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).hpf(500).gain(0.2)
```

#### CMP-02 Rhythmic complement

- **Definition.** Onbeat vs offbeat, notes in the other layer's rests (the offbeat bass in house, hats between kicks).
- **Why it works.** Interleaved onsets give a denser composite rhythm with no masking in time.
- **When.** Bass vs kick, chops vs snare, counterlines.
- **Measure.** composer layers: onset_complement close to 1 and "best complement" for each layer. (engine/composer `layers`)
- **Anti-patterns.** Complement so strict both layers sound like one choppy part.
- **Tags.** composition, complement, offbeat, measured, lowered

Craft form:

```js
$: s("bd*4").hook("hygiene-kick")
$: note("~ c2 ~ c2 ~ c2 ~ c2").s("sawtooth").hook("hygiene-bass")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000)
$: note("~ c2 ~ c2 ~ c2 ~ c2").s("sawtooth").hpf(40).lpf(3500)
```

#### CMP-03 Sustained vs staccato

- **Definition.** Long notes against short ones: pad against plucks, held bass against stabs.
- **Why it works.** Different envelopes separate into streams and fill both the time and the spectrum.
- **When.** Any two melodic layers that share a register.
- **Measure.** composer layers: length_contrast >= 2 (log2 ratio of median durations). (engine/composer `layers`)
- **Anti-patterns.** Two pads in one register.
- **Tags.** composition, complement, measured, lowered

Craft form:

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").gain(0.2)
$: n("0 2 4 3 2 4 5 4").scale("C5:minor").s("triangle").hook("hygiene-pluck").decay(0.1).sustain(0)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.2)
$: n("0 2 4 3 2 4 5 4").scale("C5:minor").s("triangle").hpf(120).lpf(7000).decay(0.1).sustain(0)
```

#### CMP-04 Stereo complement

- **Definition.** Mono low end and lead; width in pads, hats, reverbs; panned pairs left/right.
- **Why it works.** Spatial separation releases masking (binaural unmasking) and mono lows stay solid on any system.
- **When.** Always: bass and kick mono, supporting layers wide.
- **Measure.** composer layers: pan_contrast; stems: low-band correlation stays mono. (engine/composer `layers`)
- **Anti-patterns.** Wide sub or wide kick.
- **Tags.** composition, complement, stereo, measured, lowered

Craft form:

```js
$: note("c1*4").s("sine").hook("hygiene-sub")
$: n("0 2 4 3").scale("C5:minor").s("triangle").hook("hygiene-pluck").pan(sine.range(0.2, 0.8))
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c1*4").s("sine").hpf(25)
$: n("0 2 4 3").scale("C5:minor").s("triangle").hpf(120).lpf(7000).pan(sine.range(0.2, 0.8))
```

#### CMP-05 Dynamic complement (ducking)

- **Definition.** One layer gets quieter while another plays (sidechain, ducking on a bus).
- **Why it works.** Time-varying gain separates layers in loudness when they must share a band.
- **When.** Kick and sub, vocal and pads, impacts and the mix.
- **Measure.** composer density: the sub slot shared by a ducked pair is not flagged; stems: kick transients clear. (engine/composer `density`)
- **Anti-patterns.** Pumping everything (the groove becomes the compressor).
- **Tags.** composition, complement, sidechain, measured, lowered

Craft form:

```js
$: s("bd*4").hook("hygiene-kick").duckorbit(2).duckdepth(0.6)
$: note("c1*8").s("sine").hook("hygiene-sub").orbit(2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000).duckorbit(2).duckdepth(0.6)
$: note("c1*8").s("sine").hpf(25).orbit(2)
```

### Synergy

Pairs that only work together: the sum is a new sound, not two sounds.

#### SYN-01 Kick and sub lock

- **Definition.** The kick's pitch and decay tuned with the sub: same root, the sub ducked or starting after the kick transient.
- **Why it works.** In phase and in tune the two sum into one low event; out of phase they cancel (comb filtering at the overlap).
- **When.** Every genre with a separate kick and sub (trap 808 + kick, dubstep, DnB).
- **Measure.** composer layers (stems): lufs_gain_db >= 0 for kick + sub (no cancellation); events: onset_lock over chance. (engine/composer `layers`)
- **Anti-patterns.** Kick and sub a semitone apart; No ducking and long sub tails under every kick.
- **Tags.** composition, synergy, low-end, sidechain, measured, lowered

Craft form:

```js
$: s("bd ~ ~ bd").s("sine").hook("hygiene-kick").freq(55).decay(0.3).duckorbit(2).duckdepth(0.7)
$: note("a0 ~ ~ a0").s("sine").hook("hygiene-sub").orbit(2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd ~ ~ bd").s("sine").hpf(30).lpf(7000).freq(55).decay(0.3).duckorbit(2).duckdepth(0.7)
$: note("a0 ~ ~ a0").s("sine").hpf(25).orbit(2)
```

#### SYN-02 Bass and pad reinforcement

- **Definition.** The pad voices sit on the bass note's partials (octave, fifth, tenth), so together they make one chord-tone.
- **Why it works.** Harmonic reinforcement raises loudness of shared partials and fuses the two.
- **When.** Breakdowns and drops with sustained chords.
- **Measure.** composer layers (stems): lufs_gain_db > 0.5 ("reinforce"). (engine/composer `layers`)
- **Anti-patterns.** Pad thirds in the bass octave.
- **Tags.** composition, synergy, pad, measured, lowered

Craft form:

```js
$: note("<c2 ab1>").s("sawtooth").hook("hygiene-bass").lpf(500)
$: chord("<C5 Ab5>").voicing().s("supersaw").hook("hygiene-pad").gain(0.2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("<c2 ab1>").s("sawtooth").hpf(40).lpf(3500).lpf(500)
$: chord("<C5 Ab5>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.2)
```

#### SYN-03 Snare and noise tail

- **Definition.** A tonal snare body and a noise layer that only work together (body + tail).
- **Why it works.** Transient, body and decay come from different layers; each alone is thin, together they make one snare.
- **When.** Snares and claps in every genre.
- **Measure.** composer layers: onset_lock 1.0 for the pair, different bands. (engine/composer `layers`)
- **Anti-patterns.** Layers with different onsets (flam).
- **Tags.** composition, synergy, drums, measured, lowered

Craft form:

```js
$: s("~ sd").s("triangle").note("d3").hook("hygiene-snare").decay(0.12).sustain(0)
$: s("~ x").s("white").hpf(2000).decay(0.18).sustain(0).gain(0.5)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("~ sd").s("triangle").note("d3").hpf(120).lpf(10000).ftype("24db").decay(0.12).sustain(0)
$: s("~ x").s("white").hpf(2000).decay(0.18).sustain(0).gain(0.5)
```

#### SYN-04 Vocal formant and lead filter sweep

- **Definition.** The lead's filter sweeps through the same region as the vocal's formants, alternating in time.
- **Why it works.** Shared spectral region in alternation reads as a duet of one colour.
- **When.** Hooks with vocal chops and a synth lead.
- **Measure.** composer layers: filter centres within 1/2 octave and onset_complement high. (engine/composer `layers`)
- **Anti-patterns.** Sweeping through the vocal while it sings.
- **Tags.** composition, synergy, formant, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hook("hygiene-lead").lpf(sine.slow(2).range(700, 1400)).mask("<1 0>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("a").hook("hygiene-vox").mask("<0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").hpf(150).lpf(8000).lpf(sine.slow(2).range(700, 1400)).mask("<1 0>")
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("a").hpf(150).lpf(8000).mask("<0 1>")
```

#### SYN-05 Sidechain interplay

- **Definition.** The kick ducks pads and bass so the pumping becomes part of the groove.
- **Why it works.** Amplitude modulation at the beat rate synchronises layers to the kick (common fate).
- **When.** House, big room, French house filter loops, phonk drops.
- **Measure.** composer scan: low-band onset pattern on every beat and pad energy dips between; composer density ducks recognised. (engine/composer `scan`)
- **Anti-patterns.** Masking sidechain because it is "EDM": it is a tool for any genre (user directive).
- **Tags.** composition, synergy, sidechain, measured, lowered

Craft form:

```js
$: s("bd*4").hook("hygiene-kick").duckorbit(3).duckdepth(0.6)
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").orbit(3).gain(0.3)
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4").hpf(30).lpf(7000).duckorbit(3).duckdepth(0.6)
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).orbit(3).gain(0.3)
```

### Clustering

Tone clusters, rhythmic clusters, event bursts in time, and clustering as analysis (bars, motifs).

#### CLU-01 Tone clusters

- **Definition.** Adjacent tones sounded together (seconds), as colour (soft, high) or as attack (loud, short).
- **Why it works.** High soft clusters shimmer (beating as texture); loud clusters are percussive roughness.
- **When.** Ambient pads (high, quiet), impacts (loud, short).
- **Measure.** composer discord: "cluster" interval class; roughness level vs section median. (engine/composer `discord`)
- **Anti-patterns.** Mid-low clusters held under a vocal.
- **Tags.** composition, clustering, pad, measured, lowered

Craft form:

```js
$: note("[c5,d5,eb5,f5]").s("triangle").hook("hygiene-pad").attack(1).release(2).gain(0.1)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("[c5,d5,eb5,f5]").s("triangle").hpf(180).lpf(6000).attack(1).release(2).gain(0.1)
```

#### CLU-02 Chord clusters (dense voicings)

- **Definition.** Add9, sus2, 6/9 and 11 voicings with seconds inside, spread above 200 Hz.
- **Why it works.** Seconds inside open voicings add colour (the "bittersweet" melodic-bass sound) without the roughness of close low clusters.
- **When.** Melodic dubstep and future bass chords, liquid DnB pads.
- **Measure.** composer discord: m2/M7 present with moderate roughness (no clash flag). (engine/composer `discord`)
- **Anti-patterns.** Clustered voicings below 200 Hz.
- **Tags.** composition, clustering, harmony, measured, lowered

Craft form:

```js
$: chord("<Cm9 Abmaj9 Eb6 Bbsus2>").voicing().s("supersaw").hook("hygiene-supersaw").gain(0.2)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm9 Abmaj9 Eb6 Bbsus2>").voicing().s("supersaw").hpf(100).lpf(9000).gain(0.2)
```

#### CLU-03 Rhythmic clusters

- **Definition.** Bursts of events in a short span: flams, ratchets, drags, rolls.
- **Why it works.** A burst is heard as one ornamented event: emphasis and swing within a beat.
- **When.** Trap hats, DnB snares, fills.
- **Measure.** composer feel: ghost and onset counts per bar; rhythm cells with subdivisions in the ledger rhythm list. (engine/composer `feel`)
- **Anti-patterns.** Ratchets on every beat (machine-gun).
- **Tags.** composition, clustering, drums, trap, measured, lowered

Craft form:

```js
$: s("hh*8").hook("hygiene-hat").ply("<1 1 2 [1 3]>").gain(0.4)
$: s("~ sd ~ [sd sd]").hook("hygiene-snare")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db").ply("<1 1 2 [1 3]>").gain(0.4)
$: s("~ sd ~ [sd sd]").hpf(120).lpf(10000).ftype("24db")
```

#### CLU-04 Event clustering over time

- **Definition.** Density bursts at points: more events just before the drop, sparse elsewhere.
- **Why it works.** Time-varying density shapes expectation; bursts point at arrivals.
- **When.** The last 1-2 bars of builds, the bar before a switch.
- **Measure.** composer density: onsets per bar peak at the end of the build. (engine/composer `density`)
- **Anti-patterns.** Uniform density (no burst, no arrival).
- **Tags.** composition, clustering, build-drop, measured, lowered

Craft form:

```js
$: s("sd").hook("hygiene-snare").fast("<1 1 2 8>")
$: s("hh*8").hook("hygiene-hat").gain(0.3).mask("<1 1 1 0>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("sd").hpf(120).lpf(10000).ftype("24db").fast("<1 1 2 8>")
$: s("hh*8").hpf(5000).lpf(14500).ftype("24db").gain(0.3).mask("<1 1 1 0>")
```

#### CLU-05 Bar clustering (analysis)

- **Definition.** k-means over per-bar features (band energies, centroid, flatness, onsets or lane activation) finds section types without a form.
- **Why it works.** Bars that sound alike cluster together; the run lengths reveal the form, turnaround bars and transition bars.
- **When.** Audio you own (find its form), or a draft (did the drop really change?).
- **Measure.** composer cluster: labels, runs, adjusted Rand index against the form. (engine/composer `cluster`)
- **Anti-patterns.** Reading clusters as genre rules: they describe one track.
- **Tags.** composition, clustering, analysis, measured, lowered

Craft form:

```js
// engine/composer/run.sh cluster MIX.wav OUT --bpm 128 [--form form.json]
$: s("bd*4, hh*8").hook("hygiene-kick").mask("<1 1 0 0 1 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
// engine/composer/run.sh cluster MIX.wav OUT --bpm 128 [--form form.json]
$: s("bd*4, hh*8").hpf(30).lpf(7000).mask("<1 1 0 0 1 1>")
```

#### CLU-06 Motif clustering by contour

- **Definition.** Group motif cells by their up/down contour to find families of related ideas.
- **Why it works.** Contour is the most robust identity cue; cells sharing it sound related even with different intervals.
- **When.** After drafting: are the motifs one family (unity) or unrelated (patchwork)?
- **Measure.** composer ledger: contour_families. (engine/composer `ledger`)
- **Anti-patterns.** Too many unrelated contours in one track.
- **Tags.** composition, clustering, motif, analysis, measured, lowered

Craft form:

```js
// engine/composer/run.sh ledger PROGRAM.strudel.js OUT -> contour_families
$: n("<[0 2 4 3] [0 3 5 4]>").scale("C4:minor").s("triangle").hook("hygiene-pluck")
```

Strudel form (generated, same events on 4 cycles):

```js
// engine/composer/run.sh ledger PROGRAM.strudel.js OUT -> contour_families
$: n("<[0 2 4 3] [0 3 5 4]>").scale("C4:minor").s("triangle").hpf(120).lpf(7000)
```

#### CLU-07 Timbral clustering

- **Definition.** Group sounds into a few timbral families (metallic, airy, woody, distorted) and assign families to sections.
- **Why it works.** A limited palette per section reads as intent; switching families marks sections.
- **When.** Planning the palette; checking stems.
- **Measure.** composer layers (stems): MFCC cosine groups; composer cluster on stems. (engine/composer `layers`)
- **Anti-patterns.** Every layer a different family (no palette).
- **Tags.** composition, clustering, texture, measured, lowered

Craft form:

```js
$: n("0 2 4").scale("C5:minor").s("square").hook("hygiene-bell").fm(2.01).decay(0.4).sustain(0).mask("<1 0>")
$: n("0 2 4").scale("C4:minor").s("triangle").hook("hygiene-pluck").mask("<0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4").scale("C5:minor").s("square").hpf(300).lpf(8000).fm(2.01).decay(0.4).sustain(0).mask("<1 0>")
$: n("0 2 4").scale("C4:minor").s("triangle").hpf(120).lpf(7000).mask("<0 1>")
```

### Sound-design layering

One instrument from several layers: sub, body, bite, air; parallel and serial processing.

#### SND-01 Sub, body, bite, air

- **Definition.** One instrument from four layers: sub (sine, mono, < 100 Hz), body (100-500 Hz), bite (1-5 kHz transient or grit), air (> 8 kHz noise).
- **Why it works.** Each band carries a different cue (weight, warmth, presence, sheen); separate layers allow separate processing and mono / stereo choices.
- **When.** Basses, leads and snares that must translate on small and large systems.
- **Measure.** composer scan band map: one layer dominant per band; composer layers stems: low masking between the layers. (engine/composer `scan`)
- **Anti-patterns.** Every layer full range (phase mush in the lows).
- **Tags.** composition, sound-design, layering, measured, lowered

Craft form:

```js
$: note("c1*2").s("sine").hook("hygiene-sub")
$: note("c2*2").s("sawtooth").hook("hygiene-bass").hpf(100).lpf(500)
$: note("c3*2").s("square").hook("hygiene-growl").hpf(1000).distort(1.5).gain(0.3)
$: s("white*2").hpf(8000).decay(0.05).sustain(0).gain(0.1)
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c1*2").s("sine").hpf(25)
$: note("c2*2").s("sawtooth").hpf(40).lpf(3500).hpf(100).lpf(500)
$: note("c3*2").s("square").hpf(70).lpf(9000).hpf(1000).distort(1.5).gain(0.3)
$: s("white*2").hpf(8000).decay(0.05).sustain(0).gain(0.1)
```

#### SND-02 Parallel processing and band split

- **Definition.** Process a copy in parallel (distortion, compression) or split by band (.split) so the sub stays clean.
- **Why it works.** The low band keeps its phase and weight; the high band can be wrecked for character.
- **When.** Growls, reeses, drums buses.
- **Measure.** composer scan: sub band stays tonal (clean) while upper bands show grit; composer discord audio roughness above 200 Hz only. (engine/composer `scan`)
- **Anti-patterns.** Distorting the full band and then EQ-ing the sub back.
- **Tags.** composition, sound-design, buses, measured, craft-runtime

Craft form:

```js
// lo: the sub band stays clean and mono; hi: grit only above 120 Hz
bass: note("c2*4").s("sawtooth").hook("hygiene-bass").lpf(2400)
  .split(lo => lo.lpf(120), hi => hi.hpf(120).distort(2.5).postgain(0.45).lpf(8000))
```

Strudel form: none (splits, sends and returns (.split, .merge, .send, ret) are compiled by the Craft lane engine to audio buses with the source rendered once; strudel.cc has no buses).

#### SND-03 Serial chain order

- **Definition.** The order of processes decides the sound: filter then distort (rounded grit) vs distort then filter (tamed harmonics).
- **Why it works.** Non-linear stages generate harmonics from what reaches them; order sets which partials exist.
- **When.** Rack design (docs/RACK_STANDARD.md).
- **Measure.** composer scan: the two orders give different band maps (A/B in one render). (engine/composer `scan`)
- **Anti-patterns.** Stacking reverbs before distortion (mud).
- **Tags.** composition, sound-design, measured, lowered

Craft form:

```js
$: note("c2*4").s("sawtooth").hook("hygiene-growl").lpf(800).distort(2)
$: note("c2*4").s("sawtooth").hook("hygiene-growl").distort(2).lpf(800).mask("<0 1>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: note("c2*4").s("sawtooth").hpf(70).lpf(9000).lpf(800).distort(2)
$: note("c2*4").s("sawtooth").hpf(70).lpf(9000).distort(2).lpf(800).mask("<0 1>")
```

#### SND-04 Resampling and freezing

- **Definition.** Render a processed sound to audio (capture), then rework it as a sample: chop, pitch, process again.
- **Why it works.** Freezing modulation into a sample makes it consistent per note and opens new processing (producer-reported central in neurofunk).
- **When.** Bass design sessions; neuro, riddim.
- **Measure.** the capture exists (CAPTURE.md); composer layers stems on the resampled layer. (engine/composer `layers`)
- **Anti-patterns.** Resampling forever without committing a palette.
- **Tags.** composition, sound-design, capture, measured, lowered

Craft form:

```js
// strudel capture IN --name growl -o growl.wav (docs/CAPTURE.md), then use the capture as a sample
$: note("c2*4").s("sawtooth").hook("hygiene-growl").fm(2).distort(2)
```

Strudel form (generated, same events on 4 cycles):

```js
// strudel capture IN --name growl -o growl.wav (docs/CAPTURE.md), then use the capture as a sample
$: note("c2*4").s("sawtooth").hpf(70).lpf(9000).fm(2).distort(2)
```

### Vocal as instrument

Pitched syllables, vowels and formant pads; no lyrics are written or implied.

#### VOX-01 Pitched syllables and vowels

- **Definition.** Vowels or syllables as notes, no words: a melodic instrument with a voice colour.
- **Why it works.** Voice-like spectra (formants) draw attention; without words they stay instrumental.
- **When.** Hooks, breakdowns, phonk and melodic bass chops. Never add words the user did not write.
- **Measure.** composer ledger: the motif on the vox lane; composer layers: shared vowel with another layer. (engine/composer `ledger`)
- **Anti-patterns.** Inferring lyrics, crowd or choir parts the user did not ask for.
- **Tags.** composition, vocal-instrument, vox, formant, measured, lowered

Craft form:

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("<a e o a>").hook("hygiene-vox").lpf(3500)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("0 2 4 3").scale("C4:minor").s("sawtooth").vowel("<a e o a>").hpf(150).lpf(8000).lpf(3500)
```

#### VOX-02 Sustained formant pad

- **Definition.** A long vowel (formant filter or sustained sung vowel) as a pad layer.
- **Why it works.** A vowel pad is warm and human and sits in the vocal band only lightly when filtered.
- **When.** Intros, reliefs, under sparse drops.
- **Measure.** composer density: atmos role; composer layers: complement with the lead (length contrast). (engine/composer `density`)
- **Anti-patterns.** A loud vowel pad under a lead vocal (masking in 300 Hz-3 kHz).
- **Tags.** composition, vocal-instrument, vox, pad, formant, measured, lowered

Craft form:

```js
$: chord("<Cm Ab>").voicing().s("sawtooth").vowel("o").hook("hygiene-pad").attack(0.8).release(2).gain(0.15)
```

Strudel form (generated, same events on 4 cycles):

```js
$: chord("<Cm Ab>").voicing().s("sawtooth").vowel("o").hpf(180).lpf(6000).attack(0.8).release(2).gain(0.15)
```

#### VOX-03 Woven chops

- **Definition.** Short vocal slices placed in the gaps of the groove (offbeats, after the snare), pitched to the chords.
- **Why it works.** Short, pitched chops act as rhythmic ear candy and a call-and-response voice.
- **When.** Drops of melodic bass, house, phonk; the user's own or licensed vocals only.
- **Measure.** composer layers: onset_complement with the snare lane high. (engine/composer `layers`)
- **Anti-patterns.** Chopping vocals from other artists' tracks (never rip; the user's own or licensed material only).
- **Tags.** composition, vocal-instrument, vox, call-response, measured, lowered

Craft form:

```js
$: n("<4 3> ~ 2 ~").scale("C4:minor").s("sawtooth").vowel("<e o>").hook("hygiene-vox").decay(0.12).sustain(0).late(0.125)
```

Strudel form (generated, same events on 4 cycles):

```js
$: n("<4 3> ~ 2 ~").scale("C4:minor").s("sawtooth").vowel("<e o>").hpf(150).lpf(8000).decay(0.12).sustain(0).late(0.125)
```

### Arrangement maps

Section maps per genre as gates and masks, so a track is one program with selections, not copies.

#### ARR-01 Forms as gates

- **Definition.** One form map as gate atoms (intro, build, drop ...); lanes are selected by gate, never copied per section.
- **Why it works.** One source of truth for the arrangement: changing a section length moves every layer.
- **When.** Every full track (docs/CONVENTIONS.md section 3).
- **Measure.** composer density / cluster with --form: the gates match the cluster runs. (engine/composer `cluster`)
- **Anti-patterns.** Copy-pasted patterns per section (edits drift).
- **Tags.** composition, arrangement, form, gate, measured, craft-runtime

Craft form:

```js
atom("intro", { type: "gate", body: "<3b" })
atom("drop", { type: "gate", body: "@3b" })
kick: s("bd*4").hook("hygiene-kick").tags("drums")
pad: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").gain(0.2).tags("pad")
tagged("drums").mute(atoms.intro)
```

Strudel form: none (lane tags and selections (.tags, tagged().mute / solo / fx) choose events by lane while the program plays, through the Craft lane engine; plain Strudel has no tags or selections).

#### ARR-02 Genre section maps

- **Definition.** Typical bar maps: house intro 16-32, breakdown 16-32, drop 32; DnB DJ intro 32, drop 32-48 (16 main, 16 variation, roll-out); dubstep intro 16-32, build 8, drop 16-32, switch-up second drop; trap hook 8 / verse 16; big room build 16 with 8-bar riser, drop 32.
- **Why it works.** Producer-reported conventions (COMPOSITION_RESEARCH.md); DJ mixing needs predictable phrase lengths in 8s.
- **When.** Planning the form; a brief may override.
- **Measure.** composer cluster: run lengths in multiples of 8; composer density per section. (engine/composer `cluster`)
- **Anti-patterns.** Odd phrase lengths in a DJ tool without intent.
- **Tags.** composition, arrangement, form, measured, lowered

Craft form:

```js
// 18 bars at 1 cycle per bar: intro 4, build 2, drop 4, break 2, build 2, drop 4 (scale x8 for a real 144-bar map)
atom("drops", { type: "mini", body: "<0!6 1!4 0!4 1!4>" })
atom("builds", { type: "mini", body: "<0!4 1!2 0!6 1!2 0!4>" })
$: s("bd*4").hook("hygiene-kick").mask(atoms.drops)
$: s("sd*8").hook("hygiene-snare").gain(0.4).mask(atoms.builds)
```

Strudel form (generated, same events on 4 cycles):

```js
// 18 bars at 1 cycle per bar: intro 4, build 2, drop 4, break 2, build 2, drop 4 (scale x8 for a real 144-bar map)
$: s("bd*4").hpf(30).lpf(7000).mask("<0!6 1!4 0!4 1!4>")
$: s("sd*8").hpf(120).lpf(10000).ftype("24db").gain(0.4).mask("<0!4 1!2 0!6 1!2 0!4>")
```

#### ARR-03 DJ-friendly intro and outro

- **Definition.** Drums-led 16-32 bar intro and outro with no full harmony, so DJs can mix.
- **Why it works.** Beat-matched mixing needs a rhythm-only overlap; harmonic clashes between two tracks are avoided.
- **When.** Club tracks (house, DnB, techno); not for listening edits.
- **Measure.** composer density: intro and outro layers mostly drum role; composer discord: no harmony in the first bars. (engine/composer `density`)
- **Anti-patterns.** Full chords from bar 1 in a club tool.
- **Tags.** composition, arrangement, form, dj, measured, lowered

Craft form:

```js
$: s("bd*4, [~ hh]*4").hook("hygiene-kick")
$: chord("<Cm Ab>").voicing().s("supersaw").hook("hygiene-pad").gain(0.2).mask("<0!4 1!4>")
```

Strudel form (generated, same events on 4 cycles):

```js
$: s("bd*4, [~ hh]*4").hpf(30).lpf(7000)
$: chord("<Cm Ab>").voicing().s("supersaw").hpf(180).lpf(6000).gain(0.2).mask("<0!4 1!4>")
```

#### ARR-04 Switch-up second drop

- **Definition.** The second drop keeps the hook but changes the beat, bass pattern or sound (beat switch, half/double time).
- **Why it works.** Repetition with a twist: identity plus novelty, the main reward of the second drop.
- **When.** Dubstep, DnB, trap, phonk.
- **Measure.** composer cluster: the second drop is a different cluster from the first; composer ledger: the hook motif present in both. (engine/composer `cluster`)
- **Anti-patterns.** A second drop identical to the first; A switch-up that drops the hook entirely.
- **Tags.** composition, arrangement, form, build-drop, gate, measured, craft-runtime

Craft form:

```js
atom("sw", { type: "gate", body: "@3b" })
hooks.bind("bass", [["lpf", 900]], "<3b")
hooks.bind("bass", [["lpf", 2500], ["distort", 1.5]], atoms.sw)
$: note("c2 ~ c2 eb2").s("sawtooth").hook("hygiene-bass").use("bass")
```

Strudel form: none (the binding is gated (it opens at a bar or in a range): gates are evaluated by the Craft runtime as the song plays, plain Strudel has no timeline of bindings).

<!-- catalog:end -->
