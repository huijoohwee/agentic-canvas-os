# Requirements Document

## Requirement: Prepared revision-intent recovery

When an owner-authenticated lane has completed source correction, completed fence recovery, and
successor task-binding reconciliation, the system shall provide a content-bound controller that can
supersede only the predecessor claim's still-prepared reviewed-lane revision intent.

Acceptance criteria:

1. Planning proves the exact branch, PR, current lease and task binding, predecessor and successor
   claims, completed recovery receipts, current protected main, controller runtime, and a
   single-parent tree-identical local forward child.
2. Execution requires the plan's exact authorization and proof of possession for the current task
   authority capability.
3. Execution performs one writer-registry CAS, preserves the lease and all peer records byte-for-byte,
   and changes only the matching branch's prepared revision-intent record to `superseded`.
4. Source bytes, Git refs, commits, pushes, PR state, cloud claims, merges, cleanup, and deployments
   are forbidden effects.
5. A completed receipt is replayable and binds the plan, authorization, task-authority proof, recovery
   receipts, controller runtime, current main, and exact predecessor/successor identities.
