---
title: "Agentic OS Binding Dictionary"
graphId: "md:agentic-os-dictionary-binding"
doc_type: "Invocation Dictionary"
date: "2026-07-20"
lang: "en-US"
schema: "agentic-os-dictionary-binding/v1"
frontmatter_contract: "required"
status: "runtime-ready"
prefix: "@"
prefix_role: "source, actor, or runtime binding"
source_docs:
  - "FACTS.md"
  - "MEMORY.md"
  - "AGENTS.md"
  - "PRD-TAD.md"
  - "MCP-GATEWAY.md"
  - "VALIDATION-RUNBOOK.md"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "dictionary content for shared binding invocation utilities; no separate binding store"
runtime_proof: "RUNTIME-PROOF.md"
metadata_consumers:
  - id: "chat_composer"
    surface: "FloatingPanel Chat composer"
    owner: "knowgrph/canvas/src/features/chat/floatingPanelChat/FloatingPanelChatComposer.tsx"
    metadata_fields: ["token", "label", "summary", "group", "sourcePath", "keywords", "prefix_role"]
    behavior: "inline variable-menu insertion; preserve query text after the invocation token"
  - id: "skills_commands_catalog"
    surface: "FloatingPanel Skills & Commands catalog"
    owner: "knowgrph/canvas/src/features/panels/views/SkillsCommandsView.tsx"
    metadata_fields: ["token", "label", "summary", "group", "sourcePath", "keywords", "prefix_role"]
    behavior: "searchable catalog row and active-card token insertion"
  - id: "mcp"
    surface: "MCP capability metadata"
    owner: "knowgrph/mcp/local-tool-contract.js"
    metadata_fields: ["token", "prefix", "meaning", "authority", "boundary", "secret_policy", "publish_policy", "source_docs"]
    behavior: "reference and binding metadata only; no standalone MCP tool execution or secret storage"
entry_metadata_contract:
  token: "dictionary_entries item and first Bindings table column"
  label: "runtime mirror derives a concise display label from the token"
  summary: "Bindings table Meaning column"
  group: "Agentic OS binding dictionary"
  sourcePath: "this dictionary document"
  keywords: "token parts plus Meaning, Authority, and Boundary text"
  mcp: "MCP consumers may expose binding authority and boundaries, but must never store credentials or treat bindings as approval"
dictionary_entries:
  - "@agent"
  - "@soul-profile"
  - "@identity-slot"
  - "@personality-overlay"
  - "@moa-preset"
  - "@reference-agents"
  - "@aggregator-agent"
  - "@operator"
  - "@source.frontmatter"
  - "@ecs-session"
  - "@source.body"
  - "@local-harness"
  - "@runtime-proof"
  - "@instruction-source"
  - "@instruction-eval-suite"
  - "@dev-only"
  - "@cost-log"
  - "@video-generation-demo-script"
  - "@provider.byteplus"
  - "@provider.openai"
  - "@text"
  - "@image"
  - "@image-to-threejs"
  - "@image-to-glb"
  - "@knowgrph.probe-tree"
  - "@audio"
  - "@video"
  - "@mcp-gateway"
  - "@canvas"
  - "@scene"
  - "@camera"
  - "@selected-actor"
  - "@selected-node"
  - "@selected-edge"
  - "@canvas-center"
  - "@viewport-readout"
  - "@viewport-transform"
  - "@zoom-mode"
  - "@wheel-input"
  - "@interaction-speed"
  - "@flow-run-mode"
  - "@drag-alpha-target"
  - "@media-url"
  - "@markdown-provenance"
  - "@layout-forces"
  - "@physics-2d"
  - "@centroid-target"
  - "@spread-axis"
  - "@performance-overlay"
  - "@edge-endpoint"
  - "@approval-gate"
  - "@prod-mirror"
  - "@cloudflare"
  - "@experience"
  - "@memory-store"
  - "@memory-entry"
  - "@memory-snapshot"
  - "@memory-policy"
  - "@user-profile"
  - "@session-index"
  - "@skill-index"
  - "@skill-source"
  - "@skill-reference"
  - "@skill-bundle"
  - "@skill-policy"
  - "@context-file"
  - "@working-directory"
  - "@context-policy"
  - "@file:"
  - "@folder:"
  - "@diff"
  - "@staged"
  - "@git:"
  - "@url:"
  - "@reference-policy"
  - "@attached-context"
  - "@kanban-board"
  - "@task-row"
  - "@work-item"
  - "@implementation-run"
  - "@handoff-row"
  - "@agent-profile"
  - "@worker-process"
  - "@tool-gateway"
  - "@tool-provider"
  - "@tool-function"
  - "@toolset"
  - "@platform-surface"
  - "@deferred-tool-catalog"
  - "@bridge-tool"
  - "@web-search-tool"
  - "@image-tool"
  - "@tts-tool"
  - "@browser-tool"
  - "@tool-policy"
  - "@skill-catalog"
  - "@identity-model"
  - "@orchestration-graph"
  - "@swarm-run"
  - "@agent-toolkit-observer"
  - "@state-store"
  - "@checkpoint-store"
  - "@human-review"
  - "@sandbox-workspace"
  - "@sandbox-policy"
  - "@message-gateway"
---

# Binding Dictionary

This file defines `@` binding-route content for Agentic Canvas OS docs. Bindings attach commands and semantic filters to an actor, source, runtime surface, proof artifact, or boundary. They are references only; they do not store secrets or authorize deployment.

## Contract

