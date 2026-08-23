# Design

The public plan binds path-portable source evidence, the exact strict-superset manifest, the
protected controller revision, and an exact authorization digest. The repository adapter stores a
fixed-path CAS journal below the target Git common directory. Its phases are `prepared`,
`waiting-successor`, `source-retired`, `successor-promoted`, `successor-bound`, `local-projected`,
`marker-projected`, and `complete`.

The prepared phase seals the predecessor lease, first-recovery receipt, and committed-descendant
evidence. The adapter claims a waiting strict-superset successor, retires only the sealed source,
promotes and binds the successor to the reviewed head, then atomically projects the expanded
admission and continued task binding. Replay adopts only the exact successor lease. Marker
projection similarly accepts only the exact source or target marker. Terminal verification rejoins
Git, cloud, lease, pull request, and task binding before sealing the receipt.
