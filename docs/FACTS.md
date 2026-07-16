---
title: "Agentic OS Facts"
graphId: "md:agentic-os-facts"
doc_type: "Agentic OS Facts"
date: "2026-07-16"
lang: "en-US"
schema: "agentic-os-facts/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "shared truth layer for Agentic Canvas OS docs"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "source-backed facts and invocation definitions only; no separate parser, command runner, memory store, provider panel, or deploy claim"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
source_revision_contract:
  canonical_repository: "$GITHUB_ROOT/agentic-canvas-os"
  canonical_docs_root: "$GITHUB_ROOT/agentic-canvas-os/docs"
  canonical_ref: "origin/main"
  consumer_repository: "$GITHUB_ROOT/knowgrph"
  runtime_guard: "$GITHUB_ROOT/knowgrph/scripts/dev-source-consistency.mjs"
  canonical_rule: "every normal local Dev port requires exactly one registered worktree per repository and a clean canonical Agentic Canvas OS checkout whose HEAD equals fetched origin/main; npm run dev:latest is the explicit clean-main-only, two-phase, fast-forward-only refresh path"
  task_rule: "Knowgrph automatically selects task mode on contract-valid agent branches; explicit KG_DEV_SOURCE_MODE values remain expert overrides and task mode never relaxes the Agentic Canvas OS docs revision"
  parity_rule: "cross-device parity requires identical 40-character Knowgrph and Agentic Canvas OS commit SHAs; matching branch names, ports, or labels are informational and never sufficient"
  runtime_identity_rule: "every served runtime must visibly expose its Knowgrph revision, Agentic Canvas OS docs revision, catalog revision, catalog hydration state, and catalog entry counts"
  runtime_identity_owner_rule: "one application-root runtime owns the canonical Knowgrph identity snapshot globally; route catalogs, panels, and settings views may publish or project facets but must not instantiate competing identity owners"
  runtime_identity_projection_rule: "MainPanel Settings exposes Cross-device Identity Gate as a normal section inside the Settings body using the shared Key-Type-Value row layout; it must not render above or replace the KTV header"
  runtime_identity_export_rule: "Copy identity JSON serializes the current canonical global snapshot without rebuilding or mutating it; each device must capture its own unedited local JSON file, and the copy action alone never proves parity or performs synchronization"
  catalog_freshness_rule: "catalog hydration is keyed by the Agentic Canvas OS docs revision; a revision change invalidates the prior catalog and permits at most two explicit refresh attempts before returning a visible blocked or stale result"
layer_contract:
  soul: "durable agent identity and voice"
  facts: "shared truth and precedence"
  memory: "persistence, routing memory, and reusable local context"
  planning: "bounded index plus append-only cross-repository monthly shards"
  user: "bounded user preferences, communication style, and expectations"
  skills: "on-demand procedural knowledge and progressive disclosure contracts"
  agents: "agent roles, editing rules, and operational behavior"
  dictionaries: "direct token definitions for /, #, and @ invocation grammar"
dictionary_links:
  command: "DICTIONARY-COMMAND.md"
  semantic: "DICTIONARY-SEMANTIC.md"
  binding: "DICTIONARY-BINDING.md"
prompt_preset_catalog: "PROMPT-PRESETS.md"
prompt_preset_contract:
  selection_alias_suffix: "-prompt-preset"
  selection_alias_authority: "PROMPT-PRESETS.md"
  runtime_command_authority: "SKILLS.md and DICTIONARY-COMMAND.md"
  execution_boundary: "selection resolves and loads the source-backed runtime prompt without submit; Send remains the execution boundary"
external_pattern_sources:
  - "https://github.com/NousResearch/hermes-agent"
  - "https://hermes-agent.nousresearch.com/docs/"
  - "https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/personality.md"
  - "https://hermes-agent.nousresearch.com/docs/guides/use-soul-with-hermes"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/memory"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/skills"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/context-references"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-gateway"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/tools"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-search"
  - "https://agentskills.io/specification"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/mixture-of-agents"
  - "https://github.com/NousResearch/hermes-agent-self-evolution"
  - "https://github.com/langchain-ai/langgraph"
  - "https://docs.langchain.com/oss/python/langgraph/overview"
  - "https://docs.langchain.com/oss/python/langgraph/graph-api"
  - "https://github.com/bytedance/deer-flow"
  - "https://github.com/NVIDIA/openshell"
