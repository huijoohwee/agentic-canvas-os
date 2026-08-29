---
title: "Expired Published Bind-Ahead Clean-Descendant Recovery"
graphId: "md:expired-published-bind-ahead-clean-descendant-recovery"
doc_type: "Recovery Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-expired-published-bind-ahead-clean-descendant-recovery-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned recovery for one exact expired F < R <= H lane"
runtime_scope: "same-claim cloud recovery, local writer-lease continuation, and hidden review marker projection"
runtime_claim: "restores authoring authority without changing source bytes, Git refs, or visible pull-request state"
publish_policy: "protected green main authorizes Dev integration only; Production remains separately authorized"
runtime_proof: "focused controller and repository-adapter tests"
---

# Expired Published Bind-Ahead Clean-Descendant Recovery

## Purpose

This controller repairs one narrow partial-projection state:

- the local writer lease still records transition `tN` at source fence `F`;
- the remote branch and draft pull request record a strict descendant `R`;
- the same cloud claim already records the device-review bind `tN+1` at `R`;
- the clean attached worktree records `H`, where `R` is an ancestor of or equal to `H`;
- the task-authority binding is still valid and must be retained byte-for-byte; and
- the cloud claim is either current or dormant-preserved.

The outcome is an active same-claim authority at `R`, a local lease whose fence is `R`, the unchanged clean local descendant `H`, and an exact hidden writer-lease marker. This restores authoring authority only. It grants no integration, release, deployment, cleanup, or pull-request state authority.

## Evidence Boundary

Planning reuses `captureExpiredCommittedHeartbeatSnapshot()` schema v3. The snapshot proves the complete `F..R` published prefix and `F..H` local suffix, admitted-path containment, protected-main byte equivalence where applicable, a clean worktree, and the exact source body and marker digests.

Cloud evidence reads two raw append-only ledger snapshots:

1. The source authority's `ledgerRevision` and `ledgerDigest` identify the complete historical transport snapshot. That snapshot may end several unrelated entries after the claim's source transition.
2. `claimLedgerRevision` identifies the source claim entry inside that historical snapshot. It is not the transport head.
3. The current ledger must contain the historical snapshot as an exact prefix.
4. The unique next transition for the same claim must be the device-review bind from `F` to `R` at `tN+1`.
5. Unrelated entries may occur between the source claim entry, the historical transport head, the bind, and the current transport head.
6. No later same-claim transition is accepted during planning. During replay, zero or more exact controller-owned renewal or dormant-recovery continuations are accepted only when each transition is bound to the immediately preceding counter and claim digest plus the sealed recovery-evidence digest.

Terminal verification intentionally does not seal the mutable global ledger head. It seals the effective sidecar-generation head, claim ID, claim and transition digests, transition counter, operation receipt, verified cloud-authority digest, local lease and registry revision, marker and body digests, `F`, `R`, `H`, and retained task binding.

## Durable Phases

The private intent advances in this exact order:

1. `authorized`
2. `task-authority-verified`
3. `branch-fence-attempted`
4. `branch-fenced`
5. `bind-adopted`
6. `cloud-attempted`
7. `cloud-reconciled`
8. `local-attempted`
9. `local-projected`
10. `marker-attempted`
11. `marker-projected`
12. `verified`
13. `complete`

Every attempt receipt is durable before its effect. Each effect first adopts an already-completed target, performs the mutation only from the exact source state, and re-reads the target after a provider response error. The operation lock and compare-and-swap journal live below the real Git common directory with private permissions. Cloud projections form an append-only digest chain: every generation seals its full authority, runtime verification, reconciliation receipt, preceding-generation digest, ordinal, and plan digest. After `marker-attempted`, the controller establishes a fresh minimum cloud horizon, converges the lease and marker to the sidecar head, and persists `marker-projected`, `verified`, and `complete` in one journal compare-and-swap. A crash before that write replays from `marker-attempted`; a landed write has no time-sensitive intermediate phase to strand.

Before the first cloud or projection effect, the controller also installs one deterministic same-branch fence in the writer registry. It rejects every existing scope-expansion, owned-dirt, reviewed-revision, or reviewed-entrypoint intent for that branch. Standard device operations fail closed on the fence, which survives process restart and remains exact through cloud recovery, lease CAS, marker projection, and terminal verification. It is removed only after the `complete` intent is durable; replay adopts either the exact fence or its already-completed release.

## Mutation Policy

The controller permits only:

- one durable writer-registry branch-controller fence and its post-completion release;
- one or more exact same-claim projection-horizon renewals or dormant recoveries when the current checkpoint cannot safely cover the next local or provider effect;
- one exact source-to-target writer-registry compare-and-swap; and
- one pull-request body edit that replaces only the hidden writer-lease marker.

Each conditional cloud continuation keeps the claim ID, immutable owner subject, review request, base, lane revision `R`, write set, and lease epoch unchanged. A current authority may be renewed only to establish the minimum sealed projection horizon; a dormant authority may be recovered through the same repository-owned continuation port. Every continuation is joined to the immediately prior sidecar generation before any local or provider effect.

The local projection sets `fenceSha` to published/reviewed `R`, not unpublished local `H`. It carries the verified cloud authority and retains the exact existing `taskAuthority` object. It does not mint a continuation binding because no claim identity changes.

The provider phase runs after the local compare-and-swap while the durable writer-registry controller fence remains present. Before projecting the marker it refreshes a stale earlier-generation local lease to the newest joined sidecar generation. The source body must match the sealed source body, and the target body must preserve the visible-body digest exactly. Title, draft state, review identity, head, base, auto-merge state, and every visible body byte remain unchanged. Provider response-loss adoption is recorded separately from a mutation performed by the current invocation.

The controller forbids source edits, index edits, commits, checkout changes, local or remote ref changes, pushes, device-review bind replay, new claims, new pull requests, merges, integration, release, deployment, and cleanup.

## Commands

Generate a sealed plan from the exact task worktree:

```sh
node scripts/expired-published-bind-ahead-clean-descendant-recovery.mjs plan \
  --repository="$TASK_WORKTREE" \
  --session="$WRITER_SESSION" \
  --pull-request="$PULL_REQUEST_NUMBER" \
  --json > "$EXTERNAL_PRIVATE_PLAN"
```

Inspect the plan digest and run only with the exact authorization token and an external private task capability:

```sh
node scripts/expired-published-bind-ahead-clean-descendant-recovery.mjs run \
  --repository="$TASK_WORKTREE" \
  --session="$WRITER_SESSION" \
  --pull-request="$PULL_REQUEST_NUMBER" \
  --plan-file="$EXTERNAL_PRIVATE_PLAN" \
  --task-authority="$EXTERNAL_PRIVATE_TASK_CAPABILITY" \
  --authorize="authorize expired-published-bind-ahead-clean-descendant-recovery <plan-digest>" \
  --json
```

The plan and capability files must be private regular files outside the repository worktree. A changed plan, runtime subject, source body, marker, Git frame, claim suffix, task binding, local lease, or competing scope fails closed.

## Completion Receipt

The completion receipt reports the initial cloud disposition plus the final sidecar-head disposition, generation count, continuation count, renewal count, recovery count, response-loss adoption, and aggregate cloud-mutation fact. It joins the durable branch fence, bind proof, recovery evidence, task proof, final cloud authority, final lease, registry revision, target marker, and terminal verification. The branch fence is released only after this receipt is durably complete and against the final verified lease digest. The receipt explicitly records all forbidden effects as false and does not claim protected integration or Production readiness.
