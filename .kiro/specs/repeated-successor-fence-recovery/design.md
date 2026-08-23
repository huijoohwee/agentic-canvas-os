# Design

Add one pure successor-lease projection helper. It requires the verified cloud authority lane
revision to equal the plan-sealed reviewed head, advances `fenceSha` to that revision, and carries
the renewed expiry and admitted strict-superset scope.

Use the helper before task-authority continuation and the admission mutation-authority check. Update
the terminal target predicate to require the reviewed head fence.
