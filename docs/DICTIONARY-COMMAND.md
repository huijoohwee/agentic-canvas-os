---
title: "Agentic OS Command Dictionary"
graphId: "md:agentic-os-dictionary-command"
doc_type: "Invocation Dictionary"
date: "2026-07-09"
lang: "en-US"
schema: "agentic-os-dictionary-command/v1"
frontmatter_contract: "required"
status: "runtime-ready"
prefix: "/"
prefix_role: "command route"
source_docs:
  - "FACTS.md"
  - "MEMORY.md"
  - "AGENTS.md"
  - "HARNESS-CONTRACTS.md"
  - "MCP-GATEWAY.md"
  - "VALIDATION-RUNBOOK.md"
  - "START-WORKFLOW.md"
  - "RELEASE-WORKFLOW.md"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "dictionary content for shared slash invocation utilities; no separate command runtime"
runtime_proof: "RUNTIME-PROOF.md"
metadata_consumers:
  - id: "chat_composer"
    surface: "FloatingPanel Chat composer"
    owner: "knowgrph/canvas/src/features/chat/floatingPanelChat/FloatingPanelChatComposer.tsx"
    metadata_fields: ["token", "label", "summary", "group", "sourcePath", "keywords", "prefix_role"]
    behavior: "inline command-menu insertion; preserve query text after the invocation token"
  - id: "skills_commands_catalog"
    surface: "FloatingPanel Skills & Commands catalog"
    owner: "knowgrph/canvas/src/features/panels/views/SkillsCommandsView.tsx"
    metadata_fields: ["token", "label", "summary", "group", "sourcePath", "keywords", "prefix_role"]
    behavior: "searchable catalog row and active-card token insertion"
  - id: "mcp"
    surface: "MCP capability metadata"
    owner: "knowgrph/mcp/local-tool-contract.js"
    metadata_fields: ["token", "prefix", "intent", "required_bindings", "semantic_filters", "completion_signal", "publish_policy", "source_docs"]
    behavior: "reference and handoff metadata only; no standalone MCP tool execution"
entry_metadata_contract:
  token: "dictionary_entries item and first Commands table column"
  label: "runtime mirror derives a concise display label from the token"
  summary: "Commands table Intent column"
  group: "Agentic OS command dictionary"
  sourcePath: "this dictionary document"
  keywords: "token parts plus Intent, Required bindings, Semantic filters, and Completion signal text"
  mcp: "MCP consumers may expose command intent and required context, but must fail closed before spend, mutation, or deploy"
dictionary_entries:
  - "/soul.load"
  - "/personality.overlay"
  - "/moa"
  - "/video-agent"
  - "/image.to-threejs"
  - "/image.to-glb"
  - "/knowgrph.probe-tree"
  - "/query"
  - "/memory.seed"
  - "/memory.write"
  - "/memory.compact"
  - "/memory.search"
  - "/session.search"
  - "/user.profile"
  - "/skill.discover"
  - "/skill.load"
  - "/skill.bundle"
  - "/skill.manage"
  - "/context.discover"
  - "/context.load"
  - "/context.audit"
  - "/reference.expand"
  - "/reference.audit"
  - "/kanban.task"
  - "/kanban.handoff"
  - "/kanban.sync"
  - "/tool.catalog"
  - "/tool.route"
  - "/tool.provider.select"
  - "/tool.gateway.audit"
  - "/toolset.enable"
  - "/toolset.disable"
  - "/tool.search"
  - "/tool.describe"
  - "/tool.call"
  - "/experience.capture"
  - "/skill.propose"
  - "/skill.evolve"
  - "/identity.reflect"
  - "/orchestration.graph"
  - "/state.checkpoint"
  - "/human.review"
  - "/stream.trace"
  - "/superagent.run"
  - "/sandbox.policy.validate"
  - "/sandbox.policy.authorize"
  - "/prd-tad.create"
  - "/runtime-ready.check"
  - "/session.start"
  - "/release.complete"
  - "/deploy.guard"
  - "/harness.define"
  - "/mcp.capabilities"
  - "/cost.audit"
  - "/canvas.project"
  - "/canvas.render"
  - "/canvas.node.add"
  - "/canvas.node.link"
  - "/canvas.selection.open"
  - "/canvas.selection.chat"
  - "/canvas.selection.delete"
  - "/canvas.media.attach"
  - "/canvas.layout.tune"
  - "/canvas.viewport.inspect"
  - "/canvas.viewport.transform"
  - "/camera.frame"
  - "/camera.animate"
  - "/camera.play"
  - "/camera.scrub"
  - "/canvas.interaction.tune"
  - "/canvas.physics.tune"
  - "/canvas.center"
  - "/canvas.distribute"
  - "/canvas.performance.audit"
  - "/canvas.edge.rewire"
  - "/validation.run"
  - "/workspace.review"
  - "/pipeline.trace"
  - "/source.ingest"
  - "/source.parse"
  - "/source.normalize"
  - "/ingest-url"
  - "/computing-flow"
---

# Command Dictionary

This file defines `/` command-route content for Agentic Canvas OS docs. It is a dictionary for shared invocation utilities, not a new command runner, parser, provider panel, or compatibility registry.

