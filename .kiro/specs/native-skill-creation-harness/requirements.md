# Requirements Document

## Introduction

This feature adds a native, fully-owned skill-proposal and promotion capability to `agentic-canvas-os` so new capabilities can be *proposed* from observed capability gaps while remaining *promoted* only under an explicit, referenced operator instruction.

Three new harness modules are in scope:

1. **Skill-Proposer Harness** (`skill-proposer.js`, new) - a bounded agentic loop that writes `status: proposed` draft Agent Definitions and never registers them.
2. **Skill Registry Promotion Gate** (`skill-registry-gate.js`, new) - a Deploy-Boundary-pattern gate, closed by default, that promotes a draft into the active Agent Definition registry and adds its tool allowlist entry only under a referenced operator instruction.
3. **Adapter Registration Interface** (`adapter-registration.js`, new) - a stable interface any product repository uses to register an Agent Definition plus a tool allowlist entry without editing the shared Worker entrypoint.

The Agent Definition schema is extended with `status: proposed | active | deprecated`.

The authoritative source is `$GITHUB_ROOT/joohwee/prd-tad-ard/acos-agentic-runtime-ready-production-verified-prd-tad-adr.md` (PRD + Architecture/TAD + ADR-1 + ADR-2 + Readiness Gap Matrix). Every VCC stated there maps to at least one acceptance criterion below.

Scope tiers are carried forward from the PRD's MoSCoW list and are marked per requirement. **Min-Viable Scope is the Must tier proven against the existing `knowgrph` adapter only.**

---

## Verified Repository Facts

These were confirmed directly against the repository. Implementers should not re-derive them.

| Fact | Evidence |
|---|---|
| `agent-api/src/agent-definitions.js` exists and exports `createAgentDefinitionRegistry` plus `AgentDefinitionBlock`, with normalizers for model, source, instructions, tools, guardrails, MCP servers, handoffs, and output contract. | Read directly. `normalizeDefinition` calls `assertExactKeys` with an exact key list. |
| The Agent Definition schema has **no** `status` field today, and `assertExactKeys` rejects unknown fields. Adding `status` is a real, breaking-shaped change to that module. | `assertExactKeys(value, ["id", "revision", "name", "source", "model", "instructions", "tools", "guardrails", "mcpServers", "handoffs", "output"], "definition")`. |
| The active Agent Definition registry is an **in-memory `Map` inside a closure**, not a file. It exposes `stats()` but no serialized snapshot. | `const definitions = new Map();` and the returned frozen object `{ register, prepare, validateOutput, remove, stats }`. |
| `agent-api/src/tool-search.js` exists, exports `createToolSearchRuntime`, is statically imported by `worker/index.js` (line 23), constructed per-env, and its `stats()` feeds the `toolSearch` block of `GET /api/ready`. | Read directly. |
| `agent-api/src/guardrails-human-review.js` and the `function-calling*.js` family exist. Function calling has an accepted live proof recorded in `docs/LIVE-REVIEWED-FUNCTION-PROOF.md` (2026-07-19 Dev proof: one recovered durable continuation, two Responses requests, one signed review, one applied native mutation, persisted revision 1). | `docs/RUNTIME-READINESS.md` and `README.md`. |
| `worker/agent-state.js` is a per-identity transactional Durable Object state owner. `wrangler.jsonc` declares `AGENT_STATE` and `CANVAS_ROOM` Durable Object bindings with migration tags `v2-agent-state` and `v1-canvas-room`, and required secrets `AGENT_API_JWT_SECRET` and `AGENT_REVIEW_JWT_SECRET`. | `wrangler.jsonc`. |
| **There is no KV or D1 binding in `wrangler.jsonc`.** The repository has Durable Objects and rate limiters only. The TAD's topology table names "Draft Registry Store - Existing KV/D1 namespace" and claims reuse of existing infrastructure. That claim does not hold. | `wrangler.jsonc` contains `durable_objects`, `ratelimits`, `assets`, `vars`, `secrets`, and one `services` binding under `env.dev`. No `kv_namespaces`, no `d1_databases`. |
| devDependencies are only `ajv 8.20.0`, `fast-check 3.23.2`, `wrangler 4.120.0`. Node `>=22`. `npm run check` = `npm test && npm run web:build && npm run docs:check`. | `package.json`. |
| `README.md` marks Agent Swarm, Agent Toolkit, Agent Orchestration, Agent Runtime Composition, Progressive Agents, Tool Search, Programmatic Tool Calling, Sandbox Agents, Agent Definitions, Autonomous Runtime, and Application Composition as `configured: false` with provider execution `unverified`. The word `unverified` appears 15 times. | `README.md`. |
| `/skill.propose` **already exists** as a declared command owned by `docs/DICTIONARY-COMMAND.md`, bound to `#skill-evolution` and `@skill-catalog`, with MCP tool identity `knowgrph.skill.propose` declared in `docs/MCP-GATEWAY.md`. | `docs/DICTIONARY-COMMAND.md`, `docs/DICTIONARY-BINDING.md`, `docs/FACTS.md`, `docs/MCP-GATEWAY.md`, `docs/SKILLS.md`. |
| `/propose-skill`, `#skill-candidate`, and `@skill-registry` appear in **no** repository document today. They are new tokens. | Repository-wide search of `docs/**/*.md` returned no matches. |
| `docs/SKILL-EVOLUTION.md` is a spec-complete contract (`schema: agentic-skill-evolution/v1`) with MCP tool `knowgrph.skill.evolve`, invocation `/skill.evolve #skill-evolution @skill-catalog @skill-policy @runtime-proof @operator`, a `review_pending` terminal proposal, `/skill.manage` as the separate operator-gated persistence owner, hard `applied: false` / `modelWeightsMutated: false` / `deploymentAttempted: false` flags, and `external_dependency: forbidden` against Microsoft SkillOpt. | Read directly. |
| `agent-api/src/` currently contains **59** `.js` modules, and `worker/` + `src/` + `agent-api/src/` currently total **19,834** lines. | `ls agent-api/src/*.js | wc -l`; `find worker src agent-api/src -name '*.js' -exec cat {} + | wc -l`. |
| **The `repository-teardown` spec exists**, complete with `requirements.md`, `design.md`, `tasks.md`, and `.config.kiro`, at `$GITHUB_ROOT/.worktrees/agentic-canvas-os/repository-teardown-20260816/.kiro/specs/repository-teardown/`. It is absent from the main `agentic-canvas-os` checkout because the repository's own lane-lifecycle machinery provisioned a task worktree for it, so the spec lives on a task branch rather than on `main`. Its stated budget (at most 20 `agent-api/src/` modules, at most 8,000 lines across `worker/` + `src/` + `agent-api/src/`, at most 15 `scripts/` files and 3,000 lines, at most 20 `__tests__/` files and 3,000 lines, at most 12 top-level `docs/*.md` files and 2,500 lines) is therefore a **verified constraint from a spec on a task branch**, not an unverified external claim. | `find "$GITHUB_ROOT" -maxdepth 5 -type d -name "repository-teardown"` locates the worktree; the main checkout's `.kiro/specs/` directory listing contains only `native-skill-creation-harness`. |

