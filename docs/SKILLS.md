---
title: "Knowgrph Agentic Canvas OS Skills"
graphId: "md:knowgrph-agentic-canvas-os-skills"
doc_type: "Skill Contract Catalog"
date: "2026-07-08"
lang: "en-US"
schema: "agentic-canvas-os-skills/v1"
frontmatter_contract: "required"
status: "runtime-ready"
source_docs:
  - "FACTS.md"
  - "SOUL.md"
  - "MEMORY.md"
  - "USER.md"
  - "AGENTS.md"
  - "DICTIONARY-COMMAND.md"
  - "DICTIONARY-SEMANTIC.md"
  - "DICTIONARY-BINDING.md"
  - "HARNESS-CONTRACTS.md"
  - "RUNTIME-READINESS.md"
external_pattern_sources:
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/skills"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/context-references"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-gateway"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/tools"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-search"
  - "https://agentskills.io/specification"
  - "https://github.com/bytedance/deer-flow"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "skill contracts for shared discovery, routing, and harness owners; no separate skill runtime"
runtime_proof: "RUNTIME-PROOF.md"
skill_invocation_prefixes:
  slash: "/"
  hash: "#"
  at: "@"
skill_statuses: ["draft", "spec-complete", "runtime-ready", "gated", "blocked"]
skill_contracts:
  - "soul.load"
  - "personality.overlay"
  - "moa.run"
  - "source.normalize"
  - "context.resolve"
  - "harness.define"
  - "runtime.check"
  - "cost.audit"
  - "deploy.guard"
  - "docs.sync"
  - "flow.computing"
  - "experience.capture"
  - "memory.write"
  - "memory.compact"
  - "memory.search"
  - "session.search"
  - "user.profile"
  - "skill.discover"
  - "skill.load"
  - "skill.bundle"
  - "skill.manage"
  - "context.discover"
  - "context.load"
  - "context.audit"
  - "reference.expand"
  - "reference.audit"
  - "kanban.collaborate"
  - "tool.catalog"
  - "tool.route"
  - "tool.provider.select"
  - "tool.gateway.audit"
  - "toolset.enable"
  - "toolset.disable"
  - "tool.search"
  - "tool.describe"
  - "tool.call"
  - "skill.propose"
  - "skill.evolve"
  - "identity.reflect"
  - "orchestration.graph"
  - "state.checkpoint"
  - "human.review"
  - "stream.trace"
  - "superagent.run"
skill_variants: ["agent.moa", "agent.research", "agent.video", "agent.care", "agent.docs", "agent.code", "agent.cost", "agent.learning", "agent.orchestrator"]
kgCanvasSurfaceMode: "2d"
kgCanvasRenderMode: "2d"
kgCanvas2dRenderer: "storyboard"
kgDocumentSemanticMode: "document"
kgFrontmatterModeEnabled: true
kgMultiDimTableModeEnabled: true
kgDocumentStructureBaselineLock: false
socket_types: {skill_catalog_signal: {label: "Skill catalog signal", cardinality: "one-to-many"}, skill_route_signal: {label: "Skill route signal", cardinality: "one-to-many"}, skill_proof_signal: {label: "Skill proof signal", cardinality: "one-to-one"}}
flow: {direction: {key: direction, type: string, value: "LR"}, edgeType: {key: edgeType, type: string, value: "smoothstep"}, balancedViewportPreset: {key: balancedViewportPreset, type: string, value: "widgetFrontmatter"}, computed: {key: computed, type: boolean, value: true}, snapToGrid: {key: snapToGrid, type: boolean, value: true}, nodes: [{id: {key: id, type: string, value: "skill_catalog"}, type: {key: type, type: string, value: "source"}, label: {key: label, type: string, value: "Skill contract catalog"}, lane: {key: lane, type: string, value: "catalog"}, position: {key: position, type: object, value: {x: 0, y: 0}}, handles: {key: handles, type: list, value: ["catalog.out"]}, "flow:portTypes": {key: "flow:portTypes", type: list, value: ["skill_catalog_signal"]}}, {id: {key: id, type: string, value: "skill_discover"}, type: {key: type, type: string, value: "process"}, label: {key: label, type: string, value: "Metadata-first discovery"}, lane: {key: lane, type: string, value: "discovery"}, position: {key: position, type: object, value: {x: 280, y: 0}}, handles: {key: handles, type: list, value: ["discover.in", "discover.out"]}}, {id: {key: id, type: string, value: "skill_load"}, type: {key: type, type: string, value: "process"}, label: {key: label, type: string, value: "Progressive resource load"}, lane: {key: lane, type: string, value: "runtime"}, position: {key: position, type: object, value: {x: 560, y: 0}}, handles: {key: handles, type: list, value: ["load.in", "load.out"]}}, {id: {key: id, type: string, value: "skill_route"}, type: {key: type, type: string, value: "process"}, label: {key: label, type: string, value: "Route into harness owner"}, lane: {key: lane, type: string, value: "runtime"}, position: {key: position, type: object, value: {x: 840, y: 0}}, handles: {key: handles, type: list, value: ["route.in", "route.out"]}}, {id: {key: id, type: string, value: "runtime_proof"}, type: {key: type, type: string, value: "observer"}, label: {key: label, type: string, value: "Validation proof"}, lane: {key: lane, type: string, value: "proof"}, position: {key: position, type: object, value: {x: 1120, y: 0}}, handles: {key: handles, type: list, value: ["proof.in"]}}], edges: [{id: {key: id, type: string, value: "catalog_to_discover"}, source: {key: source, type: string, value: "skill_catalog"}, target: {key: target, type: string, value: "skill_discover"}, type: {key: type, type: string, value: "skill_catalog_signal"}}, {id: {key: id, type: string, value: "discover_to_load"}, source: {key: source, type: string, value: "skill_discover"}, target: {key: target, type: string, value: "skill_load"}, type: {key: type, type: string, value: "skill_route_signal"}}, {id: {key: id, type: string, value: "load_to_route"}, source: {key: source, type: string, value: "skill_load"}, target: {key: target, type: string, value: "skill_route"}, type: {key: type, type: string, value: "skill_route_signal"}}, {id: {key: id, type: string, value: "route_to_proof"}, source: {key: source, type: string, value: "skill_route"}, target: {key: target, type: string, value: "runtime_proof"}, type: {key: type, type: string, value: "skill_proof_signal"}}]}
---

# Skills

This file defines reusable Agentic Canvas OS skill contracts for solo-dev, AI-native product work. It is a source-backed catalog for shared discovery, invocation, and harness owners; it is not a new command runner, parser, provider panel, deployment mechanism, or compatibility registry.

