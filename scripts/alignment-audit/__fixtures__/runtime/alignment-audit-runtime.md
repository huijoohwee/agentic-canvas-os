---
title: "Portable Alignment Audit Runtime"
graphId: "fixture:portable-alignment-audit-runtime"
doc_type: "Runtime Contract"
date: "2026-07-28"
lang: "en-US"
schema: "portable-alignment-audit-runtime/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_scope: "alignment-audit"
owner: "alignment-audit-contract"
proof_reference: "fixture-runtime-proof"
capability_id: "alignment-audit"
---

# Portable Alignment Audit Runtime

Contract schema: `portable-alignment-audit-runtime/v1`

Validation command: `node --test __tests__/alignment-audit-end-to-end.test.mjs`

Validation command: `node --test __tests__/alignment-audit-integration.test.mjs`

Readiness status: `runtime-ready`

Capability: `alignment-audit`

Owner: `alignment-audit-contract`

Runtime scope: `alignment-audit`

Proof reference: `fixture-runtime-proof`

## Guideline Element Links

guideline_element_ids: `problem-validation-beaa3f0cd183fef8`, `problem-validation-a0d793e9c1a79d76`, `problem-validation-285b898e1e0c1eb6`, `problem-validation-ea520c14deb19a15`, `problem-validation-0b371e6993f2d4d9`

guideline_element_ids: `requirements-authoring-13cf62b1d5a72c45`, `requirements-authoring-d2558c514f10ce35`, `requirements-authoring-a735dbeb7c3a65d5`, `requirements-authoring-2ee4ecfbad4938b0`, `requirements-authoring-59620385f81011bb`

guideline_element_ids: `architecture-authoring-973cb10b513fa21a`, `architecture-authoring-fa0c3d492c5f7916`, `architecture-authoring-4761b77e7cad5ed7`, `architecture-authoring-cf802eb317a635f9`, `architecture-authoring-0b0ef02a5432c5c9`

guideline_element_ids: `alignment-review-8e58043fcc421b65`, `alignment-review-f75a48c406706e0b`, `alignment-review-2647470e7aafa4be`, `alignment-review-c9c72dcec2a77f9c`, `alignment-review-eb0d9145344d2c20`

guideline_element_ids: `implementation-1c9fc0e80790769f`, `implementation-61049d0c78b2323b`, `implementation-6a79026f407e4079`, `implementation-daa6f9db325a98f1`, `implementation-e8c9525686dcd6a4`

guideline_element_ids: `local-proof-9689b72534cc2fe6`, `local-proof-886403250bf0118c`, `local-proof-d4e5e08e6ce21e17`, `local-proof-9c3da365fe984e51`, `local-proof-94d4cb1a543c0205`

guideline_element_ids: `release-readiness-c127e3e4bdb5b9cf`, `release-readiness-4b5d4f2892bea0f6`, `release-readiness-81f06b06cd5edcd2`, `release-readiness-788c77d68b995dd1`, `release-readiness-66eadf2e909b7fd0`

## Verifiable Completion Condition

condition_id: `fixture-runtime-proof`

end_state: one versioned audit report and its two model digests are written

stated_check: `node --test __tests__/alignment-audit-end-to-end.test.mjs`

constraint: every write is a strict descendant of the configured output root

evidence_check: `node --test __tests__/alignment-audit-end-to-end.test.mjs`

recorded_result: `pass`

reproducible: `local`

condition_id: `fixture-integrity-proof`

end_state: every audited source remains byte-identical

stated_check: `node --test __tests__/alignment-audit-integration.test.mjs`

constraint: modifiedOutsideOutputCount equals zero

evidence_check: `node --test __tests__/alignment-audit-integration.test.mjs`

recorded_result: `pass`

reproducible: `local`

