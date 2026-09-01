---
title: "Release Workflow"
graphId: "md:acos-adlc-release-workflow"
doc_type: "Workflow Contract"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-release-workflow/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
<!-- Responsibility: Publish, integrate, prove, and retire one exact ADLC lane. -->

# Release Workflow

Release starts in the exact clean task worktree after its bounded checks pass.

```sh
npm run land
```

`land` pushes the lane, creates or reuses its pull request, records a
byte-exact `Source-Head` trailer, and hands ordering to the provider. Do not
direct-push `main`, raw-merge locally, repeatedly restack, or rewrite the
published head while checks are attached to it.

## Completion Order

1. Required checks pass on the exact pull-request head.
2. The provider merges through its protected path.
3. Re-fetch `origin/main`.
4. Compute integration proof against the exact published head.
5. Run `npm run reap` from the canonical checkout.
6. ACOS's committed profile retains every cleanup effect, so record the survey
   as eligibility evidence and preserve the lane.
7. A later target-specific decision may retire one exact worktree and its refs
   only after owner-led recovery when needed, protected integration, claim
   retirement, clean detachment, no-remaining-value proof, target-specific
   eligibility, and an authenticated cleanup receipt are recorded.
8. Synchronize a clean canonical checkout by fast-forward. If canonical bytes
   are dirty, reconcile only after every byte is proven target-equivalent or
   preserved by an explicit crash-safe transaction.

A merge commit, green check, clean worktree, or HTTP response is never a
substitute for the other receipts.

## Interaction Economy

Derive all available operands, surface all missing inputs at once, and validate
local constraints before provider mutation. Re-read volatile provider and Git
identity just before use. A compare-and-swap loss may be retried within its
bound; a deterministic rejection is repaired at its owner. Production,
publication, credentials, irreversible effects, and any authority-controlling
change remain exact-candidate operator decisions.