---

## Recorded Conflicts

These three conflicts must be resolved explicitly by the requirements below, not assumed away.

### Conflict 1 - The PRD's own prerequisite gate is not met

The PRD's Dependencies section states this feature "must not start before" Must-tier Gateway federation and Follow-on Track 1 (spend safety) are `runtime-ready`. In this repository, Agent Definitions and Tool Search report `configured: false` and provider execution `unverified`. Requirement 1 forces either a blocking record or a named operator waiver. Silent progress as if the prerequisite passed is not permitted.

### Conflict 2 - Overlap with the existing Skill Evolution contract

`docs/SKILL-EVOLUTION.md` already owns a bounded loop that terminates in an operator-reviewed proposal, with `/skill.manage` as the separate persistence owner and an explicit clean-room ban on an external reference implementation. `/skill.propose` and `knowgrph.skill.propose` already exist. The scopes differ (Skill Evolution optimizes existing skill *text* against a frozen executor; this feature *creates* new Agent Definitions from capability gaps), but ADR-1's own "single owner per contract" principle is at risk if both ship as separate harnesses with separate registries and separate promotion gates. Requirements 15 and 16 fix the ownership boundary and the token namespace resolution.

### Conflict 3 - Direction conflict with the repository-teardown effort

The teardown effort targets at most 20 `agent-api/src/` modules and at most 8,000 lines across `worker/` + `src/` + `agent-api/src/`. This feature adds three harness modules plus an `adapters/` tree. Current state is 59 modules and 19,834 lines, so the teardown targets are already far from met independent of this feature. Mitigating fact: because `tool-search.js` and the agent definitions registry are statically imported by `worker/index.js` and reported at `/api/ready`, they are Proven_Path under the teardown's own rules and survive it, so the dependency base is not at risk. Only the module budget and sequencing are. Requirement 17 forces that accounting.

---

## Glossary

