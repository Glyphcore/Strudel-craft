# 04 Enforcement bodies (what proposals/ must contain; gated detail)

Goal: agents (any model) behave the same without reading verbose directives. Bodies are short, point to folds, and put the gate command in one line.

## CLAUDE.md block (<= 12 lines each, both repos)
1. Source of truth is spec/ (branch or dir after adoption). Default read = folds: `sot ls`, `sot fold ID`. Detail only: `sot spec ID` for ids you will change.
2. Do not cat spec/specs or ledger detail. Do not grep specs unless asked by the keeper.
3. Every issue/PR/comment you author from tearline-1 on has a line `sot: <ids>` (units or concerns). Unknown id: create the concern via sot-keeper, not by free text.
4. After a change: `sot touch ID --st <state> --ev <ref>`; accepted only with critic acceptance + evidence.
5. Reports to the main session: frame header + <= 8 lines.
6. Terse by default; verbose only after an explicit request or a failing check.
7. Point to docs/ISSUES_PROTOCOL.md addendum (tearline rule).

## Agent: sot-keeper (haiku or sonnet, tools: Read, Grep, Bash(sot only), Write on spec/ only)
Duties: keep folds/specs/ledger/history consistent; allocate ids and guids; reject over-long folds; verify `sot:` lines on new issues (REST read); maintain tearline counters; produce `sot ls --st review|open` digests on request. Output contract: frame header + list of ids. Never edits code. Fold of the agent body <= 25 lines; detail behind `sot spec sc.process.sot-keeper`.

## Skill: sot (user and agent invocable)
Triggers: "state of feature X", "what is open", "add concern", "where is this documented", "what changed since tearline". Steps: run `sot find|ls|fold`; escalate to `sot spec` only for named ids; write via `sot touch`. Includes the filter note (one line) and the frame header format. Skill body <= 40 lines; examples are command lines, not prose.

## Hooks (proposals only)
- UserPromptSubmit: print the tearline line and counts of open concerns (one line, via `sot tearline`).
- Stop: if the session created issues without a `sot:` line (REST check, cheap) print a reminder; never block.
- SessionStart: print the filter note (one line).
Scripts tiny, no network except GitHub REST read; fail open.

## ISSUES_PROTOCOL addendum
- Every issue body from tearline-1 carries `sot: <ids>`; critics verify it as an acceptance box; closure runs `sot touch` with the issue ref as evidence; labels remain as today.
- Mention `tearline-1` marker in #56 tracker body header.

## Filter disclaimer (use verbatim in every fold file header, <= 2 lines)
`SOT fold view. Detail is gated: sot spec <id>. Filter: sot ls --area/--st/--tag/--iss; do not cat sibling specs/ files.`
