---
title: "Canonical Checkout And Human-Authorized Runtime Lifecycle"
graphId: "md:canonical-checkout-automatic-runtime-lifecycle"
doc_type: "Lifecycle Contract"
date: "2026-07-29"
lang: "en-US"
schema: "canonical-runtime-lifecycle/v2"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "canonical main synchronization, protected integration, exact-candidate human authorization, and runtime-readiness evidence"
publish_policy: "protected main authorizes Dev integration only; Production requires an exact-candidate human decision"
runtime_scope: "agentic-canvas-os, knowgrph, and huijoohwee"
runtime_claim: "repository-owned gates converge canonical checkouts and deploy only human-authorized immutable candidates"
runtime_proof: "RUNTIME-PROOF.md"
---

# Canonical Checkout And Human-Authorized Runtime Lifecycle

## Authority

GitHub `origin/main` is the only cross-device source authority. A device never
synchronizes Git metadata or working files with another device. Each device
fetches the remote independently and converges its canonical checkout to the
same verified commit.

The registered `main` checkout is an automation-owned synchronization and
runtime lane. Humans and agents author only in registered task worktrees on
protected task branches. Generated runtime data, logs, caches, and notes live
outside canonical Git worktrees.

## Lifecycle State Machine

| Observed canonical state | Automatic action | Result |
|---|---|---|
| clean and equal to fetched `origin/main` | verify protected checks and the last-known-good readiness record | healthy |
| clean and strictly behind | validate the fetched SHA in a disposable worktree, then apply `git merge --ff-only origin/main` | converged |
| ahead or diverged | preserve diagnostics and fail closed | blocked |
| modified or unexpectedly untracked | copy content-addressed evidence without moving the original and fail closed | blocked |
| remote unavailable | keep the last verified runtime active and retry with bounded backoff | degraded |
| candidate validation fails | keep the previous verified runtime active | rejected |

Canonical synchronization never uses blind `git pull`, merge commits, rebase,
stash, force checkout, `git clean`, or hard reset. Recovery replaces a
disposable checkout from fetched objects only after recoverable evidence is
preserved.

## Multi-Device Contract

Each device runs the repository-owned reconciler after network recovery and on a
bounded interval. A reconciler acquires one device-local metadata lock with
stale-owner recovery, fetches and prunes `origin`, verifies the required GitHub
check runs for every remote SHA, prepares every changed revision in disposable
worktrees, and runs repository readiness commands before any canonical
fast-forward. Candidate failure leaves every canonical checkout at its prior
last-known-good revision.

Canonical discovery follows the single registered worktree whose branch is
`refs/heads/main`; it never assumes the Git common-directory owner is the runtime
checkout. This permits the canonical pair to live under
`$GITHUB_ROOT/.worktrees/canonical` while feature checkouts remain occupied.
Task provisioning derives `$GITHUB_ROOT/.worktrees/<repository>` from the Git
common directory, and hook subprocesses discard worktree-local Git environment
before inspecting sibling lanes. A valid lifecycle report may retain
`attention-required` for an unrelated dirty or review lane without replacing
canonical runtime proof; malformed reports and canonical-source drift still fail.

Run `npm run sync:workspace` for one reconciliation or keep the repository-owned
daemon active with `npm run sync:workspace:watch`. The daemon defaults to a
five-minute interval, applies bounded exponential retry with jitter, writes
`canonical-workspace-readiness/v2` under `$GITHUB_ROOT/.runtime-state`, and
copies hashed dirty-checkout evidence to quarantine without changing the source
checkout.

One device never pushes local canonical state to repair another device. Task
handoff uses an exact pushed commit SHA. Pull-request metadata, protected checks,
and immutable artifacts are the shared coordination surface.

## Protected Integration

- Direct pushes to `main` are forbidden for humans and agents.
- Every change enters through a task branch and pull request.
- The Integration Gate is the required merge status.
- A merge queue may merge a non-draft pull request automatically after every
  required check passes and scope ownership remains unique.
- The merged `main` SHA is the only canonical Dev input and carries no Production authorization.
- Automation credentials may bypass neither required checks nor source/mirror
  provenance validation.

`device:integrate` is the explicit device-local convergence controller. It may
create one intentional commit only when the exact dirty path set matches an
external `agentic-change-manifest/v1` before and after repository validation.
It preflights and merges the fetched protected `origin/main`, then reuses protected publication and waits a bounded time for the exact PR head
to report `MERGED`, records durable completion, fast-forwards the exact canonical
source, and delegates runtime restart to Agentic Canvas OS's `turn:end` supervisor. It never kills an unknown
port owner, never mutates canonical dirty state, and never treats an open PR or
an unverified runtime as complete.
After runtime readiness succeeds, the controller removes only its own clean,
detached, completion-proven task checkout and preserves the task branch. A
completed checkout remains audit-safe while cleanup is pending when its recorded
completion SHA is a proven ancestor of current protected `main`.