direct_resolution:
  "/session.start": "DICTIONARY-COMMAND.md#/session.start"
  "/release.complete": "DICTIONARY-COMMAND.md#/release.complete"
  "/soul.load": "DICTIONARY-COMMAND.md#/soul.load"
  "/personality.overlay": "DICTIONARY-COMMAND.md#/personality.overlay"
  "/moa": "DICTIONARY-COMMAND.md#/moa"
  "/video-agent": "DICTIONARY-COMMAND.md#/video-agent"
  "/image.to-threejs": "DICTIONARY-COMMAND.md#/image.to-threejs"
  "/image.to-glb": "DICTIONARY-COMMAND.md#/image.to-glb"
  "/query": "DICTIONARY-COMMAND.md#/query"
  "/memory.write": "DICTIONARY-COMMAND.md#/memory.write"
  "/memory.compact": "DICTIONARY-COMMAND.md#/memory.compact"
  "/memory.search": "DICTIONARY-COMMAND.md#/memory.search"
  "/session.search": "DICTIONARY-COMMAND.md#/session.search"
  "/user.profile": "DICTIONARY-COMMAND.md#/user.profile"
  "/skill.discover": "DICTIONARY-COMMAND.md#/skill.discover"
  "/skill.load": "DICTIONARY-COMMAND.md#/skill.load"
  "/skill.bundle": "DICTIONARY-COMMAND.md#/skill.bundle"
  "/skill.manage": "DICTIONARY-COMMAND.md#/skill.manage"
  "/context.discover": "DICTIONARY-COMMAND.md#/context.discover"
  "/context.load": "DICTIONARY-COMMAND.md#/context.load"
  "/context.audit": "DICTIONARY-COMMAND.md#/context.audit"
  "/reference.expand": "DICTIONARY-COMMAND.md#/reference.expand"
  "/reference.audit": "DICTIONARY-COMMAND.md#/reference.audit"
  "/kanban.task": "DICTIONARY-COMMAND.md#/kanban.task"
  "/kanban.handoff": "DICTIONARY-COMMAND.md#/kanban.handoff"
  "/kanban.sync": "DICTIONARY-COMMAND.md#/kanban.sync"
  "/tool.catalog": "DICTIONARY-COMMAND.md#/tool.catalog"
  "/tool.route": "DICTIONARY-COMMAND.md#/tool.route"
  "/tool.provider.select": "DICTIONARY-COMMAND.md#/tool.provider.select"
  "/tool.gateway.audit": "DICTIONARY-COMMAND.md#/tool.gateway.audit"
  "/toolset.enable": "DICTIONARY-COMMAND.md#/toolset.enable"
  "/toolset.disable": "DICTIONARY-COMMAND.md#/toolset.disable"
  "/tool.search": "DICTIONARY-COMMAND.md#/tool.search"
  "/tool.describe": "DICTIONARY-COMMAND.md#/tool.describe"
  "/tool.call": "DICTIONARY-COMMAND.md#/tool.call"
  "/experience.capture": "DICTIONARY-COMMAND.md#/experience.capture"
  "/skill.propose": "DICTIONARY-COMMAND.md#/skill.propose"
  "/skill.evolve": "DICTIONARY-COMMAND.md#/skill.evolve"
  "/identity.reflect": "DICTIONARY-COMMAND.md#/identity.reflect"
  "/orchestration.graph": "DICTIONARY-COMMAND.md#/orchestration.graph"
  "/state.checkpoint": "DICTIONARY-COMMAND.md#/state.checkpoint"
  "/human.review": "DICTIONARY-COMMAND.md#/human.review"
  "/stream.trace": "DICTIONARY-COMMAND.md#/stream.trace"
  "/superagent.run": "DICTIONARY-COMMAND.md#/superagent.run"
  "/sandbox.policy.validate": "DICTIONARY-COMMAND.md#/sandbox.policy.validate"
  "/sandbox.policy.authorize": "DICTIONARY-COMMAND.md#/sandbox.policy.authorize"
  "#truth": "DICTIONARY-SEMANTIC.md##truth"
  "#soul": "DICTIONARY-SEMANTIC.md##soul"
  "#primary-identity": "DICTIONARY-SEMANTIC.md##primary-identity"
  "#personality-overlay": "DICTIONARY-SEMANTIC.md##personality-overlay"
  "#mixture-of-agents": "DICTIONARY-SEMANTIC.md##mixture-of-agents"
  "#reference-agents": "DICTIONARY-SEMANTIC.md##reference-agents"
  "#aggregator-agent": "DICTIONARY-SEMANTIC.md##aggregator-agent"
  "#spec.low": "DICTIONARY-SEMANTIC.md##spec.low"
  "#spec.medium": "DICTIONARY-SEMANTIC.md##spec.medium"
  "#spec.high": "DICTIONARY-SEMANTIC.md##spec.high"
  "#thinking.type.enabled": "DICTIONARY-SEMANTIC.md##thinking.type.enabled"
  "#thinking.type.disabled": "DICTIONARY-SEMANTIC.md##thinking.type.disabled"
  "#thinking.type.auto": "DICTIONARY-SEMANTIC.md##thinking.type.auto"
  "#token-cap.low": "DICTIONARY-SEMANTIC.md##token-cap.low"
  "#token-cap.medium": "DICTIONARY-SEMANTIC.md##token-cap.medium"
  "#token-cap.high": "DICTIONARY-SEMANTIC.md##token-cap.high"
  "#learning-loop": "DICTIONARY-SEMANTIC.md##learning-loop"
  "#persistent-memory": "DICTIONARY-SEMANTIC.md##persistent-memory"
  "#user-profile": "DICTIONARY-SEMANTIC.md##user-profile"
  "#frozen-snapshot": "DICTIONARY-SEMANTIC.md##frozen-snapshot"
  "#memory-capacity": "DICTIONARY-SEMANTIC.md##memory-capacity"
  "#session-search": "DICTIONARY-SEMANTIC.md##session-search"
  "#skill-system": "DICTIONARY-SEMANTIC.md##skill-system"
  "#image-to-threejs": "DICTIONARY-SEMANTIC.md##image-to-threejs"
  "#image-to-glb": "DICTIONARY-SEMANTIC.md##image-to-glb"
  "#progressive-disclosure": "DICTIONARY-SEMANTIC.md##progressive-disclosure"
  "#skill-bundle": "DICTIONARY-SEMANTIC.md##skill-bundle"
  "#agentskills-compatible": "DICTIONARY-SEMANTIC.md##agentskills-compatible"
  "#skill-security": "DICTIONARY-SEMANTIC.md##skill-security"
  "#context-file": "DICTIONARY-SEMANTIC.md##context-file"
  "#project-context": "DICTIONARY-SEMANTIC.md##project-context"
  "#cwd-discovery": "DICTIONARY-SEMANTIC.md##cwd-discovery"
  "#context-reference": "DICTIONARY-SEMANTIC.md##context-reference"
  "#inline-context": "DICTIONARY-SEMANTIC.md##inline-context"
  "#attached-context": "DICTIONARY-SEMANTIC.md##attached-context"
  "#kanban-board": "DICTIONARY-SEMANTIC.md##kanban-board"
  "#task-row": "DICTIONARY-SEMANTIC.md##task-row"
  "#profile-handoff": "DICTIONARY-SEMANTIC.md##profile-handoff"
  "#worker-process": "DICTIONARY-SEMANTIC.md##worker-process"
  "#multi-agent-collaboration": "DICTIONARY-SEMANTIC.md##multi-agent-collaboration"
  "#runtime-ready": "DICTIONARY-SEMANTIC.md##runtime-ready"
  "#tool-gateway": "DICTIONARY-SEMANTIC.md##tool-gateway"
  "#tool-routing": "DICTIONARY-SEMANTIC.md##tool-routing"
  "#web-search": "DICTIONARY-SEMANTIC.md##web-search"
  "#image-generation": "DICTIONARY-SEMANTIC.md##image-generation"
  "#text-to-speech": "DICTIONARY-SEMANTIC.md##text-to-speech"
  "#cloud-browser": "DICTIONARY-SEMANTIC.md##cloud-browser"
  "#tool-function": "DICTIONARY-SEMANTIC.md##tool-function"
  "#toolset": "DICTIONARY-SEMANTIC.md##toolset"
  "#platform-toolset": "DICTIONARY-SEMANTIC.md##platform-toolset"
  "#tool-search": "DICTIONARY-SEMANTIC.md##tool-search"
  "#deferred-tool-schema": "DICTIONARY-SEMANTIC.md##deferred-tool-schema"
  "#bridge-tool": "DICTIONARY-SEMANTIC.md##bridge-tool"
  "#skill-evolution": "DICTIONARY-SEMANTIC.md##skill-evolution"
  "#memory-search": "DICTIONARY-SEMANTIC.md##memory-search"
  "#identity-model": "DICTIONARY-SEMANTIC.md##identity-model"
  "#orchestration-graph": "DICTIONARY-SEMANTIC.md##orchestration-graph"
  "#stateful-agent": "DICTIONARY-SEMANTIC.md##stateful-agent"
  "#durable-execution": "DICTIONARY-SEMANTIC.md##durable-execution"
  "#human-in-loop": "DICTIONARY-SEMANTIC.md##human-in-loop"
  "#long-horizon-harness": "DICTIONARY-SEMANTIC.md##long-horizon-harness"
  "#sandboxed-workspace": "DICTIONARY-SEMANTIC.md##sandboxed-workspace"
  "#agent-sandbox-policy": "DICTIONARY-SEMANTIC.md##agent-sandbox-policy"
  "#message-gateway": "DICTIONARY-SEMANTIC.md##message-gateway"
  "@agent": "DICTIONARY-BINDING.md#@agent"
  "@soul-profile": "DICTIONARY-BINDING.md#@soul-profile"
  "@identity-slot": "DICTIONARY-BINDING.md#@identity-slot"
  "@personality-overlay": "DICTIONARY-BINDING.md#@personality-overlay"
  "@moa-preset": "DICTIONARY-BINDING.md#@moa-preset"
  "@reference-agents": "DICTIONARY-BINDING.md#@reference-agents"
  "@aggregator-agent": "DICTIONARY-BINDING.md#@aggregator-agent"
  "@video-generation-demo-script": "DICTIONARY-BINDING.md#@video-generation-demo-script"
  "@provider.byteplus": "DICTIONARY-BINDING.md#@provider.byteplus"
  "@provider.openai": "DICTIONARY-BINDING.md#@provider.openai"
  "@text": "DICTIONARY-BINDING.md#@text"
  "@image": "DICTIONARY-BINDING.md#@image"
  "@image-to-threejs": "DICTIONARY-BINDING.md#@image-to-threejs"
  "@image-to-glb": "DICTIONARY-BINDING.md#@image-to-glb"
  "@audio": "DICTIONARY-BINDING.md#@audio"
  "@video": "DICTIONARY-BINDING.md#@video"
  "@experience": "DICTIONARY-BINDING.md#@experience"
  "@memory-store": "DICTIONARY-BINDING.md#@memory-store"
  "@memory-entry": "DICTIONARY-BINDING.md#@memory-entry"
  "@memory-snapshot": "DICTIONARY-BINDING.md#@memory-snapshot"
  "@memory-policy": "DICTIONARY-BINDING.md#@memory-policy"
  "@user-profile": "DICTIONARY-BINDING.md#@user-profile"
  "@session-index": "DICTIONARY-BINDING.md#@session-index"
  "@skill-index": "DICTIONARY-BINDING.md#@skill-index"
  "@skill-source": "DICTIONARY-BINDING.md#@skill-source"
  "@skill-reference": "DICTIONARY-BINDING.md#@skill-reference"
  "@skill-bundle": "DICTIONARY-BINDING.md#@skill-bundle"
  "@skill-policy": "DICTIONARY-BINDING.md#@skill-policy"
  "@context-file": "DICTIONARY-BINDING.md#@context-file"
  "@working-directory": "DICTIONARY-BINDING.md#@working-directory"
  "@context-policy": "DICTIONARY-BINDING.md#@context-policy"
  "@file:": "DICTIONARY-BINDING.md#@file:"
  "@folder:": "DICTIONARY-BINDING.md#@folder:"
  "@diff": "DICTIONARY-BINDING.md#@diff"
  "@staged": "DICTIONARY-BINDING.md#@staged"
  "@git:": "DICTIONARY-BINDING.md#@git:"
  "@url:": "DICTIONARY-BINDING.md#@url:"
  "@reference-policy": "DICTIONARY-BINDING.md#@reference-policy"
  "@attached-context": "DICTIONARY-BINDING.md#@attached-context"
  "@kanban-board": "DICTIONARY-BINDING.md#@kanban-board"
  "@task-row": "DICTIONARY-BINDING.md#@task-row"
  "@handoff-row": "DICTIONARY-BINDING.md#@handoff-row"
  "@agent-profile": "DICTIONARY-BINDING.md#@agent-profile"
  "@worker-process": "DICTIONARY-BINDING.md#@worker-process"
  "@tool-gateway": "DICTIONARY-BINDING.md#@tool-gateway"
  "@tool-provider": "DICTIONARY-BINDING.md#@tool-provider"
  "@web-search-tool": "DICTIONARY-BINDING.md#@web-search-tool"
  "@image-tool": "DICTIONARY-BINDING.md#@image-tool"
  "@tts-tool": "DICTIONARY-BINDING.md#@tts-tool"
  "@browser-tool": "DICTIONARY-BINDING.md#@browser-tool"
  "@tool-policy": "DICTIONARY-BINDING.md#@tool-policy"
  "@tool-function": "DICTIONARY-BINDING.md#@tool-function"
  "@toolset": "DICTIONARY-BINDING.md#@toolset"
  "@platform-surface": "DICTIONARY-BINDING.md#@platform-surface"
  "@deferred-tool-catalog": "DICTIONARY-BINDING.md#@deferred-tool-catalog"
  "@bridge-tool": "DICTIONARY-BINDING.md#@bridge-tool"
  "@skill-catalog": "DICTIONARY-BINDING.md#@skill-catalog"
  "@identity-model": "DICTIONARY-BINDING.md#@identity-model"
  "@orchestration-graph": "DICTIONARY-BINDING.md#@orchestration-graph"
  "@state-store": "DICTIONARY-BINDING.md#@state-store"
  "@checkpoint-store": "DICTIONARY-BINDING.md#@checkpoint-store"
  "@human-review": "DICTIONARY-BINDING.md#@human-review"
  "@sandbox-workspace": "DICTIONARY-BINDING.md#@sandbox-workspace"
  "@sandbox-policy": "DICTIONARY-BINDING.md#@sandbox-policy"
  "@message-gateway": "DICTIONARY-BINDING.md#@message-gateway"
  "@operator": "DICTIONARY-BINDING.md#@operator"
  "@source.frontmatter": "DICTIONARY-BINDING.md#@source.frontmatter"
  "@runtime-proof": "DICTIONARY-BINDING.md#@runtime-proof"
