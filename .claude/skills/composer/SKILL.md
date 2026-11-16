---
name: composer
description: Design and check the composition of a track as explicit design choices - motif seed and development, section map, density and layer ladders, foreshadowing, interplay and cross-texture migration, harmony and tone borrowing, intentional clashes and their resolution, assonance / complement / synergy between layers, clustering, groove and feel - then measure them with engine/composer (motif ledger, density, foreshadow, spectrogram scan, feel pick, discord, layers, cluster-bars). Use when building or refining a full track (Strudel / Craft program or own audio), when asked how much to layer or embellish, or to analyse feel and form of audio the user owns.
---

# Composer

Concepts (ids, recipes, checks, anti-patterns): `$STRUDEL_CRAFT/docs/COMPOSITION.md` (default /home/user/strudel-craft; site Syntax view,
folder `composition/...`). Producer research (cited, paraphrased, UNVERIFIED marked): `$STRUDEL_CRAFT/docs/COMPOSITION_RESEARCH.md`.
Tools: `engine/composer/run.sh` (README there). Strudel syntax: `.claude/skills/strudel-craft/SKILL.md`.

## Directives (from CLAUDE.md, they apply to every production step)
- Never mask production techniques or tools (risers, sweeps, builds, drops, automation, filter moves, sidechain, EDM-style dynamics) just
  because they are associated with EDM; non-EDM tracks use them too. Exclude only specific outcomes the user named or a trigger clearly predicts.
- Never infer instruments the user did not name. Genre words that imply instruments (phonk -> cowbell / 808) are flagged and left out unless asked.
- No crowd / chant / gang / choir / stacked or grouped harmonies / stadium feel unless asked; solo lead. Vocal-as-instrument concepts (VOX)
  use vowels and syllables only; the user's lyric words never change (revision mode only, per suno-lyricist).
- Sinister is a light tint unless asked. In Suno style text: no 'grid', tempo numbers or speed words; energy from motion words.
- Research and references inform components and forms only: never rip, transcribe or duplicate a track (melody, sample, stem, arrangement).
  Scans and stems are for audio the user owns (owner-only rules of engine/suno apply).
- Reusable steps are repo scripts (engine/composer/run.sh), never one-off inline runs. After any audio-producing step run engine/audio/sync.sh.

## Workflow
1. **Brief.** Read or write the track BRIEF.md: the user's words, named instruments only, mood, form wishes, length. Write an energy arc
   (EN-01: a level 1-10 per section) into it.
2. **Motif seed.** One or two short cells (3-6 notes, a distinctive rhythm). Note the transformations planned for them (MOT-01..11) and
   where each appears. Keep a cell that can survive as rhythm alone (XT-03).
3. **Section map.** Forms as gates or masks (ARR-01), genre map (ARR-02), phrase lengths in 8s for club forms, DJ intro/outro only when wanted
   (ARR-03), a switch-up for the second drop (ARR-04).
4. **Density plan.** Per section: lanes per role on the ladder core / support / ornament / atmos (LAY-02), count within the LAY-03 target for
   the genre, one owner per frequency slot (LAY-04), embellishment ladder per repeat (LAY-05), ear candy every 4-8 bars (LAY-06),
   subtraction before each arrival (LAY-08, TEN-04).
5. **Foreshadow plan.** Where the hook is teased (FS-01/02: fragment, filtered, reversed, rhythm on percussion), where its harmony is planted
   (FS-03), where it pays off (FS-04), and its callback (FS-05).
6. **Design-choice checks (answer each in the brief before building).**
   - Which layers hand the motif over, and in which order (INT-04, XT-01)? Which counterline answers it (INT-02)?
   - Where is the intentional clash, what is it (m2, tritone, cluster, detuned unison, bitonal) and where does it resolve (DIS-01..05)?
   - Which two layers share a formant or colour, a rhythm cell or an envelope (ASN-01..06)?
   - What is each layer's complement: frequency slot, onbeat/offbeat, sustained/staccato, wide/mono, ducking (CMP-01..05)?
   - Which pairs only work together (kick + sub lock, snare + noise tail, bass + pad partials, sidechain) (SYN-01..05)?
   - What is borrowed: a chord from the parallel mode, a key lift, a timbre, an envelope or groove from another layer (BOR-01..08)?
   - Where do events cluster (rolls, ratchets, density bursts) and which voicings are clusters (CLU-01..04)?
   - Which feel (template and groove preset) and why (GRV-01..07)?
7. **Build** the Craft program (atoms, hooks, lanes, `.groove`, gates; strudel-craft skill), render with the CLI.
8. **Checks** (engine/composer, all write JSON + MD into OUT):
   ```
   engine/composer/run.sh all PROGRAM.strudel.js OUT --form form.json --bars N --genre G -- --packs LOCK --hooks H.json
   engine/composer/run.sh scan MIX.wav OUT/scan --bpm B --form form.json      # audio the user owns
   engine/composer/run.sh feel OUT/scan/scan.json OUT/scan
   engine/composer/run.sh layers - OUT/stems --stems STEMS_DIR                  # pair relations on rendered stems
   ```
   Pass criteria: ledger has no "stated once" / "never returns" motif that was meant to recur, the hook migrates through >= 2 layers when the
   brief asks for development; density sections inside targets, no static run of 8+ bars without embellishment, a dip before each drop;
   foreshadow PASS for pre-echo, withheld payoff and callback (planted harmony when the brief wants it); discord: every clash resolved or
   intended; layers: no masking-risk pair left unaddressed in the low bands; cluster runs match the form.
9. **Refine rounds.** One change per finding, re-render, re-run the checks; stop when the brief's design-choice answers are all visible in
   the reports. Log decisions (what, why, alternative rejected) in the track's notes.
