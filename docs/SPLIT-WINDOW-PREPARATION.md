---
title: "Split-window Preparation"
graphId: "md:split-window-preparation"
doc_type: "Lifecycle Capability"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-split-window-preparation-package/v1"
frontmatter_contract: "required"
status: "contract-ready"
authority: "content-addressed inert preparation followed by fresh-authority import"
---

# Split-window Preparation

Split-window preparation permits bounded work to continue while a task lane lacks
joined mutation authority. Window A creates only an external, content-addressed
package. Window B imports that package only after a fresh provider-neutral cloud,
local lease, worktree, ref, and review join produces an in-process single-use
authority object.

The serialized package always records `mutationAuthority: false`. Stored cloud
verification, lease, pull-request, or provider receipts are historical evidence
and can never authorize import. The importer repeats live verification under a
subject fence and consumes authority in the same process as the journaled effect.

Packages contain inert `patch`, `evidence`, and `test-plan` components. Window A
may execute only host-registered verifier profiles inside a disposable clone. It
may not execute package payloads, write the source or target repository, mutate
refs, edit provider state, change a writer registry, or update cloud authority.
The clone is detached at the exact base, has no remote, uses a private empty home,
and receives no credential environment. Component publication is
content-addressed, atomically renamed, and restricted to a new isolated artifact
root outside repositories, Git common directories, registered worktrees, and
recovery evidence.

Every artifact declares the exact normalized path set it represents. The union
of artifact paths must equal the bundle path manifest; undeclared and unrepresented
paths fail before publication. Patch and blob bytes remain inert until Window B.
Verifier profiles are host-owned exact executable, argv, timeout, and digest
records. Shell `-c` and interpreter evaluation profiles are rejected.

Import requires exact repository, origin, base SHA/tree, branch, fence, manifest,
write set, dependency closure, device, and session parity. Paths must be declared,
normalized, symlink-free, case-unique, and outside `.git`. A durable write-ahead
journal seals the exact pre-state before the first file effect. A failed verifier
leaves the operation at `applied` with its evidence; it does not guess at rollback.
Ambiguous user edits or crash states fail closed for owner-led reconciliation.

The import journal is an ordered hash chain:

`sealed -> planned -> armed -> applied -> verified -> complete`

`armed` records the fresh authority observation but is not itself authority. Every
execution or replay re-enters a cooperative writer fence, performs fresh cloud and
local verification, and obtains a new in-process single-use capability. If replay
observes the exact pre-state it may apply once; if it observes the exact expected
post-state it reconstructs the lost effect receipt. Any third state blocks.

The pure contract and controller are provider-neutral. Provider adapters expose
only a fresh `withJoinedMutationFence` callback whose single-use in-process object
is consumed around the effect. Serialized bundles, plans, journals, verification
observations, and receipts always report `mutationAuthority: false` and are never
rehydrated as capabilities. A provider without a fresh cloud/local join and a
cooperative writer fence cannot import a package.

## Module boundaries

| Module | Responsibility |
|---|---|
| `split-window-preparation-contract.mjs` | Closed schemas, content digests, typed phase chain, and authority-less receipts. |
| `split-window-preparation-store.mjs` | External content-addressed objects, compare-and-swap journals, receipts, and stale-owner locking. |
| `split-window-preparation-sandbox.mjs` | Disposable credential-free clone and allowlisted verifier profiles. |
| `split-window-preparation-controller.mjs` | Double-capture preparation and pre/post/ambiguous-state import replay. |
| `split-window-preparation-repository-adapter.mjs` | Exact Git identity capture and injected repository/authority/verifier ports. |
| `split-window-preparation.mjs` | Read-only object and operation inspection CLI. |

The CLI intentionally exposes no generic apply command. A repository composes
the import controller with its own joined-authority, patch materialization, and
verifier adapters; this prevents a raw command line from becoming an authority
or arbitrary execution bypass.

## Proof boundary

Focused tests cover deterministic authority-less bundles, unsafe and case-folded
paths, exact artifact-path coverage, closed phase values, double capture, intent
before effect, single-use authority consumption, lost-response reconciliation,
ambiguous-state refusal, external-store isolation, repository identity capture,
credential-free disposable clones, forbidden verifier forms, content-addressed
publication, and journal compare-and-swap. These tests establish the generic
contract only. They do not establish a provider-specific import, protected merge,
release, deployment, or Production readiness.

Independent component construction and read-only evidence capture may run in
parallel. Component publication, import, review, integration, release, and deploy
remain serialized by their respective authority fences.
