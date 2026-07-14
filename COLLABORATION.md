# Multi-device delivery

This repository uses protected pull requests as the synchronization boundary. Devices never push directly to `main`; each publishes a scoped branch from its one canonical checkout, CI validates it, GitHub auto-merges it, Cloudflare deploys the resulting `main` SHA serially, and idle devices fast-forward their clean canonical `main` checkout.

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

## Update an idle canonical checkout

Run a single update:

```bash
npm run sync:live
```

Or watch every 20 seconds:

```bash
npm run sync:live -- --watch --interval=20
```

The command requires exactly one registered worktree, the `main` branch, and a clean canonical checkout. It fetches `origin/main` and uses a fast-forward-only merge. It fails closed on an active task branch, local changes, non-fast-forward history, or any secondary worktree.