Skills are spec-complete when their identity, inputs, outputs, bounds, cost posture, and VCCs are documented. They become runtime-ready only when an existing shared owner proves the contract with typed execution, surfaced cost state, focused validation, and unchanged deploy boundaries.

## Skill Contract

| Field | Requirement |
|---|---|
| `id` | Stable semantic id using lowercase dot notation. |
| `owner` | Existing shared runtime, doc, parser, or harness owner. |
| `intent` | One clear job, independent of vendor, model, UI surface, or deployment target. |
| `inputs` | Typed payload, required `/`, `#`, and `@` routes, and source-of-truth references. |
| `outputs` | Typed result, typed error, proof reference, and mutation target when mutation is approved. |
| `bounds` | Max iterations, circuit breaker, timeout, token budget, and fail-before-spend conditions. |
| `cost` | Model id, token counts, cache hits, estimated cost, and exact zero for model-free paths. |
| `fallback` | Structured responses for schema error, missing binding, approval denial, provider failure, and budget breach. |
| `vcc` | Given-When-Then condition plus observable proof and stop condition. |

## Skill Shape

Every skill row must resolve to a stable id, owner binding, command route, semantic filters, runtime bindings, typed input/output schemas, fallback states, max-iteration bound, cost log, proof reference, and deploy boundary.

## Core Skills

