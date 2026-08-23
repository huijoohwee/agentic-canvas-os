---
title: "Repeated expired committed heartbeat recovery"
graphId: "md:repeated-expired-committed-heartbeat-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-repeated-expired-committed-heartbeat-recovery-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact current task capability and content-bound operator authorization"
runtime_owner: "../scripts/repeated-expired-committed-heartbeat-recovery-contract.mjs; ../scripts/repeated-expired-committed-heartbeat-recovery-controller.mjs; ../scripts/repeated-expired-committed-heartbeat-recovery-repository-adapter.mjs; ../scripts/repeated-expired-committed-heartbeat-recovery.mjs"
runtime_proof: "../__tests__/repeated-expired-committed-heartbeat-recovery.test.mjs"
---

# Repeated expired committed heartbeat recovery

This controller closes one bounded gap after the ordinary expired committed heartbeat recovery has
completed, its exact renewed lease expires again, and the same clean committed descendant still
needs its original task owner and the original scope omitted exact authored paths. It never removes
or edits the predecessor receipt to manufacture a first recovery. The durable intent preserves that
receipt and replaces the defective claim with one strict-superset cloud successor.

Planning requires an exact registered worktree, attached branch, session, draft pull request,
remote head, clean committed descendant, expired admitted lease, task binding, first recovery
receipt, current protected-main controller, exact historical two-parent refresh, external target
manifest, and hidden writer marker. The target must preserve every source entry and cover every
authored path. Planning is read-only.

```sh
node scripts/repeated-expired-committed-heartbeat-recovery.mjs plan \
  --repository=/absolute/task-worktree \
  --session=exact-source-session \
  --pull-request=646 \
  --target-manifest=/absolute/external/expanded-manifest.json \
  --json
```

Execution requires both the original external `0600` capability and the planner's exact statement:

```text
authorize repeated-expired-committed-heartbeat-recovery <planDigest>
```

```sh
node scripts/repeated-expired-committed-heartbeat-recovery.mjs run \
  --repository=/absolute/task-worktree \
  --session=exact-source-session \
  --pull-request=646 \
  --target-manifest=/absolute/external/expanded-manifest.json \
  --task-authority=/absolute/external/task-authority.json \
  --authorization='authorize repeated-expired-committed-heartbeat-recovery <planDigest>' \
  --json
```

The only permitted effects are a waiting strict-superset claim, retirement of its exact predecessor,
successor promotion and review binding, one writer-registry/task-binding CAS, and replacement of the
existing hidden pull-request marker. No incomplete-scope lease is revived locally. The controller
creates no source change, commit, ref update, pull-request state change, merge, deployment, release,
or cleanup authority. Normal review and integration remain separate.

Successor binding uses the plan-sealed review request rather than asking the provider to re-resolve
the pull request's historical base. If the bind succeeds but its response is lost, replay may adopt
only the same claim in `active` state at exactly transition counter plus one, with the sealed target
scope, reviewed head, and review request identity. Any other transition or identity fails closed.
If that exact bound response-loss claim expires before replay, its public state may project only as
`dormant-preserved` at the same counter. Replay then derives recovery evidence from the authorized
plan and exact bound claim, performs one idempotent authenticated `recovery` continuation through
the existing expired-committed-heartbeat authority helper, verifies the renewed active claim, and
only then projects the successor locally. A different counter, head, review identity, write set, or
claim still fails closed.
