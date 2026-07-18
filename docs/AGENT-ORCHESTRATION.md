---
title: "Agent Orchestration And Handoffs Runtime Contract"
graphId: "md:agent-orchestration-handoffs-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agent-orchestration-handoffs-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "multi-agent topology, branch routing, conversation ownership, and final-answer ownership"
runtime_scope: "provider-neutral manager delegation and explicit conversation handoff"
runtime_claim: "local controller is runtime-ready in Dev and one manager delegation plus specialist handoff passed bounded live proof; the default Worker remains unconfigured"
runtime_owner: "../agent-api/src/agent-orchestration.js; ../agent-api/src/agent-orchestration-contract.js"
runtime_proof: "../__tests__/agent-orchestration.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/agents/models; https://openai.github.io/openai-agents-js/guides/agents/; https://openai.github.io/openai-agents-js/guides/multi-agent/; https://openai.github.io/openai-agents-js/guides/handoffs/; https://openai.github.io/openai-agents-js/guides/tools/; https://openai.github.io/openai-agents-js/guides/results/"
external_source_policy: "concept reference only; forbid copied code, APIs, examples, prompts, schemas, tests, fixtures, model lists, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Agent Orchestration And Handoffs Runtime

The Agent Orchestration runtime registers one revision-fenced manager and its specialists, then runs one explicit branch per turn. Every branch declares whether the specialist stays behind the source agent or takes over the conversation. Conversation and final-answer ownership are therefore data, not an inference from whichever model returned last.

The cited OpenAI guides inform only the capability class. This repository independently owns its registry, branch vocabulary, request and result shapes, evidence, tests, and prose. No provider SDK implementation or documentation artifact is reproduced.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Agent Definitions | Register each exact agent revision, instructions, model route, capability references, and output contract. | A definition does not execute, authorize, or choose conversation ownership. |
| Agent Orchestration registry | Register topology, responsibilities, allowed branches, branch mode, conversation owner, and final-answer owner. | Registration does not prove a provider call or grant a capability. |
| Application authorizer | Permit the exact delegation or handoff before resolution or execution. | Workflow presence is never authorization. |
| Agent resolver | Prove source and target identities match the registered revisions. | Similar names, latest revisions, or caller-supplied substitutes do not satisfy the fence. |
| Running Agents adapter | Execute one normalized agent role and return bounded output with honest cost. | Adapter attestation is not independent provider or model proof. |
| Orchestration controller | Serialize conversations, enforce current ownership, hide delegate intermediates, settle output ownership, and aggregate costs. | It does not select models, execute tools directly, persist durable history, or weaken gateway policy. |

## Workflow Contract

`createAgentOrchestrationRuntime` receives an optional resolver, runner, authorizer, and explicit bounds. `register` accepts:

- one `workflowId` and `revision`;
- one exact manager agent and revision;
- one to thirty-one specialists with exact revisions and responsibilities;
- one or more directed branches with `sourceAgentId`, `targetAgentId`, and mode;
- explicit `conversationOwnerAgentId` and `finalAnswerAgentId` on every branch.

Every specialist must be reachable from the manager through registered branches. Duplicate agents, duplicate branches, unknown agents, orphan specialists, self-routes, unsupported fields, and same-revision drift fail before registration. An exact repeated registration is idempotent.

## Branch Modes

| Mode | Specialist role | Public output owner | Conversation after the turn | Guard |
|---|---|---|---|---|
| `delegate` | Behind the source manager | Source agent | Source agent | Both ownership fields must name the source. The specialist result stays internal and the source manager must synthesize the user-facing output. |
| `handoff` | User-facing owner | Target agent | Target agent | Both ownership fields must name the target. Only the target runs for this branch and its output becomes public. |

A delegate branch cannot route to the root manager as a behind-manager specialist. Returning ownership to a manager is instead an explicit handoff whose source is the current specialist and whose target is the manager.

## Turn Flow

