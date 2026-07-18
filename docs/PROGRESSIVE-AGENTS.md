---
title: "Progressive Agents Runtime Contract"
graphId: "md:progressive-agents-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "progressive-agents-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral facade for incremental Agentic Canvas OS agent workflows"
runtime_scope: "single-agent execution, tool-bearing agent execution, and explicit specialist workflow delegation"
runtime_claim: "the local facade is runtime-ready in Dev with offline single-agent, Function Calling, and specialist orchestration proof; default Worker execution remains unconfigured"
runtime_owner: "../agent-api/src/progressive-agents.js"
runtime_proof: "../__tests__/progressive-agents.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/agents/quickstart"
external_source_policy: "concept reference only; forbid copied code, APIs, examples, prompts, schemas, fixtures, tests, dependencies, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Progressive Agents Runtime

The Progressive Agents facade gives applications one small entry surface over
the existing Agent Definitions, Agent Runtime Composition, Function Calling,
and Agent Orchestration owners. Start with one exact source-backed agent and one
bounded run. Add tool references only when the task needs application-owned
functionality. Register a specialist workflow only when explicit delegation or
conversation transfer is required.

The cited quickstart informs only that incremental growth sequence. Local method
names, request and result shapes, owner boundaries, validation, tests, and prose
are independently authored. The repository does not import or emulate an
external Agents SDK.

## Ownership Boundary

| Surface | Local owner | Facade responsibility |
|---|---|---|
| Definition | Agent Definitions | Forward registration without weakening source, revision, capability, handoff, or output validation. |
| Single run | Agent Runtime Composition | Normalize one bounded public request and require the exact agent revision to own the final answer. |
| Tool use | Function Calling through the application step adapter | Preserve prepared tool references and model feature selection; never execute or authorize a tool inside the facade. |
| Specialists | Agent Orchestration | Forward exact workflow registration and branch execution; preserve explicit manager or specialist answer ownership. |
| Provider | Models and Providers plus the injected adapter | Keep credentials, transport, protocol translation, usage, and cost outside the facade. |

## Progressive Flow

| Stage | Input | Output | Stop condition |
|---|---|---|---|
| Register one agent | Complete source-backed Agent Definition | Exact id, revision, and registration status | Missing registry, invalid source digest, unknown field, conflict, or capacity fails. |
| Run one agent | Run id, conversation id, exact agent revision, bounded JSON input | Validated output with the same agent as final-answer owner | Missing composition, source or model drift, adapter failure, or invalid output returns a bounded block. |
| Add tools | New exact definition revision with authorized tool references | Prepared references delivered to the application adapter | Missing authorization, unsupported model feature, schema, gateway, approval, or cost evidence blocks in its existing owner. |
| Add specialists | Exact workflow revision and explicit branch ownership | Manager-owned delegation or specialist-owned handoff result | Missing authorizer, unresolved agent, stale revision, branch mismatch, or conversation-owner mismatch blocks. |

## Runtime Contract

`registerAgent` delegates to the Agent Definition Registry. `executeAgent`
accepts only `runId`, `conversationId`, `agentId`, `revision`, `input`, and an
optional abort signal. It maps the request to one user-facing owner run through
Agent Runtime Composition and returns that exact agent revision as the final
answer owner only after completed output validation.

Tool references remain intrinsic definition metadata. The preparation owner
authorizes them, Models and Providers requires tool capability, and the injected
application adapter may route them through Function Calling. The facade never
accepts executable callbacks, schemas, credentials, MCP endpoints, tool results,
or provider objects in a run request.

`registerWorkflow` and `executeWorkflow` delegate to Agent Orchestration. They
do not infer a router from tool metadata or handoff references. Every specialist
branch still declares its source, target, mode, conversation owner, and final
answer owner in the canonical workflow registry.

## Readiness And Evidence

Readiness exposes the three growth stages, owner availability, counters, and the
input bound. It never returns definitions, instructions, source contents, tool
schemas, adapter payloads, provider errors, outputs, or credentials.

`contractReady: true` means the facade and offline owner composition are
executable. `configured: true` requires the underlying composition to have a
source verifier, model selection, and execution adapter. Tool availability also
requires the definition capability authorizer. Specialist availability requires
configured Agent Orchestration. The default Worker keeps all execution states
false and provider execution `unverified`.

## Acceptance Contract

- One source-backed agent completes one bounded direct run and remains the exact final-answer owner.
- A tool-bearing agent passes its authorized reference into an adapter that uses the existing Function Calling controller and application gateway.
- A registered specialist workflow delegates behind the manager without exposing intermediate output; handoff behavior remains owned by Agent Orchestration.
- Missing owners, extra run fields, stale definitions, model mismatch, tool denial, invalid output, and workflow ownership conflicts fail closed.
- Readiness is sanitized, no external SDK dependency is added, and no offline fixture is promoted to provider proof.

VCC: run `npm run progressive-agents:check`, the affected composition,
Function Calling, orchestration, app, and Worker tests, plus
`npm run docs:check`; require zero failures, exact source and revision evidence,
one real local Function Calling gateway invocation, explicit final-answer
ownership, no copied artifact, no paid call, no Prod mirror mutation, and no
Cloudflare action.
