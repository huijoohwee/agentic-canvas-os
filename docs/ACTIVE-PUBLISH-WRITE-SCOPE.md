---
title: "Active Publish Write Scope"
graphId: "md:active-publish-write-scope"
doc_type: "Lifecycle Capability"
date: "2026-08-27"
lang: "en-US"
schema: "agentic-lane-admission-lease/v1"
frontmatter_contract: "required"
status: "source-ready"
authority: "Immutable admitted write-set containment"
runtime_owner: "../scripts/active-publish-write-scope.mjs; ../scripts/active-publish-prepared-base-rollover.mjs; ../scripts/device-integrate-lib.mjs"
runtime_proof: "../__tests__/active-publish-write-scope.test.mjs; ../__tests__/device-integrate.test.mjs"
---

# Active publish write-scope verification

Active publish successor recovery compares every path changed from the newly
observed protected base with the immutable admitted write-set. An admitted path
may name either one file or a directory subtree. A changed path is accepted only
when it equals an admitted path or is a descendant separated by `/`.

The verifier must not rebuild the admission manifest from individual Git diff
paths. Directory manifests intentionally normalize to a different digest than
their expanded file lists even when every changed file is owned. Exact manifest
and write-set digests remain immutable on the lease and cloud claim; the
successor check proves containment against that evidence.

Paths outside admission, prefix lookalikes, malformed paths, and semantic-scope
drift fail before successor mutation. Protected-main changes inherited by the
fresh base are excluded by the `currentBase..head` diff.

## Prepared intent after a protected-base advance

A successor subject keeps the authenticated remote protected head `P` separate
from the pull-request provider's asynchronously refreshed base snapshot `Q`.
Ordinary publication remains exact: `Q` must equal `P`. For a prepared v1
intent, historical `B` is the intent target; for v2, `B` is the embedded v1
target and `P` is the v2 target. Prepared recovery accepts `Q` only when it is
exactly `B` or `P`. An intermediate ancestor, another protected head, or any
other provider snapshot fails before cloud effects.

A prepared v1 successor intent can name historical pull-request base `B` when
the protected head advances to `P` before replay while the exact branch, local
head, remote head, draft pull request, and pull-request head remain `H`. The
controller may roll that intent to `P/H` without merging `P` into `H` only when
all of the following evidence is exact:

- the cloud inventory contains the unchanged current source claim and no
  successor derivative;
- `git merge-base --all P H` returns exactly `B`;
- every path in `B..H` remains contained by the immutable admission; and
- every path in `B..P` is disjoint from that admission.

The bounded, normalized path sets, their digests, `B`, `P`, `H`, the original
v1 intent digest, and the exact source-claim projection digest form a sealed
zero-effect rollover proof. A v2 intent embeds the complete v1 intent and that
proof. The writer-registry CAS must durably replace v1 with v2 before any cloud
successor effect. The controller then re-reads the clean worktree, local and
remote heads, pull request, protected base, source cloud claim, merge base, and
path proof before publication.

If the newly observed `P` object is not yet in the local object database, the
controller fetches only that exact advertised SHA with tags and `FETCH_HEAD`
updates disabled. It does not update the task branch or a tracking ref. The
object must then resolve as a commit, and the exact remote-main SHA, pull-request
base acceptance set, pull-request identity, heads, and clean worktree are
re-read before proof capture. No ancestry or merge-base proof against `P` runs
before that object is materialized. Fetch failure or any post-fetch drift
preserves v1 and stops before the rollover CAS.

The `/v2` proof seals `B`, `P`, `H`, path digests, the source-claim projection,
and the exact cloud-ledger head that must parent the successor claim. It does not
seal transient `Q`. The exact `B`/`P` acceptance set and every subject identity
are revalidated immediately before the v2 intent CAS, after that CAS before
cloud publication, and again before the local successor CAS. A provider-only
`Q` transition between `B` and `P` is therefore replay-safe, while a new
protected head `P2` requires separate recovery. The historical rollover proof
`/v1` shape remains parseable as immutable evidence, but it has no source-ledger
seal and cannot authorize publication; a durable intent carrying it requires
operator recovery before any cloud mutation.

