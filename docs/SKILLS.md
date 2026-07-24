---
title: "Knowgrph Agentic Canvas OS Skills"
graphId: "md:knowgrph-agentic-canvas-os-skills"
doc_type: "Skill Contract Catalog"
date: "2026-07-24"
lang: "en-US"
schema: "agentic-canvas-os-skills/v1"
frontmatter_contract: "required"
status: "runtime-ready"
source_docs:
  - "FACTS.md"
  - "AGENTS.md"
  - "DICTIONARY-COMMAND.md"
  - "DICTIONARY-SEMANTIC.md"
  - "DICTIONARY-BINDING.md"
  - "HARNESS-CONTRACTS.md"
  - "AGENT-TEAM.md"
  - "REPOSITORY-PACKING.md"
  - "SKILL-EVOLUTION.md"
  - "RUNTIME-READINESS.md"
  - "MANAGED-IMPLEMENTATION-RUNS.md"
  - "INSTRUCTION-AUDIT.md"
external_pattern_sources:
  - "https://learn.chatgpt.com/docs/customization/overview"
  - "https://agentskills.io/specification"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/skills"
  - "https://github.com/bytedance/deer-flow"
  - "https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "metadata-first skill discovery and routing contracts"
runtime_claim: "bounded catalog and owner routing; full workflow detail remains progressively disclosed"
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
  - "instruction.audit"
  - "instruction.quality.evaluate"
  - "cost.audit"
  - "deploy.guard"
  - "docs.sync"
  - "flow.computing"
  - "image.to-threejs"
  - "image.to-glb"
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
  - "agent.team"
  - "agent.swarm"
  - "agent.toolkit"
  - "state.checkpoint"
  - "human.review"
  - "stream.trace"
  - "superagent.run"
  - "implementation.run"
  - "repository.pack"
  - "sme.risk.profile"
  - "crawler.run"
  - "sandbox.policy.author"
  - "sandbox.gateway.troubleshoot"
skill_variants: ["agent.moa", "agent.investment-research", "agent.sme-care", "agent.video", "agent.crawler", "agent.docs", "agent.code", "agent.cost", "agent.learning", "agent.orchestrator"]
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

This document is the metadata-first catalog for Agentic Canvas OS skills. It makes reusable capabilities discoverable without placing every workflow in the default instruction context. It does not execute commands, load providers, authorize mutation, or duplicate runtime registries.

## Progressive Disclosure

1. Discover the catalog metadata and select a skill whose intent matches the task.
2. Load the selected skill contract or specialized owner document.
3. Load referenced resources only when they are required for the current step.
4. Route execution through the existing harness or runtime owner.
5. Surface typed proof, cost, fallback, and deploy state.

Unselected workflow detail stays out of context. Deep reference chains, copied external skill bodies, and speculative bulk loading fail the catalog contract.

## Skill Shape

| Field | Catalog requirement |
|---|---|
| Identity | Stable lowercase dot id and one clear intent. |
| Owner | Existing source, harness, parser, or runtime boundary. |
| Input and output | Typed payloads, errors, proof, and approved mutation target. |
| Bounds | Timeout, iteration or call limit, circuit breaker, and fail-before-spend conditions. |
| Cost | Actual model usage when reported; exact zero for model-free checks. |
| Status | Draft, spec-complete, runtime-ready, gated, or blocked with current evidence. |

The three dictionaries own invocation tokens: `DICTIONARY-COMMAND.md`, `DICTIONARY-SEMANTIC.md`, and `DICTIONARY-BINDING.md`. `HARNESS-CONTRACTS.md` owns shared execution detail, and `RUNTIME-PROOF.md` owns promotion evidence.

## Catalog Families

