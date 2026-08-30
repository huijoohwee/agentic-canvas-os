---
title: "Active Owned Dirt Current-Base PR Marker Replay"
graphId: "md:active-owned-dirt-current-base-pr-marker-replay"
doc_type: "Runtime Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-active-owned-dirt-current-base-pr-marker-replay/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized provider-marker convergence for one journaled current-base reanchor"
runtime_scope: "read-only planning, current task-capability proof, exact local-lease and pull-request observation, cooperative writer-marker projection, private replay journal, and terminal verification"
runtime_claim: "converges only the hidden writer marker of one exact pr-projected active-owned-dirt current-base reanchor without changing source, refs, local registry, cloud authority, review state, or authored bytes"
runtime_owner: "../scripts/active-owned-dirt-current-base-pr-marker-replay-contract.mjs; ../scripts/active-owned-dirt-current-base-pr-marker-replay-controller.mjs; ../scripts/active-owned-dirt-current-base-pr-marker-replay-repository-adapter.mjs; ../scripts/active-owned-dirt-current-base-pr-marker-replay.mjs"
runtime_proof: "../__tests__/active-owned-dirt-current-base-pr-marker-replay.test.mjs"
publish_policy: "Dev lifecycle reconciliation only; review, protected integration, Production release, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define one provider-neutral, marker-only replay after current-base reanchor response loss. -->

# Active owned dirt current-base PR marker replay

## Purpose

This controller closes one ordering gap in an already-authorized
`active-owned-dirt-current-base-reanchor`. That operation has durably reached
`pr-projected`: the cloud successor, local writer lease, local branch, remote
branch, pull-request head and pull-request base are already at the sealed
current-base target. Its private reanchor journal has not reached `verified`
because the pull-request body still contains an older, otherwise recognized
target writer marker. The local writer lease is newer only through an ordinary
same-owner authority projection such as its heartbeat, expiry, or manifest
receipt.

This is not another reanchor and does not repair arbitrary pull-request bodies.
It proves that the durable reanchor intent, exact target lease, task capability,
Git state, pull-request identity and non-marker body all still agree, then
projects the one target writer marker before the original reanchor controller
re-enters terminal verification.

## Closed input topology

Read-only planning accepts exactly one topology:

- the original reanchor journal is external, private, digest-valid and exactly
  at `pr-projected` for the supplied task branch and session;
- its sealed plan names the same repository, branch, session, device, scope,
  pull request, target protected base and target lane revision that are live;
- local `HEAD`, the local task ref, remote task ref and pull-request head all
  equal that target lane revision, and the pull-request base equals the target
  protected base;
- the registered writer lease is `active`, admitted, current for that exact
  branch and session, and remains the same target authority named by the
  reanchor intent;
- its provider, ledger repository, target repository, declared write scope,
  mutation eligibility, claim subject, base, lane, manifest and non-integration
  state exactly match the successor authority sealed by the reanchor; only
  well-formed monotonic current-claim receipts, heartbeat and expiry may have
  advanced;
- review, delivery, completion, pre-claim continuation and park projections
  remain absent, while every recovery payload inherited from the source lease
  and the complete current-base reanchor annotation remain byte-equivalent to
  their sealed source and target invariants;
- the caller possesses the exact task capability bound by that target lease;
- the pull request remains open and draft, with the exact repository, node,
  number, URL, head ref, base ref and unchanged non-marker body remainder;
- the existing hidden marker is either the exact target marker or the one
  recognized stale target form sealed by the plan; and
- the worktree source, index, authored bytes and admitted path set are unchanged.

A historical source marker, unrelated active marker, foreign branch, session,
device, scope, claim, pull request or repository is not a recognized stale
target. Neither is an arbitrary projection with a coincidentally matching head.
Recognition is closed over the exact reanchor journal, source and target marker
digests, target lease digest, task binding and pull-request body remainder.

## Read-only plan and exact authorization