The ledger seal does not require the global head to remain frozen forever. A new
successor claim may append only when the first ledger snapshot still has the
sealed head. After that claim commits, unrelated claims may advance the ledger.
A retry is accepted only as the exact idempotent claim entry whose
`parentDigest` equals the durable seal and whose action and semantic request are
unchanged. Any other head advance fails before another claim candidate is
created.

Prepared-base rollover also accepts its exact source claim when the cloud
controller has parked that claim as `dormant-preserved`. This exception is
limited to rollover validation: the claim must retain every sealed identity and
authority projection, report `writeAuthority: false`, and keep
`scopeReserved: true`. The already-validated dormant predecessor is carried
into the v2 successor resolver, which names that exact claim as the cloud
predecessor and may create exactly one `P/H` successor. A waiting-derivative
replay supplies the same derivative predecessor, preserving the original claim
idempotency lineage instead of joining whichever overlap is observed later.
Named-predecessor successors can therefore be waiting or promoted unbound at
`H`; legacy predecessor-implicit successors remain waiting or unbound at `P`.
Replay repeats a `P` waiter without a predecessor to preserve its legacy key,
and repeats an `H` waiter with its exact predecessor. Every v2 derivative,
including an unbound current claim or a claim already bound at `H`, must first
re-enter that sealed claim path and return an idempotent replay of the observed
claim ID's original waiting projection. The waiting projection must retain the
normalized device and session owner IDs of the source cloud authority. A raw
stored owner is pseudonymized once; an already normalized owner is retained.
Only then may the controller bind or verify the progressed claim. An unbound claim's
revision distinguishes implicit `P` from named `H`. A bound claim does not, so
recovery probes named `H` first and then implicit `P` only when the first probe
returns the exact caller-sealed stale-parent error. Any other first-probe error,
or failure of both shapes, fails closed.
Ordinary active publication continues to require an `active` or `current`
source claim and therefore cannot reopen a dormant claim.

If a v2 proof sealed the source while it was `current`, later expiry may project
that same claim as `dormant-preserved` without changing the proof. The
controller reconstructs only the deterministic pre-expiry projection: state
`current`, `writeAuthority: true`, and `scopeReserved: true`, and requires its
digest to equal the sealed source digest. The sealed digest is reused during
proof recapture; any other source-field drift fails before a cloud successor
effect.

The claim wrapper retires the source before the successor helper's next status
read. It uses the deterministic `legacy-review-supersede` key, the original
waiting-claim fence, exact succession evidence, and the source claim digest,
transition counter, lane revision, and review identity sealed by the durable
intent. The retirement result must be the exact released source transition. On
a progressed-derivative replay, this proves the historical retirement by
idempotently replaying it; a different key or a later same-ID fence cannot be
substituted. The successor claim legitimately advances the global ledger, so
retirement uses ordinary current-head CAS and does not inherit the old ledger
seal. A time-only current-to-dormant projection changes neither the ledger nor
the claim fence and remains governed by the sealed projection reconstruction
above.

Every active-publish successor status, mutation, and verification child receives
a cloned environment with all `AGENTIC_CLOUD_*` mutation overrides plus
`AGENTIC_TARGET_REPOSITORY`, `AGENTIC_DEVICE_ID`, and `AGENTIC_SESSION_ID`
removed. Credentials and unrelated environment entries are preserved. This
applies to pre-CAS proof reads and replay reads as well as later bind and verify
calls, so ambient process input cannot replace the durable request fields.

The one transitional exception is an exact `P` `waiting-successor` derivative
coexisting with the still-current sealed source after a lost provider response.
Replay validates both projections and resumes that one derivative. Multiple,
historical-`B`, wrong-target, or current/bound derivatives coexisting with the
source remain ambiguous and fail closed.

Loss of the rollover-CAS response is replayed from the identical durable v2
intent; it does not create another rollover. A historical-`B` derivative,
ambiguous lineage, path overlap, non-unique merge base, proof tamper, or subject
drift fails closed. Such a failure preserves the prepared intent and never
silently discards or retargets a partial cloud effect.
