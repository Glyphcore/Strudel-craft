@@ sot-handoff v1 | branch spec/sot-cleanroom (orphan, never merge to main) | agent fable | effort xhigh design / high bulk | created 2026-11-17 | tearline-1 = after issue #165
# HANDOFF: build the Source of Truth (SOT) for Strudel-craft + suno-track-lab
FILTER: this file is the FOLD. Detail lives in handoff/NN-*.md; read one only when its line says so. Do not cat the whole tree.

## Mission (fold)
- M1 Catalog every feature + UI flow with a stable id + guid, with state and evidence, so a later agent can answer "what exists / what state / which issue / which test" from folds alone.
- M2 Hold every concern the user raised (directives, bugs, requests, rules) in one ledger: addressed / open / deferred, linked to feature ids and issues. Seed: seed/directives.md + seed/issues.tsv (163 issues, #1-#165).
- M3 Good enough to scaffold the project from scratch again (principle, not a plan to do it): each feature has a one-line FOLD and a gated detailed SPEC with acceptance criteria and implementation type.
- M4 Token protocol: agents read folds by default; detail only through the `sot` tool (gated), never by catting directive files. The protocol's own text obeys the protocol (terse fold, verbose body behind a gate).
- M5 Enforcement bodies (CLAUDE.md block, sot-keeper agent, sot skill, hook proposals, frame/header conventions) written as PROPOSALS under proposals/ for the user to adopt. Do not touch main or any other repo.
- M6 Tearline: everything raised before tearline-1 is consolidated retroactively (ledger section `pre`). From tearline-1 on, every new issue/request carries `sot:` ids (ledger section `post`, append-only) and the keeper verifies it.

## Hard rules (fold)
- R1 Orphan branch: no merge, rebase, cherry-pick from main. Read main read-only: `git fetch origin main` then `git show origin/main:PATH` or a detached worktree outside this tree. Clean-room = derive from behaviour, docs, issues, tests; do not paste code.
- R2 Write only inside this branch. Commit small (one area per commit), push `origin spec/sot-cleanroom`. No PRs.
- R3 Measure, do not assert. Mark UNVERIFIED where unproven. Evidence = issue#, commit sha, test path.
- R4 No user questions. Decide, record the decision in handoff/decisions.md with one-line reason, continue.
- R5 Token discipline: frame template in handoff/03; delegate bulk scans to sonnet/haiku subagents (agent `concept-batcher` exists in main .claude/agents); never load raw issue bodies in bulk, use titles (seed/issues.tsv) then fetch single issues on demand.

## Deliverables (fold; detail: handoff/02-deliverables.md)
- D1 spec/folds/*.md + spec/specs/<id>.md (units), spec/flows/ (UI flow graph), spec/ledger/ (concerns pre/post tearline), spec/index.json (generated).
- D2 tools/sot/ zero-dep Node CLI: ls, fold, spec, find, ledger, check, gen-index, tearline. Header-framed output (handoff/01).
- D3 proposals/: CLAUDE.md blocks (both repos), .claude/agents/sot-keeper.md, .claude/skills/sot/SKILL.md, hook JSON, ISSUES_PROTOCOL addendum (`sot:` line + tearline rule).
- D4 spec/scaffold.md: ordered rebuild phases from folds (principle proof) + coverage report (spec/coverage.md).
- D5 Verification: clean-room reader test (handoff/05).

## Order (fold)
1 protocol + schema + CLI skeleton (xhigh) -> 2 seed units from docs/ + site modules (sonnet fanout) -> 3 ledger from seed/directives.md + issues.tsv -> 4 flows -> 5 proposals -> 6 coverage + clean-room test -> 7 report (<= 25 lines).

## Read next
- handoff/01-protocol.md (unit format, gating, headers): read first.
- handoff/02-deliverables.md (acceptance per deliverable).
- handoff/03-operating-frame.md (thinking frame, effort, delegation).
- handoff/04-enforcement-bodies.md (what proposals must say).
- handoff/05-cleanroom-verify.md (branch rules, verification).
- seed/inventory.md (where things live), seed/directives.md (concern seed), seed/issues.tsv.
- handoff/KICKOFF.md is what the user pastes to start you.
