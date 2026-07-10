---
title: "Knowgrph Agentic Canvas OS Harness Contracts"
graphId: "md:knowgrph-agentic-canvas-os-harness-contracts"
doc_type: "Harness Contract Catalog"
date: "2026-07-07"
lang: "en-US"
schema: "agentic-canvas-os-harness-contracts/v1"
frontmatter_contract: "required"
status: "runtime-ready"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_proof: "RUNTIME-PROOF.md"
kgCanvasSurfaceMode: "2d"
kgCanvasRenderMode: "2d"
kgCanvas2dRenderer: "storyboard"
kgDocumentSemanticMode: "document"
kgFrontmatterModeEnabled: true
kgMultiDimTableModeEnabled: true
kgDocumentStructureBaselineLock: false
socket_types:
  harness_source_signal:
    label: "Harness source signal"
    cardinality: "one-to-many"
  harness_execution_signal:
    label: "Harness execution signal"
    cardinality: "one-to-many"
  harness_proof_signal:
    label: "Harness proof signal"
    cardinality: "one-to-many"
flow:
  direction: {key: direction, type: string, value: "LR"}
  edgeType: {key: edgeType, type: string, value: "smoothstep"}
  balancedViewportPreset: {key: balancedViewportPreset, type: string, value: "widgetFrontmatter"}
  computed: {key: computed, type: boolean, value: true}
  snapToGrid: {key: snapToGrid, type: boolean, value: true}
  nodes:
    - id: {key: id, type: string, value: "harness_source"}
      type: {key: type, type: string, value: "source"}
      label: {key: label, type: string, value: "Typed input contract"}
      lane: {key: lane, type: string, value: "spec"}
      position: {key: position, type: object, value: {x: 0, y: 0}}
      handles: {key: handles, type: list, value: ["source.out"]}
      "flow:portTypes": {key: "flow:portTypes", type: list, value: ["harness_source_signal"]}
    - id: {key: id, type: string, value: "dispatcher"}
      type: {key: type, type: string, value: "process"}
      label: {key: label, type: string, value: "Route and schema guard"}
      lane: {key: lane, type: string, value: "runtime"}
      position: {key: position, type: object, value: {x: 260, y: 0}}
      handles: {key: handles, type: list, value: ["dispatcher.in", "dispatcher.out"]}
    - id: {key: id, type: string, value: "executor"}
      type: {key: type, type: string, value: "process"}
      label: {key: label, type: string, value: "Bounded execution"}
      lane: {key: lane, type: string, value: "runtime"}
      position: {key: position, type: object, value: {x: 520, y: 0}}
      handles: {key: handles, type: list, value: ["executor.in", "executor.out"]}
    - id: {key: id, type: string, value: "observer"}
      type: {key: type, type: string, value: "observer"}
      label: {key: label, type: string, value: "Cost and state log"}
      lane: {key: lane, type: string, value: "proof"}
      position: {key: position, type: object, value: {x: 780, y: 0}}
      handles: {key: handles, type: list, value: ["observer.in", "observer.out"]}
    - id: {key: id, type: string, value: "consumer"}
      type: {key: type, type: string, value: "sink"}
      label: {key: label, type: string, value: "Typed artifact target"}
      lane: {key: lane, type: string, value: "projection"}
      position: {key: position, type: object, value: {x: 1040, y: 0}}
      handles: {key: handles, type: list, value: ["consumer.in"]}
  edges:
    - id: {key: id, type: string, value: "harness_source_to_dispatcher"}
      source: {key: source, type: string, value: "harness_source"}
      target: {key: target, type: string, value: "dispatcher"}
      type: {key: type, type: string, value: "harness_source_signal"}
    - id: {key: id, type: string, value: "dispatcher_to_executor"}
      source: {key: source, type: string, value: "dispatcher"}
      target: {key: target, type: string, value: "executor"}
      type: {key: type, type: string, value: "harness_execution_signal"}
    - id: {key: id, type: string, value: "executor_to_observer"}
      source: {key: source, type: string, value: "executor"}
      target: {key: target, type: string, value: "observer"}
      type: {key: type, type: string, value: "harness_proof_signal"}
    - id: {key: id, type: string, value: "observer_to_consumer"}
      source: {key: source, type: string, value: "observer"}
      target: {key: target, type: string, value: "consumer"}
      type: {key: type, type: string, value: "harness_proof_signal"}