truth_tokens:
  commands: ["/query", "/soul.load", "/personality.overlay", "/moa", "/video-agent", "/image.to-threejs", "/image.to-glb", "/memory.seed", "/memory.write", "/memory.compact", "/memory.search", "/session.search", "/user.profile", "/skill.discover", "/skill.load", "/skill.bundle", "/skill.manage", "/context.discover", "/context.load", "/context.audit", "/reference.expand", "/reference.audit", "/kanban.task", "/kanban.handoff", "/kanban.sync", "/tool.catalog", "/tool.route", "/tool.provider.select", "/tool.gateway.audit", "/toolset.enable", "/toolset.disable", "/tool.search", "/tool.describe", "/tool.call", "/experience.capture", "/skill.propose", "/skill.evolve", "/identity.reflect", "/orchestration.graph", "/state.checkpoint", "/human.review", "/stream.trace", "/superagent.run", "/sandbox.policy.validate", "/sandbox.policy.authorize", "/prd-tad.create", "/runtime-ready.check", "/session.start", "/release.complete", "/deploy.guard"]
  semantics: ["#truth", "#frontmatter", "#harness", "#token-economics", "#spec.low", "#spec.medium", "#spec.high", "#thinking.type.enabled", "#thinking.type.disabled", "#thinking.type.auto", "#token-cap.low", "#token-cap.medium", "#token-cap.high", "#vcc", "#no-hardcode", "#soul", "#primary-identity", "#personality-overlay", "#mixture-of-agents", "#reference-agents", "#aggregator-agent", "#learning-loop", "#persistent-memory", "#user-profile", "#frozen-snapshot", "#memory-capacity", "#session-search", "#skill-system", "#image-to-threejs", "#image-to-glb", "#progressive-disclosure", "#skill-bundle", "#agentskills-compatible", "#skill-security", "#context-file", "#project-context", "#cwd-discovery", "#context-reference", "#inline-context", "#attached-context", "#kanban-board", "#task-row", "#profile-handoff", "#worker-process", "#multi-agent-collaboration", "#tool-gateway", "#tool-routing", "#tool-function", "#toolset", "#platform-toolset", "#tool-search", "#deferred-tool-schema", "#bridge-tool", "#web-search", "#image-generation", "#text-to-speech", "#cloud-browser", "#skill-evolution", "#memory-search", "#identity-model", "#orchestration-graph", "#stateful-agent", "#durable-execution", "#human-in-loop", "#long-horizon-harness", "#sandboxed-workspace", "#agent-sandbox-policy", "#message-gateway"]
  bindings: ["@agent", "@operator", "@source.frontmatter", "@source.body", "@local-harness", "@runtime-proof", "@soul-profile", "@identity-slot", "@personality-overlay", "@moa-preset", "@reference-agents", "@aggregator-agent", "@video-generation-demo-script", "@provider.byteplus", "@provider.openai", "@text", "@image", "@image-to-threejs", "@image-to-glb", "@audio", "@video", "@experience", "@memory-store", "@memory-entry", "@memory-snapshot", "@memory-policy", "@user-profile", "@session-index", "@skill-index", "@skill-source", "@skill-reference", "@skill-bundle", "@skill-policy", "@context-file", "@working-directory", "@context-policy", "@file:", "@folder:", "@diff", "@staged", "@git:", "@url:", "@reference-policy", "@attached-context", "@kanban-board", "@task-row", "@handoff-row", "@agent-profile", "@worker-process", "@tool-gateway", "@tool-provider", "@tool-function", "@toolset", "@platform-surface", "@deferred-tool-catalog", "@bridge-tool", "@web-search-tool", "@image-tool", "@tts-tool", "@browser-tool", "@tool-policy", "@skill-catalog", "@identity-model", "@orchestration-graph", "@state-store", "@checkpoint-store", "@human-review", "@sandbox-workspace", "@sandbox-policy", "@message-gateway"]
---

# Agentic OS Facts

`FACTS.md` is the shared truth layer for `docs`. Agents should read it before using local memory or role instructions. It is stronger than tool-specific helper files such as `CLAUDE.md` when those files exist in an adjacent environment, because this file defines repo-owned truth for this documentation control surface.

This file does not replace system, developer, or operator instructions. It defines the source-backed facts that local agents should reference consistently while working inside this docs folder.

## Layer Contract

| Layer | Owns | Does not own |
|---|---|---|
| `SOUL.md` | Durable agent identity, voice, style, and communication defaults. | Project commands, architecture rules, memory persistence, deploy permission, or provider state. |
| `FACTS.md` | Shared truth, precedence, direct invocation definitions, deploy boundary facts. | Persistence, role prompts, command execution, provider state. |
| `MEMORY.md` | Bounded agent notes, environment facts, conventions, lessons learned, and reusable runtime-readiness memory. | User profile, top-level truth precedence, identity, or release authorization. |
| `USER.md` | Bounded user preferences, communication style, and expectations. | Agent identity, project operations, environment notes, secrets, or unsupported personal inference. |
| `SKILLS.md` | On-demand procedural knowledge contracts, progressive disclosure rules, skill variants, bundles, and skill write gates. | Separate runtime installation, copied external skills, provider secrets, or deployment authorization. |
| `AGENTS.md` | Agent roles, edit rules, validation behavior, forbidden patterns. | Source facts that contradict this file. |
| `DICTIONARY-COMMAND.md` | Slash command definitions. | Command runtime or parser fork. |
| `DICTIONARY-SEMANTIC.md` | Hash semantic definitions. | Semantic registry fork or runtime-ready promotion by prose. |
| `DICTIONARY-BINDING.md` | At binding definitions. | Secrets, approval grants, or deployment authorization. |

## Precedence Facts

