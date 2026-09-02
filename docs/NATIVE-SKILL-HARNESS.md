---
title: "Native Skill Harness Contract"
graphId: "md:native-skill-harness-contract"
doc_type: "Subsystem Contract"
date: "2026-08-17"
lang: "en-US"
schema: "native-skill-harness-contract/v1"
frontmatter_contract: "required"
status: "spec-complete"
---

# Native Skill Harness

This document records the blocked-by-default contract for the native skill
creation harness. The local rung is `spec-complete`. The delivered rung remains
`undocumented` until a named revision records a passing
`npm run native-skill-harness:check`, the entrypoint diff proof, the timed p95
result, and a Prerequisite Gate state of `satisfied` or `waived` under a named
operator instruction. The current named operator instruction is
`operator://native-skill-harness/waive-prerequisite-gate/2026-08-17`,
recorded in
`docs/NATIVE-SKILL-HARNESS-OPERATOR-INSTRUCTION-2026-08-17.md`.

## Decision 1: Draft store binding

- Chosen binding: reuse the existing `AGENT_STATE` Durable Object binding.
- Key namespaces:
  - `skill-draft:{draft_id}`
  - `skill-draft-index:{adapter_id}`
- Implementation owner:
  - `agent-api/src/durable-object-state-store.js`
  - `createDurableObjectSkillDraftStore(...)`
- Added Cloudflare bindings: `0`

Observed facts:

- `wrangler.jsonc` declares no KV namespace.
- `wrangler.jsonc` declares no D1 database.
- The chosen option adds zero bindings and stays within the existing
  `worker/agent-state.js` transaction boundary.
- The PRD topology row naming "Draft Registry Store - Existing KV/D1 namespace"
  is treated as an unverified claim because the checked-in Worker config does
  not declare either storage surface.

Rejected alternatives:

| Alternative | Rejected because |
|---|---|
| KV namespace | Would add a new binding and would not inherit the existing atomic claim and replace flow already proven by `AGENT_STATE`. |
| D1 database | Would add a new binding, schema surface, and migration burden for a feature that currently needs only bounded expiring draft records plus one adapter index. |
| New Durable Object class | Would preserve atomicity but still add a new binding and class lifecycle. If chosen later, the migration tag would follow `v2-agent-state` as `v3-skill-draft-store`. |

## Decision 2: Tool allowlist backing store

The Function Calling Gateway consults an in-Worker owner seeded from environment
variables, not a standalone writable store.

Observed path:

1. `agent-api/src/app.js` reads `KNOWGRPH_FUNCTION_TOOL_ALLOWLIST` and
   `KNOWGRPH_FUNCTION_REVIEW_REQUIRED`.
2. `parseKnowgrphFunctionToolAllowlist(...)` converts each env value into a
   token list at app construction time.
3. `agent-api/src/knowgrph-function-gateway.js` builds an in-memory `allowed`
   `Set` and dispatch checks `allowed.has(call.name)`.

Recorded answer: `environment variable seeding an in-Worker owner`.

Consequence:

- The shipped promotion gate cannot change production dispatch by itself.
- It can stage a tool allowlist entry and report
  `tool_allowlist_entry_staged: true`.
- Runtime application happens only when an explicit in-Worker allowlist owner
  with `add(...)` is injected.
- Therefore promotion remains approval-gated and deploy-sensitive by
  construction.

## Decision 3: Promotion record shape

`Promotion_Record` carries the four Deploy Boundary Contract fields verbatim
under a `boundary` object plus one sibling field, `proposing_mechanism`.

Why this shape:

- A promotion record cannot be forged to look operator-originated.
- The proposing mechanism remains machine-distinct from the promotion owner.
- ADR-1's by-construction independence claim becomes checkable at schema level
  rather than only by procedural narrative.

Invariant asserted before emission:

- `proposing_mechanism.identity !== PROMOTION_GATE_IDENTITY`

The nested shape is preferred over widening the shared four-field boundary
contract because the boundary fields stay stable while the sibling field names
the non-operator mechanism that produced the draft.

## Decision 4: Token namespace reconciliation

`/skill.propose` and `/propose-skill` both survive in this increment.

| Token | Owner | Tool identity | Typed arguments | Artifact produced | Promotion owner | Trust boundary |
|---|---|---|---|---|---|---|
| `/skill.propose` | Skill Evolution contract | `agenticgraph.skill.evolve` | skill text evolution inputs | `skill-text` proposal | `/skill.manage` | review-gated |
| `/propose-skill` | ACOS Skill Proposer | `acos.skill_proposer.propose` | `{ gap_signal }` | `agent-definition` draft | `acos-skill-registry-gate` | approval-gated |

Bindings remain distinct:

- `@skill-catalog`: skill text contract catalog rooted in `docs/SKILLS.md`
- `@skill-registry`: in-Worker Agent Definition registry plus the
  `Active_Registry_Snapshot`

Residual risk:

- The two command names are homographs at a glance.
- Recommended follow-on rename, kept out of this increment:
  `/skill.draft-definition`

