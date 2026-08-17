---
title: "Scoped Concurrent Lane Admission Contract"
graphId: "md:agentic-scoped-lane-admission"
doc_type: "Runtime Contract"
date: "2026-07-30"
lang: "en-US"
schema: "agentic-scoped-lane-admission-contract/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "additive registered-worktree admission while preserving every existing lane"
runtime_scope: "read-only lane planning, operation-derived cloud-authority verification, candidate-only device:start provisioning, and receipt-joined authoring admission"
runtime_claim: "the bounded source-lane path is executable and focused-tested; full shared-coordination-state and independently advancing peer receipt support remain fail-closed and unevaluated"
runtime_owner: "../scripts/scoped-lane-admission-lib.mjs; ../scripts/scoped-lane-admission-state.mjs; ../scripts/scoped-lane-cloud-authority.mjs; ../scripts/scoped-lane-cloud-reconciliation.mjs; ../scripts/scoped-lane-admission.mjs; ../scripts/scoped-lane-admission-cli.mjs; ../scripts/scoped-lane-bootstrap-authorization.mjs; ../scripts/scoped-lane-bootstrap-maintenance.mjs; ../scripts/task-worktree-provision.mjs; ../scripts/device-branch.mjs; ../scripts/device-start-lib.mjs; ../scripts/device-branch-lib.mjs; ../scripts/device-branch-ownership-lib.mjs; ../scripts/device-resume-lib.mjs; ../scripts/device-resume-replay-lib.mjs; ../scripts/device-park-lib.mjs; ../scripts/writer-lease-lib.mjs"
runtime_proof: "../__tests__/scoped-lane-admission.test.mjs; ../__tests__/scoped-lane-cloud-authority.test.mjs; ../__tests__/scoped-lane-bootstrap-admission.test.mjs; ../__tests__/scoped-lane-clean-preservation-bootstrap.test.mjs; ../__tests__/cloud-collaboration-contract.test.mjs; ../__tests__/github-cloud-collaboration-adapter.test.mjs; ../__tests__/device-start.test.mjs; ../__tests__/device-branch-lib.test.mjs; ../__tests__/device-branch-cli.test.mjs; ../__tests__/device-review.test.mjs; ../__tests__/task-worktree-provision.test.mjs; ../__tests__/writer-lease-lib.test.mjs"
report_schema: "schemas/scoped-lane-admission-report.v1.schema.json"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
---

# Scoped Concurrent Lane Admission

An exact local-only review reservation may project as `retired-preserved` only
after the repository-owned provider-first terminalizer records a valid
`agentic-local-review-retirement-receipt/v1`. Its historical semantic scope and
write set no longer block a successor on a different branch. The preserved
branch remains reserved, cleanup remains forbidden, and a matching current
cloud claim invalidates the projection. See
[`LOCAL-REVIEW-RETIREMENT.md`](./LOCAL-REVIEW-RETIREMENT.md).

## Decision

Adding one isolated task lane is a different decision from declaring the whole
workspace lifecycle-ready. Preserve every pre-existing worktree in place,
evaluate one exact semantic scope and declared write set, acquire current cloud
authority, and create only the candidate named by an accepted Admission Receipt.
A repository-wide lifecycle report may remain `attention-required` while the
independent additive result becomes `authoringAdmission: admitted`.

This contract never cleans, parks, stashes, adopts, edits, or otherwise repairs
another lane. It does not weaken `worktree:lifecycle:check`; that global owner
keeps its existing status and cleanup rules.

## Branch Sync Model

`agentic-canvas-os` treats canonical and task branches as different surfaces
with different authority:

| Surface | Operational meaning |
|---|---|
| `origin/main` | The published canonical frontier and remote SSOT for this repository. |
| local `main` | The local canonical sync lane. Keep it clean, use it to fetch and fast-forward, and restore it to exact parity after temporary-lane work lands. |
| `agent/...` or other temporary task branch | The normal authoring lane for scoped implementation, verification, review, and recovery. |

The default workflow is:

1. sync local `main` to the exact current `origin/main` revision;
2. admit one isolated task lane from that clean canonical base;
3. author, verify, and review from the temporary lane rather than from local
   `main`;
4. integrate the verified lane through the protected path that updates
   `origin/main`;
5. pull the new canonical frontier back into local `main`; and
6. delete the temporary lane only after canonical parity and merge proof are
   both established.

If authoring begins on local `main` by accident, preserve the exact authored
bytes by moving them into one temporary lane before the next ordinary commit,
review, or publication step. Local `main` may transiently be ahead, behind, or
diverged while that rescue occurs, but the cleanup target remains exact parity
with `origin/main`.

