# 02 Deliverables and acceptance (gated detail)

## D1 Catalog (spec/)
- Units for every user-visible feature and engine feature of Strudel-craft main (site/ modules, engine, tools/, schemas/, packs, CLI twin in suno-track-lab/engine/*) and the lab workflows (suno-track-lab CLAUDE.md commands: audit, master, similarity, strudel CLI, dawstudy, composer, craftcues, load gate, form bank). Target granularity: 1 unit per observable capability (not per file). Estimate 250-450 units; areas suggested: editor, intellisense, hooks, atoms, lanes, packs, perform, record, capture, quickplay, resources, cues, organizer, syntax-view, pwa, bg-play, vox, catalog, racks/audit, genres, mastering, composer, dawstudy, formbank, lab-tools, process (issues protocol, tracker, load gate).
- Every unit: fold line + spec file with the fixed headings. Acceptance: `sot check` passes; every docs/*.md and every site/*.js module and every tools/* dir maps to >= 1 unit (spec/coverage.md lists unmapped, target 0 or justified); every closed issue appears in >= 1 unit ev or concern; every open issue is a concern with st open.
- Flows (D1b): at least: first load, edit+live compile, play/stop/transport, recipes/syntax browse + quick play, perform (pads, presets, board), record (take, offline, length), resources pane, cues/score, packs/organizer, install/offline, settings/modals/toasts, deep links. Each as nodes/edges with phone constraints.
- Implementation-type section per unit and a global spec/architecture.md (<= 120 lines): runtime layers (main thread, worker clock, lazy modules, service worker), data layers (catalog index + lazy bodies, packs + lock + hashes, taxonomy), build tools, test tiers, budgets (shell 470000 bytes unless changed), CLI/engine parity.

## D1c Concern ledger
- `pre`: consolidate seed/directives.md + issues.tsv + docs (KNOWN_ISSUES, CONCEPT_DAG, REFACTOR_PLAN) into concerns C-nnnn: kind (rule|bug|request|question|decision), source (user|critic|agent), st (addressed|open|deferred|wontfix|superseded), links (unit ids, issues). Merge duplicates; keep one fold line each. Recompute addressed vs open from issue state + critic acceptance (accepted issue = addressed; READY FOR CRITIC = review).
- `post`: starts empty at tearline-1; template + `sot check` rule that any issue number > tearline is referenced by a concern or unit.
- Report: counts by st; list of open concerns with owners (agent kinds) in spec/ledger/open.md (fold lines).

## D2 Tool
- tools/sot/ with tests (node:test or plain asserts) covering grammar, gate behaviour (spec only via explicit id, folds never contain bodies), check rules, history, tearline counts. Zero dependencies.

## D3 Proposals (not applied)
- proposals/CLAUDE.strudel-craft.md and proposals/CLAUDE.suno-track-lab.md blocks (<= 12 lines each) + proposals/agents/sot-keeper.md + proposals/skills/sot/SKILL.md + proposals/hooks.json (UserPromptSubmit reminder of tearline + Stop check that new issues carry `sot:`; keep scripts tiny) + proposals/ISSUES_PROTOCOL.addendum.md. Content spec: handoff/04.

## D4 Scaffold proof
- spec/scaffold.md: ordered phases (P0 repo + pages deploy + budgets ... Pn) each listing unit ids and acceptance gates, derived only from folds/specs. spec/coverage.md: metrics (units, specs, flows, concerns, unmapped paths, issues mapped, units without tests/evidence).

## D5 Verify
- handoff/05. Record results in spec/verify.md.

## Definition of done
`sot check` clean; coverage numbers reported; clean-room reader test passes thresholds; proposals complete; decisions recorded; final report <= 25 lines; branch pushed.
