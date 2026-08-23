# Requirements Document

## Introduction

This specification defines a protected incident controller for a writer lane
whose task-bound Ed25519 capability is irrecoverably unavailable. The controller
does not reconstruct the lost key or infer authority from a clean tree, a PR, a
session string, or repository ownership. It permits one exact operator-authorized
replacement binding while preserving the original binding as immutable evidence.

## Glossary

- **Source_Lane**: One registered `agent/<device>/<scope>` worktree and its exact writer lease.
- **Source_Binding**: The public task-authority binding already stored on the Source_Lane.
- **Replacement_Capability**: A new owner-only external Ed25519 capability with a distinct subject and generation `Source_Binding.generation + 1`.
- **Incident_Plan**: A content-addressed, read-only plan joining the Source_Lane, Source_Binding, Git state, PR marker, target capability projection, and operator incident reference.
- **Recovery_Journal**: An owner-only external replay record written before any repository mutation.
- **Replacement_Binding**: A standard `agentic-task-authority-binding/v1` handoff projection carrying the Incident_Plan digest and Source_Binding digest.

## Requirements

### Requirement 1: Exact read-only incident planning

**User Story:** As the repository owner, I want a complete immutable plan before replacing lost authority, so that key loss cannot become a generic bypass.

#### Acceptance Criteria

1. THE controller SHALL plan only from one registered Source_Lane whose attached branch, worktree root, HEAD, writer lease, cloud claim identity, and pull-request marker join exactly.
2. THE controller SHALL require a Source_Binding that validates against the Source_Lane and SHALL preserve its public projection and binding digest in the Incident_Plan.
3. THE controller SHALL accept `active`, `review_ready`, `delivery`, or `parked` writer leases without requiring the unavailable source private key.
4. THE controller SHALL capture a clean Git state by exact HEAD and tree, or a dirty Git state by the existing no-follow active-owned-dirt evidence contract.
5. THE controller SHALL reject unmerged paths, ambiguous worktree registration, missing PR ownership, marker drift, or dirt outside the admitted write set.
6. THE controller SHALL require an explicit non-secret incident reference and a SHA-256 loss-attestation digest.
7. THE Incident_Plan SHALL contain no private key, capability path, raw PR body, or local repository path.
8. Planning SHALL perform no Git, cloud, PR, writer-lease, or journal mutation.

### Requirement 2: Replacement capability constraints

**User Story:** As the repository owner, I want the replacement cryptographically distinct and monotonic, so that the old authority cannot silently reappear.

#### Acceptance Criteria

1. THE Replacement_Capability SHALL be an absolute, canonical, owner-only regular file outside the Source_Lane.
2. THE replacement subject SHALL differ from the Source_Binding subject.
3. THE replacement generation SHALL equal `Source_Binding.generation + 1`.
4. Execution SHALL prove possession of the Replacement_Capability against the exact Incident_Plan and candidate Replacement_Binding.
5. THE Replacement_Binding SHALL preserve the Source_Lane identity, use binding mode `handoff`, name the Incident_Plan digest, and name the Source_Binding digest.

### Requirement 3: Exact authorization and durable replay

**User Story:** As the operator, I want each incident recovery explicitly authorized and replay-safe, so that retries cannot widen the operation.

#### Acceptance Criteria

1. Execution SHALL require the byte-exact statement `authorize orphaned-task-authority-recovery <planDigest>`.
2. Before repository mutation, THE controller SHALL persist the Incident_Plan and exact authorization in the Recovery_Journal.
3. A different plan, branch, source binding, target capability projection, incident reference, or authorization SHALL be rejected before mutation.
4. A replay SHALL execute only missing phases and SHALL adopt a live effect only when it equals the plan-derived target.
5. A completed journal SHALL be immutable and SHALL return the original completion receipt without repeating effects.

### Requirement 4: Byte preservation and atomic local transition

**User Story:** As the source owner, I want all authored bytes preserved while authority is repaired, so that incident handling cannot alter implementation work.

#### Acceptance Criteria

1. For a dirty Source_Lane, THE controller SHALL create and verify the existing immutable active-owned-dirt snapshot before changing the writer lease.
2. Immediately before the local transition, THE controller SHALL recapture Git evidence and require exact equality with the Incident_Plan.
3. THE controller SHALL replace only `lease.taskAuthority` under the repository writer-lease registry lock using exact source lease digest and cloud claim ID compare-and-swap.
4. THE controller SHALL leave all other writer-lease fields byte-equivalent.
5. THE controller SHALL never modify source files, the index, HEAD, local or remote refs, commits, cloud claims, merge state, deployment state, or runtime state.

### Requirement 5: Pull-request projection and terminal proof

**User Story:** As a future recovery controller, I want local and provider projections to agree, so that the replacement capability is usable without hidden split-brain state.

#### Acceptance Criteria

1. After local CAS, THE controller SHALL replace exactly one hidden writer-lease marker on the unchanged pull request.
2. Before attempting the provider edit, THE Recovery_Journal SHALL record the exact operation key and target marker digest.
3. Provider response loss SHALL be adopted only when a fresh read returns the exact unchanged PR identity and target marker.
4. Terminal verification SHALL prove unchanged Git evidence, exact local Replacement_Binding, exact PR marker, and unchanged cloud claim identity.
5. THE completion receipt SHALL bind every phase receipt and SHALL explicitly report `sourceBytesChanged:false`, `cloudMutated:false`, `merged:false`, and `deployed:false`.

### Requirement 6: Modular implementation and focused proof

**User Story:** As a maintainer, I want the controller independently testable and reviewable, so that its exceptional authority remains narrow.

#### Acceptance Criteria

1. Contract, evidence, store, controller, repository adapter, and CLI responsibilities SHALL remain in separate modules below 600 lines each.
2. THE CLI SHALL expose separate `plan` and `run` commands and SHALL emit always-JSON, path-redacted results.
3. Focused tests SHALL cover clean and dirty evidence, wrong authorization, wrong generation, source drift, snapshot ordering, atomic CAS, PR response loss, completed replay, and zero forbidden effects.
4. Passing focused tests SHALL establish Dev controller readiness only; using the controller on any Source_Lane SHALL require a separately generated exact Incident_Plan and authorization.