## Owners

| Concern | Owner |
|---|---|
| Pure normalization, classification, findings, and report digest | `scoped-lane-admission-lib.mjs` |
| Double-read Git worktree, index, working-byte, lease, and bounded protected-main refresh snapshot | `scoped-lane-admission-state.mjs` |
| Live verification, crash reconciliation, and transitions through the existing cloud CAS ledger | `scoped-lane-cloud-authority.mjs`, `scoped-lane-cloud-reconciliation.mjs`, and `CLOUD-COLLABORATION.md` |
| Direct read-only plan/check command | `scoped-lane-admission.mjs` |
| Candidate creation and exact-base rollback | `task-worktree-provision.mjs` |
| Local branch, lease, pull request, cloud bind/heartbeat projection, resume replay, and cloud-park refusal | `device-branch.mjs`, `device-start-lib.mjs`, `device-branch-lib.mjs`, `device-branch-ownership-lib.mjs`, `device-resume-lib.mjs`, `device-resume-replay-lib.mjs`, `device-park-lib.mjs`, and `writer-lease-lib.mjs` |
| Global lifecycle and cleanup | Existing `worktree-lifecycle-lib.mjs`, unchanged |

## Declared Write-Set Manifest

The candidate must provide an external coordination manifest:

```json
{
  "schema": "agentic-declared-write-scope/v1",
  "semanticScope": "focused-scope",
  "paths": [
    "scripts/focused-owner.mjs",
    "docs/FOCUSED-OWNER.md"
  ]
}
```

`paths` contains normalized repository-relative files or directories. Absolute
paths, traversal, wildcards, empty sets, and semantic-only ownership fail
closed. The evaluator creates the provider-neutral `declaredWriteSet` by adding
`semantic:<semanticScope>` to the normalized `path:*` entries. The GitHub cloud
adapter maps that exact sorted set to its existing `declaredWriteScope` field;
there is no second overlap algorithm or ownership registry.

The report records both:

- `manifestDigest`: SHA-256 over the normalized external manifest; and
- `writeSetDigest`: the existing cloud-contract digest over the normalized
  semantic-plus-path set.

Same semantic scopes serialize even when their paths differ. Parent and child
paths overlap even when their semantic labels differ.

## Existing Lane Classes

| Class | Meaning | Admission effect |
|---|---|---|
| `canonical` | The one registered `main` worktree is clean at fetched `origin/main`. | Required. |
| `disjoint-attributed` | The lane has an exact branch/path/session/PR/fence owner and either an exact current non-overlapping remote claim or an exact reviewed predecessor whose live successor is independently proved. | Preserve and allow. |
| `overlapping` | Same branch, same semantic scope, or an overlapping declared path. | Block the candidate. |
| `ambiguous` | Prunable/locked/bare state, mismatched lease identity, missing authoritative write set, expired authority, unattributed dirt, or a legacy local-only projection. | Block without adopting or modifying it. |

Observed diffs are preservation evidence, not future ownership. Each accepted
peer joins its local projection to exactly one operation-derived current remote
claim across claim ID, claim and transition digests, canonical base, lane
revision, normalized write set and digest, cloud epoch, transition counter,
state, expiry, and review request. Missing, duplicated, stale, fabricated, or
partially matching peer authority is ambiguous. A legacy active lease without
that exact current join remains fail-closed until its owner performs the
repository cloud handoff/reclaim or closes the lane; a pull request, local
lease, or inferred scope cannot upgrade it.

A clean frozen `review_ready` peer may remain `disjoint-attributed` after its
owner performs the exact live `delivery_authorized` successor transition. That
narrow join reads the historical ledger at the local projection's exact
revision, proves that its final entry is the same `review_ready` claim, then
requires the first same-claim successor to be `delivery-authorize` at counter
plus one followed by zero or more `delivery_authorized` heartbeats only. The
latest claim record, fence, transition digest, counter, and extended expiry must
match the current operation-derived inventory. The peer PR must still be open,
non-draft, same-repository, and exact at the local head, reviewed branch, review
identity, and current protected base. Local Git must prove either the reviewed
head or its bounded exact protected-main refresh. The complete proof is
double-captured, deeply immutable, and bound into the lane-state digest; its
stable peer digest excludes unrelated global-ledger appends, while any peer
heartbeat, claim, provider, Git, or ancestry drift blocks the final preservation
rerun. This classification only permits preservation of an unrelated lane. It
grants no authority to author, resume, review, merge, release, reconcile, run,
or deploy the peer.

## Root-Source Bootstrap Maintenance