| Fact | Rule | Proof or source |
|---|---|---|
| Shared truth | `FACTS.md` is the first local docs file to consult for stable Agentic OS truth. | This file plus `README.md` document map. |
| Persistence | `MEMORY.md` persists local context and reusable routing memory after facts are known. | `MEMORY.md` frontmatter and body. |
| User profile | `USER.md` persists explicit operator preferences, communication style, and expectations separately from agent notes. | `USER.md` frontmatter and body. |
| Roles | `AGENTS.md` governs how agents edit and validate this folder. | `AGENTS.md` scope and validation sections. |
| Invocation grammar | `/`, `#`, and `@` tokens resolve through dictionary files, not prose-only UI labels. | `DICTIONARY-COMMAND.md`, `DICTIONARY-SEMANTIC.md`, `DICTIONARY-BINDING.md`. |
| Prompt preset selection | FloatingPanel Prompt Presets expose catalog-owned `/*-prompt-preset` selection aliases while executable `/...-agent` routes remain owned by `SKILLS.md` and `DICTIONARY-COMMAND.md`; selection loads without submit. | `PROMPT-PRESETS.md`, `SKILLS.md`, `DICTIONARY-COMMAND.md`. |
| Canonical docs revision | Every normal Knowgrph Dev port consumes `$GITHUB_ROOT/agentic-canvas-os/docs` from one clean local checkout whose `HEAD` equals fetched `origin/main`. Port numbers and Knowgrph task mode cannot select or relax that revision. | `source_revision_contract` above and the Knowgrph runtime guard named there. |
| Cross-device parity | Devices are in parity only when their visible runtime identities report identical exact Knowgrph and Agentic Canvas OS commit SHAs. A shared branch name, port, route, or device label is not revision proof. | `source_revision_contract` above, `START-WORKFLOW.md`, and `VALIDATION-RUNBOOK.md`. |
| Visible runtime identity | The running surface must expose exact `knowgrphRevision`, `agenticCanvasOsRevision`, `catalogRevision`, `catalogHydration.status`, `catalogHydration.attempts`, and `/`, `#`, `@` counts. Hidden build metadata or terminal-only branch output is insufficient. | `VALIDATION-RUNBOOK.md` runtime identity schema and `RUNTIME-PROOF.md`. |
| Canonical identity ownership | Exactly one application-root runtime owns the global identity snapshot. MainPanel Settings, FloatingPanel, Chat, Skills & Commands, and `/`, `#`, `@` catalog consumers are projections or facet publishers only; none may create a second identity store, owner, or catalog-coupled identity component. | `source_revision_contract` above and `VALIDATION-RUNBOOK.md` identity-ownership check. |
| Settings identity projection | `Cross-device Identity Gate` is a normal collapsible MainPanel Settings body section that uses the shared KTV row contract. A standalone gate above the KTV header, a Skills & Commands-owned gate, or a custom non-KTV identity table fails compliance. | `VALIDATION-RUNBOOK.md` identity-ownership check and `START-WORKFLOW.md`. |
| Identity JSON export | `Copy identity JSON` copies the canonical snapshot already consumed by Settings. It must not rebuild identity from catalog state, mutate the store, synchronize devices, or mark parity. Every participating device saves its own unedited export to a temporary local JSON file; copied or manually reconstructed evidence fails compliance. | `VALIDATION-RUNBOOK.md` capture procedure and ownership check. |
| Catalog freshness | `catalogRevision` must equal `agenticCanvasOsRevision`. Hydration caches use that revision as part of their key, invalidate on revision change, and stop after no more than two explicit refresh attempts with a visible `fresh`, `blocked`, or `stale` result. | `VALIDATION-RUNBOOK.md` and `RELEASE-WORKFLOW.md`. |
| Primary identity inspiration | External SOUL systems are pattern references only. This repo may adopt a neutral durable identity contract that occupies prompt slot 1 when an approved runtime assembles prompts. | Official Hermes Agent SOUL docs listed in frontmatter. |
| Runtime status | `runtime-ready` requires surfaced proof; prose alone cannot promote external runtime claims. | `RUNTIME-READINESS.md` and `VALIDATION-RUNBOOK.md`. |
| Deployment boundary | Dev, Prod mirror, and Cloudflare are separate. Prod and Cloudflare stay forbidden until explicit operator instruction. | `MEMORY.md`, `AGENTS.md`, `RUNTIME-READINESS.md`. |
| Learning-loop inspiration | External self-improving agent systems are pattern references only. This repo may adopt neutral contracts for experience capture, memory search, skill proposals, bounded evolution, and identity reflection. | Official Hermes Agent docs and repositories listed in frontmatter. |
| Persistent memory inspiration | External persistent-memory systems are pattern references only. This repo may adopt neutral contracts for bounded agent notes, bounded user profile, frozen prompt snapshots, capacity errors, write actions, security scanning, and session search. | Official Hermes Agent memory docs listed in frontmatter. |
| Skills system inspiration | External skill systems are pattern references only. This repo may adopt neutral contracts for on-demand skills, progressive disclosure, bundles, managed writes, open-standard frontmatter, and resource loading. | Official Hermes Agent skills docs and Agent Skills specification listed in frontmatter. |
| Context files inspiration | External context-file systems are pattern references only. This repo may adopt neutral contracts for working-directory discovery, first-match project context, progressive subdirectory hints, security scans, truncation, and effective-context audit. | Official Hermes Agent context files docs listed in frontmatter. |
| Context references inspiration | External context-reference systems are pattern references only. This repo may adopt neutral contracts for explicit `@` message references that expand into bounded attached context on supported surfaces. | Official Hermes Agent context references docs listed in frontmatter. |
| Kanban collaboration inspiration | Context-reference patterns may inform how agents attach board rows or context refs, but the durable multi-agent board is local `kanban.md` plus shared table/Kanban utilities. | This file, dictionaries, `kanban.md`, and `HARNESS-CONTRACTS.md`. |
| Tool gateway inspiration | External tool gateways are pattern references only. This repo may adopt neutral contracts for per-tool routing, gateway/direct-provider selection, web search, image generation, text-to-speech, cloud browser automation, status, and usage. | Official Hermes Agent Tool Gateway docs listed in frontmatter. |
| Tools and toolsets inspiration | External tool registries are pattern references only. This repo may adopt neutral contracts for callable tool functions, logical toolsets, and per-platform enable or disable state. | Official Hermes Agent Tools and Toolsets docs listed in frontmatter. |
| Tool search inspiration | External tool-search layers are pattern references only. This repo may adopt neutral contracts for opt-in schema deferral, bridge search/describe/call routes, session-scoped deferred catalogs, and real-tool policy enforcement. | Official Hermes Agent Tool Search docs listed in frontmatter. |
| Mixture-of-agents inspiration | External MoA systems are pattern references only. This repo may adopt a neutral one-shot `/moa` contract for bounded reference-agent deliberation, aggregator-owned action, cost accounting, and prompt-cache-preserving context. | Official Hermes Agent MoA docs listed in frontmatter. |
| Stateful orchestration inspiration | External graph orchestration frameworks are pattern references only. This repo may adopt neutral contracts for graph state, nodes, edges, checkpoints, streaming traces, and human review. | Official LangGraph repository and docs listed in frontmatter. |
| Long-horizon SuperAgent inspiration | External SuperAgent harnesses are pattern references only. This repo may adopt neutral contracts for minutes-to-hours research, coding, creation, sandbox workspaces, memory, skills, tools, subagents, and message gateways. | DeerFlow repository listed in frontmatter. |
| Copy boundary | External code, APIs, prompts, schemas, examples, files, tests, fixtures, and prose must not be copied into this docs folder. | `AGENTS.md`, `SKILLS.md`, `VALIDATION-RUNBOOK.md`. |

## Direct Invocation Definitions

