---
title: "Knowgrph Agentic Canvas OS Runtime Readiness"
graphId: "md:knowgrph-agentic-canvas-os-runtime-readiness"
doc_type: "Runtime Readiness Matrix"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-canvas-os-runtime-readiness/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_proof: "RUNTIME-PROOF.md"
external_runtime_policy: "knowgrph runtime, Prod mirror, and Cloudflare remain gated until explicit proof or approval"
publish_policy: "Dev-only until explicit operator approval"
kgCanvasSurfaceMode: "2d"
kgCanvasRenderMode: "2d"
kgCanvas2dRenderer: "storyboard"
kgDocumentSemanticMode: "document"
kgFrontmatterModeEnabled: true
kgMultiDimTableModeEnabled: true
kgDocumentStructureBaselineLock: false
socket_types:
  readiness_spec_signal:
    label: "Readiness spec signal"
    cardinality: "one-to-many"
  readiness_proof_signal:
    label: "Readiness proof signal"
    cardinality: "one-to-many"
  readiness_boundary_signal:
    label: "Readiness boundary signal"
    cardinality: "one-to-one"
flow:
  direction: {key: direction, type: string, value: "LR"}
  edgeType: {key: edgeType, type: string, value: "smoothstep"}
  balancedViewportPreset: {key: balancedViewportPreset, type: string, value: "widgetFrontmatter"}
  computed: {key: computed, type: boolean, value: true}
  snapToGrid: {key: snapToGrid, type: boolean, value: true}
  nodes:
    - id: {key: id, type: string, value: "spec_complete"}
      type: {key: type, type: string, value: "source"}
      label: {key: label, type: string, value: "Spec-complete docs"}
      lane: {key: lane, type: string, value: "spec"}
      position: {key: position, type: object, value: {x: 0, y: 0}}
      handles: {key: handles, type: list, value: ["spec.out"]}
      "flow:portTypes": {key: "flow:portTypes", type: list, value: ["readiness_spec_signal"]}
    - id: {key: id, type: string, value: "runtime_ready_gate"}
      type: {key: type, type: string, value: "guard"}
      label: {key: label, type: string, value: "Runtime-ready gate"}
      lane: {key: lane, type: string, value: "validation"}
      position: {key: position, type: object, value: {x: 300, y: 0}}
      handles: {key: handles, type: list, value: ["gate.in", "gate.out"]}
    - id: {key: id, type: string, value: "proof_ledger"}
      type: {key: type, type: string, value: "observer"}
      label: {key: label, type: string, value: "Proof ledger"}
      lane: {key: lane, type: string, value: "proof"}
      position: {key: position, type: object, value: {x: 600, y: 0}}
      handles: {key: handles, type: list, value: ["proof.in", "proof.out"]}
    - id: {key: id, type: string, value: "deploy_boundary"}
      type: {key: type, type: string, value: "guard"}
      label: {key: label, type: string, value: "Deploy boundary"}
      lane: {key: lane, type: string, value: "boundary"}
      position: {key: position, type: object, value: {x: 900, y: 0}}
      handles: {key: handles, type: list, value: ["boundary.in"]}
  edges:
    - id: {key: id, type: string, value: "spec_to_gate"}
      source: {key: source, type: string, value: "spec_complete"}
      target: {key: target, type: string, value: "runtime_ready_gate"}
      type: {key: type, type: string, value: "readiness_spec_signal"}
    - id: {key: id, type: string, value: "gate_to_proof"}
      source: {key: source, type: string, value: "runtime_ready_gate"}
      target: {key: target, type: string, value: "proof_ledger"}
      type: {key: type, type: string, value: "readiness_proof_signal"}
    - id: {key: id, type: string, value: "proof_to_boundary"}
      source: {key: source, type: string, value: "proof_ledger"}
      target: {key: target, type: string, value: "deploy_boundary"}
      type: {key: type, type: string, value: "readiness_boundary_signal"}
---

# Runtime Readiness

Runtime-ready means the claim can be proven from surfaced output. This file marks the Agentic Canvas OS docs control surface runtime-ready. It does not claim that every external `knowgrph`, Prod mirror, or Cloudflare runtime is already executed.

## Readiness Matrix

