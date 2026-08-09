---
title: "Retired Handoff Successor Disposition"
graphId: "md:agentic-retired-handoff-successor-disposition"
doc_type: "Runtime Contract"
date: "2026-08-10"
lang: "en-US"
schema: "agentic-retired-handoff-successor-disposition/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "receipt-bound logical disposition of one exact retired-handoff provider subject"
runtime_scope: "read-only planning, exact authorization, immutable receipt persistence, and live receipt validation"
runtime_claim: "focused Dev proof only; provider closure, admission wiring, integration, runtime readiness, and deployment remain separately gated"
runtime_owner: "../scripts/retired-handoff-successor-disposition-contract.mjs; ../scripts/retired-handoff-successor-disposition-controller.mjs; ../scripts/retired-handoff-successor-disposition-repository-adapter.mjs; ../scripts/retired-handoff-successor-disposition.mjs; ../scripts/provider-scope-disposition.mjs"
runtime_proof: "../__tests__/retired-handoff-successor-disposition-contract.test.mjs; ../__tests__/retired-handoff-successor-disposition-controller.test.mjs; ../__tests__/retired-handoff-successor-disposition-repository-adapter.test.mjs; ../__tests__/retired-handoff-successor-disposition-cli.test.mjs; ../__tests__/provider-scope-disposition.test.mjs"
publish_policy: "Dev-only; no protected integration, Production mirror, or deployment authority"
---
<!-- Responsibility: Define the exact evidence, authorization, preservation, and replay boundary for one retired-handoff provider subject. -->

# Retired handoff successor disposition

This controller records a logical provider-scope disposition when one exact cloud
claim was retired for `handoff` and an explicitly reviewed port map proves how its
functional work relates to one merged successor pull request.

The controller never closes or edits a pull request, moves a branch, changes the
cloud ledger, deletes a worktree, resets bytes, or grants authoring authority. Its
only semantic outcome is subject-bound intent and immutable receipt journals;
locks are transient. A later consumer may suppress only the receipt's exact source
provider subject after re-reading all bound identities.

## Safety boundary

The plan binds all of the following:

- a stable, fully validated raw collaboration ledger and the source claim's unique
  terminal `retired` entry with reason `handoff`;
- the exact clean protected controller checkout, GitHub origin, main revision,
  tree, and disposition runtime file-set digest;
- the exact source pull-request repository, node, number, state, draft bit, branch,
  head, base, body digest, and remote branch head;
- the exact local branch, worktree, lease, index, and working-tree projection, or
  their proved absence;
- the successor pull request's merged state, head, merge commit, required checks,
  changed paths, and inclusion in the current protected main;
- every non-empty single-parent functional source and successor commit;
- a complete operator port decision for all source commits not uniquely matched by
  a stable patch identity; and
- a preservation policy with `cleanupEligible: false`.

The source provider subject is keyed by target repository, source pull-request
node/head/body, source claim ID and terminal digest, plus successor pull-request
node/head/merge commit. A receipt for one subject can never suppress another pull
request, successor, head, body, claim, or repository.

## Port decision

The port-decision file uses the schema
`agentic-retired-handoff-successor-port-decision/v1`. Each functional source commit
must occur exactly once. Merge commits are excluded structurally; no commit is
excluded by its message. A mapping has one of these kinds:

- `patch-identical`: one exact stable patch identity in the successor;
- `evolved-in-successor`: one or more reachable successor commits plus an explicit
  rationale; or
- `obsolete-by-successor`: no successor commit and an explicit rationale explaining
  why the merged successor makes the source change unnecessary.

When one stable patch identity appears more than once in the successor, the
template lists every exact candidate and requires the operator to select one with
a non-empty rationale. An out-of-set selection, binary or truncated patch,
missing or duplicate source commit, unreachable successor commit, or a required
empty rationale blocks plan sealing.
Each commit's changed-path digest is sealed. For `evolved-in-successor` and
`obsolete-by-successor`, the operator token authorizes the explicit semantic map;
the controller does not claim automated byte or path equivalence for that map.

## Plan

Planning is read-only:

```sh
node scripts/retired-handoff-successor-disposition.mjs plan \
  --repository=/absolute/path/to/target-repository \
  --controller-root=/absolute/path/to/agentic-canvas-os \
  --target-repository=owner/repository \
  --ledger-repository=owner/ledger-repository \
  --source-pr=712 \
  --source-claim-id=<64-hex-claim-id> \
  --successor-pr=742 \
  --port-decision=/absolute/path/to/port-decision.json
```

An incomplete map returns `operator-input-required` with a residual template. A
complete, current map returns a `planDigest` and this byte-exact token:

```text
authorize retired-handoff-successor-disposition <planDigest>
```

No earlier reconciliation, scope-expansion, admission, or dormant-preservation
token applies.

## Run

Execution requires both the printed digest and exact token:

```sh
node scripts/retired-handoff-successor-disposition.mjs run \
  --repository=/absolute/path/to/target-repository \
  --controller-root=/absolute/path/to/agentic-canvas-os \
  --target-repository=owner/repository \
  --ledger-repository=owner/ledger-repository \
  --source-pr=712 \
  --source-claim-id=<64-hex-claim-id> \
  --successor-pr=742 \
  --port-decision=/absolute/path/to/port-decision.json \
  --plan-digest=<planDigest> \
  --authorize='authorize retired-handoff-successor-disposition <planDigest>'
```

The authorized intent is the controller's first durable effect. The controller
re-reads the ledger, provider, remote, local, successor, checks, and protected-main
identities before each later journal phase, then writes an immutable receipt under
the target repository Git common directory:

```text
agentic-canvas-os/provider-scope-dispositions/
  intents/<subject-key>.json
  receipts/<subject-key>.json
```

Files are mode `0600`, intent updates use compare-and-swap plus atomic rename, and
receipt creation is immutable. After an authorized intent exists, its sealed plan
is the recovery checkpoint: crashes after authorization, verification, receipt
creation, or completion replay across unrelated controller, ledger-head,
protected-main, check, base, or provider-version advancement. Every replay still
normalizes fresh evidence and requires the exact durable source, terminal claim,
merged successor, relevant local projection, and functional commit inventories;
drift in any of those subjects blocks. No replay performs a provider or cloud
mutation.

## Consumer boundary

`provider-scope-disposition.mjs` validates a receipt together with its complete
stored intent and plan snapshot against a fresh live observation. It joins the
authorization, port decision, phase operation keys, and terminal receipt digest,
then compares the exact durable source claim, provider head/body/remote marker,
merged-successor identity, relevant local projection, and commit inventories.
Each observation must independently prove current protected controller, ledger,
main containment, and required checks; unrelated global-head advancement does not
invalidate the durable subject. The consumer may then classify only that subject as
`retired-handoff-superseded-by-merged-successor`. Drift leaves the pull request
active. The validated receipt-set digest and every consumed receipt digest must be
bound into any later admission plan and receipt.

This capability does not itself wire that validation into every provider-scope
collector. Until those consumers are separately integrated, a logical receipt is
proof only and must not be represented as unblocked admission.

## Current XR boundary

The first intended subject is PR712's retired-handoff claim against merged PR742.
Other provider subjects remain independent:

- PR702 requires its own retired-superseded disposition;
- PR711 requires an explicit claimless successor or abandon-preserved decision;
- PR757 is an unresolved owner and produces only blocking preservation evidence.

PR757's branch, worktree, untracked diagnostics, provider object, and failed or
pending checks remain preserved. No PR712 receipt can waive PR702, PR711, or PR757.
