---
title: "Active-dirty Scope-expansion Intent Supersession"
graphId: "md:active-dirty-scope-expansion-intent-supersession"
doc_type: "Runtime Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-active-dirty-scope-expansion-intent-supersession-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized archive-clear of one no-effect stale scope-expansion intent"
runtime_scope: "stable raw-ledger absence proof, non-forced identical-tree ledger-ref barrier, exact staged-byte evidence, and one writer-registry CAS"
runtime_claim: "Dev-only recovery proof; the coordination ref barrier is the sole remote effect, while heartbeat, expiry recovery, fresh scope expansion, integration, cleanup, and deployment remain separately gated"
runtime_owner: "../scripts/github-cloud-collaboration-ledger-ref-barrier.mjs; ../scripts/active-dirty-scope-expansion-intent-supersession-contract.mjs; ../scripts/active-dirty-scope-expansion-intent-supersession-repository-adapter.mjs; ../scripts/active-dirty-scope-expansion-intent-supersession.mjs"
runtime_proof: "../__tests__/github-cloud-collaboration-ledger-ref-barrier.test.mjs; ../__tests__/active-dirty-scope-expansion-intent-supersession.test.mjs"
publish_policy: "Dev-only; permits one identical-tree non-forced coordination-ledger commit/ref advance before local clear; no source-byte/ref, pull-request, ledger-payload, claim, lease, merge, cleanup, or deployment authority"
---

# Active-dirty scope-expansion intent supersession

This recovery clears one stale `scopeExpansionIntents[branch]` record only when
the record is still in its initial `status: "intent"` phase and no local,
pull-request, or cloud effect exists. It archives an immutable receipt in
`scopeExpansionIntentSupersessionReceipts[branch][sourceIntentDigest]` in the
same writer-registry compare-and-swap.

The recovery never creates a successor claim, retires a claim, changes the
writer lease, installs a replacement intent, edits the pull request, changes a
source Git ref, creates a source commit, pushes the source branch, merges,
cleans up, or deploys. Its one remote effect is a structured identical-tree
commit on `agentic/collaboration-ledger`, installed with `force: false` before
the local registry CAS. The ledger blob, decoded bytes, head digest, sequence,
and all claims remain unchanged. Source worktree and index bytes are captured
before planning and compared after both the barrier and local CAS, including
staged and unstaged blobs and executable modes. Untracked paths are rejected.

## Why archive and clear

An initial scope-expansion intent fences source heartbeats. If protected main
advances after that intent is persisted but before its first cloud request, the
sealed canonical-descendant proof is stale. The ordinary controller correctly
replays the sealed plan and fails protected-main validation. Installing another
intent as part of recovery would recreate the heartbeat fence and could strand
the lane at expiry.

This controller therefore has one universal mutation: archive the exact old
intent and clear its branch key. Replanning remains a separate ordinary
operation with a fresh protected-main proof and its own authorization.

## Preconditions

Planning and execution fail closed unless all of these facts join exactly:

- The controller runs from the executing module root on clean branch `main`,
  where `HEAD`, local `main`, `origin/main`, and live remote `main` are the same
  commit. These runtime files must first land through protected review; the
  controller must not be run from its authoring task worktree.
- The source is the registered worktree for the exact active writer-lease
  record, session, branch, task-authority binding, admission, claim, fence, and
  remote head.
- The exact source pull request is open, draft, based on `main`, and has no
  auto-merge request. Its node ID derives the exact cloud `reviewRequestId`, its
  head repository is the target repository rather than a fork, and its URL,
  number, branch, head, and writer marker equal the source lease without
  projection drift. Its exact `baseRefOid` is sealed by the captured
  protected-main advance: source base -> PR base -> current protected main, with
  the current protected tree and declared write-set digest joined exactly.
- The source intent has the canonical initial v1 fields. Its status is
  `intent`; target claim/review/receipt fields are null; and every later waiting,
  retirement, promotion, binding, local projection, pull-request projection,
  and final field is absent or null. Its full raw digest and sealed plan
  snapshot are bound into the recovery plan.
- The target manifest is the intent's exact target manifest and write set. It
  remains a strict expansion of the source admission and covers all tracked
  dirty paths.
- The old protected-main proof targets a commit different from current main,
  that target is an ancestor of current main, and a newly computed proof for
  current main is disjoint. The fresh ordinary scope-expansion plan digest must
  differ from the stale plan digest.
- Two authenticated raw collaboration-ledger ref/commit/contents/blob reads
  are identical and pass `validateLedger`. The latest source lineage remains a
  recorded-current, non-retired claim joined to the local claim digest and
  transition counter.
- The validated ledger contains neither the digest of
  `active-dirty-scope-expansion:waiting:<old-plan-digest>` nor any child claim
  linked to the source claim under a different idempotency key. This rules out
  exact response-ahead replay and foreign-key derivatives.
