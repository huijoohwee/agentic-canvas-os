---
title: "Knowgrph Agentic Canvas OS Harness Contracts"
graphId: "md:knowgrph-agentic-canvas-os-harness-contracts"
doc_type: "Harness Contract Catalog"
date: "2026-07-18"
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
| Repository Packing | Convert one exact local Git worktree into a deterministic content-addressed Markdown artifact | `{ repositoryPath, outputDirectory, includePaths, excludePaths, maxFiles, maxFileBytes, maxTotalBytes }` | `knowgrph-repository-pack-result/v1` metadata, typed omissions, verified digests, or source-byte-free block | Explicit local artifact request only; secrets, escape, drift, overflow, external dependency, network, model, Prod, and Cloudflare fail before publication |
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
| Tool Search | Keep optional schemas behind session metadata and load exact selected definitions | `{ sessionId, catalogRevision, mode, query, toolName }` | Immutable initial context, append-only definitions, authorization, cost, or typed block | Search stays top-level; loading never bypasses real tool policy, approval, hooks, audit, or cost |
| Function Calling | Continue direct model-requested functions through the application gateway | `{ runId, input, tools[], capabilities, toolChoice }` | Final output, same-id outputs, separate model and gateway costs, or typed block | Strict schemas and explicit capabilities required; signed review evidence enters only the real gateway review owner |
| Agent Definitions | Package one source-backed specialist's intrinsic runtime configuration without granting execution authority | `{ definition, revision, sourceVerifier, applicationAuthorizer }` | Immutable prepared packet, validated output, or typed block | Exact source evidence precedes reference-only capability checks; Running Agents, gateways, MCP owners, and output validators retain execution and policy |
| Models And Providers | Resolve an application-registered provider revision, model, and transport without executing it | `{ agentModel, runDefault, processDefault, requirements }` | Immutable selection packet or typed block | Exact registration, feature, delivery, and connection matching precede adapter execution; credentials and provider calls stay external |
| Running Agents | Drive one bounded application turn across model, tool, handoff, pause, and final stages | `{ runId, conversationId, agent, input, continuation }` | Completed, paused, or blocked settlement plus continuation, evidence, and honest cost | One strategy per conversation; streaming shares the same loop; adapters and gateways retain execution policy |
| Agent Orchestration | Route one exact manager or specialist branch with explicit public ownership | `{ runId, conversationId, workflowId, workflowRevision, branchId, input }` | Source-owned delegated answer, target-owned handoff answer, or typed block | Every branch fixes conversation and final-answer ownership; authorization, exact agent resolution, and Running Agents execution remain separate |
| Agent Swarm | Dynamically decompose one goal and coordinate bounded independent work horizontally | `{ runId, conversationId, agent, goal, input, maxParallel }` | One base-agent synthesis, recoverable ledger, sanitized trace, verified receipts, cost, or typed block | Callers cannot define roles, tasks, workflows, principals, or signals; authorization and exact-agent resolution precede spend and existing tool owners retain side effects |
| Agent Toolkit | Observe application-authorized digest-bound agent or team candidates, evaluate unique opaque evidence, and compare one bounded trusted cohort | `{ runId, cohortId, target, candidate, adapter, operation, profile }` plus a stable tenant principal | Metadata-only trust-labelled trace, honest cost and metric provenance, deterministic hold/propose result, review-pending proposal, or typed block | Existing runtimes keep execution; caller digests need application verification, remote-unverified evidence is excluded, and raw payloads, nested cost duplication, cross-cohort comparison, or automatic application are forbidden |
| Agent Runtime Composition | Join exact definition, model selection, lifecycle, output validation, and orchestration interfaces | `{ agent, role, workflow, branch, input }` | Validated final output and fully reported cost, or bounded block | Existing owners remain authoritative; missing or changed evidence fails before public output |
| Opt-In Autonomous Runtime | Admit one server-configured source definition to the authenticated Worker composition route | `{ runId, conversationId, input }` | Validated text and reported cost, unconfigured refusal, or bounded block | Enablement, spend approval, source digest, model alignment, session auth, and provider-call ceiling are all mandatory; tools and mutations remain on existing reviewed owners |
| Application Composition | Compile exact component and integration interfaces into one immutable deterministic dependency plan, then sequence ready steps through existing owners | `{ manifest, componentCatalog, integrationProfile, runtimeProof }` plus operator approval only for live or mutating execution | Digest-bound plan, bounded owner results, explicit migration diagnostics, or typed block | No new agent loop, provider registry, tool gateway, integration proxy, automatic upgrade, retry, migration, or deploy |
| Progressive Agents | Grow from one exact agent run to tool-bearing definitions and explicit specialist workflows | `{ runId, conversationId, agentId, revision, input }` or an exact workflow request | Agent-owned direct output, manager-owned delegation, specialist-owned handoff, or bounded block | Facade delegates to existing owners; tool authorization, execution, provider transport, and answer ownership never move into the facade |
| Programmatic Tool Calling | Reduce predictable read-only tool stages through provider-hosted JavaScript | `{ runId, input, tools[], capabilities }` | Final output, compact evidence, cost log, or typed blocked result | Hosted execution and caller lineage required; writes, approvals, and semantic judgment stay direct |
| Instruction Audit | Keep durable guidance and the skill catalog lean without losing required intent | `{ documents, baselineDocuments? }` | `agentic-instruction-audit/v1` report with metrics, violations, cost, and deploy state | Read-only and model-free; no automatic rewrite or deployment authority |
| Instruction Task Quality | Screen final-answer behavior after structural instruction changes | `{ suite, candidate }` | `agentic-instruction-task-quality/v1` per-case findings and aggregate score | Model-agnostic lexical rubric; exact provenance and human review required; no private reasoning access or deployment authority |
| Skill Evolution | Propose new or improved skills from evaluated experience | `{ skillId, experienceRefs[], evaluationPlan }` | Proposal diff, validation packet, or blocked reason | Human review required; direct auto-commit forbidden |
| Identity Reflection | Persist stable operator preferences and project boundaries | `{ sourceRef, proposedFact, sensitivity }` | Identity note or rejected inference | Operator authority required; secrets forbidden |
| Showrunner | Run bounded creative multi-agent turns | Creative brief + role turn | Creative state, script, choice graph | Stage approval and paid calls |
| SuperAgent | Execute bounded long-horizon research, code, and creation tasks | Goal, graph, sandbox, message policy, constraints | Run plan, checkpoints, messages, artifacts, verification, cost log | File writes, terminal, browser auth, paid calls, deploy |
| Agent Sandbox Policy | Compile and authorize native deny-first agent boundaries | Policy path and one typed operation | Policy digest, allow or deny, reason code, redacted audit packet, enforcement gap | No execution; OS/kernel containment remains mandatory for adversarial code |

