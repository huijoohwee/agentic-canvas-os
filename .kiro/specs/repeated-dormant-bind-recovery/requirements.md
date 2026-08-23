# Requirements

## Bound successor expiry

The repeated expired committed heartbeat controller must resume when its exact review-bound
successor expired after a lost bind response and before durable local projection.

The recovery must require the authorized plan's claim identity, target write set, canonical base,
reviewed head, review request identity, and transition counter plus one. All drift must fail closed.

The controller must regain write authority only through the existing authenticated dormant-recovery
continuation and must verify the renewed authority before changing the writer lease or PR marker.