| Rule | Requirement |
|---|---|
| Route owner | Existing shared `@` utilities own binding detection and insertion. |
| Dictionary role | This file names binding meaning, authority, and fail-closed behavior. |
| Runtime status | Spec-complete until a shared runtime owner resolves the binding. |
| Secret policy | Bindings never contain raw credentials, provider keys, browser sessions, or media tokens. |
| Deploy policy | `@prod-mirror` and `@cloudflare` are gated boundaries, not default edit targets. |

## Consumer Metadata

| Consumer | Metadata read | Source fields | Runtime boundary |
|---|---|---|---|
| Chat composer | Token, label, summary, group, sourcePath, keywords, prefix role. | `dictionary_entries`; Bindings table Meaning, Authority, and Boundary. | Inserts the `@` token and preserves the editable query; unknown bindings stay raw text. |
| Skills & Commands catalog | Token, label, summary, group, sourcePath, keywords, prefix role. | Same source fields as chat composer. | Renders searchable rows and active-card insertion without copying a panel-local binding list. |
| MCP | Token, prefix, meaning, authority, boundary, secret policy, publish policy, source docs. | Bindings table plus frontmatter policy fields. | Metadata is reference and binding context only; bindings do not store secrets, approve tool calls, or become executable MCP tools. |

## Bindings

