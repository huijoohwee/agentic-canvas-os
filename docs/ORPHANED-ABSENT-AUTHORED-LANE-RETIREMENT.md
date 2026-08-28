---
title: "Orphaned Absent-Authored Lane Retirement"
graphId: "md:agentic-orphaned-absent-authored-lane-retirement"
doc_type: "Recovery Controller Contract"
date: "2026-08-28"
lang: "en-US"
schema: "agentic-orphaned-absent-authored-lane-retirement-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "one exact typed authorization for an absent authored owner lane"
runtime_scope: "draft pull-request closure and same-claim cloud retirement"
runtime_claim: "remote branch, ref, commits, source state, local state, merge, release, and deployment are preserved"
runtime_proof: "../__tests__/orphaned-absent-authored-lane-retirement-contract.test.mjs; ../__tests__/orphaned-absent-authored-lane-retirement-controller.test.mjs; ../__tests__/orphaned-absent-authored-lane-retirement-repository-adapter.test.mjs; ../__tests__/orphaned-absent-authored-lane-retirement-cli.test.mjs"
---
<!-- Responsibility: Close one abandoned draft and retire its exact dormant cloud claim without adopting or deleting authored bytes. -->

# Orphaned absent-authored lane retirement

`orphaned-absent-authored-lane-retirement` is a narrow recovery controller for an
admitted cloud lane whose private owner projection is gone while an authored
remote branch and open draft pull request remain.

It is not an ownership takeover, merge path, or cleanup command. The controller
preserves the remote branch, remote ref, and every commit. It never creates a
worktree or local branch, releases a local lease, merges, deploys, or deletes
source state.

## Closed eligibility

Planning succeeds only when all of these facts join one identity:

- the authenticated GitHub actor and repository own the exact cloud claim;
- the claim is expired and projects `dormant-preserved`, with
  `writeAuthority:false` and `scopeReserved:true`;
- exactly one open, draft, unmerged, unqueued pull request retains a complete
  writer marker and public task-authority binding;
- the claim lane revision is a single-parent, zero-tree-change coordination
  commit over its canonical base;
- the retained remote head is a non-empty, strict linear descendant of that
  lane revision; every authored commit carries the exact Agentic trailers, and
  every changed path is explicitly declared;
- the target Git common-directory has no matching registered worktree, local
  branch, writer lease, or private task-authority artifact; and
- the installed controller is clean `main` at exact `origin/main` and remote
  main.

The target/provider/cloud evidence is double-read before the plan is persisted.
The only planning write is the external private journal supplied with
`--state-path`.

The evidence and controller contracts are headless and storage-neutral. This
repository adapter binds private-artifact absence to the local Codex adapter's
trusted `${CODEX_HOME}/task-state` boundary (or the standard local Codex home
when that environment setting is absent). A caller cannot substitute an empty
directory as absence evidence; another orchestration host must supply its own
trusted repository adapter rather than weakening this boundary.

## Effects and recovery order

An exact authorization permits two effects, in this order:

1. close only the exact draft pull request by patching `state=closed`;
2. revalidate the same dormant claim, then retire it as `abandoned` with the
   claim's lane revision as `finalRevision`.

Closing first leaves the safer recoverable residue if cloud retirement is
unavailable. Every phase is journaled and classified before mutation, so a lost
provider or cloud response is reconciled without repeating or widening the
operation. Terminal verification proves the exact close and same-operation
ledger entry while rechecking branch, commit-range, and local-absence
preservation.

## Usage

Run from protected ACOS `main` after the claim expiry:

```sh
node scripts/orphaned-absent-authored-lane-retirement.mjs plan \
  --repository=/absolute/path/to/target \
  --target-repository=owner/repository \
  --pull-request=123 \
  --claim-id=<64-hex-claim-id> \
  --private-task-root=/absolute/private/task-state \
  --state-path=/absolute/private/retirement-journal.json \
  --json
```

The plan returns its content digest and exact authorization string. Write that
one line plus a final newline to a private owner-only (`0600`) file outside all
repositories and worktrees, then run the sealed plan:

```sh
node scripts/orphaned-absent-authored-lane-retirement.mjs run \
  --repository=/absolute/path/to/target \
  --target-repository=owner/repository \
  --pull-request=123 \
  --claim-id=<64-hex-claim-id> \
  --private-task-root=/absolute/private/task-state \
  --state-path=/absolute/private/retirement-journal.json \
  --plan-digest=<plan-digest> \
  --auth-file=/absolute/private/retirement-authorization.txt \
  --json
```

Re-running `run` with the same plan and authorization performs terminal
verification and returns the same completion receipt.
