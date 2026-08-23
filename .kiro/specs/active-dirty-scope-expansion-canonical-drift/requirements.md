# Requirements: Active Dirty Scope Expansion Canonical Drift

## Requirement 1: Preserve the predecessor base

1. A stale-base scope-expansion successor SHALL retain the exact source lease base.
2. Planning and execution SHALL reject a task-successor projection that changes the source base.
3. Same-base plans SHALL retain their historical plan shape and digest behavior.

## Requirement 2: Seal protected-main disjointness

1. Planning SHALL prove the source base, pull-request base, and current protected main form an ancestry chain.
2. Planning SHALL capture every protected changed path between the source base and current protected main.
3. The complete expanded target write set SHALL be disjoint from those protected changed paths.
4. A stale-base plan SHALL bind the normalized canonical-descendant proof into its authorization digest.

## Requirement 3: Execute only the sealed successor

1. The waiting-successor claim SHALL use the source base and the sealed canonical-descendant proof.
2. Protected-main, proof, lease, claim, dirt, manifest, or target-scope drift SHALL require a new plan and authorization.
3. No invalid or missing authorization SHALL create an intent or cloud effect.

## Requirement 4: Focused compatibility proof

1. Tests SHALL cover disjoint stale-base capture, overlap rejection, same-base compatibility, and proof-bound plan identity.
2. The existing controller, task-successor, and scope-expansion tests SHALL remain green.
3. Documentation SHALL distinguish canonical observation from successor base identity.
