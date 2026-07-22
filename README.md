# agentic-canvas-os

Cloudflare Worker product tier demonstrating `knowgrph` MCP Readiness & Command Grammar Integration. 
One Worker serves the static UI, authenticates callers, forwards `/api/invoke` and `/api/run` 
to the knowgrph MCP control plane, exposes runtime readiness, and embeds the live knowgrph canvas.

This repo holds no model provider keys in source or client bundles. Runtime
secrets are Cloudflare secret bindings; the browser only sees public URLs.

## Start Here

If you are working in this repo as a human contributor, use this file as the
entrypoint and treat [`docs/`](./docs) as the agent control surface.

Before executing any task, humans and AI tools should read:

1. [`docs/PROJECT-RULES.md`](./docs/PROJECT-RULES.md) for project-wide engineering and session-end rules.
2. [`docs/START-WORKFLOW.md`](./docs/START-WORKFLOW.md) for session start, registered task worktrees, and ownership rules.
3. [`docs/VALIDATION-RUNBOOK.md`](./docs/VALIDATION-RUNBOOK.md) for focused checks and release gates.

Quick local path:

```bash
npm install
npm run doctor
npm run check
npm run dev
```

Run the complete collaboration and runtime-identity proof from this repository with one command:

```bash
npm run collaboration:gate
```

The command delegates to the canonical Knowgrph runtime owner, starts isolated owner and guest browser contexts plus the local storage worker, verifies the shared room and runtime-identity digest, and cleans up automatically. It does not require physical devices or manual JSON exports.

Safe pause or blocked exit:

```bash
npm run device:park
```

This preserves local task-branch work, proves the ownership pull request remains
draft, pins dirty work to an immutable per-lease stash ref and commit, detaches
that task worktree at fetched `origin/main`, and marks the task as paused or
blocked. Exact same-session resume restores and verifies that object; moving
`stash@{n}` selectors are never lifecycle identity. A parked branch is never
completed work.

Managed autonomous runs hand work to the team without merging it:

```bash
npm run device:review -- --json
```

This validates and pushes the fenced task branch, preserves pull-request context, and marks it ready for review without an automerge label or merge call. The ACOS lease reports `review_ready`; the Knowgrph run ledger projects `delivery_ready`. Use exact-branch `device:resume` for requested changes; it restores and proves draft ownership before a new writer claim. `device:publish` remains the separate explicit protected-delivery action.

Mandatory completion gate:

```bash
npm run device:complete -- --json
```

This fails while work is dirty, stashed, branch-only, or attached to an open
pull request. After the protected Dev pull request is merged, it verifies the
merge commit is contained by `origin/main`, detaches the clean task worktree at
that exact revision, and emits the pull request, merge, and main SHAs. Completion
first records a durable `completing` cleanup intent, retires only the exact
restored stash/ref, and records `completed` only after clean detachment; retries
finish any interrupted phase and accept a later descendant `origin/main`. Fast-forward
the registered main worktree separately with `npm run sync:live` before runtime
acceptance. `device:end` uses the same fail-closed completion gate; use
`device:park` for paused or blocked work.

First success check:

```bash
curl http://127.0.0.1:8787/api/ready
```

Before changing workflow or control-surface docs, read:

1. [`docs/PROJECT-RULES.md`](./docs/PROJECT-RULES.md)
2. [`docs/START-WORKFLOW.md`](./docs/START-WORKFLOW.md)
3. [`docs/VALIDATION-RUNBOOK.md`](./docs/VALIDATION-RUNBOOK.md)
4. [`docs/RUNTIME-READINESS.md`](./docs/RUNTIME-READINESS.md)

## Topology

```text
agentic-canvas-os Cloudflare Worker
  /                  -> Workers Static Assets from web/dist
  /api/auth/session  -> stateless Auth_Token
  /api/invoke        -> MCP forward to knowgrph.agentic_canvas_os.docs.invoke
  /api/run           -> MCP forward to knowgrph.video_remix.run
  /api/ready         -> sanitized runtime readiness

knowgrph control plane
  airvio.co/knowgrph/control-plane/mcp
  airvio.co/knowgrph/doc-view?run=<runId>

application-registered model provider
  provider adapter + selected transport
```

