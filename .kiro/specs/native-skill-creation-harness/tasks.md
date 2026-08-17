# Implementation Plan: Native Skill Creation Harness

## Overview

Implementation language is JavaScript (ES modules, Node 22 built-ins), matching the design's concrete
module signatures and the existing `agent-api/src/` conventions: `createXRuntime` / `createXRegistry`
factories returning `Object.freeze({...})`, typed error classes carrying `reasonCode` and `details`,
`assertExactKeys` strict-key validation, per-env construction in `worker/index.js` injected into
`createAgentApiApp`, readiness stats surfaced at `GET /api/ready`, and tests run as
`node --test __tests__/*.test.mjs`, network-free and deterministic.

No new runtime or dev dependency. Node 22 built-ins plus the existing `ajv 8.20.0` and
`fast-check 3.23.2`.

### Ordering rationale

1. The schema extension and the `Active_Registry_Snapshot` serializer come first (Task 3). Every
   "diff is empty" verification condition in the PRD is expressed as byte equality of
   `registry.snapshot().serialization`, so nothing else in this plan is verifiable until it exists and
   is deterministic.
2. The Prerequisite_Gate record and its check come first alongside it (Task 1), because Requirement 1
   is a blocking entry condition and its computed state governs what is permitted to land.
3. Evaluator independence is established while the modules are written, not audited afterward. The
   proposer and the gate are separate files created in separate tasks with no import edge in either
   direction, and the import-graph check (Task 11.1) runs once both files exist.
4. Recorded decisions are real tasks (Task 2). Each writes its decision into
   `docs/NATIVE-SKILL-HARNESS.md`, the repository document that carries this subsystem's contract,
   readiness rung, and deploy boundary register.

### Prerequisite gating

The Prerequisite_Gate computed state is `blocked` today: the repository reports `configured: false`
and `providerExecutionStatus: "unverified"` for the Gateway federation and model provider pointers the
gate reads. Every numbered task in this plan is permitted while the state is `blocked`, because the
plan is contract, schema, validator, test surface, audit script, and `configured: false` wiring only.
That is deliberate and is the permitted set the design names.

Nothing in the numbered plan is permitted to:

- change `wrangler.jsonc`;
- attach a live model adapter or a resolving operator instruction resolver in `worker/index.js`;
- report anything other than `configured: false` for `skillProposer`, `skillRegistryGate`, and
  `adapterRegistration`;
- reach `promote` with a resolvable Operator_Instruction_Reference outside a test fake.

Work that requires the state to be `waived` or `satisfied` is listed in the "Gated follow-on" section
at the end and is not part of this increment.

### Honest limits carried into the plan

- No model provider is configured. The proposer's model-bearing path is the injected
  `proposeCandidate` adapter, exercised only by scripted stubs. No task claims end-to-end provider
  proof.
- No Evidence Reference exists for any component here. No task fabricates one. The feature ships at
  local rung `spec-complete` and delivered rung `undocumented`; raising the rung requires cited
  passing test commands per `docs/RUNTIME-READINESS.md`.
- The design names a single test file `__tests__/native-skill-harness.test.mjs`. This plan splits the
  test surface per module (`-prerequisite-gate`, `-registry-snapshot`, `-draft-store`, `-proposer`,
  `-gate`, `-registration`, `-structure`, `-latency`) to match the repository's per-module test file
  convention and to keep the tasks independently executable. `native-skill-harness:check` lists them
  all.

## Tasks

- [ ] 1. Prerequisite entry condition
  - [ ] 1.1 Create the Prerequisite_Gate record
    - Create `scripts/native-skill-harness/prerequisite-gate.json` with `schema:
      "acos-prerequisite-gate/v1"`, `feature: "native-skill-creation-harness"`, and the seven
      prerequisite entries, each carrying `name`, `readiness_pointer`, `expected`, `observed`,
      `evidence_reference`, and `met`
    - Pointers: `/functionCalling/configured`, `/functionCalling/providerExecutionStatus`,
      `/toolSearch/configured`, `/agentDefinitions/configured`,
      `/agentDefinitions/providerExecutionStatus`, `/modelProviders/configured`,
      `/modelProviders/providerExecutionStatus`
    - Record the observed repository values, the resulting `state: "blocked"`, the `unmet` name array,
      an empty `accepted_unmet`, a null `operator_instruction_reference`, and the
      `observation_gap` string stating that no dedicated spend-safety readiness key exists and that
      the `modelProviders` fields are used as a proxy
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Implement the prerequisite gate check script
    - Create `scripts/native-skill-harness-prerequisite-gate.mjs` that reads the record, resolves each
      JSON pointer against a `GET /api/ready` body supplied as a file for offline runs or fetched when
      a URL argument is given, recomputes `state`, and exits non-zero when the recorded state differs
      from the computed state
    - Compute `satisfied` only when every pointer resolves and every observed value equals its
      expected value; compute `waived` only when the state is otherwise `blocked`, an
      `operator_instruction_reference` is present, and `accepted_unmet` equals the computed unmet set
      exactly; compute `blocked` in every other case
    - On failure, name each unmet prerequisite with its pointer and observed value
    - Emit the record for the `waived` and `satisfied` states with the state, prerequisite list, each
      Evidence Reference, and the operator instruction reference when waived
    - _Requirements: 1.2, 1.4, 1.5_

  - [ ] 1.3 Encode and enforce the blocked-state build permission lists
    - Add `permitted_while_blocked` and `forbidden_while_blocked` string arrays to the record,
      transcribing the design's permitted set (module files, validators, typed errors, frozen result
      shapes, the status field and snapshot, the draft store factory, tests, audits, readiness keys
      reporting `configured: false`, the gate record and its check) and the forbidden set
      (`wrangler.jsonc` changes, a live model adapter in `worker/index.js`, any resolvable promotion
      path, any non-`configured: false` claim for the three new keys)
    - Extend the check script so that when the state is `blocked` it asserts `wrangler.jsonc` is
      byte-identical to its recorded pre-feature digest and that the three new readiness keys report
      `configured: false`
    - _Requirements: 1.3, 22.1, 22.2_

  - [ ]* 1.4 Write property test for prerequisite gate state computation
    - **Property 15: Prerequisite gate state computation**
    - **Validates: Requirements 1.2, 1.4**
    - Create `__tests__/native-skill-harness-prerequisite-gate.test.mjs`; generator is a boolean array
      over the seven prerequisites, an arbitrary subset of prerequisite names as `accepted_unmet`, and
      an optional reference string; `numRuns: 100` minimum with a recorded fixed seed

  - [ ]* 1.5 Write unit tests for prerequisite record emission
    - Assert one `waived` record and one `satisfied` record each carry exactly the declared field set
    - Assert a waiver whose `accepted_unmet` set is stale relative to the computed unmet set fails the
      check
    - _Requirements: 1.4, 1.5_

