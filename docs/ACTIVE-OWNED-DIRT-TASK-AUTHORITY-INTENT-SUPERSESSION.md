# Active-owned-dirt task-authority intent supersession

This controller repairs one response-loss boundary: an active-owned-dirt recovery reached its durable `cloud` phase, then a separately authorized orphaned-task-authority recovery replaced the writer lease binding. The original recovery intent remains valid except for its stale `sourceLeaseDigest`, so normal replay fails closed before the local CAS.

The `plan` command is read-only and binds the current writer lease, cloud-phase intent, pull request, snapshot/cloud receipts, and completed orphaned-authority journal. `run` requires the exact content-bound authorization plus the current task-authority capability. Its only effect is one writer-registry CAS that replaces the intent plan's lease digest and recomputes its plan digest. The lease, task binding, staged bytes, snapshot, cloud claim, refs, pull request, merge state, and deployment state are unchanged.

After a successful supersession, rerun the original active-owned-dirt recovery. It resumes from `cloud`, skips snapshot and cloud mutation, and proceeds with its existing local projection, pull-request marker, and final verification phases.