- **Skill_Proposer**: The new `skill-proposer.js` harness. Exposes `propose(gap_signal) -> draft_agent_definition`. Writes drafts only. Holds no registration authority.
- **Promotion_Gate**: The new `skill-registry-gate.js` harness. Exposes `promote(draft_id, operator_instruction_ref) -> promotion_record`. The single owner of Draft-to-Active transition.
- **Adapter_Registration_Interface**: The new `adapter-registration.js` module. Exposes `register(agent_definition, tool_allowlist_entry) -> registration_record`.
- **Native_Skill_Creation_Harness**: The union of Skill_Proposer, Promotion_Gate, and Adapter_Registration_Interface, treated as one contract owner.
- **Agent_Definition_Registry**: The existing registry created by `createAgentDefinitionRegistry` in `agent-api/src/agent-definitions.js`.
- **Draft_Registry_Store**: The persistence owner for Draft_Definition records. Its concrete Cloudflare binding is an open decision (see Requirement 7).
- **Active_Registry**: The set of Agent Definitions with `status: active` held by Agent_Definition_Registry and callable through the Function Calling Gateway.
- **Active_Registry_Snapshot**: A deterministic, byte-comparable serialization of Active_Registry produced for diff observation. Required because Active_Registry is an in-memory `Map` today and has no file to diff.
- **Draft_Definition**: An Agent Definition record with `status: proposed`, stored in Draft_Registry_Store, absent from Active_Registry.
- **Promotion_Record**: The typed artifact emitted by Promotion_Gate naming the boundary, the Evidence_Reference, the Operator_Instruction_Reference, and the rollback statement.
- **Registration_Record**: The typed artifact emitted by Adapter_Registration_Interface naming the adapter identity, the registered Agent Definition, and the tool allowlist entry.
- **Operator_Instruction_Reference**: A resolvable reference to an explicit operator instruction that authorizes one promotion. Absence of this reference is the closed state of the boundary.
- **Evidence_Reference**: A reference to surfaced, observable validation output, per `docs/RUNTIME-READINESS.md`. Narrative alone is not an Evidence_Reference.
- **Readiness_Rung**: The readiness level of a component, one of the rungs used by `docs/RUNTIME-READINESS.md` (for this feature: `undocumented`, `spec-complete`, `runtime-ready`, `production-verified`), reported as a local rung and a delivered rung.
- **Deploy_Boundary_Contract**: The existing boundary record shape with four fields: boundary name, Evidence_Reference, Operator_Instruction_Reference, and rollback statement. State reads `closed` unless an Operator_Instruction_Reference is present.
- **Invocation_Register**: The set of three declared token registers `docs/DICTIONARY-COMMAND.md`, `docs/DICTIONARY-SEMANTIC.md`, `docs/DICTIONARY-BINDING.md`, plus the MCP tool identity register `docs/MCP-GATEWAY.md`. Each token is declared in exactly one register.
- **Shared_Entrypoint**: `worker/index.js`, the Cloudflare Worker entrypoint declared as `main` in `wrangler.jsonc`.
- **Gap_Signal**: The typed capability-gap record produced by the existing Tool Search layer and consumed by Skill_Proposer.
- **Cost_Log_Entry**: A record with exactly the fields `{ model, prompt_tokens, completion_tokens, cache_hits, estimated_cost_usd }`, per the universal harness shape in `docs/HARNESS-CONTRACTS.md`.
- **Trace_Log**: The append-only `trace.jsonl` observation stream. Carries Iteration_Bound state and Circuit_Breaker state per call.
- **Iteration_Bound**: The maximum of 5 Skill_Proposer iterations per Gap_Signal.
- **Circuit_Breaker**: The stop condition that halts the Skill_Proposer loop after 2 consecutive iterations produce no new candidate, or when Iteration_Bound is reached.
- **Forbidden_Dependency_Set**: Hermes Agent and any equivalent external self-improving agent-runtime package, in every form: import, wrapper, vendored copy, network call-out, or transitive dependency. Studying such a project as a reference pattern is permitted; depending on it is forbidden.
- **Prerequisite_Gate**: The recorded entry condition for Must-tier implementation, per Requirement 1.
- **Refinement_Loop**: The Should-tier bounded schedule that re-evaluates active skills' VCCs and re-derives their Readiness_Rung.
- **Dependency_Audit**: The repository check that inspects declared and resolved dependencies plus source imports against Forbidden_Dependency_Set.
- **Module_Budget_Audit**: The repository check that counts `agent-api/src/` modules and total lines across `worker/`, `src/`, and `agent-api/src/`.

---

## Requirements

### Requirement 1: Prerequisite Entry Condition (Must tier, blocking)

**User Story:** As the Solo Founder, I want the PRD's stated prerequisite state recorded and checked before Must-tier implementation starts, so that this feature does not silently proceed on an unmet dependency.

#### Acceptance Criteria

1. THE Prerequisite_Gate SHALL record, for each of Gateway federation and spend safety, the observed value of `configured` and the observed value of provider execution status, each with an Evidence_Reference to the surfaced `GET /api/ready` field or the repository document that reports it.
2. IF any recorded prerequisite value is other than `configured: true` with provider execution status other than `unverified`, THEN THE Prerequisite_Gate SHALL set its state to `blocked` and SHALL name each unmet prerequisite.
3. WHILE the Prerequisite_Gate state is `blocked`, THE Native_Skill_Creation_Harness SHALL leave Active_Registry_Snapshot byte-identical to its pre-feature value.
4. WHERE an operator records a waiver, THE Prerequisite_Gate SHALL store an Operator_Instruction_Reference and an explicit list of the accepted unmet prerequisites, and SHALL set its state to `waived`.
5. WHEN the Prerequisite_Gate state is `waived` or `satisfied`, THE Prerequisite_Gate SHALL emit one record containing the state, the prerequisite list, each Evidence_Reference, and the Operator_Instruction_Reference when the state is `waived`.

### Requirement 2: Agent Definition Status Field (Must tier)

**User Story:** As the Solo Founder, I want the Agent Definition schema to carry a lifecycle status, so that a draft and an active definition are distinguishable in one schema instead of two stores.

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL accept a `status` field on an Agent Definition whose value is exactly one of `proposed`, `active`, or `deprecated`.
2. IF an Agent Definition supplies a `status` value outside the set `{ proposed, active, deprecated }`, THEN THE Agent_Definition_Registry SHALL reject the definition with a typed `AgentDefinitionBlock` and SHALL leave Active_Registry_Snapshot byte-identical to its pre-call value.
3. WHEN an Agent Definition omits `status`, THE Agent_Definition_Registry SHALL assign the value `active`, preserving the behavior of every definition registered before this feature.
4. THE Agent_Definition_Registry SHALL exclude every definition whose `status` equals `proposed` from Active_Registry and from the set returned to the Function Calling Gateway at dispatch.
5. THE Agent_Definition_Registry `stats()` result SHALL report a count per `status` value.
6. THE Agent_Definition_Registry SHALL produce an Active_Registry_Snapshot that is byte-identical for two calls made with identical registry contents.

