# Design

The public plan binds path-portable source evidence and an exact authorization digest. The
repository adapter stores a fixed-path CAS journal below the target Git common directory. Its phases
are `prepared`, `cloud-renewed`, `lease-projected`, `marker-projected`, and `complete`.

The prepared phase seals the predecessor lease, first-recovery receipt, and committed-descendant
evidence. Cloud continuation uses the existing dormant-recovery primitive. The adapter precomputes
the target lease before CAS, allowing replay to adopt an already-projected lease. Marker projection
similarly accepts only the exact source or target marker. Terminal verification rejoins Git, cloud,
lease, pull request, and task binding before sealing the receipt.
