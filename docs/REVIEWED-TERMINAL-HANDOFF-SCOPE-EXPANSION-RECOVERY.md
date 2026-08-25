---
title: "Reviewed Terminal-Handoff Scope Expansion Recovery"
graphId: "md:agentic-reviewed-terminal-handoff-scope-expansion-recovery"
doc_type: "Runtime Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-reviewed-terminal-handoff-scope-expansion-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound strict-superset repair of one bound reviewed terminal-handoff successor"
runtime_scope: "read-only planning, exact authorization, same-claim recovery, successor scope expansion, local CAS, PR-marker projection, and source-journal archival"
runtime_claim: "preserves source bytes and restores expanded review-ready Dev authority only"
runtime_owner: "../scripts/reviewed-terminal-handoff-scope-expansion-recovery-contract.mjs; ../scripts/reviewed-terminal-handoff-scope-expansion-recovery-controller.mjs; ../scripts/reviewed-terminal-handoff-scope-expansion-recovery-evidence.mjs; ../scripts/reviewed-terminal-handoff-scope-expansion-recovery-repository-adapter.mjs; ../scripts/reviewed-terminal-handoff-scope-expansion-recovery.mjs"
runtime_proof: "../__tests__/reviewed-terminal-handoff-scope-expansion-recovery.test.mjs"
publish_policy: "Dev-only recovery; integration, runtime proof, Production release, deployment, and cleanup remain separately gated"
---

# Reviewed Terminal-Handoff Scope Expansion Recovery

This controller is the sole repair path for a reviewed, clean lane whose
`reviewed-terminal-handoff-successor-recovery` journal stopped at
`successor-bound` because the pull request contains committed paths outside the
older admitted manifest. It does not authorize source edits, integration,
merge, deployment, or cleanup.

## Admission boundary

Read-only planning joins all of the following twice:

- the immutable bound source-recovery journal and its exact live successor;
- the unchanged local review-ready lease, clean HEAD, remote branch, open
  non-draft pull request, and writer marker;
- every pull-request file;
- the same semantic scope and a strict-superset manifest whose additions are
  exactly the pull-request paths uncovered by the source manifest; and
- the existing task-authority subject and external capability.

Any extra target path, omitted pull-request path, journal change, source-claim fence
change, PR change, source-byte change, or task-subject change blocks planning or
execution. The plan digest seals the source claim transition, journal bytes,
pull-request file list, both manifests, and the new operator session. Unrelated
global-ledger suffix movement is deliberately excluded from human authorization.

## Authorized transition

The exact authorization may recover the bound source claim after expiry, then
creates one waiting strict-superset successor. It retires the source as
`superseded`, promotes and binds the successor to the same pull request, reaches
review-ready authority, projects the expanded admission and continued task
binding through one writer-registry CAS, updates only the PR writer marker, and
archives the immutable source journal. Every effect is durably journaled and
reconciled before retry.

The result remains review-ready. Normal `RELEASE-WORKFLOW.md` review,
integration, protected-main proof, runtime proof, deployment, and cleanup gates
remain independent.

## Commands

Create an external target manifest and plan without mutation:

```sh
node scripts/reviewed-terminal-handoff-scope-expansion-recovery.mjs plan \
  --repository="<reviewed-source-worktree>" \
  --target-manifest="<external-strict-superset-manifest.json>" \
  --task-authority="<external-task-capability.json>" \
  --operator-session="<new-operator-session>" \
  --ttl-seconds=1800 \
  --output="<external-plan.json>" \
  --json
```

Review the complete plan, then provide only its printed statement:

```text
authorize reviewed-terminal-handoff-scope-expansion-recovery <planDigest>
```

Execute that exact plan:

```sh
node scripts/reviewed-terminal-handoff-scope-expansion-recovery.mjs run \
  --repository="<reviewed-source-worktree>" \
  --target-manifest="<external-strict-superset-manifest.json>" \
  --task-authority="<external-task-capability.json>" \
  --operator-session="<new-operator-session>" \
  --plan-file="<external-plan.json>" \
  --authorization='authorize reviewed-terminal-handoff-scope-expansion-recovery <planDigest>' \
  --json
```

The target manifest, task capability, and plan must remain outside the source
repository. Source-journal archival preserves exact bytes under the source
journal's `archive/` directory and removes the active replay surface only after
cloud, local, and PR projections converge.