| Token | Dictionary | Definition | Required behavior |
|---|---|---|---|
| `/soul.load` | `DICTIONARY-COMMAND.md` | Route for loading durable agent identity from `SOUL.md` into prompt slot 1. | Scan, bound, and inject `@soul-profile` before operational context; reject hardcoded silent defaults. |
| `/personality.overlay` | `DICTIONARY-COMMAND.md` | Route for temporary session-level voice or mode overlay. | Overlay may adjust style for a session but must not mutate `SOUL.md` or override facts, roles, memory, safety, or deploy gates. |
| `/moa` | `DICTIONARY-COMMAND.md` | One-shot Mixture of Agents route for hard queries that benefit from multiple bounded reference-agent perspectives before one aggregator response. | Resolve a local preset, run references as advisory no-tool calls, pass private advisory context to the aggregator, preserve normal tool gates, restore prior model context, and log added token cost. |
| `#soul` | `DICTIONARY-SEMANTIC.md` | Semantic route for durable agent identity and voice. | Keep identity broad, stable, source-backed, and separate from project operations. |
| `#primary-identity` | `DICTIONARY-SEMANTIC.md` | Semantic route for prompt slot 1 identity replacement. | Resolve `@soul-profile` or return typed fallback; do not embed hardcoded identity in runtime code. |
| `#personality-overlay` | `DICTIONARY-SEMANTIC.md` | Semantic route for temporary personality or style mode. | Session-only; cannot rewrite `SOUL.md` or bypass higher-priority instructions. |
| `@soul-profile` | `DICTIONARY-BINDING.md` | Binding for durable identity source. | Must be scanned, bounded, and non-operational. |
| `@identity-slot` | `DICTIONARY-BINDING.md` | Binding for prompt slot 1 identity position. | Must be filled from `SOUL.md` or a typed fallback result, not silent hardcode. |
| `@personality-overlay` | `DICTIONARY-BINDING.md` | Binding for session-level style overlay. | Must be temporary and subordinate to facts, roles, memory, and safety gates. |
| `/query` | `DICTIONARY-COMMAND.md` | Read-only command route for answering from `FACTS.md`, dictionaries, memory, and cited source docs. | Return source-backed facts or a typed gap; do not mutate files, spend tokens, or deploy. |
| `/memory.write` | `DICTIONARY-COMMAND.md` | Route for adding, replacing, or removing bounded memory entries. | Require target, action, evidence, capacity check, scan, and typed result before persistence. |
| `/memory.compact` | `DICTIONARY-COMMAND.md` | Route for consolidating memory when bounded capacity would overflow. | Merge or remove stale entries deliberately; never silently drop content. |
| `#mixture-of-agents` | `DICTIONARY-SEMANTIC.md` | Semantic route for bounded multi-agent deliberation. | Require preset, reference-agent list, aggregator, cost bounds, no recursive MoA, and no copied external configuration. |
| `#reference-agents` | `DICTIONARY-SEMANTIC.md` | Semantic route for advisory model or agent calls used before aggregation. | References are no-tool, bounded, private-context producers; failed references degrade without aborting unless policy requires fail-closed. |
| `#aggregator-agent` | `DICTIONARY-SEMANTIC.md` | Semantic route for the single acting model or agent that produces the user-visible response. | Aggregator owns final answer, tool calls, approvals, and follow-up iteration through the normal harness. |
| `@moa-preset` | `DICTIONARY-BINDING.md` | Binding for a local MoA preset that names neutral reference and aggregator roles. | Must avoid hardcoded provider ids and reject recursive MoA aggregation. |
| `@reference-agents` | `DICTIONARY-BINDING.md` | Binding for bounded advisory calls in an MoA run. | Must be no-tool, capped, secret-free, and cost-logged. |
| `@aggregator-agent` | `DICTIONARY-BINDING.md` | Binding for the acting aggregator in an MoA run. | Must use normal tool schemas, approval gates, transcript persistence, and fallback rules. |
| `/session.search` | `DICTIONARY-COMMAND.md` | Route for on-demand search over prior conversations or session records. | Return cited matches without automatically promoting results into memory or profile. |
| `/user.profile` | `DICTIONARY-COMMAND.md` | Route for explicit user profile updates. | Save only operator-stated preferences, communication style, and expectations; reject unsupported inference. |
| `/skill.discover` | `DICTIONARY-COMMAND.md` | Route for zero-spend skill metadata discovery. | Return name, description, category, source, trust, and compatibility without loading full skill bodies. |
| `/skill.load` | `DICTIONARY-COMMAND.md` | Route for loading one on-demand skill and optional referenced resource. | Load full source only after selection; load referenced files only when required; reject deep reference chains. |
| `/skill.bundle` | `DICTIONARY-COMMAND.md` | Route for grouping several installed skills behind one command. | Resolve all listed skills, report skipped missing skills, and keep bundle instructions bounded. |
| `/skill.manage` | `DICTIONARY-COMMAND.md` | Route for create, patch, edit, delete, or supporting-file changes. | Require source evidence, scan, validation, operator review when gated, and no direct auto-commit. |
| `/context.discover` | `DICTIONARY-COMMAND.md` | Route for discovering project-local context files from a working directory. | Use scoped startup and touched-path discovery, first-match project context, zero model spend, and no mutation. |
| `/context.load` | `DICTIONARY-COMMAND.md` | Route for loading one scanned and bounded context file. | Scan for injection and secrets, truncate within policy, and return loaded or blocked state. |
| `/context.audit` | `DICTIONARY-COMMAND.md` | Route for inspecting effective project context and safety state. | Report precedence, loaded files, skipped files, truncation, stale risks, and proof without rewriting files. |
| `/reference.expand` | `DICTIONARY-COMMAND.md` | Route for expanding explicit inline context references into appended context packets. | Resolve only approved forms, preserve original message text, scan and bound content, and return typed warnings or refusals before injection. |
| `/reference.audit` | `DICTIONARY-COMMAND.md` | Route for inspecting context-reference expansion source, size, warnings, and safety. | Report supported platform, refused targets, truncation, source metadata, and proof without fetching or mutating extra content. |
| `/kanban.task` | `DICTIONARY-COMMAND.md` | Route for creating or updating one durable task row in `kanban.md`. | Validate row schema through shared table/Kanban utilities; require owner profile, status, evidence, acceptance, and next action. |
| `/kanban.handoff` | `DICTIONARY-COMMAND.md` | Route for writing one handoff row readable by another named profile. | Record from, to, task id, context refs, blockers, resume state, and acceptance without in-process subagent state. |
| `/kanban.sync` | `DICTIONARY-COMMAND.md` | Route for reconciling board rows across worker processes. | Preserve `kanban.md` as SSOT, surface conflicts, and avoid hidden worker memory as the source of truth. |
| `/tool.catalog` | `DICTIONARY-COMMAND.md` | Route for reading available tool categories and providers. | Return gateway, direct, local, and unavailable provider states with zero model spend. |
| `/tool.route` | `DICTIONARY-COMMAND.md` | Route for executing one approved tool call through the selected provider. | Validate category, provider, input schema, approval, cost, and fallback before tool execution. |
| `/tool.provider.select` | `DICTIONARY-COMMAND.md` | Route for choosing gateway or direct provider per tool category. | Store non-secret routing preference only; keep credentials server-managed and allow direct-provider fallback. |
| `/tool.gateway.audit` | `DICTIONARY-COMMAND.md` | Route for checking tool routing, usage, cost, and deploy boundaries. | Report per-tool status, usage, cost, and blocked reasons without invoking tools. |
| `/toolset.enable` | `DICTIONARY-COMMAND.md` | Route for enabling a logical toolset on a platform surface. | Validate platform scope, tool functions, policy, approval, and cost boundary before enabling. |
| `/toolset.disable` | `DICTIONARY-COMMAND.md` | Route for disabling a logical toolset on a platform surface. | Disable by platform scope without deleting tools, credentials, history, or unrelated provider state. |
| `/tool.search` | `DICTIONARY-COMMAND.md` | Route for searching the session-scoped deferred-tool catalog. | Return ranked metadata or typed empty/disabled result without loading full schemas or executing tools. |
| `/tool.describe` | `DICTIONARY-COMMAND.md` | Route for loading one eligible deferred tool schema on demand. | Resolve from the current session catalog only; reject stale, missing, disabled, or policy-blocked tools. |
| `/tool.call` | `DICTIONARY-COMMAND.md` | Route for invoking a selected deferred tool through a bridge. | Unwrap to the real tool identity for schema validation, approval, hooks, audit, cost, and fallback. |
| `#persistent-memory` | `DICTIONARY-SEMANTIC.md` | Semantic route for bounded curated memory across sessions. | Require capacity, scan, duplicate prevention, target separation, and typed fallback. |
| `#user-profile` | `DICTIONARY-SEMANTIC.md` | Semantic route for explicit operator preferences and expectations. | Keep profile entries explicit, bounded, non-secret, and separate from agent notes. |
| `#frozen-snapshot` | `DICTIONARY-SEMANTIC.md` | Semantic route for memory/profile prompt snapshots captured at session start. | Mid-session writes persist but do not mutate the active prompt snapshot. |
| `#memory-capacity` | `DICTIONARY-SEMANTIC.md` | Semantic route for character/token budgets on memory stores. | Overflow returns a typed capacity error and requires compaction or removal before retry. |
| `#session-search` | `DICTIONARY-SEMANTIC.md` | Semantic route for searching past conversations on demand. | Search is not memory; results require explicit capture before persistence. |
| `@memory-entry` | `DICTIONARY-BINDING.md` | Binding for one bounded memory/profile entry. | Entry must be compact, cited, non-secret, and target-scoped. |
| `@memory-snapshot` | `DICTIONARY-BINDING.md` | Binding for frozen session-start memory/profile context. | Immutable for the active prompt after session start. |
| `@memory-policy` | `DICTIONARY-BINDING.md` | Binding for write approval, capacity, scan, duplicate, and compaction policy. | Must fail closed on unsafe or overflowing writes. |
| `@user-profile` | `DICTIONARY-BINDING.md` | Binding for bounded user profile store. | Explicit preferences only; no unsupported personal inference. |
| `@session-index` | `DICTIONARY-BINDING.md` | Binding for searchable past-session records. | Read-only search unless an explicit memory capture is approved. |
| `#skill-system` | `DICTIONARY-SEMANTIC.md` | Semantic route for on-demand procedural knowledge. | Keep skill metadata small, load detailed instructions only when selected, and validate open-standard shape. |
| `#progressive-disclosure` | `DICTIONARY-SEMANTIC.md` | Semantic route for token-minimizing staged loading. | Index metadata loads first; full `SKILL.md` and resources load only when needed. |
| `#skill-bundle` | `DICTIONARY-SEMANTIC.md` | Semantic route for grouped skills under one invocation. | Bundles are aliases over existing skills, not installs or hardcoded registries. |
| `#agentskills-compatible` | `DICTIONARY-SEMANTIC.md` | Semantic route for open-standard skill file shape. | Require standard frontmatter, concise description, body instructions, optional resources, and validation. |
| `#skill-security` | `DICTIONARY-SEMANTIC.md` | Semantic route for scanning and approval of skill sources and writes. | Fail closed on dangerous content, unsafe env setup, copied external artifacts, or unreviewed mutation. |
| `#context-file` | `DICTIONARY-SEMANTIC.md` | Semantic route for project-local instruction files. | Context shapes behavior only after discovery, scan, truncation, and precedence checks. |
| `#project-context` | `DICTIONARY-SEMANTIC.md` | Semantic route for scoped project behavior. | Context cannot override `FACTS.md`, `SOUL.md`, system, developer, operator, safety, or deploy gates. |
| `#cwd-discovery` | `DICTIONARY-SEMANTIC.md` | Semantic route for startup and touched-path context discovery. | Scan only scoped working directories and checked ancestors/subdirectories; avoid global sweeps. |
| `#context-reference` | `DICTIONARY-SEMANTIC.md` | Semantic route for explicit `@` message references. | Distinguish message expansion forms from normal `@` bindings; unsupported forms remain raw text with typed warning. |
| `#inline-context` | `DICTIONARY-SEMANTIC.md` | Semantic route for content injected into the effective request. | Injection occurs only on supported surfaces after policy, workspace, egress, and size checks. |
| `#attached-context` | `DICTIONARY-SEMANTIC.md` | Semantic route for appended expansion packets. | Packets carry reference token, normalized source, warning/refusal, truncation, size, and cost metadata. |
| `#kanban-board` | `DICTIONARY-SEMANTIC.md` | Semantic route for the durable shared task board. | Board rows stay in `kanban.md` and render through existing multi-dimensional table/Kanban utilities. |
| `#task-row` | `DICTIONARY-SEMANTIC.md` | Semantic route for one durable work item. | Task rows carry stable ids, profile ownership, status, priority, evidence, acceptance, and next action. |
| `#profile-handoff` | `DICTIONARY-SEMANTIC.md` | Semantic route for profile-to-profile transfer. | Handoffs are rows anyone can read and update, not private chat context. |
| `#worker-process` | `DICTIONARY-SEMANTIC.md` | Semantic route for a full OS process worker. | Workers have their own identity, cwd, command, proof, bounds, and cleanup. |
| `#multi-agent-collaboration` | `DICTIONARY-SEMANTIC.md` | Semantic route for durable collaboration across named profiles. | Coordination happens through board rows and context refs instead of fragile in-process swarms. |
| `@skill-index` | `DICTIONARY-BINDING.md` | Binding for lightweight skill metadata. | Must not include full instruction bodies or secrets. |
| `@skill-source` | `DICTIONARY-BINDING.md` | Binding for one `SKILL.md` source. | Must parse, stay bounded, and remain source-backed. |
| `@skill-reference` | `DICTIONARY-BINDING.md` | Binding for optional scripts, references, templates, or assets. | Load on demand, keep references shallow, and validate before use. |
| `@skill-bundle` | `DICTIONARY-BINDING.md` | Binding for a bundle manifest. | Must resolve to existing skills and report missing entries. |
| `@skill-policy` | `DICTIONARY-BINDING.md` | Binding for trust, scan, write approval, and compatibility policy. | Blocks unsafe installs, writes, and incompatible skill loads before execution. |
| `@context-file` | `DICTIONARY-BINDING.md` | Binding for one discovered context file. | Read-only by default, scanned, bounded, and subordinate to stronger truth, identity, role, and operator layers. |
| `@working-directory` | `DICTIONARY-BINDING.md` | Binding for the context discovery root. | Must be explicit and scoped to the current project or touched path. |
| `@context-policy` | `DICTIONARY-BINDING.md` | Binding for precedence, security scan, truncation, and discovery rules. | First-match project context, per-directory visited set, and fail-closed blocking are required. |
| `@file:` | `DICTIONARY-BINDING.md` | Binding form for a file or line-range context reference. | Workspace-scoped, text-only, 1-indexed line ranges, sensitive path block, binary reject, and bounded output. |
| `@folder:` | `DICTIONARY-BINDING.md` | Binding form for a directory context reference. | Bounded listing or summary only; skip sensitive children with warnings and avoid recursive content dumps. |
| `@diff` | `DICTIONARY-BINDING.md` | Binding form for unstaged diff context. | Read-only, scanned, bounded, and not approval to revert or write. |
| `@staged` | `DICTIONARY-BINDING.md` | Binding form for staged diff context. | Read-only, scanned, bounded, and not approval to commit. |
| `@git:` | `DICTIONARY-BINDING.md` | Binding form for bounded recent git history or patch context. | Clamp revision count, warn on missing refs, and scan content before attachment. |
| `@url:` | `DICTIONARY-BINDING.md` | Binding form for URL content context. | Requires approved egress, no embedded credentials, citation/cache metadata, and size bounds. |
| `@reference-policy` | `DICTIONARY-BINDING.md` | Binding for context-reference scan, platform, size, and egress rules. | Missing policy preserves raw text; it never authorizes arbitrary file or URL access. |
| `@attached-context` | `DICTIONARY-BINDING.md` | Binding for the expansion packet appended to a message. | Source, warning/refusal, size, truncation, and cost posture are required. |
| `@kanban-board` | `DICTIONARY-BINDING.md` | Binding for `kanban.md`. | Board is the durable SSOT; no duplicate browser-only or process-local task store. |
| `@task-row` | `DICTIONARY-BINDING.md` | Binding for one task row. | Row validates through shared table/Kanban utilities before write. |
| `@handoff-row` | `DICTIONARY-BINDING.md` | Binding for one handoff row. | Row names profiles, task id, context refs, blockers, resume state, and acceptance. |
| `@agent-profile` | `DICTIONARY-BINDING.md` | Binding for a named worker profile. | Profile identity is explicit and does not imply approval, spend, or deploy. |
| `@worker-process` | `DICTIONARY-BINDING.md` | Binding for a full OS process worker. | Process owns identity, cwd, command, proof, resource bounds, and cleanup. |
| `#tool-gateway` | `DICTIONARY-SEMANTIC.md` | Semantic route for routing tool calls through existing `knowgrph` infrastructure. | Use local MCP, Pages HTTP MCP, Browser WebMCP, or Cloudflare control-plane owners already present; do not add a new proxy. |
| `#tool-routing` | `DICTIONARY-SEMANTIC.md` | Semantic route for per-tool provider selection and fallback. | Each category resolves gateway, direct, local, or unavailable state before execution. |
| `#web-search` | `DICTIONARY-SEMANTIC.md` | Semantic route for search and page extraction tools. | Require source allowlist, citation capture, egress policy, and cost log. |
| `#image-generation` | `DICTIONARY-SEMANTIC.md` | Semantic route for image generation tools. | Require prompt, model/provider selection, approval gate, artifact boundary, and cost log. |
| `#text-to-speech` | `DICTIONARY-SEMANTIC.md` | Semantic route for TTS and audio narration tools. | Require voice/provider selection, text bounds, approval gate, output manifest, and cost log. |
| `#cloud-browser` | `DICTIONARY-SEMANTIC.md` | Semantic route for cloud browser automation. | Require browser action schema, session boundary, screenshot/vision limits, approval gate, and secret redaction. |
| `#tool-function` | `DICTIONARY-SEMANTIC.md` | Semantic route for one callable capability exposed to the agent. | Tool function has schema, owner, risk class, approval policy, cost posture, and typed fallback. |
| `#toolset` | `DICTIONARY-SEMANTIC.md` | Semantic route for a logical group of tool functions. | Toolset resolves to existing tool functions and never invents missing tools or copies external registries. |
| `#platform-toolset` | `DICTIONARY-SEMANTIC.md` | Semantic route for platform-scoped toolset enablement. | Enablement is scoped to a named platform surface and does not grant global access. |
| `#tool-search` | `DICTIONARY-SEMANTIC.md` | Semantic route for opt-in deferred-tool progressive disclosure. | Defer only eligible MCP or non-core plugin schemas when policy and schema budget justify it. |
| `#deferred-tool-schema` | `DICTIONARY-SEMANTIC.md` | Semantic route for a tool schema hidden until a describe action loads it. | Load schema only after selection from the current session catalog. |
| `#bridge-tool` | `DICTIONARY-SEMANTIC.md` | Semantic route for the small model-visible bridge. | Bridge cannot bypass real tool policy, approval, audit, hooks, cost, or fallback. |
| `@tool-gateway` | `DICTIONARY-BINDING.md` | Binding for the selected `knowgrph` tool routing surface. | Must be existing infrastructure; no new gateway service or deploy claim without approval. |
| `@tool-provider` | `DICTIONARY-BINDING.md` | Binding for gateway, direct, local, or unavailable provider state. | Provider choice is per-tool and non-secret. |
| `@web-search-tool` | `DICTIONARY-BINDING.md` | Binding for search/extract capability. | Requires citation, egress, and cost policy. |
| `@image-tool` | `DICTIONARY-BINDING.md` | Binding for image generation capability. | Requires approval and artifact manifest. |
| `@tts-tool` | `DICTIONARY-BINDING.md` | Binding for text-to-speech capability. | Requires voice, duration, output, and cost bounds. |
| `@browser-tool` | `DICTIONARY-BINDING.md` | Binding for cloud browser automation capability. | Requires session isolation, action schema, and redaction. |
| `@tool-policy` | `DICTIONARY-BINDING.md` | Binding for approval, egress, secret, cost, and fallback policy. | Paid, mutating, browser-auth, and deploy actions fail closed without approval. |
| `@tool-function` | `DICTIONARY-BINDING.md` | Binding for one callable tool function. | Must name schema, owner, risk class, and typed result without raw credentials. |
| `@toolset` | `DICTIONARY-BINDING.md` | Binding for a logical bundle of tool functions. | Must resolve existing functions and preserve per-platform enablement state. |
| `@platform-surface` | `DICTIONARY-BINDING.md` | Binding for CLI, chat, browser, MCP, or other execution surface. | Toolset enablement is scoped; no platform inherits tools implicitly. |
| `@deferred-tool-catalog` | `DICTIONARY-BINDING.md` | Binding for the session-scoped catalog of eligible deferred tools. | Rebuild from currently granted tools; never expose disabled, global, or stale entries. |
| `@bridge-tool` | `DICTIONARY-BINDING.md` | Binding for the model-visible deferred-tool bridge. | Must dispatch under the underlying real tool identity and policy. |
| `#truth` | `DICTIONARY-SEMANTIC.md` | Semantic route for source-backed facts that are stable enough for agent reuse. | Prefer frontmatter and dictionary definitions; reject stale, inferred, or display-only claims. |
| `@agent` | `DICTIONARY-BINDING.md` | Binding for an executing agent subject to `FACTS.md`, `AGENTS.md`, and explicit operator instructions. | Follow facts first, use memory for persistence, and keep deployment gates closed. |
| `/orchestration.graph` | `DICTIONARY-COMMAND.md` | Route for declaring or validating a stateful orchestration graph. | Require typed state, nodes, edges, bounds, checkpoints, and proof. |
| `/state.checkpoint` | `DICTIONARY-COMMAND.md` | Route for checkpoint and resume contracts. | Persist resumable state only through approved stores with typed recovery behavior. |
| `/human.review` | `DICTIONARY-COMMAND.md` | Route for human-in-loop interrupt, inspection, edit, approval, and resume. | Block mutating or paid continuation until approval is present. |
| `/stream.trace` | `DICTIONARY-COMMAND.md` | Route for streaming state transitions and execution trace events. | Emit observable stage, state, cost, and stop-condition data without leaking secrets. |
| `#orchestration-graph` | `DICTIONARY-SEMANTIC.md` | Semantic route for state, nodes, edges, and graph compile checks. | Reject orphaned nodes, unbounded loops, hidden state mutation, and parser forks. |
| `#stateful-agent` | `DICTIONARY-SEMANTIC.md` | Semantic route for long-running agents with durable state. | Require state schema, checkpoint plan, memory boundary, and resume contract. |
| `#durable-execution` | `DICTIONARY-SEMANTIC.md` | Semantic route for fault-tolerant long-running execution. | Require checkpoint, idempotency, retry, timeout, and recovery VCCs. |
| `#human-in-loop` | `DICTIONARY-SEMANTIC.md` | Semantic route for operator inspection or approval inside a run. | Require interrupt payload, resume payload, approval gate, and audit event. |
| `@orchestration-graph` | `DICTIONARY-BINDING.md` | Binding for graph topology and execution state. | Must be source-backed and projection-safe. |
| `@state-store` | `DICTIONARY-BINDING.md` | Binding for scoped state snapshots. | Must be typed, scoped, and secret-free. |
| `@checkpoint-store` | `DICTIONARY-BINDING.md` | Binding for resumable checkpoints. | Must support recovery proof and deploy boundary reporting. |
| `@human-review` | `DICTIONARY-BINDING.md` | Binding for operator review events. | Must block continuation until approved or rejected. |
| `/superagent.run` | `DICTIONARY-COMMAND.md` | Long-horizon route for bounded research, coding, and creation workflows. | Requires source-backed graph, sandbox workspace, message gateway, checkpoints, artifacts, verification, and cost ledger. |
| `#long-horizon-harness` | `DICTIONARY-SEMANTIC.md` | Semantic route for minutes-to-hours agent runs with multiple skills, tools, and artifacts. | Reject hidden loops, copied runtime layouts, missing stop conditions, and unbounded token spend. |
| `#sandboxed-workspace` | `DICTIONARY-SEMANTIC.md` | Semantic route for scoped file and execution environment used by a run. | Workspace root, allowed operations, diff summary, artifact manifest, secret scan, cleanup, and approvals are required. |
| `#message-gateway` | `DICTIONARY-SEMANTIC.md` | Semantic route for typed inter-stage messages, handoffs, and status events. | Sender, recipient, schema, run id, state transition, replay/idempotency, and visibility boundary are required. |
| `@sandbox-workspace` | `DICTIONARY-BINDING.md` | Binding for the workspace scope used by long-horizon runs. | Cannot imply host-wide filesystem access or deploy permission. |
| `@message-gateway` | `DICTIONARY-BINDING.md` | Binding for the typed message route between agent, worker, tool, review, and artifact stages. | Cannot bypass approval, cost, or proof gates. |

