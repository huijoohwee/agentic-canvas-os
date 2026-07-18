# Multi-device delivery

This repository uses protected pull requests as the synchronization boundary. Devices never push directly to `main`; one registered `main` worktree remains the runtime and synchronization owner while registered task worktrees publish distinct scoped branches concurrently. CI validates each branch, GitHub merges protected changes, and the clean main worktree fast-forwards after integration.

## One-time activation

Merge the workflow and script files to `main`, then run:

```bash
npm run github:configure -- --apply
```

The command replaces the stale Vercel branch checks with these strict checks:

- `test`
- `build`
- `docs-contract`
- `collaboration-integration`

It retains CODEOWNERS routing for authentication, collaboration state, Worker, Wrangler, and workflow changes. A solo owner cannot approve their own pull request, so merge permission depends on the strict required checks, resolved conversations, conflict-free index, and unique-semantic-scope guard instead of an impossible self-review. Production remains disabled through `PROD_DEPLOY_ENABLED=false`.

Before enabling deployment, configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as production environment secrets, set the repository variable `PRODUCTION_URL`, fix and verify the public session-token minting vulnerability, then explicitly set `PROD_DEPLOY_ENABLED=true`.

## Work from a device

Set a stable device id once if the hostname is not suitable:

```bash
git config agentic.device katrina-macbook
```

Create a detached registered task worktree from current remote `main`, then claim it:

```bash
export TASK_WORKTREE_ROOT="../.worktrees/agentic-canvas-os"
export TASK_WORKTREE="$TASK_WORKTREE_ROOT/canvas-presence"
git fetch --prune origin
git worktree add --detach "$TASK_WORKTREE" origin/main
npm run device:start -- canvas-presence \
  --session="<stable-task-id>" --repository="$TASK_WORKTREE"
```

Commit intentionally, then publish the clean branch:

```bash
npm run device:publish
```

`device:start` configures the repository-owned pre-commit hook. Run `npm run git:configure` once in an existing checkout that has not used `device:start` yet. The hook rejects unresolved index entries, unregistered worktrees, branch/lease mismatches, and expired sessions.

Publishing requires a registered task worktree, its branch-bound lease, no unresolved conflict, and no open PR owned by another branch for the same semantic scope. It runs local checks, pushes the branch, updates its scope-owned PR with the `automerge` label, and enables squash auto-merge. Different semantic scopes may keep independent worktrees and pull requests active concurrently.

## Conflict policy

- Resolve every merge conflict before committing changes. Unmerged index stages fail both the pre-commit hook and device publication.
- Use only a path returned by `git worktree list --porcelain -z`; copied-source and unregistered paths are not delivery authorities.
- Keep one open pull request per semantic scope. Distinct scopes may coexist; duplicate scope owners must serialize through exact-SHA handoff.
- Never use `git checkout --ignore-other-worktrees` or activate one branch in multiple worktrees.
- GitHub updates and merges disjoint changes automatically.
- Concurrent append-only `memory/YYYY-MM.md` and `todo/YYYY-MM.md` changes preserve the current `main` bytes and append the device suffix.
- A `package-lock.json`-only collision is regenerated from the merged package manifest.
- Source, schema, auth, Durable Object, storage, secret, deployment, or workflow conflicts receive `automerge/conflict` and stop for owner review.
- Generated web output is rebuilt; it is not a merge authority.

## Update an idle canonical checkout

Run a single update:

```bash
npm run sync:live
```

Or watch every 20 seconds:

```bash
npm run sync:live -- --watch --interval=20
```

The command requires invocation from the registered `main` worktree with a clean `main` branch. It fetches `origin/main` and uses a fast-forward-only merge without switching, merging, or inspecting task worktree content. It fails closed on a task worktree, local main changes, or non-fast-forward history; additional registered task worktrees are allowed.

## Preview, smoke, and rollback

Three CI safeguards support multi-device delivery beyond the merge queue:

- **Preview deploys.** `preview.yml` runs on every pull request and, when the `PREVIEW_DEPLOY_ENABLED` repository variable is `true`, uploads a non-production Cloudflare Worker *version* and comments its preview URL on the PR. A version upload never shifts production traffic; another device can exercise the change on a real URL before it merges. Promotion to production still happens only through `deploy.yml` after merge.
- **Post-deploy smoke checks.** After each production deploy, `deploy.yml` runs `npm run smoke` (`scripts/smoke.mjs`) against `PRODUCTION_URL`. The checks need no secrets and assert that the critical routes are wired and correctly gated: `GET /api/ready` returns a `200` JSON object, `GET /api/canvas/room` returns `400`/`401` (Durable Object route plus auth are live), and `POST /api/invoke` returns `401` (MCP forward route is live and auth-gated). A `404`, `501`, or `5xx` fails the deploy. Run the same checks locally with `PRODUCTION_URL=https://… npm run smoke`.
- **Rollback.** When smoke fails, `deploy.yml` prints rollback guidance. Roll back through the **Rollback production** workflow (`rollback.yml`, `workflow_dispatch`) with an optional `version_id` from `wrangler versions list`, or locally with `npm run rollback`. Rollback shares the `production` concurrency group with deploy, so the two never race, and it re-runs the smoke checks after restoring the previous version.

## Security scanning

`security.yml` runs dependency and static-analysis scanning on pull requests, on `main`, and on a weekly schedule: `npm audit --audit-level=high`, CodeQL for JavaScript, and (on PRs) a dependency review that fails on newly introduced high-severity advisories. Run the dependency audit locally with `npm audit --audit-level=high`.
