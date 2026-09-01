---
title: "Reviewed Dormant Descendant Scope Recovery"
graphId: "md:agentic-reviewed-dormant-descendant-scope-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-reviewed-dormant-descendant-scope-recovery-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized same-owner successor recovery for a reviewed dormant claim with clean unpublished descendant commits"
runtime_scope: "read-only planning, task proof, strict-superset successor transition, one local lease CAS, same-PR draft projection, and terminal authoring-authority proof"
runtime_claim: "preserves reviewed and descendant bytes while restoring authoring authority only"
runtime_owner: "../scripts/reviewed-dormant-descendant-scope-recovery-contract.mjs; ../scripts/reviewed-dormant-descendant-scope-recovery-evidence.mjs; ../scripts/reviewed-dormant-descendant-scope-recovery-controller.mjs; ../scripts/reviewed-dormant-descendant-scope-recovery-repository-adapter.mjs; ../scripts/reviewed-dormant-descendant-scope-recovery.mjs"
runtime_proof: "../__tests__/reviewed-dormant-descendant-scope-recovery.test.mjs; ../__tests__/reviewed-dormant-descendant-scope-recovery-repository-adapter.test.mjs"
publish_policy: "Dev authoring-authority recovery only; review, integration, runtime proof, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define exact recovery of reviewed dormant ownership around clean descendant bytes. -->

# Reviewed dormant descendant scope recovery

This controller recovers one exact reviewed `dormant-preserved` claim when its registered worktree
contains clean, committed, unpublished descendants. It preserves the reviewed provider head and the
local descendant head. It creates no source commit, push, ref rewrite, merge, deployment, or cleanup.

Read-only planning joins all of the following twice:

- the registered source worktree, branch, clean index and worktree, local ref, reviewed provider head,
  and the exact ancestor chain between them;
- the open non-draft pull request, its base, head, body remainder, hidden lease marker, and absence of
  auto-merge;
- the exact transition-3 reviewed dormant claim, the stale local lease for the same source session,
  and absence of an overlapping reserved peer;
- the original external task-authority capability and its bound subject;
- the source manifest and its exact strict-superset target: the source scope plus only descendant
  paths not already covered by that source scope; and
- a fetched protected `main` descendant of the source canonical base whose intervening changed paths
  are disjoint from the target manifest.

The plan seals every commit, tree, ref, path, patch, manifest, claim, lease, task-capability,
pull-request, and protected-main proof digest. Execution accepts only:

```text
authorize reviewed-dormant-descendant-scope-recovery <planDigest>
```

After verifying that exact task capability, execution creates one same-owner waiting successor at the
local descendant head and target manifest, retires only the reviewed source claim as superseded,
promotes and binds only that successor to the same pull request, compare-and-swap projects only the
harness lane's local lease, converts the same pull request to draft, and conditionally replaces only
its hidden writer marker. Each phase reconciles its exact live effect before retry.

The terminal receipt freshly proves the source claim absent, the successor current and bound, the
expanded local lease and continued task binding, the same open draft pull request and reviewed remote
head, the unchanged clean local descendant head, index, tree, and refs, and restored authoring
authority. `committed`, `pushed`, `refRewritten`, `merged`, `deployed`, `cleaned`, and restored
integration authority remain false.

Plans and journals are owner-only private files outside the target repository, Git directory, and
clean controller repository. Planning never accepts the task capability or authorization. Execution
uses only the TTL and evidence sealed into the plan and fails closed on any source, provider, cloud,
task, lease, or protected-main drift.

Focused verification:

```sh
node --test __tests__/reviewed-dormant-descendant-scope-recovery*.test.mjs
```
