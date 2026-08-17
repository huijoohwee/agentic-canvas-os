---
title: "Dormant-preservation Admission Decision Runtime"
graphId: "md:agentic-dormant-preservation-admission-decision"
doc_type: "Runtime Contract"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-dormant-preservation-admission-decision/v2"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound admission of one candidate while preserving an exact dormant-lane selection"
runtime_scope: "read-only planning, exact authorization, candidate-only provisioning, planned continuation, and crash-safe journal replay"
runtime_claim: "focused Dev runtime proof only; protected integration, deployment, and production availability remain separately gated"
runtime_owner: "../scripts/dormant-preservation-decision-contract.mjs; ../scripts/dormant-preservation-decision-evidence.mjs; ../scripts/dormant-preservation-decision-controller.mjs; ../scripts/dormant-preservation-decision-repository-adapter.mjs; ../scripts/dormant-preservation-decision.mjs"
runtime_proof: "../__tests__/dormant-preservation-decision-contract.test.mjs; ../__tests__/dormant-preservation-decision-evidence.test.mjs; ../__tests__/dormant-preservation-decision-controller.test.mjs; ../__tests__/dormant-preservation-decision-repository-adapter.test.mjs; ../__tests__/dormant-preservation-decision-cli.test.mjs; ../__tests__/device-branch-cli.test.mjs"
publish_policy: "Dev-only; no protected integration, Production mirror, or Cloudflare authority"
---
<!-- Responsibility: Document the exact dormant-preservation plan, authority, effect, and replay boundary. -->

# Dormant-preservation admission decision

This controller admits one new device lane while preserving an explicit set of dormant lanes. It is an additive plan/run wrapper around the repository-owned `device-branch.mjs start --provision` path. Planning is read-only. Execution requires the exact authorization printed by that plan.

It does not amend, force-push, reset, retire claims, edit the cloud ledger directly, create a duplicate lane, integrate a pull request, or deploy.

## Inputs

The selection file is the operator-visible scope of the preservation decision:

```json
{
  "schema": "agentic-dormant-preservation-admission-selection/v1",
  "lanes": [
    {
      "worktreePath": "/absolute/path/to/dormant-worktree",
      "pullRequest": 123
    }
  ]
}
```

`pullRequest` may be a positive number, a non-empty pull-request reference, or `null`. Every selected pull request must resolve twice to the same open draft and must match its selected worktree branch and HEAD. The selection must cover the complete dormant-preservation receipt exactly.

An attached preserved worktree carries its canonical non-empty branch and `detached: false`. A detached preserved worktree carries exactly `branch: null` and `detached: true` and cannot bind a pull request. Contradictory branch/detached projections fail before planning.

The other required files are the repository-normalized declared write-scope manifest and cloud-authority receipt already used by provisioned `device:start`. A root-source bootstrap exception is intentionally unsupported: this path requires a clean exact canonical source and does not infer unrelated authority.

## Plan

Run from the controller checkout that owns `scripts/device-branch.mjs`:

```sh
node scripts/dormant-preservation-decision.mjs plan \
  --repository=/absolute/path/to/canonical-repository \
  --target-repository=owner/repository \
  --worktree=/absolute/path/to/new-worktree \
  --scope=semantic-scope \
  --session=operator-session \
  --manifest=/absolute/path/to/write-scope.json \
  --cloud-authority=/absolute/path/to/cloud-authority.json \
  --selection=/absolute/path/to/dormant-selection.json \
  --controller-root=/absolute/path/to/controller
```

The one-line JSON result contains `planDigest`, `exactAuthorization`, and the complete plan. The v2 plan binds:

- clean exact controller and canonical Git revisions, trees, and GitHub origin identity;
- every registered pre-existing lane and the complete claim-local decision set;
- candidate scope, branch, target observation, manifest, authority, selection, and file digests;
- the journal path and exact `device:start --provision` executable, working directory, and argv;
- the authenticated owner, repository, selected worktrees, and selected pull requests.