## Learning Loop Facts

| Fact | Rule | Proof or source |
|---|---|---|
| Tool gateway routing | Tool calls route through existing `knowgrph` infrastructure surfaces: local MCP, Pages HTTP MCP, Browser WebMCP, or approved Cloudflare control-plane owners. | `/tool.route`, `#tool-gateway`, `@tool-gateway`. |
| Tool functions | Tools are callable functions that extend an agent through typed schemas and existing runtime owners. | `#tool-function`, `@tool-function`, `/tool.catalog`. |
| Toolsets | Toolsets are logical groups of existing tool functions that can be enabled or disabled by platform. | `#toolset`, `@toolset`, `/toolset.enable`, `/toolset.disable`. |
| Platform scoping | A toolset enabled for one surface does not imply access from another surface. | `#platform-toolset`, `@platform-surface`, `@tool-policy`. |
| Tool Search eligibility | Tool Search defers only eligible MCP and non-core plugin tool schemas; core required tools stay direct. | `/tool.search`, `#tool-search`, `@deferred-tool-catalog`. |
| Tool Search catalog | The deferred catalog is session-scoped and rebuilt from current granted tool definitions; no stale global map is authoritative. | `@deferred-tool-catalog`, `#deferred-tool-schema`. |
| Tool Search bridge | Bridge calls unwrap to the underlying tool identity for policy, approval, hooks, audit, cost, and fallback. | `/tool.call`, `#bridge-tool`, `@bridge-tool`, `@tool-policy`. |
| Tool Search activation | Activation is opt-in or budget-threshold based and should disable below budget because bridge schemas and extra round trips have cost. | `#token-economics`, `#progressive-disclosure`. |
| Per-tool provider selection | Web search, image generation, TTS, and cloud browser automation choose gateway, direct, local, or unavailable provider state independently. | `/tool.provider.select`, `#tool-routing`, `@tool-provider`. |
| Tool catalog | Gateway status is discoverable without executing a tool or spending model tokens. | `/tool.catalog`, `@tool-provider`, `#tool-gateway`. |
| Web search | Search and extraction tools must return citations, source scope, egress state, and cost logs. | `#web-search`, `@web-search-tool`, `@tool-policy`. |
| Image generation | Image generation requires approval, provider/model choice, prompt bounds, artifact manifest, and cost log. | `#image-generation`, `@image-tool`, `@approval-gate`. |
| Text-to-speech | TTS requires voice/provider choice, text bounds, output manifest, and cost log. | `#text-to-speech`, `@tts-tool`, `@cost-log`. |
| Cloud browser | Cloud browser automation requires isolated session, action schema, screenshot or vision bounds, redaction, and approval gates. | `#cloud-browser`, `@browser-tool`, `@tool-policy`. |
| External pattern boundary | Hermes Tool Gateway and Tool Search may inform tool-category and deferred-schema semantics; local docs must not copy Hermes gateway code, tool-search code, retrieval implementation, bridge prompt text, provider tables, model lists, config examples, tests, fixtures, or prose. | `VALIDATION-RUNBOOK.md`, `MCP-GATEWAY.md`, `HARNESS-CONTRACTS.md`. |
| Skill discovery | Installed or authored skills are exposed first as lightweight metadata, not full prompt content. | `/skill.discover`, `#skill-system`, `@skill-index`. |
| On-demand load | Full `SKILL.md` content loads only when a selected skill is needed for the task. | `/skill.load`, `#progressive-disclosure`, `@skill-source`. |
| Resource disclosure | Supporting references, scripts, templates, and assets load only when the active skill explicitly requires them. | `/skill.load`, `@skill-reference`, `#agentskills-compatible`. |
| Skill bundles | Bundles group already-available skills under one route; they do not install missing skills or create a duplicate registry. | `/skill.bundle`, `#skill-bundle`, `@skill-bundle`. |
| Managed skill writes | Skill creation and evolution are review-gated procedural memory writes, not automatic runtime mutation. | `/skill.manage`, `/skill.evolve`, `@skill-policy`. |
| Open standard compatibility | Skill sources should preserve standard frontmatter, concise activation description, Markdown instructions, optional resources, shallow file references, and validation. | `#agentskills-compatible`, `SKILLS.md`, `VALIDATION-RUNBOOK.md`. |
| Skill security | Skill load, install, and write paths must scan source, compatibility, environment requirements, copied artifacts, and dangerous instructions. | `#skill-security`, `@skill-policy`. |
| Context discovery | Project-local context files are discovered from the explicit working directory and touched paths, not from an unbounded global scan. | `/context.discover`, `#cwd-discovery`, `@working-directory`. |
| Context precedence | Only one project context type is effective per scope; skipped matches are reported rather than merged into duplicate instruction layers. | `#project-context`, `@context-policy`. |
| Context safety | Context files are scanned and bounded before inclusion; unsafe files return typed blocked state. | `/context.load`, `#context-file`, `@context-policy`. |
| Context hierarchy | `FACTS.md` remains stronger than CLAUDE-style context in this docs folder, and `SOUL.md` remains the separate identity layer. | `FACTS.md`, `SOUL.md`, `AGENTS.md`. |
| Context references | Explicit `@file:`, `@folder:`, `@diff`, `@staged`, `@git:`, and `@url:` references may append bounded context to a message on supported surfaces. | `/reference.expand`, `#context-reference`, `@reference-policy`. |
| Reference safety | Reference expansion is workspace-scoped where applicable, blocks sensitive paths, rejects binary content, enforces soft warnings and hard refusals, and preserves raw text on unsupported surfaces. | `@attached-context`, `#inline-context`, `VALIDATION-RUNBOOK.md`. |
| Reference warnings | Missing, invalid, unsupported, over-limit, or unsafe references produce typed warnings or refusals instead of silent mutation or downstream parser patches. | `/reference.audit`, `#attached-context`, `@runtime-proof`. |
| Kanban board | `kanban.md` is the durable shared task board for named profiles and worker processes. | `/kanban.task`, `#kanban-board`, `@kanban-board`. |
| Handoff rows | Every handoff is a row with source profile, target profile, task id, context refs, blockers, resume state, and acceptance. | `/kanban.handoff`, `#profile-handoff`, `@handoff-row`. |
| Worker isolation | A worker is a full OS process with its own identity and proof path, not a hidden in-process subagent. | `#worker-process`, `@worker-process`, `@agent-profile`. |
| Cross-repository planning index | `TODO.md` owns the planning schema and routing contract; `todo/YYYY-MM.md` owns append-only rows for one scope and UTC month. | `TODO.md`, `todo-log/v1`, `VALIDATION-RUNBOOK.md`. |
| Planning shard lifecycle | Only the current monthly shard is active; closed shards are immutable, exact month or Context retrieval precedes broader search, and each shard stays below 500,000 bytes and 600 lines. | `TODO.md` lifecycle, retrieval, and size contracts. |
| Planning authority | `TODO.md` and the active `todo/YYYY-MM.md` shard are the sole live planning SSOT for Knowgrph and every participating repository; repository-local todo files are forbidden. | `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`, `VALIDATION-RUNBOOK.md`. |
| Planning update compliance | A task requires one appended shard row with the canonical 11 columns, all cells filled, one directive of at most 50 words, and `Updated Date` equal to its enclosing dated section; every committed shard remains an exact byte prefix. | `TODO.md` Planning Ledger Contract and focused planning-shard validation. |
| Experience capture | Useful run traces may be summarized into typed experience records. | `/experience.capture`, `@experience`, `#learning-loop`. |
| Past conversation search | Agents may search local conversation or memory indexes when scoped by operator-approved storage. | `/memory.search`, `@memory-store`, `#memory-search`. |
| Skill creation | New skills start as proposals with source evidence, input/output schemas, bounds, cost fields, and VCCs. | `/skill.propose`, `@skill-catalog`, `#skill-evolution`. |
| Skill improvement | Skill evolution requires an evaluation packet, focused checks, semantic-preservation statement, and human-reviewed diff. | `/skill.evolve`, `@runtime-proof`, `#vcc`. |
| Identity model | Identity reflection stores stable operator preferences, project boundaries, and working rules; it must not store secrets or unsupported personal inferences. | `/identity.reflect`, `@identity-model`, `#identity-model`. |
| Self-modification boundary | Agents may propose and validate changes; they must not directly commit, deploy, or mutate protected stores without operator approval. | `@operator`, `@approval-gate`, `@dev-only`. |
| External pattern boundary | External systems can justify feature classes, but local contracts remain provider-neutral, FOSS-first, source-backed, and runtime-ready only after proof; context-file and context-reference parsers, prompt text, examples, tests, fixtures, and prose must not be copied. | `SKILLS.md`, `HARNESS-CONTRACTS.md`, `RUNTIME-READINESS.md`. |

