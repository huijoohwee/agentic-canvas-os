---
title: "Agent Runtime Composition Contract"
graphId: "md:agent-runtime-composition"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agent-runtime-composition-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral composition of source-backed definitions, model selection, Running Agents, and orchestration"
runtime_scope: "definition preparation, provider selection, agent-step lifecycle, output validation, and orchestration adapters"
runtime_claim: "offline composition is runtime-ready in Dev; the default Worker has no definitions, source verifier, execution adapter, or authorizer, and live provider behavior remains unverified"
runtime_owner: "../agent-api/src/agent-runtime-composition.js"
runtime_proof: "../__tests__/agent-runtime-composition.test.mjs"
external_pattern_source: "https://openai.github.io/openai-agents-js/guides/multi-agent/"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Agent Runtime Composition

Agent Runtime Composition connects existing owners without replacing them. It prepares one exact source-backed Agent Definition, resolves its registered model and transport, drives the injected step adapter through Running Agents, revalidates final output against the same definition revision, and exposes the exact resolver and runner shape consumed by Agent Orchestration.

The cited multi-agent guidance informs only the distinction between manager-owned delegation and target-owned handoff. Local module boundaries, packets, continuation state, failure behavior, tests, and prose are independently authored. No external SDK implementation or artifact is imported.

## Ownership Boundary

| Owner | Responsibility | Composition rule |
|---|---|---|
| Agent Definitions | Definition identity, source URI and digest, ordered instructions, capability references, and final-output contract | Source verification and exact revision preparation run before every resolution or execution. |
| Models and Providers | Provider revision, model, feature eligibility, and transport selection | Composition passes the prepared agent model plus derived feature requirements; it never calls a provider directly. |
| Running Agents | Turn serialization, continuation, step bounds, settlement, events, pause state, and cost aggregation | Composition owns one internal Running Agents controller and never duplicates its loop. |
| Execution adapter | Provider translation and actual model, tool, or handoff work | The application injects this adapter; default construction remains unconfigured. |
| Agent Orchestration | Workflow topology, branch authorization, conversation owner, and final-answer owner | Composition supplies only `resolveAgent` and `runAgent`; orchestration keeps public ownership policy. |

## Source-Backed Flow

| Stage | Required evidence | Stop condition |
|---|---|---|
| Prepare | Exact agent id and revision plus application-confirmed source URI and SHA-256 digest | Missing verifier, changed source, stale revision, denied capability, or missing handoff target blocks. |
| Select | Registered provider revision, exact model, compatible features, and transport | Missing route, feature, delivery, or connection blocks before execution. |
| Run | Prepared packet, model-selection packet, orchestration role, branch, input, and one continuation strategy | Missing adapter, concurrent conversation, malformed step result, timeout, or lifecycle block stops the stage. |
| Validate | Final output checked against the same agent id, revision, and output contract | Invalid text or structured output is rejected and its continuation is discarded. |
| Return | Final output and only fully reported aggregate cost | Partial or absent usage stays unreported; intermediate specialist output remains with orchestration. |

Source evidence is revalidated on each prepare instead of cached as permanent truth. This avoids executing a definition whose bound file changed after registration. Only the URI, digest, and bounded verification id enter preparation evidence; source contents never enter readiness counters.

## Continuation And Isolation

The adapter defaults to previous-response continuation. Each external conversation and agent pair receives one bounded internal Running Agents conversation so manager and specialist state cannot collide. A completed response advances only that pair's continuation. A blocked lifecycle or invalid final output clears the internal conversation before a retry.

Other Running Agents strategies remain selectable at construction. A strategy is fixed for the composition instance and therefore cannot drift inside an active conversation. Active records cannot be evicted or cleared; idle records use bounded insertion order when capacity is reached.

## Orchestration Semantics

Delegation runs the specialist behind the manager, then supplies its bounded output to a separate manager synthesis stage. Only manager output becomes public. Handoff runs the target as the user-facing owner and transfers both conversation and final-answer ownership through the existing orchestration contract.

Composition does not infer either mode from agent metadata. The registered branch remains the single owner of route meaning, authorization, and public-answer identity.

## Readiness And Evidence

Readiness reports owner names, adapter presence, continuation strategy, bounded counters, and nested Running Agents statistics. It never reports instructions, source content, provider credentials, adapter error bodies, or output payloads.

`contractReady: true` means the local composition shape and offline behavior are executable. `configured: true` additionally requires Agent Definitions, Models and Providers, and an injected execution adapter. Provider execution remains `unverified` until a separately approved bounded live run returns actual provider evidence.

## Acceptance Contract

- A verified source-backed specialist reaches the exact registered provider, model, and transport through one Running Agents lifecycle and one final-output validation.
- Delegation returns only manager synthesis; handoff returns the target specialist's answer and ownership.
- Previous-response identity advances across compatible turns and resets after invalid output.
- Changed source evidence, stale definition revision, missing model feature, malformed output, duplicate execution, or missing adapter blocks before a public answer.
- Fully reported usage may flow to orchestration; absent or partial usage never becomes fabricated reported cost.
- Default app and Worker readiness expose the connected resolver and runner while configuration and provider execution remain false or `unverified`.

VCC: run `npm run agent-runtime-composition:check`, the definition, provider, Running Agents, orchestration, app, and Worker tests, plus `npm run docs:check`; require zero failures, exact source and revision evidence, deterministic owner transitions, no copied artifacts, no paid call, no Prod mirror mutation, and no Cloudflare action.
