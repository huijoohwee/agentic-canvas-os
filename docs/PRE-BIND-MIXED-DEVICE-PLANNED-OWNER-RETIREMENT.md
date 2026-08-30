---
title: "Pre-Bind Mixed-Device Planned-Owner Retirement"
graphId: "md:pre-bind-mixed-device-planned-owner-retirement"
doc_type: "Recovery Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned recovery for one exact pre-bind mixed-device planned owner"
---

# Pre-Bind Mixed-Device Planned-Owner Retirement

## Purpose

This controller retires one clean coordination-only lane whose cloud claim was issued under a raw device alias that differs only by case from the normalized local planned owner. It is a recovery boundary, not an authoring-equivalence rule. A successful retirement does not establish that the two device pseudonyms may author, continue, review, or integrate for one another.

The eligible subject is exact and immutable:

- one active local writer lease with `planned` admission;
- one current cloud `t1` claim, or its exact provider-time expired
  `dormant-preserved` projection, at the protected base before pull-request binding;
- one clean, registered worktree at the configured path;
- one single-parent fence commit whose parent is the base, whose tree equals the base tree, and whose changed-path set is empty;
- one open, unmerged draft pull request whose head, base, branch, repository, body marker, and provider node identity match the lease;
- one exact task capability matching the lease's task-authority binding;
- one explicit raw claim-owner device alias whose lowercase form is the normalized local owner, whose provider pseudonym is the embedded claim device, and whose normalized-owner pseudonym is different;
- one raw local session whose provider pseudonym exactly matches the embedded claim session.
- one explicit raw cloud work-item preimage whose provider pseudonym exactly
  matches the claim work-item, while the distinct local lease scope hashes to a
  different work-item identity.

The dormant case is not a generic expired-claim escape hatch. Its ledger source
must still be the same immutable `current` claim; provider projection alone may
change to `dormant-preserved`, `writeAuthority=false`, and
`scopeReserved=true` after expiry. Owner, session, repository, base, lane,
scope, write-set, claim, pull request, and empty fence topology remain exact.

Missing derivation, unrelated sessions, arbitrary device mismatches, casefold collisions, same-device subjects, and any claim, lease, task, provider, source, tree, ref, worktree, controller, or policy drift block without an effect.

## Effects and Preservation

The only allowed order is:

1. retire the exact embedded cloud claim as abandoned;
2. close the exact draft pull request without merging it or deleting its branch;
3. release the exact local lease with an exact registry compare-and-swap.

Source bytes, the index, commits, trees, local and remote refs, the branch, and the registered worktree remain byte-for-byte and identity-for-identity preserved. The controller does not merge, deploy, delete a branch, remove a worktree, rewrite a marker, or infer ownership from the mismatched device identities.

## Durable Execution

Planning reads the complete evidence twice and persists its sealed digest. Running requires the exact generated authorization string. The journal persists `prepared`, intent, and attempted phases before every effect. Each intent seals the exact operation key and a fresh task-capability authorization receipt. Effects are callable only from their persisted attempted phase.

After a response loss or restart, the controller reads the authoritative target. It adopts only an exact operation-key cloud retirement, the exact closed unmerged pull request, or the exact sealed released-lease projection. Adopted effects report `mutation=false`; they are never reported as newly projected. Ambiguous or foreign states block and are not retried. The private operation lock supports exact dead-owner recovery, and a complete journal is terminally reverified before replaying its receipt.

## Invocation

Keep the journal, capability, and authorization files outside repository worktrees and owner-only. Plan first:

```sh
node scripts/pre-bind-mixed-device-planned-owner-retirement.mjs plan \
  --repository=/absolute/path/to/canonical \
  --subject-worktree=/absolute/path/to/exact-planned-owner \
  --target-repository=owner/repository \
  --branch=agent/device/scope \
  --pull-request=123 \
  --claim-id=<64-hex-claim-id> \
  --claim-owner-device=<exact-raw-case-variant> \
  --claim-work-item=<exact-raw-cloud-work-item> \
  --task-authority=/private/task-capability.json \
  --state-path=/private/retirement-journal.json \
  --controller-root=/absolute/path/to/clean-protected-main \
  --json
```

Place the emitted exact authorization line in a private one-line file, then run with the same identity arguments plus `--plan-digest` and `--auth-file`. The raw claim-owner alias and raw work-item preimage are nonsecret but sealed into the plan, authorization, durable prepared receipt, terminal evidence, and completion receipt. They exist solely to reproduce the already-issued provider subjects for one-way retirement and establish no authoring equivalence.

## Proof Boundary

Focused proof is `node --test __tests__/pre-bind-mixed-device-planned-owner-retirement.test.mjs`. Repository integration still requires the normal protected review and squash workflow. This controller does not repair future starts; prevention belongs to the canonical start-authority owner and is intentionally outside this recovery lane.
