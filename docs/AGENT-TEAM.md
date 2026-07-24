---
title: "Role-Based Agent Team Invocation Contract"
graphId: "md:role-based-agent-team"
doc_type: "Invocation And MCP Ownership Contract"
date: "2026-07-24"
lang: "en-US"
schema: "agent-team-invocation-contract/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "canonical role-based team invocation, source shape, lifecycle semantics, bounds, and owner separation"
runtime_scope: "provider-neutral role-playing collaboration composed from existing Agentic Canvas OS agent owners"
runtime_claim: "Agentic Canvas OS supplies a model-free validated contract; executable durable plan/start/list/control readiness belongs only to the matching Knowgrph local stdio MCP runtime and its proof"
runtime_owner: "$GITHUB_ROOT/knowgrph/mcp"
runtime_proof: "../scripts/agent-team-contract.mjs; ../__tests__/agent-team-contract.test.mjs"
invocation: "/agent.team #role-based-agent-team @agent-team"
mcp_tools: ["knowgrph.agent_team.plan", "knowgrph.agent_team.start", "knowgrph.agent_team.list", "knowgrph.agent_team.control"]
external_pattern_source: "https://github.com/crewaiinc/crewai"
external_source_policy: "official abstract capability inspiration only; local source, vocabulary, schemas, prompts, fixtures, tests, and prose are independently authored"
external_dependency: "forbidden"
publish_policy: "Dev-only until matching Knowgrph runtime proof and explicit operator approval"
---

# Role-Based Agent Team

`/agent.team #role-based-agent-team @agent-team` selects one exact, source-backed team whose members collaborate through existing Agent Definitions, Agent Orchestration, and Progressive Agents owners. It does not create another agent registry, loop, model router, tool gateway, state store, approval system, or dynamic swarm.

The tuple is a host invocation alias. MCP clients call the four exact `knowgrph.agent_team.*` wire tools. Unknown aliases remain unsupported.

## Owner Separation

| Owner | Owns | Does not own |
|---|---|---|
| Agentic Canvas OS | Canonical tuple, source contract, revision fences, routing semantics, bounds, and proof requirements. | Durable runs, provider calls, tool execution, credentials, deployment, or a second scheduler. |
| Agent Definitions | Each exact agent id and revision, source digest, model route, instructions, reference-only capabilities, guardrails, and output contract. | Team authority, conversation ownership, or execution. |
| Agent Orchestration | Registered workflow revision, allowed branches, `delegate` and `handoff` behavior, conversation owner, and final-answer owner. | Durable team supervision or caller-invented routes. |
| Progressive Agents | The existing facade that prepares and executes exact agents and workflows through their owners. | A new definition, workflow, state, or provider registry. |
| Knowgrph local stdio MCP | Durable plan/start/list/control records, serialized transitions, checkpoints, replay fences, cancellation, review state, and bounded projection. | New agent definitions, branch semantics, capability grants, model routes, tool policy, or deployment authority. |
| Existing model, tool, guardrail, review, and persistence owners | Their own authorization, execution, receipts, usage, policy, and storage. | Authority inferred from a role, goal, persona, team membership, or MCP request. |
| Operator | Explicit approval and human-review decisions where policy requires them. | Silent approval through presence, metadata, or a prior unrelated decision. |

Agent Swarm remains the separate goal-only dynamic horizontal worker runtime. This contract neither calls it nor broadens it to accept caller-authored roles, participants, tasks, branches, or workflows.

## Source-Backed Team

`@agent-team` resolves one immutable source with this independently authored shape:

```yaml
team:
  teamId: "bounded stable id"
  teamRevision: "exact immutable revision"
  source: {uri: "explicit source URI", digest: "lowercase sha256"}
  manager:
    {participantId: "lead", agentId: "exact definition id", agentRevision: "exact revision", role: "bounded label", goal: "bounded task lens", persona: "bounded collaboration style"}
  specialists:
    - {participantId: "member", agentId: "exact definition id", agentRevision: "exact revision", role: "bounded label", goal: "bounded task lens", persona: "bounded collaboration style"}
  workflow:
    {workflowId: "registered id", workflowRevision: "exact revision", allowedBranchIds: ["registered branch id"]}
  reviewPolicy: {policyId: "registered id", policyRevision: "exact revision"}
  bounds: {maxTurns: 24, maxDelegationDepth: 4, maxFanout: 8, maxRetriesPerTurn: 2, maxStageTimeMs: 60000, maxRunTimeMs: 900000, maxTokens: 120000, maxCostUsd: 5}
```

