# Design

Extend the pure successor-bind classifier with one `recover-adopt` result for an exact
`dormant-preserved` projection of the already bound transition.

For that result, derive a recovery-evidence digest from the authorized plan and exact live bound
claim. Pass the historical active authority projection to
`continueExpiredCommittedHeartbeatCloudAuthority`, which performs the idempotent recovery
transition and returns freshly verified active authority. Reuse the existing durable
`successor-bound` and local projection stages after verification.

No direct ledger, lease, marker, source, ref, review-state, merge, or deployment mutation is added.
