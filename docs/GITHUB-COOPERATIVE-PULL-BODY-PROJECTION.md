---
title: "GitHub Cooperative Pull Body Projection"
graphId: "md:github-cooperative-pull-body-projection"
doc_type: "Contract"
version: "1.0.0"
date: "2026-08-30"
schema: "agentic-github-cooperative-pull-body-projection/v1"
frontmatter_contract: "required"
status: "focused-tested"
lang: "en-US"
owner: "GitHub provider adapter"
local_rung: "spec-complete"
delivered_rung: "undocumented"
lane: "authoring"
runtime_readiness_policy: "fail-closed"
---
# GitHub Cooperative Pull Body Projection

## Scope

This GitHub-specific port projects one pull-request body for the existing
active-owned-dirt current-base reanchor controller. It changes no universal
plan, authorization, journal, cloud, lease, Git, review, merge, release, or
deployment contract. The wrapper injects only the provider port through the
existing composition seam.

GitHub documents conditional requests for safe reads, but not conditional
unsafe updates for `PATCH /pulls/{pull_number}`. The update endpoint has no
expected body, entity tag, revision, or timestamp precondition. GraphQL's
`updatePullRequest` mutation has no expected-value input either. Therefore this
port never sends `PATCH If-Match` and never claims provider-atomic
compare-and-swap.

## Cooperative operation

1. Read the exact same-repository, `main`-based pull request twice through
   `gh pr view` and require byte-identical normalized snapshots.
2. Bind the complete body and immutable subject to an application snapshot
   digest. The existing adapter field remains named `etag` for interface
   compatibility; the value is explicitly not a provider entity tag.
3. Hold the existing repository-owned writer-registry fence, repeat the stable
   double read, and require the exact armed snapshot digest.
4. Clear the one-use arm before mutation, write the target body to an
   owner-only temporary directory and file, and perform exactly one
   `gh pr edit --body-file`.
5. Make a bounded best-effort removal of that private directory on every
   creation, verification, provider-success, or provider-failure path without
   replacing the primary result. Then repeat the stable read and require the
   same identity, head, `main` base, draft state, and exact target body.
6. Let the existing durable reanchor journal adopt response loss or retry only
   from its exact phase evidence.

The surrounding controller still proves the sealed plan, task capability,
current cloud successor, local lease CAS, exact head/base, admitted scope,
body remainder, and terminal readback. A stale or unstable pull request, wrong
repository, fork, malformed response, provider failure, or readback drift
fails closed with no fallback or compensating write.

## Honest concurrency boundary

The repository single-writer fence serializes cooperative Agentic Canvas OS
writers. GitHub supplies no atomic PR-body write precondition, so an
uncooperative human or bot edit inside the final provider read/write window
can be overwritten and may be unobservable. Consumers that require protection
from arbitrary provider writers must move the authority marker to a substrate
with a real compare-and-swap primitive. They must not relabel this bounded
cooperative projection as atomic CAS.

## Invocation

Use the exact plan, authorization, journal, session, repository, and external
task capability already emitted for the universal controller:

```sh
node scripts/active-owned-dirt-current-base-reanchor-github.mjs run \
  --repository=<absolute-task-worktree> \
  --session=<exact-session> \
  --task-authority=<absolute-external-capability> \
  --journal=<absolute-external-journal> \
  --plan=<absolute-external-plan> \
  --authorization='authorize active-owned-dirt-current-base-reanchor <digest>' \
  --json
```

## Verification

```sh
node --test __tests__/active-owned-dirt-current-base-reanchor-github.test.mjs
node --test __tests__/active-owned-dirt-current-base-reanchor.test.mjs
npm run docs:check
```

The proof covers stable snapshots, non-`main` and same-SHA retarget rejection,
drift and malformed-subject rejection, single mutation, owner-only private-file
cleanup across creation and provider failures, exact readback, provider failure
without retry, existing-adapter composition, and wrapper-only dependency
injection.
