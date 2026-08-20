---
title: "Task-Bound Lane Authority"
graphId: "md:agentic-task-bound-lane-authority"
doc_type: "Runtime Contract"
date: "2026-08-13"
lang: "en-US"
schema: "agentic-task-bound-lane-authority-contract/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "proof-of-possession binding for one writer lane"
runtime_scope: "capability issuance, public lease projection, mutation proof, active-publish continuation, clean migration, and two-party handoff"
runtime_claim: "local Dev authority proof only; cloud claims, review, integration, release, and deployment remain separately gated"
runtime_owner: "../scripts/task-bound-lane-authority-contract.mjs; ../scripts/task-bound-lane-authority-store.mjs; ../scripts/task-bound-lane-authority-cli.mjs; ../scripts/active-publish-task-authority-successor.mjs; ../scripts/writer-lease-lib.mjs; ../scripts/device-branch.mjs; ../scripts/device-child-process-policy.mjs"
runtime_proof: "../__tests__/task-bound-lane-authority.test.mjs; ../__tests__/active-publish-task-authority-successor.test.mjs; ../__tests__/writer-lease-lib.test.mjs; ../__tests__/device-branch-cli.test.mjs; ../__tests__/device-child-process-policy.test.mjs"
report_schema: "schemas/task-bound-lane-authority.v1.schema.json"
publish_policy: "Dev-only; no integration, Production, publication, or deployment authority"
---
<!-- Responsibility: Define task proof separately from sessions, devices, providers, and supervisor observation. -->

# Task-Bound Lane Authority v1

Task-Bound Lane Authority prevents a visible session identifier from becoming
an accidental bearer token. A lane writer must possess the external private
capability whose public projection is bound to the writer lease. Session,
device, branch, worktree, pull request, and provider identifiers remain useful
correlation and recovery evidence; none independently grants mutation.

The contract is universal and provider-neutral:

- the authority subject is an opaque `urn:agentic-task:<random>` identifier;
- the proof adapter is named explicitly and can be replaced by another adapter;
- the core has no chat, model, vendor, provider, or hosting identity;
- the private capability remains outside Git, the worktree, pull requests,
  command output, and cloud ledgers;
- public projections are portable evidence, not credentials; and
- cloud claims, repository leases, protected review, and release authorization
  remain separate joined authorities.

## Authority model

The v1 file adapter uses an owner-only Ed25519 private key. The writer lease
stores only the opaque subject, adapter identifier, generation, public key,
public-key digest, lane-binding digest, and transition evidence. Each mutation
generates a fresh challenge over the operation, current lease subject, binding,
timestamp, and random nonce. The signature is verified immediately and cannot
be reused for another operation or consumed twice by the verifier.

The binding deliberately excludes `sessionId`. Changing a visible session
string neither creates nor destroys task authority. The binding joins the
branch, semantic scope, device projection, lease epoch, base revision, and
optional cloud claim. A successor lease epoch must prove the same private
capability and records a `continuation` binding to the prior public digest, or
it must use an explicit clean handoff; copying an old public projection is not
a successor claim.

The supported proof adapter is
`urn:agentic-proof:ed25519-file:v1`. Contract functions accept an explicit
adapter identity, so a future keychain, hardware key, workload identity, or
remote signer can implement the same challenge boundary without changing lane
semantics.

## Capability issuance

Create the capability in an external owner-only directory:

```sh
node scripts/task-bound-lane-authority-cli.mjs issue \
  --output=/absolute/external/task-authority.json \
  --json
```

The command creates, rather than overwrites, a regular non-symlink `0600` file.
Its machine result contains only public projection data and the local path; it
never emits the private key. Do not place the capability below a repository or
worktree, attach it to a task message, paste it into an authorization token, or
copy it into CI artifacts.

New device lifecycle claims pass the capability explicitly:

```sh
node scripts/device-branch.mjs start <semantic-scope> \
  --session=<correlation-id> \
  --repository=<canonical-or-task-repository> \
  --task-authority=/absolute/external/task-authority.json \
  <ordinary-admission-options> \
  --json
```

Every later lifecycle command uses the same `--task-authority` option or the
process-local `AGENTIC_TASK_AUTHORITY_FILE`. The device entrypoint rejects a
capability stored inside the repository. Its child-process policy scrubs the
locator from Git, validation, provider, and arbitrary child processes by
default. The sole narrow exception is the repository's exact empty
coordination-claim commit, whose real pre-commit guard must prove the same task
authority before the lease can acquire a fence. The policy rejects option,
subject, scope, or epoch lookalikes and never exposes private capability bytes.
Writer-registry mutations preserve the same binding and independently repeat
proof-of-possession. The focused recovery and deployment boundaries live in
`COORDINATION-CLAIM-CHILD-AUTHORITY.md`.

## Explicit migration

