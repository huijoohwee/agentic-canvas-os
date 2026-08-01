---
title: "Agentic Canvas OS Workspace Parallelism Contract"
graphId: "md:agentic-canvas-os-workspace-parallelism"
doc_type: "Workspace Parallelism Contract"
date: "2026-07-28"
lang: "en-US"
schema: "agentic-canvas-os-workspace-parallelism/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned contract for concurrent sessions across every repository in one workspace root"
publish_policy: "Dev-only until the operator explicitly authorizes Prod or Cloudflare"
runtime_scope: "workspace root containing multiple sibling repositories and their registered worktrees"
runtime_claim: "lane isolation plus a fail-closed destructive-operation gate over existing Git worktree, lease, and lifecycle owners; no new repository manager"
runtime_proof: "RUNTIME-PROOF.md"
owner_scripts:
  - "scripts/workspace-parallelism-lib.mjs"
  - "scripts/workspace-parallelism-guard.mjs"
owner_tests:
  - "__tests__/workspace-parallelism.test.mjs"
owner_command: "npm run workspace:parallelism:check"
---

# Workspace Parallelism Contract

Multiple sessions work at the same time across the sibling repositories under one
workspace root. That is the intended mode, not an exception. This contract makes it
safe by naming what a lane is, proving lanes are isolated, and refusing the specific
operations that destroy work another session is still holding.

It reuses existing owners. Worktree registration stays with the repository guards,
branch and scope claims stay with the writer lease owner, and lane cleanup stays with
the worktree lifecycle owner. This document adds the workspace-wide view those owners
do not have, plus one fail-closed gate.

## Contract

| Rule | Requirement |
|---|---|
| Parallelism is the default | Concurrent sessions across distinct lanes are permitted and expected; serialization is never the safety mechanism. |
| One lane, one session | A lane is one `repository` plus one `worktree` path. Exactly one session owns it at a time. |
| One branch, one worktree | A branch is checked out in at most one worktree inside a repository. |
| One scope, one session | Two sessions never claim the same semantic scope inside one repository. |
| Destructive operations fail closed | Every operation in the forbidden catalog is denied unless the acting session owns a clean lane with a durable recovery reference. |
| Uncommitted work is never collateral | No session may run a destructive operation while another session holds uncommitted or untracked work in the same repository. |
| Untracked means unrecoverable | Untracked paths have no object in the store. A destructive operation over them is refused outright, with no override path in this contract. |
| Recovery references are durable | A recovery reference is a branch, tag, or bundle. A stash is not a recovery reference. |
| Receipt-bound release admission | A retained dirty lane can coexist with an unrelated release only when a checked reconciliation receipt binds its current state and write-set digests, owner, durable recovery handle, and `disjoint` disposition. |
| No new manager | The guard reads existing Git state and existing owners; it does not create a second worktree registry, lease store, or repository manager. |

## Lane Model

A lane is the unit of parallel work. It is declared, not inferred from intent.

```yaml
lane:
  schema: "agentic-workspace-lane/v1"
  repository: "[repository directory name]"
  worktree: "[absolute registered worktree path]"
  branch: "[refs/heads/... or null when detached]"
  session: "[session identity that owns this lane]"
  scope: "[semantic scope claimed inside the repository]"
  dirtyTrackedPaths: 0
  untrackedPaths: 0
  recoveryRef: "[refs/heads/recovery/... , refs/tags/... , bundle path, or null]"
  stateDigest: "[sha256 of tracked patch plus untracked objects]"
  writeSetDigest: "[sha256 of the exact changed-path set]"
```

Lane isolation is checked as three separate properties so a failure names the exact
collision:

| Property | Violated when | Failure names |
|---|---|---|
| Session ownership | One worktree path carries two session owners. | Both session ids and the worktree |
| Branch exclusivity | One branch is live in two worktrees of one repository. | Both worktree paths and the branch |
| Scope exclusivity | One semantic scope inside one repository carries two session owners. | Both session ids and the scope |

## Forbidden Operation Catalog

These classes are denied by default. The catalog is explicit rather than heuristic:
an unlisted operation is treated as non-destructive, so adding a new destructive
command requires adding it here and to the owner library together.

| Class | What it destroys | Representative invocations |
|---|---|---|
| `workingTreeReset` | Tracked working-tree and index state. | `reset --hard`, `reset --merge`, `reset --keep` |
| `untrackedRemoval` | Untracked and ignored files that were never committed. | `clean -f`, `clean -fd`, `clean -fdx` |
| `forcedCheckout` | Working-tree files overwritten without merging. | `checkout --force`, `switch --force`, `restore --worktree`, `--discard-changes` |
| `historyRewrite` | Commits other sessions may depend on. | `push --force`, `push --force-with-lease`, `push --mirror`, `rebase`, `filter-branch` |
| `laneRemoval` | A branch or worktree lane and its claim. | `branch -D`, `worktree remove --force` |
| `objectPruning` | Unreachable objects that are the last copy of lost work. | `gc --prune`, `reflog expire`, `prune` |
| `blindIntegration` | A lane moved to a remote tip while uncommitted work is present. | `pull`, `merge` without `--no-ff` |

