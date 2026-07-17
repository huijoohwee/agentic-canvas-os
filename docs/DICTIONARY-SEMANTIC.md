---
title: "Agentic OS Semantic Dictionary"
graphId: "md:agentic-os-dictionary-semantic"
doc_type: "Invocation Dictionary"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-os-dictionary-semantic/v1"
frontmatter_contract: "required"
status: "runtime-ready"
prefix: "#"
prefix_role: "semantic filter or topic route"
source_docs:
  - "FACTS.md"
  - "MEMORY.md"
  - "AGENTS.md"
  - "PRD-TAD.md"
  - "RUNTIME-READINESS.md"
  - "HARNESS-CONTRACTS.md"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "dictionary content for shared hash invocation utilities; no separate semantic registry"
runtime_proof: "RUNTIME-PROOF.md"
metadata_consumers:
  - id: "chat_composer"
    surface: "FloatingPanel Chat composer"
    owner: "knowgrph/canvas/src/features/chat/floatingPanelChat/FloatingPanelChatComposer.tsx"
    metadata_fields: ["token", "label", "summary", "group", "sourcePath", "keywords", "prefix_role"]
    behavior: "inline keyword-menu insertion; preserve query text after the invocation token"
  - id: "skills_commands_catalog"
    surface: "FloatingPanel Skills & Commands catalog"
    owner: "knowgrph/canvas/src/features/panels/views/SkillsCommandsView.tsx"
    metadata_fields: ["token", "label", "summary", "group", "sourcePath", "keywords", "prefix_role"]
    behavior: "searchable catalog row and active-card token insertion"
  - id: "mcp"
    surface: "MCP capability metadata"
    owner: "knowgrph/mcp/local-tool-contract.js"
    metadata_fields: ["token", "prefix", "meaning", "match_when", "required_proof", "publish_policy", "source_docs"]
    behavior: "reference and filter metadata only; no standalone MCP tool execution"
entry_metadata_contract:
  token: "dictionary_entries item and first Tags table column"
  label: "runtime mirror derives a concise display label from the token"
  summary: "Tags table Meaning column"
  group: "Agentic OS semantic dictionary"
  sourcePath: "this dictionary document"
  keywords: "token parts plus Meaning, Match when, and Required proof text"
  mcp: "MCP consumers may expose semantic filters as metadata for routing and audit, but must not treat a tag as approval or execution"
dictionary_entries:
  - "#truth"
  - "#soul"
  - "#primary-identity"
  - "#personality-overlay"
  - "#mixture-of-agents"
  - "#reference-agents"
  - "#aggregator-agent"
  - "#frontmatter"
  - "#harness"
  - "#token-economics"
  - "#spec.low"
  - "#spec.medium"
  - "#spec.high"
  - "#thinking.type.enabled"
  - "#thinking.type.disabled"
  - "#thinking.type.auto"
  - "#token-cap.low"
  - "#token-cap.medium"
  - "#token-cap.high"
  - "#tco"
  - "#vcc"
  - "#no-hardcode"
  - "#foss"
  - "#ttv"
  - "#runtime-ready"
  - "#dev-only"
  - "#mcp"
  - "#canvas"
  - "#canvas-node"
  - "#canvas-edge"
  - "#canvas-media"
  - "#canvas-layout"
  - "#canvas-selection"
  - "#canvas-viewport"
  - "#camera"
  - "#camera-shot"
  - "#camera-motion"
  - "#character-motion"
  - "#action-path"
  - "#canvas-transform"
  - "#canvas-zoom"
  - "#canvas-wheel"
  - "#canvas-interaction"
  - "#canvas-flow"
  - "#canvas-physics"
  - "#canvas-centroid"
  - "#canvas-even-spread"
  - "#canvas-performance"
  - "#cost"
  - "#approval-gate"
  - "#no-legacy"
  - "#computing-flow"
  - "#learning-loop"
  - "#persistent-memory"
  - "#user-profile"
  - "#frozen-snapshot"
  - "#memory-capacity"
  - "#session-search"
  - "#skill-system"
  - "#instruction-audit"
  - "#image-to-threejs"
  - "#image-to-glb"
  - "#knowgrph.probe-tree"
  - "#progressive-disclosure"
  - "#skill-bundle"
  - "#agentskills-compatible"
  - "#skill-security"
  - "#context-file"
  - "#project-context"
  - "#cwd-discovery"
  - "#context-reference"
  - "#inline-context"
  - "#attached-context"
  - "#kanban-board"
  - "#task-row"
  - "#profile-handoff"
  - "#worker-process"
  - "#multi-agent-collaboration"
  - "#tool-gateway"
  - "#tool-routing"
  - "#tool-function"
  - "#toolset"
  - "#platform-toolset"
  - "#tool-search"
  - "#deferred-tool-schema"
  - "#bridge-tool"
  - "#web-search"
  - "#image-generation"
  - "#text-to-speech"
  - "#cloud-browser"
  - "#skill-evolution"
  - "#memory-search"
  - "#identity-model"
  - "#orchestration-graph"
  - "#stateful-agent"
  - "#durable-execution"
  - "#human-in-loop"
  - "#long-horizon-harness"
  - "#sandboxed-workspace"
  - "#agent-sandbox-policy"
  - "#message-gateway"