---

# Harness Contracts

Every AI-capable Agentic Canvas OS component must be a harness: typed input, typed output, bounded execution, cost logging, and explicit fallback.

## Universal Harness Shape

```yaml
harness:
  id: "[neutral-id]"
  owner: "[shared-runtime-owner]"
  mode: "local-dry-run-first"
  dispatcher:
    input_schema: "[typed request]"
    output_schema: "[routed request or typed error]"
  executor:
    input_schema: "[typed model/tool request]"
    output_schema: "[typed model/tool result]"
    approval_required_for: ["paid-call", "mutation", "payment", "deploy"]
  observer:
    cost_log_fields: ["model", "prompt_tokens", "completion_tokens", "cache_hits", "estimated_cost_usd"]
    state_fields: ["run_id", "stage", "status", "started_at", "updated_at"]
  consumer:
    output_target: "[source document, manifest, graph, table, media packet, or local packet]"
  fallback:
    schema_error: "reject before token spend"
    approval_missing: "blocked with zero paid calls"
    provider_failure: "typed degraded response"
    budget_breach: "blocked with cost summary"
  bounds:
    max_iterations: 1
    circuit_breaker: "schema error, approval denial, budget breach, or verification failure"
```

## Harness Catalog

| Harness | Purpose | Input | Output | Approval boundary |
|---|---|---|---|---|
| OS Status | Read process, capability, cost, gate, and breaker views | `{ view, filters }` | Typed read view with zero cost | None; read-only |
| Capability Discovery | Deduplicate local, browser, Pages, and control-plane catalogs | `{ includeRemote, trustBoundary }` | `Capability_Entry[]`, `sourceCatalogs[]`, `unreachableCatalogs[]` | None; discovery must be zero-token |
| Soul Identity | Load durable agent identity into prompt slot 1 | `{ soulRef, promptSlot, overlayRef }` | Identity packet, typed fallback, scan result, or blocked reason | Mutation only when editing `SOUL.md`; prompt use requires scan |
| Mixture Of Agents | Run bounded advisory reference fan-out and one aggregator-owned response | `{ prompt, presetRef, contextRef, approvals[] }` | Aggregator response, reference ledger, cost log, or blocked reason | Paid reference calls, paid aggregator calls, tool calls, mutation, deploy |
| Video Remix Director | Research, storyboard, render, publish, checkout workflow | `{ referenceUrl, brief, budgetUsd, approvals[] }` | Run manifest, evidence pack, storyboard, asset or blocked state | Paid model, render, payment, deploy |
| Canvas Dashboard | Project source-backed run state into Canvas | Markdown/frontmatter + typed manifest | KGC/frontmatter graph and Storyboard cards | Mutation only when writing source docs |
| Memory Layer | Add, replace, remove, compact, search, and snapshot bounded memory/profile targets | `{ target, action, content, query, policy }` | Write result, capacity error, snapshot, ranked matches, or empty result | Writes require scan, capacity check, and explicit scope |
| Stateful Orchestration | Run source-backed graph state, nodes, edges, checkpoints, and review gates | `{ graphRef, state, input, approvals[] }` | Graph run trace, checkpoint, result, or blocked reason | Checkpoint writes, human review, paid calls, mutation, deploy |
| Experience Capture | Convert proof, failures, and operator corrections into reusable lessons | `{ sourceRef, proofRef, lesson, applicability }` | Typed experience record or rejected capture | Writes require explicit scope and no-copy guard |
| Skill System | Discover, load, bundle, scan, and manage on-demand skills | `{ query, skillId, resourcePath, bundleRef, action }` | Metadata index, skill context, resource packet, bundle resolution, proposed diff, or rejection | Writes and unsafe external sources require scan, validation, and approval policy |
| Context Files | Discover, load, scan, truncate, and audit project-local context | `{ workingDirectory, touchedPaths[], contextType }` | Effective context, skipped matches, blocked files, truncation ledger, or audit result | Context cannot override facts, identity, safety, approval, or deploy gates |
| Context References | Expand explicit message references into bounded attached context | `{ message, workingDirectory, referencePolicy }` | Original message, attached context packets, warnings, refusals, or unsupported-platform result | URL egress, sensitive paths, binary content, hard limits, and unsafe references fail closed |
| Kanban Collaboration | Manage durable task and handoff rows across named profiles | `{ boardRef, row, profile, workerProcess }` | Validated row, handoff row, sync ledger, conflict, or missing-board result | Board writes stay in `kanban.md`; no hidden subagent swarm or duplicate store |
| Tool Gateway | Route web, image, TTS, and browser tool calls through existing infrastructure | `{ category, provider, input, approvals[] }` | Tool result, unavailable provider, approval-required, cost log, or typed fallback | Paid, egress, generated-media, and browser-auth actions require approval |
| Toolsets | Enable or disable logical bundles of existing tool functions per platform | `{ toolsetId, platformSurface, action, approvals[] }` | Scoped enablement state, missing-function list, approval-required, or blocked reason | Paid, mutating, terminal, filesystem, browser-auth, egress, and generated-media toolsets require approval |
| Tool Search | Defer eligible tool schemas behind bridge search, describe, and call routes | `{ query, toolName, arguments, sessionToolsets }` | Matches, selected schema, tool result, approval-required, or blocked reason | Bridge never bypasses real tool policy, approval, hooks, audit, or cost |
| Skill Evolution | Propose new or improved skills from evaluated experience | `{ skillId, experienceRefs[], evaluationPlan }` | Proposal diff, validation packet, or blocked reason | Human review required; direct auto-commit forbidden |
| Identity Reflection | Persist stable operator preferences and project boundaries | `{ sourceRef, proposedFact, sensitivity }` | Identity note or rejected inference | Operator authority required; secrets forbidden |
| Showrunner | Run bounded creative multi-agent turns | Creative brief + role turn | Creative state, script, choice graph | Stage approval and paid calls |
| SuperAgent | Execute bounded long-horizon research, code, and creation tasks | Goal, graph, sandbox, message policy, constraints | Run plan, checkpoints, messages, artifacts, verification, cost log | File writes, terminal, browser auth, paid calls, deploy |
| Agent Sandbox Policy | Compile and authorize native deny-first agent boundaries | Policy path and one typed operation | Policy digest, allow or deny, reason code, redacted audit packet, enforcement gap | No execution; OS/kernel containment remains mandatory for adversarial code |

