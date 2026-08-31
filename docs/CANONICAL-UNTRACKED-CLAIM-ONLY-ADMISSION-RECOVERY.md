---
title: "Canonical-Untracked Claim-Only Admission Recovery"
graphId: "md:canonical-untracked-claim-only-admission-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-canonical-untracked-claim-only-admission-recovery-doc/v1"
frontmatter_contract: "required"
status: "normative"
scope: "canonical-untracked same-claim admission recovery"
provider_policy: "provider operations isolated behind a repository adapter"
model_policy: "model, agent, and client neutral"
---

# Canonical-untracked claim-only admission recovery

This controller recovers one exact dormant cloud claim while preserving a canonical worktree whose only authored bytes are already captured by a `canonical-untracked-retention` package. It is deliberately narrower than lane admission: it does not create a branch, worktree, lease, commit, ref, pull request, deployment, or cleanup projection.

## Admissible state

Planning fails closed unless all of these facts are concurrently true:

- the source is its registered canonical `main`, with `HEAD`, local `origin/main`, and read-only remote `main` equal;
- the source has no tracked changes and has one or more sorted untracked paths;
- a complete, digest-valid `canonical-untracked-retention` package identifies the same source, HEAD, state digest, write-set digest, and exact paths;
- every untracked path is owned by the normalized declared write-scope manifest;
- the wrapped source authority identifies exactly one current-entry cloud claim;
- the live claim is `dormant-preserved`, `writeAuthority:false`, `scopeReserved:true`, transition `1`, heartbeat `0`, at the canonical base/lane revision, with no review, predecessor, recovery, or integration projection;
- no overlapping reservation exists;
- the prospective target path, worktree registration, local branch, remote branch, writer lease, and pull request are all absent; and
- the controller runs from a clean, protected, remote-current canonical `main`.

Planning performs read-only filesystem, Git, GitHub, and cloud-status inspection. The executing module must belong to the same live primary canonical controller root that is attested by the plan. Its only files are explicitly requested private plan/journal files outside repository state. It never reads the task capability.

## Plan

Use absolute paths. The source authority is the original wrapped result and the capability remains an external `0600` file.

```sh
node scripts/canonical-untracked-claim-only-admission-recovery.mjs plan \
  --repository /absolute/path/to/canonical-repository \
  --recovery /absolute/path/to/preservation-package \
  --target-worktree /absolute/path/to/prospective-worktree \
  --controller-root /absolute/path/to/canonical-agentic-canvas-os \
  --manifest /absolute/path/to/write-scope-manifest.json \
  --cloud-authority /absolute/path/to/wrapped-source-authority.json \
  --device device-slug \
  --session owner-session-id \
  --scope semantic-scope \
  --state /absolute/private/path/recovery-journal.json \
  --output /absolute/private/path/recovery-plan.json \
  --ttl-seconds 3600 \
  --json
```

The emitted plan seals its full evidence, allowed and forbidden effects, TTL, and task proof operation. Review it before authorizing. The sole accepted statement is printed as `exactAuthorization`:

```text
authorize canonical-untracked-claim-only-admission-recovery <planDigest>
```

Any punctuation, whitespace, operation, or digest difference is rejected.

## Run

```sh
node scripts/canonical-untracked-claim-only-admission-recovery.mjs run \
  --repository /absolute/path/to/canonical-repository \
  --recovery /absolute/path/to/preservation-package \
  --target-worktree /absolute/path/to/prospective-worktree \
  --controller-root /absolute/path/to/canonical-agentic-canvas-os \
  --manifest /absolute/path/to/write-scope-manifest.json \
  --cloud-authority /absolute/path/to/wrapped-source-authority.json \
  --device device-slug \
  --session owner-session-id \
  --scope semantic-scope \
  --state /absolute/private/path/recovery-journal.json \
  --plan-file /absolute/private/path/recovery-plan.json \
  --task-authority /absolute/private/path/task-authority.json \
  --authority-output /absolute/private/path/current-authority.json \
  --authorize 'authorize canonical-untracked-claim-only-admission-recovery <planDigest>' \
  --json
```

Run first rejects aliased roles: the prospective target, plan, journal, capability, and authority output must be pairwise hierarchy-disjoint, and private roles must remain external to the source, controller, and preservation package. This prevents private directory creation from materializing the sealed-absent target lane. It then revalidates all local preservation and absence evidence, proves possession of the task capability against the plan-derived prospective lane subject without persisting a binding or lease, seals an idempotent request, and invokes only repository cloud action `continue` in `recovery` mode for the same claim. A one-use in-memory receipt gate requires a proof no older than 60 seconds and consumes it immediately before each continuation effect, after all remaining read-only status checks. The request binds the claim fence, transition counter, plan evidence digest, owner identity, TTL, and plan-derived idempotency key.

The private journal advances monotonically:

```text
authorized -> task_authority_verified -> cloud_request_sealed
           -> cloud_recovered -> verified -> complete
```

Each transition uses exact compare-and-swap and every journal, plan, and authority output is a non-symlink regular file with mode `0600`. A completed replay revalidates the static source and current, unexpired terminal claim before returning the sealed result, without invoking the cloud mutation again. A response-loss replay uses the same idempotency key and accepts only the exact transition-2 same-claim recovery carrying the plan evidence digest.

The command writes and prints the raw wrapped current authority:

```json
{
  "ledgerRepository": "owner/ledger",
  "targetRepository": "owner/repository",
  "result": {
    "schema": "agentic-cloud-collaboration-result/v1",
    "ok": true,
    "action": "continue",
    "status": "current"
  }
}
```

That wrapped authority is the next admission input. This controller does not itself admit or relocate the lane; the next protected controller must consume the raw authority and independently plan its projections.

## Verification

```sh
node --test __tests__/canonical-untracked-claim-only-admission-recovery.test.mjs
```

Do not delete or modify the preservation package, canonical untracked bytes, journal, source authority, or task capability during recovery. Failures are evidence or authority stops, not permission to manufacture readiness.