---

# Semantic Dictionary

This file defines `#` semantic-route content for Agentic Canvas OS docs. Tags classify intent, risk, and proof requirements. They do not create duplicate stores, stale aliases, or model prompts by themselves.

## Contract

| Rule | Requirement |
|---|---|
| Route owner | Existing shared `#` utilities own tag detection and routing. |
| Dictionary role | This file names semantic meaning, match criteria, and required proof. |
| Runtime status | Spec-complete until a source-backed runtime check proves the claim. |
| Cost policy | Semantic filtering is zero-spend unless an approved harness explicitly runs. |
| Drift policy | Conflicting tag usage is neutralized at the source document or shared owner. |

## Consumer Metadata

| Consumer | Metadata read | Source fields | Runtime boundary |
|---|---|---|---|
| Chat composer | Token, label, summary, group, sourcePath, keywords, prefix role. | `dictionary_entries`; Tags table Meaning, Match when, and Required proof. | Inserts the `#` token and preserves the editable query; unknown tags stay raw text. |
| Skills & Commands catalog | Token, label, summary, group, sourcePath, keywords, prefix role. | Same source fields as chat composer. | Renders searchable rows and active-card insertion without copying a panel-local semantic list. |
| MCP | Token, prefix, meaning, match criteria, required proof, publish policy, source docs. | Tags table plus frontmatter policy fields. | Metadata is reference and filter context only; a semantic tag does not authorize tool execution, spend, mutation, or deploy. |

## Tags

