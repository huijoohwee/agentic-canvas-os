---
title: "Current-cloud expired-local work continuation"
graphId: "md:current-cloud-expired-local-work-continuation"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-current-cloud-expired-local-work-continuation-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/current-cloud-expired-local-work-continuation.mjs"
runtime_proof: "../__tests__/current-cloud-expired-local-work-continuation.test.mjs"
---

# Current-cloud expired-local work continuation

This controller restores one exact local writer projection when its lease has
expired but the already-bound cloud claim remains current, write-authorized,
scope-reserving, and unexpired. It preserves work owned by the same task and
supports two explicit, non-interchangeable modes:

- `admitted-committed-descendant-dirty` binds an admitted lane whose local HEAD
  is a linear, in-scope descendant of the remote pull-request fence and whose
  remaining nonempty dirt is also in scope.
- `planned-fence-dirty` binds a root-source planned lane whose local, remote,
  and pull-request heads remain at the exact fence while its in-scope authored
  dirt is nonempty and still uncommitted.

The modes share mechanics, not authority assumptions. Evidence records the
mode and proves its complete invariant. A planned lane is never silently
reclassified as admitted, and an admitted descendant cannot be downgraded to a
planned-fence shortcut.

## Evidence boundary

Planning is read-only and double-reads the local writer registry, current cloud
claim, registered worktree, Git and index state, remote branch, draft review,
task capability, and exact authored bytes. The sealed subject joins repository,
claim, owner, session, device, branch, worktree, review, base, fence, epochs,
task binding, admission, declared write set, file types, modes, paths, blobs,
commits, trees, and ancestry.

The controller is evidence too. Its installed root, protected `origin/main`
revision, tree, runtime digest, and clean state must match both planning reads
and every execution revalidation. The remote branch and provider-neutral review
head remain at the fence even when admitted local HEAD has advanced through
sealed descendants. The review must stay open, draft, and bound to the same URL
and branch. A second read is mandatory; agreement inferred from a single
snapshot is not admission evidence.

The cloud claim must be the exact claim already projected into the lease. It
may be observed through any conforming provider adapter, but it must remain
current and unexpired throughout execution. Unrelated disjoint cloud activity
may advance; target-claim drift, overlapping authority, identity changes,
expiry, malformed inventory, or a later target transition blocks.
The evidence seals only the normalized current-inventory claim projection. It
does not copy entry-schema provenance, claim-identity schema, operation-receipt
identity, session identity, or device identity from a provider's raw claim.
Those transport fields cannot become a second authority surface.

The core contract accepts one normalized `claimOwner`. Actor, repository, and
work-item identities join that owner to the projected claim. Session and device
identities instead join the owner to the lease's cloud-authority projection
through the provider-neutral namespaced digest rule. Swapping either side
blocks. Provider-specific identity lookup remains in the repository adapter;
the evidence owns only deterministic identity normalization and comparison.

Every authored path must be covered by the declared write set. Symlink changes,
unmerged paths, mode or blob drift, out-of-scope work, dirty-state changes,
branch movement, remote movement, pull-request movement, non-linear ancestry,
or a missing descendant in admitted mode fails closed. Planned mode rejects any
local commit above the fence.

## Atomic continuation and replay

Execution requires fresh proof of the task capability already bound to the
lease. Its durable phases are `prepared`, `authority-verified`,
`local-attempted`, `local-projected`, `verified`, and `complete`. The operation
key and phase receipts are plan-derived and content-addressed. The capability
receipt's `taskProofDigest` is retained in the authority phase, append-only
registry receipt, and completion without exposing the proof payload.

The only effect is one compare-and-swap update to the local writer registry,
including an append-only recovery receipt. The target retains the exact claim,
scope, owner, mode, admission, task binding, base, fence, branch, worktree, and
review identity. Local heartbeat and expiry are projected from the current
cloud authority and never exceed its expiry.

Digest names distinguish two different objects. `projectedLeaseDigest` seals
the plan-derived heartbeat/expiry projection before its self-describing receipt
is appended. `storedLeaseDigest` seals the actual lease stored after that
append. The terminal verifier recomputes the latter from registry state; it
cannot substitute the projected digest. Source admission likewise compares the
actual stored source lease with `sourceLeaseDigest` before the CAS.

The registry has exactly three admissible observations:

- Exact source: perform the compare-and-swap once.
- Exact target plus the operation receipt: adopt after response loss.
- A repeated response-loss suffix that has since become dormant replays every
  sealed suffix transition in ledger order, then renews from the resulting
  exact intermediate transition; each historical replay evidence key may
  differ from the fresh renewal evidence, and it is never adopted as current
  authority.
- Any third state: reject without overwrite or repair.

The append-only receipt carries the phase values needed to hydrate a process
restart without a private journal. Both `projected` and
`adopted-response-loss` report cumulative `writerRegistryMutation: true`: the
sealed operation caused the original mutation even when the first response was
lost. Replay verifies the target and returns the same completion without a
second registry write.

## Effect boundary

The completion receipt explicitly denies cloud, provider, source, Git, index,
remote-ref, pull-request, pull-request-state, new-claim, new-worktree, merge,
deployment, and cleanup mutation. The controller does not commit, fetch, push,
change authored bytes, renew the cloud claim, alter review state, integrate, or
publish. It grants only the mode-specific continuation encoded by the protected
contract; ordinary review and integration remain separate lifecycle steps.

All provider, clock, registry, repository, and capability operations are ports.
The contract depends on typed invariants rather than GitHub-specific review IDs,
machine paths, pull-request numbers, or named target lanes.
