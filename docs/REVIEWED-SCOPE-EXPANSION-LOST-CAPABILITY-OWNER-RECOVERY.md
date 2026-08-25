---
title: "Reviewed Scope Expansion Lost-Capability Owner Recovery"
graphId: "md:agentic-reviewed-scope-expansion-lost-capability-owner-recovery"
doc_type: "Runtime Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-reviewed-scope-expansion-lost-capability-owner-recovery-plan/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact operator authorization for one unchanged clean owner lane after private capability loss"
runtime_owner: "../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-contract.mjs; ../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-controller.mjs; ../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-evidence.mjs; ../scripts/reviewed-scope-expansion-lost-capability-owner-recovery-repository-adapter.mjs; ../scripts/reviewed-scope-expansion-lost-capability-owner-recovery.mjs"
runtime_proof: "../__tests__/reviewed-scope-expansion-lost-capability-owner-recovery.test.mjs"
publish_policy: "Dev-only task-binding recovery; no source, ref, cloud, merge, deployment, or cleanup authority"
---

# Reviewed Scope Expansion Lost-Capability Owner Recovery

Use this controller only when a clean, open, non-draft, review-ready lane is blocked from the
reviewed terminal-handoff scope-expansion controller because the private task capability was lost.
It does not reconstruct private material or infer ownership from a session identifier. Planning
binds the exact public source binding, clean local/remote/PR bytes, immutable source-recovery
journal, live cloud record, strict-superset manifest, and one distinct next-generation capability.

Execution requires the planner's exact authorization. It persists an externalized Git-common-dir
journal before mutation, replaces only the task binding through one writer-registry CAS, verifies
proof from the replacement capability, and projects only the PR writer marker. Source bytes, Git
refs, cloud claims, authored PR text, merge, deployment, and cleanup are forbidden. Replay accepts
only the exact already-projected target binding and receipt.

```sh
node scripts/reviewed-scope-expansion-lost-capability-owner-recovery.mjs plan \
  --repository="<reviewed-worktree>" \
  --target-manifest="<strict-superset-manifest.json>" \
  --task-authority="<replacement-generation-capability.json>" \
  --output="<external-plan.json>" --json
```

Review the plan and provide only:

```text
authorize reviewed-scope-expansion-lost-capability-owner-recovery <planDigest>
```

```sh
node scripts/reviewed-scope-expansion-lost-capability-owner-recovery.mjs run \
  --repository="<reviewed-worktree>" \
  --target-manifest="<strict-superset-manifest.json>" \
  --task-authority="<replacement-generation-capability.json>" \
  --plan-file="<external-plan.json>" \
  --authorization='authorize reviewed-scope-expansion-lost-capability-owner-recovery <planDigest>' --json
```

After its completion receipt, rerun the ordinary reviewed terminal-handoff scope-expansion planner
with the same replacement capability. All review, integration, runtime, Production, and cleanup
receipts remain independently required.
