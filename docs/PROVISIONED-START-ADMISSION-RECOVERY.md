---
title: Provisioned Start Admission Recovery
graphId: "md:provisioned-start-admission-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-14"
lang: "en-US"
schema: "agentic-provisioned-start-admission-recovery-doc/v1"
frontmatter_contract: "required"
status: normative
scope: repository-owned coordination recovery
provider_policy: adapter-neutral
model_policy: model-agnostic
---

# Provisioned Start Admission Recovery

This controller closes a narrow response-loss boundary in provisioned task startup. It applies when provisioning has already created and bound the worktree, writer lease, coordination fence, draft review request, and current cloud claim, but startup ended before the final `planned` to `admitted` local projection. The worktree may contain a clean authored descendant that must be preserved.

The controller is not a generic admission bypass. It cannot create authority, adopt another session, move a branch, publish the authored descendant, or infer permission from a timestamp. Plan and execute both join the same external task capability, session, device, claim, review request, lease epoch, fence, manifest, and provider frame.

## State contract

Planning succeeds only when all of these statements are true:

- the attached writer lease is active and its admission state is `planned`;
- the external task capability is the capability already projected into that lease;
- the live cloud claim is current, scope-reserving, and grants write authority at the coordination fence;
- the remote branch and draft review request remain at that fence with auto-merge disabled;
- the local worktree is clean and its HEAD is a nonempty linear descendant of the fence;
- every changed path is a subset of the declared manifest;
- the complete commit, tree, parent, message, path, and binary range-diff evidence is content-bound.

Planning is read-only and returns this exact operator boundary:

```text
authorize provisioned-start-admission-recovery <plan-digest>
```

The plan binds a canonical cloud-authority subject rather than a verifier response envelope. The subject contains the claim identity and digest, state and counters, repository, branch, review, manifest, write-scope, base, fence, actor, device, and session identities required by this contract. Canonical ordering makes identical authority produce an identical subject digest. Verification timestamps, nonces, receipt identifiers, and global ledger observation metadata are excluded because they describe the observation, not the authority.

Every execution boundary performs a fresh verification. Its adapter-issued attestation must name the verifier schema and version, reproduce the sealed subject digest from the current authoritative fields, and bind the fresh verifier receipt. A changed authority field changes or invalidates the subject; a forged or mismatched attestation fails closed. The fresh receipt is execution evidence and does not alter the human-authorized plan digest.

Execution requires the sealed external plan and that exact authorization. It records an external Git-common-directory intent, atomically projects the integration evidence and admitted receipt into the writer registry, then replaces only the deterministic writer marker in the review body. It never pushes the authored descendant. Each phase is replay-safe: an exact completed local or provider effect is adopted, while any third state fails closed.

Use the device entry point from a protected controller checkout:

```sh
node scripts/device-branch.mjs recover-start-admission plan \
  --repository=/absolute/task-worktree \
  --session=<session-id> \
  --task-authority=/absolute/external/capability.json \
  --output=/absolute/external/recovery-plan.json \
  --json

node scripts/device-branch.mjs recover-start-admission execute \
  --repository=/absolute/task-worktree \
  --session=<session-id> \
  --task-authority=/absolute/external/capability.json \
  --plan=/absolute/external/recovery-plan.json \
  --authorization='authorize provisioned-start-admission-recovery <plan-digest>' \
  --json
```

After terminal verification, ordinary `device:review` and `device:integrate` resume ownership. Cleanup and deployment remain separate protected operations.

## Bootstrap exception record

The first version was authored on the isolated branch `hotfix/provisioned-start-admission-recovery` from protected revision `9ed2ea42eb02a45ba1407c6611a21b82c2f9f148`. The normal admission path could not create its own repair lane because the exact partial admission it repairs was classified as an unattributed lane ambiguity. The operator explicitly authorized the one-time phrase `authorize protected bootstrap hotfix for PR481 admission recovery`.

That authorization covered only an isolated branch and ordinary protected review. It did not authorize direct protected-main mutation, hook bypass, claim or lease edits, manual merging around failed checks, cleanup, or deployment. Future uses must use the protected controller and ordinary admitted lifecycle.
