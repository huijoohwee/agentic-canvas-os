---
title: "Canonical Squash PR818 Attribution Recovery"
graphId: "md:canonical-squash-pr818-attribution-recovery"
doc_type: "Recovery Evidence"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-canonical-squash-attribution-recovery-evidence/v1"
frontmatter_contract: "required"
status: "source-backed"
authority: "append-only evidence for protected PR818 terminalization"
runtime_scope: "attribution recovery evidence only"
runtime_proof: "protected pull-request and post-main CI evidence"
failed_protected_main_sha: "ef37a86ac7064c674a972d2afdd8e822ead7de69"
reviewed_pull_request: "818"
reviewed_source_head: "d29a375715b0a363c475dac0bc33969fad4aa82e"
reviewed_source_tree: "196fc18e560474b04055184a0f6e4f67e66c8e81"
reviewed_run_id: "33334455600"
post_merge_run_id: "33334624343"
controller_source: "huijoohwee/agentic-canvas-os"
controller_revision: "ef37a86ac7064c674a972d2afdd8e822ead7de69"
deployment_authority: "forbidden"
---

# Canonical Squash PR818 Attribution Recovery

This append-only record preserves the exact evidence needed to terminalize the
already-integrated Agentic Canvas OS PR 818 without rewriting its protected
history or weakening attribution checks.

## Protected subject

| Evidence | Exact value |
| --- | --- |
| Pull request | `huijoohwee/agentic-canvas-os#818` |
| Protected base | `ed7461e5b272da1cba4cd31c079e12259965eaf1` |
| Authored head | `feddc30a5e24f7bd602bb8d7bf8720c0f544a9be` |
| Authored tree | `c68b1dd8726093ea89509703e7cf9fa47c6ad9ce` |
| Protected-refresh head | `d29a375715b0a363c475dac0bc33969fad4aa82e` |
| Protected-refresh parents | `feddc30a5e24f7bd602bb8d7bf8720c0f544a9be ed7461e5b272da1cba4cd31c079e12259965eaf1` |
| Protected-refresh tree | `196fc18e560474b04055184a0f6e4f67e66c8e81` |
| Protected squash | `ef37a86ac7064c674a972d2afdd8e822ead7de69` |
| Protected squash parent | `ed7461e5b272da1cba4cd31c079e12259965eaf1` |
| Protected squash tree | `196fc18e560474b04055184a0f6e4f67e66c8e81` |

The reviewed change declared exactly the following six paths:

- `__tests__/canonical-squash-attribution-recovery-terminalization.test.mjs`
- `docs/CANONICAL-SQUASH-ATTRIBUTION-RECOVERY-TERMINALIZATION.md`
- `scripts/canonical-squash-attribution-recovery-terminalization-contract.mjs`
- `scripts/canonical-squash-attribution-recovery-terminalization-controller.mjs`
- `scripts/canonical-squash-attribution-recovery-terminalization-repository-adapter.mjs`
- `scripts/canonical-squash-attribution-recovery-terminalization.mjs`

Their admitted write-set digest is
`22a6f1461488edde621b5eca727a068528865606b8b2df148c07e731c5a1a36e`.
The protected-refresh tree is the exact tree integrated by the protected squash.

## Provider and check evidence

The provider recorded merge method `SQUASH`, headline
`feat(canonical-squash-recovery-terminalizer): terminalize recovery`, and a
null auto-merge body. It then generated coordination bullets, a separator, and
two `Co-authored-by` trailers after the reviewed four-field Agentic attribution
block. The protected commit therefore retained the reviewed tree but did not
retain that block as its final trailer block.

The exact reviewed-head CI run
[`33334455600`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33334455600)
completed successfully at `d29a375715b0a363c475dac0bc33969fad4aa82e`.
The exact post-main CI run
[`33334624343`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33334624343)
completed successfully at `ef37a86ac7064c674a972d2afdd8e822ead7de69`.
Cloud collaboration and CodeQL also completed successfully for the protected
revision.

## Authority lineage

The terminal subject is claim
`d191efeece375429d73bd7da15d78e80f46ceadaf37f3499f4a91687713bdcab`,
task binding digest
`957014bbe4a027b96a048b1c60f9139b2e608ac48ab69bd8581c50fa6c3ed091`,
and review request `github-pull-request:PR_kwDOSr5-fM8AAAABBf-hDQ`.
Its integrated-preserved transition is ledger sequence 6450 with integration
receipt `50bf7816901a9fa563f76bee7a668d6422872711fa30a2a5c3085423d1a5c7bd`.
The exact integrated entry digest is
`a0fa3b5de0d71b2d9acab3f54c8076490ed9aeba46bb9354733399870b1aa1e6`.
Its exact integrated retirement is ledger sequence 6451, transition 6, final
claim digest
`8d265450c2095a65e1616c062b3068225236d22d20f379d636c74ab827d5f7a7`,
and terminal entry digest
`ed7a9fda5b05fca33a7f2c4f8560816862402a2db24973ff0140efab80b0980c`.
The retirement binds bytes digest
`7a130cfe222f717237bad97435a3548a4cfa5dec1a3ec3205eb73150d33f312b`
and retired time `2026-08-30T20:48:19.000Z`.

The historical authored attribution used lease epoch 2. The current preserved
successor authority is epoch 3 after repository-owned recovery and protected
refresh. A terminal controller must prove that monotonic lineage explicitly;
it must not substitute the current epoch into the immutable historical commit.

## Recovery boundary

This document adds evidence only. It preserves PR 818, its authored branch and
tree, its protected squash, and every authority record. It authorizes no source
rewrite, direct-main push, force, check bypass, release, deployment, or broad
cleanup. A repository-owned terminal controller may use it only to adopt the
already-retired cloud subject, project the exact preserved lease to completion,
and hand final runtime convergence and exact worktree cleanup back to ordinary
`device:integrate`.

Deployment authority is forbidden.