## Contract

| Rule | Requirement |
|---|---|
| Route owner | Existing shared `/` utilities own command detection and replacement. |
| Dictionary role | This file names command intent, required context, and proof expectations. |
| Runtime status | Spec-complete until a shared runtime owner proves execution. |
| Spend policy | Malformed input, missing approval, or missing binding fails before paid calls. |
| Deploy policy | Prod mirror and Cloudflare commands remain gated until explicit operator approval. |

## Consumer Metadata

| Consumer | Metadata read | Source fields | Runtime boundary |
|---|---|---|---|
| Chat composer | Token, label, summary, group, sourcePath, keywords, prefix role. | `dictionary_entries`; Commands table Intent plus Required bindings, Semantic filters, and Completion signal. | Inserts the `/` token and preserves the editable query; unknown tokens stay raw text. |
| Skills & Commands catalog | Token, label, summary, group, sourcePath, keywords, prefix role. | Same source fields as chat composer. | Renders searchable rows and active-card insertion without copying a panel-local command list. |
| MCP | Token, prefix, intent, required bindings, semantic filters, completion signal, publish policy, source docs. | Commands table plus frontmatter policy fields. | Metadata is reference and handoff context only; a dictionary row does not become an executable MCP tool without a separate shared runtime owner. |

## Commands

