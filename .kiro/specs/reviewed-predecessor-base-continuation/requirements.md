# Requirements

## Problem

The reviewed-lane source-correction planner proves that protected `main` advanced through a disjoint path set, but the cloud reducer rejects the controller's unchanged-scope successor because `reviewed` is omitted from the matching-predecessor states.

## Requirements

1. A reviewed predecessor may admit one same-owner successor on the predecessor's recorded canonical base when repository, work item, lane revision, and write-set digest remain exact.
2. The change must not admit a missing predecessor, changed subject, changed write set, or unproven base change.
3. Existing current, dormant, retired, overlap, queue, and protected-source behavior must remain unchanged.
4. The source-correction documentation must state the reducer dependency explicitly.