### Requirement 3: Draft Proposal With No Auto-Registration (Must tier, AC-1)

**User Story:** As the Solo Founder, I want ACOS to draft a candidate Agent Definition from an observed capability gap, so that I review and approve rather than hand-author every registration.

#### Acceptance Criteria

1. WHEN Skill_Proposer receives a Gap_Signal and its loop produces a candidate, THE Skill_Proposer SHALL write one Draft_Definition to Draft_Registry_Store whose `status` field equals `proposed`.
2. WHEN Skill_Proposer completes a call, THE Skill_Proposer SHALL leave Active_Registry_Snapshot byte-identical to its pre-call value.
3. WHEN Skill_Proposer completes a call, THE Skill_Proposer SHALL append one Trace_Log entry whose recorded iteration count is at most the Iteration_Bound value of 5.
4. THE Skill_Proposer SHALL return an output record containing exactly the fields `{ draft_agent_definition, rationale, confidence }`.
5. IF Skill_Proposer produces a candidate whose shape fails the output schema, THEN THE Skill_Proposer SHALL reject the candidate before any Draft_Registry_Store write and SHALL continue the loop within the Iteration_Bound.
6. THE Skill_Proposer SHALL expose no interface that writes to Active_Registry.

### Requirement 4: Bounded Loop And Circuit Breaker (Must tier)

**User Story:** As the Solo Founder, I want the proposal loop bounded and its stop state observable, so that a runaway loop is impossible and a silent stall is visible.

#### Acceptance Criteria

1. THE Skill_Proposer SHALL execute at most 5 iterations per Gap_Signal.
2. WHEN 2 consecutive iterations produce no new candidate, THE Skill_Proposer SHALL stop the loop and SHALL record the Circuit_Breaker state as `tripped` in Trace_Log.
3. WHEN the Iteration_Bound is reached without a candidate, THE Skill_Proposer SHALL stop the loop and SHALL record the stop reason as `iteration_bound_reached` in Trace_Log.
4. THE Skill_Proposer SHALL append, per call, one Trace_Log entry containing the iteration count and the Circuit_Breaker state.
5. IF the Gap_Signal fails its input schema, THEN THE Skill_Proposer SHALL return a typed error, SHALL start no iteration, and SHALL emit no Cost_Log_Entry.

### Requirement 5: Cost Logging And Token Budget (Must tier)

**User Story:** As the Solo Founder, I want every model-bearing proposal call to log its cost, so that monthly spend stays inside the stated budget and an overrun is detectable.

#### Acceptance Criteria

1. WHEN Skill_Proposer completes a model call, THE Skill_Proposer SHALL emit one Cost_Log_Entry containing exactly the fields `{ model, prompt_tokens, completion_tokens, cache_hits, estimated_cost_usd }`.
2. THE Skill_Proposer SHALL declare a per-call budget of at most 800 prompt tokens and at most 400 completion tokens, measured against a cache-hit target of 40 percent.
3. IF a Skill_Proposer call would exceed its declared per-call token budget, THEN THE Skill_Proposer SHALL stop before the call, SHALL return a typed budget-breach result, and SHALL leave Draft_Registry_Store unchanged.
4. IF Cost_Log_Entry emission fails, THEN THE Skill_Proposer SHALL continue the pipeline and SHALL record the emission failure as an observation gap.
5. THE Skill_Proposer SHALL sample Cost_Log_Entry values and SHALL raise an alert when the p95 `estimated_cost_usd` value exceeds the declared per-call budget.

### Requirement 6: All-Or-Nothing Postcondition (Must tier)

**User Story:** As the Solo Founder, I want each proposal call to be all-or-nothing, so that no partial draft and no partial promotion is reachable.

#### Acceptance Criteria

1. WHEN a Skill_Proposer call terminates, THE Skill_Proposer SHALL satisfy exactly one of two end states: one Draft_Definition with `status: proposed` exists together with one Cost_Log_Entry, or Draft_Registry_Store and Active_Registry_Snapshot are both byte-identical to their pre-call values.
2. IF the model provider is unreachable during a Skill_Proposer call, THEN THE Skill_Proposer SHALL return a typed `no-draft` status and SHALL persist no Draft_Definition.
3. IF connectivity is lost after a Draft_Registry_Store write begins and before it completes, THEN THE Draft_Registry_Store SHALL retain no partial Draft_Definition.
4. THE Native_Skill_Creation_Harness SHALL expose no code path in which a Draft_Definition appears in Active_Registry without a Promotion_Record.

### Requirement 7: Draft Registry Store Binding Decision (Must tier, open decision)

**User Story:** As the Solo Founder, I want the draft persistence owner chosen explicitly and recorded, so that the TAD's incorrect claim of an existing KV or D1 namespace does not become a silent implementation assumption.

#### Acceptance Criteria