## Soul Identity Harness Contract

Soul identity harnesses assemble durable identity before operational context. External SOUL systems may inform the layer split, but local harnesses must not copy external identity text, prompt assembly code, preset examples, schemas, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Source read | `{ soulRef }` | Raw soul source or typed missing result. | Source must be `SOUL.md` or approved identity store, not runtime hardcode. |
| Scan and bound | `{ sourceText, maxChars }` | Safe bounded identity text or typed unsafe result. | Prompt-injection patterns, secrets, and excessive length are rejected or truncated by policy. |
| Slot assembly | `{ identityText, promptSlot }` | Slot 1 identity packet. | Identity loads before tools, memory, skills, project context, and overlays. |
| Fallback | `{ failureReason }` | Typed fallback identity state. | Missing, empty, unsafe, or unreadable source does not silently embed a default string. |
| Overlay | `{ overlayRef, sessionId }` | Session overlay packet or rejection. | Overlay is temporary and cannot mutate `SOUL.md` or bypass gates. |

### Soul Guardrails

| Guardrail | Requirement |
|---|---|
| Identity only | Soul content covers voice, tone, directness, uncertainty, disagreement, ambiguity, and avoid-list defaults. |
| No operations | Repo commands, file paths, service ports, architecture instructions, deployment approvals, and credentials are rejected from soul content. |
| No hardcoded default | Runtime prompt assembly resolves `@soul-profile` or returns typed fallback. |
| Overlay subordinate | Personality overlays cannot override facts, safety, role rules, memory boundaries, approval gates, or deploy guards. |
| No external copy | Do not import Hermes code, default identity text, personality preset examples, prompt assembly code, schemas, tests, fixtures, or prose. |

