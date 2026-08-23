---
title: "Active Dirty Scope Expansion"
graphId: "md:active-dirty-scope-expansion"
doc_type: "Lifecycle Capability"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-active-dirty-scope-expansion-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "Exact-authorized active tracked-dirt strict-superset scope successor"
runtime_owner: "../scripts/active-dirty-scope-expansion.mjs; ../scripts/active-dirty-scope-expansion-controller.mjs; ../scripts/active-dirty-scope-expansion-contract.mjs; ../scripts/active-dirty-scope-expansion-protected-main.mjs; ../scripts/active-dirty-scope-expansion-successor-projection.mjs"
runtime_proof: "../__tests__/active-dirty-scope-expansion-contract.test.mjs; ../__tests__/active-dirty-scope-expansion-controller.test.mjs; ../__tests__/active-dirty-scope-expansion-repository-adapter.test.mjs; ../__tests__/active-dirty-scope-expansion-successor-binding.test.mjs"
---

# Active Dirty Scope Expansion

This controller widens one active admitted lane from C1 to an exact
strict-superset C2 while preserving its tracked dirty bytes, branch, worktree,
fence, pull request, session, device, and task-authority subject. Untracked dirt,
source dirt outside C1, target overlap, or identity drift stops before mutation.

## Canonical-base rule

C2 retains the predecessor lease's canonical base. Current protected `main` is
an independently observed concurrency frontier, not a replacement base for the
preserved lane. When protected `main` is a strict descendant, planning requires:

- source base -> pull-request base -> protected main ancestry;
- the complete bounded changed-path set from source base to protected main;
- disjointness between those paths and the complete expanded target write set;
- a normalized `agentic-legacy-review-current-base-disjoint-proof/v1`; and
- inclusion of that proof in the plan digest and exact authorization.

The waiting-successor request sends the sealed proof to the cloud reducer. The
reducer accepts the historical base only while the proof targets its current
canonical revision. A later protected advance therefore requires replanning.
Same-base plans omit the optional proof and retain their historical shape.

## Plan and execute

Planning is read-only:

```sh
AGENTIC_TASK_AUTHORITY_FILE=/external/task-authority.json \
node scripts/active-dirty-scope-expansion.mjs plan \
  --source-repository=/registered/task-worktree \
  --target-manifest=/external/expanded-manifest.json \
  --session=exact-source-session --json
```

Execution requires the returned byte-exact statement:

```text
authorize scope-expansion <planDigest>
```

Authorized execution journals every phase, claims a non-writing waiting C2,
retires only C1, promotes and review-binds C2, atomically projects the local
lease and task successor, then replaces exactly one hidden PR marker. It does
not edit source bytes, index entries, HEAD, refs, draft state, merge state,
deployment, or runtime.

## Focused verification

```sh
node --test \
  __tests__/active-dirty-scope-expansion-contract.test.mjs \
  __tests__/active-dirty-scope-expansion-controller.test.mjs \
  __tests__/active-dirty-scope-expansion-repository-adapter.test.mjs \
  __tests__/active-dirty-scope-expansion-successor-binding.test.mjs
```
