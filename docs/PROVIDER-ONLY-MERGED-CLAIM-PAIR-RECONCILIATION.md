---
title: "Provider-Only Merged Claim Pair Reconciliation"
graphId: "md:agentic-provider-only-merged-claim-pair-reconciliation"
doc_type: "Runtime Contract"
date: "2026-08-29"
lang: "en-US"
schema: "agentic-provider-only-merged-claim-pair-reconciliation-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound reconciliation of one provider-only merged reviewed source and its direct waiting successor"
runtime_scope: "read-only provider and ledger planning, waiter-first cloud transitions, private intent CAS, and terminal double-read verification"
runtime_claim: "focused tests prove exact evidence joins, authorization, phase order, response-loss adoption, persistence resume, request construction, and fail-closed drift; live provider execution remains token-gated"
runtime_owner: "../scripts/provider-only-merged-claim-pair-reconciliation-contract.mjs; ../scripts/provider-only-merged-claim-pair-reconciliation-controller.mjs; ../scripts/provider-only-merged-claim-pair-reconciliation-evidence.mjs; ../scripts/provider-only-merged-claim-pair-reconciliation-repository-adapter.mjs; ../scripts/provider-only-merged-claim-pair-reconciliation.mjs"
runtime_proof: "../__tests__/provider-only-merged-claim-pair-reconciliation-contract.test.mjs; ../__tests__/provider-only-merged-claim-pair-reconciliation-controller.test.mjs; ../__tests__/provider-only-merged-claim-pair-reconciliation-evidence.test.mjs; ../__tests__/provider-only-merged-claim-pair-reconciliation-repository-adapter.test.mjs; ../__tests__/provider-only-merged-claim-pair-reconciliation-cli.test.mjs"
publish_policy: "Dev-only; no source, Git, pull-request, release, deployment, or direct-ledger mutation authority"
---
<!-- Responsibility: define the evidence, authorization, transition, and proof boundary for one provider-only merged claim pair. -->

# Provider-Only Merged Claim Pair Reconciliation

## Decision

A merged pull request does not by itself settle cloud coordination state. This
controller handles one narrower case that the preserved-source reconciliation
cannot truthfully admit: the original local lane, branch refs, commit object,
registered worktree, and writer lease are all absent, while the provider and
immutable cloud ledger still prove the exact reviewed source and its direct
waiting successor.

The controller is intentionally pair-bounded. It admits only:

- one `dormant-preserved` source whose recorded state is `reviewed`, whose
  scope remains reserved, and whose reviewed evidence has not been integrated;
- one `waiting-successor` claim with no authority or reserved scope, exactly
  the source claim as predecessor, the next lease epoch, and the same actor,
  device, session, repository, work item, base, lane, and write set; and
- no third current claim related by work item, pair lineage, or overlapping
  write scope.

If historical local authority is still present, use the preserved-source mode
owned by `MERGED-DORMANT-CLAIM-RECONCILIATION.md`. Absence is evidence for this
mode, not permission to synthesize a branch, checkout, lease, or claim owner.

## Sealed Evidence

Planning seals four joined evidence surfaces into one immutable plan.

### Controller

The executing repository must be clean on `main`, with `HEAD` exactly equal to
the live protected `origin/main`, and its normalized `origin` must be exactly
`huijoohwee/agentic-canvas-os`. The runtime digest binds the exact five
dedicated contract, controller, evidence, repository-adapter, and CLI files by
repository-relative path, Git blob SHA, and content digest. The protected
target's exact auto-delivery workflow path and enrolled controller revision
must join that protected controller revision.

### Cloud ledger

The adapter reads one immutable ledger ref and complete validated ledger blob.
The plan binds its revision, digest, sequence, validation digest, both exact
claims, both complete claim lineages, current inventory, and the digest of all
unrelated current claims. Source lineage begins with `claim`, continues only
through contiguous `continue` transitions, and ends at the reviewed source.
The direct waiter has exactly one genesis transition.

The initial inventory may contain unrelated claims. Ledger revision, digest,
sequence, and normalized unrelated inventory remain observation metadata, not
authorization identity: an append-only, provably disjoint observation may
change them without changing `planDigest` or its exact authorization. The plan
still exposes their current digests for audit. Any third pair-relevant claim,
pair transition drift, overlap, malformed disjoint entry, or non-append-only
change blocks the run.

### Provider

GitHub evidence must join the authenticated actor and repository to the source
claim and prove all of the following:

- one closed, non-draft, merged pull request targeting `main` in the same
  repository, with its retained head equal to the reviewed lane revision;
- one direct squash merge whose tree equals the reviewed head tree and whose
  sole parent equals the source canonical base;
- containment of that squash commit by current protected `main`;
- complete, equal pull-request and squash changed-path sets, every path inside
  the admitted source scope, plus the corresponding protected-main file
  objects;
- exact classic and ruleset required-check enrollment, live enforcement, and
  successful completed runs on both the reviewed head and squash commit; and
- absence of the remote head ref and any writer-lease marker in the pull
  request.

Truncated compare, rule, path, commit, or check evidence is not equivalent to
absence and fails closed.

### Local absence

