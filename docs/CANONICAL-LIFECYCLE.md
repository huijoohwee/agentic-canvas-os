---
title: "Canonical Checkout And Automatic Runtime Lifecycle"
graphId: "md:canonical-checkout-automatic-runtime-lifecycle"
doc_type: "Lifecycle Contract"
date: "2026-07-21"
lang: "en-US"
schema: "canonical-runtime-lifecycle/v2"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "canonical main synchronization, protected integration, automatic promotion, and runtime-readiness evidence"
publish_policy: "protected main is the pre-authorized automatic promotion boundary"
runtime_scope: "agentic-canvas-os, knowgrph, and huijoohwee"
runtime_claim: "repository-owned gates converge canonical checkouts and promote only verified immutable revisions"
runtime_proof: "RUNTIME-PROOF.md"
---

# Canonical Checkout And Automatic Runtime Lifecycle

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
- The merged `main` SHA is the only automatic promotion input.
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

## Automatic CI/CD

The merge of a protected, green `main` revision is standing operator
authorization for the repository-owned release workflow. No per-release button,
typed confirmation, developer checkout, or local credential is required.

The release controller performs these stages in order:

1. Check out the exact merged SHA with immutable Agentic Canvas OS dependency.
2. Re-run the integration and runtime-readiness gates.
3. Build once and bind the artifact to the app, docs, catalog, and mirror SHAs.
4. Synchronize the generated `huijoohwee` artifact in an ephemeral checkout.
5. Verify source-to-mirror parity.
6. Capture the current production deployment as the rollback target.
7. Deploy the verified artifact with a single environment concurrency lock.
8. Reconcile canonical documents only after the application deploy succeeds.
9. Run production health and critical-path smoke probes.
10. Publish the exact verified mirror to `huijoohwee/main`.
11. Emit the immutable manifest, deployment identity, proof, and cost ledger.

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

Missing credentials, missing branch protection, a manually gated production
environment, mutable dependency references, dirty mirrors, absent live proof,
or SHA disagreement reports `blocked`; it never reports `runtime-ready`.

## Ownership

| Concern | Owner |
|---|---|
| Lifecycle semantics and acceptance | `agentic-canvas-os/docs/CANONICAL-LIFECYCLE.md` |
| Task ownership and worktree activation | `agentic-canvas-os/docs/START-WORKFLOW.md` |
| Release stage detail and evidence | `agentic-canvas-os/docs/RELEASE-WORKFLOW.md` |
| Dev integration and automatic release controller | `knowgrph` |
| Generated production mirror validation | `huijoohwee` |
| Cloudflare deployment state | repository-owned Knowgrph release workflow |

## VCC

Given a merged, protected Knowgrph `main` commit, when the automatic release
workflow runs, then it validates the immutable app/docs pair, builds and verifies
one mirror artifact, deploys under one production lock, proves live readiness,
publishes the verified mirror SHA, and leaves every canonical device able to
fast-forward independently. A failed deployment or probe restores the captured
Pages deployment and does not publish a new mirror revision.
