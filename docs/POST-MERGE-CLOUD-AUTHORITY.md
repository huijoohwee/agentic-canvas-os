---
title: "Post-Merge Cloud Authority Verification"
graphId: "md:agentic-post-merge-cloud-authority"
doc_type: "Runtime Contract"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-post-merge-cloud-authority-verification/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "read-only verification of an exact integrated claim retirement after protected merge"
runtime_scope: "device integration replay after the protected-main push lifecycle retires its claim"
runtime_claim: "Dev integration recovery only; Production and deployment remain separately gated"
runtime_owner: "../scripts/post-merge-cloud-authority-verifier.mjs; ../scripts/device-branch.mjs"
runtime_proof: "../__tests__/post-merge-cloud-authority-verifier.test.mjs"
publish_policy: "protected Dev integration only; no Production or Cloudflare authority"
---
<!-- Responsibility: Define the exact historical cloud proof accepted after protected merge retires a delivery claim. -->

# Post-merge cloud authority verification

Review-ready delivery verification carries the same bounded protected-main
refresh receipt both before auto-merge and after merge. A refreshed provider
head without that receipt is never treated as the cloud-authoritative reviewed
head, including during response-loss replay.

`device:integrate` normally verifies the live `integrated-preserved` claim. The
protected-main push workflow then retires that same claim with reason
`integrated`. If the retirement wins the race with the integrating process, a
later replay must not require live write authority that has correctly ended.

The CLI dispatcher first runs the ordinary live verifier. A fallback exists
only when GitHub independently reports the exact source branch and either the
delivered head or the terminal head of the controller-proven protected-main
refresh receipt as a merged pull request. A refreshed head is accepted only
when every receipt hop is SHA-bound, continuous from the delivery subject, and
ends at the live merged head. The fallback reads and validates the complete
collaboration ledger,
then requires the local delivery projection's exact integration entry followed
by the same claim's terminal retirement at counter plus one. Claim identity,
base, head, write set, epoch, review request, integration evidence, integration
receipt, named checks, and handoff evidence must all remain exact.

An open pull request, non-integrated retirement, later same-claim transition,
ledger validation failure, identity drift, or receipt mismatch preserves the
original failure. The fallback is read only: it cannot create or renew a claim,
merge a pull request, edit a lease, reconcile runtime, clean a worktree, or
authorize Production or Cloudflare deployment.

An expired delivery replay keeps live same-claim recovery as its first path. If
that recovery fails and the exact delivery pull request is already merged,
`device:integrate` runs this historical verifier before returning the live
recovery failure. Only an exact `integrated-retired` receipt may complete the
local task. A missing or mismatched receipt preserves the original failure;
the fallback never recreates or revives the retired claim.