The connector contracts are authored and proven in the knowgrph monorepo. This
repo is the split product tier and keeps only the runtime seams it needs:
Cloudflare request adaptation, MCP forwarding, model-provider selection, and the
run-scoped canvas embed URL.

## Layout

| Path | Purpose |
|---|---|
| `wrangler.jsonc` | Cloudflare Worker source of truth: script, static assets, vars, required secrets. |
| `worker/index.js` | Cloudflare Worker entrypoint for API routes and static asset delegation. |
| `src/config.js` | Public config: Agent-API base and canvas base only. |
| `src/agent-api-endpoints.js` | Same-origin browser request helper for Cloudflare API routes. |
| `src/knowgrph-mcp-client.js` | Keyless MCP Streamable HTTP client. |
| `src/canvas-embed.js` | Run-scoped knowgrph canvas doc-view URL + embed descriptor. |
| `agent-api/src/app.js` | Platform-neutral Agent-API core: auth, MCP forward, readiness. |
| `agent-api/src/auth.js` | Stateless HS256 session token; server-side secret only. |
| `agent-api/src/cache-context.js` | Bounded stable-prefix registry, revision invalidation, prompt assembly, and provider cache telemetry normalization. |
| `agent-api/src/reasoning-continuity.js` | Bounded cross-turn invariant registry, compatible request planning, active-turn serialization, and provider-effective context confirmation. |
| `agent-api/src/function-calling.js` | Strict direct function-call controller, exact call-id continuation, application-gateway dispatch, and bounded final evidence. |
| `agent-api/src/function-calling-manager.js` | Durable reviewed-call checkpoint, opaque resume token, atomic cross-isolate claim, and terminal settlement owner. |
| `agent-api/src/openai-responses-function-adapter.js` | Responses translation, strict function selection, same-response continuation, and usage-derived cost evidence. |
| `agent-api/src/knowgrph-function-gateway.js` | Explicit allowlist, tool guardrails, signed-review pause, and policy-preserving Knowgrph MCP mapping. |
| `agent-api/src/knowgrph-function-tools.js` | Strict status and immutable review-required run-note function records, validators, guardrails, and native output projections. |
| `agent-api/src/function-calling-handler.js` | Authenticated bounded start and review-resume HTTP boundaries for direct function calls. |
| `agent-api/src/programmatic-tool-calling.js` | Bounded hosted-program controller, caller-lineage enforcement, direct-call safety boundary, and compact final evidence. |
| `agent-api/src/tool-search.js` | Session-scoped deferred-definition controller, metadata-only initial exposure, exact search loading, and call authorization. |
| `agent-api/src/handler.js` | Request validation and fail-closed MCP forwarding. |
| `agent-api/src/model-config.js` | Strict provider-neutral environment adapter; stores only the API key binding name and presence. |
| `agent-api/src/model-providers.js` | Revision-fenced provider registry with explicit model defaults, transport selection, and feature matching. |
| `agent-api/src/guardrails-human-review.js` | Ordered validation plus exact-scoped, authenticated, single-consume human review. |
| `agent-api/src/durable-object-state-store.js` | Durable Object adapters for atomic review consumption, paused-turn claims, Function Calling continuation claims, and reviewed execution receipts. |
| `agent-api/src/function-execution-receipts.js` | Pre-side-effect receipt owner for stable idempotency keys, atomic execution claims, native mutation evidence, and terminal replay. |
| `worker/agent-state.js` | Per-identity transactional Durable Object state owner. |
| `agent-api/src/agent-runtime-composition.js` | Source-verified definition preparation, model selection, Running Agents lifecycle, final-output validation, and orchestration adapters. |
| `agent-api/src/progressive-agents.js` | Incremental facade for one exact agent run, tool-bearing definitions, and explicit specialist workflows. |
| `agent-api/src/agent-orchestration.js` | Revision-fenced manager and specialist topology with explicit delegation, handoff, conversation, and final-answer ownership. |
| `agent-api/src/agent-swarm*.js` | Dynamic goal planning, durable atomic run ledger, horizontally claimable worker tasks, recovery, receipts, cancellation, and base-agent synthesis. |
| `docs/` | Agentic Canvas OS docs/control surface for `/`, `#`, and `@` invocation dictionaries. |
| `scripts/instruction-audit.mjs` | Model-free budgets, intent preservation, duplicate detection, and canonical-owner checks for durable guidance. |
| `scripts/instruction-task-quality.mjs` | Validates the task-quality scenario suite or scores provenance-bound candidate final answers. |
| `web/` | Static frontend source and offline build script. |
| `__tests__/` | Network-free deterministic tests. |

