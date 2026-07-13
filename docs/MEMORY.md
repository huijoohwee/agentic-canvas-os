---
title: "Agentic OS Memory"
graphId: "md:agentic-os-memory"
doc_type: "Agentic OS Memory"
date: "2026-07-07"
lang: "en-US"
schema: "agentic-os-memory/v1"
frontmatter_contract: "required"
status: "runtime-ready"
source_docs:
  - "SOUL.md"
  - "USER.md"
  - "FACTS.md"
  - "$GITHUB_ROOT/huijoohwee/docs/knowgrph-strybldr-starter-template.md"
  - "$GITHUB_ROOT/huijoohwee.github.io/guidelines/prd-tad-guidelines.md"
implementation_contract: "FACTS.md owns shared truth; MEMORY.md persists bounded agent notes; USER.md persists bounded explicit operator profile; frontmatter and authored Markdown body are SSOT"
publish_policy: "Dev-only until the operator explicitly authorizes Prod or Cloudflare"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "spec-complete-to-runtime-ready memory seed; no live provider, deploy, or paid-call claim"
runtime_proof: "RUNTIME-PROOF.md"
kgCanvasSurfaceMode: "2d"
kgCanvasRenderMode: "2d"
kgCanvas2dRenderer: "storyboard"
kgDocumentSemanticMode: "document"
kgFrontmatterModeEnabled: true
kgMultiDimTableModeEnabled: true
kgDocumentStructureBaselineLock: false
kgBottomPanelOpen: true
kgBottomPanelTab: "timeline"
kgFloatingPanelOpen: true
kgFloatingPanelView: "strybldr"
agentic_os_memory:
  version: "agentic-os-memory/v1"
  status: "runtime-ready-docs-seed"
  owner: "operator"
  default_scope: "local-dev"
  deployment_boundaries:
    dev: "$KNOWGRPH_ROOT"
    prod_mirror: "$PROD_MIRROR_ROOT"
    cloudflare_routes: ["airvio.co", "airvio.co/knowgrph"]
    deploy_gate: "forbid Prod and Cloudflare deploy until explicit operator instruction"
  invocation_prefixes:
    slash:
      prefix: "/"
      role: "command route"
      examples: ["/soul.load", "/personality.overlay", "/moa", "/memory.seed", "/memory.write", "/memory.compact", "/memory.search", "/session.search", "/user.profile", "/skill.discover", "/skill.load", "/skill.bundle", "/skill.manage", "/context.discover", "/context.load", "/context.audit", "/reference.expand", "/reference.audit", "/kanban.task", "/kanban.handoff", "/kanban.sync", "/tool.catalog", "/tool.route", "/tool.provider.select", "/tool.gateway.audit", "/toolset.enable", "/toolset.disable", "/tool.search", "/tool.describe", "/tool.call", "/orchestration.graph", "/state.checkpoint", "/human.review", "/stream.trace", "/superagent.run", "/runtime-ready.check", "/deploy.guard"]
    hash:
      prefix: "#"
      role: "semantic filter or topic route"
      examples: ["#frontmatter", "#harness", "#token-economics", "#vcc", "#soul", "#primary-identity", "#personality-overlay", "#persistent-memory", "#user-profile", "#frozen-snapshot", "#memory-capacity", "#session-search", "#skill-system", "#progressive-disclosure", "#skill-bundle", "#agentskills-compatible", "#skill-security", "#context-file", "#project-context", "#cwd-discovery", "#context-reference", "#inline-context", "#attached-context", "#kanban-board", "#task-row", "#profile-handoff", "#worker-process", "#multi-agent-collaboration", "#tool-gateway", "#tool-routing", "#tool-function", "#toolset", "#platform-toolset", "#tool-search", "#deferred-tool-schema", "#bridge-tool", "#web-search", "#image-generation", "#text-to-speech", "#cloud-browser", "#mixture-of-agents", "#reference-agents", "#aggregator-agent", "#orchestration-graph", "#stateful-agent", "#durable-execution", "#human-in-loop", "#long-horizon-harness", "#sandboxed-workspace", "#message-gateway"]
    at:
      prefix: "@"
      role: "source, actor, or runtime binding"
      examples: ["@operator", "@source.frontmatter", "@source.body", "@local-harness", "@runtime-proof", "@soul-profile", "@identity-slot", "@personality-overlay", "@memory-store", "@memory-entry", "@memory-snapshot", "@memory-policy", "@user-profile", "@session-index", "@skill-index", "@skill-source", "@skill-reference", "@skill-bundle", "@skill-policy", "@context-file", "@working-directory", "@context-policy", "@file:", "@folder:", "@diff", "@staged", "@git:", "@url:", "@reference-policy", "@attached-context", "@kanban-board", "@task-row", "@handoff-row", "@agent-profile", "@worker-process", "@tool-gateway", "@tool-provider", "@tool-function", "@toolset", "@platform-surface", "@deferred-tool-catalog", "@bridge-tool", "@web-search-tool", "@image-tool", "@tts-tool", "@browser-tool", "@tool-policy", "@moa-preset", "@reference-agents", "@aggregator-agent", "@orchestration-graph", "@state-store", "@checkpoint-store", "@human-review", "@sandbox-workspace", "@message-gateway"]
  operating_lenses:
    - "min-viable-max-value"
    - "TCO-zero"
    - "token-economics"
    - "harness-first"
    - "FOSS-first"
  forbidden_patterns:
    - "backfill"
    - "churn"
    - "conflict"
    - "duplicate"
    - "freeze"
    - "hardcode"
    - "infinite-loop"
    - "legacy-remapping"
    - "re-computation"
    - "re-rendering"
    - "stale-alias"
  runtime_gates:
    spec_complete:
      requires: ["frontmatter identity", "problem hypothesis", "acceptance criteria", "TCO estimate", "token budget", "VCC map"]
      forbids: ["implicit interface", "generic done state", "uncosted dependency"]
    runtime_ready:
      requires: ["typed harness", "bounded orchestration", "cost log", "fallback path", "focused proof", "clean deployment boundary"]
      forbids: ["raw prompt call", "unbounded loop", "fabricated provider output", "deploy claim without authorization"]
  learning_loop:
    source_policy: "external-pattern-reference-only; forbid copied code, prompts, schemas, tests, fixtures, and prose"
    persistence_order: ["FACTS.md", "SOUL.md", "MEMORY.md", "USER.md", "SKILLS.md", "DICTIONARY-*", "RUNTIME-PROOF.md"]
    commands: ["/memory.write", "/memory.compact", "/memory.search", "/session.search", "/user.profile", "/skill.discover", "/skill.load", "/skill.bundle", "/skill.manage", "/experience.capture", "/skill.propose", "/skill.evolve", "/identity.reflect"]
    guards: ["operator review", "focused validation", "semantic preservation", "no direct auto-commit", "no deploy"]
  persistent_memory:
    source_policy: "external-pattern-reference-only; forbid copied memory code, database schemas, sample entries, prompt renderers, tests, fixtures, and prose"
    targets:
      memory:
        source: "MEMORY.md"
        role: "agent notes: environment facts, conventions, lessons, project context"
        limit_chars: 2200
      user:
        source: "USER.md"
        role: "explicit operator preferences, communication style, expectations"
        limit_chars: 1375
    commands: ["/memory.write", "/memory.compact", "/memory.search", "/session.search", "/user.profile"]
    semantics: ["#persistent-memory", "#user-profile", "#frozen-snapshot", "#memory-capacity", "#session-search"]
    bindings: ["@memory-store", "@memory-entry", "@memory-snapshot", "@memory-policy", "@user-profile", "@session-index"]
    guards: ["bounded stores", "frozen session snapshot", "scan before write", "capacity error before overflow", "explicit user profile only", "no silent auto-compact", "no deploy"]
  skill_system:
    source_policy: "external-pattern-reference-only; forbid copied skills, code, examples, tests, prompt text, layouts, and prose"
    commands: ["/skill.discover", "/skill.load", "/skill.bundle", "/skill.manage", "/skill.propose", "/skill.evolve"]
    semantics: ["#skill-system", "#progressive-disclosure", "#skill-bundle", "#agentskills-compatible", "#skill-security", "#skill-evolution"]
    bindings: ["@skill-index", "@skill-source", "@skill-reference", "@skill-bundle", "@skill-policy", "@skill-catalog"]
    guards: ["metadata first", "selected source only", "resources on demand", "open-standard frontmatter", "shallow references", "scan and review before writes", "no deploy"]
  context_files:
    source_policy: "external-pattern-reference-only; forbid copied context discovery code, scanner code, example files, prompt assembly text, tests, fixtures, and prose"
    commands: ["/context.discover", "/context.load", "/context.audit"]
    semantics: ["#context-file", "#project-context", "#cwd-discovery"]
    bindings: ["@context-file", "@working-directory", "@context-policy"]
    guards: ["working-directory scoped", "first-match project context", "progressive subdirectory hints", "scan before load", "bounded context", "FACTS stronger than CLAUDE-style context", "SOUL remains identity", "no deploy"]
  context_references:
    source_policy: "external-pattern-reference-only; forbid copied context-reference parser code, prompt section text, examples, tests, fixtures, and prose"
    commands: ["/reference.expand", "/reference.audit"]
    semantics: ["#context-reference", "#inline-context", "#attached-context"]
    bindings: ["@file:", "@folder:", "@diff", "@staged", "@git:", "@url:", "@reference-policy", "@attached-context"]
    guards: ["supported surface only", "workspace scoped", "sensitive path block", "path traversal block", "binary reject", "soft warning hard refusal", "folder and git caps", "URL egress policy", "warnings not silent failure", "no deploy"]
  kanban_collaboration:
    source_policy: "external-pattern-reference-only; forbid copied board runtime, task schema examples, fixtures, tests, and prose"
    board: "kanban.md"
    commands: ["/kanban.task", "/kanban.handoff", "/kanban.sync"]
    semantics: ["#kanban-board", "#task-row", "#profile-handoff", "#worker-process", "#multi-agent-collaboration"]
    bindings: ["@kanban-board", "@task-row", "@handoff-row", "@agent-profile", "@worker-process"]
    guards: ["shared table utilities only", "row SSOT", "full OS worker process", "named profile", "conflict-aware writes", "no in-process subagent swarm", "no deploy"]
  tool_gateway:
    source_policy: "external-pattern-reference-only; forbid copied gateway code, provider tables, model lists, config examples, tests, fixtures, and prose"
    commands: ["/tool.catalog", "/tool.route", "/tool.provider.select", "/tool.gateway.audit", "/toolset.enable", "/toolset.disable"]
    semantics: ["#tool-gateway", "#tool-routing", "#tool-function", "#toolset", "#platform-toolset", "#web-search", "#image-generation", "#text-to-speech", "#cloud-browser"]
    bindings: ["@tool-gateway", "@tool-provider", "@tool-function", "@toolset", "@platform-surface", "@web-search-tool", "@image-tool", "@tts-tool", "@browser-tool", "@tool-policy"]
    guards: ["existing knowgrph infrastructure only", "typed tool functions", "logical toolsets", "platform-scoped enablement", "per-tool provider state", "server-managed secrets", "approval before paid or browser-auth tools", "cost log", "no deploy"]
  tool_search:
    source_policy: "external-pattern-reference-only; forbid copied tool-search code, retrieval implementation, bridge prompt text, examples, tests, fixtures, and prose"
    commands: ["/tool.search", "/tool.describe", "/tool.call"]
    semantics: ["#tool-search", "#deferred-tool-schema", "#bridge-tool"]
    bindings: ["@deferred-tool-catalog", "@bridge-tool", "@tool-policy"]
    guards: ["opt-in or budget-threshold activation", "MCP and non-core plugin tools only", "session-scoped catalog", "on-demand schema load", "real tool policy and approval", "no global registry", "no deploy"]
  soul_identity:
    source_policy: "external-pattern-reference-only; forbid copied identity text, personality presets, prompt assembly code, schemas, tests, fixtures, and prose"
    commands: ["/soul.load", "/personality.overlay"]
    semantics: ["#soul", "#primary-identity", "#personality-overlay"]
    bindings: ["@soul-profile", "@identity-slot", "@personality-overlay"]
    guards: ["prompt slot 1", "scan before inclusion", "typed fallback", "no hardcoded identity", "overlay is temporary", "no deploy"]
  mixture_of_agents:
    source_policy: "external-pattern-reference-only; forbid copied MoA code, prompts, preset examples, provider names, schemas, tests, fixtures, and prose"
    commands: ["/moa"]
    semantics: ["#mixture-of-agents", "#reference-agents", "#aggregator-agent"]
    bindings: ["@moa-preset", "@reference-agents", "@aggregator-agent"]
    guards: ["one-shot invocation", "no-tool references", "aggregator-only action", "reference token caps", "prompt-cache preservation", "no recursive MoA", "no deploy"]
  stateful_orchestration:
    source_policy: "external-pattern-reference-only; forbid copied graph or SuperAgent runtime code, APIs, schemas, prompts, provider configs, layouts, tests, examples, fixtures, and prose"
    commands: ["/orchestration.graph", "/state.checkpoint", "/human.review", "/stream.trace", "/superagent.run"]
    semantics: ["#orchestration-graph", "#stateful-agent", "#durable-execution", "#human-in-loop", "#long-horizon-harness", "#sandboxed-workspace", "#message-gateway"]
    bindings: ["@orchestration-graph", "@state-store", "@checkpoint-store", "@human-review", "@sandbox-workspace", "@message-gateway"]
    guards: ["typed state", "explicit nodes and edges", "checkpoint and resume", "human review gate", "sandbox scope", "message gateway", "bounded trace", "no deploy"]
