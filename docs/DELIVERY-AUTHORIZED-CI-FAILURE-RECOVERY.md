---
title: "Delivery-authorized CI-failure recovery"
graphId: "md:delivery-authorized-ci-failure-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-13"
lang: "en-US"
schema: "agentic-delivery-authorized-ci-failure-recovery/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/delivery-authorized-ci-failure-recovery.mjs"
runtime_proof: "../__tests__/delivery-authorized-ci-failure-recovery-contract.test.mjs"
---

# Delivery-authorized CI-failure recovery

This controller restores authoring authority for one narrow failure: an exact delivered pull
request has an armed SQUASH request and an integrated-preserved cloud claim, but a required
GitHub Actions check failed before merge. The local writer lease remains `delivery`, so ordinary
authoring, heartbeat, and review entrypoints must not mutate it.

Recovery is control-plane only. It never edits source or index bytes, creates commits, fetches or
changes refs, pushes, reruns CI, closes or creates a pull request, merges, cleans a worktree, or
deploys. It first seals the exact local lease, admitted write set, source HEAD and tree, REST and
GraphQL pull-request projections, armed human SQUASH request, latest required failed check and
workflow attempt, integrated claim and receipt, complete current claim inventory, and the
disjoint protected-main advance.

## Plan

Run the planner from canonical protected `main`, passing the stranded registered worktree:

```sh
node /absolute/canonical/scripts/delivery-authorized-ci-failure-recovery.mjs plan \
  --repository=/absolute/path/to/stranded-worktree \
  --session=exact-source-session \
  --pull-request=461 \
  --check-run=94329944401 \
  --ttl=3600
```

Planning is read-only. A valid plan JSON contains `exactAuthorization` with exactly:

```text
authorize delivery-authorized-ci-failure-recovery <planDigest>
```

Any relevant local, provider, check, claim, integration, inventory, or protected-main drift
changes the digest or blocks planning. Unrelated global ledger movement is tolerated only after
the complete current inventory is reread and the declared scope is still unopposed.

## Run

After explicit authorization, run the same command with `run` and the exact statement:

```sh
node /absolute/canonical/scripts/delivery-authorized-ci-failure-recovery.mjs run \
  --repository=/absolute/path/to/stranded-worktree \
  --session=exact-source-session \
  --pull-request=461 \
  --check-run=94329944401 \
  --ttl=3600 \
  --authorize='authorize delivery-authorized-ci-failure-recovery <planDigest>'
```

The entire run holds the reviewed-lane entrypoint fence. Every effect is independently reread
before and after mutation; response loss is adopted only from an exact typed live projection.
The durable phases are:

1. disable the exact armed SQUASH request and convert the same pull request to draft;
2. create one same-owner waiting successor at the unchanged source head;
3. retire the integrated predecessor using its exact integration receipt;
4. promote and bind the successor to the same pull-request node;
5. atomically replace the delivery lease with a literal active, task-authority-unbound lease;
6. project the exact writer and recovery markers; and
7. prove the source, provider, cloud, registry, and marker terminal state before archival.

The replacement lease is built from an allowlist. Delivery head, review head, integration,
completion, stale recovery fields, and any task-authority binding are absent rather than nulled or
carried forward. A legacy unbound source remains unbound: this controller never invents private
task authority. Before subsequent authoring, use the canonical task-bound-lane authority issue,
plan-migration, migrate, and heartbeat sequence. The later code correction and normal protected
integration remain separate authorized operations.
