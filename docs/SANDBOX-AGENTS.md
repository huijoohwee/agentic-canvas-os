---
title: "Sandbox Agents Runtime Contract"
graphId: "md:sandbox-agents-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "sandbox-agents-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral container workspace control plane for Agentic Canvas OS"
runtime_scope: "workspace creation, authorized file and process work, package installation, preview ports, snapshots, pause, resume, and cleanup"
runtime_claim: "the local controller is runtime-ready in Dev; the default Worker has no container adapter, authorizer, or external state store, and independent containment remains unverified"
runtime_owner: "../agent-api/src/sandbox-agents.js"
contract_owner: "../agent-api/src/sandbox-agent-contract.js"
runtime_proof: "../__tests__/sandbox-agents.test.mjs"
external_pattern_sources: ["https://developers.openai.com/api/docs/guides/agents/models", "https://developers.openai.com/api/docs/guides/agents/sandboxes"]
external_source_policy: "concept reference only; forbid copied code, APIs, examples, prompts, schemas, fixtures, tests, provider defaults, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Sandbox Agents Runtime

The runtime gives an application-owned agent controller a bounded way to use a container workspace. Agentic Canvas OS owns lifecycle, capability, approval, identity, redaction, limits, cost, and public evidence. An injected provider owns the actual container, filesystem, processes, package tooling, port forwarding, snapshots, and provider session state.

The cited OpenAI guides inform only the capability class and the value of separating orchestration from compute. This repository uses independently authored names, data shapes, limits, tests, and prose. It imports no provider SDK, sandbox client, sample, manifest, schema, prompt, model default, fixture, or runtime dependency.

## Ownership Boundary

| Owner | Responsibility | Boundary |
|---|---|---|
| Sandbox Agents controller | Validate one workspace source, requested capabilities, operation inputs, application approval, lifecycle identity, public output, limits, and cost evidence. | It never starts a host process, interprets shell strings, stores credentials, exposes provider state, or claims kernel containment. |
| Injected container provider | Create, operate, snapshot, suspend, resume, and close the actual isolated workspace. | Its declaration and per-operation attestation are evidence claims, not independent containment verification. |
| Application authorizer | Approve each workspace and operation using current policy, actor, agent, run, path, command, package, and port context. | Agent instructions and provider metadata cannot grant approval. |
| External state store | Persist opaque snapshot references and serialized resume state across controller lifetimes. | The default Worker does not install an implicit in-memory durability substitute. |
| Native sandbox policy preflight | Continue to validate and authorize Knowgrph filesystem, process, network, and credential policy before execution. | `SANDBOX-RUNTIME.md` remains policy preflight only; this controller does not turn it into kernel enforcement. |

## Container Provider Contract

One adapter revision declares the exact subset of `files`, `commands`, `packages`, `ports`, `snapshots`, and `resume` that it can provide. The runtime accepts only an adapter that declares a `container` execution boundary and implements create, execute, snapshot, suspend, resume, and close operations.

Every successful provider result must freshly attest:

- the registered provider id and exact revision;
- a container execution boundary;
- the capabilities used by that operation; and
- a reported, unreported, or not-run cost state.

Missing, stale, mismatched, incomplete, or non-container attestation blocks the result. `provider-attested` never means independently verified. A deployment may promote containment only after separate provider and host evidence proves the boundary.

## Workspace Sources

A sandbox starts from exactly one source:

| Source | Input | Rule |
|---|---|---|
| Fresh workspace | Revision, bounded directories, bounded text files, and named host environment bindings. | Paths are normalized workspace-relative paths. Environment values never enter the workspace contract or public results. |
| Saved snapshot | One opaque application token resolved through the external state store. | Agent identity and provider revision must match; a fresh workspace cannot be mixed into the same open request. |

The provider snapshot id stays inside the state store and provider call. Callers receive only a controller-issued snapshot token plus bounded, secret-scanned metadata.

## Operations