## Context Files Harness Contract

Context-file harnesses discover project-local behavioral instructions from scoped working directories and touched paths. External context-file systems may inform the stage shape, but local harnesses must not import external discovery code, scanner code, example files, prompt assembly text, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Startup discover | `{ workingDirectory }` | First-match project context or empty result. | Working directory is explicit; no unbounded sibling or home scan. |
| Progressive discover | `{ touchedPaths[], visitedDirs[] }` | Relevant subdirectory context hints. | Each directory is checked at most once per session. |
| Scan and bound | `{ contextFile, maxChars }` | Loaded context, truncated context, or blocked result. | Prompt injection, secrets, exfiltration, invisible controls, and excessive length fail closed. |
| Precedence | `{ candidates[] }` | Effective context plus skipped matches. | One project context type per scope; `FACTS.md` and `SOUL.md` remain stronger local layers. |
| Audit | `{ scope }` | Context ledger, stale-risk list, blocked-file list, and proof. | Read-only and deploy-free. |

### Context File Guardrails

| Guardrail | Requirement |
|---|---|
| Project-local | Context discovery starts from `@working-directory` and touched paths only. |
| Subordinate | Context files cannot override facts, identity, safety, approval, system, developer, operator, or deploy instructions. |
| No external copy | Do not import Hermes context discovery code, scanner code, example context files, prompt assembly text, tests, fixtures, or prose. |

## Context References Harness Contract

Context-reference harnesses attach explicit `@` references to the current message. External context-reference systems may inform the stage shape, but local harnesses must not import external parser code, prompt section text, examples, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Parse | `{ message }` | Reference tokens or empty result. | Only approved `@file:`, `@folder:`, `@diff`, `@staged`, `@git:`, and `@url:` forms are expansion targets. |
| Resolve | `{ token, workingDirectory }` | Normalized source or warning. | Workspace scope, path traversal, line range, git count, and URL egress policy are checked. |
| Scan and bound | `{ source, content, limits }` | Attached context, warning, truncation, or refusal. | Sensitive paths, secrets, binary content, and hard-limit overflow fail closed. |
| Attach | `{ message, packets[] }` | Original message plus `@attached-context`. | Unsupported platforms preserve raw text and report typed warning. |
| Audit | `{ packets[] }` | Source, size, warning, refusal, and cost ledger. | Read-only and deploy-free. |

### Context Reference Guardrails

| Guardrail | Requirement |
|---|---|
| Binding separation | Message-time references do not convert ordinary `@agent` or `@operator` bindings into expansion targets. |
| Warning visible | Missing, invalid, unsupported, refused, or truncated references are explicit packets, not silent drops. |
| No external copy | Do not import external context-reference parser code, prompt text, examples, tests, fixtures, or prose. |

## Kanban Collaboration Harness Contract

