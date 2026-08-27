---
title: "Planned Dirty Heartbeat Projection Recovery"
graphId: "md:planned-dirty-heartbeat-projection-recovery"
doc_type: "Recovery Contract"
date: "2026-08-26"
lang: "en-US"
schema: "agentic-planned-dirty-heartbeat-projection-recovery/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "exact lost-heartbeat local projection for one task-bound planned dirty lane"
publish_policy: "Dev-only; no merge, release, Production, or deployment authority"
runtime_scope: "writer-registry and draft pull-request marker projections only"
runtime_claim: "read-only planning plus exact-authorized response-loss-safe projection"
runtime_proof: "focused controller tests"
source_docs:
  - "START-WORKFLOW.md"
  - "SCOPED-LANE-ADMISSION.md"
  - "TASK-BOUND-LANE-AUTHORITY.md"
---

# Planned Dirty Heartbeat Projection Recovery

## Purpose

Use this controller only when an active task-bound `planned` lane has owned dirt at its unchanged fence and authenticated cloud evidence proves that the same current claim is exactly one heartbeat transition ahead of its local writer-lease projection.

The route repairs a response-loss projection. It does not heartbeat the cloud, admit the lane, grant source mutation, change scope, advance Git, publish, review, integrate, merge, clean, release, or deploy.

## Exact Subject

Planning double-reads and seals all of the following:

- one registered attached task worktree, active planned lease, task-authority binding, claim, branch, session, base, fence, write set, draft pull request, and unchanged local and remote branch heads;
- the full staged, unstaged, untracked, type, mode, blob, and index evidence for every dirty path, with every path covered by the planned write set;
- an operation-derived current cloud inventory whose exact claim has `transitionCounter + 1`, `heartbeatCounter + 1`, strictly newer transition/fence/operation digests, and a growing expiry;
- null integration state, unchanged review identity, and identical actor, repository, work item, device, session, scope, base, lane revision, epoch, and claim identity;
- the complete source pull-request body and the deterministic full target body, both within the provider body limit.

Exact-current is not a recovery and fails planning. A second transition, a second heartbeat, expiry non-growth, identity drift, scope or base drift, fence or review drift, integration, body drift, dirt drift, or missing explicit inventory heartbeat fails closed.

## Projection Transaction

Execution requires both the external task capability already bound to the lane and the exact text returned by planning:

```text
authorize planned-dirty-heartbeat-projection-recovery <planDigest>
```

The first mutation is a real compare-and-swap of the exact branch lease in the Git-common writer registry. Fallback annotation is forbidden. The existing scope-expansion and active-owned-dirt intent fences must be clear. Before that CAS, the controller proves the complete target pull-request body fits.

The target lease changes only cloud heartbeat authority, the bounded local heartbeat window, and one content-derived recovery receipt. Admission remains `planned`; every other lease field remains exact. The recovery receipt exists only in the local registry projection because the canonical writer marker deliberately excludes arbitrary recovery fields.

After the registry CAS, the controller replaces only the canonical writer marker inside the unchanged draft pull-request body. The review remains open and draft, with the same base, head, repository, URL, identity, and auto-merge state. The controller re-reads cloud authority before each terminal decision and performs no cloud mutation.

## Replay

The sealed execution accepts exactly three states:

1. source registry plus source marker;
2. target registry plus source marker after registry response loss;
3. target registry plus target marker after marker response loss or completion.

Source registry plus target marker is contradictory and fails closed. Replaying the same plan adopts only the exact target lease and target body. A later cloud heartbeat is not adopted by the old plan.

## Invocation

Write the read-only plan outside the repository:

```sh
node scripts/planned-dirty-heartbeat-projection-recovery.mjs plan \
  --repository="$TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --output="$EXTERNAL_PLAN" --json
```

After receiving the exact authorization, execute with the same external plan and task capability:

```sh
node scripts/planned-dirty-heartbeat-projection-recovery.mjs execute \
  --repository="$TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --plan-file="$EXTERNAL_PLAN" \
  --task-authority="$EXTERNAL_TASK_CAPABILITY" \
  --authorize="authorize planned-dirty-heartbeat-projection-recovery <planDigest>" \
  --json
```

Success returns a content-derived completion receipt binding the source and target lease, cloud authority, projection, owned dirt, registry-only recovery receipt, and deterministic target marker/body. It grants no authoring or deployment authority.
