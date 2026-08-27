---
title: "Terminal Handoff Owned Dirt Successor Recovery"
graphId: "md:agentic-terminal-handoff-owned-dirt-successor-recovery"
doc_type: "Runtime Contract"
date: "2026-08-25"
lang: "en-US"
schema: "agentic-terminal-handoff-owned-dirt-successor-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound recovery for one admitted dirty lane whose exact cloud predecessor is terminally retired for handoff"
runtime_scope: "read-only planning, exact authorization, epoch-2 successor claim, active binding, local authority CAS, and PR-marker projection"
runtime_claim: "preserves source bytes and restores scoped Dev mutation authority only"
runtime_owner: "../scripts/terminal-handoff-owned-dirt-successor-recovery-contract.mjs; ../scripts/terminal-handoff-owned-dirt-successor-recovery-controller.mjs; ../scripts/terminal-handoff-owned-dirt-successor-recovery-evidence.mjs; ../scripts/terminal-handoff-owned-dirt-successor-recovery-repository-adapter.mjs; ../scripts/terminal-handoff-owned-dirt-successor-recovery.mjs"
runtime_proof: "../__tests__/terminal-handoff-owned-dirt-successor-recovery.test.mjs"
publish_policy: "Dev-only recovery; review, merge, runtime proof, Production release, deployment, and cleanup remain separately gated"
---
<!-- Responsibility: Define the exact terminal-handoff dirty-lane successor recovery boundary. -->

# Terminal handoff owned dirt successor recovery

This controller recovers one locally `active`, admitted, dirty lane when its exact
cloud claim is already terminally `retired` with reason `handoff`. It creates and
binds the next cloud epoch, rotates the external task capability, updates the
local writer lease and draft pull-request marker by compare-and-swap, and returns
one mutation-authority receipt. It does not change source bytes, commit, push,
merge, deploy, clean, close a pull request, or delete a worktree or ref.

## Preconditions

Planning reads the source twice and binds the exact registered branch/worktree,
HEAD/tree, admitted active lease, task binding, staged/unstaged/untracked dirt,
draft pull request and marker, raw ledger history, unique terminal handoff
retirement, complete live claim inventory, and external successor capability.
The source claim must be absent from the live inventory, have no existing
successor anywhere in validated raw history (including a retired successor),
and have no overlapping live reservation. The source task binding is normalized
against the full source lease before its adapter, generation, or subject is
trusted. The successor capability must be an owner-only, single-link regular
`0600` file
outside every linked worktree and the Git common directory, use the same proof
adapter, advance the source capability generation by exactly one, and identify
a distinct authority subject. Supplying the current capability, reusing the
source subject, or skipping a generation fails closed. Construction-time checks
are not treated as durable: every capability use revalidates its owner, regular-
file mode, `0600` permissions, single-link count, canonical path, current Git
common directory, and current linked-worktree set, and reads one stable file
identity through an open descriptor. Post-construction replacement, permission
drift, or hardlink creation fails closed.

The raw ledger chain must join the local cloud projection exactly. The historical
source is `current`; its next and final entry is `retired`, its reason is
`handoff`, and its final revision and review request equal the unchanged source
lane. Every status read must be a complete `ready` inventory at the authenticated
Git ledger revision, digest, and sequence. The source claim, successor claim,
bound cloud authority, and local lease review identity must all equal
`github-pull-request:<observed-node-id>`. Claim identity, scope, owner, session,
epoch, transition, contract receipt, and provider receipt drift fails closed.
The cloud authority's target repository, the single local `origin` fetch URL,
the single local `origin` push URL, the pull-request URL repository, the PR head
repository, and the base repository inferred from that exact URL must normalize
to one GitHub `owner/repository`. The PR head branch must be the registered lane
and the base branch must be `main`. That witness is sealed into evidence and is
re-read before snapshotting and every cloud, ledger, pull-request, or marker
provider boundary; a mirror, fork head, foreign base, or foreign PR therefore
cannot be adopted as the recovery subject. The installed `gh` field set does
not expose `baseRepository`, so the exact GitHub PR URL is the base-repository
authority; an injected/provider-supplied base identity is still checked when
present.