Planning takes one joined repository snapshot and requires a digest-sealed
evidence frame. The provider port itself stable-double-reads the pull-request
subject; execution re-observes the complete repository frame at every effect
boundary. Planning writes no repository object, ref, local registry, cloud
claim, pull request or journal. Every plan, journal, task-capability and output
artifact is isolated by resolved filesystem identity: it must remain outside
the source worktree, the Git common directory and every registered sibling
worktree. Existing inputs must be owner-private regular files. For a new plan
output, the existing parent is resolved before creation, so a parent symlink
cannot redirect the artifact into Git-owned topology. The CLI delegates plan
persistence to the adapter-owned canonical writer; that writer creates one new
owner-only file and rechecks the canonical parent plus a fresh registered-
worktree inventory immediately before writing, rather than trusting the CLI's
earlier path parsing and inventory snapshot. The recovery-journal
parent is likewise re-resolved against a fresh Git common-directory and
registered-worktree inventory before lock acquisition, before reads, and both
before validation and immediately before a write. A parent replacement or
symlink already present at one of those boundaries therefore fails before that
lock or file effect. Node's pathname operations are not directory-descriptor
anchored, so an adversarial same-UID process that replaces the private parent
inside the final boundary-check-to-open interval is outside this contract. The
repository-owned lifecycle requires cooperative single-writer ownership of the
external private parent for that interval; this controller does not claim
filesystem confinement against a concurrent same-UID pathname attacker.

The plan seals the original reanchor plan and intent digests, `pr-projected`
receipt, target lease and marker digests, recognized stale marker digest,
pull-request identity, source/head/base/tree evidence, body remainder, task
binding, evidence timestamp, expiry and the complete effect boundary. Execution
requires the byte-exact statement:

```text
authorize active-owned-dirt-current-base-pr-marker-replay <planDigest>
```

An authorization for the original reanchor, an older plan, another lane, a
broad completion instruction or a whitespace variation is not equivalent.
Before any provider effect, execution revalidates the plan twice under the
repository-owned fence, re-proves the task capability and rejects expired or
drifted evidence. That proof is required on every nonterminal invocation,
including a replay whose private journal already records `authority-verified`
or `provider-attempted`. Those phases are historical receipts, not possession
of current authority: a missing, dummy, revoked, replaced or incorrectly bound
capability still fails before pull-request projection with zero provider effect.

```sh
node scripts/active-owned-dirt-current-base-pr-marker-replay.mjs plan \
  --repository=<absolute-task-worktree> \
  --reanchor-plan=<external-reanchor-plan> \
  --reanchor-journal=<external-reanchor-journal> \
  --recovery-journal=<external-marker-replay-journal> \
  --output=<external-marker-replay-plan> \
  --ttl-seconds=300 \
  --json

node scripts/active-owned-dirt-current-base-pr-marker-replay.mjs run \
  --repository=<absolute-task-worktree> \
  --reanchor-plan=<external-reanchor-plan> \
  --reanchor-journal=<external-reanchor-journal> \
  --recovery-journal=<external-marker-replay-journal> \
  --plan-file=<external-marker-replay-plan> \
  --task-authority=<external-current-capability> \
  --authorize='authorize active-owned-dirt-current-base-pr-marker-replay <planDigest>' \
  --json
```

## Ordered effect and replay

The private operation journal advances through digest-linked compare-and-swap
phases. Its only provider effect is one exact writer-marker projection:

1. verify the sealed `pr-projected` reanchor intent and exact target lease, then
   freshly prove the current task capability even when resuming from
   `authority-verified` or `provider-attempted`;
2. observe the pull request twice and prove exact identity, head, base, draft
   state, body remainder and either stale-target or target marker;
3. when stale, replace only the hidden writer-marker span with the exact marker
   projected from the already-current local target lease;
4. read back the pull request and require the same identity, head, base, draft
   state and non-marker remainder plus the exact target marker;
5. verify that the local lease, task capability, Git refs, source state and
   original reanchor journal did not move; and
6. seal a terminal completion whose result digest is derived from the final
   target state rather than whether this invocation performed or adopted the
   provider write.

If the target marker is already present, the provider write is skipped and the
same terminal result is adopted. A retry after response loss observes that
target, finishes the missing journal phase and returns the identical result
digest. Ephemeral attempt counts, timestamps and stale-marker observations do
not enter that public terminal identity.

The operation does not update the original reanchor journal. After this marker
receipt is terminal, the unchanged original controller can re-enter at its own
`pr-projected` phase, observe the target pull-request marker and proceed through
its existing `verified` and `complete` phases.

## Provider-neutral projection