| Skill | Intent | Required routes | Output | Status |
|---|---|---|---|---|
| `soul.load` | Load durable agent identity from `SOUL.md` into prompt slot 1 through a scanned source-backed contract. | `/soul.load`, `#soul`, `#primary-identity`, `@soul-profile`, `@identity-slot`, `@runtime-proof` | Identity packet, typed fallback, scan result, or blocked reason. | Spec-complete |
| `personality.overlay` | Apply a temporary session-level voice or mode overlay without mutating durable identity. | `/personality.overlay`, `#personality-overlay`, `@personality-overlay`, `@operator`, `@runtime-proof` | Session overlay packet, expiration, or typed rejection. | Spec-complete |
| `moa.run` | Run one-shot Mixture of Agents deliberation with bounded reference agents and one acting aggregator. | `/moa`, `#mixture-of-agents`, `#reference-agents`, `#aggregator-agent`, `@moa-preset`, `@reference-agents`, `@aggregator-agent`, `@cost-log` | Aggregator response, typed reference ledger, cost log, or typed blocked reason. | Spec-complete |
| `source.normalize` | Neutralize stale, duplicate, conflicting, or hardcoded source content at the upstream owner. | `/source.normalize`, `#frontmatter`, `#no-hardcode`, `@source.frontmatter`, `@source.body` | Clean source diff or typed blocked reason. | Spec-complete |
| `context.resolve` | Resolve operator intent, source docs, semantic filters, and bindings before execution. | `/memory.seed`, `#frontmatter`, `#ttv`, `@operator`, `@source.body` | Typed context packet with missing-binding list. | Spec-complete |
| `harness.define` | Define a typed AI or tool harness before any model-bearing execution. | `/harness.define`, `#harness`, `#token-economics`, `@local-harness` | Harness contract with schemas, fallback, cost fields, and bounds. | Spec-complete |
| `runtime.check` | Promote or reject a contract by focused proof rather than prose. | `/runtime-ready.check`, `#vcc`, `#runtime-ready`, `@runtime-proof` | Runtime status with command evidence and cost/deploy state. | Spec-complete |
| `cost.audit` | Estimate and verify token, cache, latency, and TCO posture before spend. | `/cost.audit`, `#tco`, `#token-economics`, `#foss`, `@cost-log` | Cost summary, budget decision, and fail-closed reason if breached. | Spec-complete |
| `deploy.guard` | Preserve Dev, Prod mirror, and Cloudflare boundaries. | `/deploy.guard`, `#no-deploy`, `#approval-gate`, `@dev-only`, `@operator` | Dev-only confirmation or gated deploy request. | Spec-complete |
| `docs.sync` | Keep local docs, API contracts, and schema maps aligned after source changes. | `/validation.run`, `#frontmatter`, `#vcc`, `@source.body` | Focused doc update list and validation result. | Spec-complete |
| `flow.computing` | Generate, validate, or run a source-backed KGC computing-flow DAG with typed inputs, explicit handles, bounded execution, and Canvas projection. | `/computing-flow`, `#computing-flow`, `#frontmatter`, `#harness`, `@source.frontmatter`, `@local-harness`, `@runtime-proof` | `kgc-computing-flow/v1` document, typed validation result, or typed blocked reason. | Spec-complete |
| `experience.capture` | Turn run traces, failures, proof packets, or operator corrections into typed reusable experience records. | `/experience.capture`, `#learning-loop`, `#vcc`, `@experience`, `@runtime-proof` | Experience record with source, lesson, applicability, expiry risk, cost, and approval state. | Spec-complete |
| `memory.write` | Add, replace, or remove bounded memory or user-profile entries. | `/memory.write`, `#persistent-memory`, `#memory-capacity`, `@memory-entry`, `@memory-policy`, `@memory-store` | Typed write result, capacity error, scan rejection, or duplicate result. | Spec-complete |
| `memory.compact` | Consolidate bounded memory/profile targets without silent data loss. | `/memory.compact`, `#memory-capacity`, `@memory-store`, `@memory-policy`, `@runtime-proof` | Before/after entries, capacity delta, and preserved-fact statement. | Spec-complete |
| `memory.search` | Retrieve scoped prior conversations, memory, decisions, and proof before spending or mutating. | `/memory.search`, `#memory-search`, `#truth`, `@memory-store`, `@operator` | Ranked cited memory results or typed empty result. | Spec-complete |
| `session.search` | Search past sessions on demand without promoting results into memory automatically. | `/session.search`, `#session-search`, `@session-index`, `@operator` | Cited session matches, empty result, or blocked reason. | Spec-complete |
| `user.profile` | Persist explicit operator preferences, communication style, and expectations. | `/user.profile`, `#user-profile`, `#memory-capacity`, `@user-profile`, `@memory-entry`, `@memory-policy` | Profile entry write, typed rejection, capacity error, or explicit empty-state result. | Spec-complete |
| `skill.discover` | Discover lightweight skill metadata before loading instructions. | `/skill.discover`, `#skill-system`, `#progressive-disclosure`, `@skill-index`, `@skill-policy` | Skill index, empty result, trust warning, or typed blocked reason. | Spec-complete |
| `skill.load` | Load selected on-demand skill instructions and optional resources. | `/skill.load`, `#progressive-disclosure`, `#agentskills-compatible`, `@skill-source`, `@skill-reference` | Bounded skill context, resource packet, validation error, or unsafe-source rejection. | Spec-complete |
| `skill.bundle` | Group existing skills behind one bounded invocation. | `/skill.bundle`, `#skill-bundle`, `@skill-bundle`, `@skill-index` | Resolved skill list, skipped missing list, usage packet, or blocked reason. | Spec-complete |
| `skill.manage` | Create, patch, edit, delete, or update supporting files under scan and review policy. | `/skill.manage`, `#skill-security`, `#skill-evolution`, `@skill-source`, `@skill-policy`, `@operator` | Proposed diff, staged write, applied write, validation packet, or rejection. | Spec-complete |
| `context.discover` | Discover project-local context files from scoped working directories. | `/context.discover`, `#context-file`, `#cwd-discovery`, `@working-directory`, `@context-policy` | Startup context, progressive subdirectory candidates, skipped matches, or typed empty result. | Spec-complete |
| `context.load` | Load one scanned and bounded context file into behavioral context. | `/context.load`, `#context-file`, `#project-context`, `@context-file`, `@context-policy` | Loaded context packet, truncation ledger, blocked-context result, or unsafe-source rejection. | Spec-complete |
| `context.audit` | Audit effective context precedence, safety, truncation, and stale risks. | `/context.audit`, `#project-context`, `#vcc`, `@working-directory`, `@context-policy`, `@runtime-proof` | Read-only audit ledger, conflict list, stale-risk list, or proof gap. | Spec-complete |
| `reference.expand` | Expand explicit inline context references into bounded attached context. | `/reference.expand`, `#context-reference`, `#inline-context`, `@reference-policy`, `@attached-context` | Original message, attached context packets, warnings, refusals, or unsupported-platform result. | Spec-complete |
| `reference.audit` | Audit context-reference source, safety, size, and warning state. | `/reference.audit`, `#attached-context`, `#vcc`, `@reference-policy`, `@runtime-proof` | Read-only expansion ledger, refused-target list, truncation report, or proof gap. | Spec-complete |
| `kanban.collaborate` | Coordinate named profiles through durable task and handoff rows. | `/kanban.task`, `/kanban.handoff`, `/kanban.sync`, `#kanban-board`, `@kanban-board`, `@agent-profile`, `@worker-process` | Validated task row, handoff row, sync ledger, conflict report, or missing-board result. | Spec-complete |
| `tool.catalog` | Discover existing tool routing states without executing tools. | `/tool.catalog`, `#tool-gateway`, `#tool-routing`, `@tool-gateway`, `@tool-provider` | Per-tool status, unavailable states, cost posture, or typed blocked reason. | Spec-complete |
| `tool.route` | Route one approved tool call through existing `knowgrph` infrastructure. | `/tool.route`, `#tool-routing`, `@tool-gateway`, `@tool-provider`, `@tool-policy`, `@cost-log` | Tool result, cost log, fallback, approval-required, or unavailable-provider result. | Spec-complete |
| `tool.provider.select` | Select gateway, direct, local, or unavailable provider per tool category. | `/tool.provider.select`, `#tool-routing`, `@tool-provider`, `@tool-policy`, `@operator` | Non-secret provider preference or rejected secret-bearing configuration. | Spec-complete |
| `tool.gateway.audit` | Audit routing, usage, cost, egress, approval, and deploy boundaries. | `/tool.gateway.audit`, `#tool-gateway`, `#token-economics`, `@tool-gateway`, `@runtime-proof` | Read-only audit ledger or typed proof gap. | Spec-complete |
| `toolset.enable` | Enable a logical toolset for one platform surface. | `/toolset.enable`, `#toolset`, `#platform-toolset`, `@toolset`, `@platform-surface`, `@tool-policy` | Scoped enablement result, approval-required, missing-function list, or typed blocked reason. | Spec-complete |
| `toolset.disable` | Disable a logical toolset for one platform surface. | `/toolset.disable`, `#toolset`, `#platform-toolset`, `@toolset`, `@platform-surface`, `@tool-policy` | Scoped disabled result, unchanged result, or typed blocked reason. | Spec-complete |
| `tool.search` | Search the session-scoped deferred-tool catalog without loading full schemas. | `/tool.search`, `#tool-search`, `#progressive-disclosure`, `@deferred-tool-catalog`, `@tool-policy` | Ranked deferred tool metadata, empty result, disabled-state result, or typed blocked reason. | Spec-complete |
| `tool.describe` | Load one eligible deferred tool schema on demand. | `/tool.describe`, `#deferred-tool-schema`, `@deferred-tool-catalog`, `@tool-policy` | Full selected tool schema, unavailable result, policy block, or stale-catalog rejection. | Spec-complete |
| `tool.call` | Invoke a selected deferred tool through a bridge while preserving underlying tool policy. | `/tool.call`, `#bridge-tool`, `@bridge-tool`, `@tool-function`, `@tool-policy` | Tool result, approval-required, schema error, cost log, or typed fallback under the real tool identity. | Spec-complete |
| `skill.propose` | Propose a new skill contract from repeated experience without direct runtime mutation. | `/skill.propose`, `#skill-evolution`, `#harness`, `@experience`, `@skill-catalog` | Reviewed proposal with schemas, bounds, cost fields, source evidence, and VCCs. | Spec-complete |
| `skill.evolve` | Improve an existing skill through bounded evaluation and human-reviewed diff proposal. | `/skill.evolve`, `#skill-evolution`, `#vcc`, `@skill-catalog`, `@runtime-proof`, `@operator` | Evaluation packet, semantic-preservation note, focused validation, and proposed diff. | Spec-complete |
| `identity.reflect` | Persist stable non-secret operator preferences, project boundaries, and agent operating rules. | `/identity.reflect`, `#identity-model`, `#truth`, `@identity-model`, `@memory-store` | Source-backed identity note or rejected-inference result. | Spec-complete |
| `orchestration.graph` | Define and validate source-backed state, node, edge, entry, exit, and stop-condition topology for long-running agents. | `/orchestration.graph`, `#orchestration-graph`, `#stateful-agent`, `@orchestration-graph`, `@state-store`, `@runtime-proof` | Graph contract, compile-check result, or typed blocked reason. | Spec-complete |
| `state.checkpoint` | Specify checkpoint, resume, idempotency, retry, timeout, and recovery behavior for durable execution. | `/state.checkpoint`, `#durable-execution`, `@checkpoint-store`, `@state-store`, `@runtime-proof` | Checkpoint contract with recovery VCC and cleanup path. | Spec-complete |
| `human.review` | Pause, inspect, edit, approve, reject, and resume a run through operator review. | `/human.review`, `#human-in-loop`, `#approval-gate`, `@human-review`, `@operator` | Typed interrupt, review result, resume payload, or rejected continuation. | Spec-complete |
| `stream.trace` | Emit ordered progress, state transition, cost, and stop-condition events for orchestration runs. | `/stream.trace`, `#durable-execution`, `#token-economics`, `@runtime-proof`, `@cost-log` | Secret-free trace ledger with bounded event sequence. | Spec-complete |
| `superagent.run` | Run long-horizon research, coding, or creation through bounded orchestration, sandbox workspace, message gateway, and artifact verification. | `/superagent.run`, `#long-horizon-harness`, `#sandboxed-workspace`, `#message-gateway`, `@sandbox-workspace`, `@message-gateway`, `@runtime-proof` | Run plan, checkpoints, message ledger, artifact manifest, verification state, cost log, or blocked reason. | Spec-complete |
| `sandbox.policy.author` | Produce a least-privilege native policy candidate from explicit runtime requirements without copying an external policy schema. | `/sandbox.policy.validate`, `#agent-sandbox-policy`, `#no-hardcode`, `@sandbox-policy`, `@operator` | Candidate policy, validation result, widening review, or blocked reason. | Runtime-ready preflight |
| `sandbox.gateway.troubleshoot` | Diagnose policy loading, digest drift, denied decisions, and local gateway projection without executing the blocked operation. | `/sandbox.policy.validate`, `/sandbox.policy.authorize`, `#agent-sandbox-policy`, `@sandbox-policy`, `@runtime-proof` | Read-only diagnosis, reason code, owner path, enforcement gap, and focused proof. | Runtime-ready preflight |

