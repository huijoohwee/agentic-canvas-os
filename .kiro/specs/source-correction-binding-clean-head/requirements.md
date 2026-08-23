# Requirements

## Objective

Allow the source-correction successor task-binding reconciliation controller to
repair the clean state produced when local HEAD, the remote branch, and the
draft pull request all name the completed source-correction head.

## Requirements

1. Planning must accept an exact clean equal-head source when the lease, cloud
   successor, pull request, marker, and completion receipt otherwise join.
2. Planning must continue to accept a clean local descendant of the unchanged
   remote and pull-request head.
3. Planning must reject a differing local head unless the remote head is its
   Git ancestor.
4. Execution must retain its exact authorization, capability proof, registry
   CAS, replay, and zero-provider-effect boundaries.
5. Focused tests and the runtime contract must cover both valid head shapes and
   rejection of unrelated heads.