The source verifier must reproduce the exact URI and digest. Every participant resolves through Agent Definitions at the named revision. The workflow and every allowed branch resolve through Agent Orchestration at the named workflow revision. Same-revision drift, mutable aliases, missing participants, duplicate participant ids, unknown branches, self-routes, or an agent revision not present in the workflow fail before a plan is admitted.

`role`, `goal`, and `persona` are descriptive, bounded collaboration metadata. They are not facts, system instructions, identity, authorization, approval, model selection, capability grants, tool access, credentials, policy exceptions, or final-answer ownership. They remain subordinate to system and operator instructions, `FACTS.md`, Agent Definitions, guardrails, and the registered workflow. A persona cannot ask the runtime to ignore an owner or loosen a bound.

## Typed MCP Lifecycle

Every response uses `knowgrph-agent-team-result/v1` with `ok`, `operation`, `teamId`, `teamRevision`, `runId`, `state`, `stateVersion`, `planDigest`, bounded `evidence`, measured `usage`, and either typed `result` or typed `error`. Secrets, hidden instructions, private intermediate outputs, and raw provider payloads are excluded.

| Tool | Required input | Typed result | Mutation boundary |
|---|---|---|---|
| `knowgrph.agent_team.plan` | Exact invocation, team source identity, requested task, bounds, policy references, and idempotency key. | Immutable `planId`, `planDigest`, resolved revisions, branch set, owner map, effective bounds, and `planned` state. | Read-only and model-free; no durable run, agent call, tool call, checkpoint, or spend. |
| `knowgrph.agent_team.start` | `planId`, `planDigest`, exact `teamRevision`, expected plan state version, and idempotency key. | Durable `runId`, state version, initial checkpoint, manager ownership, and queued or running state. | Creates only the bounded team run after all fences and current policy pass. |
| `knowgrph.agent_team.list` | Bounded filters, page limit, and optional exact run id. | Sanitized summaries, current owner, state, budget use, blockers, review status, and evidence references. | Read-only and zero-model; no polling loop or private output disclosure. |
| `knowgrph.agent_team.control` | Exact `runId`, expected state version, action, idempotency key, reason, and review receipt when required. | One serialized transition, checkpoint reference, new state version, and typed next action. | Only `pause`, `resume`, `cancel`, `retry`, `request_review`, and `record_review` are supported. |

Planning canonicalizes the exact team source, resolved definition revisions, workflow revision, branch ids and modes, review-policy revision, task digest, and effective bounds into `planDigest`. Start, resume, retry, review continuation, and every checkpoint must match that digest and `teamRevision`. Control must also match the current `stateVersion`; stale or skipped versions fail without mutation.

The pair `{idempotencyKey, planDigest}` identifies plan and start retries. The pair `{idempotencyKey, runId, expectedStateVersion, action}` identifies control retries. An exact repeat returns the recorded result; reuse with different content is a conflict. Run ids, transition sequence numbers, and checkpoint ids form the bounded replay fence.

## Durable State And Control

| State | Meaning | Allowed next states |
|---|---|---|
| `planned` | Exact sources and bounds passed zero-mutation validation. | `queued`, `canceled`, `blocked` |
| `queued` | One durable run awaits the supervisor claim. | `running`, `paused`, `canceled`, `blocked` |
| `running` | The supervisor owns one bounded turn. | `running`, `review_pending`, `paused`, `completed`, `failed`, `blocked`, `canceled` |
| `review_pending` | Continuation is durably stopped for a named human decision. | `running`, `failed`, `canceled` |
| `paused` | No new turn starts; resumable checkpoint evidence is retained. | `queued`, `canceled` |
| `blocked` | A typed policy, source, owner, or capability prerequisite is absent. | `queued` after exact revalidation, `canceled` |
| `failed` | A bounded attempt ended with sanitized diagnostics. | `queued` through an eligible fenced retry, `canceled` |
| `completed` | The exact final-answer owner settled one public answer. | none |
| `canceled` | Cancellation is terminal and no later agent or tool work may start. | none |

Each transition atomically records `runId`, `stateVersion`, `transitionSequence`, `checkpointId`, `planDigest`, `teamRevision`, active turn, delegation depth, current conversation owner, final-answer owner, budget use, review state, and redacted evidence references. Restart reconstructs only from the latest exact checkpoint. Missing, forked, stale, or digest-mismatched state blocks recovery rather than guessing.

Cancellation wins over queued continuation and prevents new model or tool calls. An already-started effect may only settle through its existing receipt owner; its result cannot revive the canceled run. Retry consumes the same bounds, increments attempt evidence, and never resets elapsed time, tokens, or cost.