## Skills System Contract

The skills system contract is inspired by public on-demand skill systems and the Agent Skills open specification, but this repository owns only neutral source-backed docs contracts. Discovery loads metadata first, selected source loads second, referenced resources load only when required, bundles alias existing skills, and managed writes are scanned, validated, bounded, and review-gated when policy requires it. Do not copy external skills, code, examples, tests, prompt text, repository layouts, or prose.

## Context Files Contract

Context files are project-local behavioral instructions discovered from scoped working directories and touched paths. Startup discovery uses one first-match project context per scope; progressive subdirectory discovery loads hints only when a path makes them relevant. Every context file must scan cleanly, fit the configured bound, and remain subordinate to system/developer/operator instructions, `FACTS.md`, `SOUL.md`, safety, and deploy gates. Do not copy external context-file discovery code, scanner code, example files, prompt assembly text, tests, fixtures, or prose.

## Context References Contract

Context references are inline message expansion routes for approved `@file:`, `@folder:`, `@diff`, `@staged`, `@git:`, and `@url:` forms. Supported surfaces append bounded `@attached-context` before model or tool execution; unsupported surfaces keep raw text with typed warning. Every expansion is workspace-scoped where applicable, scanned for sensitive paths, binary content, egress risk, and size limits, and recorded with source, warning, refusal, truncation, and cost metadata. Do not copy external context-reference parser code, prompt section text, examples, tests, fixtures, or prose.

## Kanban Collaboration Contract
`kanban.collaborate` uses `kanban.md` as the durable shared board for named profiles and full OS worker processes. Every task and handoff is a validated row through existing multi-dimensional table/Kanban utilities; no hidden subagent swarm, copied board runtime, second datastore, browser-only state, or deploy grant is implied.

## Tool Gateway Contract

Tool gateway contracts route tool calls through infrastructure `knowgrph` already owns or can gate: local MCP, Pages HTTP MCP, Browser WebMCP, and Cloudflare control-plane owners where deployed. Do not copy external gateway code, provider tables, model lists, config examples, tests, fixtures, or prose.

Tool contracts treat tools as callable functions with schemas, owners, risk classes, cost posture, and typed fallbacks. Toolsets are logical bundles of existing functions that may be enabled or disabled per platform surface; they cannot install missing tools, bypass approval gates, or grant global cross-platform access.

| Tool category | Route | Binding | Guard |
|---|---|---|---|
| Catalog | `/tool.catalog` | `@tool-gateway`, `@tool-provider` | Zero-spend read of gateway, direct, local, and unavailable states. |
| Tool functions | `/tool.catalog #tool-function` | `@tool-function` | Schema, owner, risk class, cost posture, and typed fallback are visible. |
| Toolsets | `/toolset.enable` or `/toolset.disable` | `@toolset`, `@platform-surface` | Existing functions only; platform-scoped state and approval gates are explicit. |
| Web search/extract | `/tool.route #web-search` | `@web-search-tool` | Source scope, citations, egress policy, cache, and cost log. |
| Image generation | `/tool.route #image-generation` | `@image-tool` | Approval, prompt bounds, artifact manifest, and cost log. |
| Text-to-speech | `/tool.route #text-to-speech` | `@tts-tool` | Voice/provider, text bounds, output manifest, and cost log. |
| Cloud browser | `/tool.route #cloud-browser` | `@browser-tool` | Isolated session, action schema, redaction, trace, and approval. |

## Tool Search Contract

Tool Search is an opt-in progressive-disclosure contract for eligible MCP and non-core plugin tools. It replaces eligible model-visible tool schemas with bridge routes only when policy enables it and schema budget justifies it; core required tools stay direct. The deferred catalog is session-scoped, rebuilt from currently granted toolsets, and cannot reveal or call tools outside the session. `/tool.call` unwraps to the real tool identity for schema validation, approval, hooks, audit, cost, and fallback. Do not copy external tool-search code, retrieval implementation, bridge prompt text, examples, tests, fixtures, or prose.

## Stateful Orchestration Contract

The orchestration contract is inspired by public graph-based agent runtimes, but this repository owns only neutral source-backed contracts. Do not copy external code, API names, schemas, tests, examples, fixtures, or prose. Local orchestration must reuse existing KGC/frontmatter, Canvas, memory, and harness owners.

```yaml
orchestration:
  source_policy: "external-pattern-reference-only"
  copy_policy: "forbid copied code, API shapes, schemas, tests, examples, fixtures, and prose"
  graph:
    state_schema: "typed-frontmatter-or-contract-schema"
    nodes: "stable semantic ids"
    edges: "explicit transition rules"
    entry: "single or typed conditional entry"
    exit: "bounded stop condition"
  durable_execution:
    checkpoint: "@checkpoint-store"
    resume: "typed resume payload"
    idempotency: "required for side-effecting nodes"
  human_in_loop:
    interrupt: "typed review payload"
    resume: "approve | reject | edit"
  bounds:
    max_iterations: 1
    recursion_limit: "explicit"
    circuit_breaker: "schema error, approval denial, budget breach, or recovery failure"
```