## Decision 5: Ownership boundary with Skill Evolution

| Artifact type | Proposal owner | Promotion owner |
|---|---|---|
| `skill-text` | Skill Evolution contract | `/skill.manage` |
| `agent-definition` | Skill Proposer | Promotion Gate |

Additional ownership rules:

- Promotion Gate and `/skill.manage` are distinct owners.
- This feature introduces no second Agent Definition registry.
- `docs/SKILL-EVOLUTION.md` keeps the existing `applied`,
  `modelWeightsMutated`, and `deploymentAttempted` flag semantics unchanged.
- The ownership audit counts one exported artifact-type declaration per code
  owner and one literal artifact-type entry for the existing skill-text owner.

## Decision 6: Latency threshold

- Declared p95 gap-to-draft threshold: `12000 ms`
- Declared per-iteration sub-threshold: `2500 ms`
- Source of truth: `SKILL_PROPOSER_DEFAULTS`

Derivation:

- at most `5` iterations
- at most one model call per iteration
- `800` prompt tokens max
- `400` completion tokens max
- `40 percent` cache-hit target

No authoritative external source states a native-skill-harness latency target,
so the threshold is a repository decision recorded honestly. The timed test must
report the observed p95 next to the declared threshold rather than claiming live
proof from prose alone.

## Decision 7: Product module budget

Recorded accounting:

- Pre-feature baseline: `59` `agent-api/src/` modules
- Pre-feature line count across `worker/`, `src/`, and `agent-api/src/`:
  `19,834`
- Post-feature projection: `63` `agent-api/src/` modules and roughly `21,100`
  lines, plus four scripts and the focused new tests
- The fourth added module is `agent-api/src/tool-search-config.js`, introduced
  so a fully configured upstream runtime can report `toolSearch.configured`
  truthfully without changing the shipped fail-closed default

Ownership decision:

- `tool-search.js` and the Agent Definition registry are statically imported by
  `worker/index.js` and reported at `GET /api/ready`, so the dependency base is
  already on a Proven Path and remains the single product owner.
- Each proposed module must justify its net product value and preserve an
  acyclic dependency graph; repository lifecycle stays with pinned `agentic-os`.

## Decision 8: TCO and rollback

Recorded cost and rollback position:

- Cloudflare bindings added to `wrangler.jsonc`: `0`
- New vendor added: `0`
- New external service boundary added: `0`
- Projected incremental monthly infrastructure cost: `USD 0.00`
- Projected token cost while no provider is configured: `USD 0.00`

Rollback statement:

- The draft record schema is additive.
- The Agent Definition `status` field is additive.
- Rolling back to the pre-feature Worker build requires no data migration.
- Draft records expire within 30 days under the inherited
  `MAX_RECORD_TTL_MS` cap.

## Component inventory

| Component | Local rung | Delivered rung | Evidence reference | Operator instruction | Notes |
|---|---|---|---|---|---|
| Prerequisite Gate record and check | spec-complete | undocumented | `npm run native-skill-harness:check` in the current workspace proves the waived gate record recomputes and emits cleanly. | `operator://native-skill-harness/waive-prerequisite-gate/2026-08-17` | Waived for this increment only; gated follow-on remains closed. |
| Draft Registry Store | spec-complete | undocumented | none yet | none | Reuses `AGENT_STATE`; no binding added. |
| Skill Proposer | spec-complete | undocumented | none yet | none | Writes only `status: proposed` drafts. |
| Skill Registry Promotion Gate | spec-complete | undocumented | none yet | none | Closed by default; no model call capability. |
| Adapter Registration Interface | spec-complete | undocumented | none yet | none | Shared entrypoint remains adapter-agnostic. |
| Invocation Register additions | spec-complete | undocumented | none yet | none | `/propose-skill`, `#skill-candidate`, `@skill-registry`, and three MCP tool ids. |

## Deploy boundary register

| Boundary | From | To | Evidence reference | Operator instruction | Rollback statement | State |
|---|---|---|---|---|---|---|
| Authoring to Mirror | Authoring | Mirror | unchanged | unchanged | unchanged | unchanged |
| Mirror to Delivery | Mirror | Delivery | unchanged | unchanged | unchanged | unchanged |
| Skill Registry Promotion | Draft | Active | none yet | none | Re-register the affected definition at its prior revision with status proposed, remove the added tool allowlist entry, and assert the Active Registry Snapshot serialization equals the recorded pre-promotion value. Schema additions are additive, so no data migration is required. | closed |
| Adapter Registration | Adapter | Active | none yet | none | Remove the registered definition by id and revision through the registry's existing `remove`, drop the added allowlist entry, and assert the snapshot serialization matches the recorded pre-registration value. | closed |

## Runtime-ready raise criteria

Raising this subsystem above `spec-complete` requires all of:

1. a recorded passing run of `npm run native-skill-harness:check` at a named revision
2. the shared entrypoint diff proof
3. the timed p95 result next to the declared `12000 ms` threshold
4. a Prerequisite Gate state of `satisfied` or `waived`
5. a named operator instruction covering that prerequisite decision
