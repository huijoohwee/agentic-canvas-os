---
title: "Same-claim dormant reviewed continuation"
graphId: "md:same-claim-dormant-reviewed-continuation"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-same-claim-dormant-reviewed-continuation/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact task-capability-bound same-claim recovery"
runtime_owner: "../scripts/same-claim-dormant-reviewed-continuation.mjs"
runtime_proof: "../__tests__/same-claim-dormant-reviewed-continuation.test.mjs"
publish_policy: "No source, pull-request, ref, merge, integration, runtime, or deployment mutation"
---

# Same-claim dormant reviewed continuation

This controller recovers one exact interrupted reviewed lane whose clean local
lease remains `review_ready` and admitted while its unique same cloud claim has
time-derived to `dormant-preserved`. The pull request must remain open,
non-draft, without auto-merge, and exact at the local and remote review head.
Its body marker must retain the predecessor task binding while the local lease
contains the typed partial-successor binding repair and its current continuation
binding.

Planning seals the claim, epoch, base, review head, write set, review request,
pull-request body and state, provider marker, local lease, and a separate active
operator lease. Run requires the plan's literal authorization and the operator
lane's external task capability. It writes a durable journal before invoking
same-claim cloud recovery, records the verified cloud result before local CAS,
then CAS-projects only the renewed cloud authority, expiry, and typed
`agentic-same-claim-dormant-reviewed-continuation-local-repair/v1` receipt into
the local writer lease.

The cloud primitive requires an active source projection, so the adapter
projects the sealed reviewed authority to `state: active` for that invocation
only. The primitive then verifies that the same claim, not a successor, returns
from the continuation. If provider classification immediately projects the
landed transition as non-authoring `reviewed`, a durable `cloud-attempted`
journal may adopt only its exact next transition, fence, operation receipt,
review request, head, write set, and ledger evidence. Local projection retains
the provider-reviewed authority and lease status
`review_ready`, `reviewHeadSha`, the current task binding, and the non-draft PR
preimage. This split restores cloud liveness without granting authoring
authority or weakening reviewed-state integration gates.

The operation does not edit the pull-request body or state, source bytes, Git
refs, merge state, integration state, or deployment state. The embedded local
repair records zero external effects; its separately sealed cloud-recovery
receipt accounts for the preceding same-claim continuation. Interrupted cloud
or local phases resume through the journal, and an identical terminal lease can
be adopted without replaying either effect only when its typed repair names the
same original sealed plan.

```sh
node scripts/same-claim-dormant-reviewed-continuation.mjs plan \
  --repository=<reviewed-worktree> \
  --authority-repository=<admitted-controller-worktree> \
  --pull-request=<number> --authority-session=<session> --json

node scripts/same-claim-dormant-reviewed-continuation.mjs run \
  --repository=<reviewed-worktree> \
  --authority-repository=<admitted-controller-worktree> \
  --pull-request=<number> --authority-session=<session> \
  --plan-file=<sealed-plan.json> \
  --authorize="authorize same-claim-dormant-reviewed-continuation <digest>" \
  --task-authority=<operator-capability.json> --json
```
