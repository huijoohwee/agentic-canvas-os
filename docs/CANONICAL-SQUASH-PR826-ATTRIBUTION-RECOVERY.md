---
title: "Canonical Squash PR826 Attribution Recovery"
graphId: "md:canonical-squash-pr826-attribution-recovery"
doc_type: "Recovery Evidence"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-canonical-squash-attribution-recovery-evidence/v1"
frontmatter_contract: "required"
status: "source-backed"
authority: "append-only evidence for protected PR826 terminalization"
runtime_scope: "attribution recovery evidence only"
runtime_proof: "protected pull-request and post-main CI evidence"
failed_protected_main_sha: "ab6ef4ab22f8828ed37e51bc7a880befccb3cf77"
reviewed_pull_request: "826"
reviewed_source_head: "08cf277cc3c0566071b7f4567b9b2e4433774417"
reviewed_source_tree: "e1a210125de086c8ec92e88d40794dcac3d5e951"
reviewed_run_id: "33335928794"
post_merge_run_id: "33336062186"
controller_source: "huijoohwee/agentic-canvas-os"
controller_revision: "ab6ef4ab22f8828ed37e51bc7a880befccb3cf77"
deployment_authority: "forbidden"
---

# Canonical Squash PR826 Attribution Recovery

This append-only record preserves the exact evidence needed to terminalize the
already-integrated Agentic Canvas OS PR 826 without rewriting its protected
history or weakening attribution checks.

## Protected subject

| Evidence | Exact value |
| --- | --- |
| Pull request | `huijoohwee/agentic-canvas-os#826` |
| Protected base | `ef37a86ac7064c674a972d2afdd8e822ead7de69` |
| Coordination fence | `34053c89abefc71b359e00630186d0198278af2b` |
| Reviewed source head | `08cf277cc3c0566071b7f4567b9b2e4433774417` |
| Reviewed source parent | `34053c89abefc71b359e00630186d0198278af2b` |
| Reviewed source tree | `e1a210125de086c8ec92e88d40794dcac3d5e951` |
| Protected squash | `ab6ef4ab22f8828ed37e51bc7a880befccb3cf77` |
| Protected squash parent | `ef37a86ac7064c674a972d2afdd8e822ead7de69` |
| Protected squash tree | `e1a210125de086c8ec92e88d40794dcac3d5e951` |

The reviewed change declared exactly this path:

- `docs/CANONICAL-SQUASH-PR818-ATTRIBUTION-RECOVERY.md`

Its admitted write-set digest is
`78fd59c317ed7204fbb71fa259efb5100072ba853f0804e832504e40e1af2364`.
The reviewed source tree is the exact tree integrated by the protected squash.

## Provider and check evidence

The provider recorded merge method `SQUASH`, headline
`docs(canonical-squash-pr818-attribution-recovery): record evidence`, and a
null auto-merge body. It then generated coordination and source bullets, a
separator, and one `Co-authored-by` trailer after the reviewed four-field
Agentic attribution block. The protected commit therefore retained the reviewed
tree but did not retain that block as its final trailer block.

The exact reviewed-head CI run
[`33335928794`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33335928794)
completed successfully at `08cf277cc3c0566071b7f4567b9b2e4433774417`.
The exact post-main CI run
[`33336062186`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33336062186)
completed successfully at `ab6ef4ab22f8828ed37e51bc7a880befccb3cf77`.
Cloud collaboration run `33336062164` and sync run `33336062138` also
completed successfully for the protected revision.

## Authority lineage

The terminal subject is claim
`1c55ad9fe42e1fe24805c4be264b08f9782b00d628640027d1c110e3cf47defe`,
task binding digest
`cd5c96ee14c4a632badeb01a82295b8d7e8f61a28c2823ec0f5849aca107551a`,
and review request `github-pull-request:PR_kwDOSr5-fM8AAAABBh1GEw`.
Its integrated-preserved transition is ledger sequence 6457, transition 5,
with integration receipt
`44c21fad846e1319d856c9868a51dbf36b21a8c2375e6cb788b5a438d7ad51eb`.
The exact integrated claim digest is
`149642a31b30254193058250c72728e60e6bc66600e1cef774f280fe67b412d6`,
and the exact integrated entry digest is
`abab6ff6710d3a4e2f43768bf0114f4b9b294c2e56e4974078ba1d6b30a2e96c`.
Its exact integrated retirement is ledger sequence 6458, transition 6, final
claim digest
`2a8e8074d7598f0d6056c2a0cdb0a00804bc682fc9da4b29c240833c681af85b`,
and terminal entry digest
`ca96e0f43296f7030e16d9626a47717bcb586a10cae8b819e06972f16bdee491`.
The retirement binds bytes digest
`a4ee06b7007bebebd266a931f0b1b6c8c21cc2fe75af89f6097f98564f72e45a`
and retired time `2026-08-30T21:19:06.000Z`.

The local writer registry identifies lease epoch 326, while the immutable cloud
claim lineage uses lease epoch 1. A terminal controller must preserve both
namespaces and must not substitute the local registry epoch into the historical
cloud or commit evidence.

## Recovery boundary

This document adds evidence only. It preserves PR 826, its authored branch and
tree, its protected squash, and every authority record. It authorizes no source
rewrite, direct-main push, force, check bypass, release, deployment, or broad
cleanup. A repository-owned terminal controller may use it only to adopt the
already-retired cloud subject, project the exact preserved lease to completion,
and hand final runtime convergence and exact worktree cleanup back to ordinary
`device:integrate`.

Deployment authority is forbidden.
