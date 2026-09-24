---
title: "Canvas documentation maintenance"
graphId: "md:agentic-canvas-os-document-maintenance"
doc_type: "Guidelines"
date: "2026-09-24"
version: "0.1.0"
lang: "en-US"
schema: "agentic-canvas-os-document-maintenance/v1"
frontmatter_contract: "required"
status: "proposed"
owner: "Canvas documentation maintainers"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
source_docs:
  - "https://github.com/huijoohwee/huijoohwee.github.io/blob/a9ab28adedf0d96b74670f459315560fa854b3b5/template/document-maintenance-template.md"
---

# Canvas documentation maintenance

<!-- agentic-os:doc-sync:start -->
## Shared maintenance contract

- Check authored YAML with the repository's strict parser and semantic profile.
- Compare template revisions from exact source commits and preserve local edits.
- Review conflicts and the full proposed diff before accepting an update.
- Require the repository's document checks for the exact source candidate.
- Record source, check and publication receipts separately from runtime proof.
<!-- agentic-os:doc-sync:end -->

## Local notes

Canvas owns its authored frontmatter and docs contract. A template pin update
requires an admitted documentation lane and the Canvas docs CI check.