| Binding | Meaning | Authority | Boundary |
|---|---|---|---|
| `@agent` | Executing agent bound by `FACTS.md`, `AGENTS.md`, and explicit operator instructions. | Current runtime agent. | Must consult facts before memory, keep role behavior separate from truth, and fail closed on spend, mutation, or deploy gaps. |
| `@soul-profile` | Durable source-backed agent identity and voice. | `SOUL.md` plus approved prompt-assembly owner. | Identity only; no project commands, architecture notes, file paths, ports, credentials, memory facts, or deploy approvals. |
| `@identity-slot` | Prompt slot 1 identity position. | Approved prompt-assembly owner. | Must be filled from scanned `@soul-profile` or a typed fallback result; silent hardcoded default identity is forbidden. |
| `@personality-overlay` | Temporary session-level style overlay. | Operator-approved session state. | Overlay cannot mutate `SOUL.md`, override facts, bypass safety, or authorize deploy. |
| `@moa-preset` | Local neutral MoA preset binding for reference roles, aggregator role, caps, and failover policy. | `FACTS.md`, `SKILLS.md`, and the approved local model router or harness owner. | Must not contain copied provider examples, hardcoded external model ids, recursive MoA aggregators, or global model-switch side effects. |
| `@reference-agents` | Bounded advisory agents in a Mixture of Agents run. | Approved local harness or provider router. | No tools, no source mutation, capped output, typed failure, cost logging, and private advisory context only. |
| `@aggregator-agent` | Single acting agent in a Mixture of Agents run. | Approved local harness or provider router. | Owns final answer, tool calls, approvals, transcript persistence, and follow-up iteration through normal gates. |
| `@operator` | Human approval authority and final release gate. | The user. | Required before paid, mutating, payment, browser-auth, Prod, or Cloudflare actions. |
| `@source.frontmatter` | Parsed YAML frontmatter. | Authored document source. | SSOT for identity, routing, renderer flags, and runtime gates. |
| `@ecs-session` | Opaque id for one bounded in-memory ECS world hydrated from a validated KGC document. | Knowgrph's private ECS MCP session store. | Session ids grant no filesystem path, network, deployment, or caller-authored decision authority; TTL, maximum count, terminal persistence, and lazy sweep bound their lifetime. |
| `@source.body` | Authored Markdown body. | Authored document source. | SSOT for operator workflow, guardrails, and checklist language. |
| `@local-harness` | Dev-local typed harness or dry-run path. | Shared local runtime owner. | Default proof path before paid calls or deploy. |
| `@runtime-proof` | Surfaced validation evidence. | Command output, typed result, parsed field, or focused test. | Must be observable; narrative alone is not proof. |
| `@instruction-source` | One audited durable-guidance or skill-catalog source. | `docs/AGENTS.md` or `docs/SKILLS.md`. | Read-only audit input; it grants no rewrite, runtime, release, or deployment authority. |
| `@instruction-eval-suite` | Repository-owned final-answer scenarios and scoring rules for instruction quality. | `evals/instruction-task-quality-cases.json` and `INSTRUCTION-QUALITY-EVALUATION.md`. | Read-only evaluation input; candidate execution, human approval, release, and deployment remain separate authorities. |
| `@dev-only` | Local development boundary. | Current canonical Dev checkout. | Confirms work stops before Prod mirror and Cloudflare. |
| `@cost-log` | Token, cache, and estimated cost ledger. | Harness observer or runtime result. | Must report exact zero for model-free views. |
| `@video-generation-demo-script` | Authored source-script binding for the default video-agent preset. | The preset frontmatter plus its canonical workspace Markdown reference. | Source context only; it cannot contain generated artifact identities, credentials, provider job ids, or fabricated media URLs. |
| `@provider.byteplus` | Select the existing BytePlus ModelArk generation route. | Shared provider settings and generation-runtime owner. | Selection carries no credential and fails before spend when endpoint, model, entitlement, or credential is unavailable. |
| `@provider.openai` | Select the existing OpenAI generation route. | Shared provider settings and generation-runtime owner. | Selection carries no credential and fails before spend when endpoint, model, entitlement, or credential is unavailable. |
| `@text` | Request a structured text artifact. | Shared text-generation and workspace-artifact owners. | The video preset requires Character, Scene, Dialogue, Visual asset, Audio, Timing, Metadata, and Prompt sheets; empty or malformed output fails terminally. |
| `@image` | Request source-consistent image artifacts. | Shared image-generation, persistence, Media, and Canvas projection owners. | Only provider-returned and read-back-verified image identities may project; no fabricated or localhost-only URL is accepted as durable output. |
| `@image-to-threejs` | Bind one existing PNG, JPG, JPEG, or SVG source to the native `image.to-threejs` conversion. | Shared Card, Widget, image-to-threejs, and Rich Media Panel owners. | Uses the selected source URL only; no credential, provider generation, external plugin, or deploy authority is introduced. |
| `@image-to-glb` | Bind one existing PNG, JPG, JPEG, or SVG source to the native procedural `image.to-glb` asset contract. | Shared Card, Widget, image-to-threejs source utilities, and GLB asset-pipeline owners. | Uses only the selected source URL; source media remains unchanged, external plugin/copy paths are forbidden, and any LLM execution requires its separately approved runtime. |
| `@knowgrph.probe-tree` | Bind one Widget Card or answered branch to the shared Probe-Tree generation context. | Authored graph identity, selected child Output including numbered multi-selections and Other, bounded ancestor lineage, local MCP Probe-Tree tools, shared Storyboard publication owners, and the active Chat provider, endpoint, and model. | Carries no credentials or implicit provider approval; the selected child replaces any same-ID root alias as continuation owner, every accepted question and clarification suggestion traces to the selected child or bounded lineage through verbatim anchors, stale card-local routing is forbidden, and graph mutation remains atomic through the owning publication transaction. |
| `@audio` | Request narration, dialogue, sound, music, subtitle-sync, and master-audio artifacts. | Shared audio/video generation, media-probe, persistence, and Timeline owners. | Languages, synchronization, media kind, persistence, and read-back identity must be typed before projection. |
| `@video` | Request playable video artifacts and final composition. | Shared video-generation, composition, persistence, Media, and Timeline owners. | Completion requires returned or composed playable bytes, media verification, persistence, read-back, and one durable identity across Canvas surfaces. |
| `@mcp-gateway` | Discovery-first MCP federation surface. | Existing local, Pages, browser, or control-plane MCP owner. | Discovery is zero-token; spend routes through approval gates. |
| `@canvas` | Source-backed Canvas projection. | Existing Source Files, frontmatter, KGC, table, or Storyboard owner. | No dashboard-only graph store or renderer fork. |
| `@scene` | Current canonical XR scene and immersive placement scope. | Browser-local Knowgrph scene, hit-test, and shared Canvas projection owners. | Carries no camera or sensor grant and creates no duplicate renderer, persistence owner, approval, credential, Prod, or Cloudflare authority. |
| `@camera` | First-class shared Camera framing and XR motion runtime. | Application-root Camera runtime, shared framing utilities, and canonical BottomPanel Timeline transport. | Does not create a panel-local Camera store, timeline, selection owner, credential, or deployment grant. |
| `@selected-actor` | Actor selected for framing, cast marks, or camera choreography. | Shared Canvas graph selection and XR cast runtime. | Missing actor selection fails closed; the binding never keeps a FloatingPanel-only selection copy. |
| `@selected-node` | Current Canvas node selection resolved through shared graph selection state. | Existing Canvas selection owner. | Missing selection returns a typed no-selection result; commands must not keep a panel-local selected-node cache. |
| `@selected-edge` | Current Canvas edge selection resolved through shared graph selection state. | Existing Canvas selection owner. | Missing selection returns a typed no-selection result; endpoint updates must validate against current graph data. |
| `@canvas-center` | Resolved graph-space insertion point from the current visible Canvas viewport. | Existing zoom/pan viewport and canvas projection utilities. | Point must be derived from current viewport transform, not a hardcoded panel or screen coordinate. |
| `@viewport-readout` | Current viewport size, zoom percent, and world-space center from shared viewport utilities. | Existing viewport measurement and zoom projection owners. | Read-only telemetry; missing dimensions return typed empty state instead of synthetic defaults. |
| `@viewport-transform` | Active zoom transform with scale and screen-space translation. | Existing D3/zoom state and projection utilities. | Transform values must be read from active renderer state and clamped by shared zoom bounds. |
| `@zoom-mode` | Fit, selection, pinning, duration, and scale extent state for canvas zoom behavior. | Existing auto-zoom, runtime zoom dispatch, and schema owners. | Does not authorize auto-fit or pinning changes without an explicit command route and supported renderer state. |
| `@wheel-input` | Wheel or trackpad behavior, modifier boost, and gesture preset context. | Existing camera-options and wheel-target guard owners. | Gesture routing preserves overlay guards and never bypasses scroll/input ownership. |
| `@interaction-speed` | Pan, zoom, and global interaction speed multipliers. | Existing schema, canvas runtime, and store settings owners. | Values clamp through shared owners and must not be stored as panel-local copies. |
| `@flow-run-mode` | Canvas run mode plus Flow wheel and overlay interaction state. | Existing toolbar run-mode owner, Flow renderer owners, and shared store. | Run-mode changes stay in the toolbar/store path; Flow overlay changes stay renderer-owned. |
| `@drag-alpha-target` | D3 drag alpha target used by the 2D simulation during canvas dragging. | Existing graph store and D3 simulation tuning owner. | Value is simulation tuning only; missing simulation state returns typed unsupported result. |
| `@media-url` | Approved media URL or inline media reference for node media metadata. | Shared media inventory, inline media command candidates, or explicit operator input. | Must validate kind and reference; no generated URLs, credentials, or stale fixtures are stored. |
| `@markdown-provenance` | Document path and line range provenance for opening selected Canvas records in source. | Parsed node/edge properties and workspace document owners. | Missing provenance keeps open actions on implemented graph surfaces and does not invent a source path. |
| `@layout-forces` | Schema-owned Canvas layout force values for anti-line and post-fit tuning. | Graph schema owner. | Values clamp through schema rules and reset/preset writes stay in schema state rather than toolbar-local state. |
| `@physics-2d` | Schema-owned charge, collision, speed, overlap, label, and drag-force tuning for 2D layout. | Graph schema physics tuning owner. | Values are clamped, reset, and proven through schema state; no floating-panel slider state is authoritative. |
| `@centroid-target` | Selection, all-items, or viewport target used by center and centroid arrange commands. | Shared arrange, selection, and centroid utilities. | Target scope must be explicit and selection-dependent commands fail closed when selection is absent. |
| `@spread-axis` | Requested horizontal or vertical axis for even-spread arrange operations. | Shared arrange utilities. | Axis and selected-node count are validated before mutation. |
| `@performance-overlay` | Canvas performance overlay state and diagnostic readout source. | Shared performance overlay and pipeline performance owners. | Diagnostics are read-only by default and do not imply continuous polling or panel-local monitoring. |
| `@edge-endpoint` | Candidate source or target endpoint for a Canvas edge request. | Shared graph lookup and edge request owner. | Endpoint id must exist in the current graph; duplicate or stale endpoints fail before mutation. |
| `@approval-gate` | Explicit gate state for spend, mutation, payment, browser auth, or deploy. | Shared gate catalog or harness result. | Missing approval blocks before action. |
| `@prod-mirror` | Prod mirror path for release staging. | Operator-approved release flow only. | Not a default edit target; forbidden without explicit instruction. |
| `@cloudflare` | Cloudflare route or Worker/Pages control plane. | Operator-approved deploy flow only. | Not a completion criterion for docs-only work. |
| `@experience` | Typed record of a run, failure, proof packet, or operator correction. | Authored source plus surfaced runtime proof. | May seed proposals only after provenance, applicability, expiry risk, and no-copy boundary are recorded. |
| `@memory-store` | Bounded agent-note store for environment facts, conventions, lessons, and project context. | `MEMORY.md` plus approved local memory owner. | Read is scoped; writes require scan, capacity check, duplicate handling, and must exclude secrets, unsupported inference, and deploy artifacts. |
| `@memory-entry` | One compact memory or profile entry. | Approved memory write request. | Entry must name target, evidence, write action, scan result, capacity result, and source. |
| `@memory-snapshot` | Frozen memory/profile context captured at session start. | Approved prompt assembly owner. | Active prompt snapshot is immutable; mid-session writes affect future sessions or live tool responses only. |
| `@memory-policy` | Capacity, write approval, scan, duplicate, and compaction policy. | `FACTS.md`, `MEMORY.md`, `USER.md`, and approved runtime owner. | Unsafe, overflowing, duplicate, or unsupported writes fail closed with typed result. |
| `@user-profile` | Bounded user profile for explicit preferences, communication style, and expectations. | `USER.md` plus operator-approved profile owner. | No unsupported personal inference, secrets, sensitive profiling, project operations, or stale session details. |
| `@session-index` | Searchable past-session record index. | Approved local session-search owner. | Read-only search by default; results require explicit capture before persistence. |
| `@skill-index` | Lightweight skill metadata index. | `SKILLS.md` plus approved shared skill registry owner. | Index entries include metadata only; full instruction bodies and secrets stay out until selected. |
| `@skill-source` | One selected skill source document. | `SKILL.md`-compatible source under an approved skill root. | Must parse, remain bounded, avoid copied external artifacts, and load only after selection. |
| `@skill-reference` | Optional skill resource such as references, scripts, templates, or assets. | Approved skill root and resource path. | Load on demand, keep references shallow, validate before execution, and reject unsafe paths. |
| `@skill-bundle` | Bundle manifest that groups existing skill ids. | Approved bundle source. | Resolves installed skills, reports missing entries, and cannot override approval or deploy gates. |
| `@skill-policy` | Skill trust, scan, compatibility, write approval, and validation policy. | `FACTS.md`, `SKILLS.md`, `VALIDATION-RUNBOOK.md`, and approved runtime owner. | Unsafe external sources, incompatible requirements, copied artifacts, or unreviewed writes fail closed. |
| `@context-file` | One discovered project-local context file. | Working directory, ancestor, or touched subdirectory under the approved project scope. | Read-only unless operator requests edits; must scan, bound, and never override `FACTS.md`, `SOUL.md`, system, developer, or operator instructions. |
| `@working-directory` | Current startup or tool-call working directory used for context discovery. | Runtime session state or explicit operator path. | Must be explicit, normalized, and scoped; no home-wide or global scan unless approved. |
| `@context-policy` | Precedence, scan, truncation, and progressive-discovery rules for context files. | `FACTS.md`, `AGENTS.md`, `VALIDATION-RUNBOOK.md`, and approved runtime owner. | First-match project context, per-directory visited set, prompt-injection block, capacity bound, and deploy gate are required. |
| `@file:` | Context reference to one workspace file or 1-indexed line range. | Explicit message text plus normalized workspace path. | Text only, workspace-scoped, sensitive path blocked, path traversal blocked, binary rejected, and bounded before expansion. |
| `@folder:` | Context reference to a directory listing or bounded folder summary. | Explicit message text plus normalized workspace directory. | Maximum entry cap, no recursive content dump by default, sensitive children skipped with warnings. |
| `@diff` | Context reference to the current unstaged diff. | Current canonical VCS checkout. | Read-only, secret-scanned, bounded, and never treated as approval to write or revert. |
| `@staged` | Context reference to the current staged diff. | Current VCS index. | Read-only, secret-scanned, bounded, and never treated as commit approval. |
| `@git:` | Context reference to recent commit metadata or patch range. | Current VCS repository. | Count is clamped to a small maximum, missing revisions warn, and sensitive content remains blocked. |
| `@url:` | Context reference to fetched external content. | Approved URL fetch/extract owner. | Requires egress policy, cache/citation metadata, size bounds, and no credentials in URL or headers. |
| `@reference-policy` | Workspace, scan, size, platform, URL egress, warning, and refusal rules for context references. | `FACTS.md`, `AGENTS.md`, `VALIDATION-RUNBOOK.md`, and approved composer or CLI owner. | Missing policy preserves raw text; unsupported surfaces pass raw `@` references through with typed warning. |
| `@attached-context` | Bounded appended context packet produced by reference expansion. | Approved `/reference.expand` runtime owner. | Packet records source token, normalized source, size, truncation, warnings, refusal, and cost posture. |
| `@kanban-board` | Durable `kanban.md` task board. | Authored Markdown table source plus existing multi-dimensional table/Kanban utilities. | Board rows are the SSOT for task and handoff state; no browser-only, process-only, or copied board store. |
| `@task-row` | One validated task row in `kanban.md`. | Shared table row parser and operator-approved task schema. | Requires stable id, title, owner profile, status, priority, acceptance, evidence, and next action. |
| `@work-item` | One durable implementation request with objective, acceptance, repository, semantic scope, allowed paths, configured runner id, verification argv, and attempt/time bounds. | Operator-approved project source or management surface. | Contains no raw shell text, credentials, provider secrets, arbitrary environment, merge grant, or deployment authority. |
| `@implementation-run` | Versioned durable ledger identity for one managed implementation attempt series. | Knowgrph local MCP run store and its single supervisor. | Records exact work item, state version, worktree, branch, lease epoch, fence, PR, runner attempt, evidence, and transition; idempotent compare-and-set writes only. |
| `@handoff-row` | One validated handoff row in `kanban.md`. | Shared table row parser and named profiles. | Requires from profile, to profile, task id, context refs, blockers, resume state, and acceptance criteria. |
| `@agent-profile` | Named profile that can own or receive board work. | `SOUL.md`, `USER.md`, profile config, or explicit operator-defined profile source. | Profile identity is explicit and non-secret; it cannot imply deploy, spend, or hidden memory ownership. |
| `@worker-process` | Full OS process worker for a named profile. | Approved local process launcher or operator-run terminal. | Process has cwd, identity, command, proof, cleanup, and resource bounds; no fragile in-process subagent swarm. |
| `@tool-gateway` | Existing `knowgrph` tool routing surface. | Local MCP, Pages HTTP MCP, Browser WebMCP, or approved Cloudflare control-plane owner. | No new proxy, no copied gateway, and no deploy claim without explicit approval. |
| `@tool-provider` | Provider state for a specific tool category. | Approved provider router or settings owner. | Gateway, direct, local, or unavailable state only; raw credentials stay server-managed. |
| `@tool-function` | One callable function that extends agent capability. | Existing MCP, local harness, browser, source, or control-plane owner. | Must declare schema, owner, risk class, cost posture, and typed fallback without secrets. |
| `@toolset` | Logical bundle of existing tool functions. | `SKILLS.md`, `MCP-GATEWAY.md`, and approved tool catalog owner. | Resolves existing functions only; cannot install, invent, or globally enable tools. |
| `@platform-surface` | CLI, FloatingPanel Chat, browser, MCP, or control-plane surface. | Approved runtime surface owner. | Toolset state is scoped to this surface and cannot grant cross-platform access implicitly. |
| `@deferred-tool-catalog` | Session-scoped catalog of eligible deferred tools. | Approved tool catalog owner assembled from current MCP and plugin toolsets. | Rebuilt from currently granted tools; cannot expose core direct tools, disabled tools, or global registry entries. |
| `@bridge-tool` | Model-visible bridge surface for deferred tool search, describe, or call. | Approved tool-search harness owner. | Cannot bypass real tool schema validation, approval, hooks, audit, cost logging, or fallback. |
| `@web-search-tool` | Search and extraction capability. | Approved search/extract harness. | Requires source scope, citations, egress policy, cache policy, and cost log. |
| `@image-tool` | Image generation capability. | Approved image harness. | Requires approval, prompt bounds, artifact manifest, and cost log. |
| `@tts-tool` | Text-to-speech capability. | Approved audio harness. | Requires voice/provider, text bounds, output manifest, and cost log. |
| `@browser-tool` | Cloud browser automation capability. | Approved browser automation harness. | Requires isolated session, action schema, redaction, screenshots or vision bounds, and approval. |
| `@tool-policy` | Tool approval, egress, secret, cost, and fallback policy. | `FACTS.md`, `MCP-GATEWAY.md`, `HARNESS-CONTRACTS.md`, and approved runtime owner. | Paid, mutating, browser-auth, generated-media, and deploy actions fail closed without approval. |
| `@skill-catalog` | Reusable skill contract catalog. | `SKILLS.md` plus existing shared skill registry owner when present. | Skill changes are proposals until reviewed; direct auto-commit and external copying are forbidden. |
| `@identity-model` | Stable model of operator preferences, project boundaries, and agent operating rules. | `FACTS.md`, `MEMORY.md`, and operator-approved memory. | Stores non-secret, source-backed facts only; no sensitive profiling or unsupported personal inference. |
| `@orchestration-graph` | Source-backed state, node, edge, and stop-condition topology. | `SKILLS.md`, `HARNESS-CONTRACTS.md`, and existing Canvas/KGC graph owners. | No external graph runtime import, hidden node registry, or direct graph-store mutation. |
| `@swarm-run` | Durable ledger for one dynamically planned Agent Swarm run. | `AGENT-SWARM.md`, Agent Swarm runtime, and the injected atomic state-store adapter. | Holds bounded private task results for dependencies and synthesis plus state, claims, leases, verified receipts, cost, and trace; never exposes those results publicly or stores provider secrets, caller roles, or workflow topology. |
| `@agent-toolkit-observer` | Injected metadata observer and digest-bound evaluator for one Toolkit principal. | `AGENT-TOOLKIT.md`, Agent Toolkit runtime, and the application-owned authorizer, adapter, or evaluator. | Accepts bounded redacted lifecycle metadata, declared metrics, unique evidence references, and owner-aggregate cost; caller-declared digests need application verification, and remote telemetry stays untrusted and comparison-ineligible. |
| `@state-store` | Scoped current-state snapshot for a stateful run. | Existing approved local state owner. | Typed, bounded, secret-free state only; writes require mutation approval. |
| `@checkpoint-store` | Durable checkpoint and resume surface. | Existing approved local persistence owner. | Checkpoints require scope, recovery proof, idempotency, and cleanup path. |
| `@human-review` | Operator review interrupt and resume binding. | The operator or approved review gate. | Continuation is blocked until approve, reject, or edit result is typed. |
| `@sandbox-workspace` | Scoped workspace for long-horizon agent file reads, writes, execution, uploads, and outputs. | Approved sandbox, local workspace, or per-run output owner. | Must declare root, allowed operations, diff summary, artifact manifest, secret scan, timeout, cleanup, and approval gates. |
| `@sandbox-policy` | Source-backed declarative policy for one agent runtime boundary. | Runtime policy source selected by the operator or owning harness. | Carries policy identity and path only; never credential values, implicit approval, compatibility aliases, or an isolation claim. |
| `@message-gateway` | Typed message bus for user, agent, worker, tool, review, and artifact events. | Approved local harness, MCP gateway, or control-plane owner where deployed. | Messages require schema, sender, recipient, run id, state transition, replay rule, and visibility boundary. |