Root-source bootstrap remains an exceptional, candidate-bound admission path.
It requires one registered maintenance source that is either:

- dirty, unleased, and limited to its exact declared maintenance paths; or
- clean, unchanged, and owned by exactly one cryptographically valid
  `retired-preserved` lease whose provider-first retirement receipt is joined
  into the maintenance proof.

An ordinary clean worktree, a clean lane with changed paths, a leased dirty
lane, a terminal receipt with a matching current cloud claim, or any proof with
path, branch, head, manifest, content, state, or receipt drift remains
ineligible. The clean path does not manufacture maintenance dirt and does not
reactivate, rewrite, clean, or remove the retired source. It uses that immutable
source only as the already-authorized preservation owner for the candidate-bound
bootstrap decision. See
[`CLEAN-PRESERVED-BOOTSTRAP.md`](./CLEAN-PRESERVED-BOOTSTRAP.md).

## Read-Only Commands

Local planning classifies the current registered lanes and target path without
claiming cross-device readiness:

```sh
node scripts/scoped-lane-admission.mjs plan \
  --scope="<semantic-scope>" \
  --repository="<canonical-repository-root>" \
  --worktree="<absent-safe-task-worktree>" \
  --write-scope-manifest="<external-manifest.json>" \
  --json
```

A plan may report `authoringAdmission.status: planned`; it never reports
`authoringAdmission.status: admitted`.

`check` additionally requires a successful cloud claim result and performs a
live read-only verification against the current complete ledger inventory:

```sh
node scripts/scoped-lane-admission.mjs check \
  --scope="<semantic-scope>" \
  --repository="<canonical-repository-root>" \
  --worktree="<absent-safe-task-worktree>" \
  --write-scope-manifest="<external-manifest.json>" \
  --cloud-authority="<external-cloud-claim-result.json>" \
  --target-repository="<owner/repository>" \
  --json
```

An eligible `check` remains `authoringAdmission.status: planned` and attaches an
accepted Admission Receipt; it grants only the exact candidate provisioning
envelope and no source mutation. The cloud adapter derives its complete current
claim inventory from the same immutable snapshot used by `verify`, seals the
bounded inventory into the verification receipt, and requires the exact current
unexpired claim plus no remote semantic or path overlap. It does not join two
independent live `status` and `verify` reads. A caller-supplied completeness
assertion is never accepted. A fresh claim remains a separate explicit CAS mutation under
`CLOUD-COLLABORATION.md`.

## Provisioning

Combined provisioning consumes the same evaluator before `git worktree add`:

```sh
node scripts/device-branch.mjs start "<semantic-scope>" \
  --session="<stable-session-id>" \
  --repository="<canonical-repository-root>" \
  --provision \
  --worktree="<absent-safe-task-worktree>" \
  --write-scope-manifest="<external-manifest.json>" \
  --cloud-authority="<external-cloud-claim-result.json>" \
  --target-repository="<owner/repository>" \
  --json
```

The command:

1. proves the configured workspace guards already resolve to the executable
   repository-owned `git-guarded`, `pre-commit`, `pre-push`, and
   `reference-transaction` sources without changing `core.hooksPath`;
2. fetches `origin/main`, takes two matching content-bound snapshots, records a
   target-observation digest, verifies the operation-derived cloud inventory,
   evaluates a `planned` report, and emits the accepted Admission Receipt;
3. holds the Git-common-directory writer-registry lock, rechecks the target
   observation, and creates only the detached exact-base candidate; a post-add
   registry read must prove exactly one new registration at that path, while
   direct candidate reads prove clean status and HEAD/tree identity with the
   admitted base before a typed create/register result is accepted;
4. claims the local branch and lease, creates the fence and draft ownership pull
   request, binds the exact head and PR through the cloud CAS owner, and caps
   local expiry at the accepted cloud expiry;
5. performs a final atomic cloud verification, proves every pre-existing local
   lane and relevant peer claim unchanged, emits the Preservation Receipt, and joins both
   receipts to derive `authoringAdmission.status: admitted`; and
6. immediately revalidates the exact current cloud claim, protected ledger,
   local lease, epoch, fence, and both expiries before returning mutation
   authority; and
7. for `--json`, returns the full final admitted `admissionReport` and fresh
   `mutationAuthorityReceipt`, not only their digests or a planned projection.

The remote claim epoch is scoped to the cloud work item and begins at `1`.
The clone-local writer epoch remains independently monotonic across that Git
common directory. Neither value is substituted for the other.
GitHub claim identity uses the adapter's pseudonymous device and session
identifiers; local projections retain their raw values only to recompute that
same provider identity and never invent a parallel claim namespace.