## Persistent Memory Facts

| Fact | Rule | Proof or source |
|---|---|---|
| Agent notes | `MEMORY.md` stores bounded agent notes: environment facts, project conventions, tool quirks, completed-work lessons, and reusable techniques. | `/memory.write`, `#persistent-memory`, `@memory-store`. |
| Durable history | `memory/YYYY-MM.md` stores append-only `memory-log/v1` records; `MEMORY-LOG.md` owns the Git sync, merge, retrieval, and escalation contract. | `MEMORY-LOG.md`, `@memory-store`, `@session-index`. |
| Planning history | `todo/YYYY-MM.md` stores append-only `todo-log/v1` rows; `TODO.md` stays bounded as the schema, routing, lifecycle, and validation owner. | `TODO.md`, `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`. |
| User profile | `USER.md` stores bounded explicit operator preferences, communication style, and expectations. | `/user.profile`, `#user-profile`, `@user-profile`. |
| Target separation | Agent notes and user profile are separate targets; do not mix project environment facts into `USER.md` or personal preferences into `MEMORY.md`. | `MEMORY.md`, `USER.md`. |
| Frozen snapshot | Approved runtimes may inject memory/profile as a frozen session-start snapshot; mid-session writes persist for future sessions and tool responses, not active prompt mutation. | `#frozen-snapshot`, `@memory-snapshot`. |
| Write actions | Memory write supports add, replace, and remove semantics through typed request fields, not separate parser forks. | `/memory.write`, `@memory-entry`. |
| Capacity management | Writes that exceed bounds must return a typed capacity error; the agent should compact, replace, or remove entries before retrying. | `/memory.compact`, `#memory-capacity`. |
| Session search | Past conversations can be searched on demand for specifics, but search results do not become memory until captured explicitly. | `/session.search`, `#session-search`, `@session-index`. |
| Security | Memory/profile entries must be scanned for prompt injection, exfiltration, secrets, invisible control characters, and unsupported inference before persistence. | `@memory-policy`, `VALIDATION-RUNBOOK.md`. |
| External pattern boundary | Hermes Agent memory may inform layer semantics; local docs must not copy Hermes memory code, database schemas, sample entries, prompt renderers, tests, fixtures, or prose. | `VALIDATION-RUNBOOK.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`. |

