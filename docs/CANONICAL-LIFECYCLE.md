---
title: "Canonical ADLC Lifecycle"
graphId: "md:acos-canonical-adlc-lifecycle"
doc_type: "Lifecycle Contract"
date: "2026-09-02"
lang: "en-US"
schema: "acos-canonical-adlc-lifecycle/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
<!-- Responsibility: Bind ACOS authoring, integration, and retirement to the pinned agentic-os ADLC harness. -->

# Canonical ADLC Lifecycle

`agentic-os` is the lifecycle owner. ACOS consumes the exact commit pinned as the
`agentic-os` package in `package-lock.json`; ACOS does not own a second claim,
lease, recovery-scenario, or integration state machine.

The lifecycle is:

```text
planned -> active -> published -> queued -> integrated -> retired
```

One row in the ADLC transition table represents a scenario. Adding a
controller/adapter/evidence/store family for one incident is forbidden.

## Invariants

- `main` is the read-only runtime and synchronization owner. Authoring happens
  only in one registered `agent/<device>/<scope>` worktree created from fetched
  `origin/main`.
- The remotely addressable branch plus its pull request is a review projection,
  never an authenticated claim. Local ADLC lane records are a cache and never
  grant authority.
- Required checks run on the exact published head. The provider owns landing
  order through merge queue or auto-merge with strict up-to-date disabled.
- A queued lane is never author-restacked for ordering. One restack is permitted
  only after one provider ejection.
- Integration is computed from ancestry, a byte-exact `Source-Head` trailer,
  patch identity, or squash identity. A green check or closed pull request alone
  is not integration proof.
- Proof establishes cleanup eligibility but never grants cleanup authority.
  ACOS's committed profile retains every cleanup effect, so all worktrees,
  branches, refs, and objects remain preserved until a target-specific
  authenticated cleanup receipt authorizes one exact retirement.
- Dirty, untracked, ambiguous, or concurrently owned bytes are preserved. No
  stash, reset, force checkout, force push, broad prune, or inferred ownership
  is an ADLC recovery operation.

## External Recovery Authority

ACOS's manual authority workflow is a thin, optional GitHub adapter over the
provider-neutral lifecycle contracts in the pinned `agentic-os` package. It
contains no product-specific recovery controller and accepts a target only
within the committed same-owner repository prefix.

The provider re-observes the workflow event, human actor, first run attempt,
canonical ref and revision, workflow ref and revision, and static policy.
Issuance validates and binds the exact Recovery Candidate plus the Coordination
Request's single canonical effect-plan digest reference; it does not fetch or
attest plan bytes. A consumer must resolve those bytes and prove their SHA-256
matches before spending the bootstrap. One active evidence ruleset has zero
bypass actors and exactly the `update` rule with
`update_allows_fetch_and_merge: false`, the `deletion` rule, and the
`non_fast_forward` rule. Creation restrictions, additional evidence rules or
rulesets, and every bypass actor fail closed. Publication is an absent-ref,
create-only compare-and-swap: one evidence ref names one one-parent child of the
observed ACOS main revision and changes only its exact authority-evidence path.
The publisher identity does not grant authority; a conflicting absent-ref winner
can deny availability but cannot authenticate a different issuance, while an
exact winner is only an idempotent replay.

A later consumer may spend the bootstrap only after obtaining the exact issuance
from the provider-authenticated workflow-run output, retaining the exact dispatch
payload and provider workflow run ID, and completing live provider revalidation
with a trusted current clock while `issuedAt <= now < expiresAt`. It must also
resolve the separately referenced effect plan to exact bytes whose SHA-256
matches the Coordination Request's canonical effect-plan digest. Structural JSON,
copied output, an evidence ref, or an unexpired timestamp alone is not authority.

Authenticated evidence authorizes only the named recovery bootstrap and exact
allowed effects in the separately resolved plan matching the request's
effect-plan digest. It grants no protected merge, deploy, release, claim
retirement, source detachment, cleanup, or authority for another repository,
candidate, epoch, ref, path, actor, or workflow run.

## Authenticated Completion Transitions

ACOS commits one canonical transition policy at
`.agentic-os/github-transition-policy.json`. It binds the exact ACOS authority
repository, `refs/heads/main`, `.github/workflows/adlc-transition.yml`, the flat
`refs/heads/adlc/authority/` evidence namespace, and an exact target allowlist:
ACOS, Agentic Commerce OS, and Knowgrph. Repository prefixes and targets selected
by the dispatch payload are not authority.