1. THE Draft_Registry_Store binding decision SHALL be recorded as one of: a new Cloudflare KV namespace, a new Cloudflare D1 database, a new Durable Object class, or reuse of the existing `AGENT_STATE` Durable Object binding.
2. THE recorded decision SHALL state the observed fact that `wrangler.jsonc` declares no KV namespace and no D1 database today, and SHALL state whether the chosen option adds a new binding to `wrangler.jsonc`.
3. IF the chosen option adds a new Cloudflare binding, THEN THE recorded decision SHALL state whether the PRD's zero-incremental-TCO target still holds and SHALL name the operator instruction that accepts the new resource.
4. THE Native_Skill_Creation_Harness SHALL treat the TAD topology row naming "Draft Registry Store - Existing KV/D1 namespace" as an unverified claim until the recorded decision names a binding that is present in `wrangler.jsonc`.
5. WHERE the chosen option is a new Durable Object class, THE recorded decision SHALL name the migration tag that follows `v2-agent-state`.

### Requirement 8: Operator-Gated Promotion Boundary (Must tier, AC-2)

**User Story:** As the Solo Founder, I want promotion to require an explicit referenced operator instruction, so that no capability becomes callable without my approval.

#### Acceptance Criteria

1. THE Promotion_Gate SHALL default its boundary state to `closed`.
2. WHILE no Operator_Instruction_Reference is supplied for a given `draft_id`, THE Promotion_Gate SHALL keep its boundary state `closed` for that `draft_id`.
3. IF `promote` is called without a resolvable Operator_Instruction_Reference, THEN THE Promotion_Gate SHALL reject the call, SHALL leave Active_Registry_Snapshot byte-identical to its pre-call value, and SHALL leave the tool allowlist unchanged.
4. WHEN `promote` is called with a resolvable Operator_Instruction_Reference for an existing Draft_Definition, THE Promotion_Gate SHALL set that definition's `status` field to `active` in Active_Registry and SHALL add its tool allowlist entry for its owning adapter.
5. WHEN a promotion succeeds, THE Promotion_Gate SHALL emit one Promotion_Record containing the boundary name, the Evidence_Reference, the Operator_Instruction_Reference, and the rollback statement.
6. WHEN a promotion succeeds, THE Promotion_Gate SHALL produce a tool allowlist entry whose referenced Agent Definition identity equals the promoted definition's `id`.
7. THE Promotion_Gate SHALL be the only module in the repository that transitions an Agent Definition `status` value from `proposed` to `active`.

### Requirement 9: No Approval, No Mutation (Must tier, AC-3)

**User Story:** As the Solo Founder, I want an unapproved loop exit to be provably inert, so that reaching the iteration bound never mutates the registry.

#### Acceptance Criteria

1. WHEN the Skill_Proposer loop exits without an operator approval, THE Skill_Proposer SHALL leave Active_Registry_Snapshot byte-identical to its pre-loop value.
2. WHEN the Skill_Proposer loop exits without an operator approval, THE Skill_Proposer SHALL log one status entry whose value equals `skill-creation: unapproved` together with the iteration count.
3. WHEN the Skill_Proposer loop exits without an operator approval, THE Skill_Proposer SHALL leave the tool allowlist byte-identical to its pre-loop value.
4. THE Skill_Proposer SHALL treat an absent operator approval as the normal terminal outcome and SHALL return a typed result rather than an unhandled failure.

### Requirement 10: Deploy Boundary Contract Field Decision (Must tier, open question)

**User Story:** As the Solo Founder, I want the promotion boundary's field set decided and recorded before Phase 3 sign-off, so that proposer and evaluator distinctness is stated at the schema level rather than left procedural.

#### Acceptance Criteria

1. THE Promotion_Record SHALL contain the four Deploy_Boundary_Contract fields: boundary name, Evidence_Reference, Operator_Instruction_Reference, and rollback statement.
2. THE recorded decision SHALL state whether Promotion_Record carries a fifth field naming the proposing mechanism identity, and SHALL state the rationale for the chosen answer.
3. THE recorded decision SHALL note that ADR-1 claims evaluator independence holds "by construction", which favors schema-level distinctness over procedural distinctness.
4. WHERE the recorded decision adds the proposing mechanism identity field, THE Promotion_Record SHALL carry a proposing mechanism identity value that differs from the Promotion_Gate module identity.
5. THE recorded decision SHALL be present before this feature's Readiness_Rung is raised above `spec-complete`.

### Requirement 11: Evaluator Independence By Construction (Must tier, ADR-1)

**User Story:** As the Solo Founder, I want the evaluator mechanically separate from the proposer, so that independence is a structural property rather than a process promise.

#### Acceptance Criteria

1. THE Promotion_Gate SHALL reside in a module file distinct from the Skill_Proposer module file.
2. THE Skill_Proposer SHALL import no symbol from the Promotion_Gate module, and THE Promotion_Gate SHALL import no symbol from the Skill_Proposer module.
3. THE Promotion_Gate SHALL derive its promotion decision from the stored Draft_Definition and the Operator_Instruction_Reference, and SHALL derive it from no value supplied by a Skill_Proposer call frame.
4. THE Promotion_Gate SHALL make no model provider call.
5. THE Skill_Proposer SHALL hold no write capability to Active_Registry, and THE Promotion_Gate SHALL hold no write capability to Draft_Registry_Store beyond marking a Draft_Definition as consumed.

