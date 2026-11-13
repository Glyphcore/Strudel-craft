# Strudel Craft - agent rules
- Follow docs/ISSUES_PROTOCOL.md for all work: checkout, checklist with evidence, critic acceptance; never close your own issue.
- Site is static in site/; keep it standalone. Strudel loaded unmodified from unpkg (AGPL); do not vendor modified copies without a licence decision issue.
- Agents: .claude/agents/ (daw-sme orchestrator, concept-scout haiku, daw-implementer, critic, ui-designer). Start any session as daw-sme. Concept DAG: docs/CONCEPT_DAG.md. UI only via ui-designer + aaa-web-ui skill.
