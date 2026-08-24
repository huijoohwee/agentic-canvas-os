---
title: "Closed Absent Planned Owner Release"
graphId: "md:closed-absent-planned-owner-release"
doc_type: "Recovery Controller Contract"
date: "2026-08-24"
lang: "en-US"
schema: "agentic-closed-absent-planned-owner-release-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded release of one closed, locally absent, cloud-retired planned owner"
runtime_scope: "one writer-lease registry compare-and-swap"
runtime_claim: "no source, Git, provider, cloud, merge, deployment, or runtime mutation"
runtime_proof: "../__tests__/closed-absent-planned-owner-release-controller.test.mjs"
---

# Closed Absent Planned Owner Release

## Purpose

This controller releases one expired `active`/`planned` writer lease after the
lane has already become terminal everywhere else. It covers the narrow residue
where the worktree, local branch, and remote branch are absent; the draft pull
request is closed and unmerged; its retained provider head is an empty
coordination commit; and the exact cloud claim is already retired as abandoned.

Planning is read-only. Execution changes only the writer-lease registry. It
sets the lease to `released`, clears `admission` and `cloudAuthority`, and embeds
the complete original lease plus content-bound evidence in the terminal local
receipt. The source tree, index, commits, refs, worktrees, pull request, cloud
ledger, runtime, and deployment remain unchanged.

## Exact Closed Boundary

The plan joins all of the following:

- one expired `agentic-writer-lease/v2` `active` lease with `planned`
  admission and its complete registry digest and revision;
- no branch-related scope-expansion intent, active-owned-dirt intent, or
  reviewed-lane entrypoint fence;
- an absent recorded worktree path, no registered matching worktree, and no
  matching local or remote branch;
- one closed, unmerged draft whose body contains exactly the original writer
  marker;
- one retained `refs/pull/<number>/head` ref with a single-parent, zero-path
  commit whose tree equals its base tree;
- a validated collaboration ledger where the locally projected source entry
  joins the lease and the latest claim entry is an abandoned retirement for
  that exact review head;
- zero current cloud-claim projections for the claim ID; and
- a clean Agentic Canvas OS `main` controller at exactly `origin/main`, with a
  digest of the four runtime owner files.

Any evidence drift blocks the CAS. An unrelated writer-registry change also
blocks because the plan seals the full source registry, not only one lease.

## Authorization and Replay

The plan emits exactly:

```text
authorize closed-absent-planned-owner-release <planDigest>
```

No broad approval substitutes for this statement. Persist the plan outside all
repository worktrees as a mode-`0600` JSON file. Persist the exact authorization
as one line in a separate mode-`0600` file. The CLI rejects inline
authorization and non-private, relative, symlinked, or in-repository files.

```bash
node scripts/closed-absent-planned-owner-release.mjs plan \
  --repository=/workspace/repository \
  --target-repository=owner/repository \
  --branch=agent/device/closed-owner \
  --pull-request=123 \
  --claim-id=<sha256> \
  --json
```

After receiving the exact authorization, run with the same immutable subject:

```bash
node scripts/closed-absent-planned-owner-release.mjs run \
  --repository=/workspace/repository \
  --target-repository=owner/repository \
  --branch=agent/device/closed-owner \
  --pull-request=123 \
  --claim-id=<sha256> \
  --plan-file=/private/recovery/plan.json \
  --auth-file=/private/recovery/authorization.txt \
  --json
```

The single CAS writes its response-loss evidence into the released lease. A
retry first classifies that terminal projection and reconstructs the complete
original lease entirely under the registry boundary. Once that exact terminal
projection exists, provider or cloud observation drift and temporary reader
failure cannot erase the completed result or force a second mutation. External
evidence remains mandatory while the source lease is pending, before the first
CAS. A separate transaction journal or repository-owned state file is
unnecessary for this one-effect controller.

## Terminal Receipt

The receipt binds the plan and authorization digests, source and released lease
digests, source and target registry revisions, local release receipt, pull
request number, claim ID, and a deterministic terminal evidence digest. Its
mutation disposition explicitly records `false` for source, Git, provider,
cloud, merge, and deployment effects.
