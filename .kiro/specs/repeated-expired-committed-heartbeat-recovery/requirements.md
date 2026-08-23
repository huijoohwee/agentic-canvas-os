# Requirements

1. Recover only the same task owner, branch, claim, lease epoch, pull request, and clean committed descendant.
2. Require the original external `0600` task capability and exact content-bound human authorization.
3. Preserve the completed first-recovery receipt in a durable intent before another cloud effect.
4. Permit one same-claim cloud continuation, one writer-lease CAS, and one hidden marker replacement.
5. Reconcile response loss without issuing a second unrelated transition.
6. Forbid source, commit, ref, draft-state, merge, deployment, cleanup, and scope effects.