- [ ] 2. Recorded decisions
  - [ ] 2.1 Create the harness contract document and record the draft store binding decision
    - Create `docs/NATIVE-SKILL-HARNESS.md` with the frontmatter keys `scripts/docs-contract.mjs`
      requires (`title`, `graphId`, `doc_type`, `date`, `lang`, `schema`, `frontmatter_contract`,
      `status`), pure ASCII, under 600 lines
    - Record Decision 1: the Draft_Registry_Store reuses the existing `AGENT_STATE` Durable Object
      binding with the key namespaces `skill-draft:{draft_id}` and
      `skill-draft-index:{adapter_id}`, implemented as one new factory in
      `agent-api/src/durable-object-state-store.js`
    - State the observed fact that `wrangler.jsonc` declares no KV namespace and no D1 database, state
      that the chosen option adds zero bindings, state the rejected alternatives with their tradeoffs,
      and name `v3-skill-draft-store` as the migration tag that would follow `v2-agent-state` if a new
      Durable Object class were chosen instead
    - Record that the PRD topology row naming "Draft Registry Store - Existing KV/D1 namespace" is
      treated as an unverified claim
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 2.2 Determine and record the tool allowlist backing store
    - Resolve the open question by inspecting `wrangler.jsonc` (`env.dev.vars`), the
      `function-calling*.js` family, and `worker/index.js` for every read of
      `KNOWGRPH_FUNCTION_TOOL_ALLOWLIST` and `KNOWGRPH_FUNCTION_REVIEW_REQUIRED`, and record which
      surface actually backs the allowlist that the Function Calling Gateway consults at dispatch
    - Record the answer in `docs/NATIVE-SKILL-HARNESS.md` as one of: an environment variable only, an
      in-Worker owner module only, or an environment variable seeding an in-Worker owner
    - Record the consequence explicitly: if the production allowlist is an environment variable, then
      the gate can only stage an allowlist entry and promotion is a deploy-time change, so the gate
      emits `tool_allowlist_entry_staged` alongside the promotion record; if an in-Worker owner backs
      it, the gate adds the entry at runtime
    - Task 8.2 implements whichever behavior this task records
    - _Requirements: 8.4, 8.6_

  - [ ] 2.3 Record the Promotion_Record field decision
    - Record Decision 2: `Promotion_Record` carries the four Deploy_Boundary_Contract fields verbatim
      nested under a `boundary` key, plus one sibling field `proposing_mechanism` naming the proposing
      mechanism module and identity
    - State the rationale (a promotion record cannot be forged to look operator-originated, and
      ADR-1's by-construction independence claim becomes machine-checkable), state why nesting is
      chosen over widening the shared four-field shape, and note that ADR-1 favors schema-level over
      procedural distinctness
    - State the invariant the gate asserts before emission:
      `proposing_mechanism.identity !== PROMOTION_GATE_IDENTITY`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 2.4 Record the token namespace reconciliation
    - Record Decision 3: `/skill.propose` and `/propose-skill` both survive with distinct owners and
      distinct typed argument types, and record the comparison table (owner, tool identity, typed
      arguments, artifact produced, promotion owner, trust boundary) for both
    - Record that `@skill-registry` and `@skill-catalog` remain distinct bindings, with
      `@skill-catalog` resolving to the skill text contract catalog rooted in `docs/SKILLS.md` and
      `@skill-registry` resolving to the in-Worker Agent Definition registry plus its
      `Active_Registry_Snapshot` projection
    - Record the residual homograph risk and the recommended follow-on rename to
      `/skill.draft-definition` as out of scope for this increment
    - _Requirements: 15.6, 15.7, 15.8_

  - [ ] 2.5 Record the ownership boundary with the Skill Evolution contract
    - Record Decision 4 as a table keyed by artifact type: `skill-text` proposals are owned by the
      Skill Evolution contract with `/skill.manage` as promotion owner; `agent-definition` proposals
      are owned by Skill_Proposer with Promotion_Gate as promotion owner
    - State that Promotion_Gate and `/skill.manage` are distinct owners and name the artifact type
      each governs
    - State that this feature introduces no second Agent Definition registry and leaves the
      `applied`, `modelWeightsMutated`, and `deploymentAttempted` flag semantics in
      `docs/SKILL-EVOLUTION.md` unchanged
    - Declare the exported `artifactType` constant convention the ownership audit in Task 11.3 counts
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6_

  - [ ] 2.6 Record the latency threshold decision
    - Record Decision 5: a p95 gap-to-draft threshold of 12000 ms with a declared per-iteration
      sub-threshold of 2500 ms, both held in `SKILL_PROPOSER_DEFAULTS` so revision is a one-line change
    - Record the derivation from the loop shape (at most 5 iterations, one model call each, 800 prompt
      and 400 completion tokens at a 40 percent cache-hit target), the stated assumptions, and that no
      authoritative source states a latency value
    - Record that the timed test reports the observed p95 next to the threshold
    - _Requirements: 18.1, 18.2_

  - [ ] 2.7 Record the module budget and sequencing accounting
    - Record the pre-feature baseline of 59 `agent-api/src/` modules and 19,834 lines across
      `worker/`, `src/`, and `agent-api/src/`, and the projection after this feature (63 modules,
      roughly 21,100 lines, plus 4 scripts and the new test files)
    - Record the sequencing decision that this feature ships after the teardown effort, that the
      decision is made against the task-branch version of the `repository-teardown` spec at
      `/Users/huijoohwee/Documents/GitHub/.worktrees/agentic-canvas-os/repository-teardown-20260816/.kiro/specs/repository-teardown/`
      rather than a merged version, and that the operator instruction accepting that order does not
      exist yet
    - Record the mitigating fact that `tool-search.js` and the Agent Definition registry are
      statically imported by `worker/index.js` and reported at `GET /api/ready`, classifying them as
      Proven_Path so the dependency base survives the teardown
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 2.8 Record the TCO and rollback statement
    - Record zero Cloudflare bindings added to `wrangler.jsonc`, no new vendor, no new external
      service boundary, and USD 0.00 projected incremental monthly infrastructure cost, so no
      operator instruction accepting a cost is required
    - Record the token cost projection and that it is zero while no provider is configured
    - Record the rollback statement: the draft record schema and the `status` field are additive,
      rollback to the pre-feature Worker build requires no data migration, and draft records expire
      within 30 days under the inherited `MAX_RECORD_TTL_MS` cap
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [ ] 3. Agent Definition schema extension and deterministic snapshot
  - [ ] 3.1 Add the status field with default-to-active
    - In `agent-api/src/agent-definitions.js`, export
      `AGENT_DEFINITION_STATUSES = Object.freeze(["proposed", "active", "deprecated"])`, add
      `"status"` to the `assertExactKeys` allow list in `normalizeDefinition`, and add
      `normalizeStatus(value)` returning `"active"` for `undefined` and throwing a `TypeError` for any
      value outside the enum
    - Include `status: normalizeStatus(value.status)` in the object passed to `normalizeJson`, written
      last so the projected field order matches the snapshot's declared order
    - Leave `register`'s signature and revision-conflict semantics unchanged, so re-registering the
      same id and revision with a different `status` is an `agent_revision_conflict` rather than a
      silent status change
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 Add the Active_Registry_Snapshot serializer
    - Export `ACTIVE_REGISTRY_SNAPSHOT_SCHEMA = "acos-active-registry-snapshot/v1"` and add
      `snapshot()` to the frozen registry object, returning `{ schema, agents, serialization }`
    - Implement the canonical serialization exactly as specified: membership limited to
      `status === "active"`; entries sorted ascending by `id` using default string sort, never
      `localeCompare`; fields written by explicit projection in the fixed order `id`, `revision`,
      `name`, `source`, `model`, `instructions`, `tools`, `guardrails`, `mcpServers`, `handoffs`,
      `output`, `status`; array member order preserved; `JSON.stringify` with no `space` argument, one
      line, no trailing newline; no timestamp, counter, `stats()` value, host identifier, or
      self-digest
    - Add an optional sha-256 digest helper for logging only, and keep equality decided by string
      comparison so a diff reports which bytes differed
    - _Requirements: 2.6_

  - [ ] 3.3 Exclude non-active definitions from dispatch and report status counts
    - Add an early check in `prepare` returning the existing `blocked(...)` shape with
      `reasonCode: "agent_not_active"` for any record whose `status` is not `"active"`
    - Add `statusCounts: { proposed, active, deprecated }` and
      `snapshotDigestAlgorithm: "sha-256"` to `stats()`, keeping the existing fields and limits
      unchanged so `statusCounts` values sum to `stats().agents`
    - _Requirements: 2.4, 2.5_

  - [ ] 3.4 Pin the pre-feature dispatch path against the status default
    - Create `__tests__/native-skill-harness-registry-snapshot.test.mjs` with a test that registers a
      definition carrying no `status` key and asserts the stored record's `status` equals `"active"`,
      that the id appears in `snapshot()`, that `snapshot().agents` is non-zero, and that `prepare()`
      does not return `agent_not_active`
    - Run `npm run agent-definitions:check`, `npm run function-gateway:check`, and
      `npm run autonomous-runtime:check` and fix any regression, so the function-calling path that has
      a recorded live proof in `docs/LIVE-REVIEWED-FUNCTION-PROOF.md` keeps dispatching
    - _Requirements: 2.3, 2.4_

  - [ ] 3.5 Create the shared test fake library and snapshot diff harness
    - Create `__tests__/lib/native-skill-harness-fakes.mjs` exporting: an in-memory draft store that
      records every invoked method name and honors `expiresAt`; a scripted candidate adapter driven by
      an outcome marker sequence over `{ valid, malformed, throws }`; recording `emitTrace` and
      `emitCostLog` observers with an optional throw mode; an in-memory tool allowlist with `add`,
      `has`, `snapshot`; an operator instruction resolver with a configurable resolvable set; an
      invocation register fake with `declares(token)`; and a fixed clock
    - Export `captureSnapshot(registry)` and `assertSnapshotUnchanged(before, after)` helpers that
      compare `registry.snapshot().serialization` strings and, on failure, report the first differing
      byte offset rather than only a digest
    - No network access and no Durable Object access anywhere in the library
    - _Requirements: 2.6, 3.2, 9.1_

  - [ ]* 3.6 Write property test for snapshot canonicality
    - **Property 1: Snapshot canonicality and insertion-order independence**
    - **Validates: Requirements 2.6**
    - Generator is an array of distinct valid definitions plus a permutation index array; assert the
      two registries' `serialization` strings are byte-equal and that two consecutive `snapshot()`
      calls on either registry are byte-equal; `numRuns: 100` minimum with a recorded fixed seed

  - [ ]* 3.7 Write property tests for the status lifecycle
    - **Property 2: Status round trip with default-to-active**
    - **Validates: Requirements 2.1, 2.3**
    - **Property 3: Invalid status is rejected inertly**
    - **Validates: Requirements 2.2**
    - **Property 4: Non-active definitions are invisible to snapshot, dispatch, and counts**
    - **Validates: Requirements 2.4, 2.5**
    - The three share the valid-definition-plus-status generator family: an optional status from the
      enum for Property 2, `fc.anything()` filtered to exclude the four accepted values for Property 3,
      and an array of `{ definition, status }` pairs for Property 4; each assertion runs against a
      pre-populated registry with `captureSnapshot` before and after

  - [ ]* 3.8 Write unit tests for the strict validators
    - Assert `normalizeStatus` rejects near-miss casings and padded strings with a `TypeError` naming
      the field
    - Assert each strict-key validator rejects one unknown field with a message naming that field
    - _Requirements: 2.1, 2.2_

- [ ] 4. Checkpoint - snapshot and schema foundation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Draft registry store
  - [ ] 5.1 Add the skill draft store factory
    - Add `createDurableObjectSkillDraftStore({ namespace })` to
      `agent-api/src/durable-object-state-store.js`, following the six existing factories: derive the
      Durable Object identity from the scope strings `skill-draft:{draft_id}` and
      `skill-draft-index:{adapter_id}`, and expose `put`, `peek`, `markConsumed`, `indexAppend`,
      `indexList`, `stats` on a frozen object
    - Perform exactly one `put` per draft write so atomicity is inherited from the Durable Object
      `transact` boundary in `worker/agent-state.js` rather than rebuilt
    - Set `expiresAt` to `now + draftTtlMs` bounded by `MAX_RECORD_TTL_MS`, record the value on the
      record as `expires_at_ms`, and return null from `peek` for a record past its expiry
    - Reject an index write beyond a declared maximum of 64 draft ids per adapter
    - Add no `wrangler.jsonc` change and no new binding
    - _Requirements: 6.1, 6.3, 7.1, 7.2, 19.1_

  - [ ] 5.2 Implement the store key-prefix uniqueness check
    - Create `__tests__/native-skill-harness-structure.test.mjs` with a check that parses every store
      factory scope prefix in `durable-object-state-store.js` and asserts the set is unique, so a
      future factory cannot silently reuse `skill-draft:` or `skill-draft-index:`
    - _Requirements: 7.1_

  - [ ]* 5.3 Write unit tests for draft store lifetime and index bounds
    - Create `__tests__/native-skill-harness-draft-store.test.mjs` asserting the 30-day TTL ceiling is
      honored, an expired record reads as absent, `markConsumed` is the only mutation the gate needs,
      and an index append past 64 entries is rejected
    - _Requirements: 6.3, 7.1_

- [ ] 6. Skill_Proposer harness
  - [ ] 6.1 Create the proposer module contract
    - Create `agent-api/src/skill-proposer.js` exporting `SkillProposalBlock` (extending `Error` with
      `name`, `reasonCode`, `details`), `SKILL_PROPOSER_DEFAULTS` with `iterationBound: 5`,
      `circuitBreakerConsecutiveNoCandidate: 2`, `maxPromptTokens: 800`, `maxCompletionTokens: 400`,
      `cacheHitTarget: 0.4`, `p95GapToDraftMs: 12000`, `perIterationMs: 2500`, and a 30-day
      `draftTtlMs`, and `createSkillProposerRuntime(...)` returning `Object.freeze({ propose, stats })`
    - Implement the Gap_Signal strict validator over
      `{ schema, signal_id, adapter_id, capability, missing_tool_names, denial_reason_code,
      observed_at_ms, evidence_reference }`, rejecting an empty or duplicated
      `missing_tool_names` array
    - Implement the pure `gapSignalFromToolSearchDenial(denial, context)` helper mapping an observed
      `{ authorized: false, reasonCode }` result plus caller context into a Gap_Signal, and record in
      the module comment that nothing calls it today
    - Import nothing from `agent-definitions.js`, `skill-registry-gate.js`, or
      `adapter-registration.js`, and take the model call as the injected `proposeCandidate` adapter so
      no provider credential and no `fetch` reaches this module
    - _Requirements: 3.4, 3.6, 4.5, 5.2, 11.2_

  - [ ] 6.2 Implement the bounded loop, circuit breaker, and trace emission
    - Run at most `iterationBound` iterations per Gap_Signal; stop after
      `circuitBreakerConsecutiveNoCandidate` consecutive no-candidate iterations recording
      `circuit_breaker: "tripped"` and `stop_reason: "circuit_breaker_tripped"`; stop at the bound with
      `stop_reason: "iteration_bound_reached"`
    - Append exactly one Trace_Log entry per call with `schema: "acos-skill-proposer-trace/v1"`, the
      `iteration_count`, the configured `iteration_bound`, the circuit breaker state, the stop reason,
      the literal `approval_status: "skill-creation: unapproved"`, a finite non-negative `elapsed_ms`
      measured from Gap_Signal receipt, `cost_log_emitted`, and `observation_gap`
    - Wrap `emitTrace` in `try`/`catch` so an observer failure never changes a terminal outcome
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 18.1_

  - [ ] 6.3 Implement the token budget pre-check and cost logging
    - Estimate prompt and completion tokens before each adapter call and, on a breach of 800 or 400,
      stop before the call, return a typed budget-breach result, leave the draft store unchanged, and
      record `stop_reason: "budget_breach"`
    - Emit one Cost_Log_Entry per completed model call with a key set exactly
      `{ model, prompt_tokens, completion_tokens, cache_hits, estimated_cost_usd }`, using
      `model: "unreported"` with null numerics when the adapter reports no usage and
      `model: "not-run"` with zeros for the not-run path
    - Tolerate an `emitCostLog` failure: continue the pipeline and set a non-null `observation_gap` on
      the trace entry
    - Implement the p95 `estimated_cost_usd` sampler and the breach boolean against the declared
      per-call budget as a pure exported function
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

  - [ ] 6.4 Implement the draft write and the all-or-nothing terminal outcomes
    - Normalize each candidate against the Draft_Definition shape and discard a malformed candidate
      before any store call, counting the iteration as no-candidate and continuing within the bound
    - On acceptance, write exactly one Draft_Definition with `schema: "acos-skill-draft/v1"`,
      `status: "proposed"`, `consumed: false`, the `proposing_mechanism` module and identity,
      `created_at_ms`, and `expires_at_ms`, then append the draft id to the adapter index
    - Return `{ draft_agent_definition, rationale, confidence }` on success and a typed no-draft result
      otherwise, including `reasonCode: "provider_unreachable"` when the injected adapter throws, with
      no draft persisted
    - Expose no function that writes to the active registry, and treat an absent operator approval as
      the normal terminal outcome rather than a failure
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 6.1, 6.2, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 6.5 Write property tests for proposer inertness, bounds, and atomicity
    - **Property 5: Proposer inertness and observable unapproved terminal outcome**
    - **Validates: Requirements 1.3, 3.2, 9.1, 9.2, 9.3, 9.4**
    - **Property 6: Bounded termination with observable stop state**
    - **Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.4, 18.1**
    - **Property 9: All-or-nothing draft persistence**
    - **Validates: Requirements 3.1, 3.5, 5.4, 6.1, 6.2, 6.3**
    - Create `__tests__/native-skill-harness-proposer.test.mjs`; the three share the candidate outcome
      marker sequence generator over `{ valid, malformed, throws }` with lengths 0 to 20, plus emitter
      failure booleans and a pre-populated registry and allowlist; assert at most one `put` per call
      and that exactly one of the two end states holds, never both and never neither

  - [ ]* 6.6 Write property tests for field exactness and fail-before-spend
    - **Property 7: Result and cost log field exactness**
    - **Validates: Requirements 3.4, 5.1**
    - **Property 8: Fail before spend**
    - **Validates: Requirements 4.5, 5.3**
    - Property 7 uses an adapter usage report generator over
      `{ complete, missing_fields, extra_fields, non_numeric, absent }`; Property 8 uses
      `fc.anything()` for the invalid-signal branch and integer pairs spanning 0 to 2000 so the
      boundaries at exactly 800 and exactly 400 are hit, asserting zero adapter calls and zero
      Cost_Log_Entry values on the invalid-signal branch

  - [ ]* 6.7 Write unit tests for the declared constants and the p95 cost decision
    - Assert `SKILL_PROPOSER_DEFAULTS` holds `maxPromptTokens: 800`, `maxCompletionTokens: 400`,
      `cacheHitTarget: 0.4`, and `p95GapToDraftMs: 12000`
    - Assert the percentile computation and breach boolean over a fixed cost series
    - Assert `SkillProposalBlock` extends `Error` and sets `name`, `reasonCode`, and `details`
    - _Requirements: 5.2, 5.5, 18.2_

  - [ ]* 6.8 Write the timed p95 gap-to-draft test
    - Create `__tests__/native-skill-harness-latency.test.mjs` running a fixed number of full bounded
      loops against the scripted stub adapter, computing the observed p95 elapsed value, reporting it
      next to the declared 12000 ms threshold in the assertion message, and failing only on a
      threshold breach
    - Keep the run deterministic and network-free; no provider is contacted and no end-to-end provider
      claim is made
    - _Requirements: 18.1, 18.2_

- [ ] 7. Checkpoint - proposer contract complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Skill registry promotion gate
  - [ ] 8.1 Create the gate module closed by default
    - Create `agent-api/src/skill-registry-gate.js` exporting `PromotionBlock`,
      `PROMOTION_ARTIFACT_TYPE = "agent-definition"`,
      `PROMOTION_BOUNDARY_NAME = "skill-registry-promotion"`,
      `PROMOTION_GATE_IDENTITY = "acos-skill-registry-gate"`, and
      `createSkillRegistryGate(...)` returning
      `Object.freeze({ promote, boundaryState, stats })`
    - Return `"closed"` from `boundaryState(draft_id)` unless the supplied reference resolves, and
      reject unknown factory options through strict-key validation so no configuration value,
      environment variable, or flag can open the boundary
    - Reject `promote` with `reason_code: "operator_instruction_unresolved"` for an absent, empty,
      whitespace-only, or unresolved reference, leaving the snapshot and the allowlist byte-identical
    - Accept no model-adapter-shaped and no `fetch`-shaped parameter, and import nothing from
      `skill-proposer.js`
    - _Requirements: 8.1, 8.2, 8.3, 11.2, 11.4, 22.1, 22.2_

  - [ ] 8.2 Implement the promotion transition
    - On a resolved reference and an existing unconsumed draft, register the draft's Agent Definition
      at a new revision with `status: "active"` so its id appears in the snapshot, then call
      `markConsumed` on that single draft and nothing else on the draft store
    - Produce the tool allowlist entry with `entry_id`, `agent_definition_id` equal to the promoted
      definition's `id`, `adapter_identity`, `tool_names`, and `review_required`, applying it through
      the injected `toolAllowlist.add` or staging it, per the backing store answer recorded in Task 2.2
    - Return blocked outcomes with `reason_code: "draft_not_found"` for an unknown or expired draft and
      `reason_code: "draft_already_consumed"` for a consumed draft, so a retry cannot double-promote
    - Derive every part of the decision from the stored draft and the resolved reference, never from a
      value supplied by a proposer call frame
    - _Requirements: 8.4, 8.6, 8.7, 11.3, 11.5_

  - [ ] 8.3 Implement the Promotion_Record emission
    - Emit one Promotion_Record with `boundary` carrying exactly
      `{ name, evidence_reference, operator_instruction_reference, rollback_statement }` and a sibling
      `proposing_mechanism` naming the proposing module and identity, with `evidence_reference` set to
      null when none exists
    - Write the rollback statement from the deploy boundary register: re-register the affected
      definition at its prior revision with `status: proposed`, remove the added allowlist entry, and
      assert the snapshot `serialization` equals the recorded pre-promotion value
    - Assert `proposing_mechanism.identity !== PROMOTION_GATE_IDENTITY` before emission and throw
      `PromotionBlock("proposer_identity_collision")` with no registry write on violation
    - Return the frozen `PromotionOutcome` shape with null `promotion_record` on a blocked outcome and
      null `reason_code` on a promoted outcome
    - _Requirements: 8.5, 10.1, 10.4_

  - [ ]* 8.4 Write property tests for the promotion boundary
    - **Property 10: Promotion closed by default**
    - **Validates: Requirements 8.1, 8.2, 8.3, 22.1, 22.2**
    - **Property 11: Promotion record completeness and provenance invariance**
    - **Validates: Requirements 8.4, 8.5, 8.6, 10.1, 10.4, 11.3**
    - **Property 12: Promotion is the sole proposed-to-active transition**
    - **Validates: Requirements 6.4, 8.7**
    - Create `__tests__/native-skill-harness-gate.test.mjs`; the three share the draft-plus-reference
      generator family: arbitrary non-resolvable reference values and arbitrary extra option bags for
      Property 10, a valid draft with a write-provenance boolean for Property 11, and an operation
      marker array over `{ propose, register }` containing no `promote` call for Property 12

  - [ ]* 8.5 Write unit tests for the fresh gate and expired drafts
    - Assert `boundaryState()` on a newly constructed gate returns `"closed"`
    - Assert an expired draft and a consumed draft each produce their typed blocked reason code with a
      byte-identical snapshot
    - _Requirements: 8.1, 8.7_

- [ ] 9. Adapter registration interface
  - [ ] 9.1 Create the registration module contract
    - Create `agent-api/src/adapter-registration.js` exporting
      `REGISTRATION_FINDING_TYPES = Object.freeze(["unfederated-tool", "uncatalogued-tool"])`,
      `RegistrationBlock`, and `createAdapterRegistrationInterface(...)` returning
      `Object.freeze({ register, stats })`
    - Implement
      `register(agent_definition, tool_allowlist_entry, invocation_register_entry, operator_instruction_ref)`
      so the PRD's two-argument shape is a prefix of the signature, and require all three parts
    - Emit a Registration_Record with `schema: "acos-adapter-registration/v1"`, the adapter identity,
      the registered Agent Definition identity, the tool allowlist entry identity, the invocation
      register tokens, the resulting status, the operator instruction reference, and
      `registered_at_ms`, constructed and frozen only after the registry write returns
    - _Requirements: 13.1, 14.1, 14.5_

  - [ ] 9.2 Implement typed finding classification
    - Return `{ status: "rejected", record: null, finding }` with `type: "unfederated-tool"` when the
      tool allowlist part is absent or malformed, and `type: "uncatalogued-tool"` when the invocation
      register entry is absent, malformed, or fails `invocationRegister.declares(token)` for any of
      route, tag, binding, or tool identity
    - Catch the registry's own `normalizeDefinition` `TypeError` and convert it to an
      `unfederated-tool` finding with `reason_code: "agent_definition_invalid"`, preserving the
      registry message in `details`, so no raw error reaches the adapter
    - Leave the snapshot byte-identical on every rejection and raise no untyped error on any path
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ] 9.3 Implement the operator gate for active outcomes and statelessness
    - Consult `resolveOperatorInstruction` before any registry write that would produce
      `resulting_status: "active"`, and reject with an `unfederated-tool` finding carrying
      `reason_code: "operator_instruction_required"` when it does not resolve
    - Hold no state between `register` calls other than the monotonic counters `stats()` reports: no
      adapter map, no in-flight set, no cache
    - Produce exactly one terminal outcome per call under concurrent invocation, returning
      `already_registered` for identical content and a typed finding carrying
      `agent_revision_conflict` for a conflicting revision
    - _Requirements: 13.5, 13.6, 18.3, 18.4_

  - [ ]* 9.4 Write property test for registration totality and typed findings
    - **Property 13: Registration outcome totality and typed findings**
    - **Validates: Requirements 13.1, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 18.3, 18.4**
    - Create `__tests__/native-skill-harness-registration.test.mjs`; generator is an array of triples
      where each part is drawn from `{ valid, missing, malformed, fc.anything() }`, plus a permutation
      index array and a resolvable flag per triple; assert exactly N terminal outcomes for N triples,
      per-triple outcome identity under permutation, every finding `type` drawn from
      `REGISTRATION_FINDING_TYPES`, and a byte-identical snapshot after every rejection

  - [ ] 9.5 Implement the shared entrypoint diff harness
    - Create `scripts/native-skill-harness-entrypoint-diff.mjs` that records a sha-256 digest of
      `worker/index.js`, runs a simulated adapter registration through `adapter-registration.js` with
      a fixture adapter whose files live under a temporary `adapters/<fixture>/` prefix, re-reads
      `worker/index.js`, and asserts the digest is unchanged
    - Assert the set of changed working-tree paths is a subset of the fixture adapter's own prefix
    - Assert `worker/index.js` contains no occurrence of the fixture adapter's identity string and no
      occurrence of any adapter identity including `knowgrph`, so an empty diff cannot pass on a name
      that was already hardcoded
    - _Requirements: 13.2, 13.3, 13.4_

  - [ ]* 9.6 Write unit tests for the knowgrph adapter registration path
    - Register a knowgrph-shaped fixture through `register` with a resolvable reference and assert the
      Registration_Record names the adapter identity, the definition id, and the allowlist entry id
    - Record in the test comment that the Min-Viable Scope is proven against the existing `knowgrph`
      adapter only and that the second-adapter genericity proof is outside this increment
    - _Requirements: 13.1, 22.4_