### Requirement 12: Forbidden Dependency Set (Must tier, ADR-1)

**User Story:** As the Solo Founder, I want the native build boundary machine-checked, so that no external self-improving agent-runtime package enters the dependency graph.

#### Acceptance Criteria

1. THE Dependency_Audit SHALL report zero entries from Forbidden_Dependency_Set in `package.json` dependencies, devDependencies, optionalDependencies, peerDependencies, and overrides.
2. THE Dependency_Audit SHALL report zero source imports, requires, dynamic imports, or vendored copies referencing Forbidden_Dependency_Set across `worker/`, `src/`, `agent-api/src/`, and `adapters/`.
3. THE Dependency_Audit SHALL report zero outbound network call targets naming a Forbidden_Dependency_Set service.
4. IF the Dependency_Audit reports a non-zero count in any of the three preceding criteria, THEN THE Dependency_Audit SHALL fail the check and SHALL name the offending file and identifier.
5. THE Native_Skill_Creation_Harness SHALL permit a documentation reference to a Forbidden_Dependency_Set project as a reference pattern, and SHALL keep such a reference free of copied code, prompts, schemas, tests, fixtures, and prose.
6. THE Native_Skill_Creation_Harness SHALL reuse the existing Agent_Definition_Registry, Function Calling Gateway, `guardrails-human-review.js`, and `tool-search.js` primitives rather than introducing a second orchestration model.

### Requirement 13: Adapter Registration Without Core Change (Must tier, AC-5)

**User Story:** As an adapter owner, I want to register my product's MCP tools as an Agent Definition plus a tool allowlist entry through a stable interface, so that ACOS core never special-cases my product by name.

#### Acceptance Criteria

1. WHEN an adapter calls `register(agent_definition, tool_allowlist_entry)`, THE Adapter_Registration_Interface SHALL emit one Registration_Record naming the adapter identity, the registered Agent Definition identity, and the tool allowlist entry identity.
2. WHEN a new adapter completes registration, THE Shared_Entrypoint diff SHALL be empty.
3. WHEN a new adapter completes registration, THE set of changed files SHALL contain only files owned by that adapter.
4. THE Shared_Entrypoint SHALL contain no adapter name, adapter-specific route, or adapter-specific branch introduced by this feature.
5. WHEN two or more adapters call `register` concurrently, THE Adapter_Registration_Interface SHALL produce one Registration_Record per successful call and SHALL leave no Registration_Record partially written.
6. THE Adapter_Registration_Interface SHALL require an Operator_Instruction_Reference for a registration that results in an `active` Agent Definition, consistent with the approval-gated trust boundary declared for `acos.adapter.register`.

### Requirement 14: Malformed Registration Surfaces As A Finding (Must tier, ADR-2)

**User Story:** As an adapter owner, I want a malformed registration reported as a named finding, so that my mistake never presents as a core routing bug.

#### Acceptance Criteria

1. THE Adapter_Registration_Interface SHALL require all three of an Agent Definition record, a tool allowlist entry conforming to the Function Calling Gateway contract, and an Invocation_Register entry declaring the adapter's route, tag, binding, and tool identity.
2. IF a registration omits or malforms its tool allowlist entry, THEN THE Adapter_Registration_Interface SHALL return a finding whose type equals `unfederated-tool`.
3. IF a registration omits or malforms its Invocation_Register entry, THEN THE Adapter_Registration_Interface SHALL return a finding whose type equals `uncatalogued-tool`.
4. IF a registration is malformed, THEN THE Adapter_Registration_Interface SHALL leave Active_Registry_Snapshot byte-identical to its pre-call value.
5. THE Adapter_Registration_Interface SHALL return a typed finding for every rejected registration and SHALL raise no untyped error.

### Requirement 15: Invocation Register Token Ownership (Must tier)

**User Story:** As the Solo Founder, I want every new token declared in exactly one register and reconciled against existing tokens, so that the Invocation Surface Contract stays single-owner.

#### Acceptance Criteria

1. THE Invocation_Register SHALL declare the command `/propose-skill` with owner Skill_Proposer, typed arguments `{ gap_signal }`, and trust boundary `approval-gated`.
2. THE Invocation_Register SHALL declare the tag `#skill-candidate` with owner Promotion_Gate and trust boundary `read`.
3. THE Invocation_Register SHALL declare the binding `@skill-registry` with owner Active_Registry and trust boundary `read`.
4. THE Invocation_Register SHALL declare the tool identities `acos.skill_proposer.propose` with arguments `{ gap_signal }`, `acos.skill_registry.promote` with arguments `{ draft_id, operator_instruction_ref }`, and `acos.adapter.register` with arguments `{ agent_definition, tool_allowlist_entry }`, each with trust boundary `approval-gated`.
5. THE Invocation_Register SHALL declare each of these tokens in exactly one register file, and a repository check SHALL report a declaration count of exactly 1 per token.
6. THE recorded decision SHALL state whether `/propose-skill` and the existing `/skill.propose` remain two distinct commands or whether one is retired, and SHALL name the surviving owner.
7. THE recorded decision SHALL state whether `@skill-registry` and the existing `@skill-catalog` remain two distinct bindings, and SHALL name what each binding resolves to.
8. IF the recorded decision retains both `/propose-skill` and `/skill.propose`, THEN THE recorded decision SHALL state the observable difference in their typed arguments and their owners.