| Command | Intent | Required bindings | Semantic filters | Completion signal |
|---|---|---|---|---|
| `/soul.load` | Load durable agent identity from `SOUL.md` as prompt slot 1 without hardcoding a default identity in runtime code. | `@soul-profile`, `@identity-slot`, `@runtime-proof` | `#soul`, `#primary-identity`, `#no-hardcode`, `#vcc` | Soul source parses, scan and bound result is typed, slot 1 identity is sourced or a typed fallback is returned, and no project commands or deploy grants are introduced. |
| `/personality.overlay` | Apply a temporary session-level style or mode overlay. | `@personality-overlay`, `@operator`, `@runtime-proof` | `#personality-overlay`, `#soul`, `#approval-gate` | Overlay is session-scoped, cannot mutate `SOUL.md`, and remains subordinate to facts, roles, memory, safety, and deploy gates. |
| `/moa` | Run a one-shot Mixture of Agents pass for a hard query without switching the global model or creating a copied provider preset. | `@moa-preset`, `@reference-agents`, `@aggregator-agent`, `@cost-log`, `@operator` when paid calls are possible | `#mixture-of-agents`, `#reference-agents`, `#aggregator-agent`, `#token-economics` | Local preset resolves; reference calls are no-tool, capped, and advisory; aggregator returns the only user-visible answer; tool calls use normal approval gates; cost log records reference and aggregator tokens; prior context is restored. |
| `/video-agent` | Run a source-backed, approval-gated video workflow from authored script through structured planning, media generation, persistence, read-back, and shared Canvas projection. | `@operator`, `@video-generation-demo-script`, one `@provider.*` binding, one or more of `@text`, `@image`, `@audio`, `@video`, `@cost-log`, `@runtime-proof` | one `#spec.*`, one `#thinking.type.*`, one `#token-cap.*`, `#approval-gate`, `#token-economics`, `#vcc` | The text stage returns Character, Scene, Dialogue, Visual asset, Audio, Timing, Metadata, and Prompt sheets; approved media stages persist and read back typed artifacts; Cards, Widgets, Rich Media Panels, and Timeline reuse the same identities; missing approval, credentials, entitlement, budget, persistence, read-back, or capability stops terminally. |
| `/image.to-threejs` | Resolve the native `image.to-threejs` skill for the selected Card or Widget source. | `@image-to-threejs`, `@local-harness`, `@runtime-proof` | `#image-to-threejs`, `#skill-system`, `#dev-only` | A PNG, JPG, JPEG, or SVG source resolves to the shared zero-cost Three.js manifest and Card, Widget, or Rich Media projection; unsupported sources return the typed fallback without provider execution. |
| `/image.to-glb` | Resolve the native procedural `image.to-glb` asset contract for the selected Card or Widget source. | `@image-to-glb`, `@local-harness`, `@runtime-proof` | `#image-to-glb`, `#skill-system`, `#dev-only` | The request accepts only procedural JS/TS scene construction, records bounded vision-review passes, and emits a GLB asset; baked or serialized geometry, embedded glTF buffers, and unapproved LLM/provider execution fail closed. |
| `/knowgrph.probe-tree` | Generate bounded editable next-question branches from the selected Widget Card through the shared Probe-Tree runtime. | `@knowgrph.probe-tree`, `@source.frontmatter`, `@runtime-proof` | `#knowgrph.probe-tree`, `#runtime-ready`, `#token-economics` | MCP-first generation returns two to four forward-only Type 2 cards with numbered multi-select choices plus Other and one Rich Media ledger; canonical Output, depth, token, provider approval, graph persistence, and zero-spend fallback evidence remain explicit. |
| `/query` | Answer from `FACTS.md`, dictionaries, memory, and cited source docs without mutation. | `@agent`, `@source.body` | `#truth`, `#frontmatter`, `#vcc` | Response cites the owning source or returns a typed gap; no file mutation, token spend, Prod mirror change, or Cloudflare deploy occurs. |
| `/memory.seed` | Create or update a neutral memory block from source docs. | `@source.frontmatter`, `@source.body`, `@operator` | `#frontmatter`, `#no-hardcode`, `#vcc` | Parsed frontmatter and authored body memory block are present locally. |
| `/memory.write` | Add, replace, or remove a bounded memory or user-profile entry. | `@memory-store`, `@memory-entry`, `@memory-policy`, `@operator` | `#persistent-memory`, `#memory-capacity`, `#vcc` | Request names target, action, evidence, old text when replacing/removing, scan result, capacity result, and typed persistence result. |
| `/memory.compact` | Consolidate or remove stale entries when a bounded memory target is near or over capacity. | `@memory-store`, `@memory-policy`, `@runtime-proof` | `#persistent-memory`, `#memory-capacity`, `#vcc` | Compact result preserves durable facts, removes stale or duplicate entries, and returns before/after capacity without silent data loss. |
| `/memory.search` | Search scoped local memory or conversation indexes for reusable facts, decisions, and prior proof. | `@agent`, `@memory-store`, `@operator` | `#memory-search`, `#truth`, `#vcc` | Ranked results cite their source or return an empty typed result; no mutation, deploy, or paid call is implied. |
| `/session.search` | Search past conversations or session records on demand. | `@session-index`, `@operator` | `#session-search`, `#truth`, `#vcc` | Cited session matches return without automatically writing to memory or profile. |
| `/user.profile` | Add, replace, remove, or inspect explicit user-profile entries. | `@user-profile`, `@memory-entry`, `@memory-policy`, `@operator` | `#user-profile`, `#memory-capacity`, `#vcc` | Profile write is explicit, bounded, scanned, non-secret, and rejects unsupported personal inference. |
| `/skill.discover` | List lightweight skill metadata without loading full skill bodies. | `@skill-index`, `@skill-policy`, `@operator` | `#skill-system`, `#progressive-disclosure`, `#agentskills-compatible` | Index returns name, description, category, source, trust, and compatibility with zero model spend. |
| `/skill.load` | Load one selected skill source and optional on-demand resource. | `@skill-source`, `@skill-reference`, `@skill-policy` | `#skill-system`, `#progressive-disclosure`, `#skill-security` | Full skill source loads only after selection; referenced files load only when needed and shallow references validate. |
| `/skill.bundle` | Resolve a bundle that groups existing skills under one invocation. | `@skill-bundle`, `@skill-index`, `@skill-policy` | `#skill-bundle`, `#skill-system`, `#vcc` | Bundle resolves installed skills, reports skipped missing skills, and does not install or hardcode missing entries. |
| `/skill.manage` | Create, patch, edit, delete, or update supporting files for a skill. | `@skill-source`, `@skill-reference`, `@skill-policy`, `@operator` | `#skill-security`, `#skill-evolution`, `#agentskills-compatible` | Managed write is scanned, validated, review-gated when required, and returns a proposed or applied result with proof. |
| `/context.discover` | Discover project-local context files from the active working directory. | `@working-directory`, `@context-policy` | `#context-file`, `#cwd-discovery`, `#project-context` | Returns first-match startup context plus progressive subdirectory candidates with zero model spend and no file mutation. |
| `/context.load` | Load one approved context file into the behavior context. | `@context-file`, `@context-policy`, `@runtime-proof` | `#context-file`, `#project-context`, `#progressive-disclosure` | File parses as text, scans cleanly, truncates within bounds, and reports loaded or blocked state. |
| `/context.audit` | Inspect context-file precedence, loaded files, truncation, scan blocks, and stale risks. | `@working-directory`, `@context-policy`, `@runtime-proof` | `#context-file`, `#vcc`, `#no-hardcode` | Audit is read-only and reports effective context without rewriting project files or promoting CLAUDE-style files above `FACTS.md`. |
| `/reference.expand` | Expand inline context references from a message into attached context. | `@reference-policy`, `@attached-context`, `@working-directory` | `#context-reference`, `#inline-context`, `#token-economics` | References resolve, sensitive targets block, content stays bounded, and original message plus attached context are returned. |
| `/reference.audit` | Inspect reference expansion safety, size, source, and warning state. | `@reference-policy`, `@attached-context`, `@runtime-proof` | `#context-reference`, `#attached-context`, `#vcc` | Audit reports expanded references, warnings, refused expansions, truncation, and source boundaries without mutating files. |
| `/kanban.task` | Create or update one durable task row in `kanban.md`. | `@kanban-board`, `@task-row`, `@agent-profile`, `@runtime-proof` | `#kanban-board`, `#task-row`, `#multi-agent-collaboration` | Task row validates through shared multi-dimensional table/Kanban utilities and records owner, status, evidence, and next action. |
| `/kanban.handoff` | Add a readable handoff row for another named profile or worker process. | `@kanban-board`, `@handoff-row`, `@worker-process`, `@agent-profile` | `#profile-handoff`, `#worker-process`, `#vcc` | Handoff row names from, to, task id, context refs, blockers, acceptance, and resume command without in-process subagent state. |
| `/kanban.sync` | Reconcile board rows across named agent profiles without spawning fragile subagent swarms. | `@kanban-board`, `@agent-profile`, `@runtime-proof` | `#kanban-board`, `#multi-agent-collaboration`, `#no-hardcode` | Sync is row-based, conflict-aware, and preserves `kanban.md` as the durable SSOT. |
| `/tool.catalog` | Read available tool categories, routing providers, status, and unavailable states. | `@tool-gateway`, `@tool-provider`, `@tool-policy` | `#tool-gateway`, `#tool-routing`, `#cost` | Catalog returns web search, image, TTS, and browser routing states with zero model spend and no tool execution. |
| `/tool.route` | Route one tool call through the selected `knowgrph` tool surface. | `@tool-gateway`, `@tool-provider`, `@tool-policy`, `@cost-log` | `#tool-gateway`, `#tool-routing`, `#vcc` | Tool input validates, approval gates pass, cost is logged, and fallback is typed before execution. |
| `/tool.provider.select` | Select gateway, direct, local, or unavailable provider state per tool category. | `@tool-provider`, `@tool-policy`, `@operator` | `#tool-routing`, `#approval-gate`, `#no-hardcode` | Non-secret routing preference is stored or rejected; credentials remain server-managed. |
| `/tool.gateway.audit` | Inspect routing, usage, cost, egress, approval, and deploy boundary state. | `@tool-gateway`, `@tool-provider`, `@cost-log`, `@runtime-proof` | `#tool-gateway`, `#token-economics`, `#vcc` | Audit reports per-tool status and blocked reasons without executing tool calls. |
| `/toolset.enable` | Enable a logical toolset for one platform surface. | `@toolset`, `@platform-surface`, `@tool-policy`, `@operator` | `#toolset`, `#platform-toolset`, `#approval-gate` | Toolset resolves existing tool functions, platform scope is explicit, approvals pass, and enablement state is typed. |
| `/toolset.disable` | Disable a logical toolset for one platform surface. | `@toolset`, `@platform-surface`, `@tool-policy` | `#toolset`, `#platform-toolset`, `#vcc` | Platform-scoped toolset is disabled without deleting functions, credentials, history, or unrelated provider state. |
| `/tool.search` | Search the session-scoped deferred-tool catalog. | `@deferred-tool-catalog`, `@tool-policy` | `#tool-search`, `#progressive-disclosure`, `#token-economics` | Returns ranked deferred tool metadata or a typed empty/disabled result without loading full schemas or executing tools. |
| `/tool.describe` | Load one deferred tool schema on demand. | `@deferred-tool-catalog`, `@tool-policy` | `#deferred-tool-schema`, `#tool-search`, `#vcc` | Selected tool schema resolves from the current session catalog or returns a stale, missing, or policy-blocked result. |
| `/tool.call` | Invoke a selected deferred tool through a bridge route. | `@bridge-tool`, `@tool-function`, `@tool-policy`, `@cost-log` | `#bridge-tool`, `#tool-routing`, `#approval-gate` | Call unwraps to the underlying tool identity for schema validation, approval, hooks, audit, cost, and fallback. |
| `/experience.capture` | Convert an observed run, failure, proof packet, or operator correction into a typed experience record. | `@experience`, `@source.body`, `@runtime-proof` | `#learning-loop`, `#vcc`, `#no-hardcode` | Experience record names source, lesson, applicability, cost, expiry risk, and approval state before persistence. |
| `/skill.propose` | Propose a new reusable skill from repeated experience without directly modifying runtime code. | `@experience`, `@skill-catalog`, `@operator` | `#skill-evolution`, `#harness`, `#vcc` | Proposal includes intent, schemas, bounds, cost fields, source evidence, and review status. |
| `/skill.evolve` | Improve an existing skill through bounded evaluation and human-reviewed diff proposal. | `@skill-catalog`, `@runtime-proof`, `@operator` | `#skill-evolution`, `#vcc`, `#approval-gate` | Evaluation packet, focused checks, semantic-preservation note, and proposed diff are present; no direct auto-commit occurs. |
| `/identity.reflect` | Update the local identity model from stable operator preferences, project boundaries, and working rules. | `@identity-model`, `@operator`, `@memory-store` | `#identity-model`, `#truth`, `#no-hardcode` | Reflection stores stable, non-secret, source-backed preferences or returns rejected inference reasons. |
| `/orchestration.graph` | Declare or validate a stateful agent orchestration graph without importing an external graph runtime. | `@orchestration-graph`, `@state-store`, `@runtime-proof` | `#orchestration-graph`, `#stateful-agent`, `#vcc` | Graph contract names state schema, node ids, edge rules, compile checks, stop conditions, and proof. |
| `/state.checkpoint` | Define checkpoint, resume, recovery, and idempotency behavior for long-running runs. | `@checkpoint-store`, `@state-store`, `@runtime-proof` | `#durable-execution`, `#stateful-agent`, `#vcc` | Checkpoint contract names scope, storage owner, resume token, retry policy, and recovery proof. |
| `/human.review` | Interrupt a run for operator inspection, edit, approval, rejection, and resume. | `@human-review`, `@operator`, `@approval-gate` | `#human-in-loop`, `#approval-gate`, `#vcc` | Run remains paused until review result is present; resume payload and audit event are typed. |
| `/stream.trace` | Surface execution progress, state transitions, cost, and stop events as a typed trace. | `@runtime-proof`, `@cost-log`, `@orchestration-graph` | `#durable-execution`, `#token-economics`, `#vcc` | Trace events are ordered, bounded, secret-free, and do not mutate source state. |
| `/superagent.run` | Run a long-horizon research, coding, or creation workflow through source-backed orchestration. | `@orchestration-graph`, `@sandbox-workspace`, `@message-gateway`, `@runtime-proof` | `#long-horizon-harness`, `#sandboxed-workspace`, `#message-gateway`, `#token-economics` | Goal, tools, skills, memory reads, sandbox scope, message handoffs, checkpoints, stop conditions, artifacts, verification, and cost ledger are typed before promotion. |
| `/sandbox.policy.validate` | Compile and audit one source-backed native sandbox policy without executing an operation. | `@sandbox-policy`, `@runtime-proof` | `#agent-sandbox-policy`, `#sandboxed-workspace`, `#no-hardcode` | Schema, policy digest, fail-closed defaults, domain mutability, and host-enforcement gap are returned. |
| `/sandbox.policy.authorize` | Return one fail-closed preflight decision for a filesystem, process, network, or credential operation. | `@sandbox-policy`, `@sandbox-workspace`, `@runtime-proof` | `#agent-sandbox-policy`, `#sandboxed-workspace`, `#vcc` | Decision, reason code, matched rule where applicable, redacted audit metadata, and enforcement status are returned without execution. |
| `/prd-tad.create` | Produce or refresh a combined PRD/TAD from validated problem and architecture context. | `@operator`, `@source.body` | `#tco`, `#ttv`, `#vcc`, `#foss` | PRD/TAD includes personas, MoSCoW, topology, harness, ADR, and VCC sections. |
| `/runtime-ready.check` | Verify whether a spec-complete artifact is runnable. | `@local-harness`, `@runtime-proof` | `#harness`, `#vcc`, `#runtime-ready` | Focused checks exit 0 and cost/deploy boundaries are surfaced. |
| `/session.start` | Start one conflict-safe Codex build lane from current remote state. | `@operator`, `@working-directory`, `@runtime-proof` | `#multi-agent-collaboration`, `#runtime-ready`, `#vcc` | Remote refs are fetched, each repository has exactly one registered worktree, ownership is unique, and the canonical Knowgrph checkout activates a clean `agent/<device>/<semantic-scope>` branch from the recorded `origin/main` SHA without Prod or Cloudflare mutation. |
| `/release.complete` | Execute the bounded Knowgrph Dev-to-Prod-to-Cloudflare release workflow. | `@operator`, `@source.frontmatter`, `@runtime-proof` | `#runtime-ready`, `#multi-agent-collaboration`, `#vcc` | Unique ownership, protected integration, mirror parity, deployment evidence, and both production-route probes pass for one promoted SHA. |
| `/deploy.guard` | Stop accidental Prod mirror or Cloudflare mutation. | `@operator`, `@dev-only` | `#no-deploy`, `#approval-gate` | Output states Dev-only status and no Prod/Cloudflare mutation occurred. |
| `/harness.define` | Define typed input, output, fallback, cost, and bounds for an AI-capable component. | `@local-harness`, `@cost-log` | `#harness`, `#token-economics`, `#vcc` | Harness contract includes schemas, cost fields, fallback paths, and max iteration. |
| `/mcp.capabilities` | Discover tool capabilities through the existing MCP gateway contract. | `@mcp-gateway`, `@local-harness` | `#mcp`, `#runtime-ready`, `#cost` | Capability list is deduplicated and discovery reports zero model spend. |
| `/cost.audit` | Inspect token, cache, and TCO impact before running a model-bearing path. | `@cost-log`, `@operator` | `#token-economics`, `#tco`, `#foss` | Cost log fields are present and budget breach blocks before spend. |
| `/canvas.project` | Project source-backed runtime state into existing Canvas owners. | `@source.frontmatter`, `@source.body`, `@canvas` | `#canvas`, `#frontmatter`, `#runtime-ready` | Source-backed graph, table, or Storyboard surface renders without dashboard-only storage. |
| `/canvas.render` | Inspect or trigger projection through existing Canvas render owners without mutating source graph data. | `@canvas`, `@source.frontmatter`, `@runtime-proof` | `#canvas`, `#runtime-ready`, `#vcc` | Canvas projection reports rendered graph, table, KGC, or Storyboard state without direct store mutation. |
| `/canvas.node.add` | Create a graph node through existing Canvas owners at the resolved insertion point. | `@canvas`, `@canvas-center`, `@source.frontmatter` | `#canvas-node`, `#canvas-selection`, `#vcc` | Node creation uses shared graph mutation utilities, selects the committed node, and reports the resolved graph-space point. |
| `/canvas.node.link` | Start or commit a node-to-node connection through the shared Canvas edge request flow. | `@canvas`, `@selected-node`, `@edge-endpoint` | `#canvas-node`, `#canvas-edge`, `#vcc` | Edge request names source, target, label, and selection state; missing endpoint returns a typed pending-edge state. |
| `/canvas.selection.open` | Open the selected node or edge in the shared side panel, tab, editor, or Markdown provenance surface. | `@selected-node` or `@selected-edge`, `@markdown-provenance` when source opening is requested | `#canvas-selection`, `#canvas-node`, `#canvas-edge` | Open action resolves an implemented surface or returns a typed missing-selection/provenance result without adding a local panel alias. |
| `/canvas.selection.chat` | Append selected node or edge context to FloatingPanel Chat through the existing chat append route. | `@selected-node` or `@selected-edge`, `@canvas` | `#canvas-selection`, `#inline-context`, `#vcc` | Chat receives typed selection context with id, label, type, properties, and source provenance when present. |
| `/canvas.selection.delete` | Request deletion of the selected Canvas record through the shared graph mutation owner. | `@selected-node` or `@selected-edge`, `@approval-gate` when required | `#canvas-selection`, `#canvas-node`, `#canvas-edge` | Deletion fails closed without a valid selection, preserves graph consistency, and returns mutation proof from the shared owner. |
| `/canvas.media.attach` | Add or update selected-node media metadata through the shared media property owner. | `@selected-node`, `@media-url`, `@canvas` | `#canvas-media`, `#canvas-node`, `#no-hardcode` | Media metadata validates kind, URL/reference, opacity, and interactivity before updating the node or creating a media node through shared utilities. |
| `/canvas.layout.tune` | Tune or reset schema-owned Canvas layout mode and forces through the graph schema owner. | `@layout-forces`, `@physics-2d`, `@canvas`, `@runtime-proof` | `#canvas-layout`, `#canvas-physics`, `#canvas`, `#vcc` | Layout mode and force values are stored in schema layout state, with reset/preset behavior reported from the schema owner. |
| `/canvas.viewport.inspect` | Read the current viewport size, zoom, center, and transform through shared zoom/projection owners. | `@viewport-readout`, `@viewport-transform`, `@canvas` | `#canvas-viewport`, `#canvas-transform`, `#vcc` | Readout reports viewport dimensions, zoom percent, center, scale, and translation from shared viewport utilities without panel-local recalculation. |
| `/canvas.viewport.transform` | Apply or audit viewport transform, zoom modes, wheel behavior, and speed tuning through shared camera owners. | `@viewport-transform`, `@zoom-mode`, `@wheel-input`, `@interaction-speed`, `@canvas` | `#canvas-viewport`, `#canvas-transform`, `#canvas-zoom`, `#canvas-wheel` | Transform or audit result names the active shared camera owner, clamp bounds, gesture policy, and applied or blocked state. |
| `/camera.frame` | Frame the shared Camera around the active camera or selected actor. | `@camera`, optionally `@selected-actor` | `#camera`, `#camera-shot` | Angle, level, shot size, and focal length resolve through the shared Camera framing owner and report the applied pose. |
| `/camera.animate` | Add or update a camera motion mark on the canonical BottomPanel Timeline. | `@camera`, optionally `@selected-actor` | `#camera`, `#camera-motion` | Rig and time parameters validate before one shared XR camera track is updated; no FloatingPanel timeline copy is created. |
| `/camera.play` | Play or pause the shared camera motion track. | `@camera` | `#camera`, `#camera-motion` | Playback state routes through the canonical Timeline transport and shared XR runtime. |
| `/camera.scrub` | Move the shared camera motion playhead to a bounded time. | `@camera` | `#camera`, `#camera-motion` | The requested time clamps to scene duration and updates the canonical Timeline transport without duplicating transport state. |
| `/canvas.interaction.tune` | Tune pointer mode, run mode, drag alpha target, and flow interaction behavior through existing canvas owners. | `@flow-run-mode`, `@drag-alpha-target`, `@interaction-speed`, `@canvas` | `#canvas-interaction`, `#canvas-flow`, `#canvas-wheel`, `#vcc` | Interaction update resolves existing toolbar, store, and Flow owners; missing support returns typed unsupported state without a floating-panel alias. |
| `/canvas.physics.tune` | Tune or reset schema-owned 2D physics forces without keeping panel-local slider state. | `@physics-2d`, `@layout-forces`, `@canvas`, `@runtime-proof` | `#canvas-physics`, `#canvas-layout`, `#vcc` | Charge, collision, speed, overlap, label, and drag-force values clamp through the schema owner and report applied, reset, or blocked state. |
| `/canvas.center` | Center the viewport on the active selection or all items through shared arrange and centroid utilities. | `@centroid-target`, `@selected-node` when scoped to selection, `@canvas` | `#canvas-centroid`, `#canvas-selection`, `#vcc` | Centering resolves selection or all-items scope, dispatches through shared arrange utilities, and reports a typed missing-selection result when needed. |
| `/canvas.distribute` | Distribute selected canvas items along an axis through shared arrange utilities. | `@spread-axis`, `@selected-node`, `@canvas` | `#canvas-even-spread`, `#canvas-selection`, `#vcc` | Distribution validates at least three selected items, axis, and graph state before mutation; invalid scope fails closed. |
| `/canvas.performance.audit` | Inspect render updates, state updates, layout timing, and performance overlay state through diagnostic owners. | `@performance-overlay`, `@runtime-proof`, `@canvas` | `#canvas-performance`, `#canvas-viewport`, `#vcc` | Diagnostic output reports overlay state, render/update counters, and layout timing from shared diagnostic owners without creating a panel-local monitor. |
| `/canvas.edge.rewire` | Update selected-edge source or target through the existing Canvas edge request flow. | `@selected-edge`, `@edge-endpoint`, `@canvas` | `#canvas-edge`, `#canvas-selection`, `#vcc` | Rewire validates endpoint existence, updates the selected edge through the shared flow, and avoids duplicate edge ownership. |
| `/validation.run` | Run focused checks for the touched docs or runtime owner. | `@runtime-proof`, `@dev-only` | `#vcc`, `#no-hardcode`, `#runtime-ready` | Final response includes command, result, skipped checks, and deploy-boundary statement. |
| `/workspace.review` | Review current workspace context, sources, memory, bindings, and blockers before execution. | `@operator`, `@source.body`, `@runtime-proof` | `#frontmatter`, `#vcc`, `#dev-only` | Typed context packet names ready inputs, missing bindings, stale risks, and the smallest high-ROI next action. |
| `/pipeline.trace` | Trace source ingestion, parsing, render projection, harness state, and cost boundaries. | `@runtime-proof`, `@cost-log`, `@local-harness` | `#harness`, `#cost`, `#vcc` | Stage ledger names status, cache reuse, fallback, cost state, and stop condition for each pipeline stage. |
| `/source.ingest` | Inspect or run source intake through existing Source Files and workspace owners. | `@operator`, `@source.body`, `@dev-only` | `#frontmatter`, `#no-hardcode`, `#dev-only` | Source intake is registered, rejected, or blocked with provenance and no generated-artifact backfill. |
| `/source.parse` | Parse current source frontmatter and body into normalized graph, table, KTV, or KGC context. | `@source.frontmatter`, `@source.body`, `@runtime-proof` | `#frontmatter`, `#runtime-ready`, `#vcc` | Parse result succeeds without repair-only fallback or returns a typed parse error before model spend. |
| `/source.normalize` | Neutralize conflicting or stale source content at the upstream document or shared owner. | `@source.frontmatter`, `@source.body` | `#no-hardcode`, `#frontmatter`, `#no-legacy` | Stale, duplicate, or hardcoded content is removed at source without downstream aliasing. |
| `/ingest-url` | Ingest an operator-provided URL through the approved URL intake and source-file pipeline. | `@operator`, `@approval-gate`, `@dev-only` | `#no-hardcode`, `#approval-gate`, `#dev-only` | URL is accepted, fetched, or rejected through the shared intake path without writing the URL into source docs. |
| `/computing-flow` | Generate or validate a source-backed KGC computing-flow DAG. | `@operator`, `@source.frontmatter`, `@local-harness`, `@runtime-proof` | `#computing-flow`, `#frontmatter`, `#harness`, `#vcc` | `kgc-computing-flow/v1` frontmatter validates and routes through KGC validation before Canvas projection. |
| Bare `/moa` | Return usage for the MoA route. | `@agent` | `#mixture-of-agents` | Usage response explains required query or scoped selection; it does not switch model, mutate state, or call a provider. |

