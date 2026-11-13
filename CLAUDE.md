# Strudel Craft - agent rules
- Follow docs/ISSUES_PROTOCOL.md for all work: checkout, checklist with evidence, critic acceptance; never close your own issue.
- Site is static in site/; keep it standalone. Strudel loaded unmodified from unpkg (AGPL); do not vendor modified copies without a licence decision issue.
- Agents: .claude/agents/ (daw-sme orchestrator, concept-scout haiku, daw-implementer, critic, ui-designer). Start any session as daw-sme. Concept DAG: docs/CONCEPT_DAG.md. UI only via ui-designer + aaa-web-ui skill.
- Site deploys: UI/site changes go straight to main (Pages deploys on push); light checks are enough, never hold site changes in unmerged PRs. User directive 2026-11-13.
- UI dialogs: never use native alert()/prompt()/confirm(); inputs/confirms use the site modal component, notices use toasts. User directive 2026-11-13.
- Live tracker: every new user request and every completion updates the checklist in Glyphcore/Strudel-craft#56 right away, through the github MCP tools (the site ? widget polls it).
- Docs follow code: any change that adds, alters or removes a feature, syntax, function, param, control, pack kind or workflow must also update the informative content in the same push: site/data/syntax.json (Syntax view examples), intellisense data and param shapes, site/README.md, the relevant docs/*.md, and the #56 tracker. Remove stale entries; mark unbuilt ones "coming". User directive 2026-11-13.