## Binding Shape

```yaml
binding:
  token: "@local-harness"
  role: "runtime binding"
  authority: "shared local runtime owner"
  allowed_with:
    - "/runtime-ready.check"
    - "#harness"
    - "#vcc"
  forbidden_without:
    - "@operator for paid calls"
    - "@approval-gate for mutation"
```

## Fail-Closed Rules

| Missing or unsafe binding | Result |
|---|---|
| Missing `@operator` for paid, mutating, payment, browser-auth, Prod, or Cloudflare action | Return approval-required or blocked with zero spend. |
| Missing `@source.frontmatter` for parser or routing claims | Keep status spec-complete and request source. |
| Missing `@runtime-proof` for runtime-ready promotion | Do not promote; report proof gap. |
| Missing, expired, or disposed `@ecs-session` for tick or persistence | Return a typed session error; do not recreate the world, accept caller-supplied decisions, or mutate source. |
| Missing `@working-directory` for `/context.discover` or `/context.audit` | Return missing-working-directory; do not scan arbitrary paths. |
| Missing `@context-policy` for `/context.load` | Block before inclusion; context files cannot self-authorize loading. |
| Missing `@reference-policy` for `/reference.expand` | Preserve raw message text and return reference-policy-required. |
| `@file:`, `@folder:`, `@git:`, or `@url:` targets sensitive, binary, outside-workspace, disallowed-egress, or over-hard-limit content | Warn or refuse before injecting content into `@attached-context`. |
| Missing `@kanban-board` for `/kanban.task`, `/kanban.handoff`, or `/kanban.sync` | Return missing-board; do not create a second board store. |
| Missing `@agent-profile` or `@worker-process` for a handoff | Return missing-profile; do not spawn an anonymous worker. |
| Missing `@work-item` or `@implementation-run` for `/implementation.run` | Return missing-managed-run-context before worktree creation, process launch, model spend, or mutation. |
| Missing or unconfigured `@swarm-run` state, exact-agent resolver, planner, worker, synthesizer, receipt verifier, authorizer, or authenticated run principal | Return a typed block before work, disclosure, spend, or cancellation; never accept a caller-supplied substitute. |
| Missing `@agent-toolkit-observer` authorizer, changed revision digest, or cross-principal access | Block mutation or disclosure; a missing evaluator blocks new evaluation spend but not owner reads or comparison over already committed eligible evidence. |
| Missing `@tool-policy` for paid, egress, generated-media, or browser automation | Return blocked before executing the tool. |
| Missing `@platform-surface` for `/toolset.enable` or `/toolset.disable` | Return scoped-platform-required before changing toolset state. |
| Missing `@deferred-tool-catalog` for `/tool.search` or `/tool.describe` | Return no-deferred-catalog before schema disclosure or execution. |
| Missing `@bridge-tool` or `@tool-policy` for `/tool.call` | Block before execution and require the real underlying tool policy. |
| Missing `@selected-node`, `@selected-edge`, or `@edge-endpoint` for Canvas selection commands | Return missing-selection or missing-endpoint before graph mutation, chat append, or source opening. |
| Missing `@layout-forces` for `/canvas.layout.tune` | Return missing-layout-forces and keep schema layout state unchanged. |
| Missing `@media-url` for `/canvas.media.attach` | Return missing-media-reference and do not create a placeholder media node. |
| `@prod-mirror` or `@cloudflare` appears in docs-only work | Treat as gated boundary, not an action. |
| Binding points to credentials, media tokens, generated URLs, or browser secrets | Reject and neutralize source content. |

