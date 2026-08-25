---
title: "Reviewed Terminal-Handoff Successor Recovery"
graphId: "md:agentic-reviewed-terminal-handoff-successor-recovery"
doc_type: "Runtime Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-reviewed-terminal-handoff-successor-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound restoration of one clean reviewed lane after an unprojected successor retired for handoff"
runtime_scope: "read-only planning, exact authorization, next-epoch successor claim, review binding, local CAS, and PR-marker projection"
runtime_claim: "preserves source bytes and restores review-ready Dev authority only"
runtime_owner: "../scripts/reviewed-terminal-handoff-successor-recovery-contract.mjs; ../scripts/reviewed-terminal-handoff-successor-recovery-controller.mjs; ../scripts/reviewed-terminal-handoff-successor-recovery-evidence.mjs; ../scripts/reviewed-terminal-handoff-successor-recovery-repository-adapter.mjs; ../scripts/reviewed-terminal-handoff-successor-recovery.mjs"
runtime_proof: "../__tests__/reviewed-terminal-handoff-successor-recovery.test.mjs"
publish_policy: "Dev-only recovery; integration, runtime proof, Production release, deployment, and cleanup remain separately gated"
---

# Reviewed terminal-handoff successor recovery

This controller covers one exact split-authority lineage. A clean local lane and
its non-draft pull request still project a `review_ready` claim. That claim is
terminally `retired` for `superseded`; its unique direct successor was promoted
without being projected into the lane, then terminally `retired` for `handoff`.
Neither claim remains live and no overlapping reservation exists.

The controller creates one next-epoch successor from that terminal handoff,
binds it to the unchanged pull request and reviewed head, restores cloud
`review_ready`, then compare-and-swap projects the new cloud and task authority
into the existing lease and provider marker. It does not change source bytes,
create a commit, push, merge, deploy, clean, close a pull request, or delete a
worktree or ref.

## Preconditions

Planning double-reads and seals:

- one registered, clean worktree on its unique attached branch;
- local HEAD, remote branch, pull-request head, and `reviewHeadSha` equality;
- one admitted local `review_ready` lease and exact non-draft ownership marker;
- the local reviewed ledger entry and its monotonic `superseded` retirement;
- one direct successor with the same repository, actor, work item, base, head,
  and write set, a null review request, and a monotonic
  `waiting-successor -> current -> retired(handoff)` chain;
- complete live inventory proving both terminal claims absent, no successor of
  the handoff source, and no overlapping reservation; and
- the external task capability already bound to the local lane.

Any source, PR, ref, task binding, ledger, lineage, inventory, or ownership
drift blocks before mutation.

## Plan and run

Planning is read-only:

```sh
node scripts/reviewed-terminal-handoff-successor-recovery.mjs plan \
  --repository=<absolute-reviewed-worktree> \
  --operator-session=<distinct-successor-session> \
  --task-authority=<absolute-external-capability>
```

Save the emitted plan outside the repository. Run requires its exact statement:

```sh
node scripts/reviewed-terminal-handoff-successor-recovery.mjs run \
  --repository=<absolute-reviewed-worktree> \
  --operator-session=<distinct-successor-session> \
  --task-authority=<absolute-external-capability> \
  --plan=<absolute-external-plan.json> \
  --authorization='authorize reviewed-terminal-handoff-successor-recovery <planDigest>'
```

## Durable order and result boundary

The journal advances through `authorized`, `successor-claimed`,
`successor-bound`, `successor-review-ready`, `local-cas`, `pr-marker`,
`verified`, and `complete`. Each provider effect uses a stable operation key;
retries adopt only the exact plan-derived successor and projection.

Success is `successor-review-ready`. It restores only the authority needed for
the ordinary protected integration controller to revalidate and authorize the
exact reviewed candidate. An Integration Receipt, protected merge, runtime
proof, Production authorization, deployment, `device:complete`, and cleanup
remain independent later gates.
