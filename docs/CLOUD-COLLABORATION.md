---
title: "Cloud Collaboration Contract"
graphId: "md:agentic-cloud-collaboration"
doc_type: "Runtime Contract"
date: "2026-08-04"
lang: "en-US"
schema: "agentic-cloud-collaboration-contract/v2"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned provider-neutral claim and fencing contract"
runtime_scope: "Agentic Canvas OS collaboration reducer, typed ledger schema, provider adapter, and local lifecycle projections"
runtime_claim: "four root operations coordinate disjoint multi-device authoring while protected integration, Production, publication, and deployment remain separately gated"
runtime_owner: "../scripts/cloud-collaboration-contract.mjs; ../scripts/cloud-collaboration-primitives.mjs; ../scripts/github-cloud-collaboration-mapping.mjs; ../scripts/github-cloud-collaboration-adapter.mjs; ../scripts/cloud-collaboration.mjs"
runtime_proof: "../__tests__/cloud-collaboration-contract.test.mjs; ../__tests__/cloud-collaboration-cli.test.mjs; ../__tests__/github-cloud-collaboration-adapter.test.mjs; ../__tests__/cloud-collaboration-projection.test.mjs"
guideline_repository: "huijoohwee/huijoohwee.github.io"
guideline_source_revision: "8a2e5e0711f7193535b9aac2aee285e0ee705111"
guideline_source_tree: "63c13dcfb3ce01aa60213f4f6fa214bfa0e76778"
guideline_source_digest: "ff4f0dc41209bdacb05001b6fd5a450883736118f89fcff6fab331cedca8c2bd"
git_companion_digest: "c8831f6c6642f89c3e5f51af55523e1e4db1ed08b118840daa0d4f28289806e5"
publish_policy: "Dev-only; no protected integration, Production, publication, or Cloudflare authority"
---

# Cloud Collaboration

## Source Projection

This runtime projects the canonical JH guideline and its git companion at the
exact source evidence recorded in frontmatter. The source repository unit is a
strict dependency of this Agentic Canvas OS unit: JH guideline and checker
first, ACOS runtime, schemas, tests, docs, and dictionary registrations second.
Source drift invalidates this projection; branch names, timestamps, and local
copies cannot substitute for the pinned revision, tree, and digests.

## Four Root Operations

The provider-neutral authority surface contains exactly four mutations:

| Operation | Purpose | Typed receipt |
|---|---|---|
| `claim(scope)` | Request a normalized declared write set. A disjoint request becomes current; an overlapping request becomes a waiting successor. | claim receipt |
| `continue(claim)` | Renew, recover, project, preserve, or bind review evidence for the same authenticated claim without changing its identity. | continuation receipt |
| `integrate(candidate)` | Bind an immutable reviewed revision to dependency closure, named checks, handoff evidence, operator intent, and the integration candidate. | integration receipt |
| `retire(claim)` | End a claim only through an authenticated, compare-and-swap transition that carries the required preceding evidence. | retirement receipt |

Read-only status, verification, and event inspection are observations, not
additional root operations. Provider workflows, CLIs, lifecycle scripts, and
pull-request controllers must map to these four roots rather than expose a
second semantic transition vocabulary.

## Authority Invariants

- There is no global cardinality limit on concurrent authorities. Any number
  of authenticated claims may be current when their normalized write sets are
  pairwise disjoint. Per-request input bounds remain resource-safety limits,
  not a collaboration policy cap.
- Exactly one current claim has write authority for any overlapping declared
  write set. An overlapping newcomer is a non-writing waiting successor; it
  never races the current writer or manufactures a parallel fence.
- Successor selection is deterministic by eligibility, ledger sequence, and
  claim identity. Promotion rechecks overlap against the current ledger head.
- Expiry derives `dormant-preserved`. That state has no write authority, but it
  preserves the scope reservation and every authored byte. Expiry, a merged PR,
  a detached worktree, or a branch label never implies release.
- Recovery authenticates the same actor and claim against current cloud state,
  increments monotonically, and rechecks competing overlap. It is independent
  of an expired local lease, device identity, session identity, or worktree.
- Review request identity, reviewed revision, candidate revision, check
  evidence, and receipt digests are immutable once recorded. Changed evidence
  requires a new admissible operation, never a downstream rewrite.

`dormant-preserved` deliberately retains overlap. Operator-led continuation or
retirement is required before a waiting successor may receive write authority.
This fail-closed rule preserves ambiguous or temporarily offline owners without
confusing scope reservation with permission to write.

## Authenticated CAS Ledger

The repository-owned ledger is an append-only hash chain. Every mutation binds
the authenticated actor and repository, immutable claim identity, normalized
write-set digest, authority epoch, expected ledger digest, parent digest,
operation intent, resulting state, and typed receipt digest. The adapter reads
one exact ledger revision and advances it with a non-forced update. A losing
writer rereads and reevaluates; it cannot overwrite the winning transition.

