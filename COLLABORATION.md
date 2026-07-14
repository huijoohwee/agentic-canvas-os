# Multi-device delivery

This repository uses protected pull requests as the synchronization boundary. Devices never push directly to `main`; each publishes a scoped branch, CI validates it, GitHub auto-merges it, Cloudflare deploys the resulting `main` SHA serially, and other devices update a separate clean live worktree.

## One-time activation

Merge the workflow and script files to `main`, then run:

```bash
npm run github:configure -- --apply
```

The command replaces the stale Vercel branch checks with these strict checks:

- `CI / test`
- `CI / build`
- `CI / docs-contract`
- `CI / collaboration-integration`

It also enables CODEOWNERS review for authentication, collaboration state, Worker, Wrangler, and workflow changes. Production remains disabled through `PROD_DEPLOY_ENABLED=false`.

Before enabling deployment, configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as production environment secrets, set the repository variable `PRODUCTION_URL`, fix and verify the public session-token minting vulnerability, then explicitly set `PROD_DEPLOY_ENABLED=true`.

## Work from a device

Set a stable device id once if the hostname is not suitable:

```bash
git config agentic.device katrina-macbook
```

Start from current remote `main`:

```bash
npm run device:start -- canvas-presence
```

Commit intentionally, then publish the clean branch:

```bash
npm run device:publish
```

Publishing runs local checks, pushes the branch, creates or updates a PR with the `automerge` label, and enables squash auto-merge. CI updates only the oldest eligible PR after each `main` change, which provides merge-queue behavior for this personal repository.

## Conflict policy

- GitHub updates and merges disjoint changes automatically.
- Concurrent append-only `memory/YYYY-MM.md` and `todo/YYYY-MM.md` changes preserve the current `main` bytes and append the device suffix.
- A `package-lock.json`-only collision is regenerated from the merged package manifest.
- Source, schema, auth, Durable Object, storage, secret, deployment, or workflow conflicts receive `automerge/conflict` and stop for owner review.
- Generated web output is rebuilt; it is not a merge authority.

## Follow merged code without touching active work

Run a single update:

```bash
npm run sync:live
```

Or watch every 20 seconds:

```bash
npm run sync:live -- --watch --interval=20
```

The watcher creates a detached sibling worktree named `agentic-canvas-os-live`. It never rebases or resets the active task worktree and refuses to update the live worktree if that worktree is dirty.

## Preview, smoke, and rollback

Three CI safeguards support multi-device delivery beyond the merge queue:

- **Preview deploys.** `preview.yml` runs on every pull request and, when the `PREVIEW_DEPLOY_ENABLED` repository variable is `true`, uploads a non-production Cloudflare Worker *version* and comments its preview URL on the PR. A version upload never shifts production traffic; another device can exercise the change on a real URL before it merges. Promotion to production still happens only through `deploy.yml` after merge.
- **Post-deploy smoke checks.** After each production deploy, `deploy.yml` runs `npm run smoke` (`scripts/smoke.mjs`) against `PRODUCTION_URL`. The checks need no secrets and assert that the critical routes are wired and correctly gated: `GET /api/ready` returns a `200` JSON object, `GET /api/canvas/room` returns `400`/`401` (Durable Object route plus auth are live), and `POST /api/invoke` returns `401` (MCP forward route is live and auth-gated). A `404`, `501`, or `5xx` fails the deploy. Run the same checks locally with `PRODUCTION_URL=https://… npm run smoke`.
- **Rollback.** When smoke fails, `deploy.yml` prints rollback guidance. Roll back through the **Rollback production** workflow (`rollback.yml`, `workflow_dispatch`) with an optional `version_id` from `wrangler versions list`, or locally with `npm run rollback`. Rollback shares the `production` concurrency group with deploy, so the two never race, and it re-runs the smoke checks after restoring the previous version.