## Command Shape

```yaml
command:
  token: "/runtime-ready.check"
  role: "command route"
  input:
    source_ref: "@source.frontmatter"
    semantic_filters: ["#harness", "#vcc"]
  output:
    status: "runtime-ready | spec-complete | gated | blocked"
    proof_ref: "@runtime-proof"
  bounds:
    max_iterations: 1
    fail_before_spend: true
```

## Resolution Rules

| Situation | Resolution |
|---|---|
| Command is known and bindings are present | Route through the existing shared utility or runtime owner. |
| Command is known but binding is missing | Return a structured missing-binding response. |
| `/soul.load` finds missing, empty, unsafe, or unreadable source | Return typed fallback identity state; do not silently embed a hardcoded default. |
| `/personality.overlay` conflicts with facts, safety, or deploy gates | Reject the overlay before prompt assembly. |
| `/memory.write` or `/user.profile` exceeds capacity | Return typed capacity error and require `/memory.compact`, replace, or remove before retry. |
| `/session.search` finds relevant history | Return cited search results; require explicit `/memory.write` or `/user.profile` before persistence. |
| `/skill.load` references a supporting file | Load only the named shallow file under the selected skill root; reject deep or unsafe references. |
| `/skill.manage` would mutate a skill under approval policy | Stage or return review-required before writing; never auto-commit protected skill changes. |
| `/context.discover` finds several project context types | Apply one local precedence rule and report skipped matches; do not merge duplicate instruction layers. |
| `/context.load` finds prompt injection, secrets, invisible controls, or exfiltration content | Block before inclusion and return a typed blocked-context result. |
| `/context.audit` finds stale or conflicting project context | Report the conflict and fix the source file or shared owner; do not add a downstream remap. |
| `/reference.expand` targets sensitive, binary, missing, outside-workspace, or over-hard-limit content | Append typed warning or refuse expansion before injecting content. |
| `/reference.expand` runs on a platform that does not support inline expansion | Preserve the raw message and report unsupported-platform without rewriting the text. |
| `/kanban.task` or `/kanban.handoff` lacks a row id, owner profile, status, or acceptance field | Reject before write; do not create partial board rows. |
| `/kanban.sync` sees conflicting writes to the same row | Preserve both evidence fields and require explicit resolution; do not overwrite another profile's handoff. |
| `/tool.route` targets a paid, mutating, browser-auth, egress, or generated-media tool | Require `@operator` approval and fail closed without approval. |
| `/tool.provider.select` includes credentials or browser secrets | Reject and require server-managed secret setup; do not write secrets into docs or client state. |
| `/toolset.enable` would expose paid, mutating, browser-auth, egress, filesystem, terminal, or generated-media tools | Require `@operator` approval and scoped `@platform-surface`; fail closed without both. |
| `/tool.search` is enabled without a current deferred catalog | Return no-deferred-catalog; do not scan global tool registries. |
| `/tool.describe` targets a tool outside the session catalog | Return unavailable-for-session before schema disclosure. |
| `/tool.call` lacks described schema or real tool policy | Block before execution; never treat the bridge as approval. |
| `/moa` references an MoA preset as aggregator | Reject with a typed recursion error before token spend. |
| `/superagent.run` lacks sandbox scope, message gateway, checkpoint policy, or stop condition | Reject before execution; do not start an open-ended agent loop. |
| Command requires paid, mutating, payment, Prod, or Cloudflare action | Require `@operator` approval and fail closed without approval. |
| Command conflicts with source frontmatter | Fix the source or shared owner; do not add a downstream alias. |
| Command is unknown | Reject with a typed unsupported-command result and suggest nearest dictionary entries. |

