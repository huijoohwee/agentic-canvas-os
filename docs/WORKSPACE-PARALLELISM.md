---
title: "Agentic Canvas OS Workspace Parallelism Contract"
graphId: "md:agentic-canvas-os-workspace-parallelism"
doc_type: "Workspace Parallelism Contract"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-canvas-os-workspace-parallelism/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned contract for concurrent sessions across every repository in one workspace root"
publish_policy: "Dev-only until the operator explicitly authorizes Prod or Cloudflare"
runtime_scope: "workspace root containing multiple sibling repositories and their registered worktrees"
runtime_claim: "lane isolation plus a fail-closed destructive-operation gate over existing Git worktree, lease, and lifecycle owners; no new repository manager"
runtime_proof: "RUNTIME-PROOF.md"
guideline_source_revision: "8a2e5e0711f7193535b9aac2aee285e0ee705111"
guideline_source_tree: "63c13dcfb3ce01aa60213f4f6fa214bfa0e76778"
guideline_source_digest: "ff4f0dc41209bdacb05001b6fd5a450883736118f89fcff6fab331cedca8c2bd"
git_companion_digest: "c8831f6c6642f89c3e5f51af55523e1e4db1ed08b118840daa0d4f28289806e5"
owner_scripts:
  - "scripts/workspace-parallelism-lib.mjs"
  - "scripts/workspace-parallelism-guard.mjs"
  - "scripts/worktree-lifecycle-lib.mjs"
  - "scripts/worktree-lifecycle.mjs"
  - "scripts/task-worktree-owned-containers.mjs"
  - "scripts/recoverable-lane-cleanup-contract.mjs"
  - "scripts/recoverable-lane-cleanup-controller.mjs"
  - "scripts/recoverable-lane-cleanup-recovery-store.mjs"
  - "scripts/recoverable-lane-cleanup-repository-adapter.mjs"
  - "scripts/recoverable-lane-cleanup.mjs"
  - "scripts/history-lifecycle-contract.mjs"
  - "scripts/history-lifecycle-controller.mjs"
  - "scripts/history-lifecycle-repository-adapter.mjs"
  - "scripts/history-lifecycle.mjs"
owner_tests:
  - "__tests__/workspace-parallelism.test.mjs"
  - "__tests__/worktree-lifecycle.test.mjs"
  - "__tests__/device-integrate.test.mjs"
  - "__tests__/task-worktree-provision.test.mjs"
  - "__tests__/recoverable-lane-cleanup-contract.test.mjs"
  - "__tests__/recoverable-lane-cleanup-controller.test.mjs"
  - "__tests__/recoverable-lane-cleanup-repository-adapter.test.mjs"
  - "__tests__/recoverable-lane-cleanup-cli.test.mjs"
  - "__tests__/history-lifecycle-contract.test.mjs"
  - "__tests__/history-lifecycle-controller.test.mjs"
  - "__tests__/history-lifecycle-repository-adapter.test.mjs"
  - "__tests__/history-lifecycle-cli.test.mjs"
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
| One current writer per overlap | Two claims whose normalized declared write sets overlap never hold current write authority at the same time. |
| Unlimited disjoint concurrency | There is no global policy cap on pairwise-disjoint current authorities; input-size bounds are resource controls only. |
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
  claim: "[authenticated cloud claim identity]"
  authorityEpoch: 0
  fence: "[current cloud fence]"
  authorityState: "[current, waiting-successor, reviewed, integrated-preserved, dormant-preserved, or retired]"
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
| Write-authority exclusivity | Overlapping normalized write sets in one repository carry two current writers. | Both claim ids, both write-set digests, and the overlap |

## Cloud Authority And Successors

The provider-neutral mutation surface is exactly `claim(scope)`,
`continue(claim)`, `integrate(candidate)`, and `retire(claim)`. Local worktrees,
writer leases, branches, pull requests, review labels, device/session metadata,
and provider identifiers are replaceable projections of those roots. A local
lease or clean worktree cannot create, renew, transfer, or retire cloud
authority.

Disjoint claims may be current concurrently without a global cardinality cap.
An overlapping newcomer is recorded as a non-writing waiting successor. Only
one current claim may write an overlapping declared set, and successor promotion
rechecks the live ledger through monotonic compare-and-swap. Expiry derives
`dormant-preserved`: write authority ends while the overlap reservation and all
authored bytes remain preserved. Recovery authenticates the same actor and
claim against live state and does not depend on an expired local lease, device,
session, or worktree.