The controller depends on a narrow provider port: stable read, cooperative
marker projection and exact readback. The neutral contract requires a
whole-subject snapshot token, one intended body, one target marker and one
postcondition. It does not claim a provider-side compare-and-swap primitive
when the provider does not expose one.

The GitHub adapter uses the repository-owned cooperative pull-body projection.
It performs stable double reads of the same-repository pull request, verifies
the exact main-based subject and snapshot digest, arms one operation token,
writes the intended body through an owner-only temporary body file, then proves
the exact post-readback subject and body. The port truthfully reports
`providerAtomicCompareAndSwap: false`. Identity, head, base or body drift seen
before the final write or in exact post-write readback fails closed. A
non-cooperative whole-body writer that races inside that read/write window is
outside this guarantee, so the contract still requires cooperative single-writer
ownership; it is never described as atomic or strong conditional mutation.

Temporary files and directories are external, mode-restricted and cleaned on
success or failure. Their paths, attempt details and provider transport fields
are adapter evidence, not universal lifecycle semantics.

## Zero-effect rejection boundary

Before provider projection the adapter must reject:

- a different repository, pull-request node, number, URL, branch, head or base;
- an open-state or draft-state change;
- any non-marker body remainder change, additional hidden marker or malformed
  marker framing;
- an unrecognized marker identity or marker difference outside the sealed
  stale-target-to-target transition;
- any writer-lease digest, cloud subject, task binding, manifest, admitted
  write-set, branch, session, device, scope, fence, base, head, heartbeat or
  expiry change after planning;
- any provider, ledger repository, target repository, cloud-declared scope or
  mutation-eligibility change, any integration receipt/evidence, or any review,
  delivery, completion, pre-claim continuation or park projection;
- any replacement, widening or field drift in the inherited active-owned-dirt
  recovery payload or current-base reanchor annotation;
- a missing, replaced, revoked or incorrectly bound task capability;
- Git source, index, worktree, local-ref or remote-ref drift; or
- a changed, missing, advanced, foreign or completed original reanchor intent.

Every rejection reached before provider projection is zero-effect while the
repository and task remain under cooperative single-writer stability: no cloud
or ledger transition, local-registry write, Git object, ref update, source-byte
change, pull-request state change, review, merge, release, deployment or cleanup.
There is no atomic fence spanning local source, index, dirt, ref or reanchor
journal observation and the provider body write. A non-cooperative change after
the final pre-write validation can therefore be detected only by post-effect
readback or revalidation; the operation fails closed, but cannot claim that no
provider marker write occurred in that window. A provider response-loss path
may adopt only an exact target readback; it may not treat an ambiguous failure
or a different body as success.

## Completion and non-authority

Completion means only that the one pull request now carries the exact writer
marker already owned by the unchanged local target lease, and that a replay can
prove the same final state. It grants no new authoring, review, integration,
release or deployment authority. It cannot renew, recover, create, bind, retire
or otherwise mutate a cloud claim; change a local lease; move a local or remote
ref; alter source or authored bytes; mark the pull request ready; arm auto-merge;
merge; clean a worktree; or delete a branch.

## Focused verification

```sh
node --test __tests__/active-owned-dirt-current-base-pr-marker-replay.test.mjs
```

The focused proof covers exact planning and authorization, controller phase
order, the concrete `pr-projected` stale-target topology, one cooperative
projection, already-target adoption, response-loss replay with a stable result
digest, and zero-effect rejection for foreign pull-request identity, changed
body remainder, changed local lease and invalid task authority. It proves that
`authority-verified` and `provider-attempted` resumes re-check the live task
capability, and that every private input or output is rejected from the Git
common directory, the current or a sibling registered worktree, and a symlinked
output parent resolving into those locations. It covers canonical owner-only
plan creation and a parent-symlink swap immediately before the adapter write.
It also substitutes the recovery-journal parent with the Git common directory
and a registered sibling worktree after adapter construction, proving that
lock, read and write entry points all remain zero-effect.
The adapter matrix rejects every authority, integration, recovery, completion,
continuation and park widening before provider mutation while retaining the
intended monotonic heartbeat, expiry and current-claim receipts. It also asserts
that no cloud, local-registry, Git ref, source, review, merge, release,
deployment or cleanup mutation is exposed by the controller or adapter.
