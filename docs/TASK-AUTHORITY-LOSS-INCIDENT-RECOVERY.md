---
title: "Task-Authority-Loss Incident Recovery"
graphId: "md:task-authority-loss-incident-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-task-authority-loss-incident-recovery-revision-intent-supersession-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "current owner task capability and exact content-bound authorization"
runtime_owner: "../scripts/task-authority-loss-incident-recovery-revision-intent-supersession-contract.mjs; ../scripts/task-authority-loss-incident-recovery-revision-intent-supersession-repository-adapter.mjs; ../scripts/task-authority-loss-incident-recovery-revision-intent-supersession.mjs"
runtime_proof: "../__tests__/task-authority-loss-incident-recovery-revision-intent-supersession.test.mjs"
publish_policy: "protected review required; no source, ref, provider, cloud, merge, cleanup, or deployment effect"
---

# Task-Authority-Loss Incident Recovery

This lane owns recovery when a task-bound owner capability or its successor projection is lost while
authored work and coordination state must be preserved. Recovery is claim-, lease-, PR-, and
capability-bound; it does not adopt another owner's bytes or manufacture readiness.

## Prepared reviewed-lane revision-intent supersession

Use this controller only after the same-owner source correction, completed fence recovery, and
successor task-binding reconciliation have all completed, but the predecessor claim's prepared-only
reviewed-lane revision intent still fences the current owner.

Plan:

```sh
npm run task-authority-loss-incident-recovery:revision-intent-supersession -- plan \
  --repository=/absolute/path/to/worktree \
  --branch=agent/device/task-authority-loss-incident-recovery \
  --session=owner-session \
  --pull-request=644 \
  --json
```

Run only with the planner's exact authorization and the current owner capability:

```sh
npm run task-authority-loss-incident-recovery:revision-intent-supersession -- run \
  --repository=/absolute/path/to/worktree \
  --branch=agent/device/task-authority-loss-incident-recovery \
  --session=owner-session \
  --pull-request=644 \
  --task-authority=/absolute/path/to/task-authority.json \
  --authorization='authorize task-authority-loss-incident-recovery-revision-intent-supersession PLAN_DIGEST' \
  --json
```

The only permitted durable effect is one CAS update of the exact branch's
`reviewedLaneRevisionIntents` entry from prepared-only `active` to `superseded`. The lease and peer
records remain unchanged. Source bytes, Git refs, commits, pushes, PR state, cloud claims, merges,
cleanup, and deployment are forbidden.
