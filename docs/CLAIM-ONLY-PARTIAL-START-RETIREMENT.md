---
title: "Claim-Only Partial-Start Retirement"
graphId: "md:agentic-claim-only-partial-start-retirement"
doc_type: "Recovery Controller Contract"
date: "2026-08-24"
lang: "en-US"
schema: "agentic-claim-only-partial-start-retirement-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "two separately authorized claim-only cloud lifecycle repairs"
runtime_scope: "source-claim retirement followed by stale-successor rollover"
runtime_claim: "cloud coordination only; no source, Git, registry, review, deployment, or runtime mutation"
runtime_proof: "../__tests__/claim-only-partial-start-retirement.test.mjs"
---
<!-- Responsibility: Retire one inert claim-only partial start, then replace its stale waiting successor at current protected main. -->

# Claim-Only Partial-Start Retirement

## Purpose

This controller closes one bounded lifecycle gap without inventing a local
owner. The source is an expired, claim-only genesis entry: it has never
received a heartbeat, review, local writer lease, recovery, integration, or
authored revision. One direct non-writing waiting successor exists for the
same actor, repository, and device. Existing same-identity pairs retain their
exact work-item, session, base, and write-set contract. A mixed-identity pair
is eligible only for a bounded forward handoff: its work item, session, base,
and write set differ; its scopes overlap but are unequal; the successor adds
at least one source-absent scope; and the source base is a strict ancestor of
the successor base. Successor-subset, disjoint, and equal-scope pairs fail
closed.

The repair is deliberately split into two independently planned and authorized
transactions:

1. `claim-only-partial-start-retirement` retires only the inert source claim as
   `superseded` and preserves its direct waiting successor unchanged.
2. `claim-only-successor-rollover`, after the controller change is protected,
   retires the now-stale waiting successor before creating its epoch-2
   replacement at the exact current protected revision.

The split prevents a pre-integration successor from being promoted with an
obsolete canonical base. Neither operation edits source bytes, the index, Git
objects or refs, worktrees, writer registries, pull requests, provider state,
runtime state, Production, or deployment state.

## Exact source boundary

Read-only planning proves all of the following:

- the controller is clean, provider-protected `main` at exact fetched and
  remote parity;
- the configured target path is its exact Git top-level, retains one stable
  common directory, has an origin normalized to the requested repository,
  and matches two stable provider `nameWithOwner`/node-ID observations;
- the source has one v2 `claim` lineage entry, epoch 1, transition 1,
  heartbeat 0, base equal to lane revision, and no review, predecessor,
  recovery, integration, retirement, or evidence binding;
- the expired public source projection is `dormant-preserved`, non-writing,
  and still reserves its exact scope;
- the successor has one v2 `claim` lineage entry, is the sole direct
  `waiting-successor`, is epoch 1, transition 1, heartbeat 0, non-writing and
  non-reserving, and names the source as predecessor;
- source and successor use either the legacy exact-identity relationship or
  the mixed-identity relationship above; actor, repository, or device drift is
  never eligible;
- neither claim matches a writer-registry lease or pull-request marker;
- the exact canonical main contains both historical bases and mixed identity
  additionally carries positive evidence that the source base is a strict
  ancestor of the successor base;
- the source is the only reserved overlap and the successor is the only
  waiting overlap, with no higher-priority waiter; and
- Git refs, registered worktrees, the complete writer registry, and provider
  inventory are content-bound for preservation.

Execution requires a fresh double-read of that frame. It then advances:

```text
authorized -> prepared -> source-retired -> verified -> complete
```

The sole external effect is the authenticated retirement of the exact source
claim with reason `superseded`. Response loss is adoptable only when the
validated terminal entry cryptographically joins its claim identity, action,
operation key, request digest, and reconstructed operation receipt. Its final
revision, null review/integration receipt, and plan-derived bytes, named-checks,
and handoff digests must all match. Immediate success follows the same check.

## Exact rollover boundary

