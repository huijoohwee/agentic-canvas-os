# Design

## Decision

Extend only `allowsPredecessorBaseContinuation`. Treat `reviewed` like `dormant-preserved` and `retired` for the same-write-set branch. Do not add it to the strict-superset branch because reviewed lanes are non-authoring and source correction preserves scope.

The existing subject join continues to require the exact predecessor claim, repository, work item, lane revision, canonical base, and write-set digest. Canonical-base changes still require the existing normalized descendant proof.

## Verification

Add a reducer test that creates a reviewed predecessor on a historical base, accepts its exact unchanged-scope successor, and rejects a changed work item. Run the focused cloud contract test and documentation contract.

