---
title: "Knowgrph Agentic Canvas OS Runtime Proof"
graphId: "md:knowgrph-agentic-canvas-os-runtime-proof"
doc_type: "Runtime Proof Ledger"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-canvas-os-runtime-proof/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_proof: "RUNTIME-PROOF.md"
source_docs:
  - "AGENT-DEFINITIONS.md"
  - "MODELS-AND-PROVIDERS.md"
  - "SOUL.md"
  - "USER.md"
  - "FACTS.md"
  - "AGENTS.md"
  - "DICTIONARY-COMMAND.md"
  - "DICTIONARY-SEMANTIC.md"
  - "DICTIONARY-BINDING.md"
  - "HARNESS-CONTRACTS.md"
  - "INSTRUCTION-AUDIT.md"
  - "INSTRUCTION-QUALITY-EVALUATION.md"
  - "MCP-GATEWAY.md"
  - "MEMORY.md"
  - "PRD-TAD.md"
  - "PROMPT-PRESETS.md"
  - "README.md"
  - "RUNTIME-PROOF.md"
  - "RUNTIME-READINESS.md"
  - "SKILLS.md"
  - "kanban.md"
  - "VALIDATION-RUNBOOK.md"
publish_policy: "Dev-only until explicit operator approval"
external_runtime_policy: "knowgrph runtime, Prod mirror, and Cloudflare require separate focused proof or approval"
kgCanvasSurfaceMode: "2d"
kgCanvasRenderMode: "2d"
kgCanvas2dRenderer: "storyboard"
kgDocumentSemanticMode: "document"
kgFrontmatterModeEnabled: true
kgMultiDimTableModeEnabled: true
kgDocumentStructureBaselineLock: false
socket_types:
  proof_parse_signal:
    label: "Proof parse signal"
    cardinality: "one-to-many"
  proof_route_signal:
    label: "Proof route signal"
    cardinality: "one-to-many"
  proof_status_signal:
    label: "Proof status signal"
    cardinality: "one-to-one"
flow:
  direction: {key: direction, type: string, value: "LR"}
  edgeType: {key: edgeType, type: string, value: "smoothstep"}
  balancedViewportPreset: {key: balancedViewportPreset, type: string, value: "widgetFrontmatter"}
  computed: {key: computed, type: boolean, value: true}
  snapToGrid: {key: snapToGrid, type: boolean, value: true}
  nodes:
    - id: {key: id, type: string, value: "parse_evidence"}
      type: {key: type, type: string, value: "source"}
      label: {key: label, type: string, value: "Parse evidence"}
      lane: {key: lane, type: string, value: "parse"}
      position: {key: position, type: object, value: {x: 0, y: 0}}
      handles: {key: handles, type: list, value: ["parse.out"]}
      "flow:portTypes": {key: "flow:portTypes", type: list, value: ["proof_parse_signal"]}
    - id: {key: id, type: string, value: "route_evidence"}
      type: {key: type, type: string, value: "process"}
      label: {key: label, type: string, value: "Route evidence"}
      lane: {key: lane, type: string, value: "route"}
      position: {key: position, type: object, value: {x: 280, y: 0}}
      handles: {key: handles, type: list, value: ["route.in", "route.out"]}
    - id: {key: id, type: string, value: "artifact_scan"}
      type: {key: type, type: string, value: "guard"}
      label: {key: label, type: string, value: "Runtime artifact scan"}
      lane: {key: lane, type: string, value: "scan"}
      position: {key: position, type: object, value: {x: 560, y: 0}}
      handles: {key: handles, type: list, value: ["scan.in", "scan.out"]}
    - id: {key: id, type: string, value: "proof_status"}
      type: {key: type, type: string, value: "observer"}
      label: {key: label, type: string, value: "Proof status"}
      lane: {key: lane, type: string, value: "proof"}
      position: {key: position, type: object, value: {x: 840, y: 0}}
      handles: {key: handles, type: list, value: ["status.in", "status.out"]}
    - id: {key: id, type: string, value: "deploy_boundary"}
      type: {key: type, type: string, value: "guard"}
      label: {key: label, type: string, value: "Deploy boundary"}
      lane: {key: lane, type: string, value: "boundary"}
      position: {key: position, type: object, value: {x: 1120, y: 0}}
      handles: {key: handles, type: list, value: ["boundary.in"]}
  edges:
    - id: {key: id, type: string, value: "parse_to_route"}
      source: {key: source, type: string, value: "parse_evidence"}
      target: {key: target, type: string, value: "route_evidence"}
      type: {key: type, type: string, value: "proof_parse_signal"}
    - id: {key: id, type: string, value: "route_to_scan"}
      source: {key: source, type: string, value: "route_evidence"}
      target: {key: target, type: string, value: "artifact_scan"}
      type: {key: type, type: string, value: "proof_route_signal"}
    - id: {key: id, type: string, value: "scan_to_status"}
      source: {key: source, type: string, value: "artifact_scan"}
      target: {key: target, type: string, value: "proof_status"}
      type: {key: type, type: string, value: "proof_status_signal"}
    - id: {key: id, type: string, value: "status_to_boundary"}
      source: {key: source, type: string, value: "proof_status"}
      target: {key: target, type: string, value: "deploy_boundary"}
      type: {key: type, type: string, value: "proof_status_signal"}
