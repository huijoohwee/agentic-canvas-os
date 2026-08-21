---
title: "Completed Source Correction Fence Recovery"
graphId: "md:completed-source-correction-fence-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-13"
lang: "en-US"
schema: "agentic-completed-source-correction-fence-recovery-plan/v1"
frontmatter_contract: "required"
status: "source-ready"
authority: "Exact completed source-correction fence projection"
runtime_owner: "../scripts/completed-source-correction-fence-recovery.mjs; ../scripts/completed-source-correction-fence-recovery-controller.mjs; ../scripts/completed-source-correction-fence-recovery-repository-adapter.mjs"
runtime_proof: "../__tests__/completed-source-correction-fence-recovery-contract.test.mjs; ../__tests__/completed-source-correction-fence-recovery-controller.test.mjs; ../__tests__/completed-source-correction-fence-recovery-repository-adapter.test.mjs"
---

# Completed source-correction fence recovery

This controller repairs one narrow projection gap after a reviewed-lane source correction has already completed: the durable completion names the corrected remote source head, but a later task-authority migration left the local writer lease fenced at the older coordination commit.

It does not edit source, create a commit, push, merge, clean a worktree, or deploy. A plan binds the completed source-correction journal and receipt, clean local descendant, exact draft pull request, task-authority binding, stale local fence, and exact dormant successor claim. The run requires the source task's external capability and the literal authorization printed by `plan`.

```sh
node scripts/completed-source-correction-fence-recovery.mjs plan \
  --repository=/absolute/path/to/source-worktree \
  --source-session=<source-session> \
  --operator-session=<distinct-operator-session> \
  --pull-request=<number> \
  --json
```

```sh
node scripts/completed-source-correction-fence-recovery.mjs run \
  --repository=/absolute/path/to/source-worktree \
  --source-session=<source-session> \
  --operator-session=<distinct-operator-session> \
  --pull-request=<number> \
  --task-authority=/absolute/private/path/task-authority.json \
  --authorization='authorize completed-source-correction-fence-recovery <plan-digest>' \
  --json
```

The replay-safe journal advances through task-authority verification, exact dormant-cloud recovery, local lease CAS, PR marker projection, terminal verification, and completion. The completion embeds a current `agentic-admission-mutation-authority/v1` receipt. Normal `device:review` remains responsible for checking and pushing the already-authored descendant.

If the exact recovered claim expires again after its local lease and pull-request
marker were projected, replay may recover it once more without replacing the
durable subject. This path accepts only the same claim at the original recovery
transition, with the sealed recovery-evidence digest, canonical base, lane
revision, write set, lease epoch, and review identity unchanged. The expiry
projection must remain scope-reserved and non-writing; a parked, writing,
advanced, or otherwise drifted claim still fails closed.

If that replay's provider recovery succeeds before the local CAS response, the
same durable subject may also adopt the exact response-ahead current claim. It
must be precisely the second transition after the original dormant subject,
remain scope-reserved and writing, and retain the same recovery-evidence
digest, canonical base, lane revision, write set, lease epoch, and review
identity. The controller replays the original idempotent recovery request and
then requires a fresh provider read to match every returned authority field;
an older snapshot, duplicate claim, third transition, or field drift fails
before the local projection.
