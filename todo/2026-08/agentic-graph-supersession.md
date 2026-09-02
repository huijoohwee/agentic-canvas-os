---
schema: "todo-context-record/v2"
period: "2026-08"
context: "agentic-graph-supersession"
scope: "cross-repository"
status: "immutable"
record_policy: "immutable"
source_contract: "../../docs/TODO.md"
updated_date: "2026-08-28"
---

# Agentic Graph Supersession

## 2026-08-28

| Context | Intent | Directive | Module | Class/Object | Function/Method | Input | Output | Decision Logic | Next Step Recommendation | Updated Date |
|---|---|---|---|---|---|---|---|---|---|---|
| agentic-graph-supersession | Supersede knowledge-graph vocabulary with agentic-graph | Register /agentic.graph.*, #agentic-graph, @agentic-graph in the three dictionaries, retire knowledge.graph forms, rename doc and tests, align MCP wire seam to upstream agenticgraph identifiers, recompute catalog digest | docs/DICTIONARY-*.md; docs/AGENTIC-GRAPH.md; src/knowgrph-mcp-*.js; web/app.js; package.json | KnowgrphMcpError; AGENTIC_GRAPH_MCP_TOOLS | createKnowgrphAgenticGraphClient; validateAgenticGraphRequest | Dictionaries with 28 knowledge.graph token hits and stale knowgrph.* wire names at base 64812e9 | Zero knowledge.graph token forms; upstream-aligned wire identifiers; catalog digest 89b506d3; npm test 3080 pass | Dictionaries are the sole token authority and forbid alias stacking; upstream knowgrph origin/main already renamed its tool prefix so pinning stale names would break the seam | Integrate via protected PR then author monetization grounding doc | 2026-08-28 |