Kanban collaboration harnesses coordinate named profiles through `kanban.md` rows. Context-reference patterns may inform row context refs, but local harnesses must reuse shared table/Kanban utilities and must not import copied board runtimes, schema examples, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Board read | `{ boardRef }` | Parsed task table or missing-board result. | `kanban.md` is the SSOT; no second datastore. |
| Task write | `{ taskRow, profile }` | Validated task row or rejection. | Stable id, owner profile, status, acceptance, evidence, and next action are required. |
| Handoff write | `{ handoffRow }` | Validated handoff row or rejection. | From, to, task id, context refs, blockers, resume state, and acceptance are required. |
| Worker bind | `{ profile, process }` | Worker binding or blocked result. | Worker is a full OS process with identity, cwd, command, proof, bounds, and cleanup. |
| Sync | `{ boardRows }` | Sync ledger or conflict packet. | Conflicts preserve evidence and require explicit resolution. |

### Kanban Guardrails

| Guardrail | Requirement |
|---|---|
| Durable rows | Every task and handoff is a Markdown row readable by all profiles. |
| Shared utilities | Use existing multi-dimensional table/Kanban utilities only. |
| No swarm | Do not coordinate through fragile in-process subagent state. |
| No deploy mutation | Board writes do not imply Prod mirror or Cloudflare deploy. |

## Mixture Of Agents Harness Contract

MoA harnesses are one-shot deliberation contracts. External MoA systems may inform the stage shape, but local harnesses must remain provider-neutral and free of copied code, prompts, preset examples, provider names, schemas, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Preset resolution | `{ presetRef, prompt, contextRef }` | Resolved local preset, usage response, or typed missing-preset error. | Bare `/moa` returns usage; recursive MoA aggregator is rejected before spend. |
| Reference fan-out | `{ references[], prompt, trimmedContext, caps }` | Advisory reference outputs or typed reference failures. | No tools, no mutation, max tokens, timeout, and cost logging are required. |
| Private context assembly | `{ referenceLedger, prompt, contextRef }` | Aggregator context packet. | Advisory outputs are private context, not source truth or generated docs. |
| Aggregation | `{ aggregator, contextPacket, toolSchemas, approvals[] }` | User-visible response, tool request, or typed fallback. | Aggregator owns final answer and normal approval gates. |
| Restore | `{ priorModelContext, runId, costLog }` | Restored model or agent context and proof ledger. | `/moa` does not globally switch models or persist copied presets. |

### MoA Guardrails

| Guardrail | Requirement |
|---|---|
| Reference cap | Every reference call names max tokens, timeout, and failover policy. |
| Aggregator-only action | Tool calls, mutation, and transcript persistence are aggregator-owned. |
| Cost separation | Cost log separates reference and aggregator token counts, cache hits, failures, and estimated cost. |
| Prompt cache | Stable prompt prefixes and cached context should be reused; advisory tails stay bounded. |
| No recursion | Aggregator cannot be another MoA preset. |
| No external copy | Do not import Hermes code, prompts, preset examples, provider names, schemas, tests, fixtures, or prose. |

## Tool Gateway Harness Contract

Tool gateway harnesses route concrete tool calls through existing `knowgrph` infrastructure. External gateway systems may inform category semantics, but local harnesses must not import external gateway code, provider tables, model lists, config examples, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Catalog | `{ categories[], includeToolsets }` | Tool functions, toolsets, platform state, and gateway/direct/local/unavailable state. | Read-only, zero model spend, no tool execution. |
| Provider select | `{ category, providerMode }` | Non-secret routing preference or rejection. | Credentials remain server-managed; no browser secrets. |
| Toolset state | `{ toolsetId, platformSurface, action, approvals[] }` | Enabled, disabled, unchanged, approval-required, or blocked result. | Resolve existing functions only; scope state to one platform surface. |
| Route | `{ category, provider, input, approvals[] }` | Tool result or typed fallback. | Validate schema, approval, egress, cost, and redaction before execution. |
| Audit | `{ scope }` | Usage, cost, provider, and blocked-reason ledger. | Read-only and deploy-free. |

## Tool Search Harness Contract

