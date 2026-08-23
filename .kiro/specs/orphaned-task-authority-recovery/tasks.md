# Implementation Plan: Orphaned Task Authority Recovery

## Tasks

- [x] 1. Baseline the incident contract
  - Define exact source evidence, monotonic replacement capability, authorization, replay, mutation, and proof requirements.
  - Define the modular architecture and closed effect boundary.
  - _Requirements: 1.1-1.8, 2.1-2.5, 3.1-3.5, 4.1-4.5, 5.1-5.5, 6.1-6.4_

- [x] 2. Implement provider-neutral contract and evidence modules
  - Normalize path-free source evidence and deterministic plans.
  - Reuse task-authority and active-owned-dirt evidence primitives.
  - Reject invalid generation, subject reuse, unmerged paths, uncovered dirt, and PR/marker drift.
  - _Requirements: 1, 2, 4.1-4.2_

- [x] 3. Implement durable external plan and journal storage
  - Enforce absolute external owner-only paths, atomic writes, entrypoint locking, immutable completed replay, and exact phase transitions.
  - _Requirements: 3.2-3.5_

- [x] 4. Implement the controller and repository adapter
  - Persist authorization before effects.
  - Snapshot dirty bytes before CAS.
  - Prove target capability possession, atomically replace only `taskAuthority`, journal the PR attempt, project the exact marker, and verify terminal equality.
  - _Requirements: 2.4-2.5, 4, 5_

- [x] 5. Implement the always-JSON CLI
  - Add explicit `plan` and `run` commands with external plan, journal, target capability, incident reference, loss-attestation digest, repository, branch, and authorization inputs.
  - Redact local paths and secrets from failures.
  - _Requirements: 1.6-1.8, 3.1, 6.2_

- [x] 6. Add focused failing-first proof
  - Cover deterministic planning, wrong authorization, target capability drift, clean and dirty evidence, snapshot-before-CAS, exact single-field CAS, response-loss adoption, completed replay, and forbidden effects.
  - _Requirements: 6.3-6.4_

- [ ] 7. Validate and deliver through protected review
  - [x] Run the focused named check.
  - [x] Verify the authored-file line budget.
  - [x] Run the documentation contracts.
  - [x] Run the full repository check.
  - [ ] Review, integrate, verify protected `origin/main`, and retain PR #644 as a separately owned lane.
  - _Requirements: 6.1-6.4_
