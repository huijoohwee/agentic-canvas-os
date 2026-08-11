---
title: "Expired Active-dirty Scope-expansion Recovery"
graphId: "md:expired-active-dirty-scope-expansion-recovery"
doc_type: "Runtime Contract"
date: "2026-08-10"
lang: "en-US"
schema: "agentic-expired-active-dirty-scope-expansion-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound same-claim recovery of one expired cloud authority while preserving exact owned dirt"
runtime_scope: "read-only planning, exact authorization, cloud recovery, local authority rebound, pull-request marker projection, and crash-safe replay"
runtime_claim: "focused Dev runtime proof only; protected integration, scope expansion, deployment, and production availability remain separately gated"
runtime_owner: "../scripts/expired-active-dirty-scope-expansion-recovery-contract.mjs; ../scripts/expired-active-dirty-scope-expansion-recovery-evidence.mjs; ../scripts/expired-active-dirty-scope-expansion-recovery-controller.mjs; ../scripts/expired-active-dirty-scope-expansion-recovery-repository-adapter.mjs; ../scripts/expired-active-dirty-scope-expansion-recovery.mjs"
runtime_proof: "../__tests__/expired-active-dirty-scope-expansion-recovery-contract.test.mjs; ../__tests__/expired-active-dirty-scope-expansion-recovery-evidence.test.mjs; ../__tests__/expired-active-dirty-scope-expansion-recovery-controller.test.mjs; ../__tests__/expired-active-dirty-scope-expansion-recovery-repository-adapter.test.mjs; ../__tests__/expired-active-dirty-scope-expansion-recovery-cli.test.mjs"
publish_policy: "Dev-only; no protected integration, scope expansion, Production mirror, Cloudflare deployment, or physical cleanup authority"
---
<!-- Responsibility: Document the exact expired active-dirty recovery plan, effects, journal, and stop boundary. -->

# Expired active-dirty scope-expansion recovery

This runtime recovers one expired, cloud-admitted writer authority for the same claim, actor, device, session, branch, and pull request. It preserves the dirty bytes in place. It exists only to restore a current mutation authority so the separate active-dirty scope-expansion runtime can generate a fresh plan.

Recovery does not expand scope, create a successor claim, snapshot dirty bytes, create a commit or ref, push, amend, stash, reset, edit the ledger directly, integrate a pull request, clean a worktree, or deploy.

## Eligibility

Planning fails closed unless all of these conditions are current together:

- the controller is clean protected `main`, equal to local `origin/main` and the remote GitHub `main`;
- the source is the registered, attached, dirty, same-tree fence child owned by one active admitted writer lease;
- local HEAD, remote branch HEAD, draft pull-request HEAD, lease fence, and cloud lane revision are exact;
- the dirty path set is non-empty, tracked only, unchanged, and already covered by the admitted write set;
- no active scope-expansion intent exists;
- the authenticated GitHub actor owns the target namespace and exactly owns the cloud claim;
- the complete, validated cloud ledger records the claim as `dormant-preserved` with recorded state `current`;
- the cloud claim retains the original device and session identities, reservation, write set, counters, receipt, and recovery fields;
- no non-target claim reserves overlapping scope; and
- the ownership pull request is open, draft, same-repository, and contains exactly one valid writer-lease marker.

An expired reviewed claim is not eligible: effective state alone is insufficient, and the runtime never infers `recordedState`.

## Read-only plan

Run from the protected controller checkout:

```sh
node scripts/expired-active-dirty-scope-expansion-recovery.mjs plan \
  --source-repository=/absolute/path/to/expired-dirty-worktree \
  --target-repository=owner/repository \
  --pull-request=358 \
  --claim-id=<64-character-claim-id> \
  --ledger-repository=owner/ledger \
  --ttl-seconds=1800
```

The JSON result has status `planned` and contains `planDigest`, `exactAuthorization`, and the full plan. Planning performs no cloud, local-registry, pull-request, Git-ref, or worktree mutation.