---

# Runtime Proof

This ledger proves the local Agentic Canvas OS docs control surface. It does not claim a Prod mirror write, Cloudflare deploy, paid provider call, or live external harness execution.

## Proof Scope

| Scope | Included | Excluded |
|---|---|---|
| Docs parse | Every Markdown file in this folder has YAML frontmatter and parses. | Instruction-only skipped files. |
| Route consistency | `/`, `#`, `@`, skill contracts, skill variants, and computing-flow entries resolve from source docs. | FloatingPanel-only duplicate registries or aliases. |
| Facts consistency | Every `FACTS.md` `direct_resolution` token resolves into the corresponding `/`, `#`, or `@` dictionary. | Memory-only or role-only truth precedence. |
| Probe-Tree clarification contract | `PROBE-TREE.md` declares RECOMMEND, COMPARE, ASSESS, and PLAN as semantic, case-insensitive clarification topics producing 2-4 cards through the active Chat tuple; the preset and dictionaries are validated projections that preserve selected-child ownership and the runtime-recognized terminal boundary. | Query-specific hardcoding, keyword-only classification, action-verb terminal inference, stale card-local routing, zero-model fallback cards, or live provider execution. |
| Prompt preset Chat and MCP contract | Eleven source-backed presets expose one declared Chat response mode plus read-only `knowgrph.agentic_canvas_os.docs.invoke` resolution of the same registered runtime token; four semantic SME and investment variants reuse existing agent owners. | Query-specific hardcoding, stale Chat routing, unresolved MCP tokens, zero-model LLM fallbacks, duplicated agent runtimes, paid calls, or live provider proof. |
| Runtime revision identity contract | `npm run collaboration:gate` is the repository-owned entry point for focused checks plus isolated owner/guest browser and worker proof. It requires active peers, document propagation, exact Knowgrph, Agentic Canvas OS, and catalog revisions, one common verification digest, and revision-keyed hydration limited to two attempts. | Physical devices and runtime-identity JSON exports are not required; a nonzero command result blocks parity and release. |
| Writer lease and fencing contract | For the explicit canonical target repository, one shared branch grammar preserves `.local`, `_`, and `-` inside bounded device identities while keeping semantic scope hyphen-only; generation validates before checkout mutation. `device:start` then claims one atomic Git-metadata lease, increments its epoch, records a claim-commit fence, and opens a draft ownership pull request before authoring; `device:heartbeat` renews the bounded TTL, and the delivering session may reclaim the exact remote SHA for a protected-check revision. | Invalid or mismatched branch identity, leading or trailing separators, scope dots or underscores, same-device competing sessions, duplicate semantic-scope pull requests, expired leases, session mismatch, ambiguous target repositories, non-ancestral fences, and cross-session delivery revision fail closed. |
| Soul identity contracts | `/soul.load`, `/personality.overlay`, matching `#` tags, matching `@` bindings, `soul.load`, and `personality.overlay` resolve from source docs. | Copied identity text, personality presets, prompt assembly code, hardcoded default identity strings, or live prompt runtime execution. |
| Persistent memory contracts | `/memory.write`, `/memory.compact`, `/memory.search`, `/session.search`, `/user.profile`, matching `#` tags, matching `@` bindings, and matching skill contracts resolve from source docs. | Copied memory code, database schemas, sample entries, prompt renderers, unsupported profile inference, or live memory runtime execution. |
| Append-only memory log | `MEMORY-LOG.md`, `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`, and `VALIDATION-RUNBOOK.md` require exact `## @mem-YYYYMMDDTHHmmssZ` UTC sigil blocks, complete fields, structural startup proof, and byte-prefix release proof. | Local-time or minute-only sigils, pure YAML entries, table SSOT, bolded sigils, deletion, rewrite, reorder, compaction, or insertion before EOF. |
| Monthly planning shards | `TODO.md` owns bounded routing and `todo/YYYY-MM.md` owns append-only `todo-log/v1` rows with exact scope/month, lifecycle, chronology, size caps, adoption boundary, and base-prefix proof. | Monolithic planning tables, closed-month mutation, wrong-month headings, retroactive normalization, prepend writes, silent overflow shards, or embedding-first retrieval. |
| Skills system contracts | `/skill.discover`, `/skill.load`, `/skill.bundle`, `/skill.manage`, matching `#` tags, matching `@` bindings, and matching skill contracts resolve from source docs. | Copied skills, examples, layouts, prompt text, tests, fixtures, external repositories, or live skill runtime execution. |
| Instruction audit runtime | `/instruction.audit`, `#instruction-audit`, `@instruction-source`, context budgets, required intent, exact duplicate detection, and canonical-owner checks are executable locally. | Model-based style grading, automatic instruction rewrites, copied external guidance, or deploy authority. |
| Instruction task-quality evaluation | `/instruction.quality-evaluate`, `#instruction-quality`, `@instruction-eval-suite`, candidate provenance, final-answer rubrics, and human-review boundaries are executable locally. | Private-reasoning grading, hidden model execution, lexical-score overclaims, synthetic candidate promotion, or deploy authority. |
| Context files contracts | `/context.discover`, `/context.load`, `/context.audit`, `#context-file`, `#project-context`, `#cwd-discovery`, `@context-file`, `@working-directory`, `@context-policy`, and matching skill contracts resolve from source docs. | Copied context discovery code, scanner code, example files, prompt assembly text, tests, fixtures, prose, or live context runtime execution. |
| Context references contracts | `/reference.expand`, `/reference.audit`, `#context-reference`, `#inline-context`, `#attached-context`, `@file:`, `@folder:`, `@diff`, `@staged`, `@git:`, `@url:`, `@reference-policy`, `@attached-context`, and matching skill contracts resolve from source docs. | Copied context-reference parser code, prompt section text, examples, tests, fixtures, prose, or live reference runtime execution. |
| Kanban collaboration contracts | `/kanban.task`, `/kanban.handoff`, `/kanban.sync`, `#kanban-board`, `#task-row`, `#profile-handoff`, `#worker-process`, `#multi-agent-collaboration`, `@kanban-board`, `@task-row`, `@handoff-row`, `@agent-profile`, `@worker-process`, and `kanban.collaborate` resolve from source docs. | Copied board runtimes, schema examples, hidden in-process subagent swarms, or live worker process execution. |
| Centralized planning compliance | Startup validates `TODO.md` and every monthly shard; release requires one appended row for the declared Context with 11 filled cells, a directive of at most 50 words, matching section/date, and exact committed shard prefixes. | Repository-local todo files, missing, duplicate, empty, overlong, misdated, prepended, or destructive planning updates. |
| Tools and toolsets contracts | `/toolset.enable`, `/toolset.disable`, `#tool-function`, `#toolset`, `#platform-toolset`, `@tool-function`, `@toolset`, `@platform-surface`, and matching skill contracts resolve from source docs. | Copied tool registries, platform presets, provider examples, config snippets, tests, fixtures, prose, or live toolset mutation. |
| Tool Gateway contracts | `/tool.catalog`, `/tool.route`, `/tool.provider.select`, `/tool.gateway.audit`, matching tool-category `#` tags, matching `@` bindings, and matching skill contracts resolve from source docs. | Copied gateway code, provider tables, model lists, config examples, tests, fixtures, prose, or live tool runtime execution. |
| Tool Search runtime | Route contracts resolve from source docs; session registration, metadata-only initial exposure, exact definition loading, authorization, bounds, costs, and cleanup are executable locally. | Copied provider code, search implementation, prompts, schemas, examples, tests, fixtures, prose, fabricated context reduction, or live provider execution. |
| Programmatic tool-calling runtime | Hosted-attestation gating, caller lineage, read-only idempotent tool eligibility, bounded continuation, cost aggregation, compact final evidence, and fail-closed readiness are executable locally. | Copied provider code or examples, local JavaScript evaluation, high-impact programmatic calls, fabricated hosted proof, or live provider execution. |
| Running agents runtime | Agent-loop transitions, exclusive continuation strategies, same-loop streaming, pause and resume, serialization, bounds, cost evidence, and fail-closed readiness are executable locally. | Copied provider agent code, SDK schemas, prompts, examples, event fixtures, tests, prose, fabricated adapter evidence, or live provider execution. |
| Agent orchestration and handoffs runtime | Manager delegation, specialist conversation transfer, explicit conversation and final-answer ownership, handback, serialization, revision fences, authorization, bounds, redaction, and cost evidence are executable locally. | Copied provider orchestration code, SDK schemas, prompts, examples, tests, fixtures, prose, inferred ownership, hidden routers, fabricated adapter evidence, or live provider execution. |
| Sandbox Agents runtime | Generic lifecycle, Docker compute, deny-first authorization, atomic checkpoint claims, independent local containment checks, immutable-image execution, loopback previews, snapshots, resume, redaction, bounds, cost, and cleanup are executable locally. | Copied provider SDK or client code, APIs, examples, prompts, schemas, fixtures, tests, model defaults, fabricated containment, host execution fallback, public ports, environment injection, online packages, or deployment. |
| Models and providers runtime | Revision-fenced provider registration, agent/run/process defaults, exact model features, independent transport selection, strict environment configuration, bounds, redaction, and fail-closed readiness are executable locally. | Copied provider SDK code, model catalogs, examples, schemas, prompts, tests, fixtures, prose, fabricated capability evidence, or live provider execution. |
| Mixture-of-agents contracts | `/moa`, matching `#` tags, matching `@` bindings, `moa.run`, and `agent.moa` resolve from source docs. | Copied MoA artifacts, hardcoded external provider presets, recursive aggregators, uncapped fan-out, or live provider execution. |
| Learning-loop contracts | `/memory.search`, `/experience.capture`, `/skill.propose`, `/skill.evolve`, `/identity.reflect`, matching `#` tags, and matching `@` bindings resolve from source docs. | External copied implementation artifacts, unreviewed self-modification, or live optimizer execution. |
| Stateful orchestration contracts | `/orchestration.graph`, `/state.checkpoint`, `/human.review`, `/stream.trace`, matching `#` tags, and matching `@` bindings resolve from source docs. | Copied graph runtime artifacts, hidden graph stores, unbounded cycles, or live external runtime execution. |
| Long-horizon SuperAgent contracts | `/superagent.run`, `#long-horizon-harness`, `#sandboxed-workspace`, `#message-gateway`, `@sandbox-workspace`, `@message-gateway`, and `superagent.run` resolve from source docs. | Copied DeerFlow runtime layouts, prompts, provider configs, examples, tests, fixtures, unbounded loops, or live external runtime execution. |
| Agentic video workflow | Dev runtime proves native model-backed script, character, storyboard, pending-shot render, checkpoint resume, landscape guard, context compaction, bounded retry, and an inspectable nine-stage multi-agent pipeline with typed handoffs, semantic assets, resource accounting, and dependency-propagated state. | Prod mirror writes, Cloudflare deploy, copied ViMax implementation artifacts, or uncontrolled paid calls. |
| KGC computing-flow | Docs declare `kgc-computing-flow/v1`, explicit handles, bounded execution, and KGC validation ownership. | Separate chat-local flow engine or direct graph mutation. |
| Cost and gates | Documentation validation is zero model spend and keeps paid/mutating/deploy gates explicit. | Approved paid calls, payment, browser-auth, Prod mirror, or Cloudflare deploy. |
| Deployment boundary | Dev docs are changed locally only. | Prod mirror and Cloudflare runtime proof. |

