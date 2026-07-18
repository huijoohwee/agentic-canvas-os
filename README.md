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

This preserves local task-branch work, detaches that task worktree at fetched
`origin/main`, and marks the task as paused or blocked. A parked branch is never
completed work.

Mandatory completion gate:

```bash
npm run device:complete -- --json
```

This fails while work is dirty, stashed, branch-only, or attached to an open
pull request. After the protected Dev pull request is merged, it verifies the
merge commit is contained by `origin/main`, detaches the clean task worktree at
that exact revision, and emits the pull request, merge, and main SHAs. Fast-forward
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

SEA-LION hosted API
  https://api.sea-lion.ai/v1/chat/completions
```

The connector contracts are authored and proven in the knowgrph monorepo. This
repo is the split product tier and keeps only the runtime seams it needs:
Cloudflare request adaptation, MCP forwarding, SEA-LION route metadata, and the
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
| `agent-api/src/openai-responses-function-adapter.js` | Responses translation, strict function selection, same-response continuation, and usage-derived cost evidence. |
| `agent-api/src/knowgrph-function-gateway.js` | Explicit application allowlist and policy-preserving mapping to the existing Knowgrph MCP owner. |
| `agent-api/src/function-calling-handler.js` | Authenticated bounded HTTP request boundary for direct function calls. |
| `agent-api/src/programmatic-tool-calling.js` | Bounded hosted-program controller, caller-lineage enforcement, direct-call safety boundary, and compact final evidence. |
| `agent-api/src/tool-search.js` | Session-scoped deferred-definition controller, metadata-only initial exposure, exact search loading, and call authorization. |
| `agent-api/src/handler.js` | Request validation and fail-closed MCP forwarding. |
| `agent-api/src/model-config.js` | Server-side SEA-LION route metadata; stores only the API key env-name. |
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
- valid SEA-LION model route metadata
- the secret binding named by `AGENT_MODEL_API_KEY_ENV` / `SEA_LION_API_KEY_ENV`
  defaulting to `SEA_LION_API_KEY`

The response reports `apiKeyPresent`; it never includes the secret value.
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
schemas, routing, credentials, or policy. Readiness reports only sanitized
adapter/gateway state, and `providerExecutionStatus` remains `unverified` until
a bounded live run returns actual usage and continuation evidence.

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
runs. The default Worker has no agent-step adapter, so `configured` is false and
`providerExecutionStatus` remains `unverified`; the controller does not replace
Function Calling, Programmatic Tool Calling, or the real gateway policy owner.

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

Default SEA-LION route:

```bash
AGENT_MODEL_PROVIDER=sealion
AGENT_MODEL_BASE_URL=https://api.sea-lion.ai/v1
AGENT_MODEL_ID=aisingapore/Gemma-SEA-LION-v4-27B-IT
AGENT_MODEL_API_KEY_ENV=SEA_LION_API_KEY
```

## Develop

```bash
npm run check
npm run cache-context:check
npm run reasoning-continuity:check
npm run function-gateway:check
npm run programmatic-tool-calling:check
npm run tool-search:check
npm run instruction-audit:check
npm run instruction-quality:check
npm run dev
```

Deployment is operator-gated:

```bash
wrangler secret put AGENT_API_JWT_SECRET
wrangler secret put SEA_LION_API_KEY
npm run cloudflare:deploy
```

For collaboration, open `?room=new` once and share the resulting URL. The
generated 128-bit room id is a bearer capability; anyone with that URL can join
the room, while generic session tokens and guessable room labels cannot.

Do not deploy this repo as part of local validation unless explicitly instructed.
