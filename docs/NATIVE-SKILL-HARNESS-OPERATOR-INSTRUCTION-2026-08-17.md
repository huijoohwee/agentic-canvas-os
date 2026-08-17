---
title: "Native Skill Harness Operator Instruction 2026-08-17"
graphId: "md:native-skill-harness-operator-instruction-2026-08-17"
doc_type: "Operator Instruction"
date: "2026-08-17"
lang: "en-US"
schema: "native-skill-harness-operator-instruction/v1"
frontmatter_contract: "required"
status: "approved"
---

# Native Skill Harness Operator Instruction

Instruction reference:
`operator://native-skill-harness/waive-prerequisite-gate-and-sequencing/2026-08-17`

## Decision

This instruction accepts two bounded decisions for the native skill creation
harness increment:

1. The sequencing order remains `after` the teardown effort recorded against
   `/Users/huijoohwee/Documents/GitHub/.worktrees/agentic-canvas-os/repository-teardown-20260816/.kiro/specs/repository-teardown/`.
2. The Prerequisite Gate may remain `waived` for this increment while the
   shipped default honestly reports the upstream runtime surfaces as
   unconfigured and provider execution as unverified.

## Accepted unmet prerequisite set

The waiver applies only when the unmet prerequisite set is exactly:

- `gateway-federation.function-calling-configured`
- `gateway-federation.function-calling-provider-execution`
- `gateway-federation.tool-search-configured`
- `gateway-federation.agent-definitions-configured`
- `gateway-federation.agent-definitions-provider-execution`
- `spend-safety.model-providers-configured`
- `spend-safety.model-providers-provider-execution`

## Scope

Allowed under this instruction:

- a `waived` prerequisite-gate record for the above unmet set
- a passing `npm run native-skill-harness:check` with the Worker still fail-closed
- contract documentation that names this instruction for the sequencing and
  prerequisite-gate decisions

Not allowed under this instruction:

- any `wrangler.jsonc` change
- any `configured: true` claim for `skillProposer`, `skillRegistryGate`, or
  `adapterRegistration`
- attaching a live model adapter in `worker/index.js`
- attaching a resolving operator-instruction resolver in `worker/index.js`
- any real promotion through the gate in the shipped default

## Rationale

The repository implementation and audits for the native skill creation harness
are complete in-tree, but the upstream runtime dependencies remain intentionally
unconfigured in the shipped default. This instruction accepts that state for the
`spec-complete` increment without reclassifying the runtime as `runtime-ready`.
