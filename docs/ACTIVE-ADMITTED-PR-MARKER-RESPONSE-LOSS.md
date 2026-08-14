---
title: "Active admitted pull-request marker response-loss recovery"
graphId: "md:active-admitted-pr-marker-response-loss"
doc_type: "Lifecycle Capability"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-active-admitted-pr-marker-response-loss-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/active-admitted-pr-marker-response-loss.mjs"
runtime_proof: "../__tests__/active-admitted-pr-marker-response-loss.test.mjs"
---

# Active admitted pull-request marker response-loss recovery

This recovery repairs one provider-hosted pull-request marker after an admitted active lane completed
exactly one authorized renewal locally and in the collaboration ledger, but the provider body retained
the immediately preceding marker. It is transport-neutral at the contract boundary: actor, repository,
review, claim, capability, and revision identifiers are opaque values supplied by a provider adapter.

Planning is read-only and binds all three projections. The source marker records transition `t3` and
heartbeat `h1`. The unchanged local writer lease and exact live cloud claim both record the same claim
at the immediately following transition `t4` and heartbeat `h2`. The renewal must retain the lane,
claim, write set, actor, repository, review, lease epoch, task-authority binding, and admitted scope.
Only the bounded renewal fields may differ, and each counter must advance exactly once. A later
same-claim transition, a malformed projection, a mismatched identity, or more than one candidate
blocks before provider mutation.

The cloud inventory is complete for the target claim. Claims outside the target claim's direct
lineage may advance or append without invalidating the plan, but they are never mutation subjects.
The target claim, its immediately preceding source projection, their exact renewal relation, and the
inventory suffix used to establish that relation are digest-bound. An unrelated suffix is therefore
permitted; a competing or rewritten target is not.

Run requires proof of possession for the task authority already bound to the unchanged local lease.
The operation-specific capability proof is bound to the sealed plan digest; there is no separate human
authorization token. Capability verification is fresh and fail-closed. The recovery does not create,
continue, migrate, or hand off task authority, and it never stores or publishes private capability
material.

The only allowed external effect is replacing the pull-request body's source marker with the
canonical marker projected from the already-authoritative local lease. The controller handles the
three response-loss observations explicitly:

- Source body: the planned provider update may be attempted.
- Target body: the earlier update is reconciled as complete without another write.
- Any third body: execution stops without overwriting concurrent provider content.

The provider adapter observes the body immediately before and after an update and rejects unexpected
drift. This is detection around a read/write/read transport, not a claim that the provider offers an
atomic compare-and-swap for body edits. For example, [GitHub's REST guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2022-11-28)
does not define general conditional semantics for unsafe requests unless an endpoint documents them
explicitly. A concurrent write outside those observations may still win; terminal replay must therefore
re-read and require the exact target body before returning its receipt.

The receipt grants no authoring, cloud-transition, integration, merge, deployment, source/worktree,
writer-registry, remote-Git, or general provider authority. The private digest-bound CAS journal is the
sole local control-plane write. The receipt records at most the one provider-body projection, with the
local lease, cloud claim, branch, commits, registry, and unrelated claims unchanged. The recovery does
not push, fetch, rewrite a Git ref, edit the writer registry, renew or retire a cloud claim, alter
review state, enable auto-merge, join a merge queue, integrate, release, or deploy.