The transition Actions workflow is validation-only and read-only. Its only two
required string inputs are `operation_payload`, the exact canonical UTF-8 bytes,
and `operation_input_digest`, the lowercase SHA-256 of those bytes. The payload
is `{schema,request,plan,planByteDigest,predecessorIssuance}` and contains no
result fields. The complete two-input object stays within GitHub's 65,535
character limit. Its exact run name is
`ADLC transition <operation_input_digest> @ <workflow_sha>`. The validator reads
only the bounded event file and canonical committed policy and requires
`workflow_dispatch`, attempt one, identical checkout and workflow revisions,
and the exact repository, canonical ref, and workflow path.

Dispatch uses GitHub API version `2026-03-10` with
`return_run_details:true`. The controller retains the provider-returned run ID
and URLs and waits for that exact first-attempt run to complete successfully;
it never discovers authority by listing runs. The workflow token never
publishes, emits an authority result, or grants log or artifact authority.

After terminal validation, a local controller may use an authenticated `gh`
user credential. It first proves target Administration-read and ACOS
contents-write capability, then re-observes the exact run and publishes a
create-only canonical child at
`refs/heads/adlc/authority/<transition-coordinate>`. The coordinate is derived
only from authority repository, exact target repository, source claim, lease
epoch, and fence; it excludes the operation, request, plan, and run. Exact bytes
replay one winner, different bytes conflict, and a lost or non-201 create-ref
response is classified by an immediate exact read. The protected ref and all
provider records remain retained.

An integrate transition records an already completed protected integration; it
does not authorize merge. It live-revalidates the initial issuance, target
numeric repository and owner identity, exact PR head, completed checks, passing
non-bypassed rule suite, ruleset versions, permitted merge or squash method, and
canonical ancestry. Omitted bypass actors are unobserved, never evidence of
zero bypass. V1 rejects rebase because a one-parent result does not prove the
whole rebased chain. A retire transition sources and revalidates the exact
integrate winner, including authority and owner identities, scope, write set,
resource, candidate, and snapshot.

The deterministic authenticated transition receipt advances the lease by
exactly one and uses the immutable CAS coordinate as its result fence. Mutable
observation time is excluded from its semantic digest. Historical replay of an
exact winner may reconstruct the same receipt after expiry, but authorizes no
new effect.

## Future Cleanup Authorization

The current ACOS profile is retention-only. A later target-specific decision
may authorize one exact cleanup effect only after the record binds owner-led
recovery when needed, protected integration proof, claim retirement, clean
detachment, no-remaining-value proof, target-specific eligibility, and an
authenticated cleanup receipt. None of those records authorizes a different
target or effect.

The generic upstream executor can quarantine only when a future trusted,
committed profile explicitly opts into both the exact worktree projection and
its exact registration. Branches, recovery refs, reflogs, peer registrations,
objects, and every other cleanup target remain retained. ACOS's current profile
is byte-identical and contains no such opt-in.

Preservation and no-remaining-value records are local structural observations,
not independent provider credentials. Their exact digests are transitively
authority-bound by the live-authenticated retirement plan through the cleanup
plan bytes. Eligibility and execution both replay the exact integrate and
retire CAS winners live and require byte-identical deterministic receipts.

Execution re-observes profile, canonical revision, dirty inventory, worktree
administration, peers, refs, reflogs, and objects under explicit ceilings. It
holds the clone-common operation lock and rechecks the trusted clock immediately
before starting any effect. It journals, renames the exact projection into
clone-private quarantine, proves the missing registration is the exact one
authorized, then renames only that registration. These two renames are
crash-recoverable, not atomic. The executor never removes or prunes a worktree,
updates or deletes refs, runs garbage collection, deletes bytes, or quarantines
canonical. Partial or drifting coordinates remain retained and blocked.

## Commands

```sh
npm run doctor
npm run lane -- <scope>
npm run land
npm run status
npm run reap
npm run queue:show
```

The retained `scripts/worktree-lifecycle.mjs` and
`scripts/scoped-lane-admission-state.mjs` names are observation-only
compatibility shims. They derive canonical identity from the committed ADLC
profile and do not recreate writer or cleanup authority.
