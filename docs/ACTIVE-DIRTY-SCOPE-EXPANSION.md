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
runtime_owner: "../scripts/active-dirty-scope-expansion.mjs; ../scripts/active-dirty-scope-expansion-controller.mjs; ../scripts/active-dirty-scope-expansion-contract.mjs; ../scripts/active-dirty-scope-expansion-protected-main.mjs; ../scripts/active-dirty-scope-expansion-successor-projection.mjs; ../scripts/writer-lease-registry-cas.mjs"
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

## Repeat expansion

A completed C1 -> C2 intent is a validated terminal tombstone, not a permanent
one-expansion limit. Planning the identical target remains read-only and
returns the historical plan. Executing that identical target verifies the
terminal receipts and exact local C2 projection, then returns the prior result
without cloud, registry, Git, or pull-request effects.

Planning a different target derives a fresh strict-superset C2 -> C3 plan from
the current admitted C2 lease. For a stale canonical base, it rebinds the
complete observed canonical path set to the newly requested target paths and
fails if that wider target overlaps protected-main changes. Execution verifies
the new plan's byte-exact authorization before it mutates the registry. Under
one registry CAS it then:

1. verifies that the current intent is the exact completed C1 -> C2 terminal;
2. verifies that the live lease and claim are its exact C2 projection;
3. replaces the branch's single bounded `lastCompletedScopeExpansionIntents`
   archive with that validated terminal; and
4. removes only the current intent slot.

The controller re-reads the live C2 projection after that CAS and requires the
fresh C2 -> C3 plan digest to equal the authorized plan before beginning a new
intent. This second observation recomputes the requested target's disjointness
proof rather than reusing the archived intent's proof. A changed protected-main
frontier, lease, claim, target, plan, or concurrent registry revision fails
closed. An incomplete or malformed intent is never rolled. A lost CAS response
is safe to retry: the bounded archive remains, the current slot stays empty,
and the same live C2 state deterministically re-derives the plan. The archive
retains at most one validated terminal per branch, so repeated expansions do
not create unbounded registry history.

## Focused verification

```sh
node --test \
  __tests__/active-dirty-scope-expansion-contract.test.mjs \
  __tests__/active-dirty-scope-expansion-controller.test.mjs \
  __tests__/active-dirty-scope-expansion-repository-adapter.test.mjs \
  __tests__/active-dirty-scope-expansion-successor-binding.test.mjs
```