An existing unbound lane is never silently upgraded. It must be active, live,
attached to its exact worktree, and clean. First issue a generation-1
capability, then create a content-bound plan:

```sh
node scripts/task-bound-lane-authority-cli.mjs plan-migration \
  --repository=/absolute/task-worktree \
  --session=<correlation-id> \
  --capability=/absolute/external/task-authority.json \
  --output=/absolute/external/task-authority-migration-plan.json \
  --json
```

Execute only the exact authorization printed by that plan:

```sh
node scripts/task-bound-lane-authority-cli.mjs migrate \
  --repository=/absolute/task-worktree \
  --session=<correlation-id> \
  --capability=/absolute/external/task-authority.json \
  --plan=/absolute/external/task-authority-migration-plan.json \
  --authorize='authorize task-bound-lane-migration <planDigest>' \
  --json
```

Any lease, branch, head, dirt, worktree, target key, or plan drift blocks before
the registry transition. Migration never changes source bytes, Git refs, the
pull request, or cloud state. Run the ordinary capability-bound heartbeat next
to refresh the public ownership projection.

## Two-party handoff

The recipient issues a distinct capability at exactly the current generation
plus one. Planning requires a clean live lane. Execution requires both the
current writer capability and the recipient capability, plus the exact
content-bound authorization:

```sh
node scripts/task-bound-lane-authority-cli.mjs plan-handoff \
  --repository=/absolute/task-worktree \
  --session=<correlation-id> \
  --source-capability=/absolute/external/current.json \
  --target-capability=/absolute/external/recipient.json \
  --output=/absolute/external/task-authority-handoff-plan.json \
  --json

node scripts/task-bound-lane-authority-cli.mjs handoff \
  --repository=/absolute/task-worktree \
  --session=<correlation-id> \
  --source-capability=/absolute/external/current.json \
  --target-capability=/absolute/external/recipient.json \
  --plan=/absolute/external/task-authority-handoff-plan.json \
  --authorize='authorize task-bound-lane-handoff <planDigest>' \
  --json
```

This is a capability rotation, not source integration or a cloud-claim
transfer. The cloud and lease controllers must still perform their own exact
handoff or continuation when their subjects change. A dirty lane is
non-transferable: preserve its bytes under the current binding, finish or park
through repository-owned lifecycle, and hand off only from a clean exact
state.

## Active-publish cloud successors

Publishing an admitted active lane after protected main advances can require a
new cloud claim whose canonical base, lane revision, and claim identity differ
from the source lease. Those changes also change the task-authority lane
identity. The active-publish controller therefore creates one `continuation`
binding in the same writer-registry CAS that projects the verified successor
claim. It preserves the authority subject, key, generation, session, device,
branch, scope, epoch, worktree, pull request, manifest, and write set while
joining the exact cloud operation and verification receipts.

The registry authorizes that CAS with proof from the source binding. A copied
public key, session identifier, or successor claim is insufficient. Owner,
scope, epoch, review, receipt, or claim drift fails before local projection.
The resulting receipt is audit evidence only: it grants neither review,
integration, release, nor deployment authority.

## Observer and supervisor boundary

Observation requires no capability and grants no mutation:

```sh
node scripts/task-bound-lane-authority-cli.mjs inspect \
  --repository=/absolute/task-worktree \
  --json
```

A supervisor may read status, public subject, generation, mode, and binding
digest. It must not receive the capability file, replay a worker's process,
replace the binding, or treat a shared session ID as a handoff. Supervisors
coordinate owner-led recovery; they do not become writers merely because the
owner is idle, offline, expired, or slow to answer.

## Expiry, failure, and recovery

- Lease or cloud expiry preserves the task binding and authored bytes. It does
  not transfer the private capability or authorize a successor.
- A missing, unreadable, symlinked, broadly readable, wrong-subject, wrong-key,
  wrong-generation, stale, replayed, or operation-mismatched proof fails closed.
- A capability loss is an owner recovery incident. Do not mint another
  generation against a dirty lane or edit the writer registry manually.
- A capability compromise requires an exact clean handoff to a new subject and
  generation, followed by the repository/cloud lifecycle transitions.
- Process or response loss is reconciled from the public binding and exact
  registry state. Private capability material is never reconstructed.

## Validation boundary

Focused tests prove cryptographic possession, session independence, wrong-key
rejection, freshness and replay rejection, strict file permissions, symlink
rejection, one-generation handoff, exact-plan migration, clean-state gating,
public observation, and required writer-lease enforcement.

These tests do not prove a protected merge, cloud handoff, release candidate,
Production deployment, or physical-device execution. Those remain separate
receipt and authorization boundaries.

When a legacy root-source review refresh observes a pull-request base that is
not an ancestor of the preserved review head, the admission manifest derives
its authored paths from the preserved lease base. The refreshed cloud review
identity may still bind the provider's current pull-request base, but a
divergent live base cannot widen or replace the lane's source manifest.
