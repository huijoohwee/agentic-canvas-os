---
title: "Scope Expansion Successor Projection Recovery"
graphId: "md:scope-expansion-successor-projection-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-15"
lang: "en-US"
schema: "agentic-scope-expansion-successor-projection-recovery-plan/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Exact source-retired scope-expansion successor projection"
runtime_scope: "One protected recovery from a source-retired predecessor to its current successor"
runtime_claim: "Focused Dev contract and adapter proof for exact authorization, journal replay, and projection fencing"
publish_policy: "Dev-only; no commit, push, merge, cleanup, deployment, or production authority"
runtime_owner: "../scripts/scope-expansion-successor-projection-recovery.mjs; ../scripts/scope-expansion-successor-projection-recovery-controller.mjs; ../scripts/scope-expansion-successor-projection-recovery-contract.mjs; ../scripts/scope-expansion-successor-projection-recovery-evidence.mjs; ../scripts/scope-expansion-successor-projection-recovery-repository-adapter.mjs; ../scripts/active-dirty-scope-expansion-successor-projection.mjs"
runtime_proof: "../__tests__/scope-expansion-successor-projection-recovery.test.mjs"
---

# Scope expansion successor projection recovery

This controller repairs one narrow interruption after an active dirty scope expansion retired its predecessor claim and promoted its waiting successor, but stopped before binding and projecting that successor locally. It is purpose-built for the repository-recorded source-retired checkpoint. It does not replay the original scope-expansion authorization.

The sealed decision subject joins:

- the clean protected controller revision and implementation digest, plus exact no-replace
  merge-base and changed-path proofs that the protected advance is ancestral and disjoint;
- the original source-retired intent and plan;
- the exact local predecessor lease, task binding, admission, and expired or live historical expiry;
- the draft pull request identity, head, body, and predecessor writer marker;
- tracked dirty paths plus their HEAD/index objects, file modes, sizes, and content digests;
- the exact interleaved predecessor-bound, successor-waiting, predecessor-retired, and successor-promoted ledger suffix; and
- one unexpired current successor with the exact actor, repository, work item, device, session, predecessor, base, head, declared write scope, transition counters, and absent review or integration authority.

Historical predecessor expiry is allowed because it grants no mutation authority. Successor expiry is rejected. Recovering an expired successor requires a separate same-claim authenticated recovery design.

## Plan and authorization

`plan` writes a mode-`0600` external plan and prints a new operation-specific authorization statement. The plan file, rather than a rebuilt observation, is the authorization subject used by `execute`. Execution performs a paired fresh capture and compares the stable sealed decision subject before writing its prepared journal.

```sh
node scripts/scope-expansion-successor-projection-recovery.mjs plan \
  --repository=/absolute/path/to/source-worktree \
  --source-session=<source-session> \
  --operator-session=<distinct-operator-session> \
  --pull-request=<number> \
  --output=/absolute/private/path/recovery-plan.json \
  --json
```

```text
authorize scope-expansion-successor-projection-recovery <plan-digest>
```

```sh
node scripts/scope-expansion-successor-projection-recovery.mjs execute \
  --repository=/absolute/path/to/source-worktree \
  --source-session=<source-session> \
  --operator-session=<distinct-operator-session> \
  --pull-request=<number> \
  --plan=/absolute/private/path/recovery-plan.json \
  --task-authority=/absolute/private/path/task-authority.json \
  --authorization='authorize scope-expansion-successor-projection-recovery <plan-digest>' \
  --json
```

The task-authority file remains external and is never stored in the plan, journal, lease, pull request, or output.

## Monotonic recovery

The durable journal advances through `prepared`, `task-authority-verified`, `promotion-adopted`, `successor-bound`, `local-cas`, `pr-marker`, `verified`, and `complete`. Every phase has an exact typed value shape, prior-intent link, operation key, and receipt digest.

Promotion adoption is observation-only. Successor binding uses the repository cloud controller. The shared atomic successor projector then replaces the predecessor admission, claim, and task binding under one writer-registry CAS while moving the original scope-expansion intent to `local-cas`. The pull-request marker and the original intent advance only after that atomic projection. Terminal proof revalidates the current cloud claim, mutation authority, unchanged bytes, task continuation, pull-request marker, and completed original intent.

Completion reports recovery receipts only. It grants no authority to commit, push, merge, clean a worktree, integrate a pull request, or deploy.
The recovered successor and source pull request remain anchored to the original canonical base;
the newer protected controller revision supplies recovery code, not refreshed integration authority.
NUL-delimited path and status evidence bypasses scalar-output trimming. The full decision subject is
rechecked immediately before cloud binding, and local plus pull-request subjects are rechecked after
the pull-request edit and immediately before the local intent CAS.