- [ ] 10. Invocation register declarations
  - [ ] 10.1 Declare the propose-skill command
    - Add `/propose-skill` to `docs/DICTIONARY-COMMAND.md` with owner Skill_Proposer, typed arguments
      `{ gap_signal }`, trust boundary `approval-gated`, and a row note distinguishing it from the
      existing `/skill.propose` by owner, argument type, and artifact type
    - Declare it in this register file only; keep the content pure ASCII and inside the docs contract's
      frontmatter and line budget
    - _Requirements: 15.1, 15.8_

  - [ ] 10.2 Declare the skill-candidate tag
    - Add `#skill-candidate` to `docs/DICTIONARY-SEMANTIC.md` with owner Promotion_Gate and trust
      boundary `read`, declared in this register file only
    - _Requirements: 15.2_

  - [ ] 10.3 Declare the skill-registry binding
    - Add `@skill-registry` to `docs/DICTIONARY-BINDING.md` with owner Active_Registry and trust
      boundary `read`, resolving to the in-Worker Agent Definition registry plus its
      `Active_Registry_Snapshot` projection, and state that it is distinct from `@skill-catalog`
    - _Requirements: 15.3, 15.7_

  - [ ] 10.4 Declare the three ACOS tool identities
    - Add `acos.skill_proposer.propose` with `{ gap_signal }`, `acos.skill_registry.promote` with
      `{ draft_id, operator_instruction_ref }`, and `acos.adapter.register` with
      `{ agent_definition, tool_allowlist_entry }` to `docs/MCP-GATEWAY.md`, each with trust boundary
      `approval-gated`, leaving the existing `knowgrph.skill.propose` row unchanged
    - _Requirements: 15.4_

  - [ ] 10.5 Implement the token declaration count check
    - Create `scripts/native-skill-harness-invocation-register.mjs` that scans
      `docs/DICTIONARY-COMMAND.md`, `docs/DICTIONARY-SEMANTIC.md`, `docs/DICTIONARY-BINDING.md`, and
      `docs/MCP-GATEWAY.md` and asserts a declaration count of exactly 1 for each of `/propose-skill`,
      `#skill-candidate`, `@skill-registry`, `acos.skill_proposer.propose`,
      `acos.skill_registry.promote`, and `acos.adapter.register`
    - Fail with the token name and every file that declared it when a count is not 1
    - _Requirements: 15.5_