Monotonic compare-and-swap applies to claims, continuations, candidate
integration, and retirement. An idempotent retry must reproduce the same
logical receipt, including across process and workflow reruns. Relative lease
duration is resolved once to a stable absolute expiry; each CAS retry uses the
new snapshot's server time and fails closed if that expiry has elapsed. Reusing
a replay key for different intent fails closed. The protected source ref and
exact pull-request subject are also re-resolved before every mutation attempt;
drift aborts the operation instead of authorizing a stale candidate.
Historical v1 entries remain immutable evidence; all newly authored entries use
the current four-operation schema.

The ledger stores no credentials, tokens, source bytes, diffs, prompts, raw
local paths, or low-entropy secret digests. Provider identity is authenticated
at the transport boundary. The GitHub adapter first resolves the token actor;
only an installation token denied that user endpoint may use a workflow actor,
and only from process-owned Actions context joined to the exact in-progress run,
repository, revision, and attempt. Request JSON cannot supply that trust root.
A receipt proves a bounded operation result; it does
not grant integration, release, publication, Production, or deployment beyond
the authority explicitly named in that result.

## State Model

| State | Write authority | Scope reservation | Allowed next root |
|---|---:|---:|---|
| `current` | yes | yes | continue (projection, renewal, review, or preserve), or retire |
| `waiting-successor` | no | queued request only | continue or retire; promotion occurs only after overlap revalidation |
| `reviewed` | no | yes | continue (renewal or identical review), integrate, or retire |
| `integrated-preserved` | no | yes | continue (renewal), or retire after exact original integration receipt verification |
| `dormant-preserved` | no | yes | continue (authenticated recovery), or retire |
| `retired` | no | no | none |

Only `current` can authorize source mutation. Review stops ordinary authoring.
Integration preserves evidence until an exact retirement transition. No state
in this table grants Production, publication, deployment, or cleanup authority.

## Replaceable Projections

Local worktrees, task branches, writer leases, pull requests, review labels,
workflow queues, device/session metadata, and provider-specific identifiers are
replaceable projections. They must join the current claim, epoch, normalized
write set, fence, immutable revision, and receipt before use. They may improve
recovery or ergonomics, but they never become a second authority source.

The current local lifecycle vocabulary is an outer projection only:

| Provider-neutral state | Local projection |
|---|---|
| `current` | `active` |
| `reviewed` | `review_ready` |
| `integrated-preserved` | `delivery_authorized` |
| `dormant-preserved` | `parked` |

Projection helpers must delegate to the root operations. A local heartbeat is
a continuation renewal; review binding is a continuation with immutable review
evidence; delivery authorization is an integration request with explicit
operator and dependency evidence. No helper may derive or invent absent
operator confirmation.

## Cross-Repository Coordination

A cross-repository coordination task is a dependency-ordered DAG of immutable
per-repository work units. Every unit retains its own repository, branch,
registered worktree, semantic scope, normalized write set and digest, claim,
authority epoch, fence, pull request, source revision and digest, named checks,
and handoff evidence. A shared task identity never creates a shared branch,
lease, fence, claim, pull request, or worktree.

Edges express integration dependencies, not shared authority. Dependency waves
may execute concurrently only when units have distinct repositories and their
declared write sets do not overlap under repository-aware path comparison. Each
unit obtains its own typed receipts and advances only after all predecessor
evidence is exact and immutable. See `INTEGRATION-ORDER.md`.

## Provider Reference Boundary

The GitHub reference adapter uses a protected collaboration ref, repository
Git-data APIs, workflow dispatch, exact-head checks, and non-forced ref updates.
Those details are transport projections. Another provider is conformant only if
it preserves authentication, append-only evidence, monotonic CAS, the state and
overlap invariants, immutable revision/review identity, and the four typed
operation receipts.

Offline work may continue only inside a previously admitted isolated worktree.
Offline state cannot claim, renew authority, promote a successor, integrate,
retire, push shared work, or prove runtime readiness. Reconnection requires a
live current-ledger verification before any shared mutation.

## Inspiration-Only Advisory

[External concurrency reference](https://github.com/yjs/yjs) is an inspiration-only reference for the
neutral ideas of concurrency and eventual reconciliation. Copying its code,
prose, schemas, tests, examples, algorithms, names, dependencies, imports, or
runtime behavior is forbidden; this contract has no external runtime reliance.

## Focused Proof And Gates

Focused proof must cover concurrent disjoint claims, one writer per overlap,
waiting-successor ordering, dormant preservation, lease-independent recovery,
review and revision immutability, authenticated actor mismatch, stale CAS,
cross-process idempotent typed receipts, hash-consistent queue forgery rejection,
projection equivalence, live-ledger migration, and cross-repository DAG
validation. Schema and documentation checks must agree with the executable
reducer and provider adapter.

Passing local checks proves only the bounded Dev contract at the tested source
revision. Protected integration, runtime publication, Production, Cloudflare,
and cleanup each remain closed until their separate owners provide exact
authority and evidence.