| Layer | Requirement |
|---|---|
| State | Shared run snapshot with typed fields, reducer or overwrite rule, and memory boundary. |
| Nodes | Stable semantic work units with input/output schemas, idempotency rule, and side-effect declaration. |
| Edges | Explicit fixed or conditional transitions with source, target, guard, and fallback. |
| Compile check | Reject orphaned nodes, missing entry/exit, unbounded cycles, missing checkpoint for long runs, and hidden side effects. |
| Durable execution | Checkpoints name storage scope, resume token, recovery VCC, cleanup path, and cost boundary. |
| Human-in-loop | Interrupt and resume payloads are typed; continuation stays blocked without `@operator` approval. |
| Streaming trace | Trace events are ordered, secret-free, bounded, and tied to `@runtime-proof`. |

### Orchestration VCCs

| VCC | Check |
|---|---|
| Graph compiles | `/orchestration.graph` rejects orphaned nodes, missing edges, missing stop conditions, and hidden mutation. |
| State is durable | `/state.checkpoint` names checkpoint scope, idempotency, resume payload, recovery proof, and cleanup path. |
| Human review blocks | `/human.review` keeps the run paused until approve, reject, or edit result is present. |
| Trace is observable | `/stream.trace` emits ordered stage, state, cost, and stop events without secrets. |
| External reference is not copied | Diff contains local neutral contracts only and no LangGraph code, API schemas, examples, tests, fixtures, or prose. |

## Soul Contract

The soul contract is inspired by public durable-personality systems, but this repository owns only a neutral identity source and prompt-assembly contract. Do not copy external code, default identity text, personality preset text, prompt assembly code, schemas, tests, fixtures, or prose. Local `SOUL.md` is the durable identity source for Agentic OS docs; it is not a project operations file, memory store, command runner, provider panel, or deployment grant.

```yaml
soul:
  source: "SOUL.md"
  command: "/soul.load"
  binding: "@soul-profile"
  prompt_slot: "@identity-slot"
  prompt_slot_number: 1
  scan_policy: "required before inclusion"
  fallback_policy: "typed fallback result; no silent hardcoded default"
  overlay:
    command: "/personality.overlay"
    binding: "@personality-overlay"
    mutation_policy: "session-only; never rewrite SOUL.md"
  rejects:
    - "repo commands"
    - "file paths"
    - "service ports"
    - "architecture rules"
    - "deploy approvals"
    - "credentials"
    - "prompt injection"
```

| Layer | Requirement |
|---|---|
| Identity source | `SOUL.md` owns durable voice, tone, directness, uncertainty, disagreement, and ambiguity defaults. |
| Slot assembly | Prompt assembly loads scanned `@soul-profile` into `@identity-slot` before tools, memory, skills, project context, and overlays. |
| Fallback | Missing, empty, unsafe, or unreadable soul source returns a typed fallback result; runtime code must not silently hardcode default identity. |
| Separation | Project operations stay in `AGENTS.md`; persistence stays in `MEMORY.md`; source truth stays in `FACTS.md`. |
| Overlay | `/personality.overlay` is temporary, subordinate, and cannot mutate `SOUL.md` or bypass safety and approval gates. |

### Soul VCCs

| VCC | Check |
|---|---|
| Soul parses | `SOUL.md` frontmatter parses and `soul_contract.prompt_slot` is `1`. |
| Identity separates cleanly | Soul content excludes project paths, commands, ports, architecture instructions, credentials, and deploy approvals. |
| Slot is source-backed | `/soul.load` resolves `@soul-profile` into `@identity-slot` or emits typed fallback. |
| Overlay is temporary | `/personality.overlay` cannot mutate `SOUL.md`. |
| External reference is not copied | Diff contains local neutral contracts only and no Hermes code, default identity text, personality preset examples, schemas, tests, fixtures, or prose. |

## Persistent Memory Contract

The persistent memory contract is inspired by public bounded-memory systems, but this repository owns only neutral source-backed contracts. Do not copy external memory code, database schemas, sample entries, prompt renderers, tests, fixtures, or prose. `MEMORY.md` stores agent notes; `USER.md` stores explicit user profile.

```yaml
persistent_memory:
  targets:
    memory:
      source: "MEMORY.md"
      role: "agent notes"
      limit_chars: 2200
    user:
      source: "USER.md"
      role: "explicit user profile"
      limit_chars: 1375
  snapshot: "frozen at session start"
  write_actions: ["add", "replace", "remove"]
  overflow: "typed capacity error; compact before retry"
  search: "session search is read-only until captured"
```

| Layer | Requirement |
|---|---|
| Memory target | Environment facts, project conventions, tool quirks, completed-work lessons, and reusable techniques. |
| User target | Explicit operator preferences, communication style, expectations, workflow habits, and stated technical comfort. |
| Write | `/memory.write` validates target, action, evidence, scan, duplicate status, and capacity before persistence. |
| Compact | `/memory.compact` reports before/after capacity and preserves durable facts. |
| Snapshot | Prompt assembly uses frozen memory/profile snapshots captured at session start. |
| Session search | `/session.search` retrieves cited prior conversation details without automatic persistence. |
| Security | Entries are scanned for prompt injection, exfiltration, credentials, invisible control characters, and unsupported profile inference. |

### Persistent Memory VCCs

| VCC | Check |
|---|---|
| Targets separate | `MEMORY.md` and `USER.md` parse and expose distinct target contracts. |
| Writes are bounded | `/memory.write` rejects overflow with typed capacity error. |
| Profile is explicit | `/user.profile` rejects unsupported inference and secret-bearing entries. |
| Snapshot is frozen | Mid-session writes do not mutate the active prompt snapshot. |
| External reference is not copied | Diff contains local neutral contracts only and no Hermes memory code, sample entries, database schemas, tests, fixtures, or prose. |

## Mixture Of Agents Contract

The MoA contract is inspired by public Mixture of Agents behavior, but this repository owns only neutral routing, harness, and proof contracts. Do not copy external code, prompts, preset examples, provider names, schemas, tests, fixtures, or prose. Local `/moa` is a one-shot command route, not a global model switch, provider panel, recursive router, or runtime-ready claim without current proof.

