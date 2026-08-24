---
title: "Orphaned Task Authority Recovery"
graphId: "md:agentic-orphaned-task-authority-recovery"
doc_type: "Runtime Contract"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-orphaned-task-authority-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
---
<!-- Responsibility: Document the exceptional, plan-bound replacement of irrecoverable lane authority. -->

# Orphaned Task Authority Recovery

Use this incident controller only when one admitted writer lane still carries a
valid public task-authority binding but the matching private capability is
irrecoverably unavailable. It does not recover the old key and does not turn
repository ownership, PR ownership, session identity, or clean Git state into
task authority.

The controller permits one narrow transition: install a newly generated,
monotonic task-authority binding in the local writer lease and project that
binding into the unchanged ownership PR marker. It does not change authored
bytes, the index, HEAD, commits, branch refs, cloud claims, merge state,
deployment, or runtime state.

## Preconditions

The source must be a registered `agent/<device>/<scope>` worktree with an
`active`, `review_ready`, `delivery`, or `parked` lease. Its lease, cloud claim
proof, HEAD, Git evidence, open ownership PR, and hidden writer-lease marker
must join exactly. Dirty paths must remain inside the admitted write set and
contain no unmerged entries.

Ordinarily the claim proof is the unique exact claim in the current cloud
inventory. A narrow fallback is permitted only for a locally `review_ready`
lease whose exact `claimId` and `claimDigest` identify one validated raw-ledger
`reviewed` entry and whose next same-claim transition is its terminal
`retired` fence for the same lane revision and review request. This evidence
does not reactivate the retired claim and grants no cloud mutation authority.
Malformed ledgers, duplicate projections, other local states, non-adjacent
terminal transitions, or any identity drift fail closed.

Create a new task-authority capability outside the source repository. The file
must be canonical, owner-only, non-symlink, and mode `0600`. Its subject must be
distinct from the lost source subject and its generation must be exactly one
greater. Keep the capability, generated plan, and replay journal outside the
repository; never commit them.

## Plan

Planning is read-only except for writing the explicitly named external plan
file. It captures the source twice and rejects any drift. Supply a non-secret
incident reference and a SHA-256 digest of the external loss attestation:

```sh
node scripts/orphaned-task-authority-recovery-cli.mjs plan \
  --repository=/absolute/source/worktree \
  --branch=agent/device/scope \
  --target-capability=/absolute/private/replacement.json \
  --incident-reference=incident-identifier-or-ticket \
  --loss-attestation-digest=<sha256> \
  --output=/absolute/private/recovery-plan.json
```

The JSON result contains the content-addressed plan digest and the only valid
authorization statement. Review the external plan before authorizing it. A
different branch, capability projection, source binding, Git state, claim, PR,
incident reference, or attestation digest produces a different plan.

## Run

Pass the exact statement emitted by `plan` and a fresh external journal path:

```sh
node scripts/orphaned-task-authority-recovery-cli.mjs run \
  --repository=/absolute/source/worktree \
  --branch=agent/device/scope \
  --target-capability=/absolute/private/replacement.json \
  --plan=/absolute/private/recovery-plan.json \
  --state=/absolute/private/recovery-journal.json \
  --authorize='authorize orphaned-task-authority-recovery <planDigest>'
```

Before any repository effect, the journal durably records the full plan and
exact authorization. A dirty lane receives an immutable active-owned-dirt
snapshot before the writer-registry compare-and-swap. The CAS replaces only
`lease.taskAuthority`. The controller then journals the provider operation key,
replaces exactly one PR marker, and verifies unchanged Git evidence and cloud
claim identity. When the retired-reviewed fallback is used, replay re-reads the
ledger and requires the same stable source and terminal transition digests;
unrelated later ledger entries do not alter that proof.

The CLI always prints one JSON object and redacts local paths from errors. A
completed journal is immutable; replay returns the original completion receipt
without repeating effects. An interrupted run may be rerun with the same plan,
capability, journal, and authorization. It adopts a local or provider effect
only when the live value is the exact plan-derived target.

## Validation and boundaries

Run the focused contract before protected review:

```sh
node --test __tests__/orphaned-task-authority-recovery-*.test.mjs
```

Passing this check establishes controller readiness only. It does not authorize
use on a source lane. Each lane requires its own plan and exact operator
authorization. After completion, resume the normal task-bound lifecycle with
the replacement capability. Merge, deployment, and cleanup still require their
separate workflow receipts.
