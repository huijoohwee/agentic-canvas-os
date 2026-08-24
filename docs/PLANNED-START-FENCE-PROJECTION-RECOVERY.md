---
title: "Planned-start fence projection recovery"
graphId: "md:planned-start-fence-projection-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-planned-start-fence-projection-recovery-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/planned-start-fence-projection-recovery.mjs"
runtime_proof: "../__tests__/planned-start-fence-projection-recovery.test.mjs"
---

# Planned-start fence projection recovery

This controller repairs one interrupted planned start whose exact cloud claim
advanced from its base projection at transition `t1` to either the same claim's
ordinary fence projection at `t2` or its exact recovery-provenance-bound
response-ahead fence projection at `t3`, while the local writer lease retained the `t1`
projection. The lane may already contain an authored descendant of the planned
fence. Those bytes remain owned by the original task and are evidence, never a
reason to reset, stash, relocate, adopt, or recreate the lane.

The contract is provider-neutral. Repository, actor, task, claim, review,
session, device, and revision identifiers are opaque values joined by the
evidence adapter. The transition must retain the claim identity, canonical
base, lease epoch, declared write set, task authority, and owner. It may advance
only the exact lane revision and fence-bound transition fields defined by the
same-claim `t1` to `t2` projection, or the exact `t1` to `t3` response-ahead
chain carrying its immutable recovery evidence digest and recovery timestamp.
A later transition, unproven response-ahead transition, foreign claim, rewritten
base, changed scope, identity drift, competing overlap, or ambiguous ledger
history fails closed.

Planning is read-only. It seals the source and target cloud projections, exact
local lease, registered worktree and branch, remote and local revisions,
authored-descendant ancestry, tracked/index/untracked evidence, task capability,
provider review identity, registry generation, cloud inventory, and operation
boundary. Revalidation repeats these joins immediately before the sole allowed
effect. A concurrent ledger-head advance is ignored only when the exact claim
projection and the empty overlapping-claim set remain identical across the
independently sealed observations; any subject or overlap drift still fails.

Execution performs one compare-and-swap projection in the local writer
registry. The target lease adopts the already-authoritative `t2` or exact `t3` fence while
preserving the authored descendant, branch, worktree, task binding, admission,
and owner. It creates no claim and performs no cloud transition. The target
lease remains `planned`; ordinary authoring admission and later lifecycle steps
remain separate gates.

## Replay and response loss

The plan derives one operation key and one exact target lease. The registry may
be observed in only three ways:

- Exact `t1` source: project the sealed `t2` or recovery-proven `t3` fence once.
- Exact sealed target plus the operation receipt: adopt the result without a
  second write.
- Any third state: reject without overwrite or repair.

The terminal receipt separates the immediate-call disposition from cumulative
causality. Both `projected` and `adopted-response-loss` record
`writerRegistryMutation: true` because the sealed operation caused the original
compare-and-swap even when its first response was lost. A clean restart can
hydrate the exact durable phase receipt and complete verification without
repeating the registry effect.

## Effect boundary

The writer-registry compare-and-swap is the only permitted mutation. Recovery
does not edit authored bytes or the index; move, clean, create, or unregister a
worktree; create a commit; fetch, push, or change a Git ref; mutate a pull
request or provider object; continue, retire, hand off, or create a cloud claim;
review, integrate, merge, publish, deploy, or clean up. Every such disposition
is explicitly false in the completion receipt.

This narrow capability is adaptive only across equivalent adapters that prove
the same typed invariants. It introduces no provider-specific state, branch
alias, downstream compatibility shim, or privileged recovery shortcut.