## Direct Facts Link

| Token | Facts source |
|---|---|
| `/soul.load` | `FACTS.md` direct-resolution entry for durable identity loading. |
| `/personality.overlay` | `FACTS.md` direct-resolution entry for temporary personality overlays. |
| `/moa` | `FACTS.md` direct-resolution entry for one-shot Mixture of Agents routing. |
| `/knowgrph.probe-tree` | `FACTS.md` direct-resolution entry for bounded Widget Card Probe-Tree generation. |
| `/memory.write` | `FACTS.md` direct-resolution entry for bounded memory writes. |
| `/user.profile` | `FACTS.md` direct-resolution entry for explicit user profile updates. |
| `/skill.discover` | `FACTS.md` direct-resolution entry for progressive skill discovery. |
| `/skill.load` | `FACTS.md` direct-resolution entry for on-demand skill loading. |
| `/context.discover` | `FACTS.md` direct-resolution entry for working-directory context discovery. |
| `/context.load` | `FACTS.md` direct-resolution entry for scanned context-file loading. |
| `/context.audit` | `FACTS.md` direct-resolution entry for context-file precedence and safety audit. |
| `/reference.expand` | `FACTS.md` direct-resolution entry for inline context reference expansion. |
| `/reference.audit` | `FACTS.md` direct-resolution entry for context reference safety and size audit. |
| `/kanban.task` | `FACTS.md` direct-resolution entry for durable Kanban task rows. |
| `/kanban.handoff` | `FACTS.md` direct-resolution entry for profile handoff rows. |
| `/kanban.sync` | `FACTS.md` direct-resolution entry for shared board reconciliation. |
| `/tool.catalog` | `FACTS.md` direct-resolution entry for tool gateway discovery. |
| `/tool.route` | `FACTS.md` direct-resolution entry for per-tool routing. |
| `/toolset.enable` | `FACTS.md` direct-resolution entry for platform-scoped toolset enablement. |
| `/toolset.disable` | `FACTS.md` direct-resolution entry for platform-scoped toolset disablement. |
| `/tool.search` | `FACTS.md` direct-resolution entry for session-scoped deferred tool search. |
| `/tool.describe` | `FACTS.md` direct-resolution entry for on-demand deferred tool schema loading. |
| `/tool.call` | `FACTS.md` direct-resolution entry for bridge-routed deferred tool execution. |
| `/query` | `FACTS.md` direct-resolution entry for source-backed read-only answers. |

## VCCs

| VCC | Check |
|---|---|
| Dictionary parses | Frontmatter parses as YAML and `dictionary_entries` lists slash-prefixed tokens. |
| No duplicate runtime | No body section claims a new parser, command server, or provider panel. |
| Fail-closed command path | Every command row names required bindings and a measurable completion signal. |
| Deploy boundary preserved | `/deploy.guard` remains Dev-only unless explicit operator approval is present. |
