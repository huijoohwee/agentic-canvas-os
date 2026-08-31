---
title: "Canonical Squash PR833 Attribution Recovery"
graphId: "md:canonical-squash-pr833-attribution-recovery"
doc_type: "Recovery Evidence"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-canonical-squash-attribution-recovery-evidence/v1"
frontmatter_contract: "required"
status: "source-backed"
authority: "append-only evidence for protected PR833 terminalization"
runtime_scope: "attribution recovery evidence only"
runtime_proof: "protected pull-request and post-main CI evidence"
failed_protected_main_sha: "270b8568925cb23f5044dcf6fadd401b7439eb54"
reviewed_pull_request: "833"
reviewed_source_head: "82e98f98490fe2c4d5696022beb06ebe3c4d2e43"
reviewed_source_tree: "80457cca79991b04f196bbf8616d4d61cfea40b6"
reviewed_run_id: "33348233881"
post_merge_run_id: "33348382509"
controller_source: "huijoohwee/agentic-canvas-os"
controller_revision: "270b8568925cb23f5044dcf6fadd401b7439eb54"
deployment_authority: "forbidden"
---

# Canonical Squash PR833 Attribution Recovery

This append-only record preserves the exact evidence needed to terminalize the
already-integrated Agentic Canvas OS PR 833 without rewriting its protected
history or weakening attribution checks.

## Protected subject

| Evidence | Exact value |
| --- | --- |
| Pull request | `huijoohwee/agentic-canvas-os#833` |
| Protected base | `528b1f93f945f97813bcb14db326ec5d7450b63c` |
| Coordination fence | `7d9c8f006d1cc2583dcf98ca2795d0ae8eb7163a` |
| Reviewed source head | `82e98f98490fe2c4d5696022beb06ebe3c4d2e43` |
| Reviewed source parent | `7d9c8f006d1cc2583dcf98ca2795d0ae8eb7163a` |
| Reviewed source tree | `80457cca79991b04f196bbf8616d4d61cfea40b6` |
| Protected squash | `270b8568925cb23f5044dcf6fadd401b7439eb54` |
| Protected squash parent | `528b1f93f945f97813bcb14db326ec5d7450b63c` |
| Protected squash tree | `80457cca79991b04f196bbf8616d4d61cfea40b6` |

The reviewed change declared exactly the following three paths:

- `__tests__/canonical-squash-attribution-recovery-terminalization.test.mjs`
- `docs/CANONICAL-SQUASH-ATTRIBUTION-RECOVERY-TERMINALIZATION.md`
- `scripts/canonical-squash-attribution-recovery-terminalization-repository-adapter.mjs`

Their admitted write-set digest is
`04fe39156afc29f2096ce44cc089257de9148b0d571454e68e8a1221a5882aba`.
The reviewed source tree is the exact tree integrated by the protected squash.

## Provider and check evidence

The provider recorded merge method `SQUASH`, headline
`fix(canonical-squash-rerun-job-identity): bind rerun job`, and a null
auto-merge body. It then generated coordination and source bullets, a separator,
and one `Co-authored-by` trailer after the reviewed four-field Agentic
attribution block. The protected commit therefore retained the reviewed tree but
did not retain that block as its final trailer block.

The exact reviewed-head CI run
[`33348233881`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33348233881)
completed successfully at `82e98f98490fe2c4d5696022beb06ebe3c4d2e43`.
The exact post-main CI run
[`33348382509`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33348382509)
completed successfully at `270b8568925cb23f5044dcf6fadd401b7439eb54`.
Cloud collaboration run `33348382554`, CodeQL run `33348382564`, and sync
run `33348382531` also completed successfully for the protected revision.

## Authority lineage

The terminal subject is claim
`cc8090a2b1a24e9fe0efac307e43c99cb0ae169834b64b886d5a4d23246766ce`,
task binding digest
`0f97f6d95b56e533b82a0ba7a70ba83259b727c1df458cf4df5a06c19742cf9b`,
and review request `github-pull-request:PR_kwDOSr5-fM8AAAABBiqBcQ`.
Its integrated-preserved transition is ledger sequence 6509, transition 6,
with integration receipt
`392c440ec5fca45a5693b2718ecc60ea75ff01347aa46597cfcdd5486055eca1`.
The exact integrated claim digest is
`22653f8b85dde876c9fe7359b92b983a0d1987fcd13097abfab2e37274640448`,
and the exact integrated entry digest is
`1a0cdf7ebf7bb2e556c17ea43a06368b027a22f04517e91e6fe0c1a6c7cd25ed`.
Its exact integrated retirement is ledger sequence 6510, transition 7, final
claim digest
`4ddcf592798ac819e0a5567459f0e522218a38816a7d9f07aba33827a1c5a12a`,
and terminal entry digest
`6da6cf66250668f1a366ef8e738f871d4e03089a9f36f3cce2a7f1d8f273b13e`.
The retirement binds bytes digest
`154a742e6cf48dbf5893a5a04861ca5eba5e11c6b25c1fe073d923094dc27d08`
and retired time `2026-08-31T01:42:38.000Z`.

The local writer registry identifies lease epoch 330, while the immutable cloud
claim lineage uses lease epoch 2. A terminal controller must preserve both
namespaces and must not substitute the local registry epoch into the historical
cloud or commit evidence.

## Recovery boundary

This document adds evidence only. It preserves PR 833, its authored branch and
tree, its protected squash, and every authority record. It authorizes no source
rewrite, direct-main push, force, check bypass, release, deployment, or broad
cleanup. A repository-owned terminal controller may use it only to adopt the
already-retired cloud subject, project the exact preserved lease to completion,
and hand final runtime convergence and exact worktree cleanup back to ordinary
`device:integrate`.

Deployment authority is forbidden.