Review identity and revision are immutable. Typed claim, continuation,
integration, and retirement receipts bind every transition. Missing
authentication, stale expected-ledger digest, competing overlap, changed review
evidence, or absent predecessor receipt fails closed.

## Cross-Repository Coordination Units

A cross-repository task is a dependency-ordered DAG of immutable
per-repository units, not a shared lane. Each unit retains its own repository,
authenticated repository authority identity, branch, registered worktree,
semantic scope, normalized write set and digest, claim, authority epoch, fence,
pull request, source revision and digest, named checks, and handoff evidence.
Units have distinct claims, branches, worktrees, and leases even when they share
a task identity.

Projection admission joins the unit's `repositoryId` exactly to the authenticated
cloud claim, its `semanticScope` exactly to the local lane scope, and its
`writeSetDigest` exactly to both the local lane and cloud claim. Distinct-looking
or one-to-one invented identities do not satisfy any join.

The pinned JH source unit at revision
`8a2e5e0711f7193535b9aac2aee285e0ee705111` and tree
`63c13dcfb3ce01aa60213f4f6fa214bfa0e76778` precedes this ACOS projection unit.
Its guideline digest is
`ff4f0dc41209bdacb05001b6fd5a450883736118f89fcff6fab331cedca8c2bd`
and its companion digest is
`c8831f6c6642f89c3e5f51af55523e1e4db1ed08b118840daa0d4f28289806e5`.
The dependency is `JH guideline/checker -> ACOS coordination/runtime/registration`;
it orders integration evidence without sharing authority.

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

This v1 `ready` field governs destructive-operation recoverability only. It is
not additive authoring admission, runtime readiness, lifecycle readiness, or
cleanup authority. `SCOPED-LANE-ADMISSION.md` owns the separate
`authoringAdmission: planned|admitted|blocked` decision for adding one
cloud-authorized disjoint lane while this report remains blocked. Its
`runtimeReadiness`, `lifecycleReadiness`, and `admissionRuntimeConformance`
results remain independent and use their own exact vocabularies and receipts.

The scoped runtime preserves this contract's observed lanes byte-for-byte. Each
accepted peer must join its local projection to exactly one current
operation-derived remote claim across claim/fence identity, base and lane
revisions, normalized write set, epoch/counter, state, expiry, and review
request. Missing, stale, duplicated, fabricated, or legacy local-only authority
fails closed. Its present Preservation Receipt accepts only unchanged peers:
full shared coordination-state comparison and typed independent peer-operation
receipts are not yet supported, so any peer or pre-existing-lane drift blocks
admission while `admissionRuntimeConformance`, `runtimeReadiness`, and
`lifecycleReadiness` remain independently `unevaluated`.

Candidate provisioning takes the Git-common-directory registry lock, proves the
registry gained exactly one clean detached worktree whose HEAD and tree equal
the admitted base, and binds the before/after inventories into its typed result.
Successful machine JSON retains both the full final admitted report and the
fresh mutation-authority receipt. Failure never grants cleanup authority: an
externally acquired cloud claim remains owner-controlled for an exact retry or
an authenticated `continue(claim)` or `retire(claim)` operation.

Review is a `continue(claim)` projection that binds the exact pushed head,
review identity, and focused evidence before the local lease is released.
Heartbeat is a continuation renewal. Protected integration projects
`integrate(candidate)` only with exact dependency, named-check, handoff, review,
and operator evidence. A retry accepts an already completed operation only when
the claim, receipt, and review subject are byte-for-byte identical. Ordinary
local-only resume and park refuse a cloud-admitted lane; its authenticated owner
must continue or retire the exact claim through the cloud authority.

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
   package digests. Profiles bound to protected `main` read its current SHA with
   `git ls-remote`; they never fetch into the dirty source and require every proof
   commit to be already present. A second evidence read must match before capture
   succeeds.
2. `adopt` revalidates every package byte and the still-unchanged legacy source. It
   accepts only a clean registered target whose exact live writer-lease digest
   belongs to the capturing session and started at the captured protected tip.
   The repository registry lock and digest compare-and-swap fence remain held from
   target preflight through patch/copy and receipt publication; expiry or lease
   replacement fails before target mutation. It rejects divergent untracked-path
   collisions while recording byte-identical upstream paths as already integrated.
   A caller may declare exact tracked paths for bounded semantic reconciliation;
   the controller excludes only those paths, three-way applies the remainder, and
   emits `reconciliation-required` rather than claiming complete adoption.