```yaml
moa:
  command: "/moa"
  source_policy: "external-pattern-reference-only"
  copy_policy: "forbid copied code, prompts, preset examples, provider names, schemas, tests, fixtures, and prose"
  preset:
    binding: "@moa-preset"
    references: "@reference-agents"
    aggregator: "@aggregator-agent"
  stages:
    - "resolve local preset"
    - "run bounded no-tool reference agents"
    - "append advisory outputs as private context"
    - "run aggregator through normal tool and approval gates"
    - "restore prior model or agent context"
  bounds:
    reference_max_tokens: "required"
    max_iterations: 1
    forbid_recursive_moa: true
    fail_before_spend: true
```

| Layer | Requirement |
|---|---|
| Preset | Local, provider-neutral, no copied example names, and no recursive MoA aggregator. |
| Reference agents | Run before aggregation, without tools, with trimmed deterministic context, output caps, timeout, and typed failure records. |
| Advisory context | Reference outputs become private aggregator context only; they do not become source truth or user-visible citations unless the aggregator cites approved sources. |
| Aggregator | Produces the only user-visible response and owns tool schemas, approvals, transcript persistence, follow-up iteration, and fallback. |
| Cost | Cost log separates reference prompt/completion tokens, aggregator tokens, cache hits, failed references, and estimated cost. |
| Cache | Stable prompt prefixes and existing context caches should be preserved; fresh advisory tails are bounded. |
| Bare command | Bare `/moa` returns usage and performs zero paid calls, mutations, model switches, or deploy actions. |

### MoA VCCs

| VCC | Check |
|---|---|
| Preset resolves | `/moa` returns missing-preset, usage, or resolved-preset state before paid calls. |
| References are advisory | Reference calls are no-tool, capped, private, and cost-logged. |
| Aggregator acts alone | Only the aggregator produces final response or tool calls through the normal harness. |
| Recursion is blocked | Aggregator cannot reference another MoA preset. |
| External reference is not copied | Diff contains local neutral contracts only and no Hermes code, prompts, preset examples, provider names, schemas, tests, fixtures, or prose. |

## Learning Loop Contract

The learning loop is inspired by public self-improving agent patterns, but this repository owns only neutral contracts. Do not copy external code, prompts, schemas, tests, fixtures, or prose. The local path is source-backed capture, scoped retrieval, proposal, validation, and operator-reviewed persistence.

```yaml
learning_loop:
  source_policy: "external-pattern-reference-only"
  copy_policy: "forbid copied code, prompts, schemas, tests, fixtures, and prose"
  stages:
    - "/memory.write"
    - "/memory.search"
    - "/session.search"
    - "/experience.capture"
    - "/skill.propose"
    - "/skill.evolve"
    - "/identity.reflect"
  mutation_policy: "proposal-first; operator review required before persistence"
  bounds:
    max_iterations: 1
    fail_before_spend: true
    direct_auto_commit: false
```

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Search | Scoped query, source filters, operator-approved memory or session index. | Ranked cited results or typed empty result. | No result, missing scope, or budget breach. |
| Persist | Candidate memory/profile entry. | Bounded write, capacity error, scan rejection, or duplicate result. | Missing evidence, unsupported inference, secret, or overflow. |
| Capture | Runtime proof, failure, operator correction, or repeated workflow. | Typed experience record with applicability and expiry risk. | Missing provenance or copied external artifact. |
| Propose | Experience record and target skill gap. | New skill draft with schemas, cost fields, bounds, and VCCs. | Missing source evidence or duplicate catalog entry. |
| Evolve | Existing skill, evaluation packet, and focused checks. | Proposed diff plus semantic-preservation note. | Failed validation, missing review, or direct mutation attempt. |
| Reflect | Stable operator preference or project boundary. | Non-secret identity note or rejected inference. | Unsupported personal inference or secret-bearing content. |

### Learning Loop VCCs

| VCC | Check |
|---|---|
| External reference is not copied | Diff contains local neutral contracts only and no imported external code, prompts, schema files, fixtures, or tests. |
| Experience has provenance | `/experience.capture` output names source, proof, lesson, applicability, expiry risk, and approval state. |
| Skill proposal is bounded | `/skill.propose` output includes schemas, fallback, max iteration, cost fields, and VCCs. |
| Skill evolution is reviewed | `/skill.evolve` returns a proposed diff and validation evidence; no direct auto-commit or deploy occurs. |
| Identity is safe | `/identity.reflect` stores only non-secret source-backed preferences and rejects unsupported personal inference. |

## Computing-Flow Contract

`flow.computing` is a KGC/frontmatter execution contract. FloatingPanel Chat may invoke it through `/computing-flow`, but the canonical output is a source-backed KGC document, not a chat-local flow engine.

```yaml
schema: "kgc-computing-flow/v1"
execution: "computing-flow"
links:
  yaml_anchor: "#computing-flow-definition"
```

| Layer | Requirement |
|---|---|
| Source owner | YAML frontmatter owns graph topology, typed inputs, handles, edges, run target, and reusable machine summaries. |
| Human projection | Markdown body explains the flow and proof without adding a second graph layer. |
| Runtime owner | Existing FloatingPanel Chat -> KGC validation -> Source Files -> Canvas apply path. |
| Inputs | Typed KTV rows such as `input_query`, `input_context`, `input_audience`, `input_format`, `input_constraints`, `input_evidence`, `input_tone`, `input_metric_label`, and `input_metric_target`. |
| Edges | Explicit `sourceHandle` and `targetHandle` records from source inputs into compute nodes. |
| Execution | DAG-with-feedback only when feedback is bounded by max iteration and circuit breaker state. |
| Output | Validated KGC Markdown/frontmatter, structured compute result, Canvas projection, or typed validation error. |
| Boundary | No direct graph mutation, renderer-local patch, synthetic downstream KGC backfill, or legacy alias remap. |

### Computing-Flow VCCs

| VCC | Check |
|---|---|
| Frontmatter owns topology | `schema` is `kgc-computing-flow/v1` and `execution` is `computing-flow`. |
| Handles are explicit | Compute edges name `sourceHandle` and `targetHandle` instead of relying on positional inference. |
| Chat is projection-only | `/computing-flow` produces or validates KGC/frontmatter content through shared owners. |
| Runtime is bounded | Any feedback or retry path names max iteration, circuit breaker, fallback, and cost log. |
| Canvas applies canonically | Source Files and KGC validation succeed before Canvas projection; no direct store mutation is used. |

## FloatingPanel Chat Skill Variants