Rollover planning is available only after the source-retirement journal is
terminal and the controller revision containing this capability is protected.
It proves the prior receipt and terminal source entry, zero current source
projections, the unchanged direct waiting successor, its now-expired lease,
the absence of every local/review association, and a disjoint canonical-
descendant proof from the successor's historical base to current protected
main.

The replacement retains the successor's actor, repository, work item, device,
session, and normalized write set. Its exact identity is epoch 2, uses current
protected main as both canonical base and lane revision, and names the stale
successor as predecessor. The phase order is:

```text
authorized -> prepared -> stale-successor-retired -> replacement-claimed -> verified -> complete
```

The successful raw `claim` result is persisted verbatim to a new owner-only
JSON file. That file, rather than a status projection or normalized summary,
is the only admissible cloud-authority input for the later controller lane.
Claim-result persistence is part of completion: an absent, non-private,
symlinked, or conflicting output blocks the receipt.

## Authorization and replay

Each plan is immutable and emits one byte-exact statement. Retirement and
rollover are separate effects and therefore require two separate exact human
authorizations; authorizing either plan never authorizes the other. Broad
approval does not substitute for either statement:

```text
authorize claim-only-partial-start-retirement <planDigest>
authorize claim-only-successor-rollover <planDigest>
```

Keep journals, authorization files, the prior terminal journal, and raw claim
output outside every repository worktree with owner-only permissions. The
repository CLI accepts only absolute normalized paths and never accepts inline
authorization.

Plan and run the source retirement:

```bash
node scripts/claim-only-partial-start-retirement.mjs plan-retirement \
  --repository=/workspace/agentic-canvas-os \
  --target-repository=owner/repository \
  --source-claim-id=<sha256> \
  --successor-claim-id=<sha256> \
  --state-path=/private/claim-only/source-retirement.json \
  --json

node scripts/claim-only-partial-start-retirement.mjs run-retirement \
  --repository=/workspace/agentic-canvas-os \
  --target-repository=owner/repository \
  --source-claim-id=<sha256> \
  --successor-claim-id=<sha256> \
  --state-path=/private/claim-only/source-retirement.json \
  --plan-digest=<sha256> \
  --auth-file=/private/claim-only/source-authorization.txt \
  --json
```

After protected integration, plan and run the stale-successor rollover:

```bash
node scripts/claim-only-partial-start-retirement.mjs plan-rollover \
  --repository=/workspace/agentic-canvas-os \
  --target-repository=owner/repository \
  --source-claim-id=<sha256> \
  --successor-claim-id=<sha256> \
  --state-path=/private/claim-only/successor-rollover.json \
  --retirement-state-path=/private/claim-only/source-retirement.json \
  --claim-output=/private/claim-only/replacement-authority.json \
  --json

node scripts/claim-only-partial-start-retirement.mjs run-rollover \
  --repository=/workspace/agentic-canvas-os \
  --target-repository=owner/repository \
  --source-claim-id=<sha256> \
  --successor-claim-id=<sha256> \
  --state-path=/private/claim-only/successor-rollover.json \
  --retirement-state-path=/private/claim-only/source-retirement.json \
  --claim-output=/private/claim-only/replacement-authority.json \
  --plan-digest=<sha256> \
  --auth-file=/private/claim-only/successor-authorization.txt \
  --json
```

Every phase uses a content-bound operation key and a private compare-and-swap
journal. Terminal replay re-verifies the exact ledger outcome and preserved
surfaces; subject, controller, canonical, overlap, association, output, or
preservation drift fails closed.

## Proof boundary

Focused tests cover exact plan sealing, wrong authorization, genesis and
waiting-successor cardinality, legacy exact identity, mixed-identity forward
overlap and its subset/disjoint/equal/ownership/ancestry rejections, stale-base
descendant proof, phase ordering, adversarial receipt/entry response-loss
adoption, repository-identity drift, raw-output durability, replay,
absolute/symlink/private-file enforcement, and zero forbidden adapter calls.
Passing proof establishes only
this Dev coordination capability; protected integration, the two live exact
authorizations, later scope-expansion admission, Production, publication, and
deployment remain separate gates.