Tool Search harnesses minimize model-visible schema load for eligible MCP and non-core plugin tools. External tool-search systems may inform the stage shape, but local harnesses must not import external code, retrieval implementation, bridge prompt text, examples, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Activate | `{ mode, threshold, sessionToolsets }` | Direct exposure, bridge exposure, or disabled state. | Opt-in or budget-threshold only; core required tools stay direct. |
| Search | `{ query, limit }` | Ranked deferred metadata or empty result. | Search only `@deferred-tool-catalog`; no global registry scan. |
| Describe | `{ toolName }` | Selected tool schema or unavailable result. | Schema must come from the current session catalog. |
| Call | `{ toolName, arguments, approvals[] }` | Real tool result, approval-required, schema error, cost log, or typed fallback. | Enforce the underlying tool identity, policy, approval, hooks, and audit. |
| Audit | `{ scope }` | Deferred catalog, bridge use, cost, and blocked-reason ledger. | Read-only and deploy-free. |

### Tool Category Guardrails

| Category | Requirement |
|---|---|
| Tool function | Schema, owner, risk class, cost posture, and typed fallback. |
| Toolset | Existing functions only; no external registry copy, missing-tool fabrication, or global enablement. |
| Platform toolset | Enablement is scoped to one platform surface and does not transfer across CLI, chat, browser, MCP, or control plane. |
| Web search/extract | Source scope, citations, egress policy, cache behavior, and cost log. |
| Image generation | Approval gate, prompt bounds, artifact manifest, and cost log. |
| Text-to-speech | Voice/provider, text bounds, output manifest, duration guard, and cost log. |
| Cloud browser | Isolated session, action schema, screenshot/vision bounds, redaction, trace, and approval. |
| Tool Search | Session-scoped deferred catalog, on-demand schema, bridge dispatch, and no copied retrieval implementation. |

## Learning Harness Contract

Learning harnesses are source-backed and proposal-first. External self-improving agent repositories may inform the shape of the loop, but local harnesses must remain provider-neutral, FOSS-first, and free of copied external implementation artifacts.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Memory write | `{ target, action, content, oldText, evidenceRef }` | Write result, duplicate result, scan rejection, or capacity error. | Target must be `memory` or `user`; scan and capacity check run before persistence. |
| Memory compact | `{ target, entries[], requiredChars }` | Before/after entries and capacity delta. | No silent drops; durable facts and explicit profile preferences are preserved. |
| Memory search | `{ scope, query, topK, sourceFilters }` | Ranked cited memories or empty result. | Read-only unless `@operator` approves persistence. |
| Session search | `{ query, cursor, topK }` | Cited prior-session matches or empty result. | Search results are not memory until explicitly captured. |
| Experience capture | `{ sourceRef, proofRef, eventType, lesson }` | Experience record with applicability, expiry risk, cost, and approval state. | Reject missing provenance, secrets, copied code, or deploy artifacts. |
| Skill proposal | `{ experienceRefs[], targetGap }` | Skill draft with schemas, fallback, bounds, cost fields, and VCCs. | Reject duplicate catalog entries and hardcoded provider assumptions. |
| Skill evolution | `{ skillId, evalPacket, candidateDiff }` | Proposed diff plus validation and semantic-preservation statement. | Require focused checks and human review; never direct auto-commit. |
| Identity reflection | `{ proposedFact, evidenceRefs[], sensitivity }` | Stable identity note or rejected inference result. | Store only non-secret, source-backed operator and project facts. |

## Skill System Harness Contract

Skills are on-demand procedural knowledge. External systems may inform the pattern, but local harnesses must not import external skill bodies, examples, repository layouts, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Discover | `{ query, filters }` | Lightweight index rows. | Metadata only; no full bodies, secrets, or model spend. |
| Load source | `{ skillId }` | Parsed bounded skill source. | Load only after selection; frontmatter and body validate. |
| Load resource | `{ skillId, resourcePath }` | Resource packet or rejection. | References are shallow, path-safe, and loaded only when required. |
| Bundle | `{ bundleRef }` | Resolved skill ids and skipped missing ids. | Bundles alias existing skills and cannot bypass gates. |
| Manage | `{ action, candidateDiff }` | Proposed, staged, applied, or rejected write. | Scan, validate, and require review when `@skill-policy` demands it. |