| Family | Skill ids | Detail owner |
|---|---|---|
| Source and proof | `source.normalize`, `context.resolve`, `harness.define`, `runtime.check`, `instruction.audit`, `instruction.quality.evaluate`, `cost.audit`, `deploy.guard`, `docs.sync`, `repository.pack` | `FACTS.md`, `HARNESS-CONTRACTS.md`, `INSTRUCTION-AUDIT.md`, `INSTRUCTION-QUALITY-EVALUATION.md`, `REPOSITORY-PACKING.md` |
| Identity and memory | `soul.load`, `personality.overlay`, `memory.write`, `memory.compact`, `memory.search`, `session.search`, `user.profile`, `identity.reflect` | `SOUL.md`, `MEMORY.md`, `MEMORY-LOG.md`, `USER.md` |
| Skill and context loading | `skill.discover`, `skill.load`, `skill.bundle`, `skill.manage`, `skill.propose`, `skill.evolve`, `context.discover`, `context.load`, `context.audit`, `reference.expand`, `reference.audit` | This catalog, dictionaries, `SKILL-EVOLUTION.md`, and `HARNESS-CONTRACTS.md` |
| Tools | `tool.catalog`, `tool.route`, `tool.provider.select`, `tool.gateway.audit`, `toolset.enable`, `toolset.disable`, `tool.search`, `tool.describe`, `tool.call` | `MCP-GATEWAY.md` and `HARNESS-CONTRACTS.md` |
| Orchestration | `moa.run`, `experience.capture`, `orchestration.graph`, `agent.team`, `agent.swarm`, `agent.toolkit`, `state.checkpoint`, `human.review`, `stream.trace`, `superagent.run`, `implementation.run`, `kanban.collaborate` | `AGENT-TEAM.md`, `AGENT-SWARM.md`, `AGENT-TOOLKIT.md`, `MANAGED-IMPLEMENTATION-RUNS.md`, `HARNESS-CONTRACTS.md`, `kanban.md`, and runtime-specific proof |
| Canvas and domain capabilities | `flow.computing`, `image.to-threejs`, `image.to-glb`, `sme.risk.profile`, `crawler.run`, `sandbox.policy.author`, `sandbox.gateway.troubleshoot` | Specialized documents and the named Knowgrph runtime owners |

## Specialized Contracts

| Capability | Selected detail |
|---|---|
| Instruction audit | `INSTRUCTION-AUDIT.md` |
| Instruction task quality | `INSTRUCTION-QUALITY-EVALUATION.md` |
| Image to Three.js | `IMAGE-TO-THREEJS-SKILL.md` |
| Image to GLB | `IMAGE-TO-GLB-SKILL.md` |
| Sandbox policy | `SANDBOX-RUNTIME.md` |
| Agent Team | `AGENT-TEAM.md` |
| Agent Swarm | `AGENT-SWARM.md` |
| Agent Toolkit | `AGENT-TOOLKIT.md` |
| Skill Evolution | `SKILL-EVOLUTION.md` |
| Managed implementation runs | `MANAGED-IMPLEMENTATION-RUNS.md` |
| Repository packing | `REPOSITORY-PACKING.md` |
| Computing flow | `PRD-TAD.md` and the invocation dictionaries |

Variants remain metadata aliases over registered owners: `agent.moa`, `agent.investment-research`, `agent.sme-care`, `agent.video`, `agent.crawler`, `agent.docs`, `agent.code`, `agent.cost`, `agent.learning`, and `agent.orchestrator`. The domain variants resolve through `/investment-research-agent`, `/sme-care-agent`, `/video-agent`, and `/crawler-agent`; `agent.orchestrator` resolves role-based team requests through `/agent.team`; a variant does not create a wildcard command or a second execution registry.

## Selection And Mutation

- Select by intent and required capability, not by provider or UI surface.
- Return a typed gap when the selected owner, binding, approval, or proof is absent.
- Keep writes proposal-first when policy requires review; scan and validate approved writes at the owning boundary.
- Route paid, authenticated, mutating, sensitive, Prod, and Cloudflare actions through explicit operator gates.
- Preserve raw unsupported invocation text instead of creating compatibility aliases.

## Runtime Readiness

A catalog entry is spec-complete when its identity, owner, schemas, bounds, cost posture, fallback, and VCC are source-backed. Runtime-ready status additionally requires focused executable proof from the shared owner. Catalog presence alone never proves provider availability, live execution, artifact persistence, or deployment.

`instruction.audit` is model-free. It audits `AGENTS.md` and this catalog for required intent, bounded instruction density, duplicate instructions, route-detail load, and canonical-owner leakage. Its typed report contains zero model tokens and no mutation or deployment authority.

`instruction.quality.evaluate` scores provenance-bound final answers against the selected repository suite. The evaluator invokes no model, reads no private reasoning, and requires a complete candidate packet plus human review before any quality promotion.

## External Boundary

External documentation and projects inform capability shape only. This repository does not copy their code, prose, prompts, schemas, examples, tests, fixtures, layouts, packages, or runtime dependencies. Local owners, dictionaries, validation, and proof remain authoritative.

## VCCs

| VCC | Observable check |
|---|---|
| Discovery is light | Frontmatter exposes ids and variants before selected detail loads. |
| Selection is bounded | One selected owner supplies the needed workflow and shallow references. |
| Routes stay canonical | Invocation entries resolve through the three dictionaries. |
| Promotion is honest | Runtime-ready claims link current executable proof and cost state. |
| Default context stays lean | `npm run instruction-audit:check` passes its budgets and duplicate checks. |
| Task quality stays observable | `npm run instruction-quality:check` validates the suite and scorer; a named candidate passes only through explicit final-answer evaluation. |
| Deployment stays closed | Audit and catalog validation make no Prod mirror or Cloudflare mutation. |
