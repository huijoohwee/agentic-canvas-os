---
title: "Claim-Only Mixed-Identity Pair Retirement"
graphId: "md:agentic-claim-only-mixed-identity-pair-retirement"
doc_type: "Recovery Controller Contract"
date: "2026-08-28"
lang: "en-US"
schema: "agentic-claim-only-mixed-identity-pair-retirement-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "one exact typed authorization for two claim-only cloud retirements"
runtime_scope: "read-only planning, waiting-successor retirement, then source retirement"
runtime_claim: "cloud coordination only; no source, Git, provider, release, or deployment mutation"
runtime_proof: "../__tests__/claim-only-mixed-identity-pair-retirement.test.mjs"
---
<!-- Responsibility: Retire one inert mixed-identity claim pair without inventing a shared owner. -->

# Claim-Only Mixed-Identity Pair Retirement

This controller closes one pair-bounded lifecycle gap. The source is an
expired, non-writing `dormant-preserved` reservation with no authored revision
or claim-bound local/provider association. Its exact direct waiting successor
is also expired and inert. The two entries have the same authenticated actor
and repository, but differ in at least one of work item, device, session, or
normalized write scope. No same-work-item fiction is introduced.

## Sealed planning evidence

Planning is read-only apart from a private mode-0600 journal outside every
worktree. It seals:

- both exact claim/genesis identities, fences, counters, predecessor edge, and
  canonical ancestry;
- actor and repository equality plus every equal and different identity field;
- each normalized scope and their complete union, intersection, source-only,
  successor-only, and semantic subsets with individual digests;
- exact pair-relevant overlap and zero claim-bound writer-lease, review-marker,
  or authored-revision associations; and
- the clean protected controller revision, runtime digest, and policy digest.

The observed ledger head and disjoint inventory are evidence, not a global
parity fence. Concurrent claims, refs, worktrees, leases, and pull requests
that remain disjoint and unassociated are classified `keep`. Any target claim,
predecessor, fence, counter, pair-relevant overlap, association, controller, or
policy drift fails closed.

The plan discloses that retiring the source releases its exact reserved scope
to current or future claimants. Terminal verification therefore proves both
exact retire entries, not global overlap emptiness.

## Effects and order

The immutable phase order is:

```text
authorized -> prepared -> waiting-successor-retired -> source-retired -> verified -> complete
```

Retiring the waiter first prevents it from becoming promotable while the
source reservation is removed. Before each compare-and-swap, the adapter
re-reads and reclassifies the exact subjects and obtains the fresh ledger head.
A disjoint head advance retries with the same semantic request and operation
key. Relevant drift blocks.

Each effect is one `retire` transition with reason `abandoned`. Deterministic
bytes, named-checks, and handoff digests bind the plan, phase, both claim IDs,
both exact scopes, and their full union. Lost responses are adopted only when
the terminal ledger entry, hashed operation key, semantic request digest, full
retired claim core, reconstructed operation receipt, and any returned
transport receipt join exactly.

No replacement claim is created. Source bytes, Git objects and refs, branches,
worktrees, writer leases, pull requests, integration, release, Production, and
deployment are outside the mutation boundary.

## Operation

After this controller is merged and the canonical controller checkout is clean
at protected `main`, create the private plan:

```sh
node scripts/claim-only-mixed-identity-pair-retirement.mjs plan \
  --repository=/absolute/target/repository \
  --target-repository=owner/repository \
  --source-claim-id=<source-sha256> \
  --waiting-successor-claim-id=<waiting-sha256> \
  --state-path=/private/pair-retirement.json \
  --json
```

Planning emits the sole accepted authorization:

```text
authorize claim-only-mixed-identity-pair-retirement <planDigest>
```

Execution requires that exact one-line statement in an owner-held mode-0600
file, plus the same arguments and `--plan-digest`. Broad approval is invalid.

## Proof boundary

Focused tests cover mixed-identity and scope disclosure, exact authorization,
waiter-first ordering, independent response loss, terminal replay, foreign
terminal rejection, refreshed-head disjoint retries, relevant drift, and the
two-retire-only completion receipt. Passing tests prove this Dev controller;
protected integration and the live typed authorization remain separate gates.
