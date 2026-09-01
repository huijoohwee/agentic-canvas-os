---
title: "Claim-Only Waiting-Bridge Reconciliation"
graphId: "md:agentic-claim-only-waiting-bridge-reconciliation"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-claim-only-waiting-bridge-reconciliation-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "two separately authorized claim-only cloud lifecycle repairs"
runtime_scope: "waiting-bridge retirement followed by existing-successor promotion"
runtime_claim: "cloud coordination only; no source, Git, registry, review, deployment, or runtime mutation"
runtime_proof: "../__tests__/claim-only-waiting-bridge-reconciliation.test.mjs"
---
<!-- Responsibility: Retire one exact waiting bridge, then promote its existing successor. -->

# Claim-only waiting-bridge reconciliation

This lane recovers one exact cloud-only chain without changing source bytes, Git objects or refs, worktrees, writer leases, pull requests, markers, releases, integrations, deployments, or cleanup state. It never creates a claim.

## Applicable chain

The planned inventory must prove three distinct v2 claims in one actor and repository:

- the anchor is the exact dormant, scope-reserving admitted claim retained by one exact open draft ownership pull request; its local writer-registry association may be either the one exact joined lease or absent, but an absent lease requires zero local claim, branch, and PR-URL collisions;
- the bridge is an expired, transition-1, heartbeat-0 `waiting-successor` whose predecessor is the anchor;
- the successor is an expired, transition-1, heartbeat-0 `waiting-successor` whose predecessor is the bridge;
- bridge and successor use the same device, have exactly one claim entry, and have no review, evidence, recovery, integration, retirement, writer-registry, or PR-marker association;
- anchor overlaps bridge, bridge overlaps successor, and anchor is disjoint from successor; and
- no foreign relevant or predecessor-connected live claim exists, and the successor is the bridge's sole live direct successor.

The immutable ledger may contain older direct siblings of the bridge only when each sibling is absent from the current claim inventory, has exactly one transition-1 `waiting-successor` genesis followed by one transition-2 `retired` entry with reason `superseded`, preserves its complete subject, scope, epoch, expiry, and predecessor, retires its genesis lane revision with null review and integration fields, and has no writer-registry or ownership-marker association. The complete direct-successor ID set is partitioned into that sorted terminal history set and the one sorted live successor ID. The history, entry, claim, and empty-association digests are sealed and rechecked before and after both cloud actions.

The registry digest, the complete provider inventory digest, and the exact association records are sealed. Provider inventory uses GraphQL pages of 100 with a 1,000-page ceiling. Missing totals, errors, incomplete envelopes, duplicate PR numbers or node IDs, repeated/nonadvancing cursors, malformed JSON or marker structure, duplicate raw marker claims, and a returned count different from `totalCount` all block. The anchor, bridge, selected successor, and every ledger-discovered direct sibling require canonical semantic marker parsing. A structurally unique JSON marker whose raw claim ID is unrelated to that protected set may remain in the complete inventory even when obsolete semantics make canonical parsing fail; its raw claim ID, body digest, marker digest, and `semantic-stale-unrelated` disposition stay sealed. This tolerance cannot hide a target or direct-sibling association.

The provider-only anchor bracket is exact: its sole marker claim and fence equal the dormant anchor, the marker branch equals the provider head branch, and marker lane, marker fence, and provider head all equal the anchor lane revision. The PR must remain open and draft. A local anchor lease, when present, must still join that PR number, branch, claim, and fence exactly.

Provider-marker absence is a bracketed observation before and after each cloud action. The cloud claims' `reviewRequestId: null` is the authoritative ledger fact; the design does not claim an impossible atomic transaction between GitHub PR inventory and the collaboration ledger.

## Phase A: bridge retirement

Planning creates a private CAS journal and emits the exact authorization:

```text
authorize claim-only-waiting-bridge-retirement <planDigest>
```

Its phases are:

```text
authorized -> prepared -> retirement-intent -> bridge-retired -> verified -> complete
```

The intent is journaled before the provider call. The only cloud request is:

```text
retire {
  claimId: bridge,
  expectedFenceRevision,
  expectedTransitionCounter: 1,
  expectedLedgerDigest,
  reason: "superseded",
  finalRevision: bridge.laneRevision,
  reviewRequestId: null,
  bytesDigest,
  namedChecksDigest,
  handoffEvidenceDigest,
  integrationReceiptDigest: null,
  deviceId,
  sessionId,
  idempotencyKey
}
```

The post-read must contain the exact operation-derived v2 retirement entry and reconstructed retirement receipt. The anchor and original successor, their histories, and all non-cloud projections remain byte-for-byte represented by their sealed digests.

## Phase B: existing-successor promotion

Phase B requires a different private journal and the terminal Phase A journal. Its plan binds the complete Phase A plan and result, the exact bridge retirement entry, and the terminal effect digest. It emits a separate authorization:

```text
authorize claim-only-existing-successor-promotion <planDigest>
```

Its phases are:

```text
authorized -> prepared -> promotion-intent -> successor-promoted -> verified -> complete
```

Before the intent is accepted, the adapter uses the canonical waiting-successor ordering (`eligibleSince`, ledger sequence, then claim ID) and an in-memory `applyCloudTransition` simulation. The bridge must be exactly retired, no reserved claim may overlap the successor, and the original successor must be first eligible.

The only cloud request is:

```text
continue {
  claimId: successor,
  expectedFenceRevision,
  expectedTransitionCounter: 1,
  expectedLedgerDigest,
  mode: "promote",
  ttlSeconds,
  deviceId,
  sessionId,
  idempotencyKey
}
```

The committed entry must be the exact simulated transition: transition 2, state `current`, predecessor unchanged, `eligibleSince` preserved, `promotedAt` equal to evaluation time, and expiry equal to evaluation time plus the sealed TTL. A later continuation or time-based dormant projection does not cause a second promotion: replay adopts the exact historical operation-key entry.

`--authority-output` is a private JSON wrapper containing a successful `agentic-cloud-collaboration-result/v1` continuation result, its reconstructed active claim, and operation receipt. It is accepted directly by the canonical admission `normalizeCloudAuthority` path.

## TOCTOU, response loss, and replay

Planning is a stable double-read. Under the private operation lock, preparation rereads the sealed subjects. Immediately before and after either cloud CAS, the adapter rereads and validates the ledger, full registry, complete paginated PR inventory, exact associations, refs, and worktrees.

If a provider response is lost, the controller adopts only an historical entry with the exact action, claim, hashed operation key, semantic request digest, transition, and reconstructed receipt. Execution metadata is recorded as either `projected` with `providerMutation: true`, or `adopted-response-loss` with `providerMutation: false`. That metadata and transport attempts are excluded from the terminal effect/result digest, so both paths seal the same final-state result.

Once `complete`, replay returns the sealed private result without reading current cloud or provider state. Phase B has no rollback path: if promotion becomes inapplicable, the exact retired bridge remains terminal and the run blocks.

## CLI

All state, authorization, retirement-journal, and authority-output paths must be absolute, distinct, private external paths outside the repository and installed controller worktrees. Authorization files must be owner-held regular files with mode `0600` and exactly one line.

```text
claim-only-waiting-bridge-reconciliation.mjs plan-retirement ...
claim-only-waiting-bridge-reconciliation.mjs run-retirement ... --plan-digest=... --auth-file=...
claim-only-waiting-bridge-reconciliation.mjs plan-promotion ... \
  --retirement-state-path=... --ttl-seconds=1800 --authority-output=...
claim-only-waiting-bridge-reconciliation.mjs run-promotion ... \
  --retirement-state-path=... --ttl-seconds=1800 --authority-output=... \
  --plan-digest=... --auth-file=...
```

Every mode also requires `--repository`, `--target-repository`, `--anchor-claim-id`, `--bridge-claim-id`, `--successor-claim-id`, and `--state-path`; `--ledger-repository` is optional but must resolve to the same repository identity.