## Instruction Audit Harness Contract

| Stage | Input | Output | Guard |
|---|---|---|---|
| Read | `AGENTS.md`, `SKILLS.md`, optional exact Git baseline | In-memory source map | Declared repository files only; no broad workspace scan. |
| Measure | Body prose plus complete-file size | Words, directive units, route mentions, code fences, estimated tokens | Frontmatter is excluded from prose budgets but included in total context size. |
| Preserve | Required intent markers | Missing-intent list | Slimming cannot remove workflow, proof, source, external-boundary, or deploy intent. |
| Detect | Normalized directive units and delegated-detail patterns | Duplicate and canonical-owner findings | Exact structural checks only; no model-based style score. |
| Report | Findings and optional baseline | Typed audit result | Zero model usage, no source rewrite, and no Prod or Cloudflare action. |

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
| No hidden swarm | Named-profile coordination cannot use process-local subagent state; a dynamic application swarm requires its explicit durable ledger contract. |
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

Tool Search harnesses minimize model-visible schema load for eligible MCP and non-core plugin tools. External tool-search systems may inform the capability class, but local harnesses must not import external code, search implementation, prompts, examples, tests, fixtures, schemas, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Register | `{ sessionId, catalogRevision, mode, capabilities, namespaces, tools }` | Immutable direct definitions, deferred metadata surfaces, and typed evidence. | Current grants only; duplicate, oversized, stale, or unsupported catalogs fail before registration. |
| Search | `{ eventId, query, limit, caller }` | Exact loaded names or typed block. | Top-level caller only; search still-unloaded session metadata without global registry access. |
| Load | Client names or provider-normalized hosted definitions | Append-only canonical definitions. | Unknown, altered, duplicate, direct, over-limit, replayed, or cost-unreported output fails closed. |
| Authorize | `{ sessionId, toolName, caller }` | Canonical definition or typed refusal. | Direct tools remain available; deferred tools require prior load; the real gateway still owns execution policy. |
| Audit | Readiness and session counters | Bounds, search mode, loaded count, and blocked count. | No provider reduction, cache hit, spend, or live execution is inferred. |

