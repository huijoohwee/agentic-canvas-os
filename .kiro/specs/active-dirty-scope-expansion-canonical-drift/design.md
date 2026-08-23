# Design: Active Dirty Scope Expansion Canonical Drift

## Problem

The repository adapter observed current protected `main` as the successor base.
That produced a plan even when the task-successor contract required the C2 lease
to preserve the C1 base. Execution therefore stopped before authorization with
an invariant failure. The cloud reducer already supports the intended stale-base
strict-superset transition when supplied an exact canonical-descendant proof.

## Design

`active-dirty-scope-expansion-protected-main.mjs` owns protected-main evidence.
It reuses the established ancestry, bounded changed-path, overlap, and legacy
canonical-descendant proof contracts. The adapter passes the complete target
write set, not merely the source set.

The plan continues to use `agentic-active-dirty-scope-expansion-plan/v1` for
historical compatibility. Same-base plans omit the optional proof and retain
their prior shape. Stale-base plans add the normalized proof, so its source,
target, paths, ancestry, overlap result, and evidence digest are covered by the
existing plan digest and exact authorization.

The successor retains `lease.baseSha`. The claim request includes the sealed
proof only when protected `main` is a strict descendant. Cloud evaluation
therefore rechecks the proof against its current canonical revision. A later
protected advance, overlap, or ancestry change fails without retiring C1.

## Effect boundary

Planning and invalid-authorization probes are read-only. Authorized execution
retains the existing active-dirty controller boundary: journaled waiting C2,
retired C1, promoted and review-bound C2, atomic local/task successor CAS, and
one hidden PR-marker projection. Source bytes, index, HEAD, refs, review state,
merge, deployment, and runtime remain outside this change.
