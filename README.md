# agentic-canvas-os

Cloudflare Worker product tier demonstrating `knowgrph` MCP Readiness & Command Grammar Integration. 
One Worker serves the static UI, authenticates callers, forwards `/api/invoke` and `/api/run` 
to the knowgrph MCP control plane, exposes runtime readiness, and embeds the live knowgrph canvas.

This repo holds no model provider keys in source or client bundles. Runtime
secrets are Cloudflare secret bindings; the browser only sees public URLs.

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
| `agent-api/src/handler.js` | Request validation and fail-closed MCP forwarding. |
| `agent-api/src/model-config.js` | Server-side SEA-LION route metadata; stores only the API key env-name. |
| `docs/` | Agentic Canvas OS docs/control surface for `/`, `#`, and `@` invocation dictionaries. |
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

Default SEA-LION route:

```bash
AGENT_MODEL_PROVIDER=sealion
AGENT_MODEL_BASE_URL=https://api.sea-lion.ai/v1
AGENT_MODEL_ID=aisingapore/Gemma-SEA-LION-v4-27B-IT
AGENT_MODEL_API_KEY_ENV=SEA_LION_API_KEY
```

## Develop

```bash
npm test
npm run web:build
npm run cloudflare:dev
```

Deployment is operator-gated:

```bash
wrangler secret put AGENT_API_JWT_SECRET
wrangler secret put SEA_LION_API_KEY
npm run cloudflare:deploy
```

Do not deploy this repo as part of local validation unless explicitly instructed.