### Requirement 16: Ownership Boundary With The Skill Evolution Contract (Must tier)

**User Story:** As the Solo Founder, I want the boundary between this feature and the existing Skill Evolution contract fixed, so that ADR-1's single-owner-per-contract principle holds across both.

#### Acceptance Criteria

1. THE recorded ownership boundary SHALL name the single owner of new-Agent-Definition proposal artifacts and SHALL name the single owner of skill-text optimization proposal artifacts.
2. THE recorded ownership boundary SHALL name the single owner of operator-gated promotion for each proposal artifact type.
3. THE repository SHALL contain exactly one skill registry owner and exactly one promotion gate per proposal artifact type, and a repository check SHALL report those counts.
4. THE Native_Skill_Creation_Harness SHALL introduce no second Agent Definition registry maintained outside ACOS harness code.
5. THE Native_Skill_Creation_Harness SHALL leave the `docs/SKILL-EVOLUTION.md` contract's `applied`, `modelWeightsMutated`, and `deploymentAttempted` flag semantics unchanged.
6. THE recorded ownership boundary SHALL state whether Promotion_Gate and the existing `/skill.manage` persistence owner are the same owner or distinct owners, and SHALL name the artifact type each governs.

### Requirement 17: Module Budget And Sequencing Accounting (Must tier)

**User Story:** As the Solo Founder, I want the three new modules accounted for against the teardown budget, so that two active efforts do not silently pull in opposite directions.

#### Acceptance Criteria

1. THE Module_Budget_Audit SHALL record the current `agent-api/src/` module count of 59 and the current total of 19,834 lines across `worker/`, `src/`, and `agent-api/src/` as the pre-feature baseline.
2. THE Module_Budget_Audit SHALL record the projected module count and line total after `skill-proposer.js`, `skill-registry-gate.js`, `adapter-registration.js`, and the `adapters/` tree are added.
3. THE recorded sequencing decision SHALL state whether this feature ships before, after, or concurrently with the teardown effort, and SHALL name the operator instruction that accepts the chosen order.
4. THE recorded sequencing decision SHALL state the location of the `repository-teardown` spec at `$GITHUB_ROOT/.worktrees/agentic-canvas-os/repository-teardown-20260816/.kiro/specs/repository-teardown/`, SHALL state that the spec resides on a task branch rather than on `main`, and SHALL state whether the sequencing decision is made against the task-branch version or against a merged version.
5. THE recorded sequencing decision SHALL state the mitigating fact that `tool-search.js` and Agent_Definition_Registry are statically imported by the Shared_Entrypoint and reported at `GET /api/ready`, which classifies them as Proven_Path and keeps the dependency base intact through the teardown.

### Requirement 18: Bounded Latency And Concurrent Registration (Must tier)

**User Story:** As the Solo Founder, I want gap-to-draft latency and concurrent registration behavior measured, so that the harness stays usable as adapter count grows.

#### Acceptance Criteria

1. THE Skill_Proposer SHALL record, per call, the elapsed duration from Gap_Signal receipt to Draft_Definition write or typed terminal result.
2. THE recorded quality attributes SHALL state one explicit p95 gap-to-draft latency threshold in milliseconds, and a timed test SHALL report the observed p95 value against it.
3. WHEN N adapters call `register` concurrently, THE Adapter_Registration_Interface SHALL produce exactly N terminal outcomes, each either one Registration_Record or one typed finding.
4. THE Adapter_Registration_Interface SHALL hold no request-scoped state between separate `register` calls.

### Requirement 19: Zero Incremental Monthly TCO (Must tier)

**User Story:** As the Solo Founder, I want the feature's infrastructure cost delta stated and checked, so that a zero-TCO claim is observable rather than asserted.

#### Acceptance Criteria

1. THE Native_Skill_Creation_Harness SHALL ship inside the existing Cloudflare Worker declared as `main` in `wrangler.jsonc`.
2. THE Native_Skill_Creation_Harness SHALL introduce no new vendor and no new external service boundary.
3. THE recorded TCO statement SHALL report the count of Cloudflare bindings added to `wrangler.jsonc` by this feature and the projected monthly cost of each.
4. IF the recorded TCO statement reports a non-zero projected incremental monthly cost, THEN THE recorded TCO statement SHALL name the operator instruction that accepts that cost.
5. THE rollback statement SHALL state that the draft and registry schema additions are additive and that rollback to the pre-feature Worker build requires no data migration.

### Requirement 20: Refinement Loop Re-Derives The Readiness Rung (Should tier, AC-4)

**User Story:** As the Solo Founder, I want the refinement loop to re-evaluate an already-registered skill's VCCs on a bounded schedule, so that stale registrations are flagged rather than silently trusted.

> Should tier. Explicitly outside the Must-tier Min-Viable Scope.

#### Acceptance Criteria