| Capability | Current target | Runtime-ready proof | Status |
|---|---|---|---|
| Documentation control surface | Local docs parse, route, validate, and preserve deploy boundaries. | `RUNTIME-PROOF.md` records frontmatter, line-count, ASCII, artifact, route, diff, and deploy-guard checks. | Runtime-ready |
| Multi-worktree writer coordination | Same-device and cross-device chats may implement different semantic scopes concurrently in distinct registered task worktrees or clones; each worktree owns one branch-bound session lease while same-worktree, same-branch, and duplicate-scope mutation serialize. `.local`, underscore, and hyphen hostname identities remain valid device segments, semantic scope stays hyphen-only, and rejected identity cannot mutate checkout state. | `writer-lease-lib.mjs` owns the Git-common-directory lease registry; `repository-guards.mjs`, `device-branch-lib.mjs`, the pre-commit guard, draft ownership PR metadata, monotonic epochs, TTL heartbeat, delivery revision, fencing ancestry, and focused regression tests provide proof. | Runtime-ready in Dev |
| Cache context runtime | Stable prompt content compiles once per namespace and revision, dynamic tails remain last, and local reuse never masquerades as a provider hit. | `agent-api/src/cache-context.js`, isolate-scoped registry injection, `CACHE-CONTEXT.md`, sanitized readiness, and six focused offline tests prove exact reuse, invalidation, bounded eviction, eligibility honesty, and read/write telemetry. | Runtime-ready in Dev; live provider hit gated |
| Reasoning continuity runtime | Stable goals, assumptions, and priorities allow compatible earlier reasoning to be requested with the last completed response; invariant drift resets rendered reasoning without conflating conversation state. | `agent-api/src/reasoning-continuity.js`, isolate-scoped registry injection, `REASONING-CONTINUITY.md`, sanitized readiness, and eight focused offline tests prove capability gating, serialization, bounds, drift reset, request intent, and returned effective-context confirmation. | Runtime-ready in Dev; live provider confirmation gated |
| Function calling runtime | Models may request strict application functions while exact call identity, guarded gateway execution, signed review, reasoning continuity, durable continuation, execution receipts, and separate costs remain application-owned. | `agent-api/src/{function-calling.js,function-calling-manager.js,function-calling-continuation.js,function-execution-receipts.js,openai-responses-function-adapter.js,knowgrph-function-gateway.js,knowgrph-function-tools.js,function-calling-handler.js,durable-object-state-store.js}`, the route-free `env.dev` Worker wiring, `scripts/live-function-run-note-proof.mjs`, `FUNCTION-CALLING.md`, `LIVE-REVIEWED-FUNCTION-PROOF.md`, focused tests, the explicit cross-repository proof, and one accepted provider run establish immutable review, native atomic receipt echo, one-revision recovery, terminal replay, strict schemas, redaction, returned usage, and persisted read-back. | Verified bounded live in Dev; 1 logical run, 2 provider requests, 1 reviewed call, 546 input tokens, 55 output tokens, USD 0.000876; Prod remains gated |
| Agent definitions runtime | Each specialist binds an application-verified source URI and digest to its exact model route, ordered instructions, and optional reference-only behavior without acquiring execution authority. | `agent-api/src/agent-definitions.js`, isolate-scoped Worker injection, `AGENT-DEFINITIONS.md`, sanitized readiness, and eight focused offline tests prove exact source verification, immutable registration, revision fencing, capability authorization, handoff verification, bounds, and output validation. | Runtime-ready in Dev; one source-backed specialist has bounded live proof; default Worker remains gated |
| Models and providers runtime | Prepared agents resolve one revision-bound provider, explicit model, and compatible transport through agent, run, process, then provider-local defaults without calling an adapter. | `agent-api/src/{model-providers.js,model-config.js}`, Agent Definition alignment, isolate-scoped Worker injection, `MODELS-AND-PROVIDERS.md`, sanitized readiness, and seven focused offline tests prove precedence, revision fencing, exact features, transport behavior, strict environment input, bounds, and secret redaction. | Runtime-ready in Dev; one explicit OpenAI route has bounded live proof; default Worker remains gated |
| Running agents runtime | One application turn advances bounded transitions, uses one continuation strategy, resumes pauses in the same turn or after an isolate restart, and streams through one settlement loop. | `agent-api/src/{running-agents.js,running-agent-contract.js,durable-object-state-store.js}`, `worker/agent-state.js`, `RUNNING-AGENTS.md`, sanitized readiness, seven lifecycle tests, and three durable-state tests prove continuation, streaming, atomic claims, cross-isolate recovery, replay fencing, bounds, timeout, and honest cost. | Runtime-ready in Dev; durable recovery proven offline and previous-response lifecycle has bounded live proof |
| Guardrails and human review runtime | Source-referenced checks run around composed execution; tool checks stay beside the gateway; sensitive actions require one authenticated approve, reject, or edit decision. | Guardrail, signed-token, Durable Object, gateway, app, and Worker owners plus nine focused guardrail/state tests prove ordered validation, exact-scoped reviewer identity, atomic consumption, edit revalidation, expiry, invalid-evidence retry, cross-isolate pause recovery, and sanitized readiness. | Runtime-ready in Dev with durable offline review proof; live reviewed side effects and deployment remain gated |
| Agent orchestration and handoffs runtime | Revision-fenced workflows route exact manager and specialist branches while every branch declares whether the source manager keeps the conversation and final answer or the target takes both over. | `agent-api/src/{agent-orchestration.js,agent-orchestration-contract.js}`, isolate-scoped Worker injection, `AGENT-ORCHESTRATION.md`, sanitized readiness, and eight focused offline tests prove topology, delegation, handoff, handback, current-owner continuation, revision fencing, application authorization, serialization, replay, redaction, and honest cost. | Runtime-ready in Dev with one bounded live delegation and handoff proof; default Worker remains gated |
| Agent Swarm runtime | One resolved exact base-agent goal is decomposed at runtime into a bounded task DAG whose independent work can be claimed and executed horizontally without predefined roles or caller-authored workflow topology. | `agent-api/src/agent-swarm*.js`, the existing `AGENT_STATE` adapter, session-owned authenticated Worker routes, `AGENT-SWARM.md`, sanitized readiness, and 34 focused tests prove goal-only planning, ABA-safe reservation, atomic claims, observed overlap, admission-fixed deadlines, full-lease admission, recovery, stable retry idempotency, stale fencing, task/synthesis cancellation, durable receipt verification, private intermediates, and one base-agent final owner. | Runtime-ready offline in Dev; default resolver, planner, worker, synthesizer, receipt-verifier, and authorizer adapters remain unconfigured and live provider execution is unverified |
| Agent Toolkit runtime | Application-authorized caller-declared target, candidate, adapter, evaluator, dataset, and metric revision digests can be observed and evaluated, then compared only as unique trusted evidence inside a target/adapter/operation/profile-bound cohort; execution ownership never moves. | `agent-api/src/agent-toolkit*.js`, `AGENT_STATE` claims and expiry alarms, authenticated Worker routes, `AGENT-TOOLKIT.md`, sanitized readiness, and the combined Toolkit/runtime/app/Worker/durable-state suite prove server timing, payload redaction, lifecycle fencing, stable evaluator idempotency, one-owner cost, principal-key isolation, remote-evidence exclusion, deterministic thresholds, physical durable cleanup, and no apply method. | Runtime-ready offline in Dev; revision verification is `application-authorizer-required` and otherwise `unverified`, the default evaluator is unconfigured, refreshed session principals cannot resume earlier cohorts without a stable application principal, measured improvement is unverified, and proposals never auto-apply |
| Agent runtime composition | One source-backed definition passes through exact model and transport selection, one Running Agents lifecycle, final-output validation, and the resolver/runner interface used by orchestration. | `agent-api/src/agent-runtime-composition.js`, a repository-backed definition fixture, `AGENT-RUNTIME-COMPOSITION.md`, app and Worker wiring, sanitized readiness, and twelve focused offline tests prove real source hashing, revision and identity fencing, feature matching, continuation, delegation, handoff, output rejection, hidden intermediates, and honest cost. | Runtime-ready in Dev with one bounded live composed proof; default Worker remains unconfigured |
| Application composition contract | Exact host invocation aliases compile immutable version- and schema-fenced component interfaces into a deterministic dependency plan; optional execution sequences ready work through existing owners only. | `APPLICATION-COMPOSITION.md`, `FACTS.md`, all three dictionaries, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and focused tests prove the exact alias tuple, three MCP tools, connection-negotiated capabilities, opaque integration profiles, owner boundaries, explicit migration diagnostics, and no silent upgrade, retry, fallback, or deploy. | Runtime-ready for ACOS contract; Knowgrph local MCP fixture and protected integration proof remain required for combined execution readiness |
| Bounded live agent provider proof | One approved Node-only run joins source-backed manager and specialist definitions to explicit OpenAI Responses configuration without changing Worker defaults. | `LIVE-AGENT-PROVIDER-PROOF.md`, five offline adapter tests, and the accepted three-call proof record establish exact request bounds, manager-owned delegation, specialist-owned handoff, hash-linked stored continuation, effective `all_turns`, returned usage, and redacted cost. | Verified bounded live in Dev; 3 calls, 576 input tokens, 53 output tokens, USD 0.00447; no deploy |
| Sandbox Agents runtime | Application-approved work can use one provider-neutral workspace with bounded files, argv commands, offline local packages, internal networking, loopback previews, opaque snapshots, atomic pause/resume claims, and cleanup. | The generic controller, Docker CLI adapter, deny-first authorizer, file state store, separate verifier, 13 offline tests, affected readiness tests, and the immutable-image live command prove exact policy, real container behavior, 20 fresh checks, zero cost, and zero residual resources. | Runtime-ready in Dev with bounded local Docker proof; default Worker and external hosting remain gated |
| Programmatic tool-calling runtime | Predictable multi-call read-only stages may use provider-hosted JavaScript while the application preserves tool policy, caller lineage, stored or stateless continuation, bounds, and compact final evidence. | `agent-api/src/{programmatic-tool-calling.js,programmatic-tool-routing.js}`, isolate-scoped Worker injection, `PROGRAMMATIC-TOOL-CALLING.md`, sanitized readiness, and twelve focused offline tests prove hosted-attestation gates, ordered replay, caller-preserving outputs, direct routing for high-impact work, schema validation, bounds, serialization, timeout, cost, and no local code execution. | Runtime-ready in Dev; hosted adapter and context-isolation proof gated |
| Tool Search runtime | Direct definitions remain available while optional definitions load only after bounded metadata search in an active session; hosted programs require top-level loading first. | `agent-api/src/tool-search.js`, isolate-scoped Worker injection, `TOOL-SEARCH.md`, sanitized readiness, and eight focused offline tests prove immutable initial exposure, private hosted catalog mapping, exact subset loading, canonical hosted validation, authorization, capability gates, namespace bounds, replay protection, timeout, honest costs, and cleanup. | Runtime-ready in Dev; live provider context reduction gated |
| Instruction audit runtime | Durable project guidance stays intent-complete and the skill catalog stays metadata-first without repeated workflow context. | `scripts/instruction-audit-lib.mjs`, `INSTRUCTION-AUDIT.md`, seven focused tests, current-surface audit, and exact Git-baseline comparison prove budgets, required intent, duplicate rejection, owner boundaries, route ownership, zero model cost, and no deploy action. | Runtime-ready in Dev |
| Instruction task-quality evaluation | Structural instruction changes can be screened against observable final-answer behavior without grading private reasoning or coupling to one model. | Four bounded cases, typed candidate and report schemas, seven discrimination tests, suite validation, explicit provenance, human-review boundary, and zero evaluator model/deploy claims. | Runtime-ready in Dev; no named model candidate evaluated |
| Soul identity layer | Durable identity, prompt slot 1, and personality overlay contracts are source-backed. | `SOUL.md`, `FACTS.md`, dictionaries, `MEMORY.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Persistent memory contracts | Bounded agent notes, explicit user profile, append-only monthly history, frozen snapshots, writes, compaction, and session search are documented as no-copy contracts. | `MEMORY.md`, `MEMORY-LOG.md`, `memory/YYYY-MM.md`, `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`, and `VALIDATION-RUNBOOK.md` enforce hybrid structure at startup and byte-prefix preservation before release. | Runtime-ready for docs |
| Skills system contracts | Skill discovery, on-demand load, progressive disclosure, bundles, managed writes, and open-standard compatibility are documented as no-copy contracts. | `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Context files contracts | Working-directory project context discovery, progressive subdirectory hints, scan, truncation, and audit are documented as no-copy contracts. | `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Context references contracts | Explicit file, folder, diff, staged, git, and URL references expand into bounded attached context on supported surfaces. | `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Kanban collaboration contracts | Durable task and handoff rows coordinate named profiles and full OS worker processes. | `kanban.md`, `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Monthly planning shards | Cross-repository planning loads one bounded index plus the exact scope/month instead of a monolithic history. | `TODO.md`, `todo/YYYY-MM.md`, `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`, and `VALIDATION-RUNBOOK.md` enforce lifecycle, month identity, size caps, strict current rows, and byte-prefix preservation. | Runtime-ready for docs |
| Todo planning-ledger compliance | Every release carries one attributable planning update without rewriting historical baseline rows. | `START-WORKFLOW.md` records the exact todo base and context; `RELEASE-WORKFLOW.md` plus `VALIDATION-RUNBOOK.md` require one changed 11-cell, non-empty, dated row with a directive of at most 50 words and byte-identical non-target baseline rows. | Runtime-ready for docs |
| Tools and toolsets contracts | Callable tool functions and logical toolsets are documented with platform-scoped enable/disable state. | `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Tool Gateway contracts | Web search, image generation, TTS, and cloud browser tools route through existing infrastructure with per-tool provider state and approval policy. | `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Tool Search contracts | Eligible MCP and non-core plugin schemas defer behind session metadata, exact definition loading, and real-gateway authorization routes. | `TOOL-SEARCH.md`, `FACTS.md`, dictionaries, `SKILLS.md`, `MEMORY.md`, `AGENTS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready in Dev |
| Facts layer | Shared truth precedes memory and role instructions. | `FACTS.md` parses and directly resolves `/query`, `#truth`, and `@agent` through the dictionaries. | Runtime-ready |
| Agent instructions | Always-on guidance contains only durable repository behavior and canonical owner routing. | `AGENTS.md` parses, stays within the instruction-audit budget, retains required intent, and preserves Dev-only boundaries. | Runtime-ready |
| Invocation dictionaries | `/`, `#`, and `@` dictionaries are source-backed. | `DICTIONARY-COMMAND.md`, `DICTIONARY-SEMANTIC.md`, and `DICTIONARY-BINDING.md` parse and expose dictionary entries. | Runtime-ready |
| Skill catalog | Skill ids, families, variants, and selected detail owners are discoverable without loading embedded workflow handbooks. | `SKILLS.md` parses, lists `skill_contracts` and `skill_variants`, links specialized owners, and passes the metadata-first instruction audit. | Runtime-ready |
| Mixture-of-agents contracts | `/moa` is documented as one-shot, bounded reference fan-out plus aggregator-owned response. | `FACTS.md`, dictionaries, `MEMORY.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Learning-loop contracts | Experience capture, memory search, skill proposal, skill evolution, and identity reflection are documented as no-copy, review-gated contracts. | `FACTS.md`, dictionaries, `MEMORY.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`, and `MCP-GATEWAY.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Skill Evolution ACOS contract | Source-fenced epochs, batches, mini-batches, text-mutation learning-rate schedules, held-out gates, and review-only results are specified exactly. | `SKILL-EVOLUTION.md`, dictionaries, `SKILLS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and the validating MCP client bind one `knowgrph.skill.evolve` route while Knowgrph remains executable owner. | Spec-complete; client transport tested; runtime readiness gated |
| Stateful orchestration contracts | Graph state, nodes, edges, checkpoints, human review, and streaming traces are documented as no-copy, bounded contracts. | `FACTS.md`, dictionaries, `MEMORY.md`, `SKILLS.md`, `HARNESS-CONTRACTS.md`, `MCP-GATEWAY.md`, and `PRD-TAD.md` expose matching routes, tags, bindings, guards, and VCCs. | Runtime-ready for docs |
| Long-horizon SuperAgent contracts | Research, coding, and creation runs compose graph, memory, skills, tools, sandbox workspace, message gateway, artifacts, verification, and cost proof. | `/superagent.run`, `#long-horizon-harness`, `#sandboxed-workspace`, `#message-gateway`, `@sandbox-workspace`, and `@message-gateway` resolve through the docs contracts. | Runtime-ready for docs |
| Computing-flow contract | `/computing-flow` routes to KGC/frontmatter, not a separate flow engine. | `/computing-flow`, `#computing-flow`, and `flow.computing` are present; focused KGC computing-flow tests provide external supporting proof. | Runtime-ready for docs |
| Harness contracts | AI-capable components have typed input, output, fallback, cost, and bounds. | `HARNESS-CONTRACTS.md` parses and defines universal harness shape, cost log fields, gates, and VCC templates. | Runtime-ready |
| Validation runbook | Operators can reproduce focused docs checks. | `VALIDATION-RUNBOOK.md` requires frontmatter for every Markdown file, avoids self-matching artifact patterns, and names route consistency checks. | Runtime-ready |
| Deploy boundary | Docs do not mutate Prod mirror or Cloudflare. | Git scoped status confirms `content/knowgrph` is untouched; no deploy command is required or run. | Runtime-ready |