| Stage | Input | Output | Guard |
|---|---|---|---|
| Validate | Run, conversation, exact workflow revision, branch, and bounded JSON input | Immutable request or typed block | Reused run, active conversation, missing revision, missing branch, wrong source owner, or capacity fails closed. |
| Authorize | Exact action, workflow, branch, identities, and input | Approval identity | Application denial occurs before agent resolution or execution. |
| Resolve | Registered source and target references | Exact revision evidence | Both references must match the workflow. |
| Delegate | Target task, responsibility, and return owner; then source synthesis input | Source-owned final output | Intermediate specialist output is supplied only to the source manager and is not returned separately. |
| Handoff | Target task, source identity, and responsibility | Target-owned final output | Conversation ownership changes only after successful target completion. |
| Finalize | Agent outcomes and cost logs | Owner identities, final output, approval, compact evidence, and aggregate cost | Failed or partial work never commits new ownership. |

## Conversation Continuation

A new conversation begins with the registered manager as owner. Every later branch must use the current owner as `sourceAgentId`. A successful delegate leaves ownership unchanged; a successful handoff changes it to the target. Changing workflow id or revision within the same conversation is blocked.

This creates an auditable sequence without a hidden router:

1. Manager delegates research; manager still answers.
2. Manager hands the conversation to a specialist; specialist now answers.
3. Specialist delegates another specialist; first specialist still answers.
4. Specialist hands back to manager; manager owns later turns.

The controller retains only bounded in-memory owner state. `clearConversation` is the explicit abandon boundary and refuses to clear an active run. Durable transcript, provider session, and prior-response state stay with their existing owners.

## Bounds And Evidence

Defaults allow 64 workflow revisions, 32 participants per workflow, 128 branches, 512 conversations, 200,000 serialized characters for input or output, and 60 seconds per authorization, resolution, or agent stage. Active run and conversation identities serialize execution; recent run identities form a bounded replay fence.

Completed results expose the exact branch, conversation owner, final-answer owner, approval, public output, aggregate cost, and compact facts about agent calls, delegation, transfer, and intermediate-output suppression. Resolver, runner, authorization, timeout, validation, and provider error details are normalized into typed bounded blocks. Attempted calls with incomplete cost evidence report partial or unreported cost rather than fabricated zero cost.

Readiness exposes only configuration, modes, ownership authorities, limits, and counters. The default Worker injects no resolver, runner, or authorizer, so `configured` is false and `providerExecutionStatus` remains `unverified`. Offline tests establish controller behavior only.

`LIVE-AGENT-PROVIDER-PROOF.md` is the separate approved evidence lane. It runs one manager-owned delegation followed by one specialist-owned handoff through the composition owner, caps the concrete adapter at three provider attempts, and leaves the default Worker unconfigured.

## VCCs

- Given a delegate branch, when the target completes, then the source manager receives the private result, produces the only public output, and remains both conversation and final-answer owner.
- Given a handoff branch, when the target completes, then the target output is public and the target becomes both conversation and final-answer owner.
- Given a transferred conversation, when a branch starts from any other agent, then it blocks before authorization or execution.
- Given a specialist-owned conversation, when a registered handoff targets the manager, then ownership returns to the manager only after successful completion.
- Given denial, stale workflow revision, unknown branch, mismatched agent revision, replay, concurrency, malformed outcome, capacity, abort, or timeout, when the controller evaluates the turn, then it fails closed with bounded evidence.
- Given an unconfigured Worker, when readiness is read, then the contract and explicit ownership policy remain visible while live provider execution stays unverified.
- Given the bounded live proof, when all three provider calls complete, then delegation remains manager-owned, handoff becomes specialist-owned, and only hashed continuation plus returned usage crosses the proof boundary.

VCC: run `npm run agent-orchestration:check` plus the affected app and Worker tests; require zero failures, explicit ownership on every branch, no delegate intermediate in public output, honest costs, no copied artifacts, no paid call, no Prod mirror mutation, and no Cloudflare action.