| Tag | Meaning | Match when | Required proof |
|---|---|---|---|
| `#truth` | Source-backed fact stable enough for shared agent reuse. | A claim affects routing, precedence, deployment gates, or agent behavior. | Owning source is `FACTS.md`, a `DICTIONARY-*` file, or frontmatter/body source; stale or inferred claims are rejected. |
| `#soul` | Durable agent identity, voice, and communication defaults. | A claim defines who the agent is, how it speaks, or what it avoids stylistically. | `SOUL.md` parses, stays broad and stable, and excludes project operations, file paths, commands, ports, credentials, and deploy approvals. |
| `#primary-identity` | Prompt slot 1 identity replacement. | A runtime assembles a system prompt identity block. | Identity resolves from `@soul-profile` into `@identity-slot`, or returns a typed fallback instead of silent hardcode. |
| `#personality-overlay` | Temporary session-level style or mode overlay. | A session needs a reversible tone or teaching/review mode change. | Overlay is session-scoped, cannot mutate `SOUL.md`, and stays subordinate to facts, safety, approval, and deploy gates. |
| `#mixture-of-agents` | Bounded multi-agent deliberation where references advise and one aggregator acts. | A hard query needs multiple perspectives before a single response or tool plan. | Local preset, reference list, aggregator, token caps, no-recursion rule, cost log, and no-copy boundary are present. |
| `#reference-agents` | Advisory reference calls inside a Mixture of Agents run. | A model or agent produces private analysis for aggregation, not a user-visible final answer. | Calls are no-tool, bounded by max tokens and timeout, scoped to trimmed context, and represented as advisory successes or typed failures. |
| `#aggregator-agent` | Acting agent that produces the final MoA response. | One model or agent consumes advisory context and may call tools through the normal harness. | Aggregator owns visible response, tool schemas, approval gates, transcript persistence, and follow-up iterations. |
| `#frontmatter` | YAML frontmatter identity, routing, render flags, and gates. | A document or source needs parse-first SSOT behavior. | Frontmatter parse succeeds without repair-only fallback. |
| `#harness` | Typed AI or tool execution contract. | A capability invokes a model, tool, workflow, or bounded agent. | Input schema, output schema, fallback, cost log, and bounds are present. |
| `#token-economics` | Prompt, completion, cache, latency, and spend performance. | A workflow can spend tokens or repeat calls. | Cost fields include model, token counts, cache hits, and estimated cost. |
| `#spec.low` | Cost-bounded generation specification. | A video-agent request prefers the minimum viable generation quality and breadth. | The invocation resolves exactly one specification, reports `low`, and keeps provider spend and artifact scope bounded. |
| `#spec.medium` | Balanced generation specification. | A video-agent request needs more fidelity or coverage than the low profile. | The invocation resolves exactly one specification, reports `medium`, and applies the provider-neutral balanced profile. |
| `#spec.high` | Highest configured generation specification. | An approved video-agent request prioritizes maximum configured fidelity. | The invocation resolves exactly one specification, reports `high`, and blocks before spend when capability or budget cannot satisfy it. |
| `#thinking.type.enabled` | Always enable supported model reasoning for this invocation. | A model-bearing stage requires deliberate reasoning before its visible result. | The provider request carries `thinking.type: enabled`; unsupported models or endpoints fail closed instead of silently disabling it. |
| `#thinking.type.disabled` | Disable model reasoning for this invocation. | A direct-answer stage explicitly prefers latency and visible-output budget over reasoning. | The provider request carries `thinking.type: disabled` and does not send incompatible non-minimal reasoning effort. |
| `#thinking.type.auto` | Let a supported model decide whether reasoning is needed. | The operator prefers adaptive depth rather than always-on or always-off reasoning. | The provider request carries `thinking.type: auto`; unsupported models or endpoints return a typed capability gap. |
| `#token-cap.low` | Low video-agent reasoning and total completion budget profile. | An invocation prioritizes cost and latency. | Runtime maps the profile to `reasoning_effort: low` and `max_completion_tokens: 4096`, or blocks when the selected model supports less. |
| `#token-cap.medium` | Balanced video-agent reasoning and total completion budget profile; default for the source-backed demo preset. | An invocation needs the complete structured package at a bounded default budget. | Runtime maps the profile to `reasoning_effort: medium` and `max_completion_tokens: 16384`, or blocks when the selected model supports less. |
| `#token-cap.high` | High video-agent reasoning and total completion budget profile. | An explicitly approved invocation needs maximum configured planning depth or output breadth. | Runtime maps the profile to `reasoning_effort: high` and `max_completion_tokens: 32768`, or blocks when entitlement, model capability, or budget is insufficient. |
| `#tco` | Total cost of ownership and deployment-model comparison. | A dependency, provider, cloud service, or new runtime path is proposed. | FOSS or existing-owner alternative and 12-month cost assumption are named. |
| `#vcc` | Verifiable completion conditions. | A claim needs measurable done criteria. | Given-When-Then and VCC text name observable output and a bounded check. |
| `#no-hardcode` | Hardcoded URLs, credentials, provider IDs, generated assets, or fixtures. | A source risks stale or operator-specific data. | Embedded artifact is removed or replaced with neutral source-owned reference. |
| `#foss` | Open-source, local, zero-egress, or vendor-neutral alternative. | A dependency or hosted service is under consideration. | Alternative path is named before paid or proprietary adoption. |
| `#ttv` | Time to value for min-viable-max-value scope. | Scope needs prioritization or a feature could become broad. | Must/Should/Could/Won't or equivalent ROI cut is present. |
| `#runtime-ready` | Claim can be proven from surfaced runtime output. | A spec-complete artifact is being promoted. | Parse, route, schema, cost, bound, approval, and focused validation proof are surfaced. |
| `#dev-only` | Local development boundary. | Work must stop before Prod mirror or Cloudflare. | Status shows no Prod mirror mutation and no Cloudflare deploy command. |
| `#mcp` | MCP discovery, gateway federation, or tool contract. | A capability is exposed to local, Pages, browser, or control-plane agents. | Tool IDs dedupe and discovery reports zero model spend. |
| `#canvas` | Source-backed Canvas projection. | Runtime state must render as graph, table, KGC, or Storyboard surface. | Existing Canvas owners render without dashboard-only storage. |
| `#canvas-node` | Canvas graph node selection, creation, opening, linking, or deletion intent. | A command acts on a node, creates a node, or needs selected-node context. | Node id, type, label, graph point, mutation owner, and selection state are explicit. |
| `#canvas-edge` | Canvas graph edge selection, creation, endpoint update, or provenance intent. | A command creates, opens, rewires, or serializes an edge. | Source, target, label, selected edge id, and duplicate-edge handling are explicit. |
| `#canvas-media` | Media metadata, rich media panel, or media-node projection attached to Canvas graph state. | A command updates node media properties or creates media-backed graph state. | Media kind, URL/reference, interactivity, opacity, and shared media owner are present. |
| `#canvas-layout` | Schema-owned Canvas layout force tuning, preset, or reset intent. | A command changes anti-line, post-fit, or layout-force behavior. | Layout values live in graph schema state and focused proof reports the applied or reset values. |
| `#canvas-selection` | Current Canvas node or edge selection used as the active invocation subject. | A command needs the active node/edge rather than a global panel-local target. | Selection source, selected id, and missing-selection behavior are typed before mutation or chat append. |
| `#canvas-viewport` | Viewport readout, visible bounds, center point, or active camera state. | A command inspects or changes visible canvas position, dimensions, or center. | Readout is derived from shared viewport utilities and reports missing viewport state as typed empty output. |
| `#camera` | Shared Camera framing and motion runtime across 2D, 3D, and XR surface modes. | A command inspects, frames, animates, plays, or scrubs the Camera. | One application runtime owns Camera state; FloatingPanel projects controls and BottomPanel Timeline owns motion transport. |
| `#camera-shot` | Camera angle, level, shot size, and focal-length framing parameters. | `/camera.frame` changes composition around the selected subject. | Parameters validate against shared Camera framing options and return the exact applied pose. |
| `#camera-motion` | Camera rig, numbered camera marks, playhead, duration, and playback state. | `/camera.animate`, `/camera.play`, or `/camera.scrub` controls choreography. | Rig and time values update one canonical XR camera track and BottomPanel Timeline transport with bounded runtime proof. |
| `#character-motion` | Native procedural performance applied to an XR cast track, such as fight, dance, sit, drink, jump, playing cards, or squirt-gun action. | `/animation.control` applies or clears a typed character-motion preset for the selected actor. | Preset id, compatible subject category, deterministic pose sampling, timing, persistence, and package export are proven through the shared XR runtime without external animation assets. |
| `#action-path` | Native meter-based trajectory applied to an XR cast track, such as plane landing, helicopter orbit, car chase, or collapsing debris. | `/animation.control` applies or clears a typed action-path preset for the selected actor. | Bounded marks, altitude, facing, timing, deterministic sampling, persistence, and package export are proven through the shared XR runtime without a second path or timeline owner. |
| `#canvas-transform` | Zoom scale and screen-space translation for the active canvas viewport. | A command inspects, applies, clamps, or audits the zoom transform. | Transform values resolve through shared zoom/projection owners, not a floating-panel recalculation. |
| `#canvas-zoom` | Zoom mode, zoom speed, fit-to-screen, or zoom-to-selection behavior. | A request changes or audits zoom modes, bounds, duration, or selection fitting. | Mode, duration, and scale bounds are read from existing store/schema owners and fail closed on unsupported renderer state. |
| `#canvas-wheel` | Wheel or trackpad gesture routing, speed, modifier boost, or overlay proxy behavior. | A request changes or audits wheel input, trackpad input, or overlay wheel routing. | Gesture policy names the current shared owner and preserves overlay guard behavior. |
| `#canvas-interaction` | Pointer mode, run mode, interaction speed, drag behavior, or Flow input behavior. | A command changes user-input behavior rather than graph source content. | Existing toolbar/store owners handle mutation; unsupported changes return typed blocked state. |
| `#canvas-flow` | Flow renderer wheel, selection, and overlay interaction behavior inside canvas surfaces. | A request affects Flow canvas input, selection-on-drag, or overlay wheel proxy state. | Flow behavior stays renderer-owned and does not create duplicate floating-panel state. |
| `#canvas-physics` | Schema-owned 2D physics force, velocity, overlap, label, and drag tuning. | A command changes charge, collision, speed, overlap, label nudge, drag charge, or drag distance. | Values clamp through graph schema physics tuning and report applied/reset proof. |
| `#canvas-centroid` | Centroid or center target for selected items, all items, or visible viewport fitting. | A request centers selection, all items, or computes the active centroid target. | Target scope, selection count, and fallback behavior are explicit before arrange dispatch. |
| `#canvas-even-spread` | Even distribution of selected canvas items along a requested axis. | A request distributes selected nodes horizontally or vertically. | At least three selected nodes and a valid axis are required before mutation. |
| `#canvas-performance` | Canvas render diagnostics, state update rate, layout timing, and performance overlay proof. | A request inspects render churn, layout timing, diagnostic overlay state, or perf automation output. | Diagnostic data comes from shared performance owners and remains read-only unless an approved runtime toggles a diagnostic overlay. |
| `#cost` | Cost log and budget accounting. | A path needs budget observability but not full TCO analysis. | Cost log validates and model-free views report exact zero. |
| `#approval-gate` | Human gate for paid, mutating, payment, browser-auth, or deploy action. | A run can spend, mutate, authenticate, pay, or deploy. | Missing approval blocks before spend or mutation. |
| `#no-legacy` | Remove stale aliases, remaps, duplicate owners, and compatibility paths. | A source contains old names, shims, or downstream patches. | Stale path is removed at source; no new alias is added. |
| `#computing-flow` | KGC/frontmatter DAG execution contract. | A document or chat request generates, validates, or runs a computing-flow. | `kgc-computing-flow/v1` frontmatter owns topology, typed inputs, explicit handles, bounded execution, and validation proof. |
| `#learning-loop` | Closed learning cycle from experience capture to reviewed persistence. | A workflow turns run evidence, failures, or operator corrections into reusable memory or skill proposals. | Source evidence, applicability, expiry risk, bounds, approval state, and no-copy statement are present. |
| `#persistent-memory` | Bounded curated memory that persists across sessions. | An entry records environment facts, conventions, lessons, profile preferences, or reusable project context. | Target is explicit, entry is scanned, capacity is checked, duplicate/stale handling is defined, and write result is typed. |
| `#user-profile` | Explicit operator preferences, communication style, and expectations. | A claim belongs to the operator profile rather than agent notes or project rules. | Operator evidence or approval is present; unsupported personal inference, secrets, and sensitive profiling are rejected. |
| `#frozen-snapshot` | Session-start memory/profile prompt snapshot. | A runtime injects memory or profile into prompt context. | Snapshot is captured once at session start; mid-session writes persist but do not mutate the active prompt. |
| `#memory-capacity` | Character/token bound for memory and profile targets. | A write could overflow or a target approaches its limit. | Overflow returns typed error; compaction, replacement, or removal is required before retry. |
| `#session-search` | On-demand search over prior conversations or session records. | A task needs specifics from past conversations that are not in active memory. | Results cite sessions and remain read-only unless explicitly captured. |
| `#skill-system` | On-demand procedural knowledge loaded only when useful. | A task should use a reusable skill, skill variant, or skill source. | Metadata discovery, selected source load, shallow resource loading, and no-copy policy are present. |
| `#instruction-audit` | Structural context discipline for durable guidance and skill catalogs. | Instruction surfaces are added, expanded, consolidated, or promoted. | Required intent, budgets, duplication, progressive disclosure, owner boundaries, zero model cost, and deploy state are reported. |
| `#image-to-threejs` | Native image-source conversion into a typed Three.js render projection. | A selected Card or Widget binds one PNG, JPG, JPEG, or SVG source to `image.to-threejs`. | The shared `imageToThreeJs` contract validates the source, reports zero model cost, and projects one canonical `threejs` render mode or a typed fallback. |
| `#image-to-glb` | Native image-source conversion into a procedural GLB asset contract. | A selected Card or Widget binds one PNG, JPG, JPEG, or SVG source to `image.to-glb`. | The contract accepts procedural JS/TS construction only, logs bounded vision-review passes, exports GLB through the asset pipeline, and rejects baked/serialized geometry or embedded glTF buffers. |
| `#knowgrph.probe-tree` | Bounded Probe-Tree Type 2 generation and continuation from a Widget Card. | A selected or answered child invokes `/knowgrph.probe-tree` with its authored graph identity, canonical numbered multi-select or Other Output, and bounded ancestor lineage. | Each generated card exposes 2-4 context-relevant clarification suggestions plus Other and 2-6 verbatim child-or-lineage anchors; bare focus fragments, stock response content, recalled-exemplar wording, and root-alias ownership fail validation, branches cascade forward without backtracking, pinned coordinates remain authoritative, generation does not reload the page, and depth or approval limits stop visibly before spend. |
| `#progressive-disclosure` | Token-minimizing staged loading. | A large skill or resource tree could waste prompt context. | Metadata loads first; full skill source and resources load only after explicit selection. |
| `#skill-bundle` | Grouped skill invocation. | A recurring task needs several existing skills together. | Bundle resolves existing skills, reports missing skills, and does not install or duplicate registry entries. |
| `#agentskills-compatible` | Open-standard skill file compatibility. | A skill source is authored, inspected, imported, or validated. | Standard frontmatter, concise activation description, Markdown body, optional resources, and validation are present. |
| `#skill-security` | Skill trust, scan, compatibility, and write approval. | A skill is loaded from an external source or modified by an agent. | Unsafe content, secrets, incompatible requirements, copied external artifacts, and unreviewed writes fail closed. |
| `#context-file` | Project-local instruction file that shapes behavior. | A working directory contains AGENTS-style, CLAUDE-style, or editor-rule context. | Discovery, precedence, scan, truncation, and load state are explicit and source-backed. |
| `#project-context` | Behavioral context scoped to a project or subdirectory. | Instructions apply because the agent is operating under a working directory or touched path. | `FACTS.md` remains stronger for this docs folder; context files cannot authorize deploy or override system/operator instructions. |
| `#cwd-discovery` | Working-directory and ancestor/subdirectory context discovery. | Startup or tool-path use may reveal relevant context files. | Each directory is checked at most once per session and missing files produce typed empty results. |
| `#context-reference` | Inline `@` message reference that requests bounded content expansion. | A message contains approved reference forms such as file, folder, diff, staged, git, or URL references. | Reference class, source, scan, size, warning, platform support, and no-copy boundary are explicit. |
| `#inline-context` | Content injected into the effective message before model or tool execution. | A supported surface expands a valid context reference. | Original text remains traceable, expansion is bounded, and unsupported surfaces preserve raw text. |
| `#attached-context` | Appended context packet produced by reference expansion. | Expanded content is attached to a request. | Packet carries reference token, source, size, truncation, warning, refusal, and cost posture metadata. |
| `#kanban-board` | Durable Markdown task board shared across named profiles. | Work coordination should persist beyond one process, chat, or model run. | `kanban.md` rows parse through shared multi-dimensional table/Kanban utilities and remain Dev-only unless approved. |
| `#task-row` | One durable work item row. | A task needs owner, status, priority, evidence, acceptance, and next action fields. | Row id is stable, status is enumerated, and updates are conflict-aware. |
| `#profile-handoff` | Explicit row-level transfer between named agent profiles. | One worker pauses, delegates, resumes, or requests review from another profile. | Handoff row names source profile, target profile, context refs, blockers, acceptance, and resume state. |
| `#worker-process` | Full OS process worker with its own identity and runtime state. | Work should run outside fragile in-process subagent swarms. | Worker profile, command, cwd, proof, and cleanup boundary are explicit. |
| `#multi-agent-collaboration` | Durable collaboration through shared rows rather than transient subagents. | Several named profiles coordinate through board state. | Every task and handoff is readable/writable as rows, with no hidden process memory as SSOT. |
| `#tool-gateway` | Existing-infrastructure routing for tool calls. | A request uses web search, image generation, TTS, cloud browser, or another tool surface. | Tool route resolves to local MCP, Pages HTTP MCP, Browser WebMCP, or approved control-plane owner without adding a proxy. |
| `#tool-routing` | Per-tool provider selection and fallback. | A tool category can use gateway, direct, local, or unavailable provider state. | Provider state, fallback, approval, cost, and secret boundary are explicit before execution. |
| `#tool-function` | Callable function that extends agent capability. | A capability can be invoked as a typed tool call. | Function schema, owner, risk class, approval policy, cost posture, and typed fallback are present. |
| `#toolset` | Logical bundle of existing tool functions. | Several tools are enabled, disabled, discovered, or audited together. | Toolset resolves existing functions, reports missing entries, and does not copy external tool registries. |
| `#platform-toolset` | Platform-scoped toolset state. | Tool availability differs by CLI, chat, browser, MCP, or control-plane surface. | Enablement names the platform surface and does not imply global access. |
| `#tool-search` | Opt-in progressive disclosure for eligible deferred tools. | MCP or non-core plugin tool schemas would waste context before selection. | Activation policy, schema budget, session catalog, disabled state, and no-copy boundary are explicit. |
| `#deferred-tool-schema` | Tool schema hidden until a selected describe route loads it. | A deferred tool has been searched and now needs a full schema. | Schema is loaded only from the current session catalog and never from a stale global registry. |
| `#bridge-tool` | Small model-visible bridge used for search, describe, or call. | A deferred tool is invoked through a bridge instead of direct schema exposure. | Bridge unwraps to the real tool identity for validation, approval, hooks, audit, cost, and fallback. |
| `#web-search` | Web search and extraction tool category. | A task needs search, extraction, citations, or source fetch. | Source scope, citations, egress policy, cache behavior, and cost log are present. |
| `#image-generation` | Image generation tool category. | A task requests generated or edited images. | Approval, model/provider selection, prompt bounds, output manifest, and cost log are present. |
| `#text-to-speech` | Text-to-speech tool category. | A task requests narration, voice note, or audio output. | Voice/provider, text bounds, output manifest, and cost log are present. |
| `#cloud-browser` | Cloud browser automation tool category. | A task requires remote browser navigation, click, type, vision, or screenshot actions. | Isolated session, action schema, redaction, approval gate, and trace proof are present. |
| `#skill-evolution` | Bounded improvement of reusable skill contracts. | A skill is created or improved from experience, tests, traces, or evaluation packets. | Evaluation packet, semantic-preservation note, focused validation, human review, and no direct self-modifying commit. |
| `#memory-search` | Scoped retrieval from local memory or past conversation indexes. | An agent needs prior decisions, proof, or preferences before acting. | Ranked sources cite local storage scope and return typed empty results when no match exists. |
| `#identity-model` | Stable, source-backed operator and project preference model. | A repeated preference or boundary should persist across sessions. | Store only non-secret, operator-relevant, source-backed facts; reject unsupported personal inference. |
| `#orchestration-graph` | State, node, edge, and compile-check contract for agent workflows. | A workflow needs explicit topology, conditional routing, parallel branches, or bounded loops. | State schema, node ids, edge rules, entry/exit nodes, stop condition, and orphan-node check are present. |
| `#stateful-agent` | Long-running agent with explicit state across turns or sessions. | A run persists working state, memory, checkpoints, or resumable context. | State owner, memory boundary, checkpoint plan, and resume behavior are named. |
| `#durable-execution` | Fault-tolerant execution that can resume after interruption or failure. | A run may exceed one request, retry, pause, crash, or recover. | Checkpoint, idempotency, retry, timeout, circuit breaker, and recovery VCCs are present. |
| `#human-in-loop` | Operator inspection or approval inside a run. | A workflow pauses for human review, editing, approval, or rejection. | Interrupt payload, resume payload, audit event, and approval gate are typed. |
| `#long-horizon-harness` | Minutes-to-hours agent workflow for research, coding, or creation. | A task spans multiple tools, skills, memory reads, artifacts, and verification steps. | Goal, graph, checkpoints, sandbox scope, message gateway, stop conditions, artifacts, proof, and cost ledger are typed. |
| `#sandboxed-workspace` | Isolated or scoped filesystem/execution workspace for agent-created artifacts. | A run reads, writes, edits, executes, or summarizes generated files. | Workspace root, allowed operations, artifact manifest, diff summary, secret scan, cleanup, and approval gates are explicit. |
| `#agent-sandbox-policy` | Native declarative deny-first policy for agent filesystem, process, network, credential, and audit decisions. | An autonomous or tool-bearing run needs preflight authorization. | Policy source, digest, typed decision, redacted audit result, and OS/kernel enforcement gap are explicit. |
| `#message-gateway` | Typed handoff channel between user, agent, worker, tool, and review stages. | A workflow fans out, pauses, resumes, or sends tool/status messages across actors. | Message schema, sender, recipient, state transition, replay/idempotency rule, and visibility boundary are present. |

