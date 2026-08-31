---
title: "Active descendant untracked scope recovery"
graphId: "md:active-descendant-untracked-scope-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-active-descendant-untracked-scope-recovery-doc/v2"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/active-descendant-untracked-scope-recovery.mjs"
runtime_proof: "../__tests__/active-descendant-untracked-scope-recovery-contract.test.mjs; ../__tests__/active-descendant-untracked-scope-recovery-controller.test.mjs; ../__tests__/active-descendant-untracked-scope-recovery-repository-adapter.test.mjs; ../__tests__/active-descendant-untracked-scope-recovery-cli.test.mjs"
---

# Active descendant untracked scope recovery

This controller is an owner-bound wrapper around the integrated active-dirty
scope-expansion state machine. It restores authoring authority for one active,
admitted owner lane whose local branch is an unpublished descendant of its
cloud fence and whose owner has stopped after creating untracked files outside
the admitted write scope. It preserves the source worktree and all authored
bytes in place. It is not a generic scope bypass and never converts lease
expiry, a matching actor, or a draft pull request into ownership.

## Exact source state

Planning is read-only and succeeds only when all of these facts join:

- one current source claim, active local lease, task capability, branch,
  worktree, lease epoch, cloud fence, and draft pull request name the same owner;
- local `HEAD` is a nonempty linear descendant of the source fence, while the
  remote task branch and draft pull request remain at that fence;
- tracked worktree and index changes are completely enumerated and remain
  inside the source scope;
- every out-of-scope path is untracked, byte- and mode-digested, named by a
  short-lived owner-stop receipt proven with the task capability, and included
  in the proposed target manifest;
- the target manifest is the exact strict superset of the source write set and
  no current or reserved foreign claim overlaps it; and
- a separate clean controller checkout is exactly at fetched `origin/main`, so
  unpublished recovery code can never authorize its own use; and
- the canonical base, source lease and task binding, collaboration-ledger
  revision and digest, pull-request marker and visible body, Git ancestry,
  trees, path sets, and mutation boundary are sealed into one plan digest.

Any staged disguise of an untracked file, missing byte, symlink ambiguity,
foreign overlap, changed pull request, rewritten descendant, or source drift
fails closed.

## Authorized execution

Execution requires the external task capability already bound to the source
lane and this exact token:

```text
authorize active-descendant-untracked-scope-recovery <planDigest>
```

The wrapper delegates the mutation sequence to the existing cloud collaboration
and active-dirty scope-expansion contracts: create the same-owner waiting
successor at the sealed ledger digest, retire only the sealed source claim,
promote only that successor, bind it to the unchanged draft pull request,
compare-and-swap the local lease and continued task binding, and replace only
the writer-lease marker. The unpublished local descendant remains in place and
becomes covered by the strict-superset lease. Before every effect, the wrapper
rechecks the task capability, source bytes and index, descendant history,
remote fence, owner-stop validity, visible pull-request body, allowed source or
target marker, and clean protected controller.

The underlying scope-expansion intent records every phase durably. A replay may
adopt its exact source or successor projection; a third state is never
overwritten.

## Effect boundary

Recovery may mutate only the scope-expansion intent, the source and successor
cloud claim transitions, one writer-registry entry through compare-and-swap,
its continued task binding, and the writer marker inside the same draft pull
request body. The visible body digest must remain unchanged. Recovery does not
edit, stage, remove, move, copy, or adopt source bytes; change the index,
`HEAD`, tree, branch, worktree registration, or any Git ref; change the pull
request title, visible body, draft state, or auto-merge state; push authored
commits; review, integrate, merge, deploy, clean up, or retire unrelated claims.

The terminal receipt grants authoring authority for the exact successor scope
and revision only. Review readiness, integration, deployment, and cleanup
remain separately gated.

## Focused proof

```sh
node --test __tests__/active-descendant-untracked-scope-recovery-*.test.mjs
```

Generate the short-lived owner-stop receipt with `owner-stop`, create a fresh
external plan with `plan`, and execute only its printed exact authorization with
`run`. All capabilities, manifests, receipts, plans, and outputs must be private
canonical files outside both repositories.