1. WHEN the Refinement_Loop runs against an active skill and that skill's Evidence_Reference set has changed, THE Refinement_Loop SHALL re-derive that skill's Readiness_Rung from the changed Evidence_Reference set.
2. THE Refinement_Loop SHALL change a Readiness_Rung value only as a diff-traceable consequence of a changed Evidence_Reference set, and a repository check SHALL report zero Readiness_Rung diffs that lack a corresponding Evidence_Reference diff.
3. THE Refinement_Loop SHALL run on a bounded schedule whose maximum invocation count per period is declared.
4. IF an active skill's re-evaluated VCC set fails, THEN THE Refinement_Loop SHALL flag that skill and SHALL leave its `status` field unchanged.
5. THE Refinement_Loop SHALL leave Active_Registry_Snapshot byte-identical to its pre-run value except for Readiness_Rung and flag fields.

### Requirement 21: Cross-Adapter Skill Suggestion (Could tier)

**User Story:** As the Solo Founder, I want a skill proposed for one adapter based on a pattern already proven in another, so that proven capability patterns spread without hand-authoring.

> Could tier. Explicitly outside the Must-tier Min-Viable Scope and outside the Should tier.

#### Acceptance Criteria

1. WHERE cross-adapter suggestion is enabled, THE Skill_Proposer SHALL derive a Gap_Signal for one adapter from a capability pattern already promoted for a different adapter.
2. WHERE cross-adapter suggestion is enabled, THE Skill_Proposer SHALL write the resulting candidate as a Draft_Definition with `status: proposed` and SHALL leave Active_Registry_Snapshot byte-identical to its pre-call value.

### Requirement 22: Excluded Behavior For This Increment (Must tier)

**User Story:** As the Solo Founder, I want the excluded behavior stated as checkable criteria, so that the closed-by-default rule cannot be weakened during implementation.

#### Acceptance Criteria

1. THE Native_Skill_Creation_Harness SHALL expose no code path that promotes a Draft_Definition to `active` without an Operator_Instruction_Reference.
2. THE Native_Skill_Creation_Harness SHALL expose no configuration value, environment variable, or flag whose effect is to open the Promotion_Gate boundary by default.
3. THE Native_Skill_Creation_Harness SHALL introduce no dependency on and no vendored copy of any member of Forbidden_Dependency_Set, per Requirement 12.
4. THE Min-Viable Scope SHALL be proven against the existing `knowgrph` adapter only, and the second-adapter genericity proof SHALL remain outside this increment.

---

## Verification Condition Coverage Map

Every VCC stated in the PRD maps to at least one acceptance criterion above.

| PRD VCC | Covering criteria |
|---|---|
| AC-1: draft Agent Definition emitted with `status: proposed` | 3.1, 2.1 |
| AC-1: iteration count at most stated bound recorded in `trace.jsonl` | 3.3, 4.1, 4.4 |
| AC-1: diff of the active registry file is empty | 3.2, 2.6 |
| AC-2: promoted definition appears in the active registry | 8.4 |
| AC-2: allowlist entry references it | 8.6 |
| AC-2: promotion record names boundary, Evidence Reference, operator instruction reference | 8.5, 10.1 |
| AC-3: active registry diff is empty | 9.1, 9.3 |
| AC-3: `skill-creation: unapproved` status logged with iteration count | 9.2 |
| AC-4: rung changes only as a diff-traceable side effect of a changed Evidence Reference set | 20.1, 20.2 |
| AC-5: shared entrypoint file diff is empty after a new adapter registers | 13.2, 13.4 |
| AC-5: only files owned by that adapter change | 13.3 |
| TAD postcondition: draft plus cost log, or no registry state changed | 6.1 |
| TAD: bounded gap-to-draft latency with p95 check | 18.1, 18.2 |
| TAD: concurrent adapter registration | 13.5, 18.3, 18.4 |
| TAD: promotion attempt with no operator instruction reference rejected | 8.3 |
| TAD: iteration count and circuit-breaker state logged to `trace.jsonl` per call | 4.4 |
| TAD: cost log fields | 5.1 |
| TAD: token budget 800 prompt plus 400 completion at 40 percent cache-hit target | 5.2, 5.3 |
| TAD: offline behavior fails closed, no partial draft persisted | 6.2, 6.3 |
| TAD: zero incremental monthly TCO | 19.1, 19.2, 19.3 |
| ADR-1: no import, wrap, vendor, or call-out to a forbidden package | 12.1, 12.2, 12.3, 22.3 |
| ADR-1: evaluator mechanically distinct from proposer by construction | 11.1, 11.2, 11.3, 11.5, 10.2 |
| ADR-2: three-part registration through the Invocation Surface Contract | 14.1 |
| ADR-2: no product-specific code in the shared entrypoint | 13.4 |
| ADR-2: malformed registration surfaces as `unfederated-tool` or `uncatalogued-tool` | 14.2, 14.3 |
| Invocation Register: fixed routes, tags, bindings, tool identities | 15.1, 15.2, 15.3, 15.4, 15.5 |
| PRD open question: fifth Deploy Boundary Contract field | 10.2, 10.3, 10.4, 10.5 |
| Conflict 1: prerequisite entry condition | 1.1 through 1.5 |
| Conflict 2: ownership boundary and token namespace | 15.6, 15.7, 15.8, 16.1 through 16.6 |
| Conflict 3: module budget and sequencing | 17.1 through 17.5 |
| Repository discrepancy: Draft Registry Store binding | 7.1 through 7.5 |
| Repository discrepancy: active registry has no file to diff | 2.6, and the Active_Registry_Snapshot definition in the Glossary |