## Models And Providers Harness Contract

Models and Providers owns deterministic selection without absorbing provider SDK, endpoint lifecycle, credential, pricing, or Running Agents responsibilities. The cited provider guide informs the capability class; local definitions, precedence, transport metadata, tests, fixtures, and prose remain independently authored.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Register | Provider id, revision, adapter id, model features, transports, and provider-local defaults | Immutable provider definition | Same-revision drift, unknown fields, invalid defaults, duplicates, and capacity fail closed. |
| Select | Agent model, run default, and process default | Winning provider and model source | Agent precedes run, run precedes process, and a provider default only fills an omitted model. |
| Match | Selected provider plus model feature, delivery, and connection requirements | Exact compatible model and transport | Missing features or incompatible transport behavior blocks before adapter execution. |
| Prepare | Provider revision, adapter id, model id, transport id, sources, and requirements | Immutable Running Agents adapter packet | Endpoints, credentials, prompts, provider objects, usage, and cost remain outside the packet. |
| Report | Registry counters, limits, and sanitized environment facts | `modelProviders` readiness | Secret values and fabricated provider execution evidence are forbidden. |

The environment adapter requires one complete neutral route and ignores provider-specific aliases. Multi-provider applications register additional definitions and adapters directly. Offline proof establishes configuration and resolution only; live capability, delivery, connection, usage, and cost remain unverified.

## Running Agents Harness Contract

Running Agents owns application-turn lifecycle without absorbing provider, Function Calling, Programmatic Tool Calling, Tool Search, gateway, or durable-state responsibilities. The cited provider guides inform the capability class; local transitions, strategy state, events, schemas, tests, fixtures, and prose remain independently authored.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Validate | Run, conversation, agent, JSON input, one continuation strategy | Immutable request or typed preflight block | Mixed strategy state, stale continuation, replayed run, active, paused, blocked, or unconfigured conversation fails closed. |
| Advance | Current agent, input, continuation, optional resume resolution | Completed, paused, or model/tool/handoff continuation | The injected adapter owns provider translation and delegates execution to existing controllers. |
| Continue | Normalized transition and next input | Next bounded step plus compact evidence | Handoffs change agent; no transition grants tool authority. |
| Stream | The same active loop and bounded adapter events | Async events plus a terminal result promise | The iterable closes only after completed, paused, or blocked settlement. |
| Resume | Exact run, conversation, token, resolution, and local or durably claimed opaque state | Next step of the same turn | New turns and competing claimants cannot bypass a pause; raw state never enters the public result. |
| Finalize | Final adapter output and continuation update | Output, continuation, transition evidence, and honest aggregate cost | Intermediate inputs, raw adapter objects, resume state, and provider wire events remain internal. |

The controller supports application history, downstream session identity, downstream conversation identity, or previous-response identity, never a mixture. Bounds cover steps, history, input, state, paused snapshots, output, event size and count, conversation capacity, recent run replay, claims, and stage time. The Durable Object adapter proves cross-isolate paused-turn recovery locally; live model, reviewed side effects, session, and provider streaming remain unverified.

## Agent Orchestration And Handoffs Harness Contract

