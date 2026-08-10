---
title: "Reviewed Lane Revision"
graphId: "md:reviewed-lane-revision"
doc_type: "Lifecycle Capability"
date: "2026-08-09"
lang: "en-US"
schema: "agentic-reviewed-lane-revision/v1"
frontmatter_contract: "required"
status: "source-ready"
authority: "Exact authorized forward-child revision of a review-ready lane"
runtime_owner: "../scripts/reviewed-lane-revision.mjs; ../scripts/reviewed-lane-revision-controller.mjs; ../scripts/reviewed-lane-revision-repository-adapter.mjs"
runtime_proof: "../__tests__/reviewed-lane-revision-controller.test.mjs; ../__tests__/reviewed-lane-revision-evidence.test.mjs"
---

# Reviewed Lane Revision

## Purpose

The reviewed-lane revision controller follows one invalid protected-delivery
commit with a deterministic, empty, single-parent child whose subject satisfies
protected policy. The reviewed source commit and tree remain immutable. It preserves the existing
registered worktree, branch, pull-request identity, semantic scope, device,
session, and review request.

This is a narrow lifecycle transition. It does not merge, integrate, deploy,
close a pull request, delete a branch, remove a worktree, or authorize later
delivery.

## Admission

Planning succeeds only when all source observations join exactly:

- the registered worktree is clean and owns its attached device branch;
- local `HEAD`, the remote branch, lease review head, pull-request head, cloud
  authority, and reviewed cloud claim identify one commit; the earlier lease
  fence remains separately evidenced until the atomic terminal projection;
- the writer lease is `review_ready`, admitted, and owned by the supplied
  session and worktree;
- the GitHub pull request is open, non-draft, unqueued, has no auto-merge
  request, and contains exactly one matching writer marker;
- the authenticated GitHub actor, repository, pull request, lease, cloud
  authority, and claim identities agree;
- public cloud status is joined to the exact repository-owned private claim;
  public transition fields remain authoritative while only the private
  pseudonymous device and session identities are admitted;
- the source subject fails current protected-subject policy, while the proposed
  replacement subject passes it; and
- the deterministic candidate has the source tree, exactly one parent equal to
  the source head, and a policy-valid replacement subject.

The plan embeds normalized source evidence and the full deterministic commit
candidate. Its SHA-256 digest changes if any source identity, byte, projection,
or replacement subject changes.

## Commands

Planning is read-only with respect to Git, GitHub, the lease registry, and the
cloud ledger:

```sh
node scripts/reviewed-lane-revision.mjs plan \
  --repository="<registered-worktree>" \
  --session="<exact-session-id>" \
  --pull-request=<number> \
  --replacement-subject="<exact-valid-subject>"
```

The command emits one typed JSON result containing the plan and
`exactAuthorization`. Copy that string byte-for-byte into `--authorize`:

```sh
node scripts/reviewed-lane-revision.mjs run \
  --repository="<registered-worktree>" \
  --session="<exact-session-id>" \
  --pull-request=<number> \
  --replacement-subject="<exact-valid-subject>" \
  --authorize="authorize reviewed-lane-revision <plan-digest>"
```

`run` re-reads the source under the shared entrypoint fence. Authorization is
accepted only when it equals the currently normalized plan's exact statement;
source drift requires a new plan and authorization.

## Durable phase order

| Phase | Required effect or proof |
| --- | --- |
| `prepared` | Persist the exact plan and authorization under the shared fence. |
| `successor_waiting` | Claim one same-owner, same-scope waiting successor at the reviewed source SHA. |
| `commit_created` | Write the precomputed empty child and verify its SHA, tree, and single source parent. |
| `local_ref_updated` | Compare-and-swap the local branch from source SHA to replacement SHA. |
| `remote_ref_updated` | Publish the child with an ordinary no-force fast-forward push. |
| `source_retired` | Retire the reviewed predecessor with head/tree/candidate evidence. |
| `successor_current` | Promote only after the predecessor is absent from live inventory. |
| `successor_bound` | Project the successor to the child, then bind it to the unchanged review request. |
| `successor_review_ready` | Restore verified review-ready cloud authority at the replacement SHA. |
| `lease_updated` | Atomically update the writer lease and durable journal in one registry lock. |
| `pr_projected` | Project the exact updated writer marker into the unchanged pull request. |
| `verified` | Prove local, remote, pull request, lease, and cloud terminal equality. |
| `complete` | Seal the terminal receipt; grant no integration or deployment authority. |

Every effect is reconciled before execution and after an error. A live effect
may be adopted only when it matches the plan-derived operation key and exact
phase identity. The source claim is retired before the successor can become
current. The local branch uses Git ref CAS; the remote branch accepts only the
ordinary fast-forward from the source to its child. No force push is permitted.

The lease projection is special: the controller first builds and validates it,
then the fence owner writes the lease and `lease_updated` journal step in one
registry transaction. There is no crash window with a new lease and stale
journal identity.

## Terminal proof

Completion requires all of the following at the replacement SHA:

- local branch and remote branch equality;
- the original open, ready, non-queued pull request with unchanged repository,
  branch, base, author, URL, number, node ID, and review request;
- exactly one writer marker equal to the local `review_ready` lease;
- the lease fence and review head equal to the replacement SHA; and
- verified cloud `review_ready` authority equal to the lease projection,
  including claim, fence, ledger, transition, scope, evidence, and expiry.

Focused tests prove exact authorization, ordered retirement and promotion,
response-ahead reconciliation, lost-response recovery, terminal-drift stop,
and restart without repeated effects. Those tests do not mutate a live GitHub
pull request or cloud ledger. A real `run` is the live proof for its exact plan;
it still does not prove merge, protected integration, deployment, runtime
parity, or physical-device behavior.
