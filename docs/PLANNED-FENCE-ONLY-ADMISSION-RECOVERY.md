---
title: "Planned Fence-Only Admission Recovery"
graphId: "md:planned-fence-only-admission-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-planned-fence-only-admission-recovery-doc/v1"
frontmatter_contract: "required"
status: "normative"
scope: "task-bound planned admission recovery"
provider_policy: "provider operations isolated behind a repository adapter"
model_policy: "model, agent, and client neutral"
---

# Planned Fence-Only Admission Recovery

This controller closes one narrow response-loss state. A provisioned candidate
already has its registered worktree, single-parent fence commit, remote branch,
draft review request, planned writer lease, task binding, manifest, and cloud
claim. No source commit exists beyond the fence. The local lease and the same
cloud claim expired before admission could finish, so the live claim is dormant,
scope-reserving, and non-writing.

Recovery restores only that existing claim and its local and review
projections. It does not finish admission and grants no source mutation,
authoring, review, integration, cleanup, release, or deployment authority. A
fresh scoped-admission decision remains mandatory afterward.

## Applicability

Read-only planning requires all of the following:

- the canonical worktree is registered, clean, on `main`, and exactly at the
  candidate lease base and fetched protected revision;
- the candidate worktree is registered, attached to the recorded branch, and
  clean including untracked files;
- candidate HEAD, remote branch, draft review head, and lease fence are equal;
- the fence has one parent equal to the lease base, its tree equals the base
  tree, and the base-to-fence changed-path set is empty;
- the writer lease remains `active` with admission `planned`, carries the exact
  manifest and task binding, and is expired at the observation time;
- the review request is open, draft, same-repository, based on `main`, and has
  no auto-merge request;
- the exact claim is live as `dormant-preserved`, still reserves the declared
  scope, grants no write authority, and joins the lease claim, transition,
  heartbeat, fence, operation receipt, epochs, repository, review, manifest,
  device, and session identities;
- no other live scope-reserving claim overlaps the declared write set.

An authored descendant belongs to the committed-descendant recovery owner. A
dirty worktree, a parked or reviewed claim, a second claim, an overlapping
reservation, a changed base, or an ambiguous projection fails closed.

## Authorization and effects

Planning performs no mutation and emits the exact human statement:

```text
authorize planned-fence-only-admission-recovery <plan-digest>
```

Run requires that byte-exact statement and the existing external owner-only
task capability. Its proof operation is
`planned-fence-only-admission-recovery:<plan-digest>`. The capability is read as
a private regular file and its secret material is never included in a plan,
journal, receipt, log, review body, or command result.

The closed allowed effect set is:

1. one idempotent recovery continuation on the same cloud claim;
2. one compare-and-swap writer-lease projection;
3. replacement of only the hidden writer marker in the same draft review body;
4. one private replay journal under the repository Git common directory or an
   explicitly supplied external path.

The transition preserves branch, semantic scope, session, device, worktree,
local lease epoch, cloud lease epoch, base, fence, review identity, task binding,
manifest, and every repository byte. The cloud transition counter advances by
exactly one. Admission remains `planned`.

## Replay and drift

The journal advances through these durable phases:

```text
authorized
task_authority_verified
cloud_request_sealed
cloud_recovered
lease_projected
review_marker_projected
verified
complete
```

The exact cloud request, hashed idempotency key, operation receipt, provider
receipt, and recovered authority are sealed before downstream projections.
Response-loss replay accepts only the same request and exact counter-plus-one
claim. The lease compare-and-swap accepts only the sealed source lease or the
one deterministic target lease. The review adapter accepts only the exact
sealed source body or deterministic target body; every third body fails.

A run resuming from `verified` repeats terminal verification before completing.
Once `complete` is durable, replay returns the stored receipt without requiring
the time-bounded recovered lease to remain active. A dead journal lock may be
recovered only by a content-bound stale-owner compare-and-swap; a live or
ambiguous owner remains blocking.

The reference review adapter uses observable pre-read, edit, and post-read
verification. It does not claim a provider-side conditional body update. The
provider-specific transport is replaceable; the evidence, authorization,
state-machine, and receipt semantics remain model, agent, client, and provider
neutral.

Unrelated global ledger advancement may be re-observed, but the exact source
claim and absence of overlapping reservations must remain true at every effect
boundary. Claim, lease, Git, manifest, task binding, canonical base, or review
identity drift stops the run.

## CLI

Invoke the direct controller from a protected Agentic Canvas OS checkout. Keep
the manifest, plan, capability, and optional state file outside repositories.

```sh
node "$GITHUB_ROOT/agentic-canvas-os/scripts/planned-fence-only-admission-recovery.mjs" plan \
  --repository="$TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --manifest="$EXTERNAL_MANIFEST" \
  --ttl-seconds=3600 \
  --state-path="$EXTERNAL_STATE" \
  --json

node "$GITHUB_ROOT/agentic-canvas-os/scripts/planned-fence-only-admission-recovery.mjs" run \
  --repository="$TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --manifest="$EXTERNAL_MANIFEST" \
  --ttl-seconds=3600 \
  --state-path="$EXTERNAL_STATE" \
  --plan-file="$EXTERNAL_PLAN" \
  --task-authority="$EXTERNAL_TASK_CAPABILITY" \
  --authorize='authorize planned-fence-only-admission-recovery <plan-digest>' \
  --json
```

The terminal receipt explicitly reports `admissionStatus: "planned"`,
`authoringAuthority: false`, `mutationAuthorityGranted: false`, and
`deploymentAuthority: false`. Run a fresh repository-owned scoped admission
before any source edit or later lifecycle transition.

Provider claims use opaque device and session subjects. Source and recovered
verification normalize the local lease labels before joining those subjects;
an already-opaque recovered authority is accepted only when it resolves to the
same exact device and session, while either owner mismatch still fails closed.
Legacy recovered projections may omit `heartbeatCounter` only when the exact
live claim records zero. A present counter is still validated as a nonnegative
integer and must equal the claim, so nonzero or malformed drift remains blocked.
GitHub review evidence similarly joins only a raw `PR_` node ID to the cloud
authority's `github-pull-request:` form. Other review adapters and identities
remain byte-exact and cannot inherit that provider-specific projection.
