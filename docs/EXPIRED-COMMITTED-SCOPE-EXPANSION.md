---
title: "Expired Committed Scope Expansion"
graphId: "md:expired-committed-scope-expansion"
doc_type: "Recovery Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-expired-committed-scope-expansion-doc/v1"
frontmatter_contract: "required"
status: "normative"
---

# Expired Committed Scope Expansion

This repository-owned controller recovers one narrow state: an expired admitted
lane is clean, its remote branch and draft pull request remain at the admitted
fence, and its local head is one unpublished child commit whose paths require a
strict superset of the original declared write scope.

The controller is fail-closed. Planning proves the exact source lease, dormant
cloud claim, task capability, commit parent, tree, authored paths, pull request,
protected-main relationship, and target manifest. Running requires the exact
plan-digest authorization and persists a scope-expansion intent before any
cloud mutation. The initial execution uses that persisted intent directly;
replay reads the same plan snapshot and never creates or unwraps a second
intent before continuing from the recorded phase.

The local writer-registry projection reads only the durable
`expiredCommittedScopeExpansionIntents` journal. Any superseded general
scope-expansion intent is disposal input, never recovery authority and never a
substitute for the authorized expired-committed plan.

The successor claim and every remote-authority verification use the protected
main SHA captured by the plan's incorporation proof as their canonical base.
The atomic local projection advances the successor lease to that same base;
task-authority continuation permits this base change only when both predecessor
and successor leases match their respective cloud canonical bases.
The source-base fields in the immutable plan and durable intent remain
unchanged so an interrupted transition can replay the exact authorized plan
without digest substitution.

Predecessor retirement preserves the source authority's fenced revision and
its existing cloud review identity. The unpublished child and the draft pull
request belong to the successor transition; neither may be substituted into
the predecessor's retirement record.

The only allowed transition is:

1. claim a waiting successor with the expanded scope;
2. retire the dormant predecessor and promote the successor;
3. bind the successor to the existing draft pull request at the source fence;
4. atomically replace local cloud authority, admission, lease expiry, and
   task-authority binding through the writer-registry CAS;
5. replace and verify the pull-request lease marker; and
6. emit completion only after fresh remote mutation-authority verification.

The controller does not edit, publish, merge, deploy, or clean source bytes.
Those actions remain owned by the ordinary device and release workflows after
the expanded successor authority is complete.

```bash
node scripts/expired-committed-scope-expansion.mjs plan \
  --source-repository=/absolute/task/worktree \
  --target-manifest=/absolute/external/target-manifest.json \
  --session=<exact-session> \
  --task-authority=/absolute/external/capability.json \
  --json
```

The `run` command accepts the same arguments plus the exact
`--authorize=authorize expired-committed-scope-expansion <planDigest>` value
returned by planning. Any drift stops without substituting another authority.
