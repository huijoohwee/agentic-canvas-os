---
title: "Reviewed successor projection response-loss recovery"
graphId: "md:reviewed-successor-projection-response-loss"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-reviewed-successor-projection-response-loss/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact task-capability-bound local and PR projection repair"
runtime_owner: "../scripts/reviewed-successor-projection-response-loss.mjs"
runtime_proof: "../__tests__/reviewed-successor-projection-response-loss.test.mjs; ../__tests__/reviewed-successor-projection-response-loss-repository-adapter.test.mjs"
publish_policy: "No source, cloud, ref, integration, release, cleanup, runtime, or deployment mutation"
---

# Reviewed successor projection response-loss recovery

This controller closes either of two exact interrupted cloud-handoff boundaries.
In `absent-predecessor` mode, the local clean `review_ready` lease and
pull-request marker still name an expired predecessor while the cloud ledger
contains exactly one `reviewed` successor created from it. In
`partial-local-successor` mode, the actual local lease and cloud inventory
already name that unique current or time-derived dormant successor, but the
task-authority binding still belongs to a reconstructed source lease made by
replacing only `cloudAuthority.claimId` with the successor's retained
`predecessorClaimId`.

An active partial-local successor may still be pre-review, with a null cloud
`reviewRequestId`, after a reviewed forward-child transaction intentionally
demotes the existing provider pull request back to draft. The controller binds
the provider pull request's node identity independently, requires the active
lease and successor to agree on the absent cloud review identity, and still
permits only the registry-local task-authority continuation repair.

Planning seals the authenticated repository and work-item identities, exact
branch/base/head/tree/write set, pull request and review request, source and
successor claims, lease epochs, transition evidence, local registry revision,
provider body digest, and task-authority binding. Any dirt, competing overlap,
head drift, integration authority, or non-successor lineage blocks read-only.
Provider marker head selection follows marker status rather than recovery mode:
`review_ready` markers seal `reviewHeadSha`, while active markers seal
`fenceSha`. A stale or changed status-specific head therefore fails closed.
Replay identity excludes both the fresh `observedAt` value and its derived
`evidenceDigest`; every authority-bearing field remains digest-fenced.
The repository adapter uses that same replay identity immediately before its
lease CAS, so a fresh observation timestamp cannot reject an otherwise exact
plan while any authority-bearing drift still fails before mutation.

Run requires both the plan's literal authorization and the existing external
task capability. In absent-predecessor mode it proves possession, creates the
continuation binding, CAS-projects the already-reviewed successor into the
local lease, and replaces only the pull-request ownership marker. In
partial-local-successor mode it atomically CAS-projects only the continued
`taskAuthority` and the typed
`agentic-reviewed-successor-partial-local-projection-repair/v1` receipt onto
the otherwise identical current lease. That second mode has no pull-request,
cloud, source, or Git effect. Replays accept only the identical terminal
projection and receipt.

```sh
node scripts/reviewed-successor-projection-response-loss.mjs plan \
  --repository=<worktree> --pull-request=<number> --session=<session> --json

node scripts/reviewed-successor-projection-response-loss.mjs run \
  --repository=<worktree> --pull-request=<number> --session=<session> \
  --plan-file=<sealed-plan.json> \
  --authorize="authorize reviewed-successor-projection-response-loss <digest>" \
  --task-authority=<external-capability.json> --json
```

The operation never claims, continues, reviews, integrates, retires, or edits
cloud state; never changes source bytes, commits, branches, or protected refs;
and grants no merge, release, runtime, cleanup, or deployment authority.