## Runtime Readiness

`GET /api/ready` returns a sanitized readiness payload. `configured: true`
requires:

- `AGENT_API_JWT_SECRET`
- `KNOWGRPH_MCP_ENDPOINT`
- one complete `AGENT_MODEL_*` provider, model, adapter, and transport definition
- the secret binding named by `AGENT_MODEL_API_KEY_ENV`

The `modelProviders` response reports selection policy, bounded registry counters,
sanitized environment metadata, and `apiKeyPresent`; it never includes the secret
value. Model resolution uses agent selection, then a run default, then the process
default. A provider default can fill only an omitted model or transport. Exact
feature, delivery, and connection requirements fail closed before adapter execution.
Provider execution remains `unverified` until the Running Agents adapter completes
a real bounded run and reports evidence.

It also reports the bounded cache-context policy and local registry counters.
`providerCacheStatus` remains `unverified` until the downstream model owner
returns cache-read or cache-write usage; a local stable-prefix reuse is not a
provider cache hit.

Readiness also exposes the reasoning-continuity policy and bounded counters.
Stable goals, assumptions, and priorities can produce an `all_turns` request
patch chained to the last completed response; drift resets requested reasoning
to `current_turn`. Provider-effective continuity remains `unverified` until the
downstream model response explicitly confirms the effective context.

Function-calling readiness exposes the separate direct-call controller. Strict
schemas, explicit selection modes, exact call-id outputs, reasoning-item replay,
and bounded parallel calls are contract-ready. A server-configured OpenAI
Responses adapter and explicit Knowgrph function allowlist wire
`POST /api/function-call` to the existing MCP owner; callers cannot submit
schemas, routing, credentials, or policy. A review pause returns an opaque token;
`POST /api/function-call/recover` can re-read that safe pause envelope after a
client restart without exposing the private provider checkpoint;
`POST /api/function-call/resume` atomically claims the private `AGENT_STATE`
checkpoint and accepts only a decision plus exact signed reviewer evidence.
Readiness reports only sanitized adapter, gateway, and manager state, and
`providerExecutionStatus` remains `unverified` until a bounded live run returns
actual usage and continuation evidence.

The accepted 2026-07-19 Dev proof satisfied that evidence gate for one exact
run: one recovered durable continuation completed two Responses requests, one
signed review, one applied native mutation, and persisted revision 1. See
[`docs/LIVE-REVIEWED-FUNCTION-PROOF.md`](./docs/LIVE-REVIEWED-FUNCTION-PROOF.md)
for the sanitized usage, receipt, version, and non-Prod evidence.

The reviewed Function Calling proof has an isolated Cloudflare Dev lane. Run
`npm run function-gateway:live-proof:check` and a Wrangler `--env dev --dry-run`
before deployment. `npm run function-gateway:deploy:dev` accepts only model and
pricing variables; credentials must be configured as Dev Worker secrets.
`npm run function-gateway:live-proof` then seeds one dry-run Knowgrph manifest,
pauses one forced run-note call for exact signed review, resumes the same
Responses chain, and emits sanitized usage plus application and native receipt
evidence. Neither Dev environment declares a production route.

Programmatic tool-calling readiness is also sanitized. The local controller is
contract-ready, but `configured` and `providerContextIsolation` remain false or
`unverified` until a downstream hosted-sandbox adapter and real tool gateway are
injected. Generated JavaScript is never executed locally; programmatic calls
are limited to validated read-only idempotent tools, while writes, approvals,
semantic judgment, citations, and native-artifact validation stay direct.

Running Agents readiness exposes a provider-neutral application-turn
controller. It sequences bounded model, tool, and handoff transitions, locks a
conversation to one of four continuation strategies, resumes pauses within the
same turn, and streams canonical events through the same loop used by ordinary
runs. The `AGENT_STATE` binding stores bounded paused turns per conversation;
atomic claims allow a fresh Worker isolate to resume once and commit, replace,
or release the state. The default Worker still has no agent-step adapter, so
`configured` is false and provider execution remains `unverified`.

