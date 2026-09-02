---
title: "Canonical Squash PR849 Attribution Recovery"
graphId: "md:canonical-squash-pr849-attribution-recovery"
doc_type: "Recovery Evidence"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-canonical-squash-attribution-recovery-evidence/v1"
frontmatter_contract: "required"
status: "source-backed"
authority: "append-only evidence for protected PR849 terminalization"
runtime_scope: "attribution recovery evidence only"
runtime_proof: "protected pull-request and post-main CI evidence"
failed_protected_main_sha: "a74106e888294225f0e7a9c9388a8f102fb8ce10"
reviewed_pull_request: "849"
reviewed_source_head: "3a6c349f6864bf695014c3809b4301e07e03b753"
reviewed_source_tree: "7a4d753502dd158fc4ffc2b02a89c247d9b1afb1"
reviewed_run_id: "33376136133"
post_merge_run_id: "33376672515"
controller_source: "huijoohwee/agentic-canvas-os"
controller_revision: "a74106e888294225f0e7a9c9388a8f102fb8ce10"
deployment_authority: "forbidden"
---

# Canonical Squash PR849 Attribution Recovery

This append-only record preserves the exact evidence needed to terminalize the
already-integrated Agentic Canvas OS PR 849 without rewriting its protected
history or weakening attribution checks.

## Protected subject

| Evidence | Exact value |
| --- | --- |
| Pull request | `huijoohwee/agentic-canvas-os#849` |
| Protected base | `c7194b8d70d53ad90721f2822fe05adde4659e4e` |
| Coordination fence | `750591206eb27d4b902b41812514638f71f18f9a` |
| Reviewed source head | `3a6c349f6864bf695014c3809b4301e07e03b753` |
| Reviewed source parent | `750591206eb27d4b902b41812514638f71f18f9a` |
| Reviewed source tree | `7a4d753502dd158fc4ffc2b02a89c247d9b1afb1` |
| Protected squash | `a74106e888294225f0e7a9c9388a8f102fb8ce10` |
| Protected squash parent | `c7194b8d70d53ad90721f2822fe05adde4659e4e` |
| Protected squash tree | `7a4d753502dd158fc4ffc2b02a89c247d9b1afb1` |

The reviewed change declared exactly the following four paths:

- `__tests__/active-dirty-scope-expansion-intent-supersession.test.mjs`
- `docs/ACTIVE-DIRTY-SCOPE-EXPANSION-INTENT-SUPERSESSION.md`
- `scripts/active-dirty-scope-expansion-intent-supersession-contract.mjs`
- `scripts/active-dirty-scope-expansion-intent-supersession-repository-adapter.mjs`

Their admitted write-set digest is
`34e87659ac8720330ccfaaef9b9979057e4ec2eeae909ad73b0ab656ac4a2f50`.
The reviewed source tree is the exact tree integrated by the protected squash.

## Provider and check evidence

The provider recorded merge method `SQUASH`, headline
`fix(pr839-intent-supersession-recovered-continuation): join recovery`, and a
null auto-merge body. It then generated coordination and source bullets, a
separator, and one `Co-authored-by` trailer after the reviewed four-field
Agentic attribution block. The protected commit therefore retained the reviewed
tree but did not retain that block as its final trailer block.

The exact reviewed-head CI run
[`33376136133`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33376136133)
completed successfully at `3a6c349f6864bf695014c3809b4301e07e03b753`.
The exact post-main CI run
[`33376672515`](https://github.com/huijoohwee/agentic-canvas-os/actions/runs/33376672515)
completed successfully at `a74106e888294225f0e7a9c9388a8f102fb8ce10`.
Cloud collaboration run `33376672538`, CodeQL run `33376672518`, and sync
run `33376672593` also completed successfully for the protected revision.

## Authority lineage

The terminal subject is claim
`4d23a9f77a3c76c217f06e8d8312c277cd7cee7180292cd9a2e15333fbc19a53`,
task binding digest
`86b808e24e2b4982dede6f6a48ddcefdbb8e83700806e56462000b65fe4c474c`,
and review request `github-pull-request:PR_kwDOSr5-fM8AAAABBkyRKg`.
Its integrated-preserved transition is ledger sequence 6671, transition 6,
with integration receipt
`29b139d61d1137fe590a107013bf032ec1e37e9b2a0f6a629c2c3dc7949d3403`.
The exact integrated claim digest is
`f16fcd9ea2f4c486e326f5d45996e86d6e50b6d66663ecebea3b44e63b85e8ef`,
and the exact integrated entry digest is
`80b44ccb9f7c3752de61337ca8eb5344dba8785ba708c138b0f006c57addface`.
Its exact integrated retirement is ledger sequence 6672, transition 7, final
claim digest
`1cca0a41e4fd1cfa5ed74bcf37d83a92daeb57ba53f0d86a7be93d4acd546ef3`,
and terminal entry digest
`b98f9613df4d0dadcf188eeafe9516bd7e9e5b6108356d9a18945d2c2fdcd3f1`.
The retirement binds bytes digest
`41f31e46d4329fae24a8ef2cf7c98fc7eab792982ac1b2e554d36374a49f0801`
and retired time `2026-08-31T09:14:57.000Z`.

The local writer registry identifies lease epoch 336, while the immutable cloud
claim lineage uses lease epoch 1. A terminal controller must preserve both
namespaces and must not substitute the local registry epoch into the historical
cloud or commit evidence.

## Recovery boundary

This document adds evidence only. It preserves PR 849, its authored branch and
tree, its protected squash, and every authority record. It authorizes no source
rewrite, direct-main push, force, check bypass, release, deployment, or broad
cleanup. A repository-owned terminal controller may use it only to adopt the
already-retired cloud subject, project the exact preserved lease to completion,
and hand final runtime convergence and exact worktree cleanup back to ordinary
`device:integrate`.

Deployment authority is forbidden.
