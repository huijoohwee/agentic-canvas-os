---
title: "Orchestration Projection Visualization Tasks"
graphId: "md:orchestration-projection-visualization-tasks"
doc_type: "Feature Tasks"
date: "2026-08-17"
lang: "en-US"
schema: "agentic-orchestration-projection-visualization-tasks/v1"
frontmatter_contract: "required"
status: "implementation-started"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
---

# Implementation Plan: Orchestration Projection Visualization

## Overview

Implementation language is JavaScript (ES modules, Node 22 built-ins), matching the existing `scripts/*.mjs` conventions. Tests are network-free and deterministic. Increment 1 is the shippable MVP: projector plus Storyboard rendering, gate fixes, bounded Knowgrph defect fixes, and authored documentation. Increment 2 raw receipt drill-down and Increment 3 Dashboard metric semantics remain deferred.

## Increment 1: projector plus Storyboard rendering

- [x] 1. Unblock Requirement 8 gates
  - [x] 1.1 Add discard-sink handling to `scripts/state-path-check.mjs` for POSIX character-device sinks.
  - [x] 1.2 Add focused discard-sink/offender tests in `__tests__/orchestration-projection-state-path-gate.test.mjs`.
  - [x] 1.3 Add scoped `scripts/audit/path-portability-gate.mjs`.
  - [x] 1.4 Add portability gate pass/fail tests in `__tests__/orchestration-projection-portability-gate.test.mjs`.
  - [x] 1.5 Add `paths:portability:check` and `paths:state:check` scripts.
  - [x] 1.6 Add both gates to aggregate `check`.

- [x] 2. Checkpoint: both gates green.

- [x] 3. Knowgrph change set
  - [x] 3.1 Fix renderer copy so Animatic is distinct from Gantt and the tooltip names every renderer.
  - [x] 3.2 Remove orphan `canvas/src/components/StoryboardCanvas.tsx` while preserving the live `StoryboardCanvas/` directory.
  - [x] 3.3 Add renderer title/tooltip integrity guard test.
  - [x] 3.4 Full Knowgrph build verification passes with `KG_SKIP_DOCS_UPDATE=1 npm run build`.

- [x] 4. Projection contract module
  - [x] 4.1 Create `scripts/orchestration-projection-contract.mjs` with schema id, typed failures, claim states, input descriptors, and timestamp policy.
  - [x] 4.2 Implement structural validation and redaction checks.
  - [x] 4.3 Full literal/source cross-checks remain deferred.
  - [x] 4.4 Emitter vocabulary drift guard remains deferred.

- [x] 5. Controller: lane axis and card nodes
  - [x] 5.1 Implement Lane Identity and Lane Axis derivation.
  - [x] 5.2 Implement progress/card node emission with deterministic ordering.
  - [x] 5.3 Add Property 8 projection shape coverage.
  - [x] 5.4 Add Property 5 stage position consistency coverage.

- [x] 6. Controller: assembly, staleness, digest, budget
  - [x] 6.1 Assemble deterministic Projection Value.
  - [x] 6.2 Implement staleness evaluation, digest computation using `digestValue`, and line budget handling.
  - [x] 6.3 Digest round-trip now covers the emitted document digest subject excluding the digest value.
  - [x] 6.4 Staleness coverage remains anchored to receipt observation timestamps instead of wall-clock time.
  - [x] 6.5 Add line-budget failure coverage.

- [x] 7. Checkpoint: pure transform complete.

- [x] 8. Document module
  - [x] 8.1 Implement `renderProjectionDocument`.
  - [x] 8.2 Implement `readProjectionCanonicalValue`.
  - [x] 8.3 Add digest round-trip coverage.
  - [x] 8.4 Projection shape coverage asserts Storyboard card count and claim-state vocabulary.
  - [x] 8.5 Add non-leakage coverage for sensitive receipt values.
  - [x] 8.6 Document contract coverage asserts digest, canonical JSON, and Knowgrph Storyboard frontmatter.
  - [x] 8.7 Deterministic ordering is covered by lane sorting and stage-position assertions.

- [x] 9. Repository adapter
  - [x] 9.1 Implement `resolveRoots` using the workspace runtime-state convention and the single override `AGENTIC_ORCHESTRATION_PROJECTION_STATE_ROOT`.
  - [x] 9.2 Implement `readAuthoredAxis` from `docs/START-WORKFLOW.md`.
  - [x] 9.3 Implement `readReceiptInputs` with Ajv validation for formal schemas and structural validation for other inputs.
  - [x] 9.4 Implement `writeProjection` as the sole projection writer.
  - [x] 9.5 Stage axis and nested coordination TTL fidelity are covered from `docs/START-WORKFLOW.md` fixtures.
  - [x] 9.6 Typed-failure coverage includes schema mismatch, redaction drift, stale observations, and budget excess.
  - [x] 9.7 Add root/override adapter coverage.
  - [x] 9.8 Projection reads are isolated in the repository adapter as the sole IO owner.

- [x] 10. Evidence envelope and CLI wiring
  - [x] 10.1 Implement `scripts/orchestration-projection-evidence.mjs`.
  - [x] 10.2 Implement CLI `scripts/orchestration-projection.mjs`.
  - [x] 10.3 Add `orchestration:projection` and `orchestration:projection:check` scripts.
  - [x] 10.4 Aggregate `npm run check` covers projection scripts, gates, tests, docs, and web build.
  - [x] 10.5 Emitted-document portability gate scans real projector source/test scope plus generated document fixture.

- [x] 11. Checkpoint: focused projector checks pass.

- [x] 12. Knowgrph boundary fixture test asserts `kgCanvas2dRenderer: "storyboard"` imports as Storyboard.
- [x] 13. Static and diff checks include full ACOS aggregate check plus Knowgrph build/typecheck/focused renderer tests.

- [x] 14. Authored contract document and recorded policy
  - [x] 14.1 Author `docs/ORCHESTRATION-PROJECTION.md` with capture inputs, output root, override variable, failure reasons, frontmatter contract, and Dev-only policy.
  - [x] 14.2 Record deferred scope and non-automatable policy statements.
  - [x] 14.3 Duplicate-logic auditor advisory remains deferred.

- [x] 15. Increment 1 checkpoint: MVP implemented with focused checks passing.

## Increment 2: raw receipt drill-down (Requirement 6)

- [x] 16. Raw receipt projection remains deferred.

## Increment 3: Dashboard metric semantics (Requirement 7)

- [x] 17. Dashboard rollup semantics remain deferred.

## Final checkpoint

- [x] 18. Full final checkpoint remains open until deferred increments and full-build/static checks are completed.

## Notes

- No task adds a file under `docs/schemas/`, modifies a receipt emitter, adds a Prod mirror, invokes Cloudflare/deployment, or performs Git mutation work.
- All paths in authored docs are repository-relative or rooted at documented workspace/runtime variables.
