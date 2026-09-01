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
matches before spending the bootstrap. Publication is create-only: one evidence
ref names one one-parent child of the observed ACOS main revision and changes
only its exact authority-evidence path. Creation uses the GitHub Actions
integration bypass; separate zero-bypass rules forbid update, deletion, and
non-fast-forward movement after creation.

Authenticated evidence authorizes only the named recovery bootstrap and exact
allowed effects in the separately resolved plan matching the request's
effect-plan digest. It grants no protected merge, deploy, release, claim
retirement, source detachment, cleanup, or authority for another repository,
candidate, epoch, ref, path, actor, or workflow run.

## Future Cleanup Authorization

The current ACOS profile is retention-only. A later target-specific decision
may authorize one exact cleanup effect only after the record binds owner-led
recovery when needed, protected integration proof, claim retirement, clean
detachment, no-remaining-value proof, target-specific eligibility, and an
authenticated cleanup receipt. None of those records authorizes a different
target or effect.

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