FloatingPanel Chat may expose `/` suggestions for source-backed skill variants. The chat surface discovers and invokes these contracts through shared skill registry, invocation-token, and harness owners; it must not hardcode a parallel command list, provider catalog, prompt template, or compatibility alias in the component.

| Variant | Invocation | Intent | Required bindings | Harness requirements | Status |
|---|---|---|---|---|---|
| `agent.moa` | `/moa-agent` | Run bounded multi-agent deliberation where references advise and one aggregator acts. | `@operator`, `@moa-preset`, `@reference-agents`, `@aggregator-agent`, `@cost-log`, `@runtime-proof` | Local preset resolution, no-tool reference calls, private advisory context, aggregator-owned tool gates, no recursive MoA, cost log, usage fallback. | Spec-complete |
| `agent.research` | `/research-agent` | Source-backed research, synthesis, citation triage, and evidence packet generation. | `@operator`, `@source.body`, `@runtime-proof` | Typed query, source allowlist, evidence ledger, cost log, max iteration, unsupported-source fallback. | Spec-complete |
| `agent.video` | `/video-agent` | Storyboard, media planning, render handoff, and approval-gated video workflow. | `@operator`, `@local-harness`, `@cost-log`, `@runtime-proof` | Typed brief, asset manifest, render approval gate, zero-spend dry-run path, generated-artifact boundary. | Spec-complete |
| `agent.care` | `/care-agent` | Care workflow support with provenance, safety boundaries, escalation, and non-diagnostic output. | `@operator`, `@source.frontmatter`, `@source.body`, `@runtime-proof` | Typed intake, safety classifier, escalation result, no-medical-diagnosis boundary, audit trail, cost log. | Spec-complete |
| `agent.docs` | `/docs-agent` | Normalize source docs, PRD/TAD sections, API references, and schema maps after approved source changes. | `@operator`, `@source.frontmatter`, `@source.body`, `@dev-only` | Frontmatter parser, doc diff plan, stale-content detector, focused validation list, no generated-runtime backfill. | Spec-complete |
| `agent.code` | `/code-agent` | Execute bounded implementation tasks against shared owners with focused tests and no downstream patch masking. | `@operator`, `@local-harness`, `@runtime-proof`, `@dev-only` | Typed task spec, touched-owner plan, command ledger, failure fallback, line-count and hygiene guards. | Spec-complete |
| `agent.cost` | `/cost-agent` | Analyze TCO, token economics, cache posture, latency, and FOSS alternatives before spend or dependency adoption. | `@operator`, `@cost-log`, `@source.body` | Cost schema, budget decision, dependency alternatives, zero-cost read mode, budget-breach blocker. | Spec-complete |
| `agent.learning` | `/learning-agent` | Capture experience, search scoped memory, propose skill changes, and reflect stable identity facts. | `@operator`, `@experience`, `@memory-store`, `@skill-catalog`, `@identity-model` | Typed learning-loop stage, source citations, no-copy guard, proposal-only mutation, cost log, max iteration. | Spec-complete |
| `agent.orchestrator` | `/orchestrator-agent` | Define and validate long-running stateful agent graphs, checkpoints, human review, and traces. | `@operator`, `@orchestration-graph`, `@state-store`, `@checkpoint-store`, `@human-review`, `@runtime-proof` | Typed graph state, node and edge contract, compile checks, checkpoint/resume, review gate, stream trace, no-copy guard. | Spec-complete |
| `flow.computing` | `/computing-flow` | Produce or validate a KGC computing-flow document for source-backed DAG execution and Canvas projection. | `@operator`, `@source.frontmatter`, `@local-harness`, `@runtime-proof` | `kgc-computing-flow/v1` schema, typed KTV inputs, explicit handles, bounded DAG feedback, KGC validation. | Spec-complete |

## FloatingPanel Chat Action Recommendation

FloatingPanel Chat action labels are context-ranked recommendations from dictionary routes. The canonical source tokens live in `DICTIONARY-COMMAND.md` and `DICTIONARY-SEMANTIC.md`; the chat component may insert those tokens from recommendations, but the editable textarea must keep `/`, `#`, and `@` tokens as plain raw text. Media embeds are the only composer overlay case because their raw Markdown is intentionally hidden behind a compact media chip.

| Display intent | Canonical route | Source owner | Runtime rule |
|---|---|---|---|
| Ingest | `/source.ingest` | `DICTIONARY-COMMAND.md` | Inspect or run source intake through shared Source Files owners. |
| Parse | `/source.parse` | `DICTIONARY-COMMAND.md` | Parse frontmatter and body before graph, table, KTV, or KGC projection. |
| Render | `/canvas.render` | `DICTIONARY-COMMAND.md` | Render through existing Canvas projection owners without direct store mutation. |
| Review workspace | `/workspace.review` | `DICTIONARY-COMMAND.md` | Produce a typed workspace context packet before execution. |
| Trace pipeline | `/pipeline.trace` | `DICTIONARY-COMMAND.md` | Surface ingest, parse, render, harness, cache, and cost state as a stage ledger. |
| Ingest URL | `/ingest-url` | `DICTIONARY-COMMAND.md` | Use the approved URL intake path; do not create a second URL-ingest alias. |
| Token economics | `#token-economics` | `DICTIONARY-SEMANTIC.md` | Use `/cost.audit #token-economics` when the semantic filter needs an executable command. |

### Variant Resolution

| Situation | Resolution |
|---|---|
| Variant token exists and bindings are present | Route through the shared skill registry and the named harness owner. |
| Variant token exists but required binding is missing | Return a typed missing-binding response before model, tool, or provider spend. |
| Variant needs paid, mutating, authenticated, healthcare-sensitive, Prod, or Cloudflare action | Require `@operator` approval and fail closed without approval. |
| Variant conflicts with frontmatter, source body, or harness contract | Neutralize the upstream source or shared owner; do not add a FloatingPanel Chat alias. |
| Variant token is unknown | Reject with a typed unsupported-variant result and suggest nearest `skill_variants` entries. |

### Variant VCCs

| VCC | Check |
|---|---|
| Variant catalog parses | Frontmatter parses as YAML and `skill_variants` lists semantic ids. |
| Chat remains projection-only | FloatingPanel Chat consumes shared skill contracts and does not own a duplicate variant registry. |
| Variants are source-backed | Every variant row names required bindings and harness requirements. |
| Computing-flow stays canonical | `/computing-flow` emits or validates `kgc-computing-flow/v1` instead of a chat-only flow payload. |
| Spend fails closed | Missing approval, binding, schema, or budget blocks before paid calls. |
| Runtime-ready is not implied | Slash-token availability does not promote a variant beyond spec-complete without current proof. |

