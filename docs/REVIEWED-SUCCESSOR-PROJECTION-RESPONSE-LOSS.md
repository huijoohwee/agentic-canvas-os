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
runtime_proof: "../__tests__/reviewed-successor-projection-response-loss.test.mjs"
publish_policy: "No source, cloud, ref, integration, release, cleanup, runtime, or deployment mutation"
---

# Reviewed successor projection response-loss recovery

This controller closes one interrupted cloud handoff boundary. The local clean
`review_ready` lease and pull-request marker still name an expired predecessor,
while the cloud ledger contains exactly one `reviewed` successor created from
that predecessor. The predecessor is absent from the live inventory.

Planning seals the authenticated repository and work-item identities, exact
branch/base/head/tree/write set, pull request and review request, source and
successor claims, lease epochs, transition evidence, local registry revision,
provider body digest, and task-authority binding. Any dirt, competing overlap,
head drift, integration authority, or non-successor lineage blocks read-only.

Run requires both the plan's literal authorization and the existing external
task capability. It proves possession, creates the continuation binding, then
CAS-projects the already-reviewed successor into the local lease and replaces
only the pull-request ownership marker. Replays accept only the identical
terminal projection.

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