## Composition Rules

| Pattern | Meaning |
|---|---|
| `/memory.seed #frontmatter @source.frontmatter @source.body` | Build memory from authored source. |
| `/runtime-ready.check #harness @local-harness @runtime-proof` | Prove runtime status locally. |
| `/ecs.session-start #agentic-ecs @source.frontmatter @ecs-session` | Bind validated KGC source to one private bounded ECS session. |
| `/ecs.world-tick #agentic-ecs @ecs-session @runtime-proof` | Resolve and advance the live session without exposing its world object. |
| `/ecs.decision-persist #agentic-ecs @ecs-session @source.frontmatter` | Persist the session's pending decisions atomically and dispose it only after a terminal success. |
| `/release.complete #runtime-ready #multi-agent-collaboration @operator @source.frontmatter @runtime-proof` | Authorize and prove the bounded Dev-to-Prod-to-Cloudflare release workflow. |
| `/implementation.run #managed-implementation-run @work-item @implementation-run @sandbox-workspace` | Execute one bounded work item inside its fenced run workspace and stop `delivery_ready` with ACOS `review_ready`. |
| `/canvas.node.add #canvas-node @canvas-center` | Create a graph node at the visible Canvas insertion point. |
| `/canvas.selection.open #canvas-selection @markdown-provenance` | Open selected graph records through existing source or side-panel surfaces. |
| `/canvas.media.attach #canvas-media @selected-node @media-url` | Attach rich media metadata to the selected graph node. |
| `/canvas.layout.tune #canvas-layout @layout-forces` | Tune schema-owned Canvas layout values. |
| `/canvas.edge.rewire #canvas-edge @selected-edge @edge-endpoint` | Rewire the selected edge through validated graph endpoints. |
| `/soul.load #primary-identity @soul-profile @identity-slot` | Load durable identity into prompt slot 1 through a scanned source-backed contract. |
| `/personality.overlay #personality-overlay @personality-overlay` | Apply a temporary session style overlay without mutating durable identity. |
| `/cost.audit #token-economics @cost-log @operator` | Inspect and gate spend. |
| `/deploy.guard #dev-only @operator @cloudflare` | Confirm release remains gated until operator explicitly authorizes deploy. |
| `/moa #mixture-of-agents @moa-preset @reference-agents @aggregator-agent` | Run one-shot advisory fan-out and aggregator-owned response under cost and approval gates. |
| `/experience.capture #learning-loop @experience` | Store a bounded lesson from proof before proposing reuse. |
| `/memory.write #persistent-memory @memory-entry @memory-policy` | Persist a bounded agent-note or profile entry after scan and capacity checks. |
| `/memory.compact #memory-capacity @memory-store @memory-policy` | Consolidate memory deliberately without silent drops. |
| `/user.profile #user-profile @user-profile` | Persist explicit user preferences, communication style, and expectations. |
| `/session.search #session-search @session-index` | Retrieve prior conversation details without automatic memory writes. |
| `/skill.discover #skill-system @skill-index` | Inspect lightweight skill metadata without full body loading. |
| `/skill.load #progressive-disclosure @skill-source @skill-reference` | Load selected skill instructions and optional resources only when needed. |
| `/skill.bundle #skill-bundle @skill-bundle` | Resolve grouped existing skills under one invocation. |
| `/skill.manage #skill-security @skill-policy` | Gate skill writes and external skill sources through scan, validation, and approval. |
| `/context.discover #cwd-discovery @working-directory` | Discover project-local context files from startup and touched paths. |
| `/context.load #context-file @context-file @context-policy` | Load one scanned and bounded context file. |
| `/context.audit #project-context @context-policy @runtime-proof` | Inspect effective context precedence, blocked files, and stale risks. |
| `/reference.expand #context-reference @reference-policy @working-directory` | Expand only approved reference forms while preserving raw unsupported `@` bindings. |
| `/reference.expand #inline-context @attached-context` | Append bounded context packets with source, warning, and size metadata. |
| `/reference.audit #attached-context @runtime-proof` | Report reference expansion safety, truncation, and refusal states. |
| `/kanban.task #task-row @kanban-board @task-row` | Create or update one durable task row. |
| `/kanban.handoff #profile-handoff @handoff-row @agent-profile` | Record a readable handoff between named profiles. |
| `/kanban.sync #multi-agent-collaboration @worker-process` | Reconcile durable board rows across OS processes. |
| `/tool.catalog #tool-gateway @tool-gateway @tool-provider` | Read per-tool gateway/direct/local/unavailable states without tool execution. |
| `/tool.catalog #tool-function @tool-function` | Read callable function schemas, owners, risk classes, and cost posture. |
| `/toolset.enable #toolset @toolset @platform-surface` | Enable existing tool functions for one platform under `@tool-policy`. |
| `/toolset.disable #toolset @toolset @platform-surface` | Disable a toolset for one platform without deleting underlying functions. |
| `/tool.route #tool-routing @tool-provider @tool-policy` | Route one approved tool call through existing `knowgrph` infrastructure. |
| `/tool.search #tool-search @deferred-tool-catalog` | Search session-scoped deferred tool metadata. |
| `/tool.describe #deferred-tool-schema @deferred-tool-catalog` | Load one deferred schema from the current session catalog. |
| `/tool.call #bridge-tool @bridge-tool @tool-policy` | Dispatch through the bridge while enforcing the real tool policy. |
| `/tool.route #web-search @web-search-tool` | Execute search or extraction with citations and egress policy. |
| `/tool.route #image-generation @image-tool` | Execute image generation with approval and artifact manifest. |
| `/tool.route #text-to-speech @tts-tool` | Execute TTS with voice and output bounds. |
| `/tool.route #cloud-browser @browser-tool` | Execute cloud browser automation with isolated session and redaction. |
| `/skill.propose #skill-evolution @skill-catalog` | Draft a reusable skill contract for review. |
| `/memory.search #memory-search @memory-store` | Retrieve prior context from scoped local memory. |
| `/identity.reflect #identity-model @identity-model` | Persist stable non-secret preferences with operator authority. |
| `/orchestration.graph #orchestration-graph @orchestration-graph` | Validate graph topology through source-backed owners. |
| `/agent.swarm #agent-swarm @swarm-run @agent` | Coordinate runtime-generated tasks through one durable atomic run ledger. |
| `/agent.toolkit #agent-toolkit @agent-toolkit-observer` | Observe application-authorized digest-bound revisions and return deterministic trusted evidence or a review-pending proposal without applying change. |
| `/state.checkpoint #durable-execution @checkpoint-store` | Persist resumable checkpoints with recovery proof. |
| `/human.review #human-in-loop @human-review` | Pause and resume a run through operator review. |
| `/superagent.run #long-horizon-harness @sandbox-workspace @message-gateway` | Run bounded long-horizon work with typed workspace, handoff, checkpoint, and artifact proof. |

