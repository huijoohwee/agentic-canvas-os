# agentic-canvas-os

**Product tier for the knowgrph video-remix agent.** A **Vercel** frontend +
Agent-API (**primary/default host**) — with **AWS as the fallback host** — that
take a reference video URL + brief + budget, call the **knowgrph control plane
over MCP**, and **embed the live knowgrph canvas** (the storyboard shot-plan)
scoped to the run.

This repo holds **no model provider keys**. Every reasoning/spend-bearing action
is delegated to the knowgrph control plane (Cloudflare) over MCP Streamable HTTP;
this tier only authenticates the caller, forwards the call, and frames the
canvas. The canvas engine is **consumed, not rebuilt** — knowgrph owns the
renderer, agentic-canvas-os is the OS shell around it.

## Hosting topology (Vercel primary, AWS fallback)

The Agent-API logic lives in one platform-neutral core (`agent-api/src/app.js`)
deployed to two hosts:

- **Vercel serverless functions — PRIMARY/DEFAULT** (`web/api/auth/session.js`,
  `web/api/run.js`). The frontend calls these same-origin first.
- **AWS Lambda — FALLBACK** (`agent-api/src/lambda.js`, an API Gateway proxy
  adapter). The frontend fails over to the configured AWS base
  (`AGENT_API_FALLBACK_URL`) only on a transport error or a 5xx from the primary
  (a 4xx is definitive and never falls over). See `src/agent-api-endpoints.js`.

## Topology

```
Dev (knowgrph SSOT)   /Users/huijoohwee/Documents/GitHub/knowgrph
  → Prod mirror        /Users/huijoohwee/Documents/GitHub/huijoohwee/content/knowgrph
  → Cloudflare (live)  airvio.co · airvio.co/knowgrph · airvio.co/knowgrph/mcp

agentic-canvas-os (this repo, the split target)
  Vercel UI ──┐
              │ Auth_Token (POST /api/auth/session, POST /api/run)
  Agent-API host: Vercel functions (PRIMARY) ─┐
                  AWS Lambda (FALLBACK) ───────┤──MCP Streamable HTTP (knowgrph.video_remix.run)──▶ airvio.co/knowgrph/mcp
              ◀── Run_Manifest + Demo_Pack ────┘
  Vercel UI ──embed knowgrph canvas doc-view (run-scoped)──────────▶ airvio.co/knowgrph/doc-view?run=<runId>
```

The connector contracts are authored and proven in the knowgrph monorepo
(`knowgrph/mcp/video-remix/*`, `knowgrph/aws/agent-api/*`, `knowgrph/web/*`).
This repo is the **split target** realizing the product tier: it mirrors the
minimal seams it needs (the MCP forward + the canvas doc-view URL scheme) and
keeps them in step with the knowgrph SSOT.

## Layout

| Path | Purpose |
|---|---|
| `src/config.js` | Public config: knowgrph MCP endpoint, canvas base, Agent-API primary + fallback bases (no secrets). |
| `src/knowgrph-mcp-client.js` | Keyless MCP Streamable HTTP client → `airvio.co/knowgrph/mcp` (JSON/SSE, fail-closed). |
| `src/canvas-embed.js` | Run-scoped knowgrph canvas doc-view URL + embed descriptor (mirrors knowgrph SSOT). |
| `src/agent-api-endpoints.js` | Primary→fallback base resolution + `postJsonWithFallback` (Vercel first, AWS on 5xx/transport error). |
| `agent-api/src/app.js` | Platform-neutral Agent-API core (auth + MCP forward), shared by both hosts. |
| `agent-api/src/auth.js` | Stateless HS256 session token (node:crypto, server-side secret only). |
| `agent-api/src/handler.js` | Keyless handlers: mint session, validate, forward `POST /run` to knowgrph MCP. |
| `agent-api/src/lambda.js` | **AWS Lambda (FALLBACK)** API Gateway proxy adapter over the core. |
| `web/api/*` | **Vercel functions (PRIMARY)** routes (`/api/auth/session`, `/api/run`) over the core. |
| `web/` | Static Vercel frontend: submit a run, embed the live knowgrph canvas. |
| `__tests__/` | Network-free deterministic tests (node:test). |

## Boundaries (mirror knowgrph R11 / R15)

- **No model keys here.** The Agent-API forwards to knowgrph MCP; it never calls
  a paid model directly.
- **Auth ≠ approval.** The session token gates *access*; spend still requires a
  knowgrph Approval_Token at each gate (enforced in the control plane).
- **Canvas embed isolation.** The doc-view is framed cross-origin; the knowgrph
  doc-view route must allow `frame-ancestors` of the Vercel origin and scope the
  run to the entitled caller.

## Develop

```bash
npm test                                   # deterministic, offline
KNOWGRPH_MCP_ENDPOINT=https://airvio.co/knowgrph/mcp \
CANVAS_BASE_URL=https://airvio.co/knowgrph \
  npm run web:build                        # static build → web/dist
```

Live deploys (Vercel + AWS) are operator-gated and need the knowgrph control
plane reachable; see `knowgrph/docs/knowgrph-acos-deploy-runbook.md`.