Guardrails and Human Review adds one application control owner around that
lifecycle. Agent Runtime Composition runs source-referenced input checks before
adapter execution and output checks before public completion. Tool-input and
tool-output checks stay beside the real gateway. Sensitive actions produce a
bounded approval interruption and single-consume resume state; approve, reject,
and edit decisions require a purpose-scoped reviewer token before they resume
the same Running Agents turn, and edits must be validated again. The Worker
uses one Durable Object identity per review and per paused conversation. The
concrete Knowgrph gateway proves guarded status reads plus an intrinsically
reviewed run-note mutation with native receipt echo and one-revision recovery
offline; live provider and deployed Worker behavior remain unverified. See
[`docs/GUARDRAILS-HUMAN-REVIEW.md`](./docs/GUARDRAILS-HUMAN-REVIEW.md).

Agent Runtime Composition joins the previously separate contracts without
absorbing them. Each execution re-verifies the Agent Definition source, resolves
the exact provider, model, and transport, uses Running Agents for continuation
and settlement, and validates final output before Agent Orchestration may return
it. The default Worker wires the resolver and runner but has no definitions,
source verifier, execution adapter, or authorizer, so configuration is false and
live provider behavior stays `unverified`. See
[`docs/AGENT-RUNTIME-COMPOSITION.md`](./docs/AGENT-RUNTIME-COMPOSITION.md).

Progressive Agents provides the application-facing growth path over those
owners: register one source-backed agent and run one bounded turn, add authorized
tool references through the existing Function Calling adapter boundary, then
register an explicit specialist workflow only when needed. The facade adds no
external SDK dependency and does not absorb definition, provider, tool, loop, or
answer-ownership policy. The default Worker remains unconfigured and provider
execution stays `unverified`. See
[`docs/PROGRESSIVE-AGENTS.md`](./docs/PROGRESSIVE-AGENTS.md).

Agent Orchestration readiness exposes a separate revision-fenced manager and
specialist topology. Each branch declares `delegate` or `handoff` plus its
conversation and final-answer owner. Delegation keeps the specialist behind the
source manager and returns only manager synthesis; handoff transfers both owners
to the target. The default Worker receives resolver and runner interfaces from
Agent Runtime Composition but no authorizer, so configuration is false and provider execution remains `unverified`. See
[`docs/AGENT-ORCHESTRATION.md`](./docs/AGENT-ORCHESTRATION.md).

Agent Swarm readiness is a separate dynamic horizontal-scaling path. A caller
supplies one exact base agent and goal, never roles, tasks, or workflow topology.
The runtime resolves the exact agent, validates generated task dependencies, coordinates short atomic
claims through the existing `AGENT_STATE` Durable Object, executes independent
work outside the ledger lock, binds each run to its session principal, fences stale output,
and requires durable-owner-verified receipts with stable task idempotency keys
for effects before only the base agent may synthesize the public result.
Authenticated `/api/agent-swarm/{start,work,settle,status,cancel}` routes fail
closed until resolver, planner, worker, synthesizer, receipt-verifier, and authorizer adapters are injected;
live provider execution remains `unverified`. See
[`docs/AGENT-SWARM.md`](./docs/AGENT-SWARM.md).

Agent Toolkit readiness adds a framework-neutral observation layer without
becoming another runner. Authenticated `/api/agent-toolkit/*` routes and the
local `instrument` wrapper persist only digest-bound caller-declared revision
metadata, server timing, one owner-aggregate cost, evaluator evidence,
deterministic same-cohort comparison, and review-pending proposals. An
application authorizer owns source verification; remote-submitted telemetry is
marked untrusted and excluded from comparison. Raw prompts, inputs, outputs,
tool payloads, private reasoning, default egress, and automatic application are
excluded; measured speed, quality, and cost improvements remain `unverified`.
See [`docs/AGENT-TOOLKIT.md`](./docs/AGENT-TOOLKIT.md).

Sandbox Agents readiness exposes a separate container-workspace control plane.
It validates one fresh workspace or saved snapshot, routes application-approved
file, command, package, and private-preview-port work to an injected provider,
serializes operations, and keeps provider session and resume state opaque. A
Node host can inject the repository-owned Docker CLI adapter, deny-first policy,
atomic file checkpoint store, and independent verifier. The live check uses an
immutable image, hardened internal networking, loopback-only preview proxies,
workspace snapshots, cross-controller resume, and complete resource cleanup.
The default Worker injects none of these owners, so its `configured` and
`liveContainerReady` fields remain false and its containment status stays
`unverified`.

