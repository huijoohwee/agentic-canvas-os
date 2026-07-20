---
title: "Agentic OS Agent Instructions"
graphId: "md:agentic-os-agents"
doc_type: "Agent Instructions"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-os-agents/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "durable repository guidance for Agentic Canvas OS docs"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "small always-on instruction layer with delegated workflow and validation detail"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "protected green main authorizes only the repository-owned automatic release controller"
source_docs:
  - "FACTS.md"
  - "START-WORKFLOW.md"
  - "RELEASE-WORKFLOW.md"
  - "SKILLS.md"
  - "VALIDATION-RUNBOOK.md"
  - "INSTRUCTION-AUDIT.md"
---

# Agent Instructions

## Scope

These instructions apply under `docs/`. They contain only durable behavior that should be present for every documentation task. Detailed procedures, schemas, routes, and proof commands remain in their canonical owner documents and load only when relevant.

## Start Here

- Read `FACTS.md` for source precedence and repository truth.
- Run `START-WORKFLOW.md` before repository mutation or runtime-readiness work.
- Load only the owner documents needed for the task; do not read the whole documentation tree by default.
- Use `RELEASE-WORKFLOW.md` only when integration or release is explicitly in scope.

## Durable Rules

- Preserve YAML frontmatter and keep the authored body aligned with it.
- Fix conflicts at the source or shared owner; do not add downstream masks, aliases, or duplicate registries.
- Keep authored files under 600 lines and split by responsibility.
- Resolve workspace paths from the repository; never persist developer-specific paths, credentials, generated runtime values, or environment-specific defaults.
- Treat external projects and documentation as design references only. Do not copy their code, prose, prompts, schemas, tests, fixtures, or dependencies.
- Keep claims proportional to evidence. A source contract is not live-provider, deployment, or runtime proof.
- Prefer focused checks for touched behavior. Use the validation owner rather than restating commands here.
- Prod mirrors and Cloudflare change only through the protected-main automatic release controller; local agents and task worktrees have no deploy authority.

## Owner Routing

| Concern | Canonical owner |
|---|---|
| Shared facts and precedence | `FACTS.md` |
| Identity and voice | `SOUL.md` |
| Bounded agent notes and durable history | `MEMORY.md` and `MEMORY-LOG.md` |
| Explicit operator profile | `USER.md` |
| Reusable skill discovery and selection | `SKILLS.md` |
| Command, semantic, and binding tokens | `DICTIONARY-COMMAND.md`, `DICTIONARY-SEMANTIC.md`, and `DICTIONARY-BINDING.md` |
| Runtime schemas, cost, fallbacks, and orchestration | `HARNESS-CONTRACTS.md` |
| Probe-Tree semantic clarification behavior | `PROBE-TREE.md` |
| Session ownership and release mechanics | `START-WORKFLOW.md` and `RELEASE-WORKFLOW.md` |
| Canonical checkout sync and automatic CI/CD lifecycle | `CANONICAL-LIFECYCLE.md` |
| Session-end worktree audit and safe cleanup | `START-WORKFLOW.md` and `scripts/worktree-lifecycle.mjs` |
| Planning lifecycle | `TODO.md` and the active monthly shard |
| Proof and validation | `RUNTIME-PROOF.md` and `VALIDATION-RUNBOOK.md` |

## Instruction Placement

- Keep `AGENTS.md` limited to rules that apply on nearly every task.
- Put focused, repeatable workflows in Skills so their full instructions load only when selected.
- Put mechanical policy in validators, tests, hooks, or typed runtime owners.
- Add durable guidance only after repeated error or recurring review evidence; otherwise use the current task prompt or the nearest owner document.
- Audit `AGENTS.md` and `SKILLS.md` with the model-free contract in `INSTRUCTION-AUDIT.md`.

## Completion

- Run focused tests for changed runtime owners and `npm run docs:check` for documentation contracts.
- Record exact proof, cost state, remaining live-provider gaps, and deploy boundaries in `RUNTIME-PROOF.md` when runtime readiness changes.
- For library, framework, SDK, API, CLI, or cloud guidance, fetch current documentation through Context7; pure documentation refactors and general concepts do not require it.