## External Runtime Gates

These capabilities remain outside the docs-only runtime-ready claim. Promote them only after current focused proof from `$KNOWGRPH_ROOT` or an explicitly approved deploy lane.

| Capability | Required proof | Status |
|---|---|---|
| Capability discovery | MCP/local catalog check exits 0; response includes deduplicated tool ids and zero cost. | Gated by focused `knowgrph` proof |
| OS process view | Status call returns normalized entries and `unavailableSources[]` without mutation. | Gated by focused `knowgrph` proof |
| Cost summary | Cost logs validate against schema; model-free views report exact zero. | Gated by focused `knowgrph` proof |
| Gate catalog | Canonical gates are listed; reads do not issue or consume tokens. | Gated by focused `knowgrph` proof |
| Circuit breakers | Registry returns each bounded loop; no loop lacks max iteration and circuit breaker. | Gated by focused `knowgrph` proof |
| Soul prompt runtime | Prompt assembly loads scanned `SOUL.md` into slot 1 or returns typed fallback with no silent hardcoded default identity. | Gated by focused `knowgrph` proof |
| Persistent memory runtime | Memory/profile write, compact, frozen snapshot, and session search return typed outputs with scan, capacity, and target-separation proof. | Gated by focused `knowgrph` proof |
| Skills system runtime | Skill discovery, selected source loading, resource loading, bundle resolution, and managed writes return typed outputs with scan, validation, and approval policy proof. | Gated by focused `knowgrph` proof |
| Context files runtime | Context discovery, scanned load, truncation, progressive hints, and audit return typed outputs with stronger facts/identity boundaries. | Gated by focused `knowgrph` proof |
| Context references runtime | Reference expansion and audit return typed attached-context packets, warnings, refusals, source metadata, and unsupported-surface behavior. | Gated by focused `knowgrph` proof |
| Kanban collaboration runtime | Task, handoff, and sync commands return typed row writes, conflict ledgers, profile bindings, and worker-process proof. | Gated by focused `knowgrph` proof |
| Tools and toolsets runtime | Tool catalog reports functions, schemas, risk classes, toolsets, and platform-scoped enable/disable state with approval proof. | Gated by focused `knowgrph` proof |
| Tool Gateway runtime | Tool catalog, provider selection, web search, image generation, TTS, and cloud browser route through existing infrastructure with typed outputs, approval, egress, and cost proof. | Gated by focused `knowgrph` proof |
| Tool Search gateway execution | Loaded definitions dispatch through the real tool identity with schema validation, approval, hooks, audit, and execution cost proof. | Gated by focused `knowgrph` proof |
| Models and providers live execution | A registered adapter executes the resolved provider revision, model, and transport and returns supported-feature, delivery, connection, usage, and cost evidence. | One explicit model and transport passed bounded live execution with usage and cost; provider capability attestation and default Worker wiring remain gated |
| Sandbox Agents hosted containment | Deploy the Docker adapter or another provider with durable state, approved image lifecycle, host monitoring, retention, multi-tenant controls, and independently repeated containment evidence. | Local Docker proof passed; hosted deployment and formal third-party certification remain gated |
| Running agents live execution | One downstream adapter returns real provider continuation, model/tool/handoff events, pause or final settlement, and actual usage without mixing continuation strategies or duplicating gateway policy. | Previous-response continuation, handoff, final settlement, and usage passed bounded live proof; live tools, pause, and streaming remain gated |
| Durable human-review recovery | Atomic review, paused-turn, Function Calling continuation, and execution-receipt stores survive isolate restart, preserve one exact decision and idempotency key, and resume or replay without identity drift or duplicate tool execution. | Cross-isolate behavior is proven with one local Durable Object implementation; deployed multi-region behavior and live reviewed side effects remain gated |
| Programmatic tool-calling provider runtime | Exact model eligibility, hosted sandbox execution, response continuation, program caller lineage, intermediate-result isolation, and real tool-gateway dispatch are returned by one bounded live adapter run. | Gated by downstream adapter plus approved provider proof |
| Mixture-of-agents runtime | `/moa` preset resolution, reference fan-out, aggregator action, cost separation, and no-recursion guard return typed outputs. | Gated by focused `knowgrph` proof |
| Stateful orchestration runtime | Graph validation, checkpoint resume, human review, and stream trace return typed outputs, cost logs, and no-copy validation. | Gated by focused `knowgrph` proof |
| Learning-loop runtime | Memory search, experience capture, skill proposal, skill evolution, and identity reflection return typed outputs, cost logs, review gates, and no-copy validation. | Gated by focused `knowgrph` proof |
| Skill Evolution runtime | Knowgrph `knowgrph.skill.evolve` must prove source-fenced plan/start/step/status/cancel, isolated evaluator-owned held-out rollouts, deterministic mini-batches, textual learning-rate bounds, strict directional promotion, revision-safe resume, phase-separated cost logs, and review-pending-only handoff. | Gated until `RUNTIME-PROOF.md` cites exact integrated revisions and exact passing Knowgrph test commands |
| Long-horizon SuperAgent runtime | `/superagent.run` returns typed plan, workspace scope, message ledger, checkpoints, artifacts, verification state, cost log, and stop condition without copied external runtime layout. | Gated by focused `knowgrph` proof |
| Video Remix Director | Native live planning returns exact-span long-script units, audience-conditioned cinematography, scene camera rigs, stable blocking/backgrounds, intelligent first-frame character/environment/prior-timeline references, automatically generated spatial image prompts, bounded parallel image candidates, deterministic VLM consistency selection, dependency-aware same-camera parallel shot batches, story hierarchy, temporal continuity, bounded specialist negotiation, multimodal review, and one inspectable nine-stage agent DAG with typed handoffs, semantic asset indexing, resource accounting, checkpoint reuse, and dependency-propagated status; gates, Cost Logs, budgets, and retries fail closed. | Runtime-ready in Dev from focused `knowgrph` proof; Prod mirror and Cloudflare gated |
| Canvas dashboard | Markdown/frontmatter/KGC document renders without dashboard-only graph store. | Gated by local Canvas proof |
| Cloudflare control-plane MCP | Worker tool list and run endpoints pass focused checks after explicit deploy approval. | Gated by operator approval |

