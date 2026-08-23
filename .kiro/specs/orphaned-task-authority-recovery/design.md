# Design Document

## Overview

The controller is a narrow authority-replacement transaction. It treats the
lost source private key as permanently unavailable and never attempts source
proof. Safety instead comes from exact repository evidence, a monotonic target
capability, a byte-exact operator decision, a durable external journal, immutable
dirty-byte snapshotting, and one writer-registry CAS.

The replacement remains compatible with existing lifecycle code by using the
current `agentic-task-authority-binding/v1` handoff shape. The separate incident
receipt records why source proof was intentionally unavailable; no existing
handoff or migration behavior is weakened.

## Components

| Component | Responsibility |
| --- | --- |
| `orphaned-task-authority-recovery-contract.mjs` | Normalize source evidence, plans, authorizations, bindings, intents, and receipts. |
| `orphaned-task-authority-recovery-evidence.mjs` | Capture and revalidate registered-worktree, Git, lease, binding, and PR evidence. |
| `orphaned-task-authority-recovery-store.mjs` | Persist the external owner-only plan and replay journal with lock and atomic rename. |
| `orphaned-task-authority-recovery-controller.mjs` | Enforce ordered phases, replay adoption, and terminal receipt construction. |
| `orphaned-task-authority-recovery-repository-adapter.mjs` | Bind Git, GitHub, writer-registry CAS, task proof, and dirty snapshot effects. |
| `orphaned-task-authority-recovery-cli.mjs` | Parse explicit inputs and emit redacted JSON. |

## Data flow

```text
plan
  -> capture source twice
  -> normalize replacement public projection
  -> build immutable Incident_Plan
  -> write external 0600 plan

run
  -> recapture and match plan
  -> verify exact authorization
  -> persist prepared journal
  -> snapshot dirty bytes when present
  -> prove replacement private-key possession
  -> CAS only lease.taskAuthority
  -> persist PR-attempt intent
  -> project exact PR marker
  -> verify Git + lease + PR + cloud identity
  -> seal completion receipt
```

## Evidence model

The source evidence is path-portable. Repository and PR identities use provider
IDs; local paths are represented only by a digest of the registered worktree
identity. Clean lanes bind `HEAD`, tree, and a clean status. Dirty lanes reuse
`captureActiveOwnedDirtEvidence`, including staged, unstaged, untracked, mode,
symlink, deletion, and byte digests. Dirt is checked against the admitted write
set during planning and recaptured before mutation.

## Replacement binding

The candidate binding is created with `createTaskAuthorityBinding`:

- capability: Replacement_Capability;
- lease: the unchanged Source_Lane lease identity;
- binding mode: `handoff`;
- transition plan digest: Incident_Plan digest;
- prior binding digest: Source_Binding digest.

Execution creates and verifies a task-authority proof using that candidate
binding and the operation `orphaned-task-authority-recovery:<planDigest>`.
The source capability is neither requested nor synthesized.

## Durable phases

```text
authorized -> prepared -> snapshotted -> local-cas
           -> pr-attempted -> pr-projected -> verified -> complete
```

`prepared` precedes every repository effect. `pr-attempted` precedes the only
provider write. Each phase is content-addressed and replayed from live evidence.
If local CAS returns no response, the controller adopts only the exact candidate
binding. If the PR edit returns no response, it adopts only the exact target
marker on the unchanged PR.

## Mutation boundary

Allowed effects are:

1. external plan and journal writes;
2. immutable active-owned-dirt snapshot objects/ref for a dirty lane;
3. one exact writer-registry CAS changing only `taskAuthority`; and
4. one exact PR-body marker replacement.

Cloud claims, source bytes, index entries, HEAD, branches, remote refs, commits,
PR review state, merge state, deployment, and runtime are forbidden.

## Failure handling

- Evidence or authorization drift stops before mutation.
- A foreign or corrupt journal stops without replacement.
- Snapshot failure leaves the source binding unchanged.
- CAS drift leaves both source binding and PR marker unchanged.
- PR failure retains the new local binding plus a durable attempted phase; replay
  reconciles the exact provider state without repeating a confirmed effect.
- Terminal verification failure retains evidence and reports no completion.

## Validation

Focused unit tests inject adapters for phase ordering and forbidden-effect
assertions. Repository-adapter tests use temporary Git repositories and fake
GitHub responses. The named check is:

```sh
node --test __tests__/orphaned-task-authority-recovery-*.test.mjs
```