`blindIntegration` is in the catalog for one specific reason: a fast-forward that
moves a lane while another session is mid-edit is exactly how written work
disappears without any command that looks destructive on its face.

## Decision Order

The gate evaluates in this order and stops at the first denial, so the returned
message always names the real blocker rather than the last one checked.

1. Classify the invocation. Non-destructive returns `allow` immediately.
2. Deny when the acting session does not own the target lane.
3. Deny when any other session holds uncommitted or untracked work in the same
   repository.
4. Deny when the target lane has untracked paths.
5. Deny when the target lane has modified tracked paths and no recovery reference.
6. Otherwise return `allow-with-recovery`, carrying the recovery reference.

There is no `allow` outcome for a destructive operation. The strongest available
outcome is `allow-with-recovery`, which records what the work can be restored from.

## Recovery Reference Rules

| Rule | Requirement |
|---|---|
| Required when dirty | A lane holding uncommitted work must declare a recovery reference before any destructive operation. |
| Durable only | A branch, tag, or bundle path qualifies. `refs/stash` is rejected because it is anonymous and lives outside every lane claim. |
| Must exist | A declared reference that does not resolve is a failure, not a warning. |
| Untracked is not covered | A recovery reference cannot rescue untracked paths, which is why they are denied at step 4 rather than accepted with a reference. |

## Report Shape

```yaml
report:
  schema: "agentic-workspace-parallelism-report/v1"
  workspaceRoot: "[absolute workspace root]"
  generatedAt: "[ISO 8601 timestamp]"
  repositories: ["[repository names]"]
  sessions: ["[session ids]"]
  parallelLanes: 0
  unrecoverableLanes:
    - lane: "[repository::worktree]"
      session: "[owner]"
      dirtyTrackedPaths: 0
      untrackedPaths: 0
      recoveryRef: null
  forbiddenOperationClasses: ["[catalog keys]"]
  ready: false
```

`ready` is true only when every lane in the workspace is recoverable. A blocked
report is the normal signal that a session is mid-edit somewhere, and it is not a
reason to clean anything.

## Reconciliation Admission

The normal audit remains fail-closed. A release controller may supply an external,
immutable `agentic-workspace-reconciliation-receipt/v1` only to prove that every
currently dirty lane is retained or parked outside the candidate's write scope.
Each receipt item names the lane key, session, current `stateDigest`,
`writeSetDigest`, `disjoint` overlap class, `retained` or `parked` disposition, and
a non-empty durable recovery handle. The receipt also binds the workspace root and
an exact protected-tip SHA. Any missing item, changed byte digest, duplicate item,
empty recovery handle, or overlapping classification fails admission.

Receipt verification is read-only. It does not commit, stash, reset, merge, delete,
or transfer lane contents. The owning lane still requires its own protected PR and
integration path before any of its bytes can reach canonical `main`.

## Legacy Dirty-Lane Adoption

An unleased legacy lane has no normal `device:start` or `device:resume` transition.
It must not be committed, rebased, copied, or assigned a fabricated lease. The
repository-owned adoption controller provides a bounded two-phase recovery path:

1. `capture` reads the registered legacy worktree without changing its files,
   index, branch, refs, or objects. It records the exact source branch and HEAD,
   protected tip, binary tracked patch, raw copies of every changed and untracked
   path, file modes and symlink targets, and state, write-set, patch, file, and
   package digests. A second evidence read must match before capture succeeds.
2. `adopt` revalidates every package byte and the still-unchanged legacy source. It
   accepts only a clean registered target whose exact active writer lease belongs
   to the capturing session and started at the captured protected tip. It rejects
   untracked-path collisions before running a three-way patch preflight, then
   imports the captured bytes and emits an external adoption receipt.

The legacy lane remains untouched and retained until its adopted pull request is
protected-merged and independently verified. Capture and adoption do not merge,
push, deploy, clean, or grant release authority.

## Enforcement Surfaces

A contract that only this repository's own scripts honor is advice, not enforcement.
These surfaces apply to any tool that shells out to Git, including tools that have
never read this document.

| Surface | Mechanism | Classes it can refuse | What it proves |
|---|---|---|---|
| `pre-commit` | Git hook | none (committing is never destructive) | The lane is registered, conflict-free, and isolated before a commit is recorded. |
| `pre-push` | Git hook, reads the update list on stdin | `historyRewrite`, `laneRemoval` | Forced updates and remote ref deletions are refused without lane ownership and a recovery reference. Fast-forward pushes pass untouched. |
| `reference-transaction` | Git hook, fires on every ref transaction in the `prepared` state | `workingTreeReset`, `historyRewrite`, `laneRemoval`, `blindIntegration` | Ref deletions and rewinds are refused before the transaction commits, whichever command triggered them. |
| Wrapper (`git-guarded`) | PATH shim executed in place of `git` | every class in the catalog | Each invocation is classified before the real Git process runs. |

### Hook coverage gap

Git exposes no hook for commands that only touch the working tree, and none for
object maintenance. Three classes are therefore unreachable from hooks:

| Class | Why no hook sees it |
|---|---|
| `untrackedRemoval` | `clean` changes no ref and creates no transaction. |
| `forcedCheckout` | `checkout --force` and `restore --worktree` overwrite files without a ref update; `post-checkout` fires after the damage. |
| `objectPruning` | `gc`, `prune`, and `reflog expire` neither commit a ref transaction nor push. |

The wrapper is the only surface that closes this gap. Installing hooks without the
wrapper leaves the single most destructive command in the catalog, `clean -fdx`,
completely ungated. `buildEnforcementCoverageReport()` reports this gap as data so
the claim cannot silently drift from the implementation.

### Install

| Need | Command |
|---|---|
| Preview what would be installed | `npm run workspace:guards:install -- --dry-run` |
| Install hooks in every workspace repository plus the PATH shim | `npm run workspace:guards:install` |
| Read the coverage report | `npm run workspace:guards:coverage` |

The installer sets `core.hooksPath` in each repository to this repository's
`.githooks` directory, so there is one hook source of truth and no copied hook
drift. It writes hook configuration and the shim only; it never touches tracked
files, refs, or working-tree state in any repository.

To guard external tooling, put the generated shim directory ahead of Git on `PATH`:

```sh
export PATH="[guard home]/.githooks/bin:$PATH"
```

### Bypass

The bypass is deliberately not a flag and deliberately verbose, so it cannot be
typed by reflex or hidden in an alias:

```sh
AGENTIC_WORKSPACE_GUARD_BYPASS=i-accept-destroying-unrecoverable-work git clean -fdx
```

A bypassed operation still prints what it is destroying before it proceeds.

## Invocation

| Need | Command |
|---|---|
| Audit every lane in the workspace | `npm run workspace:parallelism:check` |
| Machine-readable audit | `npm run workspace:parallelism:check -- --json` |
| Verify retained disjoint work for a release controller | `npm run workspace:parallelism:check -- --reconciliation-receipt "[immutable receipt path]"` |
| Capture an unleased dirty legacy lane | `npm run workspace:legacy-adoption -- capture --source="[worktree]" --recovery="[new directory]" --protected-tip="[40-hex main SHA]" --session="[operator session]"` |
| Verify a captured legacy recovery package | `npm run workspace:legacy-adoption -- verify --recovery="[directory]"` |
| Adopt into an exact active leased lane | `npm run workspace:legacy-adoption -- adopt --source="[legacy worktree]" --recovery="[directory]" --target="[clean leased worktree]" --session="[same operator session]"` |
| Review one operation before running it | `npm run workspace:parallelism:check -- --operation "git reset --hard"` |
| Install or preview enforcement surfaces | `npm run workspace:guards:install [-- --dry-run]` |

Environment inputs: `AGENTIC_WORKSPACE_ROOT` overrides the discovered workspace root,
and `AGENTIC_SESSION_ID` names the acting session. Both default without failing so an
audit is always runnable.

## Boundaries

- The guard reads Git state and writes nothing. It never stages, commits, stashes,
  resets, cleans, checks out, prunes, or removes a lane.
- The guard has no authority to resolve a collision. It names the collision and exits
  non-zero; a human or the owning session resolves it.
- A blocked report grants no permission to delete, move, or overwrite the work that
  caused the block.
- Discovery skips dotted directories at the workspace root, so backup, worktree, and
  quarantine directories are not treated as lanes.
- A Dev merge does not authorize Prod mirror or Cloudflare mutation. This contract
  adds no deploy authority.

## VCCs

| VCC | Check |
|---|---|
| Catalog is complete and explicit | Every class in the forbidden catalog has at least one classified representative invocation, and read-only or additive invocations classify as non-destructive. |
| Lane isolation is proven per property | Session, branch, and scope collisions each fail with a message naming the colliding parties. |
| Foreign lanes are protected | A destructive operation is refused while another session holds uncommitted or untracked work in the same repository. |
| Untracked work is never discarded | A destructive operation over a lane with untracked paths is refused with no override in this contract. |
| Recovery is durable | A dirty lane requires an existing branch, tag, or bundle reference; a stash reference is rejected. |
| Destructive operations never return plain allow | The strongest outcome for a catalog operation is `allow-with-recovery` and it carries the recovery reference. |
| Audit is read-only | A full workspace audit reports lanes and at-risk work without mutating any repository. |
| Report readiness is honest | `ready` is true only when no lane holds untracked work or unreferenced modifications. |
| Ref transactions are classified | Create, fast-forward update, noop, rewind, and delete are distinguished, and only rewind and delete are gated. |
| Hooks refuse external commands | A `branch -D` or forced push issued by any tool is refused while the lane holds untracked work or lacks a recovery reference. |
| The coverage gap is reported, not hidden | The coverage report names every class no hook can reach and marks the wrapper as required. |
| One hook source of truth | Every workspace repository points `core.hooksPath` at one directory; no hook file is copied into a second location. |
| The installer mutates nothing else | Installation writes hook configuration and the PATH shim only, with no ref, index, or working-tree change in any repository. |
| Bypass is explicit and loud | Override requires a full sentinel value in the environment, never a flag, and still reports what it destroys. |
