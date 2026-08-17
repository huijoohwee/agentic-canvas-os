---
title: "Current-cloud expired-local owned-dirt continuation"
graphId: "md:current-cloud-expired-local-owned-dirt-continuation"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-current-cloud-local-lease-continuation-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/current-cloud-expired-local-owned-dirt-continuation.mjs"
runtime_proof: "../__tests__/current-cloud-expired-local-owned-dirt-continuation.test.mjs"
---

# Current-cloud expired-local owned-dirt continuation

This controller closes one narrow projection gap without changing the source of
authority. A task's local writer lease has expired while its exact cloud claim
remains current, write-authorized, unexpired, and bound to the same task,
session, device, lane, review, base, fence, epoch, and declared write set. The
attached worktree contains only the already-owned staged, unstaged, or untracked
bytes sealed by the plan. The cloud claim remains authoritative; local expiry is
not a transfer, reclaim, or new authorization event.

Planning is read-only and fail-closed. It binds the exact local lease and cloud
claim, proof-of-possession task capability, registered branch and worktree,
pull-request identity, Git head and tree, index, tracked and untracked dirt,
file modes and blob/content digests, declared scope, registry generation, and
current time boundary. Unknown, overlapping, or out-of-scope dirt blocks. A
clean lane, a non-expired local lease, an expired or non-current cloud claim, an
identity mismatch, or drift between planning and execution also blocks.

Execution performs one compare-and-swap projection in the local writer
registry. The target lease preserves every immutable identity and authoritative
cloud field, advances no epoch or cloud counter, and sets its local heartbeat
and expiry from the already-current cloud claim. The projected local expiry is
never later than the cloud expiry. The operation-specific mutation-authority
receipt grants only continued authoring in this exact lane while both
projections remain current.

## Replay and response loss

The plan derives one operation key and one exact target lease. The registry
transition has only three admissible observations:

- The exact source lease is projected once.
- The exact target lease is adopted after response loss without another write.
- Any third state is rejected without repair or overwrite.

The durable result distinguishes the immediate call disposition from the
cumulative transaction disposition. An exact replay may report
`adopted-response-loss` for the call while retaining that this operation caused
the original writer-registry projection. Losing the response after a successful
CAS therefore cannot turn a real mutation into a false zero-mutation receipt.
The operation key, source digest, target digest, registry revision, and sealed
receipt make this causal attribution mechanically verifiable.

## Effect boundary

The writer-registry compare-and-swap is the sole permitted mutation. Execution
does not edit authored files or the index, alter worktree registration, create
or remove a branch, commit, fetch, push, change a Git ref, modify a pull request,
renew or retire the cloud claim, create another claim, alter provider state,
review, integrate, merge, clean up, publish, or deploy. Repository and cloud
adapters are read-only witnesses around the local CAS.

The resulting receipt is provider-neutral and repository-neutral: identifiers
are opaque, clocks and storage are injected, and Git or cloud-provider details
stay behind adapters. The controller works for any admitted lane satisfying the
same typed invariant rather than naming a particular pull request or hosting
vendor. Ordinary review and protected integration remain separate lifecycle
operations after the continuation succeeds.
