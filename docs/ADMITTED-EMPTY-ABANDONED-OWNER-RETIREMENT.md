---
title: "Admitted Empty Abandoned Owner Retirement"
graphId: "md:admitted-empty-abandoned-owner-retirement"
doc_type: "Recovery Controller Contract"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-admitted-empty-abandoned-owner-retirement-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded recovery for one expired planned fence-only owner"
runtime_scope: "cloud claim retirement, draft closure, and local lease release"
runtime_claim: "no source, ref, branch, worktree, authored-lane, or deployment mutation"
runtime_proof: "../__tests__/admitted-empty-abandoned-owner-retirement-controller.test.mjs"
---

# Admitted Empty Abandoned Owner Retirement

## Purpose

This controller retires one abandoned partial-start lane only when its entire
committed projection is a clean, registered, one-parent, zero-path coordination
commit. A separate authored lane is content-bound and must remain unchanged.
The controller is provider-adapted at the repository boundary; its contract,
state progression, authorization, and preservation semantics are provider
neutral.

The controller does not decide that a lane is abandoned. Planning seals the
exact expired owner, cloud claim, provider review, local lease, controller, and
authored-lane evidence into one durable private state file. Execution requires
the exact human authorization derived from that persisted plan.

## Closed Boundary

The subject must prove all of the following:

- one expired `planned` local lease and its exact expired cloud claim;
- no current write authority and one dormant scope reservation;
- one clean registered worktree and matching local and remote branch head;
- one empty coordination commit whose parent and tree equal the declared base;
- one open, unmerged, draft review for that exact head;
- one distinct registered authored lane with an unchanged state digest; and
- one clean protected controller revision equal to its fetched canonical ref.

The only effects are cloud-claim retirement, provider draft closure, and local
lease release. The subject worktree, local branch, remote branch, Git refs,
commit tree, and authored lane remain preserved. Cleanup is a separate,
recoverable, explicitly authorized lifecycle.

## Stable Authorization Transport

Planning requires an absolute private JSON `--state-path` and atomically stores
the immutable plan before returning it. Running loads that stored plan; it does
not re-plan timestamped evidence. Exact authorization is read from a private,
regular, one-line `--auth-file`, avoiding shell tokenization of the human reply.

```bash
node scripts/admitted-empty-abandoned-owner-retirement.mjs plan \
  --repository=/workspace/repository \
  --subject-worktree=/workspace/empty-subject \
  --authored-worktree=/workspace/authored-source \
  --target-repository=owner/repository \
  --pull-request=123 \
  --claim-id=<sha256> \
  --state-path=/private/recovery/retirement.json \
  --json
```

After an authenticated human supplies the plan's exact reply, store that single
line in a mode-`0600` file and run:

```bash
node scripts/admitted-empty-abandoned-owner-retirement.mjs run \
  --repository=/workspace/repository \
  --subject-worktree=/workspace/empty-subject \
  --authored-worktree=/workspace/authored-source \
  --target-repository=owner/repository \
  --pull-request=123 \
  --claim-id=<sha256> \
  --state-path=/private/recovery/retirement.json \
  --plan-digest=<sha256> \
  --auth-file=/private/recovery/authorization.txt \
  --json
```

Every phase is compare-and-swap persisted. A response-loss retry classifies the
durable cloud, provider, or lease result before repeating an effect. Drift in
the subject, authored lane, controller, provider identity, claim fence, or local
lease blocks further mutation.
