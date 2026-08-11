---
title: "Review-ahead projection recovery"
graphId: "md:review-ahead-projection-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-10"
lang: "en-US"
schema: "agentic-review-ahead-projection-recovery/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/review-ahead-projection-recovery.mjs"
runtime_proof: "../__tests__/review-ahead-projection-recovery.test.mjs"
---

# Review-ahead projection recovery

This controller repairs one interrupted review boundary: the registered source lane is locally
`active`, but already carries an exact reviewed head and `review_ready` cloud projection while the
matching cloud claim has expired into `dormant-preserved`. It never authors source bytes.

The read-only plan joins the source session, clean registered worktree, local/review/remote/PR heads,
admitted write set, repository identity, claim identity, review request, epoch, and expiry. A protected
review head may have clean local committed descendants only when an ancestry proof, bounded commit list,
exact changed-path set, tree, and binary diff are all bound and remain within the admitted scope. Any dirt,
identity drift, live authority, unknown state, or competing claim blocks before mutation.

```sh
node scripts/review-ahead-projection-recovery.mjs plan \
  --repository=<source-worktree> --branch=<agent/device/scope> \
  --session=<source-session> --json
```

Execution requires the plan's literal `authorize review-ahead-projection-recovery <digest>` value.
It preserves any bound local descendants, atomically projects the existing lease to `review_ready`, updates only the ownership marker, then
delegates same-session successor reclaim to `cloud-authority-handoff-controller.mjs`. Replays use that
controller's existing claim lineage; a retry after the local projection skips that completed phase and
does not create a second recovery protocol.

The handoff controller returns a receipt-shaped result with the successor identity flattened as
`successorClaimId`. The recovery result binds that public field directly; it does not depend on the
handoff controller's internal authority object.

```sh
node scripts/review-ahead-projection-recovery.mjs execute \
  --repository=<source-worktree> --branch=<agent/device/scope> \
  --session=<source-session> --authorize="authorize review-ahead-projection-recovery <digest>" --json
```

The result preserves the worktree, branch, commits, index, working tree, PR, admission scope, and
reviewed head. Cleanup, scope release, protected integration, source edits, and deployment are outside
this capability.

Focused proof:

```sh
node --test __tests__/review-ahead-projection-recovery.test.mjs
```