The source repository argument is a read-only canonical anchor, not a recreated
historical lane. It must be clean on `main`, equal to its fetched
`origin/main`, equal to the provider's protected-main commit, and have an
`origin` normalized to the exact target repository. A missing, malformed, or
ambiguous origin is not accepted. The historical local branch,
remote-tracking ref, reviewed commit object, registered source worktree, and
matching lease must all be absent. A malformed lease registry or a failed Git
absence probe blocks; an operational error is never converted into absence.

## Plan and Exact Authorization

Planning performs no cloud transition:

```sh
node scripts/provider-only-merged-claim-pair-reconciliation.mjs plan \
  --source-repository=/absolute/path/to/clean-main-anchor \
  --target-repository=owner/repository \
  --pull-request=784 \
  --source-claim-id=<64-character-source-claim-id> \
  --waiter-claim-id=<64-character-waiter-claim-id> \
  --json
```

The result contains one `planDigest` and one accepted authorization statement:

```text
authorize provider-only-merged-claim-pair-reconciliation <planDigest>
```

Execution requires that exact statement and the digest from the same plan:

```sh
node scripts/provider-only-merged-claim-pair-reconciliation.mjs run \
  --source-repository=/absolute/path/to/clean-main-anchor \
  --target-repository=owner/repository \
  --pull-request=784 \
  --source-claim-id=<64-character-source-claim-id> \
  --waiter-claim-id=<64-character-waiter-claim-id> \
  --plan-digest=<planDigest> \
  --authorize='authorize provider-only-merged-claim-pair-reconciliation <planDigest>' \
  --json
```

`--ledger-repository` may select the repository-owned ledger and defaults to
`huijoohwee/agentic-canvas-os`. `--state-path` may select the private intent
journal; the default remains under the source repository's Git common
directory rather than in authored source. `--ttl-seconds` bounds only the
source recovery lease, is sealed into the plan, accepts 60 through 86,400
seconds inclusive, and defaults to 1,800 seconds.

Planning rejects `--authorize`. Running never infers authority and rejects a
missing or drifted plan digest, any byte change in the authorization statement,
and any stored authorization mismatch.

## Closed Transition Sequence

The durable state order is exact:

```text
authorized
  -> prepared
  -> waiter-retired
  -> source-recovered
  -> source-integrated
  -> source-retired
  -> verified
  -> complete
```

`prepared` proves that the planned source and waiter transitions remain in the
live ledger. The four cloud effects then occur in waiter-first order:

1. retire the waiter as `superseded`;
2. recover the source to reviewed state without authoring source bytes;
3. integrate the original reviewed source using the plan's dependency,
   checks, handoff, authorization, and operation evidence; and
4. retire the integrated source as `integrated`, carrying its reconstructed
   integration receipt.

Each transition uses the fresh claim fence, transition counter, and ledger
digest from an immediate read. Its semantic idempotency key is derived from
the plan-and-phase operation key. The pair-scoped target-repository tail may
contain only the four expected actions, claims, counters, semantic fields, and
hashed idempotency keys. Append-only entries proven disjoint from the pair may
interleave without invalidating the stable authorization.

`verified` performs two independent ledger reads. Completion requires the same
pair-scoped terminal digest across both reads, both exact retire transitions,
an append-only disjoint remainder, and the reconstructed source integration
receipt. `complete` seals those values into the terminal reconciliation
receipt.

## Crash, CAS, and Response-Loss Recovery

One token-bound entrypoint lock serializes a run. Any pre-existing lock blocks;
the adapter does not infer liveness or take over a supposedly stale owner.
Release removes only the caller's exact unchanged token.

The mode-0600 intent journal uses a separate lock, atomic rename, and
compare-and-swap on the full previous intent digest. It records `authorized`
and every contiguous phase before later work proceeds. A write that observes a
different prior intent blocks instead of merging histories.

Before every effect, the controller first observes whether that exact phase is
already complete. After every effect, including a thrown or lost response, it
re-reads live state. It adopts the phase only when the operation key, immutable
ledger entry, counter, complete semantic effect fields, evidence digest, and
integration receipt all join the plan. Pending or ambiguous state remains
blocked. On resume, every persisted phase is re-observed; same-phase operation,
evidence, or integration-receipt drift stops before the next effect.

A terminal replay validates the complete stored intent and receipt, rechecks
all live effect phases, returns the same receipt, and performs no duplicate
transition.

## Mutation and Release Boundary

The only authorized external mutations are the four repository-owned cloud
coordination transitions above. This controller does not edit source files,
create Git objects or refs, recreate a branch or worktree, modify a pull
request, push, merge, deploy, publish a mirror, or edit the ledger blob
directly. The private journal is coordination state and is never a source or
release artifact.

Passing focused tests does not authorize a live run. Protected integration of
this controller, the exact live plan, and the exact human authorization remain
separate gates. Production release and Cloudflare deployment are outside this
runtime.

## Proof Command

```sh
node --test \
  __tests__/provider-only-merged-claim-pair-reconciliation-contract.test.mjs \
  __tests__/provider-only-merged-claim-pair-reconciliation-controller.test.mjs \
  __tests__/provider-only-merged-claim-pair-reconciliation-evidence.test.mjs \
  __tests__/provider-only-merged-claim-pair-reconciliation-repository-adapter.test.mjs \
  __tests__/provider-only-merged-claim-pair-reconciliation-cli.test.mjs
npm run docs:check
```

The focused command proves the local contract and orchestration seams with
deterministic fixtures. It is not live-provider, deployment, or Production
proof.