- [ ] 11. Structural and repository audits
  - [ ] 11.1 Implement the import-graph independence check
    - Create `scripts/native-skill-harness-import-graph.mjs` that parses the local import specifier
      lists of `skill-proposer.js`, `skill-registry-gate.js`, `adapter-registration.js`, and
      `agent-definitions.js` and asserts the transitive local graph rooted at the proposer contains no
      edge reaching the gate and the graph rooted at the gate contains no edge reaching the proposer
    - Assert the proposer imports neither `agent-definitions.js` nor `adapter-registration.js`, that
      `agent-definitions.js` imports none of the three new modules, and that the gate's import list
      contains no provider adapter module
    - _Requirements: 11.1, 11.2, 11.4, 12.6_

  - [ ]* 11.2 Write property test for evaluator independence as a structural invariant
    - **Property 14: Evaluator independence as a structural invariant**
    - **Validates: Requirements 3.6, 11.1, 11.2, 11.4, 11.5**
    - Add to `__tests__/native-skill-harness-structure.test.mjs`; generators are the parsed import
      specifier lists of the local module graph, plus an arbitrary sequence of promote inputs asserting
      the set of draft store methods the gate invokes against the recording fake is a subset of
      `{ peek, markConsumed }`; also assert the proposer's frozen surface key set equals exactly
      `{ propose, stats }`

  - [ ] 11.3 Implement the ownership audit
    - Create `scripts/native-skill-harness-ownership.mjs` that reads the exported `artifactType`
      constant from each declared owner module, groups by artifact type, and asserts the type set is
      exactly `{ "skill-text", "agent-definition" }`, that each type maps to exactly one promotion
      owner module path and exactly one proposal owner module path, and that no module declares two
      artifact types
    - Assert no second Agent Definition registry exists outside ACOS harness code by checking that
      `createAgentDefinitionRegistry` is the only registry constructor referenced by the new modules
    - Fail with the offending artifact type and the competing module paths named
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6_

  - [ ] 11.4 Implement the forbidden dependency audit
    - Create `scripts/native-skill-harness-dependency-audit.mjs` that reports zero
      Forbidden_Dependency_Set entries across `dependencies`, `devDependencies`,
      `optionalDependencies`, `peerDependencies`, and `overrides` in `package.json`
    - Report zero imports, requires, dynamic imports, and vendored copies referencing the set across
      `worker/`, `src/`, `agent-api/src/`, and `adapters/`, and zero outbound network call targets
      naming a set member
    - Permit a documentation reference to such a project as a reference pattern while asserting no
      copied code, prompt, schema, test, fixture, or prose
    - Fail naming the offending file and identifier
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 22.3_

  - [ ] 11.5 Implement the module budget audit
    - Create `scripts/native-skill-harness-module-budget.mjs` that counts `agent-api/src/` modules and
      total lines across `worker/`, `src/`, and `agent-api/src/`, and reports them against the recorded
      pre-feature baseline of 59 modules and 19,834 lines and the recorded projection
    - Fail when the observed counts exceed the recorded projection, so the projection cannot drift
      silently
    - _Requirements: 17.1, 17.2_

  - [ ] 11.6 Implement the binding count and Skill Evolution invariance checks
    - Add to `__tests__/native-skill-harness-structure.test.mjs`: assert the `wrangler.jsonc` binding
      counts are unchanged from the recorded pre-feature values (2 Durable Objects, 2 rate limiters,
      1 assets, 1 services under `env.dev`, no KV, no D1)
    - Assert the `docs/SKILL-EVOLUTION.md` digest is unchanged by this feature and that no new module
      sets, reads, or reinterprets `applied`, `modelWeightsMutated`, or `deploymentAttempted`
    - _Requirements: 16.5, 19.1, 19.2, 19.3_