### Skill Guardrails

| Guardrail | Requirement |
|---|---|
| Progressive disclosure | Index first, selected skill second, specific resources third. |
| Open-standard shape | Skill source keeps standard frontmatter, concise description, Markdown body, optional resources, and validation. |
| Security | External or managed skills fail closed on dangerous content, copied artifacts, secrets, or incompatible requirements. |
| No deploy mutation | Skill management cannot write Prod mirror or deploy Cloudflare. |

### Evolution Guardrails

| Guardrail | Requirement |
|---|---|
| Bounded optimizer | Any evaluation or variant generation names max iteration, timeout, budget, and circuit breaker. |
| Semantic preservation | Proposed changes state what behavior must remain unchanged. |
| Focused tests | Evolution output names focused checks and their result before promotion. |
| Human review | Proposed diffs stay review-pending until the operator approves persistence. |
| No external copy | Do not import external code, prompt bodies, schemas, test files, fixtures, or prose. |
| No deploy mutation | Skill evolution cannot write the Prod mirror or deploy Cloudflare. |

## Persistent Memory Harness Contract

Persistent memory harnesses keep always-available context compact and curated. External memory systems may inform the layer shape, but local harnesses must not import external memory code, database schemas, sample entries, prompt renderers, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Target select | `{ target }` | `memory` or `user` target contract. | Reject mixed target writes and unsupported profile inference. |
| Scan | `{ content }` | Safe content or typed scan rejection. | Block prompt injection, exfiltration, credentials, invisible control characters, and sensitive profiling. |
| Capacity check | `{ target, action, content, oldText }` | Accepted budget or typed capacity error. | Overflow fails before persistence; compaction is explicit. |
| Write | `{ action, content, oldText }` | Add, replace, remove, duplicate, or not-found result. | Replace/remove must match exactly one entry by stable substring or id. |
| Snapshot | `{ target, sessionId }` | Frozen session-start snapshot with usage counts. | Active prompt snapshot is immutable after session start. |
| Session search | `{ query, cursor }` | Cited session matches. | Search is read-only and zero model spend by default. |

### Memory Guardrails

| Guardrail | Requirement |
|---|---|
| Target separation | Agent notes belong in `MEMORY.md`; explicit operator profile belongs in `USER.md`. |
| Bounded stores | Each target names a character limit and returns typed capacity errors. |
| Curated entries | Entries are compact, durable, source-backed, and non-secret. |
| Frozen snapshot | Prompt memory is captured once at session start for cache stability. |
| No external copy | Do not import Hermes memory code, sample entries, database schemas, prompt renderers, tests, fixtures, or prose. |

## Stateful Orchestration Harness Contract

Stateful orchestration harnesses model long-running agent work as neutral graph contracts. External graph orchestration frameworks may inform concepts, but local harnesses must not import external runtime code, API shapes, examples, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Graph declaration | `{ stateSchema, nodes[], edges[], entry, exit }` | Compile-check result or typed graph error. | Reject orphaned nodes, hidden side effects, missing stop condition, and unbounded cycles. |
| Node execution | `{ nodeId, state, input, context }` | State update, command, trace event, or typed error. | Validate input/output schemas before model or tool spend. |
| Edge routing | `{ state, nodeResult, edgeGuards[] }` | Next node ids, halt, or blocked result. | Conditional routes must be deterministic, bounded, and auditable. |
| Checkpoint | `{ runId, state, step, resumeToken }` | Durable checkpoint or rejected persistence. | Require scope, idempotency, recovery proof, and cleanup path. |
| Human review | `{ interruptPayload, state, proposedAction }` | Approve, reject, edit, or blocked continuation. | Continuation requires `@operator` approval. |
| Stream trace | `{ runId, eventCursor }` | Ordered stage, state, cost, and stop events. | Events are secret-free and tied to `@runtime-proof`. |