| Capability | Operation | Guard |
|---|---|---|
| Files | Read or write one normalized relative path. | Absolute paths, traversal, duplicate workspace entries, oversized content, and sensitive provider output fail closed. |
| Commands | Run one argument vector with an optional relative working directory. | Shell command strings are not accepted; arguments and execution time are bounded. |
| Packages | Install a bounded, explicit package list with a named manager. | Package names are validated and every install requires application authorization. |
| Ports | Open one container port for private or preview access. | Public audience is unsupported; the provider remains responsible for scoped forwarding and cleanup. |

Only one operation may be active per sandbox. Competing operations return `sandbox_busy`; they are not queued or replayed. Each successful operation increments a bounded sequence and may update opaque provider state without returning that state to the caller.

## State And Resume

Keep three state surfaces distinct:

| Surface | Purpose | Persistence |
|---|---|---|
| Active session | Current provider session id and bounded opaque state for one live sandbox. | Controller-local and never public. |
| Resume checkpoint | Serialized provider state bound to sandbox, run, agent, workspace revision, capabilities, and provider revision. | External state store; consumed once by exact-identity resume. |
| Workspace snapshot | Provider-owned saved files and artifacts that can seed a new sandbox run. | External state store holds only the opaque provider reference and binding metadata. |

Pause first serializes resume state, persists it, and closes the live provider session. Resume can occur in a new controller instance using the same external store and provider revision. A wrong run, agent, provider, or revision blocks without consuming the checkpoint.

Snapshots seed new work. Resume continues the same sandbox identity. Neither surface replaces Running Agents conversation state, prompt history, model continuation, or application checkpoints.

## Security And Secrets

- Workspace environment entries name host bindings; they never contain values.
- The application authorizer is mandatory for open, file, command, package, port, snapshot, pause, and resume actions.
- Public provider output is JSON-only, bounded, and rejected when a field name indicates credentials, authorization, secrets, tokens, passwords, API keys, or opaque state.
- Unexpected provider exceptions become a generic typed failure; raw provider messages are not returned.
- Close is always available as lifecycle cleanup and does not require an additional approval grant.
- Prod mirror, Cloudflare deployment, public ports, and paid execution remain outside this contract unless separately authorized.

## Default Bounds

| Bound | Default |
|---|---:|
| Active sandboxes | 32 |
| Operations per sandbox | 256 |
| Workspace entries per category | 256 |
| Workspace contract | 500,000 characters |
| One file | 200,000 characters |
| Command arguments | 64 |
| One argument | 4,096 characters |
| Packages per install | 64 |
| Public provider output | 200,000 characters |
| Opaque or serialized state | 500,000 characters |
| Provider operation time | 30,000 milliseconds |

Limits are explicit positive integers. Capacity is fail-closed; no sandbox, operation, snapshot, or checkpoint is silently evicted.

## Readiness Contract

`GET /api/ready` exposes sanitized controller policy, configured dependencies, provider identity and capabilities when registered, counters, limits, and two separate proof states:

- `containerExecutionStatus` is `unverified` until an injected provider returns accepted fresh attestation, then `provider-attested`;
- `independentContainmentProof` remains `unverified` until an external runtime proof validates real containment.

The default Worker constructs an isolate-scoped unconfigured controller. Therefore `contractReady` is true while `configured` is false, no provider is implied, and no container runs during readiness inspection.

## Acceptance Contract

- Given a complete provider, authorizer, and state store, a fresh workspace can perform bounded file, command, package, and preview-port operations through one serialized controller.
- Given a snapshot, a new sandbox receives only the provider snapshot reference after exact agent and provider-revision checks.
- Given a pause, a second controller instance can resume the same sandbox through one exact external checkpoint without exposing serialized state.
- Given missing capability, approval, dependency, identity, revision, attestation, containment claim, safe path, safe port audience, bound, or public-output safety, the operation blocks before a success claim.
- Given an offline fake adapter, tests prove orchestration and evidence enforcement only; they do not prove a real container, network boundary, filesystem isolation, package manager, preview service, snapshot backend, or resumable provider.

VCC: run `npm run sandbox-agents:check` plus the affected app and Worker tests; require zero failures, exact provider fencing, application approval, safe workspace operations, serialized execution, opaque snapshots and resume state, sanitized readiness, no copied artifacts, no paid call, no Prod mirror mutation, and no Cloudflare action.