## Plan and execute

Planning is read-only:

```sh
node scripts/terminal-handoff-owned-dirt-successor-recovery.mjs plan \
  --repository=<absolute-dirty-worktree> \
  --operator-session=<distinct-successor-session> \
  --task-authority=<absolute-external-successor-capability>
```

Adapter construction, intent lookup, and evidence capture do not create the
recovery state directory. The directory, lock, and journal are created lazily
only when authorized execution acquires its filesystem fence or writes durable
intent. The controller enters the adapter's in-memory fence wrapper before token
validation, but that wrapper remains filesystem-lazy; invalid authorization
therefore leaves no lock, directory, or journal behind.

Save the returned JSON outside the repository. Execution requires the byte-exact
token printed in `exactAuthorization`:

```sh
node scripts/terminal-handoff-owned-dirt-successor-recovery.mjs run \
  --repository=<absolute-dirty-worktree> \
  --operator-session=<distinct-successor-session> \
  --task-authority=<absolute-external-successor-capability> \
  --plan=<absolute-external-plan.json> \
  --authorization='authorize terminal-handoff-owned-dirt-successor-recovery <planDigest>'
```

The first durable effect is the authorized private journal. Later phases create
an immutable dirt snapshot ref, claim epoch 2 from the retired predecessor,
bind the unchanged pull-request head, atomically rotate cloud and task authority,
prove the final target lease with the successor capability, project the new
lease marker, and verify the terminal state. Phase effects use
stable operation keys and reconcile provider response loss. Claim reconciliation
requires the exact authenticated `claim` ledger entry to carry the claim phase's
hashed operation key. Bind execution, adoption, and reconciliation similarly
require the latest exact `continue` transition to carry the bind phase's hashed
operation key; a semantically identical transition from another run is not
adopted. Journal replacement fsyncs both the temporary file before rename and
the parent directory after rename. Before any pull-
request body edit, the adapter revalidates the exact node ID, URL, open draft
state, head, base, non-marker body, and cloud review identity; reconciliation
and terminal verification apply the same join. Marker projection reconstructs
the target lease from the sealed plan and claim/bind receipts, joins it to the
local-CAS receipt and full registry digest, and uses that reconstruction rather
than an unsealed registry read. It repeats the registry join immediately before
and after the provider edit. The final join, PR read, exact no-op decision or
`gh pr edit`, provider readback, and final local recheck all execute under one
non-reentrant writer-registry lock. Heartbeat, release, and other cooperative
registry CAS operations therefore cannot enter at the provider-mutation boundary.

## Focused proof boundary

The focused test covers contract authorization and journal phase order, source
binding and successor-capability validation, final-target proof verification,
exact local reconciliation and response drift, invalid authorization with no
filesystem state, journal reconstruction after durable replacement,
authenticated synthetic ledger/status and mutation receipts, operation-bound
claim/bind reconciliation rejection, normalized fetch/push/PR/head/base
repository joins with zero cloud or edit effects on foreign identity,
historical-successor rejection, and capability placement including sibling-
worktree, Git-common-directory, hardlink, and post-construction permission/link
drift cases. The marker regression injects a
foreign registry CAS at the exact edit boundary and proves the held lock prevents
both that CAS and a stale provider edit.
The terminal-family test pass also covers the neighboring reviewed handoff
contract. These are deterministic contract and dependency-injected adapter
tests; they are not a live GitHub provider run, deployment proof, merge proof,
or end-to-end recovery of a real dirty lane.

## Result boundary

Success means only `successor-active`: the same bytes remain dirty at the same
HEAD and tree, while the writer lease, cloud authority, task binding, and PR
marker join the new successor. Ordinary clean `device:review`, protected
integration, runtime proof, Production authorization, deployment, and exact
cleanup must still run through their canonical owners.