| condition_id | check_name | recorded_result | reproducible | element_ids |
|---|---|---|---|---|
| fixture-runtime-proof | node --test __tests__/alignment-audit-end-to-end.test.mjs | pass | local | `problem-validation-beaa3f0cd183fef8`, `problem-validation-a0d793e9c1a79d76`, `problem-validation-285b898e1e0c1eb6`, `problem-validation-ea520c14deb19a15`, `problem-validation-0b371e6993f2d4d9`, `requirements-authoring-13cf62b1d5a72c45`, `requirements-authoring-d2558c514f10ce35`, `requirements-authoring-a735dbeb7c3a65d5`, `requirements-authoring-2ee4ecfbad4938b0`, `requirements-authoring-59620385f81011bb`, `architecture-authoring-973cb10b513fa21a`, `architecture-authoring-fa0c3d492c5f7916`, `architecture-authoring-4761b77e7cad5ed7`, `architecture-authoring-cf802eb317a635f9`, `architecture-authoring-0b0ef02a5432c5c9`, `alignment-review-8e58043fcc421b65`, `alignment-review-f75a48c406706e0b`, `alignment-review-2647470e7aafa4be`, `alignment-review-c9c72dcec2a77f9c`, `alignment-review-eb0d9145344d2c20`, `implementation-1c9fc0e80790769f`, `implementation-61049d0c78b2323b`, `implementation-6a79026f407e4079`, `implementation-daa6f9db325a98f1`, `implementation-e8c9525686dcd6a4`, `local-proof-9689b72534cc2fe6`, `local-proof-886403250bf0118c`, `local-proof-d4e5e08e6ce21e17`, `local-proof-9c3da365fe984e51`, `local-proof-94d4cb1a543c0205`, `release-readiness-c127e3e4bdb5b9cf`, `release-readiness-4b5d4f2892bea0f6`, `release-readiness-81f06b06cd5edcd2`, `release-readiness-788c77d68b995dd1`, `release-readiness-66eadf2e909b7fd0` |

## Invocation Surface

These routes are fixture-local parser inputs. They do not register global `/`,
`#`, `@`, or tool invocations outside this bounded alignment-audit fixture.

| surface | token | owner |
|---|---|---|
| slash | `/alignment.audit` | `alignment-audit-contract` |
| hash | `#alignment-audit` | `alignment-audit-contract` |
| at | `@alignment-audit` | `alignment-audit-contract` |
| mcp | `alignment.audit` | `alignment-audit-contract` |

Federation contract tool: `alignment.audit`

Capability catalog tool: `alignment.audit`

## Stage Order

stage_order: `problem-validation`, `requirements-authoring`,
`architecture-authoring`, `alignment-review`, `implementation`, `local-proof`,
`release-readiness`

## Economics

return-on-investment: deterministic risk discovery before implementation

12-month-total-cost-of-ownership: local zero-infrastructure execution costs $0

token-budget: discovery and read views use zero model tokens

time-to-value: the committed fixture completes in one bounded local command

FOSS comparison: the runtime uses platform APIs and an MIT property-test library.

maximum_iterations: 1

circuit_breaker: terminate on the first typed configuration or integrity failure

read_cost: $0

browser_reach: the core is portable behind a SourceReader

mobile_reach: generated Markdown is readable on mobile clients

offline_behavior: all fixture evaluation is local and network-free

## Environment Topology

| lane | owner | mutation |
|---|---|---|
| development | local operator | audit output only |
| production mirror | release controller | operator-gated |
| edge delivery | release controller | operator-gated |

| transition | deploy_boundary | evidence_reference | rollback | operator_approval |
|---|---|---|---|---|
| development to production mirror | `release-review` | `fixture-runtime-proof` | retain prior report | required |
| production mirror to edge delivery | `edge-review` | `fixture-integrity-proof` | retain prior mirror | required |

| component | connection_type | data_residency |
|---|---|---|
| Alignment Auditor | in-process function call | configured local workspace |
| SourceReader | read-only port | configured input roots |
| Report Writer | bounded write port | configured audit output |
