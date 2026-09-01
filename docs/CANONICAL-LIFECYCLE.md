---
title: "Canonical ADLC Lifecycle"
graphId: "md:acos-canonical-adlc-lifecycle"
doc_type: "Lifecycle Contract"
date: "2026-09-01"
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
- The remotely addressable branch plus its pull request is the claim. Local ADLC
  lane records are a cache and never grant authority.
- Required checks run on the exact published head. The provider owns landing
  order through merge queue or auto-merge with strict up-to-date disabled.
- A queued lane is never author-restacked for ordering. One restack is permitted
  only after one provider ejection.
- Integration is computed from ancestry, a byte-exact `Source-Head` trailer,
  patch identity, or squash identity. A green check or closed pull request alone
  is not integration proof.
- Retirement follows proof. It removes only the exact clean registered
  worktree and exact branch and refuses owned untracked paths.
- Dirty, untracked, ambiguous, or concurrently owned bytes are preserved. No
  stash, reset, force checkout, force push, broad prune, or inferred ownership
  is an ADLC recovery operation.

## Commands

```sh
npm run doctor
npm run lane -- <scope>
npm run land
npm run status
npm run reap
npm run reap -- --apply
npm run queue:show
```

The retained `scripts/worktree-lifecycle.mjs`,
`scripts/device-branch.mjs`, and
`scripts/scoped-lane-admission-state.mjs` names are compatibility shims. They
delegate to ADLC or return observational Git state; they do not recreate legacy
writer authority.