## Semantic Shape

```yaml
semantic:
  token: "#runtime-ready"
  role: "semantic filter"
  applies_to:
    - "readiness claims"
    - "runtime proof"
  requires:
    - "@runtime-proof"
    - "@dev-only"
  rejects:
    - "prose-only completion"
    - "deploy claim without approval"
```

## Composition Rules

| Pattern | Meaning |
|---|---|
| `/runtime-ready.check #harness #vcc @local-harness` | Prove an AI-capable contract with local checks. |
| `/release.complete #runtime-ready #multi-agent-collaboration @operator @runtime-proof` | Execute the protected release stages and require one promoted SHA plus live verification evidence. |
| `/deploy.guard #dev-only #approval-gate @operator` | Confirm deploy boundary and require explicit approval for release. |
| `/source.normalize #frontmatter #no-hardcode @source.frontmatter` | Fix source-owned identity or hardcoded data upstream. |
| `/mcp.capabilities #mcp #cost @mcp-gateway` | Discover tools with zero-spend cost reporting. |
| `/pipeline.trace #token-economics @cost-log` | Review FloatingPanel Chat pipeline and token economics through the cost ledger. |
| `/workspace.review #frontmatter @source.body` | Review workspace context without turning display labels into standalone prose commands. |
| `/canvas.render #canvas @runtime-proof` | Project parsed source state through existing Canvas owners. |
| `/canvas.node.add #canvas-node @canvas-center` | Create a graph node through existing Canvas mutation owners at the visible insertion point. |
| `/canvas.selection.open #canvas-selection @markdown-provenance` | Open the selected node or edge through side panel, tab, editor, or source provenance surfaces. |
| `/canvas.media.attach #canvas-media @selected-node @media-url` | Update selected-node rich media metadata through the shared media owner. |
| `/canvas.layout.tune #canvas-layout @layout-forces` | Tune or reset schema-owned layout force values. |
| `/canvas.edge.rewire #canvas-edge @selected-edge @edge-endpoint` | Update a selected edge endpoint through the shared Canvas edge flow. |
| `/computing-flow #computing-flow #frontmatter @local-harness` | Generate or validate a source-backed KGC computing-flow DAG. |
| `/soul.load #primary-identity @soul-profile` | Load durable identity into prompt slot 1 without hardcoded default identity. |
| `/personality.overlay #personality-overlay @personality-overlay` | Apply a temporary style overlay without mutating `SOUL.md`. |
| `/moa #mixture-of-agents @moa-preset` | Run bounded reference-agent deliberation before one aggregator answer. |
| `/moa #reference-agents @reference-agents` | Validate advisory reference calls, caps, failures, and private context. |
| `/moa #aggregator-agent @aggregator-agent` | Validate that the aggregator is the only acting agent and owns normal tool gates. |
| `/experience.capture #learning-loop @experience` | Capture a source-backed lesson before proposing memory or skill changes. |
| `/memory.write #persistent-memory @memory-entry` | Add, replace, or remove a bounded memory/profile entry with scan and capacity checks. |
| `/memory.compact #memory-capacity @memory-policy` | Consolidate bounded memory without silent data loss. |
| `/user.profile #user-profile @user-profile` | Persist explicit operator preferences and expectations only. |
| `/session.search #session-search @session-index` | Search past conversations on demand without automatic persistence. |
| `/skill.discover #skill-system @skill-index` | Discover lightweight skill metadata before loading full instructions. |
| `/skill.load #progressive-disclosure @skill-source @skill-reference` | Load selected skill instructions and referenced resources on demand. |
| `/skill.bundle #skill-bundle @skill-bundle` | Resolve grouped skills without installing missing entries. |
| `/skill.manage #skill-security @skill-policy` | Scan and gate skill writes or external skill source changes. |
| `/context.discover #cwd-discovery @working-directory` | Discover project-local context files without mutation or model spend. |
| `/context.load #context-file @context-file @context-policy` | Load a scanned and bounded context file into behavior context. |
| `/context.audit #project-context @runtime-proof` | Report effective context precedence, loaded files, blocks, and stale risks. |
| `/reference.expand #context-reference @reference-policy` | Resolve approved inline references without treating all `@` bindings as expansion targets. |
| `/reference.expand #inline-context @attached-context` | Append bounded expanded content while preserving the operator's original message text. |
| `/reference.audit #attached-context @runtime-proof` | Inspect expansion source, warning, refusal, size, and truncation metadata. |
| `/kanban.task #task-row @kanban-board` | Write one validated task row into the durable board. |
| `/kanban.handoff #profile-handoff @handoff-row @agent-profile` | Transfer work by row instead of hidden subagent state. |
| `/kanban.sync #multi-agent-collaboration @worker-process` | Reconcile board state across full OS worker processes. |
| `/tool.catalog #tool-gateway @tool-gateway` | Discover available per-tool routing states without executing tools. |
| `/tool.route #tool-routing @tool-provider` | Execute one approved tool call through the selected provider. |
| `/tool.catalog #tool-function @tool-function` | Discover callable functions with schema, owner, risk, and cost posture. |
| `/toolset.enable #platform-toolset @toolset @platform-surface` | Enable an existing toolset on one platform under policy and approval gates. |
| `/toolset.disable #platform-toolset @toolset @platform-surface` | Disable an existing toolset on one platform without deleting underlying tools. |
| `/tool.search #tool-search @deferred-tool-catalog` | Search eligible deferred tool metadata without schema disclosure or execution. |
| `/tool.describe #deferred-tool-schema @deferred-tool-catalog` | Load one selected deferred tool schema from the current session catalog. |
| `/tool.call #bridge-tool @bridge-tool @tool-policy` | Invoke a deferred tool while enforcing the underlying real tool policy. |
| `/tool.route #web-search @web-search-tool` | Run search or extraction with source scope, citations, egress, and cost proof. |
| `/tool.route #image-generation @image-tool` | Run image generation only after approval, artifact-boundary, and cost checks. |
| `/tool.route #text-to-speech @tts-tool` | Run TTS only with voice, text, output, and cost bounds. |
| `/tool.route #cloud-browser @browser-tool` | Run browser automation only with session isolation, redaction, and approval. |
| `/skill.evolve #skill-evolution @skill-catalog @runtime-proof` | Evaluate and propose a bounded skill improvement without direct self-modifying commit. |
| `/memory.search #memory-search @memory-store` | Retrieve scoped prior context before spending tokens or mutating source. |
| `/identity.reflect #identity-model @identity-model` | Persist stable operator preferences without secrets or unsupported inference. |
| `/orchestration.graph #orchestration-graph @orchestration-graph` | Declare and validate state, node, edge, and stop-condition topology. |
| `/state.checkpoint #durable-execution @checkpoint-store` | Define resumable checkpoints for long-running stateful runs. |
| `/human.review #human-in-loop @human-review` | Pause a workflow for operator inspection and typed resume. |
| `/stream.trace #durable-execution @runtime-proof` | Surface ordered, secret-free state transition events. |
| `/superagent.run #long-horizon-harness @sandbox-workspace @message-gateway` | Coordinate long-horizon research, coding, and creation without copied external runtime layouts. |

