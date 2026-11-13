# Issues protocol

All work is tracked in GitHub issues on this repo. One issue = one deliverable.

## Lifecycle (labels)
`status:todo` -> `status:in-progress` (checked out) -> `status:review` (critic) -> closed (accepted) or back to `status:in-progress` (rejected).

## Checkout
- Before work: comment `CHECKOUT by <agent/session>`, set `status:in-progress`, assign. Only one owner per issue.
- Abandon: comment `RELEASE` with what is left, set `status:todo`.

## Checklist
Every issue body has `## Acceptance` with checkboxes that are observable (a command, a file, a measured number, a URL), never "works well".
The implementer ticks boxes only with evidence linked in a comment (commit SHA, command output summary, screenshot path).

## Done = critic acceptance, never self-stated
- The implementer may NOT close the issue or tick the final `Critic accepted` box.
- When all other boxes are ticked: set `status:review`, comment `READY FOR CRITIC` with evidence per box.
- A separate critic (different agent/session, edits nothing) re-runs each check independently and comments `CRITIC: ACCEPT` (then ticks `Critic accepted` and closes) or `CRITIC: REJECT` with the failing boxes (then sets `status:in-progress`).
- Close reason must be `completed` with the critic comment linked.

## Workflow concerns
- Cross-cutting concerns (rules, licences, CI, site deploy, data formats) go in issues labelled `type:workflow`; they block feature issues that depend on them (`Blocked by #N` in body).
- Discovered problems outside scope: open a new issue (`type:bug` or `type:workflow`), link it, do not widen the current one.
- Commits reference the issue (`Refs #N`), never `Closes #N` (closing is the critic's job).
