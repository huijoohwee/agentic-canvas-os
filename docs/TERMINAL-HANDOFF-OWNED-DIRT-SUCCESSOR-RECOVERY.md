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
successor, and have no overlapping live reservation. The successor capability
must advance the source capability generation.

The raw ledger chain must join the local cloud projection exactly. The historical
source is `current`; its next and final entry is `retired`, its reason is
`handoff`, and its final revision and review request equal the unchanged source
lane. Any drift fails closed.

## Plan and execute

Planning is read-only:

```sh
node scripts/terminal-handoff-owned-dirt-successor-recovery.mjs plan \
  --repository=<absolute-dirty-worktree> \
  --operator-session=<distinct-successor-session> \
  --task-authority=<absolute-external-successor-capability>
```

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
project the new lease marker, and verify the terminal state. Phase effects use
stable operation keys and reconcile provider response loss.

## Result boundary

Success means only `successor-active`: the same bytes remain dirty at the same
HEAD and tree, while the writer lease, cloud authority, task binding, and PR
marker join the new successor. Ordinary clean `device:review`, protected
integration, runtime proof, Production authorization, deployment, and exact
cleanup must still run through their canonical owners.