Cloud heartbeat runs before local lease extension, and the renewed local expiry
cannot exceed cloud expiry. The renewed batch repeats operation-derived cloud
verification after the local extension, joins the exact
claim/local-lease/epoch/fence/expiry state again before the pull-request marker
is updated, and returns the resulting mutation-authority receipt in machine
JSON. If either remote boundary cannot be proven, the operation fails closed
and grants no next edit batch. Every later mutation batch must perform the same
immediate revalidation. Review, delivery, integration, and release retain their
separate live-verification boundaries.

## Preservation And Rollback

Each lane digest binds its registered path, HEAD, branch/detached flags, index
blob entries, changed and untracked working-file object identities, status,
exact matching lease projection, and recovery identity. The collector rereads
the registry, leases, index, and working state; any drift during inspection
fails as a time-of-check/time-of-use change.

Candidate creation and rollback decisions run under the writer-registry lock.
Lock ownership is token-bound and release removes only the caller's exact
token. An existing lock is never age-reclaimed automatically; an abandoned
lock requires explicit owner-led recovery so acquisition cannot move a newly
acquired peer lock during a stale-lock race.
Creation binds the before/after registry digests and refuses any delta other
than its single clean, detached, tree-identical candidate registration. An
interruption before a candidate lease exists may remove only that exact
candidate after another direct proof. Any candidate lease, dirt, attachment,
HEAD/tree drift, registry drift, or mismatched receipt preserves the lane for
exact-session recovery. No rollback touches a pre-existing worktree, branch,
lease, pull request, recovery ref, or authored byte.

Exact-session activation replay never manufactures a missing Preservation
Receipt. An interrupted lane that still projects `planned` remains
non-authoritative for source edits; preserve it until its owner completes
lifecycle recovery and starts a fresh admission.

The cloud claim supplied to `check` or combined `start` is externally acquired
authority. If verification, provisioning, binding, or final admission fails,
the command does not silently release or replace that claim. Its owner retains
the exact claim/fence/counter and must either retry the compatible operation or
explicitly release/reclaim it through `CLOUD-COLLABORATION.md`. Candidate
rollback never implies cloud-claim cleanup.

## Review And Resume

Cloud-authoritative review refuses a merely local admitted projection. It
reconciles the local projection against the exact live active or review-ready
claim before the focused check, runs the check, then repeats reconciliation
immediately before push. After the pushed branch and ownership pull request
both expose the same exact HEAD, review rebinds the cloud claim when needed,
performs the CAS `review_ready` transition, and independently verifies the
resulting claim. A retry after a successful remote bind or transition but
before local persistence accepts only the recomputed claim identity, immutable
base/write set/epoch, exact PR/head, monotonic counter, state, expiry, fence,
and transition digest; every other live projection fails closed. Only then may
review persist the head and cloud projection, mark the pull request ready, and
release the local lease to `review_ready`.

Ordinary local `resume` remains available only to legacy local-only lifecycle
lanes. If either an admission or cloud-authority projection identifies the lane
as cloud-admitted, `resume` refuses to mint a local-only successor lease,
including same-session recovery. Its owner must use an explicit repository
cloud handoff/reclaim protocol that advances and re-verifies the cloud claim
before any local successor may mutate. Removing a projection to reach the
legacy path is not recovery authority.

Local `park` is likewise unavailable to a cloud-admitted lane until that
repository protocol owns the corresponding cloud handoff. This prevents a
local `parked` projection from diverging from a remotely `active` claim.

## Report Boundary

`agentic-lane-admission-report/v1` separates:

| Result | Meaning |
|---|---|
| `authoringAdmission` | `planned`, `admitted`, or `blocked` for this one additive source lane. `planned` grants no mutation. |
| `admissionRuntimeConformance` | Independent `ready`, `blocked`, or `unevaluated` implementation result. |
| `runtimeReadiness` | Independent `ready`, `blocked`, or `unevaluated` repository runtime result. This source-only evaluator emits `unevaluated`. |
| `lifecycleReadiness` | Independent `ready`, `attention-required`, `blocked`, or `unevaluated` lifecycle result. This evaluator emits `unevaluated`. |

An admitted authoring receipt grants only one bounded mutation batch after its
claim and local lease are revalidated. It is not standing authority and grants
no runtime parity, browser proof, cleanup, review, integration, release,
Production, publication, or deployment.

### Deliberate fail-closed boundary