socket_types:
  agentic_os_source_signal: {color: "#14b8a6", edgeWidthPx: 2, handleStrokeWidthPx: 2, accepts: [agentic_os_source_signal]}
  agentic_os_route_signal: {color: "#38bdf8", edgeWidthPx: 2, handleStrokeWidthPx: 2, accepts: [agentic_os_route_signal]}
  agentic_os_harness_signal: {color: "#f59e0b", edgeWidthPx: 3, handleStrokeWidthPx: 3, accepts: [agentic_os_harness_signal]}
  agentic_os_proof_signal: {color: "#22c55e", edgeWidthPx: 3, handleStrokeWidthPx: 3, accepts: [agentic_os_proof_signal]}
flow:
  direction: {key: direction, type: string, value: "LR"}
  edgeType: {key: edgeType, type: string, value: "smoothstep"}
  balancedViewportPreset: {key: balancedViewportPreset, type: string, value: "widgetFrontmatter"}
  computed: {key: computed, type: boolean, value: true}
  snapToGrid: {key: snapToGrid, type: boolean, value: true}
  nodes:
    - id: {key: id, type: string, value: "source_docs"}
      type: {key: type, type: string, value: "SourceDocsWidget"}
      label: {key: label, type: string, value: "Source Docs"}
      lane: {key: lane, type: string, value: "Source"}
      position: {key: position, type: object, value: {"x":0,"y":0}}
      handles: {key: handles, type: object, value: {"source":["frontmatter_contract"]}}
      sources: {key: sources, type: array, value: ["FACTS.md","SOUL.md","MEMORY.md","USER.md","SKILLS.md","DICTIONARY-COMMAND.md","DICTIONARY-SEMANTIC.md","DICTIONARY-BINDING.md"]}
      "flow:portTypes": {key: "flow:portTypes", type: object, value: {"out":{"frontmatter_contract":"agentic_os_source_signal"}}}
      "frontmatter:primitive": {key: "frontmatter:primitive", type: string, value: "node"}
      "kgc:readingSummary": {key: "kgc:readingSummary", type: string, value: "Source docs own Agentic OS frontmatter, layer contracts, and deploy boundaries."}
    - id: {key: id, type: string, value: "invocation_routes"}
      type: {key: type, type: string, value: "InvocationRouteWidget"}
      label: {key: label, type: string, value: "/ # @ Routes"}
      lane: {key: lane, type: string, value: "Routes"}
      position: {key: position, type: object, value: {"x":360,"y":0}}
      handles: {key: handles, type: object, value: {"target":["frontmatter_contract"],"source":["route_catalog"]}}
      commands: {key: commands, type: array, value: ["/memory.seed","/harness.define","/computing-flow","/runtime-ready.check","/validation.run","/deploy.guard"]}
      semantics: {key: semantics, type: array, value: ["#frontmatter","#harness","#computing-flow","#runtime-ready","#dev-only"]}
      bindings: {key: bindings, type: array, value: ["@source.frontmatter","@local-harness","@runtime-proof","@dev-only"]}
      "flow:portTypes": {key: "flow:portTypes", type: object, value: {"in":{"frontmatter_contract":"agentic_os_source_signal"},"out":{"route_catalog":"agentic_os_route_signal"}}}
      "frontmatter:primitive": {key: "frontmatter:primitive", type: string, value: "node"}
      "kgc:readingSummary": {key: "kgc:readingSummary", type: string, value: "Dictionaries expose slash, semantic, and binding routes without a duplicate parser."}
    - id: {key: id, type: string, value: "harness_contracts"}
      type: {key: type, type: string, value: "HarnessContractWidget"}
      label: {key: label, type: string, value: "Typed Harness"}
      lane: {key: lane, type: string, value: "Harness"}
      position: {key: position, type: object, value: {"x":720,"y":0}}
      handles: {key: handles, type: object, value: {"target":["route_catalog"],"source":["bounded_execution"]}}
      input_schema: {key: input_schema, type: string, value: "typed request"}
      output_schema: {key: output_schema, type: string, value: "typed result or blocked reason"}
      cost_fields: {key: cost_fields, type: array, value: ["model","prompt_tokens","completion_tokens","cache_hits","estimated_cost_usd"]}
      "flow:portTypes": {key: "flow:portTypes", type: object, value: {"in":{"route_catalog":"agentic_os_route_signal"},"out":{"bounded_execution":"agentic_os_harness_signal"}}}
      "frontmatter:primitive": {key: "frontmatter:primitive", type: string, value: "node"}
      "kgc:readingSummary": {key: "kgc:readingSummary", type: string, value: "Harness contracts fail before spend on malformed input, missing approval, or budget breach."}
    - id: {key: id, type: string, value: "runtime_proof"}
      type: {key: type, type: string, value: "RuntimeProofWidget"}
      label: {key: label, type: string, value: "Runtime Proof"}
      lane: {key: lane, type: string, value: "Proof"}
      position: {key: position, type: object, value: {"x":1080,"y":0}}
      handles: {key: handles, type: object, value: {"target":["bounded_execution"],"source":["proof_ledger"]}}
      proof_ref: {key: proof_ref, type: string, value: "RUNTIME-PROOF.md"}
      validation_ref: {key: validation_ref, type: string, value: "VALIDATION-RUNBOOK.md"}
      "flow:portTypes": {key: "flow:portTypes", type: object, value: {"in":{"bounded_execution":"agentic_os_harness_signal"},"out":{"proof_ledger":"agentic_os_proof_signal"}}}
      "frontmatter:primitive": {key: "frontmatter:primitive", type: string, value: "node"}
      "kgc:readingSummary": {key: "kgc:readingSummary", type: string, value: "Runtime-ready status is backed by parsed frontmatter, focused checks, and proof ledger entries."}
    - id: {key: id, type: string, value: "deploy_guard"}
      type: {key: type, type: string, value: "DeployGuardWidget"}
      label: {key: label, type: string, value: "Deploy Guard"}
      lane: {key: lane, type: string, value: "Boundary"}
      position: {key: position, type: object, value: {"x":1440,"y":0}}
      handles: {key: handles, type: object, value: {"target":["proof_ledger"],"source":["dev_only_boundary"]}}
      publish_policy: {key: publish_policy, type: string, value: "Dev-only until explicit operator approval"}
      blocked_targets: {key: blocked_targets, type: array, value: ["Prod mirror","Cloudflare"]}
      "flow:portTypes": {key: "flow:portTypes", type: object, value: {"in":{"proof_ledger":"agentic_os_proof_signal"},"out":{"dev_only_boundary":"agentic_os_proof_signal"}}}
      "frontmatter:primitive": {key: "frontmatter:primitive", type: string, value: "node"}
      "kgc:readingSummary": {key: "kgc:readingSummary", type: string, value: "Prod mirror and Cloudflare remain blocked until the operator explicitly opens the gate."}
  edges:
    - {"id":"edge_source_docs_to_invocation_routes","source":"source_docs","sourceHandle":"frontmatter_contract","target":"invocation_routes","targetHandle":"frontmatter_contract","label":"frontmatter contract","type":"agentic_os_source_signal"}
    - {"id":"edge_invocation_routes_to_harness_contracts","source":"invocation_routes","sourceHandle":"route_catalog","target":"harness_contracts","targetHandle":"route_catalog","label":"route catalog","type":"agentic_os_route_signal"}
    - {"id":"edge_harness_contracts_to_runtime_proof","source":"harness_contracts","sourceHandle":"bounded_execution","target":"runtime_proof","targetHandle":"bounded_execution","label":"bounded execution","type":"agentic_os_harness_signal"}
    - {"id":"edge_runtime_proof_to_deploy_guard","source":"runtime_proof","sourceHandle":"proof_ledger","target":"deploy_guard","targetHandle":"proof_ledger","label":"proof ledger","type":"agentic_os_proof_signal"}