- [ ] 12. Wiring and readiness reporting
  - [ ] 12.1 Construct the runtimes per env in the shared entrypoint
    - In `worker/index.js`, add the module-level `WeakMap` caches `SKILL_PROPOSER_BY_ENV`,
      `SKILL_REGISTRY_GATE_BY_ENV`, and `ADAPTER_REGISTRATION_BY_ENV`, construct the draft store from
      `env.AGENT_STATE` under the existing `durableStateConfigured` guard, and pass `skillDraftStore`,
      `skillProposer`, `skillRegistryGate`, and `adapterRegistration` into `createAgentApiApp`
    - Attach no model adapter and no resolving operator instruction resolver, so the shipped default
      stays unconfigured
    - Introduce no adapter name, adapter-specific route, or adapter-specific branch; the added lines
      are generic
    - _Requirements: 13.4, 19.1_

  - [ ] 12.2 Accept the runtimes as injected dependencies in the app
    - In `agent-api/src/app.js`, accept `skillDraftStore`, `skillProposer`, `skillRegistryGate`, and
      `adapterRegistration` as optional injected dependencies with local `create...()` fallbacks,
      following the existing `toolSearch` handling
    - _Requirements: 19.1_

  - [ ] 12.3 Add the three readiness blocks
    - Add `skillProposer`, `skillRegistryGate`, and `adapterRegistration` blocks to `readiness()` with
      the declared always-present fields, each reporting `configured: false` and
      `providerExecutionStatus: "unverified"` in the shipped default, and each computing `configured`
      from its own `stats()` predicate
    - Report `registryWriteCapability: false` on the proposer block, `boundaryState: "closed"` and
      `modelCallCapability: false` on the gate block, and `sharedEntrypointAdapterNames: 0` and
      `requestScopedState: false` on the registration block
    - Add `statusCounts` and `snapshotDigestAlgorithm: "sha-256"` to the existing `agentDefinitions`
      block
    - _Requirements: 1.3, 2.5_

  - [ ]* 12.4 Update the app and worker readiness tests
    - Extend `__tests__/agent-api-app.test.mjs` and `__tests__/cloudflare-worker.test.mjs` to assert
      the three new readiness blocks are present, report `configured: false`, and carry the declared
      always-present fields, and that `agentDefinitions.statusCounts` sums to `agentDefinitions.agents`
    - _Requirements: 1.3, 2.5_

