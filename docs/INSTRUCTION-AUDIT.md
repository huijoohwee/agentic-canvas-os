---
title: "LLM Instruction Audit Runtime"
graphId: "md:llm-instruction-audit-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-instruction-audit/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded audit of always-on Agentic Canvas OS guidance and skill catalog context"
runtime_scope: "docs/AGENTS.md and docs/SKILLS.md"
runtime_claim: "model-free instruction budget, intent-preservation, duplication, and owner-boundary checks"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
external_pattern_sources:
  - "https://learn.chatgpt.com/docs/customization/overview"
external_source_policy: "design reference only; forbid copied prose, examples, schemas, code, tests, or fixtures"
invocation:
  action: "/instruction.audit"
  semantics: ["#instruction-audit", "#progressive-disclosure", "#runtime-ready"]
  bindings: ["@instruction-source", "@local-harness", "@runtime-proof"]
---

# LLM Instruction Audit Runtime

## Decision

Keep always-on guidance small and intent-focused. Place durable repository behavior in `AGENTS.md`, reusable workflows in Skills, mechanical policy in executable checks, and detailed contracts in their canonical owners. The official customization overview informs this separation; no source wording or implementation is copied.

The audit is deterministic and model-free. It does not ask another model to grade style, and it does not rewrite instructions automatically.

## Audited Surfaces

| Surface | Role | Body words | Instruction units | Invocation mentions | Embedded procedures |
|---|---|---:|---:|---:|---:|
| `docs/AGENTS.md` | Always-on project guidance | At most 900 | At most 42 | At most 16 | 0 code fences |
| `docs/SKILLS.md` | Metadata-first skill catalog | At most 1,800 | At most 48 | At most 36 | 0 code fences |

Frontmatter remains available for machine discovery but is excluded from body-word and directive budgets. Total character and estimated-token metrics include the complete files so context reduction stays visible.

## Checks

| Check | Pass condition | Failure |
|---|---|---|
| Required intent | Each surface retains its source, workflow, proof, and deployment markers. | `missing-intent` |
| Context budget | Body words and directive-bearing units remain within the surface policy. | `body-word-budget` or `instruction-unit-budget` |
| Route-detail budget | Always-on prose and catalog prose avoid enumerating the full invocation registry. | `invocation-detail-budget` |
| Progressive disclosure | The catalog links selected owner detail instead of embedding procedure blocks. | `embedded-procedure` |
| Canonical ownership | Session, memory, planning, runtime-identity, and specialist workflow mechanics stay in their owners. | `canonical-owner-leakage` |
| Duplicate guidance | Normalized directive units occur once across audited surfaces. | `duplicate-instruction` |

Instruction units are Markdown list items, table cells, or sentences with directive language and at least five normalized words. Duplicate detection is exact after case and Markdown normalization; the audit does not pretend lexical matching is semantic judgment.

## Typed Result

| Field | Meaning |
|---|---|
| `schema` | Exact `agentic-instruction-audit/v1` identity. |
| `status` | `passed` only when the violation list is empty. |
| `files` | Per-surface role, metrics, limits, missing intent, and delegated-detail findings. |
| `summary` | Aggregate context size, estimated tokens, directive units, duplicates, and violations. |
| `baseline` | Optional exact character reduction against a named Git revision. |
| `costLog` | Exact zero model calls, tokens, cache hits, and estimated cost. |
| `deployBoundary` | Explicit false values for Prod mirror and Cloudflare attempts. |

The report exposes counts and policy reasons, not instruction bodies, secrets, runtime artifacts, or private reasoning.

## Runtime

Run the focused gate:

`npm run instruction-audit:check`

Compare the current surfaces with an inspected revision:

`node scripts/instruction-audit.mjs --baseline-ref=<git-revision> --json`

The library accepts in-memory documents for focused tests. The CLI reads only the two declared repository files and optionally uses `git show` for the exact baseline. Unknown arguments and missing surfaces fail closed.

## VCCs

| VCC | Observable proof |
|---|---|
| Intent survives slimming | Required markers for facts, workflow, skills, validation, owner routing, external boundaries, and deploy gates remain present. |
| Repeated context shrinks | Baseline output reports positive character reduction for the audited revision. |
| Duplication fails | A repeated normalized directive produces `duplicate-instruction`. |
| Owner leakage fails | Session mechanics or embedded specialist handbooks produce a typed violation. |
| Audit is zero-cost | The report returns `model: not-run` and zero usage and estimated cost. |
| Audit is non-mutating | Tests and CLI change no source, Prod mirror, or Cloudflare state. |

## Promotion Boundary

The instruction-audit harness is runtime-ready locally. It proves the repository policy and current surfaces; it does not prove that every downstream host loaded the new instructions, that a provider cached them, or that shorter context alone improved task quality. `INSTRUCTION-QUALITY-EVALUATION.md` owns the separate final-answer evaluation contract; named candidates still require their own evidence and human review.