flow_diagrams:
  key: "flow_diagrams"
  type: "object"
  value:
    memory_runtime_flow:
      key: "memory_runtime_flow"
      type: "mermaid_flowchart"
      floatingPanelView: "flowchart"
      floatingPanelOpen: true
      bottomPanelTab: "flowchart"
      bottomPanelOpen: true
      value: |-
        flowchart LR
          source["Source docs"]
          memory["Agentic OS Memory"]
          slash["/ command route"]
          hash["# semantic route"]
          at["@ binding route"]
          harness["Typed harness"]
          proof["Runtime-ready proof"]
          source --> memory
          memory --> slash
          memory --> hash
          memory --> at
          slash --> harness
          hash --> harness
          at --> harness
          harness --> proof
    readiness_sequence:
      key: "readiness_sequence"
      type: "mermaid_flowchart"
      floatingPanelView: "flowchart"
      floatingPanelOpen: true
      bottomPanelTab: "flowchart"
      bottomPanelOpen: true
      value: |-
        flowchart TD
          phase0["Phase 0: problem ROI TTV"]
          os["Must: OS status surface"]
          discovery["Must: AI agent discovery"]
          federation["Must: gateway federation"]
          spend["Follow-on: spend safety"]
          live["Follow-on: live orchestration proof"]
          ui["Follow-on: operator UI projection"]
          phase0 --> os --> discovery --> federation --> spend --> live --> ui