## Soul Facts

| Fact | Rule | Proof or source |
|---|---|---|
| Durable identity | `SOUL.md` owns who the Agentic OS agent is and how it speaks. | `/soul.load`, `#soul`, `@soul-profile`. |
| Prompt slot | Approved prompt assembly treats soul content as slot 1 identity before tools, memory, skills, project context, and overlays. | `#primary-identity`, `@identity-slot`. |
| No hardcoded default | Runtime code must resolve source-backed identity or return a typed fallback; it must not silently embed a hardcoded default identity string. | `VALIDATION-RUNBOOK.md`, `RUNTIME-PROOF.md`. |
| Separation | `SOUL.md` is for identity, tone, style, uncertainty, disagreement, and ambiguity defaults. Project rules stay in `AGENTS.md`; persistence stays in `MEMORY.md`; truth stays in `FACTS.md`. | `SOUL.md`, `AGENTS.md`, `MEMORY.md`. |
| Overlay boundary | `/personality.overlay` is temporary session style and cannot mutate `SOUL.md` or bypass safety, facts, roles, approval, or deploy gates. | `#personality-overlay`, `@personality-overlay`. |
| Safety | Soul content must be scanned and bounded before prompt inclusion. Missing, empty, unsafe, or unreadable soul source yields typed fallback. | `HARNESS-CONTRACTS.md`, `SKILLS.md`. |
| External pattern boundary | Hermes Agent SOUL may inform layer semantics; local docs must not copy Hermes code, default identity text, personality preset text, prompt assembly code, schemas, tests, fixtures, or prose. | `VALIDATION-RUNBOOK.md`, `SOUL.md`. |

## Mixture Of Agents Facts

| Fact | Rule | Proof or source |
|---|---|---|
| One-shot invocation | `/moa` applies a local preset to the current prompt or scoped query and then restores the prior model or agent context. | `/moa`, `@moa-preset`, official MoA docs listed in frontmatter. |
| Reference stage | Reference agents run first, without tools, as bounded advisory calls over a trimmed deterministic context. | `#reference-agents`, `@reference-agents`. |
| Aggregator stage | The aggregator is the only acting agent; it produces the user-visible response and owns tool calls, approvals, and follow-up iterations. | `#aggregator-agent`, `@aggregator-agent`. |
| Private advisory context | Reference outputs are appended as private context for the aggregator, not written into source docs or exposed as separate truth. | `#mixture-of-agents`, `@runtime-proof`. |
| Cost and cache | MoA increases model-call count; reference outputs require token caps and cost logs, while stable prompt prefixes and cached context should be preserved. | `#token-economics`, `@cost-log`. |
| Failure handling | A failed reference can be represented as a typed advisory failure while the aggregator continues with available references, unless local policy requires fail-closed. | `HARNESS-CONTRACTS.md`, `SKILLS.md`. |
| Recursion boundary | An MoA aggregator must not be another MoA preset, and bare `/moa` must return usage instead of switching the global model. | `DICTIONARY-COMMAND.md`, `VALIDATION-RUNBOOK.md`. |
| External pattern boundary | Hermes Agent MoA may inform routing semantics; local docs must not copy Hermes code, prompts, preset examples, schemas, tests, fixtures, or prose. | `VALIDATION-RUNBOOK.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`. |

## Stateful Orchestration Facts

| Fact | Rule | Proof or source |
|---|---|---|
| Graph topology | Stateful orchestration is represented as typed state, nodes, and edges. | `/orchestration.graph`, `#orchestration-graph`, `@orchestration-graph`. |
| Durable execution | Long-running agents require checkpoint and resume contracts before runtime-ready promotion. | `/state.checkpoint`, `#durable-execution`, `@checkpoint-store`. |
| Human review | Human-in-loop stages are explicit interrupts with inspect, edit, approve, reject, and resume outcomes. | `/human.review`, `#human-in-loop`, `@human-review`. |
| Streaming trace | Agent runs may surface streaming events for progress and state transitions, but not as source mutation. | `/stream.trace`, `@runtime-proof`, `@cost-log`. |
| SuperAgent run | Long-horizon research, code, and creation tasks compose orchestration, skills, memory, tools, sandboxed workspace, message gateway, artifacts, and verification under one bounded harness. | `/superagent.run`, `#long-horizon-harness`, `@sandbox-workspace`, `@message-gateway`. |
| External pattern boundary | LangGraph and DeerFlow may inform graph and SuperAgent semantics; local docs must not copy external code, APIs, schemas, tests, examples, prompts, provider configs, runtime layouts, or prose. | `VALIDATION-RUNBOOK.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`. |

## Resolution Rules

| Situation | Resolution |
|---|---|
| A local memory statement conflicts with `FACTS.md` | Update the source fact or demote the memory statement; do not layer an alias. |
| A role instruction conflicts with a fact | Keep the fact stable and update the role instruction unless higher-priority operator instructions say otherwise. |
| A dictionary token is missing | Add the token to the correct `DICTIONARY-*` file and cross-link it from this file. |
| A UI label looks like an invocation | Resolve through dictionaries before treating it as executable. |
| A claim needs runtime-ready status | Require `@runtime-proof`, focused validation, cost/deploy boundary reporting, and a bounded VCC. |

## Truth Tests

| VCC | Check |
|---|---|
| Facts parse | Frontmatter parses as YAML and `direct_resolution` includes command, semantic, and binding truth tokens. |
| Dictionaries resolve facts | The command, semantic, and binding dictionaries each include the matching direct-resolution token. |
| Roles are not facts | `AGENTS.md` points to `FACTS.md` for truth and keeps role/edit behavior separate. |
| Memory is not truth precedence | `MEMORY.md` describes persistence and routing memory without overriding `FACTS.md`. |
| Exact revisions establish parity | Two runtime identity records pass only when their Knowgrph and Agentic Canvas OS SHAs are valid, exact, and equal across devices; branch names are ignored. |
| Identity ownership stays global | The source-architecture check finds one application-root identity runtime, one canonical store, a Settings KTV projection, and no Settings or invocation-catalog identity owner. |
| Catalog revision is current | Every runtime identity reports `catalogRevision == agenticCanvasOsRevision`, a bounded hydration attempt count, and a non-stale successful state before parity or release is claimed. |
| Deploy boundary preserved | No Prod mirror or Cloudflare mutation is performed by documentation-only updates. |