- A fresh second plan read immediately before mutation has the same plan
  digest. The controller creates a structured commit whose only parent is that
  sealed ledger revision and whose tree is byte-identical, then updates the
  protected ledger ref with `force: false`. It verifies the exact barrier (or a
  descendant) by ancestry, parent, tree, message, unchanged blob/raw/head
  digest/sequence, and another no-old-effect ledger analysis. Only the resulting
  exact barrier receipt permits the local CAS. After the barrier and before the
  local CAS, the controller re-reads and rejoins the protected controller,
  source worktree/HEAD/tree/remote, registry/lease/task binding, exact draft PR
  node/repository/head/base/auto-merge state, and projected hidden marker to the
  sealed plan. It then synchronously recaptures dirt/index evidence and performs
  the local registry CAS in one call, with no promise/microtask or provider read
  between that final byte proof and the CAS. Inside the registry lock, the
  registry revision/digest, lease digest, claim, and full raw intent digest must
  still match.
- `run` has the source task-authority capability and exact typed authorization.

If an already-prepared cloud transition wins first, the barrier is its sibling
and the non-fast-forward update loses, so no registry write occurs. If the
barrier wins first, that prepared sibling can no longer advance the ref. Any
retry must resolve the new ref and current protected main before constructing a
new transition. If any sealed fact changes, the operator must plan again.

## Command path

Run this only after the four runtime modules have merged to clean protected
main. Planning is read-only:

```sh
node scripts/active-dirty-scope-expansion-intent-supersession.mjs plan \
  --source-repository=<absolute-dirty-source-worktree> \
  --session=<source-session-id> \
  --pull-request=<source-pr-number> \
  --target-manifest=<absolute-expanded-write-scope.json> \
  --target-repository=<owner/repository> \
  --ledger-repository=<owner/repository> \
  --json
```

Review the complete output. Execution recomputes the same evidence twice and
requires both the printed digest and its exact authorization sentence:

```sh
node scripts/active-dirty-scope-expansion-intent-supersession.mjs run \
  --source-repository=<absolute-dirty-source-worktree> \
  --session=<source-session-id> \
  --pull-request=<source-pr-number> \
  --target-manifest=<absolute-expanded-write-scope.json> \
  --target-repository=<owner/repository> \
  --ledger-repository=<owner/repository> \
  --task-authority=<absolute-source-task-authority.json> \
  --plan-digest=<printed-plan-digest> \
  --authorize="authorize active-dirty-scope-expansion-intent-supersession <printed-plan-digest>" \
  --json
```

The task-authority file is read as a capability; it must not be copied into the
repository or command output.

## Expiry-safe continuation

The plan seals one of two dispositions. Crossing the boundary between them
changes the plan digest and forces a replan.

- `current`: after the clear receipt, renew the source heartbeat through the
  ordinary repository-owned heartbeat flow. Then produce and authorize a new
  ordinary active-dirty scope-expansion plan against current protected main.
- `dormant-preserved`: after the clear receipt, run the existing
  `expired-active-dirty-scope-expansion-recovery` controller. That controller is
  now eligible because the scope-expansion intent is absent. Once it restores
  current authority, produce and authorize a new ordinary active-dirty
  scope-expansion plan.

Neither continuation is performed by this command. In particular, successful
supersession is not authority to renew, recover expiry, create a cloud claim,
or execute the replacement scope expansion.

## Replay and receipt

The first successful run establishes the coordination barrier, removes exactly
the branch's old intent, and adds one append-only receipt, advancing the
writer-registry revision by one. The receipt binds the barrier revision,
ancestry, parent/tree/message metadata, payload identity, force-false policy,
and whether the ref effect was projected or adopted after response loss. The
source lease and all unrelated registry maps remain byte-equivalent.

If the response is lost, an exact retry finds the nested receipt only when the
branch intent is absent and the receipt joins the same plan, lease, claim, and
source-intent digest. It returns that immutable receipt with `replayed: true`
and does not advance the registry revision. A new or different intent rejects
replay.

The immutable receipt's `completionEffects` report the historical completion:
source bytes, index, source refs/commit/push, pull request, ledger payload,
claim, lease, replacement intent, merge, cleanup, and deployment were
unchanged, while the local registry CAS occurred. They separately preserve the
provider acknowledgements and the historical barrier disposition
(`projected`, `adopted-response-loss`, or provider-level `replayed`).

Every command response also carries digest-bound `attemptEffects`. On the
first completion these equal the historical completion effects. A stored
receipt replay performs no barrier read or mutation and therefore reports
`registryCasApplied: false`, `coordinationLedgerBarrierObserved: false`, both
acknowledgements false, and
`coordinationLedgerMutationDisposition: "not-attempted-stored-replay"`. It
does not infer a ref mutation from an absent response or present historical
acknowledgements as effects of the current invocation.
