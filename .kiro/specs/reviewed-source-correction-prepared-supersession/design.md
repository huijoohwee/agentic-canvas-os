# Design

## Decision

Extend `resolveRunnableIntent` within the existing operation fence. After the
stored authorization fails, only `prepared` and `complete` states may consider a
fresh plan. The fresh plan is rebuilt from two identical source reads and must
accept the caller's exact authorization.

For `prepared`, invoke the existing read-only `successor_waiting`
reconciliation against the stored plan. A pending result proves that the only
effect possible before the first journal advance is absent. Only then replace
the journal through its existing compare-and-swap write. A complete result is
response-ahead evidence and fails closed on the old journal.

No repository adapter, cloud transition, lease projection, or journal schema
changes are required.
