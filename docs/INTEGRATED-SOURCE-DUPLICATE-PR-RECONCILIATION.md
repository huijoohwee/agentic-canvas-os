---
title: "Integrated-Source Duplicate Pull Request Reconciliation"
graphId: "md:agentic-integrated-source-duplicate-pr-reconciliation"
doc_type: "Recovery Controller Contract"
date: "2026-08-26"
lang: "en-US"
schema: "agentic-integrated-source-duplicate-pr-reconciliation-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact closure of one duplicate pull request after byte-identical protected integration"
runtime_scope: "PR736 provider closure and its source writer-lease terminalization"
runtime_claim: "planning is read-only; an exact-authorized run changes only PR736 state and its local writer lease"
runtime_owner: "../scripts/integrated-source-duplicate-pr-reconciliation-contract.mjs; ../scripts/integrated-source-duplicate-pr-reconciliation-controller.mjs; ../scripts/integrated-source-duplicate-pr-reconciliation-repository-adapter.mjs; ../scripts/integrated-source-duplicate-pr-reconciliation.mjs"
runtime_proof: "../__tests__/integrated-source-duplicate-pr-reconciliation.test.mjs"
publish_policy: "Dev recovery only; no source, ref, cloud, merge, release, deployment, or cleanup authority"
---
<!-- Responsibility: define the exact integrated-source duplicate-PR terminal boundary. -->

# Integrated-Source Duplicate Pull Request Reconciliation

## Purpose

This controller handles one fixed duplicate: open draft PR736 retains source
commit `d6e0b51ee517d270ab1e5f08fc7dc4c905244b0f` and tree
`21d141c40bfa23bed22a98ce945b9eed688d46dd`, while merged PR735 already
integrated those exact bytes as protected squash
`f9cea12ecf8af5949a6ab54e8b96494d8850c441`. The original cloud claim
`2523a888a28f3e01b318c512c80ef5b4207357abe823782c4ec5a520fd8cc2af`
is already retired. A second merge would duplicate the same source rather than
advance protected `main`.

The only terminal effects are:

1. close PR736 without changing its body, hidden writer marker, head, base, or
   branch; and
2. compare-and-swap its exact local writer lease to `released`, retaining the
   evidence required to replay or audit that terminal result.

The `--checkpoint` input is the immutable, external legacy-bootstrap evidence
for the preserved source lane. It does not own source bytes, Git refs, provider
content, cloud authority, integration, release, deployment, or cleanup. The
adapter derives a distinct private durable run journal; neither planning nor
execution edits the legacy checkpoint.

## Exact Planning Boundary

Planning is read-only and joins all of the following into one content-bound
plan:

- PR735 is merged, its source head and tree equal the fixed source commit and
  tree, and its protected squash is contained by current `main`;
- PR736 is the one open draft duplicate at that same source commit and tree;
- the preserved source worktree is registered, clean, attached to its original
  branch, and byte-exact at the source commit and tree;
- the source lease, epoch, worktree, branch, PR, fence, task-authority public
  binding, and full writer-registry revision are unambiguous;
- the retired claim evidence names the exact fixed claim and no current cloud
  authority exists for it; and
- the stale PR736 body and hidden writer marker are digest-bound exactly so
  provider closure cannot be mistaken for marker repair.

The planning adapter receives no task-authority capability. Supplying a
locator on a planning command is tolerated for command-shape parity, but the
CLI discards it before adapter construction and does not open the file.
Planning writes neither the checkpoint nor the lease registry and performs no
provider mutation.

```sh
node scripts/integrated-source-duplicate-pr-reconciliation.mjs plan \
  --repository=/absolute/path/to/controller-worktree \
  --source-worktree=/absolute/path/to/planned-dirty-admission-recovery \
  --source-pr=736 \
  --integrated-pr=735 \
  --claim-id=2523a888a28f3e01b318c512c80ef5b4207357abe823782c4ec5a520fd8cc2af \
  --checkpoint=/absolute/external/legacy-bootstrap-checkpoint.json \
  --json
```

Persist the returned plan outside every repository worktree as an owner-only
mode-`0600` JSON file. The plan emits exactly one authorization string:

```text
authorize integrated-source-duplicate-pr-reconciliation <planDigest>
```

## Exact-Authorized Run

Execution requires the unchanged private task capability bound to the PR736
source lease, the exact stored plan, and the exact authorization text. The CLI
rejects a relative, in-repository, symlinked, non-owner, or non-`0600` task
capability or plan file. `--plan-digest`, when supplied, must equal the digest
inside the stored plan.

```sh
node scripts/integrated-source-duplicate-pr-reconciliation.mjs run \
  --repository=/absolute/path/to/controller-worktree \
  --source-worktree=/absolute/path/to/planned-dirty-admission-recovery \
  --source-pr=736 \
  --integrated-pr=735 \
  --claim-id=2523a888a28f3e01b318c512c80ef5b4207357abe823782c4ec5a520fd8cc2af \
  --checkpoint=/absolute/external/legacy-bootstrap-checkpoint.json \
  --task-authority=/absolute/external/task-authority.json \
  --plan-file=/absolute/external/reconciliation-plan.json \
  --plan-digest=<planDigest> \
  --authorize='authorize integrated-source-duplicate-pr-reconciliation <planDigest>' \
  --json
```

Before either effect, the controller revalidates the plan subject. Provider
closure is accepted only after readback proves PR736 closed and unmerged with
its stale body, marker, head, base, and branch unchanged. Local
terminalization is accepted only after a registry readback proves the exact
source lease is `released`. A response-loss retry uses the separate durable
run journal and live readback to finish only a missing effect; it never edits
the legacy checkpoint, repeats a completed effect, or widens the subject.

## Mutation-Closed Boundary

The controller preserves all of the following byte-exact and identity-exact:

- source commit `d6e0b51ee517d270ab1e5f08fc7dc4c905244b0f` and tree
  `21d141c40bfa23bed22a98ce945b9eed688d46dd`;
- the PR736 source branch, remote ref, registered worktree, index, and working
  tree;
- PR736 body, hidden marker, head, and base;
- merged PR735 and squash `f9cea12ecf8af5949a6ab54e8b96494d8850c441`;
- the retired cloud claim and collaboration ledger; and
- every unrelated writer lease, worktree, branch, pull request, and source
  file.

It performs no commit, checkout, staging, ref update, push, force operation,
merge, required-check bypass, protected-main change, cloud transition, release,
deployment, runtime action, branch deletion, worktree deletion, or cleanup.
Closing PR736 is provider state, not integration; releasing its local lease is
terminal coordination evidence, not authority to remove its preserved branch
or worktree.

## Proof Command

```sh
node --test __tests__/integrated-source-duplicate-pr-reconciliation.test.mjs
```

Focused tests prove only this fixed reconciliation contract. The resulting
terminal receipt grants no broader source, integration, Production, release,
deployment, or cleanup authority.