---

# Agentic OS Memory

This document is the local Agentic OS memory seed for solo-dev, AI-native product work. `SOUL.md` owns durable identity and voice. `FACTS.md` owns shared truth and precedence. `MEMORY.md` persists bounded agent notes. `USER.md` persists bounded explicit operator preferences, communication style, and expectations. Existing `/`, `#`, and `@` utilities route these contracts without adding a new parser, provider panel, deploy step, or compatibility layer.

The file is spec-complete when its frontmatter can be parsed as the source of truth. It is runtime-ready only when a caller proves the relevant VCCs with surfaced output, focused checks, and unchanged deploy boundaries.

## Invocation Surface

| Prefix | Use | Contract |
|---|---|---|
| `/` | Command route | Select an action such as `/memory.seed`, `/prd-tad.create`, `/runtime-ready.check`, or `/deploy.guard`. Commands invoke existing shared utilities; this document contributes routing content only. |
| `#` | Semantic route | Filter by concern: `#frontmatter`, `#harness`, `#token-economics`, `#tco`, `#vcc`, `#no-hardcode`, `#foss`, `#ttv`. Tags must not create duplicate registries. |
| `@` | Binding route | Bind the run to an actor, source, or runtime: `@operator`, `@source.frontmatter`, `@source.body`, `@local-harness`, `@runtime-proof`, `@dev-only`. Bindings must not imply deployment. |