## Proof Ledger

| VCC | Observable proof | Status |
|---|---|---|
| Frontmatter parses | Frontmatter command from `VALIDATION-RUNBOOK.md` reports `frontmatter ok` for every Markdown file in this folder. | Passed |
| Line budgets hold | `wc -l docs/*.md` reports every file under 600 lines. | Passed |
| ASCII holds | `LC_ALL=C rg -n "[^[:ascii:]]" docs` returns no matches. | Passed |
| Artifact scan holds | Split artifact pattern from `VALIDATION-RUNBOOK.md` returns no copied runtime artifacts. | Passed |
| Route consistency holds | Route consistency command reports `route consistency ok`. | Passed |
| Facts direct resolution holds | All `FACTS.md` direct-resolution command, semantic, and binding tokens are present in the matching dictionary frontmatter. | Passed |
| Probe-Tree clarification contract holds | `npm run probe-tree-contract:check` validates `PROBE-TREE.md` as the canonical owner, the structured action-topic set, semantic case-insensitive matching, 2-4 bounds, runtime-recognized selected-child terminal boundary, active Chat route, fail-closed no-hardcode/no-zero-model policy, and exact preset and dictionary projections. | Passed without provider execution |
| Automated collaboration and runtime identity gate holds | Knowgrph `9f51499092e9ff67b1bc0dcf5f9f83949c649fc5` passed the canonical owner/guest/worker readiness harness against Agentic Canvas OS/docs/catalog `db4f7604f5eeaa420cab2ed5c621a1867f48291b`: `2/2` isolated peers (`collaboration-owner-local`, `collaboration-guest-local`), shared document `docs/workspace-readme.md`, remote propagation, fresh hydration, and common digest `f267a4898de27eedc863f15315e7c0a194082c82374da08e574cab65ba7603ce`. The Agentic Canvas OS wrapper delegation contract also passed. The complete `npm run collaboration:gate` reruns from canonical protected revisions after integration; it never requires physical devices or runtime-identity JSON exports. | Runtime harness passed; wrapper integration pending |
| Multi-worktree writer coordination is executable | Focused Node tests exercise atomic Git-common-directory lease registration, distinct-worktree parallel claims, same-worktree exclusion, TTL renewal, expired-session epoch takeover, same-session delivery revision, session and worktree fencing, pull-request metadata round-trip without machine-path disclosure, different-scope PR coexistence, duplicate-scope rejection, and redacted command output. | Runtime-ready in Dev; protected CI is required for every revision |
| Cache context is executable | `npm run cache-context:check` reports 6/6 passing for exact stable-prefix reuse, idempotent registration, revision invalidation, least-recent bounded eviction, provider-eligibility honesty, and cache read/write telemetry. `GET /api/ready` exposes only sanitized registry policy and keeps provider cache status `unverified`. | Runtime-ready in Dev; live provider hit remains gated |
| Reasoning continuity is executable | `npm run reasoning-continuity:check` reports 8/8 passing for first-turn behavior, exact invariant reuse, drift reset, capability gating, returned-context confirmation, mismatch rejection, active-turn serialization, and bounded retention. `GET /api/ready` exposes only policy and counters while provider-effective context remains `unverified`. | Runtime-ready in Dev; live provider confirmation remains gated |
| Function calling is executable | `npm run function-gateway:check` reports 17/17 passing: twelve provider-neutral controller checks plus five concrete OpenAI Responses and Knowgrph gateway checks for strict selection translation, one-shot forced selection, encrypted reasoning replay, `previous_response_id`, exact `call_id`, returned usage pricing, application-only schemas, allowlist and policy enforcement, authenticated handler flow, provider-error redaction, and no secret return. `read_agentic_os_status` is the sole enabled mapping to existing `knowgrph.os.status`; readiness remains `unverified` until a real provider call succeeds. | Runtime-ready in Dev; live provider proof blocked when required server credentials are absent |
| Agent definitions are executable | `npm run agent-definitions:check` reports 8/8 passing for exact source URI and SHA-256 verification, immutable minimal packets, authorized optional behavior, reference-only capability denial, handoff target verification, revision conflict and stale fencing, unknown-field and capacity rejection, explicit bounds, and text or structured output validation. App and Worker tests expose sanitized registry policy while no definitions are registered and provider execution remains `unverified`. | Runtime-ready in Dev; downstream agent execution and live provider proof remain gated |
| Models and providers are executable | `npm run model-providers:check` reports 7/7 passing for process defaults, agent/run/process precedence, provider-local fallbacks, independent transport matching, exact features, missing routes, revision conflicts, capacity, removal, strict neutral environment fields, endpoint safety, legacy-alias rejection, and secret redaction. Agent Definition, app, and Worker tests prove the shared selection shape and sanitized configured readiness while provider execution remains `unverified`. | Runtime-ready in Dev; adapter execution and bounded live provider proof remain gated |
| Running agents is executable | `npm run running-agents:check` reports 7/7 passing for model/tool/handoff progression, application-history replay, session/conversation/previous-response exclusivity, incremental same-loop streaming, same-turn pause resume, active serialization, recent-run fencing, step and event bounds, timeout, unconfigured behavior, and honest reported, partial, unreported, or not-run cost. App and Worker tests expose sanitized policy while adapter configuration is false and provider execution remains `unverified`. | Runtime-ready in Dev; downstream adapter and bounded live provider proof remain gated |
| Agent orchestration and handoffs are executable | `npm run agent-orchestration:check` reports 8/8 passing for exact topology, explicit branch ownership, source-owned manager delegation, target-owned conversation handoff, owner-only continuation, specialist delegation, manager handback, authorization before execution, workflow, branch, and agent revision fencing, concurrency, replay, intermediate-output suppression, partial cost, and error redaction. App and Worker tests expose sanitized policy while configuration is false and provider execution remains `unverified`. | Runtime-ready in Dev; downstream agent adapter and bounded live provider proof remain gated |
| Agent runtime composition is executable | `npm run agent-runtime-composition:check` reports 10/10 passing for a repository file loaded with an actual SHA-256 source check, exact source preparation, provider, model, transport, feature, and definition-identity selection, one Running Agents lifecycle, previous-response continuation, structured-output rejection and reset, source and provider drift blocks, manager-owned delegation, target-owned handoff, hidden intermediate output, and honest reported or unreported cost. App and Worker tests expose connected resolver and runner interfaces while the execution adapter and provider status remain unconfigured or `unverified`. | Runtime-ready in Dev; bounded live execution remains gated by explicit spend approval |
| Sandbox Agents is executable | `npm run sandbox-provider:check` reports 13/13 controller/provider tests. With a healthy local Docker Engine and caller-supplied immutable image digest, `npm run sandbox-docker:check` reports 20 independent configuration and behavioral checks, real file and argv work, offline local package installation, internal agent networking, loopback preview proxy traffic, snapshot seeding, atomic cross-controller resume, zero reported cost, and zero remaining labeled containers or networks. App and Worker tests keep the unconfigured default honest. | Runtime-ready for bounded local Docker execution; default Worker hosting and formal third-party containment certification remain gated |
| Programmatic tool calling is executable | `npm run programmatic-tool-calling:check` reports 12/12 passing for hosted orchestration, stored continuation, complete ordered stateless replay, opaque reasoning and fingerprint handling, exact function caller lineage, direct route selection and enforcement, schemas, bounds, serialization, timeout, costs, no local dynamic-code fallback, and no generated-code return. App and Worker readiness tests expose only sanitized policy while provider context isolation remains `unverified`. | Runtime-ready in Dev; hosted adapter proof remains gated |
| Tool Search is executable | `npm run tool-search:check` reports 8/8 passing for metadata-only initial exposure, immutable prefix state, private hosted catalog mapping, exact client loading, canonical hosted validation, programmatic preloading, capability and adapter gates, namespace and result bounds, replay rejection, timeout, session cleanup, returned or unreported cost evidence, and no authorization of unselected tools. App and Worker tests expose sanitized policy while provider context reduction remains `unverified`. | Runtime-ready in Dev; live search and context-reduction proof remain gated |
| Instruction audit is executable | `npm run instruction-audit:check -- --baseline-ref=9916527fb7ac78dbd80772eaa7412c21259314de` reports 7/7 focused tests, two passing current surfaces, 1,086 body words, 4,102 estimated tokens, zero violations, and 58,143 fewer characters (78%) than the inspected base. Fixtures prove missing intent, duplicate directives, excessive directive context, embedded procedures, canonical-owner leakage, and route drift fail closed. | Runtime-ready in Dev; quality evaluation is separately owned |
| Instruction task-quality evaluation is executable | `npm run instruction-quality:check` validates four bounded final-answer cases and reports 7/7 tests for complete behavior, missing owner intent, unsafe deploy advice, excess length, case drift, evaluator model-use honesty, private-reasoning exclusion, and unchanged deploy state. | Harness runtime-ready in Dev; no named model candidate or general quality claim |
| Soul routes hold | Route consistency checks include `/soul.load`, `/personality.overlay`, `#soul`, `#primary-identity`, `#personality-overlay`, `@soul-profile`, `@identity-slot`, `@personality-overlay`, `soul.load`, and `personality.overlay`. | Passed |
| Persistent memory routes hold | Route consistency checks include memory write, compact, search, session search, user profile, target tags, bindings, and skill contracts. | Passed |
| Memory-log compliance holds | The structural command validates `memory-log/v1`, UTC-valid `YYYYMMDDTHHmmssZ`, shard-month identity, unique ordered sigils, and required fields; the base-ref command proves historical bytes remain an unchanged prefix. | Passed |
| Skill-system routes hold | Route consistency checks include skill discovery, load, bundle, manage, progressive-disclosure tags, open-standard tag, security tag, bindings, and skill contracts. | Passed |
| Context-file routes hold | Route consistency checks include context discover, load, audit, context tags, working-directory bindings, policy bindings, and skill contracts. | Passed |
| Context-reference routes hold | Route consistency checks include reference expand, audit, context-reference tags, reference bindings, attached-context packets, and skill contracts. | Passed |
| Kanban routes hold | Route consistency checks include Kanban task, handoff, sync, board tags, row bindings, profile bindings, worker process bindings, and `kanban.collaborate`. | Passed |
| Centralized planning compliance holds | Startup validates the bounded index and all shards; release preserves committed prefixes and validates one appended active-shard row for the declared Context. | Passed |
| Planning-shard compliance holds | Structural validation covers the index and every monthly shard; release validation preserves base prefixes and requires one strict declared current row. | Passed |
| Tools and toolsets routes hold | Route consistency checks include toolset enable/disable, tool-function tags, toolset tags, platform-toolset tags, bindings, and skill contracts. | Passed |
| Tool-gateway routes hold | Route consistency checks include tool catalog, route, provider select, audit, tool-category tags, bindings, and skill contracts. | Passed |
| Tool-search routes hold | Route consistency checks include tool search, describe, call, deferred-schema tags, bridge bindings, memory contracts, and skill contracts. | Passed |
| MoA routes hold | Route consistency checks include `/moa`, `#mixture-of-agents`, `#reference-agents`, `#aggregator-agent`, `@moa-preset`, `@reference-agents`, `@aggregator-agent`, `moa.run`, and `agent.moa`. | Passed |
| Learning-loop routes hold | Route consistency checks include learning commands, tags, bindings, `skill_contracts`, and `agent.learning`. | Passed |
| Stateful orchestration routes hold | Route consistency checks include orchestration commands, tags, bindings, `skill_contracts`, and `agent.orchestrator`. | Passed |
| SuperAgent routes hold | Route consistency checks include `/superagent.run`, long-horizon tags, sandbox/message bindings, and `superagent.run`. | Passed |
| External copy guard holds | Artifact and text scans include external-copy indicators and return no copied code, APIs, prompts, schemas, examples, tests, fixtures, or prose from referenced agent repositories. | Passed |
| Computing-flow is canonical | `SKILLS.md`, `DICTIONARY-COMMAND.md`, and `DICTIONARY-SEMANTIC.md` expose `flow.computing`, `/computing-flow`, and `#computing-flow`. | Passed |
| Slash dictionary has external proof | `npm -C $KNOWGRPH_ROOT/canvas run test:ci:unit -- ui.floatingPanelChat.composer.memoryInvocationRuntime` reports `SUMMARY total=1 ok=1 failed=0`. | Passed |
| FloatingPanel Chat action recommendation has external proof | Focused tests for `ui.floatingPanelChat.pipeline`, `ui.floatingPanelChat.quickActions.invocationRoutes`, `ui.floatingPanelChat.contextRail.quickActions`, `ui.floatingPanelChat.composer.ingestCommandRegistry`, `ui.floatingPanelChat.composer.slashVariableMenus`, and structured prompt contracts report `SUMMARY ... failed=0`. | Passed |
| KGC computing-flow has external proof | `npm -C $KNOWGRPH_ROOT/canvas run test:ci:unit -- chat.responseContract.prompt.kgcComputingFlowKtvShape` reports `SUMMARY total=1 ok=1 failed=0`. | Passed |
| Agentic video workflow has Dev proof | Combined multi-agent-pipeline, parallel-shot-generation, image-consistency, automated-image-generation, reference-selection, multi-camera, expressive-storyboard, long-script, narrative/continuity, workflow, live-client, runtime, cost, property, local MCP, and remote MCP suites report 136/136 passing. This includes the forward-only nine-stage DAG, specialist assignments, typed handoffs, semantic checkpoint reuse, selected-frame/clip/output indexing, provider economics, honest unverified completion, dependency-propagated blocking, same-camera concurrency, stable output ordering, VLM selection, temporal state, and accounting proof. Changed-file hygiene remains blocked by unrelated oversized shared-checkout files, and the Canvas TypeScript gate is separately blocked by an unrelated `flowCanvasOverlayNativeScenePartitionRegression` GraphData fixture missing its required `type`. | Passed with unrelated shared-checkout gates reported |
| Central prompt-preset selection and execution boundary have Dev proof | The source-backed `PROMPT-PRESETS.md` catalog exposes Video Agent, SME Care Agent, Investment Research Agent, and Crawler Agent in the first-class FloatingPanel Prompt Presets view. Each row uses a catalog-owned `/*-prompt-preset` selection alias and resolves a separate executable `/...-agent` runtime route; selecting a row loads the centralized prompt without submitting or adding chat history. Focused catalog and invocation tests prove four-route loading, alias-to-runtime resolution, duplicate or missing-entry failure, native crawler routing, and the absence of the stale video-only control. Existing video preset, persistence, media-projection, and deterministic output tests continue to prove the Video Agent path, while crawler proof covers the native Import URL workflow and separate persisted report and Markdown pipe-table Canvas outputs. Send remains the execution boundary, and validation made no Prod mirror write, Cloudflare action, or historical artifact backfill. | Passed |
| Image to Three.js skill has Dev proof | Eight focused conversion, projection, source-replacement, fallback, and disposal selectors pass; the browser-smoke contract passes; task-mode browser proof renders a PNG Rich Media Panel, runtime-generated JPEG Card, SVG Rich Media Panel, SVG Storyboard Widget, and typed fallback on the visual Canvas. Canvas TypeScript and hygiene gates pass, package manifests remain unchanged, and no external plugin code or dependency is present. | Passed |
| Canonical docs source has Dev proof | The registered Agentic Canvas OS `main` worktree remains the only normal runtime docs source and must be clean at fetched `origin/main`. Focused coordination tests prove additional registered task worktrees can mutate branch-exclusive scopes without becoming runtime sources. Knowgrph consumer predev alignment with this v2 policy remains a separate downstream gate. | Passed for Agentic Canvas OS; downstream consumer alignment pending |
| Deploy guard holds | Scoped git status shows no `content/knowgrph` mutation and no deploy command was run. | Passed |

