---
title: Expired committed heartbeat recovery
graphId: "md:expired-committed-heartbeat-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-expired-committed-heartbeat-recovery-doc/v1"
frontmatter_contract: "required"
status: "normative"
scope: "task-bound expired committed heartbeat recovery"
---

# Expired committed heartbeat recovery

This controller recovers one clean admitted task lane whose local HEAD is an
in-scope committed descendant, while its cloud heartbeat and local lease have
expired. It restores the same claim and lease; it does not integrate, deploy,
clean, attach, reset, or widen the declared write scope.

## Explicit task authority

Execution requires `--task-authority=<absolute external capability>`. The file
must be a regular non-symlink file with mode `0600` and must remain outside the
target repository. Ambient capability discovery is not an execution input.

The controller proves the capability against the source lease binding for the
operation `expired-committed-heartbeat-recovery` before its first cloud,
writer-registry, or pull-request effect. Missing, mismatched, embedded, or
non-private capability input fails with zero such effects.

## Ordered durable boundaries

Recovery proceeds through the repository's existing durable projections:

1. verify the explicit task capability against the exact source lease;
2. capture the clean committed-descendant, remote-prefix, protected-main, cloud,
   and pull-request marker evidence;
3. continue the same cloud claim with its evidence-bound idempotency key;
4. compare-and-swap the exact writer lease, recording the recovered heartbeat;
5. replace only the hidden writer marker in the existing pull request;
6. independently re-read cloud, lease, Git, and marker projections.

The cloud continuation receipt is the durable cloud phase. The recovered writer
lease is the durable local phase. The exact pull-request marker is the durable
review phase. A retry adopts these recorded phases: cloud response loss is
reconciled by the same continuation identity, local-CAS completion is detected
from the recovery receipt, and marker-only completion performs no second cloud
or lease transition.

## Invocation

```sh
node scripts/device-expired-committed-heartbeat.mjs \
  --repository=/absolute/task-worktree \
  --session=<source-session> \
  --task-authority=/absolute/external/task-authority.json \
  --ttl-seconds=1800 \
  --json
```

Successful output includes the task-authority verification receipt and the
existing mutation-authority receipt. Neither receipt exposes capability secret
material or grants release or deployment authority.