The plan binds the controller, lane and remote revisions, full local writer lease and lease digest, complete cloud ledger and hydrated claim inventory, authenticated actor, pull-request identity and non-marker body frame, exact tracked dirt evidence, and requested recovery TTL.

The exact token is:

```text
authorize expired-active-dirty-scope-expansion-recovery <planDigest>
```

Any byte change, protected-main movement, inventory transition, pull-request edit, local lease change, or dirt change requires a new plan and token.

## Authorized run

Execute only the digest and exact token returned by the immediately revalidated plan:

```sh
node scripts/expired-active-dirty-scope-expansion-recovery.mjs run \
  --source-repository=/absolute/path/to/expired-dirty-worktree \
  --target-repository=owner/repository \
  --pull-request=358 \
  --claim-id=<64-character-claim-id> \
  --ledger-repository=owner/ledger \
  --ttl-seconds=1800 \
  --plan-digest=<planDigest> \
  --authorize='authorize expired-active-dirty-scope-expansion-recovery <planDigest>'
```

The controller and journal locations are not operator-selectable. The executable modules must reside in the same real protected controller root that they attest. Append-only attempt journals are fixed under the repository Git common directory at `agentic-canvas-os/expired-active-dirty-scope-expansion-recovery/<claim-id>.<attempt-digest>.json`; the attempt digest binds the target, ledger, exact source claim transition, and source-evidence digest. A claim-level outer lock serializes attempt selection. Symlink components, path escapes, and existing non-journal targets reject before intent persistence.

## Effects and crash replay

The controller persists an authorized intent before its first effect and advances four monotonic phases:

1. `cloud-recovered` calls the protected collaboration `continue` transition in `recovery` mode for the same claim. Its CAS binds the source ledger digest, fence revision, transition counter, original device and session, and an authorization-derived operation key.
2. `local-rebound` replaces only the writer lease's cloud authority, heartbeat time, and expiry under the full registry lock, then proves mutation authority.
3. `pr-projected` holds that registry lock, re-reads exact pull-request identity and raw body, replaces only the single writer-marker span, and verifies the exact identity, body frame, intended body, and rebound marker afterward.
4. `complete` seals the three live effects into a deterministic receipt.

Before every effect and after every error, the adapter re-reads the protected controller, lane, lease, complete cloud inventory, pull request, and owned dirt. The cloud inventory uses public-status A, full hydrated-ledger B, public-status C; A and C must be byte-identical, and B's protected public projection must equal them. This joins hidden claim fields to their transition digest without copying or inferring them.

The configured ledger repository is part of source and live evidence and must equal the local cloud authority. The exact ledger digest and complete peer set remain authorization inputs: even unrelated peer drift blocks the operation and requires repository-owned recovery with fresh evidence. This wrapper does not weaken the global ledger-head CAS or infer target-only authority.

Effect-response loss is replay-safe. The controller classifies current live state before repeating an effect, every operation key is phase- and authorization-bound, and the journal uses digest-checked compare-and-swap writes plus an entrypoint fence. A complete replay returns the stored sealed receipt without another mutation.

## Stop boundary

A complete recovery receipt authorizes no further change. Stop after recovery. Run the separate active-dirty scope-expansion planner against the newly current authority, review its new evidence, and obtain its exact fresh token before expanding the write set.

## Focused proof

```sh
node --test \
  __tests__/expired-active-dirty-scope-expansion-recovery-contract.test.mjs \
  __tests__/expired-active-dirty-scope-expansion-recovery-evidence.test.mjs \
  __tests__/expired-active-dirty-scope-expansion-recovery-controller.test.mjs \
  __tests__/expired-active-dirty-scope-expansion-recovery-repository-adapter.test.mjs \
  __tests__/expired-active-dirty-scope-expansion-recovery-cli.test.mjs
npm run docs:check
```

Focused local proof does not prove a live recovery, protected merge, production deployment, physical-device behavior, or cleanup eligibility.