The legacy lane remains untouched and retained until its adopted pull request is
protected-merged and independently verified. Capture and adoption do not merge,
push, deploy, clean, or grant release authority.

A non-ancestor task branch whose committed tree was squash-integrated has one
strict capture profile: `--capture-profile=task-lane-squash-integrated`. The
command derives the repository from the source's normalized GitHub HTTPS, SSH
URL, or SCP origin and rejects a conflicting explicit `--repository` value before
requesting the exact REST pull-request payload. It requires a closed, non-draft, merged,
same-repository pull request into `main`; exact source branch and HEAD identity; a
single-parent integration commit at the recorded base; that commit as an ancestor
of the exact remote protected tip (which may be a later descendant); and
byte-identical source-HEAD and integration trees. Verification repeats every
pull-request semantic check even for a redigested package. Adoption reruns the
remote-tip, commit ancestry, parent, and tree checks from the repository and must
reproduce the digest-bound proof. A pull-request number, local branch name, tree
match, package digest, or ancestry claim alone is insufficient. Example:

```sh
npm run workspace:legacy-adoption -- capture \
  --source="[registered legacy worktree]" \
  --recovery="[new external recovery directory]" \
  --protected-tip="[exact remote origin/main SHA]" \
  --session="[operator session]" \
  --capture-profile=task-lane-squash-integrated \
  --pull-request="[merged pull request number]" \
  --repository="[owner/repository]" --json
```

During adoption, `--reconcile` may name exact tracked residue that must not be
transferred. If every tracked entry is reconciled, the controller deliberately
skips the now-empty patch and restores only admitted untracked paths; the receipt
remains `reconciliation-required` and lists both sets explicitly.

For an unrelated canonical repository whose primary `main` worktree contains
only untracked retained content, capture has a separate preservation-only profile:
`--capture-profile=canonical-untracked-retention`. It reads `origin/main` with
`ls-remote` without updating a local ref or object, then requires the registered
primary worktree, branch `main`, exact `HEAD == remote-main == protected-tip`, zero
tracked/index changes, zero conflicts, and at least one untracked path. It copies
and digest-binds those paths without changing the source. The resulting package
cannot be adopted; it is only a durable recovery handle for an external
disjoint-lane reconciliation receipt. This profile does not authorize cleanup,
staging, committing, branch creation, or publication.

## Already-Integrated Legacy Lane Disposition

When a non-ancestor legacy task branch has only unstaged tracked changes and its
complete committed branch write set is covered by those same paths, the bounded
disposition adapter may detach that worktree only after every working path's mode
and blob exactly equals fetched protected `origin/main`. It rejects staged,
untracked, deleted, conflicting, non-file, partially covered, remote-drifted, or
non-equivalent state. The remote task branch must still resolve to the exact
pre-disposition HEAD, so its commits remain durable even though the worktree moves.

The command writes a digest-bound external receipt in `prepared` state, rechecks
the complete evidence and both remote refs, detaches at the exact protected tip,
proves a clean checkout, then records `completed`. It does not delete a branch or
worktree, close a pull request, edit a lease, merge, deploy, or grant Production
authority. The explicit acknowledgement applies only to the exact supplied SHAs:

```sh
npm run workspace:legacy-integrated-disposition -- \
  --source="[registered legacy worktree]" \
  --branch="[exact task branch]" \
  --expected-head="[exact remote task HEAD]" \
  --protected-tip="[exact fetched origin/main]" \
  --session="[operator session]" \
  --receipt="[external receipt path]" \
  --acknowledge-protected-equivalence --json
```

## Recoverable Clean-Lane Cleanup

Recoverable cleanup is an exceptional, one-lane controller for a registered,
attached, non-`main` worktree that is completely clean and has no current local writer.
It does not change the ordinary completed-lane lifecycle or make a preserved lane
automatically cleanup-eligible. Dirty, conflicted, untracked, ignored, submodule-
dirty, or in-progress Git operation state fails before an intent or effect exists.

`plan` is read-only and double-captures the repository, canonical `origin/main`,
target branch, HEAD, tree, working state, authority, and observed preservation
receipts. It binds one normalized external recovery directory, one operator session,
one no-remaining-value decision digest, and the exact sorted preservation receipts
being superseded. The resulting authorization is literal and plan-specific:

```text
authorize recoverable-lane-cleanup <planDigest>
```

