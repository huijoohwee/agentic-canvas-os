---
title: "Planned-Owned-Dirt PR-Marker Continuation"
graphId: "md:planned-owned-dirt-pr-marker-continuation"
doc_type: "Lifecycle Capability"
date: "2026-08-22"
lang: "en-US"
schema: "agentic-planned-owned-dirt-pr-marker-continuation/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized continuation after successor local projection"
runtime_scope: "read-only planning, pull-request marker projection, and original journal completion"
runtime_claim: "bounded recovery only; integration, deployment, and cleanup remain separate"
runtime_owner: "../scripts/planned-owned-dirt-pr-marker-continuation-contract.mjs; ../scripts/planned-owned-dirt-pr-marker-continuation-controller.mjs; ../scripts/planned-owned-dirt-pr-marker-continuation-repository-adapter.mjs; ../scripts/planned-owned-dirt-pr-marker-continuation.mjs"
runtime_proof: "../__tests__/planned-owned-dirt-pr-marker-continuation.test.mjs"
publish_policy: "protected Dev integration before use"
---
<!-- Responsibility: Define one bounded continuation from local-projected to complete. -->

# Planned-owned-dirt PR-marker continuation

This capability repairs one interruption after the planned-owned-dirt successor has been cloud-bound
and atomically projected into the local writer registry, but before the pull-request marker and original
recovery journal reached terminal state. It does not recreate, retire, promote, or bind a cloud claim.

`plan` double-checks the exact source worktree, unchanged fence and dirty bytes, original
`local-projected` journal, admitted successor lease, task continuation, current cloud verification,
open draft pull request, disabled auto-merge, and predecessor marker. The sealed decision binds both
the predecessor body and intended successor marker.

`run` requires `authorize planned-owned-dirt-pr-marker-continuation <planDigest>` and the original
external task capability. Under the original journal lock and writer-registry projection fence, it may
replace only the writer marker. The original controller's terminal verifier then revalidates cloud,
lease, bytes, ref, and marker evidence before the original journal advances to `complete`.

The command preserves Git HEAD, index, worktree bytes, refs, pull-request state, cloud ledger, and
writer-registry contents. It grants no merge, deployment, cleanup, or Production authority.

```sh
node scripts/planned-owned-dirt-pr-marker-continuation.mjs plan \
  --repository=/absolute/source-worktree --source-session=<session> \
  --original-plan-digest=<digest> --pull-request=<number> \
  --task-authority=/external/task-authority.json --output=/external/plan.json --json

node scripts/planned-owned-dirt-pr-marker-continuation.mjs run \
  --repository=/absolute/source-worktree --source-session=<session> \
  --original-plan-digest=<digest> --pull-request=<number> \
  --task-authority=/external/task-authority.json --plan-file=/external/plan.json \
  --authorize='authorize planned-owned-dirt-pr-marker-continuation <planDigest>' --json
```