## Docs Runtime-Ready Checklist

- [x] Parse proof surfaced.
- [x] Route proof surfaced.
- [x] Schema validation proof surfaced for every Markdown file in this folder.
- [x] Cost policy surfaced; docs validation and discovery paths are zero model spend.
- [x] Circuit-breaker policy surfaced for every agentic or feedback loop contract.
- [x] Approval-gate policy surfaced for paid, mutating, browser-auth, Prod, and Cloudflare actions.
- [x] Focused docs checks exited 0.
- [x] Focused external supporting checks for slash and computing-flow contracts exited 0 when run.
- [x] No unintended state mutation occurred.
- [x] No Prod mirror or Cloudflare deploy occurred.

## Runtime-Ready Flow

```mermaid
flowchart LR
  source["Source docs"]
  parse["Frontmatter parse"]
  route["Route consistency"]
  harness["Harness contracts"]
  proof["Runtime proof ledger"]
  docs["Docs runtime-ready"]
  external["External runtime gates"]

  source --> parse --> route --> harness --> proof --> docs
  docs --> external
```

## Status Rules

| Label | Meaning |
|---|---|
| `draft` | Authored but incomplete. |
| `spec-complete` | Contract is complete enough to implement or verify. |
| `runtime-ready` | Focused VCC proof was surfaced in the current runtime. |
| `gated` | Requires operator approval, credentials, paid call, Prod mirror, or Cloudflare action. |
| `blocked` | Cannot advance without missing source, owner, or approval. |

Never promote external capabilities to `runtime-ready` from prose alone.