## Source Of Truth

| Source | Memory role | Non-negotiable rule |
|---|---|---|
| `SOUL.md` | Durable agent identity and voice | Identity, style, and communication defaults stay separate from project operations and memory persistence. |
| `USER.md` | Explicit operator preferences, communication style, and expectations | Save only explicit, non-secret, bounded profile entries; reject unsupported personal inference. |
| `FACTS.md` | Shared truth and precedence | Facts override stale local memory; update the fact source instead of layering aliases. |
| Strybldr starter frontmatter | Runtime routing, renderer defaults, local-first publish gate | Frontmatter and authored source payloads own data; renderers project view state only. |
| Strybldr starter body | Operator workflow and acceptance checklist | Live provider fields, generated media URLs, transcripts, provider IDs, and deploy claims stay empty until returned by an approved live run. |
| PRD/TAD guidelines | Universal document and architecture contract | Requirements must stay neutral, modular, traceable, VCC-backed, TCO-aware, token-aware, and FOSS-first. |

## Operating Defaults

- Work Dev-first in `$KNOWGRPH_ROOT`.
- Treat `$PROD_MIRROR_ROOT` as a Prod mirror, not a working default.
- Treat `airvio.co` and `airvio.co/knowgrph` as Cloudflare deployment targets, not completion criteria.
- Forbid Prod or Cloudflare deploy unless the operator explicitly opens that gate.
- Prefer FOSS, zero-egress, local, and dry-run paths until ROI, TCO, token budget, and approval gates justify live spend.
- Reuse shared semantic-key, parser, headless, and renderer helpers. Do not add surface-local aliases, stale remaps, or hardcoded fixtures.

## Spec-Complete Gate

Before implementation, a feature memory is spec-complete only if it has:

| Gate | Required evidence |
|---|---|
| Problem | Falsifiable problem hypothesis and target persona or operator job. |
| Value | Min-viable-max-value scope, MoSCoW tier, ROI score, and explicit exclusions. |
| Cost | 12-month TCO estimate, deployment-model variants, FOSS alternative, and token budget. |
| Flow | User journey, workflow, data flow, orchestration or harness flow, and topology when three or more components exist. |
| Harness | Typed input schema, typed output schema, fallback path, and cost log fields for every AI-powered component. |
| Completion | Given-When-Then acceptance criteria translated into VCCs with measurable end state, stated check, and constraint. |

## Runtime-Ready Gate

A feature memory is runtime-ready only when the executing agent surfaces proof that:

| Gate | Required proof |
|---|---|
| Parse | Frontmatter parses without repair-only fallback. |
| Route | `/`, `#`, and `@` handles resolve through shared utilities or are rejected with structured errors. |
| Execute | Harness calls use schema-validated inputs and outputs; malformed inputs fail before token spend. |
| Bound | Agentic loops have max iterations and circuit breakers. |
| Cost | Cost logs include model, prompt tokens, completion tokens, cache hits, and estimated cost. |
| Validate | Focused tests or checks exit 0 for the touched scope. |
| Boundary | Dev, Prod mirror, and Cloudflare state remain separate; no deploy is claimed without authorization. |

## Learning Memory Loop

Memory supports a closed learning loop only as a scoped source-backed contract. It does not override `FACTS.md`, create a new runtime, or grant permission to copy external implementations.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Search | `/memory.search` | Retrieve prior decisions, proof, operator preferences, and project boundaries. | Cite scoped sources or return typed empty results. |
| Capture | `/experience.capture` | Persist a reusable lesson from proof, failure, or operator correction. | Require provenance, applicability, expiry risk, and no-copy statement. |
| Propose | `/skill.propose` | Convert repeated experience into a candidate skill contract. | Keep proposal review-pending until approved. |
| Evolve | `/skill.evolve` | Improve a skill from evaluation evidence and focused checks. | Produce diff proposal only; no direct self-modifying commit. |
| Reflect | `/identity.reflect` | Store stable, non-secret operator and project facts. | Reject unsupported personal inference, secrets, and deploy artifacts. |

Learning records should preserve why the lesson matters, where it came from, when it may expire, and what validation proves it. If a memory contradicts `FACTS.md`, update the fact source or demote the memory; do not layer aliases.

## Skill System Memory

Skills are on-demand procedural memory, not always-loaded facts. Use `MEMORY.md` for compact facts that must be available every session, and use skills for longer procedures that should load only when relevant.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Discover | `/skill.discover` | Read lightweight metadata from `@skill-index`. | Do not load full `SKILL.md` bodies during discovery. |
| Load | `/skill.load` | Add selected skill instructions to the active task context. | Load `@skill-source` only after selection; load `@skill-reference` files only when required. |
| Bundle | `/skill.bundle` | Reuse a recurring skill combination. | Bundles alias existing skills and report missing entries. |
| Manage | `/skill.manage` | Create or update procedural memory. | Scan, validate, and gate writes through `@skill-policy`; no direct auto-commit when review is required. |

## Context Reference Memory

Context references are per-message attachments, not durable memory or project context files. Supported `@file:`, `@folder:`, `@diff`, `@staged`, `@git:`, and `@url:` forms may expand only on approved surfaces and only after `@reference-policy` scans workspace scope, sensitive paths, binary content, egress, and size. Unsupported platforms preserve raw text and return typed warning.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Expand | `/reference.expand` | Attach explicit referenced content to the current message. | Preserve original text, bound content, and record warnings in `@attached-context`. |
| Audit | `/reference.audit` | Inspect expansion source, size, warning, and refusal state. | Read-only; no extra fetch, mutation, memory write, or deploy. |

