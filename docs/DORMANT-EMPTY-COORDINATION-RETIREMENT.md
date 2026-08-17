---
title: "Dormant Empty Coordination Retirement"
graphId: "md:agentic-dormant-empty-coordination-retirement"
doc_type: "Runtime Contract"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-dormant-empty-coordination-retirement/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact empty coordination lane retirement"
runtime_scope: "read-only planning, exact authorization, dormant claim retirement, draft pull-request closure, and replay verification"
runtime_claim: "Dev coordination only; no authoring, integration, release, cleanup, or deployment authority"
runtime_owner: "../scripts/dormant-empty-coordination-retirement-contract.mjs; ../scripts/dormant-empty-coordination-retirement-evidence.mjs; ../scripts/dormant-empty-coordination-retirement-controller.mjs; ../scripts/dormant-empty-coordination-retirement-repository-adapter.mjs; ../scripts/dormant-empty-coordination-retirement-store.mjs; ../scripts/dormant-empty-coordination-retirement.mjs"
runtime_proof: "../__tests__/dormant-empty-coordination-retirement.test.mjs"
publish_policy: "Dev-only; no Production, publication, or deployment authority"
---
<!-- Responsibility: Retire one proven-empty dormant coordination lane without adopting or deleting its source history. -->

# Dormant Empty Coordination Retirement

This controller closes one narrow lifecycle gap: an open draft coordination
pull request whose only commit is tree-identical to its parent, whose cloud
claim is dormant but still reserves scope, and whose local branch, worktree,
and writer lease are all absent.

The core contract is provider-neutral. Provider observations are normalized at
the repository adapter boundary. Opaque repository, review-request, actor,
claim, and receipt identities are joined exactly; the contract never infers
authority from a session string, pull-request number, expiry, or clean tree.

## Exact subject

Planning double-reads and seals all of these facts:

- the controller source is clean, protected, and equal to `origin/main`;
- the draft review belongs to the target repository, has no merge request,
  merge-queue entry, integration, or changed path;
- its head has exactly one parent and its head tree equals the parent/base tree;
- the hidden marker, review request, remote branch, head, base, actor, work item,
  write set, epoch, and transition join the dormant source claim;
- the source claim is non-writing, scope-reserving, nonintegrated, and not
  already retired;
- exactly one inert direct waiting successor is observed and remains unchanged;
- no matching local branch, registered worktree, or writer lease exists; and
- current protected main contains the empty commit's base.

Any ambiguity, extra parent, changed path, provider-body drift, local owner,
claim drift, waiting-successor drift, overlap, or controller drift blocks.

## Effects and ordering

The phase order is immutable:

```text
authorized -> prepared -> claim-retired -> pr-close-attempted -> pr-closed -> verified -> complete
```

The first effect is one authenticated, same-claim cloud retirement using the
sealed source transition and idempotency key. Only the exact retired target is
adoptable after a lost response. Before the second effect, the durable journal
records the exact close operation key while the review is still open. This is
an authorization fence, not proof that a provider call occurred. The
second effect closes the already-proven empty draft review. It does not edit its
body, title, base, head, labels, or review state. Closure response loss is
adopted only when the exact closed, unmerged target observation agrees. Because
the provider has no idempotent close receipt, an adopted/lost response reports
`providerMutation: false`; only a confirmed close response reports it as true.

The waiting successor is evidence, never an effect target. This operation does
not activate, retire, rewrite, or rebind it. A later repository-owned successor
transition must independently revalidate the retired predecessor.

Call-level `disposition` reports `projected` or `adopted`. Mutation booleans in
the completion receipt report cumulative confirmed effects of the sealed
transaction. Unattributable provider response loss is never claimed as a
mutation by this transaction.

## Closed mutation boundary

Allowed durable effects are exactly:

- retire the sealed dormant claim;
- close the sealed empty draft review; and
- create or advance the private replay journal.

Forbidden effects include source-byte, index, Git object, local or remote ref,
branch, worktree, writer-lease, waiting-successor, new-claim, new-review,
integration, merge, cleanup, deployment, and Production mutation.

The remote branch and empty commit remain durable historical evidence. This
controller does not delete or subsume them.

## Operation

Planning is read-only and produces an exact plan digest:

```sh
node scripts/dormant-empty-coordination-retirement.mjs plan \
  --repository=/absolute/protected/agentic-canvas-os \
  --target-repository=owner/repository \
  --pull-request=509 \
  --claim-id=<exact-dormant-claim> \
  --waiting-successor-claim-id=<exact-waiting-claim> \
  --state-path=/absolute/private/replay-intent.json \
  --json
```

Execution requires the exact returned statement:

```text
authorize dormant-empty-coordination-retirement <planDigest>
```

Replay uses the same arguments, state path, plan digest, and authorization.
Wrong authorization, a foreign journal, a third state, or any live-subject
drift fails closed before another effect.

## Proof boundary

Focused proof covers deterministic evidence, exact-key parsing, wrong and stale
authorization, tree and parent drift, review-marker drift, local-owner
appearance, claim and successor drift, cloud and review response loss, terminal
replay, cumulative dispositions, and zero forbidden calls. Passing proof is a
Dev contract result only; protected review and integration of this controller
remain separate repository lifecycle operations.