Agent Orchestration owns explicit manager and specialist topology without absorbing Agent Definitions, model selection, Running Agents lifecycle, gateway policy, or durable conversation state. The cited provider guides inform the capability class; local branch modes, ownership fields, role inputs, results, evidence, tests, and prose remain independently authored.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Register | Exact manager, specialists, responsibilities, revisions, branches, and ownership | Immutable workflow revision | Duplicates, orphans, unknown agents, self-routes, unsupported fields, and revision drift fail closed. |
| Authorize | Exact delegate or handoff action, workflow, branch, identities, and input | Approval identity | Policy runs before resolution and execution; topology never grants authority. |
| Resolve | Source and target agent references | Exact identity and revision evidence | Both participants must match the registered revision. |
| Delegate | Target specialist task followed by source manager synthesis | Source-owned public output | The target stays behind the source; specialist intermediate output is never returned separately. |
| Handoff | Target user-facing task | Target-owned public output | Conversation and final-answer ownership transfer together after successful completion. |
| Continue | Current conversation owner plus the next registered branch | Next owner or typed block | Branch source must equal current owner; workflow revision cannot drift. |
| Finalize | Completed agent outcomes and cost logs | Public output, owner identities, approval, cost, and compact evidence | Failed work does not change ownership; raw errors and adapter details remain private. |

Bounds cover workflow revisions, participants, branches, input, output, conversations, replay identities, and stage time. Offline proof establishes orchestration behavior only; provider execution and durable cross-isolate conversation ownership remain unverified.

## Agent Runtime Composition Harness Contract

Composition owns only the adapter seams between source-backed Agent Definitions, Models and Providers, Running Agents, and Agent Orchestration. It does not own provider translation, workflow authorization, capability grants, or public-answer policy.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Prepare | Exact agent id and revision | Source-verified prepared packet | Missing verifier, source mismatch, stale revision, denied reference, or missing handoff blocks. |
| Select | Prepared model route and derived features | Exact provider, model, and transport packet | Missing route or feature and transport mismatch block before adapter work. |
| Execute | Prepared packet, selection packet, role, branch, input, and continuation | Running Agents settlement | One bounded internal conversation exists per external conversation and agent. |
| Validate | Completed output and exact agent revision | Text or structured final output | Invalid output clears the internal continuation before retry. |
| Orchestrate | Resolver and runner interfaces | Manager-owned delegation or target-owned handoff | Registered topology and authorizer remain the sole public-ownership owners. |

Only a fully reported aggregate cost becomes a downstream cost log. Missing or partial usage remains unreported. Offline proof establishes integrated owner behavior without establishing provider reachability, quality, usage, price, or spend.

The separately approved Node-only live proof injects an OpenAI Responses adapter without changing Worker defaults. It permits exactly one specialist-manager-specialist sequence and at most three provider attempts, uses stored previous-response continuation only for the returning specialist, requires provider-confirmed effective reasoning context and complete usage, and emits no raw response id, output, reasoning, or credential.
## Opt-In Autonomous Runtime Harness Contract

The Worker may construct one composed OpenAI text agent only when the operator enables the runtime, records explicit spend approval, sets a bounded provider-call ceiling, aligns provider selection with the Responses adapter, and supplies source JSON whose SHA-256 is re-verified at preparation. The authenticated caller supplies only run id, conversation id, and bounded input; principal-scoped hashes isolate continuation while the server owns identity, model, transport, source, signal, and policy. Tools, workflows, schemas, MCP names, credentials, and review claims are rejected. Function Calling and Knowgrph retain tool allowlists, signed review, durable receipts, idempotency, and mutation policy. Missing or conflicting gates return `runtime_unconfigured` before provider execution; live proof, Prod, and Cloudflare remain separate.

## Progressive Agents Harness Contract

Progressive Agents owns only a small application facade over the definition,
composition, Function Calling, and orchestration owners. Direct runs accept an
exact agent revision and return that revision as final-answer owner only after
the composition validates output. Tool-bearing definitions retain their
authorized references and rely on the injected application adapter to use the
existing Function Calling owner. Specialist workflows remain exact registered
topologies with branch-owned conversation and final-answer identity.

The facade exposes no external SDK objects, callbacks, provider payloads,
credentials, tool schemas, or inferred routers. Offline proof establishes the
incremental owner wiring and one local gateway invocation; it does not establish
provider reachability, SDK compatibility, model quality, live usage, or spend.