Agent Definitions readiness exposes the separate registry that packages each
specialist's source URI and digest, model route, ordered instructions, and
optional reference-only tools, guardrails, MCP servers, handoffs, and output
contract. Preparation requires exact application source verification and
authorization for every capability reference, verifies
handoff targets, and preserves exact revisions. The default Worker registers no
agents, so `configured` is false; model execution remains owned by the Running
Agents adapter and provider execution remains `unverified`.

Tool Search readiness exposes a separate session-scoped controller. Direct
tools keep complete definitions, while deferred namespaces and functions expose
metadata until a bounded client or hosted search loads an exact catalog subset.
The initial context is immutable, programmatic search must happen before hosted
execution, and provider context reduction remains `unverified` without live
adapter evidence.

Instruction readiness is enforced separately from provider readiness.
`npm run instruction-audit:check` verifies that `docs/AGENTS.md` remains a
small always-on layer and `docs/SKILLS.md` remains a metadata-first catalog.
The check is model-free, reports exact zero token cost, and can compare context
size with an exact Git revision without rewriting either source.

`npm run instruction-quality:check` validates the separate final-answer evaluation suite and scorer. Use `npm run instruction-quality:evaluate -- --candidate=<path> --json` for a recorded or live candidate; the local evaluator invokes no model and does not claim general quality improvement.

No provider or model is baked into the repository. An operator must choose and
revision-bind each deployment route explicitly:

```bash
AGENT_MODEL_PROVIDER=primary
AGENT_MODEL_PROVIDER_REVISION=primary-v1
AGENT_MODEL_ADAPTER=registered-adapter
AGENT_MODEL_ENDPOINT=https://models.example.invalid/v1/run
AGENT_MODEL_ID=selected-model
AGENT_MODEL_API_KEY_ENV=PRIMARY_MODEL_KEY
AGENT_MODEL_TRANSPORT=request
AGENT_MODEL_TRANSPORT_DELIVERY=complete
AGENT_MODEL_TRANSPORT_CONNECTION=per-run
AGENT_MODEL_FEATURES=tool-calling,structured-output
```

See [`docs/MODELS-AND-PROVIDERS.md`](./docs/MODELS-AND-PROVIDERS.md) for
selection precedence, transport strategy, ownership, and acceptance proof.

See [`docs/SANDBOX-AGENTS.md`](./docs/SANDBOX-AGENTS.md) for container-provider
ownership, workspace and operation bounds, snapshot and resume semantics, and
the distinction between provider attestation and independent containment proof.

An independently approved Node-only proof can connect the composed agent owners
to OpenAI Responses without changing the default Worker. It hard-limits the run
to three requests, keeps delegation and handoff ownership explicit, reuses only
the specialist's stored prior response, and emits redacted usage-derived cost
evidence. See [`docs/LIVE-AGENT-PROVIDER-PROOF.md`](./docs/LIVE-AGENT-PROVIDER-PROOF.md).

```bash
AGENTIC_SANDBOX_IMAGE='node@sha256:<immutable-multiarch-digest>' npm run sandbox-docker:check
```

## Develop

```bash
npm run check
npm run cache-context:check
npm run reasoning-continuity:check
npm run function-gateway:check
npm run guardrails-human-review:check
npm run programmatic-tool-calling:check
npm run tool-search:check
npm run model-providers:check
npm run agent-runtime-composition:check
npm run agent-live-provider:check
npm run instruction-audit:check
npm run instruction-quality:check
npm run dev
```

Deployment is operator-gated:

```bash
wrangler secret put AGENT_API_JWT_SECRET
MODEL_KEY_BINDING=PRIMARY_MODEL_KEY
wrangler secret put "$MODEL_KEY_BINDING"
npm run cloudflare:deploy
```

For collaboration, open `?room=new` once and share the resulting URL. The
generated 128-bit room id is a bearer capability; anyone with that URL can join
the room, while generic session tokens and guessable room labels cannot.

Do not deploy this repo as part of local validation unless explicitly instructed.
