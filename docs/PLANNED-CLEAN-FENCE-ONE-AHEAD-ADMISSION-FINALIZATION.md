---
title: "Planned clean fence one-ahead admission finalization"
graphId: "md:planned-clean-fence-one-ahead-admission-finalization"
doc_type: "Recovery Controller Contract"
date: "2026-08-27"
lang: "en-US"
schema: "agentic-planned-clean-fence-one-ahead-admission-finalization-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
runtime_owner: "../scripts/planned-clean-fence-one-ahead-admission-finalization.mjs"
runtime_proof: "../__tests__/planned-clean-fence-one-ahead-admission-finalization.test.mjs"
---

# Planned clean fence one-ahead admission finalization

This controller closes one interrupted root-source startup state. Provisioning
already created and bound the exact clean worktree, empty coordination fence,
active planned writer lease, task capability, current claim, and open draft
review. A later ordinary heartbeat reached the cloud, but its response was lost
before the local lease projection. The cloud claim is therefore exactly one
transition and one heartbeat ahead while every immutable claim field is still
the same.

This is not a claim recovery or admission bypass. Planning requires:

- one clean attached worktree whose local branch, remote branch, review head,
  and lease fence are identical;
- one empty coordination commit whose complete parent list contains exactly the
  admitted base and whose tree equals the base tree;
- the exact task capability, session, manifest, lease, review marker, and
  root-source bootstrap authorization already bound to the interrupted start;
- a current active cloud claim with the same identity, owner, base, revision,
  write set, epoch, and review, with only one valid heartbeat successor; the
  status transition and heartbeat must equal the cryptographically verified
  current-inventory candidate;
- unchanged logical peer lanes and maintenance evidence; and
- any protected-main advance since the source base to be a descendant whose
  changed paths are disjoint from the candidate manifest.

Planning performs status and verification reads only. Every Git subprocess has
optional locks disabled. The controller hashes the raw index of the candidate
and every registered peer before and after complete evidence capture, then
fails if any byte changes. Plan and execution also attest that the controller
is clean protected `main`, with HEAD, local `main`, `origin/main`, and the
remote `main` equal, and with the runtime implementation bytes equal to that
integrated tree. An uncommitted hotfix cannot plan or run. Planning returns one
exact operator boundary:

```text
authorize planned-clean-fence-one-ahead-heartbeat-admission-finalization <planDigest>
```

Execution freshly revalidates the sealed subject and the original external task
capability. One writer-registry compare-and-swap projects the already-recorded
cloud heartbeat, bounded local heartbeat window, fresh joined Admission and
Preservation Receipts, and admitted status together. A recovery receipt joins
the interrupted plan and admission receipt digests to the fresh root-bootstrap
replan. Before task proof issuance or registry mutation, execution proves that
the exact target review body fits the provider limit. The only provider effect
is an exact-slice replacement of the hidden writer marker in the same open
draft review; every byte before and after the marker, including trailing
whitespace, remains unchanged. Replay seals the review id, number, URL, base,
head, state, draft and auto-merge state, and accepts only the exact source or
target body. CAS contention, response loss, marker response loss, changed
review identity, and every third registry/body state fail closed or adopt the
single already-recorded registry revision without another mutation. Adoption
joins the supplied target lease, durable receipt, and current branch lease in
one registry-lock snapshot; even an already-projected marker passes through
that same lease fence.

The controller invokes cloud `status` and verification only. It cannot create,
continue, renew, recover, retire, or integrate a claim. It cannot edit source or
index bytes; move HEAD, local or remote refs; change the review base, head,
draft state, or auto-merge; create an integration record; merge; release;
deploy; or clean any lane.

Use a protected controller revision:

```sh
node scripts/planned-clean-fence-one-ahead-admission-finalization.mjs plan \
  --canonical-repository=/absolute/controller-main \
  --repository=/absolute/candidate-worktree \
  --branch=agent/device/scope \
  --session=session-id \
  --manifest=/absolute/external/write-scope.json \
  --root-authorization=/absolute/external/root-bootstrap.json \
  --task-authority=/absolute/external/task-authority.json \
  --write-plan=/absolute/external/finalization-plan.json --json

node scripts/planned-clean-fence-one-ahead-admission-finalization.mjs run \
  --canonical-repository=/absolute/controller-main \
  --repository=/absolute/candidate-worktree \
  --branch=agent/device/scope \
  --session=session-id \
  --manifest=/absolute/external/write-scope.json \
  --root-authorization=/absolute/external/root-bootstrap.json \
  --task-authority=/absolute/external/task-authority.json \
  --plan-file=/absolute/external/finalization-plan.json \
  --authorize='authorize planned-clean-fence-one-ahead-heartbeat-admission-finalization <planDigest>' \
  --json
```

## Protected bootstrap record

The first implementation was required because the exact planned subject it
repairs correctly made ordinary lane admission globally ambiguous. The operator
authorized a separate focused protected controller change, tests, protected
review, and squash auto-merge. That authorization did not grant direct-main
mutation, force, check bypass, source-lane edits, cloud transitions, release,
deployment, or cleanup. The repair can run only after the controller is present
on protected `main` and a fresh plan receives its exact digest authorization.
