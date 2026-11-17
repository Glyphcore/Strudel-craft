# 05 Clean-room rules and verification (gated detail)

## Branch
- spec/sot-cleanroom is an orphan branch in Glyphcore/Strudel-craft. It stays disjoint from main; adoption is a later human decision (copy spec/ + tools/sot + proposals into main in a normal PR or direct push).
- Keep the tree small: spec/, tools/sot/, proposals/, handoff/, seed/. No site code, no audio, no binaries.
- Read main read-only. Do not copy source; describe behaviour and interfaces.

## Clean-room reader test (D5)
1. Spawn a fresh sonnet reader with access ONLY to spec/ folds and, on demand, `sot spec` bodies (no repo main, no seed). 
2. Ask it 25 rebuild questions (frozen list in spec/verify-questions.md written BEFORE the test from main facts): e.g. "what runs on the main thread vs worker", "how are recipe bodies loaded and pinned", "what is the shell budget and how is it enforced", "what does a tap pad do with and without a reader", "how does Record resolve end of track", "what are the pack license rules", "what are the load-discipline rules". Include 5 state questions ("which features are open/regressed?") and 5 flow questions ("what happens on first tap after cold load?").
3. Score each answer against main facts (a second subagent or you with read access to main). Pass: >= 85% correct from folds alone or folds + <= 2 spec fetches per answer; report token cost per answer (bytes read).
4. Record misses as concerns (kind=spec-gap) and fix units; rerun the failing questions.

## Coverage metrics (spec/coverage.md)
units, specs, flows, concerns pre/post, unmapped paths (docs, site modules, tools, schemas, engine), issues mapped (closed/open), units without evidence, units with st=unverified, average fold bytes, average spec bytes, reader-test score and bytes/answer.

## Tearline mechanics
- tearline-1 = after issue #165 (2026-11-17). Everything <= #165 is `pre`. New issues > #165 must have `sot:`; `sot tearline` lists any that do not (REST read).
- When the user issues a new directive/request, the keeper adds a concern and, if work results, ensures the issue carries the ids.