## Human-Authorized CI/CD

The merge of a protected, green `main` revision proves Dev integration only.
At `turn:end`, the local reconciler fetches and fast-forwards clean canonical
`main` to the exact `origin/main` commit, starts the repository-owned runtime
from that commit and the exact Agentic Canvas OS commit, and persists an
`agentic-local-review-candidate/v1` receipt containing both commit and tree
identities plus a digest of live probes and protected-check evidence.

The repository-owned release controller may then build exactly once and bind
the localhost-review digest, source and Agentic Canvas OS commits and trees,
catalog revision, build-artifact digest, and immutable-manifest digest into one
`agentic-production-release-candidate/v1`. Forward deployment remains stopped
until an authenticated human reviewer explicitly authorizes that exact
candidate digest in the protected GitHub `production` environment. A merge,
push, schedule, agent action, prior authorization, or `turn:end` result cannot
substitute for that decision.

The release controller performs these stages in order:

1. Check out the exact merged SHA with immutable Agentic Canvas OS dependency.
2. Re-run the integration and runtime-readiness gates.
3. Require the exact `turn:end` localhost-review receipt for those source identities.
4. Build once and bind the artifact, immutable manifest, app, docs, catalog, and local-review digest.
5. Synchronize and verify the generated `huijoohwee` artifact in an ephemeral checkout without publishing it.
6. Capture the current production deployment as the rollback target.
7. Pause at the protected `production` environment for an authenticated human decision on the exact candidate digest.
8. Revalidate `origin/main`, localhost `main`, source and docs trees, catalog, artifact, manifest, and candidate digests without rebuilding.
9. Deploy the already-built authorized artifact with a single environment concurrency lock.
10. Run production health and critical-path smoke probes.
11. Publish only the exact verified mirror and emit authorization, deployment, proof, and cost evidence.

Any identity or digest difference invalidates authorization immediately. A new
`main` commit, dependency movement, manifest change, or rebuild requires a new
`turn:end`, localhost review, candidate, and human authorization. The controller
must never deploy `latest main` or rebuild after approval.

Agentic Canvas OS does not own an independent production Worker. Its dormant
deploy, preview, and manual rollback workflows are absent; Dev proof remains
available locally, while Knowgrph is the sole production and rollback owner for
`airvio.co`.

If a post-deploy probe fails, automation rolls Pages back to the captured
successful production deployment, re-runs smoke, leaves the mirror remote at
the last known-good revision, and reports a typed failure. Storage or schema
changes must use backward-compatible expand/migrate/contract stages because a
code rollback does not roll back D1, KV, R2, Durable Object, or Queue state.

## Runtime-Ready Acceptance

A revision is runtime-ready only when all applicable identities agree:

```text
origin/main SHA
= immutable CI source SHA
= promoted Knowgrph SHA
= generated huijoohwee source marker
= production runtime identity SHA
= each healthy canonical device SHA
```

Required proof includes a clean canonical checkout, ahead/behind `0 0`, a
reproducible lockfile build, green protected checks, exact artifact digests,
successful Dev and production probes, a retained rollback target, deployment
concurrency fencing, structured observability, and zero unexplained cost or
secret exposure.

Both public surfaces expose byte-identical
`knowgrph-production-runtime-readiness/v2` JSON validated against
`docs/schemas/production-runtime-readiness.v2.schema.json`. The record binds the
Knowgrph commit and tree, Agentic Canvas OS commit, catalog commit, immutable
manifest digest, build-artifact digest, mirror repository, and `/` plus
`/knowgrph` surface set. HTML fallbacks and unknown fields fail closed.

Missing credentials, missing branch protection, a production environment
without required human reviewers, missing or drifted candidate authorization,
mutable dependency references, dirty mirrors, absent live proof,
or SHA disagreement reports `blocked`; it never reports `runtime-ready`.

## Ownership

| Concern | Owner |
|---|---|
| Lifecycle semantics and acceptance | `agentic-canvas-os/docs/CANONICAL-LIFECYCLE.md` |
| Task ownership and worktree activation | `agentic-canvas-os/docs/START-WORKFLOW.md` |
| Release stage detail and evidence | `agentic-canvas-os/docs/RELEASE-WORKFLOW.md` |
| Dev integration and human-authorized release controller | `knowgrph` |
| Generated production mirror validation | `huijoohwee` |
| Cloudflare deployment state | repository-owned Knowgrph release workflow |

## VCC

Given a merged, protected Knowgrph `main` commit, when `turn:end` records exact
localhost review, the release workflow builds one immutable candidate, and an
authenticated human authorizes that exact digest, then the controller revalidates
zero drift, deploys the same bytes under one production lock, proves live readiness,
publishes the verified mirror SHA, and leaves every canonical device able to
fast-forward independently. A failed deployment or probe restores the captured
Pages deployment and does not publish a new mirror revision.
