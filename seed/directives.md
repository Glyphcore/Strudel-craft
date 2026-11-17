# Seed: user directives and concerns (distilled from the build conversation, 2026-11-13..17). INPUT ONLY: consolidate into spec/ledger, then archive. Confidence: H = explicit user words, M = my paraphrase, V = verify against issues.tsv/docs.
User context: phone-only (claude.ai app, Samsung S22 portrait 390px), no desktop. Main session orchestrates; subagents (sonnet default) build; critics review; Fable orchestrator session for long streams.

## S: standing rules (H unless noted)
S01 Site/UI changes deploy straight to main (Pages); light checks; never hold in PRs. (Strudel-craft CLAUDE.md)
S02 No native alert/prompt/confirm; site modal for inputs/confirms, toasts for notices.
S03 Live tracker: every new request and completion updates checklist in Strudel-craft #56 (site ? widget polls). Comments, not wholesale body rewrites (M, learned after entity damage).
S04 Docs follow code: any feature/syntax/param/control/pack-kind change updates syntax.json examples, intellisense data, site/README.md, docs/*.md, #56 in the same push; mark unbuilt "coming".
S05 Issues protocol: build -> READY FOR CRITIC with evidence -> independent critic accepts/rejects/closes; builders never close (docs/ISSUES_PROTOCOL.md). Critics edit nothing.
S06 Delegate: main session orchestrates; sonnet subagents build/review in parallel/background; long streams as separate cloud sessions (Fable) with self-contained prompts.
S07 Load discipline (2026-11-16): 4 cores shared; queue by intensity light/medium/heavy; engine/load/gate.sh; size concurrent agents to load; heavy one at a time.
S08 Agent context auto-compacts at 300k (autoCompactWindow in suno-track-lab .claude/settings.json).
S09 Phone-first: 390px, 44px targets, no horizontal overflow, no editor scroll or focus steal on plain press (#107); navigation to code is deliberate (go-to-code button or long-press).
S10 Licences: packs CC0-1.0 / most permissive; external sounds only CC0 1.0 or synthesized; DAW-study sources only licences permitting study (docs/RESEARCH_ETHICS.md #152); statistics only, never melodies/notes/samples; no ripping tracks; never other people's music (Suno owner-only, fail closed).
S11 Measure, don't assert: claims need tests/measurements; UNVERIFIED labels honest; thresholds never loosened to pass; weak tests fixed not widened.
S12 Eager shell byte budget enforced (tests/site/shell_budget.mjs, 470000; structural lazy loading, not trims) (#59, #131).
S13 Suno rules (suno-track-lab CLAUDE.md): no grid/BPM/speed words in style text; never mask production techniques (risers, sidechain, filter moves are first-class); keep user echo parentheses; user lyric words immutable unless revision mode; never infer instruments; no crowd/choir/stacked harmonies; limits 5000/1000 chars counted by code; tag format [Act][Section][one-line]. "metatarsal" = metatag.
S14 Reusable commands live in repo scripts, listed in CLAUDE.md; nothing generated stays only in scratch; audio via engine/audio/sync.sh + publish_audio.sh; mp3 decoded true peak <= -1.0 dBTP (lossy overshoot found twice).
S15 Hooks (environment): stop hook demands commit+push of uncommitted work; WIP commits acceptable for other agents' in-progress files, labelled.
S16 Report tersely to the phone user; state failures plainly; mention what was NOT verified.

## R: requests and bugs by theme (user asks; issue refs where known; V = map via issues.tsv)
R-ED editor/intellisense/live: editable Stack code field; intellisense engine (typed params, pluggable providers, ghost text, Tab accept, no state change during suggestion; dismiss on interaction); live compile hot swap + git-like history with search (sawtooth bug); AST-bound inline controls with ghost/indicator highlight; comments must not break linter (#142); copy-code widget; pianoroll inline in editor (V).
R-HK hooks/atoms/lanes/blueprint: middleware hook syntax (slots, taps, time-gated "@17b"), blueprint graph (zoom/pan/drag fixes), atoms (parameterized magic strings), lanes (.split/.send/ret/capture), variables/reuse/wrap, saved reusable track library (V #42-#60).
R-PK packs/spec: pluggable content packs, uniform spec, installable, locks with hashes, CC0, aliases (#120), groove allowlist (#132), shadow warnings (#143), recipe bodies lazy (#131), site loads pack racks (#91).
R-PF perform: beatpad grid keyboard-mapped; control board; inline cc controls; knobs must not scroll to code (#107); pickup vs jump takeover; presets (#113); outputs/sources pane for tap pads (#114); pads audition voices (#116); pad-first layout + toast fix (#118); tap reader latency (#119); mixer lane faders (#113).
R-VX vox: vocal banks (demo, call-me-baby user's own, ljspeech, vocalset, sung SoulX), word()/syl()/vowel(), banks browser; sung bank unlistened (#79).
R-RC record/capture/engine: capture of playing rack; unify record panel; takes as forward-only hashed recipes; offline render without playing aloud; glitch-free sync; non-blocking engine (#102-#104, #108, #115); length in bars/typed/to end of track (#139); decoded mp3 true peak.
R-PWA install on Android Chrome; background play (worker clock); no sound/syntax after upgrade (#84); readout jitter; transport range with 20 min clamp.
R-UX workspace panes, command palette; syntax view navigation at 132 sections (#149); quick play on syntax/recipe rows, to end or continuous, no jump to rack (#150); both forms Craft + Strudel (#117); folders/tags + tag-driven appearance (#120); Resources/Lib pane of referenced atoms/hooks/taps (#160); score annotations CraftCues (#162-#164).
R-CT content: night phonk demo v1/v2; hiphop/trap/hyphy comps+forms+feels+groove+dovetail (#109-#112); EDM/dubstep/UKF (#127-#129,#161); DnB/electro/house (#121-#124,#165); industrial, rock/metal, EDM depth (#155-#157); recipes studio-worthy not toys; two full-length bangers (house/French-house/Destination Calabria/Alex Gaudino feel + wet industrial dubstep; DnB with sentimental shifts, downtempo wavephonk floaty, etchy snarl-growl, creamy; no lyrics, pitch-influenced syllables) seeded with user's supersaw FM bass tweak (#136 sirocco-foundry, #137 velvet-static; V).
R-CP composition: composer skill + tools (motifs, interplay, foreshadow, layering/density, clashes, assonance, complement, synergy, tone borrowing, clustering) (#144-#147); community research (paraphrase+cite, no ripping) (#145).
R-DS DAW study + form bank: batch-not-per-track; cheap bar-level triage before stem extraction; haiku concept-batcher on compact packs; provenance bank (picked apart, source, method: inferred/rendered/analysed/composite); licensed sources only (#152-#159).
R-MS mastering fundamentals + presets (rock, metal, industrial, trap), per-file check (#158); load-aware queuing (S07); structural shell fix (#131, next lazy concept rows).
R-PR process: folders/tags for recipes; package paradigm under glyphcore namespace (#120 audit: 497 entries; shim provisional pack pending licence #66).
R-SOT (this directive): source-of-truth catalog with ids/guids/state, concern ledger, terse-fold/detail-spec gating protocol, tearline from #165, clean-room branch, enforcement bodies.

## O: known open items at tearline-1 (V against issues.tsv)
#96-#101 refactor R2-R7; #105/#106 supersaw bit-identity + skipped audit items; #115 whole-take render nondeterminism; #119 closed? V; #121/#124 critic pending; #122 re-master critic pending; #133 ftype allowlist; #134 shim schema errors; #135 tree UI for library/takes/atoms; #140 CLI worklet cost cause UNVERIFIED; #141 lowering drift; #148 taxonomy test race; #149 syntax nav critic pending; #151 forms cleanup critic pending; #152-#159 DAW-study critic pending; #160 resources critic pending; #161 EDM polish fixes in flight; #162-#164 CraftCues critic in flight; #165 follow-ups; shell budget structural fix in flight; two bangers in critic cycle (#136, #137).
Stale labels (status:review/in-progress) remain on closed issues: a cleanup pass was planned.

## L: lessons that became rules (M)
Tests that only assert generated text pass while behaviour is wrong (audio-measure tests required); toasts must not capture pointer events over controls; comments must be masked by one shared masker (site/engine/comments.js) in every text pass; hooks registry/controls must be isolated per audition; one-line changes to shared helpers (h()) need a caller audit; generated pins/precache regenerated after every rebase, never hand-merged; shared working tree is dirty: use worktrees; GraphQL blocked: REST only, page=N.