`run` revalidates the same evidence under a subject fence, persists an external
intent, creates and independently verifies a complete Git bundle for the exact
branch, then rechecks the target immediately before moving the whole checkout into
the private same-filesystem recovery directory. The controller atomically preserves
that checkout as `worktree-snapshot`, including any file created during the final
race window, and invokes non-force `git worktree remove` only against the now-absent
private staging path. It never deletes the snapshot, local or remote branches,
mutates provider objects or pull requests, prunes worktrees or objects, merges, or
deploys. The completed receipt binds the authorization, bundle bytes, snapshot,
exact before/after state, registration generation, and preserved branch identities.

Interrupted runs reconcile the durable phases `prepared`, `bundle_verified`,
`worktree_quarantined`, `worktree_removed`, and `complete`. An already absent exact
target may complete only when its staging registration, preserved snapshot,
canonical branch, task branch, remote branch, bundle, and original Git-directory
generation match the plan. A recreated path, split registration, or identity drift
fails closed for manual review.

```sh
npm run worktree:lifecycle:recoverable-cleanup -- plan \
  --repository="[canonical repository root]" \
  --worktree="[registered clean task worktree]" \
  --recovery-directory="[new external recovery directory]" \
  --session="[operator session]" \
  --operator-decision-digest="[sha256]" \
  [--supersede-preservation="[receipt sha256]"] --json

npm run worktree:lifecycle:recoverable-cleanup -- run \
  --repository="[same canonical repository root]" \
  --worktree="[same registered clean task worktree]" \
  --recovery-directory="[same external recovery directory]" \
  --session="[same operator session]" \
  --operator-decision-digest="[same sha256]" \
  --plan-digest="[planDigest]" \
  --authorize="authorize recoverable-lane-cleanup [planDigest]" --json
```

## Completed-Lane Container Cleanup

Ordinary provider-neutral device integration delegates cleanup to the repository-owned worktree
lifecycle controller only after the exact task result has converged to canonical
`main`. The controller removes the exact registered task worktree through Git without
force, then proves that same absolute target is absent from both the worktree registry
and the filesystem. It returns the unchanged typed
`agentic-worktree-cleanup-result/v1` receipt; only `cleaned` and idempotent
`already-cleaned` outcomes with exact absence evidence complete integration. The
receipt binds the absolute Git common directory, repository-derived container roots,
preserved task branch, and stable operation identity without provider assumptions.

Container cleanup is narrower than lane cleanup. After target removal, the controller
may issue nonrecursive empty-directory removal for the derived managed repository
parent and then its shared `.worktrees` parent. A directory is removed only when it is
the exact derived managed location, is an ordinary directory rather than a symbolic
link, and its identity is pinned and immediately revalidated under the cooperative
Git-common-directory registry lock. Observed drift is retained; this boundary claims
no atomic immunity to an out-of-contract same-user path swap after the final check.
A nonempty, symbolic-link, or externally located container is retained and named by a
safe typed disposition. No recursive deletion, branch deletion, provider mutation,
merge, deployment, or inferred path ownership is authorized.

The device consumer repeats the same cleanup child command at most once when the
first synchronous child stdout is absent or unparseable. Thrown, nonzero, and
parseable-invalid results are not retried. This same-process response recovery is not
top-level lost-final-stdout recovery or canonical-root device replay.

Use the orphan-container command once after upgrading an existing workspace whose
last worktree was removed by an older lifecycle version:

```sh
npm run worktree:lifecycle:cleanup-empty -- --repository="[canonical repository root]"
```

This command applies the same derived-root and nonrecursive-empty checks. It does not
remove a registered worktree or make a retained directory cleanup-eligible.

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
Repository-owned guard scripts remain optional: shared hooks run repo-specific
checks only when the target repository actually provides them.

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

## Historical Audit and Planning

`history:lifecycle audit` captures bounded Git, worktree, lease, remote, change, anchor,
and stash evidence without fetching or writing. The CLI has a GitHub reference adapter;
core provider identities stay opaque. `plan` requires one pinned analysis bracketed by
identical frontiers, with no authority, authorization, intent, lock, journal, or receipt.
Unobservable reflog ancestry and current-main stash projection stay unknown; age, names,
messages, and missing upstreams never prove retirement; mutation must recapture and gain authority.

## Invocation