## Kanban Collaboration Memory

`kanban.md` is the durable shared board for named profiles and worker processes. Use shared multi-dimensional table/Kanban utilities for every task row and handoff row; do not coordinate through hidden subagent state, browser-only state, or a copied board runtime.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Task | `/kanban.task` | Persist one validated work row. | Requires owner profile, status, evidence, acceptance, and next action. |
| Handoff | `/kanban.handoff` | Transfer work between profiles. | Requires from, to, task id, context refs, blockers, resume state, and acceptance. |
| Sync | `/kanban.sync` | Reconcile rows across OS worker processes. | Conflict-aware; preserves `kanban.md` as SSOT. |

## Persistent Memory Stores

Persistent memory is bounded and curated. It is not a raw transcript dump, auto-compactor, secret store, or personal inference engine.

Durable cross-device history lives in append-only `../memory/YYYY-MM.md` shards under the `MEMORY-LOG.md` contract. This document remains the bounded routing and runtime-readiness seed; selected shard entries are retrieved before context assembly instead of expanding this always-loaded source.

| Target | Source | Stores | Limit | Rejects |
|---|---|---|---:|---|
| `memory` | `MEMORY.md` | Environment facts, project conventions, tool quirks, completed-work lessons, and reusable techniques. | 2200 chars | User preferences, secrets, raw logs, one-off paths, copied source content. |
| `user` | `USER.md` | Explicit operator preferences, communication style, expectations, workflow habits, and stated technical comfort. | 1375 chars | Unsupported inference, sensitive profiling, secrets, project operations, stale session details. |

| Behavior | Contract |
|---|---|
| Frozen snapshot | Approved runtimes may inject `memory` and `user` snapshots once at session start; mid-session writes persist for later sessions and live tool responses only. |
| Write actions | `/memory.write` carries `add`, `replace`, or `remove` as typed action fields; it does not create a parser fork. |
| Capacity | A write that exceeds the target limit returns a typed capacity error and current entries; the agent must compact, replace, or remove before retry. |
| Search | `/session.search` finds prior conversation details on demand; results remain read-only unless explicitly captured. |
| Scan | Every write is scanned for prompt injection, exfiltration, credentials, invisible control characters, and unsupported profile inference. |

## Soul Identity Memory

Memory can remember how the identity layer should be resolved, but memory does not define the agent's durable identity. `SOUL.md` does.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Load | `/soul.load` | Remember that prompt slot 1 is sourced from `@soul-profile`. | Scan and bound before inclusion; no hardcoded default identity. |
| Fallback | `/soul.load` | Remember typed fallback behavior for missing, empty, unsafe, or unreadable soul source. | Fallback is explicit and observable, not silent. |
| Overlay | `/personality.overlay` | Remember temporary session style overlays. | Overlay cannot mutate `SOUL.md` or bypass facts, safety, approval, or deploy gates. |
| Separation | `/soul.load` | Remember layer boundaries between `SOUL.md`, `FACTS.md`, `AGENTS.md`, and `MEMORY.md`. | No project commands, paths, ports, architecture rules, or deploy approvals in soul content. |

## Mixture Of Agents Memory

MoA memory records the local one-shot deliberation contract. It does not switch the global model, create a copied provider preset, or persist advisory outputs as facts.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Preset | `/moa` | Remember local preset identity, reference roles, aggregator role, caps, and failure policy. | Reject recursive MoA aggregators and copied external preset examples. |
| References | `/moa` | Remember advisory reference outputs as private context for the run. | No tools, no mutation, capped output, typed failure, and cost logging. |
| Aggregator | `/moa` | Remember that one acting agent produced the final response or tool request. | Normal approval gates, transcript persistence, and follow-up iteration apply. |
| Cost | `/moa` | Remember reference tokens, aggregator tokens, cache hits, failures, and estimated cost. | Missing budget or approval blocks before paid calls. |

## Stateful Orchestration Memory

Stateful orchestration memory records graph-shaped run contracts without creating a new graph runtime. The source owns topology and proof; renderers and chat surfaces only project or invoke existing shared owners.

| Stage | Command | Memory role | Guard |
|---|---|---|---|
| Graph | `/orchestration.graph` | Remember state schema, node ids, edges, entry, exit, and stop condition. | Reject orphaned nodes, hidden mutation, and copied external API shapes. |
| Checkpoint | `/state.checkpoint` | Remember checkpoint scope, resume payload, idempotency, and recovery VCC. | Require cleanup path and no stale re-computation. |
| Review | `/human.review` | Remember interrupt, approve/reject/edit, resume, and audit contract. | Continuation requires operator approval. |
| Trace | `/stream.trace` | Remember ordered state transition, cost, and stop events. | Trace must be secret-free and bounded. |
| SuperAgent | `/superagent.run` | Remember long-horizon goal, graph, sandbox, message gateway, artifacts, verification, and cost ledger. | Reject open-ended loops, copied runtime layouts, and missing stop conditions before execution. |

## Harness Memory

Use this shape for every AI-capable memory block:

```yaml
harness:
  name: "[neutral capability name]"
  dispatcher:
    input_schema: "[typed payload]"
    output_schema: "[routed payload or typed error]"
  executor:
    model_policy: "local-or-approved-live"
    input_schema: "[typed model request]"
    output_schema: "[typed model response]"
  observer:
    cost_log_fields: ["model", "prompt_tokens", "completion_tokens", "cache_hits", "estimated_cost_usd"]
  consumer:
    output_target: "[artifact, graph, table, or local packet]"
  fallback:
    mode: "typed error or degraded-mode response"
  bounds:
    max_iterations: 1
    circuit_breaker: "stop on schema error, approval denial, or token budget breach"
```