## Function Calling Harness Contract

Direct function calling exposes strict application-owned declarations to a model and returns gateway-owned results under exact call identities. The cited provider guide informs the capability class; local implementation, schemas, examples, tests, fixtures, and prose remain independently authored.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Validate | Run id, JSON input, strict tools, selection, and capabilities | Immutable request or typed preflight block | Unknown fields, caller-authored approvals, missing adapter, gateway, strict validation, continuation, or reasoning replay block. |
| Advance | Initial input or prior response plus active reasoning and same-id outputs | Provider-normalized turn and actual model cost | Missing cost, completed status, response identity, or supported typed items blocks. |
| Select | Returned calls plus auto, required, none, forced, or allowed policy | Exact eligible direct tool records | Unknown, replayed, caller-disabled, subset, forced-name, or parallel-policy violations block. |
| Execute | Validated arguments, direct caller, and policy metadata | Gateway envelope, bounded output, or one idempotent review pause | Tool guardrails and exact signed review remain beside the real gateway. |
| Resume | Manager token and signed reviewer evidence | Atomically claimed private response-chain checkpoint | Definition drift, expiry, conflict, parallel review, raw approval state, and consumed review fail closed. |
| Fence | Reviewed call identity, authorized arguments, audit, and tool policy | Durable receipt, stable idempotency key, and one execution claimant | Identity drift, missing authorization, and competing claim block before MCP. |
| Settle | Strict output plus native downstream receipt for mutations | Durable terminal output or retryable typed block | Exact key and digest evidence are required; terminal replay never calls the tool again. |
| Finalize | One final message after required calls | Final output, compact evidence, model cost, and gateway cost | Reasoning, arguments, review state, and intermediate results remain internal. |

The controller bounds tools, schema size, model turns, total calls, parallel width, result size, and stage duration. Tool Search supplies only direct or already-loaded definitions; Programmatic Tool Calling remains a separate route for predictable read-only reductions. Offline proof does not establish live provider or gateway execution.

The concrete Dev adapter uses the OpenAI Responses protocol only after explicit server-side model, key, and pricing configuration. The HTTP caller supplies no schemas, routes, review ids, stored state, or approval arrays. `read_agentic_os_status` maps through an explicit allowlist to Knowgrph's existing `knowgrph.os.status` MCP owner, where caller type, immutable policy, tool-input guardrail, result shape, tool-output guardrail, and zero-cost evidence are revalidated. Optional application review policy pauses that same path. The manager stores the private response chain under a per-run Durable Object identity, while a separate receipt owner stores reviewed execution authorization before MCP, fences one claimant, sends a stable idempotency key, and replays terminal output. Mutating mappings additionally require an exact native receipt from Knowgrph; none is enabled yet. Returned provider reasoning stays private and is deleted with terminal continuation state.

## Programmatic Tool Calling Harness Contract

Programmatic tool calling uses provider-hosted JavaScript only for predictable read-only stages. The local controller never evaluates generated source. The cited provider guide informs the capability class; local code, prompts, schemas, examples, tests, fixtures, and prose remain independently authored.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Select | Task-shape facts for call count, control flow, reduction, judgment, evidence, approval, and mutation | Direct or programmatic route plus typed reason | Programmatic is limited to predictable multi-call structured reductions. |
| Validate | Run id, JSON input, continuation mode, capability flags, allowed callers, schemas, approval policy, and validators | Immutable request or typed preflight block | Hosted sandbox, matching stored or stateless continuation, caller lineage, adapter, and gateway are mandatory. |
| Advance | Initial input, stored response identity plus new outputs, or the full ordered stateless replay | Provider-normalized hosted turn and actual cost log | Missing attestation, cost, completed status, fingerprint, or typed items blocks. |
| Authorize | Program lineage, tool identity, arguments, risk, and idempotency | Eligible call or direct-route requirement | Only validated read-only idempotent tools may run programmatically. |
| Execute | Eligible calls within parallel and timeout bounds | Schema-valid `function_call_output` items with unchanged caller identity | Real tool policy, validator, approval, audit, hook, and cost owners remain authoritative. |
| Finalize | Provider final message | Final output, compact evidence, and aggregate cost | Generated code and intermediate tool payloads are neither persisted nor returned. |