- [ ] 13. Check script and closeout
  - [ ] 13.1 Add the subsystem check script
    - Add to `package.json`:
      `"native-skill-harness:check": "node --test __tests__/native-skill-harness-*.test.mjs __tests__/agent-definitions.test.mjs && node ./scripts/native-skill-harness-prerequisite-gate.mjs && node ./scripts/native-skill-harness-import-graph.mjs && node ./scripts/native-skill-harness-ownership.mjs && node ./scripts/native-skill-harness-dependency-audit.mjs && node ./scripts/native-skill-harness-module-budget.mjs && node ./scripts/native-skill-harness-invocation-register.mjs && node ./scripts/native-skill-harness-entrypoint-diff.mjs && npm run docs:check"`
    - Include the existing `agent-definitions.test.mjs` so a green new-module suite over a broken
      registry cannot pass falsely
    - Add no new dependency
    - _Requirements: 12.1, 15.5, 16.3, 17.1, 17.2_

  - [ ] 13.2 Record the component inventory, deploy boundary register, and rung
    - Add the component inventory table to `docs/NATIVE-SKILL-HARNESS.md` with local rung
      `spec-complete`, delivered rung `undocumented`, `none yet` in every Evidence Reference cell, and
      `none` in every operator instruction cell
    - Add the deploy boundary register rows for Skill Registry Promotion and Adapter Registration with
      state `closed` and their rollback statements, and reaffirm the Authoring to Mirror and Mirror to
      Delivery rows as unchanged
    - State what raising the rung to `runtime-ready` requires: a recorded passing run of
      `npm run native-skill-harness:check` at a named revision, the entrypoint diff check, the timed
      p95 value, and a Prerequisite_Gate state of `satisfied` or `waived` with a named operator
      instruction
    - Add the matching `configured: false` readiness row to `README.md`
    - _Requirements: 10.5, 19.5_