## VCC Memory

Translate acceptance criteria into evaluator-checkable conditions:

```text
Given [context] When [action] Then [observable outcome]
VCC: Verify [outcome] by [stated check] with [constraint]; stop after [N] iterations.
```

Good VCCs name an exit code, parsed field, file count, response shape, latency threshold, queue state, or cost-log value. Weak VCCs say "looks good", "is complete", "works better", or "is ready" without measurable proof.

## Anti-Patterns To Neutralize Upstream

- Hardcoded source URLs, provider IDs, stream URLs, transcripts, credentials, generated media URLs, or deployment claims.
- Browser-owned secrets, localStorage provider keys, duplicated provider catalogs, or standalone provider panels.
- Raw prompt calls in production pipelines without schema validation, cost logging, and fallback paths.
- Unbounded retry loops, polling loops, re-render loops, or agentic loops without a circuit breaker.
- Compatibility aliases that remap legacy renderer names instead of removing the stale source.
- Downstream patches that mask a root parser, registry, semantic-key, or shared helper defect.
- Generic HTML containers in authored UI surfaces where semantic elements are available.

## Slash Command Seeds

| Command | Intent | Required context | Completion signal |
|---|---|---|---|
| `/soul.load` | Load durable agent identity into prompt slot 1. | `@soul-profile`, `@identity-slot`, `#primary-identity` | Soul source is scanned, bounded, and resolved or typed fallback is returned; no hardcoded default identity is embedded. |
| `/personality.overlay` | Apply temporary session-level style. | `@personality-overlay`, `#personality-overlay` | Overlay is session-scoped and cannot mutate `SOUL.md`. |
| `/moa` | Run one-shot Mixture of Agents deliberation. | `@moa-preset`, `@reference-agents`, `@aggregator-agent`, `#mixture-of-agents` | Reference calls are advisory and capped; aggregator produces the only visible response; cost log separates reference and aggregator spend. |
| `/memory.seed` | Create or update a neutral memory block from source docs. | `@source.frontmatter`, `@source.body`, `#frontmatter` | Parsed frontmatter and body memory block committed locally. |
| `/memory.write` | Add, replace, or remove a bounded memory/profile entry. | `@memory-entry`, `@memory-policy`, `#persistent-memory` | Entry is scanned, capacity-checked, target-scoped, and persisted or rejected with typed reason. |
| `/memory.compact` | Consolidate bounded memory before overflow. | `@memory-store`, `@memory-policy`, `#memory-capacity` | Before/after entries and capacity are reported; no silent drop occurs. |
| `/memory.search` | Search scoped local memory or conversation history. | `@memory-store`, `#memory-search`, `#truth` | Ranked cited results or typed empty result. |
| `/session.search` | Search past conversations on demand. | `@session-index`, `#session-search` | Cited matches return read-only; persistence requires explicit capture. |
| `/user.profile` | Persist explicit user preferences and expectations. | `@user-profile`, `@memory-entry`, `#user-profile` | Profile write is explicit, bounded, non-secret, and rejects unsupported inference. |
| `/experience.capture` | Capture a source-backed lesson from a run or correction. | `@experience`, `@runtime-proof`, `#learning-loop` | Experience record names provenance, applicability, expiry risk, and approval state. |
| `/skill.propose` | Draft a reusable skill from repeated experience. | `@experience`, `@skill-catalog`, `#skill-evolution` | Proposal includes schemas, bounds, cost fields, and VCCs. |
| `/skill.evolve` | Improve an existing skill from evaluated evidence. | `@skill-catalog`, `@runtime-proof`, `#skill-evolution` | Proposed diff and validation are review-pending; no auto-commit. |
| `/identity.reflect` | Persist stable non-secret operator and project facts. | `@identity-model`, `@memory-store`, `#identity-model` | Reflection stores source-backed facts or rejects unsafe inference. |
| `/orchestration.graph` | Declare or validate stateful graph topology. | `@orchestration-graph`, `@state-store`, `#orchestration-graph` | State, nodes, edges, entry, exit, stop condition, and compile checks are present. |
| `/state.checkpoint` | Define durable checkpoint and resume behavior. | `@checkpoint-store`, `@state-store`, `#durable-execution` | Checkpoint scope, resume payload, idempotency, recovery proof, and cleanup path are present. |
| `/human.review` | Pause, inspect, edit, approve, reject, or resume a run. | `@human-review`, `@operator`, `#human-in-loop` | Run remains paused until review result is typed. |
| `/stream.trace` | Surface ordered state transition and cost events. | `@runtime-proof`, `@cost-log`, `#durable-execution` | Trace is bounded, ordered, and secret-free. |
| `/superagent.run` | Run bounded long-horizon research, coding, or creation. | `@orchestration-graph`, `@sandbox-workspace`, `@message-gateway`, `#long-horizon-harness` | Goal, workspace, message handoffs, checkpoints, artifacts, verification, and cost ledger are typed. |
| `/prd-tad.create` | Produce a combined PRD/TAD from a validated problem. | `#roi`, `#tco`, `#ttv`, `#vcc` | PRD/TAD includes traceability, topology, harness, ADR, and VCC sections. |
| `/runtime-ready.check` | Prove a spec-complete artifact is runnable. | `@local-harness`, `#harness`, `#vcc` | Focused checks exit 0 and cost/deploy boundaries are surfaced. |
| `/deploy.guard` | Prevent accidental Prod or Cloudflare release. | `@dev-only`, `#no-deploy` | Output states Dev-only status and no Prod/Cloudflare mutation. |

## Hash Filters

