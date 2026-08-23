---
title: "Planned Device Projection Recovery"
graphId: "md:agentic-planned-device-projection-recovery"
doc_type: "Runtime Contract"
date: "2026-08-20"
lang: "en-US"
schema: "agentic-planned-device-projection-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized repair of one partial planned admission device projection"
runtime_scope: "read-only plan plus same-claim cloud, writer-lease, and draft-marker projection"
runtime_claim: "recovery proof only; authoring, review transition, integration, cleanup, and deployment remain gated"
runtime_owner: "../scripts/planned-device-projection-recovery-evidence.mjs; ../scripts/planned-device-projection-recovery-contract.mjs; ../scripts/planned-device-projection-recovery-cloud-adapter.mjs; ../scripts/planned-device-projection-recovery-repository-adapter.mjs; ../scripts/planned-device-projection-recovery-controller.mjs; ../scripts/planned-device-projection-recovery.mjs"
runtime_proof: "../__tests__/planned-device-projection-recovery.test.mjs; ../__tests__/dormant-preservation-decision-evidence.test.mjs"
publish_policy: "Dev-only; protected integration and deployment remain separately gated"
---
<!-- Responsibility: Document the only admissible owner-projection repair for a partial planned admission. -->

# Planned device projection recovery

This controller repairs one narrow response-loss state. A dormant cloud claim
has already been bound to a clean fence commit and open draft pull request, but
the local active `planned` writer lease and its hidden pull-request marker still
contain the preceding cloud-authority projection. The bound cloud claim uses a
different normalized device subject from the lease's branch device while the
session subject remains exact.

The controller does not grant authoring or mutation authority. After its
receipt, the repository-owned dormant-preservation admission must be planned
and exactly authorized again before source work begins.

The ordinary planned-review recovery joins a recovered cloud owner subject to
the lease through the same provider normalization boundary. A raw local device
or session label and its exact `device:` or `session:` pseudonymous subject are
equivalent only for that label; any other raw or opaque owner still fails
closed.

## Source conditions

Planning succeeds only when all of these conditions hold:

- the local lease is active, expired, task-bound, and `planned`;
- the target worktree, local branch, remote branch, and draft pull request are
  clean and exact at one fence-only commit whose tree equals the protected base;
- canonical `main` is clean and exact-current;
- the local cloud authority is the pre-bind projection at the protected base;
- the dormant cloud claim is exactly one transition later, names the same
  actor, repository, work item, base, write set, epoch, and session, and binds
  the fence plus the same draft pull request;
- the cloud claim device differs from the normalized branch device, and that is
  the only owner mismatch;
- no other reserved cloud claim overlaps the write set or review request; and
- the pull-request body contains exactly the source writer-lease marker.

Any source byte, Git ref, review identity, cloud subject, scope, or competing
reservation drift fails closed.

## Plan and run

Planning is read-only:

```sh
node scripts/planned-device-projection-recovery.mjs plan \
  --repository=/absolute/path/to/canonical-main \
  --worktree=/absolute/path/to/planned-worktree \
  --branch=agent/device/scope \
  --session=session:sha256-subject \
  --ttl-seconds=1800 \
  --json
```

The result seals the full source evidence and prints exactly one authorization:

```text
authorize planned-device-projection-recovery <planDigest>
```

Execution requires the unchanged plan file, that exact authorization, and the
task-authority capability already bound to the lease:

```sh
node scripts/planned-device-projection-recovery.mjs run \
  --repository=/absolute/path/to/canonical-main \
  --worktree=/absolute/path/to/planned-worktree \
  --branch=agent/device/scope \
  --session=session:sha256-subject \
  --plan-file=/private/external/plan.json \
  --task-authority=/private/external/task-authority.json \
  --authorize='authorize planned-device-projection-recovery <planDigest>' \
  --json
```

External plan and capability files must be private regular files outside both
repository worktrees.

## Effects and replay

The exact authorized effect set is:

1. Continue the same dormant claim in recovery mode, changing its device
   projection to the normalized branch device and advancing its transition once.
2. Compare-and-swap the same local writer lease to that recovered cloud
   authority and renewed expiry.
3. Replace only the hidden writer-lease marker in the same open draft pull
   request; visible review content is digest-checked unchanged.

The cloud request uses a plan-derived idempotency key. A rerun after response
loss replays that request, adopts an already-projected exact lease or marker,
and rejects any third state. Cloud status is checked in its public `current`
projection, while the independent admission verifier is checked in its
normalized `active` inventory projection; both must bind the same claim,
transition, fence, scope, expiry, review, and operation receipt. The terminal
receipt records whether effects were
projected or adopted and explicitly returns:

If that exact recovery result expires before its local lease and marker are
projected, replay adopts the historical idempotent operation receipt and checks
the same transition in its live `dormant-preserved` projection. This path makes
no second cloud transition: it projects the authorized expired authority into
the lease and marker so the ordinary planned fence-only recovery controller can
subsequently renew the same claim under its own exact authorization.

- `admissionStatus: planned`;
- `mutationAuthorityGranted: false`;
- `authoringAuthority: false`;
- `integrationAuthority: false`; and
- `deploymentAuthority: false`.

The forbidden effect set includes source bytes, Git refs, new claims, new
reviews, review state, integration, cleanup, and deployment.
