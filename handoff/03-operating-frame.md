# 03 Operating frame for the Fable architect (gated detail)

## Effort and budget
- xhigh for: protocol/schema/CLI design, flow graph design, enforcement bodies, decisions. high for: consolidation, ledger merges, verification. Use low-effort subagents for scans.
- Hold a reserve: stop heavy reading at ~70% of your context budget; at ~85% write a checkpoint (spec/CHECKPOINT.md: done, next, open decisions) and commit. Context auto-compacts at 300k tokens; do not rely on memory across compaction: state lives in files.
- Budget order of operations: design first (cheap, high value), then fanout, then merge, then verify.

## Thinking frame (keep thinking blocks short and structured)
Open every non-trivial step with tagged one-liners, then act; avoid prose reasoning:
`GOAL:` one line | `IN:` ids/files read (names only) | `CHECK:` the 1-3 facts that decide | `PLAN:` <= 4 steps | `RISK:` one line | `GATE:` fold or spec? (default fold) | `NEXT:` the tool call.
After results: `GOT:` numbers/ids | `DELTA:` state change | `NEXT:`. Keywords over sentences; ids over descriptions; no restating tool output. If a decision is needed: `OPT:` a|b | `PICK:` x because <= 10 words, then write D-nnn in handoff/decisions.md.

## Reading discipline
- Start from seed/issues.tsv (titles) and docs fold-style skims (head -40). Fetch a single issue body only when a concern needs its acceptance text: `gh api repos/Glyphcore/Strudel-craft/issues/N --jq .body`. Never page through all bodies. (GraphQL is blocked; use REST; paginate with page=N, not --paginate.)
- Read main docs by `git show origin/main:docs/X.md | head -60` first; read further only for the unit you are writing.
- Use grep/ls for coverage mapping; do not open all 5981 site files: the unit granularity is capability; use module headers and docs/README.

## Delegation (frames for subagents)
- Fanout by area: one sonnet subagent per area (<= 12 areas at once is too many: run <= 3 concurrently; the machine has 4 cores shared; check uptime). Brief = area name + file list + unit format (copy handoff/01 unit record + spec headings) + output path + rule "fold <= 160 chars, spec in own file, evidence required or st=unverified". Reply contract: `⟦sot v1 | area=<a> | units=<n> | unverified=<n> | touched=<paths>⟧` + <= 5 lines.
- Haiku `concept-batcher` (in main .claude/agents) may dedupe/cluster concern candidates from compact packs <= 8 KB.
- A reviewer subagent (critic role) verifies a sample of 10% units per area against main (read-only): behaviour matches fold; evidence resolves.
- Subagents never read the whole seed; give them only their slice.

## Tool-call expectations
- Prefer `sot` CLI (once it exists) for all spec reads/writes; direct file edits only for spec bodies. Every call output carries the frame header (handoff/01). Quote ids not prose in messages.
- One commit per area batch: `sot: <area> units n=<k> (<ids range>)`. Push after each commit.
- No network beyond GitHub REST for issues and `git fetch`; no installs outside this branch.

## Quality bars
- Fold <= 160 chars, one claim, present tense. Spec bullets testable. No adjectives like robust/seamless. Numbers over words (bytes, ms, counts).
- Never invent state: if you cannot find evidence, st=unverified and say what would verify.
- Respect the repo's own rules recorded in seed/directives.md S-section (these are facts to catalog, also constraints for your proposals).