Human review is an explicit `review_pending` checkpoint naming the review-policy revision, question, allowed decisions, and evidence references. Only a matching durable review receipt can continue. An edit that changes task, source, topology, instructions, bounds, or ownership requires a new plan and digest.

## Routing And Output Ownership

The manager owns the conversation at run start. Each turn selects exactly one registered branch from the source-fenced workflow; roles and model output cannot invent a route.

| Branch mode | Intermediate result | Conversation owner | Final answer owner |
|---|---|---|---|
| `delegate` | Target output is private input to the source agent's synthesis. | Source agent remains owner. | Source agent produces the only public answer. |
| `handoff` | Target runs as the user-facing owner. | Target becomes owner only after successful completion. | Target owns the public answer. |

Private specialist outputs are available only to the exact source-agent synthesis step and authorized durable owner. They never appear in `list`, public traces, generic evidence, or the user response. Failed and partial branches publish no intermediate content and do not change ownership.

The final answer owner comes only from successful Agent Orchestration ownership fields. It is never inferred from role names, persona, call order, last responder, cost, or which output appears most complete. Completion requires one bounded public result from that exact owner plus output guardrail acceptance.

## Hard Bounds

| Bound | Maximum |
|---|---:|
| Participants including manager | 16 |
| Turns per run | 24 |
| Delegation depth | 4 |
| Concurrent branch fanout | 8 |
| Retries per turn | 2 |
| Time per authorization, resolution, agent, or review-settlement stage | 60,000 ms |
| Total run time including retries and review-active execution | 900,000 ms |
| Total reported input plus output tokens | 120,000 |
| Total cost | USD 5.00 |
| Serialized task input | 100,000 characters |
| Public final output | 200,000 characters |
| Durable checkpoints | 64 |

The effective value is the lowest of the source, caller, application, provider, and deployment-policy limits. Each spend-bearing call needs a source-bound usage envelope; if current usage plus that envelope could exceed tokens, cost, or time, the call does not start. Actual reported usage is aggregated without fabricating zero. Missing usage or cost evidence is typed `unreported` and blocks additional spend when the remaining budget cannot be proven.

## Deterministic Mock Proof

`npm run agent-team:check` is model-free. Its deterministic fixture validates exact document projections, owner and state tables, bounds, dependency and reference-name guards, line ceilings, and fail-closed mutations with `tokens: 0` and `costUsd: 0`.

A matching Knowgrph deterministic runtime proof must use exact fake source digests, fixed Agent Definition revisions, a fixed Agent Orchestration workflow, an injected response table, and a temporary durable-state adapter. It must prove plan idempotency, start fencing, manager-owned delegate synthesis, target-owned handoff, private-output suppression, checkpoint recovery, stale-version rejection, replay rejection, cancellation precedence, human-review continuation, every hard bound, the four wire tools, and durable restart behavior before runtime-ready promotion. Neither proof makes a provider, production, or deployment readiness claim.

## Clean-Room Boundary

The official CrewAI GitHub repository informs only the abstract observation that specialized agents can collaborate. No CrewAI code, prose, prompt, schema, workflow vocabulary set, example, test, fixture, default, package, service, CLI command, generated artifact, or repository layout is copied, imported, invoked, vendored, or required.

No CrewAI dependency or import may appear in package manifests or runtime source. Removing network access and the external repository changes neither this contract, its dictionary projection, nor deterministic proof. Local owners and schemas remain authoritative.

The automated clean-room check is a dependency and reference-name guard, not a similarity detector. A separate provenance and similarity review must examine authored code, prose, prompts, schemas, tests, fixtures, defaults, API shapes, and configuration before integration.

## VCCs

- Given the canonical tuple, when dictionaries and `FACTS.md` resolve it, then exactly `/agent.team`, `#role-based-agent-team`, and `@agent-team` select this contract.
- Given source or revision drift, when `plan`, `start`, resume, retry, review, or checkpoint recovery runs, then it blocks before new execution.
- Given a delegate, when the target settles, then its result stays private and the source owner synthesizes the only public answer.
- Given a handoff, when the target succeeds, then conversation and final-answer ownership move together; failure changes neither.
- Given any hard bound, cancellation, stale state version, replay, missing review receipt, or unreported remaining budget, when continuation is considered, then no new agent or tool call starts.
- Given the default repository, when `npm run agent-team:check` and `npm run docs:check` run, then validation is deterministic, zero-model, dependency-free, below document line ceilings, and makes no Prod or Cloudflare mutation.
