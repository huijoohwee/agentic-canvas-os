---
title: "Models And Providers Runtime Contract"
graphId: "md:models-and-providers-runtime"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "models-and-providers-runtime-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
authority: "provider-neutral model and transport selection for Agentic Canvas OS"
runtime_scope: "provider registration, model defaults, feature matching, transport strategy, and sanitized environment readiness"
runtime_claim: "local model and transport resolution is runtime-ready in Dev; adapter execution and live provider behavior remain unverified"
runtime_owner: "../agent-api/src/model-providers.js"
runtime_proof: "../__tests__/model-providers.test.mjs"
external_pattern_source: "https://developers.openai.com/api/docs/guides/agents/models"
external_source_policy: "concept reference only; forbid copied code, examples, prompts, schemas, fixtures, tests, or prose"
publish_policy: "Dev-only until explicit operator approval"
---

# Models And Providers Runtime

The Models and Providers runtime resolves which application-registered model and transport a prepared agent may use. It does not call a provider. It returns one immutable, revision-bound packet for the existing Running Agents adapter or a typed blocked result.

The cited OpenAI guide informs only the capability category. Local names, data shapes, precedence, bounds, tests, examples, and prose are independently authored. No provider SDK implementation, model catalog, code sample, schema, fixture, test, or documentation text is imported or reproduced.

## Ownership Boundary

| Owner | Responsibility | Forbidden claim |
|---|---|---|
| Model Provider Registry | Validate and revision-fence provider model and transport metadata; resolve explicit requirements. | Registration does not prove endpoint availability, credentials, model behavior, or provider execution. |
| Environment Adapter | Convert one complete server-side `AGENT_MODEL_*` route into a provider definition and process default. | Environment aliases, baked-in providers, implicit models, and secret values are forbidden. |
| Agent Definition Registry | Select `providerId` and `modelId` for one specialist revision. | Agent metadata cannot choose credentials, endpoints, adapter internals, or transport protocol. |
| Running Agents adapter | Execute the prepared agent with the resolved adapter, model, and transport. | Selection readiness does not prove a completed model turn, stream, usage record, or cost. |
| Application operator | Register provider revisions, select real model ids, bind secrets, and approve live proof. | External documentation cannot choose this deployment's provider or authorize spend. |

## Provider Definition

Each provider revision declares only the metadata required for deterministic selection.

| Field | Meaning | Rule |
|---|---|---|
| `id` and `revision` | Application provider identity and exact configuration revision. | Same-revision content changes conflict; a new revision replaces the active entry. |
| `adapterId` | Application-owned execution adapter identity. | The registry never imports, constructs, or calls the adapter. |
| `models` | Bounded model ids with declared feature ids. | An unknown model or missing required feature blocks before execution. |
| `transports` | Bounded transport ids with delivery and connection characteristics. | An unknown or incompatible transport blocks before execution. |
| `defaultModelId` | Optional provider-local model fallback. | It applies only when the winning selection omits a model id. |
| `defaultTransportId` | Provider-local transport fallback. | It applies only when no matching explicit transport was selected. |

Provider definitions contain no endpoint, credential, price, prompt, response object, or executable callback. Endpoint and secret binding metadata remain in the server environment adapter; actual pricing and returned usage remain adapter evidence.

## Selection Precedence

Model selection is deterministic and stops at the first configured level:

1. The prepared Agent Definition model selection.
2. The current run default supplied by the application.
3. The process default configured at startup.
4. The selected provider's model default, but only when the winning selection omitted `modelId`.

An explicit agent selection should be used for production specialists so a process-wide change cannot silently move their model identity. Run defaults are suitable for bounded experiments or application routing. Process defaults are startup policy, not an excuse to hide provider selection. There is no repository-baked provider or model default.

Transport selection is resolved independently. The first agent, run, or process selection that names a transport for the chosen provider wins; otherwise the provider transport default applies. A transport attached to another provider is ignored rather than crossing provider ownership.

## Feature And Transport Matching

A run may require model features plus transport behavior. The registry compares exact identifiers and fails closed.

| Requirement | Supported values | Decision |
|---|---|---|
| Model features | Application-defined identifiers | Every requested feature must exist on the selected model. |
| Delivery | `complete` or `incremental` | The selected transport must match the requested response delivery. |
| Connection | `per-run` or `reusable` | The selected transport must match the requested connection lifecycle. |

