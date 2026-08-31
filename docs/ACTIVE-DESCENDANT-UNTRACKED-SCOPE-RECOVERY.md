---
title: "Active descendant untracked scope recovery"
graphId: "md:active-descendant-untracked-scope-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-active-descendant-untracked-scope-recovery-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/active-descendant-untracked-scope-recovery.mjs"
runtime_proof: "../__tests__/active-descendant-untracked-scope-recovery-contract.test.mjs; ../__tests__/active-descendant-untracked-scope-recovery-controller.test.mjs; ../__tests__/active-descendant-untracked-scope-recovery-repository-adapter.test.mjs; ../__tests__/active-descendant-untracked-scope-recovery-cli.test.mjs"
---

# Active descendant untracked scope recovery

This controller restores authoring authority for one active, admitted owner lane
whose local branch is an unpublished descendant of its cloud fence and whose
owner has stopped after creating untracked files outside the admitted write
scope. It preserves the source worktree and all authored bytes in place. It is
not a generic scope bypass and never converts lease expiry, a matching actor, or
a draft pull request into ownership.

## Exact source state

Planning is read-only and succeeds only when all of these facts join:

- one current source claim, active local lease, task capability, branch,
  worktree, lease epoch, cloud fence, and draft pull request name the same owner;
- local `HEAD` is a nonempty linear descendant of the source fence, while the
  remote task branch and draft pull request remain at that fence;
- tracked worktree and index changes are completely enumerated and remain
  inside the source scope;
- every out-of-scope path is untracked, byte-digested, named by an explicit
  owner-stop receipt, and included in the proposed target manifest;
- the target manifest is the exact strict superset of the source write set and
  no current or reserved foreign claim overlaps it; and
- the canonical base, registry revision, lease digest, pull-request marker,
  cloud inventory, Git ancestry, trees, path sets, and mutation boundary are
  sealed into one plan digest.

Any staged disguise of an untracked file, missing byte, symlink ambiguity,
foreign overlap, changed pull request, rewritten descendant, or source drift
fails closed.

## Authorized execution

Execution requires the external task capability already bound to the source
lane and this exact token:

```text
authorize active-descendant-untracked-scope-recovery <planDigest>
```

The replay-safe controller performs one root-operation sequence through the
existing cloud collaboration contract: create the same-owner waiting
successor, retire only the sealed source claim, promote only that successor,
and bind it to the unchanged draft pull request at the unchanged remote fence.
The unpublished local descendant remains in place and becomes covered by the
strict-superset lease. The controller then compare-and-swap projects that lease
and task binding, and freshly verifies the pull-request identity, draft state,
branch, and remote fence. The original body and ownership marker are exact
pre-effect evidence, not a terminal gate: a concurrent body-only edit cannot
deadlock replay after an append-only cloud effect. Marker projection remains
deferred to the ordinary reviewed handoff; this recovery does not claim a
provider compare-and-swap that the pull-request API does not provide.

Each phase records a durable receipt. An exact replay adopts prior effects;
response loss is reconciled from an independently observed exact target. A
third state is never overwritten.

## Effect boundary

Recovery may mutate only the source and successor cloud claim transitions, one
writer-registry entry through compare-and-swap, and its task binding. It does
not edit, stage, remove, move, copy, or adopt source bytes; change the index,
`HEAD`, tree, branch, worktree registration, or any Git ref; mutate the pull
request title, body, marker, or draft state; push authored commits; review,
integrate, merge, deploy, clean up, or retire unrelated claims.

The terminal receipt grants authoring authority for the exact successor scope
and revision only. Review readiness, integration, deployment, and cleanup
remain separately gated.

## Focused proof

```sh
node --test __tests__/active-descendant-untracked-scope-recovery-*.test.mjs
```
