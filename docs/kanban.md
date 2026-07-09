---
title: "Agentic OS Kanban"
graphId: "md:agentic-os-kanban"
doc_type: "Durable Task Board"
date: "2026-07-08"
lang: "en-US"
schema: "agentic-os-kanban/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "durable Markdown table contract for named profile collaboration; no separate board runtime, process swarm, or deploy claim"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until explicit operator approval"
source_docs:
  - "FACTS.md"
  - "MEMORY.md"
  - "SKILLS.md"
  - "DICTIONARY-COMMAND.md"
  - "DICTIONARY-SEMANTIC.md"
  - "DICTIONARY-BINDING.md"
kanban_contract:
  owner: "shared multi-dimensional table and Kanban utilities"
  commands: ["/kanban.task", "/kanban.handoff", "/kanban.sync"]
  semantics: ["#kanban-board", "#task-row", "#profile-handoff", "#worker-process", "#multi-agent-collaboration"]
  bindings: ["@kanban-board", "@task-row", "@handoff-row", "@agent-profile", "@worker-process"]
  row_statuses: ["backlog", "ready", "doing", "blocked", "review", "done"]
  row_types: ["task", "handoff", "sync"]
  required_columns: ["id", "type", "status", "priority", "owner_profile", "worker_process", "target_profile", "context_refs", "acceptance", "evidence", "next_action"]
---

# Agentic OS Kanban

`kanban.md` is the durable shared task board for named profiles and full OS worker processes. It coordinates work through Markdown rows that existing shared multi-dimensional table and Kanban utilities can parse. It is not a copied external board runtime, a browser-only store, an in-process subagent swarm, or a deploy mechanism.

## Board Rules

| Rule | Requirement |
|---|---|
| Row SSOT | Every task, handoff, and sync state is a row in this file. |
| Named profiles | `owner_profile` and `target_profile` must name explicit profiles or `none`. |
| Full worker process | `worker_process` names an OS process, terminal, or `none`; hidden subagents are not workers. |
| Context refs | `context_refs` uses bounded references such as `@file:`, `@diff`, or local source ids; unsafe refs remain blocked by `@reference-policy`. |
| Shared utilities | Projection uses existing multi-dimensional table and Kanban utilities; no duplicate parser or board datastore. |
| Conflict handling | Concurrent edits preserve evidence and require explicit `/kanban.sync` resolution. |

## Task Rows

| id | type | status | priority | owner_profile | worker_process | target_profile | context_refs | acceptance | evidence | next_action |
|---|---|---|---:|---|---|---|---|---|---|---|
| KANBAN-0001 | task | ready | 1 | operator | none | none | `FACTS.md`; `SKILLS.md`; `DICTIONARY-*` | Kanban route contracts resolve from facts, dictionaries, memory, skills, harness, gateway, readiness, proof, and validation docs. | Source docs updated and focused validation passes. | Run docs validation after edits. |

## Handoff Contract

| Field | Required meaning |
|---|---|
| `id` | Stable task or handoff id. |
| `type` | `task`, `handoff`, or `sync`. |
| `status` | One of the frontmatter `row_statuses`. |
| `owner_profile` | Current responsible named profile. |
| `worker_process` | Full OS process identity or `none`. |
| `target_profile` | Receiving profile for handoffs or `none`. |
| `context_refs` | Bounded references needed to continue. |
| `acceptance` | Observable completion condition. |
| `evidence` | Proof already produced. |
| `next_action` | Smallest concrete continuation step. |

## VCCs

| VCC | Check |
|---|---|
| Board parses | Frontmatter parses and task table contains required columns. |
| Rows are durable | Task and handoff state is stored in Markdown rows, not process memory. |
| Profiles are named | Owner and target profiles are explicit or `none`. |
| Workers are isolated | Worker processes have identity, cwd/command outside this file, proof, bounds, and cleanup when launched. |
| Deploy boundary holds | Board edits do not mutate Prod mirror or deploy Cloudflare. |