## Direct Facts Link

| Token | Facts source |
|---|---|
| `#truth` | `FACTS.md` direct-resolution entry for shared source-backed facts. |
| `#soul` | `FACTS.md` direct-resolution entry for durable agent identity. |
| `#knowgrph.probe-tree` | `FACTS.md` direct-resolution entry for bounded Probe-Tree semantics. |
| `#persistent-memory` | `FACTS.md` direct-resolution entry for bounded persistent memory. |
| `#skill-system` | `FACTS.md` direct-resolution entry for on-demand skill loading and progressive disclosure. |
| `#context-file` | `FACTS.md` direct-resolution entry for project-local context files. |
| `#project-context` | `FACTS.md` direct-resolution entry for scoped behavioral project context. |
| `#cwd-discovery` | `FACTS.md` direct-resolution entry for working-directory context discovery. |
| `#context-reference` | `FACTS.md` direct-resolution entry for inline context reference expansion. |
| `#inline-context` | `FACTS.md` direct-resolution entry for bounded message-time context injection. |
| `#attached-context` | `FACTS.md` direct-resolution entry for appended expansion packets. |
| `#kanban-board` | `FACTS.md` direct-resolution entry for durable shared Kanban boards. |
| `#task-row` | `FACTS.md` direct-resolution entry for task row contracts. |
| `#profile-handoff` | `FACTS.md` direct-resolution entry for handoff row contracts. |
| `#worker-process` | `FACTS.md` direct-resolution entry for full OS worker processes. |
| `#multi-agent-collaboration` | `FACTS.md` direct-resolution entry for durable row-based collaboration. |
| `#tool-gateway` | `FACTS.md` direct-resolution entry for existing-infrastructure tool routing. |
| `#tool-function` | `FACTS.md` direct-resolution entry for callable tool functions. |
| `#toolset` | `FACTS.md` direct-resolution entry for logical tool bundles. |
| `#platform-toolset` | `FACTS.md` direct-resolution entry for platform-scoped toolset state. |
| `#tool-search` | `FACTS.md` direct-resolution entry for opt-in deferred tool progressive disclosure. |
| `#deferred-tool-schema` | `FACTS.md` direct-resolution entry for on-demand deferred schema loading. |
| `#bridge-tool` | `FACTS.md` direct-resolution entry for bridge-routed deferred tool calls. |
| `#mixture-of-agents` | `FACTS.md` direct-resolution entry for bounded MoA routing. |

## VCCs

| VCC | Check |
|---|---|
| Dictionary parses | Frontmatter parses as YAML and `dictionary_entries` lists hash-prefixed tokens. |
| Tags are MECE enough for routing | Each tag row has distinct meaning, match criteria, and proof. |
| No semantic backfill | Tags do not mark runtime-ready without runtime proof. |
| No duplicate registry | Body states shared utilities own routing and no new semantic registry is created. |