| Filter | Matches | Use when |
|---|---|---|
| `#soul` | Durable agent identity and voice | A claim concerns who the agent is or how it speaks. |
| `#primary-identity` | Prompt slot 1 identity source | A runtime assembles the first identity block. |
| `#personality-overlay` | Temporary style overlay | A session needs a reversible tone or mode shift. |
| `#persistent-memory` | Bounded curated memory | A fact should persist across sessions in `MEMORY.md` or `USER.md`. |
| `#user-profile` | Explicit operator profile | A preference, communication style, or expectation should persist. |
| `#frozen-snapshot` | Session-start memory/profile prompt context | Prompt assembly uses memory without mid-session prompt mutation. |
| `#memory-capacity` | Bounded memory limit | A write may overflow or needs compaction. |
| `#session-search` | On-demand past-conversation search | Specific prior conversation detail is needed without always-on memory cost. |
| `#mixture-of-agents` | One-shot multi-agent deliberation | A hard query needs bounded reference perspectives before a single aggregator answer. |
| `#reference-agents` | Advisory no-tool reference calls | MoA needs private reference context with caps and typed failure. |
| `#aggregator-agent` | Single acting MoA agent | MoA needs the final response, tool calls, and approval gates owned by one aggregator. |
| `#frontmatter` | Identity, renderer, parser, routing, deploy gates | A document needs parse-first routing or SSOT cleanup. |
| `#harness` | AI component contracts, schemas, fallbacks, cost logs | A feature spends tokens or invokes a model. |
| `#token-economics` | Prompt/completion budget, cache hit rate, cost logs | A pipeline has token performance or TCO risk. |
| `#vcc` | Acceptance criteria, proof commands, evaluator-visible output | A requirement needs a measurable done condition. |
| `#no-hardcode` | Fixtures, credentials, URLs, provider IDs, generated outputs | A source doc or repo patch risks stale embedded data. |
| `#foss` | Alternatives, vendor risk, deployment-model TCO | A dependency or cloud service is under consideration. |
| `#learning-loop` | Experience capture and reviewed persistence | A run should teach future agents without copying external artifacts. |
| `#skill-evolution` | Skill proposal or improvement | A reusable skill changes from evaluated evidence. |
| `#memory-search` | Scoped prior-context retrieval | Prior conversations or memory may change the response. |
| `#identity-model` | Stable operator and project preference facts | A repeated preference or boundary should persist safely. |
| `#orchestration-graph` | State, node, edge, and stop-condition topology | A long-running workflow needs graph-shaped control. |
| `#stateful-agent` | Durable agent state across turns or sessions | A run needs scoped state, memory, and resume behavior. |
| `#durable-execution` | Checkpoint, resume, retry, and recovery | A run can pause, fail, or run longer than one request. |
| `#human-in-loop` | Operator interrupt, review, and resume | A run needs approval or edit before continuing. |

## At Bindings

| Binding | Meaning | Boundary |
|---|---|---|
| `@soul-profile` | Durable identity source from `SOUL.md`. | Identity only; no project operations, secrets, or deploy approvals. |
| `@identity-slot` | Prompt slot 1 identity position. | Source-backed identity or typed fallback; no silent hardcode. |
| `@personality-overlay` | Session-level style overlay. | Temporary and subordinate to facts, roles, memory, safety, and gates. |
| `@moa-preset` | Local MoA preset for reference roles, aggregator, caps, and failover. | No copied external preset examples, provider names, or recursive aggregator. |
| `@reference-agents` | Bounded advisory agents in `/moa`. | No tools, no mutation, capped output, private context only. |
| `@aggregator-agent` | Acting agent that produces the `/moa` response. | Owns final answer, tool calls, approvals, and transcript persistence. |
| `@operator` | Human approval authority. | Required before paid, mutating, Prod, or Cloudflare actions. |
| `@source.frontmatter` | Parsed YAML frontmatter. | SSOT for identity, routing, renderer flags, and runtime gates. |
| `@source.body` | Authored Markdown body. | SSOT for operator workflow, guardrails, and checklist language. |
| `@local-harness` | Dev-local execution path. | Default for dry-runs and zero-paid-call proofs. |
| `@runtime-proof` | Surfaced validation evidence. | Must include commands or structured output, not narrative claims. |
| `@dev-only` | Deployment boundary. | Confirms work stops before Prod mirror and Cloudflare. |
| `@experience` | Source-backed lesson record. | Requires provenance, applicability, expiry risk, and no-copy guard. |
| `@memory-store` | Bounded agent-note store. | Environment, convention, and lesson notes only; writes are scanned and capacity-checked. |
| `@memory-entry` | One compact memory/profile entry. | Requires target, evidence, action, scan result, and capacity result. |
| `@memory-snapshot` | Frozen session-start memory/profile context. | Immutable for the active prompt after session start. |
| `@memory-policy` | Write approval, scan, capacity, duplicate, and compaction policy. | Unsafe or overflowing writes fail closed. |
| `@user-profile` | Bounded explicit operator profile. | No unsupported inference, secrets, or project operations. |
| `@session-index` | Searchable past-session records. | Read-only unless explicitly captured. |
| `@skill-catalog` | Reusable skill contract catalog. | Proposals require review before persistence. |
| `@identity-model` | Stable non-secret operator and project fact store. | Rejects unsupported personal inference. |
| `@orchestration-graph` | Source-backed graph topology. | No hidden graph registry or copied external API shape. |
| `@state-store` | Scoped state snapshot. | Typed, secret-free, and bounded. |
| `@checkpoint-store` | Durable checkpoint owner. | Requires recovery proof and cleanup path. |
| `@human-review` | Operator review interrupt and resume binding. | Blocks continuation until approved, rejected, or edited. |

## Validation Checklist

- [x] Frontmatter is the first block and parses as YAML.
- [x] Body content does not copy local media URLs, tokens, credentials, provider IDs, transcripts, or generated assets from source docs.
- [x] `/`, `#`, and `@` route content is descriptive and reusable; no new duplicate runtime registry is implied.
- [x] Every AI capability has a harness contract, fallback, token budget, and cost log.
- [x] Every loop has a max-iteration bound and circuit breaker.
- [x] Every acceptance criterion can be converted into a VCC.
- [x] Dev, Prod mirror, and Cloudflare deployment boundaries are stated separately.
- [x] No Prod or Cloudflare deployment is performed or claimed from this memory update.