| Need | Command |
|---|---|
| Audit every lane in the workspace | `npm run workspace:parallelism:check` |
| Machine-readable audit | `npm run workspace:parallelism:check -- --json` |
| Audit or plan historical refs and stashes | `npm run history:lifecycle -- <audit\|plan> --repository="[repository]" --comparison-ref="[full ref]" [--remote="[remote]"] [--provider-repository="[GitHub owner/name]"] --json` |
| Verify retained disjoint work for a release controller | `npm run workspace:parallelism:check -- --reconciliation-receipt "[immutable receipt path]"` |
| Capture an unleased dirty legacy lane | `npm run workspace:legacy-adoption -- capture --source="[worktree]" --recovery="[new directory]" --protected-tip="[40-hex main SHA]" --session="[operator session]"` |
| Verify a captured legacy recovery package | `npm run workspace:legacy-adoption -- verify --recovery="[directory]"` |
| Adopt under an exact live registry lease fence | `npm run workspace:legacy-adoption -- adopt --source="[legacy worktree]" --recovery="[directory]" --target="[clean leased worktree]" --session="[same operator session]" [--reconcile="[tracked/path,tracked/path]"]` |
| Plan or run one exact recoverable clean-lane removal | `npm run worktree:lifecycle:recoverable-cleanup -- <plan|run> ...` |
| Archive one verified recovery package without purging evidence | `npm run recovery:artifact:retirement -- <plan|run|observe> ...` |
| Remove managed empty-container residue after a legacy cleanup | `npm run worktree:lifecycle:cleanup-empty -- --repository="[canonical repository root]"` |
| Review one operation before running it | `npm run workspace:parallelism:check -- --operation "git reset --hard"` |
| Install or preview enforcement surfaces | `npm run workspace:guards:install [-- --dry-run]` |

Environment inputs: `AGENTIC_WORKSPACE_ROOT` overrides the discovered workspace root, and
`AGENTIC_SESSION_ID` names the acting session. Both default so an audit is always runnable.

## Boundaries

- The guard reads Git state and writes nothing. It never stages, commits, stashes,
  resets, cleans, checks out, prunes, or removes a lane.
- The guard has no authority to resolve a collision. It names the collision and exits
  non-zero; a human or the owning session resolves it.
- A blocked report grants no permission to delete, move, or overwrite the work that
  caused the block.
- An admitted source lane grants no destructive-operation authority; this guard
  still evaluates that operation and every existing lane independently.
- Recoverable cleanup authority is plan-specific and one-shot. It grants no branch,
  remote, provider, pull-request, object-pruning, integration, or deploy authority.
- Empty-container cleanup is nonrecursive, derived-root-only maintenance and grants no
  lane, branch, provider, integration, or deployment authority.
- Historical audit and planning are read-only evidence; their output cannot authorize archival, selector retirement, ref deletion, object pruning, provider mutation, or deployment.
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
| Completed cleanup is exact and idempotent | Focused lifecycle and integration tests require exact target removal or proved absence, no registry prune, unchanged typed-receipt propagation, and only safe managed or external container dispositions. |
| Exceptional clean-lane removal is recoverable | The exact task branch is bundled and independently verified, then the full checkout is atomically preserved before one non-force staging-registration removal; branch refs and canonical state remain unchanged. |
| Destructive operations never return plain allow | The strongest outcome for a catalog operation is `allow-with-recovery` and it carries the recovery reference. |
| Audit is read-only | A full workspace audit reports lanes and at-risk work without mutating any repository. |
| Historical planning is advisory | Pinned evidence has identical bracket and verification frontiers, effects are empty, authority is null, and no ref, stash, worktree, object, provider, or lock changes. |
| Report readiness is honest | `ready` is true only when no lane holds untracked work or unreferenced modifications. |
| Scoped readiness stays separate | Workspace `ready` never promotes `authoringAdmission`, `runtimeReadiness`, `lifecycleReadiness`, or `admissionRuntimeConformance`. |
| Ref transactions are classified | Create, fast-forward update, noop, rewind, and delete are distinguished, and only rewind and delete are gated. |
| Hooks refuse external commands | A `branch -D` or forced push issued by any tool is refused while the lane holds untracked work or lacks a recovery reference. |
| The coverage gap is reported, not hidden | The coverage report names every class no hook can reach and marks the wrapper as required. |
| One hook source of truth | Every workspace repository points `core.hooksPath` at one directory; no hook file is copied into a second location. |
| The installer mutates nothing else | Installation writes hook configuration and the PATH shim only, with no ref, index, or working-tree change in any repository. |
| Bypass is explicit and loud | Override requires a full sentinel value in the environment, never a flag, and still reports what it destroys. |