The controller bounds model turns, calls, batch width, program size, result size, and stage duration. Duplicate run and function-call identities fail closed. Generated source, opaque fingerprints, reasoning items, and intermediate payloads exist only inside the active loop and never cross the final result boundary. Offline proof confirms the controller contract only; provider-hosted execution and context isolation remain unverified until a live adapter returns matching attestation.

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
| Tool Search | Session-scoped metadata exposure, exact on-demand definition loading, gateway authorization, and no copied search implementation. |

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
| Skill evolution | Load the canonical request from `SKILL-EVOLUTION.md`. | `knowgrph-skill-evolution-result/v1` full snapshot. | The selected owner exclusively defines operations, schemas, candidate roles, validation isolation, bounds, and review-only behavior; this table defines no alternate input contract. |
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
| Bounded optimizer | Every evolution run names epochs, batch and mini-batch size, learning-rate schedule, candidates, adapter calls, mutation operations, changed characters, tokens, cost, duration, patience, and circuit breaker. |
| Semantic preservation | Proposed changes state what behavior must remain unchanged. |
| Focused tests | Evolution output names focused checks and their result before promotion. |
| Human review | Proposed diffs stay review-pending with `applied: false` until the operator separately invokes the managed skill-write owner. |
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
| Human review | `{ runId, conversationId, agent, proposedAction }` | Bounded interruption, single-consume resume state, approve, reject, edit, audit, or typed block. | Exact identity and unexpired review are required; edits revalidate and a decision never executes the action itself. |
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

## Agent Swarm Harness Contract

Agent Swarm turns one authorized goal into runtime-generated task briefs. Kimi Agent Swarm may inform the capability class, but local code and contracts must not copy or depend on its runtime, APIs, prompts, schemas, examples, tests, limits, UI assets, or prose.

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Plan | `{ goal, input, bounds }` plus server-owned principal and resolved exact agent | One validated acyclic task plan | No caller roles, tasks, workflow, recursive fan-out, or spend before authorization and resolution. |
| Claim | `{ runId, workerId }` under the verified run principal | Atomic task lease, idle, capacity, or terminal state | Durable short claims fence stale workers across isolates and deny other sessions. |
| Execute | Isolated task brief and completed dependency results | Result, verified receipt, cost, retry, or failure | Effects are read-only or carry a durable-owner-verified stable task idempotency receipt. |
| Synthesize | Completed task evidence and original base agent | Only public final answer or bounded block | The base agent owns synthesis; intermediate worker output stays private. |

### Reasoning Continuity Harness

| Stage | Harness input | Harness output | Guard |
|---|---|---|---|
| Begin turn | `{ threadId, goals[], assumptions[], priorities[], capabilities }` | Turn token, status, request patch, and unverified effective context. | Request prior-turn reasoning only for exact stable invariants and declared capabilities. |
| Complete turn | `{ threadId, turnToken, responseId, effectiveContext }` | Stored response-id signal, completed-turn count, and confirmed-context signal. | Confirm `all_turns` only from matching returned response metadata. |
| Drift | Changed goal, assumption, or ordered priority. | `reset` with `current_turn` when supported. | Conversation chaining may continue; stale reasoning rendering must not. |
| Abort or invalidate | Exact thread and active-turn identity. | Cleared pending or removed completed state. | A concurrent or stale completion cannot revive invalidated state. |

The registry retains no raw reasoning content. Thread and turn bounds are circuit breakers, and the downstream model owner remains responsible for capability validation, provider calls, tokens, cost, and approval.

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
| `cached_tokens` | Exact provider-reported cache-read tokens; local prefix reuse does not populate this field. |
| `cache_write_tokens` | Exact provider-reported cache-write tokens. |
| `provider_cache_status` | `hit`, `write`, `miss`, or `unreported`; never inferred from local reuse or latency. |
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
