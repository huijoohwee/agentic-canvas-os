---
title: "Expired planned committed pull-request marker response-loss recovery"
graphId: "md:expired-planned-committed-pr-marker-response-loss"
doc_type: "Lifecycle Capability"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-expired-planned-committed-pr-marker-response-loss-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/expired-planned-committed-pr-marker-response-loss.mjs"
runtime_proof: "sealed-plan-and-terminal-provider-readback"
---

# Expired planned committed pull-request marker response-loss recovery

This controller repairs one narrow provider projection after the planned-owner
work item reached an `admitted`, task-bound writer lease and recorded cloud transition N locally, but its open draft
pull request retained the immediately preceding cloud authority N-1. The
committed branch, remote branch, pull-request head, local registry, cloud claim,
and task binding remain unchanged.

`plan` is read-only. It requires:

- one clean registered worktree whose committed fence is a strict descendant of
  its base;
- local HEAD, remote head, and the open draft pull-request head at that exact
  fence;
- one expired `active` writer lease with `admission.status = admitted`, the exact
  requested session, and an existing task-authority binding;
- a provider marker equal to the stored marker in every field except
  `cloudAuthority`;
- provider cloud authority at exact predecessor transition N-1 and stored cloud
  authority at exact transition N, each joined to its immutable ledger snapshot;
- a raw current cloud claim whose recorded state is `current` and whose expiry
  projects it to `dormant-preserved`, with `writeAuthority = false`,
  `scopeReserved = true`, the same transition N, and the same fence; and
- one provider body that is exactly either the sealed source projection or the
  sealed target projection.

`run` revalidates the complete sealed subject and proves possession of the task
capability already bound to the lease. Its operation identity includes the plan
digest. The sole external mutation is:

```text
gh pr edit <exact-pr-url> --body-file <private-temporary-body>
```

The source body is changed only to the canonical marker projected from the
stored lease. A pre-existing target body is adopted without another write. If
the provider accepts the edit but the client loses the response, a fresh read
must observe the exact target body and marker before replay is adopted. Any
third body, marker, authority, claim, head, branch, task binding, lease, or
repository state fails closed.

The controller never changes the writer registry, cloud ledger, Git index,
working tree, commit graph, remote refs, pull-request metadata, lifecycle state,
release state, or deployment state. The private temporary body file is removed
after the provider call. Completion restores only the provider marker; it does
not reactivate the expired lane or grant authoring, integration, release,
cleanup, or deployment authority.

## CLI

Create and persist the sealed plan externally:

```sh
node scripts/expired-planned-committed-pr-marker-response-loss.mjs plan \
  --repository=/absolute/path/to/worktree \
  --pull-request=520 \
  --session=<exact-session-id> \
  --json > /secure/path/marker-plan.json
```

Run with the same repository, pull request, and session plus the sealed plan and
owner-only task capability:

```sh
node scripts/expired-planned-committed-pr-marker-response-loss.mjs run \
  --repository=/absolute/path/to/worktree \
  --pull-request=520 \
  --session=<exact-session-id> \
  --plan-file=/secure/path/marker-plan.json \
  --task-authority=/secure/path/task-authority.json \
  --json
```