### Orchestration Guardrails

| Guardrail | Requirement |
|---|---|
| State schema | Every graph names typed state fields and update semantics. |
| Idempotency | Side-effecting nodes name idempotency keys and retry behavior. |
| Recursion bound | Loops name max iteration, recursion limit, timeout, and circuit breaker. |
| Durable resume | Checkpoints prove resume from the latest accepted state, not from stale recomputation. |
| Human gate | Review interrupts block until approve, reject, or edit result is typed. |
| No external copy | Do not import LangGraph code, API schemas, examples, tests, fixtures, or prose. |

## SuperAgent Harness Contract

SuperAgent harnesses compose orchestration, memory, skills, tools, sandboxed workspace, message gateway, artifacts, and verification for minutes-to-hours work. DeerFlow can inform the capability class, but local harnesses must not import its code, prompts, provider configs, runtime layout, examples, tests, fixtures, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Goal plan | `{ goal, constraints, budget }` | Task graph or typed blocked result. | Must name stop condition, expected artifacts, approvals, and max iterations. |
| Context load | `{ memoryRefs, skillRefs, sourceRefs }` | Bounded context packet. | Metadata-first skills and scoped memory search; no raw transcript dump. |
| Workspace bind | `{ workspaceRoot, operations[] }` | `@sandbox-workspace` packet. | Allowed reads, writes, execution, uploads, outputs, diff summary, and cleanup are explicit. |
| Message route | `{ runId, events[] }` | `@message-gateway` ledger. | Sender, recipient, schema, state transition, replay rule, and visibility boundary are typed. |
| Verify | `{ artifacts, checks[] }` | Proof packet or failed VCC. | Artifact manifest, focused checks, cost log, and deploy boundary must be surfaced. |

## Cost Log Contract

Every model-bearing harness emits:

| Field | Rule |
|---|---|
| `model` | Actual model id or `local-dry-run`. |
| `prompt_tokens` | Non-negative integer; zero for model-free views. |
| `completion_tokens` | Non-negative integer; zero for model-free views. |
| `cache_hits` | Non-negative integer or boolean-derived count. |
| `estimated_cost_usd` | Decimal estimate; exact zero for read-only model-free views. |

Do not clamp unexpected non-zero cost to zero. Treat it as a defect.

## Approval Gates

| Gate | Required for | Fail-closed behavior |
|---|---|---|
| `paid-model-call` | Model/provider spend | Return blocked or approval-required with zero paid calls. |
| `render-action` | Image/video generation or media mutation | Preserve prior state and emit pending gate. |
| `payment-action` | Checkout, settlement, payout, or commerce state | No session or payout is created. |
| `cloud-deploy` | Prod mirror or Cloudflare deploy | Do not run deploy command; surface gated status. |
| `consumer-repo-write` | Writing to sibling repo or generated source doc | Keep dry-run manifest only. |
| `authenticated-browser` | Browser profile, login-gated page, or sensitive session | Require operator-owned browser action; store no credentials. |

## VCC Templates

| Harness class | VCC |
|---|---|
| Read-only discovery | Verify response has typed entries, zero cost, and no state-source diff. |
| Local dry-run | Verify command exits 0, manifest status is complete or blocked, and paid call count is 0. |
| Approval-gated action | Verify missing approval blocks before spend; valid approval advances only the approved stage. |
| Canvas projection | Verify frontmatter parses, graph nodes materialize, and no dashboard-only renderer is introduced. |
| Cost aggregation | Verify cost logs validate and budget meters match ledger events within stated tolerance. |

## Forbidden Harness States

- Running without `max_iterations`.
- Retrying without circuit breaker.
- Calling a model before input schema validation.
- Returning raw provider errors without typed fallback.
- Writing browser secrets or provider keys into docs, tests, client state, or logs.
- Marking a live provider result complete without returned evidence.