- [ ] 14. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Deferred scope

Not part of this increment and deliberately absent from the numbered plan, so they do not inflate the
Must-tier count.

- **Requirement 20, the Refinement Loop (Should tier).** Design shape only: the Readiness_Rung must be
  a computed projection of the Evidence Reference set rather than a stored editable value, and the loop
  must flag rather than demote. Schedule mechanism, invocation bound, and flag record shape are
  undesigned.
- **Requirement 21, cross-adapter skill suggestion (Could tier).** Reuses the Must-tier proposer
  unchanged; the only new surface is the derivation function.
- **Requirement 22 criterion 4, the second-adapter genericity proof.** The Min-Viable Scope is proven
  against the existing `knowgrph` adapter only.
- **The `/propose-skill` to `/skill.draft-definition` rename.** Edits a canonical register, needs an
  operator instruction.

## Gated follow-on

Requires the Prerequisite_Gate state to be `waived` with a named operator instruction, or `satisfied`.
None of it is in the numbered plan.

- Attaching a live model adapter and a resolving operator instruction resolver in `worker/index.js`,
  and reporting `configured: true` for any of the three new readiness keys.
- Any `wrangler.jsonc` change, including the `v3-skill-draft-store` migration path if the binding
  decision is ever revisited.
- Any real promotion through the gate with a resolvable Operator_Instruction_Reference.
- Raising the readiness rung above `spec-complete`, which additionally requires cited passing test
  commands per `docs/RUNTIME-READINESS.md`.
