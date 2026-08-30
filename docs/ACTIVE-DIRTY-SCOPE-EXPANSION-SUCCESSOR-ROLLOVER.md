---
title: "Active-dirty Scope-expansion Successor Rollover"
graphId: "md:active-dirty-scope-expansion-successor-rollover"
doc_type: "Recovery Controller Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-active-dirty-scope-expansion-successor-rollover-doc/v2"
frontmatter_contract: "required"
status: "focused-tested"
authority: "separately planned and exactly authorized retirement, replacement, and promoted-successor continuation"
runtime_scope: "retire one stale C2 waiter, replace it at current main, or continue the exact promoted C3 after a disjoint protected-controller repair"
runtime_claim: "coordination and owner-projection recovery only; authoring, commit, integration, cleanup, deployment, and Production remain separately gated"
runtime_owner: "../scripts/active-dirty-scope-expansion-successor-rollover-contract.mjs; ../scripts/active-dirty-scope-expansion-successor-rollover-continuation-contract.mjs; ../scripts/active-dirty-scope-expansion-successor-rollover-continuation-frame.mjs; ../scripts/active-dirty-scope-expansion-successor-rollover-bind-evidence.mjs; ../scripts/active-dirty-scope-expansion-successor-rollover-controller.mjs; ../scripts/active-dirty-scope-expansion-successor-rollover-repository-adapter.mjs; ../scripts/active-dirty-scope-expansion-successor-rollover.mjs; ../scripts/claim-only-partial-start-retirement-store.mjs"
runtime_proof: "../__tests__/active-dirty-scope-expansion-successor-rollover-contract.test.mjs; ../__tests__/active-dirty-scope-expansion-successor-rollover-continuation-contract.test.mjs; ../__tests__/active-dirty-scope-expansion-successor-rollover-bind-evidence.test.mjs; ../__tests__/active-dirty-scope-expansion-successor-rollover-controller.test.mjs; ../__tests__/active-dirty-scope-expansion-successor-rollover-repository-adapter.test.mjs"
---
<!-- Responsibility: Document sealed recovery and continuation from an obsolete scope-expansion successor. -->

# Active-dirty scope-expansion successor rollover

## Purpose

This controller repairs one narrow interrupted expansion. The dirty writer lane and its original C1
lease are still owner-bound. Its scope-expansion intent reached `source-retired`, and the direct C2
successor remains a non-writing `waiting-successor`. Protected `main` then advanced within C2's
admitted write set, so promoting or replaying C2 would bind obsolete canonical evidence.

The recovery preserves the source worktree, index, authored bytes, branch, ref, draft pull request,
and original expansion plan. It uses two independent plans and two exact operator decisions:

1. Phase A retires only the exact stale C2 waiting successor.
2. Phase B, available only after Phase A is durably terminal, claims and binds one corrected
   successor at current protected `main` using an externally supplied target manifest.

The split is an authority boundary. Phase A is irreversible cloud retirement, while Phase B depends
on a fresh protected-main observation. An authorization for either plan does not authorize the
other, and the controller never converts a broad approval into either token.

## Read-only inspection

`inspect` acquires no task capability and performs no recovery effect. It reports only the private
journal's phase, journal digest, and sealed plan digests, or `unplanned` when no journal exists.
Inspection is not live-subject evidence, authority, or a new claim reservation. The corresponding
planning command performs the fresh repository and cloud observation for each phase.

Planning double-reads its live evidence and fails closed unless the task subject stays stable. Each
read still validates the complete current ledger and its audit chain. The authorization projection
excludes only the ambient ledger revision, digest, and sequence, so unrelated disjoint transitions
cannot invalidate this task's plan. Among the required joins are:

- the source is the registered dirty writer worktree, with its exact session, branch, fence, lease,
  C1 claim, draft pull request, authored dirt, and `source-retired` expansion intent;
- the stale subject is the sole direct C2 `waiting-successor`, names C1 as predecessor, remains
  non-writing, and carries the exact superseded target manifest and write set;
- current protected `main` is clean, provider-current, and advanced within that stale C2 write set;
- no unrelated writer lease, review marker, or live cloud claim is adopted as the source; and
- source bytes, Git state, registry state, pull-request body, exact C1/C2 lineage, and protected
  controller are content-bound so task-relevant drift invalidates execution.

## Phase A: retire the stale waiter

`plan-retirement` seals the current C1/C2 identities, protected-main advance, source dirt, source
intent, lease, draft marker, claim-scoped cloud evidence, allowed effect, and preservation set. The
append-only ledger head remains transport and integrity evidence rather than a global semantic lock.
The plan emits the byte-exact statement:

```text
authorize active-dirty-scope-expansion-successor-rollover-retire <planDigest>
```