This implementation does not yet emit the guideline's full
`sharedCoordinationStateDigest` over configuration, hooks, dependencies, refs,
registrations, leases, and recovery state. It also does not consume
`agentic-independent-peer-operation-receipt/v1`. Any peer claim or
pre-existing-lane drift therefore blocks preservation instead of being
classified as independently authorized progress. For that reason an otherwise
admitted report independently keeps `admissionRuntimeConformance.status:
unevaluated`; `runtimeReadiness` and `lifecycleReadiness` also remain
independently `unevaluated`. An individual admission block does not promote,
collapse, or synthesize any of those results.

Current authority enforcement runs at successful combined start and at each
cloud-backed heartbeat; it does not intercept arbitrary editor filesystem
writes. The caller must obtain that immediate revalidation before every bounded
edit batch. A stale or missing mutation-authority receipt grants no source
mutation.

## Findings

| Finding | Meaning |
|---|---|
| `canonical-base-drift` | Canonical `main` is dirty or differs from fetched `origin/main`. |
| `canonical-structure-ambiguous` | Canonical registration is missing, duplicated, or invalid. |
| `unsafe-target` | The candidate is not an absent safe direct child of the derived task root. |
| `target-worktree-collision` | The candidate path is already registered. |
| `structural-branch-ambiguity` | A branch is active in more than one worktree. |
| `scope-admission-collision` | Branch, semantic scope, or declared path overlaps. |
| `unattributed-lane-ambiguity` | An existing lane lacks exact authoritative ownership. |
| `cloud-authority-unproven` | The complete current cloud inventory and exact fence were not verified. |
| `stale-collaboration-fence` | Cloud base, write set, state, or claim identity drifted. |

## VCC

Focused proof must show:

- disjoint attributed dirty lanes remain byte- and identity-preserved;
- same semantic scope plus exact and parent-child path overlaps block;
- ambiguous legacy leases, PRs, expiry, branch/path identity, canonical drift,
  and torn snapshots fail before candidate mutation;
- live cloud verification consumes the complete peer inventory rather than a
  caller boolean, and the inventory is sealed from the verified snapshot rather
  than assembled across two moving ledger heads;
- Admission and Preservation Receipts join the target observation, typed
  candidate result, final protected-ledger refresh, exact claim, local lease,
  epoch, fence, and expiry;
- the candidate create/register result proves one locked registry addition plus
  clean exact-base HEAD/tree identity, and provisioned JSON retains the full
  final report and mutation-authority receipt;
- peer drift blocks while typed independent peer-operation receipts and the full
  shared-coordination-state digest remain unsupported;
- two device candidates from one ledger parent produce one accepted successor;
  an overlapping loser blocks and same-parent CAS retry remains non-forced;
- remote epoch `1` remains independent from a higher clone-local epoch;
- cloud bind/transition crash recovery accepts only the exact live claim;
  response-loss reconciliation recomputes the production pseudonymous claim
  identity before adopting the single exact live successor;
  heartbeat precedes and follows local renewal with verification, returns the
  mutation receipt, and caps local expiry at cloud expiry;
- review re-verifies after checks, transitions the exact pushed HEAD to
  cloud `review_ready`, and releases the local lease only after that proof;
- a clean frozen `review_ready` peer remains attributable across only the exact
  historical counter-plus-one `delivery_authorized` successor plus a
  heartbeat-only suffix when operation-derived ledger, provider, cloud, and Git
  evidence proves the reviewed head or its bounded protected-main refresh;
  forged input, dirty state, malformed refresh ancestry, torn evidence, closed
  or drifted provider state, or any claim/base/scope/epoch/review/current-expiry
  drift remains ambiguous, and attribution creates no peer mutation or
  lifecycle authority;
- cloud-admitted local-only resume and park fail closed pending explicit cloud
  handoff/reclaim, while external claim retry or release remains owner-led;
- configured absolute hook SSOT and sentinel configuration remain unchanged;
- nested canonical roots resolve the sibling task root safely; and
- rollback tolerates unrelated registry heartbeats but preserves any claimed or
  changed candidate.

Run:

```sh
node --test __tests__/scoped-lane-admission.test.mjs
node --test __tests__/scoped-lane-cloud-authority.test.mjs
node --test __tests__/cloud-collaboration-contract.test.mjs
node --test __tests__/github-cloud-collaboration-adapter.test.mjs
node --test __tests__/device-start.test.mjs \
  __tests__/device-branch-lib.test.mjs \
  __tests__/device-branch-cli.test.mjs \
  __tests__/device-review.test.mjs \
  __tests__/task-worktree-provision.test.mjs \
  __tests__/writer-lease-lib.test.mjs
npm run docs:check
```