- The operator instruction accepting the sequencing order recorded in Task 2.7.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Every task cites the acceptance criteria it implements for traceability.
- Property tests are grouped by shared generator family, so 15 correctness properties map to 8 tasks:
  Property 15 in 1.4, Property 1 in 3.6, Properties 2 to 4 in 3.7, Properties 5, 6, and 9 in 6.5,
  Properties 7 and 8 in 6.6, Properties 10 to 12 in 8.4, Property 13 in 9.4, and Property 14 in 11.2.
  Every property test uses `fast-check` with `numRuns: 100` minimum, a recorded fixed seed, in-memory
  fakes only, and the tag comment
  `// Feature: native-skill-creation-harness, Property <n>: <property text>`.
- The two diff harnesses the PRD's verification conditions require are Task 3.5 (active registry
  snapshot capture before and after) and Task 9.5 (`worker/index.js` digest equality after a simulated
  adapter registration, including the assertion that no adapter name was already hardcoded).
- Checkpoints at Tasks 4, 7, and 14 validate incrementally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "3.5", "5.1"] },
    { "id": 1, "tasks": ["1.3", "2.2", "3.2", "6.1", "9.1"] },
    { "id": 2, "tasks": ["1.4", "2.3", "3.3", "6.2", "8.1", "9.2"] },
    { "id": 3, "tasks": ["1.5", "2.4", "3.4", "5.3", "6.3", "8.2", "9.3"] },
    { "id": 4, "tasks": ["2.5", "3.6", "5.2", "6.4", "8.3", "9.4", "10.1", "10.2", "10.3", "10.4"] },
    { "id": 5, "tasks": ["2.6", "3.7", "6.5", "8.4", "9.5", "10.5", "11.1", "11.3", "11.4", "11.5"] },
    { "id": 6, "tasks": ["2.7", "3.8", "6.6", "8.5", "9.6", "11.2", "12.1", "12.2"] },
    { "id": 7, "tasks": ["2.8", "6.7", "6.8", "11.6", "12.3"] },
    { "id": 8, "tasks": ["12.4", "13.1", "13.2"] }
  ]
}
```