Cloud verification and operator authorization have deliberately different
projections. Verification returns one complete, bounded current-claim inventory
from the same immutable ledger snapshot as the verified candidate and seals that
inventory into its receipt. The operator decision retains the candidate, claims
in the candidate's work-item or review lineage, claims named by selected
preserved lanes, and every claim whose normalized write set overlaps the
candidate. It excludes the global ledger head, observation time, verification
receipt, and unrelated disjoint claims. An unrelated ledger append therefore
cannot invalidate exact authorization, while candidate-lineage, selected-peer,
or overlapping-claim drift still fails closed. Final execution evidence retains
the complete observed ledger and inventory for audit.

The default journal is in the repository Git common directory at `agentic-canvas-os/dormant-preservation-admission/<claim-id>.json`. `--state-path=/absolute/path.json` selects another path, and that exact path is included in the plan digest.

## Run

Copy the plan's bytes exactly:

```sh
node scripts/dormant-preservation-decision.mjs run \
  --repository=/absolute/path/to/canonical-repository \
  --target-repository=owner/repository \
  --worktree=/absolute/path/to/new-worktree \
  --scope=semantic-scope \
  --session=operator-session \
  --manifest=/absolute/path/to/write-scope.json \
  --cloud-authority=/absolute/path/to/cloud-authority.json \
  --selection=/absolute/path/to/dormant-selection.json \
  --controller-root=/absolute/path/to/controller \
  --plan-digest=<planDigest> \
  --authorize='authorize dormant-preservation-admission <planDigest>'
```

Before candidate mutation, the controller rebuilds the source evidence and exact nested argv. `device:start` independently rebuilds them twice, including once while holding the repository registry lock. Any controller, canonical, lane, pull-request, relevant cloud claim, file, target, identity, argv, or authorization drift blocks before provisioning. A different global ledger head is accepted only when the fresh same-snapshot verification proves the decision claim set is byte-identical.

Plans and source evidence issued by this runtime use v2. A v1 plan cannot receive
new v2 authority. Completed v1 journals remain immutable historical evidence;
an effect-absent authorized v1 journal must be superseded by a fresh v2 plan and
authorization. A v1 journal with a planned or admitted effect requires its
repository-owned recovery or one-way migration contract and is never
reinterpreted by the v2 normalizer.

## Crash and replay behavior

The journal is compare-and-swap written under an entrypoint fence.

- `authorized` plus an absent candidate may be replaced only by a fresh current plan and its new exact authorization.
- `planned` resumes through repository-owned `device:heartbeat --continue-admission`. Planning may observe an already-registered exact clean active planned candidate without reprovisioning it. Its in-command gate loads the bound journal and rechecks the fence child or repository-recorded prepared integration commit, selection, files, all pre-existing lanes, pull requests, controller, canonical source, and exact cloud peers before the continuation mutation.
- An effect that completed before its subprocess response or journal write is recovered from live repository evidence without starting a second lane.
- `admitted` replay seals `complete` from the already journaled execution evidence; it does not repeat live verification or the effect.
- `complete` replay returns the normalized stored receipt directly.

Subprocess output must be exactly one JSON object and must join the planned session, scope, worktree, draft pull request, cloud claim, and admitted mutation authority. Ambiguous or partial state fails closed.

The candidate pull request must be an open draft in the canonical target repository and use its canonical `https://github.com/<owner>/<repository>/pull/<number>` URL. A newly provisioned or admitted candidate has the same pull-request and local head. An exact planned candidate may additionally carry a repository-recorded local prepared integration commit; that commit remains non-authoritative until the authorized continuation and later review transition publish it.

## Verification boundary

Focused tests cover deterministic planning, byte-exact authorization, two pre-provision drift gates, full post-state evidence, candidate ancestry and no-force semantics, strict subprocess joins, journal CAS, lost-response recovery, planned continuation, authorized-intent refresh, and admitted/complete replay.

A complete receipt proves repository-local and cloud-inventory admission evidence for this operation. The immutable v1 schema remains historical; new plans validate against [`dormant-preservation-decision-plan.v2.schema.json`](./schemas/dormant-preservation-decision-plan.v2.schema.json). It does not by itself prove protected integration, deployment, a physical Apple device run, or production availability.
