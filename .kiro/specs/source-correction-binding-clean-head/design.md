# Design

## Decision

Centralize the permitted head relationship in one pure helper. Equal local and
remote heads are exact by identity. Differing heads are exact only when a real
Git ancestry probe proves the remote head is an ancestor of local HEAD.

The repository adapter computes that proof before sealing evidence and keeps
all existing pull-request, marker, lease, completion, binding, and CAS checks
unchanged. The plan continues to bind both observed head SHAs, so later drift
still fails before projection.

## Safety boundary

The change does not create commits, move refs, mutate cloud authority, edit the
pull request, or grant authoring authority. It only broadens the read-only
planner from one valid clean head relationship to the two valid relationships
produced by the lifecycle.