## Direct Facts Link

| Token | Facts source |
|---|---|
| `@agent` | `FACTS.md` direct-resolution entry for executing-agent obligations. |
| `@soul-profile` | `FACTS.md` direct-resolution entry for durable identity binding. |
| `@knowgrph.probe-tree` | `FACTS.md` direct-resolution entry for the selected Probe-Tree graph context. |
| `@ecs-session` | `FACTS.md` direct-resolution entry for private bounded ECS session identity. |
| `@memory-entry` | `FACTS.md` direct-resolution entry for bounded memory entries. |
| `@skill-index` | `FACTS.md` direct-resolution entry for progressive skill discovery. |
| `@skill-source` | `FACTS.md` direct-resolution entry for selected skill source loading. |
| `@context-file` | `FACTS.md` direct-resolution entry for one discovered context file. |
| `@working-directory` | `FACTS.md` direct-resolution entry for context discovery root. |
| `@context-policy` | `FACTS.md` direct-resolution entry for context precedence, scan, and bounds. |
| `@file:` | `FACTS.md` direct-resolution entry for file and line-range context references. |
| `@folder:` | `FACTS.md` direct-resolution entry for folder context references. |
| `@diff` | `FACTS.md` direct-resolution entry for unstaged diff references. |
| `@staged` | `FACTS.md` direct-resolution entry for staged diff references. |
| `@git:` | `FACTS.md` direct-resolution entry for bounded git history references. |
| `@url:` | `FACTS.md` direct-resolution entry for URL context references. |
| `@reference-policy` | `FACTS.md` direct-resolution entry for reference expansion policy. |
| `@attached-context` | `FACTS.md` direct-resolution entry for appended expansion packets. |
| `@kanban-board` | `FACTS.md` direct-resolution entry for durable Kanban board binding. |
| `@task-row` | `FACTS.md` direct-resolution entry for task row binding. |
| `@handoff-row` | `FACTS.md` direct-resolution entry for handoff row binding. |
| `@agent-profile` | `FACTS.md` direct-resolution entry for named profile binding. |
| `@worker-process` | `FACTS.md` direct-resolution entry for full OS process worker binding. |
| `@swarm-run` | `FACTS.md` direct-resolution entry for one dynamic swarm run ledger. |
| `@agent-toolkit-observer` | `FACTS.md` direct-resolution entry for one metadata-only Toolkit observer and evaluator boundary. |
| `@tool-gateway` | `FACTS.md` direct-resolution entry for existing-infrastructure tool routing. |
| `@tool-provider` | `FACTS.md` direct-resolution entry for per-tool provider state. |
| `@tool-function` | `FACTS.md` direct-resolution entry for callable tool functions. |
| `@toolset` | `FACTS.md` direct-resolution entry for logical tool bundles. |
| `@platform-surface` | `FACTS.md` direct-resolution entry for platform-scoped toolset state. |
| `@deferred-tool-catalog` | `FACTS.md` direct-resolution entry for session-scoped deferred tool catalog. |
| `@bridge-tool` | `FACTS.md` direct-resolution entry for bridge-routed deferred tool calls. |
| `@moa-preset` | `FACTS.md` direct-resolution entry for local MoA preset obligations. |

## VCCs

| VCC | Check |
|---|---|
| Dictionary parses | Frontmatter parses as YAML and `dictionary_entries` lists at-prefixed tokens. |
| Bindings are non-secret | Body contains no raw credentials, provider keys, media tokens, or generated asset URLs. |
| Authority is explicit | Every binding row names an authority and boundary. |
| Deploy remains gated | `@prod-mirror` and `@cloudflare` are described as gated boundaries, not default actions. |