`run-retirement` re-reads the plan and live subject under the controller fences, validates a fresh
operation-specific task authority, and durably records the authorization before its sole lifecycle
effect. It retires exactly C2 and verifies the terminal cloud entry and operation receipt. Response
loss is adoptable only when the observed retirement joins the sealed claim, request, operation key,
transition, and ledger lineage.

Phase A does not change the source lease, source intent, writer registry, pull-request marker,
source bytes, index, commits, refs, branches, worktrees, deployments, or cleanup eligibility. Its
journal reaches `stale-successor-retired`; that terminal receipt is a prerequisite for Phase B.

## Phase B: replace and converge

`plan-replacement` is fail-closed until the same private journal proves terminal Phase A. It obtains
a fresh protected-main and stale-retirement observation, then validates the corrected manifest:

- the manifest is for the same semantic scope;
- its declared write set strictly expands C1's original set;
- it is a strict subset of retired C2's obsolete set;
- it covers every preserved authored path; and
- its digest and normalized write-set digest are sealed into the plan.

The second plan emits a new, independently typed statement:

```text
authorize active-dirty-scope-expansion-successor-rollover-replace <planDigest>
```

`run-replacement` revalidates the completed retirement, current protected main, corrected external
manifest, unchanged source dirt, lease, intent, and draft marker. It then converges these ordered,
operation-keyed effects:

```text
authorized
  -> replacement-claimed
  -> replacement-promoted
  -> replacement-bound
  -> local-cas
  -> pr-marker
  -> verified
  -> complete
```

The C3 replacement uses current protected `main`, the corrected manifest, and a null cloud
predecessor because the generic reducer cannot represent historical-predecessor continuity across a
changed write set. C1-to-C3 continuity is instead sealed by the Phase A journal, source intent,
operation-specific task-authority continuation, and custom local tombstone. The controller may
claim and promote C3, bind the existing review request, atomically
replace the local lease and terminalize the stale expansion intent, and replace the exact writer
marker in the existing draft pull request. It cannot edit source bytes, the index, Git objects or
refs, create a commit, push, merge, deploy, prune a worktree, or grant release authority.

Every effect is classified before and after invocation. A validated response-ahead state is adopted;
an absent or ambiguous effect remains blocked. Terminal replay re-verifies the live cloud, local CAS,
task-authority binding, and pull-request marker before returning the same sealed completion receipt.

## Promoted-successor continuation

`plan-continuation` is available only for an interrupted Phase B whose journal is durably
`replacement-promoted`. It does not create or promote another claim. Continuation frame and plan v2
distinguish an unchanged `promoted-unbound` C3 from a `bound-response-ahead` C3 whose cloud bind
succeeded but whose response never reached the journal. The bound mode is admissible only when C3's
complete claim-scoped history is exactly its sealed genesis claim followed by one canonical
`agentic-collaboration-continuation-receipt/v1` projection bind. That receipt must join the genesis
digest and counter, exact replacement-bound operation key and request digest, immutable owner, base,
lane, write set, epoch, and expiry, and the original review request. A heartbeat, promotion, repeated
projection, counter jump, foreign review, or any other suffix fails closed.

Both modes seal the unchanged owner, exact C3 claim, still-open draft review request at its historical
base, and a clean protected controller revision that is a strict, write-set-disjoint descendant of
C3's canonical base. The
historical-base proof permits only the existing claim-bound `continue` projection after the adapter
re-resolves that exact open draft pull request, branch, head, historical base, and review identity; it
does not weaken generic provider mutation mapping or authorize another review, branch, head, or base.
The repaired-controller identity is a dependency-closure content digest; protected HEAD ancestry is
proved separately, so a later disjoint main advance is accepted while controller-byte drift is not.

The continuation plan emits a third independently typed statement:

```text
authorize active-dirty-scope-expansion-successor-rollover-continue <planDigest>
```

`run-continuation` validates that exact statement and re-captures the complete pre-effect frame before
creating a separate external `0600` authorization sidecar. Only then does it resume the original
replacement controller with the original replacement plan and its already-journaled authorization.
Replay validates the sidecar-to-plan join and the journal's immutable promoted prefix, while allowing
the journal to have advanced monotonically through bind, local CAS, marker projection, verification,
or completion. A v1 plan or prior sidecar cannot authorize v2: every bound-response-ahead replan needs
a fresh plan, exact authorization, and exclusively created sidecar. Its allowed cloud action is only
`reconcile-exact-bound-replacement`; `replacement-bind` is explicitly forbidden, so neither effect
authorization nor a second bind may occur. Response-loss reconciliation joins the exact canonical
continuation receipt; verb-derived receipt-schema aliases are rejected.

