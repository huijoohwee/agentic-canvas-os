---
title: "Merged Dormant Claim Reconciliation"
graphId: "md:agentic-merged-dormant-claim-reconciliation"
doc_type: "Runtime Contract"
date: "2026-08-10"
lang: "en-US"
schema: "agentic-merged-dormant-claim-reconciliation-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound reconciliation of a merged reviewed dormant cloud claim"
runtime_scope: "checkout-independent GitHub evidence, local intent CAS, dormant recovery, reviewed integration, and integrated retirement"
runtime_claim: "focused tests prove planning, exact authorization, crash replay, provider completeness guards, and repository-owned cloud action construction; live execution remains token-gated"
runtime_owner: "../scripts/merged-dormant-claim-reconciliation-contract.mjs; ../scripts/merged-dormant-claim-reconciliation-evidence.mjs; ../scripts/merged-dormant-claim-reconciliation-local-source.mjs; ../scripts/merged-dormant-claim-reconciliation-phase-evidence.mjs; ../scripts/merged-dormant-claim-reconciliation-controller.mjs; ../scripts/merged-dormant-claim-reconciliation-repository-adapter.mjs; ../scripts/merged-dormant-claim-reconciliation.mjs"
runtime_proof: "../__tests__/merged-dormant-claim-reconciliation-contract.test.mjs; ../__tests__/merged-dormant-claim-reconciliation-evidence.test.mjs; ../__tests__/merged-dormant-claim-reconciliation-controller.test.mjs; ../__tests__/merged-dormant-claim-reconciliation-repository-adapter.test.mjs; ../__tests__/merged-dormant-claim-reconciliation-cli.test.mjs"
publish_policy: "Dev-only; no deployment, cleanup, claim deletion, or raw ledger mutation authority"
---
<!-- Responsibility: define the receipt-bound merged dormant claim reconciliation runtime and proof boundary. -->

# Merged Dormant Claim Reconciliation

## Decision

A merged pull request does not implicitly retire its cloud claim. When the
reviewed claim has expired to `dormant-preserved`, the repository must prove
the original reviewed bytes, bounded protected-main refresh topology, protected
squash merge, required checks, protected-main containment, preserved local
lane, and exact historical cloud projection before it may propose a terminal
transition.

The only truthful terminal sequence is:

1. recover the exact dormant reviewed claim without authoring source bytes;
2. integrate the original reviewed candidate with the authorized dependency,
   check, handoff, and operator evidence;
3. retire the integrated-preserved claim with reason `integrated`; and
4. persist a receipt that joins every preceding digest.

No step deletes the worktree, recreates the remote branch, changes a checkout,
rewrites a commit, force-pushes, edits the ledger directly, or deploys.

## Evidence Boundary

The source worktree is read only. The ordinary mode proves its attached branch,
clean HEAD/tree, registered worktree record, writer lease, and the old fence's
ancestry to the reviewed head. The target repository is never opened or
switched locally. GitHub REST refs and immutable objects provide:

- the closed, non-draft, merged pull request and retained head identity;
- the original reviewed head and either its exact first-parent refresh chain to
  the final PR head or an exact direct PR-head identity with no refresh commit;
- two-parent protected-main refresh commits, including superseded intermediate
  refreshes, with every second parent contained by protected main;
- the actual one-parent squash commit, same tree as the final PR head, and its
  parent equal to the final refresh's protected-main parent or, for a direct
  merge, the reviewed claim's canonical base;
- complete PR and squash changed-path sets, all covered by the admitted claim
  scope;
- successful required checks on the original reviewed head, final PR head, and
  protected squash commit; and
- containment of the squash commit in the current protected `main`.

REST reads use an explicit API version. Check-run counts must be complete.
Changed paths are paged to their documented bounds; a full terminal page,
count mismatch, compare truncation, or provider drift fails closed.

### Completed-absent source mode

An exact historical source may have been correctly removed after its pull
request merged. In that case, a clean, registered checkout attached to current
`main` and equal to both its local `origin/main` and the live provider's
protected `main` is only a read-only repository anchor; it is not treated as
the historical lane. The adapter admits this mode only when all of the
following hold together:

- one completed writer lease projects the exact dormant cloud claim;
- its original worktree path is absent, unregistered, and not attached to its
  branch;
- its local `refs/heads/<historical-branch>` ref still exists and exactly
  equals the completed reviewed head;
- no other lease matches that branch, historical path, claim, pull request, or
  reviewed head, and no current reserved cloud claim overlaps the scope;
- its completion records the PR merge and a historic main revision, while
  provider reads prove `merge <= completion-main <= current protected main`;
  and
- the former remote branch remains absent.

The completed-absent proof uses the retained ref for the historical bytes and
never recreates a worktree, branch, or remote ref. A missing local ref or lease
is not a substitute for this proof: provider-only merged claims require a
separate reconciliation mode and remain blocked here.

## Plan and Exact Authorization

Planning is read only:

```sh
node scripts/merged-dormant-claim-reconciliation.mjs plan \
  --source-repository=/absolute/path/to/preserved-worktree-or-clean-main-anchor \
  --target-repository=owner/repository \
  --pull-request=738 \
  --claim-id=<64-character-claim-id>
```

The result contains `planDigest` and exactly one authorization string:

```text
authorize merged-dormant-claim-reconciliation <planDigest>
```

Execution requires both values from the same revalidated plan:

```sh
node scripts/merged-dormant-claim-reconciliation.mjs run \
  --source-repository=/absolute/path/to/preserved-worktree-or-clean-main-anchor \
  --target-repository=owner/repository \
  --pull-request=738 \
  --claim-id=<64-character-claim-id> \
  --plan-digest=<planDigest> \
  --authorize='authorize merged-dormant-claim-reconciliation <planDigest>'
```

Whitespace, digest, source, provider, claim, or ledger drift rejects the run.
Planning never accepts `--authorize`, and `run` never infers authorization from
an earlier console message.

## Crash and Response-Loss Recovery

The run is serialized by a token-bound entrypoint fence. A live PID excludes a
second runner; `EPERM` is treated as alive. A dead owner is recovered only by
atomically renaming the exact unchanged token before acquiring a new lock.
Release removes only the caller's token, so a replacement owner cannot be
unlinked accidentally.

The authorized intent and every phase receipt use a separate atomic file CAS.
Before recovery, while the intent is only `authorized` or `prepared`, the
adapter rebuilds the source/provider plan and requires its exact digest to
match the stored plan. Before and after each cloud effect, and after any thrown
response-loss error, the controller rehydrates the exact claim from the
immutable ledger ref/blob. It accepts a phase only when the live actor, owner,
claim, counter, fence, ledger, recovery, integration, retirement, and operation
evidence all match the authorized plan. An already-complete effect is replayed
without a duplicate transition; an ambiguous state remains blocked.

## Proof Command

```sh
node --test \
  __tests__/merged-dormant-claim-reconciliation-contract.test.mjs \
  __tests__/merged-dormant-claim-reconciliation-evidence.test.mjs \
  __tests__/merged-dormant-claim-reconciliation-controller.test.mjs \
  __tests__/merged-dormant-claim-reconciliation-repository-adapter.test.mjs \
  __tests__/merged-dormant-claim-reconciliation-cli.test.mjs
```

Focused tests are not live transition authority. A complete live result must
carry `agentic-merged-dormant-claim-reconciliation-receipt/v1`; cleanup and
deployment remain separate repository-owned gates.