`complete` describes one settled response delivery. `incremental` describes ordered partial delivery owned by the Running Agents streaming loop. `per-run` creates no cross-run connection expectation. `reusable` permits an adapter-managed reusable connection but does not prove that one exists or stayed healthy.

Transport strategy is selected from run requirements, not provider popularity. A non-streaming bounded task can request complete delivery. A user-visible stream can require incremental delivery. Reusable connections are appropriate only when the registered adapter owns lifecycle, isolation, recovery, and cleanup.

## Environment Adapter

The default Worker accepts one strict server-side route:

| Variable | Purpose |
|---|---|
| `AGENT_MODEL_PROVIDER` | Provider id. |
| `AGENT_MODEL_PROVIDER_REVISION` | Exact provider configuration revision. |
| `AGENT_MODEL_ADAPTER` | Registered adapter id. |
| `AGENT_MODEL_ENDPOINT` | HTTPS endpoint, or loopback HTTP for local development. |
| `AGENT_MODEL_ID` | Explicit process-default model id. |
| `AGENT_MODEL_API_KEY_ENV` | Name of the secret binding; never the secret value. |
| `AGENT_MODEL_TRANSPORT` | Explicit process-default transport id. |
| `AGENT_MODEL_TRANSPORT_DELIVERY` | `complete` or `incremental`. |
| `AGENT_MODEL_TRANSPORT_CONNECTION` | `per-run` or `reusable`. |
| `AGENT_MODEL_FEATURES` | Comma-separated feature ids for the configured model. |

Every field is required for environment configuration. Missing fields, unsafe endpoints, unsupported transport metadata, or absent secret bindings keep overall readiness false. Legacy provider-specific aliases are ignored. The sanitized response exposes only the secret binding name and presence.

Applications that need multiple providers register them directly through the registry and inject their own adapter map. The single-route environment adapter is a deployment bootstrap, not a multi-provider catalog.

## Resolution Packet

A ready result contains:

- the provider id, exact revision, and adapter id;
- the selected model id, declared features, and selection source;
- the selected transport id, delivery, connection, and selection source;
- the winning provider selection source and required feature ids;
- `running-agents-adapter` as execution owner; and
- `unverified` as provider execution status.

The packet excludes endpoints, credentials, environment values, prompts, request bodies, response bodies, usage, and cost. A blocked result contains a stage, typed reason code, and bounded local message.

## Revision And Capacity Rules

The registry keeps one active revision per provider id. Identical same-revision registration is idempotent. Different same-revision content conflicts. A changed revision replaces the active definition. Removing a provider also clears a process default that points to it.

| Bound | Default |
|---|---:|
| Active providers | 32 |
| Models per provider | 64 |
| Transports per provider | 16 |
| Serialized provider definition | 200,000 characters |

All bounds are explicit positive integers at construction. Registries are isolate-scoped and never evict silently.

## Readiness Contract

`GET /api/ready` exposes a `modelProviders` object with contract readiness, selection and transport policy, sanitized environment state, registry counters, limits, and an honest provider execution status. Overall configuration requires auth, MCP control plane, a complete provider route, its secret binding, one registered provider, and a process default.

Local readiness proves configuration and selection only. It does not establish provider reachability, supported SDK features, response quality, streaming behavior, token usage, price, or cost. Those claims require one approved bounded adapter run with returned evidence.

## Acceptance Contract

- Given a registered provider and process default, resolution returns the exact revision, model, transport, and source without executing an adapter.
- Given agent, run, and process selections, the agent model wins while transport resolves independently for the selected provider.
- Given required features, delivery, or connection behavior, any mismatch blocks before execution.
- Given an unknown provider, model, transport, missing default, stale revision, conflict, unknown field, or capacity breach, the runtime fails closed.
- Given environment configuration, every neutral field is explicit, unsafe endpoints fail, provider-specific aliases do not configure the runtime, and secret values never enter returned metadata.
- Given Agent Definition preparation, its `providerId` and `modelId` can be passed directly into resolution without duplicating protocol or transport ownership.

VCC: run `npm run model-providers:check` plus the affected Agent Definitions, app, and Worker tests; require zero failures, exact precedence, revision fencing, feature and transport matching, sanitized readiness, no copied artifacts, no paid provider call, no Prod mirror mutation, and no Cloudflare action.