The protected controller dependency closure includes the bind-evidence validator and
`claim-only-partial-start-retirement-store.mjs`, which constructs the canonical operation receipt.
Changing either dependency changes the repaired-controller digest and requires another fresh plan.
Continuation never authorizes source edits, a new claim, Git changes, integration, deployment, or
cleanup.

## External-file and output boundary

Run this controller from its protected checkout. The source repository and controller root must be
absolute real directories. The journal, sealed plans, task-authority capability, and corrected
manifest must be absolute paths outside both the source and controller worktrees. Symlink traversal
and path aliasing are rejected.

The journal, task authority, plan files, and continuation sidecar are owner-held, single-link, regular
files at exact mode `0600`. A plan or continuation sidecar is created exclusively; it is never
overwritten. The corrected
manifest is non-secret and can be `0644`, but it must be one external, regular, non-symlink file.
All external inputs must use distinct paths. The CLI never reads or prints task-capability bytes;
public failures redact credentials and local absolute paths.

Inspect the current recovery subject:

```sh
node scripts/active-dirty-scope-expansion-successor-rollover.mjs inspect \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --state-path=/absolute/private/recovery-journal.json \
  --json
```

Plan and run Phase A:

```sh
node scripts/active-dirty-scope-expansion-successor-rollover.mjs plan-retirement \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-operator-session> \
  --state-path=/absolute/private/recovery-journal.json \
  --output=/absolute/private/retirement-plan.json \
  --json

node scripts/active-dirty-scope-expansion-successor-rollover.mjs run-retirement \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-operator-session> \
  --state-path=/absolute/private/recovery-journal.json \
  --plan=/absolute/private/retirement-plan.json \
  --task-authority=/absolute/private/task-authority.json \
  --authorization='authorize active-dirty-scope-expansion-successor-rollover-retire <planDigest>' \
  --json
```

Only after Phase A is terminal, plan and run Phase B:

```sh
node scripts/active-dirty-scope-expansion-successor-rollover.mjs plan-replacement \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-operator-session> \
  --state-path=/absolute/private/recovery-journal.json \
  --corrected-manifest=/absolute/private/corrected-write-scope.json \
  --output=/absolute/private/replacement-plan.json \
  --json

node scripts/active-dirty-scope-expansion-successor-rollover.mjs run-replacement \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-operator-session> \
  --state-path=/absolute/private/recovery-journal.json \
  --corrected-manifest=/absolute/private/corrected-write-scope.json \
  --plan=/absolute/private/replacement-plan.json \
  --task-authority=/absolute/private/task-authority.json \
  --authorization='authorize active-dirty-scope-expansion-successor-rollover-replace <planDigest>' \
  --json
```

If Phase B stopped after promotion because the protected controller could not bind the historical
review base, first integrate the disjoint controller repair. Then plan and run the continuation:

```sh
node scripts/active-dirty-scope-expansion-successor-rollover.mjs plan-continuation \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-operator-session> \
  --state-path=/absolute/private/recovery-journal.json \
  --corrected-manifest=/absolute/private/corrected-write-scope.json \
  --replacement-plan=/absolute/private/replacement-plan.json \
  --output=/absolute/private/continuation-plan.json \
  --json

node scripts/active-dirty-scope-expansion-successor-rollover.mjs run-continuation \
  --repository=/absolute/path/to/preserved-dirty-worktree \
  --source-session=<source-session> \
  --pull-request=<number> \
  --operator-session=<distinct-operator-session> \
  --state-path=/absolute/private/recovery-journal.json \
  --corrected-manifest=/absolute/private/corrected-write-scope.json \
  --plan=/absolute/private/continuation-plan.json \
  --continuation-state=/absolute/private/continuation-authorization.json \
  --task-authority=/absolute/private/task-authority.json \
  --authorization='authorize active-dirty-scope-expansion-successor-rollover-continue <planDigest>' \
  --json
```

The same operator session and exact plan are required for each plan/run pair. Any protected-main,
manifest, claim, intent, lease, marker, authored-dirt, or preservation drift requires a new plan and
new exact authorization. Phase A retirement itself remains historical fact and is never undone.

## Focused proof and release boundary

```sh
node --test \
  __tests__/active-dirty-scope-expansion-successor-rollover-contract.test.mjs \
  __tests__/active-dirty-scope-expansion-successor-rollover-continuation-contract.test.mjs \
  __tests__/active-dirty-scope-expansion-successor-rollover-controller.test.mjs \
  __tests__/active-dirty-scope-expansion-successor-rollover-repository-adapter.test.mjs
npm run docs:check
```

Passing focused proof establishes only the bounded recovery runtime. Protected integration of this
controller, the two live exact authorizations, the later expanded-lane validation and release,
cleanup, production deployment, and public runtime proof remain separate lifecycle receipts.