## Skill Selection

| Situation | Select | Do not select |
|---|---|---|
| Source has stale, duplicate, or conflicting content | `source.normalize` | Downstream alias, compatibility shim, fixture patch, or browser-state workaround. |
| Request is ambiguous but source-backed | `context.resolve` | A guessed implementation path with hardcoded defaults. |
| A runtime needs agent identity or voice | `soul.load` | Hardcoded default identity, project-local operation rules, or unscanned prompt inclusion. |
| A session needs a temporary style mode | `personality.overlay` | Durable identity rewrite or bypassing facts, safety, approval, or deploy gates. |
| Work invokes a model, provider, agent, scraper, renderer, or tool chain | `harness.define` | Raw prompt call, untyped tool call, or unbounded loop. |
| A hard query benefits from multiple advisory perspectives before one answer | `moa.run` | Recursive MoA, copied external preset, global model switch, or uncapped fan-out. |
| A workflow is long-running, stateful, branching, or resumable | `orchestration.graph`, then `state.checkpoint` | Hidden graph runtime, copied external API, or unbounded state mutation. |
| A run must pause for operator decision | `human.review` | Paid or mutating continuation without approval. |
| A run needs observable progress | `stream.trace` | Secret-bearing logs or trace-only completion claims. |
| A repeated lesson should become reusable memory or a skill | `experience.capture`, then `skill.propose` | Direct self-modifying commit, copied external artifact, or stale fixture. |
| A skill needs improvement from observed failures | `skill.evolve` | Unreviewed runtime mutation, compatibility shim, or open-ended optimizer loop. |
| Prior context may change the answer | `memory.search` | Recomputing prior decisions from scratch or treating stale memory as truth. |
| A stable operator preference should persist | `identity.reflect` | Secrets, sensitive profiling, or unsupported personal inference. |
| Claim may be ready but needs proof | `runtime.check` | Prose promotion to runtime-ready. |
| Spend, token performance, latency, or vendor lock-in matters | `cost.audit` | Uncosted cloud or model dependency. |
| Work risks Prod mirror or Cloudflare mutation | `deploy.guard` | Deploy command, publish mirror write, or live route claim without approval. |
| A source change affects docs, API contracts, or schema maps | `docs.sync` | Stale generated docs, backfilled fixtures, or duplicate documentation. |

## Runtime-Ready Gates

| Gate | Required proof |
|---|---|
| Parse | Frontmatter parses without repair-only fallback. |
| Route | `/`, `#`, and `@` references resolve through shared utilities or return typed missing-binding errors. |
| Schema | Skill inputs and outputs validate before model, provider, filesystem, or deploy mutation. |
| Execute | Existing shared owner runs the skill path with bounded iteration and circuit breaker state. |
| Cost | Cost log reports model, prompt tokens, completion tokens, cache hits, and estimated cost. |
| Fallback | Schema errors, approval denials, provider failures, and budget breaches produce typed results. |
| Validate | Focused checks exit 0 for the touched scope. |
| Boundary | No Prod mirror or Cloudflare deploy occurs without explicit operator approval. |

## Invocation Grammar

| Prefix | Skill role | Rule |
|---|---|---|
| `/` | Command route | Select the intended operation, such as `/harness.define`, `/cost.audit`, or `/deploy.guard`. |
| `#` | Semantic filter | Narrow the concern, such as `#frontmatter`, `#harness`, `#token-economics`, `#tco`, `#vcc`, `#foss`, or `#no-hardcode`. |
| `@` | Binding route | Bind actor, source, proof, or runtime context, such as `@operator`, `@source.frontmatter`, `@local-harness`, `@runtime-proof`, or `@dev-only`. |

Commands, filters, and bindings are descriptive source content for shared invocation utilities. Unknown or conflicting routes must be rejected with a typed unsupported-route result, not remapped through legacy aliases.

## Semantic HTML And UI Projection

When a skill projects into UI, prefer semantic elements (`main`, `nav`, `article`, `section`, `aside`, `table`, `menu`, `button`, `progress`, `meter`) before generic containers, and reuse existing shared components.

## Cost And TCO Rules

| Rule | Requirement |
|---|---|
| FOSS-first | Prefer existing local, open, and zero-egress owners before paid or proprietary dependencies. |
| Fail before spend | Missing input, missing approval, or invalid schema blocks before model or provider calls. |
| Cache before compute | Reuse parsed frontmatter, semantic keys, normalized manifests, and existing proof packets. |
| Batch before loop | Batch compatible work and bound all iteration to avoid infinite loops and re-computation. |
| Measure before promote | Runtime-ready status requires observed cost, token, latency, and proof signals. |
| Remove stale paths | Delete legacy, duplicate, conflicting, or hardcoded paths instead of preserving remaps. |

## VCCs

| VCC | Check |
|---|---|
| Skill catalog parses | Frontmatter parses as YAML and `skill_contracts` lists semantic ids. |
| Skills are bounded | Every core skill names required routes, output, and status. |
| No duplicate runtime | Body content does not claim a new parser, provider panel, command runner, or deploy path. |
| Fail-closed deployment | `deploy.guard` remains Dev-only unless explicit operator approval is present. |
| No hardcoded runtime artifact | Body content contains no provider keys, generated media tokens, local upload ids, or live deploy evidence. |
| Semantic UI preserved | UI projection guidance names semantic HTML elements rather than generic container defaults. |

## Forbidden Patterns

- Backfill, churn, duplicate registries, freeze states, compatibility aliases, stale remaps, or copied external implementations.
- Hardcoded credentials, provider ids, upload ids, generated media URLs, transcripts, local runtime packets, or deployment claims.
- Raw prompt calls without typed schema validation, cost logging, fallback, and max-iteration bounds.
- Re-calculation, re-computation, re-rendering, polling, retrying, or agent loops without a shared cache, stop condition, and circuit breaker.
- Downstream patches that mask an upstream source, parser, registry, semantic-key, or shared helper defect.
- Browser-owned secrets, localStorage provider keys, duplicated provider catalogs, or standalone provider panels.
- Prod mirror writes or Cloudflare deploys without explicit operator authorization and returned live evidence.

## Validation

For documentation-only changes to this file, run the focused documentation checks from `VALIDATION-RUNBOOK.md`, including frontmatter parse, line count, ASCII scan, artifact scan, external-copy scan, route consistency, and deploy guard.

Promote any skill to runtime-ready only after the executing shared owner surfaces current proof, not from this catalog alone.