## Promotion Boundary

| Claim | Status | Reason |
|---|---|---|
| Agentic Canvas OS docs control surface | Runtime-ready | Parse, route, scan, proof, and deploy-boundary checks are reproducible locally. |
| Soul identity docs contracts | Runtime-ready for docs | Contracts are route-complete, source-backed, scan-bounded, no-copy, and no-hardcoded-default; live prompt runtime remains separately gated. |
| Persistent memory docs contracts | Runtime-ready for docs | Contracts are route-complete, bounded, target-separated, scan-gated, capacity-aware, and no-copy; live memory runtime remains separately gated. |
| Skills system docs contracts | Runtime-ready for docs | Contracts are route-complete, metadata-first, progressive, resource-bounded, scan-gated, open-standard-compatible, and no-copy; live skill runtime remains separately gated. |
| Instruction audit Dev runtime | Runtime-ready in Dev | The local audit is deterministic, intent-preserving, budgeted, duplicate-aware, canonical-owner-aware, baseline-comparable, zero-cost, and non-mutating; it does not claim model-quality improvement from structural reduction alone. |
| Instruction task-quality evaluation | Runtime-ready in Dev | The suite and scorer are executable, model-agnostic, provenance-bound, final-answer-only, and fail closed; model-specific quality remains unproven until a complete candidate passes and receives human review. |
| Context files docs contracts | Runtime-ready for docs | Contracts are route-complete, working-directory-scoped, precedence-aware, scan-bounded, subordinate to facts and identity, and no-copy; live context runtime remains separately gated. |
| Context references docs contracts | Runtime-ready for docs | Contracts are route-complete, workspace-scoped where applicable, egress-aware, warning/refusal typed, bounded, and no-copy; live reference runtime remains separately gated. |
| Kanban collaboration docs contracts | Runtime-ready for docs | Contracts are route-complete, row-based, profile-named, worker-process-aware, conflict-aware, shared-utility-owned, and no-copy; live worker runtime remains separately gated. |
| Tools and toolsets docs contracts | Runtime-ready for docs | Contracts are route-complete, schema-backed, existing-function-only, platform-scoped, approval-gated, secret-safe, and no-copy; live toolset runtime remains separately gated. |
| Tool Gateway docs contracts | Runtime-ready for docs | Contracts are route-complete, existing-infrastructure, per-tool, approval-gated, cost-logged, secret-safe, and no-copy; live tool runtime remains separately gated. |
| Function calling Dev runtime | Runtime-ready in Dev | The local controller is strict, typed, bounded, selection-aware, call-id-preserving, reasoning-continuous, cost-aware, gateway-owned, fail-closed, and no-copy; a live model adapter, exact capabilities, and real gateway execution remain separately gated. |
| Tool Search Dev runtime | Runtime-ready in Dev | The local controller is typed, bounded, session-scoped, metadata-first, exact-load, caller-aware, cost-aware, fail-closed, and no-copy; live provider search, context reduction, and downstream gateway execution remain separately gated. |
| Programmatic tool-calling Dev runtime | Runtime-ready in Dev | The local controller is typed, bounded, caller-linked, cost-aware, fail-closed, and forbids local code execution; a live hosted adapter, exact model capability, and provider context-isolation evidence remain separately gated. |
| Running agents Dev runtime | Runtime-ready in Dev | The local controller is typed, bounded, continuation-exclusive, pause-aware, same-loop streaming, cost-honest, fail-closed, and no-copy; a downstream adapter and live provider, tool, handoff, session, and streaming proof remain separately gated. |
| Agent runtime composition Dev runtime | Runtime-ready in Dev | Exact source verification, model and transport selection, Running Agents continuation, definition-owned output validation, and orchestration owner transitions have integrated offline proof; the default Worker has no execution adapter or authorizer, and live provider behavior remains unverified. |
| Sandbox Agents Dev runtime | Runtime-ready in Dev with bounded local Docker proof | The generic controller is joined by an immutable-image Docker adapter, deny-first application authorizer, atomic file checkpoint store, and separate 20-check verifier. The default Worker remains unconfigured; cloud hosting, environment bindings, online package egress, public ports, and formal certification remain gated. |
| Models and providers Dev runtime | Runtime-ready in Dev | The local registry is typed, bounded, revision-fenced, precedence-aware, feature- and transport-matched, secret-safe, fail-closed, and no-copy; adapter execution, provider capability truth, usage, and cost remain separately gated. |
| Mixture-of-agents docs contracts | Runtime-ready for docs | Contracts are route-complete, bounded, one-shot, no-copy, and cost-gated; live runtime remains separately gated. |
| Learning-loop docs contracts | Runtime-ready for docs | Contracts are route-complete, no-copy, bounded, and review-gated; live runtime remains separately gated. |
| Stateful orchestration docs contracts | Runtime-ready for docs | Contracts are route-complete, no-copy, checkpointed, bounded, and review-gated; live runtime remains separately gated. |
| Agentic video workflow Dev runtime | Runtime-ready in Dev | Native workflow schema, exact-span long-script corpus, expressive storyboard, scene rigs, temporal first-frame reference catalog/selection, optional strict entity/environment coverage, KGC/VLM/provider reference parity, action-beat blocking, background continuity, explicit rhythm, plot/dialogue retention, hierarchical planning, specialist negotiation, persistent checkpoint, completed-shot reuse, bounded retry, cost/ledger reuse, and MCP schema parity have focused proof; Prod mirror and Cloudflare remain gated. |
| Image to Three.js skill Dev runtime | Runtime-ready in Dev | Native PNG/JPG/JPEG textured-plane and SVG fill/stroke geometry projections have focused conversion, lifecycle, fallback, TypeScript, hygiene, and shared-surface browser proof; protected integration, Prod mirror, and Cloudflare remain gated. |
| Long-horizon SuperAgent docs contracts | Runtime-ready for docs | Contracts are route-complete, sandbox-scoped, message-gated, artifact-backed, no-copy, bounded, and cost-gated; live runtime remains separately gated. |
| `knowgrph` local runtime capabilities | Gated by focused proof | Must be proven by the relevant `knowgrph` tests or local MCP calls. |
| Prod mirror | Gated by operator approval | Forbidden until explicit instruction. |
| Cloudflare | Gated by operator approval | Forbidden until explicit instruction and returned live evidence. |

## Revalidation

Run the focused commands in `VALIDATION-RUNBOOK.md` after any change to this folder. If a runtime owner in `$KNOWGRPH_ROOT` changes, add the relevant focused `knowgrph` test or MCP proof before updating this ledger.
