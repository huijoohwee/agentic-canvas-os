---
title: "Agentic OS Semantic Dictionary"
graphId: "md:agentic-os-dictionary-semantic"
doc_type: "Invocation Dictionary"
date: "2026-07-07"
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
  - "#tco"
  - "#vcc"
  - "#no-hardcode"
  - "#foss"
  - "#ttv"
  - "#runtime-ready"
  - "#dev-only"
  - "#mcp"
  - "#canvas"
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
| `#tco` | Total cost of ownership and deployment-model comparison. | A dependency, provider, cloud service, or new runtime path is proposed. | FOSS or existing-owner alternative and 12-month cost assumption are named. |
| `#vcc` | Verifiable completion conditions. | A claim needs measurable done criteria. | Given-When-Then and VCC text name observable output and a bounded check. |
| `#no-hardcode` | Hardcoded URLs, credentials, provider IDs, generated assets, or fixtures. | A source risks stale or operator-specific data. | Embedded artifact is removed or replaced with neutral source-owned reference. |
| `#foss` | Open-source, local, zero-egress, or vendor-neutral alternative. | A dependency or hosted service is under consideration. | Alternative path is named before paid or proprietary adoption. |
| `#ttv` | Time to value for min-viable-max-value scope. | Scope needs prioritization or a feature could become broad. | Must/Should/Could/Won't or equivalent ROI cut is present. |
| `#runtime-ready` | Claim can be proven from surfaced runtime output. | A spec-complete artifact is being promoted. | Parse, route, schema, cost, bound, approval, and focused validation proof are surfaced. |
| `#dev-only` | Local development boundary. | Work must stop before Prod mirror or Cloudflare. | Status shows no Prod mirror mutation and no Cloudflare deploy command. |
| `#mcp` | MCP discovery, gateway federation, or tool contract. | A capability is exposed to local, Pages, browser, or control-plane agents. | Tool IDs dedupe and discovery reports zero model spend. |
| `#canvas` | Source-backed Canvas projection. | Runtime state must render as graph, table, KGC, or Storyboard surface. | Existing Canvas owners render without dashboard-only storage. |
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
| `/deploy.guard #dev-only #approval-gate @operator` | Confirm deploy boundary and require explicit approval for release. |
| `/source.normalize #frontmatter #no-hardcode @source.frontmatter` | Fix source-owned identity or hardcoded data upstream. |
| `/mcp.capabilities #mcp #cost @mcp-gateway` | Discover tools with zero-spend cost reporting. |
| `/pipeline.trace #token-economics @cost-log` | Review FloatingPanel Chat pipeline and token economics through the cost ledger. |
| `/workspace.review #frontmatter @source.body` | Review workspace context without turning display labels into standalone prose commands. |
| `/canvas.render #canvas @runtime-proof` | Project parsed source state through existing Canvas owners. |
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
